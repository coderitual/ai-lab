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
//    behind it (the lake): blocks of a warm grey and a burnt orange by
//    turns (frame D1's wall);
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
const WALL_TOP_AT = WALL_TOP;
/**
 * (nearfield lane) The wall seen end on, the road to the left: [out from the edge, up from the ground at the edge, which
 * face (0 the road's, 1 the top, 2 the back)] (m). A precast safety barrier: a chamfered foot, a sloped lower face
 * that turns a wheel, a near-upright upper face, chamfered arrises, a top 0.2 m wide, the back the same. Every corner
 * is doubled (a crease), so the faces are lit flat.
 */
const SECTION = [
  [0, -0.3, 0],
  [0, 0.05, 0],
  [0.04, 0.09, 0],
  [0.15, 0.3, 0],
  [0.2, 0.86, 0],
  [0.24, WALL_TOP_AT, 0],
  [0.44, WALL_TOP_AT, 2],
  [0.48, 0.86, 2],
  [0.53, 0.3, 2],
  [0.62, 0.09, 2],
  [0.66, 0.05, 2],
  [0.66, -0.3, 2],
];
/** The section with each corner doubled: every segment its own pair of points, marked with its face. */
const PROFILE = [];
for (let k = 0; k < SECTION.length - 1; k++) {
  const face = k < 5 ? 0 : k === 5 ? 1 : 2;
  PROFILE.push([SECTION[k][0], SECTION[k][1], face], [SECTION[k + 1][0], SECTION[k + 1][1], face]);
}
/** The joint between two blocks: a groove this wide and deep in every face (high tier; the others paint it). */
const GROOVE = { width: 0.05, depth: 0.035 };
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
export function createWalls({ track, atmosphere, tier = 'medium' }) {
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
    // (nearfield lane) the joints between blocks are grooves in the geometry above the low tier: four rows round each
    const grooves = tier === 'high';
    const notch = (out, depth) => out + depth * Math.sign(0.33 - out) * Math.min(1, Math.abs(0.33 - out) / 0.1);
    for (const run of runsOf(track, (i) => kinds[i] === EDGE.WALL && !inTunnel(i * track.ds))) {
      const s0 = run.s0;
      const s1 = run.s1 + track.ds;
      metres += s1 - s0;
      const rows = [];
      const paints = [];
      const faces = [];
      const add = (s, depth) => {
        const sw = track.wrap(s);
        levelFrame(track, sw, frame);
        const edge = track.edgeAt(sw, side);
        track.pointAt(sw, side * edge, base);
        rows.push(
          profile.map(([out, up]) => {
            const o = notch(out, depth);
            return [base.x + frame.flat.x * side * o, base.y + up, base.z + frame.flat.z * side * o, s, up];
          }),
        );
        const paint = paintAt(sw, side);
        paints.push(profile.map(() => [paint]));
        faces.push(profile.map(([, , face]) => [face]));
      };
      for (let s = s0; ; ) {
        add(s, 0);
        if (s >= s1) break;
        const next = Math.min(s1, s + (Math.abs(frame.curvature) > 1 / 300 ? STEP.bend : STEP.straight));
        // the next joint between blocks before `next`: a groove round it, and on from just after it
        const j = (Math.floor((s + GROOVE.width + 0.01) / BLOCK) + 1) * BLOCK;
        if (grooves && j - GROOVE.width > s + 0.01 && j + GROOVE.width < s1 - 0.01 && j <= next) {
          add(j - GROOVE.width, 0);
          add(j - GROOVE.width / 2, GROOVE.depth);
          add(j + GROOVE.width / 2, GROOVE.depth);
          s = j + GROOVE.width;
        } else s = next;
      }
      if (rows.length > 1) strips.push(stripGeometry(rows, { attributes: { aPaint: { size: 1, rows: paints }, aFace: { size: 1, rows: faces } } }));
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

/**
 * The paint and the weather, from (metres along, metres up) and the face. (nearfield lane) Cast concrete under worn
 * paint: the paint is a band on the road's face (frame D1's blocks, white, bottle green: PAINT), chipped and worn
 * through to the grey concrete, most on the arrises and low down where wheels and stones hit it; the concrete shows
 * formwork lines and air holes, rain streaks hang from the top edge, black tyre scuffs lie along the sloped foot, the
 * foot is dark with road dirt; a groove between blocks (the geometry's, painted dark on the low tier), two lifting
 * slots in each block's top, a drain slot at the foot of every third.
 */
function wallPaint(material) {
  return extend(material, 'wall-paint', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;\nattribute float aFace;\nvarying vec2 vWall;\nvarying float vWallPaint;\nvarying float vWallFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = uv;\nvWallPaint = aPaint;\nvWallFace = aFace;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWall;
varying float vWallPaint;
varying float vWallFace;
float wallHash( float x ) { return fract( sin( x * 127.1 ) * 43758.5453 ); }
float wallHash2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
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
float wFace = floor( vWallFace + 0.5 );
float wBlock = floor( wS / ${BLOCK.toFixed(1)} );
float wU = ( fract( wS / ${BLOCK.toFixed(1)} ) - 0.5 ) * ${BLOCK.toFixed(1)};
float wAa = fwidth( wS ) + 1.0e-3;
float wYa = fwidth( wY ) + 1.0e-3;
float wFine = 1.0 - smoothstep( 0.015, 0.06, wAa );
float wJoint = 1.0 - smoothstep( 0.02, 0.02 + wAa, ${(BLOCK / 2).toFixed(2)} - abs( wU ) );
// the concrete: each block cast on its own, a shade apart; formwork lines, air holes
float wTone = wallHash( wBlock * 3.7 + 11.0 );
vec3 wConcrete = vec3( 0.36, 0.35, 0.32 ) * ( wTone < 0.33 ? 0.92 : wTone < 0.75 ? 1.0 : 1.07 );
float wN = wallNoise( vec2( wS * 1.3, wY * 6.0 ) ) * 0.6 + wallNoise( vec2( wS * 5.1, wY * 19.0 ) ) * 0.4;
wConcrete *= 0.9 + 0.2 * wallNoise( vec2( wS * 0.6, wY * 2.0 + wFace * 7.0 ) );
wConcrete *= 1.0 - 0.12 * wFine * ( 1.0 - smoothstep( 0.006, 0.006 + wYa, abs( fract( wY / 0.3 ) - 0.5 ) * 0.3 - 0.14 ) );
vec2 wHq = vec2( wS * 9.0, wY * 9.0 + wFace * 3.0 );
vec2 wHc = floor( wHq );
float wHole = step( 0.86, wallHash2( wHc ) ) * ( 1.0 - smoothstep( 0.12, 0.2, length( fract( wHq ) - 0.5 ) ) );
wConcrete *= 1.0 - 0.45 * wHole * wFine;
// the paint (PAINT): a warm grey and a burnt orange by turns (day lane: frame D1's, in shade (50, 45, 43) and
// (90, 52, 38)); white; a deep bottle green. A band on the road's face, from the foot's slope to under the arris
vec3 wPaint = mod( wBlock, 2.0 ) < 0.5 ? vec3( 0.07, 0.062, 0.056 ) : vec3( 0.36, 0.11, 0.04 );
wPaint = vWallPaint > ${(PAINT.WHITE - 0.5).toFixed(1)} ? vec3( 0.6, 0.59, 0.56 ) : wPaint;
wPaint = vWallPaint > ${(PAINT.DARK - 0.5).toFixed(1)} ? vec3( 0.018, 0.048, 0.036 ) : wPaint;
float wRag = 0.04 * ( wallNoise( vec2( wS * 7.0, 3.0 ) ) - 0.5 );
float wBand = step( wFace, 0.5 ) * smoothstep( 0.1 + wRag, 0.12 + wRag + wYa, wY ) * ( 1.0 - smoothstep( 0.86 + wRag, 0.88 + wRag + wYa, wY ) );
// (the green wall is the quiet one: its paint is kept up, and it covers the top too)
float wKept = vWallPaint > ${(PAINT.DARK - 0.5).toFixed(1)} ? 1.0 : 0.0;
wBand = max( wBand, wKept * step( wFace, 1.5 ) * step( 0.1, wY ) );
// chipped and worn through: in flakes, most low down and at the arrises and the block's ends
// (round 2) flakes a few centimetres across, not blotches: the fine noise leads, the coarse only gathers them
float wFlake = wallNoise( vec2( wS * 16.0, wY * 34.0 ) ) * 0.72 + wallNoise( vec2( wS * 4.1, wY * 9.0 ) ) * 0.28;
float wChip = smoothstep( 0.79, 0.82, wFlake + 0.3 * ( 1.0 - smoothstep( 0.1, 0.35, wY ) ) + 0.35 * smoothstep( 1.3, 1.48, abs( wU ) ) + 0.2 * smoothstep( 0.8, 0.86, wY ) );
wChip *= 1.0 - 0.75 * wKept;
vec3 wCol = mix( wConcrete, wPaint, wBand * ( 1.0 - wChip ) );
// rain streaks hanging from the top edge, road dirt sprayed up the foot, black tyre scuffs along the sloped foot
float wRain = smoothstep( 0.5, 0.85, wallNoise( vec2( wS * 3.0, wY * 0.6 ) ) ) * smoothstep( 0.3, 0.9, wY ) * step( wFace, 1.5 ) * ( 1.0 - step( 0.5, wFace ) * step( wFace, 1.5 ) );
float wSpray = ( 1.0 - smoothstep( 0.0, 0.35, wY ) ) * ( 0.5 + 0.5 * wallNoise( vec2( wS * 0.7, 1.0 ) ) );
float wRubber = smoothstep( 0.72, 0.9, wallNoise( vec2( wS * 0.35, 7.0 ) ) ) * smoothstep( 0.08, 0.14, wY ) * ( 1.0 - smoothstep( 0.32, 0.5, wY + 0.1 * wallNoise( vec2( wS * 4.0, 2.0 ) ) ) ) * step( wFace, 0.5 );
wRubber *= 0.5 + 0.5 * smoothstep( 0.3, 0.7, wallNoise( vec2( wS * 6.0, wY * 30.0 ) ) );
wCol *= 1.0 - 0.4 * wRain;
wCol = mix( wCol, vec3( 0.16, 0.14, 0.11 ), 0.75 * wSpray );
wCol = mix( wCol, vec3( 0.025 ), 0.85 * wRubber );
// the groove between blocks (painted on the low tier, in shade in the geometry otherwise)
wCol *= 1.0 - 0.65 * wJoint;
// two lifting slots in each block's top, an anchor recess near the top of each face, a drain slot on every third
float wSlot = step( 0.5, wFace ) * step( wFace, 1.5 ) * ( 1.0 - smoothstep( 0.0, wAa, abs( abs( wU ) - 0.85 ) - 0.07 ) );
wCol *= 1.0 - 0.7 * wSlot * wFine;
float wAnchor = ( 1.0 - smoothstep( 0.035, 0.035 + wAa, length( vec2( abs( wU ) - 0.9, ( wY - 0.72 ) ) ) ) ) * ( 1.0 - step( 0.5, wFace ) * step( wFace, 1.5 ) );
wCol *= 1.0 - 0.6 * wAnchor * wFine;
float wDrain = mod( wBlock, 3.0 ) < 0.5 ? ( 1.0 - smoothstep( 0.0, wAa, abs( wU ) - 0.22 ) ) * ( 1.0 - smoothstep( 0.0, wYa, abs( wY - 0.07 ) - 0.06 ) ) : 0.0;
wCol *= 1.0 - 0.85 * wDrain;
// the top: paler, worn
wCol *= 1.0 + 0.12 * step( 0.5, wFace ) * step( wFace, 1.5 );
diffuseColor.rgb *= wCol;`,
      );
  });
}
