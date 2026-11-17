// The promises about sliding, the assist levels and the hands of each device (tools/unit/drift.mjs measures them).
// Plain script: exits non-zero when one is broken. Run by tools/unit.mjs.

import { ASSISTS } from '../../src/game/config.js';
import { createTrack } from '../../src/game/track.js';
import * as D from './drift.mjs';
import * as M from './manoeuvres.mjs';

const L = ASSISTS.levels;
let failures = 0;
const results = [];
function test(name, fn) {
  const before = failures;
  let note = '';
  try {
    note = fn() || '';
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  results.push(name);
  console.log(`  ${failures === before ? 'ok  ' : 'FAIL'}  ${name}${note ? `: ${note}` : ''}`);
}
function check(ok, message) {
  if (!ok) {
    failures++;
    console.log(`      ${message}`);
  }
}
const f = (v, d = 1) => Number(v).toFixed(d);
const track = createTrack();

test('three assist levels; a new car and a new driver get the default', () => {
  check(['road', 'sport', 'off'].every((k) => L[k] && L[k].name), 'levels road, sport, off with names');
  check(ASSISTS.default === 'road', `default is ${ASSISTS.default}`);
  const car = M.makeCar();
  check(car.level === L.road, 'a new car is not on the default level');
  check(L.off.hold === 0 && !L.off.tc && !L.off.esc, 'off is not the bare model');
  return `road slides to ${f((L.road.slip * 180) / Math.PI, 0)} deg, sport to ${f((L.sport.slip * 180) / Math.PI, 0)} deg (both narrowing above 126 km/h)`;
});

test('road: hard to spin. A handbrake pull at 90 and 140 km/h is caught under 25 deg; a slide is caught by letting go', () => {
  const notes = [];
  for (const kmh of [90, 140]) {
    const r = D.handbrakePull(kmh, 0.4, { level: L.road });
    check(!r.spun && Math.abs(r.mostSlip) < 25 && Math.abs(r.mostSlip) > 8, `${kmh} km/h: ${f(r.mostSlip)} deg`);
    check(Math.abs(r.endSlip) < 3, `${kmh} km/h: still ${f(r.endSlip)} deg sideways 3.6 s later`);
    notes.push(`${kmh}: ${f(Math.abs(r.mostSlip))} deg`);
  }
  // the bare car, the same pull: it spins round
  const off = D.handbrakePull(140, 0.4, { level: L.off });
  check(Math.abs(off.mostSlip) > 60, `off: only ${f(off.mostSlip)} deg`);
  return `${notes.join(', ')}; off ${f(Math.abs(off.mostSlip))} deg`;
});

test('road: full lock and full throttle at 140 km/h with brake stabs never spins the car', () => {
  const r = D.inBend(140, 150, (c, t) => {
    c.steer = Math.sin(t * 3) > 0 ? -1 : 1;
    c.throttle = 1;
    c.brake = Math.sin(t * 5) > 0.7 ? 1 : 0;
  }, { level: L.road, seconds: 6 });
  check(!r.spun && Math.abs(r.mostSlip) < 30, `slid to ${f(r.mostSlip)} deg`);
  return `${f(Math.abs(r.mostSlip))} deg at most`;
});

test('sport: a slide of about 25 deg is started by power, by a brake at turn-in and by the handbrake, and held by every device', () => {
  const notes = [];
  for (const device of ['keys', 'thumb', 'pad']) {
    for (const start of ['power', 'brake']) {
      const r = D.driftHold(25, { level: L.sport, device, start, kmh: start === 'brake' ? 100 : 60 });
      check(!r.spun && r.best >= 2.5, `${device}, ${start}: held ${f(r.best)} s (most ${f(r.most, 0)} deg)`);
      check(r.snap < 12, `${device}, ${start}: snapped ${f(r.snap, 0)} deg the other way on the exit`);
      if (start === 'power') notes.push(`${device} ${f(r.best)} s`);
    }
    const hb = D.driftHold(25, { level: L.sport, device, start: 'handbrake', kmh: 60 });
    check(!hb.spun && hb.most > 20, `${device}, handbrake: only ${f(hb.most, 0)} deg`);
  }
  return `held at 25 deg from power: ${notes.join(', ')}`;
});

test('sport lets a slide reach 30 deg and more, and still catches it', () => {
  const r = D.driftHold(35, { level: L.sport, device: 'pad', start: 'power', kmh: 60 });
  check(r.most >= 30 && !r.spun, `most ${f(r.most, 0)} deg${r.spun ? ', spun' : ''}`);
  return `${f(r.most, 0)} deg`;
});

test('road: every device throws the car into the carousel and the long right with the handbrake and drives on without a touch', () => {
  const notes = [];
  for (const kind of ['keys', 'thumb', 'pad']) {
    for (const piece of ['carousel', 'back']) {
      const r = D.trackDrift(track, kind, piece, { level: L.road });
      check(r.impacts === 0, `${kind}, ${piece}: ${r.impacts} impacts`);
      check(r.most > 10, `${kind}, ${piece}: only ${f(r.most, 0)} deg sideways`);
      notes.push(`${kind} ${piece} ${f(r.most, 0)} deg`);
    }
  }
  return notes.join(', ');
});

test('sliding costs time, but little: a lap with both drifts on the road level against a tidy one', () => {
  const notes = [];
  for (const kind of ['keys', 'thumb', 'pad']) {
    const tidy = M.laps(track, kind, { count: 1, pace: 1 });
    const slid = D.trackDriftLap(track, kind, ['carousel', 'back'], { level: L.road });
    check(slid.impacts === 0, `${kind}: ${slid.impacts} impacts`);
    check(slid.time - tidy.best < 4, `${kind}: sliding cost ${f(slid.time - tidy.best, 2)} s`);
    notes.push(`${kind} ${f(slid.time - tidy.best, 2)} s`);
  }
  return notes.join(', ');
});

test('people: a thumb and a pad with a person\'s lag, speed and shake lap within 8 % of the autopilot without a touch', () => {
  const auto = M.laps(track, 'auto', { count: 1, pace: 1 }).best;
  const notes = [];
  for (const device of ['thumb', 'pad']) {
    const r = M.laps(track, `human-${device}`, { count: 1 });
    check(r.finite && r.impacts === 0, `${device}: ${r.impacts} impacts`);
    check(r.off < track.shoulder, `${device}: ${f(r.off, 2)} m beyond the pavement`);
    check(r.best < auto * 1.08, `${device}: ${f(r.best)} s against the autopilot's ${f(auto)} s`);
    notes.push(`${device} ${f(r.best)} s`);
  }
  return `${notes.join(', ')} (autopilot ${f(auto)} s)`;
});

console.log(failures ? `\n${failures} failures in ${results.length} tests` : `\nall ${results.length} passed`);
if (failures) process.exitCode = 1;
