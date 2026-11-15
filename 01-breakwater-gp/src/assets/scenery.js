// Set dressing built from primitives: palms, sea stacks, a lighthouse, a pier
// with huts and bunting, and anchored sailboats.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fbm2, lerp, makeRng, TAU } from '../engine/math.js';
import { facet, loft, merge, part } from './geo.js';
import { withSkyFog } from './sky.js';
import { PALETTE, TEAMS } from './palette.js';

const lit = (opts = {}) => withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts }));

// ------------------------------------------------------------------ palms

function palmGeometry(rng, height) {
  const parts = [];
  const leanDir = rng() * TAU;
  const lean = 0.8 + rng() * 1.8;
  const segs = 7;
  // trunk: stacked tapered segments following a gentle curve
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const bend = t * t * lean;
    pts.push(new THREE.Vector3(Math.cos(leanDir) * bend, t * height, Math.sin(leanDir) * bend));
  }
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    e.setFromQuaternion(q);
    const r0 = lerp(0.3, 0.16, i / segs);
    const r1 = lerp(0.3, 0.16, (i + 1) / segs) * 0.94;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const shade = PALETTE.trunk.clone().multiplyScalar(i % 2 ? 0.86 : 1);
    parts.push(part(new THREE.CylinderGeometry(r1, r0, len * 1.04, 6), shade, { pos: mid.toArray(), rot: [e.x, e.y, e.z] }));
  }
  // crown: drooping fronds
  const top = pts[segs];
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * TAU + rng() * 0.5;
    const L = 3.0 + rng() * 1.2;
    const rise = 0.5 + rng() * 0.6;
    const droop = 0.42 + rng() * 0.3;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const rows = [];
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      const cx = top.x + dx * L * v;
      const cz = top.z + dz * L * v;
      const cy = top.y + rise * Math.sin(v * Math.PI * 0.8) * 1.2 - droop * L * v * v;
      const w = 0.72 * Math.sin(Math.min(1, v * 1.25 + 0.08) * Math.PI) * (1 - v * 0.35);
      const sag = 0.3 * w;
      rows.push([
        new THREE.Vector3(cx - dz * w, cy - sag, cz + dx * w),
        new THREE.Vector3(cx, cy, cz),
        new THREE.Vector3(cx + dz * w, cy - sag, cz - dx * w),
      ]);
    }
    const col = f % 2 ? PALETTE.palmLeaf : PALETTE.palmLeafLight;
    parts.push(loft(rows, (i) => col.clone().multiplyScalar(lerp(0.8, 1.08, i / N))));
  }
  for (let c = 0; c < 3; c++) {
    const a = rng() * TAU;
    parts.push(part(new THREE.SphereGeometry(0.2, 6, 5), '#5b4530', { pos: [top.x + Math.cos(a) * 0.3, top.y - 0.25, top.z + Math.sin(a) * 0.3] }));
  }
  return merge(parts);
}

/** One merged mesh for a whole grove. `spots` = [{x, y, z}] in world space. */
export function createPalms(spots, seed = 5) {
  const rng = makeRng(seed);
  const variants = [palmGeometry(rng, 6.2), palmGeometry(rng, 7.6), palmGeometry(rng, 9.0)];
  const parts = spots.map((s, i) => {
    const g = variants[i % variants.length].clone();
    const sc = 0.85 + rng() * 0.4;
    g.rotateY(rng() * TAU);
    g.scale(sc, sc, sc);
    g.translate(s.x, s.y - 0.3, s.z);
    return g;
  });
  variants.forEach((v) => v.dispose());
  const mesh = new THREE.Mesh(merge(parts), lit({ side: THREE.DoubleSide, roughness: 0.8 }));
  mesh.name = 'palms';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------------------ rocks

/** Faceted sea stack. Returns a geometry sitting on y = 0. */
export function rockGeometry(seed, radius, tallness = 1.3) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2(v.x * 1.7 + seed * 5.1, v.z * 1.7 + v.y * 2.3 - seed * 2.3, 3, seed);
    const r = radius * (0.72 + n * 0.62);
    const flat = v.y < -0.35 ? 0.4 : 1;
    pos.setXYZ(i, v.x * r, (v.y * tallness * flat + 0.42 * tallness) * r, v.z * r);
  }
  return facet(g, (c, normal, out) => {
    const k = fbm2(c.x * 0.8, c.z * 0.8 + c.y, 2, seed + 3);
    out.copy(PALETTE.rock).lerp(PALETTE.rockDark, 0.25 + k * 0.6);
    if (c.y < radius * 0.28) out.lerp(new THREE.Color('#2b2a2e'), 0.55); // wet line
    if (normal.y > 0.78 && c.y > radius * 0.9) out.lerp(PALETTE.grassDark, 0.55); // moss cap
  });
}

/** `stacks` = [{x, z, r, tall?}] — merged into one mesh; also returns colliders. */
export function createSeaStacks(stacks, seed = 11) {
  const parts = stacks.map((s, i) => {
    const g = rockGeometry(seed + i * 3, s.r, s.tall || 1.3);
    g.translate(s.x, -s.r * 0.25, s.z);
    return g;
  });
  const mesh = new THREE.Mesh(merge(parts), withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })));
  mesh.name = 'seaStacks';
  mesh.matrixAutoUpdate = false;
  const colliders = stacks.map((s) => ({ x: s.x, z: s.z, r: s.r * 0.95, bounce: 0.35 }));
  return { mesh, colliders };
}

// -------------------------------------------------------------- lighthouse

export function createLighthouse() {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const white = '#f6f1e6';
  const red = '#d9483b';
  const parts = [];
  const bands = 5;
  const H = 15;
  for (let i = 0; i < bands; i++) {
    const r0 = lerp(2.5, 1.55, i / bands);
    const r1 = lerp(2.5, 1.55, (i + 1) / bands);
    parts.push(part(new THREE.CylinderGeometry(r1, r0, H / bands, 14), i % 2 ? red : white, { pos: [0, (i + 0.5) * (H / bands), 0] }));
  }
  parts.push(part(new THREE.CylinderGeometry(2.9, 3.2, 1.0, 14), '#8f8a82', { pos: [0, 0.2, 0] }));
  parts.push(part(new THREE.CylinderGeometry(2.25, 2.05, 0.35, 14), '#2b2f36', { pos: [0, H + 0.17, 0] }));
  parts.push(part(new THREE.TorusGeometry(2.2, 0.05, 5, 18), '#2b2f36', { pos: [0, H + 1.0, 0], rot: [Math.PI / 2, 0, 0] }));
  parts.push(part(new THREE.ConeGeometry(1.6, 1.5, 12), red, { pos: [0, H + 2.95, 0] }));
  parts.push(part(new THREE.SphereGeometry(0.22, 8, 6), '#2b2f36', { pos: [0, H + 3.8, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.9, 1.8, 0.3, 2, 0.08), '#3a2c22', { pos: [0, 1.5, 2.42] }));
  group.add(new THREE.Mesh(merge(parts), lit({ roughness: 0.7 })));

  const lanternMat = withSkyFog(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color('#ffe9a8'), emissiveIntensity: 2.2, roughness: 0.4 }));
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.85, 12), lanternMat);
  lantern.position.y = H + 1.27;
  group.add(lantern);
  group.userData.animate = (time) => {
    lanternMat.emissiveIntensity = 1.4 + 2.2 * Math.pow(0.5 + 0.5 * Math.sin(time * 1.7), 6);
  };
  return group;
}

// -------------------------------------------------------------------- pier

/**
 * A pier pointing along local +X from the beach out over the water, ending in
 * a deck with a thatched hut and lines of team bunting.
 */
export function createPier({ length = 34, deckY = 2.0 } = {}) {
  const parts = [];
  const plank = PALETTE.wood;
  const post = PALETTE.woodDark;
  // walkway
  const boards = Math.floor(length / 1.1);
  for (let i = 0; i < boards; i++) {
    const shade = plank.clone().multiplyScalar(0.88 + ((i * 37) % 10) * 0.022);
    parts.push(part(new THREE.BoxGeometry(1.0, 0.16, 3.4), shade, { pos: [i * 1.1 + 0.5, deckY, 0] }));
  }
  for (let i = 0; i <= length; i += 5.5) {
    for (const sz of [1.5, -1.5]) parts.push(part(new THREE.CylinderGeometry(0.19, 0.22, deckY + 5, 6), post, { pos: [i, deckY - 2.6, sz] }));
  }
  // end platform
  const px = length + 4.5;
  parts.push(part(new THREE.BoxGeometry(10, 0.2, 10), plank.clone().multiplyScalar(0.94), { pos: [px, deckY, 0] }));
  for (const sx of [-4.4, 4.4]) for (const sz of [-4.4, 4.4]) parts.push(part(new THREE.CylinderGeometry(0.24, 0.28, deckY + 5, 6), post, { pos: [px + sx, deckY - 2.6, sz] }));
  // hut
  parts.push(part(new THREE.BoxGeometry(5.2, 2.6, 4.4), '#e9dcc0', { pos: [px - 1.4, deckY + 1.4, -1.6] }));
  parts.push(part(new THREE.BoxGeometry(1.1, 1.9, 0.12), '#5b3f2c', { pos: [px - 1.4, deckY + 1.05, 0.62] }));
  parts.push(part(new THREE.ConeGeometry(4.6, 2.6, 4), PALETTE.thatch, { pos: [px - 1.4, deckY + 4.0, -1.6], rot: [0, Math.PI / 4, 0] }));
  // bunting between tall poles along the walkway
  const poleH = 5.2;
  const poles = [0.5, length * 0.5, length - 0.5, px + 4.2];
  for (const x of poles) parts.push(part(new THREE.CylinderGeometry(0.07, 0.09, poleH, 6), '#e8e4da', { pos: [x, deckY + poleH / 2, 1.55] }));
  const flagColors = TEAMS.map((t) => new THREE.Color(t.hull));
  let fi = 0;
  for (let p = 0; p < poles.length - 1; p++) {
    const x0 = poles[p];
    const x1 = poles[p + 1];
    const n = Math.max(4, Math.round((x1 - x0) / 1.3));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const sagY = deckY + poleH - 0.25 - Math.sin(t * Math.PI) * 0.9;
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.42, 0, 0, 0.42, 0, 0, 0, -0.85, 0], 3));
      tri.computeVertexNormals();
      parts.push(part(tri, flagColors[fi++ % flagColors.length], { pos: [lerp(x0, x1, t), sagY, 1.55] }));
    }
  }
  const mesh = new THREE.Mesh(merge(parts), lit({ side: THREE.DoubleSide }));
  mesh.name = 'pier';
  return mesh;
}

// --------------------------------------------------------------- sailboats

export function createSailboat(sailColor = '#fdf6e6', stripe = '#ff6b2c') {
  const group = new THREE.Group();
  group.name = 'sailboat';
  const parts = [];
  // hull: lofted double-ender
  const N = 10;
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = lerp(-4.2, 4.6, t);
    const w = Math.max(0.05, 1.45 * Math.pow(Math.sin(Math.min(1, t * 0.92 + 0.08) * Math.PI), 0.7));
    const sheer = 0.95 + 0.35 * Math.pow(Math.abs(t - 0.45) * 1.8, 2);
    sections.push({ z, w, sheer });
  }
  for (const side of [1, -1]) {
    const rows = sections.map((s) => [
      new THREE.Vector3(0, -0.75, s.z),
      new THREE.Vector3(side * s.w * 0.7, -0.25, s.z),
      new THREE.Vector3(side * s.w, s.sheer, s.z),
      new THREE.Vector3(0, s.sheer + 0.1, s.z),
    ]);
    parts.push(loft(rows, (i, j) => (j === 2 ? stripe : j === 3 ? '#d9c9a8' : '#f5f2ea'), { flip: side === -1 }));
  }
  parts.push(part(new RoundedBoxGeometry(1.5, 0.7, 2.6, 2, 0.2), '#f5f2ea', { pos: [0, 1.35, -0.4] }));
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.1, 11.5, 6), '#d8d4c8', { pos: [0, 6.6, 0.9] }));
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 6), '#d8d4c8', { pos: [0, 2.3, -1.25], rot: [Math.PI / 2, 0, 0] }));
  const tri = (pts, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.computeVertexNormals();
    return part(g, color);
  };
  parts.push(tri([[0.03, 2.45, 0.8], [0.03, 12.0, 0.9], [0.03, 2.45, -3.4]], sailColor));
  parts.push(tri([[0.03, 2.2, 1.05], [0.03, 10.4, 0.95], [0.03, 1.5, 4.4]], sailColor));
  parts.push(tri([[0.05, 2.45, 0.8], [0.05, 4.6, 0.82], [0.05, 2.45, -3.4]], stripe));
  group.add(new THREE.Mesh(merge(parts), lit({ side: THREE.DoubleSide, roughness: 0.75 })));
  group.userData.radius = 3.6;
  return group;
}
