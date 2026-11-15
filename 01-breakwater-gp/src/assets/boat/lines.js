// The shape of the boat, as numbers: its lines from stern to bow, its
// cross-sections, and how its surfaces are laid out on the texture sheet.
// Everything else in this folder (geometry, paintwork, detail maps) is derived
// from these, so that a painted stripe and the edge it follows cannot disagree.
//
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.
// `t` runs along the hull: 0 at the transom, 1 at the tips of the bows.

import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../../engine/math.js';

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

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const mirror = (v) => V(-v.x, v.y, v.z);
export const ramp = (t, from, to) => clamp01((t - from) / (to - from));

/** Evenly spaced values 0..end (n steps), optionally bunched toward the end with `power`. */
export function steps(n, end = 1, power = 1) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(Math.pow(i / n, power) * end);
  return out;
}

/** A smooth curve through `points`, sampled at parameters 0..1. */
export function resample(points, params) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return params.map((u) => curve.getPoint(u));
}

// ---- lines
export const zAt = (t) => lerp(BOAT.sternZ, BOAT.bowZ, t);
export const tAt = (z) => (z - BOAT.sternZ) / BOAT.length;
export const outerAt = (t) => lerp(BOAT.halfBeam, 0.74, Math.pow(ramp(t, 0.5, 1), 1.7)); // outer edge of a sponson
export const innerAt = (t) => lerp(0.46, 0.725, Math.pow(ramp(t, 0.6, 1), 2.4)); // its tunnel side
export const keelAt = (t) => -0.24 + 0.64 * Math.pow(ramp(t, 0.58, 1), 1.9);
export const chineAt = (t) => -0.04 + 0.5 * Math.pow(ramp(t, 0.5, 1), 1.7);
export const sheerAt = (t) => 0.5 + 0.1 * Math.sin(Math.PI * Math.min(t / 0.92, 1)) - 0.03 * ramp(t, 0.92, 1);
export const deckEdgeAt = (t) => sheerAt(t) + 0.02;

export const TUNNEL = 0.3; // underside of the centre body
export const NOSE = 0.8; // the centre body ends here; ahead of it the tunnel is open to the sky
/** How far the centre line stands above the deck edge: stern deck, engine cowl, cockpit, foredeck. */
export const crownAt = (t) => 0.03 + 0.27 * smoothstep(0.05, 0.2, t) - 0.06 * smoothstep(0.28, 0.4, t) - 0.2 * smoothstep(0.56, 0.76, t);
/** 0 along the body, 1 at the nose, where the centre body rounds down into the tunnel. */
export const noseAt = (t) => Math.pow(smoothstep(0.7, NOSE, t), 2);
/** Height of the centre body's surface at (x, t): used to stand things on it. */
export function bodyTopAt(t, x = 0) {
  const n = noseAt(t);
  const edge = lerp(deckEdgeAt(t), TUNNEL + 0.01, n);
  const k = clamp01(1 - Math.abs(x) / innerAt(t));
  // the same shoulder the section below draws, near enough
  return edge + crownAt(t) * (1 - n) * smoothstep(0, 1, Math.pow(k, 0.75));
}

const GUNWALE = steps(4);
const DECK = steps(9);

/** One sponson's cross-section on the port side, as the strips it is skinned from. */
export function sponsonSection(t) {
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

/**
 * The centre body's cross-section, from the port sponson's deck over the crown
 * to the starboard one. It leaves the deck level and only then climbs, so the
 * two meet in a smooth hollow instead of a crease.
 */
export function centreSection(t) {
  const z = zAt(t);
  const xi = innerAt(t);
  const n = noseAt(t);
  const edge = lerp(deckEdgeAt(t), TUNNEL + 0.01, n);
  const crown = crownAt(t) * (1 - n);
  const half = [V(xi, edge, z), V(xi - 0.045, edge + crown * 0.03, z), V(xi * 0.8, edge + crown * 0.42, z), V(xi * 0.52, edge + crown * 0.9, z)];
  return [...half, V(0, edge + crown, z), ...half.map(mirror).reverse()];
}

/** The canopy: a long glass bubble over the cockpit, fuller toward the front. */
export const CANOPY = { z0: -0.95, z1: 0.8, halfWidth: 0.34, height: 0.37 };
export const canopyBase = () => deckEdgeAt(0.46) + crownAt(0.46) * 0.72;
/** How full the bubble is along its length: rises quickly at the front, tapers away gently behind. */
export const canopyRadius = (u) => Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(u, 1.35)), 0.62));

// ---------------------------------------------------------------------------
// The texture sheet. One picture carries every painted surface:
//
//   +--------------------------------------------------------------+
//   |  TOP: the boat seen from above, stern left, port side up.    |
//   |  (The open water between the bows is not wasted: the three   |
//   |   transoms and a patch of plain white live there.)           |
//   +--------------------------------------------------------------+
//   |  PORT side, seen from outside (bow left)                     |
//   +--------------------------------------------------------------+
//   |  STARBOARD side, seen from outside (bow right)               |
//   +--------------------------------------------------------------+
//
// Sizes are in pixels of the full-size sheet; smaller sheets scale everything.

export const SHEET = { w: 2048, h: 1280 };
const Z0 = -2.78;
const Z1 = 3.18;
const XMAX = 1.13;
/** Pixels per metre in the top view and along the sides. */
export const SCALE = SHEET.w / (Z1 - Z0);
export const TOP = { x: 0, y: 0, w: SHEET.w, h: Math.ceil(2 * XMAX * SCALE), z0: Z0, z1: Z1, xMax: XMAX };
const SIDE_TOP = 0.74;
const SIDE_BOTTOM = -0.3;
const SIDE_H = 240;
/** Pixels per metre up the sides. */
export const SIDE_SCALE = SIDE_H / (SIDE_TOP - SIDE_BOTTOM);
export const PORT = { x: 0, y: TOP.h + 12, w: SHEET.w, h: SIDE_H, yTop: SIDE_TOP, yBottom: SIDE_BOTTOM };
export const STBD = { x: 0, y: PORT.y + SIDE_H + 8, w: SHEET.w, h: SIDE_H, yTop: SIDE_TOP, yBottom: SIDE_BOTTOM };
/** Pixels per metre on the transoms. */
export const TRANSOM_SCALE = 250;
const HOLE_X = Math.round((2.05 - Z0) * SCALE);
/** The sponson transoms, seen from astern: x from `xOuter` inward, y from `yTop` down. */
export const TRANSOM_PORT = { x: HOLE_X, y: 228, w: 165, h: 213, xOuter: 1.1, yTop: 0.58 };
export const TRANSOM_STBD = { x: HOLE_X + 173, y: 228, w: 165, h: 213, xOuter: -0.44, yTop: 0.58 };
export const TRANSOM_MID = { x: HOLE_X, y: 448, w: 240, h: 85, xOuter: 0.48, yTop: 0.62 };
/** Plain white: where everything that is coloured by its vertices looks. */
export const BLANK = { x: HOLE_X + 255, y: 455, w: 80, h: 70 };

const uv = (px, py) => [px / SHEET.w, 1 - py / SHEET.h];
export const uvTop = (p) => uv((p.z - Z0) * SCALE, (XMAX - p.x) * SCALE);
export const uvPort = (p) => uv((Z1 - p.z) * SCALE, PORT.y + (SIDE_TOP - p.y) * SIDE_SCALE);
export const uvStbd = (p) => uv((p.z - Z0) * SCALE, STBD.y + (SIDE_TOP - p.y) * SIDE_SCALE);
export const uvSide = (p) => (p.x >= 0 ? uvPort(p) : uvStbd(p));
/** Texture coordinates on a transom: 1 = the port sponson's, -1 = the starboard one's, 0 = the centre body's. */
export const uvTransom = (which) => {
  const c = which === 0 ? TRANSOM_MID : which > 0 ? TRANSOM_PORT : TRANSOM_STBD;
  return (p) => uv(c.x + (c.xOuter - p.x) * TRANSOM_SCALE, c.y + (c.yTop - p.y) * TRANSOM_SCALE);
};
export const UV_BLANK = uv(BLANK.x + BLANK.w / 2, BLANK.y + BLANK.h / 2);
