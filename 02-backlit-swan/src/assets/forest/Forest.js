// The wood round the pond, the bank and the meadow. PLACEHOLDER: the simplest
// things that give the far layer its ingredients: dark upright trunks, small
// very bright leaves high up (the disc blur turns each into a soft circle of
// light), a dim band of haze, a few slanting shafts of light, and a sunlit
// meadow with a fence to the east-north-east. The real forest replaces the
// contents of this file and keeps what createForest() returns.
//
// Everything in `far` is drawn into the far layer, which is thrown out of
// focus as a whole (FarLayer.js). Things in `near` are drawn sharp with the
// swan; there are none yet.
//
// Compass angles here are radians, 0 north (-Z), PI/2 east (+X), as in pond.js.

import * as THREE from 'three';

const DEG = Math.PI / 180;
/** Where the trees open onto the meadow, and how wide the gap is. */
const MEADOW = { theta: 62 * DEG, halfWidth: 13 * DEG };

// three.js declares instanceMatrix and instanceColor itself when the mesh is instanced.
const WORLD_VERTEX = /* glsl */ `
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vTint;
out vec2 vUv;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
#endif
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vec4 world = modelMatrix * local;
  vWorldPos = world.xyz;
  vNormal = n;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ground = (ctx) => /* glsl */ `
${ctx.light.glsl}
${ctx.pond.glsl}
in vec3 vWorldPos;
void main() {
  vec2 xz = vWorldPos.xz;
  float theta = atan(xz.x, -xz.y);
  float off = abs(atan(sin(theta - ${MEADOW.theta.toFixed(4)}), cos(theta - ${MEADOW.theta.toFixed(4)})));
  float shore = shoreDistance(xz);
  // the meadow: grass in full sun, starting a few metres back from the water
  float meadow = (1.0 - smoothstep(${(MEADOW.halfWidth * 0.7).toFixed(4)}, ${MEADOW.halfWidth.toFixed(4)}, off)) * smoothstep(1.0, 5.0, shore);
  float patches = 0.6 + 0.8 * fbm(xz * 0.35, 3);
  vec3 grass = vec3(0.22, 0.34, 0.035) * uSunColor * 0.5 * patches;
  // under the trees: almost nothing, a little cool sky light
  vec3 floorColor = vec3(0.02, 0.03, 0.02) * (uSkyColor * 1.5 + uAmbient);
  outColor = toTarget(vec4(mix(floorColor, grass, meadow), 1.0));
}
`;

const trunk = (ctx) => /* glsl */ `
${ctx.light.glsl}
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  // bark is dark; the sun only finds the edge of a trunk that faces it
  vec3 col = vec3(0.03, 0.025, 0.018) * (uSunColor * sunWrap(n, 0.0) * 0.25 + fillLight(n));
  outColor = toTarget(vec4(col, 1.0));
}
`;

const LEAF_FRAGMENT = /* glsl */ `
in vec3 vTint;
in vec2 vUv;
void main() {
  // a rounded leaf cut out of the square
  vec2 q = vUv * 2.0 - 1.0;
  if (dot(q, q) > 1.0) discard;
  outColor = toTarget(vec4(vTint, 1.0));
}
`;

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
in vec2 vUv;
void main() {
  // soft in every direction: bright along the middle, gone at the edges and ends
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  outColor = toTarget(vec4(uColor * across * across * along, 1.0));
}
`;

/**
 * @param {object} ctx the shared context (see World.js); uses ctx.quality.counts.trunks and .leaves
 * @returns {{ far: THREE.Group, near: THREE.Group, update: (dt: number, time: number, camera: THREE.Camera) => void, dispose: () => void }}
 */
export function createForest(ctx) {
  const rng = ctx.rng.fork('forest');
  const { pond, light } = ctx;
  const far = new THREE.Group();
  far.name = 'forest-far';
  const near = new THREE.Group();
  near.name = 'forest-near';
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
  const inMeadow = (theta, slack = 0) => {
    const d = Math.atan2(Math.sin(theta - MEADOW.theta), Math.cos(theta - MEADOW.theta));
    return Math.abs(d) < MEADOW.halfWidth + slack;
  };

  // The ground: rings from just inside the shore (under the water's faded
  // edge) out past the trees, rising gently away from the pond.
  {
    const rings = [-4, -1.5, 0, 2, 6, 14, 30, 60, 110];
    const heights = [-0.5, -0.15, 0.02, 0.25, 0.45, 0.6, 0.8, 1.2, 2];
    const segments = 96;
    const positions = [];
    const indices = [];
    for (let j = 0; j < rings.length; j++) {
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const r = pond.shoreRadius(theta) + rings[j];
        positions.push(r * Math.sin(theta), heights[j], -r * Math.cos(theta));
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = keep(
      ctx.createMaterial({
        vertexShader: /* glsl */ `
out vec3 vWorldPos;
void main() {
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: ground(ctx),
        uniforms: { ...light.uniforms },
        side: THREE.DoubleSide,
      }),
    );
    far.add(new THREE.Mesh(geometry, material));
  }

  // Trunks: a wide belt of them, none in the meadow's gap.
  const trunkSpots = [];
  {
    const count = ctx.quality.counts.trunks;
    const geometry = keep(new THREE.CylinderGeometry(0.75, 1, 1, 7, 1, true));
    geometry.translate(0, 0.5, 0);
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: trunk(ctx), uniforms: { ...light.uniforms } }));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const lean = new THREE.Euler();
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const theta = rng.range(0, Math.PI * 2);
      if (inMeadow(theta, 2 * DEG)) continue;
      // crowded near the bank, thinning out behind
      const back = 2.5 + 55 * Math.pow(rng.float(), 1.6);
      const r = pond.shoreRadius(theta) + back;
      const girth = rng.range(0.22, 0.6);
      const height = rng.range(18, 30);
      p.set(r * Math.sin(theta), 0, -r * Math.cos(theta));
      q.setFromEuler(lean.set(rng.gauss() * 0.03, rng.range(0, 6.28), rng.gauss() * 0.03));
      mesh.setMatrixAt(placed, m.compose(p, q, s.set(girth, height, girth)));
      trunkSpots.push({ x: p.x, z: p.z, height });
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    far.add(mesh);
  }

  // Leaves: clumps hung in the crowns. Most are dark; the ones the sun reaches
  // are many times brighter than white, which is what makes the bokeh.
  {
    const count = ctx.quality.counts.leaves;
    const geometry = keep(new THREE.PlaneGeometry(1, 1));
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: LEAF_FRAGMENT, side: THREE.DoubleSide }));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const turn = new THREE.Euler();
    const color = new THREE.Color();
    const sun = light.uniforms.uSunColor.value;
    const clumps = Math.max(1, Math.round(count / 40));
    let i = 0;
    for (let c = 0; c < clumps && trunkSpots.length; c++) {
      // half of the clumps go to the trees in the north, behind the swan as
      // the default camera sees it, so that even a few leaves are in the picture
      let tree = rng.pick(trunkSpots);
      if (c % 2 === 0) for (let tries = 0; tries < 12 && !(tree.z < -25 && Math.abs(tree.x) < 22); tries++) tree = rng.pick(trunkSpots);
      const cx = tree.x + rng.gauss() * 3.5;
      // from low boughs over the bank up into the crown
      const cy = 2.5 + (tree.height - 2.5) * Math.pow(rng.float(), 1.4);
      const cz = tree.z + rng.gauss() * 3.5;
      const radius = rng.range(1.2, 3.2);
      // whole clumps are in the sun or out of it
      const lit = rng.float() < 0.38;
      const perClump = Math.ceil(count / clumps);
      for (let k = 0; k < perClump && i < count; k++, i++) {
        p.set(cx + rng.gauss() * radius, cy + rng.gauss() * radius * 0.6, cz + rng.gauss() * radius);
        q.setFromEuler(turn.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)));
        const size = rng.range(0.14, 0.34);
        mesh.setMatrixAt(i, m.compose(p, q, s.set(size, size, size)));
        if (lit && rng.float() < 0.55) {
          // sun through a leaf: yellow-green, scaled by the sun itself
          const k2 = rng.range(0.25, 1.1);
          color.setRGB(0.18 * sun.x * k2, 0.26 * sun.y * k2, 0.02 * sun.z * k2);
        } else {
          const k2 = rng.range(0.3, 1);
          color.setRGB(0.004 * k2, 0.011 * k2, 0.005 * k2);
        }
        mesh.setColorAt(i, color);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    far.add(mesh);
  }

  // Glows: the haze between the trunks and a few shafts of light. All of them
  // are additive sheets that fade to nothing at their edges.
  {
    const glow = (color) =>
      keep(
        ctx.createMaterial({
          vertexShader: WORLD_VERTEX,
          fragmentShader: GLOW_FRAGMENT,
          uniforms: { uColor: { value: new THREE.Vector3().fromArray(color) } },
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
    // haze: a low wall of cool light standing among the first trees, all the way round
    const hazeGeometry = keep(new THREE.CylinderGeometry(pond.SHORE.radius + 14, pond.SHORE.radius + 14, 16, 64, 1, true));
    hazeGeometry.translate(0, 6, 0);
    // a cylinder's u runs round it and v up it; the glow shader wants "across" in u, so make u the height
    const uvAttr = hazeGeometry.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, 0.25 + 0.5 * uvAttr.getY(i), 0.45);
    const haze = new THREE.Mesh(hazeGeometry, glow([0.008, 0.016, 0.018]));
    haze.renderOrder = 5;
    far.add(haze);

    // shafts: tall sheets leaning along the sunlight, behind the swan
    const shaftGeometry = keep(new THREE.PlaneGeometry(1, 1));
    shaftGeometry.translate(0, 0.5, 0);
    const shaftMaterial = glow([0.05, 0.075, 0.05]);
    const sunDir = light.uniforms.uSunDir.value;
    for (let k = 0; k < 5; k++) {
      const theta = (rng.range(-22, 30) + 8) * DEG;
      const r = pond.shoreRadius(theta) + rng.range(2, 14);
      const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
      shaft.position.set(r * Math.sin(theta), -1, -r * Math.cos(theta));
      shaft.scale.set(rng.range(2.5, 6), 34, 1);
      // lean the sheet's long axis along the light, keep its face toward the pond
      shaft.rotation.set(0, -theta, 0);
      shaft.rotateX(-Math.atan2(Math.hypot(sunDir.x, sunDir.z), sunDir.y) * 0.35);
      shaft.renderOrder = 6;
      far.add(shaft);
    }
  }

  // The fence at the near edge of the meadow: posts and one rail, dark against the grass.
  {
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: trunk(ctx), uniforms: { ...light.uniforms } }));
    const post = keep(new THREE.BoxGeometry(0.12, 1.3, 0.12));
    post.translate(0, 0.65, 0);
    const posts = 9;
    const from = MEADOW.theta - MEADOW.halfWidth * 0.8;
    const to = MEADOW.theta + MEADOW.halfWidth * 0.8;
    let previous = null;
    for (let k = 0; k < posts; k++) {
      const theta = from + ((to - from) * k) / (posts - 1);
      const r = pond.shoreRadius(theta) + 7;
      const here = new THREE.Vector3(r * Math.sin(theta), 0.45, -r * Math.cos(theta));
      const mesh = new THREE.Mesh(post, material);
      mesh.position.copy(here);
      far.add(mesh);
      if (previous) {
        const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.1, here.distanceTo(previous))), material);
        rail.position.copy(here).add(previous).multiplyScalar(0.5);
        rail.position.y += 1.0;
        rail.lookAt(here.x, rail.position.y, here.z);
        far.add(rail);
      }
      previous = here;
    }
  }

  return {
    far,
    near,
    update() {},
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
