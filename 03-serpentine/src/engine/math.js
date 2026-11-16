// Small math helpers shared by the engine, the assets and the game.
//
// Plain functions on numbers: nothing here imports three.js or touches the
// page, so the track and the physics can use them in Node.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Where `v` lies between `a` and `b` (0 at a, 1 at b; not clamped). */
export const invLerp = (a, b, v) => (v - a) / (b - a);
/** `v` taken from the range a..b to the range c..d, held at the ends. */
export const remap = (v, a, b, c, d) => c + (d - c) * clamp01((v - a) / (b - a));

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** `v` wrapped into [0, period): a distance round a closed track, a phase. */
export function wrap(v, period) {
  const r = v % period;
  return r < 0 ? r + period : r;
}

/** The shortest signed way from `a` to `b` round a loop of length `period`, in (-period/2, period/2]. */
export function wrapDelta(a, b, period) {
  const d = wrap(b - a + period / 2, period) - period / 2;
  return d === -period / 2 ? period / 2 : d;
}

/** Wrap an angle in radians to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference b - a, in radians. */
export const angleDiff = (a, b) => wrapAngle(b - a);

/**
 * Frame-rate independent exponential smoothing.
 * `lambda` is in 1/s: after 1/lambda seconds about 63% of the gap is closed.
 */
export const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

/** The same for a heading: goes the short way round. */
export const dampAngle = (current, target, lambda, dt) => current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

// ------------------------------------------------------------------ curves

/**
 * A point on the uniform Catmull-Rom spline through p1 and p2 (p0 and p3 are
 * the neighbours that shape it), t in 0..1. Scalars: call it per component.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/** d/dt of catmullRom(). */
export function catmullRomDerivative(p0, p1, p2, p3, t) {
  const t2 = t * t;
  return 0.5 * (p2 - p0 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t2);
}

/** Cubic Hermite: from p0 with slope m0 to p1 with slope m1, t in 0..1. */
export function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * p1 + (t3 - t2) * m1;
}

/**
 * Reads a curve given as a table of [x, y] pairs with rising x (a torque
 * curve, a gain against speed): straight lines between the points, the end
 * values beyond them.
 * @param {ReadonlyArray<readonly [number, number]>} table
 * @param {number} x
 */
export function lookup(table, x) {
  const last = table.length - 1;
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[last][0]) return table[last][1];
  let i = 1;
  while (table[i][0] < x) i++;
  const [x0, y0] = table[i - 1];
  const [x1, y1] = table[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
