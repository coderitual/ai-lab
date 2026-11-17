// Sliding, measured: how the car answers the hands of each device, what it does when the tail is asked to step out,
// and how far sideways a driver can hold it. Node only, on an endless level plane, deterministic. These are the
// rows of tools/handling.mjs's "Drifting" section and the promises of tools/unit/vehicle.test.mjs.

import { PlayerDriver } from '../../src/game/drivers.js';
import { ASSISTS } from '../../src/game/config.js';
import { CAR } from '../../src/game/vehicle/params.js';
import { Vehicle } from '../../src/game/vehicle/Vehicle.js';
import { DT, G, cruise, fakeInput, hold, lapDriver, makeCar } from './manoeuvres.mjs';

/** A device's lap driver with the level's hands. */
function lapDriverFor(track, kind, params, level) {
  const d = lapDriver(track, kind, 1, 0, params);
  if (d.player) d.player.level = level;
  return d;
}

const DEG = 180 / Math.PI;
const KMH = 3.6;
const controls = () => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
/** Body slip (degrees): + = the car moves to the left of where its nose points (it is turning right, tail out left). */
export const slipOf = (car) => (Math.abs(car.speed) > 1 ? Math.atan2(car.velocity.x * car._lx + car.velocity.z * car._lz, Math.abs(car.speed)) * DEG : 0);
const yawRate = (car) => car.angularVelocity.y;

/** Puts a car into an assist level: an entry of ASSISTS.levels, or 'on' / 'off' for the old switches. */
export function setLevel(car, level) {
  if (typeof level === 'object') car.setAssists(level);
  else {
    car.setAssists(null);
    car.assistsOn.esc = level !== 'off';
    car.assistsOn.tc = level !== 'off';
  }
}

/**
 * The time (s) from a steering input to 90 % of the yaw rate it settles at, by device: 'keys' (a key held), 'pad'
 * (a stick held half way) or 'thumb' (a touch stick held half way). Speed held with the throttle.
 */
export function response(kind, kmh, params = CAR) {
  const input = fakeInput();
  const driver = new PlayerDriver(input, 'all');
  const car = makeCar(params);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const trace = [];
  for (let i = 0; i < 4 * 120; i++) {
    if (kind === 'keys') Object.assign(input.state, { analog: false, steer: -1 });
    else Object.assign(input.state, { analog: true, steer: -0.5, touch: kind === 'thumb' });
    driver.drive(car, DT, c);
    c.throttle = Math.max(0, Math.min(1, (speed - car.speed) * 0.6 + 0.012 * speed));
    car.step(DT, c);
    trace.push(yawRate(car));
  }
  const steady = trace.slice(-60).reduce((a, b) => a + b, 0) / 60;
  const rise = (trace.findIndex((r) => r >= 0.9 * steady) + 1) * DT;
  const peak = Math.max(...trace);
  return { rise, g: (steady * speed) / G, overshoot: (peak / steady - 1) * 100 };
}

/** Settles the car in a left-hand bend of radius R at kmh (steering trimmed), then runs `action` for `seconds`. */
export function inBend(kmh, radius, action, { params = CAR, level = 'on', seconds = 3 } = {}) {
  const car = makeCar(params);
  setLevel(car, level);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const wanted = speed / radius;
  let steer = 0;
  hold(car, speed, 6, c, () => {
    steer += (wanted - yawRate(car)) * 0.3 * DT;
    c.steer = -Math.max(0, Math.min(1, steer));
  });
  const out = { mostSlip: 0, spun: false, endKmh: 0, endSlip: 0, radiusAfter: 0 };
  for (let i = 0; i < seconds * 120; i++) {
    action(c, i * DT, car);
    car.step(DT, c);
    const s = slipOf(car);
    if (Math.abs(s) > Math.abs(out.mostSlip)) out.mostSlip = s;
    if (Math.abs(s) > 90) out.spun = true;
    if (i === 119) out.radiusAfter = car.speed / Math.max(1e-3, yawRate(car));
  }
  out.endKmh = car.speed * KMH;
  out.endSlip = slipOf(car);
  return out;
}

/**
 * A driver who wants the car sideways: on a level plane, from `kmh` in a left-hand turn, the tail is kicked out by
 * `start` ('handbrake' a dab of it, 'power' full throttle in a low gear, 'lift' a lift at turn-in, 'brake' a brake
 * dab at turn-in), then the slide is held at `target` degrees with the throttle and opposite lock (ideal hands on an
 * analog path straight to the car), then at `release` s the driver eases off and straightens.
 * Returns how long the slip stayed within 8 degrees of the target, the most slip, whether it spun, and how the exit
 * went (the most slip the other way after release: a snap).
 */
export function driftHold(target, { level = 'on', start = 'handbrake', kmh = 70, hold: seconds = 4, params = CAR, hands = null, device = null } = {}) {
  const car = makeCar(params);
  setLevel(car, level);
  const c = cruise(car, kmh / KMH);
  if (device && !hands) hands = humanHands(device, Math.abs(target), typeof level === 'object' ? level : null);
  const want = -Math.abs(target); // a left-hand slide: the car moves to the right of its nose
  let held = 0, best = 0, run = 0, most = 0, spun = false, snap = 0, sliding = false, endKmh = 0, straightIn = NaN, lastBeta = 0;
  const speed0 = kmh / KMH;
  const total = 1.2 + seconds + 3;
  for (let i = 0; i < total * 120; i++) {
    const t = i * DT;
    const beta = slipOf(car);
    if (t < 1.2 || !sliding) {
      // turn in hard to the left, and kick the tail out the chosen way
      c.steer = start === 'power' ? -0.4 : -1;
      c.handbrake = start === 'handbrake' && t > 0.3 && t < 0.6 ? 1 : 0;
      c.throttle = start === 'lift' || start === 'brake' ? (t < 0.3 ? 1 : 0) : 1;
      c.brake = start === 'brake' && t > 0.3 && t < 0.7 ? 0.7 : 0;
      if (Math.abs(beta) > Math.min(12, Math.abs(target) * 0.6) && t > 0.3) sliding = true;
      if (t > 3) break;
    } else if (t < 1.2 + seconds) {
      c.handbrake = 0;
      c.brake = 0;
      if (hands) hands(c, car, want);
      // (the hands' own steering and throttle; the handbrake and the brake are off)
      else {
        // throttle opens the slide, opposite lock closes it: front wheels along the path, and more of them when
        // the slide is past what is wanted
        const e = (beta - want) / DEG; // > 0: not sideways enough (want is negative)
        const rate = (beta - lastBeta) / DEG / DT; // how fast the slide grows (rad/s; < 0: opening)
        c.throttle = Math.max(0, Math.min(1, GAINS.t0 + GAINS.te * e + GAINS.tv * (speed0 - car.speed)));
        const delta = beta / DEG - GAINS.se * e + GAINS.sr * rate; // wheel angle, + = left
        c.steer = Math.max(-1, Math.min(1, -delta / car.params.steering.lock));
      }
    } else {
      // ease off and straighten
      c.throttle = 0.3;
      c.steer = 0;
      c.handbrake = 0;
      if (Number.isNaN(straightIn) && Math.abs(beta) < 3) straightIn = t - 1.2 - seconds;
      if (beta > snap) snap = beta;
    }
    lastBeta = beta;
    car.step(DT, c);
    const b = slipOf(car);
    most = Math.max(most, Math.abs(b));
    if (Math.abs(b) > 100) spun = true;
    if (sliding && t < 1.2 + seconds) {
      if (Math.abs(b - want) < 8) {
        run += DT;
        held += DT;
        best = Math.max(best, run);
      } else run = 0;
    }
    endKmh = car.speed * KMH;
    if (globalThis.DRIFT_TRACE && i % 12 === 0) console.log(t.toFixed(2), 'b', b.toFixed(1), 'v', (car.speed * KMH).toFixed(0), 'g', car.gear, 'rpm', car.rpm.toFixed(0), 'thr', c.throttle.toFixed(2), 'st', c.steer.toFixed(2), 'r', car.angularVelocity.y.toFixed(2), 'rear', car.wheels[2].omega.toFixed(1), car.wheels[3].omega.toFixed(1));
  }
  return { held, best, most, spun, snap, straightIn, endKmh, sliding };
}

/**
 * A person holding a slide through a device ('keys', 'pad', 'thumb'), through PlayerDriver and the level's help: the
 * throttle held (keys: the key down; a stick or a thumb: most of the way, more when the slide wants opening), the
 * steering into the bend while the slide is smaller than wanted, let go when it is about right, and opposite lock
 * when it is too big. Keys are pressed or not and no key changes faster than a hand can (0.12 s); a stick is moved
 * no faster than 4 of its widths a second.
 */
export function humanHands(device, target, level) {
  const input = fakeInput();
  const player = new PlayerDriver(input);
  if (level) player.level = level;
  const scratch = controls();
  let key = 0, held = 0, stick = 0;
  return (c, car) => {
    const size = Math.abs(slipOf(car));
    const err = (target - size) / 12; // > 0: wants more slide
    held += DT;
    if (device === 'keys') {
      const want = err > 0.25 ? -1 : err < -0.6 ? 1 : 0; // left (into a left-hand slide), none, or opposite
      if (want !== key && held >= 0.12) {
        key = want;
        held = 0;
      }
      Object.assign(input.state, { analog: false, steer: key, throttle: 1, brake: 0, handbrake: 0 });
    } else {
      const wanted = Math.max(-1, Math.min(1, -0.6 * err)); // - = left
      stick += Math.max(-4 * DT, Math.min(4 * DT, wanted - stick));
      const throttle = Math.max(0.5, Math.min(1, 0.85 + 0.4 * err));
      Object.assign(input.state, { analog: true, device: device === 'thumb' ? 'touch' : 'pad', steer: stick, throttle, brake: 0, handbrake: 0 });
    }
    player.drive(car, DT, scratch);
    c.steer = scratch.steer;
    c.throttle = scratch.throttle;
  };
}

/** The ideal drifting hands' gains (throttle base, per rad of slip error, per m/s of speed; steering per rad, per rad/s). */
export const GAINS = { t0: 0.5, te: 2.5, tv: 0.08, se: 0.9, sr: 0.15 };

/** The largest slide (degrees, in steps of 5) a driver can hold for two seconds without spinning. */
export function largestHeld(level, opts = {}) {
  let largest = 0;
  for (let target = 10; target <= 60; target += 5) {
    const r = driftHold(target, { ...opts, level });
    if (!r.spun && r.best >= 2) largest = target;
  }
  return largest;
}

/** Full power at full lock from `kmh` in a low gear: the most slip, and whether it spun. */
export function powerAtLock(kmh = 50, { level = 'on', params = CAR, seconds = 3 } = {}) {
  const car = makeCar(params);
  setLevel(car, level);
  const c = cruise(car, kmh / KMH);
  let most = 0, spun = false;
  for (let i = 0; i < seconds * 120; i++) {
    c.steer = -1;
    c.throttle = 1;
    car.step(DT, c);
    const s = Math.abs(slipOf(car));
    most = Math.max(most, s);
    if (s > 90) spun = true;
  }
  return { most, spun, gear: car.gear, kmh: car.speed * KMH };
}

/** A handbrake pull of `pull` s at `kmh` in a gentle left-hand bend (0.4 g), then let go and drive on. */
export function handbrakePull(kmh, pull = 0.4, { level = 'on', params = CAR } = {}) {
  const radius = (kmh / KMH) ** 2 / (0.4 * G);
  return inBend(kmh, radius, (c, t) => {
    c.handbrake = t < pull ? 1 : 0;
    c.throttle = t < pull ? 0 : 0.5;
  }, { level, params, seconds: 4 });
}

/**
 * A lap of the real road by a device's driver (manoeuvres.lapDriver: 'keys', 'thumb', 'pad') who throws the car
 * sideways into one piece of the layout (a bend): a dab of handbrake (0.35 s) just before it, the throttle held through it. Returns, for
 * that stretch, the most slip, how long the car was more than 12 degrees sideways, and the lap's impacts and how far
 * off the pavement the body went.
 */
export function trackDrift(track, kind, pieceId, { level = ASSISTS.levels[ASSISTS.default], params = CAR, kick = 'handbrake' } = {}) {
  const driver = lapDriverFor(track, kind, params, level);
  const car = new Vehicle(track, params);
  car.setAssists(level);
  car.reset(track.grid(0, {}));
  const sec = { s0: track.at(pieceId, 0), s1: track.at(pieceId, 1) };
  const c = controls();
  let t = 0, laps = 0, last = car.s, most = 0, sideways = 0, impacts = 0, off = -Infinity, kicked = -1, inside = false, slowest = Infinity;
  while (laps < 2 && t < 600) {
    driver.drive(car, DT, c);
    const s = car.s;
    const before = track.delta(s, sec.s0);
    inside = track.delta(sec.s0, s) >= 0 && track.delta(s, sec.s1) > 0;
    if (laps === 1) {
      if (before > 0 && before < 25 && kicked < 0) kicked = t;
      if (kicked >= 0 && t - kicked < 0.35) {
        if (kick === 'handbrake') c.handbrake = 1;
        else c.brake = 0.6;
        c.throttle = 0;
      }
      if (inside && kicked >= 0 && t - kicked >= 0.35) c.throttle = Math.max(c.throttle, c.brake > 0.2 ? 0 : 0.85);
    }
    car.step(DT, c);
    t += DT;
    if (car.s < last - track.length / 2) laps++;
    last = car.s;
    impacts += car.impacts.length;
    car.impacts.length = 0;
    if (laps >= 1) off = Math.max(off, Math.abs(car.lat) + car.params.box.halfWidth - track.halfWidth);
    if (globalThis.DRIFT_TRACE && laps === 1 && track.delta(s, sec.s0) < 60 && track.delta(sec.s1, s) < 80 && Math.round(t * 120) % 12 === 0) {
      console.log(`s ${s.toFixed(0)} b ${slipOf(car).toFixed(1)} lat ${car.lat.toFixed(1)} v ${(car.speed * KMH).toFixed(0)} st ${c.steer.toFixed(2)} th ${c.throttle.toFixed(2)} hb ${c.handbrake} drift ${car.drift.toFixed(2)} M ${(car._driftM / car.params.inertia.y).toFixed(1)}`);
    }
    if (laps === 1 && inside) {
      const b = Math.abs(slipOf(car));
      most = Math.max(most, b);
      if (b > 12) sideways += DT;
      slowest = Math.min(slowest, car.speed * KMH);
    }
  }
  return { most, sideways, impacts, off, slowest };
}

/**
 * A flying lap by a device's driver (lapDriver kinds) who throws the car sideways into each of `pieces` with a dab
 * of handbrake and holds the throttle through it: the lap time (from line to line), the impacts, the most slip and
 * the seconds spent more than 12 degrees sideways. Compare with a tidy lap (manoeuvres.laps) for the cost of sliding.
 */
export function trackDriftLap(track, kind, pieces, { level = ASSISTS.levels[ASSISTS.default], params = CAR } = {}) {
  const driver = lapDriverFor(track, kind, params, level);
  const car = new Vehicle(track, params);
  car.setAssists(level);
  car.reset(track.grid(0, {}));
  const zones = pieces.map((id) => ({ s0: track.at(id, 0), s1: track.at(id, 1), kicked: -1 }));
  const c = controls();
  let t = 0, laps = 0, last = car.s, started = 0, time = NaN, impacts = 0, most = 0, sideways = 0;
  while (laps < 3 && t < 900) {
    driver.drive(car, DT, c);
    if (laps === 2) {
      for (const z of zones) {
        const before = track.delta(car.s, z.s0);
        if (before > 0 && before < 25 && z.kicked < 0) z.kicked = t;
        if (z.kicked >= 0 && t - z.kicked < 0.35) {
          c.handbrake = 1;
          c.throttle = 0;
        }
        const inside = track.delta(z.s0, car.s) >= 0 && track.delta(car.s, z.s1) > 0;
        if (inside && z.kicked >= 0 && t - z.kicked >= 0.35) c.throttle = Math.max(c.throttle, c.brake > 0.2 ? 0 : 0.85);
      }
    }
    car.step(DT, c);
    t += DT;
    if (car.s < last - track.length / 2) {
      laps++;
      if (laps === 2) started = t;
      if (laps === 3) time = t - started;
    }
    last = car.s;
    if (laps === 2) {
      impacts += car.impacts.length;
      const b = Math.abs(slipOf(car));
      most = Math.max(most, b);
      if (b > 12) sideways += DT;
    }
    car.impacts.length = 0;
  }
  return { time, impacts, most, sideways };
}
