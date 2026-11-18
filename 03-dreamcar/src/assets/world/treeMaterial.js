// How everything that grows is shaded. Three materials for the trees (the
// meshes, the impostor cards, the shadow pass) and one for the small things
// under them, all standard materials underneath, so they take the sun and its
// shadow, the sky's light, the lamps, the haze and the mountain's baked light
// exactly as the ground they stand on does.
//
// What is added to the standard material, and why:
//
//  THE CROWN AS ONE BODY. A leaf is not lit by its card's facing but through
//    the crown it is part of: each leaf card carries its BENT NORMAL, the
//    direction most of its light comes from, and how OPEN it is (worked out
//    from the crown's shape when the tree is grown, treeGeometry.js). A light
//    reaches the leaf in full from inside the cone of open sky round its bent
//    normal and less and less from outside it (crownLets): the lit side of a
//    crown is bright, its far side and its inside are dark, and the dark
//    inside shows between the leaves of the outside, whichever way the sun
//    stands. The sky's light comes in along the bent normal, by how open the
//    leaf is.
//  A LEAF HAS TWO FACES. Each card is lit on one face (how squarely, by its
//    own facing, a little); the eye sees that face, or, from the other side,
//    the light that has come THROUGH the leaf: deeper in colour, and with the
//    sun behind a crown it is what makes its rim and every leaf in a gap glow.
//    Sunlight that has been through several leaves on its way reaches a little
//    of everything (the rust in a turned crown's shade). The lit face has a
//    faint sheen. Bark gets its relief from a normal map, with the tangents
//    worked out from screen derivatives.
//  WIND, in the vertex shader, from update()'s clock only: the tree bends from
//    its foot (more at the top), each branch swings with its own phase, the
//    tips of fronds and leaves flutter, and gusts travel across the forest.
//  COVERAGE. Where the scene target is multisampled the foliage's alpha becomes
//    coverage (soft, stable edges at any distance), and two levels of detail
//    that swap cross-fade by coverage (aTint.a: the share of it each shows).
//    Where it is not (the low tier), a plain cut against the atlas's
//    coverage-preserving mips and a hard swap. Never a hashed or dithered
//    pattern: under the motion blur it would smear into noise.
//  WET. After rain the bark is darker and both bark and leaves are smoother:
//    a sheen under the lamps and the evening sky.
//
// An impostor card is shaded by the same code: its colour and what it covers,
// its bent normal (in the tree's own frame), how open it is and what is bark
// come from the atlases that impostors.js bakes, blended between the pictures
// taken nearest to the direction it is seen from. A picture has no card
// facings: where the mesh asks which face of a leaf the eye sees, the impostor
// takes the share of leaves that would show their far face.

import * as THREE from 'three';
import { ALPHA_CUT } from './forestTextures.js';
import { extend, withBake } from './shading.js';
import { SWAY_MAX } from './treeGeometry.js';

/** How much of the sun's light gets about inside a crown from leaf to leaf (TREE_GLOW). */
const SCATTER = '0.4';

/**
 * After the alpha test: the share of its coverage this level of detail shows (|aTint.a|) and this card shows
 * (treeShows: a leaf card seen edge-on goes), by coverage where the target is multisampled, else all or nothing.
 */
const FADE = /* glsl */ `
#include <alphatest_fragment>
{
  float share = abs( vTint.a ) * treeShows;
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a *= share;
    if ( diffuseColor.a <= 0.0 ) discard;
  #else
    if ( share < 0.5 ) discard;
  #endif
}
`;

/** Declarations the wind needs (vertex stage). */
const WIND_PARS = /* glsl */ `
attribute vec4 aWind;
uniform float uTime;
uniform vec4 uWind;   // xy: the direction it blows towards, z: its strength, w: unused
`;

/**
 * Moves `transformed` (a tree's vertex in its own frame) with the wind. The motion is worked out in the world's
 * frame and taken back into the tree's, which is turned, leaned and scaled by its instance matrix.
 */
const WIND_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
{
  vec3 root = instanceMatrix[ 3 ].xyz;
  mat3 im = mat3( instanceMatrix );
  // gusts: a pattern that travels downwind, crossed by a slower one
  float along = dot( root.xz, uWind.xy );
  float across = dot( root.xz, vec2( - uWind.y, uWind.x ) );
  float gust = sin( along * 0.023 - uTime * 0.85 + 1.7 * sin( across * 0.011 + uTime * 0.19 ) ) * sin( across * 0.017 + along * 0.005 + uTime * 0.31 );
  gust = uWind.z * ( 0.55 + 0.45 * gust );
  float ph = fract( sin( dot( root.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;
  // the whole tree: a steady lean downwind and a swing about it, growing with the square of the height
  float hgt = max( position.y, 0.0 ) * length( im[ 1 ] );
  float swing = 0.4 + 0.6 * sin( uTime * 1.25 + ph ) + 0.25 * sin( uTime * 2.37 + ph * 1.7 );
  vec3 move = vec3( uWind.x, 0.0, uWind.y ) * ( hgt * hgt * 0.00042 * gust * swing );
  // its branch: up and down and with the wind, each at its own phase
  float sway = aWind.x * ${SWAY_MAX.toFixed(2)};
  float bp = aWind.y * 6.2831853 + ph;
  float bob = 0.7 * sin( uTime * ( 1.6 + aWind.y ) + bp ) + 0.3 * sin( uTime * 3.3 + bp * 1.3 );
  move += ( vec3( uWind.x, 0.0, uWind.y ) * ( 0.35 + 0.65 * bob ) + vec3( 0.0, 0.55 * bob, 0.0 ) ) * ( sway * gust );
  // the tips: a quick small shiver
  float shiver = sin( uTime * 7.3 + bp * 3.0 + position.y * 2.1 + position.x * 1.7 ) + sin( uTime * 11.1 + position.z * 2.3 + bp );
  move += vec3( 0.3, 1.0, 0.3 ) * ( aWind.z * shiver * 0.012 * gust );
  transformed += ( move * im ) / vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
}
#endif
`;

/** Fragment declarations shared by the mesh and the impostor. */
const TREE_PARS = /* glsl */ `
varying vec4 vTint;
uniform float uWet;
float treeBark = 0.0;      // 1 on bark
float treeThrough = -1.0;  // on a leaf: how much light it lets through, 0..1; below 0: not a leaf
float treeGloss = 1.0;     // what is left of the speculars
float treeOpen = 1.0;      // how open the crown is at this leaf, 0..1
float treeCards = 1.0;     // 1: this is a leaf card with a facing of its own; 0: a picture of many (the impostor)
float treeShows = 1.0;     // what is left of a leaf card seen edge-on (it would be a streak of squeezed leaves)
vec3 treeBack = vec3( 0.0 );                 // the colour of light that has come through a leaf
vec3 treeBump = vec3( 0.0, 0.0, 1.0 );       // the bark's relief
vec3 treeBent = vec3( 0.0, 0.0, 1.0 );       // the leaf's bent normal, view space
vec3 treeCard = vec3( 0.0, 0.0, 1.0 );       // the card's own facing, towards the eye, view space
`;

/** Wraps the standard material's light function: a leaf is lit through its crown, on one of its two faces. */
const TREE_LIGHT = /* glsl */ `
// How much of a light from L reaches this leaf through its crown: all of it from inside the cone of open sky round
// the bent normal (wide for a leaf on the outside, a chink for one inside), fading over soft outside it.
float crownLets( vec3 L, float soft ) {
  float edge = mix( 0.92, - 0.25, treeOpen );
  return smoothstep( edge - soft, edge + soft, dot( treeBent, L ) ) * ( 0.12 + 0.88 * treeOpen );
}
// The share of leaves that show the eye their far face, seen from V and lit (or open) from L.
float farFace( vec3 V, vec3 L, float own ) {
  return mix( acos( clamp( dot( V, L ), - 1.0, 1.0 ) ) * RECIPROCAL_PI, smoothstep( 0.1, - 0.1, own ), treeCards );
}
void RE_Direct_Tree( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( treeThrough < 0.0 ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    return;
  }
  vec3 L = directLight.direction;
  IncidentLight lit = directLight;
  lit.color *= crownLets( L, 0.35 );
  float own = dot( treeCard, L );
  float far = farFace( geometryViewDir, L, own );
  // (leaves stand every way: half of the light falls on them on average; a card's own facing counts for a part)
  float square = mix( 0.5, abs( own ), 0.4 * treeCards );
  reflectedLight.directDiffuse += lit.color * mix( material.diffuseContribution, treeBack * treeThrough, far ) * ( square * RECIPROCAL_PI );
  // the sheen of the lit face
  PhysicalMaterial sheen = material;
  sheen.diffuseContribution = vec3( 0.0 );
  lit.color *= 1.0 - far;
  RE_Direct_Physical( lit, geometryPosition, treeCard, geometryViewDir, geometryClearcoatNormal, sheen, reflectedLight );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Tree
`;

/** After the lights: sunlight that has been through several leaves, and what the sky's light finds. */
const TREE_GLOW = /* glsl */ `
if ( treeThrough >= 0.0 ) {
  #if NUM_DIR_LIGHTS > 0
  // sunlight that has been passed on from leaf to leaf: it gets where the sun itself does not, and keeps the shade
  // inside a crown the crown's own colour
  reflectedLight.directDiffuse += directionalLights[ 0 ].color * bakedSun() * material.diffuseContribution * ( crownLets( directionalLights[ 0 ].direction, 1.3 ) * ( 0.4 + 0.6 * treeThrough ) * TREE_SCATTER * RECIPROCAL_PI );
  #endif
  // the sky's light comes in along the bent normal; a leaf seen from its far face shows the sky through it
  float skyFar = farFace( geometryViewDir, treeBent, dot( treeCard, treeBent ) );
  material.diffuseContribution = mix( material.diffuseContribution, treeBack * treeThrough, skyFar ) * ( 0.08 + 0.92 * treeOpen * treeOpen );
}
reflectedLight.directSpecular *= treeGloss;
`;

/** What a leaf lets through is its own colour, deepened. */
const TREE_BACK = /* glsl */ `
{
  vec3 c = diffuseColor.rgb;
  float top = max( max( c.r, c.g ), c.b ) + 1.0e-4;
  treeBack = c * mix( vec3( 1.0 ), c / top, 0.25 ) * 1.35;
}
`;

/** Bark's relief (treeBump) laid on `normal`, with tangents from the screen's derivatives; a leaf card's own facing. */
const TREE_NORMAL = /* glsl */ `
  vec3 q0 = dFdx( - vViewPosition );
  vec3 q1 = dFdy( - vViewPosition );
  if ( treeBark > 0.5 ) {
    vec2 st0 = dFdx( vMapUv );
    vec2 st1 = dFdy( vMapUv );
    vec3 q1perp = cross( q1, normal );
    vec3 q0perp = cross( normal, q0 );
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max( dot( T, T ), dot( B, B ) );
    float sc = det == 0.0 ? 0.0 : inversesqrt( det );
    normal = normalize( T * ( treeBump.x * sc ) + B * ( treeBump.y * sc ) + normal * treeBump.z );
  } else {
    treeBent = normal;
  }
`;

// ---- the small plants under the trees keep the simpler model they were tuned with: one soft body, light through it

/** Fragment declarations of the plants. */
const PLANT_PARS = /* glsl */ `
varying vec4 vTint;
uniform float uWet;
float treeThrough = 0.0;   // how much light comes through from behind
float treeGloss = 1.0;     // what is left of the speculars
float treeShows = 1.0;
vec3 treeBack = vec3( 0.0 );                 // the colour of light that has come through a leaf
vec3 treeCrown = vec3( 0.0, 0.0, 1.0 );      // the plant's own normal, view space
`;

/** Wraps the standard material's light function: the same light, plus what comes through the leaves. */
const PLANT_LIGHT = /* glsl */ `
void RE_Direct_Plant( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( treeThrough > 0.0 ) {
    float nl = dot( treeCrown, directLight.direction );
    // a plant is not a wall: light gets a little way round it and into it
    float wrap = clamp( ( nl + 0.5 ) / 1.5, 0.0, 1.0 ) - 0.667 * clamp( nl, 0.0, 1.0 );
    // and the eye that looks towards the light sees it through the leaves, most where the plant is thin
    float behind = pow( clamp( dot( geometryViewDir, - directLight.direction ), 0.0, 1.0 ), 3.0 );
    float rim = 1.0 - abs( dot( treeCrown, geometryViewDir ) );
    reflectedLight.directDiffuse += directLight.color * treeBack * ( ( 0.45 * wrap + 1.5 * behind * ( 0.3 + 0.7 * rim ) ) * treeThrough * RECIPROCAL_PI );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Plant
`;

/** After the lights: the sun through the whole plant, and the sky behind it. */
const PLANT_GLOW = /* glsl */ `
if ( treeThrough > 0.0 ) {
  float glowRim = 1.0 - abs( dot( treeCrown, geometryViewDir ) );
  #if NUM_DIR_LIGHTS > 0
  {
    float behind = pow( clamp( dot( geometryViewDir, - directionalLights[ 0 ].direction ), 0.0, 1.0 ), 2.0 );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * bakedSun() * treeBack * treeBack * ( behind * ( 0.3 + 0.7 * glowRim ) * treeThrough * 1.6 * RECIPROCAL_PI );
  }
  #endif
  #ifdef USE_ENVMAP
  // the sky behind the plant, and the sky above it, seen through the leaves
  reflectedLight.indirectDiffuse += ( getIBLIrradiance( - geometryViewDir ) * ( 0.3 + 0.7 * glowRim * glowRim ) + 0.12 * getIBLIrradiance( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) * treeBack * ( treeThrough * 1.0 * RECIPROCAL_PI );
  #endif
}
reflectedLight.directSpecular *= treeGloss;
`;

/** What a plant's leaf lets through is its own colour, deepened. */
const PLANT_BACK = /* glsl */ `
{
  vec3 c = diffuseColor.rgb;
  float top = max( max( c.r, c.g ), c.b ) + 1.0e-4;
  treeBack = c * mix( vec3( 1.0 ), c / top, 0.55 ) * 1.7;
}
`;

/**
 * @typedef {object} TreeUniforms shared by every material here
 * @property {{ value: number }} uTime @property {{ value: THREE.Vector4 }} uWind
 * @property {{ value: number }} uWet
 */

/** @returns {TreeUniforms} */
export function createTreeUniforms() {
  return { uTime: { value: 0 }, uWind: { value: new THREE.Vector4(0.8, 0.6, 1, 0) }, uWet: { value: 0 } };
}

/**
 * The material of the tree meshes (full and reduced), and of anything else built with their vertex layout.
 * @param {object} o
 * @param {THREE.Texture} o.foliage the foliage atlas @param {THREE.Texture} o.bark @param {THREE.Texture} o.barkNormal
 * @param {import('./atmosphere.js').Atmosphere} o.atmosphere @param {TreeUniforms} o.uniforms
 * @param {boolean} o.coverage the scene target is multisampled: alpha becomes coverage
 * @param {boolean} o.wind
 */
export function treeMaterial({ foliage, bark, barkNormal, atmosphere, uniforms, coverage, wind }) {
  const material = withBake(
    new THREE.MeshStandardMaterial({ map: foliage, alphaTest: ALPHA_CUT, alphaToCoverage: coverage, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 }),
  );
  material.name = 'tree';
  material.defines.TREE_SCATTER = SCATTER;
  const own = { uBark: { value: bark }, uBarkN: { value: barkNormal } };
  extend(material, `tree-${wind ? 'w' : 's'}${coverage ? 'c' : 'd'}`, (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aShade;\nattribute vec4 aTint;\nattribute vec2 aPlace;\nvarying vec4 vShade;\nvarying vec4 vTint;\nvarying float vTurn;\nvarying float vEdge;\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvShade = aShade;\nvTint = aTint;\nvTurn = aPlace.y;\nvEdge = aWind.w;\n${wind ? WIND_VERTEX : ''}`)
      // inside the wood the lower part of a tree stands in the others' shade: less of the sky, less of the sun
      .replace('#include <project_vertex>', `vBake *= mix( 1.0 - 0.8 * aPlace.x, 1.0, smoothstep( 1.5, 9.0, position.y ) );\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vShade;\nvarying float vTurn;\nvarying float vEdge;\nuniform sampler2D uBark;\nuniform sampler2D uBarkN;\n${TREE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TREE_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
  treeBark = step( 0.75, vShade.y );
  vec4 tex;
  if ( treeBark > 0.5 ) {
    // (vShade.z: how pale this tree's bark is; vShade.x: the crown's shade on the limb)
    tex = vec4( texture2D( uBark, vMapUv ).rgb * ( ( 0.3 + 1.4 * vShade.z ) * ( 0.72 - 0.3 * uWet ) * vShade.x ), 1.0 );
    treeBump = texture2D( uBarkN, vMapUv ).xyz * 2.0 - 1.0;
    treeGloss = 0.7;
  } else {
    tex = texture2D( map, vMapUv );
    // where on its own scale this card's colour lies: a green crown strays a little towards yellow (new growth) or
    // blue-green; a turned one a little along from gold to red
    float h = ( vShade.z - 0.5 ) * 2.0;
    vec3 shift = mix( vec3( 0.08, 0.04, -0.15 ), vec3( 0.04, -0.09, -0.15 ), vTurn );
    vec3 tint = vTint.rgb * max( vec3( 0.2 ), 1.0 + shift * h ) * ( 1.0 + 0.06 * h );
    // (a dead twig keeps its own colour)
    tex.rgb *= mix( tint, vec3( 0.55 ), step( 0.25, vShade.y ) );
    treeThrough = vShade.w;
    treeOpen = vShade.x;
    treeGloss = vShade.x * ( 0.25 + 0.75 * uWet );
    // the card's own facing; seen edge-on it goes
    treeCard = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
    float towards = dot( treeCard, normalize( vViewPosition ) );
    if ( towards < 0.0 ) treeCard = - treeCard;
    treeShows = mix( 1.0, smoothstep( 0.05, 0.28, abs( towards ) ), vEdge );
  }
  diffuseColor *= tex;
}
${TREE_BACK}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = treeBark > 0.5 ? mix( 0.92, 0.55, uWet ) : mix( 0.6, 0.38, uWet );')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
{
${TREE_NORMAL}
}
vec3 nonPerturbedNormal = normal;`,
      )
      .replace('#include <lights_fragment_maps>', `${TREE_GLOW}\n#include <lights_fragment_maps>`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= treeGloss;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', FADE);
  });
  return atmosphere.patch(material);
}

/** The impostors' declarations (both stages). */
const IMP_PARS = /* glsl */ `
uniform vec4 uImpA[ IMP_VARIANTS ];   // per variant: the uv of its level strip's first picture (xy), the size of a picture (zw)
uniform vec4 uImpB[ IMP_VARIANTS ];   // the same for its raised strip
uniform vec4 uImpC[ IMP_VARIANTS ];   // the frame of its pictures in the tree's own metres: half width, bottom, top; w: the lookups' inset
varying vec4 vImpCell;   // xy: where in the picture (0..1), z: the variant, w: how much light the species lets through
varying vec4 vImpIdx;    // the numbers of the two pictures of each ring that the direction lies between
varying vec3 vImpMix;    // how far between them (level ring, raised ring), and how far from the level ring to the raised one
varying vec3 vImpX;      // the tree's own x and y axes in view space: its normals are turned with them
varying vec3 vImpY;
`;

/** Turns the card to the eye (or, under an orthographic camera such as the sun's, to the light) and picks its pictures. */
const IMP_CARD = /* glsl */ `{
  // the tree's frame in the world (the mesh may stand in a parent of its own)
  mat4 wm = modelMatrix * instanceMatrix;
  mat3 im = mat3( wm );
  vec3 ax = normalize( im[ 0 ] );
  vec3 ay = normalize( im[ 1 ] );
  vec3 az = normalize( im[ 2 ] );
  int iv = int( aImp.x + 0.5 );
  vec4 box = uImpC[ iv ];
  // towards the eye from the middle of the tree, in the tree's own frame
  vec3 toEye = isOrthographic ? vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] ) : cameraPosition - ( wm[ 3 ].xyz + im[ 1 ] * ( 0.5 * box.z ) );
  vec3 e = normalize( vec3( dot( toEye, ax ), dot( toEye, ay ), dot( toEye, az ) ) );
  vec2 level = normalize( e.xz + vec2( 0.0, 1.0e-5 ) );
  // the card stands on the tree's axis, square to the eye's level direction
  transformed = vec3( level.y, 0.0, - level.x ) * ( position.x * box.x ) + vec3( 0.0, mix( box.y, box.z, position.y ), 0.0 );
  float f0 = fract( atan( e.x, e.z ) / 6.2831853 + 1.0 ) * IMP_VIEWS;
  vImpIdx.xy = vec2( floor( f0 ), mod( floor( f0 ) + 1.0, IMP_VIEWS ) );
  vImpIdx.zw = vImpIdx.xy;
  vImpMix = vec3( fract( f0 ), fract( f0 ), 0.0 );
  #if IMP_ROWS > 1
    vImpMix.z = clamp( asin( clamp( e.y, - 1.0, 1.0 ) ) / IMP_ELEV, 0.0, 1.0 );
  #endif
  vImpCell = vec4( position.x * 0.5 + 0.5, 1.0 - position.y, aImp.x, aImp.y );
  vImpX = mat3( viewMatrix ) * ax;
  vImpY = mat3( viewMatrix ) * ay;
}`;

/**
 * Reads the pictures: `colour` (premultiplied; a: what is covered) and `shape`, each blended between the two pictures
 * nearest in turn and, where there are raised ones, the two rings.
 */
const IMP_READ = /* glsl */ `
  int iv = int( vImpCell.z + 0.5 );
  vec4 strip = uImpA[ iv ];
  vec2 inCell = mix( vec2( uImpC[ iv ].w ), vec2( 1.0 - uImpC[ iv ].w ), clamp( vImpCell.xy, 0.0, 1.0 ) );
  #define IMP_UV( strip, n ) ( strip.xy + vec2( ( n ) + inCell.x, inCell.y ) * strip.zw )
  // (a sharper mip than the screen's footprint asks for: the leaves stay leaves; coverage keeps the edges clean)
  vec4 colour = mix( texture2D( uImpColor, IMP_UV( strip, vImpIdx.x ), IMP_BIAS ), texture2D( uImpColor, IMP_UV( strip, vImpIdx.y ), IMP_BIAS ), vImpMix.x );
  #ifdef IMP_SHAPE
  vec4 shape = mix( texture2D( uImpShape, IMP_UV( strip, vImpIdx.x ), IMP_BIAS ), texture2D( uImpShape, IMP_UV( strip, vImpIdx.y ), IMP_BIAS ), vImpMix.x );
  #endif
  #if IMP_ROWS > 1
  if ( vImpMix.z > 0.004 ) {
    strip = uImpB[ iv ];
    colour = mix( colour, mix( texture2D( uImpColor, IMP_UV( strip, vImpIdx.z ), IMP_BIAS ), texture2D( uImpColor, IMP_UV( strip, vImpIdx.w ), IMP_BIAS ), vImpMix.y ), vImpMix.z );
    #ifdef IMP_SHAPE
    shape = mix( shape, mix( texture2D( uImpShape, IMP_UV( strip, vImpIdx.z ), IMP_BIAS ), texture2D( uImpShape, IMP_UV( strip, vImpIdx.w ), IMP_BIAS ), vImpMix.y ), vImpMix.z );
    #endif
  }
  #endif
`;

/**
 * The material of the impostor cards: a card per far tree, upright in the tree's own frame and turned to the eye,
 * showing the atlas pictures taken nearest to the direction it is seen from.
 * @param {object} o
 * @param {import('./impostors.js').ImpostorAtlas} o.atlas
 * @param {import('./atmosphere.js').Atmosphere} o.atmosphere @param {TreeUniforms} o.uniforms @param {boolean} o.coverage
 */
export function impostorMaterial({ atlas, atmosphere, uniforms, coverage }) {
  const material = withBake(new THREE.MeshStandardMaterial({ alphaToCoverage: coverage, side: THREE.DoubleSide, flatShading: true, roughness: 0.7, metalness: 0 }));
  material.name = 'tree-impostor';
  Object.assign(material.defines, impostorDefines(atlas), { IMP_SHAPE: 1, TREE_SCATTER: SCATTER });
  const own = impostorUniforms(atlas);
  extend(material, `tree-imp-${coverage ? 'c' : 'd'}`, (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aTint;\nattribute vec2 aPlace;\nattribute vec4 aImp;\nvarying vec4 vTint;\nvarying float vTurn;\n${IMP_PARS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `vec3 transformed;
vTint = aTint;
vTurn = aPlace.y;
${IMP_CARD}`,
      )
      .replace('#include <project_vertex>', `vBake *= mix( 1.0 - 0.8 * aPlace.x, 1.0, smoothstep( 1.5, 9.0, transformed.y ) );\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uImpColor;\nuniform sampler2D uImpShape;\nvarying float vTurn;\n${IMP_PARS}\n${TREE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TREE_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
${IMP_READ}
  // between two pictures a silhouette is half there: that becomes half coverage, or a cut where there is none
  float cover = colour.a;
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a = clamp( ( cover - 0.15 ) / 0.6, 0.0, 1.0 );
    if ( diffuseColor.a <= 0.0 ) discard;
  #else
    if ( cover < 0.42 ) discard;
  #endif
  colour.rgb /= cover;
  // the shape atlas's alpha: 0.04 to 0.24 bark, 0.3 to 1 a leaf, by the light that gets there (a leaf's as a root)
  float leaf = smoothstep( 0.24, 0.3, shape.a );
  treeBump = shape.xyz * 2.0 - 1.0;
  treeBark = 1.0 - leaf;
  treeThrough = leaf > 0.5 ? vImpCell.w : - 1.0;
  treeOpen = clamp( ( shape.a - 0.3 ) / 0.7, 0.0, 1.0 );
  treeOpen *= treeOpen;
  treeCards = 0.0;
  treeGloss = leaf * treeOpen * 0.6 * ( 0.25 + 0.75 * uWet ) + ( 1.0 - leaf ) * 0.7;
  diffuseColor.rgb *= colour.rgb * mix( vec3( 1.0 ), vTint.rgb, leaf );
}
${TREE_BACK}`,
      )
      .replace('#include <alphatest_fragment>', FADE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix( mix( 0.6, 0.38, uWet ), mix( 0.92, 0.55, uWet ), treeBark );')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `float faceDirection = 1.0;
vec3 impN = normalize( treeBump );
vec3 normal = normalize( vImpX * impN.x + vImpY * impN.y + cross( vImpX, vImpY ) * impN.z );
treeBent = normal;
treeCard = normal;
vec3 nonPerturbedNormal = normal;`,
      )
      .replace('#include <lights_fragment_maps>', `${TREE_GLOW}\n#include <lights_fragment_maps>`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= treeGloss;');
  });
  return atmosphere.patch(material);
}

/** The impostor shaders' constants for an atlas. */
const impostorDefines = (atlas) => ({ IMP_VARIANTS: atlas.variants, IMP_ROWS: atlas.rows, IMP_VIEWS: atlas.views.toFixed(1), IMP_ELEV: atlas.elevation.toFixed(4), IMP_BIAS: '-0.75' });
const impostorUniforms = (atlas) => ({
  uImpColor: { value: atlas.color },
  uImpShape: { value: atlas.shape },
  uImpA: { value: atlas.level },
  uImpB: { value: atlas.raised },
  uImpC: { value: atlas.boxes },
});

/**
 * What the trees are drawn with into a shadow map: the same wind, the foliage's holes, solid bark.
 * @param {TreeUniforms} uniforms @param {boolean} wind @param {THREE.Texture} foliage the foliage atlas
 */
export function treeDepthMaterial(uniforms, wind, foliage) {
  const material = new THREE.MeshDepthMaterial({ map: foliage, alphaTest: ALPHA_CUT, side: THREE.DoubleSide });
  material.name = 'tree-depth';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aShade;\nvarying float vBarkDepth;\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBarkDepth = aShade.y;\n${wind ? WIND_VERTEX : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBarkDepth;')
      // (bark's texture coordinates are not the foliage atlas's: it is simply solid)
      .replace('#include <map_fragment>', '#include <map_fragment>\nif ( vBarkDepth > 0.75 ) diffuseColor.a = 1.0;');
  };
  material.customProgramCacheKey = () => `tree-depth-${wind ? 'w' : 's'}`;
  return material;
}

/**
 * The impostor cards in a shadow map: under the sun's orthographic camera each card turns to the light and casts the
 * crown's silhouette as seen from there (holes and all): the shade of a whole tree for two triangles.
 * @param {import('./impostors.js').ImpostorAtlas} atlas
 */
export function impostorDepthMaterial(atlas) {
  const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  material.name = 'tree-impostor-depth';
  material.defines = impostorDefines(atlas);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, impostorUniforms(atlas));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aImp;\n${IMP_PARS}`)
      .replace('#include <begin_vertex>', `vec3 transformed;\n${IMP_CARD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uImpColor;\n${IMP_PARS}`)
      .replace('#include <map_fragment>', `{\n${IMP_READ}\n  if ( colour.a < 0.4 ) discard;\n}`);
  };
  material.customProgramCacheKey = () => 'tree-impostor-depth';
  return material;
}

const NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

/**
 * The material of the small things that grow and lie under the trees (grass, ferns, bushes, rocks): a standard
 * material whose instances carry aTint (rgb: the albedo it is tinted to; a: the dissolve) and aBake, and whose
 * vertices carry aShade (x: occlusion, y: 1 where the texture's own colour is kept).
 * @param {object} o
 * @param {THREE.Texture|null} o.map
 * @param {import('./atmosphere.js').Atmosphere} o.atmosphere @param {TreeUniforms} o.uniforms
 * @param {{ height: number, sway: number }|null} o.wind the height over which the plant sways (m) and how far its
 *   top goes (m); null: still
 * @param {number} [o.through] 0..1 how much light its leaves let through
 * @param {boolean} [o.coverage] alpha becomes coverage (a multisampled scene target)
 * @param {boolean} [o.flat] faceted (the rocks)
 */
export function plantMaterial({ map, atmosphere, uniforms, wind, through = 0, coverage = false, flat = false }) {
  const material = withBake(
    new THREE.MeshStandardMaterial({
      map,
      alphaTest: map ? ALPHA_CUT : 0,
      alphaToCoverage: !!map && coverage,
      side: map ? THREE.DoubleSide : THREE.FrontSide,
      roughness: 0.9,
      metalness: 0,
      flatShading: flat,
    }),
  );
  if (wind) Object.assign(material.defines, { PLANT_WIND: 1, WIND_H: wind.height.toFixed(2), WIND_SWAY: wind.sway.toFixed(3) });
  extend(material, `plant-${through}-${coverage ? 'c' : 'd'}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aShade;\nattribute vec4 aTint;\nvarying vec2 vShade;\nvarying vec4 vTint;\nuniform float uTime;\nuniform vec4 uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
vShade = aShade;
vTint = aTint;
#if defined( PLANT_WIND ) && defined( USE_INSTANCING )
{
  vec3 root = instanceMatrix[ 3 ].xyz;
  float ph = dot( root.xz, vec2( 0.37, 0.71 ) );
  float gust = uWind.z * ( 0.6 + 0.4 * sin( dot( root.xz, uWind.xy ) * 0.023 - uTime * 0.85 ) );
  float h = max( position.y, 0.0 ) / WIND_H;
  float sway = 0.4 + sin( uTime * 1.9 + ph ) * 0.6 + sin( uTime * 4.3 + ph * 1.7 ) * 0.25;
  mat3 im = mat3( instanceMatrix );
  vec3 move = vec3( uWind.x, 0.0, uWind.y ) * ( h * h * sway * gust * WIND_SWAY );
  transformed += ( move * im ) / vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
}
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vShade;\n${PLANT_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${PLANT_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
{
  diffuseColor.rgb *= mix( vTint.rgb, vec3( 1.0 ), vShade.y ) * vShade.x;
  treeThrough = ${through.toFixed(2)} * ( 1.0 - vShade.y );
  treeGloss = 0.3 + 0.5 * uWet;
}
${PLANT_BACK}`,
      )
      .replace('#include <lights_fragment_maps>', `${PLANT_GLOW}\n#include <lights_fragment_maps>`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= treeGloss;');
    // the normal its vertices carry is the ground's (or the plant's as a whole), the same on both sides of a card
    if (map) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `${NORMAL_BEGIN}\ntreeCrown = normal;`);
    else shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\ntreeCrown = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', FADE);
  });
  return atmosphere.patch(material);
}
