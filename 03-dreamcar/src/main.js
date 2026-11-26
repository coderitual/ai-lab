// Entry point: starts the game and leaves a small handle on the page for
// tests and for poking around in the console.
//
// URL parameters are described in engine/params.js.

import { TIMES } from './assets/world/lighting.js';
import { TOUCH } from './engine/Input.js';
import { parseParams } from './engine/params.js';
import { Game } from './game/Game.js';
import * as config from './game/config.js';
import { TEXT } from './game/text.js';

const params = parseParams();
// ?photo=d1 (a named place of the staging camera, config.js PHOTOS): it brings its own moment of the autopilot's run
// and its time of day, unless the address gives them
const query = new URLSearchParams(location.search);
const named = config.PHOTOS[query.get('photo') || ''];
if (named) {
  params.auto = true;
  params.autopilot = true;
  if (!query.has('t')) params.preAdvance = named.t;
  if (!query.has('time')) params.time = named.time;
}
const veil = document.getElementById('loading');

try {
  const game = new Game(document.getElementById('game'), params);
  const { engine } = game;

  /** Fast-forward `seconds` of the run without drawing, then draw one frame. */
  const skip = (seconds) => {
    const frames = Math.round(seconds * 60);
    // a paused run stays where it is (the steps stop; the picture is still drawn)
    for (let i = 0; i < frames; i++) engine.advance(engine.paused ? 0 : 1 / 60, 1 / 60, false);
    engine.advance(0);
  };

  // what set() can reach: set('times.night.exposure', 40), set('camera.chase.distance', 6.5)
  const roots = { times: TIMES };
  for (const [name, table] of Object.entries(config)) roots[name.toLowerCase()] = table;

  // A handle for automated checks and for the console.
  window.__dreamcar = {
    game,
    engine,
    /** lighting.js's times of day (a test can add one at run time: the game takes whatever is there). */
    times: TIMES,
    /** Play `seconds` of the run at `fps` frames a second, drawing every frame. Works with or without ?manual. */
    advance(seconds, fps = 60) {
      const frames = Math.round(seconds * fps);
      for (let i = 0; i < frames; i++) engine.advance(engine.paused ? 0 : 1 / fps, 1 / fps);
    },
    skip,
    /** Numbers about the run and the last frame drawn. */
    stats: () => game.stats(),
    /** A plain JSON picture of the run: phase, mode, time of day, and per driver lap, place, speed, lamps, ... */
    state: () => game.state(),
    /**
     * The staging camera: { back, right, up, yaw, pitch, fov } (metres behind, right of and above the car's origin
     * in its level frame; degrees left of its heading and up; the lens top to bottom), the HUD hidden unless
     * { hud: true }; null ends it; a name ('d1', 'd3', 'd4', 'r2': config.js PHOTOS) is a reference frame's camera.
     * Also ?photo=back,right,up,yaw,pitch,fov or ?photo=d1 in the address.
     */
    photo: (o) => game.setPhoto(o),
    /**
     * Where view `i`'s touch controls are (engine/Input.js layoutOf: CSS px from the view's top left, x0 and y0 its
     * own top left in the page), for tests.
     */
    touchLayout: (i = 0) => game.input.layoutOf(i),
    /** Input's TOUCH: the touch controls' numbers. */
    touch: TOUCH,
    /** Change a number of the light or of the run by its path, and show the result. */
    set(path, value) {
      const keys = String(path).split('.');
      let target = roots[keys.shift()];
      while (target && keys.length > 1) target = target[keys.shift()];
      if (!target || keys.length !== 1 || !(keys[0] in target)) throw new Error(`Unknown setting: ${path}`);
      target[keys[0]] = value;
      game.refresh();
      if (params.manual) engine.advance(0);
    },
  };

  // ?photo=back,right,up,yaw,pitch,fov[,hud]: the staging camera from the first frame (see photo above)
  const photo = query.get('photo');
  if (named) game.setPhoto(named);
  else if (photo) {
    const n = photo.split(',').map(parseFloat);
    const keys = ['back', 'right', 'up', 'yaw', 'pitch', 'fov'];
    const o = {};
    keys.forEach((k, i) => Number.isFinite(n[i]) && (o[k] = n[i]));
    if (/,hud$/.test(photo)) o.hud = true;
    game.setPhoto(o);
  }
  // ?t=5: let the run go on for a while before anyone looks; either way, the first complete frame
  skip(params.preAdvance);
  engine.start();
  if (veil) {
    // the veil fades over the first frames (at once in a still: ?manual draws nothing more to fade over)
    if (params.manual) veil.remove();
    else {
      veil.classList.add('gone');
      veil.addEventListener('transitionend', () => veil.remove(), { once: true });
    }
  }
  window.__ready = true;
} catch (err) {
  console.error(err);
  if (veil) {
    const p = document.createElement('p');
    p.textContent = TEXT.noWebgl;
    veil.querySelector('i')?.remove();
    veil.appendChild(p);
  }
  window.__ready = true;
}
