// The sea's surface, defined once: a sum of trochoidal (Gerstner) waves that
// the water's shader draws (the vertex stage moves the surface, the fragment
// stage takes its slopes for the normal) and that anything on the CPU can
// ask for (sampleWaves), so that what is seen and what is computed agree.
//
// Ported from demo 01 (its engine/waves.js, where the same sum carries the
// boats): the same trochoids, the same deep-water dispersion (a wave of length
// L travels at sqrt(g L / 2 pi)), the same two ways of dropping a wave that is
// too short to matter (from the mesh once it has fewer than a few vertices
// per wavelength; from the normals once it is smaller than a pixel, which
// depends on how far away the surface is and how high the eye stands), and
// the same Jacobian for foam where the surface bunches up at a crest.
// What is different here: no islands or shelter field (the shore is the
// caller's, from its own map of the depth), a longer and softer swell (an
// open sea seen from a coast road high above it, not a race course among
// islands), and the slope variance a wave stops drawing is handed back, so
// that the caller can widen its highlight by as much (Toksvig): far away the
// sun's glitter becomes a smooth path instead of a shimmer of aliased sparks.
//
// The clock is whoever calls update(): the run's own simulation time, so a
// picture at a given moment is the same picture every time.

/** Gravity (m/s^2), for the waves' speeds. */
const G = 9.81;
const DEG = Math.PI / 180;

/**
 * The sea state: travel direction (degrees, 0 = +X, 90 = +Z), wavelength (m), amplitude (m), and how sharp the
 * crests are (1: a true trochoid). Longest first: the swell (the first SWELLS), then the wind's chop, then the
 * short waves that only the normals draw.
 */
export const WAVES = [
  // a long soft swell from the open sea
  // (round 2) lower than round 1's 0.85, 0.55 and 0.36 m, and further apart in direction: from the coast road high
  // above, the swell read as ruled lines; it is a texture in the frame (E1)
  { dir: -28, len: 150, amp: 0.6, steep: 0.9 },
  { dir: 4, len: 98, amp: 0.38, steep: 1.0 },
  { dir: -61, len: 63, amp: 0.26, steep: 1.0 },
  // a light breeze's chop over it
  { dir: 18, len: 34, amp: 0.15, steep: 1.1 },
  { dir: -72, len: 21, amp: 0.085, steep: 1.1 },
  { dir: 38, len: 12.6, amp: 0.048, steep: 1.1 },
  { dir: -33, len: 7.9, amp: 0.03, steep: 1.0 },
  // short waves: normals only
  { dir: 6, len: 5.1, amp: 0.019, steep: 1.0 },
  { dir: -57, len: 3.6, amp: 0.013, steep: 1.0 },
  { dir: 62, len: 2.5, amp: 0.009, steep: 1.0 },
  { dir: -14, len: 1.7, amp: 0.006, steep: 1.0 },
];
/**
 * Wave groups (sea lane, round 2): no train of a real sea is even. Each wave's height swells and fades over a long
 * pattern of its own, `amp` times its mean either way, `len` times its wavelength long and turned `turn` degrees off its
 * direction (alternating sides), so that from high above the swell reads as sets and lulls, not as ruled lines, and the
 * chop as patches of rough and calm water. The same factor moves the mesh, shades the normals and answers sampleWaves.
 */
export const GROUPS = { amp: 0.65, len: 7.5, turn: 65 };
/**
 * (sea lane, round 2: the owner's "sea side with BIG waves") Where the swell runs big: round a place the caller
 * names (`setBoost`: x, z, radius), the swell's waves (the first SWELLS, not the chop) are `gain` times higher at its
 * middle (`gain` is per swell wave), easing to their own height from `inner` of the radius out. One factor for the
 * mesh, the normals, the foam and sampleWaves.
 */
// (round 3) per swell wave, longest first: the shorter swells grow most, so that close to the shore they read as
// steep rollers (the 63 m wave 4.2 times its height: about 1.1 m, a slope of a tenth) and not as gentle slopes
export const BOOST = { gain: [1.2, 2.4, 3.2], inner: 0.35 };
/** How many of WAVES are the swell (foam behind crests looks back over these). */
export const SWELLS = 3;
/** Rough crest-to-trough range of the open sea (m), for shading by height. */
export const SEA_HEIGHT = 2 * Math.sqrt(WAVES.reduce((s, w) => s + w.amp * w.amp, 0)) * 1.25;

const BUILT = WAVES.map((w, i) => {
  const k = (2 * Math.PI) / w.len;
  // the group's pattern: longer for the short waves (patches tens of metres across at least), never under 160 m
  const gk = (2 * Math.PI) / Math.max(160, GROUPS.len * w.len * (1 + 0.37 * i));
  const ga = (w.dir + (i % 2 ? GROUPS.turn : -GROUPS.turn) + 9 * i) * DEG;
  return {
    dx: Math.cos(w.dir * DEG),
    dz: Math.sin(w.dir * DEG),
    k,
    omega: Math.sqrt(G * k),
    amp: w.amp,
    hAmp: w.amp * w.steep,
    phase: i * 1.7 + 0.4,
    len: w.len,
    gx: Math.cos(ga) * gk,
    gz: Math.sin(ga) * gk,
    gp: i * 2.3 + 1.1,
  };
});
/** A wave's group factor at (x, z) (GROUPS). */
const groupOf = (w, x, z) => 1 + GROUPS.amp * Math.cos(w.gx * x + w.gz * z + w.gp);
/** The swell's boost at (x, z) round `place` ({ x, z, r } or null) (BOOST). */
export function boostAt(x, z, place, i = 0) {
  if (!place || i >= SWELLS) return 1;
  const d = Math.hypot(x - place.x, z - place.z) / place.r;
  const t = Math.min(1, Math.max(0, (d - BOOST.inner) / (1 - BOOST.inner)));
  return 1 + BOOST.gain[i] * (1 - t * t * (3 - 2 * t));
}

/**
 * @typedef {object} WaveField
 * @property {Record<string, { value: any }>} uniforms uWaveA, uWaveB, uWaveC, uWaveTime (share these objects)
 * @property {string} glsl declarations and functions for either stage: waveDisplace, waveNormal, swellCrest
 * @property {number} count waves the shader sums
 * @property {(time: number, eyeHeight: number) => void} update the clock (the run's) and the eye's height over the
 *   water, which sets how far out each wave still draws in the normals
 */

/**
 * The waves as one shader would draw them.
 * @param {object} [options]
 * @param {number} [options.count] how many of WAVES (the longest first): fewer on a cheaper tier
 * @param {number} [options.segments] the angular segments of the mesh they move (0: the mesh is not moved): a wave is
 *   displaced only out to where the mesh still has about five vertices per wavelength, beyond that the normals
 *   carry it
 * @param {number} [options.normals] how many of them (the longest first) waveNormal draws as slopes; the rest it
 *   only counts in `lost`, for a caller that draws the short waves some other way (the sea's wind ripples: a few
 *   sines of one length each read as ruled lines, which a breeze's chop is not)
 * @returns {WaveField}
 */
export function createWaveField({ count = WAVES.length, segments = 0, normals = count } = {}) {
  const waves = BUILT.slice(0, count);
  const n = waves.length;
  const uniforms = {
    uWaveA: { value: waves.map((w) => [w.dx, w.dz, w.k, w.omega]).flat() },
    // amplitude, horizontal amplitude, phase, how far out the mesh is moved by it
    uWaveB: { value: waves.map((w) => [w.amp, w.hAmp, w.phase, segments > 0 ? (w.len * segments) / 32 : 0]).flat() },
    // how far out (m) each wave still draws in the normals (update sets it from the eye's height)
    uWaveC: { value: new Float32Array(n).fill(1e5) },
    // the group's wave vector (x, z) and phase, and its depth (GROUPS)
    uWaveG: { value: waves.map((w) => [w.gx, w.gz, w.gp, GROUPS.amp]).flat() },
    // where the swell runs big (x, z, radius; radius 0: nowhere) (BOOST)
    uWaveBoost: { value: [0, 0, 0, 0] },
    uWaveBoostGain: { value: waves.map((w, i) => (i < SWELLS ? BOOST.gain[i] : 0)) },
    uWaveTime: { value: 0 },
  };
  const glsl = /* glsl */ `
#define WAVE_COUNT ${n}
#define WAVE_NORMALS ${Math.min(normals, n)}
#define SWELL_COUNT ${Math.min(SWELLS, n)}
uniform vec4 uWaveA[WAVE_COUNT];   // direction (x, z), wavenumber, angular frequency
uniform vec4 uWaveB[WAVE_COUNT];   // amplitude, horizontal amplitude, phase, how far out the mesh is moved by it
uniform float uWaveC[WAVE_COUNT];  // how far out it draws in the normals
uniform vec4 uWaveG[WAVE_COUNT];   // its group: wave vector (x, z), phase, depth
uniform float uWaveTime;

uniform vec4 uWaveBoost;          // where the swell runs big: x, z, radius (BOOST)
uniform float uWaveBoostGain[WAVE_COUNT]; // and by how much, per wave

// how high a wave runs at p: its sets and lulls (GROUPS), and the swell's boost (BOOST)
float waveGroup( int i, vec2 p ) {
  vec4 g = uWaveG[ i ];
  float f = 1.0 + g.w * cos( dot( g.xy, p ) + g.z );
  if ( i < SWELL_COUNT && uWaveBoost.z > 0.0 ) {
    float d = length( p - uWaveBoost.xy ) / uWaveBoost.z;
    f *= 1.0 + uWaveBoostGain[ i ] * ( 1.0 - smoothstep( ${BOOST.inner.toFixed(2)}, 1.0, d ) );
  }
  return f;
}

// Where the undisplaced surface point p is moved to, dist metres from the eye: waves too short for the mesh there
// are left out.
vec3 waveDisplace( vec2 p, float ampScale, float dist ) {
  vec3 d = vec3( 0.0 );
  for ( int i = 0; i < WAVE_COUNT; i ++ ) {
    vec4 A = uWaveA[ i ];
    vec4 B = uWaveB[ i ];
    float f = 1.0 - smoothstep( B.w * 0.55, B.w, dist );
    if ( f <= 0.0 ) continue;
    float th = A.z * dot( A.xy, p ) - A.w * uWaveTime + B.z;
    f *= waveGroup( i, p );
    d.xz += A.xy * ( B.y * cos( th ) * f );
    d.y += B.x * sin( th ) * f;
  }
  return d * ampScale;
}

// The surface's normal at p, its Jacobian (small where it bunches up at a crest), and the slope variance of the
// waves that were too small to draw at this distance or are not drawn here at all (lost: what a highlight should
// widen by; both axes together).
void waveNormal( vec2 p, float ampScale, float dist, out vec3 n, out float jac, out float lost ) {
  vec2 slope = vec2( 0.0 );
  float ny = 0.0;
  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  lost = 0.0;
  for ( int i = 0; i < WAVE_COUNT; i ++ ) {
    vec4 A = uWaveA[ i ];
    vec4 B = uWaveB[ i ];
    float keep = i < WAVE_NORMALS ? 1.0 - smoothstep( uWaveC[ i ] * 0.5, uWaveC[ i ], dist ) : 0.0;
    float ka = A.z * B.x * ampScale * waveGroup( i, p );
    lost += 0.5 * ka * ka * ( 1.0 - keep * keep );
    if ( keep <= 0.0 ) continue;
    float th = A.z * dot( A.xy, p ) - A.w * uWaveTime + B.z;
    float c = cos( th );
    float s = sin( th );
    float kh = A.z * B.y * ampScale * keep * waveGroup( i, p );
    slope += A.xy * ( ka * keep * c );
    ny += kh * s;
    jxx += kh * A.x * A.x * s;
    jzz += kh * A.y * A.y * s;
    jxz += kh * A.x * A.y * s;
  }
  n = normalize( vec3( - slope.x, 1.0 - ny, - slope.y ) );
  jac = ( 1.0 - jxx ) * ( 1.0 - jzz ) - jxz * jxz;
}

// How hard the swell was bunching up at p, lag seconds ago (0 flat, towards 1 breaking): foam lingers behind crests.
float swellCrest( vec2 p, float ampScale, float lag, float steepen ) {
  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  for ( int i = 0; i < SWELL_COUNT; i ++ ) {
    vec4 A = uWaveA[ i ];
    vec4 B = uWaveB[ i ];
    float s = sin( A.z * dot( A.xy, p ) - A.w * ( uWaveTime - lag ) + B.z );
    float kh = A.z * B.y * ampScale * steepen * waveGroup( i, p );
    jxx += kh * A.x * A.x * s;
    jzz += kh * A.y * A.y * s;
    jxz += kh * A.x * A.y * s;
  }
  return 1.0 - ( ( 1.0 - jxx ) * ( 1.0 - jzz ) - jxz * jxz );
}
`;
  return {
    uniforms,
    glsl,
    count: n,
    /** Where the swell runs big ({ x, z, r }, or null: nowhere) (BOOST). */
    setBoost(place) {
      const b = uniforms.uWaveBoost.value;
      b[0] = place?.x ?? 0;
      b[1] = place?.z ?? 0;
      b[2] = place?.r ?? 0;
    },
    update(time, eyeHeight) {
      uniforms.uWaveTime.value = time;
      // (01's rule) a wave of length L stops showing at about sqrt(570 h L) m from an eye h m above it
      const h = Math.max(eyeHeight, 1.5);
      const c = uniforms.uWaveC.value;
      for (let i = 0; i < n; i++) c[i] = Math.sqrt(570 * h * waves[i].len);
    },
  };
}

/**
 * The surface over the world point (x, z) at time t, from the waves that move the mesh (the first `count`): its
 * height (y), unit normal (nx, ny, nz) and vertical speed (vy). The horizontal displacement is inverted with a few
 * fixed-point steps, so the answer is for the surface that is really over (x, z).
 * @param {number} x @param {number} z @param {number} t
 * @param {{ y: number, nx: number, ny: number, nz: number, vy: number }} out
 * @param {number} [count]
 * @param {{ x: number, z: number, r: number } | null} [place] where the swell runs big (BOOST), as the shader's
 */
export function sampleWaves(x, z, t, out, count = SWELLS + 4, place = null) {
  const n = Math.min(count, BUILT.length);
  let px = x;
  let pz = z;
  for (let it = 0; it < 3; it++) {
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < n; i++) {
      const w = BUILT[i];
      const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.omega * t + w.phase) * groupOf(w, px, pz) * boostAt(px, pz, place, i);
      ox += w.dx * w.hAmp * c;
      oz += w.dz * w.hAmp * c;
    }
    px = x - ox;
    pz = z - oz;
  }
  let y = 0;
  let sx = 0;
  let sz = 0;
  let ny = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const w = BUILT[i];
    const th = w.k * (w.dx * px + w.dz * pz) - w.omega * t + w.phase;
    const g = groupOf(w, px, pz) * boostAt(px, pz, place, i);
    const s = Math.sin(th) * g;
    const c = Math.cos(th) * g;
    y += w.amp * s;
    sx += w.dx * w.k * w.amp * c;
    sz += w.dz * w.k * w.amp * c;
    ny += w.k * w.hAmp * s;
    vy -= w.amp * w.omega * c;
  }
  const inv = 1 / Math.hypot(sx, 1 - ny, sz);
  out.y = y;
  out.nx = -sx * inv;
  out.ny = (1 - ny) * inv;
  out.nz = -sz * inv;
  out.vy = vy;
  return out;
}
