// A mirror lying in a horizontal plane (the water).
//
// To know what a flat mirror shows, look at the world from the mirrored eye:
// a camera placed as far below the plane as the real one is above it, looking
// up at the same things. A point of the mirror and the thing reflected in it
// lie on one line from that camera, so they land on the same pixel of its
// picture. The water shader therefore only needs `matrix`, which says where a
// world position falls in that picture, to look its reflection up.
//
// This class keeps that camera and that matrix up to date, and owns the
// picture of the nearby things (the subject) with an alpha channel, so that
// it can be laid over a separately drawn reflection of the far surroundings.

import * as THREE from 'three';
import { createTarget, resizeTarget } from './caps.js';

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

export class PlanarMirror {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./caps.js').Caps} caps
   * @param {{ level?: number, clipBias?: number, samples?: number }} [options]
   *   `level`: height of the mirror plane. `clipBias`: how far below the plane
   *   the picture still reaches, in metres. A few centimetres of the swan's
   *   underwater hull are kept on purpose: when ripples push the lookup past
   *   the waterline it finds body instead of a dark gap.
   */
  constructor(renderer, caps, { level = 0, clipBias = 0.03, samples = 0 } = {}) {
    this.renderer = renderer;
    this.level = level;
    this.clipBias = clipBias;

    /** The mirrored eye. Its layers are set by whoever renders with it. */
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    /** World position -> coordinates in this camera's picture (xy / w is 0..1). */
    this.matrix = new THREE.Matrix4();
    /** False when the real camera is at or below the plane: nothing to mirror. */
    this.valid = false;

    this.target = createTarget(caps, { depth: true, samples });
    this.texture = this.target.texture;
    /** For materials that look the mirror up: share these objects. */
    this.uniforms = {
      uMirrorTex: { value: this.texture },
      uMirrorMatrix: { value: this.matrix },
    };
  }

  setSize(width, height) {
    resizeTarget(this.target, width, height);
  }

  /**
   * Place the mirrored camera for `camera` (whose world matrix must be up to
   * date) and recompute the texture matrix.
   * @param {THREE.PerspectiveCamera} camera
   * @returns {boolean} `valid`
   */
  update(camera) {
    const { level } = this;
    const mirror = this.camera;
    _position.setFromMatrixPosition(camera.matrixWorld);
    this.valid = _position.y - level > 0.02;
    if (!this.valid) return false;

    // The eye, the point it looks at and its up vector, each mirrored in the
    // plane. Mirroring "up" as well turns the camera upside down instead of
    // flipping the picture, so triangles keep their winding and no material
    // has to know it is being drawn for a mirror.
    _rotation.extractRotation(camera.matrixWorld);
    _target.set(0, 0, -1).applyMatrix4(_rotation).add(_position);
    _up.set(0, 1, 0).applyMatrix4(_rotation);
    _position.y = 2 * level - _position.y;
    _target.y = 2 * level - _target.y;
    _up.y = -_up.y;
    // (Built by hand rather than with camera.lookAt(), which reads the
    // camera's world matrix from before it was moved.)
    mirror.position.copy(_position);
    mirror.up.copy(_up);
    mirror.quaternion.setFromRotationMatrix(_rotation.lookAt(_position, _target, _up));
    mirror.updateMatrix();
    mirror.updateMatrixWorld(true);
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    // world -> picture: clip space squeezed from -1..1 into 0..1
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Nothing below the surface belongs in the picture. Instead of a clip
    // plane in every shader, the projection's near plane is slanted so that it
    // lies in the mirror plane (Lengyel's oblique near-plane clipping, as in
    // three.js's Reflector). The texture matrix above was taken before this:
    // the slant changes depth only, not where things land in the picture.
    _plane.setFromNormalAndCoplanarPoint(_normal, _point.set(0, level - this.clipBias, 0));
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
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
    return true;
  }

  /**
   * Draw `scene` from the mirrored camera into this mirror's own target,
   * cleared to transparent. Only objects on `layer` are drawn, which is how
   * the water itself (and anything else that should not be reflected) is left
   * out. Where nothing is drawn alpha stays 0; edges come out premultiplied.
   * @param {THREE.Scene} scene
   * @param {number} layer
   */
  render(scene, layer) {
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(_color);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    // With the eye under the water there is nothing to mirror, but the picture
    // must still be emptied: draw with a layer nothing is on. (A bare clear()
    // would not reach the texture of a multisampled target.)
    this.camera.layers.set(this.valid ? layer : 31);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(_color, alpha);
  }

  dispose() {
    this.target.dispose();
  }
}
