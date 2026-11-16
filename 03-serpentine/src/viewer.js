// Dev-only viewer (viewer.html, not part of the build): one asset under the
// real light, seen through a camera whose every number is given in the URL.
// tools/shot.cjs photographs it.
//
//   /viewer.html?asset=car&time=day&az=150&el=12&dist=7.5
//   /viewer.html?asset=car&ortho=side&manual
//
// What is shown
//   asset=car      the car, standing on the road in the world (on the grid, or at s=)
//   asset=world    the world alone, looking at the same spot
//   time=day|night   q=low|medium|high   paint=NAME   plate=TEXT   manual   post=0   dpr=N   (as in the game)
//   lights=off|drl|low|high|brake|all    the car's lamps (default: what the time of day asks for)
//   s=120          track distance to stand at (default: the first grid slot)
//
// The camera. All positions are in the frame of the thing looked at, which
// for the car is car space: origin on the ground midway between the axles,
// +Z forward, +Y up, +X the car's left. Metres and degrees.
//
//   tx, ty, tz     the point looked at; it lands in the middle of the picture.
//                  Default: the middle of the asset's bounding box.
//   az             where the camera stands, as a compass bearing round that point seen from above:
//                  0 = in front, looking at the nose; 90 = at the car's left side; 180 = behind;
//                  270 = at its right side.
//   el             how high it stands, as an angle above the horizontal (90 = straight above).
//   dist           how far from the point it stands.
//   fov            the lens, top to bottom.
//                  The camera is at  target + dist * (sin az * cos el,  sin el,  cos az * cos el).
//
//   ortho=side|front|rear|top    a true orthographic projection instead, for laying a render over a drawing.
//                  The asset is shown alone on plain grey (the world's meshes are hidden, its light stays).
//                    side    from the car's left, nose pointing left          (az 90,  el 0)
//                    front   nose on, the car's left on the picture's right   (az 0,   el 0)
//                    rear    tail on, the car's left on the picture's left    (az 180, el 0)
//                    top     from above, nose pointing left, the car's left side at the bottom
//                  side and top line up under each other; front and rear are mirror images.
//   span           metres across the picture's full width in an ortho view. Default: the smallest that shows
//                  the whole bounding box with 6 % to spare on each side. One CSS pixel is span / width metres;
//                  that number is in the page title and in what __viewer.view() returns.
//
// The handle
//   __viewer.view()            the camera as it is: { az, el, dist, fov, target, ortho, span, width, height,
//                              metresPerPixel, pixelsPerMetre, origin }  (origin: the CSS pixel where the
//                              asset's own origin lands, from the top left; the scale fields are null in perspective)
//   __viewer.view({ az: 30 })  change any of az, el, dist, fov, tx, ty, tz, ortho ('' for none), span; redraws
//   __viewer.project(x, y, z)  the CSS pixel where a point of the asset's frame lands
//   __viewer.frames(n)         run and draw n frames, a sixtieth of a second apart (for ?manual)
//   __viewer.car, .world, .engine, .pipeline, .stand (the Object3D the asset stands in)

import * as THREE from 'three';
import { createCar } from './assets/car/index.js';
import { createWorld } from './assets/world/index.js';
import { Engine } from './engine/Engine.js';
import { FramePipeline } from './engine/FramePipeline.js';
import { TIERS, probeCaps } from './engine/caps.js';
import { encodeForTarget } from './engine/glsl.js';
import { DEG } from './engine/math.js';
import { parseParams } from './engine/params.js';
import { createRng } from './engine/rng.js';
import { LAMPS } from './game/config.js';
import { createPlaceholderTrack } from './game/placeholder.js';

const params = parseParams();
const given = params.viewer;

const engine = new Engine(document.getElementById('app'), { manual: params.manual, pixelRatio: params.dpr });
const caps = probeCaps(engine.renderer, { ldr: params.ldr });
const tier = params.quality ?? caps.tier;
engine.setMaxPixelRatio(TIERS[tier].pixelRatio);
const pipeline = new FramePipeline(engine.renderer, caps, { tier, post: params.post });
const track = createPlaceholderTrack();
const world = createWorld({ renderer: engine.renderer, caps, tier, track, rng: createRng(params.seed), params });
const time = world.time;

// ---- where the asset stands: the frame the camera's numbers are measured in
const stand = new THREE.Group();
if (given.s !== undefined) {
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  track.frameAt(given.s, frame);
  stand.position.copy(frame.pos);
  stand.rotation.y = Math.atan2(frame.tan.x, frame.tan.z);
} else {
  const place = track.grid(0, { x: 0, y: 0, z: 0, yaw: 0 });
  stand.position.set(place.x, place.y, place.z);
  stand.rotation.y = place.yaw;
}
world.scene.add(stand);
stand.updateMatrixWorld();

/** What the `lights` parameter means, as values for CarModel.setLights. */
function lampPreset(name) {
  const off = { drl: 0, low: 0, high: 0, tail: 0, brake: 0, reverse: 0, indicatorL: 0, indicatorR: 0, interior: 0 };
  const auto = LAMPS[time.carLights];
  if (name === 'off') return off;
  if (name === 'drl') return { ...off, ...LAMPS.drl };
  if (name === 'low') return { ...off, ...LAMPS.low };
  if (name === 'high') return { ...off, ...LAMPS.low, high: 1 };
  if (name === 'brake') return { ...off, ...auto, brake: 1 };
  if (name === 'all') return { drl: 1, low: 1, high: 1, tail: 1, brake: 1, reverse: 1, indicatorL: 1, indicatorR: 1, interior: 1 };
  return { ...off, ...auto };
}

/**
 * The assets the viewer knows. Each builder puts its thing into `stand` and returns the box the camera frames
 * (in the stand's frame) and the view it is first seen from; anything else it returns ends up on __viewer.
 * A lane that builds a new asset adds a line here.
 */
const ASSETS = {
  car() {
    const car = createCar({ paint: params.paint ?? undefined, plate: params.plate ?? undefined, tier, caps });
    car.setLights(lampPreset(given.lights));
    car.setReflections({ cube: null, sky: 1 });
    stand.add(car.object);
    return { car, box: car.box, view: { az: 150, el: 12, dist: 7.5, fov: 40 } };
  },
  world() {
    const box = { center: new THREE.Vector3(0, 1.2, 0), half: new THREE.Vector3(6, 1.2, 6) };
    return { box, view: { az: 180, el: 10, dist: 14, fov: 50 } };
  },
};
const assetName = ASSETS[given.asset] ? given.asset : 'car';
const asset = ASSETS[assetName]();

// ---- the camera
const view = {
  az: given.az ?? asset.view.az,
  el: given.el ?? asset.view.el,
  dist: given.dist ?? asset.view.dist,
  fov: given.fov ?? asset.view.fov,
  tx: given.tx ?? asset.box.center.x,
  ty: given.ty ?? asset.box.center.y,
  tz: given.tz ?? asset.box.center.z,
  ortho: given.ortho,
  span: given.span ?? null,
};

/** Each ortho view: where the camera stands, which way is up in the picture, and the box's width and height in it. */
const ORTHO = {
  side: { az: 90, el: 0, up: [0, 1, 0], extent: (h) => [2 * h.z, 2 * h.y] },
  front: { az: 0, el: 0, up: [0, 1, 0], extent: (h) => [2 * h.x, 2 * h.y] },
  rear: { az: 180, el: 0, up: [0, 1, 0], extent: (h) => [2 * h.x, 2 * h.y] },
  top: { az: 0, el: 90, up: [-1, 0, 0], extent: (h) => [2 * h.z, 2 * h.x] },
};
/** How far an ortho camera stands back. It changes nothing in the picture; it only has to clear the asset. */
const ORTHO_DISTANCE = 60;

const perspective = new THREE.PerspectiveCamera(view.fov, 1, 0.05, 5000);
const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, ORTHO_DISTANCE * 2);
let camera = perspective;
/** Metres across the picture's width in the ortho view now showing. */
let span = 0;

// in an ortho view the world's own meshes are hidden and the asset stands on plain grey
const worldMeshes = [];
world.scene.traverse((object) => {
  if (object.isMesh || object.isPoints || object.isLine || object.isSprite) worldMeshes.push(object);
});
const inStand = (object) => {
  for (let o = object; o; o = o.parent) if (o === stand) return true;
  return false;
};
const scenery = worldMeshes.filter((object) => !inStand(object));
// a light grey at any exposure
const paper = encodeForTarget(0.5 / time.exposure, !caps.hdr);
const backdrop = new THREE.Color().setRGB(paper, paper, paper);

const target = new THREE.Vector3();
const offset = new THREE.Vector3();
const up = new THREE.Vector3();
const point = new THREE.Vector3();

function placeCamera() {
  const ortho = ORTHO[view.ortho] || null;
  const az = (ortho ? ortho.az : view.az) * DEG;
  const el = (ortho ? ortho.el : view.el) * DEG;
  const dist = ortho ? ORTHO_DISTANCE : view.dist;
  camera = ortho ? orthographic : perspective;

  target.set(view.tx, view.ty, view.tz);
  offset.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
  camera.position.copy(target).add(offset).applyMatrix4(stand.matrixWorld);
  camera.up.copy(up.fromArray(ortho ? ortho.up : [0, 1, 0]).transformDirection(stand.matrixWorld));
  camera.lookAt(target.applyMatrix4(stand.matrixWorld));

  if (ortho) {
    const [w, h] = ortho.extent(asset.box.half);
    span = view.span ?? Math.max(w, h * engine.aspect) * 1.12;
    orthographic.left = -span / 2;
    orthographic.right = span / 2;
    orthographic.top = span / 2 / engine.aspect;
    orthographic.bottom = -span / 2 / engine.aspect;
  } else {
    perspective.fov = view.fov;
    perspective.aspect = engine.aspect;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  for (const object of scenery) object.visible = !ortho;
  world.scene.background = ortho ? backdrop : null;
  frame.look = ortho ? flatLook : time.look;
  const mm = ((span / engine.width) * 1000).toFixed(3);
  const title = `viewer · ${assetName} · ${ortho ? `${view.ortho} · ${mm} mm/px` : `az ${view.az} el ${view.el} dist ${view.dist}`}`;
  if (document.title !== title) document.title = title;
}

/** The CSS pixel (from the top left) where a point of the asset's frame lands. */
function project(x, y, z) {
  point.set(x, y, z).applyMatrix4(stand.matrixWorld).project(camera);
  return [(point.x * 0.5 + 0.5) * engine.width, (0.5 - point.y * 0.5) * engine.height];
}

function describe() {
  const ortho = ORTHO[view.ortho] ? view.ortho : null;
  return {
    asset: assetName,
    az: ortho ? ORTHO[ortho].az : view.az,
    el: ortho ? ORTHO[ortho].el : view.el,
    dist: ortho ? null : view.dist,
    fov: ortho ? null : view.fov,
    target: [view.tx, view.ty, view.tz],
    ortho,
    span: ortho ? span : null,
    width: engine.width,
    height: engine.height,
    metresPerPixel: ortho ? span / engine.width : null,
    pixelsPerMetre: ortho ? engine.width / span : null,
    origin: project(0, 0, 0),
  };
}

// ---- the frame
const frame = { exposure: time.exposure, look: time.look, motionBlur: 0, cut: true, sharp: [] };
// a drawing has no dark corners
const flatLook = { ...time.look, vignette: 0 };
const rect = { x: 0, y: 0, w: 1, h: 1 };
const focus = new THREE.Vector3();

engine.onResize(() => {
  rect.w = engine.bufferWidth;
  rect.h = engine.bufferHeight;
  pipeline.scale = engine.renderScale;
});
engine.onContextRestored(() => world.restore());
engine.onUpdate = (dt, simTime) => world.update(dt, simTime);
engine.onRender = placeCamera;
engine.onDraw = () => {
  world.prepareView(camera, stand.getWorldPosition(focus));
  pipeline.render(world.scene, camera, rect, frame);
};

window.__viewer = {
  engine,
  pipeline,
  world,
  stand,
  car: asset.car ?? null,
  /** Run and draw `n` frames, a sixtieth of a second apart. */
  frames(n = 1) {
    for (let i = 0; i < n; i++) engine.advance(1 / 60);
  },
  /** Change the camera (any of az, el, dist, fov, tx, ty, tz, ortho, span) and say where it now is. */
  view(change = {}) {
    for (const key of Object.keys(change)) {
      if (!(key in view)) throw new Error(`Unknown view setting: ${key}`);
      view[key] = change[key];
    }
    if (engine.manual) engine.advance(0);
    else placeCamera();
    return describe();
  },
  project,
};

engine.advance(0);
engine.start();
window.__ready = true;
