// What floats on the pond: specks (pollen, seeds, bits of down) that catch the
// low sun as sharp white points, and a few golden leaves.
//
// The film shows about as many specks per patch of *picture* at the bottom of
// the frame, 2 m from the lens, as just below the swan at 5 m, although a
// patch of picture there covers ten times less water. So what is seen is not
// one kind of speck spread evenly: it is debris of every size, far more of it
// small than large, and each bit shows from as far away as its size allows.
// That is how it is built:
//
//   - every speck has a range, the distance from which it can first be made
//     out, and a size in proportion to that range. Small ones are many and
//     show only close to the lens; the few big ones show from across the
//     pond. Seen from anywhere, the water has the same sprinkling;
//   - the specks lie on one sheet that drifts slowly as a whole. Each one
//     repeats across the water in a square of its own size ("tile", 0.4 of
//     its range) and is drawn once, at the copy nearest to a place of its
//     own in the water in view. It fades out toward the edge of that square
//     and toward its range, so the jump to the next copy is never seen. A
//     still camera sees a fixed constellation; a moving one sees it stay
//     where it is on the water while specks at the edges of their squares
//     give way to others, and the sprinkling holds wherever it goes;
//   - a speck is lit by the sun or it is nearly nothing: none in the wood's
//     shadow, few in the swan's;
//   - it is a point on the surface: it rides the ripples, it has no mirror
//     image, the swan hides it. A fifth of them are flat things a centimetre
//     or so across, which from this low are short horizontal dashes.

import * as THREE from 'three';
import { pondSurface } from './surface.js';

/** Ranges of the specks, metres: nearer than `min` nothing new appears, beyond `max` none is visible. */
const RANGE = { min: 1.8, max: 9 };
/** Side of a speck's square, as a share of its range. */
const TILE = 0.4;
/**
 * How many specks it takes, per unit of "width of the view" (the tangent of
 * half its horizontal angle), for the film's sprinkling: about 15 specks
 * standing out in a patch of 100 x 100 pixels of the 1206 pixel wide film.
 * A narrow view needs fewer than the tier has; the rest are then left out.
 */
const SPECKS_PER_WIDTH = 57000;
/** The sheet's drift, metres per second (x, z). */
const DRIFT = [0.011, 0.006];
/** A dot is never drawn smaller than this many pixels across: smaller ones flicker as they cross pixel centres. */
const MIN_PIXELS = 1.5;

const LEAVES = { count: 14, tile: 7.5 };

const speckVertex = (ctx, surface) => /* glsl */ `
${ctx.light.glsl}
${ctx.ripple.glsl}
${ctx.pond.glsl}
${surface.glsl}
uniform vec2 uResolution;
uniform vec2 uDrift;
uniform vec4 uSpeck;   // brightness, light left in shadow, smallest dot in pixels, specks per width of view over specks there are
in vec4 aTile;         // place in its square (0..1, 0..1), range (metres), brightness
in vec4 aLook;         // width as an angle at its range (radians), how flat it lies (0 a ball .. 1 a flake), unused, unused
in vec3 aSeed;         // three random numbers: how deep in the view its place is, how far to the side, when it is left out
out float vGlow;
out float vAspect;
void main() {
  float range = aTile.z;
  float tile = range * ${TILE.toFixed(3)};
  // the direction the camera looks in over the water, and its right hand
  vec2 forward = -vec2(viewMatrix[0][2], viewMatrix[2][2]);
  forward /= max(length(forward), 1.0e-4);
  vec2 right = vec2(-forward.y, forward.x);
  // This speck's own place in the view: somewhere in the wedge of water
  // between the lens and its range, every part of the wedge equally likely.
  float reach = sqrt(max(range * range - cameraPosition.y * cameraPosition.y, 0.0));
  float halfWidth = 1.1 / projectionMatrix[0][0];
  float depth = reach * sqrt(mix(0.1, 1.0, aSeed.x));
  vec2 centre = cameraPosition.xz + forward * depth + right * ((aSeed.y * 2.0 - 1.0) * depth * halfWidth);
  // the copy of this speck that is nearest to that place
  vec2 cell = fract((aTile.xy * tile + uDrift - centre) / tile + 0.5) - 0.5;
  vec2 xz = centre + cell * tile;

  vec4 field = rippleSample4(xz);
  vec3 p = vec3(xz.x, field.x + 0.002, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);

  float away = distance(cameraPosition, p);
  float fade = (1.0 - smoothstep(0.8, 1.0, away / range))
             * (1.0 - smoothstep(0.4, 0.5, max(abs(cell.x), abs(cell.y))));
  // a narrow view is full with fewer specks than a wide one: leave the surplus out
  fade *= step(aSeed.z, max(halfWidth, ${(TILE * TILE / 0.9).toFixed(3)}) * uSpeck.w);
  // on the water only
  fade *= step(shoreDistance(xz), -0.4);
  float lit = sunReach(p) * hullLight(p);
  // Wet things glare most seen against the light; from the sun's side they are plain pale dots.
  vec3 toEye = normalize(cameraPosition - p);
  float against = smoothstep(-0.3, 0.8, dot(normalize(-toEye.xz), normalize(uSunDir.xz + vec2(1.0e-5, 0.0))));
  // and a speck riding a face of a ripple that leans toward the sun is a little brighter for it
  float lean = clamp(1.0 + 6.0 * dot(field.yz, -normalize(uSunDir.xz + vec2(1.0e-5, 0.0))), 0.75, 1.3);
  vGlow = aTile.w * uSpeck.x * fade * mix(uSpeck.y, 1.0, lit) * mix(0.4, 1.0, against) * lean;

  // Size on screen: its real width, and for a flat thing a height squeezed by
  // the angle the water is seen at. uResolution is the target being drawn.
  float focal = 0.5 * uResolution.y * projectionMatrix[1][1];
  float wide = aLook.x * range / away * focal;
  float tall = wide * mix(1.0, clamp(cameraPosition.y / away, 0.0, 1.0), aLook.y);
  gl_PointSize = max(wide, uSpeck.z);
  vAspect = max(tall, uSpeck.z) / max(wide, uSpeck.z);
  // too faint to matter: off the screen, so that it costs no pixels
  if (vGlow < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SPECK_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
in float vGlow;
in float vAspect;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y /= vAspect;
  float d = dot(q, q);
  if (d > 1.0) discard;
  // a hard little dot, only its very rim softened
  outColor = toTarget(vec4(uColor * vGlow * (1.0 - d * d), 1.0));
}
`;

const leafVertex = (ctx, surface) => /* glsl */ `
${ctx.light.glsl}
${ctx.ripple.glsl}
${ctx.pond.glsl}
${surface.glsl}
uniform vec2 uDrift;
uniform float uLeafTile;
in vec4 aLeaf;   // place in the square (0..1, 0..1), length (metres), turn (radians)
out vec2 vLeafUv;
out float vLit;
out float vSeed;
void main() {
  vec2 forward = -vec2(viewMatrix[0][2], viewMatrix[2][2]);
  forward /= max(length(forward), 1.0e-4);
  vec2 centre = cameraPosition.xz + forward * (0.46 * uLeafTile);
  vec2 cell = fract((aLeaf.xy * uLeafTile + uDrift - centre) / uLeafTile + 0.5) - 0.5;
  vec2 xz = centre + cell * uLeafTile;
  vec3 field = rippleSample(xz);
  float c = cos(aLeaf.w), s = sin(aLeaf.w);
  // a leaf is 0.55 times as wide as it is long, and lies flat
  vec2 corner = vec2(position.x, position.y * 0.55) * aLeaf.z;
  vec2 flat2 = xz + vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec3 p = vec3(flat2.x, field.x + 0.003, flat2.y);
  vLeafUv = position.xy;
  vSeed = aLeaf.w * 7.3;
  vec3 at = vec3(xz.x, 0.0, xz.y);
  float fade = (1.0 - smoothstep(0.4, 0.5, max(abs(cell.x), abs(cell.y)))) * step(shoreDistance(xz), -0.6);
  vLit = sunReach(at) * hullLight(at) * fade;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (fade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const leafFragment = (ctx) => /* glsl */ `
${ctx.light.glsl}
uniform vec3 uLeafColor;
in vec2 vLeafUv;
in float vLit;
in float vSeed;
void main() {
  // a pointed oval, two arcs meeting at the tips, with a nibbled, uneven edge
  float ragged = (valueNoise(vLeafUv * 2.6 + vSeed) - 0.5) * 0.55 + (valueNoise(vLeafUv * 7.0 - vSeed) - 0.5) * 0.2;
  float edge = abs(vLeafUv.y + 0.12 * sin(vLeafUv.x * 2.2 + vSeed)) - (1.0 - vLeafUv.x * vLeafUv.x) * (0.8 + ragged);
  float pixel = max(fwidth(edge), 1.0e-4);
  float inside = clamp(0.5 - edge / pixel, 0.0, 1.0);
  if (inside <= 0.0) discard;
  // a dry leaf lying on the water with the sun behind it: lit through, and the midrib a shade darker
  float rib = 1.0 - 0.25 * smoothstep(0.12, 0.0, abs(vLeafUv.y));
  vec3 col = uSunColor * uLeafColor * rib * vLit + uSkyColor * 0.02;
  outColor = toTarget(vec4(col * inside, inside));
}
`;

/**
 * A speck's range, drawn so that from any distance the picture holds the same
 * number per patch. Seen from distance R, the specks in view are those with a
 * range beyond R, and a patch of picture covers water in proportion to R^3:
 * so the number per square metre with a range beyond R has to fall as 1 / R^3.
 * A speck is spread over the wedge of water in view up to its range, whose
 * area goes as R^2; that leaves the share of specks with ranges near R going
 * as 1 / R^2, which is what "1 / R spread evenly" gives.
 */
const sampleRange = (rng) => 1 / (1 / RANGE.max + rng.float() * (1 / RANGE.min - 1 / RANGE.max));

/**
 * @param {object} ctx the shared context (see World.js); uses ctx.quality.counts.specks
 * @returns {{ object: THREE.Object3D, update: (dt: number, time: number, camera: THREE.Camera) => void, dispose: () => void }}
 */
export function createSpecks(ctx) {
  const rng = ctx.rng.fork('specks');
  const surface = pondSurface(ctx);
  const count = ctx.quality.counts.specks;

  // three.js wants an attribute called position; the specks compute theirs
  const positions = new Float32Array(count * 3);
  const tiles = new Float32Array(count * 4);
  const looks = new Float32Array(count * 4);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Brightness as measured in the film: spread evenly on a logarithmic
    // scale about a median, a factor of four either way covering most of
    // them, so that a few are near white and many are barely there.
    const brightness = Math.min(Math.exp(rng.gauss() * 1.15), 14);
    tiles.set([rng.float(), rng.float(), sampleRange(rng), brightness], i * 4);
    // Width seen from the edge of its range, in radians (most specks are
    // seen from nearer than that, a quarter nearer on average). A fifth are
    // flakes twice as wide that lie flat; the rest are crumbs.
    const flake = rng.float() < 0.2;
    const width = flake ? rng.range(0.0008, 0.0015) : rng.range(0.00045, 0.00085);
    looks.set([width, flake ? 1 : rng.range(0.2, 0.6), 0, 0], i * 4);
    seeds.set([rng.float(), rng.float(), rng.float()], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTile', new THREE.BufferAttribute(tiles, 4));
  geometry.setAttribute('aLook', new THREE.BufferAttribute(looks, 4));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

  const drift = new THREE.Vector2();
  const uniforms = {
    ...ctx.uniforms,
    ...ctx.light.uniforms,
    ...ctx.ripple.uniforms,
    ...surface.uniforms,
    uDrift: { value: drift },
    uSpeck: { value: new THREE.Vector4(0.2, 0.04, MIN_PIXELS, 0) },
    uColor: { value: new THREE.Vector3(0.7, 0.76, 1.0) },
  };
  const material = ctx.createMaterial({
    vertexShader: speckVertex(ctx, surface),
    fragmentShader: SPECK_FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'specks';
  points.frustumCulled = false; // the shader decides where they are
  points.renderOrder = 20;

  // The leaves: a handful of flat quads on the same sheet, in one big square.
  const leafGeometry = new THREE.InstancedBufferGeometry();
  leafGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  leafGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const leafData = new Float32Array(LEAVES.count * 4);
  for (let i = 0; i < LEAVES.count; i++) {
    leafData.set([rng.float(), rng.float(), rng.range(0.022, 0.045), rng.range(0, Math.PI * 2)], i * 4);
  }
  leafGeometry.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(leafData, 4));
  leafGeometry.instanceCount = LEAVES.count;
  const leafUniforms = {
    ...ctx.light.uniforms,
    ...ctx.ripple.uniforms,
    ...surface.uniforms,
    uDrift: { value: drift },
    uLeafTile: { value: LEAVES.tile },
    uLeafColor: { value: new THREE.Vector3(0.26, 0.19, 0.11) },
  };
  const leafMaterial = ctx.createMaterial({
    vertexShader: leafVertex(ctx, surface),
    fragmentShader: leafFragment(ctx),
    uniforms: leafUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // the colour is already multiplied by its coverage
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const leaves = new THREE.Mesh(leafGeometry, leafMaterial);
  leaves.name = 'leaves';
  leaves.frustumCulled = false;
  leaves.renderOrder = 19;

  const object = new THREE.Group();
  object.name = 'floating';
  object.add(leaves, points);

  return {
    object,
    update(dt, time) {
      surface.update(dt, time);
      drift.x += DRIFT[0] * dt;
      drift.y += DRIFT[1] * dt;
      const look = ctx.look;
      uniforms.uSpeck.value.set(look.speckBrightness ?? 0.52, look.speckShade ?? 0.04, MIN_PIXELS, SPECKS_PER_WIDTH / count);
      uniforms.uColor.value.fromArray(look.speckColor ?? [0.7, 0.76, 1.0]);
      leafUniforms.uLeafColor.value.fromArray(look.leafColor ?? [0.26, 0.19, 0.11]);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      leafGeometry.dispose();
      leafMaterial.dispose();
    },
  };
}
