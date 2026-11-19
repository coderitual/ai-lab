// The shore map: what the water's shader needs to know about the coast, at
// half the sea map's texel (terrain.js writes the sea map: 9.4 m a texel,
// from the land's coarse shape; good for the ground's coastal colours, too
// coarse for a line of surf three metres from the sand).
//
// Nothing here decides where the water is: that is the land's own height
// function (`heightAt`, what the terrain's mesh is made from) against the
// sea's level (terrain.sea). The map only writes it down, per texel:
//
//   r  depth of the bed under the still water (m; 0 on land)
//   g  distance to the shoreline (m): positive out on the water, negative on
//      the land for a few metres, so that it runs smoothly through the
//      water's edge; found by a chamfer transform that starts from where the
//      bed crosses the water's level BETWEEN two texels, not from texel
//      centres
//   b  height of the land over the water (m; 0 on the water): what stands in
//      the water's reflection. Its smaller mip levels hold the HIGHEST land of
//      the texels they cover, so that one sample of a coarse level answers
//      "does anything in this stretch stand this tall" (sea.js marches the
//      mirrored ray through them)
//   a  how much the bed is sand (1) rather than rock (0): by how steeply it
//      shelves
//
// The height function is asked only near the shoreline (within `near` m of
// it, by the sea map's own distances) and on every fourth texel elsewhere
// (the land's height for reflections; the deep bed is the sea map's): a
// tenth of the calls a full grid would take.
//
// Pure JavaScript (no three.js): tools/unit/sea.test.mjs runs it in Node.

/** The ranges the 8-bit channels cover, shared with the shader's decoding (SHORE_GLSL in sea.js). */
export const SHORE = {
  /** deepest depth told apart (m); stored as a square root, so the first metre has 30 steps */
  depth: 64,
  /** farthest distance from the shore told apart (m), and how far onto the land it goes on (m) */
  reach: 160,
  inland: 6,
  /** highest land told apart (m); a square root too: the first 30 cm over the water have seven steps */
  land: 400,
  /** the bed is sand where it falls less than `sand[0]` m per m, rock where more than `sand[1]` */
  sand: [0.16, 0.42],
  /** the height function is asked within this many metres of the shoreline */
  near: 70,
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Decoding, as the shader does it: metres from a channel's 0..1. */
export const shoreDecode = {
  depth: (v) => SHORE.depth * v * v,
  shore: (v) => (SHORE.reach + SHORE.inland) * v * v - SHORE.inland,
  land: (v) => SHORE.land * v * v,
};
const encode = {
  depth: (m) => Math.sqrt(Math.min(1, Math.max(0, m) / SHORE.depth)),
  shore: (m) => Math.sqrt(Math.min(1, Math.max(0, m + SHORE.inland) / (SHORE.reach + SHORE.inland))),
  land: (m) => Math.sqrt(Math.min(1, Math.max(0, m) / SHORE.land)),
};

/**
 * @typedef {object} ShoreMap
 * @property {number} size texels a side
 * @property {number} x0 @property {number} z0 the corner of the box (m) @property {number} extent its width (m)
 * @property {Uint8Array[]} levels RGBA texels, the full size first, then each mip level down to 1 x 1
 * @property {{ asked: number, shoreTexels: number }} stats how often the height function was asked; water texels
 *   beside land
 */

/**
 * @param {object} options
 * @param {import('./terrain.js').SeaShape} options.sea the sea (terrain.sea): its level, and the sea map, whose box
 *   this map shares and whose distances say where the shore is near
 * @param {(x: number, z: number) => number} options.heightAt the land's height (terrain.heightAt)
 * @param {number} [options.size] texels a side (a power of two)
 * @returns {ShoreMap}
 */
export function bakeShoreMap({ sea, heightAt, size = 1024 }) {
  const coarse = sea.map;
  const { x0, z0, extent } = coarse;
  const step = extent / size;
  const n = size * size;
  const level = sea.level;

  // the sea map, read as the shader reads it (bilinear between texel centres)
  const coarseAt = (x, z, channel) => {
    const u = Math.min(coarse.size - 1, Math.max(0, ((x - x0) / extent) * coarse.size - 0.5));
    const v = Math.min(coarse.size - 1, Math.max(0, ((z - z0) / extent) * coarse.size - 0.5));
    const i = Math.min(coarse.size - 2, Math.floor(u));
    const j = Math.min(coarse.size - 2, Math.floor(v));
    const fu = u - i;
    const fv = v - j;
    const k = (j * coarse.size + i) * 4 + channel;
    const row = coarse.size * 4;
    const d = coarse.data;
    return ((d[k] * (1 - fu) + d[k + 4] * fu) * (1 - fv) + (d[k + row] * (1 - fu) + d[k + row + 4] * fu) * fv) / 255;
  };

  // ---- the bed and the land, in metres over the water's level (negative: under it)
  const height = new Float32Array(n);
  const wet = new Uint8Array(n);
  let asked = 0;
  // the land's height on every fourth texel, for everything far from the shore
  const sparse = 4;
  const ss = size / sparse + 1;
  const far = new Float32Array(ss * ss);
  const farKnown = new Uint8Array(ss * ss);
  const farAt = (i, j) => {
    const k = j * ss + i;
    if (!farKnown[k]) {
      far[k] = heightAt(x0 + i * sparse * step, z0 + j * sparse * step) - level;
      farKnown[k] = 1;
      asked++;
    }
    return far[k];
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = x0 + (i + 0.5) * step;
      const z = z0 + (j + 0.5) * step;
      const k = j * size + i;
      const toLand = 160 * coarseAt(x, z, 2);
      const toWater = 500 * coarseAt(x, z, 1);
      let h;
      if (toLand < SHORE.near && toWater < SHORE.near) {
        h = heightAt(x, z) - level;
        asked++;
        // towards the end of the band the bed eases into the sea map's own depth (no step in the water's colour)
        const out = smoothstep(0.65 * SHORE.near, SHORE.near, toLand);
        if (out > 0 && h < 0) {
          const d = coarseAt(x, z, 0);
          h += (-64 * d * d - h) * out;
        }
      } else if (toWater <= 0) {
        // open water far from any shore: the sea map's own depth
        const d = coarseAt(x, z, 0);
        h = -64 * d * d;
      } else {
        // land far from the water: the sparse grid, bilinear
        const u = (i + 0.5) / sparse;
        const v = (j + 0.5) / sparse;
        const iu = Math.min(ss - 2, Math.floor(u));
        const jv = Math.min(ss - 2, Math.floor(v));
        const fu = u - iu;
        const fv = v - jv;
        h = (farAt(iu, jv) * (1 - fu) + farAt(iu + 1, jv) * fu) * (1 - fv) + (farAt(iu, jv + 1) * (1 - fu) + farAt(iu + 1, jv + 1) * fu) * fv;
      }
      height[k] = h;
      // water is wherever the land lies under the level: the water is one level surface drawn everywhere, and the
      // terrain keeps every hollow that is not the sea's above it (keepDry)
      wet[k] = h < 0 ? 1 : 0;
    }
  }

  // ---- distance to the shoreline, signed: a chamfer transform from the crossings between wet and dry neighbours
  const BIG = 1e9;
  const toShore = new Float32Array(n).fill(BIG);
  let shoreTexels = 0;
  const crossing = (k, q) => {
    // the bed is taken to run straight between the two texel centres: where it meets the water's level
    const a = Math.abs(height[k]);
    const b = Math.max(0.02, Math.abs(height[q]));
    return (step * a) / (a + b);
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let d = BIG;
      if (i > 0 && wet[k - 1] !== wet[k]) d = Math.min(d, crossing(k, k - 1));
      if (i < size - 1 && wet[k + 1] !== wet[k]) d = Math.min(d, crossing(k, k + 1));
      if (j > 0 && wet[k - size] !== wet[k]) d = Math.min(d, crossing(k, k - size));
      if (j < size - 1 && wet[k + size] !== wet[k]) d = Math.min(d, crossing(k, k + size));
      if (d < BIG) {
        toShore[k] = d;
        if (wet[k]) shoreTexels++;
      }
    }
  }
  {
    const a = step;
    const b = step * Math.SQRT2;
    const f = toShore;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i;
        let v = f[k];
        if (i > 0) v = Math.min(v, f[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, f[k - size] + a);
          if (i > 0) v = Math.min(v, f[k - size - 1] + b);
          if (i < size - 1) v = Math.min(v, f[k - size + 1] + b);
        }
        f[k] = v;
      }
    }
    for (let j = size - 1; j >= 0; j--) {
      for (let i = size - 1; i >= 0; i--) {
        const k = j * size + i;
        let v = f[k];
        if (i < size - 1) v = Math.min(v, f[k + 1] + a);
        if (j < size - 1) {
          v = Math.min(v, f[k + size] + a);
          if (i < size - 1) v = Math.min(v, f[k + size + 1] + b);
          if (i > 0) v = Math.min(v, f[k + size - 1] + b);
        }
        f[k] = v;
      }
    }
  }

  // ---- how much the bed is sand: by its fall, smoothed over the neighbours (a beach is sand, a cliff's foot rock)
  const sand = new Float32Array(n);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const il = Math.max(0, i - 1);
      const ir = Math.min(size - 1, i + 1);
      const jl = Math.max(0, j - 1);
      const jr = Math.min(size - 1, j + 1);
      const gx = (height[j * size + ir] - height[j * size + il]) / ((ir - il) * step);
      const gz = (height[jr * size + i] - height[jl * size + i]) / ((jr - jl) * step);
      sand[k] = 1 - smoothstep(SHORE.sand[0], SHORE.sand[1], Math.hypot(gx, gz));
    }
  }

  const base = new Uint8Array(n * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let s = 0;
      let w = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const q = Math.min(size - 1, Math.max(0, j + dj)) * size + Math.min(size - 1, Math.max(0, i + di));
          s += sand[q];
          w++;
        }
      }
      const h = height[k];
      base[k * 4] = Math.round(255 * encode.depth(wet[k] ? -h : 0));
      base[k * 4 + 1] = Math.round(255 * encode.shore(wet[k] ? toShore[k] : -toShore[k]));
      base[k * 4 + 2] = Math.round(255 * encode.land(wet[k] ? 0 : h));
      base[k * 4 + 3] = Math.round((255 * s) / w);
    }
  }

  // ---- the mip levels: means of depth, distance and sand; the HIGHEST land
  const levels = [base];
  for (let s = size; s > 1; s >>= 1) {
    const from = levels[levels.length - 1];
    const half = s >> 1;
    const to = new Uint8Array(half * half * 4);
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        const a = (2 * j * s + 2 * i) * 4;
        const b = a + 4;
        const c = a + s * 4;
        const d = c + 4;
        const k = (j * half + i) * 4;
        to[k] = (from[a] + from[b] + from[c] + from[d] + 2) >> 2;
        to[k + 1] = (from[a + 1] + from[b + 1] + from[c + 1] + from[d + 1] + 2) >> 2;
        to[k + 2] = Math.max(from[a + 2], from[b + 2], from[c + 2], from[d + 2]);
        to[k + 3] = (from[a + 3] + from[b + 3] + from[c + 3] + from[d + 3] + 2) >> 2;
      }
    }
    levels.push(to);
  }

  return { size, x0, z0, extent, levels, stats: { asked, shoreTexels } };
}

/**
 * The map read at a point as the shader reads its finest level (bilinear), decoded to metres: for tests and tools.
 * @param {ShoreMap} map @param {number} x @param {number} z
 * @returns {{ depth: number, shore: number, land: number, sand: number }}
 */
export function shoreAt(map, x, z) {
  const { size, x0, z0, extent } = map;
  const data = map.levels[0];
  const u = Math.min(size - 1, Math.max(0, ((x - x0) / extent) * size - 0.5));
  const v = Math.min(size - 1, Math.max(0, ((z - z0) / extent) * size - 0.5));
  const i = Math.min(size - 2, Math.floor(u));
  const j = Math.min(size - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const at = (c) => {
    const k = (j * size + i) * 4 + c;
    const row = size * 4;
    return ((data[k] * (1 - fu) + data[k + 4] * fu) * (1 - fv) + (data[k + row] * (1 - fu) + data[k + row + 4] * fu) * fv) / 255;
  };
  return { depth: shoreDecode.depth(at(0)), shore: shoreDecode.shore(at(1)), land: shoreDecode.land(at(2)), sand: at(3) };
}
