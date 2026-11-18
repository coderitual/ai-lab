// A small cube picture of the surroundings of one point, for mirror-like
// surfaces (the cars' paint and glass), redrawn a face or two per frame.
//
// Drawing the scene six more times a frame would cost more than the frame
// itself, so the six faces take turns: `faces` of them per update, round and
// round. What a face shows is then a few frames old, which nobody can tell on
// a curved, moving car. The first update after construction or reset() draws
// all six, so the cube is never part garbage.
//
// How to look it up, and the snippet that does it: GLSL_PROBE in glsl.js.
// In short: the plain world-space direction, unflipped, and a mip level from
// the roughness. The cube is drawn the way three.js's own CubeCamera draws,
// so three.js's rule for cube render targets (no flip) and ours agree.
//
// What keeps it cheap: the faces are small, the far plane is short (the sky
// is drawn at infinity and needs none), the shadow maps are not drawn again
// for it, whatever is in `hidden` is skipped, and its cameras have a layer
// mask of their own (`layers`).

import * as THREE from 'three';
import { ldrEncodingInstalled } from './glsl.js';

/**
 * A layer only reflection probes see (the game's cameras have only layer 0): a cheaper stand-in for something
 * big goes on it, and the full thing draws nothing when `camera.layers.isEnabled(PROBE_LAYER)`.
 */
export const PROBE_LAYER = 30;

/** Where each face looks and which way is up in it: OpenGL's cube faces, in the order +X -X +Y -Y +Z -Z. */
const FACES = [
  { look: [1, 0, 0], up: [0, 1, 0] },
  { look: [-1, 0, 0], up: [0, 1, 0] },
  { look: [0, 1, 0], up: [0, 0, -1] },
  { look: [0, -1, 0], up: [0, 0, 1] },
  { look: [0, 0, 1], up: [0, 1, 0] },
  { look: [0, 0, -1], up: [0, 1, 0] },
];

const ahead = new THREE.Vector3();

export class ReflectionProbe {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} size edge of a face in texels (a power of two, so that the mip chain goes down to one texel)
   * @param {{ near?: number, far?: number }} [options] the faces' clip planes in metres; `far` is how far away
   *   something can be and still show in a reflection
   */
  constructor(renderer, size, { near = 0.3, far = 400 } = {}) {
    this.renderer = renderer;
    this.size = size;
    // Half-float where the device can draw into it. Under the 8-bit fallback every material writes encoded
    // values, and 8 bits hold them.
    const float = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      type: float && !ldrEncodingInstalled() ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    /** The cube map: mipmapped, linear light in scene units (see GLSL_PROBE for how to read it). */
    this.texture = this.target.texture;
    /**
     * What the probe's cameras see: layer 0, as every camera. To leave something out of every reflection
     * without listing it in `hidden`, move it to a layer the game's cameras have enabled and this mask has not.
     * Lights must stay visible to it, or three.js builds a second set of shaders for the probe's light count.
     */
    this.layers = new THREE.Layers();
    // and PROBE_LAYER, which no other camera has: what is on it alone is drawn for probes only (a cheaper stand-in)
    this.layers.enable(PROBE_LAYER);

    // A negative field of view turns the picture upside down and left to right, which is how a cube face is
    // stored (three.js's CubeCamera does the same).
    this._cameras = FACES.map((face) => {
      const camera = new THREE.PerspectiveCamera(-90, 1, near, far);
      camera.layers = this.layers;
      camera.up.fromArray(face.up);
      camera.lookAt(ahead.fromArray(face.look));
      return camera;
    });
    this._next = 0;
    this._filled = false;
    this._wasVisible = [];
  }

  /**
   * Redraw some of the faces from `position`.
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position where the probe stands, world space
   * @param {THREE.Object3D[]} [hidden] not drawn into the probe (the car it belongs to, small things)
   * @param {number} [faces] how many faces to redraw now, 1..6; the first update draws all six
   */
  update(scene, position, hidden = [], faces = 1) {
    const { renderer, target, texture } = this;
    const count = this._filled ? Math.min(6, Math.max(1, Math.round(faces))) : 6;

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    for (let i = 0; i < hidden.length; i++) {
      this._wasVisible[i] = hidden[i].visible;
      hidden[i].visible = false;
    }

    for (let k = 0; k < count; k++) {
      const face = this._next;
      this._next = (this._next + 1) % 6;
      const camera = this._cameras[face];
      camera.position.copy(position);
      // The shadow maps are the main view's and stay as they are. Only when the whole cube is drawn at once
      // (the very first frame may not have any yet) does the first face draw them.
      renderer.shadowMap.autoUpdate = shadowUpdate && !this._filled && k === 0;
      // the mip chain is built once, after the last face of this update
      texture.mipmapsAutoUpdate = k === count - 1;
      renderer.setRenderTarget(target, face);
      renderer.render(scene, camera);
    }

    for (let i = 0; i < hidden.length; i++) hidden[i].visible = this._wasVisible[i];
    renderer.shadowMap.autoUpdate = shadowUpdate;
    renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
    this._filled = true;
  }

  /** Forget what was drawn (after a lost WebGL context): the next update draws all six faces again. */
  reset() {
    this._filled = false;
    this._next = 0;
  }

  dispose() {
    this.target.dispose();
  }
}
