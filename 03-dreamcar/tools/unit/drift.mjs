// Sliding, measured: how the car answers the hands of each device, what it does when the tail is asked to step out,
// how a slide is held and let go, and what a sideways lap costs. Node only, deterministic. These are the rows of
// tools/handling.mjs's "Hands and drifting" section and the promises of tools/unit/drift.test.mjs.

import { PlayerDriver } from '../../src/game/drivers.js';
import { ASSISTS } from '../../src/game/config.js';
import { CAR } from '../../src/game/vehicle/params.js';
import { Vehicle } from '../../src/game/vehicle/Vehicle.js';
import { DT, G, HUMAN, cruise, fakeInput, hold, humanDriver, makeCar } from './manoeuvres.mjs';

const DEG = 180 / Math.PI;
const KMH = 3.6;
const controls = () => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
/** Body slip (degrees): + = the car moves to the left of where its nose points (it is turning right, tail out left). */
export const slipOf = (car) => (Math.abs(car.speed) > 1 ? Math.atan2(car.velocity.x * car._lx + car.velocity.z * car._lz, Math.abs(car.speed)) * DEG : 0);
/** The slide as the car reports it: where the rear axle is going against where the body points (degrees, + = tail out left). */
export const slideOf = (car) => car.slideAngle * DEG;
const yawRate = (car) => car.angularVelocity.y;

/** Puts a car into an assist level: an entry of ASSISTS.levels, or 'on' / 'off' for the bare switches. */
export function setLevel(car, level) {
  if (typeof level === 'object') car.setAssists(level);
  else {
    car.setAssists(null);
    car.assistsOn.esc = level !== 'off';
    car.assistsOn.tc = level !== 'off';
  }
}

/**
 * How the car answers a steering input, by device: 'keys' (a key held), 'pad' or 'thumb' (held `amount` of the way
 * over). The time (s) to 90 % of the yaw rate it settles at and the overshoot (%), the same for the sideways g
 * (which is what moves the car across the road), and the g it settles at. Speed held with the throttle.
 */
export function response(kind, kmh, amount = 0.5, params = CAR) {
  const input = fakeInput();
  const driver = new PlayerDriver(input, 'all');
  const car = makeCar(params);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const yaw = [], across = [];
  let px = car.velocity.x, pz = car.velocity.z;
  for (let i = 0; i < 4 * 120; i++) {
    if (kind === 'keys') Object.assign(input.state, { analog: false, steer: -1 });
    else Object.assign(input.state, { analog: true, steer: -amount, device: kind === 'thumb' ? 'touch' : 'pad' });
    driver.drive(car, DT, c);
    c.throttle = Math.max(0, Math.min(1, (speed - car.speed) * 0.6 + 0.012 * speed));
    car.step(DT, c);
    yaw.push(yawRate(car));
    const vx = car.velocity.x, vz = car.velocity.z;
    across.push((pz * vx - px * vz) / DT / Math.hypot(vx, vz) / G);
    px = vx;
    pz = vz;
  }
  const mean = (a) => a.slice(-60).reduce((x, y) => x + y, 0) / 60;
  const steady = mean(yaw), g = mean(across);
  const rise = (trace, level) => (trace.findIndex((x) => x >= 0.9 * level) + 1) * DT;
  return { rise: rise(yaw, steady), overshoot: (Math.max(...yaw) / steady - 1) * 100, riseG: rise(across, g), overshootG: (Math.max(...across) / g - 1) * 100, g };
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
  const out = { mostSlip: 0, spun: false, endKmh: 0, endSlip: 0, radiusAfter: 0, car };
  for (let i = 0; i < seconds * 120; i++) {
    action(c, i * DT, car);
    car.step(DT, c);
    const s = slipOf(car);
    if (Math.abs(s) > Math.abs(out.mostSlip)) out.mostSlip = s;
    if (Math.abs(s) > 90 || car.speed < -1) out.spun = true;
    if (i === 119) out.radiusAfter = car.speed / Math.max(1e-3, yawRate(car));
  }
  out.endKmh = car.speed * KMH;
  out.endSlip = slipOf(car);
  return out;
}

/** A handbrake pull of `pull` s at `kmh` in a gentle left-hand bend (0.4 g), then let go and drive on at half throttle. */
export function handbrakePull(kmh, pull = 0.4, { level = 'on', params = CAR } = {}) {
  const radius = (kmh / KMH) ** 2 / (0.4 * G);
  return inBend(kmh, radius, (c, t) => {
    c.handbrake = t < pull ? 1 : 0;
    c.throttle = t < pull ? 0 : 0.5;
  }, { level, params, seconds: 4 });
}

/**
 * A person's hands on a device in a bend on the level plane, open loop: the car is settled in a right-hand bend of
 * `radius` m at `kmh`; the slide is asked for (`start`: 'handbrake' 0.3 s of it, 'lift' 0.45 s off the throttle,
 * 'brake' a 0.4 s dab, 'power' the throttle floored) with the steering hard into the bend; then the throttle is
 * held and the steering kept into the bend (a key held, or tapped at 3 Hz for `duty` of the time; a stick or a
 * thumb held `amount` over) for `seconds`; then the steering is let go, the throttle still down.
 *
 * Returns the slide's angles over the hold (degrees: `mean`, `least`, `most`, from 1 s in), how long it took to
 * reach 12 degrees (`onset`, s from the start), the speeds in and out of the hold (km/h), how long the slide took to
 * close after the steering was let go (`close`: s to under 4 degrees), the most it swung the other way after that
 * (`snap`, degrees), whether it spun, the sideways g over the hold, and how hard the assists' lamps showed.
 */
export function holdSlide(device, level, { start = 'handbrake', kmh = 90, radius = 55, seconds = 4, duty = 1, amount = 1, params = CAR } = {}) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  setLevel(car, level);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  let steer = 0;
  hold(car, speed, 5, c, () => {
    steer += (speed / radius + yawRate(car)) * 0.3 * DT;
    c.steer = Math.max(0, Math.min(1, steer));
  });
  const analog = device !== 'keys';
  const kick = start === 'handbrake' ? 0.4 : start === 'power' ? 0 : 0.5;
  const out = { mean: 0, least: Infinity, most: 0, onset: NaN, kmhIn: 0, kmhOut: 0, close: NaN, snap: 0, spun: false, g: 0, lamps: 0, peak: 0, car };
  let sum = 0, count = 0, gSum = 0;
  let px = car.velocity.x, pz = car.velocity.z;
  const total = kick + seconds + 4;
  for (let i = 0; i < total * 120; i++) {
    const t = i * DT;
    const s = input.state;
    const holding = t >= kick && t < kick + seconds;
    const letGo = t >= kick + seconds;
    s.analog = analog;
    s.device = device === 'thumb' ? 'touch' : device === 'pad' ? 'pad' : undefined;
    s.steer = letGo ? 0 : holding && duty < 1 ? ((t * 3) % 1 < duty ? 1 : 0) : holding ? amount : 1;
    s.throttle = 1;
    s.brake = 0;
    s.handbrake = 0;
    if (t < kick) {
      if (start === 'handbrake') {
        s.handbrake = t > 0.1 ? 1 : 0;
        s.throttle = 0;
      } else if (start === 'lift') s.throttle = 0;
      else if (start === 'brake') {
        s.throttle = 0;
        s.brake = t < 0.4 ? (analog ? 0.7 : 1) : 0;
      }
    }
    driver.drive(car, DT, c);
    car.step(DT, c);
    const angle = slideOf(car);
    const vx = car.velocity.x, vz = car.velocity.z;
    const g = -(pz * vx - px * vz) / DT / Math.max(1, Math.hypot(vx, vz)) / G;
    px = vx;
    pz = vz;
    if (Number.isNaN(out.onset) && angle > 12) out.onset = t;
    if (Math.abs(angle) > 100 || car.speed < 0) out.spun = true;
    out.peak = Math.max(out.peak, angle);
    if (t >= kick && t < kick + 0.01) out.kmhIn = car.speed * KMH;
    if (holding && t >= kick + 1) {
      sum += angle;
      gSum += g;
      count++;
      out.least = Math.min(out.least, angle);
      out.most = Math.max(out.most, angle);
      out.lamps = Math.max(out.lamps, car.assists.tc, car.assists.esc);
    }
    if (holding) out.kmhOut = car.speed * KMH;
    if (letGo) {
      if (Number.isNaN(out.close) && angle < 4) out.close = t - kick - seconds;
      out.snap = Math.max(out.snap, -angle);
    }
  }
  out.mean = sum / Math.max(1, count);
  out.g = gSum / Math.max(1, count);
  return out;
}

/**
 * Laps of the real road by a person on a device (manoeuvres.humanDriver), who takes the bends of `drifts` sideways
 * ([{ id, start, lead }]; none: a tidy lap). The car is on `level`. Returns the best flying lap (s), the impacts
 * and the furthest the body went beyond the pavement on the flying laps, whether the car ever went round, and per
 * bend (on the last lap): the most angle (degrees), the mean angle and the seconds beyond 12 degrees, the slowest
 * and the exit speed (km/h), the most the car swung the other way within 3 s of the bend's end, the score.
 */
export function driftLaps(track, device, drifts, { level = ASSISTS.levels[ASSISTS.default], params = CAR, human = HUMAN, count = 1, trace = null } = {}) {
  const driver = humanDriver(track, device, params, human, drifts);
  const car = new Vehicle(track, params);
  car.setAssists(level);
  car.reset(track.grid(0, {}));
  const c = controls();
  const zones = {};
  for (const z of driver.zones) zones[z.id] = { most: 0, mean: 0, sideways: 0, slowest: Infinity, exitKmh: 0, snap: 0, score: 0, off: -Infinity, _sum: 0, _n: 0 };
  const times = [];
  let t = 0, started = 0, last = car.s, impacts = 0, off = -Infinity, spun = false, lamps = 0;
  while (times.length < count + 2 && t < 400 * (count + 2)) {
    driver.drive(car, DT, c);
    car.step(DT, c);
    t += DT;
    const flying = times.length >= 2;
    if (flying) {
      impacts += car.impacts.length;
      const over = Math.abs(car.lat) + car.params.box.halfWidth - track.halfWidth;
      if (over > off) off = over;
      if (car.wrongWayTime > 0.5 || Math.abs(car.slideAngle) > 1.75) spun = true;
      if (car.assists.esc > 0.1) lamps += DT;
      for (const z of driver.zones) {
        const r = zones[z.id];
        const inside = track.delta(z.s0, car.s) >= -z.lead && track.delta(car.s, z.s1) > 0;
        const after = track.delta(z.s1, car.s);
        const angle = slideOf(car) * -z.way; // + = the tail out the way this bend throws it
        if (inside) {
          r.most = Math.max(r.most, angle);
          if (angle > 12) r.sideways += DT;
          r._sum += Math.max(0, angle);
          r._n++;
          r.slowest = Math.min(r.slowest, car.speed * KMH);
          r.off = Math.max(r.off, over);
          r.score = Math.max(r.score, car.slide.score);
        } else if (after >= 0 && after < 150) {
          if (after < 3) r.exitKmh = car.speed * KMH;
          r.snap = Math.max(r.snap, -angle);
          r.off = Math.max(r.off, over);
        }
        if (trace && trace.id === z.id && track.delta(z.s0, car.s) >= -z.lead - 20 && after < 60 && Math.round(t * 120) % (trace.every || 12) === 0) {
          const s = driver.input.state;
          console.log(`s ${car.s.toFixed(0).padStart(4)} ${z.state.padEnd(6)} slide ${angle.toFixed(1).padStart(5)} lat ${car.lat.toFixed(1).padStart(5)} v ${(car.speed * KMH).toFixed(0).padStart(3)} g${car.gear} in ${(s.steer * z.way * -1).toFixed(2).padStart(5)} th ${c.throttle.toFixed(2)} br ${c.brake.toFixed(2)} hb ${c.handbrake} wheel ${(car.steerAngle * DEG * -z.way).toFixed(1).padStart(5)} M ${(car._driftM / car.params.inertia.y).toFixed(1).padStart(5)} stay ${car._stay.toFixed(2)} esc ${car.assists.esc.toFixed(2)} sc ${car.slide.score.toFixed(0)}`);
        }
      }
    }
    if (trace && trace.s0 != null && flying && car.s >= trace.s0 && car.s < trace.s1 && Math.round(t * 120) % (trace.every || 12) === 0) {
      const s = driver.input.state;
      console.log(`s ${car.s.toFixed(0).padStart(4)} slide ${slideOf(car).toFixed(1).padStart(5)} lat ${car.lat.toFixed(1).padStart(5)} v ${(car.speed * KMH).toFixed(0).padStart(3)} g${car.gear} in ${s.steer.toFixed(2).padStart(5)} th ${c.throttle.toFixed(2)} br ${c.brake.toFixed(2)} wheel ${(car.steerAngle * DEG).toFixed(1).padStart(5)} M ${(car._driftM / car.params.inertia.y).toFixed(1).padStart(5)} kick ${car._kick.toFixed(2)} stay ${car._stay.toFixed(2)} drift ${car.drift.toFixed(2)} esc ${car.assists.esc.toFixed(2)} tc ${car.assists.tc.toFixed(2)}${car.impacts.length ? ' IMPACT' : ''}`);
    }
    car.impacts.length = 0;
    if (car.s < last - track.length / 2) {
      times.push(t - started);
      started = t;
    }
    last = car.s;
  }
  for (const id in zones) {
    const r = zones[id];
    r.mean = r._sum / Math.max(1, r._n);
    delete r._sum;
    delete r._n;
  }
  const flying = times.slice(2);
  return { time: Math.min(...flying), times: flying, impacts, off, spun, lamps: lamps / Math.max(1, flying.length), zones };
}

/** The three bends the slides are promised in (pieces of the layout), each with a way of throwing the car in. */
export const BENDS = [
  { id: 'sweep', start: 'brake', lead: 0 },
  { id: 'carousel', start: 'handbrake', lead: 0 },
  { id: 'back', start: 'lift', lead: 0 },
];
