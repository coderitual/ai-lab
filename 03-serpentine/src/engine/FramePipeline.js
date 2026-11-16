// From a scene and a camera to finished pixels in a rectangle of the canvas.
//
// FIRST VERSION (the shell's): the scene is drawn into one off-screen target
// and a single pass puts it on the canvas with exposure, the tone curve, a
// little grade, the sRGB curve and dither. Motion blur, bloom, grain and edge
// smoothing are not here yet; the interface is the final one, so the game
// does not change when they arrive.
//
// Two rules that hold for every version:
//  - The scene is ONE render call into the scene target. three.js resolves a
//    multisampled target after every render call and then throws its samples
//    away; a second call into it would draw over garbage.
//  - The targets hold linear light (half-float), or the 8-bit encoding of
//    glsl.js where a device has no float targets. Nothing in the scene knows
//    which; passes read with fromTarget() and write with toTarget().

import { TIERS, createTarget, resizeTarget } from './caps.js';
import { FullscreenPass, createPassMaterial } from './FullscreenPass.js';
import { installLdrEncoding } from './glsl.js';

/**
 * The grade of the finished picture: one per time of day, in lighting.js.
 * @typedef {object} Look
 * @property {number} toe tone curve: how hard the darkest values are pulled to black (0: not at all)
 * @property {number} shoulder tone curve: 1 is the gentlest roll-off of the brights, larger holds them longer
 * @property {number} contrast tone curve: a power around middle grey
 * @property {number} saturation 1 = as lit
 * @property {[number, number, number]} tint multiplies the picture after the curve
 * @property {number} vignette how much darker the corners are, 0..1
 * @property {number} grain film grain, in 8-bit steps (not drawn yet)
 * @property {number} bloom how much of the glow is added back (not drawn yet)
 */

/**
 * What the game tells the pipeline about one view, each frame.
 * @typedef {object} ViewFrame
 * @property {number} exposure linear multiplier, already eased by the game in the fixed step
 * @property {Look} look
 * @property {number} motionBlur 0..1 shutter fraction
 * @property {boolean} cut the camera jumped this frame: no blur from the last one
 * @property {Array<{ matrix: import('three').Matrix4, prevMatrix: import('three').Matrix4,
 *   center: import('three').Vector3, half: import('three').Vector3 }>} sharp up to 4 rigid boxes (cars) that are
 *   blurred by their own movement relative to the camera, not by the scenery's
 */

const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform vec4 uRegion;     // the part of uScene that holds this view: scale (xy) and the last texel centre inside it (zw)
uniform ivec2 uOrigin;    // the rectangle's corner on the canvas, in pixels
uniform bool uExact;      // the scene was drawn at the rectangle's own resolution
uniform float uExposure;
uniform vec3 uCurve;      // toe, shoulder, contrast
uniform float uSaturation;
uniform vec3 uTint;
uniform float uVignette;

void main() {
  // Pixel for pixel when the sizes match: a filtered lookup a hair off the texel's centre would let a lamp
  // thousands of times brighter than its neighbour leak into it.
  vec4 scene = uExact ? texelFetch(uScene, ivec2(gl_FragCoord.xy) - uOrigin, 0) : texture(uScene, min(vUv * uRegion.xy, uRegion.zw));
  vec3 c = fromTarget(scene).rgb * uExposure;

  // Vignette, before the curve, so that it darkens like less light would.
  vec2 q = vUv - 0.5;
  float corner = sqrt(dot(q, q) * 2.0); // 0 at the centre, 1 in the corners, on any aspect
  c *= 1.0 - uVignette * smoothstep(0.35, 1.0, corner);

  c = toneCurve(c, uCurve);
  c = saturateColor(c, uSaturation) * uTint;
  vec3 s = linearToSrgb(c);

  // Dither: noise of one 8-bit step, triangular so that it adds no visible
  // pattern of its own. Without it the sky's long gradients show as bands.
  vec3 t = hash33(vec3(gl_FragCoord.xy, 5.0)) + hash33(vec3(gl_FragCoord.xy, 977.0)) - 1.0;
  outColor = vec4(s + t / 255.0, 1.0);
}
`;

export class FramePipeline {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {import('./caps.js').Caps} caps
   * @param {{ tier: import('./caps.js').Tier, post?: boolean }} options `post: false` leaves the grade out
   *   (exposure, tone curve and sRGB only)
   */
  constructor(renderer, caps, { tier, post = true }) {
    this.renderer = renderer;
    this.caps = caps;
    this.post = post;
    /** Name of an intermediate buffer to show instead of the picture (none exist yet). */
    this.debug = null;
    /**
     * Fraction of the rectangle's resolution the scene is drawn at. The game copies the engine's renderScale
     * here; the last pass stretches the picture back.
     */
    this.scale = 1;

    // must happen before the first material is compiled
    if (!caps.hdr) installLdrEncoding();

    this._final = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: FINAL_FRAGMENT,
        uniforms: {
          uScene: { value: null },
          uRegion: { value: [1, 1, 1, 1] },
          uOrigin: { value: [0, 0] },
          uExact: { value: true },
          uExposure: { value: 1 },
          uCurve: { value: [0, 1, 1] },
          uSaturation: { value: 1 },
          uTint: { value: [1, 1, 1] },
          uVignette: { value: 0 },
        },
      }),
    );
    this._lastW = 0;
    this._lastH = 0;
    this.sceneTarget = null;
    this.setTier(tier);
  }

  /** @param {import('./caps.js').Tier} tier */
  setTier(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.sceneTarget) this.sceneTarget.dispose();
    this.sceneTarget = createTarget(this.caps, { depth: true, samples: TIERS[tier].msaa });
  }

  /**
   * Draw one view.
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   * @param {{ x: number, y: number, w: number, h: number }} rect device pixels of the canvas, GL origin (bottom-left)
   * @param {ViewFrame} view
   */
  render(scene, camera, rect, view) {
    const { renderer, sceneTarget } = this;
    const w = Math.max(2, Math.round(rect.w * this.scale));
    const h = Math.max(2, Math.round(rect.h * this.scale));
    // One set of targets serves every view. It is as large as the larger of this view and the one drawn before
    // it, so two views that differ by a pixel do not reallocate it twice a frame.
    resizeTarget(sceneTarget, Math.max(w, this._lastW), Math.max(h, this._lastH));
    this._lastW = w;
    this._lastH = h;

    sceneTarget.viewport.set(0, 0, w, h);
    sceneTarget.scissor.set(0, 0, w, h);
    sceneTarget.scissorTest = true;
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const look = view.look;
    const u = this._final.material.uniforms;
    u.uScene.value = sceneTarget.texture;
    const tw = sceneTarget.width;
    const th = sceneTarget.height;
    u.uRegion.value = [w / tw, h / th, (w - 0.5) / tw, (h - 0.5) / th];
    u.uOrigin.value = [rect.x, rect.y];
    u.uExact.value = w === rect.w && h === rect.h;
    u.uExposure.value = view.exposure;
    u.uCurve.value = [look.toe, look.shoulder, look.contrast];
    u.uSaturation.value = this.post ? look.saturation : 1;
    u.uTint.value = this.post ? look.tint : [1, 1, 1];
    u.uVignette.value = this.post ? look.vignette : 0;
    this._final.render(renderer, null, rect);
  }

  dispose() {
    this.sceneTarget.dispose();
    this._final.dispose();
  }
}
