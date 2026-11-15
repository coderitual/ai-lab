// A sit-down personal watercraft, modelled in code.
// Local axes: +Z bow, +Y up, +X port. The origin sits on the waterline amidships.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, lerp, smoothstep } from '../engine/math.js';
import { fan, loft, merge, part } from './geo.js';
import { withSkyFog } from './sky.js';

export const CRAFT = {
  length: 3.25,
  sternZ: -1.55,
  bowZ: 1.7,
  halfWidth: 0.6,
  seatTop: 0.6,
  gripY: 0.84,
  gripZ: 0.16,
  gripX: 0.3,
  /** Where the steering column pivots (handlebar group origin). */
  barPivot: new THREE.Vector3(0, 0.84, 0.16),
  footY: 0.3,
};

// ---- hull section curves, t = 0 (stern) .. 1 (bow)
const zAt = (t) => lerp(CRAFT.sternZ, CRAFT.bowZ, t);
function halfWidthAt(t) {
  if (t <= 0.45) return lerp(0.53, CRAFT.halfWidth, smoothstep(0, 0.36, t));
  const u = (t - 0.45) / 0.55;
  return Math.max(0.025, CRAFT.halfWidth * Math.pow(1 - Math.pow(u, 2.3), 0.72));
}
const keelAt = (t) => -0.27 + 0.5 * Math.pow(clamp01((t - 0.5) / 0.5), 1.6);
const chineAt = (t) => -0.07 + 0.36 * Math.pow(clamp01((t - 0.45) / 0.55), 1.4);
const gunwaleAt = (t) => 0.17 + 0.16 * smoothstep(0.35, 1, t);
const hoodAt = (t) => 0.27 * smoothstep(0.4, 0.6, t) * (1 - smoothstep(0.78, 1.0, t));

function buildHullGeometry(team) {
  const hull = new THREE.Color(team.hull);
  const accent = new THREE.Color(team.accent);
  const belly = new THREE.Color('#f3f0e8');
  const deckShade = hull.clone().multiplyScalar(0.82);

  const N = 18;
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = halfWidthAt(t);
    const z = zAt(t);
    const yg = gunwaleAt(t);
    const hood = hoodAt(t);
    sections.push({
      t,
      keel: new THREE.Vector3(0, keelAt(t), z),
      chine: new THREE.Vector3(0.8 * w, chineAt(t), z),
      gunwale: new THREE.Vector3(w, yg, z),
      shoulder: new THREE.Vector3(0.64 * w, yg + 0.06 + hood * 0.55, z),
      crown: new THREE.Vector3(0.3 * w, yg + 0.085 + hood * 0.93, z),
      centre: new THREE.Vector3(0, yg + 0.09 + hood, z),
    });
  }
  const mirror = (v) => new THREE.Vector3(-v.x, v.y, v.z);
  const parts = [];
  for (const side of [1, -1]) {
    const pick = (keys) => sections.map((s) => keys.map((k) => (side === 1 ? s[k] : mirror(s[k]))));
    const flip = side === -1;
    // planing bottom
    parts.push(loft(pick(['keel', 'chine']), () => belly, { flip }));
    // topsides: team colour with an accent flash toward the bow
    parts.push(
      loft(
        pick(['chine', 'gunwale']),
        (i) => (sections[i].t > 0.6 && sections[i].t < 0.86 ? accent : hull),
        { flip },
      ),
    );
    // deck + hood, a darker centre stripe running over the cowl
    parts.push(
      loft(
        pick(['gunwale', 'shoulder', 'crown', 'centre']),
        (i, j) => (j >= 2 && sections[i].t > 0.38 ? accent : j === 0 ? hull : deckShade),
        { flip },
      ),
    );
  }
  // transom
  const s0 = sections[0];
  const outline = [s0.keel, s0.chine, s0.gunwale, s0.shoulder, s0.crown, s0.centre, mirror(s0.crown), mirror(s0.shoulder), mirror(s0.gunwale), mirror(s0.chine)];
  parts.push(fan(outline, deckShade, { flip: true }));
  return merge(parts);
}

function buildTrimGeometry() {
  const dark = '#1d2026';
  const rubber = '#121418';
  const metal = '#8d949c';
  const parts = [];

  // saddle
  parts.push(part(new RoundedBoxGeometry(0.36, 0.3, 1.2, 3, 0.11), dark, { pos: [0, CRAFT.seatTop - 0.15, -0.56] }));
  // seat hump behind the rider
  parts.push(part(new RoundedBoxGeometry(0.3, 0.2, 0.34, 3, 0.09), dark, { pos: [0, CRAFT.seatTop + 0.02, -1.02], rot: [0.25, 0, 0] }));
  // dash + steering column
  parts.push(part(new RoundedBoxGeometry(0.3, 0.16, 0.36, 2, 0.06), dark, { pos: [0, 0.63, 0.36], rot: [-0.5, 0, 0] }));
  parts.push(part(new THREE.CylinderGeometry(0.045, 0.06, 0.3, 10), dark, { pos: [0, 0.72, 0.21], rot: [0.5, 0, 0] }));
  // tinted screen
  parts.push(part(new RoundedBoxGeometry(0.34, 0.2, 0.03, 2, 0.012), '#0e2433', { pos: [0, 0.75, 0.5], rot: [-0.95, 0, 0] }));

  // rub rail following the gunwale all the way round the bow
  const railPts = [];
  const M = 26;
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    railPts.push(new THREE.Vector3(halfWidthAt(t) + 0.012, gunwaleAt(t), zAt(t)));
  }
  for (let i = M - 1; i >= 0; i--) {
    const t = i / M;
    railPts.push(new THREE.Vector3(-halfWidthAt(t) - 0.012, gunwaleAt(t), zAt(t)));
  }
  const railCurve = new THREE.CatmullRomCurve3(railPts, false, 'centripetal');
  parts.push(part(new THREE.TubeGeometry(railCurve, 72, 0.032, 6, false), rubber));

  // stern: grab handle, boarding pad, jet nozzle
  parts.push(part(new THREE.TorusGeometry(0.17, 0.022, 6, 12, Math.PI), metal, { pos: [0, 0.4, -1.36], rot: [-0.35, 0, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.8, 0.03, 0.34, 2, 0.012), rubber, { pos: [0, 0.262, -1.34] }));
  parts.push(part(new THREE.CylinderGeometry(0.085, 0.11, 0.24, 12), metal, { pos: [0, -0.08, -1.62], rot: [Math.PI / 2, 0, 0] }));
  // footwell mats
  for (const sx of [1, -1]) {
    parts.push(part(new RoundedBoxGeometry(0.2, 0.02, 0.9, 2, 0.008), rubber, { pos: [sx * 0.36, 0.262, -0.42] }));
  }
  return merge(parts);
}

function buildHandlebarGeometry() {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), '#3a3f47', { rot: [0, 0, Math.PI / 2] }));
  parts.push(part(new RoundedBoxGeometry(0.16, 0.07, 0.09, 2, 0.03), '#1d2026', { pos: [0, 0.0, 0.01] }));
  for (const sx of [1, -1]) {
    parts.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 8), '#0c0d10', { pos: [sx * 0.3, 0, 0], rot: [0, 0, Math.PI / 2] }));
  }
  return merge(parts);
}

/**
 * Build one craft. Returns a Group with:
 *   userData.handlebar  — Object3D to rotate around Y when steering
 *   userData.riderMount — Object3D where the rider is attached
 */
export function createWatercraft(team) {
  const group = new THREE.Group();
  group.name = `craft-${team.name}`;

  const paintMat = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05, envMapIntensity: 1.1 }));
  const trimMat = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.1 }));

  const hull = new THREE.Mesh(buildHullGeometry(team), paintMat);
  hull.name = 'hull';
  group.add(hull);

  const trim = new THREE.Mesh(buildTrimGeometry(), trimMat);
  trim.name = 'trim';
  group.add(trim);

  const handlebar = new THREE.Mesh(buildHandlebarGeometry(), trimMat);
  handlebar.name = 'handlebar';
  handlebar.position.copy(CRAFT.barPivot);
  group.add(handlebar);

  const riderMount = new THREE.Group();
  riderMount.name = 'riderMount';
  group.add(riderMount);

  group.userData.handlebar = handlebar;
  group.userData.riderMount = riderMount;
  group.userData.materials = [paintMat, trimMat];
  return group;
}
