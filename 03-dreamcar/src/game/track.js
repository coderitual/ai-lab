// The road and its corridor: the layout (trackLayout.js) turned into something
// that can be driven on, drawn and asked questions.
//
// Two ideas hold it together.
//
// 1. Everything hangs on the centre line. The plan is integrated from its
//    curvature (so direction and curvature are continuous by construction),
//    sampled about every metre, and the samples are joined by Hermite cubics
//    through their exact positions and directions. `frameAt` and `locate` read
//    the same cubics, so one is the inverse of the other to a fraction of a
//    millimetre and a wheel at 250 km/h never meets a facet.
//
// 2. Track coordinates are (s, lat). `s` is the distance along the centre line
//    on the map (so `length` is the map length; the road itself is about a
//    thousandth longer because it climbs). `lat` is measured along `left`, the
//    unit vector across the road, tilted by the banking: the map position of
//    (s, lat) is pos(s) + lat * left(s) for ANY lat, and on the pavement that
//    point is on the surface too. `left` is level with the cross-section a
//    surveyor would draw (square to the centre line on the map), so on a banked
//    climb it is a hair off square to the tangent in space; the normal is
//    tangent x left.
//
// Pure JavaScript: runs in Node as well as in the browser.

import { Vector3 } from 'three';
import { LAYOUT, TUNNEL, VIADUCT, sectionsOf, segmentLength } from './trackLayout.js';

/** What a wheel can stand on. */
export const SURFACE = { ASPHALT: 0, SHOULDER: 1, GRASS: 2, GRAVEL: 3 };

/** Base grip of each SURFACE relative to dry asphalt, indexed by SURFACE. */
export const GRIP = [1, 0.75, 0.55, 0.6];

/** What the solid edge of the corridor is. */
export const EDGE = { RAIL: 0, ROCK: 1, WALL: 2, PARAPET: 3, TREES: 4 };

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const G = 9.81;

const SAMPLE_SPACING = 1; // m between samples of the centre line (the real spacing divides the lap exactly)
const SUBSTEPS = 8; // integration steps per sample
const CLOSE_GAP = 0.05; // m the baked layout may miss its own start by (spread along the lap) before it is an error
const EDGE_RATE = 0.12; // m per metre: the most a solid edge may move towards or away from the road
const EDGE_ROUND = 4; // m: corners of the edge lines are rounded over this half width
const BLEND = 10; // m: half width of the smoothing of slopes where the roadside changes
const GRADE_ROUND = 8; // m: half width of the rounding where a vertical curve begins and ends
const BANK_ROUND = 7; // m: half width of the rounding of the banking as it builds into a bend
const PORTAL_OUT = 8; // m outside a portal where the sky starts to close
const PORTAL_IN = 17; // m inside it where the last of it has gone
const FAR_REACH = 45; // m beyond the edge within which another stretch of road shapes the hillside
const FAR_STEP = 3; // m between probes on the way there
const FAR_OWN = 45; // m along the lap within which a sample is "this stretch", not another one
const FAR_LIMIT = 3; // steepest hillside handed to the terrain (rise per metre)
const CELL = 16; // m: cell of the grid used to find the road from anywhere
const WALK_MAX = 40; // samples a hinted search may walk before it gives up and looks everywhere
const OFF_ROAD = 3; // m beyond the solid edge at which a hinted answer is checked against a global one

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const KIND = { rail: EDGE.RAIL, rock: EDGE.ROCK, wall: EDGE.WALL, parapet: EDGE.PARAPET, trees: EDGE.TREES };
const VERGE = { asphalt: SURFACE.ASPHALT, grass: SURFACE.GRASS, gravel: SURFACE.GRAVEL };

/**
 * The plan as a function: curvature against distance.
 * @param {typeof LAYOUT} layout
 */
export function planOf(layout) {
  const segs = layout.segments;
  const n = segs.length;
  const starts = new Float64Array(n + 1);
  const k = new Float64Array(n);
  const ease = new Float64Array(n);
  let turn = 0;
  for (let i = 0; i < n; i++) {
    const len = segmentLength(segs[i]);
    k[i] = segs[i].r ? 1 / segs[i].r : 0;
    ease[i] = segs[i].ease ?? 0;
    starts[i + 1] = starts[i] + len;
    turn += k[i] * len;
  }
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    if (ease[i] <= 0 && Math.abs(k[i] - k[prev]) > 1e-12) {
      throw new Error(`track layout: "${segs[i].id}" changes curvature and needs an ease`);
    }
    if ((ease[i] + ease[next]) / 2 > starts[i + 1] - starts[i] + 1e-9) {
      throw new Error(`track layout: "${segs[i].id}" is too short for the eases at its ends`);
    }
  }
  const length = starts[n];

  /** Index of the piece that holds distance s (0 <= s < length). */
  function pieceAt(s) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Curvature (1/m, + = left) at distance s: the piece's own, eased towards its neighbours near its ends. */
  function curvatureAt(s) {
    const i = pieceAt(s);
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    let c = k[i];
    if (ease[i] > 0) c += (k[prev] - k[i]) * (1 - smooth(0.5 + (s - starts[i]) / ease[i]));
    if (ease[next] > 0) c += (k[next] - k[i]) * (1 - smooth(0.5 + (starts[i + 1] - s) / ease[next]));
    return c;
  }

  /** Distance of a point given as [piece id, fraction along it]. */
  function at(id, u = 0) {
    const i = segs.findIndex((seg) => seg.id === id);
    if (i < 0) throw new Error(`track layout: no piece called "${id}"`);
    return starts[i] + (starts[i + 1] - starts[i]) * u;
  }

  return { n, starts, k, ease, length, turn, pieceAt, curvatureAt, at };
}

/**
 * Integrates the plan from the start pose: `count` equal steps round the lap, positions and headings in doubles.
 * `extra` is a constant added to the curvature (used to spread a rounding error in the total turn).
 */
function integratePlan(plan, layout, count, extra = 0) {
  const x = new Float64Array(count + 1);
  const z = new Float64Array(count + 1);
  const yaw = new Float64Array(count + 1);
  const curv = new Float64Array(count + 1);
  const ds = plan.length / count;
  const h = ds / SUBSTEPS;
  const kAt = (s) => plan.curvatureAt(s) + extra;
  let px = layout.start.x;
  let pz = layout.start.z;
  let a = layout.start.yaw * DEG;
  x[0] = px;
  z[0] = pz;
  yaw[0] = a;
  curv[0] = kAt(0);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < SUBSTEPS; j++) {
      const s = i * ds + j * h;
      const k0 = kAt(s);
      const km = kAt(s + h / 2);
      const k1 = kAt(s + h);
      // Simpson's rule for the heading at the middle and the end of the step, then for the position.
      const am = a + (h / 24) * (5 * k0 + 8 * km - k1);
      const a1 = a + (h / 6) * (k0 + 4 * km + k1);
      px += (h / 6) * (Math.sin(a) + 4 * Math.sin(am) + Math.sin(a1));
      pz += (h / 6) * (Math.cos(a) + 4 * Math.cos(am) + Math.cos(a1));
      a = a1;
    }
    x[i + 1] = px;
    z[i + 1] = pz;
    yaw[i + 1] = a;
    curv[i + 1] = kAt((i + 1) * ds);
  }
  return { x, z, yaw, curv, ds };
}

/**
 * How far the layout is from closing: where one lap ends relative to where it began.
 * @param {typeof LAYOUT} layout
 * @returns {{ dx: number, dz: number, dyaw: number, length: number }} metres and radians (dyaw 0 = exactly one right-hand turn)
 */
export function closureOf(layout = LAYOUT) {
  const plan = planOf(layout);
  const count = Math.max(8, Math.round(plan.length / SAMPLE_SPACING));
  const p = integratePlan(plan, layout, count);
  return { dx: p.x[count] - p.x[0], dz: p.z[count] - p.z[0], dyaw: p.yaw[count] - p.yaw[0] + TAU, length: plan.length };
}

/** Running mean over `half` samples each side, round the loop, `passes` times (in place). */
function roundOff(values, half, passes = 2) {
  const n = values.length;
  if (half < 1) return values;
  const sum = new Float64Array(n + 1);
  const width = 2 * half + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + values[i];
    const total = sum[n];
    for (let i = 0; i < n; i++) {
      const a = i - half;
      const b = i + half + 1;
      let acc = sum[Math.min(b, n)] - sum[Math.max(a, 0)];
      if (a < 0) acc += total - sum[n + a];
      if (b > n) acc += sum[b - n];
      values[i] = acc / width;
    }
  }
  return values;
}

/** The lowest of the values within `half` samples, round the loop. */
function erode(values, half) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = values[i];
    for (let j = 1; j <= half; j++) {
      lo = Math.min(lo, values[(i + j) % n], values[(i - j + n) % n]);
    }
    out[i] = lo;
  }
  return out;
}

/** The widest line that is nowhere above `values` and never changes by more than `step` per sample (in place). */
function slewLimit(values, step) {
  const n = values.length;
  for (let i = 1; i < 2 * n; i++) values[i % n] = Math.min(values[i % n], values[(i - 1) % n] + step);
  for (let i = 2 * n - 2; i >= 0; i--) values[i % n] = Math.min(values[i % n], values[(i + 1) % n] + step);
  return values;
}

/**
 * The cross-section of the corridor: height at `lat` relative to the centre line. The pavement and the shoulder are
 * one banked plane (out to `pave`), the verge then follows its own slope to the solid edge, and beyond that the
 * hillside its far slope. It is linear in (sinBank, slope, far), so the same function gives its rate of change
 * along the road from theirs.
 */
function crossSection(lat, pave, edge, sinBank, slope, far) {
  const a = Math.abs(lat);
  if (a <= pave) return lat * sinBank;
  const base = (lat > 0 ? pave : -pave) * sinBank;
  if (a <= edge) return base + (a - pave) * slope;
  return base + (edge - pave) * slope + (a - edge) * far;
}

/** Rise of the cross-section per metre of lat (towards the left) at `lat`. */
function crossSlope(lat, pave, edge, sinBank, slope, far) {
  const a = Math.abs(lat);
  if (a <= pave) return sinBank;
  const out = a <= edge ? slope : far;
  return lat > 0 ? out : -out;
}

/** Scratch for the queries: one located point. */
function makeSpot() {
  return { seg: 0, u: 0, x: 0, z: 0, fx: 0, fz: 1, q: 0, sinb: 0, dsinb: 0, cosb: 1, lat: 0 };
}

// ---- building: each step fills in part of a Track ----------------------------------------------------------------

/**
 * The centre line on the map. The turned angles in the layout are rounded numbers: whatever they miss a full turn
 * by is spread evenly as curvature, and whatever the baked lengths miss the start by is spread evenly along the lap.
 */
function layCentreLine(track, plan) {
  const n = track.count;
  const yawGap = plan.turn + TAU;
  const p = integratePlan(plan, track.layout, n, -yawGap / plan.length);
  const gapX = p.x[n] - p.x[0];
  const gapZ = p.z[n] - p.z[0];
  const gap = Math.hypot(gapX, gapZ);
  if (gap > CLOSE_GAP || Math.abs(yawGap) > 0.05 * DEG) {
    throw new Error(
      `track layout does not close: off by ${gap.toFixed(3)} m and ${(yawGap / DEG).toFixed(3)} degrees ` +
        '(run tools/trackmap.mjs --fit)',
    );
  }
  for (let i = 0; i < n; i++) {
    const f = i / n;
    track.px[i] = p.x[i] - gapX * f;
    track.pz[i] = p.z[i] - gapZ * f;
    track._fx[i] = Math.sin(p.yaw[i]);
    track._fz[i] = Math.cos(p.yaw[i]);
    track.curvature[i] = p.curv[i];
  }
  track.closure.gap = gap;
  track.closure.yawGap = yawGap;
}

/**
 * Height. Gradient knots at the ends of the pieces (and wherever a piece asks for more), straight lines between
 * them, the corners rounded: every change of gradient is a vertical curve. The descent is then scaled by a hair so
 * that the lap comes back to its own height; `closure.gradeScale` says by how much (the layout is kept within a
 * fraction of a per cent of 1, so its numbers are the road's).
 */
function layHeight(track, plan) {
  const { count: n, ds } = track;
  const segs = track.layout.segments;
  const knots = [[0, segs[segs.length - 1].g]];
  for (let i = 0; i < segs.length; i++) {
    const len = plan.starts[i + 1] - plan.starts[i];
    for (const [u, g] of segs[i].gk ?? []) knots.push([plan.starts[i] + u * len, g]);
    knots.push([plan.starts[i + 1], segs[i].g]);
  }
  const grade = new Float64Array(n);
  for (let i = 0, kn = 0; i < n; i++) {
    const s = i * ds;
    while (kn < knots.length - 2 && knots[kn + 1][0] <= s) kn++;
    const [s0, g0] = knots[kn];
    const [s1, g1] = knots[kn + 1];
    grade[i] = (g0 + (g1 - g0) * clamp((s - s0) / Math.max(1e-9, s1 - s0), 0, 1)) / 100;
  }
  roundOff(grade, Math.round(GRADE_ROUND / ds));
  let up = 0;
  let down = 0;
  for (let i = 0; i < n; i++) {
    if (grade[i] > 0) up += grade[i];
    else down -= grade[i];
  }
  const gradeScale = down > 0 ? up / down : 1;
  let height = track.layout.start.y;
  for (let i = 0; i < n; i++) {
    if (grade[i] < 0) grade[i] *= gradeScale;
    if (i > 0) height += ((grade[i - 1] + grade[i]) / 2) * ds;
    track.py[i] = height;
    track.grade[i] = grade[i];
  }
  track.closure.gradeScale = gradeScale;
}

/** Banking into the bends, and the frame at every sample: tangent, left (tilted by the banking), normal. */
function layFrames(track) {
  const { count: n, ds, layout } = track;
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = -layout.bank * DEG * Math.tanh(track.curvature[i] * layout.bankRadius);
  roundOff(bank, Math.round(BANK_ROUND / ds));
  for (let i = 0; i < n; i++) {
    const fx = track._fx[i];
    const fz = track._fz[i];
    const cp = 1 / Math.hypot(1, track.grade[i]);
    const sp = track.grade[i] * cp;
    const cb = Math.cos(bank[i]);
    const sb = Math.sin(bank[i]);
    const tx = fx * cp;
    const tz = fz * cp;
    // Level left is up x forward = (fz, 0, -fx); the banking tilts it about the direction of travel on the map.
    const lx = fz * cb;
    const lz = -fx * cb;
    // normal = tangent x left
    const nx = sp * lz - tz * sb;
    const ny = tz * lx - tx * lz;
    const nz = tx * sb - sp * lx;
    const inv = 1 / Math.hypot(nx, ny, nz);
    track.tx[i] = tx;
    track.ty[i] = sp;
    track.tz[i] = tz;
    track.lx[i] = lx;
    track.ly[i] = sb;
    track.lz[i] = lz;
    track.nx[i] = nx * inv;
    track.ny[i] = ny * inv;
    track.nz[i] = nz * inv;
    track.bank[i] = bank[i];
  }
}

/** The tunnel and the viaduct, and how much sky is overhead. */
function layStructures(track, plan) {
  const { count: n, ds } = track;
  const segs = track.layout.segments;
  for (let i = 0; i < segs.length; i++) {
    const range = { s0: plan.starts[i], s1: plan.starts[i + 1] };
    if (segs[i].tunnel) track.tunnels.push(range);
    if (segs[i].bridge) track.bridges.push({ ...range, drop: VIADUCT.drop });
  }
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    let sky = 1;
    for (const t of track.tunnels) {
      const inside = Math.min(s - t.s0, t.s1 - s);
      sky = Math.min(sky, 1 - smooth((inside + PORTAL_OUT) / (PORTAL_OUT + PORTAL_IN)));
    }
    track.sky[i] = sky;
  }
}

/**
 * The corridor. Each piece names a preset for each side. The distance to the solid edge wanders inside the
 * preset's range and is then held under a limit on how fast it may change, so rails and walls are continuous
 * lines; the slopes are blended where the roadside changes. Returns the presets' far slopes per side, for
 * shapeHillside to finish.
 */
function layCorridor(track, plan) {
  const { count: n, ds, layout } = track;
  const segs = layout.segments;
  const sides = [
    { key: 'L', edge: track.edgeL, kind: track.kindL, verge: track.vergeL, slope: track.slopeL, phase: 0.6 },
    { key: 'R', edge: track.edgeR, kind: track.kindR, verge: track.vergeR, slope: track.slopeR, phase: 2.9 },
  ];
  const far = [new Float64Array(n), new Float64Array(n)];
  for (let side = 0; side < 2; side++) {
    const out = sides[side];
    const edge = new Float64Array(n);
    const slope = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      const seg = segs[plan.pieceAt(s)];
      const preset = layout.sides[seg[out.key]];
      if (!preset) throw new Error(`track layout: "${seg.id}" names an unknown roadside "${seg[out.key]}"`);
      // Two slow waves with whole numbers of periods in a lap, so the wander has no seam either.
      const a = (TAU * s) / plan.length;
      const wander = 0.5 + 0.3 * Math.sin(23 * a + out.phase) + 0.2 * Math.sin(37 * a + 2 * out.phase + 1);
      edge[i] = track.halfWidth + preset.edge[0] + (preset.edge[1] - preset.edge[0]) * wander;
      slope[i] = preset.slope;
      far[side][i] = preset.far;
      out.kind[i] = KIND[preset.kind];
      out.verge[i] = VERGE[preset.verge];
    }
    // Narrow first (so the rounding that follows cannot push an edge out beyond what its preset allows, and the
    // tunnel's walls stay exactly where they are), then limit the rate, then round the corners.
    const round = Math.round(EDGE_ROUND / ds);
    const limited = roundOff(slewLimit(erode(edge, round), EDGE_RATE * ds), round, 1);
    roundOff(slope, Math.round(BLEND / ds));
    for (let i = 0; i < n; i++) {
      out.edge[i] = limited[i];
      out.slope[i] = slope[i];
    }
  }
  return far;
}

/** The grid that finds the nearest sample to any point: every sample filed under the cell it stands in. */
function buildGrid(track) {
  const n = track.count;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, track.px[i]);
    maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]);
    maxZ = Math.max(maxZ, track.pz[i]);
  }
  track.bounds = { minX, maxX, minZ, maxZ };
  track._gx0 = minX - CELL;
  track._gz0 = minZ - CELL;
  track._gw = Math.ceil((maxX - minX) / CELL) + 3;
  track._gh = Math.ceil((maxZ - minZ) / CELL) + 3;
  const cellOf = new Int32Array(n);
  const cellStart = new Int32Array(track._gw * track._gh + 1);
  for (let i = 0; i < n; i++) {
    const c = Math.floor((track.px[i] - track._gx0) / CELL) + track._gw * Math.floor((track.pz[i] - track._gz0) / CELL);
    cellOf[i] = c;
    cellStart[c + 1]++;
  }
  for (let c = 0; c < track._gw * track._gh; c++) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, -1);
  const cellItems = new Int32Array(n);
  for (let i = 0; i < n; i++) cellItems[fill[cellOf[i]]++] = i;
  track._cellStart = cellStart;
  track._cellItems = cellItems;
}

/**
 * The hillside beyond the solid edges. Where nothing else is near, the preset says what the hill does. Where
 * another stretch of the road passes close by (the hairpin stack above all) the ground between the two has to be
 * the same ground seen from either: a probe walks out from the edge until it is nearer to the other stretch than
 * to this one, and the slope is the one that joins the two solid edges.
 */
function shapeHillside(track, far) {
  const { count: n, ds, px, pz } = track;
  const cellStart = track._cellStart;
  const cellItems = track._cellItems;
  const edges = [track.edgeL, track.edgeR];
  const others = new Int32Array(n);
  const own = FAR_OWN / ds;
  for (let i = 0; i < n; i++) {
    if (track.sky[i] < 1 || track._onBridge(i * ds)) continue;
    // Every sample of another stretch that a probe from here could come nearer to than to this one.
    const reach = 2 * (Math.max(track.edgeL[i], track.edgeR[i]) + FAR_REACH);
    const cells = Math.ceil(reach / CELL);
    const cx = Math.floor((px[i] - track._gx0) / CELL);
    const cz = Math.floor((pz[i] - track._gz0) / CELL);
    let found = 0;
    for (let gz = Math.max(0, cz - cells); gz <= Math.min(track._gh - 1, cz + cells); gz++) {
      for (let gx = Math.max(0, cx - cells); gx <= Math.min(track._gw - 1, cx + cells); gx++) {
        const c = gx + track._gw * gz;
        for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
          const j = cellItems[k];
          const apart = Math.abs(j - i);
          if (Math.min(apart, n - apart) < own) continue;
          if ((px[j] - px[i]) ** 2 + (pz[j] - pz[i]) ** 2 < reach * reach) others[found++] = j;
        }
      }
    }
    if (found === 0) continue;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const edge = edges[side][i];
      const dx = track._fz[i] * sign;
      const dz = -track._fx[i] * sign;
      for (let d = edge + FAR_STEP; d < edge + FAR_REACH; d += FAR_STEP) {
        const qx = px[i] + dx * d;
        const qz = pz[i] + dz * d;
        let j = -1;
        let best = d * d;
        for (let k = 0; k < found; k++) {
          const dist = (px[others[k]] - qx) ** 2 + (pz[others[k]] - qz) ** 2;
          if (dist < best) {
            best = dist;
            j = others[k];
          }
        }
        if (j < 0) continue;
        // Under the viaduct and over the tunnel the ground is not at the road's height: leave the preset.
        if (track.sky[j] < 1 || track._onBridge(j * ds)) break;
        const facing = (qx - px[j]) * track._fz[j] - (qz - pz[j]) * track._fx[j] >= 0 ? 1 : -1;
        const edgeJ = facing > 0 ? track.edgeL[j] : track.edgeR[j];
        const run = Math.max(1, d - edge + (Math.sqrt(best) - edgeJ));
        const slopeJ = facing > 0 ? track.slopeL[j] : track.slopeR[j];
        const slopeI = side === 0 ? track.slopeL[i] : track.slopeR[i];
        const there = track.py[j] + crossSection(facing * edgeJ, track._pave, edgeJ, track.ly[j], slopeJ, 0);
        const here = track.py[i] + crossSection(sign * edge, track._pave, edge, track.ly[i], slopeI, 0);
        far[side][i] = clamp((there - here) / run, -FAR_LIMIT, FAR_LIMIT);
        break;
      }
    }
  }
  roundOff(far[0], Math.round(BLEND / ds));
  roundOff(far[1], Math.round(BLEND / ds));
  for (let i = 0; i < n; i++) {
    track.farSlopeL[i] = far[0][i];
    track.farSlopeR[i] = far[1][i];
  }
}

/** Street lamps along the straight, lamp rows in the tunnel, and the sector lines. */
function placeFurniture(track, plan) {
  const { layout } = track;
  const street = layout.streetLamps;
  const from = plan.at(street.pieces[0], 0);
  let run = 0;
  for (const id of street.pieces) run += plan.at(id, 1) - plan.at(id, 0);
  const posts = Math.max(1, Math.round(run / street.spacing));
  for (let k = 0; k < posts; k++) {
    const s = track.wrap(from + ((k + 0.5) * run) / posts);
    const side = k % 2 === 0 ? 1 : -1;
    track.lamps.push({ s, side, lat: side * track.edgeAt(s, side), height: street.height, kind: 'street' });
  }
  const hung = layout.tunnelLamps;
  for (const t of track.tunnels) {
    const rows = Math.max(1, Math.round((t.s1 - t.s0) / hung.spacing));
    for (let k = 0; k < rows; k++) {
      const s = t.s0 + ((k + 0.5) * (t.s1 - t.s0)) / rows;
      for (const side of [1, -1]) {
        const lat = side * (track.halfWidth + TUNNEL.wallOffset - hung.inset);
        track.lamps.push({ s, side, lat, height: TUNNEL.height - hung.drop, kind: 'tunnel' });
      }
    }
  }
  track.sectors = layout.sectors.map(([id, u]) => plan.at(id, u));
}

/**
 * @typedef {object} Frame
 * @property {Vector3} pos @property {Vector3} tan @property {Vector3} left @property {Vector3} up
 * @property {number} bank @property {number} curvature @property {number} grade
 */

export class Track {
  /** @param {typeof LAYOUT} layout */
  constructor(layout = LAYOUT) {
    const plan = planOf(layout);
    const n = Math.round(plan.length / SAMPLE_SPACING);

    this.layout = layout;
    /** Lap length on the map (m). */
    this.length = plan.length;
    /** Paved half width (m), and the width of the gravel strip beyond it. */
    this.halfWidth = layout.halfWidth;
    this.shoulder = layout.shoulder;
    /** Number of samples and their spacing (m): sample i is at s = i * ds. */
    this.count = n;
    this.ds = plan.length / n;
    /** The named stretches (SECTIONS, for the layout this was built from). */
    this.sections = sectionsOf(layout.segments);
    /** How well the baked layout closes: what had to be spread along the lap to make it exact. */
    this.closure = { gap: 0, yawGap: 0, gradeScale: 1 };

    // Per sample. Position; unit tangent; unit left, tilted by the banking; surface normal.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.lx = new Float32Array(n);
    this.ly = new Float32Array(n);
    this.lz = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.nz = new Float32Array(n);
    /** Banking (rad, + = left edge higher), curvature (1/m, + = bends left), grade (rise per metre of s). */
    this.bank = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.grade = new Float32Array(n);
    /** Distance from the centre line to the solid edge on each side (m of lat, always beyond the shoulder). */
    this.edgeL = new Float32Array(n);
    this.edgeR = new Float32Array(n);
    /** What the solid edge is (EDGE), and what the verge in front of it is made of (SURFACE). */
    this.kindL = new Uint8Array(n);
    this.kindR = new Uint8Array(n);
    this.vergeL = new Uint8Array(n);
    this.vergeR = new Uint8Array(n);
    /** Rise per metre, going outwards, of the verge and of the hillside beyond the solid edge. */
    this.slopeL = new Float32Array(n);
    this.slopeR = new Float32Array(n);
    this.farSlopeL = new Float32Array(n);
    this.farSlopeR = new Float32Array(n);
    /** How much sky is overhead: 1 in the open, 0 in the tunnel, easing over about 25 m at the portals. */
    this.sky = new Float32Array(n);
    // Heading on the map (unit, level): what the cubics between samples are built from.
    this._fx = new Float32Array(n);
    this._fz = new Float32Array(n);
    this._pave = layout.halfWidth + layout.shoulder;

    /** @type {Array<{ s0: number, s1: number }>} the bore, portal to portal (its ceiling is TUNNEL.height above the road) */
    this.tunnels = [];
    /** @type {Array<{ s0: number, s1: number, drop: number }>} the deck, abutment to abutment; `drop`: the ravine under its middle */
    this.bridges = [];
    /** @type {Array<{ s: number, side: number, lat: number, height: number, kind: 'street' | 'tunnel' }>} side +1 left, -1 right */
    this.lamps = [];
    /** Sector lines (m from the start/finish line); the third line is the start/finish line itself. */
    this.sectors = [];
    /** The centre line's bounding box on the map. */
    this.bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    /** Distance of [piece id, fraction along it] from the start/finish line: `track.at('viaduct', 0.5)`. */
    this.at = plan.at;

    this._spot = makeSpot();
    this._spot2 = makeSpot();
    this._prof = { y: 0, surface: 0 };

    layCentreLine(this, plan);
    layHeight(this, plan);
    layFrames(this);
    layStructures(this, plan);
    const far = layCorridor(this, plan);
    buildGrid(this);
    shapeHillside(this, far);
    placeFurniture(this, plan);
  }

  /** s brought into 0 <= s < length. */
  wrap(s) {
    const r = s % this.length;
    return r < 0 ? r + this.length : r;
  }

  /** The shortest signed distance along the lap from `from` to `to` (+ = ahead). */
  delta(from, to) {
    const d = this.wrap(to - from);
    return d > this.length / 2 ? d - this.length : d;
  }

  /** The named stretch that holds s (one of SECTIONS). */
  sectionAt(s) {
    const w = this.wrap(s);
    for (const sec of this.sections) {
      if (sec.s0 <= sec.s1 ? w >= sec.s0 && w < sec.s1 : w >= sec.s0 || w < sec.s1) return sec;
    }
    return this.sections[0];
  }

  _onBridge(s) {
    for (const b of this.bridges) if (s >= b.s0 && s <= b.s1) return true;
    return false;
  }

  /** Distance from the centre line to the solid edge on one side (+1 left, -1 right) at s. */
  edgeAt(s, side) {
    const f = this.wrap(s) / this.ds;
    const a = Math.floor(f) % this.count;
    const b = (a + 1) % this.count;
    const u = f - Math.floor(f);
    const edge = side > 0 ? this.edgeL : this.edgeR;
    return edge[a] + (edge[b] - edge[a]) * u;
  }

  /**
   * A per-sample array read between samples: a Catmull-Rom cubic through the samples, so the value AND its slope
   * are continuous along the road (a wheel on a banked bend at speed must not feel the samples go by). Returns
   * the value at fraction u after sample `seg`; its rate of change per metre of s is left in READ.d.
   */
  _read(values, seg, u) {
    const n = this.count;
    const b = seg + 1 === n ? 0 : seg + 1;
    const p0 = values[seg === 0 ? n - 1 : seg - 1];
    const p1 = values[seg];
    const p2 = values[b];
    const p3 = values[b + 1 === n ? 0 : b + 1];
    const m1 = (p2 - p0) / 2;
    const m2 = (p3 - p1) / 2;
    const d = p2 - p1;
    const c2 = 3 * d - 2 * m1 - m2;
    const c3 = m1 + m2 - 2 * d;
    READ.d = (m1 + u * (2 * c2 + 3 * c3 * u)) / this.ds;
    return p1 + u * (m1 + u * (c2 + c3 * u));
  }

  /** The sample nearest to (x, z) on the map, from the grid: the cells around the point, then wider rings. */
  _nearestSample(x, z) {
    const gw = this._gw;
    const gh = this._gh;
    const cx = clamp(Math.floor((x - this._gx0) / CELL), 0, gw - 1);
    const cz = clamp(Math.floor((z - this._gz0) / CELL), 0, gh - 1);
    const px = this.px;
    const pz = this.pz;
    const start = this._cellStart;
    const items = this._cellItems;
    let best = -1;
    let bestD = Infinity;
    const reach = Math.max(gw, gh);
    for (let ring = 0; ring <= reach; ring++) {
      // Once something is found, one more ring settles it: nothing further out can be nearer.
      if (best >= 0 && bestD <= ((ring - 1) * CELL) ** 2) break;
      const z0 = cz - ring;
      const z1 = cz + ring;
      const x0 = cx - ring;
      const x1 = cx + ring;
      for (let gz = Math.max(0, z0); gz <= Math.min(gh - 1, z1); gz++) {
        const rim = gz === z0 || gz === z1;
        const stepX = rim ? 1 : Math.max(1, x1 - x0);
        for (let gx = x0; gx <= x1; gx += stepX) {
          if (gx < 0 || gx >= gw) continue;
          const c = gx + gw * gz;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const i = items[k];
            const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
    }
    return best;
  }

  /** Walks from sample `i` along the line while the next sample is nearer to (x, z); -1 if it has to go too far. */
  _walk(x, z, i) {
    const n = this.count;
    const px = this.px;
    const pz = this.pz;
    let best = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
    for (let steps = 0; steps < WALK_MAX; steps++) {
      const a = i + 1 === n ? 0 : i + 1;
      const b = i === 0 ? n - 1 : i - 1;
      const da = (px[a] - x) ** 2 + (pz[a] - z) ** 2;
      const db = (px[b] - x) ** 2 + (pz[b] - z) ** 2;
      if (da < best && da <= db) {
        i = a;
        best = da;
      } else if (db < best) {
        i = b;
        best = db;
      } else {
        return i;
      }
    }
    return -1;
  }

  /** The cubic between sample `seg` and the next, at fraction u: position and heading on the map, into `o`. */
  _curve(seg, u, o) {
    const b = seg + 1 === this.count ? 0 : seg + 1;
    const ds = this.ds;
    const u2 = u * u;
    const u3 = u2 * u;
    const h01 = 3 * u2 - 2 * u3;
    const h00 = 1 - h01;
    const h10 = (u3 - 2 * u2 + u) * ds;
    const h11 = (u3 - u2) * ds;
    o.x = h00 * this.px[seg] + h10 * this._fx[seg] + h01 * this.px[b] + h11 * this._fx[b];
    o.z = h00 * this.pz[seg] + h10 * this._fz[seg] + h01 * this.pz[b] + h11 * this._fz[b];
    const d01 = (6 * u - 6 * u2) / ds;
    const d10 = 3 * u2 - 4 * u + 1;
    const d11 = 3 * u2 - 2 * u;
    const dx = d01 * (this.px[b] - this.px[seg]) + d10 * this._fx[seg] + d11 * this._fx[b];
    const dz = d01 * (this.pz[b] - this.pz[seg]) + d10 * this._fz[seg] + d11 * this._fz[b];
    const inv = 1 / Math.hypot(dx, dz);
    o.fx = dx * inv;
    o.fz = dz * inv;
  }

  /** The foot of the perpendicular from (x, z) to the centre line near sample i (Newton on the cubics), into `o`. */
  _foot(x, z, i, o) {
    const n = this.count;
    const ds = this.ds;
    let seg = i;
    let u = 0;
    for (let it = 0; it < 6; it++) {
      this._curve(seg, u, o);
      const rx = x - o.x;
      const rz = z - o.z;
      const along = rx * o.fx + rz * o.fz;
      if (Math.abs(along) < 1e-5) break;
      const b = seg + 1 === n ? 0 : seg + 1;
      const k = this.curvature[seg] + (this.curvature[b] - this.curvature[seg]) * u;
      // A point at offset q moves (1 - k q) metres for every metre of the centre line.
      const q = rx * o.fz - rz * o.fx;
      u += clamp(along / Math.max(0.2, 1 - k * q), -2, 2) / ds;
      while (u >= 1) {
        u -= 1;
        seg = seg + 1 === n ? 0 : seg + 1;
      }
      while (u < 0) {
        u += 1;
        seg = seg === 0 ? n - 1 : seg - 1;
      }
    }
    this._curve(seg, u, o);
    o.seg = seg;
    o.u = u;
    o.q = (x - o.x) * o.fz - (z - o.z) * o.fx;
    o.sinb = this._read(this.ly, seg, u);
    o.dsinb = READ.d;
    o.cosb = Math.sqrt(1 - o.sinb * o.sinb);
    o.lat = o.q / o.cosb;
    return o;
  }

  /** locate() into a scratch spot. */
  _locate(x, z, hint) {
    const n = this.count;
    let spot = this._spot;
    if (hint >= 0 && hint < n) {
      const i = this._walk(x, z, hint);
      if (i >= 0) {
        this._foot(x, z, i, spot);
        // Inside the corridor the walk cannot have gone wrong. Outside it (thrown over a rail, put back on the
        // road somewhere else) the nearest stretch may be another one: look everywhere and keep the nearer.
        const edge = spot.lat > 0 ? this.edgeL[spot.seg] : this.edgeR[spot.seg];
        if (Math.abs(spot.lat) <= edge + OFF_ROAD) return spot;
        const other = this._foot(x, z, this._nearestSample(x, z), this._spot2);
        if (Math.abs(other.q) < Math.abs(spot.q) - 1e-6) {
          this._spot2 = spot;
          this._spot = other;
          spot = other;
        }
        return spot;
      }
    }
    return this._foot(x, z, this._nearestSample(x, z), spot);
  }

  /**
   * Nearest point of the centre line to (x, z) on the map.
   * @param {number} x @param {number} z
   * @param {number} hint the `index` the last call for this object returned, or -1 to search the whole lap
   * @param {{ index?: number, s?: number, lat?: number }} [out]
   * @returns {{ index: number, s: number, lat: number }} `lat` + = left of the direction of travel
   */
  locate(x, z, hint = -1, out = {}) {
    const spot = this._locate(x, z, hint);
    out.index = spot.seg;
    out.s = (spot.seg + spot.u) * this.ds;
    out.lat = spot.lat;
    return /** @type {any} */ (out);
  }

  /** Height of the centre line and its gradient in the cubic after sample `seg`, at fraction u. */
  _heightAt(seg, u, o) {
    const b = seg + 1 === this.count ? 0 : seg + 1;
    const ds = this.ds;
    const u2 = u * u;
    const u3 = u2 * u;
    const h01 = 3 * u2 - 2 * u3;
    const ya = this.py[seg];
    const yb = this.py[b];
    const ga = this.grade[seg];
    const gb = this.grade[b];
    o.y = ya + h01 * (yb - ya) + (u3 - 2 * u2 + u) * ds * ga + (u3 - u2) * ds * gb;
    o.grade = ((6 * u - 6 * u2) * (yb - ya)) / ds + (3 * u2 - 4 * u + 1) * ga + (3 * u2 - 2 * u) * gb;
  }

  /**
   * The centre line at distance s.
   * @param {number} s
   * @param {Partial<Frame>} [out] reused if given (its vectors are made on first use)
   * @returns {Frame} position, unit tangent, unit left (tilted by the banking), surface normal, bank (rad, + = left
   *   edge higher), curvature (1/m, + = bends left), grade (rise per metre of s)
   */
  frameAt(s, out = {}) {
    const f = this.wrap(s) / this.ds;
    const seg = Math.floor(f) % this.count;
    const u = f - Math.floor(f);
    const b = seg + 1 === this.count ? 0 : seg + 1;
    const spot = this._spot2;
    this._curve(seg, u, spot);
    this._heightAt(seg, u, HEIGHT);
    const g = HEIGHT.grade;
    const cp = 1 / Math.hypot(1, g);
    const sp = g * cp;
    const sb = this._read(this.ly, seg, u);
    const cb = Math.sqrt(1 - sb * sb);
    const tx = spot.fx * cp;
    const tz = spot.fz * cp;
    const lx = spot.fz * cb;
    const lz = -spot.fx * cb;
    out.pos = (out.pos ?? new Vector3()).set(spot.x, HEIGHT.y, spot.z);
    out.tan = (out.tan ?? new Vector3()).set(tx, sp, tz);
    out.left = (out.left ?? new Vector3()).set(lx, sb, lz);
    out.up = (out.up ?? new Vector3()).set(sp * lz - tz * sb, tz * lx - tx * lz, tx * sb - sp * lx).normalize();
    out.bank = Math.asin(sb);
    out.curvature = this.curvature[seg] + (this.curvature[b] - this.curvature[seg]) * u;
    out.grade = g;
    return /** @type {Frame} */ (out);
  }

  /** What is underfoot at `lat`, given the distances and verges at the nearer sample. */
  _surfaceKind(i, lat, edge) {
    const a = Math.abs(lat);
    if (a <= this.halfWidth) return SURFACE.ASPHALT;
    const verge = lat > 0 ? this.vergeL[i] : this.vergeR[i];
    // Beyond the solid edge it is the hillside: scree where the verge was gravel, grass elsewhere.
    if (a > edge) return verge === SURFACE.GRAVEL ? SURFACE.GRAVEL : SURFACE.GRASS;
    // In the tunnel and on the viaduct the road is paved right up to the wall.
    if (verge === SURFACE.ASPHALT) return SURFACE.ASPHALT;
    return a <= this._pave ? SURFACE.SHOULDER : verge;
  }

  /**
   * Height and surface of the corridor's cross-section at track coordinates. Out to the solid edge this is what
   * the wheels stand on; beyond it, it carries on up or down the hillside at the far slope, for the terrain.
   * (Under the viaduct and over the tunnel the real ground is somewhere else: see `bridges` and `tunnels`.)
   * @param {number} s @param {number} lat
   * @param {{ y?: number, surface?: number }} [out]
   * @returns {{ y: number, surface: number }}
   */
  profile(s, lat, out = {}) {
    const f = this.wrap(s) / this.ds;
    const seg = Math.floor(f) % this.count;
    const u = f - Math.floor(f);
    const b = seg + 1 === this.count ? 0 : seg + 1;
    const left = lat > 0;
    const a = Math.abs(lat);
    this._heightAt(seg, u, HEIGHT);
    const edges = left ? this.edgeL : this.edgeR;
    const edge = edges[seg] + (edges[b] - edges[seg]) * u;
    const sinb = this._read(this.ly, seg, u);
    const slope = a > this._pave ? this._read(left ? this.slopeL : this.slopeR, seg, u) : 0;
    const far = a > edge ? this._read(left ? this.farSlopeL : this.farSlopeR, seg, u) : 0;
    out.y = HEIGHT.y + crossSection(lat, this._pave, edge, sinb, slope, far);
    out.surface = this._surfaceKind(u < 0.5 ? seg : b, lat, edge);
    return /** @type {any} */ (out);
  }

  /**
   * The drivable surface under (x, z): the pavement, the shoulder or the verge. The solid edge is where it ends:
   * a wheel that gets past it (deep in a wall for one step at 250 km/h) is still told the height at the edge,
   * level across, never the hillside beyond, so nothing there can throw a car. `lat` in the answer is not clamped.
   * @param {number} x @param {number} z
   * @param {number} hint the `index` the last call for this wheel returned, or -1
   * @param {object} [out]
   * @returns {{ y: number, nx: number, ny: number, nz: number, surface: number, grip: number, s: number, lat: number,
   *   index: number, edgeL: number, edgeR: number, sky: number }}
   */
  surfaceAt(x, z, hint = -1, out = {}) {
    const spot = this._locate(x, z, hint);
    const seg = spot.seg;
    const u = spot.u;
    const b = seg + 1 === this.count ? 0 : seg + 1;
    this._heightAt(seg, u, HEIGHT);
    const edgeL = this.edgeL[seg] + (this.edgeL[b] - this.edgeL[seg]) * u;
    const edgeR = this.edgeR[seg] + (this.edgeR[b] - this.edgeR[seg]) * u;
    const left = spot.lat > 0;
    const edge = left ? edgeL : edgeR;
    const beyond = Math.abs(spot.lat) > edge;
    const lat = beyond ? (left ? edge : -edge) : spot.lat;
    const pave = this._pave;
    let slope = 0;
    let dslope = 0;
    if (Math.abs(lat) > pave) {
      slope = this._read(left ? this.slopeL : this.slopeR, seg, u);
      dslope = READ.d;
    }
    const surface = this._surfaceKind(u < 0.5 ? seg : b, lat, edge);
    // The slope of the ground on the map: along the road (stretched or squeezed by the bend at this offset)
    // and across it.
    const k = this.curvature[seg] + (this.curvature[b] - this.curvature[seg]) * u;
    const along = (HEIGHT.grade + crossSection(lat, pave, edge, spot.dsinb, dslope, 0)) / Math.max(0.2, 1 - k * lat * spot.cosb);
    const across = beyond ? 0 : crossSlope(lat, pave, edge, spot.sinb, slope, 0) / spot.cosb;
    const nx = -along * spot.fx - across * spot.fz;
    const nz = -along * spot.fz + across * spot.fx;
    const inv = 1 / Math.hypot(nx, 1, nz);
    out.y = HEIGHT.y + crossSection(lat, pave, edge, spot.sinb, slope, 0);
    out.nx = nx * inv;
    out.ny = inv;
    out.nz = nz * inv;
    out.surface = surface;
    out.grip = GRIP[surface];
    out.s = (seg + u) * this.ds;
    out.lat = spot.lat;
    out.index = seg;
    out.edgeL = edgeL;
    out.edgeR = edgeR;
    out.sky = this.sky[seg] + (this.sky[b] - this.sky[seg]) * u;
    return /** @type {any} */ (out);
  }

  /**
   * The point of the corridor at track coordinates (s, lat), on the surface.
   * @param {number} s @param {number} lat @param {Vector3} [out]
   */
  pointAt(s, lat, out = new Vector3()) {
    const f = this.wrap(s) / this.ds;
    const seg = Math.floor(f) % this.count;
    const u = f - Math.floor(f);
    const spot = this._spot2;
    this._curve(seg, u, spot);
    const sb = this._read(this.ly, seg, u);
    const q = lat * Math.sqrt(1 - sb * sb);
    return out.set(spot.x + spot.fz * q, this.profile(s, lat, this._prof).y, spot.z - spot.fx * q);
  }

  /**
   * Start position for grid slot 0..3: two abreast and staggered behind the line, slot 0 nearest it on the left.
   * @param {number} slot
   * @param {{ x?: number, y?: number, z?: number, yaw?: number }} [out]
   * @returns {{ x: number, y: number, z: number, yaw: number }} on the surface; yaw as in the contract (forward = sin, cos)
   */
  grid(slot, out = {}) {
    const s = -(GRID.first + GRID.pitch * slot);
    const lat = slot % 2 === 0 ? GRID.lat : -GRID.lat;
    const p = this.pointAt(s, lat, SCRATCH);
    const f = this.wrap(s) / this.ds;
    this._curve(Math.floor(f) % this.count, f - Math.floor(f), this._spot2);
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.yaw = Math.atan2(this._spot2.fx, this._spot2.fz);
    return /** @type {any} */ (out);
  }

  /**
   * The centre line for a mini-map: world x, z pairs times `scale`, one every `step` samples. Seen from above
   * with north (+Z) up the page, +X runs to the LEFT: draw at (-x, -z) for a true map.
   * @param {number} [scale] @param {number} [step]
   * @returns {Float32Array}
   */
  toTopDown(scale = 1, step = 4) {
    const m = Math.ceil(this.count / step);
    const out = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      out[k * 2] = this.px[k * step] * scale;
      out[k * 2 + 1] = this.pz[k * step] * scale;
    }
    return out;
  }
}

/** The grid: metres behind the line of the first slot, metres between rows, metres either side of the centre line. */
const GRID = { first: 6, pitch: 8, lat: 1.9 };
const HEIGHT = { y: 0, grade: 0 };
const READ = { d: 0 };
const SCRATCH = new Vector3();

/**
 * @param {typeof LAYOUT} [layout]
 * @returns {Track}
 */
export function createTrack(layout = LAYOUT) {
  return new Track(layout);
}

/**
 * The fastest a car could possibly be going at each sample: a generous envelope (more grip, power and brakes than
 * the car has), for judging crests and for anything that wants to know where the road is fast.
 * @param {Track} track
 * @param {{ top?: number, lateral?: number, accel?: number, brake?: number }} [limits] m/s and m/s^2
 * @returns {Float32Array} m/s per sample
 */
export function speedEnvelope(track, { top = 70, lateral = 1.3 * G, accel = 6, brake = 13 } = {}) {
  const n = track.count;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(top, Math.sqrt(lateral / Math.max(1e-6, Math.abs(track.curvature[i]))));
  for (let i = 1; i < 2 * n; i++) {
    v[i % n] = Math.min(v[i % n], Math.sqrt(v[(i - 1) % n] ** 2 + 2 * accel * track.ds));
  }
  for (let i = 2 * n - 2; i >= 0; i--) {
    v[i % n] = Math.min(v[i % n], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * brake * track.ds));
  }
  return v;
}
