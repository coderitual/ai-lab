// The start: a steel truss across the road at the line, standing on a lattice
// tower each side just beyond the walls, with the circuit's name board on its
// face and, hanging from its middle over the road, the start lamps: five
// columns of four round lamps in dark housings, each lamp under its hood.
//
// The lower two lamps of each column are red and count the start down (the
// game's sequence, setStartLights(0..5)); when they go out together the upper
// two show green for a few seconds (the world's fixed step times it). Lamps
// are emitters far brighter than anything they light, switched by colour,
// never by visibility. Their unlit lenses are dark tinted glass.
//
// Also here: the timing posts at the line, and where the start's buildings
// keep the forest off (layBy, read by forest.js).

import * as THREE from 'three';
import { beam } from './builder.js';
import { levelFrame } from './furniture.js';

/** A lit lamp's radiance (linear, scene units): red, and the green of the go. */
const RED = [38, 1.6, 0.5];
const GREEN = [3.0, 26, 13];
/** An unlit lens: its tint, as a share of what the time of day's exposure shows as mid grey. */
const LENS_RED = [0.035, 0.006, 0.005];
const LENS_GREEN = [0.004, 0.018, 0.013];
/** Seconds the green shows after the lamps go out, and over how much of the end it fades. */
const GREEN_HOLD = 4;
const GREEN_FADE = 1;
/** The truss: heights of its bottom and top chords over the line, its depth along the road (m). */
const TRUSS = { bottom: 7.4, top: 8.9, depth: 1.1 };
/** The name board: its size (8 : 1, as the atlas cell) and the height of its foot. */
const BOARD = { w: 16, foot: 7.15 };
/** Start lamps: columns, lamps per column, radius, spacing (m). */
const LAMPS = { columns: 5, rows: 4, r: 0.19, pitch: 0.5, colW: 0.56, gap: 0.16 };

/** The pit building's place: signed s of its ends, metres from the land-side wall to its front, its depth. */
export const PIT = { s0: -78, s1: 22, beyond: 12, depth: 15 };

/**
 * Where the start's buildings stand, as the circle the forest keeps its trees out of (forest.js reads it): the
 * pit building on the land side of the straight. Pure, from the Track.
 * @param {object} track
 */
export function layBy(track) {
  const s = track.wrap(PIT.s0 + (PIT.s1 - PIT.s0) / 2);
  const lat = -(track.edgeAt(s, -1) + PIT.beyond + PIT.depth / 2);
  const at = track.pointAt(s, lat, new THREE.Vector3());
  return { s, lat, x: at.x, z: at.z, yaw: 0, radius: (PIT.s1 - PIT.s0) / 2 + 8 };
}

/**
 * Builds the gantry into the dressing's patches and returns its lamps.
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {ReturnType<import('./builder.js').createBuilder>} options.b
 * @param {ReturnType<import('./signs.js').createSigns>} options.signs
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createStart({ track, terrain, b, signs, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'start';
  const frame = levelFrame(track, track.gantry.s, {});
  const y0 = frame.pos.y;
  /** A point of the map at (lat, height over the line, metres along the road). */
  const P = (lat, h, along = 0) =>
    new THREE.Vector3(frame.pos.x + frame.flat.x * lat + frame.ahead.x * along, y0 + h, frame.pos.z + frame.flat.z * lat + frame.ahead.z * along);
  const sw = signs.swatch;
  const M = new THREE.Matrix4();
  const member = (a, c, w, uv = sw.steel) => b.box(beam(a, c, w, w, M), uv);
  /** A box in the gantry's own axes: centre (lat, h, along), sizes across, up, along. */
  const block = (lat, h, along, sx, sy, sz, uv) => {
    const c = P(lat, h, along);
    M.makeBasis(frame.flat.clone().multiplyScalar(sx), new THREE.Vector3(0, sy, 0), frame.ahead.clone().multiplyScalar(sz)).setPosition(c);
    b.box(M, uv);
  };

  const latL = track.gantry.latL;
  const latR = track.gantry.latR;
  const half = TRUSS.depth / 2;
  const tw = 0.55; // half width of a tower across the road

  // ---- the towers: four posts, rungs on every face, a cross in every bay
  for (const lat of [latL, latR]) {
    const out = Math.sign(lat);
    const foot = P(lat, 0);
    const ground = Math.min(0, terrain.heightAt(foot.x, foot.z) - y0) - 0.3;
    block(lat, ground + 0.35, 0, 2 * tw + 0.7, 0.7, TRUSS.depth + 0.7, sw.concrete);
    for (const dl of [-tw, tw]) for (const da of [-half, half]) member(P(lat + dl, ground, da), P(lat + dl, TRUSS.top + 0.1, da), 0.16);
    const bays = Math.round((TRUSS.top - ground) / 1.15);
    const bay = (TRUSS.top - ground) / bays;
    for (let k = 0; k <= bays; k++) {
      const h = ground + k * bay;
      if (k > 0) {
        member(P(lat - tw, h, -half), P(lat + tw, h, -half), 0.08);
        member(P(lat - tw, h, half), P(lat + tw, h, half), 0.08);
        member(P(lat - tw, h, -half), P(lat - tw, h, half), 0.08);
        member(P(lat + tw, h, -half), P(lat + tw, h, half), 0.08);
      }
      if (k < bays) {
        const flip = k % 2 ? 1 : -1;
        for (const a of [-half, half]) member(P(lat - tw * flip, h, a), P(lat + tw * flip, h + bay, a), 0.06);
        member(P(lat - out * tw, h, -half * flip), P(lat - out * tw, h + bay, half * flip), 0.06);
      }
    }
  }

  // ---- the truss: four chords, verticals, diagonals on its faces
  const lo = latR + tw;
  const hi = latL - tw;
  for (const h of [TRUSS.bottom, TRUSS.top]) for (const a of [-half, half]) member(P(lo, h, a), P(hi, h, a), 0.17);
  const panels = Math.round((hi - lo) / 1.5);
  const step = (hi - lo) / panels;
  for (let k = 0; k <= panels; k++) {
    const l = lo + k * step;
    for (const a of [-half, half]) member(P(l, TRUSS.bottom, a), P(l, TRUSS.top, a), 0.08);
    member(P(l, TRUSS.top, -half), P(l, TRUSS.top, half), 0.07);
    member(P(l, TRUSS.bottom, -half), P(l, TRUSS.bottom, half), 0.07);
    if (k < panels) {
      const up = k % 2 === 0;
      for (const a of [-half, half]) member(P(l, up ? TRUSS.bottom : TRUSS.top, a), P(l + step, up ? TRUSS.top : TRUSS.bottom, a), 0.06);
    }
  }
  // a catwalk along the back and its rail
  block((lo + hi) / 2, TRUSS.bottom - 0.05, half + 0.45, hi - lo, 0.06, 0.8, sw.frame);
  member(P(lo, TRUSS.bottom + 1.0, half + 0.85), P(hi, TRUSS.bottom + 1.0, half + 0.85), 0.05);

  // ---- the name board on the face the grid sees, framed in steel; the same on the back
  const mid = (latL + latR) / 2;
  const boardW = Math.min(BOARD.w, hi - lo - 1);
  const boardH = boardW / 8;
  const bh = BOARD.foot + boardH / 2;
  const front = -half - 0.18;
  // the unit box's +z face looks along -ahead (to the grid) and its +x runs to the driver's right
  M.makeBasis(frame.flat.clone().multiplyScalar(-boardW), new THREE.Vector3(0, boardH, 0), frame.ahead.clone().multiplyScalar(-0.12)).setPosition(P(mid, bh, front));
  b.box(M, { pz: signs.gantry, rest: sw.dark });
  block(mid, BOARD.foot - 0.06, front, boardW + 0.24, 0.12, 0.2, sw.frame);
  block(mid, BOARD.foot + boardH + 0.06, front, boardW + 0.24, 0.12, 0.2, sw.frame);
  for (const e of [-1, 1]) block(mid + e * (boardW / 2 + 0.06), bh, front, 0.12, boardH + 0.24, 0.2, sw.frame);
  M.makeBasis(frame.flat.clone().multiplyScalar(boardW), new THREE.Vector3(0, boardH, 0), frame.ahead.clone().multiplyScalar(0.12)).setPosition(P(mid, bh, half + 0.25));
  b.box(M, { pz: signs.gantry, rest: sw.dark });

  // ---- the start lamps: five columns hanging under the middle of the truss
  const cols = LAMPS.columns;
  const pitch = LAMPS.colW + LAMPS.gap;
  const colTop = TRUSS.bottom - 0.12;
  const colH = LAMPS.rows * LAMPS.pitch + 0.2;
  const lensAt = -0.17 - 0.005; // the lenses' plane, along the road (towards the grid)
  block(mid, colTop + 0.06, -0.05, cols * pitch + 0.3, 0.12, 0.3, sw.frame);
  for (const e of [-1, 1]) member(P(mid + e * cols * pitch * 0.35, colTop, -0.05), P(mid + e * cols * pitch * 0.35, TRUSS.bottom, -0.05), 0.07);
  const lampAt = [];
  // a right-handed frame: the tube's axis towards the grid, its angle 0 to the left, PI .. 2 PI over the top
  const hoodAxis = { x: frame.flat.clone(), y: frame.ahead.clone().negate(), z: new THREE.Vector3(0, 1, 0) };
  for (let c = 0; c < cols; c++) {
    // column 0 on the driver's left (lat is + to the left)
    const lat = mid + ((cols - 1) / 2 - c) * pitch;
    block(lat, colTop - colH / 2, 0, LAMPS.colW, colH, 0.34, sw.lampHood);
    for (let r = 0; r < LAMPS.rows; r++) {
      const h = colTop - 0.1 - (r + 0.5) * LAMPS.pitch;
      lampAt.push({ lat, h, c, r });
      // the hood: the upper part of a short tube round the lens, open below
      b.prism(P(lat, h, -0.17), LAMPS.r + 0.035, 0.16, 6, sw.lampHood, { a0: Math.PI - 0.35, a1: Math.PI * 2 + 0.35, top: false, axis: hoodAxis, inside: true });
    }
  }
  const lens = new THREE.CircleGeometry(LAMPS.r, 14);
  const lensMaterial = atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const lenses = new THREE.InstancedMesh(lens, lensMaterial, lampAt.length);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-frame.ahead.x, -frame.ahead.z));
  lampAt.forEach((l, i) => lenses.setMatrixAt(i, new THREE.Matrix4().compose(P(l.lat, l.h, lensAt), q, new THREE.Vector3(1, 1, 1))));
  lenses.name = 'start-lamps';
  lenses.castShadow = false;
  lenses.computeBoundingSphere();
  group.add(lenses);

  // ---- the timing posts at the line: a photocell on a striped post at each wall
  for (const side of [1, -1]) {
    const lat = side * (track.edgeAt(track.gantry.s, side) + 0.35);
    const foot = P(lat, 0);
    const g = terrain.heightAt(foot.x, foot.z) - y0;
    block(lat, g + 0.7, 0, 0.16, 1.4, 0.16, signs.special.stripes);
    block(lat, g + 1.48, 0, 0.26, 0.18, 0.26, sw.dark);
  }

  // ---- the lamps' state
  const color = new THREE.Color();
  let lit = 0;
  let green = 0;
  let lensScale = 1;
  const paint = () => {
    const g = Math.min(1, green / GREEN_FADE);
    lampAt.forEach((l, i) => {
      if (l.r >= 2) color.setRGB(...(l.c < lit ? RED : LENS_RED.map((v) => v * lensScale)));
      else color.setRGB(...GREEN.map((v, k) => v * g + LENS_GREEN[k] * lensScale * (1 - g)));
      lenses.setColorAt(i, color);
    });
    lenses.instanceColor.needsUpdate = true;
  };
  paint();

  return {
    group,
    setStartLights(n) {
      if (n === lit) return;
      // all five out at once after a full row: the go
      if (n === 0 && lit === cols) green = GREEN_HOLD;
      if (n > 0) green = 0;
      lit = n;
      paint();
    },
    update(dt) {
      if (green <= 0) return;
      green = Math.max(0, green - dt);
      paint();
    },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      // the unlit glass is a tint the eye sees as dark whatever the exposure
      lensScale = 1 / time.exposure;
      paint();
    },
    dispose() {
      lens.dispose();
      lensMaterial.dispose();
    },
  };
}
