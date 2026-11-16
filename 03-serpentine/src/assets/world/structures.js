// What people built along the road, gathered for index.js: the lamps and
// their pool of real light (lamps.js), the tunnel (tunnel.js), the viaduct
// (viaduct.js), the guard rails (rails.js), the guide posts, chevrons and
// warning signs (posts.js) and the start (gantry.js).
//
// All of it is placed from the Track (never from map coordinates), and
// whatever answers the cars' head lamps reads them from prepareView's beams.

import * as THREE from 'three';
import { disposeGroup } from './furniture.js';
import { createLamps } from './lamps.js';
import { setRetroBeams } from './retro.js';
import { createTunnels } from './tunnel.js';

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt, bakeAt, material)
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createStructures({ track, terrain, caps, tier, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'structures';
  const ms = {};
  let clock = performance.now();
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };

  const lamps = createLamps({ track, caps, tier, atmosphere });
  lap('lamps');
  const tunnels = createTunnels({ track, terrain, atmosphere, lamps });
  lap('tunnel');
  const parts = [lamps, tunnels];
  for (const part of parts) group.add(part.group);

  return {
    group,
    stats: { ms, lamps: lamps.stats },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      for (const part of parts) part.setTime?.(time);
    },
    prepareView(camera, focus, beams) {
      setRetroBeams(beams);
      for (const part of parts) part.prepareView?.(camera, focus, beams);
    },
    setStartLights(n) {
      for (const part of parts) part.setStartLights?.(n);
    },
    dispose() {
      for (const part of parts) part.dispose?.();
      disposeGroup(group);
    },
  };
}
