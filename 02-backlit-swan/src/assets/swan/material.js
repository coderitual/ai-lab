// The swan's shaders: how the body, the neck and the fringe are put in
// place, and how a feather takes the light.
//
// The look of the film is light going THROUGH the bird. For every vertex the
// shader follows the ray from that point toward the sun and adds up how much
// feather it has to cross, using a stand-in for the bird made of a few
// ellipsoids (the loose plumage as a whole, the two wings, the body under
// them, the tail) and a chain of cylinders (the neck and head). Light that
// crosses little comes out cream; a little more and it is dimmer and a little
// warmer; more still and nothing comes through, and the surface is left
// with the blue light of the sky: the teal shadow side. The bright rim, the
// glowing bow, the lit tail and the dark middle are all this one sum, so they
// move correctly when the bird turns or the sun does. Nothing is painted on.
//
// Everything is worked out in the bird's own space (metres; +Z the way it
// faces, +Y up). uSunLocal is the sun's direction turned into that space.

import { L, BOW_SPAN, NECK_LENGTH, NECK_CORE, BILL_START, EYE, KNOB } from './anatomy.js';
import { NECK_RINGS } from './poses.js';

/** Ellipsoids and neck segments of the stand-in. */
export const N_ELLIPSOIDS = 6;
export const N_SEGMENTS = 9;

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

const DEFINES = /* glsl */ `
#define NECK_RINGS ${NECK_RINGS}
#define N_ELL ${N_ELLIPSOIDS}
#define N_SEG ${N_SEGMENTS}
#define NECK_CORE ${f(NECK_CORE)}
// neck segments per ring: the chain has a point every (NECK_RINGS - 1) / (N_SEG - 1) rings
#define SEG_PER_RING ${f((N_SEGMENTS - 1) / (NECK_RINGS - 1))}
`;

// How much plumage lies between a point and the sun.
const DEPTH = /* glsl */ `
uniform vec3 uSunLocal;
uniform mat3 uEllM[N_ELL];       // bird space to the ellipsoid's unit sphere
uniform vec4 uEllC[N_ELL];       // centre, density
uniform vec4 uEllPlane[N_ELL];   // density fades in behind a plane: dot(xyz, p) + w, clamped to 0..1
uniform vec4 uSeg[N_SEG + 1];    // points down the middle of the neck and head, radius
uniform float uSegDensity;

// integral of clamp(x, 0, 1)
float rampInt(float x) {
  float c = clamp(x, 0.0, 1.0);
  return c * (x - 0.5 * c);
}

// Density times the length of the ray o + t d (t > 0) inside ellipsoid i. A
// wing's density is not the same all through: it fades in behind the wing's
// leading edge (a plane), and the amount crossed is that fade summed along
// the ray, which has a closed form because the fade is linear.
float ellipsoidDepth(int i, vec3 o, vec3 d) {
  vec3 oo = uEllM[i] * (o - uEllC[i].xyz);
  vec3 dd = uEllM[i] * d;
  float a = dot(dd, dd);
  float b = dot(oo, dd);
  float c = dot(oo, oo) - 1.0;
  float disc = b * b - a * c;
  if (disc <= 0.0) return 0.0;
  float q = sqrt(disc);
  float t0 = max((-b - q) / a, 0.0);
  float t1 = max((-b + q) / a, 0.0);
  vec4 plane = uEllPlane[i];
  float g = dot(plane.xyz, o) + plane.w;
  float gd = dot(plane.xyz, d);
  float ga = g + gd * t0;
  float gb = g + gd * t1;
  float len = abs(gd) < 1.0e-3 ? clamp(0.5 * (ga + gb), 0.0, 1.0) * (t1 - t0) : (rampInt(gb) - rampInt(ga)) / gd;
  return uEllC[i].w * max(len, 0.0);
}

// Length of the ray inside the piece of cylinder between a and b.
float segmentDepth(vec3 a, vec3 b, float r, vec3 o, vec3 d) {
  vec3 ba = b - a;
  vec3 oa = o - a;
  float baba = dot(ba, ba);
  float bad = dot(ba, d);
  float baoa = dot(ba, oa);
  float k2 = baba - bad * bad;
  if (k2 < 1.0e-7) return 0.0;
  float k1 = baba * dot(oa, d) - baoa * bad;
  float k0 = baba * dot(oa, oa) - baoa * baoa - r * r * baba;
  float h = k1 * k1 - k2 * k0;
  if (h <= 0.0) return 0.0;
  h = sqrt(h);
  float t0 = max((-k1 - h) / k2, 0.0);
  float t1 = (-k1 + h) / k2;
  // keep what lies between the two ends
  if (abs(bad) > 1.0e-5) {
    float ta = -baoa / bad;
    float tb = (baba - baoa) / bad;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (baoa < 0.0 || baoa > baba) {
    return 0.0;
  }
  return max(t1 - t0, 0.0);
}

// Metres of plain feather the ray from o toward the sun is worth. "own" is
// the neck segment the point itself sits on (-10 for none): it and its two
// neighbours are left out, because a point on the neck works out its own
// stretch of neck exactly (ownNeckDepth) and the chain of cylinders, which
// gapes on the outside of a bend, is only good enough for casting shade.
float opticalDepth(vec3 o, float own) {
  float depth = 0.0;
  for (int i = 0; i < N_ELL; i++) depth += ellipsoidDepth(i, o, uSunLocal);
  float neck = 0.0;
  for (int i = 0; i < N_SEG; i++) {
    if (abs(float(i) - own) < 1.2) continue;
    neck += segmentDepth(uSeg[i].xyz, uSeg[i + 1].xyz, 0.5 * (uSeg[i].w + uSeg[i + 1].w), o, uSunLocal);
  }
  // (one of the ellipsoids is a hollow, counted negative: together they cannot be less than nothing)
  return max(depth, 0.0) + neck * uSegDensity;
}

// The same for a point on the skin of the neck itself: the length of the ray
// inside a straight tube along "axis" whose dense core has radius "core",
// seen from a point at radius "radius" in the direction "radial".
float ownNeckDepth(vec3 radial, vec3 axis, float radius, float core) {
  vec3 across = uSunLocal - axis * dot(uSunLocal, axis);
  float a = max(dot(across, across), 0.02);
  float b = radius * dot(radial, across);
  float disc = b * b - a * (radius * radius - core * core);
  if (b >= 0.0 || disc <= 0.0) return 0.0;
  return 2.0 * sqrt(disc) / a * uSegDensity;
}

// Where the ray starts. A surface that faces the sun has nothing of itself
// in the way, but the stand-in shapes are not exactly the mesh: lift the
// start a little off sun-facing skin so that it does not shadow itself.
vec3 depthOrigin(vec3 p, vec3 n) {
  return p + n * (0.018 * smoothstep(0.0, 0.35, dot(n, uSunLocal)));
}
`;

// The neck's rings, and a vertex's place on them.
const RINGS = /* glsl */ `
uniform vec4 uRingPos[NECK_RINGS];   // centre (bird space), radius factor
uniform vec4 uRingRot[NECK_RINGS];   // orientation (quaternion)
uniform vec4 uRingBend[NECK_RINGS];  // xy: toward the outside of the bend, radians per metre

vec3 quatRotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void neckRing(float ring, out vec3 centre, out vec4 rot, out float radius, out vec2 bend) {
  float r = clamp(ring, 0.0, float(NECK_RINGS - 1));
  int i = int(floor(r));
  int j = min(i + 1, NECK_RINGS - 1);
  float t = r - float(i);
  centre = mix(uRingPos[i].xyz, uRingPos[j].xyz, t);
  radius = mix(uRingPos[i].w, uRingPos[j].w, t);
  // neighbouring rings are a few degrees apart: a straight blend, renormalised, is exact enough
  rot = normalize(mix(uRingRot[i], uRingRot[j], t));
  bend = mix(uRingBend[i].xy, uRingBend[j].xy, t);
}
`;

const VARYINGS_OUT = /* glsl */ `
out vec3 vWorldPos;
out vec3 vNormal;
out float vDepth;
out vec4 vHead;    // place in the head's own axes, in L (z < 0 behind the skull: neck); w = 1 on head and neck, 0 on the body
out float vAlong;  // how far along the neck: 0 base .. 1 head (and on the head); -1 on the body
`;

const FINISH_VERTEX = /* glsl */ `
  vDepth = ownDepth + opticalDepth(depthOrigin(p, n), ownSegment);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  // the swan is only ever turned and moved, never squashed: the model matrix will do for normals
  vNormal = mat3(modelMatrix) * n;
  gl_Position = projectionMatrix * viewMatrix * world;
`;

export const BODY_VERTEX = /* glsl */ `
${DEFINES}
${DEPTH}
in vec3 aRelaxed;
in vec3 aRelaxedNormal;
in vec3 aRest;
in float aTail;
uniform vec4 uBody;       // wing lift 0..1, how far the bow is down (m), length factor, breath (m)
uniform vec3 uTailSwing;  // hinge y, hinge z, angle
${VARYINGS_OUT}
void main() {
  vec3 p = mix(aRelaxed, position, uBody.x);
  vec3 n = normalize(mix(aRelaxedNormal, normal, uBody.x));

  // breathing: the flanks and back swell, the tail and the waterline do not
  p += n * uBody.w * smoothstep(0.02, 0.14, aRest.y) * (1.0 - smoothstep(0.85, 1.0, aRest.z));

  // the tail swings about the saddle
  float a = uTailSwing.z * aTail;
  float ca = cos(a);
  float sa = sin(a);
  vec2 r = p.yz - uTailSwing.xy;
  p.yz = uTailSwing.xy + vec2(r.x * ca - r.y * sa, r.x * sa + r.y * ca);
  n.yz = vec2(n.y * ca - n.z * sa, n.y * sa + n.z * ca);

  // the front of the body sinks: all of it at the bow, none of it aft
  float t = clamp((aRest.z - ${f(BOW_SPAN[0])}) / ${f(BOW_SPAN[1] - BOW_SPAN[0])}, 0.0, 1.0);
  p.y -= uBody.y * (1.0 - t * t * (3.0 - 2.0 * t));
  // (a sheared surface's normal tips the other way by the slope of the shear)
  n.z += uBody.y * 6.0 * t * (1.0 - t) / ${f((BOW_SPAN[1] - BOW_SPAN[0]) * L)} * n.y;

  // and the whole bird lengthens when it reaches
  p.z *= uBody.z;
  n.z /= uBody.z;
  n = normalize(n);

  vHead = vec4(0.0, 0.0, -1.0, 0.0);
  vAlong = -1.0;
  float ownDepth = 0.0;
  float ownSegment = -10.0;
${FINISH_VERTEX}
}
`;

export const NECK_VERTEX = /* glsl */ `
${DEFINES}
${DEPTH}
${RINGS}
in float aRing;
in vec4 aHead;
${VARYINGS_OUT}
void main() {
  vec3 centre;
  vec4 rot;
  float radius;
  vec2 bend;
  neckRing(aRing, centre, rot, radius, bend);
  // a stretched neck is thinner; the head keeps its size (the back of the skull follows the neck it joins)
  float k = mix(radius, 1.0, aHead.w * smoothstep(0.0, 0.06, aHead.z));
  vec3 p = centre + quatRotate(rot, vec3(position.xy * k, position.z));
  vec3 n = quatRotate(rot, normal);
  // The head's axes carry on down the neck (z negative there), so that nothing
  // jumps across the seam between the two when the values are interpolated.
  vHead = vec4(mix(position.xy / ${f(L)}, aHead.xy, aHead.w), mix((aRing - float(NECK_RINGS - 1)) * 0.02, aHead.z, aHead.w), 1.0);
  // (rings are closer together toward the head, so this runs a little slow at first: good enough for a tint)
  vAlong = aRing / float(NECK_RINGS - 1);
  // The neck knows its own thickness; the head is one stubby cylinder of the chain (the last), which it keeps.
  vec3 axis = quatRotate(rot, vec3(0.0, 0.0, 1.0));
  float girth = length(position.xy) * k;
  // (the head is treated as a tube of its own girth too: a skull lets no more through than a neck)
  float ownDepth = ownNeckDepth(normalize(n - axis * dot(n, axis) + axis * 1.0e-4), axis, max(girth, 0.004), max(girth, 0.004) * NECK_CORE);
  float ownSegment = mix(aRing * SEG_PER_RING - 0.5, float(N_SEG) - 2.5, aHead.w);
${FINISH_VERTEX}
}
`;

export const FRINGE_VERTEX = /* glsl */ `
${DEFINES}
${DEPTH}
${RINGS}
in float aRing;
in vec4 aFin;      // xy: the way the strip stands, in the ring's axes; z: 0 foot .. 1 top; w: random per strip
in float aAlong;   // distance along the neck, in L
uniform vec4 uFringe;  // height of the down on a straight run (m), how much taller on the outside of a bend; unused
${VARYINGS_OUT}
out vec4 vFin;     // along (L), 0 foot .. 1 top, random, how far this side is stretched by the bend
out vec3 vRadial;
void main() {
  vec3 centre;
  vec4 rot;
  float radius;
  vec2 bend;
  neckRing(aRing, centre, rot, radius, bend);
  float onHead = clamp((aAlong - ${f(NECK_LENGTH)}) / 0.06, 0.0, 1.0);
  float k = mix(radius, 1.0, onHead);
  vec2 foot = position.xy * k;
  // On the outside of a bend the skin is stretched and the down stands up
  // in tufts; on the inside it is pressed flat.
  float stretch = dot(bend, aFin.xy) * length(foot);
  // the down is short and velvety toward the head, longer on the lower neck
  float height = uFringe.x * mix(1.0, 0.45, smoothstep(0.5, 0.95, aAlong / ${f(NECK_LENGTH)})) * (1.0 + uFringe.y * clamp(stretch, -0.25, 1.0));
  vec3 radial = quatRotate(rot, vec3(aFin.xy, 0.0));
  vec3 base = centre + quatRotate(rot, vec3(foot, position.z));
  vec3 p = base + radial * (height * aFin.z);
  vec3 n = radial;
  vFin = vec4(aAlong, aFin.z, aFin.w, clamp(stretch, 0.0, 1.0));
  vRadial = mat3(modelMatrix) * radial;
  vHead = vec4(0.0, 0.0, -1.0, 0.0);
  vAlong = min(aAlong / ${f(NECK_LENGTH)}, 1.0);
  // the light on a strand is the light at its foot
  vec3 axis = quatRotate(rot, vec3(0.0, 0.0, 1.0));
  float girth = length(foot);
  float ownSegment = mix(aRing * SEG_PER_RING - 0.5, float(N_SEG) - 2.5, onHead);
  vDepth = (1.0 - onHead) * ownNeckDepth(radial, axis, girth, girth * NECK_CORE) + opticalDepth(depthOrigin(base, n), ownSegment);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(modelMatrix) * n;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * The fragment stage, shared by the three meshes.
 * `FRINGE` cuts the strip into beads and tufts; `TWO_SIDED` lights the back of a face like its front.
 * @param {{ glsl: string }} light ctx.light
 */
export const feather = (light) => /* glsl */ `
${light.glsl}
uniform vec3 uAbsorb;     // what a metre of feather takes out of the light, per channel: blue most
uniform vec4 uFeather;    // share of the light inside the plumage that leaves a shadow-side surface, wrap of
                          // the direct sun, how much sky reaches the skin at the water, height (m) at which all of it does
uniform vec4 uSky;        // share of the sky's light on a surface that faces down, one that faces the horizon, one tilted
                          // up to it; and the tilt (the normal's y) from which it gets all of it
uniform vec3 uAlbedo;
uniform vec3 uStain;      // the feathers of the head and upper neck are a little stained
uniform vec3 uBillColor;
uniform vec3 uNeckSky;     // x: share of the sky's light the neck and head get (they stand upright under their own arch);
                           // y: share of the light inside them that leaves through their skin (dense, close feathering: little);
                           // z: share of the sun that gets round them in the down, however thick they are
in vec3 vWorldPos;
in vec3 vNormal;
in float vDepth;
in vec4 vHead;
in float vAlong;
#ifdef FRINGE
in vec4 vFin;
in vec3 vRadial;
#endif

void main() {
  vec3 n = normalize(vNormal);
#ifdef TWO_SIDED
  if (!gl_FrontFacing) n = -n;
#endif
  vec3 v = normalize(cameraPosition - vWorldPos);
  float alpha = 1.0;

  vec3 albedo = uAlbedo * mix(vec3(1.0), uStain, smoothstep(0.25, 0.85, vAlong));
  float bare = 0.0;   // 1 on bill, knob, lores and eye: no light comes through, and they shine
  float gloss = 0.0;

#ifndef FRINGE
  if (vHead.w > 0.5 && vHead.z > 0.0) {
    // The head's own axes, in L: x across, y toward the crown, z along the bill.
    vec3 h = vHead.xyz;
    // feathers end on a slanting line from the forehead down and back to the gape
    float edge = h.z - (${f(BILL_START - 0.012)} + 0.012 * clamp(h.y / 0.045, -1.0, 1.0));
    bare = smoothstep(-0.0015, 0.0015, edge);
    // black: the knob and the base of the bill, the nail at its tip, the lower mandible, the edge of the gape
    // (edges in rising order: smoothstep is undefined in GLSL ES with them the other way round)
    float knob = (1.0 - smoothstep(${f(KNOB.at + 0.018)}, ${f(KNOB.at + 0.03)}, h.z)) * smoothstep(0.004, 0.012, h.y);
    float base = 1.0 - smoothstep(0.004, 0.009, edge);
    float nail = smoothstep(0.268, 0.274, h.z) * smoothstep(-0.012, -0.004, h.y);
    float under = 1.0 - smoothstep(-0.016, -0.011, h.y);
    float black = max(max(knob, base), max(nail, under));
    vec3 billCol = mix(uBillColor, vec3(0.012, 0.011, 0.012), black);
    // the lores: bare black skin in a wedge from the eye to the bill
    float along = (h.z - ${f(EYE.at)}) / (${f(BILL_START)} - ${f(EYE.at)});
    float eyeY = ${f(EYE.up * 0.075)};
    float lore = smoothstep(-0.05, 0.05, along) * step(along, 1.2) * (1.0 - smoothstep(0.004 + 0.02 * along, 0.007 + 0.024 * along, abs(h.y - eyeY + 0.006 * along))) * step(0.02, abs(h.x)) * (1.0 - bare);
    float eye = 1.0 - smoothstep(${f(EYE.radius * 0.8)}, ${f(EYE.radius)}, length(h.yz - vec2(eyeY, ${f(EYE.at)})));
    eye *= step(0.03, abs(h.x));
    albedo = mix(albedo, billCol, bare);
    albedo = mix(albedo, vec3(0.012), max(lore, eye));
    bare = max(bare, max(lore, eye));
    gloss = bare * mix(0.55, 1.0, eye);
  }
#endif

  float reach = sunReach(vWorldPos);
  // (never less than nothing: at the edge of a multisampled triangle the value
  // is extrapolated past its corners, and a negative depth would amplify the
  // light, blue most of all)
  vec3 through = exp(-uAbsorb * max(vDepth, 0.0));
  float nl = dot(n, uSunDir);
  float direct = clamp((nl + uFeather.y) / (1.0 + uFeather.y), 0.0, 1.0);
  // Light inside the plumage leaves through any surface, whichever way it
  // faces; a surface turned to the sun is lit by it directly as well, and
  // shows whichever of the two is the brighter.
  vec3 sunFeather = uSunColor * reach * max(through * max(mix(uFeather.x, uNeckSky.y, vHead.w), direct), vec3(uNeckSky.z * vHead.w));
  // Bare parts let nothing through: plain sunlight, shadowed by the bird.
  vec3 sunBare = uSunColor * reach * through * max(nl, 0.0);

  // The sky: least on what faces down and near the dark water, most on what is tilted up to it.
  float tilt = n.y;
  float open = tilt < 0.0 ? mix(uSky.y, uSky.x, min(-tilt * 2.0, 1.0)) : mix(uSky.y, uSky.z, smoothstep(0.0, uSky.w, tilt));
  open *= mix(uFeather.z, 1.0, smoothstep(0.0, uFeather.w, vWorldPos.y));
#ifdef FRINGE
  // down standing off the neck sees no more sky than the neck it stands on
  float skyShare = uNeckSky.x * 0.6;
#else
  float skyShare = mix(1.0, uNeckSky.x, vHead.w);
#endif
  vec3 fill = fillLight(n) * open * skyShare;

  vec3 col = albedo * (mix(sunFeather, sunBare, bare) + fill);

  // Bill and eye are glossy: the sun glances off the top of the bill and the jaw as thin bright lines.
  if (gloss > 0.0) {
    vec3 hv = normalize(uSunDir + v);
    float ndh = max(dot(n, hv), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
    col += gloss * uSunColor * reach * through * fres * pow(ndh, 90.0) * 2.5;
    col += gloss * uSkyColor * (0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0)) * 0.12;
  }

#ifdef FRINGE
  // Only strips seen from the side are outline; the ones that point at the eye are hidden.
  float side = 1.0 - smoothstep(0.3, 0.6, abs(dot(normalize(vRadial), v)));
  float h = vFin.y;
  float seed = vFin.z;
  float bent = vFin.w;
  // Teeth: one every TOOTH of length (in L), leaning toward the body. On a
  // straight run they are low round beads; on the outside of a bend the fin
  // is taller and they sharpen into a saw.
  float x = vFin.x / TOOTH + seed * 37.0 + h * 0.7;
  float cell = floor(x);
  float fx = x - cell;
  float tall = mix(0.45, 1.0, hash12(vec2(cell, floor(seed * 1024.0))));
  float bead = tall * (0.5 - 0.5 * cos(6.2832 * fx));
  float saw = tall * (fx < 0.3 ? fx / 0.3 : 1.0 - (fx - 0.3) / 0.7);
  float profile = mix(bead, saw, smoothstep(0.1, 0.45, bent));
  // fine barbs between them
  float x2 = vFin.x / (TOOTH * 0.23) + seed * 91.0 + h * 1.3;
  float c2 = floor(x2);
  float barb = mix(0.2, 0.75, hash12(vec2(c2, floor(seed * 1024.0) + 7.0))) * (1.0 - abs(2.0 * (x2 - c2) - 1.0));
  profile = max(max(profile, barb), 0.16);
  float soft = max(fwidth(h) * 1.2, 0.02);
  alpha = side * (1.0 - smoothstep(profile - soft, profile + soft, h));
  // the down thins toward its tips
  col *= mix(1.0, 0.65, h);
  if (alpha < 0.02) discard;
#endif

  outColor = toTarget(vec4(col, alpha));
}
`;

/** GLSL constants that depend on the build (kept out of the uniforms: they never change). */
export const fringeDefines = (toothSpacing) => ({ FRINGE: 1, TOOTH: f(toothSpacing) });
