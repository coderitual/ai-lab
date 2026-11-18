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
import { curbAt } from './schemes.js';
import { levelFrame } from './furniture.js';
import { BOARD_COUNT, DESIGN, TALL_COUNT } from './signs.js';
import { PIT } from './gantry.js';
import { STAND } from './pits.js';

/** The boards: width, height, height of the foot over the ground, metres beyond the edge, gap between panels. */
const TALL = { w: 7.6, h: 3.8, foot: 1.0, beyond: 1.4, gap: 0.14 };
const SMALL = { w: 4.4, h: 1.1, foot: 0.25, beyond: 0.55, gap: 0.35 };
/** The low walls (walls.js): their top over the road at the edge, and where a board on them stands (m beyond the edge). */
const WALL = { top: 0.93, board: 0.42 };
/** How far into the ledge (frame D3) its runs carry their own palette, and the palettes (signs.js DESIGN order). */
const D3_REACH = 300;
const D3_OUTSIDE = [0, 10, 6];
const D3_INSIDE = [0, 6, 5, 10];
/** The tall run is phased at this many metres before the line (frame D1's camera). */
const D1_ANCHOR = 175;
/** A tyre stack: radius, height (four tyres), spacing along the wall. */
const TYRE = { r: 0.31, h: 1.0, step: 0.62 };
/** The distance boards: size, height of the foot over the road. */
const DIST = { size: 1.5, foot: 1.1 };
/** The distance boards before the first bend: big enough to read from 150 m. */
const FIRST_BEND_SIZE = 2.2;
/** The start's tyre wall (D4): where it begins after the line (m) and how long it is. */
/** The start's own (frame D4), from the gantry's s: where it begins, the wide dark boards, the pale ones. */
const START = { from: 4, dark: { w: 12, h: 1.9 }, pale: { w: 11, h: 1.4 }, stacks: 5 };

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
  const EDGE_WALL = 2;
  /** The solid edge's kind on a side at s (the Track's per-sample kinds). */
  const kindAt = (s, side) => (side > 0 ? track.kindL : track.kindR)?.[Math.round(track.wrap(s) / track.ds) % track.count];
  // the ledge's first bend (frame D3): its runs carry their own palette, red and white outside, red, white and
  // green inside
  const ledge = track.sections.find((sec) => sec.id === 'ledge');
  const d3 = ledge ? { s0: ledge.s0, s1: ledge.s0 + D3_REACH } : null;
  const inD3 = (r) => d3 && track.wrap(r.s0 - d3.s0) < D3_REACH;
  // the tall run of the straight is phased so that the panels nearest D1's camera read navy, red, white, blue, white
  const tallAnchor = track.wrap(g0 - D1_ANCHOR);
  // runs: the Track's, and on bends whose inside is a wall too, the same stretch on the inside
  const runs = [];
  for (const run of track.boards) {
    // (forest lane) none where a piece's scheme draws the edge as a kerbstone (schemes.js curbAt)
    if (curbAt(track, run.s0 + track.wrap(run.s1 - run.s0) / 2)) continue;
    runs.push({ ...run });
    const len = track.wrap(run.s1 - run.s0);
    const mid = run.s0 + len / 2;
    if (track.sectionAt(mid).id !== 'straight' && kindAt(mid, -run.side) === EDGE_WALL) runs.push({ ...run, side: -run.side, inside: true });
  }
  // the ledge's runs are carried on to the end of its first bend wherever the wall goes on (the frame's run is
  // continuous round the whole bend)
  if (d3) {
    const end = track.wrap(d3.s0 + D3_REACH);
    for (const run of runs) {
      if (inD3(run) && track.wrap(end - run.s1) < 100) {
        run.s1 = end;
        run.extended = true;
      }
    }
  }
  let boards = 0;
  let order = 0;
  for (const run of runs) {
    const len = track.wrap(run.s1 - run.s0);
    const big = track.sectionAt(run.s0 + len / 2).id === 'straight';
    // the land side of the straight stays open: grass, the barrier, the pits
    if (big && run.side < 0) continue;
    const T = big ? TALL : SMALL;
    const n = Math.floor(len / (T.w + T.gap));
    const pitch = len / n;
    const palette = inD3(run) ? (run.inside ? D3_INSIDE : D3_OUTSIDE) : null;
    // the tall run's panel index at the anchor
    const k0 = big ? Math.round(track.wrap(tallAnchor - run.s0) / pitch - 0.5) : 0;
    for (let k = 0; k < n; k++) {
      const s = track.wrap(run.s0 + (k + 0.5) * pitch);
      if (nearGantry(s, T.w / 2 + 2.5)) continue;
      if (big && (inStand(s) || byDistanceBoard(s, run.side))) continue;
      // an extended run only where the wall is (the bend's own pieces)
      if (run.extended && kindAt(s, run.side) !== EDGE_WALL) continue;
      levelFrame(track, s, frame);
      // on a wall the board stands on its top, just behind its face; elsewhere on legs behind the barrier
      const onWall = !big && kindAt(s, run.side) === EDGE_WALL;
      const dist = track.edgeAt(s, run.side) + (onWall ? WALL.board : T.beyond);
      const p = spot(s, run.side, dist);
      const g = onWall ? p.y + WALL.top - T.foot + 0.02 : groundAt(p, p.y);
      const along = frame.ahead.clone().multiplyScalar(run.side);
      const face = frame.flat.clone().multiplyScalar(-run.side);
      let design;
      if (big) design = (((k - k0) % TALL_COUNT) + TALL_COUNT) % TALL_COUNT;
      else if (palette) design = palette[k % palette.length];
      else design = (order * 3 + Math.floor(order / BOARD_COUNT)) % BOARD_COUNT;
      order++;
      // the panel: its face towards the road, the rest dark
      C.copy(p).setY(g + T.foot + T.h / 2);
      M.makeBasis(X.copy(along).multiplyScalar(T.w), Y.set(0, T.h, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
      b.box(M, { pz: (big ? signs.tall : signs.boards)[design], rest: sw.frame }, { skip: ['ny'] });
      // legs (on a wall, short brackets to its top), and on the big ones a rail along the back
      const legH = onWall ? T.foot + T.h * 0.8 : T.foot + T.h + 0.3;
      for (const e of [-0.36, 0.36]) {
        C.copy(p).addScaledVector(along, e * T.w).addScaledVector(face, -0.12).setY(g + legH / 2 - 0.1);
        boxAt(C, along, face, big ? 0.14 : 0.1, legH, big ? 0.14 : 0.1, sw.steel, onWall ? nb : b);
      }
      if (big) {
        C.copy(p).addScaledVector(face, -0.12).setY(g + T.foot + T.h * 0.5);
        boxAt(C, along, face, T.w, 0.08, 0.08, sw.steel);
      }
      boards++;
    }
  }
  // the small "150" of frame D3 on the inside wall, past the end of the bend's boards
  const d3Run = d3 ? runs.find((r) => r.inside && inD3(r)) : null;

  // ---- tyre walls: a row of stacks bound by a belt, their tops under a dark cap
  const sides = tier === 'low' ? 4 : 6;
  const tyreFaces = [signs.special.tyres, signs.special.tyres, signs.special.tyresWhite, signs.special.tyres, signs.special.tyresRed];
  /** A tyre wall from s0 over `len` m on one side, its front `inset` m beyond the edge; `look` the painted stacks. */
  const tyreRun = (s0, len, side, look, inset = 0.02) => {
    const n = Math.max(1, Math.round(len / TYRE.step));
    const pitch = len / n;
    for (let k = 0; k < n; k++) {
      const s = track.wrap(s0 + (k + 0.5) * pitch);
      // behind a low wall a tyre wall would not show: none there
      if (kindAt(s, side) === EDGE_WALL) continue;
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
  track.tyreWalls.forEach((wall, i) => !curbAt(track, wall.s0 + track.wrap(wall.s1 - wall.s0) / 2) && tyreRun(wall.s0, track.wrap(wall.s1 - wall.s0), wall.side, tyreFaces[i % tyreFaces.length]));

  // ---- the start's own (frame D4), on the land side past the pit exit, read from the grid right to left (along
  // the road): two wide dark boards on the low wall, a stack of tyres, then two pale boards
  {
    /** One board standing on the wall's top just behind its face: from s over `w` m, `h` high, design. */
    const wallBoard = (s, w, h, uv) => {
      levelFrame(track, s, frame);
      const p = spot(s, -1, track.edgeAt(s, -1) + WALL.board);
      const along = frame.ahead.clone().negate();
      const face = frame.flat.clone();
      C.copy(p).setY(p.y + WALL.top + 0.02 + h / 2);
      M.makeBasis(X.copy(along).multiplyScalar(w), Y.set(0, h, 0), Z.copy(face).multiplyScalar(0.1)).setPosition(C);
      b.box(M, { pz: uv, rest: sw.frame }, { skip: ['ny'] });
      boards++;
    };
    // the low white wall that carries them, from the first board to the last (the Track has a rail here, no wall)
    const wallLen = 2 * (START.dark.w + 0.3) + START.stacks * TYRE.step + 0.8 + 2 * (START.pale.w + 0.3);
    for (let k = 0, n = Math.ceil(wallLen / 6); k < n; k++) {
      const sc = track.wrap(g0 + START.from + (k + 0.5) * (wallLen / n));
      levelFrame(track, sc, frame);
      const p = spot(sc, -1, track.edgeAt(sc, -1) + 0.2);
      const along = frame.ahead.clone().negate();
      const face = frame.flat.clone();
      C.copy(p).setY(p.y + WALL.top / 2 - 0.05);
      M.makeBasis(X.copy(along).multiplyScalar(wallLen / n + 0.05), Y.set(0, WALL.top + 0.1, 0), Z.copy(face).multiplyScalar(0.4)).setPosition(C);
      b.box(M, { pz: sw.white, rest: sw.white }, { skip: ['ny'] });
    }
    let s = g0 + START.from;
    for (const design of [DESIGN.miralta, DESIGN.solmere]) {
      wallBoard(track.wrap(s + START.dark.w / 2), START.dark.w, START.dark.h, signs.boards[design]);
      s += START.dark.w + 0.3;
    }
    // the tyres: three stacks of six, two rows deep, right behind the wall, standing well over it
    const tyreS = s + 0.4;
    for (let k = 0; k < START.stacks; k++) {
      const st = track.wrap(tyreS + (k + 0.5) * TYRE.step);
      levelFrame(track, st, frame);
      for (const row of [0, 1]) {
        const p = spot(st, -1, track.edgeAt(st, -1) + 0.35 + TYRE.r + row * 2 * TYRE.r);
        const z = frame.flat.clone().negate();
        const axis = { x: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z), y: new THREE.Vector3(0, 1, 0), z };
        nb.prism(p.clone().setY(p.y - 0.1), TYRE.r, TYRE.h * 1.5, 6, k === 2 ? signs.special.tyresWhite : signs.special.tyres, { top: true, topUv: sw.rubber, axis });
      }
    }
    s = tyreS + START.stacks * TYRE.step + 0.4;
    // two pale boards on the wall (D4's wall there is white: the wall's paint is walls.js's)
    for (const design of [DESIGN.torvel, DESIGN.pellora]) {
      wallBoard(track.wrap(s + START.pale.w / 2), START.pale.w, START.pale.h, signs.boards[design]);
      s += START.pale.w + 0.3;
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
  // and frame D3's small "150" on the inside wall a little past the bend's boards
  if (d3Run) distanceBoard(track.wrap(d3Run.s1 + 14), d3Run.side, 0.9, '150', false, WALL.board);

  // ---- marshal posts: a hut with an opening towards the road, a light panel on a pole beside it
  for (const m of track.marshals) {
    if (curbAt(track, m.s)) continue;
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
