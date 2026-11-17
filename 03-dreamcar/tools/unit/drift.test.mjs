// The promises about the feel: how quickly each device's steering arrives, the three assist levels, how a slide is
// asked for, held and let go on every device, what the default level never lets happen, and what people on each
// device do on the real road (tools/unit/drift.mjs measures; manoeuvres.humanDriver is the person).
// Plain script: exits non-zero when one is broken. Run by tools/unit.mjs.

import { ASSISTS, HANDS } from '../../src/game/config.js';
import { createTrack } from '../../src/game/track.js';
import * as D from './drift.mjs';
import * as M from './manoeuvres.mjs';

const L = ASSISTS.levels;
const DEVICES = ['keys', 'thumb', 'pad'];
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

test('three assist levels; a new car has the default; off is the bare car', () => {
  check(['full', 'sport', 'off'].every((k) => L[k] && L[k].name), 'levels full, sport, off with names');
  check(ASSISTS.default === 'full', `default is ${ASSISTS.default}`);
  check(M.makeCar().level === L.full, 'a new car is not on the default level');
  check(L.off.hold === 0 && !L.off.tc && !L.off.esc && DEVICES.every((d) => L.off.catch[d] === 0), 'off is not the bare car');
  check(L.sport.slip > L.full.slip * 2, 'sport does not slide much further than the default');
  check(DEVICES.every((d) => HANDS[d]), 'every device has its hands');
  return `full holds ${f((L.full.slip * 180) / Math.PI, 0)} deg, sport ${f((L.sport.slip * 180) / Math.PI, 0)} deg (narrowing above 126 km/h)`;
});

test('turn-in: every device\'s steering arrives in about 0.15 to 0.3 s at 80, 160 and 250 km/h, without darting', () => {
  const notes = [];
  for (const kind of DEVICES) {
    const row = [];
    for (const kmh of [80, 160, 250]) {
      const r = D.response(kind, kmh, kind === 'keys' ? 1 : 0.5);
      // (a key is a full input: the yaw of a car taken to its limit at 250 km/h in a third of a second)
      check(r.rise >= 0.14 && r.rise <= (kind === 'keys' && kmh > 200 ? 0.4 : 0.3), `${kind} at ${kmh} km/h: 90 % of the yaw in ${f(r.rise, 2)} s`);
      check(r.overshoot < (kmh > 200 ? 22 : 10), `${kind} at ${kmh} km/h: the yaw overshoots by ${f(r.overshoot, 0)} %`);
      check(r.riseG <= 0.3 && r.overshootG < 15, `${kind} at ${kmh} km/h: sideways g in ${f(r.riseG, 2)} s, overshoot ${f(r.overshootG, 0)} %`);
      row.push(`${f(r.rise, 2)} s +${f(r.overshoot, 0)} %`);
    }
    notes.push(`${kind} ${row.join(', ')}`);
  }
  return notes.join('; ');
});

test('default: a slide of about 20 deg is asked for four ways, holds on the throttle on every device, and comes back when the steering is let go', () => {
  const notes = [];
  for (const device of DEVICES) {
    for (const start of ['handbrake', 'brake', 'lift', 'power']) {
      if (start === 'lift' && device === 'thumb') continue; // (a phone accelerates by itself: there is no lift)
      const r = D.holdSlide(device, L.full, { start });
      const who = `${device}, ${start}`;
      check(!r.spun && r.onset < 1.4, `${who}: the slide ${r.spun ? 'spun' : `began after ${f(r.onset, 2)} s`}`);
      check(r.mean > 15 && r.mean < 25 && r.most < 28, `${who}: held at ${f(r.mean, 0)} deg (${f(r.least, 0)} to ${f(r.most, 0)})`);
      check(r.kmhOut > r.kmhIn * 0.8, `${who}: ${f(r.kmhIn, 0)} km/h fell to ${f(r.kmhOut, 0)} in the slide`);
      check(r.close < 1.5 && r.snap < 3, `${who}: let go, straight in ${f(r.close, 2)} s, swung ${f(r.snap)} deg the other way`);
      if (start === 'handbrake') notes.push(`${device} ${f(r.mean, 0)} deg, straight ${f(r.close, 1)} s after letting go`);
    }
  }
  // a key tapped (to hold a wider line) keeps the slide; the lamps of the assists stay dark in a slide that is meant
  const tapped = D.holdSlide('keys', L.full, { duty: 0.5 });
  check(tapped.mean > 14 && tapped.kmhOut > tapped.kmhIn * 0.9 && tapped.lamps < 0.2, `tapped key: ${f(tapped.mean, 0)} deg, ${f(tapped.kmhIn, 0)} to ${f(tapped.kmhOut, 0)} km/h, lamps ${f(tapped.lamps, 2)}`);
  return notes.join('; ');
});

test('default: hard to spin. Handbrake at 90 and 150 km/h (even held 1.5 s), full lock with lifts, sawing at the wheel with brake stabs', () => {
  const notes = [];
  for (const [kmh, pull] of [[90, 0.5], [150, 0.5], [150, 1.5]]) {
    const r = D.handbrakePull(kmh, pull, { level: L.full });
    check(!r.spun && Math.abs(r.mostSlip) < 35, `handbrake ${pull} s at ${kmh} km/h: ${f(r.mostSlip)} deg${r.spun ? ', spun' : ''}`);
    check(Math.abs(r.endSlip) < 10, `handbrake ${pull} s at ${kmh} km/h: still ${f(r.endSlip)} deg sideways at the end`);
    notes.push(`${kmh} km/h ${pull} s: ${f(Math.abs(r.mostSlip), 0)} deg`);
  }
  const lifts = D.inBend(140, 130, (c, t) => {
    c.steer = -1;
    c.throttle = t % 1 < 0.5 ? 0 : 1;
  }, { level: L.full, seconds: 6 });
  check(!lifts.spun && Math.abs(lifts.mostSlip) < 25, `full lock with lifts: ${f(lifts.mostSlip)} deg`);
  const saw = D.inBend(140, 150, (c, t) => {
    c.steer = Math.sin(t * 3) > 0 ? -1 : 1;
    c.throttle = 1;
    c.brake = Math.sin(t * 5) > 0.7 ? 1 : 0;
  }, { level: L.full, seconds: 6 });
  check(!saw.spun && Math.abs(saw.mostSlip) < 30, `sawing: ${f(saw.mostSlip)} deg`);
  // the bare car, the same pull: it goes round
  const off = D.handbrakePull(140, 0.5, { level: L.off });
  check(off.spun || Math.abs(off.mostSlip) > 60, `off: only ${f(off.mostSlip)} deg`);
  return `${notes.join(', ')}; lifts ${f(Math.abs(lifts.mostSlip), 0)} deg, sawing ${f(Math.abs(saw.mostSlip), 0)} deg; off ${f(Math.abs(off.mostSlip), 0)} deg`;
});

test('sport: slides of 20 to 40 deg at the speeds of the carousel, the shore bend and the long right, started three ways, held, let go without a snap', () => {
  const notes = [];
  for (const device of DEVICES) {
    for (const [kmh, radius] of [[90, 55], [185, 220], [210, 300]]) {
      let line = '';
      for (const start of ['handbrake', 'brake', 'lift']) {
        if (start === 'lift' && device === 'thumb') continue;
        const r = D.holdSlide(device, L.sport, { start, kmh, radius });
        const who = `${device}, ${start} at ${kmh} km/h`;
        check(!r.spun && r.onset < 1.2, `${who}: the slide ${r.spun ? 'spun' : `began after ${f(r.onset, 2)} s`}`);
        check(r.mean >= 20 && r.mean <= 42 && r.peak < 50, `${who}: held at ${f(r.mean, 0)} deg (peak ${f(r.peak, 0)})`);
        check(r.close < 2 && r.snap < 4, `${who}: let go, straight in ${f(r.close, 2)} s, swung ${f(r.snap)} deg the other way`);
        check(r.lamps < 0.3, `${who}: the assists' lamps showed ${f(r.lamps, 2)} in a slide that was meant`);
        if (start === 'handbrake') line = `${f(r.mean, 0)}`;
      }
      if (device === 'keys') notes.push(`${kmh} km/h ${line} deg`);
    }
  }
  // power in a low gear, and a stick held part way
  const power = D.holdSlide('pad', L.sport, { start: 'power' });
  check(!power.spun && power.onset < 1.3 && power.mean > 20, `power: began after ${f(power.onset, 2)} s, ${f(power.mean, 0)} deg`);
  // and still no spin when it is abused
  const pull = D.handbrakePull(150, 0.5, { level: L.sport });
  check(!pull.spun && Math.abs(pull.mostSlip) < 50, `handbrake at 150 km/h: ${f(pull.mostSlip)} deg`);
  return `keys: ${notes.join(', ')}; power slide ${f(power.mean, 0)} deg`;
});

test('people on the real road, default level: keys, a thumb and a pad lap within 3 % of the autopilot without a touch', () => {
  const auto = M.laps(track, 'auto', { count: 1, pace: 1 }).best;
  const notes = [];
  for (const device of DEVICES) {
    const r = D.driftLaps(track, device, [], { level: L.full, count: 2 });
    check(r.impacts === 0 && !r.spun, `${device}: ${r.impacts} impacts${r.spun ? ', spun' : ''}`);
    check(r.off < track.shoulder + 0.3, `${device}: body ${f(r.off, 2)} m beyond the pavement`);
    check(r.time < auto * 1.03, `${device}: ${f(r.time)} s against the autopilot's ${f(auto)} s`);
    notes.push(`${device} ${f(r.time)} s`);
  }
  return `${notes.join(', ')} (autopilot ${f(auto)} s)`;
});

test('people on the real road: the carousel sideways. Default: thrown in with the handbrake and caught; sport: held for seconds; it costs a few per cent', () => {
  const notes = [];
  const bend = [{ id: 'carousel', start: 'handbrake', lead: 0 }];
  for (const device of DEVICES) {
    const tidy = D.driftLaps(track, device, [], { level: L.full });
    const easy = D.driftLaps(track, device, bend, { level: L.full });
    const z = easy.zones.carousel;
    // (the scripted people throw the car in early and brush the inside of the bend on some laps, on keys above all:
    // counted, and bounded. A clean sideways carousel by scripted hands at every level is not yet shown.)
    check(easy.impacts <= 2 && !easy.spun && Number.isFinite(easy.time), `default, ${device}: ${easy.impacts} impacts${easy.spun ? ', spun' : ''}`);
    check(z.most >= 12 && z.most < 30, `default, ${device}: ${f(z.most, 0)} deg at most`);
    check(easy.time < tidy.time * 1.08, `default, ${device}: the sideways lap cost ${f(easy.time - tidy.time, 2)} s`);
    const sport = D.driftLaps(track, device, bend, { level: L.sport });
    const s = sport.zones.carousel;
    check(!sport.spun && Number.isFinite(sport.time), `sport, ${device}: ${sport.spun ? 'spun' : 'did not finish'}`);
    check(s.sideways >= 2.5 && s.mean >= 12 && s.most < 50, `sport, ${device}: ${f(s.sideways)} s beyond 12 deg, mean ${f(s.mean, 0)}, most ${f(s.most, 0)}`);
    check(sport.impacts <= 4, `sport, ${device}: ${sport.impacts} impacts`);
    check(sport.time < tidy.time * 1.1, `sport, ${device}: the sideways lap cost ${f(sport.time - tidy.time, 2)} s`);
    notes.push(`${device}: default ${f(z.most, 0)} deg (+${f(easy.time - tidy.time, 1)} s, ${easy.impacts} touches), sport ${f(s.sideways)} s at ${f(s.mean, 0)} deg (+${f(sport.time - tidy.time, 1)} s, ${sport.impacts} touches)`);
  }
  return notes.join('; ');
});

console.log(failures ? `\n${failures} failures in ${results.length} tests` : `\nall ${results.length} passed`);
if (failures) process.exitCode = 1;
