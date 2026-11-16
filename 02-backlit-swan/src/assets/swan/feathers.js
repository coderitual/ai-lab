// Feathers that show as shapes of their own. The film shows them in exactly
// five places and nowhere else (docs/design.md), so that is where they are:
//
//   - three or four saw-tooth tips at the point of the tail
//   - two rounded lobes on the tail's rear edge
//   - the tips of the folded wing lying over the base of the tail, with the
//     two dark slits between them
//   - a few crossed tips on the crest of the back
//   - one upright tuft on the forward slope, on the bird's right side only
//
// They are small flat blades (and two small rounded lumps) added to the body
// mesh, so they follow the wings, the bow and the tail like the rest of it
// and cost no draw call. Each stands on a point of the body's skin that is
// looked up for both wing positions.

import { L, U_ORIGIN, sectionAt, TAIL_PIVOT } from './anatomy.js';

const DEG = Math.PI / 180;

/** Side-view coordinates (u back, v up, w across; in L) to bird space (metres). */
const toBird = (u, v, w) => [w * L, v * L, (U_ORIGIN - u) * L];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** A direction given in side-view terms (toward the stern, up, across) as a bird-space unit vector. */
const dir = (back, up, across) => norm([across, up, -back]);

// Outlines: half-width along the blade, as [distance along 0..1, fraction of the full half-width].
const LANCET = [[0, 0.3], [0.2, 0.8], [0.45, 1], [0.7, 0.85], [0.88, 0.5], [1, 0]];
const ROUND_TIP = [[0, 0.7], [0.3, 0.92], [0.6, 1], [0.84, 0.86], [0.95, 0.55], [1, 0]];
const BARB = [[0, 0.6], [0.3, 1], [0.6, 0.8], [0.85, 0.45], [1, 0]];

/**
 * @typedef {object} FeatherMesh
 * @property {number[]} positions arched
 * @property {number[]} relaxed
 * @property {number[]} normals the same for both wing positions
 * @property {number[]} rest
 * @property {number[]} tail
 * @property {number[]} indices relative to the first vertex of this set
 */

/**
 * @param {{ range: (lo: number, hi: number) => number }} rng
 * @param {number} detail 0, 1 or 2: fewer blades on the lowest tier
 * @returns {FeatherMesh}
 */
export function buildFeathers(rng, detail) {
  const out = { positions: [], relaxed: [], normals: [], rest: [], tail: [], indices: [] };

  /** Where a point of the skin is for both wing positions: station u, place round the section q, side +1 left / -1 right. */
  const anchor = (u, q, side) => {
    const a = sectionAt(u, 1, q);
    const r = sectionAt(u, 0, q);
    return { arched: toBird(u, a[1], side * a[0]), relaxed: toBird(u, r[1], side * r[0]), u };
  };

  const push = (p, shift, n, at, tailWeight) => {
    out.positions.push(p[0], p[1], p[2]);
    out.relaxed.push(p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]);
    out.normals.push(n[0], n[1], n[2]);
    out.rest.push(p[0] / L, p[1] / L, at.u);
    out.tail.push(tailWeight);
  };

  /**
   * A flat blade, drawn from both sides.
   * @param {object} at anchor
   * @param {number[]} offset from the anchor to the blade's foot, bird space, metres
   * @param {number[]} along unit vector, foot to tip
   * @param {number[]} across unit vector, the blade's width
   * @param {number} length metres
   * @param {number} halfWidth metres
   * @param {number[][]} outline
   * @param {number} curl how far the tip bends out of the blade's plane, as a fraction of the length
   * @param {number} tailWeight
   */
  const blade = (at, offset, along, across, length, halfWidth, outline, curl = 0, tailWeight = 0) => {
    const n = norm(cross(across, along));
    const shift = sub(at.relaxed, at.arched);
    const foot = add(at.arched, offset);
    for (const face of [1, -1]) {
      const first = out.positions.length / 3;
      const fn = [n[0] * face, n[1] * face, n[2] * face];
      for (const [t, w] of outline) {
        const centre = add(add(foot, along, t * length), n, curl * length * t * t);
        push(add(centre, across, -w * halfWidth), shift, fn, at, tailWeight);
        push(add(centre, across, w * halfWidth), shift, fn, at, tailWeight);
      }
      for (let i = 0; i < outline.length - 1; i++) {
        const a = first + i * 2;
        if (face > 0) out.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else out.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  };

  /** A small rounded lump, half sunk into the skin. The three axes must be right-handed (A x B = C). */
  const lump = (at, offset, axisA, axisB, axisC, radii, tailWeight) => {
    const shift = sub(at.relaxed, at.arched);
    const centre = add(at.arched, offset);
    const first = out.positions.length / 3;
    const lat = 5;
    const lon = 8;
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      for (let j = 0; j < lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        let p = centre;
        let nn = [0, 0, 0];
        [axisA, axisB, axisC].forEach((axis, k) => {
          p = add(p, axis, d[k] * radii[k]);
          nn = add(nn, axis, d[k] / radii[k]);
        });
        push(p, shift, norm(nn), at, tailWeight);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = first + i * lon + j;
        const b = first + i * lon + ((j + 1) % lon);
        out.indices.push(a, b, a + lon, b, b + lon, a + lon);
      }
    }
  };

  // --- the point of the tail: saw-tooth tips fanned in the upright plane,
  // each 0.015 to 0.024 L long (the film shows three or four)
  {
    const tip = anchor(1.119, 0, 1);
    const fans = detail === 0 ? [-10, 8] : [-16, -5, 6, 19];
    fans.forEach((fan, i) => {
      const a = (33 + fan) * DEG;
      const along = dir(Math.cos(a), Math.sin(a), 0);
      const across = dir(-Math.sin(a), Math.cos(a), 0);
      const length = (0.017 + 0.007 * ((i * 7) % 3) * 0.5) * L;
      const side = (i - 1.5) * 0.004 * L;
      blade(tip, [side, -0.004 * L, 0.004 * L], along, across, length, 0.0042 * L, LANCET, 0, 1);
      // and the same blade lying flat, so that it does not vanish seen from behind
      blade(tip, [side, -0.004 * L, 0.004 * L], along, [1, 0, 0], length, 0.0042 * L, LANCET, 0, 1);
    });
  }

  // --- the two rounded lobes on the tail's rear edge, at about 0.3 and 0.6 of its height
  {
    // the rear edge runs up and back at about 63 degrees
    const edge = dir(Math.cos(63 * DEG), Math.sin(63 * DEG), 0);
    const outward = dir(Math.sin(63 * DEG), -Math.cos(63 * DEG), 0);
    for (const [u, sink] of [[1.047, 0.006], [1.09, 0.004]]) {
      const at = anchor(u, 1, 1);
      lump(at, add([0, 0, 0], outward, -sink * L), edge, outward, [-1, 0, 0], [0.02 * L, 0.012 * L, 0.02 * L], 1);
    }
  }

  // --- the tips of the folded wings over the base of the tail: three blades
  // a side, fanned so that two slits open between their ends
  for (const side of [1, -1]) {
    const root = anchor(0.875, 0.2, side);
    const blades = detail === 0 ? [0] : [-1, 0, 1];
    for (const k of blades) {
      // each blade ends a little further round the tail base than the last
      const target = toBird(1.005 + 0.012 * k, 0.325 - 0.03 * k, side * (0.05 + 0.018 * k));
      const reach = sub(target, root.arched);
      const length = Math.hypot(reach[0], reach[1], reach[2]);
      const along = norm(reach);
      // the blade lies on the wing: its width runs round the body
      const outwardHere = norm([side * 0.55, 0.83, 0]);
      const across = norm(cross(along, outwardHere));
      blade(root, [outwardHere[0] * 0.004 * L, outwardHere[1] * 0.004 * L, 0], along, across, length, 0.021 * L, ROUND_TIP, 0, 0);
    }
  }

  // --- crossed tips on the crest of the back
  {
    const list = [
      // [u, side, yaw to the side (deg), pitch above the back (deg), length]
      [0.61, -1, 28, 24, 0.032],
      [0.635, -1, -30, 14, 0.03],
      [0.655, -1, 8, 30, 0.026],
      [0.6, 1, -22, 20, 0.03],
      [0.64, 1, 26, 16, 0.027],
    ];
    list.slice(0, detail === 0 ? 2 : list.length).forEach(([u, side, yaw, pitch, length]) => {
      const at = anchor(u, 0.17, side);
      const y = yaw * DEG;
      const pch = pitch * DEG;
      const along = dir(Math.cos(pch) * Math.cos(y), Math.sin(pch), Math.cos(pch) * Math.sin(y));
      const across = norm(cross(along, [0, 1, 0]));
      blade(at, [0, -0.002 * L, 0], along, across, length * L, 0.0048 * L, LANCET, 0.12, 0);
      blade(at, [0, -0.002 * L, 0], along, norm(cross(across, along)), length * L, 0.0048 * L, LANCET, 0, 0);
    });
  }

  // --- the tuft: four or five barbs standing 0.04 L off the forward slope, right side only
  {
    const at = anchor(0.352, 0.2, -1);
    const barbs = detail === 0 ? [-8, 14] : [-24, -11, 2, 15, 29];
    barbs.forEach((lean, i) => {
      // upright, fanned fore and aft, tipped a little back as the slope is
      const a = (78 + lean) * DEG;
      const along = dir(Math.cos(a), Math.sin(a), -0.08);
      const across = dir(-Math.sin(a), Math.cos(a), 0);
      const length = (0.04 - 0.004 * Math.abs(i - 2) + rng.range(-0.003, 0.003)) * L;
      blade(at, [0, -0.004 * L, 0], along, across, length, 0.0045 * L, BARB, 0.1, 0);
      blade(at, [0, -0.004 * L, 0], along, [1, 0, 0], length, 0.003 * L, BARB, 0, 0);
    });
  }

  return out;
}

/** The tail's hinge in bird space: [y, z], metres. */
export const TAIL_HINGE = [TAIL_PIVOT[1] * L, (U_ORIGIN - TAIL_PIVOT[0]) * L];
