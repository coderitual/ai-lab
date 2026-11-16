// What the boat is made of, as the renderer sees it.
//
// Every painted or polished surface is an ordinary lit material with one layer
// added on top: a coat that mirrors the live picture of the surroundings (see
// engine/ReflectionProbe.js). Underneath, the paint is lit by the sun and the
// sky as usual; on top, the coat shows the horizon, the wake and the other
// boats sliding over the bodywork, the more so the more glancing the view.

import * as THREE from 'three';
import { withLiveReflections } from '../../engine/ReflectionProbe.js';
import { withSkyFog } from '../sky.js';
import { paintDetail, paintLivery } from './livery.js';

const coat = (material, options) => withSkyFog(withLiveReflections(material, options));

function canvasTexture(canvas, anisotropy, color = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

let detailMaps = null;

/**
 * The materials of one boat.
 * @param {{ hull: string, accent: string }} team
 * @param {number} number race number
 * @param {{ scale?: number, anisotropy?: number }} [o] size of the painted sheets (1 = 2048 wide), texture filtering
 */
export function createBoatMaterials(team, number, { scale = 1, anisotropy = 8 } = {}) {
  if (!detailMaps) {
    const d = paintDetail(scale);
    detailMaps = { normal: canvasTexture(d.normal, anisotropy, false), orm: canvasTexture(d.orm, anisotropy, false) };
  }
  const livery = canvasTexture(paintLivery(team, number, scale), anisotropy);

  // Gel coat. (Seen from astern the decks are at a glancing angle; a true
  // mirror there would wash the colours out, hence the cap on `edge`.)
  const paint = coat(
    new THREE.MeshStandardMaterial({
      map: livery,
      normalMap: detailMaps.normal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      aoMap: detailMaps.orm,
      roughnessMap: detailMaps.orm,
      roughness: 1, // the map says how rough
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.85,
    }),
    { strength: 1.2, base: 0.06, edge: 0.44, blur: 0.5 },
  );
  // Glass: a dark tint you can see the driver through, and a strong mirror.
  const glass = coat(new THREE.MeshStandardMaterial({ color: '#0b1a26', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.46, depthWrite: false, envMapIntensity: 0.4 }), { strength: 1.55, base: 0.09, edge: 1, blur: 0 });
  // The engine cowls: gloss black, so what they mirror is nearly all you see of them.
  const cowl = (map) => coat(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.2, metalness: 0, envMapIntensity: 0.6 }), { strength: 1.3, base: 0.08, edge: 0.9, blur: 0.15 });
  // The turbine pod: lacquered carbon and paint.
  const pod = coat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.3, envMapIntensity: 0.7 }), { strength: 1.3, base: 0.08, edge: 0.9, blur: 0.15 });
  // Rubber, plastic and small steel fittings.
  const trim = coat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 }), { strength: 0.8, base: 0.05, edge: 0.6, blur: 1.4 });
  // Polished steel: the propellers.
  const steel = coat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 1, side: THREE.DoubleSide, envMapIntensity: 1.1 }), { strength: 0.9, base: 0.5, edge: 1, blur: 0.6 });
  // Inside the cockpit: matt, and in the shade of the glass.
  const cockpit = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 0.5 }));

  /** Paint the sheet again (the lettering's font has arrived). */
  const repaint = () => {
    livery.image = paintLivery(team, number, scale);
    livery.needsUpdate = true;
  };
  return { paint, glass, cowl, pod, trim, steel, cockpit, livery, repaint };
}
