// Rules and tunables in one place.

export const RULES = {
  laps: 3,
  racers: 4,
  maxPower: 5, // clean passes needed for full power
  maxMisses: 5, // missed marks before you are out
  offCourseSeconds: 5, // time allowed outside the floats
};

/** Where the hull is, in metres from the middle of the boat (the model is assets/boat.js). */
export const HULL = {
  bow: 2.3, // the sea is felt this far ahead of the middle,
  stern: 2.2, // this far astern (the wake starts here too)
  beam: 0.85, // and this far to either side
  circles: [-1.6, 0, 1.6], // collision shape: circles of CRAFT_TUNE.radius along the centre line
  engines: 3.25, // where the propellers churn, astern of the middle
  top: 1.15, // top of the canopy above the waterline
};

export const CRAFT_TUNE = {
  radius: 1.2, // collision circles (m), see HULL.circles
  gravity: 12.5,
  buoyancy: 55, // spring pulling the hull to its float line (1/s²)
  deepBuoyancy: 260, // extra push-back when a landing drives the hull under (1/(m·s²))
  heaveDamping: 9, // 1/s
  slamDrag: 2.2, // quadratic drag on a hull driving down into the water (1/m)
  thrust: 9.2, // m/s² at full throttle
  linearDrag: 0.12,
  speedAtPower: [22.6, 23.8, 24.9, 26.0, 27.1, 28.4], // top speed (m/s) per power level
  lateralGrip: 3.3, // 1/s — lower = more sideways slide
  brakeDrag: 7.5,
  yawRate: 1.28, // rad/s at the sweet spot
  bank: 0.2, // how far the hull leans into a turn (rad per rad/s of turning, at speed)
  planing: 0.09, // how far the hull climbs out of the water at speed (m)
  slopePush: 0.55, // how strongly wave faces push the craft downhill
  rollStiffness: 60,
  rollDamping: 11,
  pitchStiffness: 70,
  pitchDamping: 10.5,
};

export const KMH = 3.6;
