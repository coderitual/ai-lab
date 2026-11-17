// The rules and the clock of one run: the start, laps and sectors, gaps, the
// finish, and the board of best laps kept on this device.
//
// One clock. It starts negative, reaches zero at lights out, and everything
// about the start reads it: the camera's sweep, the gantry's lamps, the held
// cars, the lap clock. It advances only in the fixed step, by whole steps, so
// a run that is fast-forwarded is the same run to the millisecond.
//
// Progress, not position. Each car's distance covered is the sum of each
// step's change in `s` (taken the short way round), so laps are counted from
// how far it has really gone. Of the three lines in a lap (two sector lines,
// then the start and finish) only the next one is armed, and it is taken only
// by a small forward step: reversing over a line, driving the lap backwards or
// a put-back never takes one. The moment a line is crossed is interpolated
// inside the step, which gives millisecond times at 120 steps a second, and
// that one integer of milliseconds is what every reader uses.
//
// Rules never draw: what happens comes out as events (count, go, sector, lap,
// finish, end) for the HUD and the sound.

import { RULES } from './config.js';

const STORE_KEY = 'dreamcar.best.v1';

/**
 * @typedef {object} Lap
 * @property {number} ms
 * @property {number[]} splits time at each of the three lines from the lap's start (ms), the last = ms
 * @property {boolean} standing the lap from the grid
 * @property {boolean} putBack the car was put back during it (counts for the run, not for the board)
 *
 * @typedef {object} RaceEvent
 * @property {'count'|'go'|'sector'|'lap'|'finish'|'end'} type
 * @property {number} [racer]
 * @property {number} [n] lamps lit (count)
 * @property {number} [line] 0, 1 sector lines, 2 the lap's end
 * @property {number} [lap] 1-based
 * @property {number} [ms] lap time so far at the line, or the lap's time
 * @property {number|null} [gap] ms to the reference (+ = behind), null when there is none
 * @property {boolean} [best] a new best lap of this device
 */

/** What a board entry for one time of day holds. */
const emptyTable = () => ({ laps: [], best3: null, standing: null, flying: null });

/** The board, as kept: validated on load, dropped if it was set on a road of another length. */
function loadBoard(length) {
  // one table per time of day, made when first asked for (lighting.js decides which times there are)
  const board = { length: Math.round(length) };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || raw.length !== board.length) return board;
    for (const time of Object.keys(raw)) {
      const t = raw[time];
      if (time === 'length' || !/^[a-z]{1,16}$/.test(time) || !t || typeof t !== 'object') continue;
      board[time] = emptyTable();
      const ms = (v) => Number.isInteger(v) && v > 0 && v < 3600000;
      board[time].laps = Array.isArray(t.laps) ? t.laps.filter((l) => l && ms(l.ms)).slice(0, RULES.boardRows) : [];
      board[time].best3 = ms(t.best3) ? t.best3 : null;
      for (const kind of ['standing', 'flying']) {
        const r = t[kind];
        if (r && ms(r.ms) && Array.isArray(r.splits) && r.splits.length === 3 && Array.isArray(r.at)) board[time][kind] = r;
      }
    }
  } catch {
    // no storage, or something else's data under our key: start empty
  }
  return board;
}

function saveBoard(board) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(board));
  } catch {
    // full, private, or switched off: the board lives for this page only
  }
}

/** Medal of a lap against the targets: 'gold' | 'silver' | 'bronze' | null. */
export function medalOf(ms) {
  if (!(ms > 0)) return null;
  const m = RULES.medals;
  return ms <= m.gold ? 'gold' : ms <= m.silver ? 'silver' : ms <= m.bronze ? 'bronze' : null;
}

/** 83456 -> '1:23.456'; with `sign`, '+1.234' / '-0.456' (and minutes when needed). */
export function formatMs(ms, sign = false) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-:--.---';
  const neg = ms < 0;
  let v = Math.abs(Math.round(ms));
  const m = Math.floor(v / 60000);
  v -= m * 60000;
  const s = Math.floor(v / 1000);
  const r = v - s * 1000;
  const body = m > 0 || !sign ? `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}` : `${s}.${String(r).padStart(3, '0')}`;
  return sign ? `${neg ? '-' : '+'}${body}` : body;
}

export class Race {
  /**
   * @param {import('./track.js').Track} track
   * @param {object} options
   * @param {number} options.racers 1 or 2
   * @param {number} [options.laps]
   * @param {string} options.time which table of the board the run is set against
   * @param {'solo'|'split'} options.mode
   * @param {import('../engine/rng.js').Rng} options.rng the start's hold is drawn from rng.fork('start')
   */
  constructor(track, { racers, laps = RULES.laps, time, mode, rng }) {
    this.track = track;
    this.laps = laps;
    this.mode = mode;
    this.time = time;
    this.board = loadBoard(track.length);
    const hold = rng.fork('start').range(RULES.holdMin, RULES.holdMax);
    /** The hold after the fifth lamp (s). */
    this.hold = hold;
    /** When the first lamp lights, on the race clock (s, negative). */
    this.firstLamp = -(hold + RULES.lampStep * (RULES.lamps - 1));
    /** The clock's start: the camera's sweep and its settling before the first lamp. */
    this.lead = -this.firstLamp + RULES.sweep + RULES.settle;
    this._steps = 0;
    /** The race clock (s): negative before the start, zero at lights out. */
    this.clock = -this.lead;
    /** 'countdown' | 'run' | 'done' */
    this.state = 'countdown';
    this.lit = 0;
    /** @type {RaceEvent[]} since the last drain */
    this.events = [];
    this.firstFinish = null;
    const L = track.length;
    // the sector lines and the lap's end as distances into the lap
    this.lines = [track.sectors[0], track.sectors[1], L];
    this.cars = Array.from({ length: racers }, (_, index) => ({
      index,
      dist: 0, // distance covered since the start line (negative on the grid)
      lastS: null,
      lap: 1, // the lap being driven (laps + 1 once finished)
      next: 0, // the armed line of this lap
      lapStart: 0, // ms on the race clock when this lap began
      splits: [],
      /** @type {Lap[]} */
      times: [],
      putBack: false,
      finished: false,
      finishMs: null,
      position: index + 1,
      /** Race-clock ms at each line taken: key lap * 3 + line. */
      crossed: new Map(),
      /** This lap's time at every gapStep metres (ms). */
      at: [],
      /** now minus the reference lap at the same point of the lap (ms), or null. */
      live: null,
      lastGap: null,
      input: 'keys',
    }));
  }

  /** The table of the board this run is set against. */
  get table() {
    return (this.board[this.time] ||= emptyTable());
  }

  /** Switch the time of day the board follows (each time of day has its own). */
  setTime(time) {
    this.time = time;
  }

  /** Lamps lit on the gantry now, 0..5. */
  lampsAt(clock) {
    if (clock >= 0 || clock < this.firstLamp) return 0;
    return Math.min(RULES.lamps, 1 + Math.floor((clock - this.firstLamp) / RULES.lampStep + 1e-9));
  }

  /** The lap clock of car `i` (ms): the lap being driven, or the last lap once finished. */
  lapClock(i) {
    const c = this.cars[i];
    if (this.clock < 0) return 0;
    if (c.finished) return c.times.length ? c.times[c.times.length - 1].ms : 0;
    return Math.round(this.clock * 1000) - c.lapStart;
  }

  /** The total of car `i` so far (ms). */
  totalClock(i) {
    const c = this.cars[i];
    return c.finished ? c.finishMs : Math.max(0, Math.round(this.clock * 1000));
  }

  /** The reference lap for car `c`'s current lap: the best standing-start lap for lap one, the best flying lap after. */
  reference(c) {
    return c.lap === 1 ? this.table.standing : this.table.flying;
  }

  /** The car was put back: its lap no longer goes on the board. */
  notePutBack(i) {
    this.cars[i].putBack = true;
  }

  /**
   * One fixed step.
   * @param {number} dt
   * @param {Array<{ s: number }>} vehicles one per car, in order
   */
  update(dt, vehicles) {
    if (this.state === 'done') return;
    const before = this.clock;
    this._steps++;
    this.clock = this._steps * dt - this.lead;
    const lit = this.lampsAt(this.clock);
    if (lit !== this.lit) {
      if (lit > this.lit) this.events.push({ type: 'count', n: lit });
      this.lit = lit;
    }
    if (before < 0 && this.clock >= 0) {
      this.state = 'run';
      this.events.push({ type: 'go' });
    }
    for (let i = 0; i < this.cars.length; i++) this._follow(this.cars[i], vehicles[i].s, before, dt);
    if (this.clock >= 0) this._positions();
    if (this.state === 'run') {
      const all = this.cars.every((c) => c.finished);
      const waited = this.firstFinish !== null && this.clock - this.firstFinish / 1000 >= RULES.finishWait;
      if (all || waited) {
        this.state = 'done';
        this.events.push({ type: 'end' });
      }
    }
  }

  _follow(c, s, before, dt) {
    const track = this.track;
    if (c.lastS === null) {
      c.lastS = s;
      c.dist = track.delta(0, s);
      return;
    }
    const d = track.delta(c.lastS, s);
    const d0 = c.dist;
    c.lastS = s;
    c.dist += d;
    if (this.clock < 0 || c.finished) return;
    const L = track.length;
    const base = (c.lap - 1) * L;
    // this lap's time at every gapStep metres, and how it compares with the reference lap there
    const into = c.dist - base;
    const k = Math.floor(into / RULES.gapStep);
    if (d > 0 && k >= 0 && k > c.at.length - 1 && into < L) {
      const nowMs = Math.round(this.clock * 1000) - c.lapStart;
      while (c.at.length <= k) c.at.push(nowMs);
      const ref = this.reference(c);
      c.live = ref && ref.at[k] !== undefined ? nowMs - ref.at[k] : null;
    }
    if (!(d > 0 && d < RULES.lineJump)) return;
    const line = base + this.lines[c.next];
    if (d0 < line && c.dist >= line) {
      // the moment it was crossed, inside the step
      const t = before + (dt * (line - d0)) / d;
      this._cross(c, Math.round(t * 1000));
    }
  }

  _cross(c, atMs) {
    const lineIndex = c.next;
    const lapMs = atMs - c.lapStart;
    c.splits.push(lapMs);
    c.crossed.set(c.lap * 3 + lineIndex, atMs);
    // the gap: to the other car at the same line in split screen, to this device's best lap alone
    let gap = null;
    if (this.cars.length > 1) {
      const other = this.cars[1 - c.index].crossed.get(c.lap * 3 + lineIndex);
      gap = other !== undefined ? atMs - other : null;
    } else {
      const ref = this.reference(c);
      gap = ref ? lapMs - ref.splits[lineIndex] : null;
    }
    c.lastGap = gap;
    if (lineIndex < 2) {
      c.next++;
      this.events.push({ type: 'sector', racer: c.index, line: lineIndex, lap: c.lap, ms: lapMs, gap });
      return;
    }
    /** @type {Lap} */
    const lap = { ms: lapMs, splits: c.splits.slice(), standing: c.lap === 1, putBack: c.putBack };
    c.times.push(lap);
    const best = this._record(c, lap);
    this.events.push({ type: 'lap', racer: c.index, lap: c.lap, ms: lapMs, gap, best });
    c.lap++;
    c.next = 0;
    c.lapStart = atMs;
    c.splits = [];
    c.at = [];
    c.putBack = false;
    c.live = null;
    if (c.lap > this.laps) {
      c.finished = true;
      c.finishMs = atMs;
      if (this.firstFinish === null) this.firstFinish = atMs;
      this.events.push({ type: 'finish', racer: c.index, ms: atMs, position: c.position });
    }
  }

  /** Put a lap on the board when it earns a place; returns whether it is the best of this device. */
  _record(c, lap) {
    if (lap.putBack) return false;
    const table = this.table;
    const wasBest = table.laps.length ? table.laps[0].ms : Infinity;
    table.laps.push({ ms: lap.ms, input: c.input, mode: this.mode, standing: lap.standing });
    table.laps.sort((a, b) => a.ms - b.ms);
    table.laps.length = Math.min(table.laps.length, RULES.boardRows);
    const kind = lap.standing ? 'standing' : 'flying';
    if (!table[kind] || lap.ms < table[kind].ms) table[kind] = { ms: lap.ms, splits: lap.splits, at: c.at.slice() };
    // the three-lap total: only from a run of the standard length, every lap clean
    if (this.laps === RULES.laps && c.times.length === this.laps && c.times.every((l) => !l.putBack)) {
      const total = c.times.reduce((sum, l) => sum + l.ms, 0);
      if (table.best3 === null || total < table.best3) table.best3 = total;
    }
    saveBoard(this.board);
    return lap.ms < wasBest;
  }

  _positions() {
    const order = this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishMs - b.finishMs;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.dist - a.dist;
    });
    order.forEach((c, i) => (c.position = i + 1));
  }

  /** The car's best lap of this run (ms), or null. */
  bestLap(i) {
    const times = this.cars[i].times;
    return times.length ? Math.min(...times.map((l) => l.ms)) : null;
  }

  /** Move the events out. */
  drain(out = []) {
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }
}
