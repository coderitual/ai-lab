// The light the car's lamps cast: two head lamps and one red glow behind.
//
// (The lamp units themselves, behind their lenses, are drawn by the paint's
// shader: materials.js, carLamp.)
//
//  - The lights are always the same three and are switched by intensity,
//    never by `visible`, so no shader is recompiled when the lamps come on.
//  - The head lamps are spot lights with a picture of the beam in front of
//    them (SpotLight.map): the cut-off of a low beam is in that picture, and
//    main beam is a second picture with its spot added.

import * as THREE from 'three';
import { LAMPS, STATIONS } from './spec.js';

/** What the lamps throw: head lamps in candela-like units at the low beam's hot spot, the tail glow likewise. */
const THROW = { head: 3200, tail: 0.05, brake: 0.25 };
/** Half the angle the beam picture covers. */
const BEAM_ANGLE = 0.5;
/** Main beam's hot spot against dipped beam's (110 000 cd against 30 000 cd a lamp, modelling sheet 9). */
const HIGH_GAIN = 3.7;

/**
 * The picture of a beam, as a head lamp projects it (u to the car's right, v up, both spanning
 * -BEAM_ANGLE..BEAM_ANGLE). Dipped beam: dark above a cut-off 0.57 degrees under the horizontal (67 m ahead on a
 * flat road from 0.67 m up), which kicks up at 15 degrees right of the axis to light the right-hand verge (this
 * car drives on the right); brightest just under the cut-off; much dimmer the further down it points (nearly by
 * the cube of the angle), which lights a flat road evenly from a lamp at knee height instead of whitening the few
 * metres in front of the bumper. Main beam adds a spot on the axis, half a degree up, half as bright at 10
 * degrees across and 3.5 up or down.
 */
function createBeamTexture(high) {
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
      const cutOff = -0.57 + Math.min(1.1, Math.max(0, right) * Math.tan(15 / deg));
      const edge = Math.min(1, Math.max(0, (cutOff - up) / 0.3 + 0.5)); // a third of a degree of softness
      const depth = Math.min(1, 1.5 / Math.max(1.5, 0.3 - up)) ** 2.6; // full strength down to 1.2 degrees under the horizontal
      const spread = Math.exp(-((right / 17) ** 2)) * 0.75 + Math.exp(-((right / 6) ** 2)) * 0.25;
      // a trace above the cut-off, so that signs and reflector posts answer
      let value = (edge + 0.008 * (1 - edge)) * depth * spread;
      // (main beam's spot falls off towards the car like dipped beam does, or it whitens the road by the bumper)
      if (high) value += HIGH_GAIN * depth * Math.exp(-Math.LN2 * ((right / 10) ** 2 + ((up - 0.5) / 3.5) ** 2));
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = THREE.DataUtils.toHalfFloat(value);
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
 * @param {string} tier the head lamps cast shadows only on 'high'
 * @returns {{ headlights: THREE.SpotLight[], taillight: THREE.SpotLight, apply: (level: object) => void }}
 */
export function createLampLights(object, keep, tier = 'high') {
  const dipped = keep(createBeamTexture(false));
  const main = keep(createBeamTexture(true));
  const headlights = [1, -1].map((side) => {
    // about 5700 K
    const light = new THREE.SpotLight(0xfff0e4, 0, 0, BEAM_ANGLE, 0.25, 2);
    light.map = dipped;
    light.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z);
    light.target.position.set(side * LAMPS.head.x, LAMPS.head.y, LAMPS.head.z + 10);
    if (tier === 'high') {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      // the near plane clears the car's own nose, which stands a few tenths ahead of the lamp's centre
      light.shadow.camera.near = 0.45;
      light.shadow.camera.far = 160;
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
    }
    object.add(light, light.target);
    return light;
  });
  // It sits under the boot floor, just inside the bumper's face, and is a spot pointed back and down: from there
  // it reddens the road behind and can shine neither on the car's own tail (a light this close to a panel would
  // whiten it) nor forward onto the rear tyres (a point light did: nothing in the scene stops it).
  const taillight = new THREE.SpotLight(0xff1408, 0, 6, 1.2, 1, 2);
  taillight.position.set(0, 0.3, STATIONS.tail + 0.12);
  taillight.target.position.set(0, -0.6, STATIONS.tail - 3);
  object.add(taillight, taillight.target);
  return {
    headlights,
    taillight,
    apply(level) {
      for (const light of headlights) {
        // main beam is its own picture (dipped beam with the spot added): the map is swapped, never the light
        light.map = level.high > 0.5 ? main : dipped;
        light.intensity = THROW.head * Math.max(level.low, level.high);
      }
      taillight.intensity = THROW.tail * level.tail + THROW.brake * level.brake;
    },
  };
}
