// The air between the eye and what it looks at: haze that thickens with
// distance and settles in the valleys, and takes the colour of the sky behind
// it, warm towards the sun and cool away from it.
//
// One function, used three ways, so that they cannot disagree:
//  - the world's own materials fade to it with distance (patch(), or the GLSL
//    chunks below in a shader of one's own);
//  - the sky dome lays the same haze over itself, taken to the end of the air:
//    the horizon IS the haze's colour, and a far ridge fades into exactly the
//    sky that stands behind it;
//  - three.js's own fog (scene.fog, which the cars' standard materials use)
//    is given, for each view, the density at the camera's height and the
//    haze's colour where the camera looks.
//
// The haze is a layer whose density falls off exponentially with height. Its
// thickness along a straight path has a closed form, so there is no marching:
// looking down into the valley from the summit costs the same as looking
// along the shore.

import * as THREE from 'three';
import { GLSL_TARGET } from '../../engine/glsl.js';

/**
 * Declarations and functions, for the vertex or the fragment stage. The uniforms are the ones in
 * `Atmosphere.uniforms`. Needs `cameraPosition` only through its callers.
 */
export const ATMOSPHERE_PARS = /* glsl */ `
uniform vec3 uHazeColor;   // deep haze seen away from the sun
uniform vec3 uHazeSun;     // added looking straight at the sun
uniform vec4 uHaze;        // density at y = 0 (1/m), its falloff with height (1/m), the sun lobe's power, the thin air's
                           // density at y = 0 (1/m; its scale height is AIR_SCALE)
uniform vec3 uHazeSunDir;  // towards the sun or the moon

// What deep haze looks like in direction dir (unit).
vec3 hazeColor(vec3 dir) {
  return uHazeColor + uHazeSun * pow(0.5 + 0.5 * dot(dir, uHazeSunDir), uHaze.z);
}

// The mean of exp(-falloff * height) along a path that climbs rise metres, relative to its value at the start.
float hazeColumn(float falloff, float rise) {
  float k = clamp(falloff * rise, -30.0, 30.0);
  return abs(k) > 1.0e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
}

// The share of the light from a point that the haze replaces on its way to an eye at height eyeY; ray = point - eye.
// Two layers: the valley haze (thick, a few tens of metres deep) and the thin air above it (scale height AIR_SCALE),
// which is what lifts and blues a mountain kilometres away. The sky dome takes only the first: the clear sky's own
// gradient already is the second.
const float AIR_SCALE = 1400.0;
float hazeBetween(float eyeY, vec3 ray) {
  float len = length(ray);
  float valley = uHaze.x * exp(-uHaze.y * eyeY) * hazeColumn(uHaze.y, ray.y);
  float air = uHaze.w * exp(-eyeY / AIR_SCALE) * hazeColumn(1.0 / AIR_SCALE, ray.y);
  return 1.0 - exp(-(valley + air) * len);
}

// The same for a line of sight that leaves the air: up = how steeply it climbs (the y of its unit direction).
float hazeToSky(float eyeY, float up) {
  return 1.0 - exp(-uHaze.x * exp(-uHaze.y * eyeY) / (uHaze.y * max(up, 1.0e-4)));
}

// A colour at a point in the world as the eye sees it through the air.
vec3 throughHaze(vec3 color, vec3 eye, vec3 point) {
  vec3 ray = point - eye;
  return mix(color, hazeColor(normalize(ray)), hazeBetween(eye.y, ray));
}
`;

let fogPatched = false;

/**
 * three.js's FogExp2 fades with the square of the distance; ours, like real haze, with the distance itself. The
 * one line is changed in three.js's shader library (before anything is compiled), so that `scene.fog.density`
 * means the same thing in a standard material as `fog.density` means everywhere else: light lost per metre.
 */
function installLinearFog() {
  if (fogPatched) return;
  fogPatched = true;
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    'exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )',
    'exp( - fogDensity * vFogDepth )',
  );
}

/**
 * @typedef {object} Atmosphere
 * @property {Record<string, { value: any }>} uniforms the haze's uniforms; every patched material and the sky share
 *   these very objects
 * @property {THREE.FogExp2} fog for scene.fog
 * @property {(time: import('./lighting.js').TimeOfDay) => void} setTime
 * @property {(camera: THREE.Camera) => void} prepareView gives scene.fog what suits this camera
 * @property {<T extends THREE.Material>(material: T) => T} patch makes a built-in material (anything with three.js's
 *   fog chunks) fade into the haze instead of into scene.fog; returns the material
 */

/**
 * @param {import('../../engine/caps.js').Caps} caps
 * @returns {Atmosphere}
 */
export function createAtmosphere(caps) {
  installLinearFog();

  const uniforms = {
    uHazeColor: { value: new THREE.Vector3() },
    uHazeSun: { value: new THREE.Vector3() },
    uHaze: { value: new THREE.Vector4() },
    uHazeSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const fog = new THREE.FogExp2(0x000000, 0);
  const forward = new THREE.Vector3();
  const eye = new THREE.Vector3();

  // Where the frame is built on 8-bit targets (see engine/glsl.js) the colour arriving at the fog stage is
  // already encoded: it is decoded, hazed and encoded again, as the engine does for three.js's own fog.
  const ldr = !caps.hdr;
  const fragmentPars = `${ldr ? '#define LDR_TARGETS 1\n' : ''}${GLSL_TARGET}${ATMOSPHERE_PARS}\nvarying vec3 vHazeWorld;\n`;
  const fragmentMain = ldr
    ? 'gl_FragColor = toTarget( vec4( throughHaze( fromTarget( gl_FragColor ).rgb, cameraPosition, vHazeWorld ), gl_FragColor.a ) );'
    : 'gl_FragColor.rgb = throughHaze( gl_FragColor.rgb, cameraPosition, vHazeWorld );';
  const vertexMain = /* glsl */ `
vec4 hazeWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  hazeWorld = batchingMatrix * hazeWorld;
#endif
#ifdef USE_INSTANCING
  hazeWorld = instanceMatrix * hazeWorld;
#endif
vHazeWorld = ( modelMatrix * hazeWorld ).xyz;
`;

  return {
    uniforms,
    fog,

    setTime(time) {
      const f = time.fog;
      uniforms.uHazeColor.value.fromArray(f.color);
      uniforms.uHazeSun.value.fromArray(f.sun);
      uniforms.uHaze.value.set(f.density, f.heightFalloff, f.sunLobe, f.air ?? 0);
      uniforms.uHazeSunDir.value.fromArray(time.sun.dir).normalize();
    },

    prepareView(camera) {
      // (the two lines below are hazeColor() and the density term of hazeBetween() again, for the one consumer
      // that cannot run them: a fog that is a single colour and a single density per view)
      const { uHazeColor, uHazeSun, uHaze, uHazeSunDir } = uniforms;
      camera.getWorldDirection(forward);
      const lobe = Math.pow(0.5 + 0.5 * forward.dot(uHazeSunDir.value), uHaze.value.z);
      fog.color.setRGB(
        uHazeColor.value.x + uHazeSun.value.x * lobe,
        uHazeColor.value.y + uHazeSun.value.y * lobe,
        uHazeColor.value.z + uHazeSun.value.z * lobe,
      );
      const eyeY = eye.setFromMatrixPosition(camera.matrixWorld).y;
      fog.density = uHaze.value.x * Math.exp(-uHaze.value.y * eyeY) + uHaze.value.w * Math.exp(-eyeY / 1400);
    },

    patch(material) {
      const before = material.onBeforeCompile;
      const key = material.customProgramCacheKey();
      material.fog = false;
      material.onBeforeCompile = (shader, renderer) => {
        before.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHazeWorld;')
          .replace('#include <project_vertex>', `#include <project_vertex>\n${vertexMain}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${fragmentPars}`)
          .replace('#include <fog_fragment>', fragmentMain);
      };
      material.customProgramCacheKey = () => `${key}|haze`;
      return material;
    },
  };
}
