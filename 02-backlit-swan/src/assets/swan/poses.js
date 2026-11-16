// How the swan is posed: the list of numbers an animation writes, the seven
// neck shapes of the reference film as presets, and the solver that turns a
// pose into the neck's centre line.
//
// The neck is described the way a real one works: not by where its points
// are but by how much each stretch of it is bent. Eight equal stretches each
// have a bend angle; the solver walks up the neck turning by those angles as
// it goes. Two poses blended this way give a neck that is still a neck: it
// keeps its length and never folds through itself, which blending point
// positions would not guarantee. Twists and sideways bends are added on the
// way up in the same manner, so a head turn is one number.
//
// No three.js here: plain numbers and typed arrays, so that the solver can
// also be run on its own (for fitting the presets, and by the animation to
// ask "where would the bill be?").

import { L, NECK_LENGTH, NECK_SUNK, NECK_ROOT, HEAD_CENTRE, BILL_TIP, BOW_DROP, BODY_STRETCH, bowShape, birdZ } from './anatomy.js';

/** Stretches of neck that have a bend angle of their own. */
export const NECK_SECTIONS = 8;
/** Places along the neck where the solver leaves a position and an orientation (the last one is the head's). */
export const NECK_RINGS = 49;

/**
 * @typedef {object} SwanPose
 * @property {Float32Array} neck bend of each eighth of the neck, base first, in radians. Positive curls the
 *   neck forward and down (toward the bill's side); negative leans it back.
 * @property {number} lean the direction in which the neck leaves the body: radians from straight up, positive forward.
 * @property {number} bill pitch of the bill below the horizontal, in radians: 0 level, 1.57 straight down,
 *   negative above the horizon. It is an angle in the world, not relative to the neck: the top of the neck
 *   bends by whatever is needed to reach it.
 * @property {number} turn the head and the top of the neck turned about the neck's own axis, radians; positive
 *   swings the bill to the bird's left. +-1.57 are the extremes of the shake.
 * @property {number} turnAt where along the neck that turn happens, 0 base .. 1 head. Below a bend it swings the
 *   whole arch round (the shake); close to the head it only rolls the head.
 * @property {number} sway the whole neck bent sideways, radians in total; positive to the bird's left.
 * @property {number} look the head turned sideways on the end of the neck, radians; positive to the bird's left.
 * @property {number} stretch length of the neck: 1 is 0.95 L. A stretched neck is thinner.
 * @property {number} bow 0 .. 1: the front of the body down (the neck leaves the back 0.20 L above the water
 *   at 0 and 0.09 L at 1).
 * @property {number} wingLift 0 wings relaxed (back 0.43 L high) .. 1 arched and tall (0.51 L, 0.66 L across).
 * @property {number} bodyStretch 0 .. 1: the body lengthened by up to 20 %, as when it reaches.
 * @property {number} tail -1 .. 1: the tail lowered or cocked.
 * @property {number} breath -1 .. 1: breathing out or in; the body swells by a few millimetres.
 */

/** @returns {SwanPose} the upright column, wings arched */
export function createPose() {
  return {
    neck: new Float32Array(NECK_SECTIONS),
    lean: 0,
    bill: 1.2,
    turn: 0,
    turnAt: 0.6,
    sway: 0,
    look: 0,
    stretch: 1,
    bow: 0,
    wingLift: 1,
    bodyStretch: 0,
    tail: 0,
    breath: 0,
  };
}

const SCALARS = ['lean', 'bill', 'turn', 'turnAt', 'sway', 'look', 'stretch', 'bow', 'wingLift', 'bodyStretch', 'tail', 'breath'];

/** Copy `from` into `to`. */
export function copyPose(to, from) {
  to.neck.set(from.neck);
  for (const key of SCALARS) to[key] = from[key];
  return to;
}

/**
 * out = a + (b - a) * t, field by field. `out` may be `a` or `b`. t may go
 * outside 0..1 a little for an overshoot.
 */
export function blendPose(out, a, b, t) {
  for (let i = 0; i < NECK_SECTIONS; i++) out.neck[i] = a.neck[i] + (b.neck[i] - a.neck[i]) * t;
  for (const key of SCALARS) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

/**
 * out = sum of weights[i] * poses[i]; the weights should add up to 1.
 * For blending more than two presets at once.
 */
export function mixPoses(out, poses, weights) {
  out.neck.fill(0);
  for (const key of SCALARS) out[key] = 0;
  for (let p = 0; p < poses.length; p++) {
    const w = weights[p];
    if (!w) continue;
    for (let i = 0; i < NECK_SECTIONS; i++) out.neck[i] += poses[p].neck[i] * w;
    for (const key of SCALARS) out[key] += poses[p][key] * w;
  }
  return out;
}

const preset = (neck, rest) => Object.freeze({ ...createPose(), ...rest, neck: Float32Array.from(neck) });

/**
 * The neck shapes of the film. The eight bends, the lean and the stretch of
 * each were fitted to the centre line measured from the film at that moment
 * (the points are in docs/notes/swan.md); the fit passes within 0.02 L of
 * them. The bill's pitch, the wings and the bow are the film's own numbers.
 *
 *   A  0.3 s   the proud S, bill 62 degrees down
 *   B  1.2 s   stretched tall, bill level (the shake happens in this one)
 *   C  2 to 4 s  a straight column, head hung over the top
 *   D  4.75 s  arching over on the way down
 *   E  5.5 s   a tight hook, head at the water just ahead of the breast
 *   G  7.5 s   upright but bowed, wings relaxing
 *   F  10.5 s  the long low arch, head at the water 0.3 L ahead, front of the body down
 *
 * In E and F the bill is under water: the tip is 0.09 and 0.10 L below the
 * surface, 0.05 and 0.49 L ahead of where the breast meets the water.
 */
export const POSES = {
  A: preset([-0.180, -0.006, 0.033, 0.105, 0.223, 0.383, 0.482, 0.732], { lean: -0.151, bill: 1.082, stretch: 0.967 }),
  B: preset([0.022, 0.001, 0.054, 0.054, 0.024, 0.027, 0.160, 0.395], { lean: -0.215, bill: 0.052, stretch: 0.959 }),
  C: preset([0.066, 0.054, -0.020, -0.032, -0.044, 0.012, 0.245, 0.714], { lean: -0.125, bill: 1.257, stretch: 0.957 }),
  D: preset([0.100, -0.002, -0.107, -0.107, 0.145, 0.627, 0.892, 0.961], { lean: -0.128, bill: 1.658, stretch: 0.837, wingLift: 0.9, bow: 0.3 }),
  E: preset([-0.285, -0.226, -0.043, 0.356, 0.852, 1.097, 0.932, 0.754], { lean: 0.222, bill: 1.571, stretch: 0.852, wingLift: 0.8, bow: 0.7 }),
  G: preset([-0.240, -0.230, -0.067, 0.099, 0.230, 0.479, 0.588, 0.684], { lean: 0.306, bill: 1.396, stretch: 0.869, wingLift: 0.5, bow: 0.1 }),
  F: preset([-0.371, -0.244, 0.190, 0.875, 1.049, 0.546, 0.196, 0.064], { lean: 0.305, bill: 0.698, stretch: 0.966, wingLift: 0, bow: 1, bodyStretch: 0.85, tail: -0.5 }),
};

// ---------------------------------------------------------------- the solver

/**
 * Where the solver writes its answer. All positions are in bird space, metres.
 * @typedef {object} NeckSolution
 * @property {Float32Array} positions NECK_RINGS x 4: x, y, z of the centre line, and the factor by which
 *   the neck's radius is scaled there (a stretched neck is thinner)
 * @property {Float32Array} frames NECK_RINGS x 4: a quaternion per ring. Its z axis runs along the neck
 *   toward the head, its y axis points to the nape (the back of the neck), its x axis to the bird's left
 * @property {Float32Array} bends NECK_RINGS x 4: x, y = which way is the outside of the bend, in the
 *   ring's own x and y, in radians per metre; z, w unused
 * @property {Float32Array} billTip 3
 * @property {Float32Array} head 3: the middle of the head
 * @property {Float32Array} root 3: where the centre line starts, under the water
 */

/** @returns {NeckSolution} */
export function createNeckSolution() {
  return {
    positions: new Float32Array(NECK_RINGS * 4),
    frames: new Float32Array(NECK_RINGS * 4),
    bends: new Float32Array(NECK_RINGS * 4),
    billTip: new Float32Array(3),
    head: new Float32Array(3),
    root: new Float32Array(3),
  };
}

const STEPS = NECK_RINGS - 1;
// The top of the neck does the nodding: this much of its length, at the head end.
const NOD_SPAN = 0.09;
// The rings are not evenly spaced: the top fifth of the neck, where the head
// hinges and the tightest arches are, gets rings at half the spacing.
const FINE_STEPS = 16;
const COARSE = 1 / (STEPS - FINE_STEPS + FINE_STEPS / 2);
const ARC = new Float32Array(NECK_RINGS);
for (let i = 1; i < NECK_RINGS; i++) ARC[i] = ARC[i - 1] + (i <= STEPS - FINE_STEPS ? COARSE : COARSE / 2);
ARC[STEPS] = 1;

/**
 * How far along the neck's centre line a ring is: 0 at the root (under the
 * water) .. 1 at the back of the head. Fractions of a ring are allowed.
 * @param {number} ring 0 .. NECK_RINGS - 1
 */
export function ringArc(ring) {
  const r = Math.min(STEPS, Math.max(0, ring));
  const i = Math.min(STEPS - 1, Math.floor(r));
  return ARC[i] + (ARC[i + 1] - ARC[i]) * (r - i);
}
// A turn is spread over this much of the neck either side of `turnAt`.
const TURN_SPAN = 0.16;

const _kappa = new Float32Array(STEPS);
const _nod = new Float32Array(STEPS);
const _twist = new Float32Array(STEPS);

/** Rotate the vector (x, y, z) by the quaternion q[o..o+3]; the result goes to `out`. */
function rotate(q, o, x, y, z, out) {
  const qx = q[o];
  const qy = q[o + 1];
  const qz = q[o + 2];
  const qw = q[o + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}
const _v = new Float32Array(3);
const _w = new Float32Array(3);
const _q = new Float32Array(4);

/**
 * Work out the neck for a pose.
 *
 * Cost: 48 small steps of arithmetic, a few microseconds; nothing is
 * allocated. The mesh is not touched: the vertex shader reads the rings.
 *
 * @param {SwanPose} pose
 * @param {NeckSolution} out
 */
export function solveNeck(pose, out) {
  const { positions, frames, bends } = out;
  const stretch = pose.stretch;
  const length = (NECK_LENGTH + NECK_SUNK) * L * stretch;

  // How much each step bends. The eight angles are spread smoothly: each is
  // the bend of its stretch, and between the middles of two stretches the
  // rate of bending changes evenly, so the neck has no corners.
  let sagittal = pose.lean;
  let nodSum = 0;
  let twistSum = 0;
  for (let i = 0; i < STEPS; i++) {
    const s = 0.5 * (ARC[i] + ARC[i + 1]);
    const share = ARC[i + 1] - ARC[i]; // of the neck's length
    const f = s * NECK_SECTIONS - 0.5;
    const j = Math.min(NECK_SECTIONS - 2, Math.max(0, Math.floor(f)));
    const t = Math.min(1, Math.max(0, f - j));
    const rate = pose.neck[j] + (pose.neck[j + 1] - pose.neck[j]) * t; // radians per stretch
    _kappa[i] = rate * NECK_SECTIONS * share;
    sagittal += _kappa[i];
    const n = (s - (1 - NOD_SPAN)) / NOD_SPAN;
    _nod[i] = n > 0 ? Math.sin(Math.PI * n) ** 2 * share : 0;
    nodSum += _nod[i];
    const w = (s - pose.turnAt) / TURN_SPAN;
    _twist[i] = Math.abs(w) < 1 ? Math.cos(0.5 * Math.PI * w) ** 2 * share : 0;
    twistSum += _twist[i];
  }
  // what the top of the neck must still bend by for the bill to point where it was asked to
  const nod = Math.PI / 2 + pose.bill - sagittal;
  const nodScale = nod / nodSum;
  const lookScale = pose.look / nodSum;
  const twistScale = twistSum > 0 ? pose.turn / twistSum : 0;

  // The root: under the water at the front of the body, carried down and
  // forward with it when the swan bows and stretches.
  const rootU = NECK_ROOT[0];
  const px0 = 0;
  const py0 = (NECK_ROOT[1] - BOW_DROP * bowShape(rootU) * pose.bow) * L;
  const pz0 = birdZ(rootU) * (1 + BODY_STRETCH * pose.bodyStretch);
  out.root[0] = px0;
  out.root[1] = py0;
  out.root[2] = pz0;

  // The first ring looks straight up with its y axis toward the tail, then
  // leans: a quarter turn back about x, and the lean on top of it.
  const a0 = 0.5 * (-Math.PI / 2 + pose.lean);
  let qx = Math.sin(a0);
  let qy = 0;
  let qz = 0;
  let qw = Math.cos(a0);
  let px = px0;
  let py = py0;
  let pz = pz0;
  // A stretched neck thins where it is free; its base is part of the body and keeps its girth.
  const thin = 1 / stretch;

  for (let i = 0; i <= STEPS; i++) {
    const o = i * 4;
    frames[o] = qx;
    frames[o + 1] = qy;
    frames[o + 2] = qz;
    frames[o + 3] = qw;
    positions[o] = px;
    positions[o + 1] = py;
    positions[o + 2] = pz;
    positions[o + 3] = 1 + (thin - 1) * Math.min(1, Math.max(0, (ARC[i] - 0.12) / 0.3));
    if (i === STEPS) break;
    const ds = length * (ARC[i + 1] - ARC[i]);

    // this step's turn, as a small rotation in the ring's own axes
    const rx = _kappa[i] + _nod[i] * nodScale;
    const ry = pose.sway * (ARC[i + 1] - ARC[i]) + _nod[i] * lookScale;
    const rz = _twist[i] * twistScale;
    bends[o] = -ry / ds;
    bends[o + 1] = rx / ds;
    const angle = Math.hypot(rx, ry, rz);
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let dw = 1;
    if (angle > 1e-9) {
      const k = Math.sin(0.5 * angle) / angle;
      dx = rx * k;
      dy = ry * k;
      dz = rz * k;
      dw = Math.cos(0.5 * angle);
    }
    // half a step along the old direction, turn, half a step along the new one
    rotate(frames, o, 0, 0, 0.5 * ds, _v);
    const nx = qw * dx + qx * dw + qy * dz - qz * dy;
    const ny = qw * dy - qx * dz + qy * dw + qz * dx;
    const nz = qw * dz + qx * dy - qy * dx + qz * dw;
    const nw = qw * dw - qx * dx - qy * dy - qz * dz;
    const inv = 1 / Math.hypot(nx, ny, nz, nw);
    qx = nx * inv;
    qy = ny * inv;
    qz = nz * inv;
    qw = nw * inv;
    _q[0] = qx;
    _q[1] = qy;
    _q[2] = qz;
    _q[3] = qw;
    rotate(_q, 0, 0, 0, 0.5 * ds, _w);
    px += _v[0] + _w[0];
    py += _v[1] + _w[1];
    pz += _v[2] + _w[2];
  }
  const last = STEPS * 4;
  bends[last] = bends[last - 4];
  bends[last + 1] = bends[last - 3];

  rotate(frames, last, BILL_TIP[0] * L, BILL_TIP[1] * L, BILL_TIP[2] * L, _v);
  out.billTip[0] = px + _v[0];
  out.billTip[1] = py + _v[1];
  out.billTip[2] = pz + _v[2];
  rotate(frames, last, 0, 0.004 * L, HEAD_CENTRE * L, _v);
  out.head[0] = px + _v[0];
  out.head[1] = py + _v[1];
  out.head[2] = pz + _v[2];
  return out;
}

const _measure = createNeckSolution();

/**
 * Where a pose puts the bill and the head, without posing the swan: for an
 * animation that has to decide on a pose (how far to blend for the bill to
 * reach the water, say).
 * @param {SwanPose} pose
 * @returns {{ billTip: Float32Array, head: Float32Array, solution: NeckSolution }} bird space, metres.
 *   The same object every call: copy what you keep.
 */
export function measurePose(pose) {
  solveNeck(pose, _measure);
  return { billTip: _measure.billTip, head: _measure.head, solution: _measure };
}
