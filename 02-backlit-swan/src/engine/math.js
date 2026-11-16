// Small math helpers shared by the engine, the assets and the scene.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Wrap an angle in radians to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference b - a, in radians. */
export const angleDiff = (a, b) => wrapAngle(b - a);

/** Shortest signed difference b - a, in degrees. */
export function angleDiffDeg(a, b) {
  let d = (b - a + 180) % 360;
  if (d < 0) d += 360;
  return d - 180;
}

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is in 1/s: after 1/rate seconds about 63% of the gap is closed.
 */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export const dampAngle = (current, target, rate, dt) => current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
