// GLSL shared by the demo's shaders (GLSL ES 3.00), and the one rule about
// how colours are stored in the off-screen targets.
//
// The chunks are plain strings: paste the ones a shader needs in front of its
// code (full-screen passes get all of them, see FullscreenPass.js). None of
// them declares a uniform, and none of their names collides with three.js's
// own shader library, so they can also be pasted into a built-in material
// through onBeforeCompile.

import { ShaderChunk } from 'three';

/**
 * Hashes built on integer arithmetic. The classic fract(sin(x) * 43758.5)
 * gives different patterns on different phones (their sin() differs in the
 * low bits); integer mixing is exact everywhere, so a paint flake or a grain
 * of film noise lands in the same place on every GPU.
 */
export const GLSL_HASH = /* glsl */ `
uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU;
  x ^= x >> 15; x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}
uint hashU(uvec2 v) { return hashU(v.x ^ hashU(v.y)); }
uint hashU(uvec3 v) { return hashU(v.x ^ hashU(v.y ^ hashU(v.z))); }
float unitFloat(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

// Negative floats must go through int before uint: float -> uint is undefined below zero.
float hash11(float p) { return unitFloat(hashU(uint(int(floor(p))))); }
float hash12(vec2 p) { return unitFloat(hashU(uvec2(ivec2(floor(p))))); }
float hash13(vec3 p) { return unitFloat(hashU(uvec3(ivec3(floor(p))))); }
vec2 hash22(vec2 p) {
  uint h = hashU(uvec2(ivec2(floor(p))));
  return vec2(unitFloat(h), unitFloat(hashU(h + 0x9e3779b9U)));
}
vec3 hash33(vec3 p) {
  uint h = hashU(uvec3(ivec3(floor(p))));
  uint h2 = hashU(h + 0x9e3779b9U);
  return vec3(unitFloat(h), unitFloat(h2), unitFloat(hashU(h2 + 0x9e3779b9U)));
}
`;

/**
 * Value noise, gradient noise and fractal sums, all in [0, 1]. Needs GLSL_HASH.
 * (For anything that covers much of the screen, a texture from noise.js is
 * cheaper than these: each call here is four or eight hashes.)
 */
export const GLSL_NOISE = /* glsl */ `
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
// Gradient (Perlin) noise: smoother than value noise and without its blocky look.
float gradientDot(vec2 cell, vec2 offset) {
  float a = 6.2831853 * hash12(cell);
  return dot(vec2(cos(a), sin(a)), offset);
}
float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = gradientDot(i, f);
  float b = gradientDot(i + vec2(1.0, 0.0), f - vec2(1.0, 0.0));
  float c = gradientDot(i + vec2(0.0, 1.0), f - vec2(0.0, 1.0));
  float d = gradientDot(i + vec2(1.0, 1.0), f - vec2(1.0, 1.0));
  return 0.5 + 0.7071 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// The octaves are rotated against each other so the lattice does not show through.
float fbm(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise(p);
    norm += amp;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0;
    amp *= 0.5;
  }
  return sum / norm;
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise(p);
    norm += amp;
    p = p * 2.03 + vec3(13.1, 7.7, 21.3);
    amp *= 0.5;
  }
  return sum / norm;
}
`;

/** Luminance, saturation and the sRGB transfer curve. */
export const GLSL_COLOR = /* glsl */ `
// (three.js already has a function called luminance in its own shader library)
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 saturateColor(vec3 c, float amount) { return mix(vec3(luma(c)), c, amount); }
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/**
 * The tone curve: scene light (any brightness) to display light (0..1), per
 * channel, so that very bright colours wash toward white as on film.
 * `curve` is (toe, shoulder, contrast):
 *   toe       x^2 / (x + toe) pulls the darkest values toward black and leaves
 *             everything well above "toe" alone
 *   contrast  a power around middle grey (0.18 stays where it is)
 *   shoulder  x / (1 + x^s)^(1/s) approaches 1 without ever clipping; s = 1 is
 *             the gentlest roll-off, larger s holds brightness longer and then
 *             bends harder
 */
export const GLSL_TONE = /* glsl */ `
vec3 toneCurve(vec3 x, vec3 curve) {
  x = max(x, 0.0);
  x = x * x / (x + curve.x + 1.0e-6);
  x = 0.18 * pow(x / 0.18, vec3(curve.z));
  return x / pow(1.0 + pow(x, vec3(curve.y)), vec3(1.0 / curve.y));
}
`;

/**
 * How colours are stored in the off-screen targets.
 *
 * Normally the targets are half-float and hold plain linear light, however
 * bright: toTarget() and fromTarget() do nothing.
 *
 * Where a device cannot render to float textures (LDR_TARGETS is defined), the
 * same frame is made on 8-bit targets. Linear light would band horribly in
 * the dark and clip at 1, so each channel is stored as
 *
 *     e = sqrt(c / (1 + c))          c = e^2 / (1 - e^2)
 *
 * The c / (1 + c) part squeezes any brightness into 0..1 (the brightest value
 * that survives the round trip is about 60); the square root spends the 8 bits
 * the way the eye does, most of them on the darks. What this cannot do is
 * blend correctly: additive and alpha blending happen on the stored values, so
 * glows and glass add up a little differently than in HDR. That is accepted
 * for a fallback. Alpha is stored as it is.
 *
 * A pass that reads a target wraps the lookup in fromTarget() and ends with
 * toTarget(). Materials in the scene need to do nothing: the built-in ones,
 * and any ShaderMaterial that ends the way three.js's own do, with
 *
 *     #include <colorspace_fragment>
 *
 * are switched over by installLdrEncoding() below.
 */
export const GLSL_TARGET = /* glsl */ `
#ifdef LDR_TARGETS
vec4 toTarget(vec4 c) {
  vec3 x = max(c.rgb, 0.0);
  return vec4(sqrt(x / (1.0 + x)), c.a);
}
vec4 fromTarget(vec4 e) {
  vec3 x = min(e.rgb * e.rgb, 0.984);
  return vec4(x / (1.0 - x), e.a);
}
#else
// The clamp guards the half-float range: a NaN or an infinity written once
// would be smeared over the whole picture by the blurs that follow.
vec4 toTarget(vec4 c) { return vec4(clamp(c.rgb, 0.0, 6.0e4), c.a); }
vec4 fromTarget(vec4 e) { return e; }
#endif
`;

export const GLSL_COMMON = `${GLSL_HASH}${GLSL_NOISE}${GLSL_COLOR}${GLSL_TONE}${GLSL_TARGET}`;

/** The define a shader of ours needs so that GLSL_TARGET picks the right half. */
export const targetDefines = (caps) => (caps.hdr ? {} : { LDR_TARGETS: 1 });

/** JS twin of toTarget() for one linear value, used for clear colours. */
export function encodeForTarget(value, ldr) {
  if (!ldr) return value;
  const x = Math.max(0, value);
  return Math.sqrt(x / (1 + x));
}

let ldrInstalled = false;

/**
 * Makes every material of three.js write the 8-bit encoding (see GLSL_TARGET).
 *
 * All of three.js's fragment shaders end with the chunk `colorspace_fragment`,
 * and those with fog put `fog_fragment` after it. Both chunks are extended
 * here, once, before anything is compiled: the first encodes, the second
 * decodes, fogs and encodes again (fog is a mix of light and belongs in linear
 * values). Called by FramePipeline when `caps.hdr` is false; a device with
 * half-float targets never runs it.
 */
export function installLdrEncoding() {
  if (ldrInstalled) return;
  ldrInstalled = true;
  const encode = 'gl_FragColor.rgb = sqrt( max( gl_FragColor.rgb, 0.0 ) / ( 1.0 + max( gl_FragColor.rgb, 0.0 ) ) );';
  const decode = 'gl_FragColor.rgb = min( gl_FragColor.rgb * gl_FragColor.rgb, 0.984 ); gl_FragColor.rgb /= 1.0 - gl_FragColor.rgb;';
  ShaderChunk.colorspace_fragment = `${ShaderChunk.colorspace_fragment}\n${encode}\n`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG\n${decode}\n#endif\n${ShaderChunk.fog_fragment}\n#ifdef USE_FOG\n${encode}\n#endif\n`;
}
