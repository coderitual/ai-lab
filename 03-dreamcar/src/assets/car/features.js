// What is drawn on the body, and what is cut out of it.
//
// The skin (skin.js) is one smooth surface. Glass, lamp lenses, shut lines,
// the grille and the intakes are flush with it on the real car, so they are
// not modelled: each is an outline here, given in the view in which it is
// true (the side, the top, the front, the rear, or square to a lamp's lens),
// and atlas.js turns the outlines into a texture of distances over the skin
// that the shaders threshold. Numbers are from the modelling sheet (docs/car.md),
// left side; the right side is the mirror image (the one thing on one side
// only, the fuel flap, is drawn by the paint's shader).
//
// An outline is written as points in car space; it is projected along its
// view's direction and from then on is a curve in that plane: smoothed
// (centripetal Catmull-Rom) where the car's line is a curve, straight with
// rounded corners (fillets) where it is a panel's edge. A view only applies to
// the part of the skin that faces it (`gate`), so the side glass's outline
// never lands on the roof.

import { BELT, DLO_TOP } from './lines.js';

/**
 * The wheel-arch openings: in side view a half ellipse (half-width `a`, height `b` above the wheel's centre at
 * `z`, `y`) standing on two upright edges that run `drop` below the centre to the body's lower edge. The hole is
 * cut through the body from x = `inner` outwards (the wheel housing's inner wall).
 */
export const ARCHES = {
  front: { z: 1.4325, y: 0.32, a: 0.385, b: 0.372, drop: 0.16, inner: 0.56 },
  rear: { z: -1.4325, y: 0.315, a: 0.39, b: 0.355, drop: 0.16, inner: 0.58 },
};

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The views: the direction each looks along, as the outward normal of what it shows. */
export const VIEWS = {
  side: [1, 0, 0],
  top: [0, 1, 0],
  front: [0, 0, 1],
  rear: [0, 0, -1],
  grille: unit([0, -0.087, 1]), // the grille leans forward 5 degrees
  head: unit([0.6, 0.2, 0.77]), // square to the head lamp's lens, which lies along the swept nose
  tail: unit([0.45, 0.1, -0.89]), // square to the tail lamp, which wraps round the corner
  corner: unit([0.7, 0, -0.7]), // the rear bumper's corner
};

/** Two axes spanning the plane square to `d`: a point projects to (p . e1, p . e2). */
export function viewBasis(d) {
  const up = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const k = up[0] * d[0] + up[1] * d[1] + up[2] * d[2];
  const e2 = unit([up[0] - k * d[0], up[1] - k * d[1], up[2] - k * d[2]]);
  const e1 = [e2[1] * d[2] - e2[2] * d[1], e2[2] * d[0] - e2[0] * d[2], e2[0] * d[1] - e2[1] * d[0]];
  return [e1, e2];
}

// ---- building outlines in a view's plane (2D points [a, b])

const STEP = 0.006; // spacing of the points of a finished outline (m)

/** Centripetal Catmull-Rom through 2D points, sampled about every STEP. */
function smooth(points, closed) {
  const n = points.length;
  const out = [];
  const get = (i) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const knot = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const pieces = closed ? n : n - 1;
  for (let i = 0; i < pieces; i++) {
    let p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    let p3 = get(i + 2);
    // at the ends of an open curve, a phantom point continuing the end piece
    if (p0 === p1) p0 = [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    if (p3 === p2) p3 = [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const pt = [0, 0];
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) * p0[c] + t * p1[c]) / t1;
        const a2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1);
        const a3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2;
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        pt[c] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      }
      out.push(pt);
    }
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

/** Straight segments through 2D points, sampled about every STEP. */
function straight(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
    for (let s = 0; s < steps; s++) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * A closed outline from open pieces laid end to end (each starts where the last ended), with the corner at the
 * start of piece i rounded to radius radii[i] (0 or missing: sharp).
 */
function outline(pieces, radii) {
  const corners = [];
  const pts = [];
  pieces.forEach((piece) => {
    corners.push(pts.length);
    pts.push(...piece.slice(0, -1));
  });
  const n = pts.length;
  const keep = new Uint8Array(n).fill(1);
  const fillets = new Map();
  corners.forEach((c, i) => {
    const r = radii[i] ?? 0;
    if (r <= 0) return;
    // walk r along the outline each way from the corner
    const walk = (dir) => {
      let left = r;
      let j = c;
      for (let guard = 0; guard < n; guard++) {
        const k = (j + dir + n) % n;
        const d = Math.hypot(pts[k][0] - pts[j][0], pts[k][1] - pts[j][1]);
        if (d >= left) {
          const t = left / d;
          return [pts[j][0] + (pts[k][0] - pts[j][0]) * t, pts[j][1] + (pts[k][1] - pts[j][1]) * t];
        }
        left -= d;
        keep[k] = 0;
        j = k;
      }
      return pts[j];
    };
    const before = walk(-1);
    const after = walk(1);
    const curve = [];
    const steps = Math.max(3, Math.ceil((1.6 * r) / STEP));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const [w0, w1, w2] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
      curve.push([w0 * before[0] + w1 * pts[c][0] + w2 * after[0], w0 * before[1] + w1 * pts[c][1] + w2 * after[1]]);
    }
    fillets.set(c, curve);
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    if (fillets.has(i)) out.push(...fillets.get(i));
    else if (keep[i]) out.push(pts[i]);
  }
  return out;
}

/** Project car-space points into a view's plane. */
const project = (view, points) => {
  const [e1, e2] = viewBasis(VIEWS[view]);
  return points.map((p) => [p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]]);
};
/** Side-view points [z, y] as car-space points (x does not matter in that view). */
const side = (zy) => zy.map(([z, y]) => [0.9, y, z]);
/** Top-view points [z, x]. */
const top = (zx) => zx.map(([z, x]) => [x, 1, z]);
/** Front or rear view points [x, y]. */
const face = (xy) => xy.map(([x, y]) => [x, y, 0]);

/**
 * @typedef {object} Feature
 * @property {string} name
 * @property {string} view key of VIEWS
 * @property {boolean} closed an area (signed distance, negative inside) or a line (distance)
 * @property {number[][]} points the finished outline in the view's plane
 * @property {{ n: number, y?: number[], z?: number[] }} gate where it applies: the skin's normal . the view's
 *   direction above `n`, and y, z within [min, max]
 */

/** The head lamp's lens (5.2), left: points on the body, clockwise seen from the front-left, from the inner point. */
export const HEAD_LENS = [[0.5, 0.688, 2.105], [0.53, 0.713, 2.047], [0.6, 0.728, 1.975], [0.68, 0.744, 1.865], [0.75, 0.756, 1.776],
  [0.815, 0.748, 1.722], [0.86, 0.715, 1.69], [0.84, 0.672, 1.76], [0.79, 0.63, 1.85], [0.73, 0.602, 1.925],
  [0.66, 0.592, 1.985], [0.59, 0.602, 2.04], [0.53, 0.635, 2.085], [0.5, 0.665, 2.105]];
/**
 * The tail lamp's lens (6.2), left: the upper edge from the inner tip to the outer end (the first TAIL_UPPER
 * points, x rising), then down round the outer end and back along the lower edge. Redrawn from the daylight
 * photograph straight on the tail (camera fitted to the plate, the star, the screen's corners and the trims,
 * the outline cut back onto the lamp's own surface): the inner tip is 45 mm further in than the sheet had it,
 * the upper edge rises 60 mm to the outer end, and the outer end is the lamp's tallest part, a rounded end
 * 0.2 high wrapping round the corner, with the lower edge running nearly level beneath it (the sheet's lamp
 * was deepest in the middle and pointed at the outer end).
 */
export const TAIL_LENS = [[0.325, 0.86, -2.452], [0.385, 0.876, -2.445], [0.45, 0.887, -2.428], [0.52, 0.896, -2.385],
  [0.6, 0.904, -2.305], [0.68, 0.913, -2.222], [0.75, 0.924, -2.13], [0.79, 0.926, -2.075], [0.822, 0.914, -2.03],
  [0.84, 0.89, -2.002], [0.848, 0.85, -1.99],
  [0.846, 0.805, -1.993], [0.835, 0.765, -2.008], [0.81, 0.735, -2.045], [0.77, 0.722, -2.1], [0.71, 0.732, -2.19],
  [0.64, 0.75, -2.27], [0.57, 0.772, -2.335], [0.5, 0.797, -2.398], [0.43, 0.822, -2.435], [0.37, 0.842, -2.45],
  [0.338, 0.852, -2.452]];
/** How many of TAIL_LENS's points are its upper edge. */
export const TAIL_UPPER = 11;
/** The grille's opening (5.1), left half, clockwise from the middle of the upper edge seen from the front. */
export const GRILLE_HALF = [[0, 0.71, 2.2675], [0.15, 0.708, 2.262], [0.3, 0.7, 2.246], [0.4, 0.686, 2.231], [0.47, 0.66, 2.207],
  [0.515, 0.615, 2.189], [0.535, 0.56, 2.178], [0.525, 0.515, 2.178], [0.49, 0.487, 2.186], [0.42, 0.472, 2.207],
  [0.3, 0.465, 2.226], [0.15, 0.462, 2.242], [0, 0.462, 2.247]];
/**
 * The grille's small stars (5.1): a staggered lattice, rows `dy` apart from y0 up, `dx` apart along a row (every
 * other row shifted by half), each star's arms `arm` long. The photograph straight on the nose shows them as fine
 * dull points on black, about sixteen across a half: round 4's 23 mm stars on 40 x 30 mm glittered and the
 * grille read large and bright. (The sheet's 12 mm stars at 34 x 22 mm were a sparse sprinkle.)
 */
export const GRILLE_STARS = { y0: 0.476, dy: 0.024, dx: 0.032, arm: 0.008 };
/** The side intake's opening (5.3), left, in front view [x, y]: upper inner, lower inner, lower outer, upper outer. */
export const INTAKE_SIDE = [[0.38, 0.448], [0.41, 0.372], [0.8, 0.3], [0.81, 0.47]];
/**
 * The lower intake across the apron (5.3), left half in front view [x, y], from the middle of its upper edge.
 * Redrawn with INTAKE_SIDE from the daylight photograph straight on the nose (camera fitted, outlines projected
 * onto the skin): the side intakes are wedges under the grille's outer corners, tallest at the bumper's corner,
 * their lower edge rising inwards, and the painted blade between them and this black band sweeps under the plate
 * (the first outlines had the side intakes as tall trapezoids reaching down to the lip). Round six, against the
 * same photograph: the side intakes reach in under the grille's lower edge nearly to the plate, and the lower
 * intake is as tall as the blade above it (it was a thin band), so the painted blade is a slim wing between two
 * deep black openings.
 */
export const INTAKE_CENTRE = [[0, 0.3], [0.52, 0.305], [0.68, 0.272], [0.7, 0.222], [0, 0.222]];

/** Every outline. Pure arithmetic: the dev tools run it in Node too. */
export function buildFeatures() {
  /** @type {Feature[]} */
  const list = [];
  const area = (name, view, gate, points) => list.push({ name, view, closed: true, gate, points });
  const line = (name, view, gate, points) => list.push({ name, view, closed: false, gate, points });
  const P = project;
  /** A polygon of straight edges with every corner rounded to r. */
  const poly = (view, pts, r) => {
    const q = P(view, pts);
    return outline(
      q.map((p, i) => straight([p, q[(i + 1) % q.length]])),
      q.map(() => r),
    );
  };

  // ---- glass. The side glass: the belt from the front tip to the rear tip, back over the top (2.3, 2.4).
  const sideGate = { n: 0.25, y: [0.8, 1.6] };
  const belt = smooth(P('side', BELT), false);
  const dlo = smooth(P('side', [...DLO_TOP].reverse()), false);
  area('dlo', 'side', sideGate, outline([belt, dlo], [0.012, 0.012]));
  // the B-pillar's black applique, and the divider bar in front of the quarter light (2.4)
  area('bpillar', 'side', sideGate, poly('side', side([[-0.36, 0.982], [-0.457, 1.42], [-0.567, 1.42], [-0.52, 0.982]]), 0));
  area('divider', 'side', sideGate, poly('side', side([[-1.099, 0.982], [-1.131, 1.37], [-1.153, 1.37], [-1.121, 0.982]]), 0));
  // windscreen and rear screen in plan (3.4): bowed upper and lower edges, straight sides, rounded corners. The
  // top view's plane has the axes (-x, z).
  const [e1, e2] = viewBasis(VIEWS.top);
  if (Math.abs(e1[0] + 1) > 1e-6 || Math.abs(e2[2] - 1) > 1e-6) throw new Error('features: unexpected top view axes');
  const screen = (cu, zcu, cl, zcl, rUp, rLow) => {
    const edge = (c, z0) => {
      const pts = [];
      const steps = Math.ceil((2 * c[0]) / STEP);
      for (let s = 0; s <= steps; s++) {
        const x = -c[0] + (2 * c[0] * s) / steps;
        pts.push([-x, z0 + (c[2] - z0) * (x / c[0]) ** 2]);
      }
      return pts;
    };
    const upper = edge(cu, zcu);
    const lower = edge(cl, zcl).reverse();
    const sides = [straight([[-cu[0], cu[2]], [-cl[0], cl[2]]]), straight([[cl[0], cl[2]], [cu[0], cu[2]]])];
    return outline([upper, sides[0], lower, sides[1]], [rUp, rUp, rLow, rLow]);
  };
  area('windscreen', 'top', { n: 0.3, y: [0.9, 1.5], z: [-0.1, 1] }, screen([0.554, 1.334, 0.038], 0.115, [0.695, 0.992, 0.713], 0.84, 0.06, 0.09));
  area('rearScreen', 'top', { n: 0.3, y: [0.95, 1.5], z: [-2.1, -1.3] }, screen([0.518, 1.275, -1.473], -1.53, [0.634, 1.054, -1.885], -1.96, 0.06, 0.09));
  // the panoramic roof (3.4)
  area('roofGlass', 'top', { n: 0.6, y: [1.3, 1.6] }, poly('top', top([[0, 0.5], [0, -0.5], [-1.17, -0.47], [-1.17, 0.47]]), 0.06));

  // ---- lamp lenses (5.2, 6.2)
  area('headLamp', 'head', { n: 0, y: [0.5, 0.85], z: [1.55, 2.4] }, smooth(P('head', HEAD_LENS), true));
  area('tailLamp', 'tail', { n: 0, y: [0.65, 0.98], z: [-2.7, -1.85] }, smooth(P('tail', TAIL_LENS), true));

  // ---- openings (5.1, 5.3): the grille, the side intakes, the centre intake
  const GRILLE = GRILLE_HALF;
  const grille = [...GRILLE, ...GRILLE.slice(1, -1).reverse().map(([x, y, z]) => [-x, y, z])];
  area('grille', 'grille', { n: 0.3, y: [0.4, 0.8], z: [1.95, 2.5] }, smooth(P('grille', grille), true));
  area('intakeSide', 'front', { n: 0.12, y: [0.15, 0.5], z: [1.8, 2.5] }, poly('front', face(INTAKE_SIDE), 0.03));
  area('intakeCentre', 'front', { n: 0.3, y: [0.15, 0.4], z: [1.95, 2.5] },
    poly('front', face([...INTAKE_CENTRE.slice(1, -1).map(([x, y]) => [-x, y]).reverse(), ...INTAKE_CENTRE.slice(1, -1)]), 0.015));

  // ---- shut lines (2.5, 2.7, 3.4, 5.3, 6.3)
  const sideLine = { n: 0.35 };
  line('cutFender', 'side', sideLine, smooth(P('side', side([[0.66, 0.93], [0.705, 0.86], [0.735, 0.775], [0.745, 0.65], [0.74, 0.52], [0.725, 0.4], [0.7, 0.295]])), false));
  line('cutB', 'side', sideLine, smooth(P('side', side([[-0.395, 0.992], [-0.372, 0.93], [-0.352, 0.86], [-0.34, 0.75], [-0.338, 0.62], [-0.342, 0.5], [-0.35, 0.4], [-0.36, 0.295]])), false));
  line('cutRear', 'side', sideLine, smooth(P('side', side([[-1.5, 1.035], [-1.43, 0.9], [-1.35, 0.805], [-1.225, 0.69], [-1.115, 0.55], [-1.045, 0.425], [-1.02, 0.3]])), false));
  line('cutBumperRear', 'side', sideLine, smooth(P('side', side([[-2.11, 0.8], [-1.99, 0.7], [-1.88, 0.635], [-1.77, 0.605], [-1.672, 0.594]])), false));
  line('doorsBottom', 'side', { n: 0.3, y: [0.2, 0.4] }, smooth(P('side', side([[0.7, 0.295], [-0.36, 0.297], [-1.02, 0.3]])), false));
  line('bonnet', 'top', { n: 0.25, y: [0.6, 1.1], z: [0.7, 2.4] }, smooth(P('top', top([[2.13, 0], [2.125, 0.15], [2.11, 0.3], [2.085, 0.42],
    [2.047, 0.53], [1.92, 0.64], [1.776, 0.75], [1.6, 0.765], [1.4325, 0.77], [1.2, 0.77], [1.0, 0.762], [0.795, 0.75]])), false));
  line('bootSide', 'top', { n: 0.3, y: [0.8, 1.2], z: [-2.4, -1.85] }, smooth(P('top', top([[-2.3, 0.6], [-2.1, 0.63], [-1.93, 0.66]])), false));
  line('bootRear', 'rear', { n: 0.3, z: [-2.7, -2.15] }, smooth(P('rear', face([[0.606, 0.902], [0.561, 0.776], [0.535, 0.725], [0.5, 0.672], [0.44, 0.628], [0.34, 0.602], [0.2, 0.594], [0, 0.592]])), false));
  line('roofSeam', 'top', { n: 0.6, y: [1.3, 1.6] }, straight(P('top', top([[-0.62, 0.47], [-0.62, 0]]))));

  // ---- small things on the rear bumper (6.4): the red reflectors, the black slits of the corner outlets
  area('reflector', 'rear', { n: 0.2, y: [0.4, 0.6], z: [-2.7, -2.3] }, poly('rear', face([[0.45, 0.519], [0.465, 0.491], [0.675, 0.491], [0.69, 0.519]]), 0.004));
  area('slit', 'corner', { n: 0.1, y: [0.3, 0.65], z: [-2.4, -2.05] },
    poly('corner', [[0.78, 0.6, -2.3], [0.766, 0.59, -2.31], [0.828, 0.378, -2.17], [0.845, 0.375, -2.155]], 0.004));
  return list;
}

/** The shut lines' features (the lines of channels 2 and 6). */
const SHUT_LINES = ['cutFender', 'cutB', 'cutRear', 'cutBumperRear', 'doorsBottom', 'bonnet', 'bootSide', 'bootRear', 'roofSeam'];

/**
 * What the shaders read: the channels of the atlas, each a signed distance (m, negative inside) made from the
 * features' own distances `d` (by name). Four to a texture, in order.
 */
export const CHANNELS = [
  (d) => Math.min(Math.max(d.dlo, -d.bpillar, -d.divider), d.windscreen, d.rearScreen, d.roofGlass), // 0 glass
  (d) => Math.min(d.dlo - 0.02, d.slit), // 1 gloss black: the window surround and belt strip (and so the B-pillar)
  (d) => Math.min(...SHUT_LINES.map((k) => Math.abs(d[k]))), // 2 shut lines (unsigned)
  (d) => Math.min(d.headLamp, d.tailLamp), // 3 lamp lenses
  (d) => Math.min(d.grille, d.intakeSide, d.intakeCentre), // 4 openings
  (d) => d.reflector, // 5 red reflectors
  // 6 the shut lines again, signed by the side of the nearest line. Interpolated between texels, an unsigned
  // distance only dips towards zero on the line, by as much as the texels happen to straddle it, and the line
  // came out dotted at the texels' pitch; a signed one passes through zero wherever the line is. Where the sign
  // flips away from a line (between two lines, past a line's end) the unsigned channel overrules it.
  (d) => {
    let best = Infinity;
    for (const k of SHUT_LINES) if (Math.abs(d[k]) < Math.abs(best)) best = d[k];
    return best;
  },
];
