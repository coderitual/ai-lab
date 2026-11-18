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
// ratio. When frames run long only the off-screen targets shrink
// (renderScale); the last pass stretches them back, so a step is never a jump
// in layout, only in sharpness.
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

/** One step of the run, in seconds. */
export const FIXED_DT = 1 / 120;
/** A frame longer than this is treated as a hiccup, not as time that passed. */
const MAX_FRAME_DT = 0.1;
/** Never more steps than this in one frame: a machine that cannot keep up slows the run down instead of freezing. */
const MAX_STEPS = 16;

/** The render scales, largest first. `qualityStep` is the index into this list. */
const SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5];
/** Below about 48 frames a second for a while: give up some resolution. */
const SLOW_FRAME = 1 / 48;
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
   * @param {{ manual?: boolean, pixelRatio?: number|null, maxPixelRatio?: number, draw?: boolean }} [options]
   *   `manual` never starts the loop (frames come from advance()); `pixelRatio` forces the canvas pixel ratio and
   *   switches the adaptive scale off; `maxPixelRatio` caps the device's own; `draw: false` never draws at all.
   */
  constructor(container, options = {}) {
    this.container = container;
    this.manual = !!options.manual;
    this.draws = options.draw !== false;
    this.forcedPixelRatio = options.pixelRatio ?? null;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    // a forced pixel ratio is a request for an exact picture size: leave it alone
    this.adaptive = !this.manual && this.draws && this.forcedPixelRatio === null;

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
    this.renderScale = 1;
    /** 0 = full resolution; grows by one each time frames ran long and the render scale was cut. */
    this.qualityStep = 0;

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
    this._slow = 0;
    this._steady = 0;
    this._patience = 6; // seconds of steady frames before trying a step up; doubles after a failed try
    this._sinceStepUp = Infinity;
    this._probe = null; // { before, frames, sum } while checking that a step down helped
    this._capped = false;

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
    if (this.adaptive) this._adapt(dt);
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
   * Trades resolution for frame rate.
   *
   * Down: when frames have been slow for about a second and a half, take the
   * next smaller render scale. A browser that limits the frame rate itself
   * (iOS in Low Power Mode draws 30 a second whatever we do) would drag the
   * scale to the bottom for nothing, so after each step down the frame time is
   * compared with before: if it did not get better, the step is undone and no
   * further steps down are tried.
   *
   * Up: there is no way to measure spare time under vsync, so after a long
   * steady stretch the next larger scale is simply tried. If that brings the
   * slow frames back soon after, the wait before the next try doubles.
   */
  _adapt(dt) {
    // (not during the first frames: they are slow for another reason, shaders being compiled)
    if (this.frame < 30 || dt <= 0) return;
    this._sinceStepUp += dt;

    if (this._probe) {
      // let the new target sizes settle for a few frames before measuring
      const p = this._probe;
      p.frames++;
      if (p.frames > 10) p.sum += dt;
      if (p.frames >= 40) {
        const after = p.sum / 30;
        this._probe = null;
        if (after > p.before * 0.93) {
          this._capped = true;
          this._setQualityStep(this.qualityStep - 1);
        }
      }
      return;
    }

    if (dt > SLOW_FRAME) {
      this._slow += dt;
      this._steady = 0;
    } else {
      this._slow = Math.max(0, this._slow - dt * 2);
      this._steady += dt;
    }

    if (this._slow > 1.5 && !this._capped && this.qualityStep < SCALE_STEPS.length - 1) {
      // slow again right after a step up: that try failed, be more patient next time
      if (this._sinceStepUp < 10) this._patience = Math.min(120, this._patience * 2);
      this._probe = { before: this.frameMs / 1000, frames: 0, sum: 0 };
      this._slow = 0;
      this._setQualityStep(this.qualityStep + 1);
    } else if (this._steady > this._patience && this.qualityStep > 0) {
      this._steady = 0;
      this._sinceStepUp = 0;
      this._setQualityStep(this.qualityStep - 1);
    }
  }

  _setQualityStep(step) {
    const next = Math.max(0, Math.min(SCALE_STEPS.length - 1, step));
    if (next === this.qualityStep) return;
    this.qualityStep = next;
    this.renderScale = SCALE_STEPS[next];
    for (const fn of this._resizeListeners) fn(this);
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
