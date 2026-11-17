// Retro-reflective sheeting: what a guide post's reflector, a rail's
// reflector and a chevron board are faced with. Glass beads or prisms send
// light back the way it came, in a cone a degree or so wide, so a driver sees
// them blaze in his own head lamps while a bystander a few metres to the side
// sees plain paint.
//
// The shader is told where each car's head lamps are and where they point
// (World.prepareView's `beams`). For each lamp it works out what the lamp lays
// on the sheeting (its beam picture, the distance, the angle) and how much of
// that comes back towards this camera: the coefficient of retroreflection
// falls off steeply with the angle between the lamp and the eye, as seen
// from the sheeting. The answer is light in scene units, added as emission,
// so it is HDR: seen from behind the car it is far beyond white and blooms;
// from anywhere else it is nothing.

import * as THREE from 'three';
import { extend } from './shading.js';

/** Up to this many cars' head lamps are answered. */
export const BEAMS = 2;
/** Head lamp output (THROW in assets/car/lamps.js: candela at the beam's brightest point, per lamp; two per car). */
const LAMP_LOW = 1600;
const LAMP_HIGH = 4500;

/** The beams of every car, shared by all retro-reflective materials. */
const uniforms = {
  uRetroPos: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, -1e4, 0)) },
  uRetroDir: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, 0, 1)) },
  uRetroPower: { value: Array.from({ length: BEAMS }, () => new THREE.Vector2()) },
};

/** @param {Array<{ pos: THREE.Vector3, dir: THREE.Vector3, low: number, high: number }> | undefined} beams */
export function setRetroBeams(beams) {
  for (let i = 0; i < BEAMS; i++) {
    const b = beams?.[i];
    if (b) {
      uniforms.uRetroPos.value[i].copy(b.pos);
      uniforms.uRetroDir.value[i].copy(b.dir).normalize();
      uniforms.uRetroPower.value[i].set(2 * LAMP_LOW * b.low, 2 * LAMP_HIGH * b.high);
    } else uniforms.uRetroPower.value[i].set(0, 0);
  }
}

/**
 * The light that comes back from sheeting at P (normal N, world space) towards the camera, per unit of sheeting
 * colour. A low beam is dark above a cut-off just under the horizontal (kicked up on the right), keeping a few per
 * cent of glare above it; main beam is the same picture tilted up 3.5 degrees.
 */
const RETRO_GLSL = /* glsl */ `
uniform vec3 uRetroPos[${BEAMS}];
uniform vec3 uRetroDir[${BEAMS}];
uniform vec2 uRetroPower[${BEAMS}];
varying vec3 vRetroWorld;

float retroReturn(vec3 P, vec3 N) {
  vec3 toEye = normalize(cameraPosition - P);
  float sum = 0.0;
  for (int i = 0; i < ${BEAMS}; i++) {
    vec2 power = uRetroPower[i];
    if (power.x + power.y <= 0.0) continue;
    vec3 L = uRetroPos[i] - P;
    float d = max(length(L), 0.5);
    L /= d;
    float facing = dot(N, L);
    if (facing <= 0.0) continue;
    vec3 f = uRetroDir[i];
    vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
    vec3 u = cross(r, f);
    float x = dot(-L, f);
    if (x <= 0.05) continue;
    float right = degrees(atan(dot(-L, r), x));
    float up = degrees(atan(dot(-L, u), x));
    float spread = 0.8 * exp(-(right / 17.0) * (right / 17.0)) + 0.2 * exp(-(right / 6.0) * (right / 6.0));
    float cut = -0.6 + clamp((right - 0.5) * 0.268, 0.0, 2.2);
    float low = mix(0.05, 1.0, clamp((cut - up) / 0.35 + 0.5, 0.0, 1.0));
    float high = mix(0.02, 1.0, clamp((cut + 3.5 - up) / 1.5 + 0.5, 0.0, 1.0));
    float E = (power.x * low + power.y * high) * spread * facing / (d * d);
    // the angle at the sheeting between the lamp and the eye, in degrees: the coefficient of retroreflection
    // (cd per lux per square metre) is a few hundred within half a degree and falls to a few by five degrees.
    // The tail is kept generous: the chase camera rides 6 m behind the lamps, two or three degrees off them
    // at the distances that matter, and must still see what the driver sees.
    float a = degrees(acos(clamp(dot(L, toEye), -1.0, 1.0)));
    float coefficient = 250.0 * exp(-(a / 0.75) * (a / 0.75)) + 40.0 * exp(-a / 2.0);
    sum += E * coefficient * (0.35 + 0.65 * facing);
  }
  return sum;
}
`;

/**
 * Makes a standard material retro-reflective: its colour (times `gain`) is also the colour it sends back. Works with
 * instanced meshes. The sheeting's own colour lies in `material.color` (and its map, if it has one).
 * @template {THREE.MeshStandardMaterial} T @param {T} material @param {number} [gain] 1: engineering-grade sheeting
 * @returns {T}
 */
export function retroReflective(material, gain = 1) {
  return extend(material, `retro${gain}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRetroWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 retroWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  retroWorld = instanceMatrix * retroWorld;
#endif
vRetroWorld = ( modelMatrix * retroWorld ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${RETRO_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 worldNormal = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  totalEmissiveRadiance += diffuseColor.rgb * ${gain.toFixed(3)} * retroReturn( vRetroWorld, worldNormal );
}`,
      );
  });
}
