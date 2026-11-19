// The sea: open water to the horizon beyond the coast road, the bay inside
// the loop and the bay beside the start straight, which are all the same
// water. One level surface drawn round the eye; the land covers it wherever
// it stands above it.
//
// WHERE. The terrain says where the water is (terrain.sea: its level, which
// points are sea, the sea map). From that word and the land's own height
// function this file writes the SHORE MAP (seaShore.js): per texel the bed's
// depth, the distance to the shoreline, the land's height (for reflections)
// and whether the bed is sand or rock. Everything below that depends on the
// coast reads that one map, so the water follows whatever shape the coast is
// given.
//
// THE MESH (one draw call): a disc of rings round the eye, dense near it and
// sparse towards the horizon, out to SEA_LOOK.horizon. That is beyond the
// views' far plane: the vertex stage keeps those vertices just inside the
// depth range (as far.js keeps its ridges), so open water reaches the true
// horizon and real land still draws over it. On medium and high the swell
// moves the mesh (engine/waves.js) and the sheet of water running up a beach
// lifts its edge; on low it is a flat disc.
//
// THE SHADING is a MeshStandardMaterial with the surface written into it, so
// the sun or the moon with its shadow map, the fill and the haze reach the
// water as they reach the land. What is the water's own, per pixel:
//
//  - THE SLOPES. The analytic slopes of the swell and the longest chop
//    (engine/waves.js, each wave faded out where it is smaller than a pixel)
//    and wind ripples: layers of one tiling normal map at different sizes,
//    turned different ways, drifting downwind. The short waves of the wave
//    field still move the mesh and whatever floats, but the picture of them
//    is the ripple layers': a few sines of one length each are ruled lines. Gusts (cat's paws) and long glassy slicks, both slow fields
//    that drift with the wind, say how rough the water is; the lee of the
//    land is calmer. Every slope a pixel is too big to draw is not thrown
//    away: its variance is carried (`seaVar`) and
//      * widens the sun's highlight (the glitter path: sparks close to,
//        a wide blazing road far out, never a shimmer of aliased sparks),
//      * lowers the mirror's strength at a glancing angle and lifts the
//        mirrored ray (a rough sea shows the sky some way above the horizon,
//        darker and bluer than a calm one: Bruneton's mean Fresnel),
//      * softens the mirrored skyline.
//  - THE BODY, by depth: the bed (pale sand with ripples, dark reef and weed
//    in patches) seen through the water column, which takes out red within a
//    couple of metres, green within twenty and blue last (SEA_LOOK.absorb),
//    over the time of day's deep colour. So the shallows over sand are
//    turquoise, then teal, then the open water's blue, with nothing but the
//    shore map's depth deciding which. The bed is looked up where the
//    refracted line of sight meets it and the light the ripples gather on
//    it (caustics) plays over it close to.
//  - THE MIRROR. The sky's environment map, clouds and all, by the mean
//    Fresnel above. On medium and high the mirrored ray is marched across
//    the shore map's land heights (coarser mip levels for longer steps: they
//    hold the highest land of the stretch they cover), and where land stands
//    over it the water shows the land instead: dark, soft, hazed by its
//    distance, drawn out towards the eye by the ripples, as a hill or a sea
//    stack mirrors in real water.
//  - THE SUN'S GLITTER. The directional light's highlight, broken into
//    sparks: cells of the water about a pixel across flash for a share of
//    their own beat, the share being the highlight's strength over a spark's
//    brightness, so that the mean light is unchanged (lighting.js's units
//    hold) but the path is made of points that bloom.
//  - WHITE WATER, all from the shore map: lines of surf rolling in over a
//    shelving bed parallel to the shore (a front, lace dissolving behind it,
//    a translucent face ahead of it), the thin sheet that runs up the sand
//    and drains back with foam at its edge, the slap and wash round rocks,
//    cliffs' feet and sea stacks, and streaks behind the open sea's crests
//    in the gusts.
//  - at night the nearest lamps (the road's glints, lamps.js) and the cars' tail lamps as long streaks.
//  - on high, A PLANAR MIRROR (engine/PlanarMirror.js, drawn by world/index.js: one small extra pass of the scene from
//    the eye mirrored in the water's level): piers, rails, cars, the far shore and the sky's own clouds as they are
//    at that moment, looked up where the pixel's mirrored ray (lifted and drawn out as above) lands in it. Where the
//    ray leaves that picture the environment map and the marched land stand in, as on medium.
//
// Far out the water goes into the haze by its true distance and, at the
// disc's edge, into exactly the colour the sky dome shows under the horizon.
// The waves' clock is the run's: the same moment is the same picture.

import * as THREE from 'three';
import { createWaveField, SEA_HEIGHT, WAVES } from '../../engine/waves.js';
import { GLSL_HASH, GLSL_PROBE } from '../../engine/glsl.js';
import { gradientField, normalTexture, valueField, worleyField, fieldTexture } from '../../engine/noise.js';
import { SHORE, bakeShoreMap } from './seaShore.js';
import { extend } from './shading.js';

const DEG = Math.PI / 180;

/**
 * How much water each kind of device draws, by name: the three tiers, and `mobile`, which is what medium means on a
 * phone (`caps.mobile`) unless createSea is told otherwise (`detail`): the same surface with about a third fewer
 * texture reads a pixel and a quarter of the shore map's texels.
 *   segments  the mesh's angular segments (its rings grow to keep the cells square); displace: the waves move it
 *   waves     how many of WAVES it knows (longest first); normals: how many of those its normals draw as waves
 *             (the swell and the longest chop: the shorter ones are the ripple layers' to draw, see the header)
 *   ripples   which ripple layers are drawn (indices into SEA_LOOK.ripples); the others count as roughness
 *   lean      one gust sample instead of two, no slicks, the bed's fine patches from the foam's noise
 *   land      steps the mirrored ray takes over the land (0: the water mirrors the sky alone); stride: how much
 *             longer each is than the last (the first is 9 m: medium reaches 1.8 km, mobile 500 m, high 2.2 km)
 *   probe     the far land beyond the shore map from the car's reflection probe, where the game hands one over
 *   shore     the shore map's texels a side
 *   relief    the surf's lines have a crest in the normal; clouds: their shade; caustics: light on a shallow bed
 *   lamps     lamps mirrored at night; tails: tail lamps (two a car)
 *   piers     the nearest piers standing in the water (foam round their feet; with `land`, their reflections)
 *   shed      what is left while the quality ladder's `detail` rung is shed (engine/caps.js LADDER; setShed): the
 *             march's steps and stride then; and then only the ripple layers `mobile` draws are drawn, with one gust
 *             sample, no slicks, no clouds' shade, no relief on the surf, no caustics and no planar mirror. All by
 *             uniforms: no shader is compiled when the rung goes or comes back.
 * The planar mirror is the world's to give (createSea's `mirror`: on high).
 */
export const SEA_TIERS = {
  low: { segments: 32, displace: false, waves: 7, normals: 4, ripples: [1, 4], lean: true, land: 0, stride: 2, probe: false, shore: 512, relief: false, clouds: false, caustics: false, lamps: 6, piers: 4, tails: 2, shed: null },
  mobile: { segments: 64, displace: true, waves: 7, normals: 4, ripples: [1, 4], lean: true, land: 4, stride: 3.8, probe: true, shore: 512, relief: false, clouds: false, caustics: false, lamps: 6, piers: 4, tails: 2, shed: { land: 0, stride: 3.8 } },
  medium: { segments: 96, displace: true, waves: 9, normals: 4, ripples: [0, 1, 4], lean: false, land: 6, stride: 2.9, probe: true, shore: 1024, relief: true, clouds: true, caustics: false, lamps: 6, piers: 8, tails: 4, shed: { land: 4, stride: 3.8 } },
  high: { segments: 160, displace: true, waves: WAVES.length, normals: 4, ripples: [0, 1, 2, 3, 4], lean: false, land: 8, stride: 2.2, probe: false, shore: 1024, relief: true, clouds: true, caustics: true, lamps: 6, piers: 8, tails: 4, shed: { land: 4, stride: 3.8 } },
};

/**
 * The water's own numbers. Colours are linear albedos (what comes back out, lit by whatever light the time of day
 * has) unless said otherwise.
 */
export const SEA_LOOK = {
  /** open water's body where no time of day names its own (byTime) */
  deep: [0.0028, 0.013, 0.036],
  /**
   * What a metre of depth takes out of the light that goes down to the bed and comes back (1/m, red, green, blue):
   * clear coastal water. Red is gone in two or three metres (sand turns green, then turquoise), green in twenty.
   */
  absorb: [0.42, 0.085, 0.058],
  /** the bed: wet pale sand, and the reef, rock and weed that lie on it in patches */
  sand: [0.4, 0.36, 0.27],
  reef: [0.035, 0.045, 0.03],
  /** water whipped full of bubbles under the surf: a milky pale turquoise; `surf`: the water between the lines of surf */
  milk: [0.2, 0.36, 0.35],
  surfBody: [0.09, 0.3, 0.32],
  /** the light that comes through the top of a wave towards the eye, per unit of the sun's */
  scatter: [0.0, 0.0045, 0.0036],
  foam: [0.78, 0.81, 0.82],
  /** the calm surface's roughness, and the slope variance of the capillary ripples no layer draws (in a gust) */
  rough: 0.045,
  capillary: 0.003,
  /**
   * The wind ripples: layers of one tiling normal map. `repeat`: metres per repeat (its waves are an eighth of that
   * and shorter); `turn`: degrees it is turned; `rms`: its slopes' root mean square in a gust; `drift`: m/s downwind;
   * `off`: degrees its drift is turned off the wind.
   */
  ripples: [
    { repeat: 3.1, turn: 17, rms: 0.075, drift: 0.32, off: 12 },
    { repeat: 8.3, turn: -31, rms: 0.085, drift: 0.55, off: -9 },
    { repeat: 23, turn: 52, rms: 0.08, drift: 0.95, off: 6 },
    { repeat: 61, turn: -9, rms: 0.06, drift: 1.5, off: -4 },
    // the breeze's chop (21 m and shorter), which a handful of sines would draw as ruled lines
    { repeat: 173, turn: 71, rms: 0.055, drift: 2.4, off: 3 },
  ],
  /**
   * The wind: where it blows towards (degrees, 0 = +X, 90 = +Z, as WAVES' directions), how rough the water is
   * between gusts (a share of a gust's ripples), in a slick, and in the lee of land; how fast the gusts drift (m/s).
   */
  wind: { dir: 10, calm: 0.28, slick: 0.5, lee: 0.45, speed: 3.2 },
  /** how far the disc reaches (m): the horizon. The views' far plane is nearer; see the header. */
  horizon: 14000,
  /** a spark of the sun's glitter is this many times the sun's irradiance bright; `far`: the share of the breaking-up kept far out */
  glint: { radiance: 1.6, far: 0.45 },
  /**
   * Surf on a shelving shore. Lines `spacing` m apart come in every `period` s where the bed is less than `depth` m
   * down and no further than `reach` m out; `height`: the crest's height (m) for the relief of its normal. The
   * sheet runs `runup` m up over the still level and back.
   */
  surf: { spacing: 6.5, period: 4.6, depth: 1.25, reach: 46, height: 0.34, runup: 0.16 },
  /** what land looks like in the water (a dark wooded or rocky coast's albedo; lit by the time of day's light) */
  land: [0.1, 0.115, 0.08],
  /** and a concrete pier; `reach`: piers further from the eye than this (m) are left to the haze */
  pier: { albedo: [0.33, 0.32, 0.3], reach: 700 },
  /**
   * Per time of day, by name: `sky`, how much of the mirrored sky the water gives back (an art control over the
   * mirror's physics, 1: all of it); `deep`, the open water's body; `wind`, the sea state: how strong the ripples are
   * (1: a breeze; evenings are calmer). A time not named keeps 1, `deep` and 1.
   */
  byTime: {
    day: { sky: 0.82, deep: [0.006, 0.028, 0.07], wind: 1 },
    dusk: { sky: 0.6, deep: [0.0016, 0.0105, 0.0115], wind: 0.75 },
    // after the sun: the water dark and deep, the afterglow given back a little brighter than golden hour's
    // (frame K5's water reads 31 50 95: a still of ours read 13 16 43 with 0.55 and [0.0012, 0.006, 0.012])
    twilight: { sky: 0.8, deep: [0.002, 0.011, 0.024], wind: 0.6 },
    night: { sky: 1, wind: 0.7 },
  },
  /**
   * at night: lamps' streaks, across and along (radians, about), and their share of the head's radiance; a tail lamp's
   * radiance (the brake lamps `brake` times as much again), its colour, and the distance (m) at which its streak is half
   */
  lamp: { across: 0.012, along: 0.22, gain: 0.06, tail: 14, brake: 3, tailColor: [1.0, 0.03, 0.015], tailReach: 70 },
  /** the planar mirror (high): nothing in it is brighter than this many whites of the picture (the sun's disc is the light's own glitter) */
  mirrorCap: 4,
};

/**
 * What other materials need to read the sea map (the ground: its coastal rock and the gravel beside the coast road):
 * the map, and its box (x0, z0, 1 / extent, the water's level). One set per page, as the bake's uniforms are; createSea
 * fills it. `uSeaShore` is the shore map (seaShore.js; the same box) and `uSeaTime` the waves' clock, for whoever
 * wants to know where the water's edge is now (SEA_SHORE_GLSL).
 */
export const SEA_UNIFORMS = {
  uSeaMap: { value: /** @type {THREE.Texture | null} */ (null) },
  uSeaBox: { value: new THREE.Vector4(0, 0, 1e-6, -1e4) },
  /** (round 4) the volcano's island, for the ground's colours on it: x, z, its foot's radius, its rim's height (radius 0: none) */
  uVolcano: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSeaShore: { value: /** @type {THREE.Texture | null} */ (null) },
  uSeaTime: { value: 0 },
};

/** GLSL: reading the sea map. seaMapAt(xz): r depth, g land's distance from the water, b water's from the land, a sea. */
export const SEA_MAP_GLSL = /* glsl */ `
uniform sampler2D uSeaMap;
uniform vec4 uSeaBox;
uniform vec4 uVolcano;
vec4 seaMapAt( vec2 p ) {
  return texture2D( uSeaMap, ( p - uSeaBox.xy ) * uSeaBox.z );
}
// metres: the water's depth, the land's distance from the water (to 500), the water's from the land (to 160)
float seaDepth( vec4 m ) { return 64.0 * m.r * m.r; }
float seaLandOff( vec4 m ) { return 500.0 * m.g; }
float seaShoreOff( vec4 m ) { return 160.0 * m.b; }
`;

const f = (x, digits = 4) => {
  const s = x.toFixed(digits);
  return s.includes('.') ? s : `${s}.0`;
};
const v3 = (c) => `vec3( ${c.map((x) => x.toFixed(5)).join(', ')} )`;

/**
 * GLSL: reading the shore map, and where the water's edge is on a beach at this moment. For either stage of any
 * material that carries SEA_UNIFORMS (after SEA_MAP_GLSL, which declares uSeaBox):
 *   shoreAt(xz)        the map's texel: r depth, g distance to the shoreline, b the land's height, a sand
 *   shoreDepth, shoreDist, shoreLand   metres from those channels
 *   seaSurfBeat(xz, t) the surf's phase at a place, in periods: lines of surf and the sheet on the sand share it
 *   seaSheet(xz, t)    metres the water's edge stands over the still level right now (the sheet running up a
 *                      beach and draining back); never more than SEA_SHEET_TOP, which is how high sand gets wet
 */
export const SEA_SHORE_GLSL = /* glsl */ `
uniform sampler2D uSeaShore;
uniform float uSeaTime;
#define SEA_SHEET_TOP ${f(SEA_LOOK.surf.runup)}
vec4 shoreAt( vec2 p ) {
  return texture2D( uSeaShore, ( p - uSeaBox.xy ) * uSeaBox.z );
}
float shoreDepth( vec4 m ) { return ${f(SHORE.depth, 1)} * m.r * m.r; }
float shoreDist( vec4 m ) { return ${f(SHORE.reach + SHORE.inland, 1)} * m.g * m.g - ${f(SHORE.inland, 1)}; }
float shoreLand( float b ) { return ${f(SHORE.land, 1)} * b * b; }
float seaSurfBeat( vec2 p, float t ) {
  // along the shore the lines do not arrive all at once: a slow wander of the phase (two crossed sines, 60 to 100 m long)
  return t * ${f(1 / SEA_LOOK.surf.period)} + 0.6 * sin( p.x * 0.071 + 1.3 * sin( p.y * 0.043 ) ) + 0.5 * sin( p.y * 0.063 + 1.7 * sin( p.x * 0.037 ) );
}
float seaSheet( vec2 p, float t ) {
  // up quickly as a line of surf arrives, back slowly
  float u = fract( seaSurfBeat( p, t ) - 0.08 );
  return SEA_SHEET_TOP * ( u < 0.3 ? smoothstep( 0.0, 0.3, u ) : 1.0 - smoothstep( 0.3, 1.0, u ) );
}
`;

/**
 * The share of the light from a bed `depth` m down that reaches an eye looking at the water at `cosView` to the
 * vertical (1: straight down), per channel: SEA_LOOK.absorb over the way down and the refracted way back. The shader
 * computes the same (SEA_SURFACE); here for tests and for fitting colours without a browser.
 * @param {number} depth @param {number} [cosView]
 * @returns {[number, number, number]}
 */
export function seaClarity(depth, cosView = 1) {
  const cosT = Math.sqrt(1 - (1 - cosView * cosView) / 1.777);
  const path = Math.max(0, depth) * 0.5 * (1 + 1 / cosT);
  return /** @type {[number, number, number]} */ (SEA_LOOK.absorb.map((k) => Math.exp(-k * path)));
}

/**
 * The water's body over a bed of albedo `bed`, `depth` m down: what comes back out of it as an albedo.
 * @param {number} depth @param {number[]} [bed] @param {number[]} [deep] @param {number} [cosView]
 * @returns {[number, number, number]}
 */
export function seaBody(depth, bed = SEA_LOOK.sand, deep = SEA_LOOK.deep, cosView = 1) {
  const t = seaClarity(depth, cosView);
  return /** @type {[number, number, number]} */ (t.map((ti, i) => deep[i] * (1 - ti) + bed[i] * ti));
}

/**
 * How strongly rough water mirrors at `cosView` to its mean normal, the slopes it is not drawn with having the
 * variance `variance` (both axes together): Bruneton's fit of the mean Fresnel factor of a Gaussian sea surface.
 * Calm water (variance 0) is Schlick's 0.02 + 0.98 (1 - cos)^5.
 * @param {number} cosView @param {number} variance
 */
export function seaMirror(cosView, variance) {
  const sigma = Math.sqrt(0.5 * variance);
  return 0.02 + (0.98 * Math.pow(1 - cosView, 5 * Math.exp(-2.69 * sigma))) / (1 + 22.7 * Math.pow(sigma, 1.5));
}

/**
 * A disc of rings round the origin in the XZ plane: ring spacing grows with the radius so the cells stay about
 * square (demo 01's createRadialGridGeometry).
 */
function radialGrid({ segments, inner, outer }) {
  const radii = [0];
  const growth = 1 + (Math.PI * 2) / segments;
  for (let r = inner; r < outer; r = Math.max(r + inner, r * growth)) radii.push(r);
  radii.push(outer);
  const rings = radii.length;
  const positions = new Float32Array((1 + (rings - 1) * segments) * 3);
  let p = 3;
  for (let i = 1; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      // every other ring turned half a step, so no long edges line up
      const a = ((s + (i % 2) * 0.5) / segments) * Math.PI * 2;
      positions[p++] = Math.cos(a) * radii[i];
      positions[p++] = 0;
      positions[p++] = Math.sin(a) * radii[i];
    }
  }
  const index = [];
  const start = (i) => 1 + (i - 1) * segments;
  for (let s = 0; s < segments; s++) index.push(0, start(1) + ((s + 1) % segments), start(1) + s);
  for (let i = 1; i < rings - 1; i++) {
    const a = start(i);
    const b = start(i + 1);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      if (i % 2 === 1) index.push(a + s, a + s1, b + s1, a + s, b + s1, b + s);
      else index.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * The bearings from the map's middle (degrees, atan2(z, x)) between which no open water lies beyond the views' far
 * plane: the mainland's, read off terrain.sea.sector 6 km out. [0, 0] if the sea is all round.
 */
function mainlandOf(sea) {
  const m = sea.map;
  const cx = m.x0 + m.extent / 2;
  const cz = m.z0 + m.extent / 2;
  let a0 = null;
  let a1 = null;
  for (let a = -180; a < 180; a += 1) {
    const land = sea.sector(cx + 6000 * Math.cos(a * DEG), cz + 6000 * Math.sin(a * DEG)) < 0.5;
    if (land && a0 === null) a0 = a;
    if (land) a1 = a;
  }
  return { x: cx, z: cz, from: a0 ?? 0, to: a1 ?? 0 };
}

/**
 * @typedef {object} Sea
 * @property {THREE.Mesh} mesh
 * @property {(time: import('./lighting.js').TimeOfDay) => void} setTime
 * @property {(simTime: number) => void} update the run's clock (fixed step)
 * @property {(shed: boolean) => void} setShed the quality ladder's `detail` rung, the water's share of it
 * @property {(cube: THREE.Texture | null) => void} setProbe the car's reflection probe for the next view (or null)
 * @property {(at: THREE.Vector3) => boolean} mirrored whether the planar mirror is worth drawing for an eye there
 * @property {(beams: Array<object> | null | undefined) => void} setBeams the cars' lamps (their tail lamps streak in the water)
 * @property {(piers: Array<{ x: number, z: number, r: number, top: number }>) => void} setPiers what stands in the
 *   water on a footing of its own (the viaducts' piers): where, half its width, its top's height (m, world)
 * @property {(camera: THREE.Camera, viewHeight?: number) => void} prepareView centres the disc on the eye, sets the
 *   waves' reach for its height and the size of a pixel (`viewHeight`: the view's height in pixels)
 * @property {object} stats
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('./terrain.js').SeaShape} options.sea where the water is (terrain.sea)
 * @param {(x: number, z: number) => number} options.heightAt the land's height (terrain.heightAt): the bed and the shore
 * @param {number} options.far the view's far plane (m)
 * @param {{ pos: { value: THREE.Vector4[] }, color: { value: THREE.Vector3[] } }} [options.glints] the nearest lit
 *   lamps' heads, filled per view by lamps.js (the wet road's)
 * @param {import('../../engine/PlanarMirror.js').PlanarMirror | null} [options.mirror] a mirror in the water's level,
 *   which whoever owns the scene draws before each view where `mirrored()` says so (world/index.js; high)
 * @param {string | null} [options.detail] a name of SEA_TIERS instead of the tier's own (a quality ladder's choice)
 * @returns {Sea}
 */
export function createSea({ caps, tier, atmosphere, sea, heightAt, far, glints = null, mirror = null, detail = null }) {
  const name = SEA_TIERS[detail] ? detail : tier === 'medium' && caps.mobile ? 'mobile' : SEA_TIERS[tier] ? tier : 'medium';
  const spec = SEA_TIERS[name];
  const outer = SEA_LOOK.horizon;
  const waves = createWaveField({ count: spec.waves, segments: spec.displace ? spec.segments : 0, normals: spec.normals });
  // (round 2) the big swell off the low crossing (terrain.js CAUSEWAY.surf, waves.js BOOST)
  waves.setBoost(sea.surf ?? null);
  // (low: a few rings only; the cells need not be square where nothing moves them)
  const geometry = radialGrid({ segments: spec.segments, inner: spec.displace ? 1.2 : outer / 6, outer });
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer);

  // the sea map, as a texture (terrain.js made its texels)
  const m = sea.map;
  const map = new THREE.DataTexture(m.data, m.size, m.size, THREE.RGBAFormat);
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
  SEA_UNIFORMS.uSeaMap.value = map;
  SEA_UNIFORMS.uSeaBox.value.set(m.x0, m.z0, 1 / m.extent, sea.level);

  // the shore map (seaShore.js), with its own mip levels (the land's channel keeps the highest)
  const baked = bakeShoreMap({ sea, heightAt, size: spec.shore });
  const shore = new THREE.DataTexture(baked.levels[0], baked.size, baked.size, THREE.RGBAFormat);
  shore.mipmaps = baked.levels.map((data, i) => ({ data, width: baked.size >> i, height: baked.size >> i }));
  shore.generateMipmaps = false;
  shore.minFilter = THREE.LinearMipmapLinearFilter;
  shore.magFilter = THREE.LinearFilter;
  shore.wrapS = shore.wrapT = THREE.ClampToEdgeWrapping;
  shore.colorSpace = THREE.NoColorSpace;
  shore.needsUpdate = true;
  SEA_UNIFORMS.uSeaShore.value = shore;

  const anisotropy = Math.min(8, caps.maxAnisotropy ?? 1);
  const rippleSize = 256;
  const ripples = normalTexture(rippleSize, gradientField(rippleSize, { seed: 71, cells: 8, octaves: 4 }), { relief: 0.06, anisotropy });
  // the map's own slopes, measured: mean of x^2 + y^2 over its texels (what a layer's `rms` is scaled against)
  let rippleVar = 0;
  {
    const d = ripples.image.data;
    for (let k = 0; k < d.length; k += 4) rippleVar += (d[k] / 127.5 - 1) ** 2 + (d[k + 1] / 127.5 - 1) ** 2;
    rippleVar /= d.length / 4;
  }
  // one noise for everything slow or lacy: r bubbles (cells), g threads (0 on the cells' edges), b a soft field, a a
  // softer, larger one
  const fs = 256;
  const noise = fieldTexture(
    fs,
    [
      worleyField(fs, { seed: 81, cells: 18 }),
      worleyField(fs, { seed: 82, cells: 9, mode: 'edge' }),
      valueField(fs, { seed: 83, cells: 6, octaves: 4 }),
      valueField(fs, { seed: 84, cells: 3, octaves: 3 }),
    ],
    { anisotropy },
  );

  const mainland = mainlandOf(sea);
  const wind = SEA_LOOK.wind;
  const uniforms = {
    ...waves.uniforms,
    uSeaCentre: { value: new THREE.Vector3(0, sea.level, 0) },
    // x: where the views' far plane cuts the disc (m), y: the disc's edge (m), z: radians a pixel covers, w: 1 / shore map's size
    uSeaView: { value: new THREE.Vector4(far * 0.97, outer, 0.0012, 1 / baked.size) },
    uSeaMainland: { value: new THREE.Vector4(mainland.x, mainland.z, mainland.from, mainland.to) },
    uSeaSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSeaSun: { value: new THREE.Vector3() },
    uSeaSky: { value: 1 },
    uSeaGain: { value: 1 },
    uSeaDeep: { value: new THREE.Vector3().fromArray(SEA_LOOK.deep) },
    // x, y: where the wind blows towards (x, z); z: the sea state (SEA_LOOK.byTime.wind); w: how much shade the clouds lay
    uSeaWind: { value: new THREE.Vector4(Math.cos(wind.dir * DEG), Math.sin(wind.dir * DEG), 1, 0) },
    uSeaLandTint: { value: new THREE.Vector3() },
    // a concrete pier under the sky, and what the sun adds on a face square to it
    uSeaPierTint: { value: new THREE.Vector3() },
    uSeaPierSun: { value: new THREE.Vector3() },
    // the nearest piers standing in the water: x, z, half their width, their top over the water (0: none)
    uSeaPier: { value: Array.from({ length: spec.piers }, () => new THREE.Vector4()) },
    // the sky where there is no environment map: straight up, and at the horizon
    uSeaZenith: { value: new THREE.Vector3() },
    uSeaHorizon: { value: new THREE.Vector3() },
    uRipple: { value: ripples },
    uSeaNoise: { value: noise },
    uSeaGlintPos: glints ? glints.pos : { value: [] },
    uSeaGlintColor: glints ? glints.color : { value: [] },
    // the cars' tail lamps: where, and how bright (0: none)
    uSeaTail: { value: Array.from({ length: spec.tails }, () => new THREE.Vector4()) },
    // the planar mirror's brightest (scene units)
    uSeaMirrorCap: { value: 1 },
    // the car's reflection probe (the game's, per view) and whether there is one now
    uSeaProbe: { value: /** @type {THREE.CubeTexture | null} */ (null) },
    uSeaProbeOn: { value: 0 },
    // the ladder's `detail` rung: 1 while it is shed; the march's steps and stride as they are now
    uSeaShed: { value: 0 },
    uSeaMarch: { value: new THREE.Vector2(spec.land, spec.stride) },
    ...(mirror ? mirror.uniforms : {}),
  };
  const lamps = glints ? Math.min(spec.lamps, glints.pos.value.length) : 0;

  // the ripple layers as GLSL: each layer's sample, its slopes turned back into the world, what it stops drawing
  const layerCode = [];
  let undrawn = SEA_LOOK.capillary;
  SEA_LOOK.ripples.forEach((layer, i) => {
    if (!spec.ripples.includes(i)) {
      // a layer this tier does not draw is still on the water: its slopes are part of the roughness
      undrawn += layer.rms * layer.rms;
      return;
    }
    const c = Math.cos(layer.turn * DEG);
    const s = Math.sin(layer.turn * DEG);
    // the drift, downwind and a little off it, in the layer's own turned frame
    const da = (wind.dir + layer.off) * DEG;
    const dx = (Math.cos(da) * c + Math.sin(da) * s) * layer.drift;
    const dz = (-Math.cos(da) * s + Math.sin(da) * c) * layer.drift;
    const amp = layer.rms / Math.sqrt(rippleVar);
    // a layer the leanest level does not draw goes (into the roughness) while the ladder's rung is shed
    const always = SEA_TIERS.mobile.ripples.includes(i);
    layerCode.push(/* glsl */ `
  ${always ? '' : `if ( uSeaShed > 0.5 ) sRipLost += ${f(layer.rms * layer.rms, 5)}; else`} {
    vec2 uv = vec2( ${f(c)} * vSeaBase.x + ${f(s)} * vSeaBase.y, ${f(-s)} * vSeaBase.x + ${f(c)} * vSeaBase.y ) * ${f(1 / layer.repeat, 5)} - sT * vec2( ${f(dx / layer.repeat, 5)}, ${f(dz / layer.repeat, 5)} );
    vec2 n = texture2D( uRipple, uv ).xy * 2.0 - 1.0;
    // its waves are ${f(layer.repeat / 8, 2)} m and shorter: drawn while a pixel is smaller than a part of one
    float keep = 1.0 - smoothstep( ${f(layer.repeat * 0.02, 3)}, ${f(layer.repeat * 0.09, 3)}, sAlong );
    sRip += vec2( ${f(c)} * n.x - ${f(s)} * n.y, ${f(s)} * n.x + ${f(c)} * n.y ) * ( ${f(amp)} * keep );
    sRipLost += ${f(layer.rms * layer.rms, 5)} * ( 1.0 - keep * keep );
  }`);
  });

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: SEA_LOOK.rough, metalness: 0 });
  material.name = 'sea';
  extend(material, `sea-${name}`, (shader) => {
    Object.assign(shader.uniforms, uniforms, SEA_UNIFORMS);
    const defines = [
      spec.displace ? '#define SEA_DISPLACE' : '',
      `#define SEA_LAND ${spec.land}`,
      spec.relief ? '#define SEA_RELIEF' : '',
      spec.clouds ? '#define SEA_CLOUDS' : '',
      spec.caustics ? '#define SEA_CAUSTICS' : '',
      spec.lean ? '#define SEA_LEAN' : '',
      spec.probe ? '#define SEA_PROBE' : '',
      `#define SEA_LAMPS ${lamps}`,
      `#define SEA_PIERS ${spec.piers}`,
      `#define SEA_TAILS ${spec.tails}`,
      mirror ? '#define SEA_MIRROR' : '',
      // the shore map's level whose texels are about 300 m: "is there land hereabouts"
      `#define SEA_LEE_LOD ${f(Math.log2(baked.size) - 4, 1)}`,
      `#define SEA_SHORE_SIZE ${f(baked.size, 1)}`,
    ].join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defines}\n${waves.glsl}\n${SEA_MAP_GLSL}\n${SEA_SHORE_GLSL}\n${SEA_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', SEA_VERTEX)
      // beyond the views' far plane the water stays just inside the depth range, in front of far.js's ridges
      .replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position.z = min( gl_Position.z, gl_Position.w * ( 1.0 - 2.0e-6 ) );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defines}\n${GLSL_HASH}\n${spec.probe ? GLSL_PROBE : ''}\n${waves.glsl}\n${SEA_MAP_GLSL}\n${SEA_SHORE_GLSL}\n${SEA_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', seaSurface().replace('/*RIPPLES*/', layerCode.join('\n')).replace('/*UNDRAWN*/', f(undrawn, 5)))
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = seaRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize( ( viewMatrix * vec4( seaN, 0.0 ) ).xyz );')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularColor = vec3( mix( 0.02, 0.04, seaFoam ) );\nmaterial.specularColorBlended = material.specularColor;',
      )
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${seaLight()}`)
      .replace('#include <opaque_fragment>', `${SEA_HORIZON}\n#include <opaque_fragment>`);
  });
  atmosphere.patch(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sea';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  // after the opaque scenery, so that what the land hides is not shaded
  mesh.renderOrder = 5;

  let time = 0;
  const eye = new THREE.Vector3();
  /** @type {Array<{ x: number, z: number, r: number, top: number, d: number }>} the piers that stand in the water */
  let piers = [];
  return {
    mesh,
    /**
     * The quality ladder's `detail` rung (engine/caps.js LADDER; World.setDetail): shed, the water keeps its colour, its glitter, its
     * surf and its nearest reflections and gives up the rest (SEA_TIERS' `shed`). No shader is compiled.
     */
    setShed(shed) {
      const on = !!shed && !!spec.shed;
      uniforms.uSeaShed.value = on ? 1 : 0;
      uniforms.uSeaMarch.value.set(on ? spec.shed.land : spec.land, on ? spec.shed.stride : spec.stride);
    },
    /** Whether there is water for the mirror to be seen in from `at` (an eye): within reach of the sea, above it. */
    mirrored(at) {
      if (uniforms.uSeaShed.value > 0.5 || at.y < sea.level + 0.4) return false;
      const i = Math.floor(((at.x - m.x0) / m.extent) * m.size);
      const j = Math.floor(((at.z - m.z0) / m.extent) * m.size);
      if (i < 0 || j < 0 || i >= m.size || j >= m.size) return true;
      // the sea map's g: the land's distance from the water, 255 at 500 m and more
      return m.data[(j * m.size + i) * 4 + 1] < 250;
    },
    /**
     * The car's reflection probe for the view about to be drawn (its prefiltered cube), or null: what stands beyond
     * the shore map (the far massif, the ridges) is mirrored from it on the tiers that have no planar mirror.
     */
    setProbe(cube) {
      uniforms.uSeaProbe.value = cube ?? null;
      uniforms.uSeaProbeOn.value = cube && spec.probe ? 1 : 0;
    },
    /** The cars' lamps (World.prepareView's `beams`): their tail lamps streak in the water at night. */
    setBeams(beams) {
      const tails = uniforms.uSeaTail.value;
      for (let k = 0; k < tails.length; k++) {
        const b = beams?.[k >> 1];
        const power = b?.tailL ? SEA_LOOK.lamp.tail * ((b.tail ?? 0) + SEA_LOOK.lamp.brake * (b.brake ?? 0)) : 0;
        if (power > 0) tails[k].set(...(k & 1 ? b.tailR : b.tailL).toArray(), power);
        else tails[k].set(0, 0, 0, 0);
      }
    },
    setPiers(list) {
      piers = list.filter((p) => heightAt(p.x, p.z) < sea.level && p.top > sea.level).map((p) => ({ x: p.x, z: p.z, r: p.r, top: p.top - sea.level, d: 0 }));
    },
    setTime(t) {
      const sunE = t.sun.color.map((c) => c * t.sun.intensity);
      uniforms.uSeaSunDir.value.fromArray(t.sun.dir).normalize();
      uniforms.uSeaSun.value.fromArray(sunE);
      // the scene's environment map is the sky's light on things, set apart from the sky as drawn (env.intensity);
      // a mirror shows the sky as drawn
      uniforms.uSeaSky.value = 1 / Math.max(0.05, t.env.intensity);
      const own = SEA_LOOK.byTime[t.name] ?? {};
      uniforms.uSeaGain.value = own.sky ?? 1;
      uniforms.uSeaDeep.value.fromArray(own.deep ?? SEA_LOOK.deep);
      uniforms.uSeaWind.value.z = own.wind ?? 1;
      // clouds shade the water where the sun is a light and the sky has clouds to speak of
      const cover = t.sky.clouds?.cover ?? 0;
      uniforms.uSeaWind.value.w = t.sun.intensity > 0 ? Math.min(1, cover * 1.6) : 0;
      // land in the water's mirror: a dark coast under this sky and this sun (half of it taken to be in shade)
      const up = Math.max(0, uniforms.uSeaSunDir.value.y);
      for (let i = 0; i < 3; i++) {
        const sky = 0.5 * (t.sky.zenith[i] + t.sky.horizon[i]) * 0.7 + (t.ambient.sky[i] * t.ambient.intensity) / Math.PI;
        const sun = (0.5 * sunE[i] * (0.25 + 0.75 * up)) / Math.PI;
        uniforms.uSeaLandTint.value.setComponent(i, SEA_LOOK.land[i] * (sky + sun));
        uniforms.uSeaPierTint.value.setComponent(i, SEA_LOOK.pier.albedo[i] * sky);
        uniforms.uSeaPierSun.value.setComponent(i, (SEA_LOOK.pier.albedo[i] * sunE[i]) / Math.PI);
      }
      uniforms.uSeaMirrorCap.value = SEA_LOOK.mirrorCap / t.exposure;
      uniforms.uSeaZenith.value.fromArray(t.sky.zenith);
      uniforms.uSeaHorizon.value.fromArray(t.sky.horizon);
    },
    update(simTime) {
      time = simTime;
    },
    prepareView(camera, viewHeight = 720) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      uniforms.uSeaCentre.value.set(eye.x, sea.level, eye.z);
      // a pixel's angle, for whatever must fade as it shrinks under one (a perspective camera's; else a guess)
      const fov = /** @type {any} */ (camera).isPerspectiveCamera ? /** @type {any} */ (camera).fov : 50;
      uniforms.uSeaView.value.z = (2 * Math.tan(0.5 * fov * DEG)) / Math.max(64, viewHeight);
      SEA_UNIFORMS.uSeaTime.value = time;
      waves.update(time, eye.y - sea.level);
      // the piers nearest this eye
      for (const p of piers) p.d = Math.hypot(p.x - eye.x, p.z - eye.z);
      piers.sort((a, b) => a.d - b.d);
      uniforms.uSeaPier.value.forEach((u, i) => {
        const p = piers[i];
        if (p && p.d < SEA_LOOK.pier.reach) u.set(p.x, p.z, p.r, p.top);
        else u.set(0, 0, 0, 0);
      });
    },
    /** (for the lab) the material's own uniforms */
    uniforms,
    stats: { detail: name, triangles: geometry.index.count / 3, waves: waves.count, shore: baked.stats, shoreSize: baked.size, piers: () => piers.length },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
      shore.dispose();
      ripples.dispose();
      noise.dispose();
      SEA_UNIFORMS.uSeaMap.value = null;
      SEA_UNIFORMS.uSeaShore.value = null;
    },
  };
}

const SEA_VERTEX_PARS = /* glsl */ `
uniform vec3 uSeaCentre;   // xz: the eye, y: the water's level
uniform vec4 uSeaView;     // where the far plane cuts the disc, the disc's edge, a pixel's angle, 1 / shore map's size
uniform vec4 uSeaMainland; // the map's middle (x, z) and the bearings (degrees) between which the mainland lies
varying vec3 vSeaWorld;
varying vec2 vSeaBase;     // where the point lies on the undisturbed water
`;

const SEA_VERTEX = /* glsl */ `
vec2 seaOff = position.xz;
float seaR = length( seaOff );
if ( seaR > uSeaView.x ) {
  // beyond the views' far plane there is water only where the open sea is: towards the mainland the disc ends
  // where it always did (far.js's ridges stand there)
  vec2 w = seaOff + uSeaCentre.xz - uSeaMainland.xy;
  float a = degrees( atan( w.y, w.x ) );
  float land = smoothstep( uSeaMainland.z - 12.0, uSeaMainland.z, a ) * ( 1.0 - smoothstep( uSeaMainland.w, uSeaMainland.w + 12.0, a ) );
  if ( uSeaMainland.z == uSeaMainland.w ) land = 0.0;
  seaOff *= mix( 1.0, uSeaView.x / seaR, land );
}
vec2 seaBase = seaOff + uSeaCentre.xz;
vec3 transformed = vec3( seaBase.x, uSeaCentre.y, seaBase.y );
#ifdef SEA_DISPLACE
{
  vec4 sm = textureLod( uSeaShore, ( seaBase - uSeaBox.xy ) * uSeaBox.z, 0.0 );
  // the swell dies down over the shallows
  float calm = 0.35 + 0.65 * smoothstep( 0.0, 14.0, shoreDepth( sm ) );
  transformed += waveDisplace( seaBase, calm, length( seaOff ) );
  // the sheet of water that runs up a beach and drains back: the water's edge rises and falls with the surf
  transformed.y += seaSheet( seaBase, uWaveTime ) * ( 1.0 - smoothstep( 2.0, 26.0, shoreDist( sm ) ) );
}
#endif
vSeaBase = seaBase;
vSeaWorld = transformed;
`;

const SEA_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSeaCentre;
uniform vec4 uSeaView;
uniform vec3 uSeaSunDir;
uniform vec3 uSeaSun;      // the sun's (or the moon's) colour times its intensity
uniform float uSeaSky;     // what turns the environment map's light on things back into the sky as drawn
uniform float uSeaGain;    // how much of the mirrored sky the water gives back at this time of day (SEA_LOOK.byTime)
uniform vec3 uSeaDeep;     // the open water's body at this time of day
uniform vec4 uSeaWind;     // where the wind blows towards (x, z), the sea state, the clouds' shade
uniform float uSeaShed;    // 1 while the quality ladder's detail rung is shed
uniform vec2 uSeaMarch;    // the mirrored ray's steps over the land, and how much longer each is than the last
uniform vec3 uSeaLandTint; // land as the water mirrors it (a radiance)
uniform vec3 uSeaPierTint; // and a concrete pier: under the sky,
uniform vec3 uSeaPierSun;  // and what the sun adds on a face square to it
#if SEA_PIERS > 0
uniform vec4 uSeaPier[ SEA_PIERS ]; // x, z, half its width, its top over the water (0: none)
#endif
uniform vec3 uSeaZenith;
uniform vec3 uSeaHorizon;
uniform sampler2D uRipple;
uniform sampler2D uSeaNoise; // r bubbles, g threads (0 on the cells' edges), b a soft field, a a larger one
#if SEA_LAMPS > 0
uniform vec4 uSeaGlintPos[ SEA_LAMPS ];
uniform vec3 uSeaGlintColor[ SEA_LAMPS ];
#endif
#if SEA_TAILS > 0
uniform vec4 uSeaTail[ SEA_TAILS ];
#endif
#ifdef SEA_PROBE
uniform samplerCube uSeaProbe;    // the car's reflection probe (prefiltered), for the land beyond the shore map
uniform float uSeaProbeOn;
#endif
#if defined( SEA_MIRROR ) || defined( SEA_PROBE )
uniform float uSeaMirrorCap;
#endif
#ifdef SEA_MIRROR
uniform sampler2D uMirrorTex;     // the scene from the eye mirrored in the water's level (PlanarMirror)
uniform sampler2D uMirrorStreak;  // and drawn out towards the eye
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
#endif
varying vec3 vSeaWorld;
varying vec2 vSeaBase;
vec3 seaN;        // the surface's normal (world)
float seaRough;
float seaVar;     // the variance of the slopes this pixel does not draw (both axes together)
float seaF;       // how much the surface mirrors here (the mean Fresnel of rough water)
float seaFoam;
float seaFoot;    // metres of water a pixel covers (the geometric mean of across and along the line of sight)
float seaShade;   // 0..1 the sun's light the clouds let through here
float seaLee;     // 0..1 land hereabouts
vec3 seaScatter;  // light through the waves' tops, added after the lights

// A lamp in the water: a lobe about the mirrored view R, narrow across the plane of incidence (A) and long in it (B),
// widened by W. to: from the surface to the lamp.
float seaStreak( vec3 to, vec3 R, vec3 A, vec3 B, float W ) {
  vec3 toLamp = normalize( to );
  // (only about the mirrored direction: a lamp behind the reflected ray projects onto nothing)
  float facing = dot( toLamp, R );
  if ( facing < 0.8 ) return 0.0;
  vec3 dev = toLamp - R;
  float x = dot( dev, A ) / ( ${SEA_LOOK.lamp.across.toFixed(3)} * W );
  float y = dot( dev, B ) / ( ${SEA_LOOK.lamp.along.toFixed(3)} * W );
  return exp( - x * x - y * y ) * smoothstep( 0.8, 0.95, facing ) / W;
}

// A spark of the sun's glitter: cells of the water flash for a share q of their own beat. Mean 1 over space and time.
float seaSpark( vec2 p, float t, float q ) {
  vec2 cell = floor( p );
  vec2 off = fract( p ) - 0.5;
  float h = hash12( cell );
  float beat = fract( h + t * ( 0.55 + 0.9 * fract( h * 7.31 ) ) );
  float lit = smoothstep( 1.0 - q - 0.03, 1.0 - q + 0.03, beat ) + step( 0.97, q );
  // a spark is a point, not a tile (the disc's mean over its cell is 0.27)
  float disc = 1.0 - smoothstep( 0.12, 0.46, length( off ) );
  return min( lit, 1.0 ) * mix( disc / 0.27, 1.0, smoothstep( 0.5, 1.0, q ) ) / max( q, 0.02 );
}
`;

const S = SEA_LOOK.surf;
const windAlong = `vec2( dot( vSeaBase, uSeaWind.xy ), dot( vSeaBase, vec2( - uSeaWind.y, uSeaWind.x ) ) )`;

/**
 * GLSL (in place of map_fragment): the normal, the roughness, the body and the white water. (A function, as seaLight
 * is: the text is made from SEA_LOOK when a sea is made, so that the lab can try other numbers.)
 */
const seaSurface = () => /* glsl */ `
vec3 sToEye = cameraPosition - vSeaWorld;
float sDist = length( sToEye );
vec3 sV = sToEye / sDist;
float sT = uWaveTime;

// ---- a pixel's footprint on the water: across the line of sight, and along it (long, at a glancing angle)
float sAcross = sDist * uSeaView.z;
float sAlong = sAcross / max( abs( sV.y ), 0.02 );
seaFoot = sqrt( sAcross * sAlong );

// ---- the shore map: the bed, the shoreline, the land (outside its box: open deep water)
vec2 sUv = ( vSeaBase - uSeaBox.xy ) * uSeaBox.z;
float sIn = step( abs( sUv.x - 0.5 ), 0.5 ) * step( abs( sUv.y - 0.5 ), 0.5 );
vec4 sMap = texture2D( uSeaShore, sUv );
float sDepth = mix( ${f(SHORE.depth, 1)}, shoreDepth( sMap ), sIn );
float sShore = mix( ${f(SHORE.reach, 1)}, shoreDist( sMap ), sIn );
float sSand = sMap.a;
// the water over the bed here: the still depth, less the land where this is the sheet on a beach, plus how far the
// swell and the sheet have lifted the surface. (The land only close to: the map's coarser levels, which a far pixel
// reads, hold the highest land of their texels, for the mirror.)
float sThick = sDepth - shoreLand( sMap.b ) * sIn * ( 1.0 - smoothstep( 2.0, 4.0, sAlong ) ) + ( vSeaWorld.y - uSeaCentre.y );
// land hereabouts (the highest within some 300 m): its lee is calmer water
seaLee = sIn * smoothstep( 3.0, 40.0, shoreLand( textureLod( uSeaShore, sUv, SEA_LEE_LOD ).b ) );
// the swell dies down over the shallows; glassier close in
float sAmp = 0.35 + 0.65 * smoothstep( 0.0, 14.0, sDepth );

// ---- the wind: gusts (cat's paws) and slicks, slow fields long in the wind's direction, drifting with it
vec2 sWp = ${windAlong};
vec4 sN1 = texture2D( uSeaNoise, sWp * vec2( ${f(1 / 930, 6)}, ${f(1 / 270, 6)} ) - vec2( sT * ${f(SEA_LOOK.wind.speed / 930, 6)}, 0.0 ) );
float sGust = smoothstep( 0.32, 0.68, sN1.a );
float sSlick = 0.0;
#ifndef SEA_LEAN
if ( uSeaShed < 0.5 ) {
  vec4 sN2 = texture2D( uSeaNoise, vec2( 0.921 * sWp.x + 0.391 * sWp.y, - 0.391 * sWp.x + 0.921 * sWp.y ) * vec2( ${f(1 / 330, 6)}, ${f(1 / 95, 6)} ) - vec2( sT * ${f((SEA_LOOK.wind.speed * 0.8) / 330, 6)}, 0.0 ) + 0.43 );
  sGust = smoothstep( 0.32, 0.68, 0.6 * sN1.a + 0.4 * sN2.b );
  // slicks: long narrow bands of glassy water lying downwind (windrows), here and there: the soft noise drawn out
  // forty to one; they wander (the gusts' own field pushes them sideways)
  sSlick = smoothstep( 0.6, 0.72, texture2D( uSeaNoise, ( sWp + vec2( 0.0, 60.0 * sN2.a + 25.0 * sN1.b ) ) * vec2( ${f(1 / 760, 6)}, ${f(1 / 19, 5)} ) - vec2( sT * ${f((SEA_LOOK.wind.speed * 0.5) / 760, 6)}, 0.0 ) + 0.71 ).b ) * ( 1.0 - 0.6 * sGust );
}
#endif
// how rough the water is, as a share of a gust's ripples
float sWind = uSeaWind.z * mix( ${f(SEA_LOOK.wind.calm)}, 1.0, sGust ) * mix( 1.0, ${f(SEA_LOOK.wind.slick)}, sSlick ) * mix( 1.0, ${f(SEA_LOOK.wind.lee)}, seaLee );
// and the shallow margin is glassier still
sWind *= 0.45 + 0.55 * smoothstep( 0.0, 1.5, sThick );
seaShade = 1.0;
#ifdef SEA_CLOUDS
// clouds' shade: slow, large, drifting (not the sky's own clouds: theirs have no place over the water)
if ( uSeaShed < 0.5 ) seaShade = 1.0 - uSeaWind.w * 0.55 * smoothstep( 0.5, 0.72, texture2D( uSeaNoise, vSeaBase * ${f(1 / 5200, 7)} - sT * vec2( ${f(6 / 5200, 6)}, ${f(2.5 / 5200, 6)} ) ).a );
#endif

// ---- the slopes: the waves', then the wind ripples in layers
vec3 sN;
float sJac;
float sLost;
waveNormal( vSeaBase, sAmp, sDist, sN, sJac, sLost );
vec2 sRip = vec2( 0.0 );
vec2 sRelief = vec2( 0.0 );
float sRipLost = /*UNDRAWN*/;
/*RIPPLES*/
// white water and the surf's own relief come next; they need the shore's direction
float sSlope = sDepth / max( sShore, 0.5 );                      // how steeply the bed falls away from the shore
float sGentle = 1.0 - smoothstep( 0.12, 0.38, sSlope );
// where the swell breaks on a shelving bed: from where it is SURF.depth under the water in to the edge
float sZone = ( 1.0 - smoothstep( ${f(0.6 * S.depth)}, ${f(S.depth)}, sDepth ) ) * ( 1.0 - smoothstep( ${f(0.6 * S.reach)}, ${f(S.reach)}, sShore ) ) * sIn * sGentle;
vec4 sLace = texture2D( uSeaNoise, vSeaBase * 0.11 + sT * vec2( 0.004, 0.002 ) );
vec4 sLace2 = texture2D( uSeaNoise, vSeaBase.yx * 0.31 + 0.37 - sT * vec2( 0.006, 0.003 ) );
// the line's place in its cycle: 0 at the front, growing seawards through the older water behind it
float sBeat = seaSurfBeat( vSeaBase, sT ) + ( sShore + ( sLace.b - 0.5 ) * 2.2 ) / ${f(S.spacing)};
float sU = fract( sBeat );
#ifdef SEA_RELIEF
if ( sZone > 0.02 && sAlong < 5.0 && uSeaShed < 0.5 ) {
  // which way the shore lies, from the map; the line's crest stands just behind its front, its face towards the land
  float e = 2.4 * uSeaBox.z;
  float s0 = shoreDist( textureLod( uSeaShore, sUv, 0.0 ) );
  vec2 g = vec2( shoreDist( textureLod( uSeaShore, sUv + vec2( e, 0.0 ), 0.0 ) ) - s0, shoreDist( textureLod( uSeaShore, sUv + vec2( 0.0, e ), 0.0 ) ) - s0 );
  g /= max( length( g ), 1.0e-4 );
  float w = ( sU - 0.07 ) / 0.06;
  float fall = - w * exp( - 0.5 * w * w ) * ${f(S.height / (0.06 * S.spacing))};
  sRelief = g * fall * sZone * ( 1.0 - smoothstep( 2.0, 5.0, sAlong ) );
}
#endif
sWind = max( sWind, 0.0 );
sN = normalize( sN + vec3( sRip.x, 0.0, sRip.y ) * sWind + vec3( sRelief.x, 0.0, sRelief.y ) );
seaVar = sLost + sRipLost * sWind * sWind;
// the sky that the water mirrors is above the horizon: a facet tipped so far that it would show the ground under
// the horizon shows the sky just over it instead (01's rule)
{
  vec3 R = reflect( - sV, sN );
  if ( R.y < 0.03 ) {
    R.y = 0.03 + 0.5 * ( 0.03 - R.y );
    sN = normalize( sV + normalize( R ) );
  }
}
seaN = sN;
// Rough water mirrors less at a glancing angle than calm water: the facets the eye sees are the ones that lean towards
// it (Bruneton's fit of the mean Fresnel factor of a Gaussian sea surface; calm water: Schlick). What the surface
// does not mirror comes from below it.
{
  float sigma = sqrt( 0.5 * seaVar );
  seaF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( sN, sV ), 0.0, 1.0 ), 5.0 * exp( - 2.69 * sigma ) ) / ( 1.0 + 22.7 * pow( sigma, 1.5 ) );
}
// the highlight widens by the slopes the pixel does not draw (alpha^2 = alpha0^2 + their variance; roughness^2 = alpha)
seaRough = sqrt( sqrt( ${(SEA_LOOK.rough ** 4).toExponential(3)} + seaVar ) );

// ---- white water
float sChurn = 0.45 * sLace.r + 0.35 * sLace2.g + 0.4 * sLace.b;
// the open sea: behind the swell's crests where it bunches up, in the gusts
float sCrest = smoothstep( 0.3, 0.62, swellCrest( vSeaBase, sAmp, 0.0, 1.6 ) );
sCrest = max( sCrest, 0.7 * smoothstep( 0.3, 0.62, swellCrest( vSeaBase, sAmp, 1.4, 1.6 ) ) );
sCrest = max( sCrest, 0.8 * smoothstep( 0.32, 0.55, 1.0 - sJac ) );
sCrest *= ( 0.35 + 0.65 * sGust ) * ( 1.0 - 0.7 * seaLee );
// the surf: a front, a solid band of white a hand's breadth of the cycle wide; behind it lace that thins as it ages;
// the lines grow as they come in, and break up along the shore
float sFront = 1.0 - smoothstep( 0.02, 0.17, sU );
float sTrail = pow( 1.0 - sU, 0.7 );
float sGrow = 0.6 + 0.4 * ( 1.0 - smoothstep( 0.0, ${f(0.7 * S.reach)}, sShore ) );
// (a pixel that covers most of the lines' spacing sees their mean, a third of white: no moire)
// (the front's mask is over one: solid white whatever the lace says)
float sLines = mix( max( 1.3 * sFront, 0.95 * sTrail ), 0.45, smoothstep( ${f(0.45 * S.spacing)}, ${f(1.0 * S.spacing)}, sAlong ) );
float sSurf = sZone * sGrow * sLines;
// the sheet on the sand: foam at its very edge, bubbles on the thin water behind it
float sFilm = sIn * ( 1.0 - smoothstep( 0.03, 0.3, sThick ) ) * sGentle;
float sEdge = sIn * ( 1.0 - smoothstep( 0.0, 0.07, sThick ) );
// rock: the slap at a cliff's foot or a stack, breathing with the swell, and the wash round it
float sSteep = sIn * smoothstep( 0.2, 0.55, sSlope );
float sPulse = 0.5 + 0.5 * sin( 6.2832 * seaSurfBeat( vSeaBase, sT * 0.6 ) );
float sWarp = ( sLace.b - 0.5 ) * 5.0;
float sRock = sSteep * max( ( 1.0 - smoothstep( 0.8, 5.5, sShore + sWarp * 0.6 ) ) * mix( 0.55, 1.0, sPulse ), 0.42 * ( 1.0 - smoothstep( 4.0, 15.0, sShore + sWarp ) ) );
// a pier's foot: the swell parts round it
#if SEA_PIERS > 0
{
  float nearest = 1.0e3;
  for ( int i = 0; i < SEA_PIERS; i ++ ) {
    if ( uSeaPier[ i ].w <= 0.0 ) continue;
    nearest = min( nearest, length( uSeaPier[ i ].xy - vSeaBase ) - uSeaPier[ i ].z );
  }
  sRock = max( sRock, ( 1.0 - smoothstep( 0.2, 2.6, nearest + sWarp * 0.25 ) ) * mix( 0.5, 0.9, sPulse ) );
}
#endif
float sMask = max( max( sCrest * 0.8, sSurf ), max( max( 0.5 * sFilm, 0.95 * sEdge ), sRock ) );
seaFoam = smoothstep( 1.18 - sMask * 1.05, 1.42 - sMask * 1.05, sChurn ) * min( 1.0, 0.4 + 0.6 * sMask );
// far away the foam's lace is less than a pixel: a share of white, not threads
seaFoam = mix( seaFoam, min( 1.0, 0.55 * sMask * sMask + 0.3 * sMask ), smoothstep( 0.7, 3.5, sAlong ) );

// ---- the body: the bed through the water, over the deep colour
float sNv = clamp( sV.y, 0.05, 1.0 );
float sCosT = sqrt( 1.0 - ( 1.0 - sNv * sNv ) / 1.777 );
float sCol = max( sThick, 0.0 );
vec3 sClear = exp( - ${v3(SEA_LOOK.absorb)} * ( sCol * 0.5 * ( 1.0 + 1.0 / sCosT ) ) );
// the bed is seen where the refracted line of sight meets it, wobbling with the surface
vec2 sBedAt = vSeaBase - normalize( sV.xz + vec2( 1.0e-5 ) ) * ( sCol * sqrt( 1.0 - sCosT * sCosT ) / sCosT ) + sN.xz * sCol * 0.6;
// (two sizes turned against each other: neither's repeat shows)
vec4 sBedA = texture2D( uSeaNoise, vec2( 0.891 * sBedAt.x + 0.454 * sBedAt.y, - 0.454 * sBedAt.x + 0.891 * sBedAt.y ) * ${f(1 / 113, 5)} + 0.19 );
vec4 sBedB = sLace;
#ifndef SEA_LEAN
if ( uSeaShed < 0.5 ) sBedB = texture2D( uSeaNoise, vec2( 0.588 * sBedAt.x - 0.809 * sBedAt.y, 0.809 * sBedAt.x + 0.588 * sBedAt.y ) * ${f(1 / 19.7, 5)} + 0.63 );
#endif
// reef, rock and weed lie in patches, mostly where the bed is not sand; never on the beach's own margin
float sReef = smoothstep( 0.5, 0.6, 0.45 * sBedA.b + 0.25 * sBedA.a + 0.3 * sBedB.b + 0.3 * ( 1.0 - sSand ) ) * smoothstep( 0.25, 1.2, sCol + 0.9 * ( 1.0 - sSand ) );
// ripples in the sand, a hand high, a stride apart
float sSandRip = 0.93 + 0.07 * sin( dot( sBedAt, vec2( 4.1, 2.3 ) ) + 5.0 * sBedB.b ) * ( 1.0 - smoothstep( 0.1, 0.4, sAlong ) );
vec3 sBed = mix( ${v3(SEA_LOOK.sand)} * sSandRip * ( 0.86 + 0.28 * sBedB.a ), ${v3(SEA_LOOK.reef)} * ( 0.6 + 0.9 * sBedB.r ), sReef );
// the light the ripples gather on a shallow bed (high)
#ifdef SEA_CAUSTICS
if ( uSeaShed < 0.5 ) {
float sCaust = pow( 1.0 - min( sLace2.g, texture2D( uSeaNoise, sBedAt * 0.23 - sT * vec2( 0.013, 0.021 ) ).g ) , 6.0 );
sBed *= 1.0 + 1.4 * sCaust * sWind * smoothstep( 0.05, 0.6, sCol ) * exp( - 0.35 * sCol ) * ( 1.0 - smoothstep( 0.15, 0.6, sAlong ) );
}
#endif
vec3 sBody = uSeaDeep * ( 1.0 - sClear ) + sBed * sClear;
// a wave's top is thinner: lighter, and lit through when looking towards the sun
float sTop = smoothstep( -0.2, 0.9, ( vSeaWorld.y - uSeaCentre.y ) / ( ${f(SEA_HEIGHT, 3)} * 0.5 * sAmp ) );
sBody *= 0.88 + 0.3 * sTop;
float sSunward = pow( clamp( dot( - sV, normalize( uSeaSunDir * vec3( 1.0, 0.0, 1.0 ) + vec3( 0.0, 1.0e-4, 0.0 ) ) ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 );
seaScatter = uSeaSun * ${v3(SEA_LOOK.scatter)} * ( 0.3 + 0.7 * sTop ) * ( 0.25 + 0.75 * sSunward ) * max( uSeaSunDir.y, 0.0 ) * 4.0;
// the face of a line of surf about to break is thin water with the light in it; bubbles turn the water milky
float sFace = sZone * sGrow * smoothstep( 0.8, 0.97, sU ) * ( 1.0 - smoothstep( ${f(0.45 * S.spacing)}, ${f(1.0 * S.spacing)}, sAlong ) );
float sMilk = max( smoothstep( 0.05, 0.7, min( sMask, 1.0 ) ), 0.6 * sFace );
// (between the lines the water is full of fine bubbles and sand: a brighter turquoise than its depth alone gives)
sBody = mix( sBody, ${v3(SEA_LOOK.surfBody)}, 0.55 * sZone * sGrow * smoothstep( 0.1, 0.5, sCol ) );
sBody = mix( sBody, ${v3(SEA_LOOK.milk)}, 0.62 * sMilk );
diffuseColor.rgb = mix( sBody * ( 1.0 - seaF ), ${v3(SEA_LOOK.foam)} * ( 0.8 + 0.3 * sLace2.r ), seaFoam );
seaRough = mix( seaRough, 0.6, seaFoam );
seaScatter *= 1.0 - seaFoam;
`;

/** GLSL (after the lights): the sun's glitter, the mirror (sky and land), the light through the waves, the lamps. */
const seaLight = () => /* glsl */ `
reflectedLight.directDiffuse += seaScatter;
{
  vec3 hV = normalize( cameraPosition - vSeaWorld );
  vec3 hR = reflect( - hV, seaN );

  // ---- the sun's (the moon's) highlight, in the clouds' shade, broken into sparks
  float hL = max( reflectedLight.directSpecular.r, max( reflectedLight.directSpecular.g, reflectedLight.directSpecular.b ) );
  if ( hL > 1.0e-6 ) {
    float hSpark = ${f(SEA_LOOK.glint.radiance)} * max( uSeaSun.r, max( uSeaSun.g, uSeaSun.b ) );
    float q = clamp( hL / hSpark, 0.0, 1.0 );
    // cells a pixel and a half across, at the two whole sizes on either side
    float lod = log2( max( seaFoot * 1.5, 0.02 ) );
    float l0 = floor( lod );
    float size = exp2( l0 );
    float spark = mix( seaSpark( vSeaBase / size, uWaveTime, q ), seaSpark( vSeaBase / ( 2.0 * size ) + 17.0, uWaveTime, q ), lod - l0 );
    // far out a pixel holds many sparks: more of the smooth light, less of the breaking up
    float keep = mix( 1.0, ${f(SEA_LOOK.glint.far)}, smoothstep( 0.3, 3.0, seaFoot ) ) * ( 1.0 - seaFoam );
    reflectedLight.directSpecular *= mix( 1.0, spark, keep );
  }
  reflectedLight.directSpecular *= seaShade;
  reflectedLight.directDiffuse *= mix( 1.0, seaShade, 0.8 );

  // ---- the mirror. What rough water mirrors is higher than what calm water mirrors (the facets the eye sees lean
  // towards it): the lift is 2.5 sigma at the horizon, nothing when looking down. How much it mirrors: seaF.
  float hSigma = sqrt( 0.5 * seaVar );
  float hF = seaF;
  float hUp = 2.5 * hSigma;
  vec3 hRe = normalize( vec3( hR.x, sqrt( hR.y * hR.y + hUp * hUp ), hR.z ) );
  float hBlur = clamp( 2.0 * hSigma, 0.03, 0.45 );
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
  vec3 hSky = textureLod( envMap, envMapRotation * hRe, roughnessToMip( hBlur ) ).rgb * envMapIntensity * uSeaSky;
  #else
  // no environment map on this device: the clear sky's two colours and the haze at the horizon
  vec3 hSky = mix( 0.5 * ( uSeaHorizon + hazeColor( hRe ) ), uSeaZenith, pow( clamp( hRe.y, 0.0, 1.0 ), 0.6 ) );
  #endif
  // where the highlight is wide and looks low (far out), the bright air at the horizon, which the map's blur would
  // mix with the ground under it
  float hLow = ( 1.0 - smoothstep( 0.03, 0.22, hRe.y ) ) * smoothstep( 0.1, 0.4, hBlur );
  hSky = mix( hSky, hazeColor( normalize( vec3( hRe.x, max( hRe.y, 0.02 ), hRe.z ) ) ), hLow );

  #ifdef SEA_PROBE
  // ---- what stands beyond the shore map (the far massif and ridges), from the car's reflection probe: between the
  // horizon and some 30 degrees up, where mountains are and the things beside the car are not
  if ( uSeaProbeOn > 0.5 ) {
    float pBand = smoothstep( 0.02, 0.07, hRe.y ) * ( 1.0 - smoothstep( 0.35, 0.55, hRe.y ) );
    if ( pBand > 0.0 ) hSky = mix( hSky, min( probeSample( uSeaProbe, hRe, max( hBlur, 0.2 ) ), vec3( uSeaMirrorCap ) ), pBand );
  }
  #endif
  #if SEA_LAND > 0
  // ---- the land in the mirror: the mirrored ray marched over the shore map's land heights, each step looking at a
  // coarser level (which holds the highest land of the stretch it covers)
  if ( uSeaMarch.x > 0.5 && ( seaLee > 0.0 || shoreLand( textureLod( uSeaShore, ( vSeaBase - uSeaBox.xy ) * uSeaBox.z, SEA_LEE_LOD + 2.0 ).b ) > 2.0 ) ) {
    vec2 hDir = hRe.xz / max( length( hRe.xz ), 1.0e-4 );
    float hTan = hRe.y / max( length( hRe.xz ), 1.0e-4 );
    // the skyline is as soft as the slopes are spread
    float hSoft = 0.012 + 2.0 * hSigma * ( 1.0 + hTan * hTan );
    float hLand = 0.0;
    float hAt = 0.0;
    float hTop = 0.0;
    float d = 9.0;
    for ( int i = 0; i < SEA_LAND; i ++ ) {
      if ( float( i ) >= uSeaMarch.x ) break;
      vec2 q = ( vSeaBase + hDir * d - uSeaBox.xy ) * uSeaBox.z;
      float h = shoreLand( textureLod( uSeaShore, q, log2( max( 1.0, 0.3 * d * uSeaBox.z * SEA_SHORE_SIZE ) ) ).b );
      // (far land is a soft, paler presence: a coarse level's highest land is wider than the land)
      float over = smoothstep( - hSoft, hSoft, h / d - hTan ) * step( 0.3, h ) * ( 1.0 - 0.35 * smoothstep( 400.0, 1800.0, d ) );
      if ( over > hLand ) {
        hLand = over;
        hAt = d;
        hTop = h;
      }
      d *= uSeaMarch.y;
    }
    if ( hLand > 0.0 ) {
      // (land that barely clears the water is a beach: pale)
      vec3 hOwn = uSeaLandTint * mix( ${v3(SEA_LOOK.sand.map((c, i) => c / SEA_LOOK.land[i]))}, vec3( 1.0 ), smoothstep( 0.6, 3.5, hTop ) );
      vec3 hTint = mix( hOwn, hazeColor( vec3( hDir.x, 0.0, hDir.y ) ), hazeBetween( uSeaBox.w + 1.0, vec3( hDir.x, 0.0, hDir.y ) * ( hAt + length( cameraPosition - vSeaWorld ) ) ) );
      hSky = mix( hSky, hTint, hLand );
    }
  }
  #if SEA_PIERS > 0
  // ---- and the piers: each a post of its own width and height that the mirrored ray passes or meets
  {
    vec2 pDir = hRe.xz / max( length( hRe.xz ), 1.0e-4 );
    float pTan = hRe.y / max( length( hRe.xz ), 1.0e-4 );
    float pPier = 0.0;
    for ( int i = 0; i < SEA_PIERS; i ++ ) {
      vec4 pier = uSeaPier[ i ];
      if ( pier.w <= 0.0 ) continue;
      vec2 rel = pier.xy - vSeaBase;
      float along = dot( rel, pDir );
      if ( along <= 0.0 ) continue;
      float off = abs( rel.x * pDir.y - rel.y * pDir.x );
      // the ripples the pixel does not draw spread the image: a little sideways, a lot up and down
      float wide = 0.25 + 0.6 * hSigma * along;
      float tall = 0.3 + 2.0 * hSigma * ( 1.0 + pTan * pTan ) * along;
      pPier = max( pPier, ( 1.0 - smoothstep( pier.z - wide, pier.z + wide, off ) ) * ( 1.0 - smoothstep( pier.w - tall, pier.w + tall, along * pTan ) ) );
    }
    // (the face the water sees looks back along the ray: lit if the sun stands behind the water)
    hSky = mix( hSky, uSeaPierTint + uSeaPierSun * max( 0.0, - dot( pDir, uSeaSunDir.xz ) ), pPier * 0.92 );
  }
  #endif
  #endif
  #ifdef SEA_MIRROR
  // ---- the planar mirror: what the pixel would mirror were it some way off, looked up where that lands in the
  // mirror's picture; the ripples the pixel does not draw pull the image out towards the eye (the streaked copy)
  if ( uMirrorOn > 0.5 ) {
    float mFar = 30.0 + 0.7 * length( cameraPosition - vSeaWorld );
    vec4 mP = uMirrorMatrix * vec4( vec3( vSeaBase.x, uSeaBox.w, vSeaBase.y ) + hRe * mFar, 1.0 );
    vec2 mUv = mP.xy / max( mP.w, 1.0e-4 );
    float mIn = step( 1.0e-3, mP.w ) * smoothstep( 0.0, 0.05, mUv.x ) * ( 1.0 - smoothstep( 0.95, 1.0, mUv.x ) ) * smoothstep( 0.0, 0.05, mUv.y ) * ( 1.0 - smoothstep( 0.9, 1.0, mUv.y ) );
    if ( mIn > 0.0 ) {
      vec3 mCol = mix( texture2D( uMirrorTex, mUv ).rgb, texture2D( uMirrorStreak, mUv ).rgb, clamp( 7.0 * hSigma, 0.0, 0.85 ) );
      hSky = mix( hSky, min( mCol, vec3( uSeaMirrorCap ) ), mIn );
    }
  }
  #endif
  reflectedLight.indirectSpecular = hSky * ( hF * uSeaGain * ( 1.0 - 0.85 * seaFoam ) );
}
#if SEA_LAMPS > 0 || SEA_TAILS > 0
{
  vec3 lV = normalize( cameraPosition - vSeaWorld );
  vec3 lR = reflect( - lV, seaN );
  vec3 lA = normalize( cross( seaN, lV ) );
  vec3 lB = cross( lR, lA );
  float lF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( seaN, lV ), 0.0, 1.0 ), 5.0 );
  float lW = 1.0 + 4.0 * seaRough * seaRough;
  vec3 lamp = vec3( 0.0 );
  #if SEA_LAMPS > 0
  for ( int i = 0; i < SEA_LAMPS; i ++ ) {
    if ( uSeaGlintPos[ i ].w <= 0.0 ) continue;
    lamp += uSeaGlintColor[ i ] * ( uSeaGlintPos[ i ].w * seaStreak( uSeaGlintPos[ i ].xyz - vSeaWorld, lR, lA, lB, lW ) );
  }
  #endif
  #if SEA_TAILS > 0
  for ( int i = 0; i < SEA_TAILS; i ++ ) {
    if ( uSeaTail[ i ].w <= 0.0 ) continue;
    vec3 to = uSeaTail[ i ].xyz - vSeaWorld;
    lamp += ${v3(SEA_LOOK.lamp.tailColor)} * ( uSeaTail[ i ].w * seaStreak( to, lR, lA, lB, lW ) / ( 1.0 + dot( to, to ) * ${f(1 / SEA_LOOK.lamp.tailReach ** 2, 6)} ) );
  }
  #endif
  lamp *= lF * ${SEA_LOOK.lamp.gain.toFixed(3)};
  // a lamp in the water glares, it does not burn a hole (as on the wet road)
  reflectedLight.directSpecular += lamp * 3.0 / ( 3.0 + max( lamp.r, max( lamp.g, lamp.b ) ) ) * ( 1.0 - seaFoam );
}
#endif
`;

/** GLSL (before the output): at the disc's edge the water is the haze the sky dome shows just under the horizon. */
const SEA_HORIZON = /* glsl */ `
outgoingLight = mix( outgoingLight, hazeColor( - normalize( cameraPosition - vSeaWorld ) ), smoothstep( uSeaView.y * 0.6, uSeaView.y * 0.985, length( vSeaWorld.xz - cameraPosition.xz ) ) );
`;
