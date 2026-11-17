// What the corridor is dressed with, worked out once from the Track and shared
// by everything that draws the ground beside and under the cars: the road and
// its kerbs (road.js, kerbs.js) and the terrain's band along the road. Parts
// of one surface must agree on where the racing line runs and where the
// kerbs stand, so none of them keeps its own copy.
//
// Everything here is a rule applied to the Track's samples: nothing is placed
// by map coordinates, so a changed layout dresses itself. Pure JavaScript.
//
//   line      where a car driven fast is, across the road (the racing line):
//             out wide before a bend, at the apex inside it, out wide after
//   rubber    how much of its tyres the line holds there (braking zones and
//             the bends themselves)
//   braking   0..1 per sample: the hardest braking on the lap (the slow
//             corner's approach): where tyre marks are left
//   kerbL/R   how much kerb stands there (the Track's kerbAt, per sample)
//   leafL/R   where woods stand behind the barrier, litter on the margin
//   tongue    water carried into a tunnel on tyres, fading with distance
//   pond      how readily water stands (less on a steep grade, where it runs)
//   bank      which way water runs across the road

/** Rubber: bends at least this tight (1/m) are fully "tight"; the entry is judged this far ahead, the exit behind. */
const TIGHT = 1 / 140;
const LOOK_AHEAD = 70;
const LOOK_BEHIND = 60;
/** The racing line keeps this far inside the pavement's edges at the apex and on the way in and out (m). */
const LINE_MARGIN = 1.1;
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
 * @property {Float32Array} line the racing line: metres left of the centre line, per sample
 * @property {Float32Array} rubber 0..1 per sample
 * @property {Float32Array} braking 0..1 per sample: how hard cars brake there, against the hardest on the lap
 * @property {Float32Array} kerbL @property {Float32Array} kerbR 0..1 per sample: a kerb on that side
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

  // ---- the racing line and the rubber on it
  const curv = soften(Float32Array.from(track.curvature), Math.round(10 / ds));
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
    line[i] = Math.max(-1, Math.min(1, inside + 0.9 * entry + 0.8 * exit)) * (track.halfWidth - LINE_MARGIN);
  }
  soften(line, Math.round(14 / ds));
  // the fastest a car can be going: slow for the bends, braking into them
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) speed[i] = Math.min(80, Math.sqrt(13 / Math.max(1e-6, Math.abs(curv[i]))));
  for (let i = 2 * n - 2; i >= 0; i--) speed[i % n] = Math.min(speed[i % n], Math.sqrt(speed[(i + 1) % n] ** 2 + 2 * 11 * ds));
  const rubber = new Float32Array(n);
  const braking = new Float32Array(n);
  let hardest = 0;
  for (let i = 0; i < n; i++) {
    const b = Math.max(0, speed[i] ** 2 - speed[(i + 1) % n] ** 2) / (2 * ds * 11);
    // how much speed is shed from here to the bottom of this braking zone: the slow corner's approach stands out
    braking[i] = b > 0.2 ? speed[i] : 0;
    rubber[i] = Math.min(1, 0.7 * b + 0.6 * tight(curv[i]));
  }
  // what a braking zone sheds: its top speed less the corner's
  for (let i = 0; i < n; i++) {
    if (!braking[i]) continue;
    let j = i;
    while (braking[(j + 1) % n] && j - i < n) j++;
    const shed = speed[i] - speed[(j + 1) % n];
    braking[i] = shed;
    hardest = Math.max(hardest, shed);
  }
  for (let i = 0; i < n; i++) braking[i] = hardest > 0 ? smooth(0.6, 0.95, braking[i] / hardest) : 0;
  soften(rubber, Math.round(5 / ds));
  soften(braking, Math.round(3 / ds));

  // ---- the edges
  const kerbL = new Float32Array(n);
  const kerbR = new Float32Array(n);
  const leafL = new Float32Array(n);
  const leafR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    kerbL[i] = track.kerbAt ? track.kerbAt(s, 1) : 0;
    kerbR[i] = track.kerbAt ? track.kerbAt(s, -1) : 0;
    if (track.woodAt?.(s, 1)) leafL[i] = 1;
    if (track.woodAt?.(s, -1)) leafR[i] = 1;
  }
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
    // 1 means "as steep across as this road gets" (about ten degrees)
    bank[i] = Math.max(-1, Math.min(1, track.ly[i] / 0.17));
  }

  const made = { line, rubber, braking, kerbL, kerbR, leafL, leafR, tongue, pond, bank };
  cache.set(track, made);
  return made;
}
