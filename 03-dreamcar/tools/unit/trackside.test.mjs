// Nothing placed beside the road stands inside the solid edges: every vertex of the trackside furniture
// (trackside.js: boards, tyre walls, the start's wall and tyres, distance boards, marshal posts) and of the bend signs,
// chevron boards and kerbstones (schemeFurniture.js), as built, and every lamp's foot, walked round the whole lap.
//
//   node tools/unit/trackside.test.mjs        (or: node tools/unit.mjs trackside)
//
// (sea lane) The owner's phone showed a marshal hut and a distance board on the shoulder after the sea viaduct,
// between the road and the rail: both were placed from the edge at their own s, where the edge was still widening
// from the deck's parapet to the coast's rail. Here the furniture is built with a stand-in for the sign atlas and the
// ground, and each vertex is located on the course: none may lie inside the solid edge on its side (the CLAUDE.md
// rule: scenery stands at or beyond the edges; what is inside them is the course).

import * as THREE from 'three';
import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createBuilder } from '../../src/assets/world/builder.js';
import { buildTrackside } from '../../src/assets/world/trackside.js';
import { createBendSigns, createChevrons, createCurbs } from '../../src/assets/world/schemeFurniture.js';

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
/** How far inside the edge a vertex may lie (m): a face laid exactly on the edge (the start's low wall) where the road bends, in float32. */
const TOLERANCE = 0.05;
/** A stand-in for the sign atlas: every swatch, board, label and special the same uv rectangle. */
const UV = new Proxy([0, 0, 1, 1], { get: (t, k) => (k in t ? t[k] : UV) });
const SIGNS = { swatch: UV, boards: UV, tall: UV, distance: UV, special: UV };
/** A stand-in for the ground: far below, so everything stands on the road's level beside it. */
const TERRAIN = { heightAt: () => -1000, heightOnTrack: (s, lat) => track.profile(s, lat, { y: 0, surface: 0 }).y, bakeAt: (x, z, out) => out.fill(0) };

/** Walks the vertices of every mesh under `group`, reporting the one deepest inside the edges. */
function deepest(group) {
  const spot = { index: -1, s: 0, lat: 0 };
  let worst = { inside: -Infinity };
  let vertices = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      track.locate(v.x, v.z, spot.index, spot);
      vertices++;
      const inside = track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1) - Math.abs(spot.lat);
      if (inside > worst.inside) worst = { inside, s: spot.s, lat: spot.lat, mesh: o.name };
    }
  });
  return { worst, vertices };
}

for (const tier of ['low', 'medium']) {
  test(`${tier}: no vertex of the trackside furniture lies inside the solid edges`, () => {
    const b = createBuilder();
    const nb = createBuilder();
    buildTrackside({ track, terrain: TERRAIN, tier, b, nb, signs: SIGNS });
    const group = new THREE.Group();
    b.build({}, group, { name: 'trackside' });
    nb.build({}, group, { name: 'trackside-low' });
    const { worst, vertices } = deepest(group);
    if (worst.inside > TOLERANCE) {
      failures++;
      console.log(`      ${worst.mesh} reaches ${worst.inside.toFixed(2)} m inside the edge at s = ${worst.s.toFixed(0)} m, ${worst.lat.toFixed(1)} m off the centre line`);
    }
    return `${vertices} vertices; the deepest ${worst.inside.toFixed(2)} m inside at s = ${worst.s?.toFixed(0)} m`;
  });
}

for (const [what, create] of [
  ['bend sign', createBendSigns],
  ['chevron board', createChevrons],
  ['kerbstone', createCurbs],
]) {
  test(`no vertex of a ${what} lies inside the solid edges`, () => {
    const built = create({ track, terrain: TERRAIN, material: new THREE.MeshBasicMaterial() });
    const { worst, vertices } = deepest(built.group);
    if (worst.inside > TOLERANCE) {
      failures++;
      console.log(`      ${worst.mesh} reaches ${worst.inside.toFixed(2)} m inside the edge at s = ${worst.s.toFixed(0)} m, ${worst.lat.toFixed(1)} m off the centre line`);
    }
    return `${vertices} vertices; the deepest ${worst.inside.toFixed(2)} m inside at s = ${worst.s?.toFixed(0)} m`;
  });
}

test('every street lamp and floodlight stands at or beyond the solid edge (those in the tunnel hang from its ceiling)', () => {
  const inside = track.lamps.filter((l) => l.kind !== 'tunnel' && track.edgeAt(l.s, Math.sign(l.lat)) - Math.abs(l.lat) > TOLERANCE);
  if (inside.length) {
    failures++;
    console.log(`      ${inside.length} inside (s = ${inside.map((l) => l.s.toFixed(0)).join(', ')})`);
  }
  return `${track.lamps.filter((l) => l.kind !== 'tunnel').length} lamps`;
});

test('the marshal posts and the distance boards stand where the Track says, one post to a place', () => {
  const close = track.marshals.filter((m, i) => track.marshals.some((o, j) => j < i && Math.abs(track.delta(o.s, m.s)) < 30));
  if (close.length) {
    failures++;
    console.log(`      ${close.length} marshal posts within 30 m of another (s = ${close.map((m) => m.s.toFixed(0)).join(', ')})`);
  }
  return `${track.marshals.length} posts, ${track.distanceBoards.length} distance boards`;
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
