// Dev-only sound bench (sound.html, not part of the build): the audio shell
// and the car's voice on their own, driven by scripted scenarios, so that the
// sound can be heard, looked at and measured before and apart from the game.
//
// A scenario is plain data: what each car is doing at a few moments
// (key frames, joined by straight lines) and what happens when (cues,
// impacts, mute). The same data is played three ways:
//
//   live     through the speakers, started by a button (a gesture), with a
//            scope and a spectrum of what comes out;
//   render   offline, faster than real time, into a spectrogram on the page
//            (sound.html?render=NAME draws one at once, for a screenshot);
//   tests    tools/soundtest.cjs calls __sound.render() with scenarios of
//            its own and measures the samples.
//
// Some scenarios are driven by the real car (Vehicle, AutoDriver, the real
// track), so what the sound is given here is what the game will give it.
//
// Handle: window.__sound = { audio, sound, names, scenario(name),
//   render(nameOrScenario, { fps, rate, mute, voices, mix }), show(name),
//   play(name), stop(), analyser(), GameAudio, Sound, SPLIT_PAN }

import { GameAudio } from './engine/Audio.js';
import { AutoDriver } from './game/drivers.js';
import { SPLIT_PAN, Sound, carSound } from './game/Sound.js';
import { createTrack } from './game/track.js';
import { Vehicle, collideVehicles } from './game/vehicle/Vehicle.js';

const STEP = 1 / 120;

/**
 * @typedef {object} Scenario
 * @property {string} [title]
 * @property {number} duration s
 * @property {Array<{ keys: Array<[number, object]> }>} cars per car: [time, CarSound fields] in order of time
 * @property {Array<{ t: number, cue?: string, impact?: number, pan?: number, detail?: object, mute?: boolean,
 *   paused?: boolean, voices?: number }>} [events] `voices`: from then on only that many cars are heard
 */

// ------------------------------------------------------------------ scenarios

const still = (over = {}) => ({ rpm: 750, throttle: 0, speed: 0, gear: 1, skid: 0, surface: 0, scrape: 0, pan: 0, sky: 1, ...over });
const cruise = (over = {}) => still({ rpm: 1900, throttle: 0.22, speed: 27.8, gear: 6, ...over });

/** An endless level plane for the car to run on. */
const PLANE = {
  surfaceAt(x, z, hint, out) {
    out.y = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.surface = 0;
    out.grip = 1;
    out.s = z;
    out.lat = x;
    out.index = 0;
    out.edgeL = Infinity;
    out.edgeR = Infinity;
    out.sky = 1;
    return out;
  },
};

/** The real car on the plane, its pedals worked by `pedals(t, car, controls)`: what it tells the sound, 60 times a second. */
function drive(seconds, pedals) {
  const car = new Vehicle(PLANE);
  car.reset({ x: 0, y: 0, z: 0, yaw: 0 });
  const controls = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  const keys = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    if (i % 2 === 0) keys.push([t, carSound(car, 0, {})]);
    pedals(t, car, controls);
    car.step(STEP, controls);
  }
  return keys;
}

let track = null;

/** Cars on the real road with the autopilot, from the grid: countdown, go, and what they meet on the way. */
function race(seconds, paces, pans) {
  if (!track) track = createTrack();
  const go = 4.6;
  const events = [];
  for (let k = 0; k < 5; k++) events.push({ t: go - 0.7 * (5 - k), cue: 'count' });
  events.push({ t: go, cue: 'go' });
  const racers = paces.map((pace, i) => {
    const vehicle = new Vehicle(track);
    vehicle.reset(track.grid(i));
    return {
      vehicle,
      driver: new AutoDriver(track, { pace, bias: paces.length > 1 ? (i ? -1.6 : 1.6) : 0 }),
      controls: { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
      keys: [],
      sector: 0,
      lastS: vehicle.s,
    };
  });
  const hits = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    racers.forEach((r, n) => {
      if (i % 2 === 0) r.keys.push([t, carSound(r.vehicle, pans[n], {})]);
      if (t < go) {
        // held on the line; the last second on the throttle against the brakes
        r.controls.steer = 0;
        r.controls.throttle = t > go - 0.9 ? 0.6 : 0;
        r.controls.brake = 1;
        r.controls.hold = true;
      } else {
        r.controls.hold = false;
        r.driver.drive(r.vehicle, STEP, r.controls);
      }
      r.vehicle.step(STEP, r.controls);
    });
    if (racers.length > 1) collideVehicles(racers[0].vehicle, racers[1].vehicle);
    racers.forEach((r, n) => {
      hits.length = 0;
      r.vehicle.drainImpacts(hits);
      let hardest = 0;
      for (const hit of hits) hardest = Math.max(hardest, hit.strength);
      if (hardest > 0) events.push({ t: t + STEP, impact: hardest, pan: pans[n] });
      const line = track.sectors[r.sector];
      if (line !== undefined && r.lastS < line && r.vehicle.s >= line) {
        events.push({ t: t + STEP, cue: 'sector', pan: pans[n], detail: { ahead: n === 0 } });
        r.sector++;
      }
      r.lastS = r.vehicle.s;
    });
  }
  events.sort((a, b) => a.t - b.t);
  return { duration: seconds, cars: racers.map((r) => ({ keys: r.keys })), events };
}

/** @type {Record<string, () => Scenario>} */
const SCENARIOS = {
  idle: () => ({
    title: 'Idle, and two prods of the throttle against the brakes',
    duration: 6,
    cars: [{ keys: [[0, still()], [2, still()], [2.5, still({ rpm: 2300, throttle: 1 })], [2.9, still({ rpm: 2350, throttle: 1 })],
      [2.95, still({ rpm: 2300, throttle: 0 })], [3.7, still()], [4.2, still()], [4.5, still({ rpm: 1800, throttle: 0.6 })],
      [4.6, still({ rpm: 1800, throttle: 0 })], [5.2, still()]] }],
  }),
  run: () => ({
    title: 'Full throttle from rest through the gears, then off',
    duration: 18,
    cars: [{ keys: drive(18, (t, car, c) => {
      c.throttle = t > 0.5 && t < 14.5 ? 1 : 0;
      c.brake = t > 16 ? 0.5 : 0;
    }) }],
  }),
  liftoff: () => ({
    title: 'On and off the throttle at high revs',
    duration: 12,
    cars: [{ keys: drive(12, (t, car, c) => {
      c.throttle = t < 4.2 || (t > 5.6 && t < 7.4) || (t > 8.6 && t < 9.2) ? 1 : t > 10 ? 0.3 : 0;
    }) }],
  }),
  tunnel: () => ({
    title: 'A cruise into the tunnel and out again, with a thud inside and one outside',
    duration: 13,
    cars: [{ keys: [[0, cruise({ speed: 30 })], [2, cruise({ speed: 30 })], [3, cruise({ speed: 30, sky: 0 })], [7.5, cruise({ speed: 30, sky: 0 })],
      [8.5, cruise({ speed: 30 })], [13, cruise({ speed: 30 })]] }],
    events: [{ t: 5, impact: 6 }, { t: 10.5, impact: 6 }],
  }),
  skid: () => ({
    title: 'Tyres: up to the limit, over it, on the grass, on the shoulder, wheelspin',
    duration: 15,
    cars: [{ keys: [[0, cruise({ speed: 25 })], [1.5, cruise({ speed: 25 })], [2.5, cruise({ speed: 25, skid: 0.2, slipLat: 1 })],
      [3.5, cruise({ speed: 25, skid: 0.2, slipLat: 1 })], [4.5, cruise({ speed: 24, skid: 0.9, slipLat: 2 })],
      [5.5, cruise({ speed: 22, skid: 0.9, slipLat: 2 })], [5.6, cruise({ speed: 22 })], [7, cruise({ speed: 22 })],
      [7.01, cruise({ speed: 22, surface: 2 })], [7.5, cruise({ speed: 22, surface: 2, skid: 0.6, slipLat: 2 })],
      [9, cruise({ speed: 20, surface: 2, skid: 0.6, slipLat: 2 })], [9.01, cruise({ speed: 20 })], [10, cruise({ speed: 22 })],
      [10.01, cruise({ speed: 22, surface: 1 })], [11.5, cruise({ speed: 22, surface: 1 })], [11.51, cruise({ speed: 22 })],
      [12.5, cruise({ speed: 8, rpm: 3000, gear: 1 })], [12.6, cruise({ speed: 8, rpm: 4200, throttle: 0.9, gear: 1, skid: 0.7, slipLong: 4 })],
      [14, cruise({ speed: 12, rpm: 4800, throttle: 0.9, gear: 1, skid: 0.7, slipLong: 4 })], [14.1, cruise({ speed: 13, rpm: 4000, gear: 1 })]] }],
  }),
  impacts: () => ({
    title: 'Four thuds of rising strength, then along a rail, then along rock',
    duration: 11,
    cars: [{ keys: [[0, cruise({ speed: 14, rpm: 1500 })], [5, cruise({ speed: 14, rpm: 1500 })], [5.2, cruise({ speed: 14, rpm: 1500, scrape: 0.8 })],
      [6.8, cruise({ speed: 12, rpm: 1500, scrape: 0.5 })], [7, cruise({ speed: 12, rpm: 1500 })], [8.2, cruise({ speed: 12, rpm: 1500, edge: 1 })],
      [8.4, cruise({ speed: 12, rpm: 1500, scrape: 0.8, edge: 1 })], [9.8, cruise({ speed: 10, rpm: 1400, scrape: 0.6, edge: 1 })],
      [10, cruise({ speed: 10, rpm: 1400, edge: 1 })]] }],
    events: [{ t: 1, impact: 1 }, { t: 2, impact: 3 }, { t: 3, impact: 7 }, { t: 4, impact: 15 }],
  }),
  cues: () => ({
    title: 'Every signal: count, go, sector ahead, sector behind, lap, finish, tick, shift',
    duration: 13,
    cars: [{ keys: [[0, still()], [13, still()]] }],
    events: [{ t: 1, cue: 'count' }, { t: 1.7, cue: 'count' }, { t: 2.4, cue: 'count' }, { t: 3.1, cue: 'count' }, { t: 3.8, cue: 'count' },
      { t: 4.5, cue: 'go' }, { t: 6, cue: 'sector', detail: { ahead: true } }, { t: 7, cue: 'sector', detail: { ahead: false } },
      { t: 8, cue: 'lap' }, { t: 9, cue: 'finish' }, { t: 11, cue: 'ui' }, { t: 11.4, cue: 'ui' }, { t: 12, cue: 'shift' }],
  }),
  split: () => ({ title: 'Two cars from the grid, each on its side', ...race(40, [0.95, 0.88], [-SPLIT_PAN, SPLIT_PAN]) }),
  lap: () => ({ title: 'One car and the autopilot: the first 75 s of a lap, tunnel included', ...race(75, [0.95], [0]) }),
};

const built = new Map();

/** @param {string} name @returns {Scenario} */
function scenario(name) {
  if (!SCENARIOS[name]) throw new Error(`No such scenario: ${name}`);
  if (!built.has(name)) built.set(name, SCENARIOS[name]());
  return built.get(name);
}

// ------------------------------------------------------------------ playing a scenario

const STEPPED = new Set(['gear', 'surface', 'edge']);

/** What a car is doing at time `t`: straight lines between its key frames (gear and surface do not blend). */
function carAt(car, t, out) {
  const keys = car.keys;
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, a] = keys[lo];
  const [t1, b] = keys[hi];
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  for (const key of Object.keys(a)) out[key] = STEPPED.has(key) || typeof a[key] !== 'number' || typeof b[key] !== 'number' ? (f < 1 ? a[key] : b[key]) : a[key] + (b[key] - a[key]) * f;
  return out;
}

/** Steps a scenario: fires what is due, then tells the sound what the cars are doing. */
class Player {
  /**
   * @param {Scenario} data
   * @param {GameAudio} audio
   * @param {Sound} sound
   */
  constructor(data, audio, sound) {
    this.data = data;
    this.audio = audio;
    this.sound = sound;
    this.events = [...(data.events || [])].sort((a, b) => a.t - b.t);
    this.next = 0;
    this.voices = data.cars.length;
    this.cars = data.cars.map(() => ({}));
    /** What was asked for, and when: { t, ...event } */
    this.log = [];
  }

  /**
   * @param {number} t scenario time now
   * @param {number} dt since the last step
   * @param {(t: number) => void} [at] called before each event with its exact time (an offline render sets its clock)
   */
  step(t, dt, at) {
    while (this.next < this.events.length && this.events[this.next].t <= t) {
      const e = this.events[this.next++];
      if (at) at(e.t);
      if (e.cue) this.sound.cue(e.cue, e.pan || 0, e.detail || null);
      if (e.impact !== undefined) this.sound.impact(e.impact, e.pan || 0);
      if (e.mute !== undefined) this.audio.setMuted(e.mute);
      if (e.paused !== undefined) this.sound.setPaused(e.paused);
      if (e.voices !== undefined) this.voices = e.voices;
      this.log.push(e);
    }
    if (at) at(t);
    const n = Math.min(this.voices, this.data.cars.length);
    for (let i = 0; i < n; i++) carAt(this.data.cars[i], t, this.cars[i]);
    this.sound.update(dt, this.cars.slice(0, n));
  }
}

// ------------------------------------------------------------------ offline

const CREATORS = ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createWaveShaper',
  'createConvolver', 'createDynamicsCompressor', 'createDelay', 'createConstantSource', 'createAnalyser', 'createChannelMerger',
  'createChannelSplitter', 'createPanner', 'createIIRFilter'];

/**
 * Render a scenario without speakers and without real time.
 * @param {string|Scenario} what a scenario's name, or one given as data
 * @param {object} [o]
 * @param {number} [o.fps] how often the sound is told about the cars
 * @param {number} [o.rate] sample rate
 * @param {boolean} [o.mute] as the page's ?mute
 * @param {number} [o.voices] the most cars the sound will voice
 * @param {object} [o.mix] other levels for some of the sound's parts (see Sound)
 * @param {boolean} [o.raw] return Float32Arrays instead of base64 text (inside the page)
 */
async function render(what, { fps = 60, rate = 48000, mute = false, voices = 2, mix = null, raw = false } = {}) {
  const data = typeof what === 'string' ? scenario(what) : what;
  const ctx = new OfflineAudioContext(2, Math.ceil(data.duration * rate), rate);
  // count every node made on this context: the graph's size is one of the things measured
  let created = 0;
  const kinds = {};
  for (const name of CREATORS) {
    const original = ctx[name];
    if (typeof original !== 'function') continue;
    ctx[name] = (...args) => {
      created++;
      kinds[name] = (kinds[name] || 0) + 1;
      return original.apply(ctx, args);
    };
  }
  let clock = 0;
  const audio = new GameAudio({ context: ctx, clock: () => clock, mute, storageKey: '' });
  const sound = new Sound(audio, { voices, mix });
  const player = new Player(data, audio, sound);
  const dt = 1 / fps;
  const steps = Math.floor(data.duration * fps);
  let most = 0;
  let cruising = 0;
  for (let i = 0; i <= steps; i++) {
    player.step(i * dt, dt, (t) => (clock = t));
    most = Math.max(most, audio.live);
    if (i === Math.floor(steps / 2)) cruising = created;
  }
  const buffer = await ctx.startRendering();
  await new Promise((resolve) => setTimeout(resolve, 30)); // let the last sources report that they have ended
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const impulse = audio.impulse;
  return {
    rate,
    seconds: buffer.length / rate,
    left: raw ? left : encode(left),
    right: raw ? right : encode(right),
    log: player.log,
    nodes: { created, halfway: cruising, kinds, live: audio.live, mostLive: most },
    impulse: raw ? null : { rate: impulse.sampleRate, left: encode(impulse.getChannelData(0)), right: encode(impulse.getChannelData(1)) },
  };
}

/** A Float32Array as base64 text, to hand to a test outside the page. */
function encode(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * The spectrum of a rendered sound through time, taken by the browser's own analyser on a second offline pass.
 * @returns {Promise<{ columns: Float32Array[], bins: number, hop: number, rate: number }>} dB per bin, per column
 */
async function spectrogram(left, right, rate, fftSize = 8192) {
  const n = left.length;
  const ctx = new OfflineAudioContext(1, n, rate);
  const buffer = ctx.createBuffer(1, n, rate);
  const mono = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) * 0.5;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  src.start(0);
  // as many columns as there is room to draw, each a whole number of render blocks apart
  const hop = Math.max(8, Math.ceil(n / 1400 / 128)) * 128;
  const columns = [];
  for (let frame = hop; frame < n; frame += hop) {
    ctx.suspend(frame / rate).then(() => {
      const column = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(column);
      columns.push(column);
      ctx.resume();
    });
  }
  await ctx.startRendering();
  return { columns, bins: analyser.frequencyBinCount, hop, rate };
}

// ------------------------------------------------------------------ pictures

const INK = '#c9ced6';
const DIM = '#5d6672';

/** dB (-110..-15) to a colour: black, blue, magenta, orange, white. */
function heat(db) {
  const v = Math.min(1, Math.max(0, (db + 110) / 95));
  const r = Math.round(255 * Math.min(1, Math.max(0, v * 2.4 - 0.5)));
  const g = Math.round(255 * Math.min(1, Math.max(0, v * 2.6 - 1.35)));
  const b = Math.round(255 * Math.min(1, Math.max(0, v < 0.5 ? v * 1.7 : 0.85 - (v - 0.5) * 1.9 + Math.max(0, v - 0.8) * 5)));
  return [r, g, b];
}

/**
 * Draw one rendered scenario: its wave's envelope with the events marked, the spectrum up to 2.5 kHz on a
 * straight scale (where the engine's harmonics can be told apart) and all of it on a logarithmic one.
 */
function drawRender(canvas, result, spec, title) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const pad = 46;
  const w = W - pad - 8;
  g.fillStyle = '#07090c';
  g.fillRect(0, 0, W, H);
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = INK;
  g.fillText(title, pad, 13);
  const { left, right, rate, seconds } = result;
  const n = left.length;

  // envelope
  const top = 20;
  const eh = 70;
  g.strokeStyle = DIM;
  g.strokeRect(pad, top, w, eh);
  g.fillStyle = '#7fb4ff';
  let peak = 0;
  for (let x = 0; x < w; x++) {
    const a = Math.floor((x / w) * n);
    const b = Math.floor(((x + 1) / w) * n);
    let m = 0;
    for (let i = a; i < b; i++) m = Math.max(m, Math.abs(left[i]), Math.abs(right[i]));
    peak = Math.max(peak, m);
    const h = Math.min(1, m) * (eh / 2);
    g.fillRect(pad + x, top + eh / 2 - h, 1, 2 * h || 1);
  }
  g.fillStyle = INK;
  g.fillText(`peak ${(20 * Math.log10(Math.max(peak, 1e-9))).toFixed(1)} dBFS`, pad + 6, top + 12);
  g.fillStyle = '#ffd27f';
  for (const e of result.log) {
    const x = pad + (e.t / seconds) * w;
    g.fillRect(x, top, 1, eh);
    g.fillText(e.cue || (e.impact !== undefined ? `hit ${e.impact.toFixed(0)}` : e.mute !== undefined ? 'mute' : ''), x + 2, top + eh - 3);
  }

  const panel = (y, h, toRow, ticks) => {
    const image = g.createImageData(w, h);
    const cols = spec.columns.length;
    for (let x = 0; x < w; x++) {
      const column = spec.columns[Math.min(cols - 1, Math.floor((x / w) * cols))];
      for (let row = 0; row < h; row++) {
        const f0 = toRow(row + 1);
        const f1 = toRow(row);
        const b0 = Math.max(1, Math.floor((f0 / (rate / 2)) * spec.bins));
        const b1 = Math.max(b0 + 1, Math.ceil((f1 / (rate / 2)) * spec.bins));
        let db = -200;
        for (let bin = b0; bin < b1 && bin < spec.bins; bin++) db = Math.max(db, column[bin]);
        const [r, gg, b] = heat(db);
        const o = (row * w + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = gg;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
      }
    }
    g.putImageData(image, pad, y);
    g.fillStyle = INK;
    for (const f of ticks) {
      let row = 0;
      while (row < h && toRow(row) > f) row++;
      g.fillRect(pad - 4, y + row, 4, 1);
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 4, y + row + 4);
    }
  };
  const lin = Math.round((H - top - eh - 40) * 0.5);
  const log = H - top - eh - 40 - lin;
  const y1 = top + eh + 12;
  panel(y1, lin, (row) => 2500 * (1 - row / lin), [0, 250, 500, 750, 1000, 1500, 2000, 2500]);
  const y2 = y1 + lin + 10;
  panel(y2, log, (row) => 20 * 1000 ** (1 - row / log), [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
  g.fillStyle = INK;
  for (let s = 0; s <= seconds; s += seconds > 30 ? 5 : 1) g.fillText(String(s), pad + (s / seconds) * w - 3, H - 4);
}

// ------------------------------------------------------------------ the page

const query = new URLSearchParams(location.search);
const audio = new GameAudio({ mute: query.has('mute') }).listen();
const sound = new Sound(audio);
const page = document.getElementById('bench');
const status = document.getElementById('status');
const scope = /** @type {HTMLCanvasElement} */ (document.getElementById('scope'));
const picture = /** @type {HTMLCanvasElement} */ (document.getElementById('picture'));

let playing = null;
let analyser = null;
let wave = null;
let bands = null;

function stop() {
  playing = null;
  sound.update(1 / 60, []);
}

/** Play a scenario through the speakers. Call from a click: this is the gesture that starts the sound. */
function play(name) {
  audio.unlock();
  if (!audio.ctx) {
    status.textContent = audio.muted ? 'muted: no sound is made (press Sound on)' : 'this browser gave no audio context';
    return false;
  }
  if (!analyser && audio.output) {
    analyser = audio.ctx.createAnalyser();
    analyser.fftSize = 4096;
    audio.output.connect(analyser);
    wave = new Float32Array(analyser.fftSize);
    bands = new Float32Array(analyser.frequencyBinCount);
  }
  playing = { name, player: new Player(scenario(name), audio, sound), t0: audio.ctx.currentTime, last: 0 };
  return true;
}

function frame() {
  requestAnimationFrame(frame);
  const ctx = audio.ctx;
  let line = ctx ? `context ${ctx.state}, ${ctx.sampleRate} Hz` : 'no context yet: press a scenario';
  if (audio.muted) line += ', muted';
  if (playing && ctx && ctx.state === 'running') {
    const t = ctx.currentTime - playing.t0;
    playing.player.step(t, Math.max(0, t - playing.last));
    playing.last = t;
    const car = playing.player.cars[0];
    line += ` | ${playing.name} ${t.toFixed(1)} s | ${Math.round(car.rpm)} rpm, gear ${car.gear}, throttle ${(car.throttle * 100).toFixed(0)} %, ${(car.speed * 3.6).toFixed(0)} km/h`;
    if (t >= playing.player.data.duration) stop();
  } else if (ctx) sound.update(1 / 60, []);
  status.textContent = line;
  if (analyser) drawLive();
}

/** The scope (what the wave looks like now) over the spectrum (20 Hz to 20 kHz, 10 dB a line). */
function drawLive() {
  const g = scope.getContext('2d');
  const W = scope.width;
  const H = scope.height;
  analyser.getFloatTimeDomainData(wave);
  analyser.getFloatFrequencyData(bands);
  g.fillStyle = '#07090c';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1b2129';
  for (let db = -100; db <= -20; db += 10) {
    const y = H * 0.4 + ((-20 - db) / 90) * H * 0.6;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.strokeStyle = '#7fb4ff';
  g.beginPath();
  for (let x = 0; x < W; x++) {
    const v = wave[Math.floor((x / W) * 2048)];
    const y = H * 0.2 - v * H * 0.19;
    if (x) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.strokeStyle = '#ffd27f';
  g.beginPath();
  const nyquist = audio.ctx.sampleRate / 2;
  for (let x = 0; x < W; x++) {
    const f = 20 * 1000 ** (x / W);
    const db = bands[Math.min(bands.length - 1, Math.round((f / nyquist) * bands.length))];
    const y = H * 0.4 + (Math.min(90, Math.max(0, -20 - db)) / 90) * H * 0.6;
    if (x) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  let sum = 0;
  let peak = 0;
  for (const v of wave) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  g.fillStyle = INK;
  g.font = '11px system-ui, sans-serif';
  const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  g.fillText(`rms ${db(Math.sqrt(sum / wave.length))} dBFS   peak ${db(peak)} dBFS`, 8, 14);
}

/** Render a scenario offline and draw it. */
async function show(name, options = {}) {
  status.textContent = `rendering ${name}…`;
  const result = await render(name, { ...options, raw: true });
  const spec = await spectrogram(result.left, result.right, result.rate);
  drawRender(picture, result, spec, `${name}: ${scenario(name).title || ''}   (${result.nodes.halfway} nodes half way, ${result.nodes.created} made in all)`);
  status.textContent = `${name} rendered`;
  return result;
}

for (const name of Object.keys(SCENARIOS)) {
  const row = document.createElement('div');
  const playButton = document.createElement('button');
  playButton.textContent = name;
  playButton.title = 'play';
  playButton.addEventListener('click', () => play(name));
  const showButton = document.createElement('button');
  showButton.textContent = 'picture';
  showButton.className = 'quiet';
  showButton.addEventListener('click', () => show(name));
  row.append(playButton, showButton);
  page.append(row);
}
const row = document.createElement('div');
const stopButton = document.createElement('button');
stopButton.textContent = 'stop';
stopButton.addEventListener('click', stop);
const muteButton = document.createElement('button');
const label = () => (muteButton.textContent = audio.muted ? 'Sound on' : 'Sound off');
muteButton.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  label();
});
label();
row.append(stopButton, muteButton);
page.append(row);

window.__sound = { audio, sound, names: Object.keys(SCENARIOS), scenario, render, show, play, stop, analyser: () => analyser, GameAudio, Sound, SPLIT_PAN };

requestAnimationFrame(frame);
if (query.get('render')) {
  show(query.get('render'), { fps: parseFloat(query.get('fps')) || 60 })
    .catch((err) => (status.textContent = String(err)))
    .then(() => (window.__ready = true));
} else window.__ready = true;
