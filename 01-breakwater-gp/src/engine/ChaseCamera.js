// Third-person camera, close behind the boat.
//
// The feel comes from what the camera does *not* follow: it trails the
// direction of travel more than the hull's heading (so slides read as slides),
// it follows height lazily (so the boat visibly rises and falls on the swell
// and floats up the frame on a jump), and it widens the lens with speed.
//
// And from what it adds: it swings to the outside of a turn and leans with
// it, looks a little way into the turn, trembles at speed, and when the boat
// boosts it is left behind for a moment while the lens opens up.

import * as THREE from 'three';
import { angleDiff, clamp, clamp01, damp, dampAngle, lerp } from './math.js';
import { waterHeight } from './waves.js';

const _look = new THREE.Vector3();

export class ChaseCamera {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.baseY = 0;
    this.lookY = 0;
    this.roll = 0;
    this.fov = 62;
    this.shake = 0;
    this.swing = 0; // metres to the side of the boat's track (to the outside of a turn)
    this.lean = 0; // how far the look point is shifted into the turn
    this.back = 0; // extra distance while the boat pulls away under boost
    this._t = 0;
    this.aspect = 1.78;
    this.mode = 'chase'; // 'chase' | 'orbit'
    this.orbitAngle = 0;
    this._blend = 1; // 0 = orbit pose, 1 = chase pose
    this._pos = new THREE.Vector3();
    this._orbitPos = new THREE.Vector3();
    this._orbitLook = new THREE.Vector3();
    this._chaseLook = new THREE.Vector3();
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  /** Vertical FOV that keeps a sensible horizontal view in portrait too. */
  _fovFor(baseFov) {
    if (this.aspect >= 1.3) return baseFov;
    // hold the horizontal FOV we would have had at 4:3
    const h = 2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) * 1.3);
    return Math.min(96, (2 * Math.atan(Math.tan(h / 2) / this.aspect) * 180) / Math.PI);
  }

  kick(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Jump straight behind the craft (race start, respawn). */
  snap(craft) {
    this.yaw = craft.yaw;
    this.baseY = craft.object.position.y;
    this.lookY = this.baseY;
    this.roll = 0;
    this._blend = this.mode === 'chase' ? 1 : 0;
  }

  /**
   * @param {number} dt frame time
   * @param {import('../game/Craft.js').Craft} craft
   * @param {number} time sea time (for keeping the lens above the surface)
   */
  update(dt, craft, time) {
    const cam = this.camera;
    const p = craft.object.position;
    const portrait = this.aspect < 1;
    const speedK = clamp01(craft.speed / 28);

    // --- chase pose
    let travel = craft.yaw;
    if (craft.speed > 4) travel = Math.atan2(craft.vel.x, craft.vel.z);
    const want = craft.yaw + angleDiff(craft.yaw, travel) * 0.55;
    this.yaw = dampAngle(this.yaw, want, 4.6, dt);
    this.baseY = damp(this.baseY, p.y, craft.airborne ? 1.6 : 3.0, dt);
    // lazy, but this close to the boat never so lazy that it slides out of the frame
    this.baseY = clamp(this.baseY, p.y - 1.0, p.y + 0.45);
    this.lookY = damp(this.lookY, p.y, 5, dt);

    // low and close: the boat fills the lower middle of the frame. It backs off a little at speed, and is left
    // behind for a moment when the boat boosts
    const boost = craft.boostK || 0;
    this.back = damp(this.back, boost * 1.5, boost > this.back / 1.5 ? 5 : 1.6, dt);
    const dist = (portrait ? 6.9 : 5.5) + 0.6 * speedK + this.back;
    const height = (portrait ? 1.85 : 1.5) + 0.12 * speedK;
    const bx = Math.sin(this.yaw);
    const bz = Math.cos(this.yaw);
    // out to the side in a turn (the outside of it), so the boat is seen a little from its flank
    const turn = clamp(craft.yawRate * (0.35 + 0.65 * speedK), -1.4, 1.4);
    this.swing = damp(this.swing, -turn * 1.25, 3.2, dt);
    this.lean = damp(this.lean, turn * 2.6, 3.6, dt);
    // (to port of the travel direction is (bz, -bx))
    this._pos.set(p.x - bx * dist + bz * this.swing, this.baseY + height, p.z - bz * dist - bx * this.swing);
    // looking slightly down and a little way into the turn: the stern near the bottom of the frame, the horizon
    // above the middle
    this._chaseLook.set(p.x + bx * 7 + bz * this.lean, this.lookY + (portrait ? 0.3 : 0.15), p.z + bz * 7 - bx * this.lean);

    // --- orbit pose (title screen, after the finish)
    this.orbitAngle += dt * 0.22;
    const oa = craft.yaw + Math.PI * 0.8 + this.orbitAngle;
    const orad = portrait ? 13 : 9.6;
    this._orbitPos.set(p.x + Math.sin(oa) * orad, this.baseY + 2.3 + Math.sin(this.orbitAngle * 0.7) * 0.6, p.z + Math.cos(oa) * orad);
    this._orbitLook.set(p.x, this.lookY + 0.6, p.z);

    this._blend = damp(this._blend, this.mode === 'chase' ? 1 : 0, 2.6, dt);
    const b = this._blend * this._blend * (3 - 2 * this._blend);
    cam.position.lerpVectors(this._orbitPos, this._pos, b);
    _look.lerpVectors(this._orbitLook, this._chaseLook, b);

    // never dip the lens under a passing crest
    const floor = waterHeight(cam.position.x, cam.position.z, time) + 0.75;
    if (cam.position.y < floor) cam.position.y = floor;

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.15;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = damp(this.shake, 0, 5, dt);
    }
    // the tremble of speed: small, quick and smooth, stronger flat out and stronger still under boost
    this._t += dt;
    const tremble = (speedK * speedK * speedK * 0.012 + boost * 0.03) * b;
    if (tremble > 0.0005) {
      const t = this._t;
      cam.position.x += (Math.sin(t * 37.1) + Math.sin(t * 59.3 + 1.3)) * tremble;
      cam.position.y += (Math.sin(t * 43.7 + 0.7) + Math.sin(t * 71.9)) * tremble * 0.8;
    }

    cam.lookAt(_look);
    this.roll = damp(this.roll, clamp(craft.yawRate * 0.085 - craft.roll * 0.12, -0.16, 0.16) * b, 4, dt);
    cam.rotateZ(this.roll);

    const fov = this._fovFor(lerp(56, 67, speedK * speedK) + (craft.power >= 5 ? 1.5 : 0) + 10 * boost);
    this.fov = damp(this.fov, fov, boost > 0.05 ? 6 : 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
