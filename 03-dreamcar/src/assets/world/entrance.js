// A tunnel's entrance, set into the hillside (docs/design.md, "The approach
// to the tunnel"; the numbers are approach.js's): a pale headwall across the
// face, level on the hill's side out to where the meadow has climbed to its
// top and running down into the grass on the other; a hood with a rounded arch
// standing out of it round the mouth; low walls along the road at the solid
// edges, where the Track's edge is a wall; and the ground the headwall holds
// back (the apron: the terrain's own height function, drawn with its material
// where the terrain's grid is left open).
//
// The bore is the tunnel's box (tunnel.js) and is not changed: the hood's
// arch is wider and higher than the box at its front and falls to the box's
// own opening at the face, where the face plate closes the box's upper
// corners outside the arch. Nothing here stands inside the solid edges; what
// is over the road is the hood's soffit, 5.7 m up at the kerbs.

import * as THREE from 'three';
import { APPROACH, frontGround, headwallTop, hoodArch } from './approach.js';
import { levelFrame } from './furniture.js';
import { GLOW, PAINT, UNIT_BOX, chevrons, pictogram, place } from './parts.js';

/** Cast concrete, pale and clean (linear albedo; the concrete's material adds board marks and faint stains). */
const PALE = [0.26, 0.275, 0.255];
/** How far the low walls stand back towards the box's own beside the mouth at most (m): tunnel.js CUT.back. */
const BACK = 0.7;
/** The low wall: its top over the ground it holds, its width (it laps over the ground behind it). */
const WALL = { over: 0.12, wide: 0.9 };

/**
 * The entrance's face in the Track's own terms: P(lat, h, out) with `lat` metres LEFT of the centre line and `out`
 * metres in front of the face (towards whoever drives up to it); M the same for a unit shape facing outwards.
 */
function faceFrame(track, A) {
  const { P, M, f } = place(track, A.s0, -1);
  return {
    P: (lat, h, out = 0) => P(-lat, h, out),
    M: (lat, h, out, size, tilt = null) => M(-lat, h, out, size, tilt),
    /** Unit directions: out of the face, to the left of the road, up. */
    out: f.ahead.clone().negate(),
    left: f.flat.clone(),
    up: new THREE.Vector3(0, 1, 0),
  };
}

/**
 * The headwall, the hood and what hangs on them.
 * @param {object} o track, A (the approach), Wb (the box's half width, wall to wall), ceiling (the box's, m over the
 *   road), cast (concrete), paint, glow (Parts), low (the low tier: fewer facets)
 */
export function buildEntrance({ track, A, Wb, ceiling, cast, paint, glow, low }) {
  const { P, M, out, left } = faceFrame(track, A);
  const H = APPROACH.hood;
  const W = APPROACH.headwall;
  const up = A.up;
  const latUp = up * (A.edge[up] + A.upEnd);
  const latDown = -up * (A.edge[-up] + A.downEnd);
  const deep = -4;

  // ---- the opening: the hood's arch, cut off at the box's ceiling
  const N = low ? 12 : 24;
  /** A profile of the arch from the left springing's foot to the right one: [lat, h][]; `clip`: under the ceiling. */
  const profile = (outer, clip) => {
    const w = Wb + (outer ? H.thick : 0);
    const pts = [[w, -0.5]];
    for (let k = 0; k <= N; k++) {
      const c = Math.cos((Math.PI * k) / N);
      const lat = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / H.round);
      const h = hoodArch(lat, Wb, outer);
      pts.push([lat, clip ? Math.min(h, ceiling) : h]);
    }
    pts.push([-w, -0.5]);
    return pts;
  };
  const mouth = profile(false, true);
  const inner = profile(false, false);
  const outer = profile(true, false);

  // ---- the face: the headwall's outline with the opening cut out of it
  const outline = [new THREE.Vector2(latDown, deep), new THREE.Vector2(latDown, headwallTop(A, latDown))];
  outline.push(new THREE.Vector2(-up * (A.edge[-up] + W.level), W.top), new THREE.Vector2(latUp, W.top), new THREE.Vector2(latUp, deep));
  const shape = new THREE.Shape(outline);
  shape.holes.push(new THREE.Path(mouth.map(([lat, h]) => new THREE.Vector2(lat, h))));
  const face = new THREE.ShapeGeometry(shape);
  const fp = face.attributes.position;
  const fi = face.index;
  for (let i = 0; i < fi.count; i += 3) cast.poly([0, 1, 2].map((k) => P(fp.getX(fi.getX(i + k)), fp.getY(fi.getX(i + k)), 0)), PALE, out);
  face.dispose();
  // its coping: a lip standing a little proud along the top, level and down the wing
  {
    const top = [
      [latDown, headwallTop(A, latDown)],
      [-up * (A.edge[-up] + W.level), W.top],
      [latUp, W.top],
    ];
    const lip = PALE.map((c) => c * 1.06);
    cast.strip(
      top.map(([lat, h]) => [P(lat, h - 0.4, 0.14), P(lat, h + 0.12, 0.14), P(lat, h + 0.12, 0.14), P(lat, h + 0.12, -0.8)]),
      lip,
      out,
    );
    cast.strip(
      top.map(([lat, h]) => [P(lat, h - 0.4, 0.14), P(lat, h - 0.4, 0)]),
      lip,
      new THREE.Vector3(0, -1, 0),
    );
  }

  // ---- the hood: its soffit from the box's opening out to the arch, its front, its back
  const at = (pts, out) => pts.map(([lat, h]) => P(lat, h, out));
  // (their first faces are the left jamb's: the soffit looks into the arch, the back away from it)
  cast.strip([at(mouth, 0), at(inner, H.depth)], PALE.map((c) => c * 0.9), left.clone().negate());
  cast.strip([at(outer, H.depth), at(outer, 0)], PALE, left);
  for (let k = 0; k < inner.length - 1; k++) {
    cast.poly([P(inner[k][0], inner[k][1], H.depth), P(inner[k + 1][0], inner[k + 1][1], H.depth), P(outer[k + 1][0], outer[k + 1][1], H.depth), P(outer[k][0], outer[k][1], H.depth)], PALE.map((c) => c * 1.04), out);
  }

  // ---- on it: red and white hazard boards on the jambs, signal heads under the arch, a blue sign beside the mouth
  for (const side of [1, -1]) {
    chevrons(paint, (l, h, along) => P(l, h, along), side * (Wb + H.thick / 2), 0.35, H.thick - 0.24, 2.1, 0.3, H.depth + 0.03, [PAINT.white, PAINT.red]);
    const lat = side * 4.2;
    const h = hoodArch(lat, Wb) - 0.1;
    paint.add(UNIT_BOX, M(lat, h - 0.15, H.depth - 0.35, [0.06, 0.4, 0.06]), PAINT.steel);
    paint.add(UNIT_BOX, M(lat, h - 0.75, H.depth - 0.35, [0.36, 0.8, 0.26]), PAINT.signal);
    glow.add(UNIT_BOX, M(lat, h - 0.95, H.depth - 0.21, [0.2, 0.2, 0.02]), GLOW.signal);
  }
  {
    const lat = up * (Wb + H.thick + 1.5);
    const foot = frontGround(A, up, Math.abs(lat) - A.edge[up]);
    pictogram(paint, M(lat, foot + 2.1, 0.05, [1, 1, 1]));
  }
}

/**
 * The low walls along the road before the face, where the Track's solid edge is a wall's: upright, as high as the
 * ground they hold (the terrain's cliff there, which the approach makes a metre), a flat top lapping over that ground.
 * @param {object} o track, terrain, A, Wb, cast, low
 */
export function buildLowWalls({ track, terrain, A, Wb, cast, low }) {
  const prof = { y: 0 };
  const step = low ? 4 : 2;
  const s1 = A.s0 - APPROACH.hood.depth;
  for (const side of [1, -1]) {
    // (the wall on the side away from the hill turns its face from the day's sun: it is cast paler, so that it reads
    // as a pale kerb under the meadow and not as a dark band)
    const cap = PALE.map((c) => c * (side === A.up ? 1.05 : 1.7));
    const kinds = side > 0 ? track.kindL : track.kindR;
    // from where the edge becomes a wall's (the Track's kind 1: what stands there is solid)
    let s0 = s1;
    while (s0 > A.s0 - APPROACH.before - APPROACH.ease && kinds[Math.round(track.wrap(s0 - 1) / track.ds) % track.count] === 1) s0 -= 1;
    if (s1 - s0 < 2) continue;
    const rows = [];
    const n = Math.ceil((s1 - s0) / step);
    for (let r = 0; r <= n; r++) {
      const s = track.wrap(s0 + ((s1 - s0) * r) / n);
      const f = levelFrame(track, s, {});
      const solid = track.edgeAt(s, side);
      const face = solid + Math.min(BACK, Math.max(0, Wb - solid));
      const yE = track.profile(s, side * solid, prof).y;
      const h = Math.max(0.3, terrain.cliffAt(s, side).height) + WALL.over;
      const at = (d, y) => new THREE.Vector3(f.pos.x + f.flat.x * side * (face + d), y, f.pos.z + f.flat.z * side * (face + d));
      rows.push([at(0, yE - 0.5), at(0, yE + h), at(0, yE + h), at(WALL.wide, yE + h), at(WALL.wide, yE + h), at(WALL.wide, yE + h - 0.5)]);
    }
    // (its first face is the one towards the road)
    const f0 = levelFrame(track, track.wrap(s0), {});
    cast.strip(rows, cap, f0.flat.clone().multiplyScalar(-side));
    // the end that faces the traffic
    const e = rows[0];
    cast.poly([e[0], e[5].clone().setY(e[0].y), e[4], e[1]], cap, f0.ahead.clone().negate());
  }
}

/**
 * The ground behind the headwall: the terrain's own height function over the strip of its grid that is left open
 * under the wall (terrain.js), drawn with the terrain's material. Its first rows stand at the height the wall holds.
 * @param {object} o track, terrain, A, low
 * @returns {THREE.BufferGeometry}
 */
export function buildApron({ track, terrain, A, low }) {
  const frame = levelFrame(track, A.s0, {});
  const up = A.up;
  const cell = terrain.cell ?? 6;
  // the grid leaves out whole triangles: up to a cell beyond the wall's ends, and a cell and three quarters behind it
  const end = (side) => A.edge[side] + (side === up ? A.upEnd : A.downEnd) + 3 + cell + 2;
  const reach = 1.75 * cell + 2;
  const stepLat = low ? 4 : 2;
  const stepU = low ? 3.5 : 2;
  const pos = [];
  const bake = [];
  const mask = [];
  const index = [];
  const b = [0, 0, 0, 1];
  /** A sheet of ground from lat0 to lat1 and u0 to u1 (m into the hill; negative: in front of the face). */
  const sheet = (lat0, lat1, u0, u1) => {
    const cols = Math.max(1, Math.ceil(Math.abs(lat1 - lat0) / stepLat));
    const rows = Math.max(1, Math.ceil((u1 - u0) / stepU));
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const u = u0 + ((u1 - u0) * r) / rows;
      // (the height function turns from the ground in front to the ground behind over a metre round the face)
      const uh = u1 > 0 ? Math.max(u, 1.6) : Math.min(u, -1.6);
      for (let c = 0; c <= cols; c++) {
        const lat = lat0 + ((lat1 - lat0) * c) / cols;
        const x = frame.pos.x + frame.flat.x * lat + frame.ahead.x * u;
        const z = frame.pos.z + frame.flat.z * lat + frame.ahead.z * u;
        const xh = x + frame.ahead.x * (uh - u);
        const zh = z + frame.ahead.z * (uh - u);
        pos.push(x, terrain.heightAt(xh, zh), z);
        (terrain.bake4At ?? terrain.bakeAt)(x, z, b, 0);
        bake.push(b[0], b[1], b[2], b[3]);
        mask.push(0, -(terrain.placeAt?.(xh, zh)?.meadow ?? 0));
      }
    }
    const m = cols + 1;
    // wound to face up: lat runs to the left, u into the hill
    const flip = lat1 > lat0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = base + r * m + c;
        if (flip) index.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
        else index.push(v, v + 1, v + m, v + 1, v + m + 1, v + m);
      }
    }
  };
  // behind the face, from end to end
  sheet(-end(-1), end(1), 0, reach);
  // in front of it, beyond the band's reach (the band is the ground in front of the wall)
  const band = terrain.bandReach ?? 27;
  for (const side of [1, -1]) {
    const from = A.edge[side] + band;
    if (end(side) > from) sheet(side * from, side * end(side), -(cell + 2), 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 4));
  geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
