// Low-poly islands. Each island is described by an analytic height function
// (so physics can ask "is there land here?") and meshed into flat-shaded,
// per-face coloured terrain.

import * as THREE from 'three';
import { fbm2, makeRng, smoothstep, TAU } from '../engine/math.js';
import { facet } from './geo.js';
import { withSkyFog } from './sky.js';
import { PALETTE } from './palette.js';

let terrainMaterial = null;
export function getTerrainMaterial() {
  if (!terrainMaterial) {
    terrainMaterial = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
  }
  return terrainMaterial;
}

/**
 * @param {object} def
 * @param {number} def.x @param {number} def.z   centre
 * @param {number} def.radius                     mean shoreline radius
 * @param {number} def.height                     summit height
 * @param {number} [def.seed]
 * @param {'tropical'|'rock'|'far'} [def.style]
 * @param {number} [def.beach]                    beach width as a fraction of the radius
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
    return shore + height * hill * (1 + n * rough) + n * 2.2 * smoothstep(beach, beach * 2.2, s);
  }

  // ---- mesh: polar grid, denser around the shoreline
  const segments = style === 'far' ? 28 : radius > 50 ? 72 : 40;
  const ringUs = [];
  const rings = style === 'far' ? 9 : radius > 50 ? 22 : 13;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    ringUs.push(1.42 * Math.pow(t, 0.82)); // u = r / R
  }
  const positions = [0, 0, 0];
  positions[1] = heightAt(x, z);
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

  const tmp = new THREE.Color();
  geometry = facet(geometry, (c, normal, out) => {
    const jitter = 0.94 + 0.12 * fbm2(c.x * 0.9 + 31, c.z * 0.9 - 7, 2, seed + 5);
    const patch = fbm2(c.x * 0.06 + 3, c.z * 0.06 + 9, 3, seed + 9);
    if (style === 'far') {
      out.copy(PALETTE.farHills).lerp(tmp.set('#93a7bd'), smoothstep(0.2, 1.0, c.y / height));
      out.multiplyScalar(0.9 + 0.2 * normal.y * jitter);
      return;
    }
    const steep = 1 - normal.y;
    if (c.y < 0.35) out.copy(PALETTE.sandWet);
    else if (c.y < 2.4 && style !== 'rock') out.copy(PALETTE.sand).lerp(PALETTE.sandWet, smoothstep(1.2, 0.3, c.y) * 0.6);
    else if (steep > (style === 'rock' ? 0.12 : 0.3)) out.copy(PALETTE.rock).lerp(PALETTE.rockDark, patch);
    else out.copy(PALETTE.grass).lerp(PALETTE.grassDark, smoothstep(0.35, 0.7, patch));
    if (style === 'rock' && c.y < 1.6) out.lerp(PALETTE.rockDark, 0.6);
    out.multiplyScalar(jitter);
  });

  const mesh = new THREE.Mesh(geometry, getTerrainMaterial());
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
