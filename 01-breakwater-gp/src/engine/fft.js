// A small in-place Fourier transform for square grids whose side is a power
// of two. Plain typed arrays, no allocation per call: it is run a few hundred
// times while the sea is being made (engine/ocean.js), never during play.

const plans = new Map();

/** What a transform of length `n` needs: the order to shuffle into, and the twiddles. */
function plan(n) {
  let p = plans.get(n);
  if (p) return p;
  const bits = Math.log2(n);
  if (bits !== Math.floor(bits)) throw new Error(`fft: ${n} is not a power of two`);
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  p = { rev, cos, sin, re: new Float64Array(n), im: new Float64Array(n) };
  plans.set(n, p);
  return p;
}

/** One line of `n` values starting at `start`, `stride` apart: X[k] = sum x[j] e^(+2 pi i j k / n) (no scaling). */
function line(re, im, start, stride, n, p) {
  const { rev, cos, sin, re: tr, im: ti } = p;
  for (let i = 0; i < n; i++) {
    const s = start + rev[i] * stride;
    tr[i] = re[s];
    ti[i] = im[s];
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j;
        const b = a + half;
        const wr = cos[k];
        const wi = sin[k];
        const xr = tr[b] * wr - ti[b] * wi;
        const xi = tr[b] * wi + ti[b] * wr;
        tr[b] = tr[a] - xr;
        ti[b] = ti[a] - xi;
        tr[a] += xr;
        ti[a] += xi;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const s = start + i * stride;
    re[s] = tr[i];
    im[s] = ti[i];
  }
}

/**
 * Turn an n x n grid of wave amplitudes into the field they add up to, in place:
 * out[z][x] = sum over (a, b) of in[b][a] * e^(2 pi i (a x + b z) / n).
 * Index a (and b) stands for the wavenumber a if a < n/2, else a - n. No scaling is applied.
 * @param {Float64Array|Float32Array} re real parts, row by row (length n * n)
 * @param {Float64Array|Float32Array} im imaginary parts
 * @param {number} n
 */
export function synthesize2d(re, im, n) {
  const p = plan(n);
  for (let row = 0; row < n; row++) line(re, im, row * n, 1, n, p);
  for (let col = 0; col < n; col++) line(re, im, col, n, n, p);
}
