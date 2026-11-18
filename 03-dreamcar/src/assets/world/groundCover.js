// What grows and lies under the trees and along the verges: grass tufts and
// low bushes on the verges and under the first rows of trees, and boulders and
// fallen rocks at the foot of the rock faces and scattered down the slopes.
//
// All of it stands beyond the pavement (grass and bushes only on the verge's
// grass, never on the shoulder or gravel; rocks only beyond the solid edge,
// where the physics would never meet them). It is placed from the Track
// (track coordinates, the corridor's own profile for its height, the
// terrain's beyond the edge) and drawn like the forest: per view, from cells,
// within a reach that depends on its size and the tier, dissolving at the end
// of it. Grass and bushes stir a little in the wind. The low tier has rocks
// only.

import * as THREE from 'three';
import { alphaMips, chainTexture } from './forestTextures.js';
import { plantMaterial } from './treeMaterial.js';
import { planeNoise } from './shading.js';
import { GRASS } from './groundMaterial.js';
import { boulderGeometry } from './boulders.js';
import { createBendSigns } from './bendSigns.js';
import { schemeAt, schemeTable } from './schemes.js';

const SURFACE_GRASS = 2;
const EDGE = { RAIL: 0, ROCK: 1, WALL: 2, PARAPET: 3, TREES: 4 };

/** Per tier: grass tufts per metre of road and side, their reach (m); bushes' reach; rocks' reach. */
const TIER = {
  low: { grass: 0, grassReach: 0, bushes: false, bushReach: 0, rockReach: 160 },
  medium: { grass: 2.2, grassReach: 38, bushes: true, bushReach: 75, rockReach: 260 },
  high: { grass: 3.2, grassReach: 48, bushes: true, bushReach: 95, rockReach: 340 },
};

/**
 * A small canvas of four tiles side by side: grass blades, a leafy bush, a fern and flowers (spikes and small heads
 * on thin stems: forest lane). Drawn pale; tinted per instance.
 */
function coverTexture(rng) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.lineCap = 'round';
  // grass: blades from the bottom edge, curving
  for (let k = 0; k < 70; k++) {
    // a tuft: blades from near the middle, the tallest in the middle, splaying out
    const x = 64 + rng.range(-1, 1) * rng.range(0, 40);
    const hgt = rng.range(0.3, 1) * (240 - Math.abs(x - 64) * 2.5);
    const bend = (x - 64) * rng.range(0.6, 1.4) + rng.range(-20, 20);
    const l = Math.round(255 * rng.range(0.45, 1));
    ctx.strokeStyle = `rgb(${l},${l},${Math.round(l * 0.9)})`;
    ctx.lineWidth = rng.range(1.2, 2.4);
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + bend * 0.3, size - hgt * 0.6, x + bend, size - hgt);
    ctx.stroke();
  }
  // the bush: leaves heaped into a dome over the bottom edge
  for (let k = 0; k < 700; k++) {
    // a round clump of a few lobes, with a ragged rim
    const lobe = rng.int(4);
    const lx = 192 + [-24, 22, 0, -6][lobe];
    const ly = [196, 200, 160, 120][lobe];
    const lr = [34, 32, 42, 26][lobe];
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * rng.range(0.85, 1.1);
    const x = lx + Math.cos(a) * r * lr;
    const y = Math.min(size - 3, ly + Math.sin(a) * r * lr);
    const l = Math.round(255 * rng.range(0.4, 1) * (0.6 + 0.4 * (1 - r * 0.5)));
    ctx.fillStyle = `rgb(${l},${l},${Math.round(l * 0.85)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(3, 6), rng.range(2, 4), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  // (forest lane) the fern: fronds from the middle of the bottom edge, arching out, leaflets either side of each
  // rib, shorter towards its tip
  {
    const x0 = 256 + 64;
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k / 8 - 0.5) * 2.3 + rng.range(-0.12, 0.12);
      const len = rng.range(150, 230) * (1 - 0.35 * Math.abs(k / 8 - 0.5));
      const droop = rng.range(0.6, 1.1) * Math.sign(Math.cos(a) || 1);
      const steps = 14;
      let px = x0;
      let py = size;
      for (let j = 0; j < steps; j++) {
        const u = j / steps;
        const ang = a + droop * u * u * 1.2;
        const nx = px + Math.cos(ang) * (len / steps);
        const ny = py + Math.sin(ang) * (len / steps);
        const l = Math.round(255 * rng.range(0.55, 0.9));
        ctx.strokeStyle = `rgb(${l},${l},${Math.round(l * 0.9)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        // a leaflet each side
        const leaf = 22 * (1 - u) + 4;
        for (const hand of [-1, 1]) {
          const la = ang + hand * 1.15;
          ctx.fillStyle = `rgb(${l},${l},${Math.round(l * 0.88)})`;
          ctx.beginPath();
          ctx.ellipse(nx + Math.cos(la) * leaf * 0.5, ny + Math.sin(la) * leaf * 0.5, leaf * 0.5, Math.max(1.5, leaf * 0.16), la, 0, Math.PI * 2);
          ctx.fill();
        }
        px = nx;
        py = ny;
      }
    }
  }
  // (forest lane) flowers: spikes of small blossoms (lupins) and loose clusters of small heads on thin, dark stems
  {
    const x0 = 384;
    for (let k = 0; k < 16; k++) {
      const x = x0 + 64 + rng.range(-1, 1) * rng.range(10, 54);
      const top = size - rng.range(90, 225);
      const spike = rng.next() < 0.5;
      ctx.strokeStyle = 'rgb(70,70,62)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, size);
      ctx.quadraticCurveTo(x + rng.range(-6, 6), (size + top) / 2, x + rng.range(-4, 4), top + (spike ? 40 : 0));
      ctx.stroke();
      if (spike) {
        for (let j = 0; j < 14; j++) {
          const u = j / 13;
          const r = 6.5 * (1 - 0.6 * u);
          const l = Math.round(255 * rng.range(0.7, 1));
          ctx.fillStyle = `rgb(${l},${l},${l})`;
          ctx.beginPath();
          ctx.ellipse(x + rng.range(-r, r) * 0.6, top + 44 - u * 46, r, r * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        for (let j = 0; j < 5; j++) {
          const l = Math.round(255 * rng.range(0.8, 1));
          ctx.fillStyle = `rgb(${l},${l},${l})`;
          ctx.beginPath();
          ctx.arc(x + rng.range(-12, 12), top + rng.range(-8, 8), rng.range(3.5, 6.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  // (trees lane) mip levels that keep each tile's coverage at the cut, as the trees' atlas does: no thinning and no
  // crawling edges at a distance, on the tiers whose alpha is a plain cut
  const { levels } = alphaMips(ctx.getImageData(0, 0, size * 2, size).data, size * 2, size, {
    regions: [
      [0, 0, size / 2, size],
      [size / 2, 0, size, size],
      [size, 0, size * 1.5, size],
      [size * 1.5, 0, size * 2, size],
    ],
  });
  return chainTexture(levels);
}

/** Crossed upright cards standing on y = 0, `n` of them, `w` wide and `h` tall, picturing [u0, u1] of the map. */
function cards(n, w, h, u0, u1) {
  const pos = [];
  const nor = [];
  const uv = [];
  const shade = [];
  const index = [];
  for (let q = 0; q < n; q++) {
    const a = (q / n) * Math.PI;
    const dx = Math.cos(a) * w * 0.5;
    const dz = Math.sin(a) * w * 0.5;
    const base = pos.length / 3;
    for (const [s, y, u, v, ao] of [
      [-1, 0, u0, 1, 0.55],
      [1, 0, u1, 1, 0.55],
      [1, h, u1, 0, 1],
      [-1, h, u0, 0, 1],
    ]) {
      pos.push(dx * s, y, dz * s);
      // lit like the ground it grows from
      nor.push(dx * s * 0.15, 1, dz * s * 0.15);
      uv.push(u, v);
      shade.push(ao, 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 2));
  g.setIndex(index);
  return g;
}

/** A boulder: a lumpy, faceted ball, flattened, its lower part to be sunk into the ground. */
function boulder(rng) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const noise = planeNoise(rng.int(1 << 30));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.75 + 0.5 * noise.fbm(x * 1.3 + 3, z * 1.3 + y, 2);
    p.setXYZ(i, x * k, y * k * 0.62, z * k);
  }
  const flat = g; // (already one vertex per corner of each face: flat facets)
  flat.computeVertexNormals();
  const n = flat.attributes.position.count;
  const shade = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    shade[i * 2] = 0.55 + 0.45 * Math.min(1, Math.max(0, flat.attributes.position.getY(i) + 0.4));
    shade[i * 2 + 1] = 0;
  }
  flat.setAttribute('aShade', new THREE.BufferAttribute(shade, 2));
  flat.deleteAttribute('uv');
  return flat;
}

/**
 * One kind of scattered thing, drawn per view from cells within `reach` of the eye.
 * @param {object} o
 * @param {THREE.BufferGeometry} o.geometry @param {THREE.Material} o.material
 * @param {{ x: number, y: number, z: number, m: THREE.Matrix4, tint: number[], bake: number[], r: number }[]} o.items
 * @param {number} o.reach @param {string} o.name @param {THREE.Group} o.group
 */
function scatter({ geometry, material, items, reach, name, group }) {
  const CELL = 40;
  const n = items.length;
  const g = geometry;
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aBake', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.InstancedMesh(g, material, Math.max(1, n));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  mesh.name = name;
  group.add(mesh);
  const matrices = new Float32Array(n * 16);
  items.forEach((it, i) => it.m.toArray(matrices, i * 16));
  // cells
  const cells = new Map();
  items.forEach((it, i) => {
    const key = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  const list = [...cells.values()].map((idx) => {
    let y0 = 1e9;
    let y1 = -1e9;
    let r = 0;
    for (const i of idx) {
      y0 = Math.min(y0, items[i].y);
      y1 = Math.max(y1, items[i].y);
      r = Math.max(r, items[i].r);
    }
    const it = items[idx[0]];
    const cx = (Math.floor(it.x / CELL) + 0.5) * CELL;
    const cz = (Math.floor(it.z / CELL) + 0.5) * CELL;
    return { idx, sphere: new THREE.Sphere(new THREE.Vector3(cx, (y0 + y1) / 2, cz), Math.hypot(CELL * 0.72, (y1 - y0) / 2) + r) };
  });
  const sphere = new THREE.Sphere();
  const tint = g.attributes.aTint.array;
  const bake = g.attributes.aBake.array;
  return {
    mesh,
    count: n,
    prepare(frustum, eye) {
      let k = 0;
      if (reach > 0) {
        for (const cell of list) {
          if (cell.sphere.center.distanceTo(eye) - cell.sphere.radius > reach) continue;
          if (!frustum.intersectsSphere(cell.sphere)) continue;
          for (const i of cell.idx) {
            const it = items[i];
            const d = Math.hypot(it.x - eye.x, it.y - eye.y, it.z - eye.z);
            if (d > reach) continue;
            sphere.center.set(it.x, it.y, it.z);
            sphere.radius = it.r;
            if (!frustum.intersectsSphere(sphere)) continue;
            mesh.instanceMatrix.array.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
            tint[k * 4] = it.tint[0];
            tint[k * 4 + 1] = it.tint[1];
            tint[k * 4 + 2] = it.tint[2];
            tint[k * 4 + 3] = Math.min(1, (reach - d) / (0.2 * reach));
            bake[k * 3] = it.bake[0];
            bake[k * 3 + 1] = it.bake[1];
            bake[k * 3 + 2] = it.bake[2];
            k++;
          }
        }
      }
      mesh.count = k;
      for (const [attr, size] of [
        [mesh.instanceMatrix, 16],
        [g.attributes.aTint, 4],
        [g.attributes.aBake, 3],
      ]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, k) * size);
        attr.needsUpdate = true;
      }
      return k;
    },
  };
}

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ uTime: { value: number }, uWind: { value: THREE.Vector2 } }} options.uniforms the forest's clock and wind
 */
export function createGroundCover({ track, terrain, tier, rng, atmosphere, uniforms }) {
  const started = performance.now();
  const T = TIER[tier] ?? TIER.high;
  const group = new THREE.Group();
  group.name = 'ground-cover';
  const texture = coverTexture(rng.fork('texture'));
  const prof = { y: 0, surface: 0 };
  const point = new THREE.Vector3();
  const bakeTmp = [0, 0, 0];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const inRanges = (s, ranges, margin) => ranges.some((r) => track.delta(r.s0, s) > -margin && track.delta(r.s1, s) < margin);
  const spot = { index: -1, s: 0, lat: 0 };
  /** The ground at track coordinates: the corridor's profile inside the edge, the terrain beyond. */
  const groundAt = (s, lat, side) => {
    const edge = track.edgeAt(s, side);
    if (Math.abs(lat) <= edge) return { y: track.profile(s, lat, prof).y, surface: prof.surface };
    return { y: terrain.heightOnTrack(s, lat), surface: -1 };
  };
  /** False where the point lies on another stretch's corridor. */
  const ownStretch = (s, x, z) => {
    track.locate(x, z, -1, spot);
    return Math.abs(track.delta(spot.s, s)) < 4;
  };
  const make = (x, y, z, yaw, size, tint, r, tilt = 0) => {
    terrain.bakeAt(x, z, bakeTmp, 0);
    e.set(tilt, yaw, tilt * 0.5, 'YXZ');
    q.setFromEuler(e);
    return {
      x,
      y,
      z,
      m: new THREE.Matrix4().compose(point.set(x, y, z), q, sc.set(size[0], size[1], size[2])),
      tint,
      bake: [Math.min(1, bakeTmp[0] + 0.05), Math.min(1, bakeTmp[1] + 0.05), bakeTmp[2]],
      r,
    };
  };

  const grassItems = [];
  const bushItems = [];
  const rockItems = [];
  const r = rng.fork('place');
  const pave = track.halfWidth + (track.shoulder ?? 0.5);
  for (const side of [1, -1]) {
    const kinds = side > 0 ? track.kindL : track.kindR;
    // grass and bushes along the verge (and a little beyond the edge where trees or the open hillside stand)
    if (T.grass > 0) {
      for (let s = 0; s < track.length; s += 1 / T.grass) {
        if (inRanges(s, track.tunnels, 4) || inRanges(s, track.bridges, 2)) continue;
        const i = Math.round(s / track.ds) % track.count;
        const kind = kinds[i];
        const edge = track.edgeAt(s, side);
        const beyond = kind === EDGE.TREES ? 5 : kind === EDGE.RAIL ? 1.5 : 0;
        const lat = side * r.range(pave + 0.4, edge + beyond);
        const g = groundAt(s, lat, side);
        if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
        track.pointAt(s + r.range(-0.3, 0.3), lat, point);
        if (!ownStretch(s, point.x, point.z)) continue;
        const h = r.range(0.2, 0.45);
        const v = r.range(0.85, 1.25);
        // (finish lane) the grass's own green (groundMaterial.js GRASS), a few tufts gone to straw
        const dry = r.next() ** 2;
        const tint = GRASS.tuft.map((c, k) => (c + (GRASS.tuftDry[k] - c) * dry) * v);
        grassItems.push(make(point.x, g.y - 0.03, point.z, r.range(0, Math.PI), [h * 2.2, h, h * 2.2], tint, h));
      }
    }
    if (T.bushes) {
      for (let s = r.range(0, 3); s < track.length; s += r.range(2.5, 6)) {
        if (inRanges(s, track.tunnels, 4) || inRanges(s, track.bridges, 2)) continue;
        const i = Math.round(s / track.ds) % track.count;
        const kind = kinds[i];
        if (kind !== EDGE.TREES && kind !== EDGE.RAIL) continue;
        const edge = track.edgeAt(s, side);
        // under the first rows of trees, or behind the rail
        const lat = side * (edge + (kind === EDGE.TREES ? r.range(0.6, 7) : r.range(0.8, 3)));
        track.pointAt(s, lat, point);
        if (!ownStretch(s, point.x, point.z)) continue;
        const y = terrain.heightOnTrack(s, lat);
        const h = r.range(0.5, 1.3);
        const v = r.range(0.7, 1.2);
        bushItems.push(make(point.x, y - 0.1, point.z, r.range(0, Math.PI), [h * 1.4, h, h * 1.4], GRASS.bush.map((c) => c * v), h));
      }
    }
    // rocks: fallen at the foot of the rock faces, and boulders on the slopes beyond the rails
    for (let s = r.range(0, 4); s < track.length; s += r.range(3, 8)) {
      if (inRanges(s, track.tunnels, 2) || inRanges(s, track.bridges, 2)) continue;
      const i = Math.round(s / track.ds) % track.count;
      const kind = kinds[i];
      const edge = track.edgeAt(s, side);
      let lat;
      let size;
      if (kind === EDGE.ROCK) {
        const c = terrain.cliffAt(s, side);
        lat = side * (edge + 0.25 + r.range(0, Math.max(0.3, c.top * 0.4)));
        size = r.range(0.25, 0.9);
      } else if (kind === EDGE.RAIL && r.next() < 0.35) {
        lat = side * (edge + r.range(3, 30));
        size = r.range(0.4, 1.8);
      } else if (kind === EDGE.TREES && r.next() < 0.25) {
        lat = side * (edge + r.range(1.5, 20));
        size = r.range(0.3, 1.1);
      } else continue;
      track.pointAt(s, lat, point);
      if (!ownStretch(s, point.x, point.z)) continue;
      const y = terrain.heightAt(point.x, point.z);
      const v = r.range(0.75, 1.15);
      const warm = r.range(-0.04, 0.04);
      const item = make(point.x, y - size * 0.18, point.z, r.range(0, Math.PI * 2), [size * r.range(0.8, 1.4), size, size * r.range(0.8, 1.3)], [0.16 * v * (1 + warm), 0.155 * v, 0.14 * v * (1 - warm)], size * 1.5, r.range(-0.3, 0.3));
      rockItems.push(item);
    }
  }

  // (forest lane) THE SCHEMES' VERGES AND BOULDERS (trackLayout.js SCHEMES, schemes.js), from their own stream after
  // everything else, so that the rest of the lap is as it was; each fades in and out with the scheme's weight.
  //   verge 'meadow' (frame e2): long grass along the verge, ferns at the wood's edge, patches of yellow flowers
  //   verge 'islands' (frame e5): grass islands with patches of purple and yellow flowers, a few ferns
  //   boulders 'mossy' (e2): boulders among the trunks, mossy on top
  //   boulders 'granite' (e5): pale granite at the roadside, singly, and in outcrops of van-sized blocks with shrubs
  // A boulder stands wholly beyond the solid edge: its middle at least its plan radius beyond it.
  const fernItems = [];
  const flowerItems = [];
  const boulderItems = { round: [], block: [] };
  const boulderGeo = { round: null, block: null };
  {
    const sr = rng.fork('scheme');
    const st = schemeTable(track);
    const pnoise = planeNoise(sr.int(1 << 30));
    const YELLOW = [0.78, 0.56, 0.035];
    const PURPLE = [0.27, 0.11, 0.6];
    // the boulders' shapes (boulders.js; on low the rocks' own), and how far each reaches out in plan per unit of size
    // at the largest scale it is given (1.2)
    boulderGeo.round = tier === 'low' ? null : boulderGeometry(rng.fork('boulder-round'), { detail: tier === 'high' ? 3 : 2, kind: 'round', moss: 0.55 });
    boulderGeo.block = tier === 'low' ? null : boulderGeometry(rng.fork('boulder-block'), { detail: tier === 'high' ? 3 : 2, kind: 'block', moss: 0.2 });
    const planOf = (g) => {
      let r = 1.25; // the rocks' own lumpy ball (boulder() above): at most 1.25
      if (g) {
        r = 0;
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
      }
      return r * 1.2 + 0.15;
    };
    const PLAN = Math.max(planOf(boulderGeo.round), planOf(boulderGeo.block));
    const rocky = (kind, s, side, lat, size, moss) => {
      track.pointAt(s, lat, point);
      if (!ownStretch(s, point.x, point.z)) return false;
      const y = terrain.heightOnTrack(s, lat);
      const v = sr.range(0.85, 1.12);
      const sc = [size * sr.range(0.85, 1.2), size * sr.range(0.85, 1.1), size * sr.range(0.85, 1.15)];
      const tilt = sr.range(-0.12, 0.12);
      if (tier === 'low') {
        // (low: the rocks' own mesh and shape, the granite's tone)
        rockItems.push(make(point.x, y - size * 0.25, point.z, sr.range(0, Math.PI * 2), sc, [0.34 * v, 0.33 * v, 0.31 * v], size * 1.5, tilt));
      } else {
        const item = make(point.x, y - size * (kind === 'block' ? 0.2 : 0.3), point.z, sr.range(0, Math.PI * 2), sc, [v, v, v * (moss > 0.5 ? 0.97 : 1)], size * 1.5, tilt);
        boulderItems[kind].push(item);
      }
      return true;
    };
    for (const run of st.runs) {
      const def = run.def;
      const blend = def.blend ?? 80;
      const len = track.wrap(run.s1 - run.s0);
      for (const side of [1, -1]) {
        const kinds = side > 0 ? track.kindL : track.kindR;
        // the verge: long grass, ferns, flowers
        if (def.verge && T.grass > 0) {
          for (let d = -blend; d < len + blend; d += 0.35) {
            const s = track.wrap(run.s0 + d);
            const sch = schemeAt(track, s);
            if (!sch || sch.def !== def) continue;
            const w = sch.w;
            const edge = track.edgeAt(s, side);
            const i = Math.round(s / track.ds) % track.count;
            // (only beside the woods: not where a rock face, a wall or a structure begins)
            if (kinds[i] !== EDGE.RAIL && kinds[i] !== EDGE.TREES) continue;
            const behind = kinds[i] === EDGE.RAIL || kinds[i] === EDGE.TREES ? 6 : 0;
            const roll = sr.next();
            if (roll < 0.45 * w) {
              // long grass, taller towards the wood
              const lat = side * sr.range(pave + 0.35, edge + behind * 0.5);
              const g = groundAt(s, lat, side);
              if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
              track.pointAt(s, lat, point);
              if (!ownStretch(s, point.x, point.z)) continue;
              const out = (Math.abs(lat) - pave) / Math.max(1, edge - pave);
              const h = sr.range(0.35, 0.6) + 0.35 * Math.min(1, out) * sr.next();
              const dry = sr.next() ** 3;
              const v = sr.range(0.95, 1.35);
              grassItems.push(make(point.x, g.y - 0.03, point.z, sr.range(0, Math.PI), [h * 1.8, h, h * 1.8], GRASS.tuft.map((c, k) => (c + (GRASS.tuftDry[k] - c) * dry) * v), h));
            } else if (roll < (def.verge === 'meadow' ? 0.62 : 0.52) * w) {
              // flowers, in patches
              const patch = pnoise.fbm(s / 7 + side * 31, 2.2, 3);
              if (patch < (def.verge === 'meadow' ? 0.56 : 0.5)) continue;
              const lat = side * sr.range(pave + 0.6, edge + behind * 0.4);
              const g = groundAt(s, lat, side);
              if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
              track.pointAt(s, lat, point);
              if (!ownStretch(s, point.x, point.z)) continue;
              const purple = def.verge === 'islands' && pnoise.fbm(s / 23 + side * 3, 9.1, 2) > 0.48;
              const col = purple ? PURPLE : YELLOW;
              const v = sr.range(0.8, 1.15);
              const h = sr.range(0.35, 0.65);
              flowerItems.push(make(point.x, g.y - 0.02, point.z, sr.range(0, Math.PI), [h * 1.3, h, h * 1.3], col.map((c) => c * v), h));
            } else if (roll < (def.verge === 'meadow' ? 0.74 : 0.57) * w) {
              // ferns, at the wood's edge and under the first trees
              if (!behind) continue;
              const lat = side * (edge + sr.range(-1.2, behind));
              track.pointAt(s, lat, point);
              if (!ownStretch(s, point.x, point.z)) continue;
              const y = groundAt(s, lat, side).y;
              const h = sr.range(0.55, 1.05);
              const v = sr.range(1.0, 1.5);
              fernItems.push(make(point.x, y - 0.05, point.z, sr.range(0, Math.PI), [h * 1.5, h, h * 1.5], GRASS.bush.map((c, k) => c * v * (k === 1 ? 1.12 : 1)), h));
            }
          }
        }
        // the boulders
        if (def.boulders) {
          const granite = def.boulders === 'granite';
          let next = sr.range(0, 6);
          for (let d = -blend; d < len + blend; d += next) {
            next = granite ? sr.range(5, 12) : sr.range(5, 11);
            const s = track.wrap(run.s0 + d);
            const sch = schemeAt(track, s);
            if (!sch || sch.def !== def || sr.next() >= sch.w) continue;
            if (inRanges(s, track.tunnels, 20) || inRanges(s, track.bridges, 4)) continue;
            const ki = kinds[Math.round(s / track.ds) % track.count];
            if (ki !== EDGE.RAIL && ki !== EDGE.TREES) continue;
            const edge = track.edgeAt(s, side);
            const outcrop = granite && sr.next() < 0.22;
            if (outcrop) {
              // an outcrop: a few big blocks leaning together, the biggest van-sized, shrubs at their feet
              const n = sr.int(3) + 3;
              const back = sr.range(0.3, 4);
              for (let k = 0; k < n; k++) {
                const size = k === 0 ? sr.range(2.4, 3.4) : sr.range(1.0, 2.4);
                const lat = side * (edge + size * PLAN + back + sr.range(0, 3.5) * (k > 0 ? 1 : 0));
                rocky(k === 0 || sr.next() < 0.5 ? 'block' : 'round', track.wrap(s + sr.range(-3.5, 3.5) * (k > 0 ? 1 : 0)), side, lat, size, 0.25);
              }
              if (T.bushes) {
                for (let k = 0; k < 4; k++) {
                  const ss = track.wrap(s + sr.range(-7, 7));
                  const lat = side * (edge + sr.range(0.8, 7));
                  track.pointAt(ss, lat, point);
                  if (!ownStretch(ss, point.x, point.z)) continue;
                  const h = sr.range(0.7, 1.6);
                  const v = sr.range(0.65, 1.0);
                  bushItems.push(make(point.x, terrain.heightOnTrack(ss, lat) - 0.1, point.z, sr.range(0, Math.PI), [h * 1.5, h, h * 1.5], GRASS.bush.map((c) => c * v), h));
                }
              }
              continue;
            }
            // single boulders: at the roadside (granite), or among the trunks (mossy); now and then two together
            const size = granite ? sr.range(0.6, 2.0) : sr.range(0.6, 1.8);
            const lat = side * (edge + size * PLAN + (granite ? sr.range(0.05, 2.5) : sr.range(1, 12)));
            rocky(sr.next() < 0.3 ? 'block' : 'round', s, side, lat, size, granite ? 0.25 : 0.75);
            if (sr.next() < 0.35) {
              const size2 = size * sr.range(0.4, 0.8);
              rocky('round', track.wrap(s + sr.range(1.2, 2.6)), side, lat + side * sr.range(0.3, 1.5), size2, granite ? 0.25 : 0.75);
            }
            if (granite && T.bushes && sr.next() < 0.6) {
              const ss = track.wrap(s + sr.range(-3, 3));
              const latB = side * (edge + sr.range(0.6, 4));
              track.pointAt(ss, latB, point);
              if (ownStretch(ss, point.x, point.z)) {
                const h = sr.range(0.6, 1.3);
                const v = sr.range(0.65, 1.0);
                bushItems.push(make(point.x, terrain.heightOnTrack(ss, latB) - 0.1, point.z, sr.range(0, Math.PI), [h * 1.5, h, h * 1.5], GRASS.bush.map((c) => c * v), h));
              }
            }
          }
        }
      }
    }
  }

  const coverMaterial = plantMaterial({ map: texture, atmosphere, uniforms, wind: { height: 1, sway: 0.04 } });
  const rockMaterial = plantMaterial({ map: null, atmosphere, uniforms, wind: null, flat: true });
  const parts = [];
  // (finish lane) three cards a tuft, not two: two crossed cards read as flat cut-outs from most angles along the road
  // (forest lane) the cover texture is four tiles wide now: grass, bush, fern, flowers
  if (grassItems.length) parts.push(scatter({ geometry: cards(3, 1, 1, 0.01, 0.24), material: coverMaterial, items: grassItems, reach: T.grassReach, name: 'cover-grass', group }));
  if (bushItems.length) parts.push(scatter({ geometry: cards(3, 1, 1, 0.26, 0.49), material: coverMaterial, items: bushItems, reach: T.bushReach, name: 'cover-bushes', group }));
  if (fernItems.length) parts.push(scatter({ geometry: cards(3, 1, 1, 0.51, 0.74), material: coverMaterial, items: fernItems, reach: T.bushReach * 0.7, name: 'cover-ferns', group }));
  if (flowerItems.length) parts.push(scatter({ geometry: cards(2, 1, 1, 0.76, 0.99), material: coverMaterial, items: flowerItems, reach: T.grassReach * 1.6, name: 'cover-flowers', group }));
  const rocks = scatter({ geometry: boulder(rng.fork('boulder')), material: rockMaterial, items: rockItems, reach: T.rockReach, name: 'cover-rocks', group });
  rocks.mesh.castShadow = tier !== 'low';
  parts.push(rocks);
  // (forest lane) the schemes' boulders, painted granite (boulders.js), on medium and high (low draws them as rocks)
  const boulderMaterial = plantMaterial({ map: null, atmosphere, uniforms, wind: null, flat: true, vertexColors: true });
  for (const [kind, items] of [
    ['round', boulderItems.round],
    ['block', boulderItems.block],
  ]) {
    if (!items.length || !boulderGeo[kind]) continue;
    const geometry = boulderGeo[kind];
    const part = scatter({ geometry, material: boulderMaterial, items, reach: T.rockReach, name: `cover-boulders-${kind}`, group });
    part.mesh.castShadow = true;
    parts.push(part);
  }
  // (forest lane) the bend-warning signs
  const signMaterial = plantMaterial({ map: null, atmosphere, uniforms, wind: null, flat: true, twoSided: true });
  const signs = createBendSigns({ track, terrain, material: signMaterial });
  group.add(signs.group);

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const stats = { grass: grassItems.length, bushes: bushItems.length, rocks: rockItems.length, ferns: fernItems.length, flowers: flowerItems.length, boulders: boulderItems.round.length + boulderItems.block.length, signs: signs.count, view: {}, ms: Math.round(performance.now() - started) };
  return {
    group,
    stats,
    prepareView(camera) {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      eye.setFromMatrixPosition(camera.matrixWorld);
      for (const p of parts) stats.view[p.mesh.name] = p.prepare(frustum, eye);
    },
    dispose() {
      for (const p of parts) p.mesh.geometry.dispose();
      coverMaterial.dispose();
      rockMaterial.dispose();
      boulderMaterial.dispose();
      signMaterial.dispose();
      signs.dispose();
      texture.dispose();
    },
  };
}
