// Leaves: the dark masses of the wood and the lights in them.
//
// Out of focus, foliage is two things. Most of it is mass: clumps of leaves in
// shade, nearly black, that hide whatever is behind them. And where the sun
// comes through the canopy, leaves lit from behind glow yellow-olive: a dim
// glowing mass with small, much brighter lights in it, each one a leaf turned
// just right. So it is drawn as two things:
//
//  - Sprays: flat cards hung where a tree has leaves (the ends of boughs, the
//    crown, the bushes of the bank). The fragment stage cuts a ragged clump of
//    leaves out of each card and holes between the leaves, and lights the
//    leaves the sun reaches. They are solid: a spray in front hides the lights
//    behind it, and as the camera moves the lights come and go in its holes.
//  - Lights: one soft point per leaf, added on top, far brighter than white
//    for a few of them. The defocus turns each into a small soft disc.
//
// Which leaves the sun reaches is not decided here: it is canopyLight() of
// lighting.js, a pattern laid across the sunlight, so the lit clumps are the
// same for the sprays and the lights, come in patches the size of a gap
// between crowns, and move through the wood when the sun is turned.
//
// The cards do not turn to the camera. Each faces the middle of the pond,
// give or take: the camera never leaves the water, so it never sees one edge-on.

import * as THREE from 'three';
import { AIR_GLSL } from './haze.js';

const SPRAY_VERTEX = (ctx) => /* glsl */ `
${ctx.light.glsl}
in vec4 aSpray;   // seed, leaf blobs across half the card, share of the sun this clump can get, unused
out vec2 vCard;   // -1 .. 1 across the card
out vec4 vSpray;
out vec3 vWorldPos;
out float vLight;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vCard = position.xy;
  vSpray = aSpray;
  vWorldPos = world.xyz;
  // (where the wood's shadow does not reach, on the bank across the pond from
  // the sun, every clump is in the open: the sun comes at it over the water)
  vLight = canopyLight(world.xyz) * max(aSpray.z, sunReach(world.xyz));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// What a leaf does with the sun, as shares of uSunColor: seen against the
// light it glows with what passes through it, yellow-olive (on screen in the
// film the lit foliage averages 81, 89, 45, its brighter tenth 151, 154, 88);
// seen with the light it only reflects, greener and a third as bright.
const LEAF_GLSL = /* glsl */ `
vec3 leafGlow(vec3 toEye) {
  float against = dot(-toEye, uSunDir);
  return uSunColor * mix(vec3(0.026, 0.04, 0.011), vec3(0.085, 0.087, 0.036), smoothstep(-0.25, 0.55, against));
}
`;

const SPRAY_FRAGMENT = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
${LEAF_GLSL}
uniform float uTime;
in vec2 vCard;
in vec4 vSpray;
in vec3 vWorldPos;
in float vLight;
void main() {
  float seed = vSpray.x;
  // The outline of the clump: a ragged blob, never the square.
  float inside = 1.0 - dot(vCard, vCard) + (valueNoise(vCard * 2.3 + seed * 37.0) - 0.5) * 1.1;
  if (inside < 0.1) discard;

  // Leaves and the gaps between them: blobs a leaf across, gathered in
  // bunches of a few, laid at a different angle on every card (no grid, no
  // two cards alike). A quarter of the card is leaf at its ragged edge, three
  // quarters in its middle.
  float c = cos(seed * 6.2832), s = sin(seed * 6.2832);
  vec2 g = mat2(c, s, -s, c) * vCard * vSpray.y + seed * 91.0;
  float bunch = valueNoise(g * 0.31 + 19.0);
  float leafy = valueNoise(g) * 0.4 + valueNoise(g * 0.62 + 3.0) * 0.35 + bunch * 0.25;
  if (leafy < mix(0.6, 0.4, smoothstep(0.1, 0.8, inside))) discard;

  vec3 toEye = normalize(cameraPosition - vWorldPos);
  // In shade a leaf is nearly black: a little of the sky on it, and of the
  // sun that is scattered about under the trees.
  vec3 color = vec3(0.019, 0.019, 0.012) * (0.6 + 0.8 * bunch) * (uSkyColor * 0.45 + uSunColor * 0.012);

  // The sun does not light a clump evenly. It comes through the leaves above
  // in pools about a third of the clump across. In a pool most leaves are
  // still dark: one behind another, or edge-on to the light. One in four
  // glows, each by itself (a fleck one leaf across, a little likelier where
  // the leaves bunch), and how it is turned decides how much: most a little,
  // a few with nearly all the sun, brighter than the film's white. So lit
  // foliage is a sparkle of small lights on a dark mass with a dim olive glow
  // under it (the many leaves further in), which is how the film's reads; an
  // even wash of lit leaf looks like lichen. The leaves stir, by a tenth of
  // their light.
  float pool = valueNoise(vCard * 1.7 + seed * 53.0);
  float sun = smoothstep(0.55, 0.8, vLight * (0.1 + 1.5 * pool));
  float turned = valueNoise(g + 71.0);
  float glow = smoothstep(0.66, 0.94, turned + 0.3 * (bunch - 0.5));
  glow = 0.07 + 4.2 * glow * glow;
  float stir = 0.9 + 0.1 * sin(uTime * (0.5 + 1.2 * bunch) + turned * 40.0);
  color += leafGlow(toEye) * (sun * glow * stir * uWood.z * uWood.w);
  outColor = toTarget(vec4(throughHaze(color, vWorldPos), 1.0));
}
`;

const LIGHT_VERTEX = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
${LEAF_GLSL}
uniform float uTime;
uniform vec2 uResolution;
in vec4 aLeaf;    // width (metres), brightness, seed, share of the sun this clump can get
out vec3 vColor;
void main() {
  vec3 toEye = cameraPosition - position;
  float dist = length(toEye);
  toEye /= dist;
  // lit only where the canopy lets the sun through; at the edge of a patch, some are and some are not
  float lit = smoothstep(0.35, 0.65, canopyLight(position) * max(aLeaf.w, sunReach(position)) + (aLeaf.z - 0.5) * 0.5);
  // every leaf stirs in its own time, a fifth of its light at most
  float stir = 0.8 + 0.2 * sin(uTime * (0.5 + 1.3 * aLeaf.z) + aLeaf.z * 50.0);
  vec3 color = leafGlow(toEye) * (aLeaf.y * lit * stir * uWood.z * uWood.w * (1.0 - hazeAmount(dist)));

  vec4 view = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  // The leaf's width in pixels of whatever is being drawn. It is drawn as a
  // soft point 2.6 times that wide and never under 3 pixels, with the same
  // light in all: a leaf smaller than a pixel then neither vanishes nor
  // flickers as the camera moves, it only grows dimmer.
  float px = aLeaf.x * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-view.z, 0.1);
  float size = max(px * 2.6, 3.0);
  // (6: a disc with the falloff of the fragment stage holds a sixth of the light of a plain one)
  vColor = color * (6.0 * px * px / (size * size));
  gl_PointSize = size;
  // leaves in shade give no light: do not draw them at all
  if (lit * uWood.w < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const LIGHT_FRAGMENT = /* glsl */ `
in vec3 vColor;
void main() {
  float fall = max(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0);
  outColor = toTarget(vec4(vColor * fall * fall, 1.0));
}
`;

/**
 * @param {object} ctx the shared context; uses ctx.quality.counts.sprays and .leaves
 * @param {object} options
 * @param {{ x: number, y: number, z: number, size: number, low: boolean, shade?: number, rank?: number, lights?: number }[]} options.clumps
 *   where leaves belong. size: radius of the clump (m); shade: share of the sun it can get (default 1);
 *   rank: 0 first in line for sprays when there are not enough for all (default: 1 on a bough, 3 in a crown);
 *   lights: its share of the leaf lights, per metre of its size (default 1)
 * @param {object} options.uniforms the wood's own uniforms (uWood)
 * @param {(thing: any) => any} options.keep registers something to dispose of
 * @returns {THREE.Object3D[]} meshes for the far scene
 */
export function createFoliage(ctx, { clumps, uniforms, keep }) {
  const rng = ctx.rng.fork('foliage');
  const meshes = [];
  const fromCentre = (c) => Math.hypot(c.x, c.z);

  // --- sprays
  {
    const budget = ctx.quality.counts.sprays;
    /** The low tier, told by its budget of sprays. */
    const coarse = budget < 1400;
    // Two to a clump on the boughs (one behind the other gives the lights
    // something to hide behind), one in a crown. Where the budget does not
    // reach, the crowns go without first: they are mostly above the picture.
    const wanted = [];
    for (const clump of clumps) {
      const rank = clump.rank ?? (clump.low ? 1 : 3);
      wanted.push({ clump, rank });
      if (clump.low) wanted.push({ clump, rank: rank + 1 });
    }
    // (sort is stable: within a rank the order of the clumps, which is the order the trees were grown in, stays)
    wanted.sort((a, b) => a.rank - b.rank);
    const sprays = wanted.slice(0, budget).map(({ clump }) => {
      const out = clump.size * rng.range(0.1, 0.7);
      const around = rng.range(0, Math.PI * 2);
      return {
        x: clump.x + Math.sin(around) * out,
        y: clump.y + rng.gauss() * clump.size * 0.3,
        z: clump.z + Math.cos(around) * out,
        half: clump.size * rng.range(0.9, 1.3),
        shade: clump.shade ?? 1,
      };
    });
    // Nearest the pond first: what is in front is drawn first, and what it
    // hides is then not shaded at all.
    sprays.sort((a, b) => fromCentre(a) - fromCentre(b));

    const geometry = keep(new THREE.PlaneGeometry(2, 2));
    const material = keep(
      ctx.createMaterial({
        vertexShader: SPRAY_VERTEX(ctx),
        fragmentShader: SPRAY_FRAGMENT(ctx),
        uniforms: { ...ctx.uniforms, ...ctx.light.uniforms, ...uniforms },
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(sprays.length, 1));
    const data = new Float32Array(Math.max(sprays.length, 1) * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const turn = new THREE.Euler();
    sprays.forEach((spray, i) => {
      const distance = fromCentre(spray);
      // facing the pond, give or take most of a right angle, and tipped either way
      const facing = Math.atan2(-spray.x, -spray.z) + rng.gauss() * 0.5;
      q.setFromEuler(turn.set(rng.gauss() * 0.35, facing, rng.range(0, Math.PI * 2), 'YXZ'));
      mesh.setMatrixAt(i, m.compose(p.set(spray.x, spray.y, spray.z), q, s.set(spray.half, spray.half * rng.range(0.75, 1.1), 1)));
      // Leaves 2.4 cm apart on the trees of the bank (3.6 cm on the low
      // tier, whose far layer is coarser), and wider apart in proportion
      // further back: nearly two texels of the far layer each, which is as
      // fine as it can show them without their turning into a shimmer.
      const spacing = (coarse ? 0.036 : 0.024) * Math.max(1, distance / 16);
      data.set([rng.float(), spray.half / spacing, spray.shade, 0], i * 4);
    });
    geometry.setAttribute('aSpray', new THREE.InstancedBufferAttribute(data, 4));
    mesh.count = sprays.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'wood-sprays';
    meshes.push(mesh);
  }

  // --- lights
  {
    const count = ctx.quality.counts.leaves;
    // Shared out among the clumps by where they are: the boughs over the bank
    // are what the picture shows, the crowns are mostly above it.
    const weight = (c) => (c.lights ?? 1) * c.size;
    const total = clumps.reduce((sum, c) => sum + weight(c), 0) || 1;
    const positions = new Float32Array(count * 3);
    const leaves = new Float32Array(count * 4);
    let i = 0;
    let owed = 0;
    for (const clump of clumps) {
      owed += (weight(clump) / total) * count;
      const shade = clump.shade ?? 1;
      for (; owed >= 1 && i < count; owed--, i++) {
        // a clump is wider than it is deep in leaves: a flattened cloud
        positions.set([clump.x + rng.gauss() * clump.size * 0.7, clump.y + rng.gauss() * clump.size * 0.45, clump.z + rng.gauss() * clump.size * 0.7], i * 3);
        // Most give a middling light; about one in eight is turned to pass
        // the sun straight on and is several times brighter than white: the
        // small hot points among the soft ones.
        const brightness = rng.float() < 0.13 ? rng.range(3, 9) : rng.range(0.35, 2.2);
        leaves.set([rng.range(0.025, 0.055), brightness, rng.float(), shade], i * 4);
      }
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLeaf', new THREE.BufferAttribute(leaves, 4));
    geometry.setDrawRange(0, i);
    const material = keep(
      ctx.createMaterial({
        vertexShader: LIGHT_VERTEX(ctx),
        fragmentShader: LIGHT_FRAGMENT,
        uniforms: { ...ctx.uniforms, ...ctx.light.uniforms, ...uniforms },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.name = 'wood-leaf-lights';
    meshes.push(points);
  }

  return meshes;
}
