// What the ground's materials share: a way to add to a built-in material's
// shader without losing what others added, the baked light of the mountain,
// and a small noise for the CPU side of the land.
//
// The baked light is one idea: at a low sun whole valleys lie in the shade of
// a ridge kilometres away, far beyond the shadow map's square round the car.
// So once, at start-up, the height field is marched towards the sun and the
// moon from every point of the ground (terrain.js), and the answer rides on
// each vertex as `aBake`: x the sun's share by day, y the moon's by night, z
// how much of the sky the point can see. A patched material multiplies the
// directional light by x or y (whichever time is showing) and the sky's light
// by z. The shadow map still draws everything near; the bake only adds what
// it cannot reach, and both being "no light" agree where they overlap.

import * as THREE from 'three';

/** Shared by every baked material: which of the two baked channels is the light now showing (day, night). */
export const BAKE_UNIFORMS = { uBakeSel: { value: new THREE.Vector3(1, 0, 0) } };

/**
 * Which baked channel the directional light reads: the day's sun (x), the night's moon (y) or the golden hour's sun
 * (aBake.w; env lane). Geometry whose aBake has only three numbers reads w = 1 (lit) at dusk.
 * @param {'day'|'dusk'|'night'} name
 */
export function selectBake(name) {
  BAKE_UNIFORMS.uBakeSel.value.set(name === 'day' ? 1 : 0, name === 'night' ? 1 : 0, name === 'dusk' ? 1 : 0);
}

/**
 * (road and environment lane) How wet the world is, 0..1 (lighting.js `wetness`, ?wet=): one uniform object shared
 * by every material that rain changes (the asphalt, the paving, the verge, the rock). The road sets it.
 */
export const WET_UNIFORMS = { uWet: { value: 0 } };

/**
 * (road and environment lane) What the tunnel's lit lining looks like from the road, as a radiance: the tunnel sets
 * it from its own lamps and paint, and the asphalt under that roof mirrors it at a glancing angle (road.js), as it
 * mirrors the sky outside.
 */
export const BORE_UNIFORMS = { uBoreGlow: { value: new THREE.Vector3() } };

/**
 * Adds an edit to a material's shader, after whatever edits it already has, and gives it a cache key of its own.
 * @template {THREE.Material} T
 * @param {T} material @param {string} key
 * @param {(shader: any, renderer: THREE.WebGLRenderer) => void} edit
 * @returns {T}
 */
export function extend(material, key, edit) {
  const before = material.onBeforeCompile;
  const previous = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    edit(shader, renderer);
  };
  material.customProgramCacheKey = () => `${previous()}|${key}`;
  return material;
}

const LIGHT_LOOP = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= bakedSun();',
);

/**
 * Makes a material read `aBake` (see above). Geometry drawn with it must carry that attribute: three numbers (x, y, z)
 * or four (w: the golden hour's sun; terrain.bake4At).
 * @template {THREE.Material} T @param {T} material @returns {T}
 */
export function withBake(material) {
  return extend(material, 'bake', (shader) => {
    Object.assign(shader.uniforms, BAKE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBake;\nvarying vec4 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = aBake;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vBake;\nuniform vec3 uBakeSel;\nfloat bakedSun() { return dot( vBake.xyw, uBakeSel ) + 1.0 - uBakeSel.x - uBakeSel.y - uBakeSel.z; }',
      )
      .replace('#include <lights_fragment_begin>', LIGHT_LOOP)
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vBake.z;\nreflectedLight.indirectSpecular *= mix( 1.0, vBake.z, 0.75 );',
      );
  });
}

/**
 * Smooth value noise in the plane, 0..1, seeded: for shaping the land on the CPU (the shaders have their own).
 * @param {number} seed
 */
export function planeNoise(seed) {
  const hash = (ix, iy) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const value = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  /** Several octaves, 0..1. */
  const fbm = (x, y, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value(x, y);
      norm += amp;
      // turned a little at each octave so the lattice never lines up
      const nx = 1.62 * x + 1.18 * y + 17.3;
      y = -1.18 * x + 1.62 * y + 5.1;
      x = nx;
      amp *= 0.5;
    }
    return sum / norm;
  };
  /** Ridged octaves, 0..1: sharp crests, rounded hollows. */
  const ridged = (x, y, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      const r = 1 - Math.abs(2 * value(x, y) - 1);
      const v = r * r * weight;
      weight = Math.min(1, v * 1.6);
      sum += amp * v;
      norm += amp;
      const nx = 1.62 * x + 1.18 * y + 31.7;
      y = -1.18 * x + 1.62 * y + 9.4;
      x = nx;
      amp *= 0.5;
    }
    return sum / norm;
  };
  return { value, fbm, ridged };
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
