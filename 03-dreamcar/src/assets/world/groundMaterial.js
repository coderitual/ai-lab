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
import { SEA_MAP_GLSL, SEA_UNIFORMS } from './sea.js';
import { BED } from './rock.js';

/**
 * (finish lane) The one green of the grass, linear albedo: the meadow (lush where it is damp, drier and a little
 * straw-coloured where it is not), the mown verge's two stripes, the light the blades let through against a low sun,
 * and the tufts, bushes and the wood's floor that stand on it (groundCover.js, forest.js read it). Early autumn: an
 * olive green a little less saturated than the trees' greens, so that the trees, not the grass, carry the colour. It
 * was a yellow-green at about a third of blue to green, and the light through the blades was ten times what the
 * blades reflect, which against the sun glowed neon; now about 40 % blue to green, and the light through them two
 * to three times what they reflect.
 */
export const GRASS = {
  lush: [0.042, 0.064, 0.026],
  dry: [0.054, 0.07, 0.03],
  /** dry straw among the meadow's grass */
  straw: [0.072, 0.072, 0.04],
  mown: [
    [0.05, 0.074, 0.03],
    [0.057, 0.082, 0.034],
  ],
  /** what the blades let through towards the eye, per unit of the light behind them (verge; the meadow 0.6 of it) */
  through: [0.03, 0.044, 0.015],
  /** a tuft's tint over the cover texture (green .. dry), a bush's, and the wood's floor's (over its own painting) */
  tuft: [0.045, 0.065, 0.027],
  tuftDry: [0.07, 0.07, 0.034],
  bush: [0.046, 0.064, 0.028],
  floor: [0.2, 0.19, 0.36],
};
const v3 = (c) => `vec3( ${c.map((x) => x.toFixed(4)).join(', ')} )`;

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
    Object.assign(shader.uniforms, uniforms, SEA_UNIFORMS);
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
      .replace('#include <normal_fragment_maps>', GROUND_NORMAL)
      // blades and crowns have next to no sheen (groundSheen): neither the sky's blue nor the low sun's glare on them
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularColor *= groundSheen;\nmaterial.specularColorBlended *= groundSheen;\nmaterial.specularF90 *= groundSheen;',
      );
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
${SEA_MAP_GLSL}
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
float groundGrass;   // how much of this pixel is blades of grass
float groundSheen;   // how much of a plain rough surface's sheen it keeps (blades and crowns: next to none)
vec3 groundBump;   // world-space tilt of the normal from the detail

// (nearfield lane) the beds and blocks of rock, the same layout as rock.js builds (its rockHash, bedOffset, blockAt)
float rockHash( int a, int b, int c ) {
  uint h = ( uint( a ) * 0x27d4eb2du ) ^ ( uint( b ) * 0x165667b1u ) ^ ( uint( c ) * 0x9e3779b1u );
  h = ( h ^ ( h >> 15u ) ) * 0x2c1b3c6du;
  h = ( h ^ ( h >> 12u ) ) * 0x297a2d39u;
  h ^= h >> 15u;
  return float( h >> 8u ) / 16777216.0;
}
// how far back bed j's block at s stands (0..1), and the block's index
float rockBack( int j, float s, int sd, out float u, out float len ) {
  len = 2.6 + 4.2 * rockHash( j, sd, 1 );
  u = ( s + rockHash( j, sd, 2 ) * len ) / len;
  return rockHash( j, int( floor( u ) ), sd * 7 + 3 );
}
// the block at (s, t) (t metres up from the foot; s metres along): x its shade, y how far back it stands, z the bed
// below's, w the bed above's (0..1); e metres to its two ends, its foot and its top
vec4 rockBlock( float s, float t, float side, out vec4 e ) {
  const float BED = ${BED.toFixed(3)};
  float off = BED * ( 0.5 + 0.3 * sin( s / 29.0 + side * 1.7 ) + 0.15 * sin( s / 11.3 + 0.4 * side ) );
  float bb = ( t + off ) / BED;
  int j = int( floor( bb ) );
  int sd = int( floor( side + 0.5 ) );
  float u;
  float len;
  float back = rockBack( j, s, sd, u, len );
  float u2;
  float len2;
  float below = rockBack( j - 1, s, sd, u2, len2 );
  float above = rockBack( j + 1, s, sd, u2, len2 );
  float fu = fract( u );
  float fb = fract( bb );
  e = vec4( fu * len, ( 1.0 - fu ) * len, fb * BED, ( 1.0 - fb ) * BED );
  return vec4( rockHash( j, int( floor( u ) ), sd * 7 + 5 ), back, below, above );
}

// (nearfield lane, reference m5) sand sculpted by light: long swells across the wind with a gentle windward slope and
// a sharp crest falling steeply to the lee, and wind ripples on them; returns how lit (the swells' own shading, about
// 1) and, in tilt, the world-space tilt (x, z) of the normal. px: metres per pixel (the ripples fade before it is
// coarser than they are).
float sandRelief( vec3 p, float px, out vec2 tilt ) {
  vec2 wind = vec2( 0.8, 0.6 );
  vec2 across = vec2( -0.6, 0.8 );
  float warp = 2.2 * sin( dot( p.xz, across ) / 9.0 ) + 1.1 * sin( dot( p.xz, across ) / 3.7 + 1.3 );
  float u = dot( p.xz, wind ) + warp;
  float f = fract( u / 6.5 );
  // the swell: rising over 80 % of its length, falling over the rest
  float slope = f < 0.8 ? 0.12 : -0.48;
  float crest = 1.0 - smoothstep( 0.0, 0.05 + px / 6.5, abs( f - 0.8 ) );
  tilt = -wind * slope;
  float lit = f < 0.8 ? 1.0 + 0.12 * f : 0.82;
  // ripples: about 0.3 m, wavering
  float r = u / 0.32 + 1.5 * sin( dot( p.xz, across ) / 1.3 );
  float fade = 1.0 - smoothstep( 0.03, 0.09, px );
  tilt += wind * 0.22 * cos( 6.2832 * r ) * fade;
  lit *= 1.0 + 0.08 * sin( 6.2832 * r ) * fade;
  return lit + 0.08 * crest;
}

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
// (sea lane, round 2) near the sea a slope stays dry grass and scrub up to a steeper pitch before it is bare rock: the
// headlands' sides read as grass over a cut, not as a quarry (frame E1)
float gNearSea = 0.0;
if ( uSeaBox.w > -1000.0 ) gNearSea = 1.0 - smoothstep( 160.0, 460.0, seaLandOff( seaMapAt( vGroundPos.xz ) ) );
// (nearfield lane, round 2: + the fine noise) the turf's edge onto rock ragged, not a straight line
float gRock = gCut + ( 1.0 - gCut ) * smoothstep( 0.2 + 0.16 * gNearSea, 0.34 + 0.2 * gNearSea, gSlope + ( gLarge.b - 0.5 ) * 0.22 + ( gMid.g - 0.5 ) * 0.4 * smoothstep( 0.05, 0.16, gSlope ) + 0.14 * ( gDet2.r - 0.5 ) + 0.07 * ( gDet.r - 0.5 ) );
float gScree = max( min( vMask.y, 1.0 ), smoothstep( 0.68, 0.8, gMid.a ) * smoothstep( 0.12, 0.25, gSlope ) * 0.7 ) * ( 1.0 - gRock );
// (env lane) scrub: dark clumps of box and juniper on the moderate slopes, between meadow and rock
float gScrub = smoothstep( 0.06, 0.16, gSlope + ( gMid.b - 0.5 ) * 0.12 ) * smoothstep( 0.35, 0.6, gDet.r * 0.5 + gMid.g * 0.7 ) * ( 1.0 - gRock );
// (env lane) the wood's edge broken by clumps of crowns, not a soft blend
float gForest = smoothstep( 0.3, 0.6, vMask.x + ( gMid.b - 0.5 ) * 0.5 + ( gLarge.b - 0.5 ) * 0.3 ) * step( 0.02, vMask.x ) * ( 1.0 - gRock );
// (env lane: no snow on the hills round the circuit; the far massif is the SKY lane's)
float gSnow = 0.0 * smoothstep( 290.0, 350.0, vGroundPos.y + 70.0 * ( gLarge.a - 0.5 ) ) * ( 1.0 - smoothstep( 0.45, 0.7, gSlope ) );

// meadow: lush where gLarge.r is low, dry and paler where it is high, higher up a little browner
vec3 gLush = ${v3(GRASS.lush)};
vec3 gDry = ${v3(GRASS.dry)};
vec3 gGrass = mix( gLush, gDry, smoothstep( 0.45, 0.85, gLarge.r + vGroundPos.y * 0.001 ) );
gGrass *= 0.78 + 0.44 * gDet.r;
// (nearfield lane) near the road the big soft blotches of tone are held down (they read as a low-resolution paint
// map); finer, crisper structure takes over there (gTurf below)
float gNearLand = 1.0 - smoothstep( 90.0, 200.0, gDist );
gGrass = mix( gGrass, ${v3(GRASS.straw)} * ( 0.8 + 0.4 * gDet.r ), smoothstep( 0.6, 0.85, gMid.b ) * mix( 0.5, 0.25, gNearLand ) );
gGrass *= mix( 0.72 + 0.56 * gMid.r, 0.88 + 0.24 * gMid.r, gNearLand );
// forest floor near, the canopy's colour far away
// (lead) leaf litter, not soot: at 0.04 the floor of the wood behind a barrier was a black void
vec3 gFloor = vec3( 0.085, 0.072, 0.05 ) * ( 0.7 + 0.6 * gDet.a );
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
// (sea lane) the coast: within a few hundred metres of the sea (the sea map) the rock is a warm ochre and rust
// sandstone in beds, the loose stone (the gravel beyond the coast road's barrier: aMask.y) ochre grit, and a band
// just over the water is dark and wet. Inland it stays the grey limestone.
float gCoast = 0.0;
float gWetBand = 0.0;
if ( uSeaBox.w > -1000.0 ) {
  vec4 gSea = seaMapAt( vGroundPos.xz );
  gCoast = 1.0 - smoothstep( 160.0, 460.0, seaLandOff( gSea ) + 120.0 * ( gLarge.b - 0.5 ) );
  gWetBand = ( 1.0 - smoothstep( 0.4, 1.6 + 0.8 * gDet.g, vGroundPos.y - uSeaBox.w ) ) * smoothstep( 0.3, 0.6, gSea.a + gCoast );
}
// (round 2, frame E1) rust and ochre earth and soft rock, its beds faint, scored by erosion gullies that run down the
// face (dark in their shade, pale on their ribs) and darker towards its foot
float gGullyX = texture2D( uLarge, vec2( ( vGroundPos.x - vGroundPos.z ) / 31.0, vGroundPos.y / 260.0 ) ).g;
float gGully = smoothstep( 0.35, 0.65, gGullyX + 0.25 * ( gDetRock.g - 0.5 ) );
vec3 gOchre = mix( vec3( 0.2, 0.105, 0.05 ), vec3( 0.3, 0.175, 0.085 ), 0.6 * gBedTone * 0.35 + 0.65 * gGully ) * ( 0.72 + 0.4 * gDetRock.g ) * ( 1.0 - 0.3 * gStreak );
gRockCol = mix( gRockCol, mix( gOchre * ( 0.75 + 0.25 * gLarge.g ), gOchre, gCut ), gCoast );
gScreeCol = mix( gScreeCol, vec3( 0.46, 0.255, 0.14 ) * ( 0.82 + 0.36 * gDet.b ), gCoast );
// (nearfield lane) the rock near the road in beds and blocks, as rock.js builds its cut faces: a limited palette of
// three tones of the stone (pale grey limestone inland, ochre sandstone on the coast), one per block; large patches
// of iron staining; each block's lip lit and worn pale where the bed above stands back, and in shade where it stands
// out; dark joints; a damp, mossy foot and a paler worn top on a cut face, grass and scrub on its ledges and spilling
// over its top. Joints and bevels fade out before they are a pixel wide, the blocks' tones before a bed is a few.
vec2 gRockTilt = vec2( 0.0 );
float gRockRough = 0.82;
vec3 gLichen = vec3( 0.0 );
if ( gRock > 0.01 ) {
  float rs;
  float rt;
  float rside = 0.0;
  // where on the face: a cut face carries metres up it, s and its side (rock.js); the band beside the road s; the
  // land beyond, the world's own axes
  if ( gCut > 0.5 ) {
    rs = vVerge.y;
    rt = vVerge.x;
    rside = vVerge.z;
  } else if ( vVerge.w < 0.9 ) {
    rs = vVerge.y;
    rt = vGroundPos.y;
  } else {
    rs = abs( gN.x ) > abs( gN.z ) ? vGroundPos.z : vGroundPos.x;
    rt = vGroundPos.y;
  }
  float rPx = max( fwidth( rs ) + fwidth( rt ), 1.0e-4 );
  vec4 re;
  vec4 rb = rockBlock( rs, rt, rside, re );
  float rFine = 1.0 - smoothstep( 0.08, 0.35, rPx );
  float rCoarse = 1.0 - smoothstep( 0.3, 0.8, rPx );
  float tone = mix( 0.5, rb.x, rCoarse );
  // (round 2) the tones further apart, so the blocks read at a phone's size
  vec3 stoneLo = mix( vec3( 0.11, 0.11, 0.105 ), vec3( 0.12, 0.062, 0.03 ), gCoast );
  vec3 stoneMid = mix( vec3( 0.2, 0.197, 0.188 ), vec3( 0.225, 0.122, 0.058 ), gCoast );
  vec3 stoneHi = mix( vec3( 0.32, 0.315, 0.3 ), vec3( 0.35, 0.21, 0.105 ), gCoast );
  // three tones, stepped (a painted look), not a ramp
  vec3 rc = mix( mix( stoneLo, stoneMid, smoothstep( 0.25, 0.32, tone ) ), stoneHi, smoothstep( 0.72, 0.79, tone ) );
  // big patches: iron staining inland, a darker weathered rind on the coast
  float rPatch = smoothstep( 0.55, 0.72, gMid.g + 0.35 * ( gLarge.b - 0.5 ) );
  rc *= mix( vec3( 1.0 ), mix( vec3( 1.1, 0.93, 0.76 ), vec3( 0.82, 0.8, 0.82 ), gCoast ), rPatch );
  rc *= 0.93 + 0.14 * gDetRock.g;
  rc *= mix( 1.0, 0.78 + 0.4 * gGully, gCoast * ( 1.0 - gCut ) );
  rc *= 1.0 - 0.25 * gStreak;
  // the lip of a block whose bed above stands back (an open ledge): lit and worn pale; under a bed that stands out, shade
  float bev = 0.16;
  float open = smoothstep( 0.05, 0.25, rb.w - rb.y );
  float lip = ( 1.0 - smoothstep( 0.0, bev, re.w ) ) * rFine * ( 0.35 + 0.65 * open );
  float under = smoothstep( 0.05, 0.25, rb.y - rb.w ) * ( 1.0 - smoothstep( 0.0, 0.75, re.w ) ) * rCoarse;
  float foot = ( 1.0 - smoothstep( 0.0, bev, re.z ) ) * rFine;
  rc *= ( 1.0 + 0.5 * lip ) * ( 1.0 - 0.45 * under ) * ( 1.0 - 0.25 * foot );
  // the joints between blocks are broken (some run on, some close up), the beds' lines continuous
  float vj = rb.x < 0.55 ? min( re.x, re.y ) : 9.0;
  float joint = 1.0 - smoothstep( 0.05, 0.05 + rPx, min( vj, min( re.z, re.w ) ) );
  rc *= 1.0 - 0.72 * joint * rFine;
  // (owner's references n1, n2) pitted, pocked erosion: hollows a few tens of centimetres across, dense in some
  // patches of the face and none in others, each dark inside under a lit lower lip
  {
    vec2 pq = vec2( rs, rt ) / 0.75;
    vec2 pc = floor( pq );
    float pd = 9.0;
    float pr = 0.0;
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec2 c = pc + vec2( float( i ), float( j ) );
        int ci = int( c.x );
        int cj = int( c.y );
        vec2 o = vec2( rockHash( ci, cj, 91 ), rockHash( ci, cj, 92 ) );
        float rad = 0.14 + 0.34 * rockHash( ci, cj, 93 ) * rockHash( ci, cj, 94 );
        float d = length( pq - c - o ) / rad;
        if ( d < pd ) {
          pd = d;
          pr = ( pq.y - c.y - o.y ) / rad;
        }
      }
    }
    float pitted = smoothstep( 0.45, 0.62, gMid.r + 0.4 * ( gDet2.g - 0.5 ) ) * rCoarse;
    float hole = ( 1.0 - smoothstep( 0.8, 1.0, pd ) ) * pitted;
    float rimLit = smoothstep( 0.75, 1.0, pd ) * ( 1.0 - smoothstep( 1.0, 1.25, pd ) ) * step( pr, 0.0 ) * pitted;
    // dark under the hollow's upper lip, lighter towards its lower one
    rc *= ( 1.0 - 0.7 * hole * ( 0.4 + 0.6 * smoothstep( -0.6, 0.6, pr ) ) ) * ( 1.0 + 0.4 * rimLit * rFine );
    gRockTilt.y += ( 0.5 * pr * hole - 0.3 * rimLit ) * rFine;
  }
  // a wet sheen where water seeps down the face and in the damp foot: the rock is not matte (n1)
  gRockRough = mix( 0.62, 0.36, max( gStreak, smoothstep( 0.6, 0.8, gDet2.g ) * 0.6 ) );
  // orange and yellow lichen in crusts on the coast's rock and on the tops of blocks (n1, n2)
  gLichen = mix( vec3( 0.42, 0.13, 0.02 ), vec3( 0.36, 0.27, 0.04 ), step( 0.5, gDet2.b ) );
  float lichen = smoothstep( 0.66, 0.72, gDet.g * 0.5 + gDet2.r * 0.5 + 0.25 * lip ) * smoothstep( 0.4, 0.7, gMid.b + 0.4 * gCoast ) * rCoarse;
  rc = mix( rc, gLichen * ( 0.8 + 0.4 * gDet.r ), lichen * 0.85 );
  // the face's height: damp and mossy at the foot, paler where the top is worn
  float rFrac = gCut > 0.5 ? vMask.y - 2.0 : 0.5;
  float rDamp = gCut * ( 1.0 - smoothstep( 0.2, 1.1 + 0.6 * gDet2.r, rt ) );
  rc *= 1.0 - 0.4 * rDamp;
  rc = mix( rc, vec3( 0.045, 0.055, 0.025 ), rDamp * smoothstep( 0.5, 0.7, gDet.r + 0.2 * ( gDet2.g - 0.5 ) ) * 0.7 );
  rc *= 1.0 + 0.22 * gCut * smoothstep( 0.7, 1.0, rFrac ) * ( 1.0 - step( 1.001, rFrac ) );
  // (round 2) rills: water has scored the face in grooves a few metres apart, wavering down it, dark in their depth
  float rillU = rs / 3.2 + 0.35 * sin( rt / 5.0 + rs * 0.05 ) + 0.25 * ( gDet2.g - 0.5 );
  float rillF = fract( rillU ) - 0.5;
  float rill = ( 1.0 - smoothstep( 0.08, 0.24, abs( rillF ) ) ) * smoothstep( 0.35, 0.55, gMid.b + 0.3 * ( gDet2.r - 0.5 ) ) * rCoarse;
  // dark in the groove, a lit rib beside it
  rc *= ( 1.0 - 0.55 * rill ) * ( 1.0 + 0.2 * ( smoothstep( 0.24, 0.3, abs( rillF ) ) - smoothstep( 0.3, 0.42, abs( rillF ) ) ) * rCoarse );
  // the land's own rock (not a cut face) stays at its old, darker tone, and far away it is what it was
  float rNear = gCut + ( 1.0 - gCut ) * ( 1.0 - smoothstep( 140.0, 280.0, gDist ) );
  rc *= mix( 0.62, 1.0, max( gCut, gCoast ) );
  gRockCol = mix( gRockCol, rc, rNear );
  gRockTilt = vec2( ( fract( rb.x * 7.31 ) - 0.5 ) * 0.5, ( fract( rb.x * 3.17 ) - 0.5 ) * 0.35 + 1.1 * lip - 0.7 * foot ) * rCoarse * rNear;
  gRockTilt.x += sign( rillF ) * 0.7 * rill * rNear;
  // grass and scrub: on the ledges (facets that face up) in ragged tufts, and over the top's lip
  float ledge = gCut * smoothstep( 0.45, 0.7, gN.y ) * smoothstep( 0.3, 0.5, gDet.r + 0.35 * ( gDet2.r - 0.5 ) );
  float overLip = gCut * smoothstep( 0.0, 0.05, rFrac - 1.04 - 0.1 * ( gDet.r - 0.5 ) );
  float green = max( ledge, overLip );
  gGrass = mix( gGrass, mix( gGrass * 1.05, vec3( 0.028, 0.042, 0.018 ), smoothstep( 0.62, 0.78, gDet2.r ) ), green );
  gRock *= 1.0 - green;
  gRockRough = mix( gRockRough, 0.3, rDamp );
}
// the coast's grass is dry: olive and straw, sun-bleached (frame E1)
gGrass = mix( gGrass, mix( vec3( 0.06, 0.062, 0.026 ), vec3( 0.105, 0.088, 0.045 ), smoothstep( 0.3, 0.75, gMid.b + 0.3 * ( gDet.r - 0.5 ) ) ) * ( 0.8 + 0.4 * gDet.r ), 0.85 * gCoast );
vec3 gSnowCol = vec3( 0.72, 0.74, 0.78 ) * ( 0.9 + 0.2 * gDet.r ) * uSnowLight;

// (env lane) the verge: mown grass in stripes along the road, a strip of worn earth and loose stones along the
// kerbs' outer edge, longer grass at the foot of the barrier
float gVerge = ( 1.0 - step( 0.5, vVerge.w ) ) * ( 1.0 - smoothstep( 0.0, 1.5, vVerge.z ) );
float gVergeEarth = 0.0;
float gWoodBehind = gVerge > 0.0 ? clamp( vVerge.w / 0.4, 0.0, 1.0 ) : 0.0;
if ( gVerge > 0.0 ) {
  float vd = vVerge.x;
  float vAa = 0.6 * ( abs( dFdx( vd ) ) + abs( dFdy( vd ) ) ) + 1.0e-3;
  // the mower's passes: bands about 1.6 m wide whose blades lean one way or the other (a shade apart, no more:
  // frame D1's verge is evenly mown), (render lane, finish lane) an autumn green, GRASS.mown
  float pass = abs( fract( vd / 3.2 ) * 2.0 - 1.0 );
  float stripe = clamp( ( pass - 0.5 ) / max( vAa / 1.6, 1.0e-3 ) + 0.5, 0.0, 1.0 );
  stripe = mix( stripe, 0.5, smoothstep( 0.3, 1.0, vAa / 1.6 ) );
  vec3 mown = mix( ${v3(GRASS.mown[0])}, ${v3(GRASS.mown[1])}, stripe ) * ( 0.85 + 0.3 * gDet.r ) * ( 0.88 + 0.24 * gMid.r );
  // a wide run-off is mown to the kerb but for a ragged strip of worn earth along it (D1); a narrow verge with a
  // wall close by is rough grass in tufts with bare earth between them, most of it by the road (D3)
  float vWidth = vd - vVerge.z;
  float narrow = 1.0 - smoothstep( 4.5, 6.0, vWidth );
  float rag = 0.55 + 0.5 * ( gDet.b - 0.5 ) + 0.6 * ( gLarge.b - 0.5 ) + 0.4 * ( gDet2.r - 0.5 );
  float earth = 1.0 - smoothstep( rag - 0.15, rag + 0.15, vd );
  // (finish lane) a little less bare earth than it had: without the glow of the light through the blades, a narrow
  // verge under the woods read as all earth and leaves
  float bare = smoothstep( 0.5, 0.68, 0.55 * gDet2.r + 0.45 * gMid.a + 0.35 * ( 1.0 - smoothstep( 0.0, 2.2, vd ) ) - 0.2 * gDet.r );
  earth = max( earth, narrow * bare );
  vec3 earthCol = mix( vec3( 0.075, 0.058, 0.04 ), vec3( 0.15, 0.125, 0.095 ), gDet.b ) * ( 0.75 + 0.4 * gDet2.g );
  // a few stones thrown out onto the grass beyond it
  float stones = smoothstep( 0.82, 0.9, gDet.b ) * ( 1.0 - smoothstep( 0.4, 2.0, vd - rag ) );
  // long grass at the barrier's foot, and all over a narrow verge
  float rough = max( smoothstep( -1.2, -0.3, vVerge.z ), narrow );
  // (nearfield lane) beyond the mower's last pass, longer grass: a ragged but definite edge some metres out
  float vEdge = 4.2 + 1.6 * ( gDet2.r - 0.5 ) + 2.0 * ( gMid.r - 0.5 );
  rough = max( rough, 0.75 * smoothstep( vEdge - 0.25, vEdge + 0.25, vd ) );
  vec3 roughCol = gGrass * ( 0.75 + 0.7 * smoothstep( 0.35, 0.7, gDet.r ) );
  // (nearfield lane) sun-dried patches in the mown grass, metres across, with a clear edge
  vec3 dryCol = ${v3(GRASS.straw)} * ( 0.85 + 0.3 * gDet.r );
  mown = mix( mown, dryCol, 0.6 * smoothstep( 0.6, 0.66, 0.65 * gMid.a + 0.35 * gDet2.r ) );
  // (nearfield lane) blades: fine streaks along the mower's way, light tips and dark gaps, fading with distance
  float vFade = 1.0 - smoothstep( 0.02, 0.07, vAa );
  float blade = texture2D( uDetail, vec2( vd * 2.7, vVerge.y * 0.31 ) ).r;
  mown *= 1.0 + 0.35 * ( blade - 0.5 ) * vFade;
  // tufts left by the mower at the road's edge, in clumps
  float edgeTuft = smoothstep( 0.6, 0.66, gDet2.r + 0.25 * ( blade - 0.5 ) ) * ( 1.0 - smoothstep( 0.8, 1.8, vd ) );
  rough = max( rough, edgeTuft );
  vec3 vergeCol = mix( mown, roughCol, rough );
  // worn earth where cars cut over the edge: patches some metres long, with two wheels' tracks in them
  float cut = smoothstep( 0.66, 0.72, texture2D( uLarge, vec2( vVerge.y / 70.0, 0.37 ) ).r ) * ( 1.0 - smoothstep( 2.4, 3.2, vd ) );
  float tracks = cut * ( 1.0 - smoothstep( 0.18, 0.18 + vAa, abs( abs( vd - 1.2 - 0.3 * sin( vVerge.y / 9.0 ) ) - 0.8 ) ) );
  earth = max( earth, cut * smoothstep( 0.35, 0.55, gDet.r * 0.6 + gDet2.b * 0.4 ) );
  vergeCol = mix( vergeCol, earthCol, max( earth, stones * 0.8 ) );
  vergeCol *= 1.0 - 0.3 * tracks;
  // (nearfield lane) at the foot of whatever stands at the solid edge (rail, wall, rock): a strip of drainage gravel
  // with a dark line of dirt along its edge, all in the soft shade of what stands there; under woods the leaves
  // cover it
  {
    float gw = 0.6 + 0.2 * ( gDet2.g - 0.5 );
    float zAa = fwidth( vVerge.z ) + 1.0e-3;
    float strip = smoothstep( -gw - zAa, -gw + zAa, vVerge.z ) * ( 1.0 - 0.7 * gWoodBehind );
    float rim = ( 1.0 - smoothstep( 0.0, 0.08 + zAa, abs( vVerge.z + gw ) ) ) * ( 1.0 - 0.7 * gWoodBehind );
    vec3 gravelCol = mix( vec3( 0.15, 0.145, 0.135 ), vec3( 0.24, 0.23, 0.21 ), smoothstep( 0.35, 0.75, gDet.b ) ) * ( 0.8 + 0.3 * gDet2.g );
    gravelCol = mix( gravelCol, gScreeCol * 0.75, 0.5 * gCoast );
    vergeCol = mix( vergeCol, gravelCol, strip );
    vergeCol *= 1.0 - 0.45 * rim * gFade;
    vergeCol *= 1.0 - 0.35 * smoothstep( -0.8, 0.0, vVerge.z );
    gVergeEarth = max( gVergeEarth, strip );
  }
  // fallen leaves drifted against the barrier's foot under woods (frame D4)
  float leaves = gWoodBehind * smoothstep( -1.6, -0.4, vVerge.z + 0.6 * ( gDet2.r - 0.5 ) ) * smoothstep( 0.35, 0.6, gDet.a + 0.2 * gMid.r );
  vergeCol = mix( vergeCol, mix( vec3( 0.2, 0.075, 0.02 ), vec3( 0.09, 0.04, 0.015 ), gDet.b ), leaves );
  gGrass = mix( gGrass, vergeCol, gVerge );
  gVergeEarth = gVerge * max( max( earth, stones * 0.8 ), gVergeEarth );
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
    // (finish lane) the crops round the grass's own green: a damper meadow, a drier one, a darker pasture, stubble
    vec3 crop = fh < 0.35 ? gLush * 1.05 : fh < 0.6 ? gDry * 1.08 : fh < 0.85 ? gLush * 0.82 : ${v3(GRASS.straw)};
    vec2 fe = min( fract( fp ), 1.0 - fract( fp ) ) * vec2( 130.0, 75.0 );
    float fAa = fwidth( vGroundPos.x ) + fwidth( vGroundPos.z ) + 0.5;
    float hedge = 1.0 - smoothstep( 2.0, 2.0 + fAa, min( fe.x, fe.y ) );
    vec3 fieldCol = mix( crop * ( 0.85 + 0.3 * gMid.r ), vec3( 0.02, 0.035, 0.016 ), hedge * 0.8 );
    gGrass = mix( gGrass, fieldCol, fieldZone );
  }
}
// (env lane) clumps of trees and hedges across open meadow beyond the verge, so no slope reads as bare
float gClump = smoothstep( 0.6, 0.68, gMid.g * 0.7 + gLarge.b * 0.3 + ( gDet.r - 0.5 ) * 0.15 ) * ( 1.0 - gRock ) * step( 0.5, vVerge.w ) * ( 1.0 - smoothstep( 0.25, 0.4, gSlope ) ) * ( 1.0 - gScree ) * ( 1.0 - gCoast );
gForest = max( gForest, gClump );
// (nearfield lane, references n1 to n3) beside the road, the ground changes material in readable patches: dense
// carpets of low plants in clusters a few metres across (heather purple, bilberry red, gorse yellow, bracken
// rust), and near the sea pale sand, pebbles and bare slab; within about 45 m of the road (the band) and on the cut
// faces' ledges and lips, never on the mown verge itself
float gCarpet = 0.0;
{
  float nearRoad = vVerge.w < 0.9 ? ( 1.0 - smoothstep( 25.0, 45.0, vVerge.z ) ) * smoothstep( 0.6, 1.4, vVerge.z ) : 0.0;
  // (round 2) on banks and ledges, not over flat meadow (where they read as spilt paint)
  float where = max( nearRoad * ( 1.0 - gRock ) * smoothstep( 0.04, 0.1, gSlope ), gCut * ( 1.0 - gRock ) );
  float cluster = smoothstep( 0.6, 0.66, 0.55 * gDet2.r + 0.45 * gMid.a + 0.12 * ( gDet.r - 0.5 ) );
  // broken into tufts and gaps, not a sheet of colour
  gCarpet = where * cluster * ( 1.0 - gForest ) * smoothstep( 0.32, 0.45, gDet.r + 0.3 * ( gDet2.b - 0.5 ) );
  if ( gCarpet > 0.0 ) {
    float kind = texture2D( uLarge, vGroundPos.xz / 41.0 + vec2( 0.13, 0.71 ) ).g;
    vec3 plant = kind < 0.42 ? vec3( 0.2, 0.03, 0.085 ) : kind < 0.55 ? vec3( 0.26, 0.03, 0.015 ) : kind < 0.66 ? vec3( 0.34, 0.22, 0.015 ) : vec3( 0.25, 0.075, 0.018 );
    // the coast's are sedum and thrift: reds and pinks
    plant = mix( plant, kind < 0.5 ? vec3( 0.3, 0.025, 0.02 ) : vec3( 0.3, 0.07, 0.12 ), gCoast );
    plant *= 0.6 + 0.7 * smoothstep( 0.3, 0.75, gDet.r );
    gGrass = mix( gGrass, plant, gCarpet );
  }
  // the coast's ground in patches: pale sand, pebbles, bare slab
  float coastNear = gCoast * nearRoad * ( 1.0 - gRock ) * ( 1.0 - gCarpet ) * smoothstep( 0.12, 0.25, gSlope );
  if ( coastNear > 0.0 ) {
    float pk = texture2D( uLarge, vGroundPos.xz / 29.0 + vec2( 0.52, 0.27 ) ).b;
    float patchy = smoothstep( 0.55, 0.6, pk );
    vec3 sand = vec3( 0.42, 0.37, 0.28 ) * ( 0.85 + 0.3 * gDet.r );
    vec3 pebbles = mix( vec3( 0.2, 0.18, 0.15 ), vec3( 0.42, 0.39, 0.34 ), smoothstep( 0.4, 0.7, gDet.b ) );
    vec3 slab = vec3( 0.3, 0.29, 0.27 ) * ( 0.8 + 0.3 * gDetRock.g );
    vec3 ground = gMid.g < 0.45 ? sand : gMid.g < 0.6 ? pebbles : slab;
    gGrass = mix( gGrass, ground, patchy * coastNear );
    gCarpet = max( gCarpet, patchy * coastNear );
  }
}
// (nearfield lane, round 2: references W1, W4) on the coast, two grounds that are not grass:
// - the loose stone beside the coast road (aMask.y) is an orange-ochre fine gravel shoulder (W1), speckled, with
//   darker damp patches;
// - a beach (a strip low along the water's edge, the sea map) is fine golden sand, almost flat (W4): the faintest
//   wind ripples, faint tide lines along its contours, darker damp patches, tyre tracks along the road, sparse grass
//   at its back, and towards the water a darker band, wet to a mirror (gWetSand: smooth, it reflects the sky), whose
//   inner edge wavers as the run-up of the waves does. Pale under the shallows (below).
vec2 gSandTilt = vec2( 0.0 );
float gSand = 0.0;
float gWetSand = 0.0;
if ( gCoast > 0.01 ) {
  float beach = 0.0;
  float above = uSeaBox.w > -1000.0 ? vGroundPos.y - uSeaBox.w : 100.0;
  if ( uSeaBox.w > -1000.0 ) beach = ( 1.0 - smoothstep( 1.2, 3.0, above + 1.5 * ( gDet2.r - 0.5 ) ) ) * ( 1.0 - smoothstep( 0.25, 0.4, gSlope ) ) * ( 1.0 - smoothstep( 3.0, 9.0, seaLandOff( seaMapAt( vGroundPos.xz ) ) + 4.0 * ( gDet2.g - 0.5 ) ) );
  beach *= ( 1.0 - gRock ) * gNearLand;
  float shoulder = gScree * gNearLand;
  gSand = max( shoulder, beach ) * gCoast;
  if ( gSand > 0.01 ) {
    float px = fwidth( vGroundPos.x ) + fwidth( vGroundPos.z );
    // the shoulder's fine gravel
    float damp = smoothstep( 0.6, 0.7, gMid.a * 0.6 + gDet2.g * 0.4 );
    vec3 gravel = vec3( 0.5, 0.21, 0.075 ) * ( 0.82 + 0.3 * gDet.b ) * ( 1.0 - 0.28 * damp );
    gravel = mix( gravel, vec3( 0.3, 0.2, 0.15 ), smoothstep( 0.86, 0.92, gDet.b ) * 0.6 );
    gScreeCol = mix( gScreeCol, gravel, shoulder * gCoast );
    // the beach's sand
    float lit = mix( 1.0, sandRelief( vGroundPos, px, gSandTilt ), 0.25 * gFade );
    gSandTilt *= 0.25;
    vec3 sand = vec3( 0.55, 0.4, 0.22 ) * lit * ( 0.94 + 0.12 * gDet2.g );
    float tide = 1.0 - smoothstep( 0.0, 0.04 + px, abs( fract( above / 0.32 + 0.6 * ( gDet2.r - 0.5 ) ) - 0.5 ) * 0.32 - 0.14 );
    sand *= 1.0 - 0.1 * tide * gFade * ( 1.0 - smoothstep( 0.8, 1.6, above ) );
    sand *= 1.0 - 0.18 * smoothstep( 0.62, 0.7, gMid.b * 0.6 + gDet2.b * 0.4 );
    if ( vVerge.w < 0.9 ) {
      float lane = abs( abs( vVerge.x - 9.0 - 3.0 * sin( vVerge.y / 41.0 ) ) - 0.8 );
      sand *= 1.0 - 0.14 * ( 1.0 - smoothstep( 0.1, 0.1 + px, lane ) ) * gFade;
    }
    // sparse grass at the beach's back
    float grassy = smoothstep( 1.1, 1.8, above ) * smoothstep( 0.62, 0.7, gDet2.r + 0.2 * gMid.r );
    sand = mix( sand, gGrass * 1.1, grassy );
    // the wet band: its inner edge wavers with the run-up
    float runUp = 0.45 + 0.25 * sin( dot( vGroundPos.xz, vec2( 0.11, 0.07 ) ) ) + 0.15 * ( gDet2.g - 0.5 );
    float wet = 1.0 - smoothstep( runUp - 0.05, runUp + 0.12, above );
    sand *= 1.0 - 0.42 * wet;
    gWetSand = wet * beach * gCoast * ( 1.0 - grassy );
    gGrass = mix( gGrass, sand, beach * ( 1.0 - gScree ) * gCoast );
    gSandTilt *= beach * gCoast * ( 1.0 - wet );
  }
}
// (nearfield lane, round 2) hillsides with structure: a band of bare earth where turf breaks onto rock; the grass
// drier and paler on slopes that face the sun's side, darker and fuller on the steep shaded ones; on moderate slopes
// terraces of worn tracks along the contours
{
  float lipBand = smoothstep( 0.02, 0.25, gRock ) * ( 1.0 - smoothstep( 0.35, 0.7, gRock ) ) * ( 1.0 - gCut ) * gNearLand;
  gGrass = mix( gGrass, mix( vec3( 0.1, 0.075, 0.05 ), vec3( 0.2, 0.11, 0.05 ), gCoast ) * ( 0.8 + 0.4 * gDet.b ), lipBand * 0.85 );
  float hz = length( gN.xz );
  float sunny = hz > 0.05 ? smoothstep( -0.2, 0.6, dot( gN.xz / hz, vec2( 0.6, -0.8 ) ) ) * smoothstep( 0.05, 0.2, gSlope ) : 0.0;
  gGrass = mix( gGrass, ${v3(GRASS.straw)} * ( 0.8 + 0.4 * gDet.r ), 0.35 * sunny * gNearLand * ( 1.0 - gVerge ) );
  gGrass *= 1.0 - 0.2 * smoothstep( 0.12, 0.3, gSlope ) * ( 1.0 - sunny );
  float terr = smoothstep( 0.1, 0.16, gSlope ) * ( 1.0 - smoothstep( 0.3, 0.38, gSlope ) ) * gNearLand * ( 1.0 - gVerge );
  float tf = fract( vGroundPos.y / 1.7 + 0.5 * gDet2.r + 0.8 * gMid.b );
  gGrass *= 1.0 + terr * ( 0.12 * smoothstep( 0.72, 0.84, tf ) - 0.16 * smoothstep( 0.86, 1.0, tf ) );
}
// (nearfield lane) near the road the turf has fine, crisp structure: tufts a little darker and fuller, and grey rock
// breaking through on the steeper banks in outcrops a few metres across, with a dark rim
float gOutcrop = 0.0;
{
  float tuft = smoothstep( 0.62, 0.68, gDet.r ) * gNearLand * gFade;
  gGrass *= 1.0 - 0.18 * tuft;
  float bank = smoothstep( 0.07, 0.16, gSlope ) * ( 1.0 - gRock ) * ( 1.0 - gForest ) * gNearLand * ( 1.0 - gVerge );
  float o = 0.6 * gDet2.g + 0.4 * gMid.a + 0.15 * smoothstep( 0.15, 0.3, gSlope );
  gOutcrop = smoothstep( 0.66, 0.68, o ) * bank;
  float oRim = ( smoothstep( 0.63, 0.66, o ) - smoothstep( 0.66, 0.68, o ) ) * bank;
  gGrass *= 1.0 - 0.35 * oRim;
}
vec3 gAlbedo = gGrass;
// blades let some light through, the mown verge most (bare earth none)
groundGrass = ( 1.0 - gRock ) * ( 1.0 - gScree ) * ( 1.0 - gForest ) * ( 1.0 - gVergeEarth ) * ( 1.0 - gCarpet ) * ( 1.0 - gSand );
// (render lane, finish lane) the light through the blades is the grass's own green (GRASS.through), about twice
// what the blades reflect: against the low sun the verge is brighter, as autumn grass, not a neon glow
groundThrough = ${v3(GRASS.through)} * ( 0.6 + 0.4 * gVerge ) * groundGrass * gFade;
gAlbedo = mix( gAlbedo, vec3( 0.03, 0.045, 0.02 ) * ( 0.7 + 0.6 * gDet.r ), gScrub * 0.85 );
gAlbedo = mix( gAlbedo, gForestCol, gForest );
// (seen from the road a clump is crowns, not forest floor)
gAlbedo = mix( gAlbedo, gCanopy * 1.3, gClump * ( 1.0 - min( vMask.x * 3.0, 1.0 ) ) );
gAlbedo = mix( gAlbedo, gScreeCol, gScree );
gAlbedo = mix( gAlbedo, mix( vec3( 0.2, 0.198, 0.19 ), vec3( 0.3, 0.2, 0.12 ), gCoast ) * ( 0.75 + 0.5 * gDetRock.g ), gOutcrop );
gAlbedo = mix( gAlbedo, gRockCol, gRock );
gAlbedo = mix( gAlbedo, gSnowCol, gSnow );
gAlbedo *= 1.0 - 0.55 * gWetBand;
// (nearfield lane, references n1 to n3) under the shallows, pale sand: the water over it reads clear and turquoise
if ( uSeaBox.w > -1000.0 ) {
  float under = ( 1.0 - smoothstep( -0.3, 0.1, vGroundPos.y - uSeaBox.w ) ) * ( 1.0 - smoothstep( 2.0, 7.0, uSeaBox.w - vGroundPos.y ) );
  gAlbedo = mix( gAlbedo, vec3( 0.46, 0.42, 0.33 ) * ( 0.85 + 0.3 * gDet.b ), under * gCoast );
}
diffuseColor.rgb *= gAlbedo;
// Seen against a low sun a plain rough surface glares (its Fresnel term goes to one at a grazing angle): rock and
// stones do, a little; turf and tree crowns do not (the far land under the massif stood as a white band in the haze)
groundSheen = 1.0 - 0.85 * max( groundGrass, gForest * ( 1.0 - gRock ) ) - 0.5 * gVergeEarth;
groundRoughness = mix( mix( 1.0, 0.92, gScree ), gRockRough, gRock );
groundRoughness = mix( groundRoughness, 0.55, gSnow );
// (round 2) the beach wet to a mirror
groundRoughness = mix( groundRoughness, 0.07, gWetSand );
groundSheen = mix( groundSheen, 1.0, gWetSand );
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
  // (nearfield lane) the sand's swells and ripples
  nw = normalize( nw + vec3( gSandTilt.x, 0.0, gSandTilt.y ) );
  // (nearfield lane) each block of rock its own plane, its lip and foot bevelled (gRockTilt: along the face, up it)
  float hl = length( gN.xz );
  if ( gRock > 0.01 && hl > 0.2 ) {
    vec3 al = vec3( -gN.z, 0.0, gN.x ) / hl;
    nw = normalize( nw + ( al * gRockTilt.x + cross( al, gN ) * gRockTilt.y ) * gRock );
  }
  normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
}
`;
