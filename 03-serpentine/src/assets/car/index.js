// The car: createCar() builds the whole model in code and returns the handle
// the game drives it with (CarModel).
//
// FIRST PASS: the skin in plain grey, to judge its shape.

import * as THREE from 'three';
import { MESH_EDGE, createArchGeometry, createLayout, inArch, sampleSkin, skinGeometry, skinIndex } from './body.js';
import { createLampLights } from './lamps.js';
import { createPlaceholderWheels } from './placeholderWheels.js';
import { createSkin } from './skin.js';
import { DIMS, STATIONS } from './spec.js';

export function createCar({ tier = 'high' } = {}) {
  const object = new THREE.Group();
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
  const t0 = performance.now();
  const skin = createSkin();
  const lay = createLayout(skin, MESH_EDGE[tier]);
  const samples = sampleSkin(skin, lay);
  const attributes = {
    position: new THREE.BufferAttribute(samples.position, 3),
    normal: new THREE.BufferAttribute(samples.normal, 3),
    uv: new THREE.BufferAttribute(samples.uv, 2),
  };
  const { rows } = samples;
  const P = samples.position;
  const inside = (j) => inArch(P[j * 3], P[j * 3 + 1], P[j * 3 + 2], -0.012);
  const index = skinIndex(samples, (i, k) => {
    const a = i * rows + k;
    return !(inside(a) && inside(a + 1) && inside(a + rows) && inside(a + rows + 1));
  });
  const paintGeometry = keep(skinGeometry(attributes, index));
  const paint = keep(new THREE.MeshPhysicalMaterial({ color: 0x8f9296, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const body = new THREE.Mesh(paintGeometry, paint);
  body.castShadow = body.receiveShadow = true;
  object.add(body);
  const arch = createArchGeometry(skin);
  const lip = new THREE.Mesh(keep(arch.lip), paint);
  const liner = new THREE.Mesh(keep(arch.liner), keep(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 })));
  object.add(lip, liner);
  console.info(`car: ${(performance.now() - t0).toFixed(1)} ms, ${index.length / 3} triangles`);

  const wheels = createPlaceholderWheels(object, keep);
  const lights = createLampLights(object, keep);
  const level = { drl: 0, low: 0, high: 0, tail: 0, brake: 0, reverse: 0, indicatorL: 0, indicatorR: 0, interior: 0 };
  const middle = (STATIONS.nose + STATIONS.tail) / 2;
  return {
    object,
    headlights: lights.headlights,
    taillight: lights.taillight,
    box: {
      center: new THREE.Vector3(0, DIMS.height / 2, middle),
      half: new THREE.Vector3(DIMS.widthWithMirrors / 2, DIMS.height / 2, DIMS.length / 2),
    },
    paints: ['silver'],
    shadow: new THREE.Group(),
    poseShadow() {},
    setWheel: wheels.setWheel,
    setLights(lights_) {
      Object.assign(level, lights_);
      lights.apply(level);
    },
    setReflections() {},
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
