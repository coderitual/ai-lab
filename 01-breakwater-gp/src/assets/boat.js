// A tunnel-hull race boat, modelled, painted and assembled in code.
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.
//
// Two slim hulls (sponsons) run the full length and end in pointed bows; a
// cambered centre body bridges them from the transom to a nose a metre short of
// the bows, with the tunnel open underneath. On top: a glass canopy with the
// driver under it, an air scoop, mirrors. On the transom: two outboards that
// swing with the helm, their propellers turning.
//
//   boat/lines.js      the shape as numbers, and the layout of the texture sheet
//   boat/hull.js       geometry: hull, canopy, cockpit, fittings
//   boat/outboard.js   geometry and label of the engines, the propeller
//   boat/livery.js     the paintwork and the detail maps, drawn on canvases
//   boat/materials.js  paint, glass, steel: lit materials under a mirror coat

import * as THREE from 'three';
import { BOAT } from './boat/lines.js';
import { buildCanopyGeometry, buildCockpitGeometry, buildHullGeometry, buildTrimGeometry } from './boat/hull.js';
import { PROP, buildOutboardGeometry, buildPropGeometry, engineTexture } from './boat/outboard.js';
import { LIVERY_FONT } from './boat/livery.js';
import { createBoatMaterials } from './boat/materials.js';

export { BOAT };

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let shared = null;

/**
 * Build one boat. Returns a Group with:
 *   userData.engines     the outboards, to turn about Y with the helm
 *   userData.propellers  to spin about Z
 *   userData.details     small things worth leaving out of pictures in which the boat is tiny
 * @param {{ name: string, hull: string, accent: string }} team
 * @param {number} [number] race number
 * @param {{ anisotropy?: number }} [o]
 */
export function createBoat(team, number = 1, { anisotropy = 8 } = {}) {
  const group = new THREE.Group();
  group.name = `boat-${team.name}`;
  // phones get sheets a quarter of the size
  const mats = createBoatMaterials(team, number, { scale: coarse ? 0.5 : 1, anisotropy });
  if (!shared) shared = { canopy: buildCanopyGeometry(), trim: buildTrimGeometry(), prop: buildPropGeometry() };

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

  const cowl = mats.cowl(engineTexture(anisotropy));
  const outboard = buildOutboardGeometry(team);
  const propellers = [];
  const engines = [1, -1].map((sx) => {
    const engine = add('outboard', outboard, cowl);
    engine.position.set(sx * BOAT.engineX, BOAT.engineY, BOAT.engineZ);
    const prop = add('propeller', shared.prop, mats.steel, { parent: engine, receive: false });
    prop.position.set(PROP.x, PROP.y, PROP.z);
    prop.rotation.z = sx * 0.4;
    propellers.push(prop);
    return engine;
  });

  // The lettering uses the page's display font if it has one; if that was still
  // on its way when the paint went on, paint again when it lands.
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(LIVERY_FONT)) {
    document.fonts.load(LIVERY_FONT).then((faces) => faces.length && mats.repaint(), () => {});
  }

  group.userData.engines = engines;
  group.userData.propellers = propellers;
  group.userData.details = [cockpit, ...propellers];
  return group;
}
