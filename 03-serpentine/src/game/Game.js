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
import { createWorld } from '../assets/world/index.js';
import { TIME_NAMES } from '../assets/world/lighting.js';
import { Engine, FIXED_DT } from '../engine/Engine.js';
import { FramePipeline } from '../engine/FramePipeline.js';
import { Input } from '../engine/Input.js';
import { ReflectionProbe } from '../engine/ReflectionProbe.js';
import { TIERS, probeCaps } from '../engine/caps.js';
import { clamp, clamp01, damp, lerp } from '../engine/math.js';
import { createRng } from '../engine/rng.js';
import { CameraRig } from './Cameras.js';
import { CAMERA, DRIVERS, EXPOSURE, LIGHTS, RULES, VIEW } from './config.js';
import { AutoDriver, PlayerDriver } from './drivers.js';
import { Effects } from './effects.js';
import { Hud } from './Hud.js';
import { Race, formatMs, medalOf } from './Race.js';
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
/** The car at rest, held on its brakes (the title, the grid). */
const HELD = { steer: 0, throttle: 0, brake: 0, handbrake: 1 };

const probeAt = new THREE.Vector3();
const probeHidden = [];
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
    this.tier = params.quality ?? this.caps.tier;
    engine.setMaxPixelRatio(TIERS[this.tier].pixelRatio);
    this.rng = createRng(params.seed);

    this.pipeline = new FramePipeline(engine.renderer, this.caps, { tier: this.tier, post: params.post });
    this.pipeline.debug = params.debug;
    this.track = createTrack();
    this.world = createWorld({ renderer: engine.renderer, caps: this.caps, tier: this.tier, track: this.track, rng: this.rng, params });
    if (this.world.time.name !== params.time) this.world.setTime(params.time);
    this.effects = new Effects({ scene: this.world.scene, track: this.track, tier: this.tier, rng: this.rng.fork('effects') });

    this.input = new Input(container);
    this.input.onAction = (name, driver) => this.action(name, driver);
    this.input.onTouchChange = () => (this._touchDirty = true);
    this.input.onAnyInput = () => this._unlockSound();
    this.hud = new Hud(container, {
      enabled: params.ui,
      onAction: (name, driver) => {
        this._unlockSound();
        this.action(name, driver);
      },
    });

    // SEAM: sound
    this.audio = null;
    this.sound = null;
    const Audio = soundModules['../engine/Audio.js'];
    const SoundModule = soundModules['./Sound.js'];
    if (Audio && SoundModule && Audio.GameAudio && SoundModule.Sound) {
      this.audio = new Audio.GameAudio();
      if (params.mute) this.audio.setMuted(true);
      this.sound = new SoundModule.Sound(this.audio, { voices: 2 });
    }
    this.muted = params.mute || !this.sound;

    /** title | countdown | run | results */
    this.phase = 'title';
    /** @type {'solo'|'split'} */
    this.mode = params.mode;
    this.laps = params.laps ?? RULES.laps;
    /** @type {Race|null} */
    this.race = null;
    this.runs = 0;
    this.highBeam = false;
    /** Per driver: the camera mode they chose. */
    this.cameraModes = [params.camera, params.camera];
    /** Drivers whose car is to be put back in the next step. */
    this._resets = new Set();
    /** The day-night fade: { t, to, switched } or null. */
    this._fade = null;
    this._touchDirty = false;
    this._fxCars = [];
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
      for (const view of this.views) if (view.probe) view.probe.reset();
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
    for (const view of this.views) if (view.probe) view.probe.dispose();
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
        beam: { pos: new THREE.Vector3(), dir: new THREE.Vector3(), low: 0, high: 0 },
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
    const sharp = this.racers.map((racer) => racer.sharp);
    this.beams = this.racers.map((racer) => racer.beam);
    this._fxCars = this.racers.map((racer) => ({ vehicle: racer.vehicle, impacts: racer.impacts }));

    this.hud.setViews(n);
    this.views = this.racers.map((racer, i) => {
      // (ENGINE lane) what the car's paint mirrors: a cube picture of its surroundings, a face or two a frame
      const probe = params.probe ? new ReflectionProbe(engine.renderer, TIERS[this.tier].probeSize) : null;
      return {
        racer,
        camera: new THREE.PerspectiveCamera(CAMERA.chase.fov, 1, VIEW.near, VIEW.far),
        rig: new CameraRig(this.phase === 'title' ? 'orbit' : this.cameraModes[i]),
        hud: this.hud.views[i],
        rect: { x: 0, y: 0, w: 1, h: 1 },
        zone: { left: 0, top: 0, width: 1, height: 1 },
        frame: { exposure: 1, look: world.time.look, motionBlur: VIEW.motionBlur, cut: true, sharp, probe: probe?.texture },
        exposure: this._exposureFor(racer.vehicle),
        probe,
      };
    });
    this.layout();
    for (const view of this.views) view.rig.snap(view.racer.vehicle);
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
    const sideBySide = engine.aspect >= 1;
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
      view.hud.setZone(view.zone);
    });
    this.input.zones = views.map((view) => view.zone);
    this.hud.setSplit(two ? (sideBySide ? 'wide' : 'tall') : '');
  }

  // ------------------------------------------------------------------ flow

  /** A new run from the grid, in the current mode and time of day. */
  start() {
    this.engine.paused = false;
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
    this.world.setStartLights(0);
    this.views.forEach((view, i) => {
      view.rig.setMode(this.cameraModes[i]);
      view.rig.lookBack = false;
      view.rig.snap(view.racer.vehicle);
    });
  }

  /** Back to the title: the cars parked on the grid, the camera circling. */
  leave() {
    this.engine.paused = false;
    this.phase = 'title';
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
    const d = Math.max(0, Math.min(this.racers.length - 1, driver));
    const racing = this.phase === 'countdown' || this.phase === 'run' || this.phase === 'results';
    const paused = this.engine.paused;
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
        if (racing) this.engine.paused = !paused;
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
      case 'time':
        if (!this._fade) this._fade = { t: 0, to: TIME_NAMES[(TIME_NAMES.indexOf(this.world.time.name) + 1) % TIME_NAMES.length], switched: false };
        break;
      case 'high':
        this.highBeam = !this.highBeam;
        break;
      case 'mute':
        if (this.audio) {
          this.muted = !this.muted;
          this.audio.setMuted(this.muted);
        }
        break;
      default:
        return;
    }
    // with no loop running nobody would show the change
    if (this.engine.manual) this.engine.advance(0);
  }

  _unlockSound() {
    if (this.audio && !this.params.mute) this.audio.unlock();
  }

  /** Switch the time of day now (the fade calls this at its darkest). The board follows. */
  setTime(name) {
    this.world.setTime(name);
    if (this.race) this.race.setTime(name);
    for (const view of this.views) {
      view.exposure = this._exposureFor(view.racer.vehicle);
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
    this.layout();
    for (const view of this.views) view.exposure = this._exposureFor(view.racer.vehicle);
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
    const { race, racers } = this;
    const time = this.world.time;
    const phase = this.phase;

    for (const racer of racers) {
      const { vehicle, prevWheels, controls } = racer;
      for (let i = 0; i < 4; i++) {
        prevWheels[i].steer = vehicle.wheels[i].steer;
        prevWheels[i].travel = vehicle.wheels[i].travel;
      }
      if (phase === 'title') Object.assign(controls, HELD);
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
          ? 'On its roof'
          : v.stuckTime > RULES.offerStuck
            ? 'Stuck'
            : v.wrongWayTime > RULES.offerWrongWay
              ? 'Wrong way'
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
      view.rig.update(dt, racer.vehicle, this.track);
      // eyes take a moment to follow the light: closing down quickly, opening up slowly (eased in stops)
      const target = this._exposureFor(racer.vehicle);
      const tau = target < view.exposure ? EXPOSURE.close : EXPOSURE.open;
      view.exposure = Math.exp(damp(Math.log(view.exposure), Math.log(target), 1 / tau, dt));
    });

    // the lamps: running lights always, the low beam when the time of day asks or a while into the tunnel
    const night = time.name === 'night';
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
      l.interior = night ? LIGHTS.interior : 0;
    }

    this.world.update(dt, simTime);
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
        const text = e.gap === null ? formatMs(e.ms) : formatMs(e.gap, true);
        const label = e.type === 'lap' ? `Lap ${formatMs(e.ms)}${e.best ? '  best' : ''}${e.gap === null ? '' : '  ' + text}` : text;
        if (view) view.hud.flashLine(label, e.gap === null ? '' : ahead ? 'ahead' : 'behind', race.clock + 2);
        if (sound) sound.cue(e.type, pan, { ahead });
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
        this.hud.setResults(this._resultsHtml());
        break;
    }
  }

  _resultsHtml() {
    const race = this.race;
    const parts = race.cars.map((c, i) => {
      const best = race.bestLap(i);
      const medal = medalOf(best);
      const laps = c.times
        .map((l, k) => `<tr><td>Lap ${k + 1}</td><td>${formatMs(l.ms)}</td><td>${l.ms === best ? 'best' : ''}${l.putBack ? ' put back' : ''}</td></tr>`)
        .join('');
      const who = race.cars.length > 1 ? `<div>Driver ${i + 1}: ${c.finished ? `P${c.position}` : 'did not finish'}</div>` : '';
      return `${who}<table>${laps}</table><div>Total ${c.finished ? formatMs(c.finishMs) : '-'} · best lap ${formatMs(best)} · ${medal ? medal + ' medal' : 'no medal'}</div>`;
    });
    const mark = race.bestLap(0);
    return parts.join('<hr>') + this.hud.boardHtml(race.table, RULES.medals, race.time, mark);
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
      car.setReflections({ cube: this.views[racer.index]?.probe?.texture ?? null, sky: vehicle.sky });

      obj.updateMatrixWorld();
      sharp.prevMatrix.copy(sharp.matrix);
      sharp.matrix.copy(obj.matrixWorld);

      // the head lamps as the world's reflectors see them: from the front of the car, along it
      const b = racer.beam;
      b.dir.set(0, 0, 1).applyQuaternion(obj.quaternion);
      b.pos.set(0, 0.65, 2.2).applyQuaternion(obj.quaternion).add(obj.position);
      b.low = racer.lamps.low;
      b.high = racer.lamps.high;
    }

    const fade = this._fadeLevel;
    for (const view of this.views) {
      view.rig.apply(view.camera, alpha);
      const speed = Math.abs(view.racer.vehicle.speed);
      view.frame.exposure = view.exposure * fade;
      view.frame.look = time.look;
      view.frame.motionBlur = lerp(VIEW.motionBlurSlow, VIEW.motionBlur, clamp01(speed / VIEW.blurSpeed));
      view.frame.cut = view.frame.cut || view.rig.cut;
    }

    this.input.poll();
    if (this.params.ui) this._hud();
    if (this.sound) {
      this.sound.update(
        frameDt,
        this.racers.map((r) => {
          const v = r.vehicle;
          let skid = 0;
          let surf = 0;
          for (const w of v.wheels) {
            skid = Math.max(skid, w.skid);
            surf = Math.max(surf, w.surface);
          }
          return { rpm: v.rpm, throttle: v.throttle, speed: v.speed, gear: v.gear, skid, surface: surf, scrape: v.scrape, pan: this._pan(r.index), sky: v.sky };
        }),
      );
    }
  }

  /** The HUD's readouts: every call is cheap, the DOM is only touched where something changed. */
  _hud() {
    const { hud, race } = this;
    hud.setState({ phase: this.phase, paused: this.engine.paused, mode: this.mode, time: this.world.time.name, muted: this.muted });
    if (this.phase === 'title') {
      hud.setTitleText(
        `${this.mode === 'split' ? 'Two drivers' : 'One driver'}, ${this.world.time.name === 'day' ? 'by day' : 'by night'}. ` +
          'Keys: WASD or arrows, Space handbrake, C view, B look back, R put back, N day or night, H high beam, P pause. Enter to drive.',
      );
      hud.setTitleBoard(hud.boardHtml(this._boardTable(), RULES.medals, this.world.time.name));
    }
    const rect = this._touchDirty ? this.container.getBoundingClientRect() : null;
    this.views.forEach((view, i) => {
      const h = view.hud;
      const v = view.racer.vehicle;
      if (race) {
        const c = race.cars[i];
        const waiting = race.clock < 0;
        h.setLamps(race.lit, waiting);
        h.setLap(c.lap, race.laps, c.finished);
        h.setClock(race.lapClock(i), waiting);
        h.setLive(this.racers.length > 1 ? null : c.live);
        h.setPosition(c.position, race.cars.length);
        h.tick(race.clock);
      }
      h.setSpeed(v.speed * 3.6);
      h.setGear(v.gear, v.rpm);
      const a = v.assists;
      const marks = [a.abs > 0.1 ? 'ABS' : '', a.tc > 0.1 ? 'TC' : '', a.esc > 0.1 ? 'ESC' : '', view.racer.lamps.high ? 'high beam' : '']
        .filter(Boolean)
        .join(' ');
      h.setMarks(marks);
      h.setOffer(view.racer.offer ? `${view.racer.offer}: R puts the car back` : '');
      if (rect) h.setStick(this.input.stickOf(i), rect);
    });
    this._touchDirty = false;
  }

  /** The board's table for the time of day showing (read from storage through a throwaway race when none runs). */
  _boardTable() {
    if (this.race) return this.race.board[this.world.time.name];
    if (!this._board || this._boardRuns !== this.runs) {
      this._board = new Race(this.track, { racers: 1, time: 'day', mode: 'solo', rng: createRng(1) }).board;
      this._boardRuns = this.runs;
    }
    return this._board[this.world.time.name];
  }

  /** Draw every view into its rectangle. */
  draw() {
    const { probeFaces, probeEvery } = TIERS[this.tier];
    const n = this.views.length;
    this.views.forEach((view, i) => {
      const car = view.racer.car;
      this.world.prepareView(view.camera, car.object.position, this.beams);
      // (ENGINE lane) the car's probe, from the middle of the car, without the car itself; after prepareView, so
      // that the shadows it shows are this view's. In split screen the two take turns.
      if (view.probe && this.engine.frame % (probeEvery * n) === i * probeEvery) {
        probeAt.copy(car.box.center).applyMatrix4(car.object.matrixWorld);
        probeHidden.length = 0;
        for (const r of this.racers) {
          if (r.car === car) probeHidden.push(r.car.object);
          if (r.car.shadow && r.car === car) probeHidden.push(r.car.shadow);
        }
        probeHidden.push(...this.world.probeHidden);
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
      clock: race ? Math.round(race.clock * 1000) / 1000 : null,
      lamps: race ? race.lit : 0,
      highBeam: this.highBeam,
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
