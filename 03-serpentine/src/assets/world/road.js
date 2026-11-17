// The road: one mesh of the pavement built from the Track sample by sample,
// and the asphalt it is made of.
//
// The mesh. Each row is a cross-section of the Track at one sample: the edges
// of the paved strip, the pavement's edge, the wheel tracks and the crown.
// Every vertex is track.pointAt(s, lat), the very surface the physics drives
// on, and its outermost vertices are the terrain band's innermost ones
// (terrain.js uses the same rows), so road and verge meet without a crack.
// Along the town street (corridor.js) the mesh stops at the pavement's edge:
// gutter, kerb and pavement are paving.js's.
//
// Conventions for whoever builds on it: `aRoad` is (lat, s, paved, open) per
// vertex: metres left of the centre line, metres from the start line (the
// last row repeats the first with s = length, so s never jumps inside a
// triangle), 1 where the strip beyond the pavement is paved (tunnel, viaduct)
// rather than loose gravel, and how much sky is overhead.
//
// The asphalt is drawn in the fragment shader from (lat, s), in layers, each
// at the scale it belongs to:
//  - the stones (roadTextures.js): tone, height, polish and relief of the
//    wearing course, looked up twice at shifted places and blended, the
//    choice of places changing from one patch of road to the next, so the
//    texture never repeats; each stone glints on its own near the camera and
//    the mip chain's record of what it averaged away turns that into a steady
//    satin further off;
//  - the lane: darker, polished wheel tracks, a paler crown, a drip line down
//    each lane's middle, rubber laid on the racing line into the bends
//    (corridor.js works the line out from the Track);
//  - the road's history (roadHistory.js): surfacing of different ages with
//    joints between, patches and trenches of newer asphalt with sealed edges,
//    sealed cracks, covers and gratings, expansion joints, stains: single
//    things placed by rule, drawn exactly;
//  - paint: edge lines, the centre line (dashed; double through bends and the
//    tunnel, parted and hatched in the hairpins), the start line and grid, the
//    sector lines, the town's crossings and stop lines; a few millimetres
//    proud (it catches the light along its edges), worn where tyres run, cut
//    away where the road was dug up, crossed by the cracks, and full of glass
//    beads that send a car's head lamps back;
//  - the edges: a ragged end to the asphalt, a gravel shoulder of the same
//    stones three times the size, a flush painted kerb round the inside of
//    every tight bend, leaves where trees stand over the road;
//  - water (world.wetness; lighting.js makes dusk and night wet). Not a gloss
//    slider: a level. The surface has a height in millimetres (the crown or
//    the banking, the ruts, dips, whatever was laid proud or has sunk) and the
//    rain a level against it. Below the level by more than the stones' own
//    height, water stands: a mirror. Within the stones' height the gaps are
//    full and the tops stand clear: a broken film. Above it the asphalt is
//    damp: dark, its pores full, matt. Under the tunnel's roof it is dry but
//    for what tyres carry in.
// With a `mirror` (engine/PlanarMirror.js, medium and high tiers) the water
// shows the scene's real reflection: sharp where it stands, drawn out towards
// the viewer and blurred where the film is broken. Without one the same
// roughness and Fresnel take the sky from the environment map and the lamps'
// own highlights.

import * as THREE from 'three';
import { GLSL_HASH } from '../../engine/glsl.js';
import { createRng } from '../../engine/rng.js';
import { corridorOf } from './corridor.js';
import { FEATURE_CELL, roadHistory } from './roadHistory.js';
import { BIG_TILE, ROUGH_GAIN, VARIANCE_GAIN, roadTextures } from './roadTextures.js';
import { WET_UNIFORMS, extend, withBake } from './shading.js';

/** Lane dashes: a dash this long (m) in every period of about DASH_PERIOD (adjusted to divide the lap). */
const DASH = 4;
const DASH_PERIOD = 12;
/** Where the centre line is a solid double one: bends tighter than this (1/m), and this far round them (m). */
const DOUBLE_CURVATURE = 1 / 40;
const DOUBLE_REACH = 45;
/** Where the two lines part and are hatched between them: the hairpins proper. */
const HATCH_CURVATURE = 1 / 28;
const HATCH_REACH = 20;
/** And on the way into each tunnel (m before its portal) as well as all through it. */
const TUNNEL_DOUBLE = 60;
/** Head lamp brightness (THROW in assets/car/index.js: candela-like units at the beam's peak, per lamp). */
const LAMP_LOW = 1600;
const LAMP_HIGH = 4500;
/** Up to this many cars' head lamps answered by the paint. */
const BEAMS = 2;
/** Per tier: how much of the shader runs (0: one lookup of each texture, no streaks), and the mirror's taps. */
const SHADER = { low: { tier: 0, taps: 0 }, medium: { tier: 1, taps: 5 }, high: { tier: 2, taps: 8 } };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ bakeAt: (x: number, z: number, out: ArrayLike<number>, offset: number) => void }} options.terrain for the baked light
 * @param {number} options.rowStep one row every this many samples (the terrain band's own step)
 * @param {import('../../engine/rng.js').Rng} [options.rng]
 * @param {{ uniforms: object, texture: THREE.Texture }|null} [options.mirror] the wet road's planar reflection (its
 *   uniforms, with uMirrorPlane added: the plane as (normal, constant)), or null for speculars only
 */
export function createRoad({ track, caps, tier, atmosphere, terrain, rowStep, rng = createRng(3), mirror = null }) {
  const n = track.count;
  const ds = track.ds;
  const half = track.halfWidth;
  const pave = half + track.shoulder;
  const co = corridorOf(track);
  const history = roadHistory({ track, rng: rng.fork('history'), tier });

  // ---- what each metre of road is painted with: r solid double line, g lines parted and hatched, b edge lines
  const codes = new Uint8Array(n * 4);
  {
    const near = (i, reach, test) => {
      const k = Math.round(reach / ds);
      for (let j = -k; j <= k; j++) if (test((i + j + n) % n)) return true;
      return false;
    };
    const tight = (limit) => (j) => Math.abs(track.curvature[j]) > limit;
    const inTunnel = (i) =>
      track.tunnels.some((t) => {
        const s = i * ds;
        return track.delta(t.s0, s) > -TUNNEL_DOUBLE && track.delta(t.s1, s) < 15;
      });
    for (let i = 0; i < n; i++) {
      const hatch = near(i, HATCH_REACH, tight(HATCH_CURVATURE));
      codes[i * 4] = hatch || inTunnel(i) || near(i, DOUBLE_REACH, tight(DOUBLE_CURVATURE)) ? 255 : 0;
      codes[i * 4 + 1] = hatch ? 255 : 0;
      // a street with kerbs has no edge lines
      codes[i * 4 + 2] = Math.round(255 * (1 - co.town[i]));
      codes[i * 4 + 3] = Math.round(255 * co.town[i]);
    }
  }

  // ---- the mesh, in chunks of about 150 m
  const ACROSS = [1, 1, half, 2.925, 1.325, 0, -1.325, -2.925, -half, -1, -1]; // ±1: outer and pave, filled below
  const cols = ACROSS.length;
  const geometries = [];
  const pt = new THREE.Vector3();
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const rows = [];
  for (let i = 0; i < n; i += rowStep) rows.push(i);
  rows.push(n); // the lap closes on its first row again, with s = length
  const CHUNK = Math.round(150 / (ds * rowStep));
  const byte = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  for (let a = 0; a < rows.length - 1; a += CHUNK) {
    const list = rows.slice(a, Math.min(rows.length, a + CHUNK + 1));
    const count = list.length * cols;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const road = new Float32Array(count * 4);
    const along = new Float32Array(count * 4);
    const bake = new Float32Array(count * 3);
    const codeA = new Uint8Array(count * 4);
    const codeB = new Uint8Array(count * 4);
    for (let r = 0; r < list.length; r++) {
      const i = list[r] % n;
      const s = list[r] * ds;
      const pavedL = track.vergeL[i] === 0; // SURFACE.ASPHALT: paved up to the wall or the parapet
      const pavedR = track.vergeR[i] === 0;
      // in the town the gutter and the kerb begin at the pavement's edge: the mesh ends there
      const town = co.paved[i] === 1;
      const lats = ACROSS.slice();
      lats[0] = pavedL ? track.edgeL[i] : town ? half : pave;
      lats[1] = town ? half : pave;
      lats[cols - 2] = town ? -half : -pave;
      lats[cols - 1] = pavedR ? -track.edgeR[i] : town ? -half : -pave;
      track.frameAt(s % track.length, frame);
      for (let k = 0; k < cols; k++) {
        const v = r * cols + k;
        track.pointAt(s % track.length, lats[k], pt);
        pt.toArray(pos, v * 3);
        // pavement and shoulder are one banked plane: its normal is the Track's own
        frame.up.toArray(nor, v * 3);
        road[v * 4] = lats[k];
        road[v * 4 + 1] = s;
        road[v * 4 + 2] = lats[k] > 0 ? (pavedL ? 1 : 0) : pavedR ? 1 : 0;
        // how much sky is over it: rain does not reach far into the tunnel
        road[v * 4 + 3] = track.sky ? track.sky[i] : 1;
        frame.tan.toArray(along, v * 4);
        along[v * 4 + 3] = co.pond[i];
        terrain.bakeAt(pt.x, pt.z, bake, v * 3);
        codeA.set(codes.subarray(i * 4, i * 4 + 4), v * 4);
        codeB[v * 4] = byte(0.5 + co.line[i] / 8);
        codeB[v * 4 + 1] = byte(co.rubber[i]);
        codeB[v * 4 + 2] = byte(co.tongue[i]);
        codeB[v * 4 + 3] = byte(0.5 + 0.5 * co.bank[i]);
      }
    }
    const index = [];
    for (let r = 0; r < list.length - 1; r++) {
      for (let k = 0; k < cols - 1; k++) {
        const v = r * cols + k;
        // columns run from left to right: (v, v+1) points right, (v, v+cols) forward
        index.push(v, v + 1, v + cols, v + 1, v + cols + 1, v + cols);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 4));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 3));
    geometry.setAttribute('aCodeA', new THREE.BufferAttribute(codeA, 4, true));
    geometry.setAttribute('aCodeB', new THREE.BufferAttribute(codeB, 4, true));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    geometries.push(geometry);
  }

  // ---- what lies along each edge, per metre: r, g leaves left and right; b, a a painted kerb left and right
  const edges = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) edges.set([byte(co.leafL[i]), byte(co.leafR[i]), byte(co.apexL[i]), byte(co.apexR[i])], i * 4);
  const edgeTexture = new THREE.DataTexture(edges, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  edgeTexture.magFilter = edgeTexture.minFilter = THREE.LinearFilter;
  edgeTexture.wrapS = THREE.RepeatWrapping;
  edgeTexture.needsUpdate = true;

  const textures = roadTextures({ caps, tier });

  // the grid's boxes and the lines, in track coordinates (s counted back from the line is negative)
  const where = { index: -1, s: 0, lat: 0 };
  const slots = [];
  for (let slot = 0; slot < 4; slot++) {
    const g = track.grid(slot);
    track.locate(g.x, g.z, -1, where);
    const s = where.s > track.length / 2 ? where.s - track.length : where.s;
    slots.push(new THREE.Vector4(s, where.lat, 0, 0));
  }
  const period = track.length / Math.round(track.length / DASH_PERIOD);
  const crossings = [0, 1].map((k) => {
    const c = co.crossings[k];
    return c ? new THREE.Vector4(c.s, c.half, c.stopBefore, c.stopAfter) : new THREE.Vector4(0, 0, 0, 0);
  });

  const uniforms = {
    uAgg: { value: textures.surface },
    uAggN: { value: textures.relief },
    uBig: { value: textures.big },
    uEdge: { value: edgeTexture },
    uFeat: { value: history.texture },
    uLength: { value: track.length },
    uDash: { value: new THREE.Vector2(period, DASH) },
    uLines: { value: new THREE.Vector3(0, track.sectors[0] ?? -1e4, track.sectors[1] ?? -1e4) },
    uGrid: { value: slots },
    uCross: { value: crossings },
    uHalf: { value: half },
    uBeamPos: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, -1e4, 0)) },
    uBeamDir: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, 0, 1)) },
    uBeamPower: { value: new Array(BEAMS).fill(0) },
    ...WET_UNIFORMS,
    ...(mirror ? mirror.uniforms : {}),
  };
  if (mirror) prepareMirror(mirror);

  const shade = SHADER[tier] ?? SHADER.medium;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  material.name = 'asphalt';
  material.defines = {
    ...material.defines,
    ROAD_TIER: shade.tier,
    ROAD_SLOTS: history.slots,
    ...(mirror && shade.taps ? { ROAD_MIRROR: 1, ROAD_TAPS: shade.taps } : {}),
  };
  extend(material, 'asphalt', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aRoad;\nattribute vec4 aAlong;\nattribute vec4 aCodeA;\nattribute vec4 aCodeB;\nvarying vec4 vRoad;\nvarying vec4 vRoadWorld;\nvarying vec4 vRoadAlong;\nvarying vec4 vCodeA;\nvarying vec4 vCodeB;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRoad = aRoad;\nvRoadAlong = aAlong;\nvCodeA = aCodeA;\nvCodeB = aCodeB;\nvRoadWorld = vec4( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, ${EYE_FROM_PROJECTION} );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${WET_MIRROR_PARS}\n${ASPHALT_PARS}`)
      .replace('#include <map_fragment>', ASPHALT_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRoughness;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = roadMetal;')
      .replace('#include <normal_fragment_maps>', ASPHALT_NORMAL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ASPHALT_BEADS}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${WET_SPECULAR}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${WET_MIRROR}`);
  });
  withBake(material);
  atmosphere.patch(material);

  const group = new THREE.Group();
  group.name = 'road';
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  return {
    group,
    material,
    uniforms,
    /** What the road's history holds, and what its textures cost. */
    stats: { history: history.stats, textureBytes: textures.bytes, textureMs: textures.ms },
    /** 0..1 */
    setWetness(w) {
      WET_UNIFORMS.uWet.value = w;
    },
    /** @param {Array<{ pos: THREE.Vector3, dir: THREE.Vector3, low: number, high: number }>} beams */
    setBeams(beams) {
      for (let i = 0; i < BEAMS; i++) {
        const b = beams?.[i];
        if (b) {
          uniforms.uBeamPos.value[i].copy(b.pos);
          uniforms.uBeamDir.value[i].copy(b.dir).normalize();
          // two lamps, seen from the road as one
          uniforms.uBeamPower.value[i] = 2 * (LAMP_LOW * b.low + LAMP_HIGH * b.high);
        } else uniforms.uBeamPower.value[i] = 0;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      edgeTexture.dispose();
      history.dispose();
      material.dispose();
    },
  };
}

/**
 * The mirror's picture is read blurred as well as sharp (a broken film of water smears what it shows): its target
 * gets a mip chain, made by the GPU after each of its renders.
 * @param {{ texture: THREE.Texture }} mirror
 */
export function prepareMirror(mirror) {
  mirror.texture.generateMipmaps = true;
  mirror.texture.minFilter = THREE.LinearMipmapLinearFilter;
}

/**
 * GLSL (vertex): 1 for a camera that is an eye, 0 for a reflection probe's cube face (90 degrees square, which no
 * view uses): what comes back towards a lamp, and the mirror's picture, belong to the view's own eye.
 */
export const EYE_FROM_PROJECTION =
  '( abs( abs( projectionMatrix[ 1 ][ 1 ] ) - 1.0 ) < 1.0e-3 && abs( abs( projectionMatrix[ 0 ][ 0 ] ) - 1.0 ) < 1.0e-3 ? 0.0 : 1.0 )';

/**
 * GLSL (fragment, declarations): the planar mirror as wet ground reads it, shared with paving.js. A material that
 * uses it defines ROAD_MIRROR and ROAD_TAPS and carries the mirror's uniforms.
 *
 * A wet road draws each light out into a streak from the point that mirrors it towards the viewer: the nearer road
 * sees the light at a glancing angle off the far side of its bumps. So the picture is read at several places up
 * its height from where this point lands in it (never down), over a length that grows with the water's roughness,
 * each read from the mip level whose texels are as wide as the gap to the next: one soft streak, not a row of dots.
 * Standing water (roughness near zero) reads one sharp place.
 */
export const WET_MIRROR_PARS = /* glsl */ `
float roadWater;      // the share of this pixel under water, 0..1
float roadPuddle;     // 1 where water stands clear over the stones
float roadWaterRough; // the water surface's own roughness
#ifdef ROAD_MIRROR
uniform sampler2D uMirrorTex;
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
uniform vec2 uMirrorTexel;
uniform vec4 uMirrorPlane;
// rgb: what the water at 'world' mirrors; a: how far to believe it (0 off the mirror's plane or beyond its picture)
vec4 wetMirror( vec3 world, vec2 push, float rough ) {
  float trust = 1.0 - smoothstep( 0.4, 2.5, abs( dot( world, uMirrorPlane.xyz ) + uMirrorPlane.w ) );
  if ( uMirrorOn < 0.5 || trust <= 0.0 ) return vec4( 0.0 );
  vec4 mc = uMirrorMatrix * vec4( world, 1.0 );
  vec2 uv = mc.xy / mc.w + push;
  float len = clamp( rough * rough * 1.7, 0.0, 0.2 );
  float lod = log2( max( len / ( float( ROAD_TAPS ) * uMirrorTexel.y ), 1.0 ) );
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  vec3 sum = vec3( 0.0 );
  float total = 0.0;
  for ( int i = 0; i < ROAD_TAPS; i ++ ) {
    float t = ( float( i ) + jitter ) / float( ROAD_TAPS );
    float w = 1.0 - 0.8 * t;
    sum += textureLod( uMirrorTex, uv + vec2( 0.0, ( t - 0.1 ) * len ), lod ).rgb * w;
    total += w;
  }
  vec2 inside = smoothstep( vec2( 0.0 ), vec2( 0.03 ), uv ) * smoothstep( vec2( 0.0 ), vec2( 0.03 ), 1.0 - uv );
  return vec4( sum / total, trust * inside.x * inside.y );
}
#endif
`;

/** GLSL (fragment, after lights_physical_fragment): water reflects less head on than stone does (n = 1.33). */
export const WET_SPECULAR = /* glsl */ `
material.specularColor = mix( vec3( 0.04 ), vec3( 0.02 ), roadWater );
material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
`;

/**
 * GLSL (fragment, after the lights): the water's share of the surface shows the mirror's picture instead of the
 * environment map's, and the lamps' own highlights give way to their mirrored heads. Expects vRoadWorld (xyz the
 * world position, w 0 in a reflection probe's cube face).
 */
export const WET_MIRROR = /* glsl */ `
#ifdef ROAD_MIRROR
if ( vRoadWorld.w > 0.5 && roadWater > 0.003 ) {
  // pushed about by the surface's own tilt (stones standing out of the film): reflections break up
  vec4 mirrored = wetMirror( vRoadWorld.xyz, ( normal.xy - nonPerturbedNormal.xy ) * vec2( 0.03, 0.08 ), roadWaterRough );
  float mWet = roadWater * mirrored.a;
  // the brightest things are held to a few times white: a lamp's head in a puddle glares, it does not burn a hole
  vec3 mCol = mirrored.rgb * ( 3.0 / ( 3.0 + max( mirrored.r, max( mirrored.g, mirrored.b ) ) ) );
  // water's Fresnel (n = 1.33) on the unbroken surface; a broken film faces the eye a little more than the road does
  float mCos = clamp( dot( nonPerturbedNormal, normalize( vViewPosition ) ) + 0.35 * roadWaterRough * roadWaterRough, 0.0, 1.0 );
  float mF = 0.02 + 0.98 * pow( 1.0 - mCos, 5.0 );
  reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, mCol * mF, mWet );
  reflectedLight.directSpecular *= 1.0 - 0.85 * mWet;
}
#endif
`;

const ASPHALT_PARS = /* glsl */ `
uniform sampler2D uAgg;
uniform sampler2D uAggN;
uniform sampler2D uBig;
uniform sampler2D uEdge;
uniform highp sampler2D uFeat;
uniform float uLength;
uniform vec2 uDash;
uniform vec3 uLines;
uniform vec4 uGrid[4];
uniform vec4 uCross[2];
uniform float uHalf;
uniform float uWet;
uniform vec3 uBeamPos[${BEAMS}];
uniform vec3 uBeamDir[${BEAMS}];
uniform float uBeamPower[${BEAMS}];
varying vec4 vRoad;       // lat, s, paved beyond the pavement, sky overhead
varying vec4 vRoadWorld;  // world position; w: 0 in a reflection probe's cube face (retro.js says why)
varying vec4 vRoadAlong;  // the road's direction; w: how readily water stands here
varying vec4 vCodeA;      // double centre line, hatched, edge lines, town
varying vec4 vCodeB;      // the racing line, rubber on it, water carried in, banking
float roadRoughness;
float roadMetal;
float roadPaint;
float roadFade;
float roadGravel;
float roadBump;           // height of what stands proud of the surface or is cut into it (m)
vec2 roadTilt;            // the stones' slope, across and along
float roadTiltGain;

// The share of a pixel of half width a, a distance d from the middle of a band of half width w, that the band
// covers: lines keep their true weight however small they get, and never alias.
float roadCover( float d, float w, float a ) {
  return ( clamp( d + w, -a, a ) - clamp( d - w, -a, a ) ) / ( 2.0 * a );
}
`;

const ASPHALT_COLOR = /* glsl */ `
// ================= where this pixel is on the road, and how much road it covers
float rLat = vRoad.x;
float rS = vRoad.y;
float rA = abs( rLat );
// s counted back from the line is negative near the end of the lap
float rS0 = rS > uLength * 0.5 ? rS - uLength : rS;
vec2 rUv = vec2( rLat, rS );
vec2 rDx = dFdx( rUv );
vec2 rDy = dFdy( rUv );
// half a pixel's reach across the road and along it (m): every edge is smoothed over that
float aaL = 0.6 * ( abs( rDx.x ) + abs( rDy.x ) ) + 4.0e-4;
float aaS = 0.6 * ( abs( rDx.y ) + abs( rDy.y ) ) + 4.0e-4;
float aaM = max( aaL, aaS );
float rDist = length( vRoadWorld.xyz - cameraPosition );
roadFade = 1.0 - smoothstep( 18.0, 110.0, rDist );
// 1 where single stones are told apart, 0 where a pixel holds many
float rNear = 1.0 - smoothstep( 0.012, 0.05, max( length( rDx ), length( rDy ) ) );
float rOnRoad = smoothstep( uHalf + aaL, uHalf - aaL, rA );

// ================= the large fields and the stones
vec4 rBig = texture2D( uBig, rUv / ${BIG_TILE.toFixed(1)} );
vec4 rBig2 = texture2D( uBig, rUv.yx / ${(BIG_TILE * 3.1).toFixed(1)} );
vec2 rP = rUv / AGG_TILE;
#if ROAD_TIER > 0
  // looked up at two places and blended, the pair changing from one patch of road to the next: no repeat to find
  vec2 rGx = rDx / AGG_TILE;
  vec2 rGy = rDy / AGG_TILE;
  float rK = rBig.r * 9.0 + rBig2.b * 6.0 + rS * 0.031;
  float rKi = floor( rK );
  vec2 rOa = hash22( vec2( rKi, 3.0 ) );
  vec2 rOb = hash22( vec2( rKi + 1.0, 3.0 ) );
  vec4 rAggA = textureGrad( uAgg, rP + rOa, rGx, rGy );
  vec4 rAggB = textureGrad( uAgg, rP + rOb, rGx, rGy );
  // (the higher stone wins where they cross over, so stones keep their shapes)
  float rSwap = smoothstep( 0.3, 0.7, rK - rKi + ( rAggB.g - rAggA.g ) * 0.3 );
  vec4 rAgg = mix( rAggA, rAggB, rSwap );
  vec4 rRelief = mix( textureGrad( uAggN, rP + rOa, rGx, rGy ), textureGrad( uAggN, rP + rOb, rGx, rGy ), rSwap );
#else
  vec4 rAgg = texture2D( uAgg, rP );
  vec4 rRelief = texture2D( uAggN, rP );
#endif
float rMottle = rAgg.a;
roadTilt = ( rRelief.xy * 2.0 - 1.0 ) / max( rRelief.z * 2.0 - 1.0, 0.25 );
float rVariance = rRelief.a / ${VARIANCE_GAIN.toFixed(1)};

// ================= the lane: where tyres run
float rWander = 0.07 * sin( rS * 0.043 ) + 0.05 * sin( rS * 0.11 + 1.3 );
float rTracks = exp( -pow( ( rA - 1.33 + rWander ) / 0.32, 2.0 ) ) + exp( -pow( ( rA - 2.93 + rWander ) / 0.34, 2.0 ) );
rTracks *= rOnRoad * ( 0.7 + 0.6 * rBig.b );
float rCrown = exp( -pow( rLat / 0.8, 2.0 ) );
float rDrip = exp( -pow( ( rA - 2.13 ) / 0.26, 2.0 ) ) * ( 0.3 + 1.4 * rBig2.r ) * rOnRoad;
// rubber on the racing line, two tyres wide
float rLineD = rLat - ( vCodeB.x - 0.5 ) * 8.0;
float rRubber = vCodeB.y * exp( -pow( ( abs( rLineD ) - 0.8 ) / 0.27, 2.0 ) );
#if ROAD_TIER > 0
  // laid down in streaks: a field drawn out along the road
  rRubber *= 1.4 * smoothstep( 0.3, 0.62, texture2D( uBig, vec2( rLat * 0.9, rS * 0.017 ) ).b );
#endif
rRubber = min( rRubber, 1.0 ) * rOnRoad;

// ================= the road's history: the few things that reach into this cell of the lap
float ftFresh = 0.0;      // newer asphalt laid into the old
float ftTone = 0.5;       // and how new
float ftTar = 0.0;        // sealed edges and cracks
float ftMetal = 0.0;      // iron and steel set into the road
float ftMetalTone = 0.5;
float ftHole = 0.0;       // a slot one looks down into
float ftStain = 0.0;
float ftStainTone = 0.0;  // 0 oil .. 0.5 a pale crust .. 1 rubber
float ftHeight = 0.0;     // mm proud of the road, or sunk
float ftErase = 0.0;      // paint cut away
float ftCell = floor( rS / ${FEATURE_CELL.toFixed(1)} );
int ftColumn = int( ftCell );
float ftX0 = ftCell * ${FEATURE_CELL.toFixed(1)};
vec4 ftHead = texelFetch( uFeat, ivec2( ftColumn, 0 ), 0 );
for ( int slot = 1; slot <= ROAD_SLOTS; slot ++ ) {
  vec4 ft = texelFetch( uFeat, ivec2( ftColumn, slot ), 0 );
  if ( ft.w < 0.5 ) break;
  float kind = mod( ft.w, 16.0 );
  float seed = mod( floor( ft.w / 16.0 ), 256.0 ) / 255.0;
  float param = floor( ft.w / 4096.0 ) / 255.0;
  float hl = floor( ft.z / 4096.0 ) * 0.01;
  float hw = mod( ft.z, 4096.0 ) * 0.01;
  vec2 q = vec2( rS - ftX0 - ft.x, rLat - ft.y );   // along and across from its middle
  if ( kind < 3.5 ) {
    // 1 a patch, 2 a trench along the road, 3 a cut across it: a rectangle of newer asphalt, its edges sealed
    float turn = kind < 1.5 ? 0.0 : ( seed - 0.5 ) * 1.2 + ( kind > 2.5 ? 1.5708 : 0.0 );
    float ca = cos( turn );
    float sa = sin( turn );
    vec2 r = vec2( ca * q.x + sa * q.y, ca * q.y - sa * q.x );
    vec2 e = abs( r ) - vec2( hl, hw );
    // (cut by hand: the edge wavers by a centimetre)
    float d = max( e.x, e.y ) + 0.014 * ( rMottle - 0.5 );
    float a = mix( e.x > e.y ? aaS : aaL, e.x > e.y ? aaL : aaS, sa * sa );
    float inside = smoothstep( a, -a, d );
    ftFresh = max( ftFresh, inside );
    ftTone = mix( ftTone, param, inside );
    ftTar = max( ftTar, roadCover( d + 0.004, 0.022 + 0.012 * seed, a ) * ( 0.5 + 0.5 * smoothstep( 0.3, 0.5, rBig.b + seed - 0.5 ) ) );
    ftHeight += inside * ( kind < 1.5 ? ( param - 0.4 ) * 4.0 : -3.5 );
    ftErase = max( ftErase, inside );
  } else if ( kind < 5.5 ) {
    // 4 a crack along the road, 5 one across it: a wandering line, sealed
    vec2 r = kind < 4.5 ? q : q.yx;
    float len = kind < 4.5 ? hl : hw;
    float amp = kind < 4.5 ? hw : hl;
    float way = amp * ( 0.6 * sin( r.x * 0.9 + seed * 40.0 ) + 0.3 * sin( r.x * 2.3 + seed * 71.0 ) + 0.14 * sin( r.x * 6.1 + seed * 13.0 ) );
    float d = r.y - way + 0.008 * ( rMottle - 0.5 );
    float wide = 0.009 + 0.02 * param;
    ftTar = max( ftTar, roadCover( d, wide, kind < 4.5 ? aaL : aaS ) * smoothstep( len, len - 0.5, abs( r.x ) ) );
  } else if ( kind < 6.5 ) {
    // 6 a cast iron cover in its frame, in the square of asphalt it was set in
    float r = length( q );
    float a = ( abs( q.x ) * aaS + abs( q.y ) * aaL ) / max( r, 1.0e-3 );
    float lid = roadCover( r, hw, a );
    float rim = roadCover( r - hw - 0.03, 0.03, a );
    float collar = smoothstep( aaM, -aaM, max( abs( q.x ), abs( q.y ) ) - hw - 0.3 + 0.012 * ( rMottle - 0.5 ) );
    vec2 g = fract( vec2( q.x + q.y, q.x - q.y ) / 0.085 ) - 0.5;
    float studs = smoothstep( 0.34, 0.24, max( abs( g.x ), abs( g.y ) ) ) * smoothstep( hw - 0.025, hw - 0.07, r ) * ( 1.0 - smoothstep( 0.012, 0.04, aaM ) );
    ftFresh = max( ftFresh, collar );
    ftTone = mix( ftTone, 0.3, collar );
    ftTar = max( ftTar, roadCover( max( abs( q.x ), abs( q.y ) ) - hw - 0.3, 0.02, aaM ) * 0.7 );
    ftMetal = max( ftMetal, max( lid, rim ) );
    ftMetalTone = mix( ftMetalTone, 0.42 + 0.3 * studs, lid );
    ftMetalTone = mix( ftMetalTone, 0.3, rim );
    ftHeight += lid * ( 3.0 * studs - 5.0 ) - 2.0 * rim;
    ftErase = max( ftErase, max( collar, lid ) );
  } else if ( kind < 7.5 ) {
    // 7 a grating: bars across its length, slots between them
    vec2 e = abs( q ) - vec2( hl, hw );
    float a = e.x > e.y ? aaS : aaL;
    float inside = smoothstep( a, -a, max( e.x, e.y ) );
    float inner = smoothstep( a, -a, max( e.x, e.y ) + 0.028 );
    float run = hl > hw ? q.x : q.y;
    float bars = roadCover( fract( run / 0.046 ) - 0.5, 0.27, ( hl > hw ? aaS : aaL ) / 0.046 );
    ftMetal = max( ftMetal, inside );
    ftMetalTone = mix( ftMetalTone, 0.36, inside );
    ftHole = max( ftHole, inner * ( 1.0 - bars ) );
    ftHeight += -3.0 * inside - 10.0 * inner * ( 1.0 - bars );
    ftErase = max( ftErase, inside );
  } else if ( kind < 8.5 ) {
    // 8 an expansion joint: steel plates either side of a gap that runs in a saw-tooth (param 0: a plain sealed joint)
    float plate = roadCover( q.x, hl, aaS ) * roadCover( q.y, hw, aaL );
    float tooth = param * ( abs( fract( q.y / 0.24 ) - 0.5 ) * 0.1 - 0.025 );
    float gap = roadCover( q.x - tooth, 0.013, aaS ) * plate;
    ftMetal = max( ftMetal, plate * step( 0.5, param ) );
    ftMetalTone = mix( ftMetalTone, 0.62, plate );
    ftTar = max( ftTar, plate * ( 1.0 - step( 0.5, param ) ) );
    ftHole = max( ftHole, gap * step( 0.5, param ) );
    ftHeight += plate * 1.0 - gap * 9.0;
    ftErase = max( ftErase, plate );
  } else {
    // 9 a stain with a ragged edge
    float r = length( q / vec2( hl, hw ) ) + ( rMottle - 0.5 ) * 0.5 + ( rBig.b - 0.5 ) * 0.3;
    float mark = smoothstep( 1.0, 0.55, r ) * ( param > 0.7 ? 0.75 * smoothstep( 0.25, 0.6, rBig.b + 0.3 * rMottle ) : 0.9 );
    ftStainTone = mix( ftStainTone, param, step( ftStain, mark ) );
    ftStain = max( ftStain, mark );
  }
}

// ================= the surfacing: how old the asphalt is here (0 laid this year, 1 a generation ago)
float rJointX = rS - ftX0 - ftHead.z;
float rAge = ftHead.z >= 0.0 ? mix( ftHead.x, ftHead.y, smoothstep( -aaS, aaS, rJointX ) ) : ftHead.x;
float rSeamTar = ftHead.z >= 0.0 ? roadCover( rJointX, 0.02, aaS ) : 0.0;
rAge = clamp( rAge + ( rBig2.r - 0.5 ) * 0.22, 0.0, 1.0 );
rAge = mix( rAge, ftTone * 0.5, ftFresh );
float rWorn = mix( 0.3, 1.0, rAge );
// new: binder over everything, black. Old: the binder weathered grey and worn off the stones' tops.
vec3 rCol = mix( vec3( 0.04, 0.04, 0.042 ), vec3( 0.112, 0.109, 0.103 ), rAge );
rCol *= 1.0 + ( rAgg.r - 0.5 ) * mix( 0.45, 1.5, rAge );
rCol *= ( 0.86 + 0.28 * rBig.r ) * ( 0.92 + 0.16 * rBig2.r ) * ( 0.92 + 0.16 * rMottle );
rCol *= 1.0 - 0.2 * rTracks * rWorn;
rCol *= 1.0 + 0.1 * rCrown * rWorn;
rCol *= 1.0 - 0.12 * rDrip * rWorn;
rCol = mix( rCol, vec3( 0.03, 0.03, 0.032 ) * ( 0.8 + 0.4 * rAgg.r ), 0.78 * rRubber );
// roughness as alpha squared (what averages truly over a pixel): each stone its own polish, the binder dull
float rAlpha2 = rAgg.b * ${ROUGH_GAIN.toFixed(2)} * mix( 1.35, 0.9, rAge );
rAlpha2 *= 1.0 - 0.5 * min( rTracks, 1.0 ) * rWorn;
rAlpha2 *= 0.8 + 0.4 * rBig.b;
rAlpha2 = mix( rAlpha2, 0.07, 0.6 * rRubber );
roadTiltGain = 1.0 - 0.35 * min( rTracks, 1.0 ) * rWorn;

// ================= paint
float rDash = roadCover( mod( rS, uDash.x ) - uDash.y * 0.5, uDash.y * 0.5, aaS );
float rDouble = smoothstep( 0.3, 0.7, vCodeA.x );
float rHatch = smoothstep( 0.3, 0.7, vCodeA.y );
float rSplit = 0.11 + 0.33 * rHatch;
float rZone = 0.0;      // the crossings' own stretch of road: no centre line through it
float rZebra = 0.0;
for ( int i = 0; i < 2; i ++ ) {
  vec4 c = uCross[ i ];
  if ( c.y <= 0.0 ) continue;
  rZone += roadCover( rS - c.x, c.y + 3.2, aaS );
  // bars along the road, half a metre wide, and a stop line before them for each direction
  rZebra += roadCover( fract( rLat + 0.5 ) - 0.5, 0.25, aaL ) * roadCover( rS - c.x, c.y, aaS ) * roadCover( rLat, uHalf - 0.3, aaL );
  rZebra += roadCover( rS - c.z, 0.2, aaS ) * roadCover( rLat + uHalf * 0.5, uHalf * 0.5 - 0.28, aaL );
  rZebra += roadCover( rS - c.w, 0.2, aaS ) * roadCover( rLat - uHalf * 0.5, uHalf * 0.5 - 0.28, aaL );
}
float rCentre = roadCover( rLat, 0.06, aaL ) * rDash * ( 1.0 - rDouble );
rCentre += ( roadCover( rLat - rSplit, 0.05, aaL ) + roadCover( rLat + rSplit, 0.05, aaL ) ) * rDouble;
rCentre += rHatch * roadCover( fract( ( rS + rLat * 1.2 ) / 1.6 ) - 0.5, 0.14, ( aaS + 1.2 * aaL ) / 1.6 ) * roadCover( rLat, max( rSplit - 0.05, 0.01 ), aaL );
rCentre *= 1.0 - min( rZone, 1.0 );
float rMarks = roadCover( rA - ( uHalf - 0.3 ), 0.075, aaL ) * vCodeA.z + rCentre + rZebra;
rMarks += roadCover( rS0, 0.2, aaS ) + roadCover( rS - uLines.y, 0.075, aaS ) + roadCover( rS - uLines.z, 0.075, aaS );
for ( int i = 0; i < 4; i ++ ) {
  float d = rS0 - uGrid[ i ].x;
  float l = rLat - uGrid[ i ].y;
  rMarks += roadCover( d - 2.7, 0.06, aaS ) * roadCover( l, 1.15, aaL );
  rMarks += roadCover( abs( l ) - 1.09, 0.06, aaL ) * roadCover( d - 2.18, 0.58, aaS );
}
// worn: thin where the tyres run, gone in places, broken by the stones up close, newer where the road is
float rWear = 0.6 * rBig.b + 0.4 * rMottle - 0.26 * min( rTracks, 1.0 ) - 0.3 * rRubber + 0.2 * ( rAgg.g - 0.5 ) * rNear + 0.35 * ( 1.0 - rAge );
roadPaint = clamp( rMarks, 0.0, 1.0 ) * rOnRoad * smoothstep( 0.14, 0.38, rWear ) * ( 1.0 - ftErase );
rCol = mix( rCol, vec3( 0.6, 0.6, 0.575 ) * ( 0.84 + 0.2 * rAgg.r ) * ( 0.82 + 0.18 * rBig.r ), roadPaint );
rAlpha2 = mix( rAlpha2, 0.085, roadPaint );
roadTiltGain *= 1.0 - 0.65 * roadPaint;

// ================= what lies on top of the paint: tar, stains, iron
// cracks that broke the old road into blocks, and the seam between the lanes
float rBlocks = roadCover( rBig.g * 5.3, 0.011, aaM ) * smoothstep( 0.55, 0.75, rBig2.b ) * smoothstep( 0.5, 0.8, rAge ) * ( 1.0 - ftFresh );
float rSeam = 0.7 * roadCover( rLat - 0.3 - 0.02 * sin( rS * 0.3 ), 0.017, aaL ) * smoothstep( 0.5, 0.62, rBig2.g + rAge * 0.3 );
float rTar = clamp( max( max( ftTar, rSeamTar ), max( rBlocks, rSeam ) ), 0.0, 1.0 ) * rOnRoad;
rCol = mix( rCol, vec3( 0.021, 0.021, 0.023 ), 0.93 * rTar );
rAlpha2 = mix( rAlpha2, 0.012, rTar );
roadTiltGain *= 1.0 - 0.7 * rTar;
vec3 rStainCol = ftStainTone < 0.3 ? rCol * 0.3 : ftStainTone < 0.7 ? mix( rCol, vec3( 0.16, 0.17, 0.14 ), 0.55 ) : rCol * 0.42;
rCol = mix( rCol, rStainCol, ftStain );
rAlpha2 = mix( rAlpha2, ftStainTone < 0.3 ? 0.02 : 0.12, ftStain * 0.8 );
vec3 rIron = mix( vec3( 0.2, 0.19, 0.18 ), vec3( 0.42, 0.4, 0.37 ), ftMetalTone ) * ( 0.8 + 0.4 * rMottle );
rCol = mix( rCol, rIron, ftMetal );
rCol = mix( rCol, vec3( 0.004 ), ftHole );
rAlpha2 = mix( rAlpha2, 0.16, ftMetal );
roadMetal = ftMetal * 0.8 * ( 1.0 - ftHole );
roadTiltGain *= 1.0 - 0.8 * ftMetal;
roadBump = ( ftHeight + 2.5 * roadPaint + 1.2 * rTar ) * 0.001;

// ================= the edge: where the asphalt ends, the gravel shoulder or a painted kerb, leaves
roadGravel = 0.0;
float rLeaves = 0.0;
float rOut = rA - uHalf;
if ( rOut > -0.95 ) {
  vec4 rEdge = textureLod( uEdge, vec2( rS / uLength, 0.5 ), 0.0 );
  float leafy = rLat > 0.0 ? rEdge.r : rEdge.g;
  float apex = rLat > 0.0 ? rEdge.b : rEdge.a;
  // the same stones three times the size: gravel, and the shapes of fallen leaves
  vec2 gP = rUv / ( AGG_TILE * 3.1 ) + 0.37;
  vec4 gAgg = textureGrad( uAgg, gP, rDx / ( AGG_TILE * 3.1 ), rDy / ( AGG_TILE * 3.1 ) );
  vec4 gRelief = textureGrad( uAggN, gP, rDx / ( AGG_TILE * 3.1 ), rDy / ( AGG_TILE * 3.1 ) );
  float loose = 1.0 - step( 0.5, vRoad.z );
  // the asphalt's edge is broken: it ends a hand's width early here, late there
  float ragged = ( rBig.b - 0.5 ) * 0.12 + ( gAgg.a - 0.5 ) * 0.07;
  float beyond = smoothstep( -aaL, aaL, rOut + ragged ) * loose * ( 1.0 - apex );
  vec3 gravel = vec3( 0.2, 0.19, 0.17 ) * ( 0.35 + 1.3 * gAgg.r ) * mix( 0.5, 1.0, smoothstep( 0.2, 0.5, gAgg.g ) );
  // a flush kerb of concrete blocks round the inside of a tight bend, painted red and white, scuffed
  float kerb = smoothstep( -aaL, aaL, rOut ) * loose * apex;
  float block = roadCover( fract( rS / 3.0 ) - 0.5, 0.25, aaS / 3.0 );
  vec3 kerbCol = mix( vec3( 0.5, 0.49, 0.46 ), vec3( 0.4, 0.04, 0.03 ), block ) * ( 0.6 + 0.5 * gAgg.a ) * ( 0.8 + 0.3 * rBig.r );
  kerbCol *= 1.0 - 0.6 * roadCover( fract( rS / 1.5 ) - 0.5, 0.008, aaS / 1.5 );
  kerbCol *= 1.0 - 0.45 * vCodeB.y * smoothstep( 0.35, 0.6, rBig.b );
  rCol = mix( rCol, gravel, beyond );
  rCol = mix( rCol, kerbCol, kerb );
  rAlpha2 = mix( rAlpha2, 0.5, beyond );
  rAlpha2 = mix( rAlpha2, 0.2, kerb );
  roadPaint *= 1.0 - max( beyond, kerb );
  roadMetal *= 1.0 - beyond;
  roadGravel = beyond;
  // leaves gather along the edge under trees
  float lying = leafy * smoothstep( -0.95, -0.05, rOut ) * ( 0.55 + 0.9 * rBig2.r );
  rLeaves = smoothstep( 1.02 - 0.3 * lying, 1.06 - 0.3 * lying, gAgg.b + 0.25 ) * step( 0.02, lying ) * ( 1.0 - kerb * 0.5 );
  rCol = mix( rCol, mix( vec3( 0.16, 0.085, 0.025 ), vec3( 0.05, 0.03, 0.015 ), gAgg.r ), rLeaves );
  rAlpha2 = mix( rAlpha2, 0.2, rLeaves );
  roadTilt = mix( roadTilt, ( gRelief.xy * 2.0 - 1.0 ) / max( gRelief.z * 2.0 - 1.0, 0.25 ) * 2.4, beyond );
  rVariance = mix( rVariance, gRelief.a / ${VARIANCE_GAIN.toFixed(1)} * 5.0, beyond );
  roadTiltGain = mix( roadTiltGain, 1.0, beyond ) * ( 1.0 - 0.8 * max( kerb, rLeaves ) );
  rAgg.g = mix( rAgg.g, gAgg.g, beyond );
}

// ================= water
// what fell here, and what tyres carried in under the roof
float rRain = uWet * smoothstep( 0.05, 0.6, vRoad.w );
float rCarried = uWet * vCodeB.z * ( 0.25 + 0.75 * min( rTracks, 1.0 ) ) * ( 0.5 + rBig.b );
// The surface's height in millimetres above where water would lie level: the crown on the straight or the banking
// in a bend, dips (drawn out along the road, as water lies), the ruts, and whatever was laid proud or has sunk.
float rBank = ( vCodeB.w - 0.5 ) * 2.0;
float hCrown = 6.5 * ( 1.0 - smoothstep( 0.5, 3.9, rA ) );
float hBank = 3.5 + 6.0 * rBank * rLat / uHalf;
float hDips = ( 0.5 - 0.6 * texture2D( uBig, vec2( rLat, rS * 0.4 ) / 9.0 ).a - 0.4 * rBig.a ) * 13.0;
float hMacro = mix( hBank, hCrown, 1.0 - smoothstep( 0.08, 0.4, abs( rBank ) ) ) + hDips + ( rMottle - 0.5 ) * 1.6;
hMacro -= ( 2.0 + 2.5 * rBig.b ) * min( rTracks, 1.2 ) * rWorn;
// held back along the pavement's edge by the edge line and the verge
hMacro -= 2.5 * exp( -pow( ( rA - ( uHalf - 0.55 ) ) / 0.3, 2.0 ) );
hMacro += ftHeight + 2.5 * roadPaint + 1.2 * rTar + 4.0 * roadGravel;
float rDepth = mix( -10.0, 6.0, rRain ) - 6.0 * ( 1.0 - vRoadAlong.w ) - hMacro;
// measured in stones' heights: below 0 only the pores are full, at 1 the last tops go under
float rFill = clamp( rDepth / 2.4, -4.0, 1.3 );
float rRaining = step( 0.02, rRain );
roadWater = rRaining * mix( smoothstep( 0.0, 1.0, rFill ), smoothstep( -0.14, 0.14, rFill * 1.1 - rAgg.g ), rNear );
roadPuddle = rRaining * smoothstep( 0.9, 1.08, rFill + ( rAgg.g - 0.5 ) * 0.2 * rNear );
roadWater = max( roadWater, 0.4 * rCarried * smoothstep( 0.6, 0.3, rAgg.g * rNear + 0.45 * ( 1.0 - rNear ) ) ) * ( 1.0 - ftHole );
// damp darkens: the pores full, light lost inside. Driest on the crown, darkest at the water's edge.
float rSoaked = max( smoothstep( 0.0, 0.2, rRain ) * mix( 0.55, 1.0, smoothstep( -4.0, -0.3, rFill ) ), min( rCarried, 1.0 ) );
rCol *= mix( 1.0, mix( mix( 0.5, 0.8, roadPaint ), 0.9, roadMetal ), rSoaked );
rCol *= 1.0 - 0.12 * roadPuddle;
rAlpha2 *= mix( 1.0, 0.75, rSoaked );
// a broken film scatters what it mirrors, standing water does not
roadWaterRough = mix( 0.42, 0.05, smoothstep( 0.35, 1.05, rFill ) );
roadTiltGain *= 1.0 - roadWater;

diffuseColor.rgb *= rCol;
// the stones' tilts that a pixel averages away come back as roughness (see roadTextures.js)
float rRoughDry = pow( clamp( rAlpha2 + rVariance * roadTiltGain * roadTiltGain, 0.0004, 1.0 ), 0.25 );
roadRoughness = mix( rRoughDry, roadWaterRough, roadWater );
`;

const ASPHALT_NORMAL = /* glsl */ `
{
  vec3 n0 = normal;
  vec3 alongV = ( viewMatrix * vec4( vRoadAlong.xyz, 0.0 ) ).xyz;
  alongV = normalize( alongV - n0 * dot( alongV, n0 ) );
  vec3 acrossV = cross( n0, alongV ); // towards +lat, the left
  vec3 bent = n0 + ( acrossV * roadTilt.x + alongV * roadTilt.y ) * roadTiltGain * ( 0.3 + 0.7 * roadFade );
  // what stands proud (paint, tar, a patch's lip) or is cut in (a cover, a grating): its slope from one pixel to the next
  vec3 dPx = - dFdx( vViewPosition );
  vec3 dPy = - dFdy( vViewPosition );
  vec3 r1 = cross( dPy, n0 );
  vec3 r2 = cross( n0, dPx );
  float det = dot( dPx, r1 );
  vec3 grad = ( dFdx( roadBump ) * r1 + dFdy( roadBump ) * r2 ) / ( sign( det ) * max( abs( det ), 1.0e-10 ) );
  grad *= roadFade * ( 1.0 - roadPuddle ) / max( 1.0, length( grad ) );
  normal = normalize( bent - grad );
}
`;

const ASPHALT_BEADS = /* glsl */ `
{
  // glass beads in the paint: light from a head lamp comes back towards the lamp, so a driver sees the lines lit
  // far beyond what their diffuse white would show
  vec3 toEye = normalize( cameraPosition - vRoadWorld.xyz );
  float retro = 0.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 l = uBeamPos[ i ] - vRoadWorld.xyz;
    float d = max( length( l ), 1.0 );
    l /= d;
    float cone = smoothstep( 0.86, 0.975, dot( -l, uBeamDir[ i ] ) );
    float e = uBeamPower[ i ] * cone * max( l.y, 0.0 ) / ( d * d );
    float a = acos( clamp( dot( l, toEye ), -1.0, 1.0 ) );
    retro += e * exp( -a * a / 0.018 );
  }
  // (under standing water the beads are drowned: they need air behind the glass to send light back)
  totalEmissiveRadiance += roadPaint * 0.9 * retro * vRoadWorld.w * ( 1.0 - 0.8 * roadPuddle ) * vec3( 1.0, 0.98, 0.93 );

  // The head lamps' pool. Lit at a glancing angle, asphalt sends much of the light back the way it came (each stone
  // shades the next; its lit faces look back at the lamp): a driver sees the road ahead brighter than its cosine
  // says, the far end of the pool most of all. The beam's shape is the lamp's own (assets/car/lamps.js): a cut-off
  // just under the horizontal, dimmer the steeper it points down, wide across. Water mirrors it away instead.
  vec3 pool = vec3( 0.0 );
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 v = vRoadWorld.xyz - uBeamPos[ i ];
    float d = max( length( v ), 1.0 );
    v /= d;
    vec3 ax = uBeamDir[ i ];
    vec3 axUp = normalize( vec3( 0.0, 1.0, 0.0 ) - ax * ax.y );
    vec3 axRight = cross( ax, axUp );
    float vert = degrees( asin( clamp( dot( v, axUp ), -1.0, 1.0 ) ) );
    float side = degrees( asin( clamp( dot( v, axRight ), -1.0, 1.0 ) ) );
    float cutOff = -0.57 + min( 1.1, max( 0.0, side ) * 0.268 );
    float edge = clamp( ( cutOff - vert ) / 0.3 + 0.5, 0.0, 1.0 );
    float depth = pow( min( 1.0, 1.5 / max( 1.5, 0.3 - vert ) ), 2.6 );
    float spread = exp( -pow( side / 17.0, 2.0 ) ) * 0.75 + exp( -pow( side / 6.0, 2.0 ) ) * 0.25;
    float e = uBeamPower[ i ] * edge * depth * spread * step( 0.0, dot( v, ax ) ) / ( d * d );
    vec3 l = -v;
    float back = exp( -pow( acos( clamp( dot( l, toEye ), -1.0, 1.0 ) ), 2.0 ) / 0.09 );
    pool += e * back;
  }
  totalEmissiveRadiance += vRoadWorld.w * pool * diffuseColor.rgb * ( 0.6 * RECIPROCAL_PI ) * ( 1.0 - 0.85 * roadPuddle ) * ( 1.0 - roadPaint ) * vec3( 0.96, 0.98, 1.0 );
}
`;
