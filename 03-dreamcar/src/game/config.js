// Tuning numbers of the run, defined once. Everything in game/ reads them
// from here; `__dreamcar.set('camera.chase.distance', 6)` changes them on a
// running page. (What is true of the car is in assets/car/spec.js, the light
// in assets/world/lighting.js, the road in the Track.)
//
// Times inside the run are simulated seconds; lap times are whole
// milliseconds, the one integer every reader uses.

/** The rules of a run. */
import { HALF_WIDTH } from './trackLayout.js';

export const RULES = {
  laps: 3,
  /**
   * The start. The race clock begins at -(sweep + settle + lamps before go + hold): `sweep` + `settle` s before
   * the first lamp, the five lamps come on one every `lampStep` s, then a hold drawn from rng.fork('start')
   * between `holdMin` and `holdMax` s, then all go out: go (clock 0). The camera's dive (CAMERA.sweep) runs from
   * the clock's start until the last lamp lights, so it comes down while the lamps come on and is still before go.
   */
  sweep: 1.2,
  settle: 0,
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
  resetLat: HALF_WIDTH - 1.3,
  /**
   * Lap targets for the medals, flying laps (ms). The autopilot laps in 85.1 s at full pace, 92.9 s at 0.9 and
   * 103.7 s at 0.8: gold is about 3 per cent slower than full pace, silver about pace 0.9, bronze about pace 0.8.
   */
  medals: { gold: 87600, silver: 93000, bronze: 104000 },
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

/**
 * The time of day the page opens at when the URL does not say (?time=): a name lighting.js's TIMES has, or null
 * for the first time of day TIMES holds (the lead's choice: the demo opens on its first, the day).
 */
export const DEFAULT_TIME = null;

/** The HUD's moments (s of the race clock) and when its warnings and hints show. */
export const HUD = {
  /** The gap at a line stays this long; the lap's banner this long. */
  flash: 3,
  banner: 4,
  /** Driving the wrong way this long before the warning shows (s). */
  wrongWay: 1.2,
  /** The first-time hint shows until the car has covered this much road in a run (m). */
  hintDistance: 25,
};

/** Each driver's car and keys: the first is the owner's silver one. `bias`: the autopilot's lane in split screen. */
export const DRIVERS = [
  { paint: 'silver', plate: 'K1 DOMI', keys: 'wasd', bias: 2.2 },
  { paint: 'graphite', plate: 'K2 DOMI', keys: 'arrows', bias: -2.2 },
];

/** Every view's lens. */
export const VIEW = {
  near: 0.25,
  far: 5000,
  /**
   * Shutter, as a fraction of a sixtieth of a second, standing still and at `blurSpeed` m/s (and above), eased
   * between: the streaks grow faster than the speed, so at 80 km/h the roadside is nearly crisp and at 250 it
   * streaks (the engine clamps a streak per tier: 4 / 6 / 7.5 per cent of the view's width).
   */
  motionBlurSlow: 0.12,
  motionBlur: 0.9,
  blurSpeed: 70,
  /** While the camera dives at the start the shutter is cut to this share (the camera's own motion would smear all). */
  diveShutter: 0.25,
  /** How split screen shares the window: 'auto' (side by side on a wide window, stacked on a tall one), 'wide', 'tall'. */
  split: 'auto',
  /** Day and night are switched behind a fade to black and back, each half this long (s). */
  fade: 0.25,
};

/**
 * The cameras. Distances are from the car's origin (on the ground, midway between the axles) in metres, lenses
 * in degrees top to bottom on a 16:9 picture, rates in 1/s (the reciprocal of a time constant).
 */
export const CAMERA = {
  chase: {
    /** How far behind the car's origin it stands (m), at rest; it drops back `pullBack` more as the speed signal rises. */
    distance: 5.4,
    pullBack: 1.5,
    /**
     * The composition on a level straight: the horizon `horizon` of the way down the picture and the middle of the
     * car (`middle`: [height, z] in car space, m) `carAt` of the way down. The camera's height follows from them.
     */
    horizon: 0.37,
    carAt: 0.6,
    /**
     * On the grid the camera sits lower by `gridLow` and looks `gridUp` degrees above level, so the start lamps
     * are in the picture while they count; from go it eases back into the chase view over `gridOut` s.
     */
    gridLow: 0.5,
    gridUp: 4,
    gridOut: 1.6,
    /** At least this much sky (degrees) between the horizon and the picture's top edge, on every shape of screen. */
    skyAbove: 22,
    middle: [0.62, -0.4],
    /** The lens, top to bottom on a 16:9 picture: `fov` at `slowSpeed` and below, `fovFast` at `fastSpeed` (m/s) and above. */
    fov: 58,
    fovFast: 72,
    slowSpeed: 19.4,
    fastSpeed: 75,
    /** The speed signal's time constant (s): long enough that a gear change does not pump the lens. */
    feelTime: 0.6,
    /** How much of the angle between where the car points and where it is going the camera takes up. */
    slide: 0.6,
    /** How quickly it swings round behind the car: slowly, so it swings late into a bend and shows the flank. */
    yawRate: 3.4,
    /**
     * Looking into the bend: the road's turn over the next `bendReach` m (more at speed) times `bendRoad`, plus the
     * yaw rate (rad/s) times `bendYawRate`, at most `bendMax` rad, followed at `bendRate`; the camera itself moves
     * `inside` m per radian of it towards the inside.
     */
    bendReach: 30,
    bendRoad: 0.32,
    bendYawRate: 0.08,
    bendMax: 0.22,
    bendRate: 2.2,
    inside: 1.5,
    /** ...and rises this much per radian of it, to see over the inside of a tight bend. */
    bendLift: 1.0,
    /** Height: followed at `heightRate` (never more than `heightSlack` m behind), the grade lazily at `gradeRate`. */
    heightRate: 4,
    heightSlack: 0.6,
    gradeRate: 1.4,
    /** How much of the grade the composition tilts with (1: all of it). */
    uphill: 1,
    /** The distance spring: this far back per g of acceleration (closer under braking), its frequency and damping;
     * the acceleration it is driven by is low-passed over `accelTime` s. */
    pullPerG: 0.3,
    pullOmega: 5,
    pullDamping: 0.8,
    accelTime: 0.35,
    /**
     * Roll of the picture: `bankShare` of the road's banking taken up at `bankRate`, `rollShare` of the body's own
     * lean on top of it, a little against the yaw rate; followed at `rollRate`, at most `rollMax` rad.
     */
    bankShare: 0.4,
    bankRate: 2,
    rollShare: 0.25,
    rollYawRate: 0.01,
    rollRate: 4,
    rollMax: 0.12,
    /** On a picture narrower than 4:3 (a phone held upright, a side-by-side half) it backs off by up to this and
     * composes higher: more road ahead over the car. */
    narrowBack: 1.25,
    narrowHorizon: 0.3,
    narrowCarAt: 0.62,
    /** ...and on one wider than 16:9 (a stacked half): */
    wideBack: 1.05,
  },
  far: { distance: 9.5, pullBack: 1.8, horizon: 0.36, carAt: 0.6, fov: 54, fovFast: 66 },
  /**
   * Fixed to the body at the car's own viewpoints (VIEWPOINTS in assets/car/spec.js): the lens (widening with speed),
   * how far below level it looks (rise per metre), and how firmly it follows the body's pitch and roll.
   */
  bonnet: { fov: 62, fovFast: 74, lookDown: -0.04, narrowUp: 0.12, firm: 30 },
  bumper: { fov: 66, fovFast: 78, lookDown: -0.01, narrowUp: 0.12 },
  /**
   * Shake, in radians of turn: the road's, from `fromSpeed` (m/s) to full at the chase's `fastSpeed`; the verge's
   * and the kerbs' (per share of the wheels on them) at any speed; the knocks (strength in m/s for the full).
   */
  shake: { road: 0.0016, fromSpeed: 55.6, verge: 0.006, kerb: 0.004, kerbHz: 22, roadHz: 11, impact: 0.02, impactMove: 0.1, impactHz: 14, impactFull: 12, decay: 0.6, kick: 0.3 },
  /**
   * The title's hero picture: a three-quarter view (`quarter` rad round from straight behind or, mirrored, from
   * straight ahead) from low down, `distance` m out and `height` m up, swinging `swing` rad to and fro over
   * `period` s and bobbing `bob` m. Of the four three-quarter views it holds the one whose look runs `sunBeside`
   * rad beside the brightest part of the sky, front views preferred by `frontBias`. The car is framed clear of
   * the menu: on a picture at least `uprightBelow` wide for its height, `across` of the picture's width off the
   * middle away from the menu and `down` of the way down; on a narrower one in the middle, `tallDown` of the way
   * down (the menu under it). `times` may override any of these per time of day (and fix `angle`).
   */
  orbit: {
    quarter: 0.72,
    frontBias: 1.2,
    sunBeside: 1.75,
    distance: 8.6,
    height: 0.85,
    bob: 0.08,
    swing: 0.22,
    period: 36,
    lookHeight: 0.62,
    lookZ: 0,
    fov: 34,
    narrowBack: 1.0,
    uprightBelow: 1.15,
    across: 0.2,
    down: 0.56,
    tallDown: 0.3,
    // by day the sun stands down the straight: the rear three-quarter view that looks 0.75 rad off it shows the
    // gantry, the boards and the autumn trees behind a car whose paint mirrors the sky; at golden hour the sun is
    // over the lake behind the car: the view with it almost behind the camera lights the flank and the paint
    times: { day: { sunBeside: 0.75, frontBias: 0 }, dusk: { sunBeside: 2.9, frontBias: 0 } },
  },
  /** The orbit behind the results: blended in from the chase view over `blend` s while the car rolls home; framed
   * clear of the results panel the same way as the title (the panel is on the right). */
  results: {
    near: 6.4,
    far: 7.2,
    low: 1.0,
    high: 1.4,
    driftRate: 0.2,
    rate: 0.3,
    linger: 0.4,
    lookHeight: 0.62,
    fov: 40,
    narrowBack: 1.35,
    blend: 1.5,
    uprightBelow: 1.15,
    across: 0.16,
    down: 0.55,
    tallDown: 0.28,
  },
  /**
   * The start, on the race clock: a dive from `from` (car space: x towards the middle of the road, y up, z ahead;
   * m) bowing `bow` m further out on the way, onto the car's tail and into the chase view; it begins when the
   * clock does and ends as the last start lamp lights (Game.js). The look moves from a point `lookHeight` up and
   * `lookZ` ahead of the car's origin to the chase camera's.
   */
  sweep: {
    from: [9, 16, -34],
    bow: 3,
    lookHeight: 0.6,
    lookZ: 0.6,
    fov: 44,
  },
  /** Keeping clear: of a solid edge, of the ground, of the tunnel's roof (and this far beyond the portals). */
  clear: { wall: 0.6, ground: 0.45, roof: 1.2, portal: 3 },
  /** Lens limits: pictures narrower than `narrow` or wider than `wide` keep that shape's width of view. */
  lens: { narrow: 4 / 3, wide: 16 / 9, max: 96 },
  /** The camera modes C steps through. */
  modes: ['chase', 'far', 'bonnet', 'bumper'],
};

/**
 * The staging camera's named places (`?photo=d1`, `__dreamcar.photo('d1')`): the reference frames' cameras, each a
 * pose relative to the car (see Game.setPhoto) and the moment of the autopilot's run it belongs to (`t`, seconds
 * from the start of a run at RULES.autopilotPace; `time`, the time of day), used when the address does not give
 * them. D1: the run-up to the line, low behind and right of the car, yawed left; D3: the ledge's first bend, low
 * behind and left, looking down it; D4: the grid during the countdown at golden hour, low on the lake side behind
 * the car, looking forward and right at the land side with the gantry's lamps in the picture.
 */
export const PHOTOS = {
  d1: { back: 6.5, right: 3.2, up: 0.9, yaw: 17, pitch: 3.5, fov: 46, t: 100, time: 'day' },
  d3: { back: 5.5, right: -2.5, up: 1.0, yaw: -4, pitch: 4, fov: 46, t: 81, time: 'day' },
  d4: { back: 7, right: -3.5, up: 0.5, yaw: -20, pitch: 4, fov: 40, t: 4.2, time: 'dusk' },
};

/**
 * Exposure compensation (stops) on the title's hero picture and the results' orbit, so that the car itself is
 * correctly exposed whatever the time of day: `default`, or a time of day's own value. Eased in and out over
 * `ease` s through the same exposure the game drives.
 */
export const SHOWCASE = { default: 0.5, day: 0.3, dusk: 0.9, night: 0.6, ease: 0.6 };

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

/**
 * The effects of driving (game/effects.js, drawn by assets/fx/). Per tier: quads kept in each wheel's ring of
 * skid marks (they last the whole run), the most soft particles (smoke, dust, stones, spray) and sparks alive at
 * once, and a factor on every emission rate. Rates are particles a second at full strength, per wheel.
 */
export const FX = {
  tiers: {
    low: { marks: 800, soft: 192, sparks: 48, rate: 0.5 },
    medium: { marks: 1500, soft: 320, sparks: 96, rate: 0.8 },
    high: { marks: 2000, soft: 400, sparks: 128, rate: 1 },
  },
  /** A mark: a tyre's width, from this skid (Vehicle wheel.skid 0..1) to full darkness this much above it. */
  markWidth: 0.235,
  markFrom: 0.12,
  markFull: 0.45,
  /** How fast a mark fades in and out (1/s), how far apart its points are (m), its darkest alpha. */
  markEase: 10,
  markStep: 0.3,
  markDark: 0.75,
  /** On a wet road (wetness above wetFrom) marks are this much as dark, and spray replaces smoke. */
  wetFrom: 0.3,
  markWet: 0.22,
  /** Smoke from this skid up, and only once the rubber scrubs over the road faster than smokeScrub (m/s), full
   * smokeScrubFull above it: a launch's brief wheelspin is ~3-5 m/s, a locked wheel or a real slide 8-30. While an
   * assist (TC, ABS, ESC) is working, smoke is cut by up to smokeHeld. */
  smokeFrom: 0.3,
  smokeScrub: 5,
  smokeScrubFull: 10,
  smokeHeld: 0.9,
  smokeRate: 18,
  dustRate: 22,
  stoneRate: 10,
  /** Spray from this speed (m/s); rate at 25 m/s above it on a soaked road. */
  sprayFrom: 5,
  sprayRate: 40,
  /** Sparks: a burst per hit (per m/s of closing speed, at most burstMax), a stream while scraping. */
  burstPer: 2.5,
  burstMax: 40,
  scrapeFrom: 0.08,
  scrapeRate: 90,
  /** What a car's lamps lay on its own smoke and spray (irradiance at 1 m, scene units): the two head lamps on
   * dipped beam (2 x 3200 cd), main beam's gain, the tail lamps' red glow and the brake lamps' gain over it. */
  lampHead: 6400,
  highGain: 2.7,
  lampTail: 0.25,
  brakeGain: 4,
};

/**
 * The car's reflection probe, per tier: the cube's edge and how it is kept up to date. At speed (`moving`) a few
 * faces are redrawn each `every`-th frame; with the car nearly still (the title's orbit, the grid: below `stillBelow`
 * m/s, back to moving above `movingAbove`) a larger cube is redrawn whole over a few frames (`stillFaces` a frame)
 * so the paint's mirror is crisp where it is looked at closely.
 */
export const PROBE = {
  low: { size: 64, faces: 1, every: 2, stillSize: 128, stillFaces: 1 },
  medium: { size: 128, faces: 1, every: 1, stillSize: 256, stillFaces: 2 },
  high: { size: 256, faces: 2, every: 1, stillSize: 512, stillFaces: 3 },
  stillBelow: 1.5,
  movingAbove: 4,
};
