// (forest lane) A bend-warning sign of our own drawing: a yellow diamond with a
// black rim and a black arrow bent the way the road goes, on a grey post. One
// stands `sign` metres before each run of pieces whose scheme names one
// (trackLayout.js SCHEMES), on the outside of the bend, beyond the corridor's
// solid edge, facing the oncoming cars. Geometry only, coloured per vertex
// (the plants' material: aTint carries the paint), one small mesh per sign.

import * as THREE from 'three';
import { schemeTable } from './schemes.js';

/** Sizes (m): the diamond's half diagonal, the post's height to the diamond's middle and its half width, how far beyond the edge it stands. */
const SIGN = { half: 0.62, height: 2.1, post: 0.04, beyond: 1.2 };
/** Paint (linear): the yellow, the black, the post's galvanised grey, the plate's back. */
const PAINT = { yellow: [0.78, 0.5, 0.02], black: [0.012, 0.012, 0.012], post: [0.3, 0.3, 0.29], back: [0.22, 0.22, 0.21] };

/**
 * @param {object} o
 * @param {object} o.track
 * @param {object} o.terrain heightOnTrack, bakeAt
 * @param {THREE.Material} o.material a flat, two-sided plants' material (treeMaterial.js plantMaterial with no map)
 */
export function createBendSigns({ track, terrain, material }) {
  const group = new THREE.Group();
  group.name = 'bend-signs';
  const st = schemeTable(track);
  const pt = new THREE.Vector3();
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const bake = [0, 0, 0];
  let count = 0;
  for (const run of st.runs) {
    const ahead = run.def.sign ?? 0;
    if (!ahead) continue;
    // which way the bend goes: the mean curvature over its first half
    let k = 0;
    for (let d = 0; d < track.wrap(run.s1 - run.s0) * 0.5; d += 5) k += track.curvature[Math.round(track.wrap(run.s0 + d) / track.ds) % track.count];
    const turn = k < 0 ? -1 : 1; // -1: a right bend
    const s = track.wrap(run.s0 - ahead);
    const side = -turn; // the outside
    const lat = side * (track.edgeAt(s, side) + SIGN.beyond);
    track.frameAt(s, frame);
    track.pointAt(s, lat, pt);
    const y = terrain.heightOnTrack(s, lat) - 0.2;
    terrain.bakeAt(pt.x, pt.z, bake, 0);
    // the sign's own frame: x across (to the driver's right as it faces the cars), y up, z towards the cars
    const z = frame.tan.clone().negate().setY(0).normalize();
    const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
    const pos = [];
    const tint = [];
    const index = [];
    const put = (u, v, w, col) => {
      pos.push(pt.x + x.x * u + z.x * w, y + v, pt.z + x.z * u + z.z * w);
      tint.push(...col, 1);
      return pos.length / 3 - 1;
    };
    const quad = (a, b, c, d, col, w) => {
      const i = [put(...a, w, col), put(...b, w, col), put(...c, w, col), put(...d, w, col)];
      index.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    };
    const poly = (points, col, w) => {
      const base = pos.length / 3;
      for (const [u, v] of points) put(u, v, w, col);
      for (let j = 1; j < points.length - 1; j++) index.push(base, base + j, base + j + 1);
    };
    const H = SIGN.height;
    const R = SIGN.half;
    // the post: four sides, from the ground to the diamond's top
    const P = SIGN.post;
    for (const [a, b] of [
      [[-P, -P], [P, -P]],
      [[P, -P], [P, P]],
      [[P, P], [-P, P]],
      [[-P, P], [-P, -P]],
    ]) {
      const i = [put(a[0], 0, a[1] - 0.04, PAINT.post), put(b[0], 0, b[1] - 0.04, PAINT.post), put(b[0], H + R * 0.8, b[1] - 0.04, PAINT.post), put(a[0], H + R * 0.8, a[1] - 0.04, PAINT.post)];
      index.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    }
    // the plate: its back (facing away), the black rim, the yellow field, the arrow
    const diamond = (r) => [
      [0, H - r],
      [r, H],
      [0, H + r],
      [-r, H],
    ];
    poly(diamond(R).reverse(), PAINT.back, -0.005);
    poly(diamond(R), PAINT.black, 0);
    poly(diamond(R * 0.88), PAINT.yellow, 0.004);
    // the arrow: a stem rising from the bottom, bending over in a quarter circle towards the side the road turns, and
    // its head (+u is the driver's right as the sign faces the cars)
    const t = turn < 0 ? 1 : -1;
    const w = 0.06;
    const path = [[0, H - R * 0.55]];
    const cR = R * 0.26;
    for (let j = 0; j <= 6; j++) {
      const ang = Math.PI - (j / 6) * (Math.PI / 2);
      path.push([t * (cR + cR * Math.cos(ang)), H - R * 0.08 + cR * Math.sin(ang)]);
    }
    for (let j = 0; j < path.length - 1; j++) {
      const [u0, v0] = path[j];
      const [u1, v1] = path[j + 1];
      const l = Math.hypot(u1 - u0, v1 - v0) || 1;
      const nu = (-(v1 - v0) / l) * w;
      const nv = ((u1 - u0) / l) * w;
      poly([[u0 - nu, v0 - nv], [u1 - nu, v1 - nv], [u1 + nu, v1 + nv], [u0 + nu, v0 + nv]], PAINT.black, 0.008);
    }
    const [eu, ev] = path[path.length - 1];
    poly([[eu, ev - R * 0.17], [eu + t * R * 0.26, ev], [eu, ev + R * 0.17]], PAINT.black, 0.008);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 4));
    const n = pos.length / 3;
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(new Array(n).fill([1, 0]).flat(), 2));
    g.setAttribute('aBake', new THREE.Float32BufferAttribute(new Array(n).fill([Math.min(1, bake[0] + 0.05), Math.min(1, bake[1] + 0.05), bake[2], 1]).flat(), 4));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'bend-sign';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    count++;
  }
  return {
    group,
    count,
    dispose() {
      for (const m of group.children) m.geometry.dispose();
    },
  };
}
