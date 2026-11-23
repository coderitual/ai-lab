// The quality governor: what to give up when frames run long, and when to
// take it back. A pure function of the frame times it is fed: no clock, no
// renderer, nothing of the page. Engine.js feeds it each frame's real time and
// reads the level back; tools/unit/governor.test.mjs feeds it made-up phones.
//
// A ladder, not one knob. Level 0 is everything the tier draws at full
// resolution. Each level above it sheds one more rung: first the tier's own
// list of things that are hard to see go (`rungs`: the reflection probe's
// cadence, motion-blur samples, how far the trees keep their detail, ambient
// occlusion, half the multisampling), and only when all of those are shed
// does the render scale come down, step by step, to the tier's floor and no
// further. Resolution is the last thing a small dense screen should lose:
// sharpness is most of what reads as quality there.
//
//   level:  0 ... rungs.length          rungs.length + 1 ...            max
//   shed:   that many rungs             all of them                     all
//   scale:  1                           SCALE_STEPS[1] ...              the floor
//
// Down: frames slower than `slowFrame` for about a second and a half shed one
// level.
//
// The frame-rate cap. A browser that limits the frame rate itself (iOS in Low
// Power Mode draws 30 a second whatever is drawn) would drag everything to the
// bottom for nothing. So the first time frames are slow, before anything is
// believed, the governor makes one trial: everything to the bottom for forty
// frames. If the frame time does not improve by `helped`, nothing on the
// ladder can buy frame rate here: the level goes back to where it was, the
// frame time is remembered as the cap, and from then on only frames clearly
// slower than the cap count as slow. If the trial helps, the device really is
// short of time (`proven`): the level lands one below where it was and steps
// on from there in order. The cap is forgotten when enough frames run clearly
// faster than it (the mode was switched off).
//
// "Cap" is also what a slow device ends with: when the last steps down gain
// nothing more, the frame time reached is the best this device does, and the
// same rule then holds it: steady at that rate counts as steady, and the
// governor climbs back to the highest level that still keeps it.
//
// A cap can also come on later. So every step down is measured (the trimmed
// mean of thirty frames before and after). One rung is too small to show
// under vsync, where frame times come in whole refresh intervals, so a step
// that gained nothing is kept; but after `episode` steps in a row that gained
// nothing together the trial is made again, from where those steps began: if
// it helps, the steps stand, and if not they are undone and the cap is known.
//
// Up: there is no way to measure spare time under vsync, so after a long
// steady stretch (a slow frame now and then shortens it, it does not end it)
// the next level up is simply tried. If that brings the slow
// frames back soon after, it is taken back without a trial and the wait
// before the next try doubles.

/** The render scales, largest first. A governor uses those not below its floor. */
export const SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5];

export const GOVERNOR = {
  /** Below about 48 frames a second for a while: shed a level. */
  slowFrame: 1 / 48,
  /** Seconds of slow frames (net of fast ones, which count double against them) before a step down. */
  slowFor: 1.5,
  /** ...and half of that while frames take more than this many times the limit: a long way to go. */
  hurry: 2,
  /** Not during the first frames: they are slow for another reason, shaders being compiled. */
  warmup: 30,
  /** A frame longer than this (s) is a hiccup (a hidden tab, a compile), not a measure of anything. */
  hiccup: 0.25,
  /** After a step: frames left out while the new targets settle, then frames measured. */
  settle: 10,
  measure: 30,
  /** A step, or a trial, helped if the frame time after it is at most this share of the time before. */
  helped: 0.93,
  /** Steps down in a row that gained nothing together before they are all undone and the frame time is taken for a cap. */
  episode: 3,
  /** Under a cap only frames longer than this many times the cap count as slow... */
  capSlack: 1.25,
  /**
   * ...and the cap is forgotten once frames shorter than this share of it have added up to `capLiftFor` seconds,
   * every other frame taking `capLiftDecay` of its own time off that sum: about one frame in six must be fast.
   */
  capLift: 0.8,
  capLiftFor: 1,
  capLiftDecay: 0.1,
  /** How many times its own length a slow frame takes off the count of steady seconds. */
  unsteady: 4,
  /** Seconds of steady frames before a step up is tried; doubles (to `maxPatience`) when a try fails within `retry` seconds. */
  patience: 6,
  maxPatience: 120,
  retry: 10,
};

/**
 * @typedef {object} Governor
 * @property {string[]} rungs what is shed before any resolution, least visible first
 * @property {number[]} scales the render scales this governor may use, largest first
 * @property {number} max the last level
 * @property {number} level 0: nothing shed
 * @property {boolean} proven shedding has been seen to help: slow frames are this device's own
 * @property {number|null} cap seconds a frame takes whatever is drawn (a frame-rate cap), once found
 * @property {object|null} watch the measurement under way after a step or during a trial
 * @property {number} trials trials made so far (for tests and the readout)
 */

/**
 * @param {{ rungs?: string[], floor?: number }} [options] `floor`: the smallest render scale allowed
 * @returns {Governor}
 */
export function createGovernor({ rungs = [], floor = SCALE_STEPS[SCALE_STEPS.length - 1] } = {}) {
  const scales = SCALE_STEPS.filter((s) => s >= floor - 1e-6);
  return {
    rungs: rungs.slice(),
    scales,
    max: rungs.length + scales.length - 1,
    level: 0,
    frames: 0,
    slow: 0,
    steady: 0,
    fast: 0,
    patience: GOVERNOR.patience,
    sinceUp: Infinity,
    proven: false,
    cap: null,
    watch: null,
    anchor: null,
    trials: 0,
    recent: new Float64Array(GOVERNOR.measure),
    seen: 0,
  };
}

/**
 * Does the governor run at all? Not where frames are stepped by hand or never drawn, and not where the address asks
 * for an exact picture (a pixel ratio, a render scale, a number of rungs shed): stills and tests must be the same
 * picture every time.
 * @param {{ manual?: boolean, draws?: boolean, pixelRatio?: number|null, renderScale?: number|null, shed?: number|null }} o
 */
export function adaptiveFor({ manual = false, draws = true, pixelRatio = null, renderScale = null, shed = null }) {
  return !manual && draws && pixelRatio === null && renderScale === null && shed === null;
}

/**
 * Begin at `level` instead of the top: where this device ended the last time it was here. It is taken as proven (a
 * level below the top was only ever reached because shedding helped), so slow frames step on from it without a
 * trial, and steady ones climb back from it as from any level.
 * @param {Governor} g @param {number} level
 */
export function startGovernorAt(g, level) {
  g.level = Math.max(0, Math.min(g.max, Math.round(level) || 0));
  g.proven = g.level > 0;
}

/** How many rungs level `level` sheds. @param {Governor} g */
export function shedAt(g, level = g.level) {
  return Math.min(g.rungs.length, Math.max(0, level));
}

/** The render scale of level `level`. @param {Governor} g */
export function scaleAt(g, level = g.level) {
  return g.scales[Math.min(g.scales.length - 1, Math.max(0, level - g.rungs.length))];
}

/** The mean of `values` without its three largest and three smallest: a few hitches do not move it. */
function trimmedMean(values, n) {
  const v = Array.from(values.subarray ? values.subarray(0, n) : values.slice(0, n)).sort((a, b) => a - b);
  const cut = n >= 12 ? 3 : 0;
  let sum = 0;
  for (let i = cut; i < n - cut; i++) sum += v[i];
  return sum / Math.max(1, n - 2 * cut);
}

/** The frame time lately (s): the trimmed mean of the last thirty frames. @param {Governor} g */
export function frameTime(g) {
  const n = Math.min(g.seen, g.recent.length);
  return n ? trimmedMean(g.recent, n) : 0;
}

/**
 * One frame took `dt` seconds of real time. Changes `g` and says whether its level changed.
 * @param {Governor} g
 * @param {number} dt
 * @returns {boolean}
 */
export function governorStep(g, dt) {
  const G = GOVERNOR;
  if (!(dt > 0)) return false;
  g.frames++;
  if (g.frames <= G.warmup || dt > G.hiccup) return false;
  g.sinceUp += dt;
  const before = g.level;

  if (g.watch) {
    const w = g.watch;
    w.frames++;
    if (w.frames > G.settle) w.times[w.n++] = dt;
    if (w.n >= G.measure) {
      const after = trimmedMean(w.times, w.n);
      g.watch = null;
      g.slow = g.steady = 0;
      g.seen = 0;
      if (w.trial) {
        if (after <= w.before * G.helped) {
          // the device is short of time: on from where it was, one level at a time
          g.proven = true;
          g.level = Math.min(g.max, w.land);
        } else {
          // nothing on the ladder buys frame rate here: back, and this frame time is the cap
          g.cap = after;
          g.proven = false;
          g.level = w.from;
        }
      } else if (g.anchor) {
        if (after <= g.anchor.before * G.helped) g.anchor = null;
        else if (++g.anchor.steps >= G.episode || g.level >= g.max) {
          // Several steps and nothing gained. Either they are too small to show, or something else holds the
          // frame time now (a cap that came on since the last trial): ask again, from where the steps began.
          const a = g.anchor;
          g.anchor = null;
          if (g.level >= g.max) {
            // (already at the bottom: this measurement was the trial)
            g.cap = after;
            g.proven = false;
            g.level = a.level;
          } else {
            g.trials++;
            g.watch = { trial: true, from: a.level, land: g.level, before: a.before, frames: 0, n: 0, times: new Float64Array(G.measure) };
            g.level = g.max;
          }
        }
      }
    }
    return g.level !== before;
  }

  g.recent[g.seen % g.recent.length] = dt;
  g.seen++;

  const limit = g.cap !== null ? Math.max(G.slowFrame, g.cap * G.capSlack) : G.slowFrame;
  if (dt > limit) {
    g.slow += Math.min(dt, 0.1);
    // (a slow frame takes `unsteady` times its length off the steady count, it does not empty it: one long frame
    // every second or so, which every real page has, must not keep a device from ever stepping back up)
    g.steady = Math.max(0, g.steady - Math.min(dt, 0.1) * G.unsteady);
  } else {
    g.slow = Math.max(0, g.slow - dt * 2);
    g.steady += dt;
  }
  if (g.cap !== null) {
    if (dt < g.cap * G.capLift) g.fast += dt;
    else g.fast = Math.max(0, g.fast - dt * G.capLiftDecay);
    if (g.fast > G.capLiftFor) {
      g.cap = null;
      g.fast = 0;
    }
  }

  const need = dt > limit * G.hurry ? G.slowFor / 2 : G.slowFor;
  if (g.slow > need && g.level < g.max) {
    g.slow = 0;
    const now = frameTime(g);
    if (g.sinceUp < G.retry) {
      // slow again right after a step up: that try failed. Take it back, and be more patient next time.
      g.patience = Math.min(G.maxPatience, g.patience * 2);
      g.sinceUp = Infinity;
      g.level++;
    } else if (!g.proven) {
      g.trials++;
      g.watch = { trial: true, from: g.level, land: g.level + 1, before: now, frames: 0, n: 0, times: new Float64Array(G.measure) };
      g.level = g.max;
    } else {
      if (!g.anchor) g.anchor = { level: g.level, before: now, steps: 0 };
      g.watch = { trial: false, from: g.level, before: now, frames: 0, n: 0, times: new Float64Array(G.measure) };
      g.level++;
    }
  } else if (g.steady > g.patience && g.level > 0) {
    g.steady = 0;
    g.sinceUp = 0;
    g.anchor = null;
    g.level--;
  }
  return g.level !== before;
}
