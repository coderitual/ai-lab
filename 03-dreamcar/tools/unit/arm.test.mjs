// The arm of the lake (src/assets/world/arm.js) shapes the land beyond the left solid edge of one stretch and
// nowhere a car can be: walked round the whole lap.
//
//   node tools/unit/arm.test.mjs        (or: node tools/unit.mjs arm)
//
// 1. Inside every solid edge of the lap, and for a metre and a half beyond every left one, the ground is exactly
//    what it was before the place was shaped; on the right of the road it is what it was everywhere.
// 2. Round the water the place only ever lowers ground; it raises ground only in the valley beyond the arm, a
//    kilometre and more from the bridge and far from any road (its spurs and its far range).
// 3. The arm holds water: well inside its shore the ground lies under the lake's level, and its water is one with
//    the lake beside the straight.
// 4. Beside the rest of the lap the hillsides are what they were.
// 5. The hall on its hilltop (landmarks.js: frame D3's) stands where it stood.

import { Vector3 } from 'three';
import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createTerrain } from '../../src/assets/world/terrain.js';
import { ARM } from '../../src/assets/world/arm.js';
import { hallSite } from '../../src/assets/world/landmarks.js';
import { TIMES } from '../../src/assets/world/lighting.js';
import { createRng } from '../../src/engine/rng.js';

let failures = 0;
function test(name, fn) {
  const before = failures;
  let said = '';
  try {
    said = fn() ?? '';
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  console.log(`${failures === before ? '  ok  ' : 'FAILED'}  ${name}${said ? `: ${said}` : ''}`);
}
const fail = (text) => {
  failures++;
  if (failures < 12) console.log(`      ${text}`);
};

const track = createTrack(LAYOUT);
const terrain = createTerrain({
  track,
  tier: 'low',
  rng: createRng(1).fork('terrain'),
  material: {},
  lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
});
const place = terrain.arm;
const p = new Vector3();
const spot = { index: -1, s: 0, lat: 0 };

test('the Track has the place', () => {
  if (!place) fail('terrain.arm is null');
  return place ? `measured from s = ${place.s0.toFixed(0)} m, water at ${place.level.toFixed(1)} m` : '';
});

if (place) {
  test('inside the solid edges, close beyond the left one and on the right of the road the ground is what it was', () => {
    let checked = 0;
    let worst = 0;
    for (let s = 0; s < track.length; s += 2) {
      const eL = track.edgeAt(s, 1);
      const eR = track.edgeAt(s, -1);
      const mine = place.along(s) > ARM.along[0] - 100 && place.along(s) < ARM.along[1] + 100;
      for (const lat of [-eR, -eR * 0.5, 0, eL * 0.5, eL, eL + ARM.guard[0], ...(mine ? [-eR - 3, -eR - 15, -eR - 40] : [])]) {
        track.pointAt(s, lat, p);
        // (a point beyond the edge that another stretch is nearer to is that stretch's)
        if (Math.abs(lat) > Math.max(eL, eR)) {
          track.locate(p.x, p.z, -1, spot);
          if (Math.abs(track.delta(s, spot.s)) > 4) continue;
        }
        const d = Math.abs(terrain.heightAt(p.x, p.z) - terrain.before.heightAt(p.x, p.z));
        // (the lakeside's stretch has its own test)
        if (d > 1e-6 && terrain.lakeside && Math.abs(lat) > Math.max(eL, eR) && terrain.lakeside.near(p.x, p.z)) continue;
        worst = Math.max(worst, d);
        checked++;
      }
    }
    if (worst > 1e-6) fail(`the ground moved by ${worst.toFixed(3)} m`);
    return `${checked} points`;
  });

  test('round the water the place only lowers ground; it raises only the spurs and the range of the valley beyond', () => {
    let lowered = 0;
    let raised = 0;
    let highest = 0;
    let roadless = Infinity;
    let deepest = 0;
    let nearest = Infinity;
    for (let z = track.bounds.minZ - 4800; z <= track.bounds.maxZ + 300; z += 25) {
      for (let x = track.bounds.minX - 2600; x <= track.bounds.maxX + 1400; x += 25) {
        const h = terrain.before.heightAt(x, z);
        const g = place.ground(x, z, h);
        if (g > h + 1e-9) {
          // (only the spurs and the range in the valley beyond: a kilometre from the bridge, far from any road)
          const [, r] = place.bearing(x, z);
          track.locate(x, z, -1, spot);
          const off = Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1);
          raised++;
          highest = Math.max(highest, g - h);
          roadless = Math.min(roadless, off);
          if (r < ARM.pass.range[0] || off < 300) fail(`ground raised by ${(g - h).toFixed(2)} m at ${x}, ${z}, ${r.toFixed(0)} m from the bridge and ${off.toFixed(0)} m from a road`);
        }
        if (g < h - 1e-6) {
          // (the valley beyond the arm: a sector from the bridge, a kilometre and more out)
          const [a, r] = place.bearing(x, z);
          const pass = r >= ARM.pass.range[0] && r <= ARM.pass.range[3] && a >= ARM.pass.angle[0] && a <= ARM.pass.angle[3];
          if (!place.near(x, z) && !pass) fail(`ground lowered outside the place's box and its pass at ${x}, ${z}`);
          lowered++;
          deepest = Math.max(deepest, h - g);
          track.locate(x, z, -1, spot);
          if (spot.lat <= 0) fail(`ground lowered on the right of the road at ${x}, ${z}`);
          nearest = Math.min(nearest, Math.abs(spot.lat) - track.edgeAt(spot.s, 1));
        }
      }
    }
    if (nearest < ARM.guard[0]) fail(`ground lowered ${nearest.toFixed(2)} m from a solid edge`);
    return `${((lowered * 625) / 1e4).toFixed(0)} ha lowered, by ${deepest.toFixed(0)} m at most, none nearer than ${nearest.toFixed(1)} m to an edge; ${((raised * 625) / 1e4).toFixed(0)} ha raised in the valley beyond (spurs and the far range), by ${highest.toFixed(0)} m at most, none nearer than ${roadless.toFixed(0)} m to a road`;
  });

  test('the arm holds water and joins the lake', () => {
    const e = place.extent;
    let water = 0;
    for (let z = e.z0; z <= e.z1; z += 5) {
      for (let x = e.x0; x <= e.x1; x += 5) {
        if (place.shore(x, z) < 12) continue;
        water++;
        if (terrain.heightAt(x, z) > place.level - 0.5) fail(`dry ground well inside the shore at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
    // a line from the arm's last lobe to the lake beside the straight: under water all the way
    const last = ARM.lobes[ARM.lobes.length - 1];
    const [ax, az] = place.at(last[0], last[1]);
    const lake = terrain.lake.extent;
    const bx = (lake.x0 + lake.x1) / 2;
    const bz = (lake.z0 + lake.z1) / 2;
    let dry = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const h = terrain.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (h > place.level - 0.05) {
        dry++;
        console.log(`      dry at ${(ax + (bx - ax) * t).toFixed(0)}, ${(az + (bz - az) * t).toFixed(0)}: ${h.toFixed(2)} m`);
      }
    }
    if (dry) fail(`${dry} dry points on the line from the arm to the middle of the lake`);
    if (place.level !== terrain.lake.level) fail('the arm is not at the lake\'s level');
    if (water < 2000) fail(`only ${water * 25} m2 of water`);
    return `${((water * 25) / 1e4).toFixed(1)} ha of water well inside the shore`;
  });

  test('the pale hall of frame D3 stands where it stood, on ground the place did not move', () => {
    // (landmarks.js looks for its hilltop from the ledge, over the arm's far shore)
    const was = hallSite(createTrack(LAYOUT), terrain.before.heightAt);
    const now = hallSite(track, terrain.heightAt);
    if (!was || !now) {
      fail('no site for the hall');
      return '';
    }
    if (Math.hypot(was.x - now.x, was.z - now.z) > 0.01) fail(`the hall moved from ${was.x.toFixed(0)}, ${was.z.toFixed(0)} to ${now.x.toFixed(0)}, ${now.z.toFixed(0)}`);
    let moved = 0;
    for (let dx = -40; dx <= 40; dx += 10) for (let dz = -40; dz <= 40; dz += 10) moved = Math.max(moved, Math.abs(terrain.heightAt(was.x + dx, was.z + dz) - terrain.before.heightAt(was.x + dx, was.z + dz)));
    if (moved > 1e-6) fail(`the ground under the hall moved by ${moved.toFixed(2)} m`);
    return `at ${now.x.toFixed(0)}, ${now.z.toFixed(0)}, ${(-place.shore(now.x, now.z)).toFixed(0)} m from the arm's shore`;
  });

  test('the rest of the lap keeps its hillsides', () => {
    let checked = 0;
    for (let s = 0; s < track.length; s += 5) {
      const along = place.along(s);
      if (along > ARM.along[0] - ARM.ease - 5 && along < ARM.along[1] + ARM.ease + 5) continue;
      checked++;
      for (const beyond of [3, 15, 40]) {
        track.pointAt(s, track.edgeAt(s, 1) + beyond, p);
        track.locate(p.x, p.z, -1, spot);
        if (Math.abs(track.delta(s, spot.s)) > 4) continue;
        if (Math.abs(place.ground(p.x, p.z, 50) - 50) > 1e-9 && place.ground(p.x, p.z, terrain.before.heightAt(p.x, p.z)) < terrain.before.heightAt(p.x, p.z) - 1e-6) {
          fail(`the hillside at s = ${s.toFixed(0)}, ${beyond} m beyond the left edge moved`);
        }
      }
    }
    return `${checked} places`;
  });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
