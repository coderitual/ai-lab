// The swan's dimensions, in one place.
//
// Everything here was measured from the reference film (docs/design.md, "The
// swan") and is the only copy: the body mesh, the neck, the head, the stand-in
// shapes the shader uses to work out how much bird the light has to cross, and
// the animation all read these tables. Change a number here and every one of
// them follows.
//
// Units: L, the swan's length at the waterline, unless a name says metres.
// Side view axes as the measurements were taken:
//   u  from the point where the breast meets the water (0) toward the tail (1
//      is where the stern meets the water, 1.125 the tip of the tail)
//   v  up from the water
//   w  across, from the centre line
// The model's own space ("bird space", metres): +Z is the way the swan faces,
// +Y up, +X the bird's left, origin on the water under the middle of the
// body. birdZ() converts.

/** Waterline length in metres. Drops falling from the bill in the film give 0.55 to 0.65. */
export const L = 0.6;

/** The u that sits over the origin of bird space. */
export const U_ORIGIN = 0.5;

/** Bird-space z (metres) of a side-view u. */
export const birdZ = (u) => (U_ORIGIN - u) * L;

// ---------------------------------------------------------------- curves

/**
 * A smooth curve through a table of [x, y] points (x increasing): cubic
 * Hermite pieces whose slopes are limited so that the curve never overshoots
 * its points (Fritsch-Carlson). A measured outline must not grow bumps of its
 * own between the measurements.
 * @param {number[][]} points
 * @returns {(x: number) => number}
 */
export function curve(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- body

/** The stern end of the body: the tip of the tail. */
export const U_TAIL_TIP = 1.125;
/** Where the hull starts, just under water ahead of the breast. */
export const U_BOW = 0.0;

/**
 * Top outline in side view with the wings arched and tall, as at the start
 * of the film: highest point two thirds of the way back, a long convex slope
 * forward of it, a steep drop to the saddle, then the upturned tail. Forward
 * of u = 0.21 the outline is inside the base of the neck.
 *
 * These are true heights. The film's camera looks down on the swan by 10
 * degrees, so what is further away sits higher in the picture: the back's
 * outline there is the crest of the far wing, and reads 0.49 to 0.51 L above
 * the waterline at the breast when it is really 0.455 L above the water. The
 * table was set by measuring the outline of this model in the film's view
 * against the film's.
 */
const TOP_ARCHED = curve([
  [0.0, -0.03], [0.06, 0.035], [0.12, 0.1], [0.21, 0.19], [0.27, 0.255], [0.3, 0.295], [0.35, 0.34], [0.4, 0.375],
  [0.45, 0.402], [0.5, 0.428], [0.55, 0.445], [0.6, 0.453], [0.65, 0.455], [0.7, 0.452], [0.75, 0.436], [0.8, 0.418],
  [0.85, 0.393], [0.9, 0.352], [0.95, 0.308], [0.98, 0.298], [1.02, 0.318], [1.05, 0.352], [1.1, 0.38], [1.125, 0.4],
]);

/**
 * The same with the wings relaxed, as from seven seconds on: the back is
 * about a tenth lower and the forward slope is nearly a straight ramp.
 */
const TOP_RELAXED = curve([
  [0.0, -0.03], [0.06, 0.035], [0.12, 0.1], [0.21, 0.185], [0.27, 0.235], [0.3, 0.258], [0.35, 0.29], [0.4, 0.318],
  [0.45, 0.344], [0.5, 0.367], [0.55, 0.387], [0.6, 0.402], [0.65, 0.412], [0.7, 0.415], [0.75, 0.408], [0.8, 0.392],
  [0.85, 0.37], [0.9, 0.338], [0.95, 0.3], [0.98, 0.288], [1.02, 0.305], [1.05, 0.335], [1.1, 0.366], [1.125, 0.385],
]);

/**
 * Half the width seen from above. 0.66 across at the widest with the wings
 * arched; the bow is as narrow as the base of the neck that stands on it.
 */
const HALF_WIDTH = curve([
  [0.0, 0.0], [0.03, 0.055], [0.08, 0.1], [0.16, 0.15], [0.26, 0.21], [0.36, 0.262], [0.46, 0.302], [0.56, 0.325],
  [0.66, 0.33], [0.76, 0.32], [0.85, 0.288], [0.92, 0.24], [0.98, 0.17], [1.02, 0.122], [1.06, 0.08], [1.1, 0.04], [1.125, 0.0],
]);

/**
 * The lower edge. Under the water it is a shallow hull nobody sees; behind
 * the stern waterline it is the steep rear edge that runs up to the tail tip
 * at 56 to 70 degrees.
 */
const BOTTOM = curve([
  [0.0, -0.045], [0.1, -0.07], [0.9, -0.07], [0.95, -0.05], [0.985, -0.005], [1.0, 0.03], [1.03, 0.1], [1.07, 0.2],
  [1.1, 0.285], [1.118, 0.362], [1.125, 0.4],
]);

/** How far the spine lies below the crests of the two wing lobes. */
const VALLEY = curve([[0.0, 0.0], [0.2, 0.02], [0.4, 0.05], [0.6, 0.055], [0.8, 0.07], [0.93, 0.045], [1.02, 0.0], [1.125, 0.0]]);

/** Where the crest of a wing lobe is, as a fraction of the half-width (0.19 of the whole width amidships). */
const CREST = curve([[0.0, 0.2], [0.2, 0.3], [0.35, 0.38], [0.85, 0.38], [0.95, 0.25], [1.03, 0.08], [1.125, 0.06]]);

/**
 * The numbers that shape one cross-section of the body.
 * @param {number} u station
 * @param {number} lift 0 wings relaxed .. 1 wings arched
 */
export function station(u, lift) {
  const top = mix(TOP_RELAXED(u), TOP_ARCHED(u), lift);
  const bottom = Math.min(BOTTOM(u), top);
  // relaxed wings lie closer to the body: a narrower bird with a shallower valley
  const wing = smooth(0.15, 0.4, u) * (1 - smooth(0.9, 1.02, u));
  const halfWidth = HALF_WIDTH(u) * (1 - 0.08 * (1 - lift) * wing);
  const valley = VALLEY(u) * mix(0.5, 1, lift);
  const crest = CREST(u);
  // The widest point is just above the water amidships (0.19 of the height);
  // on the tail, which is a wedge held in the air, it is in the upper half.
  const tail = smooth(0.92, 1.04, u);
  const widest = mix(0.19 * top, bottom + 0.6 * (top - bottom), tail);
  return { top, bottom, halfWidth, valley, crest, widest };
}

// One side of a cross-section, from the spine over the wing lobe, down the
// flank and under to the keel, as control points. The upper ones follow the
// head-on silhouette measured at 3.8 s (half-width as a fraction of the whole
// width by height: 0.50 at 0.19, 0.445 at 0.41, 0.40 at 0.63, 0.33 at 0.85,
// crest at 0.19): [fraction of the way from the crest out to the full
// half-width, fraction of the height from the widest line up to the top].
const UPPER = [[0, 1], [0.29, 0.945], [0.45, 0.815], [0.68, 0.54], [0.82, 0.27], [1, 0]];
// Below the widest line the side turns under: [fraction of the half-width,
// fraction of the way down to the bottom].
const LOWER = [[0.985, 0.36], [0.9, 0.7], [0.55, 0.955], [0, 1]];

/** Control points per half section. */
export const SECTION_POINTS = 2 + UPPER.length + LOWER.length;

/**
 * Control points of half a cross-section at a station, as [w, v] pairs
 * written into `out` (length 2 * SECTION_POINTS).
 */
export function sectionControls(u, lift, out) {
  const s = station(u, lift);
  let k = 0;
  out[k++] = 0;
  out[k++] = s.top - s.valley;
  out[k++] = 0.5 * s.crest * s.halfWidth;
  out[k++] = s.top - 0.45 * s.valley;
  for (const [t, e] of UPPER) {
    out[k++] = (s.crest + (1 - s.crest) * t) * s.halfWidth;
    out[k++] = s.widest + (s.top - s.widest) * e;
  }
  for (const [x, e] of LOWER) {
    out[k++] = x * s.halfWidth;
    out[k++] = s.widest + (s.bottom - s.widest) * e;
  }
  return out;
}

// A centripetal Catmull-Rom spline through the control points: it passes
// through every one of them and does not loop or overshoot where they are
// unevenly spaced, which a uniform one does.
function catmull(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t, out, o) {
  const d01 = Math.sqrt(Math.hypot(p1x - p0x, p1y - p0y)) || 1e-4;
  const d12 = Math.sqrt(Math.hypot(p2x - p1x, p2y - p1y)) || 1e-4;
  const d23 = Math.sqrt(Math.hypot(p3x - p2x, p3y - p2y)) || 1e-4;
  const t1 = d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const tt = t1 + (t2 - t1) * t;
  const a1x = ((t1 - tt) * p0x + tt * p1x) / t1;
  const a1y = ((t1 - tt) * p0y + tt * p1y) / t1;
  const a2x = ((t2 - tt) * p1x + (tt - t1) * p2x) / (t2 - t1);
  const a2y = ((t2 - tt) * p1y + (tt - t1) * p2y) / (t2 - t1);
  const a3x = ((t3 - tt) * p2x + (tt - t2) * p3x) / (t3 - t2);
  const a3y = ((t3 - tt) * p2y + (tt - t2) * p3y) / (t3 - t2);
  const b1x = ((t2 - tt) * a1x + tt * a2x) / t2;
  const b1y = ((t2 - tt) * a1y + tt * a2y) / t2;
  const b2x = ((t3 - tt) * a2x + (tt - t1) * a3x) / (t3 - t1);
  const b2y = ((t3 - tt) * a2y + (tt - t1) * a3y) / (t3 - t1);
  out[o] = ((t2 - tt) * b1x + (tt - t1) * b2x) / (t2 - t1);
  out[o + 1] = ((t2 - tt) * b1y + (tt - t1) * b2y) / (t2 - t1);
}

const _controls = new Float64Array(2 * SECTION_POINTS);

/**
 * Sample half a cross-section.
 * @param {number} u station
 * @param {number} lift 0 relaxed .. 1 arched
 * @param {number[]} steps how many pieces each span between two control points is cut into
 *   (SECTION_POINTS - 1 entries): more where the outline shows, fewer under water
 * @param {Float32Array|Float64Array|number[]} out [w, v] pairs, 1 + sum(steps) of them, spine first
 * @returns {number} the number of points written
 */
export function sectionPoints(u, lift, steps, out) {
  const c = sectionControls(u, lift, _controls);
  const n = SECTION_POINTS;
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    // The section is symmetric, so the neighbours beyond its two ends are
    // the mirror images of the points next to them: the curve crosses the
    // centre line square, with no crease along the spine or the keel.
    const i0 = i - 1;
    const i3 = i + 2;
    const p0x = i0 < 0 ? -c[2] : c[2 * i0];
    const p0y = i0 < 0 ? c[3] : c[2 * i0 + 1];
    const p3x = i3 >= n ? -c[2 * (n - 2)] : c[2 * i3];
    const p3y = i3 >= n ? c[2 * (n - 2) + 1] : c[2 * i3 + 1];
    for (let j = 0; j < steps[i]; j++) {
      catmull(p0x, p0y, c[2 * i], c[2 * i + 1], c[2 * i + 2], c[2 * i + 3], p3x, p3y, j / steps[i], out, k);
      k += 2;
    }
  }
  out[k] = c[2 * n - 2];
  out[k + 1] = c[2 * n - 1];
  return k / 2 + 1;
}

const _one = new Float64Array(2);

/**
 * One point of a cross-section's outline.
 * @param {number} u station
 * @param {number} lift 0 relaxed .. 1 arched
 * @param {number} q where round the half section: 0 the spine, about 0.18 the crest of the wing lobe,
 *   0.64 the widest point, 1 the keel
 * @returns {number[]} [w, v] (a new array)
 */
export function sectionAt(u, lift, q) {
  const c = sectionControls(u, lift, _controls);
  const n = SECTION_POINTS;
  const f = Math.min(n - 1 - 1e-6, Math.max(0, q * (n - 1)));
  const i = Math.floor(f);
  const i0 = i - 1;
  const i3 = i + 2;
  const p0x = i0 < 0 ? -c[2] : c[2 * i0];
  const p0y = i0 < 0 ? c[3] : c[2 * i0 + 1];
  const p3x = i3 >= n ? -c[2 * (n - 2)] : c[2 * i3];
  const p3y = i3 >= n ? c[2 * (n - 2) + 1] : c[2 * i3 + 1];
  catmull(p0x, p0y, c[2 * i], c[2 * i + 1], c[2 * i + 2], c[2 * i + 3], p3x, p3y, f - i, _one, 0);
  return [_one[0], _one[1]];
}

/** The stretch of the body (in u) over which the sinking of the bow fades out. */
export const BOW_SPAN = [0.15, 0.85];
/**
 * How far the front of the body sinks when the swan reaches down: all of it
 * at the bow, none of it from four fifths of the way back.
 * @param {number} u
 * @returns {number} 0..1, to be multiplied by BOW_DROP and the pose's `bow`
 */
export const bowShape = (u) => 1 - smooth(BOW_SPAN[0], BOW_SPAN[1], u);
/** Where the neck leaves the back is 0.20 above the water upright and 0.09 in the reach. */
export const BOW_DROP = 0.115;
/** With the wings relaxed and the neck reaching, the bird is up to this much longer. */
export const BODY_STRETCH = 0.2;
/** The tail hinges about this point of the side view (the saddle), by up to this angle each way. */
export const TAIL_PIVOT = [0.97, 0.27];
export const TAIL_SWING = 0.3;

// ---------------------------------------------------------------- neck

/** Length of the neck's centre line from the water to the back of the head. */
export const NECK_LENGTH = 0.95;
/** The centre line starts below the water so that there is always neck crossing the surface. */
export const NECK_SUNK = 0.06;
/** Where it starts, in the side view: [u, v]. */
export const NECK_ROOT = [0.115, -NECK_SUNK];

/**
 * Radius of the neck along its length (0 at the water, 1 at the back of the
 * head): 0.125 where it enters the water, a long cone up to half height, then
 * a tube 0.136 to 0.145 across. No separate breast: this flare is the bow.
 */
const NECK_RADIUS = curve([
  [-0.1, 0.128], [0.0, 0.125], [0.065, 0.122], [0.15, 0.105], [0.24, 0.095], [0.33, 0.089], [0.42, 0.078], [0.51, 0.07],
  [0.58, 0.068], [0.65, 0.068], [0.75, 0.07], [0.88, 0.072], [1.0, 0.072],
]);
/** @param {number} s 0 at the water .. 1 at the back of the head (negative below the water) */
export const neckRadius = (s) => NECK_RADIUS(s);

// ---------------------------------------------------------------- head and bill

/** From the back of the head to the tip of the bill, along the bill's axis. */
export const HEAD_LENGTH = 0.29;
/** Where the feathers end and the bill begins. */
export const BILL_START = 0.12;
/** The middle of the head, along the same axis. */
export const HEAD_CENTRE = 0.06;

// The head is the tapered end of the neck: no wider than it (0.145 face on),
// 0.13 to 0.15 deep, running into a wedge bill 0.17 long, 0.075 deep at its
// base and 0.035 at the tip, 0.07 wide. Along the axis: how far the outline
// rises above it, falls below it, and reaches to the side.
const HEAD_TOP = curve([[0, 0.072], [0.03, 0.076], [0.06, 0.077], [0.09, 0.069], [0.115, 0.054], [0.135, 0.042], [0.17, 0.032], [0.22, 0.024], [0.265, 0.018], [0.283, 0.012], [0.29, 0.0]]);
const HEAD_UNDER = curve([[0, 0.072], [0.03, 0.068], [0.06, 0.061], [0.09, 0.05], [0.115, 0.04], [0.135, 0.033], [0.17, 0.028], [0.22, 0.023], [0.265, 0.02], [0.283, 0.017], [0.29, 0.006]]);
const HEAD_SIDE = curve([[0, 0.072], [0.03, 0.0725], [0.06, 0.0725], [0.09, 0.064], [0.115, 0.05], [0.135, 0.038], [0.17, 0.0355], [0.22, 0.0345], [0.265, 0.033], [0.283, 0.024], [0.29, 0.0]]);

/** The outline of the head at a distance `a` along the bill's axis. */
export function headSection(a) {
  return { top: HEAD_TOP(a), under: HEAD_UNDER(a), side: HEAD_SIDE(a) };
}

/** The knob: a bump on top of the base of the bill, at most 0.025 high. */
export const KNOB = { at: 0.128, length: 0.022, width: 0.02, height: 0.022 };
/** The eye: a small dark bead on the side of the head. */
export const EYE = { at: 0.082, up: 0.4, radius: 0.0075 };
/** The tip of the bill in the head's own space: [across, up, along]. */
export const BILL_TIP = [0, -0.004, HEAD_LENGTH];

// ---------------------------------------------------------------- stand-ins for the light

/**
 * What the shader takes the bird to be made of when it works out how much
 * feather a ray of sun has to cross: six ellipsoids, in the side-view
 * coordinates above. Their sizes were found by a search that compared the
 * light they let through with the film's, point by point over the visible
 * flank, in the two side views (0.3 s and 7.5 s). What came out reads as a
 * bird:
 *
 *   - the plumage is a hollow shell about 0.07 L thick (an ellipsoid with a
 *     smaller one of negative density inside it). Light that crosses the
 *     hollow front of the bird passes two walls and comes out bright; light
 *     that has to run along inside the roof, or through a wing, does not.
 *     That is why the front third glows right down to the water;
 *   - the two folded wings are lobes either side of the spine whose density
 *     fades in behind a slanting line running up and back from the breast
 *     (the wing's leading edge): `plane` gives that line as u = u0 + m v and
 *     the distance over which the density reaches its full value;
 *   - inside the hollow, aft and low, is the body itself, far denser: the
 *     dark middle of the bird;
 *   - the tail is a thin wedge: cream all through.
 *
 * { centre: [u, v, w], radii: [along, up, across], tilt, density, plane }
 * `tilt` raises the stern end of the long axis by that many radians.
 * Densities are relative to plain feather (LOOK.swanFreePath is the
 * distance over which plain feather takes red light down to 1/e).
 *
 * @param {number} lift 0 wings relaxed .. 1 arched
 */
export function proxyShapes(lift) {
  const peak = mix(0.415, 0.455, lift);
  const beam = mix(0.305, 0.33, lift);
  const top = peak + 0.01;
  const wall = 0.07;
  const edge = { u0: 0.223, m: 0.94, width: 0.3 };
  // Arched wings are puffed up and loose, and let light through their upper
  // parts; relaxed wings lie flat and close and let almost none through (by
  // the end of the film the whole body is a dark shape with a lit outline).
  const loose = mix(0.95, 0.42, lift);
  const wing = mix(3.2, 1.6, lift);
  return [
    { centre: [0.633, 0.25, 0], radii: [0.6, top - 0.25, beam], tilt: 0, density: loose, plane: null },
    { centre: [0.606, 0.23, 0], radii: [0.6 - 1.2 * wall, top - 0.25 - wall, beam - wall], tilt: 0, density: -loose, plane: null },
    { centre: [0.66, 0.1, 0.15], radii: [0.42, peak - 0.11, beam - 0.16], tilt: 0, density: wing, plane: edge },
    { centre: [0.66, 0.1, -0.15], radii: [0.42, peak - 0.11, beam - 0.16], tilt: 0, density: wing, plane: edge },
    { centre: [0.632, -0.014, 0], radii: [0.227, 0.232, 0.177], tilt: 0, density: 3, plane: null },
    { centre: [1.035, 0.28, 0], radii: [0.1, 0.045, 0.07], tilt: 0.75, density: 0.5, plane: null },
  ];
}
/** Which of the shapes above swings with the tail. */
export const PROXY_TAIL = 5;
/** The neck and head stand in as a chain of cylinders this fraction of their real radius (the rest is down, which the light gets round). */
export const NECK_CORE = 0.95;
