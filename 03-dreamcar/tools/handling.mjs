// How the car drives: scripted manoeuvres on level ground, measured, in Node (no browser, no pictures).
//
//   node tools/handling.mjs            the table
//   node tools/handling.mjs --json     the same numbers as JSON
//
// These are the figures of docs/spec.md's handling section: run this after changing anything in
// src/game/vehicle/ and bring that table up to date. The targets in brackets are the build's; the same numbers are
// asserted by tools/unit/vehicle.test.mjs.

import { CAR } from '../src/game/vehicle/params.js';
import * as M from './unit/manoeuvres.mjs';

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
row('0-100 km/h', `${f(acc.t100, 2)} s`, '[5.8-6.6]');
row('0-200 km/h', `${f(acc.t200, 1)} s`);
row('standing 400 m', `${f(acc.t400m, 2)} s at ${f(acc.v400m, 0)} km/h`);
row('launch', `${f(acc.launchG, 2)} g peak, ${f(acc.squat, 2)}° squat`);
row('up-shifts at', acc.shifts.map((s) => `${s.to}:${f(s.kmh, 0)}`).join(' ') + ' km/h');
const top = (data.topSpeed = M.topSpeed());
row('top speed', `${f(top.kmh, 1)} km/h in ${top.gear}th at ${f(top.rpm, 0)} rpm`, '[245-255, limited]');
const free = (data.topSpeedUnlimited = M.topSpeed(M.tuned((p) => { p.topSpeed = 400 / 3.6; })));
row('top speed without the limiter', `${f(free.kmh, 1)} km/h in ${free.gear}th at ${f(free.rpm, 0)} rpm`);
const b100 = (data.braking100 = M.braking(100));
row('100-0 km/h', `${f(b100.distance, 1)} m in ${f(b100.time, 2)} s (mean ${f(b100.meanG, 2)} g, peak ${f(b100.peakG, 2)} g)`, '[34-39 m]');
row('dive under braking', `${f(b100.dive, 2)}° at most, ${f(b100.divePerG, 2)}° per g`, '[1.5-2° per g]');
const b200 = (data.braking200 = M.braking(200));
row('200-0 km/h', `${f(b200.distance, 1)} m in ${f(b200.time, 2)} s (mean ${f(b200.meanG, 2)} g)`);
const noAbs = (data.brakingLocked = M.braking(100, CAR, { abs: false }));
row('100-0 km/h without ABS (locked)', `${f(noAbs.distance, 1)} m (mean ${f(noAbs.meanG, 2)} g)`);
const hands = (data.handsOff = M.handsOff(200));
row('hands off at 200 km/h after a shove', `slip ${f(hands.mostSlip, 2)}° at most, yaw rate ${f(hands.residualYawRate * 57.3, 3)}°/s after 6 s`, '[stable]');
const rev = (data.reversing = M.reversing());
row('reverse', `${f(-rev.back.kmh, 0)} km/h after 5 s on the brake; throttle stops it in ${f(rev.stopTime, 1)} s, then ${rev.gearAfter}st gear`);

section('Cornering');
const pad = (data.skidpad = M.skidpad(50));
row('steady state, 50 m circle', `${f(pad.maxG, 2)} g at ${f(pad.speedAtMax, 0)} km/h (${pad.ended})`, '[0.95-1.05 g]');
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

section('Ride');
const front = (data.rideFront = M.ride('front'));
const rear = (data.rideRear = M.ride('rear'));
row('ride frequency front / rear', `${f(front.hz, 2)} / ${f(rear.hz, 2)} Hz`, '[about 1.3 / 1.5]');
row('damping ratio front / rear', `${f(front.dampingRatio, 2)} / ${f(rear.dampingRatio, 2)} (bump ${f(front.bump, 2)}, rebound ${f(front.rebound, 2)})`, '[0.4-0.5]');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2));
} else {
  const width = Math.max(...rows.map((r) => r[0].trim().length));
  for (const [name, value, note] of rows) {
    if (name.startsWith('\n')) console.log(`${name}`);
    else console.log(`  ${name.padEnd(width)}  ${value}${note ? `   ${note}` : ''}`);
  }
}
