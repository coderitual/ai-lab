// One watercraft: arcade physics on top of the simulated sea, plus the model.
//
// Conventions: yaw = rotation about +Y, forward = (sin yaw, 0, cos yaw);
// +yaw turns to port (left). pitch > 0 = bow up, roll > 0 = starboard down.
// Controls: steer -1 (left) .. +1 (right), throttle 0..1, brake 0..1.

import * as THREE from 'three';
import { createWatercraft } from '../assets/watercraft.js';
import { createRider } from '../assets/rider.js';
import { approach, clamp, clamp01, damp, lerp, smoothstep } from '../engine/math.js';
import { makeSurfaceSample, sampleSurface } from '../engine/waves.js';
import { CRAFT_TUNE as T } from './config.js';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const sBow = makeSurfaceSample();
const sStern = makeSurfaceSample();
const sPort = makeSurfaceSample();
const sStbd = makeSurfaceSample();
const sMid = makeSurfaceSample();

const FLOAT_DEPTH = T.gravity / T.buoyancy; // how far below the float line gravity is balanced
const VISUAL_LIFT = 0.06; // draw the hull a touch high so short chop does not swallow the deck

export class Craft {
  constructor({ team, number }) {
    this.team = team;
    this.number = number;

    this.object = createWatercraft(team);
    this.rider = createRider(team, number);
    this.object.userData.riderMount.add(this.rider);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();

    /** Raw controls, written by a driver before each step. */
    this.input = { steer: 0, throttle: 0, brake: 0, analog: false };
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;

    this.power = 0; // 0..5, earned at the slalom marks
    this.speedFactor = 1; // per-racer top speed scale (bots)
    this.speed = 0; // horizontal speed (m/s)
    this.forwardSpeed = 0;
    this.grip = 1; // 0 airborne .. 1 planted
    this.airborne = false;
    this.airTime = 0;
    this.waterY = 0;
    this.undisplacedX = 0; // sea-space coordinates under the stern (for wakes)
    this.undisplacedZ = 0;
    this.heave = 0; // smoothed vertical kick, for the rider's legs

    // rider animation state
    this._lean = 0;
    this._stand = 0;
    this._tuck = 0;

    /** One-shot events for effects / audio: 'land' (strength), 'bump' (strength). */
    this.events = [];
  }

  get maxSpeed() {
    const i = clamp(this.power, 0, T.speedAtPower.length - 1);
    const lo = Math.floor(i);
    const hi = Math.min(lo + 1, T.speedAtPower.length - 1);
    return lerp(T.speedAtPower[lo], T.speedAtPower[hi], i - lo) * this.speedFactor;
  }

  /** Teleport (grid, respawn). */
  place(x, z, yaw, time = 0, speed = 0) {
    sampleSurface(x, z, time, sMid);
    this.pos.set(x, sMid.y, z);
    this.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.yaw = yaw;
    this.pitch = this.roll = 0;
    this.yawRate = this.pitchRate = this.rollRate = 0;
    this.steer = this.throttle = this.brake = 0;
    this.airborne = false;
    this.airTime = 0;
    this.grip = 1;
    this.speed = Math.abs(speed);
    this.forwardSpeed = speed;
    this.heave = 0;
    this._syncQuat();
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.events.length = 0;
  }

  _syncQuat() {
    _euler.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.quat.setFromEuler(_euler);
  }

  step(dt, time) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);

    // ---- controls (keys ramp; a thumb is already analog)
    const inp = this.input;
    if (inp.analog) this.steer = damp(this.steer, inp.steer, 14, dt);
    else this.steer = approach(this.steer, inp.steer, (Math.abs(inp.steer) > Math.abs(this.steer) ? 3.6 : 6.0) * dt);
    this.throttle = damp(this.throttle, inp.throttle, 5.5, dt);
    this.brake = damp(this.brake, inp.brake, 9, dt);

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward (fx, fz) and port (lx, lz) unit vectors
    const fx = sy;
    const fz = cy;
    const lx = cy;
    const lz = -sy;
    const p = this.pos;
    const v = this.vel;

    // ---- the sea under the hull
    sampleSurface(p.x, p.z, time, sMid);
    sampleSurface(p.x + fx * 1.15, p.z + fz * 1.15, time, sBow);
    sampleSurface(p.x - fx * 1.05, p.z - fz * 1.05, time, sStern);
    sampleSurface(p.x + lx * 0.5, p.z + lz * 0.5, time, sPort);
    sampleSurface(p.x - lx * 0.5, p.z - lz * 0.5, time, sStbd);
    const waterY = sMid.y * 0.4 + (sBow.y + sStern.y) * 0.2 + (sPort.y + sStbd.y) * 0.1;
    this.waterY = waterY;
    this.undisplacedX = sStern.px;
    this.undisplacedZ = sStern.pz;

    // ---- heave: a one-sided spring (water pushes up, only gravity pulls down)
    const forward = v.x * fx + v.z * fz;
    const lateral = v.x * lx + v.z * lz;
    const planing = 0.1 * clamp01(Math.abs(forward) / 18);
    const depth = waterY + planing + FLOAT_DEPTH - p.y;
    const wasAir = this.airborne;
    let grip = 0;
    let ay = -T.gravity;
    if (depth > 0) {
      grip = clamp01(depth / (FLOAT_DEPTH * 0.9));
      // linear near the float line, stiffer once the deck starts going under
      const deep = Math.max(0, depth - FLOAT_DEPTH - 0.04);
      const vRel = v.y - sMid.vy;
      ay += T.buoyancy * Math.min(depth, 1.2) + T.deepBuoyancy * deep * deep - T.heaveDamping * vRel * grip;
      // slamming into the water sheds speed fast (drag ~ v²), so a hard landing
      // stops the hull near the surface instead of bouncing it back out
      if (vRel < 0 && depth > FLOAT_DEPTH) ay += T.slamDrag * vRel * vRel * clamp01((depth - FLOAT_DEPTH) / 0.12);
    }
    this.grip = grip;
    const vyBefore = v.y;
    v.y += ay * dt;
    this.heave = damp(this.heave, clamp(ay / T.gravity, -1.5, 3), 6, dt);

    if (depth > 0) {
      if (wasAir) {
        const impact = Math.max(0, sMid.vy - vyBefore);
        if (this.airTime > 0.16 && impact > 1.2) {
          this.events.push({ type: 'land', strength: clamp01(impact / 9), airTime: this.airTime });
          const loss = clamp(impact * 0.016, 0, 0.16);
          v.x *= 1 - loss;
          v.z *= 1 - loss;
        }
      }
      this.airborne = false;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      if (this.airTime > 0.05) this.airborne = true;
    }

    // ---- drive, drag and grip
    const vmax = this.maxSpeed;
    const c1 = T.linearDrag;
    const c2 = (T.thrust - c1 * vmax) / (vmax * vmax);
    const thrust = T.thrust * this.throttle * Math.sqrt(grip);
    const dragF = (c1 * forward + c2 * forward * Math.abs(forward)) * (0.12 + 0.88 * grip);
    const brakeF = this.brake * T.brakeDrag * clamp(forward / 3, -1, 1) * grip;
    // sliding sideways scrubs a little forward speed too
    const scrub = 0.1 * Math.abs(lateral) * clamp(forward / 4, -1, 1) * grip;
    const aF = thrust - dragF - brakeF - scrub;
    const aL = -T.lateralGrip * (1 + 0.6 * this.brake) * lateral * grip;
    // wave faces push the craft downhill
    const slope = T.slopePush * T.gravity * grip;
    const ax = fx * aF + lx * aL + (sMid.nx / sMid.ny) * slope;
    const az = fz * aF + lz * aL + (sMid.nz / sMid.ny) * slope;
    v.x += ax * dt;
    v.z += az * dt;

    // ---- steering
    const fwdAbs = Math.abs(forward);
    const authority = (0.3 + 0.7 * clamp01(fwdAbs / 6)) * lerp(1, 0.76, smoothstep(12, 28, fwdAbs)) * (1 + 0.28 * this.brake);
    const wantYawRate = -this.steer * T.yawRate * authority * (forward < -0.5 ? -1 : 1) * (0.22 + 0.78 * grip);
    this.yawRate = damp(this.yawRate, wantYawRate, grip > 0 ? 9 : 2, dt);
    this.yaw += this.yawRate * dt;

    // ---- attitude: follow the water, bank into turns, squat under power
    if (grip > 0) {
      const slopePitch = Math.atan2(sBow.y - sStern.y, 2.2);
      const slopeRoll = Math.atan2(sPort.y - sStbd.y, 1.0);
      const speedK = clamp01(this.speed / 20);
      const wantRoll = slopeRoll * 0.8 - this.yawRate * 0.46 * speedK;
      const wantPitch = slopePitch * 0.92 + 0.07 * this.throttle * (1 - clamp01(fwdAbs / vmax)) + 0.03 * clamp01(fwdAbs / 12) - 0.05 * this.brake * speedK;
      this.rollRate += (T.rollStiffness * (wantRoll - this.roll) - T.rollDamping * this.rollRate) * dt * grip;
      this.pitchRate += (T.pitchStiffness * (wantPitch - this.pitch) - T.pitchDamping * this.pitchRate) * dt * grip;
    }
    if (grip < 1) {
      // in the air the bow slowly drops and the hull levels out
      const air = 1 - grip;
      this.pitchRate += (-0.55 - 0.9 * this.pitchRate) * dt * air;
      this.rollRate += (-3.0 * this.roll - 1.6 * this.rollRate) * dt * air;
    }
    this.roll = clamp(this.roll + this.rollRate * dt, -1.0, 1.0);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -0.75, 0.85);

    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    this.speed = Math.hypot(v.x, v.z);
    this.forwardSpeed = forward;
    this._syncQuat();
  }

  /** Push out of a static circle; returns true on contact. */
  collideCircle(cx, cz, radius, bounce, soft) {
    const dx = this.pos.x - cx;
    const dz = this.pos.z - cz;
    const min = radius + T.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-6) return false;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const push = min - d;
    this.pos.x += nx * push * (soft ? 0.5 : 1);
    this.pos.z += nz * push * (soft ? 0.5 : 1);
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn < 0) {
      // soft things (marks) shoulder the craft aside; hard things stop and bounce it
      const k = (soft ? 0.5 : 1 + bounce) * vn;
      this.vel.x -= nx * k;
      this.vel.z -= nz * k;
      const loss = soft ? 0.9 : 0.72;
      this.vel.x *= loss;
      this.vel.z *= loss;
      if (vn < -1.5) this.events.push({ type: 'bump', strength: clamp01(-vn / 14) });
    }
    return true;
  }

  /** Keep off the beach: slide along the shore where the sea bed gets shallow. */
  collideTerrain(heightAt) {
    const limit = -0.55;
    const h = heightAt(this.pos.x, this.pos.z);
    if (h <= limit) return false;
    const e = 0.6;
    const gx = heightAt(this.pos.x + e, this.pos.z) - heightAt(this.pos.x - e, this.pos.z);
    const gz = heightAt(this.pos.x, this.pos.z + e) - heightAt(this.pos.x, this.pos.z - e);
    const g = Math.hypot(gx, gz);
    if (g < 1e-5) return false;
    const nx = -gx / g; // downhill = back toward deep water
    const nz = -gz / g;
    const slope = g / (2 * e);
    const push = Math.min((h - limit) / Math.max(slope, 0.05), 1.5);
    this.pos.x += nx * push;
    this.pos.z += nz * push;
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn < 0) {
      this.vel.x -= nx * vn * 1.25;
      this.vel.z -= nz * vn * 1.25;
      this.vel.x *= 0.9;
      this.vel.z *= 0.9;
      if (vn < -4) this.events.push({ type: 'bump', strength: clamp01(-vn / 14) });
    }
    return true;
  }

  /** Apply the interpolated pose to the model and animate the rider. */
  render(alpha, frameDt) {
    const o = this.object;
    o.position.lerpVectors(this.prevPos, this.pos, alpha);
    o.position.y += VISUAL_LIFT;
    o.quaternion.slerpQuaternions(this.prevQuat, this.quat, alpha);

    o.userData.handlebar.rotation.y = -this.steer * 0.5;
    const speedK = clamp01(this.speed / 22);
    this._lean = damp(this._lean, this.steer * (0.35 + 0.65 * speedK), 7, frameDt);
    const wantStand = this.airborne ? 1 : clamp01(Math.abs(this.heave - 1) * 0.5 - 0.1) * 0.8;
    this._stand = damp(this._stand, wantStand, this.airborne ? 9 : 4, frameDt);
    this._tuck = damp(this._tuck, this.throttle * speedK, 4, frameDt);
    this.rider.userData.pose({ lean: this._lean, steer: this.steer, stand: this._stand, tuck: this._tuck });
  }
}

/** Elastic-ish shove between two crafts. */
export function collideCrafts(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const min = T.radius * 2;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-6) return false;
  if (Math.abs(a.pos.y - b.pos.y) > 1.6) return false; // one is jumping over the other
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const push = (min - d) * 0.5;
  a.pos.x -= nx * push;
  a.pos.z -= nz * push;
  b.pos.x += nx * push;
  b.pos.z += nz * push;
  const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
  if (rel < 0) {
    const j = -(1 + 0.35) * rel * 0.5;
    a.vel.x -= nx * j;
    a.vel.z -= nz * j;
    b.vel.x += nx * j;
    b.vel.z += nz * j;
    if (rel < -1.2) {
      const s = clamp01(-rel / 10);
      a.events.push({ type: 'bump', strength: s });
      b.events.push({ type: 'bump', strength: s });
    }
  }
  return true;
}

/**
 * A craft simulated here bumping into one that is simulated on another machine
 * (online play). Only ours moves; the other machine does the same for its own.
 */
export function collideWithGhost(a, ghost) {
  const dx = a.pos.x - ghost.pos.x;
  const dz = a.pos.z - ghost.pos.z;
  const min = T.radius * 2;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-6) return false;
  if (Math.abs(a.pos.y - ghost.pos.y) > 1.6) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  a.pos.x += nx * (min - d);
  a.pos.z += nz * (min - d);
  const rel = (a.vel.x - ghost.vel.x) * nx + (a.vel.z - ghost.vel.z) * nz;
  if (rel < 0) {
    const j = -(1 + 0.35) * rel * 0.5;
    a.vel.x += nx * j;
    a.vel.z += nz * j;
    if (rel < -1.2) a.events.push({ type: 'bump', strength: clamp01(-rel / 10) });
  }
  return true;
}
