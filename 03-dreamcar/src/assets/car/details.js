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
import { GRILLE_HALF, INTAKE_SIDE } from './features.js';
import { buildLampUnits } from './lampUnits.js';
import { LAMP_FN } from './materials.js';
import { MIRROR, Tris, V, bar, createSkinCaster, frame, roundRect, surfaceHit } from './parts.js';
import { createPlateTextures } from './plate.js';
import { LAMPS, VIEWPOINTS } from './spec.js';

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
  // the daylight photographs (front, and the two from ahead and to the right) show a taller, deeper shell than
  // the sheet's 0.135 x 0.11: 0.16 high and 0.13 deep; its width stays the published one (2.033 over the mirrors)
  const c = V(0.923, 1.05, 0.41);
  const half = V(0.093, 0.08, 0.065);
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
  const pane = new THREE.ShapeGeometry(new THREE.Shape(roundRect(0.085, 0.064, 0.022, 32)));
  glass.add(pane, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(c.x, c.y, c.z - half.z * 0.85 - 0.001));
  // the arm: a tapered block from the shoulder to the housing's lower inner part
  const from = V(0.835, 0.968, 0.56);
  const to = V(0.88, 1.0, 0.42);
  const arm = new THREE.BoxGeometry(0.028, 0.035, from.distanceTo(to) + 0.02);
  const look = new THREE.Matrix4().lookAt(to, from, V(0, 1, 0));
  look.setPosition(from.clone().add(to).multiplyScalar(0.5));
  matte.add(arm, look);
}

/**
 * A rounded block: a sphere squared off (exponent `e`: 1 a ball, towards 0 a box), half sizes hx, hy, hz, leaning
 * back by `tilt` about x.
 */
function blob(t, hx, hy, hz, x, y, z, tilt = 0, e = 0.45, fn = 0) {
  const g = new THREE.SphereGeometry(1, 12, 8);
  const P = g.attributes.position;
  const sq = (v) => Math.sign(v) * Math.abs(v) ** e;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, sq(P.getX(i)) * hx, sq(P.getY(i)) * hy, sq(P.getZ(i)) * hz);
  g.computeVertexNormals();
  t.add(g, new THREE.Matrix4().makeRotationX(tilt).setPosition(x, y, z), fn);
}

/** The same rounded block, placed by a matrix. */
function blobAt(t, hx, hy, hz, matrix, e = 0.45) {
  const g = new THREE.SphereGeometry(1, 16, 10);
  const P = g.attributes.position;
  const sq = (v) => Math.sign(v) * Math.abs(v) ** e;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, sq(P.getX(i)) * hx, sq(P.getY(i)) * hy, sq(P.getZ(i)) * hz);
  g.computeVertexNormals();
  t.add(g, matrix);
}

/**
 * The cabin as it shows through the glass (8): black leather and plastic in rounded shapes. Seats with their head
 * restraints, the rear bench, the dash with its cowl and its two displays, the console, the door cards, the
 * steering wheel, the mirror on the screen, the parcel shelf.
 */
function cabin(dark, emit) {
  for (const s of [1, -1]) {
    const x = s * 0.37;
    blob(dark, 0.25, 0.075, 0.26, x, 0.49, -0.2, 0.06); // cushion
    blob(dark, 0.245, 0.33, 0.075, x, 0.85, -0.56, -0.3); // back, leaning back
    blob(dark, 0.06, 0.3, 0.07, x + 0.21, 0.83, -0.52, -0.3, 0.7); // its side bolsters
    blob(dark, 0.06, 0.3, 0.07, x - 0.21, 0.83, -0.52, -0.3, 0.7);
    blob(dark, 0.125, 0.095, 0.05, x, 1.15, -0.67, -0.15, 0.6); // head restraint, top at 1.24
    blob(dark, 0.035, 0.24, 1.05, s * 0.725, 0.74, -0.45, 0, 0.3); // door cards under the belt line
    blob(dark, 0.05, 0.035, 0.3, s * 0.69, 0.78, -0.15, 0, 0.6); // armrests
    blob(dark, 0.05, 0.035, 0.26, s * 0.69, 0.78, -1.1, 0, 0.6);
  }
  blob(dark, 0.66, 0.075, 0.25, 0, 0.45, -1.0, 0.05); // rear bench
  blob(dark, 0.66, 0.29, 0.075, 0, 0.78, -1.35, -0.32);
  for (const x of [-0.36, 0, 0.36]) blob(dark, 0.11, 0.075, 0.045, x, 1.1, -1.27, -0.3, 0.6); // tops at 1.17
  blob(dark, 0.63, 0.012, 0.18, 0, 1.03, -1.73, 0, 0.3); // parcel shelf
  blob(dark, 0.76, 0.11, 0.27, 0, 0.86, 0.6, 0.12, 0.5); // dash, its top at 0.98
  blob(dark, 0.2, 0.05, 0.1, 0.37, 0.985, 0.47, 0.1, 0.6); // the cowl over the driver's display
  blob(dark, 0.125, 0.13, 0.5, 0, 0.5, -0.1, 0, 0.4); // centre console
  blob(dark, 0.125, 0.03, 0.02, 0, 1.3, 0.22, 0, 0.6); // interior mirror
  // steering wheel, facing the driver: rim, hub and three spokes
  const column = new THREE.Matrix4().makeRotationX(-0.42).setPosition(VIEWPOINTS.eye.x, 0.93, 0.3);
  dark.add(new THREE.TorusGeometry(0.185, 0.017, 8, 32), column);
  dark.add(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 16), column.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    dark.add(new THREE.BoxGeometry(0.13, 0.035, 0.02), column.clone().multiply(new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(0.12, 0, 0))));
  }
  dark.add(new THREE.BoxGeometry(0.05, 0.05, 0.3), new THREE.Matrix4().makeRotationX(-0.4).setPosition(VIEWPOINTS.eye.x, 0.86, 0.45));
  // the two displays: dark glass that glows at night
  const screen = (w, h, x, y, z, tilt) => emit.add(new THREE.BoxGeometry(w, h, 0.01), new THREE.Matrix4().makeRotationX(tilt).setPosition(x, y, z), LAMP_FN.screen);
  screen(0.31, 0.11, 0.37, 0.99, 0.42, -0.1);
  screen(0.18, 0.27, 0, 0.84, 0.36, -0.52);
}

/** One of the grille's small stars (5.1): three arms 12 mm across rising to a point 3 mm proud, six facets. */
function pin(t, matrix, out) {
  const apex = V(0, 0, 0.003).applyMatrix4(matrix);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const r = i % 2 ? 0.0019 : 0.0062;
    pts.push(V(Math.cos(a) * r, Math.sin(a) * r, 0).applyMatrix4(matrix));
  }
  for (let i = 0; i < 6; i++) t.tri(apex, pts[i], pts[(i + 1) % 6], out);
}

/** Is (x, y) inside a closed polygon of [x, y, ...] points? */
function insidePolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Every detail, merged by material.
 * @param {object} samples the sampled skin (body.js sampleSkin)
 * @param {{ tier: string, plate: string, skin: object, lay: object }} options the skin and the layout it was sampled with
 * @returns {{ geometries: Record<string, THREE.BufferGeometry>, plate: { map: THREE.Texture, normalMap: THREE.Texture } | null, stats: object }}
 */
export function buildDetails(samples, { tier, plate, skin, lay }) {
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
  // painted like the body, but not part of its skin: the door handles' grips
  const body = new Tris();
  const hit = (o, d) => surfaceHit(samples, o, d);
  // exact rays at the skin of the left half, by part of the car
  const castNose = createSkinCaster(skin, lay, samples, (x, y, z) => z > 1.55 && y > 0.15 && y < 0.9);
  const castTail = createSkinCaster(skin, lay, samples, (x, y, z) => z < -1.85 && y > 0.6 && y < 1.0 && x > 0.25);
  const castScreen = createSkinCaster(skin, lay, samples, (x, y, z) => z > 0.45 && z < 1.05 && y > 0.9);
  const castDoor = createSkinCaster(skin, lay, samples, (x, y, z) => z > -1.5 && z < 0.2 && y > 0.7 && y < 1.0 && x > 0.6);

  // ---- the lamp units behind their lenses
  buildLampUnits(emit, { head: castNose, tail: castTail });

  // ---- the grille's field of small stars (5.1), as real points of bright metal: they catch the light one by one
  if (!low) {
    const outline = [...GRILLE_HALF, ...GRILLE_HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    const lean = V(0, -0.087, 1).normalize();
    const left = new Tris();
    for (let r = 0; r < 11; r++) {
      const y = 0.475 + r * 0.022;
      for (let k = 0; k <= 16; k++) {
        const x = k * 0.034 + (r % 2) * 0.017;
        const m = 0.009;
        if (![[m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dy]) => insidePolygon(outline, x + dx, y + dy))) continue;
        // none on the big star's disc, none against the louvre
        if (Math.hypot(x, y - 0.573) < 0.108 || (Math.abs(y - 0.578) < 0.019 && x > 0.1 && x < 0.5)) continue;
        const at = castNose(V(x, y, 3), V(0, 0, -1)).point.addScaledVector(lean, 0.0005);
        pin(x === 0 ? chrome : left, frame(at, lean), lean);
      }
    }
    chrome.addMirrored(left);
  }

  // ---- the front apron's intakes (5.3): two slats and the air curtain's blade each side, one slat in the middle
  {
    const left = { matte: new Tris(), gloss: new Tris() };
    const skinZ = (x, y) => castNose(V(x, y, 3), V(0, 0, -1)).point.z;
    const slat = (y, x0, x1, back, to) => {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const x = x0 + ((x1 - x0) * i) / 6;
        pts.push(V(x, y, skinZ(x, y) - back));
      }
      // a blade 12 mm high leaning back, 35 mm deep
      bar(to, pts, V(0, 0.25, 1).normalize(), 0.006, 0.035, 0);
    };
    const [ui, li] = INTAKE_SIDE;
    const innerX = (y) => ui[0] + ((li[0] - ui[0]) * (ui[1] - y)) / (ui[1] - li[1]);
    for (const y of [0.3, 0.368]) slat(y, innerX(y) - 0.015, 0.79, 0.028, left.matte);
    slat(0.29, 0.0, 0.415, 0.022, left.matte);
    // the air curtain: an upright gloss black blade against the outer edge, standing clear of the slot behind it
    const blade = [0.236, 0.3, 0.36, 0.424].map((y) => V(0.775, y, skinZ(0.775, y) - 0.012));
    bar(left.gloss, blade, V(0.35, 0, 1).normalize(), 0.0125, 0.03, 0);
    matte.addMirrored(left.matte);
    gloss.addMirrored(left.gloss);
  }

  // ---- door handles (2.8): a painted grip standing off its recess, a bright insert along its lower half
  {
    const left = { body: new Tris(), chrome: new Tris() };
    for (const [z, y] of [[-0.147, 0.857], [-1.18, 0.867]]) {
      const h = castDoor(V(1.5, y, z), V(-1, 0, 0));
      const m = new THREE.Matrix4().setPosition(h.point.x + 0.006, y, z);
      blobAt(left.body, 0.013, 0.0145, 0.1175, m, 0.5);
      blobAt(left.chrome, 0.0125, 0.0036, 0.104, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.0012, -0.0068, 0)), 0.5);
    }
    body.addMirrored(left.body);
    chrome.addMirrored(left.chrome);
  }

  // ---- the wipers, parked along the foot of the windscreen: a blade and its arm each side
  {
    const left = new Tris();
    const footZ = (x) => 0.84 + (0.713 - 0.84) * (x / 0.695) ** 2;
    const on = (x, dz) => {
      const h = castScreen(V(x, 2, footZ(x) - dz), V(0, -1, 0));
      return { point: h.point.addScaledVector(h.normal, 0.014), normal: h.normal };
    };
    const pts = [];
    let normal = V(0, 1, 0);
    for (let i = 0; i <= 6; i++) {
      const x = 0.07 + (0.55 * i) / 6;
      const h = on(x, 0.05 + 0.012 * Math.sin((i / 6) * Math.PI));
      pts.push(h.point);
      normal = h.normal;
    }
    bar(left, pts, normal, 0.006, 0.012, 0);
    // the arm: from the middle of the blade down to its pivot under the bonnet's edge
    const from = pts[3].clone().addScaledVector(normal, 0.006);
    const to = V(0.52, from.y - 0.055, footZ(0.52) + 0.05);
    bar(left, [from, from.clone().lerp(to, 0.5), to], normal, 0.007, 0.008, 0);
    matte.addMirrored(left);
  }

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

  // ---- number plates (5.3, 6.3): front leaning back 6 degrees under the grille, rear upright in its recess; each
  // on a black frame that shows a centimetre all round
  const plateTex = createPlateTextures(plate);
  if (plateTex) {
    const face = (matrix, fw, fh) => {
      plates.add(new THREE.PlaneGeometry(0.52, 0.114), matrix);
      matte.add(new THREE.BoxGeometry(fw, fh, 0.008), matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.0055)));
    };
    const lean = V(0, Math.sin((6 * Math.PI) / 180), Math.cos((6 * Math.PI) / 180));
    const fp = hit(V(0, 0.392, 3), V(0, 0, -1));
    face(frame(fp.point.clone().addScaledVector(lean, 0.012), lean), 0.53, 0.125);
    const rp = hit(V(0, 0.771, -3.5), V(0, 0, 1));
    face(frame(rp.point.clone().add(V(0, 0, -0.012)), V(0, 0, -1)), 0.54, 0.135);
  }

  const geometries = low ? { chrome, gloss, matte, body, emit, plates } : { chrome, gloss, matte, body, glass, emit, dark, plates };
  const out = {};
  let triangles = 0;
  for (const [name, tris] of Object.entries(geometries)) {
    if (!tris.count) continue;
    out[name] = tris.geometry();
    triangles += tris.count;
  }
  return { geometries: out, plate: plateTex, stats: { triangles } };
}
