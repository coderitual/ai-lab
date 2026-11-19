// Landmarks placed by looking at the land: where a building far off stands so
// that a given stretch of road looks at it. Pure (the Track and the ground's
// height function), worked out once and shared by whoever builds the thing
// (town.js) and whoever keeps the forest off it (startPlan.js).
//
// The pale hall on a hilltop of frame D3: from the ledge's first bend (the
// first piece of the section `ledge`), on the left of the way the road runs
// there, 600 to 1100 m off, 14 to 48 degrees left (28 preferred), the most prominent open ground that is clear of every
// stretch of road; it faces the bend.

/** Where to look from, and how: degrees left of the road's heading, metres off. */
const HALL = { along: 105, angles: [14, 66], prefer: 28, range: [400, 1100], clear: 70 };

/**
 * (day lane) THE PLACE OF FRAME K5 (the owner's strict spec at dusk): the end of the sweepback's first piece, where the
 * road, high over the bay, has run due south off the gully bridge and begins its long right turn down to the shore.
 * `along` m into the section `sweepback` is where the car stands; seen from there, bearings `view` (degrees on the
 * map, 0 = +Z, clockwise towards +X... as atan2(x, z)) out to `reach` m are the frame's: the bay and the open sea to
 * the horizon, the far shore, the far cones. Nothing built for another frame may stand there (the hall moves out of
 * it), and K5's own scenery (k5.js) is placed from here: the drum `tower` beyond the right edge (`ahead` m past the
 * place, its wall `beyond` m behind the solid edge, radius and height), two feather `flags` and a `chevron` board
 * beyond the left edge, warm `lamps` far below on the left, and the far `cones` across the sea (far.js: bearing from
 * the place, distance, height, base radius).
 */
export const K5 = {
  section: 'sweepback',
  along: 101,
  view: [128, 238],
  reach: 3000,
  tower: { ahead: 24, beyond: 6, r: 11, h: 18 },
  flags: [{ ahead: 18, beyond: 2, h: 7 }, { ahead: 55, beyond: 2.5, h: 7 }],
  chevron: { ahead: 28, beyond: 0.8 },
  lamps: { count: 16, near: 260, far: 1600, bearings: [150, 235] },
  cones: [
    { bearing: 210, dist: 15000, h: 1750, r: 4600 },
    { bearing: 198, dist: 16500, h: 1600, r: 4200 },
    { bearing: 168, dist: 15000, h: 1800, r: 4600 },
  ],
};

/**
 * @param {object} track
 * @returns {{ s: number, x: number, y: number, z: number, heading: number } | null} the place (on the centre line) and
 *   the road's bearing there (degrees, atan2(x, z))
 */
export function k5Site(track) {
  const sec = track.sections.find((x) => x.id === K5.section);
  if (!sec) return null;
  const s = track.wrap(sec.s0 + K5.along);
  const f = track.frameAt(s, {});
  return { s, x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: (Math.atan2(f.tan.x, f.tan.z) * 180) / Math.PI };
}

/** Whether a point of the map lies in frame K5's view (and so must not carry another frame's landmark). */
export function inK5View(track, x, z) {
  const k = k5Site(track);
  if (!k) return false;
  const d = Math.hypot(x - k.x, z - k.z);
  if (d > K5.reach) return false;
  if (d < 260) return true;
  const b = ((Math.atan2(x - k.x, z - k.z) * 180) / Math.PI + 360) % 360;
  return b > K5.view[0] && b < K5.view[1];
}

const cache = new WeakMap();

/**
 * @param {object} track
 * @param {(x: number, z: number) => number} heightAt
 * @returns {{ x: number, z: number, y: number, face: number[] } | null} the hall's middle, its ground, and the
 *   level unit vector its front faces (towards the bend)
 */
export function hallSite(track, heightAt) {
  if (cache.has(track)) return cache.get(track);
  const ledge = track.sections.find((sec) => sec.id === 'ledge');
  let best = null;
  if (ledge) {
    const s = track.wrap(ledge.s0 + HALL.along);
    const f = track.frameAt(s, {});
    const P = f.pos;
    const head = Math.atan2(f.tan.x, f.tan.z);
    const spot = {};
    for (let a = HALL.angles[0]; a <= HALL.angles[1]; a += 3) {
      const ang = head + leftTurn(f, a);
      for (let r = HALL.range[0]; r <= HALL.range[1]; r += 40) {
        const x = P.x + Math.sin(ang) * r;
        const z = P.z + Math.cos(ang) * r;
        track.locate(x, z, -1, spot);
        const side = spot.lat >= 0 ? 1 : -1;
        if (Math.abs(spot.lat) - track.edgeAt(spot.s, side) < HALL.clear) continue;
        if (inK5View(track, x, z)) continue;
        const y = heightAt(x, z);
        let flat = 0;
        for (const [dx, dz] of [[25, 0], [-25, 0], [0, 25], [0, -25]]) flat = Math.max(flat, Math.abs(heightAt(x + dx, z + dz) - y));
        if (flat > 9) continue;
        // high ground standing over its surroundings (a hilltop, not a slope), seen above the road, nearer better
        let around = 0;
        for (const [dx, dz] of [[150, 0], [-150, 0], [0, 150], [0, -150]]) around += heightAt(x + dx, z + dz) / 4;
        const score = y - P.y + 2 * (y - around) - 0.02 * r - 0.6 * Math.abs(a - HALL.prefer);
        if (!best || score > best.score) best = { x, z, y, score };
      }
    }
    if (best) {
      const dx = P.x - best.x;
      const dz = P.z - best.z;
      const l = Math.hypot(dx, dz);
      best.face = [dx / l, dz / l];
    }
  }
  cache.set(track, best);
  return best;
}

/** The turn (rad, as a change of map heading) of `deg` degrees towards the road's left in frame f. */
function leftTurn(f, deg) {
  // which way round is "left": the sign of the turn that takes the heading to `left`
  let d = Math.atan2(f.left.x, f.left.z) - Math.atan2(f.tan.x, f.tan.z);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return (Math.sign(d) * deg * Math.PI) / 180;
}
