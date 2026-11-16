// Who is at the wheel: a person's hands and feet made fit for a car, or an autopilot that knows the road.
//
// PlayerDriver turns a key that is either down or up into steering a car can use: the wheel moves at a rate, to a
// lock that shrinks with speed (all of it at walking pace, a few degrees at 200 km/h: about what takes the front
// tyres to their limit and no further), and comes back when the key is let go. A stick or a thumb is trusted and
// only given the same lock.
//
// AutoDriver works out, once, a line round the lap (the smoothest path that stays on the pavement) and how fast
// each metre of it can be taken (cornering grip first, then braking backwards from every bend and the engine's
// pull forwards from it), then steers at a point on that line a little way ahead and holds the speed. It is
// what ?ap runs, what the tests lap with and what takes the car home after the flag.

import { CAR } from './vehicle/params.js';

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Lateral acceleration (m/s²) a full steering input may ask for: just under what the tyres hold. */
const STEER_GRIP = 9.3;
/** Front slip angle (rad) a full input adds to the angle the bend itself needs, at low and at high speed. */
const STEER_SLIP_SLOW = 0.105;
const STEER_SLIP_FAST = 0.07;

/** The most steering (rad at the road wheels) worth having at the car's present speed. */
function steerLimit(vehicle) {
  const p = vehicle.params;
  const speed = Math.abs(vehicle.speed);
  const fast = clamp01(speed / 55);
  const slip = STEER_SLIP_SLOW + (STEER_SLIP_FAST - STEER_SLIP_SLOW) * fast;
  const bend = speed > 1 ? Math.atan((p.wheelbase * STEER_GRIP) / (speed * speed)) : Math.PI / 2;
  return Math.min(p.steering.lock, bend + slip);
}

/** The angle between where the car points and where it is going (rad, + = it is travelling to the left of its nose). */
function bodySlip(vehicle) {
  if (vehicle.speed < 3) return 0;
  const v = vehicle.velocity;
  const sin = Math.sin(vehicle.yaw), cos = Math.cos(vehicle.yaw);
  return Math.atan2(v.x * cos - v.z * sin, v.x * sin + v.z * cos);
}

/** A person on this machine. */
export class PlayerDriver {
  /**
   * @param {{ read: (out: object, scheme: string, zone: any) => void }} input engine/Input.js
   * @param {'all'|'wasd'|'arrows'|string} [scheme] which keys (or which pad) this driver uses
   * @param {any} [zone] the part of the screen whose touches are this driver's (split screen on a tablet)
   */
  constructor(input, scheme = 'all', zone = null) {
    this.input = input;
    this.scheme = scheme;
    this.zone = zone;
    this._raw = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false };
    this._steer = 0; // -1..1 of the lock allowed at this speed
    this._throttle = 0;
    this._brake = 0;
  }

  /**
   * @param {import('./vehicle/Vehicle.js').Vehicle} vehicle
   * @param {number} dt
   * @param {{steer:number, throttle:number, brake:number, handbrake:number}} out the car's controls
   */
  drive(vehicle, dt, out) {
    const raw = this._raw;
    this.input.read(raw, this.scheme, this.zone);
    const lock = vehicle.params.steering.lock;
    const fast = clamp01(Math.abs(vehicle.speed) / 60);
    const slide = bodySlip(vehicle);
    // a car that is sliding needs lock to catch it, however fast it is going
    const limit = Math.min(lock, steerLimit(vehicle) + Math.abs(slide));
    const want = clamp(+raw.steer || 0, -1, 1);
    if (raw.analog) {
      this._steer = want;
      this._throttle = clamp01(+raw.throttle || 0);
      this._brake = clamp01(+raw.brake || 0);
      out.steer = (want * limit) / lock;
    } else {
      // a key: wind the wheel on, quicker when it is being reversed, and let it run back when released
      const reversing = want !== 0 && this._steer * want < 0;
      const time = want === 0 ? 0.14 + 0.22 * fast : (0.17 + 0.42 * fast) / (reversing ? 2.5 : 1);
      const step = dt / time;
      this._steer += clamp(want - this._steer, -step, step);
      this._throttle += clamp((raw.throttle > 0.5 ? 1 : 0) - this._throttle, -dt / 0.08, dt / 0.12);
      this._brake += clamp((raw.brake > 0.5 ? 1 : 0) - this._brake, -dt / 0.08, dt / 0.1);
      // and a hand on the wheel that turns into a slide without being told (the slip beyond a couple of degrees)
      const help = slide - clamp(slide, -0.035, 0.035);
      out.steer = clamp((this._steer * limit - 0.6 * help) / lock, -1, 1);
    }
    out.throttle = this._throttle;
    out.brake = this._brake;
    out.handbrake = raw.handbrake ? 1 : 0;
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------

const lines = new WeakMap(); // track -> Float64Array: the racing line, as lateral offsets per sample

/**
 * The line: lateral offset per sample (m, + = left), inside ±half, such that the path bends as little and as evenly
 * as it can. Each point is moved, again and again, to where the path's curvature at it is the mean of its
 * neighbours', first with points far apart (which finds the shape of the lap: out, in to the apex, out), then with
 * the gaps filled in at half the spacing, down to every sample. (The scheme is Rémi Coulom's K1999.)
 */
function racingLine(track, half) {
  const n = track.count;
  const { px, pz, lx, lz } = track;
  const lat = new Float64Array(n);
  const x = (i) => px[i] + lx[i] * lat[i];
  const z = (i) => pz[i] + lz[i] * lat[i];
  /** Curvature of the circle through three points of the path (1/m, + = bending left). */
  const bend = (a, b, c) => {
    const ax = x(a), az = z(a), bx = x(b), bz = z(b), cx = x(c), cz = z(c);
    const cross = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
    const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
    return d > 1e-9 ? (2 * cross) / d : 0;
  };
  /** Move point i across the road until the path through a, i, b has the curvature asked for. */
  const adjust = (a, i, b, target) => {
    const ax = x(a), az = z(a);
    const dx = x(b) - ax, dz = z(b) - az;
    const across = lz[i] * dx - lx[i] * dz;
    if (Math.abs(across) < 1e-9) return;
    const straight = ((az - pz[i]) * dx - (ax - px[i]) * dz) / across; // where the chord a-b crosses this section
    lat[i] = straight + 0.1;
    const per = bend(a, i, b) / 0.1; // curvature gained per metre moved off the chord
    lat[i] = clamp(Math.abs(per) > 1e-9 ? straight + target / per : straight, -half, half);
  };
  for (let gap = 64; gap >= 1; gap >>= 1) {
    const m = Math.floor(n / gap);
    const at = (k) => Math.floor((((k % m) + m) % m) * (n / m));
    for (let pass = Math.round(60 * Math.sqrt(gap)); pass > 0; pass--) {
      for (let k = 0; k < m; k++) {
        const i = at(k), a = at(k - 1), b = at(k + 1);
        const before = bend(at(k - 2), a, i);
        const after = bend(i, b, at(k + 2));
        const la = Math.hypot(x(i) - x(a), z(i) - z(a));
        const lb = Math.hypot(x(b) - x(i), z(b) - z(i));
        adjust(a, i, b, (lb * before + la * after) / (la + lb));
      }
    }
    // fill in between the points just placed, on the curvature that runs from one to the next
    for (let k = 0; k < m; k++) {
      const a = at(k), b = at(k + 1);
      const span = (b - a + n) % n || n;
      const before = bend(at(k - 1), a, b);
      const after = bend(a, b, at(k + 2));
      for (let j = 1; j < span; j++) {
        const t = j / span;
        adjust(a, (a + j) % n, b, before + (after - before) * t);
      }
    }
  }
  return lat;
}

/** An autopilot. */
export class AutoDriver {
  /**
   * @param {object} track game/track.js (or a stand-in with the same per-sample arrays)
   * @param {object} [opts]
   * @param {number} [opts.pace] 0..1 of what the car can do (grip used goes with its square)
   * @param {number} [opts.bias] m to the left (+) or right (−) of the line it keeps, so that two can run side by side
   * @param {typeof CAR} [opts.params] the car it will be driving
   */
  constructor(track, { pace = 0.9, bias = 0, params = CAR } = {}) {
    this.track = track;
    this.pace = pace;
    this.bias = bias;
    this.params = params;
    const n = track.count;
    const half = track.halfWidth - params.box.halfWidth - 0.55; // keeps the body on the pavement with a little to spare
    let base = lines.get(track);
    if (!base) lines.set(track, (base = racingLine(track, half)));

    /** Where the path is, per sample: map position, and distance and speed along it. */
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.speed = new Float64Array(n); // m/s it means to be doing here
    this.accel = new Float64Array(n); // m/s² it means to be gaining here
    // a biased driver keeps to its own side: the line squeezed into the part of the road it is left with
    const room = clamp(Math.abs(bias) / half, 0, 0.8);
    for (let i = 0; i < n; i++) {
      this.lat[i] = base[i] * (1 - room) + Math.sign(bias) * room * half;
      this.x[i] = track.px[i] + track.lx[i] * this.lat[i];
      this.z[i] = track.pz[i] + track.lz[i] * this.lat[i];
    }
    this._profile();

    this._backing = 0; // s left of reversing out of trouble
    this._backSteer = 0;
  }

  /** How fast each metre can be taken. */
  _profile() {
    const { track, params: p } = this;
    const n = track.count;
    const grip2 = this.pace * this.pace;
    const lateral = 9.0 * grip2; // m/s² across
    const braking = 8.6 * grip2;
    const traction = 5.6 * grip2;
    const top = p.topSpeed * Math.min(1, 0.4 + 0.6 * this.pace) - 0.5;
    const power = 0.86 * 190000 * p.gearbox.efficiency * Math.min(1, grip2 + 0.1);
    const drag = (v) => (0.5 * p.aero.airDensity * p.aero.dragArea * v * v) / p.mass + 0.014 * G;
    const at = (i) => ((i % n) + n) % n;
    const bend = new Float64Array(n);
    const step = new Float64Array(n);
    const crest = new Float64Array(n);
    const grade = track.grade || new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // curvature of the path over a car's length each way, which is about what the car can follow
      const a = at(i - 3), b = at(i + 3);
      const ax = this.x[a], az = this.z[a], bx = this.x[i], bz = this.z[i], cx = this.x[b], cz = this.z[b];
      const cross = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
      const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
      bend[i] = d > 1e-9 ? Math.abs((2 * cross) / d) : 0;
      step[i] = Math.hypot(this.x[at(i + 1)] - bx, this.z[at(i + 1)] - bz);
      // over a crest the car is light: the road falls away at v² times this
      crest[i] = Math.max(0, -(grade[at(i + 4)] - grade[at(i - 4)]) / (8 * track.ds));
    }
    const v = this.speed;
    for (let i = 0; i < n; i++) {
      // the worst of the bend just here, so that a kink is seen coming
      const k = Math.max(bend[at(i - 2)], bend[i], bend[at(i + 2)]);
      const cornering = Math.sqrt(lateral / Math.max(1e-6, k + (lateral * crest[i]) / G));
      const light = crest[i] > 1e-6 ? Math.sqrt((0.45 * G) / crest[i]) : Infinity; // keep half the weight on the wheels
      v[i] = Math.min(top, cornering, light);
    }
    const share = (speed, k, most) => most * Math.sqrt(Math.max(0.08, 1 - ((speed * speed * k) / lateral) ** 2));
    // backwards: no faster here than can be shed before what comes next
    for (let i = 2 * n - 1; i >= 0; i--) {
      const here = at(i), next = at(i + 1);
      const slowing = share(v[next], bend[next], braking) + drag(v[next]) + G * grade[here];
      v[here] = Math.min(v[here], Math.sqrt(v[next] * v[next] + 2 * Math.max(1, slowing) * step[here]));
    }
    // forwards: no faster than the engine and the rear tyres can have made it since what came before
    for (let i = 0; i < 2 * n; i++) {
      const here = at(i), next = at(i + 1);
      const pull = Math.min(share(v[here], bend[here], traction), power / (p.mass * Math.max(v[here], 5))) - drag(v[here]) - G * grade[here];
      v[next] = Math.min(v[next], Math.sqrt(v[here] * v[here] + 2 * Math.max(0.3, pull) * step[here]));
    }
    for (let i = 0; i < n; i++) {
      const next = at(i + 1);
      this.accel[i] = (v[next] * v[next] - v[i] * v[i]) / (2 * step[i]);
    }
  }

  /**
   * @param {import('./vehicle/Vehicle.js').Vehicle} vehicle
   * @param {number} dt
   * @param {{steer:number, throttle:number, brake:number, handbrake:number}} out the car's controls
   */
  drive(vehicle, dt, out) {
    const track = this.track;
    const n = track.count;
    const p = vehicle.params;
    const speed = vehicle.speed;
    const sin = Math.sin(vehicle.yaw), cos = Math.cos(vehicle.yaw);
    const here = ((Math.floor(vehicle.s / track.ds) % n) + n) % n;
    out.handbrake = 0;

    // aim at the line a little way ahead: further when faster
    const reach = clamp(4.5 + 0.3 * Math.abs(speed), 6, 26);
    const f = (vehicle.s + reach) / track.ds;
    const a = ((Math.floor(f) % n) + n) % n, b = (a + 1) % n, t = f - Math.floor(f);
    const dx = this.x[a] + (this.x[b] - this.x[a]) * t - vehicle.position.x;
    const dz = this.z[a] + (this.z[b] - this.z[a]) * t - vehicle.position.z;
    const ahead = dx * sin + dz * cos;
    const left = dx * cos - dz * sin;
    const distance2 = Math.max(dx * dx + dz * dz, 1);
    // the arc through the car and the point, tangent to the car, and what this car needs at the wheels to follow it
    const ratio = speed / p.assists.esc.characteristicSpeed;
    let angle = Math.atan((p.wheelbase * 2 * left) / distance2) * (1 + ratio * ratio);
    if (ahead < 0) angle = left > 0 ? p.steering.lock : -p.steering.lock; // it is behind us: turn round
    let steer = clamp(-angle / p.steering.lock, -1, 1);

    // stuck against something, or pointing the wrong way with no room: back off with the wheel the other way
    if (this._backing > 0) {
      this._backing -= dt;
      out.steer = this._backSteer;
      out.throttle = 0;
      out.brake = speed > 0.5 ? 1 : 0.7; // the brake at a standstill is reverse
      return out;
    }
    if (vehicle.stuckTime > 1 || (ahead < 0 && Math.abs(speed) < 1 && vehicle.wrongWayTime > 2 && vehicle.scrape > 0)) {
      this._backing = 1.8;
      this._backSteer = -steer;
    }

    // the speed for where the car will be in a moment
    const soon = ((Math.floor((vehicle.s + speed * 0.12) / track.ds) % n) + n) % n;
    let target = this.speed[soon];
    const offLine = Math.abs(vehicle.lat - this.lat[here]);
    if (offLine > 1.5) target = Math.min(target, Math.max(12, target * (1 - 0.12 * (offLine - 1.5)))); // find the line again first
    if (ahead < 0) target = 5;
    const error = target - speed;
    const planned = this.accel[soon];
    let throttle = 0, brake = 0;
    if (error < -0.3 || planned < -1.5) {
      brake = clamp01(Math.max(0, -planned) / 10.5 + Math.max(0, -error) * 0.22);
      if (error > 1) brake = 0;
    }
    if (brake === 0) throttle = clamp01(error * 0.6 + (planned > 0.5 ? 0.5 : 0.12) + 0.004 * speed);
    // a car that is sliding is not helped by more of either
    const slide = Math.abs(bodySlip(vehicle));
    if (slide > 0.1) throttle *= clamp01(1 - (slide - 0.1) * 6);
    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    return out;
  }
}
