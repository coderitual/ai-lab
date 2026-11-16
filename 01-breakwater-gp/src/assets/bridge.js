// Bridges over the river. Each is one merged mesh, built from boxes and rods:
// a deck with its railings between two abutments on the quays, approach ramps
// down to street level, and whatever carries it: a pair of steel arches with
// hangers, or a leaning pylon with a fan of cables.

import * as THREE from 'three';
import { merge, part } from './geo.js';

const box = (w, h, d, color, pos, rot) => part(new THREE.BoxGeometry(w, h, d), color, { pos, rot });

/** A rod of square section from one point to another. */
function rod(a, b, thick, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const length = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return part(new THREE.BoxGeometry(thick, length, thick), color, { pos: mid.toArray(), rot: [e.x, e.y, e.z] });
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A bridge across a river that runs along z: it spans in x, with its middle at the origin of the returned geometry
 * and the water at y = 0.
 * @param {{ kind?: 'arch'|'stay'|'beam', span?: number, width?: number, deck?: number, ground?: number, colour?: string }} [o]
 *   `span`: bank to bank; `deck`: height of the roadway above the water; `ground`: height of the quays
 * @returns {THREE.BufferGeometry} with vertex colours
 */
export function bridgeGeometry({ kind = 'arch', span = 60, width = 11, deck = 11, ground = 2.6, colour = '#f4f1ea' } = {}) {
  const parts = [];
  const half = span / 2 + 3; // the deck reaches a little way onto each quay
  const steel = colour;
  const road = '#2c3036';
  const concrete = '#b9b6ae';

  // the deck: a slab, a girder under each edge, a kerb and a railing along each edge
  parts.push(box(half * 2, 0.5, width, road, [0, deck - 0.25, 0]));
  for (const side of [1, -1]) {
    parts.push(box(half * 2, 1.5, 0.7, steel, [0, deck - 1.05, side * (width / 2 - 0.35)]));
    parts.push(box(half * 2, 0.16, 0.16, '#dfe3e6', [0, deck + 1.1, side * (width / 2 - 0.2)]));
    for (let x = -half; x <= half + 0.01; x += 3) parts.push(box(0.12, 1.1, 0.12, '#dfe3e6', [x, deck + 0.55, side * (width / 2 - 0.2)]));
  }
  // cross beams under the slab
  for (let x = -half + 2; x < half; x += 4) parts.push(box(0.5, 0.9, width - 1.4, steel, [x, deck - 0.95, 0]));

  // abutments on the quays, and the approaches running down to the street
  for (const side of [1, -1]) {
    parts.push(box(6, deck - ground + 0.6, width + 2, concrete, [side * (half + 1.5), (deck + ground) / 2 - 0.5, 0]));
    const run = 34;
    const slope = Math.atan2(deck - ground, run);
    const length = Math.hypot(run, deck - ground);
    parts.push(box(length, 0.6, width, road, [side * (half + 4.5 + run / 2), (deck + ground) / 2 - 0.3, 0], [0, 0, -side * slope]));
    // the fill under the approach, as three steps
    for (let k = 0; k < 3; k++) {
      const h = (deck - ground) * (1 - (k + 0.6) / 3.2);
      parts.push(box(run / 3, h, width - 1, concrete, [side * (half + 4.5 + (k + 0.5) * (run / 3)), ground + h / 2 - 0.2, 0]));
    }
  }

  if (kind === 'arch') {
    // two arches, leaning in toward each other, and the hangers that carry the deck from them
    const rise = span * 0.26;
    const N = 18;
    for (const side of [1, -1]) {
      const at = (i) => {
        const t = (i / N) * 2 - 1;
        const up = rise * (1 - t * t);
        return V(t * (span / 2 + 1), deck - 0.6 + up, side * (width / 2 - 0.3 - up * 0.1));
      };
      for (let i = 0; i < N; i++) parts.push(rod(at(i), at(i + 1), 0.95, steel));
      for (let i = 2; i <= N - 2; i++) {
        const top = at(i);
        parts.push(rod(V(top.x, deck + 0.2, side * (width / 2 - 0.3)), top, 0.14, '#cfd4d8'));
      }
    }
    // braces between the two arches near the crown
    for (const t of [-0.3, -0.1, 0.1, 0.3]) {
      const up = rise * (1 - t * t);
      const z = width / 2 - 0.3 - up * 0.1;
      parts.push(rod(V(t * (span / 2 + 1), deck - 0.6 + up, z), V(t * (span / 2 + 1), deck - 0.6 + up, -z), 0.4, steel));
    }
  } else if (kind === 'stay') {
    // one pylon on the far bank, leaning back, with a fan of cables to each edge of the deck
    const foot = V(-(span / 2 + 2), ground, 0);
    const head = V(-(span / 2 + 14), deck + span * 0.78, 0);
    for (const side of [1, -1]) {
      parts.push(rod(V(foot.x, ground, side * (width / 2 + 1.2)), V(head.x, head.y, side * 0.6), 1.7, steel));
    }
    parts.push(box(2.4, 3, 3.4, steel, [head.x, head.y + 0.6, 0]));
    for (let k = 0; k < 9; k++) {
      const x = -span / 2 + 6 + k * ((span - 8) / 8);
      const up = head.y - 2 - k * 1.4;
      for (const side of [1, -1]) parts.push(rod(V(x, deck + 0.3, side * (width / 2 - 0.3)), V(head.x + 0.5, up, side * 0.5), 0.13, '#e6e9ec'));
    }
    // back stays, down to an anchor block behind the pylon
    parts.push(box(5, 3, width, concrete, [-(span / 2 + 40), ground + 1.3, 0]));
    for (let k = 0; k < 5; k++) {
      for (const side of [1, -1]) parts.push(rod(V(-(span / 2 + 40), ground + 2.6, side * (1 + k * 0.9)), V(head.x - 0.5, head.y - 2 - k * 2.4, side * 0.5), 0.13, '#e6e9ec'));
    }
  } else {
    // a deep truss on each side
    const top = deck + 5.2;
    for (const side of [1, -1]) {
      const z = side * (width / 2 - 0.3);
      parts.push(box(half * 2, 0.6, 0.6, steel, [0, top, z]));
      const bays = 12;
      for (let i = 0; i < bays; i++) {
        const x0 = -half + (i * 2 * half) / bays;
        const x1 = -half + ((i + 1) * 2 * half) / bays;
        parts.push(rod(V(x0, deck, z), V(i % 2 ? x0 : x1, top, z), 0.34, steel));
        parts.push(rod(V(i % 2 ? x0 : x1, top, z), V(x1, deck, z), 0.34, steel));
      }
    }
    for (let x = -half + 3; x < half; x += 6) parts.push(box(0.4, 0.4, width - 0.6, steel, [x, top, 0]));
  }
  return merge(parts);
}
