// Stand-in roads for testing the car on its own: an endless plane, and closed loops of arcs and straights.
//
// They answer the same questions as game/track.js (surfaceAt, locate, frameAt, the per-sample arrays the vehicle and
// the autopilot read), so a manoeuvre measured here is measured with the code that runs in the game, but on ground
// whose shape is known exactly: level, or tilted by a known angle, with or without solid edges.
//
// SURFACE and EDGE repeat the numbering of game/track.js (the vehicle's tables in vehicle/params.js are indexed by
// it); tools/unit/vehicle.test.mjs checks that the two agree when the real track is there.

export const SURFACE = { ASPHALT: 0, SHOULDER: 1, GRASS: 2, GRAVEL: 3, KERB: 4 };
export const EDGE = { RAIL: 0, ROCK: 1, WALL: 2, PARAPET: 3, TREES: 4 };

/**
 * An endless plane, travelled along +Z (so `s` is z and `lat` is x, positive to the left).
 * @param {object} [o]
 * @param {number} [o.grip] of the whole plane
 * @param {number} [o.surface]
 * @param {number} [o.grade] rise per metre along +Z
 * @param {number} [o.bank] rise per metre along +X (to the left)
 * @param {number} [o.edge] half-width of a corridor with solid edges (default: none)
 * @param {number} [o.kind] what the edges are (EDGE)
 * @param {(x:number, z:number, out:object) => void} [o.paint] may overwrite out.surface and out.grip for a point
 */
export function createPlane({ grip = 1, surface = SURFACE.ASPHALT, grade = 0, bank = 0, edge = Infinity, kind = EDGE.WALL, paint = null } = {}) {
  const n = Math.hypot(bank, 1, grade);
  return {
    length: Infinity,
    halfWidth: 4.25,
    count: 1,
    ds: 1,
    px: [0], py: [0], pz: [0],
    tx: [0], ty: [0], tz: [1],
    lx: [1], ly: [0], lz: [0],
    curvature: [0], grade: [grade], bank: [Math.atan(bank)],
    edgeL: [edge], edgeR: [edge], kindL: [kind], kindR: [kind],
    sky: [1],
    locate(x, z, hint, out) {
      out.index = 0;
      out.s = z;
      out.lat = x;
      return out;
    },
    surfaceAt(x, z, hint, out) {
      out.y = grade * z + bank * x;
      out.nx = -bank / n;
      out.ny = 1 / n;
      out.nz = -grade / n;
      out.surface = surface;
      out.grip = grip;
      out.s = z;
      out.lat = x;
      out.index = 0;
      out.edgeL = edge;
      out.edgeR = edge;
      out.sky = 1;
      if (paint) paint(x, z, out);
      return out;
    },
    grid(slot, out) {
      out.x = slot % 2 ? -1.8 : 1.8;
      out.y = 0;
      out.z = -8 * slot;
      out.yaw = 0;
      return out;
    },
  };
}

/**
 * A closed loop made of pieces of constant curvature, on level ground or banked by one angle all the way round.
 * The pieces must close on themselves (a circle and an oval do; see createCircle and createOval).
 * @param {object} o
 * @param {Array<{length:number, curvature:number}>} o.segments curvature in 1/m, + = bends left
 * @param {number} [o.halfWidth] paved half width
 * @param {number} [o.edge] distance from the centre line to the solid edge on each side
 * @param {number} [o.bank] rad, + = left edge higher
 * @param {number} [o.vergeGrip] grip beyond the pavement
 * @param {number} [o.kind] what the edges are (EDGE)
 */
export function createLoop({ segments, halfWidth = 4.25, edge = 7.5, bank = 0, vergeGrip = 0.6, kind = EDGE.RAIL }) {
  const length = segments.reduce((sum, seg) => sum + seg.length, 0);
  const count = Math.round(length);
  const ds = length / count;
  const arrays = {};
  for (const name of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'lx', 'ly', 'lz', 'nx', 'ny', 'nz', 'bank', 'curvature', 'grade', 'edgeL', 'edgeR',
    'slopeL', 'slopeR', 'sky']) arrays[name] = new Float32Array(count);
  const kindL = new Uint8Array(count).fill(kind);
  const kindR = new Uint8Array(count).fill(kind);
  const slope = Math.tan(bank);
  const norm = Math.hypot(slope, 1);
  let x = 0, z = 0, yaw = 0, piece = 0, remaining = segments[0].length;
  for (let i = 0; i < count; i++) {
    const k = segments[piece].curvature;
    arrays.px[i] = x;
    arrays.pz[i] = z;
    arrays.tx[i] = Math.sin(yaw);
    arrays.tz[i] = Math.cos(yaw);
    arrays.lx[i] = Math.cos(yaw) / norm;
    arrays.ly[i] = slope / norm;
    arrays.lz[i] = -Math.sin(yaw) / norm;
    arrays.nx[i] = (-slope * Math.cos(yaw)) / norm;
    arrays.ny[i] = 1 / norm;
    arrays.nz[i] = (slope * Math.sin(yaw)) / norm;
    arrays.bank[i] = bank;
    arrays.curvature[i] = k;
    arrays.edgeL[i] = edge;
    arrays.edgeR[i] = edge;
    arrays.sky[i] = 1;
    // one sample on, exactly along the arcs (a step may run from one piece into the next)
    let togo = ds;
    while (togo > 1e-12) {
      const kk = segments[piece].curvature;
      const d = Math.min(togo, remaining);
      const mid = yaw + (kk * d) / 2;
      const chord = Math.abs(kk) > 1e-9 ? (2 * Math.sin((kk * d) / 2)) / kk : d;
      x += Math.sin(mid) * chord;
      z += Math.cos(mid) * chord;
      yaw += kk * d;
      togo -= d;
      remaining -= d;
      if (remaining <= 1e-12) {
        piece = (piece + 1) % segments.length;
        remaining = segments[piece].length;
      }
    }
  }
  const gap = Math.hypot(x, z);
  if (gap > 0.01) throw new Error(`createLoop: the pieces do not close (the end is ${gap.toFixed(2)} m from the start)`);

  const nearest = (px, pz, hint) => {
    let best = hint;
    if (!(hint >= 0 && hint < count)) {
      let least = Infinity;
      for (let i = 0; i < count; i++) {
        const d = (arrays.px[i] - px) ** 2 + (arrays.pz[i] - pz) ** 2;
        if (d < least) {
          least = d;
          best = i;
        }
      }
      return best;
    }
    // walk downhill from the hint
    let least = (arrays.px[best] - px) ** 2 + (arrays.pz[best] - pz) ** 2;
    for (let guard = 0; guard < count; guard++) {
      const a = (best + 1) % count, b = (best + count - 1) % count;
      const da = (arrays.px[a] - px) ** 2 + (arrays.pz[a] - pz) ** 2;
      const db = (arrays.px[b] - px) ** 2 + (arrays.pz[b] - pz) ** 2;
      if (da < least && da <= db) {
        least = da;
        best = a;
      } else if (db < least) {
        least = db;
        best = b;
      } else break;
    }
    return best;
  };

  const track = {
    length,
    halfWidth,
    count,
    ds,
    ...arrays,
    kindL,
    kindR,
    tunnels: [],
    bridges: [],
    lamps: [],
    sectors: [length / 3, (2 * length) / 3],
    locate(px, pz, hint, out) {
      const i = nearest(px, pz, hint);
      const dx = px - arrays.px[i], dz = pz - arrays.pz[i];
      const along = dx * arrays.tx[i] + dz * arrays.tz[i];
      out.index = i;
      out.s = (((i * ds + along) % length) + length) % length;
      out.lat = (dx * arrays.tz[i] - dz * arrays.tx[i]) * norm; // measured along the tilted surface
      return out;
    },
    surfaceAt(px, pz, hint, out) {
      track.locate(px, pz, hint, out);
      const i = out.index;
      const level = (out.lat / norm) * slope;
      out.y = level;
      out.nx = arrays.nx[i];
      out.ny = arrays.ny[i];
      out.nz = arrays.nz[i];
      const paved = Math.abs(out.lat) <= halfWidth;
      out.surface = paved ? SURFACE.ASPHALT : SURFACE.GRASS;
      out.grip = paved ? 1 : vergeGrip;
      out.edgeL = edge;
      out.edgeR = edge;
      out.sky = 1;
      return out;
    },
    frameAt(s, out) {
      const f = ((((s % length) + length) % length) / ds) % count;
      const i = Math.floor(f) % count;
      const t = f - Math.floor(f);
      const j = (i + 1) % count;
      const mix = (a) => a[i] + (a[j] - a[i]) * t;
      out.pos.set(mix(arrays.px), 0, mix(arrays.pz));
      out.tan.set(mix(arrays.tx), 0, mix(arrays.tz)).normalize();
      out.left.set(mix(arrays.lx), mix(arrays.ly), mix(arrays.lz)).normalize();
      out.up.set(mix(arrays.nx), mix(arrays.ny), mix(arrays.nz)).normalize();
      out.bank = bank;
      out.curvature = arrays.curvature[i];
      out.grade = 0;
      return out;
    },
    profile(s, lat, out) {
      out.y = (lat / norm) * slope;
      out.surface = Math.abs(lat) <= halfWidth ? SURFACE.ASPHALT : SURFACE.GRASS;
      return out;
    },
    grid(slot, out) {
      const i = (count - 6 - 8 * Math.floor(slot / 2)) % count;
      const side = slot % 2 ? -1.8 : 1.8;
      out.x = arrays.px[i] + arrays.lx[i] * side * norm;
      out.y = 0;
      out.z = arrays.pz[i] + arrays.lz[i] * side * norm;
      out.yaw = Math.atan2(arrays.tx[i], arrays.tz[i]);
      return out;
    },
  };
  return track;
}

/** A circle of the given radius, driven anticlockwise seen from above (bending left). */
export function createCircle(radius, options = {}) {
  return createLoop({ segments: [{ length: 2 * Math.PI * radius, curvature: 1 / radius }], ...options });
}

/** Two straights joined by two half circles, bending left. */
export function createOval(straight, radius, options = {}) {
  const arc = { length: Math.PI * radius, curvature: 1 / radius };
  const line = { length: straight, curvature: 0 };
  return createLoop({ segments: [line, arc, line, arc], ...options });
}
