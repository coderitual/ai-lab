// The arm of the lake: one place on the lap, described once. Where the road
// comes down off the gully bridge towards the long right, the lake reaches a
// long arm up the valley below it on the left: the bridge looks down the road
// to water, with wooded shores and the ranges beyond it (the reference is a
// photograph, "r4": docs/design.md, "The arm of the lake").
//
// Nothing here is geometry and nothing here is inside the corridor: this is
// the shape of the place, in numbers and functions, that the others read.
//   terrain.js      ground(): the arm's basin and its banks, beyond the left
//                   edge only; wood() and meadow(): where its shores are wooded
//                   and where the bank down from the road is open grass
//   index.js        the arm's sheet of water (lake.js), at the lake's own level
//   forest.js       clears(): where the lap's own trees give way; the young
//                   growth on the bank and the wood on the far shore
//   groundCover.js  the long grass on the verge and down the bank
//   fence.js        the wire fence along the top of the bank
//
// The place only ever LOWERS ground (no ground is higher with it than without):
// round the water only on the left of the road (the outside of the lap), from
// `guard` metres beyond the solid edge; and in the valley beyond it, a
// kilometre and more from the bridge, where there is no road (`pass`). It is found from the Track (the start of a
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
  pass: { eye: [-150, 0], angle: [-16, -6, 36, 48], range: [900, 1500, 4500, 5300], keep: 0.42, base: 18 },
  /**
   * The open bank: beside the road from `open[0]` to `open[1]` m from the section's start, on the left, the lap's
   * woods give way as far as the water (and no further than `reach` m beyond the edge): grass, a fence, young
   * growth, so that the water shows from the road. `meadow`: how much of the approach meadow's paint its grass takes.
   */
  open: [-20, 380],
  openEase: 30,
  reach: 330,
  meadow: 0.5,
  /**
   * What forest.js plants. `shore`: the wood on the far shores (from this many metres back from the water, this
   * far up the hill, lattice, share planted, share of conifers, its tone over the trees' greens). `groups`: young
   * growth on the open bank: [metres from the section's start, metres beyond the left edge, how many, spread (m)],
   * birch and lime saplings sunk to their crowns, never taller than `young` m.
   */
  planting: {
    shore: { from: 5, reach: 260, lattice: 6.2, density: 0.85, conifer: 0.5, tone: [0.6, 0.68, 0.72] },
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
  /** The ground in the valley beyond the arm: `h`, or what the pass leaves of it. */
  function passed(x, z, h) {
    const P = A.pass;
    if (h <= P.base) return h;
    const du = toU(x, z) - P.eye[0];
    if (du < P.range[0] * 0.5) return h;
    const dv = toV(x, z) - P.eye[1];
    const r = Math.hypot(du, dv);
    if (r < P.range[0] || r > P.range[3]) return h;
    const a = (Math.atan2(dv, du) * 180) / Math.PI;
    const w = smoothstep(P.angle[0], P.angle[1], a) * (1 - smoothstep(P.angle[2], P.angle[3], a)) * smoothstep(P.range[0], P.range[1], r) * (1 - smoothstep(P.range[2], P.range[3], r));
    return w > 0 ? h - (h - P.base) * (1 - P.keep) * w : h;
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
    return w * (1 - smoothstep(A.reach - 40, A.reach, beyond));
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
      if (!near(x, z)) return f;
      const q = shore(x, z);
      if (q > -3) return 0;
      const o = open(x, z, s, lat);
      const P = A.planting.shore;
      const far = 0.92 * smoothstep(4, 16, -q) * (1 - smoothstep(P.reach, P.reach + 120, -q));
      return Math.max(f, far) * (1 - o);
    },

    /** 0..1 how much of the approach meadow's paint the ground takes at a point (the open bank's grass). */
    meadow(x, z, s = null, lat = 0) {
      if (!near(x, z)) return 0;
      const q = shore(x, z);
      if (q > 0) return 0;
      return A.meadow * open(x, z, s, lat) * smoothstep(0, 4, -q);
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
