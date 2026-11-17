// How everything that grows is shaded. Three materials for the trees (the
// meshes, the impostor cards, the shadow pass) and one for the small things
// under them, all standard materials underneath, so they take the sun and its
// shadow, the sky's light, the lamps, the haze and the mountain's baked light
// exactly as the ground they stand on does.
//
// What is added to the standard material, and why:
//
//  THE CROWN AS ONE BODY. Foliage is lit with the normal its vertex carries,
//    which points out of the crown and not out of the card (treeGeometry.js),
//    with a little of the card's own facing mixed in so that single fronds
//    still catch the light differently. Bark gets its relief from a normal map,
//    with the tangents worked out from screen derivatives.
//  LIGHT THROUGH THE LEAVES. A leaf lit from behind is brighter than one lit
//    from the front, and deeper in colour. Three terms, all scaled by how much
//    light the species lets through and how thin the crown is where the eye
//    looks (thin at its rim): every lamp and the sun, as seen through the
//    leaves when the eye looks towards them (shadowed like any light); the
//    sun's light that has crossed the whole crown (deeper in colour; it is not
//    cut off by the crown's own shadow, which a real crown only half casts on
//    itself); and the sky that stands behind the crown, which is what makes an
//    autumn tree glow against the evening.
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
// An impostor card is shaded by the same code: its colour, alpha, normal (in
// the tree's own frame) and what-is-foliage mask come from the atlas that
// impostors.js bakes, blended between the pictures taken nearest to the
// direction it is seen from.

import * as THREE from 'three';
import { ALPHA_CUT } from './forestTextures.js';
import { extend, withBake } from './shading.js';
import { SWAY_MAX } from './treeGeometry.js';

/**
 * After the alpha test: the share of its coverage this level of detail shows (|aTint.a|), by coverage where the
 * target is multisampled, else all or nothing.
 */
const FADE = /* glsl */ `
#include <alphatest_fragment>
{
  float share = abs( vTint.a );
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
float treeThrough = 0.0;   // how much light comes through from behind
float treeGloss = 1.0;     // what is left of the speculars
vec3 treeBack = vec3( 0.0 );                 // the colour of light that has come through a leaf
vec3 treeBump = vec3( 0.0, 0.0, 1.0 );       // the bark's relief, or the impostor's normal in the tree's frame
vec3 treeCrown = vec3( 0.0, 0.0, 1.0 );      // the crown's own normal, view space
`;


/**
 * Light and shade inside a crown carry its colour: in its shade a green crown goes towards a deep blue-green and a
 * turned one towards rust; where the light reaches it, towards yellow-green or pale gold. `lit` 0..1 is how much
 * light gets in there (aShade.x), `turn` how far the tree has turned.
 */
const CROWN_TONE = /* glsl */ `
vec3 crownTone( float lit, float turn ) {
  vec3 shade = mix( vec3( 0.78, 0.92, 1.12 ), vec3( 1.15, 0.72, 0.6 ), turn );
  vec3 light = mix( vec3( 1.12, 1.06, 0.78 ), vec3( 1.0, 1.08, 0.85 ), turn );
  return mix( shade, light, smoothstep( 0.2, 0.95, lit ) );
}
`;

/** Wraps the standard material's light function: the same light, plus what comes through the leaves. */
const TREE_LIGHT = /* glsl */ `
void RE_Direct_Tree( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( treeThrough > 0.0 ) {
    float nl = dot( treeCrown, directLight.direction );
    // a crown is not a wall: light gets a little way round it and into it
    float wrap = clamp( ( nl + 0.5 ) / 1.5, 0.0, 1.0 ) - 0.667 * clamp( nl, 0.0, 1.0 );
    // and the eye that looks towards the light sees it through the leaves, most where the crown is thin
    float behind = pow( clamp( dot( geometryViewDir, - directLight.direction ), 0.0, 1.0 ), 3.0 );
    float rim = 1.0 - abs( dot( treeCrown, geometryViewDir ) );
    reflectedLight.directDiffuse += directLight.color * treeBack * ( ( 0.45 * wrap + 1.5 * behind * ( 0.3 + 0.7 * rim ) ) * treeThrough * RECIPROCAL_PI );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Tree
`;

/** After the lights: the sun through the whole crown, and the sky behind it. */
const TREE_GLOW = /* glsl */ `
if ( treeThrough > 0.0 ) {
  float glowRim = 1.0 - abs( dot( treeCrown, geometryViewDir ) );
  #if NUM_DIR_LIGHTS > 0
  {
    float behind = pow( clamp( dot( geometryViewDir, - directionalLights[ 0 ].direction ), 0.0, 1.0 ), 2.0 );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * bakedSun() * treeBack * treeBack * ( behind * ( 0.3 + 0.7 * glowRim ) * treeThrough * 1.6 * RECIPROCAL_PI );
  }
  #endif
  #ifdef USE_ENVMAP
  // the sky behind the crown, and the sky above it, seen through the leaves
  reflectedLight.indirectDiffuse += ( getIBLIrradiance( - geometryViewDir ) * ( 0.3 + 0.7 * glowRim * glowRim ) + 0.12 * getIBLIrradiance( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) * treeBack * ( treeThrough * 1.0 * RECIPROCAL_PI );
  #endif
}
reflectedLight.directSpecular *= treeGloss;
`;

/** What a leaf lets through is its own colour, deepened. */
const TREE_BACK = /* glsl */ `
{
  vec3 c = diffuseColor.rgb;
  float top = max( max( c.r, c.g ), c.b ) + 1.0e-4;
  treeBack = c * mix( vec3( 1.0 ), c / top, 0.55 ) * 1.7;
}
`;

/** Bark's relief (treeBump) laid on `normal`, with tangents from the screen's derivatives of position and uv. */
const BARK_NORMAL = /* glsl */ `
  vec3 q0 = dFdx( - vViewPosition );
  vec3 q1 = dFdy( - vViewPosition );
  vec2 st0 = dFdx( vMapUv );
  vec2 st1 = dFdy( vMapUv );
  if ( treeBark > 0.5 ) {
    vec3 q1perp = cross( q1, normal );
    vec3 q0perp = cross( normal, q0 );
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max( dot( T, T ), dot( B, B ) );
    float sc = det == 0.0 ? 0.0 : inversesqrt( det );
    normal = normalize( T * ( treeBump.x * sc ) + B * ( treeBump.y * sc ) + normal * treeBump.z );
  } else {
    // a little of the card's own facing, turned to the eye, so that fronds differ from one another
    vec3 flatN = normalize( cross( q0, q1 ) );
    if ( flatN.z < 0.0 ) flatN = - flatN;
    normal = normalize( normal + flatN * 0.3 );
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
  const own = { uBark: { value: bark }, uBarkN: { value: barkNormal } };
  extend(material, `tree-${wind ? 'w' : 's'}${coverage ? 'c' : 'd'}`, (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aShade;\nattribute vec4 aTint;\nattribute vec2 aPlace;\nvarying vec4 vShade;\nvarying vec4 vTint;\nvarying float vTurn;\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvShade = aShade;\nvTint = aTint;\nvTurn = aPlace.y;\n${wind ? WIND_VERTEX : ''}`)
      // inside the wood the lower part of a tree stands in the others' shade: less of the sky, less of the sun
      .replace('#include <project_vertex>', `vBake *= mix( 1.0 - 0.8 * aPlace.x, 1.0, smoothstep( 1.5, 9.0, position.y ) );\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vShade;\nvarying float vTurn;\n${CROWN_TONE}\nuniform sampler2D uBark;\nuniform sampler2D uBarkN;\n${TREE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TREE_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
  treeBark = step( 0.75, vShade.y );
  vec4 tex;
  if ( treeBark > 0.5 ) {
    tex = vec4( texture2D( uBark, vMapUv ).rgb * ( 0.72 - 0.3 * uWet ), 1.0 );
    treeBump = texture2D( uBarkN, vMapUv ).xyz * 2.0 - 1.0;
    treeGloss = 0.7;
  } else {
    tex = texture2D( map, vMapUv );
    // where on its own scale this part of the crown lies: a green crown strays a little towards yellow (new
    // growth, the sunny side) or blue-green; a turned one far along from gold to red
    float h = ( vShade.z - 0.5 ) * 2.0;
    vec3 shift = mix( vec3( 0.1, 0.05, -0.2 ), vec3( 0.12, -0.3, -0.4 ), vTurn );
    vec3 tint = vTint.rgb * max( vec3( 0.2 ), 1.0 + shift * h ) * ( 1.0 + 0.1 * h ) * crownTone( vShade.x, vTurn );
    // (a dead twig keeps its own colour)
    tex.rgb *= mix( tint, vec3( 0.55 ), step( 0.25, vShade.y ) );
    treeThrough = vShade.w;
    treeGloss = vShade.x * ( 0.35 + 0.65 * uWet );
  }
  diffuseColor *= tex;
  diffuseColor.rgb *= mix( 1.0, pow( vShade.x, 1.3 ), 0.92 );
}
${TREE_BACK}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = treeBark > 0.5 ? mix( 0.92, 0.55, uWet ) : mix( 0.66, 0.4, uWet );')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
treeCrown = normal;
{
${BARK_NORMAL}
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
uniform vec4 uImpA[ IMP_VARIANTS ];   // per variant: the uv of its band's first cell (xy), the size of a cell (zw)
uniform vec4 uImpB[ IMP_VARIANTS ];   // cells in an atlas row, its first cell's number, pictures in the level ring and in the raised one
uniform vec4 uImpC[ IMP_VARIANTS ];   // the frame of its pictures in the tree's own metres: half width, bottom, top
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
  vec4 runs = uImpB[ iv ];
  vec4 box = uImpC[ iv ];
  // towards the eye from the middle of the tree, in the tree's own frame
  vec3 toEye = isOrthographic ? vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] ) : cameraPosition - ( wm[ 3 ].xyz + im[ 1 ] * ( 0.5 * box.z ) );
  vec3 e = normalize( vec3( dot( toEye, ax ), dot( toEye, ay ), dot( toEye, az ) ) );
  vec2 level = normalize( e.xz + vec2( 0.0, 1.0e-5 ) );
  // the card stands on the tree's axis, square to the eye's level direction
  transformed = vec3( level.y, 0.0, - level.x ) * ( position.x * box.x ) + vec3( 0.0, mix( box.y, box.z, position.y ), 0.0 );
  float turnShare = fract( atan( e.x, e.z ) / 6.2831853 + 1.0 );
  float f0 = turnShare * runs.z;
  vImpIdx.xy = runs.y + vec2( floor( f0 ), mod( floor( f0 ) + 1.0, runs.z ) );
  vImpMix = vec3( fract( f0 ), 0.0, 0.0 );
  vImpIdx.zw = vImpIdx.xy;
  #if IMP_ROWS > 1
    float f1 = turnShare * runs.w;
    vImpIdx.zw = runs.y + runs.z + vec2( floor( f1 ), mod( floor( f1 ) + 1.0, runs.w ) );
    vImpMix.y = fract( f1 );
    vImpMix.z = clamp( asin( clamp( e.y, - 1.0, 1.0 ) ) / IMP_ELEV, 0.0, 1.0 );
  #endif
  vImpCell = vec4( position.x * 0.5 + 0.5, 1.0 - position.y, aImp.x, aImp.y );
  vImpX = mat3( viewMatrix ) * ax;
  vImpY = mat3( viewMatrix ) * ay;
}`;

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
  material.defines.IMP_VARIANTS = atlas.variants;
  material.defines.IMP_ROWS = atlas.rows;
  material.defines.IMP_ELEV = atlas.elevation.toFixed(4);
  material.defines.IMP_BIAS = '-0.6';
  const own = {
    uImpColor: { value: atlas.color },
    uImpNormal: { value: atlas.normal },
    uImpA: { value: atlas.cells },
    uImpB: { value: atlas.runs },
    uImpC: { value: atlas.boxes },
    uImpInset: { value: atlas.inset },
  };
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
      .replace('#include <common>', `#include <common>\nuniform sampler2D uImpColor;\nuniform sampler2D uImpNormal;\nuniform vec2 uImpInset;\nvarying float vTurn;\n${CROWN_TONE}\n${IMP_PARS}\n${TREE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TREE_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
  int iv = int( vImpCell.z + 0.5 );
  vec4 cells = uImpA[ iv ];
  float perRow = uImpB[ iv ].x;
  // (half a texel in from the cell's edge, so the picture next door never shows)
  vec2 inCell = mix( uImpInset, 1.0 - uImpInset, clamp( vImpCell.xy, 0.0, 1.0 ) ) * cells.zw;
  #define IMP_UV( n ) ( cells.xy + vec2( mod( n, perRow ), floor( ( n ) / perRow ) ) * cells.zw + inCell )
  // (a sharper mip than the screen's footprint asks for: the leaves stay leaves; the cut keeps the edges clean)
  vec4 ca = texture2D( uImpColor, IMP_UV( vImpIdx.x ), IMP_BIAS );
  vec4 cb = texture2D( uImpColor, IMP_UV( vImpIdx.y ), IMP_BIAS );
  vec4 na = texture2D( uImpNormal, IMP_UV( vImpIdx.x ), IMP_BIAS );
  vec4 nb = texture2D( uImpNormal, IMP_UV( vImpIdx.y ), IMP_BIAS );
  // colours and normals are mixed by what each picture covers, so a hole in one does not grey the other
  float wa = ca.a * ( 1.0 - vImpMix.x );
  float wb = cb.a * vImpMix.x;
  vec4 colour = vec4( ( ca.rgb * wa + cb.rgb * wb ) / max( wa + wb, 1.0e-4 ), wa + wb );
  vec4 shape = ( na * wa + nb * wb ) / max( wa + wb, 1.0e-4 );
  #if IMP_ROWS > 1
  if ( vImpMix.z > 0.004 ) {
    ca = texture2D( uImpColor, IMP_UV( vImpIdx.z ), IMP_BIAS );
    cb = texture2D( uImpColor, IMP_UV( vImpIdx.w ), IMP_BIAS );
    na = texture2D( uImpNormal, IMP_UV( vImpIdx.z ), IMP_BIAS );
    nb = texture2D( uImpNormal, IMP_UV( vImpIdx.w ), IMP_BIAS );
    wa = ca.a * ( 1.0 - vImpMix.y );
    wb = cb.a * vImpMix.y;
    float low = colour.a * ( 1.0 - vImpMix.z );
    float high = ( wa + wb ) * vImpMix.z;
    colour = vec4( ( colour.rgb * low + ( ca.rgb * wa + cb.rgb * wb ) / max( wa + wb, 1.0e-4 ) * high ) / max( low + high, 1.0e-4 ), low + high );
    shape = ( shape * low + ( na * wa + nb * wb ) / max( wa + wb, 1.0e-4 ) * high ) / max( low + high, 1.0e-4 );
  }
  #endif
  // between two pictures a silhouette is half there: that becomes half coverage, or a cut where there is none
  #ifdef ALPHA_TO_COVERAGE
    colour.a = clamp( ( colour.a - 0.2 ) / 0.5, 0.0, 1.0 );
    if ( colour.a <= 0.0 ) discard;
  #else
    if ( colour.a < 0.45 ) discard;
  #endif
  // the shape atlas's alpha: 0 bark, else 0.4 + 0.6 * the light inside the crown there
  float leaf = smoothstep( 0.1, 0.35, shape.a );
  float lit = clamp( ( shape.a - 0.4 ) / 0.6, 0.0, 1.0 );
  treeBump = shape.xyz * 2.0 - 1.0;
  treeThrough = leaf * vImpCell.w;
  treeGloss = leaf * 0.75 * ( 0.35 + 0.65 * uWet ) + ( 1.0 - leaf ) * 0.7;
  treeBark = 1.0 - leaf;
  diffuseColor.rgb *= colour.rgb * mix( vec3( 1.0 ), vTint.rgb * crownTone( lit, vTurn ), leaf );
  diffuseColor.a = colour.a;
}
${TREE_BACK}`,
      )
      .replace('#include <alphatest_fragment>', FADE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix( mix( 0.66, 0.4, uWet ), mix( 0.92, 0.55, uWet ), treeBark );')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `float faceDirection = 1.0;
vec3 impN = normalize( treeBump );
vec3 normal = normalize( vImpX * impN.x + vImpY * impN.y + cross( vImpX, vImpY ) * impN.z );
treeCrown = normal;
vec3 nonPerturbedNormal = normal;`,
      )
      .replace('#include <lights_fragment_maps>', `${TREE_GLOW}\n#include <lights_fragment_maps>`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= treeGloss;');
  });
  return atmosphere.patch(material);
}

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
 * crown's silhouette as seen from there (the raised pictures, holes and all): the shade of a whole tree for two
 * triangles.
 * @param {import('./impostors.js').ImpostorAtlas} atlas
 */
export function impostorDepthMaterial(atlas) {
  const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  material.name = 'tree-impostor-depth';
  material.defines = { IMP_VARIANTS: atlas.variants, IMP_ROWS: atlas.rows, IMP_ELEV: atlas.elevation.toFixed(4) };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uImpColor: { value: atlas.color }, uImpA: { value: atlas.cells }, uImpB: { value: atlas.runs }, uImpC: { value: atlas.boxes }, uImpInset: { value: atlas.inset } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aImp;\n${IMP_PARS}`)
      .replace('#include <begin_vertex>', `vec3 transformed;\n${IMP_CARD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uImpColor;\nuniform vec2 uImpInset;\n${IMP_PARS}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
  int iv = int( vImpCell.z + 0.5 );
  vec4 cells = uImpA[ iv ];
  float perRow = uImpB[ iv ].x;
  vec2 inCell = mix( uImpInset, 1.0 - uImpInset, clamp( vImpCell.xy, 0.0, 1.0 ) ) * cells.zw;
  #define IMP_UV( n ) ( cells.xy + vec2( mod( n, perRow ), floor( ( n ) / perRow ) ) * cells.zw + inCell )
  bool raised = vImpMix.z > 0.5;
  float a = texture2D( uImpColor, IMP_UV( raised ? vImpIdx.z : vImpIdx.x ) ).a;
  float b = texture2D( uImpColor, IMP_UV( raised ? vImpIdx.w : vImpIdx.y ) ).a;
  if ( mix( a, b, raised ? vImpMix.y : vImpMix.x ) < 0.45 ) discard;
}`,
      );
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
      .replace('#include <common>', `#include <common>\nvarying vec2 vShade;\n${TREE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TREE_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
{
  diffuseColor.rgb *= mix( vTint.rgb, vec3( 1.0 ), vShade.y ) * vShade.x;
  treeThrough = ${through.toFixed(2)} * ( 1.0 - vShade.y );
  treeGloss = 0.3 + 0.5 * uWet;
}
${TREE_BACK}`,
      )
      .replace('#include <lights_fragment_maps>', `${TREE_GLOW}\n#include <lights_fragment_maps>`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= treeGloss;');
    // the normal its vertices carry is the ground's (or the plant's as a whole), the same on both sides of a card
    if (map) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `${NORMAL_BEGIN}\ntreeCrown = normal;`);
    else shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\ntreeCrown = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', FADE);
  });
  return atmosphere.patch(material);
}
