// Scripted manoeuvres for one car on a stand-in road, each returning what a road tester would write down.
//
// Used twice: tools/handling.mjs prints the results as the table quoted in docs/spec.md, and
// tools/unit/vehicle.test.mjs asserts the targets of the build contract on the same numbers. Everything is stepped
// with the game's fixed step and driven through Vehicle.step's public controls; the only liberties taken are giving
// the body a velocity to start a manoeuvre at speed or to kick the springs.

import { AutoDriver, PlayerDriver } from '../../src/game/drivers.js';
import { Vehicle } from '../../src/game/vehicle/Vehicle.js';
import { CAR } from '../../src/game/vehicle/params.js';
import { EDGE, createPlane } from './flatTrack.mjs';

export const DT = 1 / 120;
export const G = 9.81;
const DEG = 180 / Math.PI;
const KMH = 3.6;

/** A car standing on an endless level plane. */
export function makeCar(params = CAR, plane = createPlane()) {
  const car = new Vehicle(plane, params);
  car.reset({ x: 0, y: 0, z: 0, yaw: 0 });
  return car;
}

/** A copy of the car's numbers with some of them changed by `edit(copy)`. */
export function tuned(edit) {
  const copy = structuredClone(CAR);
  edit(copy);
  return copy;
}

const controls = () => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
const roll = (car) => Math.asin(Math.max(-1, Math.min(1, car._ly))) * DEG; // + = left side up (leaning right)
const pitch = (car) => Math.asin(Math.max(-1, Math.min(1, car._fy))) * DEG; // + = nose up
const bodySlip = (car) => (Math.abs(car.speed) > 1 ? Math.atan2(car.velocity.x * car._lx + car.velocity.z * car._lz, Math.abs(car.speed)) * DEG : 0);
const yawRate = (car) => car.angularVelocity.y;

/** Bring the car to `speed` (m/s) in a straight line and let it settle there under its own power. */
export function cruise(car, speed, c = controls()) {
  car.reset({ x: 0, y: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 120 * 90 && car.speed < speed; i++) {
    c.throttle = 1;
    car.step(DT, c);
  }
  hold(car, speed, 1.5, c);
  return c;
}

/** Hold a speed for a while with the throttle (and the steering as it is). */
export function hold(car, speed, seconds, c, each) {
  for (let i = 0; i < seconds * 120; i++) {
    c.throttle = Math.max(0, Math.min(1, (speed - car.speed) * 0.6 + 0.012 * speed));
    c.brake = 0;
    car.step(DT, c);
    if (each) each(i * DT);
  }
}

/** Standing: where the body comes to rest and how much it still moves two seconds later. */
export function rest(params) {
  const car = makeCar(params);
  const c = controls();
  for (let i = 0; i < 240; i++) car.step(DT, c);
  const before = car.position.clone();
  let most = 0;
  for (let i = 0; i < 360; i++) {
    car.step(DT, c);
    most = Math.max(most, car.velocity.length(), car.angularVelocity.length());
  }
  return {
    rideHeight: car.position.y, // the model's root above the road: 0 when the car sits at its design height
    travel: car.wheels.map((w) => w.travel),
    loads: car.wheels.map((w) => w.load),
    residualSpeed: most,
    drift: car.position.distanceTo(before),
  };
}

/** Standing start, flat out. */
export function acceleration(params) {
  const car = makeCar(params);
  const c = controls();
  c.throttle = 1;
  const out = { t100: 0, t200: 0, t400m: 0, v400m: 0, launchG: 0, squat: 0, shifts: [] };
  let gear = car.gear;
  for (let i = 1; i <= 120 * 60; i++) {
    const before = car.speed;
    car.step(DT, c);
    const t = i * DT;
    if (t < 2) out.launchG = Math.max(out.launchG, (car.speed - before) / DT / G);
    if (t > 0.5 && t < 3) out.squat = Math.max(out.squat, pitch(car));
    if (car.gear !== gear) {
      out.shifts.push({ to: car.gear, kmh: car.speed * KMH, t });
      gear = car.gear;
    }
    if (!out.t100 && car.speed * KMH >= 100) out.t100 = t;
    if (!out.t200 && car.speed * KMH >= 200) out.t200 = t;
    if (!out.t400m && car.position.z >= 400) {
      out.t400m = t;
      out.v400m = car.speed * KMH;
    }
    if (out.t200 && out.t400m) break;
  }
  return out;
}

/** Flat out for long enough: the speed it settles at, and in which gear. */
export function topSpeed(params) {
  const car = makeCar(params);
  const c = controls();
  c.throttle = 1;
  for (let i = 0; i < 120 * 100; i++) car.step(DT, c);
  let least = Infinity, most = 0;
  for (let i = 0; i < 120 * 10; i++) {
    car.step(DT, c);
    least = Math.min(least, car.speed);
    most = Math.max(most, car.speed);
  }
  return { kmh: ((least + most) / 2) * KMH, ripple: (most - least) * KMH, gear: car.gear, rpm: car.rpm, drift: Math.abs(car.position.x) };
}

/** Full braking from a speed (km/h) to a stop. */
export function braking(fromKmh, params, { abs = true } = {}) {
  const car = makeCar(params);
  car.assistsOn.abs = abs;
  const c = cruise(car, fromKmh / KMH + 1.5);
  c.throttle = 0;
  while (car.speed > fromKmh / KMH) car.step(DT, c); // coast down to the mark
  c.brake = 1;
  const z0 = car.position.z;
  const out = { distance: 0, time: 0, meanG: 0, peakG: 0, dive: 0, divePerG: 0, absWork: 0, drift: 0, yaw: 0 };
  const v0 = car.speed;
  let steps = 0, pitchSum = 0, gSum = 0;
  while (car.speed > 0.05 && steps < 120 * 30) {
    const before = car.speed;
    car.step(DT, c);
    steps++;
    const g = (before - car.speed) / DT / G;
    out.peakG = Math.max(out.peakG, g);
    out.dive = Math.max(out.dive, -pitch(car));
    if (steps > 60 && car.speed > 5) { // once the nose has gone down and before the stop
      pitchSum -= pitch(car);
      gSum += g;
    }
    out.absWork = Math.max(out.absWork, car.assists.abs);
    // the brake pedal held at a standstill selects reverse: stop measuring before that
    if (car.speed < 0.3) c.brake = 0;
  }
  out.distance = car.position.z - z0;
  out.time = steps * DT;
  out.meanG = (v0 * v0) / (2 * out.distance) / G;
  out.divePerG = pitchSum / gSum;
  out.drift = Math.abs(car.position.x);
  out.yaw = Math.abs(car.yaw) * DEG;
  return out;
}

/**
 * Round a circle of the given radius, anticlockwise, slowly faster, a steering controller holding the radius, until
 * the car can no longer stay on it: the most lateral acceleration it held, and on the way the steering and the roll
 * it took per g.
 */
export function skidpad(radius, params, { esc = true } = {}) {
  const car = makeCar(params);
  car.assistsOn.esc = esc;
  car.reset({ x: -radius, y: 0, z: 0, yaw: 0 });
  const c = controls();
  const lock = car.params.steering.lock;
  const out = { maxG: 0, speedAtMax: 0, understeer: 0, rollPerG: 0, slipAtLimit: 0, steerAtLimit: 0, ended: 'time' };
  const samples = [];
  let target = 4, integral = 0, held = 0, window = 0, count = 0, steerSum = 0, rollSum = 0;
  for (let i = 0; i < 120 * 240; i++) {
    const x = car.position.x, z = car.position.z;
    const distance = Math.hypot(x, z);
    const error = distance - radius; // + = running wide
    const outward = (car.velocity.x * x + car.velocity.z * z) / distance;
    integral = Math.max(-0.4, Math.min(0.4, integral + error * 0.06 * DT));
    const angle = car.params.wheelbase / radius + 0.1 * error + 0.14 * outward + integral;
    c.steer = Math.max(-1, Math.min(1, -angle / lock));
    target += 0.22 * DT;
    c.throttle = Math.max(0, Math.min(1, (target - car.speed) * 0.5 + 0.02 * target));
    car.step(DT, c);
    const g = (car.speed * yawRate(car)) / G;
    window += g;
    steerSum += car.steerAngle;
    rollSum += roll(car);
    if (++count === 60) {
      const mean = window / count;
      samples.push({ g: mean, steer: (steerSum / count) * DEG, roll: rollSum / count, speed: car.speed, slip: bodySlip(car) });
      if (mean > held) {
        held = mean;
        out.maxG = mean;
        out.speedAtMax = car.speed * KMH;
        out.slipAtLimit = bodySlip(car);
        out.steerAtLimit = (steerSum / count) * DEG;
      }
      window = steerSum = rollSum = count = 0;
    }
    if (error > 2.5) { out.ended = 'ran wide'; break; }
    if (Math.abs(bodySlip(car)) > 25) { out.ended = 'spun'; break; }
  }
  // steering and roll against lateral acceleration, where the car is still linear
  const linear = samples.filter((s) => s.g > 0.15 && s.g < 0.55);
  out.understeer = slope(linear, 'g', 'steer');
  out.rollPerG = slope(samples.filter((s) => s.g > 0.15 && s.g < 0.8), 'g', 'roll');
  return out;
}

function slope(samples, xKey, yKey) {
  const n = samples.length;
  if (n < 2) return NaN;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    sx += s[xKey]; sy += s[yKey]; sxx += s[xKey] * s[xKey]; sxy += s[xKey] * s[yKey];
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

/** At a steady speed (km/h), put on a steering angle in one go: how the yaw rate arrives. */
export function stepSteer(kmh, degrees, params) {
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH);
  c.steer = -degrees / DEG / car.params.steering.lock; // to the left
  const trace = [];
  hold(car, kmh / KMH, 4, c, () => trace.push(yawRate(car)));
  const steady = mean(trace.slice(-120));
  const peak = Math.max(...trace);
  const rise = trace.findIndex((r) => r >= 0.9 * steady) * DT;
  let settle = 0;
  for (let i = trace.length - 1; i >= 0; i--) {
    if (Math.abs(trace[i] - steady) > 0.05 * Math.abs(steady)) { settle = (i + 1) * DT; break; }
  }
  return { steadyG: (steady * car.speed) / G, overshoot: (peak / steady - 1) * 100, rise, settle, slip: bodySlip(car), roll: roll(car) };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * A steady bend at the given speed (km/h) and lateral acceleration (g), found by trimming the steering; then
 * something is done to the pedals with the steering held, and the car is watched for a while.
 * @returns {{before:object, after:object, mostSlip:number, mostYaw:number, spun:boolean, escWork:number, tcWork:number}}
 */
export function bend(kmh, g, action, params, { esc = true, tc = true, seconds = 3 } = {}) {
  const car = makeCar(params);
  car.assistsOn.esc = esc;
  car.assistsOn.tc = tc;
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const wanted = (g * G) / speed; // yaw rate
  let steer = 0;
  // trim the steering until the car turns at the wanted rate
  hold(car, speed, 8, c, () => {
    steer += (wanted - yawRate(car)) * 0.25 * DT;
    c.steer = -Math.max(0, Math.min(1, steer));
  });
  const snapshot = () => ({ yawRate: yawRate(car), g: (car.speed * yawRate(car)) / G, slip: bodySlip(car), kmh: car.speed * KMH, radius: car.speed / yawRate(car) });
  const before = snapshot();
  const out = { before, after: null, mostSlip: 0, mostYaw: 0, spun: false, escWork: 0, tcWork: 0, steer: car.steerAngle * DEG };
  for (let i = 0; i < seconds * 120; i++) {
    action(c, i * DT, car);
    car.step(DT, c);
    const slip = bodySlip(car);
    if (Math.abs(slip) > Math.abs(out.mostSlip)) out.mostSlip = slip;
    out.mostYaw = Math.max(out.mostYaw, yawRate(car));
    out.escWork = Math.max(out.escWork, car.assists.esc);
    out.tcWork = Math.max(out.tcWork, car.assists.tc);
    if (Math.abs(slip) > 45) out.spun = true;
    if (i === 119) out.after = snapshot(); // one second in
  }
  out.end = snapshot();
  return out;
}

/** Full lock and the handbrake for a second at the given speed, then let go and drive on. */
export function handbrakeTurn(kmh, params) {
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH);
  const yaw0 = car.yaw;
  let turned = 0, last = yaw0, mostSlip = 0, least = Infinity;
  const watch = () => {
    let d = car.yaw - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    last = car.yaw;
    mostSlip = Math.max(mostSlip, Math.abs(bodySlip(car)));
    least = Math.min(least, Math.abs(car.speed));
  };
  c.throttle = 0;
  c.steer = -1;
  c.handbrake = 1;
  for (let i = 0; i < 120; i++) { car.step(DT, c); watch(); }
  const lockedAt = car.wheels[2].omega;
  c.handbrake = 0;
  c.steer = 0;
  c.throttle = 0.6;
  for (let i = 0; i < 240; i++) { car.step(DT, c); watch(); }
  return { turned: turned * DEG, mostSlip, slowest: least * KMH, rearLocked: Math.abs(lockedAt) < 0.5, endKmh: car.speed * KMH, endSlip: bodySlip(car) };
}

/**
 * Kick one end of the body upwards and watch it ring: with the dampers nearly off for the frequency, with them on
 * for how quickly it dies (the overshoot of the first return gives the damping ratio).
 */
export function ride(end) {
  const kick = (params, way = 1) => {
    const car = makeCar(params);
    const c = controls();
    const spec = car.params;
    const a = spec.wheels[0].z - spec.com.z, b = spec.com.z - spec.wheels[2].z;
    const speed = 0.25 * way; // m/s upwards at the axle kicked, none at the other
    const omega = end === 'front' ? -speed / (a + b) : speed / (a + b);
    car.velocity.y = end === 'front' ? (speed * b) / (a + b) : (speed * a) / (a + b);
    car.angularVelocity.x = omega;
    const wheel = car.wheels[end === 'front' ? 0 : 2];
    const trace = [];
    for (let i = 0; i < 120 * 6; i++) {
      car.step(DT, c);
      trace.push(wheel.travel);
    }
    return trace;
  };
  // frequency: time between upward zero crossings with a tenth of the damping
  const free = kick(tuned((p) => p.wheels.forEach((w) => { w.damperBump *= 0.1; w.damperRebound *= 0.1; })));
  const crossings = [];
  for (let i = 1; i < free.length && crossings.length < 4; i++) {
    if (free[i - 1] < 0 && free[i] >= 0) crossings.push(i - 1 + free[i - 1] / (free[i - 1] - free[i]));
  }
  const period = crossings.length > 1 ? ((crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)) * DT : NaN;
  // damping: the first swing out against the swing back, kicked upwards (the swing back is the dampers' bump
  // stroke) and downwards (their rebound stroke)
  const damping = (way) => {
    const trace = kick(CAR, way).map((t) => t * -way);
    let out = 0, back = 0, returned = false;
    for (const t of trace) {
      if (!returned) {
        if (t > out) out = t;
        else if (t < 0 && out > 1e-4) returned = true;
      } else if (-t > back) back = -t;
    }
    const ln = Math.log(back / out);
    return back > 0 ? -ln / Math.sqrt(Math.PI * Math.PI + ln * ln) : 1;
  };
  const bump = damping(1), rebound = damping(-1);
  return { hz: 1 / period, dampingRatio: (bump + rebound) / 2, bump, rebound };
}

/** Hands off at speed (km/h) after a shove sideways: does it run straight again? */
export function handsOff(kmh, params) {
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH);
  car.angularVelocity.y += 0.12; // a gust
  let mostSlip = 0, mostYaw = 0;
  hold(car, kmh / KMH, 6, c, () => {
    mostSlip = Math.max(mostSlip, Math.abs(bodySlip(car)));
    mostYaw = Math.max(mostYaw, Math.abs(yawRate(car)));
  });
  let residual = 0;
  hold(car, kmh / KMH, 2, c, () => { residual = Math.max(residual, Math.abs(yawRate(car))); });
  return { mostSlip, mostYaw, residualYawRate: residual, kmh: car.speed * KMH };
}

/** Standing on a slope (rise per metre along and across): how far it moves in ten seconds. */
export function parked(grade, bank) {
  const car = makeCar(CAR, createPlane({ grade, bank }));
  const c = controls();
  for (let i = 0; i < 120; i++) car.step(DT, c);
  const before = car.position.clone();
  for (let i = 0; i < 1200; i++) car.step(DT, c);
  return { moved: car.position.distanceTo(before), speed: car.velocity.length() };
}

/** Reverse: hold the brake from a standstill for a few seconds, then the throttle. */
export function reversing() {
  const car = makeCar();
  const c = controls();
  c.brake = 1;
  for (let i = 0; i < 120 * 5; i++) car.step(DT, c);
  const back = { kmh: car.speed * KMH, gear: car.gear };
  c.brake = 0;
  c.throttle = 1;
  let rolledBack = 0, t = 0;
  const z0 = car.position.z;
  while (car.speed < 0 && t < 10) { car.step(DT, c); t += DT; rolledBack = z0 - car.position.z; }
  for (let i = 0; i < 120; i++) car.step(DT, c);
  return { back, stopTime: t, stopDistance: rolledBack, gearAfter: car.gear, kmhAfter: car.speed * KMH };
}

// ---- the car in a person's hands: PlayerDriver fed with keys, a stick or a thumb, exactly as the game feeds it -----

/** A stand-in for engine/Input.js: whatever `state` holds is what the driver reads. */
export function fakeInput() {
  const state = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false };
  return { state, read: (out) => Object.assign(out, state) };
}

/** The speed held by a part throttle chosen by hand (not a key): what isolates the steering in a measurement. */
const holdThrottle = (car, speed) => Math.max(0, Math.min(1, (speed - car.speed) * 0.6 + 0.012 * speed));

/**
 * A steering key held down at a steady speed (km/h) for `seconds` and let go: how quickly the yaw rate arrives (to
 * 90 % of its steady value) and goes (to under 10 %), the steady lateral g, the steering it settles at, the
 * overshoot of the yaw rate and its swing once it should have settled (peak to peak in g, from 2 s on).
 */
export function keyResponse(kmh, params, seconds = 4) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const n1 = seconds * 120, n2 = n1 + 240;
  const trace = [];
  for (let i = 0; i < n2; i++) {
    input.state.steer = i < n1 ? -1 : 0; // left
    driver.drive(car, DT, c);
    c.throttle = holdThrottle(car, speed);
    car.step(DT, c);
    trace.push({ r: yawRate(car), steer: car.steerAngle });
  }
  const steady = mean(trace.slice(n1 - 60, n1).map((x) => x.r));
  const swing = trace.slice(240, n1).map((x) => (x.r * speed) / G);
  return {
    rise: (trace.findIndex((x) => x.r >= 0.9 * steady) + 1) * DT,
    release: (trace.findIndex((x, i) => i >= n1 && Math.abs(x.r) < 0.1 * Math.abs(steady)) - n1 + 1) * DT,
    steadyG: (steady * speed) / G,
    steer: trace[n1 - 1].steer * DEG,
    overshoot: (Math.max(...trace.slice(0, n1).map((x) => x.r)) / steady - 1) * 100,
    swing: Math.max(...swing) - Math.min(...swing),
  };
}

/** The steering (degrees at the road wheels) a key held down, or a stick held over, settles at at a speed (km/h). */
export function lockAt(kmh, analog = false, params) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  car.velocity.set(0, 0, kmh / KMH);
  car._sync();
  const c = controls();
  Object.assign(input.state, { steer: 1, analog });
  for (let i = 0; i < 240; i++) driver.drive(car, DT, c);
  return c.steer * car.params.steering.lock * DEG;
}

/** A tap of a steering key (ms) at a speed (km/h), throttle key held: how far it turns the car and whether it saws. */
export function keyTap(kmh, ms, params) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH);
  const yaw0 = car.yaw, x0 = car.position.x;
  let reversals = 0, sign = 0, late = 0;
  for (let i = 0; i < 360; i++) {
    input.state.steer = i < (ms / 1000) * 120 ? 1 : 0;
    input.state.throttle = 1;
    driver.drive(car, DT, c);
    car.step(DT, c);
    const r = yawRate(car);
    const s = Math.abs(r) > 0.003 ? Math.sign(r) : sign;
    if (sign && s !== sign) reversals++;
    sign = s;
    if (i >= 120) late = Math.max(late, Math.abs(r));
  }
  return { heading: (car.yaw - yaw0) * DEG, lateral: car.position.x - x0, reversals, late };
}

/** The brake key from a speed (km/h) to a stop, with a steering key held from 0.5 s on (-1 left, 0, 1 right). */
export function brakeKey(kmh, steer = 0, params) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH + 0.5);
  while (car.speed > kmh / KMH) { driver.drive(car, DT, c); car.step(DT, c); }
  const x0 = car.position.x, z0 = car.position.z, yaw0 = car.yaw;
  let t = 0;
  input.state.brake = 1;
  while (car.speed > 0.3 && t < 10) {
    input.state.steer = t > 0.5 ? steer : 0;
    driver.drive(car, DT, c);
    car.step(DT, c);
    t += DT;
  }
  return { distance: Math.hypot(car.position.x - x0, car.position.z - z0), time: t, heading: (car.yaw - yaw0) * DEG, lateral: car.position.x - x0 };
}

/** The throttle key from rest for a few seconds, with a steering key held (or not). */
export function launchKey(steer = 0, params, seconds = 4) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const c = controls();
  let mostSlip = 0, tc = 0;
  for (let i = 0; i < seconds * 120; i++) {
    Object.assign(input.state, { throttle: 1, steer });
    driver.drive(car, DT, c);
    car.step(DT, c);
    // a car turning tight at low speed points well inside its path anyway (b/R): only slip beyond that is a slide
    const kinematic = Math.abs(car.speed) > 1 ? Math.atan((car.params.wheelbase / 2 - car.params.com.z) * Math.abs(yawRate(car)) / Math.abs(car.speed)) * DEG : 0;
    mostSlip = Math.max(mostSlip, Math.abs(bodySlip(car)) - kinematic);
    tc = Math.max(tc, car.assists.tc);
  }
  return { kmh: car.speed * KMH, mostSlip, tc, turned: Math.abs(car.yaw) * DEG };
}

/** Steering key and handbrake together for `pull` seconds at a speed (km/h), then the throttle key. */
export function handbrakeKeys(kmh, pull, params) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const c = cruise(car, kmh / KMH);
  let turned = 0, last = car.yaw, least = Infinity, mostSlip = 0;
  for (let i = 0; i < 120 * 4; i++) {
    const t = i * DT;
    input.state.steer = t < pull + 0.3 ? -1 : 0;
    input.state.handbrake = t > 0.15 && t < pull + 0.15 ? 1 : 0;
    input.state.throttle = t > pull + 0.15 ? 1 : 0;
    driver.drive(car, DT, c);
    car.step(DT, c);
    let d = car.yaw - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    last = car.yaw;
    least = Math.min(least, car.speed);
    mostSlip = Math.max(mostSlip, Math.abs(bodySlip(car)));
  }
  return { turned: turned * DEG, slowest: least * KMH, endKmh: car.speed * KMH, mostSlip };
}

/**
 * Does the gearbox hunt? A throttle key worked on and off (0.4 s each way) at 60 km/h, and a car let run down an 8 %
 * hill held near 70 km/h by dabs of the brake: shifts in 15 s.
 */
export function gearHunt(params) {
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  const car = makeCar(params);
  const c = cruise(car, 60 / KMH);
  let keyShifts = 0, gear = car.gear;
  for (let i = 0; i < 120 * 15; i++) {
    input.state.throttle = car.speed < 60 / KMH && Math.floor((i * DT) / 0.4) % 2 === 0 ? 1 : 0;
    driver.drive(car, DT, c);
    car.step(DT, c);
    if (car.gear !== gear) keyShifts++;
    gear = car.gear;
  }
  const hill = new Vehicle(createPlane({ grade: -0.08 }), params);
  hill.reset({ x: 0, z: 0, yaw: 0 });
  const h = controls();
  while (hill.speed < 70 / KMH) { h.throttle = 1; hill.step(DT, h); }
  let hillShifts = 0;
  gear = hill.gear;
  for (let i = 0; i < 120 * 20; i++) {
    h.throttle = 0;
    h.brake = hill.speed > 72 / KMH ? 0.25 : 0;
    hill.step(DT, h);
    if (i > 120 * 5 && hill.gear !== gear) hillShifts++;
    gear = hill.gear;
  }
  return { keyShifts, hillShifts };
}

/** A slow wind of the steering at a steady speed: at what fraction of the most lateral g the tyres start to squeal. */
export function squealOnset(kmh, params) {
  const car = makeCar(params);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  const rate = 0.013 * (60 / Math.max(kmh, 30)) ** 1.3; // rad/s at the road wheels
  const trace = [];
  for (let i = 0; i < 120 * 14; i++) {
    c.steer = -Math.min(1, (i * DT * rate) / car.params.steering.lock);
    c.throttle = holdThrottle(car, speed);
    car.step(DT, c);
    trace.push({ g: (car.speed * yawRate(car)) / G, skid: Math.max(...car.wheels.map((w) => w.skid)) });
  }
  const most = Math.max(...trace.map((x) => x.g));
  const first = trace.find((x) => x.skid > 0.02);
  return { onset: first ? first.g / most : NaN, atLimit: trace.find((x) => x.g === most).skid, most };
}

/** The steering gain of the car in the linear range: its characteristic speed (m/s; infinite would be neutral). */
export function characteristicSpeed(params, speed = 30) {
  const car = makeCar(params);
  car.assistsOn.esc = false;
  const c = cruise(car, speed);
  const angle = 0.3 / speed;
  c.steer = -angle / car.params.steering.lock;
  hold(car, speed, 4, c);
  const gain = yawRate(car) / angle;
  return speed / Math.sqrt(speed / (car.params.wheelbase * gain) - 1);
}

/**
 * A touch on a rail: the car arrives at `angle` degrees to it at a speed (km/h), throttle held as it was, and from
 * 0.4 s to 0.7 s after the touch a key steers it away. What it keeps, how soon it lies along the rail, what was
 * reported, and whether it drives on.
 */
export function railTouch(kmh, angle, params, kind = EDGE.RAIL) {
  const plane = createPlane({ edge: 8, kind });
  const car = makeCar(params, plane);
  const speed = kmh / KMH;
  const c = cruise(car, speed);
  // turn the settled car (and its motion) towards the left rail, and put it a little way off
  const a = angle / DEG;
  const q = car.quaternion.clone().set(0, Math.sin(a / 2), 0, Math.cos(a / 2));
  car.quaternion.premultiply(q);
  car.velocity.applyQuaternion(q);
  car._axes();
  car._com.x = 8 - 1.2 - 2.3 * Math.sin(a) - Math.max(0.3, speed * Math.sin(a) * 0.25);
  car._sync();
  const input = fakeInput();
  const driver = new PlayerDriver(input);
  let hit = -1, before = 0, least = Infinity, parallel = NaN, impacts = 0, strength = 0, scraped = 0, kept = NaN;
  for (let i = 0; i < 120 * 3; i++) {
    const t = i * DT;
    input.state.steer = hit >= 0 && t - hit > 0.4 && t - hit < 0.7 ? 1 : 0;
    driver.drive(car, DT, c);
    c.throttle = holdThrottle(car, speed);
    const v = car.velocity.length();
    car.step(DT, c);
    if (car.impacts.length && hit < 0) {
      hit = t;
      before = v;
      strength = car.impacts[0].strength;
    }
    if (hit >= 0 && t - hit < 1.2) impacts += car.impacts.length;
    car.impacts.length = 0;
    if (hit >= 0) {
      if (t - hit < 0.6) least = Math.min(least, car.velocity.length());
      if (Number.isNaN(parallel) && Math.abs(Math.atan2(car._fx, car._fz)) < 3 / DEG) parallel = t - hit;
      if (Number.isNaN(kept) && t - hit >= 0.6) kept = car.velocity.length() / before;
      if (car.scrape > 0.05) scraped += DT;
    }
  }
  return { kept, least: least / before, parallel, impacts, strength, scraped, endKmh: car.speed * KMH, away: 8 - car.position.x };
}

// ---- laps of a road ---------------------------------------------------------------------------------------------

/**
 * Who drives a lap: 'auto' (the autopilot), or a person through PlayerDriver with the autopilot's wishes as their
 * intent: 'pad' (its steering and pedals through the analog path), 'thumb' (its steering through the analog path,
 * the throttle full unless it brakes, as on a phone) or 'keys' (keys pressed and let go to follow its steering, the
 * throttle and brake keys when it asks for more than a little of either).
 */
export function lapDriver(track, kind, pace = 0.9, bias = 0, params = CAR) {
  const auto = new AutoDriver(track, { pace, bias, params });
  if (kind === 'auto') return auto;
  const input = fakeInput();
  const player = new PlayerDriver(input);
  const probe = new PlayerDriver(fakeInput());
  const scratch = controls();
  const wish = controls();
  let key = 0;
  /** The angle (rad, + = left) a full analog input gives at this speed that way. */
  const room = (car, left) => {
    Object.assign(probe.input.state, { analog: true, steer: left ? -1 : 1 });
    probe.drive(car, 0, scratch);
    return Math.max(0.01, Math.abs(scratch.steer) * car.params.steering.lock);
  };
  return {
    drive(car, dt, out) {
      auto.drive(car, dt, wish);
      const lock = car.params.steering.lock;
      const angle = -wish.steer * lock;
      const s = input.state;
      if (kind === 'keys') {
        const now = -(out.steer || 0) * lock;
        const band = 0.004 + 0.1 * Math.abs(angle);
        if (angle - now > band) key = -1;
        else if (angle - now < -band) key = 1;
        else if (Math.abs(angle) < 0.01 || Math.sign(-key) !== Math.sign(angle)) key = 0;
        Object.assign(s, { analog: false, steer: key, throttle: wish.throttle > 0.35 ? 1 : 0, brake: wish.brake > 0.15 ? 1 : 0, handbrake: 0 });
      } else {
        s.analog = true;
        s.steer = Math.max(-1, Math.min(1, -angle / room(car, angle > 0)));
        s.brake = wish.brake;
        s.throttle = kind === 'thumb' ? (wish.brake < 0.12 ? 1 : 0) : wish.throttle;
        s.handbrake = 0;
      }
      return player.drive(car, dt, out);
    },
  };
}

/** Laps from the grid: the flying lap times (the run to the line and the first lap from rest are left out) and what happened. */
export function laps(track, kind, { pace = 0.9, count = 2, bias = 0, slot = 0, params = CAR } = {}) {
  const driver = lapDriver(track, kind, pace, bias, params);
  const car = new Vehicle(track, params);
  car.reset(track.grid(slot, {}));
  const c = controls();
  const times = [];
  let t = 0, started = 0, last = car.s, impacts = 0, off = -Infinity, slip = 0, escTime = 0, finite = true;
  while (times.length < count + 2 && t < 400 * (count + 2)) {
    driver.drive(car, DT, c);
    car.step(DT, c);
    t += DT;
    if (!Number.isFinite(car.position.x + car.velocity.x)) { finite = false; break; }
    impacts += car.impacts.length;
    car.impacts.length = 0;
    if (times.length >= 1) {
      off = Math.max(off, Math.abs(car.lat) + car.params.box.halfWidth - track.halfWidth);
      if (car.speed > 8) slip = Math.max(slip, Math.abs(bodySlip(car)));
      if (car.assists.esc > 0.1) escTime += DT;
    }
    if (car.s < last - track.length / 2) {
      times.push(t - started);
      started = t;
    }
    last = car.s;
  }
  const flying = times.slice(2);
  return { times: flying, best: Math.min(...flying), impacts, off, slip, escPerLap: escTime / Math.max(1, times.length - 1), finite };
}
