// Tuning numbers of the run, defined once. Everything in game/ reads them
// from here; `__serp.set('camera.chase.distance', 6)` changes them on a
// running page. (What is true of the car is in assets/car/spec.js, the light
// in assets/world/lighting.js, the road in the Track.)
//
// Times inside the run are simulated seconds; lap times are whole
// milliseconds, the one integer every reader uses.

/** The rules of a run. */
export const RULES = {
  laps: 3,
  /**
   * The start. The race clock begins at -(sweep + settle + lamps before go + hold): the camera sweeps for `sweep`
   * s and settles for `settle` s, the five lamps come on one every `lampStep` s, then a hold drawn from
   * rng.fork('start') between `holdMin` and `holdMax` s, then all go out: go (clock 0).
   */
  sweep: 2.5,
  settle: 0.5,
  lampStep: 0.7,
  lamps: 5,
  holdMin: 0.5,
  holdMax: 1.5,
  /** A line is taken only by forward progress of less than this in one step (m): a put-back never takes one. */
  lineJump: 30,
  /** In split screen the run ends this long after the first car finishes, if the other has not (s). */
  finishWait: 30,
  /** Put back on the road: offered after this long stuck, on the roof, or driving the wrong way (s). */
  offerStuck: 3,
  offerRoof: 1.5,
  offerWrongWay: 4,
  /** On its roof this long and the car is put back unasked (s). */
  roofReset: 4,
  /** Where a put-back puts the car: no further from the centre line than this (m). */
  resetLat: 4.25 - 1.3,
  /** Lap targets for the medals, flying laps (ms). The autopilot laps in 108.4 s at full pace, 118.4 s at 0.9. */
  medals: { gold: 112000, silver: 120000, bronze: 135000 },
  /** Rows kept on the board per time of day. */
  boardRows: 5,
  /** The live gap uses the best lap's time at every this many metres. */
  gapStep: 10,
  /** How hard the autopilot drives: ?ap, and the lap home after the flag. */
  autopilotPace: 0.9,
  cooldownPace: 0.6,
  /** Nobody at the controls on the title this long (s) and the autopilot drives a lap behind the menu. */
  attractIdle: 25,
};

/** Each driver's car and keys: the first is the owner's silver one. `bias`: the autopilot's lane in split screen. */
export const DRIVERS = [
  { paint: 'silver', plate: 'AI LAB03', keys: 'wasd', bias: 1.4 },
  { paint: 'graphite', plate: 'AI LAB04', keys: 'arrows', bias: -1.4 },
];

/** Every view's lens. */
export const VIEW = {
  near: 0.25,
  far: 5000,
  /** Shutter, as a fraction of a sixtieth of a second, standing still and at `blurSpeed` m/s (and above). */
  motionBlurSlow: 0.3,
  motionBlur: 0.5,
  blurSpeed: 40,
  /** Day and night are switched behind a fade to black and back, each half this long (s). */
  fade: 0.25,
};

/**
 * The cameras. Distances are from the car's origin (on the ground, midway between the axles) in metres, lenses
 * in degrees top to bottom on a 16:9 picture, rates in 1/s (the reciprocal of a time constant).
 */
export const CAMERA = {
  chase: {
    distance: 5.7,
    height: 1.5,
    /** What it looks at: a point this far ahead of the car and this high. */
    lookAhead: 8,
    lookHeight: 0.45,
    fov: 50,
    /** ...widening to this as the speed signal rises from `slowSpeed` to `fastSpeed` (m/s), eased over `feelTime` s. */
    fovFast: 58,
    slowSpeed: 16.7,
    fastSpeed: 49,
    feelTime: 0.4,
    /** At speed it also settles this much lower and drops back this much further. */
    drop: 0.15,
    pullBack: 0.4,
    /** How much of the angle between where the car points and where it is going the camera takes up. */
    slide: 0.65,
    /** How quickly it swings round behind the car. */
    yawRate: 4.6,
    /**
     * Looking into the bend: the road's turn over the next `bendReach` m (more at speed) times `bendRoad`, plus the
     * yaw rate (rad/s) times `bendYawRate`, at most `bendMax` rad, followed at `bendRate`; the camera itself moves
     * `inside` m per radian of it towards the inside.
     */
    bendReach: 22,
    bendRoad: 0.3,
    bendYawRate: 0.08,
    bendMax: 0.3,
    bendRate: 2.5,
    inside: 1.5,
    /** ...and rises this much per radian of it, to see over the inside of a tight bend. */
    bendLift: 1.2,
    /** Height: followed at `heightRate` (never more than `heightSlack` m behind), the grade lazily at `gradeRate`. */
    heightRate: 5,
    heightSlack: 0.5,
    gradeRate: 1.6,
    /** How much of the climb behind the car lowers the camera (1: it keeps its height over the road behind it). */
    uphill: 0.8,
    /** The distance spring: this far back per g of acceleration (closer under braking), its frequency and damping. */
    pullPerG: 0.35,
    pullOmega: 6,
    pullDamping: 0.6,
    /** Roll of the picture: a share of the body's roll, a little against the yaw rate, followed at `rollRate`. */
    rollShare: 0.3,
    rollYawRate: 0.012,
    rollRate: 4,
    /** On a picture narrower than 4:3 (a phone held upright, a side-by-side half) it backs off and lifts by up to: */
    narrowBack: 1.3,
    narrowLift: 1.45,
    narrowAhead: 1.3,
    narrowLook: 1.0,
    /** ...and on one wider than 16:9 (a stacked half): */
    wideBack: 1.1,
    wideLift: 1.15,
  },
  far: { distance: 9.2, height: 2.5, lookAhead: 12, lookHeight: 1.2 },
  /**
   * Fixed to the body at the car's own viewpoints (VIEWPOINTS in assets/car/spec.js): the lens (widening with speed),
   * how far below level it looks (rise per metre), and how firmly it follows the body's pitch and roll.
   */
  bonnet: { fov: 56, fovFast: 62, lookDown: -0.04, firm: 30 },
  bumper: { fov: 62, fovFast: 68, lookDown: -0.01 },
  /** Shake, in radians of turn: the road at speed, more on the verge, and the knocks (strength in m/s for the full). */
  shake: { road: 0.0012, verge: 0.006, roadHz: 9, impact: 0.02, impactMove: 0.1, impactHz: 14, impactFull: 12, decay: 0.6, kick: 0.3 },
  /**
   * The title's slow circle round the parked car (rate in rad/s, slower by `linger` over the three-quarter views),
   * its radius drifting between `near` and `far` and its height between `low` and `high`.
   */
  orbit: { near: 4.6, far: 5.4, low: 1.1, high: 1.4, driftRate: 0.23, rate: 0.16, linger: 0.55, lookHeight: 0.62, fov: 38, narrowBack: 1.5 },
  /** The orbit behind the results: blended in from the chase view over `blend` s while the car rolls home. */
  results: { near: 6.2, far: 7.2, low: 1.2, high: 1.6, driftRate: 0.2, rate: 0.36, linger: 0.4, lookHeight: 0.7, fov: 44, narrowBack: 1.4, blend: 1.5 },
  /**
   * The start sweep, on the race clock (RULES.sweep): through these points in car space (x towards the middle of
   * the road), then into the chase view, looking from the car's middle out to the chase camera's point ahead.
   */
  sweep: {
    path: [
      [2.6, 0.55, 4.8],
      [4.2, 0.8, 2.0],
      [4.4, 1.05, -1.8],
      [2.6, 1.35, -5.0],
    ],
    lookHeight: 0.6,
    lookZ: 0.3,
    fov: 40,
  },
  /** Keeping clear: of a solid edge, of the ground, of the tunnel's roof (and this far beyond the portals). */
  clear: { wall: 0.6, ground: 0.45, roof: 1.2, portal: 3 },
  /** Lens limits: pictures narrower than `narrow` or wider than `wide` keep that shape's width of view. */
  lens: { narrow: 4 / 3, wide: 16 / 9, max: 100 },
  /** The camera modes C steps through. */
  modes: ['chase', 'far', 'bonnet', 'bumper'],
};

/**
 * How the eye follows the light: time constants (s) of the exposure closing down (towards brighter light: fast)
 * and opening up (towards darker light: slow).
 */
export const EXPOSURE = { close: 0.35, open: 1.2 };

/**
 * The car's automatic lamps. Under the open sky they do what the time of day asks (TimeOfDay.carLights); in the
 * tunnel the low beam comes on a moment after the sky has gone (`sky` below `tunnelSky` for `onDelay` s) and goes
 * off a while after it is back (`offDelay` s). With the head lamps on the running lights dim to position lights,
 * as on the real car.
 */
export const LIGHTS = {
  tunnelSky: 0.5,
  onDelay: 0.4,
  offDelay: 1.5,
  /** The running lights with the head lamps off and on. */
  drl: 1,
  drlDimmed: 0.12,
  /** The foot brake applied beyond this lights the brake lamps. */
  brakeOn: 0.02,
  /** Cabin glow at night. */
  interior: 0.6,
};
