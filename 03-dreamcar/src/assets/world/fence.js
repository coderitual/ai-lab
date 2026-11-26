// The lakeside's fence (lakeside.js; the photograph r2): a stock fence along
// the top of the low cut on the right of the stretch, weathered wooden posts
// with wire strung between them. It stands a couple of metres beyond the
// cut's lip, well beyond the solid edge: scenery, nothing a car can reach.
//
// One merged mesh, one draw call. Posts are square, a little out of plumb and
// of uneven height; the wires are thin upright ribbons from post to post (so
// they face the road) that sag a little in each span. The low tier has every
// other post, three-sided, and the top wire only.

import * as THREE from 'three';
import { LAKESIDE } from './lakeside.js';

/** Posts: metres apart, height range, thickness; where the line stands beyond the cut's lip (m); wire heights and its thickness (m). */
const FENCE = {
  step: { low: 5.2, medium: 2.6, high: 2.6 },
  height: [1.05, 1.25],
  thick: 0.09,
  beyond: 2.2,
  wires: { low: [1.0], medium: [0.38, 0.7, 1.0], high: [0.38, 0.7, 1.0] },
  wire: 0.022,
  sag: 0.035,
  wood: [0.2, 0.17, 0.13],
  steel: [0.34, 0.35, 0.36],
};

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./terrain.js').Terrain} options.terrain
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @returns {{ mesh: THREE.Mesh, stats: object, dispose: () => void } | null}
 */
export function createFence({ track, terrain, tier, atmosphere, rng }) {
  const lakeside = terrain.lakeside;
  if (!lakeside) return null;
  const step = FENCE.step[tier] ?? FENCE.step.medium;
  const wires = FENCE.wires[tier] ?? FENCE.wires.medium;
  const sides = tier === 'low' ? 3 : 4;
  const pos = [];
  const col = [];
  const index = [];
  const p = new THREE.Vector3();
  const tops = [];
  /** A post: a prism from 0.3 m under the ground to its top, leaning by (lx, lz) per metre. */
  const post = (x, y, z, h, yaw, lx, lz, tone) => {
    const base = pos.length / 3;
    const r = FENCE.thick * 0.71;
    for (let k = 0; k < sides; k++) {
      const a = yaw + (k / sides) * Math.PI * 2;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      pos.push(x + dx, y - 0.3, z + dz, x + dx + lx * h, y + h, z + dz + lz * h);
      // darker at the foot (damp), paler at the weathered top
      for (const t of [0.6, 1.05]) col.push(FENCE.wood[0] * tone * t, FENCE.wood[1] * tone * t, FENCE.wood[2] * tone * t);
    }
    for (let k = 0; k < sides; k++) {
      const a = base + k * 2;
      const b = base + ((k + 1) % sides) * 2;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
    // the top
    for (let k = 1; k < sides - 1; k++) index.push(base + 1, base + (k + 1) * 2 + 1, base + k * 2 + 1);
    return [x + lx * h, y, z + lz * h];
  };
  let posts = 0;
  for (let d = LAKESIDE.from + 2; d <= LAKESIDE.to - 2; d += step) {
    const s = track.wrap(lakeside.s0 + d);
    const c = terrain.cliffAt(s, -1);
    const lat = -(track.edgeAt(s, -1) + c.top + FENCE.beyond + rng.range(-0.12, 0.12));
    track.pointAt(s, lat, p);
    const y = terrain.heightOnTrack(s, lat);
    const h = rng.range(FENCE.height[0], FENCE.height[1]);
    tops.push(post(p.x, y, p.z, h, rng.range(0, Math.PI), rng.range(-0.05, 0.05), rng.range(-0.05, 0.05), rng.range(0.8, 1.2)));
    posts++;
  }
  // the wires: an upright ribbon from post to post, in two pieces with a little sag between
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i];
    const b = tops[i + 1];
    for (const hgt of wires) {
      const base = pos.length / 3;
      for (let k = 0; k <= 2; k++) {
        const t = k / 2;
        const y = a[1] + (b[1] - a[1]) * t + hgt - (k === 1 ? FENCE.sag : 0);
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[2] + (b[2] - a[2]) * t;
        pos.push(x, y - FENCE.wire / 2, z, x, y + FENCE.wire / 2, z);
        col.push(...FENCE.steel, ...FENCE.steel);
      }
      for (let k = 0; k < 2; k++) {
        const v = base + k * 2;
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = atmosphere.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  material.name = 'fence';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lakeside-fence';
  mesh.castShadow = tier !== 'low';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    stats: { posts, triangles: index.length / 3 },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
