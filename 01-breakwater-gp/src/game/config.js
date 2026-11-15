// Rules and tunables in one place.

export const RULES = {
  laps: 3,
  racers: 4,
  maxPower: 5, // clean passes needed for full power
  maxMisses: 5, // missed marks before you are out
  offCourseSeconds: 5, // time allowed outside the floats
};

export const CRAFT_TUNE = {
  radius: 1.15, // collision circle (m)
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
  slopePush: 0.55, // how strongly wave faces push the craft downhill
  rollStiffness: 60,
  rollDamping: 11,
  pitchStiffness: 70,
  pitchDamping: 10.5,
};

export const KMH = 3.6;
