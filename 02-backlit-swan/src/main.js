// Entry point: starts the engine, builds the world, and leaves a small handle
// on the page for tests and for poking around in the console.
//
// URL parameters are described in engine/params.js.

import { Engine, FIXED_DT } from './engine/Engine.js';
import { parseParams } from './engine/params.js';
import { World } from './scene/World.js';
import { LOOK, CAMERA, SIM } from './scene/config.js';
import { createUi } from './ui/Ui.js';

const params = parseParams();
const root = document.getElementById('scene');
let ui = null;

try {
  const engine = new Engine(root, { manual: params.manual, pixelRatio: params.dpr });
  const world = new World(engine, params);
  ui = createUi(world.ctx, { enabled: params.ui, instant: params.manual || !params.ui });

  engine.onUpdate = (dt) => {
    world.update(dt);
    ui.update(dt, world.realTime);
  };
  engine.onRender = () => world.render();

  /** Step the simulation in fixed 1/60 s steps; draw once at the end unless told not to. */
  const advance = (seconds, { render = true } = {}) => {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) engine.advance(FIXED_DT, false);
    if (render) engine.advance(0, true);
  };

  const roots = { look: LOOK, camera: CAMERA, sim: SIM };

  // A handle for automated checks and for the console.
  window.__swan = {
    engine,
    world,
    ctx: world.ctx,
    /**
     * Run `seconds` of real time (the water sees that times the time scale)
     * in fixed steps, then draw one frame. Works with or without ?manual.
     */
    advance,
    /** Move the camera: { az, el, dist, fov, target: [x, y, z] }, optionally over `seconds`. */
    view(view, seconds = 0) {
      world.rig.set(view, seconds);
      if (params.manual) engine.advance(0, true);
    },
    /** Change a number of the look: set('look.exposure', 1.2), set('sim.timeScale', 1), set('look.sunColor', [9, 6, 3]). */
    set(path, value) {
      const keys = String(path).split('.');
      let target = roots[keys.shift()];
      while (target && keys.length > 1) target = target[keys.shift()];
      if (!target || !(keys[0] in target)) throw new Error(`Unknown setting: ${path}`);
      target[keys[0]] = value;
      if (params.manual) engine.advance(0, true);
    },
    /** Numbers about the last frame drawn. */
    stats() {
      const info = engine.renderer.info.render;
      return {
        fps: engine.frameMs ? Math.round(1000 / engine.frameMs) : 0,
        frameMs: Math.round(engine.frameMs * 10) / 10,
        drawCalls: info.calls,
        triangles: info.triangles,
        renderScale: engine.renderScale,
        tier: world.tier,
      };
    },
  };

  // ?t=5: let the scene run for a while before anyone looks
  if (params.preAdvance > 0) advance(params.preAdvance, { render: false });
  // the first complete frame, then the veil can go
  engine.advance(0, true);
  engine.start();
  ui.ready();
  window.__ready = true;
} catch (err) {
  console.error(err);
  const message = 'This device could not start WebGL 2. Try a recent version of Safari or Chrome.';
  if (ui) ui.fail(message);
  else {
    const veil = document.getElementById('loading');
    if (veil) veil.textContent = message;
  }
  window.__ready = true;
}
