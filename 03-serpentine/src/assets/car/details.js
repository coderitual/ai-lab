// The small solid things on and in the car: the stars, the grille's louvre,
// the tail-pipe trims and the diffuser's fins, the door mirrors, the number
// plates, the third brake light and the plate lamps, and the cabin seen
// through the glass.
//
// Two ideas:
//  - Each part is placed on the skin where the modelling sheet says it is, by
//    casting a ray at the sampled skin (`surfaceHit`): the parts follow the
//    body if the body changes.
//  - Everything is merged by material: one geometry per material, so the
//    whole set costs seven draw calls however many parts there are. Lamp-like
//    parts carry a per-vertex function number (`lampFn`) that the emitter
//    material turns into light (materials.js, LAMP_FN).

import * as THREE from 'three';
import { LAMPS, VIEWPOINTS } from './spec.js';
import { LAMP_FN } from './materials.js';

// ---- finding the skin

/**
 * Where a ray meets the sampled skin: the vertices within `radius` of the ray, nearest along it, give a plane
 * (their mean point and normal) which the ray then cuts. Good to a millimetre or two on the smooth panels.
 * @returns {{ point: THREE.Vector3, normal: THREE.Vector3 }}
 */
export function surfaceHit(samples, origin, dir, radius = 0.05) {
  const P = samples.position;
  const N = samples.normal;
  const count = P.length / 3;
  const d = dir.clone().normalize();
  let best = Infinity;
  const near = [];
  for (let j = 0; j < count; j++) {
    const x = P[j * 3] - origin.x;
    const y = P[j * 3 + 1] - origin.y;
    const z = P[j * 3 + 2] - origin.z;
    const t = x * d.x + y * d.y + z * d.z;
    if (t <= 0) continue;
    const ox = x - d.x * t;
    const oy = y - d.y * t;
    const oz = z - d.z * t;
    const off = ox * ox + oy * oy + oz * oz;
    // only skin that faces the ray
    if (off > radius * radius || N[j * 3] * d.x + N[j * 3 + 1] * d.y + N[j * 3 + 2] * d.z > -0.1) continue;
    near.push([t, j, off]);
    best = Math.min(best, t);
  }
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let weight = 0;
  for (const [t, j, off] of near) {
    if (t > best + radius) continue; // the first surface only, not the far side of the car
    const w = 1 / (off + 1e-5);
    point.x += P[j * 3] * w;
    point.y += P[j * 3 + 1] * w;
    point.z += P[j * 3 + 2] * w;
    normal.x += N[j * 3] * w;
    normal.y += N[j * 3 + 1] * w;
    normal.z += N[j * 3 + 2] * w;
    weight += w;
  }
  if (!weight) return { point: origin.clone(), normal: d.clone().negate() };
  point.multiplyScalar(1 / weight);
  normal.normalize();
  const t = point.clone().sub(origin).dot(normal) / d.dot(normal);
  return { point: origin.clone().addScaledVector(d, t), normal };
}

// ---- building triangles

/** A growing list of triangles with flat or given normals and an optional per-vertex number. */
class Tris {
  constructor() {
    this.p = [];
    this.n = [];
    this.f = [];
    this.uv = [];
  }
  /** One flat triangle; turned to face `out` if given. */
  tri(a, b, c, out = null, fn = 0) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (out && n.dot(out) < 0) {
      [b, c] = [c, b];
      n.negate();
    }
    for (const v of [a, b, c]) {
      this.p.push(v.x, v.y, v.z);
      this.n.push(n.x, n.y, n.z);
      this.f.push(fn);
      this.uv.push(0, 0);
    }
  }
  quad(a, b, c, d, out = null, fn = 0) {
    this.tri(a, b, c, out, fn);
    this.tri(a, c, d, out, fn);
  }
  /** A three.js geometry, transformed by `matrix`, its triangles added (normals smooth as it has them). */
  add(geometry, matrix, fn = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const P = g.attributes.position.array;
    const N = g.attributes.normal.array;
    const U = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < P.length / 3; i++) {
      this.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      this.n.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      this.f.push(fn);
      this.uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0);
    }
    geometry.dispose();
    if (g !== geometry) g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('lampFn', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  get count() {
    return this.p.length / 9;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A frame on the surface: z along `normal`, y as near `up` as it can be. */
function frame(origin, normal, up = V(0, 1, 0)) {
  const z = normal.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

/** Left and right: the matrix that mirrors car space across x = 0. */
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * The three-pointed star in its ring, in a local frame (face in +z, one arm up): a ring with a rounded crown, and
 * three arms each two facets meeting in a ridge, tapering to a point at the ring.
 */
function star(t, matrix, { radius, ring, depth, arm, segments }) {
  const m = (v) => v.applyMatrix4(matrix);
  const inner = radius - ring;
  const mid = radius - ring / 2;
  // ring: inner wall, two halves of the crown, outer wall; smooth round, crisp at the crown's ridge
  const at = (r, z, a) => V(r * Math.cos(a), r * Math.sin(a), z);
  const strips = [
    [[inner, depth * 0.35], [inner, depth * 0.8]],
    [[inner, depth * 0.8], [mid, depth]],
    [[mid, depth], [radius, depth * 0.75]],
    [[radius, depth * 0.75], [radius, 0]],
  ];
  for (const [[r0, z0], [r1, z1]] of strips) {
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      // a quad with smooth normals round the ring: the strip's own slope, turned with the angle
      const slope = V(z0 - z1, 0, r1 - r0).normalize(); // in (radial, -, z) terms
      const nrm = (a) => V(slope.x * Math.cos(a), slope.x * Math.sin(a), slope.z);
      const pts = [at(r0, z0, a0), at(r1, z1, a0), at(r1, z1, a1), at(r0, z0, a1)].map(m);
      const ns = [nrm(a0), nrm(a0), nrm(a1), nrm(a1)].map((n) => n.transformDirection(matrix));
      for (const k of [0, 1, 2, 0, 2, 3]) {
        t.p.push(pts[k].x, pts[k].y, pts[k].z);
        t.n.push(ns[k].x, ns[k].y, ns[k].z);
        t.f.push(0);
        t.uv.push(0, 0);
      }
    }
  }
  const out = V(0, 0, 1).transformDirection(matrix);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const d = V(Math.cos(a), Math.sin(a), 0);
    const p = V(-d.y, d.x, 0);
    const A = p.clone().multiplyScalar(arm / 2).setZ(depth * 0.4);
    const B = p.clone().multiplyScalar(-arm / 2).setZ(depth * 0.4);
    const C = V(0, 0, depth * 1.25);
    const T = d.clone().multiplyScalar(inner + ring * 0.2).setZ(depth * 0.8);
    const A0 = A.clone().setZ(0);
    const B0 = B.clone().setZ(0);
    const T0 = T.clone().setZ(0);
    t.tri(m(A.clone()), m(T.clone()), m(C.clone()), out);
    t.tri(m(C.clone()), m(T.clone()), m(B.clone()), out);
    const side = p.clone().transformDirection(matrix);
    t.quad(m(A0.clone()), m(T0.clone()), m(T.clone()), m(A.clone()), side);
    t.quad(m(B0.clone()), m(B.clone()), m(T.clone()), m(T0.clone()), side.clone().negate());
  }
}

/** A rounded rectangle's outline (half sizes hx, hy, corner r), `n` points anticlockwise. */
function roundRect(hx, hy, r, n, slant = 0) {
  const shape = new THREE.Shape();
  // slant: the lower right corner moved this far right (the trims' outer end leans)
  const c = [V(-hx, -hy, 0), V(hx + slant, -hy, 0), V(hx, hy, 0), V(-hx, hy, 0)];
  const corner = (i) => {
    const p = c[i];
    const a = c[(i + 3) % 4];
    const b = c[(i + 1) % 4];
    const pa = a.clone().sub(p).normalize().multiplyScalar(r).add(p);
    const pb = b.clone().sub(p).normalize().multiplyScalar(r).add(p);
    return [pa, p, pb];
  };
  const k0 = corner(0);
  shape.moveTo(k0[2].x, k0[2].y);
  for (let i = 1; i <= 4; i++) {
    const [pa, p, pb] = corner(i % 4);
    shape.lineTo(pa.x, pa.y);
    shape.quadraticCurveTo(p.x, p.y, pb.x, pb.y);
  }
  return shape.getSpacedPoints(n).slice(0, n);
}

/** A tail-pipe trim (6.4): a bright frame round a flattened hexagon, matte black inside; `wall`: how far its sides run back into the bumper. */
function pipeTrim(bright, black, matrix, wall) {
  const n = 48;
  const outer = roundRect(0.12, 0.035, 0.014, n, 0.025);
  const inner = roundRect(0.11, 0.025, 0.008, n, 0.02);
  const m = (p, z) => V(p.x, p.y, z).applyMatrix4(matrix);
  const back = V(0, 0, -1).transformDirection(matrix);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // the frame's face, its rolled outer edge going back into the bumper, and the bright lip just inside
    const face = V(0, 0, 1).transformDirection(matrix);
    bright.quad(m(outer[i], 0.004), m(outer[j], 0.004), m(inner[j], 0.004), m(inner[i], 0.004), face);
    const ro = V(outer[i].x, outer[i].y, 0).normalize().transformDirection(matrix);
    bright.quad(m(outer[i], 0.004), m(outer[j], 0.004), m(outer[j], -wall), m(outer[i], -wall), ro);
    const ri = ro.clone().negate();
    bright.quad(m(inner[i], 0.004), m(inner[j], 0.004), m(inner[j], -0.012), m(inner[i], -0.012), ri);
    black.quad(m(inner[i], -0.012), m(inner[j], -0.012), m(inner[j], -wall - 0.05), m(inner[i], -wall - 0.05), ri);
    black.tri(m(inner[i], -wall - 0.05), m(inner[j], -wall - 0.05), m(V(0, 0, 0), -wall - 0.05), back.clone().negate());
  }
}

/**
 * The door mirror (2.8), left: gloss black housing (a rounded box, its cap bulging forward, wider at the top outer
 * corner), the glass facing back, and the black arm to the door's shoulder.
 */
function mirror(gloss, matte, glass, segments) {
  const housing = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.66));
  const P = housing.attributes.position;
  const N = housing.attributes.normal;
  const c = V(0.923, 1.043, 0.405);
  const half = V(0.093, 0.0675, 0.055);
  const e = 0.45; // squareness: below 1 squares the sphere off
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i);
    let y = P.getY(i);
    let z = P.getZ(i);
    const sq = (v) => Math.sign(v) * Math.abs(v) ** e;
    x = sq(x);
    y = sq(y);
    z = sq(z);
    // wider at the top outer corner, the cap bulging forward, the back nearly flat
    const hx = half.x * (1 + 0.12 * y * Math.max(x, 0));
    const hz = z > 0 ? half.z * 1.15 : half.z * 0.85;
    P.setXYZ(i, c.x + x * hx, c.y + y * half.y, c.z + z * hz);
  }
  housing.computeVertexNormals();
  N.needsUpdate = true;
  gloss.add(housing, new THREE.Matrix4());
  // the glass, a millimetre behind the housing's flat back
  const pane = new THREE.ShapeGeometry(new THREE.Shape(roundRect(0.085, 0.0525, 0.02, 32)));
  glass.add(pane, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(c.x, c.y, c.z - half.z * 0.85 - 0.001));
  // the arm: a tapered block from the shoulder to the housing's lower inner part
  const from = V(0.835, 0.968, 0.56);
  const to = V(0.88, 1.0, 0.42);
  const arm = new THREE.BoxGeometry(0.028, 0.035, from.distanceTo(to) + 0.02);
  const look = new THREE.Matrix4().lookAt(to, from, V(0, 1, 0));
  look.setPosition(from.clone().add(to).multiplyScalar(0.5));
  matte.add(arm, look);
}

/** The cabin as far as it shows through the glass (8): black, simple blocks. */
function cabin(dark, emit) {
  const box = (w, h, d, x, y, z, tilt = 0, fn = 0, target = dark) => {
    const m = new THREE.Matrix4().makeRotationX(tilt).setPosition(x, y, z);
    target.add(new THREE.BoxGeometry(w, h, d), m, fn);
  };
  for (const s of [1, -1]) {
    const x = s * 0.37;
    box(0.5, 0.12, 0.5, x, 0.5, -0.25); // cushion
    box(0.5, 0.62, 0.12, x, 0.84, -0.58, -0.3); // back, leaning back
    box(0.26, 0.19, 0.1, x, 1.145, -0.66, -0.15); // head restraint, top at 1.24
    box(0.06, 0.08, 0.6, s * 0.7, 0.75, -0.2); // door card's armrest
    box(0.06, 0.08, 0.5, s * 0.7, 0.75, -1.15);
  }
  box(1.3, 0.12, 0.5, 0, 0.45, -1.0); // rear bench
  box(1.3, 0.55, 0.12, 0, 0.78, -1.35, -0.32);
  for (const x of [-0.36, 0, 0.36]) box(0.22, 0.14, 0.08, x, 1.1, -1.27, -0.3); // tops at 1.17
  box(1.25, 0.02, 0.35, 0, 1.03, -1.73); // parcel shelf
  box(1.5, 0.2, 0.5, 0, 0.86, 0.6, 0.12); // dash, its top at 0.98
  box(0.24, 0.25, 0.95, 0, 0.5, -0.1); // centre console
  box(0.25, 0.06, 0.03, 0, 1.3, 0.22, 0, 0, dark); // interior mirror
  // steering wheel, facing the driver
  const wheel = new THREE.TorusGeometry(0.185, 0.017, 6, 28);
  dark.add(wheel, new THREE.Matrix4().makeRotationX(-0.42).setPosition(VIEWPOINTS.eye.x, 0.93, 0.3));
  dark.add(new THREE.BoxGeometry(0.05, 0.05, 0.3), new THREE.Matrix4().makeRotationX(-0.4).setPosition(VIEWPOINTS.eye.x, 0.86, 0.45));
  // the two displays: dark glass that glows at night
  box(0.31, 0.11, 0.01, 0.37, 0.99, 0.42, -0.1, LAMP_FN.screen, emit);
  box(0.18, 0.27, 0.01, 0, 0.84, 0.36, -0.52, LAMP_FN.screen, emit);
}

/**
 * The number plates' picture: white EU plates with the blue band and its ring of stars, black condensed
 * characters, a thin black border; front above, rear below. Drawn with the browser's canvas and its system
 * fonts (no font files). Also a normal map that raises the characters and the border a little.
 */
function plateTextures(text) {
  const W = 1024;
  const H = 512;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const ph = Math.round((W * 114) / 520); // 224
  for (const top of [0, 256]) {
    const y0 = top + 16;
    g.fillStyle = '#e8e8e4';
    g.fillRect(0, y0, W, ph);
    // band: 46 mm of the 520
    const band = Math.round((W * 46) / 520);
    g.fillStyle = '#123c9c';
    g.fillRect(4, y0 + 4, band, ph - 8);
    g.fillStyle = '#f2c500';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const cx = 4 + band / 2 + Math.cos(a) * band * 0.3;
      const cy = y0 + ph * 0.32 + Math.sin(a) * band * 0.3;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 2.2 : 5.5;
        const b = -Math.PI / 2 + (k * Math.PI) / 5;
        g.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r);
      }
      g.fill();
    }
    // border
    g.strokeStyle = '#111';
    g.lineWidth = 6;
    g.strokeRect(3, y0 + 3, W - 6, ph - 6);
    // characters: 80 mm high in a condensed sans, squeezed to fit
    g.fillStyle = '#111';
    const size = Math.round(ph * 0.98);
    g.font = `bold ${size}px "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans Condensed", "Helvetica Neue", sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const room = W - band - 48;
    const wide = g.measureText(text).width;
    const squeeze = Math.min(0.78, room / Math.max(wide, 1));
    g.save();
    g.translate(band + 4 + room / 2 + 20, y0 + ph * 0.54);
    g.scale(squeeze, 1);
    g.fillText(text, 0, 0);
    g.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // embossing: the slope of the darkness, at half size
  const img = g.getImageData(0, 0, W, H).data;
  const w = W / 2;
  const h = H / 2;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) height[y * w + x] = 1 - img[(y * 2 * W + x * 2) * 4 + 1] / 255;
  }
  const nd = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (xx, yy) => height[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.8;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.8;
      const l = Math.hypot(dx, dy, 1);
      const o = ((h - 1 - y) * w + x) * 4; // flipped: the canvas's rows run down, the texture's up
      nd[o] = Math.round((-dx / l) * 127.5 + 127.5);
      nd[o + 1] = Math.round((dy / l) * 127.5 + 127.5);
      nd[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      nd[o + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(nd, w, h, THREE.RGBAFormat);
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.needsUpdate = true;
  return { map, normalMap, rows: { front: [1 - (16 + ph) / H, 1 - 16 / H], rear: [1 - (272 + ph) / H, 1 - 272 / H] } };
}

/**
 * Every detail, merged by material.
 * @param {object} samples the sampled skin (body.js sampleSkin)
 * @param {{ tier: string, plate: string }} options
 * @returns {{ geometries: Record<string, THREE.BufferGeometry>, plate: { map: THREE.Texture, normalMap: THREE.Texture } | null, stats: object }}
 */
export function buildDetails(samples, { tier, plate }) {
  const fine = tier === 'high' ? 1 : tier === 'medium' ? 0.75 : 0.5;
  const chrome = new Tris();
  const gloss = new Tris();
  const matte = new Tris();
  // the low tier saves two draw calls: the mirror glass goes in with the bright metal, the cabin's blocks are left
  // out (only its glowing displays remain)
  const low = tier === 'low';
  const glass = low ? chrome : new Tris();
  const emit = new Tris();
  const dark = new Tris();
  const plates = new Tris();
  const hit = (o, d) => surfaceHit(samples, o, d);

  // ---- the stars (5.1, 5.3, 6.3)
  const grilleLean = V(0, -0.087, 1).normalize();
  const g = hit(V(0, 0.573, 3), V(0, 0, -1));
  star(chrome, frame(g.point.clone().addScaledVector(grilleLean, 0.003), grilleLean), {
    radius: 0.0925, ring: 0.013, depth: 0.008, arm: 0.03, segments: Math.round(64 * fine),
  });
  const b = hit(V(0, 0.936, -3.5), V(0, 0, 1));
  star(chrome, frame(b.point.clone().addScaledVector(b.normal, 0.001), b.normal), {
    radius: 0.045, ring: 0.0055, depth: 0.004, arm: 0.014, segments: Math.round(40 * fine),
  });
  // the nose badge: a flat disc on the 28-degree nose panel, gloss black inside a bright rim, the star on it
  const up28 = V(0, Math.cos((28 * Math.PI) / 180), Math.sin((28 * Math.PI) / 180));
  const n = hit(V(0, 0.783, 2.177).addScaledVector(up28, 0.4), up28.clone().negate());
  const badge = frame(n.point.clone().addScaledVector(n.normal, 0.001), n.normal);
  gloss.add(new THREE.CylinderGeometry(0.0255, 0.0285, 0.003, Math.round(32 * fine)), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(badge));
  star(chrome, badge.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0015)), {
    radius: 0.0285, ring: 0.003, depth: 0.0025, arm: 0.009, segments: Math.round(32 * fine),
  });

  // ---- the grille's single louvre, each side: 14 mm high at the star tapering to 5 mm, 20 mm deep, 6 mm proud
  for (const s of [1, -1]) {
    const steps = 10;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const x = 0.115 + ((0.48 - 0.115) * i) / steps;
      const h = hit(V(x, 0.578, 3), V(0, 0, -1));
      const hh = (0.014 + (0.005 - 0.014) * (i / steps)) / 2;
      pts.push({ x: s * x, z: h.point.z + 0.006, hh });
    }
    for (let i = 0; i < steps; i++) {
      const [p, q] = [pts[i], pts[i + 1]];
      const y = 0.578;
      const front = V(0, 0, 1);
      chrome.quad(V(p.x, y - p.hh, p.z), V(q.x, y - q.hh, q.z), V(q.x, y + q.hh, q.z), V(p.x, y + p.hh, p.z), front);
      chrome.quad(V(p.x, y + p.hh, p.z), V(q.x, y + q.hh, q.z), V(q.x, y + q.hh, q.z - 0.02), V(p.x, y + p.hh, p.z - 0.02), V(0, 1, 0));
      chrome.quad(V(p.x, y - p.hh, p.z), V(q.x, y - q.hh, q.z), V(q.x, y - q.hh, q.z - 0.02), V(p.x, y - p.hh, p.z - 0.02), V(0, -1, 0));
    }
  }

  // ---- rear: the tail-pipe trims, the diffuser's six fins (6.4)
  const trimNormal = V(0.385, 0, -0.923).normalize();
  // the frame's face stands just proud of the bumper everywhere along its edge (the bumper turns under here, so
  // a face placed at the skin's centre point would sink into it at the top)
  const centre = V(0.57, 0.31, hit(V(0.57, 0.31, -3.5), V(0, 0, 1)).point.z);
  const trimLeft = frame(centre, trimNormal);
  let proud = 0;
  for (const [u, v] of [[-0.12, 0.035], [0.12, 0.035], [-0.12, -0.035], [0.145, -0.035], [0, 0.035], [0, -0.035]]) {
    const corner = V(u, v, 0).applyMatrix4(trimLeft);
    proud = Math.max(proud, hit(corner.clone().setZ(-3.5), V(0, 0, 1)).point.sub(centre).dot(trimNormal));
  }
  trimLeft.setPosition(centre.addScaledVector(trimNormal, proud + 0.003));
  pipeTrim(chrome, matte, trimLeft, proud + 0.03);
  pipeTrim(chrome, matte, trimLeft.clone().premultiply(MIRROR), proud + 0.03);
  for (const x of [0.0525, 0.1575, 0.2625]) {
    for (const s of [1, -1]) {
      const z0 = hit(V(s * x, 0.345, -3.5), V(0, 0, 1)).point.z + 0.002;
      // a blade standing 16 mm off the insert, its back edge sloping: 60 mm high at the insert, 40 at its edge
      for (const dx of [-0.006, 0.006]) {
        const X = s * x + dx;
        matte.quad(V(X, 0.375, z0), V(X, 0.315, z0), V(X, 0.315, z0 - 0.016), V(X, 0.355, z0 - 0.016), V(Math.sign(dx), 0, 0));
      }
      const [x0, x1] = [s * x - 0.006, s * x + 0.006];
      matte.quad(V(x0, 0.375, z0), V(x1, 0.375, z0), V(x1, 0.355, z0 - 0.016), V(x0, 0.355, z0 - 0.016), V(0, 1, -1));
      matte.quad(V(x0, 0.355, z0 - 0.016), V(x1, 0.355, z0 - 0.016), V(x1, 0.315, z0 - 0.016), V(x0, 0.315, z0 - 0.016), V(0, 0, -1));
      matte.quad(V(x0, 0.315, z0), V(x1, 0.315, z0), V(x1, 0.315, z0 - 0.016), V(x0, 0.315, z0 - 0.016), V(0, -1, 0));
    }
  }

  // ---- the third brake light behind the top of the rear screen, and the plate lamps over the plate
  // (30 mm further down the glass than the sheet's place: there the screen's black band, 35 mm, would hide it)
  const tb = hit(V(0, 2, LAMPS.thirdBrake.z - 0.03), V(0, -1, 0));
  const tbFrame = frame(tb.point.clone().addScaledVector(tb.normal, -0.014), tb.normal, V(0, 0, -1).negate());
  emit.add(new THREE.BoxGeometry(0.32, 0.016, 0.006), tbFrame, LAMP_FN.thirdBrake);
  for (const s of [1, -1]) {
    const pl = hit(V(s * 0.1, LAMPS.plateRear.y, -3.5), V(0, 0, 1));
    const m = frame(pl.point.clone().addScaledVector(pl.normal, 0.002), V(0, -0.6, -1).normalize());
    emit.add(new THREE.BoxGeometry(0.03, 0.008, 0.004), m, LAMP_FN.plate);
  }

  // ---- mirrors, both sides
  const mirrorSegments = Math.round(20 * fine) + 4;
  for (const side of [1, -1]) {
    const gl = new Tris();
    const mt = new Tris();
    const gs = new Tris();
    mirror(gl, mt, gs, mirrorSegments);
    for (const [from, to] of [[gl, gloss], [mt, matte], [gs, glass]]) {
      const geo = from.geometry();
      if (side < 0) {
        geo.applyMatrix4(MIRROR);
        // mirroring turns the triangles inside out: swap two corners of each, in every attribute
        for (const attribute of Object.values(geo.attributes)) {
          const a = attribute.array;
          const k = attribute.itemSize;
          for (let i = 0; i < a.length; i += 3 * k) {
            for (let c = 0; c < k; c++) [a[i + k + c], a[i + 2 * k + c]] = [a[i + 2 * k + c], a[i + k + c]];
          }
        }
      }
      to.add(geo, new THREE.Matrix4());
    }
  }

  // ---- the cabin
  cabin(low ? new Tris() : dark, emit);

  // ---- number plates (5.3, 6.3): front leaning back 6 degrees under the grille, rear upright in its recess
  let plateTex = null;
  if (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined') {
    plateTex = plateTextures(plate);
    const face = (rows, matrix) => {
      const geo = new THREE.PlaneGeometry(0.52, 0.114);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, rows[0] + (rows[1] - rows[0]) * uv.getY(i));
      plates.add(geo, matrix);
    };
    const lean = V(0, Math.sin((6 * Math.PI) / 180), Math.cos((6 * Math.PI) / 180));
    const fp = hit(V(0, 0.392, 3), V(0, 0, -1));
    face(plateTex.rows.front, frame(fp.point.clone().addScaledVector(lean, 0.008), lean));
    const rp = hit(V(0, 0.771, -3.5), V(0, 0, 1));
    face(plateTex.rows.rear, frame(rp.point.clone().add(V(0, 0, -0.006)), V(0, 0, -1)));
  }

  const geometries = low ? { chrome, gloss, matte, emit, plates } : { chrome, gloss, matte, glass, emit, dark, plates };
  const out = {};
  let triangles = 0;
  for (const [name, tris] of Object.entries(geometries)) {
    if (!tris.count) continue;
    out[name] = tris.geometry();
    triangles += tris.count;
  }
  return { geometries: out, plate: plateTex, stats: { triangles } };
}
