// The sky as a light: one prefiltered environment map per time of day, made
// from the sky dome at start-up. It is what `scene.environment` points at, so
// every standard material is lit from all round by the very sky that is
// drawn behind it, sharp on glass and chrome and blurred on rough things.
//
// Both maps are made before the first frame: switching the time of day is a
// pointer swap, not a pause. They are pictures of the sky at that moment (the
// clouds drift on without them) and do not hold the sun's disc: its highlight
// comes from the sun's own light.
//
// The prefilter needs half-float render targets. A device without them gets
// no environment map; the world's fill light stands in (see index.js).

import * as THREE from 'three';
import { TIMES } from './lighting.js';

/** Where the sky is looked at from: about the height of the middle of the course, for the depth of the haze band. */
const EYE = new THREE.Vector3(0, 40, 0);

/**
 * @typedef {object} Environment
 * @property {boolean} available false where the device cannot make the maps
 * @property {(name: string) => THREE.Texture|null} get the map for a time of day
 * @property {() => void} build make (or make again) every map, from the sky as lighting.js now describes it
 * @property {() => void} forget drop the maps without freeing them: after a lost WebGL context they are already gone
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('./sky.js').Sky} options.sky
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @returns {Environment}
 */
export function createEnvironment({ renderer, caps, sky, atmosphere }) {
  /** @type {Map<string, THREE.WebGLRenderTarget>} */
  const maps = new Map();

  return {
    available: caps.hdr,

    get(name) {
      const target = maps.get(name);
      return target ? target.texture : null;
    },

    build() {
      if (!caps.hdr) return;
      for (const target of maps.values()) target.dispose();
      maps.clear();
      // (the generator keeps some ten megabytes of working targets for as long as it lives: it is made for the
      // job and let go again)
      const pmrem = new THREE.PMREMGenerator(renderer);
      // the sky and its haze are set to each time in turn; whoever called puts the current one back
      for (const time of Object.values(TIMES)) {
        atmosphere.setTime(time);
        sky.setTime(time);
        maps.set(time.name, pmrem.fromScene(sky.envScene, 0, 0.1, 10, { position: EYE }));
      }
      pmrem.dispose();
    },

    forget() {
      maps.clear();
    },

    dispose() {
      for (const target of maps.values()) target.dispose();
      maps.clear();
    },
  };
}
