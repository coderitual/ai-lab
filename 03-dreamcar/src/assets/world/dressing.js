// What dresses the circuit, gathered: the start gantry and its lamps
// (gantry.js), the trackside boards, distance boards, tyre walls, marshal
// posts and the catch fence (trackside.js), the pit building and the stand
// (pits.js), and the town beyond the start (town.js).
//
// Everything is placed from the Track's data (gantry, boards, tyreWalls,
// distanceBoards, marshals) and stands at or beyond the corridor's solid
// edges. All of it but the start lamps and the town is written into one set
// of merged patches (builder.js) of one material painted from one atlas
// (signs.js), so a chase view draws the dressing in a handful of calls.

import * as THREE from 'three';
import { createBuilder } from './builder.js';
import { disposeGroup } from './furniture.js';
import { createStart } from './gantry.js';
import { createSigns } from './signs.js';
import { buildTrackside } from './trackside.js';
import { buildPits } from './pits.js';
import { createTown } from './town.js';

/** What a lit window or panel sends out at full (lighting.js lamps.windows = 1), linear scene units. */
const GLOW = 1.4;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/rng.js').Rng} options.rng
 */
export function createDressing({ track, terrain, caps, tier, atmosphere, rng }) {
  const group = new THREE.Group();
  group.name = 'dressing';
  const signs = createSigns({ tier, anisotropy: Math.min(tier === 'low' ? 2 : 8, caps?.maxAnisotropy ?? 1) });
  const material = atmosphere.patch(
    new THREE.MeshStandardMaterial({
      map: signs.map,
      emissiveMap: signs.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.62,
      metalness: 0.05,
    }),
  );
  material.name = 'dressing';
  const b = createBuilder();
  const start = createStart({ track, terrain, b, signs, atmosphere });
  const trackside = buildTrackside({ track, terrain, tier, b, signs });
  buildPits({ track, terrain, tier, b, signs });
  const patches = b.build(material, group);
  group.add(start.group);
  const town = createTown({ track, terrain, tier, atmosphere, rng: rng.fork('town') });
  if (town) group.add(town.group);

  return {
    group,
    stats: { patches, triangles: b.triangles, boards: trackside.boards, town: town?.stats },
    setStartLights: (n) => start.setStartLights(n),
    update(dt) {
      start.update(dt);
    },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      material.emissiveIntensity = GLOW * (time.lamps.windows ?? 0);
      start.setTime(time);
      town?.setTime(time);
    },
    dispose() {
      start.dispose();
      town?.dispose();
      signs.dispose();
      disposeGroup(group);
    },
  };
}
