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
 * Where the trees open onto the clearing: from the big dark tree that frames
 * it for the film (`near`) round to `far`, compass radians. Placed so that the
 * film's camera finds it where the film does at 10.5 s: that tree three
 * quarters of the way across the picture, the fence beside it, sunlit grass
 * from there to the right edge. The near edge is abrupt (the grass is bright
 * right beside the trunk, over `nearEdge`), the far one eases into the wood
 * (over `farEdge`). The near edge does not run straight out from the pond's
 * middle: it follows the film camera's line of sight past that tree (the
 * camera stands 4 m south of the middle), which swings it toward the north by
 * `skew` radians for every metre behind the shore; otherwise the camera would
 * see the wood close over the grass behind the tree.
 */
const MEADOW = { near: 21.5 * DEG, far: 51 * DEG, nearEdge: 2.4 * DEG, farEdge: 6 * DEG, skew: 0.18 * DEG };
/** The hill the clearing lies on reaches this much further round under the trees on either side. */
const HILL_FLANK = 16 * DEG;
/**
 * The lane behind the swan as the film's camera sees it: between these compass
 * directions no tree stands nearer the shore than `depth` metres, except the
 * two the film shows at its sides, and there are no bushes on the bank where
 * the main shaft of light (haze.js) comes down in it.
 */
const LANE = { from: -6.5 * DEG, to: 4 * DEG, depth: 13 };
/** Whether a compass direction (any multiple of a turn) is in the lane. */
function inLane(theta) {
  const t = Math.atan2(Math.sin(theta), Math.cos(theta));
  return t > LANE.from && t < LANE.to;
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** A compass direction as -PI .. PI (the clearing does not straddle due south, so it can be compared as a number). */
const compass = (theta) => Math.atan2(Math.sin(theta), Math.cos(theta));

/** Where the clearing's near edge is, this many metres behind the shore. */
const nearEdgeAt = (back) => MEADOW.near - MEADOW.skew * Math.min(Math.max(back, 0), 30);

/** 1 in the clearing, 0 in the wood. */
function meadowShare(theta, back) {
  const t = compass(theta);
  const near = nearEdgeAt(back);
  return smooth(near - MEADOW.nearEdge * 0.5, near + MEADOW.nearEdge * 0.5, t) * (1 - smooth(MEADOW.far - MEADOW.farEdge, MEADOW.far, t));
}

/**
 * The hill the clearing lies on is wider than the clearing: 1 across the
 * whole gap, falling to 0 over HILL_FLANK on either side. Its flanks are under
 * the trees, so the lit grass ends at trunks and shadows, not at the outline
 * of a mound.
 */
function hillShare(theta, back) {
  const t = compass(theta);
  const near = nearEdgeAt(back);
  return smooth(near - HILL_FLANK, near, t) * (1 - smooth(MEADOW.far, MEADOW.far + HILL_FLANK, t));
}

/**
 * How much sun is getting into the wood, 0 .. 1. The film opens with the wood
 * dark and quiet (two pixels in ten thousand of its upper half are lit leaf at
 * 0.3 s) and over the next six seconds the leaves light up (1 in a hundred at
 * 2.5 s, 3 at 4.6 s, 8 by 6.5 s) and the shaft brightens and greens, while the
 * swan in the open is in full sun all along: mist in the crowns, thinning.
 * Here it thins like that from the start (a twenty-fifth of the sun for the
 * first BREATH_RISE[0] seconds, all of it from BREATH_RISE[1]), stays thin,
 * and closes in and opens again once every BREATH_PERIOD seconds. Only the
 * wood's own leaves and shafts follow it; the sun itself (lighting.js) does
 * not change.
 */
const BREATH_PERIOD = 52;
const BREATH_RISE = [1.5, 7];
function woodBreath(time) {
  const sinceDip = Math.abs(((time + BREATH_PERIOD / 2) % BREATH_PERIOD) - BREATH_PERIOD / 2);
  return 0.04 + 0.96 * smooth(BREATH_RISE[0], BREATH_RISE[1], sinceDip);
}

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
 * hillside: a bank of bare earth at the water, between 0.7 and 1.0 m high
 * (worn down in places, never a level wall), then grass rising another 6 m
 * over the next thirty (hillShare: the hill is wider than the gap in the
 * trees). In the film the grass fills the picture's right edge far above the
 * horizon: the ground must climb.
 * @param {number} theta compass direction from the pond's centre
 * @param {number} back metres behind the shore (negative: in the pond)
 */
function groundHeight(theta, back) {
  let i = 0;
  while (i < PROFILE.length - 2 && back > PROFILE[i + 1][0]) i++;
  const [b0, h0] = PROFILE[i];
  const [b1, h1] = PROFILE[i + 1];
  const base = h0 + (h1 - h0) * Math.min(Math.max((back - b0) / (b1 - b0), 0), 1);
  const bank = 0.85 + 0.1 * Math.sin(theta * 23 + 0.7) + 0.05 * Math.sin(theta * 61 + 2.1);
  return base + meadowShare(theta, back) * bank * smooth(0, 3.0, back) + hillShare(theta, back) * 6.0 * smooth(2, 34, back);
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
  float back = shoreDistance(xz);
  // the same shares as meadowShare() and hillShare() above
  float near = ${MEADOW.near.toFixed(4)} - ${MEADOW.skew.toFixed(6)} * clamp(back, 0.0, 30.0);
  float open = smoothstep(near - ${(MEADOW.nearEdge * 0.5).toFixed(4)}, near + ${(MEADOW.nearEdge * 0.5).toFixed(4)}, theta) * (1.0 - smoothstep(${(MEADOW.far - MEADOW.farEdge).toFixed(4)}, ${MEADOW.far.toFixed(4)}, theta));
  float hill = smoothstep(near - ${HILL_FLANK.toFixed(4)}, near, theta) * (1.0 - smoothstep(${MEADOW.far.toFixed(4)}, ${(MEADOW.far + HILL_FLANK).toFixed(4)}, theta));

  // Under the trees: leaf litter in shade, with flecks of sun where the canopy
  // has a gap. None near the water: the bank is the darkest line in the picture.
  float flecks = canopyLight(vWorldPos) * smoothstep(2.5, 8.0, back);
  vec3 litter = vec3(0.02, 0.019, 0.012) * (uSkyColor * 0.4 + uAmbient + uSunColor * (0.12 * flecks));
  // (the bed of the pond's last metres, which shows through the water's faded edge: black)
  litter *= smoothstep(-0.6, 0.4, back);

  // The clearing. Grass in low sun is yellow, not green (228, 215, 65 on
  // screen in the film, which is 0.81, 0.79, 0.09 before the print): long
  // blades lit from behind and through. Where it is
  // open to the sun, the trees round it still lay shadows across it (the same
  // kind of pattern as the canopy's, here four fifths open), and grass in such
  // a shadow keeps an eighth of its light (92, 88, 24 in the film). The wood's
  // own shadow closes over it at the far side and from the top of the hill,
  // where the trees stand against the sun, with the ragged outline of crowns:
  // there a twentieth is left. (At the near side the lit grass runs right up
  // to the framing tree, as in the film.)
  vec2 q = acrossSun(vWorldPos);
  float sunny = smoothstep(0.3, 0.42, valueNoise(q * 0.21 + 1.7) * 0.6 + valueNoise(q * 0.7 + 8.1) * 0.4);
  float ragged = (fbm(xz * 0.23 + 5.0, 2) - 0.5) * 2.0;
  float crowns = (fbm(xz * 0.6 + 9.0, 2) - 0.5) * 2.0;
  float clear = open * (1.0 - smoothstep(${(MEADOW.far - 12 * DEG).toFixed(4)}, ${(MEADOW.far - 5 * DEG).toFixed(4)}, theta + 0.07 * ragged)) * (1.0 - smoothstep(17.0, 27.0, back + 4.0 * ragged + 5.0 * crowns));
  // (tussocks and bare patches: grass is never one flat colour)
  float tussocks = (0.55 + 0.9 * fbm(xz * 0.45, 3)) * (0.78 + 0.44 * valueNoise(xz * 3.1));
  vec3 grass = vec3(0.2, 0.2, 0.024) * uSunColor * tussocks * mix(0.05, mix(0.13, 1.0, sunny), clear);
  // Bare red-brown earth between the water and the grass: the path along the
  // top of the bank (74, 51, 29 in the film) and the bank's face, which is
  // turned away from the sun and nearly as dark as the wood. Its upper edge
  // wanders.
  float earthy = 1.0 - smoothstep(2.3, 3.3, back + 0.5 * sin(theta * 23.0) + 0.8 * (fbm(xz * 1.3, 2) - 0.5));
  vec3 earth = vec3(0.04, 0.0135, 0.0085) * uSunColor * (0.6 + 0.6 * fbm(xz * 1.7, 2)) * mix(0.06, 0.75, smoothstep(1.4, 2.4, back)) * mix(0.3, 1.0, sunny) * mix(0.3, 1.0, clear);
  vec3 meadow = mix(grass, earth, earthy);

  // The clearing begins at the shore (what is under the water's faded edge
  // stays dark); the hill's flanks under the trees begin behind the bank.
  vec3 color = mix(litter, meadow, max(open, hill * smoothstep(2.5, 5.0, back)) * smoothstep(-0.2, 0.5, back));
  // The mist is under the trees. Over the open, sunlit grass the air is clear:
  // a quarter of the haze the same distance of wood would put in front of it.
  vec3 toEye = cameraPosition - vWorldPos;
  float dist = length(toEye);
  outColor = toTarget(vec4(mix(color, hazeGlow(toEye / dist), hazeAmount(dist) * (1.0 - 0.75 * clear)), 1.0));
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
  const uniforms = { uWood: { value: new THREE.Vector4(1, 1, 1, 1) } };
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
  /** @type {{ theta: number, back: number, girth: number, height: number, kind: 'edge' | 'inner' | 'framing', bare?: boolean, leafy?: boolean }[]} (see growTree in trees.js) */
  const spots = [
    // The trees the film shows. Two thick dark trunks on the bank with the
    // shaft of light coming down between them, behind the swan (bare: the
    // lane between them is for looking into the wood)...
    { theta: -7.5 * DEG, back: 2.2, girth: 0.25, height: 21, kind: 'edge', bare: true },
    { theta: 5.5 * DEG, back: 3.0, girth: 0.21, height: 19, kind: 'edge', bare: true },
    // ...the trees some way in whose leaves are the lit masses up to the left and right of the lane...
    { theta: -10 * DEG, back: 11, girth: 0.2, height: 17, kind: 'inner', leafy: true },
    { theta: -12.5 * DEG, back: 15, girth: 0.24, height: 20, kind: 'inner', leafy: true },
    { theta: -8 * DEG, back: 17, girth: 0.18, height: 18, kind: 'inner', leafy: true },
    { theta: 5.5 * DEG, back: 14, girth: 0.22, height: 19, kind: 'inner', leafy: true },
    { theta: 7.5 * DEG, back: 11, girth: 0.19, height: 16, kind: 'inner', leafy: true },
    { theta: 9.5 * DEG, back: 16, girth: 0.25, height: 20, kind: 'inner', leafy: true },
    // ...and the big dark tree at the near side of the clearing, two stems of it, that frames the grass.
    { theta: MEADOW.near, back: 1.5, girth: 0.22, height: 23, kind: 'framing' },
    { theta: MEADOW.near - 3 * DEG, back: 2.6, girth: 0.2, height: 20, kind: 'framing' },
  ];
  {
    const count = ctx.quality.counts.trunks;
    const places = spots.map((s) => at(s.theta, s.back));
    for (let tries = 0; spots.length < count && tries < count * 30; tries++) {
      // (from -PI to PI, like every compass angle that is compared with another here)
      const theta = rng.range(-Math.PI, Math.PI);
      // crowded near the bank, thinning out behind
      const back = 1.2 + 34 * Math.pow(rng.float(), 1.7);
      // none in the clearing, but the wood closes again at the top of its hill
      if (meadowShare(theta, back) > 0.02 && back < 28) continue;
      // and none in the lane behind the swan, where the film looks into the wood and the shaft stands
      if (theta > LANE.from && theta < LANE.to && back < LANE.depth) continue;
      const p = at(theta, back);
      if (places.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.1)) continue;
      places.push(p);
      // From nine metres behind the shore, for fifteen metres, every other
      // tree is in leaf from low down: these carry the lit masses (see `shade` below).
      const leafy = rng.float() < 0.5 && back > 9 && back < 24;
      spots.push({ theta, back, girth: rng.range(0.12, 0.38), height: rng.range(13, 24), kind: back < 4.5 ? 'edge' : 'inner', leafy });
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
        // Where the sun gets at the leaves. Not on the bank: the trees and
        // bushes at the water are the dark front of the wood (a fifth of the
        // sun at most), and the lit masses are on the trees behind them, seen
        // over and between them. That is depth, and it is also what keeps the
        // water dark: in the film the lit leaves reach the top of the picture
        // but the water in front of the swan hardly mirrors them, which a
        // dark bank does by standing in front of their mirror image (the
        // further back they are, the more of it). And low in the wood, for
        // the same reason: all of the sun up to 5 m, a sixth of it from 9 m,
        // and a quarter of that in the crowns.
        const deep = smooth(6, 9, spot.back);
        const shade = (0.2 + 0.8 * deep) * (anchor.low ? 1 : 0.25) * (1 - (5 / 6) * smooth(5, 9, anchor.y));
        // The leaf lights go where the lit leaves are: eight parts to those
        // boughs, two to the boughs of the bank, and little to the crowns.
        const lights = !anchor.low ? 0.6 : deep > 0.5 ? 8 : 2;
        clumps.push(spot.kind === 'framing' && anchor.low ? { ...anchor, size: anchor.size * 1.3, rank: 0, lights, shade } : { ...anchor, lights, shade });
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
  // are in the wood's own shade (a fifth of the sun at most): a dark edge
  // where the wood meets the pond, which is also what hides the feet of the
  // trunks. Few and low where the clearing's bank is bare earth.
  {
    const bushRng = rng.fork('bushes');
    const bushes = [56, 80, 104][detail];
    for (let i = 0; i < bushes; i++) {
      const theta = ((i + bushRng.float()) / bushes) * Math.PI * 2;
      const open = meadowShare(theta, 0);
      // (in the clearing: only tufts at the foot of the bank)
      const tuft = open > 0.3;
      const back = tuft ? bushRng.range(-0.3, 0.5) : bushRng.range(-0.3, 2.4);
      // (none in the mouth of the lane: the glow of the film's shaft reaches the waterline)
      if (inLane(theta)) continue;
      const p = at(theta, back);
      const size = bushRng.range(0.45, 1.0) * (tuft ? 0.55 : 1);
      clumps.push({ x: p.x, y: Math.max(p.y, 0) + size * bushRng.range(0.4, 1.1), z: p.z, size, low: true, shade: 0.2, rank: 0, lights: 1.5 });
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
    const from = MEADOW.near + 1.2 * DEG;
    const to = MEADOW.far - 4 * DEG;
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
      uniforms.uWood.value.set(look.haze, look.shafts, look.leafLight, woodBreath(time));
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
