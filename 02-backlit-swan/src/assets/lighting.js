// The light, defined once.
//
// There is one low sun, a cool glow from the open sky on the other side, and
// a dim light coming back up from the water and the wood. Every material
// shares the uniform objects below (the very same { value } objects), so
// turning the sun turns it for everything at once.

import * as THREE from 'three';

const DEG = Math.PI / 180;

/**
 * @typedef {object} Light
 * @property {object} uniforms
 *   uSunDir: unit vector from the scene toward the sun.
 *   uSunColor: the sun, linear and far brighter than 1.
 *   uSkyColor: cool fill; strongest on surfaces that face up and away from the sun (the camera's side).
 *   uBounceColor: dim fill on surfaces that face down.
 *   uAmbient: a floor under everything, so nothing is ever exactly black before the grade.
 *   uShade: where the wood's shadow lies (see sunReach below): x = metres toward the sun
 *     from the pond's centre at which the shadow begins, y = width of its soft edge in
 *     metres, z = how far the edge wanders (metres), w = 1 / length of those wanderings.
 * @property {(azimuthDeg: number, elevationDeg: number) => void} setSun
 *   compass azimuth (0 north = -Z, 90 east = +X) and height above the horizon
 * @property {string} glsl declarations of the uniforms and the helpers below, for any stage
 */

/** @returns {Light} */
export function createLight() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uSunColor: { value: new THREE.Vector3(4.2, 4.0, 3.6) },
    uSkyColor: { value: new THREE.Vector3(0.1, 0.2, 0.33) },
    uBounceColor: { value: new THREE.Vector3(0.012, 0.02, 0.014) },
    uAmbient: { value: 0.012 },
    uShade: { value: new THREE.Vector4(1.6, 0.9, 0.5, 0.35) },
  };

  const glsl = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uBounceColor;
uniform float uAmbient;
uniform vec4 uShade;

// Sunlight on a surface that also catches some light past the terminator
// (wrap = 0 is plain Lambert, 0.5 lets it reach well round the back), as soft
// and fuzzy things do.
float sunWrap(vec3 n, float wrap) {
  return clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
}

// Everything that is not the sun: sky from above and from the side opposite
// the sun, bounce from below, and the floor.
vec3 fillLight(vec3 n) {
  vec3 skyDir = normalize(vec3(-uSunDir.x, 0.55, -uSunDir.z));
  float sky = 0.5 + 0.5 * dot(n, skyDir);
  float bounce = 0.5 - 0.5 * n.y;
  return uSkyColor * sky * sky + uBounceColor * bounce + vec3(uAmbient) * uSkyColor;
}

// How much of the sun comes straight at the eye from behind the thing looked
// at: 1 when looking right into the sun. The heart of every backlight effect.
float towardSun(vec3 viewDir) {
  return max(dot(-viewDir, uSunDir), 0.0);
}

// Whether the sun reaches a point at all: 1 in the sun, 0 in the shadow of the
// wood. The sun is low behind the trees, so their shadow covers the far side
// of the pond and ends in a soft, wandering edge a little beyond the middle;
// everything from there toward the camera is lit. In the film the swan and
// the water in front of it are in the sun and the water 1.2 to 2 m behind it
// is not. The edge is measured along the direction of the sun, so it turns
// with the sun. Use this for anything the sun lights: the swan, the water's
// colour and glints, the specks, drops in the air.
float sunReach(vec3 worldPos) {
  vec2 toSun = normalize(uSunDir.xz + vec2(1.0e-5, 0.0));
  vec2 across = vec2(-toSun.y, toSun.x);
  float along = dot(worldPos.xz, toSun);
  float side = dot(worldPos.xz, across);
  // two slow waves that never line up: the outline of tree tops, not a ruler
  float wander = sin(side * uShade.w * 6.2832 + 1.3) * 0.6 + sin(side * uShade.w * 2.3 * 6.2832 + 4.1) * 0.4;
  float reach = uShade.x + uShade.z * wander;
  return 1.0 - smoothstep(reach - uShade.y, reach + uShade.y, along);
}
`;

  return {
    uniforms,
    glsl,
    setSun(azimuthDeg, elevationDeg) {
      const az = azimuthDeg * DEG;
      const el = elevationDeg * DEG;
      uniforms.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    },
  };
}
