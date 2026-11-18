// From a scene and a camera to finished pixels in a rectangle of the canvas.
//
//   scene -> [ambient occlusion] -> [motion blur] -> bloom pyramid (-> flare source, star) -> final
//         (-> edge smoothing) -> canvas
//
// One view at a time: split screen calls render() once per rectangle and the
// same targets serve every view. docs/engine.md walks through the passes;
// the ideas the code rests on are these.
//
// Light stays linear until the last pass. The targets hold scene light as
// bright as it likes (half-float), or the 8-bit encoding of glsl.js where a
// device has no float targets; every pass reads with fromTarget() and writes
// with toTarget(). Exposure, the tone curve and the sRGB curve happen once, at
// the end.
//
// The scene is ONE render call. three.js resolves a multisampled target after
// every render call and then throws its samples away; a second call into it
// would draw over garbage.
//
// Motion blur is worked out from depth. A pixel's depth and the camera's
// matrices of this frame and the last say where that point of the world was
// on the screen a frame ago; the picture is averaged along the line between.
// Things that move by themselves are declared as boxes (ViewFrame.sharp): a
// point inside a box is carried back by the box's own movement instead. A car
// that keeps its place in front of the camera therefore has no streak at all,
// and the road rushing past under it has.
//
// The shutter is a time, not a share of the frame. The streak is what moved
// during motionBlur / 60 of a second, on a 30 Hz phone and on a 144 Hz
// monitor alike; the time between the two frames comes from the engine's
// clock (Engine.renderTime), which is the run's own time and stands still in
// a paused or hand-stepped page.
//
// Ambient occlusion is worked out from depth too, at half size: how much of the hemisphere over each point the
// surfaces within a metre or so cover, after McGuire's Scalable Ambient Obscurance. It is multiplied into the
// scene's light before anything else reads it, except where a pixel is far brighter than lit surfaces get
// (lamps and their mirror images): what emits light is not occluded.
//
// Bloom has no threshold and adds nothing. The picture is mixed with a
// blurred copy of itself; what glows is whatever is much brighter than its
// surroundings, in proportion to how much. The blur is a pyramid of halvings,
// weighted so that its shape is the same angle on every screen.

import * as THREE from 'three';
import { Engine } from './Engine.js';
import { TIERS, createTarget, resizeTarget } from './caps.js';
import { FullscreenPass, createPassMaterial } from './FullscreenPass.js';
import { GLSL_PROBE, installLdrEncoding } from './glsl.js';
import { parseParams } from './params.js';

/**
 * The grade of the finished picture: one per time of day, in lighting.js. The tone curve itself is fixed
 * (GLSL_TONE in glsl.js); these are the numbers round it.
 * @typedef {object} Look
 * @property {number} contrast a power about middle grey inside the tone curve (1: the curve as documented)
 * @property {number} saturation 1 = as lit
 * @property {[number, number, number]} tint white balance: multiplies the light before the curve, so white lamps stay white
 * @property {[number, number, number]} lift a colour added to the darkest values, fading out toward white: what black looks like
 * @property {number} vignette how much darker the corners of the view are, 0..1
 * @property {number} chroma lateral chromatic aberration: how much further from the centre red lands than green in
 *   the corners, as a fraction of the view (0.001 is about a pixel at 720p; 0: none; not drawn on the low tier)
 * @property {number} grain film grain, in 8-bit steps
 * @property {number} bloom how much of the picture is replaced by its own glow, 0..1 (0.1: a mist filter)
 * @property {number} ghosts lens ghosts: the share of the brightest light in the view (the sun) that each of the
 *   ghosts on the line from it through the middle of the view carries (0: none; a few thousandths; not drawn on the
 *   low tier)
 * @property {{ dir: number[], light: number, reach?: number, sky?: number }} [flare] (look lane) a light that flares
 *   even from just outside the frame (the sun): its world direction, its light as the flare source would measure it
 *   in the frame, over how many view heights outside the frame it fades out, and how bright (scene units) the sky
 *   at the frame's edge nearest it must be for it to count as not hidden
 * @property {number} [glare] the veil the brightest light lays over the view round itself, as the glass of a real lens
 *   scatters it (0: none; 0.1..0.3 for a sun in the picture; not drawn on the low tier)
 * @property {number} [ao] ambient occlusion: how much of the light a point loses for the surfaces round it within
 *   about a metre (0: off and not computed; 1: full strength; not drawn on the low tier)
 * @property {[number, number, number]} [splitShadows] split toning: the colour the shadows lean to, as multipliers
 *   (normalised to keep brightness; [1, 1, 1]: none). Applied after the tone curve: in full a third of the display
 *   scale below splitBalance, fading out toward it
 * @property {[number, number, number]} [splitHighlights] the same for the highlights, fading in over a third of the
 *   scale above splitBalance
 * @property {number} [splitBalance] the display brightness (0..1, sRGB-like) that neither tone touches (0.5)
 * @property {number} [star] glints: the very brightest points (the sun on paint and glass, a bare lamp) get a small
 *   six-pointed star, as light diffracts round a lens's aperture blades; how much of their light goes into it (0:
 *   none; 0.02..0.1; not drawn on the low tier)
 * @property {number} [halo] extra glow of middling size (about 2.5 % of the focal length): the halo of a lamp in
 *   damp air, a few times the lamp's size (0: none; it takes its share from the bloom's other two lobes)
 */

/**
 * What the game tells the pipeline about one view, each frame.
 * @typedef {object} ViewFrame
 * @property {number} exposure linear multiplier, already eased by the game in the fixed step
 * @property {Look} look
 * @property {number} motionBlur the shutter, as a fraction of a sixtieth of a second (0.5: 1/120 s; 0: no blur)
 * @property {boolean} cut the camera jumped this frame: no blur from the last one
 * @property {Array<{ matrix: THREE.Matrix4, prevMatrix: THREE.Matrix4, center: THREE.Vector3, half: THREE.Vector3 }>} sharp
 *   up to 4 rigid boxes (cars): where each is in this frame and where it was in the last one drawn, and its extent
 *   in its own space. What is inside a box is blurred by the box's movement relative to the camera, not by the
 *   scenery's. A box should stop short of the ground the thing stands on, or the ground under it counts as part
 *   of it.
 * @property {THREE.CubeTexture} [probe] the view's reflection probe; only ?debug=probe looks at it
 * @property {object} [_pipe] the pipeline's memory of this view (its last frame)
 */

/** A Look that changes nothing: the tone curve alone. */
export const NEUTRAL_LOOK = Object.freeze({
  contrast: 1,
  saturation: 1,
  tint: Object.freeze([1, 1, 1]),
  lift: Object.freeze([0, 0, 0]),
  vignette: 0,
  chroma: 0,
  grain: 0,
  bloom: 0,
  ghosts: 0,
  glare: 0,
  ao: 0,
  splitShadows: Object.freeze([1, 1, 1]),
  splitHighlights: Object.freeze([1, 1, 1]),
  splitBalance: 0.5,
  halo: 0,
  star: 0,
});

/** The frame time the shutter is a fraction of, whatever the screen's own. */
const SHUTTER_FRAME = 1 / 60;

const BLUR = {
  /** The longest streak, as a fraction of the view's width, where the tier does not say (TIERS.blurLength). */
  maxLength: 0.04,
  /** Frames further apart than this (seconds of the run) are not compared: the first one after is drawn sharp. */
  maxGap: 0.25,
  /** The streak is never stretched to more than this many times what was measured between the two frames. */
  maxRatio: 8,
};

/**
 * The glow. Its shape is two lobes, each a share of the light spread over a blur of a given size; sizes are
 * angles (the blur's standard deviation as a fraction of the focal length), so a lamp has the same glow in a
 * full view, in half a split screen and on a phone. `spread` is how many octaves of size a lobe covers each way.
 */
const BLOOM = {
  core: { size: 0.008, spread: 1.0, share: 0.45 },
  veil: { size: 0.075, spread: 1.25, share: 0.55 },
  /** Look.halo's lobe: its share is Look.halo, and the three are scaled back to a total of 1. */
  halo: { size: 0.025, spread: 0.6 },
  /**
   * Fireflies: in the first halving, a patch brighter than this (times what the exposure calls 1) counts for
   * less the brighter it is. Far above any lamp, so that a lamp's glow is in proportion to the lamp.
   */
  knee: 2000,
  /** Standard deviation of pyramid level i, measured: this many scene pixels times 2^i. */
  sigma: 2.2,
};

/**
 * The star of Look.star. Only light this many times what the exposure calls white counts, and only what lies
 * above that; the arms are this long (a share of the focal length) and turned this far from upright (radians).
 */
const STAR = { floor: 4, length: 0.06, turn: 0.26 };

/** Edge smoothing (only where the scene is not multisampled): how much single odd pixels are softened, and the contrast below which nothing is done. */
const FXAA = { subpixel: 0.3, threshold: 0.1, steps: 7 };

/**
 * Ambient occlusion (only where the tier has `aoSamples` and the Look asks for it). The numbers are world sizes
 * and scene-light levels, so the shadow is the same size on every screen and at every render scale.
 */
const AO = {
  /**
   * How far round a point the occluders are looked for, in metres. (render lane: 1.2 m drew a dark halo a car's
   * width round the car on sunlit road, as a soft blob that read as its shadow; the term darkens the finished
   * picture, sun and all, so it must stay a contact shade: 0.7 m keeps the dark under sills, at the foot of walls
   * and in window reveals and loses the halo)
   */
  radius: 0.7,
  /** ...but never further than this share of the view's height: a wall a metre from the lens would take seconds. */
  maxScreen: 0.12,
  /** The occlusion fades out between these distances from the camera (m): far away it would be depth noise. */
  fade: [60, 160],
  /** How much darker a fully enclosed point gets than the mean of its horizon cosines says (the term's gain). */
  gain: 5,
  /** Exposed scene light between which a pixel stops taking occlusion: lamps, lit windows, glints and their mirror images. */
  emit: [0.9, 3],
  /** How different two distances may be (as a share of the nearer) before the blur stops mixing their occlusion. */
  edge: 0.06,
};

const DEBUG_MODES = { scene: 0, depth: 1, velocity: 2, bloom: 3, probe: 4, ao: 5 };

// What every pass that reads the picture of one view needs. A view fills only the corner of a shared target
// that it needs, so lookups are made in texels and held inside the view: a filtered read at the view's edge
// must not pick up what another view left beyond it.
const SOURCE_GLSL = /* glsl */ `
uniform sampler2D uColor;   // the view's picture
uniform vec4 uTexels;       // of uColor: 1 / the target's size (xy), the centre of the view's last texel (zw)
uniform vec2 uView;         // the view's size in those texels
vec3 colourAt(vec2 p) { return fromTarget(texture(uColor, min(p, uTexels.zw) * uTexels.xy)).rgb; }
`;

const MOTION_GLSL = /* glsl */ `
uniform highp sampler2D uDepth;  // the scene's depth, same size as uColor
uniform vec4 uDistance;          // window depth -> distance from the camera: (z x + y) / (z z + w), z = 2 depth - 1
uniform mat4 uReproject[5];      // clip space now -> clip space a frame ago: of the scenery [0], of each sharp box [1..4]
uniform mat4 uToBox[4];          // clip space now -> the box's own space, scaled so that inside is |x|, |y|, |z| < w
uniform int uBoxes;
uniform vec2 uBlur;              // exposure time / time between the two frames, the longest streak in texels
#define BLUR_EDGE 1.45            // ...times this in the picture's corners (see streakOf)

float depthAt(vec2 p) { return texture(uDepth, min(p, uTexels.zw) * uTexels.xy).r; }
vec4 clipAt(vec2 p, float depth) { return vec4(p / uView * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0); }
float distanceOf(float depth) {
  float z = depth * 2.0 - 1.0;
  return (z * uDistance.x + uDistance.y) / (z * uDistance.z + uDistance.w);
}

// Which sharp box the point lies in, counted from 1; 0 for the scenery.
int boxOf(vec4 clip) {
  for (int i = 0; i < 4; i++) {
    if (i >= uBoxes) break;
    vec4 q = uToBox[i] * clip;
    vec3 a = abs(q.xyz);
    if (max(a.x, max(a.y, a.z)) < q.w) return i + 1;
  }
  return 0;
}

// How far the point moved across the picture during the exposure, in texels.
vec2 streakOf(vec4 clip, int box) {
  vec4 then = uReproject[box] * clip;
  if (then.w < 1.0e-5) return vec2(0.0); // it was behind the camera
  vec2 v = (clip.xy - then.xy / then.w) * 0.5 * uView * uBlur.x;
  // the longest streak allowed grows towards the picture's corners (to BLUR_EDGE times the tier's length): the eye
  // reads speed at the edges of the frame, where the roadside goes by, and wants the middle, where it looks, calm
  float longest = uBlur.y * mix(1.0, BLUR_EDGE, smoothstep(0.35, 1.0, length(clip.xy) * 0.7071));
  return v * min(1.0, longest / max(length(v), 1.0e-6));
}

// The movement of the pixel at p: its streak, and the depth and the box it was taken from.
vec2 motionAt(vec2 p, out float depth, out int box) {
  depth = depthAt(p);
  vec2 from = p;
#ifdef BLUR_DILATE
  // A pixel on an outline is part one thing and part another, but its depth is only one of them. The nearest
  // of the pixel and its four neighbours decides for all five: the whole outline of a thing moves with the
  // thing, so the smoothed edge of a sharp car is not torn off by the road's blur behind it.
  for (int i = 0; i < 4; i++) {
    vec2 q = p + vec2(i == 0 ? 1.0 : (i == 1 ? -1.0 : 0.0), i == 2 ? 1.0 : (i == 3 ? -1.0 : 0.0));
    float d = depthAt(q);
    if (d < depth) { depth = d; from = q; }
  }
#endif
  vec4 clip = clipAt(from, depth);
  box = boxOf(clip);
  return streakOf(clip, box);
}

// Interleaved gradient noise (Jorge Jimenez): every 3x3 block of pixels holds values spread evenly over 0..1,
// so the eye averages neighbouring pixels to the result of nine times the samples.
float interleavedNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// The picture at p, averaged along the pixel's own streak. centre is the unblurred pixel.
vec3 motionBlur(vec2 p, vec3 centre) {
  float depth;
  int box;
  vec2 v = motionAt(p, depth, box);
  float len = length(v);
  if (len < 0.5) return centre;

  float here = distanceOf(depth);
  // no more samples than the streak has room for: most of the picture moves little
  int taps = clamp(int(ceil(len / 2.0)), 2, BLUR_TAPS);
  float jitter = interleavedNoise(gl_FragCoord.xy);
  vec3 sum = centre;
  float total = 1.0;
  for (int i = 0; i < BLUR_TAPS; i++) {
    if (i >= taps) break;
    vec2 q = p + v * ((float(i) + jitter) / float(taps) - 0.5);
    float d = depthAt(q);
    vec4 clip = clipAt(q, d);
    int other = boxOf(clip);
    float w = 1.0;
    if (other != box) {
      // The sample belongs to something that moves differently. It counts only if it really passed over this
      // pixel during the exposure:
      if (distanceOf(d) < here * 0.97) {
        // it is in front: did its own streak reach this far? (A sharp car in front of the road: no.)
#ifdef BLUR_COVER
        w = clamp(0.5 * length(streakOf(clip, other)) - length(q - p) + 1.0, 0.0, 1.0);
#else
        w = 0.0;
#endif
      } else if (box == 0) {
        // it is a box behind the scenery this pixel shows. The scenery slides along itself; what follows this
        // point of the road across the pixel is more road, never the car further on.
        w = 0.0;
      }
      // (otherwise this pixel is a moving box and the sample lies behind it: it shows through the blur)
    }
    sum += colourAt(q) * w;
    total += w;
  }
  return sum / total;
}
`;

const BLUR_FRAGMENT = /* glsl */ `
${SOURCE_GLSL}
${MOTION_GLSL}
void main() {
  vec3 centre = fromTarget(texelFetch(uColor, ivec2(gl_FragCoord.xy), 0)).rgb;
  outColor = toTarget(vec4(motionBlur(gl_FragCoord.xy, centre), 1.0));
}
`;

// ---- ambient occlusion: three passes at half the view's size and one that puts the result into the picture.
//
// The half-size grid takes its distances from one full-size texel each, (2i, 2j), in every pass, so that the
// three passes and the upsampling agree about which surface a half-size pixel belongs to.
const AO_COMMON_GLSL = /* glsl */ `
uniform highp sampler2D uDepth;  // the scene's depth, full size
uniform vec4 uTexels;            // of uDepth: 1 / the target's size (xy), the centre of the view's last texel (zw)
uniform vec2 uView;              // the view's full size in texels
uniform vec4 uDistance;          // window depth -> distance from the camera (as MOTION_GLSL)
uniform ivec2 uHalf;             // the view's half-size grid: its last texel
float distanceOf(float depth) {
  float z = depth * 2.0 - 1.0;
  return (z * uDistance.x + uDistance.y) / (z * uDistance.z + uDistance.w);
}
ivec2 fullTexel(ivec2 h) { return min(h * 2, ivec2(uTexels.zw)); }
// depth 1 is what nothing was drawn on: the sky (it is drawn without writing depth)
float rawDepth(ivec2 h) { return texelFetch(uDepth, fullTexel(clamp(h, ivec2(0), uHalf)), 0).r; }
float distAt(ivec2 h) { return distanceOf(rawDepth(h)); }
// how much the occlusion of a point at distance d counts for one at distance centre: 1 on the same surface,
// 0 across a silhouette
float sameSurface(float d, float centre) {
  float r = (d - centre) / (${AO.edge.toFixed(3)} * min(d, centre));
  return exp(-r * r);
}
`;

// The occlusion term (1: open, 0: enclosed), after McGuire's Scalable Ambient Obscurance: points round this one
// within a world radius, each counting by how far above this point's surface it rises (the cosine between the
// normal and the way to it), fading out toward the radius. Normals come from the depth itself.
const AO_FRAGMENT = /* glsl */ `
${AO_COMMON_GLSL}
uniform vec4 uProj;     // of the camera: P00, P11, P02, P12 (window position and distance -> view space)
uniform vec4 uAoSize;   // radius (m), radius^2, focal length in half-size texels, the longest radius in them
uniform vec2 uFade;     // distances (m) over which the occlusion fades out
vec3 viewPos(ivec2 h, float d) {
  vec2 ndc = (vec2(fullTexel(h)) + 0.5) / uView * 2.0 - 1.0;
  return vec3((ndc + uProj.zw) * d / uProj.xy, -d);
}
// One-sided differences, the smaller of the two: across a silhouette the other side belongs to another surface
// and would tilt the normal.
vec3 sideStep(vec3 p, ivec2 h, ivec2 step) {
  ivec2 up = h + step;
  ivec2 down = h - step;
  // at the view's edge only one side exists
  if (any(greaterThan(up, uHalf))) up = h;
  if (any(lessThan(down, ivec2(0)))) down = h;
  vec3 a = viewPos(up, distAt(up)) - p;
  vec3 b = p - viewPos(down, distAt(down));
  if (up == h) return b;
  if (down == h) return a;
  return abs(a.z) < abs(b.z) ? a : b;
}
// A fixed 4x4 pattern of sixteen values spread over 0..1: neighbouring pixels turn their sample spiral to
// different angles, and the 4x4 blur that follows averages them. Fixed in screen space: a still is the same
// every time.
const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
float pattern(ivec2 h) {
  ivec2 q = h & 3;
  return (float(BAYER[q.y * 4 + q.x]) + 0.5) / 16.0;
}
void main() {
  ivec2 h = ivec2(gl_FragCoord.xy);
  float depth = rawDepth(h);
  float d = distanceOf(depth);
  if (depth >= 1.0 || d >= uFade.y) { outColor = vec4(1.0); return; }
  float rPx = min(uAoSize.x * uAoSize.z / d, uAoSize.w);
  if (rPx < 1.5) { outColor = vec4(1.0); return; }

  vec3 p = viewPos(h, d);
  vec3 n = normalize(cross(sideStep(p, h, ivec2(1, 0)), sideStep(p, h, ivec2(0, 1))));
  // (depth steps grow with distance: so does what counts as lying on the surface itself)
  float bias = 0.02 + 0.002 * d;
  float turn = pattern(h);
  float sum = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float a = (float(i) + fract(turn * 7.0 + 0.5)) / float(AO_SAMPLES);
    float angle = 6.2831853 * (a * AO_TURNS + turn);
    ivec2 q = clamp(h + ivec2(round(a * rPx * vec2(cos(angle), sin(angle)))), ivec2(0), uHalf);
    vec3 v = viewPos(q, distAt(q)) - p;
    float vv = dot(v, v);
    float fall = max(1.0 - vv / uAoSize.y, 0.0);
    sum += fall * max(dot(v, n) - bias, 0.0) * inversesqrt(vv + 1.0e-4);
  }
  float occlusion = clamp(sum * ${AO.gain.toFixed(3)} / float(AO_SAMPLES), 0.0, 1.0);
  occlusion *= 1.0 - smoothstep(uFade.x, uFade.y, d);
  outColor = vec4(1.0 - occlusion, 0.0, 0.0, 1.0);
}
`;

// Half of the 4x4 blur, along x or along y: weights 1/2, 1, 1, 1, 1/2 take in exactly one period of the
// pattern, so on an even surface it cancels completely; across a silhouette the distances stop the mixing.
const AO_BLUR_FRAGMENT = /* glsl */ `
${AO_COMMON_GLSL}
uniform sampler2D uAo;
uniform ivec2 uStep;
void main() {
  ivec2 h = ivec2(gl_FragCoord.xy);
  float centre = distAt(h);
  float sum = texelFetch(uAo, h, 0).r;
  float total = 1.0;
  for (int k = -2; k <= 2; k++) {
    if (k == 0) continue;
    ivec2 q = clamp(h + uStep * k, ivec2(0), uHalf);
    float w = (k == -2 || k == 2 ? 0.5 : 1.0) * sameSurface(distAt(q), centre);
    sum += texelFetch(uAo, q, 0).r * w;
    total += w;
  }
  outColor = vec4(sum / total, 0.0, 0.0, 1.0);
}
`;

// Into the picture, at full size: the four nearest half-size values, each by its bilinear share and by whether
// it lies on this pixel's surface. A pixel no neighbour agrees with (a lamp post a pixel wide) is left open,
// so thin things never print a dark outline. Pixels much brighter than any lit surface (lamps, lit windows,
// glints, their images in the wet road) are what emits light, which no occlusion dims.
const AO_APPLY_FRAGMENT = /* glsl */ `
${AO_COMMON_GLSL}
uniform sampler2D uColor;
uniform sampler2D uAo;
uniform float uStrength;  // Look.ao
uniform vec2 uEmit;       // scene light (after exposure) over which a pixel stops taking occlusion
uniform float uExposure;
uniform bool uShow;       // ?debug=ao: write the term itself
void main() {
  ivec2 ix = ivec2(gl_FragCoord.xy);
  vec3 c = fromTarget(texelFetch(uColor, ix, 0)).rgb;
  float depth = texelFetch(uDepth, ix, 0).r;
  float term = 1.0;
  if (depth < 1.0) {
    float centre = distanceOf(depth);
    vec2 hp = (vec2(ix) + 0.5) * 0.5 - 0.5;
    ivec2 h0 = ivec2(floor(hp));
    vec2 f = hp - vec2(h0);
    float sum = 0.0;
    float total = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1);
      ivec2 q = clamp(h0 + o, ivec2(0), uHalf);
      vec2 b = mix(1.0 - f, f, vec2(o));
      float w = b.x * b.y * sameSurface(distAt(q), centre) + 1.0e-5;
      sum += texelFetch(uAo, q, 0).r * w;
      total += w;
    }
    // too little agreement: open
    float ao = total > 0.02 ? sum / total : 1.0;
    float lit = 1.0 - smoothstep(uEmit.x, uEmit.y, luma(c) * uExposure);
    term = 1.0 - clamp(uStrength * (1.0 - ao), 0.0, 1.0) * lit;
  }
  outColor = toTarget(vec4(uShow ? vec3(term) : c * term, 1.0));
}
`;

// One halving of the bloom pyramid. Output pixel (i, j) sits on the corner between source texels 2i, 2i + 1 and
// 2j, 2j + 1, so each of the 13 lookups is the mean of a 2x2 block; together they weigh a 6x6 block of the
// source so that every source texel, wherever it is on the grid, adds the same total to the result. That is
// why a small light can cross the pixel grid without its glow flickering.
const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec4 uTexels;   // of uTex: 1 / the target's size (xy), the centre of the view's last texel (zw)
#ifdef KARIS
uniform float uKnee;    // in scene units
#endif
vec3 tap(float x, float y) {
  return fromTarget(texture(uTex, min(gl_FragCoord.xy * 2.0 + vec2(x, y), uTexels.zw) * uTexels.xy)).rgb;
}
void main() {
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
#ifdef KARIS
  // First step only: the same filter as five overlapping boxes, each counted for less the brighter it is (Brian
  // Karis's average). One pixel thousands of times brighter than a lamp (a glint, a bad value) cannot light up
  // a blob that flashes on and off; anything below the knee passes as it is.
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 / (1.0 + luma(g0) / uKnee);
  float w1 = 0.125 / (1.0 + luma(g1) / uKnee);
  float w2 = 0.125 / (1.0 + luma(g2) / uKnee);
  float w3 = 0.125 / (1.0 + luma(g3) / uKnee);
  float w4 = 0.125 / (1.0 + luma(g4) / uKnee);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  outColor = toTarget(vec4(col, 1.0));
}
`;

// LOOK LANE (day stage): the flare source. One pixel that sums, over a small level of the pyramid, the light
// far above white: where it is (its centroid on the view, 0..1) and how much there is (scene units times the
// share of the view it covers). Only the sun gets over the threshold; lamps, glints and the sky do not. The lens
// ghosts and the glare veil of the last pass are drawn from this, as shapes, not as copies of the picture.
const FLARE_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform ivec2 uSize;     // the view's texels in that level
uniform float uFloor;    // scene units below which nothing counts
// LOOK LANE (day stage): where the light named by look.flare stands on the view (it may lie outside it), its
// light as it would be measured in the frame, how much of it the lens still takes from outside the frame, and
// the sky's brightness (scene units) that says it is not behind something
uniform vec4 uSun;       // uv (x, y), light, 0..1 fade for lying outside the frame
uniform float uSunSky;
void main() {
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 64; j++) {
    if (j >= uSize.y) break;
    for (int i = 0; i < 64; i++) {
      if (i >= uSize.x) break;
      float w = max(luma(fromTarget(texelFetch(uTex, ivec2(i, j), 0)).rgb) - uFloor, 0.0);
      sum += vec3(w, w * (vec2(i, j) + 0.5) / vec2(uSize));
    }
  }
  float n = float(uSize.x * uSize.y);
  // a light just outside the frame still flares, if the edge of the view nearest it shows open, bright sky
  if (sum.x <= 0.0 && uSun.z > 0.0 && uSun.w > 0.0) {
    ivec2 at = clamp(ivec2(clamp(uSun.xy, 0.0, 1.0) * vec2(uSize)), ivec2(0), uSize - 1);
    float sky = luma(fromTarget(texelFetch(uTex, at, 0)).rgb);
    float seen = smoothstep(0.5, 1.0, sky / uSunSky);
    outColor = toTarget(vec4(uSun.xy, uSun.z * uSun.w * seen, 1.0));
    return;
  }
  outColor = toTarget(vec4(sum.y / max(sum.x, 1.0e-6), sum.z / max(sum.x, 1.0e-6), sum.x / n, 1.0));
}
`;

// The glints' star, on the second level of the pyramid (a quarter of the picture's size): each pixel gathers what
// lies above the floor along three lines through it, so a bright point becomes six arms that fade out with
// distance. The pyramid's own filter has already spread a glint over a few texels: the arms are soft.
const STAR_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec4 uTexels;   // of uTex: 1 / the target's size (xy), the centre of the view's last texel (zw)
uniform float uFloor;   // scene units below which nothing counts
uniform vec3 uArm;      // the first arm's direction (xy) and its length in texels (z)
vec3 above(vec2 p) {
  vec3 c = fromTarget(texture(uTex, clamp(p, vec2(0.5), uTexels.zw) * uTexels.xy)).rgb;
  float l = luma(c);
  return c * max(0.0, 1.0 - uFloor / max(l, 1.0e-6));
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 sum = vec3(0.0);
  float c60 = 0.5, s60 = 0.8660254;
  for (int a = 0; a < 3; a++) {
    vec2 d = a == 0 ? uArm.xy : (a == 1 ? mat2(c60, s60, -s60, c60) * uArm.xy : mat2(c60, -s60, s60, c60) * uArm.xy);
    for (int i = 1; i <= STAR_TAPS; i++) {
      float t = float(i) / float(STAR_TAPS);
      float w = (1.0 - t) * (1.0 - t);
      vec2 o = d * (t * uArm.z);
      sum += (above(p + o) + above(p - o)) * w;
    }
  }
  outColor = toTarget(vec4(sum / float(STAR_TAPS), 1.0));
}
`;

// Back up the pyramid: this level's own picture times its weight, plus everything smaller, enlarged with a
// 3x3 tent.
const UP_FRAGMENT = /* glsl */ `
uniform sampler2D uSmall;    // the sum of the smaller levels so far
uniform sampler2D uBase;     // this level's own picture
uniform vec4 uSmallTexels;   // of uSmall: 1 / the target's size (xy), the centre of the view's last texel (zw)
uniform vec2 uWeights;       // of uSmall, of uBase
vec3 small(float x, float y) {
  return fromTarget(texture(uSmall, min(gl_FragCoord.xy * 0.5 + vec2(x, y), uSmallTexels.zw) * uSmallTexels.xy)).rgb;
}
void main() {
  vec3 sum = small(0.0, 0.0) * 4.0
    + (small(-1.0, 0.0) + small(1.0, 0.0) + small(0.0, -1.0) + small(0.0, 1.0)) * 2.0
    + small(-1.0, -1.0) + small(1.0, -1.0) + small(-1.0, 1.0) + small(1.0, 1.0);
  vec3 base = fromTarget(texelFetch(uBase, ivec2(gl_FragCoord.xy), 0)).rgb;
  outColor = toTarget(vec4(sum * (uWeights.x / 16.0) + base * uWeights.y, 1.0));
}
`;

const DITHER_GLSL = /* glsl */ `
// Noise of one 8-bit step, triangular so that it adds no pattern of its own. Without it the sky's long
// gradients show as bands.
vec3 dither() { return (hash33(vec3(gl_FragCoord.xy, 5.0)) + hash33(vec3(gl_FragCoord.xy, 977.0)) - 1.0) / 255.0; }
`;

const GRAIN_GLSL = /* glsl */ `
uniform vec3 uGrain;   // amount, cell size in canvas pixels, seed (changes with the run's time)
// Film grain on the finished values: strongest in the mid-darks, absent in pure black.
vec3 grain(vec3 s) {
  vec2 cell = floor(gl_FragCoord.xy / uGrain.y);
  float n = hash13(vec3(cell, uGrain.z)) + hash13(vec3(cell + 71.0, uGrain.z)) - 1.0;
  float l = luma(s);
  return s + n * uGrain.x * smoothstep(0.0, 0.12, l) * (1.0 - 0.55 * l);
}
`;

// The last pass: everything that turns light into a picture.
//   SPLIT        write an 8-bit picture with its brightness in alpha for the edge smoothing, which then adds the grain
//   INLINE_BLUR  do the motion blur here, while reading the scene
//   LENS         chromatic aberration and ghosts
const FINAL_FRAGMENT = /* glsl */ `
${SOURCE_GLSL}
#ifdef INLINE_BLUR
${MOTION_GLSL}
#endif
uniform sampler2D uBloom;     // the glow: half the picture's size
uniform vec4 uBloomTexels;    // 1 / its target's size (xy), the centre of the view's last texel in it (zw)
uniform ivec2 uOrigin;        // the corner of what is being drawn into (the canvas rectangle, or 0)
uniform bool uExact;          // one pixel drawn per texel of the picture: read it pixel for pixel
uniform float uExposure;
uniform float uBloomMix;
uniform vec4 uGrade;          // contrast, saturation, vignette, chromatic aberration
uniform vec3 uTint;
uniform vec3 uLift;
uniform vec3 uSplitLo;        // split toning: the shadows' and the highlights' multipliers (brightness kept)
uniform vec3 uSplitHi;
uniform float uSplitBalance;  // the display brightness neither touches; 0: split toning off
#ifdef LENS
uniform sampler2D uGhostTex;  // the flare source: one pixel (FLARE_FRAGMENT)
uniform vec3 uGhosts;         // ghosts' share each, the glare veil's strength, the view's width over its height
uniform sampler2D uStarTex;   // the glints' star: a quarter of the picture's size
uniform vec4 uStarTexels;     // 1 / its target's size (xy), the centre of the view's last texel in it (zw)
uniform float uStar;          // Look.star
#endif
${DITHER_GLSL}
#ifndef SPLIT
${GRAIN_GLSL}
#endif

#ifdef LENS
// LOOK LANE (day stage): lens ghosts and glare, drawn from the flare source (its centroid f on the view and its
// light e). The ghosts lie on the line from it through the middle of the view, at -k times its offset from the
// middle: soft discs and rings of a few sizes, blue-violet with a slight colour fringe (each channel's edge a few
// per cent apart). Each carries the same share of the light, spread over its own area, so the small ones are the
// brighter. The glare is a broad warm veil round the source itself.
float ghostDisc(float d, float r) { return 1.0 - smoothstep(r * 0.72, r, d); }
float ghostRing(float d, float r) { return smoothstep(r * 0.62, r * 0.9, d) * (1.0 - smoothstep(r * 0.9, r, d)) + 0.18 * ghostDisc(d, r); }
vec3 ghostShape(vec2 uv, vec2 f, float k, float r, float ring) {
  vec2 g = 0.5 + (f - 0.5) * k;
  float d = length((uv - g) * vec2(uGhosts.z, 1.0));
  vec3 fr = vec3(1.04, 1.0, 0.96) * r;
  vec3 a = ring > 0.5 ? vec3(ghostRing(d, fr.r), ghostRing(d, fr.g), ghostRing(d, fr.b))
                      : vec3(ghostDisc(d, fr.r), ghostDisc(d, fr.g), ghostDisc(d, fr.b));
  return a / (3.1416 * r * r);
}
vec3 ghosts(vec2 uv) {
  vec4 src = fromTarget(texelFetch(uGhostTex, ivec2(0), 0));
  float e = src.z;
  if (e <= 0.0) return vec3(0.0);
  vec2 f = src.xy;
  vec3 sum = ghostShape(uv, f, -0.30, 0.095, 0.0) * vec3(0.55, 0.5, 1.0)
    + ghostShape(uv, f, -0.44, 0.026, 1.0) * vec3(0.7, 0.55, 1.0) * 0.7
    + ghostShape(uv, f, -0.50, 0.012, 0.0) * vec3(0.75, 0.5, 1.0) * 0.35
    + ghostShape(uv, f, -0.64, 0.062, 1.0) * vec3(0.6, 0.55, 1.0)
    + ghostShape(uv, f, -0.84, 0.075, 1.0) * vec3(0.5, 0.5, 1.0)
    + ghostShape(uv, f, -1.02, 0.060, 1.0) * vec3(0.6, 0.5, 1.0)
    + ghostShape(uv, f, -1.06, 0.018, 0.0) * vec3(0.5, 0.55, 1.0) * 0.5;
  // the glare: a white core about a fifth of the view across that washes out the sky round the source, and a
  // weak warm tail that reaches the far side of the view without greying it
  float d = length((uv - f) * vec2(uGhosts.z, 1.0));
  float core = 1.0 / (1.0 + (d * d) / (0.15 * 0.15));
  float tail = 1.0 / (1.0 + (d * d) / (0.35 * 0.35));
  vec3 veil = uGhosts.y * (vec3(1.0, 0.97, 0.92) * 40.0 * core * core + vec3(1.0, 0.9, 0.75) * 2.0 * tail);
  return e * (sum * uGhosts.x + veil);
}
#endif

void main() {
  vec2 p = vUv * uView; // this pixel in the picture's own texels
  vec3 c = uExact ? fromTarget(texelFetch(uColor, ivec2(gl_FragCoord.xy) - uOrigin, 0)).rgb : colourAt(p);
#ifdef INLINE_BLUR
  if (uBlur.x > 0.0) c = motionBlur(p, c);
#endif

  vec2 q = vUv - 0.5;
  float corner = dot(q, q) * 2.0; // 0 at the centre of the view, 1 in its corners, on any aspect
#ifdef LENS
  if (uGrade.w > 0.0) {
    // Lateral chromatic aberration: the lens draws red a little larger than green and blue a little smaller,
    // by an amount that grows with the cube of the distance from the centre. Nothing happens in the middle.
    vec2 d = q * (corner * uGrade.w) * uView;
    c.r = colourAt(p + d).r;
    c.b = colourAt(p - d).b;
  }
#endif

  // The glow is mixed in, not added: light is spread, none is made.
  if (uBloomMix > 0.0) c = mix(c, fromTarget(texture(uBloom, min(p * 0.5, uBloomTexels.zw) * uBloomTexels.xy)).rgb, uBloomMix);
#ifdef LENS
  if (uGhosts.x + uGhosts.y > 0.0) c += ghosts(vUv);
  // the star is light the lens moved, added like the ghosts
  if (uStar > 0.0) c += fromTarget(texture(uStarTex, min(p * 0.25, uStarTexels.zw) * uStarTexels.xy)).rgb * uStar;
#endif

  c *= uExposure * uTint;
  // Vignette, before the curve, so that it darkens as less light would.
  c *= 1.0 - uGrade.z * smoothstep(0.35, 1.0, sqrt(corner));
  c = toneCurve(c, uGrade.x);
  c = saturateColor(c, uGrade.y);
  if (uSplitBalance > 0.0) {
    // On display brightness (about what the eye calls half way), so the balance point means what it says: the
    // shadows' colour is in full a third of the scale below it, the highlights' a third above, and the balance
    // point itself is untouched. (Fading over the whole scale instead would leave a low-key picture, which has
    // no values near white, all but untoned.)
    float b = pow(clamp(luma(c), 0.0, 1.0), 1.0 / 2.2);
    c *= mix(vec3(1.0), uSplitLo, 1.0 - smoothstep(uSplitBalance - 0.33, uSplitBalance, b));
    c *= mix(vec3(1.0), uSplitHi, smoothstep(uSplitBalance, uSplitBalance + 0.33, b));
  }
  c += uLift * (1.0 - c) * (1.0 - c);
  vec3 s = linearToSrgb(c);

#ifdef SPLIT
  // cut to 8 bits here, so dithered here; the edge smoothing reads the brightness nine times a pixel or more
  s += dither();
  outColor = vec4(s, dot(s, vec3(0.299, 0.587, 0.114)));
#else
  outColor = vec4(grain(s) + dither(), 1.0);
#endif
}
`;

// Edge smoothing and grain, for a scene that was not multisampled: from the 8-bit picture to the canvas.
const FINISH_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;   // the graded picture (sRGB values), brightness in alpha
uniform vec4 uTexels;     // 1 / its target's size (xy), the centre of the view's last texel (zw)
uniform vec2 uView;       // the view's size in its texels
uniform vec2 uFxaa;       // how much single odd pixels are softened, contrast below which nothing is done
${DITHER_GLSL}
${GRAIN_GLSL}

// FXAA (Timothy Lottes' method): find pixels on a contrast edge, work out which way the edge runs, walk along
// it both ways to find where its staircase step begins and ends, and shift the lookup across the edge by how
// far along the step this pixel is. The shifted lookup blends the two sides in just the proportion a properly
// antialiased edge would have. All positions are in texels of the picture.
vec4 at(vec2 p) { return texture(uTex, min(p, uTexels.zw) * uTexels.xy); }
float lumAt(vec2 p) { return at(p).a; }
vec3 smoothEdges(vec2 p) {
  vec4 middle = at(p);
  float lM = middle.a;
  float lN = lumAt(p + vec2(0.0, 1.0));
  float lS = lumAt(p - vec2(0.0, 1.0));
  float lE = lumAt(p + vec2(1.0, 0.0));
  float lW = lumAt(p - vec2(1.0, 0.0));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.03, lMax * uFxaa.y)) return middle.rgb;

  float lNE = lumAt(p + vec2(1.0, 1.0));
  float lSW = lumAt(p - vec2(1.0, 1.0));
  float lNW = lumAt(p + vec2(-1.0, 1.0));
  float lSE = lumAt(p + vec2(1.0, -1.0));
  float horizontal = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  float vertical = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  bool isHorizontal = horizontal >= vertical;

  // the two neighbours across the edge; the edge lies toward the one that differs more
  float l1 = isHorizontal ? lS : lW;
  float l2 = isHorizontal ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  float across = 1.0;
  float edgeLum;
  if (g1 >= g2) { across = -1.0; edgeLum = 0.5 * (l1 + lM); } else { edgeLum = 0.5 * (l2 + lM); }
  float enough = 0.25 * max(g1, g2);

  // walk along the edge, half a texel toward it, until the brightness leaves the edge's own
  vec2 along = isHorizontal ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 start = p + (isHorizontal ? vec2(0.0, across * 0.5) : vec2(across * 0.5, 0.0));
  vec2 p1 = start - along;
  vec2 p2 = start + along;
  float e1 = lumAt(p1) - edgeLum;
  float e2 = lumAt(p2) - edgeLum;
  bool done1 = abs(e1) >= enough;
  bool done2 = abs(e2) >= enough;
  for (int i = 1; i < FXAA_STEPS; i++) {
    if (done1 && done2) break;
    // longer strides further out: a long shallow step is found in few lookups
    float stride = i < 3 ? 1.0 : (i < 5 ? 2.0 : 4.0);
    if (!done1) { p1 -= along * stride; e1 = lumAt(p1) - edgeLum; done1 = abs(e1) >= enough; }
    if (!done2) { p2 += along * stride; e2 = lumAt(p2) - edgeLum; done2 = abs(e2) >= enough; }
  }
  float d1 = isHorizontal ? p.x - p1.x : p.y - p1.y;
  float d2 = isHorizontal ? p2.x - p.x : p2.y - p.y;
  float nearEnd = d1 < d2 ? e1 : e2;
  // only shift if the nearer end of the step really turns the way this pixel's side would predict
  float shift = ((nearEnd < 0.0) != (lM < edgeLum)) ? 0.5 - min(d1, d2) / (d1 + d2) : 0.0;

  // a pixel that simply differs from all its neighbours (a speck, a spark) is softened a little
  float average = (2.0 * (lN + lS + lE + lW) + lNE + lNW + lSE + lSW) / 12.0;
  float odd = clamp(abs(average - lM) / range, 0.0, 1.0);
  odd = odd * odd * (3.0 - 2.0 * odd);
  shift = max(shift, odd * odd * uFxaa.x);

  return at(p + (isHorizontal ? vec2(0.0, shift * across) : vec2(shift * across, 0.0))).rgb;
}

void main() {
  vec3 s = smoothEdges(vUv * uView);
  outColor = vec4(grain(s) + dither(), 1.0);
}
`;

// One buffer of the frame as it is, for ?debug= and for ?post=0 (mode 0: the scene through exposure and the
// tone curve, nothing else).
const PRESENT_FRAGMENT = /* glsl */ `
${SOURCE_GLSL}
${MOTION_GLSL}
${GLSL_PROBE}
uniform int uMode;            // 0 scene, 1 depth, 2 velocity, 3 bloom, 4 probe, 5 ambient occlusion
uniform sampler2D uBloom;
uniform vec4 uBloomTexels;
uniform samplerCube uProbe;
uniform ivec2 uOrigin;
uniform bool uExact;
uniform float uExposure;
${DITHER_GLSL}
void main() {
  vec2 p = vUv * uView;
  vec3 c;
  if (uMode == 0) {
    vec3 scene = uExact ? fromTarget(texelFetch(uColor, ivec2(gl_FragCoord.xy) - uOrigin, 0)).rgb : colourAt(p);
    c = toneCurve(scene * uExposure, 1.0);
  } else if (uMode == 1) {
    // distance: white at the lens, middle grey at 10 m, black far away
    c = vec3(0.18 * 10.0 / max(distanceOf(depthAt(p)), 0.5));
  } else if (uMode == 2) {
    // movement: red and green are the streak's x and y (grey: none, full colour: the longest allowed); blue marks the sharp boxes
    float depth;
    int box;
    vec2 v = motionAt(p, depth, box);
    c = vec3(0.5 + 0.5 * v / uBlur.y, box == 0 ? 0.0 : 0.25 + 0.25 * float(box));
    c *= c;
  } else if (uMode == 3) {
    c = toneCurve(fromTarget(texture(uBloom, min(p * 0.5, uBloomTexels.zw) * uBloomTexels.xy)).rgb * uExposure, 1.0);
  } else if (uMode == 5) {
    // the occlusion term as it is put into the picture: white open, black enclosed (uColor holds it)
    // (no ambient occlusion on this tier: all open)
    c = uExposure > 0.0 ? srgbToLinear(clamp(colourAt(p), 0.0, 1.0)) : vec3(1.0);
  } else {
    // the probe unrolled: the horizon across the middle, +Z in the centre, +X a quarter to the left of it, up at the top
    float lon = (0.5 - vUv.x) * 6.2831853;
    float lat = (vUv.y - 0.5) * 3.1415927;
    c = toneCurve(probeSample(uProbe, vec3(sin(lon) * cos(lat), sin(lat), cos(lon) * cos(lat)), 0.0) * uExposure, 1.0);
  }
  outColor = vec4(linearToSrgb(c) + dither(), 1.0);
}
`;

/** The share of a lobe that lies below `u`, in octaves of size from its centre. */
function lobeBelow(u, spread) {
  const t = Math.min(1, Math.max(0, (u + spread) / (2 * spread)));
  return t * t * (3 - 2 * t);
}

/** Row-major 4x4 that takes a point of a box's space to where the box is the cube -1..1 (a hair generous). */
function boxNormal(out, center, half) {
  const g = 1.01;
  return out.set(
    1 / (half.x * g), 0, 0, -center.x / (half.x * g),
    0, 1 / (half.y * g), 0, -center.y / (half.y * g),
    0, 0, 1 / (half.z * g), -center.z / (half.z * g),
    0, 0, 0, 1,
  );
}

function sameMatrix(a, b) {
  const x = a.elements;
  const y = b.elements;
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return false;
  return true;
}

const viewProj = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const scratch = new THREE.Matrix4();

export class FramePipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer one that an Engine made: the engine's clock, frame count and render
   *   scale are read from it
   * @param {import('./caps.js').Caps} caps
   * @param {{ tier: import('./caps.js').Tier, post?: boolean, overrides?: { look?: Partial<Look>, ev?: number, shutter?: number|null } }} options
   *   `post: false` shows the scene through exposure and the tone curve only; `overrides` replace fields of every
   *   view's Look, bias its exposure (stops) and replace its shutter, for matching a picture by hand (default: the
   *   page's ?ao=, ?ev=, ?shutter=, …)
   */
  constructor(renderer, caps, { tier, post = true, overrides = parseParams() }) {
    this.renderer = renderer;
    this.caps = caps;
    this.post = post;
    /** Look fields that replace the view's own (empty: the view's Look is used as it is). */
    this.overrides = { ...(overrides.look || {}) };
    /** Exposure bias in stops. */
    this.ev = overrides.ev || 0;
    /** The shutter in place of the view's (null: the view's). */
    this.shutter = overrides.shutter ?? null;
    this._look = {};
    this.engine = Engine.of(renderer);
    if (!this.engine) throw new Error('FramePipeline: this renderer was not made by an Engine');
    /** Name of an intermediate buffer to show instead of the picture: scene, depth, velocity, bloom or probe. */
    this.debug = null;

    // must happen before the first material is compiled
    if (!caps.hdr) installLdrEncoding();

    // What the passes share. The uniform objects are handed to several materials: setting one sets it for all.
    this._texels = { value: new THREE.Vector4() };
    this._viewSize = { value: new THREE.Vector2() };
    this._motion = {
      uDepth: { value: null },
      uDistance: { value: new THREE.Vector4() },
      uReproject: { value: Array.from({ length: 5 }, () => new THREE.Matrix4()) },
      uToBox: { value: Array.from({ length: 4 }, () => new THREE.Matrix4()) },
      uBoxes: { value: 0 },
      uBlur: { value: new THREE.Vector2() },
    };
    this._grain = { value: new THREE.Vector3() };
    this._aoHalf = { value: new THREE.Vector2() };

    this._frame = -1;
    this._sizeNow = { w: 0, h: 0 };
    this._sizeBefore = { w: 0, h: 0 };
    this._passes = 0;
    this._levels = [];
    this._weights = [];
    this._targets = [];
    this._materials = [];
    this.tier = null;
    this.setTier(tier);
  }

  /** @param {import('./caps.js').Tier} tier */
  setTier(tier) {
    if (tier === this.tier) return;
    this._release();
    this.tier = tier;
    const { caps } = this;
    const T = TIERS[tier];
    const keep = (target) => {
      this._targets.push(target);
      return target;
    };
    const pass = (fragmentShader, uniforms, defines = {}) => {
      const material = createPassMaterial(caps, { fragmentShader, uniforms, defines });
      this._materials.push(material);
      return new FullscreenPass(material);
    };

    /** The scene: linear light and depth, multisampled where the tier and the device allow. */
    this.sceneTarget = keep(createTarget(caps, { depthTexture: true, samples: T.msaa }));
    this.sceneTarget.scissorTest = true;
    /** Samples the scene target really has. */
    this.samples = this.sceneTarget.samples;
    // jagged edges are smoothed on the finished picture where the scene's own samples could not do it
    this.fxaa = this.samples === 0;
    this.blurTaps = T.blurTaps;
    this.blurLength = T.blurLength ?? BLUR.maxLength;
    this.blurInline = T.blurInline && T.blurTaps > 0;
    this.lens = T.lens;
    this.levels = T.bloomLevels;
    this.aoSamples = T.aoSamples || 0;

    const source = (uColor) => ({ uColor, uTexels: this._texels, uView: this._viewSize });
    const motionDefines = { BLUR_TAPS: Math.max(1, T.blurTaps) };
    if (this.samples > 0) motionDefines.BLUR_DILATE = 1;
    if (!this.blurInline) motionDefines.BLUR_COVER = 1;

    this._blurTarget = null;
    this._blur = null;
    if (T.blurTaps > 0 && !this.blurInline) {
      this._blurTarget = keep(createTarget(caps));
      this._blur = pass(BLUR_FRAGMENT, { ...source({ value: this.sceneTarget.texture }), ...this._motion }, motionDefines);
    }

    this._down = Array.from({ length: this.levels }, () => keep(createTarget(caps)));
    this._up = Array.from({ length: this.levels - 1 }, () => keep(createTarget(caps)));
    const downUniforms = () => ({ uTex: { value: null }, uTexels: { value: new THREE.Vector4() } });
    this._karis = pass(DOWN_FRAGMENT, { ...downUniforms(), uKnee: { value: 1 } }, { KARIS: 1 });
    this._halve = pass(DOWN_FRAGMENT, downUniforms());
    // LOOK LANE: the flare source, one pixel (only where the lens is drawn)
    this._flareTarget = null;
    this._flare = null;
    if (this.lens) {
      this._flareTarget = keep(createTarget(caps));
      resizeTarget(this._flareTarget, 1, 1);
      this._flare = pass(FLARE_FRAGMENT, {
        uTex: { value: null },
        uSize: { value: new THREE.Vector2() },
        uFloor: { value: 30 },
        uSun: { value: new THREE.Vector4() },
        uSunSky: { value: 1 },
      });
    }
    // the glints' star (only where the lens is drawn), at the second level's size
    this._starTarget = null;
    this._star = null;
    if (this.lens && this.levels >= 2) {
      this._starTarget = keep(createTarget(caps));
      this._star = pass(
        STAR_FRAGMENT,
        { uTex: { value: null }, uTexels: { value: new THREE.Vector4() }, uFloor: { value: 1 }, uArm: { value: new THREE.Vector3() } },
        { STAR_TAPS: 6 },
      );
    }
    this._enlarge = pass(UP_FRAGMENT, {
      uSmall: { value: null },
      uBase: { value: null },
      uSmallTexels: { value: new THREE.Vector4() },
      uWeights: { value: new THREE.Vector2() },
    });

    // Ambient occlusion: two half-size 8-bit targets (the term needs no more) and a full-size one for the picture
    // with the term multiplied in, which then stands in for the scene in everything that follows.
    this._ao = null;
    if (this.aoSamples > 0) {
      const small = () =>
        keep(
          new THREE.WebGLRenderTarget(4, 4, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            colorSpace: THREE.NoColorSpace,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            depthBuffer: false,
            stencilBuffer: false,
          }),
        );
      const common = () => ({
        uDepth: { value: this.sceneTarget.depthTexture },
        uTexels: this._texels,
        uView: this._viewSize,
        uDistance: this._motion.uDistance,
        uHalf: this._aoHalf,
      });
      this._ao = {
        a: small(),
        b: small(),
        picture: keep(createTarget(caps)),
        term: pass(
          AO_FRAGMENT,
          {
            ...common(),
            uProj: { value: new THREE.Vector4() },
            uAoSize: { value: new THREE.Vector4() },
            uFade: { value: new THREE.Vector2(AO.fade[0], AO.fade[1]) },
          },
          { AO_SAMPLES: this.aoSamples, AO_TURNS: `${T.aoTurns}.0` },
        ),
        blur: pass(AO_BLUR_FRAGMENT, { ...common(), uAo: { value: null }, uStep: { value: new THREE.Vector2() } }),
        apply: pass(AO_APPLY_FRAGMENT, {
          ...common(),
          uColor: { value: this.sceneTarget.texture },
          uAo: { value: null },
          uStrength: { value: 0 },
          uEmit: { value: new THREE.Vector2() },
          uExposure: { value: 1 },
          uShow: { value: false },
        }),
      };
    }

    const finalDefines = {};
    if (this.fxaa) finalDefines.SPLIT = 1;
    if (this.blurInline) Object.assign(finalDefines, motionDefines, { INLINE_BLUR: 1 });
    if (this.lens) finalDefines.LENS = 1;
    this._final = pass(
      FINAL_FRAGMENT,
      {
        ...source({ value: null }),
        ...(this.blurInline ? this._motion : {}),
        uBloom: { value: null },
        uBloomTexels: { value: new THREE.Vector4() },
        uOrigin: { value: new THREE.Vector2() },
        uExact: { value: true },
        uExposure: { value: 1 },
        uBloomMix: { value: 0 },
        uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uLift: { value: new THREE.Vector3() },
        uSplitLo: { value: new THREE.Vector3(1, 1, 1) },
        uSplitHi: { value: new THREE.Vector3(1, 1, 1) },
        uSplitBalance: { value: 0 },
        uGhostTex: { value: null },
        uGhosts: { value: new THREE.Vector3() },
        uStarTex: { value: null },
        uStarTexels: { value: new THREE.Vector4() },
        uStar: { value: 0 },
        uGrain: this._grain,
      },
      finalDefines,
    );

    this._gradeTarget = null;
    this._finish = null;
    if (this.fxaa) {
      // The graded picture. Always 8-bit: it is already tone-mapped, sRGB-encoded and dithered.
      this._gradeTarget = keep(
        new THREE.WebGLRenderTarget(4, 4, {
          type: THREE.UnsignedByteType,
          format: THREE.RGBAFormat,
          colorSpace: THREE.NoColorSpace,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          generateMipmaps: false,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
      this._finish = pass(
        FINISH_FRAGMENT,
        {
          uTex: { value: this._gradeTarget.texture },
          uTexels: this._texels,
          uView: this._viewSize,
          uFxaa: { value: new THREE.Vector2(FXAA.subpixel, FXAA.threshold) },
          uGrain: this._grain,
        },
        { FXAA_STEPS: FXAA.steps },
      );
    }

    this._present = pass(
      PRESENT_FRAGMENT,
      {
        ...source({ value: null }),
        ...this._motion,
        uMode: { value: 0 },
        uBloom: { value: null },
        uBloomTexels: { value: new THREE.Vector4() },
        uProbe: { value: null },
        uOrigin: { value: new THREE.Vector2() },
        uExact: { value: true },
        uExposure: { value: 1 },
      },
      motionDefines,
    );
    this._motion.uDepth.value = this.sceneTarget.depthTexture;
  }

  /**
   * One set of targets serves every view. It is as large as the largest view of this frame and the last, so
   * that two halves of a split screen that differ by a pixel do not reallocate it twice a frame; a size that is
   * no longer needed is given up a frame later.
   */
  _allocate(w, h) {
    const now = this._sizeNow;
    const before = this._sizeBefore;
    if (this.engine.frame !== this._frame) {
      this._frame = this.engine.frame;
      before.w = now.w;
      before.h = now.h;
      now.w = now.h = 0;
      this._passes = 0;
    }
    now.w = Math.max(now.w, w);
    now.h = Math.max(now.h, h);
    let tw = Math.max(now.w, before.w);
    let th = Math.max(now.h, before.h);
    resizeTarget(this.sceneTarget, tw, th);
    if (this._blurTarget) resizeTarget(this._blurTarget, tw, th);
    if (this._gradeTarget) resizeTarget(this._gradeTarget, tw, th);
    if (this._ao) {
      resizeTarget(this._ao.picture, tw, th);
      resizeTarget(this._ao.a, Math.ceil(tw / 2), Math.ceil(th / 2));
      resizeTarget(this._ao.b, Math.ceil(tw / 2), Math.ceil(th / 2));
    }
    for (let i = 0; i < this.levels; i++) {
      tw = Math.ceil(tw / 2);
      th = Math.ceil(th / 2);
      resizeTarget(this._down[i], tw, th);
      if (i === 1 && this._starTarget) resizeTarget(this._starTarget, tw, th);
      if (i < this.levels - 1) resizeTarget(this._up[i], tw, th);
    }
  }

  /**
   * Compare this frame of the view with its last and set the blur's uniforms.
   * @returns {number} the shutter as a multiple of what moved between the two frames (0: nothing to blur with)
   */
  _remember(view, camera, rect, w) {
    let memory = view._pipe;
    if (!memory) {
      memory = view._pipe = {
        time: NaN,
        ratio: 0,
        width: 0,
        height: 0,
        viewProj: new THREE.Matrix4(),
        prevViewProj: new THREE.Matrix4(),
        boxes: Array.from({ length: 4 }, () => ({
          matrix: new THREE.Matrix4(),
          prevMatrix: new THREE.Matrix4(),
          center: new THREE.Vector3(),
          half: new THREE.Vector3(),
        })),
        count: 0,
      };
    }
    const time = this.engine.renderTime;
    const dt = time - memory.time; // NaN on the view's first frame
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const sameMoment = dt === 0;
    const resized = memory.width !== rect.w || memory.height !== rect.h;
    const restart = view.cut || resized || !(dt >= 0 && dt <= BLUR.maxGap) || (sameMoment && !sameMatrix(viewProj, memory.viewProj));

    if (restart || !sameMoment) {
      // nothing to compare with (restart): this frame is sharp, and the next one starts from it
      memory.ratio = restart ? 0 : Math.min(BLUR.maxRatio, SHUTTER_FRAME / dt);
      if (restart) memory.prevViewProj.copy(viewProj);
      else memory.prevViewProj.copy(memory.viewProj);
      memory.viewProj.copy(viewProj);
      const sharp = view.sharp || [];
      memory.count = Math.min(4, sharp.length);
      for (let i = 0; i < memory.count; i++) {
        const box = memory.boxes[i];
        box.matrix.copy(sharp[i].matrix);
        box.prevMatrix.copy(restart ? sharp[i].matrix : sharp[i].prevMatrix);
        box.center.copy(sharp[i].center);
        box.half.copy(sharp[i].half);
      }
    }
    // (the same moment drawn again, after a resize of the page or a changed setting, is blurred as it was: the
    // matrices are the remembered ones, whatever the game has since done with its own)
    memory.time = time;
    memory.width = rect.w;
    memory.height = rect.h;

    const shutter = (this.shutter ?? view.motionBlur ?? 0) * memory.ratio;
    const u = this._motion;
    u.uBlur.value.set(shutter, this.blurLength * w);
    const p = camera.projectionMatrix.elements;
    u.uDistance.value.set(p[15], -p[14], p[11], -p[10]);
    // The products are made here, in double precision: a camera that has not moved gives exactly no movement,
    // which the same sums in a shader's 32-bit floats would not.
    inverse.copy(memory.viewProj).invert();
    u.uReproject.value[0].multiplyMatrices(memory.prevViewProj, inverse);
    u.uBoxes.value = memory.count;
    for (let i = 0; i < memory.count; i++) {
      const box = memory.boxes[i];
      // clip -> world -> the box's own space
      scratch.copy(box.matrix).invert().multiply(inverse);
      u.uReproject.value[i + 1].multiplyMatrices(memory.prevViewProj, box.prevMatrix).multiply(scratch);
      boxNormal(u.uToBox.value[i], box.center, box.half).multiply(scratch);
    }
    return shutter;
  }

  /**
   * How much of the glow each pyramid level carries, for a view whose focal length is `focal` scene pixels.
   * The two lobes of BLOOM are shared out among the levels by where each level's blur lies on the scale of
   * sizes; the first and the last level take what lies beyond them, so the weights always add up to 1.
   */
  _shares(count, focal, halo) {
    const weights = this._weights;
    weights.length = count;
    const lobes = LOBES;
    lobes[0].share = BLOOM.core.share;
    lobes[1].share = BLOOM.veil.share;
    lobes[2].share = Math.max(0, halo);
    const total = lobes[0].share + lobes[1].share + lobes[2].share;
    for (let i = 0; i < count; i++) {
      const size = Math.log2((BLOOM.sigma * 2 ** i) / focal);
      let weight = 0;
      for (const lobe of lobes) {
        if (lobe.share === 0) continue;
        const u = size - Math.log2(lobe.size);
        const above = i === count - 1 ? 1 : lobeBelow(u + 0.5, lobe.spread);
        const below = i === 0 ? 0 : lobeBelow(u - 0.5, lobe.spread);
        weight += lobe.share * (above - below);
      }
      weights[i] = weight / total;
    }
    return weights;
  }

  /**
   * The bloom pyramid of the picture in `source`.
   * @returns {THREE.WebGLRenderTarget} the finished glow, half the picture's size
   */
  _bloom(source, w, h, exposure, focal, halo) {
    const { renderer, _down: down, _up: up } = this;
    // no level smaller than a pixel or two
    const count = Math.max(1, Math.min(this.levels, Math.floor(Math.log2(Math.min(w, h)))));
    const sizes = this._levels;
    sizes.length = count;
    let lw = w;
    let lh = h;
    let from = source;
    for (let i = 0; i < count; i++) {
      const pass = i === 0 ? this._karis : this._halve;
      const u = pass.material.uniforms;
      u.uTex.value = from.texture;
      u.uTexels.value.set(1 / from.width, 1 / from.height, lw - 0.5, lh - 0.5);
      if (i === 0) u.uKnee.value = BLOOM.knee / Math.max(exposure, 1e-6);
      lw = Math.ceil(lw / 2);
      lh = Math.ceil(lh / 2);
      sizes[i] = sizes[i] || { x: 0, y: 0, w: 0, h: 0 };
      sizes[i].w = lw;
      sizes[i].h = lh;
      pass.render(renderer, down[i], sizes[i]);
      from = down[i];
      this._passes++;
    }
    if (count === 1) return down[0];

    const weights = this._shares(count, focal, halo);
    const u = this._enlarge.material.uniforms;
    for (let i = count - 2; i >= 0; i--) {
      const deepest = i === count - 2;
      const small = deepest ? down[count - 1] : up[i + 1];
      u.uSmall.value = small.texture;
      u.uBase.value = down[i].texture;
      u.uSmallTexels.value.set(1 / small.width, 1 / small.height, sizes[i + 1].w - 0.5, sizes[i + 1].h - 0.5);
      // the smallest level has not been weighted by anyone yet
      u.uWeights.value.set(deepest ? weights[count - 1] : 1, weights[i]);
      this._enlarge.render(renderer, up[i], sizes[i]);
      this._passes++;
    }
    return up[0];
  }

  /** The view's Look with the overrides on top (the view's own object when there are none). */
  _lookOf(look) {
    const o = this.overrides;
    let any = false;
    for (const key in o) {
      any = true;
      break;
    }
    if (!any) return look;
    const merged = this._look;
    for (const key in merged) delete merged[key];
    return Object.assign(merged, look, o);
  }

  /**
   * Ambient occlusion: the term at half size, blurred along x and along y, then multiplied into the picture at
   * full size (or written alone, for ?debug=ao).
   * @returns {THREE.WebGLRenderTarget} the picture with the occlusion in it
   */
  _occlude(camera, w, h, strength, exposure, show) {
    const { renderer } = this;
    const ao = this._ao;
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    const half = HALF_RECT.set(0, 0, hw, hh);
    this._aoHalf.value.set(hw - 1, hh - 1);
    const pe = camera.projectionMatrix.elements;
    const focal = 0.5 * hh * pe[5];
    const t = ao.term.material.uniforms;
    t.uProj.value.set(pe[0], pe[5], pe[8], pe[9]);
    t.uAoSize.value.set(AO.radius, AO.radius * AO.radius, focal, AO.maxScreen * hh);
    ao.term.render(renderer, ao.a, half);
    const b = ao.blur.material.uniforms;
    b.uAo.value = ao.a.texture;
    b.uStep.value.set(1, 0);
    ao.blur.render(renderer, ao.b, half);
    b.uAo.value = ao.b.texture;
    b.uStep.value.set(0, 1);
    ao.blur.render(renderer, ao.a, half);
    const a = ao.apply.material.uniforms;
    a.uAo.value = ao.a.texture;
    a.uStrength.value = strength;
    a.uEmit.value.set(AO.emit[0], AO.emit[1]);
    a.uExposure.value = exposure;
    a.uShow.value = show;
    ao.apply.render(renderer, ao.picture, RECT.set(0, 0, w, h));
    this._passes += 4;
    return ao.picture;
  }

  /**
   * Draw one view.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{ x: number, y: number, w: number, h: number }} rect device pixels of the canvas, GL origin (bottom-left)
   * @param {ViewFrame} view
   */
  render(scene, camera, rect, view) {
    const { renderer, engine, sceneTarget } = this;
    const look = this._lookOf(view.look);
    const exposure = view.exposure * 2 ** this.ev;
    const debug = this.post ? DEBUG_MODES[this.debug] : DEBUG_MODES.scene;
    const w = Math.max(2, Math.round(rect.w * engine.renderScale));
    const h = Math.max(2, Math.round(rect.h * engine.renderScale));
    this._allocate(w, h);
    const exact = w === rect.w && h === rect.h;

    // ---- the scene, in one call
    sceneTarget.viewport.set(0, 0, w, h);
    sceneTarget.scissor.set(0, 0, w, h);
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    this._texels.value.set(1 / sceneTarget.width, 1 / sceneTarget.height, w - 0.5, h - 0.5);
    this._viewSize.value.set(w, h);
    const region = RECT.set(0, 0, w, h);
    const shutter = this._remember(view, camera, rect, w);

    // ---- ambient occlusion, multiplied into the picture: everything after reads it in place of the scene
    let picture = sceneTarget;
    const aoShown = debug === DEBUG_MODES.ao;
    // (the debug view shows the term at full strength when the Look has none)
    const occlusion = this._ao ? Math.max(0, look.ao || (aoShown ? 1 : 0)) : 0;
    if (occlusion > 0 && this.post && camera.isPerspectiveCamera && (debug === undefined || aoShown)) {
      picture = this._occlude(camera, w, h, occlusion, exposure, aoShown);
    }

    // ---- motion blur
    if (this._blur && this.post && shutter > 0 && debug !== DEBUG_MODES.scene && !aoShown) {
      this._blur.material.uniforms.uColor.value = picture.texture;
      this._blur.render(renderer, this._blurTarget, region);
      picture = this._blurTarget;
      this._passes++;
    }

    // ---- bloom
    // The focal length in scene pixels: what turns an angle into a distance on the picture. (An orthographic
    // camera has none; the view's height stands in.)
    const p11 = camera.projectionMatrix.elements[5];
    const focal = camera.isPerspectiveCamera ? 0.5 * h * p11 : h;
    const ghosts = this.lens ? look.ghosts || 0 : 0;
    const glare = this.lens ? look.glare || 0 : 0;
    const flaring = ghosts > 0 || glare > 0;
    const star = this._star ? Math.max(0, look.star || 0) : 0;
    const glowing =
      this.post && debug !== DEBUG_MODES.scene && ((look.bloom || 0) > 0 || flaring || star > 0 || debug === DEBUG_MODES.bloom);
    const glow = glowing && !aoShown ? this._bloom(picture, w, h, exposure, focal, look.halo || 0) : null;
    const half = this._levels[0];

    // ---- one buffer as it is
    if (debug !== undefined) {
      const u = this._present.material.uniforms;
      u.uMode.value = debug;
      // (?debug=ao: the term was written in place of the picture)
      u.uColor.value = aoShown && picture !== sceneTarget ? picture.texture : sceneTarget.texture;
      u.uBloom.value = glow ? glow.texture : null;
      if (glow) u.uBloomTexels.value.set(1 / glow.width, 1 / glow.height, half.w - 0.5, half.h - 0.5);
      u.uProbe.value = view.probe || null;
      u.uOrigin.value.set(rect.x, rect.y);
      u.uExact.value = exact;
      u.uExposure.value = aoShown && picture === sceneTarget ? 0 : exposure;
      this._present.render(renderer, null, rect);
      this._passes++;
      return;
    }

    // ---- the finished picture
    const u = this._final.material.uniforms;
    u.uColor.value = picture.texture;
    u.uBloom.value = glow ? glow.texture : null;
    if (glow) u.uBloomTexels.value.set(1 / glow.width, 1 / glow.height, half.w - 0.5, half.h - 0.5);
    u.uBloomMix.value = glow ? look.bloom || 0 : 0;
    u.uExposure.value = exposure;
    u.uGrade.value.set(look.contrast ?? 1, look.saturation ?? 1, look.vignette || 0, this.lens ? look.chroma || 0 : 0);
    u.uTint.value.fromArray(look.tint || ONES);
    u.uLift.value.fromArray(look.lift || ZEROS);
    const lo = look.splitShadows || ONES;
    const hi = look.splitHighlights || ONES;
    const toned = lo[0] !== lo[1] || lo[1] !== lo[2] || hi[0] !== hi[1] || hi[1] !== hi[2];
    keepBrightness(u.uSplitLo.value, lo);
    keepBrightness(u.uSplitHi.value, hi);
    u.uSplitBalance.value = toned ? Math.min(0.95, Math.max(0.05, look.splitBalance ?? 0.5)) : 0;
    if (flaring && glow) {
      // LOOK LANE: the flare source from the first level no more than 48 texels wide (or the smallest there is):
      // only what is some thirty times brighter than white counts
      let level = 0;
      while (level < this._levels.length - 1 && this._levels[level].w > 48) level++;
      const fu = this._flare.material.uniforms;
      fu.uTex.value = this._down[level].texture;
      fu.uSize.value.set(Math.min(64, this._levels[level].w), Math.min(64, this._levels[level].h));
      fu.uFloor.value = 30 / Math.max(exposure, 1e-6);
      fu.uSun.value.set(0, 0, 0, 0);
      const fl = look.flare;
      if (fl && fl.dir) {
        // where the light stands on the view, from a point far along its direction (behind the lens: nothing)
        _flareP.fromArray(fl.dir).normalize().transformDirection(camera.matrixWorldInverse);
        if (_flareP.z < -0.05) {
          _flareP.applyMatrix4(camera.projectionMatrix);
          const ux = 0.5 + 0.5 * _flareP.x;
          const uy = 0.5 + 0.5 * _flareP.y;
          // how far outside the frame, in heights of the view: the flare fades out over `fl.reach` of them
          const out = Math.max(0, -ux, ux - 1) * (w / h) + Math.max(0, -uy, uy - 1);
          const fade = 1 - Math.min(1, out / (fl.reach || 0.2));
          fu.uSun.value.set(ux, uy, fl.light || 0, fade);
          fu.uSunSky.value = fl.sky || 1;
        }
      }
      this._flare.render(renderer, this._flareTarget, FLARE_RECT);
      this._passes++;
      u.uGhostTex.value = this._flareTarget.texture;
      u.uGhosts.value.set(ghosts, glare, w / h);
    } else {
      u.uGhosts.value.set(0, 0, 1);
    }
    u.uStar.value = 0;
    if (star > 0 && glow && this._levels.length >= 2) {
      const level = this._levels[1];
      const su = this._star.material.uniforms;
      su.uTex.value = this._down[1].texture;
      su.uTexels.value.set(1 / this._down[1].width, 1 / this._down[1].height, level.w - 0.5, level.h - 0.5);
      su.uFloor.value = STAR.floor / Math.max(exposure, 1e-6);
      su.uArm.value.set(Math.sin(STAR.turn), Math.cos(STAR.turn), (STAR.length * focal) / 4);
      this._star.render(renderer, this._starTarget, level);
      this._passes++;
      u.uStarTex.value = this._starTarget.texture;
      u.uStarTexels.value.set(1 / this._starTarget.width, 1 / this._starTarget.height, level.w - 0.5, level.h - 0.5);
      u.uStar.value = star;
    }
    // Grain changes with the run's own time (in steps of a 240th of a second), so the same moment has the same
    // grain, and its cells keep their size on a dense screen.
    this._grain.value.set((look.grain || 0) / 255, Math.max(1, Math.floor(renderer.getPixelRatio() + 0.25)), Math.round(engine.renderTime * 240) % 65536);

    if (this._finish) {
      u.uOrigin.value.set(0, 0);
      u.uExact.value = true;
      this._final.render(renderer, this._gradeTarget, region);
      this._finish.render(renderer, null, rect);
      this._passes += 2;
    } else {
      u.uOrigin.value.set(rect.x, rect.y);
      u.uExact.value = exact;
      this._final.render(renderer, null, rect);
      this._passes++;
    }
  }

  /**
   * What the pipeline is made of and what the last frame used.
   * @returns {{ tier: string, hdr: boolean, samples: number, fxaa: boolean, blurTaps: number, blurInline: boolean,
   *   bloomLevels: number, aoSamples: number, renderScale: number, passes: number, targets: Record<string, number[]|number[][]> }}
   *   `passes`: full-screen passes of the frame drawn last, over all its views (the scene itself not counted)
   */
  stats() {
    const size = (target) => [target.width, target.height];
    const targets = { scene: size(this.sceneTarget), bloom: this._down.map(size) };
    if (this._blurTarget) targets.blur = size(this._blurTarget);
    if (this._gradeTarget) targets.grade = size(this._gradeTarget);
    if (this._starTarget) targets.star = size(this._starTarget);
    if (this._ao) {
      targets.ao = size(this._ao.a);
      targets.aoPicture = size(this._ao.picture);
    }
    return {
      tier: this.tier,
      hdr: this.caps.hdr,
      samples: this.samples,
      fxaa: this.fxaa,
      blurTaps: this.blurTaps,
      blurInline: this.blurInline,
      bloomLevels: this.levels,
      aoSamples: this.aoSamples,
      renderScale: this.engine.renderScale,
      passes: this._passes,
      targets,
    };
  }

  _release() {
    for (const target of this._targets) target.dispose();
    for (const material of this._materials) material.dispose();
    this._targets.length = 0;
    this._materials.length = 0;
  }

  dispose() {
    this._release();
  }
}

const ONES = [1, 1, 1];
const LOBES = [
  { size: BLOOM.core.size, spread: BLOOM.core.spread, share: 0 },
  { size: BLOOM.veil.size, spread: BLOOM.veil.spread, share: 0 },
  { size: BLOOM.halo.size, spread: BLOOM.halo.spread, share: 0 },
];

/** A split-toning colour as multipliers that leave brightness alone. */
function keepBrightness(out, rgb) {
  const l = Math.max(1e-4, 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
  return out.set(rgb[0] / l, rgb[1] / l, rgb[2] / l);
}
const FLARE_RECT = { x: 0, y: 0, w: 1, h: 1 };
const _flareP = new THREE.Vector3();
const ZEROS = [0, 0, 0];
function makeRect() {
  return {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    set(x, y, w, h) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
      return this;
    },
  };
}
const RECT = makeRect();
const HALF_RECT = makeRect();
