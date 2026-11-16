// What lies on the water to be driven at: pads that give a push, cells of
// nitro that are used the moment they are picked up, and ramps.

import * as THREE from 'three';
import { withSkyFog } from './sky.js';

/** A ramp: how wide, how long, and how high its lip stands above the water. */
export const RAMP = { width: 9, length: 13, height: 2.5, foot: -0.35 };
/** A pad: how wide and how long. */
export const PAD = { width: 7.5, length: 11 };

/** A strip of chevrons pointing up the texture, light on clear. */
function chevronTexture(colour, back = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  if (back) {
    c.fillStyle = back;
    c.fillRect(0, 0, 128, 256);
  }
  c.strokeStyle = colour;
  c.lineWidth = 15;
  c.lineJoin = 'miter';
  for (let k = -1; k < 5; k++) {
    const y = 256 - k * 64;
    c.beginPath();
    c.moveTo(10, y);
    c.lineTo(64, y - 40);
    c.lineTo(118, y);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

let shared = null;
function assets() {
  if (shared) return shared;
  const padMap = chevronTexture('#fff3a8');
  const rampMap = chevronTexture('#ffd23a', '#1b2230');
  shared = {
    padMap,
    rampMap,
    // a mat of light lying on the water
    pad: withSkyFog(new THREE.MeshStandardMaterial({ map: padMap, color: '#ffb52e', emissive: '#ffb52e', emissiveMap: padMap, emissiveIntensity: 1.7, roughness: 0.7, transparent: true, depthWrite: false, side: THREE.DoubleSide })),
    padFrame: withSkyFog(new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#ff6a00', emissiveIntensity: 0.6, roughness: 0.5 })),
    cell: withSkyFog(new THREE.MeshStandardMaterial({ color: '#0b3a4a', emissive: '#28e0ff', emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.2 })),
    core: withSkyFog(new THREE.MeshStandardMaterial({ color: '#eaffff', emissive: '#c8ffff', emissiveIntensity: 3, roughness: 0.3 })),
    ramp: withSkyFog(new THREE.MeshStandardMaterial({ map: rampMap, emissive: '#ffffff', emissiveMap: rampMap, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.1 })),
    hull: withSkyFog(new THREE.MeshStandardMaterial({ color: '#f2f4f6', roughness: 0.6 })),
    skirt: withSkyFog(new THREE.MeshStandardMaterial({ color: '#f2f4f6', roughness: 0.6, side: THREE.DoubleSide })),
  };
  return shared;
}

/** Once per frame: the chevrons run. */
export function animateBoosts(time) {
  if (!shared) return;
  shared.padMap.offset.y = -time * 1.6;
  shared.rampMap.offset.y = -time * 0.9;
}

/** A boost pad: a mat of running chevrons between two floats. Its length runs along +z. */
export function createBoostPad() {
  const a = assets();
  const group = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(PAD.width, PAD.length, 1, 1).rotateX(-Math.PI / 2), a.pad);
  mat.geometry.attributes.uv.array.forEach((v, i, uv) => {
    if (i % 2) uv[i] = v * 3; // three chevrons along its length
  });
  mat.position.y = 0.12;
  mat.renderOrder = 3;
  group.add(mat);
  for (const side of [1, -1]) {
    const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, PAD.length - 0.8, 3, 8).rotateX(Math.PI / 2), a.padFrame);
    rail.position.set(side * (PAD.width / 2 + 0.2), 0.05, 0);
    group.add(rail);
  }
  group.name = 'boost-pad';
  return group;
}

/** A nitro cell: a glowing ring on a float, with a bright core that turns. `userData.core` is the part to spin. */
export function createBoostCell() {
  const a = assets();
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.2, 8, 28), a.cell);
  ring.position.y = 2.1;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), a.core);
  core.position.y = 2.1;
  core.scale.set(0.75, 1.25, 0.75);
  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 14), a.hull);
  float.position.y = 0.1;
  group.add(ring, core, float);
  group.userData.core = core;
  group.userData.ring = ring;
  group.name = 'boost-cell';
  return group;
}

/**
 * A ramp: a wedge on pontoons. It rises along +z from its foot (at z = 0) to its lip (at z = RAMP.length).
 * `rampHeightAt(u, v)` below is the same shape, for the boats.
 */
export function createRamp() {
  const a = assets();
  const { width: W, length: L, height: H, foot } = RAMP;
  const w = W / 2;
  const g = new THREE.BufferGeometry();
  // the sloping top, with the chevrons running up it
  const top = [-w, foot, 0, w, foot, 0, w, H, L, -w, H, L];
  g.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 3, 0, 3], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, a.ramp));
  // its sides and back, and a pontoon under each edge
  const side = new THREE.BufferGeometry();
  const p = [];
  for (const s of [1, -1]) {
    const x = s * w;
    // a triangle from the foot to the lip, down to the water
    p.push(x, foot, 0, x, H, L, x, -0.9, L, x, foot, 0, x, -0.9, L, x, -0.9, 0);
  }
  p.push(-w, H, L, w, H, L, w, -0.9, L, -w, H, L, w, -0.9, L, -w, -0.9, L);
  side.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  side.computeVertexNormals();
  group.add(new THREE.Mesh(side, a.skirt));
  for (const s of [1, -1]) {
    const pontoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, L - 1, 3, 10).rotateX(Math.PI / 2), a.padFrame);
    pontoon.position.set(s * (w + 0.5), -0.1, L / 2);
    group.add(pontoon);
  }
  group.name = 'ramp';
  return group;
}

/**
 * Height of a ramp's surface at a point in its own frame (u metres from its foot toward its lip, v metres across),
 * or -Infinity off it.
 */
export function rampHeightAt(u, v) {
  if (u < 0 || u > RAMP.length || Math.abs(v) > RAMP.width / 2) return -Infinity;
  return RAMP.foot + (RAMP.height - RAMP.foot) * (u / RAMP.length);
}
