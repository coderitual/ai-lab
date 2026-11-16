// PLACEHOLDER CAR. A body-sized box with a cabin on it, four wheels that
// steer, spin and ride up and down, lamps that light up, and the real lights
// the lamps cast. Its sizes come from spec.js and its interface (CarModel,
// below) is the final one, so the physics, the cameras, the frame pipeline and
// the night lighting can be built against it before the real model exists.
//
// Two things here are meant to be kept by the real car:
//  - the lights are always the same three (two head lamps, one tail glow) and
//    are switched by intensity, never by `visible`, so no shader is recompiled
//    when the lamps come on;
//  - the head lamps are spot lights with a picture of the beam in front of
//    them (SpotLight.map): the cut-off of a low beam is in that picture, and
//    main beam is the same picture tilted up and turned up.

import * as THREE from 'three';
import { DIMS, LAMPS, STATIONS, WHEELS } from './spec.js';

/**
 * @typedef {object} CarModel
 * @property {THREE.Group} object the root, in car space (origin on the ground midway between the axles, +Z forward,
 *   +Y up, +X the car's left)
 * @property {(i: number, pose: { steer: number, spin: number, travel: number }) => void} setWheel pose wheel `i`
 *   (0 FL, 1 FR, 2 RL, 3 RR): steer about +Y (left is positive), spin about its axle (rolling forward is
 *   positive), travel up from rest in metres
 * @property {(lights: { drl?: number, low?: number, high?: number, tail?: number, brake?: number, reverse?: number,
 *   indicatorL?: number, indicatorR?: number, interior?: number }) => void} setLights each 0..1; what is left out
 *   stays as it was
 * @property {(reflections: { cube: THREE.Texture|null, sky: number }) => void} setReflections `cube`: the car's
 *   reflection probe, or null for the scene's environment; `sky`: 0..1 how much sky is overhead
 * @property {THREE.SpotLight[]} headlights the real lights the head lamps cast (left, right)
 * @property {THREE.PointLight} taillight the red spill on the road behind
 * @property {{ center: THREE.Vector3, half: THREE.Vector3 }} box bounding box in car space
 * @property {string[]} paints the paint names it knows
 * @property {() => void} dispose
 */

const PAINTS = {
  silver: { color: 0xb4b8bc, metalness: 0.85, roughness: 0.32 },
  graphite: { color: 0x2b2e33, metalness: 0.8, roughness: 0.3 },
  blue: { color: 0x123c8a, metalness: 0.7, roughness: 0.3 },
  red: { color: 0x8c1016, metalness: 0.5, roughness: 0.3 },
  white: { color: 0xd9dad6, metalness: 0.1, roughness: 0.35 },
};

/**
 * How bright each lamp is when fully on: what its lens sends out, in scene units (see world/lighting.js).
 * A lamp does not know the time of day: the running lights that are a clean white by day (exposure 1) are far
 * too bright for the night's exposure, which is why real cars dim them when the head lamps come on. The game
 * does the same through setLights().
 */
const LENS = { drl: 40, low: 120, high: 260, tail: 0.5, brake: 1.5, reverse: 8, indicator: 6 };
/** What the lamps throw: head lamps in candela-like units at the beam's brightest point, the tail glow likewise. */
const THROW = { low: 3200, high: 9000, tail: 0.6, brake: 1.8 };
/** Half the angle the beam picture covers, and how far main beam tilts it up. */
const BEAM_ANGLE = 0.5;
const HIGH_TILT = Math.tan(THREE.MathUtils.degToRad(3.5));

/**
 * The picture of a low beam, as a head lamp projects it (u to the car's right, v up, both spanning
 * -BEAM_ANGLE..BEAM_ANGLE). Dark above a cut-off just under the horizontal, which kicks up on the right to light
 * the verge; brightest right under the cut-off; and much dimmer the further down it points (nearly by the cube
 * of the angle), which is what lights a flat road evenly from a lamp at knee height instead of whitening the
 * few metres in front of the bumper.
 */
function createBeamTexture() {
  const width = 128;
  const height = 256; // the cut-off wants the finer grid: a fifth of a degree a row
  // half floats: the dim foreground is hundreds of times darker than the hot spot, and 8 bits would band
  const data = new Uint16Array(width * height * 4);
  const span = Math.tan(BEAM_ANGLE);
  const deg = 180 / Math.PI;
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < height; y++) {
    const up = Math.atan((((y + 0.5) / height) * 2 - 1) * span) * deg;
    for (let x = 0; x < width; x++) {
      const right = Math.atan((((x + 0.5) / width) * 2 - 1) * span) * deg;
      const cutOff = -0.6 + Math.min(2.2, Math.max(0, right - 0.5) * Math.tan(15 / deg));
      const edge = Math.min(1, Math.max(0, (cutOff - up) / 0.35 + 0.5)); // a third of a degree of softness
      const depth = Math.min(1, 1.5 / Math.max(1.5, 0.3 - up)) ** 2.6; // full strength down to 1.2 degrees under the horizontal
      const spread = Math.exp(-((right / 17) ** 2)) * 0.8 + Math.exp(-((right / 6) ** 2)) * 0.2;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = THREE.DataUtils.toHalfFloat(edge * depth * spread);
      data[o + 3] = one;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {object} [options]
 * @param {string} [options.paint] one of `paints`
 * @param {string} [options.plate] what the number plate says, default 'AI LAB03' (the placeholder has no plate)
 * @param {import('../../engine/caps.js').Tier} [options.tier] default 'high' (the placeholder is the same on every tier)
 * @param {import('../../engine/caps.js').Caps} [options.caps]
 * @returns {CarModel}
 */
export function createCar({ paint = 'silver' } = {}) {
  const object = new THREE.Group();
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
  const addMesh = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- body: a lower box from bumper to bumper, a cabin box on top
  const paintMaterial = keep(new THREE.MeshStandardMaterial(PAINTS[paint] || PAINTS.silver));
  const glassMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0, roughness: 0.06 }));
  const darkMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.8 }));
  const beltline = 0.93;
  const middle = (STATIONS.nose + STATIONS.tail) / 2;
  addMesh(object, keep(new THREE.BoxGeometry(DIMS.width, beltline - 0.24, DIMS.length)), paintMaterial, 0, (beltline + 0.24) / 2, middle);
  addMesh(object, keep(new THREE.BoxGeometry(DIMS.width - 0.02, 0.1, DIMS.length - 0.3)), darkMaterial, 0, 0.19, middle);
  const cabin = keep(new THREE.BoxGeometry(DIMS.width - 0.28, DIMS.height - beltline, 2.25));
  addMesh(object, cabin, glassMaterial, 0, (DIMS.height + beltline) / 2, -0.42);
  addMesh(object, keep(new THREE.BoxGeometry(DIMS.width - 0.36, 0.03, 1.5)), paintMaterial, 0, DIMS.height + 0.005, -0.42);

  // ---- wheels: hub (rides up and down) > steering knuckle (turns about +Y) > wheel (spins about the axle)
  const tyreMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85 }));
  const rimMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.9, roughness: 0.35 }));
  const wheels = WHEELS.map((spec) => {
    const { radius, width, rim } = spec.tyre;
    const hub = new THREE.Group();
    hub.position.set(spec.x, radius, spec.z);
    const knuckle = new THREE.Group();
    const wheel = new THREE.Group();
    // a cylinder's axis is Y: lay it along the axle
    addMesh(wheel, keep(new THREE.CylinderGeometry(radius, radius, width, 28).rotateZ(Math.PI / 2)), tyreMaterial);
    // spokes, so that the spin can be seen
    const spoke = keep(new THREE.BoxGeometry(0.02, rim * 0.92, 0.05));
    for (let k = 0; k < 5; k++) {
      const s = addMesh(wheel, spoke, rimMaterial, Math.sign(spec.x) * (width / 2 + 0.004), 0, 0);
      s.rotation.x = (k / 5) * Math.PI;
    }
    object.add(hub.add(knuckle.add(wheel)));
    return { hub, knuckle, wheel, radius };
  });

  // ---- lamps: blocks that glow. `level` is what setLights last asked for.
  const level = { drl: 0, low: 0, high: 0, tail: 0, brake: 0, reverse: 0, indicatorL: 0, indicatorR: 0, interior: 0 };
  const lamp = (color) => keep(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3, emissive: color, emissiveIntensity: 0 }));
  const lens = {
    drl: lamp(0xdfe8ff),
    beam: lamp(0xf2f5ff),
    tail: lamp(0xff0a04),
    brake: lamp(0xff0a04),
    reverse: lamp(0xffffff),
    indicatorL: lamp(0xff7a00),
    indicatorR: lamp(0xff7a00),
  };
  const drlBlock = keep(new THREE.BoxGeometry(0.34, 0.025, 0.03));
  const beamBlock = keep(new THREE.BoxGeometry(0.2, 0.07, 0.03));
  const tailBlock = keep(new THREE.BoxGeometry(0.42, 0.09, 0.03));
  const smallBlock = keep(new THREE.BoxGeometry(0.1, 0.05, 0.03));
  for (const side of [1, -1]) {
    const indicator = side > 0 ? lens.indicatorL : lens.indicatorR;
    addMesh(object, drlBlock, lens.drl, side * LAMPS.head.x, LAMPS.head.y + 0.065, STATIONS.nose);
    addMesh(object, beamBlock, lens.beam, side * LAMPS.head.x, LAMPS.head.y, STATIONS.nose);
    addMesh(object, smallBlock, indicator, side * (LAMPS.head.x + 0.12), LAMPS.head.y - 0.08, STATIONS.nose);
    addMesh(object, tailBlock, lens.tail, side * LAMPS.tail.x, LAMPS.tail.y, STATIONS.tail);
    addMesh(object, smallBlock, indicator, side * (LAMPS.tail.x + 0.12), LAMPS.tail.y - 0.1, STATIONS.tail);
    addMesh(object, smallBlock, lens.reverse, side * (LAMPS.tail.x - 0.25), LAMPS.tail.y - 0.1, STATIONS.tail);
  }
  addMesh(object, keep(new THREE.BoxGeometry(0.5, 0.02, 0.02)), lens.brake, LAMPS.thirdBrake.x, LAMPS.thirdBrake.y, LAMPS.thirdBrake.z);

  // ---- the lights the lamps cast
  const beam = keep(createBeamTexture());
  const headlights = [1, -1].map((side) => {
    const light = new THREE.SpotLight(0xf1f4ff, 0, 0, BEAM_ANGLE, 0.25, 2);
    light.map = beam;
    light.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z);
    light.target.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z + 10);
    object.add(light, light.target);
    return light;
  });
  // It sits under the boot floor, just ahead of the bumper's face: from there it reddens the road behind and
  // cannot shine on the car's own tail (a point light this close to a panel would whiten it).
  const taillight = new THREE.PointLight(0xff1408, 0, 12, 2);
  taillight.position.set(0, 0.2, STATIONS.tail + 0.25);
  object.add(taillight);

  return {
    object,
    headlights,
    taillight,
    box: {
      center: new THREE.Vector3(0, DIMS.height / 2, middle),
      half: new THREE.Vector3(DIMS.widthWithMirrors / 2, DIMS.height / 2, DIMS.length / 2),
    },
    paints: Object.keys(PAINTS),

    setWheel(i, { steer, spin, travel }) {
      const w = wheels[i];
      w.hub.position.y = w.radius + travel;
      w.knuckle.rotation.y = steer;
      w.wheel.rotation.x = spin;
    },

    setLights(lights) {
      Object.assign(level, lights);
      lens.drl.emissiveIntensity = LENS.drl * level.drl;
      lens.beam.emissiveIntensity = LENS.low * level.low + LENS.high * level.high;
      lens.tail.emissiveIntensity = LENS.tail * level.tail + LENS.brake * level.brake;
      lens.brake.emissiveIntensity = LENS.brake * level.brake;
      lens.reverse.emissiveIntensity = LENS.reverse * level.reverse;
      lens.indicatorL.emissiveIntensity = LENS.indicator * level.indicatorL;
      lens.indicatorR.emissiveIntensity = LENS.indicator * level.indicatorR;
      for (const light of headlights) {
        light.intensity = THROW.low * level.low + THROW.high * level.high;
        // main beam is the same picture tilted up, so its cut-off clears the horizon
        light.target.position.y = light.position.y + 10 * HIGH_TILT * level.high;
      }
      taillight.intensity = THROW.tail * level.tail + THROW.brake * level.brake;
    },

    setReflections({ cube, sky }) {
      for (const material of [paintMaterial, glassMaterial, rimMaterial]) {
        material.envMap = cube;
        // with no probe of its own the car mirrors the open sky: fade that where there is none overhead
        material.envMapIntensity = cube ? 1 : 0.1 + 0.9 * sky;
      }
    },

    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
