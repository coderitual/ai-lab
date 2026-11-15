// A tunnel-hull race boat, modelled in code.
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.
//
// Two slim hulls (sponsons) run the full length and end in pointed bows; a
// cambered centre body bridges them from the transom to a nose a metre short of
// the bows, with the tunnel open underneath. On top: a glass canopy, an air
// scoop, mirrors. On the transom: two outboards that swing with the helm.
//
// Each body is a cross-section swept from stern to bow. It is split into strips
// where the real thing has a hard edge (keel, chine, rail) and kept as one
// smooth skin where it is rounded (decks, the centre body), because a glossy
// surface shows every crease. Paint lines are made crisp by placing two
// sections a few millimetres apart on either side of each line.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, lerp, smoothstep } from '../engine/math.js';
import { withLiveReflections } from '../engine/ReflectionProbe.js';
import { fan, loft, merge, part } from './geo.js';
import { withSkyFog } from './sky.js';
import { makeCanvasTexture } from './textures.js';

export const BOAT = {
  length: 5.8,
  sternZ: -2.7,
  bowZ: 3.1,
  halfBeam: 1.08,
  /** Where the outboards pivot, behind the transom. */
  engineX: 0.36,
  engineY: 0.36,
  engineZ: -2.94,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mirror = (v) => V(-v.x, v.y, v.z);
const ramp = (t, from, to) => clamp01((t - from) / (to - from));
const EPS = 0.0007;

/** Evenly spaced values 0..end, plus each cut twice (just before and just after it). */
function stations(n, end, cuts = []) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * end;
    if (!cuts.some((c) => Math.abs(t - c) < EPS * 3)) out.push(t);
  }
  for (const c of cuts) out.push(c - EPS, c + EPS);
  return out.sort((a, b) => a - b);
}

/** A smooth curve through `points`, sampled at parameters 0..1. */
function resample(points, params) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return params.map((u) => curve.getPoint(u));
}

// ---- lines, t = 0 (transom) .. 1 (tips of the bows)
const zAt = (t) => lerp(BOAT.sternZ, BOAT.bowZ, t);
const outerAt = (t) => lerp(BOAT.halfBeam, 0.74, Math.pow(ramp(t, 0.5, 1), 1.7)); // outer edge of a sponson
const innerAt = (t) => lerp(0.46, 0.725, Math.pow(ramp(t, 0.6, 1), 2.4)); // its tunnel side
const keelAt = (t) => -0.24 + 0.64 * Math.pow(ramp(t, 0.58, 1), 1.9);
const chineAt = (t) => -0.04 + 0.5 * Math.pow(ramp(t, 0.5, 1), 1.7);
const sheerAt = (t) => 0.5 + 0.1 * Math.sin(Math.PI * Math.min(t / 0.92, 1)) - 0.03 * ramp(t, 0.92, 1);
const deckEdgeAt = (t) => sheerAt(t) + 0.02;

const TUNNEL = 0.3; // underside of the centre body
const NOSE = 0.8; // the centre body ends here; ahead of it the tunnel is open to the sky
/** How far the centre line stands above the deck edge: stern deck, engine cowl, cockpit, foredeck. */
const crownAt = (t) => 0.03 + 0.27 * smoothstep(0.05, 0.2, t) - 0.06 * smoothstep(0.28, 0.4, t) - 0.2 * smoothstep(0.56, 0.76, t);
/** 0 along the body, 1 at the nose, where the centre body rounds down into the tunnel. */
const noseAt = (t) => Math.pow(smoothstep(0.7, NOSE, t), 2);

const GUNWALE = [0, 0.25, 0.5, 0.75, 1];
const DECK = [0, 0.1, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.9, 1];

/** One sponson's cross-section on the port side, as the strips it is skinned from. */
function sponsonSection(t) {
  const z = zAt(t);
  const xo = outerAt(t);
  const xi = innerAt(t);
  const w = xo - xi;
  const yk = keelAt(t);
  const yc = chineAt(t);
  const ys = sheerAt(t);
  const yd = deckEdgeAt(t);
  const h = ys - yc; // height of the side
  const k = clamp01(h / 0.3); // everything fine closes up toward the tip of the bow
  const kw = clamp01(w / 0.3);
  const yci = yc - 0.02 * k;
  const roof = Math.max(TUNNEL, yci + 0.01);
  // under the centre body the wall stops at the tunnel roof; ahead of the nose it runs up to the deck
  const wallTop = lerp(roof, yd, smoothstep(0.64, 0.7, t));

  const fork = V(xi, wallTop, z);
  const wall = V(xi, Math.min(roof, wallTop), z);
  const chineIn = V(xi + 0.02 * w, yci, z);
  const keel = V(xi + 0.42 * w, yk, z);
  const chine = V(xo - 0.1 * w, yc, z);
  const knuckle = V(xo - 0.035 * w, yc + 0.1 * h, z); // the spray rail: a flared band above the chine
  const rail = V(xo, ys - 0.06 * k, z);
  const edge = V(xo, ys - 0.012 * k, z);
  const top = V(xo - 0.05 * w, ys + 0.012 * k, z);
  const deck1 = V(lerp(xo, xi, 0.3), ys + 0.036 * kw, z);
  const deck2 = V(lerp(xo, xi, 0.64), ys + 0.044 * kw, z);
  const deckIn = V(xi, yd, z);
  return {
    fork: [fork, wall],
    wall: [wall, chineIn],
    bottomIn: [chineIn, keel],
    bottomOut: [keel, chine],
    boot: [chine, knuckle],
    side: [knuckle, rail],
    gunwale: resample([rail, edge, top], GUNWALE),
    deck: resample([top, deck1, deck2, deckIn], DECK),
  };
}

/** The centre body's cross-section, from the port sponson's deck over the crown to the starboard one. */
function centreSection(t) {
  const z = zAt(t);
  const xi = innerAt(t);
  const n = noseAt(t);
  const edge = lerp(deckEdgeAt(t), TUNNEL + 0.01, n);
  const crown = crownAt(t) * (1 - n);
  const half = [V(xi, edge, z), V(xi * 0.87, edge + crown * 0.42, z), V(xi * 0.56, edge + crown * 0.9, z)];
  return [...half, V(0, edge + crown, z), ...half.map(mirror).reverse()];
}

const BANDS = [0.24, 0.285, 0.305, 0.325]; // two stripes across the decks behind the cockpit
const TIPS = 0.9; // the bows are painted from here forward
const COCKPIT = [0.35, 0.63]; // the dark panel round the canopy
const banded = (t) => (t > BANDS[0] && t < BANDS[1]) || (t > BANDS[2] && t < BANDS[3]) || t > TIPS;

function buildHullGeometry(team) {
  const hull = new THREE.Color(team.hull);
  const accent = new THREE.Color(team.accent);
  const belly = new THREE.Color('#f1efe8');
  const dark = new THREE.Color('#101318');
  const shade = hull.clone().multiplyScalar(0.8);
  const parts = [];

  // ---- the two sponsons
  const ts = stations(46, 1, [...BANDS, TIPS]);
  const sections = ts.map(sponsonSection);
  for (const side of [1, -1]) {
    const flip = side === -1;
    const strip = (name) => sections.map((s) => s[name].map((v) => (side === 1 ? v : mirror(v))));
    parts.push(loft(strip('fork'), (i) => (ts[i] > TIPS ? accent : hull), { flip })); // inside of the bows, ahead of the nose
    parts.push(loft(strip('wall'), () => dark, { flip })); // tunnel wall
    parts.push(loft(strip('bottomIn'), () => belly, { flip })); // running surface, inboard of the keel
    parts.push(loft(strip('bottomOut'), () => belly, { flip })); // and outboard of it
    parts.push(loft(strip('boot'), () => dark, { flip })); // spray rail
    parts.push(loft(strip('side'), (i) => (ts[i] > TIPS ? accent : hull), { flip }));
    parts.push(loft(strip('gunwale'), () => accent, { flip }));
    parts.push(loft(strip('deck'), (i) => (banded(ts[i]) ? accent : hull), { flip }));
    // transom of the sponson
    const s = sections[0];
    const outline = [s.fork[0], ...s.wall.slice(1), s.bottomIn[1], s.bottomOut[1], s.boot[1], ...s.gunwale, ...s.deck.slice(1)];
    parts.push(fan(outline.map((v) => (side === 1 ? v : mirror(v))), shade, { flip: side === 1 }));
  }

  // ---- the centre body, one smooth skin from side to side
  const cts = stations(36, NOSE, [...BANDS, ...COCKPIT]);
  const us = stations(20, 1, [0.5 - 0.34, 0.5 - 0.105, 0.5 + 0.105, 0.5 + 0.34]);
  const rows = cts.map((t) => resample(centreSection(t), us));
  parts.push(
    loft(rows, (i, j) => {
      const t = cts[i];
      const off = Math.abs(us[j] - 0.5);
      if (t > COCKPIT[0] && t < COCKPIT[1] && off < 0.34) return dark;
      if (off < 0.105) return accent; // a stripe down the middle
      return banded(t) ? accent : hull;
    }),
  );
  // the tunnel roof underneath
  parts.push(loft(cts.map((t) => [V(innerAt(t), TUNNEL, zAt(t)), V(-innerAt(t), TUNNEL, zAt(t))]), () => dark, { flip: true }));
  // transom of the centre body
  const x0 = innerAt(0);
  parts.push(fan([V(x0, TUNNEL, BOAT.sternZ), ...rows[0], V(-x0, TUNNEL, BOAT.sternZ)], shade, { flip: true }));

  // ---- air scoop on the engine cowl: a low arch, open at the front
  {
    const zFront = zAt(0.275);
    const zBack = zAt(0.1);
    const arch = [];
    const R = 12;
    for (let i = 0; i <= R; i++) {
      const u = i / R; // back .. front
      const z = lerp(zBack, zFront, u);
      const t = (z - BOAT.sternZ) / BOAT.length;
      const base = deckEdgeAt(t) + crownAt(t) - 0.012;
      const halfW = lerp(0.07, 0.2, Math.pow(u, 0.7));
      const high = lerp(0.015, 0.125, Math.pow(u, 0.8));
      const row = [];
      for (let j = 0; j <= 10; j++) {
        const a = (j / 10) * Math.PI;
        // a flattened arch with soft shoulders
        const cx = Math.cos(a);
        const sx = Math.sin(a);
        row.push(V(Math.sign(cx) * Math.pow(Math.abs(cx), 0.7) * halfW, base + Math.pow(sx, 0.7) * high, z));
      }
      arch.push(row);
    }
    parts.push(loft(arch, (i) => (i > R - 2 ? accent : hull)));
    parts.push(fan(arch[R], '#050607')); // the mouth
  }

  // ---- fins on the tails of the sponsons, swept back and leaning out a little
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.36, 0);
    shape.lineTo(0.4, 0);
    shape.lineTo(0.05, 0.3);
    shape.quadraticCurveTo(-0.12, 0.4, -0.4, 0.4);
    shape.lineTo(-0.36, 0);
    const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 });
    fin.translate(0, 0, -0.014);
    for (const sx of [1, -1]) {
      parts.push(part(fin, accent, { pos: [sx * 1.0, sheerAt(0.09), zAt(0.09)], rot: [0, -Math.PI / 2, -sx * 0.2], order: 'ZYX' }));
    }
    fin.dispose();
  }
  return merge(parts);
}

/** The canopy: a long glass bubble over the cockpit, fuller toward the front. */
const CANOPY = { z0: -0.95, z1: 0.8, halfWidth: 0.34, height: 0.36 };
const canopyBase = () => deckEdgeAt(0.46) + crownAt(0.46) * 0.72;
/** How full the bubble is along its length: rises quickly at the front, tapers away gently behind. */
const canopyRadius = (u) => Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(u, 1.35)), 0.62));

function buildCanopyGeometry() {
  const tint = new THREE.Color('#0a141d');
  const base = canopyBase();
  const R = 22;
  const C = 18;
  const rows = [];
  for (let i = 0; i <= R; i++) {
    const u = i / R;
    const r = canopyRadius(u);
    const row = [];
    for (let j = 0; j <= C; j++) {
      const a = (j / C) * Math.PI;
      row.push(V(Math.cos(a) * CANOPY.halfWidth * r, base + Math.sin(a) * CANOPY.height * r, lerp(CANOPY.z0, CANOPY.z1, u)));
    }
    rows.push(row);
  }
  return loft(rows, () => tint);
}

function buildTrimGeometry() {
  const dark = '#14171c';
  const rubber = '#0c0e11';
  const steel = '#b9c0c8';
  const parts = [];

  // the frame the canopy sits in
  {
    const base = canopyBase() + 0.004;
    const loop = [];
    const n = 16;
    for (let i = 0; i <= n; i++) loop.push(V(CANOPY.halfWidth * canopyRadius(i / n), base, lerp(CANOPY.z0, CANOPY.z1, i / n)));
    for (let i = n - 1; i >= 1; i--) loop.push(V(-CANOPY.halfWidth * canopyRadius(i / n), base, lerp(CANOPY.z0, CANOPY.z1, i / n)));
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true, 'centripetal'), 48, 0.022, 5, true), dark));
  }
  // mirrors on short stalks either side of the cockpit
  for (const sx of [1, -1]) {
    const y = canopyBase() + 0.05;
    parts.push(part(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 6), dark, { pos: [sx * 0.39, y, 0.42], rot: [0.3, 0, -sx * 1.05] }));
    parts.push(part(new RoundedBoxGeometry(0.15, 0.085, 0.05, 1, 0.02), dark, { pos: [sx * 0.47, y + 0.045, 0.44], rot: [0, -sx * 0.25, 0] }));
    parts.push(part(new RoundedBoxGeometry(0.125, 0.062, 0.01, 1, 0.004), steel, { pos: [sx * 0.474, y + 0.045, 0.412], rot: [0, -sx * 0.25, 0] }));
  }
  // louvres let into the foredeck
  for (const sx of [1, -1]) {
    for (let k = 0; k < 5; k++) {
      const t = 0.665 + k * 0.02;
      parts.push(part(new RoundedBoxGeometry(0.18, 0.014, 0.045, 1, 0.006), rubber, { pos: [sx * 0.2, deckEdgeAt(t) + crownAt(t) * 0.84 + 0.002, zAt(t)], rot: [0.17, 0, -sx * 0.16] }));
    }
  }
  for (const sx of [1, -1]) {
    // rub rails along the sheer, with a rubber nose on each bow
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      pts.push(V(sx * (outerAt(t) + 0.01), sheerAt(t) - 0.03 * clamp01((sheerAt(t) - chineAt(t)) / 0.3), zAt(t)));
    }
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 40, 0.024, 5, false), rubber));
    parts.push(part(new THREE.SphereGeometry(0.05, 10, 8), rubber, { pos: [sx * 0.733, sheerAt(1) - 0.02, BOAT.bowZ], scale: [0.8, 1, 1.4] }));
    // cleats and a filler cap on each deck
    for (const t of [0.34, 0.8]) {
      const x = sx * (outerAt(t) - 0.09);
      const y = sheerAt(t) + 0.035;
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), steel, { pos: [x, y, zAt(t) - 0.035] }));
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), steel, { pos: [x, y, zAt(t) + 0.035] }));
      parts.push(part(new THREE.CapsuleGeometry(0.012, 0.12, 3, 6), steel, { pos: [x, y + 0.018, zAt(t)], rot: [Math.PI / 2, 0, 0] }));
    }
    parts.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 14), steel, { pos: [sx * 0.76, sheerAt(0.42) + 0.047, zAt(0.42)] }));
    // brackets the engines hang on
    parts.push(part(new RoundedBoxGeometry(0.22, 0.24, BOAT.sternZ - BOAT.engineZ + 0.04, 1, 0.03), dark, { pos: [sx * BOAT.engineX, BOAT.engineY + 0.02, (BOAT.sternZ + BOAT.engineZ) / 2] }));
  }
  // a towing eye on the nose
  parts.push(part(new THREE.TorusGeometry(0.035, 0.01, 6, 12), steel, { pos: [0, TUNNEL + 0.05, zAt(NOSE) - 0.02], rot: [0.5, 0, 0] }));
  return merge(parts);
}

/** A rounded-rectangle outline in the horizontal plane (the plan of an engine cowl). */
function ringAt(y, halfW, halfL, zc, n = 20, power = 3) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2; // from the front, round by port
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push(V(Math.sign(s) * Math.pow(Math.abs(s), 2 / power) * halfW, y, zc + Math.sign(c) * Math.pow(Math.abs(c), 2 / power) * halfL));
  }
  return pts;
}

/** One outboard, built round its pivot (the origin). It reaches back along -Z. */
function buildOutboardGeometry(team) {
  const black = new THREE.Color('#0b0c0f');
  const grey = new THREE.Color('#1a1d22');
  const steel = new THREE.Color('#aab1b9');
  const teamColor = new THREE.Color(team.hull);
  const parts = [];

  // the cowl: [height, half width, half length, centre]
  const profile = [
    [-0.1, 0.085, 0.16, -0.15],
    [0.0, 0.11, 0.19, -0.16],
    [0.07, 0.14, 0.24, -0.172],
    [0.1, 0.165, 0.275, -0.18],
    [0.17, 0.185, 0.31, -0.185],
    [0.3, 0.19, 0.325, -0.19],
    [0.42, 0.183, 0.315, -0.2],
    [0.52, 0.163, 0.285, -0.215],
    [0.58, 0.13, 0.235, -0.23],
    [0.615, 0.08, 0.15, -0.24],
    [0.628, 0.02, 0.04, -0.245],
  ];
  const at = (y) => {
    let i = 0;
    while (i < profile.length - 2 && y > profile[i + 1][0]) i++;
    const a = profile[i];
    const b = profile[i + 1];
    const f = smoothstep(0, 1, clamp01((y - a[0]) / (b[0] - a[0])));
    return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
  };
  const STRIPE = [0.2, 0.262, 0.276, 0.288]; // a team band and a pinstripe above it
  const ys = [];
  for (let i = 0; i <= 26; i++) {
    const y = lerp(profile[0][0], profile[profile.length - 1][0], Math.pow(i / 26, 0.85));
    if (!STRIPE.some((c) => Math.abs(y - c) < 0.004)) ys.push(y);
  }
  for (const c of STRIPE) ys.push(c - 0.0005, c + 0.0005);
  ys.sort((a, b) => a - b);
  parts.push(
    loft(
      ys.map((y) => ringAt(y, ...at(y))),
      (i) => {
        const y = ys[i];
        if (y < 0.085) return grey;
        if (y > STRIPE[0] && y < STRIPE[1]) return teamColor;
        if (y > STRIPE[2] && y < STRIPE[3]) return steel;
        return black;
      },
    ),
  );
  parts.push(fan(ringAt(ys[0], ...at(ys[0])).slice(0, -1), grey, { flip: true })); // its underside
  parts.push(fan(ringAt(ys[ys.length - 1], ...at(ys[ys.length - 1])).slice(0, -1), black)); // and the crown
  // the leg, slimmer toward the bottom
  const leg = [-0.43, -0.34, -0.25, -0.17, -0.09];
  parts.push(loft(leg.map((y, i) => ringAt(y, lerp(0.045, 0.085, i / 4), lerp(0.12, 0.16, i / 4), -0.15, 14, 2.6)), () => grey));
  // plate over the propeller, gearcase, skeg
  parts.push(part(new RoundedBoxGeometry(0.22, 0.016, 0.34, 1, 0.007), grey, { pos: [0, -0.35, -0.2] }));
  parts.push(part(new THREE.CapsuleGeometry(0.058, 0.3, 4, 12), grey, { pos: [0, -0.5, -0.13], rot: [Math.PI / 2, 0, 0] }));
  parts.push(part(new THREE.ConeGeometry(0.05, 0.14, 12), steel, { pos: [0, -0.5, -0.4], rot: [-Math.PI / 2, 0, 0] }));
  {
    const skeg = new THREE.Shape();
    skeg.moveTo(0.1, 0);
    skeg.lineTo(-0.16, 0);
    skeg.lineTo(-0.2, -0.17);
    skeg.lineTo(-0.1, -0.17);
    skeg.lineTo(0.1, 0);
    const g = new THREE.ExtrudeGeometry(skeg, { depth: 0.016, bevelEnabled: false });
    g.translate(0, 0, -0.008);
    parts.push(part(g, grey, { pos: [0, -0.55, -0.14], rot: [0, -Math.PI / 2, 0] }));
    g.dispose();
  }
  // three blades
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(part(new THREE.SphereGeometry(0.075, 8, 6), steel, { pos: [Math.cos(a) * 0.075, -0.5 + Math.sin(a) * 0.075, -0.34], rot: [0.5, 0, a], scale: [1, 0.55, 0.1], order: 'ZXY' }));
  }
  return merge(parts);
}

/** Like loft(), but with texture coordinates instead of colours: uvAt(i/rows, j/cols) -> [u, v]. */
function decal(rows, uvAt, { flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const positions = new Float32Array(nr * nc * 3);
  const uvs = new Float32Array(nr * nc * 2);
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const k = i * nc + j;
      const v = rows[i][j];
      positions.set([v.x, v.y, v.z], k * 3);
      uvs.set(uvAt(i / (nr - 1), j / (nc - 1)), k * 2);
    }
  }
  const index = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      if (flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const FONT = 'italic 900 100px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** The race number on a plate, on a ground of hull paint (so the patch disappears into the deck). */
function makePlateTexture(number, team) {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = team.hull;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fbfaf5';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(8, 8, w - 16, h - 16, 22);
    else ctx.rect(8, 8, w - 16, h - 16);
    ctx.fill();
    ctx.fillStyle = '#101318';
    ctx.font = FONT.replace('100px', '96px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), w / 2 - 4, h / 2 + 7);
  }, 8);
}

const SIDE_W = 1024;
const SIDE_H = 176;
/**
 * The graphics along the sides: number roundel, name, speed stripes. Both sides
 * live in one texture (port on top), laid out so the stripes trail toward the
 * stern on each and the lettering reads the right way round.
 */
function makeSideTexture(number, team) {
  return makeCanvasTexture(SIDE_W, SIDE_H * 2, (ctx, w) => {
    ctx.fillStyle = team.hull;
    ctx.fillRect(0, 0, w, SIDE_H * 2);
    for (const port of [true, false]) {
      ctx.save();
      ctx.translate(0, port ? 0 : SIDE_H);
      // the port side is seen with the bow on the left, the starboard side with it on the right
      const X = (fromBow) => (port ? fromBow : w - fromBow);
      const lean = port ? 1 : -1;
      // roundel
      ctx.fillStyle = '#fbfaf5';
      ctx.beginPath();
      ctx.arc(X(104), SIDE_H / 2, 68, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#101318';
      ctx.beginPath();
      ctx.arc(X(104), SIDE_H / 2, 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#101318';
      ctx.font = FONT.replace('100px', '84px');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), X(104) - 3, SIDE_H / 2 + 6);
      // name
      ctx.fillStyle = team.accent;
      ctx.font = FONT.replace('100px', '96px');
      ctx.fillText('BREAKWATER', X(486), SIDE_H / 2 + 8, 520);
      // stripes trailing aft
      for (let k = 0; k < 4; k++) {
        const from = 780 + k * 62;
        const wide = 40 - k * 7;
        ctx.beginPath();
        ctx.moveTo(X(from) + lean * 34, 22);
        ctx.lineTo(X(from + wide) + lean * 34, 22);
        ctx.lineTo(X(from + wide) - lean * 34, SIDE_H - 22);
        ctx.lineTo(X(from) - lean * 34, SIDE_H - 22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }, 8);
}

/** Patches of paintwork that carry pictures: the plates on the stern decks and the graphics on the sides. */
function buildDecals() {
  const plates = [];
  const sides = [];
  for (const side of [1, -1]) {
    const flip = side === -1;
    const place = (v) => (side === 1 ? v : mirror(v));
    // on the deck: read from astern, so the top of the number points at the bow
    const deckRows = stations(6, 1).map((f) => {
      const s = sponsonSection(lerp(0.1, 0.178, f));
      const curve = new THREE.CatmullRomCurve3(s.deck, false, 'centripetal');
      return stations(6, 1).map((g) => place(curve.getPoint(lerp(0.2, 0.93, g))));
    });
    plates.push(decal(deckRows, (f, g) => [side === 1 ? g : 1 - g, f], { flip }));
    // on the side
    const sideRows = stations(24, 1).map((f) => {
      const s = sponsonSection(lerp(0.15, 0.63, f));
      return [0.07, 0.95].map((g) => place(s.side[0].clone().lerp(s.side[1], g)));
    });
    sides.push(decal(sideRows, (f, g) => (side === 1 ? [1 - f, 0.5 + 0.5 * g] : [f, 0.5 * g]), { flip }));
  }
  return { plates: merge(plates), sides: merge(sides) };
}

/** Gel coat. The glossy top layer is the live reflection of the surroundings; underneath it, ordinary lit paint. */
// (Seen from astern the decks are at a glancing angle; a true mirror there would wash the colours out.)
const paint = (options) => withSkyFog(withLiveReflections(new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, envMapIntensity: 0.8, ...options }), { strength: 1.15, base: 0.065, edge: 0.5, blur: 0.9 }));

let decalGeometry = null;

/**
 * Build one boat. Returns a Group with:
 *   userData.engines — the outboards, to turn about Y with the helm
 */
export function createBoat(team, number = 1) {
  const group = new THREE.Group();
  group.name = `boat-${team.name}`;

  const paintMat = paint({ vertexColors: true });
  // glass and the engine cowls: dark, so what they mirror is nearly all you see of them
  const glassMat = withSkyFog(withLiveReflections(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, envMapIntensity: 0.5 }), { strength: 1.5, base: 0.11, edge: 1, blur: 0 }));
  const glossMat = withSkyFog(withLiveReflections(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, envMapIntensity: 0.6 }), { strength: 1.3, base: 0.085, edge: 0.9, blur: 0.2 }));
  const trimMat = withSkyFog(withLiveReflections(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.2 }), { strength: 0.8, base: 0.05, edge: 0.6, blur: 1.4 }));
  const decalOptions = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const plateMat = paint({ map: makePlateTexture(number, team), ...decalOptions });
  const sideMat = paint({ map: makeSideTexture(number, team), ...decalOptions });

  const hull = new THREE.Mesh(buildHullGeometry(team), paintMat);
  hull.name = 'hull';
  const canopy = new THREE.Mesh(buildCanopyGeometry(), glassMat);
  canopy.name = 'canopy';
  const trim = new THREE.Mesh(buildTrimGeometry(), trimMat);
  trim.name = 'trim';
  if (!decalGeometry) decalGeometry = buildDecals(); // the same patches on every boat
  const plates = new THREE.Mesh(decalGeometry.plates, plateMat);
  const sides = new THREE.Mesh(decalGeometry.sides, sideMat);
  group.add(hull, canopy, trim, plates, sides);

  const outboard = buildOutboardGeometry(team);
  const engines = [1, -1].map((sx) => {
    const engine = new THREE.Mesh(outboard, glossMat);
    engine.name = 'outboard';
    engine.position.set(sx * BOAT.engineX, BOAT.engineY, BOAT.engineZ);
    group.add(engine);
    return engine;
  });

  group.userData.engines = engines;
  return group;
}
