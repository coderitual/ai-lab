// The world the car drives through: createWorld() builds it from the Track
// and returns the one object the game talks to.
//
// So far this file assembles the light (everything that later stages are lit
// by) round a placeholder ground:
//   lighting.js     the numbers, one table per time of day
//   atmosphere.js   haze: the helper every world material is patched with
//   sky.js          the dome, the clouds, the stars
//   environment.js  the sky as an environment map, one per time of day
//   sun.js          the sun or moon, its shadow, the fill light
//   placeholderGround.js   the road and its verges until the real ones exist
//
// Three rules the parts keep between them:
//  - The scene always holds the same lights. setTime changes what they are,
//    never how many there are, so the time of day switches without a shader
//    being compiled.
//  - Whatever depends on where a view is (the shadow's square, the fog a
//    standard material sees, how much sky is over the car) is set in
//    prepareView, once for each view, straight before it is drawn.
//  - Nothing moves outside update(): the clouds drift with the run's own
//    clock, so `?manual&t=` is the same picture every time.

import * as THREE from 'three';
import { createAtmosphere } from './atmosphere.js';
import { createEnvironment } from './environment.js';
import { TIMES } from './lighting.js';
import { createPlaceholderGround } from './placeholderGround.js';
import { createSky } from './sky.js';
import { createSun } from './sun.js';

/**
 * @typedef {object} Beam one car's head lamps, for whatever answers them (reflectors)
 * @property {THREE.Vector3} pos @property {THREE.Vector3} dir
 * @property {number} low 0..1 @property {number} high 0..1
 *
 * @typedef {object} World
 * @property {THREE.Scene} scene
 * @property {import('./lighting.js').TimeOfDay} time the time of day now showing
 * @property {(name: 'day'|'night') => import('./lighting.js').TimeOfDay} setTime switch the whole world: sun or moon,
 *   sky, haze, environment map, fill, lamps
 * @property {(dt: number, simTime: number) => void} update fixed step, deterministic (anything animated)
 * @property {(camera: THREE.Camera, focus: THREE.Vector3, beams?: Beam[]) => void} prepareView before each view is
 *   drawn (and before its reflection probe, if that is drawn first): puts the shadow map round `focus` (the view's
 *   car) and asks for it to be drawn again, sets the fog for this camera and shuts the sky's light out where the
 *   car is in the tunnel. A view drawn without it has last view's shadows.
 * @property {(n: number) => void} setStartLights the gantry's countdown lamps, 0..5 lit
 * @property {THREE.Object3D[]} probeHidden what to hide while a reflection probe is drawn
 * @property {number} wetness 0..1 road wetness (a hook for weather)
 * @property {import('./atmosphere.js').Atmosphere} atmosphere the haze; `atmosphere.patch(material)` makes a
 *   material of one's own fade into it
 * @property {() => void} refresh apply the numbers of lighting.js again after they were changed by hand
 * @property {() => void} restore draw again what only lived on the GPU, after a lost WebGL context has come back
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {object} options.track the Track (game/track.js): the road and its corridor
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('../../engine/params.js').Params} options.params
 * @returns {World}
 */
export function createWorld({ renderer, caps, tier, track, rng, params }) {
  const scene = new THREE.Scene();
  const atmosphere = createAtmosphere(caps);
  const sky = createSky({ tier, rng: rng.fork('sky'), atmosphere });
  const environment = createEnvironment({ renderer, caps, sky, atmosphere });
  const sun = createSun({ renderer, tier, shadows: params.shadows });
  const ground = createPlaceholderGround({ caps, tier, track, rng: rng.fork('ground'), atmosphere });

  scene.add(ground.group, sky.dome, sky.stars, ...sun.objects);
  scene.fog = atmosphere.fog;

  let wetness = 0;
  let startLights = 0;
  /** The Track sample each camera's car was last found at: the next search starts there. */
  const hints = new WeakMap();
  const spot = { index: -1, s: 0, lat: 0 };

  /** How much sky is over a point of the map, 0..1: none in the tunnel, easing at its portals. */
  function skyOver(camera, point) {
    if (!track.sky) return 1;
    track.locate(point.x, point.z, hints.get(camera) ?? -1, spot);
    hints.set(camera, spot.index);
    const a = spot.index;
    const b = (a + 1) % track.count;
    return track.sky[a] + (track.sky[b] - track.sky[a]) * (spot.s / track.ds - a);
  }

  /** @type {World} */
  const world = {
    scene,
    time: null,
    probeHidden: [sky.stars],
    atmosphere,

    setTime(name) {
      const time = TIMES[name];
      world.time = time;
      atmosphere.setTime(time);
      sky.setTime(time);

      const { ambient, sky: dome } = time;
      const above = ambient.sky.map((v) => v * ambient.intensity);
      const below = ambient.ground.map((v) => v * ambient.intensity);
      if (!environment.available) {
        // No environment map: the fill also has to be the sky. A sky of radiance L lays PI * L on the ground;
        // most of what reaches level ground comes from high up, where the sky is nearer its zenith's colour.
        for (let i = 0; i < 3; i++) {
          above[i] += Math.PI * (0.7 * dome.zenith[i] + 0.3 * dome.horizon[i]) * time.env.intensity;
          below[i] += Math.PI * dome.ground[i] * time.env.intensity;
        }
      }
      sun.setTime(time, above, below);
      scene.environment = environment.get(name);
      scene.environmentIntensity = time.env.intensity;
      ground.setLamps(time.lamps.street);
      return time;
    },

    update(dt, simTime) {
      sky.update(dt, simTime);
    },

    prepareView(camera, focus) {
      sun.prepareView(camera, focus);
      atmosphere.prepareView(camera);
      // The environment map and the fill are the open sky's light. It does not follow the car into the tunnel
      // (the sun is kept out by its shadow map; these two have none).
      const open = skyOver(camera, focus);
      scene.environmentIntensity = world.time.env.intensity * open;
      sun.setFill(open);
    },

    setStartLights(n) {
      // nothing to light yet: the gantry comes with the roadside
      startLights = n;
    },

    get startLights() {
      return startLights;
    },

    get wetness() {
      return wetness;
    },
    set wetness(value) {
      // all a placeholder can show of rain: darker, smoother asphalt
      wetness = Math.min(1, Math.max(0, value));
      ground.road.roughness = 0.88 - 0.6 * wetness;
      ground.road.color.setScalar(1 - 0.45 * wetness);
    },

    refresh() {
      environment.build();
      world.setTime(world.time.name);
    },

    restore() {
      // The environment maps went with the old context. They are dropped, not disposed: three.js would try to
      // delete GL objects that no longer belong to anything.
      environment.forget();
      world.refresh();
    },

    dispose() {
      environment.dispose();
      sun.dispose();
      sky.dispose();
      ground.dispose();
    },
  };

  world.wetness = params.wet;
  environment.build();
  world.setTime(params.time);
  world.update(0, 0);
  return world;
}
