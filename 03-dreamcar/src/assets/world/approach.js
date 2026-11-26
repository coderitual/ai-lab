// The approach to a tunnel's entrance, as numbers: an alpine meadow the road
// crosses on its way into the hillside (docs/design.md, "The approach to the
// tunnel": the reference is a photograph, R1). Defined once and read by
// everything that makes the place: the terrain (the low wall's height at the
// solid edge, the slopes beyond it, the ground behind the portal's headwall,
// the hill over the bore, where the meadow is), the tunnel (the headwall's
// outline, the hood), the forest (what is cleared and what is planted), the
// ground cover (the tall grass) and the meadow's furniture (meadow.js).
//
// Nothing here touches the road or its corridor: the solid edges and what lies
// inside them are the Track's. Everything is measured from the entrance's
// face: `a` metres before it along the road (negative: over the bore), `d`
// metres beyond the solid edge, on the `up` side (the hill's) or the other.
//
// Pure numbers and functions: no three.js, no DOM (the unit tests build the
// terrain in Node).

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const APPROACH = {
  /** The place begins this far before the face (m), easing in from the road's own verges over `ease` m more. */
  before: 88,
  ease: 14,
  /**
   * The meadow itself (its green, its tall grass, no trees near the road, the fence) opens this far before the face
   * (m): the day's sun stands low behind whoever drives up, and a wood beside the road there laid its shade over
   * the whole approach.
   */
  open: 190,
  /** The meadow runs on this far over the bore (m), and this far beyond the solid edge on the hill's side and the other. */
  behind: 210,
  wide: { up: 165, down: 48, downBehind: 20 },
  /** The low wall at the solid edge where the edge is a wall (what the cars hit): its top over the edge (m). */
  wall: 0.7,
  /** How steeply the ground stands up behind that wall (m out per m up; the terrain's own cliffs lean 0.3). */
  lean: 0.06,
  /** Where the ground behind the wall begins, beyond the solid edge (m): the terrain's cliff foot and its lean. */
  top: 0.86,
  /**
   * The slopes beyond the wall. The hill's side rises `slope[0]` m per m far from the face and `slope[1]` beside it
   * (towards `reach` m of height times the slope). The other side falls gently away (`away`) far from the face and,
   * within `near` m of it, rises as a low shoulder (`slope`, levelling within `reach` m): the spur the bore enters.
   */
  up: { slope: [0.45, 0.55], reach: 40, near: 40 },
  down: { away: -0.12, slope: 0.45, reach: 14, near: 40 },
  /**
   * The headwall across the face: its top over the road (m). On the hill's side it is level, out to where the meadow
   * in front of it has climbed to it; on the other side it is level for `level` m beyond the solid edge and then falls
   * `fall` m per m with the spur's flank (a wing wall running down into the grass).
   */
  headwall: { top: 10, level: 3.5, fall: 0.36, buried: 0.35, maxUp: 26, maxDown: 20 },
  /**
   * The hood that stands out of the headwall round the mouth: how far (m), how thick, and its arch: upright to
   * `spring` m, then a superellipse (exponent `round`) to `crown` m over the road at the front. At the face it meets
   * the box, whose ceiling is lower: the soffit falls to it.
   */
  hood: { depth: 2.6, thick: 0.8, spring: 3.4, crown: 7.4, round: 2.5 },
  /**
   * The ground over the bore: this much over its crown at the face, rising `rise` m per m into the hill to `high` m
   * (a hillside behind the portal, not a hump), and back down to the ridge's own `ridge` m between `back[0]` and
   * `back[1]` m in. Towards the exit the terrain keeps its own rule.
   */
  cover: { face: 2.5, rise: 0.6, high: 75, ridge: 40, back: [110, 230], exit: 0.35 },
  /** Behind the headwall the ground keeps its height for `bench` m, then may fall this much per metre. */
  bench: 4,
  benchFall: 0.9,
  /** The spruce wood on the side away from the hill: from this far beyond the solid edge to this far (m). */
  wood: { from: 52, to: 120, behind: 230 },
};

const cache = new WeakMap();

/**
 * The approaches of a Track: one per tunnel. `up`: the side the hill rises on (+1 left, -1 right); `edge`: the solid
 * edge at the face on each side; `upEnd`, `downEnd`: how far beyond the solid edge the headwall reaches on each side.
 * @param {object} track
 */
export function approachesOf(track) {
  let list = cache.get(track);
  if (list) return list;
  list = (track.tunnels ?? []).map((t) => {
    const i = Math.round((t.s0 + Math.min(30, (t.s1 - t.s0) / 2)) / track.ds) % track.count;
    const up = track.farSlopeL[i] >= track.farSlopeR[i] ? 1 : -1;
    const A = { s0: t.s0, s1: t.s1, up, edge: { 1: track.edgeAt(t.s0, 1), [-1]: track.edgeAt(t.s0, -1) }, upEnd: 0, downEnd: 0 };
    const H = APPROACH.headwall;
    // the hill's side: the wall ends where the meadow in front of it has climbed to its top
    let d = 2;
    while (d < H.maxUp && frontGround(A, up, d) < H.top - H.buried) d += 0.25;
    A.upEnd = d + 1;
    // the other side: where the wall's falling top meets the shoulder in front of it
    d = H.level;
    while (d < H.maxDown && frontGround(A, -up, d) < H.top - H.fall * (d - H.level) - H.buried) d += 0.25;
    A.downEnd = d + 0.8;
    return A;
  });
  cache.set(track, list);
  return list;
}

/** Metres before an approach's face at track distance s (negative: inside the tunnel). */
export const beforeFace = (track, A, s) => track.delta(s, A.s0);

/**
 * The approach a point of the road belongs to, if any: { A, a, k } with `k` 0..1 how much of the place it is (1 from
 * the face out to APPROACH.before, easing to nothing over APPROACH.ease). The first metres inside the box count (the
 * terrain's last row before a portal is a sample just inside it).
 * @param {object} track @param {number} s
 */
export function approachAt(track, s) {
  for (const A of approachesOf(track)) {
    const a = beforeFace(track, A, s);
    if (a < -6 || a > APPROACH.before + APPROACH.ease) continue;
    return { A, a, k: 1 - smoothstep(APPROACH.before, APPROACH.before + APPROACH.ease, a) };
  }
  return null;
}

/**
 * How far the ground has risen `beyond` metres behind the wall's top (m; negative: fallen).
 * @param {object} A @param {number} side @param {number} a metres before the face @param {number} beyond
 */
export function rise(A, side, a, beyond) {
  const b = Math.max(0, beyond);
  if (side === A.up) {
    const U = APPROACH.up;
    const slope = lerp(U.slope[1], U.slope[0], smoothstep(0, U.near, a));
    return slope * U.reach * (1 - Math.exp(-b / U.reach));
  }
  const D = APPROACH.down;
  const away = D.away * 40 * (1 - Math.exp(-b / 40));
  const shoulder = D.slope * D.reach * (1 - Math.exp(-b / D.reach));
  return lerp(shoulder, away, smoothstep(8, D.near, a));
}

/** The ground just in front of the face, `d` m beyond the solid edge, over the edge's own height (m). */
export function frontGround(A, side, d) {
  return d < APPROACH.top ? 0 : APPROACH.wall + rise(A, side, 0, d - APPROACH.top);
}

/**
 * The headwall's top over the road at `lat` (m left of the centre line), or -Infinity beyond its ends.
 * @param {object} A @param {number} lat
 */
export function headwallTop(A, lat) {
  const side = lat >= 0 ? 1 : -1;
  const d = Math.abs(lat) - A.edge[side];
  const H = APPROACH.headwall;
  if (side === A.up) return d <= A.upEnd ? H.top : -Infinity;
  if (d > A.downEnd) return -Infinity;
  return H.top - H.fall * Math.max(0, d - H.level);
}

/**
 * The least height of the ground behind the face over the road (m), `u` metres into the hill at `lat`: what the
 * headwall holds back, and beyond its ends the ground in front, so that the land is one surface there.
 * @param {object} A @param {number} lat @param {number} u
 */
export function behindFace(A, lat, u) {
  const side = lat >= 0 ? 1 : -1;
  const d = Math.abs(lat) - A.edge[side];
  const held = Math.max(headwallTop(A, lat) - 0.25, frontGround(A, side, d));
  return held - APPROACH.benchFall * Math.max(0, u - APPROACH.bench);
}

/**
 * How much ground stands over the bore's crown `u` m in from the entrance, `v` m before the exit (m).
 * @param {number} u @param {number} v
 */
export function coverOver(u, v) {
  const C = APPROACH.cover;
  const cap = lerp(C.high, C.ridge, smoothstep(C.back[0], C.back[1], u));
  return C.face + Math.min(C.rise * u, C.exit * v, cap);
}

/**
 * 0..1: how much of a point is the meadow. @param {object} A @param {number} side @param {number} a
 * @param {number} d metres beyond the solid edge (0 on the verge)
 */
export function meadowAt(A, side, a, d) {
  const along = smoothstep(APPROACH.open + 25, APPROACH.open - 5, a) * smoothstep(-APPROACH.behind - 60, -APPROACH.behind, a);
  if (along <= 0) return 0;
  const W = APPROACH.wide;
  const wide = side === A.up ? W.up : lerp(W.downBehind, W.down, smoothstep(-22, -4, a));
  return along * (1 - smoothstep(wide * 0.8, wide, d));
}

/** 0..1: the spruce wood beside the meadow, on the side away from the hill. */
export function woodAt(A, side, a, d) {
  if (side === A.up) return 0;
  const W = APPROACH.wood;
  // (over the bore the wood begins further out: the meadow is wider there)
  const from = lerp(APPROACH.wide.downBehind + 4, W.from, smoothstep(-22, -4, a));
  return smoothstep(-W.behind - 30, -W.behind, a) * smoothstep(APPROACH.open + 12, APPROACH.open - 4, a) * smoothstep(from - 3, from + 3, d) * (1 - smoothstep(W.to, W.to + 30, d));
}

/**
 * The hood's arch at the front: the height of its inner face over the road at `lat`, or of its outer face (`outer`).
 * @param {number} lat @param {number} half the inner half width (the box's walls) @param {boolean} [outer]
 */
export function hoodArch(lat, half, outer = false) {
  const H = APPROACH.hood;
  const w = half + (outer ? H.thick : 0);
  const x = Math.min(1, Math.abs(lat) / w);
  return H.spring + (H.crown + (outer ? H.thick : 0) - H.spring) * Math.pow(1 - Math.pow(x, H.round), 1 / H.round);
}
