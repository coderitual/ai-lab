// The sea state. One definition drives both the GPU (vertex + fragment shader
// of the ocean, wakes, …) and the CPU (buoyancy for crafts and buoys), so what
// you see is exactly what the physics rides on.
//
// The surface is a sum of trochoidal (Gerstner) waves:
//   P.xz = p + Σ dir_i * H_i * cos(θ_i)
//   P.y  =     Σ      A_i * sin(θ_i)        θ_i = k_i * dot(dir_i, p) - ω_i t + φ_i
// scaled by a slowly varying "amplitude field" that calms the water in the lee
// of the main island and close to any shore.

import * as THREE from 'three';
import { DEG, smoothstep } from './math.js';

export const WAVE_COUNT = 6;
export const ISLAND_COUNT = 6;
const G = 9.81;

// dir: travel direction in degrees (0 = +X, 90 = +Z), len: wavelength (m),
// amp: amplitude (m), steep: horizontal sharpening (1 = physical trochoid).
const WAVE_DEFS = [
  { dir: 218, len: 58.0, amp: 0.8, steep: 1.2 }, // main ocean swell
  { dir: 250, len: 37.0, amp: 0.55, steep: 1.2 },
  { dir: 188, len: 24.0, amp: 0.33, steep: 1.25 },
  { dir: 290, len: 15.0, amp: 0.16, steep: 1.25 }, // wind chop
  { dir: 150, len: 9.5, amp: 0.085, steep: 1.2 },
  { dir: 325, len: 5.8, amp: 0.04, steep: 1.1 },
];

export const waves = WAVE_DEFS.map((w, i) => {
  const k = (Math.PI * 2) / w.len;
  return {
    dx: Math.cos(w.dir * DEG),
    dz: Math.sin(w.dir * DEG),
    k,
    omega: Math.sqrt(G * k), // deep-water dispersion
    amp: w.amp,
    hAmp: w.amp * w.steep,
    phase: i * 1.7 + 0.4,
    len: w.len,
  };
});

/** Mutable sea configuration shared with the shaders. */
export const sea = {
  /** Global amplitude multiplier (tune for calmer / rougher races). */
  scale: 1.0,
  /** Direction pointing toward the sheltered side, and how calm it gets there. */
  shelterDirX: Math.cos(225 * DEG),
  shelterDirZ: Math.sin(225 * DEG),
  shelterCalm: 0.5,
  /** Up to ISLAND_COUNT circles (x, z, shoreRadius). Waves die down near them. */
  islands: [],
};

// ---------------------------------------------------------------- uniforms

const FAR = 1e6;

export const waveUniforms = {
  uWaveA: { value: waves.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.omega)) },
  // amp, horizontal amp, phase, geometric LOD fade distance
  uWaveB: { value: waves.map((w) => new THREE.Vector4(w.amp, w.hAmp, w.phase, w.len * 6.0)) },
  // shading fade distance per wave (updated from camera height)
  uWaveC: { value: waves.map((w) => Math.sqrt(1700 * w.len)) },
  uWaveTime: { value: 0 },
  uIslands: { value: Array.from({ length: ISLAND_COUNT }, () => new THREE.Vector3(FAR, FAR, 0)) },
  uShelter: { value: new THREE.Vector4(sea.shelterDirX, sea.shelterDirZ, sea.shelterCalm, sea.scale) },
};

/** Register the island circles (also used for shallow-water tint and shore foam). */
export function setSeaIslands(list) {
  sea.islands = list.slice(0, ISLAND_COUNT);
  waveUniforms.uIslands.value.forEach((v, i) => {
    const isl = sea.islands[i];
    if (isl) v.set(isl.x, isl.z, isl.r);
    else v.set(FAR, FAR, 0);
  });
}

/** Push time + tunables to the GPU. `cameraHeight` adapts shading LOD. */
export function updateWaveUniforms(time, cameraHeight = 3) {
  waveUniforms.uWaveTime.value = time;
  waveUniforms.uShelter.value.set(sea.shelterDirX, sea.shelterDirZ, sea.shelterCalm, sea.scale);
  const h = Math.max(cameraHeight, 1.5);
  const c = waveUniforms.uWaveC.value;
  for (let i = 0; i < WAVE_COUNT; i++) c[i] = Math.sqrt(570 * h * waves[i].len);
}

// -------------------------------------------------------------------- GLSL

export const WAVE_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
#define ISLAND_COUNT ${ISLAND_COUNT}
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec4 uWaveB[WAVE_COUNT];
uniform float uWaveC[WAVE_COUNT];
uniform float uWaveTime;
uniform vec3 uIslands[ISLAND_COUNT];
uniform vec4 uShelter;

// Distance to the nearest shore (negative on land).
float shoreDistance(vec2 p) {
  float d = 1.0e5;
  for (int i = 0; i < ISLAND_COUNT; i++) {
    d = min(d, distance(p, uIslands[i].xy) - uIslands[i].z);
  }
  return d;
}

// Wave height multiplier: calmer close to land and in the island's lee.
float waveAmpFromShore(vec2 p, float shore) {
  float a = 0.3 + 0.7 * smoothstep(0.0, 55.0, shore);
  a *= mix(1.0, uShelter.z, smoothstep(-110.0, 150.0, dot(p, uShelter.xy)));
  return a * uShelter.w;
}

float waveAmpField(vec2 p) {
  return waveAmpFromShore(p, shoreDistance(p));
}

// Displacement of the undisplaced surface point p. Waves too short for the
// mesh resolution at distance "dist" are faded out.
vec3 waveDisplace(vec2 p, float ampScale, float dist) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float f = 1.0 - smoothstep(B.w * 0.55, B.w, dist);
    float th = A.z * dot(A.xy, p) - A.w * uWaveTime + B.z;
    d.xz += A.xy * (B.y * cos(th) * f);
    d.y += B.x * sin(th) * f;
  }
  return d * ampScale;
}

// Analytic normal + Jacobian (small where the surface bunches up at crests).
void waveNormal(vec2 p, float ampScale, float dist, out vec3 n, out float jac) {
  vec2 slope = vec2(0.0);
  float ny = 0.0;
  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float f = (1.0 - smoothstep(uWaveC[i] * 0.5, uWaveC[i], dist)) * ampScale;
    float th = A.z * dot(A.xy, p) - A.w * uWaveTime + B.z;
    float c = cos(th);
    float s = sin(th);
    float ka = A.z * B.x * f;
    float kh = A.z * B.y * f;
    slope += A.xy * (ka * c);
    ny += kh * s;
    jxx += kh * A.x * A.x * s;
    jzz += kh * A.y * A.y * s;
    jxz += kh * A.x * A.y * s;
  }
  n = normalize(vec3(-slope.x, 1.0 - ny, -slope.y));
  jac = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
}
`;

// --------------------------------------------------------------------- CPU

function shoreDistance(x, z) {
  let d = 1e5;
  const isl = sea.islands;
  for (let i = 0; i < isl.length; i++) {
    const dx = x - isl[i].x;
    const dz = z - isl[i].z;
    const di = Math.sqrt(dx * dx + dz * dz) - isl[i].r;
    if (di < d) d = di;
  }
  return d;
}

/** Same field as waveAmpField() in GLSL. */
export function waveAmpField(x, z) {
  let a = 0.3 + 0.7 * smoothstep(0, 55, shoreDistance(x, z));
  const s = x * sea.shelterDirX + z * sea.shelterDirZ;
  a *= 1 + (sea.shelterCalm - 1) * smoothstep(-110, 150, s);
  return a * sea.scale;
}

/**
 * Sample the water surface above the world point (x, z) at time t.
 * Writes into `out`: y (height), nx/ny/nz (unit normal), vy (vertical speed of
 * the surface) and px/pz (the undisplaced point that currently sits at x, z —
 * handy for anything that should drift with the water, like foam).
 */
export function sampleSurface(x, z, t, out) {
  // Invert the horizontal displacement with a few fixed-point iterations.
  let amp = waveAmpField(x, z);
  let px = x;
  let pz = z;
  for (let it = 0; it < 3; it++) {
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = waves[i];
      const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.omega * t + w.phase);
      ox += w.dx * w.hAmp * c;
      oz += w.dz * w.hAmp * c;
    }
    px = x - ox * amp;
    pz = z - oz * amp;
  }
  amp = waveAmpField(px, pz);
  let y = 0;
  let sx = 0;
  let sz = 0;
  let ny = 0;
  let vy = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = waves[i];
    const th = w.k * (w.dx * px + w.dz * pz) - w.omega * t + w.phase;
    const s = Math.sin(th);
    const c = Math.cos(th);
    y += w.amp * s;
    sx += w.dx * w.k * w.amp * c;
    sz += w.dz * w.k * w.amp * c;
    ny += w.k * w.hAmp * s;
    vy -= w.amp * w.omega * c;
  }
  const nxr = -sx * amp;
  const nyr = 1 - ny * amp;
  const nzr = -sz * amp;
  const inv = 1 / Math.sqrt(nxr * nxr + nyr * nyr + nzr * nzr);
  out.y = y * amp;
  out.nx = nxr * inv;
  out.ny = nyr * inv;
  out.nz = nzr * inv;
  out.vy = vy * amp;
  out.px = px;
  out.pz = pz;
  return out;
}

const _tmp = { y: 0, nx: 0, ny: 1, nz: 0, vy: 0, px: 0, pz: 0 };

/** Height only. */
export function waterHeight(x, z, t) {
  return sampleSurface(x, z, t, _tmp).y;
}

export const makeSurfaceSample = () => ({ y: 0, nx: 0, ny: 1, nz: 0, vy: 0, px: 0, pz: 0 });
