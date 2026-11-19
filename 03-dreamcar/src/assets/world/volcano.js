// (sea lane, round 3) The volcano's breath: the island itself is ground (terrain.js VOLCANO, its height function);
// what is drawn here is the thin plume of steam and smoke that rises from its crater and leans away on the wind,
// and the faint warm glow in the crater that shows when the light goes (the glow follows the sun's strength, not a
// time of day by name: by day nothing, at golden hour a little, at night most).
//
// The plume is an open tube, narrow at the crater and widening upwards, bent downwind in the vertex stage and
// broken into drifting wisps by noise in the fragment stage, which rises with the run's own clock (the same
// picture at the same moment). It is lit and hazed as the world is (a standard material, atmosphere.patch). Two
// draw calls: the plume and the glow.

import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE } from '../../engine/glsl.js';
import { extend } from './shading.js';

/**
 * The plume: its height over the rim (m), its radius at the rim and at the top, how far it leans downwind at the top
 * (m) and which way the wind blows (degrees, 0 = +X, 90 = +Z: off the sea, as the swell); how fast its wisps rise
 * (m/s). The glow: its radiance at full strength (linear, the scene's units) and colour; the sun's strength under
 * which it shows (from `glow.from` down to `glow.to`).
 */
export const VOLCANO_LOOK = {
  plume: { height: 320, r0: 9, r1: 60, lean: 170, wind: -20, rise: 3.5, color: 0xd9d6cf, opacity: 0.72 },
  glow: { radiance: 60, color: [1.0, 0.42, 0.12], from: 5, to: 1 },
};

/**
 * @param {object} options
 * @param {{ x: number, z: number, top: number, crater: number } | null} options.volcano terrain.volcano
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/caps.js').Tier} options.tier
 */
export function createVolcano({ volcano, atmosphere, tier }) {
  const group = new THREE.Group();
  group.name = 'volcano';
  if (!volcano) return { group, setTime() {}, update() {}, dispose() {}, stats: { triangles: 0 } };
  const P = VOLCANO_LOOK.plume;
  const rings = tier === 'low' ? 10 : 18;
  const geometry = new THREE.CylinderGeometry(P.r1, P.r0, P.height, tier === 'low' ? 10 : 16, rings, true).translate(0, P.height / 2, 0);
  const uniforms = {
    uPlumeTime: { value: 0 },
    uPlumeWind: { value: new THREE.Vector3(Math.cos((P.wind * Math.PI) / 180), 0, Math.sin((P.wind * Math.PI) / 180)).multiplyScalar(P.lean) },
    uPlumeGlow: { value: new THREE.Vector3() },
  };
  const material = extend(
    atmosphere.patch(new THREE.MeshStandardMaterial({ color: P.color, roughness: 1, metalness: 0, transparent: true, opacity: P.opacity, depthWrite: false, side: THREE.DoubleSide })),
    'volcano-plume',
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPlumeWind;\nvarying float vPlumeH;\nvarying vec3 vPlumeP;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float plumeH = clamp( transformed.y / ${P.height.toFixed(1)}, 0.0, 1.0 );
vPlumeH = plumeH;
vPlumeP = position;
transformed += uPlumeWind * pow( plumeH, 1.6 );`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uPlumeTime;\nuniform vec3 uPlumeGlow;\nvarying float vPlumeH;\nvarying vec3 vPlumeP;\n${GLSL_HASH}\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// wisps rising and twisting: noise round the tube and up it, drifting up with the clock
float pa = atan( vPlumeP.z, vPlumeP.x );
vec3 pq = vec3( cos( pa ) * 2.2, sin( pa ) * 2.2, vPlumeP.y / 38.0 - uPlumeTime * ${(P.rise / 38).toFixed(4)} );
float pn = 0.55 * valueNoise( pq ) + 0.3 * valueNoise( pq * 2.3 + 7.1 ) + 0.15 * valueNoise( pq * 5.1 + 3.3 );
float pFade = smoothstep( 0.0, 0.06, vPlumeH ) * ( 1.0 - smoothstep( 0.35, 1.0, vPlumeH ) );
diffuseColor.a *= pFade * smoothstep( 0.38, 0.7, pn + 0.25 * ( 1.0 - vPlumeH ) );`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
// lit from below by the glow in the crater
totalEmissiveRadiance += uPlumeGlow * 0.04 * pow( 1.0 - vPlumeH, 6.0 );`,
        );
    },
  );
  const plume = new THREE.Mesh(geometry, material);
  plume.name = 'volcano-plume';
  plume.position.set(volcano.x, volcano.top - 4, volcano.z);
  plume.renderOrder = 6;
  plume.frustumCulled = false;
  plume.updateMatrix();
  plume.matrixAutoUpdate = false;
  group.add(plume);

  // the glow: a disc over the crater's floor, additive, as bright as the sun is weak
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(volcano.crater * 0.42, 20).rotateX(-Math.PI / 2), glowMaterial);
  glow.name = 'volcano-glow';
  glow.position.set(volcano.x, volcano.top - 14, volcano.z);
  glow.updateMatrix();
  glow.matrixAutoUpdate = false;
  glow.visible = true;
  group.add(glow);

  const G = VOLCANO_LOOK.glow;
  return {
    group,
    setTime(t) {
      const strength = t.sun?.intensity ?? 0;
      const k = Math.min(1, Math.max(0, (G.from - strength) / (G.from - G.to)));
      const s = k * k * (3 - 2 * k) * G.radiance;
      glowMaterial.color.setRGB(G.color[0] * s, G.color[1] * s, G.color[2] * s);
      uniforms.uPlumeGlow.value.set(G.color[0] * s, G.color[1] * s, G.color[2] * s);
    },
    update(simTime) {
      uniforms.uPlumeTime.value = simTime;
    },
    stats: { triangles: geometry.index.count / 3 + 20 },
    dispose() {
      geometry.dispose();
      material.dispose();
      glow.geometry.dispose();
      glowMaterial.dispose();
    },
  };
}
