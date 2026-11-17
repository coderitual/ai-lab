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
import { hallSite } from './landmarks.js';

/** Margin round each footprint (m). */
const MARGIN = 4;

/**
 * @param {object} track
 * @param {(x: number, z: number) => number} [heightAt] the ground (to find the pale hall's hilltop: landmarks.js)
 * @returns {(x: number, z: number) => boolean}
 */
export function keepOut(track, heightAt) {
  const hall = heightAt ? hallSite(track, heightAt) : null;
  // viewpoints along the ledge's first piece, each with its unit direction to the hall
  const view = [];
  const ledge = track.sections.find((sec) => sec.id === 'ledge');
  if (hall && ledge) {
    for (let d = 30; d <= 270; d += 60) {
      const p = track.pointAt(track.wrap(ledge.s0 + d), 0);
      const l = Math.hypot(hall.x - p.x, hall.z - p.z);
      view.push({ x: p.x, z: p.z, dx: (hall.x - p.x) / l, dz: (hall.z - p.z) / l });
    }
  }
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
    // the hall itself (its cypresses are its own, round it)
    if (hall && (x - hall.x) ** 2 + (z - hall.z) ** 2 < 70 ** 2) return true;
    // the view of it from the ledge's first bend: no tree stands on the line from the road to the hall
    for (const v of view) {
      const dx = x - v.x;
      const dz = z - v.z;
      const along = dx * v.dx + dz * v.dz;
      if (along > 3 && along < 450 && Math.abs(dx * v.dz - dz * v.dx) < 12 + 0.08 * along) return true;
    }
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
