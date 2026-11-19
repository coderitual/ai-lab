// What has happened to the road since it was laid: which stretch was
// resurfaced when, what was dug up and patched, where it has cracked and been
// sealed, the covers and gratings set into it, what cars have dripped on it.
//
// None of this can come from a repeating texture: the eye finds the repeat
// within three bends. So it is a list of single things, each with a place on
// the Track, written by rules that know the road (an old stretch in the wood
// has more patches than the viaduct's new deck; a trench leads to a manhole;
// the grid's boxes have oil under them), drawn in the asphalt shader exactly,
// as shapes in track coordinates, at any distance and any resolution.
//
// The shader cannot loop over a few hundred things per pixel, so the lap is
// cut into cells of FEATURE_CELL metres and each cell holds the few things
// that reach into it: a small float texture, one column per cell.
//   row 0      the surfacing: its age before and after a joint in this cell
//              (0 laid this year .. 1 a generation old), and where the joint is
//   rows 1..   one thing each: (middle along the road relative to the cell's
//              start, middle across it, half length and half width packed in
//              centimetres, kind + 16 * seed + 4096 * parameter)
// A cell with more things than rows keeps the weightiest (a joint before a
// crack), so the low tier, with fewer rows, drops the small ones first.

import * as THREE from 'three';
import { corridorOf } from './corridor.js';

/** What a thing is. The asphalt shader (road.js) has the same numbers. */
export const FEATURE = { PATCH: 1, TRENCH: 2, CUT: 3, CRACK: 4, CRACK_ACROSS: 5, COVER: 6, DRAIN: 7, JOINT: 8, STAIN: 9 };
/** Metres of road per cell of the table. */
export const FEATURE_CELL = 4;
/** Things per cell, by tier. */
export const FEATURE_SLOTS = { low: 3, medium: 5, high: 7 };

/** Which of two things in a crowded cell is kept. */
const WEIGHT = { 8: 10, 6: 9, 7: 8, 1: 7, 2: 6, 3: 6, 9: 4, 4: 3, 5: 3 };
/** Grid places marked on the straight (track.grid gives each). */
export const GRID_SLOTS = 12;

/** A circuit is resurfaced a stretch at a time: the age of each (0 new .. 1 old) is drawn per run of this length (m). */
const RUN = { min: 260, max: 620 };
/** Ages of the runs lie in this range; a bridge deck has its own surfacing. */
const AGE_RANGE = [0.12, 0.62];
const DECK_AGE = 0.2;
/** Paving seams along the road: the paver laid the width in strips; their joints lie this far either side of the middle (m). */
export const SEAM_LAT = 2;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('../../engine/caps.js').Tier} options.tier
 */
export function roadHistory({ track, rng, tier }) {
  const co = corridorOf(track);
  const n = track.count;
  const ds = track.ds;
  const L = track.length;
  const half = track.halfWidth;
  const wrap = (s) => track.wrap(s);
  const at = (s) => Math.round(wrap(s) / ds) % n;
  const inRanges = (s, ranges, margin = 0) => (ranges ?? []).some((r) => s > r.s0 - margin && s < r.s1 + margin);

  // ---- the surfacing: runs of one age, joints where it changes
  const age = new Float32Array(n);
  {
    const r = rng.fork('surfacing');
    let s0 = 0;
    while (s0 < L) {
      const len = Math.min(L - s0, r.range(RUN.min, RUN.max));
      const a = r.range(AGE_RANGE[0], AGE_RANGE[1]);
      for (let i = Math.ceil(s0 / ds); i * ds < s0 + len && i < n; i++) age[i] = a;
      s0 += len;
    }
    for (let i = 0; i < n; i++) if (inRanges(i * ds, track.bridges)) age[i] = DECK_AGE;
  }

  /** @type {Array<{ kind: number, s: number, lat: number, hl: number, hw: number, seed: number, param: number, reach: number }>} */
  const things = [];
  const counts = {};
  /** `reach`: how far along the road it extends either side of its middle (m), turned or not. */
  const add = (kind, s, lat, hl, hw, seed, param, reach = hl) => {
    things.push({ kind, s: wrap(s), lat, hl: Math.min(40.9, hl), hw: Math.min(40.9, hw), seed, param, reach: Math.min(40.9, reach) + 0.1 });
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  /** Stretches where nothing is patched or cracked: the grid and the start line. */
  const kept = (s, margin) => {
    const d = track.delta(0, s);
    return d > -GRID_REACH - margin && d < 3 + margin;
  };
  const GRID_REACH = 8 * GRID_SLOTS + 10;

  // ---- patches: the older the road, the more of them
  {
    const r = rng.fork('patches');
    for (let s = r.range(5, 30); s < L; ) {
      const a = age[at(s)];
      // per 100 m (road lane: E2 and E5 show a patch every hundred metres or two of an old forest road)
      const density = 0.2 + 1.3 * a * a;
      const len = r.range(1.2, 6) * (r.next() < 0.25 ? 2 : 1);
      if (!kept(s, len) && !inRanges(s, track.bridges, 3)) {
        const side = r.sign();
        const style = r.next();
        const tone = r.range(0.05, 0.85);
        if (style < 0.5) {
          // one paver's strip, between its seams
          const lat = r.pick([-2 * SEAM_LAT, 0, 2 * SEAM_LAT]);
          add(FEATURE.PATCH, s, lat, len * 2.5, SEAM_LAT - 0.02, r.next(), tone);
        } else if (style < 0.8) {
          // right across the road
          add(FEATURE.PATCH, s, 0, len, half - 0.34, r.next(), tone);
        } else {
          // a small square over a pothole
          const w = r.range(0.4, 0.9);
          add(FEATURE.PATCH, s, side * r.range(0.6, half - 1), w * r.range(0.8, 1.4), w, r.next(), tone);
        }
      }
      s += (100 / density) * r.range(0.35, 1.65);
    }
  }

  // ---- a slot drain across the road outside each portal
  {
    const r = rng.fork('trenches');
    for (const t of track.tunnels ?? []) {
      add(FEATURE.DRAIN, t.s0 - 6, 0, 0.11, half + 0.4, r.next(), 1);
      add(FEATURE.DRAIN, t.s1 + 6, 0, 0.11, half + 0.4, r.next(), 1);
    }
  }

  // ---- expansion joints: both ends of every deck and over its piers
  for (const b of track.bridges ?? []) {
    const spans = Math.max(1, Math.round((b.s1 - b.s0) / 30));
    for (let k = 0; k <= spans; k++) {
      const s = k === 0 ? b.s0 + 0.4 : k === spans ? b.s1 - 0.4 : b.s0 + ((b.s1 - b.s0) * k) / spans;
      add(FEATURE.JOINT, s, 0, k === 0 || k === spans ? 0.16 : 0.07, half + 1.5, 0.5, k === 0 || k === spans ? 1 : 0);
    }
  }

  // ---- cracks, sealed with tar: along the road in the wheel tracks and the joints between lanes, and right across it
  {
    const r = rng.fork('cracks');
    const lines = [SEAM_LAT, -SEAM_LAT, SEAM_LAT, -SEAM_LAT, half - 0.4, -(half - 0.4)];
    for (let s = r.range(0, 20); s < L; ) {
      const a = age[at(s)];
      const len = r.range(3, 14);
      if (a > 0.2 && !kept(s, len) && !inRanges(s, track.bridges, 2)) {
        const lat = r.next() < 0.75 ? r.pick(lines) + r.range(-0.08, 0.08) : r.range(-(half - 0.3), half - 0.3);
        add(FEATURE.CRACK, s, lat, len, r.range(0.06, 0.3), r.next(), r.next() * a);
      }
      // (road lane: one or two a hundred metres on a run of middle age, as in E2)
      s += r.range(20, 90) / (0.35 + 2.4 * a * a);
    }
    for (let s = r.range(0, 30); s < L; ) {
      const a = age[at(s)];
      if (a > 0.45 && !kept(s, 1) && !inRanges(s, track.bridges, 2)) {
        const whole = r.next() < 0.55;
        const side = r.sign();
        add(FEATURE.CRACK_ACROSS, s, whole ? 0 : side * SEAM_LAT * 1.5, r.range(0.08, 0.3), whole ? half - 0.1 : r.range(1.2, 2.8), r.next(), r.next() * a, 0.5);
      }
      s += r.range(40, 160) / (0.1 + 1.6 * a * a);
    }
  }

  // ---- stains: under the cars on the grid, and where others have stood or laboured
  {
    const r = rng.fork('stains');
    const where = { index: -1, s: 0, lat: 0 };
    for (let slot = 0; slot < GRID_SLOTS; slot++) {
      const g = track.grid(slot);
      track.locate(g.x, g.z, -1, where);
      const s = where.s;
      const lat = where.lat;
      // oil under the sump, coolant further forward, and what the rear tyres left at the start
      add(FEATURE.STAIN, s + 1.2, lat + r.range(-0.15, 0.15), r.range(0.2, 0.34), r.range(0.14, 0.22), r.next(), 0.1);
      add(FEATURE.STAIN, s + 1.95, lat + r.range(-0.3, 0.3), r.range(0.22, 0.4), r.range(0.12, 0.2), r.next(), 0.5);
      for (const side of [1, -1]) add(FEATURE.STAIN, s - 1.4 + 2.6, lat + side * 0.8, 2.6, 0.125, r.next(), 0.9);
    }
    // a few drips where cars run, and tyre marks where they braked hardest: pairs of black lines on the racing line
    for (let s = r.range(0, 60); s < L; s += r.range(40, 140)) {
      if (kept(s, 2)) continue;
      const lat = co.line[at(s)] + r.range(-1.2, 1.2);
      const size = r.range(0.08, 0.25);
      add(FEATURE.STAIN, s, lat, size * r.range(1, 2.4), size, r.next(), r.next() < 0.8 ? 0.1 : 0.5);
    }
    for (let s = 0; s < L; s += r.range(1.5, 6)) {
      const b = co.braking[at(s)];
      if (b < 0.05 || r.next() > b) continue;
      const lat = co.line[at(s)] + r.range(-0.6, 0.6);
      const len = r.range(4, 16) * (0.5 + 0.5 * b);
      for (const side of [1, -1]) if (r.next() < 0.85) add(FEATURE.STAIN, s + len / 2 + r.range(-0.6, 0.6), lat + side * 0.8, len / 2, r.range(0.09, 0.13), r.next(), 0.95);
    }
  }

  // ---- into the table
  const slots = FEATURE_SLOTS[tier] ?? FEATURE_SLOTS.medium;
  const cells = Math.ceil(L / FEATURE_CELL);
  const rows = 1 + slots;
  const data = new Float32Array(cells * rows * 4);
  const lists = Array.from({ length: cells }, () => []);
  for (const t of things) {
    const first = Math.floor((t.s - t.reach) / FEATURE_CELL);
    const last = Math.floor((t.s + t.reach) / FEATURE_CELL);
    for (let c = first; c <= last; c++) lists[((c % cells) + cells) % cells].push(t);
  }
  let dropped = 0;
  for (let c = 0; c < cells; c++) {
    const start = c * FEATURE_CELL;
    // the surfacing: a joint where the age changes inside this cell
    const i0 = at(start);
    let joint = -1;
    let before = age[i0];
    let after = before;
    for (let k = 1; k * ds <= FEATURE_CELL + 1e-6; k++) {
      const a = age[(i0 + k) % n];
      if (Math.abs(a - before) > 0.02) {
        joint = (k - 0.5) * ds;
        after = a;
        break;
      }
    }
    data[c * 4] = before;
    data[c * 4 + 1] = after;
    data[c * 4 + 2] = joint;
    const list = lists[c].sort((p, q) => (WEIGHT[q.kind] ?? 0) - (WEIGHT[p.kind] ?? 0));
    dropped += Math.max(0, list.length - slots);
    for (let k = 0; k < Math.min(slots, list.length); k++) {
      const t = list[k];
      const o = ((k + 1) * cells + c) * 4;
      data[o] = track.delta(start, t.s);
      data[o + 1] = t.lat;
      data[o + 2] = Math.round(t.hl * 100) * 4096 + Math.round(t.hw * 100);
      data[o + 3] = t.kind + 16 * Math.round(t.seed * 255) + 4096 * Math.round(t.param * 255);
    }
  }
  const texture = new THREE.DataTexture(data, cells, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    cells,
    slots,
    /** The age of the surfacing per sample (the paint is newer where the road is). */
    age,
    stats: { things: things.length, dropped, counts },
    dispose() {
      texture.dispose();
    },
  };
}
