// The lakeside (src/assets/world/lakeside.js) shapes the land beyond the solid edges of one stretch and nowhere a
// car can be: walked round the whole lap.
//
//   node tools/unit/lakeside.test.mjs        (or: node tools/unit.mjs lakeside)
//
// 1. Inside every solid edge of the lap the ground is exactly what it was before the place was shaped.
// 2. The tarn holds its water: along its shore the ground rises through the water's level, and for 22 m beyond
//    the shore (as far as its sheet of water may reach) no ground lies under the level.
// 3. Wherever the ground moved, no solid edge is nearer than half a metre, and the hillsides beside the rest of
//    the lap are what they were (but for the far side of the spur the climb shares with the leg that comes back).

import { Vector3 } from 'three';
import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createTerrain } from '../../src/assets/world/terrain.js';
import { LAKESIDE } from '../../src/assets/world/lakeside.js';
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
  console.log(`      ${text}`);
};

const track = createTrack(LAYOUT);
const terrain = createTerrain({
  track,
  tier: 'low',
  rng: createRng(1).fork('terrain'),
  material: {},
  lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
});
const place = terrain.lakeside;
const p = new Vector3();

test('the Track has the place', () => {
  if (!place) fail('terrain.lakeside is null');
  return place ? `from s = ${(place.s0 + LAKESIDE.from).toFixed(0)} to ${(place.s0 + LAKESIDE.to).toFixed(0)} m, water at ${place.level.toFixed(1)} m` : '';
});

if (place) {
  test('inside the solid edges the ground is what it was', () => {
    let checked = 0;
    let worst = 0;
    for (let s = 0; s < track.length; s += 2) {
      const eL = track.edgeAt(s, 1);
      const eR = track.edgeAt(s, -1);
      for (const lat of [-eR, -eR * 0.5, 0, eL * 0.5, eL]) {
        track.pointAt(s, lat, p);
        const d = Math.abs(terrain.heightAt(p.x, p.z) - terrain.before.heightAt(p.x, p.z));
        worst = Math.max(worst, d);
        checked++;
      }
    }
    if (worst > 1e-6) fail(`the ground inside an edge moved by ${worst.toFixed(3)} m`);
    return `${checked} points`;
  });

  test('the tarn holds its water', () => {
    const e = place.extent;
    let shore = 0;
    let low = 0;
    let water = 0;
    for (let z = e.z0 - 40; z <= e.z1 + 40; z += 4) {
      for (let x = e.x0 - 40; x <= e.x1 + 40; x += 4) {
        const q = place.shore(x, z);
        const h = terrain.heightAt(x, z);
        if (q > 6) {
          water++;
          if (h > place.level - 0.5) fail(`dry ground ${q.toFixed(0)} m inside the shore at ${x.toFixed(0)}, ${z.toFixed(0)}`);
        } else if (q < -8 && q > -22) {
          shore++;
          if (h < place.level + 0.1) low++;
        }
      }
    }
    if (low) fail(`${low} of ${shore} points of the bench within 22 m of the shore lie under the water's level`);
    if (water < 1000) fail(`only ${water * 16} m2 of water`);
    return `${(water * 16 / 1e4).toFixed(1)} ha of water, ${shore} points of its rim above it`;
  });

  test('the rest of the lap keeps its hillsides, and no ground moved at a solid edge', () => {
    // wherever the ground moved on the map: how near is a road's solid edge
    const spot = { index: -1, s: 0, lat: 0 };
    let nearest = Infinity;
    let moved = 0;
    for (let z = track.bounds.minZ - 200; z <= track.bounds.maxZ + 200; z += 20) {
      for (let x = track.bounds.minX - 200; x <= track.bounds.maxX + 200; x += 20) {
        if (Math.abs(terrain.heightAt(x, z) - terrain.before.heightAt(x, z)) < 1e-6) continue;
        // (not what the arm of the lake lowered: arm.test.mjs walks that)
        if (terrain.arm && terrain.arm.ground(x, z, terrain.before.heightAt(x, z)) < terrain.before.heightAt(x, z) - 1e-6) continue;
        moved++;
        track.locate(x, z, -1, spot);
        nearest = Math.min(nearest, Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1));
      }
    }
    if (nearest < 0.5) fail(`the ground moved ${nearest.toFixed(2)} m from a solid edge`);
    // the hillsides beside every other part of the lap, 3, 15 and 40 m beyond each edge. The leg that comes back
    // from the carousel shares the spur with the climb (the ground between two legs is a blend of what each asks
    // for): there the far side of the shared ground may move, by less the nearer it is to that leg.
    let checked = 0;
    let shared = 0;
    for (let s = 0; s < track.length; s += 5) {
      const along = place.along(s);
      if (along > -600 && along < 340) continue;
      checked++;
      for (const side of [1, -1]) {
        for (const beyond of [3, 15, 40]) {
          track.pointAt(s, side * (track.edgeAt(s, side) + beyond), p);
          const d = Math.abs(terrain.heightAt(p.x, p.z) - terrain.before.heightAt(p.x, p.z));
          if (d < 1e-6) continue;
          // (the arm of the lake, arm.js, lowers the ground on the left of its own stretch: arm.test.mjs)
          if (terrain.arm && side > 0 && terrain.arm.ground(p.x, p.z, terrain.before.heightAt(p.x, p.z)) < terrain.before.heightAt(p.x, p.z) - 1e-6) continue;
          // (a point nearer to the place's own stretch than to this one is the place's side of the shared ground)
          track.locate(p.x, p.z, -1, spot);
          const own = place.along(spot.s);
          if (own > -600 && own < 340) continue;
          const back = side < 0 && along >= 340 && along < 520;
          if (back && d < [0.3, 1.5, 5][[3, 15, 40].indexOf(beyond)]) shared = Math.max(shared, d);
          else fail(`the hillside at s = ${s.toFixed(0)}, ${beyond} m beyond the ${side > 0 ? 'left' : 'right'} edge moved by ${d.toFixed(2)} m`);
        }
      }
    }
    return `${moved} of the map's 20 m cells moved, none nearer than ${nearest.toFixed(1)} m to an edge; ${checked} places round the rest of the lap keep their hillsides (the leg back from the carousel: at most ${shared.toFixed(2)} m on the shared spur)`;
  });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
