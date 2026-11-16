// Rock, the way a painter of stylised islands would cut it: big flat planes
// meeting at crisp edges, pale where the sun lies on it, warm on its faces,
// dark underneath.
//
// A rock starts as a ball and is chiselled: a handful of random planes each
// slice off whatever stands beyond them (walls mostly, some sloping roofs, a
// few flat tops). What is left is drawn out to its height, narrowed toward the
// top, leaned, and (for the tall ones) stepped in and out in bands so that it
// reads as blocks stacked on blocks. It is shaded flat, one colour per facet,
// chosen from which way the facet looks and how high up it is.

import * as THREE from 'three';
import { clamp01, fbm2, lerp, makeRng, smoothstep } from '../engine/math.js';
import { facet, merge } from './geo.js';

/** The colours rock is painted in (see PALETTE for the rest of the island). */
export const ROCK_TONES = {
  top: new THREE.Color('#ead9b0'), // flats the sun lies on
  face: new THREE.Color('#c29f71'), // the body of a wall
  warm: new THREE.Color('#a87a50'), // ochre faces
  cool: new THREE.Color('#8d8179'), // grey ones
  shade: new THREE.Color('#5f4a3d'), // undersides and clefts
  wet: new THREE.Color('#463c38'), // the band the sea keeps dark
  moss: new THREE.Color('#7da53e'),
  mossDark: new THREE.Color('#4e7f34'),
};

/**
 * The same chisel cuts foliage: a clump of bush or the crown of a tree is a rounder "rock" in greens, pale where
 * the sun lies on it. (Seen from a boat, that is what a thicket is: lit planes and dark ones.)
 */
export const FOLIAGE_TONES = {
  top: new THREE.Color('#a8cf52'),
  face: new THREE.Color('#4c9a3a'),
  warm: new THREE.Color('#6aaa3a'),
  cool: new THREE.Color('#2f7f45'),
  shade: new THREE.Color('#184a2b'),
  wet: new THREE.Color('#184a2b'),
  moss: new THREE.Color('#a8cf52'),
  mossDark: new THREE.Color('#4c9a3a'),
};

const _v = new THREE.Vector3();

/**
 * One rock, sitting on y = 0 (a little of it is below, to be sunk into the ground).
 * @param {number} seed
 * @param {object} [o]
 * @param {number} [o.radius]  half its width at the foot (m)
 * @param {number} [o.height]
 * @param {number} [o.cuts]    how many planes chisel it: few = boulder, many = crag
 * @param {number} [o.taper]   width at the top as a fraction of the foot
 * @param {number} [o.detail]  subdivision of the ball it is cut from (1..3)
 * @param {[number, number]} [o.lean] metres sideways (x, z) per metre of height
 * @param {number} [o.steps]   bands it is stepped in and out by (0 = none)
 * @param {number} [o.moss]    0..1: how much of its upward faces is overgrown
 * @param {number} [o.wet]     height of the dark band at its foot (m)
 * @param {number} [o.squash]  depth as a fraction of width (a slab rather than a column)
 * @param {typeof ROCK_TONES} [o.tones] what it is painted in
 * @param {boolean} [o.round]  no flat top and no walls: only strokes that take the corners off (a bush, a pebble)
 * @returns {THREE.BufferGeometry} flat-shaded, with vertex colours
 */
export function chunkyRock(seed, { radius = 1, height = radius * 1.3, cuts = 12, taper = 0.7, detail = 2, lean = [0, 0], steps = 0, moss = 0, wet = 0, squash = 1, tones = ROCK_TONES, round = false } = {}) {
  const rng = makeRng(seed * 977 + 31);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;

  // ---- the chisel: a flat top, walls all round, and a few more strokes to break the corners
  const planes = [];
  const plane = (a, ny, d) => {
    const h = Math.sqrt(Math.max(0, 1 - ny * ny));
    planes.push({ n: new THREE.Vector3(Math.cos(a) * h, ny, Math.sin(a) * h).normalize(), d });
  };
  const walls = round ? 0 : 4 + Math.floor(rng() * 3);
  if (!round) plane(rng() * Math.PI * 2, 0.9 + rng() * 0.1, 0.5 + rng() * 0.22);
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < walls; i++) plane(a0 + ((i + (rng() - 0.5) * 0.7) / walls) * Math.PI * 2, -0.12 + rng() * 0.34, 0.52 + rng() * 0.26);
  for (let i = walls + 1; i < cuts; i++) plane(rng() * Math.PI * 2, round ? -0.2 + rng() * 1.1 : 0.25 + rng() * 0.5, (round ? 0.74 : 0.66) + rng() * 0.24);
  // ---- the bands: each a little wider or narrower than the one below, and shoved a little to one side
  const bands = [];
  for (let b = 0; b <= steps; b++) bands.push({ scale: 1 + (rng() - 0.5) * 0.3, dx: (rng() - 0.5) * 0.16, dz: (rng() - 0.5) * 0.16 });
  const turn = rng() * Math.PI * 2;
  const ct = Math.cos(turn);
  const st = Math.sin(turn);

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    for (const p of planes) {
      const over = _v.dot(p.n) - p.d;
      if (over > 0) _v.addScaledVector(p.n, -over);
    }
    // from the ball to the rock: the lowest third of the ball is under the ground
    const up = clamp01((_v.y + 0.38) / 1.3);
    let x = _v.x;
    let z = _v.z * squash;
    let y = up * height;
    let wide = radius * lerp(1, taper, Math.pow(up, 1.25));
    if (steps > 0) {
      const f = up * steps;
      const b = Math.min(steps, Math.floor(f));
      const band = bands[b];
      wide *= band.scale;
      x += band.dx;
      z += band.dz;
      // the top of each band is a ledge: pull the last of it level
      const within = f - b;
      if (within > 0.86 && b < steps) y = ((b + 0.86 + (within - 0.86) * 0.25) / steps) * height;
    }
    if (_v.y < -0.38) y = -radius * 0.18 * clamp01((-0.38 - _v.y) / 0.3);
    const wx = (x * ct - z * st) * wide + lean[0] * y;
    const wz = (x * st + z * ct) * wide + lean[1] * y;
    pos.setXYZ(i, wx, y, wz);
  }

  // ---- the paint: one colour to a face. (A face is many triangles lying in one plane: the colour is chosen from
  // the way the plane looks, not from where the triangle is, so that the whole face is one tone.)
  const t = tones;
  const tint = rng();
  return facet(g, (c, normal, out) => {
    const k = fbm2(normal.x * 2.3 + seed * 3.1, normal.z * 2.3 + normal.y * 1.9 - seed * 1.7, 1, seed + 5);
    const patch = fbm2(c.x * 0.21 + seed, c.z * 0.21 + c.y * 0.17, 2, seed + 9);
    const high = clamp01(c.y / Math.max(height, 0.01));
    // walls: a warm body, here ochre, there grey; paler toward the top, darker toward the foot
    out.copy(t.face).lerp(k > 0.5 ? t.warm : t.cool, clamp01(Math.abs(k - 0.5) * 2.4) * (0.5 + 0.5 * tint));
    out.lerp(t.top, 0.3 * high);
    out.lerp(t.shade, 0.42 * smoothstep(0.42, 0.0, high));
    // flats take the light; undersides lose it
    if (normal.y > 0.5) out.lerp(t.top, smoothstep(0.5, 0.85, normal.y) * 0.85);
    if (normal.y < -0.05) out.lerp(t.shade, smoothstep(-0.05, -0.5, normal.y) * 0.9);
    // what grows on it: its upward faces, in patches
    if (moss > 0 && normal.y > 0.62 && patch + moss * 0.75 > 0.95) out.copy(k > 0.5 ? t.moss : t.mossDark);
    if (wet > 0 && c.y < wet) out.lerp(t.wet, 0.75 * smoothstep(wet, wet * 0.35, c.y));
  });
}

/**
 * A crag: blocks of rock piled on one another, each smaller than the one it stands on, ending in a horn.
 * @param {number} seed
 * @param {object} [o]
 * @param {number} [o.radius] half the width of the lowest block
 * @param {number} [o.height] of the whole pile
 * @param {number} [o.blocks] how many
 * @param {[number, number]} [o.lean] metres sideways per metre of height
 * @param {number} [o.moss]
 * @param {number} [o.wet]
 * @param {number} [o.detail] how finely the lowest blocks are cut (3), for crags nobody will ever be near (1)
 * @returns {THREE.BufferGeometry}
 */
export function crag(seed, { radius = 10, height = 40, blocks = 5, lean = [0, 0], moss = 0.5, wet = 0, detail = 3 } = {}) {
  const rng = makeRng(seed * 131 + 7);
  const parts = [];
  // heights of the blocks: the lower ones squat, the last one a horn
  const share = [];
  for (let i = 0; i < blocks; i++) share.push((i === blocks - 1 ? 1.25 : 0.8 + rng() * 0.5) * lerp(1, 0.8, i / blocks));
  const total = share.reduce((a, b) => a + b, 0);
  let y = 0;
  for (let i = 0; i < blocks; i++) {
    const u = blocks > 1 ? i / (blocks - 1) : 0;
    const h = (share[i] / total) * height * 1.75; // (they overlap: each stands well inside the one below)
    const r = radius * lerp(1, 0.36, Math.pow(u, 0.9)) * (0.9 + rng() * 0.2);
    const last = i === blocks - 1;
    const g = chunkyRock(seed * 17 + i * 5 + 1, {
      radius: r,
      height: h,
      cuts: last ? 9 : 10 + Math.floor(rng() * 4),
      taper: last ? 0.5 : 0.8 + rng() * 0.14,
      detail: Math.min(detail, i < 2 ? 3 : 2),
      squash: 0.8 + rng() * 0.2,
      moss: moss * (0.5 + 0.5 * u),
      wet: i === 0 ? wet : 0,
      lean: [(rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12],
    });
    const off = last ? 0.2 : 0.34;
    g.translate(lean[0] * y + (rng() - 0.5) * r * off, y, lean[1] * y + (rng() - 0.5) * r * off);
    parts.push(g);
    y += h * 0.42;
  }
  return merge(parts);
}

/**
 * Several rocks as one geometry.
 * @param {{ x: number, y: number, z: number, seed: number, [k: string]: any }[]} rocks position of each rock's foot, and
 *   the options chunkyRock takes (or, with `blocks`, the ones crag takes)
 */
export function rockField(rocks) {
  return merge(
    rocks.map((r) => {
      const g = r.blocks ? crag(r.seed, r) : chunkyRock(r.seed, r);
      g.translate(r.x, r.y, r.z);
      return g;
    }),
  );
}
