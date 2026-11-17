// How the car drives: scripted manoeuvres on level ground, measured, in Node (no browser, no pictures).
//
//   node tools/handling.mjs            the table
//   node tools/handling.mjs --json     the same numbers as JSON
//   node tools/handling.mjs --no-laps  without the laps of the real road (they take most of the time)
//
// These are the figures of docs/spec.md's handling section: run this after changing anything in
// src/game/vehicle/ and bring that table up to date. The targets in brackets are the build's; the same numbers are
// asserted by tools/unit/vehicle.test.mjs.

import { CAR } from '../src/game/vehicle/params.js';
import * as M from './unit/manoeuvres.mjs';
import * as D from './unit/drift.mjs';
import { ASSISTS } from '../src/game/config.js';
import { EDGE } from './unit/flatTrack.mjs';

const f = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : String(v));
const rows = [];
const row = (name, value, note = '') => rows.push([name, value, note]);
const section = (name) => rows.push([`\n${name}`, '', '']);
const data = {};

section('Standing');
const rest = (data.rest = M.rest());
row('ride height error', `${f(rest.rideHeight * 1000, 2)} mm`, 'the root of the model above the road (0 = as drawn)');
row('wheel loads FL FR RL RR', rest.loads.map((l) => f(l, 0)).join(' ') + ' N');
row('residual motion', `${f(rest.residualSpeed * 1000, 3)} mm/s, ${f(rest.drift * 1000, 3)} mm in 3 s`, '[none]');
const slope = (data.parked = M.parked(0.1, 0.06));
row('parked on a 10 % hill, 6 % camber', `${f(slope.moved * 1000, 2)} mm in 10 s`, '[none]');

section('Straight line');
const acc = (data.acceleration = M.acceleration());
row('0-100 km/h', `${f(acc.t100, 2)} s`, '[4.0 or less]');
row('0-200 km/h', `${f(acc.t200, 1)} s`, '[about 13]');
row('standing 400 m', `${f(acc.t400m, 2)} s at ${f(acc.v400m, 0)} km/h`);
row('launch', `${f(acc.launchG, 2)} g peak, ${f(acc.squat, 2)}° squat`);
row('up-shifts at', acc.shifts.map((s) => `${s.to}:${f(s.kmh, 0)}`).join(' ') + ' km/h');
const top = (data.topSpeed = M.topSpeed());
row('top speed', `${f(top.kmh, 1)} km/h in ${top.gear}th at ${f(top.rpm, 0)} rpm`, '[about 285, limited]');
const free = (data.topSpeedUnlimited = M.topSpeed(M.tuned((p) => { p.topSpeed = 400 / 3.6; })));
row('top speed without the limiter', `${f(free.kmh, 1)} km/h in ${free.gear}th at ${f(free.rpm, 0)} rpm`);
const b100 = (data.braking100 = M.braking(100));
row('100-0 km/h', `${f(b100.distance, 1)} m in ${f(b100.time, 2)} s (mean ${f(b100.meanG, 2)} g, peak ${f(b100.peakG, 2)} g)`, '[32 m or less]');
row('dive under braking', `${f(b100.dive, 2)}° at most, ${f(b100.divePerG, 2)}° per g`, '[1.5-2° per g]');
const b200 = (data.braking200 = M.braking(200));
row('200-0 km/h', `${f(b200.distance, 1)} m in ${f(b200.time, 2)} s (mean ${f(b200.meanG, 2)} g)`);
const noAbs = (data.brakingLocked = M.braking(100, CAR, { abs: false }));
row('100-0 km/h without ABS (locked)', `${f(noAbs.distance, 1)} m (mean ${f(noAbs.meanG, 2)} g)`);
const hands = (data.handsOff = M.handsOff(200));
row('hands off at 200 km/h after a shove', `slip ${f(hands.mostSlip, 2)}° at most, yaw rate ${f(hands.residualYawRate * 57.3, 3)}°/s after 6 s`, '[stable]');
const rev = (data.reversing = M.reversing());
row('reverse', `${f(-rev.back.kmh, 0)} km/h after 5 s on the brake; throttle stops it in ${f(rev.stopTime, 1)} s, then ${rev.gearAfter}st gear`);

{
  const locks = [150, 200, 250, 280].map((kmh) => [kmh, M.fullLockAt(kmh, 3)]);
  data.fullLock = locks;
  row('full key lock for 3 s, throttle held', locks.map(([k, r]) => `${k}: ${f(r.mostSlip, 1)}°`).join(', ') + ' of slip', '[never spins]');
}

section('Cornering');
const pad = (data.skidpad = M.skidpad(50));
row('steady state, 50 m circle', `${f(pad.maxG, 2)} g at ${f(pad.speedAtMax, 0)} km/h (${pad.ended})`, '[about 1.25-1.3 g]');
row('at that limit', `steering ${f(pad.steerAtLimit, 1)}°, body slip ${f(pad.slipAtLimit, 1)}°`);
row('understeer gradient', `${f(pad.understeer, 2)}° per g`);
row('body roll', `${f(pad.rollPerG, 2)}° per g`, '[about 3.5]');
const padOff = (data.skidpadNoEsc = M.skidpad(50, CAR, { esc: false }));
row('the same without stability control', `${f(padOff.maxG, 2)} g (${padOff.ended})`);
const step = (data.stepSteer = M.stepSteer(100, 2));
row('step steer, 2° at 100 km/h', `${f(step.steadyG, 2)} g, yaw rate overshoot ${f(step.overshoot, 0)} %, 90 % in ${f(step.rise, 2)} s, settled in ${f(step.settle, 2)} s`);
const lift = (data.liftOff = M.bend(90, 0.8, (c) => { c.throttle = 0; }));
row('lift-off at 0.8 g, 90 km/h', `radius ${f(lift.before.radius, 0)} -> ${f(lift.after.radius, 0)} m after 1 s, body slip ${f(lift.before.slip, 1)} -> ${f(lift.mostSlip, 1)}° at most`);
const power = (data.powerOn = M.bend(45, 0.65, (c) => { c.throttle = 1; }));
row('full throttle at 0.65 g, 45 km/h (2nd), assists on', `body slip ${f(power.mostSlip, 1)}° at most${power.spun ? ', SPUN' : ''}; ESC ${f(power.escWork, 2)}, TC ${f(power.tcWork, 2)}`);
const powerOff = (data.powerOnNoAssists = M.bend(45, 0.65, (c) => { c.throttle = 1; }, CAR, { esc: false, tc: false }));
row('the same, assists off', `body slip ${f(powerOff.mostSlip, 1)}° at most${powerOff.spun ? ', spun' : ''}`);
const hb = (data.handbrake = M.handbrakeTurn(60));
row('handbrake turn, 60 km/h, 1 s', `turned ${f(hb.turned, 0)}°, body slip ${f(hb.mostSlip, 0)}° at most, slowest ${f(hb.slowest, 0)} km/h, rear wheels ${hb.rearLocked ? 'locked' : 'NOT locked'}`);

const ch = (data.characteristicSpeed = M.characteristicSpeed());
row('characteristic speed', `${f(ch, 1)} m/s (the stability control's reference uses ${CAR.assists.esc.characteristicSpeed})`);
const lift9 = (data.liftOff09 = M.bend(90, 0.9, (c) => { c.throttle = 0; }));
row('lift-off at 0.9 g, 90 km/h', `radius ${f(lift9.before.radius, 0)} -> ${f(lift9.after.radius, 0)} m after 1 s, body slip ${f(lift9.mostSlip, 1)}° at most`, '[tightens, no spin]');
const squeal = (data.squeal = [60, 110].map((kmh) => ({ kmh, ...M.squealOnset(kmh) })));
row('tyres start to squeal at', squeal.map((q) => `${f(q.onset * 100, 0)} % of the most g at ${q.kmh} km/h`).join(', '), '[80-90 %]');

section('Hands and drifting (tools/unit/drift.mjs)');
{
  const DEVICES = ['keys', 'thumb', 'pad'];
  data.response = {};
  for (const kind of DEVICES) {
    const r = [80, 160, 250].map((k) => D.response(kind, k, kind === 'keys' ? 1 : 0.5));
    data.response[kind] = r;
    row(`steering response, ${kind}${kind === 'keys' ? ' (held)' : ' (half over)'}`, r.map((x, i) => `${[80, 160, 250][i]}: ${f(x.rise, 2)} s +${f(x.overshoot, 0)} % (g ${f(x.riseG, 2)} s)`).join(', '), 'time to 90 % of the yaw, overshoot [0.15-0.3 s]');
  }
  const probe = M.makeCar();
  row('rear-wheel steering', [100, 160, 250].map((k) => `${f(probe.rearShare(k / 3.6) * 100, 0)} % at ${k}`).join(', ') + ' km/h', 'of the fronts\' angle, the same way');
  const L = ASSISTS.levels;
  data.drift = {};
  for (const name of Object.keys(L)) {
    const level = L[name];
    const out = (data.drift[name] = {});
    const tag = `[${level.name}]`;
    // a slide asked for four ways at the carousel's speed, held 4 s with the steering into the bend, then let go
    const starts = ['handbrake', 'brake', 'lift', 'power'].map((start) => D.holdSlide('keys', level, { start }));
    out.starts = starts.map((r) => ({ onset: r.onset, mean: r.mean, spun: r.spun }));
    row(`${tag} slide asked for by handbrake / brake / lift / power, 90 km/h`, starts.map((r) => (r.spun ? 'spins' : Number.isNaN(r.onset) ? 'none' : `${f(r.mean, 0)}° after ${f(r.onset, 1)} s`)).join(' / '), 'keys; held 4 s');
    if (level.hold) {
      const held = DEVICES.map((device) => D.holdSlide(device, level, {}));
      out.held = held.map((r) => ({ mean: r.mean, kmhIn: r.kmhIn, kmhOut: r.kmhOut, close: r.close, snap: r.snap }));
      row(`${tag} held on the throttle (handbrake in)`, held.map((r, i) => `${DEVICES[i]} ${f(r.mean, 0)}° (${f(r.least, 0)}-${f(r.most, 0)}), ${f(r.kmhIn, 0)} to ${f(r.kmhOut, 0)} km/h`).join('; '));
      row(`${tag} let go: straight in / swing the other way`, held.map((r, i) => `${DEVICES[i]} ${f(r.close, 2)} s / ${f(r.snap)}°`).join('; '), '[no snap]');
      const tapped = D.holdSlide('keys', level, { duty: 0.5 });
      row(`${tag} key tapped half the time`, `${f(tapped.mean, 0)}°, ${f(tapped.kmhIn, 0)} to ${f(tapped.kmhOut, 0)} km/h, ${f(tapped.g, 2)} g`);
      const fast = [[185, 220], [210, 300]].map(([kmh, radius]) => D.holdSlide('keys', level, { start: 'brake', kmh, radius }));
      row(`${tag} at the shore bend's and the long right's speeds (brake in)`, fast.map((r, i) => `${[185, 210][i]} km/h: ${f(r.mean, 0)}°, to ${f(r.kmhOut, 0)} km/h`).join('; '));
    }
    const hb = [[90, 0.5], [150, 0.5], [150, 1.5]].map(([k, pull]) => D.handbrakePull(k, pull, { level }));
    out.handbrake = hb.map((x) => ({ most: x.mostSlip, spun: x.spun }));
    row(`${tag} handbrake 0.5 s at 90 / 0.5 s at 150 / 1.5 s at 150 km/h, then half throttle`, hb.map((x) => `${f(Math.abs(x.mostSlip), 0)}°${x.spun ? ' spun' : ''}`).join(' / '));
  }
}

section('Ride');
const front = (data.rideFront = M.ride('front'));
const rear = (data.rideRear = M.ride('rear'));
row('ride frequency front / rear', `${f(front.hz, 2)} / ${f(rear.hz, 2)} Hz`, '[about 1.3 / 1.5]');
row('damping ratio front / rear', `${f(front.dampingRatio, 2)} / ${f(rear.dampingRatio, 2)} (bump ${f(front.bump, 2)}, rebound ${f(front.rebound, 2)})`, '[0.4-0.5]');

section('Keys (PlayerDriver, digital)');
const k80 = (data.keyResponse80 = M.keyResponse(80));
row('key held at 80 km/h', `90 % of the yaw rate in ${f(k80.rise, 2)} s, under 10 % ${f(k80.release, 2)} s after release`, '[0.15-0.25 s; under 0.35 s]');
row('  where it settles', `${f(k80.steadyG, 2)} g at ${f(k80.steer, 1)}° of steering, yaw overshoot ${f(k80.overshoot, 0)} %`);
const held = (data.keyHeld = [110, 140, 200].map((kmh) => ({ kmh, ...M.keyResponse(kmh) })));
row('key held through a long bend', held.map((h) => `${h.kmh} km/h: ${f(h.steadyG, 2)} g, swings ${f(h.swing, 2)} g`).join('; '), '[steady]');
const locks = (data.locks = [20, 40, 100, 200].map((kmh) => ({ kmh, key: M.lockAt(kmh), stick: M.lockAt(kmh, true) })));
row('full lock (key = stick)', locks.map((l) => `${f(l.key, 1)}° at ${l.kmh}`).join(', ') + ' km/h');
const taps = (data.taps = [50, 100, 200].map((ms) => ({ ms, ...M.keyTap(200, ms) })));
row('a tap at 200 km/h', taps.map((t) => `${t.ms} ms: ${f(Math.abs(t.heading), 2)}°`).join(', ') + `; yaw ${f(Math.max(...taps.map((t) => t.late)), 4)} rad/s 1 s on`, '[no sawing]');
const bk = (data.brakeKey = M.brakeKey(100)), bks = (data.brakeKeySteered = M.brakeKey(100, -1));
row('brake key, 100-0 km/h', `${f(bk.distance, 1)} m; steering held from 0.5 s: ${f(bks.distance, 1)} m, turned ${f(bks.heading, 0)}°`, '[33 m or less, steers]');
const lk = (data.launchKey = M.launchKey(0)), lkl = (data.launchKeyLock = M.launchKey(1));
row('throttle key from rest', `${f(lk.kmh, 0)} km/h after 4 s; with full lock ${f(lkl.kmh, 0)} km/h, slide ${f(lkl.mostSlip, 1)}° beyond the turn's own`, '[no spin]');
const hbk = (data.handbrakeKeys = [[40, 0.3], [60, 0.3], [60, 0.5], [100, 0.3]].map(([kmh, pull]) => ({ kmh, pull, ...M.handbrakeKeys(kmh, pull) })));
row('handbrake with a key held', hbk.map((h) => `${h.kmh} km/h ${h.pull} s: ${f(h.turned, 0)}°`).join(', '), '[a rotation that grows with the pull]');

section('Gearbox');
const hunt = (data.gearHunt = M.gearHunt());
row('shifts in 15 s', `throttle key on and off at 60 km/h: ${hunt.keyShifts}; held near 70 km/h down an 8 % hill by the brake: ${hunt.hillShifts}`, '[no hunting]');

section('Edges');
const rail10 = (data.rail10 = M.railTouch(100, 10)), rail45 = (data.rail45 = M.railTouch(80, 45)), wall10 = (data.wall10 = M.railTouch(100, 10, CAR, EDGE.WALL));
row('a rail touched at 10°, 100 km/h', `keeps ${f(rail10.least * 100, 0)} % (${f(rail10.kept * 100, 0)} % 0.6 s on), along the rail in ${f(rail10.parallel, 2)} s, ${rail10.impacts} impact, steered off at ${f(rail10.endKmh, 0)} km/h`, '[>= 90 %]');
for (const [kmh, angle] of [[200, 5], [250, 8]]) {
  const t = M.railTouch(kmh, angle);
  row(`a rail touched at ${angle}°, ${kmh} km/h`, `keeps ${f(t.least * 100, 0)} %, along the rail in ${f(t.parallel, 2)} s`, '[>= 90 %]');
}
row('a wall touched at 10°, 100 km/h', `keeps ${f(wall10.least * 100, 0)} %, along it in ${f(wall10.parallel, 2)} s, ${wall10.impacts} impact`);
row('a rail hit at 45°, 80 km/h', `keeps ${f(rail45.least * 100, 0)} %, along the rail in ${f(rail45.parallel, 2)} s, ${rail45.impacts} impacts, driven away at ${f(rail45.endKmh, 0)} km/h`);

if (!process.argv.includes('--no-laps')) {
  section('Laps of the real road (flying laps, s)');
  const { createTrack } = await import('../src/game/track.js');
  const track = createTrack();
  const lap = (kind, pace) => {
    const r = M.laps(track, kind, { pace, count: 2 });
    return { kind, pace, ...r };
  };
  const lapRows = (data.laps = [lap('auto', 1), lap('auto', 0.9), lap('auto', 0.7), lap('thumb', 1), lap('pad', 1), lap('keys', 1), lap('hamfist', 1)]);
  for (const l of lapRows) {
    const who = { auto: 'autopilot', thumb: 'thumb, ideal hands (full throttle unless braking)', pad: 'pad, ideal hands', keys: 'keys, ideal hands', hamfist: 'ham-fisted keys (flat out, full keys, slow hands)' }[l.kind];
    row(`${who}, pace ${l.pace}`, `${f(l.best, 1)} s, ${l.impacts} impacts, body ${l.off > 0 ? `${f(l.off, 2)} m beyond the pavement` : `${f(-l.off, 2)} m inside the pavement`} at worst, slip ${f(l.slip, 1)}° at most, stability control ${f(l.escPerLap, 1)} s a lap`);
  }
  section('People on the real road (a person\'s lag, speed and shake on each device; flying laps, s)');
  data.people = {};
  for (const name of ['full', 'sport']) {
    const level = ASSISTS.levels[name];
    for (const device of ['keys', 'thumb', 'pad']) {
      const tidy = D.driftLaps(track, device, [], { level });
      const slid = D.driftLaps(track, device, [{ id: 'carousel', start: 'handbrake', lead: 0 }], { level });
      const z = slid.zones.carousel;
      data.people[`${name}-${device}`] = { tidy: tidy.time, tidyImpacts: tidy.impacts, slid: slid.time, slidImpacts: slid.impacts, zone: z };
      row(`[${level.name}] ${device}`, `tidy ${f(tidy.time, 1)} s (${tidy.impacts} touches); carousel sideways ${f(slid.time, 1)} s (${slid.impacts} touches): ${f(z.most, 0)}° at most, ${f(z.sideways, 1)} s beyond 12°, slowest ${f(z.slowest, 0)} km/h`);
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2));
} else {
  const width = Math.max(...rows.map((r) => r[0].trim().length));
  for (const [name, value, note] of rows) {
    if (name.startsWith('\n')) console.log(`${name}`);
    else console.log(`  ${name.padEnd(width)}  ${value}${note ? `   ${note}` : ''}`);
  }
}
