// The circuit: a closed loop around the main island, described by its centre
// line. Everything else (slalom marks, boundary floats, grid, the bots' racing
// line, lap counting) is derived from positions *along* that line.
//
// Track frame at arc length s:
//   tangent  = direction of travel
//   right    = (-tz, tx)  -> "lateral" > 0 is to the driver's right

import * as THREE from 'three';
import { DEG, smoothstep } from '../engine/math.js';

// [angle around the island (deg), radius (m)] — a slightly lumpy circle.
const CONTROL = [
  [0, 172],
  [36, 190],
  [72, 160],
  [108, 186],
  [144, 204],
  [180, 168],
  [216, 150],
  [252, 184],
  [288, 200],
  [324, 164],
];

// Slalom marks: fraction of the lap, and the side you must pass on.
const GATES = [
  [0.085, 'right'],
  [0.19, 'left'],
  [0.3, 'right'],
  [0.405, 'left'],
  [0.5, 'left'],
  [0.61, 'right'],
  [0.715, 'left'],
  [0.82, 'right'],
  [0.925, 'left'],
];

export const HALF_WIDTH = 26; // course half-width (m)
const BUOY_LATERAL = 6.5; // how far off the centre line the marks sit
const LINE_CLEARANCE = 7.5; // how wide of a mark the ideal line passes
const LINE_HOLD = 15; // metres either side of a mark where the line stays put
const SAMPLES = 800;

export function createTrack() {
  const points = CONTROL.map(([a, r]) => new THREE.Vector3(Math.cos(a * DEG) * r, 0, Math.sin(a * DEG) * r));
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const spaced = curve.getSpacedPoints(SAMPLES);

  const N = SAMPLES;
  const ds = length / N;
  const px = new Float32Array(N);
  const pz = new Float32Array(N);
  const tx = new Float32Array(N);
  const tz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = spaced[i].x;
    pz[i] = spaced[i].z;
  }
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N;
    const b = (i + 1) % N;
    const dx = px[b] - px[a];
    const dz = pz[b] - pz[a];
    const inv = 1 / Math.hypot(dx, dz);
    tx[i] = dx * inv;
    tz[i] = dz * inv;
  }

  const wrap = (s) => ((s % length) + length) % length;

  /** Centre line position + frame at arc length s. */
  function sample(s, out = {}) {
    const f = wrap(s) / ds;
    const i0 = Math.floor(f) % N;
    const i1 = (i0 + 1) % N;
    const t = f - Math.floor(f);
    out.x = px[i0] + (px[i1] - px[i0]) * t;
    out.z = pz[i0] + (pz[i1] - pz[i0]) * t;
    let ax = tx[i0] + (tx[i1] - tx[i0]) * t;
    let az = tz[i0] + (tz[i1] - tz[i0]) * t;
    const inv = 1 / Math.hypot(ax, az);
    ax *= inv;
    az *= inv;
    out.tx = ax;
    out.tz = az;
    out.rx = -az;
    out.rz = ax;
    out.heading = Math.atan2(ax, az);
    return out;
  }

  /** World position at (s, lateral). */
  function pointAt(s, lateral, out = {}) {
    sample(s, out);
    out.x += out.rx * lateral;
    out.z += out.rz * lateral;
    return out;
  }

  /**
   * Project a world position onto the centre line.
   * `hint` is the sample index found last time (pass -1 for a global search).
   * Returns { index, s, lateral }.
   */
  function locate(x, z, hint, out = {}) {
    let best = -1;
    let bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const d = (px[i] - x) * (px[i] - x) + (pz[i] - z) * (pz[i] - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    } else {
      for (let k = -30; k <= 30; k++) {
        const i = (hint + k + N) % N;
        const d = (px[i] - x) * (px[i] - x) + (pz[i] - z) * (pz[i] - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // refine along the local tangent
    const along = (x - px[best]) * tx[best] + (z - pz[best]) * tz[best];
    out.index = best;
    out.s = wrap(best * ds + along);
    out.lateral = (x - px[best]) * -tz[best] + (z - pz[best]) * tx[best];
    return out;
  }

  // ---- slalom marks
  const gates = GATES.map(([frac, pass], i) => {
    const s = frac * length;
    const side = pass === 'right' ? 1 : -1; // +1: driver must end up right of the mark
    const lateral = side * BUOY_LATERAL;
    const p = pointAt(s, lateral);
    return { index: i, s, pass, side, lateral, x: p.x, z: p.z, heading: p.heading, lineOffset: lateral + side * LINE_CLEARANCE };
  });

  /** Lateral offset of the ideal line (what the bots aim for) at arc length s. */
  function lineOffset(s) {
    s = wrap(s);
    const n = gates.length;
    let b = gates.findIndex((g) => g.s > s);
    let sa;
    let sb;
    let a;
    if (b === -1) {
      a = n - 1;
      b = 0;
      sa = gates[a].s;
      sb = gates[b].s + length;
    } else if (b === 0) {
      a = n - 1;
      sa = gates[a].s - length;
      sb = gates[b].s;
    } else {
      a = b - 1;
      sa = gates[a].s;
      sb = gates[b].s;
    }
    // hold the line a little before and after each mark, swap sides in between
    const hold = Math.min(LINE_HOLD, (sb - sa) * 0.3);
    const t = smoothstep(0, 1, (s - sa - hold) / (sb - sa - 2 * hold));
    return gates[a].lineOffset + (gates[b].lineOffset - gates[a].lineOffset) * t;
  }

  /** Starting grid: four abreast, a few boat lengths behind the line. */
  function gridSlot(i) {
    const laterals = [-9, -3, 3, 9];
    const s = length - 14;
    const p = pointAt(s, laterals[i % 4]);
    return { x: p.x, z: p.z, heading: p.heading, s: -14 };
  }

  /** Positions for the boundary floats on both edges. */
  function boundaryPoints(spacing = 24) {
    const pts = [];
    const count = Math.round(length / spacing);
    for (let i = 0; i < count; i++) {
      const s = (i / count) * length;
      for (const side of [1, -1]) {
        const p = pointAt(s, side * HALF_WIDTH);
        pts.push({ x: p.x, z: p.z });
      }
    }
    return pts;
  }

  return {
    length,
    halfWidth: HALF_WIDTH,
    samples: N,
    ds,
    px,
    pz,
    gates,
    wrap,
    sample,
    pointAt,
    locate,
    lineOffset,
    gridSlot,
    boundaryPoints,
  };
}
