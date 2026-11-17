// Road studs: small lenses set into the lines through every bend, the
// hairpins, the hook and the tunnel, so that at night the road's shape is
// drawn in points of light round the next corner (look reference B).
//
//  - Where: on the centre line and both edge lines wherever the road bends
//    (one every 6 to 12 m, the tighter the closer) and all through the tunnel;
//    on the straights only the centre line, every 24 m.
//  - Colour: amber on the centre line; on the edges white towards the lap's
//    direction of travel and red seen the wrong way.
//  - Light: each answers the head lamps like the other retro-reflectors
//    (retro.js: the same beams, the same return towards the eye) and, at
//    night, glows faintly on its own (solar studs): bright enough to draw a
//    bend 150 m away and to bloom a little close by, never a lamp.
//  - Drawn as one cloud of points (one draw call): a stud is a few
//    centimetres across, under a pixel beyond 30 m, so each is a spot of at
//    least STUD_PX pixels whose brightness is scaled by the share of that spot
//    its true size would cover (to the power 0.6: far studs are favoured, so
//    a bend reads from 150 m). Nothing flickers as it shrinks.

import * as THREE from 'three';
import { GLSL_TARGET, targetDefines } from '../../engine/glsl.js';
import { RETRO_GLSL, RETRO_UNIFORMS } from './retro.js';

/** Spacing (m) in the tightest bends, in gentle ones, and on the centre line of a straight. */
const TIGHT = 6;
const GENTLE = 12;
const STRAIGHT = 24;
/** Curvature (1/m) under which the road counts as straight, and at which the spacing is tightest. */
const BENT = 1 / 600;
const TIGHTEST = 1 / 40;
/** The lens: width and height (m), and how far above the road its middle is. */
const LENS = [0.1, 0.025];
const RISE = 0.035;
/** Smallest spot drawn, in device pixels. */
const STUD_PX = 2.2;
/** Their own glow at night (radiance, scene units) and how much of the head lamps' light comes back. */
const GLOW = 0.6;
const RETRO = 0.35;
/** Colours (linear): amber, white, red. */
const COLORS = [
  [1.0, 0.45, 0.06],
  [0.95, 0.97, 1.0],
  [1.0, 0.05, 0.02],
];

/**
 * @param {object} options
 * @param {object} options.track the Track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @returns {{ points: THREE.Points, stats: { studs: number }, setTime: (time: object) => void,
 *   prepareView: (camera: THREE.Camera, viewHeight: number) => void, dispose: () => void }}
 */
export function createStuds({ track, caps }) {
  const edge = track.halfWidth - 0.3;
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const p = new THREE.Vector3();
  const pos = [];
  const dir = [];
  const kind = [];
  const inTunnel = (s) => track.tunnels.some((t) => s > t.s0 - 20 && s < t.s1 + 20);
  // the largest curvature within 15 m either side: studs begin before the bend does
  const bendAt = (s) => {
    let k = 0;
    for (let d = -15; d <= 15; d += 5) {
      const i = Math.round((((s + d) % track.length) + track.length) % track.length / track.ds) % track.count;
      k = Math.max(k, Math.abs(track.curvature[i]));
    }
    return k;
  };
  const add = (s, lat, which) => {
    track.pointAt(s, lat, p);
    track.frameAt(s, frame);
    p.addScaledVector(frame.up, RISE);
    pos.push(p.x, p.y, p.z);
    dir.push(frame.tan.x, frame.tan.y, frame.tan.z);
    kind.push(which);
  };
  let s = 3;
  let sinceCentre = STRAIGHT;
  while (s < track.length - 3) {
    const k = bendAt(s);
    const bent = k > BENT || inTunnel(s);
    const t = Math.min(1, Math.max(0, (k - BENT) / (TIGHTEST - BENT)));
    const step = bent ? GENTLE + (TIGHT - GENTLE) * Math.sqrt(t) : GENTLE;
    if (bent) {
      add(s, 0, 0);
      add(s, edge, 1);
      add(s, -edge, 1);
      sinceCentre = 0;
    } else if (sinceCentre >= STRAIGHT) {
      add(s, 0, 0);
      sinceCentre = 0;
    }
    s += step;
    sinceCentre += step;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    ...RETRO_UNIFORMS,
    uGlow: { value: 0 },
    uPixelScale: { value: 500 },
    uMinPx: { value: STUD_PX },
    uColors: { value: COLORS.map((c) => new THREE.Vector3(...c)) },
  };
  const material = new THREE.ShaderMaterial({
    defines: targetDefines(caps),
    uniforms,
    vertexShader: /* glsl */ `
attribute vec3 aDir;
attribute float aKind;
uniform float uGlow;
uniform float uPixelScale; // pixels per metre at one metre
uniform float uMinPx;
uniform vec3 uColors[3];
varying vec3 vColor;
${RETRO_GLSL}
void main() {
  vRetroEye = RETRO_EYE_FROM_PROJECTION;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 v = viewMatrix * w;
  gl_Position = projectionMatrix * v;
  vec3 toEye = cameraPosition - w.xyz;
  float d = max(length(toEye), 0.3);
  // the lens faces along the road both ways; seen from behind the lap's direction an edge stud is white
  float ahead = dot(toEye / d, aDir);
  vec3 face = normalize(aDir * (ahead < 0.0 ? -1.0 : 1.0) + vec3(0.0, 0.25, 0.0));
  vec3 c = aKind < 0.5 ? uColors[0] : (ahead < 0.0 ? uColors[1] : uColors[2]);
  // its lens seen nearly edge-on from the side: dim
  float squint = smoothstep(0.1, 0.5, abs(ahead));
  float light = uGlow + ${RETRO.toFixed(3)} * retroReturn(w.xyz, face);
  // the true size of the lens on the screen against the spot drawn
  float px = uPixelScale / -min(v.z, -0.05);
  float wide = ${LENS[0].toFixed(3)} * px;
  float high = ${LENS[1].toFixed(3)} * px;
  float spot = max(uMinPx, wide);
  // (raised to a power under one: a far stud keeps more than its share, so the next bend reads from 150 m)
  vColor = c * light * squint * pow(min(1.0, wide * high / (spot * spot * 0.6)), 0.6);
  gl_PointSize = spot;
}`,
    fragmentShader: /* glsl */ `
${GLSL_TARGET}
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float f = exp(-dot(q, q) * 2.5);
  gl_FragColor = toTarget(vec4(vColor * f * 1.6, 1.0));
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  material.name = 'road-studs';
  const points = new THREE.Points(geometry, material);
  points.name = 'road-studs';
  points.matrixAutoUpdate = false;
  points.renderOrder = 12;

  return {
    points,
    stats: { studs: kind.length },
    setTime(time) {
      uniforms.uGlow.value = time.name === 'night' ? GLOW : 0;
    },
    /** @param {THREE.PerspectiveCamera} camera @param {number} viewHeight device pixels */
    prepareView(camera, viewHeight) {
      if (camera.isPerspectiveCamera) uniforms.uPixelScale.value = viewHeight / 2 / Math.tan((camera.fov * Math.PI) / 360);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
