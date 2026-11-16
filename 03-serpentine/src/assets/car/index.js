// The car: createCar() builds the whole model in code and returns the handle
// the game drives it with (CarModel).
//
// The body is one lofted skin (skin.js) sampled into a mesh (body.js); what
// is flush with it (glass, lamp lenses, shut lines, openings) is an atlas of
// distances baked from outlines at start-up (features.js, atlas.js); the same
// vertices are drawn as paint, glass, lenses and a dark inner shell, each with
// its own triangles (materials.js). The lamp units, the grille's insides, the
// mirrors and the cabin are later work: the lamps have stand-ins drawn by the
// paint under their lenses, the openings show the dark shell behind them.
// The wheels are placeholders until wheel.js is fitted.

import * as THREE from 'three';
import { ATLAS_SIZE, bakeAtlas } from './atlas.js';
import { MESH_EDGE, createArchGeometry, createLayout, inArch, sampleSkin, skinGeometry, skinIndex } from './body.js';
import { createLampLights } from './lamps.js';
import { PAINTS, createGhostMaterial, createGlassMaterial, createPaintMaterial, createShared, createShellMaterial } from './materials.js';
import { createPlaceholderWheels } from './placeholderWheels.js';
import { createContactShadow } from './shadow.js';
import { createSkin } from './skin.js';
import { DIMS, STATIONS } from './spec.js';

/** Atlas channels (features.js CHANNELS). */
const GLASS = 0;
const LENS = 3;
const OPENING = 4;

/**
 * @param {{ paint?: string, plate?: string, tier?: 'low'|'medium'|'high', caps?: object, ghost?: boolean }} [options]
 */
export function createCar({ paint = 'silver', tier = 'high', caps, ghost = false } = {}) {
  const t0 = performance.now();
  const object = new THREE.Group();
  object.name = ghost ? 'ghost car' : 'car';
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
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
  const arch = (i, k) => {
    const a = i * rows + k;
    return inside(a) && inside(a + 1) && inside(a + rows) && inside(a + rows + 1);
  };
  const skinMesh = (keepQuad, material) => {
    const mesh = new THREE.Mesh(keep(skinGeometry(attributes, skinIndex(samples, (i, k) => !arch(i, k) && keepQuad(i, k)))), material);
    object.add(mesh);
    return mesh;
  };
  const archGeometry = createArchGeometry(skin);
  keep(archGeometry.lip);
  keep(archGeometry.liner);

  let shared = null;
  let shadow = null;
  let lights = null;
  let ghostMaterial = null;
  if (ghost) {
    ghostMaterial = keep(createGhostMaterial());
    skinMesh(() => true, ghostMaterial);
    object.add(new THREE.Mesh(archGeometry.lip, ghostMaterial));
  } else {
    const atlas = bakeAtlas(skin, lay, ATLAS_SIZE[tier]);
    const textures = atlas.data.map((data) => {
      const texture = keep(new THREE.DataTexture(data, atlas.width, atlas.height, THREE.RGBAFormat));
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return texture;
    });
    // which materials a quad of the mesh can show: the atlas's extremes over the quad's rectangle
    const { u, v } = lay;
    const extremes = (channel, i, k) => atlas.extremes(channel, u.coords[i], u.coords[i + 1], v.coords[k], v.coords[k + 1]);
    shared = createShared(textures);
    const paintMaterial = keep(createPaintMaterial(shared, caps, paint));
    const body = skinMesh((i, k) => extremes(GLASS, i, k)[1] > -0.012 && extremes(OPENING, i, k)[1] > 0, paintMaterial);
    body.castShadow = body.receiveShadow = true;
    // the glass and the lenses lie on the paint's own surface: drawn after it, at the same depth
    skinMesh((i, k) => extremes(GLASS, i, k)[0] < 0.002, keep(createGlassMaterial(shared, caps, GLASS))).renderOrder = 1;
    skinMesh((i, k) => extremes(LENS, i, k)[0] < 0.002, keep(createGlassMaterial(shared, caps, LENS))).renderOrder = 1;
    skinMesh(() => true, keep(createShellMaterial())).receiveShadow = true;
    const lip = new THREE.Mesh(archGeometry.lip, paintMaterial);
    lip.castShadow = lip.receiveShadow = true;
    object.add(lip, new THREE.Mesh(archGeometry.liner, keep(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }))));
    shadow = createContactShadow(samples.position, samples.columns * samples.rows, tier);
    disposables.push(shadow);
    lights = createLampLights(object, keep);
  }

  const wheels = createPlaceholderWheels(object, keep);
  let triangles = 0;
  let drawCalls = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    if (ghostMaterial) o.material = ghostMaterial;
    drawCalls++;
    triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  const level = { drl: 0, low: 0, high: 0, tail: 0, brake: 0, reverse: 0, indicatorL: 0, indicatorR: 0, interior: 0 };
  const middle = (STATIONS.nose + STATIONS.tail) / 2;
  return {
    object,
    headlights: lights ? lights.headlights : [],
    taillight: lights ? lights.taillight : null,
    box: {
      center: new THREE.Vector3(0, DIMS.height / 2, middle),
      half: new THREE.Vector3(DIMS.widthWithMirrors / 2, DIMS.height / 2, DIMS.length / 2),
    },
    paints: Object.keys(PAINTS),
    /** The contact shadow: the game adds it to the scene (it is not part of `object`) and poses it. */
    shadow: shadow ? shadow.mesh : new THREE.Group(),
    poseShadow(point, normal, yaw, strength) {
      if (shadow) shadow.pose(point, normal, yaw, strength);
    },
    /** What the car cost to build, and costs to draw (the contact shadow is one more draw call). */
    stats: { buildMs: performance.now() - t0, triangles, drawCalls },
    setWheel: wheels.setWheel,
    setLights(change) {
      Object.assign(level, change);
      if (!lights) return;
      lights.apply(level);
      shared.carLampsA.value.set(level.drl, level.low, level.high, level.tail);
      shared.carLampsB.value.set(level.brake, level.reverse, level.indicatorL, level.indicatorR);
    },
    setReflections({ cube, sky }) {
      if (!shared) return;
      shared.carProbe.value = cube || null;
      shared.carProbeOn.value = cube ? 1 : 0;
      shared.carSky.value = sky;
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
