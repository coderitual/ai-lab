// PLACEHOLDER BORE. A plain arched tube along each tunnel and a flat face at
// each portal, closing the opening the terrain leaves there, so that the
// tunnel reads as a dark hole in the hillside and the sky does not show
// through the ground over it. The tunnel stage replaces it with the real
// shell, portals and lamps; delete the file then.

import * as THREE from 'three';

/** The bore: walls up to SPRING metres above the road, then an arch to the ceiling (TUNNEL.height). */
const SPRING = 3.4;
const CROWN = 5.6;
/** How far the face reaches beyond the walls, and above the road (m). */
const FACE_WIDE = 9;
const FACE_TOP = 9;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createPlaceholderBore({ track, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'bore';
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const at = (s, lat, h, out) => {
    track.frameAt(s, frame);
    return out.copy(frame.pos).addScaledVector(frame.left, lat).addScaledVector(frame.up, h);
  };
  // the cross-section, from the left wall's foot over the arch to the right wall's foot
  const outline = (edge) => {
    const pts = [[edge, -0.3]];
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI;
      pts.push([edge * Math.cos(a), SPRING + (CROWN - SPRING) * Math.sin(a)]);
    }
    pts.push([-edge, -0.3]);
    return pts;
  };
  const shell = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, side: THREE.DoubleSide }));
  const face = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.9, side: THREE.DoubleSide }));
  const p = new THREE.Vector3();
  const geometries = [];

  for (const t of track.tunnels) {
    const edge = track.edgeAt((t.s0 + t.s1) / 2, 1);
    const pts = outline(edge);
    // the tube
    const rows = Math.ceil((t.s1 - t.s0) / 2) + 1;
    const pos = [];
    const index = [];
    for (let r = 0; r < rows; r++) {
      const s = t.s0 + ((t.s1 - t.s0) * r) / (rows - 1);
      for (const [lat, h] of pts) pos.push(...at(s, lat, h, p).toArray());
      if (r < rows - 1) {
        for (let k = 0; k < pts.length - 1; k++) {
          const a = r * pts.length + k;
          const b = a + pts.length;
          index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    geometries.push([tube(pos, index), shell]);
    // the faces at the portals: a ring from the arch out to a rectangle
    for (const s of [t.s0, t.s1]) {
      const fpos = [];
      const findex = [];
      const cy = 2.5;
      for (const [lat, h] of pts) {
        const dx = lat;
        const dy = h - cy;
        const w = edge + FACE_WIDE;
        let k = Infinity;
        if (dx > 1e-6) k = Math.min(k, w / dx);
        if (dx < -1e-6) k = Math.min(k, -w / dx);
        if (dy > 1e-6) k = Math.min(k, (FACE_TOP - cy) / dy);
        if (dy < -1e-6) k = Math.min(k, (-3 - cy) / dy);
        fpos.push(...at(s, lat, h, p).toArray(), ...at(s, dx * k, cy + dy * k, p).toArray());
      }
      for (let k = 0; k < pts.length - 1; k++) {
        const a = k * 2;
        findex.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      geometries.push([tube(fpos, findex), face]);
    }
  }

  function tube(pos, index) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }

  for (const [geometry, material] of geometries) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const [geometry] of geometries) geometry.dispose();
      shell.dispose();
      face.dispose();
    },
  };
}
