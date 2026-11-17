// The forest: six species (treeSpecies.js) grown at start-up into eight
// individuals (treeGeometry.js), planted from the Track and the ground, drawn
// at three levels of detail.
//
// WHERE TREES STAND is asked of one function, woodAt(track, s, side): is the
// land beside the road wooded here, with which mix (broadleaf, conifer,
// mixed), how much of it has turned, and from how far out. Today it answers
// from the sides whose solid edge is TREES, from a few metres behind the
// edge; a Track that has `woodAt(s, side)` ('broadleaf' | 'conifer' | 'mixed'
// | null) answers for itself. The first 2 m behind any barrier stay free. The
// mass of the forest away from the road is planted where terrain.forestAt
// says it stands, and is asked the same question at the nearest point of the
// road (its turned share fading with distance from it). A keep-out callback
// (the start area, the town) is honoured everywhere.
//
// THE SEASON is early autumn: turnedAt() is how much of the wood has turned
// at a place on the lap, high round the start, in groups here and there. A
// tree turns or not by its species' readiness (treeSpecies.js `turns`).
//
// LEVELS OF DETAIL, chosen per tree for each view from its distance:
//   full     the whole grown tree, limbs and every leaf cluster (not on low)
//   reduced  main limbs and a few large cards
//   impostor one card turned to the eye, showing pictures baked at start-up
//            from the real trees with their normals (impostors.js)
// On the multisampled tiers neighbouring levels cross-fade by coverage over a
// band of a few metres; on low they swap at a distance, hidden in the rows.
//
// DRAW CALLS: one InstancedMesh per variant and level (8 + 8 + 1, plus one
// of shadow-only impostor cards), written per view. The wet road's mirror and the car's
// reflection probe see the reduced trees and the impostors only (each mesh
// checks in onBeforeRender which camera draws it). Shadows: impostor cards
// of the trees round the car turned to the sun, in its shadow pass only (a layer
// no view camera sees), on medium and high.
//
// Wind: update()'s clock moves every level the same way (treeMaterial.js).

import * as THREE from 'three';
import { createBarkTextures, createFoliageAtlas } from './forestTextures.js';
import { layBy } from './gantry.js';
import { bakeImpostors } from './impostors.js';
import { planeNoise, smoothstep } from './shading.js';
import { growTrees } from './treeGeometry.js';
import { createTreeUniforms, impostorDepthMaterial, impostorMaterial, treeDepthMaterial, treeMaterial } from './treeMaterial.js';
import { SPECIES, SPECIES_DATA, VARIANTS, VARIANTS_OF } from './treeSpecies.js';

/** The Track's edge kind TREES (game/track.js EDGE.TREES; assets/ does not import game/). */
const EDGE_TREES = 4;
/** What stays free behind a barrier (m). */
const BARRIER_CLEAR = 2;
/** The layer of the shadow-only proxies: the sun's shadow camera sees it, no view camera does. */
export const CASTER_LAYER = 3;

/**
 * Per tier: full detail out to (m), reduced detail out to, impostors out to, share of the general forest kept,
 * foliage tile and bark tile (texels), impostor picture (texels), whether trees cast shadow.
 */
const TIER = {
  low: { full: 0, reduced: 60, far: 650, keep: 0.5, tile: 256, bark: 128, cell: 64, casters: false },
  medium: { full: 42, reduced: 105, far: 900, keep: 0.8, tile: 512, bark: 256, cell: 128, casters: true },
  high: { full: 65, reduced: 160, far: 1200, keep: 1, tile: 512, bark: 256, cell: 128, casters: true },
};
/** Width of the band over which two levels cross-fade (m), on the multisampled tiers. */
const BLEND = 8;
/** The general forest's lattice (m). */
const LATTICE = 6.5;
/** The cells prepareView culls by (m). */
const CELL = 64;
/** How far round the car trees cast their shadow at most (m). */
const CAST_REACH = 160;

/**
 * How much of the wood has turned at track distance `s`, 0..1: most of it round the start, groups here and there.
 * @param {object} track @param {ReturnType<typeof planeNoise>} noise @param {number} s
 */
export function turnedAt(track, noise, s) {
  const start = 1 - smoothstep(160, 460, Math.abs(track.delta(0, s)));
  const groups = smoothstep(0.55, 0.72, noise.fbm(s / 140, 7.1, 2));
  return Math.min(1, 0.85 * start + 0.6 * groups + 0.06);
}

/**
 * Is the land beside the road wooded at (s, side)?
 * @param {object} track the Track: kindL/kindR, edgeAt, delta; `woodAt(s, side)` if it has one
 * @param {ReturnType<typeof planeNoise>} noise
 * @param {number} s @param {1|-1} side +1 left, -1 right
 * @returns {{ mix: 'broadleaf'|'conifer'|'mixed', turned: number, from: number } | null} the mix, how much has
 *   turned, and how far from the centre line the trees may begin (m)
 */
export function woodAt(track, noise, s, side) {
  let mix;
  if (typeof track.woodAt === 'function') mix = track.woodAt(s, side);
  else {
    const kinds = side > 0 ? track.kindL : track.kindR;
    mix = kinds[Math.round(s / track.ds) % track.count] === EDGE_TREES ? 'mixed' : null;
  }
  if (!mix) return null;
  return { mix, turned: turnedAt(track, noise, s), from: track.edgeAt(s, side) + BARRIER_CLEAR };
}

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer (the impostors are baked with it)
 * @param {object} options.track
 * @param {object} options.terrain terrain.js
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {boolean} options.coverage the scene target is multisampled
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ reach: number }} options.shadow half the side of the sun's shadow square (m)
 * @param {(x: number, z: number) => boolean} [options.keepOut] true where no tree may stand
 */
export function createForest({ renderer, track, terrain, tier, coverage, rng, atmosphere, shadow, keepOut = () => false }) {
  const started = performance.now();
  const ms = {};
  let clock = started;
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };
  const T = TIER[tier] ?? TIER.high;
  const noise = planeNoise(rng.int(1 << 30));
  const plantRng = rng.fork('plant');

  // ---------------------------------------------------------------- planting
  /** @type {{ x: number, y: number, z: number, variant: number, h: number, rank: number, road: boolean, turned: number, inside: number }[]} */
  const trees = [];
  const HASH = 3;
  const hash = new Map();
  const keyOf = (ix, iz) => ix * 73856093 + iz * 19349663;
  /** True when no trunk stands within r of (x, z). */
  const free = (x, z, r) => {
    const ix = Math.floor(x / HASH);
    const iz = Math.floor(z / HASH);
    const reach = Math.ceil(r / HASH);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const list = hash.get(keyOf(ix + a, iz + b));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if ((list[k] - x) ** 2 + (list[k + 1] - z) ** 2 < r * r) return false;
      }
    }
    return true;
  };
  const occupy = (x, z) => {
    const key = keyOf(Math.floor(x / HASH), Math.floor(z / HASH));
    const list = hash.get(key);
    if (list) list.push(x, z);
    else hash.set(key, [x, z]);
  };

  const spot = { index: -1, s: 0, lat: 0 };
  const lay = layBy(track);
  const near = (s, ranges, margin) => ranges.some((r) => track.delta(r.s0, s) > -margin && track.delta(r.s1, s) < margin);
  const atPortal = (s) => track.tunnels.some((t) => Math.abs(track.delta(t.s0, s)) < 18 || Math.abs(track.delta(t.s1, s)) < 18);
  /** Where nothing may grow: on any stretch's corridor and the first metres behind its edge, the portals, round the deck, the lay-by, the keep-out. */
  function blocked(x, z, clearance, hint = -1) {
    if (keepOut(x, z)) return true;
    track.locate(x, z, hint, spot);
    const side = spot.lat >= 0 ? 1 : -1;
    const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, side);
    if (beyond < BARRIER_CLEAR + clearance) return true;
    if (atPortal(spot.s) && beyond < 30) return true;
    if (near(spot.s, track.bridges, 6) && beyond < 14) return true;
    if (Math.abs(track.delta(0, spot.s)) < 8 && beyond < 4) return true; // the gantry's legs
    if ((x - lay.x) ** 2 + (z - lay.z) ** 2 < (lay.radius + 3) ** 2) return true;
    return false;
  }

  const lakeLevel = terrain.lake.level;
  const BROAD = [SPECIES.indexOf('maple'), SPECIES.indexOf('lime'), SPECIES.indexOf('birch')];
  const NEEDLE = [SPECIES.indexOf('spruce'), SPECIES.indexOf('fir'), SPECIES.indexOf('larch')];
  /** A species for a tree of this mix at this height (the road's edge has more birch). */
  function pickSpecies(mix, y, edge) {
    const conifer = mix === 'conifer' ? 0.9 : mix === 'broadleaf' ? 0.06 : 0.12 + 0.8 * smoothstep(lakeLevel + 30, lakeLevel + 95, y);
    if (plantRng.next() < conifer) {
      const r = plantRng.next();
      return NEEDLE[r < 0.5 ? 0 : r < 0.8 ? 1 : 2];
    }
    const r = plantRng.next();
    return BROAD[r < 0.38 ? 0 : r < (edge ? 0.68 : 0.78) ? 1 : 2];
  }
  function addTree(x, y, z, species, { road, turned, inside, young = 1 }) {
    const data = SPECIES_DATA[SPECIES[species]];
    const variants = VARIANTS_OF[species];
    const variant = variants[plantRng.int(variants.length)];
    const lo = data.height[0] * young;
    const hi = data.height[1] * young;
    const u = plantRng.next();
    const h = road ? lo + (hi - lo) * (0.3 + 0.7 * u) : lo + (hi - lo) * Math.sqrt(u);
    // does this one turn, and how far along is it
    const ready = turned * data.turns;
    const roll = plantRng.next();
    const turn = data.autumn.length ? (roll < ready ? 0.7 + 0.3 * plantRng.next() : ready * 0.35 * plantRng.next()) : 0;
    trees.push({ x, y, z, variant, h, rank: plantRng.next(), road, turned: turn, inside });
    occupy(x, z);
  }
  const point = new THREE.Vector3();

  // the rows along the road where it is wooded
  const ROWS = [
    { off: [0.3, 1.8], step: [3.2, 4.6], gap: 1.2, inside: 0.15 },
    { off: [3.4, 5.8], step: [3.4, 5.0], gap: 0.66, inside: 0.4 },
    { off: [6.8, 10.5], step: [3.6, 5.4], gap: 0.6, inside: 0.6 },
  ];
  const glimpse = (s, side) => noise.fbm(s / 55 + side * 13.7, 3.3, 2);
  for (const side of [1, -1]) {
    ROWS.forEach((row, r) => {
      let hint = -1;
      for (let s = plantRng.range(0, 2); s < track.length; s += plantRng.range(row.step[0], row.step[1])) {
        const wood = woodAt(track, noise, s, side);
        if (!wood) continue;
        if (glimpse(s, side) > row.gap) continue;
        track.pointAt(s, side * (wood.from + plantRng.range(row.off[0], row.off[1])), point);
        if (blocked(point.x, point.z, 0, hint)) continue;
        hint = spot.index;
        if (!free(point.x, point.z, r === 0 ? 2.6 : 3.0)) continue;
        const y = terrain.heightAt(point.x, point.z);
        if (y < lakeLevel + 0.5) continue;
        addTree(point.x, y - 0.15, point.z, pickSpecies(wood.mix, y, r === 0), { road: true, turned: wood.turned, inside: row.inside });
      }
    });
  }
  // the undergrowth at the wood's edge, in front of and between the first trunks: hazel shrubs and young trees
  const HAZEL = SPECIES.indexOf('hazel');
  for (const side of [1, -1]) {
    let hint = -1;
    for (let s = plantRng.range(0, 2); s < track.length; s += plantRng.range(1.6, 3.2)) {
      const wood = woodAt(track, noise, s, side);
      if (!wood) continue;
      if (glimpse(s, side) > 1.0) continue;
      track.pointAt(s, side * (wood.from + plantRng.range(0, 3.5)), point);
      if (blocked(point.x, point.z, 0, hint)) continue;
      hint = spot.index;
      if (!free(point.x, point.z, 1.5)) continue;
      const y = terrain.heightAt(point.x, point.z);
      if (y < lakeLevel + 0.5) continue;
      const sapling = plantRng.next() < 0.22;
      const species = sapling ? pickSpecies(wood.mix, y, true) : HAZEL;
      addTree(point.x, y - 0.1, point.z, species, { road: true, turned: wood.turned, inside: 0, young: sapling ? 0.3 : 1 });
    }
  }
  const roadTrees = trees.length;

  // the mass of the forest
  const b = track.bounds;
  const X0 = b.minX - 250;
  const Z0 = b.minZ - 250;
  const X1 = b.maxX + 250;
  const Z1 = b.maxZ + 250;
  for (let z = Z0; z < Z1; z += LATTICE) {
    for (let x = X0; x < X1; x += LATTICE) {
      const px = x + plantRng.range(-0.45, 0.45) * LATTICE;
      const pz = z + plantRng.range(-0.45, 0.45) * LATTICE;
      const roll = plantRng.next();
      const rank = plantRng.next();
      const f = terrain.forestAt(px, pz);
      // dense where the forest is, a few strays at its edges and on the meadows
      if (roll > Math.min(0.92, f * 1.15) && roll > 0.015) continue;
      if (rank > T.keep) continue;
      if (blocked(px, pz, 2.5)) continue;
      const y = terrain.heightAt(px, pz);
      if (y < lakeLevel + 1) continue;
      // the tree line: thinning above 75 m, a few stragglers higher up
      if (plantRng.next() < 0.8 * smoothstep(75, 115, y)) continue;
      const slope = Math.max(Math.abs(terrain.heightAt(px + 2, pz) - y), Math.abs(terrain.heightAt(px, pz + 2) - y)) / 2;
      if (slope > 0.9) continue;
      if (!free(px, pz, 2.8)) continue;
      // the turned share of the road's nearest point, fading with the distance from it
      const away = Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1));
      const turned = turnedAt(track, noise, spot.s) * Math.exp(-away / 140) + 0.05;
      addTree(px, y - 0.2 - slope * 0.6, pz, pickSpecies('mixed', y, false), { road: false, turned, inside: 0.75 });
    }
  }
  lap('plant');

  // ---------------------------------------------------------------- the trees themselves
  const foliage = createFoliageAtlas(T.tile, rng.fork('foliage'));
  const bark = createBarkTextures(T.bark, rng.fork('bark'));
  lap('textures');
  const models = growTrees(VARIANTS, SPECIES_DATA, rng.fork('grow'), { full: T.full > 0, barkSize: T.bark });
  lap('grow');
  const atlas = bakeImpostors({ renderer, models, foliage: foliage.texture, bark: bark.map, cell: T.cell });
  lap('bake');

  // ---------------------------------------------------------------- per-tree data
  const count = trees.length;
  const matrices = new Float32Array(count * 16);
  const tints = new Float32Array(count * 3);
  const places = new Float32Array(count * 2);
  const bakes = new Float32Array(count * 3);
  const spheres = new Float32Array(count * 4); // centre and radius, for the frustum
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const bake = [0, 0, 0];
    const tintRng = rng.fork('tint');
    trees.forEach((t, i) => {
      const variant = VARIANTS[t.variant];
      const data = SPECIES_DATA[variant.species];
      const s = t.h / variant.P.H;
      const wide = tintRng.range(0.88, 1.12);
      const lean = tintRng.range(0, data.lean);
      const dir = tintRng.range(0, Math.PI * 2);
      e.set(Math.cos(dir) * lean, tintRng.range(0, Math.PI * 2), Math.sin(dir) * lean, 'YXZ');
      q.setFromEuler(e);
      m.compose(p.set(t.x, t.y, t.z), q, sc.set(s * wide, s, s * wide));
      m.toArray(matrices, i * 16);
      // its own green (a little towards yellow or blue, lighter or darker), mixed towards its own autumn colour
      const v = tintRng.range(data.value[0], data.value[1]);
      const hue = tintRng.range(-1, 1) * data.hue;
      const green = [data.green[0] * (1 + 0.35 * hue), data.green[1], data.green[2] * (1 - 0.6 * hue)];
      const autumn = data.autumn.length ? data.autumn[tintRng.int(data.autumn.length)] : green;
      for (let c = 0; c < 3; c++) tints[i * 3 + c] = v * (green[c] + (autumn[c] - green[c]) * t.turned);
      places[i * 2] = t.inside;
      places[i * 2 + 1] = t.turned;
      terrain.bakeAt(t.x, t.z, bake, 0);
      // a crown stands up out of a valley's shade a little; and it never sees less sky than half
      bakes[i * 3] = Math.min(1, bake[0] * 1.1 + 0.05);
      bakes[i * 3 + 1] = Math.min(1, bake[1] * 1.1 + 0.05);
      bakes[i * 3 + 2] = Math.max(0.5, bake[2]);
      const model = models[t.variant];
      spheres[i * 4] = t.x;
      spheres[i * 4 + 1] = t.y + model.top * s * 0.5;
      spheres[i * 4 + 2] = t.z;
      spheres[i * 4 + 3] = Math.max(model.top * 0.5, model.radius) * s * 1.1;
    });
  }
  // cells
  const cx0 = Math.floor(X0 / CELL);
  const cz0 = Math.floor(Z0 / CELL);
  const cw = Math.ceil(X1 / CELL) - cx0 + 1;
  const chh = Math.ceil(Z1 / CELL) - cz0 + 1;
  const cellOf = trees.map((t) => (Math.floor(t.z / CELL) - cz0) * cw + (Math.floor(t.x / CELL) - cx0));
  const order = [...trees.keys()].sort((a, c) => cellOf[a] - cellOf[c]);
  const cellStart = new Int32Array(cw * chh + 1);
  for (const i of order) cellStart[cellOf[i] + 1]++;
  for (let k = 0; k < cw * chh; k++) cellStart[k + 1] += cellStart[k];
  const cellItems = Int32Array.from(order);
  const cellSphere = [];
  for (let k = 0; k < cw * chh; k++) {
    let top = -1e9;
    let bottom = 1e9;
    for (let j = cellStart[k]; j < cellStart[k + 1]; j++) {
      const i = cellItems[j];
      top = Math.max(top, trees[i].y + trees[i].h);
      bottom = Math.min(bottom, trees[i].y);
    }
    const x = (cx0 + (k % cw) + 0.5) * CELL;
    const z = (cz0 + Math.floor(k / cw) + 0.5) * CELL;
    cellSphere.push(new THREE.Sphere(new THREE.Vector3(x, (top + bottom) / 2, z), Math.hypot(CELL * 0.75, (top - bottom) / 2) + 6));
  }

  // ---------------------------------------------------------------- materials and meshes
  const uniforms = createTreeUniforms();
  const material = treeMaterial({ foliage: foliage.texture, bark: bark.map, barkNormal: bark.normal, atmosphere, uniforms, coverage, wind: true });
  const farMaterial = impostorMaterial({ atlas, atmosphere, uniforms, coverage });
  const depthMaterial = treeDepthMaterial(uniforms, true, foliage.texture);
  const casterMaterial = impostorDepthMaterial(atlas);

  const group = new THREE.Group();
  group.name = 'forest';
  /** The camera the per-view lists were made for: every other camera (mirror, probe) sees the cheaper form. */
  let viewCamera = null;
  const perVariant = VARIANTS.map((_, v) => trees.filter((t) => t.variant === v).length);

  /** One InstancedMesh with room for `capacity` trees and the per-tree attributes. */
  function pool(geometry, mat, capacity, name, extra = {}) {
    const g = geometry.clone();
    const n = Math.max(1, capacity);
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aTint', attr(4));
    g.setAttribute('aBake', attr(3));
    g.setAttribute('aPlace', attr(2));
    for (const [key, size] of Object.entries(extra)) g.setAttribute(key, attr(size));
    const mesh = new THREE.InstancedMesh(g, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.userData.main = 0;
    mesh.userData.other = 0;
    // the view sees `main` instances; a mirror or a probe the first `other`
    mesh.onBeforeRender = (_r, _s, camera) => {
      mesh.count = camera === viewCamera ? mesh.userData.main : mesh.userData.other;
    };
    group.add(mesh);
    return mesh;
  }
  const fullMeshes = T.full > 0 ? models.map((m, v) => pool(m.full, material, perVariant[v], `forest-full-${VARIANTS[v].name}`)) : [];
  // (room for the full trees too: the mirror and the probe see them in this form)
  const reducedMeshes = models.map((m, v) => pool(m.reduced, material, perVariant[v] * (T.full > 0 ? 2 : 1), `forest-reduced-${VARIANTS[v].name}`));
  const card = new THREE.BufferGeometry();
  card.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  card.setIndex([0, 1, 2, 0, 2, 3]);
  const farMesh = pool(card, farMaterial, count, 'forest-impostors', { aImp: 2 });
  // the shadow-only proxies: impostor cards, which under the sun's camera turn to the light and cast the crown's
  // silhouette seen from there
  const casterMeshes = [];
  if (T.casters) {
    const mesh = pool(card, farMaterial, count, 'forest-casters', { aImp: 2 });
    mesh.onBeforeRender = () => {};
    mesh.layers.set(CASTER_LAYER);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.customDepthMaterial = casterMaterial;
    casterMeshes.push(mesh);
  }
  card.dispose();
  const through = VARIANTS.map((v) => SPECIES_DATA[v.species].through);

  // ---------------------------------------------------------------- per view
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector3();
  // trees cast round the car: the shade on the road ahead and beside it is what is seen (the shadow square reaches
  // further, but what falls there is mostly the forest's own floor)
  const shadowR = Math.min(shadow.reach * 1.1, CAST_REACH);
  const counts = { full: 0, reduced: 0, impostors: 0, casters: 0, triangles: 0, casterTriangles: 0 };
  const fullTris = models.map((m) => m.triangles[0]);
  const reducedTris = models.map((m) => m.triangles[1]);
  /** Trees at full detail this view: written to the reduced meshes too (after the reduced ones), for the mirror. */
  const fullList = [];

  function write(mesh, i, fade) {
    const k = mesh.count++;
    const a = mesh.geometry.attributes;
    mesh.instanceMatrix.array.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
    a.aTint.array[k * 4] = tints[i * 3];
    a.aTint.array[k * 4 + 1] = tints[i * 3 + 1];
    a.aTint.array[k * 4 + 2] = tints[i * 3 + 2];
    a.aTint.array[k * 4 + 3] = fade;
    a.aBake.array.set(bakes.subarray(i * 3, i * 3 + 3), k * 3);
    a.aPlace.array[k * 2] = places[i * 2];
    a.aPlace.array[k * 2 + 1] = places[i * 2 + 1];
    if (a.aImp) {
      a.aImp.array[k * 2] = trees[i].variant;
      a.aImp.array[k * 2 + 1] = through[trees[i].variant];
    }
  }
  function upload(mesh) {
    const n = Math.max(1, mesh.count);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    for (const attr of Object.values(mesh.geometry.attributes)) {
      if (!attr.isInstancedBufferAttribute) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  function prepareView(camera, focus) {
    viewCamera = camera;
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    eye.setFromMatrixPosition(camera.matrixWorld);
    // an orthographic view from above (the viewer's map) sees everything in its frame at the reduced level
    const flat = camera.isOrthographicCamera;
    for (const m of group.children) m.count = 0;
    fullList.length = 0;
    const blend = coverage ? BLEND : 0;
    const fullD = T.full;
    const redD = T.reduced;
    for (let k = 0; k < cellSphere.length; k++) {
      if (cellStart[k] === cellStart[k + 1]) continue;
      const cs = cellSphere[k];
      const dEye = flat ? 0 : cs.center.distanceTo(eye) - cs.radius;
      const caster = casterMeshes.length > 0 && Math.hypot(cs.center.x - focus.x, cs.center.z - focus.z) - cs.radius < shadowR;
      const seenCell = dEye < T.far && frustum.intersectsSphere(cs);
      if (!caster && !seenCell) continue;
      for (let j = cellStart[k]; j < cellStart[k + 1]; j++) {
        const i = cellItems[j];
        const v = trees[i].variant;
        sphere.center.set(spheres[i * 4], spheres[i * 4 + 1], spheres[i * 4 + 2]);
        sphere.radius = spheres[i * 4 + 3];
        if (caster && Math.hypot(sphere.center.x - focus.x, sphere.center.z - focus.z) < shadowR) write(casterMeshes[0], i, 1);
        if (!seenCell || !frustum.intersectsSphere(sphere)) continue;
        // (small things, the undergrowth and young trees, go to the simpler levels sooner)
        const small = trees[i].h < 6;
        const fD = small ? fullD * 0.55 : fullD;
        const rD = small ? redD * 0.6 : redD;
        const d = flat ? rD - blend - 1 : sphere.center.distanceTo(eye);
        if (d < fD) {
          const a = blend ? Math.min(1, (fD - d) / blend) : 1;
          write(fullMeshes[v], i, a);
          fullList.push(i);
          if (a < 1) write(reducedMeshes[v], i, 1 - a);
        } else if (d < rD) {
          const a = blend ? Math.min(1, (rD - d) / blend) : 1;
          write(reducedMeshes[v], i, a);
          if (a < 1) write(farMesh, i, 1 - a);
        } else {
          // each tree has its own distance at which it goes (the road's rows keep longest), fading over the last part
          const cut = trees[i].h < 6 ? T.far * 0.3 : T.far * (trees[i].road ? 1 : 0.35 + 0.65 * (1 - trees[i].rank) ** 0.7);
          if (d > cut) continue;
          write(farMesh, i, coverage ? Math.min(1, (cut - d) / (0.15 * cut)) : 1);
        }
      }
    }
    // what the view draws; then, behind it in the reduced meshes, the full trees for the mirror and the probe
    for (const m of group.children) m.userData.main = m.userData.other = m.count;
    for (const m of fullMeshes) m.userData.other = 0;
    for (const i of fullList) write(reducedMeshes[trees[i].variant], i, 1);
    for (const m of reducedMeshes) m.userData.other = m.count;
    counts.full = counts.reduced = counts.impostors = counts.casters = counts.triangles = counts.casterTriangles = 0;
    for (const m of group.children) {
      upload(m);
      m.count = m.userData.main;
      m.visible = m.userData.main > 0 || m.userData.other > 0;
    }
    fullMeshes.forEach((m, v) => {
      counts.full += m.userData.main;
      counts.triangles += m.userData.main * fullTris[v];
    });
    reducedMeshes.forEach((m, v) => {
      counts.reduced += m.userData.main;
      counts.triangles += m.userData.main * reducedTris[v];
    });
    counts.impostors = farMesh.userData.main;
    counts.triangles += farMesh.userData.main * 2;
    for (const m of casterMeshes) {
      counts.casters += m.count;
      counts.casterTriangles += m.count * 2;
    }
    counts.drawCalls = group.children.filter((m) => m.visible).length;
  }

  /**
   * One tree alone, for the viewer: a variant at its template height, standing at the origin of its parent.
   * @param {string} name a variant's name @param {{ turned?: number, lod?: 'full'|'reduced'|'impostor', autumn?: number }} o
   */
  function specimen(name, { turned = 0, lod = 'full', autumn = 0 } = {}) {
    const v = Math.max(0, VARIANTS.findIndex((x) => x.name === name));
    const source = lod === 'impostor' ? farMesh : lod === 'reduced' || !fullMeshes.length ? reducedMeshes[v] : fullMeshes[v];
    const g = source.geometry.clone();
    const mesh = new THREE.InstancedMesh(g, source.material, 1);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const data = SPECIES_DATA[VARIANTS[v].species];
    const tone = data.autumn.length ? data.autumn[autumn % data.autumn.length] : data.green;
    const tint = data.green.map((c, k) => c + (tone[k] - c) * turned);
    g.attributes.aTint.array.set([...tint, 1]);
    g.attributes.aBake.array.set([1, 1, 1]);
    g.attributes.aPlace.array.set([0.2, turned]);
    if (g.attributes.aImp) g.attributes.aImp.array.set([v, through[v]]);
    for (const a of Object.values(g.attributes)) a.needsUpdate = true;
    mesh.setMatrixAt(0, new THREE.Matrix4());
    // its shadow, by its reduced shape
    const caster = new THREE.InstancedMesh(reducedMeshes[v].geometry.clone(), material, 1);
    caster.setMatrixAt(0, new THREE.Matrix4());
    caster.castShadow = true;
    caster.frustumCulled = false;
    caster.layers.set(CASTER_LAYER);
    caster.customDepthMaterial = depthMaterial;
    const box = { center: new THREE.Vector3(0, models[v].top / 2, 0), half: new THREE.Vector3(models[v].radius, models[v].top / 2, models[v].radius) };
    return { mesh, caster, box, triangles: models[v].triangles };
  }

  lap('meshes');
  return {
    specimen,
    /** The impostor atlas (for looking at it). */
    atlas,
    group,
    uniforms,
    prepareView,
    /** How much of the wood has turned at track distance s (0..1). */
    turnedAt: (s) => turnedAt(track, noise, s),
    /** Is the land beside the road wooded at (s, side): the mix, how much has turned, where the trees begin. */
    woodAt: (s, side) => woodAt(track, noise, s, side),
    update(dt, simTime) {
      uniforms.uTime.value = simTime;
    },
    setTime(time) {
      // a breath of wind by day, less at night
      uniforms.uWind.value.z = time.name === 'night' ? 0.5 : 1;
    },
    setWetness(w) {
      uniforms.uWet.value = w;
    },
    stats: {
      trees: count,
      roadTrees,
      perVariant,
      triangles: models.map((m) => m.triangles),
      view: counts,
      bytes: foliage.bytes + bark.bytes + atlas.bytes,
      ms,
    },
    dispose() {
      for (const m of group.children) m.geometry.dispose();
      material.dispose();
      farMaterial.dispose();
      depthMaterial.dispose();
      casterMaterial.dispose();
      foliage.texture.dispose();
      bark.map.dispose();
      bark.normal.dispose();
      atlas.dispose();
    },
  };
}
