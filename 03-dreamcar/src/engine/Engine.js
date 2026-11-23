// The shell around the run: the WebGL renderer and its canvas, the loop,
// resizing, a lost WebGL context, and the adaptive render scale.
//
// Two ideas.
//
// Time. The run advances in fixed steps of FIXED_DT however long frames take,
// and every drawn frame is told how far it lies between the last two steps
// (alpha). Whoever draws keeps the previous and the current pose of what
// moves and shows the mix: movement is smooth at any frame rate, and the run
// itself is the same on every machine and in every test.
//
// Size. The canvas always has the size of its container times the pixel
// ratio. When frames run long the governor (governor.js) first sheds the
// tier's ladder of things that are hard to see (`isShed(name)`: whoever owns
// a rung asks) and only then shrinks the off-screen targets (renderScale), to
// the tier's floor and no further; the last pass reconstructs the picture at
// the canvas's size, so a step is never a jump in layout.
//
// The engine does not know what is drawn. Each frame it calls onUpdate once
// per fixed step, then onRender (pose things between the steps), then onDraw
// (draw every view).
//
// A picture taken after fast-forwarding (?t=, skip()) is drawn twice: once as
// things were before the last step and once as they are after it. Whatever
// compares a frame with the one before (the motion blur) then has a real pair
// to compare, one step apart, and a still shows the same streaks as a frame
// of the running game.

import * as THREE from 'three';
import { adaptiveFor, createGovernor, frameTime, governorStep, scaleAt, shedAt, startGovernorAt } from './governor.js';

/** One step of the run, in seconds. */
export const FIXED_DT = 1 / 120;
/** A frame longer than this is treated as a hiccup, not as time that passed. */
const MAX_FRAME_DT = 0.1;
/** Never more steps than this in one frame: a machine that cannot keep up slows the run down instead of freezing. */
const MAX_STEPS = 16;

/**
 * More of the run than this between two drawn frames: the next one has no usable predecessor (see the header).
 * More than MAX_STEPS steps, so that a slow frame of the running game is never drawn twice.
 */
const COLD_GAP = 0.15;

/** Which engine made which renderer, so that the frame pipeline can ask for the frame's time (Engine.of). */
const engines = new WeakMap();

export class Engine {
  /**
   * The engine that owns `renderer`, or null.
   * @param {THREE.WebGLRenderer} renderer
   * @returns {Engine|null}
   */
  static of(renderer) {
    return engines.get(renderer) ?? null;
  }

  /**
   * @param {HTMLElement} container element the canvas fills
   * @param {{ manual?: boolean, pixelRatio?: number|null, maxPixelRatio?: number, draw?: boolean, renderScale?: number|null, shed?: number|null }} [options]
   *   `manual` never starts the loop (frames come from advance()); `pixelRatio` forces the canvas pixel ratio,
   *   `renderScale` the share of it the scene is drawn at and `shed` how many rungs of the ladder are shed: each of
   *   the three switches the governor off (a request for an exact picture); `maxPixelRatio` caps the device's own;
   *   `draw: false` never draws at all.
   */
  constructor(container, options = {}) {
    this.container = container;
    this.manual = !!options.manual;
    this.draws = options.draw !== false;
    this.forcedPixelRatio = options.pixelRatio ?? null;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.forcedScale = options.renderScale ?? null;
    this.forcedShed = options.shed ?? null;
    // a forced pixel ratio, scale or ladder is a request for an exact picture: leave it alone
    this.adaptive = adaptiveFor({ manual: this.manual, draws: this.draws, pixelRatio: this.forcedPixelRatio, renderScale: this.forcedScale, shed: this.forcedShed });

    // No antialiasing and no depth on the canvas itself: the scene is drawn
    // into the frame pipeline's own targets (multisampled there), the canvas
    // only ever receives full-screen triangles.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Tone mapping and the sRGB curve are applied by the pipeline's last
    // pass; three.js must not do either a second time.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    // counted over all the passes of a frame: reset here, once, before each frame is drawn
    renderer.info.autoReset = false;
    this.renderer = renderer;
    engines.set(renderer, this);

    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    container.appendChild(canvas);
    this.canvas = canvas;

    /** Size of the canvas in CSS pixels. */
    this.width = 0;
    this.height = 0;
    this.aspect = 1;
    this.pixelRatio = 1;
    /** Size of the canvas in device pixels. */
    this.bufferWidth = 0;
    this.bufferHeight = 0;
    /** Fraction of the canvas resolution the off-screen targets are drawn at. */
    this.renderScale = this.forcedScale ?? 1;
    /** The governor's level: 0 = everything at full resolution; one more for each rung shed, then for each step of the render scale. */
    this.qualityStep = 0;
    /** What decides it (governor.js): which rungs there are and how low the scale may go come from setLadder. */
    this.governor = createGovernor();
    /** How many rungs of the ladder are shed now. */
    this.shed = 0;

    /** Seconds of the run so far: `step` fixed steps. */
    this.simTime = 0;
    this.step = 0;
    /**
     * The moment of the run the frame being drawn shows, in seconds: between the last two steps, where `alpha`
     * puts it. Two frames with the same renderTime show the same moment.
     */
    this.renderTime = 0;
    /** Frames drawn. */
    this.frame = 0;
    /** Smoothed real time between frames, in milliseconds (0 until the loop has run). */
    this.frameMs = 0;
    this.running = false;
    /** The loop keeps drawing but no time passes. */
    this.paused = false;
    this.contextLost = false;

    /** Called once per fixed step: (dt, simTime). Everything that changes the run happens here. */
    this.onUpdate = null;
    /** Called once per drawn frame, before drawing: (frameDt, alpha, renderTime). Pose things between the steps. */
    this.onRender = null;
    /** Called to draw the frame: (renderTime). */
    this.onDraw = null;

    this._accumulator = 0;
    this._last = 0;
    this._drawnStep = 0; // the step count when a frame was last drawn
    this._lead = 0; // 1 after a cold frame, which showed the present and not the usual one step back, until time moves
    this._sizeDirty = true;
    this._resizeListeners = [];
    this._restoreListeners = [];
    this._qualityListeners = [];
    /** The real time of the last frames (ms), newest last: for the readout's average and worst. */
    this._frameTimes = new Float32Array(120);
    this._frameCount = 0;

    this._tick = this._tick.bind(this);
    this._markDirty = this._markDirty.bind(this);

    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._markDirty);
      this._observer.observe(container);
    }
    window.addEventListener('resize', this._markDirty);
    // iOS reports the old size for a moment after the device is turned
    this._onOrientation = () => {
      this._markDirty();
      setTimeout(this._markDirty, 300);
    };
    window.addEventListener('orientationchange', this._onOrientation);
    // the visual viewport changes when browser bars slide in and out
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this._markDirty);

    this._onVisibility = () => {
      // time spent in a hidden tab is not simulated when it comes back
      if (!document.hidden) this._last = performance.now();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._onLost = (e) => {
      // without preventDefault the browser never restores the context
      e.preventDefault();
      this.contextLost = true;
      life++;
    };
    // Objects made before a context was lost belong to the dead context: deleting one afterwards does nothing but
    // log a warning, and three.js still holds them (in its properties of every texture, target and geometry made
    // before the loss) and deletes them when their owner is next resized or disposed. Each object remembers which
    // life of the context made it, and a delete of one from an earlier life is dropped here.
    const gl = renderer.getContext();
    const lives = new WeakMap();
    let life = 0;
    for (const kind of ['Texture', 'Buffer', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray', 'Query', 'Sampler', 'TransformFeedback']) {
      const create = gl[`create${kind}`];
      const remove = gl[`delete${kind}`];
      if (typeof create !== 'function' || typeof remove !== 'function') continue;
      gl[`create${kind}`] = function (...args) {
        const made = create.apply(gl, args);
        if (made && life > 0) lives.set(made, life);
        return made;
      };
      gl[`delete${kind}`] = function (object) {
        if (object && (lives.get(object) || 0) !== life) return;
        remove.call(gl, object);
      };
    }
    this._onRestored = () => {
      // three.js has rebuilt its own state and uploads textures and geometry again when they are next used;
      // whatever only lived on the GPU (pictures drawn into render targets) is rebuilt by its owner
      this.contextLost = false;
      this._last = performance.now();
      for (const fn of this._restoreListeners) fn();
      if (this.manual) this.advance(0);
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);

    this._applySize();
  }

  /**
   * `fn(engine)` is called now and whenever the canvas size, the pixel ratio
   * or the render scale changes.
   */
  onResize(fn) {
    this._resizeListeners.push(fn);
    fn(this);
  }

  /** `fn()` is called after the browser has given a lost WebGL context back. */
  onContextRestored(fn) {
    this._restoreListeners.push(fn);
  }

  /**
   * The tier's ladder: the names of what is shed when frames run long, least visible first, and the smallest render
   * scale allowed once all of it is shed. The engine does not know what a rung is; whoever owns one asks `isShed`.
   * @param {string[]} rungs @param {number} floor
   */
  setLadder(rungs, floor) {
    this.governor = createGovernor({ rungs, floor });
    this._applyLevel(0);
  }

  /**
   * Start the governor at `level` instead of the top (where this device ended last time: whoever keeps that between
   * visits says so). Nothing happens where the governor does not run.
   */
  startAt(level) {
    if (!this.adaptive) return;
    startGovernorAt(this.governor, level);
    this._applyLevel(this.governor.level);
  }

  /** Is this rung of the ladder shed now? */
  isShed(name) {
    const i = this.governor.rungs.indexOf(name);
    return i >= 0 && i < this.shed;
  }

  /** The names of the rungs shed now, in the ladder's order. */
  get shedNames() {
    return this.governor.rungs.slice(0, this.shed);
  }

  /** `fn(engine)` is called whenever a rung is shed or taken back, or the render scale changes. */
  onQuality(fn) {
    this._qualityListeners.push(fn);
  }

  /**
   * Put the ladder at `level` by hand (0: nothing shed; see governor.js) and switch the governor off: for staging
   * and tests. `null` hands it back to the governor where it may run.
   */
  setQualityStep(level) {
    if (level === null) {
      this.adaptive = adaptiveFor({ manual: this.manual, draws: this.draws, pixelRatio: this.forcedPixelRatio, renderScale: this.forcedScale, shed: this.forcedShed });
      return;
    }
    this.adaptive = false;
    this.forcedScale = null;
    this._applyLevel(level);
  }

  /** Draw the scene at this share of the canvas's size, by hand, and switch the governor off (null: the level's own). */
  setRenderScale(scale) {
    this.adaptive = false;
    this.forcedScale = scale;
    this._applyLevel(this.qualityStep, true);
  }

  /** Real frame times of the last `seconds`: the mean and the worst, in milliseconds (0 before the loop has run). */
  frameStats(seconds = 3) {
    const n = Math.min(this._frameCount, this._frameTimes.length);
    let sum = 0;
    let worst = 0;
    let count = 0;
    for (let i = 1; i <= n && sum < seconds * 1000; i++) {
      const ms = this._frameTimes[(this._frameCount - i) % this._frameTimes.length];
      sum += ms;
      worst = Math.max(worst, ms);
      count++;
    }
    return { mean: count ? sum / count : 0, worst, frames: count };
  }

  /** Change the cap on the device pixel ratio (the quality tier decides it). */
  setMaxPixelRatio(value) {
    this.maxPixelRatio = value;
    this._sizeDirty = true;
    this._applySize();
  }

  _markDirty() {
    this._sizeDirty = true;
    // With no loop running nobody would pick the change up: do it now, and
    // redraw the same moment at the new size.
    if (this.manual && this._applySize()) this.advance(0);
  }

  /**
   * Resizing is asked for many times a second while a phone's browser bar
   * slides; the canvas and every target are reallocated at most once a frame.
   * @returns {boolean} whether anything changed
   */
  _applySize() {
    if (!this._sizeDirty) return false;
    this._sizeDirty = false;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const pr = this.forcedPixelRatio ?? Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    if (w === this.width && h === this.height && pr === this.pixelRatio) return false;
    this.width = w;
    this.height = h;
    this.aspect = w / h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.bufferWidth = this.canvas.width;
    this.bufferHeight = this.canvas.height;
    for (const fn of this._resizeListeners) fn(this);
    return true;
  }

  start() {
    if (this.running || this.manual) return;
    this.running = true;
    this._last = performance.now();
    this.renderer.setAnimationLoop(this._tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick(now) {
    if (this.contextLost) return;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 0;
    this.frameMs = this.frameMs ? this.frameMs + (dt * 1000 - this.frameMs) * 0.08 : dt * 1000;
    if (dt > 0) this._frameTimes[this._frameCount++ % this._frameTimes.length] = dt * 1000;
    // (the governor's own count of frames starts with the loop; the first of them compile shaders)
    if (this.adaptive && governorStep(this.governor, dt)) this._applyLevel(this.governor.level);
    this._applySize();
    // a long frame is played as a short one: the picture stutters once instead of jumping ahead
    this.advance(this.paused ? 0 : Math.min(dt, MAX_FRAME_DT), dt);
  }

  /**
   * Advance the run by `dt` seconds (in whole fixed steps; the remainder is
   * kept for the next call) and draw one frame. The loop calls this with real
   * time; tests and staged pictures call it with a fixed frame time, so that
   * nothing depends on the clock.
   *
   * @param {number} dt seconds of the run
   * @param {number} [frameDt] seconds of real time this frame stands for (for things that follow the eye, not the run)
   * @param {boolean} [draw] false: only step
   */
  advance(dt, frameDt = dt, draw = true) {
    this._accumulator += dt;
    let steps = 0;
    // (the tolerance keeps a frame of exactly two steps from being counted as one and a remainder)
    while (this._accumulator >= FIXED_DT - 1e-9 && steps < MAX_STEPS) {
      this.step++;
      this.simTime = this.step * FIXED_DT;
      if (this.onUpdate) this.onUpdate(FIXED_DT, this.simTime);
      this._accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this._accumulator = 0;
    if (steps > 0) this._lead = 0;
    if (!draw || !this.draws || this.contextLost) return;
    if ((this.step - this._drawnStep) * FIXED_DT > COLD_GAP) {
      // nothing was drawn for a while: first the frame one step back, for the next one to be compared with
      this._drawFrame(0, 0);
      this._lead = 1;
    }
    this._drawnStep = this.step;
    this._drawFrame(frameDt, Math.min(1, Math.max(0, this._accumulator / FIXED_DT + this._lead)));
  }

  _drawFrame(frameDt, alpha) {
    this.renderTime = this.simTime + alpha * FIXED_DT;
    this.renderer.info.reset();
    if (this.onRender) this.onRender(frameDt, alpha, this.renderTime);
    if (this.onDraw) this.onDraw(this.renderTime);
    this.frame++;
  }

  /**
   * Make `level` of the ladder what is drawn: so many rungs shed, such a render scale (governor.js says which).
   * Everyone who owns a rung is told; the targets are sized again only if the scale changed.
   */
  _applyLevel(level, force = false) {
    const g = this.governor;
    const next = Math.max(0, Math.min(g.max, Math.round(level)));
    g.level = next;
    const shed = this.forcedShed !== null ? Math.max(0, Math.min(g.rungs.length, this.forcedShed)) : shedAt(g, next);
    const scale = this.forcedScale ?? scaleAt(g, next);
    if (!force && next === this.qualityStep && shed === this.shed && scale === this.renderScale) return;
    const scaled = scale !== this.renderScale;
    this.qualityStep = next;
    this.shed = shed;
    this.renderScale = scale;
    for (const fn of this._qualityListeners) fn(this);
    if (scaled) for (const fn of this._resizeListeners) fn(this);
  }

  /** What the governor is doing, for the readout and for tests. */
  qualityState() {
    const g = this.governor;
    return {
      adaptive: this.adaptive,
      level: this.qualityStep,
      max: g.max,
      shed: this.shedNames,
      rungs: g.rungs.slice(),
      renderScale: this.renderScale,
      floor: g.scales[g.scales.length - 1],
      capMs: g.cap === null ? null : g.cap * 1000,
      trial: !!g.watch?.trial,
      trials: g.trials,
      proven: g.proven,
      governorMs: frameTime(g) * 1000,
    };
  }

  dispose() {
    this.stop();
    if (this._observer) this._observer.disconnect();
    window.removeEventListener('resize', this._markDirty);
    window.removeEventListener('orientationchange', this._onOrientation);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', this._markDirty);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
