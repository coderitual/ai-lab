// The page's URL parameters, read once. All of them are optional and most are
// for testing and for staging pictures.
//
// The game (index.html):
//   ?manual        no animation loop: frames come only from __serp.advance() / skip()
//   ?nodraw        the loop runs but nothing is drawn (fast automated checks)
//   ?auto          skip the title and start a solo run
//   ?ap            an autopilot drives the local cars
//   ?mode=solo|split
//   ?time=day|dusk|night   any time of day lighting.js has (the game checks the name)
//   ?laps=3
//   ?cam=chase|far|bonnet|bumper
//   ?q=low|medium|high   force a quality tier (default: chosen by a capability probe)
//   ?dpr=1.5       force the canvas pixel ratio (also switches adaptive resolution off)
//   ?seed=7        seed of every random choice
//   ?t=5           seconds to simulate before the first frame
//   ?ui=0          no HTML overlay
//   ?post=0        the scene straight to the screen (exposure and tone curve only)
//   ?shadows=0     no shadow maps
//   ?probe=0       no live reflections on the cars
//   ?fx=0          no skid marks, smoke, spray or sparks
//   ?plate=TEXT &plate2=TEXT   what the number plates say
//   ?paint=NAME    the first car's paint
//   ?wet=0.6       road wetness, 0..1 (a preview of weather to come; not in the interface)
//   ?mute          no sound
//   ?debug=NAME    show one intermediate buffer of the frame
//   ?ldr           use the 8-bit fallback even where float targets exist (to test it)
//
// The viewer (viewer.html) reads the same ones and, in `viewer`, its own:
//   ?asset=car|world|track   &lights=off|drl|low|high|brake|all
//   ?az= &el= &dist= &fov= &tx= &ty= &tz=   orbit camera (degrees and metres)
//   ?ortho=side|front|rear|top  &span=5.4   orthographic camera, metres across the picture
//   ?s=120         track distance to stand at

export const TIER_NAMES = ['low', 'medium', 'high'];
const MODES = ['solo', 'split'];
const CAMERAS = ['chase', 'far', 'bonnet', 'bumper'];
const LIGHT_PRESETS = ['off', 'drl', 'low', 'high', 'brake', 'all'];
const ORTHO_VIEWS = ['side', 'front', 'rear', 'top'];

/**
 * @typedef {object} ViewerParams
 * @property {string} asset
 * @property {'off'|'drl'|'low'|'high'|'brake'|'all'|null} lights null: what the time of day asks for
 * @property {number} [az] @property {number} [el] @property {number} [dist] @property {number} [fov]
 * @property {number} [tx] @property {number} [ty] @property {number} [tz]
 * @property {'side'|'front'|'rear'|'top'|null} ortho
 * @property {number} [span]
 * @property {number} [s]
 */

/**
 * @typedef {object} Params
 * @property {boolean} manual
 * @property {boolean} nodraw
 * @property {boolean} auto
 * @property {boolean} autopilot
 * @property {'solo'|'split'} mode
 * @property {string|null} time a time of day's name as given (null: the game's default)
 * @property {number|null} laps
 * @property {'chase'|'far'|'bonnet'|'bumper'} camera
 * @property {'low'|'medium'|'high'|null} quality
 * @property {number|null} dpr
 * @property {number} seed
 * @property {number} preAdvance seconds
 * @property {boolean} ui
 * @property {boolean} post
 * @property {boolean} shadows
 * @property {boolean} probe
 * @property {string|null} plate
 * @property {string|null} plate2
 * @property {string|null} paint
 * @property {number|null} wet
 * @property {boolean} mute
 * @property {string|null} debug
 * @property {boolean} ldr
 * @property {ViewerParams} viewer only the values that were given
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
  const word = (key) => {
    const v = (q.get(key) || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return v || null;
  };
  // a number plate: capitals, digits, spaces and hyphens, nine characters at most
  const plate = (key) => {
    const v = (q.get(key) || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 -]/g, '')
      .trim()
      .slice(0, 9);
    return v || null;
  };

  const viewer = { asset: word('asset') || 'car', lights: oneOf('lights', LIGHT_PRESETS), ortho: oneOf('ortho', ORTHO_VIEWS) };
  for (const key of ['az', 'el', 'dist', 'fov', 'tx', 'ty', 'tz', 'span', 's']) {
    const v = num(key);
    if (v !== undefined) viewer[key] = v;
  }

  const laps = num('laps');
  return {
    manual: q.has('manual'),
    nodraw: q.has('nodraw'),
    auto: q.has('auto'),
    autopilot: q.has('ap'),
    mode: oneOf('mode', MODES) || 'solo',
    time: word('time'),
    laps: laps !== undefined && laps >= 1 ? Math.floor(laps) : null,
    camera: oneOf('cam', CAMERAS) || 'chase',
    quality: oneOf('q', TIER_NAMES),
    dpr: num('dpr') ?? null,
    seed: Math.floor(num('seed') ?? 1),
    preAdvance: Math.max(0, num('t') ?? 0),
    ui: q.get('ui') !== '0',
    post: q.get('post') !== '0',
    shadows: q.get('shadows') !== '0',
    probe: q.get('probe') !== '0',
    fx: q.get('fx') !== '0',
    plate: plate('plate'),
    plate2: plate('plate2'),
    paint: word('paint'),
    // null when not given: the time of day's own wetness (lighting.js) applies
    wet: num('wet') == null ? null : Math.min(1, Math.max(0, num('wet'))),
    mute: q.has('mute'),
    debug: word('debug'),
    ldr: q.has('ldr'),
    viewer,
  };
}
