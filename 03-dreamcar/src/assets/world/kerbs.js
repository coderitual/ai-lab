// The kerbs: red and white painted concrete along the Track's `kerbs`, on the
// 1.2 m margin beyond the pavement's edge, exactly where the physics has them.
//
// Every vertex is track.pointAt(s, lat): the Track's own profile, kerb
// included (flush at the road, rising to KERB.rise at the verge, the teeth a
// triangle wave along the road, ramped in and out at the ends by kerbAt).
// On the medium and high tiers rows stand at every peak and every valley of
// the teeth, so the mesh IS the profile (it is linear along the road between
// them); on the low tier rows stand at every second peak, which draws the
// tops of the teeth (up to KERB.tooth of the rise, a centimetre, above the
// valleys) and leaves the teeth to the shading. The shading's normal comes
// from the same formula on every tier, so the saw-tooth catches the light
// alike everywhere.
//
// The paint: one colour per tooth, red and white by turns; scuffed by tyres
// along the road edge, rubber smeared on where cars ride them, the concrete
// showing through worn paint, dust and earth thrown up along the verge side.
// Wet (night) it darkens and turns glossy.
// (finish lane) The white paint has glass beads in it, as a road's lines do: in a car's head lamps it sends light
// back towards the lamps (retro.js), brightest on the teeth's faces that look at the car and in specks where a bead
// sits proud; red paint, worn paint, rubber and dirt do not.

import * as THREE from 'three';
import { roadTextures } from './roadTextures.js';
import { WET_UNIFORMS, extend, withBake } from './shading.js';
import { canopyOpen } from './canopy.js';
import { retroReflective } from './retro.js';

/**
 * The kerb's shape: the same numbers as KERB in game/trackLayout.js (the world never imports from game/). The
 * Track's profile is the truth; these only place rows and shade the teeth. Read from the Track when it offers them.
 */
const KERB_FALLBACK = { rise: 0.04, tooth: 0.25, pitch: 0.9 };
/** Per tier: rows per tooth (2: a row at every peak and valley; 0.5: one at every second peak) and columns across. */
const DETAIL = { low: { rows: 0.5, cols: 3 }, medium: { rows: 2, cols: 3 }, high: { rows: 2, cols: 5 } };
/** The teeth are drawn this much steeper in the shading than they are, so that they read at a glance. */
const TOOTH_SHADE = 3;
/** (finish lane) The white paint's beads against engineering-grade sheeting (retro.js): about what the road's lines send back. */
const KERB_BEADS = 0.2;

/**
 * @param {object} options
 * @param {object} options.track the Track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ bakeAt: (x: number, z: number, out: ArrayLike<number>, offset: number) => void }} options.terrain
 */
export function createKerbs({ track, caps, tier, atmosphere, terrain }) {
  const shape = track.kerbShape ?? KERB_FALLBACK;
  const detail = DETAIL[tier] ?? DETAIL.medium;
  const half = track.halfWidth;
  const step = shape.pitch / detail.rows;
  const pt = new THREE.Vector3();
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const pos = [];
  const nor = [];
  const along = [];
  const kerb = [];
  const bake = [];
  const index = [];
  const tmp = [0, 0, 0, 1];
  let vertices = 0;
  for (const k of track.kerbs ?? []) {
    const len = track.wrap(k.s1 - k.s0);
    // rows on the teeth's peaks (and valleys): s a whole number of steps, offset to the peaks
    const peak = shape.pitch / 2;
    const first = Math.ceil((k.s0 - peak) / step) * step + peak;
    const list = [k.s0];
    for (let s = first; s < k.s0 + len; s += step) if (s > k.s0 + 1e-3) list.push(s);
    list.push(k.s0 + len);
    const cols = detail.cols;
    const base = vertices;
    for (const sRaw of list) {
      const s = track.wrap(sRaw);
      track.frameAt(s, frame);
      const amount = track.kerbAt(s, k.side);
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1);
        const lat = k.side * (half + t * k.width);
        track.pointAt(s, lat, pt);
        pos.push(pt.x, pt.y, pt.z);
        nor.push(frame.up.x, frame.up.y, frame.up.z);
        along.push(frame.tan.x, frame.tan.y, frame.tan.z, k.side);
        // s as laid (it may run past the line: never jumps inside a triangle), across 0..1, how much kerb, width
        kerb.push(sRaw, t, amount, k.width);
        (terrain.bake4At ?? terrain.bakeAt)(pt.x, pt.z, tmp, 0);
        bake.push(tmp[0], tmp[1], tmp[2] * canopyOpen(track, s, lat), tmp[3]);
        vertices++;
      }
    }
    for (let r = 0; r < list.length - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const v = base + r * cols + c;
        // keep the faces up whichever side the kerb is on
        // (columns run outwards: to the right on the right, as the road's do, so the left side is wound the other way)
        if (k.side < 0) index.push(v, v + 1, v + cols, v + 1, v + cols + 1, v + cols);
        else index.push(v, v + cols, v + 1, v + 1, v + cols, v + cols + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 4));
  geometry.setAttribute('aKerb', new THREE.Float32BufferAttribute(kerb, 4));
  geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();

  const textures = roadTextures({ caps, tier });
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  material.name = 'kerb';
  material.defines = { ...material.defines, AGG_TILE: textures.tile.toFixed(3) };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  extend(material, 'kerb', (shader) => {
    Object.assign(shader.uniforms, { uAgg: { value: textures.surface }, uBig: { value: textures.big }, ...WET_UNIFORMS });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aAlong;\nattribute vec4 aKerb;\nvarying vec4 vKerbAlong;\nvarying vec4 vKerb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKerbAlong = aAlong;\nvKerb = aKerb;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${KERB_PARS(shape)}`)
      .replace('#include <map_fragment>', KERB_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kerbRough;')
      .replace('#include <normal_fragment_maps>', KERB_NORMAL);
  });
  withBake(material);
  retroReflective(material, KERB_BEADS, { weight: 'kBeads' });
  atmosphere.patch(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'kerbs';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    stats: { vertices, triangles: index.length / 3 },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

const KERB_PARS = (shape) => /* glsl */ `
uniform sampler2D uAgg;
uniform sampler2D uBig;
uniform float uWet;
varying vec4 vKerbAlong; // the road's direction; w the side (+1 left)
varying vec4 vKerb;      // s, across 0..1 (road to verge), how much kerb, width
float kerbRough;
vec2 kerbSlope;          // rise per metre: outwards across, and along
const float KERB_RISE = ${shape.rise.toFixed(4)};
const float KERB_TOOTH = ${shape.tooth.toFixed(4)};
const float KERB_PITCH = ${shape.pitch.toFixed(4)};
float kerbCover( float d, float w, float a ) {
  return ( clamp( d + w, -a, a ) - clamp( d - w, -a, a ) ) / ( 2.0 * a );
}
`;

const KERB_COLOR = /* glsl */ `
float kS = vKerb.x;
float kT = clamp( vKerb.y, 0.0, 1.0 );
float kAmount = vKerb.z;
float kW = vKerb.w;
float kG = kS / KERB_PITCH;
float kPh = fract( kG );
float kAaS = 0.6 * ( abs( dFdx( kS ) ) + abs( dFdy( kS ) ) ) + 1.0e-3;
// the teeth (game/track.js, _kerb): the shape's slope, for the normal
float kTri = 1.0 - abs( 2.0 * kPh - 1.0 );
float kDtri = ( kPh < 0.5 ? 2.0 : -2.0 ) / KERB_PITCH;
float kBump = sin( PI * kT );
float kShape = 1.0 - KERB_TOOTH * ( 1.0 - kTri ) * kBump;
float kRise = KERB_RISE * kAmount;
kerbSlope = vec2(
  kRise * ( kShape - kT * KERB_TOOTH * ( 1.0 - kTri ) * PI * cos( PI * kT ) ) / kW,
  kRise * kT * KERB_TOOTH * kBump * kDtri * ${TOOTH_SHADE.toFixed(1)} );
// one colour per tooth, red and white by turns; the change falls in a valley
float kEdgeAa = kAaS / KERB_PITCH;
float kSeam = kerbCover( fract( kG + 0.5 ) - 0.5, 0.012, kEdgeAa );
float kRed = clamp( ( abs( fract( kG * 0.5 + 0.25 ) * 2.0 - 1.0 ) - 0.5 ) / ( 2.0 * kEdgeAa ) + 0.5, 0.0, 1.0 );
vec2 kUv = vec2( ( kT * kW ) / AGG_TILE, kS / AGG_TILE );
vec4 kAgg = texture2D( uAgg, kUv * 0.7 );
vec4 kBig = texture2D( uBig, vec2( kT * kW, kS ) / 9.0 );
vec4 kBig2 = texture2D( uBig, vec2( kS * 0.11, kT * kW * 0.6 ) );
vec3 kPaint = mix( vec3( 0.62, 0.61, 0.58 ), vec3( 0.42, 0.035, 0.03 ), kRed );
// paint worn through to the concrete where it is old, most on the tops of the teeth and at the road edge
float kWorn = smoothstep( 0.55, 0.8, kBig.b * 0.7 + kAgg.a * 0.3 + 0.25 * kTri * kBump + 0.2 * ( 1.0 - kT ) );
vec3 kConcrete = vec3( 0.3, 0.29, 0.27 ) * ( 0.75 + 0.5 * kAgg.r );
vec3 kCol = mix( kPaint * ( 0.9 + 0.2 * kAgg.r ), kConcrete, 0.75 * kWorn );
// rubber: tyres ride the inner half, laying black smears drawn out along the road
float kRubber = smoothstep( 0.75, 0.1, kT ) * smoothstep( 0.35, 0.7, kBig2.b + 0.25 * kBig.r ) * 0.75;
kCol = mix( kCol, vec3( 0.025, 0.024, 0.024 ), kRubber );
// dust and earth thrown up along the verge side, grime in the valleys of the teeth
float kDirt = smoothstep( 0.55, 1.0, kT + 0.25 * ( kBig.r - 0.5 ) ) * ( 0.45 + 0.55 * kAgg.a );
kCol = mix( kCol, vec3( 0.16, 0.13, 0.09 ) * ( 0.7 + 0.6 * kAgg.r ), 0.65 * kDirt );
kCol *= 1.0 - 0.18 * ( 1.0 - kTri ) * kBump - 0.5 * kSeam;
// wet: darker, glossy paint
kCol *= mix( 1.0, 0.6, uWet );
kerbRough = mix( mix( 0.5, 0.75, kWorn ), 0.55, kRubber );
kerbRough = mix( kerbRough, 0.12 + 0.2 * kWorn, smoothstep( 0.05, 0.4, uWet ) );
diffuseColor.rgb *= kCol;
// (finish lane) how much of the pixel is beaded white paint, in specks (retro.js reads it as its weight); a kerb
// stands proud of the water, so the wet road drowns only some of the beads
float kBeads = ( 1.0 - kRed ) * ( 1.0 - 0.85 * kWorn ) * ( 1.0 - kRubber ) * ( 1.0 - 0.65 * kDirt ) * ( 1.0 - kSeam )
  * ( 0.35 + 2.2 * smoothstep( 0.6, 0.92, kAgg.r ) ) * ( 1.0 - 0.3 * uWet );
`;

const KERB_NORMAL = /* glsl */ `
{
  vec3 n0 = normal;
  vec3 alongV = normalize( ( viewMatrix * vec4( vKerbAlong.xyz, 0.0 ) ).xyz );
  alongV = normalize( alongV - n0 * dot( alongV, n0 ) );
  // outwards: towards the verge (left of the road when the kerb is on the left)
  vec3 outV = cross( n0, alongV ) * vKerbAlong.w;
  normal = normalize( n0 - outV * kerbSlope.x - alongV * kerbSlope.y );
}
`;
