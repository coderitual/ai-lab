// What people built along the road, gathered for index.js: the lamps and
// their pool of real light (lamps.js), the tunnel (tunnel.js), the viaduct
// (viaduct.js), the guard rails (rails.js), the guide posts, chevrons and
// warning signs (posts.js) and the circuit's dressing: the start, boards,
// tyre walls, pit building, town (dressing.js).
//
// All of it is placed from the Track (never from map coordinates), and
// whatever answers the cars' head lamps reads them from prepareView's beams.

import * as THREE from 'three';
import { disposeGroup } from './furniture.js';
import { createDressing } from './dressing.js';
import { createLamps } from './lamps.js';
import { createPosts } from './posts.js';
import { createRails } from './rails.js';
import { setRetroBeams } from './retro.js';
import { createTunnels } from './tunnel.js';
import { createViaducts } from './viaduct.js';

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt, bakeAt, material)
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/rng.js').Rng} options.rng
 */
export function createStructures({ track, terrain, caps, tier, atmosphere, rng }) {
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
  const rails = createRails({ track, tier, atmosphere });
  lap('rails');
  const posts = createPosts({ track, atmosphere });
  lap('posts');
  const viaducts = createViaducts({ track, terrain, atmosphere });
  lap('viaduct');
  const dressing = createDressing({ track, terrain, caps, tier, atmosphere, rng: rng.fork('dressing') });
  lap('dressing');
  const parts = [lamps, tunnels, rails, posts, viaducts, dressing];
  for (const part of parts) group.add(part.group);

  return {
    group,
    /** What the cars' reflection probes leave out. */
    probeHidden: dressing.probeHidden,
    /** What the wet road's mirror leaves out. */
    mirrorHidden: dressing.mirrorHidden,
    stats: { ms, lamps: lamps.stats, rails: rails.stats, posts: posts.stats, viaducts: viaducts.stats, dressing: dressing.stats },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      for (const part of parts) part.setTime?.(time);
    },
    /** The fixed step (the start lamps' green is timed in it). */
    update(dt) {
      dressing.update(dt);
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
