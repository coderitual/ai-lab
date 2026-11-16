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

function patch(material, shared, caps, { vertex = true, fragmentPars = '', replace = [] }) {
  material.defines = { ...(material.defines || {}), ...(caps ? targetDefines(caps) : {}) };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    if (vertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
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
vec3 cBase; float cMetal; float cRough; float cCoat; vec3 cEmit; float cShut; float cPaint;
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

/** The lamp units, until they are modelled: what shows through the lens, and what lights up. */
void carLamp(float lens, float w) {
  if (w <= 0.0) return;
  vec3 p = vec3(abs(vCarPos.x), vCarPos.yz);
  bool left = vCarPos.x > 0.0;
  if (vCarPos.z > 0.0) {
    // head lamp: gloss black housing; under the straight brow the hook, the two modules and the blue accent
    vec3 v = normalize(vec3(0.6, 0.2, 0.77));
    float brow = min(carSegment(p, vec3(0.535, 0.70, 2.045), vec3(0.80, 0.74, 1.735), v),
                     carSegment(p, vec3(0.535, 0.70, 2.045), vec3(0.515, 0.655, 2.09), v));
    float browW = carInside(brow - 0.006);
    float proj = length(p - vec3(0.615, 0.663, 1.975) - v * dot(p - vec3(0.615, 0.663, 1.975), v));
    float matrixM = length(p - vec3(0.715, 0.672, 1.862) - v * dot(p - vec3(0.715, 0.672, 1.862), v));
    float accent = length(p - vec3(0.78, 0.69, 1.77) - v * dot(p - vec3(0.78, 0.69, 1.77), v));
    vec3 col = vec3(0.01);
    float met = 0.0; float rough = 0.08;
    float bezel = carInside(abs(proj - 0.036) - 0.006) + carInside(abs(matrixM - 0.036) - 0.005);
    col = mix(col, vec3(0.75), bezel); met = mix(met, 1.0, bezel); rough = mix(rough, 0.25, bezel);
    col = mix(col, vec3(0.6, 0.62, 0.65), browW); rough = mix(rough, 0.4, browW);
    col = mix(col, vec3(0.02, 0.10, 0.55), carInside(accent - 0.02));
    CAR_REGION(w, col, met, rough, 1.0);
    float indicator = left ? carLampsB.z : carLampsB.w;
    vec3 drl = mix(vec3(1.0, 0.97, 0.93) * 18.0 * max(carLampsA.x, 0.1 * carLampsA.y), vec3(1.0, 0.45, 0.05) * 30.0, indicator);
    cEmit += w * browW * drl;
    float beam = carLampsA.y + carLampsA.z;
    cEmit += w * vec3(0.95, 0.97, 1.0) * 6.0 * beam * (carInside(proj - 0.03) + carInside(matrixM - 0.03) * (0.4 + carLampsA.z));
  } else {
    // tail lamp: smoked red; two rows of slanted fins that open towards the middle, a smooth band between them
    float x = p.x;
    float yu = 0.866 + 0.044 * clamp((x - 0.37) / 0.39, 0.0, 1.0);
    float yl = x < 0.66 ? 0.866 - 0.118 * (x - 0.37) / 0.29 : 0.748 + 0.13 * (x - 0.66) / 0.182;
    float mid = 0.5 * (yu + yl);
    float edge = -lens;
    float rowBand = carInside(abs(edge - 0.015) - 0.007);
    float upper = rowBand * step(mid, p.y);
    float lower = rowBand * (1.0 - step(mid, p.y)) * step(0.54, x);
    float finsU = smoothstep(0.42, 0.5, fract((x + 0.7 * p.y) / 0.037)) * (1.0 - smoothstep(0.58, 0.66, fract((x + 0.7 * p.y) / 0.037)));
    float finsL = smoothstep(0.42, 0.5, fract((x - 0.7 * p.y) / 0.037)) * (1.0 - smoothstep(0.58, 0.66, fract((x - 0.7 * p.y) / 0.037)));
    float fins = upper * finsU * (x > 0.6 ? 1.0 : 0.5) + lower * finsL;
    float band = carInside(0.022 - edge) * carInside(abs(p.y - mid) - 0.012);
    float reverse = carInside(carBox(p.xy, vec2(0.41, 0.864), vec2(0.022, 0.009), 0.003));
    vec3 col = mix(vec3(0.1, 0.006, 0.009), vec3(0.3, 0.02, 0.02), fins);
    col = mix(col, vec3(0.5), reverse * 0.6);
    CAR_REGION(w, col, 0.0, 0.12, 1.0);
    float indicator = (left ? carLampsB.z : carLampsB.w) * step(0.6, x);
    cEmit += w * fins * vec3(1.0, 0.03, 0.01) * 2.5 * carLampsA.w;
    cEmit += w * band * mix(vec3(1.0, 0.02, 0.01) * 14.0 * carLampsB.x, vec3(1.0, 0.4, 0.03) * 20.0, indicator);
    cEmit += w * band * vec3(1.0, 0.03, 0.01) * 0.6 * carLampsA.w;
    cEmit += w * reverse * vec3(1.0, 0.98, 0.95) * 16.0 * carLampsB.y;
  }
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
  if (B.r < 0.0 || glass < -0.012) discard;
  vec3 p = vec3(abs(vCarPos.x), vCarPos.yz);
  float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  cBase = paintColor * mix(1.0, paintFlop, pow(1.0 - ndv, 1.5));
  cMetal = paintMetal; cRough = paintRough; cCoat = 1.0; cEmit = vec3(0.0); cPaint = 1.0;
  // the grille's bright frame
  CAR_REGION(carCover(B.r - 0.008) * step(1.9, p.z) * step(0.4, p.y), vec3(0.83, 0.84, 0.86), 1.0, 0.08, 0.0);
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
    float trim = carBox(p.xy, vec2(0.57, 0.31), vec2(0.12, 0.035), 0.012);
    CAR_REGION(carInside(trim), vec3(0.72), 1.0, 0.12, 0.0);
    CAR_REGION(carInside(trim + 0.01), vec3(0.015), 0.0, 0.8, 0.0);
  }
  // the number plates, blank (their characters belong to the plate's own stage), and the rear plate's recess
  if (p.z < -2.3 && vCarNormal.z < -0.5) {
    float recess = carBox(vCarPos.xy, vec2(0.0, 0.765), vec2(0.30, 0.085), 0.025);
    cBase *= 1.0 - 0.3 * carInside(recess) * (1.0 - smoothstep(-0.025, 0.0, -recess - 0.0));
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.771), vec2(0.27, 0.0675), 0.008)), vec3(0.015), 0.0, 0.5, 0.0);
    vec3 face = mix(vec3(0.8), vec3(0.01, 0.07, 0.4), carInside(0.22 - vCarPos.x));
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.771), vec2(0.26, 0.057), 0.004)), face, 0.0, 0.35, 0.0);
  }
  if (p.z > 2.1 && vCarNormal.z > 0.5) {
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.392), vec2(0.265, 0.0625), 0.006)), vec3(0.015), 0.0, 0.5, 0.0);
    vec3 face = mix(vec3(0.8), vec3(0.01, 0.07, 0.4), carInside(vCarPos.x + 0.22));
    CAR_REGION(carInside(carBox(vCarPos.xy, vec2(0.0, 0.392), vec2(0.26, 0.057), 0.004)), face, 0.0, 0.35, 0.0);
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
    normal = normalize(normal + tilt);
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
