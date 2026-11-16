// What every structure along the road is placed with: one routine that walks
// a stretch of road at a spacing, the road's frame at a point made level (for
// things that stand upright whatever the banking), strips swept along the
// road from a cross-section, and instanced rows.
//
// Two rules keep the rows honest:
//  - Spacing is fitted to the stretch (n = round(length / nominal)), so a row
//    meets itself at the lap's seam and leaves no odd half gap at its end.
//  - Nothing here draws random numbers: every tier and every load sets the
//    same posts in the same places, and a lower tier drops some by index.

import * as THREE from 'three';

/** The Track's EDGE values (the world never imports from game/). */
export const EDGE = { RAIL: 0, ROCK: 1, WALL: 2, PARAPET: 3, TREES: 4 };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The road's frame at s, with `flat` (the left direction made level) and `out(side)` added: everything that stands
 * upright beside the road is placed in it.
 * @param {object} track @param {number} s @param {object} [out]
 */
export function levelFrame(track, s, out = {}) {
  track.frameAt(s, out);
  out.flat = (out.flat ?? new THREE.Vector3()).set(out.left.x, 0, out.left.z).normalize();
  out.ahead = (out.ahead ?? new THREE.Vector3()).set(out.tan.x, 0, out.tan.z).normalize();
  out.yaw = Math.atan2(out.ahead.x, out.ahead.z);
  return out;
}

/**
 * Visits s0..s1 (s1 may be past the lap's end: s is wrapped for the visitor) at a spacing fitted to the stretch.
 * `spacingAt(s)` may change along it (closer in bends): the walk then advances by the local spacing.
 * @param {object} track @param {number} s0 @param {number} s1
 * @param {number | ((s: number) => number)} spacing
 * @param {(s: number, k: number) => void} visit
 * @param {{ ends?: boolean }} [options] ends: visit s0 and s1 themselves (rail posts); otherwise the middles
 */
export function along(track, s0, s1, spacing, visit, { ends = false } = {}) {
  const length = s1 - s0;
  if (length <= 0) return;
  if (typeof spacing === 'number') {
    const n = Math.max(1, Math.round(length / spacing));
    const from = ends ? 0 : 0.5;
    const to = ends ? n : n - 0.5;
    for (let k = 0, f = from; f <= to + 1e-6; k++, f++) visit(track.wrap(s0 + (f * length) / n), k);
    return;
  }
  // a varying spacing: walk it, then stretch the walk so its last step lands on s1
  const marks = [];
  for (let s = 0; s < length; ) {
    marks.push(s);
    s += Math.max(0.5, spacing(track.wrap(s0 + s)));
  }
  const stretch = marks.length > 1 ? length / (marks[marks.length - 1] + spacing(track.wrap(s1))) : 1;
  marks.forEach((m, k) => visit(track.wrap(s0 + m * stretch + (ends ? 0 : 0.5 * spacing(track.wrap(s0 + m)) * stretch)), k));
}

/**
 * Runs of samples where `test(i)` holds, as [s0, s1] in metres; a run through the seam has s1 > track.length.
 * @param {object} track @param {(i: number) => boolean} test
 * @returns {Array<{ s0: number, s1: number, i0: number, i1: number }>}
 */
export function runsOf(track, test) {
  const n = track.count;
  const runs = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (test(i) && start < 0) start = i;
    if (!test(i) && start >= 0) {
      runs.push({ i0: start, i1: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) {
    if (runs.length && runs[0].i0 === 0) runs[0] = { i0: start, i1: runs[0].i1 + n };
    else runs.push({ i0: start, i1: n - 1 });
  }
  if (runs.length === 0 && test(0)) runs.push({ i0: 0, i1: n });
  return runs.map((r) => ({ ...r, s0: r.i0 * track.ds, s1: r.i1 * track.ds }));
}

/**
 * A strip of quads from rows of points (each row the same number of [x, y, z, u, v]). Rows run along the road,
 * points across it.
 * @param {Array<Array<number[]>>} rows
 * @param {{ attributes?: Record<string, { size: number, rows: Array<Array<number[]>> }> }} [extra]
 */
export function stripGeometry(rows, extra = {}) {
  const m = rows[0].length;
  const pos = new Float32Array(rows.length * m * 3);
  const uv = new Float32Array(rows.length * m * 2);
  rows.forEach((row, r) =>
    row.forEach((p, k) => {
      const v = r * m + k;
      pos.set([p[0], p[1], p[2]], v * 3);
      uv.set([p[3] ?? 0, p[4] ?? 0], v * 2);
    }),
  );
  const index = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < m - 1; k++) {
      const a = r * m + k;
      const b = a + m;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const [name, { size, rows: values }] of Object.entries(extra.attributes ?? {})) {
    const data = new Float32Array(rows.length * m * size);
    values.forEach((row, r) => row.forEach((value, k) => data.set(value, (r * m + k) * size)));
    geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * An instanced row: one geometry, one material, a matrix per member.
 * @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {THREE.Matrix4[]} matrices
 * @param {{ shadow?: boolean, name?: string }} [options]
 */
export function row(geometry, material, matrices, { shadow = true, name = '' } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

const Q = new THREE.Quaternion();
const S = new THREE.Vector3();

/**
 * A matrix that stands a thing upright at `point`, turned so its +Z faces `yaw` (a heading on the map).
 * @param {THREE.Vector3} point @param {number} yaw @param {number} [sx] @param {number} [sy] @param {number} [sz]
 */
export function upright(point, yaw, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(point, Q.setFromAxisAngle(UP, yaw), S.set(sx, sy, sz));
}

/** A box standing on its base (y from 0 to 1), unit size: scaled by the matrix. */
export function footBox() {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

/** Disposes every geometry and material (and their maps) under a group. */
export function disposeGroup(group) {
  const seen = new Set();
  group.traverse((object) => {
    if (object.geometry && !seen.has(object.geometry)) {
      seen.add(object.geometry);
      object.geometry.dispose();
    }
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) material[key]?.dispose();
      material.dispose();
    }
  });
}
