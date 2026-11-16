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
  bow: 1.9, // the hull meets the water under each sponson: this far ahead of the middle,
  stern: 1.9, // this far astern (the wake starts here too),
  beam: 0.77, // and this far to either side
  draft: 0.24, // keels below the waterline at rest
  circles: [-1.6, 0, 1.6], // collision shape: circles of CRAFT_TUNE.radius along the centre line
  engines: 3.25, // where the propellers churn, astern of the middle
  top: 1.15, // top of the canopy above the waterline
};

export const CRAFT_TUNE = {
  radius: 1.2, // collision circles (m), see HULL.circles
  gravity: 12.5,
  buoyancy: 55, // spring pushing each point of the hull up to its float line (1/s²)
  deepBuoyancy: 260, // extra push-back when a landing drives the hull under (1/(m·s²))
  heaveDamping: 9, // 1/s
  slamDrag: 2.2, // quadratic drag on a hull driving down into the water (1/m)
  pitchInertia: 2.6, // how hard the hull is to pitch and to roll: radius of gyration squared (m²)
  rollInertia: 0.62,
  thrust: 9.2, // m/s² at full throttle
  linearDrag: 0.12,
  speedAtPower: [22.6, 23.8, 24.9, 26.0, 27.1, 28.4], // top speed (m/s) per power level
  sideBite: 5.0, // how sharply the hulls resist going sideways at first (1/s)
  sideHold: 17, // the most sideways push the water gives before the boat drifts (m/s²)
  slideScrub: 0.055, // forward speed lost per m/s of sideways slide (1/s)
  brakeDrag: 8.5,
  yawRate: 1.3, // rad/s at the sweet spot
  yawAlign: 1.15, // how strongly a sliding hull swings to point the way it is going (1/s)
  bank: 0.2, // how far the hull leans into a turn (rad per rad/s of turning, at speed)
  planing: 0.09, // how far the hull climbs out of the water at speed (m)
  slopePush: 0.55, // how strongly wave faces push the boat downhill
};

export const KMH = 3.6;
