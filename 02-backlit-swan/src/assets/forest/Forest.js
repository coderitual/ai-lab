// The wood round the pond, the bank and the clearing.
//
// The film's surroundings are almost all darkness, a little out of focus:
// thick dark trunks, masses of foliage with clusters of sun-dappled leaves up
// to the left and right, a soft shaft of blue haze coming down behind the
// swan, and, to the north-east where the trees open, a hillside of grass in
// full sun with a fence at the top of its bank, framed by a big dark tree.
//
// It is built as a wood, not painted as a backdrop, so that it holds from
// every side of the pond and in the water:
//   trees.js     trunks, boughs and branches, one mesh
//   foliage.js   the dark masses of leaves and the lights in them
//   haze.js      the air: aerial perspective, what shows behind the last tree, the shafts
//   here         the ground, the clearing, the fence, and where everything stands
//
// What lights it is lighting.js: the sun's direction, and canopyLight(), the
// pattern of gaps the sun comes through. Nothing here has a lit side of its
// own; turn the sun and the whole wood follows.
//
// Everything is in the far scene, which is drawn small and thrown out of focus
// as a whole (FarLayer.js), once for the backdrop and once upside down for the
// water. `near` (things drawn sharp with the swan) stays empty.
//
// Compass angles here are radians, 0 north (-Z), PI/2 east (+X), as in pond.js.

import * as THREE from 'three';
import { createLimbs, growTree, limbGeometry } from './trees.js';
import { createFoliage } from './foliage.js';
import { createHaze, AIR_GLSL } from './haze.js';

const DEG = Math.PI / 180;
/**
 * Where the trees open onto the clearing, and how wide the gap is. Placed so
 * that the film's camera finds it where the film does: its lit grass comes
 * into the right of the picture after 8.5 s and fills the right third at 10.5 s.
 */
const MEADOW = { theta: 39 * DEG, halfWidth: 18 * DEG };

/** 1 in the clearing, 0 in the wood, with the last three tenths of the gap's half width between. */
function meadowShare(theta) {
  const d = Math.abs(Math.atan2(Math.sin(theta - MEADOW.theta), Math.cos(theta - MEADOW.theta)));
  const t = Math.min(Math.max((d - MEADOW.halfWidth * 0.7) / (MEADOW.halfWidth * 0.3), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The lie of the land under the trees: [metres behind the shore, height]. Nearly level. */
const PROFILE = [
  [-4, -0.5],
  [-1.5, -0.15],
  [0, 0.02],
  [2, 0.25],
  [6, 0.45],
  [14, 0.6],
  [30, 0.8],
  [52, 1.2],
];

/**
 * Height of the ground. Under the trees it barely rises. The clearing is a
 * hillside: a bank of bare earth 1.15 m high at the water, then grass rising
 * another 6 m over the next thirty. (In the film the grass fills the picture's
 * right edge to the very top, far above the horizon: the ground must climb.)
 * @param {number} theta compass direction from the pond's centre
 * @param {number} back metres behind the shore (negative: in the pond)
 */
function groundHeight(theta, back) {
  let i = 0;
  while (i < PROFILE.length - 2 && back > PROFILE[i + 1][0]) i++;
  const [b0, h0] = PROFILE[i];
  const [b1, h1] = PROFILE[i + 1];
  const base = h0 + (h1 - h0) * Math.min(Math.max((back - b0) / (b1 - b0), 0), 1);
  return base + meadowShare(theta) * (1.15 * smooth(0, 2.4, back) + 6.0 * smooth(2, 34, back));
}

const WORLD_VERTEX = /* glsl */ `
out vec3 vWorldPos;
out vec3 vNormal;
void main() {
  vWorldPos = position;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const ground = (ctx) => /* glsl */ `
${ctx.light.glsl}
${ctx.pond.glsl}
${AIR_GLSL}
in vec3 vWorldPos;
void main() {
  vec2 xz = vWorldPos.xz;
  float theta = atan(xz.x, -xz.y);
  float off = abs(atan(sin(theta - ${MEADOW.theta.toFixed(4)}), cos(theta - ${MEADOW.theta.toFixed(4)})));
  float back = shoreDistance(xz);
  // the same share as meadowShare() above
  float open = 1.0 - smoothstep(${(MEADOW.halfWidth * 0.7).toFixed(4)}, ${MEADOW.halfWidth.toFixed(4)}, off);

  // Under the trees: leaf litter in shade, with flecks of sun where the canopy
  // has a gap. None near the water: the bank is the darkest line in the picture.
  float flecks = canopyLight(vWorldPos) * smoothstep(2.5, 8.0, back);
  vec3 litter = vec3(0.02, 0.019, 0.012) * (uSkyColor * 0.4 + uAmbient + uSunColor * (0.3 * flecks));
  // (the bed of the pond's last metres, which shows through the water's faded edge: black)
  litter *= smoothstep(-0.6, 0.4, back);

  // The clearing. Grass in low sun is yellow, not green (234, 209, 57 on
  // screen in the film): long blades lit from behind and through. It is open
  // to the sun; the trees at its edge lay shadows across it (the same pattern
  // of gaps as everywhere, here four fifths open), and grass in shadow keeps
  // an eighth of its light (92, 88, 24 in the film).
  vec2 q = acrossSun(vWorldPos);
  float sunny = smoothstep(0.33, 0.45, valueNoise(q * 0.21 + 1.7) * 0.6 + valueNoise(q * 0.7 + 8.1) * 0.4);
  vec3 grass = vec3(0.19, 0.165, 0.014) * uSunColor * (0.55 + 0.9 * fbm(xz * 0.45, 3)) * mix(0.13, 1.0, sunny);
  // Bare red-brown earth between the water and the grass: the face of the
  // bank, turned away from the sun and dim, and the path along its top (74,
  // 51, 29 in the film). Its upper edge wanders.
  float earthy = 1.0 - smoothstep(2.3, 3.3, back + 0.5 * sin(theta * 23.0) + 0.8 * (fbm(xz * 1.3, 2) - 0.5));
  vec3 earth = vec3(0.04, 0.0135, 0.0085) * uSunColor * (0.6 + 0.6 * fbm(xz * 1.7, 2)) * mix(0.16, 0.5, smoothstep(1.3, 2.5, back)) * mix(0.3, 1.0, sunny);
  vec3 meadow = mix(grass, earth, earthy);

  // the clearing begins at the shore: what is under the water's faded edge stays dark
  vec3 color = mix(litter, meadow, open * smoothstep(-0.2, 0.5, back));
  outColor = toTarget(vec4(throughHaze(color, vWorldPos), 1.0));
}
`;

const bark = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  // Bark is dark and streaked up and down. The sun finds it only where the
  // canopy has a gap and only on the side that faces it: from the film's side
  // of the pond that is a thin lit edge here and there, from the other side
  // flecks of sun on the trunks.
  float streak = valueNoise(vec2(dot(vWorldPos.xz, vec2(7.0, 5.0)), vWorldPos.y * 0.9));
  vec3 color = vec3(0.034, 0.028, 0.02) * (0.5 + streak) * (uSunColor * (sunWrap(n, 0.0) * canopyLight(vWorldPos) * 0.5) + fillLight(n) * 0.3);
  outColor = toTarget(vec4(throughHaze(color, vWorldPos), 1.0));
}
`;

// Weathered wood in the open: in silhouette against the grass, the sun
// catching the tops of the rails and pales as thin bright lines (251, 228,
// 124 on screen in the film), the faces lit by what comes back off the grass
// (40, 38, 24).
const fence = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light = uSunColor * max(dot(n, uSunDir), 0.0) + fillLight(n) * 0.25 + uSunColor * vec3(0.006, 0.0045, 0.0006);
  outColor = toTarget(vec4(throughHaze(vec3(0.62, 0.43, 0.17) * light, vWorldPos), 1.0));
}
`;

/**
 * @param {object} ctx the shared context (see World.js); uses ctx.quality.counts.trunks, .sprays and .leaves,
 *   and LOOK.shadeDapple, .shadeDappleSize, .canopyOpen, .haze, .shafts, .leafLight through ctx.look
 * @returns {{ far: THREE.Group, near: THREE.Group, update: (dt: number, time: number, camera: THREE.Camera) => void, dispose: () => void }}
 */
export function createForest(ctx) {
  const rng = ctx.rng.fork('forest');
  const { pond, light, look } = ctx;
  const far = new THREE.Group();
  far.name = 'forest-far';
  const near = new THREE.Group();
  near.name = 'forest-near';
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
  /** The wood's own uniforms: see AIR_GLSL in haze.js. */
  const uniforms = { uWood: { value: new THREE.Vector4(1, 1, 1, 0) } };
  /** The quality tier as a number, from the trunks it affords: 0 low, 1 medium, 2 high. */
  const detail = ctx.quality.counts.trunks >= 200 ? 2 : ctx.quality.counts.trunks >= 120 ? 1 : 0;
  const at = (theta, back) => {
    const r = pond.shoreRadius(theta) + back;
    return { x: r * Math.sin(theta), y: groundHeight(theta, back), z: -r * Math.cos(theta) };
  };

  // The ground: rings from just inside the shore (under the water's faded
  // edge) out to the wall behind the wood (haze.js).
  {
    const backs = [-4, -1.5, 0, 0.8, 1.6, 2.4, 3.5, 6, 9, 13, 18, 24, 32, 42, 52];
    const segments = 128;
    const positions = [];
    const indices = [];
    for (const back of backs) {
      for (let i = 0; i <= segments; i++) {
        const p = at((i / segments) * Math.PI * 2, back);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let j = 0; j < backs.length - 1; j++) {
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
        uniforms: { ...light.uniforms, ...uniforms },
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wood-ground';
    mesh.frustumCulled = false;
    far.add(mesh);
  }

  // Where the trees stand.
  /** @type {{ theta: number, back: number, girth: number, height: number, kind: 'edge' | 'inner' | 'framing' }[]} */
  const spots = [
    // The trees the film shows. Two thick trunks on the bank with the shaft of
    // light coming down between them, behind the swan...
    { theta: -7.5 * DEG, back: 2.2, girth: 0.34, height: 21, kind: 'edge' },
    { theta: 5.5 * DEG, back: 3.0, girth: 0.3, height: 19, kind: 'edge' },
    // ...and the big dark tree at the near side of the clearing, two stems of it, that frames the grass.
    { theta: MEADOW.theta - MEADOW.halfWidth - 1.5 * DEG, back: 1.6, girth: 0.46, height: 23, kind: 'framing' },
    { theta: MEADOW.theta - MEADOW.halfWidth + 1.5 * DEG, back: 2.6, girth: 0.36, height: 20, kind: 'framing' },
  ];
  {
    const count = ctx.quality.counts.trunks;
    const places = spots.map((s) => at(s.theta, s.back));
    for (let tries = 0; spots.length < count && tries < count * 30; tries++) {
      const theta = rng.range(0, Math.PI * 2);
      // crowded near the bank, thinning out behind
      const back = 1.2 + 34 * Math.pow(rng.float(), 1.7);
      // none in the clearing, but the wood closes again at the top of its hill
      if (meadowShare(theta) > 0.02 && back < 27) continue;
      const p = at(theta, back);
      if (places.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.1)) continue;
      places.push(p);
      spots.push({ theta, back, girth: rng.range(0.12, 0.38), height: rng.range(13, 24), kind: back < 4.5 ? 'edge' : 'inner' });
    }
  }

  // Grow them, and collect where their leaves belong.
  /** @type {Parameters<typeof createFoliage>[1]['clumps']} */
  const clumps = [];
  {
    const limbs = createLimbs();
    const treeRng = rng.fork('trees');
    for (const spot of spots) {
      const p = at(spot.theta, spot.back);
      const r = Math.hypot(p.x, p.z);
      // its light is the pond; for the trees that frame the clearing, the clearing
      const toward = spot.kind === 'framing' ? [Math.cos(spot.theta), Math.sin(spot.theta)] : [-p.x / r, -p.z / r];
      const anchors = growTree(limbs, treeRng, { ...spot, ...p, toward, detail });
      for (const anchor of anchors) {
        // leaves do not hang in the water
        anchor.y = Math.max(anchor.y, 0.5 + anchor.size * 0.3);
        // The lights go where the picture is: eight parts to the boughs of
        // the trees on the bank, two and a half to boughs further in, and
        // little to the crowns, which are mostly above it.
        const lights = !anchor.low ? 0.6 : anchor.edge ? 8 : 2.5;
        clumps.push(spot.kind === 'framing' && anchor.low ? { ...anchor, size: anchor.size * 1.3, rank: 0, lights } : { ...anchor, lights });
      }
    }
    const geometry = keep(limbGeometry(limbs));
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: bark(ctx), uniforms: { ...light.uniforms, ...uniforms } }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wood-trees';
    mesh.frustumCulled = false;
    far.add(mesh);
  }

  // Undergrowth: bushes all along the bank, some hanging over the water. They
  // are in the wood's own shade (a third of the sun at most): a dark edge
  // where the wood meets the pond, which is also what hides the feet of the
  // trunks. Few and low where the clearing's bank is bare earth.
  {
    const bushRng = rng.fork('bushes');
    const bushes = [56, 80, 104][detail];
    for (let i = 0; i < bushes; i++) {
      const theta = ((i + bushRng.float()) / bushes) * Math.PI * 2;
      const open = meadowShare(theta);
      if (open > 0.5 && bushRng.float() < 0.7) continue;
      const back = bushRng.range(-0.3, 2.4);
      const p = at(theta, back);
      const size = bushRng.range(0.6, 1.3) * (1 - 0.4 * open);
      clumps.push({ x: p.x, y: Math.max(p.y, 0) + size * bushRng.range(0.5, 1.4), z: p.z, size, low: true, shade: 0.35, rank: 0, lights: 1.5 });
    }
  }

  for (const mesh of createFoliage(ctx, { clumps, uniforms, keep })) far.add(mesh);
  for (const mesh of createHaze(ctx, { uniforms, groundHeight, keep })) far.add(mesh);

  // The fence along the top of the clearing's bank: posts and two rails, and
  // at its near end, by the framing tree, a stretch of upright pales. One mesh.
  {
    const positions = [];
    const normals = [];
    const indices = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    /** A box of the given size, its middle at `centre`, turned by `q`. */
    const addBox = (centre, w, h, d) => {
      const box = new THREE.BoxGeometry(w, h, d).applyMatrix4(m.compose(centre, q, one));
      const first = positions.length / 3;
      positions.push(...box.attributes.position.array);
      normals.push(...box.attributes.normal.array);
      for (const index of box.index.array) indices.push(first + index);
      box.dispose();
    };
    const turn = new THREE.Euler();
    const posts = 8;
    const from = MEADOW.theta - MEADOW.halfWidth * 0.9;
    const to = MEADOW.theta + MEADOW.halfWidth * 0.82;
    let previous = null;
    for (let k = 0; k < posts; k++) {
      const theta = from + ((to - from) * k) / (posts - 1);
      // on the path at the top of the bank, and not quite in line
      const here = new THREE.Vector3().copy(at(theta, 3.0 + rng.range(-0.15, 0.15)));
      q.setFromEuler(turn.set(rng.gauss() * 0.04, rng.range(0, 1.5), rng.gauss() * 0.04));
      addBox(new THREE.Vector3(here.x, here.y + 0.5, here.z), 0.11, 1.2, 0.11);
      if (previous) {
        const span = here.distanceTo(previous);
        const along = Math.atan2(here.x - previous.x, here.z - previous.z);
        for (const height of [0.45, 0.9]) {
          const middle = new THREE.Vector3().addVectors(here, previous).multiplyScalar(0.5);
          middle.y += height + rng.range(-0.03, 0.03);
          // a rail lies along the line between its posts, and follows the ground up or down
          q.setFromEuler(turn.set(-Math.atan2(here.y - previous.y, span) + rng.gauss() * 0.02, along, 0, 'YXZ'));
          addBox(middle, 0.05, 0.11, span + 0.1);
        }
        // pales in the first two bays: weathered, none quite upright or the same height
        if (k <= 2) {
          const pales = Math.round(span / 0.27);
          for (let j = 1; j < pales; j++) {
            const t = j / pales;
            const foot = new THREE.Vector3().lerpVectors(previous, here, t);
            const tall = 1.0 + rng.range(-0.12, 0.08);
            q.setFromEuler(turn.set(rng.gauss() * 0.05, along, rng.gauss() * 0.06, 'YXZ'));
            addBox(new THREE.Vector3(foot.x, foot.y + tall * 0.5 + 0.03, foot.z), 0.085, tall, 0.03);
          }
        }
      }
      previous = here;
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    const material = keep(ctx.createMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: fence(ctx), uniforms: { ...light.uniforms, ...uniforms } }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wood-fence';
    mesh.frustumCulled = false;
    far.add(mesh);
  }

  return {
    far,
    near,
    /** Nothing here moves by itself: the shaders read the clock. This hands the wood's numbers of the look to them. */
    update(dt, time) {
      // The leaves that break the edge of the wood's shadow are this wood's:
      // it tells the light how broken the edge is, how open the canopy, and
      // what time it is for the stirring of the leaves (lighting.js, uDapple).
      light.uniforms.uDapple.value.set(look.shadeDapple, 1 / Math.max(0.05, look.shadeDappleSize), look.canopyOpen, time);
      uniforms.uWood.value.set(look.haze, look.shafts, look.leafLight, 0);
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
