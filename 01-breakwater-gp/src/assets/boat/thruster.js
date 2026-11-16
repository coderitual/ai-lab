// What drives the boat: a turbine in a pod on the stern deck, and its jet.
//
// The pod is a body of revolution on a short pylon: an intake at the front, a
// nozzle at the back. Inside the nozzle a disc glows with the throttle, and a
// cone of flame stands out behind it: short and blue at cruise, long and white
// under boost.

import * as THREE from 'three';
import { loft, merge, part } from '../geo.js';
import { bodyTopAt, tAt } from './lines.js';

/** Where the pod is: its axis (y), from intake (z0) to nozzle (z1), and the nozzle's inner radius. */
export const POD = { y: 0.86, z0: -1.2, z1: -3.04, throat: 0.15, glowZ: -2.8 };

// radius of the pod along its length: [z, radius]
const PROFILE = [
  [POD.z0, 0.17],
  [POD.z0 - 0.07, 0.205],
  [-1.6, 0.25],
  [-2.1, 0.262],
  [-2.55, 0.245],
  [-2.9, 0.205],
  [POD.z1, 0.186],
];

/**
 * The pod, its pylon and the inside of its nozzle, with vertex colours.
 * @param {{ hull: string, accent: string }} team
 */
export function buildPodGeometry(team) {
  const carbon = new THREE.Color('#15181d');
  const paint = new THREE.Color(team.hull);
  const bright = new THREE.Color('#d9dee3');
  const dark = new THREE.Color('#050608');
  const N = 24;
  const ring = (z, r) => {
    const row = [];
    for (let j = 0; j <= N; j++) {
      const a = (j / N) * Math.PI * 2;
      row.push(new THREE.Vector3(Math.cos(a) * r, POD.y + Math.sin(a) * r, z));
    }
    return row;
  };
  // finer rings than the profile has points: a smooth curve through it
  const curve = new THREE.CatmullRomCurve3(PROFILE.map(([z, r]) => new THREE.Vector3(r, 0, z)), false, 'centripetal');
  const M = 22;
  const rows = [];
  for (let i = 0; i <= M; i++) {
    const p = curve.getPoint(i / M);
    rows.push(ring(p.z, p.x));
  }
  const parts = [];
  // the shell: carbon, a band of the team's colour round its thickest part, bright metal at both lips
  parts.push(
    loft(rows.slice().reverse(), (i) => {
      const u = 1 - i / M; // 0 at the intake .. 1 at the nozzle
      if (u < 0.05 || u > 0.94) return bright;
      if (u > 0.3 && u < 0.46) return paint;
      return carbon;
    }),
  );
  // the intake: a dark mouth with a spinner in it
  parts.push(loft([ring(POD.z0, 0.165), ring(POD.z0 - 0.16, 0.05)], () => dark));
  parts.push(part(new THREE.ConeGeometry(0.06, 0.2, 12).rotateX(Math.PI / 2), '#aeb5bd', { pos: [0, POD.y, POD.z0 - 0.04] }));
  // the inside of the nozzle, narrowing to where the fire is
  parts.push(loft([ring(POD.z1, 0.18), ring(POD.glowZ, POD.throat)], (i) => (i ? dark : bright)));
  // the pylon it stands on, swept back, and a fairing where that meets the deck
  const foot = bodyTopAt(tAt(-2.0), 0);
  const strut = new THREE.BoxGeometry(0.11, POD.y - 0.2 - foot + 0.12, 0.95);
  strut.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, -0.35)); // (leans aft as it rises)
  parts.push(part(strut, carbon, { pos: [0, (POD.y - 0.2 + foot) / 2, -2.02] }));
  parts.push(part(new THREE.SphereGeometry(0.16, 12, 8), carbon, { pos: [0, foot + 0.01, -1.98], scale: [0.7, 0.35, 3.6] }));
  return merge(parts);
}

/** The disc of fire inside the nozzle: a circle facing aft. */
export function buildGlowGeometry() {
  return new THREE.CircleGeometry(POD.throat * 1.02, 24).rotateY(Math.PI).translate(0, POD.y, POD.glowZ + 0.005);
}

/** The flame: a cone a metre long from the nozzle aft, to be stretched along z. Its base is at the origin. */
export function buildFlameGeometry() {
  return new THREE.ConeGeometry(POD.throat * 0.98, 1, 18, 6, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
}

/** The flame's material: light added to the picture, hottest at the nozzle and seen through its middle. */
export function createFlameMaterial(colour) {
  return new THREE.ShaderMaterial({
    name: 'Flame',
    uniforms: { uColor: { value: new THREE.Color(colour) }, uPower: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = -position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float through = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float fade = (1.0 - vAlong) * (1.0 - vAlong);
        vec3 c = mix(uColor, vec3(1.0), fade * fade * 0.6) * (0.2 + 0.8 * through) * fade * uPower;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
