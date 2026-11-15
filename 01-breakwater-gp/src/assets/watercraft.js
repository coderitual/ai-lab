// A sit-down sport watercraft, modelled in code.
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.
//
// The body is one continuous cross-section (keel, strake, chine, topside,
// gunwale, footwell, centre tunnel / hood) swept from stern to bow and split
// into strips where the real thing has a hard edge, so the chines and the deck
// edge stay crisp while everything in between is smooth. Saddle, cowl, screen,
// mirrors, bumpers, sponsons and the jet are separate parts on top.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, lerp, smoothstep } from '../engine/math.js';
import { fan, loft, merge, part } from './geo.js';
import { withSkyFog } from './sky.js';

export const CRAFT = {
  length: 3.25,
  sternZ: -1.55,
  bowZ: 1.7,
  halfWidth: 0.6,
  seatTop: 0.6,
  gripY: 0.84,
  gripZ: 0.16,
  gripX: 0.3,
  /** Where the steering column pivots (handlebar group origin). */
  barPivot: new THREE.Vector3(0, 0.84, 0.16),
  footY: 0.3,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- hull lines, t = 0 (stern) .. 1 (bow)
const zAt = (t) => lerp(CRAFT.sternZ, CRAFT.bowZ, t);
function halfWidthAt(t) {
  if (t <= 0.45) return lerp(0.52, CRAFT.halfWidth, smoothstep(0, 0.36, t));
  const u = (t - 0.45) / 0.55;
  return Math.max(0.03, CRAFT.halfWidth * Math.pow(1 - Math.pow(u, 2.4), 0.7));
}
const keelAt = (t) => -0.27 + 0.55 * Math.pow(clamp01((t - 0.55) / 0.45), 1.7);
const chineAt = (t) => -0.07 + 0.42 * Math.pow(clamp01((t - 0.45) / 0.55), 1.5);
const gunwaleAt = (t) => 0.3 + 0.16 * smoothstep(0.3, 1, t);
/** 0 where the footwells are, 1 where the deck has risen into the hood. */
const hoodAt = (t) => smoothstep(0.44, 0.6, t);
/** Top of the centre body: boarding platform, seat base, cowl, then down the hood to the nose. */
function spineAt(t) {
  const seatBase = lerp(0.27, 0.41, smoothstep(0.06, 0.13, t));
  const hood = lerp(0.64, gunwaleAt(t) + 0.05, Math.pow(smoothstep(0.6, 1.0, t), 0.8));
  return lerp(seatBase, hood, hoodAt(t));
}

const FLOOR = 0.245; // footwell floor

/** The half cross-section at station t, from the keel round to the centre line (port side). */
function section(t) {
  const z = zAt(t);
  const w = halfWidthAt(t);
  const yk = keelAt(t);
  const yc = chineAt(t);
  const yg = gunwaleAt(t);
  const hood = hoodAt(t);
  const spine = spineAt(t);
  const yWell = lerp(FLOOR, yg + 0.02, hood);
  // half-width of the centre body: narrow under the saddle, the whole deck forward of it
  const xTun = lerp(0.2, Math.max(w - 0.13, 0.02), hood);
  const xWellOut = Math.max(w - 0.085, 0.012);
  const xWellIn = Math.min(xTun + 0.03, xWellOut);
  return [
    V(0, yk, z), //                                          0 keel
    V(0.4 * w, lerp(yk, yc, 0.52) - 0.014 * (1 - hood), z), // 1 lifting strake
    V(0.8 * w, yc, z), //                                    2 chine
    V(0.87 * w, yc + 0.032, z), //                           3 top of the chine flat
    V(0.97 * w, lerp(yc, yg, 0.55), z), //                   4 topside
    V(w, yg - 0.035, z), //                                  5 under the rub rail
    V(w - 0.004, yg, z), //                                  6 gunwale
    V(Math.max(w - 0.055, 0.016), yg + 0.012, z), //         7 inner rim
    V(xWellOut, yWell, z), //                                8 footwell, outer edge
    V(xWellIn, yWell, z), //                                 9 footwell, inner edge
    V(Math.min(xTun, xWellOut), spine - 0.075, z), //       10 shoulder of the centre body
    V(Math.min(xTun, xWellOut) * 0.55, spine - 0.014, z), // 11
    V(0, spine, z), //                                      12 centre line
  ];
}

function buildHullGeometry(team) {
  const hull = new THREE.Color(team.hull);
  const accent = new THREE.Color(team.accent);
  const belly = new THREE.Color('#f4f1ea');
  const dark = new THREE.Color('#15181d');
  const mat = new THREE.Color('#23272e');
  const deckShade = hull.clone().multiplyScalar(0.8);

  const N = 40;
  const ts = [];
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    ts.push(t);
    rows.push(section(t));
  }
  const mirror = (v) => V(-v.x, v.y, v.z);
  const parts = [];
  for (const side of [1, -1]) {
    const flip = side === -1;
    const strip = (from, to) => rows.map((r) => r.slice(from, to + 1).map((v) => (side === 1 ? v : mirror(v))));
    // planing bottom, pale
    parts.push(loft(strip(0, 2), () => belly, { flip }));
    // chine flat: a dark waterline band
    parts.push(loft(strip(2, 3), () => dark, { flip }));
    // topsides in two bands, so the paint line between them is crisp: a long
    // flash low on the hull, team colour above it
    parts.push(loft(strip(3, 4), (i) => (ts[i] > 0.16 && ts[i] < 0.9 ? accent : hull), { flip }));
    parts.push(loft(strip(4, 5), (i) => (ts[i] < 0.08 ? deckShade : hull), { flip }));
    // gunwale and inner rim
    parts.push(loft(strip(5, 7), () => hull, { flip }));
    // footwells (non-slip, dark); forward of them the same strip is the side of the hood
    parts.push(loft(strip(7, 10), (i, j) => (hoodAt(ts[i]) > 0.5 ? (j === 3 ? deckShade : hull) : mat), { flip }));
    // centre body: dark under the saddle; forward of it the painted hood, with a
    // stripe down the middle that widens toward the nose
    const onHood = (i) => hoodAt(ts[i]) >= 0.5;
    parts.push(loft(strip(10, 11), (i) => (onHood(i) ? hull : ts[i] < 0.13 ? mat : dark), { flip }));
    parts.push(loft(strip(11, 12), (i) => (onHood(i) ? accent : ts[i] < 0.13 ? mat : dark), { flip }));
  }
  // transom
  const stern = rows[0];
  const outline = [...stern, ...stern.slice(1, -1).reverse().map(mirror)];
  parts.push(fan(outline, deckShade, { flip: true }));
  return merge(parts);
}

/** The saddle: a stepped two-up seat, swept like the hull. */
function buildSeatGeometry(team) {
  const dark = new THREE.Color('#17191e');
  const panel = new THREE.Color(team.hull).multiplyScalar(0.62);
  const z0 = -1.17;
  const z1 = 0.17;
  const N = 16;
  const rows = [];
  const us = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const z = lerp(z0, z1, u);
    // rear (passenger) pad sits higher; the front climbs toward the cowl
    const top = CRAFT.seatTop + 0.085 * (1 - smoothstep(-0.9, -0.74, z)) + 0.06 * smoothstep(-0.12, 0.16, z);
    const half = lerp(0.2, 0.14, smoothstep(-0.25, 0.17, z)) * (0.82 + 0.18 * smoothstep(0, 0.12, u));
    const base = 0.4;
    us.push(u);
    rows.push([V(half, base, z), V(half * 1.02, top - 0.1, z), V(half * 0.86, top - 0.03, z), V(half * 0.45, top, z), V(0, top + 0.005, z)]);
  }
  const mirror = (v) => V(-v.x, v.y, v.z);
  const parts = [];
  for (const side of [1, -1]) {
    const pts = rows.map((r) => r.map((v) => (side === 1 ? v : mirror(v))));
    parts.push(loft(pts, (i, j) => (j <= 1 && us[i] > 0.12 && us[i] < 0.86 ? panel : dark), { flip: side === -1 }));
  }
  const back = rows[0];
  parts.push(fan([...back, ...back.slice(0, -1).reverse().map(mirror)], dark, { flip: true }));
  return merge(parts);
}

function buildTrimGeometry() {
  const dark = '#1b1e24';
  const rubber = '#101216';
  const metal = '#9aa1a9';
  const parts = [];

  // cowl and instrument pod
  parts.push(part(new RoundedBoxGeometry(0.42, 0.17, 0.4, 3, 0.07), dark, { pos: [0, 0.655, 0.37], rot: [-0.42, 0, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.2, 0.05, 0.12, 2, 0.02), '#0b1118', { pos: [0, 0.745, 0.33], rot: [-0.95, 0, 0] }));
  // steering column shroud
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.075, 0.26, 12), dark, { pos: [0, 0.73, 0.21], rot: [0.5, 0, 0] }));
  // mirrors on short stalks
  for (const sx of [1, -1]) {
    parts.push(part(new THREE.CylinderGeometry(0.014, 0.018, 0.14, 6), dark, { pos: [sx * 0.25, 0.72, 0.46], rot: [0.2, 0, -sx * 0.9] }));
    parts.push(part(new RoundedBoxGeometry(0.11, 0.07, 0.035, 2, 0.016), dark, { pos: [sx * 0.33, 0.775, 0.45], rot: [-0.15, sx * 0.35, 0] }));
  }
  // air scoops let into the hood
  for (const sx of [1, -1]) {
    parts.push(part(new RoundedBoxGeometry(0.075, 0.03, 0.34, 2, 0.012), rubber, { pos: [sx * 0.21, 0.565, 0.78], rot: [0.27, -sx * 0.16, sx * 0.3] }));
  }
  // glove-box lid ahead of the saddle
  parts.push(part(new RoundedBoxGeometry(0.2, 0.03, 0.16, 2, 0.012), dark, { pos: [0, 0.633, 0.6], rot: [0.2, 0, 0] }));

  // rub rail right round the gunwale
  const railPts = [];
  const M = 30;
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    railPts.push(V(halfWidthAt(t) + 0.014, gunwaleAt(t) - 0.02, zAt(t)));
  }
  for (let i = M - 1; i >= 0; i--) {
    const t = i / M;
    railPts.push(V(-halfWidthAt(t) - 0.014, gunwaleAt(t) - 0.02, zAt(t)));
  }
  parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, false, 'centripetal'), 84, 0.034, 6, false), rubber));
  // bow bumper
  parts.push(part(new THREE.SphereGeometry(0.075, 12, 8), rubber, { pos: [0, gunwaleAt(1) - 0.03, CRAFT.bowZ - 0.02], scale: [1.25, 0.9, 1] }));
  // stern bumper along the top of the transom
  parts.push(part(new RoundedBoxGeometry(1.0, 0.07, 0.06, 2, 0.028), rubber, { pos: [0, 0.275, CRAFT.sternZ - 0.012] }));

  // sponsons: the fins on the hull sides that bite in a turn
  for (const sx of [1, -1]) {
    parts.push(part(new RoundedBoxGeometry(0.05, 0.085, 0.62, 2, 0.02), dark, { pos: [sx * 0.555, 0.05, -1.02], rot: [0, sx * 0.045, -sx * 0.22] }));
  }

  // boarding platform mats and footwell mats
  parts.push(part(new RoundedBoxGeometry(0.34, 0.016, 0.3, 2, 0.006), rubber, { pos: [0, 0.279, -1.37] }));
  for (const sx of [1, -1]) {
    parts.push(part(new RoundedBoxGeometry(0.2, 0.014, 1.2, 2, 0.006), rubber, { pos: [sx * 0.37, FLOOR + 0.007, -0.78] }));
    // raised heel stops at the back of each well
    parts.push(part(new RoundedBoxGeometry(0.2, 0.035, 0.06, 2, 0.012), rubber, { pos: [sx * 0.37, FLOOR + 0.03, -1.3], rot: [0.35, 0, 0] }));
  }
  // grab handle behind the saddle
  parts.push(part(new THREE.TorusGeometry(0.15, 0.02, 8, 16, Math.PI), metal, { pos: [0, 0.5, -1.2], rot: [-0.5, 0, 0] }));

  // jet: pump housing, steering nozzle, ride plate
  parts.push(part(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 14), dark, { pos: [0, -0.07, -1.58], rot: [Math.PI / 2, 0, 0] }));
  parts.push(part(new THREE.CylinderGeometry(0.075, 0.105, 0.2, 14), metal, { pos: [0, -0.07, -1.72], rot: [Math.PI / 2, 0, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.34, 0.02, 0.3, 2, 0.008), metal, { pos: [0, -0.225, -1.52] }));
  return merge(parts);
}

/** A low screen wrapped round the front of the cowl. */
function buildScreenGeometry() {
  const tint = new THREE.Color('#0d2231');
  const rows = [];
  const R = 4;
  const C = 8;
  for (let i = 0; i <= R; i++) {
    const h = i / R;
    const row = [];
    for (let j = 0; j <= C; j++) {
      const a = (j / C - 0.5) * 2; // -1 .. 1 across
      const half = lerp(0.2, 0.15, h);
      row.push(V(a * half, 0.7 + 0.15 * h, 0.56 - 0.12 * h - 0.1 * a * a + 0.012 * Math.sin(h * Math.PI)));
    }
    rows.push(row);
  }
  // seen from both sides
  return merge([loft(rows, () => tint), loft(rows, () => tint, { flip: true })]);
}

function buildHandlebarGeometry() {
  const parts = [];
  // the bar, swept back a little at the ends
  for (const sx of [1, -1]) {
    parts.push(part(new THREE.CylinderGeometry(0.019, 0.019, 0.33, 8), '#3a3f47', { pos: [sx * 0.16, 0, -0.012], rot: [0, -sx * 0.1, Math.PI / 2] }));
    parts.push(part(new THREE.CylinderGeometry(0.031, 0.031, 0.13, 10), '#0c0d10', { pos: [sx * 0.3, 0, -0.026], rot: [0, -sx * 0.1, Math.PI / 2] }));
    // lever
    parts.push(part(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), '#8d949c', { pos: [sx * 0.26, 0.0, 0.03], rot: [0, -sx * 0.25, Math.PI / 2] }));
  }
  // crash pad over the clamp
  parts.push(part(new RoundedBoxGeometry(0.2, 0.085, 0.1, 3, 0.035), '#1b1e24', { pos: [0, 0.005, 0.0] }));
  return merge(parts);
}

/**
 * Build one craft. Returns a Group with:
 *   userData.handlebar  — Object3D to rotate around Y when steering
 *   userData.riderMount — Object3D where the rider is attached
 */
export function createWatercraft(team) {
  const group = new THREE.Group();
  group.name = `craft-${team.name}`;

  // gel coat: colour under a clear glossy layer
  const paintMat = withSkyFog(
    new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.07, envMapIntensity: 1.15 }),
  );
  const trimMat = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.12 }));
  const seatMat = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 }));
  const screenMat = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.5, envMapIntensity: 1.4 }));

  const hull = new THREE.Mesh(buildHullGeometry(team), paintMat);
  hull.name = 'hull';
  group.add(hull);

  const seat = new THREE.Mesh(buildSeatGeometry(team), seatMat);
  seat.name = 'seat';
  group.add(seat);

  const trim = new THREE.Mesh(buildTrimGeometry(), trimMat);
  trim.name = 'trim';
  group.add(trim);

  const screen = new THREE.Mesh(buildScreenGeometry(), screenMat);
  screen.name = 'screen';
  group.add(screen);

  const handlebar = new THREE.Mesh(buildHandlebarGeometry(), trimMat);
  handlebar.name = 'handlebar';
  handlebar.position.copy(CRAFT.barPivot);
  group.add(handlebar);

  const riderMount = new THREE.Group();
  riderMount.name = 'riderMount';
  group.add(riderMount);

  group.userData.handlebar = handlebar;
  group.userData.riderMount = riderMount;
  group.userData.materials = [paintMat, trimMat, seatMat, screenMat];
  return group;
}
