// A tiny synthesised soundscape (no audio files): engine drone, rushing water,
// start beeps, mark chimes and splashes. Everything hangs off one AudioContext
// that is created on the first user gesture, as browsers (iOS Safari
// especially) require.
//
// Every driver on this machine has a voice of their own (engine + water). In
// split screen the two voices sit on their driver's side of the stereo picture,
// and so do that driver's chimes and splashes: you can hear who did what.

import { clamp01 } from './math.js';

const MASTER = 1.2;

/** One driver's engine and the water rushing past their hull. */
class Voice {
  /**
   * @param {GameAudio} audio
   * @param {number} index 0 for the first driver on this machine, 1 for the second
   */
  constructor(audio, index) {
    const { ctx } = audio;
    const t = ctx.currentTime;
    this.audio = audio;
    // the second engine runs a little higher, so two side by side do not blur into one
    this.pitch = index === 0 ? 1 : 1.07;

    this.out = ctx.createGain();
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.panner) this.out.connect(this.panner).connect(audio.master);
    else this.out.connect(audio.master);

    // --- engine: two detuned saws + a sub, through a low-pass that opens with revs
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 1.2;
    this.engineFilter.connect(this.engineGain).connect(this.out);
    this.oscs = [
      { type: 'sawtooth', ratio: 1, gain: 0.5 },
      { type: 'sawtooth', ratio: 1.503, gain: 0.3 },
      { type: 'square', ratio: 0.5, gain: 0.35 },
    ].map((def) => {
      const osc = ctx.createOscillator();
      osc.type = def.type;
      osc.frequency.value = 60 * def.ratio * this.pitch;
      const g = ctx.createGain();
      g.gain.value = def.gain;
      osc.connect(g).connect(this.engineFilter);
      osc.start(t);
      return { osc, ratio: def.ratio };
    });

    // --- water: looped noise through a band-pass that brightens with speed
    this.noise = ctx.createBufferSource();
    this.noise.buffer = audio.noiseBuffer;
    this.noise.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass';
    this.waterFilter.frequency.value = 500;
    this.waterFilter.Q.value = 0.5;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    this.noise.connect(this.waterFilter).connect(this.waterGain).connect(this.out);
    this.noise.start(t, index * 0.83); // each voice reads the loop from a different place
  }

  /**
   * @param {import('../game/Craft.js').Craft} craft
   * @param {boolean} active false on the title screen and the grid: just an idle
   * @param {number} pan -1 (left) … 1 (right)
   * @param {number} level 0…1, lower when several voices share the mix
   */
  update(craft, active, pan, level) {
    const t = this.audio.ctx.currentTime;
    const speedK = clamp01(craft.speed / 28);
    let revs = 0.16 + 0.5 * craft.throttle + 0.34 * speedK;
    if (craft.airborne) revs += 0.22; // the propellers come out of the water and the engines race
    const f = (41 + 106 * revs) * this.pitch; // a big turbine: a deeper note than a small engine's
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(f * o.ratio, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(260 + 1900 * revs * revs, t, 0.06);
    this.engineGain.gain.setTargetAtTime((active ? 0.035 + 0.075 * revs : 0.02) * level, t, 0.08);
    this.waterFilter.frequency.setTargetAtTime(420 + 1500 * speedK, t, 0.1);
    // water rushing past, and louder when the hull is going through it sideways
    const slide = Math.min(1, Math.abs(craft.slip || 0) / 0.45);
    this.waterGain.gain.setTargetAtTime((active ? (0.03 + 0.26 * speedK * speedK) * (0.25 + 0.75 * craft.grip) * (1 + 0.6 * slide) : 0.02) * level, t, 0.1);
    if (this.panner) this.panner.pan.setTargetAtTime(pan, t, 0.1);
  }

  /** Fade out and stop (the driver is gone: back from split screen to one view). */
  dispose() {
    const t = this.audio.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const o of this.oscs) o.osc.stop(t + 0.4);
    this.noise.stop(t + 0.4);
  }
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    /** @type {Voice[]} one per driver on this machine */
    this.voices = [];
    try {
      this.muted = localStorage.getItem('bw-muted') === '1';
    } catch {
      /* storage unavailable: start with sound on */
    }
  }

  /** Create / resume the context. Must be called from a tap, click or key press. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this._build();
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch (err) {
      console.warn('Audio unavailable', err);
      this.ctx = null;
    }
  }

  _build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    // only there to catch the loud moments (a landing on top of a chime on top of two engines)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.15;
    this.master.connect(limiter).connect(ctx.destination);

    // two seconds of noise, shared by the water of every voice and by the splashes
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // slightly "pink" so it reads as water rather than hiss
      const white = Math.random() * 2 - 1;
      last = last * 0.55 + white * 0.45;
      data[i] = last;
    }
    this.noiseBuffer = buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem('bw-muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  /**
   * Per-frame update from the crafts ridden on this machine.
   * @param {Array<{ craft: import('../game/Craft.js').Craft, pan: number }>} players
   * @param {boolean} active a race is under way
   */
  update(players, active) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    while (this.voices.length > players.length) this.voices.pop().dispose();
    while (this.voices.length < players.length) this.voices.push(new Voice(this, this.voices.length));
    // two engines at once: each a little quieter, so the pair is only slightly louder than one alone
    const level = players.length > 1 ? 0.78 : 1;
    for (let i = 0; i < players.length; i++) this.voices[i].update(players[i].craft, active, players[i].pan, level);
  }

  /** Where a one-off sound goes: straight to the mix, or through a panner of its own. */
  _to(pan) {
    if (!pan || !this.ctx.createStereoPanner) return this.master;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);
    return panner;
  }

  _tone(freq, duration, { type = 'sine', gain = 0.18, when = 0, slideTo = 0, pan = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    // quick attack, hold, then ring out
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + duration * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this._to(pan));
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // The start signals are for everyone; the rest belong to one driver and are
  // heard on that driver's side (`pan`).

  countdown() {
    this._tone(440, 0.22, { type: 'triangle', gain: 0.22 });
  }

  go() {
    this._tone(880, 0.6, { type: 'triangle', gain: 0.26 });
  }

  pass(fullPower, pan = 0) {
    this._tone(660, 0.12, { gain: 0.16, pan });
    this._tone(990, 0.16, { gain: 0.16, when: 0.09, pan });
    if (fullPower) this._tone(1320, 0.28, { gain: 0.16, when: 0.2, pan });
  }

  miss(pan = 0) {
    this._tone(150, 0.4, { type: 'sawtooth', gain: 0.16, slideTo: 90, pan });
  }

  lap(pan = 0) {
    this._tone(523, 0.14, { type: 'triangle', gain: 0.18, pan });
    this._tone(784, 0.22, { type: 'triangle', gain: 0.18, when: 0.12, pan });
  }

  finish(pan = 0) {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', gain: 0.2, when: i * 0.13, pan }));
  }

  /** A boost cutting in: a rising rush of air with a tone climbing under it. `strength` 0…1. */
  boost(strength = 0.5, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = clamp01(strength);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(2600 + 1800 * k, t + 0.35);
    filter.frequency.exponentialRampToValueAtTime(900, t + 0.9 + 0.5 * k);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.09 * k, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95 + 0.5 * k);
    src.connect(filter).connect(g).connect(this._to(pan));
    src.start(t, Math.random());
    src.stop(t + 1.5 + 0.5 * k);
    this._tone(180, 0.5 + 0.3 * k, { type: 'sawtooth', gain: 0.018 + 0.025 * k, slideTo: 520 + 260 * k, pan });
  }

  /**
   * A slap of water for landings and bumps. Light ones are little more than
   * texture; a hard landing is plainly heard over the engine and thumps.
   * @param {number} strength 0…1
   */
  splash(strength = 0.5, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = clamp01(strength);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // starts bright and closes down as the water settles
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(350, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 + 0.68 * k * Math.sqrt(k), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(filter).connect(g).connect(this._to(pan));
    src.start(t, Math.random());
    src.stop(t + 0.65);
    // the hull hitting the water
    if (k > 0.4) this._tone(110, 0.2, { gain: 0.22 * k, slideTo: 46, pan });
  }
}
