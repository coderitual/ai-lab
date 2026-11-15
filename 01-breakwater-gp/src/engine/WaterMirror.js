// What stands on the water, mirrored in it.
//
// The sea already reflects the sky (that is computed, not drawn). This adds
// everything else: boats, marks, the arch, the island. Before a view is drawn,
// the scene is drawn once more from a camera mirrored below the surface, with
// the sea and the sky left out, into a texture. The water shader then looks up
// each of its pixels in that picture, pushed about by the ripples, and lays it
// over the sky's reflection wherever something was there.
//
// The sea is not flat, and a mirror image needs one plane to be mirrored in:
// the plane is put at the height of the water under the view's own boat, whose
// reflection is the one you see most of.

import * as THREE from 'three';

let blank = null;
function blankTexture() {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    blank.needsUpdate = true;
  }
  return blank;
}

/** Shared with the water material. */
export const mirrorUniforms = {
  uMirrorTex: { value: blankTexture() },
  /** World position on the mirror plane -> where it is in the picture. */
  uMirrorMatrix: { value: new THREE.Matrix4() },
  /** Height of the plane, how much of the picture shows (0 = none), how far the ripples push it about. */
  uMirror: { value: new THREE.Vector3(0, 0, 0.11) },
};

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3(0, 1, 0);
const _point = new THREE.Vector3();
const _position = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _color = new THREE.Color();

export class WaterMirror {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} [scale] size of the picture relative to the view
   */
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer;
    this.scale = scale;
    const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    // mip levels let the water read a soft picture where ripples scatter it
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.matrix = new THREE.Matrix4();
    this.level = 0;
    this.ready = false;
  }

  /** Size of the view this mirror serves, in device pixels. */
  setSize(width, height) {
    const w = Math.max(4, Math.round(width * this.scale));
    const h = Math.max(4, Math.round(height * this.scale));
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h);
  }

  /**
   * Draw the mirror image for `camera`, of everything above the plane y = level.
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera its world matrix must be up to date
   * @param {number} level height of the mirror plane
   * @param {THREE.Object3D[]} hidden left out of the picture (the sea itself, the sky, spray)
   * @returns {boolean} false if there was nothing to draw (the camera is at or below the plane)
   */
  render(scene, camera, level, hidden = []) {
    this.ready = false;
    _position.setFromMatrixPosition(camera.matrixWorld);
    if (_position.y - level < 0.25) return false;
    const mirror = this.camera;
    const { renderer } = this;

    // the camera, its aim and its up vector, all mirrored in the plane
    _rotation.extractRotation(camera.matrixWorld);
    _target.set(0, 0, -1).applyMatrix4(_rotation).add(_position);
    _up.set(0, 1, 0).applyMatrix4(_rotation);
    _position.y = 2 * level - _position.y;
    _target.y = 2 * level - _target.y;
    _up.y = -_up.y;
    mirror.position.copy(_position);
    mirror.up.copy(_up);
    mirror.lookAt(_target);
    mirror.updateMatrix();
    mirror.updateMatrixWorld(true);
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // world -> picture coordinates
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    this.level = level;

    // Nothing below the surface belongs in the picture: slant the near plane of
    // the projection so that it lies in the mirror plane (Lengyel's oblique clipping).
    _plane.setFromNormalAndCoplanarPoint(_normal, _point.set(0, level - 0.06, 0));
    _plane.applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = mirror.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + p[8]) / p[0];
    _q.y = (Math.sign(_clip.y) + p[9]) / p[5];
    _q.z = -1;
    _q.w = (1 + p[10]) / p[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1;
    p[14] = _clip.w;

    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const previous = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(_color);
    // the water must not look itself up while it is being left out of the picture
    const strength = mirrorUniforms.uMirror.value.y;
    mirrorUniforms.uMirror.value.y = 0;
    mirrorUniforms.uMirrorTex.value = blankTexture();

    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previous);
    renderer.autoClear = auto;
    renderer.setClearColor(_color, alpha);

    mirrorUniforms.uMirror.value.y = strength;
    hidden.forEach((o, i) => (o.visible = was[i]));
    this.ready = true;
    return true;
  }

  /** Point the water at this mirror's picture (or at nothing, if it has none). */
  use(strength = 1) {
    const u = mirrorUniforms;
    if (this.ready && strength > 0) {
      u.uMirrorTex.value = this.target.texture;
      u.uMirrorMatrix.value.copy(this.matrix);
      u.uMirror.value.x = this.level;
      u.uMirror.value.y = strength;
    } else WaterMirror.off();
  }

  /** The water mirrors only the sky. */
  static off() {
    mirrorUniforms.uMirrorTex.value = blankTexture();
    mirrorUniforms.uMirror.value.y = 0;
  }

  dispose() {
    this.target.dispose();
  }
}
