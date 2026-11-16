// The shell around the picture: the WebGL renderer and its canvas, the frame
// loop, resizing, a lost WebGL context, and the adaptive render scale.
//
// The engine does not know what is drawn. Each frame it calls onUpdate(dt),
// then onRender(); whoever owns the scene (World.js) does the rest.

import * as THREE from 'three';

/** The step used by advance() and therefore by every test and staged picture. */
export const FIXED_DT = 1 / 60;
/** A frame longer than this is treated as a hiccup, not as time that passed. */
const MAX_FRAME_DT = 1 / 15;

// Render scale steps. The canvas keeps its size; only the off-screen targets
// shrink, and the last pass stretches them back, so a step is never a visible jump
// in layout, only in sharpness.
const SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5];
/** Below about 48 frames a second for a while: give up some resolution. */
const SLOW_FRAME = 1 / 48;

export class Engine {
  /**
   * @param {HTMLElement} container element the canvas fills
   * @param {{ pixelRatio?: number|null, maxPixelRatio?: number, manual?: boolean, adaptive?: boolean }} [options]
   *   `pixelRatio` forces the canvas pixel ratio; `maxPixelRatio` caps the
   *   device's own; `manual` never starts the loop (frames come from advance()).
   */
  constructor(container, options = {}) {
    this.container = container;
    this.manual = !!options.manual;
    this.forcedPixelRatio = options.pixelRatio ?? null;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    // a forced pixel ratio is a request for an exact picture size: leave it alone
    this.adaptive = options.adaptive !== false && !this.manual && this.forcedPixelRatio === null;

    // No antialiasing and no depth on the canvas itself: the scene is drawn
    // into our own targets (multisampled there), the canvas only ever receives
    // one full-screen triangle.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Tone mapping and the sRGB curve are applied by the last pass of
    // PostChain; three.js must not do either a second time.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    // counted over all the passes of a frame, and reset by whoever draws it
    renderer.info.autoReset = false;
    this.renderer = renderer;

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

    this.running = false;
    this.contextLost = false;
    this.frame = 0;
    /** Smoothed real time between frames, in milliseconds (0 until the loop has run). */
    this.frameMs = 0;

    /** Called with the seconds to simulate. */
    this.onUpdate = null;
    /** Called to draw one frame. */
    this.onRender = null;

    this._last = 0;
    this._sizeDirty = true;
    this._resizeListeners = [];
    this._restoreListeners = [];
    this._scaleIndex = 0;
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
    };
    this._onRestored = () => {
      // three.js has rebuilt its own state; whatever only lived on the GPU
      // (the ripple simulation's heights) has to be started again by its owner
      this.contextLost = false;
      this._last = performance.now();
      for (const fn of this._restoreListeners) fn();
      if (this.manual && this.onRender) this.onRender();
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);

    this._applySize();
  }

  /** Width of the off-screen targets in pixels (canvas pixels times the render scale). */
  get targetWidth() {
    return Math.max(2, Math.round(this.bufferWidth * this.renderScale));
  }

  get targetHeight() {
    return Math.max(2, Math.round(this.bufferHeight * this.renderScale));
  }

  /**
   * `fn(engine)` is called now and whenever the canvas size, the pixel ratio
   * or the render scale changes. Read targetWidth/targetHeight and aspect.
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
    if (this.manual && this._applySize() && this.onRender && !this.contextLost) this.onRender();
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
    // a long frame is drawn as a short one: the picture stutters once instead of jumping ahead
    this.advance(Math.min(dt, MAX_FRAME_DT));
  }

  /**
   * Simulate `dt` seconds and draw one frame. The loop calls this with real
   * time; tests call it with FIXED_DT so that nothing depends on the clock.
   * @param {number} dt
   * @param {boolean} [render]
   */
  advance(dt, render = true) {
    if (this.onUpdate) this.onUpdate(dt);
    if (!render || this.contextLost) return;
    if (this.onRender) this.onRender();
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
    if (this.frame < 60 || dt <= 0) return;
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
          this._setScaleIndex(this._scaleIndex - 1);
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

    if (this._slow > 1.5 && !this._capped && this._scaleIndex < SCALE_STEPS.length - 1) {
      // slow again right after a step up: that try failed, be more patient next time
      if (this._sinceStepUp < 10) this._patience = Math.min(120, this._patience * 2);
      this._probe = { before: this.frameMs / 1000, frames: 0, sum: 0 };
      this._slow = 0;
      this._setScaleIndex(this._scaleIndex + 1);
    } else if (this._steady > this._patience && this._scaleIndex > 0) {
      this._steady = 0;
      this._sinceStepUp = 0;
      this._setScaleIndex(this._scaleIndex - 1);
    }
  }

  _setScaleIndex(index) {
    this._scaleIndex = Math.max(0, Math.min(SCALE_STEPS.length - 1, index));
    const scale = SCALE_STEPS[this._scaleIndex];
    if (scale === this.renderScale) return;
    this.renderScale = scale;
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
