// The town beyond the start: the lit backdrop a driver on the grid sees past
// the end of the straight, and a hamlet on the far shore of the lake across
// from the pits. Houses of two to four floors in rows along the slope, their
// fronts turned towards the circuit, roofs stepping up the hill, a church
// with its tower in each, and a large pale hotel on the height over the lake.
//
// The houses are facade.js's: one mesh of plain boxes on which one material
// draws walls, windows and the rooms behind them, lit by the time of day's
// share of windows (lighting.js lamps.windows). A whole town is one draw call
// and a few thousand triangles, but real geometry: roofs, eaves, chimneys,
// with depth when the title camera circles.
//
// Where: sites chosen on the map once, by looking at the ground (TOWNS below);
// every lot is then tested against the Track (no house within CLEAR m of any
// stretch's solid edge), the lake and the slope, so a change of the road
// moves houses out of its way instead of into it.

import * as THREE from 'three';
import { KIND, createFacadeMaterial, createWriter, surface, writeBuilding } from './facade.js';
import { hallSite } from './landmarks.js';

/** No house nearer than this to the corridor's solid edge (m). */
const CLEAR = 35;
/** Steepest ground a house is put on (rise per metre across its plot). */
const STEEP = 0.75;
/** The pale hall of frame D3: length and depth (m). */
const HALL_SIZE = { w: 58, d: 16 };

/** A slender cone of `sides` triangles (a cypress) standing on a short trunk, written as plain surfaces. */
function cone(w, x, y, z, r, h, rec, trunkRec, sides = 6) {
  const V = (px, py, pz) => new THREE.Vector3(px, py, pz);
  const tip = V(x, y + h, z);
  const foot = y + h * 0.12;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const b = ((k + 1) / sides) * Math.PI * 2;
    const p = V(x + Math.sin(a) * r, foot, z + Math.cos(a) * r);
    const q = V(x + Math.sin(b) * r, foot, z + Math.cos(b) * r);
    const out = V(Math.sin((a + b) / 2), 0.15, Math.cos((a + b) / 2));
    w.poly([p, q, tip], [[0, 0], [1, 0], [0.5, h]], rec, out);
  }
  w.box(V(x, 0, z), V(1, 0, 0), V(0, 0, 1), r * 0.25, r * 0.25, y, foot + 0.2, trunkRec, { top: false });
}

/**
 * The sites, on the map: origin, the direction the fronts face (towards the circuit, level unit vector), how many
 * rows up the slope, how long a row, row spacing. `hotel`: the pale building on the height.
 */
export const TOWNS = [
  { name: 'east', x: 600, z: 40, face: [-1, 0], rows: 7, length: 300, spacing: 24, church: [3, 0.45], hotel: { x: 815, z: -95 } },
  { name: 'shore', x: 40, z: -585, face: [0, 1], rows: 3, length: 320, spacing: 22, church: [1, 0.6] },
];

const PALETTE = [
  { wall: [0.58, 0.42, 0.25], trim: [0.62, 0.58, 0.5], mat: 0 },
  { wall: [0.6, 0.36, 0.3], trim: [0.66, 0.62, 0.56], mat: 0 },
  { wall: [0.66, 0.6, 0.48], trim: [0.5, 0.48, 0.44], mat: 0 },
  { wall: [0.62, 0.52, 0.3], trim: [0.68, 0.66, 0.6], mat: 0 },
  { wall: [0.42, 0.41, 0.39], trim: [0.56, 0.55, 0.52], mat: 1 },
  { wall: [0.56, 0.4, 0.38], trim: [0.64, 0.6, 0.56], mat: 0 },
  { wall: [0.68, 0.67, 0.63], trim: [0.46, 0.45, 0.43], mat: 0 },
];
const SHUTTERS = [[0.07, 0.13, 0.09], [0.16, 0.09, 0.05], [0.1, 0.12, 0.16], [0.3, 0.3, 0.28]];
const ROOFS = [[0.3, 0.13, 0.08], [0.24, 0.12, 0.08], [0.2, 0.14, 0.11], [0.11, 0.11, 0.12]];

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {string} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/rng.js').Rng} options.rng
 */
export function createTown({ track, terrain, tier, atmosphere, rng }) {
  const facade = createFacadeMaterial({ tier, atmosphere });
  const w = createWriter();
  const spot = {};
  const lakeLevel = terrain.lake?.level ?? -1.8;
  let houses = 0;
  /** Whether a point of the map is far enough from every stretch of road. */
  const clear = (x, z) => {
    track.locate(x, z, -1, spot);
    const side = spot.lat >= 0 ? 1 : -1;
    return Math.abs(spot.lat) - track.edgeAt(spot.s, side) > CLEAR;
  };

  /** A lot: front line from A to B (the fronts face `f`), depth d away from it. */
  const lot = (ax, az, bx, bz, f, d, style) => {
    const ox = -f[0];
    const oz = -f[1];
    const width = Math.hypot(bx - ax, bz - az);
    return { ax, az, bx, bz, ox, oz, w: width, d, openA: true, openB: true, ...style };
  };
  /** Puts a lot down if its plot is clear, dry and not too steep; returns whether it did. */
  const place = (L, r) => {
    const corners = [
      [L.ax, L.az],
      [L.bx, L.bz],
      [L.bx + L.ox * L.d, L.bz + L.oz * L.d],
      [L.ax + L.ox * L.d, L.az + L.oz * L.d],
    ];
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of corners) {
      if (!clear(x, z)) return false;
      const y = terrain.heightAt(x, z);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (lo < lakeLevel + 0.8) return false;
    if ((hi - lo) / Math.max(L.w, L.d) > STEEP) return false;
    const y0 = terrain.heightAt((L.ax + L.bx) / 2, (L.az + L.bz) / 2);
    writeBuilding(w, L, y0, lo, r);
    houses++;
    return true;
  };
  const style = (r, k, extra = {}) => {
    const look = PALETTE[(k + r.int(3)) % PALETTE.length];
    const floors = 1 + r.int(3);
    const roofs = ['gable', 'hip', 'gable', 'hip', 'flat'];
    return {
      kind: 'house',
      floors,
      groundH: r.range(3.2, 3.6),
      floorH: r.range(2.9, 3.2),
      attic: r.range(0.35, 0.7),
      roof: roofs[r.int(roofs.length)],
      ground: 'plain',
      mat: look.mat,
      age: r.range(0.3, 0.9),
      wall: look.wall,
      trim: look.trim,
      shutter: SHUTTERS[r.int(SHUTTERS.length)],
      roofColor: ROOFS[r.int(3)],
      win: { w: r.range(0.95, 1.15), h: r.range(1.45, 1.7), sill: 0.9, arch: 0, shutters: r.next() < 0.6 ? 1 : 0, surround: r.next() < 0.5 ? 1 : 0, rail: 0 },
      bay: r.range(2.7, 3.3),
      margin: r.range(0.5, 0.9),
      seed: 500 + k * 7 + r.int(5),
      flags: {},
      pitch: r.range(0.45, 0.6),
      ...extra,
    };
  };

  let k = 0;
  for (const site of TOWNS) {
    const r = rng.fork(site.name);
    const f = site.face;
    // along a row: to the right of the fronts' direction; up the slope: away from it
    const t = [-f[1], f[0]];
    for (let row = 0; row < site.rows; row++) {
      // rows stagger, and get shorter up the hill
      const len = site.length * (1 - row * 0.07);
      let u = -len / 2 + r.range(0, 8);
      const back = row * site.spacing + r.range(-3, 3);
      while (u < len / 2) {
        const width = r.range(8, 14);
        const depth = r.range(9, 12);
        const bend = Math.sin((u / site.length) * 3.1 + row) * 6;
        const ox = site.x - f[0] * (back + bend);
        const oz = site.z - f[1] * (back + bend);
        const A = [ox + t[0] * u, oz + t[1] * u];
        const B = [ox + t[0] * (u + width), oz + t[1] * (u + width)];
        const isChurch = site.church && row === site.church[0] && Math.abs(u / len + 0.5 - site.church[1]) < 0.03;
        if (isChurch) {
          // the church end-on with its tower beside the gable
          const nave = lot(A[0], A[1], A[0] + t[0] * 12, A[1] + t[1] * 12, f, 24, style(r, k, {
            kind: 'church', floors: 1, groundH: 6.2, floorH: 5, roof: 'front', ground: 'church', mat: 0, wall: [0.63, 0.57, 0.46],
            win: { w: 1.3, h: 3.2, sill: 1.1, arch: 1, shutters: 0, surround: 1, rail: 0 }, bay: 5, margin: 1.2, pitch: 0.62, roofColor: ROOFS[1],
          }));
          place(nave, r);
          const tower = lot(A[0] + t[0] * 12.5, A[1] + t[1] * 12.5, A[0] + t[0] * 18.5, A[1] + t[1] * 18.5, f, 6, style(r, k, {
            kind: 'tower', floors: 5, groundH: 5.2, floorH: 4.2, attic: 0.5, roof: 'spire', ground: 'plain', mat: 1, wall: [0.47, 0.44, 0.39],
            win: { w: 0.7, h: 1.9, sill: 1.2, arch: 1, shutters: 0, surround: 0, rail: 0 }, bay: 6, margin: 0.9, pitch: 1.2, flags: { tower: 1 }, roofColor: ROOFS[1],
          }));
          place(tower, r);
          u += 22;
          k++;
          continue;
        }
        place(lot(A[0], A[1], B[0], B[1], f, depth, style(r, k)), r);
        k++;
        u += width + (r.next() < 0.3 ? r.range(4, 9) : r.range(0.5, 2.5));
      }
    }
    if (site.hotel) {
      // the pale hotel on the height: long, five floors, a slate mansard, balconies
      const { x, z } = site.hotel;
      const L = lot(x - t[0] * 24, z - t[1] * 24, x + t[0] * 24, z + t[1] * 24, f, 16, style(r, k++, {
        kind: 'grand', floors: 5, groundH: 4.8, floorH: 3.4, attic: 0.6, roof: 'mansard', ground: 'lobby', mat: 0, age: 0.25,
        wall: [0.74, 0.71, 0.63], trim: [0.58, 0.56, 0.52], roofColor: ROOFS[3],
        win: { w: 1.3, h: 2.2, sill: 0.15, arch: 0, shutters: 0, surround: 1, rail: 0 }, bay: 3.3, margin: 1.0, flags: { balconies: 1 }, pitch: 0.5,
      }));
      place(L, r);
    }
  }

  // ---- the pale hall on the hilltop that the ledge's first bend looks at (frame D3), among dark slender trees
  const hall = hallSite(track, terrain.heightAt);
  if (hall) {
    const r = rng.fork('hall');
    const f = hall.face;
    const t = [-f[1], f[0]];
    const half = HALL_SIZE.w / 2;
    const ax = hall.x - t[0] * half + f[0] * HALL_SIZE.d / 2;
    const az = hall.z - t[1] * half + f[1] * HALL_SIZE.d / 2;
    const L = lot(ax, az, ax + t[0] * HALL_SIZE.w, az + t[1] * HALL_SIZE.w, f, HALL_SIZE.d, style(r, k++, {
      kind: 'grand', floors: 3, groundH: 4.4, floorH: 3.6, attic: 0.7, roof: 'hip', ground: 'plain', mat: 0, age: 0.3,
      wall: [0.8, 0.76, 0.66], trim: [0.66, 0.63, 0.57], roofColor: ROOFS[0],
      win: { w: 1.25, h: 2.1, sill: 0.8, arch: 0, shutters: 1, surround: 1, rail: 0 }, bay: 3.1, margin: 1.2, pitch: 0.45,
    }));
    // a hilltop is not level: the hall stands on a plinth down to the lowest corner (no slope test)
    let lo = Infinity;
    for (const [x, z] of [[L.ax, L.az], [L.bx, L.bz], [L.bx + L.ox * L.d, L.bz + L.oz * L.d], [L.ax + L.ox * L.d, L.az + L.oz * L.d]]) lo = Math.min(lo, terrain.heightAt(x, z));
    writeBuilding(w, L, terrain.heightAt((L.ax + L.bx) / 2, (L.az + L.bz) / 2), lo, r);
    houses++;
    // cypresses: dark narrow cones, in loose groups round the hall
    const green = surface({ kind: KIND.SOLID, color: [0.035, 0.05, 0.03], seed: 9 });
    const trunk = surface({ kind: KIND.SOLID, color: [0.05, 0.04, 0.03], seed: 9 });
    const n = tier === 'low' ? 14 : 26;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(HALL_SIZE.w * 0.55, HALL_SIZE.w * 1.1);
      const x = hall.x + Math.sin(a) * d;
      const z = hall.z + Math.cos(a) * d;
      const y = terrain.heightAt(x, z) - 0.3;
      const h = r.range(9, 17);
      cone(w, x, y, z, h * 0.09, h, green, trunk);
    }
  }

  const geometry = w.build();
  const mesh = new THREE.Mesh(geometry, facade.material);
  mesh.name = 'town';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'town';
  group.add(mesh);
  return {
    group,
    stats: { houses, triangles: w.triangles },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      facade.setTime(time, time.wetness ?? 0);
    },
    dispose() {
      geometry.dispose();
      facade.dispose();
    },
  };
}
