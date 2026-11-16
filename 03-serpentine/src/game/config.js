// Tuning numbers of the run, defined once. Everything in game/ reads them
// from here; `__serp.set('camera.chase.distance', 6)` changes them on a
// running page. (What is true of the car is in assets/car/spec.js, the light
// in assets/world/lighting.js, the road in the Track.)

/** The rules. */
export const RULES = {
  laps: 3,
};

/** Each driver's car: the first is the owner's silver one. */
export const DRIVERS = [
  { paint: 'silver', plate: 'AI LAB03', keys: 'wasd' },
  { paint: 'graphite', plate: 'AI LAB04', keys: 'arrows' },
];

/** Every view's lens. */
export const VIEW = {
  near: 0.25,
  far: 5000,
  /** Shutter: the fraction of a frame's movement that is smeared (0 = none). */
  motionBlur: 0.5,
};

/**
 * The cameras. Distances are from the car's origin (on the ground, midway between the axles) in metres, lenses
 * in degrees top to bottom on a wide picture.
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
    fastSpeed: 60,
    /** How much of the angle between where the car points and where it is going the camera takes up. */
    slide: 0.55,
    /** How quickly it swings round behind the car, and how lazily it follows height (1/s). */
    yawRate: 4.6,
    heightRate: 3,
    /** On a picture narrower than 4:3 (a phone held upright, half a split screen) it backs off and lifts by up to: */
    narrowBack: 1.35,
    narrowLift: 1.25,
  },
};

/** How fast the exposure follows the light (1/s): about a second to recover on leaving the tunnel. */
export const EXPOSURE = { rate: 2.2 };

/**
 * What the car's lamps do in each automatic state (the values handed to CarModel.setLights). With the head lamps
 * on, the running lights dim to position lights, as on the real car.
 */
export const LAMPS = {
  drl: { drl: 1, low: 0, tail: 0 },
  low: { drl: 0.12, low: 1, tail: 1 },
};
