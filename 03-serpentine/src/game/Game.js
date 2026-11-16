// The run: who drives what, where the cameras are, and how a frame is put
// together from the world, the cars and the frame pipeline.
//
// SKELETON. The cars are boxes moved round an oval by stand-ins
// (placeholder.js), there is one phase, no HUD and no sound. What is final is
// the shape, which every later part plugs into:
//
//   update(dt)      the fixed step. Everything with a memory changes here and
//                   only here: drivers, vehicles, the world, the camera rigs,
//                   the exposure. A run that is fast-forwarded without
//                   drawing is the same run.
//   render(alpha)   once per drawn frame: pose the models and the cameras
//                   between the last two steps. Changes nothing that the next
//                   step reads.
//   draw()          for each view: the world prepares for that camera, the
//                   pipeline draws the scene into the view's rectangle.
//
// A view is one local driver's part of the screen. Solo has one; split screen
// has two, side by side on a wide window and stacked on a tall one.

import * as THREE from 'three';
import { createCar } from '../assets/car/index.js';
import { createWorld } from '../assets/world/index.js';
import { TIME_NAMES } from '../assets/world/lighting.js';
import { Engine, FIXED_DT } from '../engine/Engine.js';
import { FramePipeline } from '../engine/FramePipeline.js';
import { TIERS, probeCaps } from '../engine/caps.js';
import { damp, lerp } from '../engine/math.js';
import { createRng } from '../engine/rng.js';
import { CAMERA, DRIVERS, EXPOSURE, LAMPS, VIEW } from './config.js';
import { ChaseRig, PlaceholderDriver, PlaceholderInput, PlaceholderVehicle, createPlaceholderTrack } from './placeholder.js';

/**
 * One car in the run.
 * @typedef {object} Racer
 * @property {number} index
 * @property {import('../assets/car/index.js').CarModel} car what is drawn
 * @property {PlaceholderVehicle} vehicle what is simulated
 * @property {PlaceholderDriver} driver who holds the wheel
 * @property {{ steer: number, throttle: number, brake: number, handbrake: boolean, analog: boolean }} controls
 * @property {Array<{ steer: number, travel: number }>} prevWheels the wheels before the last step
 * @property {{ matrix: THREE.Matrix4, prevMatrix: THREE.Matrix4, center: THREE.Vector3, half: THREE.Vector3 }} sharp
 *   its box for the motion blur: where it is in this frame and where it was in the last
 *
 * One local driver's part of the screen.
 * @typedef {object} View
 * @property {Racer} racer
 * @property {THREE.PerspectiveCamera} camera
 * @property {ChaseRig} rig
 * @property {object|null} hud this view's readouts (none yet)
 * @property {{ x: number, y: number, w: number, h: number }} rect its rectangle of the canvas, device pixels, GL origin
 * @property {{ left: number, top: number, width: number, height: number }} zone the same as fractions of the window
 *   from the top left: for the HTML overlay and for touches
 * @property {import('../engine/FramePipeline.js').ViewFrame} frame what the pipeline is told about it
 * @property {number} exposure eased in the fixed step
 * @property {object|null} probe the car's reflection probe (none yet)
 */

export class Game {
  /**
   * @param {HTMLElement} container
   * @param {import('../engine/params.js').Params} params
   */
  constructor(container, params) {
    this.params = params;
    const engine = new Engine(container, { manual: params.manual, pixelRatio: params.dpr, draw: !params.nodraw });
    this.engine = engine;
    this.caps = probeCaps(engine.renderer, { ldr: params.ldr });
    /** @type {import('../engine/caps.js').Tier} */
    this.tier = params.quality ?? this.caps.tier;
    engine.setMaxPixelRatio(TIERS[this.tier].pixelRatio);
    this.rng = createRng(params.seed);

    this.pipeline = new FramePipeline(engine.renderer, this.caps, { tier: this.tier, post: params.post });
    this.pipeline.debug = params.debug;
    this.track = createPlaceholderTrack();
    this.world = createWorld({ renderer: engine.renderer, caps: this.caps, tier: this.tier, track: this.track, rng: this.rng, params });
    this.input = new PlaceholderInput();

    /** title | countdown | run | results. The skeleton only runs. */
    this.phase = 'run';
    /** @type {'solo'|'split'} */
    this.mode = 'solo';
    /** @type {Racer[]} */
    this.racers = [];
    /** @type {View[]} */
    this.views = [];
    this.highBeam = false;
    this.setup(params.mode);

    engine.onResize(() => this.layout());
    // pictures that only lived on the GPU (the environment map) are drawn again
    engine.onContextRestored(() => this.world.restore());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyN') this.setTime(TIME_NAMES[(TIME_NAMES.indexOf(this.world.time.name) + 1) % TIME_NAMES.length]);
      else if (e.code === 'KeyH') this.highBeam = !this.highBeam;
      else return;
      // with no loop running nobody would show the change
      if (engine.manual) engine.advance(0);
    });

    engine.onUpdate = (dt, simTime) => this.update(dt, simTime);
    engine.onRender = (frameDt, alpha) => this.render(alpha);
    engine.onDraw = () => this.draw();
  }

  // ------------------------------------------------------------------ setup

  /**
   * Put the cars on the grid and give each local driver a view.
   * @param {'solo'|'split'} mode
   */
  setup(mode) {
    const { world, track, params } = this;
    for (const racer of this.racers) {
      world.scene.remove(racer.car.object);
      racer.car.dispose();
    }
    this.mode = mode;
    const split = mode === 'split';
    const place = { x: 0, y: 0, z: 0, yaw: 0 };

    this.racers = DRIVERS.slice(0, split ? 2 : 1).map((who, index) => {
      const car = createCar({
        paint: (index === 0 && params.paint) || who.paint,
        plate: (index === 0 ? params.plate : params.plate2) || who.plate,
        tier: this.tier,
        caps: this.caps,
      });
      world.scene.add(car.object);
      const vehicle = new PlaceholderVehicle(track);
      vehicle.reset(track.grid(index, place));
      // one keyboard between two drivers: each gets half of it, and a lane of their own to cruise in
      const keys = split ? who.keys : 'all';
      const driver = new PlaceholderDriver(track, this.input, keys, { autopilot: params.autopilot, lane: index ? -1.9 : 1.9 });
      return {
        index,
        car,
        vehicle,
        driver,
        controls: { steer: 0, throttle: 0, brake: 0, handbrake: false, analog: false },
        prevWheels: vehicle.wheels.map(() => ({ steer: 0, travel: 0 })),
        sharp: { matrix: new THREE.Matrix4(), prevMatrix: new THREE.Matrix4(), center: car.box.center, half: car.box.half },
      };
    });
    const sharp = this.racers.map((racer) => racer.sharp);

    this.views = this.racers.map((racer) => ({
      racer,
      camera: new THREE.PerspectiveCamera(CAMERA.chase.fov, 1, VIEW.near, VIEW.far),
      rig: new ChaseRig(),
      hud: null,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      zone: { left: 0, top: 0, width: 1, height: 1 },
      frame: { exposure: 1, look: world.time.look, motionBlur: VIEW.motionBlur, cut: true, sharp },
      exposure: this._exposureFor(racer.vehicle),
      probe: null,
    }));
    this.layout();
    for (const view of this.views) view.rig.snap(view.racer.vehicle);
    // nothing has moved yet: the boxes start where they are
    this.render(1);
    for (const racer of this.racers) racer.sharp.prevMatrix.copy(racer.sharp.matrix);
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
    });
    this.pipeline.scale = engine.renderScale;
  }

  /**
   * Switch the time of day. The exposure jumps with it: this is a cut, not a sunset.
   * @param {'day'|'night'} name
   */
  setTime(name) {
    this.world.setTime(name);
    for (const view of this.views) view.exposure = this._exposureFor(view.racer.vehicle);
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

  // ----------------------------------------------------------- fixed step

  update(dt, simTime) {
    for (const racer of this.racers) {
      const { vehicle, prevWheels } = racer;
      for (let i = 0; i < 4; i++) {
        prevWheels[i].steer = vehicle.wheels[i].steer;
        prevWheels[i].travel = vehicle.wheels[i].travel;
      }
      racer.driver.drive(vehicle, dt, racer.controls);
      vehicle.step(dt, racer.controls);
    }
    this.world.update(dt, simTime);
    for (const view of this.views) {
      view.rig.update(dt, view.racer.vehicle);
      // eyes take a moment to follow the light: into the tunnel, and out again
      view.exposure = damp(view.exposure, this._exposureFor(view.racer.vehicle), EXPOSURE.rate, dt);
    }
  }

  // -------------------------------------------------------------- a frame

  /**
   * Pose everything between the last two steps.
   * @param {number} alpha 0 = as it was before the last step, 1 = as it is after
   */
  render(alpha) {
    const time = this.world.time;
    for (const racer of this.racers) {
      const { car, vehicle, prevWheels, sharp } = racer;
      car.object.position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
      car.object.quaternion.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);
      for (let i = 0; i < 4; i++) {
        const w = vehicle.wheels[i];
        car.setWheel(i, {
          steer: lerp(prevWheels[i].steer, w.steer, alpha),
          // the spin only ever accumulates: step back from where it is by what it turned in the part not shown
          spin: w.spin - w.omega * FIXED_DT * (1 - alpha),
          travel: lerp(prevWheels[i].travel, w.travel, alpha),
        });
      }

      // automatic lamps: what the time of day asks for under the open sky, dipped beam in a tunnel
      const lamps = LAMPS[vehicle.sky < 0.5 ? 'low' : time.carLights];
      car.setLights({ ...lamps, high: this.highBeam && lamps.low ? 1 : 0, brake: vehicle.brake > 0.02 ? 1 : 0 });
      car.setReflections({ cube: null, sky: vehicle.sky });

      car.object.updateMatrixWorld();
      sharp.prevMatrix.copy(sharp.matrix);
      sharp.matrix.copy(car.object.matrixWorld);
    }

    for (const view of this.views) {
      view.rig.apply(view.camera, view.racer.vehicle, alpha);
      view.frame.exposure = view.exposure;
      view.frame.look = time.look;
      view.frame.motionBlur = VIEW.motionBlur;
      view.frame.cut = view.rig.cut;
    }
  }

  /** Draw every view into its rectangle. */
  draw() {
    for (const view of this.views) {
      this.world.prepareView(view.camera, view.racer.car.object.position);
      this.pipeline.render(this.world.scene, view.camera, view.rect, view.frame);
      view.rig.cut = false;
    }
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
