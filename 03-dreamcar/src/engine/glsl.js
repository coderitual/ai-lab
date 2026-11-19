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
 * The numbers of the tone curve (see GLSL_TONE). `gain` is what makes 0.18 come out as 0.18 at contrast 1; it
 * follows from the other two and has to be worked out again if they change (tools/frametest.cjs checks it).
 */
export const TONE = { gain: 1.1053101, toe: 0.012, shoulder: 1.6, inset: 0.04 };

/**
 * The tone curve: scene light (any brightness, already multiplied by the exposure) to display light (0..1).
 *
 * One channel, x >= 0:
 *   toe       x' = (g x)^2 / (g x + toe)      pulls what is far below `toe` toward black, leaves the rest alone
 *   contrast  x'' = 0.18 (x' / 0.18)^k        a power about middle grey (k is Look.contrast; 1 changes nothing)
 *   shoulder  y = x'' / (1 + x''^s)^(1/s)     approaches 1 and never reaches it: no brightness clips
 * With contrast 1, y(0.18) = 0.18, y(1) = 0.677 and y(16) = 0.994.
 *
 * Applied to red, green and blue on their own, a curve like this bends colours as they get bright: the largest
 * channel stops growing first, so a red lamp turns orange, then yellow. Applied to brightness alone, colours
 * never wash out and a lamp is a flat red disc. So, as AgX does it: before the curve the colour is pulled a
 * little toward its own grey (`inset`), which lifts the small channels of a pure colour together, and after it
 * the same amount is taken out again. In the straight part of the curve the two cancel exactly; in the shoulder
 * they cannot, and what is left is a colour that keeps its hue and goes to white as it burns out. Greys are
 * not touched by either step.
 */
export const GLSL_TONE = /* glsl */ `
vec3 toneCurve(vec3 c, float contrast) {
  c = max(c, 0.0);
  c = mix(c, vec3((c.r + c.g + c.b) / 3.0), ${TONE.inset});
  vec3 x = c * ${TONE.gain};
  x = x * x / (x + ${TONE.toe});
  x = 0.18 * pow(x / 0.18, vec3(contrast));
  x = x / pow(1.0 + pow(x, vec3(${TONE.shoulder.toFixed(4)})), vec3(${(1 / TONE.shoulder).toFixed(6)}));
  float grey = (x.r + x.g + x.b) / 3.0;
  return clamp(grey + (x - grey) / ${(1 - TONE.inset).toFixed(4)}, 0.0, 1.0);
}
`;

/** JS twin of toneCurve() for one grey value (the documented response; also used to pick display greys). */
export function toneResponse(x, contrast = 1) {
  const gx = Math.max(0, x) * TONE.gain;
  const toed = (gx * gx) / (gx + TONE.toe);
  const k = 0.18 * Math.pow(toed / 0.18, contrast);
  return k / Math.pow(1 + Math.pow(k, TONE.shoulder), 1 / TONE.shoulder);
}

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
// This guards the half-float range: a NaN or an infinity written once would be smeared over the whole picture by
// the blurs that follow. A clamp alone does not: what min and max make of a NaN is left to the GPU, and real ones
// (unlike the software rasteriser the tests run on) hand it straight back. So the test is spelled out, on the way
// in as well as on the way out: the scene itself is written by materials that do not pass through toTarget.
vec3 finiteLight(vec3 x) {
  return vec3(
    isnan(x.r) || isinf(x.r) ? 0.0 : x.r,
    isnan(x.g) || isinf(x.g) ? 0.0 : x.g,
    isnan(x.b) || isinf(x.b) ? 0.0 : x.b
  );
}
vec4 toTarget(vec4 c) { return vec4(clamp(finiteLight(c.rgb), 0.0, 6.0e4), c.a); }
vec4 fromTarget(vec4 e) { return vec4(clamp(finiteLight(e.rgb), 0.0, 6.0e4), e.a); }
#endif
`;

/**
 * How to read a reflection probe (ReflectionProbe.js) in any material: paste this chunk and call
 *
 *     vec3 light = probeSample(uProbe, directionInWorldSpace, roughness);
 *
 * The convention, exactly:
 *  - The probe is a cube map drawn by this renderer, so it is in OpenGL's own cube orientation and is looked up
 *    with the plain world-space direction from the probe's centre toward what is seen. No component is flipped.
 *    (three.js negates x for cube maps that were loaded from pictures; for a cube render target it does not,
 *    and neither must you.)
 *  - Its mips are prefiltered for roughness (GGX, the lobe of a view along the normal). With `size` the cube's edge
 *    in texels there are M + 1 levels, M = log2(size) - 2 (the last one's faces are 4 texels wide):
 *        level 0          roughness 0, the sharp picture
 *        level k >= 1     alpha = roughness^2 = 2^(k - M): level M is roughness 1, each level finer halves alpha
 *    so the level for a roughness r is
 *        level = M + log2(r^2)                   for r^2 >= 2^(1 - M)
 *        level = r^2 / 2^(1 - M)                 below that, between the sharp picture and level 1
 *    and a level's lobe is always about 6.6 of its own texels across (2.6 alpha radians, a texel being
 *    (PI / 2) 2^k / size): a read at the roughness of a pixel's footprint is smooth and does not alias. One read is
 *    the whole glossy reflection: no taps round the mirror direction are needed.
 *  - What comes back is linear light in scene units, as everything that is drawn. The material must carry the
 *    defines of targetDefines(caps), or the 8-bit fallback's encoding is not undone.
 *
 * Needs nothing else from this file; the names do not collide with three.js's.
 */
export const GLSL_PROBE = /* glsl */ `
float probeLevel(float roughness, float size) {
  float last = log2(size) - 2.0;
  float a = roughness * roughness;
  float first = exp2(1.0 - last);
  return a < first ? a / first : min(last + log2(a), last);
}
vec3 probeSample(samplerCube probe, vec3 direction, float roughness) {
  vec3 e = textureLod(probe, direction, probeLevel(roughness, float(textureSize(probe, 0).x))).rgb;
#ifdef LDR_TARGETS
  e = min(e * e, 0.984);
  e = e / (1.0 - e);
#endif
  return e;
}
`;

/** Mip levels of a probe of `size` texels (0 .. M, M = log2(size) - 2): see GLSL_PROBE. */
export const probeLevelCount = (size) => Math.max(2, Math.round(Math.log2(size)) - 1);

/** JS twin of probeLevel(): the mip level a roughness reads, for a cube of `size` texels. */
export function probeLevel(roughness, size) {
  const last = Math.log2(size) - 2;
  const a = roughness * roughness;
  const first = 2 ** (1 - last);
  return a < first ? a / first : Math.min(last + Math.log2(a), last);
}

/** JS twin of the filter: the roughness a probe's level holds (ReflectionProbe.js). */
export function probeRoughness(level, size) {
  const last = Math.log2(size) - 2;
  return level <= 0 ? 0 : Math.sqrt(2 ** (Math.min(level, last) - last));
}

/**
 * A parallax correction for a probe (ReflectionProbe.js `uniforms`, set by `setProxy`): the probe knows directions
 * only, as if everything were infinitely far. For a point P of a surface and its reflected direction R (world
 * space), `probeProxyDir` finds where the ray meets the local proxy (the box if there is one, else the ground plane
 * when the ray goes down) and returns the direction from the probe's centre to that point, faded back to R for hits
 * between 8 and 20 m away (further things are far enough). Pass the result to probeSample. Declares its uniforms:
 *
 *     probeCenter   vec3   where the cube was drawn from (world)
 *     probePlane    vec4   the ground: n.xyz, d, with n . x + d = 0
 *     probeBox      mat4   world to the box's own -1..1 cube (the tunnel's bore)
 *     probeProxy    vec2   x: the plane is in use, y: the box is
 */
export const GLSL_PROBE_PROXY = /* glsl */ `
uniform vec3 probeCenter;
uniform vec4 probePlane;
uniform mat4 probeBox;
uniform vec2 probeProxy;
vec3 probeProxyDir(vec3 P, vec3 R) {
  float t = -1.0;
  if (probeProxy.y > 0.5) {
    vec3 p = (probeBox * vec4(P, 1.0)).xyz;
    vec3 r = (probeBox * vec4(R, 0.0)).xyz;
    vec3 safe = sign(r) * max(abs(r), vec3(1e-5)) + vec3(equal(r, vec3(0.0))) * 1e-5;
    vec3 exits = max((vec3(1.0) - p) / safe, (vec3(-1.0) - p) / safe);
    t = min(exits.x, min(exits.y, exits.z));
  } else if (probeProxy.x > 0.5) {
    float down = dot(probePlane.xyz, R);
    if (down < -0.02) t = -(dot(probePlane.xyz, P) + probePlane.w) / down;
  }
  if (t <= 0.0) return R;
  vec3 toHit = normalize(P + R * t - probeCenter);
  return normalize(mix(toHit, R, smoothstep(8.0, 20.0, t)));
}
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

/** Whether installLdrEncoding() has run: everything drawn from now on is in the 8-bit encoding. */
export const ldrEncodingInstalled = () => ldrInstalled;

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
  // (with half a step of noise: at night everything lives in the lowest few of the 256 levels, and what would
  // be bands across the sky after the exposure has multiplied them becomes grain instead)
  const encode =
    'gl_FragColor.rgb = sqrt( max( gl_FragColor.rgb, 0.0 ) / ( 1.0 + max( gl_FragColor.rgb, 0.0 ) ) )' +
    ' + ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;';
  const decode = 'gl_FragColor.rgb = min( gl_FragColor.rgb * gl_FragColor.rgb, 0.984 ); gl_FragColor.rgb /= 1.0 - gl_FragColor.rgb;';
  ShaderChunk.colorspace_fragment = `${ShaderChunk.colorspace_fragment}\n${encode}\n`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG\n${decode}\n#endif\n${ShaderChunk.fog_fragment}\n#ifdef USE_FOG\n${encode}\n#endif\n`;
}
