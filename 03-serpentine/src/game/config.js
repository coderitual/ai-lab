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
 * in degrees top to bottom on a wide picture. (A first version: the real rigs come with the camera stage.)
 */
export const CAMERA = {
  chase: {
    distance: 5.7,
    height: 1.45,
    /** What it looks at: a point this far ahead of the car and this high. */
    lookAhead: 8,
    lookHeight: 1.0,
    fov: 50,
    /** ...widening to this at `fastSpeed`. */
    fovFast: 58,
    fastSpeed: 49,
    /** How much of the angle between where the car points and where it is going the camera takes up. */
    slide: 0.55,
    /** How quickly it swings round behind the car, and how lazily it follows height (1/s). */
    yawRate: 4.6,
    heightRate: 3,
    /** On a picture narrower than 4:3 (a phone held upright, half a split screen) it backs off and lifts by up to: */
    narrowBack: 1.35,
    narrowLift: 1.25,
  },
  far: { distance: 9.5, height: 2.6, lookAhead: 10, lookHeight: 1.0 },
  /** Fixed to the body at the car's own viewpoints (VIEWPOINTS in assets/car/spec.js): how far ahead they look, and the lens. */
  bonnet: { lookAhead: 20, fov: 60 },
  bumper: { lookAhead: 20, fov: 62 },
  /** The title's slow circle round the parked car (rate in rad/s). */
  orbit: { distance: 7.2, height: 1.6, rate: 0.12, lookHeight: 0.7, fov: 42 },
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
