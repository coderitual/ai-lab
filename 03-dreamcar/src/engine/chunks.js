// Cutting big meshes into pieces the camera can leave out.
//
// three.js culls a mesh by one sphere round all of it. A mesh that runs the
// whole length of a long, winding scene (a row of posts, a rail, a strip of
// ground glow) has a sphere that every camera intersects, so all of it is drawn
// in every pass, though most of it is behind the camera or kilometres away.
// `chunk` splits such meshes, after they are built, into pieces by a square
// grid on the ground (x, z of the mesh's own space): one child per cell, with
// its own sphere, sharing the parent's vertex buffers (plain meshes get an index
// of their own; instanced ones a copy of their cell's matrices and colours).
//
// The parent stays where it was, so whatever holds it (a list of things a
// mirror leaves out, `visible`) still works; it is taken off every layer, so it
// draws nothing itself, and its children carry its layers instead.
//
// Left alone: meshes that are not culled anyway (`frustumCulled` false), that
// draw something per camera (their own `onBeforeRender`), that have several
// materials, per-instance attributes in the geometry, or a morph; and meshes
// whose sphere is smaller than `minRadius`.

import * as THREE from 'three';

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const defaultBeforeRender = THREE.Object3D.prototype.onBeforeRender;

/** Can this mesh be cut up without changing what it draws? */
function cuttable(mesh, minRadius) {
  if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.frustumCulled === false) return false;
  if (mesh.userData.chunked || mesh.onBeforeRender !== defaultBeforeRender || Array.isArray(mesh.material)) return false;
  const g = mesh.geometry;
  if (!g || !g.attributes.position || Object.keys(g.morphAttributes).length) return false;
  if (Object.values(g.attributes).some((a) => a.isInstancedBufferAttribute || a.isInterleavedBufferAttribute)) return false;
  if (mesh.isInstancedMesh) {
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    return mesh.boundingSphere.radius > minRadius;
  }
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g.boundingSphere.radius > minRadius;
}

/** A child that draws like `mesh` (same material, layers, shadows, order). */
function dress(child, mesh, k) {
  child.name = `${mesh.name}#${k}`;
  child.castShadow = mesh.castShadow;
  child.receiveShadow = mesh.receiveShadow;
  child.renderOrder = mesh.renderOrder;
  child.layers.mask = mesh.layers.mask;
  child.customDepthMaterial = mesh.customDepthMaterial;
  child.customDistanceMaterial = mesh.customDistanceMaterial;
  child.matrixAutoUpdate = false;
  return child;
}

/** The instances of an InstancedMesh, by cell. */
function cutInstanced(mesh, cell) {
  const cells = new Map();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _m);
    _p.setFromMatrixPosition(_m);
    const key = `${Math.floor(_p.x / cell)},${Math.floor(_p.z / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  if (cells.size < 2) return [];
  const colour = new THREE.Color();
  return [...cells.values()].map((list, k) => {
    const child = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((i, j) => {
      mesh.getMatrixAt(i, _m);
      child.setMatrixAt(j, _m);
      if (mesh.instanceColor) child.setColorAt(j, mesh.getColorAt(i, colour));
    });
    child.computeBoundingSphere();
    return dress(child, mesh, k);
  });
}

/** The triangles of a plain mesh, by the cell of each one's first corner. */
function cutPlain(mesh, cell) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const vertices = pos.count;
  const index = g.index ? g.index.array : null;
  const start = Math.max(0, g.drawRange.start);
  const end = Math.min(index ? index.length : vertices, g.drawRange.start + g.drawRange.count);
  const cells = new Map();
  for (let t = start; t + 2 < end; t += 3) {
    const a = index ? index[t] : t;
    const key = `${Math.floor(pos.getX(a) / cell)},${Math.floor(pos.getZ(a) / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    const list = cells.get(key);
    list.push(a, index ? index[t + 1] : t + 1, index ? index[t + 2] : t + 2);
  }
  if (cells.size < 2) return [];
  return [...cells.values()].map((list, k) => {
    const piece = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(g.attributes)) piece.setAttribute(name, attribute);
    piece.setIndex(new THREE.BufferAttribute(vertices > 65535 ? new Uint32Array(list) : new Uint16Array(list), 1));
    // the sphere round this piece's own corners
    const box = new THREE.Box3();
    for (const v of list) box.expandByPoint(_p.fromBufferAttribute(pos, v));
    const sphere = new THREE.Sphere();
    box.getCenter(sphere.center);
    let r = 0;
    for (const v of list) r = Math.max(r, sphere.center.distanceToSquared(_p.fromBufferAttribute(pos, v)));
    sphere.radius = Math.sqrt(r);
    piece.boundingSphere = sphere;
    piece.boundingBox = box;
    return dress(new THREE.Mesh(piece, mesh.material), mesh, k);
  });
}

/**
 * Cut every big mesh under `root` into pieces of `cell` metres.
 * @param {THREE.Object3D} root
 * @param {{ cell?: number, minRadius?: number }} [options]
 * @returns {{ meshes: number, pieces: number }} how many meshes were cut, into how many pieces
 */
export function chunk(root, { cell = 300, minRadius = 350 } = {}) {
  const found = [];
  root.traverse((o) => {
    if (cuttable(o, minRadius)) found.push(o);
  });
  let pieces = 0;
  for (const mesh of found) {
    const children = mesh.isInstancedMesh ? cutInstanced(mesh, cell) : cutPlain(mesh, cell);
    if (!children.length) continue;
    mesh.userData.chunked = true;
    mesh.layers.disableAll();
    for (const c of children) {
      mesh.add(c);
      c.updateMatrixWorld(true);
    }
    pieces += children.length;
  }
  return { meshes: found.length, pieces };
}
