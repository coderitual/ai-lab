// Atmosphere: a procedural sky dome (gradient, sun, drifting clouds) plus the
// shared GLSL that lets every other material fade into the *same* sky colour
// with distance, so the horizon is seamless.

import * as THREE from 'three';
import { PALETTE, SUN_DIR } from './palette.js';

/** Uniforms shared (by reference) between the sky, the sea and patched materials. */
export const atmosphereUniforms = {
  uSunDir: { value: SUN_DIR.clone() },
  uSkyZenith: { value: PALETTE.skyZenith.clone() },
  uSkyMid: { value: PALETTE.skyMid.clone() },
  uSkyHorizonSun: { value: PALETTE.skyHorizonSun.clone() },
  uSkyHorizonAway: { value: PALETTE.skyHorizonAway.clone() },
  uSunColor: { value: PALETTE.sunColor.clone() },
  // x: density (1/m), y: max amount
  uFog: { value: new THREE.Vector2(0.00042, 0.96) },
};

/** skyGradient(dir) and applySkyFog(color, viewDir, dist) — include once per shader. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizonSun;
uniform vec3 uSkyHorizonAway;
uniform vec3 uSunColor;
uniform vec2 uFog;

// Sky colour without the sun disc or clouds (also used for reflections + haze).
vec3 skyGradient(vec3 dir) {
  float y = max(dir.y, 0.0);
  float toward = dot(normalize(dir.xz + vec2(1.0e-5)), normalize(uSunDir.xz)) * 0.5 + 0.5;
  vec3 horizon = mix(uSkyHorizonAway, uSkyHorizonSun, toward * toward);
  vec3 col = mix(horizon, uSkyMid, smoothstep(0.0, 0.26, pow(y, 0.75)));
  col = mix(col, uSkyZenith, smoothstep(0.08, 0.85, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (0.10 * pow(sd, 5.0) + 0.45 * pow(sd, 40.0));
  return col;
}

// Aerial perspective toward the horizon colour in the viewing direction.
vec3 applySkyFog(vec3 color, vec3 viewDir, float dist) {
  float f = (1.0 - exp(-dist * uFog.x)) * uFog.y;
  vec3 hd = normalize(vec3(viewDir.x, 0.035, viewDir.z));
  return mix(color, skyGradient(hd), f);
}
`;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = viewMatrix * vec4(mat3(modelMatrix) * position, 0.0);   // rotation only: dome is "infinitely" far
  mv.w = 1.0;
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;                                     // push to the far plane
}
`;

const skyFragment = /* glsl */ `
precision highp float;
${SKY_GLSL}
uniform sampler2D uNoiseTex;
uniform float uTime;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uBelow;
uniform float uSunDisc;     // 1 = draw the sun disc (off for the environment map)
varying vec3 vDir;

float cloudField(vec2 uv) {
  float n = texture2D(uNoiseTex, uv).r * 0.62;
  n += texture2D(uNoiseTex, uv * 2.7 + 0.31).r * 0.26;
  n += texture2D(uNoiseTex, uv * 6.1 + 0.67).b * 0.12;
  return n;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyGradient(dir);

  // sun disc + tight corona
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99905, 0.99945, sd);
  col += uSunColor * (disc * 14.0 + pow(max(sd, 0.0), 900.0) * 3.0) * uSunDisc;

  // one high layer of streaky clouds, projected on a plane above the camera
  float up = max(dir.y, 0.0);
  vec2 plane = dir.xz / (up + 0.09);
  vec2 uv = plane * vec2(0.06, 0.095) + vec2(uTime * 0.0016, uTime * 0.0006);
  float d = cloudField(uv);
  float cover = smoothstep(0.52, 0.7, d);
  // light the side facing the sun
  vec2 toSun = normalize(uSunDir.xz) * 0.02;
  float lit = clamp((d - cloudField(uv + toSun)) * 9.0 + 0.55, 0.0, 1.0);
  vec3 cloudCol = mix(uCloudShade, uCloudLit, lit);
  float sunNear = pow(max(sd, 0.0), 10.0);
  cloudCol += uSunColor * sunNear * 0.35;
  float horizonFade = smoothstep(0.015, 0.14, up);
  col = mix(col, cloudCol, cover * horizonFade * 0.9);

  // below the horizon (only really seen by the environment map)
  col = mix(col, uBelow, smoothstep(0.0, -0.08, dir.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The visible sky dome. Add to the scene; it ignores camera translation. */
export function createSky(noiseTex) {
  const material = new THREE.ShaderMaterial({
    name: 'Sky',
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: {
      ...atmosphereUniforms,
      uNoiseTex: { value: noiseTex },
      uTime: { value: 0 },
      uCloudLit: { value: PALETTE.cloudLit.clone() },
      uCloudShade: { value: PALETTE.cloudShade.clone() },
      uBelow: { value: new THREE.Color('#0a4a78') },
      uSunDisc: { value: 1 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Image-based lighting from the sky itself, so painted hulls pick up the warm
 * horizon and the blue zenith. Returns a PMREM texture (or null if unsupported).
 */
export function createSkyEnvironment(renderer, skyMesh) {
  try {
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(skyMesh.geometry, skyMesh.material.clone());
    dome.material.uniforms.uSunDisc = { value: 0 };
    dome.material.uniforms.uNoiseTex = skyMesh.material.uniforms.uNoiseTex;
    dome.frustumCulled = false;
    scene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0.02, 0.1, 10);
    pmrem.dispose();
    dome.material.dispose();
    return target.texture;
  } catch (err) {
    console.warn('Sky environment unavailable, falling back to hemisphere light.', err);
    return null;
  }
}

/**
 * Make a built-in lit material (Standard / Lambert / Phong / Toon) fade into
 * the sky with distance, in linear space before tone mapping.
 */
export function withSkyFog(material) {
  material.fog = false;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    Object.assign(shader.uniforms, atmosphereUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${SKY_GLSL}\nvoid main() {`)
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `
        {
          vec3 fogViewDir = normalize((vec4(-vViewPosition, 0.0) * viewMatrix).xyz);
          gl_FragColor.rgb = applySkyFog(gl_FragColor.rgb, fogViewDir, length(vViewPosition));
        }
        #include <tonemapping_fragment>`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${key}|skyfog`;
  return material;
}
