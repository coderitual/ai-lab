// The outline of the pond, defined once.
//
// The shore is a circle whose radius swells and shrinks a little with the
// compass direction: a few gentle lobes. The table below is the only place
// that shape is written down. The JavaScript function and the GLSL function
// are both generated from it, so the water's edge, the bank and anything that
// asks "is this point in the pond?" always agree.
//
// theta is a compass angle in radians: 0 is north (-Z), PI/2 is east (+X).

/**
 * Mean radius in metres, and the lobes: each adds `amp` (a fraction of the
 * radius) times cos(n * theta + phase).
 */
export const SHORE = {
  radius: 38,
  lobes: [
    { n: 2, amp: 0.07, phase: 0.6 },
    { n: 3, amp: 0.045, phase: 2.1 },
    { n: 5, amp: 0.022, phase: 4.0 },
    { n: 7, amp: 0.012, phase: 1.3 },
  ],
};

/** The largest radius the shore reaches anywhere. */
export const SHORE_MAX_RADIUS = SHORE.radius * (1 + SHORE.lobes.reduce((sum, l) => sum + Math.abs(l.amp), 0));

/**
 * Distance from the pond's centre to the shore in the direction `theta`.
 * @param {number} theta compass angle in radians
 * @returns {number} metres
 */
export function shoreRadius(theta) {
  let k = 1;
  for (const l of SHORE.lobes) k += l.amp * Math.cos(l.n * theta + l.phase);
  return SHORE.radius * k;
}

/** Compass angle of a point seen from the centre. */
export const shoreTheta = (x, z) => Math.atan2(x, -z);

/**
 * How far a point is from the shore, measured along the line from the centre:
 * negative on the water, positive on land. (For lobes this gentle that is
 * within a few percent of the true nearest distance.)
 * @returns {number} metres
 */
export function shoreDistance(x, z) {
  return Math.hypot(x, z) - shoreRadius(shoreTheta(x, z));
}

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The same two functions for shaders: float shoreRadius(float theta), float shoreDistance(vec2 xz). */
export const POND_GLSL = /* glsl */ `
float shoreRadius(float theta) {
  return ${f(SHORE.radius)} * (1.0${SHORE.lobes.map((l) => ` + ${f(l.amp)} * cos(${f(l.n)} * theta + ${f(l.phase)})`).join('')});
}
float shoreDistance(vec2 xz) {
  // atan(0, 0) is undefined; the very centre may take any direction
  float theta = dot(xz, xz) > 1.0e-8 ? atan(xz.x, -xz.y) : 0.0;
  return length(xz) - shoreRadius(theta);
}
`;

/** Everything about the pond in one object, as handed round in ctx.pond. */
export const pond = { SHORE, SHORE_MAX_RADIUS, shoreRadius, shoreTheta, shoreDistance, glsl: POND_GLSL };
