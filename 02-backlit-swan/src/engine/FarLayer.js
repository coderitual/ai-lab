// The out-of-focus background.
//
// A long lens focused on something near throws everything far behind it out
// of focus by about the same amount. So the far things are kept in a scene of
// their own, drawn small, and blurred as a whole with a disc-shaped kernel:
// every bright point becomes a soft disc, like through a real aperture. The
// sharp subject is drawn over the result later and never takes part in the
// blur, so its bright rim cannot leak into the background.
//
// The blur is two passes. The first takes `taps` samples spread evenly over
// the disc (a sunflower pattern). Taken from the full-resolution picture, that
// few samples would turn a bright leaf into a ring of dots, and would miss
// small leaves altogether on some frames. So the sharp picture gets a mip
// chain, and each sample is read from the mip level whose texels are as large
// as the gap between samples: every sample then stands for its whole share of
// the disc, and nothing bright can fall between two of them. The second pass
// blurs once more with a small disc, about the size of that gap, to take the
// squareness of the mip texels away.

import * as THREE from 'three';
import { createTarget, resizeTarget } from './caps.js';
import { encodeForTarget } from './glsl.js';
import { createPassMaterial } from './material.js';
import { FullscreenPass } from './FullscreenPass.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** `count` points spread evenly over the unit disc, as a flat [x, y, x, y, ...] list. */
function discOffsets(count, rotation) {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * GOLDEN_ANGLE + rotation;
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
}

const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uOffsets[TAPS];
// radius of the disc in uv units, separately for x and y so it stays round on any aspect
uniform vec2 uRadius;
// mip level to read (0 where the picture has no mips)
uniform float uLod;
void main() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    sum += fromTarget(textureLod(uTex, vUv + uOffsets[i] * uRadius, uLod)).rgb;
  }
  outColor = toTarget(vec4(sum / float(TAPS), 1.0));
}
`;

const _color = new THREE.Color();
const _saved = new THREE.Color();

export class FarLayer {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./caps.js').Caps} caps
   * @param {{ taps?: number, fillTaps?: number }} [options] samples of the two blur passes
   */
  constructor(renderer, caps, { taps = 16, fillTaps = 8 } = {}) {
    this.renderer = renderer;
    this.caps = caps;
    this.taps = taps;
    this.fillTaps = fillTaps;
    /** Linear colour the layer is cleared to before the scene is drawn. */
    this.clearColor = new THREE.Color(0, 0, 0);

    this.sharp = createTarget(caps, { depth: true });
    // three.js rebuilds the mip chain each time the target has been drawn into
    this.sharp.texture.generateMipmaps = true;
    this.sharp.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.half = createTarget(caps);
    this.blurred = createTarget(caps);
    /** The scene before the blur (for debugging). */
    this.sharpTexture = this.sharp.texture;
    /** The finished, defocused picture. The object stays the same across resizes. */
    this.texture = this.blurred.texture;

    const pass = (count, rotation) =>
      new FullscreenPass(
        createPassMaterial(caps, {
          fragmentShader: BLUR_FRAGMENT,
          defines: { TAPS: count },
          uniforms: {
            uTex: { value: null },
            uOffsets: { value: discOffsets(count, rotation) },
            uRadius: { value: new THREE.Vector2() },
            uLod: { value: 0 },
          },
        }),
      );
    this.blurPass = pass(taps, 0);
    // turned against the first pattern so the two do not line up
    this.fillPass = pass(fillTaps, 0.9);
  }

  setSize(width, height) {
    resizeTarget(this.sharp, width, height);
    resizeTarget(this.half, width, height);
    resizeTarget(this.blurred, width, height);
  }

  /**
   * Draw `scene` from `camera` and defocus it.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {number} radius radius of the blur disc as a fraction of the picture's height (0: sharp)
   */
  render(scene, camera, radius) {
    const { renderer } = this;
    const ldr = !this.caps.hdr;
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(_saved);
    const c = this.clearColor;
    renderer.setClearColor(_color.setRGB(encodeForTarget(c.r, ldr), encodeForTarget(c.g, ldr), encodeForTarget(c.b, ldr)), 1);
    renderer.setRenderTarget(this.sharp);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(_saved, alpha);

    const aspect = this.sharp.width / this.sharp.height;
    // The gap between neighbouring samples: each of the `taps` samples owns an
    // equal share of the disc's area, so the gap is the side of that share.
    const gap = radius * Math.sqrt(Math.PI / this.taps);
    const gapInTexels = gap * this.sharp.height;
    const blur = this.blurPass.material.uniforms;
    blur.uTex.value = this.sharp.texture;
    blur.uRadius.value.set(radius / aspect, radius);
    blur.uLod.value = Math.max(0, Math.log2(Math.max(gapInTexels, 1e-3)));
    this.blurPass.render(renderer, this.half);
    const fill = this.fillPass.material.uniforms;
    fill.uTex.value = this.half.texture;
    fill.uRadius.value.set((gap * 0.75) / aspect, gap * 0.75);
    this.fillPass.render(renderer, this.blurred);
  }

  dispose() {
    this.sharp.dispose();
    this.half.dispose();
    this.blurred.dispose();
    this.blurPass.dispose();
    this.fillPass.dispose();
  }
}
