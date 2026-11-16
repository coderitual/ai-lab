// Assembles the race location from the procedural assets and keeps the
// floating props riding the swell.

import * as THREE from 'three';
import { createEnvironment } from '../assets/environment.js';
import { createIsland, createTerrainMaterial, findSpotOnIsland, terrainUniforms } from '../assets/island.js';
import { createPalms, palmUniforms } from '../assets/palm.js';
import { FOLIAGE_TONES, rockField } from '../assets/rocks.js';
import { withSkyFog } from '../assets/sky.js';
import { createLighthouse, createPier, createSailboat, createSeaStacks } from '../assets/scenery.js';
import { SUN_DIR } from '../assets/palette.js';
import { BakedShadow, withBakedShadow } from '../engine/BakedShadow.js';
import { createCourseFloatAssets, createSlalomBuoy, createStartArch } from '../assets/buoys.js';
import { makeRng, TAU, DEG } from '../engine/math.js';
import { makeSurfaceSample, sampleSurface, setSeaIslands } from '../engine/waves.js';
import { createTrack } from './track.js';

const UP = new THREE.Vector3(0, 1, 0);

export function createWorld(engine, { waterSegments, shadows } = {}) {
  const { scene } = engine;
  const env = createEnvironment(engine, { waterSegments, shadows });
  const track = createTrack();
  const rng = makeRng(42);

  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---------------------------------------------------------------- land
  // Each island has its own picture of where the sun does not reach (engine/BakedShadow.js), drawn once below,
  // when everything that stands on it has been built.
  const coarse = matchMedia('(pointer: coarse)').matches;
  terrainUniforms.uTerrainNoise.value = env.noiseTex;
  const shade = (def, size) => {
    const reach = def.radius * 1.3 + def.height * 0.5;
    const baked = new BakedShadow(engine.renderer, {
      size: coarse ? size / 2 : size,
      center: new THREE.Vector3(def.x, def.height * 0.4, def.z),
      radius: reach,
      toSun: SUN_DIR,
    });
    const extend = (material) => withBakedShadow(material, baked);
    const island = createIsland({ ...def, material: createTerrainMaterial(extend) });
    return Object.assign(island, { baked, extend, casters: [island.mesh] });
  };
  const main = shade({ x: 0, z: 0, radius: 78, height: 30, seed: 3, style: 'tropical' }, 2048);
  const lightIslet = shade({ x: -92, z: 250, radius: 24, height: 7, seed: 8, style: 'rock', beach: 0.1 }, 1024);
  const sandIslet = shade({ x: 253, z: -146, radius: 30, height: 5, seed: 12, style: 'tropical', beach: 0.3 }, 1024);
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

  // ---- the rock of the main island (assets/rocks.js): a massif of crags on the high ground, outcrops down its
  //      slopes, boulders along the back of the beach and a few down on the sand. None of it stands where a boat
  //      can float: it is scenery, like everything above the beach.
  /** Where a stone stands and how much room it takes, so that nothing is planted inside one. */
  const stones = [];
  {
    const rr = makeRng(77);
    const rocks = [];
    const put = (x, z, o, sink = 0.3) => {
      rocks.push({ x: main.x + x, z: main.z + z, y: main.heightAt(main.x + x, main.z + z) - o.radius * sink, ...o });
      stones.push({ x: main.x + x, z: main.z + z, r: o.radius });
    };
    // the massif: three crags, the tallest on the summit, and the shoulders they stand on
    const fine = coarse ? 2 : 3; // (phones cut the big crags from a coarser ball)
    put(-8, 10, { seed: 3, radius: 15, height: 54, blocks: 6, lean: [0.07, -0.03], moss: 0.55, detail: fine }, 0.45);
    put(20, -9, { seed: 5, radius: 12, height: 34, blocks: 4, lean: [-0.03, 0.04], moss: 0.55, detail: fine }, 0.45);
    put(-11, -21, { seed: 8, radius: 10, height: 24, blocks: 3, moss: 0.5, detail: fine }, 0.45);
    put(8, 6, { seed: 23, radius: 11, height: 20, blocks: 3, moss: 0.6, detail: 2 }, 0.5);
    put(-24, 2, { seed: 27, radius: 8, height: 13, blocks: 2, moss: 0.6, detail: 2 }, 0.45);
    put(33, -12, { seed: 31, radius: 7, height: 11, blocks: 2, moss: 0.5, detail: 2 }, 0.45);
    put(3, 27, { seed: 35, radius: 7, height: 12, blocks: 2, moss: 0.6, detail: 2 }, 0.45);
    put(10, -33, { seed: 39, radius: 6, height: 9, blocks: 2, moss: 0.5, detail: 2 }, 0.45);
    // boulders: clusters where the grass meets the sand, thinning out toward the water
    const clusters = [28, 74, 118, 152, 204, 246, 288, 330];
    clusters.forEach((deg, c) => {
      const count = 4 + Math.floor(rr() * 4);
      for (let i = 0; i < count; i++) {
        const a = (deg + (rr() - 0.5) * 16) * DEG;
        // most at the back of the beach, a few strays lower down
        const spot = findSpotOnIsland(main, a, rr() < 0.7 ? 2.2 + rr() * 2.2 : 0.5 + rr() * 1.3);
        const radius = 0.9 + rr() * rr() * 3.4;
        const o = { seed: 100 + c * 13 + i, radius, height: radius * (0.75 + rr() * 0.6), cuts: 8 + Math.floor(rr() * 4), detail: radius > 2.2 ? 2 : 1, squash: 0.7 + rr() * 0.3, moss: spot.y > 2.4 ? 0.35 : 0 };
        rocks.push({ x: spot.x, z: spot.z, y: spot.y - radius * 0.22, ...o });
        stones.push({ x: spot.x, z: spot.z, r: radius });
      }
    });
    // outcrops breaking through the grass of the hill
    for (let i = 0; i < 26; i++) {
      const a = rr() * TAU;
      const d = 14 + rr() * 34;
      const x = Math.cos(a) * d + 4;
      const z = Math.sin(a) * d - 6;
      const h = main.heightAt(main.x + x, main.z + z);
      if (h < 4 || stones.some((s) => s.r > 5 && Math.hypot(s.x - main.x - x, s.z - main.z - z) < s.r * 0.9)) continue;
      const radius = 1.6 + rr() * 3.2;
      put(x, z, { seed: 300 + i, radius, height: radius * (0.9 + rr() * 0.9), cuts: 9 + Math.floor(rr() * 4), detail: 2, squash: 0.75 + rr() * 0.25, moss: 0.6 }, 0.35);
    }
    const solidRock = () => withSkyFog(main.extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
    const mesh = new THREE.Mesh(rockField(rocks), solidRock());
    mesh.name = 'rocks';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    main.casters.push(mesh);

    // ---- the thicket: clumps of bush over the hill and along the back of the beach, cut with the same chisel.
    //      A clump is two or three rounded masses grown into one another.
    const clumps = [];
    const count = coarse ? 70 : 130;
    let grown = 0;
    for (let i = 0; i < count * 4 && grown < count; i++) {
      const a = rr() * TAU;
      const d = Math.sqrt(rr()) * 62;
      const x = main.x + Math.cos(a) * d + 3;
      const z = main.z + Math.sin(a) * d - 4;
      const h = main.heightAt(x, z);
      if (h < 2.9 || (h < 4.5 && rr() < 0.6)) continue;
      if (stones.some((s) => Math.hypot(s.x - x, s.z - z) < s.r * (s.r > 5 ? 0.75 : 1) + 0.6)) continue;
      const size = (1.5 + rr() * 2.0) * (h > 8 ? 1.25 : 1);
      const masses = 2 + Math.floor(rr() * 2);
      for (let k = 0; k < masses; k++) {
        const radius = size * (k ? 0.55 + rr() * 0.3 : 1);
        const ox = k ? (rr() - 0.5) * size * 1.5 : 0;
        const oz = k ? (rr() - 0.5) * size * 1.5 : 0;
        const y = main.heightAt(x + ox, z + oz);
        clumps.push({ x: x + ox, z: z + oz, y: y - radius * 0.32, seed: 500 + i * 3 + k, radius, height: radius * (1.05 + rr() * 0.4), cuts: 10 + Math.floor(rr() * 4), taper: 0.62, detail: !coarse && radius > 2.3 ? 2 : 1, squash: 0.85 + rr() * 0.15, tones: FOLIAGE_TONES, round: true });
      }
      stones.push({ x, z, r: size * 0.6 });
      grown++;
    }
    const thicket = new THREE.Mesh(rockField(clumps), solidRock());
    thicket.name = 'thicket';
    thicket.matrixAutoUpdate = false;
    root.add(thicket);
    main.casters.push(thicket);
  }

  // palms: groves along the back of the beach, loners out on the sand, a few up the hill
  const grove = (island, count, low, high, seed) => {
    const spots = [];
    const centres = Array.from({ length: Math.ceil(count / 6) }, () => rng() * TAU);
    for (let i = 0; i < count * 3 && spots.length < count; i++) {
      const loner = rng() < 0.3;
      const angle = loner ? rng() * TAU : centres[i % centres.length] + (rng() - 0.5) * 0.5;
      const spot = findSpotOnIsland(island, angle, low + (loner ? rng() : rng() * rng()) * (high - low));
      if (spot.y < low * 0.8) continue;
      if (spots.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 2.6)) continue;
      if (island === main && stones.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < s.r + 1.3)) continue;
      spots.push(spot);
    }
    const palms = createPalms(spots, { seed, scale: coarse ? 0.5 : 1, anisotropy: Math.min(4, engine.renderer.capabilities.getMaxAnisotropy()), extend: island.extend });
    root.add(palms);
    island.casters.push(palms);
  };
  grove(main, 44, 1.7, 9.5, 5);
  grove(sandIslet, 11, 1.3, 4.2, 6);

  // the rocky islet: a small crag for the lighthouse to stand against, and boulders round its shore
  {
    const rr = makeRng(91);
    const rocks = [];
    const at = (deg, height, o) => {
      const spot = findSpotOnIsland(lightIslet, deg * DEG, height);
      rocks.push({ x: spot.x, z: spot.z, y: spot.y - o.radius * 0.3, ...o });
    };
    at(140, 5.5, { seed: 61, radius: 5.5, height: 12, blocks: 3, moss: 0.5, detail: 2 });
    at(305, 4.5, { seed: 63, radius: 4.2, height: 7, blocks: 2, moss: 0.5, detail: 2 });
    for (let i = 0; i < 16; i++) {
      const radius = 0.9 + rr() * rr() * 2.6;
      at(i * 22.5 + rr() * 14, 0.2 + rr() * 2.4, { seed: 70 + i, radius, height: radius * (0.8 + rr() * 0.6), cuts: 8 + Math.floor(rr() * 4), detail: radius > 2 ? 2 : 1, squash: 0.7 + rr() * 0.3, moss: 0.3, wet: 0.5 });
    }
    const mesh = new THREE.Mesh(rockField(rocks), withSkyFog(lightIslet.extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }))));
    mesh.name = 'islet-rocks';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    lightIslet.casters.push(mesh);
  }

  // lighthouse on the rocky islet
  const lighthouse = createLighthouse();
  lighthouse.position.set(lightIslet.x, lightIslet.heightAt(lightIslet.x, lightIslet.z) - 0.8, lightIslet.z);
  root.add(lighthouse);
  lightIslet.casters.push(lighthouse);

  // pier pointing at the start line
  const pierBase = findSpotOnIsland(main, 0.05, 1.3);
  const pier = createPier({ length: 34, deckY: 2.2 });
  pier.position.set(pierBase.x - 2, 0, pierBase.z);
  root.add(pier);
  main.casters.push(pier);

  /** Draw each island's shadows (once, and again if the graphics context has been lost and restored). */
  const bakeShadows = () => {
    for (const island of solid) island.baked.bake(island.casters);
  };
  bakeShadows();
  engine.onContextRestored(bakeShadows);

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
    terrainUniforms.uTerrainTime.value = time;
    palmUniforms.uPalmTime.value = time;
  }

  return { env, track, root, islands: solid, colliders, buoys, arch, floats, sailboats, terrainHeightAt, update, prepareView };
}
