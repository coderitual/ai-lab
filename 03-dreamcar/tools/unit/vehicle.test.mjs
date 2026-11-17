// The car's physics, checked in Node: the build contract's targets and the things that must never happen.
//
//   node tools/unit/vehicle.test.mjs          (exit code 1 if anything fails)
//
// The targets are measured by the same manoeuvres tools/handling.mjs prints (tools/unit/manoeuvres.mjs). The
// invariants are hammered with seeded random driving: no NaN, no energy out of nowhere, no way through, onto or
// into a solid edge at any speed or angle, no car through another, nothing allocated while stepping, the same run
// twice. The real road (src/game/track.js) is used as well as the stand-ins when it can be loaded.

import v8 from 'node:v8';
import vm from 'node:vm';
import { AutoDriver, PlayerDriver } from '../../src/game/drivers.js';
import { Vehicle, collideVehicles } from '../../src/game/vehicle/Vehicle.js';
import { CAR } from '../../src/game/vehicle/params.js';
import { ASSISTS } from '../../src/game/config.js';
import { EDGE, SURFACE, createCircle, createOval, createPlane } from './flatTrack.mjs';
import * as M from './manoeuvres.mjs';

const DT = M.DT;
const KMH = 3.6;
const DEG = 180 / Math.PI;

let failures = 0;
const results = [];
function test(name, fn) {
  const started = performance.now();
  let note = '';
  try {
    note = fn() || '';
    results.push(`  ok    ${name}${note ? `: ${note}` : ''}  (${(performance.now() - started).toFixed(0)} ms)`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}: ${error.message}`);
  }
  console.log(results[results.length - 1]);
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
const within = (value, lo, hi, what) => check(value >= lo && value <= hi, `${what} is ${+value.toFixed(3)}, wanted ${lo} to ${hi}`);

/** Seeded random numbers (mulberry32): the same driving every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let realTrack = null;
let realModule = null;
try {
  realModule = await import('../../src/game/track.js');
  realTrack = realModule.createTrack();
} catch (error) {
  console.log(`  note  src/game/track.js could not be loaded (${error.message.split('\n')[0]}): the stand-in roads only`);
}

const controls = () => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
const finite = (car) => Number.isFinite(car.position.x + car.position.y + car.position.z + car.velocity.lengthSq() + car.angularVelocity.lengthSq() +
  car.quaternion.x + car.quaternion.w + car.rpm + car.wheels[0].omega + car.wheels[1].omega + car.wheels[2].omega + car.wheels[3].omega);

/** How far the furthest point of the body's outline is beyond a solid edge (m; negative = inside). */
const probe = { y: 0, nx: 0, ny: 1, nz: 0, surface: 0, grip: 1, s: 0, lat: 0, index: 0, edgeL: 0, edgeR: 0, sky: 1 };
function beyondEdge(car) {
  const o = car._outline;
  let most = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = car.position.x + car._lx * o[i * 2] + car._fx * o[i * 2 + 1];
    const z = car.position.z + car._lz * o[i * 2] + car._fz * o[i * 2 + 1];
    car.track.surfaceAt(x, z, -1, probe);
    most = Math.max(most, probe.lat - probe.edgeL, -probe.lat - probe.edgeR);
  }
  return most;
}
/** Height of the model's root above the road under it. */
function heightAbove(car) {
  car.track.surfaceAt(car.position.x, car.position.z, car.trackIndex, probe);
  return car.position.y - probe.y;
}

// ---- the contract's targets ------------------------------------------------------------------------------------

test('at rest it sits at ride height and does not move', () => {
  const r = M.rest();
  within(r.rideHeight * 1000, -0.5, 0.5, 'ride height error (mm)');
  check(r.residualSpeed === 0 && r.drift === 0, `still moving: ${r.residualSpeed} m/s, ${r.drift} m`);
  const total = r.loads.reduce((a, b) => a + b, 0);
  within(total / (CAR.mass * CAR.gravity), 0.999, 1.001, 'wheel loads / weight');
  const slope = M.parked(0.1, 0.06);
  check(slope.moved < 1e-4, `creeps ${slope.moved} m in 10 s on a slope`);
});

test('0-100 km/h in 4.0 s or less, 0-200 in about 13 s', () => {
  const a = M.acceleration();
  within(a.t100, 3.4, 4.0, '0-100 km/h (s)');
  within(a.t200, 11, 14, '0-200 km/h (s)');
  const gears = a.shifts.map((s) => s.to);
  check(gears.every((g, i) => g === i + 2), `gears taken out of order: ${gears}`);
  return `${a.t100.toFixed(2)} s, 0-200 in ${a.t200.toFixed(1)} s`;
});

test('top speed about 285 km/h, held steadily', () => {
  const t = M.topSpeed();
  within(t.kmh, 278, 290, 'top speed (km/h)');
  check(t.ripple < 1, `hunts by ${t.ripple} km/h at the limiter`);
  check(t.drift < 0.05, `wanders ${t.drift} m off a straight line`);
  return `${t.kmh.toFixed(1)} km/h in ${t.gear}th`;
});

test('100-0 km/h in 32 m or less, straight', () => {
  const b = M.braking(100);
  within(b.distance, 24, 32, '100-0 km/h (m)');
  check(b.drift < 0.05 && b.yaw < 0.5, `pulls to one side: ${b.drift} m, ${b.yaw}°`);
  within(b.divePerG, 1.4, 2.1, 'dive (° per g)');
  const locked = M.braking(100, CAR, { abs: false });
  check(locked.distance > b.distance + 2, 'locked wheels stop no worse than ABS');
  return `${b.distance.toFixed(1)} m (${locked.distance.toFixed(1)} m with the wheels locked)`;
});

test('about 1.25 g round a 50 m circle, running wide at the limit, about 3.5° of roll per g', () => {
  const s = M.skidpad(50);
  within(s.maxG, 1.18, 1.35, 'steady cornering (g)');
  check(s.ended === 'ran wide', `at the limit it ${s.ended}`);
  within(s.understeer, 0.5, 3, 'understeer gradient (° per g)');
  within(s.rollPerG, 3, 4, 'roll (° per g)');
  return `${s.maxG.toFixed(2)} g, ${s.understeer.toFixed(2)}° per g of understeer, ${s.rollPerG.toFixed(2)}° per g of roll`;
});

test('stable hands-off at 200 km/h', () => {
  const h = M.handsOff(200);
  check(h.mostSlip < 3, `a shove at 200 km/h grows to ${h.mostSlip}° of slip`);
  check(h.residualYawRate < 0.002, `still yawing at ${h.residualYawRate} rad/s`);
});

test('ride: about 1.3 Hz front, 1.5 Hz rear, damping ratio 0.4 to 0.5', () => {
  const front = M.ride('front'), rear = M.ride('rear');
  within(front.hz, 1.2, 1.4, 'front ride frequency (Hz)');
  within(rear.hz, 1.4, 1.6, 'rear ride frequency (Hz)');
  within(front.dampingRatio, 0.38, 0.52, 'front damping ratio');
  within(rear.dampingRatio, 0.38, 0.52, 'rear damping ratio');
  return `${front.hz.toFixed(2)} / ${rear.hz.toFixed(2)} Hz, ${front.dampingRatio.toFixed(2)} / ${rear.dampingRatio.toFixed(2)}`;
});

test('power in second gear: caught with the assists, a spin without', () => {
  const on = M.bend(45, 0.65, (c) => { c.throttle = 1; });
  const off = M.bend(45, 0.65, (c) => { c.throttle = 1; }, CAR, { esc: false, tc: false });
  check(!on.spun && Math.abs(on.mostSlip) < 12, `with the assists it slides to ${on.mostSlip}°`);
  check(on.tcWork > 0.1, 'the traction control never worked');
  check(Math.abs(off.mostSlip) > 20, `without the assists it only slides to ${off.mostSlip}°`);
  return `${on.mostSlip.toFixed(1)}° with, ${off.mostSlip.toFixed(0)}° without`;
});

test('lifting off in a bend tightens the line and does not spin the car', () => {
  const l = M.bend(90, 0.8, (c) => { c.throttle = 0; });
  check(l.after.radius < l.before.radius, `radius ${l.before.radius} -> ${l.after.radius}`);
  check(!l.spun && Math.abs(l.mostSlip) < 8, `slides to ${l.mostSlip}°`);
});

test('the handbrake locks the rear wheels and turns the car', () => {
  const h = M.handbrakeTurn(60);
  check(h.rearLocked, 'rear wheels still turning');
  check(h.turned > 60, `turned only ${h.turned}°`);
});

test('reverse: the brake at a standstill backs the car up, the throttle stops it and drives on', () => {
  const r = M.reversing();
  check(r.back.gear === -1 && r.back.kmh < -15, `after 5 s on the brake: gear ${r.back.gear}, ${r.back.kmh} km/h`);
  check(r.back.kmh > -CAR.gearbox.reverseSpeed * KMH - 3, `reverse runs to ${r.back.kmh} km/h`);
  check(r.gearAfter >= 1 && r.kmhAfter > 5, `then gear ${r.gearAfter}, ${r.kmhAfter} km/h`);
});

// ---- invariants ----------------------------------------------------------------------------------------------

/** Kinetic energy plus height: what the car could do damage with. */
function energy(car) {
  const p = car.params;
  const o = car.angularVelocity;
  const a = o.x * car._lx + o.y * car._ly + o.z * car._lz;
  const b = o.x * car._ux + o.y * car._uy + o.z * car._uz;
  const c = o.x * car._fx + o.y * car._fy + o.z * car._fz;
  let e = 0.5 * p.mass * car.velocity.lengthSq() + 0.5 * (p.inertia.x * a * a + p.inertia.y * b * b + p.inertia.z * c * c) + p.mass * p.gravity * car._com.y;
  for (const w of car.wheels) {
    e += 0.5 * w._spec.inertia * w.omega * w.omega;
    const squash = Math.max(0, w.travel + w._spec.preload);
    e += 0.5 * w._spec.spring * squash * squash;
    if (w.travel > p.suspension.bumpStop) e += 0.5 * p.suspension.bumpStopRate * (w.travel - p.suspension.bumpStop) ** 2;
  }
  e += 0.5 * p.wheels[0].antiRoll * (car.wheels[0].travel - car.wheels[1].travel) ** 2;
  e += 0.5 * p.wheels[2].antiRoll * (car.wheels[2].travel - car.wheels[3].travel) ** 2;
  return e;
}

test('energy does not grow on its own', () => {
  const rnd = random(11);
  let worst = 0;
  for (let run = 0; run < 60; run++) {
    const car = M.makeCar();
    const c = controls();
    // thrown about: sideways, spinning, dropped from a little height, wheels turning
    car._com.y += rnd() * 0.6;
    car.velocity.set((rnd() - 0.5) * 30, (rnd() - 0.5) * 4, (rnd() - 0.2) * 60);
    car.angularVelocity.set((rnd() - 0.5) * 1.5, (rnd() - 0.5) * 4, (rnd() - 0.5) * 1.5);
    for (const w of car.wheels) w.omega = (rnd() * 60) / w._spec.radius;
    c.steer = rnd() * 2 - 1;
    c.brake = rnd() < 0.3 ? rnd() : 0;
    c.handbrake = rnd() < 0.2 ? 1 : 0;
    car._sync();
    const start = energy(car);
    let most = start;
    for (let i = 0; i < 120 * 6; i++) {
      car.step(DT, c);
      check(finite(car), `NaN in run ${run}`);
      most = Math.max(most, energy(car));
    }
    worst = Math.max(worst, most / start - 1);
    check(most <= start * 1.01 + 300, `run ${run}: energy rose from ${start.toFixed(0)} to ${most.toFixed(0)} J`);
    check(energy(car) < start, `run ${run}: nothing was lost`);
  }
  return `most gained ${(worst * 100).toFixed(2)} %`;
});

/** Drive at random for a while; report the worst of everything that must stay small. */
function hammer(track, seed, seconds, { cars = 1, start = null } = {}) {
  const rnd = random(seed);
  const fleet = [];
  const out = { beyond: -Infinity, height: -Infinity, low: Infinity, tilt: 0, speed: 0, impacts: 0, touches: 0, steps: 0 };
  const place = { x: 0, y: 0, z: 0, yaw: 0 };
  for (let k = 0; k < cars; k++) {
    const car = new Vehicle(track);
    car.reset(start ? start(k, rnd, place) : track.grid(k, place));
    fleet.push({ car, c: controls(), until: 0, sink: [] });
  }
  for (let i = 0; i < seconds * 120; i++) {
    for (const f of fleet) {
      if (i >= f.until) {
        // a new whim every so often: mostly flat out, sometimes braking, sometimes the handbrake, any steering
        f.until = i + 10 + Math.floor(rnd() * 200);
        const mood = rnd();
        f.c.steer = mood < 0.2 ? 0 : Math.max(-1, Math.min(1, (rnd() * 2 - 1) * (rnd() < 0.3 ? 3 : 0.6)));
        f.c.throttle = rnd() < 0.75 ? 1 : rnd();
        f.c.brake = rnd() < 0.2 ? rnd() : 0;
        f.c.handbrake = rnd() < 0.08 ? 1 : 0;
      }
      f.car.step(DT, f.c);
    }
    for (let a = 0; a < cars; a++) for (let b = a + 1; b < cars; b++) if (collideVehicles(fleet[a].car, fleet[b].car)) out.touches++;
    for (const f of fleet) {
      const car = f.car;
      check(finite(car), `NaN at step ${i} (seed ${seed})`);
      const beyond = beyondEdge(car);
      const height = heightAbove(car);
      out.beyond = Math.max(out.beyond, beyond);
      out.height = Math.max(out.height, height);
      out.low = Math.min(out.low, height);
      out.tilt = Math.max(out.tilt, Math.acos(Math.min(1, car._uy)) * DEG);
      out.speed = Math.max(out.speed, car.velocity.length());
      out.impacts += car.impacts.length;
      car.drainImpacts(f.sink);
      f.sink.length = 0;
      check(beyond < 0.02, `through an edge by ${beyond.toFixed(3)} m at s = ${car.s.toFixed(0)} (seed ${seed}, step ${i})`);
      check(height < 0.6 && height > -0.25, `launched or sunk: ${height.toFixed(2)} m above the road at s = ${car.s.toFixed(0)} (seed ${seed}, step ${i})`);
      check(car.velocity.length() < 80, `${(car.velocity.length() * KMH).toFixed(0)} km/h out of nowhere (seed ${seed}, step ${i})`);
    }
    out.steps++;
  }
  return out;
}

test('minutes of random driving in a walled oval: never NaN, never through, never launched', () => {
  const oval = createOval(260, 32, { edge: 6.5, vergeGrip: 0.55 });
  let impacts = 0, tilt = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const h = hammer(oval, seed, 100);
    impacts += h.impacts;
    tilt = Math.max(tilt, h.tilt);
  }
  // (with the default level's help the random driver keeps the car off the walls more of the time than it did)
  check(impacts > 15, `the random driver hardly hit anything (${impacts} impacts): the test is not testing`);
  return `10 minutes, ${impacts} impacts, most tilt ${tilt.toFixed(1)}°`;
});

if (realTrack) {
  test('minutes of random driving on the real road, two cars together: never NaN, never through, never launched', () => {
    let impacts = 0, touches = 0, height = 0, tilt = 0;
    for (let seed = 21; seed <= 26; seed++) {
      const spot = (k, rnd, place) => {
        // anywhere on the lap, a few metres apart
        const s = rnd() * realTrack.length;
        const frame = realTrack.frameAt(s + k * 9, {});
        place.x = frame.pos.x + frame.left.x * (k ? -1.6 : 1.6);
        place.z = frame.pos.z + frame.left.z * (k ? -1.6 : 1.6);
        place.yaw = Math.atan2(frame.tan.x, frame.tan.z);
        return place;
      };
      const rnd = random(seed * 7);
      const s0 = rnd() * realTrack.length;
      const h = hammer(realTrack, seed, 100, { cars: 2, start: (k, _r, place) => spot(k, () => s0 / realTrack.length, place) });
      impacts += h.impacts;
      touches += h.touches;
      height = Math.max(height, h.height);
      tilt = Math.max(tilt, h.tilt);
    }
    return `10 minutes each for two cars, ${impacts} impacts, ${touches} steps in contact with each other, never more than ${(height * 100).toFixed(0)} cm off the road, most tilt ${tilt.toFixed(1)}°`;
  });
}

/** Aim a car at an edge and see that no part of it gets past. */
function approaches(track, count, seed, where) {
  const rnd = random(seed);
  const place = { x: 0, y: 0, z: 0, yaw: 0 };
  const sink = [];
  let worst = -Infinity, hits = 0, kept = 0, keptN = 0, lost = 0, lostN = 0;
  for (let n = 0; n < count; n++) {
    const car = new Vehicle(track);
    const frame = where(rnd);
    const angle = rnd() * Math.PI * 2; // every way, backwards and sideways included
    const speed = (20 + rnd() * 230) / KMH;
    place.x = frame.x;
    place.z = frame.z;
    place.yaw = frame.yaw + (rnd() < 0.7 ? angle : rnd() * Math.PI * 2);
    car.reset(place);
    const heading = frame.yaw + angle;
    car.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    car.angularVelocity.y = (rnd() - 0.5) * 2;
    for (const w of car.wheels) w.omega = (car.velocity.x * car._fx + car.velocity.z * car._fz) / w._spec.radius;
    const c = controls();
    c.steer = rnd() * 2 - 1;
    c.throttle = rnd() < 0.6 ? 1 : 0;
    c.brake = rnd() < 0.2 ? 1 : 0;
    let first = 0, closing = 0;
    for (let i = 0; i < 300; i++) {
      const before = car.velocity.length();
      car.step(DT, c);
      check(finite(car), `NaN in approach ${n} (seed ${seed})`);
      const beyond = beyondEdge(car);
      worst = Math.max(worst, beyond);
      check(beyond < 0.02, `approach ${n} (seed ${seed}): ${(speed * KMH).toFixed(0)} km/h at ${(angle * DEG).toFixed(0)}° is ${beyond.toFixed(3)} m through the edge after ${i} steps`);
      const height = heightAbove(car);
      check(height < 0.6 && height > -0.25, `approach ${n} (seed ${seed}): thrown ${height.toFixed(2)} m off the road`);
      check(car._uy > 0.7, `approach ${n} (seed ${seed}): tipped over`);
      if (car.impacts.length && !first) {
        first = i + 1;
        closing = car.impacts[0].strength;
        hits++;
        // what a first touch costs: little when glancing, a lot when square
        car.drainImpacts(sink);
        sink.length = 0;
        const fraction = closing / before;
        const after = car.velocity.length();
        if (fraction < 0.15 && before > 15) { kept += after / before; keptN++; }
        if (fraction > 0.9 && before > 15) { lost += after / before; lostN++; }
      }
      car.drainImpacts(sink);
      sink.length = 0;
    }
    check(beyondEdge(car) < 0.02, 'left inside an edge');
  }
  return { worst, hits, glancing: keptN ? kept / keptN : NaN, square: lostN ? lost / lostN : NaN };
}

test('2000 approaches to a wall at 20-250 km/h from every angle: nothing gets through; glancing is cheap, square is dear', () => {
  const corridor = createPlane({ edge: 7, kind: EDGE.WALL });
  const r = approaches(corridor, 2000, 5, (rnd) => ({ x: (rnd() * 2 - 1) * 4, z: 0, yaw: 0 }));
  check(r.hits > 1500, `only ${r.hits} of them hit`);
  check(r.glancing > 0.85, `a glancing touch leaves only ${(r.glancing * 100).toFixed(0)} % of the speed`);
  check(r.square < 0.35, `a square hit leaves ${(r.square * 100).toFixed(0)} % of the speed`);
  return `${r.hits} hits, deepest ${(Math.max(r.worst, 0) * 1000).toFixed(1)} mm; a glancing first touch leaves ${(r.glancing * 100).toFixed(0)} % of the speed, a square one ${(r.square * 100).toFixed(0)} %`;
});

test('1500 approaches to the rail of a tight bend (20 m radius), inside and outside', () => {
  const circle = createCircle(20, { edge: 6, kind: EDGE.RAIL });
  const r = approaches(circle, 1500, 9, (rnd) => {
    const i = Math.floor(rnd() * circle.count);
    const lat = (rnd() * 2 - 1) * 3.5;
    return { x: circle.px[i] + circle.lx[i] * lat, z: circle.pz[i] + circle.lz[i] * lat, yaw: Math.atan2(circle.tx[i], circle.tz[i]) };
  });
  check(r.hits > 1000, `only ${r.hits} of them hit`);
  return `${r.hits} hits, deepest ${(Math.max(r.worst, 0) * 1000).toFixed(1)} mm`;
});

if (realTrack) {
  test('3000 approaches to the edges of the real road, all round the lap', () => {
    const frame = {};
    const r = approaches(realTrack, 3000, 13, (rnd) => {
      realTrack.frameAt(rnd() * realTrack.length, frame);
      const lat = (rnd() * 2 - 1) * 2.5;
      return { x: frame.pos.x + frame.left.x * lat, z: frame.pos.z + frame.left.z * lat, yaw: Math.atan2(frame.tan.x, frame.tan.z) };
    });
    check(r.hits > 2000, `only ${r.hits} of them hit`);
    return `${r.hits} hits, deepest ${(Math.max(r.worst, 0) * 1000).toFixed(1)} mm`;
  });

  test('the stand-in roads number surfaces and edges as the real one does', () => {
    for (const key of Object.keys(SURFACE)) check(SURFACE[key] === realModule.SURFACE[key], `SURFACE.${key} differs`);
    for (const key of Object.keys(EDGE)) check(EDGE[key] === realModule.EDGE[key], `EDGE.${key} differs`);
    check(CAR.surfaces.length === Object.keys(realModule.SURFACE).length, 'vehicle/params.js has no entry for some SURFACE');
    check(CAR.edges.kinds.length === Object.keys(realModule.EDGE).length, 'vehicle/params.js has no entry for some EDGE');
  });
}

/** Overlap of two cars' boxes on the ground (m along the axis of least overlap; negative = apart). */
function overlap(a, b) {
  const boxes = [a, b].map((car) => {
    const box = car.params.box;
    const mid = (box.front + box.rear) / 2;
    const f = Math.hypot(car._fx, car._fz);
    const fx = car._fx / f, fz = car._fz / f;
    return { cx: car.position.x + fx * mid, cz: car.position.z + fz * mid, fx, fz, lx: fz, lz: -fx, half: (box.front - box.rear) / 2, wide: box.halfWidth };
  });
  const reach = (box, x, z) => Math.abs(box.fx * x + box.fz * z) * box.half + Math.abs(box.lx * x + box.lz * z) * box.wide;
  let least = Infinity;
  for (const box of boxes) {
    for (const [x, z] of [[box.fx, box.fz], [box.lx, box.lz]]) {
      const gap = Math.abs((boxes[0].cx - boxes[1].cx) * x + (boxes[0].cz - boxes[1].cz) * z);
      least = Math.min(least, reach(boxes[0], x, z) + reach(boxes[1], x, z) - gap);
    }
  }
  return least;
}

test('car against car: 1500 meetings at closing speeds up to 100 m/s, none passes through', () => {
  const rnd = random(31);
  const plane = createPlane();
  let hits = 0, hardest = 0, deepest = 0;
  for (let n = 0; n < 1500; n++) {
    const a = new Vehicle(plane), b = new Vehicle(plane);
    // a runs up +Z; b comes at it from some bearing, aimed to cross a's path where a will be
    const va = rnd() * 60;
    const bearing = rnd() * Math.PI * 2;
    const vb = 5 + rnd() * 60;
    const time = Math.max(0.25 + rnd() * 0.5, 9 / (va + vb)); // far enough apart to start with
    const miss = (rnd() * 2 - 1) * 1.6; // sideways error of the aim, so that corners and flanks get hit too
    a.reset({ x: 0, z: -va * time, yaw: 0 });
    const bx = Math.sin(bearing) * vb * time + Math.cos(bearing) * miss;
    const bz = Math.cos(bearing) * vb * time - Math.sin(bearing) * miss;
    b.reset({ x: bx, z: bz, yaw: bearing + Math.PI });
    a.velocity.set(0, 0, va);
    b.velocity.set(-Math.sin(bearing) * vb, 0, -Math.cos(bearing) * vb);
    for (const w of a.wheels) w.omega = va / w._spec.radius;
    for (const w of b.wheels) w.omega = vb / w._spec.radius;
    const ca = controls(), cb = controls();
    const head = Math.cos(bearing) > 0.966 && Math.abs(miss) < 0.5; // nose to nose, within 15°, with no room to pass
    const sideBefore = Math.sign(b.position.z - a.position.z);
    let met = false, sink = [];
    for (let i = 0; i < 180; i++) {
      const pBefore = { x: a.velocity.x + b.velocity.x, z: a.velocity.z + b.velocity.z };
      const eBefore = a.velocity.lengthSq() + b.velocity.lengthSq() + (a.angularVelocity.y ** 2 + b.angularVelocity.y ** 2) * (CAR.inertia.y / CAR.mass);
      a.step(DT, ca);
      b.step(DT, cb);
      const p0 = { x: a.velocity.x + b.velocity.x, z: a.velocity.z + b.velocity.z };
      const e0 = a.velocity.lengthSq() + b.velocity.lengthSq() + (a.angularVelocity.y ** 2 + b.angularVelocity.y ** 2) * (CAR.inertia.y / CAR.mass);
      const closing = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.z - b.velocity.z);
      const before = overlap(a, b);
      if (collideVehicles(a, b)) {
        met = true;
        deepest = Math.max(deepest, before);
        hardest = Math.max(hardest, closing);
        const p1 = { x: a.velocity.x + b.velocity.x, z: a.velocity.z + b.velocity.z };
        const e1 = a.velocity.lengthSq() + b.velocity.lengthSq() + (a.angularVelocity.y ** 2 + b.angularVelocity.y ** 2) * (CAR.inertia.y / CAR.mass);
        check(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 1e-6 * (1 + Math.hypot(p0.x, p0.z)), `meeting ${n}: momentum changed`);
        check(e1 <= e0 * (1 + 1e-9), `meeting ${n}: the collision made energy`);
        check(overlap(a, b) < 0.01, `meeting ${n}: still ${overlap(a, b).toFixed(3)} m inside each other after being parted`);
      }
      check(finite(a) && finite(b), `NaN in meeting ${n}`);
      check(Number.isFinite(pBefore.x + eBefore), 'NaN');
      a.drainImpacts(sink);
      b.drainImpacts(sink);
      sink.length = 0;
      // nose to nose: for the moment after, whoever was further up the road still is
      if (head && met && i < time * 120 + 30) check(Math.sign(b.position.z - a.position.z) === sideBefore, `meeting ${n}: passed through (bearing ${(bearing * DEG).toFixed(0)}°, ${va.toFixed(0)} and ${vb.toFixed(0)} m/s)`);
    }
    if (met) hits++;
  }
  check(hits > 900, `only ${hits} met`);
  check(hardest > 95, `hardest meeting only ${hardest.toFixed(0)} m/s`);
  return `${hits} met, up to ${hardest.toFixed(0)} m/s closing, deepest overlap in a step ${deepest.toFixed(2)} m`;
});

test('the same run twice is the same run', () => {
  const run = () => {
    const track = realTrack || createOval(260, 32, { edge: 6.5 });
    const h = hammer(track, 77, 20, { cars: 2 });
    return h;
  };
  const first = JSON.stringify(run()), second = JSON.stringify(run());
  check(first === second, 'two identical runs differ');
});

test('no objects are made while stepping', () => {
  let collect;
  try {
    v8.setFlagsFromString('--expose-gc');
    collect = vm.runInNewContext('gc');
  } catch {
    return 'skipped: no access to the collector';
  }
  const track = realTrack || createOval(260, 32, { edge: 6.5 });
  const driver = new AutoDriver(track, { pace: 0.9 });
  const a = new Vehicle(track), b = new Vehicle(track);
  a.reset(track.grid(0, {}));
  b.reset(track.grid(1, {}));
  const ca = controls(), cb = controls();
  const lap = (steps) => {
    for (let i = 0; i < steps; i++) {
      driver.drive(a, DT, ca);
      cb.throttle = 1; // b just ploughs along the edge, so that the edge code runs too
      cb.steer = 0.2;
      a.step(DT, ca);
      b.step(DT, cb);
      collideVehicles(a, b); // (the impact lists are left to fill up: reporting an impact may allocate, stepping may not)
    }
  };
  lap(20000); // warm: everything compiled
  collect();
  const before = process.memoryUsage().heapUsed;
  lap(60000);
  // Collect before reading the heap: the engine boxes the odd number as it steps (Math.hypot's results, for one),
  // which is its business, and how much of that happens to lie uncollected at this moment says nothing (it read
  // 86 bytes a step on one road and 261 on another for the same code). What must not grow is what is KEPT: an
  // object, an array or a closure held per step would be hundreds of bytes a step here.
  collect();
  const grown = process.memoryUsage().heapUsed - before;
  check(grown < 150 * 60000, `${(grown / 60000).toFixed(1)} bytes per step were kept`);
  return `${(grown / 60000).toFixed(1)} bytes per step kept over 60 000 steps of two cars`;
});

test('forgiving: full key lock at 150 to 280 km/h, either way, never spins the car', () => {
  const notes = [];
  for (const kmh of [150, 200, 250, 280]) {
    for (const way of [1, -1]) {
      const r = M.fullLockAt(kmh, 3, CAR, way);
      check(!r.spun && r.mostSlip < 8, `full lock at ${kmh} km/h: slid ${r.mostSlip.toFixed(1)}°${r.spun ? ', spun' : ''}`);
      check(Math.abs(r.turned) > 20, `full lock at ${kmh} km/h turned the car only ${r.turned.toFixed(0)}°`);
      if (way > 0) notes.push(`${kmh}: ${r.mostSlip.toFixed(1)}°`);
    }
  }
  return `most body slip with a key held over for 3 s: ${notes.join(', ')}`;
});

test('forgiving: a rail touched at a shallow angle at speed keeps 90 % and lays the car along it', () => {
  const notes = [];
  for (const [kmh, angle] of [[100, 10], [200, 5], [250, 8]]) {
    const t = M.railTouch(kmh, angle);
    check(t.least >= 0.9, `${angle}° at ${kmh} km/h keeps only ${(t.least * 100).toFixed(0)} %`);
    check(t.parallel < 0.3, `${angle}° at ${kmh} km/h: along the rail after ${t.parallel} s`);
    notes.push(`${angle}° at ${kmh}: ${(t.least * 100).toFixed(0)} %`);
  }
  return notes.join(', ');
});

// ---- the drivers ---------------------------------------------------------------------------------------------

test('a key is turned into steering that fits the speed; a stick is only given the lock', () => {
  const keys = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false };
  const input = { read: (out) => Object.assign(out, keys) };
  const car = M.makeCar();
  const driver = new PlayerDriver(input, 'all', null);
  const out = controls();
  const lock = CAR.steering.lock;
  within(M.lockAt(4), lock * DEG - 0.01, lock * DEG + 0.01, 'key held at walking pace (°)');
  within(M.lockAt(40), 16, 22, 'key held at 40 km/h (°)');
  // (at speed the rear wheels take a share of the angle: what counts is the fronts' angle less theirs)
  const share = 1 - car.rearShare(200 / KMH);
  within(M.lockAt(200) * share, 3, 4.5, 'key held at 200 km/h, less the rear wheels\' share (°)');
  within(M.lockAt(200, true) * share, 3, 4.5, 'stick held over at 200 km/h, less the rear wheels\' share (°)');
  within(car.rearShare(60 / KMH), 0, 0, 'rear-wheel steering at 60 km/h');
  within(car.rearShare(250 / KMH), 0.3, 0.55, 'rear-wheel steering at 250 km/h (share of the fronts\' angle)');
  check(Math.abs(M.lockAt(100) - M.lockAt(100, true)) < 1e-9, 'a key and a stick are given different locks');
  // the ramp: a tap gives a little, and it comes back
  car.velocity.set(0, 0, 200 / KMH);
  car._sync();
  for (let i = 0; i < 240; i++) driver.drive(car, DT, out);
  check(Math.abs(out.steer) < 1e-9, 'does not centre on release');
  keys.steer = -1;
  for (let i = 0; i < 6; i++) driver.drive(car, DT, out); // 50 ms
  check(out.steer < 0 && out.steer > -0.25 * (M.lockAt(200) / DEG / lock), 'a 50 ms tap at 200 km/h is more than a quarter of the lock');
  // pedals: ramped from keys, passed from a stick
  Object.assign(keys, { steer: 0, throttle: 1, brake: 0, analog: false });
  driver.drive(car, DT, out);
  check(out.throttle > 0 && out.throttle < 0.2, 'a key gives full throttle at once');
  for (let i = 0; i < 9; i++) driver.drive(car, DT, out); // 80 ms: a tap is a dab, part of the pedal
  check(out.throttle >= 0.55 && out.throttle < 0.75, `a tap of the throttle key gives ${out.throttle}`);
  for (let i = 0; i < 40; i++) driver.drive(car, DT, out);
  check(out.throttle === 1, 'the throttle does not arrive');
  Object.assign(keys, { throttle: 0.37, brake: 0.21, analog: true, handbrake: true });
  driver.drive(car, DT, out);
  check(out.throttle === 0.37 && out.brake === 0.21 && out.handbrake === 1, 'a stick is not passed through');
});

test('keys: the yaw arrives in 0.15 to 0.25 s at 80 km/h and goes in under 0.35 s; a held key holds a steady line', () => {
  const k = M.keyResponse(80);
  within(k.rise, 0.15, 0.25, 'key down to 90 % of the yaw rate at 80 km/h (s)');
  within(k.release, 0, 0.35, 'key up to under 10 % of the yaw rate (s)');
  within(k.steadyG, 1.15, 1.32, 'lateral g with the key held at 80 km/h');
  for (const kmh of [40, 110, 140]) {
    const h = M.keyResponse(kmh, CAR, 4);
    within(h.steadyG, 1.1, 1.35, `lateral g with the key held at ${kmh} km/h`);
    check(h.swing < 0.1, `a key held at ${kmh} km/h swings the car by ${h.swing.toFixed(2)} g`);
  }
  return `${k.rise.toFixed(2)} s on, ${k.release.toFixed(2)} s off, ${k.steadyG.toFixed(2)} g`;
});

test('keys: a tap at 200 km/h does not saw; the brake key stops in 33 m or less and still steers; the throttle key does not spin it', () => {
  for (const ms of [50, 100, 200]) {
    const t = M.keyTap(200, ms);
    check(t.reversals <= 2 && t.late < 0.01, `a ${ms} ms tap at 200 km/h: ${t.reversals} reversals, still yawing ${t.late.toFixed(4)} rad/s a second on`);
    check(Math.abs(t.heading) < (ms > 100 ? 3.5 : 1.5), `a ${ms} ms tap at 200 km/h turns the car ${t.heading.toFixed(2)}°`);
  }
  const b = M.brakeKey(100), bs = M.brakeKey(100, -1);
  within(b.distance, 24, 33, 'brake key, 100-0 km/h (m)');
  check(bs.heading > 30, `steering under the brake key turns the car only ${bs.heading.toFixed(0)}°`);
  const l = M.launchKey(0), ll = M.launchKey(1);
  check(l.kmh > 65 && ll.mostSlip < 8 && ll.kmh > 20, `throttle key from rest: ${l.kmh.toFixed(0)} km/h; with full lock ${ll.kmh.toFixed(0)} km/h, slid ${ll.mostSlip.toFixed(1)}°`);
  return `brake key ${b.distance.toFixed(1)} m`;
});

test('keys: the handbrake turns the car by as much as it is pulled, and the car drives on', () => {
  const short = M.handbrakeKeys(60, 0.2), mid = M.handbrakeKeys(60, 0.3), fast = M.handbrakeKeys(100, 0.3);
  check(short.turned > 20 && short.turned < mid.turned, `60 km/h: 0.2 s turns ${short.turned.toFixed(0)}°, 0.3 s ${mid.turned.toFixed(0)}°`);
  within(mid.turned, 35, 120, 'a 0.3 s pull at 60 km/h (°)');
  // (the default assist level catches a handbrake pull at speed sooner than the bare car did: 34° at 100 km/h)
  within(fast.turned, 25, 150, 'a 0.3 s pull at 100 km/h (°)');
  check(mid.endKmh > 40 && fast.endKmh > 20, `after the turn: ${mid.endKmh.toFixed(0)} and ${fast.endKmh.toFixed(0)} km/h`);
  return `${short.turned.toFixed(0)}° and ${mid.turned.toFixed(0)}° at 60 km/h, ${fast.turned.toFixed(0)}° at 100 km/h`;
});

test('the gearbox does not hunt: a key worked on and off, a long hill held by the brake', () => {
  const h = M.gearHunt();
  check(h.keyShifts <= 2 && h.hillShifts <= 2, `${h.keyShifts} shifts with the key, ${h.hillShifts} down the hill in 15 s`);
});

test('the tyres squeal from 80 to 90 % of the grip; the stability control knows the car', () => {
  for (const kmh of [60, 110]) within(M.squealOnset(kmh).onset, 0.78, 0.92, `squeal onset at ${kmh} km/h (fraction of the most g)`);
  const v = M.characteristicSpeed();
  within(CAR.assists.esc.characteristicSpeed / v, 0.9, 1.1, 'the stability control\'s characteristic speed against the car\'s');
  const l = M.bend(90, 0.9, (c) => { c.throttle = 0; });
  check(l.after.radius < l.before.radius && !l.spun && Math.abs(l.mostSlip) < 6, `lift-off at 0.9 g: radius ${l.before.radius.toFixed(0)} -> ${l.after.radius.toFixed(0)} m, slip ${l.mostSlip.toFixed(1)}°`);
  return `characteristic speed ${v.toFixed(1)} m/s`;
});

test('rails: a 10° touch at 100 km/h keeps 90 % and lays the car along it, one knock; a 45° hit at 80 can be driven away', () => {
  const t = M.railTouch(100, 10);
  check(t.least >= 0.9, `keeps only ${(t.least * 100).toFixed(0)} %`);
  check(t.parallel < 0.3, `along the rail after ${t.parallel} s`);
  check(t.impacts === 1, `${t.impacts} impacts reported for one touch`);
  check(t.endKmh > 85 && t.away > 1, `steered off at ${t.endKmh.toFixed(0)} km/h, ${t.away.toFixed(1)} m from the rail`);
  const h = M.railTouch(80, 45);
  check(h.least > 0.3 && h.least < 0.8, `a 45° hit keeps ${(h.least * 100).toFixed(0)} %`);
  check(h.parallel < 0.7 && h.endKmh > 40 && h.away > 1, `after a 45° hit: along the rail in ${h.parallel} s, ${h.endKmh.toFixed(0)} km/h, ${h.away.toFixed(1)} m off`);
  return `${(t.least * 100).toFixed(0)} % kept at 10°, ${(h.least * 100).toFixed(0)} % at 45°`;
});

test('left and right mirror exactly; a step of 1/240 s drives as 1/120 s does', () => {
  const run = (way, dt, level) => {
    const car = M.makeCar();
    if (level !== undefined) car.setAssists(level);
    const c = M.cruise(car, 22);
    const trace = [];
    for (let i = 0; i < Math.round(3 / dt); i++) {
      const t = i * dt;
      c.steer = way * (t < 1.5 ? -0.35 * Math.sin(2 * Math.PI * 0.8 * t) : -0.5);
      c.brake = t > 1.5 && t < 2.2 ? 0.7 : 0;
      c.throttle = t > 2.2 ? 1 : 0.2;
      car.step(dt, c);
      trace.push({ x: car.position.x * way, z: car.position.z, yaw: car.yaw * way });
    }
    return trace;
  };
  // (mirrored with all the help of the default level; the two step sizes on the bare car, level Off: what a slide
  // the help is holding does next hangs on thresholds, and is not a fair test of the integration)
  const left = run(1, DT), right = run(-1, DT);
  const bare = ASSISTS.levels.off;
  const coarse = run(1, DT, bare), fine = run(1, DT / 2, bare);
  let mirror = 0, yawDiff = 0;
  for (let i = 0; i < left.length; i++) {
    mirror = Math.max(mirror, Math.abs(left[i].x - right[i].x), Math.abs(left[i].yaw - right[i].yaw));
    yawDiff = Math.max(yawDiff, Math.abs(coarse[i].yaw - fine[2 * i + 1].yaw) * DEG);
  }
  check(mirror < 1e-9, `left and right differ by ${mirror}`);
  check(yawDiff < 1, `heading at 1/120 s and 1/240 s differs by ${yawDiff.toFixed(2)}°`);
  return `${mirror.toExponential(1)} between the two sides, ${yawDiff.toFixed(2)}° between the steps`;
});

/** Laps by the autopilot: the times, and what it touched. */
function laps(track, pace, count, bias = 0) {
  const driver = new AutoDriver(track, { pace, bias });
  const car = new Vehicle(track);
  car.reset(track.grid(0, {}));
  const c = controls();
  const sink = [];
  const times = [];
  let t = 0, started = 0, last = car.s, impacts = 0, off = -Infinity, slip = 0;
  while (times.length < count + 2 && t < 400 * (count + 2)) {
    driver.drive(car, DT, c);
    car.step(DT, c);
    t += DT;
    check(finite(car), 'NaN');
    impacts += car.impacts.length;
    car.drainImpacts(sink);
    sink.length = 0;
    off = Math.max(off, Math.abs(car.lat) + car.params.box.halfWidth - track.halfWidth);
    if (car.speed > 8) slip = Math.max(slip, Math.abs(Math.atan2(car.velocity.x * car._lx + car.velocity.z * car._lz, car.speed)) * DEG);
    if (car.s < last - track.length / 2) {
      times.push(t - started);
      started = t;
    }
    last = car.s;
  }
  times.splice(0, 2); // the run from the grid to the line, and the lap that began from rest
  return { times, impacts, off, slip };
}

test('the autopilot laps the stand-in oval cleanly', () => {
  const r = laps(createOval(300, 40), 0.9, 5);
  check(r.times.length === 5, 'did not finish');
  check(r.impacts === 0, `${r.impacts} impacts`);
  check(r.off < 0, `put the body ${r.off.toFixed(2)} m off the pavement`);
  check(Math.max(...r.times) - Math.min(...r.times) < 0.2, `lap times wander: ${r.times.map((x) => x.toFixed(2))}`);
});

if (realTrack) {
  test('the autopilot laps the real road cleanly, again and again, at every pace', () => {
    const notes = [];
    for (const pace of [0.7, 0.9, 1]) {
      const count = pace === 0.9 ? 12 : 3;
      const r = laps(realTrack, pace, count);
      check(r.times.length === count, `pace ${pace}: did not finish`);
      check(r.impacts === 0, `pace ${pace}: ${r.impacts} impacts`);
      // (the kerbs are part of the course: the line may use them, never the grass)
      check(r.off < realTrack.shoulder, `pace ${pace}: the body was ${r.off.toFixed(2)} m off the pavement, past the kerbs`);
      check(r.slip < 9, `pace ${pace}: slid to ${r.slip.toFixed(1)}°`);
      check(Math.max(...r.times) - Math.min(...r.times) < 0.5, `pace ${pace}: lap times wander: ${r.times.map((x) => x.toFixed(2))}`);
      notes.push(`${pace}: ${r.times[r.times.length - 1].toFixed(1)} s`);
    }
    return notes.join(', ');
  });

  test('a thumb (full throttle unless braking), a pad and keys lap the real road cleanly', () => {
    const notes = [];
    for (const kind of ['thumb', 'pad', 'keys']) {
      const r = M.laps(realTrack, kind, { pace: 1, count: 1 });
      check(r.finite && r.times.length === 1, `${kind}: did not finish`);
      check(r.impacts === 0, `${kind}: ${r.impacts} impacts`);
      check(r.off < realTrack.shoulder, `${kind}: the body was ${r.off.toFixed(2)} m off the pavement, past the kerbs`);
      check(r.slip < 9, `${kind}: slid to ${r.slip.toFixed(1)}°`);
      notes.push(`${kind} ${r.best.toFixed(1)} s`);
    }
    return notes.join(', ');
  });

  test('a ham-fisted keyboard driver laps the real road flat out and never touches a barrier', () => {
    const r = M.laps(realTrack, 'hamfist', { count: 2 });
    check(r.finite && r.times.length === 2, 'did not finish');
    check(r.impacts === 0, `${r.impacts} impacts`);
    // (held keys and the brake key make the default level's slides: the car may put itself on the verge, never further)
    check(r.off < 3, `the body was ${r.off.toFixed(2)} m off the pavement`);
    check(r.slip < 30, `slid to ${r.slip.toFixed(1)}°`);
    return `${r.times.map((x) => x.toFixed(1)).join(', ')} s, body ${r.off.toFixed(2)} m beyond the pavement at most, ${r.slip.toFixed(1)}° of slip`;
  });

  test('the crest: the car goes light at the autopilot\'s pace, but every wheel stays on the road', () => {
    const notes = [];
    for (const pace of [1, 0.9]) {
      const driver = new AutoDriver(realTrack, { pace });
      const car = new Vehicle(realTrack);
      car.reset(realTrack.grid(0, {}));
      const c = controls();
      const crest = [realTrack.at('crest', 0.5), realTrack.at('plunge', 0.25)];
      let least = Infinity, lightest = Infinity, t = 0, laps = 0, last = car.s;
      while (laps < 2 && t < 400) {
        driver.drive(car, DT, c);
        car.step(DT, c);
        t += DT;
        if (car.s < last - realTrack.length / 2) laps++;
        last = car.s;
        if (laps < 1) continue;
        let total = 0;
        for (const w of car.wheels) {
          least = Math.min(least, w.load / w._spec.staticLoad);
          total += w.load;
        }
        if (car.s > crest[0] && car.s < crest[1]) lightest = Math.min(lightest, total / (CAR.mass * CAR.gravity));
      }
      check(least > 0.05, `pace ${pace}: a wheel was down to ${(least * 100).toFixed(0)} % of its load`);
      check(lightest < 0.8, `pace ${pace}: the car is not light over the crest (${(lightest * 100).toFixed(0)} % of its weight)`);
      notes.push(`pace ${pace}: ${(lightest * 100).toFixed(0)} % of the weight over the crest, no wheel under ${(least * 100).toFixed(0)} %`);
    }
    return notes.join('; ');
  });

  test('two autopilots side by side do not touch', () => {
    const a = new Vehicle(realTrack), b = new Vehicle(realTrack);
    const da = new AutoDriver(realTrack, { pace: 0.85, bias: 1.3 }), db = new AutoDriver(realTrack, { pace: 0.85, bias: -1.3 });
    a.reset(realTrack.grid(0, {}));
    b.reset(realTrack.grid(1, {}));
    const ca = controls(), cb = controls();
    let touches = 0, impacts = 0, closest = Infinity;
    for (let i = 0; i < 120 * 300; i++) {
      da.drive(a, DT, ca);
      db.drive(b, DT, cb);
      a.step(DT, ca);
      b.step(DT, cb);
      if (collideVehicles(a, b)) touches++;
      impacts += a.impacts.length + b.impacts.length;
      a.impacts.length = b.impacts.length = 0;
      closest = Math.min(closest, -overlap(a, b));
    }
    check(touches === 0 && impacts === 0, `${touches} touches, ${impacts} impacts`);
    return `never closer than ${closest.toFixed(2)} m in 5 minutes`;
  });
}

console.log(failures ? `\n${failures} of ${results.length} failed` : `\nall ${results.length} passed`);
if (failures) process.exitCode = 1;
