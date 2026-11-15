// Procedural, seamlessly tiling textures generated on the CPU at startup.
// No image files: everything the shaders sample is built here.

import * as THREE from 'three';
import { makeRng } from '../engine/math.js';

/** Tileable smooth value noise with the given lattice period. */
function makePeriodicNoise(period, rng) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % period) + period) % period;
    const y0 = ((iy % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/** Tileable fractal noise sampled on a size×size grid. Returns Float32Array in [0,1]. */
function tileableFbm(size, basePeriod, octaves, rng, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const period = basePeriod << o;
    const n = makePeriodicNoise(period, rng);
    const s = period / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[y * size + x] += amp * n(x * s, y * s);
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Tileable cellular noise. Returns F2 - F1 (thin bright "veins" between cells). */
function tileableCells(size, cells, rng) {
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) {
    px[i] = rng();
    py[i] = rng();
  }
  const out = new Float32Array(size * size);
  const s = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const fy = y * s;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % cells) + cells) % cells;
          const wy = ((gy % cells) + cells) % cells;
          const dx = gx + px[wy * cells + wx] - fx;
          const dy = gy + py[wy * cells + wx] - fy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      out[y * size + x] = f2 - f1;
    }
  }
  return out;
}

function finishDataTexture(tex, anisotropy = 1) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * RGBA noise atlas:
 *   R  soft fractal noise (clouds, large-scale variation)
 *   G  foam "veins" (cellular)
 *   B  fine fractal noise (foam break-up, sparkle)
 *   A  medium cellular blobs (spray, bubbles)
 */
export function makeNoiseTexture(size = 256, anisotropy = 1) {
  const rng = makeRng(20241);
  const soft = tileableFbm(size, 4, 5, rng, 0.55);
  const veinsA = tileableCells(size, 9, rng);
  const veinsB = tileableCells(size, 21, rng);
  const fine = tileableFbm(size, 16, 4, rng, 0.6);
  const blobs = tileableCells(size, 14, rng);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // Veins: bright where F2-F1 is small (cell borders).
    const v = Math.max(1 - veinsA[i] * 2.6, 0) * 0.65 + Math.max(1 - veinsB[i] * 3.0, 0) * 0.35;
    data[i * 4] = Math.round(Math.min(Math.max(soft[i], 0), 1) * 255);
    data[i * 4 + 1] = Math.round(Math.min(Math.max(v * v, 0), 1) * 255);
    data[i * 4 + 2] = Math.round(Math.min(Math.max(fine[i], 0), 1) * 255);
    data[i * 4 + 3] = Math.round(Math.min(Math.max(blobs[i] * 1.6, 0), 1) * 255);
  }
  return finishDataTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), anisotropy);
}

/** Tileable ripple normal map (xy in RG, the height in B). */
export function makeWaterNormalTexture(size = 256, anisotropy = 4) {
  const rng = makeRng(7719);
  const h = tileableFbm(size, 8, 5, rng, 0.58);
  const data = new Uint8Array(size * size * 4);
  const strength = 9.0;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(at(x, y) * 255);
      data[i + 3] = 255;
    }
  }
  return finishDataTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), anisotropy);
}

/**
 * Tileable caustics: the net of bright lines that sunlight draws under a
 * rippled surface. Made the way the real thing is made: a grid of rays is bent
 * by the slopes of a (periodic) ripple field and collected where it lands.
 * Where neighbouring rays cross, light piles up into lines.
 * Single channel; around 0.3 in the open cells, 1 on the lines.
 */
export function makeCausticTexture(size = 256, raysPerTexel = 3) {
  const rng = makeRng(4242);
  const TAU = Math.PI * 2;
  // the ripple field: sines with a whole number of cycles per tile, so it repeats seamlessly
  const ripples = [];
  while (ripples.length < 16) {
    const kx = Math.round((rng() * 2 - 1) * 7);
    const ky = Math.round((rng() * 2 - 1) * 7);
    const k = Math.hypot(kx, ky);
    if (k < 1.5 || k > 7.5) continue;
    ripples.push({ kx: kx * TAU, ky: ky * TAU, amp: 1 / Math.pow(k, 1.25), phase: rng() * TAU });
  }
  // how far below the surface the light is caught: far enough that rays start to cross
  let curvature = 0;
  for (const w of ripples) curvature += (w.amp * (w.kx * w.kx + w.ky * w.ky)) ** 2 / 2;
  const depth = 1.1 / Math.sqrt(curvature);

  const rays = size * raysPerTexel;
  const light = new Float32Array(size * size);
  for (let j = 0; j < rays; j++) {
    const y = (j + 0.5) / rays;
    for (let i = 0; i < rays; i++) {
      const x = (i + 0.5) / rays;
      let gx = 0;
      let gy = 0;
      for (let n = 0; n < ripples.length; n++) {
        const w = ripples[n];
        const c = Math.cos(w.kx * x + w.ky * y + w.phase) * w.amp;
        gx += c * w.kx;
        gy += c * w.ky;
      }
      // where this ray lands (wrapping round the tile), shared between the four texels there
      const u = (x + gx * depth) * size - 0.5;
      const v = (y + gy * depth) * size - 0.5;
      const u0 = Math.floor(u);
      const v0 = Math.floor(v);
      const fu = u - u0;
      const fv = v - v0;
      const a = ((u0 % size) + size) % size;
      const b = (a + 1) % size;
      const c0 = ((v0 % size) + size) % size;
      const d = (c0 + 1) % size;
      light[c0 * size + a] += (1 - fu) * (1 - fv);
      light[c0 * size + b] += fu * (1 - fv);
      light[d * size + a] += (1 - fu) * fv;
      light[d * size + b] += fu * fv;
    }
  }
  const data = new Uint8Array(size * size);
  const perTexel = 1 / (raysPerTexel * raysPerTexel);
  for (let i = 0; i < light.length; i++) data[i] = Math.round(Math.min(1, Math.pow(light[i] * perTexel, 0.85) * 0.36) * 255);
  return finishDataTexture(new THREE.DataTexture(data, size, size, THREE.RedFormat), 2);
}

/** Soft round sprite with a bright core (spray droplets, light glows). */
export function makeGlowTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Draw crisp text/graphics into a texture.
 * `draw(ctx, w, h)` paints the canvas; returns an sRGB CanvasTexture.
 */
export function makeCanvasTexture(w, h, draw, anisotropy = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}
