// The viaduct: for each of the Track's bridges a concrete deck across the
// ravine. The road itself is road.js's; what is here is everything around and
// under it: parapets whose inner face stands at the Track's edge distance,
// each with a steel rail on posts along its top; the deck's edge beams and a
// box girder under it; expansion joints across the road at both ends; piers
// at a regular span, standing upright whatever the road's banking and sunk
// into the ravine's floor (tall slender eight-sided shafts, tapering a little,
// under a flared capital, in board-marked concrete cast in lifts, stained by
// water running off the deck: frame A); and an abutment block at each end where the deck
// meets the hillside.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { along, footBox, levelFrame, row, stripGeometry, upright } from './furniture.js';
import { GLSL_HASH, GLSL_NOISE } from '../../engine/glsl.js';
import { concreteDetail } from './tunnel.js';
import { extend } from './shading.js';

/**
 * The deck's cross-section beyond the parapet's inner face, the left half: [lat beyond the face, h] (m). From the
 * road at the face, up the parapet, over its top, down the edge beam's outside, under the cantilever, down the
 * girder's web and across its soffit to the middle (lat given from the centre line there, as `mid`).
 */
const PARAPET = [
  [0, 0],
  [0, 0.16],
  [0.06, 0.26],
  [0.1, 0.86],
  [0.42, 0.9],
  [0.5, 0.8],
  [0.5, -0.95],
];
/** Under the deck, in lat from the centre line. */
const UNDER = [
  [3.0, -1.2],
  [2.4, -2.9],
  [0, -2.9],
];
/** The steel rail along the parapet's top: its height above the road and where it stands beyond the face. */
const RAIL = { h: 1.12, out: 0.26, radius: 0.045 };
/** Span between piers (fitted to the bridge), and the shortest pier worth standing. */
const SPAN = 30;
const MIN_PIER = 3;
/** Metres between the deck's cross-sections, by tier. */
const STEP = { low: 6, medium: 3, high: 2 };
/** The pier's shaft (across the road, along it, m; how much it narrows to the top) and its capital. */
const SHAFT = { across: 2.3, along: 1.45, taper: 0.82 };
const CAPITAL = { across: 5.6, along: 2.3, height: 1.7 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt)
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createViaducts({ track, terrain, atmosphere, tier = 'medium' }) {
  const group = new THREE.Group();
  group.name = 'viaducts';
  const concrete = concreteDetail(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x95928a, roughness: 0.9, side: THREE.DoubleSide })));
  const steel = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x9aa1a6, metalness: 0.85, roughness: 0.35 }));
  const joint = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x2c2e30, metalness: 0.7, roughness: 0.5 }));
  const frame = {};
  const p = new THREE.Vector3();

  const deckParts = [];
  const railParts = [];
  const jointParts = [];
  const railPosts = [];
  const piers = [];
  const caps = [];
  const blocks = [];

  for (const b of track.bridges) {
    const s0 = b.s0 - 1.5;
    const s1 = b.s1 + 1.5;
    const steps = Math.ceil((s1 - s0) / (STEP[tier] ?? 3));
    const sections = Array.from({ length: steps + 1 }, (_, k) => s0 + ((s1 - s0) * k) / steps);
    /** A point at (lat from the centre line, h above the road at the face on that side) in the level frame at s. */
    const at = (s, side, lat, h) => {
      levelFrame(track, s, frame);
      const face = track.edgeAt(s, side);
      const y = track.pointAt(s, side * face, p).y;
      return [frame.pos.x + frame.flat.x * side * lat, y + h, frame.pos.z + frame.flat.z * side * lat, s, h];
    };
    for (const side of [1, -1]) {
      // each face of the section its own strip, so the corners stay sharp
      const outline = [
        ...PARAPET.map(([out, h]) => (s) => at(s, side, track.edgeAt(s, side) + out, h)),
        ...UNDER.map(([lat, h]) => (s) => at(s, side, lat, h)),
      ];
      for (let k = 0; k < outline.length - 1; k++) {
        deckParts.push(stripGeometry(sections.map((s) => [outline[k](s), outline[k + 1](s)])));
      }
      // the steel rail: an eight-sided tube
      const tube = [];
      for (let a = 0; a <= 8; a++) tube.push([Math.cos((a / 8) * 2 * Math.PI) * RAIL.radius, Math.sin((a / 8) * 2 * Math.PI) * RAIL.radius]);
      railParts.push(
        stripGeometry(sections.map((s) => tube.map(([dl, dh]) => at(s, side, track.edgeAt(s, side) + RAIL.out + dl, RAIL.h + dh)))),
      );
      along(track, s0 + 0.5, s1 - 0.5, 2, (s) => {
        levelFrame(track, s, frame);
        const [x, y, z] = at(s, side, track.edgeAt(s, side) + RAIL.out, 0.88);
        railPosts.push(upright(new THREE.Vector3(x, y, z), frame.yaw));
      });
    }
    // expansion joints: steel plates across the road at both ends of the deck
    for (const s of [b.s0 + 0.4, b.s1 - 0.4]) {
      const rowAt = (ds) => {
        const lats = [];
        for (let k = 0; k <= 8; k++) lats.push(-track.edgeAt(s, -1) + ((track.edgeAt(s, 1) + track.edgeAt(s, -1)) * k) / 8);
        return lats.map((lat) => {
          track.pointAt(s + ds, lat, p);
          return [p.x, p.y + 0.012, p.z, s + ds, lat];
        });
      };
      jointParts.push(stripGeometry([rowAt(-0.14), rowAt(0.14)]));
    }

    // piers, upright, between the abutments; and the abutments themselves
    const spans = Math.max(1, Math.round((b.s1 - b.s0) / SPAN));
    for (let k = 1; k < spans; k++) {
      const s = b.s0 + ((b.s1 - b.s0) * k) / spans;
      levelFrame(track, s, frame);
      const top = frame.pos.y - 2.9;
      let ground = Infinity;
      for (const [dl, da] of [[-2.2, -1], [2.2, -1], [-2.2, 1], [2.2, 1], [0, 0]]) {
        const x = frame.pos.x + frame.flat.x * dl + frame.ahead.x * da;
        const z = frame.pos.z + frame.flat.z * dl + frame.ahead.z * da;
        ground = Math.min(ground, terrain.heightAt(x, z));
      }
      const foot = ground - 1.5;
      if (top - ground < MIN_PIER) continue;
      piers.push(upright(new THREE.Vector3(frame.pos.x, foot, frame.pos.z), frame.yaw, SHAFT.across, top - CAPITAL.height - foot + 0.05, SHAFT.along));
      caps.push(upright(new THREE.Vector3(frame.pos.x, top - CAPITAL.height, frame.pos.z), frame.yaw, CAPITAL.across, CAPITAL.height, CAPITAL.along));
    }
    for (const [s, out] of [
      [b.s0, -1],
      [b.s1, 1],
    ]) {
      levelFrame(track, s, frame);
      const top = frame.pos.y - 0.3;
      const c = new THREE.Vector3().copy(frame.pos).addScaledVector(frame.ahead, out * 1.6);
      const ground = terrain.heightAt(c.x, c.z);
      const foot = Math.min(ground, top - 3) - 3;
      const wide = 2 * (Math.max(track.edgeAt(s, 1), track.edgeAt(s, -1)) + 0.6);
      blocks.push(upright(c.setY(foot), frame.yaw, wide, top - foot, 3.4));
    }
  }

  if (deckParts.length) {
    const deck = new THREE.Mesh(mergeGeometries(deckParts), concrete);
    deck.name = 'viaduct-deck';
    deck.castShadow = deck.receiveShadow = true;
    const rails = new THREE.Mesh(mergeGeometries(railParts), steel);
    rails.name = 'viaduct-rails';
    rails.castShadow = true;
    const joints = new THREE.Mesh(mergeGeometries(jointParts), joint);
    joints.name = 'viaduct-joints';
    joints.receiveShadow = true;
    group.add(deck, rails, joints);
    for (const g of [...deckParts, ...railParts, ...jointParts]) g.dispose();
  }
  // a pier: an eight-sided shaft (a rectangle with its corners cut) narrowing a little towards its top, and a
  // capital that flares out from it to carry the girder
  const octagon = (top, bottom, open) => {
    const g = new THREE.CylinderGeometry(top, bottom, 1, 8, 1, open).rotateY(Math.PI / 8).translate(0, 0.5, 0);
    g.scale(1 / Math.cos(Math.PI / 8), 1, 1 / Math.cos(Math.PI / 8));
    g.computeVertexNormals();
    return g;
  };
  const pier = octagon(0.5 * SHAFT.taper, 0.5, true);
  const capital = octagon(0.5, (0.5 * SHAFT.across * SHAFT.taper) / CAPITAL.across, false);
  const pierConcrete = pierFinish(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x9a968d, roughness: 0.92 })));
  group.add(
    row(pier, pierConcrete, piers, { name: 'viaduct-piers' }),
    row(capital, pierConcrete, caps, { name: 'viaduct-pier-caps' }),
    row(footBox(), concrete, blocks, { name: 'viaduct-abutments' }),
    row(new THREE.BoxGeometry(0.05, 0.26, 0.05).translate(0, 0.13, 0), steel, railPosts, { shadow: false, name: 'viaduct-rail-posts' }),
  );

  return { group, stats: { piers: piers.length, posts: railPosts.length } };
}

/**
 * Cast concrete on a pier, from the world position: lifts of 2.4 m with a dark construction joint between them,
 * vertical board marks, a darker splash zone at the foot, and stains running down from the capital where water
 * drips off the deck.
 */
function pierFinish(material) {
  return extend(material, 'pier-concrete', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPierWorld;\nvarying float vPierUp;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPierWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\nvPierUp = position.y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${GLSL_NOISE}\nvarying vec3 vPierWorld;\nvarying float vPierUp;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vPierWorld;
  float aa = fwidth( p.y ) + 1.0e-3;
  float lift = 1.0 - smoothstep( 0.02, 0.02 + aa, abs( fract( p.y / 2.4 + 0.5 ) - 0.5 ) * 2.4 );
  float boards = 0.93 + 0.07 * hash11( floor( ( p.x + p.z ) / 0.2 ) );
  float tone = 0.9 + 0.2 * valueNoise( vec2( ( p.x + p.z ) * 0.15, p.y * 0.05 ) );
  // streaks hanging from the top
  float streak = valueNoise( vec2( ( p.x - p.z ) * 2.2, 0.0 ) ) * valueNoise( vec2( ( p.x + p.z ) * 0.7, p.y * 0.02 ) );
  float fromTop = smoothstep( 0.35, 1.0, vPierUp );
  float splash = 1.0 - smoothstep( 0.0, 0.12, vPierUp );
  diffuseColor.rgb *= boards * tone * ( 1.0 - 0.5 * lift ) * ( 1.0 - 0.55 * streak * ( 0.4 + 0.6 * fromTop ) ) * ( 1.0 - 0.35 * splash );
}`,
      );
  });
}
