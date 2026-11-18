// The body's skin: one smooth surface S(u, v) over the left half of the car.
//
//   u  0..1  along the car, from the centre line at the nose to the centre
//            line at the tail
//   v  0..1  round the half section: from the centre line of the floor out to
//            the lower edge, up the flank to the shoulder, up the glasshouse
//            and across the roof to the centre line
//
// All four edges of that square lie in the car's centre plane; the right half
// is the mirror image.
//
// It is a bicubic B-spline surface. Its control net is built here from the
// lines of lines.js: RAILS rails (rows of control points running along the
// car, each with a meaning: the lower edge, the widest line, the shoulder,
// the belt, ...) by as many sections as SECTIONS asks for. A B-spline never
// overshoots its control points and is curvature-continuous everywhere, which
// is what a mirror-like paint needs: a kink in the control net becomes a soft
// bend in the surface, never a crease, unless rails or sections are placed
// close together on purpose (the shoulder, the lip of the boot lid, the foot
// of each screen).
//
// The net is reflected in the centre plane at all four edges, so the surface
// crosses the plane squarely and the two halves meet without a seam. At the
// ends the sections fan round: every rail ends on the centre line.
//
// Pure arithmetic (no three.js): the same code is used by the dev tools in
// Node to plot the body over the photographs.

import { BELT, CENTRE_TOP, DLO_TOP, LOWER, NOSE, SECTIONS, SHAPE, SHOULDER, TOP_EDGE, WIDEST } from './lines.js';
import { curve, path } from './spline.js';

/** The rails by name: which row of the control net each of the body's lines is. */
export const RAIL = {
  floor: 0, // 0, 1, 2: the floor from its centre line outwards
  lower: 3,
  // 4..7 rise from the lower edge to the widest line
  widest: 8,
  // 9..11 rise from the widest line to the shoulder
  shoulderBelow: 12,
  shoulder: 13,
  shoulderAbove: 14,
  belt: 15,
  // 16, 17 on the side glass
  dloTop: 18,
  pillar: 19,
  topEdge: 20,
  // 21..23 across the top surface
  centre: 24,
};
export const RAILS = 25;

const lerp = (a, b, t) => a + (b - a) * t;
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A table of [q, a, b, ...] rows as one function of q per column. */
function columns(table) {
  const n = table[0].length - 1;
  const fns = [];
  for (let k = 1; k <= n; k++) fns.push(curve(table.map((row) => [row[0], row[k]])));
  return (q) => fns.map((f) => f(q));
}

/** Cubic that leaves `a` with slope `m` (per unit of f) and arrives at `b` with none. */
function settle(a, b, m, f) {
  const f2 = f * f;
  const f3 = f2 * f;
  return a + m * (f3 - 2 * f2 + f) + (b - a) * (3 * f2 - 2 * f3);
}

/**
 * The control net: for every section, RAILS points [x, y, z].
 * @returns {{ points: number[][][], sections: Array<{ zone: 'nose'|'main'|'tail', q: number, z: number }> }}
 */
export function buildNet() {
  const centreTop = curve(CENTRE_TOP);
  const lower = path(LOWER);
  const widest = path(WIDEST);
  const shoulder = path(SHOULDER);
  const belt = path(BELT);
  const dloTop = path(DLO_TOP);
  const topEdge = path(TOP_EDGE);
  const sweep = curve(SHAPE.sweep);
  const crown = curve(SHAPE.crown);
  const soft = curve(SHAPE.shoulderSoft);
  const floorY = curve(SHAPE.floor);
  const pillarFull = curve(SHAPE.pillarFull);
  const lowerRails = SHAPE.lower.map(columns);
  const upperRails = SHAPE.upper.map(columns);
  const sweepShape = (x) => Math.min(1, (x / SHAPE.sweepWidth) ** 2);

  const first = SECTIONS.main[0];
  const last = SECTIONS.tailStart;
  const masters = [lower, widest, shoulder];
  // where each of the three lines that run all round the car leaves the main part of the body
  const noseJoin = masters.map((m) => m.find(2, first - sweep(first)));
  const tailJoin = masters.map((m) => m.find(2, last - sweep(last)));
  const beltEnd = BELT[BELT.length - 1][2];
  const noseCorner = NOSE - SECTIONS.corner;
  const tailCorner = CENTRE_TOP[CENTRE_TOP.length - 1][0] + SECTIONS.corner;

  // Round the tail every section stands in one upright plane through an axis on the centre line where the
  // main sections end (zAxis): the widest line (the bumper's plan curve) is divided evenly along its length,
  // and the lower edge and the shoulder are cut by the plane through that point. Divided each by its own
  // length, the three lines put the points of one section in different planes, and the twisted sections
  // were dents and creases all over the boot's face and the bumper.
  const zAxis = last - sweep(last);
  const bearing = (p) => Math.atan2(p[0], zAxis - p[2]); // pi/2 square across the car, 0 straight back
  const cut = (line, lo, a) => {
    let s0 = lo;
    let s1 = line.length;
    for (let i = 0; i < 48; i++) {
      const mid = (s0 + s1) / 2;
      if (bearing(line.at(mid)) > a) s0 = mid;
      else s1 = mid;
    }
    return line.at((s0 + s1) / 2);
  };
  const tailMasters = (f) => {
    const Wp = widest.at(lerp(tailJoin[1], widest.length, f));
    const a = bearing(Wp);
    return [cut(lower, tailJoin[0], a), Wp, cut(shoulder, tailJoin[2], a)];
  };

  // The boot lid's top is one height over the plan, whichever section a point belongs to: the centre line's
  // height at that z, crowned down to the lip by SHAPE.lidCrown. (Crowned per section, as the bonnet is, the
  // lid's sections run diagonally across it and each brought its own crown: two dents beside the star.)
  const lidAt = (z) => (z >= SECTIONS.tailStart ? shoulder.at(tailJoin[2]) : shoulder.at(shoulder.find(2, z, tailJoin[2], shoulder.length)));
  const lidY = (x, z, S) => {
    const yc0 = centreTop(z);
    const edge = lidAt(z);
    const w = Math.max(edge[0], x, 1e-6);
    const ys = x >= edge[0] ? S[1] : edge[1];
    return yc0 - (yc0 - ys) * (x / w) ** SHAPE.lidCrown;
  };

  /** One section. `zone` says how it is placed: by the centre line's z (`main`) or by a fraction `f` of the way round an end. */
  function section(zone, value) {
    const pts = new Array(RAILS);
    let q;
    let zc; // z of the top's centre line
    let zf; // z of the floor's centre line
    let m; // the three master points: lower edge, widest line, shoulder
    if (zone === 'main') {
      q = zc = zf = value;
      const zs = value - sweep(value);
      m = masters.map((line) => line.at(line.find(2, zs)));
    } else if (zone === 'nose') {
      q = first + value;
      zc = settle(first, noseCorner, 1.0, value);
      zf = settle(first, LOWER[0][2] - SECTIONS.corner, 1.0, value);
      m = masters.map((line, i) => line.at(noseJoin[i] * (1 - value)));
    } else {
      q = last - value;
      zc = settle(last, SECTIONS.lidCentre, -0.8, value);
      zf = settle(last, LOWER[LOWER.length - 1][2] + SECTIONS.corner, -0.8, value);
      m = tailMasters(value);
    }
    const [L, W, S] = m;
    if (zone !== 'main' && value === 1) L[0] = W[0] = S[0] = 0;

    // ---- the floor: flat, turning up into the lower edge only at the very end
    const yf = floorY(q);
    [0, 0.5, 0.9].forEach((t, k) => {
      pts[RAIL.floor + k] = [t * L[0], yf + (L[1] - yf) * t ** 6, zf + (L[2] - zf) * t * t];
    });
    pts[RAIL.lower] = L;

    // ---- the flank, between the three lines: each rail a set way across (in plan) and up
    const between = (A, B, [across, up]) => [lerp(A[0], B[0], across), lerp(A[1], B[1], up), lerp(A[2], B[2], across)];
    lowerRails.forEach((rail, k) => {
      pts[RAIL.lower + 1 + k] = between(L, W, rail(q));
    });
    pts[RAIL.widest] = W;
    upperRails.forEach((rail, k) => {
      pts[RAIL.widest + 1 + k] = between(W, S, rail(q));
    });
    pts[RAIL.shoulder] = S;

    // ---- above the shoulder
    const yc = centreTop(zc);
    const p = crown(q);
    const glasshouse = zone === 'main' && value < SECTIONS.cowl && value > SECTIONS.rearFoot;
    if (!glasshouse) {
      // bonnet, boot lid and the ends: one crowned sweep from the centre line down to the shoulder
      SHAPE.deck.forEach((t, k) => {
        const z = zc + (S[2] - zc) * Math.min(1, (t / 0.94) ** 2);
        // round the tail the lid's height is the centre line's at the point's own z, crowned down to the lip
        pts[RAIL.belt + k] = zone === 'tail' ? [t * S[0], lidY(t * S[0], z, S), z] : [t * S[0], yc - (yc - S[1]) * t ** p, z];
      });
    } else {
      const sw = sweep(value);
      // a point of one of the glasshouse's lines, on this section: the section sweeps back with x, and x is
      // only known once the point is, so the two are settled together
      const on = (line) => {
        let pt = line.at(line.find(2, value - sw));
        for (let i = 0; i < 4; i++) pt = line.at(line.find(2, value - sw * sweepShape(pt[0])));
        return pt;
      };
      const E = on(topEdge);
      let B;
      let D;
      const zs = value - sw;
      if (zs >= beltEnd) {
        B = on(belt);
        D = on(dloTop);
      } else {
        // behind the side glass its two edges run on together across the rear pillar, between shoulder and top edge
        const back = Math.min(1, (beltEnd - zs) / (beltEnd - (SECTIONS.rearFoot + 0.115)));
        B = S.map((s, i) => lerp(s, E[i], lerp(0.26, 0.125, back)));
        D = S.map((s, i) => lerp(s, E[i], lerp(0.26, 0.35, back)));
      }
      const full = (A, C, t, amount) => {
        // a point between A and C, pushed outwards (square to the line A-C in the section) by `amount`
        const n = unit([C[1] - A[1], -(C[0] - A[0]), 0]);
        return [lerp(A[0], C[0], t) + n[0] * amount, lerp(A[1], C[1], t) + n[1] * amount, lerp(A[2], C[2], t)];
      };
      pts[RAIL.belt] = B;
      pts[RAIL.belt + 1] = full(B, D, 1 / 3, SHAPE.glassFull);
      pts[RAIL.belt + 2] = full(B, D, 2 / 3, SHAPE.glassFull);
      pts[RAIL.dloTop] = D;
      pts[RAIL.pillar] = full(D, E, 0.5, pillarFull(zs));
      pts[RAIL.topEdge] = E;
      [0.75, 0.5, 0.25, 0].forEach((t, k) => {
        const x = t * E[0];
        pts[RAIL.topEdge + 1 + k] = [x, yc - (yc - E[1]) * t ** p, value - sw * sweepShape(x)];
      });
    }

    // ---- the shoulder's crease: a rail close on either side of it; the closer, the sharper
    const d = soft(q);
    const beside = (towards) => {
      const v = [towards[0] - S[0], towards[1] - S[1], towards[2] - S[2]];
      const len = Math.hypot(v[0], v[1], v[2]);
      const step = len > 1e-9 ? Math.min(d, 0.45 * len) / len : 0;
      return [S[0] + v[0] * step, S[1] + v[1] * step, S[2] + v[2] * step];
    };
    pts[RAIL.shoulderBelow] = beside(pts[RAIL.shoulderBelow - 1]);
    pts[RAIL.shoulderAbove] = beside(pts[RAIL.belt]);

    return { zone, q, z: zc, pts };
  }

  const sections = [];
  for (let i = SECTIONS.noseSteps; i >= 1; i--) sections.push(section('nose', i / SECTIONS.noseSteps));
  for (const z of SECTIONS.main) sections.push(section('main', z));
  for (let i = 0; i <= SECTIONS.tailSteps; i++) sections.push(section('tail', i / SECTIONS.tailSteps));
  return { points: sections.map((s) => s.pts), sections: sections.map(({ zone, q, z }) => ({ zone, q, z })) };
}

/**
 * @typedef {object} Skin
 * @property {number} nu sections of the control net
 * @property {number} nv rails of the control net
 * @property {Array<{ zone: string, q: number, z: number }>} sections what each section of the net is
 * @property {(u: number, v: number, out?: Float64Array) => Float64Array} point S(u, v) -> [x, y, z]
 * @property {(u: number, v: number, out?: Float64Array) => Float64Array} frame S(u, v) and the outward unit normal
 *   -> [x, y, z, nx, ny, nz]
 * @property {(u: number, v: number, out?: Float64Array) => Float64Array} surface the finished surface and its normal
 * @property {(z: number, y: number) => number} sideX x of the flank at a point of the side view
 * @property {number[][][]} net the control points, [section][rail] -> [x, y, z]
 */

/**
 * @param {{ points: number[][][], sections: object[] }} [net] default: the car's (buildNet)
 * @returns {Skin}
 */
export function createSkin(net = buildNet()) {
  const nu = net.points.length;
  const nv = net.points[0].length;
  // the net with one more row all round, reflected in the centre plane (x -> -x)
  const w = nv + 2;
  const P = new Float64Array((nu + 2) * w * 3);
  for (let i = -1; i <= nu; i++) {
    for (let k = -1; k <= nv; k++) {
      const si = i < 0 ? -i : i >= nu ? 2 * (nu - 1) - i : i;
      const sk = k < 0 ? -k : k >= nv ? 2 * (nv - 1) - k : k;
      const flips = (si !== i ? 1 : 0) + (sk !== k ? 1 : 0);
      const p = net.points[si][sk];
      const o = ((i + 1) * w + (k + 1)) * 3;
      P[o] = flips === 1 ? -p[0] : p[0];
      P[o + 1] = p[1];
      P[o + 2] = p[2];
    }
  }

  const bu = new Float64Array(4);
  const bv = new Float64Array(4);
  const du = new Float64Array(4);
  const dv = new Float64Array(4);
  /** Uniform cubic B-spline weights of the four control points round parameter t (0..1 within a span), and their derivatives. */
  function basis(t, b, d) {
    const s = 1 - t;
    b[0] = (s * s * s) / 6;
    b[1] = (3 * t * t * t - 6 * t * t + 4) / 6;
    b[2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
    b[3] = (t * t * t) / 6;
    d[0] = (-s * s) / 2;
    d[1] = (3 * t * t - 4 * t) / 2;
    d[2] = (-3 * t * t + 2 * t + 1) / 2;
    d[3] = (t * t) / 2;
  }

  const acc = new Float64Array(9);
  function evaluate(u, v) {
    const fu = Math.min(Math.max(u, 0), 1) * (nu - 1);
    const fv = Math.min(Math.max(v, 0), 1) * (nv - 1);
    const iu = Math.min(Math.floor(fu), nu - 2);
    const iv = Math.min(Math.floor(fv), nv - 2);
    basis(fu - iu, bu, du);
    basis(fv - iv, bv, dv);
    acc.fill(0);
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const o = ((iu + a) * w + (iv + b)) * 3;
        const wp = bu[a] * bv[b];
        const wu = du[a] * bv[b];
        const wv = bu[a] * dv[b];
        for (let c = 0; c < 3; c++) {
          const x = P[o + c];
          acc[c] += wp * x;
          acc[3 + c] += wu * x;
          acc[6 + c] += wv * x;
        }
      }
    }
  }

  // ---- finding the flank from the side: a coarse table of where it is, then Newton's method
  const FLANK = { v0: RAIL.lower / (nv - 1), v1: RAIL.shoulderAbove / (nv - 1), nu: 96, nv: 40 };
  let flank = null;
  function flankTable() {
    flank = new Float64Array(FLANK.nu * FLANK.nv * 2);
    for (let i = 0; i < FLANK.nu; i++) {
      for (let k = 0; k < FLANK.nv; k++) {
        evaluate((i + 0.5) / FLANK.nu, lerp(FLANK.v0, FLANK.v1, (k + 0.5) / FLANK.nv));
        flank[(i * FLANK.nv + k) * 2] = acc[2];
        flank[(i * FLANK.nv + k) * 2 + 1] = acc[1];
      }
    }
  }

  return {
    nu,
    nv,
    sections: net.sections,
    net: net.points,
    /**
     * Half the body's width where the flank passes the point (z, y) of the side view: x of the skin there.
     * Meant for points on the side of the car between the lower edge and the shoulder.
     */
    sideX(z, y) {
      if (!flank) flankTable();
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < FLANK.nu * FLANK.nv; j++) {
        const d = (flank[j * 2] - z) ** 2 + (flank[j * 2 + 1] - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      let u = (Math.floor(best / FLANK.nv) + 0.5) / FLANK.nu;
      let v = lerp(FLANK.v0, FLANK.v1, ((best % FLANK.nv) + 0.5) / FLANK.nv);
      for (let step = 0; step < 12; step++) {
        evaluate(u, v);
        // the derivatives are per span of the net
        const zu = acc[5] * (nu - 1);
        const zv = acc[8] * (nv - 1);
        const yu = acc[4] * (nu - 1);
        const yv = acc[7] * (nv - 1);
        const det = zu * yv - zv * yu;
        if (Math.abs(det) < 1e-12) break;
        const ez = z - acc[2];
        const ey = y - acc[1];
        u = Math.min(1, Math.max(0, u + (ez * yv - ey * zv) / det));
        v = Math.min(1, Math.max(0, v + (zu * ey - yu * ez) / det));
      }
      evaluate(u, v);
      return acc[0];
    },
    point(u, v, out = new Float64Array(3)) {
      evaluate(u, v);
      out[0] = acc[0];
      out[1] = acc[1];
      out[2] = acc[2];
      return out;
    },
    frame(u, v, out = new Float64Array(6)) {
      evaluate(u, v);
      out[0] = acc[0];
      out[1] = acc[1];
      out[2] = acc[2];
      // u runs back along the car and v up the flank: their cross product points out of the left side
      let nx = acc[4] * acc[8] - acc[5] * acc[7];
      let ny = acc[5] * acc[6] - acc[3] * acc[8];
      let nz = acc[3] * acc[7] - acc[4] * acc[6];
      let len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) {
        // one of the four corners of the square, where both derivatives vanish: the normal of a point just inside
        const e = 1e-3;
        evaluate(u < 0.5 ? e : 1 - e, v < 0.5 ? e : 1 - e);
        nx = acc[4] * acc[8] - acc[5] * acc[7];
        ny = acc[5] * acc[6] - acc[3] * acc[8];
        nz = acc[3] * acc[7] - acc[4] * acc[6];
        len = Math.hypot(nx, ny, nz) || 1;
      }
      out[3] = nx / len;
      out[4] = ny / len;
      out[5] = nz / len;
      return out;
    },
    /** The finished surface (the skin with its smaller forms pressed into it) and its normal: what the meshes are sampled from. */
    surface(u, v, out = new Float64Array(6)) {
      return this.frame(u, v, out);
    },
  };
}
