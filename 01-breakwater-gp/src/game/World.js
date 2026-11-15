// Assembles the race location from the procedural assets and keeps the
// floating props riding the swell.

import * as THREE from 'three';
import { createEnvironment } from '../assets/environment.js';
import { createIsland, findSpotOnIsland } from '../assets/island.js';
import { createLighthouse, createPalms, createPier, createSailboat, createSeaStacks } from '../assets/scenery.js';
import { createCourseFloatAssets, createSlalomBuoy, createStartArch } from '../assets/buoys.js';
import { makeRng, TAU, DEG } from '../engine/math.js';
import { makeSurfaceSample, sampleSurface, setSeaIslands } from '../engine/waves.js';
import { createTrack } from './track.js';

const UP = new THREE.Vector3(0, 1, 0);

export function createWorld(engine, { waterSegments } = {}) {
  const { scene } = engine;
  const env = createEnvironment(engine, { waterSegments });
  const track = createTrack();
  const rng = makeRng(42);

  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---------------------------------------------------------------- land
  const main = createIsland({ x: 0, z: 0, radius: 78, height: 30, seed: 3, style: 'tropical' });
  const lightIslet = createIsland({ x: -92, z: 250, radius: 24, height: 7, seed: 8, style: 'rock', beach: 0.1 });
  const sandIslet = createIsland({ x: 253, z: -146, radius: 30, height: 5, seed: 12, style: 'tropical', beach: 0.3 });
  const solid = [main, lightIslet, sandIslet];
  solid.forEach((i) => root.add(i.mesh));

  // far hills ring the horizon for depth
  const far = [
    { a: 20, r: 2300, radius: 380, height: 210, seed: 21 },
    { a: 75, r: 2700, radius: 300, height: 150, seed: 22 },
    { a: 140, r: 2100, radius: 420, height: 250, seed: 23 },
    { a: 205, r: 2500, radius: 340, height: 170, seed: 24 },
    { a: 262, r: 2200, radius: 460, height: 280, seed: 25 },
    { a: 318, r: 2600, radius: 320, height: 160, seed: 26 },
  ];
  for (const f of far) {
    root.add(createIsland({ x: Math.cos(f.a * DEG) * f.r, z: Math.sin(f.a * DEG) * f.r, radius: f.radius, height: f.height, seed: f.seed, style: 'far' }).mesh);
  }

  setSeaIslands(solid.map((i) => ({ x: i.x, z: i.z, r: i.radius })));

  // palms
  const palmSpots = [];
  for (let i = 0; i < 30; i++) {
    const spot = findSpotOnIsland(main, rng() * TAU, 2.4 + rng() * 6.5);
    if (spot.y > 1.8) palmSpots.push(spot);
  }
  for (let i = 0; i < 7; i++) {
    const spot = findSpotOnIsland(sandIslet, rng() * TAU, 1.8 + rng() * 2.4);
    if (spot.y > 1.3) palmSpots.push(spot);
  }
  root.add(createPalms(palmSpots, 5));

  // lighthouse on the rocky islet
  const lighthouse = createLighthouse();
  lighthouse.position.set(lightIslet.x, lightIslet.heightAt(lightIslet.x, lightIslet.z) - 0.8, lightIslet.z);
  root.add(lighthouse);

  // pier pointing at the start line
  const pierBase = findSpotOnIsland(main, 0.05, 1.3);
  const pier = createPier({ length: 34, deckY: 2.2 });
  pier.position.set(pierBase.x - 2, 0, pierBase.z);
  root.add(pier);

  // sea stacks
  const stacks = createSeaStacks([
    { x: -238, z: -88, r: 7.5, tall: 1.9 },
    { x: -253, z: -70, r: 4.6, tall: 1.4 },
    { x: -229, z: -105, r: 5.4, tall: 1.5 },
    { x: 37, z: -100, r: 4.6, tall: 1.5 },
    { x: 46, z: -107, r: 3.0, tall: 1.2 },
    { x: 165, z: 165, r: 6.2, tall: 1.7 },
    { x: 177, z: 155, r: 3.8, tall: 1.3 },
    { x: -150, z: 228, r: 4.0, tall: 1.4 },
  ]);
  root.add(stacks.mesh);

  /** Static circular obstacles: { x, z, r, bounce }. */
  const colliders = [...stacks.colliders];

  // ------------------------------------------------------ floating props
  const sample = makeSurfaceSample();
  const q = new THREE.Quaternion();
  const n = new THREE.Vector3();

  const sailboats = [
    { x: 318, z: 70, rot: 0.6, sail: '#fdf6e6', stripe: '#ff6b2c' },
    { x: 118, z: 322, rot: 2.1, sail: '#fdf6e6', stripe: '#12a8d8' },
    { x: -338, z: 30, rot: 4.0, sail: '#ffe9c2', stripe: '#d5308c' },
    { x: 40, z: -334, rot: 5.2, sail: '#fdf6e6', stripe: '#8fd128' },
  ].map((b) => {
    const boat = createSailboat(b.sail, b.stripe);
    boat.position.set(b.x, 0, b.z);
    boat.userData.baseQ = new THREE.Quaternion().setFromAxisAngle(UP, b.rot);
    root.add(boat);
    colliders.push({ x: b.x, z: b.z, r: boat.userData.radius, bounce: 0.3 });
    return boat;
  });

  // start / finish arch
  const startFrame = track.sample(0);
  const arch = createStartArch({ halfSpan: 20, height: 9.5 });
  arch.position.set(startFrame.x, -0.35, startFrame.z);
  arch.rotation.y = startFrame.heading;
  root.add(arch);
  for (const side of [1, -1]) {
    const p = track.pointAt(0, side * 20);
    colliders.push({ x: p.x, z: p.z, r: 3.0, bounce: 0.4 });
  }

  // slalom marks
  const buoys = track.gates.map((gate) => {
    const buoy = createSlalomBuoy(gate.pass);
    buoy.position.set(gate.x, 0, gate.z);
    buoy.rotation.y = gate.heading;
    root.add(buoy);
    colliders.push({ x: gate.x, z: gate.z, r: buoy.userData.radius, bounce: 0.5, soft: true });
    return buoy;
  });

  // boundary floats (one instanced mesh)
  const floatPts = track.boundaryPoints(24).filter((p) => {
    // leave the arch's feet clear
    const d0 = Math.hypot(p.x - startFrame.x, p.z - startFrame.z);
    return d0 > 12 + 20 - 6 || d0 < 20 - 6;
  });
  const floatAssets = createCourseFloatAssets();
  const floats = new THREE.InstancedMesh(floatAssets.geometry, floatAssets.material, floatPts.length);
  floats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  floats.frustumCulled = false;
  floats.name = 'courseFloats';
  root.add(floats);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  function terrainHeightAt(x, z) {
    let h = -100;
    for (const isl of solid) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      if (dx * dx + dz * dz > isl.radius * isl.radius * 2.6) continue;
      const hi = isl.heightAt(x, z);
      if (hi > h) h = hi;
    }
    return h;
  }

  /** Per viewport, just before it is drawn: aim the sky and the ocean grid at that view. */
  function prepareView(time, camera, focusX, focusZ) {
    env.update(time, camera, focusX, focusZ);
  }

  /** Once per frame: everything that floats rides the swell. */
  function update(time, dt) {
    for (let i = 0; i < floatPts.length; i++) {
      const p = floatPts[i];
      sampleSurface(p.x, p.z, time, sample);
      n.set(sample.nx * 0.8, sample.ny, sample.nz * 0.8).normalize();
      q.setFromUnitVectors(UP, n);
      m.compose(pos.set(p.x, sample.y, p.z), q, one);
      floats.setMatrixAt(i, m);
    }
    floats.instanceMatrix.needsUpdate = true;

    for (const buoy of buoys) {
      sampleSurface(buoy.position.x, buoy.position.z, time, sample);
      buoy.position.y = sample.y;
      // tilt only the body (in the group's frame); the sign above stays level
      n.set(sample.nx * 0.7, sample.ny, sample.nz * 0.7).normalize().applyAxisAngle(UP, -buoy.rotation.y);
      buoy.userData.body.quaternion.setFromUnitVectors(UP, n);
    }

    for (const boat of sailboats) {
      sampleSurface(boat.position.x, boat.position.z, time, sample);
      boat.position.y = sample.y * 0.8 + 0.1;
      n.set(sample.nx * 0.45, sample.ny, sample.nz * 0.45).normalize();
      boat.quaternion.setFromUnitVectors(UP, n).multiply(boat.userData.baseQ);
    }

    lighthouse.userData.animate(time);
  }

  return { env, track, root, islands: solid, colliders, buoys, arch, floats, sailboats, terrainHeightAt, update, prepareView };
}
