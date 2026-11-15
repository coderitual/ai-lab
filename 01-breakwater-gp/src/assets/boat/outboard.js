// The outboards: a sculpted cowl with its lettering and vents, a leg, a
// gearcase with a skeg, and a propeller that turns.
//
// One engine is built round its pivot (the origin) and reaches back along -Z.
// The cowl carries a small texture wrapped round it like a label round a tin:
// u runs from the front, round the port side, the back and the starboard side;
// v from the neck to the crown.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, lerp, smoothstep } from '../../engine/math.js';
import { fan, mapUv, merge, part, skin } from '../geo.js';
import { V } from './lines.js';

/** Where the propeller sits on the engine, and which way its shaft points (-Z). */
export const PROP = { x: 0, y: -0.5, z: -0.385 };

// the cowl: [height, half width, half length, centre]
const PROFILE = [
  [-0.1, 0.085, 0.16, -0.15],
  [0.0, 0.11, 0.19, -0.16],
  [0.07, 0.14, 0.24, -0.172],
  [0.1, 0.165, 0.275, -0.18],
  [0.17, 0.185, 0.31, -0.185],
  [0.3, 0.19, 0.325, -0.19],
  [0.42, 0.183, 0.315, -0.2],
  [0.52, 0.163, 0.285, -0.215],
  [0.58, 0.13, 0.235, -0.23],
  [0.615, 0.08, 0.15, -0.24],
  [0.628, 0.02, 0.04, -0.245],
];
const Y0 = PROFILE[0][0];
const Y1 = PROFILE[PROFILE.length - 1][0];
const BAND = [0.2, 0.262]; // the stripe in the team's colour
const profileAt = (y) => {
  let i = 0;
  while (i < PROFILE.length - 2 && y > PROFILE[i + 1][0]) i++;
  const a = PROFILE[i];
  const b = PROFILE[i + 1];
  const f = smoothstep(0, 1, clamp01((y - a[0]) / (b[0] - a[0])));
  return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
};

/** A rounded-rectangle outline in the horizontal plane, from the front, round by port. */
function ringAt(y, halfW, halfL, zc, n = 28, power = 3) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push(V(Math.sign(s) * Math.pow(Math.abs(s), 2 / power) * halfW, y, zc + Math.sign(c) * Math.pow(Math.abs(c), 2 / power) * halfL));
  }
  return pts;
}

/** One outboard without its propeller. Team colour is carried by the vertices of the stripe. */
export function buildOutboardGeometry(team) {
  const grey = new THREE.Color('#1a1d22');
  const steel = new THREE.Color('#aab1b9');
  const white = new THREE.Color('#ffffff');
  const teamColor = new THREE.Color(team.hull);
  const corner = [0.004, 0.004]; // a white spot of the picture: plain parts are coloured by their vertices alone
  const parts = [];

  // cowl, with two rings a hair apart at each edge of the stripe so its edges are sharp
  const ys = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const y = lerp(Y0, Y1, Math.pow(i / n, 0.85));
    if (!BAND.some((c) => Math.abs(y - c) < 0.004)) ys.push(y);
  }
  for (const c of BAND) ys.push(c - 0.0005, c + 0.0005);
  ys.sort((a, b) => a - b);
  const rings = ys.map((y) => ringAt(y, ...profileAt(y)));
  const cols = rings[0].length - 1;
  parts.push(
    skin(rings, {
      uvAt: (p, i, j) => [j / cols, (ys[i] - Y0) / (Y1 - Y0)],
      colorAt: (i) => (ys[i] > BAND[0] && ys[i] < BAND[1] ? teamColor : white),
    }),
  );
  const plain = (g) => mapUv(g, corner);
  parts.push(plain(fan(rings[0].slice(0, -1), grey, { flip: true }))); // underside
  parts.push(plain(fan(rings[rings.length - 1].slice(0, -1), '#0b0c0f'))); // crown

  // the leg, slimmer toward the bottom
  const leg = [-0.43, -0.34, -0.25, -0.17, -0.09];
  parts.push(skin(leg.map((y, i) => ringAt(y, lerp(0.045, 0.085, i / 4), lerp(0.12, 0.16, i / 4), -0.15, 16, 2.6)), { uvAt: () => corner, colorAt: () => grey }));
  // plate over the propeller, gearcase, skeg
  parts.push(plain(part(new RoundedBoxGeometry(0.22, 0.016, 0.34, 1, 0.007), grey, { pos: [0, -0.35, -0.2] })));
  parts.push(plain(part(new THREE.CapsuleGeometry(0.058, 0.3, 5, 14), grey, { pos: [0, -0.5, -0.13], rot: [Math.PI / 2, 0, 0] })));
  {
    const skeg = new THREE.Shape();
    skeg.moveTo(0.1, 0);
    skeg.lineTo(-0.16, 0);
    skeg.lineTo(-0.2, -0.17);
    skeg.lineTo(-0.1, -0.17);
    skeg.lineTo(0.1, 0);
    const g = new THREE.ExtrudeGeometry(skeg, { depth: 0.016, bevelEnabled: false });
    g.translate(0, 0, -0.008);
    parts.push(plain(part(g, grey, { pos: [0, -0.55, -0.14], rot: [0, -Math.PI / 2, 0] })));
    g.dispose();
  }
  // steering arm and tilt tube at the front of the leg
  parts.push(plain(part(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), steel, { pos: [0, -0.02, 0.0], rot: [0, 0, Math.PI / 2] })));
  parts.push(plain(part(new RoundedBoxGeometry(0.1, 0.2, 0.09, 1, 0.02), grey, { pos: [0, -0.06, -0.03] })));
  return merge(parts);
}

/** A four-bladed propeller, its shaft along Z through the origin. */
export function buildPropGeometry() {
  const steel = '#d0d5db';
  const parts = [];
  const blades = 4;
  const pitch = 0.2; // metres of advance per turn: sets how the blades twist
  for (let k = 0; k < blades; k++) {
    const rows = [];
    for (let i = 0; i <= 7; i++) {
      const r = lerp(0.028, 0.112, i / 7);
      const chord = 0.074 * Math.sqrt(Math.max(0.02, Math.sin(Math.PI * lerp(0.12, 0.97, i / 7)))); // widest two thirds of the way out
      const angle = Math.atan2(pitch, 2 * Math.PI * r); // steep at the hub, flat at the tip
      const rake = -0.012 * (i / 7);
      const row = [];
      for (let j = 0; j <= 4; j++) {
        const c = (j / 4 - 0.5) * chord;
        // along the chord: round the shaft and along it, by the blade's angle
        row.push(new THREE.Vector3(r, c * Math.cos(angle), c * Math.sin(angle) + rake));
      }
      rows.push(row);
    }
    const g = skin(rows, { uvAt: () => [0.5, 0.5], colorAt: () => steel });
    g.rotateZ((k / blades) * Math.PI * 2);
    parts.push(g);
  }
  const hub = (g) => mapUv(g, [0.5, 0.5]);
  parts.push(hub(part(new THREE.CylinderGeometry(0.03, 0.034, 0.1, 12), steel, { rot: [Math.PI / 2, 0, 0] })));
  parts.push(hub(part(new THREE.ConeGeometry(0.03, 0.07, 12), steel, { pos: [0, 0, -0.085], rot: [-Math.PI / 2, 0, 0] })));
  return merge(parts);
}

let texture = null;
/**
 * The picture wrapped round every cowl: mostly gloss black, white where the
 * team's stripe goes (the stripe's colour comes from the vertices), a model
 * name on each flank, vents high at the back.
 */
export function engineTexture(anisotropy = 4) {
  if (texture) return texture;
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const row = (y) => h - ((y - Y0) / (Y1 - Y0)) * h; // height on the engine -> row of the picture
  ctx.fillStyle = '#0b0c0f';
  ctx.fillRect(0, 0, w, h);
  // the neck is plain dark grey plastic
  ctx.fillStyle = '#1a1d22';
  ctx.fillRect(0, row(0.085), w, h - row(0.085));
  // stripe (white: tinted by the vertices), a bright pinstripe above it, a seam below
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, row(BAND[1]) - 1, w, row(BAND[0]) - row(BAND[1]) + 2);
  ctx.fillStyle = '#b8bfc7';
  ctx.fillRect(0, row(0.288), w, row(0.276) - row(0.288));
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, row(0.176), w, 2);
  // a white corner for the plain parts (leg, gearcase) to look at
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, h - 4, 4, 4);
  // lettering on each flank (u = 0.25 is the port side, 0.75 the starboard side)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const u of [0.25, 0.75]) {
    ctx.fillStyle = '#e9edf1';
    ctx.font = 'italic 900 58px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('400', u * w - 6, row(0.4));
    ctx.fillStyle = '#9aa2ab';
    ctx.font = 'italic 700 17px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('V8  ·  RACE', u * w - 4, row(0.326));
  }
  // vents high on the back quarters: slanted slots with a lit lower lip
  for (const u of [0.385, 0.615]) {
    for (let k = 0; k < 4; k++) {
      const x = u * w - 30 + k * 16;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(x, row(0.56));
      ctx.lineTo(x + 9, row(0.56));
      ctx.lineTo(x + 15, row(0.47));
      ctx.lineTo(x + 6, row(0.47));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a3f47';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 15, row(0.47));
      ctx.lineTo(x + 9, row(0.56));
      ctx.stroke();
    }
  }
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}
