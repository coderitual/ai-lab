// The tools the car's small solid parts are built with (details.js, lampUnits.js): finding the
// skin under a ray, and a growing list of triangles that ends up as one geometry per material.
//
// Parts are built once for the car's left side and mirrored (`addMirrored`), or placed by a
// matrix; lamp-like parts carry a per-vertex function number (`lampFn`) that the lamp-part
// material turns into colour and light (materials.js, LAMP_FN).

import * as THREE from 'three';

/**
 * Where a ray meets the sampled skin: the vertices within `radius` of the ray, nearest along it, give a plane
 * (their mean point and normal) which the ray then cuts. Good to a millimetre or two on the smooth panels.
 * @returns {{ point: THREE.Vector3, normal: THREE.Vector3 }}
 */
export function surfaceHit(samples, origin, dir, radius = 0.05) {
  const P = samples.position;
  const N = samples.normal;
  const count = P.length / 3;
  const d = dir.clone().normalize();
  let best = Infinity;
  const near = [];
  for (let j = 0; j < count; j++) {
    const x = P[j * 3] - origin.x;
    const y = P[j * 3 + 1] - origin.y;
    const z = P[j * 3 + 2] - origin.z;
    const t = x * d.x + y * d.y + z * d.z;
    if (t <= 0) continue;
    const ox = x - d.x * t;
    const oy = y - d.y * t;
    const oz = z - d.z * t;
    const off = ox * ox + oy * oy + oz * oz;
    // only skin that faces the ray
    if (off > radius * radius || N[j * 3] * d.x + N[j * 3 + 1] * d.y + N[j * 3 + 2] * d.z > -0.1) continue;
    near.push([t, j, off]);
    best = Math.min(best, t);
  }
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let weight = 0;
  for (const [t, j, off] of near) {
    if (t > best + radius) continue; // the first surface only, not the far side of the car
    const w = 1 / (off + 1e-5);
    point.x += P[j * 3] * w;
    point.y += P[j * 3 + 1] * w;
    point.z += P[j * 3 + 2] * w;
    normal.x += N[j * 3] * w;
    normal.y += N[j * 3 + 1] * w;
    normal.z += N[j * 3 + 2] * w;
    weight += w;
  }
  if (!weight) return { point: origin.clone(), normal: d.clone().negate() };
  point.multiplyScalar(1 / weight);
  normal.normalize();
  const t = point.clone().sub(origin).dot(normal) / d.dot(normal);
  return { point: origin.clone().addScaledVector(d, t), normal };
}

/** A growing list of triangles with flat or given normals and an optional per-vertex number. */
export class Tris {
  constructor() {
    this.p = [];
    this.n = [];
    this.f = [];
    this.uv = [];
  }
  /** One flat triangle; turned to face `out` if given. */
  tri(a, b, c, out = null, fn = 0) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (out && n.dot(out) < 0) {
      [b, c] = [c, b];
      n.negate();
    }
    for (const v of [a, b, c]) {
      this.p.push(v.x, v.y, v.z);
      this.n.push(n.x, n.y, n.z);
      this.f.push(fn);
      this.uv.push(0, 0);
    }
  }
  quad(a, b, c, d, out = null, fn = 0) {
    this.tri(a, b, c, out, fn);
    this.tri(a, c, d, out, fn);
  }
  /** A three.js geometry, transformed by `matrix`, its triangles added (normals smooth as it has them). */
  add(geometry, matrix, fn = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const P = g.attributes.position.array;
    const N = g.attributes.normal.array;
    const U = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < P.length / 3; i++) {
      this.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      this.n.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      this.f.push(fn);
      this.uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0);
    }
    geometry.dispose();
    if (g !== geometry) g.dispose();
  }
  /** One triangle with its own normals and texture coordinates. */
  smooth(pts, normals, fn = 0, uvs = null) {
    for (let k = 0; k < 3; k++) {
      this.p.push(pts[k].x, pts[k].y, pts[k].z);
      this.n.push(normals[k].x, normals[k].y, normals[k].z);
      this.f.push(fn);
      this.uv.push(uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0);
    }
  }
  /** Everything in `other`, and its mirror image across x = 0 (the triangles turned the right way round again). */
  addMirrored(other) {
    const count = other.p.length / 3;
    for (let i = 0; i < count; i++) {
      this.p.push(other.p[i * 3], other.p[i * 3 + 1], other.p[i * 3 + 2]);
      this.n.push(other.n[i * 3], other.n[i * 3 + 1], other.n[i * 3 + 2]);
      this.f.push(other.f[i]);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
    }
    for (let t = 0; t < count; t += 3) {
      for (const i of [t, t + 2, t + 1]) {
        this.p.push(-other.p[i * 3], other.p[i * 3 + 1], other.p[i * 3 + 2]);
        this.n.push(-other.n[i * 3], other.n[i * 3 + 1], other.n[i * 3 + 2]);
        this.f.push(other.f[i]);
        this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('lampFn', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  get count() {
    return this.p.length / 9;
  }
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A frame on the surface: z along `normal`, y as near `up` as it can be. */
export function frame(origin, normal, up = V(0, 1, 0)) {
  const z = normal.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

/** Left and right: the matrix that mirrors car space across x = 0. */
export const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);


/**
 * A part of the sampled skin as its own small set of points, for many rays at one place (a lamp, the grille):
 * surfaceHit() looks at every vertex it is given.
 * @param {(x: number, y: number, z: number) => boolean} keep
 */
export function skinRegion(samples, keep) {
  const position = [];
  const normal = [];
  const P = samples.position;
  const N = samples.normal;
  for (let j = 0; j < P.length; j += 3) {
    if (!keep(P[j], P[j + 1], P[j + 2])) continue;
    position.push(P[j], P[j + 1], P[j + 2]);
    normal.push(N[j], N[j + 1], N[j + 2]);
  }
  return { position: Float32Array.from(position), normal: Float32Array.from(normal) };
}

/** A rounded rectangle's outline (half sizes hx, hy, corner r), `n` points anticlockwise. */
export function roundRect(hx, hy, r, n, slant = 0) {
  const shape = new THREE.Shape();
  // slant: the lower right corner moved this far right (the trims' outer end leans)
  const c = [V(-hx, -hy, 0), V(hx + slant, -hy, 0), V(hx, hy, 0), V(-hx, hy, 0)];
  const corner = (i) => {
    const p = c[i];
    const a = c[(i + 3) % 4];
    const b = c[(i + 1) % 4];
    const pa = a.clone().sub(p).normalize().multiplyScalar(r).add(p);
    const pb = b.clone().sub(p).normalize().multiplyScalar(r).add(p);
    return [pa, p, pb];
  };
  const k0 = corner(0);
  shape.moveTo(k0[2].x, k0[2].y);
  for (let i = 1; i <= 4; i++) {
    const [pa, p, pb] = corner(i % 4);
    shape.lineTo(pa.x, pa.y);
    shape.quadraticCurveTo(p.x, p.y, pb.x, pb.y);
  }
  return shape.getSpacedPoints(n).slice(0, n);
}

/**
 * A frame standing on a plane (z = 0 at its face, in `matrix`'s frame): the face between an outer and an inner
 * outline, the inner wall running back to -depth and the outer wall to -outerDepth.
 */
export function ring(t, matrix, outer, inner, depth, outerDepth, fn = 0) {
  const n = outer.length;
  const m = (p, z) => V(p.x, p.y, z).applyMatrix4(matrix);
  const face = V(0, 0, 1).transformDirection(matrix);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t.quad(m(outer[i], 0), m(outer[j], 0), m(inner[j], 0), m(inner[i], 0), face, fn);
    const ro = V(outer[i].x + outer[j].x, outer[i].y + outer[j].y, 0).normalize().transformDirection(matrix);
    t.quad(m(inner[i], 0), m(inner[j], 0), m(inner[j], -depth), m(inner[i], -depth), ro.clone().negate(), fn);
    if (outerDepth > 0) t.quad(m(outer[i], 0), m(outer[j], 0), m(outer[j], -outerDepth), m(outer[i], -outerDepth), ro, fn);
  }
}

/**
 * Exact rays at the skin itself, for one part of the car's left half: the nearest sampled vertex to the ray gives
 * a first guess of (u, v), Newton's method on the surface does the rest. Unlike surfaceHit() the answer does not
 * depend on how fine the tier's mesh is, so a part placed with it sits the same on every tier.
 * @param {import('./skin.js').Skin} skin
 * @param {{ u: { params: number[] }, v: { params: number[] } }} lay the layout the samples were taken with
 * @param {{ position: Float32Array, normal: Float32Array, columns: number, rows: number }} samples
 * @param {(x: number, y: number, z: number) => boolean} keep which vertices of the left half belong to the region
 * @returns {(origin: THREE.Vector3, dir: THREE.Vector3) => { point: THREE.Vector3, normal: THREE.Vector3 }}
 */
export function createSkinCaster(skin, lay, samples, keep) {
  const { columns, rows } = samples;
  const P = samples.position;
  const N = samples.normal;
  const list = [];
  for (let j = 0; j < columns * rows; j++) if (keep(P[j * 3], P[j * 3 + 1], P[j * 3 + 2])) list.push(j);
  const a = new Float64Array(6);
  const b = new Float64Array(3);
  const c = new Float64Array(3);
  const E = 1e-4;
  return (origin, dir) => {
    const d = dir.clone().normalize();
    let best = -1;
    let bestOff = Infinity;
    for (const j of list) {
      const x = P[j * 3] - origin.x;
      const y = P[j * 3 + 1] - origin.y;
      const z = P[j * 3 + 2] - origin.z;
      const t = x * d.x + y * d.y + z * d.z;
      if (t <= 0 || N[j * 3] * d.x + N[j * 3 + 1] * d.y + N[j * 3 + 2] * d.z > -0.1) continue;
      const off = (x - d.x * t) ** 2 + (y - d.y * t) ** 2 + (z - d.z * t) ** 2;
      if (off < bestOff) {
        bestOff = off;
        best = j;
      }
    }
    if (best < 0) return { point: origin.clone(), normal: d.clone().negate() };
    let u = lay.u.params[Math.floor(best / rows)];
    let v = lay.v.params[best % rows];
    // across the ray: the part of a vector square to d
    const across = (p, o) => {
      const x = p[0] - o[0];
      const y = p[1] - o[1];
      const z = p[2] - o[2];
      const t = x * d.x + y * d.y + z * d.z;
      return [x - d.x * t, y - d.y * t, z - d.z * t];
    };
    const o = [origin.x, origin.y, origin.z];
    for (let step = 0; step < 6; step++) {
      skin.point(u, v, a);
      skin.point(Math.min(1, u + E), v, b);
      skin.point(u, Math.min(1, v + E), c);
      const r = across(a, o);
      const su = across(b, a).map((x) => x / E);
      const sv = across(c, a).map((x) => x / E);
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const [uu, uv, vv] = [dot(su, su), dot(su, sv), dot(sv, sv)];
      const det = uu * vv - uv * uv;
      if (Math.abs(det) < 1e-14) break;
      const [ru, rv] = [dot(su, r), dot(sv, r)];
      u = Math.min(1, Math.max(0, u - (ru * vv - rv * uv) / det));
      v = Math.min(1, Math.max(0, v - (rv * uu - ru * uv) / det));
    }
    skin.frame(u, v, a);
    return { point: V(a[0], a[1], a[2]), normal: V(a[3], a[4], a[5]) };
  };
}

/**
 * A flat bar along a polyline, lying in the plane square to `axis`: its face (towards `axis`), and with `deep` its
 * two long sides. `half`: half its height, a number or one per point.
 */
export function bar(t, pts, axis, half, deep, fn) {
  const corners = pts.map((p, i) => {
    const tangent = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const side = new THREE.Vector3().crossVectors(axis, tangent).normalize();
    const h = Array.isArray(half) ? half[i] : half;
    return { up: p.clone().addScaledVector(side, h), down: p.clone().addScaledVector(side, -h), side };
  });
  const back = (p) => p.clone().addScaledVector(axis, -deep);
  for (let i = 0; i < corners.length - 1; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    t.quad(a.down, b.down, b.up, a.up, axis, fn);
    if (deep > 0) {
      t.quad(a.up, b.up, back(b.up), back(a.up), a.side, fn);
      t.quad(a.down, b.down, back(b.down), back(a.down), a.side.clone().negate(), fn);
    }
  }
}
