// The asphalt's generated textures: the stones of the surface course, their
// relief, and the large fields that make one stretch of road unlike the next.
// Made once per tier and shared: the road, the town's paving and the ground
// beside the road (its gravel is the same stones, larger) all read them.
//
// The aggregate. A wearing course is crushed stone about a centimetre across,
// packed tight in bitumen: each stone a flat worn top of its own shade, tilted
// a little its own way, with dark mastic and fines in the gaps a millimetre or
// two lower. That is what the two textures hold, one stone to about four
// texels:
//   `surface`  r the tone (pale stone, dark binder), averaging one half
//              g the height, 0 in the gaps to 1 on the highest tops: what a film
//                of water covers first and what still stands out of it
//              b the polish: how smooth that stone's top is
//              a a mottle some tens of centimetres across (binder-rich and
//                binder-poor batches, wear)
//   `relief`   rgb the normal (the stones' tilted tops, their rounded edges)
//              a how much the normals under one texel of this mip level
//                disagree: their variance.
//
// The variance is what keeps the road from sparkling. Far away many stones
// fall into one pixel; the mip chain averages their normals into a flat one,
// and a shader that lit that flat normal with the stones' own polish would
// draw a mirror that shimmers as the mip levels trade places. What a pixel
// full of tilted polished stones really looks like is a rougher surface, and
// by how much is exactly the spread of the normals that were averaged away. So
// each mip level carries that spread, the asphalt shader adds it to the
// roughness, and the glints of single stones near the camera turn into a
// steady satin sheen with distance instead of noise. (This is the idea of
// LEAN mapping, with one number instead of a covariance matrix.)

import * as THREE from 'three';
import { fieldTexture, valueField, worleyField } from '../../engine/noise.js';

/** Per tier: the aggregate texture's edge in texels and the metres one repeat of it covers. */
export const AGGREGATE = {
  low: { size: 256, tile: 1.25 },
  medium: { size: 512, tile: 1.7 },
  high: { size: 512, tile: 1.7 },
};
/** Metres across one stone of the wearing course, and of the fines between them. */
const STONE = 0.0135;
/** The relief's full height (gap to highest top, m), drawn this many times as deep as it is so that it reads. */
const DEPTH = 0.0022;
const EXAGGERATE = 2.2;
/** How far a stone's top is tilted off the road's plane (slope), at most. */
const FACET = 0.2;
/** The variance channel holds variance times this (a spread of 0.25 is already a very rough pixel). */
export const VARIANCE_GAIN = 4;
/** The polish channel (0..1) times this is the stone's roughness as alpha squared (GGX): 0.3 a polished top, 1 dull. */
export const ROUGH_GAIN = 0.42;
/** Metres one repeat of the large field covers. */
export const BIG_TILE = 37;

/** Integer hash of a lattice point -> [0, 1). */
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Stones: one point scattered in each of `cells` x `cells` squares; for every texel how far inside its stone it is
 * (`edge`: 0 on the border with the next stone, growing inwards, in cells) and three random numbers that belong to
 * the whole stone. Wraps at the texture's edges.
 */
function stones(size, cells, seed) {
  const n = cells;
  const px = new Float32Array(n * n);
  const py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      px[j * n + i] = 0.5 + (hash2(i, j, seed) - 0.5) * 0.9;
      py[j * n + i] = 0.5 + (hash2(i, j, seed + 59) - 0.5) * 0.9;
    }
  }
  const edge = new Float32Array(size * size);
  const a = new Float32Array(size * size);
  const b = new Float32Array(size * size);
  const c = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * n;
    const cj = Math.floor(v);
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * n;
      const ci = Math.floor(u);
      let f1 = Infinity;
      let f2 = Infinity;
      let ni = 0;
      let nj = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = (cj + dj + n) % n;
        for (let di = -1; di <= 1; di++) {
          const k = jj * n + ((ci + di + n) % n);
          const dx = ci + di + px[k] - u;
          const dy = cj + dj + py[k] - v;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
            ni = (ci + di + n) % n;
            nj = jj;
          } else if (d < f2) f2 = d;
        }
      }
      const o = y * size + x;
      edge[o] = Math.sqrt(f2) - Math.sqrt(f1);
      a[o] = hash2(ni, nj, seed + 977);
      b[o] = hash2(ni, nj, seed + 1409);
      c[o] = hash2(ni, nj, seed + 2221);
    }
  }
  return { edge, a, b, c };
}

/** Halves a square field of `channels` floats per texel by averaging 2 x 2 blocks. */
function halve(data, size, channels) {
  const half = size >> 1;
  const out = new Float32Array(half * half * channels);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const p = (y * 2 * size + x * 2) * channels;
      const q = p + size * channels;
      const o = (y * half + x) * channels;
      for (let k = 0; k < channels; k++) out[o + k] = 0.25 * (data[p + k] + data[p + channels + k] + data[q + k] + data[q + channels + k]);
    }
  }
  return out;
}

/** A texture from float levels [{ data (4 floats per texel, 0..1), size }], as bytes with its own mip chain. */
function levelsTexture(levels, anisotropy) {
  const mipmaps = levels.map(({ data, size }) => {
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
    return { data: bytes, width: size, height: size };
  });
  const texture = new THREE.DataTexture(mipmaps[0].data, levels[0].size, levels[0].size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.mipmaps = mipmaps;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Every mip level of a field of 4 floats per texel, by plain averaging. */
function chain(data, size) {
  const levels = [{ data, size }];
  for (let s = size; s > 1; s >>= 1) levels.push({ data: halve(levels[levels.length - 1].data, s, 4), size: s >> 1 });
  return levels;
}

const made = new Map();

/**
 * @typedef {object} RoadTextures
 * @property {THREE.DataTexture} surface @property {THREE.DataTexture} relief @property {THREE.DataTexture} big
 * @property {number} tile metres one repeat of `surface` and `relief` covers
 * @property {number} bytes what the three take on the GPU, mip chains included
 * @property {number} ms what they took to make
 */

/**
 * The asphalt's textures for a tier: made on first use and kept (they are shared by several materials; nobody
 * disposes of them but disposeRoadTextures()).
 * @param {{ caps: import('../../engine/caps.js').Caps, tier: import('../../engine/caps.js').Tier }} options
 * @returns {RoadTextures}
 */
export function roadTextures({ caps, tier }) {
  const known = made.get(tier);
  if (known) return known;
  const started = performance.now();
  const { size, tile } = AGGREGATE[tier] ?? AGGREGATE.medium;
  const anisotropy = Math.min(16, caps.maxAnisotropy ?? 1);
  const cells = Math.round(tile / STONE);
  const coarse = stones(size, cells, 41);
  const fine = stones(size, cells * 2, 47);
  const grain = valueField(size, { seed: 42, cells: size / 2, octaves: 1 });
  const mottle = valueField(size, { seed: 43, cells: Math.round(tile / 0.24), octaves: 3 });

  const count = size * size;
  const surface = new Float32Array(count * 4);
  const height = new Float32Array(count);
  const top = new Float32Array(count);
  let toneSum = 0;
  for (let i = 0; i < count; i++) {
    // a stone's top: flat, its shoulders rounded off into the gap; one stone in seven lies low, under the binder
    const sunk = coarse.a[i] < 0.14;
    const t = smooth(0.02, 0.2, coarse.edge[i]) * (sunk ? 0.25 : 1);
    // the gaps are mastic with fines in it
    const fines = smooth(0.03, 0.22, fine.edge[i]) * (0.4 + 0.6 * fine.a[i]);
    const gap = 0.1 + 0.26 * fines;
    const stand = 0.52 + 0.48 * coarse.a[i];
    const h = gap + (stand - gap) * t + 0.06 * (grain[i] - 0.5);
    top[i] = t;
    height[i] = h;
    const binder = 0.13 + 0.14 * fines * fine.b[i];
    const tone = binder + (0.42 + 0.58 * coarse.b[i] - binder) * Math.pow(t, 0.7) + 0.08 * (grain[i] - 0.5);
    toneSum += tone;
    surface[i * 4] = tone;
    surface[i * 4 + 1] = h;
    // bitumen is glossy but pitted; a worn stone is as smooth as its mineral lets it be
    surface[i * 4 + 2] = 0.3 + (0.25 + 0.75 * coarse.c[i] - 0.3) * t;
    surface[i * 4 + 3] = mottle[i];
  }
  // the tone averages one half, so that the shader's colours are the asphalt's mean colours
  const toneScale = 0.5 / (toneSum / count);
  for (let i = 0; i < count; i++) surface[i * 4] *= toneScale;

  // the normals: the height's slopes plus each stone's own tilt, then every mip level with what it averaged away
  const slope = (DEPTH * EXAGGERATE * size) / tile / 2; // central difference over two texels, as a true slope
  const moments = new Float32Array(count * 4); // nx, ny, nz, nx^2 + ny^2
  for (let y = 0; y < size; y++) {
    const up = ((y + 1) % size) * size;
    const down = ((y + size - 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      const right = y * size + ((x + 1) % size);
      const left = y * size + ((x + size - 1) % size);
      const sx = -(height[right] - height[left]) * slope + (coarse.b[o] - 0.5) * 2 * FACET * top[o];
      const sy = -(height[up + x] - height[down + x]) * slope + (coarse.c[o] - 0.5) * 2 * FACET * top[o];
      const inv = 1 / Math.sqrt(sx * sx + sy * sy + 1);
      moments[o * 4] = sx * inv;
      moments[o * 4 + 1] = sy * inv;
      moments[o * 4 + 2] = inv;
      moments[o * 4 + 3] = (sx * sx + sy * sy) * inv * inv;
    }
  }
  const reliefLevels = chain(moments, size).map(({ data, size: s }) => {
    const out = new Float32Array(data.length);
    for (let i = 0; i < s * s; i++) {
      const nx = data[i * 4];
      const ny = data[i * 4 + 1];
      const nz = data[i * 4 + 2];
      const inv = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
      out[i * 4] = nx * inv * 0.5 + 0.5;
      out[i * 4 + 1] = ny * inv * 0.5 + 0.5;
      out[i * 4 + 2] = nz * inv * 0.5 + 0.5;
      out[i * 4 + 3] = Math.max(0, data[i * 4 + 3] - (nx * nx + ny * ny)) * VARIANCE_GAIN;
    }
    return { data: out, size: s };
  });

  const bs = 256;
  const big = fieldTexture(
    bs,
    [
      // r tone and where the aggregate lookups change over, g cells whose borders are cracks, b wear, a dips
      valueField(bs, { seed: 51, cells: 8, octaves: 4 }),
      worleyField(bs, { seed: 52, cells: 7, mode: 'edge' }),
      valueField(bs, { seed: 53, cells: 16, octaves: 3 }),
      valueField(bs, { seed: 54, cells: 10, octaves: 3 }),
    ],
    { anisotropy },
  );

  const textures = {
    surface: levelsTexture(chain(surface, size), anisotropy),
    relief: levelsTexture(reliefLevels, anisotropy),
    big,
    tile,
    bytes: Math.round(((2 * size * size + bs * bs) * 4 * 4) / 3),
    ms: 0,
  };
  textures.ms = Math.round(performance.now() - started);
  made.set(tier, textures);
  return textures;
}

/** Frees every tier's textures (the world is going away). */
export function disposeRoadTextures() {
  for (const t of made.values()) {
    t.surface.dispose();
    t.relief.dispose();
    t.big.dispose();
  }
  made.clear();
}
