// PLACEHOLDER GROUND. The road's pavement, a strip of verge and hillside
// either side of it cut from the Track's own cross-section, a plain at the
// level of the lake, cones for spruces where the Track says trees stand,
// blocks, guide posts and the street lamps' poles.
//
// It stands in for the terrain, the road, the forest and the roadside until
// those exist, so that the light can be judged on the real course: the
// pavement is the surface the physics drives on, and what stands beside it
// stands where the Track puts the solid edge. Nothing here is meant to
// survive; delete the file when the last of it has been replaced.

import * as THREE from 'three';
import { fieldTexture, gradientField, normalTexture, valueField, worleyField } from '../../engine/noise.js';

/** How many blocks stand about, per tier. */
const BLOCKS = { low: 140, medium: 220, high: 300 };
/** What a lit street lamp's head sends out (scene units): a pale shape by day, far beyond white at night. */
const LAMP_RADIANCE = 40;
const LAMP_COLOR = [1.0, 0.74, 0.46];
/** Length of road one repeat of the markings texture covers (a 4 m dash and an 8 m gap). */
const MARKING_PERIOD = 12;
/** Metres of hillside drawn beyond the solid edge. */
const BEYOND = 14;
/** The Track's EDGE.TREES and SURFACE.GRAVEL (the world never imports from game/). */
const EDGE_TREES = 4;
const SURFACE_GRAVEL = 3;

/** sRGB-encodes a linear value: albedo textures are stored the way the eye spaces them. */
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** The road's colour: mottled asphalt, a line along each edge and a dashed one down the middle. */
function createRoadTextures(caps, halfWidth) {
  const size = 256;
  const mottle = valueField(size, { seed: 11, cells: 16, octaves: 3 });
  const albedo = new Float32Array(size * size);
  const width = halfWidth * 2;
  for (let y = 0; y < size; y++) {
    const along = (y / size) * MARKING_PERIOD;
    for (let x = 0; x < size; x++) {
      const across = (x / size) * width;
      const edgeLine = Math.abs(across - 0.45) < 0.075 || Math.abs(across - (width - 0.45)) < 0.075;
      const centreDash = Math.abs(across - halfWidth) < 0.06 && along < 4;
      albedo[y * size + x] = toSrgb(edgeLine || centreDash ? 0.55 : 0.07 + 0.06 * mottle[y * size + x]);
    }
  }
  const map = fieldTexture(size, [albedo, albedo, albedo], { anisotropy: caps.maxAnisotropy });
  map.colorSpace = THREE.SRGBColorSpace;

  // stones in a binder: the grains of a cellular noise over a slow waviness
  const grains = worleyField(size, { seed: 5, cells: 40 });
  const waves = gradientField(size, { seed: 9, cells: 4, octaves: 3 });
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = 0.75 * (1 - grains[i]) + 0.25 * waves[i];
  const normalMap = normalTexture(size, height, { relief: 0.012, anisotropy: caps.maxAnisotropy });
  normalMap.repeat.set(width / 1.2, MARKING_PERIOD / 1.2); // one repeat is 1.2 m of road
  return { map, normalMap };
}

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {object} options.track the Track, or the game's flat stand-in for it
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @returns {{ group: THREE.Group, road: THREE.MeshStandardMaterial, setLamps: (street: number) => void, dispose: () => void }}
 */
export function createPlaceholderGround({ caps, tier, track, rng, atmosphere }) {
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

  // ---- the pavement: a ribbon of the Track's own surface, banking and all
  const roadMaterial = material({ ...createRoadTextures(caps, track.halfWidth), normalScale: new THREE.Vector2(1, 1) });
  {
    const rows = Math.ceil(track.length / 2);
    const positions = new Float32Array((rows + 1) * 2 * 3);
    const normals = new Float32Array((rows + 1) * 2 * 3);
    const uvs = new Float32Array((rows + 1) * 2 * 2);
    const index = [];
    for (let i = 0; i <= rows; i++) {
      const s = (i / rows) * track.length;
      track.frameAt(s % track.length, frame);
      for (let side = 0; side < 2; side++) {
        const k = i * 2 + side;
        point.copy(frame.pos).addScaledVector(frame.left, side === 0 ? track.halfWidth : -track.halfWidth);
        point.toArray(positions, k * 3);
        frame.up.toArray(normals, k * 3);
        uvs[k * 2] = side;
        uvs[k * 2 + 1] = s / MARKING_PERIOD;
      }
      // left edge first, so the quads face up
      if (i < rows) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const road = new THREE.Mesh(geometry, roadMaterial);
    road.receiveShadow = true;
    group.add(road);
  }

  // ---- the verge and a strip of hillside on each side, from the same cross-section the wheels stand on
  {
    const steps = Math.ceil(track.length / 3);
    const across = 4; // pavement edge, end of the shoulder, the solid edge, the hillside's end
    const positions = new Float32Array((steps + 1) * 2 * across * 3);
    const colors = new Float32Array((steps + 1) * 2 * across * 3);
    const index = [];
    const shoulder = [0.2, 0.19, 0.17];
    const grass = [0.075, 0.105, 0.04];
    const gravel = [0.21, 0.2, 0.18];
    const rock = [0.17, 0.165, 0.155];
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * track.length;
      const sample = real ? sampleAt(s) : 0;
      for (let half = 0; half < 2; half++) {
        const side = half === 0 ? 1 : -1;
        const edge = edgeAt(s, side);
        const loose = real && (side > 0 ? track.vergeL : track.vergeR)[sample] === SURFACE_GRAVEL;
        const lats = [track.halfWidth, Math.min(track.halfWidth + (track.shoulder ?? 0.6), edge), edge, edge + BEYOND];
        const tints = [shoulder, loose ? gravel : grass, loose ? rock : grass, loose ? rock : grass];
        for (let j = 0; j < across; j++) {
          const k = (i * 2 + half) * across + j;
          at(s, side * lats[j]).toArray(positions, k * 3);
          colors.set(tints[j], k * 3);
          if (i < steps && j < across - 1) {
            const next = k + 2 * across;
            // wound so that both sides face up
            if (side > 0) index.push(k, next, k + 1, k + 1, next, next + 1);
            else index.push(k, k + 1, next, k + 1, next + 1, next);
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const verge = new THREE.Mesh(geometry, material({ vertexColors: true, roughness: 1 }));
    verge.receiveShadow = true;
    // (it casts too: the cut rock beside the descent is what shades the road there)
    verge.castShadow = true;
    group.add(verge);
  }

  // ---- everything else lies on a plain at the level of the lake
  {
    const shade = valueField(256, { seed: 3, cells: 6, octaves: 5 });
    const map = fieldTexture(256, [
      shade.map((v) => toSrgb(0.09 + 0.07 * v)),
      shade.map((v) => toSrgb(0.12 + 0.07 * v)),
      shade.map((v) => toSrgb(0.07 + 0.04 * v)),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.repeat.set(100, 100);
    // (cut into squares: across two triangles the size of the whole plain, depth is not interpolated finely
    // enough to keep what lies just above it on top)
    const geometry = new THREE.PlaneGeometry(6000, 6000, 96, 96).rotateX(-Math.PI / 2);
    const plain = new THREE.Mesh(geometry, material({ map, roughness: 1 }));
    plain.position.set(real ? (track.bounds.minX + track.bounds.maxX) / 2 : 0, real ? track.layout.lakeLevel : -0.05, real ? (track.bounds.minZ + track.bounds.maxZ) / 2 : 0);
    plain.receiveShadow = true;
    group.add(plain);
  }

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
        trees.push({ x: point.x, y: point.y - 0.3, z: point.z, radius: height * treeRng.range(0.15, 0.2), height, shade: treeRng.range(0.7, 1.15) });
      }
    }
  }
  const forest = new THREE.InstancedMesh(cone, material({ roughness: 1 }), trees.length);
  trees.forEach((tree, i) => {
    forest.setMatrixAt(i, matrix.compose(point.set(tree.x, tree.y, tree.z), quat.identity(), scale.set(tree.radius, tree.height, tree.radius)));
    forest.setColorAt(i, color.setRGB(0.035 * tree.shade, 0.07 * tree.shade, 0.04 * tree.shade));
  });
  forest.castShadow = forest.receiveShadow = true;

  const blockRng = rng.fork('scatter');
  const blocks = new THREE.InstancedMesh(box, material({ roughness: 0.9 }), BLOCKS[tier]);
  let placed = 0;
  for (let tries = 0; placed < blocks.count && tries < blocks.count * 20; tries++) {
    const s = blockRng.range(0, track.length);
    const side = blockRng.sign();
    const far = blockRng.next();
    at(s, side * (edgeAt(s, side) + 1.5 + far * (real ? BEYOND - 4 : 60)));
    if (blocked(s, point.x, point.z)) continue;
    scale.set(blockRng.range(1.5, 5), blockRng.range(1.2, 5), blockRng.range(1.5, 5));
    quat.setFromAxisAngle(up, blockRng.range(0, Math.PI));
    point.y -= 0.4;
    blocks.setMatrixAt(placed, matrix.compose(point, quat, scale));
    const shade = blockRng.range(0.6, 1.2);
    blocks.setColorAt(placed, color.setRGB(0.3 * shade, 0.3 * shade, 0.28 * shade));
    placed++;
  }
  blocks.count = placed;
  blocks.castShadow = blocks.receiveShadow = true;

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

  const lampList = track.lamps.filter((lamp) => (lamp.kind ? lamp.kind === 'street' : lamp.height > 5));
  const poles = new THREE.InstancedMesh(box, material({ color: 0x30343a, roughness: 0.5, metalness: 0.6 }), lampList.length);
  const headMaterial = material({ color: 0x0a0a0a, emissive: new THREE.Color().setRGB(...LAMP_COLOR), emissiveIntensity: 0 });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.1, 0.9), headMaterial, lampList.length);
  lampList.forEach((lamp, i) => {
    const lat = lamp.lat ?? lamp.side * (track.halfWidth + 1.4);
    track.frameAt(lamp.s, frame);
    quat.setFromAxisAngle(up, Math.atan2(frame.left.x, frame.left.z));
    poles.setMatrixAt(i, matrix.compose(at(lamp.s, lat), quat, scale.set(0.16, lamp.height, 0.16)));
    // the head reaches out over the nearer lane
    at(lamp.s, lat - lamp.side * 1.2).y += lamp.height;
    heads.setMatrixAt(i, matrix.compose(point, quat, scale.set(1, 1, 1)));
  });
  poles.castShadow = true;

  group.add(forest, blocks, posts, poles, heads);

  return {
    group,
    road: roadMaterial,
    setLamps(street) {
      headMaterial.emissiveIntensity = LAMP_RADIANCE * street;
    },
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
