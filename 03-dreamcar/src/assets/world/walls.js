// The low concrete walls: wherever the Track's solid edge is a WALL outside a
// tunnel, precast blocks 0.93 m high (the hoardings behind show over them)
// whose face stands exactly at the edge distance (where the physics stops a
// car).
//
// One profile swept along each run (face, a chamfered top, the back), its
// texture coordinates metres of road and metres up the face. Each block is a
// precast unit with a dark joint; weathered: dirt sprayed up from the road
// along the foot, rain streaks down from the top, black rubber where cars
// have touched it, the paint worn to the concrete on the arrises.
//
// The paint depends on where the wall stands, by rule (PAINT):
//  - along the stretch through the start line, on the side with nothing
//    behind it (the lake): blocks of our own colours, graphite and a bright
//    teal by turns (frame D1's wall is dark with bright blocks);
//  - along the same stretch on the side where the land is (woods behind it:
//    the pit wall and the grid's far side): white (frame D4);
//  - everywhere else (the ledge's bend, frame D3): one deep bottle green,
//    quiet, its top a level dark band.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EDGE, levelFrame, runsOf, stripGeometry } from './furniture.js';
import { extend } from './shading.js';

/** The wall's top above the ground at the edge (m): whatever stands on the wall stands on this. */
export const WALL_TOP = 0.93;
/** The wall seen end on, the road to the left: [out from the edge, up from the ground at the edge] (m). */
const PROFILE = [
  [0, -0.3],
  [0, WALL_TOP - 0.05],
  [0, WALL_TOP - 0.05],
  [0.04, WALL_TOP],
  [0.04, WALL_TOP],
  [0.3, WALL_TOP],
  [0.3, WALL_TOP],
  [0.32, -0.3],
];
/** Length of one precast block (m). */
const BLOCK = 3;
/** Metres between cross-sections on a straight and in a bend. */
const STEP = { straight: 6, bend: 2 };
/** Which paint a wall wears (the shader has the same numbers). */
const PAINT = { BLOCKS: 0, WHITE: 1, DARK: 2 };

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
  // the stretch the start line lies on, and which of its sides is the land (the Track says what grows there)
  const start = track.sectionAt ? track.sectionAt(0) : null;
  const onStart = (s) => !!start && track.sectionAt(s) === start;
  const paintAt = (s, side) => (!onStart(s) ? PAINT.DARK : track.woodAt?.(s, side) ? PAINT.WHITE : PAINT.BLOCKS);
  for (const side of [1, -1]) {
    const kinds = side > 0 ? track.kindL : track.kindR;
    const profile = side > 0 ? PROFILE.slice().reverse() : PROFILE;
    for (const run of runsOf(track, (i) => kinds[i] === EDGE.WALL && !inTunnel(i * track.ds))) {
      const s0 = run.s0;
      const s1 = run.s1 + track.ds;
      metres += s1 - s0;
      const rows = [];
      const paints = [];
      for (let s = s0; ; ) {
        const sw = track.wrap(s);
        levelFrame(track, sw, frame);
        const edge = track.edgeAt(sw, side);
        track.pointAt(sw, side * edge, base);
        rows.push(profile.map(([out, up]) => [base.x + frame.flat.x * side * out, base.y + up, base.z + frame.flat.z * side * out, s, up + out]));
        const paint = paintAt(sw, side);
        paints.push(profile.map(() => [paint]));
        if (s >= s1) break;
        s = Math.min(s1, s + (Math.abs(frame.curvature) > 1 / 300 ? STEP.bend : STEP.straight));
      }
      if (rows.length > 1) strips.push(stripGeometry(rows, { attributes: { aPaint: { size: 1, rows: paints } } }));
    }
  }
  if (!strips.length) return { group, stats: { metres: 0 } };
  const material = wallPaint(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 })));
  // (finish lane) every run in one mesh (world/index.js cuts it into 400 m pieces): a run was a draw call of its own
  const geometry = strips.length > 1 ? mergeGeometries(strips) : strips[0];
  if (strips.length > 1) for (const g of strips) g.dispose();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'wall';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  return { group, stats: { metres: Math.round(metres), meshes: strips.length } };
}

/** The paint and the weather, from (metres along, metres up). */
function wallPaint(material) {
  return extend(material, 'wall-paint', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;\nvarying vec2 vWall;\nvarying float vWallPaint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = uv;\nvWallPaint = aPaint;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWall;
varying float vWallPaint;
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
// the paint (PAINT): graphite and a bright teal by turns; white; a deep bottle green
vec3 wPaint = mod( wBlock, 2.0 ) < 0.5 ? vec3( 0.022, 0.026, 0.03 ) : vec3( 0.04, 0.4, 0.42 );
wPaint = vWallPaint > ${(PAINT.WHITE - 0.5).toFixed(1)} ? vec3( 0.6, 0.59, 0.56 ) : wPaint;
wPaint = vWallPaint > ${(PAINT.DARK - 0.5).toFixed(1)} ? vec3( 0.018, 0.048, 0.036 ) : wPaint;
vec3 wConcrete = vec3( 0.36, 0.35, 0.32 );
float wN = wallNoise( vec2( wS * 1.3, wY * 6.0 ) ) * 0.6 + wallNoise( vec2( wS * 5.1, wY * 19.0 ) ) * 0.4;
// worn to the concrete on the chamfered arris and at random
float wWorn = max( smoothstep( 0.88, 0.95, wY ) * smoothstep( 0.4, 0.7, wN ), smoothstep( 0.78, 0.92, wN ) * 0.6 );
// (the dark wall is the quiet one: its paint is kept up)
wWorn *= vWallPaint > ${(PAINT.DARK - 0.5).toFixed(1)} ? 0.3 : 1.0;
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
