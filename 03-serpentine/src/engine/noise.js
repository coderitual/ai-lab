// Tileable noise made on the CPU, once, at start-up: as plain arrays and as
// textures. The asphalt, the bark, the rock and the paint's flakes are all
// mixed from these.
//
// A "field" is a Float32Array of size * size values in 0..1, row by row
// (index = y * size + x). Every generator wraps at the edges, so a texture
// made from a field repeats without a seam, and every one is seeded: the same
// arguments give the same numbers on every machine (integer hashing, no
// Math.random). Mix fields with ordinary loops, then hand them to
// fieldTexture() or normalTexture().

import * as THREE from 'three';

/** Integer hash of a lattice point -> [0, 1). */
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Sums `octaves` layers of `layer(cells, seed, out, amplitude)`, each with
 * `lacunarity` times the cells and `gain` times the weight of the one before.
 */
function fractal(size, { seed = 1, cells = 8, octaves = 1, lacunarity = 2, gain = 0.5 }, layer) {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  let n = Math.min(size, Math.max(1, Math.round(cells)));
  for (let o = 0; o < Math.max(1, octaves) && n <= size; o++) {
    layer(n, seed + o * 131, out, amplitude);
    total += amplitude;
    amplitude *= gain;
    // whole numbers of cells only: anything else would not wrap
    n *= Math.max(2, Math.round(lacunarity));
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Value noise: random values on a lattice of `cells` x `cells`, smoothly
 * interpolated. Soft blobs; several octaves give clouds, stains, patchiness.
 * @param {number} size
 * @param {{ seed?: number, cells?: number, octaves?: number, lacunarity?: number, gain?: number }} [options]
 * @returns {Float32Array}
 */
export function valueField(size, options = {}) {
  return fractal(size, options, (cells, seed, out, amplitude) => {
    const lattice = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lattice[j * cells + i] = hash2(i, j, seed);
    for (let y = 0; y < size; y++) {
      const v = (y / size) * cells;
      const j0 = Math.floor(v);
      const j1 = (j0 + 1) % cells;
      const fy = v - j0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const u = (x / size) * cells;
        const i0 = Math.floor(u);
        const i1 = (i0 + 1) % cells;
        const fx = u - i0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = lattice[j0 * cells + i0];
        const b = lattice[j0 * cells + i1];
        const c = lattice[j1 * cells + i0];
        const d = lattice[j1 * cells + i1];
        out[y * size + x] += amplitude * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  });
}

/**
 * Gradient (Perlin) noise: random slopes on the lattice instead of random
 * values. Smoother and less blocky than value noise; the usual choice for
 * relief (bumps, waviness). The result is centred on 0.5.
 * @param {number} size
 * @param {{ seed?: number, cells?: number, octaves?: number, lacunarity?: number, gain?: number }} [options]
 * @returns {Float32Array}
 */
export function gradientField(size, options = {}) {
  return fractal(size, options, (cells, seed, out, amplitude) => {
    const gx = new Float32Array(cells * cells);
    const gy = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const angle = hash2(i, j, seed) * Math.PI * 2;
        gx[j * cells + i] = Math.cos(angle);
        gy[j * cells + i] = Math.sin(angle);
      }
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    for (let y = 0; y < size; y++) {
      const v = (y / size) * cells;
      const j0 = Math.floor(v);
      const j1 = (j0 + 1) % cells;
      const fy = v - j0;
      const sy = fade(fy);
      for (let x = 0; x < size; x++) {
        const u = (x / size) * cells;
        const i0 = Math.floor(u);
        const i1 = (i0 + 1) % cells;
        const fx = u - i0;
        const sx = fade(fx);
        const k00 = j0 * cells + i0;
        const k10 = j0 * cells + i1;
        const k01 = j1 * cells + i0;
        const k11 = j1 * cells + i1;
        const a = gx[k00] * fx + gy[k00] * fy;
        const b = gx[k10] * (fx - 1) + gy[k10] * fy;
        const c = gx[k01] * fx + gy[k01] * (fy - 1);
        const d = gx[k11] * (fx - 1) + gy[k11] * (fy - 1);
        // Perlin noise in 2D stays within +-0.7071
        out[y * size + x] += amplitude * (0.5 + 0.7071 * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy));
      }
    }
  });
}

/**
 * Worley (cellular) noise: one point scattered in each of `cells` x `cells`
 * squares; every pixel looks for the points nearest to it.
 *
 *   mode 'f1'    distance to the nearest point: round grains, pebbles (dark at each point)
 *   mode 'f2'    distance to the second nearest
 *   mode 'edge'  f2 - f1: zero along the borders between cells: cracks, mortar, plates of bark
 *   mode 'id'    one random value for the whole cell: flakes, stones of different shade
 *                (`salt` gives a second, independent value for the same cells)
 *
 * Distances are in cells and clamped to 0..1. `jitter` 0 puts the points on a
 * regular grid, 1 lets them be anywhere in their square.
 * @param {number} size
 * @param {{ seed?: number, cells?: number, jitter?: number, mode?: 'f1'|'f2'|'edge'|'id', salt?: number }} [options]
 * @returns {Float32Array}
 */
export function worleyField(size, { seed = 1, cells = 8, jitter = 1, mode = 'f1', salt = 0 } = {}) {
  const n = Math.max(1, Math.round(cells));
  const px = new Float32Array(n * n);
  const py = new Float32Array(n * n);
  const id = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      px[j * n + i] = 0.5 + (hash2(i, j, seed) - 0.5) * jitter;
      py[j * n + i] = 0.5 + (hash2(i, j, seed + 59) - 0.5) * jitter;
      id[j * n + i] = hash2(i, j, seed + 977 + salt * 31);
    }
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * n;
    const cj = Math.floor(v);
    for (let x = 0; x < size; x++) {
      const u = (x / size) * n;
      const ci = Math.floor(u);
      let f1 = Infinity;
      let f2 = Infinity;
      let nearest = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const k = ((cj + dj + n) % n) * n + ((ci + di + n) % n);
          const dx = ci + di + px[k] - u;
          const dy = cj + dj + py[k] - v;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
            nearest = k;
          } else if (d < f2) f2 = d;
        }
      }
      let value;
      if (mode === 'id') value = id[nearest];
      else if (mode === 'f2') value = Math.sqrt(f2);
      else if (mode === 'edge') value = Math.sqrt(f2) - Math.sqrt(f1);
      else value = Math.sqrt(f1);
      out[y * size + x] = value > 1 ? 1 : value;
    }
  }
  return out;
}

/**
 * The surface normals of a height field, as size * size * 3 numbers (x, y, z
 * of a unit vector, z out of the surface, y toward increasing row).
 *
 * `relief` says how tall the field is: its full range 0..1 stands for a
 * height of `relief` texture widths. 0.02 is a gentle bump, 0.2 is rugged.
 * Because it is a ratio, a texture keeps its look when its size changes.
 *
 * @param {Float32Array} height
 * @param {number} size
 * @param {number} [relief]
 * @returns {Float32Array}
 */
export function heightToNormals(height, size, relief = 0.05) {
  const out = new Float32Array(size * size * 3);
  const k = relief * size * 0.5; // central difference over two texels, in texture widths
  for (let y = 0; y < size; y++) {
    const up = ((y + 1) % size) * size;
    const down = ((y + size - 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const right = (x + 1) % size;
      const left = (x + size - 1) % size;
      const nx = -(height[y * size + right] - height[y * size + left]) * k;
      const ny = -(height[up + x] - height[down + x]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * size + x) * 3;
      out[o] = nx * inv;
      out[o + 1] = ny * inv;
      out[o + 2] = inv;
    }
  }
  return out;
}

/** Halves an image of `channels` bytes per pixel by averaging 2 x 2 blocks. */
function halve(data, size, channels) {
  const half = size >> 1;
  const out = new Uint8Array(half * half * channels);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const a = (y * 2 * size + x * 2) * channels;
      const b = a + channels;
      const c = a + size * channels;
      const d = c + channels;
      const o = (y * half + x) * channels;
      for (let k = 0; k < channels; k++) out[o + k] = (data[a + k] + data[b + k] + data[c + k] + data[d + k] + 2) >> 2;
    }
  }
  return out;
}

const FORMATS = { 1: THREE.RedFormat, 2: THREE.RGFormat, 4: THREE.RGBAFormat };

/**
 * @typedef {object} NoiseTextureOptions
 * @property {boolean} [mipmaps] a full mip chain, averaged here (default true). The chain is made on the CPU and
 *   not by the GPU so that it is the same everywhere, and so that normals are averaged as vectors.
 * @property {boolean} [repeat] wraps (default true)
 * @property {number} [anisotropy] default 1; pass caps.maxAnisotropy for ground seen at a grazing angle
 */

/** Wraps bytes in a DataTexture. `size` must be a power of two if mipmaps are wanted. */
function bytesTexture(data, size, channels, { mipmaps = true, repeat = true, anisotropy = 1 } = {}) {
  const texture = new THREE.DataTexture(data, size, size, FORMATS[channels], THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if (mipmaps && (size & (size - 1)) === 0) {
    const levels = [{ data, width: size, height: size }];
    for (let s = size; s > 1; s >>= 1) {
      const last = levels[levels.length - 1];
      levels.push({ data: halve(last.data, s, channels), width: s >> 1, height: s >> 1 });
    }
    texture.mipmaps = levels;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
  } else texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Packs one, two or four fields into the channels of an 8-bit texture
 * (three are stored as four, with alpha 1). A number instead of a field
 * fills its channel with that value.
 *
 * @param {number} size
 * @param {Float32Array | Array<Float32Array|number>} fields
 * @param {NoiseTextureOptions} [options]
 * @returns {THREE.DataTexture}
 */
export function fieldTexture(size, fields, options) {
  const list = fields instanceof Float32Array ? [fields] : [...fields];
  if (list.length === 3) list.push(1);
  const channels = list.length;
  const data = new Uint8Array(size * size * channels);
  for (let k = 0; k < channels; k++) {
    const field = list[k];
    const constant = typeof field === 'number' ? Math.round(Math.min(1, Math.max(0, field)) * 255) : -1;
    for (let i = 0; i < size * size; i++) {
      data[i * channels + k] = constant >= 0 ? constant : Math.round(Math.min(1, Math.max(0, field[i])) * 255);
    }
  }
  return bytesTexture(data, size, channels, options);
}

/**
 * A tangent-space normal map of a height field, in the layout three.js's
 * materials expect (rgb = normal * 0.5 + 0.5, green up), with the height
 * itself in alpha: one texture gives the relief and, say, where water would
 * collect. The smaller mip levels hold averaged, shortened normals; three.js
 * normalises after sampling.
 *
 * @param {number} size
 * @param {Float32Array} height
 * @param {NoiseTextureOptions & { relief?: number }} [options] `relief` as in heightToNormals()
 * @returns {THREE.DataTexture}
 */
export function normalTexture(size, height, options = {}) {
  const normals = heightToNormals(height, size, options.relief);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((normals[i * 3] * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((normals[i * 3 + 1] * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((normals[i * 3 + 2] * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, height[i])) * 255);
  }
  return bytesTexture(data, size, 4, options);
}
