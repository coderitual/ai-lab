// (forest lane) Granite boulders: the pale, rounded and fractured blocks of
// frame e5's bend and the mossy ones among frame e2's trunks. groundCover.js
// places them (where a piece's scheme asks: trackLayout.js SCHEMES `boulders`)
// and draws them instanced like its other rocks.
//
// A boulder is a ball (an icosahedron), squashed into an ellipsoid and lumped
// by smooth noise, then FRACTURED: a few planes cut it, everything beyond a
// plane is pressed back onto it, so that it has the flat faces and sharp
// arrises of a block split along its joints, its edges then rounded by the
// lumps. It is painted per vertex: pale granite flecked darker and lighter,
// lichen in pale patches, moss on what faces the sky (more on the mossy kind),
// and the foot darker where it stands in the earth. Shaded flat, facet by facet.
//
// Two shapes: 'round' (a weathered boulder) and 'block' (a split slab, the
// outcrops' big pieces). Pure geometry: no textures.

import * as THREE from 'three';
import { GRASS } from './groundMaterial.js';
import { planeNoise } from './shading.js';

/** Granite (linear albedo), flecks either way, lichen, the earth at its foot. */
const GRANITE = { base: [0.34, 0.33, 0.31], fleck: 0.07, lichen: [0.4, 0.39, 0.3], foot: [0.075, 0.07, 0.062] };
/** Moss: the grass's own green (groundMaterial.js GRASS), a shade deeper. */
const MOSS = GRASS.bush.map((c) => c * 0.95);

/**
 * One boulder's geometry, about a unit ball (its foot to be sunk into the ground), non-indexed, with `color`.
 * @param {import('../../engine/rng.js').Rng} rng
 * @param {{ detail?: number, kind?: 'round'|'block', moss?: number }} o moss: how much of its top is mossy (0..1)
 */
export function boulderGeometry(rng, { detail = 2, kind = 'round', moss = 0.3 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const noise = planeNoise(rng.int(1 << 30));
  const sx = kind === 'block' ? rng.range(1.1, 1.3) : rng.range(0.95, 1.15);
  const sy = kind === 'block' ? rng.range(0.6, 0.75) : rng.range(0.7, 0.85);
  const sz = kind === 'block' ? rng.range(0.75, 0.9) : rng.range(0.85, 1.0);
  // the joints it was split along: a few planes, the block's mostly upright and level
  const planes = [];
  const cuts = kind === 'block' ? 5 : 3;
  for (let k = 0; k < cuts; k++) {
    const a = rng.range(0, Math.PI * 2);
    const up = kind === 'block' && k < 2 ? (k === 0 ? 1 : -0.2) : rng.range(-0.3, 0.6);
    const n = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    planes.push([n, rng.range(kind === 'block' ? 0.5 : 0.62, kind === 'block' ? 0.72 : 0.85)]);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // lumps (smooth noise of the direction: the same at every copy of a corner)
    const k = 0.82 + 0.36 * noise.fbm(v.x * 1.4 + 3.1, v.z * 1.4 + v.y * 1.1, 3);
    v.multiplyScalar(k);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    for (const [n, d] of planes) {
      const over = v.dot(n) - d;
      if (over > 0) v.addScaledVector(n, -over);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  // the faces' own normals (flat shading), for where moss grows
  const count = p.count;
  const color = new Float32Array(count * 3);
  const shade = new Float32Array(count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let f = 0; f < count; f += 3) {
    a.fromBufferAttribute(p, f);
    b.fromBufferAttribute(p, f + 1);
    c.fromBufferAttribute(p, f + 2);
    fn.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    for (let j = 0; j < 3; j++) {
      const i = f + j;
      v.fromBufferAttribute(p, i);
      const fleck = (rng.next() - 0.5) * 2 * GRANITE.fleck;
      let col = GRANITE.base.map((x) => x * (1 + fleck * 3));
      // lichen in pale patches
      const lichen = Math.max(0, noise.fbm(v.x * 2.3 + 11, v.z * 2.3 + v.y * 1.7, 2) - 0.6) * 3;
      col = col.map((x, q) => x + (GRANITE.lichen[q] - x) * Math.min(1, lichen));
      // moss on what faces the sky, in a ragged sheet
      const sky = THREE.MathUtils.smoothstep(fn.y, 0.25, 0.8);
      const sheet = THREE.MathUtils.smoothstep(noise.fbm(v.x * 1.7 + 5, v.z * 1.7 - v.y, 2) + moss * 0.9, 0.85, 1.15);
      const m = Math.min(1, sky * sheet * (0.3 + moss));
      col = col.map((x, q) => x + (MOSS[q] - x) * m);
      // the foot, in the earth: dark and damp
      const foot = 1 - THREE.MathUtils.smoothstep(v.y, -0.32, 0.05);
      col = col.map((x, q) => x + (GRANITE.foot[q] - x) * foot * 0.85);
      color.set(col, i * 3);
      shade[i * 2] = 0.6 + 0.4 * THREE.MathUtils.smoothstep(v.y, -0.4, 0.35);
      shade[i * 2 + 1] = 0;
    }
  }
  void nor;
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(shade, 2));
  g.computeBoundingSphere();
  return g;
}
