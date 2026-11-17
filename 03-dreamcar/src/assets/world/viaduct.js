// The viaduct: for each of the Track's bridges a concrete deck across the
// ravine. The road itself is road.js's; what is here is everything around and
// under it: parapets whose inner face stands at the Track's edge distance,
// each with a steel rail on posts along its top; the deck's edge beams and a
// box girder under it; expansion joints across the road at both ends; piers
// at a regular span, standing upright whatever the road's banking and sunk
// into the ravine's floor; and an abutment block at each end where the deck
// meets the hillside.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { along, footBox, levelFrame, row, stripGeometry, upright } from './furniture.js';
import { concreteDetail } from './tunnel.js';

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

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt)
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createViaducts({ track, terrain, atmosphere }) {
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
    const steps = Math.ceil((s1 - s0) / 2);
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
      piers.push(upright(new THREE.Vector3(frame.pos.x, foot, frame.pos.z), frame.yaw, 3.6, top - 0.7 - foot, 1.9));
      caps.push(upright(new THREE.Vector3(frame.pos.x, top - 0.75, frame.pos.z), frame.yaw, 5.4, 0.75, 2.4));
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
  // a pier: a slab that narrows a little towards its top
  const pier = footBox();
  const pos = pier.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.5) pos.setX(i, pos.getX(i) * 0.86);
  pier.computeVertexNormals();
  group.add(
    row(pier, concrete, piers, { name: 'viaduct-piers' }),
    row(footBox(), concrete, caps, { name: 'viaduct-pier-caps' }),
    row(footBox(), concrete, blocks, { name: 'viaduct-abutments' }),
    row(new THREE.BoxGeometry(0.05, 0.26, 0.05).translate(0, 0.13, 0), steel, railPosts, { shadow: false, name: 'viaduct-rail-posts' }),
  );

  return { group, stats: { piers: piers.length, posts: railPosts.length } };
}
