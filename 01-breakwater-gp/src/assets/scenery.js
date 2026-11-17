// Set dressing built from primitives: sea stacks, a lighthouse, a pier with
// huts and bunting, and anchored sailboats. (The palms are in palm.js.)

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lerp, makeRng, TAU } from '../engine/math.js';
import { loft, merge, part } from './geo.js';
import { crag } from './rocks.js';
import { withSkyFog } from './sky.js';
import { PALETTE, TEAMS } from './palette.js';

const lit = (opts = {}) => withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts }));

// ------------------------------------------------------------------ rocks

/**
 * A sea stack: a small crag (see rocks.js) standing in the water. Its foot is at y = 0, and it goes on `root` metres
 * below that, so that the deepest trough never shows its underside.
 */
export function rockGeometry(seed, radius, tallness = 1.3, root = 10) {
  return crag(seed, { radius: radius * 1.3, height: radius * tallness * 1.6, blocks: tallness > 1.45 ? 3 : 2, moss: 0.45, wet: radius * 0.34 + 1.6, root, detail: 2 });
}

/** How far below the still waterline a stack's foot is set. */
const STACK_SINK = 0.5;

/**
 * The circle a hull meets: fitted to the stack's outline at the height of a hull (the mean of how far the rock
 * reaches in each direction, about the middle of those reaches), so that what bounces a boat is where the rock is.
 */
function hullCircle(geometry, x, z) {
  const pos = geometry.attributes.position;
  const N = 24;
  const reach = new Float32Array(N).fill(-Infinity);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.4 || y > 1.3) continue;
    const dx = pos.getX(i) - x;
    const dz = pos.getZ(i) - z;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      const d = dx * Math.cos(a) + dz * Math.sin(a);
      if (d > reach[k]) reach[k] = d;
    }
  }
  // the middle of the outline, then its mean reach from there
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU;
    cx += (reach[k] * Math.cos(a) * 2) / N;
    cz += (reach[k] * Math.sin(a) * 2) / N;
  }
  let r = 0;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU;
    r += (reach[k] - cx * Math.cos(a) - cz * Math.sin(a)) / N;
  }
  return { x: x + cx, z: z + cz, r };
}

/** `stacks` = [{x, z, r, tall?}] — merged into one mesh; also returns the circles boats are bounced off. */
export function createSeaStacks(stacks, seed = 11) {
  const colliders = [];
  const parts = stacks.map((s, i) => {
    const g = rockGeometry(seed + i * 3, s.r, s.tall || 1.3);
    g.translate(s.x, -STACK_SINK, s.z);
    colliders.push({ ...hullCircle(g, s.x, s.z), bounce: 0.35 });
    return g;
  });
  const mesh = new THREE.Mesh(merge(parts), withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })));
  mesh.name = 'seaStacks';
  mesh.matrixAutoUpdate = false;
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
