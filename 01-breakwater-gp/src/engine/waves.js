// The sea state. One definition drives both the GPU (vertex + fragment shader
// of the ocean) and the CPU (buoyancy for crafts and buoys), so what you see
// is what the physics rides on.
//
// The surface is made from a wave spectrum when the game loads (engine/ocean.js):
// a few "cascades", each a table of where the water is over one tile of sea for
// one period of time, repeating exactly in both. A point of the surface is
//   P.xz = p + CHOP * Σ sideways_c(p, t)
//   P.y  =            Σ height_c(p, t)
// scaled by a slowly varying "amplitude field" that calms the water in the lee
// of the main island and close to any shore. The shaders read the tables as 3D
// textures; sampleSurface() below reads the same numbers from the arrays they
// were uploaded from.
//
// Two tiers: the long cascades carry the crafts (CPU + GPU); the shortest one
// is chop a hand high that only the GPU draws.

import * as THREE from 'three';
import { DEG, smoothstep } from './math.js';
import { addCascade, makeOcean } from './ocean.js';

const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** The sea that is made at load. Lengths in metres, times in seconds. */
export const SEA = {
  /** Significant wave height of the open sea: about the mean height, trough to crest, of the highest third of the waves. */
  height: 7.0,
  /** The wavelength that carries the most energy. */
  peakLength: 115,
  /** How peaked the spectrum is round it, and how fast energy falls off toward shorter waves (see makeOcean). */
  sharpness: 2.8,
  tail: 4.5,
  /** Where the waves run toward (degrees: 0 = +X, 90 = +Z). */
  dir: 218,
  /** How far each wave pulls the water toward its crest (0 = smooth swell; past about 1.5 crests start to fold over). */
  chop: 1.4,
  seed: 5,
  // Each cascade: the side of its tile, its grid, the time after which it repeats, how many frames of that are
  // kept, the wavelengths it carries [shortest, longest), whether the physics rides it, how far out the mesh can
  // still carry it (as a multiple of the mesh's fineness, see setWaveMeshDensity) and how far out it is shaded.
  // (Tiles and periods are chosen not to divide one another, so the whole repeats only after a very long way and time.)
  // What the boats ride is the same table on every machine; only the chop that is drawn and not felt is coarser on phones.
  cascades: [
    { size: 360, n: 64, period: 64, frames: 128, band: [22.5, 361], physics: true, carry: 82, shade: 430 },
    { size: 72, n: 64, period: 31, frames: 128, band: [4.5, 22.5], physics: true, carry: 10, shade: 120 },
    { size: 14.4, n: coarsePointer ? 32 : 64, period: 7.9, frames: coarsePointer ? 48 : 80, band: [coarsePointer ? 1.8 : 0.9, 4.5], physics: false, carry: 2, shade: 36 },
  ],
};
const CASCADES = SEA.cascades.length;

export const ISLAND_COUNT = 6;
/** Rough crest-to-trough range of the open sea (m), for height-based shading. */
export const SEA_HEIGHT = SEA.height * 0.875;
/** The direction the swell runs toward (unit vector in x, z). */
export const SWELL_DIR = { x: Math.cos(SEA.dir * DEG), z: Math.sin(SEA.dir * DEG) };

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

// ------------------------------------------------------------------ the sea

let ocean = null;
/** The tables (made the first time anything asks). */
function theOcean() {
  if (!ocean) ocean = makeOcean({ height: SEA.height, peakLength: SEA.peakLength, sharpness: SEA.sharpness, tail: SEA.tail, dir: SEA.dir * DEG, seed: SEA.seed, cascades: SEA.cascades });
  return ocean;
}

// ---------------------------------------------------------------- uniforms

const FAR = 1e6;

export const waveUniforms = {
  // per cascade: 1 / tile side, where in its period it is now (0..1), 1 / period, choppiness
  uSeaA: { value: SEA.cascades.map((c) => new THREE.Vector4(1 / c.size, 0, 1 / c.period, SEA.chop)) },
  // per cascade: how far out the mesh still carries it, how far out it is shaded
  uSeaB: { value: SEA.cascades.map((c) => new THREE.Vector4(c.carry * 6, c.shade, 0, 0)) },
  uWaveTime: { value: 0 },
  uIslands: { value: Array.from({ length: ISLAND_COUNT }, () => new THREE.Vector3(FAR, FAR, 0)) },
  uShelter: { value: new THREE.Vector4(sea.shelterDirX, sea.shelterDirZ, sea.shelterCalm, sea.scale) },
};
for (let i = 0; i < CASCADES; i++) {
  waveUniforms[`uSeaDisp${i}`] = { value: null };
  waveUniforms[`uSeaDeriv${i}`] = { value: null };
}

function table(data, n, frames) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.Data3DTexture(half, n, n, frames);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

let uploaded = false;
/**
 * Hand the sea to the graphics card (once): each cascade as two 3D textures, x and z across the tile and time through
 * its period. What only the shaders need is then let go of; the physics keeps what it rides on.
 */
export function prepareSeaTextures() {
  if (uploaded) return;
  uploaded = true;
  theOcean().cascades.forEach((c, i) => {
    waveUniforms[`uSeaDisp${i}`].value = table(c.disp, c.n, c.frames);
    waveUniforms[`uSeaDeriv${i}`].value = table(c.deriv, c.n, c.frames);
    c.deriv = null;
    if (!SEA.cascades[i].physics) c.disp = null;
  });
}

/**
 * Tell the waves how fine the ocean mesh is (angular segments of the radial
 * grid). A cascade is only displaced where the mesh has a few vertices to each of its
 * waves; further out it lives on in the per-pixel normals.
 */
export function setWaveMeshDensity(segments) {
  const k = segments / 32;
  waveUniforms.uSeaB.value.forEach((v, i) => (v.x = SEA.cascades[i].carry * k));
}

/** Register the island circles (also used for shallow-water tint and shore foam). */
export function setSeaIslands(list) {
  sea.islands = list.slice(0, ISLAND_COUNT);
  waveUniforms.uIslands.value.forEach((v, i) => {
    const isl = sea.islands[i];
    if (isl) v.set(isl.x, isl.z, isl.r);
    else v.set(FAR, FAR, 0);
  });
}

/** Push time + tunables to the GPU. */
export function updateWaveUniforms(time) {
  waveUniforms.uWaveTime.value = time;
  waveUniforms.uShelter.value.set(sea.shelterDirX, sea.shelterDirZ, sea.shelterCalm, sea.scale);
  waveUniforms.uSeaA.value.forEach((v, i) => {
    const c = SEA.cascades[i];
    // (frame f of a table is the sea at f / frames of its period, and sits at (f + 0.5) / frames of the texture)
    v.y = (((time / c.period) % 1) + 1) % 1 + 0.5 / c.frames;
    v.w = SEA.chop;
  });
}

// -------------------------------------------------------------------- GLSL

const each = (line) => SEA.cascades.map((_, i) => line.replaceAll('#', String(i))).join('\n');

export const WAVE_GLSL = /* glsl */ `
#define ISLAND_COUNT ${ISLAND_COUNT}
#define FAR_FOAM 0.95
${each('uniform highp sampler3D uSeaDisp#;    // xyz: sideways x, height, sideways z (for unit choppiness); w: squeeze lately')}
${each('uniform highp sampler3D uSeaDeriv#;   // xy: slopes of the height; z: squeeze; w: fold (see engine/ocean.js)')}
uniform vec4 uSeaA[${CASCADES}];
uniform vec4 uSeaB[${CASCADES}];
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
  float a = 0.2 + 0.8 * smoothstep(0.0, 70.0, shore);
  a *= mix(1.0, uShelter.z, smoothstep(-110.0, 150.0, dot(p, uShelter.xy)));
  return a * uShelter.w;
}

float waveAmpField(vec2 p) {
  return waveAmpFromShore(p, shoreDistance(p));
}

// Displacement of the undisplaced surface point p. Cascades whose waves are too short for the
// mesh resolution at distance "dist" are faded out.
vec3 waveDisplace(vec2 p, float ampScale, float dist) {
  vec3 d = vec3(0.0);
  float f;
${each(`  f = 1.0 - smoothstep(uSeaB[#].x * 0.55, uSeaB[#].x, dist);
  if (f > 0.0) d += textureLod(uSeaDisp#, vec3(p * uSeaA[#].x, uSeaA[#].y), 0.0).xyz * f;`)}
  d.xz *= uSeaA[0].w;
  return d * ampScale;
}

// What the surface is doing at p:
//   n      its normal
//   jac    its Jacobian: how much the sideways motion has squeezed it (1 = not at all, 0 = to nothing: folding over)
//   squeeze, lately   how hard the waves that carry foam are squeezing it now (0 = not, towards 1 = breaking), and
//                     the most they have in the last few seconds, faded: what a crest leaves behind
// Cascades too fine to show at distance "dist" are faded out. (Where the shorter of the waves that carry foam have
// faded, the longest count for what both did, about twice as much, so that the far sea keeps its whitecaps.)
void waveSurface(vec2 p, float ampScale, float dist, out vec3 n, out float jac, out float squeeze, out float lately) {
  vec2 slope = vec2(0.0);
  float fold = 0.0;
  float fine = 0.0;
  squeeze = 0.0;
  lately = 0.0;
  float f;
  vec3 q;
  vec4 g;
${SEA.cascades
  .map((c, i) =>
    `  f = 1.0 - smoothstep(uSeaB[#].y * 0.5, uSeaB[#].y, dist);${
      c.physics && i > 0
        ? `
  squeeze *= 1.0 + FAR_FOAM * (1.0 - f);
  lately *= 1.0 + FAR_FOAM * (1.0 - f);`
        : ''
    }
  if (f > 0.0) {
    q = vec3(p * uSeaA[#].x, uSeaA[#].y);
    g = textureLod(uSeaDeriv#, q, 0.0);
    slope += g.xy * f;
    fold += g.w * f * f;
    ${c.physics ? `squeeze += g.z * f;\n    lately += textureLod(uSeaDisp#, q, 0.0).w * f;` : `fine += g.z * f;`}
  }`.replaceAll('#', String(i)),
  )
  .join('\n')}
  float k = ampScale * uSeaA[0].w;
  squeeze *= k;
  lately *= k;
  fine = squeeze + fine * k;
  jac = 1.0 - fine + k * k * fold;
  n = normalize(vec3(-slope.x * ampScale, max(1.0 - fine, 0.15), -slope.y * ampScale));
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
  let a = 0.2 + 0.8 * smoothstep(0, 70, shoreDistance(x, z));
  const s = x * sea.shelterDirX + z * sea.shelterDirZ;
  a *= 1 + (sea.shelterCalm - 1) * smoothstep(-110, 150, s);
  return a * sea.scale;
}

const _at = { dx: 0, dy: 0, dz: 0, vy: 0, sx: 0, sz: 0 };
/** What the cascades the physics rides add up to at the undisplaced point (x, z). */
function carried(x, z, t) {
  _at.dx = _at.dy = _at.dz = _at.vy = _at.sx = _at.sz = 0;
  const cascades = theOcean().cascades;
  for (let i = 0; i < CASCADES; i++) if (SEA.cascades[i].physics) addCascade(cascades[i], x, z, t, 1, _at);
  return _at;
}

/**
 * Sample the water surface above the world point (x, z) at time t.
 * Writes into `out`: y (height), nx/ny/nz (unit normal), vy (vertical speed of
 * the surface) and px/pz (the undisplaced point that currently sits at x, z —
 * handy for anything that should drift with the water, like foam).
 */
export function sampleSurface(x, z, t, out) {
  // Which bit of water is at (x, z) now? Guess that it is the one that belongs there, see where that one has been
  // pushed to, and correct by most of the miss; six times. (Most of it, not all: near a crest that is about to fold
  // over, correcting by the whole miss overshoots. This lands within 6 cm of the right water 99 times in 100.)
  let amp = waveAmpField(x, z);
  let px = x;
  let pz = z;
  for (let it = 0; it < 6; it++) {
    const at = carried(px, pz, t);
    px += (x - at.dx * SEA.chop * amp - px) * 0.8;
    pz += (z - at.dz * SEA.chop * amp - pz) * 0.8;
  }
  amp = waveAmpField(px, pz);
  const at = carried(px, pz, t);
  const nxr = -at.sx * amp;
  const nzr = -at.sz * amp;
  const inv = 1 / Math.sqrt(nxr * nxr + 1 + nzr * nzr);
  out.y = at.dy * amp;
  out.nx = nxr * inv;
  out.ny = inv;
  out.nz = nzr * inv;
  out.vy = at.vy * amp;
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
