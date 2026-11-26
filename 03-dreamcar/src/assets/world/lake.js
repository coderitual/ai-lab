// The lake beside the straight: one level sheet at the Track's lake level,
// cut out by the ground itself where the shore rises through it. The tarn of
// the lakeside (lakeside.js) is a second, smaller sheet of the same water.
//
// Cheap on purpose. Its colour is mostly what it reflects: a standard
// material, nearly smooth, takes the sky from the environment map with the
// Fresnel rise towards grazing angles that water has, and the sun's or moon's
// highlight, broken by a ripple normal map that drifts with the run's clock,
// spreads into a glitter path towards the light. Under the reflection the
// water darkens with depth (a vertex colour from the ground's height), so the
// shallows by the shore read a little lighter and greener.

import * as THREE from 'three';
import { gradientField, normalTexture } from '../../engine/noise.js';
import { extend } from './shading.js';

/** Grid of the sheet (m); the shore is drawn by the ground, so it can be coarse. */
const DEFAULT_CELL = 40;
/** How far the ripples drift, metres per second, and their size (m per repeat). */
const DRIFT = [0.05, 0.022];
const RIPPLE = 9;

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {(x: number, z: number) => number} options.heightAt the ground
 * @param {number} options.level the water's height
 * @param {{ x0: number, x1: number, z0: number, z1: number }} options.extent where to lay the sheet
 * @param {number} [options.cell] the sheet's grid (m)
 * @param {(x: number, z: number) => boolean} [options.within] where this water may lie at all (a sheet above the
 *   valley floor must not show over lower ground beyond its own basin)
 * @param {string} [options.name]
 * @param {number} [options.ripple] the ripples' relief (the normal map's scale): more of it mirrors more of the high, blue sky
 * @param {number} [options.sky] how much of the sky's light the water mirrors (1: all of it)
 * @param {(x: number, z: number) => number} [options.mirrors] 0..1 how much of what the water mirrors at a point is
 *   a dark wooded shore and not the sky (the band of reflection along a far bank): the sky's mirror is dimmed and
 *   greened by that much there. A number per vertex, no pass and no texture.
 */
export function createLake({ caps, atmosphere, heightAt, level, extent, cell: CELL = DEFAULT_CELL, within = null, name = 'lake', ripple = 0.35, sky = 1, mirrors = null }) {
  const nx = Math.ceil((extent.x1 - extent.x0) / CELL) + 1;
  const nz = Math.ceil((extent.z1 - extent.z0) / CELL) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const shallow = [0.03, 0.04, 0.03];
  const deep = [0.004, 0.009, 0.011];
  const keep = new Uint8Array(nx * nz);
  const shore = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i;
      const x = extent.x0 + i * CELL;
      const z = extent.z0 + j * CELL;
      const depth = level - heightAt(x, z);
      keep[v] = depth > -6 && (!within || within(x, z)) ? 1 : 0;
      const t = Math.min(1, Math.max(0, depth / 4));
      pos[v * 3] = x;
      pos[v * 3 + 1] = level;
      pos[v * 3 + 2] = z;
      for (let c = 0; c < 3; c++) col[v * 3 + c] = shallow[c] + (deep[c] - shallow[c]) * t;
      shore[v] = mirrors ? mirrors(x, z) : 0;
    }
  }
  const index = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v = j * nx + i;
      // only cells that have water somewhere under them
      if (!(keep[v] || keep[v + 1] || keep[v + nx] || keep[v + nx + 1])) continue;
      index.push(v, v + nx, v + 1, v + 1, v + nx, v + nx + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nx * nz * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
  geometry.setIndex(index);

  const size = 256;
  const ripples = normalTexture(size, gradientField(size, { seed: 61, cells: 8, octaves: 4 }), {
    relief: 0.05,
    anisotropy: Math.min(8, caps.maxAnisotropy ?? 1),
  });
  ripples.repeat.set(1 / RIPPLE, 1 / RIPPLE);
  // world-space texture coordinates: the sheet's own position over the ripple's size, through the map's transform
  const uvs = new Float32Array(nx * nz * 2);
  for (let v = 0; v < nx * nz; v++) {
    uvs[v * 2] = pos[v * 3];
    uvs[v * 2 + 1] = pos[v * 3 + 2];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const material = atmosphere.patch(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.06,
      metalness: 0,
      normalMap: ripples,
      normalScale: new THREE.Vector2(ripple, ripple),
      envMapIntensity: sky,
    }),
  );
  if (mirrors) {
    // the wooded shore's reflection: where the vertex says so the mirrored sky gives way to the wood's dark green
    extend(material, 'lake-mirrors', (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aShore;\nvarying float vShore;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShore = aShore;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShore;')
        .replace(
          '#include <aomap_fragment>',
          '#include <aomap_fragment>\n{ float w = smoothstep( 0.0, 1.0, vShore ); vec3 sky = reflectedLight.indirectSpecular; reflectedLight.indirectSpecular = mix( sky, vec3( 0.25, 0.42, 0.2 ) * dot( sky, vec3( 0.07 ) ), w ); reflectedLight.directSpecular *= 1.0 - 0.8 * w; }',
        );
    });
  }
  material.name = 'lake';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    /** @param {number} simTime */
    update(simTime) {
      ripples.offset.set((simTime * DRIFT[0]) / RIPPLE, (simTime * DRIFT[1]) / RIPPLE);
    },
    dispose() {
      geometry.dispose();
      ripples.dispose();
      material.dispose();
    },
  };
}
