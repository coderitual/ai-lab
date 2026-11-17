// A flat mirror in any plane: what a wet road shows.
//
// To know what a flat mirror shows, look at the world from the mirrored eye:
// a camera placed as far behind the plane as the real one is in front of it,
// looking at the same things. A point of the mirror and the thing reflected
// in it lie on one line from that camera, so they land on the same pixel of
// its picture; a material that wants its reflection only needs `matrix`,
// which says where a world position falls in that picture (xy / w in 0..1).
//
// The eye, the point it looks at and its up vector are each mirrored in the
// plane (as three.js's Reflector does). Mirroring "up" as well turns the
// camera over instead of flipping the picture, so triangles keep their winding
// and no material has to know it is being drawn for a mirror. Nothing behind
// the plane belongs in the picture: the projection's near plane is slanted
// into the mirror plane (Lengyel's oblique near-plane clipping) instead of a
// clip plane in every shader, which would compile every material again.
//
// Cheap on purpose: a target smaller than the view, no multisampling, a short
// far plane (the sky, drawn at infinity by its own shader, still shows), the
// shadow maps are not drawn again for it, and whatever the caller names is
// hidden for the pass. Knows nothing about roads: the caller gives the plane.

import * as THREE from 'three';
import { createTarget, resizeTarget } from './caps.js';

const _cam = new THREE.Vector3();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

export class PlanarMirror {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./caps.js').Caps} caps
   * @param {{ scale?: number, far?: number, clipBias?: number }} [options] `scale`: the target's height against the
   *   view's; `far`: the mirrored camera's far plane (m); `clipBias`: how far behind the plane the picture still
   *   reaches (m), so that what stands on the surface meets its reflection without a gap
   */
  constructor(renderer, caps, { scale = 0.5, far = 300, clipBias = 0.03 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.far = far;
    this.clipBias = clipBias;
    this.camera = new THREE.PerspectiveCamera();
    /** World position -> the mirror's picture (xy / w in 0..1). */
    this.matrix = new THREE.Matrix4();
    /** False when the eye is behind the plane, or nothing has been drawn yet. */
    this.valid = false;
    this.target = createTarget(caps, { depth: true });
    this.texture = this.target.texture;
    /** For materials that read the mirror: share these objects. `uMirrorOn` is 0 while the picture is not valid. */
    this.uniforms = {
      uMirrorTex: { value: this.texture },
      uMirrorMatrix: { value: this.matrix },
      uMirrorOn: { value: 0 },
      uMirrorTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) },
    };
    /** Milliseconds the last render() took on the CPU side (for the stats). */
    this.ms = 0;
  }

  /**
   * Draw the scene as the mirror in the plane through `point` square to `normal` shows it to `camera`.
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera its world matrix up to date
   * @param {THREE.Vector3} point @param {THREE.Vector3} normal unit, on the side the camera should be
   * @param {THREE.Object3D[]} hidden hidden for this pass
   * @param {number} viewHeight the view's height in device pixels (the target is `scale` of it)
   */
  render(scene, camera, point, normal, hidden, viewHeight) {
    const started = performance.now();
    const { renderer } = this;
    const h = Math.max(16, Math.round(viewHeight * this.scale));
    const w = Math.max(16, Math.round(h * camera.aspect));
    if (this.target.width !== w || this.target.height !== h) {
      resizeTarget(this.target, w, h);
      this.uniforms.uMirrorTexel.value.set(1 / w, 1 / h);
    }
    _cam.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(point, _cam);
    this.valid = _view.dot(normal) < -0.02;
    this.uniforms.uMirrorOn.value = this.valid ? 1 : 0;
    if (!this.valid) return;

    const mirror = this.camera;
    // the eye mirrored
    _view.reflect(normal).negate().add(point);
    // the point it looks at, mirrored
    _rotation.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rotation).add(_cam);
    _target.subVectors(point, _look).reflect(normal).negate().add(point);
    mirror.position.copy(_view);
    mirror.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(normal);
    mirror.lookAt(_target);
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;
    mirror.near = camera.near;
    mirror.far = Math.min(camera.far, this.far);
    mirror.updateMatrixWorld();
    mirror.updateProjectionMatrix();

    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // the near plane slanted into the mirror (only depth changes: the matrix above still holds)
    _plane.setFromNormalAndCoplanarPoint(normal, _look.copy(point).addScaledVector(normal, -this.clipBias));
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

    const shown = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previous);
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = shadowNeeds;
    hidden.forEach((o, i) => (o.visible = shown[i]));
    this.ms = performance.now() - started;
  }

  dispose() {
    this.target.dispose();
  }
}
