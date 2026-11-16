// PLACEHOLDER ROADSIDE. Cones for spruces where the
// Track says trees stand (on the terrain), guide posts and the street lamps'
// poles: until the forest and the roadside exist.
//
// It stands in for the terrain, the road, the forest and the roadside until
// those exist, so that the light can be judged on the real course: the
// pavement is the surface the physics drives on, and what stands beside it
// stands where the Track puts the solid edge. Nothing here is meant to
// survive; delete the file when the last of it has been replaced.

import * as THREE from 'three';

/** Metres of hillside drawn beyond the solid edge. */
const BEYOND = 14;
/** The Track's EDGE.TREES (the world never imports from game/). */
const EDGE_TREES = 4;

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {object} options.track the Track, or the game's flat stand-in for it
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @returns {{ group: THREE.Group, setLamps: (street: number) => void, dispose: () => void }}
 */
export function createPlaceholderGround({ caps, tier, track, rng, atmosphere, heightAt }) {
  const group = new THREE.Group();
  const real = typeof track.pointAt === 'function';
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const point = new THREE.Vector3();
  const sampleAt = (s) => Math.round(track.wrap(s) / track.ds) % track.count;
  const edgeAt = (s, side) => (real ? track.edgeAt(s, side) : track.halfWidth + 3);
  /** A point of the corridor's cross-section; on the flat stand-in, level with the centre line. */
  const at = (s, lat) => {
    if (real) return track.pointAt(s, lat, point);
    track.frameAt(s, frame);
    return point.copy(frame.pos).addScaledVector(frame.left, lat);
  };
  const inside = (s, ranges, margin) => ranges.some((r) => s > r.s0 - margin && s < r.s1 + margin);
  const material = (options) => atmosphere.patch(new THREE.MeshStandardMaterial(options));

  // ---- things that stand: spruces along the tree lines, blocks, guide posts, lamp poles
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const where = { index: -1, s: 0, lat: 0 };
  /** True where nothing may stand: on a bridge, in a tunnel, or inside another stretch's corridor. */
  const blocked = (s, x, z) => {
    if (inside(s, track.tunnels, 6) || inside(s, track.bridges, 2)) return true;
    track.locate(x, z, -1, where);
    return Math.abs(where.lat) < (real ? edgeAt(where.s, Math.sign(where.lat) || 1) : track.halfWidth + 3) - 0.01;
  };

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // stands on the ground
  const cone = new THREE.ConeGeometry(1, 1, 9).translate(0, 0.5, 0);

  const treeRng = rng.fork('trees');
  const trees = [];
  if (real) {
    for (const side of [1, -1]) {
      const kinds = side > 0 ? track.kindL : track.kindR;
      for (let s = treeRng.range(0, 4); s < track.length; s += treeRng.range(3.5, 7)) {
        if (kinds[sampleAt(s)] !== EDGE_TREES) continue;
        const row = treeRng.next();
        at(s, side * (edgeAt(s, side) + 0.8 + row * row * (BEYOND - 2)));
        if (blocked(s, point.x, point.z)) continue;
        const height = treeRng.range(13, 24);
        trees.push({ x: point.x, y: (heightAt ? heightAt(point.x, point.z) : point.y) - 0.3, z: point.z, radius: height * treeRng.range(0.15, 0.2), height, shade: treeRng.range(0.7, 1.15) });
      }
    }
  }
  const forest = new THREE.InstancedMesh(cone, material({ roughness: 1 }), trees.length);
  trees.forEach((tree, i) => {
    forest.setMatrixAt(i, matrix.compose(point.set(tree.x, tree.y, tree.z), quat.identity(), scale.set(tree.radius, tree.height, tree.radius)));
    forest.setColorAt(i, color.setRGB(0.035 * tree.shade, 0.07 * tree.shade, 0.04 * tree.shade));
  });
  forest.castShadow = forest.receiveShadow = true;

  const postSpacing = 25;
  const postList = [];
  for (let s = 0; s < track.length - postSpacing / 2; s += postSpacing) {
    if (inside(s, track.tunnels, 0) || inside(s, track.bridges, 0)) continue;
    postList.push([s, 1], [s, -1]);
  }
  const posts = new THREE.InstancedMesh(box, material({ color: 0xd8d8d2, roughness: 0.6 }), postList.length);
  postList.forEach(([s, side], i) => {
    track.frameAt(s, frame);
    quat.setFromAxisAngle(up, Math.atan2(frame.tan.x, frame.tan.z));
    posts.setMatrixAt(i, matrix.compose(at(s, side * (track.halfWidth + 0.5)), quat, scale.set(0.12, 1.0, 0.06)));
  });
  posts.castShadow = posts.receiveShadow = true;


  group.add(forest, posts);

  return {
    group,
    // the street lamps are structures.js's now
    setLamps() {},
    dispose() {
      group.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        for (const key of ['map', 'normalMap']) if (object.material[key]) object.material[key].dispose();
        object.material.dispose();
      });
    },
  };
}
