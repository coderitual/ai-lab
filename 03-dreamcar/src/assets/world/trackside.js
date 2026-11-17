// What stands along the circuit's edges, from the Track's data: the trackside
// boards (track.boards), the distance boards before the slow corner
// (track.distanceBoards), the tyre walls on the outside of the fast bends
// (track.tyreWalls) and the marshal posts (track.marshals). All of it is
// written into the dressing's merged patches (builder.js).
//
// The Track gives a lateral place for each; the world's rule wins over it:
// nothing stands inside the corridor's solid edges, so every piece is set at
// or beyond edgeAt(s, side), whatever lat the data carries.
//
// Boards: on the start straight one long run of tall hoardings (about 4 m of
// panel, tops at about 5 m) behind the lake-side wall, broken only by the
// stand and the gantry's tower, and nothing tall on the land side (the D1
// frame); low panels on short legs along the bends (D3, D4). Then, from the
// gantry's s: a short tyre wall with low boards on a low wall behind it just
// past the pit exit (D4), and distance boards 200, 150, 100 before the first
// bend, big enough to read from 150 m. The designs
// follow each other in a fixed order that never puts the same two side by
// side. Faces are big fields of flat colour: at speed they streak cleanly.

import * as THREE from 'three';
import { levelFrame } from './furniture.js';
import { BOARD_COUNT, TALL_COUNT } from './signs.js';
import { PIT } from './gantry.js';
import { STAND } from './pits.js';

/** The boards: width, height, height of the foot over the ground, metres beyond the edge, gap between panels. */
const TALL = { w: 7.6, h: 3.8, foot: 1.0, beyond: 1.4, gap: 0.14 };
const SMALL = { w: 4.4, h: 1.1, foot: 0.25, beyond: 0.55, gap: 0.35 };
/** A tyre stack: radius, height (four tyres), spacing along the wall. */
const TYRE = { r: 0.31, h: 1.0, step: 0.62 };
/** The distance boards: size, height of the foot over the road. */
const DIST = { size: 1.5, foot: 1.1 };
/** The distance boards before the first bend: big enough to read from 150 m. */
const FIRST_BEND_SIZE = 2.2;
/** The start's tyre wall (D4): where it begins after the line (m) and how long it is. */
const START_TYRES = { from: PIT.s1 + 30, length: 32 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {string} options.tier
 * @param {ReturnType<import('./builder.js').createBuilder>} options.b what casts shadows
 * @param {ReturnType<import('./builder.js').createBuilder>} options.nb what does not (low, small, or under others)
 * @param {ReturnType<import('./signs.js').createSigns>} options.signs
 */
export function buildTrackside({ track, terrain, tier, b, nb, signs }) {
  const sw = signs.swatch;
  const frame = {};
  const M = new THREE.Matrix4();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3();
  const C = new THREE.Vector3();
  /** The ground under a point of the map, never below the road beside it. */
  const groundAt = (p, road) => Math.max(terrain.heightAt(p.x, p.z), road - 0.3);
  /** A point of the map at (s, |lat| beyond the centre line on `side`), its y the road's at the edge. */
  const spot = (s, side, dist) => {
    const p = track.pointAt(s, side * Math.min(dist, track.edgeAt(s, side)), new THREE.Vector3());
    const out = track.pointAt(s, side * dist, new THREE.Vector3());
    out.y = p.y;
    return out;
  };
  /** A box at centre c whose +x runs along `along` (sx), +z towards `face` (sz). */
  const boxAt = (c, along, face, sx, sy, sz, uv, into = b) => {
    M.makeBasis(X.copy(along).multiplyScalar(sx), Y.set(0, sy, 0), Z.copy(face).multiplyScalar(sz)).setPosition(c);
    into.box(M, uv);
  };
  const g0 = track.gantry.s;
  const inStand = (s) => {
    const d = track.delta(g0, s);
    return d > STAND.s0 - 2 && d < STAND.s1 + 2;
  };
  const nearGantry = (s, room) => Math.abs(track.delta(track.gantry.s, s)) < room;

  // the first bend after the straight: where its distance boards stand (placed below; the boards leave room)
  const firstBend = (() => {
    const at = track.sections.findIndex((sec) => sec.id === 'straight');
    const turnIn = track.sections[(at + 1) % track.sections.length].s0;
    levelFrame(track, turnIn + 40, frame);
    const outside = frame.curvature > 0 ? -1 : 1;
    return [200, 150, 100].map((d) => ({ s: track.wrap(turnIn - d), side: outside, label: String(d) }));
  })();
  const byDistanceBoard = (s, side) => firstBend.some((d) => d.side === side && Math.abs(track.delta(d.s, s)) < FIRST_BEND_SIZE / 2 + TALL.w / 2);

  // ---- boards
  let boards = 0;
  let order = 0;
  for (const run of track.boards) {
    const len = track.wrap(run.s1 - run.s0);
    const big = track.sectionAt(run.s0 + len / 2).id === 'straight';
    // the land side of the straight stays open: grass, the barrier, the pits
    if (big && run.side < 0) continue;
    const T = big ? TALL : SMALL;
    const n = Math.floor(len / (T.w + T.gap));
    const pitch = len / n;
    for (let k = 0; k < n; k++) {
      const s = track.wrap(run.s0 + (k + 0.5) * pitch);
      if (nearGantry(s, T.w / 2 + 2.5)) continue;
      if (big && (inStand(s) || byDistanceBoard(s, run.side))) continue;
      levelFrame(track, s, frame);
      const dist = track.edgeAt(s, run.side) + T.beyond;
      const p = spot(s, run.side, dist);
      const g = groundAt(p, p.y);
      const along = frame.ahead.clone().multiplyScalar(run.side);
      const face = frame.flat.clone().multiplyScalar(-run.side);
      const count = big ? TALL_COUNT : BOARD_COUNT;
      const design = (order * 3 + Math.floor(order / count)) % count;
      order++;
      // the panel: its face towards the road, the rest dark
      C.copy(p).setY(g + T.foot + T.h / 2);
      M.makeBasis(X.copy(along).multiplyScalar(T.w), Y.set(0, T.h, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
      b.box(M, { pz: (big ? signs.tall : signs.boards)[design], rest: sw.frame }, { skip: ['ny'] });
      // legs, and on the big ones a rail along the back
      for (const e of [-0.36, 0.36]) {
        C.copy(p).addScaledVector(along, e * T.w).addScaledVector(face, -0.12).setY(g + (T.foot + T.h) / 2 - 0.2);
        boxAt(C, along, face, big ? 0.14 : 0.1, T.foot + T.h + 0.4 - 0.1, big ? 0.14 : 0.1, sw.steel);
      }
      if (big) {
        C.copy(p).addScaledVector(face, -0.12).setY(g + T.foot + T.h * 0.5);
        boxAt(C, along, face, T.w, 0.08, 0.08, sw.steel);
      }
      boards++;
    }
  }

  // ---- tyre walls: a row of stacks bound by a belt, their tops under a dark cap
  const sides = tier === 'low' ? 4 : 6;
  const tyreFaces = [signs.special.tyres, signs.special.tyres, signs.special.tyresWhite, signs.special.tyres, signs.special.tyresRed];
  /** A tyre wall from s0 over `len` m on one side, its front `inset` m beyond the edge; `look` the painted stacks. */
  const tyreRun = (s0, len, side, look, inset = 0.02) => {
    const n = Math.max(1, Math.round(len / TYRE.step));
    const pitch = len / n;
    for (let k = 0; k < n; k++) {
      const s = track.wrap(s0 + (k + 0.5) * pitch);
      levelFrame(track, s, frame);
      const p = spot(s, side, track.edgeAt(s, side) + TYRE.r + inset);
      const g = groundAt(p, p.y) - 0.05;
      const face = frame.flat.clone().multiplyScalar(-side);
      // every third block of stacks painted, the rest plain
      const uv = Math.floor(k / 5) % 3 === 1 ? look : signs.special.tyres;
      // the half of each stack that faces the road (a right-handed frame whose angles 0 .. PI sweep that side)
      const z = face.clone().negate();
      const axis = { x: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z), y: new THREE.Vector3(0, 1, 0), z };
      nb.prism(p.clone().setY(g), TYRE.r, TYRE.h, sides, uv, { a0: 0, a1: Math.PI, top: false, axis });
      if (k % 5 === 0) {
        // the back rows and the top, as one dark block behind the front row's axis
        const run = Math.min(5, n - k) * pitch;
        C.copy(p).addScaledVector(frame.ahead, (run - pitch) / 2).addScaledVector(face, -0.55).setY(g + TYRE.h / 2);
        boxAt(C, frame.ahead, face, run, TYRE.h, 1.1, sw.rubber, nb);
      }
    }
  };
  track.tyreWalls.forEach((wall, i) => tyreRun(wall.s0, track.wrap(wall.s1 - wall.s0), wall.side, tyreFaces[i % tyreFaces.length]));

  // ---- the start's own (D4): past the pit exit on the land side, a tyre wall, and behind it low boards on a
  // low wall of their own
  {
    const s0 = track.wrap(g0 + START_TYRES.from);
    tyreRun(s0, START_TYRES.length, -1, signs.special.tyresWhite);
    const n = Math.round(START_TYRES.length / (SMALL.w + 0.1));
    for (let k = 0; k < n; k++) {
      const s = track.wrap(s0 + ((k + 0.5) * START_TYRES.length) / n);
      levelFrame(track, s, frame);
      const p = spot(s, -1, track.edgeAt(s, -1) + 1.75);
      const g = groundAt(p, p.y);
      const along = frame.ahead.clone().negate();
      const face = frame.flat.clone();
      C.copy(p).setY(g + 0.45);
      boxAt(C, along, face, START_TYRES.length / n + 0.02, 1.0, 0.3, sw.concrete);
      C.copy(p).addScaledVector(face, -0.05).setY(g + 0.95 + SMALL.h / 2);
      M.makeBasis(X.copy(along).multiplyScalar(SMALL.w), Y.set(0, SMALL.h, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
      b.box(M, { pz: signs.boards[(k * 3 + 1) % BOARD_COUNT], rest: sw.frame }, { skip: ['ny'] });
      boards++;
    }
  }

  // ---- distance boards: square, facing the cars, on a post (or hung from the parapet on a bridge)
  const distanceBoard = (s, side, size, label, bridge, room) => {
    levelFrame(track, s, frame);
    const p = spot(s, side, track.edgeAt(s, side) + size / 2 + room);
    const face = frame.ahead.clone().negate();
    const across = frame.flat.clone().multiplyScalar(-1);
    const uv = signs.distance[label] ?? signs.distance['100'];
    const foot = bridge ? DIST.foot : DIST.foot + 0.3;
    C.copy(p).setY(p.y + foot + size / 2);
    M.makeBasis(X.copy(across).multiplyScalar(size), Y.set(0, size, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
    nb.box(M, { pz: uv, rest: sw.frame });
    if (bridge) {
      C.copy(p).addScaledVector(frame.flat, -side * (size / 2)).setY(p.y + foot + 0.3);
      boxAt(C, frame.flat, frame.ahead, size + 0.3, 0.1, 0.1, sw.steel, nb);
    } else {
      const g = groundAt(p, p.y);
      for (const e of [-0.3, 0.3]) {
        C.copy(p).addScaledVector(across, e * size).addScaledVector(face, -0.08).setY((g + p.y + foot + size) / 2);
        boxAt(C, across, face, 0.1, p.y + foot + size - g, 0.1, sw.steel, nb);
      }
    }
  };
  for (const d of track.distanceBoards) distanceBoard(d.s, d.side, DIST.size, d.label, d.bridge, d.bridge ? 0.35 : 0.6);
  // and before the first bend after the straight, on its outside, big (the tall run leaves a gap for each)
  for (const d of firstBend) distanceBoard(d.s, d.side, FIRST_BEND_SIZE, d.label, false, 0.5);

  // ---- marshal posts: a hut with an opening towards the road, a light panel on a pole beside it
  for (const m of track.marshals) {
    levelFrame(track, m.s, frame);
    const dist = Math.max(Math.abs(m.lat), track.edgeAt(m.s, m.side) + 1.8);
    const p = spot(m.s, m.side, dist);
    const g = groundAt(p, p.y);
    const face = frame.flat.clone().multiplyScalar(-m.side);
    const along = frame.ahead.clone().multiplyScalar(m.side);
    C.copy(p).setY(g + 1.2);
    boxAt(C, along, face, 2.2, 2.4, 1.6, sw.white, nb);
    // the opening: a dark band across the front
    C.copy(p).addScaledVector(face, 0.81).setY(g + 1.55);
    boxAt(C, along, face, 1.8, 0.7, 0.02, sw.dark, nb);
    // the roof, overhanging towards the road
    C.copy(p).addScaledVector(face, 0.2).setY(g + 2.47);
    boxAt(C, along, face, 2.6, 0.14, 2.2, sw.red, nb);
    // the light panel on its pole, facing the cars that come
    C.copy(p).addScaledVector(along, 1.6 * m.side).addScaledVector(face, 0.5).setY(g + 1.5);
    boxAt(C, frame.ahead, frame.flat, 0.1, 3.0, 0.1, sw.steel, nb);
    C.y = g + 2.7;
    boxAt(C, frame.flat, frame.ahead.clone().negate(), 0.7, 0.5, 0.12, { pz: signs.special.panel, rest: sw.dark }, nb);
  }

  return { boards };
}
