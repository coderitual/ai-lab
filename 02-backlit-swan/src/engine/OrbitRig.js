// The camera on a boom: it looks at a target from a compass direction, an
// angle above the ground and a distance, through a lens of a given width.
//
// Angles are in degrees, lengths in metres.
//
//   az    the compass direction the camera LOOKS in: 0 looks north (toward -Z)
//         from due south of the target, 90 looks east (toward +X) from the west
//   el    how far above the horizontal plane through the target the camera is
//   dist  from the target
//   fov   the field of view of a square picture with the same area as the
//         real one (see update() for why)
//
// This first version has no gestures: views are set from code, and the camera
// breathes a little on its own. Touch and mouse orbiting come later and will
// write the same az / el / dist / fov.

import * as THREE from 'three';
import { DEG, angleDiffDeg, clamp, lerp } from './math.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class OrbitRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement what gestures will be listened on (unused so far)
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    /** Whether gestures move the camera (there are none yet). Views set from code always apply. */
    this.enabled = true;

    this.target = new THREE.Vector3();
    this.az = 0;
    this.el = 6;
    this.dist = 20;
    this.fov = 12;
    /**
     * Where the target sits in the picture, in units of half the picture
     * (0, 0 is the centre, y = -0.3 is 30 % of the way down). The camera is
     * turned, not moved, so the perspective on the target does not change.
     */
    this.offset = new THREE.Vector2();

    /** Limits applied to whatever is set. `minHeight` keeps the lens out of the water. */
    this.limits = { minEl: 1, maxEl: 60, minDist: 2, maxDist: 60, minFov: 3, maxFov: 50, minHeight: 0.12 };
    /** Idle movement: degrees of sway and seconds per cycle. Zero amplitude switches it off. */
    this.drift = { az: 0.35, el: 0.12, period: 46 };

    this._blend = null; // { from, to, t, seconds }
    this._time = 0;
  }

  /**
   * Go to a view. Values that are left out stay as they are.
   * @param {{ az?: number, el?: number, dist?: number, fov?: number, target?: THREE.Vector3|number[], offset?: number[] }} view
   *   `target` may be an array with holes (undefined keeps that coordinate).
   * @param {number} [seconds] time to ease there; 0 jumps
   */
  set(view, seconds = 0) {
    const to = this._snapshot();
    for (const key of ['az', 'el', 'dist', 'fov']) if (Number.isFinite(view[key])) to[key] = view[key];
    if (view.target) {
      const t = view.target.isVector3 ? view.target.toArray() : view.target;
      for (let i = 0; i < 3; i++) if (Number.isFinite(t[i])) to.target[i] = t[i];
    }
    if (view.offset) for (let i = 0; i < 2; i++) if (Number.isFinite(view.offset[i])) to.offset[i] = view.offset[i];
    this._clampView(to);
    if (seconds > 0) {
      const from = this._snapshot();
      // go round the short way
      to.az = from.az + angleDiffDeg(from.az, to.az);
      this._blend = { from, to, t: 0, seconds };
    } else {
      this._blend = null;
      this._apply(to);
    }
  }

  _snapshot() {
    return { az: this.az, el: this.el, dist: this.dist, fov: this.fov, target: this.target.toArray(), offset: this.offset.toArray() };
  }

  _apply(v) {
    this.az = v.az;
    this.el = v.el;
    this.dist = v.dist;
    this.fov = v.fov;
    this.target.fromArray(v.target);
    this.offset.fromArray(v.offset);
  }

  _clampView(v) {
    const l = this.limits;
    v.el = clamp(v.el, l.minEl, l.maxEl);
    v.dist = clamp(v.dist, l.minDist, l.maxDist);
    v.fov = clamp(v.fov, l.minFov, l.maxFov);
  }

  /**
   * Move toward the view being blended to and write the camera.
   * @param {number} dt seconds of real time
   * @param {number} aspect width / height of the picture
   */
  update(dt, aspect) {
    this._time += dt;
    if (this._blend) {
      const b = this._blend;
      b.t = Math.min(1, b.t + dt / b.seconds);
      const k = b.t * b.t * (3 - 2 * b.t);
      this._apply({
        az: lerp(b.from.az, b.to.az, k),
        el: lerp(b.from.el, b.to.el, k),
        dist: lerp(b.from.dist, b.to.dist, k),
        fov: lerp(b.from.fov, b.to.fov, k),
        target: b.from.target.map((v, i) => lerp(v, b.to.target[i], k)),
        offset: b.from.offset.map((v, i) => lerp(v, b.to.offset[i], k)),
      });
      if (b.t >= 1) this._blend = null;
    }

    const { camera, limits } = this;
    // Two slow sways with periods that never line up, so the idle movement does not read as a loop.
    const phase = (this._time / Math.max(1, this.drift.period)) * Math.PI * 2;
    const az = (this.az + this.drift.az * Math.sin(phase)) * DEG;
    const el = clamp(this.el + this.drift.el * Math.sin(phase * 0.618 + 1.3), limits.minEl, limits.maxEl) * DEG;

    // from the target back to the camera
    _dir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(this.target).addScaledVector(_dir, this.dist);
    if (camera.position.y < limits.minHeight) camera.position.y = limits.minHeight;

    // The lens. A phone held upright and a wide desktop window should both
    // show the subject at a sensible size. Keeping the vertical angle would
    // make it tiny in a wide window; keeping the horizontal angle would crop
    // it on the phone. Keeping the AREA of the view gives both: `fov` is the
    // angle of a square picture, a tall picture gets a taller and narrower
    // one, a wide picture a wider and lower one.
    const a = clamp(aspect, 0.4, 2.4);
    const tanSquare = Math.tan((this.fov * DEG) / 2);
    const tanV = tanSquare / Math.sqrt(a);
    const tanH = tanV * aspect;
    camera.fov = (2 * Math.atan(tanV)) / DEG;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // Aim so that the target lands at `offset` in the picture: swing the line
    // of sight by the matching angles instead of pointing straight at it.
    _right.set(Math.cos(az), 0, Math.sin(az));
    _up.crossVectors(_right, _dir).negate();
    const d = camera.position.distanceTo(this.target);
    _aim.copy(this.target).addScaledVector(_right, -this.offset.x * tanH * d).addScaledVector(_up, -this.offset.y * tanV * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(_aim);
    camera.updateMatrixWorld(true);
  }

  dispose() {
    // nothing to release yet; gesture listeners will be removed here
  }
}
