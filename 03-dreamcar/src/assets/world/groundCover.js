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
import { LAKESIDE } from './lakeside.js';
import { APPROACH, approachAt, approachesOf, beforeFace, meadowAt } from './approach.js';
import { GOLDWOOD, goldwoodOf } from './goldwood.js';
import { ARM } from './arm.js';

const SURFACE_GRASS = 2;
const EDGE = { RAIL: 0, ROCK: 1, WALL: 2, PARAPET: 3, TREES: 4 };

/** Per tier: grass tufts per metre of road and side, their reach (m); bushes' reach; rocks' reach. */
const TIER = {
  low: { grass: 0, grassReach: 0, bushes: false, bushReach: 0, rockReach: 160 },
  medium: { grass: 2.2, grassReach: 38, bushes: true, bushReach: 75, rockReach: 260 },
  high: { grass: 3.2, grassReach: 48, bushes: true, bushReach: 95, rockReach: 340 },
};

/**
 * The lakeside's own growth (lakeside.js; the photograph r2), per tier: patches of flowers per metre of road and
 * their reach (m), outcrops per 10 m of the bank, low bushes per metre. (Its long grass: LAKESIDE_LONG below.)
 */
const LAKESIDE_COVER = {
  low: { flowers: 0, flowerReach: 0, outcrops: 2.4, bushes: 0 },
  medium: { flowers: 2.6, flowerReach: 34, outcrops: 3.4, bushes: 1.1 },
  high: { flowers: 3.2, flowerReach: 44, outcrops: 4, bushes: 1.5 },
};
/**
 * The lakeside's long grass is the approach meadow's cards (MEADOW, `cover-meadow`): their tint here (the meadow's
 * green warmed towards the photograph's yellow-green), and how many a metre of road against the approach's.
 */
const LAKESIDE_LONG = [1.3, 1.02, 0.6];
const LAKESIDE_LONG_SHARE = 2;
/** Flowers, linear albedo: dandelion yellow, and the white of anemones under the rail. */
const FLOWER = { yellow: [0.8, 0.52, 0.02], white: [0.72, 0.72, 0.62] };

/**
 * (ref lane) The tall grass of the meadow on a tunnel's approach (approach.js), per tier: tufts per metre of road and
 * side, and their reach (m). The low tier keeps a few, near: the place is not the place without them.
 */
const MEADOW = {
  low: { grass: 2.5, reach: 30, wall: 2 },
  medium: { grass: 12, reach: 42, wall: 10 },
  high: { grass: 16, reach: 52, wall: 14 },
};

/** A linear colour as a canvas colour. */
const css = (c, k = 1) => `rgb(${c.map((v) => Math.round(255 * Math.min(1, Math.max(0, v * k)) ** (1 / 2.2))).join(',')})`;

/**
 * The meadow's grass, three tufts side by side (a card each): tall blades in the meadow's own green (GRASS.alp),
 * yellowing upwards, with straw seed heads; the third with a few flowers. Painted in its own colours (the cards keep
 * them: aShade.y = 1).
 */
function meadowTexture(rng) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.lineCap = 'round';
  const third = size / 3;
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const STRAW = [0.66, 0.56, 0.2];
  for (let col = 0; col < 3; col++) {
    const cx = (col + 0.5) * third;
    const blades = col === 1 ? 46 : 36;
    for (let k = 0; k < blades; k++) {
      const x = cx + rng.range(-1, 1) * rng.range(4, third * 0.4);
      const tall = k % 3 === 0;
      const hgt = (tall ? rng.range(0.74, 0.97) : rng.range(0.3, 0.72)) * size * (col === 1 ? 0.8 : 1);
      const bend = (x - cx) * rng.range(0.1, 0.5) + rng.range(-7, 7);
      const v = rng.range(0.75, 1.3);
      // the blade in three pieces, greener low down and yellower towards its tip
      let px = x;
      let py = size;
      for (let seg = 1; seg <= 3; seg++) {
        const f = seg / 3;
        const qx = Math.min((col + 1) * third - 3, Math.max(col * third + 3, x + bend * f * f));
        const qy = size - hgt * f;
        ctx.strokeStyle = css(mix(GRASS.alp, mix(GRASS.alpSeed, STRAW, 0.4), 0.2 + 0.6 * f), v * (1.25 + 0.5 * f));
        ctx.lineWidth = (tall ? 1.5 : 2.1) * (1.15 - 0.5 * f);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
        px = qx;
        py = qy;
      }
      if (tall) {
        // a seed head: a long pale straw ear at the tip
        ctx.fillStyle = css(mix(STRAW, GRASS.alpSeed, rng.range(0.1, 0.4)), rng.range(0.85, 1.15));
        ctx.beginPath();
        ctx.ellipse(px, py + 5, 2.1, rng.range(7, 12), Math.atan2(bend, hgt) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (col === 2) {
      // a few flowers among the blades: white with a yellow eye, yellow, one violet
      for (const [fx, fy, r, c] of [
        [-16, 0.52, 3.6, [0.85, 0.85, 0.8]],
        [9, 0.66, 3.2, [0.85, 0.85, 0.8]],
        [20, 0.42, 3.0, [0.8, 0.62, 0.05]],
        [-5, 0.36, 2.8, [0.8, 0.62, 0.05]],
        [-24, 0.3, 2.6, [0.3, 0.12, 0.5]],
      ]) {
        const x = cx + fx;
        const y = size * (1 - fy);
        ctx.strokeStyle = css(GRASS.alp, 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rng.range(-3, 3), size);
        ctx.stroke();
        ctx.fillStyle = css(c);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (c[2] > 0.7) {
          ctx.fillStyle = css([0.8, 0.6, 0.05]);
          ctx.beginPath();
          ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  const { levels } = alphaMips(ctx.getImageData(0, 0, size, size).data, size, size, {
    regions: [0, 1, 2].map((col) => [Math.round(col * third), 0, Math.round((col + 1) * third), size]),
  });
  return chainTexture(levels);
}

/** A small canvas: grass blades (left half) and a leafy bush (right half). Drawn pale; tinted per instance. */
function coverTexture(rng) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
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
  // (trees lane) mip levels that keep each half's coverage at the cut, as the trees' atlas does: no thinning and no
  // crawling edges at a distance, on the tiers whose alpha is a plain cut
  const { levels } = alphaMips(ctx.getImageData(0, 0, size, size).data, size, size, {
    regions: [
      [0, 0, size / 2, size],
      [size / 2, 0, size, size],
    ],
  });
  return chainTexture(levels);
}

/** Crossed upright cards standing on y = 0, `n` of them, `w` wide and `h` tall, picturing [u0, u1] of the map. */
function cards(n, w, h, u0, u1, { own = 0, strips = false } = {}) {
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
    // (`strips`: each card pictures its own share of [u0, u1], so a plant of n cards shows n drawings)
    const ua = strips ? u0 + ((u1 - u0) * (q + 0.02)) / n : u0;
    const ub = strips ? u0 + ((u1 - u0) * (q + 0.98)) / n : u1;
    for (const [s, y, u, v, ao] of [
      [-1, 0, ua, 1, 0.55],
      [1, 0, ub, 1, 0.55],
      [1, h, ub, 0, 1],
      [-1, h, ua, 0, 1],
    ]) {
      pos.push(dx * s, y, dz * s);
      // lit like the ground it grows from
      nor.push(dx * s * 0.15, 1, dz * s * 0.15);
      uv.push(u, v);
      shade.push(ao, own);
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
 * A patch of flowers: a few small heads on a hand's breadth of ground, each a little diamond lying nearly flat at
 * the top of its stalk's height, turned up a little towards one side. No stalks (they are thinner than a pixel).
 */
function flowers(rng) {
  const pos = [];
  const nor = [];
  const shade = [];
  const index = [];
  for (let k = 0; k < 7; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 0.5;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = rng.range(0.1, 0.3);
    const size = rng.range(0.045, 0.07);
    const tilt = rng.range(0, Math.PI * 2);
    const tx = Math.cos(tilt) * 0.5;
    const tz = Math.sin(tilt) * 0.5;
    const base = pos.length / 3;
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      pos.push(cx + dx * size, y + (dx * tx + dz * tz) * size, cz + dz * size);
      nor.push(-tx * 0.5, 1, -tz * 0.5);
      shade.push(1, 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 2));
  g.setIndex(index);
  return g;
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

  const goldwood = goldwoodOf(track);
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
        const tuft = make(point.x, g.y - 0.03, point.z, r.range(0, Math.PI), [h * 2.2, h, h * 2.2], tint, h);
        // (ref lane: the circuit's own dark tufts give way to the meadow's tall grass on a tunnel's approach)
        // (nor on the lakeside's stretch, whose verge is the long meadow grass)
        // (nor in the golden wood, whose verge is pale grass under leaves)
        if (!((terrain.placeAt?.(point.x, point.z)?.meadow ?? 0) > 0.5) && !((terrain.lakeside?.stretch(s) ?? 0) > 0.5) && !goldwood?.here(s) && !terrain.arm?.opens(s, side)) grassItems.push(tuft);
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
        // (on the lakeside's meadow the lap's own bushes are the meadow's: lit, warm, not the wood's dark green)
        // (in the golden wood they have turned with it: ochre and rust, not the wood's dark green)
        const lit = terrain.arm?.opens(s, side) ? ARM.bush : terrain.lakeside?.open(s, side) ? [5, 4.2, 2.6] : goldwood?.here(s) ? GOLDWOOD.bush : [1, 1, 1];
        const bush = make(point.x, y - 0.1, point.z, r.range(0, Math.PI), [h * 1.4, h, h * 1.4], GRASS.bush.map((c, k) => c * v * lit[k]), h);
        // (ref lane: none on a tunnel's meadow, which is open grass to the fence; the numbers are drawn all the same)
        if (!((terrain.placeAt?.(point.x, point.z)?.meadow ?? 0) > 0.5)) bushItems.push(bush);
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
      // (ref lane: no fallen rock at the foot of the low walls on a tunnel's approach; the numbers are drawn all the same)
      if (!(kind === EDGE.ROCK && (approachAt(track, s)?.k ?? 0) > 0.5)) rockItems.push(item);
    }
  }

  // (ref lane) the tall grass of the meadows on the tunnels' approaches: thick on the verge's outer part and for a
  // dozen metres behind the barrier, from before the place begins to the portal's hood
  const meadowItems = [];
  const MT = MEADOW[tier] ?? MEADOW.high;
  {
    const mr = rng.fork('meadow');
    for (const A of approachesOf(track)) {
      for (const side of [1, -1]) {
        for (let s = A.s0 - APPROACH.open - 20; s < A.s0 - APPROACH.hood.depth - 0.5; s += 1 / MT.grass) {
          const where = mr.next();
          const far = mr.next();
          const size = mr.range(0.55, 1);
          const yaw = mr.range(0, Math.PI);
          const jitter = mr.range(-0.4, 0.4);
          const shade = mr.range(0.5, 1.5);
          const sw = track.wrap(s + jitter);
          const edge = track.edgeAt(sw, side);
          const c = terrain.cliffAt(sw, side);
          // a third on the verge (its outer part: the mown strip by the road stays), the rest behind the barrier
          const onVerge = where < 0.34;
          const lat = side * (onVerge ? pave + 0.5 + (edge - pave - 0.7) * Math.sqrt(far) : edge + c.top + 0.25 + 12 * far ** 1.6);
          const beyond = Math.max(0, Math.abs(lat) - edge);
          if (mr.next() > meadowAt(A, side, beforeFace(track, A, sw), beyond)) continue;
          const g = groundAt(sw, lat, side);
          if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
          track.pointAt(sw, lat, point);
          if (!ownStretch(sw, point.x, point.z)) continue;
          const h = (onVerge ? 0.6 : 0.95) * size;
          meadowItems.push(make(point.x, g.y - 0.05, point.z, yaw, [h * 1.5, h, h * 1.5], [shade, shade, shade], h));
        }
        // and a wall of it, taller, from the verge's outer edge to the fence: `wall` more a metre (the photograph's
        // right foreground; on the other side it stands before the low wall)
        for (let s = A.s0 - APPROACH.open - 20; s < A.s0 - APPROACH.hood.depth - 0.5; s += 1 / MT.wall) {
          const across = mr.next();
          const size = mr.range(0.85, 1.3);
          const yaw = mr.range(0, Math.PI);
          const shade = mr.range(0.8, 1.5);
          const keep = mr.next();
          const sw = track.wrap(s + mr.range(-0.4, 0.4));
          const edge = track.edgeAt(sw, side);
          const lat = side * (edge - 1.1 + 3.6 * across);
          const beyond = Math.max(0, Math.abs(lat) - edge);
          // (not in the wall itself, nor in the first step behind it)
          if (beyond > 0 && beyond < terrain.cliffAt(sw, side).top + 0.2) continue;
          if (keep > meadowAt(A, side, beforeFace(track, A, sw), beyond)) continue;
          const g = groundAt(sw, lat, side);
          if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
          track.pointAt(sw, lat, point);
          if (!ownStretch(sw, point.x, point.z)) continue;
          const h = 1.05 * size;
          meadowItems.push(make(point.x, g.y - 0.05, point.z, yaw, [h * 1.3, h, h * 1.3], [shade, shade, shade], h));
        }
      }
    }
  }

  // THE LAKESIDE (lakeside.js; the photograph r2), from a stream of its own so that nothing else on the lap moves:
  // tall grass against the rail on the lake's side and along the foot and the lip of the cut, flowers in it, and
  // outcrops of rock in the bank (boulders sunk deep, in groups: the same faceted stone as the rest of the lap's).
  const flowerItems = [];
  const lakeside = terrain.lakeside;
  if (lakeside) {
    const lr = rng.fork('lakeside');
    const C = LAKESIDE_COVER[tier] ?? LAKESIDE_COVER.medium;
    const s0 = lakeside.s0;
    const span = LAKESIDE.to - LAKESIDE.from;
    const sAt = () => track.wrap(s0 + LAKESIDE.from + lr.range(0, span));
    const flower = (s, lat, side, kind) => {
      const g = groundAt(s, lat, side);
      if (g.surface >= 0 && g.surface !== SURFACE_GRASS) return;
      track.pointAt(s, lat, point);
      const k = lr.range(0.8, 1.6);
      flowerItems.push(make(point.x, g.y, point.z, lr.range(0, Math.PI * 2), [k, k, k], FLOWER[kind].map((c) => c * lr.range(0.85, 1.1)), 0.8));
    };
    // The long grass is the approach meadow's (the `cover-meadow` cards above: tall blades with pale seed heads,
    // painted in their own colours), warmed towards the photograph's yellow-green: on the lake's side a continuous
    // band from the paved margin to a little beyond the rail, and on down the bank to the water, thinning; on the
    // land's side at the cut's foot and on its lip. (The first round's dark tufts of the lap's own grass are gone.)
    const long = (s, lat, side, h) => {
      const g = groundAt(s, lat, side);
      if (g.surface >= 0 && g.surface !== SURFACE_GRASS) return;
      if (g.y < lakeside.level + 0.2) return;
      track.pointAt(s, lat, point);
      const shade = lr.range(0.75, 1.35);
      meadowItems.push(make(point.x, g.y - 0.05, point.z, lr.range(0, Math.PI), [h * 1.5, h, h * 1.5], LAKESIDE_LONG.map((c) => c * shade), h));
    };
    const perMetre = MT.grass * LAKESIDE_LONG_SHARE;
    for (let i = 0; i < span * perMetre; i++) {
      const s = sAt();
      const edge = track.edgeAt(s, 1);
      const where = lr.next();
      const far = lr.next();
      const size = lr.range(0.55, 1);
      // half in the band at the rail, the rest down the bank, fewer and shorter the further down
      if (where < 0.5) long(s, pave + 0.35 + (edge + 2.2 - pave - 0.35) * far, 1, 0.8 * size);
      else long(s, edge + 2.2 + 32 * far ** 1.25, 1, (0.8 - 0.35 * far) * size);
    }
    for (let i = 0; i < span * perMetre * 0.45; i++) {
      const s = sAt();
      const edge = track.edgeAt(s, -1);
      const c = terrain.cliffAt(s, -1);
      const foot = lr.next() < 0.35;
      long(s, -(foot ? lr.range(pave + 0.3, edge - 0.1) : edge + c.top + lr.range(0.2, 5)), -1, lr.range(0.4, foot ? 0.6 : 0.8));
    }
    for (let i = 0; i < span * C.flowers; i++) {
      const s = sAt();
      const left = lr.next() < 0.5;
      if (left) {
        const edge = track.edgeAt(s, 1);
        flower(s, Math.max(pave + 0.3, edge + lr.range(-2.4, 2.5)), 1, lr.next() < 0.75 ? 'yellow' : 'white');
      } else {
        const edge = track.edgeAt(s, -1);
        const c = terrain.cliffAt(s, -1);
        const foot = lr.next() < 0.5;
        flower(s, -(foot ? lr.range(pave + 0.3, edge - 0.15) : edge + c.top + lr.range(0.3, 4)), -1, 'yellow');
      }
    }
    // low bushes down the bank to the water and along the shore, and on the land's bank among the outcrops
    for (let i = 0; i < span * C.bushes; i++) {
      const s = sAt();
      const left = lr.next() < 0.7;
      const side = left ? 1 : -1;
      const edge = track.edgeAt(s, side);
      const lat = side * (edge + (left ? lr.range(1.5, 34) : terrain.cliffAt(s, -1).top + lr.range(1, 16)));
      track.pointAt(s, lat, point);
      const y = terrain.heightAt(point.x, point.z);
      if (y < lakeside.level + 0.15) continue;
      const h = lr.range(0.5, 1.2);
      const v = lr.range(2.4, 3.4);
      if (lr.next() < 0.6) continue;
      bushItems.push(make(point.x, y - 0.1, point.z, lr.range(0, Math.PI), [h * 1.5, h, h * 1.5], GRASS.bush.map((c, k) => c * v * [1.1, 0.95, 0.6][k]), h));
    }
    // outcrops in the bank on the right: groups of two to four stones, the largest a couple of metres across,
    // sunk to their shoulders; and a few on the bank above the water
    const groups = Math.round((span / 10) * C.outcrops);
    for (let i = 0; i < groups; i++) {
      const right = lr.next() < 0.8;
      const s = sAt();
      const side = right ? -1 : 1;
      const edge = track.edgeAt(s, side);
      const c = terrain.cliffAt(s, side);
      const lat = side * (edge + (right ? c.top + lr.range(0.6, 15) : lr.range(4, 22)));
      const count = 2 + lr.int(3);
      const big = lr.range(1.0, right ? 2.6 : 1.5);
      for (let k = 0; k < count; k++) {
        const size = k === 0 ? big : big * lr.range(0.35, 0.7);
        const ss = s + (k === 0 ? 0 : lr.range(-1, 1) * big * 1.4);
        const ll = lat + (k === 0 ? 0 : lr.range(-1, 1) * big * 1.2);
        if (Math.abs(ll) < track.edgeAt(ss, side) + c.top + 0.4) continue;
        track.pointAt(ss, ll, point);
        const y = terrain.heightAt(point.x, point.z);
        const v = lr.range(0.85, 1.25);
        const warm = lr.range(-0.03, 0.05);
        rockItems.push(make(point.x, y - size * 0.35, point.z, lr.range(0, Math.PI * 2), [size * lr.range(1, 1.5), size * lr.range(1.1, 1.7), size * lr.range(0.9, 1.3)], [0.2 * v * (1 + warm), 0.195 * v, 0.18 * v * (1 - warm)], size * 1.7, lr.range(-0.25, 0.25)));
      }
    }
  }

  // THE ARM OF THE LAKE (arm.js; the photograph r4), from a stream of its own: the long grass of the meadow (the
  // same cards) along the left verge's outer part, thick against the barrier and the fence, and on down the bank
  // towards the water, thinning.
  const arm = terrain.arm;
  if (arm) {
    const ar = rng.fork('arm');
    const span = ARM.open[1] - ARM.open[0];
    const count = Math.round(span * MT.grass * ARM.grass.share);
    for (let i = 0; i < count; i++) {
      const s = track.wrap(arm.s0 + ARM.open[0] + ar.range(0, span));
      const where = ar.next();
      const far = ar.next();
      const size = ar.range(0.55, 1);
      const yaw = ar.range(0, Math.PI);
      const shade = ar.range(0.75, 1.35);
      if (inRanges(s, track.bridges, 2)) continue;
      const edge = track.edgeAt(s, 1);
      const lat = where < 0.55 ? edge - 1.6 + 5.4 * far : edge + 3.8 + 40 * far ** 1.5;
      if (lat < pave + 1.2) continue;
      const g = groundAt(s, lat, 1);
      if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
      if (g.y < arm.level + 0.3) continue;
      track.pointAt(s, lat, point);
      if (!ownStretch(s, point.x, point.z)) continue;
      const h = (where < 0.55 ? 0.8 : 0.8 - 0.3 * far) * size;
      meadowItems.push(make(point.x, g.y - 0.05, point.z, yaw, [h * 1.5, h, h * 1.5], ARM.grass.tint.map((c) => c * shade), h));
    }
  }

  // THE GOLDEN WOOD (goldwood.js; the photograph r3), from a stream of its own: long pale grass, bleached and gone
  // to seed (the approach meadow's cards), along the outer part of both verges and against the barrier's foot. The
  // strip by the kerb stays short under its drift of leaves.
  if (goldwood) {
    const gr = rng.fork('goldwood');
    const G = GOLDWOOD;
    const perMetre = MT.grass * G.grass.share;
    for (const side of [1, -1]) {
      for (let d = G.from; d < G.to; d += 1 / perMetre) {
        const where = gr.next();
        const size = gr.next();
        const yaw = gr.range(0, Math.PI);
        const shade = gr.range(0.7, 1.3);
        const s = track.wrap(goldwood.s0 + d + gr.range(-0.4, 0.4));
        if (!goldwood.here(s)) continue;
        const edge = track.edgeAt(s, side);
        // most of it in the last metre and a half before the barrier and just behind it, the rest thinning inwards
        const lat = side * (where < 0.7 ? edge - 1.5 + 2.4 * ((where / 0.7) ** 0.8) : pave + 1.6 + (edge - pave - 3) * ((where - 0.7) / 0.3));
        if (Math.abs(lat) < pave + 1.5) continue;
        const g = groundAt(s, lat, side);
        if (g.surface >= 0 && g.surface !== SURFACE_GRASS) continue;
        track.pointAt(s, lat, point);
        if (!ownStretch(s, point.x, point.z)) continue;
        const h = G.grass.height[0] + (G.grass.height[1] - G.grass.height[0]) * size;
        meadowItems.push(make(point.x, g.y - 0.05, point.z, yaw, [h * 1.5, h, h * 1.5], G.grass.tint.map((c) => c * shade), h));
      }
    }
  }

  const coverMaterial = plantMaterial({ map: texture, atmosphere, uniforms, wind: { height: 1, sway: 0.04 } });
  const rockMaterial = plantMaterial({ map: null, atmosphere, uniforms, wind: null, flat: true });
  const parts = [];
  // (finish lane) three cards a tuft, not two: two crossed cards read as flat cut-outs from most angles along the road
  if (grassItems.length) parts.push(scatter({ geometry: cards(3, 1, 1, 0.02, 0.48), material: coverMaterial, items: grassItems, reach: T.grassReach, name: 'cover-grass', group }));
  if (bushItems.length) parts.push(scatter({ geometry: cards(3, 1, 1, 0.52, 0.98), material: coverMaterial, items: bushItems, reach: T.bushReach, name: 'cover-bushes', group }));
  const rocks = scatter({ geometry: boulder(rng.fork('boulder')), material: rockMaterial, items: rockItems, reach: T.rockReach, name: 'cover-rocks', group });
  rocks.mesh.castShadow = tier !== 'low';
  parts.push(rocks);
  if (flowerItems.length) parts.push(scatter({ geometry: flowers(rng.fork('flowers')), material: rockMaterial, items: flowerItems, reach: (LAKESIDE_COVER[tier] ?? LAKESIDE_COVER.medium).flowerReach, name: 'cover-flowers', group }));
  let meadowMap = null;
  let meadowMaterial = null;
  if (meadowItems.length) {
    meadowMap = meadowTexture(rng.fork('meadow-texture'));
    meadowMaterial = plantMaterial({ map: meadowMap, atmosphere, uniforms, wind: { height: 1, sway: 0.07 } });
    parts.push(scatter({ geometry: cards(3, 1, 1, 0, 1, { own: 0.5, strips: true }), material: meadowMaterial, items: meadowItems, reach: MT.reach, name: 'cover-meadow', group }));
  }

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const stats = { grass: grassItems.length, bushes: bushItems.length, rocks: rockItems.length, flowers: flowerItems.length, meadow: meadowItems.length, view: {}, ms: Math.round(performance.now() - started) };
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
      texture.dispose();
      meadowMaterial?.dispose();
      meadowMap?.dispose();
    },
  };
}
