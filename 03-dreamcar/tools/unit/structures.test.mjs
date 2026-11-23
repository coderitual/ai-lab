// The structures never stand over the road: every vertex of the bridges (deck, parapets' strips, abutments, pier caps,
// joints) and of the tunnels, as built for each tier, walked round the whole lap.
//
//   node tools/unit/structures.test.mjs        (or: node tools/unit.mjs structures)
//
// (sea lane) The owner's phone showed a pale plate on the left shoulder just before the sea viaduct's end: the
// abutment's top, set level 0.3 m under the road's centre at the deck's end, stood over the shoulder where the road
// is banked down to that side. Here every triangle of the viaducts' and tunnels' meshes (instances placed) is sampled
// at points no more than 0.5 m apart (up to 12 a side) and each point located on the course; wherever it lies inside the solid edges it must be at or under the road's surface there (the expansion
// joints lie 12 mm over it: the tolerance). Whatever hangs more than 4 m over the road (a ceiling, its lamps) and the
// daylight's veil in a tunnel's mouth are left out.

import * as THREE from 'three';
import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { createTerrain } from '../../src/assets/world/terrain.js';
import { createViaducts } from '../../src/assets/world/viaduct.js';
import { createTunnels } from '../../src/assets/world/tunnel.js';
import { TIMES } from '../../src/assets/world/lighting.js';
import { createRng } from '../../src/engine/rng.js';

// (coast lane) The tunnel's banner is painted on a canvas (tunnel.js buildBanner). Node has none: a stand-in whose 2D
// context takes every call and draws nothing. Only the geometry is tested here.
if (typeof document === 'undefined') {
  const context = new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : k === 'measureText' ? () => ({ width: 1 }) : context), set: () => true, apply: () => context });
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => context }) };
}

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
/** How far over the road a point inside the edges may lie (m): the joints' plates, 12 mm over it, and where the road
 * drains at its edge. */
const TOLERANCE = 0.025;
/** A face standing on the edge itself (a parapet's, a tunnel walkway's kerb), as located in float32 (m). */
const FACE = 0.05;
/** Whatever hangs over the road by design: higher than this over it is not standing on it (m). */
const OVERHEAD = 4;
/** What hangs over the road or is light, not something standing: the daylight's veil in a tunnel's mouth. */
const HANGING = /mouth-light/;
const ATMOSPHERE = { patch: (m) => m, uniforms: {} };

/** The vertex standing highest over the road inside the edges, among the meshes under `group`. */
function highest(group) {
  const spot = { index: -1, s: 0, lat: 0 };
  const prof = { y: 0, surface: 0 };
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let worst = { over: -Infinity };
  let vertices = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const sample = (o) => {
    track.locate(v.x, v.z, spot.index, spot);
    if (Math.abs(spot.lat) >= track.edgeAt(spot.s, spot.lat >= 0 ? 1 : -1) - FACE) return;
    const over = v.y - track.profile(spot.s, spot.lat, prof).y;
    if (over > OVERHEAD) return;
    vertices++;
    if (over > worst.over) worst = { over, s: spot.s, lat: spot.lat, mesh: o.name };
  };
  // every triangle sampled at its corners and inside (a face can span the shoulder with every corner beyond the edges)
  const check = (o, matrix) => {
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const count = index ? index.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      const ia = index ? index.getX(t) : t;
      const ib = index ? index.getX(t + 1) : t + 1;
      const ic = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(pos, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(pos, ic).applyMatrix4(matrix);
      const n = Math.min(12, Math.max(1, Math.ceil(Math.max(a.distanceTo(b), a.distanceTo(c)) / 0.5)));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; i + j <= n; j++) {
          v.copy(a).addScaledVector(b.clone().sub(a), i / n).addScaledVector(c.clone().sub(a), j / n);
          sample(o);
        }
      }
    }
  };
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || HANGING.test(o.name)) return;
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m);
        check(o, m.premultiply(o.matrixWorld));
      }
    } else check(o, o.matrixWorld);
  });
  return { worst, vertices };
}

const report = (worst, vertices) => {
  if (worst.over > TOLERANCE) {
    failures++;
    console.log(`      ${worst.mesh} stands ${worst.over.toFixed(2)} m over the road at s = ${worst.s.toFixed(0)} m, ${worst.lat.toFixed(1)} m off the centre line`);
  }
  return `${vertices} points inside the edges; the highest ${Number.isFinite(worst.over) ? worst.over.toFixed(2) : '-'} m over the road${worst.s !== undefined ? ` at s = ${worst.s.toFixed(0)} m (${worst.mesh})` : ''}`;
};

for (const tier of ['low', 'medium']) {
  const terrain = createTerrain({
    track,
    tier,
    rng: createRng(1).fork('terrain'),
    material: {},
    lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
  });
  test(`${tier}: no vertex of a bridge (${track.bridges.map((b) => b.id).join(', ')}) stands over the road inside the solid edges`, () => {
    const viaducts = createViaducts({ track, terrain, atmosphere: ATMOSPHERE, tier });
    const { worst, vertices } = highest(viaducts.group);
    return report(worst, vertices);
  });
  // the medium tier's tunnel draws its banner on a canvas: the low tier's geometry is the same where the road is
  if (tier === 'low') test(`${tier}: no vertex of a tunnel's floor, walls or portals stands over the road inside the solid edges`, () => {
    const lamps = { lamps: [], shares: [] };
    const tunnels = createTunnels({ track, terrain, atmosphere: ATMOSPHERE, lamps, tier });
    const { worst, vertices } = highest(tunnels.group);
    return report(worst, vertices);
  });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
