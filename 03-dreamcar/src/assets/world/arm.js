// The arm of the lake: one place on the lap, described once. Where the road
// comes down off the gully bridge towards the long right, the lake reaches a
// long arm up the valley below it on the left: the bridge looks down the road
// to water, with wooded shores and the ranges beyond it (the reference is a
// photograph, "r4": docs/design.md, "The arm of the lake").
//
// Nothing here is geometry and nothing here is inside the corridor: this is
// the shape of the place, in numbers and functions, that the others read.
//   terrain.js      ground(): the arm's basin and its banks, beyond the left
//                   edge only, and the valley beyond with its spurs and its
//                   range; wood(): where its shores and spurs are wooded;
//                   fine(), valleyFine(): where it draws fine ground
//   groundMaterial.js  paint: the bank's grass, per pixel from the frame
//   index.js        the arm's sheet of water (lake.js), at the lake's own level
//   forest.js       clears(): where the lap's own trees give way; the young
//                   growth on the bank and the wood on the far shore
//   groundCover.js  the long grass on the verge and down the bank
//   fence.js        the wire fence along the top of the bank
//
// Round the water the place only ever LOWERS ground, and only on the left of
// the road (the outside of the lap), from `guard` metres beyond the solid
// edge. In the valley beyond it, a kilometre and more from the bridge, where
// there is no road, it lowers the land (`pass`) and stands spurs and a far
// range on it (`spurs`, `range`). It is found from the Track (the start of a
// named section), never from map coordinates, and works in a frame of its
// own: u metres along the road's heading there, v metres to the left of it.
//
// Pure numbers and functions: no three.js, no DOM (the unit tests build the
// terrain in Node).

import { openCanopy } from './canopy.js';
import { planeNoise, smoothstep } from './shading.js';

export const ARM = {
  /** The Track's section whose start (the end of the gully bridge) the place is measured from. */
  section: 'sweepback',
  /**
   * The water on the map of the frame, as lobes that run into one another: [u, v, half its length along u, half
   * its width along v] (m). The first is the arm's head, below the bridge's end; the second lies along the road
   * below the long right; the third turns towards the lake beside the straight and joins it. `bays`: headlands
   * and coves round the shore: [waves along it (per km), metres in and out, phase].
   */
  lobes: [
    [166, 153, 95, 68],
    [381, 163, 260, 78],
    [731, 8, 190, 265],
  ],
  bays: [
    [9, 8, 1.3],
    [23, 4, 0.4],
  ],
  /**
   * The banks: the beach rises `beach` m per m for its first `shelf` m; beyond it no ground stands higher than a
   * bank that rises `bank` m per m on the far shores, where the hills stand, and `tongue` m per m on the land
   * between the water and the road (the frame's box `tongueBox`: u from, to; v up to; eased over `soft` m), which
   * the road looks across, with knolls of `knoll` m. Where the land is lower already it is left alone. The bed
   * falls `bed` m per m from the shore to `deep` m.
   */
  beach: 0.11,
  shelf: 7,
  bank: 0.36,
  tongue: 0.1,
  tongueBox: [90, 690, 150],
  soft: 50,
  knoll: 3,
  bed: 0.2,
  deep: 6,
  /**
   * How near the road the place has any say: none within `guard[0]` m beyond the left solid edge, all of it from
   * `guard[1]`; and only beside the stretch from `along[0]` to `along[1]` m from the section's start (the gully
   * bridge, the long right and the start of the straight), eased over `ease` m.
   */
  guard: [1.5, 52],
  along: [-330, 830],
  ease: 60,
  /**
   * And how far from the water: all of it within `far[0]` m of the shore, none beyond `far[1]` (the hills behind
   * the far shores keep their tops, and the pale hall of frame D3 its hilltop: landmarks.js).
   */
  far: [140, 240],
  /**
   * The valley beyond the arm: seen from the bridge the land south of the water rose in one unbroken ramp to the
   * far land's rim, 5 degrees high, and hid the ranges beyond it (far.js). In a sector of the frame from `eye`
   * (u, v), between `angle` degrees to the left of the road (rising over the first two numbers, falling over the
   * last two) and between `range` metres, the land keeps only `keep` of what it stands over `base` m: the same
   * ridges and gullies, lower, one behind the other, and the far ranges stand over them, each paler in the haze.
   */
  pass: { eye: [-150, 0], angle: [-20, -10, 40, 54], range: [900, 1400, 4500, 5300], keep: 0.22, base: 14 },
  /**
   * What stands in that valley, in the pass's frame (degrees left of the road from its eye, metres from it): the
   * photograph's spurs, falling into the valley from both sides by turns, each behind the one before. A spur is
   * [root angle, root distance, tip angle, tip distance, its crest's height at the root (m), half its width at the
   * root (m)]: the crest falls from root to tip, unevenly, and the flanks fall away from it. Behind them a range
   * of bare peaks closes the valley `range.at` m out (wandering by `wander`), `half` m from foot to crest, its
   * crest `relief[0]` to `relief[0] + relief[1]` m high, between `angle` degrees: one massif (`summit`: the
   * bearing of its highest point and how wide it stands; `second`: a lesser summit's bearing, width and share;
   * `low`: the shoulders' share far from both) with a jagged skyline; gullies branch down its face (`gully`:
   * about how many degrees of bearing from one to the next, the share of the height they cut). Its snow is a dusting
   * that follows its own shape (`snow`: the share of a peak's height where it begins, and by how much that line
   * wanders along the range; `dust`: it thins out over this much below the line and thickens over this much
   * above it): it reaches lower in the gullies, lies thin on steep rock, thickest at the crests. The spurs are
   * wooded darkly (a forest mask over 1).
   */
  spurs: [
    [46.6, 1240, 7.9, 1090, 175, 360],
    [-14, 2100, 2, 1350, 250, 400],
    [45, 2350, 5, 2450, 330, 470],
    [-16, 3250, 9, 2950, 380, 520],
  ],
  range: { at: 4050, wander: 170, half: 560, relief: [150, 560], angle: [-26, -12, 46, 60], summit: [13, 8], second: [-6, 5, 0.6], low: 0.3, gully: [3.1, 0.24], snow: [0.46, 0.18], dust: [0.24, 0.36] },
  /**
   * The open bank: beside the road from `open[0]` to `open[1]` m from the section's start, on the left, the lap's
   * woods give way as far as the water (and no further than `reach` m beyond the edge): grass, a fence, young
   * growth, so that the water shows from the road. `meadow`: how much of the approach meadow's paint its grass takes.
   */
  open: [-20, 380],
  openEase: 30,
  reach: 330,
  /**
   * The bank's grass (groundMaterial.js): long, uneven, darker and greyer than the lap's mown verges, lighter on
   * its rises (`lit`) and darker in its hollows (`hollow`), linear albedo; painted over the frame's box `box`
   * (u from, to; v up to) on the water's side of the road, from `clear` m beyond the centre line.
   */
  paint: { lit: [0.105, 0.1, 0.036], hollow: [0.032, 0.046, 0.022], box: [-40, 620, 125], clear: [9, 22] },
  /**
   * Fine ground: within `fine[0]` m of the shore the terrain draws the arm's own heights on a fine grid (the place
   * lies on the far land's 100 m lattice, where a shore is straight in pieces), easing onto the lattice by `fine[1]`.
   */
  fine: [110, 200],
  /**
   * What forest.js plants. `shore`: the wood on the far shores (from this many metres back from the water, this
   * far up the hill, lattice, share planted, share of conifers, its tone over the trees' greens; every tree of it,
   * and every tree of the lap's that stands there, `sink` of its height under the ground and `wide` times as wide,
   * skirted to the grass, and the lap's between `size` times their height: no two alike). `groups`: young
   * growth on the open bank: [metres from the section's start, metres beyond the left edge, how many, spread (m)],
   * birch and lime saplings sunk to their crowns, never taller than `young` m.
   */
  planting: {
    shore: { from: 5, reach: 260, lattice: 6.2, density: 0.85, conifer: 0.6, tone: [0.14, 0.21, 0.2], sink: 0.2, wide: 1.35, size: [0.6, 1.15] },
    /** The young growth's tone and how wide each stands (irregular: no two alike). */
    youngTone: [0.15, 0.2, 0.17],
    /**
     * The massif's foot on the right of the road, from `along[0]` to `along[1]` m from the section's start: the dark
     * wood carried up the slope behind the lap's own rows, from `beyond[0]` to `beyond[1]` m beyond the right edge,
     * no higher than `top` m over the lake.
     */
    foot: { along: [-200, 330], beyond: [34, 230], lattice: 6.4, density: 0.8, top: 175, tone: [0.4, 0.5, 0.58] },
    /**
     * The lap's own wood on the right of the road beside the place (`along` m from the section's start, to `reach`
     * m beyond the right edge): its broadleaves' tone (an olive gold: darker, less green), and its conifers `sink`
     * of their height deeper and `wide` times as wide, toned `dark`.
     */
    right: { along: [-380, 420], reach: 260, tone: [0.5, 0.39, 0.42], sink: 0.24, wide: 1.5, dark: [0.5, 0.58, 0.62] },
    groups: [
      [18, 13, 4, 5],
      [62, 24, 5, 6],
      [118, 16, 4, 5],
      [150, 46, 6, 8],
      [204, 30, 5, 7],
      [262, 58, 6, 9],
      [230, 110, 7, 10],
      [300, 150, 7, 10],
      [90, 62, 5, 7],
    ],
    young: [2.6, 5.2],
  },
  /** The fence along the top of the bank: metres from the section's start, and metres beyond the left solid edge. */
  fence: { from: -2, to: 168, beyond: 3.2 },
  /** The long grass (the approach meadow's cards): cards per metre of road as a share of the meadow's, their tint. */
  grass: { share: 1.4, tint: [1.15, 1.0, 0.7] },
  /** The lap's low bushes on the open bank: a tint over their green (olive, in the bank's own tone; they were lit lime). */
  bush: [2.1, 1.7, 1.1],
};

/**
 * @param {object} track the Track
 * @param {import('../../engine/rng.js').Rng} rng
 * @returns {ReturnType<typeof build> | null} null on a Track that has no such section
 */
export function createArm(track, rng) {
  const section = track.sections?.find((x) => x.id === ARM.section);
  if (!section || !track.bridges?.length) return null;
  return build(track, rng, section);
}

function build(track, rng, section) {
  const A = ARM;
  const noise = planeNoise(rng.int(1 << 30));
  const s0 = section.s0;
  const frame = {};
  track.frameAt(s0, frame);
  const tl = Math.hypot(frame.tan.x, frame.tan.z);
  const tx = frame.tan.x / tl;
  const tz = frame.tan.z / tl;
  const ll = Math.hypot(frame.left.x, frame.left.z);
  const lx = frame.left.x / ll;
  const lz = frame.left.z / ll;
  const ox = frame.pos.x;
  const oz = frame.pos.z;
  const level = track.layout?.lakeLevel ?? -1.8;
  const spot = { index: -1, s: 0, lat: 0 };
  const toU = (x, z) => (x - ox) * tx + (z - oz) * tz;
  const toV = (x, z) => (x - ox) * lx + (z - oz) * lz;
  /** Metres from the section's start, signed (the lap's shortest way). */
  const along = (s) => track.delta(s0, s);
  /** 0..1 how much of the open bank's stretch s is in. */
  const stretch = (s) => {
    const d = along(s);
    return smoothstep(A.open[0] - A.openEase, A.open[0], d) * (1 - smoothstep(A.open[1], A.open[1] + A.openEase, d));
  };
  // the Track's wood on the water's side gives way along the stretch: the canopy's sky follows
  openCanopy(track, (s, side) => side > 0 && stretch(s) > 0.5);

  // the place's box in its frame (a cheap test before any other question)
  let u0 = 1e9;
  let u1 = -1e9;
  let v0 = 1e9;
  let v1 = -1e9;
  for (const [u, v, a, b] of A.lobes) {
    u0 = Math.min(u0, u - a);
    u1 = Math.max(u1, u + a);
    v0 = Math.min(v0, v - b);
    v1 = Math.max(v1, v + b);
  }
  const PAD = 260;
  const near = (x, z) => {
    const u = toU(x, z);
    if (u < u0 - PAD || u > u1 + PAD) return false;
    const v = toV(x, z);
    return v > v0 - PAD && v < v1 + PAD;
  };

  /** How far inside the shore a point of the frame is (m; negative: on land, about that far from the water). */
  function shoreUV(u, v) {
    let q = -1e9;
    for (const [cu, cv, a, b] of A.lobes) {
      const du = (u - cu) / a;
      const dv = (v - cv) / b;
      const r = Math.hypot(du, dv);
      // (metres, measured along the ray from the lobe's middle: exact on its axes, near enough between)
      const reach = r < 1e-6 ? Math.min(a, b) : Math.hypot(u - cu, v - cv) / r;
      q = Math.max(q, (1 - r) * reach);
    }
    let k = 0;
    for (const [n, m, phase] of A.bays) k += m * Math.sin((n * (u + 0.6 * v)) / 159.2 + phase) * Math.cos((n * (v - 0.4 * u)) / 211 + 2 * phase);
    return q + k;
  }
  const shore = (x, z) => shoreUV(toU(x, z), toV(x, z));

  /** The most the ground may stand at a point: the bed under the water, the beach and the bank beyond the shore. */
  function most(x, z, q) {
    if (q > 0) return level - Math.min(A.deep, 0.3 + A.bed * q);
    const m = -q;
    const u = toU(x, z);
    const T = A.tongueBox;
    const tongue = smoothstep(T[0] - A.soft, T[0], u) * (1 - smoothstep(T[1], T[1] + A.soft, u)) * (1 - smoothstep(T[2] - A.soft, T[2], toV(x, z)));
    const steep = A.bank + (A.tongue - A.bank) * tongue;
    const knolls = A.knoll * (noise.fbm(x / 23, z / 23 + 5, 2) - 0.5) * smoothstep(8, 30, m);
    return level + A.beach * Math.min(m, A.shelf) + steep * Math.max(0, m - A.shelf) + knolls;
  }

  /**
   * How much the place has the say at a point, 0..1: none inside any corridor or on the right of the road, none
   * within `guard[0]` m of the left solid edge, none beside any other part of the lap.
   */
  function say(x, z, s, lat) {
    if (s === null) {
      track.locate(x, z, spot.index, spot);
      s = spot.s;
      lat = spot.lat;
    }
    if (lat <= 0) return 0;
    const d = along(s);
    const mine = smoothstep(A.along[0] - A.ease, A.along[0], d) * (1 - smoothstep(A.along[1], A.along[1] + A.ease, d));
    if (mine <= 0) return 0;
    return mine * smoothstep(A.guard[0], A.guard[1], lat - track.edgeAt(s, 1));
  }

  /** A point of the map as the bridge sees it: [degrees to the left of the road from the pass's eye, metres from it]. */
  function bearing(x, z) {
    const du = toU(x, z) - A.pass.eye[0];
    const dv = toV(x, z) - A.pass.eye[1];
    return [(Math.atan2(dv, du) * 180) / Math.PI, Math.hypot(du, dv)];
  }
  // the spurs as segments of the pass's frame (metres along and to the left of the road from its eye)
  const DEG = Math.PI / 180;
  const spurs = A.spurs.map(([a0, r0, a1, r1, high, half], k) => {
    const ax = Math.cos(a0 * DEG) * r0;
    const ay = Math.sin(a0 * DEG) * r0;
    const bx = Math.cos(a1 * DEG) * r1;
    const by = Math.sin(a1 * DEG) * r1;
    return { ax, ay, dx: bx - ax, dy: by - ay, len2: (bx - ax) ** 2 + (by - ay) ** 2, high, half, k };
  });
  /** The spurs at a point of the pass's frame: metres over the valley's floor, and the share of the nearest crest's height. */
  const spur = { h: 0, up: 0 };
  function spurAt(du, dv) {
    spur.h = spur.up = 0;
    for (const S of spurs) {
      const t = Math.min(1, Math.max(0, ((du - S.ax) * S.dx + (dv - S.ay) * S.dy) / S.len2));
      const d = Math.hypot(du - S.ax - S.dx * t, dv - S.ay - S.dy * t);
      const wide = S.half * (0.5 + 0.5 * (1 - t));
      if (d >= wide) continue;
      // the crest: falling from root to tip, with knobs and saddles along it
      const crest = S.high * (0.06 + 0.94 * (1 - t) ** 0.85) * (0.78 + 0.4 * noise.ridged(t * 5 + S.k * 7.3, 2.1 + S.k, 3));
      // the flanks: gullied, steeper near the crest
      const across = 1 - d / wide;
      const gully = 0.82 + 0.3 * noise.fbm(du / 130 + S.k * 3.1, dv / 130, 2);
      const h = crest * across ** 1.2 * gully;
      if (h > spur.h) {
        spur.h = h;
        spur.up = across;
      }
    }
    return spur;
  }
  /** The range that closes the valley at a bearing and a distance: metres over the floor, and how far up its peak that is. */
  const peak = { h: 0, up: 0, gully: 0 };
  function peakAt(a, r) {
    const K = A.range;
    peak.h = peak.up = peak.gully = 0;
    const w = smoothstep(K.angle[0], K.angle[1], a) * (1 - smoothstep(K.angle[2], K.angle[3], a));
    if (w <= 0) return peak;
    const across = 1 - Math.abs(r - (K.at + K.wander * Math.sin(a * 0.19 + 2))) / K.half;
    if (across <= 0) return peak;
    // One massif, not a row of peaks: a dominant summit off the middle of the view (`summit`: its bearing, how
    // wide it stands, in degrees) with lower shoulders stepping away on either side, and a second, lesser one.
    const main = Math.exp(-(((a - K.summit[0]) / K.summit[1]) ** 2));
    const second = Math.exp(-(((a - K.second[0]) / K.second[1]) ** 2));
    const massif = K.low + (1 - K.low) * Math.max(main, K.second[2] * second);
    // its skyline: sharp peaks of uneven spacing and width (a ridge noise read at a bearing that is itself
    // pushed about, raised to a power: narrow points, wide saddles), small teeth on them
    const aw = a + 3.2 * (noise.fbm(a / 6.1 + 3, 1.9, 2) - 0.5) + 1.1 * (noise.fbm(a / 1.7 + 8, 4.4, 2) - 0.5);
    const crest = (0.62 * noise.ridged(aw / 5.2 + 9, 3.3, 4) ** 1.7 + 0.26 * noise.ridged(aw / 1.9 + 4, 7.7, 3) ** 1.4 + 0.12 * noise.ridged(aw / 0.7 + 2, 1.2, 2)) * massif;
    // its face: a long apron under a steep upper wall and a sharp crest line (no flat top), buttresses standing
    // out of it, and gullies that begin under the crest and branch on the way down: a ridge noise of the bearing
    // whose bearing is bent by the height, so that two gullies run together lower down and none is parallel to
    // the next
    const butt = 0.82 + 0.36 * noise.fbm(a / 4.3 + 2, r / 420 + 1, 2);
    const face = across ** 1.35 * butt;
    const ab = aw + (1 - across) * 2.6 * (noise.fbm(a / 2.9 + 5, 6.2, 2) - 0.5);
    const gully = Math.max(noise.ridged(ab / K.gully[0] + 1.7, 5.1 + across * 0.8, 3) ** 1.5, 0.7 * noise.ridged(ab / (K.gully[0] * 0.37) + 6.3, 2.2 + across * 1.7, 2) ** 2);
    const shape = w * face * ((K.relief[0] + K.relief[1] * crest) / (K.relief[0] + K.relief[1]));
    const up = shape * (1 - K.gully[1] * gully * smoothstep(0.03, 0.22, shape) * (1 - 0.45 * across));
    peak.h = up * (K.relief[0] + K.relief[1]);
    peak.up = up;
    peak.gully = gully;
    return peak;
  }
  /** False nearer than the valley's first ground (a cheap test), or behind the bridge. */
  const inValley = (du, r) => du > A.pass.range[0] * 0.5 && r >= A.pass.range[0] && r <= A.pass.range[3];
  /**
   * The ground in the valley beyond the arm: what the pass leaves of `h`, and the spurs and the range standing
   * on that (never in the arm's water or on its beach).
   */
  function passed(x, z, h) {
    const P = A.pass;
    const du = toU(x, z) - P.eye[0];
    if (du < P.range[0] * 0.5) return h;
    const dv = toV(x, z) - P.eye[1];
    const r = Math.hypot(du, dv);
    if (r < P.range[0] || r > P.range[3]) return h;
    const a = (Math.atan2(dv, du) * 180) / Math.PI;
    const far = smoothstep(P.range[0], P.range[1], r) * (1 - smoothstep(P.range[2], P.range[3], r));
    const w = smoothstep(P.angle[0], P.angle[1], a) * (1 - smoothstep(P.angle[2], P.angle[3], a)) * far;
    let floor = h > P.base && w > 0 ? h - (h - P.base) * (1 - P.keep) * w : h;
    if (floor < level + 0.5) return floor;
    // (what stands on the floor: only where the lake's own water is not, and easing in from the valley's mouth)
    const dry = smoothstep(level + 0.5, level + 6, floor) * smoothstep(P.range[0], P.range[0] + 160, r);
    if (dry <= 0) return floor;
    const q = near(x, z) ? shore(x, z) : -1e3;
    const land = smoothstep(2, 40, -q);
    if (land <= 0) return floor;
    const up = Math.max(spurAt(du, dv).h, peakAt(a, r).h) * dry * land;
    // (a spur stands on the floor; where the land was higher already it is the land)
    return up > 0 ? Math.max(floor, P.base + up) : floor;
  }

  /** 0..1 how much a point is the open bank between the road and the water (beside the stretch, on the left). */
  function open(x, z, s = null, lat = 0) {
    if (!near(x, z)) return 0;
    if (s === null) {
      track.locate(x, z, -1, spot);
      s = spot.s;
      lat = spot.lat;
    }
    if (lat <= 0) return 0;
    const w = stretch(s);
    if (w <= 0) return 0;
    const beyond = lat - track.edgeAt(s, 1);
    // (and only on the road's side of the water: the shore across the arm is the far shore, wooded)
    return w * (1 - smoothstep(A.reach - 40, A.reach, beyond)) * (1 - smoothstep(A.tongueBox[2] - 30, A.tongueBox[2], toV(x, z)));
  }

  return {
    level,
    s0,
    section,
    along,
    stretch,
    /** True where the Track's own wood beside the road gives way to the place (the water's side of the stretch). */
    opens: (s, side) => side > 0 && stretch(s) > 0.5,
    near,
    shore,
    open,
    frame: { ox, oz, tx, tz, lx, lz, toU, toV },
    /** World coordinates of a point of the frame. */
    at: (u, v) => [ox + tx * u + lx * v, oz + tz * u + lz * v],

    /**
     * The ground with the place in it. @param {number} x @param {number} z @param {number} h the ground without
     * @param {number|null} [s] @param {number} [lat] the nearest point of the road, where known
     */
    ground(x, z, h, s = null, lat = 0) {
      if (!near(x, z)) return passed(x, z, h);
      const q = shore(x, z);
      if (q < -A.far[1]) return passed(x, z, h);
      const cap = most(x, z, q);
      if (cap >= h + 3) return passed(x, z, h);
      const w = say(x, z, s, lat) * (1 - smoothstep(A.far[0], A.far[1], -q));
      if (w <= 0) return passed(x, z, h);
      // (the lower of the two, rounded where they meet)
      const d = h - cap;
      const low = d > 3 ? cap : d < -3 ? h : Math.min(h, cap) - ((3 - Math.abs(d)) * (3 - Math.abs(d))) / 12;
      return passed(x, z, h + (low - h) * w);
    },

    /** A point of the map in the pass's frame: [degrees to the left of the road from its eye, metres from it]. */
    bearing,

    /**
     * Wooded or open: the forest mask (0..1) the place asks for, given the land's own. The water, its beach and
     * the bank down from the road are open; the other shores are wooded.
     */
    wood(x, z, f, s = null, lat = 0) {
      {
        // the valley beyond: its spurs wooded darkly (over 1: groundMaterial.js), its range bare, with snow high up
        const du = toU(x, z) - A.pass.eye[0];
        const dv = toV(x, z) - A.pass.eye[1];
        const r = Math.hypot(du, dv);
        if (inValley(du, r) && f >= 0) {
          const k = peakAt((Math.atan2(dv, du) * 180) / Math.PI, r);
          // (bare: its rock and its snow are the ground material's, from `rangeAt`)
          if (k.up > 0.06 && k.h >= spurAt(du, dv).h) return f * (1 - smoothstep(0.06, 0.2, k.up));
          // (and the valley's floor between them is the same dark wood, thinner: no bright meadow in the distance)
          const P = A.pass;
          const pa = (Math.atan2(dv, du) * 180) / Math.PI;
          const floor = smoothstep(P.angle[0], P.angle[1], pa) * (1 - smoothstep(P.angle[2], P.angle[3], pa)) * smoothstep(P.range[0], P.range[0] + 200, r) * (1 - smoothstep(P.range[2], P.range[3], r));
          const on = Math.max(smoothstep(0.03, 0.2, spurAt(du, dv).up) * smoothstep(P.range[0], P.range[0] + 160, r), 0.75 * floor);
          if (on > 0 && (!near(x, z) || shore(x, z) < -8)) f = Math.max(f, 0.9 * on) + 0.8 * on;
        }
      }
      if (!near(x, z)) return f;
      const q = shore(x, z);
      const o = open(x, z, s, lat);
      // (the bed off the far shores carries the wood's mask too: no one sees it under the water, and the ground
      // between a vertex in the water and one on the bank is then wooded to the waterline, not bare outcrop)
      if (q > -3) return 1.5 * (1 - o);
      const P = A.planting.shore;
      // (the wood on the far shores is the dark wood too, from the waterline: whatever the land's own mask is)
      const far = 1 - smoothstep(P.reach, P.reach + 120, -q);
      return Math.max(f, 1.5 * far) * (1 - o);
    },

    /** 0..1 how much of the ground at a point is the arm's own fine ground (terrain.js draws it there). */
    fine(x, z) {
      if (!near(x, z)) return 0;
      return 1 - smoothstep(A.fine[0], A.fine[1], -shore(x, z));
    },

    /**
     * 0..1 how much of the ground at a point is the valley's own fine ground: its spurs and its range, which the
     * far land's 100 m facets drew as flat planes with straight creases.
     */
    valleyFine(x, z) {
      const du = toU(x, z) - A.pass.eye[0];
      const dv = toV(x, z) - A.pass.eye[1];
      const r = Math.hypot(du, dv);
      if (!inValley(du, r)) return 0;
      const a = (Math.atan2(dv, du) * 180) / Math.PI;
      const K = A.range;
      const band = (1 - smoothstep(K.half * 0.98, K.half * 1.2, Math.abs(r - (K.at + K.wander * Math.sin(a * 0.19 + 2))))) * smoothstep(K.angle[0] - 4, K.angle[0], a) * (1 - smoothstep(K.angle[3], K.angle[3] + 4, a));
      let on = band;
      for (const S of spurs) {
        const t = Math.min(1, Math.max(0, ((du - S.ax) * S.dx + (dv - S.ay) * S.dy) / S.len2));
        const d = Math.hypot(du - S.ax - S.dx * t, dv - S.ay - S.dy * t);
        on = Math.max(on, 1 - smoothstep(S.half * 0.95, S.half * 1.25, d));
      }
      return on * smoothstep(A.pass.range[0], A.pass.range[0] + 120, r);
    },

    /**
     * The range at a point: null off it, or how far up its peak the point is (0 at the foot, 1 on the highest
     * crest), how deep in a gully of its face (0..1), and the height share where its snow begins there (it
     * wanders along the range).
     */
    rangeAt(x, z) {
      const du = toU(x, z) - A.pass.eye[0];
      const dv = toV(x, z) - A.pass.eye[1];
      const r = Math.hypot(du, dv);
      if (!inValley(du, r)) return null;
      const a = (Math.atan2(dv, du) * 180) / Math.PI;
      const k = peakAt(a, r);
      if (k.up <= 0.02 || k.h < spurAt(du, dv).h) return null;
      return { up: k.up, gully: k.gully, line: A.range.snow[0] + A.range.snow[1] * (noise.fbm(a / 11 + 3, 0.7, 2) - 0.5) };
    },

    /** Where the valley's fine ground lies (world x and z). */
    get valleyBox() {
      let x0 = 1e9;
      let x1 = -1e9;
      let z0 = 1e9;
      let z1 = -1e9;
      const K = A.range;
      const add = (a, r) => {
        const u = A.pass.eye[0] + Math.cos(a * DEG) * r;
        const v = A.pass.eye[1] + Math.sin(a * DEG) * r;
        const x = ox + tx * u + lx * v;
        const z = oz + tz * u + lz * v;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      };
      for (let a = K.angle[0] - 5; a <= K.angle[3] + 5; a += 2) for (const r of [K.at - K.wander - K.half * 1.3, K.at + K.wander + K.half * 1.3]) add(a, r);
      for (const [a0, r0, a1, r1, , half] of A.spurs) for (const [a, r] of [[a0, r0], [a1, r1]]) for (const da of [-1, 1]) for (const dr of [-1, 1]) add(a + da * ((half * 1.3) / r / DEG), r + dr * half * 1.3);
      return { x0, x1, z0, z1 };
    },

    /** What the ground's material needs to paint the bank: the frame, the bank's box in it, where the long right's arc lies. */
    get paint() {
      // the long right as an arc of the frame: it begins where the Track's curvature does, round a centre to the right
      let begin = 0;
      let radius = 300;
      for (let d = 0; d < 400; d += 5) {
        const k = Math.abs(track.curvature[Math.round(track.wrap(s0 + d) / track.ds) % track.count]);
        if (k > 1e-3 && !begin) begin = d;
        if (k > 1e-4) radius = Math.min(radius, 1 / k);
      }
      // (the curvature eases in over the joint: the arc of that radius begins about where the easing is half done)
      for (let d = begin; d < 400; d += 5) {
        if (Math.abs(track.curvature[Math.round(track.wrap(s0 + d) / track.ds) % track.count]) > 0.5 / radius) {
          begin = d;
          break;
        }
      }
      const [ex, ez] = [ox + tx * A.pass.eye[0] + lx * A.pass.eye[1], oz + tz * A.pass.eye[0] + lz * A.pass.eye[1]];
      return { ox, oz, tx, tz, level, begin, radius, eye: [ex, ez], ...A.paint };
    },

    /** True where one of the lap's own trees gives way to the place: in the water and on its beach, and on the open bank. */
    clears(x, z) {
      if (!near(x, z)) return false;
      if (shore(x, z) > -4) return true;
      return open(x, z) > 0.4;
    },

    /** True where the place may have changed the ground under something that stood there before (it is seated again). */
    moved: near,

    /** Where the arm's sheet of water is laid (world x and z), with room for its ripples to reach the shore. */
    get extent() {
      let x0 = 1e9;
      let x1 = -1e9;
      let z0 = 1e9;
      let z1 = -1e9;
      for (const [u, v, a, b] of A.lobes) {
        for (const [du, dv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const uu = u + du * (a + 40);
          const vv = v + dv * (b + 40);
          const x = ox + tx * uu + lx * vv;
          const z = oz + tz * uu + lz * vv;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      }
      return { x0, x1, z0, z1 };
    },
  };
}
