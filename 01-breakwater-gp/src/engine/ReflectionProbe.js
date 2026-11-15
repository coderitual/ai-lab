// Live reflections.
//
// A small cube map is rendered from the middle of the action, one face per
// frame, so shiny things (a boat's gel coat, its canopy, its engine cowls) can
// mirror what is really around them: the sky with its clouds and sun, the
// island, the sea and its wakes, the marks, the other boats.
//
// Materials sample it through one shared uniform. While the probe is drawing a
// face, that uniform is pointed at a plain stand-in, because a texture cannot
// be read while it is being drawn into.

import * as THREE from 'three';
import { WaterMirror } from './WaterMirror.js';

/** Shared by every material that mirrors the surroundings. */
export const liveEnv = { value: null };

export class ReflectionProbe {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} [size] edge of each face in pixels
   */
  constructor(renderer, size = 256) {
    this.renderer = renderer;
    // sunlight on the water is far brighter than white: keep that, where the device can
    const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    const options = { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
    this.target = new THREE.WebGLCubeRenderTarget(size, options);
    this.standIn = new THREE.WebGLCubeRenderTarget(4, { type: THREE.UnsignedByteType });
    this.rig = new THREE.CubeCamera(0.3, 9000, this.target);
    this.rig.coordinateSystem = renderer.coordinateSystem;
    this.rig.updateCoordinateSystem();
    this.face = 0;
    this.drawn = 0;
    this._clear = new THREE.Color();
    this._paintStandIn();
    liveEnv.value = this.standIn.texture;
  }

  /** The stand-in is a flat sky blue. */
  _paintStandIn() {
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this._clear);
    renderer.setClearColor(0x6f9fc8, 1);
    for (let f = 0; f < 6; f++) {
      renderer.setRenderTarget(this.standIn, f);
      renderer.clear();
    }
    renderer.setRenderTarget(previous);
    renderer.setClearColor(this._clear, alpha);
  }

  /** The camera that will draw the next face (to prepare the scene for it). */
  get camera() {
    return this.rig.children[this.face];
  }

  /**
   * Draw the next face of the map as seen from (x, y, z).
   * @param {THREE.Scene} scene
   * @param {THREE.Object3D[]} hidden left out of the picture (the boat the probe sits in)
   */
  update(scene, x, y, z, hidden = []) {
    const { renderer, rig } = this;
    rig.position.set(x, y, z);
    rig.updateMatrixWorld(true);
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    liveEnv.value = this.standIn.texture;
    WaterMirror.off(); // a mirror image drawn for some other camera has no place in this picture

    const previous = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, rig.children[this.face]);
    renderer.setRenderTarget(previous);
    renderer.autoClear = auto;

    hidden.forEach((o, i) => (o.visible = was[i]));
    this.face = (this.face + 1) % 6;
    this.drawn++;
    this._publish();
  }

  /** Point the materials back at the map (once it has been drawn all the way round). */
  _publish() {
    liveEnv.value = this.drawn >= 6 ? this.target.texture : this.standIn.texture;
  }

  /** The GPU dropped everything: start over. */
  reset() {
    this.drawn = 0;
    this.face = 0;
    this._paintStandIn();
    this._publish();
  }
}

/**
 * Give a lit material a glossy top coat that mirrors the live map.
 * @param {THREE.Material} material a built-in lit material (Standard / Physical)
 * @param {{ strength?: number, base?: number, edge?: number, blur?: number }} [o] how bright the mirror
 *   image is, how much of it shows face-on and how much at a glancing angle, and how soft it is
 */
export function withLiveReflections(material, { strength = 1, base = 0.04, edge = 1, blur = 0 } = {}) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.uniforms.uLiveEnv = liveEnv;
    shader.uniforms.uLiveCoat = { value: new THREE.Vector4(strength, base, blur, edge) };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform samplerCube uLiveEnv;\nuniform vec4 uLiveCoat;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 coatView = normalize(vViewPosition);
          vec3 coatDir = inverseTransformDirection(reflect(-coatView, normal), viewMatrix);
          float coatFresnel = mix(uLiveCoat.y, uLiveCoat.w, pow(1.0 - clamp(dot(normal, coatView), 0.0, 1.0), 5.0));
          // the sun in the mirror is very bright: let it glint, not bleach the whole panel
          outgoingLight += min(textureCube(uLiveEnv, coatDir, uLiveCoat.z).rgb, vec3(24.0)) * coatFresnel * uLiveCoat.x;
        }
        #include <opaque_fragment>`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${key}|livecoat`;
  return material;
}
