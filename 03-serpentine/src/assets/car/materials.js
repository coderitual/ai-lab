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
//    (GLSL_PROBE) instead of the far environment map, and every reflection is
//    scaled by how much sky is overhead (setReflections), so the car goes dark
//    in a tunnel. The base layer keeps the scene's environment map.

import * as THREE from 'three';
import { GLSL_HASH, GLSL_PROBE, targetDefines } from '../../engine/glsl.js';
import { RANGE } from './atlas.js';
import { ARCHES } from './features.js';

/** The paints: base colour (linear), metalness and roughness of the flake layer, how dark it gets edge-on (flop), and how much flake shows. */
export const PAINTS = {
  silver: { color: [0.63, 0.65, 0.67], metal: 1, rough: 0.38, flop: 0.42, flake: 1 }, // high-tech silver: this car
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
    // lamps: drl, low, high, tail / brake, reverse, indicator left, indicator right
    carLampsA: { value: new THREE.Vector4() },
    carLampsB: { value: new THREE.Vector4() },
    // interior, and three spare
    carLampsC: { value: new THREE.Vector4() },
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

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D carAtlas0;
uniform sampler2D carAtlas1;
uniform float carRange;
uniform samplerCube carProbe;
uniform float carProbeOn;
uniform float carSky;
uniform vec4 carLampsA;
uniform vec4 carLampsB;
uniform vec4 carLampsC;
varying vec2 vSkinUv;
varying vec3 vCarPos;
varying vec3 vCarNormal;
varying mat3 vCarToView;
${GLSL_HASH}
${GLSL_PROBE}
vec4 carAtlas(sampler2D t) { return (texture2D(t, vSkinUv) * 255.0 - 127.5) / 127.5 * carRange; }
/** How much of the pixel is inside (distance < 0), antialiased by the distance's own footprint. */
float carCover(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0); }
/** The same for a distance that is analytic in car space. */
float carInside(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0); }
/** Distance from p to the segment a-b, measured square to the direction v. */
float carSegment(vec3 p, vec3 a, vec3 b, vec3 v) {
  p -= v * dot(p, v); a -= v * dot(a, v); b -= v * dot(b, v);
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t);
}
${ARCH_HOLE}
float carBox(vec2 p, vec2 c, vec2 half_, float r) {
  vec2 q = abs(p - c) - half_ + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

/** Reflections: the probe in the clear coat (or, for glass, the only specular layer), all of it scaled by the sky. */
const REFLECTIONS = (coat) => /* glsl */ `
#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  ${
    coat
      ? `
  #ifdef USE_CLEARCOAT
  {
    vec3 r = inverseTransformDirection(reflect(-geometryViewDir, geometryClearcoatNormal), viewMatrix);
    clearcoatRadiance = mix(clearcoatRadiance, probeSample(carProbe, r, material.clearcoatRoughness), carProbeOn);
  }
  #endif
  clearcoatRadiance *= carSky;`
      : `
  {
    vec3 r = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
    radiance = mix(radiance, probeSample(carProbe, r, material.roughness), carProbeOn);
  }`
  }
  radiance *= carSky;
#endif
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= mix(0.3, 1.0, carSky);
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
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}\n${fragmentPars}`);
    for (const [from, to] of replace) {
      if (!f.includes(from)) throw new Error(`car material: no ${from}`);
      f = f.replace(from, to);
    }
    shader.fragmentShader = f;
  };
}

/** The paint, and everything else opaque on the skin. */
export function createPaintMaterial(shared, caps, paintName = 'silver') {
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
    fragmentPars: /* glsl */ `
uniform vec3 paintColor;
uniform float paintMetal;
uniform float paintRough;
uniform float paintFlop;
uniform float paintFlake;
vec3 cBase; float cMetal; float cRough; float cCoat; vec3 cEmit; float cShut; float cPaint; vec3 cTilt;
#define CAR_REGION(w, col, met, rough, coat) { float w_ = (w); cBase = mix(cBase, col, w_); cMetal = mix(cMetal, met, w_); cRough = mix(cRough, rough, w_); cCoat = mix(cCoat, coat, w_); cPaint *= 1.0 - w_; }

/**
 * The smaller forms of the body, as a tilt of the normal (car space) rather than as geometry: they are a few
 * millimetres high but have sharp edges, which no affordable mesh would carry. The power domes on the bonnet,
 * the lower crease of the doors, the side skirt's groove and blade, the flat band round the wheel arches.
 */
vec3 carForm(vec3 p, vec3 n) {
  vec3 tilt = vec3(0.0);
  float side = sign(vCarPos.x);
  // power domes: crests at x 0.27 at the cowl converging to 0.20 at z 1.9, 9 mm high, the outer flank sharper
  if (n.y > 0.5 && p.z > 0.72 && p.z < 2.0) {
    float crest = mix(0.27, 0.20, clamp((p.z - 0.8) / 1.1, 0.0, 1.0));
    float s = p.x < crest ? 0.055 : 0.028;
    float t = (p.x - crest) / s;
    float a = 0.009 * smoothstep(0.74, 0.9, p.z) * (1.0 - smoothstep(1.6, 1.95, p.z));
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
  vec3 col = vec3(0.01, 0.01, 0.012);
  float met = 0.0; float rough = 0.08;
  float foot = length(fwidth(p.xy));
  float detail = 1.0 - smoothstep(0.0012, 0.003, foot);
  // diamond relief
  vec2 dm = vec2(p.x / 0.017, p.y / 0.011);
  vec2 dd = abs(fract(dm) - 0.5);
  cTilt += detail * 0.25 * vec3(sign(fract(dm.x) - 0.5) * step(dd.y, dd.x), sign(fract(dm.y) - 0.5) * step(dd.x, dd.y), 0.0);
  float r = floor((p.y - 0.464) / 0.022);
  float cy = 0.475 + r * 0.022;
  float off = mod(r, 2.0) * 0.017;
  float cx = floor((p.x - off) / 0.034 + 0.5) * 0.034 + off;
  vec2 q = vec2(p.x - cx, p.y - cy);
  // a three-pointed star 12 mm across: the nearest of three arms, each thinning to its tip
  float d = 1.0;
  for (int i = 0; i < 3; i++) {
    float a = 1.5708 + float(i) * 2.0944;
    vec2 dir = vec2(cos(a), sin(a));
    float t = clamp(dot(q, dir), 0.0, 0.006);
    d = min(d, length(q - dir * t) - 0.0016 * (1.0 - t / 0.0065));
  }
  float keep = step(0.108, length(p.xy - vec2(0.0, 0.573))) * step(0.012, abs(p.y - 0.578) - 0.007 * (1.0 - step(0.49, p.x)));
  float pin = mix(0.07, clamp(0.5 - d / max(fwidth(d), 1e-5), 0.0, 1.0), detail) * keep;
  col = mix(col, vec3(0.83, 0.84, 0.86), pin); met = mix(met, 1.0, pin); rough = mix(rough, 0.12, pin);
  // the smooth gloss black disc under the big star
  cTilt *= 1.0 - pin;
  cTilt *= step(0.095, length(p.xy - vec2(0.0, 0.573)));
  cTilt.x *= sign(vCarPos.x);
  CAR_REGION(w, col, met, rough, 1.0);
}

/** Where the ray from the eye through this pixel of a lens meets a layer d behind it (car space, left side). */
vec3 carDeep(vec3 eye, float cosv, float d) {
  vec3 q = vCarPos - eye * (d / cosv);
  return vec3(abs(q.x), q.yz);
}
/** A point's place in a plane square to v round c (two axes, metres). */
vec2 carPlane(vec3 q, vec3 c, vec3 v) {
  vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), v));
  vec3 e2 = cross(v, e1);
  return vec2(dot(q - c, e1), dot(q - c, e2));
}

/**
 * The lamp units, seen through their flush lenses. Nothing here is geometry: each part is a layer at its own
 * depth behind the lens, found by following the view ray in (parallax), so the blades, the light guides and the
 * modules shift against each other and against the housing as the camera moves. The lens itself (the glass
 * mesh) is the only reflection on top; the parts' own shading uses cTilt for their curvature.
 */
void carLamp(float lens, float w) {
  if (w <= 0.0) return;
  bool left = vCarPos.x > 0.0;
  vec3 eye = normalize(transpose(vCarToView) * vViewPosition);
  vec3 n = normalize(vCarNormal);
  float cosv = max(dot(eye, n), 0.3);
  float inside = -lens; // m inside the lens's outline, measured on the skin
  float indicator = left ? carLampsB.z : carLampsB.w;
  vec3 col; float met; float rough; vec3 emit = vec3(0.0);
  if (vCarPos.z > 0.0) {
    // ---- head lamp (5.2): gloss black housing 50 mm deep; the two modules and the blue accent 40 mm in; the
    // eyebrow light guide just under the lens, with its hook down the inner edge
    vec3 v = normalize(vec3(0.6, 0.2, 0.77));
    vec3 qb = carDeep(eye, cosv, 0.05);
    vec3 qm = carDeep(eye, cosv, 0.04);
    vec3 qe = carDeep(eye, cosv, 0.007);
    // housing: black, with satin rings round the module wells and a shadow under the lens's edge
    col = vec3(0.012); met = 0.0; rough = 0.12;
    vec2 pb = carPlane(qb, vec3(0.615, 0.663, 1.975), v);
    vec2 mb = carPlane(qb, vec3(0.715, 0.672, 1.862), v);
    float well = min(carBox(pb, vec2(0.0), vec2(0.044), 0.012), carBox(mb, vec2(0.0), vec2(0.046, 0.034), 0.012));
    float ring = carInside(abs(well) - 0.004);
    col = mix(col, vec3(0.55), ring); met = mix(met, 1.0, ring); rough = mix(rough, 0.3, ring);
    col *= 0.35 + 0.65 * smoothstep(0.0, 0.02, inside);
    // the modules
    vec2 pp = carPlane(qm, vec3(0.615, 0.663, 1.975), v);
    vec2 pm = carPlane(qm, vec3(0.715, 0.672, 1.862), v);
    vec2 pa = carPlane(qm, vec3(0.555, 0.668, 2.04), v);
    vec2 pc = carPlane(qm, vec3(0.78, 0.69, 1.77), v);
    float rp = length(pp) / 0.0325;
    float rm = length(pm / vec2(0.035, 0.0225));
    float bezel = carInside(carBox(pp, vec2(0.0), vec2(0.04), 0.008)) + carInside(carBox(pm, vec2(0.0), vec2(0.042, 0.03), 0.008));
    col = mix(col, vec3(0.7), bezel); met = mix(met, 1.0, bezel); rough = mix(rough, 0.22, bezel);
    float lensP = carInside((rp - 1.0) * 0.0325);
    float lensM = carInside((rm - 1.0) * 0.0225);
    // projector lenses: dark domes of glass with a chrome reflector glinting through them
    vec3 glassCol = mix(vec3(0.015), vec3(0.18), carInside(abs(rp - 0.62) * 0.0325 - 0.003));
    col = mix(col, glassCol, lensP); met = mix(met, 0.0, lensP); rough = mix(rough, 0.04, lensP);
    vec3 dots = vec3(0.02 + 0.25 * step(0.6, fract(pm.x / 0.007)) * step(0.5, fract(pm.y / 0.008)));
    col = mix(col, dots, lensM); met = mix(met, 0.6, lensM); rough = mix(rough, 0.1, lensM);
    float aux = carInside(length(pa / vec2(0.015, 0.02)) * 0.015 - 0.015);
    col = mix(col, vec3(0.6), aux); met = mix(met, 1.0, aux); rough = mix(rough, 0.15, aux);
    float accent = carInside(carBox(pc, vec2(0.0), vec2(0.022, 0.015), 0.006));
    col = mix(col, vec3(0.02, 0.10, 0.55), accent); met = mix(met, 0.0, accent); rough = mix(rough, 0.2, accent);
    // the domes' curvature, for their highlights
    vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), v)); vec3 e2 = cross(v, e1);
    cTilt = (e1 * pp.x + e2 * pp.y) / 0.0325 * 0.7 * lensP + (e1 * pm.x + e2 * pm.y) / 0.035 * 0.5 * lensM;
    // eyebrow (frosted bar, 12 mm) and hook
    float brow = min(carSegment(qe, vec3(0.535, 0.70, 2.045), vec3(0.80, 0.74, 1.735), v),
                     carSegment(qe, vec3(0.535, 0.70, 2.045), vec3(0.515, 0.655, 2.09), v));
    float browW = carInside(brow - 0.006);
    col = mix(col, vec3(0.62, 0.63, 0.65), browW); met = mix(met, 0.0, browW); rough = mix(rough, 0.45, browW);
    cTilt *= 1.0 - browW;
    vec3 drl = mix(vec3(1.0, 0.97, 0.93) * 30.0 * carLampsA.x, vec3(1.0, 0.42, 0.04) * 40.0, indicator);
    emit += browW * drl + carInside(brow - 0.012) * (1.0 - browW) * drl * 0.08;
    // dipped beam: the projector glows from within; main beam lights the matrix module's rows too
    float beam = min(carLampsA.y + carLampsA.z, 1.0);
    emit += vec3(0.95, 0.97, 1.0) * lensP * beam * (14.0 * (1.0 - 0.6 * rp * rp) + 2.0);
    emit += vec3(0.95, 0.97, 1.0) * lensM * (carLampsA.z + 0.15 * carLampsA.y) * (4.0 + 18.0 * dots.r);
    emit += vec3(0.95, 0.97, 1.0) * (1.0 - lensP) * (1.0 - lensM) * beam * 0.06 * (1.0 - browW);
  } else {
    // ---- tail lamp (6.2): two rows of slanted blades 8 mm in, a smooth light guide between them 14 mm in, the
    // reversing lamp's window by the inner tip, and a dark red mirror of a housing 25 mm in
    vec3 qf = carDeep(eye, cosv, 0.008);
    vec3 qg = carDeep(eye, cosv, 0.014);
    vec3 qb = carDeep(eye, cosv, 0.025);
    // edges of the lamp from behind (x, y): upper nearly straight, lower one diagonal to the lowest point
    #define TAIL_UP(x) (0.866 + 0.044 * clamp(((x) - 0.37) / 0.39, 0.0, 1.0))
    #define TAIL_LOW(x) ((x) < 0.66 ? 0.852 - 0.1 * ((x) - 0.37) / 0.29 : 0.752 + 0.126 * ((x) - 0.66) / 0.182)
    // housing: dark red chrome in horizontal steps, shaded by its walls near the edge
    col = vec3(0.11, 0.008, 0.01) * (0.7 + 0.3 * step(0.5, fract(qb.y / 0.006)));
    met = 0.85; rough = 0.3;
    float wall = smoothstep(0.0, 0.006 + 0.025 * sqrt(1.0 - cosv * cosv) / cosv, inside);
    col *= 0.25 + 0.75 * wall;
    emit += vec3(1.0, 0.02, 0.01) * (0.35 * carLampsA.w + 1.6 * carLampsB.x) * (0.3 + 0.7 * wall);
    // the light guide between the rows: wide in the outer piece, a slim strip through the inner one
    float x = qg.x;
    float yu = TAIL_UP(x); float yl = TAIL_LOW(x);
    float outer = smoothstep(0.54, 0.6, x);
    float c = mix(yu - 0.034, 0.5 * (yu + yl), outer);
    float hh = mix(0.0035, mix(0.013, 0.005, clamp((x - 0.6) / 0.22, 0.0, 1.0)), outer);
    float guide = carInside(abs(qg.y - c) - hh) * step(0.39, x) * carInside(x - 0.825);
    col = mix(col, vec3(0.3, 0.025, 0.03), guide); met = mix(met, 0.0, guide); rough = mix(rough, 0.5, guide);
    float amber = indicator * step(0.6, x);
    emit += guide * mix(vec3(1.0, 0.02, 0.01) * (30.0 * carLampsB.x + 0.8 * carLampsA.w), vec3(1.0, 0.4, 0.03) * 34.0, amber);
    // the reversing lamp's clear window
    float rev = carInside(carBox(qg.xy, vec2(0.407, 0.858), vec2(0.021, 0.008), 0.003));
    col = mix(col, vec3(0.55), rev); met = mix(met, 0.7, rev); rough = mix(rough, 0.15, rev);
    emit = mix(emit, vec3(1.0, 0.98, 0.95) * 14.0 * carLampsB.y, rev);
    // blades: 22 x 5 mm, leaning 35 degrees, 37 mm apart; the upper row leans out, the lower row in
    x = qf.x;
    yu = TAIL_UP(x); yl = TAIL_LOW(x);
    float upRow = carInside(abs(qf.y - (yu - 0.016)) - 0.008) * step(0.44, x) * carInside(x - 0.82);
    float lowRow = carInside(abs(qf.y - (yl + 0.014)) - 0.008) * step(0.54, x) * carInside(x - 0.8);
    float su = fract((x - 0.7 * qf.y) / 0.037) - 0.5;
    float sl = fract((x + 0.7 * qf.y) / 0.037) - 0.5;
    float bw = max(fwidth(x) / 0.037, 1e-4);
    float bladeU = clamp((0.068 - abs(su)) / bw + 0.5, 0.0, 1.0) * upRow;
    float bladeL = clamp((0.068 - abs(sl)) / bw + 0.5, 0.0, 1.0) * lowRow;
    float blade = max(bladeU * mix(0.6, 1.0, smoothstep(0.56, 0.6, x)), bladeL);
    col = mix(col, vec3(0.45, 0.03, 0.03), blade); met = mix(met, 0.3, blade); rough = mix(rough, 0.2, blade);
    emit = mix(emit, vec3(1.0, 0.03, 0.01) * (7.0 * carLampsA.w + 1.5 * carLampsB.x), blade);
    // the blades' faces turn a little towards the outer tip: they catch the light one by one
    cTilt = vec3(0.25 * blade, 0.0, 0.0);
    // the smoked lens over everything
    col *= vec3(1.0, 0.75, 0.75);
  }
  if (!left) cTilt.x = -cTilt.x;
  cTilt *= w;
  CAR_REGION(w, col, met, rough, 0.0);
  cEmit += w * emit;
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
  if ((B.r < 0.0 && !grille) || glass < -0.012) discard;
  // the tail-pipe trims' openings: their insides are geometry (details.js) behind the skin
  if (p.z < -2.3 && vCarNormal.z < -0.3 && carBox(p.xy, vec2(0.57, 0.31), vec2(0.098, 0.023), 0.006) < 0.0) discard;
  // the wheel arches' holes, exactly: the mesh leaves out only the quads wholly inside them, which would leave
  // a saw-tooth over the tyre. Only the sideways-facing skin (the lip's band faces the wheel, x = 0).
  if (abs(vCarNormal.x) > 0.25 && carArchHole(p)) discard;
  float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  cBase = paintColor * mix(1.0, paintFlop, pow(1.0 - ndv, 1.5));
  cMetal = paintMetal; cRough = paintRough; cCoat = 1.0; cEmit = vec3(0.0); cPaint = 1.0; cTilt = vec3(0.0);
  // the grille's bright frame
  CAR_REGION(carCover(B.r - 0.008) * step(1.9, p.z) * step(0.4, p.y), vec3(0.83, 0.84, 0.86), 1.0, 0.08, 0.0);
  if (grille && B.r < 0.0) carGrille(p, carCover(B.r + 0.004));
  // gloss black: window surround, belt strip, B-pillar, the frit under the glass's edge, the corner slits
  CAR_REGION(max(carCover(A.g), carCover(glass)), vec3(0.01, 0.01, 0.012), 0.0, 0.06, 1.0);
  // red reflectors
  CAR_REGION(carCover(B.g), vec3(0.30, 0.01, 0.015), 0.0, 0.1, 1.0);
  // matte black: the front lip, the diffuser (whose top rail is gloss), and the tail-pipe trims set in it
  if (p.z > 1.6) CAR_REGION(carInside(p.y - 0.215), vec3(0.02, 0.02, 0.022), 0.0, 0.65, 0.0);
  if (p.z < -2.15) {
    float top = 0.395 - 0.035 * smoothstep(0.42, 0.47, p.x) * (1.0 - smoothstep(0.69, 0.74, p.x));
    float diffuser = carInside(p.y - top) * carInside(p.x - 0.72);
    CAR_REGION(diffuser, vec3(0.02, 0.02, 0.022), 0.0, 0.6, 0.0);
    CAR_REGION(diffuser * (1.0 - carInside(p.y - top + 0.02)), vec3(0.01, 0.01, 0.012), 0.0, 0.06, 1.0);
  }
  // the number plates' black carriers (the plates are geometry, details.js), and the rear plate's recess
  if (p.z < -2.3 && vCarNormal.z < -0.5) {
    float recess = carBox(vCarPos.xy, vec2(0.0, 0.765), vec2(0.30, 0.085), 0.025);
    cBase *= 1.0 - 0.3 * carInside(recess) * (1.0 - smoothstep(-0.025, 0.0, -recess - 0.0));
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.771), vec2(0.27, 0.0675), 0.008)), vec3(0.015), 0.0, 0.5, 0.0);
  }
  if (p.z > 2.1 && vCarNormal.z > 0.5) {
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.392), vec2(0.265, 0.0625), 0.006)), vec3(0.015), 0.0, 0.5, 0.0);
  }
  // door handles (2.8): a painted grip over a darker recess, with a bright insert along its lower half
  if (abs(vCarNormal.x) > 0.6 && p.y > 0.8 && p.y < 0.92) {
    vec2 c = p.z > -0.66 ? vec2(-0.147, 0.857) : vec2(-1.18, 0.867);
    vec2 q = vec2(p.z, p.y);
    cBase *= 1.0 - 0.4 * carInside(carBox(q, c, vec2(0.13, 0.035), 0.03)) * (1.0 - carInside(carBox(q, c, vec2(0.1175, 0.014), 0.012)));
    cBase *= 1.0 - 0.6 * carInside(abs(carBox(q, c, vec2(0.1175, 0.014), 0.012)) - 0.001);
    CAR_REGION(carInside(carBox(q, c - vec2(0.0, 0.007), vec2(0.105, 0.0045), 0.004)), vec3(0.83, 0.84, 0.86), 1.0, 0.1, 0.0);
  }
  carLamp(A.a, carCover(A.a));
  // shut lines: a dark gap with a little shade either side; the fuel flap (right side only)
  float shut = A.b;
  if (vCarPos.x < 0.0 && vCarNormal.x < -0.4) {
    float flap = carBox(vec2(-vCarPos.z, vCarPos.y), vec2(1.71, 0.875), vec2(0.145, 0.07), 0.04);
    shut = min(shut, abs(flap));
  }
  float shutW = max(fwidth(shut), 1e-5);
  // a gap 3 mm wide: at least a pixel wide once a pixel is wider than that, and fainter in proportion
  cShut = clamp(0.5 - (shut - max(0.0015, 0.5 * shutW)) / shutW, 0.0, 1.0) * clamp(0.003 / shutW, 0.45, 1.0);
  cBase *= (1.0 - 0.9 * cShut) * (1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.005, shut)));
  cCoat *= 1.0 - cShut;
  }`,
      ],
      ['#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = cBase;'],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = cRough;'],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = cMetal;'],
      [
        '#include <clearcoat_normal_fragment_maps>',
        /* glsl */ `#include <clearcoat_normal_fragment_maps>
  {
    vec3 tilt = vCarToView * carForm(vec3(abs(vCarPos.x), vCarPos.yz), vCarNormal) * cPaint;
    normal = normalize(normal + tilt + vCarToView * cTilt);
    clearcoatNormal = normalize(clearcoatNormal + tilt);
  }
  {
    // flake: each cell of 0.4 mm tilts the base layer's normal a little; it fades out before a cell gets smaller
    // than a pixel, so it sparkles close up and never shimmers further away
    float foot = length(fwidth(vCarPos));
    float flake = paintFlake * cPaint * (1.0 - smoothstep(0.0002, 0.0007, foot));
    if (flake > 0.0) normal = normalize(normal + (hash33(vCarPos / 0.0004) - 0.5) * 0.22 * flake);
  }`,
      ],
      ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += cEmit;'],
      ['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat *= cCoat;'],
      ['#include <lights_fragment_maps>', REFLECTIONS(true)],
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
    fragmentPars: 'float glassAlpha; float glassCover;',
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
      ? `if (vCarPos.y > 1.36 && abs(vCarPos.x) < 0.56 && vCarPos.z < 0.05 && vCarPos.z > -1.25 && n.y > 0.6) { transmit = 0.06; frit = 0.015; }
  else if (n.y > 0.45 && vCarPos.z > -0.1) { transmit = 0.75; frit = 0.025; }
  else if (n.y > 0.45) { transmit = 0.15; frit = 0.035; }
  else if (vCarPos.z > -0.4) { transmit = 0.72; frit = 0.0; }
  else { transmit = 0.15; frit = 0.0; }`
      : 'transmit = 0.94; frit = 0.0;'
  }
  float band = frit > 0.0 ? 1.0 - carCover(d + frit) : 0.0;
  glassAlpha = mix(1.0 - transmit, 1.0, band);
  // the roof's seam, and the gap between the tail lamp's two pieces, are shut lines on the glass
  float lineW = max(fwidth(A.b), 1e-5);
  glassAlpha = mix(glassAlpha, 1.0, clamp(0.5 - (A.b - max(0.0015, 0.5 * lineW)) / lineW, 0.0, 1.0));
  }`,
      ],
      ['#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vec3(0.01);'],
      ['#include <lights_fragment_maps>', REFLECTIONS(false)],
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
export function createDarkMaterial(side, value = 0.015, roughness = 0.9) {
  const material = new THREE.MeshStandardMaterial({ roughness, metalness: 0, side });
  material.color.setRGB(value, value, value * 1.05, THREE.LinearSRGBColorSpace);
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n  reflectedLight.directDiffuse = vec3(0.0);\n  reflectedLight.directSpecular = vec3(0.0);',
    );
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
 * The functions of the small lamps built as geometry (details.js): each vertex carries one of these numbers, and
 * the emitter material lights it by the matching setLights level and colour.
 */
export const LAMP_FN = { none: 0, thirdBrake: 1, plate: 2, screen: 3 };

/**
 * The solid trim (details.js): stars, louvre, pipe trims (bright metal), mirror caps (gloss black), fins and arms
 * (matte black), mirror glass. The car's probe in the reflection, scaled by the sky, as on the paint.
 */
export function createTrimMaterial(shared, caps, { color, metal, rough, coat = 0, side = THREE.FrontSide }) {
  const material = new THREE.MeshPhysicalMaterial({ metalness: metal, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.03, side });
  material.color.setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace);
  patch(material, shared, caps, { replace: [['#include <lights_fragment_maps>', REFLECTIONS(coat > 0)]] });
  return material;
}

/** Number plates: the generated picture, embossed, a little glossy; the rear one lit by its lamps with the tail lamps. */
export function createPlateMaterial(shared, caps, { map, normalMap }) {
  const material = new THREE.MeshPhysicalMaterial({ map, normalMap, roughness: 0.35, metalness: 0 });
  material.normalScale.set(0.6, 0.6);
  patch(material, shared, caps, {
    replace: [
      ['#include <lights_fragment_maps>', REFLECTIONS(false)],
      ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * step(vCarPos.z, 0.0) * carLampsA.w * 0.06;'],
    ],
  });
  return material;
}

/** The small lamps and the displays: dark glass that glows by function (LAMP_FN). */
export function createEmitterMaterial(shared, caps) {
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.15, metalness: 0 });
  material.color.setRGB(0.02, 0.008, 0.008, THREE.LinearSRGBColorSpace);
  patch(material, shared, caps, {
    vertexPars: 'attribute float lampFn;\nvarying float vLampFn;\n',
    vertexMain: 'vLampFn = lampFn;\n',
    fragmentPars: 'varying float vLampFn;',
    replace: [
      ['#include <lights_fragment_maps>', REFLECTIONS(false)],
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    int f = int(vLampFn + 0.5);
    vec3 e = vec3(0.0);
    if (f == ${LAMP_FN.thirdBrake}) e = vec3(1.0, 0.02, 0.01) * 50.0 * carLampsB.x;
    else if (f == ${LAMP_FN.plate}) e = vec3(1.0, 0.97, 0.92) * 5.0 * carLampsA.w;
    else if (f == ${LAMP_FN.screen}) e = vec3(0.55, 0.7, 1.0) * 1.2 * carLampsC.x;
    totalEmissiveRadiance += e;
  }`,
      ],
    ],
  });
  return material;
}
