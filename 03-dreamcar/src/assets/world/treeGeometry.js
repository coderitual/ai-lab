// The trees' shapes: each variant of treeSpecies.js is GROWN once at start-up
// into a skeleton, and the skeleton is turned into two meshes.
//
// GROWING. A conifer is a trunk (tapering, wandering a little, flared at the
// foot) with whorls of branches whose length follows the species' crown
// profile; each branch leaves the trunk at an angle that goes from hanging low
// in the crown to rising at its top, sags with its length and lifts its tip;
// under the crown stand the dead stubs of branches the shade has killed. A
// broadleaf is a trunk that divides: limbs fork and send side shoots, each
// child shorter and thinner than its parent, turning towards the light and
// wandering, and none leaves the ellipsoid that is the crown's outline; the
// last limbs carry the leaves.
//
// MESHES, from the same skeleton so that one can stand in for the other:
//   full     the trunk and every limb as a tube of bark; on a conifer's branch
//            a row of side fronds, a frond at the tip and (spruce) curtains of
//            twigs hanging under it; on a broadleaf's last limbs a handful of
//            leaf-cluster cards each, turned every way so the crown has leaves
//            towards any eye. A few thousand triangles.
//   reduced  the trunk and the main limbs with fewer sides, one bent card for
//            a conifer's whole bough, one or two large cards for all the
//            leaves of a last limb. A few hundred triangles. Also what casts
//            the shadow and what the wet road mirrors.
//
// WHAT A VERTEX CARRIES besides its place:
//   normal   bark: the tube's own. Foliage: NOT the card's: the direction out
//            of the crown at that point (from the trunk's axis and up, or from
//            the middle of a broadleaf's crown), so the crown is lit as one
//            soft body and not as a pile of flat cards.
//   uv       foliage: into the foliage atlas. Bark: u across one bark tile
//            (once round the limb), v along it in repeats.
//   aShade   x how much light gets in (dark inside the crown and low down,
//            light at the tips); y what it is: 0 foliage (takes the tree's
//            tint), 0.5 dead twig (atlas, own colour), 1 bark; z where on the
//            old-to-new (or green-to-red) scale its colour lies; w how much
//            light comes through it from behind.
//   aWind    x how far it moves when its branch swings (m at full gust), y the
//            branch's phase, z how much it flutters (leaf and frond tips).

import * as THREE from 'three';
import { barkSpan, tileRect } from './forestTextures.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Some unit vector square to `a` (unit). */
const square = (a) => norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));
/** `v` turned about the unit axis `k` by `angle`. */
const turn = (v, k, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
};
/** A point of a polyline, `u` 0..1 along its points (by index, not by length). */
const along = (pts, u) => {
  const f = clamp01(u) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const t = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), lerp(pts[i][2], pts[i + 1][2], t)];
};
const tangentAt = (pts, u) => norm(sub(along(pts, Math.min(1, u + 0.08)), along(pts, Math.max(0, u - 0.08))));

/** The most a vertex's branch sway can be (m): aWind.x is stored as a share of it. */
export const SWAY_MAX = 0.6;

class Builder {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.shade = [];
    this.wind = [];
    this.index = [];
  }

  /** @returns {number} the vertex's index */
  vertex(p, n, u, v, shade, wind) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.shade.push(shade[0], shade[1], shade[2], shade[3]);
    this.wind.push(wind[0] / SWAY_MAX, wind[1], wind[2], 0);
    return this.p.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.index.push(a, b, c, a, c, d);
  }

  get triangles() {
    return this.index.length / 3;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    const bytes = (list, signed) => {
      const out = signed ? new Int8Array(list.length) : new Uint8Array(list.length);
      for (let i = 0; i < list.length; i++) out[i] = signed ? Math.round(Math.max(-1, Math.min(1, list[i])) * 127) : Math.round(clamp01(list[i]) * 255);
      return out;
    };
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(bytes(this.n, true), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aShade', new THREE.BufferAttribute(bytes(this.shade, false), 4, true));
    g.setAttribute('aWind', new THREE.BufferAttribute(bytes(this.wind, false), 4, true));
    g.setIndex(this.index);
    return g;
  }

  /** The widest reach from the y axis and the top, for the bounds and the impostor's frame. */
  bounds() {
    let radius = 0;
    let top = 0;
    for (let i = 0; i < this.p.length; i += 3) {
      radius = Math.max(radius, Math.hypot(this.p[i], this.p[i + 2]));
      top = Math.max(top, this.p[i + 1]);
    }
    return { radius, top };
  }
}

/**
 * A tube of bark along a polyline.
 * @param {Builder} b @param {number[][]} pts @param {number[]} radii
 * @param {object} o sides; bark: tile; barkSize: texels of a tile; run: metres of limb per repeat of the bark;
 *   ao(i): light at point i; sway(i): [m, phase]; lobe(i, angle): radius multiplier (the flare of the foot)
 */
function tube(b, pts, radii, o) {
  const [u0, u1] = barkSpan(o.bark, o.barkSize);
  const rings = [];
  let side = null;
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    // the ring's frame is carried along the limb, so the bark does not twist
    side = side ? norm(sub(side, scale(t, dot(side, t)))) : square(t);
    const other = cross(t, side);
    if (i > 0) run += length(sub(pts[i], pts[i - 1]));
    const [sway, phase] = o.sway ? o.sway(i) : [0, 0];
    const ring = [];
    for (let k = 0; k <= o.sides; k++) {
      const a = (k / o.sides) * Math.PI * 2;
      const d = add(scale(side, Math.cos(a)), scale(other, Math.sin(a)));
      const r = radii[i] * (o.lobe ? o.lobe(i, a) : 1);
      ring.push(b.vertex(mad(pts[i], d, r), d, lerp(u0, u1, k / o.sides), run / o.run, [o.ao(i), 1, 0.5, 0], [sway, phase, 0]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < o.sides; k++) b.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
}

/**
 * A card along a centre line, picturing a FAN tile (its stem along the line).
 * @param {Builder} b
 * @param {object} o pts: the centre line; across: unit vector across the card (or one per point); width; tile;
 *   fold: how far the two edges hang below the centre line, as a share of the half width (0: flat, two triangles
 *   per step); normalAt(p); ao: [base, tip]; kind; hue: [base, tip]; through; sway: [base, tip]; phase; flutter
 */
function ribbon(b, o) {
  const [u0, v0, u1, v1] = tileRect(o.tile);
  const n = o.pts.length;
  const rows = [];
  for (let j = 0; j < n; j++) {
    const s = j / (n - 1);
    const c = o.pts[j];
    const across = Array.isArray(o.across[0]) ? o.across[j] : o.across;
    const dir = norm(sub(o.pts[Math.min(n - 1, j + 1)], o.pts[Math.max(0, j - 1)]));
    // the side of the card that faces the sky
    let face = cross(across, dir);
    if (face[1] < 0) face = scale(face, -1);
    const half = o.width * 0.5;
    const u = lerp(u0, u1, s);
    const ao = lerp(o.ao[0], o.ao[1], s);
    const hue = lerp(o.hue[0], o.hue[1], s);
    const sway = lerp(o.sway[0], o.sway[1], s);
    const row = [];
    const columns = o.fold ? [-1, 0, 1] : [-1, 1];
    for (const k of columns) {
      const p = add(mad(c, across, half * k), scale(face, k ? -o.fold * half : 0));
      row.push(
        b.vertex(p, o.normalAt(p), u, k < 0 ? v0 : k > 0 ? v1 : (v0 + v1) / 2, [ao * (k ? 0.94 : 1), o.kind ?? 0, hue, o.through], [sway, o.phase, o.flutter * (k ? 0.4 + 0.6 * s : s)]),
      );
    }
    rows.push(row);
  }
  for (let j = 0; j < n - 1; j++) for (let k = 0; k < rows[j].length - 1; k++) b.quad(rows[j][k], rows[j + 1][k], rows[j + 1][k + 1], rows[j][k + 1]);
}

/** The centre line of a frond that starts at `base` towards `dir` and bends down by `droop` rad over its length. */
function frondLine(base, dir, len, steps, droop) {
  // the direction square to `dir` that points most nearly down
  const down = norm(sub([0, -1, 0], scale(dir, -dir[1])));
  const pts = [base];
  let p = base;
  for (let j = 0; j < steps; j++) {
    const a = droop * ((j + 0.5) / steps);
    p = mad(p, norm(add(scale(dir, Math.cos(a)), scale(down, Math.sin(a)))), len / steps);
    pts.push(p);
  }
  return pts;
}

/**
 * A card that hangs: its top edge from `a` to `c`, picturing a HANG tile (or a FAN tile turned to hang when
 * `fan` is set: its stem then runs down the middle).
 */
function curtain(b, o) {
  const [u0, v0, u1, v1] = tileRect(o.tile);
  const lean = o.lean ?? [0, -1, 0];
  const corners = [
    [o.a, 0, 0],
    [o.c, 1, 0],
    [mad(o.c, lean, o.drop), 1, 1],
    [mad(o.a, lean, o.drop), 0, 1],
  ];
  const ids = corners.map(([p, s, t]) => {
    // a FAN tile hung up: its u runs down the card, its v across
    const u = o.fan ? lerp(u0, u1, t) : lerp(u0, u1, s);
    const v = o.fan ? lerp(v0, v1, s) : lerp(v0, v1, t);
    const sway = lerp(o.sway[0], o.sway[1], s) + 0.02 * t;
    return b.vertex(p, o.normalAt(p), u, v, [lerp(o.ao[0], o.ao[1], t), o.kind ?? 0, lerp(o.hue[0], o.hue[1], t), o.through], [sway, o.phase, o.flutter * t]);
  });
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

// ------------------------------------------------------------------------------------------------ conifers

/** The skeleton of a conifer: the trunk's axis and radius, and its branches as centre lines. */
function coniferSkeleton(P, rng) {
  const H = P.H;
  const ph = [0, 1, 2, 3].map(() => rng.range(0, Math.PI * 2));
  const axis = (y) => {
    const t = clamp01(y / H);
    const w = t * (1 - 0.4 * t);
    const x = Math.sin(1.4 * Math.PI * t + ph[0]) * w + 0.3 * Math.sin(4.2 * Math.PI * t + ph[1]) * t * (1 - t);
    const z = Math.cos(1.2 * Math.PI * t + ph[2]) * w + 0.3 * Math.sin(3.6 * Math.PI * t + ph[3]) * t * (1 - t);
    return [P.bend * x, y, P.bend * z];
  };
  const radius = (y) => Math.max(0.012, P.trunkR * Math.pow(Math.max(0, 1 - y / H), 0.9)) * (1 + 0.5 * Math.exp(-Math.max(0, y) / 0.4));
  const yBase = H * P.crownBase;
  /** How far the crown reaches from the trunk at height y (m): for the shading. */
  const reach = (y) => P.R * Math.pow(clamp01(1 - (y - yBase) / (H - yBase)), P.power) + 0.5;

  const POINTS = 5;
  const branch = ({ y, az, L, t, elev, sag, upturn, dead }) => {
    const a = axis(y);
    const r0 = radius(y);
    const hx = Math.cos(az);
    const hz = Math.sin(az);
    const pts = [];
    for (let j = 0; j < POINTS; j++) {
      const u = j / (POINTS - 1);
      const out = r0 * 0.5 + L * u * Math.cos(elev);
      const up = L * (Math.sin(elev) * u - sag * u * u + upturn * u * u * u);
      pts.push([a[0] + hx * out, y + up, a[2] + hz * out]);
    }
    const thick = Math.min(r0 * 0.45, 0.012 + 0.013 * L);
    const radii = pts.map((_, j) => lerp(thick, 0.006, Math.pow(j / (POINTS - 1), 0.8)));
    return { pts, radii, L, t, az, dead: !!dead, phase: rng.next(), seed: rng.int(1 << 30) };
  };

  const branches = [];
  let az = rng.range(0, Math.PI * 2);
  const lopTo = rng.range(0, Math.PI * 2);
  for (let w = 0; w < P.whorls; w++) {
    const t = w / (P.whorls - 1);
    const y = yBase + (H * 0.965 - yBase) * Math.pow(t, 0.94);
    const per = t > 0.88 ? 3 : P.per[0] + rng.int(P.per[1] - P.per[0] + 1);
    for (let k = 0; k < per; k++) {
      az += (Math.PI * 2) / per + rng.range(-0.3, 0.3);
      const missing = rng.next() < P.gaps && t < 0.85;
      const profile = Math.pow(1 - t, P.power) * (0.72 + 0.28 * smooth(0, 0.14, t));
      const L = (P.R * profile + 0.32) * rng.range(0.8, 1.12) * (1 + P.lop * Math.cos(az - lopTo));
      const b = branch({
        y: y + rng.range(-0.14, 0.14),
        az,
        L,
        t,
        elev: lerp(P.elevBase, P.elevTop, Math.pow(t, 1.4)) + rng.range(-0.08, 0.08),
        sag: P.sag * (1 - 0.55 * t) * rng.range(0.8, 1.2),
        upturn: P.upturn,
      });
      if (!missing) branches.push(b);
    }
    az += 2.39996; // the next whorl turned by the golden angle
  }
  for (let k = 0; k < P.dead; k++) {
    branches.push(
      branch({ y: rng.range(Math.min(2.4, yBase * 0.45), Math.max(2.6, yBase)), az: rng.range(0, Math.PI * 2), L: rng.range(0.6, 1.7), t: 0, elev: rng.range(-0.4, 0.05), sag: 0.2, upturn: 0, dead: true }),
    );
  }
  return { H, axis, radius, reach, yBase, branches, footPhase: rng.range(0, Math.PI * 2) };
}

/**
 * @param {object} variant of treeSpecies.js @param {ReturnType<typeof coniferSkeleton>} sk
 * @param {import('../../engine/rng.js').Rng} rng @param {boolean} full @param {number} barkSize
 * @param {number} through the species' translucency
 */
function coniferMesh(variant, sk, rng, full, barkSize, through) {
  const P = variant.P;
  const b = new Builder();
  const { H, axis, radius, reach, yBase } = sk;
  const share = (y) => clamp01((y - yBase) / (H - yBase));
  const normalAt = (p) => {
    const a = axis(p[1]);
    const dx = p[0] - a[0];
    const dz = p[2] - a[2];
    const r = Math.hypot(dx, dz) || 1;
    // out from the trunk and up, more up towards the top of the tree
    return norm([dx / r, 0.3 + 0.55 * share(p[1]), dz / r]);
  };
  /** Dark at the trunk and under the crown, light at the tips and high up. */
  const aoAt = (p) => {
    const a = axis(p[1]);
    const r = Math.hypot(p[0] - a[0], p[2] - a[2]) / reach(p[1]);
    return clamp01(0.3 + 0.75 * Math.pow(clamp01(r), 0.8)) * (0.68 + 0.32 * share(p[1]));
  };

  // the trunk: close rings at the flared foot, then every few metres
  const ys = full ? [-0.4, 0, 0.15, 0.4, 0.9, 1.8] : [-0.4, 0.1, 0.9];
  const rings = full ? 9 : 4;
  for (let k = 1; k <= rings; k++) ys.push(lerp(ys[full ? 5 : 2], H * 0.985, Math.pow(k / rings, 0.9)));
  tube(
    b,
    ys.map(axis),
    ys.map(radius),
    {
      sides: full ? 8 : 5,
      bark: variant.bark,
      barkSize,
      run: 2 * Math.PI * P.trunkR,
      ao: (i) => lerp(0.92, 0.55, smooth(yBase * 0.6, yBase + 2, ys[i])),
      lobe: (i, a) => 1 + 0.2 * Math.exp(-Math.max(0, ys[i]) / 0.3) * Math.cos(5 * a + sk.footPhase),
    },
  );

  for (const br of sk.branches) {
    const r = rng.fork(`b${br.seed}`);
    const { pts, L, t } = br;
    const swayAt = (u) => Math.pow(u, 1.5) * L * 0.05;
    if (br.dead) {
      // a dead stub: bare wood and a few twigs, no needles
      if (full) tube(b, [pts[0], pts[2], pts[4]], [br.radii[0] * 0.8, br.radii[2] * 0.7, 0.008], { sides: 3, bark: variant.bark, barkSize, run: 0.5, ao: () => 0.8, sway: (i) => [swayAt(i / 2) * 0.4, br.phase] });
      if (full || r.next() < 0.5) {
        const line = [along(pts, 0.35), along(pts, 1), mad(along(pts, 1), tangentAt(pts, 1), L * 0.25)];
        ribbon(b, { pts: line, across: square(tangentAt(pts, 0.6)), width: L * 0.7, tile: 7, fold: 0, normalAt, ao: [0.75, 0.9], kind: 0.5, hue: [0.5, 0.5], through: 0, sway: [0, swayAt(1) * 0.4], phase: br.phase, flutter: 0.3 });
      }
      continue;
    }
    const side = norm(cross(tangentAt(pts, 0.5), [0, 1, 0]));
    const scaleL = Math.min(1, L / 1.9 + 0.3);
    const tipDir = tangentAt(pts, 1);
    const tip = pts[pts.length - 1];
    const hue = (u) => 0.3 + 0.45 * u;

    {
      // the whole bough as one bent card with its edges hanging, wide enough for its side fronds (on the full tree,
      // too, under its fronds: the mass of the bough, which the fronds alone are too fine to give)
      const line = [along(pts, 0.06), along(pts, 0.55), mad(tip, tipDir, P.frond * 0.55 * scaleL)];
      const big = L > 1.3;
      ribbon(b, {
        pts: big ? line : [line[0], line[2]],
        across: side,
        width: Math.min(L * 1.15, P.frond * 1.55 * scaleL + 0.3),
        tile: variant.tile,
        fold: big ? 0.42 : 0,
        normalAt,
        ao: [aoAt(line[0]), aoAt(line[2])],
        hue: [hue(0), hue(1)],
        through,
        sway: [0, swayAt(1)],
        phase: br.phase,
        flutter: 1,
      });
      if (!full && P.curtain > 0 && L > 1.5) {
        const drop = P.curtain * (0.55 + 0.45 * (1 - t)) * Math.min(1, L / 2.5);
        const a = along(pts, 0.3);
        curtain(b, { a, c: tip, drop, lean: norm([Math.cos(br.az) * 0.12, -1, Math.sin(br.az) * 0.12]), tile: variant.hangTile, normalAt, ao: [aoAt(a) * 0.9, aoAt(tip) * 0.7], hue: [0.35, 0.6], through, sway: [swayAt(0.3), swayAt(1)], phase: br.phase, flutter: 1 });
      }
      if (!full) continue;
    }

    // the branch's own wood
    if (L > 0.9) tube(b, pts, br.radii, { sides: 3, bark: variant.bark, barkSize, run: 0.6, ao: (i) => 0.5 + 0.1 * i, sway: (i) => [swayAt(i / (pts.length - 1)), br.phase] });
    // side fronds, left and right in turn, swept forward and hanging a little
    const count = Math.max(1, Math.min(5, Math.round(L / 0.62)));
    for (let k = 0; k < count; k++) {
      const u = 0.26 + (0.68 * (k + 0.5)) / count;
      const base = along(pts, u);
      const tan = tangentAt(pts, u);
      const hand = (k + (br.seed & 1)) % 2 ? 1 : -1;
      const sweep = r.range(0.75, 1.1);
      const pitch = P.droopFronds ? r.range(0.5, 1.1) : r.range(0.08, 0.5);
      const dir = norm(add(add(scale(tan, Math.cos(sweep)), scale(side, hand * Math.sin(sweep))), [0, -pitch, 0]));
      const len = P.frond * (0.62 + 0.45 * (1 - u)) * r.range(0.85, 1.15) * scaleL;
      const line = frondLine(base, dir, len, 2, 0.45);
      const across = turn(norm(cross(dir, [0, 1, 0])), dir, r.range(-0.6, 0.6));
      const end = line[line.length - 1];
      ribbon(b, { pts: line, across, width: len * 0.74, tile: variant.tile, fold: 0.22, normalAt, ao: [aoAt(base), aoAt(end)], hue: [hue(u) - 0.1, hue(u) + 0.25], through, sway: [swayAt(u), swayAt(u) + 0.03], phase: br.phase, flutter: 1 });
    }
    // the frond at the tip
    {
      const len = P.frond * 0.95 * scaleL;
      const line = frondLine(along(pts, 0.88), tipDir, len, 2, 0.3);
      ribbon(b, { pts: line, across: side, width: len * 0.76, tile: variant.tile, fold: 0.25, normalAt, ao: [aoAt(line[0]), aoAt(line[2])], hue: [0.5, 0.95], through, sway: [swayAt(0.88), swayAt(1) + 0.03], phase: br.phase, flutter: 1 });
    }
    // what hangs under the bough: curtains of twigs (spruce), in two runs that follow its curve
    if (P.curtain > 0 && L > 1.2) {
      const drop = P.curtain * (0.55 + 0.45 * (1 - t)) * Math.min(1, L / 2.5);
      const lean = norm([Math.cos(br.az) * 0.12, -1, Math.sin(br.az) * 0.12]);
      for (const [ua, uc] of [
        [0.28, 0.64],
        [0.64, 1],
      ]) {
        const a = along(pts, ua);
        const c = along(pts, uc);
        curtain(b, { a, c, drop: drop * r.range(0.75, 1.1), lean, tile: variant.hangTile, normalAt, ao: [aoAt(a) * 0.9, aoAt(c) * 0.72], hue: [0.35, 0.65], through, sway: [swayAt(ua), swayAt(uc)], phase: br.phase, flutter: 1 });
      }
    }
  }

  // the leader: two crossed fronds standing on the top
  {
    const top = axis(H * 0.9);
    const len = H * 0.115;
    for (const across of [
      [1, 0, 0],
      [0, 0, 1],
    ]) {
      ribbon(b, { pts: [top, mad(top, [0, 1, 0], len * 0.5), mad(top, [0, 1, 0], len)], across, width: len * 0.5, tile: variant.tile, fold: 0, normalAt: (p) => norm([p[0] - top[0], 0.8, p[2] - top[2]]), ao: [0.8, 1], hue: [0.6, 0.95], through, sway: [0, 0.02], phase: 0.5, flutter: 0.6 });
    }
  }
  return b;
}

// ------------------------------------------------------------------------------------------------ broadleaves

/** The skeleton of a broadleaf: its limbs (the trunk is the first), and the leaf clusters the last ones carry. */
function broadleafSkeleton(P, rng) {
  const H = P.H;
  const c = [0, H * P.crown.cy, 0];
  const rx = P.crown.rx;
  const ry = H * P.crown.ry;
  /** < 1 inside the crown's outline. */
  const inside = (p) => ((p[0] - c[0]) / rx) ** 2 + ((p[1] - c[1]) / ry) ** 2 + ((p[2] - c[2]) / rx) ** 2;
  const limbs = [];
  const FLEX = [0, 0.012, 0.026, 0.045, 0.06];
  let shootTurn = rng.range(0, Math.PI * 2);

  /**
   * One limb and everything that grows from it.
   * @param {number[]} start @param {number[]} dir @param {number} len @param {number} r0 radius at its start
   * @param {number} level 0: the trunk @param {number} phase its sway phase @param {number} sway0 how far its
   *   start already moves with its parents (m)
   */
  function limb(start, dir, len, r0, level, phase, sway0) {
    const steps = level === 0 ? 4 : 3;
    const pts = [start];
    let d = dir;
    let p = start;
    let grown = 0;
    for (let j = 0; j < steps; j++) {
      const w = P.gnarl * (level === 0 ? 0.3 : 1);
      // it wanders, and turns towards the light (or, with a negative `up`, hangs)
      d = norm([d[0] + rng.range(-w, w), d[1] + rng.range(-w, w) * 0.5 + P.up[level] / steps, d[2] + rng.range(-w, w)]);
      let step = len / steps;
      let q = mad(p, d, step);
      if (level > 0 && inside(q) > 1) {
        // it would leave the crown's outline: it stops at it
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) / 2;
          if (inside(mad(p, d, step * mid)) > 1) hi = mid;
          else lo = mid;
        }
        step *= lo;
        if (step < 0.15) break;
        q = mad(p, d, step);
        grown += step;
        p = q;
        pts.push(p);
        break;
      }
      grown += step;
      p = q;
      pts.push(p);
    }
    if (pts.length < 2) return;
    const last = level >= P.levels;
    const rEnd = last ? 0.008 : r0 * (level === 0 ? 0.72 : 0.6);
    const radii = pts.map((_, j) => lerp(r0, rEnd, j / (pts.length - 1)));
    if (level === 0) radii[0] = r0 * 1.5; // the flare of the foot
    const flex = FLEX[Math.min(level, FLEX.length - 1)];
    const me = { pts, radii, level, phase, sway0, sway1: sway0 + flex * grown, len: grown, last, clusters: [] };
    limbs.push(me);
    const swayAt = (u) => lerp(me.sway0, me.sway1, u);

    if (!last) {
      const end = pts[pts.length - 1];
      const endDir = norm(sub(end, pts[pts.length - 2]));
      const e1 = square(endDir);
      const e2 = cross(endDir, e1);
      const n = P.forks[level];
      const around = rng.range(0, Math.PI * 2);
      const lead = rng.next() < P.leader[level];
      for (let k = 0; k < n; k++) {
        const isLead = lead && k === 0;
        const spread = isLead ? rng.range(0.04, 0.2) : P.spread[level] * rng.range(0.75, 1.25);
        const a = around + (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const cd = norm(add(scale(endDir, Math.cos(spread)), scale(add(scale(e1, Math.cos(a)), scale(e2, Math.sin(a))), Math.sin(spread))));
        const cl = len * P.ratio[level] * rng.range(0.82, 1.18) * (isLead ? 1.15 : P.side);
        // a parent's cross-section is shared out among its children; the one that carries on keeps the most
        const cr = rEnd * (isLead ? 0.92 : lead ? 0.5 : Math.pow(1 / n, 0.42));
        limb(end, cd, cl, cr, level + 1, level === 0 ? rng.next() : phase + rng.range(-0.08, 0.08), swayAt(1));
      }
      // side shoots part-way along: a leader's whorl-less branches, and what keeps the inside of a crown from being bare
      const shoots = P.shoots?.[level] ?? 0;
      for (let k = 0; k < shoots; k++) {
        const u = 0.25 + (0.65 * (k + rng.range(0.2, 0.8))) / shoots;
        const at = along(pts, u);
        const tan = tangentAt(pts, u);
        const s1 = square(tan);
        const s2 = cross(tan, s1);
        shootTurn += 2.39996;
        const spread = P.spread[level] * rng.range(0.85, 1.25);
        const cd = norm(add(scale(tan, Math.cos(spread)), scale(add(scale(s1, Math.cos(shootTurn)), scale(s2, Math.sin(shootTurn))), Math.sin(spread))));
        limb(at, cd, len * P.ratio[level] * P.side * (1 - 0.35 * u) * rng.range(0.85, 1.2), lerp(r0, rEnd, u) * 0.45, level + 1, level === 0 ? rng.next() : phase + rng.range(-0.08, 0.08), swayAt(u));
      }
    }

    // leaves: on the last limbs, and a few on the outer part of the ones before
    if (level >= P.levels - 1 && level > 0) {
      const count = last ? P.clusters : Math.round(P.clusters / 3);
      for (let k = 0; k < count; k++) {
        const u = last ? 0.3 + 0.7 * Math.pow((k + rng.next()) / count, 0.8) : rng.range(0.45, 1);
        // a leaf mass, not a row: clusters stand round the limb in a clump of their own (P.clump m), more of them
        // towards its end
        const r = (P.clump ?? 0) * Math.sqrt(rng.next()) * (0.5 + 0.5 * u);
        const off = norm([rng.range(-1, 1), rng.range(-0.6, 1), rng.range(-1, 1)]);
        const at = mad(along(pts, u), off, r);
        // where in its own clump it sits: each clump is a small dome, lit on top, darker underneath
        const dome = (P.clump ?? 0) > 0 ? off[1] * (r / P.clump) : 0;
        const tan = tangentAt(pts, u);
        const out = norm(sub(at, c));
        // a cluster leans away from its limb, out of the crown and a little up
        const dir0 = turn(tan, square(tan), rng.range(0.3, 1.2));
        const dir = norm(add(add(turn(dir0, tan, rng.range(0, Math.PI * 2)), scale(out, 0.55)), [0, 0.15, 0]));
        me.clusters.push({ at, dir, dome, clumpN: off, size: rng.range(P.leaf[0], P.leaf[1]), roll: rng.range(-1.2, 1.2), hue: rng.next(), sway: swayAt(u), spin: rng.range(0, Math.PI) });
      }
    }
  }

  // the trunk leans and wanders a little on its way to the first fork
  const lean = rng.range(0, Math.PI * 2);
  const tilt = (P.bend / (H * P.fork + 0.4)) * 0.5;
  limb([0, -0.4, 0], norm([Math.cos(lean) * tilt, 1, Math.sin(lean) * tilt]), H * P.fork + 0.4, P.trunkR, 0, 0, 0);
  return { H, c, rx, ry, limbs, footPhase: rng.range(0, Math.PI * 2) };
}

/** @see coniferMesh */
function broadleafMesh(variant, sk, rng, full, barkSize, through) {
  const P = variant.P;
  const b = new Builder();
  const { c, rx, ry } = sk;
  /** 0 at the crown's middle, 1 on its outline. */
  const depth = (p) => Math.sqrt(((p[0] - c[0]) / rx) ** 2 + ((p[1] - c[1]) / ry) ** 2 + ((p[2] - c[2]) / rx) ** 2);
  const normalAt = (p) => norm([(p[0] - c[0]) / (rx * rx), (p[1] - c[1]) / (ry * ry) + 0.035, (p[2] - c[2]) / (rx * rx)]);
  /** Dark in the middle of the crown and on its underside, light on its outside and top. */
  const aoAt = (p) => (0.18 + 0.82 * Math.pow(smooth(0.35, 1.02, depth(p)), 1.4)) * (0.55 + 0.45 * smooth(-0.8, 0.45, (p[1] - c[1]) / ry));
  const sides = full ? [8, 6, 4, 3, 3] : [6, 4, 3, 3, 3];

  for (const limb of sk.limbs) {
    const { pts, radii, level } = limb;
    const u = (i) => i / (pts.length - 1);
    // the reduced tree keeps the trunk, the main limbs and whatever of the rest is thick enough to be seen
    const wood = full || level <= 1 || (level === 2 && radii[0] > 0.03);
    if (wood) {
      const lobe = level === 0 ? (i, a) => 1 + (i === 0 ? 0.16 : 0) * Math.cos(4 * a + sk.footPhase) : null;
      tube(b, full || pts.length < 4 ? pts : [pts[0], pts[2], pts[pts.length - 1]], full || pts.length < 4 ? radii : [radii[0], radii[2], radii[radii.length - 1]], {
        sides: sides[level],
        bark: variant.bark,
        barkSize,
        run: Math.max(0.35, 2 * Math.PI * radii[0]),
        // limbs inside the crown are in its shade: they read dark against the leaves
        ao: (i) => (level === 0 ? lerp(0.95, 0.7, u(i)) : 0.4 + 0.3 * smooth(0.5, 1, depth(pts[Math.min(pts.length - 1, i)]))),
        sway: (i) => [lerp(limb.sway0, limb.sway1, u(i)), limb.phase],
        lobe,
      });
    }
    if (!limb.clusters.length) continue;
    const r = rng.fork(`l${limbs_id(limb, sk)}`);

    if (!full) {
      // all the leaves of this limb as two large crossed cards (one where the limb is only a side branch)
      const mid = along(pts, 0.6);
      const dir = norm(add(tangentAt(pts, 0.7), scale(norm(sub(mid, c)), 0.4)));
      const size = limb.clusters.reduce((s, k) => s + k.size, 0) / limb.clusters.length;
      const big = size * (limb.last ? 1.75 : 1.4) + (P.clump ?? 0) * 0.6;
      const hue = limb.clusters.reduce((s, k) => s + k.hue, 0) / limb.clusters.length;
      const base = mad(mid, dir, -big * 0.35);
      const cards = limb.last ? 4 : 1;
      for (let k = 0; k < cards; k++) {
        if (P.hang) {
          const h = norm(turn([dir[0], 0, dir[2]], [0, 1, 0], k * 1.05 + r.range(-0.3, 0.3)));
          const a = mad(mid, h, -big * 0.5);
          const e = mad(mid, h, big * 0.5);
          curtain(b, { a, c: e, drop: big * 0.55, tile: variant.tile, normalAt, ao: [aoAt(a), aoAt(mad(a, [0, -1, 0], big))], hue: [hue, hue], through, sway: [limb.sway0, limb.sway1], phase: limb.phase, flutter: 1 });
        } else {
          const across = turn(square(dir), dir, k * 1.05 + r.range(-0.4, 0.4));
          const end = mad(base, dir, big);
          ribbon(b, { pts: [base, end], across, width: big * 0.95, tile: variant.massTile ?? variant.tile, fold: 0, normalAt, ao: [aoAt(base), aoAt(end)], hue: [hue, hue], through, sway: [limb.sway0, limb.sway1], phase: limb.phase, flutter: 1 });
        }
      }
      continue;
    }

    for (const k of limb.clusters) {
      if (P.hang) {
        // a spray of hanging twigs: its top edge level, across the direction it grew in
        const h = norm(turn([k.dir[0], 0, k.dir[2]], [0, 1, 0], k.spin));
        const half = k.size * 0.36;
        const a = mad(k.at, h, -half);
        const e = mad(k.at, h, half);
        const foot = mad(k.at, [0, -1, 0], k.size);
        curtain(b, { a, c: e, drop: k.size, lean: norm([h[2] * 0.12, -1, -h[0] * 0.12]), tile: variant.tile, normalAt, ao: [aoAt(k.at), aoAt(foot) * 0.9], hue: [k.hue, k.hue], through, sway: [k.sway, k.sway + 0.03], phase: limb.phase, flutter: 1 });
      } else {
        const across = turn(square(k.dir), k.dir, k.roll);
        const line = frondLine(k.at, k.dir, k.size, 2, 0.35);
        const end = line[line.length - 1];
        // the crown's normal, bent towards the clump's own: the crown billows, sub-crown by sub-crown
        const domeNormal = (p) => norm(add(scale(normalAt(p), 0.65), scale(k.clumpN, 0.35)));
        const domeAo = 0.72 + 0.28 * clamp01(0.5 + 0.9 * k.dome);
        ribbon(b, { pts: line, across, width: k.size * 0.95, tile: variant.tile, fold: 0, normalAt: domeNormal, ao: [aoAt(k.at) * domeAo, aoAt(end) * domeAo], hue: [k.hue, k.hue], through, sway: [k.sway, k.sway + 0.04], phase: limb.phase, flutter: 1 });
      }
    }
  }
  return b;
}

/** A limb's place in its skeleton: names the random stream its leaves are laid out with. */
const limbs_id = (limb, sk) => sk.limbs.indexOf(limb);

// ------------------------------------------------------------------------------------------------

/**
 * @typedef {object} TreeModel
 * @property {THREE.BufferGeometry} full @property {THREE.BufferGeometry} reduced
 * @property {number} height the template height H (m) @property {number} radius the widest reach from the foot (m)
 * @property {number} top the highest point (m) @property {[number, number]} triangles full, reduced
 */

/**
 * Grows every variant.
 * @param {object[]} variants VARIANTS of treeSpecies.js @param {Record<string, { through: number }>} species
 * @param {import('../../engine/rng.js').Rng} rng
 * @param {object} o
 * @param {boolean} o.full false: only the reduced mesh is built (the low tier never draws the full one)
 * @param {number} o.barkSize texels of one bark tile
 * @returns {TreeModel[]}
 */
export function growTrees(variants, species, rng, { full, barkSize }) {
  return variants.map((variant) => {
    const r = rng.fork(variant.name);
    const through = species[variant.species].through;
    const conifer = variant.kind === 'conifer';
    const sk = conifer ? coniferSkeleton(variant.P, r.fork('skeleton')) : broadleafSkeleton(variant.P, r.fork('skeleton'));
    const mesh = conifer ? coniferMesh : broadleafMesh;
    const reduced = mesh(variant, sk, r.fork('reduced'), false, barkSize, through);
    const detailed = full ? mesh(variant, sk, r.fork('full'), true, barkSize, through) : null;
    const bounds = (detailed ?? reduced).bounds();
    return {
      full: detailed ? detailed.geometry() : null,
      reduced: reduced.geometry(),
      height: variant.P.H,
      radius: bounds.radius,
      top: bounds.top,
      triangles: [detailed ? detailed.triangles : 0, reduced.triangles],
    };
  });
}
