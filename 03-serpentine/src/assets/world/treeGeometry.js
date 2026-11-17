// The trees' shapes, built once per species at start-up, standing at the
// origin on y = 0 at a template height; each tree in the forest is one of them
// scaled, turned and leaned by its instance matrix.
//
// NEAR (the trees within about 100 m):
//   - a tapering trunk with a little flare at the foot, bark in 3 m runs;
//   - whorls of branches, each branch one card bent along its length (out,
//     a little up, then drooping) and folded along its stem like a shallow
//     roof, so it has volume seen from the side as well as from above;
//   - inside the crown a core of packed needles, so a spruce at 5 m is a wall
//     and not a lattice.
//   The normals of the foliage are not the cards' own: they point out of the
//   crown as a whole (out from the trunk and a little up), so the crown is lit
//   as one body: warm on the sun's side, shading round to the dark side.
// FAR: three crossed cards with the species' silhouette and a small core cone
// (so it is not a cross seen from above), about 30 triangles.
//
// Every vertex carries aShade: x how much light the inside of the crown lets
// in (an occlusion term, dark at the trunk and low down), y 1 for bark (drawn
// in the texture's own colour) and 0 for foliage (tinted per tree).

import * as THREE from 'three';
import { ATLAS } from './forestTextures.js';

/** The species, in the order the forest stores them. */
export const SPECIES = ['spruce', 'fir', 'birch', 'larch'];

/** Shape of each species at its template height H (m). */
const SHAPES = {
  // crownBase: share of H below the lowest live branches; R: the widest branch (m); whorls; per: branches per whorl;
  // rise and droop: how a branch climbs at first and then hangs (per metre of its length)
  spruce: { H: 20, trunk: 0.3, crownBase: 0.08, R: 3.0, whorls: 17, per: 6, rise: 0.25, droop: 0.6, power: 0.95, core: 0.28 },
  fir: { H: 18, trunk: 0.27, crownBase: 0.1, R: 2.5, whorls: 16, per: 6, rise: 0.12, droop: 0.25, power: 0.7, core: 0.3 },
  larch: { H: 18, trunk: 0.26, crownBase: 0.2, R: 2.6, whorls: 13, per: 5, rise: 0.4, droop: 0.8, power: 0.9, core: 0.15 },
  birch: { H: 15, trunk: 0.16 },
};
export const TEMPLATE_HEIGHT = Object.fromEntries(SPECIES.map((name) => [name, SHAPES[name].H]));
/** The widest a crown reaches from its trunk at template height (m): for the bounds and the far cards. */
export const CROWN_RADIUS = { spruce: 2.9, fir: 2.4, larch: 2.6, birch: 2.6 };

class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.shade = [];
    this.index = [];
  }
  vertex(x, y, z, nx, ny, nz, u, v, ao, part) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nor.push(nx / l, ny / l, nz / l);
    this.uv.push(u, v);
    this.shade.push(ao, part);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) {
    this.index.push(a, b, c, a, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

/** A trunk from below the ground to `top`, `sides` round, bark repeated every `run` metres. */
function trunk(b, { r0, top, sides = 7, run = 3, region = ATLAS.BARK, ao = 0.85 }) {
  const [u0, v0, u1, v1] = region;
  const radius = (y) => Math.max(0.02, r0 * (1 - 0.92 * (y / top)) * (1 + 0.45 * Math.exp(-Math.max(0, y) / 0.6)));
  for (let y = -0.4; y < top - 1e-3; y += run) {
    const ya = y;
    const yb = Math.min(top, y + run);
    const ring = [];
    for (const yy of [ya, yb]) {
      const row = [];
      const r = radius(yy);
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        row.push(b.vertex(c * r, yy, s * r, c, 0.1, s, lerp(u0, u1, k / sides), lerp(v0, v1, (yy - ya) / run), ao, 1));
      }
      ring.push(row);
    }
    for (let k = 0; k < sides; k++) b.quad(ring[0][k], ring[1][k], ring[1][k + 1], ring[0][k + 1]);
  }
}

/** A cone of packed needles inside a crown. */
function core(b, { y0, y1, r, sides = 7, rings = 4 }) {
  const [u0, v0, u1, v1] = ATLAS.MASS;
  const rows = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = lerp(y0, y1, t);
    const rr = r * (1 - t) ** 0.9 + 0.05;
    const row = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2 + j * 0.4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      row.push(b.vertex(c * rr, y, s * rr, c, 0.55, s, lerp(u0, u1, k / sides), lerp(v0, v1, t), 0.3 + 0.3 * t, 0));
    }
    rows.push(row);
  }
  for (let j = 0; j < rings; j++) for (let k = 0; k < sides; k++) b.quad(rows[j][k], rows[j + 1][k], rows[j + 1][k + 1], rows[j][k + 1]);
}

/**
 * One branch card: from (0, y, 0) out along bearing `a` for `len` m. `region` is where its picture is; the
 * picture's u runs along the branch.
 */
function branch(b, { y, a, len, rise, droop, width, fold, region, heightShare, crownTop, hang = 0 }) {
  const [u0, v0, u1, v1] = region;
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const sx = -dz;
  const sz = dx;
  const rows = [];
  const steps = 2;
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const d = len * t;
    const cx = dx * d;
    const cz = dz * d;
    const cy = y + len * (rise * t - droop * t * t);
    const half = width * 0.5 * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + t)));
    const drop = fold * half;
    // the crown's normal here: out from the trunk and up, more up near the top of the tree
    const up = 0.45 + 0.6 * heightShare;
    const ao = (0.5 + 0.5 * Math.pow(t, 0.8)) * (0.7 + 0.3 * heightShare);
    const u = lerp(u0, u1, Math.min(1, t));
    const row = [];
    for (const [k, v] of [
      [-1, v0],
      [0, (v0 + v1) / 2],
      [1, v1],
    ]) {
      const x = cx + sx * half * k;
      const z = cz + sz * half * k;
      const yy = cy - (k ? drop : 0);
      const out = Math.hypot(x, z) || 1;
      row.push(b.vertex(x, yy, z, (x / out) * (0.4 + t), up, (z / out) * (0.4 + t), u, v, ao, 0));
    }
    rows.push(row);
  }
  for (let j = 0; j < steps; j++) {
    b.quad(rows[j][0], rows[j + 1][0], rows[j + 1][1], rows[j][1]);
    b.quad(rows[j][1], rows[j + 1][1], rows[j + 1][2], rows[j][2]);
  }
  if (hang > 0) {
    // the branchlets that hang from the outer half of a spruce's branch: one card along it, hanging down
    const t0 = 0.35;
    const ax = dx * len * t0;
    const az = dz * len * t0;
    const ay = y + len * (rise * t0 - droop * t0 * t0);
    const bx = dx * len;
    const bz = dz * len;
    const by = y + len * (rise - droop);
    const drop = hang * len;
    const up = 0.45 + 0.6 * heightShare;
    const ao = 0.75 * (0.6 + 0.4 * heightShare);
    // the picture turned on its side: its stem along the top edge
    const vm = (v0 + v1) / 2;
    const a0 = b.vertex(ax, ay, az, ax, up, az, u0 + (u1 - u0) * 0.4, vm, ao, 0);
    const a1 = b.vertex(bx, by, bz, bx, up, bz, u1, vm, ao, 0);
    const a2 = b.vertex(bx * 0.97, by - drop * 0.7, bz * 0.97, bx, up * 0.6, bz, u1, v1, ao * 0.8, 0);
    const a3 = b.vertex(ax, ay - drop, az, ax, up * 0.6, az, u0 + (u1 - u0) * 0.4, v1, ao * 0.7, 0);
    b.quad(a0, a1, a2, a3);
  }
  return crownTop;
}

/** A conifer at its template height. */
function conifer(name, rng) {
  const p = SHAPES[name];
  const b = new Builder();
  const H = p.H;
  trunk(b, { r0: p.trunk, top: H * 0.96 });
  const y0 = H * p.crownBase;
  const crownH = H - y0;
  core(b, { y0: y0 + 0.4, y1: H * 0.93, r: p.R * p.core });
  let a = rng.range(0, Math.PI * 2);
  for (let w = 0; w < p.whorls; w++) {
    const t = w / (p.whorls - 1); // 0 at the crown's base, 1 at the top
    const y = y0 + crownH * Math.pow(t, 0.92) * 0.97;
    const per = t > 0.9 ? 3 : p.per;
    for (let k = 0; k < per; k++) {
      a += (Math.PI * 2) / per + rng.range(-0.25, 0.25);
      const len = (p.R * Math.pow(1 - t, p.power) + 0.35) * rng.range(0.82, 1.12);
      branch(b, {
        y,
        a,
        len,
        rise: p.rise + 0.5 * t * t,
        droop: p.droop * (1 - 0.6 * t),
        width: len * (name === 'larch' ? 0.7 : 1.05),
        fold: 0.6,
        region: ATLAS.FROND,
        heightShare: t,
        hang: name === 'fir' ? 0.18 : name === 'larch' ? 0.45 : 0.32,
      });
    }
    a += 2.39996; // the next whorl turned by the golden angle
  }
  // the leader: a short upright tuft
  for (let k = 0; k < 3; k++) {
    branch(b, { y: H * 0.94, a: (k * Math.PI * 2) / 3, len: 0.9, rise: 1.4, droop: 0.2, width: 0.5, fold: 0.2, region: ATLAS.FROND, heightShare: 1 });
  }
  return b.geometry();
}

/** A birch: a slim white trunk, a few limbs, an open crown of leaf sprays. */
function birch(rng) {
  const p = SHAPES.birch;
  const b = new Builder();
  const H = p.H;
  trunk(b, { r0: p.trunk, top: H * 0.92, run: 2.2, region: ATLAS.BIRCH, ao: 1 });
  const cy = H * 0.66;
  for (let k = 0; k < 22; k++) {
    const a = rng.range(0, Math.PI * 2);
    const y = H * rng.range(0.42, 0.9);
    const share = (y - H * 0.42) / (H * 0.48);
    const len = 2.6 * Math.sin(Math.PI * Math.min(1, 0.2 + share * 0.8)) + 0.8;
    branch(b, {
      y,
      a,
      len,
      rise: rng.range(0.1, 0.5),
      droop: rng.range(0.2, 0.6),
      width: len * 0.9,
      fold: 0.15,
      region: ATLAS.LEAVES,
      heightShare: (y - cy) / H + 0.5,
    });
  }
  return b.geometry();
}

/** The far level: crossed silhouette cards and a small core. */
function farTree(name) {
  const k = SPECIES.indexOf(name);
  const [u0, v0, u1, v1] = ATLAS.SIL[k];
  const H = SHAPES[name].H;
  const R = CROWN_RADIUS[name] * 1.08;
  const b = new Builder();
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const cols = [];
    for (const [s, u] of [
      [-1, u0],
      [0, (u0 + u1) / 2],
      [1, u1],
    ]) {
      const col = [];
      for (const [y, v] of [
        [-0.3, v1],
        [H, v0],
      ]) {
        const ao = y > 0 ? 1 : 0.55;
        col.push(b.vertex(dx * R * s, y, dz * R * s, dx * s * 0.8, 0.55, dz * s * 0.8 + (s === 0 ? 0 : 0), u, v, ao, 0));
      }
      cols.push(col);
    }
    b.quad(cols[0][0], cols[0][1], cols[1][1], cols[1][0]);
    b.quad(cols[1][0], cols[1][1], cols[2][1], cols[2][0]);
  }
  if (name !== 'birch') core(b, { y0: H * 0.2, y1: H * 0.9, r: R * 0.5, sides: 5, rings: 2 });
  return b.geometry();
}

/**
 * @param {import('../../engine/rng.js').Rng} rng
 * @returns {Record<string, { near: THREE.BufferGeometry, far: THREE.BufferGeometry }>}
 */
export function createTreeGeometries(rng) {
  const out = {};
  for (const name of SPECIES) {
    const r = rng.fork(name);
    out[name] = { near: name === 'birch' ? birch(r) : conifer(name, r), far: farTree(name) };
  }
  return out;
}
