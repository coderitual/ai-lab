// The lamp units behind their lenses, as built things.
//
// A lamp reads as a lamp because its parts stand at different depths behind a
// clear cover: seen from a metre and a half they move against each other, hide
// each other, and each catches the light its own way. So they are geometry:
// a housing let into the body behind the lens's outline, and in it the light
// guides, the modules in their bezels, the rows of blades. Every part is one
// of the lamp-part material's functions (materials.js, LAMP_FN), which gives
// it its colour unlit and its light when its function is switched on; all of
// both lamps of both sides is part of one mesh.
//
// The parts are placed by rays at the skin itself (parts.js, createSkinCaster),
// so they follow the lens at a set depth whatever the mesh's fineness.

import * as THREE from 'three';
import { HEAD_LENS, TAIL_LENS } from './features.js';
import { LAMP_FN } from './materials.js';
import { Tris, V, bar, frame, ring, roundRect } from './parts.js';

/** A closed Catmull-Rom curve through 3D points, `per` points to a span. */
function loop(points, per) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i + n - 1) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    for (let s = 0; s < per; s++) out.push(catmull(p0, p1, p2, p3, s / per));
  }
  return out;
}
function catmull(p0, p1, p2, p3, t) {
  const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  return V(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/**
 * The head lamp (5.2), left side: a gloss black housing behind the lens's outline; the eyebrow light guide with
 * its hook just under the lens, a satin strip under it; the auxiliary reflector, the projection module (a glass
 * dome in a square bezel), the matrix module and the blue accent, in a row 45 mm in.
 * @param {Tris} t
 * @param {(origin: THREE.Vector3, dir: THREE.Vector3) => { point: THREE.Vector3, normal: THREE.Vector3 }} cast
 */
function headLamp(t, cast) {
  const FN = LAMP_FN;
  const v0 = V(0.6, 0.2, 0.77).normalize();
  const onSkin = (p, d = v0) => cast(p.clone().addScaledVector(d, 0.25), d.clone().negate());
  const rim = loop(
    HEAD_LENS.map((p) => {
      const h = onSkin(V(p[0], p[1], p[2]));
      return h.point.addScaledVector(h.normal, -0.003);
    }),
    3,
  );
  // the lamp's own axis: square to its outline as a whole
  const axis = V(0, 0, 0);
  const centre = V(0, 0, 0);
  rim.forEach((a, i) => {
    const b = rim[(i + 1) % rim.length];
    axis.x += (a.y - b.y) * (a.z + b.z);
    axis.y += (a.z - b.z) * (a.x + b.x);
    axis.z += (a.x - b.x) * (a.y + b.y);
    centre.add(a);
  });
  axis.normalize();
  if (axis.dot(v0) < 0) axis.negate();
  centre.multiplyScalar(1 / rim.length);
  const lens = (p) => onSkin(p, axis).point;
  const deep = (p, depth) => lens(p).addScaledVector(axis, -depth);

  // ---- the housing: walls from the outline in to a flat back 62 mm behind the middle of the lens
  const backCentre = deep(centre, 0.062);
  const back = rim.map((p) => {
    const r = p.clone().sub(centre);
    return backCentre.clone().add(r.addScaledVector(axis, -r.dot(axis)).multiplyScalar(0.86));
  });
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    t.quad(rim[i], rim[j], back[j], back[i], centre.clone().sub(rim[i]), FN.headHousing);
    t.tri(backCentre, back[i], back[j], axis, FN.headHousing);
  }

  // ---- the eyebrow: from the hook's foot up the inner edge, then along under the upper edge to the outer end
  const hook = V(0.515, 0.655, 2.09);
  const inner = V(0.535, 0.7, 2.045);
  const outer = V(0.8, 0.74, 1.735);
  const path = [hook, hook.clone().lerp(inner, 0.5), inner];
  for (let i = 1; i <= 8; i++) path.push(inner.clone().lerp(outer, i / 8));
  const brow = path.map((p) => deep(p, 0.009));
  bar(t, brow, axis, 0.0058, 0.006, FN.brow);
  // a satin strip under it, deeper in: it catches the sky as a second, fainter line
  const under = path.slice(2).map((p) => deep(p.clone().add(V(0, -0.02, 0)), 0.024));
  bar(t, under, axis, 0.0035, 0.008, FN.bezel);
  // and one along the lower edge of the housing
  const low = [9, 10, 11, 12].map((k) => V(HEAD_LENS[k][0], HEAD_LENS[k][1], HEAD_LENS[k][2]).lerp(centre, 0.28));
  bar(t, low.map((p) => deep(p, 0.034)), axis, 0.004, 0.008, FN.bezel);

  // ---- the modules, 45 mm behind the lens
  const at = (x, y, z, depth = 0.045) => frame(deep(V(x, y, z), depth), axis);
  // projection module: a dome of dark glass in a square satin bezel
  const projector = at(0.615, 0.663, 1.975);
  ring(t, projector, roundRect(0.041, 0.041, 0.01, 24), roundRect(0.0335, 0.0335, 0.03, 24), 0.03, 0.014, FN.bezel);
  const dome = new THREE.SphereGeometry(0.0325, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  // the sphere's pole is +y: turn it to the lamp's axis and flatten it
  t.add(dome, projector.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.012)).multiply(new THREE.Matrix4().makeScale(1, 1, 0.55))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), FN.projector);
  // matrix module: a flat lens over rows of emitters, in its bezel
  const matrix = at(0.715, 0.672, 1.862);
  ring(t, matrix, roundRect(0.044, 0.032, 0.008, 24), roundRect(0.036, 0.024, 0.006, 24), 0.012, 0.014, FN.bezel);
  t.add(new THREE.PlaneGeometry(0.072, 0.048), matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.008)), FN.matrix);
  // the small auxiliary reflector inboard, the blue accent outboard
  const aux = at(0.555, 0.668, 2.04, 0.04);
  ring(t, aux, roundRect(0.019, 0.024, 0.012, 16), roundRect(0.013, 0.018, 0.011, 16), 0.012, 0.01, FN.bezel);
  t.add(new THREE.PlaneGeometry(0.026, 0.036), aux.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.011)), FN.headHousing);
  t.add(new THREE.BoxGeometry(0.045, 0.03, 0.006), at(0.78, 0.69, 1.77, 0.03), FN.accent);
}

/** The tail lamp's edges from behind (x -> y): the upper nearly straight, the lower one diagonal to its lowest point. */
const tailUp = (x) => 0.866 + 0.044 * Math.min(1, Math.max(0, (x - 0.37) / 0.39));
const tailLow = (x) => (x < 0.66 ? 0.852 - (0.1 * (x - 0.37)) / 0.29 : 0.752 + (0.126 * (x - 0.66)) / 0.182);

/**
 * The tail lamp (6.2), left side: a dark red mirror of a housing, a trough from the lens's two edges in to its
 * middle line; the smooth light guide (brake, and the indicator in the outer piece) 14 mm in; two rows of slanted
 * blades 8 mm in (tail); the reversing lamp's clear window by the inner tip.
 */
function tailLamp(t, cast) {
  const FN = LAMP_FN;
  const xs = TAIL_LENS.slice(0, 11).map((p) => p[0]);
  const zs = TAIL_LENS.slice(0, 11).map((p) => p[2]);
  const zOf = (x) => {
    let i = 0;
    while (i < xs.length - 2 && xs[i + 1] < x) i++;
    return zs[i] + ((zs[i + 1] - zs[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
  };
  /** The point of the lens over (x, y) of the rear view, `depth` behind it, and the skin's normal there. */
  const at = (x, y, depth) => {
    const s = THREE.MathUtils.smoothstep(x, 0.55, 0.85);
    const d = V(0.25 + 0.75 * s, 0.1, -(1 - 0.6 * s)).normalize();
    const h = cast(V(x, y, zOf(x)).addScaledVector(d, 0.25), d.negate());
    return { point: h.point.addScaledVector(h.normal, -depth), normal: h.normal };
  };
  // ---- the housing
  const steps = 24;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const x = 0.362 + ((0.846 - 0.362) * i) / steps;
    const [up, low] = [tailUp(x), tailLow(x)];
    const now = { top: at(x, up + 0.008, 0.003).point, mid: at(x, (up + low) / 2, 0.027), bottom: at(x, low - 0.008, 0.003).point };
    if (prev) {
      t.quad(prev.top, now.top, now.mid.point, prev.mid.point, now.mid.normal, FN.tailHousing);
      t.quad(prev.mid.point, now.mid.point, now.bottom, prev.bottom, now.mid.normal, FN.tailHousing);
    }
    prev = now;
  }
  // ---- the light guide: wide in the outer piece, a slim strip through the inner one
  const guideSteps = 30;
  prev = null;
  for (let i = 0; i <= guideSteps; i++) {
    const x = 0.39 + ((0.826 - 0.39) * i) / guideSteps;
    const [up, low] = [tailUp(x), tailLow(x)];
    const outer = THREE.MathUtils.smoothstep(x, 0.54, 0.6);
    const c = THREE.MathUtils.lerp(up - 0.034, 0.5 * (up + low), outer);
    const hh = THREE.MathUtils.lerp(0.0035, THREE.MathUtils.lerp(0.013, 0.005, Math.min(1, Math.max(0, (x - 0.6) / 0.22))), outer);
    const now = { x, top: at(x, c + hh, 0.014), bottom: at(x, c - hh, 0.014) };
    if (prev) {
      const mid = (prev.x + x) / 2;
      // the boot lid's cut crosses the lamp between its two pieces
      if (mid < 0.562 || mid > 0.598) t.quad(prev.bottom.point, now.bottom.point, now.top.point, prev.top.point, now.top.normal, mid < 0.58 ? FN.guide : FN.guideOuter);
    }
    prev = now;
  }
  // ---- the blades: 22 x 5 mm, leaning 35 degrees, 37 mm apart; each two facets meeting in a ridge
  const lean = (35 * Math.PI) / 180;
  const blade = (x, y, sign) => {
    const c = at(x, y, 0.008);
    const along = at(x + 0.012, y, 0.008).point.sub(c.point).normalize();
    const up = new THREE.Vector3().crossVectors(c.normal, along).normalize();
    if (up.y < 0) up.negate();
    const dir = up.multiplyScalar(Math.cos(lean)).addScaledVector(along, Math.sin(lean) * sign);
    const end = (s) => c.point.clone().addScaledVector(dir, 0.011 * s);
    const ridge = (s) => end(s).addScaledVector(c.normal, 0.0022);
    for (const w of [1, -1]) {
      const edge = (s) => end(s).addScaledVector(along, 0.003 * w);
      t.quad(edge(-1), edge(1), ridge(1), ridge(-1), c.normal.clone().addScaledVector(along, w), FN.blade);
    }
  };
  for (let k = 0; k < 10; k++) blade(0.452 + 0.037 * k, tailUp(0.452 + 0.037 * k) - 0.016, 1);
  for (let k = 0; k < 7; k++) blade(0.553 + 0.037 * k, tailLow(0.553 + 0.037 * k) + 0.015, -1);
  // ---- the reversing lamp's window
  const corner = (x, y) => at(x, y, 0.011);
  const [a, b, c, d] = [corner(0.385, 0.852), corner(0.43, 0.852), corner(0.43, 0.873), corner(0.385, 0.873)];
  t.quad(a.point, b.point, c.point, d.point, a.normal, FN.reverse);
}

/**
 * Both lamps of both sides, into `target` (the lamp-part mesh's triangles).
 * @param {Tris} target
 * @param {{ head: Function, tail: Function }} casts rays at the skin round the left head lamp and the left tail lamp
 */
export function buildLampUnits(target, casts) {
  const left = new Tris();
  headLamp(left, casts.head);
  tailLamp(left, casts.tail);
  target.addMirrored(left);
}
