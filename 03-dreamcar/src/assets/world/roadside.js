// (nearfield lane, round 2) Shared roadside pieces for whoever lays out a stretch
// (the coast lane places them; references W1 and W2, described in design.md):
//
//  - `kerbRailing`: a low weathered concrete kerb carrying a steel railing on
//    posts (W1's causeway): the kerb 0.32 m high and 0.34 m wide with
//    chamfered arrises, in concrete.js's finish; square posts every 2 m, a
//    round top rail at 1.05 m and a middle rail, galvanised and dulled.
//  - `chainFence`: a tall rusty chain-link fence on posts (W2's coast bend,
//    behind a guard rail): posts every 3 m, 2.4 m high with a top rail, base
//    plates, the mesh a diamond weave drawn in the shader on one quad per
//    bay, cut out; it reads as wire at 10 to 30 m and further off becomes a
//    screen door of its mean coverage (no crawling pattern); rust in streaks down
//    the posts and the mesh.
//
// Each takes runs `{ s0, s1, side, out }` (s along the Track, side +1 left / -1
// right, out metres beyond the solid edge where the piece's road face
// stands: never inside the corridor) and returns `{ group, dispose }`: two
// draw calls for the railing (concrete, steel), two for the fence (steel,
// mesh), whatever the runs. Nothing is placed here.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { levelFrame, stripGeometry } from './furniture.js';
import { concreteFinish } from './concrete.js';
import { extend } from './shading.js';

/** W1's kerb and railing (m). */
export const KERB_RAILING = { kerb: { height: 0.32, width: 0.34, chamfer: 0.04 }, post: { every: 2, size: 0.06 }, rails: [1.05, 0.62], rail: 0.03, step: 2 };
/** W2's fence (m). */
export const CHAIN_FENCE = { height: 2.4, every: 3, post: 0.07, mesh: 0.06, wire: 0.004, rust: [0.26, 0.11, 0.05] };

const box = new THREE.BoxGeometry(1, 1, 1);

/** A point `out` m beyond the solid edge at s on a side, `up` m over the ground at the edge. */
function at(track, s, side, out, up, frame, p) {
  levelFrame(track, s, frame);
  const edge = track.edgeAt(s, side);
  track.pointAt(s, side * (edge + out), p);
  return [p.x, p.y + up, p.z];
}

/** An upright box `w` across, `h` high, `d` along, its foot at (x, y, z), turned to the road's heading. */
function uprightBox(x, y, z, yaw, w, h, d) {
  const g = box.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, h, d)));
  g.deleteAttribute('uv');
  return g;
}

/** A horizontal tube (four sides) along the run at `up`, `out`. */
function railTube(track, run, out, up, r, step) {
  const frame = {};
  const p = new THREE.Vector3();
  const rows = [];
  const n = Math.max(1, Math.ceil((run.s1 - run.s0) / step));
  for (let k = 0; k <= n; k++) {
    const s = track.wrap(run.s0 + ((run.s1 - run.s0) * k) / n);
    const ring = [];
    for (let a = 0; a <= 4; a++) {
      const th = (a / 4) * Math.PI * 2 + Math.PI / 4;
      ring.push(at(track, s, run.side, out + Math.cos(th) * r, up + Math.sin(th) * r, frame, p));
    }
    rows.push(ring);
  }
  const g = stripGeometry(rows);
  g.deleteAttribute('uv');
  return g;
}

/**
 * W1's low concrete kerb with a steel railing on posts.
 * @param {{ track: object, runs: { s0: number, s1: number, side: number, out?: number }[], atmosphere: any }} options
 */
export function kerbRailing({ track, runs, atmosphere }) {
  const K = KERB_RAILING;
  const group = new THREE.Group();
  group.name = 'kerb-railing';
  const kerbs = [];
  const steel = [];
  const frame = {};
  const p = new THREE.Vector3();
  const { height: h, width: w, chamfer: c } = K.kerb;
  // the kerb end on, from its buried foot on the road side over its chamfered top to its back: [out, up]
  const section = [
    [0, -0.2],
    [0, h - c],
    [0, h - c],
    [c, h],
    [c, h],
    [w - c, h],
    [w - c, h],
    [w, h - c],
    [w, h - c],
    [w, -0.2],
  ];
  for (const run of runs) {
    const out = run.out ?? 0.05;
    const n = Math.max(1, Math.ceil((run.s1 - run.s0) / K.step));
    const rows = [];
    const conc = [];
    for (let k = 0; k <= n; k++) {
      const sa = run.s0 + ((run.s1 - run.s0) * k) / n;
      const s = track.wrap(sa);
      const prof = run.side > 0 ? section.slice().reverse() : section;
      rows.push(prof.map(([o, up]) => [...at(track, s, run.side, out + o, up, frame, p), sa, up]));
      conc.push(prof.map(([, up]) => [sa, up + 0.2, h - up, 2]));
    }
    const g = stripGeometry(rows, { attributes: { aConc: { size: 4, rows: conc } } });
    g.deleteAttribute('uv');
    kerbs.push(g);
    // posts on the kerb's middle, two rails along them
    const mid = out + w / 2;
    const posts = Math.max(1, Math.round((run.s1 - run.s0) / K.post.every));
    for (let k = 0; k <= posts; k++) {
      const s = track.wrap(run.s0 + ((run.s1 - run.s0) * k) / posts);
      const [x, y, z] = at(track, s, run.side, mid, h, frame, p);
      steel.push(uprightBox(x, y, z, frame.yaw, K.post.size, K.rails[0] - h + 0.02, K.post.size));
      // a base plate
      steel.push(uprightBox(x, y, z, frame.yaw, 0.16, 0.012, 0.16));
    }
    for (const up of K.rails) steel.push(railTube(track, run, mid, up, up === K.rails[0] ? K.rail : K.rail * 0.7, K.step));
  }
  if (!kerbs.length) return { group, dispose() {} };
  const concrete = concreteFinish(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.9 })), { key: 'kerb-railing', kind: 'parapet' });
  const metal = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x8e9396, metalness: 0.7, roughness: 0.45 }));
  const kerbMesh = new THREE.Mesh(mergeGeometries(kerbs), concrete);
  const steelMesh = new THREE.Mesh(mergeGeometries(steel), metal);
  for (const g of [...kerbs, ...steel]) g.dispose();
  for (const m of [kerbMesh, steelMesh]) {
    m.castShadow = m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  kerbMesh.name = 'kerb-railing-kerb';
  steelMesh.name = 'kerb-railing-steel';
  return {
    group,
    dispose() {
      kerbMesh.geometry.dispose();
      steelMesh.geometry.dispose();
      concrete.dispose();
      metal.dispose();
    },
  };
}

/**
 * W2's tall rusty chain-link fence on posts (to stand behind a guard rail).
 * @param {{ track: object, runs: { s0: number, s1: number, side: number, out?: number }[], atmosphere: any }} options
 */
export function chainFence({ track, runs, atmosphere }) {
  const F = CHAIN_FENCE;
  const group = new THREE.Group();
  group.name = 'chain-fence';
  const posts = [];
  const bays = [];
  const frame = {};
  const p = new THREE.Vector3();
  for (const run of runs) {
    const out = run.out ?? 1.2;
    const n = Math.max(1, Math.round((run.s1 - run.s0) / F.every));
    let last = null;
    for (let k = 0; k <= n; k++) {
      const sa = run.s0 + ((run.s1 - run.s0) * k) / n;
      const s = track.wrap(sa);
      const [x, y, z] = at(track, s, run.side, out, 0, frame, p);
      posts.push(uprightBox(x, y - 0.3, z, frame.yaw, F.post, F.height + 0.3, F.post));
      posts.push(uprightBox(x, y, z, frame.yaw, 0.2, 0.015, 0.2));
      const here = { x, y, z, sa };
      if (last) {
        // the bay: one quad from post to post, (along, up) in its uv for the weave
        const g = new THREE.BufferGeometry();
        const ys = [0.05, F.height - 0.05];
        const pos = [last.x, last.y + ys[0], last.z, x, y + ys[0], z, x, y + ys[1], z, last.x, last.y + ys[1], last.z];
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([last.sa, ys[0], sa, ys[0], sa, ys[1], last.sa, ys[1]], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        bays.push(g);
      }
      last = here;
    }
    // a top rail
    posts.push(railTube(track, run, out, F.height - 0.02, 0.022, 3));
  }
  if (!posts.length) return { group, dispose() {} };
  const steel = rusty(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.75 })), false);
  const mesh = rusty(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.7, side: THREE.DoubleSide })), true);
  const postMesh = new THREE.Mesh(mergeGeometries(posts), steel);
  const bayMesh = new THREE.Mesh(mergeGeometries(bays), mesh);
  for (const g of [...posts, ...bays]) g.dispose();
  postMesh.castShadow = postMesh.receiveShadow = true;
  bayMesh.receiveShadow = true;
  postMesh.name = 'chain-fence-posts';
  bayMesh.name = 'chain-fence-mesh';
  for (const m of [postMesh, bayMesh]) {
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  return {
    group,
    dispose() {
      postMesh.geometry.dispose();
      bayMesh.geometry.dispose();
      steel.dispose();
      mesh.dispose();
    },
  };
}

/** Rust: patches and streaks running down; on the mesh, the diamond weave as coverage, its average far off. */
function rusty(material, weave) {
  const F = CHAIN_FENCE;
  const f = (v) => v.toFixed(4);
  return extend(material, weave ? 'chain-weave' : 'chain-rust', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRustWorld;\nvarying vec2 vRustUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRustWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvRustUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRustWorld;
varying vec2 vRustUv;
float rustHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float rustNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 u = fract( p );
  u = u * u * ( 3.0 - 2.0 * u );
  return mix( mix( rustHash( i ), rustHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( rustHash( i + vec2( 0.0, 1.0 ) ), rustHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vRustWorld;
  float a = p.x + p.z;
  // galvanised grey gone to rust: orange-brown patches, dark streaks running down
  float patchy = smoothstep( 0.3, 0.7, rustNoise( vec2( a * 1.7, p.y * 2.3 ) ) );
  float streak = smoothstep( 0.55, 0.8, rustNoise( vec2( a * 9.0, p.y * 0.4 ) ) );
  vec3 rust = vec3( ${F.rust.map(f).join(', ')} ) * ( 0.75 + 0.5 * rustNoise( vec2( a * 6.0, p.y * 6.0 ) ) );
  vec3 col = mix( vec3( 0.36, 0.35, 0.33 ), rust, 0.55 + 0.4 * patchy );
  col *= 1.0 - 0.3 * streak;
  diffuseColor.rgb *= col;
${
  weave
    ? `  // the weave: wires on the diagonals, MESH apart; where a wire is under a pixel or two, its share of the bay
  vec2 q = vRustUv / ${f(F.mesh)};
  vec2 d = vec2( q.x + q.y, q.x - q.y ) * 0.70710678;
  vec2 fw = fwidth( d ) + 1.0e-4;
  vec2 w = abs( fract( d ) - 0.5 ) * 2.0;
  float wire = ${f(F.wire / F.mesh)} * 4.0;
  vec2 hit = 1.0 - smoothstep( 1.0 - wire - fw, 1.0 - wire + fw, 1.0 - w );
  float cover = max( hit.x, hit.y );
  // far off, the weave's mean coverage instead of a pattern that would crawl
  float far = smoothstep( 0.25, 0.6, max( fw.x, fw.y ) );
  // (a cut, not blending: near, the wire itself; far, a screen door of the mean coverage, which multisampling smooths)
  float keep = mix( step( 0.5, cover ), step( rustHash( gl_FragCoord.xy ), 0.22 ), far );
  if ( keep < 0.5 ) discard;`
    : ''
}
}`,
      );
  });
}
