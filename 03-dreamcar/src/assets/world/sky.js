// The sky: one dome round the camera, shaded from the numbers of lighting.js.
//
// By day it is a clear-sky gradient with the shape real air gives it (deep
// blue overhead, paler the longer the path through the air, darkest at a
// right angle to the sun), the glow of haze round the sun and the sun's disc.
// By night the same shader draws a blue-black sky under a gibbous moon, with
// airglow low down and the band of the Milky Way; the stars themselves are
// points drawn over it. Both carry the same two layers of cloud, lit from
// the side the light comes from, and both end in the haze of atmosphere.js:
// the horizon is the colour distance fades to.
//
// Three things to know when changing it:
//  - Everything is radiance in scene units (see lighting.js). Nothing here is
//    clamped: the disc is thousands of times brighter than the blue, and the
//    frame's bloom makes its glare from that.
//  - The dome is drawn infinitely far away by its vertex shader (rotation
//    only, z = w) and writes no depth, so one dome serves every view, the
//    cars' reflection probes and the environment map. `envScene` holds its
//    twin without the disc: the sun's highlight on a surface comes from the
//    sun's light, and a disc in the environment map would make a second one.
//  - Stars are spots a pixel or two wide whose brightness is spread over
//    their footprint, so they neither flicker as the camera turns nor change
//    with the size of the picture.

import * as THREE from 'three';
import { fieldTexture, gradientField, valueField, worleyField } from '../../engine/noise.js';
import { ATMOSPHERE_PARS } from './atmosphere.js';

/** Stars drawn, per tier. The faintest magnitude follows from the number, so the bright ones are the same few. */
const STARS = { low: 1800, medium: 3500, high: 6000 };
/** Edge of the cloud noise texture, per tier. */
const CLOUD_MAP = { low: 256, medium: 512, high: 512 };

const DEG = Math.PI / 180;
/** The pole of the Milky Way's great circle: the band climbs out of the horizon ahead of the straight and arcs over the lake. */
const GALAXY_POLE = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();

/** What the dome and the stars share: the air, the clouds, the disc's place. Needs ATMOSPHERE_PARS before it. */
const SKY_PARS = /* glsl */ `
uniform vec3 uSunDir;       // towards the sun or the moon
uniform sampler2D uCloudMap; // r: billows  g: fine detail  b: streaks  a: where the sky is cloudy at all
uniform vec4 uCloud;        // cover, wisps, silver, unused
uniform vec2 uCloudDrift;
uniform vec4 uDisc;         // angular radius (rad), radiance, limb darkening, seas

// A lookup in the cloud map at so many repeats per unit of the cloud sheet. The fragment stage hands over the
// screen-space slope of the sheet's coordinates itself (cloudSlope, set once at the top of main): the lookups sit
// inside branches, where the slopes a plain texture() works out for itself are not defined.
#ifdef SKY_VERTEX
  #define cloudTex(uv, scale) textureLod(uCloudMap, uv, 1.0)
#else
  vec4 cloudSlope;
  #define cloudTex(uv, scale) textureGrad(uCloudMap, uv, cloudSlope.xy * (scale), cloudSlope.zw * (scale))
#endif

// How much air a line of sight passes through, relative to straight up: 1 at the zenith, 40 at the horizon.
float airMass(float up) {
  return 1.0 / (up + 0.025 * exp(-11.0 * up));
}

// A forward-scattering lobe round the light, 1 looking straight at it; g near 1 is tight.
float lobe(float mu, float g) {
  float r = (1.0 - g) * (1.0 - g) / (1.0 + g * g - 2.0 * g * mu);
  return r * sqrt(r);
}

// Clouds lie on a level sheet far overhead. The constant bends the sheet down to meet the horizon, where a flat
// one would run away to infinity.
vec2 cloudPlane(vec3 d) {
  return d.xz / (max(d.y, 0.0) + 0.1);
}

float cumulus(vec2 p) {
  // (sky lane) heaps, not shreds: where the broad patches allow a cloud, the round billows decide its body and
  // the fine detail only frays its rim; the body is dense well inside the edge
  float patches = cloudTex(p * 0.3 + uCloudDrift, 0.3).a;
  float billow = cloudTex(p * 0.9 + uCloudDrift * 2.0, 0.9).r;
  float detail = cloudTex(p * 3.2 + uCloudDrift * 4.0, 3.2).g;
  float shape = 0.52 * patches + 0.4 * billow + 0.08 * detail;
  float edge = 0.8 - 0.5 * uCloud.x;
  float body = smoothstep(edge, edge + 0.07, shape);
  return body * body * (3.0 - 2.0 * body);
}

float cirrus(vec2 p) {
  // long streaks, combed one way across the sky by the wind up there and bent by its eddies
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * p * 6.0;
  float gaps = cloudTex(q * 0.05 + 0.37, 0.05).r;
  q.y += 2.4 * gaps;
  float streak = cloudTex(vec2(q.x * 0.035, q.y * 0.17) + uCloudDrift * 0.5, 0.17).b;
  return smoothstep(0.5, 0.85, streak) * smoothstep(0.42, 0.78, gaps) * uCloud.y;
}

// How much of what lies behind them the two layers hide: x the high streaks, y the cumulus.
vec2 cloudCover(vec3 d) {
  float fade = smoothstep(0.0, 0.1, d.y);
  if (fade <= 0.0) return vec2(0.0);
  // none across the light itself: its shadows on the ground say that it is out
  float open = fade * (1.0 - 0.92 * smoothstep(0.9, 0.995, dot(d, uSunDir)));
  vec2 p = cloudPlane(d);
  return vec2(0.5 * cirrus(p), 0.94 * cumulus(p)) * open;
}
`;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only, and z = w: the dome is infinitely far away wherever the camera stands.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const DOME_FRAGMENT = /* glsl */ `
${ATMOSPHERE_PARS}
${SKY_PARS}
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec2 uAir;          // falloff per air mass, phase
uniform vec3 uGlowColor;
uniform vec4 uGlow;         // wide: radiance, g; tight: radiance, g
uniform vec3 uGround;
uniform vec3 uAirglow;
uniform vec4 uMilky;        // pole of the band (unit), radiance
uniform vec3 uDiscX;        // across the disc and up it, on the sky
uniform vec3 uDiscY;
uniform vec3 uDiscColor;
uniform vec3 uDiscLight;    // where the disc is lit from, in its own frame (z towards the viewer)
uniform float uDiscOn;
uniform vec3 uCloudLit;     // a cloud face square to the light
uniform vec3 uCloudShade;
uniform vec4 uBand;         // (look lane, dusk) the twilight band: radiance (rgb) at the horizon under the set sun, height (a)
varying vec3 vDir;

vec3 clearSky(vec3 d, float mu) {
  float mass = airMass(max(d.y, 0.0));
  float low = 1.0 - exp(-uAir.x * (mass - 1.0));
  vec3 col = mix(uZenith, uHorizon, low);
  // Rayleigh's shape: least light is scattered at a right angle to where it came from
  col *= 1.0 + uAir.y * (0.75 * (1.0 + mu * mu) - 1.0);
  col += uAirglow * low * low;
  col += uGlowColor * (uGlow.x * lobe(mu, uGlow.y) + uGlow.z * lobe(mu, uGlow.w));
  // (look lane, dusk) after sunset: a broad rose band low all round the horizon, strongest under the set sun and
  // still a third as strong opposite it (the belt the earth's shadow rises under), fading through mauve upwards
  if (uBand.a > 0.0) {
    vec2 level = normalize(d.xz + 1.0e-5);
    vec2 sunFlat = normalize(uSunDir.xz + 1.0e-5);
    float side = 0.5 + 0.5 * dot(level, sunFlat);
    float h = max(d.y, 0.0);
    col += uBand.rgb * exp(-h / (uBand.a * (0.8 + 0.6 * side))) * (0.33 + 0.67 * side * side);
  }
  return col;
}

vec3 milkyWay(vec3 d) {
  float off = dot(d, uMilky.xyz);
  float band = exp(-off * off / 0.03);
  if (uMilky.w * band < 1.0e-7) return vec3(0.0);
  // a map of the band with no seam: the direction flattened onto the band's own plane, pulled apart across it
  vec3 ax = normalize(cross(uMilky.xyz, vec3(0.0, 1.0, 0.0)));
  vec2 g = vec2(dot(d, ax), dot(d, cross(uMilky.xyz, ax))) * (1.0 + 2.2 * off);
  float clumps = textureLod(uCloudMap, g * 0.8 + 0.13, 0.0).r;
  float lanes = textureLod(uCloudMap, g * 2.1 + 0.61, 0.5).g;
  float dust = 1.0 - 0.75 * smoothstep(0.35, 0.8, lanes) * exp(-off * off / 0.005);
  return vec3(0.8, 0.88, 1.0) * (uMilky.w * band * (0.25 + 1.5 * clumps * clumps) * dust);
}

vec3 disc(vec3 d) {
  vec3 off = d - uSunDir;
  vec2 p = vec2(dot(off, uDiscX), dot(off, uDiscY)) / uDisc.x;
  float r = length(p);
  float soft = max(fwidth(r), 1.0e-4);
  if (uDiscOn <= 0.0 || r > 1.0 + soft || dot(d, uSunDir) < 0.0) return vec3(0.0);
  // the disc as the ball it is: its rim darkens (the sun), one side is unlit (the moon)
  vec3 n = vec3(p, sqrt(max(1.0 - r * r, 0.0)));
  float face = (1.0 - uDisc.z * (1.0 - n.z)) * (0.02 + 0.98 * smoothstep(-0.04, 0.22, dot(n, uDiscLight)));
  vec4 mottle = textureLod(uCloudMap, p * 0.3 + 0.31, 1.0);
  float seas = 1.0 - uDisc.w * smoothstep(0.4, 0.58, 0.6 * mottle.r + 0.4 * mottle.g);
  return uDiscColor * (uDisc.y * face * seas * (1.0 - smoothstep(1.0 - soft, 1.0 + soft, r)));
}

void main() {
  vec3 d = normalize(vDir);
  float mu = dot(d, uSunDir);
  vec3 col = clearSky(d, mu) + milkyWay(d) + disc(d);

  vec2 p = cloudPlane(d);
  cloudSlope = vec4(dFdx(p), dFdy(p));
  vec2 cover = cloudCover(d);
  if (cover.x + cover.y > 0.0) {
    // (sky lane) A cumulus is lit from above and from the sun's side and shaded underneath. On the dome "up the
    // cloud" is towards the zenith, which on the cloud sheet is towards p = 0: a point whose neighbour towards the
    // zenith is still cloud is in the body or the base; one whose neighbour is clear sky is a lit top. The same
    // test towards the sun gives the sunlit flank, and the thin rim with the sun behind it shines silver.
    vec2 toLight = normalize(uSunDir.xz + 1.0e-5);
    // after sunset the light comes from under the clouds: the bright side is the underside
    vec2 toTop = -normalize(p + 1.0e-5) * (0.6 + 0.25 * length(p)) * (uSunDir.y < 0.0 ? -1.0 : 1.0);
    float behind = 0.6 * cumulus(p + toLight * 0.06) + 0.4 * cumulus(p + toLight * 0.15);
    float over = 0.65 * cumulus(p + toTop * 0.07) + 0.35 * cumulus(p + toTop * 0.18);
    float thick = cover.y / 0.94;
    float sunlit = exp(-2.2 * behind) * 0.55 + exp(-2.6 * over) * 0.45;
    // the silver lining: forward scattering through the thin edge, strongest round the sun
    float rim = uCloud.z * lobe(mu, 0.75) * (1.0 - thick) * 2.0;
    vec3 lit = uCloudLit * (sunlit * (1.0 + 0.6 * uCloud.z * lobe(mu, 0.6)) + rim);
    // the base: the sky's blue from below and around, darker the more cloud stands over it
    vec3 base = uCloudShade * (1.0 - 0.45 * over * thick);
    col = mix(col, uCloudShade + uCloudLit * (0.55 + rim), cover.x);
    col = mix(col, base + lit, cover.y);
  }

  // the haze, taken to the end of the air; under the horizon, far land seen through it
  col = mix(col, hazeColor(d), d.y > 0.0 ? hazeToSky(cameraPosition.y, d.y) : 1.0);
  col = mix(col, uGround, 0.9 * smoothstep(0.0, -0.3, d.y));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERTEX = /* glsl */ `
#define SKY_VERTEX
${ATMOSPHERE_PARS}
${SKY_PARS}
attribute vec2 aStar;       // brightness relative to magnitude 0, colour (0 warm, 1 blue)
uniform float uStarLight;   // what a star of magnitude 0 lays on the lens
uniform float uViewHeight;  // pixels
varying vec3 vColor;
varying vec2 vSpot;         // the spot's size in pixels, and 1 / (2 sigma^2)

void main() {
  vec3 d = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * d, 1.0);
  gl_Position = p.xyww;

  // what is left of it after the thick air low down, the haze, the clouds and the moon's own disc
  float up = max(d.y, 1.0e-3);
  vec2 cover = cloudCover(d);
  float seen = smoothstep(-0.01, 0.04, d.y) * exp(-0.1 * (airMass(up) - 1.0)) * (1.0 - hazeToSky(cameraPosition.y, up));
  seen *= (1.0 - cover.x) * (1.0 - cover.y) * step(uDisc.x * 1.1, length(d - uSunDir));

  // A star is a point: all its light falls into a spot whose size the lens decides, not the star. The brighter
  // ones get a slightly wider spot, as a lens gives them, and the spot grows slowly with the picture's size.
  float sigma = clamp(0.7 + 0.28 * log2(1.0 + 6.0 * aStar.x), 0.7, 1.8) * sqrt(uViewHeight / 720.0);
  float pixelsPerRadian = 0.5 * uViewHeight * projectionMatrix[1][1];
  float peak = uStarLight * aStar.x * seen * pixelsPerRadian * pixelsPerRadian / (6.2832 * sigma * sigma);

  vec3 tint = mix(vec3(1.0, 0.7, 0.45), vec3(1.0), smoothstep(0.0, 0.45, aStar.y));
  vColor = mix(tint, vec3(0.7, 0.82, 1.0), smoothstep(0.55, 1.0, aStar.y)) * peak;
  float size = max(2.0, ceil(6.0 * sigma));
  vSpot = vec2(size, 0.5 / (sigma * sigma));
  gl_PointSize = size;
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec2 vSpot;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vSpot.x;
  gl_FragColor = vec4(vColor * exp(-dot(q, q) * vSpot.y), 1.0);
  #include <colorspace_fragment>
}
`;

/** A field stretched to fill 0..1: the cloud thresholds are set against the whole range. */
function spread(field) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (field[i] < lo) lo = field[i];
    if (field[i] > hi) hi = field[i];
  }
  const k = 1 / Math.max(hi - lo, 1e-6);
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - lo) * k;
  return field;
}

/** The noise all the sky's soft shapes are cut from: see uCloudMap in the shader. */
function createCloudMap(size, rng) {
  const seed = rng.int(1 << 16);
  const puffs = worleyField(size, { seed: seed + 3, cells: 7 });
  const billows = valueField(size, { seed: seed + 1, cells: 4, octaves: 5 });
  // cauliflower: soft noise with round cells pressed into it
  for (let i = 0; i < billows.length; i++) billows[i] = 0.7 * billows[i] + 0.3 * (1 - puffs[i]);
  const map = fieldTexture(size, [
    spread(billows),
    spread(gradientField(size, { seed: seed + 5, cells: 12, octaves: 4 })),
    spread(valueField(size, { seed: seed + 7, cells: 5, octaves: 5, gain: 0.6 })),
    spread(valueField(size, { seed: seed + 9, cells: 3, octaves: 3 })),
  ]);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

/**
 * The star field: unit directions over the sky and a little below the horizon, each with its brightness relative
 * to magnitude 0 and its colour. Counts per magnitude follow the real sky (about three times as many for each
 * magnitude fainter); a third of them crowd towards the Milky Way.
 */
function createStarGeometry(count, rng) {
  const positions = new Float32Array(count * 3);
  const stars = new Float32Array(count * 2);
  const brightest = -1;
  const faintest = 6.2 + 2 * Math.log10(count / STARS.high);
  const floor = 10 ** (0.5 * (brightest - faintest));
  const ax = new THREE.Vector3().crossVectors(GALAXY_POLE, new THREE.Vector3(0, 1, 0)).normalize();
  const ay = new THREE.Vector3().crossVectors(GALAXY_POLE, ax);
  const d = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    do {
      if (rng.next() < 0.35) {
        const along = rng.range(0, Math.PI * 2);
        const off = rng.gauss() * 0.13;
        d.set(0, 0, 0)
          .addScaledVector(ax, Math.cos(along) * Math.cos(off))
          .addScaledVector(ay, Math.sin(along) * Math.cos(off))
          .addScaledVector(GALAXY_POLE, Math.sin(off));
      } else {
        const y = rng.range(-1, 1);
        const turn = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(1 - y * y);
        d.set(r * Math.cos(turn), y, r * Math.sin(turn));
      }
    } while (d.y < -0.1);
    d.toArray(positions, i * 3);
    const magnitude = faintest + 2 * Math.log10(floor + rng.next() * (1 - floor));
    stars[i * 2] = 10 ** (-0.4 * magnitude);
    stars[i * 2 + 1] = rng.next();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStar', new THREE.BufferAttribute(stars, 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return geometry;
}

/**
 * @typedef {object} Sky
 * @property {THREE.Mesh} dome goes into the world's scene
 * @property {THREE.Points} stars goes into the world's scene (hidden by day, and in reflection probes)
 * @property {THREE.Scene} envScene the dome's twin without the disc, for the environment map
 * @property {(time: import('./lighting.js').TimeOfDay) => void} setTime
 * @property {(dt: number, simTime: number) => void} update drifts the clouds
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @returns {Sky}
 */
export function createSky({ tier, rng, atmosphere }) {
  const cloudMap = createCloudMap(CLOUD_MAP[tier], rng.fork('clouds'));
  let drift = [0, 0];

  const shared = {
    ...atmosphere.uniforms,
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudMap: { value: cloudMap },
    uCloud: { value: new THREE.Vector4() },
    uCloudDrift: { value: new THREE.Vector2() },
    uDisc: { value: new THREE.Vector4(0.01, 0, 0, 0) },
  };
  const domeUniforms = {
    ...shared,
    uZenith: { value: new THREE.Vector3() },
    uHorizon: { value: new THREE.Vector3() },
    uAir: { value: new THREE.Vector2() },
    uGlowColor: { value: new THREE.Vector3() },
    uGlow: { value: new THREE.Vector4() },
    uGround: { value: new THREE.Vector3() },
    uAirglow: { value: new THREE.Vector3() },
    uMilky: { value: new THREE.Vector4(GALAXY_POLE.x, GALAXY_POLE.y, GALAXY_POLE.z, 0) },
    uDiscX: { value: new THREE.Vector3() },
    uDiscY: { value: new THREE.Vector3() },
    uDiscColor: { value: new THREE.Vector3() },
    uDiscLight: { value: new THREE.Vector3(0, 0, 1) },
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uBand: { value: new THREE.Vector4() },
  };
  const domeMaterial = (discOn) =>
    new THREE.ShaderMaterial({
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      uniforms: { ...domeUniforms, uDiscOn: { value: discOn } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const dome = new THREE.Mesh(geometry, domeMaterial(1));
  dome.frustumCulled = false;
  dome.renderOrder = 1000; // after everything solid: only the pixels still empty are shaded
  const envDome = new THREE.Mesh(geometry, domeMaterial(0));
  envDome.frustumCulled = false;
  const envScene = new THREE.Scene().add(envDome);

  const starUniforms = { ...shared, uStarLight: { value: 0 }, uViewHeight: { value: 720 } };
  const stars = new THREE.Points(
    createStarGeometry(STARS[tier], rng.fork('stars')),
    new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: starUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = 1001;
  // the spot's size is in pixels of whatever is being drawn into: ask at the last moment
  const viewport = new THREE.Vector4();
  stars.onBeforeRender = (renderer) => {
    starUniforms.uViewHeight.value = renderer.getCurrentViewport(viewport).w;
    stars.material.uniformsNeedUpdate = true;
  };

  const sunDir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  return {
    dome,
    stars,
    envScene,

    setTime(time) {
      const { sky, sun } = time;
      sunDir.fromArray(sun.dir).normalize();
      shared.uSunDir.value.copy(sunDir);
      shared.uCloud.value.set(sky.clouds.cover, sky.clouds.wisps, sky.clouds.silver, 0);
      shared.uDisc.value.set(sky.disc.size * DEG, sky.disc.radiance, sky.disc.limb, sky.disc.seas);
      drift = sky.clouds.drift;

      const u = domeUniforms;
      u.uZenith.value.fromArray(sky.zenith);
      u.uHorizon.value.fromArray(sky.horizon);
      u.uAir.value.set(sky.falloff, sky.phase);
      u.uGlowColor.value.fromArray(sky.glow.color);
      u.uGlow.value.set(sky.glow.wide[0], sky.glow.wide[1], sky.glow.tight[0], sky.glow.tight[1]);
      u.uGround.value.fromArray(sky.ground);
      u.uAirglow.value.fromArray(sky.airglow);
      u.uMilky.value.w = sky.milkyWay;
      u.uDiscColor.value.fromArray(sun.color);
      u.uCloudLit.value.fromArray(sun.color).multiplyScalar(sun.intensity * sky.clouds.lit);
      // (look lane, dusk) a sun under the horizon lights the clouds' undersides with its own colour, not its light
      if (sky.clouds.light) u.uCloudLit.value.fromArray(sky.clouds.light);
      if (sky.band) u.uBand.value.set(...sky.band.color, sky.band.height);
      else u.uBand.value.set(0, 0, 0, 0);
      u.uCloudShade.value.fromArray(sky.clouds.shade);

      // The disc's own frame on the sky: x level, y up it. Its light comes from the viewer's side turned by the
      // phase angle towards the lit limb, which hangs below the disc, turned by `tilt`.
      u.uDiscX.value.crossVectors(up, sunDir).normalize();
      u.uDiscY.value.crossVectors(sunDir, u.uDiscX.value);
      const phaseAngle = Math.acos(THREE.MathUtils.clamp(2 * sky.disc.phase - 1, -1, 1));
      const tilt = sky.disc.tilt * DEG;
      u.uDiscLight.value.set(Math.sin(phaseAngle) * Math.sin(tilt), -Math.sin(phaseAngle) * Math.cos(tilt), Math.cos(phaseAngle));

      starUniforms.uStarLight.value = sky.stars;
      stars.visible = sky.stars > 0;
    },

    update(dt, simTime) {
      // (kept within one repeat of the texture: a large offset would cost the lookups their precision)
      shared.uCloudDrift.value.set((drift[0] * simTime) % 1, (drift[1] * simTime) % 1);
    },

    dispose() {
      geometry.dispose();
      dome.material.dispose();
      envDome.material.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
      cloudMap.dispose();
    },
  };
}
