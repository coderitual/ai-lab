// The camera rigs. FIRST VERSION: a plain chase camera with far, bonnet and
// bumper variants, look back, and the title's orbit. The camera stage
// replaces the insides; the shape is what the game relies on:
//
//   rig.update(dt, vehicle, track)   fixed step: everything the rig remembers
//                                    (the heading it has swung to, the height
//                                    it has drifted to) moves here and only here
//   rig.apply(camera, alpha)         per drawn frame: where the camera stands,
//                                    from that memory and the car's pose, both
//                                    taken between the last two steps
//   rig.snap(vehicle)                jump to where it should be (a start, a
//                                    put-back, a new mode); sets `cut`
//   rig.mode                         'chase' | 'far' | 'bonnet' | 'bumper' | 'orbit'
//   rig.lookBack                     held: look out of the back
//   rig.cut                          the next frame must not be blurred from the last
//   rig.setAspect(aspect)            the shape of the view's rectangle

import * as THREE from 'three';
import { angleDiff, clamp01, damp, dampAngle, lerp } from '../engine/math.js';
import { STATIONS, VIEWPOINTS } from '../assets/car/spec.js';
import { CAMERA } from './config.js';

const NARROW = 4 / 3;
const position = new THREE.Vector3();
const target = new THREE.Vector3();
const quat = new THREE.Quaternion();
const eye = new THREE.Vector3();
const ahead = new THREE.Vector3();

export class CameraRig {
  /** @param {'chase'|'far'|'bonnet'|'bumper'|'orbit'} [mode] */
  constructor(mode = 'chase') {
    this.mode = mode;
    this.lookBack = false;
    this.aspect = 16 / 9;
    this.cut = true;
    /** @type {import('./vehicle/Vehicle.js').Vehicle|null} */
    this.vehicle = null;
    this._yaw = 0;
    this._y = 0;
    this._speed = 0;
    this._orbit = 0;
    this._prevYaw = 0;
    this._prevY = 0;
    this._prevSpeed = 0;
    this._prevOrbit = 0;
    this._wasBack = false;
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  /** Change mode; a cut. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.vehicle) this.snap(this.vehicle);
  }

  /** Jump straight to where the camera belongs. */
  snap(vehicle) {
    this.vehicle = vehicle;
    this._yaw = this._prevYaw = vehicle.yaw;
    this._y = this._prevY = vehicle.position.y;
    this._speed = this._prevSpeed = vehicle.speed;
    this._prevOrbit = this._orbit;
    this.cut = true;
  }

  /** One fixed step. */
  update(dt, vehicle /* , track */) {
    this.vehicle = vehicle;
    const c = CAMERA.chase;
    this._prevYaw = this._yaw;
    this._prevY = this._y;
    this._prevSpeed = this._speed;
    this._prevOrbit = this._orbit;
    const travel = vehicle.speed > 4 ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z) : vehicle.yaw;
    this._yaw = dampAngle(this._yaw, vehicle.yaw + angleDiff(vehicle.yaw, travel) * c.slide, c.yawRate, dt);
    this._y = damp(this._y, vehicle.position.y, c.heightRate, dt);
    this._speed = vehicle.speed;
    if (this.mode === 'orbit') this._orbit += CAMERA.orbit.rate * dt;
    if (this.lookBack !== this._wasBack) {
      this._wasBack = this.lookBack;
      this.cut = true;
    }
  }

  /**
   * Pose `camera` for a frame drawn between the last two steps.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} alpha 0..1
   */
  apply(camera, alpha) {
    const vehicle = this.vehicle;
    if (!vehicle) return;
    const p = position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
    // how much narrower than 4:3 the picture is, 0..1 (1: a phone held upright)
    const narrow = clamp01((NARROW - this.aspect) / (NARROW - 0.5));
    let fov;
    if (this.mode === 'orbit') {
      const o = CAMERA.orbit;
      const a = vehicle.yaw + 2.4 + lerp(this._prevOrbit, this._orbit, alpha);
      const d = o.distance * lerp(1, 1.4, narrow);
      camera.position.set(p.x + Math.sin(a) * d, p.y + o.height, p.z + Math.cos(a) * d);
      camera.lookAt(target.set(p.x, p.y + o.lookHeight, p.z));
      fov = o.fov;
    } else if (this.mode === 'bonnet' || this.mode === 'bumper') {
      const m = CAMERA[this.mode];
      const at = VIEWPOINTS[this.mode];
      quat.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);
      // looking back from the bonnet or the bumper: at the same height, over the boot lid or behind the rear bumper
      const z = this.lookBack ? STATIONS.tail + (this.mode === 'bumper' ? -0.03 : 0.3) : at.z;
      eye.set(at.x, at.y, z).applyQuaternion(quat).add(p);
      ahead.set(0, 0, this.lookBack ? -m.lookAhead : m.lookAhead).applyQuaternion(quat);
      camera.position.copy(eye);
      camera.up.set(0, 1, 0).applyQuaternion(quat);
      camera.lookAt(target.copy(eye).add(ahead));
      camera.up.set(0, 1, 0);
      fov = m.fov;
    } else {
      const c = CAMERA.chase;
      const m = this.mode === 'far' ? CAMERA.far : c;
      const yaw = this._prevYaw + angleDiff(this._prevYaw, this._yaw) * alpha + (this.lookBack ? Math.PI : 0);
      const y = lerp(this._prevY, this._y, alpha);
      const distance = m.distance * lerp(1, c.narrowBack, narrow);
      const height = m.height * lerp(1, c.narrowLift, narrow);
      const bx = Math.sin(yaw);
      const bz = Math.cos(yaw);
      target.set(p.x + bx * m.lookAhead, p.y + m.lookHeight, p.z + bz * m.lookAhead);
      camera.position.set(p.x - bx * distance, y + height, p.z - bz * distance);
      camera.lookAt(target);
      const fast = clamp01(Math.abs(lerp(this._prevSpeed, this._speed, alpha)) / c.fastSpeed);
      fov = lerp(c.fov, c.fovFast, fast * fast);
    }
    if (this.aspect < NARROW) {
      // a narrow picture keeps the width of view a 4:3 one would have, and grows taller instead
      const half = Math.atan((Math.tan((fov * Math.PI) / 360) * NARROW) / this.aspect);
      fov = Math.min(95, (half * 360) / Math.PI);
    }
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
