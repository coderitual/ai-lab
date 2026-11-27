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
import { GOLDWOOD } from './goldwood.js';
import { ARM } from './arm.js';

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
  /**
   * (ref lane) The alpine meadow on a tunnel's approach (approach.js; the reference is photograph R1): a lush, sunlit
   * hay meadow, far greener and lighter than the autumn grass round the rest of the lap, mottled with a yellower
   * green where it has gone to seed. Only where the terrain marks it (a negative aMask.y).
   */
  alp: [0.097, 0.2, 0.043],
  alpSeed: [0.165, 0.21, 0.048],
  /** its hollows (damper, darker, bluer) and its trodden paths (pale earth and short grass) */
  alpHollow: [0.05, 0.122, 0.044],
  alpPath: [0.2, 0.19, 0.12],
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
    /**
     * The lakeside (lakeside.js `paint`; all zero without it): its frame on the map (origin x, z and the unit vector
     * along the road), its meadow's box in that frame (u0, u1, v0, v1), the box's soft edge (m) with the water's
     * level, the meadow's two greens, and the eye of its pass (x, z) for the far range's streaks of snow.
     */
    uSideFrame: { value: new THREE.Vector4(0, 0, 1, 0) },
    uSideBox: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSideSoft: { value: new THREE.Vector2(1, -1e4) },
    uSideLit: { value: new THREE.Vector3() },
    uSideHollow: { value: new THREE.Vector3() },
    uSideEye: { value: new THREE.Vector2() },
    /**
     * The arm of the lake (arm.js `paint`; all zero without it): its frame on the map, its bank's box in that frame
     * (u0, u1, the greatest v, the water's level) and the long right's arc (where it begins along u, its radius,
     * and from how far beyond the road's centre line the bank's grass is painted: from, full).
     */
    uArmFrame: { value: new THREE.Vector4(0, 0, 1, 0) },
    uArmBox: { value: new THREE.Vector4(0, 0, 0, -1e4) },
    uArmArc: { value: new THREE.Vector4(0, 1, 0, 1) },
    /** The eye of its valley (x, z): the spurs' and the range's patterns are laid out round it. */
    uArmEye: { value: new THREE.Vector2() },
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
    /** @param {{ ox: number, oz: number, tx: number, tz: number, meadow: object, eye: number[], level: number }|null} paint lakeside.js `paint` */
    setLakeside(paint) {
      if (!paint) return;
      const m = paint.meadow;
      uniforms.uSideFrame.value.set(paint.ox, paint.oz, paint.tx, paint.tz);
      uniforms.uSideBox.value.set(m.u[0], m.u[1], m.v[0], m.v[1]);
      uniforms.uSideSoft.value.set(m.soft, paint.level);
      uniforms.uSideLit.value.fromArray(m.lit);
      uniforms.uSideHollow.value.fromArray(m.hollow);
      uniforms.uSideEye.value.fromArray(paint.eye);
    },
    /** @param {object|null} paint arm.js `paint` */
    setArm(paint) {
      if (!paint) return;
      uniforms.uArmFrame.value.set(paint.ox, paint.oz, paint.tx, paint.tz);
      uniforms.uArmBox.value.set(paint.box[0], paint.box[1], paint.box[2], paint.level);
      uniforms.uArmArc.value.set(paint.begin, paint.radius, paint.clear[0], paint.clear[1]);
      uniforms.uArmEye.value.fromArray(paint.eye);
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
uniform vec4 uSideFrame;
uniform vec4 uSideBox;
uniform vec2 uSideSoft;
uniform vec3 uSideLit;
uniform vec3 uSideHollow;
uniform vec2 uSideEye;
uniform vec4 uArmFrame;
uniform vec4 uArmBox;
uniform vec4 uArmArc;
uniform vec2 uArmEye;
varying vec2 vMask;
varying vec4 vVerge;  // the band beside the road: m beyond the margin, s, m beyond the barrier, 0 (1 elsewhere)
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
float groundRoughness;
vec3 groundThrough;  // what the grass here lets through (0 where it is not grass)
float groundGrass;   // how much of this pixel is blades of grass
float groundSheen;   // how much of a plain rough surface's sheen it keeps (blades and crowns: next to none)
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
// (the arm of the lake: under its dark wood, a forest mask over 1, steep ground is wooded too, not bare rock)
gRock *= 1.0 - 0.9 * smoothstep( 1.02, 1.3, vMask.x ) * ( 1.0 - gCut );
// (ref lane) a negative aMask.y marks the meadow of a tunnel's approach: grass on slopes that would be rock or
// scrub elsewhere, no scree, no clumps of wood
float gMeadow = clamp( -vMask.y, 0.0, 1.0 );
gRock = mix( gRock, gCut + ( 1.0 - gCut ) * smoothstep( 0.4, 0.52, gSlope ), gMeadow );
float gScree = max( min( vMask.y, 1.0 ), smoothstep( 0.68, 0.8, gMid.a ) * smoothstep( 0.12, 0.25, gSlope ) * 0.7 * ( 1.0 - gMeadow ) * ( 1.0 - 0.9 * smoothstep( 1.02, 1.3, vMask.x ) ) ) * ( 1.0 - gRock );
// (env lane) scrub: dark clumps of box and juniper on the moderate slopes, between meadow and rock
float gScrub = smoothstep( 0.06, 0.16, gSlope + ( gMid.b - 0.5 ) * 0.12 ) * smoothstep( 0.35, 0.6, gDet.r * 0.5 + gMid.g * 0.7 ) * ( 1.0 - gRock ) * ( 1.0 - gMeadow );
// (env lane) the wood's edge broken by clumps of crowns, not a soft blend
float gForest = smoothstep( 0.3, 0.6, vMask.x + ( gMid.b - 0.5 ) * 0.5 + ( gLarge.b - 0.5 ) * 0.3 ) * step( 0.02, vMask.x ) * ( 1.0 - gRock );
// (env lane: no snow on the hills round the circuit; the far massif is the SKY lane's)
// (lakeside: but for the far range that closes the pass beyond the tarn, where the terrain asks for it with a
// negative forest mask: that much snow, lying in streaks and patches, not on the steepest rock)
// (streaks: the snow lies in the gullies, which run down the range's face, towards and away from the place it is seen
// from; so its pattern is fine across that line and long along it)
float gSnowAsk = clamp( -vMask.x, 0.0, 1.0 );
float gSnow = 0.0;
if ( gSnowAsk > 0.0 ) {
  vec2 sd = vGroundPos.xz - uSideEye;
  float streak = texture2D( uLarge, vec2( atan( sd.y, sd.x ) * 9.0, length( sd ) / 2600.0 ) ).a;
  float fine = texture2D( uLarge, vec2( atan( sd.y, sd.x ) * 31.0, length( sd ) / 900.0 ) ).r;
  gSnow = smoothstep( 0.4, 0.56, 0.6 * streak + 0.4 * fine + 0.75 * ( gSnowAsk - 0.5 ) ) * ( 1.0 - smoothstep( 0.55, 0.8, gSlope ) );
}

// meadow: lush where gLarge.r is low, dry and paler where it is high, higher up a little browner
vec3 gLush = ${v3(GRASS.lush)};
vec3 gDry = ${v3(GRASS.dry)};
vec3 gGrass = mix( gLush, gDry, smoothstep( 0.45, 0.85, gLarge.r + vGroundPos.y * 0.001 ) );
gGrass *= 0.78 + 0.44 * gDet.r;
gGrass = mix( gGrass, ${v3(GRASS.straw)} * ( 0.8 + 0.4 * gDet.r ), smoothstep( 0.6, 0.85, gMid.b ) * 0.5 );
gGrass *= 0.72 + 0.56 * gMid.r;
{
  // the alpine meadow: its own green, mottled at the detail's scale and in broad swathes gone to seed
  // Its tone has structure at every scale: broad swathes lighter and yellower on the rises and darker and bluer in
  // the hollows (two fields, about 90 m and 35 m), terracettes (the level steps cattle tread into a slope: thin dark
  // lines along the contours, a metre or so apart, only where it is steep), the mower's swathes across the gentler
  // ground, a few pale trodden paths (the thin lines where a broad field crosses its middle), and the blades' own
  // fine noise.
  vec4 gAlpA = texture2D( uLarge, vGroundPos.xz / 37.0 + vec2( 0.13, 0.71 ) );
  float swell = 0.55 * gMid.b + 0.3 * gAlpA.r + 0.15 * gLarge.r;
  vec3 alp = mix( ${v3(GRASS.alp)}, ${v3(GRASS.alpSeed)}, smoothstep( 0.5, 0.72, swell ) * 0.8 );
  alp = mix( alp, ${v3(GRASS.alpHollow)}, smoothstep( 0.5, 0.3, swell ) * 0.75 );
  float terrace = vGroundPos.y / 1.15 + 1.6 * gAlpA.g + 0.5 * gDet.g;
  float tStep = smoothstep( 0.0, 0.16, fract( terrace ) ) * ( 1.0 - smoothstep( 0.2, 0.36, fract( terrace ) ) );
  float tread = tStep * smoothstep( 0.06, 0.14, gSlope ) * ( 1.0 - smoothstep( 60.0, 240.0, gDist ) * 0.6 );
  alp *= 1.0 - 0.3 * tread;
  float swathe = abs( fract( ( vGroundPos.x * 0.8 + vGroundPos.z * 0.6 ) / 5.2 + 0.5 * gAlpA.b ) * 2.0 - 1.0 );
  alp *= 1.0 + 0.1 * ( smoothstep( 0.35, 0.65, swathe ) - 0.5 ) * ( 1.0 - smoothstep( 0.05, 0.12, gSlope ) );
  float path = ( 1.0 - smoothstep( 0.004, 0.013, abs( texture2D( uLarge, vGroundPos.xz / 310.0 + vec2( 0.4, 0.2 ) ).b - 0.5 ) ) ) * smoothstep( 0.45, 0.6, gLarge.g );
  alp = mix( alp, ${v3(GRASS.alpPath)} * ( 0.8 + 0.4 * gDet.b ), path * 0.55 );
  alp *= ( 0.78 + 0.44 * gDet.r ) * ( 0.9 + 0.2 * gMid.r ) * ( 0.9 + 0.2 * gDet2.r );
  gGrass = mix( gGrass, alp, gMeadow );
}
// (lakeside) the meadow between the road and the tarn: long grass in the photograph's warm green, lighter on the
// rises and where the blades catch the light, darker in the hollows and between the tussocks, with a fine grain
float gSide = 0.0;
{
  vec2 sp = vGroundPos.xz - uSideFrame.xy;
  float su = dot( sp, uSideFrame.zw );
  float sv = dot( sp, vec2( uSideFrame.w, -uSideFrame.z ) );
  gSide = smoothstep( uSideBox.x, uSideBox.x + uSideSoft.x, su ) * ( 1.0 - smoothstep( uSideBox.y - uSideSoft.x, uSideBox.y, su ) )
    * smoothstep( uSideBox.z, uSideBox.z + 3.0, sv ) * ( 1.0 - smoothstep( uSideBox.w - uSideSoft.x, uSideBox.w, sv ) )
    * smoothstep( uSideSoft.y - 0.4, uSideSoft.y + 0.5, vGroundPos.y );
  if ( gSide > 0.0 ) {
    // tone at three scales: swathes lighter on the rises and darker and greener in the hollows (fields of about
    // 35 m and 11 m), tussocks at the detail's scale, and the blades' own fine grain
    float swell = texture2D( uLarge, vGroundPos.xz / 37.0 ).b;
    float gSward = texture2D( uLarge, vGroundPos.xz / 11.0 + vec2( 0.31, 0.57 ) ).r;
    float tussock = smoothstep( 0.3, 0.75, 0.6 * gDet.r + 0.4 * gMid.r );
    float gLit = smoothstep( 0.38, 0.62, 0.45 * swell + 0.4 * gSward + 0.15 * gMid.b );
    vec3 meadow = mix( uSideHollow, uSideLit, clamp( 0.12 + 0.7 * gLit + 0.3 * tussock, 0.0, 1.0 ) );
    meadow *= ( 0.8 + 0.4 * gDet2.r ) * ( 0.88 + 0.24 * gDet.r );
    gGrass = mix( gGrass, meadow, gSide );
  }
}
// (the arm of the lake) the bank between the road and the water: long uneven grass, darker and greyer than the
// lap's verges, in the same structure as the lakeside's meadow; found per pixel from the place's frame (on the
// water's side of the road: beyond its centre line on the straight, outside its arc in the long right)
float gArm = 0.0;
{
  vec2 ap = vGroundPos.xz - uArmFrame.xy;
  float au = dot( ap, uArmFrame.zw );
  float av = dot( ap, vec2( uArmFrame.w, -uArmFrame.z ) );
  float aRoad = au < uArmArc.x ? av : length( vec2( au - uArmArc.x, av + uArmArc.y ) ) - uArmArc.y;
  gArm = smoothstep( uArmArc.z, uArmArc.w, aRoad ) * smoothstep( uArmBox.x, uArmBox.x + 30.0, au ) * ( 1.0 - smoothstep( uArmBox.y - 70.0, uArmBox.y, au ) )
    * ( 1.0 - smoothstep( uArmBox.z - 50.0, uArmBox.z, av ) ) * smoothstep( uArmBox.w + 0.2, uArmBox.w + 1.4, vGroundPos.y );
  if ( gArm > 0.0 ) {
    float swell = texture2D( uLarge, vGroundPos.xz / 41.0 + vec2( 0.6, 0.2 ) ).b;
    float gSward = texture2D( uLarge, vGroundPos.xz / 13.0 + vec2( 0.11, 0.47 ) ).r;
    float tussock = smoothstep( 0.3, 0.75, 0.6 * gDet.r + 0.4 * gMid.r );
    float gLit = smoothstep( 0.36, 0.64, 0.45 * swell + 0.4 * gSward + 0.15 * gMid.b );
    vec3 bank = mix( ${v3(ARM.paint.hollow)}, ${v3(ARM.paint.lit)}, clamp( 0.1 + 0.65 * gLit + 0.3 * tussock, 0.0, 1.0 ) );
    bank *= ( 0.8 + 0.4 * gDet2.r ) * ( 0.88 + 0.24 * gDet.r );
    gGrass = mix( gGrass, bank, gArm );
  }
}
// forest floor near, the canopy's colour far away
vec3 gFloor = vec3( 0.04, 0.034, 0.024 ) * ( 0.7 + 0.6 * gDet.a );
vec3 gCanopy = vec3( 0.02, 0.034, 0.017 ) * ( 0.7 + 0.5 * gLarge.b ) * ( 0.75 + 0.5 * gMid.r );
// (the arm of the lake: a forest mask over 1 is its dark wood, on the far shores and the spurs beyond: conifers
// seen from far off, darker and bluer than the lap's broadleaf canopy. No trees are drawn that far out, so the wood
// is painted: stands of darker and lighter crowns at two scales, clearings of a paler green, and the shade of the
// gullies that run down the slope. Each spur further up the valley is paler and bluer than the one before it: the
// air between, laid on by hand over the distance from the valley's eye, because the day's haze alone leaves two
// spurs a kilometre apart the same tone.)
float gDark = smoothstep( 1.02, 1.3, vMask.x );
if ( gDark > 0.0 ) {
  float dStand = texture2D( uLarge, vGroundPos.xz / 173.0 + vec2( 0.21, 0.63 ) ).r;
  float dCrown = texture2D( uLarge, vGroundPos.xz / 47.0 + vec2( 0.55, 0.17 ) ).b;
  float dClear = smoothstep( 0.66, 0.76, texture2D( uLarge, vGroundPos.xz / 137.0 + vec2( 0.77, 0.31 ) ).g );
  float dGully = texture2D( uLarge, vec2( ( vGroundPos.x * 0.6 + vGroundPos.z * 0.8 ) / 90.0, vGroundPos.y / 260.0 ) ).a;
  vec3 wood = vec3( 0.0085, 0.017, 0.0105 ) * ( 0.62 + 0.5 * dStand + 0.45 * dCrown ) * ( 1.0 - 0.35 * smoothstep( 0.55, 0.8, dGully ) );
  wood = mix( wood, vec3( 0.017, 0.028, 0.014 ) * ( 0.8 + 0.4 * dCrown ), dClear * 0.6 );
  float dAir = smoothstep( 1100.0, 3400.0, length( vGroundPos.xz - uArmEye ) );
  wood = mix( wood, vec3( 0.055, 0.075, 0.105 ), dAir * 0.62 );
  gCanopy = mix( gCanopy, wood, gDark );
}
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
// (lakeside) aMask.y = 3: a weathered cut in darker, browner stone under lichen and moss (the photograph r2's bank)
gLime = mix( gLime, gLime * vec3( 0.43, 0.37, 0.29 ) * ( 0.75 + 0.5 * gDet.r ), step( 2.5, vMask.y ) );
gRockCol = mix( gRockCol, gLime, gCut );
vec3 gSnowCol = vec3( 0.72, 0.74, 0.78 ) * ( 0.9 + 0.2 * gDet.r ) * uSnowLight;

// (env lane) the verge: mown grass in stripes along the road, a strip of worn earth and loose stones along the
// kerbs' outer edge, longer grass at the foot of the barrier
float gVerge = ( 1.0 - step( 0.5, vVerge.w ) ) * ( 1.0 - smoothstep( 0.0, 1.5, vVerge.z ) );
// (the golden wood, goldwood.js) the terrain marks the band beside the road there with up to 0.09 more in vVerge.w.
// Fallen leaves at two scales that never line up: single leaves and small drifts (the detail's litter channel,
// about 10 cm a texel, fading with distance to their mean) and patches a few metres across; each fleck one of three
// tones.
float gGold = ( 1.0 - step( 0.5, vVerge.w ) ) * clamp( ( vVerge.w - 0.4 ) / 0.09, 0.0, 1.0 );
float gLeafA = 0.0;
float gLeafB = 0.0;
vec3 gLeafCol = vec3( 0.0 );
if ( gGold > 0.0 ) {
  gLeafA = 0.55 * gDet.a + 0.45 * gDet2.a;
  gLeafB = smoothstep( 0.5, 0.75, 0.6 * gMid.a + 0.4 * gDet.r );
  float which = fract( gDet2.b * 3.0 + gMid.r * 2.0 );
  gLeafCol = which < 0.45 ? ${v3(GOLDWOOD.ground.leaf[0])} : which < 0.8 ? ${v3(GOLDWOOD.ground.leaf[1])} : ${v3(GOLDWOOD.ground.leaf[2])};
  gLeafCol *= 0.75 + 0.5 * gDet2.g;
}
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
  earth = max( earth, narrow * bare * ( 1.0 - gMeadow ) );
  vec3 earthCol = mix( vec3( 0.075, 0.058, 0.04 ), vec3( 0.15, 0.125, 0.095 ), gDet.b ) * ( 0.75 + 0.4 * gDet2.g );
  // a few stones thrown out onto the grass beyond it
  float stones = smoothstep( 0.82, 0.9, gDet.b ) * ( 1.0 - smoothstep( 0.4, 2.0, vd - rag ) );
  // long grass at the barrier's foot, and all over a narrow verge
  float rough = max( max( smoothstep( -1.2, -0.3, vVerge.z ), narrow ), gMeadow );
  vec3 roughCol = gGrass * ( 0.75 + 0.7 * smoothstep( 0.35, 0.7, gDet.r ) );
  vec3 vergeCol = mix( mown, roughCol, rough );
  vergeCol = mix( vergeCol, earthCol, max( earth, stones * 0.8 ) );
  // fallen leaves drifted against the barrier's foot under woods (frame D4)
  float leaves = gWoodBehind * ( 1.0 - gMeadow ) * smoothstep( -1.6, -0.4, vVerge.z + 0.6 * ( gDet2.r - 0.5 ) ) * smoothstep( 0.35, 0.6, gDet.a + 0.2 * gMid.r );
  vergeCol = mix( vergeCol, mix( vec3( 0.2, 0.075, 0.02 ), vec3( 0.09, 0.04, 0.015 ), gDet.b ), leaves );
  // (the golden wood) its verge: pale dry grass, long and unmown, the worn earth along the kerb kept; fallen leaves
  // lie over it in flecks of gold, orange and brown, thickest in a drift along the paved margin and at the
  // barrier's foot
  if ( gGold > 0.0 ) {
    vec3 pale = ${v3(GOLDWOOD.ground.pale)} * ( 0.7 + 0.6 * gDet.r ) * ( 0.85 + 0.3 * gMid.r ) * ( 0.85 + 0.3 * gDet2.r );
    vec3 dry = mix( pale, earthCol, max( earth, stones * 0.8 ) * 0.8 );
    float drift = max( 1.0 - smoothstep( 0.0, ${GOLDWOOD.ground.drift.toFixed(2)}, vd + 0.5 * ( gDet2.r - 0.5 ) ), smoothstep( -1.8, -0.2, vVerge.z ) * 0.8 );
    float fleck = smoothstep( 0.62 - 0.34 * drift, 0.7 - 0.3 * drift, gLeafA ) * ( 0.45 + 0.55 * drift );
    // (far off, where the detail has faded to its mean, the share of the ground the leaves cover)
    fleck = mix( 0.12 + 0.6 * drift, fleck, gFade );
    dry = mix( dry, gLeafCol, max( fleck, gLeafB * 0.5 ) );
    vergeCol = mix( vergeCol, dry, gGold );
    earth *= 1.0 - 0.6 * gGold;
  }
  gGrass = mix( gGrass, vergeCol, gVerge );
  gVergeEarth = gVerge * max( earth, stones * 0.8 );
  gScree *= 1.0 - gVerge;
  gForest *= 1.0 - gVerge;
}
// (env lane) fields on the valley floor: a patchwork of meadows and crops between hedges, far from the road
{
  float fieldZone = ( 1.0 - smoothstep( 0.05, 0.12, gSlope ) ) * ( 1.0 - smoothstep( 40.0, 90.0, vGroundPos.y ) ) * step( 0.5, vVerge.w ) * smoothstep( 60.0, 140.0, gDist ) * ( 1.0 - gArm );
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
float gClump = smoothstep( 0.6, 0.68, gMid.g * 0.7 + gLarge.b * 0.3 + ( gDet.r - 0.5 ) * 0.15 ) * ( 1.0 - gRock ) * step( 0.5, vVerge.w ) * ( 1.0 - smoothstep( 0.25, 0.4, gSlope ) ) * ( 1.0 - gMeadow ) * ( 1.0 - gArm );
gForest = max( gForest, gClump );
vec3 gAlbedo = gGrass;
// blades let some light through, the mown verge most (bare earth none)
groundGrass = ( 1.0 - gRock ) * ( 1.0 - gScree ) * ( 1.0 - gForest ) * ( 1.0 - gVergeEarth );
// (render lane, finish lane) the light through the blades is the grass's own green (GRASS.through), about twice
// what the blades reflect: against the low sun the verge is brighter, as autumn grass, not a neon glow
groundThrough = ${v3(GRASS.through)} * ( 0.6 + 0.4 * gVerge ) * groundGrass * gFade;
gAlbedo = mix( gAlbedo, vec3( 0.03, 0.045, 0.02 ) * ( 0.7 + 0.6 * gDet.r ), gScrub * 0.85 );
gAlbedo = mix( gAlbedo, gForestCol, gForest );
// (the golden wood) behind its barrier the wood's floor is litter: this year's leaves over pale grass, fading into
// the lap's own floor further in
if ( gGold > 0.0 ) {
  float gIn = gGold * ( 1.0 - gVerge ) * ( 1.0 - smoothstep( ${GOLDWOOD.ground.floor[0].toFixed(1)}, ${GOLDWOOD.ground.floor[1].toFixed(1)}, vVerge.z ) ) * ( 1.0 - gRock );
  vec3 floorCol = mix( ${v3(GOLDWOOD.ground.pale)} * ( 0.6 + 0.6 * gDet.r ) * ( 0.8 + 0.4 * gMid.r ), gLeafCol, clamp( 0.35 + 0.5 * smoothstep( 0.4, 0.62, gLeafA ) + 0.3 * gLeafB, 0.0, 1.0 ) );
  gAlbedo = mix( gAlbedo, floorCol, gIn );
}
// (seen from the road a clump is crowns, not forest floor)
gAlbedo = mix( gAlbedo, gCanopy * 1.3, gClump * ( 1.0 - clamp( vMask.x * 3.0, 0.0, 1.0 ) ) );
gAlbedo = mix( gAlbedo, gScreeCol, gScree );
gAlbedo = mix( gAlbedo, gRockCol, gRock );
gAlbedo = mix( gAlbedo, gSnowCol, gSnow );
// (the arm of the lake) the range that closes its valley: aMask.y = 5 marks it, plus how much snow the place asks
// for (arm.js rangeAt: from its own shape). Pale warm grey rock, darker in the creases that run down its
// face (a pattern laid out round the valley's eye: fine across the bearing, long down the fall line), and snow as
// a thin broken dusting: it lies where the place asks, breaks up along the same creases and at the detail's grain,
// and has a hard edge.
float gRange = step( 4.5, vMask.y );
if ( gRange > 0.0 ) {
  vec2 rd = vGroundPos.xz - uArmEye;
  float ra = atan( rd.y, rd.x );
  float rr = length( rd );
  float crease = texture2D( uLarge, vec2( ra * 19.0, rr / 2100.0 ) ).a;
  float crease2 = texture2D( uLarge, vec2( ra * 53.0, rr / 900.0 ) ).r;
  float grain = texture2D( uLarge, vGroundPos.xz / 71.0 + vec2( 0.3, 0.8 ) ).g;
  float bed = texture2D( uLarge, vec2( ra * 9.0, vGroundPos.y / 190.0 ) ).b;
  vec3 rock = mix( vec3( 0.165, 0.152, 0.134 ), vec3( 0.31, 0.288, 0.248 ), smoothstep( 0.3, 0.72, 0.34 * crease + 0.22 * crease2 + 0.22 * bed + 0.22 * grain ) ) * ( 0.86 + 0.28 * grain );
  float ask = clamp( vMask.y - 5.0, 0.0, 1.0 );
  // (a dusting: where the place asks for little it lies only in the creases, in flecks; higher up it closes, and
  // the rock still shows through it in the creases' own pattern)
  // (its lower edge breaks up in flecks, by a grain with no direction: an edge broken along the creases hangs
  // like paint running down)
  float fleck = 0.5 * grain + 0.5 * texture2D( uLarge, vGroundPos.xz / 29.0 + vec2( 0.9, 0.4 ) ).r;
  float snow = smoothstep( 0.46, 0.54, ask * 1.15 + 0.7 * ( fleck - 0.5 ) * ( 1.0 - 0.45 * ask ) ) * step( 0.02, ask );
  snow *= 1.0 - 0.85 * smoothstep( 0.56, 0.7, 0.55 * crease + 0.45 * crease2 ) * ( 1.0 - 0.5 * ask );
  gSnow = snow * ( 0.5 + 0.3 * ask );
  gAlbedo = mix( rock, gSnowCol, gSnow );
}
diffuseColor.rgb *= gAlbedo;
// Seen against a low sun a plain rough surface glares (its Fresnel term goes to one at a grazing angle): rock and
// stones do, a little; turf and tree crowns do not (the far land under the massif stood as a white band in the haze)
groundSheen = ( 1.0 - 0.85 * max( groundGrass, gForest * ( 1.0 - gRock ) ) - 0.5 * gVergeEarth ) * ( 1.0 - 0.7 * gRange );
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
