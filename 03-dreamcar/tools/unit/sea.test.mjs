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
  const was = { coastDown: 'highDown', coastRun: 'highRun', coastTop: 'open' };
  for (const [name, old] of Object.entries(was)) {
    const a = SIDES[name];
    const b = SIDES[old];
    expect(a.coast === true, `${name} is not a coast side`);
    // (round 2, frame E1) round the carousel and over the crest the verge is the gravel apron of a run-off: the same
    // ground, gravel's grip and sound instead of grass's
    for (const key of ['kind', 'edge', 'slope', 'far', ...(a.verge === 'gravel' ? [] : ['verge'])]) {
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

test('after the tunnel the sea is in view: open water within 250 m of the sea side of the sky road, the climb, the crest and the plunge', () => {
  const p = new Vector3();
  const far = [];
  for (const [id, f] of [['viaduct', 0.5], ['climb', 0.5], ['carousel', 0.5], ['crest', 0.5], ['plunge', 0.3]]) {
    const s = pieceAt(id, f);
    let found = Infinity;
    for (let d = 10; d <= 400 && found === Infinity; d += 5) {
      track.pointAt(s, d + track.edgeAt(s, 1), p);
      if (sea.at(p.x, p.z) > 0.9 && terrain.heightAt(p.x, p.z) < sea.level - 1) found = d;
    }
    expect(found <= 250, `${id}: open water ${found} m beyond the left edge`);
    far.push(`${id} ${found} m`);
  }
  return far.join(', ');
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

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
