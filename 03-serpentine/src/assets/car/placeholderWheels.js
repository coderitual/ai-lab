// PLACEHOLDER WHEELS: a black cylinder with five bars, standing in until the
// real wheels (wheel.js) are fitted. Each steers, spins and rides up and down
// the way the real one will: hub (rides) > knuckle (steers about +Y) > wheel
// (spins about the axle).

import * as THREE from 'three';
import { WHEELS } from './spec.js';

/**
 * @param {THREE.Object3D} parent the car's root
 * @param {(thing: { dispose: () => void }) => any} keep registers what must be disposed with the car
 * @returns {{ setWheel: (i: number, pose: { steer: number, spin: number, travel: number }) => void, materials: THREE.Material[] }}
 */
export function createPlaceholderWheels(parent, keep) {
  const tyreMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85 }));
  const rimMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.9, roughness: 0.35 }));
  const wheels = WHEELS.map((spec) => {
    const { radius, width, rim } = spec.tyre;
    const hub = new THREE.Group();
    hub.position.set(spec.x, radius, spec.z);
    const knuckle = new THREE.Group();
    const wheel = new THREE.Group();
    // a cylinder's axis is Y: lay it along the axle
    const tyre = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius, radius, width, 28).rotateZ(Math.PI / 2)), tyreMaterial);
    tyre.castShadow = tyre.receiveShadow = true;
    wheel.add(tyre);
    // spokes, so that the spin can be seen
    const spoke = keep(new THREE.BoxGeometry(0.02, rim * 0.92, 0.05));
    for (let k = 0; k < 5; k++) {
      const bar = new THREE.Mesh(spoke, rimMaterial);
      bar.position.x = Math.sign(spec.x) * (width / 2 + 0.004);
      bar.rotation.x = (k / 5) * Math.PI;
      wheel.add(bar);
    }
    parent.add(hub.add(knuckle.add(wheel)));
    return { hub, knuckle, wheel, radius };
  });
  return {
    materials: [rimMaterial],
    setWheel(i, { steer, spin, travel }) {
      const w = wheels[i];
      w.hub.position.y = w.radius + travel;
      w.knuckle.rotation.y = steer;
      w.wheel.rotation.x = spin;
    },
  };
}
