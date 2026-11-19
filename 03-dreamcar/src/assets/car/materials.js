// The car's materials: the paint (and everything else that is opaque and
// flush with the skin), the glass, the lamp lenses, the dark shell inside, and
// the ghost.
//
// Two ideas:
//  - One skin, drawn a few times. The paint, the glass and the lenses are the
//    same surface; what each of them is at a point comes from the atlas
//    (atlas.js: distances to the outlines of features.js), thresholded per
//    pixel and antialiased with the distance's screen-space derivative. The
//    paint shader itself turns into gloss black (window surround, the frit
//    under the edge of the glass), matte black (the front lip, the diffuser),
//    bright metal (the grille's frame, the tail-pipe trims), red reflector, or
//    the lamp units' stand-ins, and darkens the shut lines.
//  - Built on THREE.MeshPhysicalMaterial (onBeforeCompile), so the world's
//    lights, shadows, fog and environment map keep working. What is added:
//    the clear coat and the glass mirror the car's own reflection probe
//    (GLSL_PROBE) instead of the far environment map; where there is no probe
//    the environment map's reflection is scaled by how much sky is overhead
//    (setReflections), so the car goes dark in a tunnel. With a probe the
//    paint's metal layer mirrors the probe too (look lane: a silver car is
//    nearly all reflection, and must be silver under the tunnel's lamps).

import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE, GLSL_PROBE, GLSL_PROBE_PROXY, targetDefines } from '../../engine/glsl.js';
import { RANGE } from './atlas.js';
import { ARCHES, GRILLE_STARS, INTAKE_CENTRE, INTAKE_SIDE } from './features.js';
import { BORE_UNIFORMS } from '../world/shading.js';
import { LUMINAIRE } from '../world/tunnel.js';

/** The paints: base colour (linear), metalness and roughness of the flake layer, how dark it gets edge-on (flop), and how much flake shows. */
export const PAINTS = {
  // high-tech silver: this car. A metallic paint, not polished metal: a bright flake layer rough enough to shade
  // softly from light to dark across a panel (light silver-white in the sun, mid grey turned away from it), part
  // metal and part pigment, so it takes the sun's light as a colour of its own as well as a broad sheen; the clear
  // coat above it carries the only sharp reflection, a lacquer's, strong at grazing angles only. At metalness 0.92
  // and roughness 0.27 the layer mirrored everything and the car read as chrome.
  silver: { color: [0.59, 0.615, 0.675], metal: 0.86, rough: 0.33, flop: 0.22, flake: 1 },
  graphite: { color: [0.16, 0.17, 0.18], metal: 1, rough: 0.34, flop: 0.45, flake: 1 },
  blue: { color: [0.018, 0.045, 0.19], metal: 0.85, rough: 0.32, flop: 0.35, flake: 1 },
  red: { color: [0.36, 0.014, 0.014], metal: 0.35, rough: 0.3, flop: 0.6, flake: 0.5 },
  white: { color: [0.78, 0.79, 0.78], metal: 0, rough: 0.35, flop: 1, flake: 0 },
  black: { color: [0.012, 0.012, 0.014], metal: 0.3, rough: 0.3, flop: 1, flake: 0.3 },
};

/**
 * Uniforms every car material shares (one object, so that setReflections and setLights touch one place).
 * @param {THREE.Texture[]} atlas
 */
const f4 = (v) => v.toFixed(4);
/** GLSL: is a point (|x|, y, z) of the body inside a wheel arch's hole (features.js ARCHES)? */
const ARCH_HOLE = `bool carArchHole(vec3 p) {
${[ARCHES.front, ARCHES.rear]
  .map(
    (a) => `  {
    vec2 d = vec2((p.z - ${f4(a.z)}) / ${f4(a.a)}, max(p.y - ${f4(a.y)}, 0.0) / ${f4(a.b)});
    if (p.x > ${f4(a.inner)} && dot(d, d) < 1.0) return true;
  }`,
  )
  .join('\n')}
  return false;
}`;

export function createShared(atlas) {
  return {
    carAtlas0: { value: atlas[0] },
    carAtlas1: { value: atlas[1] },
    carRange: { value: RANGE },
    carProbe: { value: null },
    carProbeOn: { value: 0 },
    carSky: { value: 1 },
    carKey: { value: 1 },
    ...proxyUniforms(),
    carDebug: { value: 0 }, // DEBUG car8
    // lamps: drl, low, high, tail / brake, reverse, indicator left, indicator right
    carLampsA: { value: new THREE.Vector4() },
    carLampsB: { value: new THREE.Vector4() },
    // interior, and three spare
    carLampsC: { value: new THREE.Vector4() },
    // the tunnel (setBore): where the car is in the road's frame and that frame's axes in car space (GLSL_BORE)
    carBoreAt: { value: new THREE.Vector4() },
    carBoreAhead: { value: new THREE.Vector4(0, 0, 1, 0) },
    carBoreFlat: { value: new THREE.Vector3(1, 0, 0) },
    carBoreUp: { value: new THREE.Vector3(0, 1, 0) },
    carBoreMove: { value: new THREE.Vector2() },
    carBoreBars: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, 0)) },
    carBoreFrom: { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) },
    carBoreSpan: { value: new THREE.Vector2(0, -1) },
    // where the lines of luminaires are, how bright, and the lining's radiance: the tunnel's own (shading.js)
    uBoreLines: BORE_UNIFORMS.uBoreLines,
    uBoreLineColor: BORE_UNIFORMS.uBoreLineColor,
    uBoreZone: BORE_UNIFORMS.uBoreZone,
    uBoreGlow: BORE_UNIFORMS.uBoreGlow,
  };
}

/**
 * The tunnel's luminaires as rows of bars along it, for GLSL_BORE: walked by the same spacing rule as tunnel.js's
 * fittings (LUMINAIRE: pairs of short bars close together in the entrance zone, single bars spaced out further in,
 * closer again before the exit). Returns up to four rows, each (first bar's distance into the tunnel, spacing, bar
 * length, half the gap between a pair's bars or 0), the distance from which each row holds, and the first and last
 * bars' distances.
 * @param {number} length the tunnel's length (m)
 */
export function boreRows(length) {
  const L = LUMINAIRE;
  const spacingAt = (d, toExit) =>
    d < L.entrance[0] ? L.entrance[1] : d < L.transition[0] || toExit < L.exit[0] ? L.transition[1] : L.interior;
  const rows = [];
  let last = 1.5;
  for (let d = 1.5; d < length - 1; ) {
    const spacing = spacingAt(d, length - d);
    const pair = d < L.entrance[0];
    const row = rows[rows.length - 1];
    if (!row || row.spacing !== spacing || row.pair !== pair) rows.push({ start: d, spacing, pair, from: rows.length ? (last + d) / 2 : -1e9 });
    last = d;
    d += spacing;
  }
  return {
    rows: rows.slice(0, 4).map((r) => [r.start, r.spacing, r.pair ? L.alongPair : L.along, r.pair ? L.pair / 2 : 0]),
    from: rows.slice(0, 4).map((r) => r.from),
    span: rows.length ? [rows[0].start, last] : [0, -1],
  };
}

const VERTEX_PARS = /* glsl */ `
varying vec2 vSkinUv;
varying vec3 vCarPos;
varying vec3 vCarNormal;
varying mat3 vCarToView;
`;
const VERTEX_MAIN = /* glsl */ `
vSkinUv = uv;
vCarPos = position;
vCarNormal = normal;
vCarToView = normalMatrix;
`;

/**
 * The probe holds the lamps and the sun as the rest of the world sees them, but the car takes their light from the
 * lights themselves (the sun, the floodlights' and its own spots: three.js's direct light, with the paint's own
 * lobes). Read through a rough layer, what the probe's few coarse texels of a lamp add on top of that is a second
 * copy of its light smeared over the panel: at night the silver glowed pale grey all over, in blotches that moved
 * as the probe's faces were redrawn. So a rough read holds anything brighter than a few times the white paper of the
 * moment (`carKey`: the radiance of white paper in the key light, from the picture's exposure, which is set to that
 * light) to about that, rolling off slowly above it; a crisp read keeps far more, so that a lamp stays a jewel in the
 * clear coat and the glass.
 */
const GLSL_KEY = /* glsl */ `
uniform float carKey;
vec3 carHoldKey(vec3 c, float k) {
  float cap = k * carKey;
  float peak = max(c.r, max(c.g, c.b));
  return peak > cap ? c * (cap * (1.0 + 0.25 * log(peak / cap)) / peak) : c;
}
`;

const GLSL_SANE = /* glsl */ `
// A texel of the probe that is not a number (or overflowed half float) must not reach the picture: the bloom
// would spread it over the whole screen (and on this renderer it came out black). What the probe saw there is
// lost; the sky stands in for it.
vec3 carSane(vec3 c, vec3 instead) {
  return (any(isnan(c)) || any(isinf(c)) || max(c.r, max(c.g, c.b)) > 6.0e4) ? instead : c;
}
`;


/**
 * The tunnel's two lines of luminaires in the car's mirrors, exactly (`carBoreLines`). While the car is in or near
 * the tunnel they are straight rows of bars at a known place: along the road, `uBoreLines.x` either side of its
 * centre line, `uBoreLines.y` over it (shading.js BORE_UNIFORMS, set by tunnel.js). A reflected ray from a point of
 * the body is followed to their plane; where it meets it, across the road, says how much of a bar's width it sees
 * (a box seen through a box filter as wide as the pixel's footprint there, plus the layer's own spread), and along
 * it, how much of the row of bars (boreRows: the entrance's pairs, the spaced bars further in) over the same
 * filter, plus the distance the car covers in a 90th of a second, so that the dashes stream past at speed rather
 * than step. The probe sees the fittings only as broad stand-ins a few texels wide, a fifth of a second old: in the
 * paint they were blotches and broken flecks. (The ray from outside the box counts only through its mouth.)
 *
 * The road's frame at the car (setBore, from the Game): `carBoreAt` the car's origin (lat, height over the centre
 * line's grade, s) and how far the car is under the roof (0..1); `carBoreAhead` (xyz) the road's level heading in car
 * space and (w) its grade; `carBoreFlat` its level left; `carBoreUp` the world's up. The box is upright and follows
 * the grade, so a height over the ceiling is taken along the world's up less the grade times the distance along.
 *
 * (The walls and the ceiling in the probe are put at their true distance by the probe's own box, GLSL_PROBE_PROXY.)
 */
const GLSL_BORE = /* glsl */ `
uniform vec4 carBoreAt;
uniform vec4 carBoreAhead;
uniform vec3 carBoreFlat;
uniform vec3 carBoreUp;
uniform vec2 carBoreMove;
uniform vec4 carBoreBars[4];
uniform vec4 carBoreFrom;
uniform vec2 carBoreSpan;
uniform vec4 uBoreLines;
uniform vec3 uBoreLineColor;
uniform vec4 uBoreZone;
uniform vec3 uBoreGlow;
vec3 carToCar(vec3 rWorld) { return normalize(transpose(vCarToView) * (viewMatrix * vec4(rWorld, 0.0)).xyz); }
vec3 carFromCar(vec3 rCar) { return inverseTransformDirection(vCarToView * rCar, viewMatrix); }
/** How much of a box |x| < h is seen through a box filter b wide. */
float carBoxSeen(float x, float h, float b) {
  b = max(b, 1e-4);
  return (clamp(x + h, -0.5 * b, 0.5 * b) - clamp(x - h, -0.5 * b, 0.5 * b)) / b;
}
/** The integral of a row of bars (len long, every period, the first starting at 0) up to y. */
float carRowSum(float y, float period, float len) { return len * floor(y / period) + min(mod(y, period), len); }
/** How much of the row of bars (row: first bar's centre, spacing, length) is seen at d through a filter b long. */
float carRowSeen(float d, vec4 row, float b) {
  b = max(b, 1e-3);
  float y = d - row.x + 0.5 * row.z + 1000.0 * row.y;
  return (carRowSum(y + 0.5 * b, row.y, row.z) - carRowSum(y - 0.5 * b, row.y, row.z)) / b;
}
/** The lines of luminaires seen from car-space point p along car-space direction r; spread: the layer's (m per m). */
vec3 carBoreLines(vec3 p, vec3 r, float spread) {
  if (carBoreMove.y < 0.5) return vec3(0.0);
  float pa = dot(p, carBoreAhead.xyz);
  float sP = carBoreAt.z + pa;
  float latP = carBoreAt.x + dot(p, carBoreFlat);
  float hP = carBoreAt.y + dot(p, carBoreUp) - carBoreAhead.w * pa;
  float ds = dot(r, carBoreAhead.xyz);
  float dl = dot(r, carBoreFlat);
  float dh = dot(r, carBoreUp) - carBoreAhead.w * ds;
  float t = max(uBoreLines.y - hP, 0.0) / max(dh, 0.02);
  float lat = latP + dl * t;
  float d = sP + ds * t - uBoreZone.x;
  // the filters: the pixel's footprint on the plane, the layer's spread, and along the road the car's own motion
  float bLat = min(fwidth(lat), 4.0) + spread * t;
  float bS = min(fwidth(d), 8.0) + spread * t + carBoreMove.x;
  vec4 row = carBoreBars[0];
  if (d > carBoreFrom.y) row = carBoreBars[1];
  if (d > carBoreFrom.z) row = carBoreBars[2];
  if (d > carBoreFrom.w) row = carBoreBars[3];
  // never thinner than about a pixel: seen small (the chase camera on a phone) a bar's width is a fraction of the
  // pixel's footprint on the plane, and filtered to its true share it was a faint grey thread
  float h = max(0.5 * uBoreLines.w, 0.6 * min(fwidth(lat), 4.0));
  float across = carBoxSeen(abs(lat) - uBoreLines.x - row.w, h, bLat) + (row.w > 0.0 ? carBoxSeen(abs(lat) - uBoreLines.x + row.w, h, bLat) : 0.0);
  float along = carRowSeen(d, row, bS) * carBoxSeen(d - 0.5 * (carBoreSpan.x + carBoreSpan.y), 0.5 * (carBoreSpan.y - carBoreSpan.x) + 0.5 * row.z, bS);
  // only rays that go up to the plane, and from outside the box only through its mouth
  float seen = step(0.02, dh) * step(0.0, uBoreLines.y - hP);
  float sEdge = sP < uBoreZone.x ? uBoreZone.x : uBoreZone.y;
  float tm = (sEdge - sP) / (abs(ds) > 1e-4 ? ds : 1e-4);
  if (sP < uBoreZone.x || sP > uBoreZone.y) {
    seen *= step(0.0, tm) * step(abs(latP + dl * tm), uBoreLines.x + ${LUMINAIRE.inset.toFixed(3)}) * step(hP + (dh) * tm, uBoreLines.y + 0.1);
  }
  return uBoreLineColor * (uBoreLines.z * across * along * seen);
}
/** Under the roof the probe's lamps and fittings are the analytic lines' (carBoreLines): what it sees is held to a few times the lining's radiance. */
vec3 carBoreHold(vec3 seen) {
  float cap = 4.0 * max(max(uBoreGlow.r, max(uBoreGlow.g, uBoreGlow.b)), 1e-4);
  float peak = max(seen.r, max(seen.g, seen.b));
  float keep = peak > cap ? cap * (1.0 + 0.25 * log(peak / cap)) / peak : 1.0;
  return seen * mix(1.0, keep, carBoreAt.w);
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D carAtlas0;
uniform sampler2D carAtlas1;
uniform float carRange;
uniform samplerCube carProbe;
uniform float carProbeOn;
uniform float carSky;
uniform float carDebug;
uniform vec4 carLampsA;
uniform vec4 carLampsB;
uniform vec4 carLampsC;
varying vec2 vSkinUv;
varying vec3 vCarPos;
varying vec3 vCarNormal;
varying mat3 vCarToView;
${GLSL_HASH}
${GLSL_NOISE}
${GLSL_PROBE}
${GLSL_SANE}
${GLSL_KEY}
${GLSL_PROBE_PROXY}
/** The fragment's place in the world, for the probe's parallax correction. */
vec3 carWorldPos() { return (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition; }
${GLSL_BORE}
vec4 carAtlas(sampler2D t) { return (texture2D(t, vSkinUv) * 255.0 - 127.5) / 127.5 * carRange; }
/** How much of the pixel is inside (distance < 0), antialiased by the distance's own footprint. */
float carCover(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0); }
/** The same for a distance that is analytic in car space. */
float carInside(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0); }
${ARCH_HOLE}
float carBox(vec2 p, vec2 c, vec2 half_, float r) {
  vec2 q = abs(p - c) - half_ + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

/**
 * How much stronger than a plain lacquer's (4 % face-on) the paint's clear coat mirrors: a little, so that the
 * mirror image reads through the bright flake layer under it the way it does on a polished car.
 */
const COAT_GAIN = 1.0;

/**
 * A mirror that curves makes the picture in it small: neighbouring pixels then look at directions several texels of
 * the probe apart, and a sharp read of it aliases (the wood's needles became a hatching all over the paint, which
 * would crawl as the car moves). So the probe is never read sharper than the pixel's own footprint in it: this is
 * the roughness whose mip level (probeLevel in engine/glsl.js: log2(1.65 r^2 size)) is the one where a texel is as
 * wide as the step between this pixel's direction `r` and its neighbours' (0.64 size |dr| texels).
 */
const FOOTPRINT = 'sqrt(0.39 * max(length(dFdx(r)), length(dFdy(r))))';

/**
 * Reflections: the car's probe in the clear coat (`coat`) and in the layer under it (`base`; for glass and plain
 * trim that is the only specular layer). The probe is read at each layer's own roughness, so the rough flake layer
 * gets the surroundings blurred: the road darkens the sills, a wood one flank.
 * Only the far environment map is scaled by the sky overhead; the probe is the car's real surroundings and is taken
 * as it is. With both scaled, the silver paint, whose colour is nearly all reflection, went black under the tunnel's
 * sodium lamps and matt dark grey at night; now the lamp rows slide over it.
 */

/**
 * The paint's flake layer reads the probe at its own roughness: the probe's levels are the surroundings convolved
 * with the GGX lobe of each roughness (ReflectionProbe.js), so one read is a smooth bell of them (until round 8 the
 * mips were plain 2x2 averages, and the layer took nine taps in a cone at a finer level to keep the wood's crowns
 * from printing as blocks). The flakes are metal under a lacquer that is not quite clear: what they show is held to
 * 65 % of its colour, and less the brighter it is (a coloured lamp, the green of the start lights at night, tints
 * the panel with its light instead of washing a flank in its colour).
 */
const GLSL_SOFT_PROBE = /* glsl */ `
vec3 carSoftProbe(vec3 r, float rough, float foot) {
  vec3 seen = probeSample(carProbe, r, max(rough, foot));
  float l = dot(seen, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), seen, 0.65 / (1.0 + max(l / max(carKey, 1e-6) - 0.25, 0.0)));
}
`;

/**
 * The flake layer's share of the tunnel's lines (carBoreLines at the layer's own spread): a soft bright sheen round
 * the clear coat's crisp lines, not a second mirror image.
 */
const BORE_SHEEN = 0.3;
/**
 * And the clear coat's (and the glass's) share, against a plain lacquer's reflectance: a little more, so that on a
 * pale silver under pale walls the lines read as the brightest thing on the body, as they do on a polished car
 * under strip lights (at 1 they were faint, at the shoulders only a thin grey).
 */
const BORE_COAT = 5.0;

/**
 * White paper in the key light, as the finished picture has it (lighting.js: about 1 in the afternoon sun, at an
 * exposure of about 0.7): divided by the picture's exposure, the radiance of white paper wherever the car is
 * (`carKey`, CarModel.setReflections).
 */
export const PAPER = 0.7;
/** What a crisp read of the probe keeps of a lamp, and a rough one, in white papers of the key light (GLSL_KEY). */
const KEY_CRISP = '16.0';
const KEY_ROUGH = '3.0';

const REFLECTIONS = (coat, base = !coat, gain = 1, soft = false, bore = false) => /* glsl */ `
#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  ${
    coat
      ? `
  #ifdef USE_CLEARCOAT
  {
    vec3 r = inverseTransformDirection(reflect(-geometryViewDir, geometryClearcoatNormal), viewMatrix);
    ${bore ? 'vec3 rBore = r;' : ''}
    r = probeProxyDir(carWorldPos(), r);
    clearcoatRadiance = mix(clearcoatRadiance * carSky, carSane(probeSample(carProbe, r, max(material.clearcoatRoughness, ${FOOTPRINT})), clearcoatRadiance * carSky), carProbeOn);
    clearcoatRadiance = carHoldKey(clearcoatRadiance, ${KEY_CRISP});
    ${bore ? 'clearcoatRadiance = carBoreHold(clearcoatRadiance);' : ''}
    ${soft ? 'clearcoatRadiance = mix(vec3(dot(clearcoatRadiance, vec3(0.2126, 0.7152, 0.0722))), clearcoatRadiance, 0.3);' : ''}
    ${bore ? `clearcoatRadiance += ${BORE_COAT.toFixed(2)} * carBoreLines(vCarPos, carToCar(rBore), 2.0 * material.clearcoatRoughness * material.clearcoatRoughness);` : ''}
  }
  #else
  clearcoatRadiance *= carSky;
  #endif
  clearcoatRadiance *= ${gain.toFixed(2)};`
      : ''
  }
  ${
    base
      ? `
  {
    vec3 r = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
    ${bore ? 'vec3 rBore = r;' : ''}
    r = probeProxyDir(carWorldPos(), r);
    vec3 seen = carSane(${soft ? `carSoftProbe(r, material.roughness, ${FOOTPRINT})` : `probeSample(carProbe, r, max(material.roughness, ${FOOTPRINT}))`}, radiance * carSky);
    // and a lamp or the sun is the lights' business (GLSL_KEY): the rougher the layer, the less of it is kept
    seen = carHoldKey(seen, mix(${KEY_CRISP}, ${KEY_ROUGH}, smoothstep(0.08, 0.3, material.roughness)));
    ${bore ? 'seen = carBoreHold(seen);' : ''}
    radiance = mix(radiance * carSky, seen, carProbeOn);
    ${bore ? `radiance += ${(soft ? BORE_SHEEN : BORE_COAT).toFixed(2)} * carBoreLines(vCarPos, carToCar(rBore), 2.0 * material.roughness * material.roughness);` : ''}
  }`
      : `
  radiance *= carSky;`
  }
#endif
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= mix(0.3, 1.0, carSky);
#endif
`;

/**
 * The car's lamps cast their light from just behind their lenses, and a spot light knows nothing of the housing
 * round it: left alone it lights the grille's frame, the bumper and the lens itself from a hand's width away.
 * So on the car's own materials a spot light begins to count 0.35 m ahead of where it stands (and fully from
 * 0.9 m): nothing of a car is that close in front of its own lamps, and everything else's lamps are further off.
 */
const SPOT_NEAR = /* glsl */ `
#if NUM_SPOT_LIGHTS > 0
void carSpotLightInfo(in SpotLight spotLight, in vec3 geometryPosition, out IncidentLight light) {
  getSpotLightInfo(spotLight, geometryPosition, light);
  light.color *= smoothstep(0.35, 0.9, dot(geometryPosition - spotLight.position, -spotLight.direction));
}
#define getSpotLightInfo carSpotLightInfo
#endif
`;

function patch(material, shared, caps, { vertex = true, vertexPars = '', vertexMain = '', fragmentPars = '', replace = [] }) {
  material.defines = { ...(material.defines || {}), ...(caps ? targetDefines(caps) : {}) };
  // three.js caches programs by the source of onBeforeCompile, which is this same closure for every car material:
  // without a key of its own a material can be handed another's program
  const key = JSON.stringify([vertex, vertexPars, vertexMain, fragmentPars, replace]);
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    if (vertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}${vertexPars}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}${vertexMain}`);
    }
    let f = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}\n${fragmentPars}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${SPOT_NEAR}`);
    for (const [from, to] of replace) {
      if (!f.includes(from)) throw new Error(`car material: no ${from}`);
      f = f.replace(from, to);
    }
    shader.fragmentShader = f;
  };
}

/** The uniforms mirrorProbe() reads: the probe, whether there is one, and how much sky is overhead. */
export const probeUniforms = () => ({ carProbe: { value: null }, carProbeOn: { value: 0 }, carSky: { value: 1 }, carKey: { value: 1 }, ...proxyUniforms() });

/** The probe's parallax uniforms (GLSL_PROBE_PROXY), copied each frame from the probe's own (setReflections's `proxy`). */
export const proxyUniforms = () => ({
  probeCenter: { value: new THREE.Vector3() },
  probePlane: { value: new THREE.Vector4(0, 1, 0, 0) },
  probeBox: { value: new THREE.Matrix4() },
  probeProxy: { value: new THREE.Vector2(0, 0) },
});

/** Copies a probe's proxy uniforms (ReflectionProbe `uniforms`) into a material's; none: no correction. */
export function copyProxy(to, from) {
  if (!from) {
    to.probeProxy.value.set(0, 0);
    return;
  }
  to.probeCenter.value.copy(from.probeCenter.value);
  to.probePlane.value.copy(from.probePlane.value);
  to.probeBox.value.copy(from.probeBox.value);
  to.probeProxy.value.copy(from.probeProxy.value);
}

/**
 * For a three.js standard or physical material built elsewhere (the wheels'): makes it mirror the car's probe as
 * the car's own materials do, read directly at each layer's roughness. (Given the cube as its `envMap`, three.js
 * would make one prefiltered copy of it at first use and never look again: the wheels kept mirroring the start
 * line.) Call it from onBeforeCompile, after any other patch.
 * @param {object} shader
 * @param {ReturnType<typeof probeUniforms>} uniforms
 * @param {{ coat?: boolean, seen?: number }} [options] `coat`: the material has a clear coat; `seen`: the share of
 *   its surroundings a part deep inside the wheel sees
 */
export function mirrorProbe(shader, uniforms, { coat = false, seen = 1 } = {}) {
  Object.assign(shader.uniforms, uniforms);
  const inner = /* glsl */ `
#if defined( RE_IndirectSpecular )
  radiance *= ${seen.toFixed(3)};
#endif
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= ${seen.toFixed(3)};
#endif
`;
  for (const chunk of ['#include <common>', '#include <lights_fragment_maps>']) {
    if (!shader.fragmentShader.includes(chunk)) throw new Error(`car material: no ${chunk}`);
  }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform samplerCube carProbe;\nuniform float carProbeOn;\nuniform float carSky;\n${GLSL_PROBE}\n${GLSL_SANE}\n${GLSL_KEY}\n${GLSL_PROBE_PROXY}\nvec3 carWorldPos() { return (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition; }`)
    .replace('#include <lights_fragment_maps>', REFLECTIONS(coat, true, 1) + (seen < 1 ? inner : ''));
}

/** The paint, and everything else opaque on the skin. */
export function createPaintMaterial(shared, caps, paintName = 'silver', { shoulderV = 0.5, extentV = 5, texel = 0.005, pins = true } = {}) {
  const paint = PAINTS[paintName] || PAINTS.silver;
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03 });
  const own = {
    paintColor: { value: new THREE.Vector3(...paint.color) },
    paintMetal: { value: paint.metal },
    paintRough: { value: paint.rough },
    paintFlop: { value: paint.flop },
    paintFlake: { value: paint.flake },
  };
  patch(material, { ...shared, ...own }, caps, {
    fragmentPars: /* glsl */ `${GLSL_SOFT_PROBE}
// where the shoulder's rail lies in the atlas (v), and the metres of skin the atlas spans that way
#define SHOULDER_V ${shoulderV.toFixed(5)}
#define EXTENT_V ${extentV.toFixed(4)}
// the atlas's texel on the car, at its coarsest (m)
#define ATLAS_TEXEL ${texel.toFixed(5)}
#define GRILLE_PINS ${pins ? 1 : 0}
${['UI', 'LI', 'LO', 'UO'].map((name, i) => `#define INTAKE_${name} vec2(${f4(INTAKE_SIDE[i][0])}, ${f4(INTAKE_SIDE[i][1])})`).join('\n')}
${INTAKE_CENTRE.slice(0, 4).map(([x, y], i) => `#define INTAKE_C${i} vec2(${f4(x)}, ${f4(y)})`).join('\n')}
uniform vec3 paintColor;
uniform float paintMetal;
uniform float paintRough;
uniform float paintFlop;
uniform float paintFlake;
vec3 cBase; float cMetal; float cRough; float cCoat; vec3 cEmit; float cShut; float cPaint; vec3 cTilt;
// the rounding of the panels' edges into the shut lines: the slope there, and which way it falls (see carGrad)
float cEdge; float cEdgeD;
// cHeight: small forms as a height over the skin (m), shaded by carBump; cAO: how much of its surroundings a point sees
float cHeight; float cAO;

/**
 * The tilt (view space) that a height field h over the surface gives the normal: its gradient along the surface,
 * from the screen-space derivatives of h and of the position. Heights are in metres, so the tilt is a true slope.
 */
vec3 carBump(float h, vec3 n) {
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) / max(abs(det), 1e-12);
  float l = length(grad);
  return -grad * min(1.0, 1.6 / max(l, 1e-6));
}

/** The direction (view space, along the surface) in which a field d over the surface grows; of length about 1 for a distance. */
vec3 carGrad(float d, vec3 n) {
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  return sign(det) * (dFdx(d) * r1 + dFdy(d) * r2) / max(abs(det), 1e-12);
}

/**
 * What the car hides from itself (p: the point with x mirrored to the left side; n: its normal likewise). The probe
 * is drawn without the car, so it shows a sunlit road under the floor and open sky under the mirrors.
 */
float carOcclusion(vec3 p, vec3 n) {
  float ao = 1.0;
  // the road under the car lies in the car's own shade
  ao *= 1.0 - 0.8 * clamp(0.45 - n.y, 0.0, 1.0) * (1.0 - smoothstep(0.14, 0.5, p.y));
  // the door mirror over the door's shoulder
  vec3 m = vec3(0.915, 1.04, 0.42) - p;
  float md = dot(m, m);
  ao *= 1.0 - 0.7 * clamp(0.0075 / md, 0.0, 1.0) * clamp(dot(n, m) * inversesqrt(md) + 0.35, 0.0, 1.0);
  // the lips that turn in round the wheel arches face the tyres
  if (abs(n.x) < 0.2 && p.x > 0.74 && p.y < 0.74 && abs(abs(p.z) - 1.4325) < 0.42) ao *= 0.3;
  return ao;
}
#define CAR_REGION(w, col, met, rough, coat) { float w_ = (w); cBase = mix(cBase, col, w_); cMetal = mix(cMetal, met, w_); cRough = mix(cRough, rough, w_); cCoat = mix(cCoat, coat, w_); cPaint *= 1.0 - w_; }

/**
 * Flake. The aluminium flakes are far smaller than a pixel, and together they are the paint's broad sheen; but
 * each is a small mirror, and where one happens to lie so that it sends the sun to the eye it flashes. So the
 * surface is cut into cells (never smaller than about a pixel, in two octaves blended into each other, so that
 * the sparkle neither crawls nor turns to noise), each cell holds one flake with a tilt and a brightness of its
 * own, and the paint adds the sun's reflection in it (after lights_fragment_end). Most flakes lie nearly flat, so
 * the glitter is dense in the highlight and thins out round it: it reads as something under the lacquer. It is
 * strongest within arm's reach and gone by about four metres. Nothing else of the paint changes: no grain.
 * Sets the two octaves' tilts (car space; xy the tilt, z the flake's brightness) and their weights.
 */
vec3 cFlakeA; vec3 cFlakeB; vec2 cFlakeW;
void carFlake(float amount) {
  float foot = length(fwidth(vCarPos));
  float fade = amount * (1.0 - smoothstep(0.0012, 0.0045, foot));
  cFlakeW = vec2(0.0);
  if (fade <= 0.0) return;
  float level = max(log2(foot / 0.0003), 0.0);
  float cell = 0.0003 * exp2(floor(level));
  vec3 a = hash33(floor(vCarPos / cell));
  vec3 b = hash33(floor(vCarPos / (2.0 * cell)) + 31.0);
  cFlakeA = vec3(a.xy + a.yz - 1.0, a.z * a.x);
  cFlakeB = vec3(b.xy + b.yz - 1.0, b.z * b.x);
  float f = fract(level);
  cFlakeW = vec2(1.0 - f, f) * fade;
}

/**
 * The smaller forms of the body, as a tilt of the normal (car space) rather than as geometry: they are a few
 * millimetres high but have sharp edges, which no affordable mesh would carry. The power domes on the bonnet,
 * the lower crease of the doors, the side skirt's groove and blade, the flat band round the wheel arches.
 */
vec3 carForm(vec3 p, vec3 n) {
  vec3 tilt = vec3(0.0);
  float side = sign(vCarPos.x);
  // power domes: crests at x 0.27 at the cowl converging to 0.20 at z 1.9, 14 mm high, the outer flank sharper,
  // running out just behind the bonnet's front edge (the press pictures show them the whole length of the bonnet)
  if (n.y > 0.45 && p.z > 0.72 && p.z < 2.1) {
    float crest = mix(0.27, 0.19, clamp((p.z - 0.8) / 1.2, 0.0, 1.0));
    float s = p.x < crest ? 0.06 : 0.03;
    float t = (p.x - crest) / s;
    float a = 0.014 * smoothstep(0.74, 0.92, p.z) * (1.0 - smoothstep(1.8, 2.08, p.z));
    float slope = a * exp(-t * t) * (-2.0 * t / s);
    tilt.x -= side * slope;
  }
  if (abs(n.x) > 0.55) {
    float between = smoothstep(1.06, 1.02, p.z) * smoothstep(-1.06, -1.02, p.z);
    // the lower crease ("light catcher"): below it the door turns under by about 10 degrees
    float yc = p.z > 0.4 ? mix(0.41, 0.385, (p.z - 0.4) / 0.65) : mix(0.462, 0.41, (p.z + 1.02) / 1.42);
    float below = carInside(p.y - yc) * (1.0 - carInside(p.y - 0.297));
    tilt.y -= 0.18 * below * between;
    // the side skirt: an upright face, a groove at 0.245, a blade from 0.19 to 0.235 that looks up at the sky
    float blade = carInside(p.y - 0.232) * (1.0 - carInside(p.y - 0.19)) * smoothstep(0.85, 0.75, p.z) * between;
    tilt.y += 0.3 * blade;
    tilt.y -= 0.35 * carInside(abs(p.y - 0.2455) - 0.004) * between;
  }
  if (abs(n.x) > 0.5) {
    // the band round each arch, 35 mm wide and raised: its outer edge falls away, which catches a highlight
    vec2 c = p.z > 0.0 ? vec2(1.4325, 0.32) : vec2(-1.4325, 0.315);
    vec2 ab = p.z > 0.0 ? vec2(0.385, 0.372) : vec2(0.39, 0.355);
    vec2 q = (p.zy - c) / ab;
    if (q.y > -0.45) {
      float rho = length(q);
      float d = (rho - 1.0) * ab.y - 0.035;
      vec2 radial = normalize(q / ab);
      float w = exp(-(d / 0.007) * (d / 0.007));
      tilt.z += radial.x * 0.35 * w;
      tilt.y += radial.y * 0.35 * w;
    }
  }
  return tilt;
}


/**
 * The grille's field (5.1): gloss black with a fine diamond relief, carrying about 240 small chrome stars on a
 * staggered lattice (34 x 22 mm), none near the big star or the louvre. Each pin is drawn from its own distance
 * and antialiased; once a cell is under a few pixels the pins fade into their average, so the field never
 * crawls at a distance.
 */
void carGrille(vec3 p, float w) {
  // (the field is a lattice of black bars over open holes, not a sheet of lacquer: as a gloss sheet it mirrored the
  // sky and the grille read grey from the chase camera; the photographs show it black with bright stars)
  vec3 col = vec3(0.005, 0.005, 0.006);
  float met = 0.0; float rough = 0.32;
  float foot = length(fwidth(p.xy));
  float detail = 1.0 - smoothstep(0.0015, 0.004, foot);
  // diamond relief
  vec2 dm = vec2(p.x / 0.02, p.y / 0.015);
  vec2 dd = abs(fract(dm) - 0.5);
  cTilt += detail * 0.25 * vec3(sign(fract(dm.x) - 0.5) * step(dd.y, dd.x), sign(fract(dm.y) - 0.5) * step(dd.x, dd.y), 0.0);
  // the lattice of stars (as details.js lays them: GRILLE_STARS)
  float r = floor((p.y - ${f4(GRILLE_STARS.y0 - GRILLE_STARS.dy / 2)}) / ${f4(GRILLE_STARS.dy)});
  float cy = ${f4(GRILLE_STARS.y0)} + r * ${f4(GRILLE_STARS.dy)};
  float off = mod(r, 2.0) * ${f4(GRILLE_STARS.dx / 2)};
  float cx = floor((p.x - off) / ${f4(GRILLE_STARS.dx)} + 0.5) * ${f4(GRILLE_STARS.dx)} + off;
  vec2 q = vec2(p.x - cx, p.y - cy);
  // a three-pointed star: the nearest of three arms, each thinning to its tip
  float d = 1.0;
  for (int i = 0; i < 3; i++) {
    float a = 1.5708 + float(i) * 2.0944;
    vec2 dir = vec2(cos(a), sin(a));
    float t = clamp(dot(q, dir), 0.0, ${f4(GRILLE_STARS.arm)});
    d = min(d, length(q - dir * t) - ${f4(GRILLE_STARS.arm * 0.27)} * (1.0 - t / ${f4(GRILLE_STARS.arm * 1.08)}));
  }
  float keep = step(0.108, length(p.xy - vec2(0.0, 0.573))) * step(0.012, abs(p.y - 0.578) - 0.007 * (1.0 - step(0.49, p.x)));
  float pin = mix(0.08, clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0), detail) * keep * float(GRILLE_PINS);
  col = mix(col, vec3(0.83, 0.84, 0.86), pin); met = mix(met, 1.0, pin); rough = mix(rough, 0.12, pin);
  // the smooth gloss black disc under the big star
  cTilt *= 1.0 - pin;
  cTilt *= step(0.095, length(p.xy - vec2(0.0, 0.573)));
  cTilt.x *= sign(vCarPos.x);
  CAR_REGION(w, col, met, rough, mix(0.3, 1.0, pin));
}

/** Distance from p to the segment a-b. */
float carLine(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
float carTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0; vec2 e1 = p2 - p1; vec2 e2 = p0 - p2;
  vec2 v0 = p - p0; vec2 v1 = p - p1; vec2 v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

/** A point's place in a plane square to v round c (two axes, metres). */
vec2 carPlane(vec3 q, vec3 c, vec3 v) {
  vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), v));
  vec3 e2 = cross(v, e1);
  return vec2(dot(q - c, e1), dot(q - c, e2));
}

`,
    replace: [
      [
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
  {
  vec4 A = carAtlas(carAtlas0);
  vec4 B = carAtlas(carAtlas1);
  float glass = A.r;
  vec3 p = vec3(abs(vCarPos.x), vCarPos.yz);
  bool grille = p.z > 1.9 && p.y > 0.45 && p.y < 0.72 && p.x < 0.56;
  // the openings, the glass and the lenses are other meshes' business (the lamp units stand behind their lenses)
  if ((B.r < 0.0 && !grille) || glass < -0.012 || A.a < -0.002) discard;
  // the tail-pipe trims' openings: their insides are geometry (details.js) behind the skin
  if (p.z < -2.3 && vCarNormal.z < -0.3 && carBox(p.xy, vec2(0.57, 0.31), vec2(0.098, 0.023), 0.006) < 0.0) discard;
  // the wheel arches' holes, exactly: the mesh leaves out only the quads wholly inside them, which would leave
  // a saw-tooth over the tyre. Only the sideways-facing skin (the lip's band faces the wheel, x = 0).
  if (abs(vCarNormal.x) > 0.25 && carArchHole(p)) discard;
  float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  cBase = paintColor * mix(1.0, paintFlop, pow(1.0 - ndv, 1.15));
  cMetal = paintMetal; cRough = paintRough; cCoat = 1.0; cEmit = vec3(0.0); cPaint = 1.0; cTilt = vec3(0.0);
  cHeight = 0.0;
  cAO = carOcclusion(p, vec3(abs(vCarNormal.x), vCarNormal.yz));
  // the tail lamps' own light on the paint round them (the lamp spot in lamps.js cannot reach the car's own
  // panels): a faint red within 3 cm of the lens, stronger with the brake light
  if (p.z < -1.8 && A.a > 0.0) {
    float near = 1.0 - smoothstep(0.0, 0.028, A.a);
    cEmit += vec3(1.0, 0.03, 0.015) * near * near * (0.01 * carLampsA.w + 0.05 * carLampsB.x);
  }
  // under the boot lid's lip (the shoulder's rail at the tail), 9 mm of undercut: a soft shade below the edge
  if (p.z < -2.2) {
    float under = (SHOULDER_V - vSkinUv.y) * EXTENT_V;
    // (it was half the light over 6 cm, and read as a dark band across the lid in the photograph straight on the
    // tail, where the face under the lip is as bright as the rest)
    cAO *= 1.0 - 0.25 * smoothstep(0.0, 0.004, under) * (1.0 - smoothstep(0.006, 0.025, under)) * smoothstep(0.62, 0.4, p.x);
  }
  // the grille's bright frame
  CAR_REGION(carCover(B.r - 0.008) * step(1.9, p.z) * step(0.4, p.y), vec3(0.83, 0.84, 0.86), 1.0, 0.08, 0.0);
  if (grille && B.r < 0.0) carGrille(p, carCover(B.r + 0.004));
  // the rubber seal round every pane, 4 mm of matte black between the glass and the paint
  CAR_REGION(carCover(glass - 0.004), vec3(0.012), 0.0, 0.55, 0.0);
  // gloss black: window surround, belt strip, B-pillar, the frit under the glass's edge, the corner slits
  CAR_REGION(max(carCover(A.g), carCover(glass)), vec3(0.01, 0.01, 0.012), 0.0, 0.06, 1.0);
  // red reflectors
  CAR_REGION(carCover(B.g), vec3(0.30, 0.01, 0.015), 0.0, 0.1, 1.0);
  // the rear bumper's corner scoops (6.4): a shallow triangular recess, darker inside, with a lit lower edge
  if (p.z < -2.1 && p.z > -2.4 && p.y > 0.33 && p.y < 0.64 && p.x > 0.68) {
    vec3 dv = normalize(vec3(0.7, 0.0, -0.7));
    vec3 o = vec3(0.78, 0.6, -2.3);
    float tri = carTriangle(carPlane(p, o, dv), vec2(0.0), carPlane(vec3(0.845, 0.375, -2.155), o, dv), carPlane(vec3(0.74, 0.38, -2.32), o, dv));
    // deepest along its outer edge (where the slit is), running out to nothing towards the inner corner
    vec2 q = carPlane(p, o, dv);
    vec2 outer = normalize(carPlane(vec3(0.845, 0.375, -2.155), o, dv));
    float fromOuter = abs(q.x * outer.y - q.y * outer.x);
    float scoop = (1.0 - smoothstep(-0.014, 0.0, tri)) * (1.0 - smoothstep(0.0, 0.1, fromOuter));
    cHeight -= 0.02 * scoop;
    cAO *= 1.0 - 0.25 * scoop;
  }
  // matte black: the front lip, the diffuser (whose top rail is gloss), and the tail-pipe trims set in it
  if (p.z > 1.6) CAR_REGION(carInside(p.y - mix(0.215, 0.2, smoothstep(0.3, 0.45, p.x))), vec3(0.02, 0.02, 0.022), 0.0, 0.65, 0.0);
  if (p.z < -2.15) {
    float top = 0.395 - 0.035 * smoothstep(0.42, 0.47, p.x) * (1.0 - smoothstep(0.69, 0.74, p.x));
    float diffuser = carInside(p.y - top) * carInside(p.x - 0.72);
    CAR_REGION(diffuser, vec3(0.02, 0.02, 0.022), 0.0, 0.6, 0.0);
    CAR_REGION(diffuser * (1.0 - carInside(p.y - top + 0.02)), vec3(0.01, 0.01, 0.012), 0.0, 0.06, 1.0);
  }
  // the number plates' black carriers (the plates are geometry, details.js), and the rear plate's recess
  if (p.z < -2.3 && vCarNormal.z < -0.5) {
    // the plate's dish: 0.60 x 0.17, 24 mm deep, its walls 28 mm wide
    // (a sharp ledge above, under which the plate lamps sit; sides that lean out; a gentle run-out below)
    float side = 0.262 + 0.22 * (p.y - 0.68);
    float dish = smoothstep(0.0, 0.012, 0.852 - p.y) * smoothstep(0.0, 0.05, p.y - 0.672) * smoothstep(0.0, 0.03, side - p.x);
    cHeight -= 0.026 * dish;
    cAO *= 1.0 - 0.3 * dish - 0.3 * smoothstep(0.0, 0.01, 0.852 - p.y) * smoothstep(0.06, 0.0, 0.852 - p.y) * step(p.x, side);
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.771), vec2(0.27, 0.0675), 0.008)), vec3(0.015), 0.0, 0.5, 0.0);
  }
  if (p.z > 2.1 && vCarNormal.z > 0.5) {
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.392), vec2(0.265, 0.0625), 0.006)), vec3(0.015), 0.0, 0.5, 0.0);
  }
  // door handles (2.8): the dish behind each grip (the grips are geometry, details.js), 14 mm deep
  if (abs(vCarNormal.x) > 0.6 && p.y > 0.78 && p.y < 0.94) {
    vec2 c = p.z > -0.66 ? vec2(-0.147, 0.857) : vec2(-1.18, 0.867);
    float dish = 1.0 - smoothstep(-0.03, 0.006, carBox(vec2(p.z, p.y), c + vec2(0.0, 0.004), vec2(0.14, 0.042), 0.04));
    cHeight -= 0.008 * dish;
    cAO *= 1.0 - 0.3 * dish;
  }
  // the apron's wing (5.3): the paint that frames the intakes below and outside stands out as a rounded blade
  // (its distance to their edges is worked out here: the atlas's is too coarse to be a relief)
  if (p.z > 1.85 && p.y < 0.47 && p.y > 0.17 && B.r > 0.0) {
    float w = min(min(carLine(p.xy, INTAKE_UI, INTAKE_LI), carLine(p.xy, INTAKE_LI, INTAKE_LO)), carLine(p.xy, INTAKE_LO, INTAKE_UO));
    w = min(w, min(carLine(p.xy, INTAKE_C0, INTAKE_C1), min(carLine(p.xy, INTAKE_C1, INTAKE_C2), carLine(p.xy, INTAKE_C2, INTAKE_C3))));
    float t = clamp(w / 0.055, 0.0, 1.0);
    float hump = sin(3.14159 * t);
    // (run out smoothly towards the region's own edges: a cut-off height is a crease)
    float within = smoothstep(0.47, 0.42, p.y) * smoothstep(0.17, 0.2, p.y) * smoothstep(1.85, 1.95, p.z);
    cHeight += 0.007 * hump * hump * within * clamp(0.012 / max(fwidth(w), 1e-5) - 0.5, 0.0, 1.0);
    cAO *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.014, w));
  }
  // shut lines: a dark gap with a little shade either side; the fuel flap (right side only)
  // (the signed channel draws the line; the unsigned one, which interpolates at most about a texel too far,
  // keeps away the zeros the signed one has where its sign flips off the lines)
  float shut = max(abs(B.b), A.b - 0.8 * ATLAS_TEXEL);
  if (vCarPos.x < 0.0 && vCarNormal.x < -0.4) {
    float flap = carBox(vec2(-vCarPos.z, vCarPos.y), vec2(1.71, 0.875), vec2(0.145, 0.07), 0.04);
    shut = min(shut, abs(flap));
  }
  // the lenses and the reflectors sit in their panels with the same fine gap; the parking sensors are 18 mm discs
  shut = min(shut, min(abs(A.a), abs(B.g)));
  if (p.y > 0.42 && p.y < 0.55) {
    float sensor = p.z > 0.0
      ? min(length(p - vec3(0.85, 0.475, 1.82)), length(p - vec3(0.40, 0.45, 2.21)))
      : min(length(p - vec3(0.27, 0.52, -2.52)), min(length(p - vec3(0.64, 0.45, -2.44)), length(p - vec3(0.84, 0.476, -2.10))));
    shut = min(shut, abs(sensor - 0.009) + 0.0008);
  }
  float shutW = max(fwidth(shut), 1e-5);
  // a gap 3 mm wide: at least a pixel wide once a pixel is wider than that, and fainter in proportion
  cShut = clamp(0.5 - (shut - max(0.0015, 0.5 * shutW)) / shutW, 0.0, 1.0) * clamp(0.003 / shutW, 0.45, 1.0);
  cBase *= 1.0 - 0.92 * cShut;
  cAO *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.006, shut));
  cCoat *= 1.0 - cShut;
  // The panels' edges are rounded into the gap, so the far one catches the light. The atlas's distances are too
  // coarse to take a slope from: only the direction of the fall comes from them, its steepness is set here.
  cEdgeD = shut;
  cEdge = 0.4 * smoothstep(0.0008, 0.002, shut) * (1.0 - smoothstep(0.002, 0.0048, shut)) * clamp(0.0036 / shutW - 0.8, 0.0, 1.0);
  }`,
      ],
      ['#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = cBase;'],
      [
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  carFlake(paintFlake * cPaint);\n  roughnessFactor = cRough;',
      ],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = cMetal;'],
      [
        '#include <clearcoat_normal_fragment_maps>',
        /* glsl */ `#include <clearcoat_normal_fragment_maps>
  {
    vec3 tilt = vCarToView * carForm(vec3(abs(vCarPos.x), vCarPos.yz), vCarNormal) * cPaint;
    tilt += carBump(cHeight, normalize(vNormal));
    if (cEdge > 0.0) {
      vec3 fall = carGrad(cEdgeD, normalize(vNormal));
      tilt -= fall * (cEdge / max(length(fall), 1e-4));
    }
    normal = normalize(normal + tilt + vCarToView * cTilt);
    clearcoatNormal = normalize(clearcoatNormal + tilt);
  }
  {
    float foot = length(fwidth(vCarPos));
    // Orange peel: the lacquer is never quite level. A ripple of a few millimetres, a third of a degree steep,
    // which only a grazing mirror image shows, and only from close by.
    float peel = cPaint * (1.0 - smoothstep(0.001, 0.003, foot));
    if (peel > 0.0) {
      vec3 q = vCarPos / 0.0035;
      vec3 ripple = vec3(valueNoise(q), valueNoise(q + 17.3), valueNoise(q + 41.7)) - 0.5;
      clearcoatNormal = normalize(clearcoatNormal + vCarToView * ripple * 0.012 * peel);
    }
  }`,
      ],
      ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += cEmit;'],
      ['#include <aomap_fragment>', '#include <aomap_fragment>\n  if (carDebug > 0.5 && carDebug < 1.5) { reflectedLight.directDiffuse *= 0.0; reflectedLight.directSpecular *= 0.0; clearcoatSpecularDirect *= 0.0; }\n  if (carDebug > 1.5 && carDebug < 2.5) { reflectedLight.indirectDiffuse *= 0.0; reflectedLight.indirectSpecular *= 0.0; clearcoatSpecularIndirect *= 0.0; }\n  if (carDebug > 3.5) { reflectedLight.directDiffuse *= 0.0; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectSpecular *= 0.0; clearcoatSpecularDirect *= 0.0; clearcoatSpecularIndirect *= 0.0; }\n  else if (carDebug > 2.5) { reflectedLight.directDiffuse *= 0.0; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectDiffuse *= 0.0; clearcoatSpecularDirect *= 0.0; }'],
      ['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat *= cCoat;'],
      ['#include <lights_fragment_maps>', REFLECTIONS(true, true, COAT_GAIN, true, true) + '\n#if defined( RE_IndirectDiffuse )\n  if (carDebug > 4.5) iblIrradiance *= 0.0;\n#endif\n'],
      [
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  if (cFlakeW.x + cFlakeW.y > 0.0) {
    // only where the sun reaches the paint at all: what three.js has just added up (shadows included) says so
    float lit = dot(reflectedLight.directSpecular, vec3(0.3333));
    lit = lit / (lit + 0.05);
    // each flake lies within about 10 degrees of flat (most of them much flatter), and mirrors within about 3
    vec3 na = normalize(geometryNormal + vCarToView * vec3(cFlakeA.xy * 0.17, 0.3 * (cFlakeA.x - cFlakeA.y) * 0.17));
    vec3 nb = normalize(geometryNormal + vCarToView * vec3(cFlakeB.xy * 0.17, 0.3 * (cFlakeB.y - cFlakeB.x) * 0.17));
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
      vec3 h = normalize(directionalLights[i].direction + geometryViewDir);
      float glint = cFlakeW.x * (0.25 + 3.0 * cFlakeA.z) * pow(max(dot(na, h), 0.0), 420.0)
        + cFlakeW.y * (0.25 + 3.0 * cFlakeB.z) * pow(max(dot(nb, h), 0.0), 420.0);
      reflectedLight.directSpecular += directionalLights[i].color * mix(vec3(1.0), paintColor, 0.6) * (lit * 1.6 * glint);
    }
  }
#endif`,
      ],
      [
        '#include <aomap_fragment>',
        /* glsl */ `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= cAO;
  reflectedLight.indirectSpecular *= cAO;
  clearcoatSpecularIndirect *= cAO;`,
      ],
    ],
  });
  material.userData.paint = own;
  return material;
}

/**
 * Glass or lamp lens: transparent, mostly a mirror. `channel` is the atlas channel that says where it is
 * (0 glass, 3 lenses). Drawn with premultiplied alpha, so the reflection is not dimmed by the transparency.
 */
export function createGlassMaterial(shared, caps, channel) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.02,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const pick = ['r', 'g', 'b', 'a'][channel & 3];
  patch(material, shared, caps, {
    fragmentPars: 'float glassAlpha; float glassCover; vec3 glassTint = vec3(0.01); float heat = 0.0; float glassRoof = 0.0;',
    replace: [
      [
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
  {
  vec4 A = carAtlas(carAtlas0);
  float d = A.${pick};
  glassCover = carCover(d);
  if (glassCover <= 0.0) discard;
  vec3 n = vCarNormal;
  float transmit; float frit;
  ${
    channel === 0
      ? `if (vCarPos.y > 1.36 && abs(vCarPos.x) < 0.56 && vCarPos.z < 0.05 && vCarPos.z > -1.25 && n.y > 0.6) { transmit = 0.06; frit = 0.015; glassRoof = 1.0; }
  else if (n.y > 0.45 && vCarPos.z > -0.1) { transmit = 0.55; frit = 0.025; }
  else if (n.y > 0.45) {
    // (the atlas holds distances to 30 mm: a band any wider would cover the whole pane)
    transmit = 0.1; frit = 0.028;
    // the heating lines: 14, a millimetre wide, 32 mm apart up the slope, copper-brown
    float t = (vCarPos.y - 1.1076) / 0.0158;
    float k = clamp(floor(t + 0.5), 0.0, 13.0);
    float off = abs(t - k) * 0.032;
    float w = max(fwidth(t) * 0.032, 1e-5);
    heat = clamp((0.0006 - off) / w + 0.5, 0.0, 1.0) * min(1.0, 0.0012 / w) * carCover(d + frit);
    // only where the lines stand 8 pixels or more apart: closer, at a phone's reduced resolution, they beat
    // against the pixels into a banded moire over the whole screen
    heat *= smoothstep(4.0, 8.0, 1.0 / max(fwidth(t), 1e-5));
  }
  else if (vCarPos.z > -0.4) { transmit = 0.5; frit = 0.0; }
  else { transmit = 0.1; frit = 0.0; }`
      : `transmit = vCarPos.z > 0.0 ? 0.94 : 0.74; frit = 0.0;
  // the tail lamp's lens is clear red (the daylight photographs: a bright cherry red unlit, not smoked): it has a
  // colour of its own and holds back some of what is behind it
  glassTint = vCarPos.z > 0.0 ? vec3(0.01) : vec3(0.32, 0.006, 0.009);`
  }
  float band = frit > 0.0 ? 1.0 - carCover(d + frit) : 0.0;
  glassAlpha = mix(1.0 - transmit, 1.0, band);
  glassAlpha = mix(glassAlpha, 1.0, 0.7 * heat);
  glassTint = mix(glassTint, vec3(0.2, 0.09, 0.035), heat);
  // the roof's seam, and the gap between the tail lamp's two pieces, are shut lines on the glass
  float lineW = max(fwidth(A.b), 1e-5);
  glassAlpha = mix(glassAlpha, 1.0, clamp(0.5 - (A.b - max(0.0015, 0.5 * lineW)) / lineW, 0.0, 1.0));
  }`,
      ],
      ['#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = glassTint;'],
      ['#include <lights_fragment_maps>', REFLECTIONS(false, true, 1, false, true)],
      [
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  {
    // The sun in a pane at roughness 0.02 is a peak tens of thousands of times a white wall in the sun: from the
    // chase camera it lay on the glass roof as a blown blob, spread by the bloom (and, where a channel overflowed,
    // tinted cyan). Mirrored glass shows the sun as a small clean spot: the peak is held to a few times the
    // brightness of a sunlit white wall, the roof's to less.
    const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
    float sunY = dot(directionalLights[0].color, Y);
    float cap = sunY * mix(2.5, 0.9, glassRoof);
    float l = dot(reflectedLight.directSpecular, Y);
    if (l > cap) reflectedLight.directSpecular *= cap / l;
    if (glassRoof > 0.0) {
      // the panoramic roof is dark tinted glass with a coating: it mirrors its surroundings dimly, and the bright
      // sky round the sun at a grazing angle is rolled off (above a tenth of the sun's light) instead of filling it
      vec3 r = reflectedLight.indirectSpecular * 0.45;
      // (not under the tunnel's roof, where the lines of luminaires cross it: carBoreLines)
      reflectedLight.indirectSpecular = r / (1.0 + dot(r, Y) / (max(0.1 * sunY, 30.0 * carBoreAt.w) + 1e-6));
    }
  }
#endif`,
      ],
      [
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = (totalDiffuse * glassAlpha + totalSpecular + totalEmissiveRadiance) * glassCover;\n  diffuseColor.a = glassAlpha * glassCover;',
      ],
      ['#include <premultiplied_alpha_fragment>', ''],
    ],
  });
  return material;
}

/**
 * The dark insides: the cabin's stand-in (the shell's back faces, seen through the glass), the recesses behind the
 * openings, the wheel-arch liners. Lit only by the sky and the environment, never directly: the lamps' own lights
 * stand inside the body and would light it up from within.
 */
export function createDarkMaterial(side, value = 0.015, roughness = 0.9, { direct = false, mesh = false, sky = 1 } = {}) {
  const material = new THREE.MeshStandardMaterial({ roughness, metalness: 0, side });
  material.color.setRGB(value, value, value * 1.05, THREE.LinearSRGBColorSpace);
  // `direct`: the cabin, which the sun does reach through the glass (and which the body shades); it sees a third
  // of the sky. `mesh`: the black grid in the intakes, a diamond lattice of 14 x 9 mm drawn where it can be resolved.
  if (direct) material.envMapIntensity = 0.35;
  material.customProgramCacheKey = () => `car dark ${direct} ${mesh} ${sky}`;
  material.onBeforeCompile = (shader) => {
    if (sky < 1) {
      // deep inside an arch or behind an opening only a slot of the surroundings is seen: without this the liners
      // glow sky-blue round the tyres
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= ${sky.toFixed(3)};\n  reflectedLight.indirectSpecular *= ${sky.toFixed(3)};`,
      );
    }
    if (direct) {
      // black leather: the low sun's sheen on it read as cream leather through the glass
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n  reflectedLight.directSpecular *= 0.15;',
      );
    }
    if (!direct) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n  reflectedLight.directDiffuse = vec3(0.0);\n  reflectedLight.directSpecular = vec3(0.0);',
      );
    }
    if (mesh) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;').replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  {
    vec2 cell = vec2(abs(vCarPos.x) / 0.014, vCarPos.y / 0.009);
    vec2 d = abs(fract(vec2(cell.x + cell.y, cell.x - cell.y) * 0.5) - 0.5);
    float foot = length(fwidth(vCarPos.xy));
    float wire = (1.0 - smoothstep(0.08, 0.16, min(d.x, d.y))) * (1.0 - smoothstep(0.002, 0.005, foot));
    diffuseColor.rgb *= mix(0.25, 2.2, wire);
  }`,
      );
    }
  };
  return material;
}

/** The best lap's ghost: one translucent, rim-lit material for everything, unlit. */
export function createGhostMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.FrontSide });
  material.color.setRGB(0.35, 0.6, 1.0, THREE.LinearSRGBColorSpace);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostN;\nvarying vec3 vGhostV;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGhostN = normalize(normalMatrix * normal);\nvGhostV = -mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostN;\nvarying vec3 vGhostV;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float rim = pow(1.0 - abs(dot(normalize(vGhostN), normalize(vGhostV))), 2.0);
  diffuseColor.rgb *= 0.25 + 2.5 * rim;
  diffuseColor.a = 0.12 + 0.5 * rim;`,
      );
  };
  return material;
}

/**
 * The functions of the lamps' parts (lampUnits.js, details.js): each vertex carries one of these numbers, and the
 * lamp-part material gives it its colour unlit and its light by the matching setLights level.
 */
export const LAMP_FN = {
  none: 0,
  thirdBrake: 1,
  plate: 2,
  screen: 3,
  brow: 4, // the head lamp's eyebrow light guide: daytime running light, position light, indicator
  projector: 5, // the dipped beam's glass dome
  matrix: 6, // the main beam's lens over its rows of emitters
  blade: 7, // the tail lamp's rows of blades: tail light
  guide: 8, // the smooth band between them: brake light
  guideOuter: 9, // the same in the outer piece: brake light, and the indicator
  reverse: 10,
  tailHousing: 11, // dark red mirror
  headHousing: 12, // gloss black
  bezel: 13, // satin bright
  accent: 14, // the blue block at the head lamp's outer end
};

/**
 * The solid trim (details.js): stars, louvre, pipe trims (bright metal), mirror caps (gloss black), fins and arms
 * (matte black), mirror glass. The car's probe in the reflection, scaled by the sky, as on the paint.
 */
export function createTrimMaterial(shared, caps, { color, metal, rough, coat = 0, side = THREE.FrontSide }) {
  const material = new THREE.MeshPhysicalMaterial({ metalness: metal, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.03, side });
  material.color.setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace);
  patch(material, shared, caps, { replace: [['#include <lights_fragment_maps>', REFLECTIONS(coat > 0, coat <= 0, 1, false, true)]] });
  return material;
}

/** Number plates: the generated picture, embossed, a little glossy; the rear one lit by its lamps with the tail lamps. */
export function createPlateMaterial(shared, caps, { map, normalMap }) {
  const material = new THREE.MeshPhysicalMaterial({ map, normalMap, roughness: 0.35, metalness: 0 });
  material.normalScale.set(0.6, 0.6);
  patch(material, shared, caps, {
    replace: [
      ['#include <lights_fragment_maps>', REFLECTIONS(false)],
      ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * step(vCarPos.z, 0.0) * carLampsA.w * 0.035;'],
    ],
  });
  return material;
}

/**
 * The lamps' parts and the displays: one material, many looks. What a vertex is (LAMP_FN) decides its colour,
 * metalness and roughness unlit, and what it emits when its function is on. The same numbers serve by day and at
 * night, when the exposure is 18 times higher: the tail light is set so that its blades stay red at night (0.4 x 18,
 * the red channel alone clips), the brake light so that it reads as lit under the sun (9) and blows out to a white
 * core in a red glow at night, as it does in a photograph.
 */
export function createLampPartMaterial(shared, caps) {
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.15, metalness: 0 });
  const F = LAMP_FN;
  patch(material, shared, caps, {
    vertexPars: 'attribute float lampFn;\nvarying float vLampFn;\nvarying vec2 vLampUv;\n',
    vertexMain: 'vLampFn = lampFn;\nvLampUv = uv;\n',
    fragmentPars: /* glsl */ `
varying float vLampFn;
varying vec2 vLampUv;
vec3 lBase; float lMetal; float lRough; vec3 lEmit;
void carLampPart() {
  int f = int(vLampFn + 0.5);
  float indicator = vCarPos.x > 0.0 ? carLampsB.z : carLampsB.w;
  float beam = min(carLampsA.y + carLampsA.z, 1.0);
  vec3 red = vec3(1.0, 0.02, 0.01);
  vec3 amber = vec3(1.0, 0.41, 0.035);
  vec3 white = vec3(0.95, 0.97, 1.0);
  lBase = vec3(0.02); lMetal = 0.0; lRough = 0.15; lEmit = vec3(0.0);
  if (f == ${F.thirdBrake}) {
    // it shines backwards only: lit on every face, it glowed through the cabin and the windscreen from ahead
    lBase = vec3(0.05, 0.004, 0.005); lEmit = red * 18.0 * carLampsB.x * step(vCarNormal.z, -0.5);
  }
  else if (f == ${F.plate}) { lBase = vec3(0.3); lEmit = vec3(1.0, 0.97, 0.92) * 2.0 * carLampsA.w; }
  else if (f == ${F.screen}) {
    // the displays dim themselves in the dark, as a car's do (to a few white papers of the moment's light): at full
    // brightness, under the night's exposure, they shone through the roof and the rear screen as white bars
    lBase = vec3(0.004); lRough = 0.06; lEmit = vec3(0.55, 0.7, 1.0) * min(1.2, 6.0 * carKey) * carLampsC.x;
  }
  else if (f == ${F.brow}) {
    // a frosted bar; the white goes out on the side that indicates
    lBase = vec3(0.32, 0.33, 0.34); lRough = 0.5;
    lEmit = mix(vec3(1.0, 0.97, 0.93) * 3.5 * carLampsA.x, amber * 8.0, indicator);
  } else if (f == ${F.projector}) {
    // a dome of dark glass with the reflector's ring glinting through it; lit, it glows from the middle
    float r = 1.0 - vLampUv.y;
    lBase = mix(vec3(0.012), vec3(0.12), 1.0 - smoothstep(0.03, 0.09, abs(r - 0.62)));
    lRough = 0.035;
    lEmit = white * beam * (0.5 * (1.0 - 0.8 * r * r) + 0.06);
  } else if (f == ${F.matrix}) {
    float dots = step(0.55, fract(vLampUv.x * 10.0)) * step(0.5, fract(vLampUv.y * 6.0));
    lBase = vec3(0.012 + 0.12 * dots); lMetal = 0.6; lRough = 0.1;
    lEmit = white * (carLampsA.z + 0.15 * carLampsA.y) * (0.8 + 4.0 * dots);
  } else if (f == ${F.blade}) {
    lBase = vec3(0.75, 0.024, 0.026); lMetal = 0.35; lRough = 0.2;
    // lit, each blade is a slim slanted bar of light; the brake light brightens them too
    lEmit = red * (0.55 * carLampsA.w + 2.2 * carLampsB.x);
  } else if (f == ${F.guide} || f == ${F.guideOuter}) {
    lBase = vec3(0.42, 0.018, 0.022); lRough = 0.45;
    // the inner line: with the tail light alone a slim bright red line through the lamp (the light signature's
    // spine, brighter than the blades); with the brake light the whole band, a white-hot core at night
    lEmit = red * (9.0 * carLampsB.x + 1.4 * carLampsA.w);
    if (f == ${F.guideOuter}) lEmit = mix(lEmit, amber * 34.0, indicator);
  } else if (f == ${F.reverse}) {
    lBase = vec3(0.5); lMetal = 0.7; lRough = 0.15; lEmit = vec3(1.0, 0.98, 0.95) * 14.0 * carLampsB.y;
  } else if (f == ${F.tailHousing}) {
    // red chrome in fine horizontal steps: behind the clear red lens it is what makes the lamp read bright red by day
    lBase = vec3(0.78, 0.02, 0.024) * (0.65 + 0.35 * step(0.5, fract(vCarPos.y / 0.006)));
    lMetal = 0.85; lRough = 0.28;
    // only a faint fill: lit any brighter, the whole housing glowed and the bloom made each lamp one red blob
    lEmit = red * (0.012 * carLampsA.w + 0.08 * carLampsB.x);
  } else if (f == ${F.headHousing}) {
    lBase = vec3(0.012); lRough = 0.12; lEmit = white * beam * 0.006;
  } else if (f == ${F.bezel}) {
    // dark satin: unlit, the daylight photographs show the lamp's inside nearly black behind the clear cover
    lBase = vec3(0.24); lMetal = 1.0; lRough = 0.3;
  } else if (f == ${F.accent}) {
    lBase = vec3(0.01, 0.04, 0.22); lRough = 0.2; lEmit = vec3(0.05, 0.2, 1.0) * 0.35 * carLampsA.x;
  }
}`,
    replace: [
      ['#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  carLampPart();'],
      ['#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = lBase;'],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = lRough;'],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = lMetal;'],
      ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += lEmit;'],
      ['#include <lights_fragment_maps>', REFLECTIONS(false)],
    ],
  });
  return material;
}
