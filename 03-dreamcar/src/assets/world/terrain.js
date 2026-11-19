// The mountain: one height function, built from the Track outwards, and the
// meshes that draw it.
//
// The height function H(x, z) has three layers.
//  1. Near the road it IS the road's corridor: out to the solid edge the
//     Track's own cross-section (what the wheels stand on), and beyond the
//     edge the hillside the Track asks for (its far slope), with a cliff where
//     the edge is rock: the rock face (rock.js) stands in front of it.
//  2. Further out it blends, over 10 to 100 m, into the shape of the land: a
//     field made on a 16 m grid from the road itself (the road's height, rising
//     inside the loop towards a massif and falling outside it towards the
//     valleys, a lake beside the straight, a ridge over the tunnel and a
//     ravine under the viaduct), smoothed so that the line where two stretches
//     of road are equally near leaves no crease, with ridged noise on top.
//  3. Far away, beyond the course, mountains rise round the valley.
//
// It is drawn in three pieces that meet without cracks:
//  - the BAND: a strip that follows the road on each side, row by row with the
//    Track's samples, from the pavement's edge out to about 30 m beyond the
//    solid edge. Its columns sit on the corridor's own kinks (pavement, solid
//    edge, the foot and top of the cliff), so it is exact where the eye is
//    closest. Where another stretch of road is nearer it stops.
//  - the GRID: square cells (5 m on the high tier) over the whole course, cut
//    into chunks the renderer can cull. Cells the band covers are dropped;
//    the band's neighbours are pulled a little under it.
//  - the FAR land: 100 m cells out to the mountains on the horizon, with a hole
//    where the grid is whose rim is the grid's border.
//
// Under the tunnel's portals the grid is cut open (the bore and its face come
// with the tunnel); over the bore the ground stands above its crown; under the
// viaduct it falls into the ravine.

import * as THREE from 'three';
import { planeNoise, smoothstep, withBake } from './shading.js';
import { CANOPY, canopyOpen } from './canopy.js';

// The Track's EDGE and SURFACE values (the world never imports from game/).
const EDGE_ROCK = 1;
const EDGE_TREES = 4;
const SURFACE_GRAVEL = 3;
/** The tunnel's crown above the road (TUNNEL.height in game/trackLayout.js) and its lining: the ground stays above it. */
const BORE_HEIGHT = 7.2;

/** Grid cell (m) per tier. */
const CELL = { low: 14, medium: 6, high: 5 };
/** Band rows: one every this many Track samples, per tier. */
export const ROW_STEP = { low: 3, medium: 1, high: 1 };
/**
 * (finish lane) Metres of road per piece of the band (and of the road, road.js), per tier: a piece is a draw call in
 * every pass that sees it. The low tier's rows are three times as far apart, so its pieces can be longer for the
 * same triangles culled; a chase view there drew five to ten pieces of each. Medium's are half as long again.
 */
export const PIECE = { low: 400, medium: 240, high: 160 };
/** The land-shape field's cell (m). */
const MACRO = 16;
/** How far the grid reaches beyond the course's bounds (m). */
const MARGIN = 260;
/** Beyond this distance from the solid edge the road no longer shapes the ground (m). */
const NEAR_REACH = 170;
/** Columns of the band beyond the cliff's top, metres from it. */
const BAND_OUT_BY_TIER = { low: [4, 12, 27], medium: [2, 5, 9, 14, 20, 27], high: [2, 5, 9, 14, 20, 27] };
/** The far land: its cell and how far it reaches from the middle of the course (m). */
const FAR_CELL_BY_TIER = { low: 140, medium: 100, high: 100 };
const FAR_REACH = 4800;
/** Beyond the barrier of an open side (no wood by the Track's word, the ground falling away) no forest stands this far out (m). */
const OPEN_VIEW = 110;
/** Where the start straight is seen from (x from, x to along z = 0) and the slope (tan 6 deg) the hills keep under. */
const STRAIGHT_VIEW = { x0: -450, x1: 250, slope: 0.1 };
/**
 * (sea lane) THE SEA, whose surface is the Track's lake level. Outside the loop, at a bearing from the course's middle
 * (degrees, atan2(z, x): 0 is +X, 90 is +Z) outside `mainland`, the land falls from the road to the water `shore`
 * metres beyond the solid edge (it wanders between the two) and the sea runs to the horizon: north of the tunnel's
 * spur, round the sky road and the headland of the carousel and the crest, down the west side. The mainland, with
 * the massif and the far ridges behind the start straight, stays east of it (frame D1 is untouched). The lake beside
 * the straight is a bay of the same sea, reaching `bayWest` times as far west as east, where it opens to it.
 * `cliff`: rise per metre of the land above the water's edge; `shelf`: fall per metre of the seabed beyond it, down to
 * `deep`; `soft`: degrees over which the coast turns from sea to mainland (and as much again of wander); `stacks`: how
 * many sea stacks stand off the coast; `bridgeShore`: beside the sky road's piers the water begins at most this far out.
 * `map`: the sea map's texels a side and its half width (m) round the middle (see seaMap below).
 */
const SEA = {
  mainland: [-115, 24],
  soft: 14,
  shore: [55, 170],
  cliff: 1.15,
  shelf: 0.3,
  deep: 45,
  bayWest: 2.2,
  stacks: 7,
  bridgeShore: 45,
  map: { size: 512, half: 2400 },
};

/**
 * (sea lane, round 2: frame E1) THE COAST ROAD'S CLIFF. On the sea side of the coast road (a preset's `coast`) the
 * land does not slope away to a shore far off: beyond the barrier a lip of dry grass `lip` m wide (it wanders), then
 * a cliff straight down into the sea, `steep` m down per m out (it wanders), rounded at its top and with a talus at
 * its foot, `below` m under the water's level; the seabed shelves away beyond it (SEA.shelf, SEA.deep). `ease`: metres
 * over which a side becomes coast. On the land side, the cut face is `cut` m high (the coast's ochre and rust rock)
 * and the hillside beyond it rises at most `landFar` per metre (a rock edge on a sea side is a wall `seaRock` m high); inside the carousel's hairpin (`knoll.piece`, the
 * bend frame E1 looks at) the headland rises `knoll.rise` m over the road beyond the cut, along a ridge down the
 * tongue between its legs (from nothing at the bend's centre to its full height a third of the way along, gone by
 * `knoll.along` m), `knoll.across` m to either side of it, moved `knoll.shift` of the way towards the hairpin's entry
 * leg (the climb). The day's sun (16 degrees up, due east) comes from that side: round 2's first tries (an 11 m cut,
 * the rock preset's steep hillside, the hill's top by the bend) put the whole of the bend's exit in their shade,
 * where frame E1 has the road and the apron in the sun and the shade only over the inside of the road.
 */
/**
 * (sea lane, round 2: the owner's "sea side with big waves ... some river that will be super nice to cross") THE LOW
 * CROSSING. The first place after the tunnel where the road comes down to the water is the long right before the
 * straight (`piece`, from `from` to `to` of it: the road 12 m down to 0.4 m over the line, 14 to 2 m over the
 * water); there the land either side falls away into the sea, so the road runs on a causeway across the mouth of a
 * lagoon: beyond each rail a lip of `lip` m, then a rubble bank `steep` m down per m out to `below` m under the water;
 * on the inside of the bend the lagoon is `lagoon` m wide (and `floor` m deep at most) before the land comes back over
 * 60 m, on the outside it is the bay. `surf`: where the swell runs big (waves.js BOOST), round a point `out` m to the
 * left of the piece's centre line `at` of the way along it, `r` m across: the crossing's outer side, short of the
 * straight (frames D1 and D4 look over the bay further east). The course is untouched (what lies inside the solid edges is the Track's).
 */
const CAUSEWAY = { piece: 'back', from: 0.5, to: 0.93, ease: 50, lip: 2.5, steep: 0.6, below: 5, lagoon: 120, floor: 9, surf: { at: 0.75, out: 70, r: 360 } };
/**
 * (sea lane, round 3: the owner's "seaside should be on the right side with some island and volcano") THE VOLCANO: an
 * island cone out in the inner sound to the right of the sky road (`piece`, `at` of the way along it, `out` m to its
 * right): `h` m over the water at the rim, `r` m to its foot under the water, the flanks concave (`concave`: the power
 * of the profile), a crater `crater` m across at the rim and `depth` m deep, gullies down its flanks. Scenery only:
 * its foot stands well beyond every solid edge (unit-tested). volcano.js draws its plume and the glow in its crater.
 * `sound`: round it, out to `r` m, the land is drowned to `floor` m under the water (so the island stands free of the
 * massif inside the loop), except within `keep` m of a solid edge, where the road's own ground stays.
 */
// (round 4) moved and sharpened: ahead and to the right from the sky road's start and from the crest and the plunge
// (the bay inside the loop), a steeper cone so that it reads as a volcano against the sea and the sky
const VOLCANO = { piece: 'ledge2', at: 0.29, out: -195, h: 190, r: 150, concave: 1.3, crater: 30, depth: 24, sound: { r: 600, floor: 16, keep: [60, 120] } };
const COAST = {
  lip: [1.5, 4],
  steep: [2.2, 3.4],
  below: 7,
  ease: 30,
  cut: 6,
  landFar: 0.25,
  seaRock: 1.4,
  knoll: { piece: 'carousel', rise: 0, along: 230, across: 44, shift: 0.65 },
};

/**
 * @typedef {object} Terrain
 * @property {THREE.Group} group
 * @property {(x: number, z: number) => number} heightAt the ground's height (on the corridor: the road's surface)
 * @property {(x: number, z: number, out?: THREE.Vector3) => THREE.Vector3} normalAt the ground's unit normal
 * @property {(x: number, z: number) => number} forestAt 0..1 where the forest stands (the forest stage plants it)
 * @property {(x: number, z: number, out: number[], offset: number) => void} bakeAt the baked light at a point
 *   (aBake: sun by day, moon by night, sky), for anything that stands on the ground and wants to match it
 * @property {(x: number, z: number, out: number[], offset: number) => void} bake4At the same with the golden hour's
 *   sun as a fourth number (for an aBake of size 4; a size-3 aBake reads 1 there: lit)
 * @property {(s: number, side: number) => { top: number, height: number, rock: number }} cliffAt the cliff behind a
 *   rock edge: how far beyond the solid edge its top is (m), how high it rises, and how much of a rock edge it is
 * @property {(s: number, lat: number) => number} heightOnTrack the same height at track coordinates
 * @property {THREE.MeshStandardMaterial} material the ground's material (the band, the grid, the far land)
 * @property {{ level: number, extent: { x0: number, x1: number, z0: number, z1: number } }} lake the bay beside the
 *   straight (the lake it was): its surface and the box of its old ellipse (far.js puts the town's lights round it)
 * @property {SeaShape} sea where the sea is (sea.js draws it; far.js keeps the far ridges off it)
 * @property {{ x: number, z: number, top: number, r: number, crater: number, depth: number } | null} volcano the
 *   volcano's island in the inner sound (VOLCANO; volcano.js draws its plume)
 * @property {object} stats vertices, triangles, milliseconds
 * @property {() => void} dispose
 *
 * @typedef {object} SeaShape
 * @property {number} level the water's surface (y)
 * @property {(x: number, z: number) => number} at 0..1 how much a point of the map is sea (1) rather than land or a
 *   pond (0); beyond the course, whether its bearing is the sea's
 * @property {(x: number, z: number) => number} sector 0..1 the sea's share of a point's bearing from the course's
 *   middle (for what lies beyond the land: the far ridges)
 * @property {{ size: number, x0: number, z0: number, extent: number, data: Uint8Array }} map the sea map, RGBA per
 *   texel over a square `extent` m a side from (x0, z0), x along a row: r the water's depth (sqrt of depth / 64 m),
 *   g how far the land is from the water (0 at its edge, 1 at 500 m and more), b how far the water is from the land
 *   (0 at the shore, 1 at 160 m and more), a the sea's share (at)
 * @property {Array<{ x: number, z: number, r: number, h: number }>} stacks the sea stacks
 * @property {{ x: number, z: number, r: number } | null} surf where the swell runs big (off the low crossing)
 */

/**
 * @param {object} options
 * @param {object} options.track the Track
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {THREE.MeshStandardMaterial} options.material the ground material (groundMaterial.js), already patched
 * @param {{ day: number[], night: number[] }} options.lights directions towards the sun and the moon
 * @returns {Terrain}
 */
export function createTerrain({ track, tier, rng, material, lights }) {
  const BAND_OUT = BAND_OUT_BY_TIER[tier] ?? BAND_OUT_BY_TIER.medium;
  const FAR_CELL = FAR_CELL_BY_TIER[tier] ?? FAR_CELL_BY_TIER.medium;
  const started = performance.now();
  const n = track.count;
  const ds = track.ds;
  const pave = track.halfWidth + track.shoulder;
  const noise = planeNoise(rng.int(1 << 30));
  const lakeLevel = track.layout?.lakeLevel ?? -1.8;

  // ---- per sample: what the road asks of the land on each side
  const wrap = (s) => track.wrap(s);
  const read = (arr, s) => {
    const f = wrap(s) / ds;
    const i = Math.floor(f) % n;
    const b = i + 1 === n ? 0 : i + 1;
    return arr[i] + (arr[b] - arr[i]) * (f - Math.floor(f));
  };
  /** 0..1 how much of a rock edge each sample is, eased over a few metres so the cliffs rise and fall. */
  const rockiness = (kinds) => {
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = kinds[i] === EDGE_ROCK ? 1 : 0;
    const out = new Float32Array(n);
    const half = Math.round(6 / ds);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) sum += raw[(i + k + n) % n];
      out[i] = sum / (2 * half + 1);
    }
    return out;
  };
  const rockL = rockiness(track.kindL);
  const rockR = rockiness(track.kindR);
  /** Height of the cliff behind a rock edge: a few metres where the hill beyond is gentle, up to 9 where it is steep. */
  const cliffOf = (rock, far) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rock[i] * Math.min(9, Math.max(1.4, 2 + 5 * far[i]));
    return out;
  };
  // (sea lane, round 2) per sample and side, 0..1 how much this side is the coast road's sea side (eased along the road)
  const coastWeight = (flags) => {
    const out = new Float32Array(n);
    if (!flags) return out;
    const half = Math.round(COAST.ease / 2 / ds);
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += flags[(k + n) % n];
    for (let i = 0; i < n; i++) {
      out[i] = smoothstep(0, 1, sum / (2 * half + 1));
      sum += flags[(i + half + 1) % n] - flags[(i - half + n) % n];
    }
    return out;
  };
  const coastL = coastWeight(track.coastL);
  const coastR = coastWeight(track.coastR);
  // (sea lane, round 2) the low crossing (CAUSEWAY): both sides, per sample
  const lowW = (() => {
    const flags = new Uint8Array(n);
    let s0 = 0;
    for (const seg of track.layout?.segments ?? []) {
      const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
      if (seg.id === CAUSEWAY.piece) {
        for (let d = len * CAUSEWAY.from; d <= len * CAUSEWAY.to; d += ds) flags[Math.round(wrap(s0 + d) / ds) % n] = 1;
      }
      s0 += len;
    }
    const half = Math.round(CAUSEWAY.ease / 2 / ds);
    const out = new Float32Array(n);
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += flags[(k + n) % n];
    for (let i = 0; i < n; i++) {
      out[i] = smoothstep(0, 1, sum / (2 * half + 1));
      sum += flags[(i + half + 1) % n] - flags[(i - half + n) % n];
    }
    return out;
  })();
  /** (sea lane, round 2) 0..1 how much the ground d m beyond the solid edge of a side at s is the sea's cliff or bank. */
  const seaSide = (s, side, d) => {
    const lagoon = side < 0 ? 1 - smoothstep(CAUSEWAY.lagoon, CAUSEWAY.lagoon + 60, d) : 1;
    return Math.max(read(side > 0 ? coastL : coastR, s), read(lowW, s) * lagoon);
  };
  const cliffL = cliffOf(rockL, track.farSlopeL);
  const cliffR = cliffOf(rockR, track.farSlopeR);
  // (sea lane, round 2) the land side of the coast road is cut deeper: the rust face of frame E1
  for (let i = 0; i < n; i++) {
    cliffL[i] = Math.max(cliffL[i], rockL[i] * coastR[i] * COAST.cut);
    cliffR[i] = Math.max(cliffR[i], rockR[i] * coastL[i] * COAST.cut);
    // (round 4) a rock edge on a sea side is a low wall of rock over the cliff, not a cut face
    cliffL[i] += (rockL[i] * COAST.seaRock - cliffL[i]) * coastL[i];
    cliffR[i] += (rockR[i] * COAST.seaRock - cliffR[i]) * coastR[i];
  }
  /** The cliff's foot starts this far beyond the edge, and climbs this far out per metre up. */
  /** Bridges shorter than this (m) span a gully across them rather than a valley along them. */
const GULLY_LENGTH = 450;
const FOOT = 0.8;
  const LEAN = 0.3;

  // tunnels and bridges, per sample: how much ground stands over the bore, how deep the ravine is
  const cover = new Float32Array(n).fill(-1);
  const ravine = new Float32Array(n).fill(-1);
  for (const t of track.tunnels) {
    for (let i = Math.ceil(t.s0 / ds); i <= Math.floor(t.s1 / ds); i++) {
      const s = i * ds;
      cover[i % n] = 2.5 + Math.min(40, 0.35 * Math.min(s - t.s0, t.s1 - s));
    }
  }
  for (const b of track.bridges) {
    const drop = b.drop ?? 30;
    // (env lane) a short deck spans a gully that runs ACROSS it: a V along the road, deepest in the middle, with a
    // stream's notch at the bottom; a long one a broad valley
    const gully = b.s1 - b.s0 < GULLY_LENGTH;
    for (let i = Math.ceil(b.s0 / ds); i <= Math.floor(b.s1 / ds); i++) {
      const u = (i * ds - b.s0) / (b.s1 - b.s0);
      const v = Math.max(0, Math.sin(Math.PI * u));
      const notch = gully ? 2.5 * Math.exp(-Math.pow(((u - 0.5) * (b.s1 - b.s0)) / 5, 2)) : 0;
      // (sea lane, round 3: a long deck's valley is the sea's sound, nearly as deep out to its ends: 0.25, was 0.6)
      ravine[i % n] = Math.max(1.5, drop * Math.pow(v, gully ? 1.4 : 0.25) + notch);
    }
  }
  /** On a bridge long enough to span a valley along it (the sky road), not a gully across it. */
  const longBridge = (s) => track.bridges.some((b) => b.s1 - b.s0 >= GULLY_LENGTH && track.wrap(s - b.s0) <= b.s1 - b.s0);
  const zoneOf = (s) => {
    const i = Math.round(wrap(s) / ds) % n;
    return cover[i] >= 0 ? 1 : ravine[i] >= 0 ? 2 : 0;
  };
  /** The height the land is shaped from: the road, or the ground over the bore, or the ravine's floor. */
  const ref = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ref[i] = track.py[i] + (cover[i] >= 0 ? BORE_HEIGHT + cover[i] : 0) - (ravine[i] >= 0 ? ravine[i] : 0);
  }

  // ---- layer 3: the valley, the lake and the mountains round them
  const mid = { x: (track.bounds.minX + track.bounds.maxX) / 2, z: (track.bounds.minZ + track.bounds.maxZ) / 2 };
  // the lake lies along the straight's shore (the straight runs along z = 0, the water on its -z side)
  const LAKE = { x: 60, z: -330, rx: 650, rz: 300 };
  // (sea lane) the lake is a bay of the sea: its ellipse as it was to the east, drawn out westwards to the open water
  const lakeE = (x, z) => ((x - LAKE.x) / (x < LAKE.x ? LAKE.rx * SEA.bayWest : LAKE.rx)) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
  const RAD = 180 / Math.PI;
  /** 0..1 the sea's share of a point's bearing from the course's middle (SEA.mainland), with a wander of its own. */
  function seaSector(x, z) {
    const a = Math.atan2(z - mid.z, x - mid.x) * RAD;
    const r = Math.hypot(x - mid.x, z - mid.z);
    const into = Math.min(a - SEA.mainland[0], SEA.mainland[1] - a) + 2 * SEA.soft * (noise.fbm(r / 700 + 21, a / 35 + 4, 3) - 0.5);
    return smoothstep(SEA.soft, -SEA.soft, into);
  }
  /** Metres beyond the solid edge where the water begins. */
  const shoreAt = (x, z) => SEA.shore[0] + (SEA.shore[1] - SEA.shore[0]) * smoothstep(0.3, 0.7, noise.fbm(x / 520 + 13, z / 520 - 7, 3));
  /** The coast's profile at d m beyond the solid edge, from a road whose ground is at `base`. */
  const coastAt = (x, z, base, d, bridge) => {
    // (beside the sky road's piers the water comes in closer: the viaduct stands in front of it)
    const shore = bridge ? Math.min(shoreAt(x, z), SEA.bridgeShore) : shoreAt(x, z);
    const fall = d < shore ? SEA.cliff : SEA.shelf;
    return Math.max(lakeLevel - SEA.deep, Math.min(base - 0.25 * d, lakeLevel + fall * (shore - d)));
  };
  /**
   * (sea lane, round 2) The coast road's cliff (COAST) at d m beyond the solid edge of a sea side at s, from the
   * ground at the edge (`top`): the lip, the face, the talus under the water and the seabed beyond.
   */
  const coastCliff = (s, d, top, side = 1) => {
    const low = read(lowW, s);
    const lip = COAST.lip[0] + (COAST.lip[1] - COAST.lip[0]) * noise.fbm(s / 70 + 3.1, 8.3, 2);
    const steep = COAST.steep[0] + (COAST.steep[1] - COAST.steep[0]) * noise.fbm(s / 45 - 6.2, 2.9, 3);
    // (the low crossing's bank, CAUSEWAY)
    if (low > 0) return coastBank(s, d, top, lip + (CAUSEWAY.lip - lip) * low, steep + (CAUSEWAY.steep - steep) * low, COAST.below + (CAUSEWAY.below - COAST.below) * low, side < 0 ? low : 0);
    return coastBank(s, d, top, lip, steep, COAST.below, 0);
  };
  const coastBank = (s, d, top, lip, steep, below, shallow) => {
    const foot = lakeLevel - below;
    const drop = Math.max(1, top - foot);
    const run = drop / steep;
    const lipY = top - 0.06 * Math.min(d, lip);
    if (d <= lip) return lipY;
    const t = (d - lip) / run;
    if (t < 1) return lipY - (lipY - foot) * smoothstep(0, 1, t);
    return Math.max(lakeLevel - SEA.deep + (SEA.deep - CAUSEWAY.floor) * shallow, foot - SEA.shelf * (d - lip - run));
  };
  /** (sea lane, round 2) The headland inside the carousel (COAST.knoll): its rise over the road at a point. */
  const knollAt = (() => {
    const segs = track.layout?.segments ?? [];
    let s0 = 0;
    for (const seg of segs) {
      const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
      if (seg.id === COAST.knoll.piece && seg.r) {
        const c = track.pointAt(s0 + len / 2, seg.r, new THREE.Vector3());
        const apex = track.pointAt(s0 + len / 2, 0, new THREE.Vector3());
        const ax = (c.x - apex.x) / Math.abs(seg.r);
        const az = (c.z - apex.z) / Math.abs(seg.r);
        const entry = track.pointAt(s0, 0, new THREE.Vector3());
        const { rise, along, across, shift } = COAST.knoll;
        const v0 = shift * ((entry.x - c.x) * az - (entry.z - c.z) * ax);
        return (x, z) => {
          const u = (x - c.x) * ax + (z - c.z) * az;
          const v = (x - c.x) * az - (z - c.z) * ax - v0;
          const back = Math.max(0, -u);
          const off = Math.hypot(v, back);
          // highest down the tongue from the bend's centre, falling away along it and to its sides; low round the
          // hairpin itself, whose exit would otherwise lie in its shade (the day's sun is on that side, 16 degrees up)
          const crest = smoothstep(along, along * 0.45, u) * smoothstep(0, along * 0.35, u);
          const wobble = 0.85 + 0.3 * noise.fbm(x / 40 + 2, z / 40 - 5, 3);
          return rise * crest * wobble * smoothstep(across, across * 0.15, off);
        };
      }
      s0 += len;
    }
    return () => 0;
  })();
  /** (sea lane, round 3) The volcano's island (VOLCANO): where it stands, and its height at a point (-Infinity off it). */
  const volcano = (() => {
    let s0 = 0;
    for (const seg of track.layout?.segments ?? []) {
      const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
      if (seg.id === VOLCANO.piece) {
        const p = track.pointAt(s0 + len * VOLCANO.at, VOLCANO.out, new THREE.Vector3());
        return { x: p.x, z: p.z, top: lakeLevel + VOLCANO.h, r: VOLCANO.r, crater: VOLCANO.crater, depth: VOLCANO.depth };
      }
      s0 += len;
    }
    return null;
  })();
  const volcanoAt = (x, z) => {
    if (!volcano) return -Infinity;
    const dx = x - volcano.x;
    const dz = z - volcano.z;
    const q = Math.hypot(dx, dz);
    if (q > volcano.r * 1.15) return -Infinity;
    const a = Math.atan2(dz, dx);
    // gullies down the flanks and a ragged foot
    const wob = 1 + 0.08 * (noise.fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3, 3) - 0.5) + 0.05 * Math.sin(a * 11 + 2 * noise.fbm(q / 40, a, 2));
    const t = Math.min(1, Math.max(0, (volcano.r * wob - q) / (volcano.r - volcano.crater / 2)));
    const foot = lakeLevel - 12;
    let y = foot + (volcano.top - foot) * Math.pow(t, VOLCANO.concave);
    const rim = volcano.crater / 2;
    if (q < rim) y = volcano.top - volcano.depth * (1 - (q / rim) ** 2);
    return y;
  };
  /** (sea lane, round 3) The inner sound round the volcano: ground `h`, `d` m beyond the nearest solid edge, drowned. */
  const sound = (x, z, h, d) => {
    if (!volcano) return h;
    const q = Math.hypot(x - volcano.x, z - volcano.z);
    const S = VOLCANO.sound;
    const k = (1 - smoothstep(0.7 * S.r, 1.05 * S.r, q)) * smoothstep(S.keep[0], S.keep[1], d);
    return k > 0 ? h + (Math.min(h, lakeLevel - S.floor) - h) * k : h;
  };
  /** The valley with the bay and the open sea far from the road. */
  const valley = (x, z) => {
    const h = valleyLand(x, z);
    const s = seaSector(x, z);
    return s > 0 ? h + (lakeLevel - SEA.deep - h) * s : h;
  };
  function valleyLand(x, z) {
    const e = lakeE(x, z);
    const inLake = smoothstep(1.06, 0.82, e);
    const floor = 3 + 20 * noise.fbm(x / 420, z / 420, 3) + 30 * smoothstep(1.2, 3, e) * noise.fbm(x / 300 + 7, z / 300, 3);
    const bottom = lakeLevel - 10 * smoothstep(0.95, 0.35, e);
    const r = Math.hypot(x - mid.x, (z - mid.z) * 0.9);
    // (look lane, day: lower than it was (220 + 380) and broken by a ridged field at a third of the scale, so the
    // far land reads as spurs and gullies, not smooth mounds, and the jagged ranges of far.js show over it)
    const rise = smoothstep(750, 1900, r);
    const ring = rise * (170 + 300 * noise.ridged(x / 1100 + 3, z / 1100, 5) + 150 * (noise.ridged(x / 380 + 11, z / 380 - 4, 4) - 0.4));
    const h = floor + (bottom - floor) * inLake + ring * (1 - inLake);
    // (env lane, for the SKY lane's massif) seen from the start straight the hills keep under about six degrees, so
    // the massif's foot shows over them: a soft cap that grows with the distance from the straight
    const sx = Math.min(STRAIGHT_VIEW.x1, Math.max(STRAIGHT_VIEW.x0, x));
    const cap = 25 + STRAIGHT_VIEW.slope * Math.hypot(x - sx, z);
    return h > cap - 30 ? cap - 30 * Math.exp(-(h - (cap - 30)) / 30) : h;
  }
  /** Small hills and gullies on top of the land's shape, zero on average. */
  // (env lane) land, not domes: ridged spurs at two scales, and drainage lines cut down the slopes between them
  // (the creases of a noise field: where it crosses its middle, a gully)
  const detail = (x, z) => {
    const gully = Math.pow(1 - Math.abs(2 * noise.fbm(x / 190 + 5, z / 190 - 3, 4) - 1), 5);
    return (
      22 * (noise.ridged(x / 260, z / 260, 4) - 0.35) +
      8 * (noise.ridged(x / 85 + 2, z / 85, 3) - 0.4) +
      4 * (noise.fbm(x / 35, z / 35, 2) - 0.5) -
      12 * gully
    );
  };

  // ---- layer 2: the shape of the land, on a coarse grid
  const minX = track.bounds.minX - MARGIN;
  const minZ = track.bounds.minZ - MARGIN;
  const maxX = track.bounds.maxX + MARGIN;
  const maxZ = track.bounds.maxZ + MARGIN;
  const mx = Math.ceil((maxX - minX) / MACRO) + 1;
  const mz = Math.ceil((maxZ - minZ) / MACRO) + 1;
  const macro = new Float32Array(mx * mz);
  const macroD = new Float32Array(mx * mz);
  /** (sea lane) 1 where a cell of the field could start the sea's flood (open water well beyond the road, or the bay). */
  const seaSeed = new Uint8Array(mx * mz);
  /** (sea lane, round 2) per cell: how much it lies off the coast road's sea side, and the cliff's height there. */
  const coastCell = new Float32Array(mx * mz);
  const coastCellY = new Float32Array(mx * mz);
  const spot = { index: -1, s: 0, lat: 0 };
  // the loop as a polygon on the map, to tell inside (the massif) from outside (the valleys)
  const ring = [];
  for (let i = 0; i < n; i += 4) ring.push(track.px[i], track.pz[i]);
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const zi = ring[i + 1];
      const zj = ring[j + 1];
      if (zi > z !== zj > z && x < ((ring[j] - ring[i]) * (z - zi)) / (zj - zi) + ring[i]) c = !c;
    }
    return c;
  };
  {
    let hint = -1;
    for (let j = 0; j < mz; j++) {
      for (let i = 0; i < mx; i++) {
        const x = minX + i * MACRO;
        const z = minZ + j * MACRO;
        track.locate(x, z, hint, spot);
        hint = spot.index;
        const side = spot.lat >= 0 ? 1 : -1;
        const d = Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, side));
        const base = read(ref, spot.s);
        const g = valleyLand(x, z);
        let v;
        if (inside(x, z)) {
          // the massif: gently up from the road at first (meadows, the wood), then steeply
          const cap = 165 + 45 * noise.fbm(x / 300, z / 300, 3);
          // where the Track asks the ground to fall away (the summit's crest, the valley side of a hairpin), it
          // does so for a while before the massif rises, so no hill stands over an open crest
          const fall = read(side > 0 ? track.farSlopeL : track.farSlopeR, spot.s);
          const open = smoothstep(0, -0.2, fall);
          // the foot of the steep part wanders, so it never draws the road's outline a constant way off
          const foot = 30 + 60 * noise.fbm(x / 260 + 5, z / 260, 2);
          const rise = 0.22 * d + 0.42 * Math.max(0, d - foot);
          const away = fall * Math.min(d, 45) + 0.4 * Math.max(0, d - 80 - foot);
          v = Math.max(Math.min(base + rise + (away - rise) * open, cap), Math.min(base + fall * 45 * open, cap));
        } else {
          v = Math.max(base - 0.25 * d, g);
          // (sea lane) towards the sea the land falls from the road to the water's edge, steeply at the last, and
          // the seabed shelves away beyond it
          const sea = seaSector(x, z);
          if (sea > 0) v += (coastAt(x, z, base, d, zoneOf(spot.s) === 2 && longBridge(spot.s)) - v) * sea;
          if ((sea > 0.5 && d > shoreAt(x, z) + 30) || lakeE(x, z) < 0.8) seaSeed[j * mx + i] = 1;
        }
        {
          const cw = seaSide(spot.s, side, d);
          if (cw > 0 && d > 0) {
            coastCell[j * mx + i] = cw;
            coastCellY[j * mx + i] = coastCliff(spot.s, d, base, side);
            if (cw > 0.5 && coastCellY[j * mx + i] < lakeLevel - 2) seaSeed[j * mx + i] = 1;
          }
        }
        macro[j * mx + i] = v;
        macroD[j * mx + i] = d;
      }
    }
    // smoothed, so the line where two stretches are equally near leaves no crease
    const tmp = new Float32Array(macro.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < mz; j++) {
        for (let i = 0; i < mx; i++) {
          let sum = 0;
          let w = 0;
          for (let b = -1; b <= 1; b++) {
            const jj = Math.min(mz - 1, Math.max(0, j + b));
            for (let a = -1; a <= 1; a++) {
              const ii = Math.min(mx - 1, Math.max(0, i + a));
              sum += macro[jj * mx + ii];
              w++;
            }
          }
          tmp[j * mx + i] = sum / w;
        }
      }
      macro.set(tmp);
    }
    // (sea lane, round 2) off the coast road the cliff stays a cliff (after the smoothing, which would make it a slope)
    for (let k = 0; k < macro.length; k++) {
      if (coastCell[k] > 0) macro[k] += (Math.min(macro[k], coastCellY[k]) - macro[k]) * coastCell[k];
      // (round 3) the inner sound round the volcano
      const x = minX + (k % mx) * MACRO;
      const z = minZ + Math.floor(k / mx) * MACRO;
      macro[k] = sound(x, z, macro[k], macroD[k]);
      if (macro[k] < lakeLevel - 4 && volcano && Math.hypot(x - volcano.x, z - volcano.z) < VOLCANO.sound.r * 0.8) seaSeed[k] = 1;
    }
  }
  const bilinear = (arr, w, h, x0, z0, cell, x, z) => {
    const fx = Math.min(w - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(h - 1.001, Math.max(0, (z - z0) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * w + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + w] * (1 - u) + arr[k + w + 1] * u) * v;
  };
  const inMacro = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  // (sea lane) Which of the field's low ground is the sea: a flood from the open water and the bay through every cell
  // under the water's level. What it does not reach is a hollow in the land, which the water must not fill (the sea
  // is one level plane drawn everywhere, and the land covers it): such ground is held just above the water.
  const seaGrid = new Float32Array(mx * mz);
  {
    const queue = new Int32Array(mx * mz);
    let head = 0;
    let tail = 0;
    for (let k = 0; k < mx * mz; k++) {
      if (seaSeed[k] && macro[k] < lakeLevel) {
        seaGrid[k] = 1;
        queue[tail++] = k;
      }
    }
    while (head < tail) {
      const k = queue[head++];
      const i = k % mx;
      const j = (k - i) / mx;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= mx || b >= mz) continue;
        const q = b * mx + a;
        if (seaGrid[q] || macro[q] >= lakeLevel + 0.5) continue;
        seaGrid[q] = 1;
        queue[tail++] = q;
      }
    }
    // one blur, so that the share falls from 1 to 0 across a cell or two at the shore
    const tmp = new Float32Array(seaGrid);
    for (let j = 1; j < mz - 1; j++) {
      for (let i = 1; i < mx - 1; i++) {
        let sum = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += tmp[(j + b) * mx + i + a];
        seaGrid[j * mx + i] = sum / 9;
      }
    }
  }
  /** 0..1 how much of a point is sea (SeaShape.at). */
  const seaAt = (x, z) => (inMacro(x, z) ? bilinear(seaGrid, mx, mz, minX, minZ, MACRO, x, z) : Math.max(seaSector(x, z), smoothstep(1.06, 0.82, lakeE(x, z))));
  /** Ground under the water's level that is not the sea's is lifted to just above it. */
  // (sea lane) A few sea stacks off the coast: columns of rock standing out of the water some 30 to 120 m from the
  // shore (where the field is sea and land is a few cells away), apart from one another.
  const stacks = [];
  {
    const stackRng = rng.fork('stacks');
    const near = (k, reach) => {
      const i = k % mx;
      const j = (k - i) / mx;
      for (let b = -reach; b <= reach; b++) {
        for (let a = -reach; a <= reach; a++) {
          const q = (j + b) * mx + i + a;
          if (j + b >= 0 && j + b < mz && i + a >= 0 && i + a < mx && macro[q] > lakeLevel + 4) return true;
        }
      }
      return false;
    };
    for (let tries = 0; tries < 4000 && stacks.length < SEA.stacks; tries++) {
      const k = stackRng.int(mx * mz);
      if (seaGrid[k] < 0.99 || macro[k] > lakeLevel - 4 || near(k, 2) || !near(k, 7)) continue;
      const x = minX + (k % mx) * MACRO + stackRng.range(-6, 6);
      const z = minZ + Math.floor(k / mx) * MACRO + stackRng.range(-6, 6);
      // (in the open sea, not in the bay, which frames D1 and D4 look across)
      if (lakeE(x, z) < 1.6 || seaSector(x, z) < 0.8 || stacks.some((t) => Math.hypot(t.x - x, t.z - z) < 160)) continue;
      stacks.push({ x, z, r: stackRng.range(9, 17), h: stackRng.range(12, 34) });
    }
  }
  /** The stacks' height at a point (-Infinity where there is none). */
  const stackAt = (x, z) => {
    let top = -Infinity;
    for (const t of stacks) {
      const q = Math.hypot(x - t.x, z - t.z) / (t.r * (0.85 + 0.3 * noise.fbm(x / 9 + t.x, z / 9, 2)));
      if (q < 1.6) top = Math.max(top, lakeLevel - 6 + (t.h + 6) * (1 - smoothstep(0.75, 1.15, q)) * (0.85 + 0.25 * noise.fbm(x / 6, z / 6 + t.z, 2)));
    }
    return top;
  };
  const keepDry = (h, x, z) => {
    h = Math.max(h, stackAt(x, z));
    if (h >= lakeLevel + 1) return h;
    const wet = seaAt(x, z);
    return wet >= 0.5 ? h : h + (lakeLevel + 1 - h) * smoothstep(0.5, 0.2, wet);
  };
  /** The small hills on top of the land's shape, and fewer of them on the seabed, so it raises no islets by chance. */
  const detailAt = (x, z) => detail(x, z) * (1 - 0.8 * seaAt(x, z));
  /** The land's shape with its hills: what the ground is far from any road. */
  const land = (x, z) => keepDry(Math.max(sound(x, z, (inMacro(x, z) ? bilinear(macro, mx, mz, minX, minZ, MACRO, x, z) : valley(x, z)) + detailAt(x, z), 1e3), volcanoAt(x, z)), x, z);

  const phases = { macro: Math.round(performance.now() - started) };
  // the far land's heights, on its own coarse grid (the bake marches over them too)
  const farN = Math.round((FAR_REACH * 2) / FAR_CELL) + 1;
  const farX0 = mid.x - FAR_REACH;
  const farZ0 = mid.z - FAR_REACH;
  const farHeight = new Float32Array(farN * farN);
  for (let j = 0; j < farN; j++) {
    for (let i = 0; i < farN; i++) farHeight[j * farN + i] = land(farX0 + i * FAR_CELL, farZ0 + j * FAR_CELL);
  }
  // ---- layer 1: the corridor and the hillside just beyond it
  const prof = { y: 0, surface: 0 };
  /** The cliff behind the edge on one side at s. */
  const cliff = { top: 0, height: 0, rock: 0 };
  function cliffAt(s, side) {
    cliff.rock = read(side > 0 ? rockL : rockR, s);
    cliff.height = read(side > 0 ? cliffL : cliffR, s);
    cliff.top = cliff.height > 0.01 ? FOOT * cliff.rock + LEAN * cliff.height : 0;
    return cliff;
  }
  /** Height of the corridor and its hillside at track coordinates, before the land takes over. */
  function nearAt(s, lat, edge, d) {
    let y;
    if (d <= 0) y = track.profile(s, lat, prof).y;
    else {
      const side = lat > 0 ? 1 : -1;
      y = track.profile(s, side * edge, prof).y;
      const c = cliffAt(s, side);
      let beyond = d;
      if (c.height > 0.01) {
        const foot = FOOT * c.rock;
        y += c.height * smoothstep(0, 1, (d - foot) / (LEAN * c.height));
        beyond = Math.max(0, d - c.top);
      }
      let far = read(side > 0 ? track.farSlopeL : track.farSlopeR, s);
      // (sea lane, round 2) the land side of the coast road rises gently beyond its cut (the hill is COAST.knoll's):
      // the rock preset's steep hillside put the carousel's exit in its shade under the low eastern sun (frame E1)
      far = Math.min(far, far + (COAST.landFar - far) * read(side > 0 ? coastR : coastL, s));
      const top = y;
      y += far * 40 * (1 - Math.exp(-beyond / 40));
      // (sea lane, round 2) the sea side of the coast road: a lip, then the cliff into the sea
      const sea = seaSide(s, side, d);
      if (sea > 0) y += (coastCliff(s, d, top, side) - y) * sea;
    }
    // over a bore the ground stays above its crown, falling away to the sides; under a deck it keeps clear of it.
    // Both ease to nothing at their ends, so the ground is continuous along the road (except in the portals,
    // which are cut open)
    const zone = zoneOf(s);
    if (zone === 1) y = Math.max(y, read(track.py, s) + BORE_HEIGHT + read(cover, s) - 0.35 * Math.max(0, d - 4));
    else if (zone === 2) y = Math.min(y, read(track.py, s) - read(ravine, s) - 0.02 * Math.abs(lat));
    return y;
  }
  // Where another stretch of road lies beside this one (the hairpins' legs), the ground between them is shared:
  // per sample and side, how far out (|lat|, m) the other stretch's ground takes over (GAP_FREE: nowhere within
  // reach), and where on the other stretch that line lies. Between two legs the height is a blend of what each
  // asks for, weighted by how far the point is from each one's solid edge, so the two meet on one surface along
  // the line between them instead of in a step.
  const GAP_FREE = 400;
  const GAP_EVERY = 4;
  const gap = [new Float32Array(n).fill(GAP_FREE), new Float32Array(n).fill(GAP_FREE)];
  const gapS = [new Float32Array(n), new Float32Array(n)];
  const gapLat = [new Float32Array(n), new Float32Array(n)];
  {
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i += GAP_EVERY) {
      for (let half = 0; half < 2; half++) {
        const side = half === 0 ? 1 : -1;
        const edge = side > 0 ? track.edgeL[i] : track.edgeR[i];
        for (let d = edge + 6; d < 220; d += 4) {
          track.pointAt(i * ds, side * d, p);
          track.locate(p.x, p.z, -1, spot);
          if (Math.abs(track.delta(i * ds, spot.s)) > 6) {
            // not where the other stretch passes over or under this one (a crossing): there each keeps its own
            if (Math.abs(read(track.py, spot.s) - track.py[i]) < 30 && d > edge + 8) {
              gap[half][i] = d;
              gapS[half][i] = spot.s;
              gapLat[half][i] = spot.lat;
            }
            break;
          }
        }
      }
    }
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < n; i++) {
        if (i % GAP_EVERY === 0) continue;
        const a = i - (i % GAP_EVERY);
        const b = (a + GAP_EVERY) % n;
        const t = (i % GAP_EVERY) / GAP_EVERY;
        if (gap[half][a] < GAP_FREE && gap[half][b] < GAP_FREE && Math.abs(track.delta(gapS[half][a], gapS[half][b])) < 3 * GAP_EVERY * ds) {
          // between two samples that see the same stretch: in between, smoothly
          gap[half][i] = gap[half][a] + (gap[half][b] - gap[half][a]) * t;
          gapS[half][i] = wrap(gapS[half][a] + track.delta(gapS[half][a], gapS[half][b]) * t);
          gapLat[half][i] = gapLat[half][a] + (gapLat[half][b] - gapLat[half][a]) * t;
        } else {
          const k = gap[half][a] <= gap[half][b] ? a : b; // the nearer of the two: never later than either
          gap[half][i] = gap[half][k];
          gapS[half][i] = gapS[half][k];
          gapLat[half][i] = gapLat[half][k];
        }
      }
    }
  }
  phases.gap = Math.round(performance.now() - started);

  /** H at a point whose track coordinates are known. */
  function heightOf(x, z, s, lat) {
    const side = lat >= 0 ? 1 : -1;
    const edge = track.edgeAt(s, side);
    const d = Math.max(0, Math.abs(lat) - edge);
    let near = nearAt(s, lat, edge, d);
    let reach = 1;
    if (d > 0) {
      const half = side > 0 ? 0 : 1;
      const f = wrap(s) / ds;
      const i = Math.floor(f) % n;
      const j = i + 1 === n ? 0 : i + 1;
      const t = f - Math.floor(f);
      const smooth = gap[half][i] < GAP_FREE && gap[half][j] < GAP_FREE && Math.abs(track.delta(gapS[half][i], gapS[half][j])) < 3 * ds;
      const g = smooth ? gap[half][i] + (gap[half][j] - gap[half][i]) * t : gap[half][t < 0.5 ? i : j];
      if (g < GAP_FREE) {
        const k = t < 0.5 ? i : j;
        const gl = smooth ? gapLat[half][i] + (gapLat[half][j] - gapLat[half][i]) * t : gapLat[half][k];
        // the other stretch: how far this point is from its centre line, on the side where the switch was found
        const latB = gl + Math.sign(gl) * Math.max(0, g - Math.abs(lat));
        const sB = smooth ? gapS[half][i] + track.delta(gapS[half][i], gapS[half][j]) * t : gapS[half][k];
        const sideB = latB >= 0 ? 1 : -1;
        const edgeB = track.edgeAt(sB, sideB);
        const dB = Math.max(0, Math.abs(latB) - edgeB);
        const hB = nearAt(sB, latB, edgeB, dB);
        // Where one of the two is on a deck its ground is a ravine's floor far below: each then keeps its own
        // hillside for the first third of the way and they meet in a scarp between (so the bank the Track asks for
        // behind a wall is there, and the valley under the deck has a side), instead of one long ramp
        const scarp = (zoneOf(s) === 2) !== (zoneOf(sB) === 2);
        const share = d / (d + dB + 1e-3);
        near += (hB - near) * (scarp ? smoothstep(0.34, 0.66, share) : smoothstep(0, 1, share));
        reach = smoothstep(80, 200, g);
      }
    }
    // (sea lane, round 2) the headland over the carousel, beyond the cut (the same rise seen from either leg)
    if (d > 0 && side < 0 && zoneOf(s) !== 2) near += knollAt(x, z) * smoothstep(0, 1, (d - cliffAt(s, side).top - 1) / 10);
    // (sea lane, round 2) off the coast road's sea side the cliff and the seabed are the road's own out to the edge of
    // its reach: the land's shape and its small hills would raise shelves at the cliff's foot
    const sea = d > 0 ? seaSide(s, side, d) : 0;
    const w = smoothstep(10, 100, d) * reach * (1 - sea) + sea * smoothstep(NEAR_REACH - 40, NEAR_REACH, d);
    if (w <= 0) return near;
    const far = (inMacro(x, z) ? bilinear(macro, mx, mz, minX, minZ, MACRO, x, z) : valley(x, z)) + detailAt(x, z) * smoothstep(15, 150, d);
    const h = Math.max(sound(x, z, near + (far - near) * w, d), volcanoAt(x, z));
    return sea > 0.5 ? Math.max(h, stackAt(x, z)) : keepDry(h, x, z);
  }
  const near = (x, z) => (inMacro(x, z) ? bilinear(macroD, mx, mz, minX, minZ, MACRO, x, z) : 1e9) < NEAR_REACH;
  function heightAt(x, z) {
    if (!near(x, z)) return land(x, z);
    track.locate(x, z, -1, spot);
    return heightOf(x, z, spot.s, spot.lat);
  }
  const pointScratch = new THREE.Vector3();
  function heightOnTrack(s, lat) {
    track.pointAt(s, lat, pointScratch);
    return heightOf(pointScratch.x, pointScratch.z, s, lat);
  }

  // ---- the forest: where the Track says trees stand, and in patches on the massif and the far slopes
  function forestOf(x, z, y, slope, s, lat, d) {
    if (y < lakeLevel + 0.6) return 0;
    // (sea lane, round 2) nothing grows tall either side of the coast road: dry grass and scrub (frame E1)
    if (s !== null && Math.max(read(coastL, s), read(coastR, s), read(lowW, s)) > 0.02) return 0;
    let f = 0;
    if (s !== null) {
      const kinds = lat > 0 ? track.kindL : track.kindR;
      if (kinds[Math.round(wrap(s) / ds) % n] === EDGE_TREES) f = smoothstep(0.5, 3, d) * (1 - smoothstep(90, 150, d));
    }
    // (the forest stage: more of the valley sides wooded, so no slope reads as a bare dune)
    const patch = smoothstep(0.3, 0.45, noise.fbm(x / 230 + 11, z / 230, 4));
    // an open side (the Track grows nothing there and the ground falls away: a view) stays a meadow for OPEN_VIEW
    // metres below the road, so the valley and the road further on show over the wall (frame D3)
    let clear = s === null || d > 12 ? 1 : 0;
    if (s !== null && track.woodAt && !track.woodAt(s, lat > 0 ? 1 : -1) && read(lat > 0 ? track.farSlopeL : track.farSlopeR, s) < -0.1) {
      clear *= smoothstep(OPEN_VIEW, OPEN_VIEW * 1.4, d);
    }
    f = Math.max(f, patch * (1 - smoothstep(330, 420, y)) * clear);
    return f * (1 - smoothstep(0.55, 0.8, slope));
  }

  // ---- the band
  const bandStep = ROW_STEP[tier] ?? 1;
  const cols = 3 + 4 + BAND_OUT.length; // pavement edge, solid edge, the foot, four up the cliff, the rest
  const ext = [new Float32Array(n), new Float32Array(n)]; // per sample and side: how far out the band reaches (|lat|)
  const pt = new THREE.Vector3();
  /** The band's geometries, in chunks of PIECE m (after the bake: its vertices carry it). */
  function buildBands() {
    const out = [];
    const rows = [];
    for (let i = 0; i < n; i += bandStep) rows.push(i);
    // runs of rows outside the tunnels and bridges (a run may wrap through s = 0)
    const open = (i) => cover[i] < 0 && ravine[i] < 0;
    const runs = [];
    let run = null;
    for (const i of rows) {
      if (open(i)) {
        if (!run) runs.push((run = []));
        run.push(i);
      } else {
        if (run) run.push(i); // the band reaches the portal or the abutment
        run = null;
      }
    }
    if (runs.length > 1 && runs[0][0] === 0 && open(rows[rows.length - 1])) {
      const first = runs.shift();
      runs[runs.length - 1].push(...first);
    } else if (runs.length === 1 && runs[0].length === rows.length) runs[0].push(0);
    // each run in chunks of PIECE m, so that the renderer can cull them
    const CHUNK = Math.round((PIECE[tier] ?? 160) / (ds * bandStep));
    for (const r of runs) {
      for (let a = 0; a < r.length - 1; a += CHUNK) out.push(buildBand(r.slice(a, Math.min(r.length, a + CHUNK + 1))));
    }
    return out;
  }

  // on the inside of a tight bend the band's rows would cross over one another beyond the bend's centre: there
  // they stop short of it (and the grid fills in), per sample the reach allowed on the inside (|lat|, m)
  const innerReach = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let b = -8; b <= 8; b++) k = Math.max(k, Math.abs(track.curvature[(i + b + n) % n]));
    innerReach[i] = k > 1e-4 ? 0.8 / k : 1e9;
  }

  function buildBand(rowList) {
    const count = rowList.length * 2 * cols;
    const pos = new Float32Array(count * 3);
    const bake = new Float32Array(count * 4);
    const mask = new Float32Array(count * 2);
    // the verge in track terms for the ground material: metres beyond the margin, s (continuous through the
    // line), metres beyond the solid edge, and 0 (vertices without it read the default 1: not a verge)
    const verge = new Float32Array(count * 4);
    const offs = new Float32Array(cols);
    let lapOffset = 0;
    for (let r = 0; r < rowList.length; r++) {
      const i = rowList[r];
      const s = i * ds;
      if (r > 0 && i < rowList[r - 1]) lapOffset += track.length;
      for (let half = 0; half < 2; half++) {
        const side = half === 0 ? 1 : -1;
        const edge = side > 0 ? track.edgeL[i] : track.edgeR[i];
        const c = cliffAt(s, side);
        const top = c.top;
        offs[0] = pave - edge; // (relative to the edge)
        offs[1] = 0;
        offs[2] = FOOT * c.rock * (c.height > 0.01 ? 1 : 0);
        for (let k = 1; k <= 4; k++) offs[2 + k] = offs[2] + (top - offs[2]) * (k / 4);
        for (let k = 0; k < BAND_OUT.length; k++) offs[7 + k] = top + BAND_OUT[k];
        const gravel = (side > 0 ? track.vergeL : track.vergeR)[i] === SURFACE_GRAVEL;
        const coast = (side > 0 ? track.coastL : track.coastR)?.[i] === 1;
        const woodHere = track.woodAt ? !!track.woodAt(s, side) : false;
        let lastOwn = 0;
        for (let k = 0; k < cols; k++) {
          let lat = side * (edge + offs[k]);
          const inner = side * track.curvature[i] > 0 && edge + offs[k] > innerReach[i];
          if (k >= 2 && inner) lat = side * (edge + offs[lastOwn]);
          else if (k >= 9) {
            // stop where another stretch of the road is nearer than this one
            track.pointAt(s, lat, pt);
            track.locate(pt.x, pt.z, -1, spot);
            if (Math.abs(track.delta(s, spot.s)) > 6) lat = side * (edge + offs[lastOwn]);
            else lastOwn = k;
          } else lastOwn = k;
          if (k > lastOwn) lat = side * (edge + offs[lastOwn]);
          track.pointAt(s, lat, pt);
          const d = Math.max(0, Math.abs(lat) - edge);
          const y = heightOf(pt.x, pt.z, s, lat);
          const v = (r * 2 + half) * cols + k;
          pos[v * 3] = pt.x;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = pt.z;
          bake4At(pt.x, pt.z, bake, v * 4);
          // the verge and the bank under the woods see less sky (canopy.js; under the crowns it has no meaning)
          if (Math.abs(lat) < edge + CANOPY.clear) bake[v * 4 + 2] *= canopyOpen(track, s, lat);
          const slope = k >= 2 && k <= 6 && c.height > 0.01 ? 0.9 : 0;
          mask[v * 2] = k <= 1 ? 0 : forestOf(pt.x, pt.z, y, slope, s, lat, d);
          verge[v * 4] = Math.abs(lat) - pave;
          verge[v * 4 + 1] = s + lapOffset;
          verge[v * 4 + 2] = Math.abs(lat) - edge;
          // w: 0 on a verge with no wood behind it, 0.4 under woods (leaf litter); vertices without the attribute read 1
          verge[v * 4 + 3] = woodHere ? 0.4 : 0;
          // (sea lane, round 2) a gravel run-off is not mown grass: the ground's loose stone shows (frame E1's apron)
          if (gravel && coast) verge[v * 4 + 3] = 0.8;
          // the verge and the cliff's foot are loose stone where the verge is gravel
          mask[v * 2 + 1] = gravel ? (k <= 2 ? 1 : k <= 6 ? 0.6 : 0.3 * (1 - smoothstep(4, 12, d))) : 0;
          // (sea lane) beyond the barrier on the sea side of the coast road: the gravel runs out at the rail's foot and
          // the lip is dry grass (round 2: frame E1); the cliff below it is rock by its steepness
          if (coast && k >= 1) mask[v * 2 + 1] = gravel ? 1 - smoothstep(0.5, 2.5, d) : Math.max(mask[v * 2 + 1], 1 - smoothstep(0.3, 1.5, d));
        }
        ext[half][i] = edge + offs[lastOwn];
        if (bandStep > 1) for (let b = 1; b < bandStep && i + b < n; b++) ext[half][i + b] = ext[half][i];
      }
    }
    const index = [];
    for (let r = 0; r < rowList.length - 1; r++) {
      for (let half = 0; half < 2; half++) {
        for (let k = 0; k < cols - 1; k++) {
          const a = (r * 2 + half) * cols + k;
          const b = a + 2 * cols;
          if (half === 0) index.push(a, b, a + 1, a + 1, b, b + 1);
          else index.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    geometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    geometry.setAttribute('aVerge', new THREE.BufferAttribute(verge, 4));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // ---- the grid: heights first (the bake marches over them), then the meshes
  const cell = CELL[tier] ?? 6;
  const gw = Math.floor((maxX - minX) / cell) + 1;
  const gh = Math.floor((maxZ - minZ) / cell) + 1;
  const gHeight = new Float32Array(gw * gh);
  const gS = new Float32Array(gw * gh).fill(-1);
  const gLat = new Float32Array(gw * gh);
  const gridX1 = minX + (gw - 1) * cell;
  const gridZ1 = minZ + (gh - 1) * cell;
  {
    let hint = -1;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = minX + i * cell;
        const z = minZ + j * cell;
        const k = j * gw + i;
        if (near(x, z)) {
          track.locate(x, z, hint, spot);
          hint = spot.index;
          gS[k] = spot.s;
          gLat[k] = spot.lat;
          gHeight[k] = heightOf(x, z, spot.s, spot.lat);
        } else gHeight[k] = land(x, z);
        // towards its border the grid eases onto the far land, so the two meet without a step
        const e = Math.min(x - minX, gridX1 - x, z - minZ, gridZ1 - z);
        if (e < 220) {
          const far = bilinear(farHeight, farN, farN, farX0, farZ0, FAR_CELL, x, z);
          gHeight[k] += (far - gHeight[k]) * smoothstep(220, 30, e);
        }
      }
    }
  }
  phases.grid = Math.round(performance.now() - started);
  const inGrid = (x, z) => x >= minX && x <= minX + (gw - 1) * cell && z >= minZ && z <= minZ + (gh - 1) * cell;
  /** The ground's height for the bake's march: the grid where there is one, the land beyond. */
  const coarseHeight = (x, z) =>
    inGrid(x, z) ? bilinear(gHeight, gw, gh, minX, minZ, cell, x, z) : bilinear(farHeight, farN, farN, farX0, farZ0, FAR_CELL, x, z);

  // ---- the bake, on every other grid point
  const bw = Math.ceil(gw / 2);
  const bh = Math.ceil(gh / 2);
  const bcell = cell * 2;
  const bakeGrid = new Float32Array(bw * bh * 3);
  const duskGrid = new Float32Array(bw * bh);
  // (env lane) the golden hour's sun as well: at a few degrees up the ridges' shadows matter most
  const dirs = [lights.day, lights.night, lights.dusk ?? lights.day].map((d) => {
    const h = Math.hypot(d[0], d[2]);
    return { x: d[0] / h, z: d[2] / h, elevation: Math.atan2(d[1], h) };
  });
  const SKY_DIRS = 8;
  function marchSun(x, z, h0, dir, far) {
    let best = -1;
    for (let t = 4; t < far; t *= 1.13) {
      const slope = (coarseHeight(x + dir.x * t, z + dir.z * t) - h0) / t;
      if (slope > best) best = slope;
    }
    // a soft edge a few degrees wide: the grid is coarse, and the sun is not a point
    return smoothstep(-0.09, 0.09, dir.elevation - Math.atan(best));
  }
  function marchSky(x, z, h0) {
    let sum = 0;
    for (let a = 0; a < SKY_DIRS; a++) {
      const dx = Math.cos((a / SKY_DIRS) * Math.PI * 2);
      const dz = Math.sin((a / SKY_DIRS) * Math.PI * 2);
      let best = 0;
      for (let t = 3; t < 160; t *= 1.3) best = Math.max(best, (coarseHeight(x + dx * t, z + dz * t) - h0) / t);
      sum += 1 / (1 + best * best);
    }
    return 1 - 0.85 * (1 - sum / SKY_DIRS);
  }
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = minX + i * bcell;
      const z = minZ + j * bcell;
      const h0 = coarseHeight(x, z) + 1.2;
      const k = (j * bw + i) * 3;
      bakeGrid[k] = marchSun(x, z, h0, dirs[0], 2600);
      bakeGrid[k + 1] = marchSun(x, z, h0, dirs[1], 2600);
      bakeGrid[k + 2] = marchSky(x, z, h0);
      duskGrid[j * bw + i] = marchSun(x, z, h0, dirs[2], 2600);
    }
  }
  // blurred once, so the edge of a valley's shadow is soft rather than stepped by the triangles that carry it
  {
    const tmp = new Float32Array(bakeGrid);
    for (let j = 1; j < bh - 1; j++) {
      for (let i = 1; i < bw - 1; i++) {
        for (let c = 0; c < 2; c++) {
          let sum = 0;
          for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += tmp[((j + b) * bw + i + a) * 3 + c] * (a || b ? 1 : 2);
          bakeGrid[(j * bw + i) * 3 + c] = sum / 10;
        }
      }
    }
    const tmpD = new Float32Array(duskGrid);
    for (let j = 1; j < bh - 1; j++) {
      for (let i = 1; i < bw - 1; i++) {
        let sum = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += tmpD[(j + b) * bw + i + a] * (a || b ? 1 : 2);
        duskGrid[j * bw + i] = sum / 10;
      }
    }
  }
  /** The golden hour's sun share at a point (1 off the grid). */
  function duskAt(x, z) {
    if (!(x >= minX && z >= minZ && x <= minX + (bw - 1) * bcell && z <= minZ + (bh - 1) * bcell)) return 1;
    const fx = Math.min(bw - 1.001, (x - minX) / bcell);
    const fz = Math.min(bh - 1.001, (z - minZ) / bcell);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * bw + i;
    return (duskGrid[k] * (1 - u) + duskGrid[k + 1] * u) * (1 - v) + (duskGrid[k + bw] * (1 - u) + duskGrid[k + bw + 1] * u) * v;
  }
  /** bakeAt with the golden hour's share as a fourth number (aBake as a vec4: see shading.js). */
  function bake4At(x, z, out, o) {
    bakeAt(x, z, out, o);
    out[o + 3] = duskAt(x, z);
  }
  function bakeAt(x, z, out, o) {
    if (!(x >= minX && z >= minZ && x <= minX + (bw - 1) * bcell && z <= minZ + (bh - 1) * bcell)) {
      out[o] = out[o + 1] = out[o + 2] = 1;
      return;
    }
    const fx = Math.min(bw - 1.001, (x - minX) / bcell);
    const fz = Math.min(bh - 1.001, (z - minZ) / bcell);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    for (let c = 0; c < 3; c++) {
      const k = (j * bw + i) * 3 + c;
      const w = bw * 3;
      out[o + c] = (bakeGrid[k] * (1 - u) + bakeGrid[k + 3] * u) * (1 - v) + (bakeGrid[k + w] * (1 - u) + bakeGrid[k + w + 3] * u) * v;
    }
  }

  phases.bake = Math.round(performance.now() - started);
  const bandGeometries = buildBands();
  phases.band = Math.round(performance.now() - started);

  // ---- the grid's meshes
  const covered = new Uint8Array(gw * gh); // 1: under the band, 2: in a portal's opening
  for (let k = 0; k < gw * gh; k++) {
    if (gS[k] < 0) continue;
    const s = gS[k];
    const lat = gLat[k];
    const i = Math.round(wrap(s) / ds) % n;
    const half = lat >= 0 ? 0 : 1;
    if (cover[i] < 0 && ravine[i] < 0 && Math.abs(lat) < ext[half][i] - 0.5) covered[k] = 1;
  }
  for (const t of track.tunnels) {
    for (const portal of [t.s0, t.s1]) {
      for (let k = 0; k < gw * gh; k++) {
        if (gS[k] < 0) continue;
        const along = track.delta(portal, gS[k]);
        const edge = track.edgeAt(gS[k], gLat[k] >= 0 ? 1 : -1);
        if (Math.abs(along) < cell * 0.75 && Math.abs(gLat[k]) < edge + 6) covered[k] = 2;
      }
    }
  }
  const gridGeometries = [];
  /** (sea lane) Ground this far under the water's level is never seen: the waves' troughs do not reach it. */
  const DROWNED = lakeLevel - 2;
  // cells per chunk side: (finish lane) about 400 m on medium as on low (it was 288 m: fifteen pieces of grid in a
  // view at night), 240 m on high
  const CH = tier === 'medium' ? 64 : 48;
  let gridTriangles = 0;
  for (let cj = 0; cj < gh - 1; cj += CH) {
    for (let ci = 0; ci < gw - 1; ci += CH) {
      const w = Math.min(CH, gw - 1 - ci) + 1;
      const h = Math.min(CH, gh - 1 - cj) + 1;
      const pos = new Float32Array(w * h * 3);
      const nor = new Float32Array(w * h * 3);
      const bake = new Float32Array(w * h * 4);
      const mask = new Float32Array(w * h * 2);
      for (let b = 0; b < h; b++) {
        for (let a = 0; a < w; a++) {
          const i = ci + a;
          const j = cj + b;
          const k = j * gw + i;
          const v = b * w + a;
          const x = minX + i * cell;
          const z = minZ + j * cell;
          const y = gHeight[k];
          // pulled under the band where the band lies over it
          pos[v * 3] = x;
          pos[v * 3 + 1] = covered[k] === 1 ? y - 0.4 : y;
          pos[v * 3 + 2] = z;
          const hx = (gHeight[j * gw + Math.min(gw - 1, i + 1)] - gHeight[j * gw + Math.max(0, i - 1)]) / (2 * cell);
          const hz = (gHeight[Math.min(gh - 1, j + 1) * gw + i] - gHeight[Math.max(0, j - 1) * gw + i]) / (2 * cell);
          const inv = 1 / Math.hypot(hx, 1, hz);
          nor[v * 3] = -hx * inv;
          nor[v * 3 + 1] = inv;
          nor[v * 3 + 2] = -hz * inv;
          bake4At(x, z, bake, v * 4);
          const s = gS[k] >= 0 ? gS[k] : null;
          const d = s === null ? 1e9 : Math.max(0, Math.abs(gLat[k]) - track.edgeAt(s, gLat[k] >= 0 ? 1 : -1));
          mask[v * 2] = forestOf(x, z, y, 1 - inv, s, gLat[k], d);
          mask[v * 2 + 1] = smoothstep(0.6, 0.9, 1 - inv) * 0.5;
        }
      }
      const index = [];
      for (let b = 0; b < h - 1; b++) {
        for (let a = 0; a < w - 1; a++) {
          const k00 = (cj + b) * gw + ci + a;
          const c00 = covered[k00];
          const c10 = covered[k00 + 1];
          const c01 = covered[k00 + gw];
          const c11 = covered[k00 + gw + 1];
          const v = b * w + a;
          const drop = (p, q, r) => (p && q && r) || p === 2 || q === 2 || r === 2;
          // (sea lane) and none wholly under the sea, which hides it
          const h00 = gHeight[k00] < DROWNED;
          const h10 = gHeight[k00 + 1] < DROWNED;
          const h01 = gHeight[k00 + gw] < DROWNED;
          const h11 = gHeight[k00 + gw + 1] < DROWNED;
          if (!drop(c00, c01, c10) && !(h00 && h01 && h10)) index.push(v, v + w, v + 1);
          if (!drop(c10, c01, c11) && !(h10 && h01 && h11)) index.push(v + 1, v + w, v + w + 1);
        }
      }
      if (!index.length) continue;
      gridTriangles += index.length / 3;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
      geometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
      geometry.setIndex(index);
      geometry.computeBoundingSphere();
      gridGeometries.push(geometry);
    }
  }

  phases.meshes = Math.round(performance.now() - started);
  // ---- the far land
  let farGeometry;
  {
    const m = farN;
    const x0 = farX0;
    const z0 = farZ0;
    const heights = farHeight;
    const pos = new Float32Array(m * m * 3);
    const bake = new Float32Array(m * m * 4);
    const mask = new Float32Array(m * m * 2);
    // (lead) The far land has a hole where the grid is, and its rim is the grid's border exactly. It used to run on
    // under the grid, sunk 150 m in the middle but at its own height (less 1.5 m) for two cells in from the border: where
    // the road stood within those two cells of the border, in a cutting lower than the land, a far triangle 100 to 140 m
    // across lay over the road, seen only from above: a dark slab over the car in a tall picture (owner's screenshots at
    // the esses). Now the lattice's lines nearest the border are moved onto it (their heights read there from the same
    // lattice the grid's border eases onto, so the two edges are the same line), and no triangle is made inside them.
    const snap = (lo, hi, origin) => {
      const a = Math.max(1, Math.min(m - 3, Math.round((lo - origin) / FAR_CELL)));
      const b = Math.max(a + 1, Math.min(m - 2, Math.round((hi - origin) / FAR_CELL)));
      return [a, b];
    };
    const [holeI0, holeI1] = snap(minX, gridX1, x0);
    const [holeJ0, holeJ1] = snap(minZ, gridZ1, z0);
    const lineX = (i) => (i === holeI0 ? minX : i === holeI1 ? gridX1 : x0 + i * FAR_CELL);
    const lineZ = (j) => (j === holeJ0 ? minZ : j === holeJ1 ? gridZ1 : z0 + j * FAR_CELL);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const v = j * m + i;
        const x = lineX(i);
        const z = lineZ(j);
        const moved = i === holeI0 || i === holeI1 || j === holeJ0 || j === holeJ1;
        pos[v * 3] = x;
        pos[v * 3 + 1] = moved ? bilinear(heights, m, m, x0, z0, FAR_CELL, x, z) : heights[v];
        pos[v * 3 + 2] = z;
        const h0 = heights[v] + 2;
        bake[v * 4] = marchSun(x, z, h0, dirs[0], 4000);
        bake[v * 4 + 1] = marchSun(x, z, h0, dirs[1], 4000);
        bake[v * 4 + 2] = marchSky(x, z, h0);
        bake[v * 4 + 3] = marchSun(x, z, h0, dirs[2], 4000);
        const hx = (heights[j * m + Math.min(m - 1, i + 1)] - heights[j * m + Math.max(0, i - 1)]) / (2 * FAR_CELL);
        const hz = (heights[Math.min(m - 1, j + 1) * m + i] - heights[Math.max(0, j - 1) * m + i]) / (2 * FAR_CELL);
        // the far land is wooded but for its steep faces and what lies above the tree line: the near wood's own
        // patches grown together (seen through the haze under the massif, open land read as a pale band)
        const steep = 1 - 1 / Math.hypot(hx, 1, hz);
        const wooded =
          heights[v] < lakeLevel + 0.6
            ? 0
            : smoothstep(0.1, 0.26, noise.fbm(x / 230 + 11, z / 230, 4)) * (1 - smoothstep(330, 420, heights[v])) * (1 - smoothstep(0.55, 0.8, steep));
        mask[v * 2] = Math.max(forestOf(x, z, heights[v], steep, null, 0, 0), wooded);
      }
    }
    const index = [];
    // (sea lane) leaving out the triangles wholly under the sea (by the land's own heights, not the lowered ones
    // under the grid, which nothing sees either way)
    const dry = (v) => heights[v] >= DROWNED - 1;
    for (let j = 0; j < m - 1; j++) {
      for (let i = 0; i < m - 1; i++) {
        const v = j * m + i;
        // the hole the grid fills
        if (i >= holeI0 && i < holeI1 && j >= holeJ0 && j < holeJ1) continue;
        if (dry(v) || dry(v + m) || dry(v + 1)) index.push(v, v + m, v + 1);
        if (dry(v + 1) || dry(v + m) || dry(v + m + 1)) index.push(v + 1, v + m, v + m + 1);
      }
    }
    farGeometry = new THREE.BufferGeometry();
    farGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    farGeometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    farGeometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    farGeometry.setIndex(index);
    farGeometry.computeVertexNormals();
  }

  // ---- (sea lane, round 2) where the swell runs big: off the low crossing's outer side, in the bay (CAUSEWAY.surf)
  const surf = (() => {
    let s0 = 0;
    for (const seg of track.layout?.segments ?? []) {
      const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
      if (seg.id === CAUSEWAY.piece) {
        const p = track.pointAt(s0 + len * CAUSEWAY.surf.at, CAUSEWAY.surf.out, new THREE.Vector3());
        return { x: p.x, z: p.z, r: CAUSEWAY.surf.r };
      }
      s0 += len;
    }
    return null;
  })();

  // ---- (sea lane) the sea map: what the water's shader and the ground's need to know about the coast, per texel
  // (SeaShape.map): the depth, and how far land and water are from each other (two chamfer passes over the texels)
  const seaMap = (() => {
    const { size, half } = SEA.map;
    const x0 = mid.x - half;
    const z0 = mid.z - half;
    const step = (2 * half) / size;
    const data = new Uint8Array(size * size * 4);
    const toWater = new Float32Array(size * size);
    const toLand = new Float32Array(size * size);
    const BIG = 1e9;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = x0 + (i + 0.5) * step;
        const z = z0 + (j + 0.5) * step;
        const k = j * size + i;
        const wet = seaAt(x, z);
        const depth = wet >= 0.5 ? Math.max(0, lakeLevel - coarseHeight(x, z)) : 0;
        const water = depth > 0;
        toWater[k] = water ? 0 : BIG;
        toLand[k] = water ? BIG : 0;
        data[k * 4] = Math.round(255 * Math.sqrt(Math.min(1, depth / 64)));
        data[k * 4 + 3] = Math.round(255 * wet);
      }
    }
    const chamfer = (f) => {
      const a = step;
      const b = step * Math.SQRT2;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const k = j * size + i;
          let v = f[k];
          if (i > 0) v = Math.min(v, f[k - 1] + a);
          if (j > 0) {
            v = Math.min(v, f[k - size] + a);
            if (i > 0) v = Math.min(v, f[k - size - 1] + b);
            if (i < size - 1) v = Math.min(v, f[k - size + 1] + b);
          }
          f[k] = v;
        }
      }
      for (let j = size - 1; j >= 0; j--) {
        for (let i = size - 1; i >= 0; i--) {
          const k = j * size + i;
          let v = f[k];
          if (i < size - 1) v = Math.min(v, f[k + 1] + a);
          if (j < size - 1) {
            v = Math.min(v, f[k + size] + a);
            if (i < size - 1) v = Math.min(v, f[k + size + 1] + b);
            if (i > 0) v = Math.min(v, f[k + size - 1] + b);
          }
          f[k] = v;
        }
      }
    };
    chamfer(toWater);
    chamfer(toLand);
    for (let k = 0; k < size * size; k++) {
      data[k * 4 + 1] = Math.round(255 * Math.min(1, toWater[k] / 500));
      data[k * 4 + 2] = Math.round(255 * Math.min(1, toLand[k] / 160));
    }
    return { size, x0, z0, extent: 2 * half, data };
  })();
  phases.sea = Math.round(performance.now() - started);

  // ---- assembled
  const group = new THREE.Group();
  group.name = 'terrain';
  for (const geometry of [...bandGeometries, ...gridGeometries]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = bandGeometries.includes(geometry) ? 'terrain-band' : 'terrain-grid';
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  const far = new THREE.Mesh(farGeometry, material);
  far.name = 'terrain-far';
  far.receiveShadow = true;
  far.matrixAutoUpdate = false;
  group.add(far);

  const normal = new THREE.Vector3();
  let vertices = 0;
  let triangles = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    vertices += o.geometry.attributes.position.count;
    triangles += o.geometry.index.count / 3;
  });

  return {
    group,
    material,
    lake: { level: lakeLevel, extent: { x0: LAKE.x - LAKE.rx * 1.1, x1: LAKE.x + LAKE.rx * 1.1, z0: LAKE.z - LAKE.rz * 1.1, z1: LAKE.z + LAKE.rz * 1.1 } },
    sea: { level: lakeLevel, at: seaAt, sector: seaSector, map: seaMap, stacks, surf },
    volcano,
    heightAt,
    heightOnTrack,
    normalAt(x, z, out = normal) {
      const e = 1;
      const hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      return out.set(-hx, 1, -hz).normalize();
    },
    forestAt(x, z) {
      if (!near(x, z)) return forestOf(x, z, land(x, z), 0, null, 0, 0);
      track.locate(x, z, -1, spot);
      const side = spot.lat >= 0 ? 1 : -1;
      const d = Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, side));
      return forestOf(x, z, heightOf(x, z, spot.s, spot.lat), 0, spot.s, spot.lat, d);
    },
    bakeAt,
    bake4At,
    cliffAt: (s, side) => ({ ...cliffAt(s, side) }),
    stats: { vertices, triangles, gridTriangles, ms: Math.round(performance.now() - started), phases },
    dispose() {
      group.traverse((o) => o.isMesh && o.geometry.dispose());
    },
  };
}

export { withBake };
