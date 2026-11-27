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
import { createLakeside } from './lakeside.js';
import { goldwoodOf } from './goldwood.js';
import { ARM, createArm } from './arm.js';
import { APPROACH, approachAt, approachesOf, beforeFace, behindFace, coverOver, meadowAt, rise as approachRise, woodAt as approachWood } from './approach.js';

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
/** How far the far land's lattice is sunk under the arm of the lake's fine ground (m). */
const ARM_SINK = 60;
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
 * @property {{ level: number, extent: { x0: number, x1: number, z0: number, z1: number } }} lake where the water lies
 * @property {object} stats vertices, triangles, milliseconds
 * @property {() => void} dispose
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
  // the lakeside (lakeside.js): one place where the land beyond the solid edges is shaped by hand
  const lakeside = createLakeside(track, rng.fork('lakeside'));

  // the arm of the lake (arm.js): the other place where the land beyond the solid edges is shaped by hand (it only
  // lowers ground, on the outside of the lap below the gully bridge's end)
  const arm = createArm(track, rng.fork('arm'));
  // the golden wood (goldwood.js): the esses in autumn; it moves no ground, only marks the band beside the road
  const goldwood = goldwoodOf(track);

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
  const cliffL = cliffOf(rockL, track.farSlopeL);
  // (cliffR0: the right-hand cliffs before the lakeside lowers its cut; the land `before` it keeps them)
  const cliffR0 = cliffOf(rockR, track.farSlopeR);
  // (ref lane) the approach to a tunnel's entrance is a meadow, not a cutting (approach.js): per sample, which
  // approach it belongs to and how much of the place it is. There the edge's cliff is a low wall's height, standing
  // nearly upright behind the wall, and the slopes beyond it are the meadow's (nearAt)
  const approaches = approachesOf(track);
  const apI = new Int8Array(n).fill(-1);
  const apK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = approachAt(track, i * ds);
    if (!z) continue;
    apI[i] = approaches.indexOf(z.A);
    apK[i] = z.k;
    // (the edge is a wall's right up to the face: its kind changes there, and the eased share would halve it)
    if (z.a < 7) rockL[i] = rockR[i] = 1;
    cliffL[i] += (rockL[i] * APPROACH.wall - cliffL[i]) * z.k;
    cliffR0[i] += (rockR[i] * APPROACH.wall - cliffR0[i]) * z.k;
  }
  /** The approach at s (the nearer sample's), or null. */
  const approachOf = (s) => {
    const i = Math.floor(wrap(s) / ds) % n;
    const k = apI[i] >= 0 ? apI[i] : apI[i + 1 === n ? 0 : i + 1];
    return k >= 0 ? approaches[k] : null;
  };
  // (the lakeside's cut on the right is lower than the Track's rock edge would make it)
  const cliffR = lakeside ? cliffR0.map((h, i) => lakeside.cliff(i * ds, -1, h)) : cliffR0;
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
      // (ref lane) a hillside behind the entrance, the ridge's own height towards the exit (approach.js)
      cover[i % n] = coverOver(s - t.s0, t.s1 - s);
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
      ravine[i % n] = Math.max(1.5, drop * Math.pow(v, gully ? 1.4 : 0.6) + notch);
    }
  }
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
  const lakeE = (x, z) => ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
  function valley(x, z) {
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
        const g = valley(x, z);
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
  /** The land's shape with its hills: what the ground is far from any road. */
  const land = (x, z) => (inMacro(x, z) ? bilinear(macro, mx, mz, minX, minZ, MACRO, x, z) : valley(x, z)) + detail(x, z);

  const phases = { macro: Math.round(performance.now() - started) };
  // the far land's heights, on its own coarse grid (the bake marches over them too)
  const farN = Math.round((FAR_REACH * 2) / FAR_CELL) + 1;
  const farX0 = mid.x - FAR_REACH;
  const farZ0 = mid.z - FAR_REACH;
  const farHeight = new Float32Array(farN * farN);
  for (let j = 0; j < farN; j++) {
    for (let i = 0; i < farN; i++) farHeight[j * farN + i] = landAt(farX0 + i * FAR_CELL, farZ0 + j * FAR_CELL);
  }
  // ---- layer 1: the corridor and the hillside just beyond it
  const prof = { y: 0, surface: 0 };
  /** The cliff behind the edge on one side at s. */
  const cliff = { top: 0, height: 0, rock: 0, lean: LEAN };
  function cliffAt(s, side, raw = false) {
    cliff.rock = read(side > 0 ? rockL : rockR, s);
    cliff.height = read(side > 0 ? cliffL : raw ? cliffR0 : cliffR, s);
    cliff.lean = LEAN + (APPROACH.lean - LEAN) * read(apK, s);
    cliff.top = cliff.height > 0.01 ? FOOT * cliff.rock + cliff.lean * cliff.height : 0;
    return cliff;
  }
  /**
   * Height of the corridor and its hillside at track coordinates, before the land takes over. `front`: as seen from
   * in front of a portal's face (the band's last row before an entrance: the ground the headwall stands in, not the
   * ground it holds back). `raw`: the land before the lakeside was shaped.
   */
  function nearAt(s, lat, edge, d, front = false, raw = false) {
    let y;
    if (d <= 0) y = track.profile(s, lat, prof).y;
    else {
      const side = lat > 0 ? 1 : -1;
      y = track.profile(s, side * edge, prof).y;
      const c = cliffAt(s, side, raw);
      let beyond = d;
      if (c.height > 0.01) {
        const foot = FOOT * c.rock;
        y += c.height * smoothstep(0, 1, (d - foot) / (c.lean * c.height));
        beyond = Math.max(0, d - c.top);
      }
      let far = read(side > 0 ? track.farSlopeL : track.farSlopeR, s);
      if (lakeside && !raw) far = lakeside.far(s, side, far);
      let up = far * 40 * (1 - Math.exp(-beyond / 40));
      // (ref lane) on a tunnel's approach, the meadow's slopes
      const k = read(apK, s);
      const A = k > 0 ? approachOf(s) : null;
      if (A) up += (approachRise(A, side, beforeFace(track, A, s), beyond) - up) * k;
      y += up;
      // (the lakeside's low cut and gentle bank give way to the hillside the Track asks for, so that the spur it
      // shares with the leg that comes back from the carousel keeps its shape on that leg's side)
      const back = lakeside && !raw ? lakeside.bankEnds(s, side, d) : 0;
      if (back > 0) y += (nearAt(s, lat, edge, d, front, true) - y) * back;
    }
    // over a bore the ground stays above its crown, falling away to the sides; under a deck it keeps clear of it.
    // Both ease to nothing at their ends, so the ground is continuous along the road (except in the portals,
    // which are cut open)
    const zone = front ? 0 : zoneOf(s);
    if (zone === 1) {
      const road = read(track.py, s);
      let floor = road + BORE_HEIGHT + read(cover, s) - 0.35 * Math.max(0, d - 4);
      // (ref lane) behind an entrance's headwall the ground stands as high as the wall holds it
      for (const A of approaches) {
        const u = track.delta(A.s0, s);
        if (u > -1.5 && u < 40) floor = Math.max(floor, road + behindFace(A, lat, u));
      }
      y = Math.max(y, floor);
    } else if (zone === 2) y = Math.min(y, read(track.py, s) - read(ravine, s) - 0.02 * Math.abs(lat));
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

  /** H at a point whose track coordinates are known (`raw`: the land before the lakeside was shaped). */
  function heightOf(x, z, s, lat, front = false, raw = false) {
    let h = heightBefore(x, z, s, lat, front, raw);
    if (raw) return h;
    if (lakeside) h = lakeside.ground(x, z, h, s, lat);
    return arm ? arm.ground(x, z, h, s, lat) : h;
  }
  function heightBefore(x, z, s, lat, front, raw) {
    const side = lat >= 0 ? 1 : -1;
    const edge = track.edgeAt(s, side);
    const d = Math.max(0, Math.abs(lat) - edge);
    let near = nearAt(s, lat, edge, d, front, raw);
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
        const hB = nearAt(sB, latB, edgeB, dB, false, raw);
        // Where one of the two is on a deck its ground is a ravine's floor far below: each then keeps its own
        // hillside for the first third of the way and they meet in a scarp between (so the bank the Track asks for
        // behind a wall is there, and the valley under the deck has a side), instead of one long ramp
        const scarp = (zoneOf(s) === 2) !== (zoneOf(sB) === 2);
        const share = d / (d + dB + 1e-3);
        near += (hB - near) * (scarp ? smoothstep(0.34, 0.66, share) : smoothstep(0, 1, share));
        reach = smoothstep(80, 200, g);
      }
    }
    const w = smoothstep(10, 100, d) * reach;
    if (w <= 0) return near;
    const far = (inMacro(x, z) ? bilinear(macro, mx, mz, minX, minZ, MACRO, x, z) : valley(x, z)) + detail(x, z) * smoothstep(15, 150, d);
    return near + (far - near) * w;
  }
  const near = (x, z) => (inMacro(x, z) ? bilinear(macroD, mx, mz, minX, minZ, MACRO, x, z) : 1e9) < NEAR_REACH;
  /** The land far from any road, with the lakeside in it. */
  function landAt(x, z) {
    const h = lakeside ? lakeside.ground(x, z, land(x, z)) : land(x, z);
    return arm ? arm.ground(x, z, h) : h;
  }
  function heightAt(x, z, raw = false) {
    if (!near(x, z)) return raw ? land(x, z) : landAt(x, z);
    track.locate(x, z, -1, spot);
    return heightOf(x, z, spot.s, spot.lat, false, raw);
  }
  function forestAt(x, z, raw = false) {
    if (!near(x, z)) return forestOf(x, z, raw ? land(x, z) : landAt(x, z), 0, null, 0, 0, raw);
    track.locate(x, z, -1, spot);
    const side = spot.lat >= 0 ? 1 : -1;
    const d = Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, side));
    return forestOf(x, z, heightOf(x, z, spot.s, spot.lat, false, raw), 0, spot.s, spot.lat, d, raw);
  }
  /** How steep the ground is at a point: 1 - the normal's y (the ground material's own measure). */
  const SPUR_STEEP = 0.17;
  function steepAt(x, z) {
    const hx = (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4;
    const hz = (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
    return 1 - 1 / Math.hypot(hx, 1, hz);
  }
  const pointScratch = new THREE.Vector3();
  function heightOnTrack(s, lat) {
    track.pointAt(s, lat, pointScratch);
    return heightOf(pointScratch.x, pointScratch.z, s, lat);
  }

  // ---- the forest: where the Track says trees stand, and in patches on the massif and the far slopes
  function forestOf(x, z, y, slope, s, lat, d, raw = false) {
    let f = forestBefore(x, z, y, slope, s, lat, d);
    if (raw) return f;
    if (lakeside) f = lakeside.wood(x, z, f, s, lat);
    // (the far range's snow, a negative mask, is the lakeside's own)
    return arm && f >= 0 ? arm.wood(x, z, f, s, lat) : f;
  }
  function forestBefore(x, z, y, slope, s, lat, d) {
    if (y < lakeLevel + 0.6) return 0;
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
    // (ref lane) a tunnel's approach: no wood on its meadow, the spruce wood beside it
    if (s !== null) {
      const p = placeOf(s, lat, d);
      if (p) f = Math.max(f * (1 - p.meadow), p.wood);
    }
    return f * (1 - smoothstep(0.55, 0.8, slope));
  }
  /** What a point near a tunnel's approach is (approach.js): { meadow, wood } 0..1 each, or null away from any. */
  const place = { meadow: 0, wood: 0 };
  function placeOf(s, lat, d) {
    for (const A of approaches) {
      const a = beforeFace(track, A, s);
      if (a > APPROACH.open + 40 || a < -APPROACH.behind - 70) continue;
      const side = lat >= 0 ? 1 : -1;
      place.meadow = meadowAt(A, side, a, d);
      place.wood = approachWood(A, side, a, d);
      return place;
    }
    return null;
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
        const woodHere = track.woodAt ? !!track.woodAt(s, side) && !lakeside?.open(s, side) && !arm?.opens(s, side) : false;
        const gold = goldwood ? goldwood.stretch(s) : 0;
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
          // (the last row before an entrance is a sample just inside it: it carries the ground in front of the face)
          const y = heightOf(pt.x, pt.z, s, lat, cover[i] >= 0 && apI[i] >= 0);
          const v = (r * 2 + half) * cols + k;
          pos[v * 3] = pt.x;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = pt.z;
          bake4At(pt.x, pt.z, bake, v * 4);
          // the verge and the bank under the woods see less sky (canopy.js; under the crowns it has no meaning)
          const sky = bake[v * 4 + 2];
          if (Math.abs(lat) < edge + CANOPY.clear) bake[v * 4 + 2] *= canopyOpen(track, s, lat);
          const slope = k >= 2 && k <= 6 && c.height > 0.01 ? 0.9 : 0;
          mask[v * 2] = k <= 1 ? 0 : forestOf(pt.x, pt.z, y, slope, s, lat, d);
          verge[v * 4] = Math.abs(lat) - pave;
          verge[v * 4 + 1] = s + lapOffset;
          verge[v * 4 + 2] = Math.abs(lat) - edge;
          // w: 0 on a verge with no wood behind it, 0.4 under woods (leaf litter); vertices without the attribute read 1
          // (the golden wood, goldwood.js: up to 0.09 more, by how much of that place it is; the ground's material
          // paints its pale grass and fallen leaves from it)
          verge[v * 4 + 3] = woodHere ? 0.4 + 0.09 * gold : 0;
          // the verge and the cliff's foot are loose stone where the verge is gravel
          mask[v * 2 + 1] = gravel ? (k <= 2 ? 1 : k <= 6 ? 0.6 : 0.3 * (1 - smoothstep(4, 12, d))) : 0;
          // (ref lane) a negative aMask.y is the meadow of a tunnel's approach (groundMaterial.js), verge and all
          const p = gravel ? null : placeOf(s, lat, d);
          if (p && p.meadow > 0) mask[v * 2 + 1] = -p.meadow;
          // (and its verge is under no canopy: the wood beside it is cleared)
          if (p && p.meadow > 0 && Math.abs(lat) < edge + CANOPY.clear) bake[v * 4 + 2] += (sky - bake[v * 4 + 2]) * p.meadow;
          // (the lakeside's spur: its steep ground is the bank's weathered stone, aMask.y = 3, not the lap's grey rock)
          if (lakeside && !(p && p.meadow > 0) && k >= 7 && lakeside.spur(pt.x, pt.z, s, lat) > 0.5 && steepAt(pt.x, pt.z) > SPUR_STEEP) mask[v * 2 + 1] = 3;
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
        } else gHeight[k] = landAt(x, z);
        // towards its border the grid eases onto the far land, so the two meet without a step
        const e = Math.min(x - minX, gridX1 - x, z - minZ, gridZ1 - z);
        if (e < 220) {
          const far = bilinear(farHeight, farN, farN, farX0, farZ0, FAR_CELL, x, z);
          // (but not where the arm of the lake's own fine ground runs on beyond the border: armPatch below)
          gHeight[k] += (far - gHeight[k]) * smoothstep(220, 30, e) * (arm ? 1 - arm.fine(x, z) : 1);
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
  // (ref lane) An entrance's headwall holds the hill back along its whole length: the ground steps up across the
  // line of its face. A triangle of the grid with corners on both sides of that line, any of them within the wall's
  // length, would be a ramp through the wall: it is left out (the band lies in front of the wall, the tunnel's apron
  // behind it and beyond the band's reach: entrance.js). Per grid point: 1 in front of a face, 2 behind it, +4 within
  // the wall's length.
  const gFace = new Uint8Array(gw * gh);
  for (const A of approaches) {
    for (let k = 0; k < gw * gh; k++) {
      if (gS[k] < 0) continue;
      const along = track.delta(A.s0, gS[k]);
      if (Math.abs(along) >= cell * 1.5) continue;
      const side = gLat[k] >= 0 ? 1 : -1;
      const walled = Math.abs(gLat[k]) - A.edge[side] < (side === A.up ? A.upEnd : A.downEnd) + 3;
      gFace[k] = (along < 0 ? 1 : 2) | (walled ? 4 : 0);
    }
  }
  const throughFace = (p, q, r) => {
    const any = gFace[p] | gFace[q] | gFace[r];
    return (any & 7) === 7;
  };
  const gridGeometries = [];
  // A triangle of the grid that reaches over the road. A cell is dropped only where all its corners lie
  // under the band; a cell with corners both under it and beyond it (where the band stops short: on a deck and at its
  // abutments, where another stretch is nearer, on the inside of a tight bend) is a plane between ground at the road's
  // height and ground well above or below it, and across a corridor that plane can stand over the road (the owner's
  // "dark slab across the lane" at the sky road's end, beside the rock cut). Each triangle with a corner near a
  // corridor is sampled; one standing over the road anywhere inside the solid edges is left out (the road, the band
  // and the rock faces cover what it covered). Defined once: `standsOverRoad`, also asked of the far land.
  const probe = { index: -1, s: 0, lat: 0 };
  const probeProf = { y: 0, surface: 0 };
  const SAMPLES = [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1], [0.5, 0.5], [0.5, 0], [0, 0.5], [0.45, 0.1], [0.1, 0.45], [0.7, 0.25], [0.25, 0.7]];
  function standsOverRoad(ax, ay, az, bx, by, bz, cx, cy, cz) {
    for (const [u, w] of SAMPLES) {
      const x = ax + (bx - ax) * u + (cx - ax) * w;
      const z = az + (bz - az) * u + (cz - az) * w;
      const y = ay + (by - ay) * u + (cy - ay) * w;
      track.locate(x, z, probe.index, probe);
      const edge = track.edgeAt(probe.s, probe.lat >= 0 ? 1 : -1);
      if (Math.abs(probe.lat) > edge) continue;
      // (the tunnels' bores are cut open in their portals; under a roof the ground stands over the road by design)
      if (cover[Math.round(wrap(probe.s) / ds) % n] >= 0) continue;
      if (y > track.profile(probe.s, probe.lat, probeProf).y - 0.05) return true;
    }
    return false;
  }
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
          const p = s === null ? null : placeOf(s, gLat[k], d);
          if (p && p.meadow > 0) mask[v * 2 + 1] = -p.meadow;
          if (lakeside && !(p && p.meadow > 0) && s !== null && 1 - inv > SPUR_STEEP && lakeside.spur(x, z, s, gLat[k]) > 0.5) mask[v * 2 + 1] = 3;
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
          const k10 = k00 + 1;
          const k01 = k00 + gw;
          // and none over the road: tested where a corner lies within two cells of a corridor
          const nearRoad = (q) => gS[q] >= 0 && Math.abs(gLat[q]) < track.edgeAt(gS[q], gLat[q] >= 0 ? 1 : -1) + 2 * cell;
          const over = (p, q, r) =>
            (nearRoad(p) || nearRoad(q) || nearRoad(r)) &&
            standsOverRoad(...[p, q, r].flatMap((m) => [minX + (m % gw) * cell, pos[(((m / gw) | 0) - cj) * w * 3 + ((m % gw) - ci) * 3 + 1], minZ + ((m / gw) | 0) * cell]));
          if (!drop(c00, c01, c10) && !throughFace(k00, k01, k10) && !over(k00, k01, k10)) index.push(v, v + w, v + 1);
          if (!drop(c10, c01, c11) && !throughFace(k10, k01, k01 + 1) && !over(k10, k01, k01 + 1)) index.push(v + 1, v + w, v + w + 1);
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
    // The far land has a hole where the grid is, and its rim is the grid's border exactly. It used to run on under
    // the grid, sunk 150 m in the middle but at its own height (less 1.5 m) for two cells in from the border: where
    // the road stood within those two cells, in a cutting lower than the land, a far triangle 100 to 140 m across lay
    // over the road, seen only from above: a dark slab over the car in a tall picture (the owner's screenshots at the
    // esses). Now the lattice's lines nearest the border are moved onto it (their heights read there from the same
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
        // (under the arm of the lake's fine ground the lattice is out of the way: armPatch below draws that ground)
        if (arm && (arm.fine(x, z) >= 1 || arm.valleyFine(x, z) >= 1)) pos[v * 3 + 1] -= ARM_SINK;
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
        // (negative: the lakeside's far range asks for snow there, groundMaterial.js)
        const own = forestOf(x, z, heights[v], steep, null, 0, 0);
        mask[v * 2] = own < 0 ? own : Math.max(own, wooded);
      }
    }
    const index = [];
    for (let j = 0; j < m - 1; j++) {
      for (let i = 0; i < m - 1; i++) {
        const v = j * m + i;
        // the hole the grid fills
        if (i >= holeI0 && i < holeI1 && j >= holeJ0 && j < holeJ1) continue;
        index.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
      }
    }
    farGeometry = new THREE.BufferGeometry();
    farGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    farGeometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    farGeometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    farGeometry.setIndex(index);
    farGeometry.computeVertexNormals();
  }

  /**
   * Where the lake's sheet of water is laid. With the arm of the lake (arm.js) it reaches over the arm too, grown
   * by whole cells of the sheet's grid so that the water beside the straight keeps every vertex it had; `within`
   * then keeps it out of the ground between the two that it has no business under.
   */
  function lakeSheet() {
    const base = { x0: LAKE.x - LAKE.rx * 1.1, x1: LAKE.x + LAKE.rx * 1.1, z0: LAKE.z - LAKE.rz * 1.1, z1: LAKE.z + LAKE.rz * 1.1 };
    // (`extent` stays the lake beside the straight: the mist and the far shore's village are placed from it)
    if (!arm) return { level: lakeLevel, extent: base, sheet: { extent: base } };
    const CELL = 40;
    const e = arm.extent;
    const grow = (d) => CELL * Math.ceil(Math.max(0, d) / CELL);
    const extent = { x0: base.x0 - grow(base.x0 - e.x0), x1: base.x1 + grow(e.x1 - base.x1), z0: base.z0 - grow(base.z0 - e.z0), z1: base.z1 + grow(e.z1 - base.z1) };
    const within = (x, z) => (x >= base.x0 - 1e-6 && x <= base.x1 + 1e-6 && z >= base.z0 - 1e-6 && z <= base.z1 + 1e-6) || arm.shore(x, z) > -45;
    return { level: lakeLevel, extent: base, sheet: { extent, cell: CELL, within } };
  }

  // ---- the arm of the lake's fine ground (arm.js `fine`, `valleyFine`). The arm lies where the grid eases onto the
  // far land and beyond it, on the 100 m lattice, where a shore is straight in pieces and a spur is three flat
  // planes. Beyond the grid's rectangle a patch on a fine grid of its own draws the land's own heights where the
  // place says so, easing onto the lattice's facets at its rim (the grid does the same inside its rectangle, above;
  // the lattice under a patch is sunk). Its lines lie on the grid's border, where both have the same height. Two
  // patches: round the arm's shore (14 m cells), and the valley's spurs and range (42 m).
  const finePatches = [];
  /**
   * @param {(x: number, z: number) => number} weight 0..1 how much of the ground is the patch's
   * @param {{ x0: number, x1: number, z0: number, z1: number }} box where to look for it
   * @param {number} c its cell (m)
   * @param {(x: number, z: number, y: number, steep: number) => number} stone the patch's aMask.y
   * @param {(x: number, z: number) => number} other the other patch's weight: where that one is whole the lattice is
   *   sunk under it, so this one keeps to the land's own heights there instead of easing onto the lattice, and
   *   where `yields` is set draws nothing that the other covers whole
   * @param {boolean} yields
   */
  function finePatch(weight, box, c, stone, other, yields) {
    const px0 = minX - c * Math.ceil((minX - box.x0) / c);
    const pz0 = minZ - c * Math.ceil((minZ - box.z0) / c);
    const pw = Math.ceil((box.x1 - px0) / c) + 1;
    const ph = Math.ceil((box.z1 - pz0) / c) + 1;
    const lattice = (x, z) => bilinear(farHeight, farN, farN, farX0, farZ0, FAR_CELL, x, z);
    const fine = new Float32Array(pw * ph);
    const high = new Float32Array(pw * ph);
    const covered = new Uint8Array(pw * ph);
    for (let j = 0; j < ph; j++) {
      for (let i = 0; i < pw; i++) {
        const x = px0 + i * c;
        const z = pz0 + j * c;
        const own = weight(x, z);
        const o = own > 0 || yields ? other(x, z) : 0;
        const w = Math.max(own, own > 0 ? o : 0);
        fine[j * pw + i] = own;
        covered[j * pw + i] = yields && o >= 1 ? 1 : 0;
        // (at its rim the patch lies a little under the lattice's facets, so that the two never share a surface)
        const l = lattice(x, z);
        high[j * pw + i] = (w > 0 ? l + (heightAt(x, z) - l) * w : l) - 1.5 * (1 - smoothstep(0, 0.3, w));
      }
    }
    const inRect = (x, z) => x >= minX - 1e-3 && x <= gridX1 + 1e-3 && z >= minZ - 1e-3 && z <= gridZ1 + 1e-3;
    const slot = new Int32Array(pw * ph).fill(-1);
    const pos = [];
    const nor = [];
    const bake = [];
    const mask = [];
    const index = [];
    const at = (i, j) => {
      const k = j * pw + i;
      if (slot[k] >= 0) return slot[k];
      const x = px0 + i * c;
      const z = pz0 + j * c;
      const y = high[k];
      const hx = (high[j * pw + Math.min(pw - 1, i + 1)] - high[j * pw + Math.max(0, i - 1)]) / (2 * c);
      const hz = (high[Math.min(ph - 1, j + 1) * pw + i] - high[Math.max(0, j - 1) * pw + i]) / (2 * c);
      const inv = 1 / Math.hypot(hx, 1, hz);
      pos.push(x, y, z);
      nor.push(-hx * inv, inv, -hz * inv);
      const h0 = y + 2;
      bake.push(marchSun(x, z, h0, dirs[0], 4000), marchSun(x, z, h0, dirs[1], 4000), marchSky(x, z, h0), marchSun(x, z, h0, dirs[2], 4000));
      const steep = 1 - inv;
      const own = forestOf(x, z, y, steep, null, 0, 0);
      const wooded = y < lakeLevel + 0.6 ? 0 : smoothstep(0.1, 0.26, noise.fbm(x / 230 + 11, z / 230, 4)) * (1 - smoothstep(0.55, 0.8, steep));
      // (open where the place says its bank is open: own is 0 there by the place's word, not for want of a wood)
      mask.push(own < 0 ? own : arm.open(x, z) > 0.5 || arm.shore(x, z) > -3 ? own : Math.max(own, wooded), stone(x, z, y, steep));
      slot[k] = pos.length / 3 - 1;
      return slot[k];
    };
    for (let j = 0; j < ph - 1; j++) {
      for (let i = 0; i < pw - 1; i++) {
        const k = j * pw + i;
        if (!(fine[k] > 0 || fine[k + 1] > 0 || fine[k + pw] > 0 || fine[k + pw + 1] > 0)) continue;
        if (covered[k] && covered[k + 1] && covered[k + pw] && covered[k + pw + 1]) continue;
        // (inside the grid's rectangle the grid is the ground)
        if (inRect(px0 + (i + 0.5) * c, pz0 + (j + 0.5) * c)) continue;
        const a = at(i, j);
        const b = at(i + 1, j);
        const d = at(i, j + 1);
        const f = at(i + 1, j + 1);
        index.push(a, d, b, b, d, f);
      }
    }
    if (!index.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 4));
    geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    finePatches.push(geometry);
  }
  if (arm) {
    const e = arm.extent;
    const pad = 240;
    finePatch((x, z) => arm.fine(x, z), { x0: e.x0 - pad, x1: e.x1 + pad, z0: e.z0 - pad, z1: e.z1 + pad }, tier === 'low' ? 28 : 14, (x, z, y, steep) => smoothstep(0.6, 0.9, steep) * 0.5, (x, z) => arm.valleyFine(x, z), false);
    // (the range's rock and snow are the ground material's: aMask.y = 5 marks them, plus how much snow the place
    // asks for there: thickest at the crests, reaching lower in the gullies, thin on steep rock)
    const D = ARM.range.dust;
    finePatch((x, z) => arm.valleyFine(x, z), arm.valleyBox, tier === 'low' ? 84 : 42, (x, z, y, steep) => {
      const k = arm.rangeAt(x, z);
      if (!k) return smoothstep(0.6, 0.9, steep) * 0.5;
      return 5 + smoothstep(k.line - D[0], k.line + D[1], k.up + 0.22 * (k.gully - 0.45)) * (1 - 0.75 * smoothstep(0.4, 0.62, steep));
    }, (x, z) => arm.fine(x, z), true);
  }

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
  finePatches.forEach((geometry, k) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = k ? 'terrain-arm-valley' : 'terrain-arm';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
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
    lake: lakeSheet(),
    heightAt,
    heightOnTrack,
    normalAt(x, z, out = normal) {
      const e = 1;
      const hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      return out.set(-hx, 1, -hz).normalize();
    },
    forestAt,
    /**
     * The lakeside (lakeside.js), or null, and the land as it was before it was shaped: the forest plants the lap's
     * own trees from `before`, so that shaping one place moves no tree anywhere else, and then lets the place clear
     * and seat again what stands on it.
     */
    lakeside,
    /** The golden wood (goldwood.js), or null: a stretch of the Track; it moves no ground. */
    goldwood,
    /** The arm of the lake (arm.js), or null: the same holds for it. */
    arm,
    /** The ground as it is drawn (the grid's and the far land's own facets): what stands on coarse ground is seated on this. */
    surfaceAt: (x, z) => coarseHeight(x, z),
    before: { heightAt: (x, z) => heightAt(x, z, true), forestAt: (x, z) => forestAt(x, z, true) },
    bakeAt,
    bake4At,
    /**
     * The day's sun at a point `y` m high over the map (0..1): what a crown standing up out of a shaded slope gets,
     * where bakeAt answers for the ground under it.
     */
    sunAt: (x, z, y) => marchSun(x, z, y, dirs[0], 2600),
    cliffAt: (s, side) => ({ ...cliffAt(s, side) }),
    /** The grid's cell (m): what stands in a portal's opening covers the cells the grid leaves out there. */
    cell,
    /** How far beyond the solid edge the band's ground reaches at least (m): beyond it the grid is the ground. */
    bandReach: BAND_OUT[BAND_OUT.length - 1],
    /** { meadow, wood } 0..1 at a point near a tunnel's approach (approach.js), or null away from any. */
    placeAt(x, z) {
      if (!near(x, z)) return null;
      track.locate(x, z, -1, spot);
      const p = placeOf(spot.s, spot.lat, Math.max(0, Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1)));
      return p ? { ...p } : null;
    },
    stats: { vertices, triangles, gridTriangles, ms: Math.round(performance.now() - started), phases },
    dispose() {
      group.traverse((o) => o.isMesh && o.geometry.dispose());
    },
  };
}

export { withBake };
