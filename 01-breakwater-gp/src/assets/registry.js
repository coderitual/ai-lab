// Dev viewer registry: name -> factory returning an Object3D.
import * as THREE from 'three';
import { TEAMS } from './palette.js';
import { createBoat } from './boat.js';
import { rockField } from './rocks.js';
import { withSkyFog } from './sky.js';
import { makeSurfaceSample, sampleSurface } from '../engine/waves.js';

const sample = makeSurfaceSample();

/** Make an object ride the swell at its own position (viewer only). */
function floatOnWater(obj, { tilt = 1 } = {}) {
  const up = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const baseQ = obj.quaternion.clone();
  const Y = new THREE.Vector3(0, 1, 0);
  obj.userData.update = (time) => {
    sampleSurface(obj.position.x, obj.position.z, time, sample);
    obj.position.y = sample.y;
    up.set(sample.nx * tilt, sample.ny, sample.nz * tilt).normalize();
    q.setFromUnitVectors(Y, up);
    obj.quaternion.copy(q).multiply(baseQ);
  };
  return obj;
}

function boat(i, q) {
  const team = TEAMS[i % TEAMS.length];
  const b = createBoat(team, i + 1);
  const steer = parseFloat(q.get('steer') || '0');
  for (const engine of b.userData.engines) engine.rotation.y = steer * 0.45;
  return b;
}

/** A study of the rock: a crag, a slab, and boulders of several sizes. */
function rocks() {
  const g = rockField([
    { x: 0, y: 0, z: 0, seed: 3, radius: 15, height: 56, blocks: 6, moss: 0.5, lean: [0.08, 0.03], wet: 1.2 },
    { x: 22, y: 0, z: 6, seed: 5, radius: 11, height: 32, blocks: 4, moss: 0.5, wet: 1.2 },
    { x: -19, y: 0, z: 9, seed: 8, radius: 9, height: 20, blocks: 3, moss: 0.4, wet: 1.2 },
    { x: 9, y: 0, z: 22, seed: 11, radius: 4, height: 4.2, cuts: 9, detail: 2, wet: 0.8 },
    { x: 1, y: 0, z: 25, seed: 12, radius: 2.4, height: 2.5, cuts: 8, detail: 1, wet: 0.6 },
    { x: -6, y: 0, z: 23, seed: 14, radius: 3.2, height: 2.3, cuts: 9, detail: 2, squash: 0.7, wet: 0.6 },
    { x: 15, y: 0, z: 27, seed: 15, radius: 1.5, height: 1.5, cuts: 7, detail: 1, wet: 0.5 },
  ]);
  const mesh = new THREE.Mesh(g, withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const VIEWER_ASSETS = {
  rocks,
  // `flat` holds the boat level on a calm patch, to study the model itself
  craft: (env, q) => (q.has('flat') ? boat(parseInt(q.get('team') || '0', 10), q) : floatOnWater(boat(parseInt(q.get('team') || '0', 10), q), { tilt: 0.5 })),
  crafts: (env, q) => {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = boat(i, q);
      c.position.set((i - 1.5) * 3.4, 0, 0);
      g.add(floatOnWater(c, { tilt: 0.5 }));
    }
    return g;
  },
};
