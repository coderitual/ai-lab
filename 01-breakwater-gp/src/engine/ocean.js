// The sea as a spectrum.
//
// A real sea is thousands of wave trains at once, of every length and from a
// spread of directions, each with the amount of energy the wind has put into
// it. That distribution is a spectrum; an inverse Fourier transform turns it
// into a surface (Tessendorf, "Simulating Ocean Water"). Each wave also moves
// the water sideways, toward its crest, which is what makes crests peaked and
// troughs flat; where that sideways motion folds the surface over itself is
// where a real wave breaks, and so where foam belongs.
//
// The transform is too slow to run every frame in a browser, and it does not
// have to: if every wave's frequency is rounded to a whole number of cycles
// per PERIOD, the whole sea repeats exactly, and one period of it can be made
// once, when the game loads, as a stack of frames. The sea is then a table
// looked up at (x, z, time): the physics reads the same numbers the picture
// is drawn from, it is the same on every machine (the random numbers are
// seeded), and its past is as cheap to ask about as its present.
//
// To hide that a square patch of sea repeats, there are several such tables
// ("cascades"), each for its own band of wavelengths, on tiles of very
// different size and with periods that do not divide one another.

import { makeRng } from './math.js';
import { synthesize2d } from './fft.js';

const G = 9.81;
const TAU = Math.PI * 2;
/** How long the mark of a breaking crest takes to fade to a third (s). */
const LINGER = 3.0;

/**
 * How much energy waves of angular frequency `omega` carry (the JONSWAP form: a wind sea that is still growing,
 * with a sharp peak at `peak`). Only its shape matters here: the height is set afterwards, by measurement.
 */
function energyAt(omega, peak, sharpness, tail) {
  const sigma = omega <= peak ? 0.07 : 0.09;
  const r = Math.exp(-((omega - peak) * (omega - peak)) / (2 * sigma * sigma * peak * peak));
  return (Math.exp(-1.25 * Math.pow(peak / omega, 4)) / Math.pow(omega, tail)) * Math.pow(sharpness, r);
}

/**
 * How waves of a frequency are spread round the wind's direction: cos^2s of half the angle off it. Long waves near
 * the peak run nearly parallel (trains of swell); short ones come from everywhere downwind.
 */
function spreadPower(omega, peak, narrow) {
  const x = omega / peak;
  return Math.max(1, narrow * (x < 1 ? Math.pow(x, 5) : Math.pow(x, -2.5)));
}
const spreadNorm = new Map();
/** 1 / (the integral of cos^2s(theta / 2) round the circle), so that spreading moves energy about without adding any. */
function spreadScale(s) {
  const key = Math.round(s * 8) / 8;
  let v = spreadNorm.get(key);
  if (v === undefined) {
    let sum = 0;
    const steps = 720;
    for (let i = 0; i < steps; i++) sum += Math.pow(Math.abs(Math.cos(((i + 0.5) / steps - 0.5) * Math.PI)), 2 * key);
    v = 1 / ((sum / steps) * TAU);
    spreadNorm.set(key, v);
  }
  return v;
}

/**
 * Make one cascade.
 * @returns {{ size: number, n: number, period: number, frames: number, band: [number, number], variance: number,
 *   disp: Float32Array, deriv: Float32Array }}
 *   `disp` holds, for every frame and grid point, [sideways x, height, sideways z, squeeze lately];
 *   `deriv` holds [d(height)/dx, d(height)/dz, squeeze, fold].
 *   "Squeeze" is how fast the sideways motion is drawing the surface together (minus its divergence: most at a
 *   crest); "fold" is the second-order part of the same (the determinant of the sideways motion's gradient), so
 *   that for choppiness c the surface's Jacobian is 1 - c squeeze + c^2 fold: 1 untouched, 0 folding over.
 *   "Squeeze lately" is the most the surface has been squeezed here in the last few seconds, fading and spreading
 *   as it ages: where a crest has just broken, and so where its foam still lies.
 *   All for unit choppiness and before `scale` (see makeOcean); `variance` is that of the height.
 */
function makeCascade({ size, n, period, frames, band }, { peak, sharpness, tail, narrow, dirX, dirZ, seed }) {
  const cells = n * n;
  const rng = makeRng(seed);
  const dk = TAU / size;
  const w0 = TAU / period;
  const kLo = TAU / band[1];
  const kHi = TAU / band[0];
  // ---- the waves: for each grid point, how big, which way, how fast
  const ar = new Float64Array(cells); // amplitude at time 0 (real, imaginary)
  const ai = new Float64Array(cells);
  const kx = new Float64Array(cells);
  const kz = new Float64Array(cells);
  const kk = new Float64Array(cells);
  const turns = new Int32Array(cells); // cycles per period
  let variance = 0;
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const i = b * n + a;
      // (draw the random pair for every point, used or not, so that a band's waves do not depend on its limits)
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      const x = (a < n / 2 ? a : a - n) * dk;
      const z = (b < n / 2 ? b : b - n) * dk;
      const k = Math.hypot(x, z);
      kx[i] = x;
      kz[i] = z;
      kk[i] = k;
      // (nothing at the grid's own limit: a wave there is its own mirror image)
      if (k < kLo || k >= kHi || k === 0 || a === n / 2 || b === n / 2) continue;
      const omega = Math.sqrt(G * k);
      turns[i] = Math.max(1, Math.round(omega / w0));
      const s = spreadPower(omega, peak, narrow);
      const cosHalf = Math.sqrt(Math.max(0, 0.5 + (0.5 * (x * dirX + z * dirZ)) / k));
      const spread = Math.pow(cosHalf, 2 * s) * spreadScale(s);
      // energy per cell of the grid: S(omega) D(theta) (d omega / dk) / k, times the cell's area
      const energy = ((energyAt(omega, peak, sharpness, tail) * spread * (G / (2 * omega))) / k) * dk * dk;
      const amp = Math.sqrt(energy * 0.5);
      const mag = Math.sqrt(-2 * Math.log(u1)) * amp;
      ar[i] = mag * Math.cos(TAU * u2) * Math.SQRT1_2;
      ai[i] = mag * Math.sin(TAU * u2) * Math.SQRT1_2;
      // (averaged over a period, the height's variance is the sum over waves of |a(k)|^2 + |a(-k)|^2)
      variance += 2 * (ar[i] * ar[i] + ai[i] * ai[i]);
    }
  }

  // ---- one period of it, frame by frame
  const cosT = new Float64Array(frames);
  const sinT = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    cosT[f] = Math.cos((TAU * f) / frames);
    sinT[f] = Math.sin((TAU * f) / frames);
  }
  const disp = new Float32Array(frames * cells * 4);
  const deriv = new Float32Array(frames * cells * 4);
  const re = [0, 1, 2, 3].map(() => new Float64Array(cells));
  const im = [0, 1, 2, 3].map(() => new Float64Array(cells));
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const i = b * n + a;
        const j = ((n - b) % n) * n + ((n - a) % n); // the wave going the other way
        if (!turns[i] && !turns[j]) {
          for (let q = 0; q < 4; q++) re[q][i] = im[q][i] = 0;
          continue;
        }
        // h(k, t) = a(k) e^(-i w t) + conj(a(-k)) e^(+i w(-k) t)
        const pi = (turns[i] * f) % frames;
        const pj = (turns[j] * f) % frames;
        const hr = ar[i] * cosT[pi] + ai[i] * sinT[pi] + ar[j] * cosT[pj] + ai[j] * sinT[pj];
        const hi = ai[i] * cosT[pi] - ar[i] * sinT[pi] + ar[j] * sinT[pj] - ai[j] * cosT[pj];
        const x = kx[i];
        const z = kz[i];
        const k = kk[i];
        // sideways x + i sideways z:  ((kz - i kx) / k) h
        re[0][i] = (z * hr + x * hi) / k;
        im[0][i] = (z * hi - x * hr) / k;
        // height + i d(sideways x)/dz:  (1 + i kx kz / k) h
        const xz = (x * z) / k;
        re[1][i] = hr - xz * hi;
        im[1][i] = hi + xz * hr;
        // d(height)/dx + i d(height)/dz:  (i kx - kz) h
        re[2][i] = -x * hi - z * hr;
        im[2][i] = x * hr - z * hi;
        // d(sideways x)/dx + i d(sideways z)/dz:  ((kx^2 + i kz^2) / k) h
        const xx = (x * x) / k;
        const zz = (z * z) / k;
        re[3][i] = xx * hr - zz * hi;
        im[3][i] = xx * hi + zz * hr;
      }
    }
    for (let q = 0; q < 4; q++) synthesize2d(re[q], im[q], n);
    const o = f * cells * 4;
    for (let i = 0; i < cells; i++) {
      disp[o + i * 4] = re[0][i];
      disp[o + i * 4 + 1] = re[1][i];
      disp[o + i * 4 + 2] = im[0][i];
      disp[o + i * 4 + 3] = im[1][i];
      deriv[o + i * 4] = re[2][i];
      deriv[o + i * 4 + 1] = im[2][i];
      deriv[o + i * 4 + 2] = re[3][i];
      deriv[o + i * 4 + 3] = im[3][i];
    }
  }
  // ---- squeeze and fold, in place of the gradient they are made from
  const total = frames * cells;
  for (let i = 0; i < total; i++) {
    const xx = deriv[i * 4 + 2];
    const zz = deriv[i * 4 + 3];
    const xz = disp[i * 4 + 3];
    deriv[i * 4 + 2] = -(xx + zz);
    deriv[i * 4 + 3] = xx * zz - xz * xz;
  }
  // ---- and what a crest leaves behind. Go round the period (twice, so that the start has a past too): each
  // frame keeps the greater of what is being squeezed now and what was there a frame ago, a little spread out and
  // a little faded. The whole period is known, so this memory costs nothing while the game runs.
  const fade = Math.exp(-(period / frames) / LINGER);
  let was = new Float32Array(cells);
  let now = new Float32Array(cells);
  for (let pass = 0; pass < 2; pass++) {
    for (let f = 0; f < frames; f++) {
      const o = f * cells * 4;
      for (let b = 0; b < n; b++) {
        const up = ((b + n - 1) % n) * n;
        const down = ((b + 1) % n) * n;
        for (let a = 0; a < n; a++) {
          const left = (a + n - 1) % n;
          const right = (a + 1) % n;
          const i = b * n + a;
          const spread = was[i] * 0.6 + (was[b * n + left] + was[b * n + right] + was[up + a] + was[down + a]) * 0.1;
          now[i] = Math.max(deriv[o + i * 4 + 2], spread * fade);
          if (pass) disp[o + i * 4 + 3] = now[i];
        }
      }
      [was, now] = [now, was];
    }
  }
  return { size, n, period, frames, band, variance, disp, deriv };
}

/**
 * Make a sea.
 * @param {object} o
 * @param {number} o.height     significant wave height wanted (m): four times the standard deviation of the surface,
 *                              about the mean height of the highest third of the waves
 * @param {number} o.peakLength wavelength that carries the most energy (m)
 * @param {number} [o.sharpness] how peaked the spectrum is round it (1 = a fully developed sea, 3.3 = a young one)
 * @param {number} [o.tail]     how fast energy falls off toward shorter waves (the power of frequency: 5 is what
 *                              is measured at sea; less puts more into the short, steep ones)
 * @param {number} [o.narrow]   how closely the long waves keep to the wind's direction (their cos^2s power)
 * @param {number} o.dir        the direction the waves run toward (radians, 0 = +X, pi/2 = +Z)
 * @param {number} [o.seed]
 * @param {{ size: number, n: number, period: number, frames: number, band: [number, number] }[]} o.cascades
 *        for each: the side of its tile (m), its grid, the time after which it repeats (s), how many frames of that
 *        are kept, and the wavelengths it carries [shortest, longest) (m)
 * @returns {{ cascades: object[], height: number, scale: number }} `scale` has been applied to every table
 */
export function makeOcean({ height, peakLength, sharpness = 3.3, tail = 5, narrow = 16, dir, seed = 1, cascades }) {
  const peak = Math.sqrt((G * TAU) / peakLength);
  const made = cascades.map((c, i) => makeCascade(c, { peak, sharpness, tail, narrow, dirX: Math.cos(dir), dirZ: Math.sin(dir), seed: seed * 7919 + i * 104729 + 17 }));
  // the height asked for is that of all the cascades together
  let variance = 0;
  for (const c of made) variance += c.variance;
  const scale = height / 4 / Math.sqrt(variance);
  for (const c of made) {
    for (let i = 0; i < c.disp.length; i++) {
      c.disp[i] *= scale;
      c.deriv[i] *= scale;
    }
    c.variance *= scale * scale;
  }
  return { cascades: made, height, scale };
}

/**
 * Look one cascade up at (x, z, time), adding into `out` ({ dx, dy, dz, vy, sx, sz }) with weight `w`: its sideways
 * displacement, its height, how fast the height is changing, and the height's slopes (taken across the grid cell the
 * point is in). Linear between grid points and between frames, exactly as the graphics card reads the same table.
 */
export function addCascade(c, x, z, time, w, out) {
  const { n, size, period, frames, disp } = c;
  const cells4 = n * n * 4;
  const u = (x / size) * n - 0.5;
  const v = (z / size) * n - 0.5;
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const fu = u - u0;
  const fv = v - v0;
  const mask = n - 1;
  const a0 = u0 & mask;
  const a1 = (u0 + 1) & mask;
  const b0 = (v0 & mask) * n;
  const b1 = ((v0 + 1) & mask) * n;
  const ft = ((((time / period) % 1) + 1) % 1) * frames; // (frame f is the sea at f / frames of the period)
  const f0 = Math.floor(ft);
  const kt = ft - f0;
  const o0 = (f0 % frames) * cells4;
  const o1 = ((f0 + 1) % frames) * cells4;
  const i00 = (b0 + a0) * 4;
  const i10 = (b0 + a1) * 4;
  const i01 = (b1 + a0) * 4;
  const i11 = (b1 + a1) * 4;
  // the four corners of the cell, each already blended between the two frames
  const k0 = 1 - kt;
  const x00 = disp[o0 + i00] * k0 + disp[o1 + i00] * kt;
  const x10 = disp[o0 + i10] * k0 + disp[o1 + i10] * kt;
  const x01 = disp[o0 + i01] * k0 + disp[o1 + i01] * kt;
  const x11 = disp[o0 + i11] * k0 + disp[o1 + i11] * kt;
  const y00 = disp[o0 + i00 + 1] * k0 + disp[o1 + i00 + 1] * kt;
  const y10 = disp[o0 + i10 + 1] * k0 + disp[o1 + i10 + 1] * kt;
  const y01 = disp[o0 + i01 + 1] * k0 + disp[o1 + i01 + 1] * kt;
  const y11 = disp[o0 + i11 + 1] * k0 + disp[o1 + i11 + 1] * kt;
  const z00 = disp[o0 + i00 + 2] * k0 + disp[o1 + i00 + 2] * kt;
  const z10 = disp[o0 + i10 + 2] * k0 + disp[o1 + i10 + 2] * kt;
  const z01 = disp[o0 + i01 + 2] * k0 + disp[o1 + i01 + 2] * kt;
  const z11 = disp[o0 + i11 + 2] * k0 + disp[o1 + i11 + 2] * kt;
  const gu = 1 - fu;
  const gv = 1 - fv;
  out.dx += ((x00 * gu + x10 * fu) * gv + (x01 * gu + x11 * fu) * fv) * w;
  out.dy += ((y00 * gu + y10 * fu) * gv + (y01 * gu + y11 * fu) * fv) * w;
  out.dz += ((z00 * gu + z10 * fu) * gv + (z01 * gu + z11 * fu) * fv) * w;
  const cell = size / n;
  out.sx += (((y10 - y00) * gv + (y11 - y01) * fv) / cell) * w;
  out.sz += (((y01 - y00) * gu + (y11 - y10) * fu) / cell) * w;
  // how fast the height is changing: the difference between the two frames
  const y0 = (disp[o0 + i00 + 1] * gu + disp[o0 + i10 + 1] * fu) * gv + (disp[o0 + i01 + 1] * gu + disp[o0 + i11 + 1] * fu) * fv;
  const y1 = (disp[o1 + i00 + 1] * gu + disp[o1 + i10 + 1] * fu) * gv + (disp[o1 + i01 + 1] * gu + disp[o1 + i11 + 1] * fu) * fv;
  out.vy += ((y1 - y0) / (period / frames)) * w;
}
