// The quality governor, tested (docs/engine.md, "The quality ladder"): engine/governor.js is a pure function of the
// frame times it is fed, so made-up devices can be run through it for minutes in a few milliseconds.
//
//   node tools/unit/governor.test.mjs        (or: node tools/unit.mjs governor)
//
// A device here is a refresh interval, a cost of drawing a frame that depends on what is shed and on the render
// scale, and perhaps a frame-rate cap (iOS in Low Power Mode: 30 a second whatever is drawn). Under vsync a frame
// takes a whole number of refresh intervals, which is what makes one small rung invisible in the frame time.

import { LADDER, TIERS, guessTier } from '../../src/engine/caps.js';
import { GOVERNOR, SCALE_STEPS, adaptiveFor, createGovernor, governorStep, scaleAt, shedAt, startGovernorAt } from '../../src/engine/governor.js';

let failures = 0;
function test(name, fn) {
  const before = failures;
  let said = '';
  try {
    said = fn() ?? '';
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  console.log(`${failures === before ? '  ok  ' : 'FAILED'}  ${name}${said ? `: ${said}` : ''}`);
}
function expect(condition, message) {
  if (condition) return;
  failures++;
  console.log(`      ${message}`);
}

const MEDIUM = { rungs: LADDER.medium, floor: TIERS.medium.scaleFloor };
const LOW = { rungs: LADDER.low, floor: TIERS.low.scaleFloor };

/**
 * Run a device through a governor.
 * @param {object} g the governor
 * @param {object} d the device: refresh (s), cost(shed, scale, t) (s of work for a frame), cap(t) (s, 0: none),
 *   hitch(frame) (s added to that frame, optional)
 * @param {number} seconds
 * @param {object[]} [log] gets { t, level, shed, scale, trial } at every change of level
 * @returns {number} the time reached
 */
function run(g, d, seconds, log = [], t0 = 0) {
  let t = t0;
  let frame = 0;
  while (t < t0 + seconds) {
    const work = d.cost(shedAt(g), scaleAt(g), t) + (d.hitch ? d.hitch(frame) : 0);
    // vsync: a whole number of refresh intervals; a cap: never sooner than it allows
    const dt = Math.max(d.cap ? d.cap(t) : 0, Math.ceil(work / d.refresh - 1e-9) * d.refresh);
    t += dt;
    frame++;
    if (governorStep(g, dt)) log.push({ t, level: g.level, shed: shedAt(g), scale: scaleAt(g), trial: !!g.watch?.trial });
  }
  return t;
}
/** The levels the governor settled on, without the trials' visits to the bottom. */
const settled = (log) => log.filter((e) => !e.trial).map((e) => e.level);
const ms = (s) => `${(s * 1000).toFixed(1)} ms`;

test('the ladder: rungs first, in the tier\'s order, resolution only after all of them, never below the floor', () => {
  const g = createGovernor(MEDIUM);
  expect(g.max === LADDER.medium.length + 2, `medium has ${g.max} levels below the top, expected the rungs and two scales`);
  for (let level = 0; level <= g.max; level++) {
    const shed = shedAt(g, level);
    const scale = scaleAt(g, level);
    expect(shed === Math.min(level, LADDER.medium.length), `level ${level} sheds ${shed} rungs`);
    expect(scale === 1 || shed === LADDER.medium.length, `level ${level}: scale ${scale} with only ${shed} rungs shed`);
    expect(scale >= TIERS.medium.scaleFloor - 1e-9, `level ${level}: scale ${scale} under the floor`);
  }
  expect(scaleAt(g, g.max) === 0.72 && scaleAt(g, 99) === 0.72, 'the last level is not the floor');
  const low = createGovernor(LOW);
  expect(scaleAt(low, low.max) === 0.6 && low.max === LADDER.low.length + 3, `low ends at ${scaleAt(low, low.max)}, level ${low.max}`);
  for (const tier of Object.keys(TIERS)) {
    expect(Array.isArray(LADDER[tier]) && LADDER[tier].length > 0, `no ladder for ${tier}`);
    expect(SCALE_STEPS.includes(TIERS[tier].scaleFloor), `${tier}: the floor ${TIERS[tier].scaleFloor} is not one of the render scales`);
  }
  return `medium ${LADDER.medium.join(' > ')} > 0.85 > 0.72; low ${LADDER.low.join(' > ')} > 0.85 > 0.72 > 0.6`;
});

test('a device with time to spare sheds nothing, hitches or not', () => {
  for (const refresh of [1 / 60, 1 / 120, 1 / 144]) {
    const g = createGovernor(MEDIUM);
    const log = [];
    run(g, { refresh, cost: () => 0.004, hitch: (f) => (f % 120 === 60 ? 0.4 : f % 15 === 7 ? 0.03 : 0) }, 120, log);
    expect(log.length === 0 && g.level === 0 && g.trials === 0, `at ${Math.round(1 / refresh)} Hz: ${JSON.stringify(log.slice(0, 3))}`);
  }
});

/** Without repeats: a trial that helps lands on the level the steps before it had reached. */
const distinct = (levels) => levels.filter((l, i) => i === 0 || l !== levels[i - 1]);

test('hitches do not ratchet a fast device down (what the old render scale did)', () => {
  // A phone that draws in 8 ms, with what a real page has: a 1.6 s stall every 15 s (a batch of shaders compiled on
  // entering a new place), bursts of five 120 ms frames (targets made again, a collection) and single 40 ms frames.
  // The governor before this one added every slow frame's whole length to its count and compared a smoothed frame
  // time that one stall had poisoned: each stall was a step down that "helped".
  const g = createGovernor(MEDIUM);
  const log = [];
  const hitch = (f) => (f % 900 === 450 ? 1.6 : f % 600 >= 300 && f % 600 < 305 ? 0.112 : f % 37 === 5 ? 0.032 : 0);
  run(g, { refresh: 1 / 60, cost: () => 0.008, hitch }, 600, log);
  expect(log.length === 0 && g.level === 0 && g.trials === 0 && g.cap === null, `in ten minutes: ${JSON.stringify(log.slice(0, 4))}, trials ${g.trials}`);
  // and the same phone, found at the bottom (a level kept from a worse day), climbs all the way back in spite of them
  const low = createGovernor(MEDIUM);
  startGovernorAt(low, 7);
  const up = [];
  run(low, { refresh: 1 / 60, cost: () => 0.008, hitch }, 180, up);
  expect(low.level === 0 && up.every((e) => !e.trial), `from the bottom, three minutes later: level ${low.level}`);
  return `from the bottom to the top in ${up.length ? up[up.length - 1].t.toFixed(0) : '?'} s`;
});

test('a phone short of time sheds the ladder in order and keeps its resolution if the rungs pay for it', () => {
  // 26 ms of work at the top, each rung saves 2.2 ms: under 60 Hz vsync the first four steps show nothing at all
  const g = createGovernor(MEDIUM);
  const log = [];
  run(g, { refresh: 1 / 60, cost: (shed, scale) => (0.026 - 0.0022 * shed) * (0.4 + 0.6 * scale * scale) }, 90, log);
  const levels = distinct(settled(log));
  const arrived = levels.indexOf(5);
  expect(arrived === 4 && levels.slice(0, 5).join() === '1,2,3,4,5', `not one rung at a time from the top to the fifth: ${levels}`);
  // (from there it tries a step up now and then and takes it back)
  expect(levels.slice(arrived).every((l) => l === 4 || l === 5), `left levels 4 and 5 afterwards: ${levels}`);
  expect(g.cap === null && g.proven, `cap ${g.cap}, proven ${g.proven}: a device that sheds to 60 a second is not capped`);
  expect(log.every((e) => e.trial || e.scale === 1), 'the render scale was touched outside a trial');
  const done = log.find((e) => !e.trial && e.level === 5)?.t ?? Infinity;
  expect(done < 30, `took ${done.toFixed(1)} s to get there`);
  return `levels ${levels.slice(0, 5).join(' ')} in ${done.toFixed(1)} s, ${g.trials} trials`;
});

test('a weak phone gives up resolution last, and stops at the floor', () => {
  for (const [name, options, floor, fill] of [
    ['medium', MEDIUM, 0.72, 0.036],
    ['low', LOW, 0.6, 0.05],
  ]) {
    const g = createGovernor(options);
    const log = [];
    // never fast enough: 20 a second or less until the floor, 30 a second at it
    const R = options.rungs.length;
    run(g, { refresh: 1 / 60, cost: (shed, scale) => 0.01 + (fill + 0.004 * (R - shed)) * scale * scale }, 240, log);
    expect(log.every((e) => e.scale >= floor - 1e-9), `${name}: went under the floor`);
    expect(log.some((e) => !e.trial && e.scale === floor) && scaleAt(g, g.max) === floor, `${name}: never reached the floor`);
    const firstScale = log.findIndex((e) => !e.trial && e.scale < 1);
    expect(firstScale > 0 && log[firstScale].shed === R, `${name}: resolution went before the rungs`);
    const rungs = distinct(log.slice(0, firstScale).filter((e) => !e.trial).map((e) => e.level));
    expect(rungs.join() === Array.from({ length: R }, (_, i) => i + 1).join(), `${name}: the rungs were not shed one by one before the first scale step: ${rungs}`);
    expect(g.level >= g.max - 1, `${name}: ended at level ${g.level} of ${g.max}`);
  }
});

test('a 30 Hz cap sheds nothing: one short trial, then everything back for good', () => {
  const g = createGovernor(MEDIUM);
  const log = [];
  run(g, { refresh: 1 / 60, cap: () => 1 / 30, cost: () => 0.008 }, 300, log);
  expect(g.level === 0, `ended at level ${g.level}`);
  expect(g.trials === 1, `${g.trials} trials`);
  expect(g.cap !== null && Math.abs(g.cap - 1 / 30) < 0.001, `the cap was taken for ${g.cap}`);
  expect(log.length === 2 && log[0].trial && log[1].level === 0, `changes: ${JSON.stringify(log)}`);
  const away = log.length === 2 ? log[1].t - log[0].t : Infinity;
  expect(away < 2, `the trial held the bottom for ${away.toFixed(2)} s`);
  return `trial from ${log[0]?.t.toFixed(1)} s for ${away.toFixed(2)} s; cap ${ms(g.cap ?? 0)}`;
});

test('under a 30 Hz cap a device slower than the cap sheds until it meets the cap, no further', () => {
  const g = createGovernor(MEDIUM);
  const log = [];
  // 45 ms at the top (20 a second under the cap's vsync), 4 ms saved by each rung: 33 ms with three shed
  const d = { refresh: 1 / 60, cap: () => 1 / 30, cost: (shed) => 0.045 - 0.004 * shed };
  const t = run(g, d, 60, log);
  expect(g.level === 3, `ended at level ${g.level}: ${settled(log)}`);
  expect(g.cap !== null && Math.abs(g.cap - 1 / 30) < 0.001, `cap ${g.cap}`);
  // and from there it tries a step up now and then, takes it back at once, and waits twice as long each time
  const later = [];
  run(g, d, 600, later, t);
  const ups = later.filter((e) => e.level === 2).map((e) => e.t);
  expect(ups.length >= 2 && ups.length <= 8, `${ups.length} tries in ten minutes`);
  expect(later.every((e) => !e.trial && (e.level === 2 || e.level === 3)), `left its two levels: ${JSON.stringify(later.slice(0, 4))}`);
  expect(g.level === 3, `ended at ${g.level}`);
  for (let i = 2; i < ups.length; i++) expect(ups[i] - ups[i - 1] > (ups[i - 1] - ups[i - 2]) * 1.5 || ups[i] - ups[i - 1] > GOVERNOR.maxPatience, `tries at ${ups.map((x) => x.toFixed(0))} s do not thin out`);
  return `level 3; tries to step up at ${ups.map((x) => x.toFixed(0)).join(', ')} s`;
});

test('headroom steps back up, one level at a time, patiently', () => {
  const g = createGovernor(MEDIUM);
  const log = [];
  // heavy for the first minute (the forest), light after it
  const d = { refresh: 1 / 60, cost: (shed, scale, t) => (t < 60 ? 0.034 - 0.003 * shed : 0.02 - 0.003 * shed) * (0.3 + 0.7 * scale * scale) };
  let t = run(g, d, 60, log);
  const bottom = g.level;
  expect(bottom >= 6 && scaleAt(g) < 1, `the heavy minute ended at level ${bottom}`);
  const up = [];
  t = run(g, d, 240, up, t);
  // light: 20 ms at the top, 17 ms with one rung shed, 14 ms with two
  expect(g.level === 2, `ended at level ${g.level}`);
  const levels = up.map((e) => e.level);
  expect(up.every((e) => !e.trial), 'a trial on the way up');
  const firstTry = up.findIndex((e) => e.level === 1);
  expect(firstTry >= 0 && levels.slice(0, firstTry).every((l, i) => l === bottom - 1 - i), `not one level at a time: ${levels}`);
  for (let i = 1; i <= firstTry; i++) expect(up[i].t - up[i - 1].t >= GOVERNOR.patience - 0.1, `steps up ${(up[i].t - up[i - 1].t).toFixed(1)} s apart`);
  return `down to level ${bottom}, back up through ${levels.slice(0, firstTry + 1).join(' ')}, then holds ${g.level}`;
});

test('a cap that comes on later undoes what it made the governor shed', () => {
  const g = createGovernor(MEDIUM);
  let capped = false;
  const d = {
    refresh: 1 / 60,
    cap: () => (capped ? 1 / 30 : 0),
    cost: (shed, scale) => (0.026 - 0.0022 * shed) * (0.4 + 0.6 * scale * scale),
  };
  // until it has settled on the fifth level, and a little longer
  let t = 0;
  while (g.level !== 5 || g.watch) t = run(g, d, 0.5, [], t);
  t = run(g, d, 3, [], t);
  expect(g.level === 5 && g.proven && g.cap === null, `before the cap: level ${g.level}, proven ${g.proven}`);
  capped = true;
  const during = [];
  const from = t;
  let found = Infinity;
  while (t < from + 30) {
    t = run(g, d, 0.5, during, t);
    if (g.cap !== null && found === Infinity) found = t - from;
  }
  expect(found < 12, `took ${found.toFixed(1)} s to see the cap`);
  expect(Math.abs((g.cap ?? 0) - 1 / 30) < 0.001, `cap ${g.cap}`);
  expect(g.level <= 5, `under the cap it ended at level ${g.level}: lower than before it`);
  const worst = Math.max(...during.filter((e) => !e.trial).map((e) => e.level));
  expect(worst <= 7, `went to level ${worst}`);
  return `level 5 before; ${during.map((e) => e.level).join(' ')} while it found the cap (${found.toFixed(1)} s)`;
});

test('a cap that goes is forgotten', () => {
  const g = createGovernor(MEDIUM);
  let capped = true;
  const d = { refresh: 1 / 60, cap: () => (capped ? 1 / 30 : 0), cost: () => 0.008 };
  let t = run(g, d, 30, []);
  expect(g.cap !== null && g.level === 0, `under the cap: cap ${g.cap}, level ${g.level}`);
  capped = false;
  t = run(g, d, 10, [], t);
  expect(g.cap === null && g.level === 0, `after it: cap ${g.cap}, level ${g.level}`);
});

test('one bad measurement does not park a slow device at the top', () => {
  // a hitch in the middle of the trial's measurement: the trimmed mean drops it
  const g = createGovernor(MEDIUM);
  const log = [];
  let trialFrames = 0;
  const d = {
    refresh: 1 / 60,
    cost(shed, scale) {
      let c = (0.03 - 0.003 * shed) * (0.3 + 0.7 * scale * scale);
      if (g.watch?.trial && ++trialFrames % 14 === 0) c += 0.2;
      return c;
    },
  };
  run(g, d, 60, log);
  expect(g.proven && g.cap === null && g.level >= 5, `level ${g.level}, cap ${g.cap}, proven ${g.proven}`);
});

test('a second visit starts where the first ended: no slow start, no trial, and it climbs if there is room now', () => {
  const d = { refresh: 1 / 60, cost: (shed, scale) => (0.026 - 0.0022 * shed) * (0.4 + 0.6 * scale * scale) };
  const g = createGovernor(MEDIUM);
  startGovernorAt(g, 5);
  const log = [];
  run(g, d, 5, log);
  expect(g.level === 5 && log.length === 0 && g.trials === 0, `changes in the first 5 s: ${JSON.stringify(log)}`);
  // the same level kept from a heavier day: the device has time to spare now
  const light = createGovernor(MEDIUM);
  startGovernorAt(light, 5);
  run(light, { refresh: 1 / 60, cost: () => 0.008 }, 60, []);
  expect(light.level === 0 && light.trials === 0, `ended at level ${light.level} after a minute with time to spare`);
  // and a level that is not enough any more steps on without a trial
  const heavy = createGovernor(MEDIUM);
  startGovernorAt(heavy, 2);
  const steps = [];
  run(heavy, d, 30, steps);
  expect(distinct(settled(steps)).slice(0, 3).join() === '3,4,5', `from level 2: ${settled(steps)}`);
  const junk = createGovernor(MEDIUM);
  startGovernorAt(junk, 99);
  expect(junk.level === junk.max, 'a level beyond the ladder is not held to it');
  startGovernorAt(junk, NaN);
  expect(junk.level === 0 && !junk.proven, 'nonsense is not the top');
});

test('stills and tests are left alone: no governor with ?manual, ?nodraw, ?dpr=, ?scale= or ?shed=', () => {
  expect(adaptiveFor({}) === true, 'off for a plain page');
  expect(adaptiveFor({ manual: true }) === false, 'on with ?manual');
  expect(adaptiveFor({ draws: false }) === false, 'on with ?nodraw');
  expect(adaptiveFor({ pixelRatio: 2 }) === false, 'on with ?dpr=');
  expect(adaptiveFor({ renderScale: 0.72 }) === false, 'on with ?scale=');
  expect(adaptiveFor({ shed: 0 }) === false, 'on with ?shed=');
});

test('the tier guess: every iPhone and iPad starts on medium, whatever its browser says of the GPU', () => {
  expect(guessTier('apple gpu', false, true, true) === 'medium', 'Safari\'s own string');
  expect(guessTier('', false, true, true) === 'medium', 'a browser that hides the string');
  expect(guessTier('', false, true, false) === 'low', 'an unknown Android phone');
  expect(guessTier('google swiftshader', true, false, false) === 'low', 'software WebGL');
  expect(guessTier('adreno (tm) 740', false, true, false) === 'medium', 'a recent Adreno');
  expect(guessTier('nvidia geforce rtx 3060', false, false, false) === 'high', 'a desktop card');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
