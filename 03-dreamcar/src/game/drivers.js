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

import { ASSISTS } from './config.js';
import { CAR } from './vehicle/params.js';

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Lateral acceleration (m/s²) a full steering input may ask for, by the path alone. */
const STEER_GRIP = 12.3;
/**
 * What full lock adds to the angle the path needs (rad at the road wheels), at low and at high speed: the front
 * tyres' slip angle and the car's understeer at the limit. With it a full input puts the car at the peak of its
 * cornering (about 1.25 g on dry asphalt, measured in tools/handling.mjs) and not past it, where the front axle
 * has no more to give, the yaw is barely damped at speed and the car only plods wider.
 */
const STEER_SLIP_SLOW = 0.08;
const STEER_SLIP_FAST = 0.058;
/** Analog steering: extra power of the curve at speed, and the time (s) it is smoothed over at speed. */
const ANALOG_EXPO = 0.6;
/** The analog input (-1..1) that asks for `share` (-1..1) of the lock allowed at this speed: the inverse of the curve. */
export function analogFor(vehicle, share) {
  const fast = clamp01(Math.abs(vehicle.speed) / 60);
  return Math.sign(share) * Math.abs(share) ** (1 / (1 + ANALOG_EXPO * fast));
}
const ANALOG_SMOOTH = 0;
/** Slip angle of the rear axle (rad) inside which the car is cornering, not sliding: about the rear tyres' peak. */
const REAR_SLIDE = 0.075;

/** The most steering (rad at the road wheels) worth having at the car's present speed. */
export function steerLimit(vehicle) {
  const p = vehicle.params;
  const speed = Math.abs(vehicle.speed);
  const fast = clamp01((speed - 8) / 42);
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

/**
 * How far the rear axle is sliding (rad, + = it is moving to the left), beyond the slip angle the rear tyres work at
 * in a bend: zero while the car corners, however hard, and the size of the slide once the tail steps out.
 */
function rearSlide(vehicle) {
  if (vehicle.speed < 3) return 0;
  const v = vehicle.velocity;
  const sin = Math.sin(vehicle.yaw), cos = Math.cos(vehicle.yaw);
  const forward = v.x * sin + v.z * cos;
  const across = v.x * cos - v.z * sin - vehicle.angularVelocity.y * (vehicle.params.wheelbase / 2 - vehicle.params.com.z);
  const angle = Math.atan2(across, forward);
  return angle - clamp(angle, -REAR_SLIDE, REAR_SLIDE);
}

/**
 * The driver's steering (rad, + = left) with the opposite lock the help gives: added to steering into the bend (it
 * lessens it), but no more than the larger of the two when the driver is already countering (it never doubles it).
 */
function withCatch(angle, help, roomLeft, roomRight) {
  const out = angle * help > 0 ? (Math.abs(help) > Math.abs(angle) ? help : angle) : angle + help;
  return clamp(out, -roomRight, roomLeft);
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
    /** The assist level (ASSISTS.levels): how much opposite lock the hands are given, per device. */
    this.level = ASSISTS.levels[ASSISTS.default];
    /** The device the last input came from: 'keys', 'pad' or 'thumb'. */
    this.device = 'keys';
    this.scheme = scheme;
    this.zone = zone;
    this._raw = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false };
    this._steer = 0; // -1..1 of the lock allowed at this speed, as the keys have wound it
    this._wheel = 0; // the same after the hands' lag
    this._throttle = 0;
    this._brake = 0;
    this._hand = 0; // 0..1 how much the handbrake keeps the hands from catching the slide it makes
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
    const base = steerLimit(vehicle);
    // a car whose tail is out needs lock to catch it, however fast it is going: the room beyond the speed's lock is
    // given only the way that catches it (+ = to the left), never further into the slide
    const slide = rearSlide(vehicle);
    const roomLeft = Math.min(lock, base + Math.max(0, slide));
    const roomRight = Math.min(lock, base + Math.max(0, -slide));
    const want = clamp(+raw.steer || 0, -1, 1);
    const handbrake = raw.handbrake ? 1 : 0;
    // which hands these are: Input says 'touch' for a thumb on the glass and 'pad' for a stick; a stand-in that only
    // says analog is a pad
    this.device = raw.analog ? (raw.device === 'touch' ? 'thumb' : 'pad') : 'keys';
    // the opposite lock given for the driver while the tail is out: it turns the front wheels towards where the car
    // is going, so that letting go of the steering catches a slide
    const help = this.level?.catch?.[this.device] ?? 0;
    // while the handbrake is pulled the hands let the tail come round; they are back on the wheel a moment after
    this._hand = handbrake ? 1 : Math.max(0, this._hand - dt / 0.25);
    let angle; // rad at the road wheels, + = left
    if (raw.analog) {
      // a stick or a thumb: finer near the centre the faster the car goes (the same travel asks for less of the
      // lock), and smoothed a little at speed, so that a hand's shake and its lag do not set the car weaving
      const fine = Math.sign(want) * Math.abs(want) ** (1 + ANALOG_EXPO * fast);
      this._steer += (fine - this._steer) * (1 - Math.exp(-dt / (ANALOG_SMOOTH * fast + 1e-3)));
      this._wheel = this._steer;
      const shaped = this._steer;
      this._throttle = clamp01(+raw.throttle || 0);
      this._brake = clamp01(+raw.brake || 0);
      angle = -shaped * (shaped < 0 ? roomLeft : roomRight);
      angle = withCatch(angle, help * slide * (1 - this._hand), roomLeft, roomRight);
    } else {
      // a key: wind the wheel on, quicker when it is being reversed, and let it run back when released
      const reversing = want !== 0 && this._steer * want < 0;
      const time = want === 0 ? 0.13 + 0.17 * fast : (0.2 + 0.36 * fast) / (reversing ? 2.5 : 1);
      const step = dt / time;
      this._steer += clamp(want - this._steer, -step, step);
      // and the hands follow the key with a little lag, which rounds the start and the end of the ramp
      this._wheel += (this._steer - this._wheel) * (1 - Math.exp(-dt / 0.05));
      this._throttle += clamp((raw.throttle > 0.5 ? 1 : 0) - this._throttle, -dt / 0.08, dt / 0.12);
      this._brake += clamp((raw.brake > 0.5 ? 1 : 0) - this._brake, -dt / 0.08, dt / 0.1);
      angle = -this._wheel * (this._wheel < 0 ? roomLeft : roomRight);
      // and a hand on the wheel that turns into a slide without being told
      angle = withCatch(angle, help * slide * (1 - this._hand), roomLeft, roomRight);
    }
    out.steer = clamp(-angle / lock, -1, 1);
    out.throttle = this._throttle;
    out.brake = this._brake;
    out.handbrake = handbrake;
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

/** What the autopilot takes the car to have at full pace (m/s²): across, braking, and drive from the rear tyres. */
const LATERAL = 11.2;
const BRAKING = 11;
const TRACTION = 7.5;
/** Samples ahead over which a crest's speed is already kept. */
const CREST_AHEAD = 50;
/** How much of the banking's help the autopilot counts on. */
const BANK_CREDIT = 0.5;

/** The engine's most power (W), from its torque curve. */
function peakPower(p) {
  const t = p.engine.torque;
  let most = 0;
  for (let i = 0; i < t.length; i += 2) most = Math.max(most, (t[i + 1] * t[i] * Math.PI) / 30);
  return most;
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
    const lateral = LATERAL * grip2; // m/s² across, on the level and with no help from the air
    const braking = BRAKING * grip2;
    const traction = TRACTION * grip2;
    const top = p.topSpeed * Math.min(1, 0.4 + 0.6 * this.pace) - 0.5;
    const power = 0.86 * peakPower(p) * p.gearbox.efficiency * Math.min(1, grip2 + 0.1);
    // the air presses the car down: grip grows with the square of the speed by this much per (m/s)²
    const aero = (0.5 * p.aero.airDensity * (p.aero.downforceArea ?? 0)) / (p.mass * G);
    const banking = track.bank || new Float64Array(n);
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
      // a bend banked into by b allows v² k = (a + g tan b) / (1 - (a / g) tan b), a growing with the downforce
      // (counted at BANK_CREDIT of its worth: the tyres lose grip as the banking loads them, and the line is not
      // the centre line the banking was laid on)
      const into = BANK_CREDIT * Math.tan(-Math.sign(track.curvature[i]) * banking[i]);
      let cornering = Math.sqrt(lateral / Math.max(1e-6, k + (lateral * crest[i]) / G));
      for (let it = 0; it < 3; it++) {
        const a = lateral * (1 + aero * cornering * cornering);
        const reach = (a + G * into) / Math.max(0.3, 1 - (a / G) * into);
        cornering = Math.sqrt(reach / Math.max(1e-6, k + (a * crest[i]) / G));
      }
      v[i] = Math.min(top, cornering);
    }
    // over a crest keep about half the weight on the wheels, and be at that speed before it begins: braking on a
    // crest unloads the rear tyres just when they are lightest
    for (let i = 0; i < n; i++) {
      let light = Infinity;
      for (let j = 0; j <= CREST_AHEAD; j++) {
        const c = crest[at(i + j)];
        if (c > 1e-6) light = Math.min(light, Math.sqrt((0.45 * G) / c));
      }
      v[i] = Math.min(v[i], light);
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
