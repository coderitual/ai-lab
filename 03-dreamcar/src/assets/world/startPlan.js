// Where the start's buildings and the town stand, as one test the world's
// planting can ask: keepOut(track)(x, z) is true where no tree may grow. Pure
// (the Track and this lane's own tables, no terrain), so it can be built
// before anything else.
//
// It covers footprints with a margin of a few metres and no more: the pit
// building and the stand (gantry.js PIT, pits.js STAND, placed from the
// gantry's s), and each town's site (town.js TOWNS). Behind them the woods
// stay, as a belt of crowns over the roofs.

import { PIT } from './gantry.js';
import { STAND } from './pits.js';
import { TOWNS } from './town.js';

/** Margin round each footprint (m). */
const MARGIN = 4;

/**
 * @param {object} track
 * @returns {(x: number, z: number) => boolean}
 */
export function keepOut(track) {
  const g0 = track.gantry.s;
  const spot = {};
  const line = track.pointAt(g0, 0);
  // the start's buildings, as ranges of s from the line and of metres beyond the solid edge on one side
  const blocks = [
    { s0: PIT.s0 - 30, s1: PIT.s1 + 30, side: -1, near: 0, far: PIT.beyond + PIT.depth + MARGIN },
    { s0: STAND.s0 - MARGIN, s1: STAND.s1 + MARGIN, side: 1, near: 0, far: STAND.beyond + STAND.rows * STAND.depth + MARGIN },
  ];
  // the towns, as rectangles in their own frame: u along the rows, v up the slope from the first row
  const sites = TOWNS.map((t) => {
    const f = t.face;
    return { x: t.x, z: t.z, f, t: [-f[1], f[0]], half: t.length / 2 + 15, back: t.rows * t.spacing + 15, hotel: t.hotel };
  });
  return (x, z) => {
    for (const s of sites) {
      const dx = x - s.x;
      const dz = z - s.z;
      const u = dx * s.t[0] + dz * s.t[1];
      const v = -(dx * s.f[0] + dz * s.f[1]);
      if (Math.abs(u) < s.half && v > -15 && v < s.back) return true;
      if (s.hotel && (x - s.hotel.x) ** 2 + (z - s.hotel.z) ** 2 < 36 ** 2) return true;
    }
    // only near the start is a block worth locating for
    if (Math.abs(x - line.x) > 200 || Math.abs(z - line.z) > 120) return false;
    track.locate(x, z, -1, spot);
    const ds = track.delta(g0, spot.s);
    for (const b of blocks) {
      if (ds < b.s0 || ds > b.s1 || Math.sign(spot.lat) !== b.side) continue;
      const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, b.side);
      if (beyond > b.near && beyond < b.far) return true;
    }
    return false;
  };
}
