// The body: a skin stretched over cross-sections taken from anatomy.js, built
// twice (wings arched, wings relaxed) so that the vertex shader can slide
// between the two.
//
// The soft billows of the folded wings are part of the mesh: the skin is
// pushed in and out by a few millimetres of smooth noise, and its normals are
// taken from a version pushed three and a half times as far, so that the sky's light picks the
// upper edge of each billow out without the outline going lumpy.

import * as THREE from 'three';
import { L, U_BOW, U_TAIL_TIP, SECTION_POINTS, sectionPoints, birdZ, TAIL_PIVOT } from './anatomy.js';
import { buildFeathers } from './feathers.js';

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Smooth noise in three dimensions, -1..1, the same for a given seed on every
 * machine (integer hashing, as in the shaders).
 */
function makeNoise(seed) {
  const hash = (x, y, z) => {
    let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ seed) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return (h >>> 8) / 8388608 - 1;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const lerp = (a, b, t) => a + (b - a) * t;
    const x00 = lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx);
    const x10 = lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx);
    const x01 = lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx);
    const x11 = lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
  };
}

/** Stations along the body: closer together at the bow and over the tail, where the outline turns fastest. */
function stationList(count) {
  const us = [];
  // shares of the stations given to the bow, the long middle and the tail
  const spans = [
    [U_BOW, 0.2, 0.14],
    [0.2, 0.93, 0.56],
    [0.93, U_TAIL_TIP, 0.3],
  ];
  let used = 0;
  spans.forEach(([from, to, share], index) => {
    const n = index === spans.length - 1 ? count - 1 - used : Math.round(share * (count - 1));
    for (let i = 0; i < n; i++) us.push(from + ((to - from) * i) / n);
    used += n;
  });
  us.push(U_TAIL_TIP);
  return us;
}

/**
 * @param {object} options
 * @param {number} options.stations cross-sections along the body
 * @param {number} options.detail multiplies the number of points round each cross-section
 * @param {number} options.seed
 * @param {object} options.rng random numbers for the feather shapes
 * @param {number} options.featherDetail 0, 1 or 2
 * @returns {THREE.BufferGeometry} attributes: position / normal (wings arched), aRelaxed /
 *   aRelaxedNormal (wings relaxed), aRest (the arched position in L, for effects that must stick
 *   to the feathers), aTail (how much of the tail's swing a vertex follows)
 */
export function buildBody({ stations, detail, seed, rng, featherDetail }) {
  // pieces per span between control points: spine, crest, shoulder, flank (4 spans), turn of the bilge, under water (3)
  const base = [3, 3, 3, 3, 4, 4, 4, 3, 2, 2, 1];
  const steps = base.map((n, i) => Math.max(1, Math.round(n * (i < 9 ? detail : 1))));
  if (steps.length !== SECTION_POINTS - 1) throw new Error('body: section layout out of step with anatomy.js');
  const half = steps.reduce((a, b) => a + b, 0); // spans in half a ring
  const ring = half * 2;
  const us = stationList(stations);
  const nu = us.length;
  const count = nu * ring;
  const noise = makeNoise(seed);
  const section = new Float64Array(2 * (half + 1));

  /**
   * One shape: positions, and normals taken from the same shape with its
   * billows pushed further. `lookup` is where the noise is read (the arched
   * shape's smooth positions), so that both shapes carry the same billows.
   */
  const shape = (lift, lookup) => {
    const smoothP = new Float32Array(count * 3);
    const out = new Float32Array(count * 3);
    for (let i = 0; i < nu; i++) {
      sectionPoints(us[i], lift, steps, section);
      for (let k = 0; k < ring; k++) {
        const j = k <= half ? k : ring - k;
        const sign = k <= half ? 1 : -1;
        const o = (i * ring + k) * 3;
        smoothP[o] = sign * section[2 * j] * L;
        smoothP[o + 1] = section[2 * j + 1] * L;
        smoothP[o + 2] = birdZ(us[i]);
      }
    }
    const normals = gridNormals(smoothP, nu, ring);
    // Billows: two sizes of soft lump, strongest on the wings' faces, none on
    // the tail or the bow (which the film shows smooth).
    const bumped = new Float32Array(count * 3);
    for (let i = 0; i < nu; i++) {
      const u = us[i];
      const along = smooth(0.3, 0.5, u) * (1 - smooth(0.9, 1.0, u));
      for (let k = 0; k < ring; k++) {
        const o = (i * ring + k) * 3;
        const at = lookup || smoothP;
        const x = at[o] / L;
        const y = at[o + 1] / L;
        const z = us[i];
        const b = noise(x * 6.5 + 3.1, y * 8.0 + 1.7, z * 6.5) * 0.65 + noise(x * 13 + 9.2, y * 15, z * 13 + 4.4) * 0.35;
        const amount = along * smooth(0.02, 0.12, y) * 0.0065 * L;
        for (let c = 0; c < 3; c++) {
          out[o + c] = smoothP[o + c] + normals[o + c] * b * amount;
          bumped[o + c] = smoothP[o + c] + normals[o + c] * b * amount * 3.6;
        }
      }
    }
    return { positions: out, normals: gridNormals(bumped, nu, ring), smooth: smoothP };
  };

  const arched = shape(1, null);
  const relaxed = shape(0, arched.smooth);

  const rest = new Float32Array(count * 3);
  const tail = new Float32Array(count);
  for (let i = 0; i < nu; i++) {
    for (let k = 0; k < ring; k++) {
      const v = i * ring + k;
      rest[v * 3] = arched.positions[v * 3] / L;
      rest[v * 3 + 1] = arched.positions[v * 3 + 1] / L;
      rest[v * 3 + 2] = us[i];
      tail[v] = smooth(TAIL_PIVOT[0] - 0.02, TAIL_PIVOT[0] + 0.08, us[i]);
    }
  }

  const indices = [];
  for (let i = 0; i < nu - 1; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k;
      const b = i * ring + ((k + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      // stations run from bow to stern, which is toward -Z: this winding faces outward
      indices.push(a, b, c, b, d, c);
    }
  }

  // the feathers that show as shapes ride on the same mesh
  const extra = buildFeathers(rng, featherDetail);
  const total = count + extra.positions.length / 3;
  const join = (a, b, size) => {
    const out = new Float32Array(total * size);
    out.set(a);
    out.set(b, count * size);
    return out;
  };
  for (const i of extra.indices) indices.push(count + i);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(join(arched.positions, extra.positions, 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(join(arched.normals, extra.normals, 3), 3));
  geometry.setAttribute('aRelaxed', new THREE.BufferAttribute(join(relaxed.positions, extra.relaxed, 3), 3));
  geometry.setAttribute('aRelaxedNormal', new THREE.BufferAttribute(join(relaxed.normals, extra.normals, 3), 3));
  geometry.setAttribute('aRest', new THREE.BufferAttribute(join(rest, extra.rest, 3), 3));
  geometry.setAttribute('aTail', new THREE.BufferAttribute(join(tail, extra.tail, 1), 1));
  geometry.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  // the shader moves vertices (wing lift, bow, stretch): a generous fixed bound, never recomputed
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.15, 0), 0.9);
  return geometry;
}

/**
 * Normals of a closed tube of rings from its grid of points: across each
 * vertex, the direction round the ring crossed with the direction along the
 * body. Where a ring has shrunk to a point (bow, tail tip) the neighbouring
 * ring's normal is used.
 */
function gridNormals(p, nu, ring) {
  const n = new Float32Array(p.length);
  for (let i = 0; i < nu; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(nu - 1, i + 1);
    for (let k = 0; k < ring; k++) {
      const o = (i * ring + k) * 3;
      const a = (i * ring + ((k + ring - 1) % ring)) * 3;
      const b = (i * ring + ((k + 1) % ring)) * 3;
      const c = (i0 * ring + k) * 3;
      const d = (i1 * ring + k) * 3;
      const rx = p[b] - p[a];
      const ry = p[b + 1] - p[a + 1];
      const rz = p[b + 2] - p[a + 2];
      const ax = p[d] - p[c];
      const ay = p[d + 1] - p[c + 1];
      const az = p[d + 2] - p[c + 2];
      // ring direction (spine, left flank, keel, right flank) x direction toward the stern
      let nx = ry * az - rz * ay;
      let ny = rz * ax - rx * az;
      let nz = rx * ay - ry * ax;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = 0;
        ny = 0;
        nz = 0;
      }
      n[o] = nx;
      n[o + 1] = ny;
      n[o + 2] = nz;
    }
  }
  // degenerate rings borrow from the ring next to them
  for (const [i, from] of [[0, 1], [nu - 1, nu - 2]]) {
    for (let k = 0; k < ring; k++) {
      const o = (i * ring + k) * 3;
      if (n[o] === 0 && n[o + 1] === 0 && n[o + 2] === 0) {
        const s = (from * ring + k) * 3;
        n[o] = n[s];
        n[o + 1] = n[s + 1];
        n[o + 2] = n[s + 2];
      }
    }
  }
  return n;
}
