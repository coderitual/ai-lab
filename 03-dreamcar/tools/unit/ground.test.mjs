// The ground never stands over the road: the terrain's grid and far land, as built for each tier, walked round the
// whole lap.
//
//   node tools/unit/ground.test.mjs        (or: node tools/unit.mjs ground; GROUND_HIGH=1 adds the high tier)
//
// (sea lane) The owner's phone showed a dark slab across the lane at the sky road's end: a triangle of the grid
// spanning from ground under the deck to the top of the rock cut beside the climb stood over the road. Here every
// triangle of the grid and of the far land near the course is sampled; wherever a sample lies inside the solid edges
// (outside the tunnels' bores) it must be at or under the road's surface there.

import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createTerrain } from '../../src/assets/world/terrain.js';
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

const track = createTrack(LAYOUT);
const SAMPLES = [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1], [0.5, 0.5], [0.5, 0], [0, 0.5], [0.45, 0.1], [0.1, 0.45], [0.7, 0.25], [0.25, 0.7]];
const inBore = (s) => track.tunnels.some((t) => track.wrap(s - t.s0) <= t.s1 - t.s0);

// the high tier's 5 m grid takes several times as long: the release run switches it on (GROUND_HIGH=1)
const TIERS = process.env.GROUND_HIGH ? ['low', 'medium', 'high'] : ['low', 'medium'];
for (const tier of TIERS) {
  test(`${tier}: no triangle of the grid or the far land stands over the road inside the solid edges`, () => {
    const terrain = createTerrain({
      track,
      tier,
      rng: createRng(1).fork('terrain'),
      material: {},
      lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
    });
    const spot = { index: -1, s: 0, lat: 0 };
    const prof = { y: 0, surface: 0 };
    let worst = { over: -Infinity };
    let triangles = 0;
    terrain.group.traverse((o) => {
      if (!o.isMesh || (o.name !== 'terrain-grid' && o.name !== 'terrain-far')) return;
      const pos = o.geometry.attributes.position.array;
      const index = o.geometry.index.array;
      for (let t = 0; t < index.length; t += 3) {
        const a = index[t] * 3;
        const b = index[t + 1] * 3;
        const c = index[t + 2] * 3;
        // a cheap rejection: the triangle's middle far from any road
        const mx = (pos[a] + pos[b] + pos[c]) / 3;
        const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
        track.locate(mx, mz, spot.index, spot);
        const reach = Math.max(Math.hypot(pos[a] - mx, pos[a + 2] - mz), Math.hypot(pos[b] - mx, pos[b + 2] - mz), Math.hypot(pos[c] - mx, pos[c + 2] - mz));
        if (Math.abs(spot.lat) - track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1) > reach + 1) continue;
        triangles++;
        for (const [u, w] of SAMPLES) {
          const x = pos[a] + (pos[b] - pos[a]) * u + (pos[c] - pos[a]) * w;
          const y = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * u + (pos[c + 1] - pos[a + 1]) * w;
          const z = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * u + (pos[c + 2] - pos[a + 2]) * w;
          track.locate(x, z, spot.index, spot);
          if (Math.abs(spot.lat) > track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1) || inBore(spot.s)) continue;
          const over = y - track.profile(spot.s, spot.lat, prof).y;
          if (over > worst.over) worst = { over, s: spot.s, lat: spot.lat, mesh: o.name };
        }
      }
    });
    if (worst.over > 0) {
      failures++;
      console.log(`      ${worst.mesh} stands ${worst.over.toFixed(2)} m over the road at s = ${worst.s.toFixed(0)} m, ${worst.lat.toFixed(1)} m off the centre line`);
    }
    return `${triangles} triangles near the course; the highest ${worst.over.toFixed(2)} m against the road at s = ${worst.s?.toFixed(0)} m`;
  });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
