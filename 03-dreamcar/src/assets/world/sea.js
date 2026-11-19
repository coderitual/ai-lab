// The sea: open water to the horizon beyond the coast road, and the bay
// beside the start straight, which is the same water. Demo 01's sea brought
// into this frame.
//
// WHERE. The terrain says where the water is (terrain.sea: its level, which
// points are sea, and the sea map, a texture of the depth and of how far land
// and water are from each other). The water is one level surface drawn
// everywhere round the eye; the land covers it wherever it stands above it,
// and the terrain keeps every hollow that is not the sea's above the water.
//
// THE MESH (one draw call): a disc of rings round the eye, dense near it and
// sparse towards the horizon (01's radial grid), out to just inside the
// view's far plane. On medium and high the swell moves it (engine/waves.js);
// on low it is a flat disc of a few hundred triangles and the waves are in
// the normals only.
//
// THE SHADING is 01's, in this frame's terms: a MeshStandardMaterial, so the
// sun or the moon, the sky's environment map, the fill and the haze reach it
// as they reach everything else, and the time of day's light is the only
// colour it is given. Per pixel:
//  - the normal: the waves' analytic slopes (each wave faded out where it is
//    smaller than a pixel) and drifting ripples from a tiling normal map; the
//    slope variance that is faded out goes into the roughness, so far away
//    the sun's glitter widens into a soft path instead of aliasing;
//  - the reflection: the sky's environment map with water's Fresnel (F0 0.02),
//    the reflected ray kept above the horizon as 01 keeps it;
//  - the body: a dark blue albedo (the light that comes back up out of deep
//    water), greener and lighter where the sea map says the water is shallow,
//    and a little light through the tops of the waves when looking sunwards;
//  - foam: streaks behind the swell's crests where it bunches up, and the surf
//    where the swell meets the shore (the sea map's distance to land), in
//    bands that run in with it;
//  - at night the nearest lamps (the road's glints, lamps.js) as long streaks.
// Far out the water fades into exactly the colour the sky dome shows under
// the horizon, so the mesh's edge never shows. The waves' clock is the run's.

import * as THREE from 'three';
import { createWaveField, SEA_HEIGHT, WAVES } from '../../engine/waves.js';
import { gradientField, normalTexture, valueField, worleyField, fieldTexture } from '../../engine/noise.js';
import { extend } from './shading.js';

/**
 * Per tier: the mesh's angular segments (its rings grow to keep the cells square), whether the waves move it, how
 * many waves the normals sum (WAVES, longest first), the ripple map's layers, and how many lamps it mirrors at night.
 */
const TIER = {
  low: { segments: 32, displace: false, waves: 7, ripples: 2, lamps: 6 },
  medium: { segments: 96, displace: true, waves: 9, ripples: 3, lamps: 6 },
  high: { segments: 160, displace: true, waves: WAVES.length, ripples: 3, lamps: 6 },
};

/**
 * The water's own numbers (linear albedos: what comes back up out of it, lit by whatever light the time of day has).
 * deep: open water; shallow: over a rocky bed a few metres down; scatter: the light that comes through the top of
 * a wave towards the eye, per unit of the sun's; foam: white water's albedo; ripple: the normal map's metres per
 * repeat and its slopes; rough: the calm surface's roughness; reach: share of the far plane the disc reaches.
 */
export const SEA_LOOK = {
  // (round 2, frame E1: from the coast road high above, a deep saturated blue; round 1's was near black)
  deep: [0.0028, 0.013, 0.036],
  shallow: [0.012, 0.034, 0.031],
  scatter: [0.0, 0.0045, 0.0036],
  foam: [0.62, 0.65, 0.66],
  ripple: 11,
  rippleSlope: 0.6,
  rough: 0.05,
  reach: 0.97,
  /**
   * (round 2) per time of day, by name: `sky`, how much of the mirrored sky the water gives back (seen from the
   * coast road high above, round 1's full mirror made the day's sea a pale grey-blue and the golden hour's a pale
   * beige: frame E1's is a deep saturated blue), and `deep`, the open water's body. A time not named keeps 1 and `deep`.
   */
  byTime: {
    day: { sky: 0.78, deep: [0.004, 0.02, 0.058] },
    dusk: { sky: 0.42, deep: [0.0016, 0.0105, 0.0115] },
  },
  /** at night: lamps' streaks, across and along (radians, about), and their share of the head's radiance */
  lamp: { across: 0.012, along: 0.22, gain: 0.06 },
};

/**
 * What other materials need to read the sea map (the ground: its coastal rock and the gravel beside the coast road):
 * the map, and its box (x0, z0, 1 / extent, the water's level). One set per page, as the bake's uniforms are; createSea
 * fills it.
 */
export const SEA_UNIFORMS = {
  uSeaMap: { value: /** @type {THREE.Texture | null} */ (null) },
  uSeaBox: { value: new THREE.Vector4(0, 0, 1e-6, -1e4) },
  /** (round 4) the volcano's island, for the ground's colours on it: x, z, its foot's radius, its rim's height (radius 0: none) */
  uVolcano: { value: new THREE.Vector4(0, 0, 0, 0) },
};

/** GLSL: reading the sea map. seaMapAt(xz): r depth, g land's distance from the water, b water's from the land, a sea. */
export const SEA_MAP_GLSL = /* glsl */ `
uniform sampler2D uSeaMap;
uniform vec4 uSeaBox;
uniform vec4 uVolcano;
vec4 seaMapAt( vec2 p ) {
  return texture2D( uSeaMap, ( p - uSeaBox.xy ) * uSeaBox.z );
}
// metres: the water's depth, the land's distance from the water (to 500), the water's from the land (to 160)
float seaDepth( vec4 m ) { return 64.0 * m.r * m.r; }
float seaLandOff( vec4 m ) { return 500.0 * m.g; }
float seaShoreOff( vec4 m ) { return 160.0 * m.b; }
`;

/**
 * A disc of rings round the origin in the XZ plane: ring spacing grows with the radius so the cells stay about
 * square (demo 01's createRadialGridGeometry).
 */
function radialGrid({ segments, inner, outer }) {
  const radii = [0];
  const growth = 1 + (Math.PI * 2) / segments;
  for (let r = inner; r < outer; r = Math.max(r + inner, r * growth)) radii.push(r);
  radii.push(outer);
  const rings = radii.length;
  const positions = new Float32Array((1 + (rings - 1) * segments) * 3);
  let p = 3;
  for (let i = 1; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      // every other ring turned half a step, so no long edges line up
      const a = ((s + (i % 2) * 0.5) / segments) * Math.PI * 2;
      positions[p++] = Math.cos(a) * radii[i];
      positions[p++] = 0;
      positions[p++] = Math.sin(a) * radii[i];
    }
  }
  const index = [];
  const start = (i) => 1 + (i - 1) * segments;
  for (let s = 0; s < segments; s++) index.push(0, start(1) + ((s + 1) % segments), start(1) + s);
  for (let i = 1; i < rings - 1; i++) {
    const a = start(i);
    const b = start(i + 1);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      if (i % 2 === 1) index.push(a + s, a + s1, b + s1, a + s, b + s1, b + s);
      else index.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}

const v3 = (c) => `vec3( ${c.map((x) => x.toFixed(5)).join(', ')} )`;

/**
 * @typedef {object} Sea
 * @property {THREE.Mesh} mesh
 * @property {(time: import('./lighting.js').TimeOfDay) => void} setTime
 * @property {(simTime: number) => void} update the run's clock (fixed step)
 * @property {(camera: THREE.Camera) => void} prepareView centres the disc on the eye, sets the waves' reach for its height
 * @property {object} stats
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('./terrain.js').SeaShape} options.sea where the water is (terrain.sea)
 * @param {number} options.far the view's far plane (m)
 * @param {{ pos: { value: THREE.Vector4[] }, color: { value: THREE.Vector3[] } }} [options.glints] the nearest lit
 *   lamps' heads, filled per view by lamps.js (the wet road's)
 * @returns {Sea}
 */
export function createSea({ caps, tier, atmosphere, sea, far, glints = null }) {
  const spec = TIER[tier] ?? TIER.medium;
  const outer = far * SEA_LOOK.reach;
  const waves = createWaveField({ count: spec.waves, segments: spec.displace ? spec.segments : 0 });
  // (round 2) the big swell off the low crossing (terrain.js CAUSEWAY.surf, waves.js BOOST)
  waves.setBoost(sea.surf ?? null);
  // (low: a few rings only; the cells need not be square where nothing moves them)
  const geometry = radialGrid({ segments: spec.segments, inner: spec.displace ? 1.2 : outer / 3, outer });
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer);

  // the sea map, as a texture (terrain.js made its texels)
  const m = sea.map;
  const map = new THREE.DataTexture(m.data, m.size, m.size, THREE.RGBAFormat);
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
  SEA_UNIFORMS.uSeaMap.value = map;
  SEA_UNIFORMS.uSeaBox.value.set(m.x0, m.z0, 1 / m.extent, sea.level);

  const anisotropy = Math.min(8, caps.maxAnisotropy ?? 1);
  const rippleSize = 256;
  const ripples = normalTexture(rippleSize, gradientField(rippleSize, { seed: 71, cells: 8, octaves: 4 }), { relief: 0.06, anisotropy });
  // foam's lace: r bubbles (cells), g threads (cell edges), b a soft field
  const fs = 256;
  const foamTex = fieldTexture(
    fs,
    [worleyField(fs, { seed: 81, cells: 18 }), worleyField(fs, { seed: 82, cells: 9, mode: 'edge' }), valueField(fs, { seed: 83, cells: 6, octaves: 4 })],
    { anisotropy },
  );

  const uniforms = {
    ...waves.uniforms,
    uSeaCentre: { value: new THREE.Vector3(0, sea.level, 0) },
    uSeaFar: { value: outer },
    uSeaSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSeaSun: { value: new THREE.Vector3() },
    uSeaSky: { value: 1 },
    uSeaGain: { value: 1 },
    uSeaDeep: { value: new THREE.Vector3().fromArray(SEA_LOOK.deep) },
    uRipple: { value: ripples },
    uFoamTex: { value: foamTex },
    uSeaGlintPos: glints ? glints.pos : { value: [] },
    uSeaGlintColor: glints ? glints.color : { value: [] },
  };
  const lamps = glints ? Math.min(spec.lamps, glints.pos.value.length) : 0;

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: SEA_LOOK.rough, metalness: 0 });
  material.name = 'sea';
  extend(material, `sea-${tier}`, (shader) => {
    Object.assign(shader.uniforms, uniforms, SEA_UNIFORMS);
    const defines = `${spec.displace ? '#define SEA_DISPLACE\n' : ''}#define SEA_RIPPLES ${spec.ripples}\n#define SEA_LAMPS ${lamps}\n`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defines}${waves.glsl}\n${SEA_MAP_GLSL}\n${SEA_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', SEA_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defines}${waves.glsl}\n${SEA_MAP_GLSL}\n${SEA_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', SEA_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = seaRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize( ( viewMatrix * vec4( seaN, 0.0 ) ).xyz );')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularColor = vec3( mix( 0.02, 0.04, seaFoam ) );\nmaterial.specularColorBlended = material.specularColor;',
      )
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${SEA_LIGHT}`)
      .replace('#include <opaque_fragment>', `${SEA_HORIZON}\n#include <opaque_fragment>`);
  });
  atmosphere.patch(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sea';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  // after the opaque scenery, so that what the land hides is not shaded
  mesh.renderOrder = 5;

  let time = 0;
  const eye = new THREE.Vector3();
  return {
    mesh,
    setTime(t) {
      uniforms.uSeaSunDir.value.fromArray(t.sun.dir).normalize();
      uniforms.uSeaSun.value.fromArray(t.sun.color).multiplyScalar(t.sun.intensity);
      // the scene's environment map is the sky's light on things, set apart from the sky as drawn (env.intensity);
      // a mirror shows the sky as drawn
      uniforms.uSeaSky.value = 1 / Math.max(0.05, t.env.intensity);
      const own = SEA_LOOK.byTime[t.name] ?? {};
      uniforms.uSeaGain.value = own.sky ?? 1;
      uniforms.uSeaDeep.value.fromArray(own.deep ?? SEA_LOOK.deep);
    },
    update(simTime) {
      time = simTime;
    },
    prepareView(camera) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      uniforms.uSeaCentre.value.set(eye.x, sea.level, eye.z);
      waves.update(time, eye.y - sea.level);
    },
    stats: { triangles: geometry.index.count / 3, waves: waves.count },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
      ripples.dispose();
      foamTex.dispose();
      SEA_UNIFORMS.uSeaMap.value = null;
    },
  };
}

const SEA_VERTEX_PARS = /* glsl */ `
uniform vec3 uSeaCentre;   // xz: the eye, y: the water's level
varying vec3 vSeaWorld;
varying vec2 vSeaBase;     // where the point lies on the undisturbed water
// the swell dies down over the shallows (the sea map's depth)
float seaCalm( vec2 p ) {
  return 0.35 + 0.65 * smoothstep( 0.0, 14.0, seaDepth( seaMapAt( p ) ) );
}
`;

const SEA_VERTEX = /* glsl */ `
vec2 seaBase = position.xz + uSeaCentre.xz;
vec3 transformed = vec3( seaBase.x, uSeaCentre.y, seaBase.y );
#ifdef SEA_DISPLACE
transformed += waveDisplace( seaBase, seaCalm( seaBase ), length( position.xz ) );
#endif
vSeaBase = seaBase;
vSeaWorld = transformed;
`;

const SEA_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSeaCentre;
uniform float uSeaFar;
uniform vec3 uSeaSunDir;
uniform vec3 uSeaSun;      // the sun's (or the moon's) colour times its intensity
uniform float uSeaSky;     // what turns the environment map's light on things back into the sky as drawn
uniform float uSeaGain;    // how much of the mirrored sky the water gives back at this time of day (SEA_LOOK.byTime)
uniform vec3 uSeaDeep;     // the open water's body at this time of day
uniform sampler2D uRipple;
uniform sampler2D uFoamTex;
#if SEA_LAMPS > 0
uniform vec4 uSeaGlintPos[ SEA_LAMPS ];
uniform vec3 uSeaGlintColor[ SEA_LAMPS ];
#endif
varying vec3 vSeaWorld;
varying vec2 vSeaBase;
vec3 seaN;        // the surface's normal (world)
float seaRough;
float seaFoam;
vec3 seaScatter;  // light through the waves' tops, added after the lights
`;

/** GLSL (in place of map_fragment): the normal, the roughness, the body and the foam. */
const SEA_SURFACE = /* glsl */ `
vec3 sToEye = cameraPosition - vSeaWorld;
float sDist = length( sToEye );
vec3 sV = sToEye / sDist;
float sT = uWaveTime;
vec4 sMap = seaMapAt( vSeaBase );
float sDepth = seaDepth( sMap );
float sShore = seaShoreOff( sMap );
// the swell dies down over the shallows; glassier close in
float sAmp = 0.35 + 0.65 * smoothstep( 0.0, 14.0, sDepth );

vec3 sN;
float sJac;
float sLost;
waveNormal( vSeaBase, sAmp, sDist, sN, sJac, sLost );

// ripples: layers of the tiling normal map drifting different ways, faded out (into the roughness) where a
// pixel covers more than a few of them
float sPix = sDist / max( abs( sV.y ), 0.05 );   // grows towards the horizon, where a pixel covers more water
float sRipKeep = 1.0 - smoothstep( 40.0, 900.0, sPix );
vec2 sR = ( texture2D( uRipple, vSeaBase / ${SEA_LOOK.ripple.toFixed(1)} + sT * vec2( 0.021, 0.009 ) ).xy - 0.5 ) * 2.0;
sR += ( texture2D( uRipple, vSeaBase.yx / ${(SEA_LOOK.ripple * 0.43).toFixed(2)} - sT * vec2( 0.017, 0.031 ) ).xy - 0.5 ) * 1.4;
#if SEA_RIPPLES > 2
sR += ( texture2D( uRipple, vSeaBase / ${(SEA_LOOK.ripple * 2.9).toFixed(2)} + sT * vec2( -0.006, 0.011 ) ).xy - 0.5 ) * 1.2;
#endif
sR *= ${SEA_LOOK.rippleSlope.toFixed(2)} * 0.5 * ( 0.5 + 0.5 * sAmp );
float sRipVar = 0.02 * ( 0.5 + 0.5 * sAmp );
sN = normalize( sN + vec3( sR.x, 0.0, sR.y ) * sRipKeep );
sLost += sRipVar * ( 1.0 - sRipKeep * sRipKeep );
// the sky that the water mirrors is above the horizon: a facet tipped so far that it would show the ground under
// the horizon shows the sky just over it instead (01's rule)
{
  vec3 R = reflect( - sV, sN );
  if ( R.y < 0.03 ) {
    R.y = 0.03 + 0.5 * ( 0.03 - R.y );
    sN = normalize( sV + normalize( R ) );
  }
}
seaN = sN;
// the highlight widens by the slopes the pixel no longer draws (alpha^2 = alpha0^2 + 2 sigma^2; roughness^2 = alpha)
seaRough = sqrt( sqrt( ${(SEA_LOOK.rough ** 4).toExponential(3)} + 2.0 * sLost ) );

// ---- foam: behind the swell's crests where it bunches up, and the surf along the shore
float sCrest = smoothstep( 0.3, 0.62, swellCrest( vSeaBase, sAmp, 0.0, 1.6 ) );
sCrest = max( sCrest, 0.7 * smoothstep( 0.3, 0.62, swellCrest( vSeaBase, sAmp, 1.4, 1.6 ) ) );
sCrest = max( sCrest, 0.8 * smoothstep( 0.32, 0.55, 1.0 - sJac ) );
vec2 sSw = vec2( ${Math.cos((WAVES[0].dir * Math.PI) / 180).toFixed(4)}, ${Math.sin((WAVES[0].dir * Math.PI) / 180).toFixed(4)} );
vec2 sSp = vec2( dot( vSeaBase, sSw ), dot( vSeaBase, vec2( - sSw.y, sSw.x ) ) );
vec4 sLace = texture2D( uFoamTex, sSp * vec2( 0.045, 0.11 ) + sT * vec2( 0.004, 0.002 ) );
vec4 sLace2 = texture2D( uFoamTex, sSp * vec2( 0.13, 0.27 ) + 0.37 - sT * vec2( 0.006, 0.003 ) );
float sChurn = 0.45 * sLace.r + 0.35 * sLace2.g + 0.4 * sLace.b;
// the surf: the swell running in over the last metres, its lines breaking in bands that move shorewards
float sWarp = ( sLace.b - 0.5 ) * 9.0;
float sBand = 0.5 + 0.5 * sin( ( sShore + sWarp ) * 0.33 + sT * 1.1 );
float sWash = ( 1.0 - smoothstep( 1.0, 14.0, sShore + sWarp * 0.6 ) ) * mix( 0.45, 1.0, sBand );
sWash = max( sWash, ( 1.0 - smoothstep( 8.0, 26.0, sShore + sWarp ) ) * 0.5 * smoothstep( 0.6, 0.95, sBand ) );
sWash *= smoothstep( 0.35, 0.65, sMap.a );
float sMask = max( sCrest * 0.8, sWash );
seaFoam = smoothstep( 1.18 - sMask * 1.05, 1.42 - sMask * 1.05, sChurn ) * ( 0.4 + 0.6 * sMask );
// far away the foam's lace is less than a pixel: a share of white, not threads
seaFoam = mix( seaFoam, mix( 0.35, 0.75, sWash ) * sMask, smoothstep( 150.0, 900.0, sPix ) );

// ---- the body: the light that comes back up out of the water, greener and lighter over the shallows
float sClear = exp( - sDepth * 0.28 );
vec3 sBody = mix( uSeaDeep, ${v3(SEA_LOOK.shallow)}, sClear );
// a wave's top is thinner: lighter, and lit through when looking towards the sun
float sTop = smoothstep( -0.2, 0.9, ( vSeaWorld.y - uSeaCentre.y ) / ( ${SEA_HEIGHT.toFixed(3)} * 0.5 * sAmp ) );
sBody *= 0.85 + 0.35 * sTop;
float sSunward = pow( clamp( dot( - sV, normalize( uSeaSunDir * vec3( 1.0, 0.0, 1.0 ) + vec3( 0.0, 1.0e-4, 0.0 ) ) ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 );
seaScatter = uSeaSun * ${v3(SEA_LOOK.scatter)} * ( 0.3 + 0.7 * sTop ) * ( 0.25 + 0.75 * sSunward ) * max( uSeaSunDir.y, 0.0 ) * 4.0;
// bubbles near the foam turn the water milky
sBody = mix( sBody, ${v3(SEA_LOOK.shallow)} * 2.0, 0.4 * smoothstep( 0.05, 0.7, sMask ) );
diffuseColor.rgb = mix( sBody, ${v3(SEA_LOOK.foam)} * ( 0.8 + 0.3 * sLace2.r ), seaFoam );
seaRough = mix( seaRough, 0.6, seaFoam );
seaScatter *= 1.0 - seaFoam;
`;

/** GLSL (after the lights): the light through the waves, and at night the lamps' streaks. */
const SEA_LIGHT = /* glsl */ `
reflectedLight.directDiffuse += seaScatter;
// the sky as the water mirrors it: the environment map at the sky's own brightness; and where the highlight is wide
// and looks low (far out), the bright air at the horizon, which the map's blur would mix with the ground under it
{
  vec3 hV = normalize( cameraPosition - vSeaWorld );
  vec3 hR = reflect( - hV, seaN );
  float hF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( seaN, hV ), 0.0, 1.0 ), 5.0 );
  float hLow = ( 1.0 - smoothstep( 0.04, 0.3, hR.y ) ) * smoothstep( 0.1, 0.35, seaRough );
  reflectedLight.indirectSpecular *= uSeaSky;
  reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, hazeColor( normalize( vec3( hR.x, max( hR.y, 0.02 ), hR.z ) ) ) * hF * ( 1.0 - seaFoam ), hLow );
  reflectedLight.indirectSpecular *= uSeaGain;
}
#if SEA_LAMPS > 0
{
  vec3 lV = normalize( cameraPosition - vSeaWorld );
  vec3 lR = reflect( - lV, seaN );
  vec3 lA = normalize( cross( seaN, lV ) );
  vec3 lB = cross( lR, lA );
  float lF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( seaN, lV ), 0.0, 1.0 ), 5.0 );
  float lW = 1.0 + 4.0 * seaRough * seaRough;
  vec3 lamp = vec3( 0.0 );
  for ( int i = 0; i < SEA_LAMPS; i ++ ) {
    if ( uSeaGlintPos[ i ].w <= 0.0 ) continue;
    vec3 toLamp = normalize( uSeaGlintPos[ i ].xyz - vSeaWorld );
    // (only about the mirrored direction: a lamp behind the reflected ray projects onto nothing)
    float facing = dot( toLamp, lR );
    if ( facing < 0.8 ) continue;
    vec3 dev = toLamp - lR;
    float x = dot( dev, lA ) / ( ${SEA_LOOK.lamp.across.toFixed(3)} * lW );
    float y = dot( dev, lB ) / ( ${SEA_LOOK.lamp.along.toFixed(3)} * lW );
    lamp += uSeaGlintColor[ i ] * ( uSeaGlintPos[ i ].w * exp( - x * x - y * y ) * smoothstep( 0.8, 0.95, facing ) / lW );
  }
  lamp *= lF * ${SEA_LOOK.lamp.gain.toFixed(3)};
  // a lamp in the water glares, it does not burn a hole (as on the wet road)
  reflectedLight.directSpecular += lamp * 3.0 / ( 3.0 + max( lamp.r, max( lamp.g, lamp.b ) ) ) * ( 1.0 - seaFoam );
}
#endif
`;

/** GLSL (before the output): far out, the water becomes the haze the sky dome shows just under the horizon. */
const SEA_HORIZON = /* glsl */ `
outgoingLight = mix( outgoingLight, hazeColor( - normalize( cameraPosition - vSeaWorld ) ), smoothstep( uSeaFar * 0.45, uSeaFar * 0.97, length( vSeaWorld.xz - cameraPosition.xz ) ) );
`;
