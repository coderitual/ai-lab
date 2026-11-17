// The pit building and the stand at the start, and the catch fence on the
// pit wall, written into the dressing's merged patches (builder.js).
//
// The pit building stands on the land side of the straight behind the low
// wall and a pit lane: a long two-storey block, garage doors below, a glazed
// floor above whose rooms light up at golden hour and at night (the atlas's
// glazing has a lit twin in the emissive map), a roof terrace under a canopy
// that carries the circuit's name. Across the road on the lake side a covered
// stand. Both are placed from the Track (gantry.js PIT gives the pit
// building's span in s from the line); both are straight blocks, because the
// straight is straight, and they stand well beyond the solid edges.
//
// Detail is where the start and title cameras pass (doors, bays, glazing,
// railings) and nothing finer than the atlas can carry.

import * as THREE from 'three';
import { beam } from './builder.js';
import { PIT } from './gantry.js';

/** The pit building's floors (m): garages, the slab, the glazed floor, the roof terrace's canopy. */
const FLOORS = { garage: 4.4, slab: 0.45, glazed: 3.3, canopy: 2.8 };
/** A garage bay's width and its door. */
const BAY = { w: 5.2, door: 4.2, doorH: 3.5 };
/** The stand: s of its ends from the line (the gantry), metres beyond the lake-side edge, rows, row depth and rise. */
/** Far down the straight: the footbridge and the marshal's tower (m before its end), the small stand (m after). */
const FAR = { bridge: 70, tower: 12, stand: [45, 85] };

export const STAND = { s0: -66, s1: -6, beyond: 3.2, rows: 9, depth: 0.85, rise: 0.48 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {string} options.tier
 * @param {ReturnType<import('./builder.js').createBuilder>} options.b what casts shadows
 * @param {ReturnType<import('./builder.js').createBuilder>} options.nb what does not
 * @param {ReturnType<import('./signs.js').createSigns>} options.signs
 */
export function buildPits({ track, terrain, tier, b, nb, signs }) {
  const sw = signs.swatch;
  const sp = signs.special;
  const M = new THREE.Matrix4();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /**
   * A straight block's frame along the road on one side: o the point at s0 on the line `dist` m from the centre,
   * t along the road, n towards the road (level), lengths in metres.
   */
  const g0 = track.gantry.s;
  const lineFrame = (s0, s1, side, dist) => {
    const a = track.pointAt(track.wrap(g0 + s0), side * dist, new THREE.Vector3());
    const c = track.pointAt(track.wrap(g0 + s1), side * dist, new THREE.Vector3());
    const t = new THREE.Vector3(c.x - a.x, 0, c.z - a.z);
    const len = t.length();
    t.divideScalar(len);
    // towards the road: (t.z, -t.x) is the level left of the way, and the road lies on the other side of the line
    const n = new THREE.Vector3(t.z, 0, -t.x).multiplyScalar(-side);
    return { a, t, n, len };
  };
  /** A point of a frame: x along, y up from `y0`, z towards the road (+) or away (-). */
  const at = (f, x, y, z) => V(f.a.x + f.t.x * x + f.n.x * z, y, f.a.z + f.t.z * x + f.n.z * z);
  /** A box in a frame: centre (x, y, z), sizes along, up, across; its +z face towards the road. */
  const box = (f, x, y, z, sx, sy, sz, uv) => {
    M.makeBasis(f.t.clone().multiplyScalar(sx * f.hand), V(0, sy, 0), f.n.clone().multiplyScalar(sz)).setPosition(at(f, x, y, z));
    b.box(M, uv);
  };
  /** A quad on a face looking towards +n (the road): from x0 to x1 along, y0 to y1 up, at z. */
  const face = (f, x0, x1, y0, y1, z, uv) => {
    const p = [at(f, x0, y0, z), at(f, x1, y0, z), at(f, x1, y1, z), at(f, x0, y1, z)];
    // seen from the road, +x runs to the right on the right-hand side of the road and to the left on the left
    if (f.hand < 0) b.quad([p[1], p[0], p[3], p[2]], uv, f.n);
    else b.quad(p, uv, f.n);
  };

  // ---- the pit building on the land side
  const side = -1;
  const edge = Math.max(track.edgeAt(track.wrap(g0 + PIT.s0), side), track.edgeAt(track.wrap(g0 + PIT.s1), side), track.edgeAt(g0, side));
  const pf = lineFrame(PIT.s0, PIT.s1, side, edge + PIT.beyond);
  // seen from the road the building's +t runs to the viewer's left (the road's right side): hand -1 flips faces
  pf.hand = -1;
  const mid = at(pf, pf.len / 2, 0, 0);
  const floor = terrain.heightAt(mid.x, mid.z) + 0.05;
  const depth = PIT.depth;
  const bays = Math.max(1, Math.round(pf.len / BAY.w));
  const bayW = pf.len / bays;
  const top1 = floor + FLOORS.garage;
  const top2 = top1 + FLOORS.slab + FLOORS.glazed;
  const roofY = top2 + 0.35;
  // the shell: plain walls behind and at the ends (a box sunk into the slope behind)
  box(pf, pf.len / 2, floor - 2 + (top2 + 2 - floor) / 2 + 0.0, -depth / 2 - 0.01, pf.len, top2 + 2 - floor, depth - 0.2, { pz: sw.frame, rest: sw.pitWall });
  // garages: a door in every bay between white piers
  for (let k = 0; k < bays; k++) {
    const x0 = k * bayW;
    const pier = (bayW - BAY.door) / 2;
    face(pf, x0 + pier, x0 + pier + BAY.door, floor, floor + BAY.doorH, 0.02, sp.garage);
    face(pf, x0 + pier, x0 + pier + BAY.door, floor + BAY.doorH, top1, 0.02, sw.pitWall);
    box(pf, x0 + pier / 2, (floor + top1) / 2, 0.12, pier, top1 - floor, 0.24, sw.pitWall);
    box(pf, x0 + bayW - pier / 2, (floor + top1) / 2, 0.12, pier, top1 - floor, 0.24, sw.pitWall);
    // a number board over the door
    box(pf, x0 + bayW / 2, floor + BAY.doorH + 0.45, 0.06, 1.0, 0.45, 0.06, k % 2 ? sw.yellow : sw.white);
  }
  // the slab, proud of the front: a balcony for the glazed floor
  box(pf, pf.len / 2, top1 + FLOORS.slab / 2, 0.9, pf.len + 0.4, FLOORS.slab, 2.0, { rest: sw.pitWall });
  // the glazed floor, set back a little, panes 2.6 m wide, mullions between
  const panes = Math.round(pf.len / 2.6);
  for (let k = 0; k < panes; k++) face(pf, (k * pf.len) / panes, ((k + 1) * pf.len) / panes, top1 + FLOORS.slab, top2, -0.06, sp.glazing);
  // the balcony's rail: posts and a top bar (glass would want a second material)
  const railZ = 1.8;
  for (let k = 0; k <= Math.round(pf.len / 2.6); k++) box(pf, (k * pf.len) / Math.round(pf.len / 2.6), top1 + FLOORS.slab + 0.5, railZ, 0.06, 1.0, 0.06, sw.steel);
  box(pf, pf.len / 2, top1 + FLOORS.slab + 1.02, railZ, pf.len, 0.06, 0.08, sw.steel);
  box(pf, pf.len / 2, top1 + FLOORS.slab + 0.55, railZ, pf.len, 0.04, 0.04, sw.steel);
  // the roof: a slab, a terrace rail, and a canopy on columns set back from the front, with the name along it
  box(pf, pf.len / 2, top2 + 0.18, -depth / 2 + 0.3, pf.len + 0.6, 0.36, depth + 0.4, { rest: sw.pitWall });
  for (let k = 0; k <= Math.round(pf.len / 2.6); k++) box(pf, (k * pf.len) / Math.round(pf.len / 2.6), roofY + 0.55, 0.35, 0.05, 1.1, 0.05, sw.steel);
  box(pf, pf.len / 2, roofY + 1.1, 0.35, pf.len, 0.06, 0.06, sw.steel);
  const canopyY = roofY + FLOORS.canopy;
  const cols = Math.round(pf.len / 10);
  for (let k = 0; k <= cols; k++) box(pf, 1 + (k * (pf.len - 2)) / cols, roofY + FLOORS.canopy / 2, -3.2, 0.25, FLOORS.canopy, 0.25, sw.steel);
  box(pf, pf.len / 2, canopyY + 0.12, -4.6, pf.len + 1, 0.24, 9.6, { rest: sw.roof });
  // the fascia along the canopy's front, the circuit's name on it in the middle
  box(pf, pf.len / 2, canopyY + 0.12, 0.25, pf.len + 1, 0.9, 0.12, { pz: sw.frame, rest: sw.frame });
  face(pf, pf.len / 2 - 7.2, pf.len / 2 + 7.2, canopyY - 0.78, canopyY + 1.02, 0.32, signs.gantry);

  // ---- the pit lane: an apron of asphalt from the wall to the garages, following the ground
  const lane = lineFrame(PIT.s0 - 25, PIT.s1 + 25, side, edge + 0.2);
  lane.hand = -1;
  const steps = Math.round(lane.len / 6);
  const across = PIT.beyond - 0.2;
  for (let k = 0; k < steps; k++) {
    const x0 = (k * lane.len) / steps;
    const x1 = ((k + 1) * lane.len) / steps;
    const pts = [at(lane, x0, 0, 0), at(lane, x1, 0, 0), at(lane, x1, 0, -across), at(lane, x0, 0, -across)];
    for (const p of pts) p.y = Math.max(terrain.heightAt(p.x, p.z), floor - 0.6) + 0.04;
    nb.quad([pts[0], pts[3], pts[2], pts[1]], sw.asphalt);
    // the pit lane's white line, a hand's width off the wall
    const l = [at(lane, x0, 0, -1.2), at(lane, x1, 0, -1.2), at(lane, x1, 0, -1.4), at(lane, x0, 0, -1.4)];
    for (const p of l) p.y = Math.max(terrain.heightAt(p.x, p.z), floor - 0.6) + 0.06;
    nb.quad([l[0], l[3], l[2], l[1]], sw.white);
  }

  // ---- the catch fence on the pit wall: posts, a top that leans over the road, cables
  const fence = lineFrame(PIT.s0 - 30, PIT.s1 + 30, side, edge + 0.12);
  fence.hand = -1;
  const posts = Math.round(fence.len / 4);
  const fy = (x) => {
    const p = at(fence, x, 0, 0);
    return Math.max(terrain.heightAt(p.x, p.z), track.pointAt(g0, 0).y - 0.3);
  };
  for (let k = 0; k <= posts; k++) {
    const x = (k * fence.len) / posts;
    const g = fy(x);
    nb.box(beam(at(fence, x, g, 0), at(fence, x, g + 3.0, 0), 0.09, 0.09, M), sw.fence);
    nb.box(beam(at(fence, x, g + 3.0, 0), at(fence, x, g + 3.7, 0.45), 0.08, 0.08, M), sw.fence);
  }
  const f0 = fy(0);
  const cables = tier === 'low' ? [1.2, 2.2, 3.0] : [0.9, 1.5, 2.1, 2.6, 3.0, 3.35];
  for (const h of cables) {
    const z = h > 3.0 ? ((h - 3.0) / 0.7) * 0.45 : 0;
    nb.box(beam(at(fence, 0, f0 + h, z), at(fence, fence.len, f0 + h, z), 0.025, 0.025, M), sw.fence);
  }
  nb.box(beam(at(fence, 0, f0 + 3.7, 0.45), at(fence, fence.len, f0 + 3.7, 0.45), 0.06, 0.06, M), sw.fence);

  // ---- the stand on the lake side
  const sf = lineFrame(STAND.s0, STAND.s1, 1, track.edgeAt(track.wrap(g0 + (STAND.s0 + STAND.s1) / 2), 1) + STAND.beyond);
  sf.hand = 1;
  const smid = at(sf, sf.len / 2, 0, 0);
  const sy = Math.max(terrain.heightAt(smid.x, smid.z), track.pointAt(g0, 0).y - 1.2);
  const run = STAND.rows * STAND.depth;
  for (let r = 0; r < STAND.rows; r++) {
    const z = -r * STAND.depth - STAND.depth / 2;
    const h = 0.6 + r * STAND.rise;
    // the step, and a strip of seats along its back
    box(sf, sf.len / 2, sy + h / 2 - 0.5, z, sf.len, h + 1, STAND.depth, { rest: sw.stand });
    box(sf, sf.len / 2, sy + h + 0.22, z - STAND.depth * 0.25, sf.len - 0.4, 0.44, STAND.depth * 0.32, { rest: r % 4 === 3 ? sw.white : sw.seat });
  }
  const backY = sy + 0.6 + STAND.rows * STAND.rise;
  box(sf, sf.len / 2, (sy + backY + 3.2) / 2 - 0.5, -run - 0.15, sf.len, backY + 3.2 - sy + 1, 0.3, { rest: sw.pitWall });
  for (const e of [0, sf.len]) box(sf, e, (sy + backY + 3.2) / 2 - 0.5, -run / 2, 0.3, backY + 3.2 - sy + 1, run, { rest: sw.pitWall });
  // the roof: columns at the back, a slab cantilevered over the rows, a fascia board
  const roofH = backY + 3.4;
  for (let k = 0; k <= 6; k++) box(sf, (k * sf.len) / 6, (backY + roofH) / 2, -run + 0.2, 0.3, roofH - backY, 0.3, sw.steel);
  box(sf, sf.len / 2, roofH, -run / 2 + 0.3, sf.len + 1, 0.25, run + 1.6, { rest: sw.roof });
  box(sf, sf.len / 2, roofH - 0.25, 0.55, sf.len + 1, 0.7, 0.1, { pz: sw.frame, rest: sw.frame });
  // three boards on the fascia
  for (let k = 0; k < 3; k++) {
    const x = sf.len * (0.2 + k * 0.3);
    face(sf, x - 2.4, x + 2.4, roofH - 0.55, roofH + 0.05, 0.61, signs.boards[(k * 4 + 1) % signs.boards.length]);
  }

  // ---- far down the straight (what D1 shows in the distance): a footbridge with boards across the road, a
  // marshal's tower at the end of the straight and a small stand on the outside of the first bend
  const straightAt = track.sections.findIndex((sec) => sec.id === 'straight');
  const end = track.sections[straightAt].s1;
  const ends = track.delta(g0, end);
  {
    // the footbridge: a stair tower beyond each wall, a deck with boards on both faces, a rail
    const sB = ends - FAR.bridge;
    const eL = track.edgeAt(track.wrap(g0 + sB), 1) + 1.6;
    const eR = track.edgeAt(track.wrap(g0 + sB), -1) + 1.6;
    const fb = lineFrame(sB - 1.2, sB + 1.2, 1, eL);
    // its own frame across the road: t from the left tower to the right one, n towards the cars that come
    const A = track.pointAt(track.wrap(g0 + sB), eL, new THREE.Vector3());
    const B = track.pointAt(track.wrap(g0 + sB), -eR, new THREE.Vector3());
    const t = new THREE.Vector3(B.x - A.x, 0, B.z - A.z);
    const len = t.length();
    t.divideScalar(len);
    const bf = { a: A, t, n: new THREE.Vector3(t.z, 0, -t.x).negate(), len, hand: 1 };
    // n = the way the cars come from (against the road's direction): t is to the right, so -ahead = (t.z, -t.x) * -1
    if (bf.n.x * (fb.t.x) + bf.n.z * fb.t.z > 0) bf.n.negate();
    const yR = track.pointAt(track.wrap(g0 + sB), 0).y;
    const deck = yR + 5.8;
    for (const x of [0, len]) {
      const foot = at(bf, x, 0, 0);
      const g = Math.min(terrain.heightAt(foot.x, foot.z), yR);
      box(bf, x, (g - 0.5 + deck + 1.4) / 2, 0, 2.2, deck + 1.9 - g, 2.2, { rest: sw.pitWall });
    }
    box(bf, len / 2, deck - 0.6, 0, len, 1.2, 2.0, { rest: sw.frame });
    const panels = Math.max(1, Math.round((len - 2.2) / 6.4));
    const pw = (len - 2.2) / panels;
    for (const side of [1, -1]) {
      for (let k = 0; k < panels; k++) {
        const x0 = 1.1 + k * pw;
        const uv = signs.boards[(k * 3 + (side > 0 ? 0 : 5)) % signs.boards.length];
        if (side > 0) face(bf, x0, x0 + pw, deck - 1.2, deck + 0.4, 1.05, uv);
        else face({ ...bf, n: bf.n.clone().negate(), hand: -1 }, x0, x0 + pw, deck - 1.2, deck + 0.4, 1.05, uv);
      }
    }
    box(bf, len / 2, deck + 1.05, -0.95, len, 0.06, 0.06, sw.steel);
  }
  {
    // the marshal's tower on the lake side at the end of the straight: a shaft, a glazed cabin, a flat roof
    const sT = ends - FAR.tower;
    const tf = lineFrame(sT - 2, sT + 2, 1, track.edgeAt(track.wrap(g0 + sT), 1) + 3.5);
    tf.hand = 1;
    const foot = at(tf, 2, 0, -1.5);
    const g = terrain.heightAt(foot.x, foot.z);
    box(tf, 2, g + 3.5, -1.5, 2.2, 7, 2.2, { rest: sw.pitWall });
    box(tf, 2, g + 7 + 0.15, -1.5, 3.6, 0.3, 3.6, { rest: sw.pitWall });
    face(tf, 0.4, 3.6, g + 7.3, g + 9.0, 0.01, sp.glazing);
    box(tf, 2, g + 8.15, -1.6, 3.2, 1.7, 3.2, { pz: sw.glassDark, rest: sw.glassDark });
    box(tf, 2, g + 9.15, -1.5, 4.0, 0.3, 4.0, { rest: sw.red });
  }
  {
    // the small stand on the outside of the first bend, facing it
    const sf2 = lineFrame(ends + FAR.stand[0], ends + FAR.stand[1], 1, track.edgeAt(track.wrap(end + FAR.stand[0]), 1) + 6);
    sf2.hand = 1;
    const m2 = at(sf2, sf2.len / 2, 0, 0);
    const y2 = terrain.heightAt(m2.x, m2.z);
    for (let r = 0; r < 6; r++) {
      const z = -r * 0.85 - 0.42;
      const h = 0.5 + r * 0.45;
      box(sf2, sf2.len / 2, y2 + h / 2 - 0.5, z, sf2.len, h + 1, 0.85, { rest: sw.stand });
      box(sf2, sf2.len / 2, y2 + h + 0.2, z - 0.2, sf2.len - 0.4, 0.4, 0.28, { rest: r % 3 === 2 ? sw.white : sw.red });
    }
    const top = y2 + 0.5 + 6 * 0.45 + 2.8;
    for (let k = 0; k <= 4; k++) box(sf2, (k * sf2.len) / 4, (y2 + top) / 2, -5.1, 0.25, top - y2, 0.25, sw.steel);
    box(sf2, sf2.len / 2, top, -2.6, sf2.len + 1, 0.22, 6.2, { rest: sw.roof });
    face(sf2, sf2.len / 2 - 4, sf2.len / 2 + 4, top - 0.9, top + 0.11, 0.5, signs.gantry);
  }
  return {};
}
