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
import { SURFACE } from './track.js';
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
const KERB = 17; // how many wheels are on a kerb, eased 0..1
const ACCEL = 18; // the car's acceleration along its path, low-passed (m/s2): what the distance spring is driven by
const BANK = 19; // the road's bank under the car as the picture has taken it up (rad)
const GRID = 20; // 0..1: how much of the grid's low look up at the start lamps is in (read off the race clock)
const SLOTS = 21;

const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const eye = new THREE.Vector3();
const target = new THREE.Vector3();
const eye2 = new THREE.Vector3();
const target2 = new THREE.Vector3();
const fwd2 = new THREE.Vector3();
const v = new THREE.Vector3();
const fwd = new THREE.Vector3();
const euler = new THREE.Euler();
const qMount = new THREE.Quaternion();
const spot = { index: 0, s: 0, lat: 0 };
const prof = { y: 0, surface: 0 };
const frame = {};
const bankFrame = {};

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
    /** The staging camera's pose ({ back, right, up, yaw, pitch, fov }) or null: see _photo. */
    this.photo = null;
    this._noise = new Float32Array(NOISE);
    for (let i = 0; i < NOISE; i++) this._noise[i] = rng.range(-1, 1);
  }

  /** 0..1: how far the start's dive has settled into the camera fixed behind the car (1: not diving). */
  get settled() {
    return smoothstep(0.8, 1, this.now[SWEEP]);
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

    // one eased speed signal for every "fast" cue: the lens, the pull-back, the shake (eased: no pumping on a shift)
    s[FEEL] = damp(s[FEEL], smoothstep(c.slowSpeed, c.fastSpeed, Math.abs(speed)), 1 / c.feelTime, dt);

    // the distance breathes with the throttle and the brakes: a spring driven by the car's acceleration, itself
    // low-passed so that the dip of a gear change does not show
    const accel = (speed - this._speed) / dt;
    this._speed = speed;
    s[ACCEL] = damp(s[ACCEL], clamp(accel, -3 * G, 3 * G), 1 / c.accelTime, dt);
    const want = clamp(s[ACCEL] / G, -1.2, 0.8) * c.pullPerG;
    const w = c.pullOmega;
    s[PULLV] += (-w * w * (s[PULL] - want) - 2 * c.pullDamping * w * s[PULLV]) * dt;
    s[PULL] += s[PULLV] * dt;
    s[PULL] = clamp(s[PULL], -0.6, 0.6);

    // roll: a share of the road's banking (taken up lazily), a little of the body's own lean, a little of the turn
    if (track) {
      track.frameAt(vehicle.s, bankFrame);
      s[BANK] = damp(s[BANK], bankFrame.bank, c.bankRate, dt);
    }
    v.set(1, 0, 0).applyQuaternion(vehicle.quaternion);
    const bodyRoll = Math.asin(clamp(v.y, -1, 1)) - (track ? bankFrame.bank : 0);
    const roll = clamp(s[BANK] * c.bankShare + bodyRoll * c.rollShare - vehicle.angularVelocity.y * c.rollYawRate, -c.rollMax, c.rollMax);
    s[ROLL] = damp(s[ROLL], roll, c.rollRate, dt);

    // shake: the verge and the kerbs under the wheels, and the knocks
    let off = 0;
    let kerb = 0;
    for (const wheel of vehicle.wheels) {
      if (wheel.grounded === false) continue;
      if (wheel.surface === SURFACE.KERB) kerb += 0.25;
      else if (wheel.surface) off += 0.25;
    }
    s[VERGE] = damp(s[VERGE], off, 8, dt);
    s[KERB] = damp(s[KERB], kerb, 14, dt);
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
    s[GRID] = ctx.grid ?? 0;
    const mounted = this.mode === 'bonnet' || this.mode === 'bumper';
    // after the flag: blended in from the chase view, or cut to from a camera fixed to the car
    if (ctx.finished && s[BLEND] === 0 && mounted) {
      s[BLEND] = this.was[BLEND] = 1;
      this.cut = true;
    }
    s[BLEND] = ctx.finished ? Math.min(1, s[BLEND] + dt / CAMERA.results.blend) : 0;

    // the title's hero view swings slowly to and fro on its clock (ORBITY); the results' orbit goes round, slower
    // over the three-quarter views
    if (ctx.sun) this.sun = ctx.sun;
    if (ctx.time) this.time = ctx.time;
    if (this.mode === 'orbit' || s[BLEND] > 0) {
      const o = CAMERA.results;
      if (s[BLEND] > 0) s[ORBIT] += o.rate * (1 - o.linger * Math.abs(Math.sin(2 * s[ORBIT]))) * dt;
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

    if (this.photo) {
      fov = this._photo(camera, this.photo);
    } else if (this.mode === 'orbit') {
      fov = this._hero(eye, target, at(ORBITY));
      this._keepClear(eye, vehicle);
      camera.position.copy(eye);
      camera.lookAt(target);
    } else if ((this.mode === 'bonnet' || this.mode === 'bumper') && at(SWEEP) >= 1 && at(BLEND) === 0) {
      fov = this._mounted(camera, at);
      shake = 0.5;
    } else {
      fov = this._chase(eye, target, at);
      shake = 1;
      roll = at(ROLL) * (this.lookBack ? -1 : 1);
      const sweep = at(SWEEP);
      if (sweep < 1) {
        fov = this._sweep(eye, target, fov, sweep);
        const k = smoothstep(0.75, 1, sweep);
        shake *= k;
        roll *= k;
      }
      const blend = at(BLEND);
      if (blend > 0) {
        const fo = this._orbit(at(ORBIT), at(ORBITY), CAMERA.results);
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

    // shake: smooth noise of the rig's own clock, mostly turning, a little moving. The road's own only above
    // `fromSpeed` (rising to full at the top of the speed signal), the kerbs' and the verge's at any speed.
    if (shake > 0 && !this.photo) {
      const t = at(TIME);
      const trauma = at(TRAUMA);
      const sh = CAMERA.shake;
      const fast = smoothstep(sh.fromSpeed, CAMERA.chase.fastSpeed, Math.abs(this._speed));
      const moving = smoothstep(1, 8, Math.abs(this._speed));
      const road = (fast * sh.road + moving * (sh.verge * at(VERGE) + sh.kerb * at(KERB))) * shake;
      const knock = trauma * trauma * sh.impact * shake;
      const yawN = road * this._n(t * sh.roadHz) + knock * this._n(t * sh.impactHz + 40);
      const pitchN = road * this._n(t * sh.roadHz + 80) + 0.6 * at(KERB) * sh.kerb * moving * shake * this._n(t * sh.kerbHz + 60) + knock * this._n(t * sh.impactHz + 120);
      const rollN = 0.5 * knock * this._n(t * sh.impactHz + 160);
      camera.rotateY(yawN);
      camera.rotateX(pitchN);
      roll += rollN;
      if (knock > 0) camera.translateY(knock * sh.impactMove * this._n(t * sh.impactHz + 200) / sh.impact);
    }
    if (roll && !this.photo) camera.rotateZ(roll);

    fov = this.photo ? fov : this._fit(fov);
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- the rigs

  /**
   * The lens for this picture's shape. Lenses are given top to bottom on a 16:9 picture. A picture narrower than
   * 4:3 keeps the width of view a 4:3 one would have and grows taller instead; one wider than 16:9 (a stacked half)
   * keeps the width of a 16:9 one and grows shorter.
   */
  _fit(fov) {
    const L = CAMERA.lens;
    if (this.aspect < L.narrow || this.aspect > L.wide) {
      const hold = this.aspect < L.narrow ? L.narrow : L.wide;
      const half = Math.atan((Math.tan((fov * Math.PI) / 360) * hold) / this.aspect);
      return Math.min(L.max, (half * 360) / Math.PI);
    }
    return fov;
  }

  /** How much narrower than 4:3 (1 at a phone held upright) and how much wider than 16:9 (1 at a stacked half). */
  _shape() {
    const L = CAMERA.lens;
    return {
      narrow: clamp01((L.narrow - this.aspect) / (L.narrow - 0.46)),
      wide: clamp01((this.aspect - L.wide) / (3.55 - L.wide)),
    };
  }

  /**
   * The chase and far chase cameras (and looking back from them): eye and target, returns the lens.
   *
   * The picture is composed, not just placed: the camera stands `distance` behind the car and tilts down so that
   * the horizon of a level road lies `horizon` of the way down the picture; its height is whatever puts the
   * middle of the car `carAt` of the way down. So the composition holds at every lens, distance and shape of
   * picture, and the road ahead shows over the roof.
   */
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
    const fov = lerp(m.fov ?? c.fov, m.fovFast ?? c.fovFast, feel);
    const distance = (m.distance + feel * (m.pullBack ?? c.pullBack) + at(PULL)) * lerp(1, c.narrowBack, narrow) * lerp(1, c.wideBack, wide);
    // the composition on this picture's lens
    const tanHalf = Math.tan((this._fit(fov) * Math.PI) / 360);
    const horizon = lerp(m.horizon ?? c.horizon, c.narrowHorizon, narrow);
    const carAt = lerp(m.carAt ?? c.carAt, c.narrowCarAt, narrow);
    // ...but never so far down that less than `skyAbove` degrees of sky is left over the horizon (the day's sun
    // stands down the start straight, about 16 degrees up: it must stay in the picture on every shape of screen)
    const pitch = Math.min(Math.atan(2 * (0.5 - horizon) * tanHalf), Math.atan(tanHalf) - (c.skyAbove * Math.PI) / 180);
    const below = pitch + Math.atan(2 * (carAt - 0.5) * tanHalf);
    const reach = distance + c.middle[1];
    const lift = Math.abs(bend) * c.bendLift;
    // on the grid: lower, and looking up so that the start lamps are in the picture (eased out after go)
    const grid = back ? 0 : ease(clamp01(at(GRID)));
    const height = (c.middle[0] + reach * Math.tan(below) + lift) * lerp(1, c.gridLow, grid);
    // behind the car along the swung heading, a little to the inside of the bend
    const bx = Math.sin(yaw);
    const bz = Math.cos(yaw);
    const side = bend * c.inside;
    // on a grade the whole composition tilts with the road as the camera has taken it up (lazily: over a crest
    // and through a compression the picture lags a little)
    const sink = grade * distance * c.uphill;
    eyeOut.set(p.x - bx * distance + bz * side, y + height - sink, p.z - bz * distance - bx * side);
    // looking down by `pitch` from the grade, turned into the bend
    const ly = yaw + bend;
    const elev = Math.atan(grade) - pitch + grid * ((c.gridUp * Math.PI) / 180 + pitch);
    const ce = Math.cos(elev);
    targetOut.set(eyeOut.x + Math.sin(ly) * ce * 10, eyeOut.y + Math.sin(elev) * 10, eyeOut.z + Math.cos(ly) * ce * 10);
    return fov;
  }

  /**
   * The start: a dive from high behind the car and off to one side (towards the middle of the road) down onto its
   * tail, eased at both ends, ending exactly in the chase camera's pose. `u` 0..1 is read off the race clock.
   */
  _sweep(eyeOut, targetOut, fov, u) {
    const sw = CAMERA.sweep;
    const k = ease(clamp01(u));
    const x = this.side;
    // where it starts, in car space, and what it looks at there
    v.set(sw.from[0] * x, sw.from[1], sw.from[2]).applyQuaternion(q).add(p);
    eye2.set(0, sw.lookHeight, sw.lookZ).applyQuaternion(q).add(p);
    // the path bows out sideways and comes down late: height eases in faster than the run in
    const kh = ease(clamp01(u * 1.15));
    const ks = Math.sin(Math.PI * k) * sw.bow * x;
    target2.set(ks, 0, 0).applyQuaternion(q);
    eyeOut.set(lerp(v.x, eyeOut.x, k) + target2.x, lerp(v.y, eyeOut.y, kh), lerp(v.z, eyeOut.z, k) + target2.z);
    // the look moves from the car's middle to the chase camera's point ahead
    targetOut.lerpVectors(eye2, targetOut, smoothstep(0.45, 1, k));
    return lerp(sw.fov, fov, smoothstep(0.3, 1, k));
  }

  /**
   * The staging camera (`__dreamcar.photo`, `?photo=`): `back`, `right` and `up` metres from the car's origin in
   * its own level frame, turned `yaw` degrees left of its heading and `pitch` degrees up, a lens of `fov` degrees
   * top to bottom (as given, whatever the picture's shape). Nothing but the car's pose: the same run is the
   * same picture.
   */
  _photo(camera, o) {
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // the car's right: its local -x, (-cos h, 0, sin h) in the world
    const rx = -fz;
    const rz = fx;
    const back = o.back ?? 6;
    const right = o.right ?? 0;
    eye.set(p.x - fx * back + rx * right, p.y + (o.up ?? 1.2), p.z - fz * back + rz * right);
    const yaw = heading + ((o.yaw ?? 0) * Math.PI) / 180;
    const pitch = ((o.pitch ?? 0) * Math.PI) / 180;
    target.set(eye.x + Math.sin(yaw) * Math.cos(pitch), eye.y + Math.sin(pitch), eye.z + Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(eye);
    camera.lookAt(target);
    return o.fov ?? 50;
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
    // on a tall picture it looks up a little, so the lower frame is the bonnet's edge and the road, not the body
    fwd.set(0, m.lookDown + this._shape().narrow * m.narrowUp, back ? -1 : 1).normalize().applyQuaternion(qq);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0).applyQuaternion(qq);
    camera.lookAt(target.copy(eye).add(fwd));
    return lerp(m.fov, m.fovFast, at(FEEL));
  }

  /**
   * Where the car sits in a picture with a panel beside or under it: { x, y } fractions from the top left. On a
   * wide picture the car is on the side away from the panel (`panelSide` -1: the panel is on the left); on an
   * upright one it is above the panel.
   */
  _place(o, panelSide) {
    if (this.aspect >= o.uprightBelow) return { x: 0.5 - panelSide * o.across, y: o.down };
    return { x: 0.5, y: o.tallDown };
  }

  /**
   * Turn the look from `e` at `c` so that `c` appears at (fx, fy) of a picture with this lens: the target out.
   */
  _frameOn(e, c, fx, fy, fov, out) {
    const tanV = Math.tan((this._fit(fov) * Math.PI) / 360);
    const tanH = tanV * this.aspect;
    fwd.subVectors(c, e);
    const dist = fwd.length();
    const yaw0 = Math.atan2(fwd.x, fwd.z);
    const el0 = Math.asin(clamp(fwd.y / dist, -1, 1));
    // + x is to the right in the picture: the look turns left of the car (the car's bearing minus the offset)
    const yaw = yaw0 + Math.atan((2 * fx - 1) * tanH);
    const el = el0 + Math.atan((2 * fy - 1) * tanV);
    out.set(e.x + Math.sin(yaw) * Math.cos(el), e.y + Math.sin(el), e.z + Math.cos(yaw) * Math.cos(el));
  }

  /**
   * Seen at a three-quarter angle the near end of the car is drawn larger than the far one, so the car's middle is
   * not the middle of what is drawn: turn the look so that the midpoint of the drawn nose and tail is at `fx`.
   */
  _centreEnds(e, t, fx, fov, h) {
    const tanH = Math.tan((this._fit(fov) * Math.PI) / 360) * this.aspect;
    const look = Math.atan2(t.x - e.x, t.z - e.z);
    let lo = Infinity;
    let hi = -Infinity;
    for (const z of [STATIONS.nose, STATIONS.tail]) {
      for (const x of [-0.9, 0.9]) {
        v.set(x, h, z).applyQuaternion(q).add(p);
        const rel = angleDiff(look, Math.atan2(v.x - e.x, v.z - e.z));
        const sx = 0.5 - Math.tan(clamp(rel, -1.4, 1.4)) / (2 * tanH);
        lo = Math.min(lo, sx);
        hi = Math.max(hi, sx);
      }
    }
    const mid = (lo + hi) / 2;
    const turn = Math.atan((2 * fx - 1) * tanH) - Math.atan((2 * mid - 1) * tanH);
    fwd.subVectors(t, e);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    t.set(e.x + fwd.x * c + fwd.z * sn, t.y, e.z - fwd.x * sn + fwd.z * c);
  }

  /**
   * The title's hero picture: a three-quarter view from low down, swinging slowly to and fro, on the side of the
   * car that has the brightest part of the sky beside it (so the paint has it to mirror), the car clear of the menu.
   */
  _hero(eyeOut, targetOut, clock) {
    const o = CAMERA.orbit;
    const per = (this.time && o.times && o.times[this.time]) || {};
    const pick = (k) => per[k] ?? o[k];
    const { narrow } = this._shape();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const centre = this._heroAngle(yaw, pick);
    const a = yaw + Math.PI + centre + pick('swing') * Math.sin((clock * 2 * Math.PI) / o.period);
    const r = pick('distance') * lerp(1, o.narrowBack, narrow);
    const h = pick('height') + o.bob * Math.sin((clock * 2 * Math.PI) / (o.period * 0.71) + 1.3);
    eyeOut.set(p.x + Math.sin(a) * r, p.y + h, p.z + Math.cos(a) * r);
    target2.set(0, o.lookHeight, o.lookZ).applyQuaternion(q).add(p);
    const fov = pick('fov');
    const at = this._place(o, -1);
    this._frameOn(eyeOut, target2, at.x, at.y, fov, targetOut);
    this._centreEnds(eyeOut, targetOut, at.x, fov, o.lookHeight);
    return fov;
  }

  /**
   * Which three-quarter view the title holds (rad round the car from straight behind, + = round its left): of the
   * front and rear three-quarter views on either side, the one whose look runs most nearly `sunBeside` beside the
   * brightest part of the sky (the sun, or where it has set), the front ones preferred by `frontBias`.
   */
  _heroAngle(yaw, pick) {
    const o = CAMERA.orbit;
    const sun = this.sun;
    if (pick('angle') !== undefined) return pick('angle');
    if (!sun) return o.quarter;
    const sunBearing = Math.atan2(sun[0], sun[2]);
    let best = o.quarter;
    let score = -Infinity;
    for (const base of [o.quarter, -o.quarter, Math.PI - o.quarter * 0.8, -(Math.PI - o.quarter * 0.8)]) {
      // the camera stands at yaw + PI + base and looks back at the car
      const look = yaw + base;
      const off = Math.abs(Math.abs(angleDiff(look, sunBearing)) - pick('sunBeside'));
      const s = -off + (Math.abs(base) > Math.PI / 2 ? pick('frontBias') : 0);
      if (s > score) {
        score = s;
        best = base;
      }
    }
    return best;
  }

  /** The orbit behind the results: eye and target into eye2 / target2 for blending, the car clear of the panel. */
  _orbit(angle, drift, o) {
    const { narrow } = this._shape();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const a = yaw + Math.PI + angle;
    const r = lerp(o.near, o.far, 0.5 + 0.5 * Math.sin(drift * o.driftRate)) * lerp(1, o.narrowBack, narrow);
    const h = lerp(o.low, o.high, 0.5 + 0.5 * Math.sin(drift * o.driftRate * 0.71 + 1.3));
    eye2.set(p.x + Math.sin(a) * r, p.y + h, p.z + Math.cos(a) * r);
    fwd2.set(p.x, p.y + o.lookHeight, p.z);
    const at = this._place(o, 1);
    this._frameOn(eye2, fwd2, at.x, at.y, o.fov, target2);
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
