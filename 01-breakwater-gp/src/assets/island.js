// Islands. Each is described by an analytic height function (so the physics
// can ask "is there land here?"), meshed smoothly, and shaded by one material
// that knows three kinds of ground (sand, grass, rock) and adds what the mesh
// is far too coarse to hold: ripples and grain in the sand, the dark wet band
// and the lace of foam where the sea reaches, the ragged borders between one
// kind of ground and the next.
//
// The hills that ring the horizon are a different thing: faceted silhouettes
// in the haze, coloured per face.

import * as THREE from 'three';
import { fbm2, makeRng, smoothstep, TAU } from '../engine/math.js';
import { facet } from './geo.js';
import { withSkyFog } from './sky.js';
import { PALETTE } from './palette.js';

let farMaterial = null;
function getFarMaterial() {
  if (!farMaterial) {
    farMaterial = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
  }
  return farMaterial;
}

/** Shared by every piece of ground: the clock that moves the sea's edge up and down the sand. */
export const terrainUniforms = {
  uTerrainTime: { value: 0 },
  uTerrainNoise: { value: null },
};

const TERRAIN_PARS = /* glsl */ `
uniform sampler2D uTerrainNoise;   // r: soft, g: veins, b: fine, a: blobs (all tile)
uniform float uTerrainTime;
varying vec3 vTerrainPos;
`;

// Colour and gloss: replaces <color_fragment>. The vertex colour is not a colour here but how much of each ground
// there is: r sand, g grass, b rock.
const TERRAIN_COLOR = /* glsl */ `
  vec3 tP = vTerrainPos;
  float tSoft = texture2D(uTerrainNoise, tP.xz * 0.011).r;            // patches some 20 m across
  float tMid = texture2D(uTerrainNoise, tP.xz * 0.07 + 0.31).r;        // some 3 m across
  vec4 tFine = texture2D(uTerrainNoise, tP.xz * 0.45);                 // half a metre and less
  // the borders between one ground and the next are ragged, not the straight lines of the mesh
  float tEdge = (tMid - 0.5) * 0.7 + (tFine.b - 0.5) * 0.3;
  float tSand = smoothstep(0.38, 0.62, vColor.r + tEdge * 0.8 + (tFine.a - 0.45) * 0.35);       // (tufts of grass run out onto the sand)
  float tRock = smoothstep(0.42, 0.58, vColor.b + tEdge * 0.7) * (1.0 - tSand);
  float tGrass = 1.0 - tSand - tRock;

  // sand: pale gold where it is dry, darker and richer toward the sea
  float tDamp = (1.0 - smoothstep(0.3, 1.25, tP.y + (tMid - 0.5) * 0.5));
  float tReach = 0.17 + 0.13 * sin(uTerrainTime * 0.7 + tSoft * 12.0 + tP.x * 0.03);      // how far up the last wave came
  float tSoaked = smoothstep(tReach + 0.3, tReach + 0.02, tP.y);
  vec3 tSandCol = mix(vec3(0.66, 0.50, 0.29), vec3(0.76, 0.62, 0.40), tSoft);
  tSandCol *= 0.9 + 0.2 * tFine.b;                                                            // grain
  tSandCol = mix(tSandCol, tSandCol * vec3(0.56, 0.50, 0.42), tDamp * 0.9);
  // the lace of foam the wave leaves as it runs back
  float tLace = (1.0 - smoothstep(0.0, 0.07, abs(tP.y - tReach - 0.03))) * smoothstep(0.3, 0.7, tFine.g + tFine.r * 0.6);
  tSandCol = mix(tSandCol, vec3(0.9, 0.93, 0.95), tLace * 0.75);

  // green: a rough sward low down with paler, drier patches; higher up the dark crowns of the forest
  float tForest = smoothstep(0.45, 0.6, vColor.g * smoothstep(5.0, 11.0, tP.y + (tMid - 0.5) * 6.0));
  float tCanopy = texture2D(uTerrainNoise, tP.xz * 0.036 + 0.17).b;                    // crowns a few metres across
  vec3 tGrassCol = mix(vec3(0.30, 0.50, 0.14), vec3(0.15, 0.33, 0.10), smoothstep(0.3, 0.75, tMid));
  tGrassCol = mix(tGrassCol, vec3(0.50, 0.53, 0.20), smoothstep(0.5, 0.85, tSoft) * 0.45);
  tGrassCol *= 0.72 + 0.56 * tFine.b;
  vec3 tForestCol = mix(vec3(0.03, 0.10, 0.035), vec3(0.14, 0.32, 0.08), smoothstep(0.25, 0.75, tCanopy));
  tForestCol = mix(tForestCol, vec3(0.27, 0.40, 0.10), smoothstep(0.62, 0.85, tMid) * 0.4);
  tForestCol *= 0.75 + 0.5 * tFine.b;
  tGrassCol = mix(tGrassCol, tForestCol, tForest);

  // rock: grey strata, darker and wet near the water
  float tStrata = 0.5 + 0.5 * sin(tP.y * 1.7 + tMid * 9.0 + tSoft * 14.0 + tFine.r * 3.0);
  vec3 tRockCol = mix(vec3(0.21, 0.14, 0.09), vec3(0.56, 0.40, 0.24), tStrata * 0.3 + tFine.b * 0.45 + tMid * 0.25);   // (the tones of assets/rocks.js)
  tRockCol = mix(tRockCol, tRockCol * 0.45, (1.0 - smoothstep(0.2, 1.4, tP.y)));
  tRockCol = mix(tRockCol, vec3(0.22, 0.30, 0.12), smoothstep(0.5, 0.85, tFine.a) * smoothstep(2.0, 6.0, tP.y) * 0.55);   // moss

  diffuseColor.rgb = tSandCol * tSand + tGrassCol * tGrass + tRockCol * tRock;
  float tGloss = max(tSoaked * tSand, (1.0 - smoothstep(0.2, 1.2, tP.y)) * tRock * 0.7);
`;

// The small relief: after <normal_fragment_maps>.
const TERRAIN_NORMAL = /* glsl */ `
  {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    // dunes: the sand's surface rolls gently
    vec2 roll = vec2(texture2D(uTerrainNoise, tP.xz * 0.045).r, texture2D(uTerrainNoise, tP.xz * 0.045 + 0.43).r) - 0.5;
    nW.xz += roll * 0.42 * tSand * (1.0 - tDamp * 0.7);
    // wind ripples: long crests two hand-widths apart, wandering; gone where they would be finer than the picture
    vec2 across = vec2(0.82, 0.57);
    float phase = dot(tP.xz, across) * 15.7 + (tMid - 0.5) * 9.0 + (tSoft - 0.5) * 30.0;
    float keep = 1.0 - smoothstep(0.35, 1.2, fwidth(phase));
    nW.xz += across * cos(phase) * 0.34 * keep * tSand * (1.0 - tDamp);
    // grass and rock are rough at every scale, and the forest is a sea of round crowns
    nW.xz += (tFine.rb - 0.5) * (0.5 * tGrass * (1.0 - tForest) + 0.8 * tRock);
    vec2 crowns = vec2(texture2D(uTerrainNoise, tP.xz * 0.036 + vec2(0.177, 0.17)).b, texture2D(uTerrainNoise, tP.xz * 0.036 + vec2(0.17, 0.177)).b) - tCanopy;
    nW.xz -= crowns * 5.5 * tGrass * tForest;
    normal = normalize((viewMatrix * vec4(normalize(nW), 0.0)).xyz);
  }
`;

// Grains that catch the sun: after <lights_fragment_end>, where the baked shadow has been applied.
const TERRAIN_SPARKLE = /* glsl */ `
  {
    vec3 eyeW = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
    float grain = texture2D(uTerrainNoise, tP.xz * 2.3 + eyeW.xz * 0.4).b;          // shifts as the eye moves: they twinkle
    float glint = smoothstep(0.74, 0.86, grain) * tSand * (1.0 - tDamp);
    reflectedLight.directSpecular += glint * 0.5 * reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.05));
  }
`;

/**
 * The ground material. One per island (each has its own baked shadow), all sharing one program.
 * @param {(material: THREE.Material) => THREE.Material} [extend] further patches (the island's baked shadow)
 */
export function createTerrainMaterial(extend) {
  let material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vTerrainPos;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${TERRAIN_PARS}\nvoid main() {`)
      .replace('#include <color_fragment>', TERRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.16, tGloss);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_NORMAL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TERRAIN_SPARKLE}`);
  };
  material.customProgramCacheKey = () => 'terrain';
  if (extend) material = extend(material);
  return withSkyFog(material);
}

/**
 * @param {object} def
 * @param {number} def.x @param {number} def.z   centre
 * @param {number} def.radius                     mean shoreline radius
 * @param {number} def.height                     summit height
 * @param {number} [def.seed]
 * @param {'tropical'|'rock'|'far'} [def.style]
 * @param {number} [def.beach]                    beach width as a fraction of the radius
 * @param {THREE.Material} [def.material]         the ground material (see createTerrainMaterial)
 */
export function createIsland(def) {
  const { x, z, radius, height, seed = 1, style = 'tropical', beach = 0.16 } = def;
  const rng = makeRng(seed * 7919 + 13);
  const lobes = [2, 3, 5].map((n, i) => ({ n, amp: (0.11 - i * 0.03) * (0.6 + rng() * 0.8), phase: rng() * TAU }));
  const peakAngle = rng() * TAU;
  const peakOff = 0.18 * radius;
  const px = Math.cos(peakAngle) * peakOff;
  const pz = Math.sin(peakAngle) * peakOff;
  const rough = style === 'rock' ? 1.6 : style === 'far' ? 1.2 : 0.9;
  const spurs = style === 'far' ? 1.9 / radius : style === 'tropical' && radius > 50 ? 1.5 / radius : 0;

  const shoreRadiusAt = (angle) => {
    let r = 1;
    for (const l of lobes) r += l.amp * Math.sin(l.n * angle + l.phase);
    return radius * r;
  };

  /** Terrain height at a world position (negative = sea bed). */
  function heightAt(wx, wz) {
    const dx = wx - x;
    const dz = wz - z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const R = shoreRadiusAt(Math.atan2(dz, dx));
    if (r >= R) return Math.max(-9, -(r - R) * 0.17);
    const s = 1 - r / R;
    // distance-to-summit term pulls the high ground off-centre
    const ds = Math.sqrt((dx - px) * (dx - px) + (dz - pz) * (dz - pz)) / R;
    const hill = Math.pow(smoothstep(beach * 0.9, 0.95, s), 1.3) * (0.55 + 0.45 * smoothstep(0.9, 0.0, ds));
    const n = fbm2(wx * 0.03 + seed * 3.1, wz * 0.03 - seed * 1.7, 4, seed) - 0.5;
    const shore = 1.5 * smoothstep(0, beach, s);
    // spurs and gullies run down the bigger hills (none of this reaches the beach, which is all the boats ever touch)
    let relief = 1;
    if (spurs) {
      const crest = 1 - Math.abs(2 * fbm2(wx * spurs + seed * 1.3, wz * spurs + seed * 0.7, 3, seed + 2) - 1);
      relief = 0.66 + 0.62 * crest * crest;
    }
    return shore + height * hill * (1 + n * rough) * relief + n * 2.2 * smoothstep(beach, beach * 2.2, s);
  }

  // ---- mesh: polar grid, denser around the shoreline
  const far = style === 'far';
  const segments = far ? 28 : radius > 50 ? 144 : 80;
  const rings = far ? 9 : radius > 50 ? 44 : 24;
  const ringUs = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    ringUs.push(1.42 * Math.pow(t, 0.82)); // u = r / R
  }
  const positions = [0, heightAt(x, z), 0];
  for (let i = 1; i <= rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = ((s + (i % 2) * 0.5) / segments) * TAU;
      const r = ringUs[i] * shoreRadiusAt(a);
      const lx = Math.cos(a) * r;
      const lz = Math.sin(a) * r;
      positions.push(lx, heightAt(x + lx, z + lz), lz);
    }
  }
  const index = [];
  const start = (i) => 1 + (i - 1) * segments;
  for (let s = 0; s < segments; s++) index.push(0, start(1) + ((s + 1) % segments), start(1) + s);
  for (let i = 1; i < rings; i++) {
    const a = start(i);
    const b = start(i + 1);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      if (i % 2 === 1) index.push(a + s, a + s1, b + s1, a + s, b + s1, b + s);
      else index.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);

  let material;
  if (far) {
    const tmp = new THREE.Color();
    geometry = facet(geometry, (c, normal, out) => {
      const jitter = 0.94 + 0.12 * fbm2(c.x * 0.9 + 31, c.z * 0.9 - 7, 2, seed + 5);
      out.copy(PALETTE.farHills).lerp(tmp.set('#93a7bd'), smoothstep(0.2, 1.0, c.y / height));
      out.multiplyScalar(0.9 + 0.2 * normal.y * jitter);
    });
    material = getFarMaterial();
  } else {
    // smooth normals straight from the height function, and at each vertex how much of each ground there is
    const count = positions.length / 3;
    const normals = new Float32Array(count * 3);
    const grounds = new Float32Array(count * 3);
    const e = 0.7;
    for (let i = 0; i < count; i++) {
      const wx = x + positions[i * 3];
      const wz = z + positions[i * 3 + 2];
      const h = positions[i * 3 + 1];
      const gx = (heightAt(wx + e, wz) - heightAt(wx - e, wz)) / (2 * e);
      const gz = (heightAt(wx, wz + e) - heightAt(wx, wz - e)) / (2 * e);
      const inv = 1 / Math.hypot(gx, 1, gz);
      normals[i * 3] = -gx * inv;
      normals[i * 3 + 1] = inv;
      normals[i * 3 + 2] = -gz * inv;
      const steep = 1 - inv;
      let sand;
      let rock;
      if (style === 'rock') {
        sand = 0;
        rock = Math.max(smoothstep(0.03, 0.14, steep), smoothstep(2.6, 1.2, h));
      } else {
        sand = smoothstep(3.3, 1.9, h);
        rock = smoothstep(0.2, 0.36, steep) * (1 - sand);
      }
      grounds[i * 3] = sand;
      grounds[i * 3 + 1] = Math.max(0, 1 - sand - rock);
      grounds[i * 3 + 2] = rock;
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(grounds, 3));
    material = def.material || createTerrainMaterial();
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 0, z);
  mesh.name = `island-${style}`;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return { mesh, x, z, radius, height, style, heightAt, shoreRadiusAt };
}

/** Find a spot on an island at roughly the requested height (for placing props). */
export function findSpotOnIsland(island, angle, targetHeight) {
  const R = island.shoreRadiusAt(angle);
  let best = null;
  for (let i = 0; i <= 40; i++) {
    const r = (i / 40) * R;
    const wx = island.x + Math.cos(angle) * r;
    const wz = island.z + Math.sin(angle) * r;
    const h = island.heightAt(wx, wz);
    if (!best || Math.abs(h - targetHeight) < Math.abs(best.y - targetHeight)) best = { x: wx, y: h, z: wz };
  }
  return best;
}
