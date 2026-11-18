// The trees' shapes: each variant of treeSpecies.js is GROWN once at start-up
// into a skeleton, and the skeleton is turned into two meshes.
//
// GROWING. A conifer is a trunk (tapering, wandering a little, flared at the
// foot) with whorls of branches whose length follows the species' crown
// profile; each branch leaves the trunk at an angle that goes from hanging low
// in the crown to rising at its top, sags with its length and lifts its tip;
// under the crown stand the dead stubs of branches the shade has killed.
//
// A broadleaf's crown is a heap of LOBES: a dozen or two balls of foliage
// arranged in rings round the crown's outline, each bulging out of it (the
// billowing sub-crowns of a maple, the separate masses of an open-grown tree).
// The trunk divides at the fork into a few main limbs, each of which carries
// the lobes of its side of the tree; a limb runs to the middle of every lobe
// and twigs run on from there. The leaves are some hundreds of LEAF CARDS on
// the lobes' shells, more on their outside than underneath, none where one
// lobe is buried in another: each card a flat spray of some dozens of leaves
// with the sky between them (a sprig of the foliage atlas), facing more or
// less out of its lobe and tilted every way. A few big cards of leaf mass fill
// the inside, and are what shows, dark, between the leaves of the outside.
//
// THE CROWN'S OWN SHADE is worked out here, not in the shader: from every
// card (and every ring of a limb) rays go out all round through the lobes, and
// how far each travels inside foliage says how much light comes from there.
// Their sum is the card's BENT NORMAL, the direction most of its light comes
// from, and how OPEN it is to the sky. The material lights a leaf from the
// cone of open sky round its bent normal (treeMaterial.js).
//
// MESHES, from the same skeleton so that one can stand in for the other:
//   full     the trunk and every limb and twig as a tube of bark; every leaf
//            card (a conifer: a row of side fronds on each branch, a frond at
//            the tip and, spruce, curtains of twigs hanging under it). Three to
//            six thousand triangles.
//   reduced  the trunk and the limbs with fewer sides, no twigs; every third
//            leaf card, larger (a conifer: one bent card for a whole bough).
//            A thousand triangles or fewer.
//
// WHAT A VERTEX CARRIES besides its place:
//   normal   bark: the tube's own. Foliage: NOT the card's: its bent normal
//            (a conifer: the direction out of the crown at that point), so the
//            crown is lit as one body and not as a pile of flat cards. The
//            card's own facing is found in the fragment shader.
//   uv       foliage: into the foliage atlas. Bark: u across one bark tile
//            (once round the limb), v along it in repeats.
//   aShade   x how open to the light it is (dark inside the crown and low
//            down, light on its outside); y what it is: 0 foliage (takes the
//            tree's tint), 0.5 dead twig (atlas, own colour), 1 bark; z
//            foliage: where on the old-to-new (or green-to-red) scale its
//            colour lies; bark: how pale it is (0.5: as painted); w how much
//            light comes through it from behind.
//   aWind    x how far it moves when its branch swings (m at full gust), y the
//            branch's phase, z how much it flutters (leaf and frond tips), w 1 on
//            a leaf card that is not drawn when it is seen edge-on.

import * as THREE from 'three';
import { barkSpan, subRect, tileRect } from './forestTextures.js';

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
    this.wind.push(wind[0] / SWAY_MAX, wind[1], wind[2], wind[3] ?? 0);
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
 *   ao(i): light at point i; sway(i): [m, phase]; lobe(i, angle): radius multiplier (the flare of the foot); tone: how
 *   pale the bark is (0.5: as painted)
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
      ring.push(b.vertex(mad(pts[i], d, r), d, lerp(u0, u1, k / o.sides), run / o.run, [o.ao(i), 1, o.tone ?? 0.5, 0], [sway, phase, 0]));
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

/** Directions spread evenly all round: where a leaf looks for its light. */
const AROUND = (() => {
  const N = 20;
  const out = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - y * y);
    out.set([Math.cos(i * 2.39996323) * r, y, Math.sin(i * 2.39996323) * r], i * 3);
  }
  return out;
})();
/** Share of the light lost per metre of crown crossed. */
const CROWN_DENSITY = 0.5;
/** The mean share of the rays that reach a leaf on the open outside of a crown: `open` is 1 there. */
const OPEN_OUTSIDE = 0.42;

/**
 * How the light reaches a point of a crown made of `lobes`: rays all round, each dimmed by the length it travels
 * inside a lobe (overlapping lobes counted once), less coming up from the ground than down from the sky.
 * @returns {(p: number[], out: { bent: number[], open: number }) => void} `bent`: the unit direction most of the
 *   light comes from; `open`: 0 (deep inside) to 1 (on the open outside)
 */
function exposureIn(lobes) {
  const count = lobes.length;
  const from = new Float64Array(count);
  const to = new Float64Array(count);
  const ox = new Float64Array(count);
  const oy = new Float64Array(count);
  const oz = new Float64Array(count);
  const cc = new Float64Array(count);
  return (p, out) => {
    for (let i = 0; i < count; i++) {
      const l = lobes[i];
      ox[i] = p[0] - l.c[0];
      oy[i] = p[1] - l.c[1];
      oz[i] = p[2] - l.c[2];
      cc[i] = ox[i] * ox[i] + oy[i] * oy[i] + oz[i] * oz[i] - l.solid * l.solid;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sum = 0;
    for (let d = 0; d < AROUND.length; d += 3) {
      const dx = AROUND[d];
      const dy = AROUND[d + 1];
      const dz = AROUND[d + 2];
      // the stretches of this ray that lie inside a lobe, in order of where they begin
      let n = 0;
      for (let i = 0; i < count; i++) {
        const half = ox[i] * dx + oy[i] * dy + oz[i] * dz;
        const disc = half * half - cc[i];
        if (disc <= 0) continue;
        const root = Math.sqrt(disc);
        if (root - half <= 0) continue;
        const t0 = Math.max(0, -half - root);
        let k = n++;
        for (; k > 0 && from[k - 1] > t0; k--) {
          from[k] = from[k - 1];
          to[k] = to[k - 1];
        }
        from[k] = t0;
        to[k] = root - half;
      }
      let inside = 0;
      let reached = 0;
      for (let k = 0; k < n; k++) {
        if (to[k] <= reached) continue;
        inside += to[k] - Math.max(reached, from[k]);
        reached = to[k];
      }
      const light = Math.exp(-CROWN_DENSITY * inside) * (dy < -0.1 ? 0.5 : 1);
      sx += dx * light;
      sy += dy * light;
      sz += dz * light;
      sum += light;
    }
    const len = Math.hypot(sx, sy, sz);
    out.bent = len > 1e-4 ? [sx / len, sy / len, sz / len] : [0, 1, 0];
    out.open = clamp01((sum * 3) / AROUND.length / OPEN_OUTSIDE);
  };
}

/** A point of the curve from `a` to `b` that is pulled towards `ctrl`. */
const bend = (a, ctrl, b, t) => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1], u * u * a[2] + 2 * u * t * ctrl[2] + t * t * b[2]];
};

/**
 * The skeleton of a broadleaf: the lobes of its crown, its limbs (the trunk is the first) and its leaf cards, each
 * with its light worked out (see the header).
 */
function broadleafSkeleton(P, rng) {
  const H = P.H;
  const c = [0, H * P.crown.cy, 0];
  const rx = P.crown.rx;
  const ry = H * P.crown.ry;
  const unit = () => {
    const y = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };

  // THE LOBES, ring by ring from the top of the crown down
  const lobes = [];
  const turn0 = rng.range(0, Math.PI * 2);
  P.lobes.rings.forEach(([count, polar, place], ring) => {
    const start = turn0 + ring * 0.9 + rng.range(-0.3, 0.3);
    for (let k = 0; k < count; k++) {
      const az = start + ((k + rng.range(-0.22, 0.22)) / count) * Math.PI * 2;
      const pol = Math.max(0, polar + rng.range(-0.12, 0.12));
      const far = place * rng.range(0.93, 1.07);
      const R = rx * rng.range(P.lobes.r[0], P.lobes.r[1]);
      lobes.push({
        c: [c[0] + Math.sin(pol) * Math.cos(az) * rx * far, c[1] + Math.cos(pol) * ry * far, c[2] + Math.sin(pol) * Math.sin(az) * rx * far],
        R,
        solid: R * 0.9,
        core: false,
        phase: rng.next(),
        sway: 0,
      });
    }
  });
  const outer = lobes.slice();
  // (the middle of the crown, where the limbs are: it takes light away and carries only leaf mass)
  const core = P.lobes.core ? { c: [c[0], c[1] - 0.1 * ry, c[2]], R: rx * P.lobes.core, solid: rx * P.lobes.core * 0.9, core: true, phase: 0.5, sway: 0.02 } : null;
  if (core) lobes.push(core);
  const look = exposureIn(lobes);

  // THE WOOD
  const limbs = [];
  const limb = (pts, r0, r1, level, phase, sway0, flex) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += length(sub(pts[i], pts[i - 1]));
    const radii = pts.map((_, i) => lerp(r0, r1, Math.pow(i / (pts.length - 1), 0.8)));
    const me = { pts, radii, level, phase, sway0, sway1: sway0 + flex * len };
    limbs.push(me);
    return me;
  };
  /** A limb's centre line from `a` to `b`, leaving `a` more steeply than it arrives, wandering by `gnarl`. */
  const reach = (a, b, steps, rise, gnarl) => {
    const d = sub(b, a);
    const l = length(d);
    const ctrl = [a[0] + d[0] * (0.5 - 0.3 * rise), a[1] + d[1] * 0.5 + l * 0.3 * rise, a[2] + d[2] * (0.5 - 0.3 * rise)];
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const p = bend(a, ctrl, b, i / steps);
      const w = i > 0 && i < steps ? gnarl * l : 0;
      pts.push([p[0] + rng.range(-w, w), p[1] + rng.range(-w, w) * 0.5, p[2] + rng.range(-w, w)]);
    }
    return pts;
  };
  const leanTo = rng.range(0, Math.PI * 2);
  const fork = [Math.cos(leanTo) * P.bend, H * P.fork, Math.sin(leanTo) * P.bend];
  const trunk = limb(reach([0, -0.4, 0], fork, 4, -0.4, 0.012), P.trunkR * 1.05, P.trunkR * 0.84, 0, 0, 0, 0.004);
  trunk.radii[0] = P.trunkR * 1.5; // the flare of the foot
  // the lobes are shared out among the main limbs by the side of the tree they stand on; those over the middle hang
  // on the leader, where the tree has one
  const groups = Array.from({ length: P.mains + 1 }, () => []);
  const turnG = rng.range(0, Math.PI * 2);
  for (const l of outer) {
    const dx = l.c[0] - fork[0];
    const dz = l.c[2] - fork[2];
    const central = P.leader && Math.hypot(dx, dz) < 0.3 * rx;
    const share = ((Math.atan2(dz, dx) - turnG) / (Math.PI * 2) + 2) % 1;
    groups[central ? P.mains : Math.floor(share * P.mains) % P.mains].push(l);
  }
  const used = groups.filter((g) => g.length).length;
  groups.forEach((group, g) => {
    if (!group.length) return;
    const mid = scale(group.reduce((sum, l) => add(sum, l.c), [0, 0, 0]), 1 / group.length);
    const leader = g === P.mains;
    // where this limb divides: on the way to the middle of its lobes, lower than they are
    const far = P.divide ?? 0.5;
    const joint = leader ? [fork[0] + (mid[0] - fork[0]) * 0.6, lerp(fork[1], mid[1], 0.55), fork[2] + (mid[2] - fork[2]) * 0.6] : [lerp(fork[0], mid[0], far), lerp(fork[1], mid[1], far * 0.92), lerp(fork[2], mid[2], far)];
    const phase = rng.next();
    const r0 = P.trunkR * 0.84 * Math.pow(1 / used, 0.4) * (leader ? 1.15 : 1);
    const main = limb(reach(fork, joint, 4, leader ? 0 : (P.rise ?? 0.5), P.gnarl ?? 0.05), r0, r0 * 0.66, 1, phase, trunk.sway1, 0.012);
    for (const l of group) {
      const r1 = Math.max(0.035, r0 * 0.66 * Math.pow(1 / group.length, 0.42));
      const arm = limb(reach(joint, l.c, 3, 0.35, P.gnarl ?? 0.05), r1, 0.022, 2, phase + rng.range(-0.06, 0.06), main.sway1, 0.028);
      l.sway = arm.sway1;
      l.phase = arm.phase;
      for (let k = 0; k < P.twigs; k++) {
        const u = unit();
        if (u[1] < -0.2) u[1] = -u[1];
        const from = along(arm.pts, rng.range(0.7, 1));
        limb(reach(from, mad(l.c, u, l.R * rng.range(0.7, 0.92)), 2, 0.2, 0.06), 0.02, 0.006, 3, arm.phase, lerp(arm.sway0, arm.sway1, 0.85), 0.045);
      }
    }
  });

  // THE LEAVES
  const cards = [];
  const light = { bent: [0, 1, 0], open: 1 };
  const floor = c[1] - ry * (P.floor ?? 0.95);
  const area = outer.reduce((sum, l) => sum + l.R * l.R, 0);
  for (const lobe of outer) {
    const want = Math.round((P.cards * lobe.R * lobe.R) / area);
    let made = 0;
    for (let tries = 0; made < want && tries < want * 4; tries++) {
      // on the lobe's shell, more of them towards its outside, fewer underneath
      const u = unit();
      if (u[1] < -0.2 && rng.next() > P.under) u[1] = -u[1];
      const r = (1 - 0.45 * rng.next() ** 2) * rng.range(0.95, 1.06);
      const p = mad(lobe.c, u, lobe.R * r);
      if (p[1] < floor) continue;
      // not where it would be buried in another lobe, and seldom where hardly any light comes
      let buried = false;
      for (const o of lobes) {
        if (o === lobe) continue;
        const reach = o.R * (o.core ? 0.8 : 0.72);
        if ((p[0] - o.c[0]) ** 2 + (p[1] - o.c[1]) ** 2 + (p[2] - o.c[2]) ** 2 < reach * reach) {
          buried = true;
          break;
        }
      }
      if (buried && rng.next() < 0.9) continue;
      look(p, light);
      if (light.open < 0.16 && rng.next() < 0.75) continue;
      // facing out of the lobe, tilted every way (and a little towards the sky, as leaves are held)
      const tilt = unit();
      const n = norm([u[0] * 0.75 + tilt[0], u[1] * 0.75 + tilt[1] + (P.flat ?? 0.2), u[2] * 0.75 + tilt[2]]);
      cards.push({ p, n, out: u, size: rng.range(P.leaf[0], P.leaf[1]), lobe, hue: rng.next(), sub: rng.int(4), flip: rng.next() < 0.5, mass: false, bent: light.bent, open: light.open });
      made++;
    }
  }
  // the inside: a few big cards of leaf mass in each lobe and in the middle of the crown. They are what shows between
  // the leaves of the outside, and they keep the sky from showing through the middle of the tree.
  for (const lobe of lobes) {
    const count = lobe.core ? P.fill * 3 : P.fill;
    for (let k = 0; k < count; k++) {
      const u = unit();
      if (u[1] < -0.3) u[1] = -u[1];
      const p = mad(lobe.c, u, lobe.R * rng.range(0.25, 0.5));
      if (p[1] < floor) continue;
      look(p, light);
      const tilt = unit();
      cards.push({ p, n: norm(mad(u, tilt, 0.5)), out: u, size: lobe.R * rng.range(0.8, 1.05), lobe, hue: rng.next(), sub: 0, flip: rng.next() < 0.5, mass: true, bent: light.bent, open: light.open });
    }
  }
  return { H, c, rx, ry, lobes, limbs, cards, look, footPhase: rng.range(0, Math.PI * 2) };
}

/**
 * One leaf card: a square of `size` about `k.p` in the plane square to `k.n`, picturing the atlas rectangle `rect`
 * with its stem end towards the inside of the lobe (or, `hang`: hanging from its top edge). `dim`: how much of its
 * light it keeps (the inside's leaf mass is dimmer than its place alone makes it).
 */
function leafCard(b, k, size, rect, hang, through, dim = 1) {
  let ua;
  let va;
  if (hang) {
    const n = norm([k.n[0], k.n[1] * 0.15, k.n[2]]);
    ua = norm(cross([0, 1, 0], n));
    va = cross(ua, n);
    if (va[1] > 0) va = scale(va, -1);
  } else {
    ua = sub(k.out, scale(k.n, dot(k.out, k.n)));
    ua = length(ua) < 0.2 ? square(k.n) : norm(ua);
    va = cross(k.n, ua);
  }
  const [u0, v0, u1, v1] = rect;
  const half = size / 2;
  const sway = k.lobe.sway;
  const ids = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => {
    const p = add(mad(k.p, ua, x * half * (hang ? 0.85 : 1)), scale(va, y * half));
    const tip = hang ? (y + 1) / 2 : (x + 1) / 2;
    const v = hang ? (y < 0 ? v0 : v1) : (y < 0) !== k.flip ? v0 : v1;
    return b.vertex(p, k.bent, x < 0 ? u0 : u1, v, [k.open * dim, 0, k.hue, through], [sway + 0.03 * tip, k.lobe.phase, 0.35 + 0.65 * tip, 1]);
  });
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** @see coniferMesh */
function broadleafMesh(variant, sk, rng, full, barkSize, through) {
  const P = variant.P;
  const b = new Builder();
  const light = { bent: [0, 1, 0], open: 1 };
  const sides = full ? [8, 6, 4, 3] : [5, 4, 3, 3];
  for (const limb of sk.limbs) {
    // the reduced tree keeps the trunk and the limbs: no twigs
    if (!full && limb.level > 2) continue;
    const last = limb.pts.length - 1;
    const keep = full || last < 3 ? limb.pts.map((_, i) => i) : [0, Math.round(last / 2), last];
    const pts = keep.map((i) => limb.pts[i]);
    tube(b, pts, keep.map((i) => limb.radii[i]), {
      sides: sides[limb.level],
      bark: variant.bark,
      barkSize,
      run: Math.max(0.35, 2 * Math.PI * limb.radii[0]),
      tone: P.barkTone ?? 0.5,
      // limbs inside the crown are in its shade: they read dark against the leaves
      ao: (i) => {
        sk.look(pts[i], light);
        return 0.3 + 0.7 * light.open;
      },
      sway: (i) => [lerp(limb.sway0, limb.sway1, keep[i] / last), limb.phase],
      lobe: limb.level === 0 ? (i, a) => 1 + (i === 0 ? 0.16 : 0) * Math.cos(4 * a + sk.footPhase) : null,
    });
  }
  const subs = variant.subs ?? [0, 1, 2, 3];
  sk.cards.forEach((k, i) => {
    if (k.mass) leafCard(b, k, k.size, tileRect(variant.massTile), false, through * 0.6, 0.6);
    // the reduced tree: every third card, larger
    else if (full || i % 3 === 0) leafCard(b, k, k.size * (full ? 1 : 1.7), variant.hang ? tileRect(variant.tile) : subRect(variant.tile, subs[k.sub % subs.length]), !!variant.hang, through);
  });
  return b;
}

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
