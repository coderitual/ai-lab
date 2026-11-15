// Dev viewer registry: name -> factory returning an Object3D.
import * as THREE from 'three';
import { TEAMS } from './palette.js';
import { createWatercraft } from './watercraft.js';
import { createRider } from './rider.js';
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

function craftWithRider(i, q) {
  const team = TEAMS[i % TEAMS.length];
  const craft = createWatercraft(team);
  const rider = createRider(team, i + 1);
  craft.userData.riderMount.add(rider);
  const lean = parseFloat(q.get('lean') || '0');
  const steer = parseFloat(q.get('steer') || '0');
  const stand = parseFloat(q.get('stand') || '0');
  rider.userData.pose({ lean, steer, stand });
  craft.userData.handlebar.rotation.y = -steer * 0.5;
  if (q.has('norider')) rider.visible = false;
  return craft;
}

export const VIEWER_ASSETS = {
  craft: (env, q) => floatOnWater(craftWithRider(parseInt(q.get('team') || '0', 10), q)),
  crafts: (env, q) => {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = craftWithRider(i, q);
      c.position.set((i - 1.5) * 2.6, 0, 0);
      g.add(floatOnWater(c));
    }
    return g;
  },
};
