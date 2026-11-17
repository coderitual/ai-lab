// The page's URL parameters, read once. All of them are optional and most are
// for testing and for staging pictures.
//
//   ?manual        no animation loop: frames are drawn only by __swan.advance()
//   ?q=low|medium|high   force a quality tier (default: chosen by a capability probe)
//   ?dpr=1.5       force the canvas pixel ratio (also switches adaptive resolution and the tier's pixel budget off)
//   ?msaa=0|2|4    force the multisampling of the scene and mirror targets (default: the tier's)
//   ?seed=7        seed of every random choice
//   ?ui=0          no HTML overlay
//   ?az= &el= &dist= &fov= &tx= &ty= &tz=   staged camera (degrees and metres)
//   ?t=5           seconds of simulation to run before the first frame
//   ?time=0.3      time scale (1 = real time)
//   ?ldr           use the 8-bit fallback even where float targets exist
//   ?nopost        skip bloom and grading (the scene buffer straight to the screen)
//   ?only=swan,water   build only these parts (swan, water, specks, forest, droplets)
//   ?debug=far|farmirror|mirror|bloom|ripple   show one intermediate buffer full screen

const PARTS = ['swan', 'water', 'specks', 'forest', 'droplets'];
const DEBUG_VIEWS = ['far', 'farmirror', 'mirror', 'bloom', 'ripple'];
const TIERS = ['low', 'medium', 'high'];

/**
 * @typedef {object} Params
 * @property {boolean} manual
 * @property {'low'|'medium'|'high'|null} quality
 * @property {number|null} dpr
 * @property {0|2|4|null} msaa
 * @property {number} seed
 * @property {boolean} ui
 * @property {{ az?: number, el?: number, dist?: number, fov?: number, target?: [number|undefined, number|undefined, number|undefined] }} view
 *   only the values that were given
 * @property {number} preAdvance seconds
 * @property {number|null} timeScale
 * @property {boolean} ldr
 * @property {boolean} nopost
 * @property {Set<string>|null} only null means everything
 * @property {'far'|'farmirror'|'mirror'|'bloom'|'ripple'|null} debug
 * @property {(part: string) => boolean} wants whether a part should be built
 */

/**
 * @param {string} [search] the query string (default: this page's)
 * @returns {Params}
 */
export function parseParams(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search);
  const num = (key) => {
    if (!q.has(key)) return undefined;
    const v = parseFloat(q.get(key));
    return Number.isFinite(v) ? v : undefined;
  };
  const oneOf = (key, allowed) => {
    const v = (q.get(key) || '').toLowerCase();
    return allowed.includes(v) ? v : null;
  };

  const view = {};
  for (const key of ['az', 'el', 'dist', 'fov']) {
    const v = num(key);
    if (v !== undefined) view[key] = v;
  }
  const t = [num('tx'), num('ty'), num('tz')];
  if (t.some((v) => v !== undefined)) view.target = t;

  let only = null;
  if (q.has('only')) {
    only = new Set(
      q
        .get('only')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => PARTS.includes(s)),
    );
  }

  return {
    manual: q.has('manual'),
    quality: oneOf('q', TIERS),
    dpr: num('dpr') ?? null,
    msaa: [0, 2, 4].includes(num('msaa')) ? num('msaa') : null,
    seed: Math.floor(num('seed') ?? 1),
    ui: q.get('ui') !== '0',
    view,
    preAdvance: Math.max(0, num('t') ?? 0),
    timeScale: num('time') ?? null,
    ldr: q.has('ldr'),
    nopost: q.has('nopost'),
    only,
    debug: oneOf('debug', DEBUG_VIEWS),
    wants: (part) => only === null || only.has(part),
  };
}
