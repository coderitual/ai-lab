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
// The four corners (tyre, wheel, brake) are wheel.js's, at the places spec.js gives.

import * as THREE from 'three';
import { ATLAS_SIZE, bakeAtlas } from './atlas.js';
import { MESH_EDGE, createArchGeometry, createLayout, inArch, sampleSkin, skinGeometry, skinIndex } from './body.js';
import { buildDetails } from './details.js';
import { createLampLights } from './lamps.js';
import {
  PAINTS,
  createDarkMaterial,
  createLampPartMaterial,
  createGhostMaterial,
  createGlassMaterial,
  createPaintMaterial,
  createPlateMaterial,
  createShared,
  createTrimMaterial,
} from './materials.js';
import { createContactShadow } from './shadow.js';
import { RAIL, createSkin } from './skin.js';
import { DIMS, STATIONS, WHEELS } from './spec.js';
import { createWheel } from './wheel.js';

/** Atlas channels (features.js CHANNELS). */
const GLASS = 0;
const LENS = 3;
const OPENING = 4;

/** Triangles over every other column and row of the sampled skin (both halves), leaving out the arches' holes. */
function coarseIndex(samples, arch) {
  const { columns, rows } = samples;
  const half = columns * rows;
  const index = [];
  for (let i = 0; i < columns - 1; i += 2) {
    const i2 = Math.min(i + 2, columns - 1);
    for (let k = 0; k < rows - 1; k += 2) {
      const k2 = Math.min(k + 2, rows - 1);
      if (arch(i, k) && arch(Math.min(i + 1, columns - 2), Math.min(k + 1, rows - 2))) continue;
      const [a, b, c, d] = [i * rows + k, i2 * rows + k, i * rows + k2, i2 * rows + k2];
      index.push(a, b, c, b, d, c, a + half, c + half, b + half, b + half, c + half, d + half);
    }
  }
  return new Uint32Array(index);
}

/**
 * @param {{ paint?: string, plate?: string, tier?: 'low'|'medium'|'high', caps?: object, ghost?: boolean }} [options]
 */
export function createCar({ paint = 'silver', plate = 'K1 DOMI', tier = 'high', caps, ghost = false } = {}) {
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
      // no mip maps: a mip level would average a thin line's distances away. The shaders antialias every edge
      // from the distance's own footprint, so the full-size level is right at any distance.
      texture.magFilter = texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    });
    // which materials a quad of the mesh can show: the atlas's extremes over the quad's rectangle
    const { u, v } = lay;
    const extremes = (channel, i, k) => atlas.extremes(channel, u.coords[i], u.coords[i + 1], v.coords[k], v.coords[k + 1]);
    shared = createShared(textures);
    const paintMaterial = keep(createPaintMaterial(shared, caps, paint, {
      shoulderV: v.atlas[RAIL.shoulder],
      extentV: lay.extent[1],
      texel: Math.max(lay.extent[0] / atlas.width, lay.extent[1] / atlas.height),
      // the grille's small stars are geometry (details.js) except on the low tier, where the paint draws them
      pins: tier === 'low',
    }));
    // the grille's field is drawn by the paint (its pins and relief), so its quads stay in; the intakes are holes
    const grilleQuad = (i, k) => {
      const j = (i * rows + k) * 3;
      return P[j + 1] > 0.45 && P[j + 1] < 0.72 && Math.abs(P[j]) < 0.56 && P[j + 2] > 1.9;
    };
    const body = skinMesh(
      (i, k) => extremes(GLASS, i, k)[1] > -0.012 && extremes(LENS, i, k)[1] > -0.002 && (extremes(OPENING, i, k)[1] > 0 || grilleQuad(i, k)),
      paintMaterial,
    );
    body.castShadow = body.receiveShadow = true;
    // the glass and the lenses lie on the paint's own surface: drawn after it, at the same depth
    skinMesh((i, k) => extremes(GLASS, i, k)[0] < 0.002, keep(createGlassMaterial(shared, caps, GLASS))).renderOrder = 1;
    skinMesh((i, k) => extremes(LENS, i, k)[0] < 0.002, keep(createGlassMaterial(shared, caps, LENS))).renderOrder = 1;
    // the shell, on every other vertex each way: a quarter of the triangles, and its chords stay inside the paint
    object.add(new THREE.Mesh(keep(skinGeometry(attributes, coarseIndex(samples, arch))), keep(createDarkMaterial(THREE.BackSide))));
    // behind each opening a dark surface 40 mm in: the skin itself, pushed in along its normal
    const recessed = new Float32Array(samples.position.length);
    for (let j = 0; j < recessed.length; j++) recessed[j] = samples.position[j] - samples.normal[j] * 0.04;
    const recess = skinGeometry(
      { ...attributes, position: new THREE.BufferAttribute(recessed, 3) },
      skinIndex(samples, (i, k) => extremes(OPENING, i, k)[0] < 0.005),
    );
    object.add(new THREE.Mesh(keep(recess), keep(createDarkMaterial(THREE.FrontSide, 0.02, 0.6, { mesh: true, sky: 0.45 }))));
    const lip = new THREE.Mesh(archGeometry.lip, paintMaterial);
    lip.castShadow = lip.receiveShadow = true;
    object.add(lip, new THREE.Mesh(archGeometry.liner, keep(createDarkMaterial(THREE.DoubleSide, 0.012, 0.9, { sky: 0.22 }))));
    shadow = createContactShadow(samples.position, samples.columns * samples.rows, tier);
    disposables.push(shadow);
    lights = createLampLights(object, keep, tier);
    // the solid details, one mesh per material
    const details = buildDetails(samples, { tier, plate, skin, lay });
    const numbers = PAINTS[paint] || PAINTS.silver;
    const trim = {
      chrome: () => createTrimMaterial(shared, caps, { color: [0.83, 0.84, 0.86], metal: 1, rough: 0.08 }),
      gloss: () => createTrimMaterial(shared, caps, { color: [0.01, 0.01, 0.012], metal: 0, rough: 0.06, coat: 1 }),
      matte: () => createTrimMaterial(shared, caps, { color: [0.02, 0.02, 0.022], metal: 0, rough: 0.65 }),
      glass: () => createTrimMaterial(shared, caps, { color: [0.38, 0.39, 0.4], metal: 1, rough: 0.02 }),
      body: () => createTrimMaterial(shared, caps, { color: numbers.color, metal: numbers.metal, rough: numbers.rough, coat: 1 }),
      emit: () => createLampPartMaterial(shared, caps),
      // the cabin: black leather and plastic (0.012: at 0.028 the seats read cream in the low sun through the
      // windscreen), lit by whatever sun comes in through the glass; under its roof it sees
      // only the slice of sky the windows let in (with the whole sky the seats shone light grey through the side
      // glass, where the daylight photographs show a dark cabin)
      dark: () => createDarkMaterial(THREE.FrontSide, 0.012, 0.6, { direct: true, sky: 0.3 }),
      plates: () => createPlateMaterial(shared, caps, details.plate),
    };
    for (const [name, geometry] of Object.entries(details.geometries)) {
      const mesh = new THREE.Mesh(keep(geometry), keep(trim[name]()));
      mesh.name = `car ${name}`;
      mesh.castShadow = name !== 'dark' && name !== 'emit';
      mesh.receiveShadow = name === 'dark' || name === 'body';
      object.add(mesh);
    }
    if (details.plate) {
      keep(details.plate.map);
      keep(details.plate.normalMap);
    }
  }

  // the corners: each wheel's origin is its centre, at the tyre's radius above the ground when the car stands
  const wheels = WHEELS.map((spec) => {
    const wheel = keep(createWheel({ front: spec.front, left: spec.left, tier: ghost ? 'low' : tier, caps }));
    if (ghost) {
      // the ghost's wheels are a tyre and spokes: the brake, barrel and blur shell would only add busy layers
      const drop = [];
      wheel.object.traverse((o) => {
        if (o.isMesh && (o.material === wheel.materials[1] || o.material === wheel.materials[3])) drop.push(o);
      });
      for (const o of drop) o.removeFromParent();
    }
    wheel.object.position.set(spec.x, spec.tyre.radius, spec.z);
    wheel.object.name = `wheel ${spec.name}`;
    object.add(wheel.object);
    return wheel;
  });
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
    setWheel(i, pose) {
      wheels[i].setPose(pose);
    },
    setLights(change) {
      Object.assign(level, change);
      if (!lights) return;
      lights.apply(level);
      shared.carLampsA.value.set(level.drl, level.low, level.high, level.tail);
      shared.carLampsB.value.set(level.brake, level.reverse, level.indicatorL, level.indicatorR);
      shared.carLampsC.value.set(level.interior, 0, 0, 0);
    },
    setReflections({ cube, sky }) {
      for (const wheel of wheels) wheel.setReflections({ cube, sky });
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
