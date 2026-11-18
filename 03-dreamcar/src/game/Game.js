// The conductor: who drives what, the flow of a run, and how a frame is put
// together from the world, the cars and the frame pipeline.
//
//   update(dt)      the fixed step. Everything with a memory changes here and
//                   only here: drivers, vehicles, collisions, the race, the
//                   camera rigs, the exposure, the cars' lamps, the world. A
//                   run that is fast-forwarded without drawing is the same run.
//   render(alpha)   once per drawn frame: pose the models and the cameras
//                   between the last two steps, refresh the HUD, feed the
//                   sound. Changes nothing that the next step reads.
//   draw()          for each view: the car's reflection probe on a budget,
//                   the world prepares for that camera, the pipeline draws the
//                   scene into the view's rectangle.
//
// Phases: title -> countdown -> run -> results, with pause on top (the engine
// keeps drawing, the fixed step stops). A view is one local driver's part of
// the screen: one in solo, two in split screen, side by side on a wide window
// and stacked on a tall one. Moments from the hands (a key, a pad button, a
// HUD button) arrive as actions; the one that changes the run (putting a car
// back) waits for the next fixed step.

import * as THREE from 'three';
import { createCar } from '../assets/car/index.js';
import { LAMPS as CAR_LAMPS } from '../assets/car/spec.js';
import { createWorld } from '../assets/world/index.js';
import { canopyOpen } from '../assets/world/canopy.js';
import { TIMES } from '../assets/world/lighting.js';
import { Engine, FIXED_DT } from '../engine/Engine.js';
import { FramePipeline } from '../engine/FramePipeline.js';
import { Input } from '../engine/Input.js';
import { ReflectionProbe } from '../engine/ReflectionProbe.js';
import { TIERS, probeCaps } from '../engine/caps.js';
import { clamp, clamp01, damp, lerp } from '../engine/math.js';
import { createRng } from '../engine/rng.js';
import { CameraRig } from './Cameras.js';
import { ASSISTS, CAMERA, DEFAULT_TIME, DRIVERS, EXPOSURE, FX, HUD, LIGHTS, PHOTOS, PROBE, RULES, SHOWCASE, VIEW } from './config.js';
import { AutoDriver, PlayerDriver } from './drivers.js';
import { Effects } from './effects.js';
import { Ghost } from './Ghost.js';
import { Hud } from './Hud.js';
import { Race, medalOf } from './Race.js';
import { TEXT } from './text.js';
import { createTrack } from './track.js';
import { Vehicle, collideVehicles } from './vehicle/Vehicle.js';

// SEAM for the sound lane: game/Sound.js and engine/Audio.js are wired when they are there (an empty match when not).
const soundModules = import.meta.glob(['./Sound.js', '../engine/Audio.js'], { eager: true });

/**
 * One car in the run.
 * @typedef {object} Racer
 * @property {number} index
 * @property {import('../assets/car/index.js').CarModel} car what is drawn
 * @property {Vehicle} vehicle what is simulated
 * @property {PlayerDriver} player the person's hands
 * @property {AutoDriver} auto the autopilot (?ap, and home after the flag)
 * @property {PlayerDriver|AutoDriver} driver who holds the wheel now
 * @property {{ steer: number, throttle: number, brake: number, handbrake: number, analog: boolean }} controls
 * @property {Array<{ steer: number, travel: number }>} prevWheels the wheels before the last step
 * @property {object[]} impacts drained in the last step (shared by the sound and the effects)
 * @property {object} lamps what the lamps show (CarModel.setLights), decided in the fixed step
 * @property {string} offer why a put-back is offered ('' for none)
 *
 * One local driver's part of the screen.
 * @typedef {object} View
 * @property {Racer} racer
 * @property {THREE.PerspectiveCamera} camera
 * @property {CameraRig} rig
 * @property {import('./Hud.js').ViewHud} hud
 * @property {{ x: number, y: number, w: number, h: number }} rect device pixels, GL origin
 * @property {{ left: number, top: number, width: number, height: number }} zone the same as fractions of the window
 *   from the top left: for the HTML overlay and for touches
 * @property {import('../engine/FramePipeline.js').ViewFrame} frame what the pipeline is told about it
 * @property {number} exposure eased in the fixed step
 * @property {ReflectionProbe|null} probe
 */

/** How much of the car's bounding box, from the ground up, is left out of the motion blur's sharp box (m). */
const SHARP_LIFT = 0.1;
/** Set once a first-time player has got going, so the hint does not come back. */
const HINT_KEY = 'dreamcar.hinted.v1';
/** The player's choices kept on this device: the quality (auto, low, medium, high), the speed's units, the map. */
const QUALITY_KEY = 'dreamcar.quality';
const UNITS_KEY = 'dreamcar.units';
const MAP_KEY = 'dreamcar.map';
const QUALITIES = ['auto', 'low', 'medium', 'high'];
/** The driving help (ASSISTS.levels in config.js), the touch throttle ('auto' | 'manual'), and the touch zones' first-run naming. */
const ASSISTS_KEY = 'dreamcar.assists';
const THROTTLE_KEY = 'dreamcar.throttle';
const ZONES_KEY = 'dreamcar.zones.v1';

/** Read a kept choice (null when there is none or no storage). */
function kept(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no storage: the choice lasts this page only
  }
}
/** The car at rest, held on its brakes (the title, the grid). */
const HELD = { steer: 0, throttle: 0, brake: 0, handbrake: 1 };

const probeAt = new THREE.Vector3();
const probeHidden = [];
const mirrorHidden = [];
const frameOut = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
const putAt = new THREE.Vector3();
const shadowPoint = new THREE.Vector3();
const shadowNormal = new THREE.Vector3();
const surface = {};
const lookRead = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false, lookBack: false };

export class Game {
  /**
   * @param {HTMLElement} container
   * @param {import('../engine/params.js').Params} params
   */
  constructor(container, params) {
    this.params = params;
    this.container = container;
    const engine = new Engine(container, { manual: params.manual, pixelRatio: params.dpr, draw: !params.nodraw });
    this.engine = engine;
    this.caps = probeCaps(engine.renderer, { ldr: params.ldr });
    /** @type {import('../engine/caps.js').Tier} */
    // ?q= wins; then the quality chosen in the options (dreamcar.quality); 'auto' is what the probe chose
    const stored = kept(QUALITY_KEY);
    /** The options' choice: 'auto' | 'low' | 'medium' | 'high'. */
    this.qualityChoice = QUALITIES.includes(stored) ? stored : 'auto';
    this.tier = params.quality ?? (this.qualityChoice !== 'auto' ? this.qualityChoice : this.caps.tier);
    /** km/h or mph, and whether the map shows (the options; kept on the device). */
    this.units = kept(UNITS_KEY) === 'mph' ? 'mph' : 'kmh';
    this.mapShown = kept(MAP_KEY) !== 'off';
    /** The driving help every car gets (a key of ASSISTS.levels), and the touch throttle. */
    const help = kept(ASSISTS_KEY);
    this.assists = help && ASSISTS.levels[help] ? help : ASSISTS.default;
    this.throttle = kept(THROTTLE_KEY) === 'manual' ? 'manual' : 'auto';
    this._zonesSeen = kept(ZONES_KEY) === '1';
    engine.setMaxPixelRatio(TIERS[this.tier].pixelRatio);
    this.rng = createRng(params.seed);

    this.pipeline = new FramePipeline(engine.renderer, this.caps, { tier: this.tier, post: params.post });
    this.pipeline.debug = params.debug;
    this.track = createTrack();
    // the times of day are whatever lighting.js has, in its order; the demo opens at DEFAULT_TIME (config.js: null, the first)
    params = { ...params, time: params.time && TIMES[params.time] ? params.time : DEFAULT_TIME && TIMES[DEFAULT_TIME] ? DEFAULT_TIME : Object.keys(TIMES)[0] };
    this.params = params;
    this.world = createWorld({ renderer: engine.renderer, caps: this.caps, tier: this.tier, track: this.track, rng: this.rng, params });
    if (this.world.time.name !== params.time) this.world.setTime(params.time);
    this.effects = new Effects({
      scene: this.world.scene,
      track: this.track,
      tier: this.tier,
      rng: this.rng.fork('effects'),
      world: this.world,
      cars: 2,
      enabled: params.fx,
    });

    this.input = new Input(container);
    this.input.throttle = this.throttle;
    this.input.onAction = (name, driver) => this.action(name, driver);
    this.input.onTouchChange = () => (this._touchDirty = true);
    this.input.onAnyInput = () => {
      this._woke = true;
      this._unlockSound();
    };
    this.hud = new Hud(container, {
      enabled: params.ui,
      onAction: (name, driver) => {
        this._unlockSound();
        if (this.sound) this.sound.cue('ui');
        this.action(name, driver);
      },
    });

    // SEAM: sound
    this.audio = null;
    this.sound = null;
    const Audio = soundModules['../engine/Audio.js'];
    const SoundModule = soundModules['./Sound.js'];
    if (Audio && SoundModule && Audio.GameAudio && SoundModule.Sound) {
      // ?mute: silent for this page only (not remembered); otherwise the last visit's choice
      this.audio = new Audio.GameAudio({ mute: params.mute });
      // every gesture on the page unlocks it; a hidden tab puts it to sleep
      this.audio.listen(container);
      this.sound = new SoundModule.Sound(this.audio, { voices: 2, seed: params.seed });
      this._carSound = SoundModule.carSound;
      this._sounds = [{}, {}];
    }
    this.muted = !this.sound || this.audio.muted;

    /** title | countdown | run | results */
    this.phase = 'title';
    /** @type {'solo'|'split'} */
    this.mode = params.mode;
    this.laps = params.laps ?? RULES.laps;
    /** @type {Race|null} */
    this.race = null;
    this.runs = 0;
    this.highBeam = false;
    /** The best lap's ghost (solo): its recordings, whether it shows (G), and the car that shows it. */
    this.ghost = new Ghost(this.track.length);
    this.ghostOn = true;
    this.ghostCar = null;
    /** Per driver: the camera mode they chose. */
    this.cameraModes = [params.camera, params.camera];
    /** The staging camera's pose, or null (setPhoto). */
    this.photo = null;
    /** Drivers whose car is to be put back in the next step. */
    this._resets = new Set();
    /** The day-night fade: { t, to, switched } or null. */
    this._fade = null;
    this._touchDirty = false;
    this._hinted = false;
    try {
      this._hinted = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      // no storage: the hint shows
    }
    /** The title's attract lap: the autopilot drives behind the menu after a while with nobody at the controls. */
    this.attract = false;
    this._idle = 0;
    this._attractDist = 0;
    this._woke = false;
    this._fxCars = [];
    /** Per car, what its lamps throw on the smoke (effects.render). */
    this._fxLamps = [];
    this._events = [];
    /** @type {Racer[]} */
    this.racers = [];
    /** @type {View[]} */
    this.views = [];
    this.setup(this.mode);

    engine.onResize(() => this.layout());
    // pictures that only lived on the GPU (the environment map, the reflection probes) are drawn again
    engine.onContextRestored(() => {
      this.world.restore();
      for (const view of this.views) for (const p of view.probes) p.reset();
    });

    engine.onUpdate = (dt, simTime) => this.update(dt, simTime);
    engine.onRender = (frameDt, alpha) => this.render(frameDt, alpha);
    engine.onDraw = () => this.draw();

    if (params.auto) this.start();
  }

  // ------------------------------------------------------------------ setup

  /**
   * Put the cars on the grid and give each local driver a view.
   * @param {'solo'|'split'} mode
   */
  setup(mode) {
    const { world, track, params, engine } = this;
    for (const racer of this.racers) {
      world.scene.remove(racer.car.object);
      if (racer.car.shadow) world.scene.remove(racer.car.shadow);
      racer.car.dispose();
    }
    for (const view of this.views) for (const p of view.probes) p.dispose();
    if (this.ghostCar) {
      world.scene.remove(this.ghostCar.object);
      this.ghostCar.dispose();
      this.ghostCar = null;
    }
    this.mode = mode;
    const split = mode === 'split';
    const n = split ? 2 : 1;
    this.input.schemes = split ? DRIVERS.slice(0, 2).map((d) => d.keys) : ['all'];

    this.racers = DRIVERS.slice(0, n).map((who, index) => {
      const car = createCar({
        paint: (index === 0 && params.paint) || who.paint,
        plate: (index === 0 ? params.plate : params.plate2) || who.plate,
        tier: this.tier,
        caps: this.caps,
      });
      world.scene.add(car.object);
      if (car.shadow) world.scene.add(car.shadow);
      const vehicle = new Vehicle(track);
      vehicle.setAssists(ASSISTS.levels[this.assists]);
      const scheme = split ? who.keys : 'all';
      const racer = {
        index,
        car,
        vehicle,
        scheme,
        player: new PlayerDriver(this.input, scheme, index),
        auto: new AutoDriver(track, { pace: RULES.autopilotPace, bias: split ? who.bias : 0 }),
        driver: null,
        controls: { steer: 0, throttle: 0, brake: 0, handbrake: 1, analog: false },
        prevWheels: vehicle.wheels.map(() => ({ steer: 0, travel: 0 })),
        impacts: [],
        lamps: { drl: LIGHTS.drl, low: 0, high: 0, tail: 0, brake: 0, reverse: 0, interior: 0 },
        tunnelLow: false,
        lampOn: 0,
        lampOff: 0,
        roofTime: 0,
        offer: '',
        putBacks: 0,
        beam: { pos: new THREE.Vector3(), dir: new THREE.Vector3(), low: 0, high: 0, tailL: new THREE.Vector3(), tailR: new THREE.Vector3(), tail: 0, brake: 0 },
        shadowHint: -1,
        // (ENGINE lane) The blur's box is the car without its lowest 10 cm: the road it stands on must not count
        // as part of it, and the tyres' contact patches do move with the road.
        sharp: {
          matrix: new THREE.Matrix4(),
          prevMatrix: new THREE.Matrix4(),
          center: car.box.center.clone().setY(car.box.center.y + SHARP_LIFT / 2),
          half: car.box.half.clone().setY(car.box.half.y - SHARP_LIFT / 2),
        },
      };
      racer.driver = racer.player;
      this._place(racer);
      return racer;
    });
    if (!split) {
      this.ghostCar = createCar({ ghost: true, paint: DRIVERS[0].paint, plate: '', tier: this.tier, caps: this.caps });
      this.ghostCar.object.visible = false;
      world.scene.add(this.ghostCar.object);
    }
    const sharp = this.racers.map((racer) => racer.sharp);
    // the ghost moves by itself too: its own box (empty while it is not shown)
    this.ghostSharp = null;
    if (this.ghostCar) {
      const box = this.ghostCar.box;
      this.ghostSharp = { matrix: new THREE.Matrix4(), prevMatrix: new THREE.Matrix4(), center: box.center.clone(), half: new THREE.Vector3() };
      sharp.push(this.ghostSharp);
    }
    this.beams = this.racers.map((racer) => racer.beam);
    this._fxCars = this.racers.map((racer) => ({ vehicle: racer.vehicle, impacts: racer.impacts }));

    this.hud.setViews(n);
    if (!this._map) this._map = this._mapOf();
    for (const v of this.hud.views) v.setMap(this._map, n);
    this.views = this.racers.map((racer, i) => {
      // (ENGINE lane) what the car's paint mirrors: a cube picture of its surroundings, a face or two a frame
      // two sizes (PROBE in config.js): the smaller at speed, the larger, redrawn whole, while the car is nearly still
      const table = PROBE[this.tier] || PROBE.medium;
      const probe = params.probe ? new ReflectionProbe(engine.renderer, table.size) : null;

      return {
        racer,
        camera: new THREE.PerspectiveCamera(CAMERA.chase.fov, 1, VIEW.near, VIEW.far),
        rig: new CameraRig(this.phase === 'title' ? 'orbit' : this.cameraModes[i], this.rng.fork(`camera${i}`)),
        hud: this.hud.views[i],
        rect: { x: 0, y: 0, w: 1, h: 1 },
        zone: { left: 0, top: 0, width: 1, height: 1 },
        frame: { exposure: 1, look: world.time.look, motionBlur: VIEW.motionBlur, cut: true, sharp, probe: probe?.texture },
        exposure: this._exposureFor(racer.vehicle),
        /** 0..1: how much of the showcase's exposure compensation is in (eased in the fixed step). */
        showcase: this.phase === 'title' ? 1 : 0,
        /** The probe the paint reads now; `still` says which of the two it is. */
        probe,
        probes: probe ? [probe] : [],
        still: false,
      };
    });
    this.layout();
    for (const view of this.views) {
      view.rig.sun = world.time.sun?.dir;
      view.rig.time = world.time.name;
      view.rig.photo = this.photo || null;
      view.rig.snap(view.racer.vehicle);
      view.exposure = this._viewExposure(view);
    }
    // nothing has moved yet: the boxes start where they are
    this.render(0, 1);
    for (const racer of this.racers) racer.sharp.prevMatrix.copy(racer.sharp.matrix);
  }

  /** A car on its grid slot, at rest, with fresh hands. */
  _place(racer) {
    const at = this.track.grid(racer.index, {});
    racer.vehicle.reset(at);
    racer.player = new PlayerDriver(this.input, racer.scheme, racer.index);
    racer.auto = new AutoDriver(this.track, { pace: RULES.autopilotPace, bias: this.mode === 'split' ? DRIVERS[racer.index].bias : 0 });
    racer.driver = this.params.autopilot ? racer.auto : racer.player;
    for (const w of racer.prevWheels) w.steer = w.travel = 0;
    racer.roofTime = 0;
    racer.offer = '';
    racer.putBacks = 0;
    racer.impacts.length = 0;
  }

  /** Size the views: side by side on a wide window, stacked on a tall one. */
  layout() {
    const { engine, views } = this;
    const W = engine.bufferWidth;
    const H = engine.bufferHeight;
    const two = views.length > 1;
    const sideBySide = VIEW.split === 'wide' || (VIEW.split !== 'tall' && engine.aspect >= 1);
    views.forEach((view, i) => {
      // whole device pixels, and the two halves share every one of them
      if (!two) view.rect = { x: 0, y: 0, w: W, h: H };
      else if (sideBySide) view.rect = i === 0 ? { x: 0, y: 0, w: W >> 1, h: H } : { x: W >> 1, y: 0, w: W - (W >> 1), h: H };
      // GL's origin is bottom-left: the first driver gets the upper half
      else view.rect = i === 0 ? { x: 0, y: H - (H >> 1), w: W, h: H >> 1 } : { x: 0, y: 0, w: W, h: H - (H >> 1) };
      const { x, y, w, h } = view.rect;
      view.zone = { left: x / W, top: 1 - (y + h) / H, width: w / W, height: h / H };
      view.camera.aspect = w / h;
      view.camera.updateProjectionMatrix();
      view.rig.setAspect(w / h);
      view.hud.setZone(view.zone, engine.width * view.zone.width, engine.height * view.zone.height);
    });
    this.input.zones = views.map((view) => view.zone);
    this.input.insets = this.hud.insets();
    this.hud.setSplit(two ? (sideBySide ? 'wide' : 'tall') : '');
  }

  // ------------------------------------------------------------------ flow

  /** A new run from the grid, in the current mode and time of day. */
  start() {
    this.engine.paused = false;
    this.attract = false;
    this.runs++;
    for (const racer of this.racers) this._place(racer);
    this.race = new Race(this.track, {
      racers: this.racers.length,
      laps: this.laps,
      time: this.world.time.name,
      mode: this.mode,
      rng: this.rng.fork(`run${this.runs}`),
    });
    this.phase = 'countdown';
    this._resets.clear();
    this.effects.reset();
    this.ghost.begin();
    this.world.setStartLights(0);
    this.views.forEach((view, i) => {
      view.rig.setMode(this.cameraModes[i]);
      view.rig.lookBack = false;
      view.rig.snap(view.racer.vehicle, 0);
    });
  }

  /**
   * The staging camera for comparison stills: every view's camera at `o` ({ back, right, up, yaw, pitch, fov }:
   * metres behind, right of and above its car's origin in the car's level frame, degrees left of its heading and
   * up, the lens top to bottom), the HUD hidden unless `o.hud`; null gives the views back to their rigs.
   * @param {{ back?: number, right?: number, up?: number, yaw?: number, pitch?: number, fov?: number, hud?: boolean }|null} o
   */
  setPhoto(o) {
    if (typeof o === 'string') o = PHOTOS[o] || null;
    this.photo = o ? { ...o } : null;
    for (const view of this.views) {
      view.rig.photo = this.photo;
      view.frame.cut = true;
    }
    if (this.params.ui) this.hud.root.hidden = !!this.photo && !this.photo.hud;
    if (this.engine.manual && !this._rendering) this.engine.advance(0);
  }

  /** Back to the title: the cars parked on the grid, the camera circling. */
  leave() {
    this.engine.paused = false;
    this.phase = 'title';
    this.attract = false;
    this._idle = 0;
    this.race = null;
    this.world.setStartLights(0);
    for (const racer of this.racers) this._place(racer);
    for (const view of this.views) {
      view.rig.setMode('orbit');
      view.rig.snap(view.racer.vehicle);
    }
  }

  /**
   * A moment from the hands or the HUD.
   * @param {string} name
   * @param {number} driver -1: nobody in particular
   */
  action(name, driver = -1) {
    this._woke = true;
    const d = Math.max(0, Math.min(this.racers.length - 1, driver));
    const racing = this.phase === 'countdown' || this.phase === 'run' || this.phase === 'results';
    const paused = this.engine.paused;
    // 'time:dusk' (the title's choice): fade to that time of day
    if (name.startsWith('time:')) {
      const to = name.slice(5);
      if (TIMES[to] && to !== this.world.time.name && !this._fade) this._fade = { t: 0, to, switched: false };
      if (this.engine.manual && !this._rendering) this.engine.advance(0);
      return;
    }
    // the options
    if (name.startsWith('quality:')) {
      const q = name.slice(8);
      if (QUALITIES.includes(q) && q !== this.qualityChoice) {
        this.qualityChoice = q;
        keep(QUALITY_KEY, q);
        // a tier is chosen once, when the page is built: the page is built again with the new one
        if (!this.params.noreload && typeof location !== 'undefined') location.reload();
      }
      return;
    }
    if (name.startsWith('assists:')) {
      const id = name.slice(8);
      if (ASSISTS.levels[id]) {
        this.assists = id;
        keep(ASSISTS_KEY, id);
        for (const racer of this.racers) racer.vehicle.setAssists(ASSISTS.levels[id]);
      }
      if (this.engine.manual && !this._rendering) this.engine.advance(0);
      return;
    }
    if (name.startsWith('throttle:')) {
      this.throttle = name.slice(9) === 'manual' ? 'manual' : 'auto';
      this.input.throttle = this.throttle;
      keep(THROTTLE_KEY, this.throttle);
      if (this.engine.manual && !this._rendering) this.engine.advance(0);
      return;
    }
    if (name.startsWith('units:')) {
      this.units = name.slice(6) === 'mph' ? 'mph' : 'kmh';
      keep(UNITS_KEY, this.units);
      if (this.engine.manual && !this._rendering) this.engine.advance(0);
      return;
    }
    if (name.startsWith('map:')) {
      this.mapShown = name.slice(4) !== 'off';
      keep(MAP_KEY, this.mapShown ? 'on' : 'off');
      if (this.engine.manual && !this._rendering) this.engine.advance(0);
      return;
    }
    if (name === 'sound:on' || name === 'sound:off') {
      if (this.muted !== (name === 'sound:off')) this.action('mute', driver);
      return;
    }
    // a pad in a menu: the d-pad moves through the open panel's buttons, A presses the one it is on
    if (name.startsWith('nav:')) {
      if (this.phase === 'title' || paused || this.phase === 'results' || this.hud.optionsOpen) this.hud.navigate(name.slice(4));
      return;
    }
    if (name === 'press') {
      if (!this.hud.pressFocused()) this.action('start', driver);
      return;
    }
    switch (name) {
      case 'start':
        if (this.phase === 'title') this.start();
        else if (this.phase === 'results' || paused) this.start();
        break;
      case 'again':
        if (racing) this.start();
        break;
      case 'leave':
        if (racing) this.leave();
        break;
      case 'solo':
      case 'split':
        if (this.phase === 'title' && name !== this.mode) this.setup(name);
        break;
      case 'pause':
        // Escape or Start on the options sheet goes back to where it was opened from
        if (this.hud.optionsOpen) this.hud.closeOptions();
        else if (racing) this.engine.paused = !paused;
        break;
      case 'camera':
        if (racing && !paused) {
          const modes = CAMERA.modes;
          this.cameraModes[d] = modes[(modes.indexOf(this.cameraModes[d]) + 1) % modes.length];
          this.views[d].rig.setMode(this.cameraModes[d]);
        }
        break;
      case 'reset':
        if (this.phase === 'run' && !paused) this._resets.add(d);
        break;
      case 'time': {
        // the next time of day in lighting.js's order (read each time: the table may grow)
        const names = Object.keys(TIMES);
        if (!this._fade) this._fade = { t: 0, to: names[(names.indexOf(this.world.time.name) + 1) % names.length], switched: false };
        break;
      }
      case 'ghost':
        this.ghostOn = !this.ghostOn;
        break;
      case 'high':
        this.highBeam = !this.highBeam;
        break;
      case 'mute':
        if (this.audio) {
          this.muted = !this.muted;
          this.audio.setMuted(this.muted);
          // unmuting is itself a gesture: a page that started muted has no context yet
          if (!this.muted) this.audio.unlock();
        }
        break;
      default:
        return;
    }
    // with no loop running nobody would show the change (unless it came from the frame being drawn: the pads)
    if (this.engine.manual && !this._rendering) this.engine.advance(0);
  }

  _unlockSound() {
    if (this.audio && !this.params.mute) this.audio.unlock();
  }

  /** Switch the time of day now (the fade calls this at its darkest). The board follows. */
  setTime(name) {
    this.world.setTime(name);
    if (this.race) this.race.setTime(name);
    for (const view of this.views) {
      view.rig.sun = this.world.time.sun?.dir;
      view.rig.time = name;
      view.exposure = this._viewExposure(view);
      view.frame.cut = true;
    }
  }

  /** The fade: out, switch, in; its own clock, so that it also runs while paused (from render). */
  _tickFade(dt) {
    const f = this._fade;
    if (!f) return;
    f.t += dt;
    if (!f.switched && f.t >= VIEW.fade) {
      f.switched = true;
      this.setTime(f.to);
    }
    if (f.t >= 2 * VIEW.fade) this._fade = null;
  }

  /** 0..1: how much of the picture shows through the fade. */
  get _fadeLevel() {
    const f = this._fade;
    if (!f) return 1;
    return f.t < VIEW.fade ? 1 - f.t / VIEW.fade : clamp01((f.t - VIEW.fade) / VIEW.fade);
  }

  /** Apply numbers that were changed by hand (lighting.js, config.js) to everything that copied them. */
  refresh() {
    this.world.refresh();
    this.effects.refresh();
    this.layout();
    for (const view of this.views) view.exposure = this._viewExposure(view);
  }

  /** Where a view's exposure settles: the car's light, and the showcase's compensation as far as it is in. */
  _viewExposure(view) {
    return this._exposureFor(view.racer.vehicle) * 2 ** (this._showcaseEv() * view.showcase);
  }

  /** The exposure compensation (stops) of the hero picture and the results at this time of day. */
  _showcaseEv() {
    const v = SHOWCASE[this.world.time.name];
    return typeof v === 'number' ? v : SHOWCASE.default;
  }

  /** What the exposure settles at where this car is: the open sky's, the tunnel's, or between at the portals. */
  _exposureFor(vehicle) {
    const time = this.world.time;
    return lerp(time.tunnelExposure, time.exposure, vehicle.sky);
  }

  /** Put a car back on the road where it is, pointing along it, at rest; the clock keeps running. */
  putBack(racer) {
    const { track, vehicle } = { track: this.track, vehicle: racer.vehicle };
    const s = vehicle.s;
    const lat = clamp(vehicle.lat, -RULES.resetLat, RULES.resetLat);
    track.frameAt(s, frameOut);
    track.pointAt(s, lat, putAt);
    vehicle.reset({ x: putAt.x, z: putAt.z, yaw: Math.atan2(frameOut.tan.x, frameOut.tan.z) });
    const driving = racer.driver === racer.player;
    racer.player = new PlayerDriver(this.input, racer.scheme, racer.index);
    if (driving) racer.driver = racer.player;
    for (const w of racer.prevWheels) w.steer = w.travel = 0;
    racer.roofTime = 0;
    racer.offer = '';
    racer.putBacks++;
    if (this.race) this.race.notePutBack(racer.index);
    this.views[racer.index].rig.snap(vehicle);
  }

  // ----------------------------------------------------------- fixed step

  update(dt, simTime) {
    this._tickFade(dt);
    this.input.step(dt);
    if (this.phase === 'title') this._attractStep(dt);
    const { race, racers } = this;
    const time = this.world.time;
    const phase = this.phase;

    for (const racer of racers) {
      const { vehicle, prevWheels, controls } = racer;
      for (let i = 0; i < 4; i++) {
        prevWheels[i].steer = vehicle.wheels[i].steer;
        prevWheels[i].travel = vehicle.wheels[i].travel;
      }
      if (phase === 'title' && !this.attract) Object.assign(controls, HELD);
      else {
        racer.driver.drive(vehicle, dt, controls);
        // on the grid the car is held until the lamps go out
        if (phase === 'countdown') Object.assign(controls, HELD);
      }
      vehicle.step(dt, controls);
    }
    if (racers.length > 1) collideVehicles(racers[0].vehicle, racers[1].vehicle);

    // the impacts of this step: drained once, read by the effects and the sound
    for (const racer of racers) {
      racer.impacts.length = 0;
      racer.vehicle.drainImpacts(racer.impacts);
      if (this.sound) for (const hit of racer.impacts) this.sound.impact(hit.strength, this._pan(racer.index));
    }
    this.effects.update(dt, this._fxCars);

    if (race) {
      for (const racer of racers) race.cars[racer.index].input = this.input.source[racer.index] || 'keys';
      race.update(dt, racers.map((r) => r.vehicle));
      for (const e of race.drain(this._events)) this._onRaceEvent(e);
      this._events.length = 0;
      // the ghost: this lap of the solo car, sampled on the lap's own clock
      if (this.ghostCar && race.clock >= 0 && !race.cars[0].finished) this.ghost.record(race.lapClock(0), racers[0].vehicle);
      if (this.phase === 'countdown' && race.state !== 'countdown') this.phase = 'run';
      if (this.phase === 'run' && race.state === 'done') this.phase = 'results';
      this.world.setStartLights(race.lit);
    }

    // putting back: asked for, offered, or (on its roof) done unasked
    for (const racer of racers) {
      const v = racer.vehicle;
      racer.roofTime = v.upsideDown ? racer.roofTime + dt : 0;
      const racing = this.phase === 'run' && !race.cars[racer.index].finished && racer.driver === racer.player;
      if (!racing) {
        racer.offer = '';
        continue;
      }
      if (racer.roofTime > RULES.roofReset) this._resets.add(racer.index);
      racer.offer =
        racer.roofTime > RULES.offerRoof
          ? 'roof'
          : v.stuckTime > RULES.offerStuck
            ? 'stuck'
            : v.wrongWayTime > RULES.offerWrongWay
              ? 'wrong'
              : '';
    }
    if (this._resets.size) {
      for (const i of this._resets) if (this.phase === 'run' && racers[i]) this.putBack(racers[i]);
      this._resets.clear();
    }

    this.views.forEach((view, i) => {
      const racer = view.racer;
      // look back: held, from the driver's own keys or pad
      if (this.phase !== 'title' && racer.driver === racer.player) view.rig.lookBack = !!this.input.read(lookRead, racer.scheme, i).lookBack;
      else view.rig.lookBack = false;
      // the rig reads this step's knocks, the start sweep off the race clock, and whether its car has taken the flag
      // the camera's dive: from the clock's start until the last start lamp lights
      const diveEnd = race ? race.firstLamp + RULES.lampStep * (RULES.lamps - 1) : 0;
      const sweep = race && race.clock < diveEnd ? clamp01((race.clock + race.lead) / (diveEnd + race.lead)) : 1;
      const finished = !!race && this.phase !== 'title' && race.cars[racer.index].finished;
      // the grid's look up at the lamps: while the clock is under zero, easing out over CAMERA.chase.gridOut after go
      const grid = race && this.phase !== 'title' ? 1 - clamp01(race.clock / CAMERA.chase.gridOut) : 0;
      view.rig.update(dt, racer.vehicle, this.track, { impacts: racer.impacts, sweep, finished, sun: time.sun?.dir, time: time.name, grid });
      // the title's hero picture and the results' orbit: the car exposed for, eased in and out (SHOWCASE)
      const show = this.phase === 'title' && !this.attract ? 1 : finished ? 1 : 0;
      view.showcase = damp(view.showcase, show, 1 / SHOWCASE.ease, dt);
      // eyes take a moment to follow the light: closing down quickly, opening up slowly (eased in stops)
      const target = this._viewExposure(view);
      const tau = target < view.exposure ? EXPOSURE.close : EXPOSURE.open;
      view.exposure = Math.exp(damp(Math.log(view.exposure), Math.log(target), 1 / tau, dt));
    });

    // the lamps: running lights always, the low beam when the time of day asks or a while into the tunnel
    const dark = time.carLights === 'low';
    for (const racer of racers) {
      const v = racer.vehicle;
      if (v.sky < LIGHTS.tunnelSky) {
        racer.lampOff = 0;
        racer.lampOn += dt;
        if (racer.lampOn >= LIGHTS.onDelay) racer.tunnelLow = true;
      } else {
        racer.lampOn = 0;
        racer.lampOff += dt;
        if (racer.lampOff >= LIGHTS.offDelay) racer.tunnelLow = false;
      }
      const low = time.carLights === 'low' || racer.tunnelLow;
      const l = racer.lamps;
      l.drl = low ? LIGHTS.drlDimmed : LIGHTS.drl;
      l.low = low ? 1 : 0;
      l.high = low && this.highBeam ? 1 : 0;
      l.tail = low ? 1 : 0;
      l.brake = v.brake > LIGHTS.brakeOn ? 1 : 0;
      l.reverse = v.gear === -1 ? 1 : 0;
      l.interior = dark ? LIGHTS.interior : 0;
    }

    this.world.update(dt, simTime);
  }

  /** The title: after RULES.attractIdle s with nobody at the controls the autopilot drives a lap; any input ends it. */
  _attractStep(dt) {
    const woke = this._woke;
    this._woke = false;
    if (this.attract) {
      const v = this.racers[0].vehicle;
      this._attractDist += Math.abs(this.track.delta(this._attractS, v.s));
      this._attractS = v.s;
      if (woke || this._attractDist > this.track.length) {
        this.attract = false;
        this._idle = 0;
        for (const racer of this.racers) this._place(racer);
        for (const view of this.views) {
          view.rig.setMode('orbit');
          view.rig.snap(view.racer.vehicle);
        }
      }
      return;
    }
    this._idle = woke ? 0 : this._idle + dt;
    if (this._idle < RULES.attractIdle) return;
    this.attract = true;
    this._attractDist = 0;
    this._attractS = this.racers[0].vehicle.s;
    for (const racer of this.racers) racer.driver = racer.auto;
    for (const view of this.views) {
      view.rig.setMode('chase');
      view.rig.snap(view.racer.vehicle);
    }
  }

  /** Stereo position of a driver's sounds: split screen puts each car on its own side. */
  _pan(i) {
    if (this.racers.length < 2) return 0;
    return this.engine.aspect >= 1 ? (i ? 0.5 : -0.5) : 0;
  }

  /** @param {import('./Race.js').RaceEvent} e */
  _onRaceEvent(e) {
    const race = this.race;
    const sound = this.sound;
    const view = e.racer !== undefined ? this.views[e.racer] : null;
    const pan = e.racer !== undefined ? this._pan(e.racer) : 0;
    switch (e.type) {
      case 'count':
        if (sound) sound.cue('count', 0);
        break;
      case 'go':
        if (sound) sound.cue('go', 0);
        break;
      case 'sector':
      case 'lap': {
        const ahead = e.gap !== null && e.gap <= 0;
        if (view) {
          view.hud.flashLine(e.gap === null ? e.ms : e.gap, e.gap !== null, race.clock + HUD.flash);
          if (e.type === 'lap') view.hud.lapBanner(e.lap, e.ms, !!e.best, race.clock + HUD.banner);
        }
        if (sound) sound.cue(e.type, pan, { ahead });
        if (e.type === 'lap' && this.ghostCar) {
          // the race has just put the lap on the board if it is the best of its kind: then it is the new ghost
          const kind = e.lap === 1 ? 'standing' : 'flying';
          const ref = race.table[kind];
          if (ref && ref.ms === e.ms && !race.cars[0].times[e.lap - 1].putBack) this.ghost.keep(race.time, kind, e.ms);
          this.ghost.begin();
        }
        break;
      }
      case 'finish': {
        if (sound) sound.cue('finish', pan);
        // the autopilot takes the car home while the results show
        const racer = this.racers[e.racer];
        racer.auto = new AutoDriver(this.track, { pace: RULES.cooldownPace, bias: this.mode === 'split' ? DRIVERS[e.racer].bias : 0 });
        racer.driver = racer.auto;
        break;
      }
      case 'end':
        this.hud.setResults(this._results());
        break;
    }
  }

  /** What the results panel shows: each driver's laps, total and medal, and the board with this run's best marked. */
  _results() {
    const race = this.race;
    return {
      time: race.time,
      drivers: race.cars.map((c, i) => {
        const best = race.bestLap(i);
        const slide = this.racers[i].vehicle.slide;
        return { laps: c.times, best, total: c.finishMs, finished: c.finished, position: c.position, medal: medalOf(best), slide: slide ? slide.best : 0 };
      }),
      table: race.table,
      medals: RULES.medals,
      mark: race.bestLap(0),
    };
  }

  /** The road seen from above, north up, in map units (the longer side 200): its outline, the start and sector lines. */
  _mapOf() {
    const track = this.track;
    const pts = track.toTopDown(1, 8);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      z0 = Math.min(z0, pts[i + 1]);
      z1 = Math.max(z1, pts[i + 1]);
    }
    const k = 200 / Math.max(x1 - x0, z1 - z0);
    const map = { k, x0, z0, w: (x1 - x0) * k, h: (z1 - z0) * k, d: '', lines: [] };
    for (let i = 0; i < pts.length; i += 2) map.d += `${i ? 'L' : 'M'}${((pts[i] - x0) * k).toFixed(1)} ${((pts[i + 1] - z0) * k).toFixed(1)}`;
    map.d += 'Z';
    for (const s of [0, ...track.sectors]) {
      const f = track.frameAt(s, frameOut);
      const cx = (f.pos.x - x0) * k;
      const cz = (f.pos.z - z0) * k;
      const lx = f.left.x * 7;
      const lz = f.left.z * 7;
      map.lines.push([cx - lx, cz - lz, cx + lx, cz + lz]);
    }
    return map;
  }

  // -------------------------------------------------------------- a frame

  /**
   * Pose everything between the last two steps.
   * @param {number} frameDt real seconds this frame stands for
   * @param {number} alpha 0 = as it was before the last step, 1 = as it is after
   */
  render(frameDt, alpha) {
    // the fade's clock runs on drawn frames only while the steps are stopped
    if (this.engine.paused) this._tickFade(frameDt);
    const time = this.world.time;
    const track = this.track;
    for (const racer of this.racers) {
      const { car, vehicle, prevWheels, sharp } = racer;
      const obj = car.object;
      obj.position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
      obj.quaternion.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);
      for (let i = 0; i < 4; i++) {
        const w = vehicle.wheels[i];
        car.setWheel(i, {
          steer: lerp(prevWheels[i].steer, w.steer, alpha),
          // the spin only ever accumulates: step back from where it is by what it turned in the part not shown
          spin: w.spin - w.omega * FIXED_DT * (1 - alpha),
          travel: lerp(prevWheels[i].travel, w.travel, alpha),
          omega: w.omega,
        });
      }
      // the contact shadow, flat on the road under the car, fading as the car leaves it
      if (car.poseShadow) {
        track.surfaceAt(obj.position.x, obj.position.z, racer.shadowHint, surface);
        racer.shadowHint = surface.index;
        shadowPoint.set(obj.position.x, surface.y, obj.position.z);
        shadowNormal.set(surface.nx, surface.ny, surface.nz);
        const lift = obj.position.y - surface.y;
        car.poseShadow(shadowPoint, shadowNormal, vehicle.yaw, vehicle.upsideDown ? 0 : clamp01(1 - lift / 1.5));
      }
      car.setLights(racer.lamps);
      // the car's sky: none in the tunnel, less under the woods (the same canopy the road beside it sees)
      car.setReflections({ cube: this.views[racer.index]?.probe?.texture ?? null, sky: vehicle.sky * canopyOpen(this.track, vehicle.s, vehicle.lat) });

      obj.updateMatrixWorld();
      sharp.prevMatrix.copy(sharp.matrix);
      sharp.matrix.copy(obj.matrixWorld);

      // the head lamps as the world's reflectors see them: from the front of the car, along it
      const b = racer.beam;
      b.dir.set(0, 0, 1).applyQuaternion(obj.quaternion);
      b.pos.set(0, 0.65, 2.2).applyQuaternion(obj.quaternion).add(obj.position);
      b.low = racer.lamps.low;
      b.high = racer.lamps.high;
      // and the tail lamps, which the wet road draws out into red streaks
      b.tailL.set(CAR_LAMPS.tail.x, CAR_LAMPS.tail.y, CAR_LAMPS.tail.z).applyQuaternion(obj.quaternion).add(obj.position);
      b.tailR.set(-CAR_LAMPS.tail.x, CAR_LAMPS.tail.y, CAR_LAMPS.tail.z).applyQuaternion(obj.quaternion).add(obj.position);
      b.tail = racer.lamps.tail;
      b.brake = racer.lamps.brake;

      // what lights the smoke and the spray: the head lamps' cone and a red glow round the tail lamps
      const fl = (this._fxLamps[racer.index] ||= { headPos: new THREE.Vector3(), headDir: new THREE.Vector3(), tailPos: new THREE.Vector3(), head: 0, tail: 0 });
      fl.headPos.copy(b.pos);
      fl.headDir.copy(b.dir);
      fl.head = FX.lampHead * (b.low + FX.highGain * b.high);
      fl.tailPos.set(0, 0.8, -2.3).applyQuaternion(obj.quaternion).add(obj.position);
      fl.tail = FX.lampTail * (racer.lamps.tail + FX.brakeGain * racer.lamps.brake);
    }
    this._fxLamps.length = this.racers.length;
    this.effects.render(alpha, FIXED_DT, this.world.time, this._fxLamps);

    this._poseGhost(alpha);

    const fade = this._fadeLevel;
    for (const view of this.views) {
      view.rig.apply(view.camera, alpha);
      const speed = Math.abs(view.racer.vehicle.speed);
      view.frame.exposure = view.exposure * fade;
      view.frame.look = time.look;
      // the shutter opens with speed; while the camera itself dives at the start it is held short
      view.frame.motionBlur = lerp(VIEW.motionBlurSlow, VIEW.motionBlur, clamp01(speed / VIEW.blurSpeed) ** 1.5) * lerp(VIEW.diveShutter, 1, view.rig.settled);
      view.frame.cut = view.frame.cut || view.rig.cut;
    }

    this._rendering = true;
    this.input.poll();
    this._rendering = false;
    if (this.params.ui) this._hud();
    if (this.sound) {
      // the cars quieten while the run is paused (the signals do not)
      this.sound.setPaused(this.engine.paused);
      const cars = this._soundCars || (this._soundCars = []);
      cars.length = this.racers.length;
      for (const r of this.racers) cars[r.index] = this._carSound(r.vehicle, this._pan(r.index), this._sounds[r.index]);
      this.sound.update(frameDt, cars);
    }
  }

  /** The ghost where the best lap was at this moment of the lap being driven (solo, during the run, G not off). */
  _poseGhost(alpha) {
    const g = this.ghostCar;
    if (!g) return;
    const race = this.race;
    let show = false;
    if (this.ghostOn && race && this.phase === 'run' && !race.cars[0].finished && race.clock > 0) {
      const seconds = race.lapClock(0) / 1000 - (1 - alpha) * FIXED_DT;
      show = this.ghost.pose(race.time, race.cars[0].lap === 1 ? 'standing' : 'flying', seconds, g.object);
    }
    const box = this.ghostSharp;
    if (show) {
      g.object.updateMatrixWorld();
      box.prevMatrix.copy(g.object.visible ? box.matrix : g.object.matrixWorld);
      box.matrix.copy(g.object.matrixWorld);
      box.half.copy(g.box.half);
    } else box.half.set(0, 0, 0);
    g.object.visible = show;
  }

  /** The HUD's readouts: every call is cheap, the DOM is only touched where something changed. */
  _hud() {
    const { hud, race, input } = this;
    const device = input.isTouch ? 'touch' : input.source[0] === 'pad' ? 'pad' : 'keys';
    hud.setState({
      phase: this.phase,
      paused: this.engine.paused,
      mode: this.mode,
      time: this.world.time.name,
      times: Object.keys(TIMES),
      muted: this.muted,
      canSound: !!this.sound,
      device,
      attract: this.attract,
      quality: this.qualityChoice,
      tier: this.tier,
      qualityFixed: !!this.params.quality,
      units: this.units,
      map: this.mapShown,
      assists: this.assists,
      assistLevels: Object.keys(ASSISTS.levels),
      throttle: this.throttle,
    });
    hud.setFade(1 - this._fadeLevel);
    // the board: on the title and the pause sheet (and in the results), never over the run
    if (this.phase === 'title' || this.engine.paused) hud.setBoard(this._boardTable(), RULES.medals, this.world.time.name);
    if (this.phase === 'title') return;
    const rect = this._touchDirty ? this.container.getBoundingClientRect() : null;
    const split = this.racers.length > 1;
    const map = this._map;
    // the first-time hint: until the first run in which the car has got going
    if (!this._hinted && race && race.cars.some((c) => c.dist > HUD.hintDistance)) this._noteHinted();
    this.views.forEach((view, i) => {
      const h = view.hud;
      const racer = view.racer;
      const v = racer.vehicle;
      if (race) {
        const c = race.cars[i];
        const waiting = race.clock < 0;
        h.tick(race.clock);
        h.setLamps(race.lit, waiting ? (race.lit > 0 ? 'wait' : 'off') : race.clock < 1 ? 'go' : 'off');
        h.setLap(c.lap, race.laps, c.finished);
        h.setClock(race.lapClock(i), waiting);
        h.setLive(split ? null : c.live);
        h.setBest(race.table.laps.length ? race.table.laps[0].ms : null);
        h.setBoard(race.table, RULES.medals, race.time, race.bestLap(i));
        if (split) h.setPosition(c.position, c.lastGap);
        const running = this.phase === 'run' && !c.finished && racer.driver === racer.player;
        const warn = running && v.wrongWayTime > HUD.wrongWay && racer.offer !== 'roof';
        h.setWarn(warn);
        const how = input.source[i] === 'touch' ? TEXT.resetTouch : split ? TEXT.resetSplit(i === 0 ? 'R' : '/') : TEXT.resetKeys;
        h.setOffer(racer.offer, how);
        h.setHint(!this._hinted && !c.finished && !racer.offer && !warn ? TEXT.hint[input.source[i]] || TEXT.hint.keys : '');
      }
      h.setSpeed(v.speed * 3.6);
      h.setRev(v.rpm, v.gear);
      const a = v.assists;
      h.setTells({
        abs: a.abs > 0.1,
        tc: a.tc > 0.1,
        esc: a.esc > 0.1,
        hand: racer.controls.handbrake > 0.5,
        high: racer.lamps.high > 0,
      });
      const p = racer.car.object.position;
      for (let k = 0; k < this.racers.length; k++) {
        const q = k === i ? p : this.racers[k].car.object.position;
        h.setDot(k, (q.x - map.x0) * map.k, (q.z - map.z0) * map.k);
      }
      if (rect) h.setStick(input.stickOf(i), rect, input.brakeOf(i));
      // the slide: its angle and running score while it lasts (beyond 12 degrees), fading after
      const slide = v.slide;
      if (slide) h.setDrift(slide.angle, slide.score, slide.angle >= 12);
      // touch: DRIFT (and GAS on manual) under the right thumb; the zones named on the first touch run
      h.setPads(this.throttle === 'manual', input.heldOf(i));
      const naming = input.isTouch && !this._zonesSeen && !!race && race.clock < HUD.zonesFor;
      h.setZoneHint(naming);
      if (input.isTouch && !this._zonesSeen && race && race.clock >= HUD.zonesFor) this._noteZones();
    });
    this._touchDirty = false;
  }

  /** The touch zones have been named once: not again on this device. */
  _noteZones() {
    this._zonesSeen = true;
    keep(ZONES_KEY, '1');
  }

  /** The first-time hint has done its job: not again on this device. */
  _noteHinted() {
    this._hinted = true;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // no storage: the hint shows again next time
    }
  }

  /** The board's table for the time of day showing (read from storage through a throwaway race when none runs). */
  _boardTable() {
    const name = this.world.time.name;
    if (this.race) {
      this.race.setTime(name);
      return this.race.table;
    }
    if (!this._board || this._boardRuns !== this.runs) {
      this._board = new Race(this.track, { racers: 1, time: name, mode: 'solo', rng: createRng(1) });
      this._boardRuns = this.runs;
    }
    this._board.setTime(name);
    return this._board.table;
  }

  /** Draw every view into its rectangle. */
  draw() {
    const table = PROBE[this.tier] || PROBE.medium;
    const n = this.views.length;
    this.views.forEach((view, i) => {
      const car = view.racer.car;
      // the wet road's mirror leaves out what lies on the road: seen from under it, a car's contact shadow and its
      // spray would hide the car's own reflection (its tail lamps' red streaks)
      mirrorHidden.length = 0;
      for (const r of this.racers) if (r.car.shadow) mirrorHidden.push(r.car.shadow);
      if (this.ghostCar?.shadow) mirrorHidden.push(this.ghostCar.shadow);
      mirrorHidden.push(...this.effects.objects);
      this.world.prepareView(view.camera, car.object.position, this.beams, mirrorHidden);
      // (ENGINE lane) the car's probe, from the middle of the car, without the car itself; after prepareView, so
      // that the shadows it shows are this view's. In split screen the two take turns. Nearly still (the title's
      // orbit, the grid): the larger cube, redrawn whole over a few frames; at speed the smaller one, a face or two.
      if (view.probes.length) {
        const speed = Math.abs(view.racer.vehicle.speed);
        const still = view.still ? speed < PROBE.movingAbove : speed < PROBE.stillBelow;
        if (still !== view.still) {
          view.still = still;
          // the larger cube is made the first time it is needed
          if (still && !view.probes[1]) view.probes[1] = new ReflectionProbe(this.engine.renderer, table.stillSize);
          view.probe = view.probes[still ? 1 : 0];
          // the one taken up is refreshed face by face from what it last showed (its very first update draws all six)
          view.frame.probe = view.probe.texture;
        }
      }
      const probeEvery = view.still ? (table.stillEvery ?? 1) : table.every;
      const probeFaces = view.still ? table.stillFaces : table.faces;
      if (view.probe && this.engine.frame % (probeEvery * n) === i * probeEvery) {
        probeAt.copy(car.box.center).applyMatrix4(car.object.matrixWorld);
        probeHidden.length = 0;
        for (const r of this.racers) {
          if (r.car === car) probeHidden.push(r.car.object);
          if (r.car.shadow && r.car === car) probeHidden.push(r.car.shadow);
        }
        probeHidden.push(...this.world.probeHidden);
        if (this.ghostCar) probeHidden.push(this.ghostCar.object);
        // smoke and sparks in a reflection would smear over the whole car
        probeHidden.push(...this.effects.objects);
        view.probe.update(this.world.scene, probeAt, probeHidden, probeFaces);
      }
      this.pipeline.render(this.world.scene, view.camera, view.rect, view.frame);
      view.rig.cut = false;
      view.frame.cut = false;
    });
  }

  // ------------------------------------------------------------- for tests

  /** A plain picture of the run, for tests (JSON). */
  state() {
    const race = this.race;
    return {
      phase: this.phase,
      mode: this.mode,
      time: this.world.time.name,
      paused: this.engine.paused,
      fading: !!this._fade,
      attract: this.attract,
      clock: race ? Math.round(race.clock * 1000) / 1000 : null,
      lamps: race ? race.lit : 0,
      highBeam: this.highBeam,
      ghost: { on: this.ghostOn, has: this.ghost.has(this.world.time.name), visible: !!this.ghostCar?.object.visible },
      drivers: this.racers.map((r, i) => {
        const v = r.vehicle;
        const c = race ? race.cars[i] : null;
        return {
          lap: c ? c.lap : 0,
          s: Math.round(v.s * 100) / 100,
          lat: Math.round(v.lat * 100) / 100,
          dist: c ? Math.round(c.dist * 100) / 100 : 0,
          kmh: Math.round(v.speed * 36) / 10,
          gear: v.gear,
          rpm: Math.round(v.rpm),
          throttle: Math.round(v.throttle * 100) / 100,
          brake: Math.round(v.brake * 100) / 100,
          steer: Math.round(r.controls.steer * 100) / 100,
          laps: c ? c.times.map((l) => ({ ms: l.ms, splits: l.splits, putBack: l.putBack, standing: l.standing })) : [],
          sector: c ? c.next : 0,
          lapClock: race ? race.lapClock(i) : 0,
          live: c ? c.live : null,
          lastGap: c ? c.lastGap : null,
          finished: c ? c.finished : false,
          total: c ? c.finishMs : null,
          position: c ? c.position : i + 1,
          medal: race ? medalOf(race.bestLap(i)) : null,
          camera: this.views[i].rig.mode,
          lookBack: this.views[i].rig.lookBack,
          lamps: { ...r.lamps },
          assists: { abs: Math.round(v.assists.abs * 100) / 100, tc: Math.round(v.assists.tc * 100) / 100, esc: Math.round(v.assists.esc * 100) / 100 },
          offer: r.offer,
          putBacks: r.putBacks,
          upsideDown: v.upsideDown,
          driver: r.driver === r.player ? 'player' : 'auto',
          input: this.input.source[i],
          exposure: Math.round(this.views[i].exposure * 1000) / 1000,
        };
      }),
    };
  }

  /**
   * Where car `i` is drawn in its view, as a rectangle of the page in CSS pixels (its box's corners projected),
   * for tests that check nothing of the HUD covers it.
   */
  carRect(i = 0) {
    const view = this.views[i];
    if (!view) return null;
    const { car } = view.racer;
    const b = car.box;
    const v = new THREE.Vector3();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      v.set(b.center.x + (k & 1 ? 1 : -1) * b.half.x, b.center.y + (k & 2 ? 1 : -1) * b.half.y, b.center.z + (k & 4 ? 1 : -1) * b.half.z);
      v.applyMatrix4(car.object.matrixWorld).project(view.camera);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    const W = this.engine.width;
    const H = this.engine.height;
    const z = view.zone;
    const px = (x) => (z.left + ((x + 1) / 2) * z.width) * W;
    const py = (y) => (z.top + ((1 - y) / 2) * z.height) * H;
    return { left: px(x0), right: px(x1), top: py(y1), bottom: py(y0) };
  }

  /** Numbers about the run and the last frame drawn (counted over all its passes). */
  stats() {
    const { engine } = this;
    const info = engine.renderer.info;
    return {
      fps: engine.frameMs ? Math.round(1000 / engine.frameMs) : 0,
      frameMs: Math.round(engine.frameMs * 10) / 10,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      buffer: [engine.bufferWidth, engine.bufferHeight],
      hudWrites: this.hud.writes,
      pixelRatio: engine.pixelRatio,
      renderScale: engine.renderScale,
      qualityStep: engine.qualityStep,
      pipeline: this.pipeline.stats(),
      tier: this.tier,
      hdr: this.caps.hdr,
      gpu: this.caps.gpu,
      mode: this.mode,
      phase: this.phase,
      time: this.world.time.name,
      simTime: engine.simTime,
      frame: engine.frame,
      views: this.views.map((view) => ({ rect: view.rect, exposure: view.exposure, fov: view.camera.fov })),
      cars: this.racers.map(({ vehicle }) => ({ s: vehicle.s, lat: vehicle.lat, speed: vehicle.speed, yaw: vehicle.yaw })),
    };
  }
}
