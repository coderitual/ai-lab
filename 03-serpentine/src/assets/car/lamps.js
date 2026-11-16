// The light the car's lamps cast: two head lamps and one red glow behind.
//
// (The lamp units themselves, behind their lenses, are drawn by the body's
// materials for now and are the next stage's work. What is here is meant to
// stay.)
//
//  - The lights are always the same three and are switched by intensity,
//    never by `visible`, so no shader is recompiled when the lamps come on.
//  - The head lamps are spot lights with a picture of the beam in front of
//    them (SpotLight.map): the cut-off of a low beam is in that picture, and
//    main beam is the same picture tilted up and turned up.

import * as THREE from 'three';
import { LAMPS, STATIONS } from './spec.js';

/** What the lamps throw: head lamps in candela-like units at the beam's brightest point, the tail glow likewise. */
const THROW = { low: 3200, high: 9000, tail: 0.3, brake: 1.2 };
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
 * @param {THREE.Object3D} object the car's root: the lights become its children
 * @param {(thing: { dispose: () => void }) => any} keep registers what must be disposed with the car
 * @returns {{ headlights: THREE.SpotLight[], taillight: THREE.SpotLight, apply: (level: object) => void }}
 */
export function createLampLights(object, keep) {
  const beam = keep(createBeamTexture());
  const headlights = [1, -1].map((side) => {
    const light = new THREE.SpotLight(0xf1f4ff, 0, 0, BEAM_ANGLE, 0.25, 2);
    light.map = beam;
    light.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z);
    light.target.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z + 10);
    object.add(light, light.target);
    return light;
  });
  // It sits under the boot floor, just inside the bumper's face, and is a spot pointed back and down: from there
  // it reddens the road behind and can shine neither on the car's own tail (a light this close to a panel would
  // whiten it) nor forward onto the rear tyres (a point light did: nothing in the scene stops it).
  const taillight = new THREE.SpotLight(0xff1408, 0, 7, 1.05, 0.7, 2);
  taillight.position.set(0, 0.3, STATIONS.tail + 0.12);
  taillight.target.position.set(0, -0.6, STATIONS.tail - 3);
  object.add(taillight, taillight.target);
  return {
    headlights,
    taillight,
    apply(level) {
      for (const light of headlights) {
        light.intensity = THROW.low * level.low + THROW.high * level.high;
        // main beam is the same picture tilted up, so its cut-off clears the horizon
        light.target.position.y = light.position.y + 10 * HIGH_TILT * level.high;
      }
      taillight.intensity = THROW.tail * level.tail + THROW.brake * level.brake;
    },
  };
}
