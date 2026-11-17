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

/** Say on the page that something is wrong (a phone has no console to look in). */
let failure = null; // what was said before the Ui existed, for it to take over
const fail = (message, detail = '', onTap = null) => {
  if (ui) ui.fail(message, detail, onTap);
  else {
    failure = [message, detail, onTap];
    const veil = document.getElementById('loading');
    if (veil) veil.textContent = message;
  }
};

try {
  const engine = new Engine(root, { manual: params.manual, pixelRatio: params.dpr });
  // A shader that this device's driver refuses would otherwise only show as a
  // part of the picture that is missing: three.js logs it and carries on.
  // (Setting this replaces three's own report, so it is logged here too.)
  engine.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const logs = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].map((log) => (log || '').trim()).filter(Boolean);
    console.error(`A shader did not compile or link:\n${logs.join('\n')}`);
    fail('This device’s graphics driver refused a part of the picture.', logs.join('\n').slice(0, 700));
  };
  engine.onContextGone = () => fail('The picture was lost. Tap to load it again.', '', () => location.reload());
  const world = new World(engine, params);
  ui = createUi(world.ctx, { world, enabled: params.ui, instant: params.manual || !params.ui });
  // a shader refused while the world was being built: the Ui keeps the notice up when the veil would go
  if (failure) ui.fail(...failure);

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
  // whatever WebGL objected to while everything was built and drawn once (shown in the look panel's small print)
  world.startError = engine.renderer.getContext().getError();
  engine.start();
  ui.ready();
  window.__ready = true;
} catch (err) {
  console.error(err);
  fail('This device could not start WebGL 2. Try a recent version of Safari or Chrome.');
  window.__ready = true;
}
