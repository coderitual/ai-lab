// The numbers of the car as a machine: springs, tyres, engine, gearbox, brakes, assists.
//
// Dimensions and mass come from assets/car/spec.js and are never repeated here; everything else in this file is either
// a published figure for the real car (engine, ratios, drag area) or a quantity the handling is tuned by, stated in the
// unit a road tester would use (ride frequency in Hz, damping ratio, roll per g) and converted once, below, into what
// the solver wants (N/m, N·s/m). tools/handling.mjs measures what these numbers produce; docs/spec.md quotes its table.

import { DIMS, MASS, STATIONS, WHEELS } from '../../assets/car/spec.js';

const GRAVITY = 9.81;
const TAU = Math.PI * 2;

/** What the handling is tuned by. */
const TUNE = {
  rideHz: { front: 1.3, rear: 1.5 },
  dampingRatio: 0.45,
  /** Anti-roll bars, as roll stiffness (N·m/rad). With the springs they give about 3.5° of roll at 1 g. */
  antiRoll: { front: 52000, rear: 22000 },
  /** A real body is not a uniform box: its mass sits lower and nearer the middle. */
  inertiaScale: 0.8,
  give: { front: 1.12, rear: 0.76 },
};

const mass = MASS.mass;
const loadFront = (mass * GRAVITY * MASS.frontShare) / 2; // on one front wheel, at rest
const loadRear = (mass * GRAVITY * (1 - MASS.frontShare)) / 2;

function corner(spec) {
  const load = spec.front ? loadFront : loadRear;
  const sprung = load / GRAVITY;
  const hz = spec.front ? TUNE.rideHz.front : TUNE.rideHz.rear;
  const spring = (TAU * hz) ** 2 * sprung;
  const damper = 2 * TUNE.dampingRatio * Math.sqrt(spring * sprung);
  const track = spec.front ? DIMS.trackFront : DIMS.trackRear;
  return {
    x: spec.x,
    z: spec.z,
    radius: spec.tyre.radius,
    front: spec.front,
    left: spec.left,
    driven: !spec.front,
    staticLoad: load,
    spring, // N/m at the wheel
    preload: load / spring, // m the spring is already squashed by when the car stands level
    damperBump: damper * 0.75, // softer going in than coming out, as on a road car
    damperRebound: damper * 1.25,
    /** Anti-roll bar as a force per metre of difference between the two wheels of the axle. */
    antiRoll: (spec.front ? TUNE.antiRoll.front : TUNE.antiRoll.rear) / (track * track),
    inertia: spec.front ? 1.5 : 1.7, // kg·m², wheel, tyre, disc and half shaft
    /** Front tyres are 225 wide, rear 245: a little more grip at the back. */
    grip: spec.front ? 1 : 1.03,
    /**
     * How late the sideways force peaks, against the tyre's own figure. The front axle gives (steering, bushes) and
     * the rear is held stiffly: that difference is the car's understeer, about 1.7° of steering per g.
     */
    give: spec.front ? TUNE.give.front : TUNE.give.rear,
  };
}

const k = (TUNE.inertiaScale * mass) / 12;

export const CAR = {
  gravity: GRAVITY,
  mass,
  /** Centre of mass in car space. */
  com: { x: 0, y: MASS.comHeight, z: MASS.comZ },
  /** Moments of inertia about the car's own axes: x is the pitch axis (the car's left), y yaw, z roll. */
  inertia: {
    x: k * (DIMS.length ** 2 + DIMS.height ** 2),
    y: k * (DIMS.length ** 2 + DIMS.width ** 2),
    z: k * (DIMS.width ** 2 + DIMS.height ** 2),
  },
  wheelbase: DIMS.wheelbase,
  /** The body as a box, car space: what touches solid edges and other cars. */
  box: {
    halfWidth: DIMS.width / 2,
    front: STATIONS.nose,
    rear: STATIONS.tail,
    bottom: DIMS.groundClearance,
    top: DIMS.height,
  },
  wheels: WHEELS.map(corner),

  suspension: {
    droop: 0.095, // m the wheel can drop from its rest position before it leaves the road
    bumpStop: 0.055, // m of compression from rest at which the rubber stop begins
    bumpStopRate: 160000, // N/m, added to the spring beyond that
    bump: 0.092, // m of compression from rest at which the suspension is solid
    damperSpeed: 2.5, // m/s beyond which the dampers blow off (no more force)
    maxLoad: 5.5, // the most one wheel can carry, in units of its static load
    release: 1.6, // m/s: the fastest the body may leave the road under it (nothing launches the car)
    tumble: 2, // rad/s: the fastest the body may roll or pitch
    /** Cosine of the lean (body against road) at which the tyres begin to let go sideways, and at which they have. */
    tripStart: Math.cos((9 * Math.PI) / 180),
    tripEnd: Math.cos((24 * Math.PI) / 180),
    leanDamping: 7, // 1/s: how quickly roll and pitch die away once the body leans that far
  },

  steering: {
    lock: 0.58, // rad at the road wheels, either way
    rate: 2.4, // rad/s the rack can move the road wheels
    /**
     * Rear-axle steering: at speed the rear wheels turn with the fronts by `share` of the angle that would hold the
     * body in line with its path (Vehicle.rearShare), never more than `most` rad.
     */
    rear: { share: 0.85, most: 0.06 },
  },

  tyre: {
    /** Peak friction at the reference load, along and across. */
    muX: 1.5,
    muY: 1.52,
    loadRef: (loadFront + loadRear) / 2,
    loadSensitivity: 0.13, // fraction of grip lost per reference load added
    /** Slip at which the force peaks. */
    kappaPeak: 0.1,
    alphaPeak: 0.135, // tan of the slip angle (about 7.7°), before each axle's give
    /** Magic Formula shape and curvature factors. The shape sets what is left when sliding: sin(C·π/2). */
    shapeX: 1.45,
    curvatureX: 0,
    shapeY: 1.3,
    curvatureY: -0.6,
    /** On a loose surface the peak comes later: slip scale = 1 + looseSlip·(1 − grip). */
    looseSlip: 1.6,
    /** wheel.skid from the combined normalised slip (1 = the peak) and the speed the patch slides at (m/s). */
    squeal: { from: 0.35, span: 0.9, slide: 0.15, slideSpan: 0.8 },
    /** Below this speed (m/s) slip is measured against it instead of the wheel's own speed. */
    minSpeed: 0.1,
  },

  /**
   * Per surface (indexed by SURFACE in game/track.js: asphalt, paved margin, grass, gravel, kerb): rolling resistance
   * coefficient, and the height (m) and length (m) of the unevenness that comes through the springs.
   */
  surfaces: [
    { rolling: 0.012, rough: 0, wavelength: 1 },
    { rolling: 0.014, rough: 0.002, wavelength: 0.9 },
    { rolling: 0.055, rough: 0.011, wavelength: 1.7 },
    { rolling: 0.085, rough: 0.008, wavelength: 0.8 },
    { rolling: 0.013, rough: 0.003, wavelength: 0.45 },
  ],
  /** Rolling resistance grows with speed: coefficient × (1 + (v / rollingSpeed)²). */
  rollingSpeed: 62,

  aero: {
    dragArea: 0.55, // Cd·A, m²
    /** Cl·A of the downforce (m²): a splitter, a lip on the boot and a flat floor; it presses the car down at speed. */
    downforceArea: 0.7,
    airDensity: 1.225,
  },

  engine: {
    /** Full-throttle torque (rpm, N·m), the hot version: 640 N·m from 2500 to 4500, 365 kW at 6300. */
    torque: [750, 300, 1000, 380, 1500, 500, 2000, 600, 2500, 640, 4500, 640, 5500, 610, 6300, 553, 6800, 500, 7200, 430],
    idle: 750,
    limiter: 7000,
    /** Closed-throttle drag (N·m) = frictionBase + frictionSlope × rpm. */
    frictionBase: 22,
    frictionSlope: 0.013,
    inertia: 0.22, // kg·m², crank, flywheel and the converter's pump
    /** How quickly torque follows the pedal (s): the turbo on the way up, the throttle on the way down. */
    riseTime: 0.11,
    fallTime: 0.05,
  },

  gearbox: {
    ratios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.6],
    reverse: 4.8,
    final: 3.07,
    efficiency: 0.9,
    /** The torque converter: the engine speed it lets a stationary car reach at full throttle, and how much it multiplies torque there. */
    stallRpm: 3000,
    stallRatio: 1.7,
    /** Shift points (rpm): light throttle, full throttle, and what it holds on to under braking. */
    upLight: 1900,
    upFull: 6850,
    brakeLight: 2400,
    brakeFull: 3700,
    /** A downshift happens when the lower gear would run below this fraction of the upshift point. */
    downFraction: 0.84,
    shiftTime: 0.16,
    kickdownTime: 0.22,
    shiftTorque: 0.3, // fraction of torque passed in the middle of a shift
    minInterval: 0.3, // s between shifts
    holdAfterLift: 1.5, // s the box holds on to a wide throttle after lifting before it starts to forget it
    holdAfterBrake: 2, // s it holds on to hard braking (the gear for the exit of the bend), unless the throttle opens
    forget: 1.2, // s to forget a full pedal once the hold is over
    reverseSpeed: 11, // m/s, where reverse runs out
  },

  differential: {
    /** A mild limited slip: torque moved from the faster to the slower wheel per rad/s of difference, up to a limit. */
    viscous: 28, // N·m per rad/s
    preload: 50, // N·m
    bias: 0.22, // fraction of the axle torque added to the limit
    /** In a slide it closes up (an active differential): this much more locking torque (N·m) and this many times more viscous. */
    slideLock: 2500,
    slideViscous: 8,
  },

  brakes: {
    /** Torque at one wheel with the pedal on the floor (N·m). About 68 % of the braking is at the front. */
    front: 3700,
    rear: 1750,
    handbrake: 3200, // on each rear wheel
    hold: 900, // on each wheel when standing with the throttle closed
  },

  topSpeed: 285 / 3.6, // m/s, where the limiter closes the throttle

  assists: {
    /** ABS, per wheel: the slip it aims for, and how fast it learns, forgets and reacts (per unit of excess slip). */
    abs: { slip: 0.115, minSpeed: 1.8, learn: 6, forget: 3, react: 0.5 },
    /** Traction control: the slip it aims for, and how fast it learns, forgets and reacts (per unit of excess slip). */
    tc: { slip: 0.085, bendSlip: 0.17, learn: 5, forget: 2.5, react: 0.35 },
    esc: {
      minSpeed: 6,
      /**
       * Characteristic speed (m/s) of the car's understeer: what yaw rate a steering angle is taken to ask for. It is
       * the car's own (measured by tools/handling.mjs: 44.7 m/s, 1.0° of steering per g in the linear range); a lower
       * figure makes ordinary cornering look like oversteer to the stability control.
       */
      characteristicSpeed: 44,
      /** The most lateral acceleration (g, on dry asphalt) the reference may ask for: the tyres' grip, more on a banked bend. */
      holdG: 1.6,
      lag: 0.12, // s, the yaw's answer to the steering, as the reference follows it
      deadband: 0.07, // rad/s of yaw-rate error let pass
      deadbandG: 1.0, // m/s²: and no more than this much lateral acceleration
      yawGain: 17000, // N·m of correcting moment per rad/s beyond that
      slipAllowed: 0.085, // rad of body slip let pass (about 5°)
      slipGain: 52000, // N·m per rad beyond that
      slipRateGain: 9000, // N·m per rad/s of the slip angle growing
      understeerGain: 0.9, // throttle trimmed per rad/s of missing yaw rate
      handbrakePause: 0.35, // s it stays out of the way after the handbrake is let go (the turn it made is wanted)
    },
  },

  /**
   * The slide help (for the assist levels that ask for it: ASSISTS in game/config.js; Vehicle.js says how it works).
   * Angles are of the rear axle's travel against the body (rad); yaw accelerations in rad/s² per rad and per rad/s.
   */
  drift: {
    minSpeed: 6, // m/s below which there is no help at all
    /** A slide begins where the rear tyres' grip peaks (about 6°) and is fully one a few degrees on. */
    from: 0.105,
    full: 0.19,
    /** The front tyres' own peak (rad): the steering into the bend that counts as all of it; and how much of it says the slide is wanted. */
    frontSlip: 0.15,
    intoFull: 0.2,
    /** s for "the driver is steering into the bend" to come and to go: a slide is wanted that long after the steering is let go. */
    stayRise: 0.1,
    stayFall: 0.5,
    /** The body is turned towards the angle asked for at `hold` per rad; a slide may grow at `damp` and come back at `dampClose` per rad/s. */
    hold: 7,
    damp: 3.5,
    dampClose: 11,
    /** The most the hand turns the car: letting the tail out, bringing it back, and catching it (rad/s²). */
    most: 5,
    mostClose: 9,
    catchMost: 16,
    /** Beyond the level's angle plus `margin`: per rad and per rad/s. At walking pace the limit opens by up to `slowSlip` (below `slowSpeed` m/s). */
    margin: 0.07,
    catch: 30,
    catchDamp: 9,
    slowSpeed: 20,
    slowSlip: 1.6,
    /** s for which the hand stays with a car that has stopped sliding, and how hard it damps a swing the other way. */
    snapMemory: 1.2,
    snapDamp: 14,
    /**
     * Asking for a slide: a lift (the throttle dropped by 1 / liftGain against its mean over liftMemory s) or the
     * brake (beyond kickBrake, for its first dabTime s) while cornering beyond kickG (fully kickSpan above) with
     * the steering hard over: the front wheels turned beyond kickInto of the slip their grip peaks at (fully
     * kickIntoSpan beyond), which is more than a tidy line ever asks for; or the handbrake. The kick fades over
     * kickTime s.
     */
    liftGain: 3,
    liftMemory: 0.5,
    kickBrake: 0.15,
    dabTime: 0.6,
    kickG: 0.5,
    kickSpan: 0.3,
    kickInto: 0.7,
    kickIntoSpan: 0.25,
    kickTime: 0.8,
    /** m/s above which a level's slide angle narrows in proportion to the speed. */
    slipSpeed: 35,
    /** The most wheelspin (slip ratio) the traction control adds in a slide, however far sideways. */
    spinMost: 1.2,
    /** The slide's score: from this angle (degrees) and speed (m/s); beyond scoreSpin degrees it is a spin; it counts once the car has not slid for scoreEnd s. */
    scoreFrom: 10,
    scoreSpeed: 11,
    scoreSpin: 100,
    scoreEnd: 0.6,
  },

  edges: {
    /** Per EDGE kind in game/track.js (rail, rock, wall, parapet, trees): bounce and sliding friction. */
    kinds: [
      { restitution: 0.22, friction: 0.22 },
      { restitution: 0.12, friction: 0.5 },
      { restitution: 0.15, friction: 0.32 },
      { restitution: 0.15, friction: 0.32 },
      { restitution: 0.08, friction: 0.6 },
    ],
    impactSpeed: 0.6, // m/s of closing speed below which a touch is not reported as an impact
    again: 1.5, // while still against the edge, a knock is reported only if this many times harder than the last
    apart: 0.3, // s off the edge after which the next touch is a new meeting
  },

  /** Car against car. */
  contact: { restitution: 0.18, friction: 0.35 },
};
