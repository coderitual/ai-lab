// The neck, the head and the bill as one skin, and the fringe of down that
// stands off it.
//
// Nothing here knows the pose. Every vertex says which ring of the neck it
// rides on (see poses.js: the solver leaves a position and an orientation per
// ring) and where it sits in that ring's own axes; the vertex shader puts it
// in place. So a new pose costs a few hundred numbers sent to the GPU and no
// work per vertex in JavaScript.
//
// A ring's axes: z along the neck toward the head, y toward the nape (and on
// the head toward the crown), x to the bird's left.

import * as THREE from 'three';
import { L, NECK_LENGTH, NECK_SUNK, HEAD_LENGTH, BILL_START, KNOB, neckRadius, headSection } from './anatomy.js';
import { NECK_RINGS, ringArc } from './poses.js';

const LAST = NECK_RINGS - 1;
/** Arc position (0 at the water, 1 at the back of the head) of a ring index. */
const ringS = (ring) => (ringArc(ring) * (NECK_LENGTH + NECK_SUNK) - NECK_SUNK) / NECK_LENGTH;

/** Stations along the head, from the back of the skull to the tip of the bill: closest where the shape turns. */
const HEAD_STATIONS = [0.012, 0.026, 0.042, 0.058, 0.074, 0.088, 0.1, 0.11, 0.118, 0.125, 0.133, 0.143, 0.156, 0.172, 0.19, 0.21, 0.23, 0.248, 0.262, 0.273, 0.281, 0.287, HEAD_LENGTH];

/** A point of the head's surface in the head's own axes, in L: `a` along the bill, `phi` round it (0 left, PI/2 crown). */
function headPoint(a, phi, out) {
  const s = headSection(a);
  // the bill is boxier than the skull: a squarer section from the base of the bill on
  const boxy = 2 + 0.9 * Math.min(1, Math.max(0, (a - BILL_START + 0.02) / 0.04));
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const cx = Math.sign(c) * Math.abs(c) ** (2 / boxy);
  const sy = Math.sign(sn) * Math.abs(sn) ** (2 / boxy);
  const half = 0.5 * (s.top + s.under);
  const x = s.side * cx;
  let y = 0.5 * (s.top - s.under) + half * sy;
  // the knob: a small bump on top of the base of the bill
  const ka = (a - KNOB.at) / KNOB.length;
  const kx = x / KNOB.width;
  if (sn > 0) y += KNOB.height * Math.exp(-ka * ka) * Math.exp(-kx * kx) * sn;
  out[0] = x;
  out[1] = y;
  out[2] = a;
  return out;
}

/**
 * The skin of neck, head and bill.
 * @param {object} options
 * @param {number} options.sides points round the neck
 * @param {number} options.perRing mesh rings per solver ring (1 or 2)
 * @returns {THREE.BufferGeometry} attributes: position (place in the ring's axes, metres), normal (in the
 *   ring's axes), aRing (which ring; fractions lie between two), aHead (place in the head's axes in L, w = 1
 *   on the head and 0 on the neck)
 */
export function buildNeck({ sides, perRing }) {
  const positions = [];
  const normals = [];
  const rings = [];
  const heads = [];
  let rows = 0;

  // the neck: circles whose radius follows the anatomy
  const neckRows = LAST * perRing + 1;
  for (let i = 0; i < neckRows; i++) {
    const ring = i / perRing;
    const s = ringS(ring);
    const r = neckRadius(s) * L;
    // how fast the radius changes along the neck tilts the surface
    const slope = (neckRadius(s + 0.01) - neckRadius(s - 0.01)) / (0.02 * NECK_LENGTH);
    for (let j = 0; j < sides; j++) {
      const phi = (j / sides) * Math.PI * 2;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const inv = 1 / Math.hypot(1, slope);
      positions.push(c * r, sn * r, 0);
      normals.push(c * inv, sn * inv, -slope * inv);
      rings.push(ring);
      heads.push(0, 0, 0, 0);
    }
    rows++;
  }

  // the head and the bill: all on the last ring, each with its own place along the bill's axis
  const p = [0, 0, 0];
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  const pc = [0, 0, 0];
  const pd = [0, 0, 0];
  for (const a of HEAD_STATIONS) {
    for (let j = 0; j < sides; j++) {
      const phi = (j / sides) * Math.PI * 2;
      headPoint(a, phi, p);
      // normal from the surface's own slopes round and along
      const da = 0.002;
      const dp = 0.02;
      headPoint(a, phi - dp, pa);
      headPoint(a, phi + dp, pb);
      headPoint(Math.max(0, a - da), phi, pc);
      headPoint(Math.min(HEAD_LENGTH - 1e-4, a + da), phi, pd);
      const rx = pb[0] - pa[0];
      const ry = pb[1] - pa[1];
      const rz = pb[2] - pa[2];
      const ax = pd[0] - pc[0];
      const ay = pd[1] - pc[1];
      const az = pd[2] - pc[2];
      let nx = ry * az - rz * ay;
      let ny = rz * ax - rx * az;
      let nz = rx * ay - ry * ax;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      positions.push(p[0] * L, p[1] * L, p[2] * L);
      normals.push(nx, ny, nz);
      rings.push(LAST);
      heads.push(p[0], p[1], p[2], 1);
    }
    rows++;
  }

  const indices = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(rings, 1));
  geometry.setAttribute('aHead', new THREE.Float32BufferAttribute(heads, 4));
  geometry.setIndex(indices);
  // the shader moves every vertex: the neck can be anywhere within its own length of the bow
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0.25), 1.0);
  return geometry;
}

/**
 * The fringe: thin strips standing on the neck and the head, edge-on to the
 * skin, running its whole length. Seen from the side a strip is the fuzzy
 * outline; the shader cuts it into beads and tufts and hides the strips that
 * face the eye.
 *
 * @param {object} options
 * @param {number} options.strips how many, evenly round the neck
 * @param {number} options.perRing samples per solver ring along each strip
 * @param {{ float: () => number }} options.rng
 * @returns {THREE.BufferGeometry} attributes: position (the strip's foot in the ring's axes, metres;
 *   z is used on the head only), aRing, aFin (x, y: the direction the strip stands in, in the ring's axes;
 *   z: 0 at the foot, 1 at the top; w: a random number per strip), aAlong (distance along the neck in L)
 */
export function buildFringe({ strips, perRing, rng }) {
  const positions = [];
  const rings = [];
  const fins = [];
  const alongs = [];
  const indices = [];
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  // the head carries fringe only where it is feathered
  const headStations = HEAD_STATIONS.filter((a) => a < BILL_START - 0.012);
  const rows = LAST * perRing + 1 + headStations.length;

  for (let k = 0; k < strips; k++) {
    const phi = ((k + 0.5) / strips) * Math.PI * 2;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const seed = rng.float();
    const first = positions.length / 3;
    for (let i = 0; i < rows; i++) {
      const onHead = i > LAST * perRing;
      let ring = LAST;
      let x;
      let y;
      let z = 0;
      let dx = c;
      let dy = sn;
      let along;
      let fade = 1;
      if (!onHead) {
        ring = i / perRing;
        const s = ringS(ring);
        const r = neckRadius(s) * L;
        x = c * r;
        y = sn * r;
        along = s * NECK_LENGTH;
      } else {
        const a = headStations[i - LAST * perRing - 1];
        headPoint(a, phi, p);
        headPoint(a, phi + 0.02, q);
        // stand square to the head's outline at this point
        const tx = q[0] - p[0];
        const ty = q[1] - p[1];
        const tl = Math.hypot(tx, ty) || 1;
        dx = ty / tl;
        dy = -tx / tl;
        x = p[0] * L;
        y = p[1] * L;
        z = p[2] * L;
        along = NECK_LENGTH + a;
        // the down shortens toward the face
        fade = 1 - Math.min(1, Math.max(0, (a - 0.04) / (BILL_START - 0.012 - 0.04)));
      }
      for (const top of [0, 1]) {
        positions.push(x, y, z);
        rings.push(ring);
        fins.push(dx, dy, top * fade, seed);
        alongs.push(along);
      }
      if (i < rows - 1) {
        const a = first + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(rings, 1));
  geometry.setAttribute('aFin', new THREE.Float32BufferAttribute(fins, 4));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(alongs, 1));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0.25), 1.0);
  return geometry;
}
