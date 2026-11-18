// The car's contact shadow: the soft dark patch of sky the car hides from the
// road, which no shadow map is fine enough to draw.
//
// A flat quad with a small picture baked once from the body's plan outline
// (the half-width of the skin near the ground at every station): densest
// under the sills and between the wheels, a darker pad under each tyre,
// fading over a hand's width outside the body. It is not a child of the car:
// the game lays it on the road under the car (poseShadow), so it stays flat
// on the road while the body rolls and pitches above it.

import * as THREE from 'three';
import { WHEELS } from './spec.js';

const SIZE = { x: 2.9, z: 6.0, centreZ: -0.13 };

/**
 * @param {Float32Array} positions the skin's sampled vertices (car space, left half first)
 * @param {number} count how many of them are the left half
 * @param {'low'|'medium'|'high'} tier
 */
export function createContactShadow(positions, count, tier) {
  const [w, h] = tier === 'low' ? [64, 128] : [128, 256];
  // the plan outline: half-width of the body below the waist, per row of the picture
  const half = new Float32Array(h);
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y > 0.75) continue;
    const row = Math.round(((positions[i * 3 + 2] - SIZE.centreZ) / SIZE.z + 0.5) * h - 0.5);
    if (row >= 0 && row < h) half[row] = Math.max(half[row], positions[i * 3]);
  }
  // fill rows the samples missed, from their neighbours
  for (let r = 1; r < h - 1; r++) if (!half[r] && half[r - 1] && half[r + 1]) half[r] = (half[r - 1] + half[r + 1]) / 2;
  const data = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    const z = SIZE.centreZ + ((r + 0.5) / h - 0.5) * SIZE.z;
    // distance outside the outline along z: how far beyond the nearest row that has body
    let along = Infinity;
    for (let k = 0; k < h; k++) if (half[k] > 0) along = Math.min(along, Math.abs(k - r) * (SIZE.z / h));
    for (let c = 0; c < w; c++) {
      const x = ((c + 0.5) / w - 0.5) * SIZE.x;
      const across = half[r] > 0 ? Math.abs(x) - half[r] : Math.hypot(Math.max(0, Math.abs(x) - 0.6), along);
      const outside = Math.max(0, across);
      // Two scales: a tight dark edge (4 cm) where the body meets the road, and a soft spread (22 cm) of the sky it
      // hides; under the car the road sees almost no sky. (Round 3 had one 6 cm falloff from 0.68: from the chase
      // camera and from above the car floated, a grey film round a car with no contact.)
      let a = across <= 0
        ? 0.86 + 0.11 * Math.min(1, -across / 0.2)
        : 0.6 * Math.exp(-outside / 0.04) + 0.26 * Math.exp(-outside / 0.22);
      // each tyre stands on a near-black patch as wide as its tread, which reaches a little past the body's outline
      for (const wheel of WHEELS) {
        const tx = (x - wheel.x) / (wheel.tyre.width / 2 + 0.025);
        const tz = (z - wheel.z) / 0.16;
        a = Math.max(a, 0.97 * Math.exp(-(tx ** 4) - tz ** 4));
        a = Math.max(a, 0.55 * Math.exp(-(((x - wheel.x) / 0.2) ** 2) - ((z - wheel.z) / 0.42) ** 2));
      }
      // laid flat, the plane's texture rows run from the nose (row 0) to the tail
      const o = ((h - 1 - r) * w + c) * 4;
      data[o + 3] = Math.round(255 * Math.min(0.97, a));
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(SIZE.x, SIZE.z).rotateX(-Math.PI / 2).translate(0, 0, SIZE.centreZ);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'car contact shadow';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  const up = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  return {
    mesh,
    /** Lays the shadow on the road: `point` under the car's origin, the road's `normal`, the car's `yaw`, `strength` 0..1. */
    pose(point, normal, yaw, strength) {
      tilt.setFromUnitVectors(up, normal);
      turn.setFromAxisAngle(up, yaw);
      mesh.quaternion.copy(tilt).multiply(turn);
      mesh.position.copy(point).addScaledVector(normal, 0.01);
      material.opacity = strength;
      mesh.visible = strength > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
