// Dev-only (sealab.html, not part of the build): the water alone under the
// real light, for working on its shader without waiting for the world. The
// sky, the haze, the environment map, the sun with its shadow map, the
// frame's passes and the sea are the game's own (the same modules, the same
// numbers); what is left out is everything that takes a minute to build.
//
//   /sealab.html?land=toy&time=day&eye=40,6,-30&at=0,0,60&fov=50&t=12&manual
//
//   land=toy    (default) a made-up coast that has one of everything the water answers to: a beach shelving
//               gently for 100 m, a cliff, two sea stacks, an islet, a row of piers under a deck. Starts in a
//               second or two.
//   land=real   the game's terrain (and nothing else of its world): ten seconds or so. Positions are the game's.
//   eye=x,y,z   where the camera stands (m; the water's level is the Track's lake level, about -1.8)
//   at=x,y,z    what it looks at          fov=50   the lens, top to bottom
//   look={"surf":{"spacing":8}}   other numbers for SEA_LOOK (sea.js), merged into it before the sea is made
//   t=12        the waves' clock (s)      time, q, sea, manual, dpr, post, ldr, ev: as in the game (engine/params.js)
//
// The handle: __sealab.read(x, y, half) the picture's colour round a CSS pixel ([r, g, b], 0..255);
// __sealab.view({ eye, at, fov }) moves the camera ({ eye, sunward: -4 } looks towards the sun, 4 degrees down); __sealab.clock(t) runs the waves' clock on to t;
// __sealab.sea, .scene, .pipeline, .engine. tools/sealab.cjs takes a list of views in one go.

import * as THREE from 'three';
import { Engine } from './engine/Engine.js';
import { FramePipeline } from './engine/FramePipeline.js';
import { PlanarMirror } from './engine/PlanarMirror.js';
import { TIERS, probeCaps } from './engine/caps.js';
import { parseParams } from './engine/params.js';
import { createRng } from './engine/rng.js';
import { createAtmosphere } from './assets/world/atmosphere.js';
import { createEnvironment } from './assets/world/environment.js';
import { createGroundMaterial } from './assets/world/groundMaterial.js';
import { TIMES, placeLights } from './assets/world/lighting.js';
import { SEA_LOOK, createSea } from './assets/world/sea.js';
import { selectBake } from './assets/world/shading.js';
import { createSky } from './assets/world/sky.js';
import { createSun } from './assets/world/sun.js';
import { createTerrain } from './assets/world/terrain.js';
import { createTrack } from './game/track.js';

const params = parseParams();
const query = new URLSearchParams(location.search);
if (!params.time) params.time = 'day';
const numbers = (key, fallback) => {
  const list = (query.get(key) || '').split(',').map(parseFloat);
  return list.length === fallback.length && list.every(Number.isFinite) ? list : fallback;
};

const engine = new Engine(document.getElementById('app'), { manual: params.manual, pixelRatio: params.dpr });
const caps = probeCaps(engine.renderer, { ldr: params.ldr });
const tier = params.quality ?? caps.tier;
engine.setMaxPixelRatio(TIERS[tier].pixelRatio);
const pipeline = new FramePipeline(engine.renderer, caps, { tier, post: params.post });
const rng = createRng(params.seed);

const scene = new THREE.Scene();
const atmosphere = createAtmosphere(caps);
const real = query.get('land') === 'real';
const LEVEL = -1.8;

/** The toy coast: heights (m) over a level sea at LEVEL. See the header. */
function toyCoast() {
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const piers = [];
  for (let i = 0; i < 6; i++) piers.push({ x: -150 - 48 * i, z: 150 + 20 * i, r: 0.95, top: LEVEL + 15 });
  const heightAt = (x, z) => {
    // the mainland lies towards -Z; its shore wanders a little
    const shore = z - 14 * Math.sin(x / 90) - 6 * Math.sin(x / 31 + 1);
    // east (x > 0) a beach: 1 in 25 through the water's edge, a dune behind; west a cliff 22 m high over deep water
    const beach = shore < 0 ? Math.min(9, -shore / 14) + 2.5 * smooth(10, 40, -shore) : -shore / 25 - 8 * smooth(100, 220, shore);
    const cliff = shore < 0 ? 22 * smooth(0, 9, -shore) : -4 - shore * 0.45;
    const w = smooth(-60, 40, x);
    let h = cliff + (beach - cliff) * w;
    // two stacks off the beach, an islet further out
    for (const s of [{ x: 70, z: 55, r: 9, h: 24 }, { x: 96, z: 62, r: 6, h: 13 }, { x: 260, z: 420, r: 70, h: 38 }]) {
      const d = Math.hypot(x - s.x, z - s.z) / s.r;
      if (d < 2.2) h = Math.max(h, s.h * (1 - smooth(0.35, 1.5, d)) - 3 * smooth(1.2, 2.2, d) + Math.min(0, h) * smooth(1.0, 2.2, d));
    }
    return LEVEL + Math.max(-45, h);
  };
  // the sea map as terrain.js writes it, from this height function (coarse: 512 texels over 4.8 km)
  const size = 512;
  const half = 2400;
  const step = (2 * half) / size;
  const data = new Uint8Array(size * size * 4);
  const toWater = new Float32Array(size * size);
  const toLand = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const depth = Math.max(0, LEVEL - heightAt(-half + (i + 0.5) * step, -half + (j + 0.5) * step));
      toWater[k] = depth > 0 ? 0 : 1e9;
      toLand[k] = depth > 0 ? 1e9 : 0;
      data[k * 4] = Math.round(255 * Math.sqrt(Math.min(1, depth / 64)));
      data[k * 4 + 3] = 255;
    }
  }
  for (const field of [toWater, toLand]) {
    const b = step * Math.SQRT2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i;
        let v = field[k];
        if (i > 0) v = Math.min(v, field[k - 1] + step);
        if (j > 0) v = Math.min(v, field[k - size] + step, i > 0 ? field[k - size - 1] + b : 1e9, i < size - 1 ? field[k - size + 1] + b : 1e9);
        field[k] = v;
      }
    }
    for (let j = size - 1; j >= 0; j--) {
      for (let i = size - 1; i >= 0; i--) {
        const k = j * size + i;
        let v = field[k];
        if (i < size - 1) v = Math.min(v, field[k + 1] + step);
        if (j < size - 1) v = Math.min(v, field[k + size] + step, i < size - 1 ? field[k + size + 1] + b : 1e9, i > 0 ? field[k + size - 1] + b : 1e9);
        field[k] = v;
      }
    }
  }
  for (let k = 0; k < size * size; k++) {
    data[k * 4 + 1] = Math.round(255 * Math.min(1, toWater[k] / 500));
    data[k * 4 + 2] = Math.round(255 * Math.min(1, toLand[k] / 160));
  }
  const sea = { level: LEVEL, at: () => 1, sector: () => 1, map: { size, x0: -half, z0: -half, extent: 2 * half, data }, stacks: [], surf: null };
  // the land as a plain mesh: sand low down, rock where it is steep, scrub above
  const n = 400;
  const span = 1200;
  const geometry = new THREE.PlaneGeometry(span, span, n, n).rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const color = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    // finer near the shore's middle: the grid is squeezed towards the origin
    const x = pos.getX(k) * (0.35 + 0.65 * Math.abs(pos.getX(k)) / (span / 2));
    const z = pos.getZ(k) * (0.35 + 0.65 * Math.abs(pos.getZ(k)) / (span / 2));
    const y = heightAt(x, z);
    pos.setXYZ(k, x, y, z);
    const slope = Math.hypot(heightAt(x + 1, z) - y, heightAt(x, z + 1) - y);
    const up = y - LEVEL;
    const rock = smooth(0.35, 0.8, slope);
    const scrub = smooth(3, 7, up) * (1 - rock);
    const c = [0.36 + (0.12 - 0.36) * rock, 0.33 + (0.1 - 0.33) * rock, 0.27 + (0.08 - 0.27) * rock];
    color[k * 3] = c[0] + (0.06 - c[0]) * scrub;
    color[k * 3 + 1] = c[1] + (0.09 - c[1]) * scrub;
    color[k * 3 + 2] = c[2] + (0.04 - c[2]) * scrub;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  const land = new THREE.Mesh(geometry, atmosphere.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  land.receiveShadow = true;
  land.castShadow = true;
  land.matrixAutoUpdate = false;
  // the piers off the cliff, with a deck across them
  const group = new THREE.Group();
  const concrete = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x9a968d, roughness: 0.92 }));
  for (const p of piers) {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.3, 21, 1.45), concrete);
    shaft.position.set(p.x, LEVEL + 4.5, p.z);
    shaft.rotation.y = -Math.atan2(20, -48);
    shaft.castShadow = true;
    group.add(shaft);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(290, 2.6, 11), concrete);
  deck.position.set(-270, LEVEL + 16.3, 200);
  deck.rotation.y = -Math.atan2(20, -48);
  deck.castShadow = true;
  group.add(land, deck);
  return { sea, heightAt, group, groundMaterial: null, piers };
}

/** The game's terrain, with nothing else of its world. */
function realCoast() {
  const track = createTrack();
  const line = track.frameAt(0, {});
  placeLights(Math.atan2(line.tan.x, line.tan.z) / (Math.PI / 180));
  const groundMaterial = createGroundMaterial({ caps, tier, atmosphere });
  const terrain = createTerrain({
    track,
    tier,
    rng: rng.fork('terrain'),
    material: groundMaterial.material,
    lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
  });
  return { sea: terrain.sea, heightAt: terrain.heightAt, group: terrain.group, groundMaterial, track };
}

// other numbers for the water's look, for trying them side by side
{
  const merge = (to, from) => {
    for (const [key, value] of Object.entries(from)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && to[key] && typeof to[key] === 'object') merge(to[key], value);
      else to[key] = value;
    }
  };
  if (query.get('look')) merge(SEA_LOOK, JSON.parse(query.get('look')));
}
if (!real) placeLights(90);
const coast = real ? realCoast() : toyCoast();
const sky = createSky({ tier, rng: rng.fork('sky'), atmosphere });
const environment = createEnvironment({ renderer: engine.renderer, caps, sky, atmosphere });
const sun = createSun({ renderer: engine.renderer, tier, shadows: params.shadows });
scene.onBeforeRender = (_renderer, _scene, camera) => sun.beforeRender(camera);
// (as world/index.js: the water's planar mirror on high)
const mirror = tier === 'high' && caps.hdr ? new PlanarMirror(engine.renderer, caps, { scale: 0.3, far: 3000, streak: 0.4, clipBias: 0.3 }) : null;
const sea = createSea({ caps, tier, atmosphere, sea: coast.sea, heightAt: coast.heightAt, far: 5000, mirror, detail: params.sea });
if (coast.piers) sea.setPiers(coast.piers);
scene.add(coast.group, sea.mesh, sky.dome, sky.stars, ...sun.objects);
scene.fog = atmosphere.fog;

environment.build();
const time = TIMES[params.time] ?? TIMES.day;
atmosphere.setTime(time);
sky.setTime(time);
selectBake(time.name);
sun.setTime(
  time,
  time.ambient.sky.map((v) => v * time.ambient.intensity),
  time.ambient.ground.map((v) => v * time.ambient.intensity),
);
scene.environment = environment.get(time.name);
scene.environmentIntensity = time.env.intensity;
sea.setTime(time);
coast.groundMaterial?.setTime(time);

const view = { eye: numbers('eye', real ? [-620, 12, 60] : [30, 5, -40]), at: numbers('at', real ? [-900, 0, -200] : [20, -1, 60]), fov: parseFloat(query.get('fov')) || 50 };
const camera = new THREE.PerspectiveCamera(view.fov, 1, 0.3, 5000);
const focus = new THREE.Vector3();
const mirrorPoint = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function placeCamera() {
  camera.fov = view.fov;
  camera.aspect = engine.aspect;
  camera.position.fromArray(view.eye);
  camera.lookAt(focus.fromArray(view.at));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

const frame = { exposure: time.exposure * 2 ** (parseFloat(query.get('ev')) || 0), look: time.look, motionBlur: 0, cut: true, sharp: [] };
const rect = { x: 0, y: 0, w: 1, h: 1 };
const drawing = new THREE.Vector2();
engine.onResize(() => {
  rect.w = engine.bufferWidth;
  rect.h = engine.bufferHeight;
});
engine.onUpdate = (dt, simTime) => {
  sky.update(dt, simTime);
  sea.update(simTime);
};
engine.onRender = placeCamera;
engine.onDraw = () => {
  // the shadow map round what the camera looks at, some way in front of it
  focus.fromArray(view.at).sub(camera.position).setLength(30).add(camera.position);
  sun.prepareView(camera, focus);
  atmosphere.prepareView(camera);
  engine.renderer.getDrawingBufferSize(drawing);
  const viewHeight = Math.min(drawing.y, drawing.x / (camera.aspect || 1));
  sea.prepareView(camera, viewHeight);
  if (mirror) {
    if (sea.mirrored(camera.position)) mirror.render(scene, camera, mirrorPoint.set(camera.position.x, coast.sea.level, camera.position.z), UP, [sea.mesh, sky.stars], viewHeight);
    else mirror.uniforms.uMirrorOn.value = 0;
  }
  pipeline.render(scene, camera, rect, frame);
};

function read(x, y, half = 2) {
  engine.advance(0);
  const gl = engine.renderer.getContext();
  const n = 2 * half + 1;
  const bytes = new Uint8Array(n * n * 4);
  gl.readPixels(Math.round(x * engine.pixelRatio) - half, engine.bufferHeight - 1 - Math.round(y * engine.pixelRatio) - half, n, n, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const sum = [0, 0, 0];
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) sum[c] += bytes[i * 4 + c];
  return sum.map((v) => Math.round((v / (n * n)) * 10) / 10);
}

window.__sealab = {
  engine,
  pipeline,
  scene,
  sea,
  coast,
  camera,
  read,
  view(change = {}) {
    Object.assign(view, change);
    // { eye, sunward: pitch }: looking towards the sun (the moon), `pitch` degrees up
    if (change.sunward !== undefined) {
      const d = time.sun.dir;
      const flat = Math.hypot(d[0], d[2]) || 1;
      view.at = [view.eye[0] + (1000 * d[0]) / flat, view.eye[1] + 1000 * Math.tan((change.sunward * Math.PI) / 180), view.eye[2] + (1000 * d[2]) / flat];
    }
    if (engine.manual) engine.advance(0);
    return { ...view };
  },
  /** Run the waves' clock forward to `t` seconds (it does not run back) and draw. */
  clock(t) {
    const frames = Math.round((t - engine.simTime) * 60);
    for (let i = 0; i < frames; i++) engine.advance(1 / 60, 1 / 60, false);
    engine.advance(0);
    return engine.simTime;
  },
};

// (the waves' clock is the engine's: ?t= runs it forward before the first picture)
const start = params.preAdvance ?? 0;
for (let i = 0; i < Math.round(start * 60); i++) engine.advance(1 / 60, 1 / 60, false);
engine.advance(0);
engine.start();
window.__ready = true;
