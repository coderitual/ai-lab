// One race boat: arcade physics on top of the simulated sea, plus the model.
//
// Conventions: yaw = rotation about +Y, forward = (sin yaw, 0, cos yaw);
// +yaw turns to port (left). pitch > 0 = bow up, roll > 0 = starboard down.
// Controls: steer -1 (left) .. +1 (right), throttle 0..1, brake 0..1.

import * as THREE from 'three';
import { createBoat } from '../assets/boat.js';
import { approach, clamp, clamp01, damp, lerp, smoothstep } from '../engine/math.js';
import { makeSurfaceSample, sampleSurface } from '../engine/waves.js';
import { CRAFT_TUNE as T, HULL } from './config.js';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const sMid = makeSurfaceSample();
const RAMP_HIT = { y: 0, slope: 0, dirX: 0, dirZ: 1 };
/** Where the hull meets the water: under each end of each hull ([to port, forward], m). */
const FLOATS = [
  [HULL.beam, HULL.bow],
  [-HULL.beam, HULL.bow],
  [HULL.beam, -HULL.stern],
  [-HULL.beam, -HULL.stern],
];
const floats = FLOATS.map(() => makeSurfaceSample());

const FLOAT_DEPTH = T.gravity / T.buoyancy; // how far below the float line gravity is balanced
// How stiffly the four points hold the hull level (1/s²): a push of this times an
// angle is what it takes to hold the hull at that angle (used for trim and bank).
const PITCH_SPRING = (T.buoyancy * (HULL.bow * HULL.bow + HULL.stern * HULL.stern)) / 2 / T.pitchInertia;
const ROLL_SPRING = (T.buoyancy * HULL.beam * HULL.beam) / T.rollInertia;

export class Craft {
  constructor({ team, number }) {
    this.team = team;
    this.number = number;

    this.object = createBoat(team, number);

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
    this.slip = 0; // angle between where the bows point and where the boat is going (> 0: sliding to port)
    this.boost = 0; // seconds of boost left (a pad, a ramp, a nitro cell)
    this.boostK = 0; // how hard it is boosting right now, 0..1 (eased in and out)
    this.onRamp = false;
    /** Set by the game: (x, z, out) => true if there is a ramp there, with its surface in `out`. */
    this.rampAt = null;

    /** One-shot events for effects / audio: 'land' (strength), 'bump' (strength), 'boost' (strength). */
    this.events = [];
  }

  get maxSpeed() {
    const i = clamp(this.power, 0, T.speedAtPower.length - 1);
    const lo = Math.floor(i);
    const hi = Math.min(lo + 1, T.speedAtPower.length - 1);
    return lerp(T.speedAtPower[lo], T.speedAtPower[hi], i - lo) * this.speedFactor;
  }

  /** A push: at least `seconds` of boost from now. `strength` 0..1 says how big a moment it is (for effects). */
  addBoost(seconds, strength = 0.5) {
    if (this.boost < 0.25) this.events.push({ type: 'boost', strength });
    if (seconds > this.boost) this.boost = seconds;
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
    this.boost = 0;
    this.boostK = 0;
    this.speed = Math.abs(speed);
    this.forwardSpeed = speed;
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

    // ---- the sea under the hull: four points, one under each end of each hull.
    // Each is pushed up by the water it is in (and by nothing when it is out of
    // it: water pushes, only gravity pulls). Their sum lifts the boat; their
    // differences pitch and roll it. Nothing tells the hull what attitude to
    // take: it lies on the water because that is where the forces balance, and
    // it comes down tails first, or one hull first, because that is what happened.
    const forward = v.x * fx + v.z * fz;
    const lateral = v.x * lx + v.z * lz;
    const fwdAbs = Math.abs(forward);
    const planing = T.planing * clamp01(fwdAbs / 18);
    const sinPitch = Math.sin(this.pitch);
    const sinRoll = Math.sin(this.roll);
    let lift = 0; // m/s² upward, all four together
    let pitchPush = 0; // their turning effect, bow up
    let rollPush = 0; // and port side up
    let wet = 0; // how many of the four are in the water, by depth
    let wetAft = 0; // and of the two under the tails
    let level = 0;
    let impact = 0;
    let nx = 0;
    let nz = 0;
    let ny = 0;
    let sternX = 0;
    let sternZ = 0;
    let ramp = false;
    for (let i = 0; i < 4; i++) {
      const ox = FLOATS[i][0];
      const oz = FLOATS[i][1];
      const w = floats[i];
      const sx = p.x + lx * ox + fx * oz;
      const sz = p.z + lz * ox + fz * oz;
      sampleSurface(sx, sz, time, w);
      // a ramp, where there is one above the water: a surface that does not give, rising under the boat as it runs up
      if (this.rampAt && this.rampAt(sx, sz, RAMP_HIT) && RAMP_HIT.y > w.y) {
        w.y = RAMP_HIT.y;
        w.vy = RAMP_HIT.slope * Math.max(0, v.x * RAMP_HIT.dirX + v.z * RAMP_HIT.dirZ);
        w.nx = 0;
        w.ny = 1;
        w.nz = 0;
        ramp = true;
      }
      level += w.y;
      if (oz < 0) {
        // (the two under the tails also say where the wake starts, in the water's own frame)
        sternX += w.px - lx * ox;
        sternZ += w.pz - lz * ox;
      }
      // where this bit of the keel is, and how fast it is moving up or down
      const keel = p.y + oz * sinPitch + ox * sinRoll - HULL.draft;
      const depth = w.y + planing - keel;
      if (depth <= 0) continue;
      const rise = v.y + oz * this.pitchRate + ox * this.rollRate - w.vy;
      const hold = clamp01(depth / (FLOAT_DEPTH * 0.9));
      // linear near the float line, stiffer once the deck starts going under
      const deep = Math.max(0, depth - FLOAT_DEPTH - 0.04);
      let f = T.buoyancy * Math.min(depth, 1.2) + T.deepBuoyancy * deep * deep - T.heaveDamping * rise * hold;
      // driving down into the water sheds speed fast (drag ~ v²), so a hard landing
      // is stopped near the surface instead of being bounced back out
      if (rise < 0 && depth > FLOAT_DEPTH) f += T.slamDrag * rise * rise * clamp01((depth - FLOAT_DEPTH) / 0.12);
      lift += f;
      pitchPush += f * oz;
      rollPush += f * ox;
      wet += hold;
      if (oz < 0) wetAft += hold;
      if (-rise > impact) impact = -rise;
      nx += w.nx * hold;
      ny += w.ny * hold;
      nz += w.nz * hold;
    }
    lift *= 0.25;
    pitchPush *= 0.25;
    rollPush *= 0.25;
    this.waterY = level * 0.25;
    this.undisplacedX = sternX * 0.5;
    this.undisplacedZ = sternZ * 0.5;
    // 0 in the air .. 1 sitting in the water; the tails matter for drive and helm
    const grip = clamp01(wet * 0.25);
    const gripAft = clamp01(wetAft * 0.5);
    this.grip = grip;
    this.onRamp = ramp;
    // boost runs down, and its push comes in and goes out smoothly
    this.boost = Math.max(0, this.boost - dt);
    this.boostK = damp(this.boostK, this.boost > 0 ? 1 : 0, this.boost > 0 ? 7 : 2.2, dt);

    const wasAir = this.airborne;
    v.y += (lift - T.gravity) * dt;
    if (wet > 0) {
      if (wasAir && this.airTime > 0.16 && impact > 1.4) {
        this.events.push({ type: 'land', strength: clamp01((impact - 0.6) / 10), airTime: this.airTime });
        const loss = clamp(impact * 0.014, 0, 0.14);
        v.x *= 1 - loss;
        v.z *= 1 - loss;
      }
      this.airborne = false;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      if (this.airTime > 0.05) this.airborne = true;
    }

    // ---- drive and drag
    // (boosting, the engines push harder and the boat tops out faster, whatever the throttle is doing)
    const vmax = this.maxSpeed * (1 + T.boostSpeed * this.boostK);
    const push = T.thrust * (1 + T.boostThrust * this.boostK);
    const c1 = T.linearDrag;
    const c2 = (push - c1 * vmax) / (vmax * vmax);
    const thrust = push * Math.max(this.throttle, 0.92 * this.boostK) * Math.sqrt(gripAft);
    const dragF = (c1 * forward + c2 * forward * fwdAbs) * (0.12 + 0.88 * grip);
    const brakeF = this.brake * T.brakeDrag * clamp(forward / 3, -1, 1) * Math.sqrt(grip);
    // ---- going sideways. The hulls bite hard at first and then let go: past a
    // point the water gives no more, the stern steps out, and the boat drifts.
    // (Braking digs the hulls in: more bite, and more to give.)
    const most = T.sideHold * (1 + 0.35 * this.brake) * grip;
    const aL = most > 0 ? -most * Math.tanh((T.sideBite * lateral) / most) : 0;
    // sliding scrubs off a little speed too
    const scrub = T.slideScrub * Math.abs(lateral) * clamp(forward / 4, -1, 1) * grip;
    const aF = thrust - dragF - brakeF - scrub;
    // wave faces push the boat downhill
    const slope = ny > 0.01 ? (T.slopePush * T.gravity * grip) / ny : 0;
    v.x += (fx * aF + lx * aL + nx * slope) * dt;
    v.z += (fz * aF + lz * aL + nz * slope) * dt;

    // ---- steering. The helm asks for a rate of turn; a hull going sideways
    // wants to point the way it is going, which is what stops a drift becoming
    // a spin and straightens the boat when the helm is let go.
    const slip = fwdAbs > 2 || Math.abs(lateral) > 2 ? Math.atan2(lateral, Math.max(fwdAbs, 3)) : 0; // > 0: sliding to port
    this.slip = slip;
    const authority = (0.3 + 0.7 * clamp01(fwdAbs / 6)) * lerp(1, 0.8, smoothstep(12, 28, fwdAbs)) * (1 + 0.3 * this.brake);
    const helm = -this.steer * T.yawRate * authority * (forward < -0.5 ? -1 : 1) * (0.22 + 0.78 * gripAft);
    const weathercock = T.yawAlign * slip * clamp01(this.speed / 10) * grip * (1 - 0.45 * this.brake);
    this.yawRate = damp(this.yawRate, helm + weathercock, grip > 0 ? 8 : 2, dt);
    this.yaw += this.yawRate * dt;

    // ---- attitude. On the water: the push of the four points, plus what
    // driving does (bows lift under power and at speed, dip under braking;
    // the hull leans a little into a turn).
    const speedK = clamp01(this.speed / 20);
    const inWater = clamp01(wet * 0.5);
    const trim = 0.055 * this.throttle * (1 - clamp01(fwdAbs / vmax)) + 0.04 * clamp01(fwdAbs / 12) - 0.04 * this.brake * speedK;
    const bank = -this.yawRate * T.bank * speedK;
    this.pitchRate += (pitchPush / T.pitchInertia + PITCH_SPRING * trim * inWater) * dt;
    this.rollRate += (rollPush / T.rollInertia + ROLL_SPRING * bank * inWater) * dt;
    if (inWater < 1) {
      // in the air the hull levels out and flies a little bow-up, on the air packed
      // under the tunnel: it comes down on its tails first
      const air = 1 - inWater;
      this.pitchRate += (2.6 * (0.07 - this.pitch) - 1.8 * this.pitchRate) * dt * air;
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
    // the hull is a row of circles: take the one that is deepest in
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const min = radius + T.radius;
    let push = 0;
    let nx = 0;
    let nz = 0;
    for (const along of HULL.circles) {
      const dx = this.pos.x + fx * along - cx;
      const dz = this.pos.z + fz * along - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      if (min - d > push) {
        push = min - d;
        nx = dx / d;
        nz = dz / d;
      }
    }
    if (push <= 0) return false;
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
    // whichever part of the hull is over the shallowest water
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let h = -Infinity;
    let x = 0;
    let z = 0;
    for (const along of HULL.circles) {
      const px = this.pos.x + fx * along * 1.4;
      const pz = this.pos.z + fz * along * 1.4;
      const here = heightAt(px, pz);
      if (here > h) {
        h = here;
        x = px;
        z = pz;
      }
    }
    if (h <= limit) return false;
    const e = 0.6;
    const gx = heightAt(x + e, z) - heightAt(x - e, z);
    const gz = heightAt(x, z + e) - heightAt(x, z - e);
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

  /** Apply the interpolated pose to the model, and light the turbine as hard as it is being asked to burn. */
  render(alpha, frameDt = 0, time = 0) {
    const o = this.object;
    o.position.lerpVectors(this.prevPos, this.pos, alpha);
    o.quaternion.slerpQuaternions(this.prevQuat, this.quat, alpha);
    o.userData.setThrust(Math.max(this.throttle, 0.9 * this.boostK), this.boostK, time);
  }
}

const _hit = { push: 0, nx: 0, nz: 0 };

/** Where two hulls (rows of circles) overlap most: how far, and the direction from a to b. */
function overlap(a, b, out) {
  const ax = Math.sin(a.yaw);
  const az = Math.cos(a.yaw);
  const bx = Math.sin(b.yaw);
  const bz = Math.cos(b.yaw);
  const min = T.radius * 2;
  out.push = 0;
  for (const i of HULL.circles) {
    for (const j of HULL.circles) {
      const dx = b.pos.x + bx * j - (a.pos.x + ax * i);
      const dz = b.pos.z + bz * j - (a.pos.z + az * i);
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      if (min - d > out.push) {
        out.push = min - d;
        out.nx = dx / d;
        out.nz = dz / d;
      }
    }
  }
  return out.push > 0;
}

/** Elastic-ish shove between two crafts. */
export function collideCrafts(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const reach = T.radius * 2 + 2 * HULL.circles[HULL.circles.length - 1];
  if (dx * dx + dz * dz >= reach * reach) return false;
  if (Math.abs(a.pos.y - b.pos.y) > 1.6) return false; // one is jumping over the other
  if (!overlap(a, b, _hit)) return false;
  const nx = _hit.nx;
  const nz = _hit.nz;
  const push = _hit.push * 0.5;
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
  const reach = T.radius * 2 + 2 * HULL.circles[HULL.circles.length - 1];
  if (dx * dx + dz * dz >= reach * reach) return false;
  if (Math.abs(a.pos.y - ghost.pos.y) > 1.6) return false;
  if (!overlap(ghost, a, _hit)) return false;
  const nx = _hit.nx; // from the ghost toward us
  const nz = _hit.nz;
  a.pos.x += nx * _hit.push;
  a.pos.z += nz * _hit.push;
  const rel = (a.vel.x - ghost.vel.x) * nx + (a.vel.z - ghost.vel.z) * nz;
  if (rel < 0) {
    const j = -(1 + 0.35) * rel * 0.5;
    a.vel.x += nx * j;
    a.vel.z += nz * j;
    if (rel < -1.2) a.events.push({ type: 'bump', strength: clamp01(-rel / 10) });
  }
  return true;
}
