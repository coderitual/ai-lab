// The forest: spruce, fir, larch and birch, planted from the Track and the
// ground, drawn with two levels of detail chosen per tree for each view.
//
// PLANTING (once, at start-up, deterministic from the rng):
//   - Where the Track's solid edge is TREES, three rows follow the road: the
//     first stands at the edge distance itself (its trunks are the wall the
//     physics hits), the next two a few metres behind, with gaps here and
//     there for a glimpse through.
//   - Everywhere else on the terrain's grid, a jittered lattice is planted
//     where terrain.forestAt says the forest stands, thinning on steep ground,
//     with height (the summit and the high massif are open) and never on the
//     corridor of any stretch, in the tunnel's portals, round the viaduct, on
//     the lay-by or in the lake.
//   - No two trunks closer than their crowns allow (a grid hash).
//   On the low tier part of the general forest is dropped by index, so the
//   trees that are left stand where they stood.
//
// DRAWING. Each species has a NEAR and a FAR InstancedMesh (8 draw calls in
// all, plus the near ones in the shadow pass). For every view, prepareView
// walks the trees in 64 m cells, culls them against the camera's frustum and
// writes the survivors' matrices into the meshes: near detail within NEAR m,
// cards beyond, the two dissolving into each other over a few metres (a
// screen-door dither), and the far cards thinned with distance, each tree
// dissolving at a distance of its own. The trees round the view's car stay in
// the near mesh even outside the frustum, because they cast into its shadow
// map. Far trees cast no shadow.
//
// Wind: the near trees sway a few centimetres in update()'s clock.

import * as THREE from 'three';
import { createForestAtlas } from './forestTextures.js';
import { layBy } from './gantry.js';
import { extend, planeNoise, smoothstep, withBake } from './shading.js';
import { CROWN_RADIUS, SPECIES, TEMPLATE_HEIGHT, createTreeGeometries } from './treeGeometry.js';

const EDGE_TREES = 4;

/** Per tier: near detail out to (m), the far cards out to (m), share of the general forest kept, atlas size. */
const TIER = {
  low: { near: 55, far: 480, keep: 0.45, atlas: 512 },
  medium: { near: 80, far: 800, keep: 0.8, atlas: 1024 },
  high: { near: 100, far: 1100, keep: 1, atlas: 1024 },
};
/** Width of the band over which near and far dissolve into each other (m). */
const BLEND = 8;
/** The general forest's lattice (m). */
const LATTICE = 6.5;
/** The cells prepareView culls by (m). */
const CELL = 64;

/** Linear albedo (before the texture, which is pale: about 0.5 on average) per species, and its spread. */
const TINT = {
  spruce: [0.085, 0.15, 0.12],
  fir: [0.08, 0.15, 0.085],
  larch: [0.34, 0.21, 0.06],
  birch: [0.3, 0.25, 0.06],
};
/** Height range (m) per species. */
const HEIGHT = { spruce: [14, 28], fir: [12, 24], larch: [14, 24], birch: [10, 18] };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ reach: number }} options.shadow half the side of the sun's shadow square (m)
 */
export function createForest({ track, terrain, tier, rng, atmosphere, shadow }) {
  const started = performance.now();
  const T = TIER[tier] ?? TIER.high;
  const noise = planeNoise(rng.int(1 << 30));
  const plantRng = rng.fork('plant');

  // ---------------------------------------------------------------- planting
  /** @type {{ x: number, y: number, z: number, species: number, h: number, rank: number, road: boolean }[]} */
  const trees = [];
  const HASH = 3;
  const hash = new Map();
  const keyOf = (ix, iz) => ix * 73856093 + iz * 19349663;
  /** True when no trunk stands within r of (x, z). */
  const free = (x, z, r) => {
    const ix = Math.floor(x / HASH);
    const iz = Math.floor(z / HASH);
    const reach = Math.ceil(r / HASH);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const list = hash.get(keyOf(ix + a, iz + b));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if ((list[k] - x) ** 2 + (list[k + 1] - z) ** 2 < r * r) return false;
      }
    }
    return true;
  };
  const occupy = (x, z) => {
    const key = keyOf(Math.floor(x / HASH), Math.floor(z / HASH));
    const list = hash.get(key);
    if (list) list.push(x, z);
    else hash.set(key, [x, z]);
  };

  const spot = { index: -1, s: 0, lat: 0 };
  const lay = layBy(track);
  const near = (s, ranges, margin) => ranges.some((r) => track.delta(r.s0, s) > -margin && track.delta(r.s1, s) < margin);
  const atPortal = (s) => track.tunnels.some((t) => Math.abs(track.delta(t.s0, s)) < 18 || Math.abs(track.delta(t.s1, s)) < 18);
  /** Where nothing may grow: on any stretch's corridor (with a clearance), the portals, round the deck, the lay-by. */
  function blocked(x, z, clearance, hint = -1) {
    track.locate(x, z, hint, spot);
    const side = spot.lat >= 0 ? 1 : -1;
    const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, side);
    if (beyond < clearance) return true;
    if (atPortal(spot.s) && beyond < 30) return true;
    if (near(spot.s, track.bridges, 6) && beyond < 14) return true;
    if (Math.abs(track.delta(0, spot.s)) < 8 && beyond < 4) return true; // the gantry's legs
    if ((x - lay.x) ** 2 + (z - lay.z) ** 2 < (lay.radius + 3) ** 2) return true;
    return false;
  }
  const streetLamps = track.lamps.filter((l) => l.kind === 'street');
  const byLamp = (s, side) => streetLamps.some((l) => l.side === side && Math.abs(track.delta(l.s, s)) < 3.5);

  const pickSpecies = (r, y, road) => {
    const larch = 0.08 + 0.12 * smoothstep(30, 90, y);
    const birch = road ? 0.2 : 0.04 * (1 - smoothstep(20, 60, y));
    const fir = 0.22;
    if (r < birch) return 2;
    if (r < birch + larch) return 3;
    if (r < birch + larch + fir) return 1;
    return 0;
  };
  function addTree(x, y, z, species, road) {
    const [lo, hi] = HEIGHT[SPECIES[species]];
    const u = plantRng.next();
    const h = road ? lo + (hi - lo) * (0.35 + 0.65 * u) : lo + (hi - lo) * Math.sqrt(u);
    trees.push({ x, y, z, species, h, rank: plantRng.next(), road });
    occupy(x, z);
  }
  const point = new THREE.Vector3();

  // the rows along the road where the Track says TREES
  const ROWS = [
    { off: [0.25, 0.7], step: [2.1, 3.0], gap: 2 },
    { off: [2.4, 4.6], step: [2.8, 4.0], gap: 0.62 },
    { off: [5.2, 9.0], step: [3.2, 4.8], gap: 0.55 },
  ];
  const glimpse = (s, side) => noise.fbm(s / 55 + side * 13.7, 3.3, 2);
  for (const side of [1, -1]) {
    const kinds = side > 0 ? track.kindL : track.kindR;
    ROWS.forEach((row, r) => {
      let hint = -1;
      for (let s = plantRng.range(0, 2); s < track.length; s += plantRng.range(row.step[0], row.step[1])) {
        const i = Math.round(s / track.ds) % track.count;
        if (kinds[i] !== EDGE_TREES) continue;
        if (glimpse(s, side) > row.gap) continue;
        if (r === 0 && byLamp(s, side)) continue;
        const edge = track.edgeAt(s, side);
        track.pointAt(s, side * (edge + plantRng.range(row.off[0], row.off[1])), point);
        if (blocked(point.x, point.z, 0.2, hint)) continue;
        hint = spot.index;
        if (!free(point.x, point.z, r === 0 ? 1.6 : 2.2)) continue;
        const y = terrain.heightAt(point.x, point.z);
        addTree(point.x, y - 0.15, point.z, pickSpecies(plantRng.next(), y, r < 2), true);
      }
    });
  }
  const roadTrees = trees.length;

  // the general forest
  const b = track.bounds;
  const X0 = b.minX - 250;
  const Z0 = b.minZ - 250;
  const X1 = b.maxX + 250;
  const Z1 = b.maxZ + 250;
  const lakeLevel = terrain.lake.level;
  for (let z = Z0; z < Z1; z += LATTICE) {
    for (let x = X0; x < X1; x += LATTICE) {
      const px = x + plantRng.range(-0.45, 0.45) * LATTICE;
      const pz = z + plantRng.range(-0.45, 0.45) * LATTICE;
      const roll = plantRng.next();
      const rank = plantRng.next();
      const f = terrain.forestAt(px, pz);
      // dense where the forest is, a few strays at its edges and on the meadows
      if (roll > Math.min(0.92, f * 1.15) && roll > 0.015) continue;
      if (rank > T.keep) continue;
      if (blocked(px, pz, 2.2)) continue;
      const y = terrain.heightAt(px, pz);
      if (y < lakeLevel + 1) continue;
      // the tree line: thinning above 75 m, a few stragglers higher up
      if (plantRng.next() < 0.9 * smoothstep(75, 115, y)) continue;
      const slope = Math.max(Math.abs(terrain.heightAt(px + 2, pz) - y), Math.abs(terrain.heightAt(px, pz + 2) - y)) / 2;
      if (slope > 0.9) continue;
      if (!free(px, pz, 2.6)) continue;
      addTree(px, y - 0.2 - slope * 0.6, pz, pickSpecies(plantRng.next(), y, false), false);
    }
  }
  const msPlant = Math.round(performance.now() - started);

  // ---------------------------------------------------------------- per-tree data
  const count = trees.length;
  const matrices = new Float32Array(count * 16);
  const tints = new Float32Array(count * 3);
  const bakes = new Float32Array(count * 3);
  const spheres = new Float32Array(count * 4); // centre and radius, for the frustum
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const bake = [0, 0, 0];
    const tintRng = rng.fork('tint');
    trees.forEach((t, i) => {
      const name = SPECIES[t.species];
      const s = t.h / TEMPLATE_HEIGHT[name];
      const full = tintRng.range(0.85, 1.15);
      // a lean of up to 4 degrees (birches more), and a turn
      const lean = tintRng.range(0, t.species === 2 ? 0.12 : 0.06);
      const dir = tintRng.range(0, Math.PI * 2);
      e.set(Math.cos(dir) * lean, tintRng.range(0, Math.PI * 2), Math.sin(dir) * lean, 'YXZ');
      q.setFromEuler(e);
      m.compose(p.set(t.x, t.y, t.z), q, sc.set(s * full, s, s * full));
      m.toArray(matrices, i * 16);
      const base = TINT[name];
      const v = tintRng.range(0.75, 1.2);
      const hue = tintRng.range(-0.12, 0.12);
      tints[i * 3] = base[0] * v * (1 + hue);
      tints[i * 3 + 1] = base[1] * v;
      tints[i * 3 + 2] = base[2] * v * (1 - hue);
      terrain.bakeAt(t.x, t.z, bake, 0);
      // a crown stands up out of a valley's shade a little; and it never sees less sky than half
      bakes[i * 3] = Math.min(1, bake[0] * 1.1 + 0.05);
      bakes[i * 3 + 1] = Math.min(1, bake[1] * 1.1 + 0.05);
      bakes[i * 3 + 2] = Math.max(0.5, bake[2]);
      spheres[i * 4] = t.x;
      spheres[i * 4 + 1] = t.y + t.h * 0.5;
      spheres[i * 4 + 2] = t.z;
      spheres[i * 4 + 3] = Math.max(t.h * 0.5, CROWN_RADIUS[name] * s) * 1.1;
    });
  }
  // cells
  const cx0 = Math.floor(X0 / CELL);
  const cz0 = Math.floor(Z0 / CELL);
  const cw = Math.ceil(X1 / CELL) - cx0 + 1;
  const chh = Math.ceil(Z1 / CELL) - cz0 + 1;
  const cellOf = trees.map((t) => (Math.floor(t.z / CELL) - cz0) * cw + (Math.floor(t.x / CELL) - cx0));
  const order = [...trees.keys()].sort((a, c) => cellOf[a] - cellOf[c]);
  const cellStart = new Int32Array(cw * chh + 1);
  for (const i of order) cellStart[cellOf[i] + 1]++;
  for (let k = 0; k < cw * chh; k++) cellStart[k + 1] += cellStart[k];
  const cellItems = Int32Array.from(order);
  const cellSphere = [];
  for (let k = 0; k < cw * chh; k++) {
    let top = -1e9;
    let bottom = 1e9;
    for (let j = cellStart[k]; j < cellStart[k + 1]; j++) {
      const i = cellItems[j];
      top = Math.max(top, trees[i].y + trees[i].h);
      bottom = Math.min(bottom, trees[i].y);
    }
    const x = (cx0 + (k % cw) + 0.5) * CELL;
    const z = (cz0 + Math.floor(k / cw) + 0.5) * CELL;
    cellSphere.push(new THREE.Sphere(new THREE.Vector3(x, (top + bottom) / 2, z), Math.hypot(CELL * 0.75, (top - bottom) / 2) + 4));
  }

  // ---------------------------------------------------------------- material and meshes
  const atlas = createForestAtlas(T.atlas, rng.fork('atlas'));
  const uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.6) } };
  const NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
  const makeMaterial = (wind) => {
    const material = withBake(
      new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 }),
    );
    if (wind) material.defines = { TREE_WIND: 1 };
    extend(material, 'tree', (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 aShade;\nattribute vec4 aTint;\nvarying vec2 vShade;\nvarying vec4 vTint;\nuniform float uTime;\nuniform vec2 uWind;',
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
vShade = aShade;
vTint = aTint;
#if defined( TREE_WIND ) && defined( USE_INSTANCING )
{
  float ph = dot( instanceMatrix[3].xz, vec2( 0.37, 0.71 ) );
  float h = max( position.y, 0.0 ) / 20.0;
  float sway = sin( uTime * 0.83 + ph ) * 0.6 + sin( uTime * 2.1 + ph * 1.7 ) * 0.25;
  float tip = ( 1.0 - aShade.y ) * smoothstep( 0.5, 3.0, length( position.xz ) );
  transformed.xz += uWind * ( h * h * sway * 0.07 + tip * sin( uTime * 3.3 + ph + position.y * 1.3 ) * 0.025 );
}
#endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vShade;\nvarying vec4 vTint;')
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
{
  // the screen-door dissolve between the two levels of detail, and of the far cards with distance
  float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( vTint.a >= 0.0 ? ign >= vTint.a : ign < 1.0 + vTint.a ) discard;
  diffuseColor.rgb *= mix( vTint.rgb, vec3( 1.0 ), vShade.y ) * vShade.x;
}`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          // the part of a crown one sees faces one: the normal leans towards the eye (more for the far cards, which
          // are flat pictures of a whole tree), so a tree with the sun behind it is dark and one facing it lit
          `${NORMAL_BEGIN}\nnormal = normalize( mix( normal, normalize( vViewPosition ), ${wind ? '0.45' : '0.75'} * ( 1.0 - vShade.y ) ) );`,
        );
    });
    return atmosphere.patch(material);
  };
  const nearMaterial = makeMaterial(true);
  const farMaterial = makeMaterial(false);
  const depthMaterial = new THREE.MeshDepthMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });

  const geometries = createTreeGeometries(rng.fork('shapes'));
  const group = new THREE.Group();
  group.name = 'forest';
  const perSpecies = SPECIES.map((_, k) => trees.filter((t) => t.species === k).length);
  /** One InstancedMesh with room for `capacity` trees and the per-tree attributes. */
  const pool = (geometry, material, capacity, name) => {
    const g = geometry.clone();
    const n = Math.max(1, capacity);
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBake', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(g, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const nearMeshes = SPECIES.map((name, k) => {
    const mesh = pool(geometries[name].near, nearMaterial, perSpecies[k], `forest-near-${name}`);
    mesh.castShadow = true;
    mesh.customDepthMaterial = depthMaterial;
    return mesh;
  });
  const farMeshes = SPECIES.map((name, k) => pool(geometries[name].far, farMaterial, perSpecies[k], `forest-far-${name}`));
  for (const name of SPECIES) {
    geometries[name].near.dispose();
    geometries[name].far.dispose();
  }

  // ---------------------------------------------------------------- per view
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector3();
  const shadowR = shadow.reach * 1.5;
  const counts = { near: 0, far: 0, nearTriangles: 0, farTriangles: 0 };
  const nearTris = SPECIES.map((name) => nearMeshes[SPECIES.indexOf(name)].geometry.index.count / 3);
  const farTris = SPECIES.map((name) => farMeshes[SPECIES.indexOf(name)].geometry.index.count / 3);

  function write(mesh, i, fade) {
    const k = mesh.count++;
    mesh.instanceMatrix.array.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
    const tint = mesh.geometry.attributes.aTint.array;
    tint[k * 4] = tints[i * 3];
    tint[k * 4 + 1] = tints[i * 3 + 1];
    tint[k * 4 + 2] = tints[i * 3 + 2];
    tint[k * 4 + 3] = fade;
    mesh.geometry.attributes.aBake.array.set(bakes.subarray(i * 3, i * 3 + 3), k * 3);
  }
  function upload(mesh) {
    const n = mesh.count;
    for (const [attr, size] of [
      [mesh.instanceMatrix, 16],
      [mesh.geometry.attributes.aTint, 4],
      [mesh.geometry.attributes.aBake, 3],
    ]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n) * size);
      attr.needsUpdate = true;
    }
  }

  function prepareView(camera, focus) {
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    eye.setFromMatrixPosition(camera.matrixWorld);
    // an orthographic view from above (the viewer's map) sees everything in its frame at the near level
    const flat = camera.isOrthographicCamera;
    for (const m of nearMeshes) m.count = 0;
    for (const m of farMeshes) m.count = 0;
    const nearD = T.near;
    const farD = T.far;
    for (let k = 0; k < cellSphere.length; k++) {
      if (cellStart[k] === cellStart[k + 1]) continue;
      const cs = cellSphere[k];
      const dEye = flat ? 0 : cs.center.distanceTo(eye) - cs.radius;
      const dFocus = Math.hypot(cs.center.x - focus.x, cs.center.z - focus.z) - cs.radius;
      const caster = dFocus < shadowR;
      if (!caster && (dEye > farD || !frustum.intersectsSphere(cs))) continue;
      for (let j = cellStart[k]; j < cellStart[k + 1]; j++) {
        const i = cellItems[j];
        sphere.center.set(spheres[i * 4], spheres[i * 4 + 1], spheres[i * 4 + 2]);
        sphere.radius = spheres[i * 4 + 3];
        const seen = frustum.intersectsSphere(sphere);
        const sp = trees[i].species;
        const inShadow = caster && Math.hypot(sphere.center.x - focus.x, sphere.center.z - focus.z) < shadowR;
        if (!seen && !inShadow) continue;
        const d = flat ? 0 : Math.hypot(sphere.center.x - eye.x, spheres[i * 4 + 1] - eye.y, sphere.center.z - eye.z);
        if (d < nearD || inShadow) {
          const a = Math.min(1, (nearD - d) / BLEND);
          if (a > 0 || inShadow) write(nearMeshes[sp], i, inShadow && a <= 0 ? 0 : a);
          if (a < 1 && seen) write(farMeshes[sp], i, Math.max(-1, a - 1));
          continue;
        }
        // the far cards: each tree has its own distance at which it dissolves (the road's rows keep longest)
        const cut = farD * (trees[i].road ? 1 : 0.3 + 0.7 * (1 - trees[i].rank) ** 0.7);
        if (d > cut) continue;
        write(farMeshes[sp], i, -Math.min(1, (cut - d) / (0.12 * cut)));
      }
    }
    counts.near = counts.far = counts.nearTriangles = counts.farTriangles = 0;
    nearMeshes.forEach((m, k) => {
      upload(m);
      counts.near += m.count;
      counts.nearTriangles += m.count * nearTris[k];
    });
    farMeshes.forEach((m, k) => {
      upload(m);
      counts.far += m.count;
      counts.farTriangles += m.count * farTris[k];
    });
  }

  return {
    group,
    prepareView,
    update(dt, simTime) {
      uniforms.uTime.value = simTime;
    },
    setTime(time) {
      // a breath of wind by day, less at night
      uniforms.uWind.value.set(0.8, 0.6).multiplyScalar(time.name === 'night' ? 0.5 : 1);
    },
    stats: {
      trees: count,
      roadTrees,
      perSpecies,
      nearTriangles: nearTris,
      farTriangles: farTris,
      view: counts,
      ms: { plant: msPlant, total: Math.round(performance.now() - started) },
    },
    dispose() {
      for (const m of [...nearMeshes, ...farMeshes]) m.geometry.dispose();
      nearMaterial.dispose();
      farMaterial.dispose();
      depthMaterial.dispose();
      atlas.dispose();
    },
  };
}
