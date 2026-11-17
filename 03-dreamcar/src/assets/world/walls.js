// The low concrete walls: wherever the Track's solid edge is a WALL outside a
// tunnel (the start straight), precast blocks about a metre high whose face
// stands exactly at the edge distance (where the physics stops a car).
//
// One profile swept along each run (face, a chamfered top, the back), its
// texture coordinates metres of road and metres up the face. Painted in
// blocks of our own colours, white and a deep teal by turns, each block a
// precast unit with a dark joint; weathered: dirt sprayed up from the road
// along the foot, rain streaks down from the top, black rubber where cars
// have touched it, the paint worn to the concrete on the arrises.

import * as THREE from 'three';
import { EDGE, levelFrame, runsOf, stripGeometry } from './furniture.js';
import { extend } from './shading.js';

/** The wall seen end on, the road to the left: [out from the edge, up from the ground at the edge] (m). */
const PROFILE = [
  [0, -0.3],
  [0, 0.92],
  [0, 0.92],
  [0.04, 0.98],
  [0.04, 0.98],
  [0.3, 0.98],
  [0.3, 0.98],
  [0.32, -0.3],
];
/** Length of one precast block (m). */
const BLOCK = 4;
/** Metres between cross-sections on a straight and in a bend. */
const STEP = { straight: 6, bend: 2 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createWalls({ track, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'walls';
  const inTunnel = (s) => (track.tunnels ?? []).some((t) => track.wrap(s - t.s0) < t.s1 - t.s0);
  const frame = {};
  const base = new THREE.Vector3();
  const strips = [];
  let metres = 0;
  for (const side of [1, -1]) {
    const kinds = side > 0 ? track.kindL : track.kindR;
    const profile = side > 0 ? PROFILE.slice().reverse() : PROFILE;
    for (const run of runsOf(track, (i) => kinds[i] === EDGE.WALL && !inTunnel(i * track.ds))) {
      const s0 = run.s0;
      const s1 = run.s1 + track.ds;
      metres += s1 - s0;
      const rows = [];
      for (let s = s0; ; ) {
        const sw = track.wrap(s);
        levelFrame(track, sw, frame);
        const edge = track.edgeAt(sw, side);
        track.pointAt(sw, side * edge, base);
        rows.push(profile.map(([out, up]) => [base.x + frame.flat.x * side * out, base.y + up, base.z + frame.flat.z * side * out, s, up + out]));
        if (s >= s1) break;
        s = Math.min(s1, s + (Math.abs(frame.curvature) > 1 / 300 ? STEP.bend : STEP.straight));
      }
      if (rows.length > 1) strips.push(stripGeometry(rows));
    }
  }
  if (!strips.length) return { group, stats: { metres: 0 } };
  const material = wallPaint(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 })));
  for (const geometry of strips) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return { group, stats: { metres: Math.round(metres), meshes: strips.length } };
}

/** The paint and the weather, from (metres along, metres up). */
function wallPaint(material) {
  return extend(material, 'wall-paint', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWall;
float wallHash( float x ) { return fract( sin( x * 127.1 ) * 43758.5453 ); }
float wallNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = wallHash( i.x + i.y * 57.0 );
  float b = wallHash( i.x + 1.0 + i.y * 57.0 );
  float c = wallHash( i.x + ( i.y + 1.0 ) * 57.0 );
  float d = wallHash( i.x + 1.0 + ( i.y + 1.0 ) * 57.0 );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float wS = vWall.x;
float wY = vWall.y;
float wBlock = floor( wS / ${BLOCK.toFixed(1)} );
float wAa = fwidth( wS ) + 1.0e-3;
float wJoint = 1.0 - smoothstep( 0.012, 0.012 + wAa, abs( fract( wS / ${BLOCK.toFixed(1)} + 0.5 ) - 0.5 ) * ${BLOCK.toFixed(1)} );
// our colours: white and a deep teal by turns
vec3 wPaint = mod( wBlock, 2.0 ) < 0.5 ? vec3( 0.66, 0.66, 0.63 ) : vec3( 0.025, 0.16, 0.19 );
vec3 wConcrete = vec3( 0.36, 0.35, 0.32 );
float wN = wallNoise( vec2( wS * 1.3, wY * 6.0 ) ) * 0.6 + wallNoise( vec2( wS * 5.1, wY * 19.0 ) ) * 0.4;
// worn to the concrete on the chamfered arris and at random
float wWorn = max( smoothstep( 0.93, 0.98, wY ) * smoothstep( 0.4, 0.7, wN ), smoothstep( 0.78, 0.92, wN ) * 0.6 );
vec3 wCol = mix( wPaint, wConcrete, wWorn );
// rain streaks from the top, road dirt sprayed up the foot, rubber at a wheel's height
float wRain = smoothstep( 0.55, 0.85, wallNoise( vec2( wS * 3.0, wY * 0.6 ) ) ) * smoothstep( 0.2, 0.9, wY ) * 0.35;
float wSpray = smoothstep( 0.45, 0.0, wY ) * ( 0.5 + 0.5 * wallNoise( vec2( wS * 0.7, 1.0 ) ) );
float wRubber = smoothstep( 0.82, 0.95, wallNoise( vec2( wS * 0.35, 7.0 ) ) ) * smoothstep( 0.12, 0.25, wY ) * smoothstep( 0.6, 0.45, wY );
wCol *= 1.0 - wRain;
wCol = mix( wCol, vec3( 0.2, 0.18, 0.15 ), 0.7 * wSpray );
wCol = mix( wCol, vec3( 0.03 ), 0.8 * wRubber );
wCol *= 1.0 - 0.7 * wJoint;
diffuseColor.rgb *= wCol;`,
      );
  });
}
