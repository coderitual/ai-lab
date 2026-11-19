// One corner of the car: the tyre, the 19-inch five-twin-spoke wheel (black
// with machined faces), and the brake behind it.
//
// The wheel's face is drawn once, as a plan: the outlines of the bright faces
// in the plane of the wheel, measured on a photograph of the car that was
// rectified through a fitted camera (see WHEEL below). Everything is made from
// that plan: the meshes (faces draped on the wheel's dish, bevels, black
// flanks, pocket floors), and a polar picture of the same plan that stands in
// for the spokes once they turn too fast to be seen singly.
//
// How a turning wheel is shown. A camera that keeps its shutter open for a
// sixtieth of a second sees each spoke smeared over the angle it turned
// through. So: at rest the real spokes are drawn. As the wheel picks up speed
// a stack of three thin shells fades in over them and the real spokes fade
// out beneath it. The shells carry the plan as coverage (how much of each
// circle is bright, black or open) and average it over exactly that angle, per
// pixel, which is two texture reads (wheelTextures.js). At 75 rad/s the smear
// spans a whole pair-to-pair step and the wheel is an even, glinting disc
// through which the brake shows; nothing is left to strobe against the frame
// rate. The tyre does the same with its tread: its normal map blends into its
// own average round the tyre.
//
// Draw calls per wheel: the tyre, everything that does not turn or looks the
// same when it does (barrel, disc, caliper, dust shield: one mesh), the spokes
// (one mesh, a palette texture picks each vertex's finish), the shells.

import * as THREE from 'three';
import { targetDefines } from '../../engine/glsl.js';
import { PAPER, copyProxy, mirrorProbe, probeUniforms } from './materials.js';
import { TYRES } from './spec.js';
import { TYRE_MARK as MARK, TYRE_REPEAT, TYRE_TREAD_V, FINISH, createCoverTexture, createPalette, createTyreMarkTexture, createTyreTextures, paletteU } from './wheelTextures.js';

/**
 * The wheel, as numbers (metres). [D] published, [M] measured on car-rear34-closeup.jpg (the rim's outer edge is
 * the ruler: a circle of radius 0.243 fixes the camera, then widths are read in the wheel's plane and depths from
 * parallax, +/- 1.5 mm and +/- 3 mm), [E] estimated.
 */
/**
 * The plan below was measured as an 18-inch wheel (its rim's edge, 0.2432, the ruler). The car's wheels are 19-inch
 * (spec.js, from the daylight photographs): the face, the barrel and the brake are built from the plan and then
 * scaled by this in the wheel's plane; the tyre's bead follows.
 */
export const RIM_SCALE = TYRES.front.rim / (18 * 0.0254);

export const WHEEL = {
  pairs: 5,
  /** Outer edge of the rim, where the tyre begins [M]; the lip's bright flat; the edge of the black step inside it. */
  edge: 0.2432,
  ringOuter: 0.242,
  ringInner: 0.2345,
  step: 0.229,
  /** From the wheel's centre plane to the plane of the lip: half the rim's width over its flanges [D]. */
  lip: { front: 0.1075, rear: 0.1205 },
  /** From the centre plane to the face that bolts to the hub: the wheel's offset, ET40 and ET52 [D]. */
  offset: { front: 0.04, rear: 0.052 },

  /**
   * A pair is two bars that lean towards each other as they run out to the rim. Half-widths across the pair's
   * axis, at a distance `at` along it, growing towards the hub by `taper` per metre [M]: the outer edges and the
   * edges of the black pocket between the bars.
   */
  at: 0.222,
  // (car2: the daylight close views show bright bars nearly twice as wide as first measured, the pocket narrower)
  edgeHalf: 0.026,
  edgeTaper: 0.1146,
  slotHalf: 0.0085,
  slotTaper: 0.0521,
  /** The pocket ends here; from there to the rim the two bars are one bright head [M]. */
  slotEnd: 0.232,
  /** Radius of the black collar round the cap, where the bright faces end [M]. */
  hub: 0.047,
  /** A slit runs out from the collar along the line between two pairs: half-width, where its round end is centred. */
  notchHalf: 0.00275,
  notchEnd: 0.0625,
  /** Radius of the rounded corner where the outer edges of neighbouring pairs meet [M]. */
  fillet: 0.007,
  /** The lip's bright ring stops this far short of a pair's head on either side [M]. */
  gap: 0.005,
  /** The rounded edge of a machined face; how far the flanks drop behind it; the depth of pocket and slit [E]. */
  bevel: 0.001,
  flank: 0.018,
  pocket: 0.009,
  notchDepth: 0.004,

  /** Cap: its radius, the bright ring on it, how far its face lies behind the lip [M]. */
  cap: 0.0375,
  capRing: [0.0237, 0.0367],
  capDepth: 0.029,
  collarDepth: 0.027,
  /** Five bolts on a 112 mm circle [D], in round pockets at the root of each pocket between the bars [E]. */
  boltCircle: 0.056,
  boltPocket: 0.013,
  boltHead: 0.0098,
};

/** The brake [E, the rear disc's size D]: disc radius and thickness, the hat, and the caliper. */
const BRAKE = {
  front: { radius: 0.165, thickness: 0.03, swept: 0.092, length: 0.25, proud: 0.058, ahead: true },
  rear: { radius: 0.16, thickness: 0.024, swept: 0.09, length: 0.17, proud: 0.046, ahead: false },
  hat: 0.0775,
  /** From the wheel's mounting face in to the disc's outer face (0.110 behind the lip on the photographed rear wheel) [M]. */
  hatHeight: 0.042,
};

/**
 * The exposure the smear is computed for, seconds. With a 60 Hz picture this is the whole frame: a wheel that
 * turns one pair-to-pair step per frame (where it would seem to stand still) is smeared over exactly that step.
 */
export const SHUTTER = 1 / 60;
/** Wheel speeds (rad/s) between which the shells fade in, the real spokes fade out, and the tread's detail goes. */
const FADE = { shellIn: [0.5, 2.5], spokesOut: [2.5, 5], tread: [0.5, 6] };

/** Per tier: segments round the wheel, stations along a bar, and what is left out. */
const DETAIL = {
  low: { tyreSegments: 28, tyreWall: 4, tyreTread: 2, segments: 28, stations: [0.076, 0.15, 0.232], arc: 1, ring: 3, bevel: false, bolts: false, valve: false, physical: false, mark: false, tyreTexture: [128, 256], cover: [240, 64], shellSegments: 24 },
  medium: { tyreSegments: 48, tyreWall: 9, tyreTread: 4, segments: 48, stations: [0.076, 0.11, 0.15, 0.19, 0.218, 0.232], arc: 2, ring: 5, bevel: true, bolts: true, valve: false, physical: true, mark: true, tyreTexture: [256, 512], cover: [480, 128], shellSegments: 40 },
  high: { tyreSegments: 72, tyreWall: 13, tyreTread: 5, segments: 64, stations: [0.076, 0.1, 0.125, 0.15, 0.175, 0.2, 0.218, 0.232], arc: 3, ring: 7, bevel: true, bolts: true, valve: true, physical: true, mark: true, tyreTexture: [256, 512], cover: [480, 128], shellSegments: 48 },
};

const TAU = Math.PI * 2;
/**
 * How much of the sky the parts deep inside the wheel (barrel, disc, caliper, dust shield) see: the arch, the
 * tyre and the spokes hide most of it, which a probe at the car's middle does not know. Without this the disc
 * mirrors the open sky and shines white through the windows; on the car it is a dark shape behind the spokes.
 */
const INNER_SKY = 0.3;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------- the face plan
// Plan coordinates: b along the first pair's axis (up, when the wheel has not turned), a across it. The plan is
// the same in each of ten half cells: from a pair's axis to the line half-way to the next pair, and mirrored.

const COS36 = Math.cos(Math.PI / 5);
const SIN36 = Math.sin(Math.PI / 5);
const edgeHalf = (b) => WHEEL.edgeHalf + WHEEL.edgeTaper * (WHEEL.at - b);
const slotHalf = (b) => WHEEL.slotHalf + WHEEL.slotTaper * (WHEEL.at - b);
/** Unit normals of the two edges in the plan, (a, b), pointing out of the bright bar. */
const EDGE_N = [1 / Math.hypot(1, WHEEL.edgeTaper), WHEEL.edgeTaper / Math.hypot(1, WHEEL.edgeTaper)];
const SLOT_N = [-1 / Math.hypot(1, WHEEL.slotTaper), -WHEEL.slotTaper / Math.hypot(1, WHEEL.slotTaper)];

/** The corner where the outer edges of two neighbouring pairs meet, and its fillet. */
const CORNER = (() => {
  const reach = WHEEL.edgeHalf + WHEEL.edgeTaper * WHEEL.at; // the edge's line is a + taper * b = reach
  const bV = reach / (SIN36 / COS36 + WHEEL.edgeTaper);
  const rV = bV / COS36;
  const along = [-WHEEL.edgeTaper / Math.hypot(1, WHEEL.edgeTaper), 1 / Math.hypot(1, WHEEL.edgeTaper)]; // outwards along the edge
  const cosG = along[0] * SIN36 + along[1] * COS36;
  const sinG = Math.sqrt(1 - cosG * cosG);
  const centre = rV + WHEEL.fillet / sinG; // of the fillet, along the line between the pairs
  const run = (WHEEL.fillet * cosG) / sinG;
  return {
    centre,
    /** Where the window's corner is, on the line between the pairs. */
    inner: centre - WHEEL.fillet,
    /** Where the fillet leaves the straight edge. */
    tangent: [bV * (SIN36 / COS36) + along[0] * run, bV + along[1] * run],
  };
})();

/** How far the faces lie behind the plane of the lip at radius r: the wheel's dish [M by parallax]. */
function dish(r) {
  const x0 = 0.05;
  const x1 = 0.14;
  const x2 = 0.225;
  const y0 = 0.026;
  const y2 = 0.0055;
  const f01 = (0.017 - y0) / (x1 - x0);
  const f012 = ((y2 - 0.017) / (x2 - x1) - f01) / (x2 - x0);
  if (r <= x2) {
    const x = Math.max(r, WHEEL.hub);
    return y0 + f01 * (x - x0) + f012 * (x - x0) * (x - x1);
  }
  // the last stretch sweeps up to the lip
  const span = WHEEL.ringOuter - x2;
  const t = Math.min(1, (r - x2) / span);
  const m0 = (f01 + f012 * (x2 - x0 + x2 - x1)) * span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * 0.0012;
}
const dishSlope = (r) => (dish(r + 0.0005) - dish(r - 0.0005)) / 0.001;
/** Depth of the pocket between the bars below their faces: shallow at the collar, full from 85 mm out. */
const pocketDepth = (r) => 0.002 + (WHEEL.pocket - 0.002) * smoothstep(WHEEL.hub, 0.085, r);
/** The cap's face: slightly domed. Depth behind the lip. */
const capDepth = (r) => WHEEL.capDepth - 0.0015 * (1 - (r / WHEEL.cap) ** 2);
const STAR = { reach: WHEEL.capRing[0], base: 0.0036, tip: 0.0006, height: 0.0018 };

/** What the cap is at a point: the bright ring, the star's three arms, or black. */
function classifyCap(a, b, r) {
  if (r >= WHEEL.capRing[0]) return r <= WHEEL.capRing[1] ? 1 : 2;
  for (let k = 0; k < 3; k++) {
    const angle = (k * TAU) / 3;
    const along = b * Math.cos(angle) + a * Math.sin(angle);
    const across = Math.abs(a * Math.cos(angle) - b * Math.sin(angle));
    if (along > -0.002 && across < STAR.base + (STAR.tip - STAR.base) * clamp01(along / STAR.reach)) return 1;
  }
  return 2;
}

/**
 * What the wheel's face is at a point of its plane: 0 open (a window), 1 bright (a machined face), 2 black. The
 * meshes below are built from the same outlines; this is the plan as a picture, for the coverage texture.
 */
export function classifyFace(a, b) {
  const r = Math.hypot(a, b);
  if (r > WHEEL.edge) return 0;
  if (r < WHEEL.cap) return classifyCap(a, b, r);
  if (r < WHEEL.hub) return 2;
  // fold into the first half cell
  let angle = Math.atan2(a, b) % (TAU / 5);
  if (angle < 0) angle += TAU / 5;
  if (angle > Math.PI / 5) angle = TAU / 5 - angle;
  const pa = r * Math.sin(angle);
  const pb = r * Math.cos(angle);
  // the slit between two pairs
  const off = Math.abs(pa * COS36 - pb * SIN36);
  const out = pa * SIN36 + pb * COS36;
  if (off < WHEEL.notchHalf && (out < WHEEL.notchEnd || Math.hypot(off, out - WHEEL.notchEnd) < WHEEL.notchHalf)) return 2;
  const outside = (pa - edgeHalf(pb)) * EDGE_N[0]; // distance beyond the pair's outer edge
  if (outside <= 0) {
    if (pb >= WHEEL.slotEnd) return 1; // the head
    return pa < slotHalf(pb) ? 2 : 1;
  }
  if (r >= WHEEL.ringInner) return pa <= edgeHalf(pb) + WHEEL.gap ? 2 : 1; // the lip: bright, but for the gap beside the head
  if (r >= WHEEL.step) return 0; // the black step is the barrel's (it does not turn)
  // a window, with its corner towards the hub rounded: mirror the point across the line between the pairs to
  // measure against the next pair's edge
  const dot = pa * SIN36 + pb * COS36;
  const qa = 2 * dot * SIN36 - pa;
  const qb = 2 * dot * COS36 - pb;
  const other = (qa - edgeHalf(qb)) * EDGE_N[0];
  if (other <= 0) return 1;
  const f = WHEEL.fillet;
  if (outside < f && other < f && (f - outside) ** 2 + (f - other) ** 2 > f * f) return 1;
  return 0;
}

// ---------------------------------------------------------------------------------------------- mesh building

/**
 * Collects triangles. Vertices are given in the wheel's own terms (x along the axle, b and a in its plane) and
 * can be turned about the axle and mirrored as they are added, so that one half cell of the face is written once.
 * Triangles may be given in either winding: build() turns each to agree with its vertices' normals.
 */
class Mesher {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
    this.place(0, false);
  }

  /** From now on: mirror across the pair's axis (a -> -a) if `mirror`, then turn by `angle` about the axle. */
  place(angle, mirror) {
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.sign = mirror ? -1 : 1;
  }

  /** @returns {number} the vertex's index */
  add(x, b, a, nx, nb, na, finish) {
    const sa = a * this.sign;
    const sna = na * this.sign;
    this.positions.push(x, b * this.cos - sa * this.sin, b * this.sin + sa * this.cos);
    const inv = 1 / (Math.hypot(nx, nb, na) || 1);
    this.normals.push(nx * inv, (nb * this.cos - sna * this.sin) * inv, (nb * this.sin + sna * this.cos) * inv);
    this.uvs.push(paletteU(finish), 0.5);
    return this.positions.length / 3 - 1;
  }

  tri(i, j, k) {
    this.indices.push(i, j, k);
  }

  quad(i, j, k, l) {
    this.indices.push(i, j, k, i, k, l);
  }

  /** Quads between two rows of vertices of the same length. */
  strip(rowA, rowB) {
    for (let i = 0; i + 1 < rowA.length; i++) this.quad(rowA[i], rowB[i], rowB[i + 1], rowA[i + 1]);
  }

  /**
   * A surface of revolution about the axle. `profile`: [r, x, finish] points; a point given twice makes a crease.
   * Normals point to the side of the profile on which `toward` ([r, x]) lies, seen from its first segment.
   */
  lathe(profile, segments, toward, alternate = null) {
    const n = profile.length;
    const normals = [];
    let side = 1;
    for (let i = 0; i < n; i++) {
      const prev = profile[Math.max(0, i - 1)];
      const next = profile[Math.min(n - 1, i + 1)];
      // a crease: the first of the twins takes the segment before it, the second the one after
      const twinNext = i + 1 < n && profile[i + 1][0] === profile[i][0] && profile[i + 1][1] === profile[i][1];
      const twinPrev = i > 0 && profile[i - 1][0] === profile[i][0] && profile[i - 1][1] === profile[i][1];
      const from = twinPrev ? profile[i] : prev;
      const to = twinNext ? profile[i] : next;
      let dr = to[0] - from[0];
      let dx = to[1] - from[1];
      if (dr === 0 && dx === 0) {
        dr = next[0] - prev[0];
        dx = next[1] - prev[1];
      }
      const len = Math.hypot(dr, dx) || 1;
      normals.push([-dx / len, dr / len]);
    }
    const mid = [(profile[0][0] + profile[1][0]) / 2, (profile[0][1] + profile[1][1]) / 2];
    if (normals[0][0] * (toward[0] - mid[0]) + normals[0][1] * (toward[1] - mid[1]) < 0) side = -1;
    const rows = [];
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * TAU;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const row = [];
      for (let i = 0; i < n; i++) {
        const [r, x, finish] = profile[i];
        const [nr, nx] = normals[i];
        const paint = alternate && s % 2 === 1 && alternate[finish] ? alternate[finish] : finish;
        row.push(this.add(x, r * c, r * sn, side * nx, side * nr * c, side * nr * sn, paint));
      }
      rows.push(row);
    }
    for (let s = 0; s < segments; s++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = profile[i];
        const b = profile[i + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        // with alternating finishes a band takes the finish of its leading edge: its two rows must not blend
        if (alternate) this.quadFlat(rows[s][i], rows[s][i + 1], rows[s + 1][i + 1], rows[s + 1][i], s % 2 === 1 && alternate[a[2]] ? alternate[a[2]] : a[2]);
        else this.quad(rows[s][i], rows[s][i + 1], rows[s + 1][i + 1], rows[s + 1][i]);
      }
    }
  }

  /** A quad of one finish from four existing vertices (copies them, keeping their normals). */
  quadFlat(i, j, k, l, finish) {
    const copy = (v) => {
      this.positions.push(this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]);
      this.normals.push(this.normals[v * 3], this.normals[v * 3 + 1], this.normals[v * 3 + 2]);
      this.uvs.push(paletteU(finish), 0.5);
      return this.positions.length / 3 - 1;
    };
    this.quad(copy(i), copy(j), copy(k), copy(l));
  }

  /**
   * A block between two radii, two planes across the axle and two angles (plan angle, from b towards a), with
   * flat faces and, if `chamfer`, the two edges of its outboard face cut off.
   */
  arcBlock({ r0, r1, x0, x1, phi0, phi1, finish, segments = 6, chamfer = 0 }) {
    const section = chamfer
      ? [
          [r0, x0],
          [r0, x1 - chamfer],
          [r0 + chamfer, x1],
          [r1 - chamfer, x1],
          [r1, x1 - chamfer],
          [r1, x0],
        ]
      : [
          [r0, x0],
          [r0, x1],
          [r1, x1],
          [r1, x0],
        ];
    const n = section.length;
    const cr = (r0 + r1) / 2;
    const cx = (x0 + x1) / 2;
    // each side of the section is its own band of faces
    for (let i = 0; i < n; i++) {
      const p = section[i];
      const q = section[(i + 1) % n];
      let nr = q[1] - p[1];
      let nx = -(q[0] - p[0]);
      if (nr * ((p[0] + q[0]) / 2 - cr) + nx * ((p[1] + q[1]) / 2 - cx) < 0) {
        nr = -nr;
        nx = -nx;
      }
      const rowP = [];
      const rowQ = [];
      for (let s = 0; s <= segments; s++) {
        const phi = phi0 + ((phi1 - phi0) * s) / segments;
        const c = Math.cos(phi);
        const sn = Math.sin(phi);
        rowP.push(this.add(p[1], p[0] * c, p[0] * sn, nx, nr * c, nr * sn, finish));
        rowQ.push(this.add(q[1], q[0] * c, q[0] * sn, nx, nr * c, nr * sn, finish));
      }
      this.strip(rowP, rowQ);
    }
    // the two ends
    for (const [phi, sign] of [
      [phi0, -1],
      [phi1, 1],
    ]) {
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const ring = section.map(([r, x]) => this.add(x, r * c, r * sn, 0, -sn * sign, c * sign, finish));
      for (let i = 1; i + 1 < n; i++) this.tri(ring[0], ring[i], ring[i + 1]);
    }
  }

  /** A closed tube from p to q ([x, b, a]) with a flat end at q. */
  rod(p, q, radius, sides, finish) {
    const axis = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
    const u = new THREE.Vector3(1, 0, 0).cross(axis);
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const rowP = [];
    const rowQ = [];
    const cap = [];
    for (let s = 0; s <= sides; s++) {
      const phi = (s / sides) * TAU;
      const nx = u.x * Math.cos(phi) + v.x * Math.sin(phi);
      const nb = u.y * Math.cos(phi) + v.y * Math.sin(phi);
      const na = u.z * Math.cos(phi) + v.z * Math.sin(phi);
      rowP.push(this.add(p[0] + nx * radius, p[1] + nb * radius, p[2] + na * radius, nx, nb, na, finish));
      rowQ.push(this.add(q[0] + nx * radius, q[1] + nb * radius, q[2] + na * radius, nx, nb, na, finish));
      cap.push(this.add(q[0] + nx * radius, q[1] + nb * radius, q[2] + na * radius, axis.x, axis.y, axis.z, finish));
    }
    this.strip(rowP, rowQ);
    for (let s = 1; s + 1 < sides; s++) this.tri(cap[0], cap[s], cap[s + 1]);
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(facingOut(this.positions, this.normals, this.indices));
    return geometry;
  }
}

/**
 * The triangles of `indices`, each wound so that its front is the side its vertices' normals point to, without
 * the slivers that have no area (where two outlines touch).
 */
function facingOut(p, n, indices) {
  const index = [];
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t];
    let j = indices[t + 1];
    let k = indices[t + 2];
    const ux = p[j * 3] - p[i * 3];
    const uy = p[j * 3 + 1] - p[i * 3 + 1];
    const uz = p[j * 3 + 2] - p[i * 3 + 2];
    const vx = p[k * 3] - p[i * 3];
    const vy = p[k * 3 + 1] - p[i * 3 + 1];
    const vz = p[k * 3 + 2] - p[i * 3 + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-18) continue;
    const facing = fx * (n[i * 3] + n[j * 3] + n[k * 3]) + fy * (n[i * 3 + 1] + n[j * 3 + 1] + n[k * 3 + 1]) + fz * (n[i * 3 + 2] + n[j * 3 + 2] + n[k * 3 + 2]);
    if (facing < 0) [j, k] = [k, j];
    index.push(i, j, k);
  }
  return index;
}

/** The outline of a half cell's bright face, as rungs from the collar to the slot's end: outer and slot side. */
function halfCellRungs(detail) {
  const U = [SIN36, COS36]; // out along the line between two pairs, (a, b)
  const N = [COS36, -SIN36]; // across it, towards the next pair
  const nh = WHEEL.notchHalf;
  const at = (along, across) => [along * U[0] + across * N[0], along * U[1] + across * N[1]];
  const outer = [];
  const push = (p, normal, wall, open = false) => outer.push({ a: p[0], b: p[1], na: normal[0], nb: normal[1], wall, open, inset: 1 });
  // up the side of the slit, round its end, along the middle line to the window's corner, round the fillet
  push(at(Math.sqrt(WHEEL.hub ** 2 - nh ** 2), -nh), N, 'notch');
  push(at(WHEEL.notchEnd, -nh), N, 'notch');
  if (detail.arc > 1) push(at(WHEEL.notchEnd + nh * Math.SQRT1_2, -nh * Math.SQRT1_2), [(N[0] - U[0]) * Math.SQRT1_2, (N[1] - U[1]) * Math.SQRT1_2], 'notch');
  push(at(WHEEL.notchEnd + nh, 0), [-U[0], -U[1]], 'notch', true); // from here the outline follows the middle line: no wall
  const centre = at(CORNER.centre, 0);
  const endDir = [-EDGE_N[0], -EDGE_N[1]];
  const startAngle = Math.atan2(-U[0], -U[1]);
  let sweep = Math.atan2(endDir[0], endDir[1]) - startAngle;
  if (sweep > Math.PI) sweep -= TAU;
  if (sweep < -Math.PI) sweep += TAU;
  for (let i = 0; i <= detail.arc; i++) {
    const angle = startAngle + (sweep * i) / detail.arc;
    const dir = [Math.sin(angle), Math.cos(angle)];
    push([centre[0] + dir[0] * WHEEL.fillet, centre[1] + dir[1] * WHEEL.fillet], [-dir[0], -dir[1]], 'window');
  }
  const lower = outer.length;
  const bT = CORNER.tangent[1];
  for (const b of detail.stations) push([edgeHalf(b), b], EDGE_N, 'window');

  // the slot side: the same number of points, spaced like the outer ones up to the fillet's end
  let b0 = WHEEL.hub;
  for (let i = 0; i < 4; i++) b0 = Math.sqrt(WHEEL.hub ** 2 - slotHalf(b0) ** 2);
  const lengths = [0];
  for (let i = 1; i < lower; i++) lengths.push(lengths[i - 1] + Math.hypot(outer[i].a - outer[i - 1].a, outer[i].b - outer[i - 1].b));
  const slot = [];
  for (let i = 0; i < outer.length; i++) {
    const b = i < lower ? b0 + (bT - b0) * (lengths[i] / lengths[lower - 1]) : detail.stations[i - lower];
    const last = i === outer.length - 1;
    // the last one is the corner of the slot's end: its bevel runs along both edges
    slot.push({ a: slotHalf(b), b, na: last ? -Math.SQRT1_2 : SLOT_N[0], nb: last ? -Math.SQRT1_2 : SLOT_N[1], wall: 'slot', open: false, inset: last ? Math.SQRT2 : 1 });
  }
  return { outer, slot, lower };
}

/** Where the outer edge of a pair meets a circle of radius r: [a, b]. */
function edgeOnCircle(r) {
  let b = r;
  for (let i = 0; i < 4; i++) b = Math.sqrt(r * r - edgeHalf(b) ** 2);
  return [edgeHalf(b), b];
}

/**
 * The turning, five-fold part of the wheel: bars, heads, lip, collar, cap, bolts.
 * @param {object} detail a row of DETAIL
 * @param {number} lip the lip's plane, from the wheel's centre plane
 */
function buildSpokes(detail, lip) {
  const mesh = new Mesher();
  const c = detail.bevel ? WHEEL.bevel : 0;
  const { outer, slot, lower } = halfCellRungs(detail);
  const count = outer.length;
  const tilt = Math.tan((70 * Math.PI) / 180); // how far a bevel's outer edge leans over

  /** A vertex on the dish at plan point (a, b), `below` the face, leaning towards the plan direction (la, lb). */
  const onDish = (a, b, below, finish, la = 0, lb = 0, lean = 0) => {
    const r = Math.hypot(a, b);
    const slope = dishSlope(r);
    return mesh.add(lip - dish(r) - below, b, a, 1, (slope * b) / r + lb * lean, (slope * a) / r + la * lean, finish);
  };
  /** A vertex of a wall: at plan point (a, b), `below` the face, facing (na, nb) in the plan. */
  const onWall = (a, b, below, na, nb) => mesh.add(lip - dish(Math.hypot(a, b)) - below, b, a, 0, nb, na, 'black');
  const wallDepth = (p) => (p.wall === 'window' ? WHEEL.flank : p.wall === 'notch' ? WHEEL.notchDepth : pocketDepth(Math.hypot(p.a, p.b)));

  for (let pair = 0; pair < WHEEL.pairs; pair++) {
    for (const mirror of [false, true]) {
      mesh.place((pair * TAU) / WHEEL.pairs, mirror);

      // ---- the bar: face between the two outlines, a bevel and a wall along each
      const faceOuter = [];
      const faceSlot = [];
      for (let i = 0; i < count; i++) {
        const o = outer[i];
        const s = slot[i];
        faceOuter.push(onDish(o.a - o.na * c * o.inset, o.b - o.nb * c * o.inset, 0, 'machined'));
        faceSlot.push(onDish(s.a - s.na * c * s.inset, s.b - s.nb * c * s.inset, 0, 'machined'));
      }
      mesh.strip(faceOuter, faceSlot);
      for (const [line, face] of [
        [outer, faceOuter],
        [slot, faceSlot],
      ]) {
        const edge = [];
        const top = [];
        const bottom = [];
        for (const p of line) {
          edge.push(c ? onDish(p.a, p.b, c, 'machined', p.na, p.nb, tilt) : -1);
          top.push(onWall(p.a, p.b, c, p.na, p.nb));
          bottom.push(onWall(p.a, p.b, wallDepth(p), p.na, p.nb));
        }
        for (let i = 0; i + 1 < line.length; i++) {
          if (c) mesh.quad(face[i], edge[i], edge[i + 1], face[i + 1]);
          if (!line[i].open) mesh.quad(top[i], bottom[i], bottom[i + 1], top[i + 1]);
        }
      }

      // ---- the floor of the slit (this half of it)
      const slitFloor = (along, across) => onDish(along * SIN36 + across * COS36, along * COS36 - across * SIN36, WHEEL.notchDepth, 'black');
      const slitStart = Math.sqrt(WHEEL.hub ** 2 - WHEEL.notchHalf ** 2);
      const side0 = slitFloor(slitStart, -WHEEL.notchHalf);
      const side1 = slitFloor(WHEEL.notchEnd, -WHEEL.notchHalf);
      const mid0 = slitFloor(slitStart, 0);
      const mid1 = slitFloor(WHEEL.notchEnd, 0);
      const tip = slitFloor(WHEEL.notchEnd + WHEEL.notchHalf, 0);
      mesh.quad(side0, side1, mid1, mid0);
      mesh.tri(side1, tip, mid1);

      // ---- the head: from the end of the slot to the rim, across the pair's axis
      const top = count - 1;
      const sEnd = slot[top];
      const rimFlat = WHEEL.ringOuter;
      const corner = edgeOnCircle(rimFlat);
      const headInner = [onDish(0, WHEEL.slotEnd + c, 0, 'machined'), faceSlot[top], faceOuter[top]];
      const onRim = (a) => [a, Math.sqrt(rimFlat * rimFlat - a * a)];
      const rimPoints = [onRim(0), onRim(sEnd.a + c), [corner[0] - c * EDGE_N[0], corner[1]]];
      const headRim = rimPoints.map(([a, b]) => onDish(a, b, 0, 'machined'));
      mesh.strip(headInner, headRim);
      // the slot's end: bevel and wall
      const endEdge = c ? [onDish(0, WHEEL.slotEnd, c, 'machined', 0, -1, tilt), onDish(sEnd.a, sEnd.b, c, 'machined', sEnd.na, sEnd.nb, tilt)] : null;
      if (c) mesh.quad(headInner[0], endEdge[0], endEdge[1], headInner[1]);
      const endFloor = pocketDepth(WHEEL.slotEnd);
      mesh.quad(onWall(0, WHEEL.slotEnd, c, 0, -1), onWall(0, WHEEL.slotEnd, endFloor, 0, -1), onWall(sEnd.a, sEnd.b, endFloor, 0, -1), onWall(sEnd.a, sEnd.b, c, 0, -1));
      // the outer edge on from the last station to the rim: bevel and wall
      const oEnd = outer[top];
      if (c) mesh.quad(faceOuter[top], onDish(oEnd.a, oEnd.b, c, 'machined', oEnd.na, oEnd.nb, tilt), onDish(corner[0], corner[1], c, 'machined', EDGE_N[0], EDGE_N[1], tilt), headRim[2]);
      mesh.quad(onWall(oEnd.a, oEnd.b, c, EDGE_N[0], EDGE_N[1]), onWall(oEnd.a, oEnd.b, WHEEL.flank, EDGE_N[0], EDGE_N[1]), onWall(corner[0], corner[1], WHEEL.flank * 0.5, EDGE_N[0], EDGE_N[1]), onWall(corner[0], corner[1], c, EDGE_N[0], EDGE_N[1]));
      // the rim's rounded outer edge over the head
      const headEdge = rimPoints.map(([a, b]) => {
        const k = WHEEL.edge / rimFlat;
        return onDish(a * k, b * k, WHEEL.edge - rimFlat, 'machined', a / rimFlat, b / rimFlat, tilt);
      });
      mesh.strip(headRim, headEdge);

      // ---- the lip's bright ring from beside the head to the middle of the window, and the wall under its inner edge
      const startAngle = Math.atan2(corner[0] + WHEEL.gap, corner[1]);
      const ring = { wallFoot: [], wallTop: [], inner: [], flatInner: [], flatOuter: [], outer: [] };
      const under = WHEEL.ringInner - 0.001;
      for (let i = 0; i <= detail.ring; i++) {
        const angle = startAngle + ((Math.PI / 5 - startAngle) * i) / detail.ring;
        const sa = Math.sin(angle);
        const ca = Math.cos(angle);
        const bright = (r, depth, lean) => mesh.add(lip - depth, r * ca, r * sa, 1, ca * lean, sa * lean, 'machined');
        ring.wallFoot.push(mesh.add(lip - 0.0055, under * ca, under * sa, 0, -ca, -sa, 'black'));
        ring.wallTop.push(mesh.add(lip - 0.001, under * ca, under * sa, 0, -ca, -sa, 'black'));
        ring.inner.push(bright(under, 0.001, -tilt));
        ring.flatInner.push(bright(WHEEL.ringInner, 0, 0));
        ring.flatOuter.push(bright(WHEEL.ringOuter, 0, 0));
        ring.outer.push(bright(WHEEL.edge, WHEEL.edge - WHEEL.ringOuter, tilt));
      }
      mesh.strip(ring.wallFoot, ring.wallTop);
      mesh.strip(ring.inner, ring.flatInner);
      mesh.strip(ring.flatInner, ring.flatOuter);
      mesh.strip(ring.flatOuter, ring.outer);

      // ---- the pocket's floor between the slot's edge and the pair's axis
      const floorAt = (a, b) => onDish(a, b, pocketDepth(Math.hypot(a, b)), 'black');
      const floorSlot = slot.map((p) => floorAt(p.a, p.b));
      const split = detail.bolts ? lower : 0; // with a bolt, the floor below the first station is built round its pocket
      const floorAxis = [];
      for (let i = split; i < count; i++) floorAxis.push(floorAt(0, Math.max(slot[i].b, WHEEL.hub)));
      mesh.strip(floorSlot.slice(split), floorAxis);
      if (detail.bolts) {
        // the bolt's round pocket: its rim is stitched to the floor's outline by bearing from the bolt
        const bolt = WHEEL.boltCircle;
        const bottomX = lip - dish(bolt) - 0.014;
        const bearing = (a, b) => Math.atan2(a, b - bolt);
        const outline = [{ index: floorAxis[0], phi: 0 }];
        for (let i = split; i >= 0; i--) outline.push({ index: floorSlot[i], phi: bearing(slot[i].a, slot[i].b) });
        outline.push({ index: floorAt(slot[0].a * 0.5, Math.sqrt(WHEEL.hub ** 2 - (slot[0].a * 0.5) ** 2)), phi: bearing(slot[0].a * 0.5, WHEEL.hub) });
        outline.push({ index: floorAt(0, WHEEL.hub), phi: Math.PI });
        const steps = 8;
        const rim = [];
        const wallTop = [];
        const wallBottom = [];
        const floorBottom = [];
        for (let i = 0; i <= steps; i++) {
          const phi = (i / steps) * Math.PI;
          const a = WHEEL.boltPocket * Math.sin(phi);
          const b = bolt + WHEEL.boltPocket * Math.cos(phi);
          const depth = pocketDepth(Math.hypot(a, b));
          rim.push({ index: floorAt(a, b), phi });
          wallTop.push(mesh.add(lip - dish(Math.hypot(a, b)) - depth, b, a, 0, -Math.cos(phi), -Math.sin(phi), 'black'));
          wallBottom.push(mesh.add(bottomX, b, a, 0, -Math.cos(phi), -Math.sin(phi), 'black'));
          floorBottom.push(mesh.add(bottomX, b, a, 1, 0, 0, 'black'));
        }
        // stitch: advance along whichever line is behind
        let i = 0;
        let j = 0;
        while (i + 1 < rim.length || j + 1 < outline.length) {
          const stepRim = i + 1 < rim.length && (j + 1 >= outline.length || rim[i + 1].phi <= outline[j + 1].phi);
          if (stepRim) mesh.tri(rim[i].index, rim[++i].index, outline[j].index);
          else mesh.tri(rim[i].index, outline[j + 1].index, outline[j++].index);
        }
        mesh.strip(wallTop, wallBottom);
        const centre = mesh.add(bottomX, bolt, 0, 1, 0, 0, 'black');
        for (let k = 0; k < steps; k++) mesh.tri(centre, floorBottom[k], floorBottom[k + 1]);
        // the bolt's head: half a hexagon, a little short of the floor
        const headX = bottomX + 0.009;
        const hexTop = [];
        for (let k = 0; k <= 3; k++) {
          const phi = (k / 3) * Math.PI;
          const a = WHEEL.boltHead * Math.sin(phi);
          const b = bolt + WHEEL.boltHead * Math.cos(phi);
          hexTop.push(mesh.add(headX, b, a, 1, 0, 0, 'bolt'));
          if (k < 3) {
            const mid = ((k + 0.5) / 3) * Math.PI;
            const a1 = WHEEL.boltHead * Math.sin(((k + 1) / 3) * Math.PI);
            const b1 = bolt + WHEEL.boltHead * Math.cos(((k + 1) / 3) * Math.PI);
            const side = [mesh.add(headX, b, a, 0, Math.cos(mid), Math.sin(mid), 'bolt'), mesh.add(bottomX, b, a, 0, Math.cos(mid), Math.sin(mid), 'bolt'), mesh.add(bottomX, b1, a1, 0, Math.cos(mid), Math.sin(mid), 'bolt'), mesh.add(headX, b1, a1, 0, Math.cos(mid), Math.sin(mid), 'bolt')];
            mesh.quad(side[0], side[1], side[2], side[3]);
          }
        }
        const hexCentre = mesh.add(headX, bolt, 0, 1, 0, 0, 'bolt');
        for (let k = 0; k < 3; k++) mesh.tri(hexCentre, hexTop[k], hexTop[k + 1]);
      }
    }
  }

  // ---- what is round: the collar and the cap
  mesh.place(0, false);
  const round = detail.segments;
  const capX = (r) => lip - capDepth(r);
  mesh.lathe(
    [
      [WHEEL.hub, lip - dish(WHEEL.hub) - 0.006, 'black'],
      [WHEEL.hub, lip - WHEEL.collarDepth, 'black'],
      [WHEEL.hub, lip - WHEEL.collarDepth, 'black'],
      [WHEEL.cap, lip - WHEEL.collarDepth, 'black'],
      [WHEEL.cap, lip - WHEEL.collarDepth, 'black'],
      [WHEEL.cap, capX(WHEEL.cap), 'black'],
      [WHEEL.cap, capX(WHEEL.cap), 'black'],
      [0.03, capX(0.03), 'black'],
      [0.015, capX(0.015), 'black'],
      [0, capX(0), 'black'],
    ],
    round,
    [WHEEL.hub + 1, lip],
  );
  const [ring0, ring1] = WHEEL.capRing;
  const proud = 0.0006;
  mesh.lathe(
    [
      [ring1, capX(ring1), 'capRing'],
      [ring1 - 0.0006, capX(ring1) + proud, 'capRing'],
      [ring1 - 0.0006, capX(ring1) + proud, 'capRing'],
      [ring0 + 0.0006, capX(ring0) + proud, 'capRing'],
      [ring0 + 0.0006, capX(ring0) + proud, 'capRing'],
      [ring0, capX(ring0), 'capRing'],
    ],
    round,
    [ring1 + 1, lip],
  );
  // the star: three arms, each two facets meeting in a ridge; points are [a, b, x]
  const flat = (p, q, r) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return n[2] < 0 ? n.map((value) => -value) : n;
  };
  const baseAt = 0.0025;
  for (let arm = 0; arm < 3; arm++) {
    for (const mirror of [false, true]) {
      mesh.place((arm * TAU) / 3, mirror);
      const ridge0 = [0, 0, capX(0) + STAR.height];
      const ridge1 = [0, STAR.reach, capX(STAR.reach) + proud];
      const base = [STAR.base, baseAt, capX(0.004)];
      const tip = [STAR.tip, STAR.reach, capX(STAR.reach)];
      const n = flat(ridge0, ridge1, base);
      const facet = ([a, b, x]) => mesh.add(x, b, a, n[2], n[1], n[0], 'chrome');
      mesh.quad(facet(ridge0), facet(base), facet(tip), facet(ridge1));
      if (mirror) continue;
      // the middle, between this arm's edge and the next arm's (which is this arm's other edge, a third of a turn on)
      const next = [0.5 * STAR.base + Math.sin(TAU / 3) * baseAt, Math.sin(TAU / 3) * STAR.base - 0.5 * baseAt, capX(0.004)];
      const m = flat(ridge0, base, next);
      const fill = ([a, b, x]) => mesh.add(x, b, a, m[2], m[1], m[0], 'chrome');
      mesh.tri(fill(ridge0), fill(base), fill(next));
    }
  }

  // ---- the valve, in the middle of one window
  if (detail.valve) {
    mesh.place(TAU / 10, false);
    const foot = [lip - 0.03, 0.214, 0];
    const head = [lip - 0.017, 0.197, 0];
    const end = [lip - 0.012, 0.1905, 0];
    mesh.rod(foot, head, 0.0036, 8, 'valve');
    mesh.rod(head, end, 0.0046, 8, 'bolt');
  }
  return mesh.build();
}

/**
 * Everything that looks the same however the wheel is turned, and everything that does not turn: the barrel and
 * the lip's black step, the wheel's centre, the brake disc and its hat, the caliper, the dust shield, the carrier.
 */
function buildStatic(detail, front) {
  const mesh = new Mesher();
  const lip = front ? WHEEL.lip.front : WHEEL.lip.rear;
  const offset = front ? WHEEL.offset.front : WHEEL.offset.rear;
  const brake = front ? BRAKE.front : BRAKE.rear;
  const round = detail.segments;

  // the outer wall of the lip, down to the tyre
  mesh.lathe(
    [
      [WHEEL.edge, lip - (WHEEL.edge - WHEEL.ringOuter), 'black'],
      [WHEEL.edge + 0.0015, lip - 0.007, 'black'],
    ],
    round,
    [1, lip],
  );
  // the barrel from inside: the step under the lip, the well, the inner flange
  mesh.lathe(
    [
      [WHEEL.ringInner - 0.001, lip - 0.0045, 'black'],
      [WHEEL.step, lip - 0.008, 'black'],
      [0.2255, lip - 0.02, 'black'],
      [0.213, lip - 0.031, 'black'],
      [0.206, lip - 0.042, 'black'],
      [0.205, lip - 0.09, 'black'],
      [0.212, lip - 0.106, 'black'],
      [0.215, -lip + 0.03, 'black'],
      [0.217, -lip + 0.012, 'black'],
      [0.229, -lip + 0.005, 'black'],
      [0.243, -lip, 'black'],
    ],
    round,
    [0, 0],
  );
  // the wheel's centre behind the spokes, down to the face that meets the hub
  const centreTop = lip - dish(0.074) - WHEEL.flank * 0.6;
  mesh.lathe(
    [
      [0.074, centreTop, 'black'],
      [0.074, offset, 'black'],
    ],
    round,
    [1, offset],
  );

  // the disc: hat, swept face with the marks of the pads, vented edge, back
  const outerFace = offset - BRAKE.hatHeight;
  const innerFace = outerFace - brake.thickness;
  const rd = brake.radius;
  mesh.lathe(
    [
      [BRAKE.hat - 0.003, offset, 'hat'],
      [BRAKE.hat, outerFace, 'hat'],
      [BRAKE.hat, outerFace, 'hat'],
      [brake.swept, outerFace, 'hat'],
    ],
    round,
    [1, offset],
  );
  const bands = [
    [brake.swept, brake.swept + 0.003, 'discWorn'],
    [brake.swept + 0.003, brake.swept + 0.6 * (rd - brake.swept), 'disc'],
    [brake.swept + 0.6 * (rd - brake.swept), brake.swept + 0.64 * (rd - brake.swept), 'discWorn'],
    [brake.swept + 0.64 * (rd - brake.swept), rd - 0.003, 'disc'],
    [rd - 0.003, rd, 'discEdge'],
  ];
  for (const [r0, r1, finish] of bands) {
    mesh.lathe(
      [
        [r0, outerFace, finish],
        [r1, outerFace, finish],
      ],
      round,
      [r0, outerFace + 1],
    );
  }
  const plate = Math.min(0.008, brake.thickness * 0.3);
  mesh.lathe(
    [
      [rd, outerFace, 'discWorn'],
      [rd, outerFace - plate, 'discWorn'],
    ],
    round,
    [1, 0],
  );
  mesh.lathe(
    [
      [rd - 0.001, outerFace - plate, 'discEdge'],
      [rd - 0.001, innerFace + plate, 'discEdge'],
    ],
    round,
    [1, 0],
    detail.bevel ? { discEdge: 'pad' } : null,
  );
  mesh.lathe(
    [
      [rd, innerFace + plate, 'discWorn'],
      [rd, innerFace, 'discWorn'],
      [rd, innerFace, 'discWorn'],
      [brake.swept, innerFace, 'discWorn'],
    ],
    round,
    [1, 0],
  );

  // the dust shield behind the disc, seen from both sides, and the hub carrier
  const shield = innerFace - 0.014;
  mesh.lathe(
    [
      [0.05, shield, 'matte'],
      [rd + 0.006, shield, 'matte'],
    ],
    round,
    [0.1, shield + 1],
  );
  mesh.lathe(
    [
      [0.05, shield - 0.002, 'matte'],
      [rd + 0.006, shield - 0.002, 'matte'],
    ],
    round,
    [0.1, shield - 1],
  );
  const carrierEnd = -lip - 0.03;
  mesh.lathe(
    [
      [0.052, shield, 'iron'],
      [0.052, carrierEnd, 'iron'],
      [0.052, carrierEnd, 'iron'],
      [0, carrierEnd, 'iron'],
    ],
    Math.max(12, Math.round(round / 3)),
    [1, 0],
  );

  // the caliper: a floating one, ahead of the axle at the front and behind it at the rear
  const centre = brake.ahead ? Math.PI / 2 : -Math.PI / 2;
  const half = brake.length / 2 / rd;
  const arc = (shrink) => ({ phi0: centre - half + shrink, phi1: centre + half - shrink });
  const segments = detail.bevel ? 8 : 3;
  mesh.arcBlock({ r0: 0.116, r1: 0.186, x0: outerFace + 0.014, x1: outerFace + brake.proud, ...arc(0.1), finish: 'caliper', segments, chamfer: 0.007 });
  if (front) mesh.arcBlock({ r0: 0.134, r1: 0.17, x0: outerFace + brake.proud - 0.002, x1: outerFace + brake.proud + 0.005, ...arc(half - 0.2), finish: 'caliper', segments: 3, chamfer: 0.003 });
  mesh.arcBlock({ r0: 0.168, r1: 0.196, x0: innerFace - 0.02, x1: outerFace + 0.022, ...arc(0.16), finish: 'caliper', segments, chamfer: 0.004 });
  mesh.arcBlock({ r0: 0.11, r1: 0.19, x0: innerFace - 0.07, x1: innerFace - 0.014, ...arc(0.14), finish: 'caliper', segments: 3 });
  mesh.arcBlock({ r0: 0.12, r1: rd - 0.001, x0: outerFace + 0.0005, x1: outerFace + 0.014, ...arc(0.2), finish: 'pad', segments: 3 });
  mesh.arcBlock({ r0: 0.12, r1: rd - 0.001, x0: innerFace - 0.014, x1: innerFace - 0.0005, ...arc(0.2), finish: 'pad', segments: 3 });
  for (const end of [-1, 1]) {
    const at = centre + end * (half - 0.04);
    mesh.arcBlock({ r0: 0.118, r1: 0.182, x0: innerFace - 0.03, x1: outerFace + 0.024, phi0: at - 0.06, phi1: at + 0.06, finish: 'iron', segments: 1 });
  }
  return mesh.build();
}

/**
 * The tyre: a lathe of its section. v runs from the inner bead (0) to the outer (1) with the tread on
 * TYRE_TREAD_V, u once round the wheel.
 * @param {object} detail a row of DETAIL
 * @param {{ width: number, radius: number }} tyre a row of spec.js TYRES
 * @param {number} lip the plane of the rim's lip
 */
function buildTyre(detail, tyre, lip) {
  const radius = tyre.radius;
  const treadHalf = tyre.width * 0.435;
  const bulge = Math.max(tyre.width / 2, lip + 0.0035);
  const middle = WHEEL.edge * RIM_SCALE + 0.5 * (radius - WHEEL.edge * RIM_SCALE);
  const crown = 0.0045;
  // the outer sidewall from the bead to the edge of the tread: the rim protector, a dip, the bulge, the shoulder
  const wall = new THREE.CatmullRomCurve3(
    [
      [lip - 0.004, (WHEEL.edge + 0.0002) * RIM_SCALE],
      [lip + 0.001, 0.2462 * RIM_SCALE],
      [lip + 0.0036, 0.25 * RIM_SCALE],
      [lip + 0.0034, 0.2535 * RIM_SCALE],
      [lip + 0.0016, 0.258 * RIM_SCALE],
      [bulge, middle],
      [bulge - 0.0035, radius - 0.03],
      [bulge - 0.01, radius - 0.017],
      [treadHalf + 0.6 * (bulge - 0.01 - treadHalf), radius - 0.0085],
      [treadHalf, radius - crown],
    ].map(([x, r]) => new THREE.Vector3(x, r, 0)),
    false,
    'centripetal',
  ).getPoints(detail.tyreWall);
  // v along the wall by its length
  const lengths = [0];
  for (let i = 1; i < wall.length; i++) lengths.push(lengths[i - 1] + wall[i].distanceTo(wall[i - 1]));
  const [v0, v1] = TYRE_TREAD_V;
  /** @type {Array<[number, number, number]>} x, r, v from the inner bead to the outer */
  const section = [];
  for (let i = 0; i < wall.length; i++) section.push([-wall[i].x, wall[i].y, (lengths[i] / lengths[wall.length - 1]) * v0]);
  for (let i = 1; i < detail.tyreTread * 2; i++) {
    const t = i / (detail.tyreTread * 2);
    const x = (t * 2 - 1) * treadHalf;
    section.push([x, radius - crown * (x / treadHalf) ** 2, v0 + (v1 - v0) * t]);
  }
  for (let i = wall.length - 1; i >= 0; i--) section.push([wall[i].x, wall[i].y, 1 - (lengths[i] / lengths[wall.length - 1]) * (1 - v1)]);

  const n = section.length;
  const segments = detail.tyreSegments;
  const positions = new Float32Array((segments + 1) * n * 3);
  const normals = new Float32Array((segments + 1) * n * 3);
  const uvs = new Float32Array((segments + 1) * n * 2);
  const index = [];
  for (let i = 0; i < n; i++) {
    const prev = section[Math.max(0, i - 1)];
    const next = section[Math.min(n - 1, i + 1)];
    // the section runs from -x to +x over the top: its outward normal is the tangent turned a quarter
    const tx = next[0] - prev[0];
    const tr = next[1] - prev[1];
    const len = Math.hypot(tx, tr);
    const nx = -tr / len;
    const nr = tx / len;
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * TAU;
      const o = (s * n + i) * 3;
      positions[o] = section[i][0];
      positions[o + 1] = section[i][1] * Math.cos(phi);
      positions[o + 2] = section[i][1] * Math.sin(phi);
      normals[o] = nx;
      normals[o + 1] = nr * Math.cos(phi);
      normals[o + 2] = nr * Math.sin(phi);
      uvs[(s * n + i) * 2] = s / segments;
      uvs[(s * n + i) * 2 + 1] = section[i][2];
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i + 1 < n; i++) {
      const a = s * n + i;
      const b = a + n;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(facingOut(positions, normals, index));
  return geometry;
}

/** How far the shells stand in front of the faces they replace, and how far apart they are. */
const SHELL = { lift: 0.0008, spacing: 0.008, layers: 3, radius: 0.245 };

/**
 * The shells that stand in for the turning spokes: the face's dish and two copies behind it (the spokes' depth),
 * back one first so that they blend in order when seen from outside. `layer` is 0 on the front one.
 */
function buildShell(detail, lip) {
  const positions = [];
  const normals = [];
  const layers = [];
  const index = [];
  const segments = detail.shellSegments;
  const frontRadii = [0, 0.012, WHEEL.capRing[0], WHEEL.cap, WHEEL.hub, 0.075, 0.105, 0.14, 0.175, 0.205, 0.225, WHEEL.ringInner, WHEEL.edge];
  const deepRadii = [WHEEL.hub, 0.075, 0.105, 0.14, 0.175, 0.205, WHEEL.slotEnd];
  const depthAt = (r) => (r < WHEEL.cap ? capDepth(r) - 0.0006 : r < WHEEL.hub ? WHEEL.collarDepth : dish(r));
  for (let layer = SHELL.layers - 1; layer >= 0; layer--) {
    const radii = layer === 0 ? frontRadii : deepRadii;
    const base = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * TAU;
      for (const r of radii) {
        const slope = r >= WHEEL.hub ? dishSlope(r) : 0;
        positions.push(lip - depthAt(r) + SHELL.lift - layer * SHELL.spacing, r * Math.cos(phi), r * Math.sin(phi));
        const inv = 1 / Math.hypot(1, slope);
        normals.push(inv, slope * Math.cos(phi) * inv, slope * Math.sin(phi) * inv);
        layers.push(layer === 0 ? 0 : 1);
      }
    }
    const n = radii.length;
    for (let s = 0; s < segments; s++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = base + s * n + i;
        const b = a + n;
        if (radii[i] > 0) index.push(a, a + 1, b);
        index.push(b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('shellLayer', new THREE.Float32BufferAttribute(layers, 1));
  geometry.setIndex(facingOut(positions, normals, index));
  return geometry;
}

// ---------------------------------------------------------------------------------------------- materials

/** Replaces `find` in a shader, and says so loudly if a three.js update has moved it. */
function splice(source, find, replacement) {
  if (!source.includes(find)) throw new Error(`wheel.js: the shader no longer contains "${find}"`);
  return source.replace(find, replacement);
}

/**
 * The tyre's material reads its normal map twice: as it is, and averaged round the tyre, and blends the two by
 * `uSpun`. The height in the map's alpha darkens the grooves. (`this` is the material.)
 */
function patchTyre(shader, marked = false) {
  Object.assign(shader.uniforms, this.userData.uniforms);
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <normalmap_pars_fragment>',
    '#include <normalmap_pars_fragment>\nuniform sampler2D uSpunMap;\nuniform float uSpun;\nuniform sampler2D uMarkMap;',
  );
  // The size marking: raised characters on the outer wall, twice round the tyre. The tread's map repeats nine
  // times round, so the marking is a small map of its own, laid where the wall is plain (MARK).
  const mark = marked
    ? /* glsl */ `
	{
		// (u runs against the reading direction on the outer wall)
		vec2 markAt = vec2( 1.0 - ( fract( vNormalMapUv.x / ${(TYRE_REPEAT / 2).toFixed(1)} ) * ${(TYRE_REPEAT / 2).toFixed(1)} - ${MARK.u.toFixed(4)} ) / ${MARK.du.toFixed(4)},
			( ${MARK.v.toFixed(4)} - vNormalMapUv.y ) / ${MARK.dv.toFixed(4)} );
		if ( markAt.x > 0.0 && markAt.x < 1.0 && markAt.y > 0.0 && markAt.y < 1.0 ) {
			vec4 markTexel = texture2D( uMarkMap, markAt );
			mapN = normalize( mapN + vec3( 0.5 - markTexel.x, 0.5 - markTexel.y, 0.0 ) * ( 5.0 * ( 1.0 - uSpun ) ) );
			diffuseColor.rgb *= 1.0 + 0.35 * markTexel.a * ( 1.0 - uSpun );
		}
	}`
    : '';
  const maps = splice(
    THREE.ShaderChunk.normal_fragment_maps,
    'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
    /* glsl */ `vec4 tyreTexel = mix( texture2D( normalMap, vNormalMapUv ), texture2D( uSpunMap, vNormalMapUv ), uSpun );
	vec3 mapN = tyreTexel.xyz * 2.0 - 1.0;
	diffuseColor.rgb *= mix( 0.3, 1.0, smoothstep( 0.12, 0.47, tyreTexel.a ) );${mark}`,
  );
  shader.fragmentShader = splice(shader.fragmentShader, '#include <normal_fragment_maps>', maps);
}
function patchTyreMarked(shader) {
  patchTyre.call(this, shader, true);
}

/**
 * The bright faces are turned on a lathe and lacquered: the tool leaves fine concentric grooves, each a ring that
 * tilts the metal a little towards or away from the axle, under a smooth coat. Close by they show as hairlines
 * and break the mirror image up along the radius; from a few metres they are gone. A ring is never narrower than
 * two pixels, so nothing shimmers, and being rings they look the same however the wheel has turned.
 */
function patchSpokes(shader) {
  shader.vertexShader = splice(shader.vertexShader, '#include <common>', '#include <common>\nvarying vec3 vWheelPos;\nvarying vec3 vWheelRadial;');
  shader.vertexShader = splice(
    shader.vertexShader,
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvWheelPos = position;\nvWheelRadial = normalMatrix * vec3( 0.0, position.yz / max( length( position.yz ), 1e-5 ) );',
  );
  shader.fragmentShader = splice(shader.fragmentShader, '#include <common>', '#include <common>\nvarying vec3 vWheelPos;\nvarying vec3 vWheelRadial;');
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <normal_fragment_maps>',
    /* glsl */ `#include <normal_fragment_maps>
	if ( metalnessFactor > 0.9 && abs( roughnessFactor - ${FINISH.machined.roughness.toFixed(3)} ) < 0.03 ) {
		float turnedFoot = length( fwidth( vWheelPos ) );
		float turnedFade = 1.0 - smoothstep( 0.0007, 0.0026, turnedFoot );
		if ( turnedFade > 0.0 ) {
			float turnedR = length( vWheelPos.yz );
			float turnedRing = floor( turnedR / max( 0.00045, 2.0 * turnedFoot ) );
			float turnedTilt = fract( sin( turnedRing * 12.9898 ) * 43758.5453 ) - 0.5;
			normal = normalize( normal + normalize( vWheelRadial ) * ( 0.42 * turnedTilt * turnedFade ) );
		}
	}`,
  );
}

const linear = (finish) => `vec3( ${finish.color.map((c) => c.toFixed(4)).join(', ')} )`;

/**
 * The shells' material. Each pixel finds its place on the wheel's face (angle and radius, from the position in
 * the wheel's own frame), and reads how much of the arc that passes it during the exposure is bright metal and
 * how much is solid at all: that is its finish and its opacity. The arc is never narrower than the pixel itself,
 * which also keeps the pattern from shimmering in the distance. (`this` is the material.)
 */
function patchShell(shader) {
  Object.assign(shader.uniforms, this.userData.uniforms);
  shader.vertexShader = splice(shader.vertexShader, '#include <common>', '#include <common>\nattribute float shellLayer;\nvarying float vLayer;\nvarying vec2 vPlan;');
  shader.vertexShader = splice(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\nvLayer = shellLayer;\nvPlan = position.zy;');
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <common>',
    /* glsl */ `#include <common>
uniform sampler2D uCover;
uniform vec4 uCoverInfo; // texture height, top mip level, the wheel's radius in the texture, the cap's radius
uniform float uBlur;     // the arc swept during the exposure, as a fraction of the step from one pair to the next
uniform float uRipple;   // 1: the arc's own average; 0: the whole circle's
varying float vLayer;
varying vec2 vPlan;`,
  );
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <color_fragment>',
    /* glsl */ `#include <color_fragment>
	float shR = length( vPlan );
	float shV = shR / uCoverInfo.z;
	float shU = atan( vPlan.x, vPlan.y ) / 6.2831853;
	// the pixel's own width in angle, from the plan position's derivatives (the angle itself jumps at the seam)
	vec2 shDx = dFdx( vPlan );
	vec2 shDy = dFdy( vPlan );
	float shFoot = ( abs( vPlan.y * shDx.x - vPlan.x * shDx.y ) + abs( vPlan.y * shDy.x - vPlan.x * shDy.y ) ) / max( shR * shR, 1e-7 ) / 6.2831853;
	float shStep = shR < uCoverInfo.w ? 1.0 / 3.0 : 1.0 / 5.0;
	float shArc = clamp( max( uBlur * shStep, shFoot ), 0.002, shStep );
	float shLod = clamp( log2( max( fwidth( shV ) * uCoverInfo.x, 1.0 ) ), 0.0, uCoverInfo.y );
	vec4 shHi = textureLod( uCover, vec2( shU + 0.5 * shArc, shV ), shLod );
	vec4 shLo = textureLod( uCover, vec2( shU - 0.5 * shArc, shV ), shLod );
	float shWhole = max( 1.0 - uRipple, smoothstep( 0.8, 1.0, shArc / shStep ) );
	vec2 shCover = clamp( 0.5 * ( shHi.ba + shLo.ba ) + ( shHi.rg - shLo.rg ) / shArc * ( 1.0 - shWhole ), 0.0, 1.0 );
	float shBright = shCover.x * ( 1.0 - vLayer );
	float shSolid = max( shCover.y, shBright );
	float shMetal = shBright / max( shSolid, 1e-4 );
	diffuseColor.rgb = mix( ${linear(FINISH.black)}, ${linear(FINISH.machined)}, shMetal );
	diffuseColor.a *= shSolid;
	if ( diffuseColor.a < 0.02 ) discard;`,
  );
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <roughnessmap_fragment>',
    `#include <roughnessmap_fragment>\n\troughnessFactor = mix( ${FINISH.black.roughness.toFixed(3)}, ${FINISH.machined.roughness.toFixed(3)}, shMetal );`,
  );
  shader.fragmentShader = splice(
    shader.fragmentShader,
    '#include <metalnessmap_fragment>',
    `#include <metalnessmap_fragment>\n\tmetalnessFactor = mix( ${FINISH.black.metalness.toFixed(3)}, ${FINISH.machined.metalness.toFixed(3)}, shMetal );`,
  );
}

// ---------------------------------------------------------------------------------------------- shared parts
// Geometry and textures are the same for every wheel of a tier (two geometries: front and rear): they are built
// once, counted, and thrown away with the last wheel that used them.

const shared = new Map();

function acquire(key, build) {
  let entry = shared.get(key);
  if (!entry) {
    entry = { users: 0, value: build() };
    shared.set(key, entry);
  }
  entry.users++;
  return entry.value;
}

function release(key) {
  const entry = shared.get(key);
  if (!entry) return;
  if (--entry.users > 0) return;
  shared.delete(key);
  for (const thing of Object.values(entry.value)) if (thing && thing.dispose) thing.dispose();
}

function buildTextures(tier, caps) {
  const detail = DETAIL[tier];
  const tyre = createTyreTextures(detail.tyreTexture[0], detail.tyreTexture[1], Math.min(4, caps?.maxAnisotropy ?? 1));
  const palette = createPalette();
  const cover = createCoverTexture(classifyFace, { width: detail.cover[0], height: detail.cover[1], radius: SHELL.radius, capRadius: WHEEL.cap });
  // the size markings (medium and high): two small maps, a few milliseconds
  const size = (tyre) => `${Math.round(tyre.width * 1000)}/${Math.round(tyre.aspect * 100)} R${Math.round(tyre.rim / 0.0254)}`;
  const markFront = detail.mark ? createTyreMarkTexture(size(TYRES.front)) : null;
  const markRear = detail.mark ? createTyreMarkTexture(size(TYRES.rear)) : null;
  return {
    tyreNormal: tyre.normal, tyreSpun: tyre.spun, tyreColor: tyre.color, tyreRough: tyre.rough, paletteColor: palette.color, paletteOrm: palette.orm, cover, markFront, markRear,
  };
}

function buildGeometry(tier, front) {
  const detail = DETAIL[tier];
  const lip = front ? WHEEL.lip.front : WHEEL.lip.rear;
  return { tyre: buildTyre(detail, front ? TYRES.front : TYRES.rear, lip), fixed: buildStatic(detail, front), spokes: buildSpokes(detail, lip), shell: buildShell(detail, lip) };
}

/**
 * @typedef {object} WheelModel
 * @property {THREE.Group} object origin at the wheel's centre, the axle along its X; the car puts it at the hub
 * @property {(pose: { steer?: number, spin?: number, travel?: number, omega?: number }) => void} setPose steer
 *   about the vertical (left is positive), spin about the axle (rolling forward is positive), travel up from rest
 *   (m), and the wheel's speed of rotation (rad/s), which decides how smeared the spokes and the tread are
 * @property {(reflections: { cube: THREE.Texture|null, sky: number }) => void} setReflections as CarModel's
 * @property {THREE.Material[]} materials every material of this wheel (each has an onBeforeCompile of its own or
 *   none: wrap it, do not replace it)
 * @property {number} triangles drawn when the wheel stands still
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {boolean} options.front a front wheel (225/40 R19, the larger disc, the caliper ahead of the axle)
 *   or a rear one (255/35 R19, the caliper behind)
 * @param {boolean} options.left on the car's left (its outer face looks to +X) or its right (to -X)
 * @param {'low'|'medium'|'high'} [options.tier]
 * @param {import('../../engine/caps.js').Caps} [options.caps]
 * @returns {WheelModel}
 */
export function createWheel({ front, left, tier = 'high', caps = null }) {
  const tierName = DETAIL[tier] ? tier : 'high';
  const detail = DETAIL[tierName];
  const textureKey = `textures:${tierName}`;
  const geometryKey = `geometry:${tierName}:${front ? 'front' : 'rear'}`;
  const textures = acquire(textureKey, () => buildTextures(tierName, caps));
  const geometry = acquire(geometryKey, () => buildGeometry(tierName, front));

  // ---- materials: the tyre, the spokes and the shells are this wheel's own (each wheel turns at its own speed)
  const tyreOptions = { map: textures.tyreColor, roughnessMap: textures.tyreRough, normalMap: textures.tyreNormal, metalness: 0 };
  const tyreMaterial = detail.physical
    ? new THREE.MeshPhysicalMaterial({ ...tyreOptions, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.05, 0.05, 0.052), specularIntensity: 0.6 })
    : new THREE.MeshStandardMaterial(tyreOptions);
  tyreMaterial.userData.uniforms = {
    uSpunMap: { value: textures.tyreSpun },
    uSpun: { value: 0 },
    uMarkMap: { value: front ? textures.markFront : textures.markRear },
  };

  // Always in the blended pass, at full opacity while the car stands: switching a material between the two
  // passes while the run is on would compile a second shader for it.
  const spokeOptions = { map: textures.paletteColor, roughnessMap: textures.paletteOrm, metalnessMap: textures.paletteOrm, transparent: true };
  const spokeMaterial = detail.physical ? new THREE.MeshPhysicalMaterial({ ...spokeOptions, clearcoat: 1, clearcoatRoughness: 0.05 }) : new THREE.MeshStandardMaterial(spokeOptions);

  const fixedMaterial = new THREE.MeshStandardMaterial({ map: textures.paletteColor, roughnessMap: textures.paletteOrm, metalnessMap: textures.paletteOrm });
  const shellMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 });
  const coverLevels = textures.cover.mipmaps.length;
  shellMaterial.userData.uniforms = {
    uCover: { value: textures.cover },
    uCoverInfo: { value: new THREE.Vector4(detail.cover[1], coverLevels - 1, SHELL.radius, WHEEL.cap) },
    uBlur: { value: 0 },
    uRipple: { value: 1 },
  };

  // every material mirrors the car's own reflection probe, as the body does (materials.js); the parts deep in the
  // wheel see only a share of it
  const reflections = probeUniforms();
  const compile = (material, name, own, options) => {
    material.defines = { ...(material.defines || {}), ...(caps ? targetDefines(caps) : {}) };
    material.customProgramCacheKey = () => `wheel ${name} ${tierName}`;
    material.onBeforeCompile = (shader) => {
      if (own) own.call(material, shader);
      mirrorProbe(shader, reflections, options);
    };
  };
  const marked = !!textures.markFront;
  compile(tyreMaterial, marked ? 'tyre marked' : 'tyre', marked ? patchTyreMarked : patchTyre);
  compile(spokeMaterial, 'spokes', detail.physical ? patchSpokes : null, { coat: detail.physical });
  compile(fixedMaterial, 'fixed', null, { seen: INNER_SKY });
  compile(shellMaterial, 'shell', patchShell);

  // ---- the corner: rides up and down > steers > (what stays | what spins)
  const object = new THREE.Group();
  const corner = new THREE.Group();
  const knuckle = new THREE.Group();
  const spinner = new THREE.Group();
  // The wheel is built with its outer face to +X. A right wheel is the same wheel turned round, as on the car;
  // its brake is the left one's mirror image (the caliper stays ahead of, or behind, the axle).
  const turned = new THREE.Group();
  if (!left) turned.rotation.y = Math.PI;
  const fixed = new THREE.Mesh(geometry.fixed, fixedMaterial);
  // the plan is an 18-inch wheel's: grown in its own plane to the car's 19 inches (the tyre is built to size)
  fixed.scale.set(left ? 1 : -1, RIM_SCALE, RIM_SCALE);
  const tyreMesh = new THREE.Mesh(geometry.tyre, tyreMaterial);
  const spokes = new THREE.Mesh(geometry.spokes, spokeMaterial);
  const shell = new THREE.Mesh(geometry.shell, shellMaterial);
  spokes.scale.set(1, RIM_SCALE, RIM_SCALE);
  shell.scale.set(1, RIM_SCALE, RIM_SCALE);
  fixed.castShadow = tyreMesh.castShadow = true;
  fixed.receiveShadow = tyreMesh.receiveShadow = spokes.receiveShadow = shell.receiveShadow = true;
  // Both are blended and both write depth. They are drawn before every other blended thing (glass, smoke), which
  // then sorts itself against them by depth; of the two the spokes come first, being the older object.
  spokes.renderOrder = shell.renderOrder = -1;
  shell.visible = false;
  object.add(corner.add(knuckle.add(fixed, spinner.add(turned.add(tyreMesh, spokes, shell)))));

  const materials = [tyreMaterial, fixedMaterial, spokeMaterial, shellMaterial];
  const count = (g) => g.index.count / 3;
  let lastOmega = -1;

  return {
    object,
    materials,
    triangles: count(geometry.tyre) + count(geometry.fixed) + count(geometry.spokes),

    setPose({ steer = 0, spin = 0, travel = 0, omega = 0 }) {
      corner.position.y = travel;
      knuckle.rotation.y = steer;
      spinner.rotation.x = spin;
      const speed = Math.abs(omega);
      if (speed === lastOmega) return;
      lastOmega = speed;
      const shellIn = smoothstep(FADE.shellIn[0], FADE.shellIn[1], speed);
      const spokesIn = 1 - smoothstep(FADE.spokesOut[0], FADE.spokesOut[1], speed);
      shell.visible = shellIn > 0;
      spokes.visible = spokesIn > 0;
      shellMaterial.opacity = shellIn;
      spokeMaterial.opacity = spokesIn;
      // the arc swept while the shutter is open, in steps from one pair to the next
      const blur = Math.min(1, (speed * SHUTTER) / (TAU / WHEEL.pairs));
      shellMaterial.userData.uniforms.uBlur.value = blur;
      shellMaterial.userData.uniforms.uRipple.value = 1 - smoothstep(0.85, 1, blur);
      tyreMaterial.userData.uniforms.uSpun.value = smoothstep(FADE.tread[0], FADE.tread[1], speed);
    },

    setReflections({ cube, sky, exposure, proxy = null }) {
      if (exposure) reflections.carKey.value = PAPER / exposure;
      copyProxy(reflections, proxy);
      reflections.carProbe.value = cube || null;
      reflections.carProbeOn.value = cube ? 1 : 0;
      reflections.carSky.value = sky;
    },

    dispose() {
      tyreMaterial.dispose();
      fixedMaterial.dispose();
      spokeMaterial.dispose();
      shellMaterial.dispose();
      release(textureKey);
      release(geometryKey);
    },
  };
}
