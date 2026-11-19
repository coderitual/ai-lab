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
import { concreteFinish } from './concrete.js';

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
 * (sea lane, round 3: frame E1) A pale bridge on piers out in the sea off the headland, scenery only (no road on it,
 * nothing reaches it): frame E1 has one across the water behind the bend, and from E1's camera (the crest, looking
 * back at the carousel) the sky road is behind. Its line runs from `from` (a piece, how far along it, metres to its
 * left) to `to`, carried on `beyond` of its length past each; its deck `deck` m over the water, `width` m wide and
 * `depth` m deep, on the viaduct's own piers every `span` m.
 */
// (round 5) none: with the coast road brought down to the bay, a deck 52 m over the water passed over the road
const SEA_SPAN = { off: true, from: ['carousel', 0.45, 260], to: ['crest', 1, 230], beyond: [0.15, 0.7], deck: 52, width: 9, depth: 2.6, span: 48 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt)
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createViaducts({ track, terrain, atmosphere, tier = 'medium' }) {
  const group = new THREE.Group();
  group.name = 'viaducts';
  // (nearfield lane) concrete.js's finish, placed by the strips' own (s, h): panels along the parapet, its cap, the
  // edge beam's foot; the girder under the deck (h under the beam) has no foot or cap
  const concrete = concreteFinish(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x95928a, roughness: 0.9, side: THREE.DoubleSide })), {
    key: 'deck',
    kind: 'parapet',
    vertex: 'vConc = vec4( uv.x, uv.y + 0.95, 0.9 - uv.y, uv.y > -1.0 ? 2.0 : 0.0 );',
  });
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
      const sides = tier === 'low' ? 4 : 8;
      for (let a = 0; a <= sides; a++) tube.push([Math.cos((a / sides) * 2 * Math.PI) * RAIL.radius, Math.sin((a / sides) * 2 * Math.PI) * RAIL.radius]);
      railParts.push(
        stripGeometry(sections.map((s) => tube.map(([dl, dh]) => at(s, side, track.edgeAt(s, side) + RAIL.out + dl, RAIL.h + dh)))),
      );
      along(track, s0 + 0.5, s1 - 0.5, tier === 'low' ? 4 : 2, (s) => {
        levelFrame(track, s, frame);
        const [x, y, z] = at(s, side, track.edgeAt(s, side) + RAIL.out, 0.88);
        railPosts.push(upright(new THREE.Vector3(x, y, z), frame.yaw));
      });
    }
    // expansion joints: steel plates across the road at both ends of the deck
    const jointProf = { y: 0, surface: 0 };
    for (const s of [b.s0 + 0.4, b.s1 - 0.4]) {
      const rowAt = (ds) => {
        const lats = [];
        // (sea lane) on the road's own cross-section (its crown and its drains), closely enough that no chord between
        // two points stands more than a few millimetres off it
        for (let k = 0; k <= 32; k++) lats.push(-track.edgeAt(s, -1) + ((track.edgeAt(s, 1) + track.edgeAt(s, -1)) * k) / 32);
        return lats.map((lat) => {
          track.pointAt(s + ds, lat, p);
          return [p.x, track.profile(s + ds, lat, jointProf).y + 0.012, p.z, s + ds, lat];
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
      // (sea lane) its top level 0.3 m under the lowest of the road over its footprint: under the centre line's
      // height it stood 0.3 m over the shoulder where the road is banked down to one side (the owner's pale plate at
      // the sea viaduct's end)
      let low = Infinity;
      const prof = { y: 0, surface: 0 };
      for (let d = -0.1; d <= 3.3; d += 0.4) {
        const sd = track.wrap(s + out * d);
        for (const side of [1, -1]) for (let f = 0; f <= 1.0001; f += 0.25) low = Math.min(low, track.profile(sd, side * f * track.edgeAt(sd, side), prof).y);
      }
      const top = Math.min(frame.pos.y, low) - 0.3;
      const c = new THREE.Vector3().copy(frame.pos).addScaledVector(frame.ahead, out * 1.6);
      const ground = terrain.heightAt(c.x, c.z);
      const foot = Math.min(ground, top - 3) - 3;
      const wide = 2 * (Math.max(track.edgeAt(s, 1), track.edgeAt(s, -1)) + 0.6);
      blocks.push(upright(c.setY(foot), frame.yaw, wide, top - foot, 3.4));
    }
  }

  // (finish lane) the abutments in the deck's mesh and the rail posts in the rails' (same materials): each piece of
  // viaduct is two draw calls fewer in every pass
  const baked = (geometry, matrices) => matrices.map((m) => geometry.clone().applyMatrix4(m));
  const block = footBox();
  const post = new THREE.BoxGeometry(0.05, 0.26, 0.05).translate(0, 0.13, 0);
  deckParts.push(...baked(block, blocks));
  railParts.push(...baked(post, railPosts));
  block.dispose();
  post.dispose();
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
  // (sea lane, round 3) the sea span (SEA_SPAN): its piers join the viaduct's, its deck is one more mesh
  const spanParts = [];
  {
    const at = (id, f, lat) => {
      let s0 = 0;
      for (const seg of track.layout?.segments ?? []) {
        const len = seg.r ? Math.abs(seg.r) * seg.deg * (Math.PI / 180) : seg.len;
        if (seg.id === id) return track.pointAt(s0 + len * f, lat, new THREE.Vector3());
        s0 += len;
      }
      return null;
    };
    const a = at(...SEA_SPAN.from);
    const b = at(...SEA_SPAN.to);
    const level = terrain.sea?.level ?? -1.8;
    if (a && b && !SEA_SPAN.off) {
      const dir = new THREE.Vector3().subVectors(b, a).setY(0);
      const len = dir.length();
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      const start = a.clone().addScaledVector(dir, -SEA_SPAN.beyond[0] * len);
      const total = len * (1 + SEA_SPAN.beyond[0] + SEA_SPAN.beyond[1]);
      const n = Math.max(1, Math.round(total / SEA_SPAN.span));
      const top = level + SEA_SPAN.deck;
      for (let k = 0; k <= n; k++) {
        const c = start.clone().addScaledVector(dir, (total * k) / n);
        const ground = terrain.heightAt(c.x, c.z);
        // only where it stands in the water (it may not cross the land)
        if (ground > level - 1) continue;
        const foot = ground - 1.5;
        if (k > 0 && k < n) {
          piers.push(upright(new THREE.Vector3(c.x, foot, c.z), yaw, SHAFT.across, top - SEA_SPAN.depth - CAPITAL.height - foot + 0.05, SHAFT.along));
          caps.push(upright(new THREE.Vector3(c.x, top - SEA_SPAN.depth - CAPITAL.height, c.z), yaw, CAPITAL.across, CAPITAL.height, CAPITAL.along));
        }
        if (k < n) {
          const mid = c.clone().addScaledVector(dir, total / n / 2).setY(top - SEA_SPAN.depth);
          spanParts.push(footBox().applyMatrix4(upright(mid, yaw, SEA_SPAN.width, SEA_SPAN.depth, total / n + 0.02)));
          // its parapets: two low walls along the deck's edges
          for (const side of [-1, 1]) {
            const e = mid.clone().addScaledVector(new THREE.Vector3(dir.z, 0, -dir.x), side * (SEA_SPAN.width / 2 - 0.2)).setY(top);
            spanParts.push(footBox().applyMatrix4(upright(e, yaw, 0.4, 1.0, total / n + 0.02)));
          }
        }
      }
    }
  }
  const pier = octagon(0.5 * SHAFT.taper, 0.5, true);
  const capital = octagon(0.5, (0.5 * SHAFT.across * SHAFT.taper) / CAPITAL.across, false);
  // (nearfield lane) concrete.js's finish: lifts, tie holes, the damp foot, streaks from the capital; round the shaft
  // by its angle (metres of its girth), up it by the instance's height
  const pierConcrete = concreteFinish(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x9a968d, roughness: 0.92 })), {
    key: 'pier',
    kind: 'pier',
    varyings: 'varying vec3 vPierLocal;',
    vertex: 'float pierH = length( instanceMatrix[1].xyz );\nvPierLocal = vec3( position.x * length( instanceMatrix[0].xyz ), position.z * length( instanceMatrix[2].xyz ), pierH );\nvConc = vec4( 0.25 * ( length( instanceMatrix[0].xyz ) + length( instanceMatrix[2].xyz ) ), position.y * pierH, ( 1.0 - position.y ) * pierH, 2.0 );',
    conc: 'vec4( atan( vPierLocal.x + 1.0e-5, vPierLocal.y ) * vConc.x, vConc.yzw )',
  });
  group.add(
    row(pier, pierConcrete, piers, { name: 'viaduct-piers' }),
    row(capital, pierConcrete, caps, { name: 'viaduct-pier-caps' }),
  );
  if (spanParts.length) {
    // (a plain material: the piers' finish reads the instance matrix, which a merged mesh has not)
    const deck = new THREE.Mesh(mergeGeometries(spanParts), atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.88 })));
    deck.name = 'sea-span';
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
  }

  return { group, stats: { piers: piers.length, posts: railPosts.length } };
}
