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
      .replace('#include <common>', '#include <common>\nattribute vec2 aMask;\nvarying vec2 vMask;\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMask = aMask;\nvGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGroundNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
      .replace('#include <map_fragment>', GROUND_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = groundRoughness;')
      .replace('#include <normal_fragment_maps>', GROUND_NORMAL);
  });
  withBake(material);
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
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
float groundRoughness;
vec3 groundBump;   // world-space tilt of the normal from the detail

// the detail texture on the ground: from above where it is level, from the side on steep faces
vec4 groundSample( sampler2D tex, vec3 p, vec3 n, float scale ) {
  vec2 top = p.xz / scale;
  vec2 side = ( abs( n.x ) > abs( n.z ) ? p.zy : p.xy ) / scale;
  float w = smoothstep( 0.55, 0.8, n.y );
  return mix( texture2D( tex, side ), texture2D( tex, top ), w );
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

float gSlope = 1.0 - gN.y;
float gRock = smoothstep( 0.2, 0.34, gSlope + ( gLarge.b - 0.5 ) * 0.22 );
float gScree = vMask.y * ( 1.0 - gRock );
float gForest = vMask.x * ( 1.0 - gRock );
float gSnow = smoothstep( 290.0, 350.0, vGroundPos.y + 70.0 * ( gLarge.a - 0.5 ) ) * ( 1.0 - smoothstep( 0.45, 0.7, gSlope ) );

// meadow: lush where gLarge.r is low, dry and paler where it is high, higher up a little browner
vec3 gLush = vec3( 0.036, 0.062, 0.02 );
vec3 gDry = vec3( 0.075, 0.078, 0.036 );
vec3 gGrass = mix( gLush, gDry, smoothstep( 0.45, 0.85, gLarge.r + vGroundPos.y * 0.001 ) );
gGrass *= 0.78 + 0.44 * gDet.r;
// forest floor near, the canopy's colour far away
vec3 gFloor = vec3( 0.04, 0.034, 0.024 ) * ( 0.7 + 0.6 * gDet.a );
vec3 gCanopy = vec3( 0.022, 0.036, 0.02 ) * ( 0.8 + 0.4 * gLarge.b );
vec3 gForestCol = mix( gFloor, gCanopy, smoothstep( 120.0, 400.0, gDist ) );
vec3 gScreeCol = vec3( 0.17, 0.162, 0.145 ) * ( 0.6 + 0.8 * gDet.b );
vec4 gDetRock = mix( vec4( 0.5 ), groundSample( uDetail, vGroundPos, gN, ${(DETAIL_SCALE * 2.7).toFixed(2)} ), 0.4 + 0.6 * gFade );
vec3 gRockCol = mix( vec3( 0.15, 0.14, 0.125 ), vec3( 0.12, 0.118, 0.112 ), gLarge.g ) * ( 0.62 + 0.45 * gDetRock.g + 0.2 * gDet.g );
vec3 gSnowCol = vec3( 0.72, 0.74, 0.78 ) * ( 0.9 + 0.2 * gDet.r ) * uSnowLight;

vec3 gAlbedo = gGrass;
gAlbedo = mix( gAlbedo, gForestCol, gForest );
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
