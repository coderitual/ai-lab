// What Serpentine sounds like. Every sound is synthesised here, on the shell
// in engine/Audio.js: no recordings.
//
// A car's voice is built the way the sound of a car is. The engine is two
// oscillators locked to the crankshaft (the firing frequency of a four is
// rpm / 30 Hz) pushed through a soft saturation: one carries the first few
// harmonics of the firing, the other the half orders that make an engine
// growl instead of hum, and how hard they are pushed is the throttle. What
// comes out goes through filters that do not move with the revs (a body, a
// formant that opens under load), so the harmonics climb through them and
// the timbre changes across the rev range as a real one does. The same wave
// gates a band of noise (the intake), a turbocharger whistles with boost,
// and a gear change is a cut, a thump and a glide. Tyres, wind, road and
// contact are bands of one noise source, each with its own law.
//
// update() is called once per drawn frame with what each car is doing. It
// smooths what it is given by the frame's own length and then only ever
// *aims* audio parameters at values (setTargetAtTime), so the sound is the
// same at 30, 60 or 144 frames a second and nothing steps.

import { clamp, clamp01, lerp, smoothstep } from '../engine/math.js';
import { createRng } from '../engine/rng.js';
import { SURFACE } from './track.js';
import { CAR } from './vehicle/params.js';

/** Where the two cars of a split screen sit in the stereo picture (each about 15 dB stronger on its own side). */
export const SPLIT_PAN = 0.7;

/** Linear gains of the parts into a car's bus, and of the cues into the master. Tuned by tools/soundtest.cjs. */
const MIX = {
  engine: 0.41,
  breath: 0.16,
  whistle: 0.12,
  wind: 0.55,
  road: 1.1,
  squeal: 6.8,
  scrub: 0.5,
  rumble: 0.3,
  scrape: 0.9,
  thump: 0.4,
  pop: 0.16,
  impact: 1,
  cue: 0.17,
  /** Each of two cars is turned down a little, so that the pair is only slightly louder than one alone. */
  pair: 0.78,
  /** How unevenly the engine turns, against what is built in (0: a perfect machine, for measuring partials). */
  wobble: 1,
};

const IDLE = CAR.engine.idle;
const LIMITER = CAR.engine.limiter;

/**
 * The engine's partials, as [multiple, amplitude, phase] of sines, in multiples of a QUARTER of the firing
 * frequency (four firings make one full cycle of the engine, so that is the lowest thing it can repeat at).
 */
const PARTIALS = {
  /**
   * Harmonics 1..10 of the firing frequency, 3 dB apart from the third on. Each is 0.6 rad later than the one
   * below, which leans the wave over into a pulse with a quick rise and a slow fall; pushed into the saturation,
   * that shape keeps its even harmonics, where an upright one would be squared off and lose them.
   */
  fire: [1, 0.56, 0.36, 0.25, 0.18, 0.13, 0.09, 0.065, 0.045, 0.03].map((a, k) => [4 * (k + 1), a, 0.6 * k]),
  /** Half orders (between the firing harmonics) and a little of the quarter orders (no two cylinders are alike). */
  rough: [[2, 0.5, 0], [6, -0.8, 0], [10, 0.65, 0], [14, -0.4, 0], [18, 0.22, 0], [1, 0.14, 0], [3, -0.2, 0], [5, 0.24, 0],
    [7, -0.24, 0], [9, 0.2, 0], [11, -0.14, 0]],
};
/** The saturation: tanh(SHAPE x), which is smooth enough that nothing it adds reaches the top of the band. */
const SHAPE = 3;

/**
 * What each surface (SURFACE in track.js) does to the tyres: road roar against asphalt, how much a sliding tyre
 * sings, how much it scrabbles instead, and how strong the thrum of its unevenness is.
 */
const GROUND = [];
GROUND[SURFACE.ASPHALT] = { roar: 1, squeal: 1, scrub: 0, rumble: 0 };
GROUND[SURFACE.SHOULDER] = { roar: 1.5, squeal: 0.6, scrub: 0.15, rumble: 1 };
GROUND[SURFACE.GRASS] = { roar: 1.25, squeal: 0, scrub: 0.8, rumble: 0.6 };
GROUND[SURFACE.GRAVEL] = { roar: 1.9, squeal: 0, scrub: 1, rumble: 0.4 };

/**
 * What a body sounds like sliding along each kind of edge (EDGE in track.js: rail, rock, wall, parapet, trees):
 * two resonances and a grind under them. Steel rings; rock and concrete grind.
 */
const band = (type, freq, q, level = 1) => ({ type, freq, q, out: 0, level });
const EDGES = [
  /* rail */ [band('bandpass', 2350, 9), band('bandpass', 3900, 12, 0.6), band('bandpass', 900, 0.7, 0.5)],
  /* rock */ [band('lowpass', 700, 0.9), band('bandpass', 380, 1, 0.6), band('bandpass', 1500, 1.5, 0.25)],
  /* wall */ [band('lowpass', 1000, 1), band('bandpass', 1700, 3, 0.4), band('bandpass', 650, 0.6, 0.6)],
  /* parapet */ [band('lowpass', 1000, 1), band('bandpass', 1700, 3, 0.4), band('bandpass', 650, 0.6, 0.6)],
  /* trees */ [band('lowpass', 600, 0.7), band('bandpass', 1900, 2, 0.3), band('bandpass', 350, 0.6, 0.6)],
];

/** A sliding tyre: the squeal and a partial above it into gain 0, the rougher band into gain 1. */
const TYRE_BANDS = [
  { type: 'bandpass', freq: 1000, q: 16, out: 0 },
  { type: 'bandpass', freq: 1350, q: 24, out: 0, level: 0.35 },
  { type: 'bandpass', freq: 700, q: 3, out: 1 },
];

/** Notes of the cues (Hz). */
const NOTE = { count: 622.25, go: 1244.5, a5: 880, d6: 1174.66, g5: 783.99, d5: 587.33, c6: 1046.5, e6: 1318.51, g6: 1567.98, tick: 1800 };

const finite = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

/** An audio parameter that is only ever aimed at values, and not again while it is already on its way there. */
class Aim {
  /**
   * @param {AudioParam} param
   * @param {number} value where it starts
   */
  constructor(param, value) {
    this.param = param;
    this.target = value;
    param.value = value;
  }

  /** Head for `value`, closing 63 % of the gap every `tau` seconds, from time `t`. */
  to(value, t, tau) {
    if (Math.abs(value - this.target) <= 1e-4 * (Math.abs(this.target) + 1e-3)) return;
    this.target = value;
    this.param.setTargetAtTime(value, t, tau);
  }
}

/** A band of noise that is in the graph only while it is heard: sliding tyres, a body along a rail. */
class Passing {
  /**
   * @param {import('../engine/Audio.js').GameAudio} audio
   * @param {AudioNode} dest
   * @param {Array<{ type: BiquadFilterType, freq: number, q: number, out: number, level?: number }>} bands each into
   *   gain `out`, at `level` (default 1)
   * @param {number} gains how many output gains
   * @param {number} t when it starts
   */
  constructor(audio, dest, bands, gains, t) {
    const ctx = audio.ctx;
    this.source = audio.noiseSource();
    this.gains = [];
    this.freqs = [];
    this.qs = [];
    const nodes = [this.source];
    for (let i = 0; i < gains; i++) {
      const gain = ctx.createGain();
      gain.connect(dest);
      nodes.push(gain);
      this.gains.push(new Aim(gain.gain, 0));
    }
    for (const band of bands) {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      this.source.connect(filter);
      let out = filter;
      if (band.level !== undefined) {
        out = ctx.createGain();
        out.gain.value = band.level;
        filter.connect(out);
        nodes.push(out);
      }
      out.connect(nodes[1 + band.out]);
      nodes.push(filter);
      this.freqs.push(new Aim(filter.frequency, band.freq));
      this.qs.push(new Aim(filter.Q, band.q));
    }
    this.source.start(t, audio.noiseOffset());
    audio.hold(this.source, nodes);
    this.quiet = 0;
  }

  /** Fade out and leave the graph. */
  stop(t) {
    for (const gain of this.gains) gain.to(0, t, 0.02);
    this.source.stop(t + 0.25);
  }
}

/** One car: engine, intake, turbo, tyres, wind, road and what it touches. */
class CarVoice {
  /**
   * @param {Sound} sound
   * @param {number} index 0 for the first car, 1 for the second
   */
  constructor(sound, index) {
    const audio = sound.audio;
    const ctx = audio.ctx;
    const t = audio.now;
    this.sound = sound;
    this.audio = audio;
    this.index = index;
    this.rng = sound.rng.fork(`car${index}`);
    // the second car's body rings a little higher, so that two side by side at the same revs do not fuse into one
    const own = 1 + 0.065 * index;
    this.own = own;

    // what it was last told, and what it has made of it
    this.rpm = IDLE;
    this.gear = null;
    this.load = 0;
    this.worked = 0;
    this.boost = 0;
    this.blip = 0;
    this.speed = 0;
    this.skid = 0;
    this.along = 0;
    this.scrape = 0;
    this.tunnel = 0;
    this.pan = 0;
    this.ground = { roar: 1, squeal: 1, scrub: 0, rumble: 0, wavelength: 1 };
    this.lastShift = -1;
    this.lastLift = -1;
    this.lastImpact = -1;

    this.bus = audio.bus();
    this.level = new Aim(this.bus.level, 0);
    this.panAim = this.bus.pan ? new Aim(this.bus.pan, 0) : null;
    this.send = new Aim(this.bus.reverb, 0);
    const out = this.bus.input;
    /** Everything that lasts as long as the voice does. */
    this.nodes = [...this.bus.nodes];
    const make = (node) => {
      this.nodes.push(node);
      return node;
    };
    const gain = (value) => {
      const node = make(ctx.createGain());
      node.gain.value = value;
      return node;
    };
    const filter = (type, freq, q) => {
      const node = make(ctx.createBiquadFilter());
      node.type = type;
      node.frequency.value = freq;
      node.Q.value = q;
      return node;
    };

    // ---- the engine: two locked oscillators -> saturation -> body -> level
    const f4 = IDLE / 120;
    this.oscFire = make(ctx.createOscillator());
    this.oscFire.setPeriodicWave(sound.waves.fire);
    this.oscRough = make(ctx.createOscillator());
    this.oscRough.setPeriodicWave(sound.waves.rough);
    this.freqFire = new Aim(this.oscFire.frequency, f4);
    this.freqRough = new Aim(this.oscRough.frequency, f4);
    const drive = gain(0);
    const rough = gain(0);
    this.drive = new Aim(drive.gain, 0.2);
    this.rough = new Aim(rough.gain, 0.02);
    const shaper = make(ctx.createWaveShaper());
    shaper.curve = sound.curve;
    // tanh adds harmonics without end: worked out at four times the rate, what would fold back is filtered away first
    shaper.oversample = '4x';
    const highpass = filter('highpass', 30, 0.7); // below this nothing is heard, and it only eats headroom
    const lowpass = filter('lowpass', 300, 0.7);
    this.cutoff = new Aim(lowpass.frequency, 300);
    // the rasp: a resonance high in the pipes that only a working engine at speed drives (the top end's hard edge)
    const body = filter('peaking', 1350 * own, 1.1);
    this.rasp = new Aim(body.gain, -4);
    const formant = filter('peaking', 650 * own, 0.9);
    this.formant = new Aim(formant.gain, -6);
    const engine = gain(0);
    this.engine = new Aim(engine.gain, 0);
    this.shift = gain(1);
    this.oscFire.connect(drive);
    this.oscRough.connect(rough);
    drive.connect(shaper);
    rough.connect(shaper);
    shaper.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(body);
    body.connect(formant);
    formant.connect(engine);
    engine.connect(this.shift);
    this.shift.connect(out);

    // ---- one noise source for everything of this car that hisses
    this.noise = make(audio.noiseSource());

    // no engine turns evenly: the same slow wobble on both oscillators (so they stay locked), wider at idle
    const wobble = filter('lowpass', 14, 0.5);
    const wobbleDepth = gain(0);
    this.wobble = new Aim(wobbleDepth.gain, 0);
    this.noise.connect(wobble);
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(this.oscFire.detune);
    wobbleDepth.connect(this.oscRough.detune);

    // the intake: a band of noise let through in time with the firing, by the engine's own wave
    const breathBand = filter('lowpass', 800, 1);
    this.breathBand = new Aim(breathBand.frequency, 800);
    const breathGate = gain(0.05);
    const breath = gain(0);
    this.breath = new Aim(breath.gain, 0);
    this.noise.connect(breathBand);
    breathBand.connect(breathGate);
    shaper.connect(breathGate.gain);
    breathGate.connect(breath);
    breath.connect(out);

    // the turbocharger: a narrow band that climbs with boost
    const whistleBand = filter('bandpass', 2000 * own, 26);
    this.whistleBand = new Aim(whistleBand.frequency, 2000 * own);
    const whistle = gain(0);
    this.whistle = new Aim(whistle.gain, 0);
    this.noise.connect(whistleBand);
    whistleBand.connect(whistle);
    whistle.connect(out);

    // wind round the body and the roar of the road, both rising with speed
    const windBand = filter('bandpass', 300, 0.8);
    this.windBand = new Aim(windBand.frequency, 300);
    const wind = gain(0);
    this.wind = new Aim(wind.gain, 0);
    this.noise.connect(windBand);
    windBand.connect(wind);
    wind.connect(out);
    const roadBand = filter('lowpass', 140, 0.7);
    this.roadBand = new Aim(roadBand.frequency, 140);
    const road = gain(0);
    this.road = new Aim(road.gain, 0);
    this.noise.connect(roadBand);
    roadBand.connect(road);
    road.connect(out);

    /** @type {Passing|null} sliding tyres: [0] the squeal, [1] the rougher band and the scrabble on loose ground */
    this.tyres = null;
    /** @type {Passing|null} the body along an edge */
    this.scraping = null;
    /** @type {{ osc: OscillatorNode, freq: Aim, gain: Aim, quiet: number }|null} the thrum of an uneven surface */
    this.thrum = null;

    this.oscFire.start(t);
    this.oscRough.start(t);
    this.noise.start(t, audio.noiseOffset());
  }

  /**
   * @param {number} dt s since the last call
   * @param {CarSound} car
   * @param {number} level 0..1 of this voice in the mix
   */
  update(dt, car, level) {
    const audio = this.audio;
    const mix = this.sound.mix;
    const t = audio.now;
    const ease = (tau) => 1 - Math.exp(-dt / tau);

    // ---- what the car says, made safe: a NaN must never reach an audio parameter
    const rpm = (this.rpm = finite(car.rpm, 400, 8000, this.rpm));
    const throttle = finite(car.throttle, 0, 1, 0);
    const speed = (this.speed += (finite(Math.abs(car.speed), 0, 120, this.speed) - this.speed) * ease(0.08));
    const skidNow = finite(car.skid, 0, 1, 0);
    const surface = GROUND[car.surface] ? car.surface : SURFACE.ASPHALT;
    const offroad = surface === SURFACE.ASPHALT ? 0 : finite(car.offroad, 0, 1, 1);
    const rpmN = clamp01((rpm - IDLE) / (LIMITER - IDLE));
    const gear = Number.isFinite(car.gear) ? Math.round(car.gear) : this.gear;
    this.pan = finite(car.pan, -1, 1, this.pan);
    this.tunnel += (1 - finite(car.sky, 0, 1, 1) - this.tunnel) * ease(0.12);
    const tunnel = this.tunnel;

    // ---- the engine's state: the throttle as the engine answers it, the boost as the turbo follows that
    this.load += (throttle - this.load) * ease(throttle > this.load ? 0.09 : 0.06);
    this.blip *= Math.exp(-dt / 0.1);
    const load = clamp01(this.load + this.blip);
    const boostWanted = this.load * smoothstep(1300, 2700, rpm);
    this.boost += (boostWanted - this.boost) * ease(boostWanted > this.boost ? 0.4 : 0.14);
    const boost = this.boost;

    if (this.gear !== null && gear !== this.gear && t - this.lastShift >= 0.25) {
      this.lastShift = t;
      this._shift(this.gear, gear, t);
    }
    this.gear = gear;
    this._liftOff(dt, throttle, rpm, t);

    // ---- engine
    const f4 = rpm / 120;
    this.freqFire.to(f4, t, 0.03);
    this.freqRough.to(f4, t, 0.03);
    const push = load ** 0.7;
    const low = (1 - rpmN) ** 4; // 1 at idle, gone by 3000 rpm: where single firings are heard
    this.drive.to(lerp(0.26, 0.6, push) * (1 + 0.35 * low) * (0.8 + 0.45 * rpmN), t, 0.04);
    this.rough.to((0.02 + 0.12 * load ** 1.3) * (1 - 0.5 * rpmN), t, 0.04);
    // brightness climbs faster than pitch (the note only spans a few semitones per gear), and opens with load
    this.cutoff.to(300 + 3500 * rpmN ** 2 * (0.35 + 0.65 * load) + 380 * load + 120 * low, t, 0.04);
    this.formant.to(-6 + 14 * load, t, 0.04);
    this.rasp.to(-4 + 11 * load * rpmN ** 1.5, t, 0.04);
    this.engine.to(mix.engine * (0.79 + 0.21 * load) * (0.55 + 0.45 * rpmN ** 0.9) * (1 + 0.15 * tunnel), t, 0.05);
    this.wobble.to(mix.wobble * (240 + 560 * low), t, 0.1);
    this.breathBand.to(700 + 1100 * rpmN + 500 * load, t, 0.05);
    this.breath.to(mix.breath * ((0.3 + 0.7 * load ** 1.3) * (0.5 + 0.5 * rpmN) + 1.6 * low), t, 0.05);
    this.whistleBand.to((2000 + 2200 * boost ** 0.6 + 1400 * rpmN) * this.own, t, 0.05);
    this.whistle.to(mix.whistle * boost ** 1.5 * (0.5 + 0.5 * load), t, 0.05);

    // ---- the outside world: quieter wind and a boomier road under a roof
    const g = this.ground;
    const k = ease(0.08);
    const to = GROUND[surface];
    g.roar += (lerp(1, to.roar, offroad) - g.roar) * k;
    g.squeal += (lerp(1, to.squeal, offroad) - g.squeal) * k;
    g.scrub += (to.scrub * offroad - g.scrub) * k;
    g.rumble += (to.rumble * offroad - g.rumble) * k;
    if (surface !== SURFACE.ASPHALT) g.wavelength = CAR.surfaces[surface].wavelength;
    // the air round the body and the hiss of the tread; the tread is heard from town speeds on
    this.windBand.to((280 + 13 * speed) * (1 - 0.2 * tunnel), t, 0.08);
    const v = speed / 50;
    this.wind.to(mix.wind * (v * v + 0.05 * v) * (1 - 0.3 * tunnel), t, 0.08);
    this.roadBand.to(130 + 5.5 * speed, t, 0.08);
    this.road.to(mix.road * (speed / 40) ** 1.3 * g.roar * (1 + 0.35 * tunnel), t, 0.08);

    // ---- tyres: a quick attack and a slow release, so a wheel hovering at the limit does not chatter
    const longShare = slipShare(car);
    const across = skidNow * (1 - longShare) * smoothstep(1.5, 8, speed);
    const along = skidNow * longShare;
    this.skid += (across - this.skid) * ease(across > this.skid ? 0.03 : 0.25);
    this.along += (along - this.along) * ease(along > this.along ? 0.03 : 0.2);
    // heard well before the limit (a wheel's skid is about 0.25 there) and still growing well past it
    const sing = smoothstep(0, 0.3, this.skid) * (0.75 + 0.25 * smoothstep(0.2, 0.9, this.skid)) * g.squeal;
    const howl = smoothstep(0, 0.4, this.along) * g.squeal;
    const scrub = g.scrub * (0.3 * smoothstep(1, 20, speed) + smoothstep(0, 0.4, this.skid + this.along));
    const sliding = sing + howl + scrub > 0.002;
    if (sliding && !this.tyres) this.tyres = new Passing(audio, this.bus.input, TYRE_BANDS, 2, t);
    this.tyres = this._keep(this.tyres, sliding, dt, t);
    if (this.tyres) {
      const p = this.tyres;
      // the harder the tyre is worked the lower it sings
      const pitch = (1070 - 330 * smoothstep(0.05, 0.9, this.skid)) * (1 + 0.04 * this.index);
      p.freqs[0].to(pitch, t, 0.06);
      p.freqs[1].to(pitch * 1.35, t, 0.06);
      p.gains[0].to(mix.squeal * sing, t, 0.03);
      p.freqs[2].to(lerp(700, 1500, g.scrub), t, 0.08);
      p.qs[2].to(lerp(3, 0.5, g.scrub), t, 0.08);
      p.gains[1].to(mix.scrub * (0.8 * howl ** 1.2 + scrub), t, 0.03);
    }

    // the thrum of an uneven surface coming up through the wheels, at the rate its bumps go by
    const rumble = g.rumble * smoothstep(2, 16, speed);
    if (rumble > 0.002 && !this.thrum) this.thrum = this._thrum(t);
    if (this.thrum) {
      const th = this.thrum;
      th.freq.to(clamp(speed / g.wavelength, 4, 90), t, 0.08);
      th.gain.to(mix.rumble * rumble, t, 0.05);
      th.quiet = rumble > 0.002 ? 0 : th.quiet + dt;
      if (th.quiet > 0.6) {
        th.gain.to(0, t, 0.02);
        th.osc.stop(t + 0.25);
        this.thrum = null;
      }
    }

    // ---- a body sliding along something solid
    const scrapeNow = finite(car.scrape, 0, 1, 0);
    this.scrape += (scrapeNow - this.scrape) * ease(scrapeNow > this.scrape ? 0.02 : 0.12);
    const rubbing = this.scrape > 0.004;
    const edgeKind = EDGES[car.edge] ? car.edge : 0;
    // along something else now: the old sound fades as the new one starts
    if (rubbing && this.scraping && this.scraping.edge !== edgeKind && scrapeNow > 0.004) {
      this.scraping.stop(t);
      this.scraping = null;
    }
    if (rubbing && !this.scraping) {
      const bands = EDGES[edgeKind].map((b) => ({ ...b, freq: b.freq * this.own }));
      this.scraping = new Passing(audio, this.bus.input, bands, 1, t);
      this.scraping.edge = edgeKind;
    }
    this.scraping = this._keep(this.scraping, rubbing, dt, t);
    if (this.scraping) this.scraping.gains[0].to(mix.scrape * this.scrape ** 0.8, t, 0.02);

    // ---- where it sits
    this.level.to(level, t, 0.05);
    if (this.panAim) this.panAim.to(this.pan, t, 0.08);
    this.send.to(0.38 * tunnel, t, 0.08);
  }

  /** Keep a passing voice while it is wanted, and let it go when it has been quiet for a while. */
  _keep(voice, wanted, dt, t) {
    if (!voice) return null;
    voice.quiet = wanted ? 0 : voice.quiet + dt;
    if (voice.quiet > 0.6) {
      voice.stop(t);
      return null;
    }
    return voice;
  }

  _thrum(t) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 170;
    lowpass.Q.value = 0.8;
    const gain = ctx.createGain();
    osc.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.bus.input);
    osc.start(t);
    this.audio.hold(osc, [osc, lowpass, gain]);
    return { osc, freq: new Aim(osc.frequency, 20), gain: new Aim(gain.gain, 0), quiet: 0 };
  }

  /** A gear change: going up under power the drive is cut for a moment; either way something heavy moves. */
  _shift(from, to, t) {
    const load = this.load;
    if (to > from && from >= 1) {
      const depth = lerp(0.9, 0.5, smoothstep(0.15, 0.7, load));
      const gain = this.shift.gain;
      gain.setValueAtTime(1, t);
      gain.linearRampToValueAtTime(depth, t + 0.028);
      gain.setValueAtTime(depth, t + 0.09);
      gain.linearRampToValueAtTime(1, t + 0.17);
      this.thump(0.35 + 0.65 * load);
    } else {
      // down: the box lets the revs rise at once, with a breath of throttle to meet them
      this.blip = Math.max(this.blip, 0.4 * (1 - load));
      this.thump(0.4);
    }
  }

  /** The thump of a gear going home. */
  thump(strength) {
    const k = clamp01(strength);
    const mix = this.sound.mix;
    const dest = this.bus.input;
    this.audio.tone(dest, { freq: 120, to: 60, dur: 0.08, gain: mix.thump * 1.5 * k, attack: 0.008 });
    this.audio.noise(dest, { type: 'bandpass', freq: 140, q: 1.2, dur: 0.045, gain: mix.thump * 1.6 * k, attack: 0.007 });
  }

  /** The throttle shutting on an engine that was working: the turbo sighs, and from high revs the exhaust pops. */
  _liftOff(dt, throttle, rpm, t) {
    this.worked = Math.max(this.load, this.worked - dt / 0.4);
    if (throttle > 0.06 || this.worked < 0.65 || t - this.lastLift < 1) return;
    this.lastLift = t;
    this.worked = 0;
    const mix = this.sound.mix;
    const dest = this.bus.input;
    if (this.boost > 0.4) {
      this.audio.noise(dest, { type: 'bandpass', freq: 2100, to: 1300, q: 0.9, dur: 0.24, gain: mix.whistle * 0.5 * this.boost, attack: 0.025 });
    }
    if (rpm < 3600) return;
    const pops = rpm > 5000 && this.rng.next() < 0.7 ? 2 : 1;
    let when = 0.07 + 0.09 * this.rng.next();
    for (let i = 0; i < pops; i++) {
      const soft = 1 - 0.35 * i;
      this.audio.noise(dest, { type: 'lowpass', freq: 460, to: 150, q: 0.9, when, dur: 0.07, gain: mix.pop * 1.8 * soft, attack: 0.003 });
      this.audio.tone(dest, { freq: 96, to: 58, when, dur: 0.06, gain: mix.pop * soft, attack: 0.003 });
      when += 0.11 + 0.13 * this.rng.next();
    }
  }

  /** Fade out and leave the graph (back from two cars to one). */
  dispose() {
    const t = this.audio.now;
    this.level.to(0, t, 0.03);
    for (const voice of [this.tyres, this.scraping]) if (voice) voice.stop(t);
    if (this.thrum) this.thrum.osc.stop(t + 0.25);
    this.tyres = this.scraping = this.thrum = null;
    this.oscFire.stop(t + 0.3);
    this.oscRough.stop(t + 0.3);
    this.noise.stop(t + 0.3);
    this.audio.hold(this.oscFire, this.nodes);
  }
}

/**
 * How much of a car's sliding is along its tyres (wheelspin, locked brakes) and not across them, 0..1.
 * A car that only says how much it skids is taken to slide mostly sideways.
 */
function slipShare(car) {
  const long = finite(Math.abs(car.slipLong), 0, 20, NaN);
  const lat = finite(Math.abs(car.slipLat), 0, 20, NaN);
  if (!(long + lat > 1e-3)) return 0.25;
  return long / (long + lat);
}

/**
 * What the sound needs to know about one car.
 * @typedef {object} CarSound
 * @property {number} rpm engine speed
 * @property {number} throttle 0..1 as applied (after traction control: the assists are then heard working)
 * @property {number} speed m/s
 * @property {number} gear -1 R, 1..9
 * @property {number} skid 0..1, the hardest-worked tyre (Vehicle's wheel.skid: it starts before the limit)
 * @property {number} surface SURFACE under the car
 * @property {number} scrape 0..1 sliding along a solid edge
 * @property {number} pan -1 (left) .. 1 (right): where this driver's view is
 * @property {number} sky 0..1 sky overhead (0 in the tunnel)
 * @property {number} [slipLong] slip along the tyres, in units of the slip at their peak
 * @property {number} [slipLat] slip across the tyres, in units of the slip at their peak
 * @property {number} [offroad] 0..1 how much of the car is on `surface` and not on asphalt (default: all of it)
 * @property {number} [edge] EDGE kind it is scraping along (default: a steel rail)
 */

/**
 * Fill a CarSound from a Vehicle (game/vehicle/Vehicle.js).
 * @param {import('./vehicle/Vehicle.js').Vehicle} vehicle
 * @param {number} [pan]
 * @param {Partial<CarSound>} [out]
 * @returns {CarSound}
 */
export function carSound(vehicle, pan = 0, out = {}) {
  let skid = 0;
  let long = 0;
  let lat = 0;
  let surface = SURFACE.ASPHALT;
  let off = 0;
  let down = 0;
  for (const w of vehicle.wheels) {
    if (!w.grounded) continue;
    down++;
    if (w.skid > skid) skid = w.skid;
    long = Math.max(long, Math.abs(w.slipRatio));
    lat = Math.max(lat, Math.abs(Math.tan(w.slipAngle)));
    if (w.surface !== SURFACE.ASPHALT) {
      off++;
      // of the surfaces under it, the one that grips least is the one that is heard
      if (surface === SURFACE.ASPHALT || CAR.surfaces[w.surface].rolling > CAR.surfaces[surface].rolling) surface = w.surface;
    }
  }
  out.rpm = vehicle.rpm;
  out.throttle = vehicle.throttle;
  out.speed = vehicle.speed;
  out.gear = vehicle.gear;
  out.skid = skid;
  out.slipLong = long / CAR.tyre.kappaPeak;
  out.slipLat = lat / CAR.tyre.alphaPeak;
  out.surface = surface;
  out.offroad = down ? off / down : 0;
  out.scrape = vehicle.scrape;
  out.pan = pan;
  out.sky = vehicle.sky;
  return out;
}

export class Sound {
  /**
   * @param {import('../engine/Audio.js').GameAudio} audio
   * @param {object} [o]
   * @param {number} [o.voices] the most cars heard at once
   * @param {number} [o.seed] of what is left to chance (how many pops, and when)
   * @param {Partial<typeof MIX>} [o.mix] other levels for some of the parts (a test listening to one part alone)
   */
  constructor(audio, { voices = 2, seed = 1, mix = null } = {}) {
    this.audio = audio;
    this.maxVoices = voices;
    this.mix = mix ? { ...MIX, ...mix } : MIX;
    this.rng = createRng(seed).fork('sound');
    /** @type {CarVoice[]} */
    this.voices = [];
    this.paused = false;
    this._ctx = null;
    /** @type {{ fire: PeriodicWave, rough: PeriodicWave }|null} */
    this.waves = null;
    /** @type {Float32Array|null} */
    this.curve = null;
  }

  /**
   * Once per drawn frame.
   * @param {number} dt s since the last call
   * @param {CarSound[]} cars one per car heard (see carSound)
   */
  update(dt, cars) {
    if (!this._ready()) return;
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 1 / 60;
    const count = Math.min(Array.isArray(cars) ? cars.length : 0, this.maxVoices);
    while (this.voices.length > count) this.voices.pop().dispose();
    while (this.voices.length < count) this.voices.push(new CarVoice(this, this.voices.length));
    const level = this.paused ? 0 : count > 1 ? this.mix.pair : 1;
    let tunnel = 0;
    for (let i = 0; i < count; i++) {
      const voice = this.voices[i];
      voice.update(step, cars[i] || {}, level);
      if (voice.tunnel > tunnel) tunnel = voice.tunnel;
    }
    // the reverb comes back only while someone is under the roof, so its tail does not follow a car out
    this.audio.setReverb(Math.min(1, tunnel * 1.5));
  }

  /**
   * A signal to the driver.
   * @param {'count'|'go'|'sector'|'lap'|'finish'|'ui'|'impact'|'shift'} name
   * @param {number} [pan] whose it is: that driver's side in split screen
   * @param {{ ahead?: boolean, strength?: number }} [detail] `sector`: ahead of the best lap or behind it;
   *   `impact`: closing speed in m/s
   */
  cue(name, pan = 0, detail = null) {
    if (!this._ready()) return;
    const audio = this.audio;
    const g = this.mix.cue;
    if (name === 'impact') return this.impact(detail && detail.strength !== undefined ? detail.strength : 4, pan);
    if (name === 'shift') {
      const voice = this._nearest(pan);
      if (voice) voice.thump(0.7);
      return;
    }
    const spot = audio.spot(pan);
    switch (name) {
      case 'count':
        chime(audio, spot, NOTE.count, { dur: 0.17, gain: g * 0.8 });
        break;
      case 'go': // an octave up, and it rings
        chime(audio, spot, NOTE.go, { dur: 0.95, gain: g, hold: 0.15 });
        break;
      case 'sector': {
        // an answer in two notes: up a fourth when ahead of the best lap, down a fourth when behind
        const ahead = !detail || detail.ahead !== false;
        chime(audio, spot, ahead ? NOTE.a5 : NOTE.g5, { dur: 0.13, gain: g });
        chime(audio, spot, ahead ? NOTE.d6 : NOTE.d5, { when: 0.1, dur: 0.24, gain: g });
        break;
      }
      case 'lap':
        chime(audio, spot, NOTE.c6, { dur: 0.16, gain: g });
        chime(audio, spot, NOTE.g6, { when: 0.11, dur: 0.42, gain: g * 0.9 });
        break;
      case 'finish':
        [NOTE.g5, NOTE.c6, NOTE.e6, NOTE.g6].forEach((f, i) => chime(audio, spot, f, { when: i * 0.12, dur: i === 3 ? 0.9 : 0.2, gain: g }));
        chime(audio, spot, NOTE.c6, { when: 0.36, dur: 0.9, gain: g * 0.5 });
        break;
      case 'ui':
        audio.tone(spot, { freq: NOTE.tick, dur: 0.05, gain: g * 0.9, attack: 0.003 });
        break;
      default:
        break;
    }
  }

  /**
   * A thud, scaled by how fast the two things met.
   * @param {number} strength closing speed, m/s
   * @param {number} [pan] whose it is
   */
  impact(strength, pan = 0) {
    if (!this._ready() || !(strength >= CAR.edges.impactSpeed)) return;
    const audio = this.audio;
    const t = audio.now;
    const voice = this._nearest(pan);
    if (voice) {
      if (t - voice.lastImpact < 0.15) return; // one hit, however many corners of the body reported it
      voice.lastImpact = t;
    }
    const k = clamp01(strength / 15) ** 0.7;
    const dest = voice ? voice.bus.input : audio.spot(pan);
    const g = this.mix.impact * k;
    // the body: a low thump that falls in pitch; the crunch: noise that starts open and closes; and, from a hard
    // hit, the rattle of everything that is clipped to a car
    audio.tone(dest, { freq: 105 + 50 * k, to: 46, dur: 0.15 + 0.1 * k, gain: g, attack: 0.003 });
    audio.noise(dest, { type: 'lowpass', freq: 500 + 3000 * k, to: 220, q: 0.8, dur: 0.14 + 0.2 * k, gain: g * 0.9, attack: 0.003 });
    if (k > 0.45) audio.noise(dest, { type: 'bandpass', freq: 2300, to: 1500, q: 2.5, when: 0.012, dur: 0.1 + 0.1 * k, gain: g * 0.45 * (k - 0.3), attack: 0.003 });
  }

  /** Hush the cars (the pause screen); signals still sound. */
  setPaused(paused) {
    this.paused = !!paused;
  }

  /** True when sound can be made now; also takes up a context that is new. */
  _ready() {
    const audio = this.audio;
    if (!audio || !audio.tick()) return false;
    if (audio.ctx !== this._ctx) {
      // a context of its own for everything: what was built on the last one is gone with it
      const ctx = (this._ctx = audio.ctx);
      this.voices.length = 0;
      this.waves = { fire: periodicWave(ctx, PARTIALS.fire), rough: periodicWave(ctx, PARTIALS.rough) };
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(SHAPE * ((i / (curve.length - 1)) * 2 - 1));
      this.curve = curve;
    }
    return true;
  }

  /** The car whose side of the picture `pan` is on. */
  _nearest(pan) {
    let best = null;
    for (const voice of this.voices) if (!best || Math.abs(voice.pan - pan) < Math.abs(best.pan - pan)) best = voice;
    return best;
  }
}

/** A cue's note: a sine with a soft octave over it. */
function chime(audio, spot, freq, { when = 0, dur, gain, hold = 0 }) {
  audio.tone(spot, { freq, when, dur, gain, hold });
  audio.tone(spot, { freq: freq * 2, when, dur: dur * 0.7, gain: gain * 0.22, hold: hold * 0.5 });
}

/**
 * A wave made of sines at the given multiples of the oscillator's frequency, scaled so that its peak is 1.
 * @param {BaseAudioContext} ctx
 * @param {number[][]} partials [multiple, amplitude, phase]
 */
function periodicWave(ctx, partials) {
  const top = partials.reduce((m, p) => Math.max(m, p[0]), 0);
  let peak = 0;
  for (let i = 0; i < 4096; i++) {
    const at = (i / 4096) * Math.PI * 2;
    let v = 0;
    for (const [n, a, phase] of partials) v += a * Math.sin(n * at + phase);
    peak = Math.max(peak, Math.abs(v));
  }
  const real = new Float32Array(top + 1);
  const imag = new Float32Array(top + 1);
  for (const [n, a, phase] of partials) {
    real[n] = (a * Math.sin(phase)) / peak;
    imag[n] = (a * Math.cos(phase)) / peak;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}
