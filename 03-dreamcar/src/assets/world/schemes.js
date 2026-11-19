// (forest lane) Where along the lap a piece's look (trackLayout.js SCHEMES, a
// piece's `scheme`) holds, and how strongly: read by the road's paint and tone,
// the kerbs' colours, the planting, the verge, the boulders and the bend signs.
//
// Per Track sample: which scheme is nearest (index into `names`, -1 none), its
// weight `w` (1 on its pieces, easing to 0 over the scheme's `blend` metres
// either side, so that the tree mix, the verge and the asphalt change
// gradually) and `on` (1 exactly on its pieces, 0 elsewhere: the lines start and
// end at a piece's ends). Reads only the Track's own data (track.layout, track.at):
// assets/ never imports game/.
//
// Pure arithmetic: no Three.js, runs in Node.

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const tables = new WeakMap();

/**
 * @typedef {object} SchemeTable
 * @property {string[]} names the schemes the lap uses
 * @property {object[]} defs their definitions (trackLayout.js SCHEMES)
 * @property {Int8Array} index per sample: the nearest scheme, -1 none
 * @property {Float32Array} w per sample: its weight, 0..1
 * @property {Uint8Array} on per sample: 1 on the scheme's own pieces
 * @property {Array<{ name: string, s0: number, s1: number, def: object }>} runs each run of consecutive pieces of one scheme
 */

/** @param {object} track @returns {SchemeTable} */
export function schemeTable(track) {
  let t = tables.get(track);
  if (t) return t;
  const n = track.count;
  const ds = track.ds;
  const layout = track.layout ?? {};
  const defs = layout.schemes ?? {};
  const names = Object.keys(defs);
  const index = new Int8Array(n).fill(-1);
  const w = new Float32Array(n);
  const on = new Uint8Array(n);
  /** @type {SchemeTable['runs']} */
  const runs = [];
  for (const seg of layout.segments ?? []) {
    if (!seg.scheme || !defs[seg.scheme] || typeof track.at !== 'function') continue;
    const s0 = track.at(seg.id, 0);
    const s1 = track.at(seg.id, 1);
    const last = runs[runs.length - 1];
    if (last && last.name === seg.scheme && Math.abs(track.delta(last.s1, s0)) < 1) last.s1 = s1;
    else runs.push({ name: seg.scheme, s0, s1, def: defs[seg.scheme] });
  }
  for (const run of runs) {
    const k = names.indexOf(run.name);
    const blend = run.def.blend ?? 80;
    const len = track.wrap(run.s1 - run.s0);
    for (let d = -blend; d <= len + blend; d += ds) {
      const i = Math.round(track.wrap(run.s0 + d) / ds) % n;
      const inside = d >= 0 && d <= len;
      const weight = inside ? 1 : smooth(1 - (d < 0 ? -d : d - len) / blend);
      if (weight > w[i]) {
        w[i] = weight;
        index[i] = k;
      }
      if (inside) on[i] = 1;
    }
  }
  t = { names, defs: names.map((k) => defs[k]), index, w, on, runs };
  tables.set(track, t);
  return t;
}

/**
 * The scheme at s: its name and definition, weight and whether s is on its own pieces; null where none reaches.
 * @param {object} track @param {number} s
 * @returns {{ name: string, def: object, w: number, on: boolean } | null}
 */
export function schemeAt(track, s) {
  const t = schemeTable(track);
  const i = Math.round(track.wrap(s) / track.ds) % track.count;
  const k = t.index[i];
  if (k < 0 || t.w[i] <= 0) return null;
  return { name: t.names[k], def: t.defs[k], w: t.w[i], on: t.on[i] === 1 };
}

/**
 * True where s lies on the own pieces of a scheme that draws the solid edges as low kerbstones (`curb`): there the
 * world draws no rail, no cut face and no tyre walls, boards or marshal posts (schemeFurniture.js draws the stones).
 * @param {object} track @param {number} s
 */
export function curbAt(track, s) {
  const t = schemeTable(track);
  const i = Math.round(track.wrap(s) / track.ds) % track.count;
  return t.index[i] >= 0 && t.on[i] === 1 && !!t.defs[t.index[i]].curb;
}
