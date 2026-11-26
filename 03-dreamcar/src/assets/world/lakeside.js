// The lakeside: one place on the lap, described once. Where the road leaves
// the viaduct and climbs along the hillside to the carousel, a tarn lies below
// it on the left, held on a wooded bench above the valley, and on the right
// the rock is a low cut under a bank of meadow, outcrops and birches (the
// reference photograph "r2": docs/design.md, "The lakeside").
//
// Nothing here is geometry and nothing here is inside the corridor: this is
// the shape of the place, in numbers and functions, that the others read.
//   terrain.js      ground(): the bench and the tarn's basin beyond the left
//                   edge; cliff() and far(): the low cut and the gentle bank on
//                   the right; wood(): where the ground is wooded or meadow
//   index.js        the tarn's sheet of water (lake.js), at `level` over `extent`
//   forest.js       clears(): where the lap's own trees give way; the hand-planted
//                   rows and the wood on the far shore
//   groundCover.js  the tall grass and flowers against the rail, the outcrops
//   fence.js        the wire fence on the bank
//
// It is found from the Track (the start of a named section), never from map
// coordinates, and it works in a frame of its own: u metres along the road's
// heading there, v metres to the left of it.

import { openCanopy } from './canopy.js';
import { planeNoise, smoothstep } from './shading.js';

export const LAKESIDE = {
  /** The Track's section whose start (the end of the viaduct) the place is measured from. */
  section: 'carousel',
  /** The dressed stretch: metres from the section's start, and the length over which it eases in and out. */
  from: 6,
  to: 176,
  ease: 24,
  /** Where the frame's origin is (metres from the section's start). */
  origin: 60,
  /** The tarn's surface, metres under the road at the section's start. */
  drop: 6.5,
  /**
   * The tarn on the map of the frame: its middle (u, v), half its length and width, how far its long axis is turned
   * to the left of the road (degrees), and its headlands: [waves round the shore, share of the radius, phase].
   */
  tarn: {
    u: 203,
    v: 153,
    a: 150,
    b: 112,
    turn: 15,
    bays: [
      [3, 0.07, 1.3],
      [5, 0.05, 0.4],
      [8, 0.03, 2.2],
    ],
  },
  /**
   * The bench that holds it: how high its rim stands over the water on the far sides (lo + noise * span, m; `least`
   * on the road's side, so that the water shows from the road and from the viaduct), how far from the shore it
   * is at its full height, where it gives way to the valley (m beyond the shore), and between which distances to
   * the left of the frame's axis it rises from `least` to its height. Towards the valley under the sky road (south
   * of `southU` along the frame) the bench ends sooner, `south` m from the shore, in a steep headwall: the sun
   * stands 16 degrees up beyond the tarn, and a long flank there laid the valley beside the deck in its shade. The
   * headwall lies in its own shade, so its rim is kept at `least` too (south of `farU` along the frame), and no
   * wood stands on it: from the sky road the water shows over it.
   */
  rim: { least: 1.0, lo: 4.5, span: 8, full: 55, out: [45, 300], far: [60, 180], south: 115, southU: [-20, 160], farU: [50, 180] },
  /**
   * The pass beyond the tarn: seen from the stretch the hills round the course stood 9 degrees high across the water
   * and hid the massif (far.js), whose long right-hand ridge lies that way. In a sector of the frame from `eye`
   * (u, v), between `angle` degrees to the left of the road (rising over the first two numbers, falling over the
   * last two) and between `range` metres, no ground stands higher than the eye's height less `under` plus `slope`
   * per metre out: the valley of the tarn runs on between the hills, and the far range closes it. Straight ahead
   * (to the right of `hill.left` degrees) a hill is left standing to close the road's end of the picture: `hill.rise`
   * m more between `hill.range` (rising over the first two, falling over the last two): the hill that stood there
   * was 190 m high and a kilometre off, beyond where trees are drawn, a smooth dark dome. Nearer than `ahead` m the
   * sector begins at `angle[0]` (the carousel lies to its right); beyond, where there is no road, at `aheadFrom`.
   */
  pass: {
    eye: [-2, 5],
    angle: [3, 15, 64, 82],
    range: [300, 650, 4300, 5000],
    under: 4,
    slope: 0.03,
    ahead: [360, 480],
    aheadFrom: -12,
    hill: { left: [6, 22], rise: 44, range: [300, 620, 660, 1000] },
    /** A wooded headland behind the tarn's far shore, left of the middle of the picture: the same, between `angle` degrees. */
    headland: { angle: [3, 9, 21, 31], rise: 40, range: [430, 620, 700, 1000] },
    /**
     * The range that closes the pass: a ridge of peaks across it `at` m out (wandering by `wander`), `half` m from
     * foot to crest, its crest `relief[0]` to `relief[0] + relief[1]` m over the pass's floor (on the far land's
     * 100 m lattice about five degrees above the eye: no higher than the hills that stood there), between `angle` degrees; snow lies in
     * streaks on the upper `snow` of each peak (groundMaterial.js draws it where the forest mask is negative).
     */
    peaks: { at: 3300, wander: 240, half: 430, relief: [170, 340], angle: [10, 22, 60, 76], snow: [0.08, 0.4] },
  },
  /**
   * The bank from the road down to the bench: it begins `guard[0]` m beyond the solid edge and is all bench by
   * `guard[1]`; beside the viaduct by `guard[1] + deck` (eased in over the deck's last `deckEase` m), so that the
   * valley under the deck keeps its floor and its sunlit side.
   */
  guard: [1, 28],
  deck: 100,
  deckEase: 90,
  /**
   * The meadow (groundMaterial.js): on the lake's side of the stretch the grass is the photograph's, long, warm and
   * lit, in the frame's box u, v (m; `soft` m of easing at its ends; it stops at the water) with its own albedo.
   */
  meadow: { u: [-55, 215], v: [3, 75], soft: 18, lit: [0.26, 0.195, 0.045], hollow: [0.05, 0.068, 0.028] },
  /** The right-hand side: the cut's height (lo + noise * span, m) and the bank's rise per metre behind it. */
  cut: { lo: 1.3, span: 1.3 },
  bank: 0.13,
  /** Between these distances beyond the right edge (m) the bank gives way to the hillside the Track's own slope makes. */
  bankEnds: [17, 46],
  /** How far beyond the right edge the lap's own trees give way to the bank's (m), and beyond the left edge to the shore's. */
  clearRight: 46,
  /**
   * What forest.js plants here. `bank`: rows on the right, { off: metres beyond the solid edge, step: metres between
   * trunks, gap: the share of the row that is planted (groups, not a hedge), birch: the share of birches, heights
   * (m) }. `pines`: [metres from the section's start, metres beyond the left edge, species, height range]. `shrubs`:
   * low growth on the lake's bank. `shore`: the wood round the tarn (metres from the water it begins and ends,
   * lattice, share planted; none south of `south` m along the frame).
   */
  planting: {
    /**
     * The stand on the bank is a wall of full crowns, not single trees: trunks `sink` m into the ground (so that the
     * foliage begins two to three metres up), crowns `wide` times their width (they overlap), and the stand's own
     * tone over each tree's green (darker and less yellow than the lap's sunlit woods: the photograph's olive).
     */
    stand: { sink: 3.2, wide: 1.3, tone: [0.44, 0.5, 0.52] },
    /** The spur behind the bank and inside the carousel: a wood on it from `from` m beyond the road's edge, lattice, share planted, heights. */
    spur: { along: [70, 345], from: 15, reach: 85, lattice: 5.2, density: 0.78, height: [9, 15], over: 9, tone: [0.62, 0.7, 0.72] },
    bank: [
      { off: [6.5, 9], step: [4.2, 6.2], gap: 2, birch: 0.35, height: [13, 17], birchHeight: [14, 18], detail: 2.4, inside: 0.1, r: 2.6 },
      { off: [11, 15], step: [4.5, 6.5], gap: 2, birch: 0.25, height: [15, 19], birchHeight: [15, 19], detail: 2, inside: 0.45, r: 2.8 },
      { off: [17, 24], step: [5, 7], gap: 2, birch: 0.2, height: [16, 21], birchHeight: [16, 20], detail: 1.6, inside: 0.6, r: 3 },
    ],
    pines: [
      [91, 6.5, 'birch', [5, 6.5]],
      [93.5, 8.2, 'birch', [3.6, 4.6]],
      [106, 7, 'birch', [4.5, 6]],
    ],
    /** No tree of the bank within `within` m of another stretch's centre line whose top would stand more than `over` m above that road. */
    other: { within: 75, over: 1.5 },
    shrubs: { step: [16, 28], off: [5, 15], height: [3.2, 6.5] },
    shore: { from: 5, reach: 250, lattice: 6.5, density: 0.8, conifer: 0.55, south: -1e9, tone: [0.6, 0.68, 0.72] },
    /**
     * The hill that closes the road's end of the picture, beyond the carousel: it stands above the lap's tree line and
     * was a smooth dark dome. A wood of its own, seen only as cards: in the pass's frame from `angle[0]` to
     * `angle[1]` degrees left of the road and `range` metres out, no nearer than `clear` m to any road's edge.
     */
    hill: { angle: [-28, 40], range: [320, 1000], lattice: 6.5, density: 0.85, conifer: 0.8, clear: 45 },
  },
};


/**
 * @param {object} track the Track
 * @param {import('../../engine/rng.js').Rng} rng
 * @returns {ReturnType<typeof build> | null} null on a Track that has no such section
 */
export function createLakeside(track, rng) {
  const section = track.sections?.find((x) => x.id === LAKESIDE.section);
  if (!section || !track.bridges?.length) return null;
  return build(track, rng, section);
}

function build(track, rng, section) {
  const L = LAKESIDE;
  const noise = planeNoise(rng.int(1 << 30));
  const s0 = section.s0;
  const frame = {};
  track.frameAt(s0 + L.origin, frame);
  const tl = Math.hypot(frame.tan.x, frame.tan.z);
  const tx = frame.tan.x / tl;
  const tz = frame.tan.z / tl;
  const ll = Math.hypot(frame.left.x, frame.left.z);
  const lx = frame.left.x / ll;
  const lz = frame.left.z / ll;
  const ox = frame.pos.x;
  const oz = frame.pos.z;
  const level = track.profile(s0, 0, {}).y - L.drop;
  const turn = (L.tarn.turn * Math.PI) / 180;
  const ca = Math.cos(turn);
  const sa = Math.sin(turn);
  const spot = { index: -1, s: 0, lat: 0 };
  // the Track's wood on the lake's side gives way along the stretch: the canopy's sky and the verge's litter follow
  openCanopy(track, (s, side) => side > 0 && stretch(s) > 0.5);

  /** Metres from the section's start, signed (the lap's shortest way). */
  const along = (s) => track.delta(s0, s);
  /** 0..1 how much of the dressed stretch s is in. */
  const stretch = (s) => {
    const d = along(s);
    return smoothstep(L.from - L.ease, L.from, d) * (1 - smoothstep(L.to, L.to + L.ease, d));
  };

  /** How far inside the tarn's shore a point of the frame is (m; negative: on land, that far from the water). */
  function shoreUV(u, v) {
    const du = u - L.tarn.u;
    const dv = v - L.tarn.v;
    const p = du * ca + dv * sa;
    const q = -du * sa + dv * ca;
    const r = Math.hypot(p, q);
    if (r < 1e-3) return L.tarn.b;
    const c = p / r;
    const s = q / r;
    let R = 1 / Math.hypot(c / L.tarn.a, s / L.tarn.b);
    const th = Math.atan2(q, p);
    let k = 1;
    for (const [n, share, phase] of L.tarn.bays) k += share * Math.sin(n * th + phase);
    R *= k;
    return R - r;
  }
  const toU = (x, z) => (x - ox) * tx + (z - oz) * tz;
  const toV = (x, z) => (x - ox) * lx + (z - oz) * lz;
  const reach = Math.max(L.tarn.a, L.tarn.b) * 1.2 + L.rim.out[1];
  const eyeY = track.profile(s0 + L.origin + L.pass.eye[0], 0, {}).y;
  /**
   * The range across the pass at a bearing and a distance from its eye: metres over the pass's floor, and how
   * far up its peak that is (0 at the foot, 1 on the highest crest).
   */
  const peak = { h: 0, up: 0 };
  function peakAt(a, r) {
    const K = L.pass.peaks;
    peak.h = peak.up = 0;
    const w = smoothstep(K.angle[0], K.angle[1], a) * (1 - smoothstep(K.angle[2], K.angle[3], a));
    if (w <= 0) return peak;
    const across = 1 - Math.abs(r - (K.at + K.wander * Math.sin(a * 0.21 + 1))) / K.half;
    if (across <= 0) return peak;
    // peaks and saddles along the ridge, a spur or two down its face
    const crest = noise.ridged(a / 9 + 4, 1.7, 3);
    const spur = 0.75 + 0.25 * noise.fbm(a / 2.5, r / 260, 2);
    const up = w * across * spur * ((K.relief[0] + K.relief[1] * crest) / (K.relief[0] + K.relief[1]));
    peak.h = up * (K.relief[0] + K.relief[1]);
    peak.up = up;
    return peak;
  }
  /** The ground in the pass: `h`, or the most the pass lets stand there; and the range that closes it. */
  function passed(x, z, h) {
    const P = L.pass;
    const du = toU(x, z) - P.eye[0];
    const dv = toV(x, z) - P.eye[1];
    const r = Math.hypot(du, dv);
    if (r < P.range[0] || r > P.range[3] || (dv <= 0 && r < P.ahead[0])) return h;
    const a = (Math.atan2(dv, du) * 180) / Math.PI;
    const k = peakAt(a, r);
    if (k.h > 0) return Math.max(passedFloor(P, a, r, h), eyeY - P.under + P.slope * r + k.h);
    return passedFloor(P, a, r, h);
  }
  function passedFloor(P, a, r, h) {
    const hill = (1 - smoothstep(P.hill.left[0], P.hill.left[1], a)) * smoothstep(P.hill.range[0], P.hill.range[1], r) * (1 - smoothstep(P.hill.range[2], P.hill.range[3], r));
    const H = P.headland;
    const head = smoothstep(H.angle[0], H.angle[1], a) * (1 - smoothstep(H.angle[2], H.angle[3], a)) * smoothstep(H.range[0], H.range[1], r) * (1 - smoothstep(H.range[2], H.range[3], r));
    const cap = eyeY - P.under + P.slope * r + P.hill.rise * hill + H.rise * head;
    // (the headland is raised, not only left standing: the land there was the valley's floor)
    if (head > 0 && h < cap) h += (cap - h) * head;
    if (h <= cap) return h;
    const from = P.angle[0] + (P.aheadFrom - P.angle[0]) * smoothstep(P.ahead[0], P.ahead[1], r);
    const w = smoothstep(from, from + P.angle[1] - P.angle[0], a) * (1 - smoothstep(P.angle[2], P.angle[3], a)) * smoothstep(P.range[0], P.range[1], r) * (1 - smoothstep(P.range[2], P.range[3], r));
    return h - (h - cap) * w;
  }
  /** False well away from the place (a cheap test before any other question). */
  const near = (x, z) => {
    const u = toU(x, z) - L.tarn.u;
    const v = toV(x, z) - L.tarn.v;
    return u * u + v * v < reach * reach;
  };
  const shore = (x, z) => shoreUV(toU(x, z), toV(x, z));

  /** The bench and the basin at a point: the height the place asks for there. */
  function basin(x, z, q) {
    if (q > 0) return level - Math.min(5, 0.3 + 0.22 * q);
    const m = -q;
    const far = smoothstep(L.rim.far[0], L.rim.far[1], toV(x, z)) * smoothstep(L.rim.farU[0], L.rim.farU[1], toU(x, z));
    const rim = L.rim.least + far * (L.rim.lo + L.rim.span * noise.fbm(x / 120 + 3, z / 120, 3));
    const knolls = (0.9 + 0.9 * far) * (noise.fbm(x / 17, z / 17 + 5, 2) - 0.5) * smoothstep(6, 20, m);
    return level + 0.11 * Math.min(m, 7) + rim * smoothstep(5, L.rim.full, m) + knolls;
  }

  /**
   * How much the place has the say at a point, 0..1: all of it on the tarn and its bench, none beyond `out`; none
   * inside any corridor, on the right of the road or on another stretch.
   * @param {number} x @param {number} z @param {number} q shore()
   * @param {number|null} s @param {number} lat the nearest point of the road, if the caller knows it
   */
  function say(x, z, q, s, lat) {
    // (a straight ramp down from the bench, short towards the valley under the sky road)
    const end = L.rim.south + (L.rim.out[1] - L.rim.south) * smoothstep(L.rim.southU[0], L.rim.southU[1], toU(x, z));
    const wz = 1 - Math.min(1, Math.max(0, (-q - L.rim.out[0]) / (end - L.rim.out[0])));
    if (wz <= 0) return 0;
    if (s === null) {
      track.locate(x, z, spot.index, spot);
      s = spot.s;
      lat = spot.lat;
    }
    if (lat <= 0) return 0;
    const d = along(s);
    // only the left of the viaduct's end, the climb and the first half of the carousel (the tarn reaches no further)
    const mine = smoothstep(-560, -470, d) * (1 - smoothstep(250, 310, d));
    if (mine <= 0) return 0;
    const beyond = lat - track.edgeAt(s, 1);
    return wz * mine * smoothstep(L.guard[0], L.guard[1] + L.deck * smoothstep(10, -L.deckEase, d), beyond);
  }

  return {
    level,
    s0,
    section,
    along,
    stretch,
    /** True where the Track's own wood beside the road gives way to the place (the lake's side of the stretch). */
    open: (s, side) => side > 0 && stretch(s) > 0.5,
    near,
    shore,
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
      const w = say(x, z, q, s, lat);
      return passed(x, z, w > 0 ? h + (basin(x, z, q) - h) * w : h);
    },

    /** The right-hand cut's height at s (m), given the cliff the Track's rock edge would have. */
    cliff(s, side, height) {
      if (side > 0) return height;
      const w = stretch(s);
      if (w <= 0) return height;
      const low = Math.min(height, L.cut.lo + L.cut.span * noise.fbm(s / 21, 4.2, 2));
      return height + (low - height) * w;
    },

    /** The hillside's rise per metre just beyond the right edge at s, given the Track's. */
    far(s, side, far) {
      if (side > 0) return far;
      const w = stretch(s);
      return w > 0 ? far + (L.bank - far) * w : far;
    },

    /** 0..1 how much of the Track's own hillside stands `d` m beyond the right edge at s (0: the place's bank). */
    bankEnds(s, side, d) {
      if (side > 0 || d <= L.bankEnds[0] || stretch(s) <= 0) return 0;
      return smoothstep(L.bankEnds[0], L.bankEnds[1], d);
    },

    /**
     * Wooded or meadow: the forest mask (0..1) the place asks for, given the land's own. Water and the bank between
     * the road and the shore are open; the bench round the tarn is wooded; the right-hand bank is meadow.
     */
    wood(x, z, f, s = null, lat = 0) {
      if (!near(x, z) || shore(x, z) < -L.planting.shore.reach) {
        // the hill ahead and the headland behind the far shore: wooded all over (their trees are cards a long way off)
        const pdu = toU(x, z) - L.pass.eye[0];
        const pdv = toV(x, z) - L.pass.eye[1];
        const pr = Math.hypot(pdu, pdv);
        const H = L.planting.hill;
        if (pr > H.range[0] && pr < H.range[1] + 80) {
          const pa = (Math.atan2(pdv, pdu) * 180) / Math.PI;
          const w = smoothstep(H.angle[0], H.angle[0] + 8, pa) * (1 - smoothstep(H.angle[1] - 6, H.angle[1] + 4, pa)) * smoothstep(H.range[0], H.range[0] + 80, pr) * (1 - smoothstep(H.range[1], H.range[1] + 80, pr));
          if (w > 0 && f >= 0) f = Math.max(f, 0.92 * w);
        }
      }
      if (!near(x, z)) {
        // the range across the pass: bare above its feet, snow in streaks high up (a negative mask: that much snow)
        const du = toU(x, z) - L.pass.eye[0];
        const dv = toV(x, z) - L.pass.eye[1];
        const r = Math.hypot(du, dv);
        if (Math.abs(r - L.pass.peaks.at) > L.pass.peaks.half + L.pass.peaks.wander || dv <= 0) return f;
        const k = peakAt((Math.atan2(dv, du) * 180) / Math.PI, r);
        if (k.up <= 0.12) return f;
        const snow = smoothstep(L.pass.peaks.snow[0], L.pass.peaks.snow[1], k.up);
        return snow > 0.02 ? -snow : f * (1 - smoothstep(0.12, 0.3, k.up));
      }
      if (s === null) {
        track.locate(x, z, spot.index, spot);
        s = spot.s;
        lat = spot.lat;
      }
      if (lat < 0) {
        const d = -lat - track.edgeAt(s, -1);
        const w = stretch(s) * (1 - smoothstep(L.clearRight - 14, L.clearRight, d));
        // meadow up to the fence, the wood's own floor under the stand behind it
        const under = 0.75 * smoothstep(4.5, 7.5, d);
        return f + (under - f) * w;
      }
      const q = shore(x, z);
      const w = say(x, z, q, s, lat);
      if (w <= 0) return f;
      const m = -q;
      // the bank between the road and the water, along the stretch: open
      const open = stretch(s) * (1 - smoothstep(60, 90, lat - track.edgeAt(s, 1)));
      const want = q > -3 ? 0 : 0.9 * smoothstep(4, 16, m) * (1 - open);
      return f + (want - f) * w;
    },

    /**
     * True where one of the lap's own trees gives way to the place: in the water and on its beach, on the bank
     * between the road and the shore, and on the right-hand bank.
     */
    clears(x, z) {
      if (!near(x, z)) return false;
      const q = shore(x, z);
      if (q > -3) return true;
      track.locate(x, z, -1, spot);
      const d = along(spot.s);
      if (d < L.from - L.ease + 6 || d > L.to + L.ease + 10) return false;
      const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1);
      if (spot.lat < 0) return beyond < L.clearRight;
      return -q < 140 && beyond < 110;
    },

    /** A point of the map in the pass's frame: [degrees to the left of the road from its eye, metres from it]. */
    bearing(x, z) {
      const du = toU(x, z) - L.pass.eye[0];
      const dv = toV(x, z) - L.pass.eye[1];
      return [(Math.atan2(dv, du) * 180) / Math.PI, Math.hypot(du, dv)];
    },

    /**
     * 0..1 how much a point is the spur's: the hillside to the right of the stretch behind its bank, and the knob
     * inside the carousel (scenery beyond the edges: clothed in the bank's stone and wood).
     */
    spur(x, z, s = null, lat = 0) {
      if (!near(x, z)) return 0;
      if (s === null) {
        track.locate(x, z, -1, spot);
        s = spot.s;
        lat = spot.lat;
      }
      if (lat >= 0) return 0;
      const S = L.planting.spur;
      const d = along(s);
      const beyond = -lat - track.edgeAt(s, -1);
      return smoothstep(S.along[0] - 40, S.along[0], d) * (1 - smoothstep(S.along[1], S.along[1] + 30, d)) * smoothstep(S.from - 4, S.from, beyond) * (1 - smoothstep(S.reach, S.reach + 15, beyond));
    },

    /** What the ground's material needs to paint the place: the frame, the meadow's box in it, the pass's eye. */
    get paint() {
      const [ex, ez] = [ox + tx * L.pass.eye[0] + lx * L.pass.eye[1], oz + tz * L.pass.eye[0] + lz * L.pass.eye[1]];
      return { ox, oz, tx, tz, lx, lz, meadow: L.meadow, eye: [ex, ez], level };
    },

    /**
     * 0..1 how much of what the tarn mirrors at a point is its wooded far shore (lake.js `mirrors`): a band along
     * the banks away from the road, widest on the far side.
     */
    mirrors(x, z) {
      const q = shore(x, z);
      const far = smoothstep(70, 150, toV(x, z));
      return far * (1 - smoothstep(18, 70, q));
    },

    /** True where the bench and the tarn have any say over the ground (the lake's side, beyond the edges). */
    has(x, z) {
      return near(x, z) && say(x, z, shore(x, z), null, 0) > 0.02;
    },

    /** True where the place changed the ground under something that stood there before (it is seated again). */
    moved(x, z) {
      if (near(x, z)) return true;
      const du = toU(x, z) - L.pass.eye[0];
      const dv = toV(x, z) - L.pass.eye[1];
      return du > -L.pass.range[3] * 0.2 && Math.hypot(du, dv) < L.pass.range[3];
    },

    /** Where the tarn's sheet of water is laid (world x and z), with room for its ripples to reach the shore. */
    get extent() {
      let x0 = 1e9;
      let x1 = -1e9;
      let z0 = 1e9;
      let z1 = -1e9;
      for (let k = 0; k < 64; k++) {
        const th = (k / 64) * Math.PI * 2;
        const p = Math.cos(th) * L.tarn.a * 1.2;
        const q = Math.sin(th) * L.tarn.b * 1.2;
        const u = L.tarn.u + p * ca - q * sa;
        const v = L.tarn.v + p * sa + q * ca;
        const x = ox + tx * u + lx * v;
        const z = oz + tz * u + lz * v;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      return { x0, x1, z0, z1 };
    },
  };
}
