// PLACEHOLDERS for parts of the game that are not written yet. Each has the
// interface the build contract gives the real one, so Game.js is written
// against the final shapes and only its imports change:
//
//   createPlaceholderTrack()   for createTrack()                 game/track.js
//   PlaceholderVehicle         for Vehicle                       game/vehicle/
//   PlaceholderDriver          for PlayerDriver and AutoDriver   game/drivers.js
//   PlaceholderInput           for Input                         engine/Input.js
//   ChaseRig                   for the rigs of                   game/Cameras.js
//
// Only what the skeleton reads is here. Delete this file when the last of
// them has been replaced.

import * as THREE from 'three';
import { DIMS, WHEELS } from '../assets/car/spec.js';
import { angleDiff, approach, clamp, clamp01, damp, dampAngle, lerp, wrap, wrapAngle } from '../engine/math.js';
import { CAMERA } from './config.js';

const newFrame = () => ({
  pos: new THREE.Vector3(),
  tan: new THREE.Vector3(),
  left: new THREE.Vector3(),
  up: new THREE.Vector3(),
  bank: 0,
  curvature: 0,
  grade: 0,
});

// ------------------------------------------------------------------ track

/**
 * A flat oval, 600 m round: two straights joined by two half circles of 40 m, all right-hand bends (clockwise on
 * the map). The start line is 50 m along the first straight, which runs towards +Z at x = +40.
 */
export function createPlaceholderTrack() {
  const R = 40;
  const length = 600;
  const L = (length - 2 * Math.PI * R) / 2; // one straight
  const arc = Math.PI * R;
  const start = 50;
  const frame = newFrame();

  const track = {
    length,
    halfWidth: 4.25,
    count: length,
    ds: 1,
    tunnels: [],
    bridges: [],
    sectors: [length / 3, (2 * length) / 3],
    /** Street lamps round the start, alternating sides. */
    lamps: [-60, -20, 20, 60, 100, 140].map((s, i) => ({ s: wrap(s, length), side: i % 2 ? -1 : 1, height: 8 })),

    /** The centre line at distance `s`: { pos, tan, left, up, bank, curvature, grade }. */
    frameAt(s, out) {
      const u = wrap(s + start, length);
      let x;
      let z;
      let yaw;
      let curvature = 0;
      if (u < L) {
        x = R;
        z = u - L / 2;
        yaw = 0;
      } else if (u < L + arc) {
        const a = (u - L) / R;
        x = R * Math.cos(a);
        z = L / 2 + R * Math.sin(a);
        yaw = -a;
        curvature = -1 / R;
      } else if (u < 2 * L + arc) {
        x = -R;
        z = L / 2 - (u - L - arc);
        yaw = -Math.PI;
      } else {
        const a = (u - 2 * L - arc) / R;
        x = -R * Math.cos(a);
        z = -L / 2 - R * Math.sin(a);
        yaw = -Math.PI - a;
        curvature = -1 / R;
      }
      out.pos.set(x, 0, z);
      out.tan.set(Math.sin(yaw), 0, Math.cos(yaw));
      out.left.set(Math.cos(yaw), 0, -Math.sin(yaw));
      out.up.set(0, 1, 0);
      out.bank = 0;
      out.curvature = curvature;
      out.grade = 0;
      return out;
    },

    /** The nearest point of the centre line to (x, z): { index, s, lat } (lat + = left of travel). */
    locate(x, z, hint, out) {
      let u;
      let lat;
      if (z > L / 2) {
        u = L + Math.atan2(z - L / 2, x) * R;
        lat = Math.hypot(x, z - L / 2) - R;
      } else if (z < -L / 2) {
        u = 2 * L + arc + Math.atan2(-L / 2 - z, -x) * R;
        lat = Math.hypot(x, z + L / 2) - R;
      } else if (x >= 0) {
        u = z + L / 2;
        lat = x - R;
      } else {
        u = L + arc + L / 2 - z;
        lat = -R - x;
      }
      out.s = wrap(u - start, length);
      out.lat = lat;
      out.index = Math.floor(out.s / track.ds) % track.count;
      return out;
    },

    /** Start position for slot 0..3: staggered pairs behind the line. */
    grid(slot, out) {
      track.frameAt(-8 - 8 * slot, frame);
      const lat = slot % 2 ? -1.9 : 1.9;
      out.x = frame.pos.x + frame.left.x * lat;
      out.y = frame.pos.y;
      out.z = frame.pos.z + frame.left.z * lat;
      out.yaw = Math.atan2(frame.tan.x, frame.tan.z);
      return out;
    },
  };
  return track;
}

// ---------------------------------------------------------------- vehicle

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const where = { index: -1, s: 0, lat: 0 };

/**
 * A car that is moved, not simulated: a bicycle that goes where its front wheel points, as fast as the pedals
 * say, and leans a little so that the pose is more than a heading. It keeps the two things the real Vehicle
 * promises the game: the pose before and after each step, and four wheels to pose.
 */
export class PlaceholderVehicle {
  constructor(track) {
    this.track = track;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.prevPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.throttle = 0;
    this.brake = 0;
    /** About +Y: a right turn is negative. */
    this.steerAngle = 0;
    this.wheels = WHEELS.map(() => ({ steer: 0, spin: 0, omega: 0, travel: 0 }));
    this.trackIndex = -1;
    this.s = 0;
    this.lat = 0;
    /** How much sky is overhead, 0..1 (the placeholder track has no tunnel). */
    this.sky = 1;
    this._roll = 0;
    this._pitch = 0;
    this._frame = newFrame();
  }

  /** Put it at rest at a place. */
  reset({ x, y, z, yaw }) {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.speed = 0;
    this.steerAngle = 0;
    this._roll = this._pitch = 0;
    this.velocity.set(0, 0, 0);
    this.quaternion.setFromEuler(euler.set(0, yaw, 0));
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    for (const w of this.wheels) w.steer = w.spin = w.omega = w.travel = 0;
    this.trackIndex = -1;
    this._locate();
  }

  /** @param {number} dt @param {{ steer: number, throttle: number, brake: number, handbrake: boolean }} controls */
  step(dt, controls) {
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    this.throttle = controls.throttle;
    this.brake = controls.brake;

    // the steering lock closes with speed, as a driver's hands do
    const lock = lerp(0.6, 0.05, clamp01(this.speed / 55));
    this.steerAngle = approach(this.steerAngle, -controls.steer * lock, 1.6 * dt);
    const braking = 9.5 * controls.brake + (controls.handbrake ? 6 : 0);
    const drive = 4.5 * controls.throttle * (1 - clamp01(this.speed / 69));
    const drag = 0.015 * this.speed + 0.0007 * this.speed * this.speed;
    const accel = drive - (this.speed > 0 ? braking : 0) - drag;
    this.speed = Math.max(0, this.speed + accel * dt);
    // tyres hold about one g: asked for more, it runs wide
    const limit = 9.5 / Math.max(this.speed, 1);
    const yawRate = clamp((this.speed * Math.tan(this.steerAngle)) / DIMS.wheelbase, -limit, limit);
    this.yaw = wrapAngle(this.yaw + yawRate * dt);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.velocity.set(fx * this.speed, 0, fz * this.speed);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this._locate();

    // leans out of the bend, dives under braking (about +Z and +X of the car)
    this._roll = damp(this._roll, 0.0045 * this.speed * yawRate, 8, dt);
    this._pitch = damp(this._pitch, -0.003 * accel, 8, dt);
    this.quaternion.setFromEuler(euler.set(this._pitch, this.yaw, this._roll));

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const spec = WHEELS[i];
      w.steer = spec.front ? this.steerAngle : 0;
      w.omega = this.speed / spec.tyre.radius;
      w.spin += w.omega * dt;
      // the body turns about the ground under its middle; the wheels stay on the road
      w.travel = spec.z * this._pitch - spec.x * this._roll;
    }
  }

  _locate() {
    this.track.locate(this.position.x, this.position.z, this.trackIndex, where);
    this.trackIndex = where.index;
    this.s = where.s;
    this.lat = where.lat;
    this.position.y = this.track.frameAt(this.s, this._frame).pos.y;
  }
}

// ------------------------------------------------------------------ input

const KEYS = {
  wasd: { left: 'KeyA', right: 'KeyD', throttle: 'KeyW', brake: 'KeyS' },
  arrows: { left: 'ArrowLeft', right: 'ArrowRight', throttle: 'ArrowUp', brake: 'ArrowDown' },
};

/** Keys only. `read` has the shape of the real Input's. */
export class PlaceholderInput {
  constructor() {
    this.down = new Set();
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      // the arrow keys and the space bar must not scroll the page
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /**
   * @param {{ steer: number, throttle: number, brake: number, handbrake: boolean, analog: boolean }} out
   * @param {'all'|'wasd'|'arrows'} [scheme]
   */
  read(out, scheme = 'all') {
    const held = (name) => (scheme !== 'arrows' && this.down.has(KEYS.wasd[name])) || (scheme !== 'wasd' && this.down.has(KEYS.arrows[name]));
    out.steer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    out.throttle = held('throttle') ? 1 : 0;
    out.brake = held('brake') ? 1 : 0;
    out.handbrake = this.down.has('Space');
    out.analog = false;
    return out;
  }
}

// ----------------------------------------------------------------- driver

/** Seconds without a key before the cruise takes the wheel back. */
const HANDS_OFF = 3;
const CRUISE_SPEED = 27;

/**
 * Whoever holds the wheel. With keys pressed (and for a few seconds after) it is the player; otherwise, and
 * always with `autopilot`, the car cruises round its lane by steering at a point on the road ahead.
 */
export class PlaceholderDriver {
  /**
   * @param {object} track
   * @param {PlaceholderInput} input
   * @param {'all'|'wasd'|'arrows'} scheme
   * @param {{ autopilot?: boolean, lane?: number }} [options] `lane`: metres left of the centre line to cruise at
   */
  constructor(track, input, scheme, { autopilot = false, lane = 0 } = {}) {
    this.track = track;
    this.input = input;
    this.scheme = scheme;
    this.autopilot = autopilot;
    this.lane = lane;
    this._idle = Infinity;
    this._frame = newFrame();
  }

  /** Fills `out` with { steer, throttle, brake, handbrake, analog } for this step. */
  drive(vehicle, dt, out) {
    if (!this.autopilot) {
      this.input.read(out, this.scheme);
      const touched = out.steer !== 0 || out.throttle > 0 || out.brake > 0 || out.handbrake;
      this._idle = touched ? 0 : this._idle + dt;
      if (this._idle < HANDS_OFF) return out;
    }
    const { track } = this;
    const frame = track.frameAt(wrap(vehicle.s + 8 + 0.7 * vehicle.speed, track.length), this._frame);
    const dx = frame.pos.x + frame.left.x * this.lane - vehicle.position.x;
    const dz = frame.pos.z + frame.left.z * this.lane - vehicle.position.z;
    const bearing = Math.atan2(dx, dz);
    // steer is +1 to the right; a target to the left is a positive angle
    out.steer = clamp(-2.2 * angleDiff(vehicle.yaw, bearing), -1, 1);
    const target = frame.curvature ? Math.min(CRUISE_SPEED, Math.sqrt(6.5 / Math.abs(frame.curvature))) : CRUISE_SPEED;
    out.throttle = clamp01((target - vehicle.speed) * 0.5);
    out.brake = clamp01((vehicle.speed - target - 1.5) * 0.25);
    out.handbrake = false;
    out.analog = true;
    return out;
  }
}

// ----------------------------------------------------------------- camera

const NARROW = 4 / 3;
const position = new THREE.Vector3();
const target = new THREE.Vector3();

/**
 * The chase camera: low and close behind the car, following where the car is going more than where it points,
 * and height lazily.
 *
 * What it remembers (the heading it has swung round to, the height it has drifted to, the speed it has widened
 * its lens for) moves in the fixed step like everything else with a memory: a run that is fast-forwarded without
 * drawing finds the camera where it would have been. Where the camera actually stands is worked out when a frame
 * is drawn, from that memory and the car's pose, both taken between the last two steps, and the shape of the
 * picture as it is now.
 */
export class ChaseRig {
  constructor() {
    this.aspect = 16 / 9;
    /** True until the next frame has been drawn after a jump: the pipeline must not blur across it. */
    this.cut = true;
    this._yaw = 0;
    this._y = 0;
    this._speed = 0;
    this._prevYaw = 0;
    this._prevY = 0;
    this._prevSpeed = 0;
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  /** Jump straight behind the car (the start, a reset, a new view). */
  snap(vehicle) {
    this._yaw = this._prevYaw = vehicle.yaw;
    this._y = this._prevY = vehicle.position.y;
    this._speed = this._prevSpeed = vehicle.speed;
    this.cut = true;
  }

  /** One fixed step. */
  update(dt, vehicle) {
    const c = CAMERA.chase;
    this._prevYaw = this._yaw;
    this._prevY = this._y;
    this._prevSpeed = this._speed;
    const travel = vehicle.speed > 4 ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z) : vehicle.yaw;
    this._yaw = dampAngle(this._yaw, vehicle.yaw + angleDiff(vehicle.yaw, travel) * c.slide, c.yawRate, dt);
    this._y = damp(this._y, vehicle.position.y, c.heightRate, dt);
    this._speed = vehicle.speed;
  }

  /**
   * Pose `camera` for a frame drawn between the last two steps.
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ position: THREE.Vector3, prevPosition: THREE.Vector3 }} vehicle
   * @param {number} alpha 0..1
   */
  apply(camera, vehicle, alpha) {
    const c = CAMERA.chase;
    const yaw = this._prevYaw + angleDiff(this._prevYaw, this._yaw) * alpha;
    const y = lerp(this._prevY, this._y, alpha);
    const p = position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
    // how much narrower than 4:3 the picture is, 0..1 (1: a phone held upright)
    const narrow = clamp01((NARROW - this.aspect) / (NARROW - 0.5));
    const distance = c.distance * lerp(1, c.narrowBack, narrow);
    const height = c.height * lerp(1, c.narrowLift, narrow);
    const bx = Math.sin(yaw);
    const bz = Math.cos(yaw);
    target.set(p.x + bx * c.lookAhead, p.y + c.lookHeight, p.z + bz * c.lookAhead);
    camera.position.set(p.x - bx * distance, y + height, p.z - bz * distance);
    camera.lookAt(target);

    const fast = clamp01(lerp(this._prevSpeed, this._speed, alpha) / c.fastSpeed);
    let fov = lerp(c.fov, c.fovFast, fast * fast);
    if (this.aspect < NARROW) {
      // a narrow picture keeps the width of view a 4:3 one would have, and grows taller instead
      const half = Math.atan((Math.tan((fov * Math.PI) / 360) * NARROW) / this.aspect);
      fov = Math.min(95, (half * 360) / Math.PI);
    }
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
