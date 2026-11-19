// Rock faces: where the Track's solid edge is rock, a cut face standing at
// the edge, several metres high, merging into the hillside above.
//
// The terrain's height function already rises behind a rock edge as a steep
// cliff (terrain.cliffAt): a foot a little beyond the edge, a face leaning
// back at LEAN, a top, then the hillside. The face drawn here stands just in
// front of that cliff, so the ground never shows through it: its foot is at
// the solid edge (where the cars hit it), it leans back less steeply than the
// cliff, and at the top it folds back over the cliff's lip and tucks under
// the ground.
//
// (nearfield lane) The face is built of beds and blocks, not a sheet: beds
// BED m thick (their lines waving gently along the road), each bed cut into
// blocks a few metres long, and every block set back from the road by its own
// amount. Where a bed stands further back than the one under it, its foot is a
// ledge facing up (the ground's material grows grass and scrub there); where
// it stands further out, its underside is an overhang facing down, in shade.
// The rows of the strip are laid on the bed lines themselves, so the steps are
// crisp. The ground's material draws the same beds and blocks (the same
// hash, ROCK_GLSL), so its cracks, lit lips and shaded undersides fall on the
// geometry's steps. It is shaded flat, facet by facet, in the ground's own
// material, so it is lit, hazed and baked like the hillside it belongs to.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planeNoise } from './shading.js';

/** How far the face leans back (m out per m up), less than the terrain's cliff (terrain.js LEAN). */
const LEAN = 0.17;
/** (nearfield lane) A bed's thickness (m); the shader reads it too (ROCK_GLSL). */
export const BED = 1.35;
/** How far a block may stand back beyond the face's lean (m): least and most. */
const SET_BACK = [0.06, 0.62];
/** Rows along the road: one every this many metres, per tier. */
const STEP = { low: 3, medium: 2, high: 1 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./terrain.js').Terrain} options.terrain
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {(s: number, side: number) => boolean} [options.except] where no rock face is drawn (something else stands there)
 */
export function createRockFaces({ track, terrain, tier, rng, except = null }) {
  const noise = planeNoise(rng.int(1 << 30));
  const step = STEP[tier] ?? 1;
  const ds = track.ds;
  const n = track.count;
  const pt = new THREE.Vector3();
  const prof = { y: 0, surface: 0 };
  const group = new THREE.Group();
  group.name = 'rock';
  const geometries = [];

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
      // (tunnel lane) not where something else stands at the edge instead (the tunnel's concrete cuttings)
      if (c.height > 0.3 && i < n && !except?.(i * ds, side)) run.push(i * ds);
      else flush();
    }
    flush();
  }

  function build(list, side) {
    // the beds this piece needs: enough to reach the top of its highest column
    let highest = 0;
    for (const s of list) highest = Math.max(highest, terrain.cliffAt(s, side).height);
    const beds = Math.ceil(highest / BED) + 2;
    // per column: the buried foot, three rows per bed (its foot, its swelling middle, its top), the top, two over
    // the lip
    const per = 1 + 3 * beds + 1 + 2;
    const grid = new Float32Array(list.length * per * 3);
    const tOf = new Float32Array(list.length * per);
    const fracOf = new Float32Array(list.length * per);
    for (let r = 0; r < list.length; r++) {
      const s = list[r];
      const c = terrain.cliffAt(s, side);
      const H = c.height;
      const edge = track.edgeAt(s, side);
      const yE = track.profile(s, side * edge, prof).y;
      // how far out the terrain's cliff is at height t: the face must stay in front of it
      const room = (t) => 0.8 * c.rock + 0.3 * t - 0.12;
      const off = bedOffset(s, side);
      // a block swells out towards its middle, up and along (a rounded mass, not a brick)
      // (round 2) not on the low tier: its columns are 3 m apart, and the swell made stripes of them
      const swells = tier !== 'low';
      const back = (j, t, swell = 0) => {
        const b = blockAt(j, s, side);
        const set = SET_BACK[0] + (SET_BACK[1] - SET_BACK[0]) * b.back - (swells ? swell : 0) * (0.1 + 0.28 * b.swell) * Math.sin(Math.PI * b.u) ** 0.7;
        return Math.max(0.05, Math.min(room(t), LEAN * t + set));
      };
      const rows = [];
      rows.push([0.05, -0.5]);
      // bed j spans t in [j * BED - off, (j + 1) * BED - off], clipped to the face
      for (let j = 0; j < beds; j++) {
        const t0 = Math.min(H, Math.max(0, j * BED - off));
        const t1 = Math.min(H, Math.max(0, (j + 1) * BED - off));
        // the beds above the top: the top row again (no folds over one another up there)
        if (j * BED - off >= H) rows.push(rows[rows.length - 1], rows[rows.length - 1], rows[rows.length - 1]);
        else {
          const tm = 0.45 * t0 + 0.55 * t1;
          rows.push([back(j, t0), t0], [back(j, tm, t1 - t0 > 0.3 ? 1 : 0), tm], [back(j, t1), t1]);
        }
      }
      rows.push([rows[rows.length - 1][0], H]);
      for (let k = 0; k < per; k++) {
        let d;
        let y;
        let t;
        let frac;
        if (k < per - 2) {
          [d, t] = rows[k];
          y = yE + t;
          frac = H > 0 ? Math.max(0, t) / H : 0;
        } else {
          // over the lip and under the ground
          const lip = k === per - 2;
          d = c.top + (lip ? 0.6 : 2.6);
          y = terrain.heightOnTrack(s, side * (edge + d)) + (lip ? 0.12 : -0.45);
          t = H;
          frac = lip ? 1.2 : 1.4;
        }
        track.pointAt(s, side * (edge + d), pt);
        const v = (r * per + k) * 3;
        grid[v] = pt.x;
        grid[v + 1] = y;
        grid[v + 2] = pt.z;
        tOf[r * per + k] = t;
        fracOf[r * per + k] = frac;
      }
    }
    // flat-shaded facets: every triangle its own three vertices
    const tris = (list.length - 1) * (per - 1) * 2;
    const pos = new Float32Array(tris * 9);
    // aVerge: metres up the face, s, the side, 1 (not a verge); aMask.y: 2 + the share of the face's height
    const verge = new Float32Array(tris * 3 * 4);
    const mask = new Float32Array(tris * 3 * 2);
    let o = 0;
    const put = (r, k) => {
      const i = r * per + k;
      const v = i * 3;
      verge.set([tOf[i], list[r], side, 1], (o / 3) * 4);
      mask.set([0, 2 + fracOf[i]], (o / 3) * 2);
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
    // aMask.y >= 2: a cut face (groundMaterial.js draws it in beds and blocks whatever the facets' slopes)
    geometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    geometry.setAttribute('aVerge', new THREE.BufferAttribute(verge, 4));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // (nearfield lane) the arch over the cutting out of the tunnel, where it opens onto the sky road
  const arch = buildArch({ track, terrain, tier, noise });
  if (arch) geometries.push(arch);

  // (nearfield lane) all of it in one mesh: world/index.js cuts it into 400 m pieces (a run's every 120 m was a draw
  // call of its own)
  const merged = geometries.length > 1 ? mergeGeometries(geometries) : geometries[0];
  if (geometries.length > 1) for (const g of geometries) g.dispose();
  if (merged) {
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, terrain.material);
    mesh.name = 'rock';
    mesh.castShadow = true;
    // (round 2) on the low tier its coarse shadow map laid blotches over the faces' own overhangs: the bake shades them
    mesh.receiveShadow = tier !== 'low';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  return {
    group,
    stats: { arch: !!arch },
    dispose() {
      merged?.dispose();
    },
  };
}

/**
 * (nearfield lane) The circuit's signature rock: a natural arch of the same stone, springing from the tops of the
 * cutting's two faces and spanning the road high over it (its underside ARCH.clear m over the road at the middle,
 * far above anything a car or a camera does), skewed across the road, thick and lumpy at its feet, thinner at its
 * crown, pitted like the faces. Its feet are buried in the ground beyond both faces' tops, never inside the corridor.
 */
export const ARCH = { s: 1972, skew: 0.35, clear: 11, foot: 5.2, crown: 2.9, along: 24, around: 11 };

function buildArch({ track, terrain, tier, noise }) {
  const s0 = ARCH.s;
  const sides = [1, -1].map((side) => ({ side, c: { ...terrain.cliffAt(s0, side) }, edge: track.edgeAt(s0, side) }));
  if (sides.some(({ c }) => c.height < 2)) return null;
  const yRoad = track.profile(s0, 0, { y: 0 }).y;
  const along = tier === 'low' ? 14 : ARCH.along;
  const around = tier === 'low' ? 7 : ARCH.around;
  const p = new THREE.Vector3();
  // the spine: from beyond the left face's top, up over the road, down beyond the right's
  const spine = [];
  const [L, R] = sides;
  const latL = L.edge + L.c.top + 3.5;
  const latR = -(R.edge + R.c.top + 3.5);
  for (let k = 0; k <= along; k++) {
    const u = k / along;
    const lat = latL + (latR - latL) * u;
    const s = s0 + ARCH.skew * lat;
    const ground = terrain.heightOnTrack(s, lat) - 1.2;
    // its underside: the clearance over the middle, falling as a curve to the ground at the feet
    const bow = Math.sin(Math.PI * u);
    const r = ARCH.crown + (ARCH.foot - ARCH.crown) * (1 - bow) ** 1.5;
    const b = bow ** 0.6;
    let y = (ground + 0.3 * r) * (1 - b) + (yRoad + ARCH.clear + r * 1.2) * b;
    // over the corridor (and a little either side) it stays far above anything that moves
    const inside = lat >= 0 ? lat < L.edge + 1 : -lat < R.edge + 1;
    if (inside) y = Math.max(y, yRoad + ARCH.clear - 2 + r * 1.3);
    track.pointAt(s, lat, p);
    spine.push({ p: new THREE.Vector3(p.x, y, p.z), r, u });
  }
  // rings round it, lumpy (noise of the angle and the place), flattened a little top to bottom
  const rings = spine.map((q, k) => {
    const a = spine[Math.min(along, k + 1)].p.clone().sub(spine[Math.max(0, k - 1)].p).normalize();
    const side = new THREE.Vector3().crossVectors(a, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, a).normalize();
    const ring = [];
    for (let j = 0; j < around; j++) {
      const th = (j / around) * Math.PI * 2;
      const lump = 0.65 + 0.7 * noise.fbm(k * 0.35 + 3.3, j * 0.7 + 1.7, 3);
      const rr = q.r * lump;
      ring.push(q.p.clone().addScaledVector(side, Math.cos(th) * rr * 1.15).addScaledVector(up, Math.sin(th) * rr * 0.85));
    }
    return ring;
  });
  const pos = [];
  const verge = [];
  const mask = [];
  const put = (k, j) => {
    const v = rings[k][j % around];
    pos.push(v.x, v.y, v.z);
    // as a cut face: metres up from the road, s, no side; the middle of a face's height (no damp foot, no lip)
    verge.push(v.y - yRoad, s0 + ARCH.skew * (latL + (latR - latL) * spine[k].u) + 7 * (j / around), 0, 1);
    mask.push(0, 2.5);
  };
  for (let k = 0; k < along; k++) {
    for (let j = 0; j < around; j++) {
      put(k, j), put(k + 1, j), put(k, j + 1);
      put(k, j + 1), put(k + 1, j), put(k + 1, j + 1);
    }
  }
  const count = pos.length / 3;
  const bake = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) (terrain.bake4At ?? terrain.bakeAt)(pos[v * 3], pos[v * 3 + 2], bake, v * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
  geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 2));
  geometry.setAttribute('aVerge', new THREE.Float32BufferAttribute(verge, 4));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * (nearfield lane) The beds' and blocks' layout, shared with the ground's shader (ROCK_GLSL in groundMaterial.js
 * computes the same numbers from the same integer hash, so the painted cracks fall on the geometry's steps).
 */
export function rockHash(a, b, c) {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 8) / 16777216;
}

/** How far the bed lines are lowered at s (m): they wave gently along the road. */
export function bedOffset(s, side) {
  return BED * (0.5 + 0.3 * Math.sin(s / 29 + side * 1.7) + 0.15 * Math.sin(s / 11.3 + 0.4 * side));
}

/** Bed j's block at s: its index, how far back it stands (0..1 of SET_BACK), how much it swells, where along it s is. */
function blockAt(j, s, side) {
  const len = 2.6 + 4.2 * rockHash(j, side, 1);
  const shift = rockHash(j, side, 2) * len;
  const u = (s + shift) / len;
  const blk = Math.floor(u);
  return { blk, back: rockHash(j, blk, side * 7 + 3), swell: rockHash(j, blk, side * 7 + 4), u: u - blk };
}
