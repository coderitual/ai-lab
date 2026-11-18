// Static geometry for the circuit's dressing, merged by place: every box,
// panel and tyre stack is written straight into the buffers of the patch of
// map it stands on (a square of CELL metres), and each patch becomes one mesh
// of the one dressing material (signs.js). A chase view sees a few patches;
// the rest are culled whole.
//
// Faces carry texture coordinates into the atlas: a rectangle mapped across
// the face (a board, a door, tyres), or a single point (a swatch: the face is
// one flat colour).

import * as THREE from 'three';

/**
 * Side of the square patches the dressing is merged by (m). (finish lane) The same 400 m as the pieces the rails,
 * kerbs and lamps are cut into (world/index.js): at 160 m a chase view drew ten to twenty patches of dressing, each
 * a draw call, for a few thousand triangles more culled.
 */
const CELL = 400;

const V = new THREE.Vector3();
const N = new THREE.Vector3();
const NM = new THREE.Matrix3();

/** The unit box's faces: outward normal, then four corners (x, y, z in -0.5..0.5) counter-clockwise seen from outside. */
const FACES = {
  px: [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
  nx: [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  py: [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
  ny: [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
  pz: [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
  nz: [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
};
const FACE_NAMES = Object.keys(FACES);

/** A matrix that puts the unit box (centred) between points a and b, `w` wide and `h` high across that line. */
export function beam(a, b, w, h = w, out = new THREE.Matrix4()) {
  const len = a.distanceTo(b);
  const z = V.subVectors(b, a).normalize().clone();
  const ref = Math.abs(z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  out.makeBasis(x.multiplyScalar(w), y.multiplyScalar(h), z.multiplyScalar(len));
  out.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return out;
}

export function createBuilder() {
  const cells = new Map();
  let triangles = 0;
  const cellOf = (x, z) => {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let c = cells.get(key);
    if (!c) {
      c = { pos: [], nor: [], uv: [], index: [] };
      cells.set(key, c);
    }
    return c;
  };

  /**
   * One quad of four points (counter-clockwise seen from its front) with a uv rectangle [u0, v0, u1, v1] mapped
   * from its first corner (u0, v0) to its third (u1, v1); a swatch is a rectangle of no size.
   */
  function quad(p, uv, normal, cell) {
    const c = cell ?? cellOf((p[0].x + p[2].x) / 2, (p[0].z + p[2].z) / 2);
    const base = c.pos.length / 3;
    const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    if (!normal) normal = N.subVectors(p[1], p[0]).cross(V.subVectors(p[3], p[0])).normalize();
    for (let k = 0; k < 4; k++) {
      c.pos.push(p[k].x, p[k].y, p[k].z);
      c.nor.push(normal.x, normal.y, normal.z);
      c.uv.push(uvs[k][0], uvs[k][1]);
    }
    c.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    triangles += 2;
  }

  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const NN = new THREE.Vector3();
  /**
   * The unit box (centred) under a matrix. `uv` is one rectangle for every face, or an object by face name
   * (px nx py ny pz nz, and `rest` for the others); `skip` lists faces left out (hidden ones).
   */
  function box(matrix, uv, { skip = [] } = {}) {
    const centre = V.setFromMatrixPosition(matrix);
    const cell = cellOf(centre.x, centre.z);
    NM.getNormalMatrix(matrix);
    for (const name of FACE_NAMES) {
      if (skip.includes(name)) continue;
      const faceUv = Array.isArray(uv) ? uv : uv[name] ?? uv.rest;
      const [n, corners] = FACES[name];
      for (let k = 0; k < 4; k++) P[k].set(corners[k][0], corners[k][1], corners[k][2]).applyMatrix4(matrix);
      NN.set(n[0], n[1], n[2]).applyMatrix3(NM).normalize();
      quad(P, faceUv, NN, cell);
    }
  }

  /**
   * A prism of `sides` round an upright axis through `base` (bottom centre), radius r, height h: its sides, and its
   * top unless `top` is false. Only the arc from a0 to a1 (rad, about +Y from +X) if given (a hood, a tyre's front).
   * The side's uv rectangle runs once round the arc (u) and up (v).
   */
  function prism(base, r, h, sides, uv, { a0 = 0, a1 = Math.PI * 2, top = true, topUv = uv, axis = null, inside = false } = {}) {
    const cell = cellOf(base.x, base.z);
    // a frame: by default upright; `axis` = { x, y, z } unit vectors (columns) for a tilted prism
    const ax = axis ?? { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const at = (a, y, out) =>
      out.copy(base).addScaledVector(ax.x, Math.cos(a) * r).addScaledVector(ax.z, -Math.sin(a) * r).addScaledVector(ax.y, y);
    for (let k = 0; k < sides; k++) {
      const a = a0 + ((a1 - a0) * k) / sides;
      const b = a0 + ((a1 - a0) * (k + 1)) / sides;
      at(a, 0, P[0]);
      at(b, 0, P[1]);
      at(b, h, P[2]);
      at(a, h, P[3]);
      const m = (a + b) / 2;
      NN.copy(ax.x).multiplyScalar(Math.cos(m)).addScaledVector(ax.z, -Math.sin(m));
      const u0 = uv[0] + ((uv[2] - uv[0]) * k) / sides;
      const u1 = uv[0] + ((uv[2] - uv[0]) * (k + 1)) / sides;
      quad(P, [u0, uv[1], u1, uv[3]], NN, cell);
      if (inside) quad([P[1], P[0], P[3], P[2]], [u0, uv[1], u1, uv[3]], NN.clone().negate(), cell);
      if (top) {
        // a fan of the top as thin quads to the axis
        at(a, h, P[0]);
        at(b, h, P[1]);
        P[2].copy(base).addScaledVector(ax.y, h);
        P[3].copy(P[2]);
        quad([P[0], P[1], P[2], P[3]], topUv, ax.y, cell);
      }
    }
  }

  return {
    quad,
    box,
    prism,
    get triangles() {
      return triangles;
    },
    /** The patches as meshes of `material`, added to `group`. */
    build(material, group, { shadow = true, name = 'dressing' } = {}) {
      let k = 0;
      for (const c of cells.values()) {
        if (!c.index.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
        g.setIndex(c.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(c.index, 1) : new THREE.Uint16BufferAttribute(c.index, 1));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.name = `${name}-${k++}`;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return k;
    },
  };
}
