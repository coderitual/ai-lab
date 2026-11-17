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
// Boards: big hoardings on legs behind the walls of the start straight (the
// D1 frame), low panels on short legs along the bends (D3, D4). The designs
// follow each other in a fixed order that never puts the same two side by
// side. Faces are big fields of flat colour: at speed they streak cleanly.

import * as THREE from 'three';
import { levelFrame } from './furniture.js';
import { BOARD_COUNT } from './signs.js';
import { PIT } from './gantry.js';

/** The boards: width, height, height of the foot over the ground, metres beyond the edge, gap between panels. */
const BIG = { w: 8.4, h: 2.1, foot: 1.0, beyond: 1.4, gap: 0.08 };
const SMALL = { w: 4.4, h: 1.1, foot: 0.25, beyond: 0.55, gap: 0.35 };
/** A tyre stack: radius, height (four tyres), spacing along the wall. */
const TYRE = { r: 0.31, h: 1.0, step: 0.62 };
/** The distance boards: size, height of the foot over the road. */
const DIST = { size: 1.5, foot: 1.1 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {string} options.tier
 * @param {ReturnType<import('./builder.js').createBuilder>} options.b
 * @param {ReturnType<import('./signs.js').createSigns>} options.signs
 */
export function buildTrackside({ track, terrain, tier, b, signs }) {
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
  const boxAt = (c, along, face, sx, sy, sz, uv) => {
    M.makeBasis(X.copy(along).multiplyScalar(sx), Y.set(0, sy, 0), Z.copy(face).multiplyScalar(sz)).setPosition(c);
    b.box(M, uv);
  };
  const pit = { s0: track.wrap(track.gantry.s + PIT.s0 - 6), len: PIT.s1 - PIT.s0 + 12 };
  const inPit = (s) => track.wrap(s - pit.s0) < pit.len;
  const nearGantry = (s, room) => Math.abs(track.delta(track.gantry.s, s)) < room;

  // ---- boards
  let boards = 0;
  let order = 0;
  for (const run of track.boards) {
    const len = track.wrap(run.s1 - run.s0);
    const big = track.sectionAt(run.s0 + len / 2).id === 'straight';
    const T = big ? BIG : SMALL;
    const n = Math.floor(len / (T.w + T.gap));
    const pitch = len / n;
    for (let k = 0; k < n; k++) {
      const s = track.wrap(run.s0 + (k + 0.5) * pitch);
      if (nearGantry(s, T.w / 2 + 2.5)) continue;
      if (big && run.side < 0 && inPit(s)) continue;
      levelFrame(track, s, frame);
      const dist = track.edgeAt(s, run.side) + T.beyond;
      const p = spot(s, run.side, dist);
      const g = groundAt(p, p.y);
      const along = frame.ahead.clone().multiplyScalar(run.side);
      const face = frame.flat.clone().multiplyScalar(-run.side);
      const design = (order * 3 + Math.floor(order / BOARD_COUNT)) % BOARD_COUNT;
      order++;
      // the panel: its face towards the road, the rest dark
      C.copy(p).setY(g + T.foot + T.h / 2);
      M.makeBasis(X.copy(along).multiplyScalar(T.w), Y.set(0, T.h, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
      b.box(M, { pz: signs.boards[design], rest: sw.frame }, { skip: ['ny'] });
      // legs, and on the big ones a rail along the back
      for (const e of [-0.36, 0.36]) {
        C.copy(p).addScaledVector(along, e * T.w).addScaledVector(face, -0.12).setY(g + (T.foot + T.h) / 2 - 0.2);
        boxAt(C, along, face, 0.1, T.foot + T.h + 0.4 - 0.1, 0.1, sw.steel);
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
  let wallIndex = 0;
  for (const wall of track.tyreWalls) {
    const len = track.wrap(wall.s1 - wall.s0);
    const n = Math.max(1, Math.round(len / TYRE.step));
    const pitch = len / n;
    const look = tyreFaces[wallIndex++ % tyreFaces.length];
    for (let k = 0; k < n; k++) {
      const s = track.wrap(wall.s0 + (k + 0.5) * pitch);
      levelFrame(track, s, frame);
      const dist = track.edgeAt(s, wall.side) + TYRE.r + 0.02;
      const p = spot(s, wall.side, dist);
      const g = groundAt(p, p.y) - 0.05;
      const face = frame.flat.clone().multiplyScalar(-wall.side);
      // every third block of stacks painted, the rest plain
      const uv = Math.floor(k / 5) % 3 === 1 ? look : signs.special.tyres;
      // the half of each stack that faces the road, as a prism round its own axis
      // (a right-handed frame whose angles 0 .. PI sweep the side towards the road)
      const z = face.clone().negate();
      const axis = { x: new THREE.Vector3().crossVectors(Y.set(0, 1, 0), z), y: new THREE.Vector3(0, 1, 0), z };
      b.prism(p.clone().setY(g), TYRE.r, TYRE.h, sides, uv, { a0: 0, a1: Math.PI, top: false, axis });
      if (k % 5 === 0) {
        // the back rows and the top, as one dark block behind the front row's axis
        const run = Math.min(5, n - k) * pitch;
        C.copy(p).addScaledVector(frame.ahead, (run - pitch) / 2).addScaledVector(face, -0.55).setY(g + TYRE.h / 2);
        boxAt(C, frame.ahead, face, run, TYRE.h, 1.1, { py: sw.rubber, pz: sw.rubber, rest: sw.rubber });
      }
    }
  }

  // ---- distance boards: square, facing the cars, on a post (or hung from the parapet on a bridge)
  for (const d of track.distanceBoards) {
    levelFrame(track, d.s, frame);
    const dist = track.edgeAt(d.s, d.side) + DIST.size / 2 + (d.bridge ? 0.35 : 0.6);
    const p = spot(d.s, d.side, dist);
    const face = frame.ahead.clone().negate();
    const across = frame.flat.clone().multiplyScalar(-1);
    const uv = signs.distance[d.label] ?? signs.distance['100'];
    C.copy(p).setY(p.y + DIST.foot + DIST.size / 2);
    M.makeBasis(X.copy(across).multiplyScalar(DIST.size), Y.set(0, DIST.size, 0), Z.copy(face).multiplyScalar(0.08)).setPosition(C);
    b.box(M, { pz: uv, rest: sw.frame });
    if (d.bridge) {
      // an arm from the parapet
      C.copy(p).addScaledVector(frame.flat, -d.side * (DIST.size / 2)).setY(p.y + DIST.foot + 0.3);
      boxAt(C, frame.flat, frame.ahead, DIST.size + 0.3, 0.1, 0.1, sw.steel);
    } else {
      const g = groundAt(p, p.y);
      C.copy(p).addScaledVector(face, -0.08).setY((g + p.y + DIST.foot + DIST.size) / 2);
      boxAt(C, across, face, 0.12, p.y + DIST.foot + DIST.size - g, 0.12, sw.steel);
    }
  }

  // ---- marshal posts: a hut with an opening towards the road, a light panel on a pole beside it
  for (const m of track.marshals) {
    levelFrame(track, m.s, frame);
    const dist = Math.max(Math.abs(m.lat), track.edgeAt(m.s, m.side) + 1.8);
    const p = spot(m.s, m.side, dist);
    const g = groundAt(p, p.y);
    const face = frame.flat.clone().multiplyScalar(-m.side);
    const along = frame.ahead.clone().multiplyScalar(m.side);
    C.copy(p).setY(g + 1.2);
    boxAt(C, along, face, 2.2, 2.4, 1.6, { pz: sw.white, rest: sw.white });
    // the opening: a dark band across the front
    C.copy(p).addScaledVector(face, 0.81).setY(g + 1.55);
    boxAt(C, along, face, 1.8, 0.7, 0.02, sw.dark);
    // the roof, overhanging towards the road
    C.copy(p).addScaledVector(face, 0.2).setY(g + 2.47);
    boxAt(C, along, face, 2.6, 0.14, 2.2, sw.red);
    // the light panel on its pole, facing the cars that come
    C.copy(p).addScaledVector(along, 1.6 * m.side).addScaledVector(face, 0.5).setY(g + 1.5);
    boxAt(C, frame.ahead, frame.flat, 0.1, 3.0, 0.1, sw.steel);
    C.y = g + 2.7;
    boxAt(C, frame.flat, frame.ahead.clone().negate(), 0.7, 0.5, 0.12, { pz: signs.special.panel, rest: sw.dark });
  }

  return { boards };
}
