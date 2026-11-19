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
import { SEA_UNIFORMS } from './sea.js';

/**
 * The plume: its height over the rim (m), its radius at the rim and at the top, how far it leans downwind at the top
 * (m) and which way the wind blows (degrees, 0 = +X, 90 = +Z: off the sea, as the swell); how fast its wisps rise
 * (m/s). The glow: its radiance at full strength (linear, the scene's units) and colour; the sun's strength under
 * which it shows (from `glow.from` down to `glow.to`).
 */
export const VOLCANO_LOOK = {
  // (round 4: a soft drifting plume that reads as smoke, not a streak) wide, puffy and thin
  plume: { height: 420, r0: 16, r1: 150, lean: 320, wind: -20, rise: 3.0, color: 0xc9c6c0, opacity: 0.5 },
  glow: { radiance: 60, color: [1.0, 0.42, 0.12], from: 5, to: 1 },
};

/**
 * @param {object} options
 * @param {{ x: number, z: number, top: number, crater: number } | null} options.volcano terrain.volcano
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/caps.js').Tier} options.tier
 */
export function createVolcano({ volcano, atmosphere, tier, track = null, terrain = null }) {
  const group = new THREE.Group();
  group.name = 'volcano';
  const falls = track && terrain ? createFalls({ track, terrain, atmosphere }) : null;
  if (falls) group.add(falls.mesh);
  if (!volcano) return { group, setTime() {}, update() {}, dispose() {}, stats: { triangles: 0 } };
  // the ground's colours on the island (groundMaterial.js reads it)
  SEA_UNIFORMS.uVolcano.value.set(volcano.x, volcano.z, volcano.r, volcano.top);
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
vec3 pq = vec3( cos( pa ) * 1.6, sin( pa ) * 1.6, vPlumeP.y / 60.0 - uPlumeTime * ${(P.rise / 60).toFixed(4)} );
float pn = 0.55 * valueNoise( pq ) + 0.3 * valueNoise( pq * 2.3 + 7.1 ) + 0.15 * valueNoise( pq * 5.1 + 3.3 );
float pFade = smoothstep( 0.0, 0.06, vPlumeH ) * ( 1.0 - smoothstep( 0.35, 1.0, vPlumeH ) );
// soft billows, thinning as it rises and spreads, and a softer edge where the tube is seen edge-on
float pEdge = abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
diffuseColor.a *= pFade * smoothstep( 0.3, 0.75, pn + 0.3 * ( 1.0 - vPlumeH ) ) * ( 1.0 - 0.6 * vPlumeH ) * smoothstep( 0.0, 0.5, pEdge );`,
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
      if (falls) falls.uniforms.uFallTime.value = simTime;
    },
    stats: { triangles: geometry.index.count / 3 + 20 },
    dispose() {
      geometry.dispose();
      material.dispose();
      glow.geometry.dispose();
      glowMaterial.dispose();
      falls?.dispose();
    },
  };
}

/**
 * (sea lane, round 4: the owner's environment references, "a waterfall or two falling from a cliff into the bay")
 * Waterfalls off the bay's cliffs: at each place (`piece`, how far along it, the side), a stream comes out from under
 * the road and falls down the coast's cliff into the bay, `width` m wide, hugging the cliff's face (the terrain's own
 * profile, `off` m out from it), white water streaming down with the run's clock, and a skirt of spray where it meets
 * the sea. One mesh, one draw call, for all of them.
 */
export const FALLS = { places: [['crest', 0.45, -1], ['plunge', 0.35, -1]], width: 7, off: 0.8, speed: 9 };

function createFalls({ track, terrain, atmosphere }) {
  const level = terrain.sea?.level ?? -1.8;
  const pos = [];
  const uv = [];
  const index = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const at = (id, f) => {
    let s0 = 0;
    for (const seg of track.layout?.segments ?? []) {
      const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
      if (seg.id === id) return s0 + len * f;
      s0 += len;
    }
    return null;
  };
  for (const [id, f, side] of FALLS.places) {
    const s = at(id, f);
    if (s === null) continue;
    const edge = track.edgeAt(s, side);
    // down the cliff from just beyond the edge to the water, a row every 2 m out
    const rows = [];
    for (let d = 1.5; d < 90; d += 1.5) {
      track.pointAt(s, side * (edge + d), p);
      const y = terrain.heightAt(p.x, p.z);
      rows.push({ d, y });
      if (y < level) break;
    }
    if (rows.length < 4 || rows[rows.length - 1].y > level) continue;
    const top = rows[0].y;
    const base = pos.length / 3;
    rows.forEach((r, k) => {
      for (const w of [-0.5, 0.5]) {
        track.pointAt(s + w * FALLS.width, side * (edge + r.d + FALLS.off), q);
        pos.push(q.x, Math.max(level, r.y) + FALLS.off, q.z);
        uv.push(w + 0.5, (top - r.y) / FALLS.width);
      }
      if (k > 0) {
        const a = base + (k - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aFall', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const uniforms = { uFallTime: { value: 0 } };
  const material = extend(
    atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xf2f4f2, roughness: 0.35, transparent: true, depthWrite: false, side: THREE.DoubleSide })),
    'waterfall',
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aFall;\nvarying vec2 vFall;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFall = aFall;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uFallTime;\nvarying vec2 vFall;\n${GLSL_HASH}\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// white water streaming down in strands, breaking up as it falls, thick at the middle and ragged at the sides
vec2 fq = vec2( vFall.x * 9.0, vFall.y * 0.9 - uFallTime * ${(FALLS.speed / FALLS.width).toFixed(3)} );
float fn = 0.6 * valueNoise( fq * vec2( 1.0, 3.0 ) ) + 0.4 * valueNoise( fq * vec2( 2.3, 7.0 ) + 4.1 );
float fSide = smoothstep( 0.0, 0.25, vFall.x ) * smoothstep( 1.0, 0.75, vFall.x );
diffuseColor.a *= fSide * smoothstep( 0.25, 0.65, fn + 0.25 * fSide );`,
        );
    },
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'waterfalls';
  mesh.renderOrder = 6;
  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
