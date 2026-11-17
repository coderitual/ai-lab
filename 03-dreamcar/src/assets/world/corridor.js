// What the corridor is dressed with, worked out once from the Track and shared
// by everything that draws the ground beside and under the cars: the road
// (road.js), the town's pavements (paving.js) and the terrain's band along the
// road (terrain.js). Three parts of one surface must agree on where the town
// street begins, which side of a hairpin has a kerb and where the crossings
// are, so none of them keeps its own copy.
//
// Everything here is a rule applied to the Track's samples: nothing is placed
// by map coordinates, so a changed layout dresses itself. Pure JavaScript.
//
//   town      the lakeside straight (the Track's section 'straight') is a town
//             street: kerbs, pavements out to the solid edges, crossings, tree
//             pits. `town` eases from 0 to 1 over the first and last metres.
//   line      where a car driven fast is, across the road (the racing line),
//             and `rubber`: how much of its tyres it leaves there (braking
//             zones and tight bends)
//   apex      the inside of every tight bend has a flush painted kerb in
//             place of the gravel shoulder
//   leaves    where trees are the solid edge, litter collects along that side
//   tongue    water carried into a tunnel on tyres, fading with distance
//   pond      how readily water stands (less on a steep grade, where it runs)

/** The Track's EDGE values (the world never imports from game/). */
const EDGE_WALL = 2;
const EDGE_PARAPET = 3;
const EDGE_TREES = 4;

/** Metres over which the town street's dressing begins and ends, inside the straight. */
const TOWN_EASE = 16;
/** Crossings: metres after the start line (negative: before it), and half their length along the road. */
const CROSSINGS = [150, -72];
const CROSSING_HALF = 2;
/** A stop line stands this far before a crossing's near edge, for each direction. */
const STOP_GAP = 1.4;
/** The town's kerb: from the pavement's edge outwards, the gutter and the kerbstones (m). */
export const KERB = { gutter: 0.3, stone: 0.24 };
/** Tree pits along the town's pavements: spacing, the pit's middle from the kerb's back, and its half size (m). */
const PITS = { spacing: 17.5, back: 1.05, half: 0.6 };
/** Bends tighter than this (1/m) get a kerb on the inside. */
const APEX_CURVATURE = 1 / 40;
/** Rubber: bends at least this tight (1/m) are fully "tight"; the entry is judged this far ahead, the exit behind. */
const TIGHT = 1 / 32;
const LOOK_AHEAD = 38;
const LOOK_BEHIND = 30;
/** Water carried into a tunnel on tyres fades to a third over this many metres. */
const TONGUE = 26;

const cache = new WeakMap();

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Running mean over `half` samples each side, round the loop, twice (in place). */
function soften(values, half) {
  const n = values.length;
  if (half < 1) return values;
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += values[(k + n) % n];
    for (let i = 0; i < n; i++) {
      tmp[i] = sum / (2 * half + 1);
      sum += values[(i + half + 1) % n] - values[(i - half + n) % n];
    }
    values.set(tmp);
  }
  return values;
}

/**
 * @typedef {object} Corridor
 * @property {Float32Array} town 0..1 per sample: how much of a town street the road is there
 * @property {Uint8Array} paved 1 per sample where the verges are pavements (paving.js draws them, the terrain stands back)
 * @property {{ s0: number, s1: number } | null} townRange the town stretch (s0 may be greater than s1: it runs through the line)
 * @property {Array<{ s: number, half: number, stopBefore: number, stopAfter: number }>} crossings zebra crossings: middle
 *   (m from the line, wrapped), half length, and the stop lines' middles for the lap's direction and against it
 * @property {Array<{ s: number, side: number, lat: number, half: number }>} pits tree pits in the pavements
 * @property {Float32Array} line the racing line: metres left of the centre line, per sample
 * @property {Float32Array} rubber 0..1 per sample
 * @property {Float32Array} apexL @property {Float32Array} apexR 0..1 per sample: a painted kerb on that side
 * @property {Float32Array} leafL @property {Float32Array} leafR 0..1 per sample: leaf litter along that side
 * @property {Float32Array} tongue 0..1 per sample: water carried in under a roof
 * @property {Float32Array} pond 0..1 per sample: how readily water stands
 * @property {Float32Array} bank -1..1 per sample: which way water runs across the road (+: the left edge is the higher)
 */

/**
 * @param {object} track the Track
 * @returns {Corridor}
 */
export function corridorOf(track) {
  const known = cache.get(track);
  if (known) return known;
  const n = track.count;
  const ds = track.ds;
  const at = (s) => Math.round(track.wrap(s) / ds) % n;

  // ---- the town street
  const town = new Float32Array(n);
  const paved = new Uint8Array(n);
  const section = (track.sections ?? []).find((sec) => sec.id === 'straight') ?? null;
  const townRange = section ? { s0: section.s0, s1: section.s1 } : null;
  if (townRange) {
    const length = track.wrap(townRange.s1 - townRange.s0);
    for (let i = 0; i < n; i++) {
      const into = track.wrap(i * ds - townRange.s0);
      if (into > length) continue;
      town[i] = smooth(0, TOWN_EASE, Math.min(into, length - into));
      paved[i] = town[i] > 0.01 ? 1 : 0;
    }
  }
  const crossings = [];
  const pits = [];
  if (townRange) {
    for (const from of CROSSINGS) {
      const s = track.wrap(from);
      if (town[at(s)] < 0.99) continue;
      crossings.push({
        s,
        half: CROSSING_HALF,
        stopBefore: track.wrap(s - CROSSING_HALF - STOP_GAP),
        stopAfter: track.wrap(s + CROSSING_HALF + STOP_GAP),
      });
    }
    const length = track.wrap(townRange.s1 - townRange.s0);
    const count = Math.max(1, Math.round((length - 2 * TOWN_EASE) / PITS.spacing));
    for (let k = 0; k < count; k++) {
      const s = track.wrap(townRange.s0 + TOWN_EASE + ((k + 0.5) * (length - 2 * TOWN_EASE)) / count);
      if (crossings.some((c) => Math.abs(track.delta(c.s, s)) < c.half + 5)) continue;
      for (const side of [1, -1]) {
        const lat = track.halfWidth + KERB.gutter + KERB.stone + PITS.back;
        // only where the pavement is wide enough to walk round it
        if (track.edgeAt(s, side) - lat > PITS.half + 1.2) pits.push({ s, side, lat: side * lat, half: PITS.half });
      }
    }
  }

  // ---- the racing line and the rubber on it
  const curv = soften(Float32Array.from(track.curvature), Math.round(6 / ds));
  const tight = (c) => Math.min(1, Math.abs(c) / TIGHT);
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const here = curv[i];
    const ahead = curv[at(i * ds + LOOK_AHEAD)];
    const behind = curv[at(i * ds - LOOK_BEHIND)];
    // inside at the apex; out wide on the way in and on the way out
    const inside = Math.sign(here) * tight(here);
    const entry = -Math.sign(ahead) * tight(ahead) * (1 - tight(here));
    const exit = -Math.sign(behind) * tight(behind) * (1 - tight(here));
    line[i] = Math.max(-1, Math.min(1, inside + 0.9 * entry + 0.8 * exit)) * (track.halfWidth - 1.3);
  }
  soften(line, Math.round(8 / ds));
  // the fastest a car can be going: slow for the bends, braking into them
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) speed[i] = Math.min(70, Math.sqrt(12.5 / Math.max(1e-6, Math.abs(curv[i]))));
  for (let i = 2 * n - 2; i >= 0; i--) speed[i % n] = Math.min(speed[i % n], Math.sqrt(speed[(i + 1) % n] ** 2 + 2 * 11 * ds));
  const rubber = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const braking = Math.max(0, speed[i] ** 2 - speed[(i + 1) % n] ** 2) / (2 * ds * 11);
    rubber[i] = Math.min(1, 0.9 * braking + 0.55 * tight(curv[i]));
  }
  soften(rubber, Math.round(5 / ds));

  // ---- the edges
  const apexL = new Float32Array(n);
  const apexR = new Float32Array(n);
  const leafL = new Float32Array(n);
  const leafR = new Float32Array(n);
  const solid = (kind) => kind === EDGE_WALL || kind === EDGE_PARAPET;
  for (let i = 0; i < n; i++) {
    if (Math.abs(curv[i]) > APEX_CURVATURE) {
      if (curv[i] > 0 && !solid(track.kindL[i])) apexL[i] = 1;
      if (curv[i] < 0 && !solid(track.kindR[i])) apexR[i] = 1;
    }
    if (track.kindL[i] === EDGE_TREES && !paved[i]) leafL[i] = 1;
    if (track.kindR[i] === EDGE_TREES && !paved[i]) leafR[i] = 1;
  }
  soften(apexL, Math.round(2 / ds));
  soften(apexR, Math.round(2 / ds));
  soften(leafL, Math.round(8 / ds));
  soften(leafR, Math.round(8 / ds));

  // ---- water
  const tongue = new Float32Array(n);
  for (const t of track.tunnels ?? []) {
    for (let i = Math.ceil(t.s0 / ds); i * ds < t.s1; i++) tongue[i % n] = Math.exp(-(i * ds - t.s0) / TONGUE);
  }
  const pond = new Float32Array(n);
  const bank = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pond[i] = 1 - 0.55 * smooth(0.035, 0.085, Math.abs(track.grade[i]));
    // the banking tops out at about five degrees: 1 means "as steep across as this road gets"
    bank[i] = Math.max(-1, Math.min(1, track.ly[i] / 0.08));
  }

  const made = { town, paved, townRange, crossings, pits, line, rubber, apexL, apexR, leafL, leafR, tongue, pond, bank };
  cache.set(track, made);
  return made;
}
