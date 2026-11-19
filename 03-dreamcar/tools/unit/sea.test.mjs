// The sea, tested (design.md, "The sea"): where the water is and what the coast road keeps of the course.
//
//   node tools/unit/sea.test.mjs        (or: node tools/unit.mjs sea)
//
// The terrain is built on the low tier (about a second) from the real Track, as the world builds it; the waves are
// engine/waves.js's, the same sum the water's shader draws.

import { LAYOUT, SIDES } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createTerrain } from '../../src/assets/world/terrain.js';
import { TIMES } from '../../src/assets/world/lighting.js';
import { createRng } from '../../src/engine/rng.js';
import { SEA_HEIGHT, WAVES, sampleWaves } from '../../src/engine/waves.js';
import { SEA_LOOK, seaBody, seaClarity, seaMirror } from '../../src/assets/world/sea.js';
import { SHORE, bakeShoreMap, shoreAt, shoreDecode } from '../../src/assets/world/seaShore.js';
import { Vector3 } from 'three';

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
function expect(condition, message) {
  if (condition) return;
  failures++;
  console.log(`      ${message}`);
}

const track = createTrack(LAYOUT);
const terrain = createTerrain({
  track,
  tier: 'low',
  rng: createRng(1).fork('terrain'),
  material: {},
  lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
});
const sea = terrain.sea;
const pieceAt = (id, f) => {
  let s = 0;
  for (const seg of LAYOUT.segments) {
    const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
    if (seg.id === id) return s + f * len;
    s += len;
  }
  throw new Error(`no piece ${id}`);
};

test('the coast presets keep the course: edge, verge slope, verge and barrier as the presets they replaced', () => {
  const was = { coastDown: 'highDown', coastRun: 'highRun', coastTop: 'open', shoreRun: 'lowRun', shoreUp: 'lowUp', parapetSea: 'parapet', coastUp: 'highUp', rockSea: 'rock', openSea: 'open', bankSea: 'bank', seaWall: 'rock' };
  for (const [name, old] of Object.entries(was)) {
    const a = SIDES[name];
    const b = SIDES[old];
    expect(a.coast === true || name.startsWith('shore'), `${name} is not a coast side`);
    // (round 2, frame E1) round the carousel and over the crest the verge is the gravel apron of a run-off: the same
    // ground, gravel's grip and sound instead of grass's
    for (const key of ['kind', 'edge', 'slope', ...(name === 'coastUp' || name === 'parapetSea' ? [] : ['far']), ...(a.verge === 'gravel' ? [] : ['verge'])]) {
      expect(JSON.stringify(a[key]) === JSON.stringify(b[key]), `${name}.${key} is ${JSON.stringify(a[key])}, ${old}'s ${JSON.stringify(b[key])}`);
    }
  }
});

test('nowhere does the water reach the course: every sample is dry out to 2 m beyond its solid edge (on a deck: the deck stands 10 m over it)', () => {
  let low = Infinity;
  let deck = Infinity;
  const p = new Vector3();
  for (let i = 0; i < track.count; i += 2) {
    const s = i * track.ds;
    // (round 2) the sky road's piers stand in the sea: there the deck is the course
    if (track._onBridge(s)) {
      deck = Math.min(deck, track.py[i] - sea.level);
      continue;
    }
    for (const side of [1, -1]) {
      track.pointAt(s, side * (track.edgeAt(s, side) + 2), p);
      low = Math.min(low, terrain.heightAt(p.x, p.z) - sea.level);
    }
  }
  expect(low > 0.5, `the ground 2 m beyond an edge stands only ${low.toFixed(2)} m over the water`);
  expect(deck > 10, `a deck stands only ${deck.toFixed(2)} m over the water`);
  return `${low.toFixed(1)} m over the water at the lowest; decks ${deck.toFixed(0)} m and more`;
});

test('after the tunnel the sea is right below: open water within 90 m of the sea side of the sky road, the climb, the carousel, the crest and the plunge (the cliff, round 2)', () => {
  const p = new Vector3();
  const far = [];
  for (const [id, f] of [['viaduct', 0.5], ['climb', 0.5], ['carousel', 0.5], ['crest', 0.5], ['plunge', 0.3]]) {
    const s = pieceAt(id, f);
    let found = Infinity;
    for (let d = 10; d <= 400 && found === Infinity; d += 5) {
      track.pointAt(s, d + track.edgeAt(s, 1), p);
      if (sea.at(p.x, p.z) > 0.9 && terrain.heightAt(p.x, p.z) < sea.level - 1) found = d;
    }
    expect(found <= 90, `${id}: open water ${found} m beyond the left edge`);
    far.push(`${id} ${found} m`);
  }
  return far.join(', ');
});

test('round 4, the bay inside the loop: open water within 110 m of the RIGHT side of the sky road, the climb, the carousel, the crest and the plunge', () => {
  const p = new Vector3();
  const found = [];
  for (const [id, f] of [['viaduct', 0.2], ['climb', 0.5], ['carousel', 0.5], ['crest', 0.3], ['plunge', 0.5]]) {
    const s = pieceAt(id, f);
    let at = Infinity;
    for (let d = 5; d <= 200 && at === Infinity; d += 5) {
      track.pointAt(s, -(d + track.edgeAt(s, -1)), p);
      if (terrain.heightAt(p.x, p.z) < sea.level - 1) at = d;
    }
    expect(at <= 110, `${id}: water ${at} m beyond the right edge`);
    found.push(`${id} ${at} m`);
  }
  return found.join(', ');
});

test('the volcano stands clear of the course: its foot more than 20 m beyond every solid edge', () => {
  const v = terrain.volcano;
  expect(!!v, 'no volcano');
  let least = Infinity;
  for (let i = 0; i < track.count; i++) {
    const s = i * track.ds;
    least = Math.min(least, Math.hypot(track.px[i] - v.x, track.pz[i] - v.z) - v.r - Math.max(track.edgeAt(s, 1), track.edgeAt(s, -1)));
  }
  expect(least > 20, `its foot ${least.toFixed(0)} m from a solid edge`);
  return `${least.toFixed(0)} m at the least`;
});

test('the bay is where the lake was: water 120 m off the start line, and the far ridges stand clear of the start', () => {
  expect(sea.at(0, -120) > 0.9 && terrain.heightAt(0, -120) < sea.level, 'no water 120 m off the start line');
  expect(sea.at(0, 120) < 0.1, 'water on the land side of the start straight');
  // looking down the straight (+X) the mainland goes on: the far ridges and the massif are not over the sea
  expect(sea.sector(5000, 0) < 0.05, 'the bearing down the start straight is the sea\'s');
});

test('the sea map: 512 texels a side, depth where the water is, none on land', () => {
  const m = sea.map;
  expect(m.size === 512 && m.data.length === 512 * 512 * 4, `size ${m.size}, ${m.data.length} bytes`);
  const texel = (x, z) => {
    const i = Math.floor(((x - m.x0) / m.extent) * m.size);
    const j = Math.floor(((z - m.z0) / m.extent) * m.size);
    return m.data.subarray((j * m.size + i) * 4, (j * m.size + i) * 4 + 4);
  };
  expect(texel(0, 600)[0] === 0, 'depth inside the loop');
  expect(texel(-1600, 900)[0] > 100, 'no depth out in the open sea west of the course');
});

test('the waves: a long soft swell, the same surface every time it is asked', () => {
  const a = sampleWaves(123.4, -56.7, 31.25, {});
  const b = sampleWaves(123.4, -56.7, 31.25, {});
  expect(a.y === b.y && a.nx === b.nx, 'two answers for one place and time');
  expect(Math.abs(a.y) < SEA_HEIGHT, `height ${a.y} beyond the sea's range ${SEA_HEIGHT}`);
  expect(WAVES[0].len >= 100 && WAVES.every((w, i) => i === 0 || w.len <= WAVES[i - 1].len), 'not a long swell first, longest to shortest');
  return `crest to trough about ${SEA_HEIGHT.toFixed(1)} m; the longest wave ${WAVES[0].len} m`;
});

// ---- the water's look, as far as it is pure JavaScript (water lane): the shore map and the colour's physics
const shore = bakeShoreMap({ sea, heightAt: terrain.heightAt, size: 1024 });

test('the shore map: the same bytes every time; water where the land says water, land where it says land', () => {
  const again = bakeShoreMap({ sea, heightAt: terrain.heightAt, size: 1024 });
  expect(shore.levels.length === 11 && shore.levels[0].length === 1024 * 1024 * 4, `levels ${shore.levels.length}`);
  let same = true;
  for (let k = 0; k < shore.levels[0].length && same; k += 97) same = shore.levels[0][k] === again.levels[0][k];
  expect(same, 'two bakes differ');
  const rng = createRng(5).fork('shore-test');
  let asked = 0;
  let wrong = 0;
  const errors = [];
  for (let i = 0; i < 40000; i++) {
    const x = shore.x0 + rng.next() * shore.extent;
    const z = shore.z0 + rng.next() * shore.extent;
    const m = shoreAt(shore, x, z);
    // well out on the water, or well up the land (by the map): the land's own height must agree
    if (m.shore > 8 && m.shore < SHORE.near * 0.6) {
      asked++;
      const depth = sea.level - terrain.heightAt(x, z);
      if (depth <= 0) wrong++;
      else errors.push(Math.abs(depth - m.depth) / (1 + 0.25 * depth));
    } else if (m.land > 3 && m.shore < -5.5) {
      asked++;
      if (terrain.heightAt(x, z) < sea.level) wrong++;
    }
  }
  expect(asked > 500, `only ${asked} points near a shore`);
  expect(wrong <= asked * 0.01, `${wrong} of ${asked} points near the shore are water by the map and land by the height, or the other way`);
  // (a texel is 4.7 m: under a cliff the bed falls 12 m across one, and a depth read between texels is that rough)
  errors.sort((a, b) => a - b);
  const most = errors[Math.floor(errors.length * 0.95)];
  expect(most < 0.6, `one depth in twenty near the shore is off by more than ${most.toFixed(2)} (m, per 1 + depth / 4)`);
  return `${asked} points within ${(SHORE.near * 0.6).toFixed(0)} m of a shore, ${wrong} wrong; 95 % of depths within ${most.toFixed(2)} m per (1 + depth / 4); the height function asked ${shore.stats.asked} times for ${1024 * 1024} texels`;
});

test('the shore map: the shoreline is where the bed crosses the level, to a texel; its distance grows away from it', () => {
  // walk out from the land across each shore along x and along z: where the map's distance passes zero the land's
  // height must be near the water's level (how near depends on how steep the shore is there)
  const step = shore.extent / shore.size;
  let crossings = 0;
  let off = 0;
  for (let j = 8; j < shore.size - 8; j += 37) {
    for (let i = 1; i < shore.size - 1; i++) {
      const x = shore.x0 + (i + 0.5) * step;
      const z = shore.z0 + (j + 0.5) * step;
      const a = shoreAt(shore, x - step, z).shore;
      const b = shoreAt(shore, x, z).shore;
      if (a * b >= 0 || Math.abs(a - b) > 2 * step) continue;
      // the crossing, by the map
      const xc = x - step + (step * a) / (a - b);
      crossings++;
      // the bed really does cross the level within a texel and a half of there along this line
      let above = false;
      let below = false;
      for (let d = -1.5; d <= 1.5; d += 0.25) {
        const h = terrain.heightAt(xc + d * step, z) - sea.level;
        above = above || h >= 0;
        below = below || h < 0;
      }
      if (!above || !below) off++;
    }
  }
  expect(crossings > 30, `only ${crossings} crossings found`);
  expect(off <= crossings * 0.08, `${off} of ${crossings} shoreline crossings lie more than a texel and a half from where the bed meets the level`);
  // out on open water the distance is at its far end, on dry land at its near end
  expect(shoreAt(shore, -1600, 900).shore > 100, 'the open sea west of the course reads as near a shore');
  expect(shoreAt(shore, 0, 600).shore < -5, 'the land inside the loop reads as water');
  return `${crossings} crossings, ${off} off by more than ${(1.5 * step).toFixed(1)} m`;
});

test('the shore map: a coarser level holds the highest land of the texels it covers (the mirrored ray relies on it)', () => {
  let worst = 0;
  for (let l = 1; l < shore.levels.length; l++) {
    const fine = shore.levels[l - 1];
    const to = shore.levels[l];
    const s = shore.size >> (l - 1);
    const half = s >> 1;
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        const a = (2 * j * s + 2 * i) * 4 + 2;
        const top = Math.max(fine[a], fine[a + 4], fine[a + s * 4], fine[a + s * 4 + 4]);
        worst = Math.max(worst, Math.abs(to[(j * half + i) * 4 + 2] - top));
      }
    }
  }
  expect(worst === 0, `a level's land is ${worst} steps off the highest of its four`);
  const top = shoreDecode.land(shore.levels[shore.levels.length - 1][2] / 255);
  expect(top > 100, `the highest land in the map is ${top.toFixed(0)} m`);
  return `the last level: ${top.toFixed(0)} m`;
});

test('the water by depth: sand shows through the first metre, turquoise at 3 to 6 m, teal by 12, the deep colour by 60', () => {
  const deep = SEA_LOOK.byTime.day.deep;
  const at = (d) => seaBody(d, SEA_LOOK.sand, deep);
  const [r03, g03, b03] = at(0.3);
  expect(r03 > 0.8 * SEA_LOOK.sand[0] && r03 > b03, `0.3 m: ${at(0.3).map((v) => v.toFixed(3))} is not sand`);
  for (const d of [3, 6]) {
    const [r, g, b] = at(d);
    expect(g > b && b > r && g > 3 * deep[1] && r < 0.5 * g, `${d} m: ${at(d).map((v) => v.toFixed(3))} is not turquoise`);
  }
  const [r12, g12, b12] = at(12);
  expect(b12 > g12 && g12 > 8 * r12, `12 m: ${at(12).map((v) => v.toFixed(3))} is not teal`);
  const far = at(60);
  expect(far.every((v, i) => Math.abs(v - deep[i]) < 0.35 * deep[i] + 0.004) && far[2] > far[1], `60 m: ${far.map((v) => v.toFixed(4))} is not the deep colour ${deep}`);
  // looking along the water the light's way through it is longer: less of the bed
  expect(seaClarity(4, 0.1)[1] < seaClarity(4, 1)[1], 'a glancing look sees as much of the bed as a look straight down');
  expect(SEA_LOOK.absorb[0] > 3 * SEA_LOOK.absorb[1] && SEA_LOOK.absorb[1] > SEA_LOOK.absorb[2], 'red is not the first colour to go');
  return [0.3, 3, 6, 12, 60].map((d) => `${d} m ${at(d).map((v) => v.toFixed(3)).join(' ')}`).join('; ');
});

test('the mirror: calm water is Schlick; rough water mirrors less at a glancing angle and no more looking down', () => {
  for (const c of [0.02, 0.1, 0.3, 0.7, 1]) {
    const schlick = 0.02 + 0.98 * (1 - c) ** 5;
    expect(Math.abs(seaMirror(c, 0) - schlick) < 1e-9, `calm at ${c}: ${seaMirror(c, 0)}, Schlick ${schlick}`);
    // (looking down, the facets' tilt adds a little: under half a per cent)
    if (c <= 0.3) expect(seaMirror(c, 0.03) <= seaMirror(c, 0.005) + 1e-9 && seaMirror(c, 0.005) <= seaMirror(c, 0) + 1e-9, `rougher water mirrors more at ${c}`);
    else expect(Math.abs(seaMirror(c, 0.03) - seaMirror(c, 0)) < 0.006, `rough water looking down (${c}) mirrors ${seaMirror(c, 0.03)}`);
    expect(seaMirror(c, 0.03) >= 0.02, `less than water's own 2 % at ${c}`);
  }
  expect(seaMirror(0.05, 0.03) < 0.6 * seaMirror(0.05, 0), 'a rough sea at the horizon is nearly as much a mirror as a calm one');
  // every ripple layer's slopes and the capillaries: a breeze, by Cox and Munk's measure (0.003 + 0.005 U: about 0.03 at 5 m/s)
  const drawn = SEA_LOOK.ripples.reduce((sum, l) => sum + l.rms * l.rms, SEA_LOOK.capillary);
  expect(drawn > 0.015 && drawn < 0.04, `the ripples' slope variance in a gust is ${drawn.toFixed(4)}`);
  return `at 3 degrees: calm ${seaMirror(0.05, 0).toFixed(2)}, in a gust ${seaMirror(0.05, drawn).toFixed(2)}; the ripples' variance ${drawn.toFixed(4)}`;
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
