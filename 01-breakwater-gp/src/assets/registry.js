// Dev viewer registry: name -> factory returning an Object3D.
import * as THREE from 'three';
import { TEAMS } from './palette.js';
import { createBoat } from './boat.js';
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
  // how hard the turbine burns in the picture: ?thrust=0..1, ?boost=0..1
  b.userData.setThrust(parseFloat(q.get('thrust') || '0.5'), parseFloat(q.get('boost') || '0'), 0);
  return b;
}

export const VIEWER_ASSETS = {
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
