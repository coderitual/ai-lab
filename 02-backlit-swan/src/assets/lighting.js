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
 *   uDapple: the leaves the sun comes through. x = share of the shadow's edge that is
 *     broken into flecks of sun and shade (0: one smooth gradient), y = 1 / size of a
 *     fleck in metres, z = share of the canopy that lets the sun through (0 hardly any,
 *     1 nearly all; see canopyLight below), w = seconds (slowed time), for the stirring
 *     of the leaves.
 *     The wood keeps it up to date (Forest.js, update) from LOOK.
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
    uDapple: { value: new THREE.Vector4(0.7, 1 / 0.45, 0.42, 0) },
  };

  const glsl = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uBounceColor;
uniform float uAmbient;
uniform vec4 uShade;
uniform vec4 uDapple;

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

// Two axes at right angles to the sunlight. Whatever is the same all the way
// along a ray of sun (a gap between two crowns, the shadow of a bough) depends
// on these two numbers only, so a pattern drawn in them slants with the sun
// wherever it is looked up: on leaves, in haze, on a trunk, on the ground.
// On level ground it comes out stretched along the light by 1 / sin(height of
// the sun), as shadows are when the sun is low.
vec2 acrossSun(vec3 p) {
  vec3 side = normalize(vec3(uSunDir.z, 0.0, -uSunDir.x) + vec3(1.0e-5, 0.0, 0.0));
  return vec2(dot(p, side), dot(p, cross(uSunDir, side)));
}

// Sun that has come through the canopy: 0 in the shadow of a crown, 1 where a
// gap lets it through. Gaps three or four metres apart, broken up by holes a
// metre and less than half a metre across; uDapple.z is the share of the
// canopy that is open (0 hardly any, 1 nearly all). Everything
// under the trees asks this (leaves, trunks, the grass of the clearing), so
// the lit clumps, the flecks on the bark and the shadows on the meadow are
// one pattern, and it moves as one when the sun is turned.
float canopyLight(vec3 p) {
  vec2 q = acrossSun(p);
  float n = valueNoise(q * 0.29 + 3.7) * 0.5 + valueNoise(q * 0.83 + 11.3) * 0.3 + valueNoise(q * 2.3 + 23.9) * 0.2;
  // value noise crowds round one half: 0.3 .. 0.7 holds nearly all of this sum
  float open = 0.7 - 0.4 * uDapple.z;
  return smoothstep(open - 0.07, open + 0.07, n);
}

// The flecks at the edge of the wood's shadow, -1 .. 1 with no bias either
// way: sun through the last leaves. They wobble about their places as the
// leaves stir (uDapple.w is the time), by a fifth of their size at most.
float leafDapple(vec3 p) {
  vec2 q = acrossSun(p) * uDapple.y;
  q += 0.1 * sin(q.yx * 1.9 + uDapple.w * vec2(0.71, 0.53));
  return clamp((valueNoise(q) * 0.65 + valueNoise(q * 2.7 + 5.3) * 0.35 - 0.5) * 3.2, -1.0, 1.0);
}

// Whether the sun reaches a point at all: 1 in the sun, 0 in the shadow of the
// wood. The sun is low behind the trees, so their shadow covers the far side
// of the pond and ends a little beyond the middle; everything from there
// toward the camera is lit. In the film the swan and the water in front of it
// are in the sun and the water 1.2 to 2 m behind it is not. The edge is
// measured along the direction of the sun, so it turns with the sun. Use this
// for anything the sun lights: the swan, the water's colour and glints, the
// specks, drops in the air.
//
// The edge is the shadow of leaves, not of a wall: across its width (uShade.y
// either side of the line) the shade does not thin evenly but breaks up, first
// into shade with flecks of sun in it, then into sun with flecks of shade.
// The flecks have no bias, so the line where half the light is left stays
// where it was, and so do the two ends of the edge: all sun before it, none
// beyond. With uDapple.x at 0 it is the plain gradient again.
float sunReach(vec3 worldPos) {
  vec2 toSun = normalize(uSunDir.xz + vec2(1.0e-5, 0.0));
  vec2 across = vec2(-toSun.y, toSun.x);
  float along = dot(worldPos.xz, toSun);
  float side = dot(worldPos.xz, across);
  // two slow waves that never line up: the outline of tree tops, not a ruler
  float wander = sin(side * uShade.w * 6.2832 + 1.3) * 0.6 + sin(side * uShade.w * 2.3 * 6.2832 + 4.1) * 0.4;
  float reach = uShade.x + uShade.z * wander;
  // -1 where the edge begins, +1 where it ends
  float d = (along - reach) / max(uShade.y, 1.0e-3);
  float broken = clamp(uDapple.x, 0.0, 0.95);
  // (the noise is only looked up inside the edge: most of the pond is outside it)
  if (broken > 0.0 && abs(d) < 1.0) d += broken * leafDapple(worldPos);
  return 1.0 - smoothstep(broken - 1.0, 1.0 - broken, d);
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
