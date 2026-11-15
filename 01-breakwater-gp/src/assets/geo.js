// Geometry helpers for building models in code.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export const asColor = (c) => (c && c.isColor ? c : new THREE.Color(c));

/**
 * Prepare a geometry for merging: bake a transform, drop UVs, and paint every
 * vertex with one colour. Returns a non-indexed geometry with
 * position / normal / color attributes.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.ColorRepresentation} color
 * @param {{ pos?: number[], rot?: number[], scale?: number[] | number }} [xf]
 */
export function part(geometry, color, xf = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = xf;
  const sc = typeof scale === 'number' ? [scale, scale, scale] : scale;
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], xf.order || 'XYZ'));
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(sc[0], sc[1], sc[2]));
  g.applyMatrix4(_m);
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  if (color !== null && color !== undefined) paint(g, color);
  return g;
}

/** Give a geometry a uniform vertex colour. */
export function paint(geometry, color) {
  const c = asColor(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Merge parts made with part(). */
export function merge(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * Convert to flat-shaded "low poly": un-indexed triangles, each with a single
 * colour chosen by `colorAt(centroid, faceNormal)`.
 */
export function facet(geometry, colorAt) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    normal.copy(b).sub(a).cross(_d.copy(c).sub(a)).normalize();
    colorAt(centroid, normal, col);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = col.r;
      colors[(i + k) * 3 + 1] = col.g;
      colors[(i + k) * 3 + 2] = col.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals(); // un-indexed => face normals
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  return g;
}

/**
 * Smooth strip between rows of points ("lofting").
 * rows[i][j] is a THREE.Vector3; the surface runs through consecutive rows.
 * `colorAt(i, j)` returns a colour for each vertex. Front faces follow the
 * order (row i, col j) -> (row i, col j+1) -> (row i+1, col j).
 */
export function loft(rows, colorAt, { flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const positions = new Float32Array(nr * nc * 3);
  const colors = new Float32Array(nr * nc * 3);
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const k = (i * nc + j) * 3;
      const v = rows[i][j];
      positions[k] = v.x;
      positions[k + 1] = v.y;
      positions[k + 2] = v.z;
      const c = asColor(colorAt(i, j));
      colors[k] = c.r;
      colors[k + 1] = c.g;
      colors[k + 2] = c.b;
    }
  }
  const index = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      if (flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * A lofted surface that carries a picture: like loft(), plus texture
 * coordinates. `uvAt(point, i, j)` returns [u, v] for each vertex; `colorAt(i, j)`
 * tints it (white, i.e. no tint, by default).
 */
export function skin(rows, { uvAt, colorAt = null, flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const positions = new Float32Array(nr * nc * 3);
  const colors = new Float32Array(nr * nc * 3).fill(1);
  const uvs = new Float32Array(nr * nc * 2);
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const k = i * nc + j;
      const v = rows[i][j];
      positions[k * 3] = v.x;
      positions[k * 3 + 1] = v.y;
      positions[k * 3 + 2] = v.z;
      if (colorAt) {
        const c = asColor(colorAt(i, j));
        colors[k * 3] = c.r;
        colors[k * 3 + 1] = c.g;
        colors[k * 3 + 2] = c.b;
      }
      const uv = uvAt(v, i, j);
      uvs[k * 2] = uv[0];
      uvs[k * 2 + 1] = uv[1];
    }
  }
  const index = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      if (flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Give a geometry texture coordinates: one spot for all of it, or `uvAt(point)` per vertex. */
export function mapUv(geometry, uvAt) {
  const pos = geometry.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const uv = typeof uvAt === 'function' ? uvAt(p.fromBufferAttribute(pos, i)) : uvAt;
    uvs[i * 2] = uv[0];
    uvs[i * 2 + 1] = uv[1];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

/** Flat polygon fan (convex-ish outline), single colour. */
export function fan(points, color, { flip = false } = {}) {
  const centre = new THREE.Vector3();
  points.forEach((p) => centre.add(p));
  centre.multiplyScalar(1 / points.length);
  const pos = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (flip) pos.push(centre.x, centre.y, centre.z, b.x, b.y, b.z, a.x, a.y, a.z);
    else pos.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, color);
}
