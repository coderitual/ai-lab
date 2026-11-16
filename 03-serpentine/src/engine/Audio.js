// The Web Audio shell: one context, a master bus with a limiter, a reverb, a
// mute that is remembered, and the few helpers every sound is made with. It
// knows nothing about cars; what the demo sounds like is game/Sound.js.
//
// Two ideas.
//
// 1. Browsers let a page make sound only after the user has touched it, and
//    may take the sound away again (a phone call, a hidden tab). So the
//    context is created by unlock() from a gesture, every later gesture
//    resumes it, and nothing here throws or waits when that fails: without a
//    context every method does nothing.
//
// 2. Every change is *scheduled* at `now` on the audio clock, never written
//    as an immediate value, and nothing is torn down except by a source
//    ending. The same code therefore renders on an OfflineAudioContext
//    against a clock the caller supplies, which is how tools/soundtest.cjs
//    measures the sound: without speakers and without real time.
//
// The signal path: voices and one-off sounds -> master (level, mute) ->
// compressor -> soft clip -> speakers. The reverb is a send: anything
// connected to `reverbSend` comes back, convolved with a generated impulse
// response, into the master.

import { clamp, clamp01 } from './math.js';
import { createRng } from './rng.js';

/** Master gain before the limiter. The compressor below adds about 4 dB of its own make-up gain. */
const LEVEL = 0.24;

/** The limiter: a compressor that only works on the loud moments, then a ceiling nothing gets past. */
const LIMITER = { threshold: -12, knee: 10, ratio: 8, attack: 0.003, release: 0.16 };
/** The soft clip is the identity below `knee` and bends towards `ceiling` (0.86 is -1.3 dBFS) above it. */
const CLIP = { knee: 0.7, ceiling: 0.86 };

/** Seconds of noise shared by everything that hisses, roars or scrapes. Not a round number: loops do not line up. */
const NOISE_SECONDS = 2.7;
/** Hz above which the noise falls away. */
const NOISE_TOP = 5500;

/**
 * The reverb, as a room: a hard-walled tube some metres across.
 * @typedef {object} ReverbShape
 * @property {number} seconds time for the tail to fall by 60 dB (low and middle frequencies)
 * @property {number} brightSeconds the same for the top end, which a rough wall and the air take first
 * @property {number} predelay s before the first reflection
 * @property {number} early s over which separate reflections arrive, ever closer together
 * @property {number} reflections how many of them
 */
const REVERB = { seconds: 1.6, brightSeconds: 0.75, predelay: 0.011, early: 0.09, reflections: 34 };

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

/** One-off sounds that belong together (a thud and its rattle): one place in the stereo picture, one reverb share. */
class Spot {
  /**
   * @param {GameAudio} audio
   * @param {number} pan -1 (left) .. 1 (right)
   * @param {number} reverb 0..1 share sent to the reverb
   */
  constructor(audio, pan, reverb) {
    const ctx = audio.ctx;
    this.input = ctx.createGain();
    this.nodes = [this.input];
    this.pending = 0;
    let out = this.input;
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      out.connect(panner);
      this.nodes.push(panner);
      out = panner;
    }
    out.connect(audio.master);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send);
      send.connect(audio.reverbSend);
      this.nodes.push(send);
    }
  }
}

export class GameAudio {
  /**
   * @param {object} [o]
   * @param {boolean} [o.mute] start silent whatever was remembered (the page's ?mute)
   * @param {string} [o.storageKey] where the mute is remembered
   * @param {BaseAudioContext} [o.context] use this context instead of creating one on a gesture (an
   *   OfflineAudioContext, in tests): the graph is built at once and nothing is ever suspended
   * @param {() => number} [o.clock] with `context`: the time to schedule at, instead of the context's own clock
   *   (a test steps its scenario, schedules everything against this clock, then renders in one go)
   * @param {number} [o.seed] of the noise and of the reverb
   * @param {Partial<ReverbShape>} [o.reverb]
   */
  constructor({ mute = false, storageKey = 'serpentine.muted', context = null, clock = null, seed = 1, reverb = {} } = {}) {
    /** @type {BaseAudioContext|null} */
    this.ctx = null;
    this.muted = !!mute;
    this.volume = 1;
    /** One-off sounds and passing voices now in the graph (for tests: it must come back to where it was). */
    this.live = 0;
    /** @type {GainNode|null} everything goes in here */
    this.master = null;
    /** @type {GainNode|null} connect a send here to hear it in the reverb */
    this.reverbSend = null;
    /** @type {AudioNode|null} the last node before the speakers (an analyser can listen here) */
    this.output = null;
    /** @type {AudioBuffer|null} noise, NOISE_SECONDS long, to loop */
    this.noiseBuffer = null;

    this._storageKey = storageKey;
    this._external = !!context;
    this._clock = clock;
    this._rng = createRng(seed).fork('audio');
    this._reverb = { ...REVERB, ...reverb };
    this._attempts = 0;
    this._sleepAt = null;
    this._listening = null;
    try {
      if (!mute && storageKey) this.muted = localStorage.getItem(storageKey) === '1';
    } catch {
      /* storage unavailable: start with sound on */
    }
    if (context) {
      this.ctx = context;
      this._build();
    }
  }

  /** The time to schedule at. */
  get now() {
    return this._clock ? this._clock() : this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Call once per frame before scheduling anything. True when sound can be scheduled now. (It is also where a
   * muted context is put to sleep once its fade is over, so that silence costs nothing.)
   */
  tick() {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (this._external) return true;
    if (this._sleepAt !== null && ctx.currentTime >= this._sleepAt) {
      this._sleepAt = null;
      if (this.muted) this._suspend();
    }
    return ctx.state === 'running';
  }

  /** Create or resume the context. Must be called from a tap, a click or a key press; safe to call on every one. */
  unlock() {
    if (this._external) return;
    if (!this.ctx) {
      // a muted page needs no context at all; unmuting is itself a gesture and comes back here
      if (this.muted || this._attempts >= 3) return;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      this._attempts++;
      try {
        this.ctx = new AC();
        this._build();
        // older iOS only counts the context as started once something has been played inside the gesture
        const blip = this.ctx.createBufferSource();
        blip.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        blip.connect(this.ctx.destination);
        blip.onended = () => blip.disconnect();
        blip.start(0);
      } catch {
        this._close();
        return;
      }
    }
    this._wake();
  }

  /**
   * Unlock on every gesture on `target` from now on, and sleep while the page is hidden. Returns `this`.
   * (Without it, call unlock() from the page's own input handlers.)
   * @param {EventTarget} [target]
   */
  listen(target = globalThis) {
    if (this._listening || !target || !target.addEventListener) return this;
    const onGesture = () => this.unlock();
    const onVisibility = () => {
      if (!this.ctx || this._external) return;
      if (document.hidden) this._suspend();
      else this._wake();
    };
    for (const type of GESTURES) target.addEventListener(type, onGesture, { capture: true, passive: true });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    this._listening = { target, onGesture, onVisibility };
    return this;
  }

  /** @param {boolean} muted remembered for the next visit */
  setMuted(muted) {
    this.muted = !!muted;
    try {
      if (this._storageKey) localStorage.setItem(this._storageKey, this.muted ? '1' : '0');
    } catch {
      /* not remembered, then */
    }
    if (!this.muted) {
      this._sleepAt = null;
      this.unlock();
    }
    if (!this.ctx) return;
    const t = this.now;
    const gain = this.master.gain;
    gain.cancelScheduledValues(t);
    gain.setTargetAtTime(this.muted ? 0 : LEVEL * this.volume, t, 0.012);
    if (this.muted) {
      gain.setValueAtTime(0, t + 0.15); // an exponential fade never arrives: after it, true silence
      this._sleepAt = t + 0.3;
    }
  }

  /** @param {number} volume 0..1 */
  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? clamp01(volume) : 1;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(LEVEL * this.volume, this.now, 0.03);
  }

  /** How much of what is sent to the reverb comes back: 0 in the open, 1 in the hardest room. */
  setReverb(amount) {
    if (!this.ctx) return;
    const a = Number.isFinite(amount) ? clamp01(amount) : 0;
    if (Math.abs(a - this._wetTarget) < 1e-3) return;
    this._wetTarget = a;
    this._wet.gain.setTargetAtTime(a, this.now, 0.08);
  }

  // ------------------------------------------------------------------ what sounds are made with

  /**
   * A place for a voice that lasts: its own level, its side of the stereo picture, its share of the reverb.
   * It starts silent; the owner schedules `level`, `pan` and `reverb`.
   * @returns {{ input: GainNode, level: AudioParam, pan: AudioParam|null, reverb: AudioParam, nodes: AudioNode[] }|null}
   */
  bus() {
    const ctx = this.ctx;
    if (!ctx) return null;
    const input = ctx.createGain();
    input.gain.value = 0;
    const send = ctx.createGain();
    send.gain.value = 0;
    const nodes = [input, send];
    let out = input;
    let pan = null;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      input.connect(panner);
      nodes.push(panner);
      out = panner;
      pan = panner.pan;
    }
    out.connect(this.master);
    out.connect(send);
    send.connect(this.reverbSend);
    return { input, level: input.gain, pan, reverb: send.gain, nodes };
  }

  /**
   * Somewhere for one-off sounds to play into; it is taken out of the graph when the last of them has ended.
   * @param {number} [pan] -1 (left) .. 1 (right)
   * @param {number} [reverb] 0..1 share sent to the reverb
   * @returns {Spot|null}
   */
  spot(pan = 0, reverb = 0) {
    return this.ctx ? new Spot(this, Number.isFinite(pan) ? pan : 0, Number.isFinite(reverb) ? clamp01(reverb) : 0) : null;
  }

  /**
   * A looping noise source, not yet started.
   * @returns {AudioBufferSourceNode}
   */
  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Where in the noise to start reading (s): a different place every time, the same sequence every run. */
  noiseOffset() {
    return this._rng.next() * (NOISE_SECONDS - 0.1);
  }

  /**
   * One note: an oscillator with a quick attack that rings out.
   * @param {Spot|AudioNode|null} dest
   * @param {object} o
   * @param {number} o.freq Hz
   * @param {number} [o.to] glide to this pitch by the end
   * @param {OscillatorType} [o.type]
   * @param {number} [o.when] s from now
   * @param {number} o.dur s, all of it
   * @param {number} o.gain peak
   * @param {number} [o.attack] s
   * @param {number} [o.hold] s at the peak before it rings out
   */
  tone(dest, { freq, to = 0, type = 'sine', when = 0, dur, gain, attack = 0.004, hold = 0 }) {
    const ctx = this.ctx;
    if (!ctx || !dest || !(gain > 0) || !(dur > 0) || !(freq > 0)) return;
    const t = this.now + Math.max(0, when);
    const end = t + dur;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to > 0) osc.frequency.exponentialRampToValueAtTime(to, end);
    const amp = ctx.createGain();
    envelope(amp.gain, t, end, gain, attack, hold);
    osc.connect(amp);
    amp.connect(dest.input || dest);
    osc.start(t);
    osc.stop(end + 0.01);
    this.hold(osc, [osc, amp], dest);
  }

  /**
   * One burst of filtered noise.
   * @param {Spot|AudioNode|null} dest
   * @param {object} o
   * @param {BiquadFilterType} [o.type]
   * @param {number} o.freq Hz, the filter
   * @param {number} [o.to] the filter sweeps to this by the end
   * @param {number} [o.q]
   * @param {number} [o.when] s from now
   * @param {number} o.dur s, all of it
   * @param {number} o.gain peak
   * @param {number} [o.attack] s
   * @param {number} [o.hold] s at the peak before it dies away
   */
  noise(dest, { type = 'lowpass', freq, to = 0, q = 0.7, when = 0, dur, gain, attack = 0.003, hold = 0 }) {
    const ctx = this.ctx;
    if (!ctx || !dest || !(gain > 0) || !(dur > 0) || !(freq > 0)) return;
    const t = this.now + Math.max(0, when);
    const end = t + dur;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (to > 0) filter.frequency.exponentialRampToValueAtTime(to, end);
    const amp = ctx.createGain();
    envelope(amp.gain, t, end, gain, attack, hold);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(dest.input || dest);
    src.start(t, this.noiseOffset());
    src.stop(end + 0.01);
    this.hold(src, [src, filter, amp], dest);
  }

  /**
   * Take `nodes` out of the graph when `source` has stopped, so that a sound that is over leaves nothing behind.
   * @param {AudioScheduledSourceNode} source
   * @param {AudioNode[]} nodes
   * @param {Spot|AudioNode|null} [spot] if a Spot, it goes too once every sound playing into it has ended
   */
  hold(source, nodes, spot = null) {
    const group = spot instanceof Spot ? spot : null;
    this.live++;
    if (group) group.pending++;
    source.onended = () => {
      source.onended = null;
      this.live--;
      for (const node of nodes) node.disconnect();
      if (group && --group.pending === 0) for (const node of group.nodes) node.disconnect();
    };
  }

  /** Close the context and stop listening (the page is going away, or a test is done). */
  dispose() {
    const l = this._listening;
    if (l) {
      for (const type of GESTURES) l.target.removeEventListener(type, l.onGesture, { capture: true });
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', l.onVisibility);
      this._listening = null;
    }
    if (this.ctx && !this._external) this._close();
    this.ctx = null;
  }

  // ------------------------------------------------------------------ inside

  _build() {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : LEVEL * this.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    // The compressor needs a moment to react, and what gets through in that moment must still not clip: a curve
    // that is a straight line for everything ordinary and leans over towards the ceiling above it.
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    const soft = CLIP.ceiling - CLIP.knee;
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= CLIP.knee ? a : CLIP.knee + soft * Math.tanh((a - CLIP.knee) / soft));
    }
    clip.curve = curve;
    this.master.connect(limiter);
    limiter.connect(clip);
    clip.connect(ctx.destination);
    this.output = clip;

    this.noiseBuffer = noiseBuffer(ctx, this._rng.fork('noise'));

    // reverb: send -> convolver -> return
    this.reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = impulseResponse(ctx, this._rng.fork('reverb'), this._reverb);
    this._wet = ctx.createGain();
    this._wet.gain.value = 0;
    this._wetTarget = 0;
    this.reverbSend.connect(convolver);
    convolver.connect(this._wet);
    this._wet.connect(this.master);
    /** The impulse response in use (tests measure it). */
    this.impulse = convolver.buffer;
  }

  _wake() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state === 'running' || ctx.state === 'closed' || !ctx.resume) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* not this time: the next gesture tries again */
    }
  }

  _suspend() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !ctx.suspend) return;
    try {
      const p = ctx.suspend();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* it keeps running, silently */
    }
  }

  _close() {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = this.reverbSend = this.output = null;
    try {
      const p = ctx && ctx.close ? ctx.close() : null;
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* nothing to close */
    }
  }
}

/**
 * The noise everything hissing is cut from: white up to NOISE_TOP and falling 12 dB per octave above it, so that
 * whatever band a sound takes from it, it brings no fizz from the top of the spectrum along. It loops without a
 * seam: the filter has been round the loop once before the pass that is kept.
 * @param {BaseAudioContext} ctx
 * @param {import('./rng.js').Rng} rng
 */
function noiseBuffer(ctx, rng) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(rate * NOISE_SECONDS), rate);
  const data = buffer.getChannelData(0);
  const n = data.length;
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = rng.next() * 2 - 1;
  // a two-pole Butterworth low-pass
  const w = (2 * Math.PI * Math.min(NOISE_TOP, rate * 0.45)) / rate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b0 = (1 - Math.cos(w)) / 2 / a0;
  const b1 = (1 - Math.cos(w)) / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = white[i];
      const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      data[i] = y;
    }
  }
  return buffer;
}

/**
 * The shape of every one-off sound: up to `gain` in `attack`, held, then dying away to nothing at `end`.
 * Ramps between fixed points only, so it means the same whenever it is scheduled.
 */
function envelope(param, t, end, gain, attack, hold) {
  const top = Math.min(t + attack, end - 0.004);
  const from = Math.min(top + hold, end - 0.003);
  param.value = 0;
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(gain, top);
  if (from > top) param.setValueAtTime(gain, from);
  if (end - 0.002 > from) param.exponentialRampToValueAtTime(gain * 0.001, end - 0.002);
  param.linearRampToValueAtTime(0, end);
}

/**
 * The impulse response of a hard-walled tube: a short silence, separate reflections that crowd together, then a
 * dense tail in which the top end dies about twice as fast as the rest. Stereo, the two sides alike but not the
 * same. Scaled so that what comes back carries about as much energy as what went in.
 * @param {BaseAudioContext} ctx
 * @param {import('./rng.js').Rng} rng
 * @param {ReverbShape} shape
 */
function impulseResponse(ctx, rng, shape) {
  const rate = ctx.sampleRate;
  const length = Math.round(rate * (shape.predelay + shape.seconds * 1.05));
  const buffer = ctx.createBuffer(2, length, rate);
  const first = Math.round(rate * shape.predelay);
  const earlyEnd = first + Math.round(rate * shape.early);
  const slow = Math.log(1000) / (shape.seconds * rate); // per sample, -60 dB in `seconds`
  const fast = Math.log(1000) / (shape.brightSeconds * rate);
  const lowpass = 1 - Math.exp((-2 * Math.PI * 1100) / rate); // what "the rest" is: below about 1.1 kHz
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const r = rng.fork(ch ? 'right' : 'left');
    let dark = 0;
    for (let i = first; i < length; i++) {
      const n = i - first;
      const white = r.next() * 2 - 1;
      dark += (white - dark) * lowpass;
      // the tail fades in while the separate reflections are still arriving
      const build = Math.min(1, n / (earlyEnd - first)) ** 1.5;
      data[i] = build * (2.2 * dark * Math.exp(-slow * n) + 0.55 * (white - dark) * Math.exp(-fast * n));
    }
    // the reflections: the gaps between them shrink, as the paths between two walls and a roof multiply
    const taps = rng.fork('taps');
    let at = 0;
    for (let k = 0; k < shape.reflections; k++) {
      at += (1 - at) * (1.6 / shape.reflections) * (0.6 + 0.8 * taps.next());
      const i = first + Math.round(at * (earlyEnd - first) + (ch ? 1 : -1) * taps.next() * 0.0006 * rate);
      const a = (taps.next() < 0.5 ? -1 : 1) * (1 - 0.7 * at) * (0.55 + 0.45 * r.next());
      if (i < first || i + 2 >= length) continue;
      data[i] += a;
      data[i + 1] += a * 0.55; // a wall is not a mirror: each one arrives a little smeared
      data[i + 2] += a * 0.2;
    }
    const fade = Math.round(rate * 0.05);
    for (let i = 0; i < fade; i++) data[length - 1 - i] *= i / fade;
  }
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
  }
  const scale = 1 / Math.sqrt(energy / 2);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}
