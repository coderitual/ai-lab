// The hull and what is bolted to it, as geometry.
//
// Each body is a cross-section swept from stern to bow (see lines.js). It is
// split into strips where the real thing has a hard edge (keel, chine, spray
// rail, gunwale) and kept as one smooth skin where it is rounded (decks, the
// centre body), because a glossy surface shows every crease. Painted surfaces
// take their texture coordinates from the sheet layout in lines.js; plain ones
// (the bottom, the tunnel) point at a white patch of it and are coloured by
// their vertices.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, lerp } from '../../engine/math.js';
import { fan, mapUv, merge, part, skin } from '../geo.js';
import { BOAT, CANOPY, NOSE, TIP_X, TUNNEL, UV_BLANK, V, bodyTopAt, canopyBase, canopyRadius, centreSection, chineAt, crownAt, deckEdgeAt, innerAt, mirror, outerAt, resample, sheerAt, sponsonSection, steps, tAt, uvPort, uvStbd, uvTop, uvTransom, zAt } from './lines.js';
import { FILLER, teamColors } from './livery.js';

const blank = () => UV_BLANK;

/** The painted hull: sponsons, centre body, transoms, scoop and fins, in one piece. */
export function buildHullGeometry(team) {
  const { hull: hullHex, accent: accentHex, third: thirdHex } = teamColors(team);
  const hull = new THREE.Color(hullHex);
  const accent = new THREE.Color(accentHex);
  const third = new THREE.Color(thirdHex);
  const belly = new THREE.Color('#f1efe8');
  const dark = new THREE.Color('#0f1216');
  const parts = [];

  // ---- the two sponsons
  const ts = steps(56);
  const sections = ts.map(sponsonSection);
  for (const side of [1, -1]) {
    const flip = side === -1;
    const strip = (name) => sections.map((s) => s[name].map((v) => (side === 1 ? v : mirror(v))));
    const plain = (name, colorAt) => parts.push(skin(strip(name), { uvAt: blank, colorAt, flip }));
    plain('fork', (i) => (ts[i] > 0.87 ? third : hull)); // inside of the bows, ahead of the nose
    plain('wall', () => dark); // tunnel wall
    plain('bottomIn', () => belly); // running surface, inboard of the keel
    plain('bottomOut', () => belly); // and outboard of it
    plain('boot', () => dark); // spray rail
    plain('gunwale', () => accent);
    parts.push(skin(strip('side'), { uvAt: side === 1 ? uvPort : uvStbd, flip }));
    parts.push(skin(strip('deck'), { uvAt: uvTop, flip }));
    // transom of the sponson
    const s = sections[0];
    const outline = [s.fork[0], ...s.wall.slice(1), s.bottomIn[1], s.bottomOut[1], s.boot[1], ...s.gunwale, ...s.deck.slice(1)];
    parts.push(mapUv(fan(outline.map((v) => (side === 1 ? v : mirror(v))), '#ffffff', { flip: side === 1 }), uvTransom(side)));
  }

  // ---- the centre body, one smooth skin from side to side
  const cts = steps(44, NOSE);
  const us = steps(30);
  const rows = cts.map((t) => resample(centreSection(t), us));
  parts.push(skin(rows, { uvAt: uvTop }));
  // the tunnel roof underneath
  parts.push(skin(cts.map((t) => [V(innerAt(t), TUNNEL, zAt(t)), V(-innerAt(t), TUNNEL, zAt(t))]), { uvAt: blank, colorAt: () => dark, flip: true }));
  // transom of the centre body
  const x0 = innerAt(0);
  parts.push(mapUv(fan([V(x0, TUNNEL, BOAT.sternZ), ...rows[0], V(-x0, TUNNEL, BOAT.sternZ)], '#ffffff', { flip: true }), uvTransom(0)));

  // ---- air scoop on the engine hatch: a low arch, open at the front
  {
    const zFront = zAt(0.275);
    const zBack = zAt(0.1);
    const arch = [];
    const R = 14;
    const C = 14;
    for (let i = 0; i <= R; i++) {
      const u = i / R; // back .. front
      const z = lerp(zBack, zFront, u);
      const t = tAt(z);
      const base = deckEdgeAt(t) + crownAt(t) - 0.012;
      const halfW = lerp(0.07, 0.2, Math.pow(u, 0.7));
      const high = lerp(0.015, 0.13, Math.pow(u, 0.8));
      const row = [];
      for (let j = 0; j <= C; j++) {
        const a = (j / C) * Math.PI;
        // a flattened arch with soft shoulders
        const cx = Math.cos(a);
        const sx = Math.sin(a);
        row.push(V(Math.sign(cx) * Math.pow(Math.abs(cx), 0.7) * halfW, base + Math.pow(sx, 0.7) * high, z));
      }
      arch.push(row);
    }
    parts.push(skin(arch, { uvAt: uvTop }));
    parts.push(mapUv(fan(arch[R], '#040506'), UV_BLANK)); // the mouth
  }

  // ---- fins on the tails of the sponsons, swept back and leaning out a little
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.4, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(-0.02, 0.44);
    shape.quadraticCurveTo(-0.2, 0.56, -0.52, 0.56);
    shape.lineTo(-0.4, 0);
    const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.009, bevelSegments: 3, curveSegments: 10 });
    fin.translate(0, 0, -0.011);
    for (const sx of [1, -1]) {
      parts.push(mapUv(part(fin, third, { pos: [sx * 1.0, sheerAt(0.09), zAt(0.09)], rot: [0, -Math.PI / 2, -sx * 0.2], order: 'ZYX' }), UV_BLANK));
    }
    fin.dispose();
  }
  return merge(parts);
}

/** The glass: a bubble over the cockpit. */
export function buildCanopyGeometry() {
  const base = canopyBase();
  const R = 30;
  const C = 22;
  const rows = [];
  for (let i = 0; i <= R; i++) {
    const u = i / R;
    const r = canopyRadius(u);
    const row = [];
    for (let j = 0; j <= C; j++) {
      const a = (j / C) * Math.PI;
      row.push(V(Math.cos(a) * CANOPY.halfWidth * r, base + Math.sin(a) * CANOPY.height * r, lerp(CANOPY.z0, CANOPY.z1, u)));
    }
    rows.push(row);
  }
  return skin(rows, { uvAt: blank });
}

/** What sits under the glass: a seat, a driver, a wheel. Seen dimly, but it is what makes the boat look manned. */
export function buildCockpitGeometry(team) {
  const { hull, accent } = teamColors(team);
  const suit = '#16181d';
  const parts = [];
  const floor = canopyBase() - 0.06;
  // seat with a headrest
  parts.push(part(new RoundedBoxGeometry(0.4, 0.42, 0.1, 1, 0.04), '#22252b', { pos: [0, floor + 0.2, -0.3], rot: [-0.24, 0, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.24, 0.15, 0.09, 1, 0.04), '#22252b', { pos: [0, floor + 0.37, -0.33], rot: [-0.1, 0, 0] }));
  // shoulders and helmet
  parts.push(part(new THREE.CapsuleGeometry(0.1, 0.24, 3, 8), suit, { pos: [0, floor + 0.17, -0.14], rot: [0, 0, Math.PI / 2] }));
  parts.push(part(new THREE.SphereGeometry(0.118, 16, 10), accent, { pos: [0, floor + 0.315, -0.1] }));
  // a band over the crown in the hull colour, and the visor
  parts.push(part(new THREE.SphereGeometry(0.121, 12, 4, 0, Math.PI * 2, 0, 0.62), hull, { pos: [0, floor + 0.315, -0.1], scale: [0.36, 1, 1] }));
  parts.push(part(new THREE.SphereGeometry(0.122, 10, 4, Math.PI / 2 - 0.95, 1.9, 1.12, 0.62), '#07090c', { pos: [0, floor + 0.315, -0.1] }));
  // arms to the wheel
  for (const sx of [1, -1]) {
    parts.push(part(new THREE.CapsuleGeometry(0.04, 0.34, 2, 6), suit, { pos: [sx * 0.14, floor + 0.16, 0.08], rot: [1.25, 0, -sx * 0.22] }));
  }
  // wheel and dashboard
  parts.push(part(new THREE.TorusGeometry(0.115, 0.016, 5, 14), '#0b0c0f', { pos: [0, floor + 0.17, 0.27], rot: [-0.45, 0, 0] }));
  parts.push(part(new RoundedBoxGeometry(0.44, 0.1, 0.2, 1, 0.04), '#1b1e24', { pos: [0, floor + 0.1, 0.44], rot: [0.3, 0, 0] }));
  return merge(parts);
}

/** Everything that is neither paint nor glass: rubber, steel fittings, brackets. */
export function buildTrimGeometry() {
  const dark = '#14171c';
  const rubber = '#0c0e11';
  const steel = '#c3c9d0';
  const parts = [];

  // the frame the canopy sits in
  {
    const base = canopyBase() + 0.004;
    const loop = [];
    const n = 16;
    for (let i = 0; i <= n; i++) loop.push(V(CANOPY.halfWidth * canopyRadius(i / n), base, lerp(CANOPY.z0, CANOPY.z1, i / n)));
    for (let i = n - 1; i >= 1; i--) loop.push(V(-CANOPY.halfWidth * canopyRadius(i / n), base, lerp(CANOPY.z0, CANOPY.z1, i / n)));
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true, 'centripetal'), 56, 0.024, 6, true), dark));
    // a hoop over the glass behind the driver's head
    const hoop = [];
    const u = 0.4;
    const r = canopyRadius(u);
    for (let j = 0; j <= 12; j++) {
      const a = (j / 12) * Math.PI;
      hoop.push(V(Math.cos(a) * (CANOPY.halfWidth * r + 0.004), base + Math.sin(a) * (CANOPY.height * r + 0.004), lerp(CANOPY.z0, CANOPY.z1, u)));
    }
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hoop, false, 'centripetal'), 26, 0.014, 5, false), dark));
  }
  // mirrors on short stalks either side of the cockpit
  for (const sx of [1, -1]) {
    const y = canopyBase() + 0.05;
    parts.push(part(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 6), dark, { pos: [sx * 0.39, y, 0.42], rot: [0.3, 0, -sx * 1.05] }));
    parts.push(part(new RoundedBoxGeometry(0.15, 0.085, 0.05, 2, 0.02), dark, { pos: [sx * 0.47, y + 0.045, 0.44], rot: [0, -sx * 0.25, 0] }));
    parts.push(part(new RoundedBoxGeometry(0.125, 0.062, 0.01, 1, 0.004), steel, { pos: [sx * 0.474, y + 0.045, 0.412], rot: [0, -sx * 0.25, 0] }));
  }
  for (const sx of [1, -1]) {
    // rub rails along the sheer, with a rubber nose on each bow
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push(V(sx * (outerAt(t) + 0.01), sheerAt(t) - 0.03 * clamp01((sheerAt(t) - chineAt(t)) / 0.3), zAt(t)));
    }
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 60, 0.024, 6, false), rubber));
    parts.push(part(new THREE.SphereGeometry(0.05, 12, 8), rubber, { pos: [sx * TIP_X, sheerAt(1) - 0.02, BOAT.bowZ], scale: [0.8, 1, 1.4] }));
    // cleats, pop-up style, and a filler cap on each deck
    for (const t of [0.34, 0.8]) {
      const x = sx * (outerAt(t) - 0.09);
      const y = sheerAt(t) + 0.035;
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), steel, { pos: [x, y, zAt(t) - 0.035] }));
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), steel, { pos: [x, y, zAt(t) + 0.035] }));
      parts.push(part(new THREE.CapsuleGeometry(0.012, 0.12, 3, 8), steel, { pos: [x, y + 0.018, zAt(t)], rot: [Math.PI / 2, 0, 0] }));
    }
    parts.push(part(new THREE.CylinderGeometry(0.045, 0.048, 0.014, 18), steel, { pos: [sx * FILLER.x, sheerAt(tAt(FILLER.z)) + 0.05, FILLER.z] }));
    // a bow eye under each tip
    parts.push(part(new THREE.TorusGeometry(0.03, 0.009, 6, 12), steel, { pos: [sx * (TIP_X + 0.01), sheerAt(0.985) - 0.09, zAt(0.985)], rot: [0, Math.PI / 2, 0] }));
    // trim tabs on the tails: steel plates, hinged at the transom
    parts.push(part(new RoundedBoxGeometry(0.4, 0.012, 0.2, 1, 0.004), steel, { pos: [sx * 0.8, -0.085, BOAT.sternZ - 0.09], rot: [0.1, 0, sx * 0.28] }));
  }
  // a towing eye on the nose
  parts.push(part(new THREE.TorusGeometry(0.035, 0.01, 6, 12), steel, { pos: [0, TUNNEL + 0.05, zAt(NOSE) - 0.02], rot: [0.5, 0, 0] }));
  return merge(parts);
}
