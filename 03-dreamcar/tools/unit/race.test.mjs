// The rules of the run, tested without a browser: the start, laps and sectors, crossing times, the board.
//
//   node tools/unit/race.test.mjs        (or: node tools/unit.mjs race)
//
// Race (src/game/Race.js) only asks of the road its length, its two sector lines and the short way round
// between two distances, and of each car where it is along the road (`s`); so it runs here on a stub road of
// the real one's length and lines, with cars that are only an `s`, and a localStorage that is a Map (or that
// throws, for the storage failures). Every car is moved by a script, step by step at the game's 120 steps a
// second, so each expected time is worked out by hand.

import { Race, medalOf, formatMs } from '../../src/game/Race.js';
import { RULES } from '../../src/game/config.js';
import { createRng } from '../../src/engine/rng.js';

// ---- a very small harness -----------------------------------------------------------------------------------

let failures = 0;
let checks = 0;
function test(name, fn) {
  const before = failures;
  try {
    fn();
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  console.log(`${failures === before ? '  ok  ' : 'FAILED'}  ${name}`);
}
function expect(ok, what) {
  checks++;
  if (!ok) {
    failures++;
    console.log(`      expected: ${what}`);
  }
}
const eq = (a, b, what) => expect(a === b, `${what}: ${JSON.stringify(a)} === ${JSON.stringify(b)}`);

// ---- the stubs ----------------------------------------------------------------------------------------------

const L = 3364;
const track = {
  length: L,
  sectors: [1218, 2025],
  delta(from, to) {
    let d = to - from;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    return d;
  },
};
const wrap = (s) => ((s % L) + L) % L;

/** localStorage: a Map; `broken` makes every call throw, as a private window or switched-off storage can. */
function storage({ broken = false } = {}) {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => {
      if (broken) throw new Error('SecurityError');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => {
      if (broken) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
  return map;
}

const DT = 1 / 120;

/** A race and its cars; `drive(i, fn)` sets how car i moves: fn(clock) -> speed along the road (m/s). */
function setup({ racers = 1, laps = 3, time = 'day', mode = racers > 1 ? 'split' : 'solo', seed = 1, grid = -8 } = {}) {
  const race = new Race(track, { racers, laps, time, mode, rng: createRng(seed) });
  const cars = Array.from({ length: racers }, () => ({ s: wrap(grid), speed: () => 0 }));
  const events = [];
  const step = () => {
    for (const c of cars) c.s = wrap(c.s + c.speed(race.clock) * DT);
    race.update(DT, cars);
    race.drain(events);
  };
  const until = (cond, max = 120 * 3600) => {
    for (let k = 0; k < max && !cond(); k++) step();
  };
  return { race, cars, events, step, until };
}

// ---- the start ----------------------------------------------------------------------------------------------

test('the clock starts negative, the five lamps light one by one, go at zero', () => {
  storage();
  const { race, events, until } = setup();
  expect(race.clock < 0, 'clock negative at first');
  expect(race.hold >= RULES.holdMin && race.hold <= RULES.holdMax, 'hold within its limits');
  until(() => race.state === 'run');
  const counts = events.filter((e) => e.type === 'count').map((e) => e.n);
  eq(counts.join(','), '1,2,3,4,5', 'lamps lit in order');
  eq(events.filter((e) => e.type === 'go').length, 1, 'one go');
  expect(race.clock >= 0 && race.clock < DT + 1e-9, 'go on the first step at or after zero');
  eq(race.lampsAt(-0.001), 5, 'five lamps just before go');
  eq(race.lampsAt(0), 0, 'none at go');
});

test('the same seed gives the same hold; another seed another', () => {
  storage();
  const a = setup({ seed: 7 }).race.hold;
  const b = setup({ seed: 7 }).race.hold;
  const c = setup({ seed: 8 }).race.hold;
  eq(a, b, 'same seed');
  expect(a !== c, 'a different seed changes the hold');
});

// ---- laps and sectors ---------------------------------------------------------------------------------------

test('a steady car: sectors and laps at the times worked out by hand, to the millisecond', () => {
  storage();
  const v = 40;
  const { race, cars, events, until } = setup({ laps: 3 });
  cars[0].speed = (clock) => (clock >= 0 ? v : 0);
  until(() => race.state === 'done');
  const sectors = events.filter((e) => e.type === 'sector');
  const laps = events.filter((e) => e.type === 'lap');
  eq(sectors.length, 6, 'two sectors a lap');
  eq(laps.length, 3, 'three laps');
  eq(events.filter((e) => e.type === 'finish').length, 1, 'one finish');
  eq(events[events.length - 1].type, 'end', 'end last');
  // the car moves v*DT per step from the step that makes the clock >= 0; the first step after go is at clock ~0
  // so it crosses distance x (from the grid) at clock = x / v minus less than a step: exact to 1 ms by interpolation
  const t0 = race.cars[0].times;
  const first = 8 + 1218;
  const expectS1 = Math.round((first / v) * 1000);
  expect(Math.abs(sectors[0].ms - expectS1) <= 9, `sector 1 at ${expectS1} ms (got ${sectors[0].ms})`);
  const lapMs = Math.round((L / v) * 1000);
  expect(Math.abs(t0[1].ms - lapMs) <= 1, `flying lap ${lapMs} ms (got ${t0[1].ms})`);
  expect(Math.abs(t0[2].ms - lapMs) <= 1, `third lap ${lapMs} ms (got ${t0[2].ms})`);
  expect(t0[0].standing && !t0[1].standing, 'lap one is the standing lap');
  eq(t0[1].splits.length, 3, 'three splits a lap');
  eq(t0[1].splits[2], t0[1].ms, 'the last split is the lap');
  expect(Math.abs(t0[1].splits[0] - Math.round((1218 / v) * 1000)) <= 1, 'flying lap sector 1 split');
  eq(race.cars[0].finishMs, t0.reduce((a, l) => a + l.ms, 0), 'finish = sum of laps');
  eq(race.totalClock(0), race.cars[0].finishMs, 'total clock stops at the finish');
  eq(race.lapClock(0), t0[2].ms, 'lap clock shows the last lap once finished');
});

test('crossing times are interpolated inside the step (not rounded to a step)', () => {
  storage();
  // 120 steps a second: a step is 8.33 ms; times must land between step boundaries
  const { race, cars, until } = setup({ laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 37.3 : 0);
  until(() => race.state === 'done');
  const ms = race.cars[0].times[0].ms;
  const exact = ((8 + L) / 37.3) * 1000;
  expect(Math.abs(ms - exact) <= 9, `lap ${ms} near ${exact.toFixed(1)}`);
  // a time that is a whole number of steps would be a multiple of 25/3 ms: interpolation gives other values
  const offStep = race.cars[0].times[0].splits.some((t) => Math.abs((t * 120) / 1000 - Math.round((t * 120) / 1000)) > 0.13);
  expect(offStep, 'at least one split falls between steps');
});

test('reversing over a line takes nothing; driving it again forwards takes it once', () => {
  storage();
  const { race, cars, events, until, step } = setup({ laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 30 : 0);
  until(() => events.some((e) => e.type === 'sector'));
  eq(events.filter((e) => e.type === 'sector').length, 1, 'sector 1 taken');
  // back 60 m over the sector line, then forwards again over it
  cars[0].speed = () => -10;
  for (let k = 0; k < 120 * 6; k++) step();
  cars[0].speed = () => 30;
  for (let k = 0; k < 120 * 4; k++) step();
  eq(events.filter((e) => e.type === 'sector').length, 1, 'still only one sector 1');
  until(() => race.state === 'done');
  eq(events.filter((e) => e.type === 'sector').length, 2, 'then sector 2, once');
  eq(race.cars[0].times.length, 1, 'one lap');
});

test('backing over the start line and driving the lap the wrong way counts nothing', () => {
  storage();
  const { race, cars, events, step } = setup({ laps: 1, grid: 5 });
  cars[0].speed = (clock) => (clock >= 0 ? -25 : 0);
  for (let k = 0; k < 120 * 150; k++) step(); // 3.7 km backwards: once round the wrong way
  eq(events.filter((e) => e.type === 'sector' || e.type === 'lap').length, 0, 'no line taken');
  expect(race.cars[0].dist < -L, 'distance covered is negative');
});

test('a sector cannot be skipped: a jump over the line (a put-back elsewhere) takes nothing', () => {
  storage();
  const { race, cars, events, step, until } = setup({ laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 30 : 0);
  until(() => race.cars[0].dist > 1100);
  // put somewhere past the sector line in one step (more than RULES.lineJump)
  cars[0].s = wrap(cars[0].s + 300);
  step();
  eq(events.filter((e) => e.type === 'sector').length, 0, 'the jump took no line');
  until(() => race.cars[0].dist > 2100);
  eq(events.filter((e) => e.type === 'sector').length, 0, 'sector 2 is not armed before sector 1');
  expect(race.cars[0].next === 0, 'sector 1 still armed');
});

test('the grid is behind the line: the start line at go is not a lap', () => {
  storage();
  const { race, cars, events, until } = setup({ laps: 2, grid: -3 });
  cars[0].speed = (clock) => (clock >= 0 ? 50 : 0);
  until(() => race.cars[0].dist > 100);
  eq(events.filter((e) => e.type === 'lap').length, 0, 'no lap at the start line');
  eq(race.cars[0].lap, 1, 'still lap one');
});

// ---- two cars -----------------------------------------------------------------------------------------------

test('split: positions, gaps to the other car at each line, end when both finish', () => {
  storage();
  const { race, cars, events, until } = setup({ racers: 2, laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 40 : 0);
  cars[1].speed = (clock) => (clock >= 0 ? 38 : 0);
  until(() => race.state === 'done');
  eq(race.cars[0].position, 1, 'the faster car first');
  eq(race.cars[1].position, 2, 'the slower car second');
  const s1b = events.find((e) => e.type === 'sector' && e.racer === 1 && e.line === 0);
  const s1a = events.find((e) => e.type === 'sector' && e.racer === 0 && e.line === 0);
  eq(s1a.gap, null, 'the leader has no gap at the first line (nobody ahead crossed it)');
  expect(s1b.gap > 0, `the second car is behind at sector 1 (gap ${s1b.gap})`);
  expect(race.cars.every((c) => c.finished), 'both finished');
});

test('split: the race ends RULES.finishWait s after the first finish if the other never arrives', () => {
  storage();
  const { race, cars, until } = setup({ racers: 2, laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 40 : 0);
  until(() => race.state === 'done');
  expect(!race.cars[1].finished, 'the parked car did not finish');
  const waited = race.clock - race.firstFinish / 1000;
  expect(Math.abs(waited - RULES.finishWait) < 0.02, `ended ${waited.toFixed(3)} s after the first finish`);
});

// ---- the board ----------------------------------------------------------------------------------------------

test('medals and formatting', () => {
  const m = RULES.medals;
  eq(medalOf(m.gold), 'gold', 'gold at the target');
  eq(medalOf(m.gold + 1), 'silver', 'silver just over');
  eq(medalOf(m.silver + 1), 'bronze', 'bronze');
  eq(medalOf(m.bronze + 1), null, 'none');
  eq(medalOf(0), null, 'no lap, no medal');
  eq(formatMs(83456), '1:23.456', 'm:ss.mmm');
  eq(formatMs(1234, true), '+1.234', 'signed');
  eq(formatMs(-456, true), '-0.456', 'negative');
  eq(formatMs(null), '-:--.---', 'no time');
});

function runLaps(time, speeds, { putBackLap = -1, laps = speeds.length } = {}) {
  const { race, cars, until } = setup({ laps, time });
  let lap = 0;
  cars[0].speed = (clock) => (clock >= 0 ? speeds[Math.min(lap, speeds.length - 1)] : 0);
  until(() => {
    lap = race.cars[0].lap - 1;
    if (lap === putBackLap && !race.cars[0].putBack && race.cars[0].dist - lap * L > 500) race.notePutBack(0);
    return race.state === 'done';
  });
  return race;
}

test('the board: best five per time of day, sorted, kept across a new Race (a reload)', () => {
  const map = storage();
  runLaps('day', [40, 41, 42]);
  runLaps('day', [43, 44, 45]);
  const raw = JSON.parse(map.get('dreamcar.best.v2'));
  eq(raw.length, L, 'kept against the road length');
  eq(raw.day.laps.length, RULES.boardRows, 'five rows kept of six laps');
  const ms = raw.day.laps.map((l) => l.ms);
  expect(ms.every((v, i) => i === 0 || ms[i - 1] <= v), 'sorted fastest first');
  expect(raw.day.flying && raw.day.standing, 'standing and flying references kept');
  expect(raw.day.best3 > 0, 'a three-lap total');
  const again = new Race(track, { racers: 1, laps: 3, time: 'day', mode: 'solo', rng: createRng(1) });
  eq(again.table.laps.length, RULES.boardRows, 'reloaded');
  eq(again.table.laps[0].ms, ms[0], 'same best');
  // another time of day starts empty, and does not touch day
  const night = new Race(track, { racers: 1, laps: 3, time: 'night', mode: 'solo', rng: createRng(1) });
  eq(night.table.laps.length, 0, 'night empty');
  runLaps('dusk', [39]);
  const raw2 = JSON.parse(map.get('dreamcar.best.v2'));
  eq(raw2.dusk.laps.length, 1, 'a dusk table made on first use');
  eq(raw2.day.laps.length, RULES.boardRows, 'day untouched');
});

test('a lap with a put-back counts for the run but not for the board', () => {
  const map = storage();
  const race = runLaps('day', [40, 40, 40], { putBackLap: 1 });
  eq(race.cars[0].times.length, 3, 'three laps run');
  expect(race.cars[0].times[1].putBack, 'lap two marked');
  expect(!race.cars[0].times[0].putBack && !race.cars[0].times[2].putBack, 'the others clean (the flag is per lap)');
  const raw = JSON.parse(map.get('dreamcar.best.v2'));
  eq(raw.day.laps.length, 2, 'two laps on the board');
  eq(raw.day.best3, null, 'no three-lap total from a run with a put-back');
});

test('a short run (?laps=1) puts its lap on the board but makes no three-lap total', () => {
  const map = storage();
  runLaps('night', [40]);
  const raw = JSON.parse(map.get('dreamcar.best.v2'));
  eq(raw.night.laps.length, 1, 'one lap');
  eq(raw.night.best3, null, 'no total');
});

test('the second run gets a gap to the best lap at every line, and a live gap', () => {
  storage();
  runLaps('day', [40]);
  const { race, cars, events, until } = setup({ laps: 1 });
  cars[0].speed = (clock) => (clock >= 0 ? 39 : 0);
  let live = null;
  until(() => {
    if (race.cars[0].live !== null) live = race.cars[0].live;
    return race.state === 'done';
  });
  const sectors = events.filter((e) => e.type === 'sector');
  expect(sectors.every((e) => typeof e.gap === 'number' && e.gap > 0), 'slower at each sector line: positive gaps');
  expect(live !== null && live > 0, `a live gap (${live})`);
  const lap = events.find((e) => e.type === 'lap');
  expect(lap.gap > 0 && lap.best === false, 'slower lap: positive gap, not a best');
});

test('storage unavailable: the race runs, the board lives for the page, nothing throws', () => {
  storage({ broken: true });
  const race = runLaps('day', [40, 41]);
  eq(race.cars[0].times.length, 2, 'two laps run');
  eq(race.table.laps.length, 2, 'the board holds them for this page');
});

test('storage holding rubbish: ignored, the board starts empty', () => {
  for (const junk of ['{', '"x"', JSON.stringify({ length: L, day: { laps: [{ ms: -5 }, { ms: 'a' }, null], best3: 'x' } }),
    JSON.stringify({ length: 999, day: { laps: [{ ms: 90000 }] } })]) {
    const map = storage();
    map.set('dreamcar.best.v2', junk);
    const race = new Race(track, { racers: 1, laps: 3, time: 'day', mode: 'solo', rng: createRng(1) });
    eq(race.table.laps.length, 0, `no laps from ${junk.slice(0, 40)}`);
    eq(race.table.best3, null, 'no total');
  }
});

console.log(`\nrace: ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
