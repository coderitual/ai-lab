// The ground's one material: meadow, forest floor, scree, rock and snow,
// chosen per pixel from the slope, the height and two masks the terrain
// builder lays on its vertices (aMask: x the forest, y loose stone), and
// coloured from generated textures in world space, so that the band along the
// road, the grid and the far land are one surface with no seams between them.
//
// Detail comes at three scales that never line up: a large field (half a
// kilometre) for where the meadow is dry or lush and where rock breaks
// through, a detail texture (about 6 m) for clumps, stones and strata, and
// the same detail at a turned, smaller scale under it. Fine detail fades with
// distance, before the mip chain would turn it to mush, and at a few hundred
// metres the forest floor gives way to the colour of the canopy seen from
// above, because no trees are drawn that far out.
//
// It is a MeshStandardMaterial underneath, so it takes the sun's shadow, the
// sky's light from the environment map, the haze (atmosphere.patch) and the
// baked light of the mountain (shading.withBake).

import * as THREE from 'three';
import { fieldTexture, gradientField, normalTexture, valueField, worleyField } from '../../engine/noise.js';
import { extend, withBake } from './shading.js';

/** Metres one repeat of the detail texture covers, and of the large field. */
const DETAIL_SCALE = 6.4;
const LARGE_SCALE = 560;

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createGroundMaterial({ caps, tier, atmosphere }) {
  const size = tier === 'low' ? 256 : 512;
  const anisotropy = Math.min(8, caps.maxAnisotropy ?? 1);

  // detail: r clumps of grass, g strata and cracks of rock, b pebbles, a needle litter
  const clumps = valueField(size, { seed: 21, cells: 12, octaves: 4 });
  const blades = worleyField(size, { seed: 22, cells: 64 });
  const strata = gradientField(size, { seed: 23, cells: 4, octaves: 5 });
  const cracks = worleyField(size, { seed: 24, cells: 10, mode: 'edge' });
  const pebbles = worleyField(size, { seed: 25, cells: 40 });
  const litter = valueField(size, { seed: 26, cells: 64, octaves: 2 });
  const r = new Float32Array(size * size);
  const g = new Float32Array(size * size);
  const b = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  const rockHeight = new Float32Array(size * size);
  for (let i = 0; i < r.length; i++) {
    r[i] = 0.65 * clumps[i] + 0.35 * (1 - blades[i]);
    // strata: beds of uneven thickness across the texture's v (each its own tone), warped by the gradient
    // noise, each bed a flat face with a broken lip at its top, cut through by joints (the worley edges)
    const y = Math.floor(i / size) / size;
    const yy = y * 9 + strata[i] * 2.4;
    const bed = Math.floor(yy);
    const f = yy - bed;
    const key = ((bed % 9) + 9) % 9;
    const tone = 0.5 + 0.5 * Math.sin(key * 12.9898 + 3.1) * Math.cos(key * 4.1);
    const lip = Math.min(1, f / 0.18) * (1 - 0.6 * Math.max(0, (f - 0.82) / 0.18));
    const joint = Math.min(1, cracks[i] * 14);
    g[i] = Math.min(1, 0.25 + 0.45 * tone + 0.2 * strata[i] + 0.12 * lip) * (0.94 + 0.06 * joint);
    rockHeight[i] = 0.65 * lip + 0.35 * strata[i];
    b[i] = 1 - pebbles[i];
    height[i] = 0.45 * r[i] + 0.35 * b[i] + 0.2 * g[i];
  }
  const detail = fieldTexture(size, [r, g, b, litter], { anisotropy });
  const detailNormal = normalTexture(size, height, { relief: 0.03, anisotropy });
  // rock has its own relief: the strata, none of the turf's clumps and pebbles
  const rockNormal = normalTexture(size, rockHeight, { relief: 0.045, anisotropy });
  // large: r lush or dry, g where rock breaks through, b another tone, a snow's ragged edge
  const ls = 256;
  const large = fieldTexture(
    ls,
    [
      valueField(ls, { seed: 31, cells: 6, octaves: 5 }),
      valueField(ls, { seed: 32, cells: 5, octaves: 5 }),
      gradientField(ls, { seed: 33, cells: 8, octaves: 4 }),
      valueField(ls, { seed: 34, cells: 16, octaves: 3 }),
    ],
    { anisotropy: 2 },
  );

  const uniforms = {
    uDetail: { value: detail },
    uDetailN: { value: detailNormal },
    uRockN: { value: rockNormal },
    uLarge: { value: large },
    /** (look lane) the snow's albedo, times this: 1 by day; low at night, when the moonlit peaks read as dusk */
    uSnowLight: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.name = 'ground';
  extend(material, 'ground', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMask;\nattribute vec4 aVerge;\nvarying vec2 vMask;\nvarying vec4 vVerge;\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMask = aMask;\nvVerge = aVerge;\nvGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGroundNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
      .replace('#include <map_fragment>', GROUND_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = groundRoughness;')
      .replace('#include <normal_fragment_maps>', GROUND_NORMAL);
  });
  withBake(material);
  // (env lane) light through the blades: mown grass seen against a low sun glows a vivid green (frame D1). After the
  // bake has unrolled the light loop, every direct light adds what the grass lets through towards the eye.
  extend(material, 'ground-translucency', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${GRASS_THROUGH}`)
      .replaceAll(
        'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
        'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\nreflectedLight.directDiffuse += grassThrough( directLight, geometryNormal, geometryViewDir );',
      );
  });
  atmosphere.patch(material);
  return {
    material,
    /** @param {{ name: string }} time */
    setTime(time) {
      uniforms.uSnowLight.value = time.name === 'night' ? 0.25 : 1;
    },
    textures: [detail, detailNormal, rockNormal, large],
    dispose() {
      material.dispose();
      for (const t of [detail, detailNormal, rockNormal, large]) t.dispose();
    },
  };
}

const GROUND_PARS = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uDetailN;
uniform sampler2D uRockN;
uniform sampler2D uLarge;
uniform float uSnowLight;
varying vec2 vMask;
varying vec4 vVerge;  // the band beside the road: m beyond the margin, s, m beyond the barrier, 0 (1 elsewhere)
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
float groundRoughness;
vec3 groundThrough;  // what the grass here lets through (0 where it is not grass)
vec3 groundBump;   // world-space tilt of the normal from the detail

// the detail texture on the ground: from above where it is level, from the side on steep faces
vec4 groundSample( sampler2D tex, vec3 p, vec3 n, float scale ) {
  vec2 top = p.xz / scale;
  vec2 side = ( abs( n.x ) > abs( n.z ) ? p.zy : p.xy ) / scale;
  float w = smoothstep( 0.55, 0.8, n.y );
  return mix( texture2D( tex, side ), texture2D( tex, top ), w );
}
`;

/** GLSL (after lights_pars_begin): forward scattering through grass blades lit from behind. */
const GRASS_THROUGH = /* glsl */ `
vec3 grassThrough( IncidentLight L, vec3 N, vec3 V ) {
  float toward = max( dot( V, -L.direction ), 0.0 );
  float grazing = 1.0 - max( dot( N, V ), 0.0 );
  float lit = max( dot( N, L.direction ), 0.0 ) * 0.6 + 0.4 * step( 0.0, dot( N, L.direction ) + 0.2 );
  return L.color * groundThrough * pow( toward, 3.0 ) * ( 0.4 + 0.6 * grazing ) * lit;
}
`;

const GROUND_COLOR = /* glsl */ `
vec3 gN = normalize( vGroundNormal );
float gDist = length( vGroundPos - cameraPosition );
float gFade = 1.0 - smoothstep( 35.0, 170.0, gDist );
vec4 gLarge = texture2D( uLarge, vGroundPos.xz / ${LARGE_SCALE.toFixed(1)} );
vec4 gDet = groundSample( uDetail, vGroundPos, gN, ${DETAIL_SCALE.toFixed(2)} );
// the same detail turned and smaller underneath: the repeat of either is lost in the other
vec4 gDet2 = groundSample( uDetail, vec3( vGroundPos.z * 0.8 + vGroundPos.x * 0.6, vGroundPos.y, vGroundPos.x * 0.8 - vGroundPos.z * 0.6 ), gN, ${(DETAIL_SCALE * 0.37).toFixed(2)} );
gDet = mix( vec4( 0.5 ), 0.6 * gDet + 0.4 * gDet2, gFade ) + ( 0.6 * gDet + 0.4 * gDet2 - 0.5 ) * ( 1.0 - gFade ) * 0.35;

// (look lane, day) a middle scale (about 90 m) between the large field and the detail: outcrops on moderate
// slopes, scree fans and sun-bleached straw among the grass, so the open slopes are not one smooth tone
vec4 gMid = texture2D( uLarge, vGroundPos.xz / 93.0 + vec2( 0.37, 0.61 ) );
float gSlope = 1.0 - gN.y;
// (env lane) aMask.y = 2 marks a cut rock face (rock.js): rock whatever its facets' slopes
float gCut = step( 1.5, vMask.y );
float gRock = gCut + ( 1.0 - gCut ) * smoothstep( 0.2, 0.34, gSlope + ( gLarge.b - 0.5 ) * 0.22 + ( gMid.g - 0.5 ) * 0.4 * smoothstep( 0.05, 0.16, gSlope ) );
float gScree = max( min( vMask.y, 1.0 ), smoothstep( 0.68, 0.8, gMid.a ) * smoothstep( 0.12, 0.25, gSlope ) * 0.7 ) * ( 1.0 - gRock );
// (env lane) scrub: dark clumps of box and juniper on the moderate slopes, between meadow and rock
float gScrub = smoothstep( 0.06, 0.16, gSlope + ( gMid.b - 0.5 ) * 0.12 ) * smoothstep( 0.35, 0.6, gDet.r * 0.5 + gMid.g * 0.7 ) * ( 1.0 - gRock );
// (env lane) the wood's edge broken by clumps of crowns, not a soft blend
float gForest = smoothstep( 0.3, 0.6, vMask.x + ( gMid.b - 0.5 ) * 0.5 + ( gLarge.b - 0.5 ) * 0.3 ) * step( 0.02, vMask.x ) * ( 1.0 - gRock );
// (env lane: no snow on the hills round the circuit; the far massif is the SKY lane's)
float gSnow = 0.0 * smoothstep( 290.0, 350.0, vGroundPos.y + 70.0 * ( gLarge.a - 0.5 ) ) * ( 1.0 - smoothstep( 0.45, 0.7, gSlope ) );

// meadow: lush where gLarge.r is low, dry and paler where it is high, higher up a little browner
vec3 gLush = vec3( 0.036, 0.062, 0.02 );
vec3 gDry = vec3( 0.045, 0.068, 0.024 );
vec3 gGrass = mix( gLush, gDry, smoothstep( 0.45, 0.85, gLarge.r + vGroundPos.y * 0.001 ) );
gGrass *= 0.78 + 0.44 * gDet.r;
gGrass = mix( gGrass, vec3( 0.075, 0.08, 0.04 ) * ( 0.8 + 0.4 * gDet.r ), smoothstep( 0.6, 0.85, gMid.b ) * 0.5 );
gGrass *= 0.72 + 0.56 * gMid.r;
// forest floor near, the canopy's colour far away
vec3 gFloor = vec3( 0.04, 0.034, 0.024 ) * ( 0.7 + 0.6 * gDet.a );
vec3 gCanopy = vec3( 0.02, 0.034, 0.017 ) * ( 0.7 + 0.5 * gLarge.b ) * ( 0.75 + 0.5 * gMid.r );
vec3 gForestCol = mix( gFloor, gCanopy, smoothstep( 120.0, 400.0, gDist ) );
vec3 gScreeCol = vec3( 0.17, 0.162, 0.145 ) * ( 0.6 + 0.8 * gDet.b );
vec4 gDetRock = mix( vec4( 0.5 ), groundSample( uDetail, vGroundPos, gN, ${(DETAIL_SCALE * 2.7).toFixed(2)} ), 0.4 + 0.6 * gFade );
vec3 gRockCol = mix( vec3( 0.13, 0.13, 0.125 ), vec3( 0.1, 0.104, 0.108 ), gLarge.g ) * ( 0.62 + 0.45 * gDetRock.g + 0.2 * gDet.g );
// a cut face: limestone in beds, pale and grey by turns, streaked dark where water runs down it
float gBed = vGroundPos.y / 0.85 + 0.6 * gDet.g;
float gBedTone = fract( sin( floor( gBed ) * 12.9898 ) * 43758.5453 );
vec3 gLime = mix( vec3( 0.15, 0.15, 0.145 ), vec3( 0.26, 0.255, 0.24 ), 0.3 + 0.7 * gBedTone ) * ( 0.8 + 0.3 * gDetRock.g );
float gStreak = smoothstep( 0.55, 0.8, texture2D( uLarge, vec2( ( vGroundPos.x + vGroundPos.z ) / 23.0, vGroundPos.y / 400.0 ) ).b );
gLime *= 1.0 - 0.45 * gStreak;
gRockCol = mix( gRockCol, gLime, gCut );
vec3 gSnowCol = vec3( 0.72, 0.74, 0.78 ) * ( 0.9 + 0.2 * gDet.r ) * uSnowLight;

// (env lane) the verge: mown grass in stripes along the road, a strip of worn earth and loose stones along the
// kerbs' outer edge, longer grass at the foot of the barrier
float gVerge = ( 1.0 - step( 0.5, vVerge.w ) ) * ( 1.0 - smoothstep( 0.0, 1.5, vVerge.z ) );
float gWoodBehind = gVerge > 0.0 ? clamp( vVerge.w / 0.4, 0.0, 1.0 ) : 0.0;
if ( gVerge > 0.0 ) {
  float vd = vVerge.x;
  float vAa = 0.6 * ( abs( dFdx( vd ) ) + abs( dFdy( vd ) ) ) + 1.0e-3;
  // the mower's passes: bands about 1.6 m wide whose blades lean one way or the other
  float pass = abs( fract( vd / 3.2 ) * 2.0 - 1.0 );
  float stripe = clamp( ( pass - 0.5 ) / max( vAa / 1.6, 1.0e-3 ) + 0.5, 0.0, 1.0 );
  stripe = mix( stripe, 0.5, smoothstep( 0.3, 1.0, vAa / 1.6 ) );
  vec3 mown = mix( vec3( 0.06, 0.13, 0.025 ), vec3( 0.09, 0.18, 0.035 ), stripe ) * ( 0.8 + 0.4 * gDet.r ) * ( 0.85 + 0.3 * gMid.r );
  // worn earth: ragged, wider where cars have run wide
  // a narrow verge (a wall close by, frame D3) is mostly rough grass and earth; a wide run-off is mown (D1)
  float vWidth = vd - vVerge.z;
  float rag = mix( 1.7, 0.55, smoothstep( 4.5, 6.0, vWidth ) ) + 0.5 * ( gDet.b - 0.5 ) + 0.6 * ( gLarge.b - 0.5 ) + 0.4 * ( gDet2.r - 0.5 );
  float earth = 1.0 - smoothstep( rag - 0.15, rag + 0.15, vd );
  vec3 earthCol = mix( vec3( 0.16, 0.135, 0.1 ), vec3( 0.24, 0.215, 0.18 ), gDet.b ) * ( 0.75 + 0.4 * gDet2.g );
  // a few stones thrown out onto the grass beyond it
  float stones = smoothstep( 0.82, 0.9, gDet.b ) * ( 1.0 - smoothstep( 0.4, 2.0, vd - rag ) );
  // long grass at the barrier's foot
  float rough = smoothstep( -1.2, -0.3, vVerge.z );
  vec3 vergeCol = mix( mown, gGrass * 1.1, rough );
  // rough tufts in the earth strip: clumps of darker, longer grass
  float tufts = smoothstep( 0.55, 0.75, gDet.r ) * earth * ( 1.0 - smoothstep( 4.5, 6.0, vWidth ) );
  vergeCol = mix( vergeCol, earthCol, max( earth, stones * 0.8 ) );
  vergeCol = mix( vergeCol, gGrass * 0.9, tufts );
  // fallen leaves drifted against the barrier's foot under woods (frame D4)
  float leaves = gWoodBehind * smoothstep( -2.2, -0.4, vVerge.z + 0.6 * ( gDet2.r - 0.5 ) ) * smoothstep( 0.35, 0.6, gDet.a + 0.2 * gMid.r );
  vergeCol = mix( vergeCol, mix( vec3( 0.2, 0.075, 0.02 ), vec3( 0.09, 0.04, 0.015 ), gDet.b ), leaves );
  gGrass = mix( gGrass, vergeCol, gVerge );
  gScree *= 1.0 - gVerge;
  gForest *= 1.0 - gVerge;
}
// (env lane) fields on the valley floor: a patchwork of meadows and crops between hedges, far from the road
{
  float fieldZone = ( 1.0 - smoothstep( 0.05, 0.12, gSlope ) ) * ( 1.0 - smoothstep( 40.0, 90.0, vGroundPos.y ) ) * step( 0.5, vVerge.w ) * smoothstep( 60.0, 140.0, gDist );
  if ( fieldZone > 0.0 ) {
    vec2 fp = mat2( 0.92, 0.39, -0.39, 0.92 ) * vGroundPos.xz / vec2( 130.0, 75.0 );
    vec2 fc = floor( fp );
    float fh = fract( sin( dot( fc, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 crop = fh < 0.35 ? vec3( 0.05, 0.085, 0.025 ) : fh < 0.6 ? vec3( 0.075, 0.09, 0.03 ) : fh < 0.85 ? vec3( 0.04, 0.065, 0.02 ) : vec3( 0.085, 0.08, 0.045 );
    vec2 fe = min( fract( fp ), 1.0 - fract( fp ) ) * vec2( 130.0, 75.0 );
    float fAa = fwidth( vGroundPos.x ) + fwidth( vGroundPos.z ) + 0.5;
    float hedge = 1.0 - smoothstep( 2.0, 2.0 + fAa, min( fe.x, fe.y ) );
    vec3 fieldCol = mix( crop * ( 0.85 + 0.3 * gMid.r ), vec3( 0.02, 0.035, 0.016 ), hedge * 0.8 );
    gGrass = mix( gGrass, fieldCol, fieldZone );
  }
}
// (env lane) clumps of trees and hedges across open meadow beyond the verge, so no slope reads as bare
float gClump = smoothstep( 0.6, 0.68, gMid.g * 0.7 + gLarge.b * 0.3 + ( gDet.r - 0.5 ) * 0.15 ) * ( 1.0 - gRock ) * step( 0.5, vVerge.w ) * ( 1.0 - smoothstep( 0.25, 0.4, gSlope ) );
gForest = max( gForest, gClump );
vec3 gAlbedo = gGrass;
// blades let through a bright yellow-green, the mown verge most
groundThrough = vec3( 0.18, 0.42, 0.05 ) * ( 0.6 + 0.8 * gVerge ) * ( 1.0 - gRock ) * ( 1.0 - gScree ) * ( 1.0 - gForest ) * gFade;
gAlbedo = mix( gAlbedo, vec3( 0.03, 0.045, 0.02 ) * ( 0.7 + 0.6 * gDet.r ), gScrub * 0.85 );
gAlbedo = mix( gAlbedo, gForestCol, gForest );
// (seen from the road a clump is crowns, not forest floor)
gAlbedo = mix( gAlbedo, gCanopy * 1.3, gClump * ( 1.0 - min( vMask.x * 3.0, 1.0 ) ) );
gAlbedo = mix( gAlbedo, gScreeCol, gScree );
gAlbedo = mix( gAlbedo, gRockCol, gRock );
gAlbedo = mix( gAlbedo, gSnowCol, gSnow );
diffuseColor.rgb *= gAlbedo;
groundRoughness = mix( mix( 1.0, 0.92, gScree ), 0.82, gRock );
groundRoughness = mix( groundRoughness, 0.55, gSnow );
`;

const GROUND_NORMAL = /* glsl */ `
{
  vec3 dn = groundSample( uDetailN, vGroundPos, gN, ${DETAIL_SCALE.toFixed(2)} ).xyz * 2.0 - 1.0;
  // rock breaks in bigger pieces than turf
  vec3 dnRock = groundSample( uRockN, vGroundPos, gN, ${(DETAIL_SCALE * 2.7).toFixed(2)} ).xyz * 2.0 - 1.0;
  dn = mix( dn, dnRock, gRock );
  float strength = gFade * mix( mix( 0.45, 0.9, gScree ), 1.1, gRock ) * ( 1.0 - gSnow * 0.7 );
  // tangents of the projection used: world x and z from above, the face's own axes on steep ground
  vec3 t = normalize( vec3( 1.0, 0.0, 0.0 ) - gN * gN.x );
  vec3 b = normalize( vec3( 0.0, 0.0, 1.0 ) - gN * gN.z );
  vec3 nw = normalize( gN + ( t * dn.x + b * dn.y ) * strength );
  normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
}
`;
