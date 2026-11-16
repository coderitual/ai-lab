// The road: one mesh of the pavement built from the Track sample by sample,
// and the asphalt it is made of.
//
// The mesh. Each row is a cross-section of the Track at one sample, its
// vertices where the surface or its markings change: the edges of the paved
// strip, the pavement's edge, the wheel tracks and the crown. Every vertex is
// track.pointAt(s, lat), the very surface the physics drives on, and its
// outermost vertices are the terrain band's innermost ones (terrain.js uses
// the same rows), so road and verge meet without a crack.
//
// Conventions for whoever builds on it: the attribute `aRoad` is (lat, s,
// paved) per vertex: metres left of the centre line, metres from the start
// line (the last row repeats the first with s = length, so s never jumps
// inside a triangle), and 1 where the strip beyond the pavement is paved
// (tunnel, viaduct) rather than loose gravel. `aAlong` is the road's direction.
//
// The asphalt. Everything is drawn in the fragment shader from (lat, s):
//  - aggregate: generated stone-and-binder textures at two scales that do not
//    line up, faded towards their average with distance so they never shimmer;
//  - wear: darker, smoother wheel tracks in each lane, a paler worn crown,
//    rectangles of fresh repair with tar seams round them, sealed cracks;
//  - paint: edge lines, a dashed centre line whose period divides the lap
//    (a solid double one, hatched apart in the tightest bends, through the
//    hairpins and the tunnel), the start/finish line, the grid's boxes and the
//    sector lines; worn, smoother than asphalt, and filled with glass beads
//    that send a car's own head lamps back towards it;
//  - roughness from the same fields (polished wheel tracks, rough patches, a
//    glassy tar seam, coarse gravel): what the lamps' highlights streak along;
//  - wetness (world.wetness, ?wet=): darker, smoother asphalt and, in the low
//    spots and the ruts, puddles that are mirrors.

import * as THREE from 'three';
import { fieldTexture, normalTexture, valueField, worleyField } from '../../engine/noise.js';
import { extend, withBake } from './shading.js';

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
/** Metres a repeat of the aggregate texture covers, and of the large field. */
const AGG_SCALE = 2.1;
const BIG_SCALE = 37;
/** Head lamp brightness (THROW in assets/car/index.js: candela-like units at the beam's peak, per lamp). */
const LAMP_LOW = 3200;
const LAMP_HIGH = 9000;
/** Up to this many cars' head lamps answered by the paint. */
const BEAMS = 2;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('./terrain.js').Terrain} options.terrain for the baked light
 * @param {number} options.rowStep one row every this many samples (the terrain band's own step)
 */
export function createRoad({ track, caps, tier, atmosphere, terrain, rowStep }) {
  const n = track.count;
  const ds = track.ds;
  const half = track.halfWidth;
  const pave = half + track.shoulder;

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
  for (let a = 0; a < rows.length - 1; a += CHUNK) {
    const list = rows.slice(a, Math.min(rows.length, a + CHUNK + 1));
    const count = list.length * cols;
    const pos = new Float32Array(count * 3);
    const road = new Float32Array(count * 3);
    const along = new Float32Array(count * 3);
    const bake = new Float32Array(count * 3);
    for (let r = 0; r < list.length; r++) {
      const i = list[r] % n;
      const s = list[r] * ds;
      const pavedL = track.vergeL[i] === 0; // SURFACE.ASPHALT: paved up to the wall or the parapet
      const pavedR = track.vergeR[i] === 0;
      const lats = ACROSS.slice();
      lats[0] = pavedL ? track.edgeL[i] : pave;
      lats[1] = pave;
      lats[cols - 2] = -pave;
      lats[cols - 1] = pavedR ? -track.edgeR[i] : -pave;
      track.frameAt(s % track.length, frame);
      for (let k = 0; k < cols; k++) {
        const v = r * cols + k;
        track.pointAt(s % track.length, lats[k], pt);
        pt.toArray(pos, v * 3);
        road[v * 3] = lats[k];
        road[v * 3 + 1] = s;
        road[v * 3 + 2] = lats[k] > 0 ? (pavedL ? 1 : 0) : pavedR ? 1 : 0;
        frame.tan.toArray(along, v * 3);
        terrain.bakeAt(pt.x, pt.z, bake, v * 3);
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
    geometry.setAttribute('aRoad', new THREE.BufferAttribute(road, 3));
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 3));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometries.push(geometry);
  }

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
      codes[i * 4 + 2] = 255;
    }
  }
  const codeTexture = new THREE.DataTexture(codes, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  codeTexture.magFilter = codeTexture.minFilter = THREE.LinearFilter;
  codeTexture.wrapS = THREE.RepeatWrapping;
  codeTexture.needsUpdate = true;

  // ---- the asphalt's textures
  const size = tier === 'low' ? 256 : 512;
  const anisotropy = Math.min(16, caps.maxAnisotropy ?? 1);
  const stones = worleyField(size, { seed: 41, cells: Math.round(size * 0.34) });
  const fines = valueField(size, { seed: 42, cells: Math.round(size / 2), octaves: 1 });
  const wear = valueField(size, { seed: 43, cells: 8, octaves: 3 });
  const binder = valueField(size, { seed: 44, cells: 32, octaves: 2 });
  const speck = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < speck.length; i++) {
    const stone = 1 - Math.min(1, stones[i] * 1.6);
    speck[i] = 0.55 * stone + 0.45 * fines[i];
    height[i] = 0.8 * stone + 0.2 * fines[i];
  }
  const agg = fieldTexture(size, [speck, height, wear, binder], { anisotropy });
  const aggNormal = normalTexture(size, height, { relief: 0.02, anisotropy });
  const bs = 256;
  const big = fieldTexture(
    bs,
    [
      valueField(bs, { seed: 51, cells: 8, octaves: 4 }),
      worleyField(bs, { seed: 52, cells: 7, mode: 'edge' }),
      valueField(bs, { seed: 53, cells: 16, octaves: 3 }),
      valueField(bs, { seed: 54, cells: 10, octaves: 3 }),
    ],
    { anisotropy },
  );

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

  const uniforms = {
    uAgg: { value: agg },
    uAggN: { value: aggNormal },
    uBig: { value: big },
    uCodes: { value: codeTexture },
    uLength: { value: track.length },
    uDash: { value: new THREE.Vector2(period, DASH) },
    uLines: { value: new THREE.Vector3(0, track.sectors[0] ?? -1e4, track.sectors[1] ?? -1e4) },
    uGrid: { value: slots },
    uHalf: { value: half },
    uWet: { value: 0 },
    uBeamPos: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, -1e4, 0)) },
    uBeamDir: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, 0, 1)) },
    uBeamPower: { value: new Array(BEAMS).fill(0) },
  };

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  material.name = 'asphalt';
  extend(material, 'asphalt', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aRoad;\nattribute vec3 aAlong;\nvarying vec3 vRoad;\nvarying vec3 vRoadWorld;\nvarying vec3 vAlong;\nvarying vec3 vRoadNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRoad = aRoad;\nvAlong = aAlong;\nvRoadWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvRoadNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ASPHALT_PARS}`)
      .replace('#include <map_fragment>', ASPHALT_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRoughness;')
      .replace('#include <normal_fragment_maps>', ASPHALT_NORMAL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ASPHALT_BEADS}`);
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
    /** 0..1 */
    setWetness(w) {
      uniforms.uWet.value = w;
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
      for (const t of [agg, aggNormal, big, codeTexture]) t.dispose();
      material.dispose();
    },
  };
}

const ASPHALT_PARS = /* glsl */ `
uniform sampler2D uAgg;
uniform sampler2D uAggN;
uniform sampler2D uBig;
uniform sampler2D uCodes;
uniform float uLength;
uniform vec2 uDash;
uniform vec3 uLines;
uniform vec4 uGrid[4];
uniform float uHalf;
uniform float uWet;
uniform vec3 uBeamPos[${BEAMS}];
uniform vec3 uBeamDir[${BEAMS}];
uniform float uBeamPower[${BEAMS}];
varying vec3 vRoad;
varying vec3 vRoadWorld;
varying vec3 vAlong;
varying vec3 vRoadNormal;
float roadRoughness;
float roadPaint;
float roadPuddle;
float roadFade;
float roadGravel;

float roadHash( float n ) { return fract( sin( n * 127.1 + 3.7 ) * 43758.5453 ); }
// 1 inside a band of width w round c, its edges smoothed over a pixel
float roadBand( float x, float c, float w ) {
  float aa = fwidth( x ) * 0.8 + 1e-4;
  return smoothstep( w * 0.5 + aa, w * 0.5 - aa, abs( x - c ) );
}
// 1 where lo < x < hi, smoothed over a pixel
float roadSpan( float x, float lo, float hi ) {
  float aa = fwidth( x ) * 0.8 + 1e-4;
  return smoothstep( lo - aa, lo + aa, x ) * smoothstep( hi + aa, hi - aa, x );
}
`;

const ASPHALT_COLOR = /* glsl */ `
float rLat = vRoad.x;
float rS = vRoad.y;
float rA = abs( rLat );
// s counted back from the line is negative near the end of the lap
float rS0 = rS > uLength * 0.5 ? rS - uLength : rS;
float rDist = length( vRoadWorld - cameraPosition );
roadFade = 1.0 - smoothstep( 18.0, 110.0, rDist );

vec2 rUv = vec2( rLat, rS );
vec4 rAgg = texture2D( uAgg, rUv / ${AGG_SCALE.toFixed(2)} );
vec4 rAgg2 = texture2D( uAgg, vec2( rUv.x * 0.6 + rUv.y * 0.8, rUv.y * 0.6 - rUv.x * 0.8 ) / ${(AGG_SCALE * 0.43).toFixed(3)} );
vec4 rBig = texture2D( uBig, rUv / ${BIG_SCALE.toFixed(1)} );
vec4 rBig2 = texture2D( uBig, rUv.yx / ${(BIG_SCALE * 3.1).toFixed(1)} );
vec4 rCode = texture2D( uCodes, vec2( rS / uLength, 0.5 ) );

// stones in a binder, faded to their average far away
float rSpeck = mix( 0.5, 0.55 * rAgg.r + 0.45 * rAgg2.r, 0.25 + 0.75 * roadFade );

// wheel tracks: two in each lane, wandering a little
float rWander = 0.07 * sin( rS * 0.043 ) + 0.05 * sin( rS * 0.11 + 1.3 );
float rTracks = 0.0;
rTracks += exp( -pow( ( rA - 1.33 + rWander ) / 0.32, 2.0 ) );
rTracks += exp( -pow( ( rA - 2.93 + rWander ) / 0.34, 2.0 ) );
rTracks *= step( rA, uHalf ) * ( 0.75 + 0.5 * rBig.b );
float rCrown = exp( -pow( rLat / 0.8, 2.0 ) );

vec3 rCol = vec3( 0.108, 0.106, 0.102 ) * ( 0.72 + 0.56 * rSpeck ) * ( 0.85 + 0.3 * rBig.r ) * ( 0.9 + 0.2 * rBig2.r );
rCol *= 1.0 - 0.2 * rTracks;
rCol *= 1.0 + 0.12 * rCrown;
float rRough = mix( 0.88, 0.6, rTracks ) + 0.06 * ( rAgg.a - 0.5 );

// repairs: now and then a rectangle of newer, darker asphalt with tar round it
float rCell = floor( rS / 26.0 );
float rH = roadHash( rCell );
float rStart = rCell * 26.0 + 2.0 + roadHash( rCell + 0.31 ) * 10.0;
float rLen = 2.5 + roadHash( rCell + 0.67 ) * 9.0;
float rSide = roadHash( rCell + 0.93 ) < 0.5 ? 1.0 : -1.0;
float rWide = roadHash( rCell + 0.17 ) < 0.3 ? 1.0 : 0.0;
float rLat0 = mix( rSide > 0.0 ? 0.25 : -3.9, -3.9, rWide );
float rLat1 = mix( rSide > 0.0 ? 3.9 : -0.25, 3.9, rWide );
float rPatch = step( rH, 0.38 ) * roadSpan( rS, rStart, rStart + rLen ) * roadSpan( rLat, rLat0, rLat1 );
float rRim = step( rH, 0.38 ) * max(
  roadBand( rS, rStart, 0.05 ) + roadBand( rS, rStart + rLen, 0.05 ),
  ( roadBand( rLat, rLat0, 0.05 ) + roadBand( rLat, rLat1, 0.05 ) ) * roadSpan( rS, rStart, rStart + rLen ) ) * roadSpan( rS, rStart - 0.03, rStart + rLen + 0.03 );
rCol = mix( rCol, vec3( 0.062, 0.061, 0.059 ) * ( 0.8 + 0.4 * rSpeck ), rPatch );
rRough = mix( rRough, 0.8 + 0.05 * rTracks, rPatch );

// sealed cracks and a tar seam along the joint between the lanes
float rCrackMask = smoothstep( 0.55, 0.75, rBig2.b ) * ( 1.0 - rPatch );
float rCrack = smoothstep( 0.012, 0.004, rBig.g ) * rCrackMask;
float rSeam = 0.6 * roadBand( rLat, 0.3 + 0.02 * sin( rS * 0.3 ), 0.035 ) * smoothstep( 0.5, 0.6, rBig2.g );
float rTar = clamp( max( rCrack, max( rRim, rSeam ) ), 0.0, 1.0 ) * step( rA, uHalf );
rCol = mix( rCol, vec3( 0.03, 0.03, 0.029 ), rTar * 0.9 );
rRough = mix( rRough, 0.34, rTar );

// the strip beyond the pavement: loose gravel unless it is paved (tunnel, viaduct)
roadGravel = step( uHalf, rA ) * ( 1.0 - step( 0.5, vRoad.z ) );
vec3 rGravelCol = vec3( 0.16, 0.152, 0.138 ) * ( 0.6 + 0.8 * rAgg2.g );
rCol = mix( rCol, rGravelCol, roadGravel );
rRough = mix( rRough, 0.96, roadGravel );

// ---- paint
float rOnRoad = step( rA, uHalf );
float rEdge = roadBand( rA, uHalf - 0.3, 0.15 ) * rCode.b;
float rPh = mod( rS, uDash.x );
float rAaS = fwidth( rS ) + 1e-4;
float rDashOn = smoothstep( 0.0, rAaS, rPh ) * smoothstep( uDash.y, uDash.y - rAaS, rPh );
float rDouble = smoothstep( 0.3, 0.7, rCode.r );
float rHatch = smoothstep( 0.3, 0.7, rCode.g );
float rSplit = 0.11 + 0.33 * rHatch;
float rCentre = roadBand( rLat, 0.0, 0.12 ) * rDashOn * ( 1.0 - rDouble );
rCentre += ( roadBand( rLat, rSplit, 0.1 ) + roadBand( rLat, -rSplit, 0.1 ) ) * rDouble;
float rStripe = roadBand( fract( ( rS + rLat * 1.2 ) / 1.6 ), 0.5, 0.28 );
rCentre += rHatch * rStripe * roadSpan( rLat, -rSplit + 0.05, rSplit - 0.05 );
float rLines = roadBand( rS0, 0.0, 0.4 ) + roadBand( rS, uLines.y, 0.15 ) + roadBand( rS, uLines.z, 0.15 );
float rBoxes = 0.0;
for ( int i = 0; i < 4; i ++ ) {
  float d = rS0 - uGrid[ i ].x;
  float l = rLat - uGrid[ i ].y;
  rBoxes += roadBand( d, 2.7, 0.12 ) * roadSpan( l, -1.15, 1.15 );
  rBoxes += roadBand( abs( l ), 1.09, 0.12 ) * roadSpan( d, 1.6, 2.76 );
}
roadPaint = clamp( rEdge + rCentre + rLines + rBoxes, 0.0, 1.0 ) * rOnRoad;
// worn: thinner where the tyres run, gone in patches, broken by the aggregate up close
float rWear = 0.62 * rBig.b + 0.38 * rAgg.b - 0.25 * rTracks + 0.18 * ( rAgg.r - 0.5 ) * roadFade;
roadPaint *= smoothstep( 0.2, 0.42, rWear ) * ( 1.0 - 0.8 * rPatch );
rCol = mix( rCol, vec3( 0.62, 0.62, 0.6 ) * ( 0.9 + 0.1 * rSpeck ), roadPaint );
rRough = mix( rRough, 0.55, roadPaint );

// ---- water: the asphalt darkens and smooths, and the low spots and ruts fill
float rLow = rBig.a * 0.8 + 0.2 * rBig2.a + 0.22 * rTracks * rOnRoad - 0.15 * roadGravel;
roadPuddle = smoothstep( 0.95 - 0.5 * uWet, 1.0 - 0.5 * uWet, rLow ) * step( 0.02, uWet );
rCol *= mix( 1.0, mix( 0.5, 0.85, roadPaint ), uWet );
rRough = mix( rRough, 0.14 + 0.3 * rRough * rRough, uWet );
rCol = mix( rCol, rCol * 0.7, roadPuddle );
rRough = mix( rRough, 0.025, roadPuddle );

diffuseColor.rgb *= rCol;
roadRoughness = rRough;
`;

const ASPHALT_NORMAL = /* glsl */ `
{
  vec3 n0 = normalize( vRoadNormal );
  vec3 along = normalize( vAlong - n0 * dot( vAlong, n0 ) );
  vec3 across = cross( n0, along ); // towards +lat, the left
  vec3 d1 = texture2D( uAggN, rUv / ${AGG_SCALE.toFixed(2)} ).xyz * 2.0 - 1.0;
  vec3 d2 = texture2D( uAggN, vec2( rUv.x * 0.6 + rUv.y * 0.8, rUv.y * 0.6 - rUv.x * 0.8 ) / ${(AGG_SCALE * 0.43).toFixed(3)} ).xyz * 2.0 - 1.0;
  vec2 tilt = 0.6 * d1.xy + 0.4 * d2.xy;
  // smoother where polished, painted, tarred or under water; the gravel is coarse
  float strength = roadFade * ( 1.0 - 0.45 * rTracks ) * ( 1.0 - 0.7 * roadPaint ) * ( 1.0 - 0.6 * rTar ) * ( 1.0 - roadPuddle ) * ( 1.0 + 1.5 * roadGravel );
  vec3 nw = normalize( n0 + ( across * tilt.x + along * tilt.y ) * strength * 1.2 );
  normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
}
`;

const ASPHALT_BEADS = /* glsl */ `
{
  // glass beads in the paint: light from a head lamp comes back towards the lamp, so a driver sees the lines lit
  // far beyond what their diffuse white would show
  vec3 toEye = normalize( cameraPosition - vRoadWorld );
  float retro = 0.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 l = uBeamPos[ i ] - vRoadWorld;
    float d = max( length( l ), 1.0 );
    l /= d;
    float cone = smoothstep( 0.86, 0.975, dot( -l, uBeamDir[ i ] ) );
    float e = uBeamPower[ i ] * cone * max( l.y, 0.0 ) / ( d * d );
    float a = acos( clamp( dot( l, toEye ), -1.0, 1.0 ) );
    retro += e * exp( -a * a / 0.018 );
  }
  totalEmissiveRadiance += roadPaint * 0.45 * retro * vec3( 1.0, 0.98, 0.93 );
}
`;
