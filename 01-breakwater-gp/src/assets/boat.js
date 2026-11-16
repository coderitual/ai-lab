// A tunnel-hull race boat from a few years ahead, modelled, painted and
// assembled in code.
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.
//
// Two slim hulls (sponsons) run the full length and end in bows that draw
// together like the points of a fork; a cambered centre body bridges them from
// the transom to a nose a metre short of the bows, with the tunnel open
// underneath. On top: a glass canopy with the driver under it, and behind it,
// on a pylon, the turbine that drives the boat, its nozzle glowing.
//
//   boat/lines.js      the shape as numbers, and the layout of the texture sheet
//   boat/hull.js       geometry: hull, canopy, cockpit, fittings
//   boat/thruster.js   the turbine pod, the glow in its nozzle and its flame
//   boat/livery.js     the paintwork and the detail maps, drawn on canvases
//   boat/materials.js  paint, glass, steel: lit materials under a mirror coat

import * as THREE from 'three';
import { BOAT } from './boat/lines.js';
import { POD } from './boat/thruster.js';
import { buildCanopyGeometry, buildCockpitGeometry, buildHullGeometry, buildTrimGeometry } from './boat/hull.js';
import { buildFlameGeometry, buildGlowGeometry, buildPodGeometry, createFlameMaterial } from './boat/thruster.js';
import { LIVERY_FONT } from './boat/livery.js';
import { createBoatMaterials } from './boat/materials.js';

export { BOAT };

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let shared = null;

/**
 * Build one boat. Returns a Group with:
 *   userData.setThrust(throttle, boost, time)  how hard the turbine is burning (0..1 each): sets the glow and the flame
 *   userData.details     small things worth leaving out of pictures in which the boat is tiny
 * @param {{ name: string, hull: string, accent: string, css?: string }} team
 * @param {number} [number] race number
 * @param {{ anisotropy?: number }} [o]
 */
export function createBoat(team, number = 1, { anisotropy = 8 } = {}) {
  const group = new THREE.Group();
  group.name = `boat-${team.name}`;
  // phones get sheets a quarter of the size
  const mats = createBoatMaterials(team, number, { scale: coarse ? 0.5 : 1, anisotropy });
  if (!shared) shared = { canopy: buildCanopyGeometry(), trim: buildTrimGeometry(), glow: buildGlowGeometry(), flame: buildFlameGeometry() };

  const add = (name, geometry, material, { cast = true, receive = true, parent = group } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };
  add('hull', buildHullGeometry(team), mats.paint);
  add('trim', shared.trim, mats.trim);
  const cockpit = add('cockpit', buildCockpitGeometry(team), mats.cockpit, { cast: false });
  add('canopy', shared.canopy, mats.glass, { cast: false, receive: false });

  // the turbine: its pod, the fire in its nozzle, and the flame behind
  add('pod', buildPodGeometry(team), mats.pod);
  const fire = new THREE.Color(team.css || team.hull).lerp(new THREE.Color('#bfe9ff'), 0.55);
  const glowMaterial = new THREE.MeshBasicMaterial({ color: fire.clone(), toneMapped: false });
  add('glow', shared.glow, glowMaterial, { cast: false, receive: false });
  const flameMaterial = createFlameMaterial(fire);
  const flame = add('flame', shared.flame, flameMaterial, { cast: false, receive: false });
  flame.position.set(0, POD.y, POD.z1 + 0.06);
  flame.renderOrder = 4;
  /** How hard the turbine is burning: `throttle` and `boost` 0..1. */
  const setThrust = (throttle, boost = 0, time = 0) => {
    const k = 0.3 + 0.75 * throttle + 2.4 * boost;
    glowMaterial.color.copy(fire).multiplyScalar(k).addScalar(boost * 0.6);
    const flicker = 1 + 0.07 * Math.sin(time * 71) + 0.05 * Math.sin(time * 113 + 1.7);
    flame.scale.set(1, 1, (0.12 + 0.42 * throttle + 1.25 * boost) * flicker);
    flameMaterial.uniforms.uPower.value = 0.1 + 0.3 * throttle + 0.75 * boost;
  };
  setThrust(0, 0, 0);

  // The lettering uses the page's display font if it has one; if that was still
  // on its way when the paint went on, paint again when it lands.
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(LIVERY_FONT)) {
    document.fonts.load(LIVERY_FONT).then((faces) => faces.length && mats.repaint(), () => {});
  }

  group.userData.setThrust = setThrust;
  group.userData.details = [cockpit];
  return group;
}
