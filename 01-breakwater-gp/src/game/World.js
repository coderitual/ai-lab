// Assembles the race location from the procedural assets and keeps the
// floating props riding the swell.
//
// The place: two islands with a straight river between them. The western one
// is green (a forested hill, beaches, palms) with a small town on its quay; the
// eastern one is a city of towers. Three bridges cross the river. The course
// runs up the river and back round the green island by the open sea.

import * as THREE from 'three';
import { createEnvironment } from '../assets/environment.js';
import { createIsland, createTerrainMaterial, findSpotOnIsland, terrainUniforms } from '../assets/island.js';
import { createPalms, palmUniforms } from '../assets/palm.js';
import { createLighthouse, createPier, createSailboat, createSeaStacks } from '../assets/scenery.js';
import { createCity } from '../assets/city.js';
import { bridgeGeometry } from '../assets/bridge.js';
import { animateBoosts, createBoostCell, createBoostPad, createRamp, RAMP, rampHeightAt } from '../assets/boosts.js';
import { SUN_DIR } from '../assets/palette.js';
import { withSkyFog } from '../assets/sky.js';
import { createCourseFloatAssets, createSlalomBuoy, createStartArch } from '../assets/buoys.js';
import { BakedShadow, withBakedShadow } from '../engine/BakedShadow.js';
import { makeRng, TAU, DEG } from '../engine/math.js';
import { makeSurfaceSample, sampleSurface, sea, setSeaIslands } from '../engine/waves.js';
import { BOOSTS, createTrack, RIVER } from './track.js';

const UP = new THREE.Vector3(0, 1, 0);

/** The bridges over the river: where along it, what kind, how high the roadway is. (They stand on streets.) */
const BRIDGES = [
  { z: -90, kind: 'stay', deck: 12, colour: '#f4f1ea', turn: true },
  { z: 18, kind: 'arch', deck: 11, colour: '#ff6b2c' },
  { z: 90, kind: 'beam', deck: 11, colour: '#2f6f9c' },
];

export function createWorld(engine, { waterSegments, shadows } = {}) {
  const { scene } = engine;
  const env = createEnvironment(engine, { waterSegments, shadows });
  const track = createTrack();
  const rng = makeRng(42);

  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---------------------------------------------------------------- land
  const coarse = matchMedia('(pointer: coarse)').matches;
  const anisotropy = Math.min(4, engine.renderer.capabilities.getMaxAnisotropy());
  terrainUniforms.uTerrainNoise.value = env.noiseTex;

  // One picture of where the sun does not reach (engine/BakedShadow.js) for the two islands, the river between them
  // and everything that stands there, drawn once below when it has all been built.
  const baked = new BakedShadow(engine.renderer, { size: coarse ? 2048 : 4096, center: new THREE.Vector3(0, 40, 0), radius: 350, toSun: SUN_DIR });
  const extend = (material) => withBakedShadow(material, baked);
  const casters = [];
  const standing = (object) => {
    root.add(object);
    casters.push(object);
    return object;
  };

  const green = createIsland({
    x: -120, z: 0, radius: 150, height: 58, seed: 3, style: 'tropical',
    cut: { x: -RIVER.half, land: -1 }, plateau: [42, 74], material: createTerrainMaterial(extend),
  });
  const town = createIsland({
    x: 120, z: 0, radius: 150, height: 30, seed: 9, style: 'tropical',
    cut: { x: RIVER.half, land: 1 }, plateau: [165, 236], material: createTerrainMaterial(extend),
  });
  standing(green.mesh);
  standing(town.mesh);

  // two islets out to the west, each with its own small picture of its shadows
  const bakes = [() => baked.bake(casters)];
  const islet = (def) => {
    const own = new BakedShadow(engine.renderer, { size: coarse ? 512 : 1024, center: new THREE.Vector3(def.x, def.height * 0.4, def.z), radius: def.radius * 1.3 + def.height * 0.5, toSun: SUN_DIR });
    const ext = (material) => withBakedShadow(material, own);
    const island = createIsland({ ...def, material: createTerrainMaterial(ext) });
    root.add(island.mesh);
    const cast = [island.mesh];
    bakes.push(() => own.bake(cast));
    return Object.assign(island, { extend: ext, casters: cast });
  };
  const lightIslet = islet({ x: -468, z: 196, radius: 24, height: 7, seed: 8, style: 'rock', beach: 0.1 });
  const sandIslet = islet({ x: -476, z: -150, radius: 30, height: 5, seed: 12, style: 'tropical', beach: 0.3 });
  const solid = [green, town, lightIslet, sandIslet];

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

  // The sea: calm in the river and in the lee of the town, open to the west.
  sea.shelterDirX = 1;
  sea.shelterDirZ = 0;
  setSeaIslands(
    solid.map((i) => ({ x: i.x, z: i.z, r: i.radius })),
    { ax: RIVER.x, az: RIVER.z0, bx: RIVER.x, bz: RIVER.z1, half: RIVER.half },
  );

  // ---- the city: towers on a grid of streets (the same grid the ground material paves), tallest downtown
  const lots = [];
  const lot = (island, x, z, h, w = 23 + rng() * 4, d = 23 + rng() * 4) => {
    const y = island.heightAt(x, z);
    if (y < island.quay - 0.2 || y > island.quay + 2.5 || island.wildAt(x) > 0.3) return;
    // (clear of the bridges' approaches)
    for (const bz of BRIDGES) if (Math.abs(z - bz.z) < d / 2 + 7 && Math.abs(x) < 82) return;
    lots.push({ x, y: y - 0.4, z, w, d, h });
  };
  for (let i = 0; i < 6; i++) {
    for (let j = -3; j <= 3; j++) {
      const x = 55.5 + 36 * i;
      const z = 36 * j;
      const core = Math.exp(-((x - 100) ** 2 + (z - 6) ** 2) / (2 * 72 * 72));
      let h = 24 + rng() * 22 + core * (56 + 118 * rng());
      if (i === 0) h *= 0.72;
      if (rng() < 0.22) {
        // two slimmer buildings share the block
        lot(town, x - 7.5, z, h * (0.6 + rng() * 0.3), 11.5, 24);
        lot(town, x + 7.5, z, h, 11.5, 24);
      } else lot(town, x, z, Math.min(h, 186));
    }
  }
  // and a row of lower houses on the green island's quay
  for (let j = -3; j <= 3; j++) {
    lot(green, -55.5, 36 * j, 13 + rng() * 26, 22 + rng() * 5, 22 + rng() * 5);
  }
  standing(createCity(lots, { seed: 77, extend }));

  // ---- the bridges
  const steelwork = withSkyFog(extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 })));
  for (const b of BRIDGES) {
    const mesh = new THREE.Mesh(bridgeGeometry({ kind: b.kind, span: RIVER.half * 2, deck: b.deck, ground: green.quay, colour: b.colour }), steelwork);
    mesh.position.set(RIVER.x, 0, b.z);
    if (b.turn) mesh.rotation.y = Math.PI;
    mesh.name = `bridge-${b.kind}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    standing(mesh);
  }

  // ---- palms: groves along the back of the beaches and up the hill, and a row along each quay
  const grove = (island, count, low, high, seed, ext, cast) => {
    const spots = [];
    const centres = Array.from({ length: Math.ceil(count / 6) }, () => rng() * TAU);
    for (let i = 0; i < count * 5 && spots.length < count; i++) {
      const loner = rng() < 0.3;
      const angle = loner ? rng() * TAU : centres[i % centres.length] + (rng() - 0.5) * 0.5;
      const spot = findSpotOnIsland(island, angle, low + (loner ? rng() : rng() * rng()) * (high - low));
      if (spot.y < low * 0.8 || island.wildAt(spot.x) < 0.97) continue;
      if (spots.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 2.6)) continue;
      spots.push(spot);
    }
    const palms = createPalms(spots, { seed, scale: coarse ? 0.5 : 1, anisotropy, extend: ext });
    root.add(palms);
    cast.push(palms);
  };
  // (fewer on phones: a palm is about a thousand triangles, drawn again in the water's mirror)
  grove(green, coarse ? 26 : 46, 1.7, 11, 5, extend, casters);
  grove(town, coarse ? 6 : 10, 1.6, 6, 7, extend, casters);
  grove(sandIslet, coarse ? 6 : 9, 1.3, 4.2, 6, sandIslet.extend, sandIslet.casters);
  const promenade = [];
  for (const island of [green, town]) {
    for (let z = -112; z <= 112; z += coarse ? 28 : 16) {
      if (BRIDGES.some((b) => Math.abs(z - b.z) < 9)) continue;
      const x = island.cut.x + island.cut.land * (5 + rng() * 1.5);
      const y = island.heightAt(x, z);
      if (y > island.quay - 0.2) promenade.push({ x, y, z: z + (rng() - 0.5) * 2 });
    }
  }
  standing(createPalms(promenade, { seed: 9, scale: coarse ? 0.5 : 1, anisotropy, extend }));

  // lighthouse on the rocky islet
  const lighthouse = createLighthouse();
  lighthouse.position.set(lightIslet.x, lightIslet.heightAt(lightIslet.x, lightIslet.z) - 0.8, lightIslet.z);
  root.add(lighthouse);
  lightIslet.casters.push(lighthouse);

  // a short pier on the green island's western beach, clear of the course
  const pierBase = findSpotOnIsland(green, 196 * DEG, 0.4);
  const pier = createPier({ length: 20, deckY: 2.2 });
  pier.position.set(pierBase.x + 2, 0, pierBase.z);
  pier.rotation.y = Math.PI - 16 * DEG;
  standing(pier);

  /** Draw the shadows (once, and again if the graphics context has been lost and restored). */
  const bakeShadows = () => {
    for (const bake of bakes) bake();
  };
  bakeShadows();
  engine.onContextRestored(bakeShadows);

  // sea stacks
  const stacks = createSeaStacks([
    { x: -404, z: -52, r: 7.5, tall: 1.9 },
    { x: -421, z: -36, r: 4.6, tall: 1.4 },
    { x: -396, z: -70, r: 5.4, tall: 1.5 },
    { x: -246, z: 316, r: 6.2, tall: 1.7 },
    { x: -262, z: 304, r: 3.8, tall: 1.3 },
    { x: -228, z: -318, r: 5.0, tall: 1.5 },
    { x: -214, z: -330, r: 3.0, tall: 1.2 },
    { x: 70, z: 300, r: 4.0, tall: 1.4 },
  ]);
  root.add(stacks.mesh);

  /** Static circular obstacles: { x, z, r, bounce }. */
  const colliders = [...stacks.colliders];

  // ------------------------------------------------------ floating props
  const sample = makeSurfaceSample();
  const q = new THREE.Quaternion();
  const n = new THREE.Vector3();

  const sailboats = [
    { x: -402, z: 70, rot: 0.6, sail: '#fdf6e6', stripe: '#ff6b2c' },
    { x: -150, z: 352, rot: 2.1, sail: '#fdf6e6', stripe: '#12a8d8' },
    { x: 96, z: 330, rot: 4.0, sail: '#ffe9c2', stripe: '#d5308c' },
    { x: -120, z: -356, rot: 5.2, sail: '#fdf6e6', stripe: '#8fd128' },
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

  // ---- what lies on the water to be driven at: pads, nitro cells, ramps
  const place = ([fraction, lateral]) => {
    const p = track.pointAt(fraction * track.length, lateral);
    return { x: p.x, z: p.z, heading: p.heading, dirX: p.tx, dirZ: p.tz, s: fraction * track.length };
  };
  const pads = BOOSTS.pads.map((def) => {
    const pad = place(def);
    pad.mesh = createBoostPad();
    pad.mesh.position.set(pad.x, 0, pad.z);
    pad.baseQ = new THREE.Quaternion().setFromAxisAngle(UP, pad.heading);
    root.add(pad.mesh);
    return pad;
  });
  const cells = BOOSTS.cells.map((def) => {
    const cell = place(def);
    cell.ready = new Float64Array(8); // per boat: the sea time at which it is there for that boat again
    cell.mesh = createBoostCell();
    cell.mesh.position.set(cell.x, 0, cell.z);
    cell.mesh.rotation.y = cell.heading;
    root.add(cell.mesh);
    return cell;
  });
  const ramps = BOOSTS.ramps.map((def) => {
    const ramp = place(def);
    ramp.mesh = createRamp();
    ramp.mesh.position.set(ramp.x, 0, ramp.z);
    ramp.mesh.rotation.y = ramp.heading;
    root.add(ramp.mesh);
    return ramp;
  });
  /**
   * If (x, z) is on a ramp, write the ramp's surface there into `out` ({ y, slope: rise per metre along dirX/dirZ })
   * and return true.
   */
  function rampAt(x, z, out) {
    for (const r of ramps) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (dx * dx + dz * dz > 260) continue;
      const u = dx * r.dirX + dz * r.dirZ;
      const v = dx * -r.dirZ + dz * r.dirX;
      const y = rampHeightAt(u, v);
      if (y === -Infinity) continue;
      out.y = y;
      out.slope = (RAMP.height - RAMP.foot) / RAMP.length;
      out.dirX = r.dirX;
      out.dirZ = r.dirZ;
      return true;
    }
    return false;
  }

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

    // pads lie on the swell; cells bob on it and turn
    for (const pad of pads) {
      sampleSurface(pad.x, pad.z, time, sample);
      pad.mesh.position.y = sample.y;
      n.set(sample.nx * 0.8, sample.ny, sample.nz * 0.8).normalize();
      pad.mesh.quaternion.setFromUnitVectors(UP, n).multiply(pad.baseQ);
    }
    for (const cell of cells) {
      sampleSurface(cell.x, cell.z, time, sample);
      cell.mesh.position.y = sample.y;
      cell.mesh.userData.core.rotation.y = time * 2.6;
      cell.mesh.userData.ring.rotation.z = time * 0.7;
    }
    animateBoosts(time);

    lighthouse.userData.animate(time);
    terrainUniforms.uTerrainTime.value = time;
    palmUniforms.uPalmTime.value = time;
  }

  // for the map: the outline of each island that the course runs past
  track.land = [green, town].map((island) => {
    const outline = [];
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * TAU;
      const r = island.shoreRadiusAt(a);
      outline.push([island.x + Math.cos(a) * r, island.z + Math.sin(a) * r]);
    }
    return { outline, town: island === town };
  });

  return { env, track, root, islands: solid, colliders, buoys, arch, floats, sailboats, pads, cells, ramps, rampAt, terrainHeightAt, update, prepareView };
}
