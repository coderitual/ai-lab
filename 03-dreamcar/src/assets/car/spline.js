// Curves through tables of points: the two interpolants the car's lines are
// read with.
//
// Both are cubic Hermite pieces whose tangents come from the neighbouring
// points (three-point differences on unevenly spaced knots), limited so that
// no piece overshoots its own two points. They are local (moving one point
// changes four pieces) and cannot ring next to a step or a sharp bend the way
// a global spline does. Smoothness of the BODY does not come from
// here: these only place the control points of its B-spline surface
// (skin.js), which is what the paint is finally drawn on.
//
// A point of a table may be marked as a corner (a trailing 1): the curve then
// arrives at it and leaves it along its own side's direction, as a profile
// does where a bonnet meets a windscreen.

/** Tangents at the ends of every piece of a table `x[]`, `y[]`; `corner[i]` breaks the tangent at knot i. */
function tangents(x, y, corner) {
  const n = x.length;
  const slope = (i) => (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  // derivative at knot i of the parabola through knots a, i, b
  const three = (a, i, b) => {
    const h0 = x[i] - x[a];
    const h1 = x[b] - x[i];
    const d0 = (y[i] - y[a]) / h0;
    const d1 = (y[b] - y[i]) / h1;
    return (d0 * h1 + d1 * h0) / (h0 + h1);
  };
  // derivative at the end knot `i` of the parabola through i and its two neighbours on one side
  const oneSided = (i, dir) => {
    const j = i + dir;
    const k = i + 2 * dir;
    if (k < 0 || k >= n || corner[j]) return (y[j] - y[i]) / (x[j] - x[i]);
    const d0 = (y[j] - y[i]) / (x[j] - x[i]);
    const d1 = (y[k] - y[j]) / (x[k] - x[j]);
    const h0 = x[j] - x[i];
    const h1 = x[k] - x[j];
    return d0 + ((d0 - d1) * h0) / (h0 + h1);
  };
  // A tangent is never steeper than three times the slope of a piece it belongs to, and is level where the
  // table turns round: with that, no piece rises above or dips below its own two points (Fritsch and Carlson).
  const limit = (m, d) => (m * d <= 0 ? 0 : Math.abs(m) > 3 * Math.abs(d) ? 3 * d : m);
  const start = new Float64Array(n - 1); // tangent at the start of piece i
  const end = new Float64Array(n - 1); // tangent at the end of piece i
  for (let i = 0; i < n; i++) {
    const first = i === 0;
    const last = i === n - 1;
    if (first || last || corner[i]) {
      if (!last) start[i] = limit(n === 2 ? slope(0) : oneSided(i, 1), slope(i));
      if (!first) end[i - 1] = limit(n === 2 ? slope(0) : oneSided(i, -1), slope(i - 1));
    } else {
      start[i] = end[i - 1] = limit(limit(three(i - 1, i, i + 1), slope(i - 1)), slope(i));
    }
  }
  return { start, end };
}

function hermite(x0, x1, y0, y1, m0, m1, x) {
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

function locate(x, v) {
  let lo = 0;
  let hi = x.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (x[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * y as a function of x through `points` ([x, y] or [x, y, 1] for a corner; x rising or falling, never both).
 * Outside the table the function stays at its end value.
 * @param {number[][]} points
 * @returns {(x: number) => number}
 */
export function curve(points) {
  const sorted = points[0][0] < points[points.length - 1][0] ? points : [...points].reverse();
  const x = sorted.map((p) => p[0]);
  const y = sorted.map((p) => p[1]);
  const t = tangents(
    x,
    y,
    sorted.map((p) => !!p[2]),
  );
  const n = x.length;
  return (v) => {
    if (v <= x[0]) return y[0];
    if (v >= x[n - 1]) return y[n - 1];
    const i = locate(x, v);
    return hermite(x[i], x[i + 1], y[i], y[i + 1], t.start[i], t.end[i], v);
  };
}

/**
 * A curve in space through `points` ([x, y, z] or [x, y, z, 1] for a corner), with the length of its chords as
 * the parameter: `t` runs from 0 to `length` and is, near enough, distance along the curve.
 * @param {number[][]} points
 */
export function path(points) {
  const n = points.length;
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = points[i - 1];
    const b = points[i];
    t[i] = t[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const corner = points.map((p) => !!p[3]);
  const axes = [0, 1, 2].map((k) => {
    const y = points.map((p) => p[k]);
    return { y, ...tangents(t, y, corner) };
  });
  const length = t[n - 1];
  const at = (s, out = [0, 0, 0]) => {
    const v = s < 0 ? 0 : s > length ? length : s;
    const i = locate(t, v);
    for (let k = 0; k < 3; k++) {
      const a = axes[k];
      out[k] = hermite(t[i], t[i + 1], a.y[i], a.y[i + 1], a.start[i], a.end[i], v);
    }
    return out;
  };
  const scratch = [0, 0, 0];
  return {
    length,
    /** Parameter of each point of the table. */
    knots: t,
    at,
    /**
     * The parameter at which coordinate `axis` takes `value`, searched between parameters `lo` and `hi`,
     * where that coordinate must run one way only.
     */
    find(axis, value, lo = 0, hi = length) {
      let a = lo;
      let b = hi;
      const rising = at(b, scratch)[axis] > at(a, scratch)[axis];
      for (let i = 0; i < 48; i++) {
        const mid = (a + b) / 2;
        if (at(mid, scratch)[axis] < value === rising) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    },
  };
}
