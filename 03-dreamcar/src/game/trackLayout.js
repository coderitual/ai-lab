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

/** Paved half width: three lanes, 12 m in all. */
export const HALF_WIDTH = 6;

/**
 * The strip beyond the pavement's edge, in the pavement's own banked plane, before the verge: a kerb where
 * `kerbs` puts one, a paved margin elsewhere.
 */
export const SHOULDER = 1.2;

/**
 * Kerbs: flush with the pavement at its edge, rising `rise` (m) to their outer side, with a saw-tooth along the
 * road of `pitch` (m) that takes `tooth` of the rise away between its teeth; they ramp up over `ramp` m at each end.
 */
export const KERB = { rise: 0.04, tooth: 0.25, pitch: 0.9, ramp: 4 };

/** The tunnel's bore: ceiling above the road surface, and the walls beyond the pavement's edge. */
export const TUNNEL = { height: 6.4, wallOffset: 1.5 };

/** Bridges: parapets beyond the pavement's edge, and the depth of the ground under a deck that does not name its own `drop`. */
export const VIADUCT = { parapetOffset: 1.5, drop: 32 };

/**
 * What stands at the side of the road. `edge`: the range of distances from the pavement's edge to the barrier (it
 * wanders slowly inside the range); `slope`: rise per metre of the verge on the way there; `far`: rise per metre
 * of the hillside beyond it (where another stretch of the road is close, the builder works the real slope out
 * from the two roads instead); `verge`: what the verge is made of; `wood`: what grows beyond the barrier
 * ('broadleaf', 'conifer', 'mixed' or null).
 */
export const SIDES = {
  // the lakeside straight: a low concrete wall each side; the water beyond the left one, the town beyond the right
  shore: { kind: 'wall', edge: [4, 5], slope: -0.02, far: -0.12, verge: 'grass', wood: null },
  town: { kind: 'wall', edge: [5, 6], slope: 0.01, far: 0.08, verge: 'grass', wood: 'broadleaf' },
  // the land side of the straight away from the pit lane: bright mown grass to a steel rail, nothing tall (frame D1)
  paddock: { kind: 'rail', edge: [6, 8], slope: 0.01, far: 0.08, verge: 'grass', wood: null },
  // beyond the pit exit: mown grass to a steel rail and, close behind it, the maples that wall the start (the
  // run-up to the line stays open paddock so that the massif and the sun stand clear over the straight)
  grove: { kind: 'rail', edge: [5, 6], slope: 0.01, far: 0.08, verge: 'grass', wood: 'broadleaf' },
  // mown grass to a steel rail, woods behind it: low down broadleaf, higher up conifers
  lowUp: { kind: 'rail', edge: [3, 5], slope: 0.04, far: 0.3, verge: 'grass', wood: 'broadleaf' },
  lowDown: { kind: 'rail', edge: [3, 5], slope: -0.03, far: -0.25, verge: 'grass', wood: 'broadleaf' },
  lowRun: { kind: 'rail', edge: [8, 10], slope: -0.02, far: -0.2, verge: 'grass', wood: 'broadleaf' },
  midUp: { kind: 'rail', edge: [3, 5], slope: 0.05, far: 0.4, verge: 'grass', wood: 'mixed' },
  midDown: { kind: 'rail', edge: [3, 5], slope: -0.03, far: -0.3, verge: 'grass', wood: 'mixed' },
  midRun: { kind: 'rail', edge: [7, 10], slope: -0.02, far: -0.25, verge: 'grass', wood: 'mixed' },
  highUp: { kind: 'rail', edge: [3, 5], slope: 0.05, far: 0.45, verge: 'grass', wood: 'conifer' },
  highDown: { kind: 'rail', edge: [3, 5], slope: -0.03, far: -0.35, verge: 'grass', wood: 'conifer' },
  highRun: { kind: 'rail', edge: [7, 10], slope: -0.02, far: -0.3, verge: 'grass', wood: 'conifer' },
  // the open top: run-off and a rail, the ground falling away, nothing growing that would hide the view
  open: { kind: 'rail', edge: [6, 9], slope: -0.02, far: -0.3, verge: 'grass', wood: null },
  // the ledge's first bend: a low wall with boards on both sides; on the inside the ground falls away to the valley
  // and the view is open, on the outside a wooded bank rises close behind the wall (broadleaves, back-lit by day)
  balcony: { kind: 'wall', edge: [3, 4], slope: -0.03, far: -0.35, verge: 'grass', wood: null },
  bank: { kind: 'wall', edge: [3.5, 5], slope: 0.07, far: 0.45, verge: 'grass', wood: 'broadleaf' },
  // the road cut into the hill: a narrow verge, then the rock face
  rock: { kind: 'rock', edge: [3, 4], slope: 0.12, far: 1.5, verge: 'grass', wood: null },
  // structures: paved right up to the wall or the parapet
  wallUp: { kind: 'wall', edge: [TUNNEL.wallOffset, TUNNEL.wallOffset], slope: 0, far: 0.7, verge: 'asphalt', wood: null },
  wallDown: { kind: 'wall', edge: [TUNNEL.wallOffset, TUNNEL.wallOffset], slope: 0, far: -0.45, verge: 'asphalt', wood: null },
  parapet: { kind: 'parapet', edge: [VIADUCT.parapetOffset, VIADUCT.parapetOffset], slope: 0, far: -2.5, verge: 'asphalt', wood: null },
};

/** The named stretches, in driving order. */
const SECTION_NAMES = {
  straight: 'Lakeside straight',
  sweep: 'Shore bend',
  esses: 'Forest esses',
  tunnel: 'The tunnel',
  viaduct: 'The sky road',
  carousel: 'The carousel',
  crest: 'The crest',
  plunge: 'The plunge',
  ledge: 'The ledge',
  gully: 'Gully bridge',
  sweepback: 'The long right',
};

/**
 * @typedef {object} Segment
 * @property {string} id
 * @property {keyof typeof SECTION_NAMES} sec the named stretch it belongs to
 * @property {number} [len] length (m) of a straight
 * @property {number} [r] radius (m) of an arc: positive bends LEFT, negative RIGHT
 * @property {number} [deg] degrees the arc turns through
 * @property {number} [ease] metres over which the curvature (and the banking) eases in from the piece before
 *   (centred on the joint)
 * @property {number} [bank] degrees of banking into the bend, instead of the rule's (LAYOUT.bank, bankRadius)
 * @property {number} g gradient (per cent) at the end of the piece
 * @property {Array<[number, number]>} [gk] more gradient knots inside the piece: [fraction along it, per cent]
 * @property {keyof typeof SIDES} L what stands on the left
 * @property {keyof typeof SIDES} R what stands on the right
 * @property {boolean} [tunnel]
 * @property {boolean} [bridge] on piers; `drop`: how far the ground lies under the middle of the deck (m)
 * @property {number} [drop]
 * @property {'L' | 'R'} [runoff] the side whose verge is the run-off of a fast bend (tyre wall, boards)
 */

/** @type {Segment[]} */
const SEGMENTS = [
  // Lakeside straight: the line, then 250 m to the first bend (its other 450 m are the last piece of the lap).
  // (the land side is the pit wall only along the pit lane, about 110 m before the line to 40 m after it)
  { id: 'grid', sec: 'straight', len: 40, g: 0, L: 'shore', R: 'town' },
  { id: 'gridRun', sec: 'straight', len: 210, g: 0, L: 'shore', R: 'grove' },

  // Shore bend: a fast banked right away from the water, starting to climb.
  { id: 'sweep', sec: 'sweep', r: -220, deg: 80, ease: 110, bank: 9, g: 3, L: 'lowRun', R: 'lowUp', runoff: 'L' },
  { id: 'rise', sec: 'sweep', len: 100, ease: 80, g: 5, L: 'lowDown', R: 'lowUp' },

  // Forest esses: long bends climbing through the wood, the last one turning the road along the hillside.
  { id: 'ess1', sec: 'esses', r: -260, deg: 55, ease: 100, bank: 8, g: 5.5, L: 'midRun', R: 'midUp', runoff: 'L' },
  { id: 'ess2', sec: 'esses', r: 330, deg: 40, ease: 120, bank: 7, g: 5, L: 'highUp', R: 'highRun', runoff: 'R' },
  { id: 'ess3', sec: 'esses', r: -240, deg: 65, ease: 120, bank: 9, g: 4, L: 'highRun', R: 'highUp', runoff: 'L' },

  // The tunnel: a rock cutting, then the bore through the spur, bending gently right.
  { id: 'cutting', sec: 'tunnel', len: 70, ease: 70, g: 3.5, L: 'rock', R: 'rock' },
  { id: 'tunnel', sec: 'tunnel', r: -1000, deg: 20, ease: 60, g: 3, L: 'wallDown', R: 'wallUp', tunnel: true },
  { id: 'mouth', sec: 'tunnel', len: 177.7441, ease: 50, g: 3.5, L: 'rock', R: 'rock' },

  // The sky road: out of the mountain onto piers, a long banked left across the valley.
  { id: 'viaduct', sec: 'viaduct', r: 300, deg: 110, ease: 80, bank: 10, g: 3, L: 'parapet', R: 'parapet', bridge: true, drop: 42 },

  // The carousel: a climb along the far side, then a right round the spur, the slow corner of the lap.
  { id: 'climb', sec: 'carousel', len: 150, ease: 90, g: 6, L: 'highDown', R: 'rock' },
  { id: 'carousel', sec: 'carousel', r: -55, deg: 190, ease: 45, bank: 8, g: 5, L: 'highRun', R: 'rock', runoff: 'L' },

  // The crest: up over the top in the open, the lake far below.
  { id: 'crest', sec: 'crest', len: 200, ease: 45, g: 0, gk: [[0.78, 3]], L: 'open', R: 'open' },

  // The plunge: 8 per cent down into a compression.
  { id: 'plunge', sec: 'plunge', r: -400, deg: 40, ease: 100, bank: 5, g: -1, gk: [[0.13, -8], [0.72, -8]], L: 'highDown', R: 'highUp' },

  // The ledge: fast downhill sweepers along the hillside. The first, a left, has the valley open on its inside over
  // a low wall and a wooded bank on its outside; the second, a right, runs under rock with a rail and the drop outside.
  { id: 'ledge1', sec: 'ledge', r: 300, deg: 50, ease: 110, bank: 10, g: -7.5, gk: [[0.3, -7.5]], L: 'balcony', R: 'bank', runoff: 'R' },
  { id: 'ledge2', sec: 'ledge', r: -350, deg: 20, ease: 120, bank: 6, g: -7.5, L: 'midRun', R: 'rock', runoff: 'L' },

  // Gully bridge: straight across a gully on piers.
  { id: 'gully', sec: 'gully', len: 337.0834, ease: 100, g: -8, L: 'parapet', R: 'parapet', bridge: true, drop: 26 },

  // The long right: down to the shore and onto the straight.
  { id: 'approach', sec: 'sweepback', len: 100, ease: 60, g: -7.8, L: 'lowDown', R: 'lowUp' },
  { id: 'back', sec: 'sweepback', r: -300, deg: 90, ease: 140, bank: 9, g: 0, gk: [[0.78, -6.5]], L: 'lowRun', R: 'lowUp', runoff: 'L' },

  { id: 'finish', sec: 'straight', len: 340, ease: 140, g: 0, L: 'shore', R: 'paddock' },
  { id: 'pitIn', sec: 'straight', len: 110, g: 0, L: 'shore', R: 'town' },
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
  /** Banking into the bends by rule: `bank` degrees times tanh(bankRadius / radius); a piece may name its own. */
  bank: 9,
  bankRadius: 250,
  /** Sector lines: [piece id, fraction along it], at about thirds of the lap. The third line is the start/finish line. */
  sectors: [
    ['mouth', 0.3],
    ['ledge1', 0.1],
  ],
  /** Street lamps stand along these pieces, alternating sides; tunnel lamps hang in rows along every tunnel. */
  streetLamps: { pieces: ['finish', 'pitIn', 'grid', 'gridRun'], spacing: 30, height: 9 },
  tunnelLamps: { spacing: 12, drop: 0.55, inset: 0.45 },
  /** Kerbs: on the inside of every bend tighter than `inside` metres from entry to exit, and on the outside at the exit of every bend tighter than `outside`. */
  kerbs: { inside: 800, outside: 500, exit: 0.4, width: SHOULDER },
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
