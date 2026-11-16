// From the finished scene (linear light, as bright as it likes) to the pixels
// on the screen.
//
//   scene target  ->  bloom pyramid  ->  final pass  ->  canvas
//
// Bloom: the scene is shrunk by half again and again (each step a wide,
// smooth 13-tap filter), then the levels are added back up from the smallest
// to the largest with a small tent blur at each step. The small levels are a
// tight glow hugging bright edges; the deep ones are a wide soft veil, the
// "mist" a lens shows round a strong backlight. Each level has its own weight
// and tint, so the two can be balanced, and the veil can be warm.
//
// Grade pass: exposure, a film-like tone curve, colour grade, vignette, the
// sRGB curve and dither, into an 8-bit picture the size of the scene. The
// renderer's own tone mapping and colour conversion are switched off
// (Engine.js); this is the only place they happen.
//
// Finish pass: edge smoothing (FXAA) and film grain, onto the canvas. The
// smoothing is done here, on the finished picture, because that is where a
// jagged edge is judged: multisampling averages light, and one sample of a
// rim a hundred times brighter than the dark behind it still tone-maps to
// white, so the swan's bright outline keeps its staircase however many
// samples there are. Grain comes last so that it is not mistaken for edges.

import * as THREE from 'three';
import { createTarget, resizeTarget } from './caps.js';
import { createPassMaterial } from './material.js';
import { FullscreenPass } from './FullscreenPass.js';

const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel; // one texel of uTex
#ifdef PREFILTER
uniform vec3 uThreshold; // threshold, knee, firefly damping
#endif
vec3 tap(float x, float y) { return fromTarget(texture(uTex, vUv + vec2(x, y) * uTexel)).rgb; }
void main() {
  // 13 taps: an inner box of four and an outer ring of nine. Taken together
  // they are five overlapping 2x2 boxes, which keeps small bright things from
  // flickering as they move across the pixel grid.
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
#ifdef PREFILTER
  // First step only. Each box is weighted down by its own brightness, so one
  // extremely bright pixel cannot light up a whole blob that flashes on and
  // off ("fireflies"); uThreshold.z says how strongly.
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 / (1.0 + luma(g0) * uThreshold.z);
  float w1 = 0.125 / (1.0 + luma(g1) * uThreshold.z);
  float w2 = 0.125 / (1.0 + luma(g2) * uThreshold.z);
  float w3 = 0.125 / (1.0 + luma(g3) * uThreshold.z);
  float w4 = 0.125 / (1.0 + luma(g4) * uThreshold.z);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  // Only what is brighter than the threshold blooms, with a soft knee so that
  // there is no hard edge where the glow starts.
  float bright = max(col.r, max(col.g, col.b));
  float soft = clamp(bright - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y);
  soft = soft * soft / (4.0 * uThreshold.y + 1.0e-4);
  col *= max(soft, bright - uThreshold.x) / max(bright, 1.0e-4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  outColor = toTarget(vec4(col, 1.0));
}
`;

const UP_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;   // the sum of all the smaller levels so far
uniform sampler2D uBase;  // this level's own picture
uniform vec2 uTexel;      // one texel of uTex, times the blur radius
uniform vec3 uTexWeight;
uniform vec3 uBaseWeight;
vec3 tap(float x, float y) { return fromTarget(texture(uTex, vUv + vec2(x, y) * uTexel)).rgb; }
void main() {
  // 3x3 tent
  vec3 sum = tap(0.0, 0.0) * 4.0
    + (tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)) * 2.0
    + tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
  vec3 col = sum * (1.0 / 16.0) * uTexWeight + fromTarget(texture(uBase, vUv)).rgb * uBaseWeight;
  outColor = toTarget(vec4(col, 1.0));
}
`;

const GRADE_FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform vec3 uCurve;       // toe, shoulder, contrast
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform vec3 uLift;
uniform float uSplitBalance;
uniform float uSaturation;
uniform vec2 uVignette;    // amount, where it starts (0 centre .. 1 corner)
uniform float uChroma;

vec3 sceneAt(vec2 uv) {
  return fromTarget(texture(uScene, uv)).rgb + fromTarget(texture(uBloom, uv)).rgb * uBloomStrength;
}

// The tone curve, per channel (so very bright colours wash toward white, as on film).
//   toe:      x^2 / (x + toe) pulls the darkest values down toward black and
//             leaves everything well above "toe" alone
//   contrast: a power around middle grey
//   shoulder: x / (1 + x^s)^(1/s) approaches 1 without ever clipping; s = 1 is
//             the gentlest roll-off, larger s holds brightness longer and then
//             bends harder
vec3 toneCurve(vec3 x) {
  x = max(x, 0.0);
  x = x * x / (x + uCurve.x + 1.0e-6);
  x = 0.18 * pow(x / 0.18, vec3(uCurve.z));
  return x / pow(1.0 + pow(x, vec3(uCurve.y)), vec3(1.0 / uCurve.y));
}

void main() {
  vec3 c;
  if (uChroma > 0.0) {
    // lateral chromatic aberration: red and blue are magnified slightly differently
    vec2 d = (vUv - 0.5) * uChroma;
    c = vec3(sceneAt(vUv + d).r, sceneAt(vUv).g, sceneAt(vUv - d).b);
  } else {
    c = sceneAt(vUv);
  }
  c *= uExposure;

  // Vignette, before the curve, so that it darkens like less light would.
  vec2 q = vUv - 0.5;
  float corner = dot(q, q) * 2.0; // 0 at the centre, 1 in the corners, on any aspect
  c *= 1.0 - uVignette.x * smoothstep(uVignette.y, 1.0, sqrt(corner));

  c = toneCurve(c);

  // Split toning: the darks lean one way, the lights the other. "Lift" is a
  // colour added in the deepest shadows, so black itself has a tint.
  float l = luma(c);
  float hi = smoothstep(0.0, 1.0, l / max(uSplitBalance * 2.0, 1.0e-3));
  c *= mix(uShadowTint, uHighlightTint, hi);
  c = saturateColor(c, uSaturation);
  c += uLift * (1.0 - hi) * (1.0 - hi);

  vec3 s = linearToSrgb(c);

  // Dither: noise of one 8-bit step, triangular so that it adds no visible
  // pattern of its own. Without it the long dark gradients show as bands.
  // (Fixed, not animated: the grain of the next pass does the moving.)
  vec3 t = hash33(vec3(gl_FragCoord.xy, 5.0)) + hash33(vec3(gl_FragCoord.xy, 977.0)) - 1.0;
  s += t / 255.0;
  // brightness goes along in alpha: the edge smoothing reads it nine or more times a pixel
  outColor = vec4(s, dot(s, vec3(0.299, 0.587, 0.114)));
}
`;

const FINISH_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;  // the graded picture (sRGB values), brightness in alpha
uniform vec2 uTexel;     // one texel of uTex
uniform vec2 uFxaa;      // how much single odd pixels are softened, contrast below which nothing is done
uniform vec3 uGrain;     // amount, cell size in canvas pixels, frame number

#if FXAA_STEPS > 0
// FXAA (Timothy Lottes' method): find pixels on a contrast edge, work out
// which way the edge runs, walk along it both ways to find where its
// staircase step begins and ends, and shift the lookup across the edge by
// how far along the step this pixel is. The shifted lookup blends the two
// sides in just the proportion a properly antialiased edge would have.
float lumAt(vec2 uv) { return texture(uTex, uv).a; }
vec3 smoothEdges(vec2 uv) {
  vec4 middle = texture(uTex, uv);
  float lM = middle.a;
  float lN = lumAt(uv + vec2(0.0, uTexel.y));
  float lS = lumAt(uv - vec2(0.0, uTexel.y));
  float lE = lumAt(uv + vec2(uTexel.x, 0.0));
  float lW = lumAt(uv - vec2(uTexel.x, 0.0));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.03, lMax * uFxaa.y)) return middle.rgb;

  float lNE = lumAt(uv + uTexel);
  float lSW = lumAt(uv - uTexel);
  float lNW = lumAt(uv + vec2(-uTexel.x, uTexel.y));
  float lSE = lumAt(uv + vec2(uTexel.x, -uTexel.y));
  float horizontal = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  float vertical = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  bool isHorizontal = horizontal >= vertical;

  // the two neighbours across the edge; the edge lies toward the one that differs more
  float l1 = isHorizontal ? lS : lW;
  float l2 = isHorizontal ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  float across = isHorizontal ? uTexel.y : uTexel.x;
  float edgeLum;
  if (g1 >= g2) { across = -across; edgeLum = 0.5 * (l1 + lM); } else { edgeLum = 0.5 * (l2 + lM); }
  float enough = 0.25 * max(g1, g2);

  // walk along the edge, half a texel toward it, until the brightness leaves the edge's own
  vec2 along = isHorizontal ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 start = uv + (isHorizontal ? vec2(0.0, across * 0.5) : vec2(across * 0.5, 0.0));
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
  float d1 = isHorizontal ? uv.x - p1.x : uv.y - p1.y;
  float d2 = isHorizontal ? p2.x - uv.x : p2.y - uv.y;
  float nearEnd = d1 < d2 ? e1 : e2;
  // only shift if the nearer end of the step really turns the way this pixel's side would predict
  float shift = ((nearEnd < 0.0) != (lM < edgeLum)) ? 0.5 - min(d1, d2) / (d1 + d2) : 0.0;

  // a pixel that simply differs from all its neighbours (a speck, a spark) is softened a little
  float average = (2.0 * (lN + lS + lE + lW) + lNE + lNW + lSE + lSW) / 12.0;
  float odd = clamp(abs(average - lM) / range, 0.0, 1.0);
  odd = odd * odd * (3.0 - 2.0 * odd);
  shift = max(shift, odd * odd * uFxaa.x);

  return texture(uTex, uv + (isHorizontal ? vec2(0.0, shift * across) : vec2(shift * across, 0.0))).rgb;
}
#endif

void main() {
#if FXAA_STEPS > 0
  vec3 s = smoothEdges(vUv);
#else
  vec3 s = texture(uTex, vUv).rgb;
#endif
  // Film grain: changes 24 times a second, strongest in the mid-darks, absent in pure black.
  vec2 cell = floor(gl_FragCoord.xy / uGrain.y);
  float n = hash13(vec3(cell, uGrain.z)) + hash13(vec3(cell + 71.0, uGrain.z)) - 1.0;
  float ls = luma(s);
  s += n * uGrain.x * smoothstep(0.0, 0.12, ls) * (1.0 - 0.55 * ls);
  outColor = vec4(s, 1.0);
}
`;

// Shows a buffer as it is: no bloom, no grade. Used by ?nopost and by the debug views.
const PRESENT_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform float uExposure;
uniform float uShowAlpha;
void main() {
  vec4 t = fromTarget(texture(uTex, vUv));
  vec3 c = t.rgb * uExposure;
  if (uShowAlpha > 0.0) {
    // where nothing was drawn (alpha 0) show a dim checker instead of black
    vec2 k = floor(gl_FragCoord.xy / 24.0);
    float checker = mod(k.x + k.y, 2.0);
    c += vec3(0.02, 0.0, 0.03) * (0.5 + checker) * (1.0 - t.a);
  }
  // a plain soft clip so that values above 1 still show some shape
  c = c / (1.0 + max(c - 0.6, 0.0));
  vec3 d = hash33(vec3(gl_FragCoord.xy, 3.0)) + hash33(vec3(gl_FragCoord.xy, 11.0)) - 1.0;
  outColor = vec4(linearToSrgb(c) + d / 255.0, 1.0);
}
`;

/**
 * How much each bloom level contributes, and its tint.
 * `tight` goes to the three largest levels, `wide` to the rest, growing toward the deepest.
 */
function levelWeights(count, tight, wide, tint) {
  const tightShape = [0.5, 0.33, 0.17];
  const deep = Math.max(1, count - 2);
  const wideTotal = (deep * (deep + 1)) / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i < 3 ? tightShape[i] * tight : 0;
    const w = i >= 2 ? ((i - 1) / wideTotal) * wide : 0;
    out.push(new THREE.Vector3(t + w * tint[0], t + w * tint[1], t + w * tint[2]));
  }
  return out;
}

export class PostChain {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./caps.js').Caps} caps
   * @param {{ samples?: number, bloomLevels?: number, fxaaSteps?: number }} [options]
   *   `fxaaSteps`: how far the edge smoothing searches along an edge (0 switches it off)
   */
  constructor(renderer, caps, { samples = 0, bloomLevels = 6, fxaaSteps = 6 } = {}) {
    this.renderer = renderer;
    this.caps = caps;
    this.levels = bloomLevels;

    /** Draw the scene into this: linear light, depth, multisampled where the tier allows. */
    this.sceneTarget = createTarget(caps, { depth: true, samples });
    this.down = Array.from({ length: bloomLevels }, () => createTarget(caps));
    this.up = Array.from({ length: bloomLevels - 1 }, () => createTarget(caps));
    /** The finished bloom (half the scene's resolution). */
    this.bloomTexture = this.up[0].texture;

    const downUniforms = () => ({ uTex: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.prefilterPass = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: DOWN_FRAGMENT,
        defines: { PREFILTER: 1 },
        uniforms: { ...downUniforms(), uThreshold: { value: new THREE.Vector3(1, 0.5, 0.15) } },
      }),
    );
    this.downPass = new FullscreenPass(createPassMaterial(caps, { fragmentShader: DOWN_FRAGMENT, uniforms: downUniforms() }));
    this.upPass = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: UP_FRAGMENT,
        uniforms: {
          uTex: { value: null },
          uBase: { value: null },
          uTexel: { value: new THREE.Vector2() },
          uTexWeight: { value: new THREE.Vector3(1, 1, 1) },
          uBaseWeight: { value: new THREE.Vector3(1, 1, 1) },
        },
      }),
    );
    // The graded picture. Always 8-bit: it is already tone-mapped, sRGB-encoded and dithered.
    this.gradeTarget = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.gradePass = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: GRADE_FRAGMENT,
        uniforms: {
          uScene: { value: this.sceneTarget.texture },
          uBloom: { value: this.bloomTexture },
          uBloomStrength: { value: 0.5 },
          uExposure: { value: 1 },
          uCurve: { value: new THREE.Vector3(0.02, 1.6, 1) },
          uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
          uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
          uLift: { value: new THREE.Vector3(0, 0, 0) },
          uSplitBalance: { value: 0.35 },
          uSaturation: { value: 1 },
          uVignette: { value: new THREE.Vector2(0.3, 0.3) },
          uChroma: { value: 0 },
        },
      }),
    );
    this.finishPass = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: FINISH_FRAGMENT,
        defines: { FXAA_STEPS: Math.max(0, Math.round(fxaaSteps)) },
        uniforms: {
          uTex: { value: this.gradeTarget.texture },
          uTexel: { value: new THREE.Vector2() },
          uFxaa: { value: new THREE.Vector2(0.35, 0.12) },
          uGrain: { value: new THREE.Vector3(0.03, 1.5, 0) },
        },
      }),
    );
    this.presentPass = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: PRESENT_FRAGMENT,
        uniforms: { uTex: { value: null }, uExposure: { value: 1 }, uShowAlpha: { value: 0 } },
      }),
    );

    /** Blur radius of the upsampling steps, in texels (1 is the plain tent). */
    this.bloomRadius = 1;
    this._weights = levelWeights(bloomLevels, 0.5, 0.5, [1, 1, 1]);
  }

  /**
   * Copy the look into the uniforms. Called every frame by the owner, so a
   * changed number shows on the next frame. See scene/config.js for meanings.
   * @param {object} look
   * @param {number} [pixelRatio] canvas pixels per CSS pixel, so the grain keeps its size on any screen
   */
  setLook(look, pixelRatio = 1) {
    const f = this.gradePass.material.uniforms;
    const g = this.finishPass.material.uniforms;
    f.uExposure.value = look.exposure;
    f.uCurve.value.set(look.toe, look.shoulder, look.contrast);
    f.uShadowTint.value.fromArray(look.shadowTint);
    f.uHighlightTint.value.fromArray(look.highlightTint);
    f.uLift.value.fromArray(look.lift);
    f.uSplitBalance.value = look.splitBalance;
    f.uSaturation.value = look.saturation;
    f.uVignette.value.set(look.vignette, look.vignetteStart);
    g.uGrain.value.x = look.grain;
    g.uGrain.value.y = Math.max(1, look.grainSize * pixelRatio);
    g.uFxaa.value.set(look.fxaaSubpixel, look.fxaaThreshold);
    f.uChroma.value = look.chroma;
    f.uBloomStrength.value = look.bloomStrength;
    this.prefilterPass.material.uniforms.uThreshold.value.set(look.bloomThreshold, Math.max(1e-3, look.bloomKnee), look.bloomFirefly);
    this.bloomRadius = look.bloomRadius;
    this._weights = levelWeights(this.levels, look.bloomTight, look.bloomWide, look.bloomTint);
    this.presentPass.material.uniforms.uExposure.value = look.exposure;
  }

  /** @param {number} width of the scene target in pixels @param {number} height */
  setSize(width, height) {
    resizeTarget(this.sceneTarget, width, height);
    resizeTarget(this.gradeTarget, width, height);
    this.finishPass.material.uniforms.uTexel.value.set(1 / this.gradeTarget.width, 1 / this.gradeTarget.height);
    let w = this.sceneTarget.width;
    let h = this.sceneTarget.height;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(2, Math.round(w / 2));
      h = Math.max(2, Math.round(h / 2));
      resizeTarget(this.down[i], w, h);
      if (i < this.levels - 1) resizeTarget(this.up[i], w, h);
    }
  }

  /** The bloom pyramid, from the scene target as it is now. */
  renderBloom() {
    const { renderer, down, up, levels } = this;
    let source = this.sceneTarget;
    for (let i = 0; i < levels; i++) {
      const pass = i === 0 ? this.prefilterPass : this.downPass;
      pass.material.uniforms.uTex.value = source.texture;
      pass.material.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      pass.render(renderer, down[i]);
      source = down[i];
    }
    // back up: level i = its own picture (weighted) + everything smaller, blurred once more
    const u = this.upPass.material.uniforms;
    const one = u.uTexWeight.value;
    for (let i = levels - 2; i >= 0; i--) {
      const deepest = i === levels - 2;
      const below = deepest ? down[levels - 1] : up[i + 1];
      u.uTex.value = below.texture;
      u.uBase.value = down[i].texture;
      u.uTexel.value.set(this.bloomRadius / below.width, this.bloomRadius / below.height);
      // the smallest level has not been weighted by anyone yet
      if (deepest) one.copy(this._weights[levels - 1]);
      else one.set(1, 1, 1);
      u.uBaseWeight.value.copy(this._weights[i]);
      this.upPass.render(renderer, up[i]);
    }
  }

  /**
   * Bloom, grade and put the scene target on the canvas.
   * @param {number} seconds real time, for the grain (it should not slow down with the water)
   */
  render(seconds) {
    this.renderBloom();
    this.gradePass.render(this.renderer, this.gradeTarget);
    // film runs at 24 frames a second, and so does its grain
    this.finishPass.material.uniforms.uGrain.value.z = Math.floor(seconds * 24);
    this.finishPass.render(this.renderer, null);
  }

  /**
   * Put any buffer of the pipeline on the canvas, ungraded.
   * @param {THREE.Texture} texture written with toTarget()
   * @param {{ alpha?: boolean }} [options] `alpha`: mark the transparent parts
   */
  present(texture, { alpha = false } = {}) {
    const u = this.presentPass.material.uniforms;
    u.uTex.value = texture;
    u.uShowAlpha.value = alpha ? 1 : 0;
    this.presentPass.render(this.renderer, null);
  }

  dispose() {
    this.sceneTarget.dispose();
    for (const t of this.down) t.dispose();
    for (const t of this.up) t.dispose();
    this.gradeTarget.dispose();
    for (const p of [this.prefilterPass, this.downPass, this.upPass, this.gradePass, this.finishPass, this.presentPass]) p.dispose();
  }
}
