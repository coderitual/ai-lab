// What stands on the meadow of a tunnel's approach (approach.js; the
// reference is photograph R1, docs/design.md "The approach to the tunnel"):
// a wire fence on wooden posts along both sides, black and white marker posts
// behind the rail and on the low wall, red and white ones on the other wall, a
// sign post with a warning triangle over a blue square (pictograms of our
// own: no lettering, no numbers), and a chalet and a hay barn on the hillside
// over the portal.
//
// One mesh of vertex colours and one matte material for all of it. Everything
// stands at or beyond the Track's solid edge (tools/unit/trackside.test.mjs
// walks its vertices); none of it is solid: the cars never reach it.

import * as THREE from 'three';
import { APPROACH, approachesOf } from './approach.js';
import { PAINT, Parts, UNIT_BOX, place } from './parts.js';

/** The fence: metres between posts per tier, a post's height, its wires' heights, how far beyond the solid edge it runs. */
const FENCE = { post: { low: 7, medium: 3.5, high: 3.5 }, height: 1.5, wires: { low: [0.7, 1.35], medium: [0.4, 0.75, 1.1, 1.4], high: [0.4, 0.75, 1.1, 1.4] }, beyond: 2.4 };
/** Marker posts: every `every` m; behind a rail `rail` m beyond the solid edge and `tall` m high; on a wall's top `wall` m beyond it and `low` m high. */
const MARKER = { every: 24, rail: 0.75, tall: 1.05, wall: 0.45, low: 0.6 };
/** The sign: how far before the face it stands (m), its legs' distances beyond the solid edge. */
const SIGN = { before: 82, legs: [0.6, 1.5] };
/** The chalet and the hay barn: metres into the hill from the face, metres towards the hill from the centre line, size [wide, deep, wall height]. */
const HUTS = [
  { u: 26, r: 30, size: [7.2, 5, 2.7], windows: true },
  { u: 112, r: 84, size: [4.4, 4, 2.3], windows: false },
];

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js: heightAt, heightOnTrack, cliffAt
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {import('../../engine/caps.js').Tier} [options.tier]
 * @param {import('../../engine/rng.js').Rng} options.rng
 */
export function createMeadow({ track, terrain, atmosphere, tier = 'medium', rng }) {
  const group = new THREE.Group();
  group.name = 'meadow';
  const low = tier === 'low';
  const parts = new Parts();
  const material = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  const point = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const size = new THREE.Vector3();
  const prof = { y: 0 };
  const lean = rng.fork('lean');
  /** A point `d` m beyond the solid edge on `side` at s, on the ground (or on the low wall's top: `onWall`). */
  const stand = (s, side, d, onWall = false) => {
    const sw = track.wrap(s);
    const edge = track.edgeAt(sw, side);
    track.pointAt(sw, side * (edge + d), point);
    const y = onWall ? track.profile(sw, side * edge, prof).y + Math.max(0.3, terrain.cliffAt(sw, side).height) + 0.12 : terrain.heightOnTrack(sw, side * (edge + d));
    return new THREE.Vector3(point.x, y, point.z);
  };
  /** An upright box standing on `foot`, turned `yaw` about the vertical and leaning a little. */
  const post = (foot, w, h, deep, yaw, color, tilt = 0) => {
    q.setFromEuler(e.set(tilt * lean.range(-1, 1), yaw, tilt * lean.range(-1, 1), 'YXZ'));
    parts.add(UNIT_BOX, new THREE.Matrix4().compose(point.set(foot.x, foot.y + h / 2 - 0.08, foot.z), q, size.set(w, h, deep)), color);
  };

  for (const A of approachesOf(track)) {
    const yawAt = (s) => place(track, track.wrap(s)).yaw;
    const kindsOf = (side) => (side > 0 ? track.kindL : track.kindR);
    const walled = (s, side) => kindsOf(side)[Math.round(track.wrap(s) / track.ds) % track.count] === 1;
    const s1 = A.s0 - APPROACH.hood.depth - 1.5;

    // ---- the fence: on the hill's side from where the meadow opens, on the other along the low wall
    for (const side of [1, -1]) {
      const from = A.s0 - (side === A.up ? APPROACH.open : APPROACH.before - 14);
      const n = Math.max(1, Math.round((s1 - from) / FENCE.post[tier]));
      let last = null;
      for (let k = 0; k <= n; k++) {
        const s = from + ((s1 - from) * k) / n;
        const foot = stand(s, side, FENCE.beyond);
        post(foot, 0.13, FENCE.height + 0.08, 0.13, yawAt(s), PAINT.wood, 0.05);
        if (last) {
          for (const h of FENCE.wires[tier]) {
            const t = low ? 0.035 : 0.02;
            parts.poly([last.clone().setY(last.y + h - t), foot.clone().setY(foot.y + h - t), foot.clone().setY(foot.y + h + t), last.clone().setY(last.y + h + t)], PAINT.wire);
          }
        }
        last = foot;
      }
    }

    // ---- marker posts: black and white on the hill's side, red and white on the other wall
    {
      const from = A.s0 - APPROACH.open;
      for (let s = from; s < s1 - 4; s += MARKER.every) {
        const onWall = walled(s, A.up);
        const h = onWall ? MARKER.low : MARKER.tall;
        const foot = stand(s, A.up, onWall ? MARKER.wall : MARKER.rail, onWall);
        const yaw = yawAt(s);
        post(foot, 0.13, h, 0.06, yaw, PAINT.post);
        post(foot.clone().setY(foot.y + h * 0.62), 0.135, h * 0.24, 0.065, yaw, PAINT.black);
      }
      for (let s = A.s0 - APPROACH.before + 22; s < s1 - 2; s += MARKER.every / 2) {
        if (!walled(s, -A.up)) continue;
        const foot = stand(s, -A.up, MARKER.wall, true);
        const yaw = yawAt(s);
        for (let k = 0; k < 4; k++) post(foot.clone().setY(foot.y + k * 0.2), 0.16, 0.2 + 0.08, 0.05, yaw, k % 2 ? PAINT.post : PAINT.red);
      }
    }

    // ---- the sign: two legs, a blue square with a white field and an arch, a warning triangle with an arch, a lamp box
    {
      const s = track.wrap(A.s0 - SIGN.before);
      const { P, M } = place(track, s, -1);
      const edge = track.edgeAt(s, A.up);
      // (place's frame faces back along the road: its lat is to the right of the Track's)
      const mid = -A.up * (edge + (SIGN.legs[0] + SIGN.legs[1]) / 2);
      const base = Math.max(...SIGN.legs.map((d) => terrain.heightOnTrack(s, A.up * (edge + d)))) - P(0, 0).y;
      for (const d of SIGN.legs) {
        const foot = terrain.heightOnTrack(s, A.up * (edge + d)) - P(0, 0).y;
        parts.add(UNIT_BOX, M(-A.up * (edge + d), (foot + base + 3.3) / 2 - 0.1, 0, [0.07, base + 3.3 - foot + 0.2, 0.07]), PAINT.galvanised);
      }
      const front = 0.06;
      const sq = base + 1.95;
      parts.add(UNIT_BOX, M(mid, sq, front, [1.0, 1.0, 0.04]), PAINT.blue);
      parts.add(UNIT_BOX, M(mid, sq + 0.08, front + 0.025, [0.62, 0.56, 0.02]), PAINT.white);
      arch(parts, P, mid, sq - 0.12, front + 0.045, 0.21, PAINT.black, PAINT.white);
      // the triangle: red, a white field inside it, the arch in black
      const tri = base + 2.55;
      const half = 0.6;
      const tall = 1.04;
      parts.poly([P(mid - half, tri, front), P(mid + half, tri, front), P(mid, tri + tall, front)], PAINT.red);
      parts.poly([P(mid - half + 0.2, tri + 0.115, front + 0.015), P(mid + half - 0.2, tri + 0.115, front + 0.015), P(mid, tri + tall - 0.23, front + 0.015)], PAINT.white);
      arch(parts, P, mid, tri + 0.2, front + 0.03, 0.15, PAINT.black, PAINT.white);
      // the lamp box on top
      parts.add(UNIT_BOX, M(mid, base + 3.95, 0, [0.4, 0.5, 0.2]), PAINT.signal);
      parts.add(UNIT_BOX, M(mid, base + 3.95, 0.11, [0.46, 0.56, 0.02]), PAINT.white);
      parts.add(UNIT_BOX, M(mid, base + 3.95, 0.125, [0.36, 0.46, 0.02]), PAINT.signal);
    }

    // ---- the chalet and the hay barn on the hillside: stone plinth, dark timber, a shingle roof with deep eaves
    for (const hut of HUTS) {
      const s = track.wrap(A.s0 + hut.u);
      const { P, M } = place(track, s, -1);
      const lat = -A.up * hut.r;
      const [w, deep, wall] = hut.size;
      const ground = (along) => {
        const p = P(lat, 0, along);
        return terrain.heightAt(p.x, p.z) - p.y;
      };
      // the floor: a step over the ground at the front (the side that looks down the valley), the back dug in
      const floor = Math.max(ground(deep / 2) + 0.9, ground(0) + 0.2);
      const foot = Math.min(ground(deep / 2), ground(-deep / 2)) - 0.6;
      parts.add(UNIT_BOX, M(lat, (floor + foot) / 2, 0, [w + 0.3, floor - foot, deep + 0.3]), PAINT.stone);
      parts.add(UNIT_BOX, M(lat, floor + wall / 2, 0, [w, wall, deep]), PAINT.timber);
      // the gables up to the ridge (the ridge runs across the slope)
      const pitch = 0.52;
      const rise = (deep / 2) * Math.tan(pitch);
      for (const side of [1, -1]) {
        const x = lat + side * (w / 2);
        parts.poly(side > 0 ? [P(x, floor + wall, deep / 2), P(x, floor + wall, -deep / 2), P(x, floor + wall + rise, 0)] : [P(x, floor + wall, -deep / 2), P(x, floor + wall, deep / 2), P(x, floor + wall + rise, 0)], PAINT.timber);
      }
      // the roof: two slabs with eaves
      const slab = (deep / 2 + 0.7) / Math.cos(pitch);
      for (const side of [1, -1]) {
        const along = side * (deep / 2 + 0.7) * 0.5;
        const h = floor + wall + rise - (deep / 2 + 0.7) * 0.5 * Math.tan(pitch) + 0.1;
        parts.add(UNIT_BOX, M(lat, h, along, [w + 1.1, 0.16, slab], [side * pitch, 0, 0]), PAINT.shingle);
      }
      if (hut.windows && !low) {
        // a door and two shuttered windows on the front
        parts.add(UNIT_BOX, M(lat - w * 0.22, floor + 1.0, deep / 2 + 0.03, [0.95, 2.0, 0.06]), PAINT.wood);
        for (const x of [w * 0.08, w * 0.31]) {
          parts.add(UNIT_BOX, M(lat + x, floor + 1.55, deep / 2 + 0.03, [0.8, 0.8, 0.06]), PAINT.signal);
          for (const sh of [-0.58, 0.58]) parts.add(UNIT_BOX, M(lat + x + sh, floor + 1.55, deep / 2 + 0.04, [0.34, 0.86, 0.05]), PAINT.shutter);
        }
      }
    }
  }

  let geometry = null;
  if (!parts.empty) {
    geometry = parts.build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'meadow-furniture';
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return {
    group,
    stats: { triangles: parts.index.length / 3 },
    dispose() {
      geometry?.dispose();
      material.dispose();
    },
  };
}

/**
 * A tunnel's mouth as a pictogram: an arch `r` m in radius standing on the line h = `foot`, in `ink`, with a smaller
 * arch of `paper` inside it (the opening).
 */
function arch(parts, P, mid, foot, front, r, ink, paper) {
  const fan = (radius, legs, out, color) => {
    const pts = [P(mid - radius, foot, out), P(mid + radius, foot, out), P(mid + radius, foot + legs, out)];
    for (let k = 1; k < 6; k++) pts.push(P(mid + radius * Math.cos((Math.PI * k) / 6), foot + legs + radius * Math.sin((Math.PI * k) / 6), out));
    pts.push(P(mid - radius, foot + legs, out));
    parts.poly(pts, color);
  };
  fan(r, r * 0.5, front, ink);
  fan(r * 0.58, r * 0.4, front + 0.012, paper);
}
