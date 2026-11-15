// A tiny synthesised soundscape (no audio files): engine drone, rushing water,
// start beeps, mark chimes and splashes. Everything hangs off one AudioContext
// that is created on the first user gesture, as browsers (iOS Safari
// especially) require.

import { clamp01 } from './math.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
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
    const t = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);

    // --- engine: two detuned saws + a sub, through a low-pass that opens with revs
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 1.2;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscs = [
      { type: 'sawtooth', ratio: 1, gain: 0.5 },
      { type: 'sawtooth', ratio: 1.503, gain: 0.3 },
      { type: 'square', ratio: 0.5, gain: 0.35 },
    ].map((def) => {
      const osc = ctx.createOscillator();
      osc.type = def.type;
      osc.frequency.value = 60 * def.ratio;
      const g = ctx.createGain();
      g.gain.value = def.gain;
      osc.connect(g).connect(this.engineFilter);
      osc.start(t);
      return { osc, ratio: def.ratio };
    });

    // --- water: looped noise through a band-pass that brightens with speed
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // slightly "pink" so it reads as water rather than hiss
      const white = Math.random() * 2 - 1;
      last = last * 0.55 + white * 0.45;
      data[i] = last;
    }
    this.noiseBuffer = buffer;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass';
    this.waterFilter.frequency.value = 500;
    this.waterFilter.Q.value = 0.5;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    noise.connect(this.waterFilter).connect(this.waterGain).connect(this.master);
    noise.start(t);
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem('bw-muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** Per-frame update from the player's craft. */
  update(craft, active) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const speedK = clamp01(craft.speed / 28);
    let revs = 0.16 + 0.5 * craft.throttle + 0.34 * speedK;
    if (craft.airborne) revs += 0.22; // the pump unloads and the engine races
    const f = 46 + 118 * revs;
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(f * o.ratio, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(260 + 1900 * revs * revs, t, 0.06);
    this.engineGain.gain.setTargetAtTime(active ? 0.035 + 0.075 * revs : 0.02, t, 0.08);
    this.waterFilter.frequency.setTargetAtTime(420 + 1500 * speedK, t, 0.1);
    this.waterGain.gain.setTargetAtTime(active ? (0.03 + 0.26 * speedK * speedK) * (0.25 + 0.75 * craft.grip) : 0.02, t, 0.1);
  }

  _tone(freq, duration, { type = 'sine', gain = 0.18, when = 0, slideTo = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  countdown() {
    this._tone(440, 0.22, { type: 'triangle', gain: 0.22 });
  }

  go() {
    this._tone(880, 0.6, { type: 'triangle', gain: 0.26 });
  }

  pass(fullPower) {
    this._tone(660, 0.12, { gain: 0.16 });
    this._tone(990, 0.16, { gain: 0.16, when: 0.09 });
    if (fullPower) this._tone(1320, 0.28, { gain: 0.16, when: 0.2 });
  }

  miss() {
    this._tone(150, 0.4, { type: 'sawtooth', gain: 0.16, slideTo: 90 });
  }

  lap() {
    this._tone(523, 0.14, { type: 'triangle', gain: 0.18 });
    this._tone(784, 0.22, { type: 'triangle', gain: 0.18, when: 0.12 });
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', gain: 0.2, when: i * 0.13 }));
  }

  /** A slap of water for landings and bumps. */
  splash(strength = 0.5) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 + 0.3 * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.6);
  }
}
