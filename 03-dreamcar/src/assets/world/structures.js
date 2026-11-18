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
import { createRails } from './rails.js';
import { createWalls } from './walls.js';
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
 * @param {object} [options.glints] the wet road's lamp glints (road.js), filled by the lamps each view
 */
export function createStructures({ track, terrain, caps, tier, atmosphere, rng, glints = null }) {
  const group = new THREE.Group();
  group.name = 'structures';
  const ms = {};
  let clock = performance.now();
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };

  const lamps = createLamps({ track, terrain, caps, tier, atmosphere, glints });
  lap('lamps');
  const tunnels = createTunnels({ track, terrain, atmosphere, lamps, tier });
  lap('tunnel');
  const rails = createRails({ track, tier, atmosphere });
  lap('rails');
  const walls = createWalls({ track, atmosphere });
  lap('walls');
  // (a circuit has no guide posts, chevrons or warning signs: posts.js is kept for a public road)
  const posts = { group: new THREE.Group(), stats: { posts: 0 } };
  const viaducts = createViaducts({ track, terrain, atmosphere, tier });
  lap('viaduct');
  const dressing = createDressing({ track, terrain, caps, tier, atmosphere, rng: rng.fork('dressing') });
  lap('dressing');
  const parts = [lamps, tunnels, rails, walls, posts, viaducts, dressing];
  for (const part of parts) group.add(part.group);

  return {
    group,
    /** What the cars' reflection probes leave out. */
    // (picture lane) on the low tier a probe's face is 64 texels across 90 degrees: posts, rails and the glow under
    // the lamps are less than a texel in it, and each cost a draw call
    // (finish lane) on medium too the rails (a few texels of a 128-texel face; a draw call per piece in every face)
    probeHidden: tier === 'low' ? [...dressing.probeHidden, rails.group, posts.group, ...lamps.glows] : [...dressing.probeHidden, rails.group],
    /** The lamps' halos, which only the road's mirror shows (lamps.js). */
    halos: lamps.halos,
    /**
     * What the wet road's mirror leaves out (the lamps' glow lies on the road, which the mirror leaves out too; the
     * rails, posts and beams, 30 to 40 thousand triangles, are dark lines low beside it that its streaks smear away).
     */
    // (finish lane) and the viaducts (their deck is the road, their rails low beside it and their piers under it), the
    // lamps' cones and their heads, which the mirror sees as their halos (lamps.js HALO): ten to twenty draw calls
    mirrorHidden: [...dressing.mirrorHidden, ...lamps.glows, rails.group, viaducts.group, ...[lamps.cones, lamps.heads].filter(Boolean)],
    stats: { ms, lamps: lamps.stats, rails: rails.stats, walls: walls.stats, posts: posts.stats, viaducts: viaducts.stats, dressing: dressing.stats },
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
