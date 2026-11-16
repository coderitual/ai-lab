// Measuring a sound without ears: the arithmetic tools/soundtest.cjs is built on.
//
// Signals are Float32Arrays of samples; times are seconds; levels are in dB relative to full scale (a sine that
// just reaches +-1 has a peak of 0 dBFS and an rms of -3 dBFS). Nothing here knows what is being measured.

const fs = require('fs');

const dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));

/** base64 text (as the page hands it over) to samples. */
function decode(text) {
  const bytes = Buffer.from(text, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4).slice();
}

const index = (sig, rate, t) => Math.max(0, Math.min(sig.length, Math.round(t * rate)));

function rms(sig, rate, t0 = 0, t1 = Infinity) {
  const a = index(sig, rate, t0);
  const b = index(sig, rate, Math.min(t1, sig.length / rate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += sig[i] * sig[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

function peak(sig, rate, t0 = 0, t1 = Infinity) {
  const a = index(sig, rate, t0);
  const b = index(sig, rate, Math.min(t1, sig.length / rate));
  let most = 0;
  for (let i = a; i < b; i++) most = Math.max(most, Math.abs(sig[i]));
  return most;
}

function mean(sig, rate, t0 = 0, t1 = Infinity) {
  const a = index(sig, rate, t0);
  const b = index(sig, rate, Math.min(t1, sig.length / rate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += sig[i];
  return sum / Math.max(1, b - a);
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * The spectrum of a stretch of a signal (Hann window, zero-padded to a power of two at least `pad` times its length).
 * @returns {{ amp: Float64Array, power: Float64Array, df: number }} `amp[k]`: the amplitude a steady sine at that
 *   frequency would have; `power[k]`: mean square per bin, so that summing a band gives that band's mean square
 */
function spectrum(sig, rate, t0, t1, pad = 2) {
  const a = index(sig, rate, t0);
  const b = index(sig, rate, t1);
  const n = Math.max(8, b - a);
  let size = 1;
  while (size < n * pad) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n && a + i < sig.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = sig[a + i] * w;
    sum += w;
    sum2 += w * w;
  }
  fft(re, im);
  const half = size / 2;
  const amp = new Float64Array(half);
  const power = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const m2 = re[k] * re[k] + im[k] * im[k];
    amp[k] = (2 * Math.sqrt(m2)) / sum;
    power[k] = ((k ? 2 : 1) * m2) / (size * sum2);
  }
  return { amp, power, df: rate / size };
}

/** rms of what lies between two frequencies. */
function band(spec, f0, f1) {
  const a = Math.max(0, Math.ceil(f0 / spec.df));
  const b = Math.min(spec.power.length, Math.ceil(f1 / spec.df));
  let sum = 0;
  for (let k = a; k < b; k++) sum += spec.power[k];
  return Math.sqrt(sum);
}

/** The frequency below which half... no: the power-weighted mean frequency. */
function centroid(spec, f0 = 20, f1 = 20000) {
  const a = Math.max(1, Math.ceil(f0 / spec.df));
  const b = Math.min(spec.power.length, Math.ceil(f1 / spec.df));
  let sum = 0, weighted = 0;
  for (let k = a; k < b; k++) {
    sum += spec.power[k];
    weighted += spec.power[k] * k * spec.df;
  }
  return sum > 0 ? weighted / sum : 0;
}

/**
 * The partials of a spectrum: its local maxima, strongest first, each placed between bins by a parabola.
 * @returns {Array<{ f: number, a: number }>} frequency and amplitude
 */
function partials(spec, { f0 = 15, f1 = 20000, floor = 1e-5, count = 12 } = {}) {
  const { amp, df } = spec;
  const a = Math.max(2, Math.ceil(f0 / df));
  const b = Math.min(amp.length - 2, Math.floor(f1 / df));
  const found = [];
  for (let k = a; k <= b; k++) {
    const v = amp[k];
    if (v < floor || v < amp[k - 1] || v <= amp[k + 1] || v < amp[k - 2] || v < amp[k + 2]) continue;
    const l = Math.log(amp[k - 1] + 1e-20), c = Math.log(v), r = Math.log(amp[k + 1] + 1e-20);
    const shift = (0.5 * (l - r)) / (l - 2 * c + r);
    found.push({ f: (k + shift) * df, a: Math.exp(c - 0.25 * (l - r) * shift) });
  }
  found.sort((x, y) => y.a - x.a);
  return found.slice(0, count);
}

/** Amplitude of the tone at `f` Hz within a stretch of the signal (one bin of a Hann-windowed transform). */
function tone(sig, rate, t0, t1, f) {
  const a = index(sig, rate, t0);
  const b = index(sig, rate, t1);
  const n = b - a;
  if (n < 8) return 0;
  const w = (2 * Math.PI * f) / rate;
  let re = 0, im = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s = sig[a + i] * h;
    re += s * Math.cos(w * i);
    im -= s * Math.sin(w * i);
    sum += h;
  }
  return (2 * Math.hypot(re, im)) / sum;
}

/**
 * The largest sudden jump in a stretch of a signal, as the height of the step that would cause it. A click is a
 * step; a step has energy all the way up the band, where nothing else in these sounds has any, so the fourth
 * difference of the samples (which removes everything slow) shows it: a step of height h gives 3h.
 */
function jump(sig, rate, t0 = 0, t1 = Infinity) {
  const a = Math.max(4, index(sig, rate, t0));
  const b = index(sig, rate, Math.min(t1, sig.length / rate));
  let most = 0;
  for (let i = a; i < b; i++) {
    const d = Math.abs(sig[i] - 4 * sig[i - 1] + 6 * sig[i - 2] - 4 * sig[i - 3] + sig[i - 4]);
    if (d > most) most = d;
  }
  return most / 3;
}

/** Time for a decay to fall by 60 dB, from the slope of its backward-integrated energy between -5 and -25 dB. */
function decayTime(sig, rate, t0 = 0) {
  const a = index(sig, rate, t0);
  const n = sig.length - a;
  const energy = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) energy[i] = energy[i + 1] + sig[a + i] * sig[a + i];
  const at = (level) => {
    const want = energy[0] * 10 ** (level / 10);
    let i = 0;
    while (i < n && energy[i] > want) i++;
    return i / rate;
  };
  return ((at(-25) - at(-5)) * 60) / 20;
}

/** Write 16-bit stereo PCM. */
function writeWav(file, left, right, rate) {
  const n = left.length;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

module.exports = { dB, decode, rms, peak, mean, fft, spectrum, band, centroid, partials, tone, jump, decayTime, writeWav };
