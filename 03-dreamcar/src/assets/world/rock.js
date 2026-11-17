// Rock faces: where the Track's solid edge is rock, a cut face standing at
// the edge, several metres high, merging into the hillside above.
//
// The terrain's height function already rises behind a rock edge as a steep
// cliff (terrain.cliffAt): a foot a little beyond the edge, a face leaning
// back at LEAN, a top, then the hillside. The face drawn here stands just in
// front of that cliff, so the ground never shows through it: its foot is at
// the solid edge (where the cars hit it), it leans back less steeply than the
// cliff, it juts out by strata (layers a few tens of centimetres to a metre
// thick, each sticking out by its own amount, varying along the road), and
// at the top it folds back over the cliff's lip and tucks under the ground.
// It is shaded flat, facet by facet, in the ground's own material, which on
// ground this steep is rock: so it is lit, hazed and baked like the hillside
// it belongs to.

import * as THREE from 'three';
import { planeNoise } from './shading.js';

/** How far the face leans back (m out per m up), less than the terrain's cliff (terrain.js LEAN). */
const LEAN = 0.17;
/** Rows of the face from its buried foot to its top, and the rows that fold over the lip. */
const FACE_ROWS = 14;
/** Rows along the road: one every this many metres, per tier. */
const STEP = { low: 2, medium: 1, high: 1 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./terrain.js').Terrain} options.terrain
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 */
export function createRockFaces({ track, terrain, tier, rng }) {
  const noise = planeNoise(rng.int(1 << 30));
  const step = STEP[tier] ?? 1;
  const ds = track.ds;
  const n = track.count;
  const pt = new THREE.Vector3();
  const prof = { y: 0, surface: 0 };
  const group = new THREE.Group();
  group.name = 'rock';
  const geometries = [];

  /** How far a stratum at height t sticks out (m), 0..1 of what there is room for. */
  function jut(s, t, side) {
    const layer = Math.floor(t / 1.1 + 0.9 * noise.fbm(s * 0.03, side * 11 + t * 0.2, 2));
    const along = noise.fbm(s / 9 + layer * 3.1, layer * 1.7 + side * 5, 3);
    const fine = noise.value(s * 0.6, t * 1.3 + side * 7);
    return Math.min(1, Math.max(0, 0.15 + 0.75 * along * along * 1.6 + 0.25 * (fine - 0.5)));
  }

  for (const side of [1, -1]) {
    // runs of samples where this side is a rock edge
    let run = [];
    const flush = () => {
      if (run.length > 2) {
        const CH = Math.round(120 / ds);
        for (let a = 0; a < run.length - 1; a += CH) geometries.push(build(run.slice(a, a + CH + 1), side));
      }
      run = [];
    };
    for (let i = 0; i <= n; i += step) {
      const c = terrain.cliffAt(i * ds, side);
      if (c.height > 0.3 && i < n) run.push(i * ds);
      else flush();
    }
    flush();
  }

  function build(list, side) {
    const per = FACE_ROWS + 3;
    const grid = new Float32Array(list.length * per * 3);
    for (let r = 0; r < list.length; r++) {
      const s = list[r];
      const c = terrain.cliffAt(s, side);
      const edge = track.edgeAt(s, side);
      const yE = track.profile(s, side * edge, prof).y;
      // how far out the terrain's cliff is at height t: the face must stay in front of it
      const room = (t) => 0.8 * c.rock + 0.3 * t - 0.12;
      for (let k = 0; k < per; k++) {
        let d;
        let y;
        if (k <= FACE_ROWS) {
          const t = k === 0 ? -0.5 : (c.height * k) / FACE_ROWS;
          const tt = Math.max(0, t);
          const base = LEAN * tt;
          d = Math.min(room(tt), base + (0.25 + 0.15 * tt) * jut(s, tt, side));
          d = Math.max(k === 0 ? 0.05 : 0, d);
          y = yE + t;
        } else {
          // over the lip and under the ground
          d = c.top + (k === FACE_ROWS + 1 ? 0.6 : 2.6);
          y = terrain.heightOnTrack(s, side * (edge + d)) + (k === FACE_ROWS + 1 ? 0.12 : -0.45);
        }
        track.pointAt(s, side * (edge + d), pt);
        const v = (r * per + k) * 3;
        grid[v] = pt.x;
        grid[v + 1] = y;
        grid[v + 2] = pt.z;
      }
    }
    // flat-shaded facets: every triangle its own three vertices
    const tris = (list.length - 1) * (per - 1) * 2;
    const pos = new Float32Array(tris * 9);
    let o = 0;
    const put = (r, k) => {
      const v = (r * per + k) * 3;
      pos[o++] = grid[v];
      pos[o++] = grid[v + 1];
      pos[o++] = grid[v + 2];
    };
    for (let r = 0; r < list.length - 1; r++) {
      for (let k = 0; k < per - 1; k++) {
        // facing the road: on the left side the face looks towards -left, on the right towards +left
        if (side < 0) {
          put(r, k), put(r, k + 1), put(r + 1, k);
          put(r + 1, k), put(r, k + 1), put(r + 1, k + 1);
        } else {
          put(r, k), put(r + 1, k), put(r, k + 1);
          put(r + 1, k), put(r + 1, k + 1), put(r, k + 1);
        }
      }
    }
    const count = tris * 3;
    const bake = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) (terrain.bake4At ?? terrain.bakeAt)(pos[v * 3], pos[v * 3 + 2], bake, v * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    // aMask.y = 2: a cut face (groundMaterial.js draws it as bedded limestone whatever the facets' slopes)
    const mask = new Float32Array(count * 2);
    for (let v = 0; v < count; v++) mask[v * 2 + 1] = 2;
    geometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, terrain.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}
