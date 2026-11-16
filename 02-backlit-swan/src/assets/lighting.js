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
 * @property {(azimuthDeg: number, elevationDeg: number) => void} setSun
 *   compass azimuth (0 north = -Z, 90 east = +X) and height above the horizon
 * @property {string} glsl declarations of the uniforms and the helpers below, for any stage
 */

/** @returns {Light} */
export function createLight() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uSunColor: { value: new THREE.Vector3(9, 6.6, 3.4) },
    uSkyColor: { value: new THREE.Vector3(0.035, 0.075, 0.085) },
    uBounceColor: { value: new THREE.Vector3(0.012, 0.02, 0.014) },
    uAmbient: { value: 0.012 },
  };

  const glsl = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uBounceColor;
uniform float uAmbient;

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
