// The body's meshes, cut from the skin.
//
// The skin (skin.js) is a function; this file samples it into triangles once
// at start-up. Three ideas:
//
//  - Sampling follows the control net: every span of the net gets as many
//    steps as its longest side needs to stay under the tier's edge length, so
//    the mesh is fine where rails were placed close together (creases) and
//    coarse on the roof. Normals are the surface's own, not the triangles',
//    which is why a coarse mesh still mirrors cleanly.
//  - One set of vertices, several index lists: the paint, the glass, the lamp
//    lenses and the dark shell behind them are the same skin drawn with
//    different materials; each draws only the triangles it can show in.
//  - The wheel arches are real openings: the triangles inside them are left
//    out (the shader trims the ragged edge to the exact outline), a lip turns
//    inwards from the edge, and a dark half drum stands behind.

import * as THREE from 'three';
import { ARCHES } from './features.js';

/** Edge length the mesh aims for, per tier (m). */
export const MESH_EDGE = { low: 0.085, medium: 0.055, high: 0.036 };

/**
 * Where to sample one parameter of the skin: the steps within each span of the control net, and the atlas
 * coordinate each control line gets (spans share the texture by their size on the car).
 * @param {number[]} lengths the size of each span on the car (m)
 * @param {number} edge target edge length
 * @param {number[]} [weights] what share of the atlas a metre of each span is worth (default 1)
 */
function layout(lengths, edge, weights) {
  const steps = lengths.map((l) => Math.max(1, Math.min(10, Math.ceil(l / edge))));
  const share = lengths.map((l, i) => Math.max(l, 0.012) * (weights ? weights[i] : 1));
  const total = share.reduce((a, b) => a + b, 0);
  const atlas = [0];
  for (const s of share) atlas.push(atlas[atlas.length - 1] + s / total);
  atlas[atlas.length - 1] = 1;
  const params = []; // parameter (0..1 over the whole net) of every sample
  const coords = []; // atlas coordinate of every sample
  const spans = lengths.length;
  for (let i = 0; i < spans; i++) {
    for (let j = 0; j < steps[i]; j++) {
      const t = j / steps[i];
      params.push((i + t) / spans);
      coords.push(atlas[i] + (atlas[i + 1] - atlas[i]) * t);
    }
  }
  params.push(1);
  coords.push(1);
  return { params, coords, atlas };
}

/**
 * How the skin's (u, v) is laid out in the atlas, and where it is sampled for a mesh of a given fineness.
 * The atlas part depends on the net alone, so every tier addresses the same texture the same way.
 * @param {import('./skin.js').Skin} skin
 * @param {number} edge
 */
export function createLayout(skin, edge) {
  const net = skin.net;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const along = [];
  for (let i = 0; i < skin.nu - 1; i++) {
    let longest = 0;
    for (let k = 0; k < skin.nv; k++) longest = Math.max(longest, dist(net[i][k], net[i + 1][k]));
    along.push(longest);
  }
  const round = [];
  for (let k = 0; k < skin.nv - 1; k++) {
    let longest = 0;
    for (let i = 0; i < skin.nu; i++) longest = Math.max(longest, dist(net[i][k], net[i][k + 1]));
    round.push(longest);
  }
  // nothing is drawn on the floor: it gets a sliver of the atlas
  const weights = round.map((_, k) => (k < 3 ? 0.15 : 1));
  const u = layout(along, edge);
  const v = layout(round, edge, weights);
  /** Atlas coordinate -> parameter, for one axis. */
  const inverse = (atlas) => (coord) => {
    const spans = atlas.length - 1;
    let i = 0;
    while (i < spans - 1 && atlas[i + 1] < coord) i++;
    return (i + (coord - atlas[i]) / (atlas[i + 1] - atlas[i])) / spans;
  };
  return { u, v, toU: inverse(u.atlas), toV: inverse(v.atlas) };
}

/** Is a point of the left half inside the hole a wheel arch cuts through the body? `grow` enlarges the hole (m). */
export function inArch(x, y, z, grow = 0) {
  for (const arch of [ARCHES.front, ARCHES.rear]) {
    if (x < arch.inner - grow) continue;
    const dz = Math.abs(z - arch.z);
    const a = arch.a + grow;
    if (dz >= a) continue;
    if (y <= arch.y) return true;
    const dy = (y - arch.y) / (arch.b + grow);
    if ((dz / a) ** 2 + dy * dy < 1) return true;
  }
  return false;
}

/**
 * Samples the skin: the vertices of the left half followed by their mirror images.
 * @param {import('./skin.js').Skin} skin
 * @param {ReturnType<typeof createLayout>} lay
 * @returns {{ position: Float32Array, normal: Float32Array, uv: Float32Array, columns: number, rows: number }}
 */
export function sampleSkin(skin, lay) {
  const columns = lay.u.params.length;
  const rows = lay.v.params.length;
  const half = columns * rows;
  const position = new Float32Array(half * 2 * 3);
  const normal = new Float32Array(half * 2 * 3);
  const uv = new Float32Array(half * 2 * 2);
  const f = new Float64Array(6);
  for (let i = 0; i < columns; i++) {
    for (let k = 0; k < rows; k++) {
      skin.surface(lay.u.params[i], lay.v.params[k], f);
      const a = (i * rows + k) * 3;
      const b = a + half * 3;
      // exactly on the centre plane where the two halves meet
      const x = i === 0 || i === columns - 1 || k === 0 || k === rows - 1 ? 0 : f[0];
      position[a] = x;
      position[a + 1] = position[b + 1] = f[1];
      position[a + 2] = position[b + 2] = f[2];
      position[b] = -x;
      normal[a] = f[3];
      normal[a + 1] = normal[b + 1] = f[4];
      normal[a + 2] = normal[b + 2] = f[5];
      normal[b] = -f[3];
      const t = (i * rows + k) * 2;
      uv[t] = uv[t + half * 2] = lay.u.coords[i];
      uv[t + 1] = uv[t + half * 2 + 1] = lay.v.coords[k];
    }
  }
  return { position, normal, uv, columns, rows };
}

/**
 * Triangles of the sampled skin, both halves. `keep(i, k)` says whether the quad between columns i, i+1 and rows
 * k, k+1 belongs (default: all of them).
 * @returns {Uint32Array}
 */
export function skinIndex(samples, keep = () => true) {
  const { columns, rows } = samples;
  const half = columns * rows;
  const index = [];
  for (let i = 0; i < columns - 1; i++) {
    for (let k = 0; k < rows - 1; k++) {
      if (!keep(i, k)) continue;
      const a = i * rows + k;
      const b = a + rows;
      // left half: u runs back and v up, and the outside is to the left
      index.push(a, b, a + 1, b, b + 1, a + 1);
      // right half: the mirror image turns the other way
      index.push(a + half, a + 1 + half, b + half, b + half, a + 1 + half, b + 1 + half);
    }
  }
  return new Uint32Array(index);
}

/** A geometry over the sampled skin's shared vertices with its own triangles. */
export function skinGeometry(attributes, index) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', attributes.position);
  geometry.setAttribute('normal', attributes.normal);
  geometry.setAttribute('uv', attributes.uv);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  // the car is always in view or nearly so: one fixed box, and no sphere worked out from the vertices
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1.05, 0, -2.6), new THREE.Vector3(1.05, 1.5, 2.35));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.75, -0.13), 2.7);
  return geometry;
}

/**
 * What stands in the wheel arches, for both sides: the lip that turns in from the edge of each opening (painted)
 * and the dark half drum behind it (the liner), with its inner wall.
 * @param {import('./skin.js').Skin} skin
 * @returns {{ lip: THREE.BufferGeometry, liner: THREE.BufferGeometry }}
 */
export function createArchGeometry(skin) {
  const lip = { position: [], normal: [], index: [] };
  const liner = { position: [], normal: [], index: [] };
  const quad = (mesh, a, b, c, d) => mesh.index.push(a, b, c, a, c, d);
  const push = (mesh, x, y, z, nx, ny, nz) => {
    mesh.position.push(x, y, z);
    mesh.normal.push(nx, ny, nz);
    return mesh.position.length / 3 - 1;
  };
  const SEGMENTS = 40;
  const LIP_DEPTH = 0.03;
  for (const arch of [ARCHES.front, ARCHES.rear]) {
    // the opening's outline, from its front foot over the top to its rear foot: [z, y, radial z, radial y]
    const outline = [];
    const foot = arch.y - arch.drop;
    outline.push([arch.z + arch.a, foot, 1, 0]);
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = (s / SEGMENTS) * Math.PI;
      const nz = Math.cos(t) / arch.a;
      const ny = Math.sin(t) / arch.b;
      const l = Math.hypot(nz, ny);
      outline.push([arch.z + arch.a * Math.cos(t), arch.y + arch.b * Math.sin(t), nz / l, ny / l]);
    }
    outline.push([arch.z - arch.a, foot, -1, 0]);
    for (const side of [1, -1]) {
      // the right side is the left one mirrored: the same strip, wound the other way
      const flip = side < 0;
      const add = (mesh, a, b, c, d) => (flip ? quad(mesh, a, d, c, b) : quad(mesh, a, b, c, d));
      let prev = null;
      outline.forEach(([z, y, rz, ry]) => {
        const x = skin.sideX(z, y);
        // the lip: from the skin's edge straight in; it faces the wheel
        const l0 = push(lip, side * (x + 0.002), y, z, 0, -ry, -rz);
        const l1 = push(lip, side * (x - LIP_DEPTH), y, z, 0, -ry, -rz);
        // the liner: a drum a little wider than the opening, from behind the lip to the inner wall
        const g = 0.012;
        const d0 = push(liner, side * (x - LIP_DEPTH + 0.004), y + ry * g, z + rz * g, 0, -ry, -rz);
        const d1 = push(liner, side * arch.inner, y + ry * g, z + rz * g, 0, -ry, -rz);
        // the inner wall, as a fan to the axle's height
        const w0 = push(liner, side * arch.inner, y + ry * g, z + rz * g, side, 0, 0);
        const w1 = push(liner, side * arch.inner, foot, arch.z, side, 0, 0);
        if (prev) {
          add(lip, prev.l0, l0, l1, prev.l1);
          add(liner, prev.d0, d0, d1, prev.d1);
          add(liner, prev.w0, w0, w1, prev.w1);
        }
        prev = { l0, l1, d0, d1, w0, w1 };
      });
    }
  }
  const build = (mesh) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normal, 3));
    geometry.setIndex(mesh.index);
    return geometry;
  };
  return { lip: build(lip), liner: build(liner) };
}
