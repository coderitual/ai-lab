// Dev only (used by viewer.js, never by the game): what it takes to stand a
// camera on the real road and to judge the light there.
//
//   placeOnRoad()    an object's place and attitude at track coordinates
//   roadCamera()     a camera standing on the road, or looking straight down at it
//   createLightTest()  a grey card, a white card, a chrome ball and a matt ball
//   createTreeLab()  the light of the world without the world: single trees in seconds
//
// The light test is how the numbers of lighting.js are checked: the grey card
// is 18 % and lies flat, so in open sun at the day's exposure it should come
// out at middle grey; the white card beside it is the "sheet of paper" the
// units are defined by; the chrome ball shows the environment map and the
// sun's highlight, the matt ball where the light comes from.

import * as THREE from 'three';
import { createAtmosphere } from './atmosphere.js';
import { createEnvironment } from './environment.js';
import { CASTER_LAYER, createTreeKit } from './forest.js';
import { TIMES, placeLights } from './lighting.js';
import { selectBake } from './shading.js';
import { createSky } from './sky.js';
import { createSun } from './sun.js';
import { TIERS } from '../../engine/caps.js';

const DEG = Math.PI / 180;
const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
const basis = new THREE.Matrix4();
const forward = new THREE.Vector3();
const level = new THREE.Vector3();

/**
 * Puts `object` on the road's surface at (s, lat), in the road's own frame there: +Z along the road, +Y square to
 * the surface, +X to the left (car space, so a car placed like this stands on its wheels).
 * @param {object} track the Track @param {number} s @param {number} lat @param {THREE.Object3D} object
 */
export function placeOnRoad(track, s, lat, object) {
  track.frameAt(s, frame);
  if (track.pointAt) track.pointAt(s, lat, object.position);
  else object.position.copy(frame.pos).addScaledVector(frame.left, lat);
  // (left is level with the cross-section, a hair off square to the tangent on a banked climb: rebuilt from the other two)
  frame.left.crossVectors(frame.up, frame.tan).normalize();
  frame.tan.crossVectors(frame.left, frame.up);
  object.quaternion.setFromRotationMatrix(basis.makeBasis(frame.left, frame.up, frame.tan));
  object.updateMatrixWorld();
  return object;
}

/**
 * @typedef {object} RoadView
 * @property {number} s track distance of the subject (m)
 * @property {number} lat metres left of the centre line
 * @property {number} back metres before `s` at which the camera stands
 * @property {number} h height of the camera above the road (m)
 * @property {number} look degrees the camera is turned off the road's direction (positive: to the left)
 * @property {number} pitch degrees above the horizontal
 * @property {number|null} top metres across the picture for a view from straight above (null: a standing camera)
 */

/**
 * Stands `camera` on the road as `view` says. From above, the picture is a true map as tools/trackmap.mjs draws
 * it: +Z up the page, +X to the left, centred on (s, lat).
 * @param {object} track @param {RoadView} view
 * @param {THREE.PerspectiveCamera|THREE.OrthographicCamera} camera @param {number} aspect width / height
 */
export function roadCamera(track, view, camera, aspect) {
  if (view.top) {
    placeOnRoad(track, view.s, view.lat, camera);
    camera.position.y = 1400;
    camera.up.set(0, 0, 1);
    camera.lookAt(camera.position.x, camera.position.y - 1, camera.position.z);
    camera.left = -view.top / 2;
    camera.right = view.top / 2;
    camera.top = view.top / 2 / aspect;
    camera.bottom = -view.top / 2 / aspect;
    camera.near = 1;
    camera.far = 2400;
  } else {
    const s = view.s - view.back;
    placeOnRoad(track, s, view.clat ?? view.lat, camera);
    track.frameAt(s, frame);
    camera.position.addScaledVector(frame.up, view.h);
    // heading from the road's direction on the map, pitch from the horizontal
    const yaw = Math.atan2(frame.tan.x, frame.tan.z) + view.look * DEG;
    const pitch = view.pitch * DEG;
    level.set(Math.sin(yaw), 0, Math.cos(yaw));
    forward.copy(level).multiplyScalar(Math.cos(pitch));
    forward.y = Math.sin(pitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(forward.add(camera.position));
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/**
 * The cards and balls, in a group to be placed with placeOnRoad(): the grey card lies half a metre to the left of
 * the group's origin, the white one to the right, the chrome ball stands behind the grey card and the matt ball
 * behind the white one. With `shade`, a screen stands between them and the light and they lie in its shadow,
 * under the open sky.
 *
 * @param {object} options
 * @param {'sun'|'shade'} options.mode
 * @param {number[]} options.towardsLight the light's direction, in the group's own frame
 * @returns {{ group: THREE.Group, points: Record<string, [number, number, number]>, dispose: () => void }} `points`:
 *   the middle of each thing, in the group's frame (for reading the picture there)
 */
export function createLightTest({ mode, towardsLight }) {
  const group = new THREE.Group();
  const grey = (v) => new THREE.Color().setRGB(v, v, v);
  const made = [];
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    made.push(geometry, material);
    return mesh;
  };

  // Matt through and through (no sheen at a glancing angle): what is read off them is light, not surface.
  const card = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
  add(card, new THREE.MeshLambertMaterial({ color: grey(0.18) }), 0.65, 0.012, 0);
  add(card, new THREE.MeshLambertMaterial({ color: grey(0.9) }), -0.65, 0.012, 0);
  const ball = new THREE.SphereGeometry(0.3, 48, 24);
  add(ball, new THREE.MeshStandardMaterial({ color: grey(0.95), metalness: 1, roughness: 0.03 }), 0.65, 0.75, 1.5);
  add(ball, new THREE.MeshStandardMaterial({ color: grey(0.18), metalness: 0, roughness: 1 }), -0.65, 0.75, 1.5);
  const post = new THREE.CylinderGeometry(0.02, 0.02, 0.45).translate(0, 0.225, 0);
  const steel = new THREE.MeshStandardMaterial({ color: grey(0.05), roughness: 0.6 });
  add(post, steel, 0.65, 0, 1.5);
  add(post, steel, -0.65, 0, 1.5);

  if (mode === 'shade') {
    // a screen two metres towards the light, tall and wide enough for a light 24 or 50 degrees up
    const azimuth = Math.atan2(towardsLight[0], towardsLight[2]);
    const screen = add(new THREE.BoxGeometry(5, 4.5, 0.06).translate(0, 2.25, 0), new THREE.MeshLambertMaterial({ color: grey(0.03) }), 0, 0, 0.6);
    screen.position.x += Math.sin(azimuth) * 2;
    screen.position.z += Math.cos(azimuth) * 2;
    screen.rotation.y = azimuth;
  }

  return {
    group,
    points: { grey: [0.65, 0.012, 0], white: [-0.65, 0.012, 0], chrome: [0.65, 0.75, 1.5], matt: [-0.65, 0.75, 1.5] },
    dispose() {
      for (const thing of new Set(made)) thing.dispose();
    },
  };
}

/**
 * (trees lane) The tree lab: the sky, the sun and its shadow, the haze and the environment map of the real world
 * round a bare field, and the forest's tree kit, with nothing else built: `viewer.html?asset=tree&lab=1` starts in a
 * few seconds where the whole world needs a minute or two. It answers to the part of the World's interface the
 * viewer uses. The straight is taken to run towards +X, as on the map.
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('../../engine/params.js').Params} options.params
 */
export function createTreeLab({ renderer, caps, tier, rng, params }) {
  const scene = new THREE.Scene();
  placeLights(90);
  const atmosphere = createAtmosphere(caps);
  const sky = createSky({ tier, rng: rng.fork('sky'), atmosphere });
  const environment = createEnvironment({ renderer, caps, sky, atmosphere });
  const sun = createSun({ renderer, tier, shadows: params.shadows });
  scene.onBeforeRender = (_renderer, _scene, camera) => sun.beforeRender(camera);
  const coverage = (TIERS[tier]?.msaa ?? 0) > 0 && !(caps.hdr && !caps.msaaHdr) && caps.maxSamples > 0;
  const kit = createTreeKit({ renderer, tier, coverage, rng: rng.fork('forest'), atmosphere });
  sun.light.shadow.camera.layers.enable(CASTER_LAYER);
  // a field of mown grass, and far behind the tree a dark wall (what a crown is seen against in the wood)
  const field = new THREE.Mesh(
    new THREE.CircleGeometry(600, 48).rotateX(-Math.PI / 2),
    atmosphere.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.1, 0.13, 0.05), roughness: 1 })),
  );
  field.receiveShadow = true;
  const group = new THREE.Group();
  scene.add(field, group, sky.dome, sky.stars, ...sun.objects);
  scene.fog = atmosphere.fog;
  const world = {
    scene,
    time: null,
    probeHidden: [sky.stars],
    atmosphere,
    /** As World.forest, as far as single trees go. */
    forest: { specimen: kit.specimen, group, atlas: kit.atlas, uniforms: kit.uniforms, kit, stats: { ms: kit.ms, bytes: kit.bytes, triangles: kit.models.map((m) => m.triangles) } },
    stats: { ms: kit.ms },
    setTime(name) {
      const time = TIMES[name] ?? TIMES.day;
      world.time = time;
      atmosphere.setTime(time);
      sky.setTime(time);
      selectBake(time.name);
      const above = time.ambient.sky.map((v) => v * time.ambient.intensity);
      const below = time.ambient.ground.map((v) => v * time.ambient.intensity);
      sun.setTime(time, above, below);
      scene.environment = environment.get(time.name);
      scene.environmentIntensity = time.env.intensity;
      kit.uniforms.uWind.value.z = time.name === 'night' ? 0.5 : 1;
      kit.uniforms.uWet.value = params.wet ?? time.wetness ?? 0;
      return time;
    },
    update(dt, simTime) {
      sky.update(dt, simTime);
      kit.uniforms.uTime.value = simTime;
    },
    prepareView(camera, focus) {
      sun.prepareView(camera, focus);
      atmosphere.prepareView(camera);
    },
    restore() {
      environment.forget();
      environment.build();
      world.setTime(world.time.name);
    },
    dispose() {
      environment.dispose();
      sun.dispose();
      sky.dispose();
      kit.dispose();
    },
  };
  environment.build();
  world.setTime(params.time);
  world.update(0, 0);
  return world;
}
