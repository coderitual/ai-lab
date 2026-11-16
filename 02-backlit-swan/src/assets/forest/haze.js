// The air in the wood: haze, and the light that shows in it.
//
// Three things, all from the same few numbers:
//
//  - Aerial perspective. Every solid thing in the wood is seen through the
//    haze between it and the eye: the further back, the more of its own colour
//    is replaced by the glow of the air (AIR_GLSL, throughHaze). The glow is
//    blue from the sky everywhere and brighter and warmer when looking up the
//    sunlight, so the wood has a bright side and a dull side.
//  - What shows where there is nothing nearer: a wall far behind the last
//    trunks, the colour of all the haze there is, with the bars of still more
//    trunks faintly in it.
//  - Shafts: columns of lit haze under gaps in the canopy. Each is a strip
//    that stands along the sun's own direction (so they lean with the sun, all
//    pointing at it, and follow when it is turned or raised) and is turned
//    about that axis to face the eye. What is drawn on the strip is the same
//    from every side (a soft round column), so nothing is seen to turn.

import * as THREE from 'three';

const DEG = Math.PI / 180;

/**
 * The shafts: compass direction of the foot (degrees), metres behind the
 * shore, radius of the column (metres, where it has fallen to 1/e), strength.
 * The first is the film's: behind the swan as the film's camera sees it, down
 * the lane Forest.js keeps clear of trees and bushes for it (a strip like
 * this must not pass through leaves or trunks: where it does, the cut shows
 * as a straight edge). With the sun at 14 degrees it leans to the right going
 * up, so its foot is left of where its middle shows. The rest stand where the
 * camera finds them when it is taken round the pond; most are on the sun's
 * side, where the light comes in.
 */
const SHAFTS = [
  [-3.5, 3.5, 0.7, 0.8],
  [-27, 7.5, 0.75, 0.5],
  [16, 8.5, 1.1, 0.55],
  [-52, 6.5, 0.7, 0.4],
  [-80, 8, 0.9, 0.34],
  [78, 7, 0.8, 0.4],
  [104, 9, 1.0, 0.3],
  [-112, 7, 0.9, 0.3],
  [138, 8, 0.8, 0.24],
  [-146, 9, 1.0, 0.24],
  [172, 7, 0.85, 0.22],
];

/**
 * The haze's uniforms and functions, for any material in the wood.
 * uWood: x = how much the air glows, y = how strong the shafts are, z = how
 * bright sunlit leaves are (all 1 as designed: LOOK.haze, .shafts, .leafLight);
 * w = how much sun is getting into the wood just now, 0 .. 1 (woodBreath in
 * Forest.js). Needs ctx.light.glsl in front of it.
 */
export const AIR_GLSL = /* glsl */ `
uniform vec4 uWood;

// The glow of the hazy air, looking from the eye along -toEye. Blue light
// from the sky is scattered every way alike; sunlight mostly onward, so the
// air is brightest looked at against the light, and three times duller with
// the sun behind the eye. (Looking up the film's view, between the trunks:
// 0.0086, 0.0090, 0.0124, which the print shows as about 23, 26, 27.)
vec3 hazeGlow(vec3 toEye) {
  float up = towardSun(toEye);
  float onward = up * up;
  onward *= onward;
  return (uSkyColor * 0.016 + uSunColor * vec3(0.0018, 0.0016, 0.0019) * (0.15 + 1.7 * onward)) * uWood.x;
}

// How much of that glow has replaced a thing this far from the eye. Nothing
// for the first metres (the nearest trunks are the blackest things in the
// film), nearly all of it at the back of the wood.
float hazeAmount(float dist) {
  return 1.0 - exp(-max(dist - 13.0, 0.0) * 0.03);
}

vec3 throughHaze(vec3 color, vec3 worldPos) {
  vec3 toEye = cameraPosition - worldPos;
  float dist = length(toEye);
  return mix(color, hazeGlow(toEye / dist), hazeAmount(dist));
}
`;

const WALL_VERTEX = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const wallFragment = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
in vec3 vWorldPos;
void main() {
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  // Trunks further back than any that are built: upright bars of every width.
  // The pattern is laid on the ground plan (not round the compass), so it has
  // no seam anywhere.
  float bars = valueNoise(vWorldPos.xz * 0.83) * 0.6 + valueNoise(vWorldPos.xz * 2.9 + 31.0) * 0.4;
  float between = smoothstep(0.36, 0.62, bars);
  // darker overhead, where the crowns close
  float crowns = 1.0 - 0.55 * smoothstep(9.0, 34.0, vWorldPos.y);
  outColor = toTarget(vec4(hazeGlow(toEye) * (0.6 + 0.5 * between) * crowns, 1.0));
}
`;

const SHAFT_VERTEX = /* glsl */ `
uniform vec3 uSunDir;
in vec4 aShaft;  // foot x, foot y, foot z, radius
in vec4 aShaftB; // length, strength, seed, unused
out vec2 vShaft; // x: across, in radii; y: along, 0 at the foot .. 1 at the top
out vec3 vWorldPos;
out vec3 vParams; // strength, seed, how much deeper the column is for being seen at a slant
void main() {
  vec3 foot = aShaft.xyz;
  float len = aShaftB.x;
  vec3 middle = foot + uSunDir * len * 0.5;
  vec3 toEye = normalize(cameraPosition - middle);
  vec3 side = cross(uSunDir, toEye);
  float slant = max(length(side), 0.3);
  side /= max(length(side), 1.0e-4);
  // the column widens toward the ground and has a faint wide glow round it (see the fragment stage): the strip is wide enough for both
  float across = (uv.x * 2.0 - 1.0) * 6.5;
  vec3 world = foot + uSunDir * (uv.y * len) + side * (across * aShaft.w);
  vShaft = vec2(across, uv.y);
  vWorldPos = world;
  vParams = vec3(aShaftB.y, aShaftB.z, 1.0 / slant);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const shaftFragment = (ctx) => /* glsl */ `
${ctx.light.glsl}
${AIR_GLSL}
uniform float uTime;
in vec2 vShaft;
in vec3 vWorldPos;
in vec3 vParams;
void main() {
  float t = vShaft.y;
  float seed = vParams.y;
  // A beam through a hole in the leaves spreads on its way down: narrow and
  // bright under the canopy, a third wider and that much thinner at the
  // ground. Soft all the way out: a bell, never an edge.
  float spread = 1.4 - 0.4 * t;
  float x = vShaft.x / spread;
  float bell = exp(-x * x) / spread;
  // rays inside the beam: it is the light of many holes, not of one
  bell *= 0.62 + 0.76 * valueNoise(vec2(vShaft.x * 2.1 + seed * 17.0, seed * 5.0 + t * 0.6));
  // The air round the beam is lit by it too: a glow an eighth as strong and
  // three and a half times as wide, which is what makes the shaft a soft
  // thing among the trunks instead of a bar between two of them.
  bell += 0.13 * exp(-x * x / 12.0);
  // Strongest high up (measured: the film's shaft is 0.48 as bright at the
  // water as at the top of the picture; most of that is the colour below,
  // which grows toward the sun, the rest is this); it begins in the leaves
  // and ends at the ground without an end.
  float along = smoothstep(0.0, 0.04, t) * (0.7 + 0.3 * smoothstep(0.0, 0.45, t)) * (1.0 - smoothstep(0.7, 1.0, t));
  // haze drifting through the light, slowly
  float drift = 0.72 + 0.56 * valueNoise(vec2(t * 4.0 - uTime * 0.035 + seed * 3.0, seed * 9.0 + vShaft.x * 0.35 + uTime * 0.011));
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  float up = towardSun(toEye);
  // Mist scatters the blue of the light to the side and the rest onward: a
  // shaft seen from the side is blue, and greens and brightens steeply as the
  // eye comes round toward the sun (so it does toward the top of the picture,
  // where the eye looks up the light). That second part also comes and goes
  // with the sun getting into the wood (uWood.w): in the film the shaft goes
  // from 28, 39, 40 on screen to 34, 48, 44 over six seconds, its top to
  // 40, 56, 45.
  float up3 = up * up * up;
  vec3 color = uSunColor * (vec3(0.0011, 0.0017, 0.0044) * (0.55 + 0.45 * up) + vec3(0.0034, 0.0046, 0.0016) * up3 * up3 * (0.1 + 0.9 * uWood.w));
  // vParams.z: a column looked along is deeper than one looked across (three
  // times, from the film's view), which is why shafts show best against the light
  outColor = toTarget(vec4(color * (bell * along * drift * vParams.x * vParams.z * uWood.y), 1.0));
}
`;

/**
 * @param {object} ctx the shared context
 * @param {object} options
 * @param {object} options.uniforms the wood's own uniforms (uWood)
 * @param {(theta: number, back: number) => number} options.groundHeight
 * @param {(thing: any) => any} options.keep registers something to dispose of
 * @returns {THREE.Object3D[]} meshes for the far scene
 */
export function createHaze(ctx, { uniforms, groundHeight, keep }) {
  const { pond, light } = ctx;
  const meshes = [];

  // The wall: a ring fifty metres behind the shore, from under the ground to
  // well above anything a camera on the pond can look up at.
  {
    const segments = 96;
    const positions = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const r = pond.shoreRadius(theta) + 50;
      positions.push(r * Math.sin(theta), -3, -r * Math.cos(theta), r * Math.sin(theta), 70, -r * Math.cos(theta));
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = keep(
      ctx.createMaterial({
        vertexShader: WALL_VERTEX,
        fragmentShader: wallFragment(ctx),
        uniforms: { ...light.uniforms, ...uniforms },
        side: THREE.DoubleSide,
      }),
    );
    const wall = new THREE.Mesh(geometry, material);
    wall.name = 'wood-wall';
    wall.frustumCulled = false;
    meshes.push(wall);
  }

  // The shafts: one instanced strip each.
  {
    const rng = ctx.rng.fork('shafts');
    const geometry = keep(new THREE.InstancedBufferGeometry());
    const strip = new THREE.PlaneGeometry(1, 1, 1, 6);
    strip.translate(0.5, 0.5, 0); // uv is what the vertex stage reads; position is not used
    geometry.setAttribute('position', strip.attributes.position);
    geometry.setAttribute('uv', strip.attributes.uv);
    geometry.setIndex(strip.index);
    const a = new Float32Array(SHAFTS.length * 4);
    const b = new Float32Array(SHAFTS.length * 4);
    SHAFTS.forEach(([thetaDeg, back, radius, strength], i) => {
      const theta = thetaDeg * DEG;
      const r = pond.shoreRadius(theta) + back;
      a.set([r * Math.sin(theta), groundHeight(theta, back) - 0.2, -r * Math.cos(theta), radius], i * 4);
      // long enough to reach the crowns whatever the height of the sun
      // (the seed gives each its own rays and its own drifting haze)
      b.set([30, strength, rng.float(), 0], i * 4);
    });
    geometry.setAttribute('aShaft', new THREE.InstancedBufferAttribute(a, 4));
    geometry.setAttribute('aShaftB', new THREE.InstancedBufferAttribute(b, 4));
    geometry.instanceCount = SHAFTS.length;
    const material = keep(
      ctx.createMaterial({
        vertexShader: SHAFT_VERTEX,
        fragmentShader: shaftFragment(ctx),
        uniforms: { ...ctx.uniforms, ...light.uniforms, ...uniforms },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const shafts = new THREE.Mesh(geometry, material);
    shafts.name = 'wood-shafts';
    shafts.frustumCulled = false;
    shafts.renderOrder = 6;
    meshes.push(shafts);
  }

  return meshes;
}
