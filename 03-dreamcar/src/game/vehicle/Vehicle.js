// One car as a machine: a rigid body on four sprung wheels, driven through the tyres.
//
// Each fixed step runs in the order a contact solver would: springs, gravity and air first, giving the velocity
// the body would have if the tyres did nothing; then the tyres, as friction against that velocity (so a stopped
// car on a slope is held with no creep and a slow one cannot be reversed by its own brakes); then the pose;
// then whatever is solid (the track's edges, the ground under a car on its roof), as impulses and a push back out.
// The road is only ever asked one question, track.surfaceAt: height, normal and grip under a point.
//
// Frames: world +Y up; car space +Z forward, +Y up, +X the car's LEFT. Positive yaw and positive steering angle turn
// LEFT; the control input `steer` is +1 = RIGHT. Wheels: 0 FL, 1 FR, 2 RL, 3 RR.
//
// Nothing here allocates while driving (it runs 120 times a second per car on a phone), which is why the vector
// algebra is written out in components.

import { ASSISTS } from '../config.js';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Drivetrain } from './drivetrain.js';
import { CAR } from './params.js';
import { Contact } from './tyre.js';

/** The longest step taken in one go (s); a longer dt is cut into equal parts no longer than this. */
const MAX_STEP = 1 / 110;
const TAU = Math.PI * 2;
const MAX_IMPACTS = 8;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v) => (Number.isFinite(v) ? v : 0);

const makeSample = () => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 0, grip: 1, s: 0, lat: 0, index: 0, edgeL: Infinity, edgeR: Infinity, sky: 1 });
const makeImpact = () => ({ strength: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: 'edge', edgeKind: 0 });

const REST = { steer: 0, throttle: 0, brake: 0, handbrake: 1 };
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export class Vehicle {
  /**
   * @param {object} track anything with surfaceAt(x, z, hint, out) and the per-sample arrays of game/track.js
   * @param {typeof CAR} [params]
   */
  constructor(track, params = CAR) {
    this.track = track;
    this.params = params;

    // pose of the model's root (car space origin: on the ground between the axles when the car stands level)
    this.position = new Vector3();
    this.quaternion = new Quaternion();
    this.prevPosition = new Vector3();
    this.prevQuaternion = new Quaternion();
    this.velocity = new Vector3(); // of the centre of mass, world
    this.angularVelocity = new Vector3(); // world
    this.yaw = 0;
    this.speed = 0; // forward, m/s (negative in reverse)
    this.rpm = params.engine.idle;
    this.gear = 1; // -1 R, 1..9
    this.throttle = 0; // as applied, after the assists
    this.brake = 0; // the foot brake as applied (what the brake lamps show)
    this.steerAngle = 0; // rad at the road wheels, about +Y (a right turn is negative)

    this.wheels = params.wheels.map((spec) => ({
      steer: 0,
      spin: 0, // rad, accumulates
      omega: 0, // rad/s
      travel: 0, // m, + = compressed from rest
      grounded: true,
      surface: 0,
      load: spec.staticLoad, // N
      slipRatio: 0,
      slipAngle: 0,
      skid: 0, // 0..1, for smoke, marks and squeal
      contact: new Vector3(), // where the tyre touches, world
      _spec: spec,
      _hint: -1,
      _sample: makeSample(),
      _travel: 0, // unclamped
      _facing: 1, // the body's up along the ground's normal
      _rx: 0, // from the centre of mass to the patch, world
      _ry: 0,
      _rz: 0,
      _vlong: 0, // speed of the patch along the wheel at the last step
      _slip: 0, // slip velocity along the wheel at the last step
      _brake: 0, // brake torque asked for this step (N·m)
      _drive: 0, // drive torque this step (N·m)
      _cut: 0, // 0..1 of the brake torque the ABS has learnt to hold back
    }));

    /** How hard each assist is working right now, 0..1. */
    this.assists = { abs: 0, tc: 0, esc: 0 };
    /** Switches (the handling tests turn them off; the game leaves them on). */
    this.assistsOn = { abs: true, tc: true, esc: true };
    /**
     * The assist level (an entry of ASSISTS.levels in game/config.js, or null: the switches above alone). It sets the
     * switches, how far the stability control lets the car slide, and the slide help (see setAssists). A new car
     * has the default level.
     */
    this.level = ASSISTS.levels[ASSISTS.default];
    /** 0..1 how much the car is sliding: its tail beyond the slip its tyres grip at (the hands, the camera, the HUD and the sound may read it). */
    this.drift = 0;
    /** Where the rear axle is going, measured from where the body points (rad, + = the tail is out to the left): the angle of a slide. */
    this.slideAngle = 0;
    /** The same at the front axle: front wheels turned to this angle point where the car is going. */
    this.frontAngle = 0;
    /**
     * The slide as a game might score it (all in the fixed step): `angle` now (degrees, unsigned, 0 when not sliding),
     * `time` s and `score` of the slide in progress (degrees beyond 10 times metres travelled, over 100), `last` the
     * score of the slide that ended last (0 if it ended against an edge or in a spin), `best` and `total` over the run.
     */
    this.slide = { angle: 0, time: 0, score: 0, last: 0, best: 0, total: 0 };
    this._driftM = 0; // the slide help's yaw moment this step (N·m, + = to the left)
    this._relief = 0; // 0..1 of the speed a slide scrubs off that the help gives back this step
    this._slideRate = 0; // how fast the slide is growing (rad/s)
    this._slideLast = 0;
    this._slideSide = 0; // which way the last slide went (the sign of slideAngle)
    this._slideMemory = 0; // 1 just after a slide, falling to 0
    this._throttleMemory = 0; // the throttle as it was over the last half second or so
    this._kick = 0; // 0..1 a slide just asked for by a lift, a dab of the brake or the handbrake, fading
    this._brakeAge = 0; // s the brake pedal has been down
    this._slideQuiet = 0; // s since the car last slid
    this._stay = 0; // 0..1 the driver is steering into the bend, or was a moment ago: the slide is wanted

    this.trackIndex = 0;
    this.s = 0;
    this.lat = 0;
    this.sky = 1;
    /** @type {Array<{strength:number,x:number,y:number,z:number,nx:number,ny:number,nz:number,kind:'edge'|'car',edgeKind:number}>} */
    this.impacts = [];
    this.scrape = 0; // 0..1 sliding along something solid right now
    this.upsideDown = false;
    this.stuckTime = 0; // s the pedals have asked for motion and got none
    this.wrongWayTime = 0; // s spent pointing back down the road

    const p = params;
    this._drivetrain = new Drivetrain(p, p.wheels[2].radius);
    this._contact = new Contact(p.tyre);
    this._com = new Vector3(); // centre of mass, world: the body's real state (position is derived from it)
    this._invMass = 1 / p.mass;
    this._invIx = 1 / p.inertia.x;
    this._invIy = 1 / p.inertia.y;
    this._invIz = 1 / p.inertia.z;
    // What one tyre has to move when it acts with the other three: the body gives way in roll to a sideways push at
    // the ground and in pitch to one along it, so it is less than a quarter of the car.
    this._massLat = 0.25 / (this._invMass + p.com.y * p.com.y * this._invIz);
    this._massLong = 0.25 / (this._invMass + p.com.y * p.com.y * this._invIx);
    // the axles from the centre of mass (m), and the rear-wheel steering's law (see _rearShare)
    this._a = p.wheels[0].z - p.com.z;
    this._b = p.com.z - p.wheels[2].z;
    const perSlip = (this._contact.curveY.slope * p.tyre.muY) / p.tyre.alphaPeak; // force per unit load and radian, before grip and give
    const stiffF = (2 * perSlip * p.wheels[0].grip * p.wheels[0].staticLoad) / p.wheels[0].give; // N/rad, the axle
    const stiffR = (2 * perSlip * p.wheels[2].grip * p.wheels[2].staticLoad) / p.wheels[2].give;
    this._rearA = (this._a * p.mass) / (stiffR * p.wheelbase);
    this._rearB = (this._b * p.mass) / (stiffF * p.wheelbase);
    this._dragK = 0.5 * p.aero.airDensity * p.aero.dragArea;
    this._liftK = 0.5 * p.aero.airDensity * (p.aero.downforceArea ?? 0);
    // body axes in world space, refreshed from the quaternion
    this._lx = 1; this._ly = 0; this._lz = 0;
    this._ux = 0; this._uy = 1; this._uz = 0;
    this._fx = 0; this._fy = 0; this._fz = 1;
    // scratch results of _invInertia and of _pointResponse
    this._ox = 0; this._oy = 0; this._oz = 0;

    const box = p.box;
    const mid = (box.front + box.rear) / 2;
    /** The body's outline in car space (x, z): four corners, then the middles of the four sides. */
    this._outline = [box.halfWidth, box.front, -box.halfWidth, box.front, box.halfWidth, box.rear, -box.halfWidth, box.rear,
      0, box.front, 0, box.rear, box.halfWidth, mid, -box.halfWidth, mid];
    /** Further than this from an edge (m, root to edge), no part of the body can be touching it. */
    this._reach = Math.hypot(box.halfWidth, Math.max(box.front, -box.rear)) + 0.45;
    this._outlineSamples = [];
    this._outlineHints = new Int32Array(8).fill(-1);
    for (let i = 0; i < 8; i++) this._outlineSamples.push(makeSample());
    this._centre = makeSample();
    this._centreHint = -1;
    this._impactPool = [];
    for (let i = 0; i < MAX_IMPACTS; i++) this._impactPool.push(makeImpact());

    this._reverse = false;
    this._selectTimer = 0;
    this._hold = 0; // 0..1 the brakes holding a standing car
    this._tcCut = 0;
    this._escPause = 0; // s the stability control stays out of the way after the handbrake
    this._beta = 0; // body slip angle at the last step
    this._betaRate = 0;
    this._wantedYaw = 0; // the yaw rate the stability control takes the steering to be asking for (rad/s)
    this._restTime = 0;
    this._asleep = false;
    this._grip = 1; // mean grip of the surfaces under the wheels
    this._touching = false;
    this._edgePeak = 0; // the hardest knock against an edge in this meeting with it (m/s)
    this._edgeQuiet = 1; // s since the body last touched an edge
    this._asking = false; // a pedal is asking the car to move

    this.reset({ x: 0, y: 0, z: 0, yaw: 0 });
  }

  /**
   * Put the car down at rest on its springs, facing `yaw`. `y` is not needed: the road is asked.
   * @param {{x:number, y?:number, z:number, yaw:number}} at
   */
  reset({ x, z, yaw }) {
    const p = this.params;
    const sample = this._centre;
    this._centreHint = -1;
    this._outlineHints.fill(-1);
    for (const w of this.wheels) w._hint = -1;
    this.track.surfaceAt(x, z, -1, sample);
    this._centreHint = sample.index;
    // stand on the surface: up is its normal, forward is the heading laid onto it
    _b.set(sample.nx, sample.ny, sample.nz);
    _c.set(Math.sin(yaw), 0, Math.cos(yaw));
    _c.addScaledVector(_b, -_c.dot(_b)).normalize();
    _a.crossVectors(_b, _c);
    _m.makeBasis(_a, _b, _c);
    this.quaternion.setFromRotationMatrix(_m);
    this._axes();
    this._com.set(
      x + this._lx * p.com.x + this._ux * p.com.y + this._fx * p.com.z,
      sample.y + this._ly * p.com.x + this._uy * p.com.y + this._fy * p.com.z,
      z + this._lz * p.com.x + this._uz * p.com.y + this._fz * p.com.z,
    );
    this._still();
    this._drivetrain.reset();
    this._reverse = false;
    this._selectTimer = 0;
    this.drift = this.slideAngle = this.frontAngle = 0;
    this._driftM = this._relief = this._slideRate = this._slideLast = this._throttleMemory = this._kick = this._brakeAge = 0;
    this._slideSide = this._slideMemory = this._slideQuiet = this._stay = 0;
    const sl = this.slide;
    sl.angle = sl.time = sl.score = sl.last = sl.best = sl.total = 0;
    this._hold = 1;
    this._tcCut = 0;
    this._escPause = 0;
    this._beta = 0;
    this._betaRate = 0;
    this._wantedYaw = 0;
    this.steerAngle = 0;
    for (const w of this.wheels) {
      w.spin = 0;
      w.steer = 0;
      w._cut = 0;
      w._slip = 0;
      w._vlong = 0;
    }
    // let the springs find their own level (it differs from the drawing by millimetres on a slope)
    this._asleep = false;
    for (let i = 0; i < 180; i++) this._substep(1 / 120, REST);
    this._still();
    this._escPause = 0;
    this._sync();
    this._locate(0);
    this.impacts.length = 0;
    this.scrape = 0;
    this._edgePeak = 0;
    this._edgeQuiet = 1;
    this.stuckTime = 0;
    this.wrongWayTime = 0;
    this._restTime = 0;
    this._asleep = false;
    this.assists.abs = this.assists.tc = this.assists.esc = 0;
    this.throttle = 0;
    this.brake = 0;
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
  }

  /**
   * One fixed step.
   * @param {number} dt
   * @param {{steer:number, throttle:number, brake:number, handbrake?:number|boolean}} controls `steer` -1..1 of the
   *   lock (+ = right); a driver may ask for more than the lock (to ±3): the wheels stop at it, the slide help reads on
   */
  step(dt, controls) {
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._substep(h, controls);
    this._locate(dt);
  }

  /** Move the impacts recorded since the last call into `out` (as copies) and forget them. */
  drainImpacts(out) {
    for (let i = 0; i < this.impacts.length; i++) out.push({ ...this.impacts[i] });
    this.impacts.length = 0;
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------

  _substep(dt, c) {
    const p = this.params;
    const wheels = this.wheels;
    const v = this.velocity;
    const o = this.angularVelocity;
    this._axes();
    const lx = this._lx, ly = this._ly, lz = this._lz;
    const ux = this._ux, uy = this._uy, uz = this._uz;
    const fx = this._fx, fy = this._fy, fz = this._fz;
    const vLong = v.x * fx + v.y * fy + v.z * fz;
    const vLat = v.x * lx + v.y * ly + v.z * lz;
    const yawRate = o.x * ux + o.y * uy + o.z * uz;

    // ---- the driver --------------------------------------------------------------------------------------
    // (the steering asked for may be beyond the lock: the wheels stop there, but the slide help reads what was meant)
    const steerAsk = clamp(finite(c.steer), -3, 3);
    const steerIn = clamp(steerAsk, -1, 1);
    const throttleIn = clamp01(finite(c.throttle));
    const brakeIn = clamp01(finite(c.brake));
    const handbrake = clamp01(finite(+c.handbrake || 0));
    // Braking at a standstill selects reverse and the brake pedal becomes its throttle; the throttle is then the
    // brake until the car has stopped rolling back, and selects drive again.
    if (!this._reverse) {
      if (brakeIn > 0.3 && throttleIn < 0.1 && Math.abs(vLong) < 0.4) {
        this._selectTimer += dt;
        if (this._selectTimer > 0.3) {
          this._reverse = true;
          this._selectTimer = 0;
        }
      } else this._selectTimer = 0;
    } else if (throttleIn > 0.1 && brakeIn < 0.3 && vLong > -0.4) this._reverse = false;
    const reverse = this._reverse;
    let throttle = reverse ? brakeIn : throttleIn;
    const pedal = reverse ? throttleIn : brakeIn;

    // a standing car with the throttle closed is held on its brakes, and after a moment simply left alone
    const holding = throttle < 0.02 && Math.abs(vLong) < 0.6;
    this._hold = clamp01(this._hold + (holding ? dt * 5 : -dt * 12));
    if (this._asleep) {
      if (holding && v.lengthSq() + o.lengthSq() === 0) {
        this._idle(dt, pedal);
        return;
      }
      this._asleep = false;
      this._restTime = 0;
    }

    const lock = p.steering.lock;
    const wanted = -steerIn * lock;
    this.steerAngle += clamp(wanted - this.steerAngle, -p.steering.rate * dt, p.steering.rate * dt);
    const steer = this.steerAngle;
    wheels[0].steer = wheels[1].steer = steer;
    // the rear wheels take a share of it at speed, the same way (rear-axle steering: see rearShare)
    const rear = clamp(steer * this.rearShare(vLong), -p.steering.rear.most, p.steering.rear.most);
    wheels[2].steer = wheels[3].steer = rear;

    // ---- the assists (they read what the last step left) -----------------------------------------------------
    const a = p.assists;
    if (handbrake > 0.1) this._escPause = a.esc.handbrakePause;
    else this._escPause = Math.max(0, this._escPause - dt);

    // where each axle is going, measured from where the body points (+ = to the left of it)
    const beta = Math.abs(vLong) > 2 ? Math.atan2(vLat, Math.abs(vLong)) : 0;
    this._betaRate += ((beta - this._beta) / dt - this._betaRate) * Math.min(1, dt * 30);
    this._beta = beta;
    const forwards = vLong > 2;
    const betaR = forwards ? Math.atan2(vLat - this._b * yawRate, vLong) : 0;
    const betaF = forwards ? Math.atan2(vLat + this._a * yawRate, vLong) : 0;
    const latG = Math.abs(yawRate * vLong) / p.gravity;
    const level = this.level;
    const help = p.drift;
    // a slide: the tail further out than the slip its tyres grip at, fully so a few degrees on
    const slide = Math.abs(betaR);
    const side = betaR > 0 ? 1 : betaR < 0 ? -1 : steer < 0 ? 1 : -1;
    this._slideRate += ((slide - this._slideLast) / dt - this._slideRate) * Math.min(1, dt * 30);
    this._slideLast = slide;
    const sliding = vLong > help.minSpeed ? smooth01((slide - help.from) / (help.full - help.from)) : 0;
    // which way the last slide went, remembered for a moment: the help stays with the car while it comes back into
    // line, and a slide that swings through straight into the other way is the snap of a slide let go
    if (sliding > 0.5) {
      this._slideSide = side;
      this._slideMemory = 1;
    } else this._slideMemory = Math.max(0, this._slideMemory - dt / help.snapMemory);
    const snap = this._slideMemory > 0 && side !== this._slideSide && slide > 0.01;
    this.drift = sliding;
    this.slideAngle = betaR;
    this.frontAngle = betaF;
    // how hard the front wheels are turned into the bend, measured from where the front axle is going (1 = at the
    // slip their grip peaks at, -1 = as far the other way): this is what the driver's steering comes to in a slide
    const meant = Math.abs(steerAsk) > 1 ? -steerAsk * lock : steer; // (beyond the lock: the angle the driver asked for)
    const into = forwards ? clamp((side * (betaF - meant)) / help.frontSlip, -1, 1) : 0;

    // A slide asked for: a lift of the throttle or a dab of the brake while the car is loaded up in a bend with its
    // front wheels working, or the handbrake. The help then lets the tail out (a kick, fading over a moment); held
    // on the throttle after that, the slide stays.
    const helping = !!level && level.hold > 0 && vLong > help.minSpeed;
    this._throttleMemory += (throttleIn - this._throttleMemory) * Math.min(1, dt / help.liftMemory);
    this._brakeAge = brakeIn > help.kickBrake ? this._brakeAge + dt : 0;
    let kick = 0;
    if (helping) {
      const loaded = clamp01((latG - help.kickG) / help.kickSpan) * clamp01((into - help.kickInto) / help.kickIntoSpan);
      const lift = clamp01((this._throttleMemory - throttleIn) * help.liftGain) * level.liftKick;
      const dab = this._brakeAge > 0 && this._brakeAge < help.dabTime ? level.brakeKick : 0;
      kick = Math.max(lift, dab) * loaded;
      if (handbrake > 0.1) kick = level.handKick;
    }
    this._kick = Math.max(kick, this._kick - dt / help.kickTime);
    const kicked = clamp01(this._kick * 4);
    this._into = into;
    // Whether the slide is wanted: the driver is steering into the bend (any steering beyond the first little of it
    // counts in full: how much of it there is only tightens the line), or was a moment ago. It comes at once and
    // goes over half a second, so a key tapped to hold a line keeps the slide and steering let go ends it.
    const wants = smooth01(into / help.intoFull);
    this._stay = wants > this._stay ? Math.min(wants, this._stay + dt / help.stayRise) : Math.max(wants, this._stay - dt / help.stayFall);
    // the slide a level holds narrows at speed (a big angle at 250 km/h is a crash in the making), and the angle
    // at which it catches the car opens up at walking pace, where a spin is only a turn
    const open = helping ? level.slip * Math.min(1, help.slipSpeed / vLong) : 0;
    const slow = clamp01(1 - vLong / help.slowSpeed);
    const limit = helping ? open + help.margin + help.slowSlip * slow * slow : Infinity;

    // stability control: the yaw moment (about +Y) that would put the car back where the steering points it
    let moment = 0;
    let trim = 0;
    if (!(this.assistsOn.esc && vLong > a.esc.minSpeed && this._escPause === 0)) this._wantedYaw = yawRate;
    else {
      const e = a.esc;
      const slipAllowed = helping ? limit : e.slipAllowed;
      // (it does not fight the yaw of a slide the help is holding, or of one just let go that is coming back)
      const minds = helping ? 1 - Math.max(sliding, kicked, this._slideMemory) : 1;
      const ratio = vLong / e.characteristicSpeed;
      const holds = (e.holdG * p.gravity * this._grip) / vLong; // no more yaw than the road can hold (banking and the air help)
      // what the steering asks for, as the car would answer it: through the car's own understeer and with the lag
      // its yaw takes to build (a reference without the lag reads every quick release of a key as oversteer)
      const asked = clamp((vLong * (steer - rear)) / (p.wheelbase * (1 + ratio * ratio)), -holds, holds);
      this._wantedYaw += (asked - this._wantedYaw) * (1 - Math.exp(-dt / e.lag));
      const wantedYaw = this._wantedYaw;
      const error = yawRate - wantedYaw;
      // the error let pass is a lateral acceleration (about 0.1 g) rather than a yaw rate, so that at speed, where a
      // yaw rate is a lot of sideways g and the yaw is least damped, the brakes steady the car sooner
      const beyond = Math.abs(error) - Math.min(e.deadband, e.deadbandG / vLong) - 0.12 * Math.abs(wantedYaw);
      if (beyond > 0) moment -= Math.sign(error) * e.yawGain * beyond * minds;
      const slip = beta - clamp(beta, -slipAllowed, slipAllowed);
      if (slip !== 0) {
        moment += e.slipGain * slip;
        if (slip * this._betaRate > 0) moment += e.slipRateGain * this._betaRate;
      }
      // turning less than asked with the front already sliding: brakes cannot find grip that is not there, so ease the power
      if (beyond > 0 && error * wantedYaw < 0 && Math.abs(wantedYaw) > Math.abs(yawRate)) trim = clamp01(e.understeerGain * beyond * minds);
      // turning more than asked, or sideways: take the power off the rear wheels
      if (moment * yawRate < 0) trim = Math.max(trim, clamp01(Math.abs(moment) / 5000));
    }

    // The slide help: an arcade car's hidden hand. It turns the body, without brakes, towards the slide the driver
    // is asking for: as much of the level's angle as the throttle is open (or the kick still lasts), for as long as
    // the driver steers into the bend. So a slide holds on the throttle while the steering picks the line, closes
    // when the steering is let go or the throttle is lifted, and never grows past what the level allows. The same hand keeps the tail from coming back faster than the eye can follow, and stays with the car
    // through straight, so that a slide let go does not snap the other way.
    this._driftM = 0;
    this._relief = 0;
    if (helping) {
      const rate = this._slideRate;
      let accel = 0; // rad/s², + closes the slide (turns the nose back towards where the car is going)
      let gate = 0;
      if (handbrake <= 0.1) {
        const asked = snap ? 0 : open * Math.max(throttleIn, this._kick) * this._stay;
        accel = help.hold * (slide - asked) + (rate > 0 ? help.damp : help.dampClose) * rate;
        if (snap && rate > 0) accel += help.snapDamp * rate;
        // letting the tail out is for a slide in progress or one just asked for; bringing it back in also for the
        // moment after a slide
        gate = accel < 0 ? Math.max(sliding, kicked) : Math.max(sliding, this._slideMemory);
      }
      // beyond the level's angle the car is caught, handbrake or not
      if (slide > limit) {
        accel = Math.max(accel, 0) + help.catch * (slide - limit) + (rate > 0 ? help.catchDamp * rate : 0);
        gate = 1;
      }
      this._driftM = side * clamp(accel, -help.most, snap || slide > limit ? help.catchMost : help.mostClose) * p.inertia.y * level.hold * gate;
      // and some of the speed the slide scrubs off is given back while the throttle is open: sliding costs a little
      this._relief = (level.relief ?? 0) * sliding * throttleIn * (handbrake <= 0.1 ? 1 : 0);
    }

    // traction control: trim the engine while a driven wheel spins faster than the road (not while the handbrake is
    // pulled; straight after it, it is what lets the rear tyres grip again and the slide be caught)
    const tcOn = this.assistsOn.tc && handbrake <= 0.1;
    let spin = 0;
    for (let i = 2; i < 4; i++) {
      const w = wheels[i];
      if (!w.grounded) continue;
      const ref = Math.max(Math.abs(w._vlong), 3);
      // on a loose surface the tyre's peak comes later (tyre.js), and so does what the control aims for
      const loose = 1 + p.tyre.looseSlip * Math.max(0, 1 - w._sample.grip);
      spin = Math.max(spin, (reverse ? -w._slip : w._slip) / (ref * loose));
    }
    let cut = 0;
    if (tcOn && throttle > 0.02) {
      // in a bend it lets the wheels spin a little more: the tail may move, and the stability control minds the yaw
      const target = (level?.tcSlip ?? a.tc.slip) + a.tc.bendSlip * clamp01((latG * p.gravity) / 6);
      // and in a slide as much again as turns the rear tyres' push from across the car to along it: the further
      // sideways, the more they must spin to drive at all (that spin is the slide's own, and its smoke)
      const over = spin / (target + (level?.spin ?? 0) * sliding * Math.min(help.spinMost, Math.tan(slide))) - 1;
      // what it has learnt the road will take, plus an answer to the slip of this instant
      this._tcCut = clamp(this._tcCut + dt * (over > 0 ? a.tc.learn * Math.min(over, 3) : a.tc.forget * Math.max(over, -1)), 0, 0.95);
      cut = clamp(this._tcCut + a.tc.react * Math.max(0, over), 0, 0.97);
    } else this._tcCut = Math.max(0, this._tcCut - dt * 4);

    const limiter = reverse ? clamp01((p.gearbox.reverseSpeed + vLong) / 2) : clamp01((p.topSpeed + 0.6 - vLong) / 1.2);
    this._asking = throttle > 0.3;
    throttle *= limiter;
    if (handbrake > 0.1) throttle = 0; // the handbrake lifts the drive, as pulling it does in a car set up for it
    const keep = (1 - cut) * (1 - trim);
    this.throttle = throttle * keep;
    this.brake = pedal;

    // ---- engine and gearbox ---------------------------------------------------------------------------------
    const dt_ = this._drivetrain;
    const rearOmega = (wheels[2].omega + wheels[3].omega) / 2;
    dt_.update(dt, throttle, keep, pedal, rearOmega, vLong, latG, reverse, sliding > 0.5);
    this.rpm = dt_.rpm;
    this.gear = dt_.gear;
    const axle = dt_.axleTorque;
    const d = p.differential;
    // (in a slide the differential closes up: both rear wheels spin together, as a slide wants them)
    const locking = d.preload + d.bias * Math.abs(axle) + d.slideLock * sliding;
    const across = clamp(d.viscous * (1 + d.slideViscous * sliding) * (wheels[2].omega - wheels[3].omega), -locking, locking);
    wheels[0]._drive = wheels[1]._drive = 0;
    wheels[2]._drive = axle / 2 - across;
    wheels[3]._drive = axle / 2 + across;

    // ---- brakes: the pedal, what the stability control adds to one wheel, less what the ABS holds back ------
    const rolling = 1 + (vLong / p.rollingSpeed) * (vLong / p.rollingSpeed);
    const escTorque = Math.min((Math.abs(moment) / (p.wheels[0].x + 0.001)) * p.wheels[0].radius, p.brakes.front * 0.8);
    // a moment to the left (+) is made by braking a left wheel: the front one when it works against the car's
    // rotation (catching a slide), the rear one when it helps the car turn (understeer)
    const escWheel = moment === 0 ? -1 : (moment > 0 ? 0 : 1) + (moment * yawRate < 0 ? 0 : 2);
    let absWork = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const spec = w._spec;
      let torque = pedal * (spec.front ? p.brakes.front : p.brakes.rear);
      if (i === escWheel) torque += spec.front ? escTorque : escTorque * 0.5;
      const speed = Math.abs(w._vlong);
      let release = 0;
      if (this.assistsOn.abs && torque > 0 && speed > a.abs.minSpeed && w.grounded) {
        const loose = 1 + p.tyre.looseSlip * Math.max(0, 1 - w._sample.grip);
        const slip = (w._vlong > 0 ? -w._slip : w._slip) / (Math.max(speed, 2.5) * loose); // + = the wheel is turning slower than the road
        const over = slip / a.abs.slip - 1;
        // as the traction control: what it has learnt this wheel's road will take, plus an answer to this instant
        w._cut = clamp(w._cut + dt * (over > 0 ? a.abs.learn * Math.min(over, 3) : a.abs.forget * Math.max(over, -1)), 0, 0.95);
        release = clamp(w._cut + a.abs.react * Math.max(0, over), 0, 0.97);
      } else w._cut = Math.max(0, w._cut - dt * 8);
      if (release > absWork && pedal > 0.05) absWork = release;
      torque *= 1 - release;
      if (!spec.front) torque += handbrake * p.brakes.handbrake;
      torque += this._hold * p.brakes.hold;
      const surface = p.surfaces[w.surface] || p.surfaces[0];
      w._brake = torque + surface.rolling * rolling * w.load * spec.radius;
    }
    this.assists.abs += (absWork - this.assists.abs) * Math.min(1, dt * 20);
    // (in a slide the traction control is shaping the wheelspin, not fighting the driver: its lamp stays dark)
    this.assists.tc += (cut * (1 - sliding) - this.assists.tc) * Math.min(1, dt * 20);
    this.assists.esc += (Math.max(clamp01(escTorque / 900), trim) - this.assists.esc) * Math.min(1, dt * 20);

    // ---- springs: where each wheel meets the road, and how hard --------------------------------------------
    const com = this._com;
    const sus = p.suspension;
    const track = this.track;
    let grip = 0;
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const spec = w._spec;
      // the foot of the strut when the car stands level, from the centre of mass
      const ax = spec.x - p.com.x, ay = -p.com.y, az = spec.z - p.com.z;
      const px = com.x + lx * ax + ux * ay + fx * az;
      const py = com.y + ly * ax + uy * ay + fy * az;
      const pz = com.z + lz * ax + uz * ay + fz * az;
      const s = w._sample;
      track.surfaceAt(px, pz, w._hint, s);
      w._hint = s.index;
      w.surface = s.surface;
      const surface = p.surfaces[s.surface] || p.surfaces[0];
      let ground = s.y;
      if (surface.rough > 0) {
        const k = TAU / surface.wavelength;
        ground += surface.rough * Math.sin(px * k) * Math.sin(pz * k * 1.31 + 1.7);
      }
      const facing = ux * s.nx + uy * s.ny + uz * s.nz;
      let travel = -sus.droop;
      if (facing > 0.3) travel = Math.max(travel, ((ground - py) * s.ny) / facing);
      w.grounded = travel > -sus.droop;
      w._travel = travel;
      w._facing = facing;
      w.travel = Math.min(travel, sus.bump);
      w._rx = px + ux * travel - com.x;
      w._ry = py + uy * travel - com.y;
      w._rz = pz + uz * travel - com.z;
      w.contact.set(com.x + w._rx, com.y + w._ry, com.z + w._rz);
      if (w.grounded) {
        grip += s.grip;
        grounded++;
      }
    }
    this._grip = grounded ? grip / grounded : 1;

    // downforce, pressing the body onto its wheels at the centre of mass, in step with how many of them are on the
    // road (a car that has left the ground is not sucked back down)
    const down = this._liftK * (v.x * v.x + v.y * v.y + v.z * v.z) * grounded * 0.25;
    let Fx = -this._ux * down, Fy = -p.mass * p.gravity - this._uy * down, Fz = -this._uz * down;
    let Tx = 0, Ty = 0, Tz = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w.grounded) {
        w.load = 0;
        continue;
      }
      const spec = w._spec;
      const s = w._sample;
      const rx = w._rx, ry = w._ry, rz = w._rz;
      const t = w.travel;
      // how fast the body is closing on the road here
      const cx = v.x + o.y * rz - o.z * ry;
      const cy = v.y + o.z * rx - o.x * rz;
      const cz = v.z + o.x * ry - o.y * rx;
      const rate = clamp(-(cx * s.nx + cy * s.ny + cz * s.nz) / w._facing, -sus.damperSpeed, sus.damperSpeed);
      let force = spec.spring * (t + spec.preload) + (rate > 0 ? spec.damperBump : spec.damperRebound) * rate;
      force += spec.antiRoll * (t - wheels[i ^ 1].travel);
      if (t > sus.bumpStop) force += sus.bumpStopRate * (t - sus.bumpStop);
      force = clamp(force, 0, sus.maxLoad * spec.staticLoad);
      w.load = force;
      const nx = s.nx * force, ny = s.ny * force, nz = s.nz * force;
      Fx += nx; Fy += ny; Fz += nz;
      Tx += ry * nz - rz * ny;
      Ty += rz * nx - rx * nz;
      Tz += rx * ny - ry * nx;
    }

    // air
    const airspeed = v.length();
    Fx -= this._dragK * airspeed * v.x;
    Fy -= this._dragK * airspeed * v.y;
    Fz -= this._dragK * airspeed * v.z;

    v.x += Fx * this._invMass * dt;
    v.y += Fy * this._invMass * dt;
    v.z += Fz * this._invMass * dt;
    if (this._driftM !== 0 && grounded > 0) {
      Tx += ux * this._driftM;
      Ty += uy * this._driftM;
      Tz += uz * this._driftM;
    }
    this._invInertia(Tx, Ty, Tz);
    o.x += this._ox * dt;
    o.y += this._oy * dt;
    o.z += this._oz * dt;

    // a suspension that has run out of travel is the body sitting on the road: stop it going further, lift it out
    let lift = 0, liftX = 0, liftY = 0, liftZ = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (w._travel <= sus.bump) continue;
      const s = w._sample;
      this._stop(w._rx, w._ry, w._rz, s.nx, s.ny, s.nz, 0, 0);
      const over = Math.min(w._travel - sus.bump, 0.04);
      if (over > lift) {
        lift = over;
        liftX = s.nx; liftY = s.ny; liftZ = s.nz;
      }
    }

    // ---- tyres: friction against the velocity the car now has ----------------------------------------------
    const contact = this._contact;
    // (which way the car is going over the ground, for what a slide scrubs off)
    const going = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const gx_ = going > 1 ? v.x / going : 0, gy_ = going > 1 ? v.y / going : 0, gz_ = going > 1 ? v.z / going : 0;
    let scrub = 0;
    const cosS = Math.cos(steer), sinS = Math.sin(steer);
    const cosR = Math.cos(rear), sinR = Math.sin(rear);
    let Px = 0, Py = 0, Pz = 0;
    let Qx = 0, Qy = 0, Qz = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const spec = w._spec;
      const inertia = spec.inertia + (spec.driven ? dt_.wheelInertia : 0);
      if (!w.grounded || w.load <= 0) {
        // in the air: only the brake and the engine act on it
        let omega = w.omega + (dt * w._drive) / inertia;
        const stop = (dt * w._brake) / inertia;
        omega = Math.abs(omega) <= stop ? 0 : omega - Math.sign(omega) * stop;
        w.omega = omega;
        w.spin += omega * dt;
        w._slip = 0;
        w._vlong = omega * spec.radius;
        w.slipRatio = w.slipAngle = w.skid = 0;
        continue;
      }
      const s = w._sample;
      const nx = s.nx, ny = s.ny, nz = s.nz;
      const rx = w._rx, ry = w._ry, rz = w._rz;
      // the wheel's heading, laid onto the road, and the direction to its left
      const cosW = spec.front ? cosS : cosR, sinW = spec.front ? sinS : sinR;
      let hx = fx * cosW + lx * sinW;
      let hy = fy * cosW + ly * sinW;
      let hz = fz * cosW + lz * sinW;
      const along = hx * nx + hy * ny + hz * nz;
      hx -= nx * along; hy -= ny * along; hz -= nz * along;
      const length = Math.sqrt(hx * hx + hy * hy + hz * hz);
      hx /= length; hy /= length; hz /= length;
      const sx = ny * hz - nz * hy;
      const sy = nz * hx - nx * hz;
      const sz = nx * hy - ny * hx;
      const cx = v.x + o.y * rz - o.z * ry;
      const cy = v.y + o.z * rx - o.x * rz;
      const cz = v.z + o.x * ry - o.y * rx;
      const vlong = cx * hx + cy * hy + cz * hz;
      const vside = cx * sx + cy * sy + cz * sz;
      contact.setup(w.load, s.grip * spec.grip, s.grip, vlong, vside, spec.give);

      // along the wheel: the wheel and the car find the slip they share at the end of the step
      const radius = spec.radius;
      const body = dt / this._massLong;
      const both = body + (dt * radius * radius) / inertia;
      const drive = w._drive;
      const brake = w._brake;
      let omega = w.omega;
      let slip = 0;
      let force = 0;
      let locked = omega === 0;
      if (!locked) {
        const way = omega > 0 ? 1 : -1;
        slip = contact.solve((omega + (dt * (drive - way * brake)) / inertia) * radius - vlong, both);
        force = contact.forceX(slip);
        const next = omega + (dt * (drive - way * brake - radius * force)) / inertia;
        if (next * way <= 0) locked = true; // the brake has stopped it within the step
        else omega = next;
      }
      if (locked) {
        slip = contact.solve(-vlong, body);
        force = contact.forceX(slip);
        const need = drive - radius * force; // what the brake must hold for the wheel to stay still
        omega = 0;
        if (Math.abs(need) > brake) {
          const way = need > 0 ? 1 : -1;
          slip = contact.solve(((dt * (drive - way * brake)) / inertia) * radius - vlong, both);
          force = contact.forceX(slip);
          omega = (dt * (drive - way * brake - radius * force)) / inertia;
          if (omega * way < 0) omega = 0;
        }
      }
      // across it: the curve's force, but never more than stops the patch's sideways motion in this step; and a
      // tyre leant far over on its shoulder lets go, so a car up on two wheels slides rather than trips
      let side = contact.forceY(slip) * clamp01((w._facing - sus.tripEnd) / (sus.tripStart - sus.tripEnd));
      const stops = (this._massLat * Math.abs(vside)) / dt;
      if (side > stops) side = stops;
      else if (side < -stops) side = -stops;

      w.omega = omega;
      w.spin += omega * dt;
      w._slip = slip;
      w._vlong = vlong;
      const ref = Math.max(Math.abs(vlong), 1);
      w.slipRatio = slip / ref;
      w.slipAngle = Math.atan2(-vside, ref);
      const sliding = Math.sqrt(slip * slip + vside * vside);
      // the squeal, the marks and the smoke: from a little before the limit (about 85 % of the grip), about a
      // quarter at it, growing past it; quiet when the patch hardly moves over the road however hard it works
      const q = p.tyre.squeal;
      w.skid = clamp01((contact.rho - q.from) / q.span) * clamp01((sliding - q.slide) / q.slideSpan);

      const gx = hx * force + sx * side;
      const gy = hy * force + sy * side;
      const gz = hz * force + sz * side;
      scrub += side * (sx * gx_ + sy * gy_ + sz * gz_); // the part of the sideways force that pushes against the car's motion
      Px += gx; Py += gy; Pz += gz;
      Qx += ry * gz - rz * gy;
      Qy += rz * gx - rx * gz;
      Qz += rx * gy - ry * gx;
    }
    if (this._relief > 0 && scrub < 0) {
      // the slide help gives back part of what the sideways tyres take from the car's speed
      const push = -scrub * this._relief;
      Px += gx_ * push; Py += gy_ * push; Pz += gz_ * push;
    }
    v.x += Px * this._invMass * dt;
    v.y += Py * this._invMass * dt;
    v.z += Pz * this._invMass * dt;
    this._invInertia(Qx, Qy, Qz);
    o.x += this._ox * dt;
    o.y += this._oy * dt;
    o.z += this._oz * dt;

    // A verge taken sideways at speed is a ramp, and so is a crest. This is a road car on a road: it may go light,
    // but the ground under it never falls away faster than a firm rebound of the springs, and it is not flicked
    // onto its side: roll and pitch can only be so quick, and die away once the body leans well beyond its springs.
    const under = this._centre;
    const away = v.x * under.nx + v.y * under.ny + v.z * under.nz - sus.release;
    if (away > 0) {
      v.x -= under.nx * away;
      v.y -= under.ny * away;
      v.z -= under.nz * away;
    }
    const pitchRate = o.x * lx + o.y * ly + o.z * lz;
    const rollRate = o.x * fx + o.y * fy + o.z * fz;
    const leaning = clamp01((sus.tripStart - (ux * under.nx + uy * under.ny + uz * under.nz)) / (sus.tripStart - sus.tripEnd));
    const fade = Math.exp(-dt * sus.leanDamping * leaning);
    const dp = clamp(pitchRate * fade, -sus.tumble, sus.tumble) - pitchRate;
    const dr = clamp(rollRate * fade, -sus.tumble, sus.tumble) - rollRate;
    o.x += lx * dp + fx * dr;
    o.y += ly * dp + fy * dr;
    o.z += lz * dp + fz * dr;

    // ---- the pose ---------------------------------------------------------------------------------------------
    com.x += v.x * dt + liftX * lift;
    com.y += v.y * dt + liftY * lift;
    com.z += v.z * dt + liftZ * lift;
    const q = this.quaternion;
    const hx_ = 0.5 * dt * o.x, hy_ = 0.5 * dt * o.y, hz_ = 0.5 * dt * o.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x = qx + hx_ * qw + hy_ * qz - hz_ * qy;
    q.y = qy - hx_ * qz + hy_ * qw + hz_ * qx;
    q.z = qz + hx_ * qy - hy_ * qx + hz_ * qw;
    q.w = qw - hx_ * qx - hy_ * qy - hz_ * qz;
    q.normalize();
    this._axes();

    // ---- what is solid ----------------------------------------------------------------------------------------
    this._edges(dt);
    this.upsideDown = this._uy < 0.15;
    if (this._uy < 0.8) this._shell();
    this._sync();

    // ---- the slide, as a game might score it ------------------------------------------------------------------
    const sl = this.slide;
    const angle = Math.abs(this.slideAngle) * (180 / Math.PI);
    const scoring = this.drift > 0.5 && angle > help.scoreFrom && vLong > help.scoreSpeed;
    if (this._touching || angle > help.scoreSpin) {
      // against an edge or round too far: the slide in progress counts for nothing
      sl.score = 0;
      sl.time = 0;
      sl.last = 0;
    }
    if (scoring) {
      this._slideQuiet = 0;
      sl.time += dt;
      sl.score += ((angle - help.scoreFrom) * vLong * dt) / 100;
    } else if (sl.time > 0) {
      this._slideQuiet += dt;
      if (this._slideQuiet > help.scoreEnd) {
        // it has ended cleanly: it counts
        sl.last = sl.score;
        sl.total += sl.score;
        if (sl.score > sl.best) sl.best = sl.score;
        sl.score = 0;
        sl.time = 0;
      }
    }
    sl.angle = this.drift > 0.5 ? angle : 0;

    // ---- has it come to rest? --------------------------------------------------------------------------------
    if (holding && grounded === 4 && v.lengthSq() < 0.0016 && o.lengthSq() < 0.0016 && !this._touching) {
      this._restTime += dt;
      if (this._restTime > 0.5) {
        this._asleep = true;
        this._still();
      }
    } else this._restTime = 0;
  }

  /** A step of a car left standing: nothing moves; the engine idles and the lamps of the assists go out. */
  _idle(dt, pedal) {
    const d = this._drivetrain;
    d.update(dt, 0, 1, pedal, 0, 0, 0, this._reverse);
    this.rpm = d.rpm;
    this.gear = d.gear;
    this.throttle = 0;
    this.brake = pedal;
    const fade = Math.min(1, dt * 20);
    this.assists.abs -= this.assists.abs * fade;
    this.assists.tc -= this.assists.tc * fade;
    this.assists.esc -= this.assists.esc * fade;
    this.scrape -= this.scrape * fade;
    for (const w of this.wheels) w.skid = w.slipRatio = w.slipAngle = 0;
  }

  /**
   * The solid edges of the road. The body's outline may not be further from the centre line than the track says;
   * a point that is gets an impulse in the ground plane (it bounces a little, rubs, and turns the car by its lever
   * arm) and the car is moved back by as much as the deepest point is through.
   */
  _edges(dt) {
    const p = this.params;
    const track = this.track;
    const com = this._com;
    const v = this.velocity;
    const o = this.angularVelocity;
    const lx = this._lx, lz = this._lz, fx = this._fx, fz = this._fz;
    // the root of the model, on the ground plane
    const ox = com.x - (lx * p.com.x + this._ux * p.com.y + fx * p.com.z);
    const oz = com.z - (lz * p.com.x + this._uz * p.com.y + fz * p.com.z);
    // Where the car is on the track (what s, lat and sky report), and whether any of it can be near an edge at all:
    // most of the time it cannot, and the eight questions below need not be asked.
    const centre = this._centre;
    track.surfaceAt(ox, oz, this._centreHint, centre);
    this._centreHint = centre.index;
    if (centre.edgeL - centre.lat > this._reach && centre.edgeR + centre.lat > this._reach) {
      this._touching = false;
      this._edgeQuiet += dt;
      if (this._edgeQuiet > p.edges.apart) this._edgePeak = 0;
      this.scrape -= this.scrape * Math.min(1, dt * 18);
      return;
    }
    const yawMobility = this._ly * this._ly * this._invIx + this._uy * this._uy * this._invIy + this._fy * this._fy * this._invIz;
    const outline = this._outline;
    let deepL = 0, deepLx = 0, deepLz = 0;
    let deepR = 0, deepRx = 0, deepRz = 0;
    let rub = 0;
    let touching = false;
    for (let i = 0; i < 8; i++) {
      const ax = outline[i * 2], az = outline[i * 2 + 1];
      const wx = ox + lx * ax + fx * az;
      const wz = oz + lz * ax + fz * az;
      const s = this._outlineSamples[i];
      track.surfaceAt(wx, wz, this._outlineHints[i], s);
      this._outlineHints[i] = s.index;
      const overL = s.lat - s.edgeL;
      const overR = -s.lat - s.edgeR;
      if (!(overL > 0) && !(overR > 0)) continue;
      touching = true;
      const left = overL > 0;
      const over = left ? overL : overR;
      // the way back onto the road: across the track, level
      let nx = track.lx ? track.lx[s.index] : 1;
      let nz = track.lz ? track.lz[s.index] : 0;
      const length = Math.sqrt(nx * nx + nz * nz) || 1;
      nx /= left ? -length : length;
      nz /= left ? -length : length;
      if (left) {
        if (over > deepL) { deepL = over; deepLx = nx; deepLz = nz; }
      } else if (over > deepR) { deepR = over; deepRx = nx; deepRz = nz; }

      const rx = wx - com.x, rz = wz - com.z;
      const px = v.x + o.y * rz;
      const pz = v.z - o.y * rx;
      const closing = px * nx + pz * nz;
      if (closing >= 0) continue;
      const kinds = track.kindL && track.kindR ? (left ? track.kindL : track.kindR) : null;
      const kind = kinds ? kinds[s.index] : 0;
      const material = p.edges.kinds[kind] || p.edges.kinds[0];
      const armN = rz * nx - rx * nz;
      const bounce = material.restitution * clamp01((-closing - 0.5) / 2);
      const jn = (-(1 + bounce) * closing) / (this._invMass + armN * armN * yawMobility);
      const tx = nz, tz = -nx;
      const along = px * tx + pz * tz;
      const armT = rz * tx - rx * tz;
      const jt = clamp(-along / (this._invMass + armT * armT * yawMobility), -material.friction * jn, material.friction * jn);
      const jx = nx * jn + tx * jt;
      const jz = nz * jn + tz * jt;
      v.x += jx * this._invMass;
      v.z += jz * this._invMass;
      o.y += (rz * jx - rx * jz) * yawMobility;
      // What it is pressed against also holds it by friction against riding up or down (measured square to the
      // road, which the edge follows up hill and down): a nose that has climbed the verge is stopped there, not
      // left to rear up the rock.
      const ux = centre.nx, uy = centre.ny, uz = centre.nz;
      const rising = (v.x + o.y * rz) * ux + (v.y + o.z * rx - o.x * rz) * uy + (v.z - o.y * rx) * uz;
      const jv = clamp(-rising / this._mobility(rx, 0, rz, ux, uy, uz), -material.friction * jn, material.friction * jn);
      this._push(rx, 0, rz, ux * jv, uy * jv, uz * jv);
      rub = Math.max(rub, Math.abs(along));
      // One knock per meeting with the edge: the corner that arrives first is reported, and what follows while the
      // car is still against it (the tail swinging in, the bounces of a scrape) only if it is clearly harder.
      if (-closing > p.edges.impactSpeed && -closing > this._edgePeak * p.edges.again) {
        this._impact(-closing, wx, com.y, wz, nx, 0, nz, 'edge', kind);
        this._edgePeak = -closing;
      }
    }
    this._edgeQuiet = touching ? 0 : this._edgeQuiet + dt;
    if (this._edgeQuiet > p.edges.apart) this._edgePeak = 0;
    com.x += deepLx * deepL + deepRx * deepR;
    com.z += deepLz * deepL + deepRz * deepR;
    this._touching = touching;
    this.scrape += ((touching ? clamp01(rub / 8) : 0) - this.scrape) * Math.min(1, dt * 18);
  }

  /** A car on its side or its roof: the corners of the body against the ground, without bounce. */
  _shell() {
    const p = this.params;
    const com = this._com;
    const box = p.box;
    let lift = 0;
    for (let i = 0; i < 8; i++) {
      const ax = (i & 1 ? -box.halfWidth : box.halfWidth) - p.com.x;
      const ay = (i & 2 ? box.top : box.bottom) - p.com.y;
      const az = (i & 4 ? box.rear : box.front) - p.com.z;
      const rx = this._lx * ax + this._ux * ay + this._fx * az;
      const ry = this._ly * ax + this._uy * ay + this._fy * az;
      const rz = this._lz * ax + this._uz * ay + this._fz * az;
      const s = this._outlineSamples[i];
      this.track.surfaceAt(com.x + rx, com.z + rz, this._outlineHints[i], s);
      this._outlineHints[i] = s.index;
      const depth = (s.y - (com.y + ry)) * s.ny;
      if (depth <= 0) continue;
      this._stop(rx, ry, rz, s.nx, s.ny, s.nz, 0.7, 0);
      lift = Math.max(lift, Math.min(depth, 0.05));
    }
    com.y += lift;
  }

  /**
   * A point of the body (at r from the centre of mass) has met something with normal n: take away the velocity it
   * has into it (times 1 + bounce) and rub off its sliding with the given friction.
   */
  _stop(rx, ry, rz, nx, ny, nz, friction, bounce) {
    const v = this.velocity;
    const o = this.angularVelocity;
    let cx = v.x + o.y * rz - o.z * ry;
    let cy = v.y + o.z * rx - o.x * rz;
    let cz = v.z + o.x * ry - o.y * rx;
    const closing = cx * nx + cy * ny + cz * nz;
    if (closing >= 0) return 0;
    const jn = (-(1 + bounce) * closing) / this._mobility(rx, ry, rz, nx, ny, nz);
    this._push(rx, ry, rz, nx * jn, ny * jn, nz * jn);
    if (friction > 0) {
      cx = v.x + o.y * rz - o.z * ry;
      cy = v.y + o.z * rx - o.x * rz;
      cz = v.z + o.x * ry - o.y * rx;
      const into = cx * nx + cy * ny + cz * nz;
      cx -= nx * into; cy -= ny * into; cz -= nz * into;
      const sliding = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (sliding > 1e-4) {
        cx /= sliding; cy /= sliding; cz /= sliding;
        const jt = Math.min(sliding / this._mobility(rx, ry, rz, cx, cy, cz), friction * jn);
        this._push(rx, ry, rz, -cx * jt, -cy * jt, -cz * jt);
      }
    }
    return -closing;
  }

  /** How much velocity along n a unit impulse along n gives the point at r (1 / the mass felt there). */
  _mobility(rx, ry, rz, nx, ny, nz) {
    this._invInertia(ry * nz - rz * ny, rz * nx - rx * nz, rx * ny - ry * nx);
    const ax = this._oy * rz - this._oz * ry;
    const ay = this._oz * rx - this._ox * rz;
    const az = this._ox * ry - this._oy * rx;
    return this._invMass + ax * nx + ay * ny + az * nz;
  }

  /** An impulse j at r from the centre of mass. */
  _push(rx, ry, rz, jx, jy, jz) {
    const v = this.velocity;
    const o = this.angularVelocity;
    v.x += jx * this._invMass;
    v.y += jy * this._invMass;
    v.z += jz * this._invMass;
    this._invInertia(ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx);
    o.x += this._ox;
    o.y += this._oy;
    o.z += this._oz;
  }

  /** World inverse inertia times a vector, into _ox, _oy, _oz. */
  _invInertia(x, y, z) {
    const a = (x * this._lx + y * this._ly + z * this._lz) * this._invIx;
    const b = (x * this._ux + y * this._uy + z * this._uz) * this._invIy;
    const c = (x * this._fx + y * this._fy + z * this._fz) * this._invIz;
    this._ox = this._lx * a + this._ux * b + this._fx * c;
    this._oy = this._ly * a + this._uy * b + this._fy * c;
    this._oz = this._lz * a + this._uz * b + this._fz * c;
  }

  /**
   * Rear-axle steering: the share of the front wheels' angle that the rear wheels take, the same way, at a speed
   * (m/s). It is `steering.rear.share` of what would let the car corner with no body slip at all: nothing below
   * about 85 km/h, growing with speed. The rear tyres then answer the steering at once instead of waiting for the
   * body to swing round to its slip angle, and that swing is what makes a car dart and then settle at speed.
   * @param {number} speed
   */
  rearShare(speed) {
    const v2 = speed * speed;
    return Math.max(0, (this.params.steering.rear.share * (this._rearA * v2 - this._b)) / (this._a + this._rearB * v2));
  }

  /**
   * Choose an assist level: an entry of ASSISTS.levels in game/config.js (which says what each field means), or
   * null for the bare switches of assistsOn. The hands read the level from the car (PlayerDriver).
   * @param {object|null} level
   */
  setAssists(level) {
    this.level = level;
    if (!level) return;
    this.assistsOn.abs = level.abs !== false;
    this.assistsOn.tc = !!level.tc;
    this.assistsOn.esc = !!level.esc;
  }

  /** The body's axes in world space, from the quaternion. */
  _axes() {
    const q = this.quaternion;
    const x = q.x, y = q.y, z = q.z, w = q.w;
    this._lx = 1 - 2 * (y * y + z * z); this._ly = 2 * (x * y + z * w); this._lz = 2 * (x * z - y * w);
    this._ux = 2 * (x * y - z * w); this._uy = 1 - 2 * (x * x + z * z); this._uz = 2 * (y * z + x * w);
    this._fx = 2 * (x * z + y * w); this._fy = 2 * (y * z - x * w); this._fz = 1 - 2 * (x * x + y * y);
  }

  /** What the outside reads, from the body's state. */
  _sync() {
    const p = this.params;
    const com = this._com;
    this.position.set(
      com.x - (this._lx * p.com.x + this._ux * p.com.y + this._fx * p.com.z),
      com.y - (this._ly * p.com.x + this._uy * p.com.y + this._fy * p.com.z),
      com.z - (this._lz * p.com.x + this._uz * p.com.y + this._fz * p.com.z),
    );
    this.yaw = Math.atan2(this._fx, this._fz);
    const v = this.velocity;
    this.speed = v.x * this._fx + v.y * this._fy + v.z * this._fz;
  }

  _still() {
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    for (const w of this.wheels) w.omega = 0;
    this._sync();
  }

  /** Where on the track the car is, and the two clocks the reset rule goes by. */
  _locate(dt) {
    const track = this.track;
    const s = this._centre;
    if (this._touching || dt === 0) {
      // the edge has just moved the car, or it has just been put down: ask again
      track.surfaceAt(this.position.x, this.position.z, this._centreHint, s);
      this._centreHint = s.index;
    }
    this.trackIndex = s.index;
    this.s = s.s;
    this.lat = s.lat;
    this.sky = s.sky;
    const moving = Math.abs(this.speed) > 0.7;
    const asking = this._asking;
    if (this.upsideDown || (asking && !moving)) this.stuckTime += dt;
    else if (Math.abs(this.speed) > 2 || !asking) this.stuckTime = 0;
    if (track.tx && track.tz) {
      const facing = this._fx * track.tx[s.index] + this._fz * track.tz[s.index];
      if (facing < -0.3) this.wrongWayTime += dt;
      else if (facing > 0) this.wrongWayTime = 0;
    }
  }

  _impact(strength, x, y, z, nx, ny, nz, kind, edgeKind) {
    const list = this.impacts;
    let slot;
    if (list.length < MAX_IMPACTS) {
      slot = this._impactPool[list.length];
      list.push(slot);
    } else {
      slot = list[0];
      for (let i = 1; i < list.length; i++) if (list[i].strength < slot.strength) slot = list[i];
      if (slot.strength >= strength) return;
    }
    slot.strength = strength;
    slot.x = x; slot.y = y; slot.z = z;
    slot.nx = nx; slot.ny = ny; slot.nz = nz;
    slot.kind = kind;
    slot.edgeKind = edgeKind;
  }
}

// ---------------------------------------------------------------------------------------------------------------

const boxA = { cx: 0, cz: 0, fx: 0, fz: 1, lx: 1, lz: 0, half: 0, halfWidth: 0 };
const boxB = { cx: 0, cz: 0, fx: 0, fz: 1, lx: 1, lz: 0, half: 0, halfWidth: 0 };

/** The car's box on the ground plane: centre, forward and left axes, half length and half width. */
function footprint(vehicle, out) {
  const box = vehicle.params.box;
  let fx = vehicle._fx, fz = vehicle._fz;
  const length = Math.sqrt(fx * fx + fz * fz) || 1;
  fx /= length;
  fz /= length;
  const mid = (box.front + box.rear) / 2;
  out.fx = fx;
  out.fz = fz;
  out.lx = fz;
  out.lz = -fx;
  out.cx = vehicle.position.x + fx * mid;
  out.cz = vehicle.position.z + fz * mid;
  out.half = (box.front - box.rear) / 2;
  out.halfWidth = box.halfWidth;
  return out;
}

/** How far box b reaches along a unit direction (its support radius). */
const reach = (box, x, z) => Math.abs(box.fx * x + box.fz * z) * box.half + Math.abs(box.lx * x + box.lz * z) * box.halfWidth;

/**
 * Two cars against each other: their boxes on the ground plane. Where they overlap they are pushed apart along the
 * axis of least overlap (half each) and exchange an impulse there, with a little bounce and some rubbing, each
 * turned by its own lever arm. Call once per fixed step after both have stepped; the overlap a step can create at a
 * closing speed of 100 m/s is less than half a car's width, so the axis found is always the side they came from.
 * @param {Vehicle} a
 * @param {Vehicle} b
 * @returns {boolean} whether they touched
 */
export function collideVehicles(a, b) {
  const dy = a._com.y - b._com.y;
  if (dy > a.params.box.top || -dy > b.params.box.top) return false; // one is passing over the other
  const A = footprint(a, boxA);
  const B = footprint(b, boxB);
  const dx = A.cx - B.cx, dz = A.cz - B.cz;
  if (dx * dx + dz * dz > (A.half + A.halfWidth + B.half + B.halfWidth) ** 2) return false;
  // separating axes: the four face normals
  let least = Infinity, nx = 0, nz = 0;
  for (let i = 0; i < 4; i++) {
    const box = i < 2 ? A : B;
    const ax = i & 1 ? box.lx : box.fx;
    const az = i & 1 ? box.lz : box.fz;
    const gap = Math.abs(dx * ax + dz * az);
    const overlap = reach(A, ax, az) + reach(B, ax, az) - gap;
    if (overlap <= 0) return false;
    if (overlap < least) {
      least = overlap;
      const way = dx * ax + dz * az < 0 ? -1 : 1; // from b towards a
      nx = ax * way;
      nz = az * way;
    }
  }
  // where: the middle of the corners of each that are inside the other, or failing that between the centres
  let px = 0, pz = 0, count = 0;
  for (let k = 0; k < 2; k++) {
    const box = k ? B : A;
    const other = k ? A : B;
    for (let i = 0; i < 4; i++) {
      const x = box.cx + box.fx * (i & 1 ? -box.half : box.half) + box.lx * (i & 2 ? -box.halfWidth : box.halfWidth);
      const z = box.cz + box.fz * (i & 1 ? -box.half : box.half) + box.lz * (i & 2 ? -box.halfWidth : box.halfWidth);
      const ex = x - other.cx, ez = z - other.cz;
      if (Math.abs(ex * other.fx + ez * other.fz) <= other.half + 1e-6 && Math.abs(ex * other.lx + ez * other.lz) <= other.halfWidth + 1e-6) {
        px += x;
        pz += z;
        count++;
      }
    }
  }
  if (count) {
    px /= count;
    pz /= count;
  } else {
    px = (A.cx + B.cx) / 2;
    pz = (A.cz + B.cz) / 2;
  }

  const ca = a._com, cb = b._com;
  const va = a.velocity, vb = b.velocity;
  const oa = a.angularVelocity, ob = b.angularVelocity;
  const rax = px - ca.x, raz = pz - ca.z;
  const rbx = px - cb.x, rbz = pz - cb.z;
  const ka = a._invIy, kb = b._invIy;
  // velocity of a's point relative to b's, in the ground plane
  const rvx = va.x + oa.y * raz - (vb.x + ob.y * rbz);
  const rvz = va.z - oa.y * rax - (vb.z - ob.y * rbx);
  const closing = rvx * nx + rvz * nz;
  if (closing < 0) {
    const material = a.params.contact;
    const armA = raz * nx - rax * nz, armB = rbz * nx - rbx * nz;
    const bounce = material.restitution * clamp01((-closing - 0.5) / 2);
    const jn = (-(1 + bounce) * closing) / (a._invMass + b._invMass + armA * armA * ka + armB * armB * kb);
    const tx = nz, tz = -nx;
    const along = rvx * tx + rvz * tz;
    const tA = raz * tx - rax * tz, tB = rbz * tx - rbx * tz;
    const limit = material.friction * jn;
    const jt = clamp(-along / (a._invMass + b._invMass + tA * tA * ka + tB * tB * kb), -limit, limit);
    const jx = nx * jn + tx * jt;
    const jz = nz * jn + tz * jt;
    va.x += jx * a._invMass;
    va.z += jz * a._invMass;
    oa.y += (raz * jx - rax * jz) * ka;
    vb.x -= jx * b._invMass;
    vb.z -= jz * b._invMass;
    ob.y -= (rbz * jx - rbx * jz) * kb;
    if (-closing > a.params.edges.impactSpeed) {
      a._impact(-closing, px, ca.y, pz, nx, 0, nz, 'car', 0);
      b._impact(-closing, px, cb.y, pz, -nx, 0, -nz, 'car', 0);
    }
  }
  const share = a._invMass / (a._invMass + b._invMass);
  ca.x += nx * least * share;
  ca.z += nz * least * share;
  cb.x -= nx * least * (1 - share);
  cb.z -= nz * least * (1 - share);
  a._asleep = b._asleep = false;
  a._sync();
  b._sync();
  return true;
}
