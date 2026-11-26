// Static geometry merged by material: `Parts` gathers boxes, polygons and
// strips, each in one colour (vertex colours), into one geometry; `place`
// gives points and matrices in the road's level frame at a distance along it.
// The tunnel (tunnel.js), its entrance (entrance.js) and the meadow's
// furniture (meadow.js) are built with them.

import * as THREE from 'three';
import { levelFrame } from './furniture.js';

/** What one material's parts add up to: positions, normals, vertex colours, appended piece by piece. */
export class Parts {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.index = [];
  }
  get empty() {
    return this.index.length === 0;
  }
  /** A geometry (indexed or not) placed by a matrix, in one colour. */
  add(geometry, matrix, color) {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (n) v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      else v.set(0, 1, 0);
      this.nor.push(v.x, v.y, v.z);
      this.col.push(color[0], color[1], color[2]);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) this.index.push(base + geometry.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.index.push(base + i);
  }
  /**
   * A flat convex polygon (corners in order), one colour, its normal from the corners; `toward`: a direction its
   * front must face (the corners are taken the other way round if it does not). A face whose normal points away
   * from what it shows shades itself in the sun's shadow map, whose bias is laid along the normal.
   */
  poly(points, color, toward = null) {
    if (points.length < 3) return;
    let a = points[0];
    let nrm = new THREE.Vector3().subVectors(points[1], a).cross(new THREE.Vector3().subVectors(points[2], a)).normalize();
    if (toward && nrm.dot(toward) < 0) {
      points = [...points].reverse();
      a = points[0];
      nrm.negate();
    }
    const base = this.pos.length / 3;
    for (const q of points) {
      this.pos.push(q.x, q.y, q.z);
      this.nor.push(nrm.x, nrm.y, nrm.z);
      this.col.push(color[0], color[1], color[2]);
    }
    for (let k = 1; k < points.length - 1; k++) this.index.push(base, base + k, base + k + 1);
  }
  /**
   * A strip of rows of points (each row the same count; a point doubled is a crease), normals from the winding;
   * `toward`: a direction its first face must look (the rows are taken in the other order if it does not).
   */
  strip(rows, color, toward = null) {
    const m = rows[0].length;
    const base = this.pos.length / 3;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    if (toward && rows.length > 1) {
      let k = 0;
      while (k < m - 2 && a.subVectors(rows[0][k + 1], rows[0][k]).lengthSq() < 1e-8) k++;
      a.subVectors(rows[0][k + 1], rows[0][k]);
      b.subVectors(rows[1][k], rows[0][k]);
      if (a.cross(b).dot(toward) < 0) rows = [...rows].reverse();
    }
    for (let r = 0; r < rows.length; r++) {
      const r0 = rows[Math.max(0, r - 1)];
      const r1 = rows[Math.min(rows.length - 1, r + 1)];
      const row = rows[r];
      for (let k = 0; k < m; k++) {
        if (k < m - 1) a.subVectors(row[k + 1], row[k]);
        if (k === m - 1 || a.lengthSq() < 1e-8) a.subVectors(row[k], row[Math.max(0, k - 1)]);
        b.subVectors(r1[k], r0[k]);
        const nrm = a.cross(b).normalize();
        this.pos.push(row[k].x, row[k].y, row[k].z);
        this.nor.push(nrm.x, nrm.y, nrm.z);
        this.col.push(color[0], color[1], color[2]);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      for (let k = 0; k < m - 1; k++) {
        const v = base + r * m + k;
        this.index.push(v, v + 1, v + m, v + 1, v + m + 1, v + m);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/**
 * The road's level frame at s, turned to face `out` (+1 along the road, -1 back along it): `P(lat, h, along)` a point
 * in it, `M(lat, h, along, size, tilt)` a matrix for a unit shape centred there (x across, y up, z along; `tilt`
 * [x, y, z] radians in that frame). Facing out of a portal, +lat is the right hand of whoever looks into the mouth.
 */
export function place(track, s, out = 1) {
  const f = levelFrame(track, s, {});
  const ahead = f.ahead.clone().multiplyScalar(out);
  const left = f.flat.clone().multiplyScalar(out);
  const yaw = Math.atan2(ahead.x, ahead.z);
  const P = (lat, h, along = 0) => new THREE.Vector3(f.pos.x + left.x * lat + ahead.x * along, f.pos.y + h, f.pos.z + left.z * lat + ahead.z * along);
  const M = (lat, h, along, size, tilt = null) => {
    _q.setFromEuler(_e.set(tilt?.[0] ?? 0, yaw + (tilt?.[1] ?? 0), tilt?.[2] ?? 0, 'YXZ'));
    return new THREE.Matrix4().compose(P(lat, h, along), _q, _s.set(size[0], size[1], size[2]));
  };
  return { f, P, M, yaw };
}

/** Colours (linear) of what is painted or bare. */
export const PAINT = {
  housing: [0.06, 0.065, 0.07],
  steel: [0.32, 0.33, 0.34],
  galvanised: [0.42, 0.43, 0.42],
  pipe: [0.28, 0.1, 0.06],
  fan: [0.5, 0.5, 0.48],
  fanInside: [0.03, 0.03, 0.035],
  door: [0.16, 0.17, 0.17],
  signal: [0.025, 0.025, 0.03],
  blue: [0.01, 0.07, 0.32],
  white: [0.8, 0.8, 0.78],
  black: [0.02, 0.02, 0.02],
  banner: [0.75, 0.2, 0.03],
  red: [0.5, 0.02, 0.015],
  post: [0.74, 0.74, 0.7],
  wood: [0.2, 0.13, 0.075],
  timber: [0.085, 0.05, 0.03],
  shingle: [0.3, 0.3, 0.29],
  stone: [0.4, 0.39, 0.36],
  wire: [0.3, 0.3, 0.29],
  shutter: [0.28, 0.3, 0.2],
};
/** Radiance (scene units, linear) of what glows. */
export const GLOW = {
  green: [0.06, 0.6, 0.18],
  guide: [0.15, 3.2, 0.6],
  red: [2.6, 0.1, 0.12],
  arrow: [0.3, 3.0, 0.9],
  signal: [0.3, 5.0, 1.3],
  warm: [3.2, 2.6, 1.8],
};

/** A part of a sign: a unit box `size` big at (x, y, z) in the sign's own frame (`base`: its middle, facing +z). */
export const sub = (base, x, y, z, size) => base.clone().multiply(new THREE.Matrix4().compose(_s.set(x, y, z), _q.identity(), new THREE.Vector3(...size)));

/** The tunnel's pictogram: a blue square with a white mouth drawn in bars, on a sign whose middle and facing are `base`. */
export function pictogram(paint, base) {
  paint.add(UNIT_BOX, sub(base, 0, 0, 0, [1.0, 1.0, 0.04]), PAINT.blue);
  paint.add(UNIT_BOX, sub(base, 0, 0.24, 0.03, [0.62, 0.06, 0.02]), PAINT.white);
  for (const e of [-0.28, 0.28]) paint.add(UNIT_BOX, sub(base, e, -0.01, 0.03, [0.06, 0.5, 0.02]), PAINT.white);
  paint.add(UNIT_BOX, sub(base, 0, -0.3, 0.03, [0.8, 0.04, 0.02]), PAINT.white);
}

/** A striped board on a portal's face (black and white unless `colors` says otherwise): its middle `l` across, foot `h0` up, `w` by `hgt`, stripes `band` wide. */
export function chevrons(paint, P, l, h0, w, hgt, band, along = 0.08, colors = [PAINT.white, PAINT.black]) {
  for (let k = -Math.ceil(w / band) - 1; k * band < hgt + w; k++) {
    const a = k * band;
    const b = a + band;
    // the stripe between h = a + x and h = b + x for x across the board, clipped to it
    const poly = clip(
      [
        [-w / 2, a - w / 2],
        [w / 2, a + w / 2],
        [w / 2, b + w / 2],
        [-w / 2, b - w / 2],
      ],
      0,
      hgt,
    );
    if (poly.length >= 3) paint.poly(poly.map(([x, y]) => P(l + x, h0 + y, along)), colors[k & 1]);
  }
}

/** A convex polygon [x, y][] clipped to lo <= y <= hi. */
export function clip(points, lo, hi) {
  let list = points;
  for (const [limit, keep] of [
    [lo, (y) => y >= lo],
    [hi, (y) => y <= hi],
  ]) {
    const next = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const q = list[(i + 1) % list.length];
      if (keep(p[1])) next.push(p);
      if (keep(p[1]) !== keep(q[1])) {
        const u = (limit - p[1]) / (q[1] - p[1]);
        next.push([p[0] + (q[0] - p[0]) * u, limit]);
      }
    }
    list = next;
  }
  return list;
}
