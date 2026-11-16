// PLACEHOLDER WORLD. A plain, a grey road along the track, blocks and trunks
// beside it for parallax, guide posts, a few street lamps, a gradient sky.
//
// It stands in for the real mountain until that exists, and it already has
// the world's final interface (createWorld below) and takes every bit of its
// light from lighting.js: the car, the cameras and the frame pipeline can be
// built and judged against it. Nothing here is meant to survive.
//
// What the real world should keep from it:
//  - one directional light with one shadow map that follows each view
//    (prepareView), snapped to whole texels so that shadows do not crawl;
//  - a fixed set of lights: setTime changes colours and intensities, never
//    `visible`, so no shader is recompiled when the time of day changes;
//  - the sky drawn infinitely far away by its vertex shader, so the same dome
//    serves every view, the reflection probe and the environment map.

import * as THREE from 'three';
import { GLSL_HASH } from '../../engine/glsl.js';
import { fieldTexture, gradientField, normalTexture, valueField, worleyField } from '../../engine/noise.js';
import { TIMES } from './lighting.js';

/** Per tier: the sun's shadow map, how far from its centre it reaches (m), and how many things stand about. */
const DETAIL = {
  low: { shadowSize: 1024, shadowReach: 45, scatter: 220 },
  medium: { shadowSize: 2048, shadowReach: 60, scatter: 320 },
  high: { shadowSize: 4096, shadowReach: 80, scatter: 420 },
};

/** What a lit street lamp's head sends out (scene units, see lighting.js): pale by day, glaring at night. */
const LAMP_RADIANCE = 2.5;
const LAMP_COLOR = [1.0, 0.74, 0.46];
/** Length of road one repeat of the markings texture covers (a 4 m dash and an 8 m gap). */
const MARKING_PERIOD = 12;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only, and z = w: the dome is infinitely far away wherever the camera stands.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
${GLSL_HASH}
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlow;
uniform vec2 uDisc;   // cosine of the disc's angular radius, its brightness
uniform float uStars;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-4.0 * up));

  float mu = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uGlow * (0.35 * pow(mu, 6.0) + 2.5 * pow(mu, 180.0));
  col += uSunColor * uDisc.y * smoothstep(uDisc.x - 2.0e-5, uDisc.x + 2.0e-5, mu);

  if (uStars > 0.0) {
    // one star in a few of the cells of a grid the view direction passes through
    vec3 p = d * 160.0;
    vec3 cell = floor(p);
    vec3 r = hash33(cell);
    float star = step(0.992, r.x) * smoothstep(0.32, 0.0, length(p - cell - 0.5)) * (0.25 + 6.0 * pow(r.y, 6.0));
    col += uStars * star * mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.84, 1.0), r.z);
  }

  col = mix(col, uGround, smoothstep(0.0, -0.05, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uZenith: { value: new THREE.Vector3() },
      uHorizon: { value: new THREE.Vector3() },
      uGround: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3() },
      uGlow: { value: 0 },
      uDisc: { value: new THREE.Vector2(1, 0) },
      uStars: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

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

/** A ribbon along the track's centre line, one strip of quads, lying just above the plain. */
function createRoadGeometry(track) {
  const segments = Math.ceil(track.length / 2);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const normals = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const index = [];
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  for (let i = 0; i <= segments; i++) {
    const s = (i / segments) * track.length;
    track.frameAt(s % track.length, frame);
    for (let side = 0; side < 2; side++) {
      const k = i * 2 + side;
      const lat = side === 0 ? track.halfWidth : -track.halfWidth;
      positions[k * 3] = frame.pos.x + frame.left.x * lat;
      positions[k * 3 + 1] = frame.pos.y + frame.left.y * lat + 0.02;
      positions[k * 3 + 2] = frame.pos.z + frame.left.z * lat;
      normals[k * 3] = frame.up.x;
      normals[k * 3 + 1] = frame.up.y;
      normals[k * 3 + 2] = frame.up.z;
      uvs[k * 2] = side;
      uvs[k * 2 + 1] = s / MARKING_PERIOD;
    }
    // left edge first, so the quads face up
    if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Blocks and trunks beside the road (something for the eye, the shadows and the motion blur to hold on to),
 * guide posts along both edges, and the poles of the street lamps: three instanced meshes of one unit box.
 */
function createFurniture(track, rng, count) {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // stands on the ground
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const at = new THREE.Vector3();
  const where = { index: -1, s: 0, lat: 0 };
  const place = (s, lat) => {
    track.frameAt(s, frame);
    at.copy(frame.pos).addScaledVector(frame.left, lat);
    quat.setFromAxisAngle(up, Math.atan2(frame.tan.x, frame.tan.z));
  };

  const scatterRng = rng.fork('scatter');
  const scatter = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) {
    const far = scatterRng.next();
    place(scatterRng.range(0, track.length), scatterRng.sign() * (track.halfWidth + 3.5 + far * far * 70));
    // a spot beside one stretch of road can be in the middle of another: ask the track where it really is
    track.locate(at.x, at.z, -1, where);
    if (Math.abs(where.lat) < track.halfWidth + 3) continue;
    const trunk = scatterRng.next() < 0.6;
    if (trunk) scale.set(scatterRng.range(0.35, 0.7), scatterRng.range(7, 16), scatterRng.range(0.35, 0.7));
    else scale.set(scatterRng.range(2, 7), scatterRng.range(1.5, 6), scatterRng.range(2, 7));
    quat.setFromAxisAngle(up, scatterRng.range(0, Math.PI));
    scatter.setMatrixAt(placed, matrix.compose(at, quat, scale));
    const shade = scatterRng.range(0.6, 1.2);
    if (trunk) color.setRGB(0.16 * shade, 0.11 * shade, 0.075 * shade);
    else color.setRGB(0.3 * shade, 0.3 * shade, 0.28 * shade);
    scatter.setColorAt(placed, color);
    placed++;
  }
  scatter.count = placed;
  scatter.castShadow = scatter.receiveShadow = true;

  const postSpacing = 25;
  const postCount = Math.floor(track.length / postSpacing) * 2;
  const posts = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6 }), postCount);
  scale.set(0.12, 1.0, 0.06);
  for (let i = 0; i < postCount; i++) {
    place(Math.floor(i / 2) * postSpacing, (i % 2 ? -1 : 1) * (track.halfWidth + 0.7));
    posts.setMatrixAt(i, matrix.compose(at, quat, scale));
  }
  posts.castShadow = posts.receiveShadow = true;

  const lampList = track.lamps.filter((lamp) => lamp.height > 5);
  const steel = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.6 });
  const poles = new THREE.InstancedMesh(box, steel, lampList.length);
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color().setRGB(...LAMP_COLOR), emissiveIntensity: 0 }),
    lampList.length,
  );
  lampList.forEach((lamp, i) => {
    const side = lamp.side === 'left' || lamp.side > 0 ? 1 : -1;
    place(lamp.s, side * (track.halfWidth + 1.4));
    scale.set(0.16, lamp.height, 0.16);
    poles.setMatrixAt(i, matrix.compose(at, quat, scale));
    // the head reaches out over the nearer lane
    place(lamp.s, side * (track.halfWidth + 0.2));
    at.y += lamp.height;
    quat.setFromAxisAngle(up, Math.atan2(frame.left.x, frame.left.z));
    heads.setMatrixAt(i, matrix.compose(at, quat, scale.set(1, 1, 1)));
  });
  poles.castShadow = true;

  return { scatter, posts, poles, heads };
}

/**
 * @typedef {object} World
 * @property {THREE.Scene} scene
 * @property {import('./lighting.js').TimeOfDay} time the time of day now showing
 * @property {(name: 'day'|'night') => import('./lighting.js').TimeOfDay} setTime switch the whole world: lights, sky,
 *   fog, environment map, lamps
 * @property {(dt: number, simTime: number) => void} update fixed step, deterministic (anything animated)
 * @property {(camera: THREE.Camera, focus: THREE.Vector3) => void} prepareView before each view is drawn: puts the
 *   shadow map round `focus` (the view's car)
 * @property {(n: number) => void} setStartLights the gantry's countdown lamps, 0..5 lit
 * @property {THREE.Object3D[]} probeHidden what to hide while a reflection probe is drawn
 * @property {number} wetness 0..1 road wetness (a hook for weather)
 * @property {() => void} refresh apply the numbers of lighting.js again after they were changed by hand
 * @property {() => void} restore draw again what only lived on the GPU, after a lost WebGL context has come back
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {object} options.track the Track (game/track.js): the road and its corridor
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('../../engine/params.js').Params} options.params
 * @returns {World}
 */
export function createWorld({ renderer, caps, tier, track, rng, params }) {
  const detail = DETAIL[tier];
  const scene = new THREE.Scene();

  renderer.shadowMap.enabled = params.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // ---- the land
  const groundShade = valueField(256, { seed: 3, cells: 6, octaves: 5 });
  const groundMap = fieldTexture(256, [
    groundShade.map((v) => toSrgb(0.09 + 0.07 * v)),
    groundShade.map((v) => toSrgb(0.12 + 0.07 * v)),
    groundShade.map((v) => toSrgb(0.07 + 0.04 * v)),
  ]);
  groundMap.colorSpace = THREE.SRGBColorSpace;
  groundMap.repeat.set(60, 60);
  // (cut into squares: across two triangles the size of the whole plain, depth is not interpolated finely enough
  // to keep the road, two centimetres higher, on top)
  const plain = new THREE.PlaneGeometry(3600, 3600, 72, 72).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(plain, new THREE.MeshStandardMaterial({ map: groundMap, roughness: 1 }));
  ground.receiveShadow = true;

  const roadTextures = createRoadTextures(caps, track.halfWidth);
  const roadMaterial = new THREE.MeshStandardMaterial({ ...roadTextures, normalScale: new THREE.Vector2(1, 1) });
  const road = new THREE.Mesh(createRoadGeometry(track), roadMaterial);
  road.receiveShadow = true;

  const furniture = createFurniture(track, rng, detail.scatter);
  scene.add(ground, road, furniture.scatter, furniture.posts, furniture.poles, furniture.heads);

  // ---- the sky: one dome in the scene, and its twin without the sun's disc for the environment map (the
  // directional light already makes the sun's highlight; the disc in the map would make a second one)
  const dome = new THREE.SphereGeometry(1, 32, 16);
  const sky = new THREE.Mesh(dome, createSkyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = 1000; // after everything solid: only the pixels still empty are shaded
  scene.add(sky);
  const envSky = new THREE.Mesh(dome, createSkyMaterial());
  envSky.frustumCulled = false;
  const envScene = new THREE.Scene().add(envSky);
  // PMREM needs half-float targets; without them the world is lit by the sun and the fill alone
  const pmrem = caps.hdr ? new THREE.PMREMGenerator(renderer) : null;
  const environments = new Map();

  // ---- the lights: always the same two
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(detail.shadowSize, detail.shadowSize);
  const reach = detail.shadowReach;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 500 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  const fill = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); // its two colours carry the brightness
  scene.add(sun, sun.target, fill);
  scene.fog = new THREE.FogExp2(0x000000, 0);

  let wetness = 0;
  const sunDir = new THREE.Vector3();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  function applySky(material, time, disc) {
    const u = material.uniforms;
    u.uZenith.value.fromArray(time.sky.zenith);
    u.uHorizon.value.fromArray(time.sky.horizon);
    u.uGround.value.fromArray(time.sky.ground);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.fromArray(time.sun.color);
    u.uGlow.value = time.sky.glow;
    u.uDisc.value.set(Math.cos(THREE.MathUtils.degToRad(time.sky.discSize)), disc ? time.sky.disc : 0);
    u.uStars.value = time.sky.stars;
  }

  /** @type {World} */
  const world = {
    scene,
    time: null,
    probeHidden: [],

    setTime(name) {
      const time = TIMES[name];
      world.time = time;
      sunDir.fromArray(time.sun.dir).normalize();
      sun.color.setRGB(...time.sun.color);
      sun.intensity = time.sun.intensity;
      // Without an environment map the fill also has to stand in for the sky itself: a flat sky of radiance L
      // lays PI * L on the ground.
      const skyShare = pmrem ? 0 : Math.PI / 2;
      const groundShare = pmrem ? 0 : Math.PI;
      const { ambient, sky: dome } = time;
      const above = ambient.sky.map((v, i) => v * ambient.intensity + (dome.zenith[i] + dome.horizon[i]) * skyShare);
      const below = ambient.ground.map((v, i) => v * ambient.intensity + dome.ground[i] * groundShare);
      fill.color.setRGB(...above);
      fill.groundColor.setRGB(...below);
      scene.fog.color.setRGB(...time.fog.color);
      scene.fog.density = time.fog.density;
      applySky(sky.material, time, true);
      furniture.heads.material.emissiveIntensity = LAMP_RADIANCE * time.lamps.street;

      if (pmrem) {
        if (!environments.has(name)) {
          applySky(envSky.material, time, false);
          environments.set(name, pmrem.fromScene(envScene, 0, 0.1, 10));
        }
        scene.environment = environments.get(name).texture;
      }
      return time;
    },

    update() {},

    prepareView(camera, focus) {
      // The shadow map covers a square of ground round a point a little ahead of the car, where the camera is
      // looking. Its centre moves in whole texels: a map that slides by fractions makes every shadow edge crawl.
      camera.getWorldDirection(ahead);
      ahead.y = 0;
      if (ahead.lengthSq() > 1e-6) ahead.normalize();
      centre.copy(focus).addScaledVector(ahead, reach * 0.45);
      lightRight.set(0, 1, 0).cross(sunDir).normalize();
      lightUp.crossVectors(sunDir, lightRight);
      const texel = (2 * reach) / detail.shadowSize;
      const x = Math.round(centre.dot(lightRight) / texel) * texel;
      const y = Math.round(centre.dot(lightUp) / texel) * texel;
      const z = centre.dot(sunDir);
      centre.set(0, 0, 0).addScaledVector(lightRight, x).addScaledVector(lightUp, y).addScaledVector(sunDir, z);
      sun.target.position.copy(centre);
      sun.position.copy(centre).addScaledVector(sunDir, 250);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },

    setStartLights() {},

    get wetness() {
      return wetness;
    },
    set wetness(value) {
      // all a placeholder can show of rain: darker, smoother asphalt
      wetness = Math.min(1, Math.max(0, value));
      roadMaterial.roughness = 0.88 - 0.6 * wetness;
      roadMaterial.color.setScalar(1 - 0.45 * wetness);
    },

    refresh() {
      for (const target of environments.values()) target.dispose();
      environments.clear();
      world.setTime(world.time.name);
    },

    restore() {
      // The environment maps went with the old context. They are dropped, not disposed: three.js would try to
      // delete their GL objects, which no longer belong to anything.
      environments.clear();
      world.setTime(world.time.name);
    },

    dispose() {
      for (const target of environments.values()) target.dispose();
      if (pmrem) pmrem.dispose();
      sun.shadow.dispose();
      scene.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        for (const key of ['map', 'normalMap']) if (object.material[key]) object.material[key].dispose();
        object.material.dispose();
      });
      envSky.material.dispose();
    },
  };

  world.wetness = params.wet;
  world.setTime(params.time);
  return world;
}
