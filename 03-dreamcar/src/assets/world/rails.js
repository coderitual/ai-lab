// Guard rails: wherever the Track's solid edge is a RAIL, a circuit's steel
// barrier: two galvanised W-beams stacked on posts, its face standing exactly at the edge distance (that is where the
// physics stops a car), with a reflector every few posts.
//
// The beam is one profile swept along each run, closer in bends than on the
// straight; its texture coordinates are metres of road, so the splices and
// the bolts land on the posts. A run that ends against a wall or a parapet
// meets it; a run that ends in the open is ramped down into the ground over
// its last metres, turned a little away from the road, as real terminals are.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EDGE, along, levelFrame, row, runsOf, stripGeometry, upright } from './furniture.js';
import { retroReflective } from './retro.js';
import { extend } from './shading.js';

/** The W-beam seen end on, the road to the left: [out from the edge, up from the ground at the edge] (m). */
const BEAM = [
  [0.075, 0.44],
  [0.03, 0.455],
  [0, 0.49],
  [0, 0.53],
  [0.03, 0.565],
  [0.055, 0.6],
  [0.03, 0.635],
  [0, 0.67],
  [0, 0.71],
  [0.03, 0.745],
  [0.075, 0.76],
  // the second beam, stacked on the first (a circuit's barrier stands about 1.1 m)
  [0.075, 0.78],
  [0.03, 0.795],
  [0, 0.83],
  [0, 0.87],
  [0.03, 0.905],
  [0.055, 0.94],
  [0.03, 0.975],
  [0, 1.01],
  [0, 1.05],
  [0.03, 1.085],
  [0.075, 1.1],
];
/** The low tier's beam: each wave by its crests and troughs only. */
const BEAM_LOW = [
  [0.075, 0.44],
  [0, 0.51],
  [0.055, 0.6],
  [0, 0.69],
  [0.075, 0.76],
  [0.075, 0.78],
  [0, 0.85],
  [0.055, 0.94],
  [0, 1.03],
  [0.075, 1.1],
];
/** Metres between the beam's cross-sections on a straight and in a bend, by tier. */
const SECTION = { low: [8, 3], medium: [4, 2], high: [4, 2] };
/** Posts: spacing (m) by tier, and where they stand behind the beam. */
const POST_SPACING = { low: 4, medium: 2, high: 2 };
const POST_OUT = 0.16;
/** A reflector on every this many posts. */
const REFLECTOR_EVERY = 1e9; // (a circuit's barrier carries none)
/** The terminals: metres over which a free end goes down into the ground, and how far it turns away. */
const RAMP = 7;
const FLARE = 0.5;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createRails({ track, tier, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'rails';
  const steel = railSteel(
    atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xa9afb3, metalness: 0.85, roughness: 0.36, side: THREE.DoubleSide })),
  );
  const postSteel = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x8f959a, metalness: 0.8, roughness: 0.5 }));
  const reflectorMaterial = retroReflective(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })), 1);

  const frame = {};
  const base = new THREE.Vector3();
  const beams = [];
  const posts = [];
  const reflectors = [];
  const reflectorColors = [];
  const n = track.count;
  let metres = 0;

  for (const side of [1, -1]) {
    const kinds = side > 0 ? track.kindL : track.kindR;
    for (const run of runsOf(track, (i) => kinds[i] === EDGE.RAIL)) {
      const before = kinds[(run.i0 - 1 + n) % n];
      const after = kinds[(run.i1 + 1) % n];
      const freeStart = before !== EDGE.WALL && before !== EDGE.PARAPET;
      const freeEnd = after !== EDGE.WALL && after !== EDGE.PARAPET;
      // a run that meets a structure reaches a little into it, so no gap shows
      const s0 = run.s0 - (freeStart ? 0 : 0.6);
      const s1 = run.s1 + track.ds + (freeEnd ? 0 : 0.6);
      metres += s1 - s0;
      /** How far a cross-section at s is into a terminal, 0 (none) .. 1 (the very end). */
      const terminal = (s) => {
        const a = freeStart ? Math.max(0, 1 - (s - s0) / RAMP) : 0;
        const b = freeEnd ? Math.max(0, 1 - (s1 - s) / RAMP) : 0;
        return Math.max(a, b);
      };
      const place = (s, out, up, into) => {
        levelFrame(track, s, frame);
        const edge = track.edgeAt(s, side);
        track.pointAt(s, side * edge, base);
        const t = into * into;
        const o = out + FLARE * t;
        return [base.x + frame.flat.x * side * o, base.y + up - 0.78 * t, base.z + frame.flat.z * side * o];
      };

      // the beam: closer sections where the road bends hard
      const rows = [];
      const sections = [];
      const [far, near] = SECTION[tier] ?? SECTION.medium;
      along(track, s0, s1, (s) => (Math.abs(track.frameAt(s, frame).curvature) > 1 / 120 ? near : far), (s) => sections.push(s), { ends: true });
      if (sections.length < 2) continue;
      let previous = s0;
      for (const sw of sections) {
        let s = sw;
        while (s < previous - track.length / 2) s += track.length; // unwrapped, for the terminals and the texture
        previous = s;
        const into = terminal(s);
        rows.push((tier === 'low' ? BEAM_LOW : BEAM).map(([out, up]) => [...place(s, out, up, into), s, up]));
      }
      beams.push(stripGeometry(rows));

      // posts behind it, and a reflector on every few
      const spacing = POST_SPACING[tier] ?? 2;
      along(
        track,
        s0,
        s1,
        spacing,
        (s, k) => {
          let su = s;
          while (su < s0 - 1) su += track.length;
          const into = terminal(su);
          if (into > 0.6) return;
          const [x, y, z] = place(su, POST_OUT, 0, into);
          levelFrame(track, su, frame);
          posts.push(upright(new THREE.Vector3(x, y - 0.45, z), frame.yaw));
          if (k % REFLECTOR_EVERY === 3 && into === 0) {
            const [rx, ry, rz] = place(su, 0.04, 0.8, 0);
            reflectors.push(upright(new THREE.Vector3(rx, ry, rz), frame.yaw));
            // white on the left of the way the road is driven, red on the right
            reflectorColors.push(side > 0 ? [1, 1, 1] : [1, 0.06, 0.02]);
          }
        },
        { ends: true },
      );
    }
  }

  const beamGeometry = mergeGeometries(beams);
  for (const g of beams) g.dispose();
  const beam = new THREE.Mesh(beamGeometry, steel);
  beam.name = 'rail-beams';
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);

  // a C-section post, a spacer block in front of it at the beam's height
  const postGeometry = tier === 'low' ? new THREE.BoxGeometry(0.11, 1.55, 0.14).translate(0, 0.775, 0.03) : mergeGeometries([
    new THREE.BoxGeometry(0.11, 1.55, 0.06).translate(0, 0.775, 0),
    new THREE.BoxGeometry(0.1, 0.3, 0.1).translate(0, 1.05, 0),
    new THREE.BoxGeometry(0.1, 0.3, 0.1).translate(0, 1.39, 0),
  ]);
  group.add(row(postGeometry, postSteel, posts, { name: 'rail-posts' }));

  const reflectorMesh = row(new THREE.BoxGeometry(0.05, 0.1, 0.02).translate(0, 0.05, 0), reflectorMaterial, reflectors, {
    shadow: false,
    name: 'rail-reflectors',
  });
  reflectorColors.forEach((c, i) => reflectorMesh.setColorAt(i, new THREE.Color(...c)));
  group.add(reflectorMesh);

  return {
    group,
    stats: { metres: Math.round(metres), posts: posts.length, reflectors: reflectors.length },
  };
}

/**
 * Galvanised steel: dull bands where the splices overlap every 4 m, a row of bolt heads on each post and on each
 * splice (they read at speed as a rhythm), streaks of road dirt thrown up on the lower beam, grime at the bottom.
 */
function railSteel(material) {
  return extend(material, 'rail-steel', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRail;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRail = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRail;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float splice = smoothstep(0.2, 0.14, abs(fract(vRail.x / 4.0 + 0.5) - 0.5) * 4.0);
  float aaX = fwidth(vRail.x) + 1.0e-3;
  // bolt heads on the beams' flat middles: over each post (every 2 m), and a group at each splice
  float boltRow = smoothstep(0.03, 0.012, min(abs(vRail.y - 0.51), abs(vRail.y - 0.85)));
  float atPost = 1.0 - smoothstep(0.03 - aaX, 0.03 + aaX, abs(fract(vRail.x / 2.0 + 0.5) - 0.5) * 2.0);
  float atSplice = 1.0 - smoothstep(0.06 - aaX, 0.06 + aaX, abs(abs(fract(vRail.x / 4.0 + 0.5) - 0.5) * 4.0 - 0.12));
  float bolt = boltRow * max(atPost, atSplice) * (1.0 - smoothstep(0.05, 0.2, aaX));
  // dirt sprayed up from the road on the lower beam, in streaks along it
  float spray = smoothstep(0.75, 0.45, vRail.y) * (0.55 + 0.45 * sin(vRail.x * 0.9 + 2.0 * sin(vRail.x * 0.23)));
  diffuseColor.rgb *= mix(1.0, 0.78, splice) * mix(0.82, 1.0, smoothstep(0.44, 0.7, vRail.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.29, 0.25), 0.35 * spray);
  diffuseColor.rgb *= 1.0 - 0.6 * bolt;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.62, smoothstep( 0.7, 0.44, vRail.y ) );',
      );
  });
}
