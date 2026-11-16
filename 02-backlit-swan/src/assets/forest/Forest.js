// The wood round the pond, the bank and the meadow.
//
// The film's surroundings are almost all darkness: a wall of trunks with
// nothing between them, one soft shaft of blue haze coming down behind the
// swan, clumps of sun-dappled leaves up to the left and right, and, to the
// east-north-east where the trees open, a meadow in full sun with a
// post-and-rail fence, framed by one big trunk. That is what is built here:
// dark upright trunks, small leaves of which a few are many times brighter
// than white (the disc blur turns each into a soft blob of light), sheets of
// haze, a ground that is black under the trees and yellow in the clearing.
//
// Everything in `far` is drawn into the far layer, which is thrown out of
// focus as a whole (FarLayer.js). Things in `near` are drawn sharp with the
// swan; there are none.
//
// Compass angles here are radians, 0 north (-Z), PI/2 east (+X), as in pond.js.

import * as THREE from 'three';

const DEG = Math.PI / 180;
/** Where the trees open onto the meadow, and how wide the gap is. */
const MEADOW = { theta: 43 * DEG, halfWidth: 18 * DEG };

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
  // Instances are stretched (a trunk is a unit cylinder made twenty times
  // taller than wide), and a normal must be squashed where the surface is
  // stretched: divide by the square of each axis's scale before turning it.
  mat3 im = mat3(instanceMatrix);
  n = im * (n / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
#endif
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vec4 world = modelMatrix * local;
  vWorldPos = world.xyz;
  vNormal = normalize(n);
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
  float meadow = (1.0 - smoothstep(${(MEADOW.halfWidth * 0.7).toFixed(4)}, ${MEADOW.halfWidth.toFixed(4)}, off)) * smoothstep(0.4, 2.2, shore);
  // Grass in low sun is yellow, not green (the film's meadow is 234, 209, 57
  // on screen): long blades lit from behind and through.
  float patches = 0.55 + 0.9 * fbm(xz * 0.45, 3);
  vec3 grass = vec3(0.19, 0.165, 0.014) * uSunColor * patches;
  // a path of bare red-brown earth runs along the bank inside the fence
  float path = (1.0 - smoothstep(0.5, 1.4, abs(shore - 3.3 - 0.8 * sin(theta * 9.0)))) * 0.85;
  grass = mix(grass, vec3(0.05, 0.022, 0.008) * uSunColor * (0.6 + 0.6 * fbm(xz * 1.7, 2)), path);
  // tree shadows lie across the clearing in long bars
  grass *= 0.25 + 0.75 * smoothstep(0.25, 0.6, fbm(vec2(dot(xz, vec2(0.9, 0.44)) * 0.5, dot(xz, vec2(-0.44, 0.9)) * 0.07), 2));
  // under the trees: nothing but a trace of sky
  vec3 floorColor = vec3(0.02, 0.03, 0.02) * (uSkyColor * 0.5 + uAmbient);
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
  vec3 col = vec3(0.03, 0.025, 0.018) * (uSunColor * sunWrap(n, 0.0) * 0.25 + fillLight(n) * 0.35);
  outColor = toTarget(vec4(col, 1.0));
}
`;

// Weathered wood in the open: in silhouette against the grass, with the sun
// catching the tops of the rails and posts as thin bright lines.
const fence = (ctx) => /* glsl */ `
${ctx.light.glsl}
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 col = vec3(0.3, 0.26, 0.17) * (uSunColor * max(dot(n, uSunDir), 0.0) * 1.1 + fillLight(n) * 0.25);
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
  // Soft in every direction: bright along the middle and gone at the edges;
  // strongest high up, where the light comes in, thinning toward the ground
  // (the film's shaft is half as bright at the water as at the top of the picture).
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.04, vUv.y) * (0.3 + 0.7 * smoothstep(0.0, 0.55, vUv.y)) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
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
      const back = 1.2 + 34 * Math.pow(rng.float(), 1.7);
      const r = pond.shoreRadius(theta) + back;
      const girth = rng.range(0.14, 0.42);
      const height = rng.range(14, 24);
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
      if (c % 2 === 0) for (let tries = 0; tries < 12 && !(tree.z < -9 && tree.z > -22 && Math.abs(tree.x) < 12); tries++) tree = rng.pick(trunkSpots);
      const cx = tree.x + rng.gauss() * 2.2;
      // Low boughs over the bank and the first few metres of crown: from 5 m
      // away and a metre up, the picture's top edge is only 13 degrees above
      // the horizon, so anything higher than about 7 m is never seen.
      const cy = 3.4 + 7.5 * Math.pow(rng.float(), 0.9);
      const cz = tree.z + rng.gauss() * 2.2;
      const radius = rng.range(0.7, 1.9);
      // whole clumps are in the sun or out of it
      const lit = rng.float() < 0.42;
      const perClump = Math.ceil(count / clumps);
      for (let k = 0; k < perClump && i < count; k++, i++) {
        p.set(cx + rng.gauss() * radius, cy + rng.gauss() * radius * 0.6, cz + rng.gauss() * radius);
        q.setFromEuler(turn.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)));
        const size = rng.range(0.05, 0.13);
        mesh.setMatrixAt(i, m.compose(p, q, s.set(size, size, size)));
        if (lit && rng.float() < 0.55) {
          // Sun through a leaf: yellow-olive (156, 157, 72 on screen in the
          // film, up to 195, 186, 96), scaled by the sun itself. A few are
          // much brighter: the small hot points among the soft blobs.
          const k2 = rng.float() < 0.13 ? rng.range(2.5, 7) : rng.range(0.2, 1.25);
          color.setRGB(0.085 * sun.x * k2, 0.088 * sun.y * k2, 0.03 * sun.z * k2);
        } else {
          const k2 = rng.range(0.3, 1);
          color.setRGB(0.006 * k2, 0.011 * k2, 0.008 * k2);
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
    const hazeGeometry = keep(new THREE.CylinderGeometry(pond.SHORE.radius + 9, pond.SHORE.radius + 9, 16, 64, 1, true));
    hazeGeometry.translate(0, 6, 0);
    // a cylinder's u runs round it and v up it; the glow shader wants "across" in u, so make u the height
    const uvAttr = hazeGeometry.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, 0.25 + 0.5 * uvAttr.getY(i), 0.45);
    const haze = new THREE.Mesh(hazeGeometry, glow([0.0012, 0.0018, 0.0042]));
    haze.renderOrder = 5;
    far.add(haze);

    // Shafts: tall sheets of lit haze leaning along the sunlight. The first is
    // the film's: straight behind the swan, a touch right of centre, blue
    // (31, 45, 47 on screen at the top of the picture). The others are
    // fainter and stand where the camera finds them when it is moved round.
    const shaftGeometry = keep(new THREE.PlaneGeometry(1, 1));
    shaftGeometry.translate(0, 0.5, 0);
    const sunDir = light.uniforms.uSunDir.value;
    const shafts = [
      { theta: 3, back: 5, width: 4.6, color: [0.013, 0.02, 0.044] },
      { theta: -31, back: 7, width: 3.2, color: [0.006, 0.01, 0.022] },
      { theta: 27, back: 8, width: 3.6, color: [0.007, 0.011, 0.02] },
      { theta: 118, back: 6, width: 4, color: [0.005, 0.008, 0.018] },
      { theta: -105, back: 6, width: 4.5, color: [0.005, 0.008, 0.018] },
      { theta: 190, back: 7, width: 4, color: [0.004, 0.007, 0.016] },
    ];
    for (const spec of shafts) {
      const theta = spec.theta * DEG;
      const r = pond.shoreRadius(theta) + spec.back;
      const shaft = new THREE.Mesh(shaftGeometry, glow(spec.color));
      shaft.position.set(r * Math.sin(theta), -0.4, -r * Math.cos(theta));
      shaft.scale.set(spec.width, 16, 1);
      // lean the sheet's long axis along the light, keep its face toward the pond
      shaft.rotation.set(0, -theta, 0);
      shaft.rotateX(-Math.atan2(Math.hypot(sunDir.x, sunDir.z), sunDir.y) * 0.35);
      shaft.renderOrder = 6;
      far.add(shaft);
    }
  }

  // The fence at the near edge of the meadow: posts and one rail, dark against the grass.
  {
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: fence(ctx), uniforms: { ...light.uniforms } }));
    const post = keep(new THREE.BoxGeometry(0.11, 1.15, 0.11));
    post.translate(0, 0.575, 0);
    const posts = 8;
    const from = MEADOW.theta - MEADOW.halfWidth * 0.86;
    const to = MEADOW.theta + MEADOW.halfWidth * 0.86;
    let previous = null;
    for (let k = 0; k < posts; k++) {
      const theta = from + ((to - from) * k) / (posts - 1);
      // close to the water, on the first rise of the bank, and not quite in line
      const r = pond.shoreRadius(theta) + 1.7 + rng.range(-0.12, 0.12);
      const here = new THREE.Vector3(r * Math.sin(theta), 0.2, -r * Math.cos(theta));
      const mesh = new THREE.Mesh(post, material);
      mesh.position.copy(here);
      mesh.rotation.set(rng.gauss() * 0.04, rng.range(0, 1.5), rng.gauss() * 0.04);
      far.add(mesh);
      if (previous) {
        for (const height of [0.5, 0.95]) {
          const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 0.11, here.distanceTo(previous) + 0.1)), material);
          rail.position.copy(here).add(previous).multiplyScalar(0.5);
          rail.position.y += height + rng.range(-0.03, 0.03);
          rail.lookAt(here.x, rail.position.y + rng.range(-0.04, 0.04), here.z);
          far.add(rail);
        }
      }
      previous = here;
    }
    // The big trunk that frames the clearing on its north side, right on the bank.
    const framing = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.42, 0.55, 22, 9, 1, true)), keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: trunk(ctx), uniforms: { ...light.uniforms } })));
    const ft = MEADOW.theta - MEADOW.halfWidth - 3 * DEG;
    const fr = pond.shoreRadius(ft) + 1.1;
    framing.position.set(fr * Math.sin(ft), 10.5, -fr * Math.cos(ft));
    framing.rotation.z = 0.03;
    far.add(framing);
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
