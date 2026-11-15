// Dev-only viewer: /viewer.html?asset=craft&az=40&el=12&dist=9&t=3
// Shows one procedural asset (or the whole world) over the real sea + sky so
// it can be checked in isolation and screenshotted by tools/shot.cjs.

import * as THREE from 'three';
import { Engine } from './engine/Engine.js';
import { createEnvironment } from './assets/environment.js';
import { createWorld } from './game/World.js';
import { DEG } from './engine/math.js';
import { VIEWER_ASSETS } from './assets/registry.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);

const engine = new Engine(document.getElementById('app'), {
  pixelRatio: q.has('dpr') ? num('dpr', 1) : undefined,
});
const { scene, camera } = engine;

const asset = q.get('asset') || 'sea';
const az = num('az', 35) * DEG;
const el = num('el', 10) * DEG;
const dist = num('dist', 10);
const target = new THREE.Vector3(num('tx', 0), num('ty', 1), num('tz', 0));
let time = num('t', 0);
const spin = num('spin', 0);

let world = null;
let env = null;
if (asset === 'world') {
  world = createWorld(engine);
  env = world.env;
} else {
  env = createEnvironment(engine);
}

const subject = new THREE.Group();
scene.add(subject);
if (VIEWER_ASSETS[asset]) {
  const obj = VIEWER_ASSETS[asset](env, q);
  if (obj) subject.add(obj);
}

function placeCamera(extraAz = 0) {
  const a = az + extraAz;
  const ch = Math.cos(el);
  camera.position.set(target.x + Math.cos(a) * ch * dist, target.y + Math.sin(el) * dist, target.z + Math.sin(a) * ch * dist);
  camera.lookAt(target);
  camera.fov = num('fov', 55);
  camera.updateProjectionMatrix();
}

engine.onRender = (frameDt) => {
  time += frameDt;
  placeCamera(spin * time * DEG);
  subject.traverse((c) => c.userData.update && c.userData.update(time, frameDt));
  if (world) {
    world.update(time, frameDt);
    world.buoys.forEach((b) => b.userData.pose(time, 0));
    world.prepareView(time, camera, camera.position.x, camera.position.z);
  }
  else env.update(time, camera, target.x, target.z);
};

engine.start();
window.__viewer = { engine, env, world, subject };
window.__ready = true;
