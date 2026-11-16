// GLSL shared by every shader in the demo (GLSL ES 3.00).
//
// GLSL_COMMON is put in front of both stages of every material made with
// createMaterial() and of every full-screen pass, so the functions below are
// simply available. None of them declares a uniform.

/**
 * Hashes built on integer arithmetic. The classic fract(sin(x) * 43758.5)
 * gives different patterns on different phones (their sin() differs in the
 * low bits); integer mixing is exact everywhere, so a speck or a grain of
 * film noise lands in the same place on every GPU.
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

/** Value noise and fractal sums of it, all in [0, 1]. */
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
// (three.js already has a function called luminance in its own shader prefix)
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
 * How colours are stored in the off-screen targets.
 *
 * Normally the targets are half-float and hold plain linear light, however
 * bright: toTarget() and fromTarget() do nothing.
 *
 * Where a device cannot render to float textures (LDR_TARGETS is defined), the
 * same chain runs on 8-bit targets. Linear light would band horribly in the
 * dark and clip at 1, so each channel is stored as
 *
 *     e = sqrt(c / (1 + c))          c = e^2 / (1 - e^2)
 *
 * The c / (1 + c) part squeezes any brightness into 0..1 (the brightest value
 * that survives the round trip is about 60); the square root spends the 8 bits
 * the way the eye does, most of them on the darks. What this cannot do is
 * blend correctly: additive and alpha blending happen on the stored values, so
 * glows add up a little differently than in HDR. That is accepted for a
 * fallback. Alpha is stored as it is.
 *
 * Every material ends with  outColor = toTarget(vec4(rgb, alpha));  and every
 * shader that reads a target written this way wraps the lookup in fromTarget().
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

export const GLSL_COMMON = `${GLSL_HASH}${GLSL_NOISE}${GLSL_COLOR}${GLSL_TARGET}`;

/** JS twin of toTarget() for one linear value, used for clear colours. */
export function encodeForTarget(value, ldr) {
  if (!ldr) return value;
  const x = Math.max(0, value);
  return Math.sqrt(x / (1 + x));
}
