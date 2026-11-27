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
import { TILE, createBarkTextures, createFoliageAtlas, tileRect } from './forestTextures.js';
import { layBy } from './gantry.js';
import { forDevice } from '../../engine/caps.js';
import { bakeImpostors } from './impostors.js';
import { planeNoise, smoothstep } from './shading.js';
import { GRASS } from './groundMaterial.js';
import { LAKESIDE } from './lakeside.js';
import { APPROACH, approachesOf } from './approach.js';
import { GOLDWOOD, goldwoodOf } from './goldwood.js';
import { ARM } from './arm.js';
import { TIMES } from './lighting.js';
import { growTrees } from './treeGeometry.js';
import { createTreeUniforms, impostorDepthMaterial, impostorMaterial, plantMaterial, treeDepthMaterial, treeMaterial } from './treeMaterial.js';
import { SPECIES, SPECIES_DATA, VARIANTS, VARIANTS_OF } from './treeSpecies.js';

/** The Track's edge kind TREES (game/track.js EDGE.TREES; assets/ does not import game/). */
const EDGE_TREES = 4;
/** What stays free behind a barrier (m). */
const BARRIER_CLEAR = 2;
/** The layer of the shadow-only proxies: the sun's shadow camera sees it, no view camera does. */
export const CASTER_LAYER = 3;

/**
 * Per tier: full detail out to (m), reduced detail out to, impostors out to, share of the general forest kept,
 * foliage tile and bark tile (texels), impostor picture (texels), whether trees cast shadow; and how far a tree's
 * `detail` may stretch the full and the reduced distances (the trees the reference frames look at have detail over 1:
 * D4's wall stands 70 to 150 m from the grid).
 */
const TIER = {
  low: { full: 0, reduced: 55, far: 650, keep: 0.5, tile: 384, bark: 128, cell: 192, rings: 1, casters: true, fullCap: 1, redCap: 2.6 },
  medium: { full: 58, reduced: 80, far: 900, keep: 0.8, tile: 512, bark: 256, cell: 256, rings: 2, casters: true, fullCap: 2.2, redCap: 2.8 },
  high: { full: 80, reduced: 110, far: 1200, keep: 1, tile: 512, bark: 256, cell: 256, rings: 2, casters: true, fullCap: 2, redCap: 2.8 },
  /**
   * (perf lane) A phone's own numbers, laid over its tier's (caps.mobile; engine/caps.js forDevice): only how far each
   * form is drawn and which trees cast (`castSeen`: shadowSeen below), never what is planted. None yet.
   */
  mobile: {},
};
/** (perf lane) With `castSeen`: a tree whose shadow passes within this far of the eye (m) casts whatever the view shows: the car mirrors what is beside it. */
const CAST_NEAR = 30;
/** Width of the band over which two levels cross-fade (m), on the multisampled tiers. */
const BLEND = 8;
/** How far the wood's floor (grass and fallen leaves under the road's trees) is drawn, per tier (m). */
const FLOOR_REACH = { low: 70, medium: 110, high: 150 };
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
  // the start: from the line to some 230 m past it the wood has turned (D4's wall of maples beyond the pit exit).
  // Before the line, behind the pits, it is green, and green again by the first bend: the sunlit wood of D1.
  const d = track.delta(0, s);
  const start = smoothstep(-20, 10, d) * (1 - smoothstep(205, 255, d));
  // green, too, for a good way either side of the start, and in the ledge's first bend (D3's wood)
  const ledge = track.sections?.find((x) => x.id === 'ledge');
  const near = 1 - smoothstep(520, 700, Math.abs(d));
  const green = Math.max(near, ledge ? smoothstep(-40, 0, track.delta(ledge.s0, s)) * (1 - smoothstep(280, 340, track.delta(ledge.s0, s))) : 0);
  // elsewhere, groups here and there along the lap
  const groups = smoothstep(0.55, 0.72, noise.fbm(s / 140, 7.1, 2)) * (1 - green);
  return Math.min(1, start + 0.6 * groups + 0.05 * (1 - green));
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
 * What every tree is made from, without a forest: the textures, the grown individuals, their impostor pictures and
 * the materials. createForest plants with it; the viewer's tree lab (assets/world/dev.js) shows single trees with it.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer (the impostors are baked with it)
 * @param {import('../../engine/caps.js').Tier} o.tier
 * @param {boolean} o.coverage the scene target is multisampled
 * @param {import('../../engine/rng.js').Rng} o.rng the forest's stream
 * @param {import('./atmosphere.js').Atmosphere} o.atmosphere
 */
export function createTreeKit({ renderer, tier, coverage, rng, atmosphere }) {
  const ms = {};
  let clock = performance.now();
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };
  const T = TIER[tier] ?? TIER.high;
  const foliage = createFoliageAtlas(T.tile, rng.fork('foliage'));
  lap('foliage');
  const bark = createBarkTextures(T.bark, rng.fork('bark'));
  lap('bark');
  ms.textures = ms.foliage + ms.bark;
  ms.atlas = foliage.ms;
  // (the impostors are pictures of the full trees; the low tier, which never draws a full one, grows only the
  // conifers' (cheap, and their reduced boughs are too sparse for a picture) and pictures the broadleaves' reduced
  // ones: half the growing time there)
  const models = growTrees(VARIANTS, SPECIES_DATA, rng.fork('grow'), { full: T.full > 0 ? true : (v) => v.kind === 'conifer', barkSize: T.bark });
  lap('grow');
  const atlas = bakeImpostors({ renderer, models, foliage: foliage.texture, bark: bark.map, cell: T.cell, rings: T.rings });
  lap('bake');
  const uniforms = createTreeUniforms();
  const material = treeMaterial({ foliage: foliage.texture, bark: bark.map, barkNormal: bark.normal, atmosphere, uniforms, coverage, wind: true });
  const farMaterial = impostorMaterial({ atlas, atmosphere, uniforms, coverage });
  const depthMaterial = treeDepthMaterial(uniforms, true, foliage.texture);
  const casterMaterial = impostorDepthMaterial(atlas);
  const through = VARIANTS.map((v) => SPECIES_DATA[v.species].through);
  const card = new THREE.BufferGeometry();
  card.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  card.setIndex([0, 1, 2, 0, 2, 3]);

  /**
   * One tree alone, for the viewer: a variant at its template height, standing at the origin of its parent.
   * @param {string} name a variant's name
   * @param {{ turned?: number, lod?: 'full'|'reduced'|'impostor', autumn?: number, tint?: number[] }} o
   */
  function specimen(name, { turned = 0, lod = 'full', autumn = 0, tint = null } = {}) {
    const v = Math.max(0, VARIANTS.findIndex((x) => x.name === name));
    const impostor = lod === 'impostor';
    const g = (impostor ? card : lod === 'reduced' || T.full <= 0 ? models[v].reduced : models[v].full).clone();
    const attr = (key, values) => g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(values), values.length));
    const data = SPECIES_DATA[VARIANTS[v].species];
    const tone = data.autumn.length ? data.autumn[autumn % data.autumn.length] : data.green;
    attr('aTint', [...(tint ?? data.green.map((c, k) => c + (tone[k] - c) * turned)), 1]);
    attr('aBake', [1, 1, 1]);
    attr('aPlace', [0.2, turned]);
    if (impostor) attr('aImp', [v, through[v]]);
    const mesh = new THREE.InstancedMesh(g, impostor ? farMaterial : material, 1);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.setMatrixAt(0, new THREE.Matrix4());
    // its shadow, by its reduced shape
    const caster = new THREE.InstancedMesh(models[v].reduced.clone(), material, 1);
    caster.setMatrixAt(0, new THREE.Matrix4());
    caster.castShadow = true;
    caster.frustumCulled = false;
    caster.layers.set(CASTER_LAYER);
    caster.customDepthMaterial = depthMaterial;
    const box = { center: new THREE.Vector3(0, models[v].top / 2, 0), half: new THREE.Vector3(models[v].radius, models[v].top / 2, models[v].radius) };
    return { mesh, caster, box, triangles: models[v].triangles };
  }

  return {
    T,
    foliage,
    bark,
    models,
    atlas,
    uniforms,
    material,
    farMaterial,
    depthMaterial,
    casterMaterial,
    through,
    card,
    ms,
    specimen,
    bytes: foliage.bytes + bark.bytes + atlas.bytes,
    dispose() {
      card.dispose();
      for (const m of models) {
        m.full?.dispose();
        m.reduced.dispose();
      }
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
export function createForest({ renderer, track, terrain, tier, caps = null, coverage, rng, atmosphere, shadow, keepOut = () => false }) {
  const started = performance.now();
  const ms = {};
  let clock = started;
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };
  // (perf lane) the tier's numbers, a phone's own laid over them (TIER.mobile: view distances only; what is planted
  // is the tier's)
  const T = forDevice(TIER, tier, caps);
  const noise = planeNoise(rng.int(1 << 30));
  let plantRng = rng.fork('plant');

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
  // The lap's own trees are planted from the land as it was before the lakeside was shaped (terrain.before), so that
  // shaping that one place draws the same random numbers and moves no tree anywhere else; what then stands on the
  // changed ground is cleared or seated again, and the place is planted from a stream of its own (below).
  const land = terrain.before ?? terrain;
  const lakeside = terrain.lakeside ?? null;
  let nearMix = 'mixed';
  const ledge = track.sections?.find((x) => x.id === 'ledge');
  /** In the ledge's first bend (D3's place). */
  const ledgeAt = (s) => !!ledge && track.delta(ledge.s0, s) > -30 && track.delta(ledge.s0, s) < 320;
  const BROAD = [SPECIES.indexOf('maple'), SPECIES.indexOf('lime'), SPECIES.indexOf('hornbeam'), SPECIES.indexOf('birch')];
  const NEEDLE = [SPECIES.indexOf('spruce'), SPECIES.indexOf('fir'), SPECIES.indexOf('larch')];
  /** A species for a tree of this mix at this height (the road's edge has more birch). */
  function pickSpecies(mix, y, edge, turned = 0) {
    const conifer = mix === 'conifer' ? 0.9 : mix === 'broadleaf' ? 0.06 : 0.12 + 0.8 * smoothstep(lakeLevel + 30, lakeLevel + 95, y);
    if (plantRng.next() < conifer) {
      const r = plantRng.next();
      return NEEDLE[r < 0.5 ? 0 : r < 0.8 ? 1 : 2];
    }
    // where the wood has turned, it is mostly maples that turned it
    const r = plantRng.next();
    const maple = 0.3 + 0.5 * turned * turned;
    const rest = (r - maple) / (1 - maple);
    return BROAD[r < maple ? 0 : rest < 0.4 ? 1 : rest < (edge ? 0.7 : 0.8) ? 2 : 3];
  }
  /**
   * @param {object} o road: one of the road's own trees; turned: how much of the wood has turned there; inside: how far
   *   inside the wood it stands (0..1: the lower part of a tree inside is in the others' shade); young: its species'
   *   heights times this, or height: [lo, hi] its own range (m); detail: how far out it keeps its finer levels of
   *   detail (1: the tier's distances; trees behind others need less); lean: [x, z, rad] leaning that way by so much
   */
  function addTree(x, y, z, species, { road, turned, inside, young = 1, height = null, detail = 1, lean = null, slim = 1, from = plantRng, tone = null, sink = 0, crownSun = false, gold = 0 }) {
    const data = SPECIES_DATA[SPECIES[species]];
    const variants = VARIANTS_OF[species];
    const variant = variants[from.int(variants.length)];
    const lo = height ? height[0] : data.height[0] * young;
    const hi = height ? height[1] : data.height[1] * young;
    const u = from.next();
    const h = height ? lo + (hi - lo) * u : road ? lo + (hi - lo) * (0.3 + 0.7 * u) : lo + (hi - lo) * Math.sqrt(u);
    // does this one turn, and how far along is it
    // (gold: at least this share turns whatever the species' readiness: the golden wood)
    const ready = Math.max(turned * data.turns, gold);
    const roll = from.next();
    const turn = data.autumn.length ? (roll < ready ? 0.75 + 0.25 * from.next() : ready * 0.35 * from.next()) : 0;
    // (tone: its tint times this, rgb; sink: this share of its height stands under the ground, so that a conifer's
    // skirt reaches the grass and no bare stem shows: the approach to the tunnel; crownSun: the lakeside)
    trees.push({ x, y: y - sink * h, z, variant, h, rank: from.next(), road, turned: turn, inside, detail, lean, slim, tone, crownSun });
    occupy(x, z);
  }
  const point = new THREE.Vector3();

  // the rows along the road where it is wooded (not on the stretches that are planted by hand below)
  const ROWS = [
    { off: [0.3, 1.8], step: [3.2, 4.6], gap: 1.2, inside: 0.15, detail: 1 },
    { off: [3.4, 5.8], step: [3.4, 5.0], gap: 0.66, inside: 0.4, detail: 0.8 },
    { off: [6.8, 10.5], step: [3.6, 5.4], gap: 0.6, inside: 0.6, detail: 0.6 },
  ];
  const glimpse = (s, side) => noise.fbm(s / 55 + side * 13.7, 3.3, 2);
  const MAPLE = SPECIES.indexOf('maple');
  const LIME = SPECIES.indexOf('lime');
  const BIRCH = SPECIES.indexOf('birch');
  const FIR = SPECIES.indexOf('fir');
  const HORNBEAM = SPECIES.indexOf('hornbeam');
  const HAZEL = SPECIES.indexOf('hazel');
  /** The wall of maples (D4): the land side of the straight where the wood has turned. */
  const wallAt = (s, side) => side < 0 && turnedAt(track, noise, s) > 0.5 && !!woodAt(track, noise, s, side);
  /** The bank of D3: the wooded side (the right) of the ledge's first bend. */
  const bankAt = (s, side) => side < 0 && ledgeAt(s) && !!woodAt(track, noise, s, side);
  /** Beyond that bend, on the valley's side, the wood stays low: the view over the valley from the bend stays open. */
  const lowAt = (s, side) => side > 0 && !!ledge && track.delta(ledge.s0, s) > 200 && track.delta(ledge.s0, s) < 460;
  for (const side of [1, -1]) {
    ROWS.forEach((row, r) => {
      let hint = -1;
      for (let s = plantRng.range(0, 2); s < track.length; s += plantRng.range(row.step[0], row.step[1])) {
        const wood = woodAt(track, noise, s, side);
        if (!wood || wallAt(s, side) || bankAt(s, side)) continue;
        if (glimpse(s, side) > row.gap) continue;
        track.pointAt(s, side * (wood.from + plantRng.range(row.off[0], row.off[1])), point);
        if (blocked(point.x, point.z, 0, hint)) continue;
        hint = spot.index;
        if (!free(point.x, point.z, r === 0 ? 2.6 : 3.0)) continue;
        const y = land.heightAt(point.x, point.z);
        if (y < lakeLevel + 0.5) continue;
        const low = lowAt(s, side);
        addTree(point.x, y - 0.15, point.z, pickSpecies(low ? 'broadleaf' : wood.mix, y, r === 0, wood.turned), { road: true, turned: wood.turned, inside: row.inside, detail: row.detail, young: low ? 0.5 : 1 });
      }
    });
  }

  /**
   * Rows planted by hand along a stretch: `rows` of { off: [lo, hi] metres behind where trees may begin, step: [lo,
   * hi] metres between trunks, r: the room a trunk needs, height: [lo, hi], detail, inside, lean: [lo, hi] rad
   * towards the road }; `species(row)` picks each tree's.
   */
  function plantRows(s0, span, side, rows, here, species, turnedOf) {
    rows.forEach((row, r) => {
      let hint = -1;
      for (let d = plantRng.range(0, row.step[0]); d < span; d += plantRng.range(row.step[0], row.step[1])) {
        const s = (s0 + d + track.length) % track.length;
        if (!here(s, side)) continue;
        const lat = side * (track.edgeAt(s, side) + BARRIER_CLEAR + plantRng.range(row.off[0], row.off[1]));
        track.pointAt(s, lat, point);
        if (blocked(point.x, point.z, row.clear ?? 0, hint)) continue;
        hint = spot.index;
        if (!free(point.x, point.z, row.r)) continue;
        const y = land.heightAt(point.x, point.z);
        if (y < lakeLevel + 0.4) continue;
        const x = point.x;
        const z = point.z;
        let lean = null;
        if (row.lean) {
          // towards the road: from where it stands to the centre line abeam
          track.pointAt(s, 0, point);
          const l = Math.hypot(point.x - x, point.z - z) || 1;
          lean = [(point.x - x) / l, (point.z - z) / l, plantRng.range(row.lean[0], row.lean[1])];
        }
        const kind = species(r);
        addTree(x, y - 0.15, z, kind, { road: true, turned: turnedOf(s), inside: row.inside, height: kind === FIR && row.fir ? row.fir : row.height, detail: row.detail, lean, slim: kind === FIR ? 1 : (row.slim ?? 1) });
      }
    });
  }

  // THE START (D4): beyond the pit exit, where the Track says the land side is wooded and the wood has turned, a wall
  // of turned maples: 14 to 20 m tall close behind the barrier, crowns touching, and each row behind taller than the
  // one before it, so that from the grid the wall closes the picture and no sky stands over it; a small dark fir or
  // two in its front. Nowhere else on the straight: the lake side and the paddock before the line stay open, so that
  // the massif shows (D1). (The straight is the Track's section `straight`.)
  const straight = track.sections?.find((x) => x.id === 'straight');
  if (straight) {
    const span = (track.delta(straight.s0, straight.s1) + track.length) % track.length;
    const WALL = [
      { off: [0.2, 1.6], step: [5.6, 7.4], r: 4.0, height: [14, 19], fir: [8, 11], detail: 2.8, inside: 0.05, slim: 0.74 },
      { off: [5.8, 8.2], step: [5.6, 7.6], r: 4.2, height: [16, 21], fir: [10, 13], detail: 2.6, inside: 0.3, slim: 0.74 },
      { off: [12, 15.5], step: [6, 8], r: 4.4, height: [18, 24], detail: 2.2, inside: 0.45, slim: 0.74 },
      { off: [19, 23.5], step: [6, 8.5], r: 4.4, height: [21, 27], detail: 1.6, inside: 0.55, slim: 0.7 },
      { off: [27, 33], step: [6.5, 9], r: 4.4, height: [24, 30], detail: 1.1, inside: 0.6, slim: 0.7 },
      // (the wood rising behind: from the grid no sky over the crowns)
      { off: [37, 45], step: [7, 10], r: 4.6, height: [26, 33], detail: 0.7, inside: 0.65, slim: 0.7 },
    ];
    // nearly all maples; a lime here and there; a dark fir or two in the first rows
    plantRows(straight.s0, span, -1, WALL, wallAt, (r) => {
      const roll = plantRng.next();
      return r < 2 && roll < 0.07 ? FIR : roll > 0.95 ? LIME : MAPLE;
    }, (s) => turnedAt(track, noise, s));
  }

  // THE LEDGE'S FIRST BEND (D3): big green broadleaves close behind the wall and up the bank, the first of them
  // leaning out over the road, tall, with long pale limbs showing under open crowns
  if (ledge) {
    // (not a closed wood: a row at the wall, a thinner one behind it and single trees up the sunlit bank, so that the
    // sun, which stands behind them by day, comes through between the crowns and lies in patches on the road)
    const BANK = [
      { off: [-0.9, 0.4], step: [6, 8.5], r: 4, height: [16, 21], detail: 2, inside: 0, lean: [0.14, 0.27] },
      // (render lane) the rows behind are lower and closer than they were (17-24 m tall, 5 to 44 m back): the
      // day's sun, 16 degrees up, passes over the road at 4 to 13 m above the ground 15 to 45 m away. The big
      // trees at the wall have their crowns higher than that (their shade falls beyond the road, only their
      // trunks cross it), so these lower crowns are the ones its light must come through to lie on the road in
      // patches (frame D3)
      { off: [4, 8], step: [5, 8], r: 4, height: [8, 11], detail: 1.7, inside: 0.1, lean: [0.03, 0.12] },
      { off: [10, 16], step: [6, 10], r: 4.5, height: [10, 14], detail: 1.2, inside: 0.1 },
      { off: [20, 32], step: [10, 16], r: 5.5, height: [15, 22], detail: 0.9, inside: 0.1 },
    ];
    plantRows(ledge.s0 - 30, 350, -1, BANK, bankAt, (r) => {
      const roll = plantRng.next();
      return roll < (r === 0 ? 0.8 : 0.55) ? HORNBEAM : roll < 0.9 ? LIME : MAPLE;
    }, () => 0);
  }

  // THE FIRST BEND AFTER THE STRAIGHT (D1's middle distance): behind the road's own rows, more of the green wood,
  // low and round, so that from the run-up the far end of the straight is closed by sunlit crowns right across
  const sweep = track.sections?.find((x) => x.id === 'sweep');
  if (sweep) {
    const BACK = [
      { off: [12, 17], step: [4.5, 7], r: 3.4, height: [7, 13], detail: 0.5, inside: 0.5 },
      { off: [19, 26], step: [5, 8], r: 3.4, height: [8, 15], detail: 0.4, inside: 0.6 },
      { off: [28, 38], step: [5, 8], r: 3.6, height: [9, 16], detail: 0.4, inside: 0.6 },
    ];
    const green = (s, side) => !!woodAt(track, noise, s, side) && !wallAt(s, side);
    for (const side of [1, -1]) {
      plantRows(sweep.s0 - 20, 300, side, BACK, green, () => {
        const roll = plantRng.next();
        return roll < 0.45 ? LIME : roll < 0.75 ? HORNBEAM : roll < 0.9 ? MAPLE : roll < 0.95 ? BIRCH : FIR;
      }, () => 0.05);
    }
  }

  // D1: at the near end of the lake side's run of boards along the straight, one or two tall dark trees behind the
  // first board (the only trees on that side)
  if (straight) {
    const run = (track.boards ?? []).filter((b) => b.side > 0 && track.delta(straight.s0, b.s0) >= 0 && track.delta(straight.s0, b.s0) < 200).sort((a, b) => track.delta(straight.s0, a.s0) - track.delta(straight.s0, b.s0))[0];
    if (run) {
      for (let k = 0; k < 2; k++) {
        const s = (run.s0 + track.length + k * 7 - 4) % track.length;
        track.pointAt(s, track.edgeAt(s, 1) + 3.5 + k * 2.5, point);
        const y = land.heightAt(point.x, point.z);
        if (y < lakeLevel + 0.3 || keepOut(point.x, point.z) || !free(point.x, point.z, 2)) continue;
        addTree(point.x, y - 0.15, point.z, SPECIES.indexOf(k ? 'fir' : 'spruce'), { road: true, turned: 0, inside: 0.1, young: 1.1 });
      }
    }
  }

  // the undergrowth at the wood's edge, in front of and between the first trunks: hazel shrubs and young trees
  for (const side of [1, -1]) {
    let hint = -1;
    for (let s = plantRng.range(0, 2); s < track.length; s += plantRng.range(1.6, 3.2)) {
      const wood = woodAt(track, noise, s, side);
      if (!wood) continue;
      if (glimpse(s, side) > 1.0) continue;
      // (trunks and limbs show under the wall's and the bank's crowns: only a shrub here and there before them)
      if ((wallAt(s, side) || bankAt(s, side)) && plantRng.next() < 0.75) continue;
      track.pointAt(s, side * (wood.from + plantRng.range(0, 3.5)), point);
      if (blocked(point.x, point.z, 0, hint)) continue;
      hint = spot.index;
      if (!free(point.x, point.z, 1.5)) continue;
      const y = land.heightAt(point.x, point.z);
      if (y < lakeLevel + 0.5) continue;
      const sapling = plantRng.next() < 0.22;
      const species = sapling ? pickSpecies(wood.mix, y, true) : HAZEL;
      addTree(point.x, y - 0.1, point.z, species, { road: true, turned: wood.turned, inside: 0, young: sapling ? 0.3 : 1, detail: 0.6 });
    }
  }

  // THE VALLEY BELOW THE LEDGE'S FIRST BEND (D3's left): nothing but low growth on the slopes the bend looks out
  // over, as far as the wooded ridge beyond. Kept as the bend's centre line where its inside is open, with the
  // direction to that side.
  const valley = [];
  if (ledge) {
    const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
    for (let d = -30; d <= 300; d += 10) {
      const s = (ledge.s0 + d + track.length) % track.length;
      if (woodAt(track, noise, s, 1)) continue;
      track.frameAt(s, frame);
      valley.push([frame.pos.x, frame.pos.z, frame.left.x, frame.left.z]);
    }
  }
  const VALLEY_REACH = 260;
  const inValley = (x, z) => {
    for (const v of valley) {
      const dx = x - v[0];
      const dz = z - v[1];
      const across = dx * v[2] + dz * v[3];
      if (across > 0 && across < VALLEY_REACH && Math.abs(dx * v[3] - dz * v[2]) < 24) return true;
    }
    return false;
  };
  const valleyBox = valley.reduce((box, v) => [Math.min(box[0], v[0]), Math.min(box[1], v[1]), Math.max(box[2], v[0]), Math.max(box[3], v[1])], [1e9, 1e9, -1e9, -1e9]);

  // the mass of the forest
  const b = track.bounds;
  const X0 = b.minX - 250;
  const Z0 = b.minZ - 250;
  const X1 = b.maxX + 250;
  const Z1 = b.maxZ + 250;
  // Which parts of the map lie near a road (a coarse grid): only there do the road's rules apply, and only there is
  // the nearest point of the road looked for, which is the dear part of planting. Far from every road the wood is
  // only ever seen as cards on a hillside, and half as many trees stand there.
  const NEAR = 48;
  const nearW = Math.ceil((X1 - X0) / NEAR) + 1;
  const nearH = Math.ceil((Z1 - Z0) / NEAR) + 1;
  const nearRoad = new Uint8Array(nearW * nearH);
  for (let s = 0; s < track.length; s += 16) {
    track.pointAt(s, 0, point);
    const cx = Math.floor((point.x - X0) / NEAR);
    const cz = Math.floor((point.z - Z0) / NEAR);
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix >= 0 && iz >= 0 && ix < nearW && iz < nearH) nearRoad[iz * nearW + ix] = 1;
      }
    }
  }
  for (let z = Z0; z < Z1; z += LATTICE) {
    for (let x = X0; x < X1; x += LATTICE) {
      const px = x + plantRng.range(-0.45, 0.45) * LATTICE;
      const pz = z + plantRng.range(-0.45, 0.45) * LATTICE;
      const roll = plantRng.next();
      const rank = plantRng.next();
      // (the cheap tests first: start-up time)
      if (rank > T.keep) continue;
      if (!nearRoad[Math.floor((pz - Z0) / NEAR) * nearW + Math.floor((px - X0) / NEAR)]) {
        // far from every road
        if (rank > T.keep * 0.5 || keepOut(px, pz)) continue;
        const f = land.forestAt(px, pz);
        if (roll > Math.min(0.92, f * 1.15) && roll > 0.015) continue;
        const y = land.heightAt(px, pz);
        if (y < lakeLevel + 1 || plantRng.next() < 0.8 * smoothstep(75, 115, y)) continue;
        const slope = Math.abs(land.heightAt(px + 2, pz + 2) - y) / 2.8;
        if (slope > 0.9 || !free(px, pz, 2.8)) continue;
        addTree(px, y - 0.2 - slope * 0.6, pz, pickSpecies('mixed', y, false, 0.05), { road: false, turned: 0.05, inside: 0.75, detail: 0.5 });
        continue;
      }
      if (px > valleyBox[0] - VALLEY_REACH && px < valleyBox[2] + VALLEY_REACH && pz > valleyBox[1] - VALLEY_REACH && pz < valleyBox[3] + VALLEY_REACH && inValley(px, pz)) continue;
      const f = land.forestAt(px, pz);
      // dense where the forest is, a few strays at its edges and on the meadows
      if (roll > Math.min(0.92, f * 1.15) && roll > 0.015) continue;
      if (blocked(px, pz, 2.5)) continue;
      // where the Track says nothing grows beside the road, the mass of the forest keeps its distance too (the view
      // over the valley at the ledge stays open)
      {
        const side = spot.lat >= 0 ? 1 : -1;
        const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, side);
        const wood = woodAt(track, noise, spot.s, side);
        if (!wood && beyond < (ledgeAt(spot.s) ? 140 : 30)) continue;
        // (D3's bank is planted by hand, openly: the mass of the forest begins well behind it, beyond where the
        // day's low sun, which comes in over the bank, passes above the crowns: render lane, was 62 m)
        if (bankAt(spot.s, side) && beyond < 125) continue;
        // near the road the mass of the forest is of the road's own kind of wood
        nearMix = wood && beyond < 90 ? wood.mix : 'mixed';
      }
      const y = land.heightAt(px, pz);
      if (y < lakeLevel + 1) continue;
      // the tree line: thinning above 75 m, a few stragglers higher up
      if (plantRng.next() < 0.8 * smoothstep(75, 115, y)) continue;
      const slope = Math.max(Math.abs(land.heightAt(px + 2, pz) - y), Math.abs(land.heightAt(px, pz + 2) - y)) / 2;
      if (slope > 0.9) continue;
      if (!free(px, pz, 2.8)) continue;
      // the turned share of the road's nearest point, fading with the distance from it
      const away = Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1));
      const turned = turnedAt(track, noise, spot.s) * Math.exp(-away / 140) + 0.05;
      addTree(px, y - 0.2 - slope * 0.6, pz, pickSpecies(nearMix, y, false, turned), { road: false, turned, inside: 0.75, detail: 0.5 });
    }
  }
  // (ref lane) THE APPROACH TO A TUNNEL'S ENTRANCE (approach.js; the reference is photograph R1): an open alpine
  // meadow. Whatever the stages above planted on it is taken out again (so that they draw the same random numbers
  // as before and the rest of the forest stands where it stood), and the place is planted by hand from a stream of
  // its own: a dark spruce wood on the side away from the hill, standing far enough from the road that the day's low
  // sun, which comes from behind and a little from that side, does not lay its shade across the road at the mouth;
  // groups of spruce and a few green broadleaves on the hillside over the portal.
  for (const A of approachesOf(track)) {
    const SPRUCE = SPECIES.indexOf('spruce');
    /** The meadow's bushes: a mid green (the circuit's broadleaf greens lean to yellow; here only its autumn trees are yellow). */
    const MID = [0.6, 1, 1.05];
    track.pointAt(A.s0, 0, point);
    const cx = point.x;
    const cz = point.z;
    const reach = APPROACH.behind + APPROACH.wide.up + 160;
    let kept = 0;
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      let out = false;
      if (Math.abs(tree.x - cx) < reach && Math.abs(tree.z - cz) < reach) {
        const p = terrain.placeAt(tree.x, tree.z);
        out = !!p && (p.meadow > 0.25 || p.wood > 0.05);
      }
      if (!out) trees[kept++] = tree;
    }
    trees.length = kept;
    plantRng = rng.fork('approach');
    /** A point of the place: `u` metres into the hill from the face (negative: before it), `lat` metres left of the centre line. */
    const at = (u, lat) => track.pointAt(track.wrap(A.s0 + u), lat, point);
    const plant = (u, lat, species, o = {}) => {
      at(u, lat);
      const y = terrain.heightAt(point.x, point.z);
      if (y < lakeLevel + 0.5) return;
      addTree(point.x, y - 0.25, point.z, species, { road: false, turned: 0, inside: 0.4, detail: 0.6, ...o });
    };
    // The spruce wood: a dense dark mass, as the photograph's. A close jittered lattice over where approach.js says
    // it stands; every tree wide (half as wide again as it grew), its lowest sixth under the ground so that its skirt
    // lies on the grass and no stem shows, heights 10 to 22 m over the ground, tinted dark and towards blue; spruce
    // and fir only (a larch would be a yellow one among them).
    const DARK = [0.4, 0.5, 0.66];
    const dense = () => ({ inside: 0.75, detail: 0.5, height: [12, 26], slim: 1.5, sink: 0.16, tone: DARK });
    const W = APPROACH.wood;
    const down = -A.up;
    const fromAt = (u) => (u > 13 ? APPROACH.wide.downBehind + 4 : W.from);
    for (let u = -APPROACH.open - 12; u < W.behind + 30; u += 4.4) {
      for (let d = APPROACH.wide.downBehind - 2; d < W.to + 30; d += 4.4) {
        const uu = u + plantRng.range(-1.8, 1.8);
        const dd = d + plantRng.range(-1.8, 1.8);
        const roll = plantRng.next();
        const kind = plantRng.next();
        at(uu, down * (track.edgeAt(track.wrap(A.s0 + uu), down) + dd));
        const p = terrain.placeAt(point.x, point.z);
        if (!p || roll > p.wood * 0.97) continue;
        plant(uu, down * (track.edgeAt(track.wrap(A.s0 + uu), down) + dd), kind < 0.65 ? SPRUCE : FIR, dense());
      }
    }
    // its edge towards the meadow is soft: the circuit's own autumn broadleaves, low, and hazel in front of them
    for (let u = -APPROACH.open; u < W.behind; u += 8.5) {
      const uu = u + plantRng.range(-2.5, 2.5);
      const edge = track.edgeAt(track.wrap(A.s0 + uu), down);
      const d = fromAt(uu) - 4 + plantRng.range(-1.5, 1.5);
      at(uu, down * (edge + d));
      plant(uu, down * (edge + d), pickSpecies('broadleaf', point.y, false, 0.7), { turned: 0.7, inside: 0.1, detail: 0.8, height: [7, 12] });
      plant(uu + plantRng.range(2, 6), down * (edge + d - plantRng.range(3, 6)), HAZEL, { inside: 0, detail: 0.8, height: [2.2, 3.8], tone: MID });
    }
    // the same dark stand along the hill's crest over the bore, so that the skyline is trees and not a bare curve
    const up = A.up;
    for (let u = 105; u < 235; u += 5) {
      for (let r = -70; r < 95; r += 5) {
        const keep = plantRng.next();
        const uu = u + plantRng.range(-2, 2);
        const rr = r + plantRng.range(-2, 2);
        const kind = plantRng.next();
        // (thinning towards its lower edge and its ends: a ragged front, not a hedge)
        const edge = Math.min((uu - 105) / 22, (235 - uu) / 20, (rr + 70) / 25, (95 - rr) / 30);
        if (keep > Math.min(1, Math.max(0.15, edge))) continue;
        plant(uu, up * rr, kind < 0.7 ? SPRUCE : FIR, dense());
      }
    }
    for (let r = -62; r < 88; r += 9) {
      const rr = r + plantRng.range(-3, 3);
      plant(99 + plantRng.range(-4, 3), up * rr, pickSpecies('broadleaf', 60, false, 0.6), { turned: 0.6, inside: 0.1, detail: 0.8, height: [6, 10] });
    }
    // four single spruces on the meadow, each full and skirted to the grass
    for (const [u, r] of [
      [28, 68],
      [86, 96],
      [-44, 92],
      [132, 44],
    ]) {
      plant(u, up * r, SPRUCE, { inside: 0, detail: 1, height: [15, 21], slim: 1.5, sink: 0.14, tone: [0.5, 0.6, 0.72] });
    }
    // and low growth in clumps where the meadow folds: hazel bushes with a young broadleaf or two among them (short,
    // branched from near the ground, green). No tall single trees on the open meadow.
    for (const [u, r, n, spread] of [
      [18, -14, 6, 7],
      [30, 6, 5, 6],
      [52, -4, 7, 8],
      [44, 46, 5, 6],
      [80, 22, 6, 7],
      [12, 52, 4, 5],
      [-30, 44, 5, 6],
      [-70, 70, 6, 8],
      [96, 70, 6, 8],
      [66, 108, 5, 7],
    ]) {
      for (let k = 0; k < n; k++) {
        const a = plantRng.range(0, Math.PI * 2);
        const q = spread * Math.sqrt(plantRng.next());
        const young = plantRng.next() < 0.3;
        plant(u + Math.cos(a) * q * 1.6, up * (r + Math.sin(a) * q), young ? (plantRng.next() < 0.5 ? LIME : HORNBEAM) : HAZEL, young ? { inside: 0, detail: 1, height: [4.5, 7], tone: MID } : { inside: 0, detail: 1, height: [2.4, 4.2], tone: MID });
      }
    }
  }

  // THE LAKESIDE (lakeside.js; the photograph r2): the lap's own trees give way on the water, on the bank between
  // the road and the shore and on the right-hand bank, and whatever else stands on the ground the place changed is
  // seated on it again. Then the place is planted from its own stream: on the right, behind the cut and the fence,
  // a loose row of birches and broadleaves with the sun on them and single trees up the bank; a dark conifer or two
  // on the lake's side where the stretch begins; the far shore and its headlands wooded down to the water.
  // Each tree's own random numbers (how it is turned, leans and is tinted; where its patches of floor lie) are drawn
  // here, for the lap's own trees in the order they were planted, before the lakeside clears any of them: so that
  // every other tree of the lap keeps its numbers. The lakeside's trees draw theirs from streams of their own.
  const drawOwn = (list, tintFrom, floorFrom) => {
    for (const t of list) {
      if (t.own) continue;
      const data = SPECIES_DATA[VARIANTS[t.variant].species];
      t.own = [tintFrom.next(), tintFrom.next(), tintFrom.next(), tintFrom.next(), tintFrom.next(), tintFrom.next(), data.autumn.length ? tintFrom.next() : 0];
    }
    for (const t of list) {
      if (t.floor || !t.road) continue;
      t.floor = [floorFrom.next(), floorFrom.next(), floorFrom.next(), floorFrom.next()];
      if (t.turned > 0.4) t.floor.push(floorFrom.next(), floorFrom.next(), floorFrom.next());
    }
  };
  drawOwn(trees, rng.fork('tint'), rng.fork('floor'));
  if (lakeside) {
    const kept = trees.filter((t) => !lakeside.clears(t.x, t.z));
    for (const t of kept) if (lakeside.moved(t.x, t.z)) t.y += terrain.heightAt(t.x, t.z) - land.heightAt(t.x, t.z);
    trees.length = 0;
    hash.clear();
    for (const t of kept) {
      trees.push(t);
      occupy(t.x, t.z);
    }
    const lr = rng.fork('lakeside');
    const P = LAKESIDE.planting;
    const here = (s) => lakeside.stretch(s) > 0.5;
    const seat = (x, z) => terrain.heightAt(x, z);
    // The leg that comes back from the carousel runs along the top of the same spur, 60 m away and higher, with its
    // sides open by the Track's word (the crest's view): no tree of the bank may stand up into that view. The other
    // stretches of road within `P.other.within` m of a point: the nearest one's distance and height.
    const others = [];
    for (let s = 0; s < track.length; s += 4) {
      const a = lakeside.along(s);
      if (a < 330 || a > 900) continue;
      track.pointAt(s, 0, point);
      if (lakeside.near(point.x, point.z)) others.push(point.x, point.y, point.z);
    }
    const hidesView = (x, z, top) => {
      for (let k = 0; k < others.length; k += 3) {
        if ((others[k] - x) ** 2 + (others[k + 2] - z) ** 2 < P.other.within ** 2 && top > others[k + 1] + P.other.over) return true;
      }
      return false;
    };
    const put = (s, lat, species, o) => {
      track.pointAt(s, lat, point);
      const x = point.x;
      const z = point.z;
      if (blocked(x, z, o.clear ?? 0) || !free(x, z, o.r ?? 3)) return false;
      const y = seat(x, z);
      if (o.height && hidesView(x, z, y + o.height[1])) return false;
      const { sink = 0.15, r: _room, clear: _clear, ...rest } = o;
      addTree(x, y - sink, z, species, { road: true, turned: 0, inside: 0, from: lr, crownSun: true, ...rest });
      return true;
    };
    const s0 = lakeside.s0;
    // the right-hand bank: rows behind the fence
    for (const row of P.bank) {
      for (let d = LAKESIDE.from + lr.range(0, row.step[0]); d < LAKESIDE.to + 30; d += lr.range(row.step[0], row.step[1])) {
        const s = track.wrap(s0 + d);
        if (lakeside.stretch(s) < 0.3) continue;
        // (in groups: a gap of a few trunks here and there, so the sun reaches the bank between them)
        if (noise.fbm(d / 26 + row.off[0], 9.1, 2) > row.gap) continue;
        const roll = lr.next();
        const species = roll < row.birch ? BIRCH : roll < row.birch + 0.25 ? LIME : roll < row.birch + 0.45 ? HORNBEAM : roll < 0.97 ? MAPLE : SPECIES.indexOf('spruce');
        const tall = species === BIRCH ? row.birchHeight : row.height;
        put(s, -(track.edgeAt(s, -1) + lr.range(row.off[0], row.off[1])), species, { height: tall, detail: row.detail, inside: row.inside, r: row.r, sink: P.stand.sink, slim: P.stand.wide, tone: P.stand.tone });
      }
    }
    // the lake's side: a tall dark conifer or two where the stretch begins (the photograph's pines at the frame's
    // left edge), and low hazel on the bank under the rail, never tall enough to hide the water
    for (const [d, beyond, species, height] of P.pines) {
      const s = track.wrap(s0 + d);
      // (the conifer sunk a little so that its crown comes down to the grass; the saplings sunk more: bushy, no bare stem)
      put(s, track.edgeAt(s, 1) + beyond, SPECIES.indexOf(species), { height, detail: 2, r: 2.5, sink: species === 'birch' ? 1.6 : 1.2, slim: species === 'birch' ? 1.5 : 1.15, tone: P.stand.tone });
    }
    for (let d = LAKESIDE.from; d < LAKESIDE.to; d += lr.range(P.shrubs.step[0], P.shrubs.step[1])) {
      const s = track.wrap(s0 + d);
      if (!here(s)) continue;
      // (groups of two or three birch saplings, irregular, in the stand's tone: no round bush stands alone here)
      const beyond = lr.range(P.shrubs.off[0], P.shrubs.off[1]);
      const count = 2 + lr.int(2);
      for (let k = 0; k < count; k++) {
        const tall = lr.range(P.shrubs.height[0], P.shrubs.height[1]);
        put(track.wrap(s + (k ? lr.range(-2.6, 2.6) : 0)), track.edgeAt(s, 1) + beyond + (k ? lr.range(-2, 2.4) : 0), BIRCH, { height: [tall, tall + 0.5], detail: 1.2, r: 1.3, sink: tall * 0.3, slim: lr.range(1.2, 1.9), tone: P.stand.tone });
      }
    }
    // the shore: a wood round the tarn, from a few metres back from the water, thinning where the bench gives way
    // (not between the road and the water along the stretch: that bank is open)
    const e = lakeside.extent;
    const W = P.shore;
    for (let z = e.z0 - W.reach; z < e.z1 + W.reach; z += W.lattice) {
      for (let x = e.x0 - W.reach; x < e.x1 + W.reach; x += W.lattice) {
        const px = x + lr.range(-0.45, 0.45) * W.lattice;
        const pz = z + lr.range(-0.45, 0.45) * W.lattice;
        const roll = lr.next();
        const rank = lr.next();
        const kind = lr.next();
        if (rank > T.keep) continue;
        const m = -lakeside.shore(px, pz);
        if (m < W.from || m > W.reach) continue;
        // (the headwall towards the sky road stays open: the water shows over it from the deck)
        if (lakeside.frame.toU(px, pz) < W.south) continue;
        if (roll > W.density * (1 - 0.6 * smoothstep(W.reach * 0.5, W.reach, m))) continue;
        if (!lakeside.has(px, pz) || lakeside.clears(px, pz) || blocked(px, pz, 2.5) || !free(px, pz, 2.8)) continue;
        const y = seat(px, pz);
        if (y < lakeside.level + 0.4) continue;
        // birches and alder-like limes at the water's edge, conifers and broadleaves mixed behind
        const edge = m < W.from + 14;
        const species = edge ? (kind < 0.5 ? BIRCH : kind < 0.75 ? LIME : kind < 0.9 ? HORNBEAM : FIR) : kind < W.conifer ? NEEDLE[kind < W.conifer * 0.6 ? 0 : 1] : kind < W.conifer + 0.18 ? BIRCH : kind < W.conifer + 0.32 ? LIME : kind < W.conifer + 0.4 ? HORNBEAM : MAPLE;
        addTree(px, y - 0.2, pz, species, { road: false, turned: 0.03, inside: edge ? 0.2 : 0.7, detail: edge ? 0.8 : 0.5, from: lr, tone: W.tone, crownSun: true });
      }
    }
  }
  if (lakeside) {
    // the hill beyond the carousel, in the middle of the picture (LAKESIDE.planting.hill)
    const lr = rng.fork('lakeside-hill');
    const H = LAKESIDE.planting.hill;
    const [cx, cz] = lakeside.at(LAKESIDE.pass.eye[0], LAKESIDE.pass.eye[1]);
    for (let z = cz - H.range[1]; z < cz + H.range[1]; z += H.lattice) {
      for (let x = cx - H.range[1]; x < cx + H.range[1]; x += H.lattice) {
        const px = x + lr.range(-0.45, 0.45) * H.lattice;
        const pz = z + lr.range(-0.45, 0.45) * H.lattice;
        const roll = lr.next();
        const rank = lr.next();
        const kind = lr.next();
        if (rank > T.keep || roll > H.density) continue;
        const [a, r] = lakeside.bearing(px, pz);
        if (a < H.angle[0] || a > H.angle[1] || r < H.range[0] || r > H.range[1]) continue;
        if (keepOut(px, pz) || blocked(px, pz, H.clear) || !free(px, pz, 3.2)) continue;
        if (lakeside.shore(px, pz) > -LAKESIDE.planting.shore.reach) continue;
        const y = terrain.heightAt(px, pz);
        const slope = Math.max(Math.abs(terrain.heightAt(px + 2, pz) - y), Math.abs(terrain.heightAt(px, pz + 2) - y)) / 2;
        if (slope > 0.9) continue;
        const species = kind < H.conifer ? NEEDLE[kind < H.conifer * 0.6 ? 0 : 1] : kind < H.conifer + 0.12 ? BIRCH : kind < H.conifer + 0.22 ? LIME : MAPLE;
        addTree(px, y - 0.2 - slope * 0.6, pz, species, { road: false, turned: 0.03, inside: 0.75, detail: 0.5, from: lr, tone: LAKESIDE.planting.shore.tone, crownSun: true });
      }
    }
    // THE SPUR behind the bank and inside the carousel (LAKESIDE.planting.spur): it stood as bare grey facets over
    // the bank's trees. A wood on it, sunk deep on its steep ground, firs and dark broadleaves, none tall enough to
    // stand far into the view from the leg that comes back along its top.
    {
      const sr = rng.fork('lakeside-spur');
      const S = LAKESIDE.planting.spur;
      const back = [];
      for (let s = 0; s < track.length; s += 4) {
        const a = lakeside.along(s);
        if (a < 330 || a > 900) continue;
        track.pointAt(s, 0, point);
        if (lakeside.near(point.x, point.z)) back.push(point.x, point.y, point.z);
      }
      const [cx, cz] = lakeside.at(120, -60);
      for (let z = cz - 260; z < cz + 260; z += S.lattice) {
        for (let x = cx - 260; x < cx + 260; x += S.lattice) {
          const px = x + sr.range(-0.45, 0.45) * S.lattice;
          const pz = z + sr.range(-0.45, 0.45) * S.lattice;
          const roll = sr.next();
          const rank = sr.next();
          const kind = sr.next();
          const tall = sr.range(S.height[0], S.height[1]);
          if (rank > Math.max(T.keep, 0.7) || roll > S.density) continue;
          if (lakeside.spur(px, pz) < 0.5 || blocked(px, pz, 4) || !free(px, pz, 2.6)) continue;
          const y = terrain.heightAt(px, pz);
          let over = false;
          for (let k = 0; k < back.length && !over; k += 3) over = (back[k] - px) ** 2 + (back[k + 2] - pz) ** 2 < 70 ** 2 && y + tall - 2 > back[k + 1] + S.over;
          if (over) continue;
          const species = kind < 0.3 ? FIR : kind < 0.55 ? LIME : kind < 0.8 ? HORNBEAM : kind < 0.92 ? MAPLE : BIRCH;
          addTree(px, y - 2, pz, species, { road: false, turned: 0.03, inside: 0.5, detail: 0.9, height: [tall, tall + 1], slim: 1.25, from: sr, tone: S.tone, crownSun: true });
        }
      }
    }
  }
  if (lakeside) drawOwn(trees, rng.fork('lakeside-tint'), rng.fork('lakeside-floor'));

  // THE ARM OF THE LAKE (arm.js; the photograph r4): the lap's own trees give way in the water and on the open bank
  // between the road and it, and whatever else stands on the ground the place lowered is seated on it again (on
  // the ground as it is drawn: out there it is coarse). Then, from a stream of its own, young growth in groups on
  // the bank, never tall enough to hide the water from the road, and a wood on the far shores.
  const arm = terrain.arm ?? null;
  if (arm) {
    const P = ARM.planting;
    const ar = rng.fork('arm');
    const kept = trees.filter((t) => !arm.clears(t.x, t.z));
    for (const t of kept) {
      if (!arm.moved(t.x, t.z)) continue;
      // (the lap's own trees that stay on the far shores take the shore wood's dark tone, and none of them has turned)
      const m = -arm.shore(t.x, t.z);
      if (m > 0 && m < P.shore.reach + 60) {
        track.locate(t.x, t.z, -1, spot);
        if (spot.lat > 0 && spot.lat - track.edgeAt(spot.s, 1) > ARM.reach * 0.5) {
          t.tone = P.shore.tone;
          t.turned = 0;
        }
      }
      if (lakeside?.moved(t.x, t.z)) continue;
      const before = land.heightAt(t.x, t.z);
      const now = terrain.heightAt(t.x, t.z);
      if (now < before - 0.01) t.y += Math.min(now, terrain.surfaceAt(t.x, t.z)) - before;
    }
    trees.length = 0;
    hash.clear();
    for (const t of kept) {
      trees.push(t);
      occupy(t.x, t.z);
    }
    const seat = (x, z) => Math.min(terrain.heightAt(x, z), terrain.surfaceAt(x, z));
    // young growth on the bank: birch and lime saplings in groups, sunk to their crowns
    for (const [d, beyond, count, spread] of P.groups) {
      for (let k = 0; k < count; k++) {
        const a = ar.range(0, Math.PI * 2);
        const q = spread * Math.sqrt(ar.next());
        const tall = ar.range(P.young[0], P.young[1]);
        const wide = ar.range(1.1, 2.0);
        const kind = ar.next();
        const s = track.wrap(arm.s0 + d + Math.cos(a) * q * 1.5);
        track.pointAt(s, track.edgeAt(s, 1) + beyond + Math.sin(a) * q, point);
        const x = point.x;
        const z = point.z;
        if (blocked(x, z, 1) || !free(x, z, 1.4) || arm.shore(x, z) > -5) continue;
        // (birch saplings in the stand's dark tone, each its own width: irregular, never a round bright ball)
        addTree(x, seat(x, z) - 0.15, z, kind < 0.8 ? BIRCH : HORNBEAM, { road: true, turned: 0, inside: 0.2, detail: 1.2, height: [tall / 0.7, tall / 0.7], sink: 0.3, slim: wide, from: ar, tone: P.youngTone, crownSun: true });
      }
    }
    // the far shores: a wood from a few metres back from the water up the hills (only where trees are drawn at all:
    // beyond the forest's bounds the ground's own canopy colour stands for it)
    const W = P.shore;
    const e = arm.extent;
    for (let z = Math.max(Z0, e.z0 - W.reach); z < Math.min(Z1, e.z1 + W.reach); z += W.lattice) {
      for (let x = Math.max(X0, e.x0 - W.reach); x < Math.min(X1, e.x1 + W.reach); x += W.lattice) {
        const px = x + ar.range(-0.45, 0.45) * W.lattice;
        const pz = z + ar.range(-0.45, 0.45) * W.lattice;
        const roll = ar.next();
        const rank = ar.next();
        const kind = ar.next();
        if (rank > T.keep || px <= X0 || pz <= Z0) continue;
        const m = -arm.shore(px, pz);
        if (m < W.from || m > W.reach) continue;
        if (roll > W.density * (1 - 0.5 * smoothstep(W.reach * 0.5, W.reach, m))) continue;
        if (arm.clears(px, pz) || blocked(px, pz, 2.5) || !free(px, pz, 2.8)) continue;
        // (only on the far side of the water from the road: the lap's own woods stand everywhere else)
        if (spot.lat <= 0 || Math.abs(spot.lat) - track.edgeAt(spot.s, 1) < ARM.reach * 0.5) continue;
        const y = seat(px, pz);
        if (y < arm.level + 0.4) continue;
        const edge = m < W.from + 14;
        const species = edge ? (kind < 0.3 ? BIRCH : kind < 0.45 ? LIME : kind < 0.6 ? HORNBEAM : kind < 0.8 ? FIR : NEEDLE[0]) : kind < W.conifer ? NEEDLE[kind < W.conifer * 0.6 ? 0 : 1] : kind < W.conifer + 0.18 ? BIRCH : kind < W.conifer + 0.32 ? LIME : kind < W.conifer + 0.42 ? HORNBEAM : MAPLE;
        addTree(px, y - 0.3, pz, species, { road: false, turned: 0, inside: edge ? 0.3 : 0.7, detail: edge ? 0.8 : 0.5, from: ar, tone: W.tone, crownSun: true });
      }
    }
    // the massif's foot on the right of the road: the dark wood carried up the slope behind the lap's own rows
    // (spruce and fir, sunk on the steep ground), so that less of the bare wall stands over the road
    {
      const F = P.foot;
      const fr = rng.fork('arm-foot');
      for (let d = F.along[0]; d < F.along[1]; d += F.lattice) {
        for (let b = F.beyond[0]; b < F.beyond[1]; b += F.lattice) {
          const dd = d + fr.range(-0.45, 0.45) * F.lattice;
          const bb = b + fr.range(-0.45, 0.45) * F.lattice;
          const roll = fr.next();
          const rank = fr.next();
          const kind = fr.next();
          if (rank > Math.max(T.keep, 0.6) || roll > F.density) continue;
          const s = track.wrap(arm.s0 + dd);
          track.pointAt(s, -(track.edgeAt(s, -1) + bb), point);
          const px = point.x;
          const pz = point.z;
          if (blocked(px, pz, 2.5) || Math.abs(track.delta(s, spot.s)) > 30 || spot.lat > 0 || !free(px, pz, 3)) continue;
          const y = terrain.heightAt(px, pz);
          if (y > lakeLevel + F.top || y < lakeLevel + 1) continue;
          const slope = Math.max(Math.abs(terrain.heightAt(px + 2, pz) - y), Math.abs(terrain.heightAt(px, pz + 2) - y)) / 2;
          if (slope > 1.4) continue;
          addTree(px, y - 0.3 - slope * 1.2, pz, kind < 0.65 ? NEEDLE[0] : NEEDLE[1], { road: false, turned: 0, inside: 0.6, detail: 0.5, height: [13, 22], slim: 1.4, sink: 0.14, from: fr, tone: F.tone, crownSun: true });
        }
      }
    }
    drawOwn(trees, rng.fork('arm-tint'), rng.fork('arm-floor'));
  }

  // THE GOLDEN WOOD (goldwood.js; the photograph r3): through the forest esses the lap's own trees give way for some
  // way beyond both edges (tall conifers on bare stems, standing apart), and two continuous walls of turned
  // broadleaves are planted in their place from a stream of the place's own: lime, birch, hornbeam and maple, low
  // at the barrier and taller row by row behind it, every one sunk and widened so that its foliage begins at the
  // grass and the crowns close; a dark spruce or fir here and there in the rows behind. On the side the day's sun
  // stands on, no crown reaches above the sun's ray to the middle of the road: that wall is low at the barrier and
  // rises away from it at the sun's own angle, and the asphalt and the wall across the road are lit.
  // (After every other stage, so that every other tree of the lap has drawn its numbers and keeps them.)
  const goldwood = goldwoodOf(track);
  if (goldwood) {
    const G = GOLDWOOD;
    const gr = rng.fork('goldwood');
    const SPRUCE = SPECIES.indexOf('spruce');
    // the stretch's box on the map (a cheap test before the nearest point of the road is looked for)
    const box = [1e9, 1e9, -1e9, -1e9];
    for (let d = G.from - G.ease; d <= G.to + G.ease; d += 8) {
      track.pointAt(track.wrap(goldwood.s0 + d), 0, point);
      box[0] = Math.min(box[0], point.x);
      box[1] = Math.min(box[1], point.z);
      box[2] = Math.max(box[2], point.x);
      box[3] = Math.max(box[3], point.z);
    }
    const pad = G.clear + 24;
    const kept = trees.filter((t) => {
      if (t.x < box[0] - pad || t.x > box[2] + pad || t.z < box[1] - pad || t.z > box[3] + pad) return true;
      track.locate(t.x, t.z, -1, spot);
      if (!goldwood.here(spot.s)) return true;
      return Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1) >= G.clear;
    });
    trees.length = 0;
    hash.clear();
    for (const t of kept) {
      trees.push(t);
      occupy(t.x, t.z);
    }
    // the day's sun: its direction on the map and how steeply its light falls
    const sun = TIMES.day.sun.dir;
    const sunH = Math.hypot(sun[0], sun[2]) || 1;
    const fall = sun[1] / sunH;
    const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
    const prof = { y: 0, surface: 0 };
    /** The most a crown may stand over the ground at (s, lat) on `side` (m; Infinity where the rule does not bind). */
    const room = (s, side, lat, ground) => {
      track.frameAt(s, frame);
      const ll = Math.hypot(frame.left.x, frame.left.z) || 1;
      // how squarely the sun stands on this side of the road (0: along the road or on the other side)
      const square = (side * (frame.left.x * sun[0] + frame.left.z * sun[2])) / (ll * sunH);
      if (square <= 0.05) return Infinity;
      const ray = track.profile(s, 0, prof).y + G.sun.over + (fall * Math.abs(lat)) / Math.max(square, 0.2);
      const most = ray - ground;
      // (a hillside that stands in the ray itself shades the road with or without trees)
      return most < G.sun.hill ? Infinity : Math.max(most, G.sun.least);
    };
    const put = (s, side, off, species, h, r, o) => {
      const lat = side * (track.edgeAt(s, side) + BARRIER_CLEAR + off);
      track.pointAt(s, lat, point);
      const x = point.x;
      const z = point.z;
      if (blocked(x, z, 0) || Math.abs(track.delta(s, spot.s)) > 12 || !free(x, z, r)) return;
      const y = terrain.heightAt(x, z);
      if (y < lakeLevel + 0.5) return;
      const sink = o.sink ?? G.sink;
      const tall = Math.min(h, room(s, side, lat, y) / (1 - sink));
      // (a crown the sun's rule keeps low stands against the light and glows: toned down, so that the wall down the
      // road is the photograph's deep orange and not a row of lemon lamps)
      const tone = tall < h && o.tone ? o.tone.map((c, k) => c * G.sun.tone[k]) : o.tone;
      addTree(x, y - 0.15, z, species, { road: true, turned: 1, gold: G.gold, slim: G.wide, from: gr, ...o, tone, sink, height: [tall, tall] });
    };
    const span = [G.from - G.ease * 0.5, G.to + G.ease * 0.5];
    for (const side of [1, -1]) {
      G.rows.forEach((row, r) => {
        for (let d = span[0] + gr.range(0, row.step[0]); d < span[1]; d += gr.range(row.step[0], row.step[1])) {
          const off = gr.range(row.off[0], row.off[1]);
          const kind = gr.next();
          const keep = gr.next();
          const dark = gr.next();
          const tall = row.height[0] + (row.height[1] - row.height[0]) * gr.next();
          const s = track.wrap(goldwood.s0 + d);
          if (!goldwood.here(s) || (tier === 'low' && keep > row.low)) continue;
          if (r >= G.conifers[0] && dark < G.conifers[1]) {
            put(s, side, off, kind < 0.6 ? SPRUCE : FIR, tall + 5, row.r, { inside: row.inside, detail: row.detail, sink: 0.14, slim: 1.3, tone: G.dark, gold: 0 });
            continue;
          }
          const species = kind < G.mix.lime ? LIME : kind < G.mix.lime + G.mix.birch ? BIRCH : kind < G.mix.lime + G.mix.birch + G.mix.hornbeam ? HORNBEAM : MAPLE;
          put(s, side, off, species, tall, row.r, { inside: row.inside, detail: row.detail, tone: (species === MAPLE ? G.tone.maple : species === BIRCH ? G.tone.birch : G.tone.gold).map((c, k) => c * row.deep[k]) });
        }
      });
      // young growth in front of the first row and between its trunks: saplings in twos and threes, sunk deeper, so
      // that the wall's foot is leaves and not stems (no round bush stands alone)
      for (let d = span[0] + gr.range(0, G.shrubs.step[0]); d < span[1]; d += gr.range(G.shrubs.step[0], G.shrubs.step[1])) {
        const count = 1 + gr.int(3);
        const keep = gr.next();
        for (let k = 0; k < 3; k++) {
          const ds = gr.range(-1.8, 1.8);
          const off = gr.range(G.shrubs.off[0], G.shrubs.off[1]);
          const tall = gr.range(G.shrubs.height[0], G.shrubs.height[1]);
          const kind = gr.next();
          const wide = gr.range(1.25, 1.8);
          const s = track.wrap(goldwood.s0 + d + ds);
          if (k >= count || !goldwood.here(s) || (tier === 'low' && keep > 0.5)) continue;
          put(s, side, off, kind < 0.45 ? BIRCH : kind < 0.8 ? LIME : MAPLE, tall / 0.66, 1.3, { inside: 0.15, detail: 0.6, sink: 0.34, slim: wide, tone: kind < 0.45 ? G.tone.young : kind < 0.8 ? G.tone.gold : G.tone.maple });
        }
      }
    }
    // The hillsides above the walls: where the land beside the stretch stands above the lap's tree line or is too
    // steep for the lap's own planting it was bare scree and grass over the gold (the grey flank ahead of the second
    // bend). Clothed from a stream of its own: turned broadleaves in the stand's tone and dark conifers, sunk on
    // the steep ground, wherever no tree stands within reach.
    {
      const U = G.upper;
      const ur = rng.fork('goldwood-upper');
      for (let z = box[1] - U.reach; z < box[3] + U.reach; z += U.lattice) {
        for (let x = box[0] - U.reach; x < box[2] + U.reach; x += U.lattice) {
          const px = x + ur.range(-0.45, 0.45) * U.lattice;
          const pz = z + ur.range(-0.45, 0.45) * U.lattice;
          const roll = ur.next();
          const rank = ur.next();
          const kind = ur.next();
          const tall = ur.range(U.height[0], U.height[1]);
          if (rank > Math.max(T.keep, 0.6) || roll > U.density) continue;
          if (px <= X0 || px >= X1 || pz <= Z0 || pz >= Z1) continue;
          if (blocked(px, pz, 2.5) || !goldwood.here(spot.s)) continue;
          const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1);
          if (beyond < G.clear || beyond > U.reach) continue;
          if ((terrain.placeAt?.(px, pz)?.meadow ?? 0) > 0.05) continue;
          const y = terrain.heightAt(px, pz);
          const slope = Math.max(Math.abs(terrain.heightAt(px + 2, pz) - y), Math.abs(terrain.heightAt(px, pz + 2) - y)) / 2;
          // (only the bare ground: above where the lap's wood thins, or steeper than it plants)
          if (!(y > lakeLevel + U.above || slope > 0.85) || slope > 2.6 || !free(px, pz, 3)) continue;
          if (kind < U.conifer) addTree(px, y - 0.3 - slope * 1.2, pz, kind < U.conifer * 0.6 ? SPRUCE : FIR, { road: false, turned: 0, inside: 0.6, detail: 0.5, height: [tall + 3, tall + 3], slim: 1.35, sink: 0.14, from: ur, tone: G.dark });
          else {
            const species = kind < 0.55 ? LIME : kind < 0.7 ? BIRCH : kind < 0.85 ? HORNBEAM : MAPLE;
            addTree(px, y - 0.3 - slope * 1.2, pz, species, { road: false, turned: 1, gold: G.gold, inside: 0.5, detail: 0.5, height: [tall, tall], slim: G.wide, sink: 0.2, from: ur, tone: (species === MAPLE ? G.tone.maple : G.tone.gold).map((c, k) => c * U.deep[k]) });
          }
        }
      }
    }
    drawOwn(trees, rng.fork('goldwood-tint'), rng.fork('goldwood-floor'));
  }
  const roadTrees = trees.filter((t) => t.road).length;
  lap('plant');

  // ---------------------------------------------------------------- the trees themselves
  const kit = createTreeKit({ renderer, tier, coverage, rng, atmosphere });
  const { foliage, bark, models, atlas, uniforms, material, farMaterial, depthMaterial, casterMaterial, through } = kit;
  Object.assign(ms, kit.ms);
  clock = performance.now();

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
    const tip = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const bake = [0, 0, 0];
    // (the numbers each tree drew when it was planted: drawOwn above)
    const between = (lo, hi, u) => lo + (hi - lo) * u;
    trees.forEach((t, i) => {
      const variant = VARIANTS[t.variant];
      const data = SPECIES_DATA[variant.species];
      const s = t.h / variant.P.H;
      const wide = between(0.88, 1.12, t.own[0]) * t.slim;
      const lean = between(0, data.lean, t.own[1]);
      const dir = between(0, Math.PI * 2, t.own[2]);
      e.set(Math.cos(dir) * lean, between(0, Math.PI * 2, t.own[3]), Math.sin(dir) * lean, 'YXZ');
      q.setFromEuler(e);
      // (one that was planted leaning: tipped that way in the world, whichever way it is turned)
      if (t.lean) q.premultiply(tip.setFromAxisAngle(axis.set(t.lean[1], 0, -t.lean[0]), t.lean[2]));
      m.compose(p.set(t.x, t.y, t.z), q, sc.set(s * wide, s, s * wide));
      m.toArray(matrices, i * 16);
      // its own green (a little towards yellow or blue, lighter or darker), mixed towards its own autumn colour
      const v = between(data.value[0], data.value[1], t.own[4]);
      const hue = between(-1, 1, t.own[5]) * data.hue;
      const green = [data.green[0] * (1 + 0.35 * hue), data.green[1], data.green[2] * (1 - 0.6 * hue)];
      const autumn = data.autumn.length ? data.autumn[Math.floor(t.own[6] * data.autumn.length)] : green;
      // (a stand's own tone over its trees' greens: the lakeside's are darker and less yellow)
      for (let c = 0; c < 3; c++) tints[i * 3 + c] = v * (green[c] + (autumn[c] - green[c]) * t.turned) * (t.tone ? t.tone[c] : 1);
      places[i * 2] = t.inside;
      places[i * 2 + 1] = t.turned;
      terrain.bakeAt(t.x, t.z, bake, 0);
      // a crown stands up out of a valley's shade a little; and it never sees less sky than half
      // (a tree on ground that lies in its own shade: the sun at its crown, not at its foot)
      if (t.crownSun && terrain.sunAt) bake[0] = Math.max(bake[0], terrain.sunAt(t.x, t.z, t.y + t.h * 0.65));
      bakes[i * 3] = Math.min(1, bake[0] * 1.1 + 0.05);
      bakes[i * 3 + 1] = Math.min(1, bake[1] * 1.1 + 0.05);
      bakes[i * 3 + 2] = Math.max(0.5, bake[2]);
      const model = models[t.variant];
      spheres[i * 4] = t.x;
      spheres[i * 4 + 1] = t.y + model.top * s * 0.5;
      spheres[i * 4 + 2] = t.z;
      spheres[i * 4 + 3] = Math.max(model.top * 0.5, model.radius) * s * 1.1 + (t.lean ? t.h * t.lean[2] : 0);
    });
  }
  // THE WOOD'S FLOOR: under each tree of the road's rows (and each shrub) a patch of grass and low growth, and under a
  // turned one a patch of its fallen leaves: flat cards lying on the ground, turned to its slope (a few per tree,
  // two triangles each), so that there is no bare dark ground at the wood's edge.
  const patchStart = new Int32Array(count + 1);
  const patchKind = [];
  const patchMatrix = [];
  const patchTint = [];
  {
    // (each tree's numbers were drawn when it was planted: drawOwn above)
    const between = (lo, hi, u) => lo + (hi - lo) * u;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qy = new THREE.Quaternion();
    const n = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const add = (i, kind, x, z, size, tint, turn) => {
      terrain.normalAt(x, z, n);
      q.setFromUnitVectors(up, n).multiply(qy.setFromAxisAngle(up, between(0, Math.PI * 2, turn)));
      m.compose(p.set(x, terrain.heightAt(x, z) + 0.05, z), q, sc.set(size, 1, size));
      patchKind.push(kind);
      patchMatrix.push(...m.elements);
      patchTint.push(...tint);
    };
    trees.forEach((t, i) => {
      patchStart[i] = patchKind.length;
      if (!t.road) return;
      const reach = Math.max(2.5, Math.min(7, t.h * 0.42));
      const f = t.floor;
      const g = between(0.8, 1.15, f[0]);
      // (finish lane) the grass's green (groundMaterial.js GRASS.floor over the floor's own painting)
      add(i, 0, t.x + between(-1, 1, f[1]), t.z + between(-1, 1, f[2]), reach * 1.6, GRASS.floor.map((c) => c * g), f[3]);
      if (t.turned > 0.4) {
        const k = i * 3;
        add(i, 1, t.x + between(-1.5, 1.5, f[4]), t.z + between(-1.5, 1.5, f[5]), reach * 1.9, [tints[k] * 0.8, tints[k + 1] * 0.8, tints[k + 2] * 0.8], f[6]);
      }
    });
    patchStart[count] = patchKind.length;
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
  const card = kit.card;
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
  // the floor's two kinds of patch: grass and low growth, fallen leaves
  const floorMaterial = plantMaterial({ map: foliage.texture, atmosphere, uniforms, wind: null, coverage });
  floorMaterial.polygonOffset = true;
  floorMaterial.polygonOffsetFactor = -2;
  floorMaterial.polygonOffsetUnits = -2;
  const floorMeshes = [TILE.FLOOR, TILE.LITTER].map((tile, kind) => {
    const [u0, v0, u1, v1] = tileRect(tile);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
    g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array([1, 0, 1, 0, 1, 0, 1, 0]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const capacity = patchKind.filter((k) => k === kind).length;
    const mesh = pool(g, floorMaterial, capacity, kind ? 'forest-floor-leaves' : 'forest-floor-grass');
    g.dispose();
    // (the floor is not in the mirror or the probe)
    mesh.userData.floor = true;
    return mesh;
  });
  function writePatch(j, i, fade) {
    const mesh = floorMeshes[patchKind[j]];
    const k = mesh.count++;
    const a = mesh.geometry.attributes;
    for (let e = 0; e < 16; e++) mesh.instanceMatrix.array[k * 16 + e] = patchMatrix[j * 16 + e];
    a.aTint.array[k * 4] = patchTint[j * 3];
    a.aTint.array[k * 4 + 1] = patchTint[j * 3 + 1];
    a.aTint.array[k * 4 + 2] = patchTint[j * 3 + 2];
    a.aTint.array[k * 4 + 3] = fade;
    a.aBake.array.set(bakes.subarray(i * 3, i * 3 + 3), k * 3);
  }
  // ---------------------------------------------------------------- per view
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector3();
  // Without the sun's box (no shadow map): trees cast round the car, as far as the square reaches.
  // (split-bug lane) With it, every tree whose crown is inside the map's box casts, wherever it stands. Chosen by
  // distance from the car instead, the trees 50 to 100 m towards a 17 degree moon or sun, whose shadows lie across
  // the road at the car, were left out: the wet road there lay in full moonlight, a pale sheet broken by the
  // shadows of the nearer trees, and which trees were left out moved with the car, so the two halves of a split
  // screen a few metres apart showed one road dark and the other a sheet of water.
  const shadowR = Math.min(shadow.reach * 1.1, CAST_REACH);
  /** Whether a sphere (centre c, radius r) is inside the sun's shadow box. @param {import('./sun.js').ShadowBox} b */
  const inBox = (b, c, r) => {
    const x = c.x * b.right.x + c.y * b.right.y + c.z * b.right.z - b.x;
    if (Math.abs(x) > b.halfX + r) return false;
    const y = c.x * b.up.x + c.y * b.up.y + c.z * b.up.z - b.y;
    if (Math.abs(y) > b.halfY + r) return false;
    const z = c.x * b.dir.x + c.y * b.dir.y + c.z * b.dir.z - b.z;
    return z < b.towards + r && z > -b.away - r;
  };
  /**
   * (perf lane) Can the shadow of the crown in sphere (c, r) be seen? Its shadow is the bundle of rays behind the
   * sphere, away from the light, as far as the map's box reaches. If no part of that bundle is in the view's
   * frustum and none passes near the eye, nothing the view shows is shaded by this tree, and drawing its card into
   * the map (every texel of it an alpha test) buys nothing. Exact for the view; the car's reflection probe and
   * the wet road's mirror, which use the view's map, keep what passes within CAST_NEAR of the eye.
   * Asks the camera, never the car: two views of the same place choose alike.
   * @param {import('./sun.js').ShadowBox} b
   */
  const seenProbe = new THREE.Sphere();
  const shadowSeen = (b, c, r) => {
    const length = c.x * b.dir.x + c.y * b.dir.y + c.z * b.dir.z - b.z + b.away;
    const steps = Math.max(0, Math.ceil(length / r));
    const near = (CAST_NEAR + r) ** 2;
    // (spheres a radius apart, a little larger than the crown's, cover the whole bundle)
    seenProbe.radius = r * 1.12;
    for (let k = 0; k <= steps; k++) {
      seenProbe.center.set(c.x - b.dir.x * k * r, c.y - b.dir.y * k * r, c.z - b.dir.z * k * r);
      if (seenProbe.center.distanceToSquared(eye) < near || frustum.intersectsSphere(seenProbe)) return true;
    }
    return false;
  };
  const counts = { full: 0, reduced: 0, impostors: 0, casters: 0, castersUnseen: 0, triangles: 0, casterTriangles: 0 };
  /** (perf lane) What the detail distances are multiplied by (setDetail). */
  let detailScale = 1;
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

  /**
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} focus the view's car
   * @param {import('./sun.js').ShadowBox} [box] the sun's shadow box, already placed for this view
   */
  function prepareView(camera, focus, box = null) {
    viewCamera = camera;
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    eye.setFromMatrixPosition(camera.matrixWorld);
    // an orthographic view from above (the viewer's map) sees everything in its frame at the reduced level
    const flat = camera.isOrthographicCamera;
    for (const m of group.children) m.count = 0;
    fullList.length = 0;
    let unseen = 0;
    const blend = coverage ? BLEND : 0;
    // (perf lane) the ladder's rung: the distances at which trees keep their full and their reduced form, and the
    // floor's reach, times `detailScale` (1 until the governor sheds it; no mesh is rebuilt, nothing is compiled)
    const fullD = T.full * detailScale;
    const redD = T.reduced * detailScale;
    for (let k = 0; k < cellSphere.length; k++) {
      if (cellStart[k] === cellStart[k + 1]) continue;
      const cs = cellSphere[k];
      const dEye = flat ? 0 : cs.center.distanceTo(eye) - cs.radius;
      const caster = casterMeshes.length > 0 && (box?.on ? inBox(box, cs.center, cs.radius) : Math.hypot(cs.center.x - focus.x, cs.center.z - focus.z) - cs.radius < shadowR);
      const seenCell = dEye < T.far && frustum.intersectsSphere(cs);
      if (!caster && !seenCell) continue;
      for (let j = cellStart[k]; j < cellStart[k + 1]; j++) {
        const i = cellItems[j];
        const v = trees[i].variant;
        sphere.center.set(spheres[i * 4], spheres[i * 4 + 1], spheres[i * 4 + 2]);
        sphere.radius = spheres[i * 4 + 3];
        if (caster && (box?.on ? inBox(box, sphere.center, sphere.radius) : Math.hypot(sphere.center.x - focus.x, sphere.center.z - focus.z) < shadowR)) {
          // (perf lane) on a phone: only if its shadow can be seen
          if (T.castSeen && box?.on && !shadowSeen(box, sphere.center, sphere.radius)) unseen++;
          else write(casterMeshes[0], i, 1);
        }
        if (!seenCell || !frustum.intersectsSphere(sphere)) continue;
        // (small things, the undergrowth and young trees, go to the simpler levels sooner)
        // the floor under it
        if (patchStart[i] < patchStart[i + 1]) {
          const df = flat ? 0 : sphere.center.distanceTo(eye);
          const reachF = (FLOOR_REACH[tier] ?? FLOOR_REACH.high) * detailScale;
          if (df < reachF) for (let j = patchStart[i]; j < patchStart[i + 1]; j++) writePatch(j, i, coverage ? Math.min(1, (reachF - df) / 15) : 1);
        }
        // (trees behind others, the undergrowth and the mass of the forest go to the simpler levels sooner)
        const detail = trees[i].detail;
        const fD = fullD * Math.min(detail, T.fullCap);
        const rD = redD * (0.4 + 0.6 * Math.min(detail, T.redCap));
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
    for (const m of floorMeshes) m.userData.other = 0;
    for (const m of fullMeshes) m.userData.other = 0;
    for (const i of fullList) write(reducedMeshes[trees[i].variant], i, 1);
    for (const m of reducedMeshes) m.userData.other = m.count;
    counts.full = counts.reduced = counts.impostors = counts.casters = counts.triangles = counts.casterTriangles = 0;
    counts.castersUnseen = unseen;
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
    counts.floor = floorMeshes[0].userData.main + floorMeshes[1].userData.main;
    counts.triangles += counts.floor * 2;
    for (const m of casterMeshes) {
      counts.casters += m.count;
      counts.casterTriangles += m.count * 2;
    }
    counts.drawCalls = group.children.filter((m) => m.visible).length;
  }

  lap('meshes');
  return {
    specimen: kit.specimen,
    /** The impostor atlas (for looking at it). */
    atlas,
    group,
    uniforms,
    prepareView,
    /**
     * (perf lane) Scale the distances at which trees are drawn in full and in reduced form and the floor's reach
     * (1: the tier's own). Takes effect at the next prepareView.
     */
    setDetail(scale) {
      detailScale = Math.min(1, Math.max(0.3, scale));
    },
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
      bytes: kit.bytes,
      ms,
    },
    dispose() {
      for (const m of group.children) m.geometry.dispose();
      floorMaterial.dispose();
      kit.dispose();
    },
  };
}
