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
/**
 * The most one frame may count for when the frame rate is judged. A frame of
 * several seconds is the page having been held up (the app switcher, a system
 * sheet: neither hides the page), and says nothing about how fast it draws.
 */
const MAX_MEASURED_DT = 0.25;

// Render scale steps. The canvas keeps its size; only the off-screen targets
// shrink, and the last pass stretches them back, so a step is never a visible jump
// in layout, only in sharpness.
const SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5];
/** Below about 48 frames a second for a while: give up some resolution. */
const SLOW_FRAME = 1 / 48;
/** A smaller picture has to shorten the frame by this much to count as having helped. */
const GAIN = 0.93;
/** Seconds before a frame rate that looked capped by the browser is tested again; doubles each time, up to the second. */
const CAP_RETRY = [60, 600];
/** A lost WebGL context that has not come back after this many seconds (with the page showing) is not going to. */
const CONTEXT_GONE_AFTER = 3;

export class Engine {
  /**
   * @param {HTMLElement} container element the canvas fills
   * @param {{ pixelRatio?: number|null, maxPixelRatio?: number, maxPixels?: number, manual?: boolean, adaptive?: boolean }} [options]
   *   `pixelRatio` forces the canvas pixel ratio; `maxPixelRatio` caps the
   *   device's own and `maxPixels` the size of the canvas in device pixels;
   *   `manual` never starts the loop (frames come from advance()).
   */
  constructor(container, options = {}) {
    this.container = container;
    this.manual = !!options.manual;
    this.forcedPixelRatio = options.pixelRatio ?? null;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.maxPixels = options.maxPixels ?? Infinity;
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
    /** Called once if a lost WebGL context has not been given back: the picture is gone until the page is loaded again. */
    this.onContextGone = null;

    this._last = 0;
    this._sizeDirty = true;
    this._resizeListeners = [];
    this._restoreListeners = [];
    this._scaleIndex = 0;
    this._slow = 0;
    this._steady = 0;
    this._patience = 6; // seconds of steady frames before trying a step up; doubles after a failed try
    this._sinceStepUp = Infinity;
    this._pace = 0; // smoothed seconds per frame as _adapt sees them (long frames counted short)
    this._probe = null; // { from, before, frames, sum } while a descent is checking that a smaller picture helps
    this._capped = false; // the browser, not the drawing, seems to set the frame rate: no steps down
    this._cappedFor = 0;
    this._capRetry = CAP_RETRY[0];
    this._goneTimer = null;

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
      if (document.hidden) return;
      // time spent in a hidden tab is not simulated when it comes back
      this._last = performance.now();
      // what capped the frame rate may have been switched off meanwhile (Low Power Mode is a setting)
      this._capped = false;
      // a context lost while the page was hidden gets its few seconds from now
      if (this.contextLost) this._watchLostContext();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._onLost = (e) => {
      // without preventDefault the browser never restores the context
      e.preventDefault();
      this.contextLost = true;
      this._watchLostContext();
    };
    this._onRestored = () => {
      // three.js has rebuilt its own state; whatever only lived on the GPU
      // (the ripple simulation's heights) has to be started again by its owner
      this.contextLost = false;
      clearTimeout(this._goneTimer);
      this._goneTimer = null;
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

  /**
   * Change the caps on the canvas resolution (the quality tier decides them).
   * @param {number} value most device pixels per CSS pixel
   * @param {number} [maxPixels] most device pixels in the whole canvas
   */
  setMaxPixelRatio(value, maxPixels = this.maxPixels) {
    this.maxPixelRatio = value;
    this.maxPixels = maxPixels;
    this._sizeDirty = true;
    this._applySize();
  }

  /**
   * The browser may give a lost context back at any time, or never (mobile
   * Safari drops the contexts of pages in the background when memory is
   * short, and does not promise to restore them). Nothing says which, so
   * wait a few seconds with the page showing, then tell the owner.
   */
  _watchLostContext() {
    clearTimeout(this._goneTimer);
    this._goneTimer = setTimeout(() => {
      this._goneTimer = null;
      // hidden: the wait starts again when the page is shown (_onVisibility)
      if (!this.contextLost || document.hidden) return;
      if (this.onContextGone) this.onContextGone();
    }, CONTEXT_GONE_AFTER * 1000);
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
    // A cap on the ratio alone lets a large screen ask for any number of
    // pixels (a tablet at ratio 2 is four phones), and every off-screen
    // target is sized from the canvas. The budget keeps their memory, and
    // the cost of whatever fills the picture, at what the tier was sized for.
    // Past it the canvas has fewer pixels than the screen and the browser
    // stretches it. A forced ratio is a request for an exact size: left alone.
    const pr = this.forcedPixelRatio ?? Math.min(window.devicePixelRatio || 1, this.maxPixelRatio, Math.sqrt(this.maxPixels / (w * h)));
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
    // The frame-rate figure keeps slow frames as they are (up to a second: a
    // device that draws two a second should say so). The adaptive scale gets
    // them cut shorter: one frame of four seconds must not count as four
    // seconds of slow frames and cost a step of resolution.
    this.frameMs = this.frameMs ? this.frameMs + (Math.min(dt, 1) * 1000 - this.frameMs) * 0.08 : Math.min(dt, 1) * 1000;
    if (this.adaptive) this._adapt(Math.min(dt, MAX_MEASURED_DT));
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
   * Down: when frames have been slow for about a second and a half, a descent
   * starts: take the next smaller render scale and compare the frame time
   * with what it was before the descent. Under vsync frame times come in
   * whole refreshes (16.7, 33.3, 50 ms at 60 Hz), so one step often cannot
   * show: a picture that takes 30 ms at full size takes 22 ms one step down
   * and is still shown every 33. So while nothing is gained the descent goes
   * on, a step at a time, and stops at the first scale that is faster.
   *
   * Only if the smallest scale is no faster either is the frame rate taken to
   * be held by the browser (iOS in Low Power Mode draws 30 a second whatever
   * we do). Then the descent is undone and no more are tried, for a while:
   * that mode can be switched off again, so the test is repeated after a
   * minute, then two, and so on up to ten, and at once when frames turn fast
   * by themselves or the page comes back from the background.
   *
   * Up: there is no way to measure spare time under vsync, so after a long
   * steady stretch the next larger scale is simply tried. If that brings the
   * slow frames back soon after, the wait before the next try doubles.
   *
   * @param {number} dt seconds the last frame took, at most MAX_MEASURED_DT
   */
  _adapt(dt) {
    if (this.frame < 60 || dt <= 0) return;
    this._pace = this._pace ? this._pace + (dt - this._pace) * 0.08 : dt;
    this._sinceStepUp += dt;

    if (this._probe) {
      // let the new target sizes settle for a few frames before measuring
      const p = this._probe;
      p.frames++;
      if (p.frames > 10) p.sum += dt;
      if (p.frames < 40) return;
      const after = p.sum / 30;
      if (after <= p.before * GAIN) {
        // faster: this is the scale to be at (if it is still slow, another descent follows from here)
        this._probe = null;
        this._capRetry = CAP_RETRY[0];
      } else if (this._scaleIndex < SCALE_STEPS.length - 1) {
        p.frames = 0;
        p.sum = 0;
        this._setScaleIndex(this._scaleIndex + 1);
      } else {
        this._probe = null;
        this._capped = true;
        this._cappedFor = 0;
        this._setScaleIndex(p.from);
      }
      return;
    }

    if (dt > SLOW_FRAME) {
      // (bounded: while no descent can start, at the smallest scale or under a
      // cap, slowness must not pile up and set one off long after it has passed)
      this._slow = Math.min(2, this._slow + dt);
      this._steady = 0;
    } else {
      this._slow = Math.max(0, this._slow - dt * 2);
      this._steady += dt;
    }

    if (this._capped) {
      this._cappedFor += dt;
      if (this._steady > 1) {
        // a second of fast frames: nothing is holding the rate down any more
        this._capped = false;
        this._capRetry = CAP_RETRY[0];
      } else if (this._cappedFor > this._capRetry) {
        this._capped = false;
        this._capRetry = Math.min(CAP_RETRY[1], this._capRetry * 2);
      }
    }

    if (this._slow > 1.5 && !this._capped && this._scaleIndex < SCALE_STEPS.length - 1) {
      // slow again right after a step up: that try failed, be more patient next time
      if (this._sinceStepUp < 10) this._patience = Math.min(120, this._patience * 2);
      this._probe = { from: this._scaleIndex, before: this._pace, frames: 0, sum: 0 };
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
    clearTimeout(this._goneTimer);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
