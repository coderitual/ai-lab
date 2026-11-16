// The camera rigs: chase, far chase, bonnet, bumper, look back, the title's
// orbit, the start sweep and the orbit behind the results.
//
// Two ideas hold it together. First, everything the rig remembers (the
// heading it has swung round to, the grade it has settled on, the spring of
// its distance, the shake's clock) moves in the fixed step and only there;
// the drawn frame interpolates between the last two steps and adds nothing
// with memory of its own, so a run skipped without drawing finds the same
// camera. Second, the chase camera is the car's position plus a damped
// OFFSET, never a chased position: the car holds its place in the frame at
// any speed while the offset swings late into bends, follows where the car
// is going more than where it points (a slide reads as a slide) and breathes
// with the throttle.
//
//   rig.update(dt, vehicle, track, ctx)  fixed step; ctx { impacts, sweep (0..1 the start sweep, 1 when done),
//                                        finished (the car has taken the flag), clock (race clock or null) }
//   rig.apply(camera, alpha)             per drawn frame: pose and lens
//   rig.snap(vehicle)                    jump to where it should be; sets `cut`
//   rig.setMode(mode)                    'chase' | 'far' | 'bonnet' | 'bumper' | 'orbit' (a cut)
//   rig.lookBack                         held: look out of the back (a cut each way)
//   rig.cut                              the next frame must not be blurred from the last
//   rig.setAspect(aspect)                the shape of the view's rectangle

import * as THREE from 'three';
import { angleDiff, clamp, clamp01, damp, lerp, smoothstep } from '../engine/math.js';
import { createRng } from '../engine/rng.js';
import { STATIONS, VIEWPOINTS } from '../assets/car/spec.js';
import { TUNNEL } from './trackLayout.js';
import { CAMERA } from './config.js';

const G = 9.81;
const NOISE = 256;

// the rig's memory, one slot each; a copy of the last step's is kept for drawing between steps
const YAW = 0; // the heading the chase camera sits behind (rad)
const BEND = 1; // how far it looks into the coming bend (rad, + = left)
const Y = 2; // the car's height as the camera follows it (m)
const GRADE = 3; // the road's grade as the camera has settled on it (rise per metre)
const FEEL = 4; // the eased speed signal 0..1 that every "fast" cue reads
const PULL = 5; // the distance spring's displacement (m, + = further back) ...
const PULLV = 6; // ... and its velocity
const ROLL = 7; // roll of the picture (rad)
const TRAUMA = 8; // impact shake 0..1
const VERGE = 9; // how many wheels are off the asphalt, eased 0..1
const TIME = 10; // the rig's own clock (s of simulated time): the shake's noise is read at it
const SWEEP = 11; // the start sweep 0..1
const BLEND = 12; // the results orbit blended in 0..1
const ORBIT = 13; // the orbit's angle round the car (rad, from straight behind)
const ORBITY = 14; // its height drift phase
const LEAN = 15; // the bonnet's damped pitch and roll against the body (rad)
const LEANR = 16;
const SLOTS = 17;

const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const eye = new THREE.Vector3();
const target = new THREE.Vector3();
const eye2 = new THREE.Vector3();
const target2 = new THREE.Vector3();
const v = new THREE.Vector3();
const fwd = new THREE.Vector3();
const euler = new THREE.Euler();
const qMount = new THREE.Quaternion();
const spot = { index: 0, s: 0, lat: 0 };
const prof = { y: 0, surface: 0 };
const frame = {};
const path = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');

/** Smoothstep's smoother sibling: zero speed and zero acceleration at both ends. */
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class CameraRig {
  /**
   * @param {'chase'|'far'|'bonnet'|'bumper'|'orbit'} [mode]
   * @param {import('../engine/rng.js').Rng} [rng] where the shake's noise comes from (a fork per view)
   */
  constructor(mode = 'chase', rng = createRng(7)) {
    this.mode = mode;
    this.lookBack = false;
    this.aspect = 16 / 9;
    this.cut = true;
    /** @type {import('./vehicle/Vehicle.js').Vehicle|null} */
    this.vehicle = null;
    /** @type {import('./track.js').Track|null} */
    this.track = null;
    this.now = new Float64Array(SLOTS);
    this.was = new Float64Array(SLOTS);
    /** The start sweep goes round the side of the car towards the middle of the road: -1 its right, +1 its left. */
    this.side = -1;
    this._wasBack = false;
    this._hint = -1;
    this._speed = 0;
    this._alpha = 1;
    this._noise = new Float32Array(NOISE);
    for (let i = 0; i < NOISE; i++) this._noise[i] = rng.range(-1, 1);
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

  /**
   * Jump straight to where the camera belongs: no memory of where it was.
   * @param {number} [sweep] where the start sweep stands (0 at a new run's start; 1: no sweep)
   */
  snap(vehicle, sweep = 1) {
    this.vehicle = vehicle;
    const s = this.now;
    s.fill(0);
    s[YAW] = vehicle.yaw;
    s[Y] = vehicle.position.y;
    s[SWEEP] = sweep;
    // the title's orbit starts on the rear three-quarter view, on the side towards the middle of the road
    this.side = vehicle.lat > 0 ? -1 : 1;
    s[ORBIT] = this.side * 0.75;
    this._speed = vehicle.speed;
    this._hint = -1;
    this.was.set(s);
    this.cut = true;
  }

  /**
   * One fixed step.
   * @param {number} dt
   * @param {import('./vehicle/Vehicle.js').Vehicle} vehicle
   * @param {import('./track.js').Track} [track]
   * @param {{ impacts?: Array<{ strength: number }>, sweep?: number, finished?: boolean }} [ctx]
   */
  update(dt, vehicle, track, ctx = {}) {
    this.vehicle = vehicle;
    this.track = track || null;
    const c = CAMERA.chase;
    const s = this.now;
    this.was.set(s);
    s[TIME] += dt;

    // where the car is going, and how much of that the camera takes up over where it points
    const speed = vehicle.speed;
    const hspeed = Math.hypot(vehicle.velocity.x, vehicle.velocity.z);
    const travel = speed > 4 ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z) : vehicle.yaw;
    const behind = vehicle.yaw + angleDiff(vehicle.yaw, travel) * c.slide;
    s[YAW] += angleDiff(s[YAW], behind) * (1 - Math.exp(-c.yawRate * dt));

    // the bend coming up: how far the road turns over the next stretch, plus how fast the car is turning now
    let bend = 0;
    if (track && speed > 2) {
      const n = track.count;
      const reach = clamp(c.bendReach * (0.4 + Math.abs(speed) / 30), 10, 45);
      const i0 = Math.floor(track.wrap(vehicle.s) / track.ds);
      const steps = Math.max(1, Math.round(reach / track.ds));
      let turn = 0;
      for (let k = 0; k < steps; k++) turn += track.curvature[(i0 + k) % n] * track.ds * (1 - k / steps);
      bend = turn * c.bendRoad + clamp(vehicle.angularVelocity.y, -1.2, 1.2) * c.bendYawRate;
      bend = clamp(bend, -c.bendMax, c.bendMax) * smoothstep(2, 10, speed);
    }
    s[BEND] = damp(s[BEND], bend, c.bendRate, dt);

    // height: followed with a little lag, the steady part of a slope fed forward so a long climb leaves no lag
    const vy = vehicle.velocity.y;
    s[Y] = damp(s[Y], vehicle.position.y + vy / c.heightRate, c.heightRate, dt);
    s[Y] = clamp(s[Y], vehicle.position.y - c.heightSlack, vehicle.position.y + c.heightSlack);
    const grade = hspeed > 3 ? clamp(vy / hspeed, -0.3, 0.3) : s[GRADE];
    s[GRADE] = damp(s[GRADE], grade, c.gradeRate, dt);

    // one eased speed signal for every "fast" cue
    s[FEEL] = damp(s[FEEL], smoothstep(c.slowSpeed, c.fastSpeed, Math.abs(speed)), 1 / c.feelTime, dt);

    // the distance breathes with the throttle and the brakes: a spring driven by the car's acceleration
    const accel = (speed - this._speed) / dt;
    this._speed = speed;
    const want = clamp(accel / G, -1.2, 0.8) * c.pullPerG;
    const w = c.pullOmega;
    s[PULLV] += (-w * w * (s[PULL] - want) - 2 * c.pullDamping * w * s[PULLV]) * dt;
    s[PULL] += s[PULLV] * dt;
    s[PULL] = clamp(s[PULL], -0.6, 0.6);

    // roll: a share of the body's (the road's bank included), and a little of the turn
    v.set(1, 0, 0).applyQuaternion(vehicle.quaternion);
    const bodyRoll = Math.asin(clamp(v.y, -1, 1));
    const roll = clamp(bodyRoll * c.rollShare - vehicle.angularVelocity.y * c.rollYawRate, -0.06, 0.06);
    s[ROLL] = damp(s[ROLL], roll, c.rollRate, dt);

    // shake: the verge under the wheels, and the knocks
    let off = 0;
    for (const wheel of vehicle.wheels) if (wheel.grounded !== false && wheel.surface) off += 0.25;
    s[VERGE] = damp(s[VERGE], off, 8, dt);
    let hit = 0;
    for (const impact of ctx.impacts || []) hit = Math.max(hit, impact.strength);
    if (hit > 0.5) {
      const t = clamp01(hit / CAMERA.shake.impactFull);
      s[TRAUMA] = Math.max(s[TRAUMA], t);
      s[PULLV] -= CAMERA.shake.kick * t * w;
    }
    s[TRAUMA] = Math.max(0, s[TRAUMA] - dt / CAMERA.shake.decay);

    // the bonnet: firm to the body, pitch and roll against the heading damped a little
    euler.setFromQuaternion(vehicle.quaternion, 'YXZ');
    s[LEAN] = damp(s[LEAN], euler.x, CAMERA.bonnet.firm, dt);
    s[LEANR] = damp(s[LEANR], euler.z, CAMERA.bonnet.firm, dt);

    // the start sweep, read off the race clock; the orbit behind the results blended in from the chase view
    const sweep = ctx.sweep ?? 1;
    // a sweep that begins is a cut; one that ends in a camera fixed to the car is one too
    if (sweep < 1 && this.was[SWEEP] >= 1) this.cut = true;
    if (sweep >= 1 && this.was[SWEEP] < 1 && this.mode !== 'chase' && this.mode !== 'far') this.cut = true;
    s[SWEEP] = sweep;
    const mounted = this.mode === 'bonnet' || this.mode === 'bumper';
    // after the flag: blended in from the chase view, or cut to from a camera fixed to the car
    if (ctx.finished && s[BLEND] === 0 && mounted) {
      s[BLEND] = this.was[BLEND] = 1;
      this.cut = true;
    }
    s[BLEND] = ctx.finished ? Math.min(1, s[BLEND] + dt / CAMERA.results.blend) : 0;

    // the orbits: slower over the three-quarter views
    const o = this.mode === 'orbit' ? CAMERA.orbit : CAMERA.results;
    if (this.mode === 'orbit' || s[BLEND] > 0) {
      s[ORBIT] += o.rate * (1 - o.linger * Math.abs(Math.sin(2 * s[ORBIT]))) * dt;
      s[ORBITY] += dt;
    }

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
    const a = this.was;
    const b = this.now;
    const at = (i) => a[i] + (b[i] - a[i]) * alpha;
    this._alpha = alpha;
    p.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
    q.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);
    camera.up.set(0, 1, 0);
    let fov;
    let shake = 0;
    let roll = 0;

    if (this.mode === 'orbit') {
      fov = this._orbit(camera, at(ORBIT), at(ORBITY), CAMERA.orbit);
    } else if ((this.mode === 'bonnet' || this.mode === 'bumper') && at(SWEEP) >= 1 && at(BLEND) === 0) {
      fov = this._mounted(camera, at);
      shake = 0.5;
    } else {
      fov = this._chase(eye, target, at);
      shake = 1;
      roll = at(ROLL);
      const sweep = at(SWEEP);
      if (sweep < 1) {
        fov = this._sweep(eye, target, fov, sweep);
        shake = roll = 0;
      }
      const blend = at(BLEND);
      if (blend > 0) {
        const fo = this._orbit(null, at(ORBIT), at(ORBITY), CAMERA.results);
        const t = ease(blend);
        eye.lerp(eye2, t);
        target.lerp(target2, t);
        fov = lerp(fov, fo, t);
        shake *= 1 - t;
        roll *= 1 - t;
      }
      this._keepClear(eye, vehicle);
      camera.position.copy(eye);
      camera.lookAt(target);
    }

    // shake: smooth noise of the rig's own clock, mostly turning, a little moving
    if (shake > 0) {
      const t = at(TIME);
      const trauma = at(TRAUMA);
      const feel = at(FEEL);
      const sh = CAMERA.shake;
      const road = feel * (sh.road + sh.verge * at(VERGE)) * shake;
      const knock = trauma * trauma * sh.impact * shake;
      const yawN = road * this._n(t * sh.roadHz) + knock * this._n(t * sh.impactHz + 40);
      const pitchN = road * this._n(t * sh.roadHz + 80) + knock * this._n(t * sh.impactHz + 120);
      const rollN = 0.5 * knock * this._n(t * sh.impactHz + 160);
      camera.rotateY(yawN);
      camera.rotateX(pitchN);
      roll += rollN;
      if (knock > 0) camera.translateY(knock * sh.impactMove * this._n(t * sh.impactHz + 200) / sh.impact);
    }
    if (roll) camera.rotateZ(roll);

    // a picture narrower than 4:3 keeps the width of view a 4:3 one would have, and grows taller instead; one wider
    // than 16:9 (a stacked half) keeps the width of a 16:9 one, and grows shorter
    const L = CAMERA.lens;
    if (this.aspect < L.narrow || this.aspect > L.wide) {
      const hold = this.aspect < L.narrow ? L.narrow : L.wide;
      const half = Math.atan((Math.tan((fov * Math.PI) / 360) * hold) / this.aspect);
      fov = Math.min(L.max, (half * 360) / Math.PI);
    }
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- the rigs

  /** How much narrower than 4:3 (1 at a phone held upright) and how much wider than 16:9 (1 at a stacked half). */
  _shape() {
    const L = CAMERA.lens;
    return {
      narrow: clamp01((L.narrow - this.aspect) / (L.narrow - 0.46)),
      wide: clamp01((this.aspect - L.wide) / (3.55 - L.wide)),
    };
  }

  /** The chase and far chase cameras (and looking back from them): eye and target, returns the lens. */
  _chase(eyeOut, targetOut, at) {
    const c = CAMERA.chase;
    const m = this.mode === 'far' ? CAMERA.far : c;
    const { narrow, wide } = this._shape();
    const back = this.lookBack;
    const feel = at(FEEL);
    const bend = back ? 0 : at(BEND);
    const yaw = this.was[YAW] + angleDiff(this.was[YAW], this.now[YAW]) * this._alpha + (back ? Math.PI : 0);
    const grade = (back ? -1 : 1) * at(GRADE);
    const y = at(Y);
    const distance = (m.distance + feel * c.pullBack + at(PULL)) * lerp(1, c.narrowBack, narrow) * lerp(1, c.wideBack, wide);
    const height = (m.height - feel * c.drop) * lerp(1, c.narrowLift, narrow) * lerp(1, c.wideLift, wide);
    // behind the car along the swung heading, a little to the inside of the bend
    const bx = Math.sin(yaw);
    const bz = Math.cos(yaw);
    const side = bend * c.inside;
    eyeOut.set(p.x - bx * distance + bz * side, y + height - grade * distance, p.z - bz * distance - bx * side);
    // looking at a point ahead, turned into the bend
    const ly = yaw + bend;
    const ahead = m.lookAhead * lerp(1, c.narrowAhead, narrow);
    targetOut.set(p.x + Math.sin(ly) * ahead, y + m.lookHeight * lerp(1, c.narrowLook, narrow) + grade * ahead, p.z + Math.cos(ly) * ahead);
    return lerp(c.fov, c.fovFast, feel);
  }

  /** The start sweep: from a low front three-quarter view, along the car's side, into the chase view. */
  _sweep(eyeOut, targetOut, fov, u) {
    const sw = CAMERA.sweep;
    const k = ease(clamp01(u));
    const x = this.side;
    const pts = sw.path;
    for (let i = 0; i < 4; i++) path[i].set(pts[i][0] * x, pts[i][1], pts[i][2]).applyQuaternion(q).add(p);
    path[4].copy(eyeOut);
    curve.getPoint(k, eyeOut);
    // the look moves from the car's middle to the chase camera's point ahead
    v.set(0, sw.lookHeight, sw.lookZ).applyQuaternion(q).add(p);
    targetOut.lerpVectors(v, targetOut, smoothstep(0.35, 1, k));
    return lerp(sw.fov, fov, smoothstep(0.3, 1, k));
  }

  /** The bonnet and bumper cameras: fixed to the body, its pitch and roll followed a little softly. */
  _mounted(camera, at) {
    const m = CAMERA[this.mode];
    const vp = VIEWPOINTS[this.mode];
    const back = this.lookBack;
    // looking back from the bonnet or the bumper: at the same height, over the boot lid or behind the rear bumper
    const z = back ? STATIONS.tail + (this.mode === 'bumper' ? -0.03 : 0.3) : vp.z;
    euler.setFromQuaternion(q, 'YXZ');
    euler.x = at(LEAN);
    euler.z = at(LEANR);
    const qq = qMount.setFromEuler(euler);
    eye.set(vp.x, vp.y, z).applyQuaternion(qq).add(p);
    fwd.set(0, m.lookDown, back ? -1 : 1).normalize().applyQuaternion(qq);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0).applyQuaternion(qq);
    camera.lookAt(target.copy(eye).add(fwd));
    return lerp(m.fov, m.fovFast, at(FEEL));
  }

  /**
   * An orbit round the car at about eye height. With a camera, poses it (the title); without, leaves the eye and
   * target in eye2 / target2 for blending (the results).
   */
  _orbit(camera, angle, drift, o) {
    const { narrow } = this._shape();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const a = yaw + Math.PI + angle;
    const r = lerp(o.near, o.far, 0.5 + 0.5 * Math.sin(drift * o.driftRate)) * lerp(1, o.narrowBack, narrow);
    const h = lerp(o.low, o.high, 0.5 + 0.5 * Math.sin(drift * o.driftRate * 0.71 + 1.3));
    eye2.set(p.x + Math.sin(a) * r, p.y + h, p.z + Math.cos(a) * r);
    target2.set(p.x, p.y + o.lookHeight, p.z);
    if (camera) {
      this._keepClear(eye2, this.vehicle);
      camera.position.copy(eye2);
      camera.lookAt(target2);
    }
    return o.fov;
  }

  /**
   * Never through a wall, a rock face, a parapet, the tunnel's roof or the ground: the eye is kept inside the
   * road's corridor (pushed in across the road, so the picture slides rather than jumps) and between the ground
   * and the roof.
   */
  _keepClear(e, vehicle) {
    const track = this.track;
    if (!track) return;
    const k = CAMERA.clear;
    track.locate(e.x, e.z, this._hint, spot);
    this._hint = spot.index;
    const hi = Math.max(track.edgeAt(spot.s, 1) - k.wall, Math.min(vehicle.lat, track.halfWidth));
    const lo = Math.min(-track.edgeAt(spot.s, -1) + k.wall, Math.max(vehicle.lat, -track.halfWidth));
    const lat = clamp(spot.lat, lo, hi);
    if (lat !== spot.lat) {
      track.frameAt(spot.s, frame);
      const d = lat - spot.lat;
      e.x += frame.left.x * d;
      e.z += frame.left.z * d;
    }
    track.profile(spot.s, lat, prof);
    if (e.y < prof.y + k.ground) e.y = prof.y + k.ground;
    for (const t of track.tunnels) {
      if (spot.s > t.s0 - k.portal && spot.s < t.s1 + k.portal) {
        track.profile(spot.s, 0, prof);
        e.y = Math.min(e.y, prof.y + TUNNEL.height - k.roof);
      }
    }
  }

  /** Smooth noise -1..1 of x: values on whole numbers, eased between. */
  _n(x) {
    const i = Math.floor(x);
    const f = x - i;
    const n = this._noise;
    const u = f * f * (3 - 2 * f);
    return n[i & (NOISE - 1)] * (1 - u) + n[(i + 1) & (NOISE - 1)] * u;
  }
}
