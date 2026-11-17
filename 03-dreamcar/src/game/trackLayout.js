// The course, as numbers: one closed mountain road, described the way a road
// engineer would describe it.
//
//   plan      a chain of straights and arcs. Each piece has a constant
//             curvature; where two pieces meet the curvature eases from one
//             to the other over `ease` metres centred on the joint, so the
//             centre line has no kink in direction, curvature or steering rate.
//   height    the gradient (per cent) at the end of each piece, joined by
//             straight lines: every change of gradient is a long vertical curve.
//   corridor  what stands on each side of each piece (a preset from SIDES).
//
// The line starts at the start/finish line (s = 0) and is laid out in the
// order it is driven. `track.js` turns this into samples, frames and the
// corridor; nothing here is geometry yet. Pure data: no imports.
//
// Changing the plan opens the loop. `node tools/trackmap.mjs --fit a,b` solves
// the lengths of two straights (ids a and b) so that it closes again and prints
// the numbers to paste back here; the turned angles must already add up to one
// full turn to the right (-360 degrees).

/** Paved half width: two lanes and two narrow paved margins, 8.5 m in all. */
export const HALF_WIDTH = 4.25;

/** The strip of loose gravel beyond the pavement, before the verge. */
export const SHOULDER = 0.6;

/** The tunnel's bore: ceiling above the road surface, and the walls beyond the pavement's edge. */
export const TUNNEL = { height: 5.6, wallOffset: 0.9 };

/** The viaduct: parapets beyond the pavement's edge, and how far the ravine floor lies under the middle of the deck. */
export const VIADUCT = { parapetOffset: 0.7, drop: 32 };

/**
 * What stands at the side of the road. `edge`: the range of distances from the
 * pavement's edge to the solid thing (it wanders slowly inside the range);
 * `slope`: rise per metre of the verge on the way there; `far`: rise per metre
 * of the hillside beyond it (where another stretch of the road is close, the
 * builder works the real slope out from the two roads instead);
 * `verge`: what the verge is made of.
 */
export const SIDES = {
  // the lakeside straight: wide mown verges, the water behind a low rail, a meadow up to the wood
  shore: { kind: 'rail', edge: [8, 12], slope: -0.03, far: -0.14, verge: 'grass' },
  meadow: { kind: 'trees', edge: [8, 12], slope: 0.02, far: 0.2, verge: 'grass' },
  // spruce forest: trunks a few metres back on a grass verge
  woodUp: { kind: 'trees', edge: [4, 7], slope: 0.07, far: 0.4, verge: 'grass' },
  woodDown: { kind: 'trees', edge: [4, 7], slope: -0.05, far: -0.3, verge: 'grass' },
  // a hillside traverse: cut rock close in on the hill side, a steel rail and the drop on the valley side
  rock: { kind: 'rock', edge: [1.5, 3], slope: 0.2, far: 1.5, verge: 'gravel' },
  rail: { kind: 'rail', edge: [1.2, 2], slope: -0.04, far: -0.8, verge: 'grass' },
  // the summit: open ground falling gently away on both sides
  open: { kind: 'rail', edge: [2.6, 4], slope: -0.03, far: -0.28, verge: 'grass' },
  // structures: paved right up to the wall
  wallUp: { kind: 'wall', edge: [TUNNEL.wallOffset, TUNNEL.wallOffset], slope: 0, far: 0.7, verge: 'asphalt' },
  wallDown: { kind: 'wall', edge: [TUNNEL.wallOffset, TUNNEL.wallOffset], slope: 0, far: -0.45, verge: 'asphalt' },
  parapet: { kind: 'parapet', edge: [VIADUCT.parapetOffset, VIADUCT.parapetOffset], slope: 0, far: -2.5, verge: 'asphalt' },
};

/** The named stretches, in driving order. */
const SECTION_NAMES = {
  straight: 'Lakeside straight',
  sweeper: 'The sweeper',
  esses: 'The esses',
  tunnel: 'The tunnel',
  viaduct: 'The viaduct',
  hairpins: 'The hairpins',
  summit: 'The summit',
  descent: 'The descent',
  hook: 'The hook',
};

/**
 * @typedef {object} Segment
 * @property {string} id
 * @property {keyof typeof SECTION_NAMES} sec the named stretch it belongs to
 * @property {number} [len] length (m) of a straight
 * @property {number} [r] radius (m) of an arc: positive bends LEFT, negative RIGHT
 * @property {number} [deg] degrees the arc turns through
 * @property {number} [ease] metres over which the curvature eases in from the piece before (centred on the joint)
 * @property {number} g gradient (per cent) at the end of the piece
 * @property {Array<[number, number]>} [gk] more gradient knots inside the piece: [fraction along it, per cent]
 * @property {keyof typeof SIDES} L what stands on the left
 * @property {keyof typeof SIDES} R what stands on the right
 * @property {boolean} [tunnel] @property {boolean} [bridge]
 */

/** @type {Segment[]} */
const SEGMENTS = [
  // Lakeside straight (the line is a third of the way along it: the last piece of the lap is its run-up).
  { id: 'grid', sec: 'straight', len: 235, g: 0, L: 'shore', R: 'meadow' },

  // The sweeper: fast, right, off the shore and into the trees, starting to climb.
  { id: 'sweeper', sec: 'sweeper', r: -170, deg: 65, ease: 90, g: 3.8, L: 'woodDown', R: 'woodUp' },

  // The esses: four bends up through the forest at 6 per cent.
  { id: 'ess1', sec: 'esses', r: 90, deg: 45, ease: 60, g: 5.8, L: 'woodDown', R: 'woodUp' },
  { id: 'ess2', sec: 'esses', r: -80, deg: 95, ease: 50, g: 6.0, L: 'woodDown', R: 'woodUp' },
  { id: 'ess3', sec: 'esses', r: 95, deg: 85, ease: 50, g: 6.0, L: 'woodDown', R: 'woodUp' },
  { id: 'ess4', sec: 'esses', r: -75, deg: 54.2, ease: 50, g: 5.8, L: 'woodDown', R: 'woodUp' },

  // The tunnel: a rock cutting funnels the road into a bore through the spur.
  { id: 'cutting', sec: 'tunnel', len: 55, ease: 40, g: 2.8, L: 'rock', R: 'rock' },
  { id: 'tunnel', sec: 'tunnel', r: -430, deg: 33.3, ease: 50, g: 2.9, L: 'wallDown', R: 'wallUp', tunnel: true },

  // The viaduct: out onto a ledge, then across the ravine.
  { id: 'ledge', sec: 'viaduct', len: 70, ease: 50, g: 3.0, L: 'rail', R: 'rock' },
  { id: 'viaduct', sec: 'viaduct', len: 150, g: 2.8, L: 'parapet', R: 'parapet', bridge: true },

  // The hairpins: right, left, right, each leg stacked above the last. The arcs are in two halves because the
  // hill changes sides half way round: what was the rock face on the way in is the drop on the way out.
  { id: 'ramp', sec: 'hairpins', len: 125, g: 8.6, L: 'rail', R: 'rock' },
  { id: 'hp1a', sec: 'hairpins', r: -20, deg: 90, ease: 24, g: 5.9, L: 'rail', R: 'rock' },
  { id: 'hp1b', sec: 'hairpins', r: -20, deg: 90, ease: 0, g: 6.1, L: 'rock', R: 'rail' },
  { id: 'leg1', sec: 'hairpins', len: 85, ease: 24, g: 7.0, gk: [[0.5, 9.2]], L: 'rock', R: 'rail' },
  { id: 'hp2a', sec: 'hairpins', r: 22, deg: 90, ease: 24, g: 5.9, L: 'rock', R: 'rail' },
  { id: 'hp2b', sec: 'hairpins', r: 22, deg: 90, ease: 0, g: 6.1, L: 'rail', R: 'rock' },
  { id: 'leg2', sec: 'hairpins', len: 85, ease: 24, g: 7.0, gk: [[0.5, 9.2]], L: 'rail', R: 'rock' },
  { id: 'hp3a', sec: 'hairpins', r: -19, deg: 90, ease: 24, g: 5.9, L: 'rail', R: 'rock' },
  { id: 'hp3b', sec: 'hairpins', r: -19, deg: 90, ease: 0, g: 6.1, L: 'rock', R: 'rail' },
  { id: 'exit', sec: 'hairpins', len: 70, ease: 24, g: 7.0, gk: [[0.5, 9.0]], L: 'rock', R: 'rail' },

  // The summit: a long left over the crest, in the open.
  { id: 'crest', sec: 'summit', r: 130, deg: 105, ease: 50, g: -6.5, gk: [[0.42, 0]], L: 'open', R: 'open' },

  // The descent: sweepers down the east face, rock on the right, the valley on the left.
  { id: 'fall1', sec: 'descent', len: 50, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'sweep1', sec: 'descent', r: -170, deg: 85, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'fall2', sec: 'descent', len: 132.7382, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'sweep2', sec: 'descent', r: 120, deg: 90, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'fall3', sec: 'descent', len: 73.3016, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'sweep3', sec: 'descent', r: -90, deg: 77.5, ease: 50, g: -7.85, L: 'rail', R: 'rock' },
  { id: 'fall4', sec: 'descent', len: 100, ease: 50, g: -7.35, L: 'rail', R: 'rock' },

  // The hook: a right-hander that keeps tightening, then the chute back to the shore.
  { id: 'hook1', sec: 'hook', r: -90, deg: 30, ease: 40, g: -7, L: 'rail', R: 'rock' },
  { id: 'hook2', sec: 'hook', r: -55, deg: 30, ease: 24, g: -6.5, L: 'rail', R: 'rock' },
  { id: 'hook3', sec: 'hook', r: -35, deg: 35, ease: 18, g: -6, L: 'rail', R: 'rock' },
  { id: 'chute', sec: 'hook', len: 80, ease: 24, g: 0, gk: [[0.5, -3]], L: 'rail', R: 'woodUp' },

  { id: 'finish', sec: 'straight', len: 105, g: 0, L: 'shore', R: 'meadow' },
];

/** Length of one piece of the plan (m). @param {Segment} seg */
export function segmentLength(seg) {
  return seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
}

export const LAYOUT = {
  halfWidth: HALF_WIDTH,
  shoulder: SHOULDER,
  /** Where the start/finish line is and which way it faces (degrees about +Y, 0 = +Z, positive turns left). */
  start: { x: 0, y: 0, z: 0, yaw: 90 },
  segments: SEGMENTS,
  sides: SIDES,
  /** Banking into the bends: full `bank` (degrees) for a bend much tighter than `bankRadius`. */
  bank: 5,
  bankRadius: 55,
  /**
   * Sector lines: [piece id, fraction along it]. The third line is the start/finish line. The first is the joint
   * where the viaduct's deck begins, not the tunnel's mouth 70 m before it: by day the picture is still opening up
   * there, and a gap flashed on the screen in that second would not be read.
   */
  sectors: [
    ['viaduct', 0],
    ['crest', 0.42],
  ],
  /** Street lamps stand along these pieces; tunnel lamps hang in rows along every tunnel. */
  streetLamps: { pieces: ['finish', 'grid'], spacing: 35, height: 8 },
  tunnelLamps: { spacing: 12, drop: 0.55, inset: 0.45 },
  /** The lake's surface (the straight runs along its shore at y = 0). */
  lakeLevel: -1.8,
};

/**
 * The named stretches of a list of pieces, in driving order.
 * @param {Segment[]} segments
 * @returns {Array<{ id: string, name: string, s0: number, s1: number }>}
 */
export function sectionsOf(segments) {
  /** @type {Array<{ id: string, name: string, s0: number, s1: number }>} */
  const sections = [];
  let s = 0;
  for (const seg of segments) {
    const end = s + segmentLength(seg);
    const last = sections[sections.length - 1];
    if (last && last.id === seg.sec) last.s1 = end;
    else sections.push({ id: seg.sec, name: SECTION_NAMES[seg.sec], s0: s, s1: end });
    s = end;
  }
  // The lap ends on the stretch it began on: the straight is one section that runs through the line.
  const first = sections[0];
  const tail = sections[sections.length - 1];
  if (sections.length > 1 && tail.id === first.id) {
    first.s0 = tail.s0;
    sections.pop();
  }
  return sections;
}

/**
 * The named stretches of the lap, in driving order: `s0` and `s1` are distances from the start/finish line (m).
 * The first one, the straight, runs through the line, so its `s0` is greater than its `s1`.
 */
export const SECTIONS = sectionsOf(SEGMENTS);
