// What the swan does. PLACEHOLDER: it glides along a slow winding path and
// pushes a small bow wave ahead of its breast; callTo() and act() do the
// least that keeps the interface honest. The real behaviour (swimming to a
// called point, feeding with the neck under water, lifting the head with
// drops falling from the bill, looking round, shaking) replaces the contents
// of this file and keeps the class's shape.

import * as THREE from 'three';
import { angleDiff, damp } from '../engine/math.js';

const _forward = new THREE.Vector3();
const _velocity = new THREE.Vector3();

export class SwanMind {
  /**
   * @param {object} ctx the shared context (see World.js)
   * @param {import('../assets/swan/Swan.js').Swan} swan
   * @param {ReturnType<import('../assets/fx/Droplets.js').createDroplets>|null} droplets
   */
  constructor(ctx, swan, droplets) {
    this.ctx = ctx;
    this.swan = swan;
    this.droplets = droplets;
    /** Where the swan is on the water (y stays 0). */
    this.position = new THREE.Vector3(0, 0, 0);
    /** Radians; the swan faces (sin h, 0, cos h). Starts side-on to the default camera, facing west. */
    this.heading = -Math.PI / 2;
    this.speed = 0;

    this._state = 'drift';
    this._goal = null; // { x, z } while called somewhere
    this._action = null; // { name, t }
    this._wander = 0;
    this._sinceWake = 0;
    this._billWet = false;
    this._write();
  }

  /** 'drift' | 'swim' | 'feed' | the name of the action being played. */
  get state() {
    return this._action ? this._action.name : this._state;
  }

  /** Swim to a point on the water and feed there. */
  callTo(x, z) {
    if (this.ctx.pond.shoreDistance(x, z) > -2) return; // not onto the bank
    this._goal = { x, z };
    this._state = 'swim';
  }

  /**
   * Play a short action.
   * @param {'dip'|'lift'|'look'|'shake'} name
   */
  act(name) {
    if (!['dip', 'lift', 'look', 'shake'].includes(name)) return;
    this._action = { name, t: 0 };
    if (name === 'shake' && this.droplets) {
      this.droplets.spawn({ position: this.swan.headPosition, velocity: _velocity.set(0, 1.2, 0), spread: 0.9, count: 40, size: 0.006 });
    }
  }

  /**
   * @param {number} dt seconds, already slowed
   * @param {number} time seconds of slowed time since the start
   */
  update(dt, time) {
    const { swan, ctx } = this;
    let wantSpeed = 0.1;
    let wantHeading;
    if (this._goal) {
      const dx = this._goal.x - this.position.x;
      const dz = this._goal.z - this.position.z;
      const left = Math.hypot(dx, dz);
      wantHeading = Math.atan2(dx, dz);
      wantSpeed = Math.min(0.45, 0.1 + left * 0.25);
      if (left < 0.25) {
        this._goal = null;
        this._state = 'feed';
        this.act('dip');
      }
    } else {
      // a slow wander: the heading drifts by a smooth, never-repeating amount
      this._wander += dt;
      wantHeading = this.heading + 0.12 * Math.sin(this._wander * 0.21) + 0.08 * Math.sin(this._wander * 0.083 + 1.7);
      if (this._state === 'feed') wantSpeed = 0.02;
      // stay well inside the pond: turn back toward the middle when far out
      if (this.position.length() > 9) wantHeading = Math.atan2(-this.position.x, -this.position.z);
    }
    this.heading += angleDiff(this.heading, wantHeading) * Math.min(1, dt * 0.8);
    this.speed = damp(this.speed, wantSpeed, 0.8, dt);
    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.position.addScaledVector(_forward, this.speed * dt);

    // actions: the placeholder only moves the neck
    let dip = 0;
    if (this._action) {
      const a = this._action;
      a.t += dt;
      if (a.name === 'dip') dip = Math.sin(Math.min(1, a.t / 3) * Math.PI);
      if (a.name === 'lift' && a.t < dt * 1.5 && this.droplets) {
        this.droplets.spawn({ position: swan.billTip, velocity: _velocity.set(0, 0.2, 0), spread: 0.25, count: 12, size: 0.007 });
      }
      if (a.t > 3) {
        this._action = null;
        if (this._state === 'feed') this._state = 'drift';
      }
    }
    swan.pose.dip = damp(swan.pose.dip, dip, 4, dt);
    this._write();

    // the bill going into and coming out of the water
    const wet = swan.billTip.y < 0.01;
    if (wet !== this._billWet) {
      this._billWet = wet;
      ctx.events.emit(wet ? 'billEnter' : 'billExit', { x: swan.billTip.x, z: swan.billTip.z });
      ctx.ripple.disturb(swan.billTip.x, swan.billTip.z, 0.06, 0.004);
      if (!wet && this.droplets) {
        this.droplets.spawn({ position: swan.billTip, velocity: _velocity.set(0, 0.35, 0), spread: 0.15, count: 8, size: 0.006 });
      }
    }

    // The breast pushes water aside as it moves: a small dent every few
    // centimetres travelled, which the ripple field turns into a bow wave.
    this._sinceWake += this.speed * dt;
    if (this._sinceWake > 0.05) {
      this._sinceWake = 0;
      const reach = swan.footprint.length * 0.42;
      ctx.ripple.disturb(this.position.x + _forward.x * reach, this.position.z + _forward.z * reach, 0.11, 0.0035 + this.speed * 0.02);
    }
    // and it never sits perfectly still: a slow breath of a ripple under the body
    if (Math.floor(time * 0.7) !== Math.floor((time - dt) * 0.7)) {
      ctx.ripple.disturb(this.position.x, this.position.z, 0.3, 0.0012);
    }
  }

  _write() {
    const g = this.swan.group;
    g.position.copy(this.position);
    g.rotation.y = this.heading;
    this.swan.update(0, 0);
  }
}
