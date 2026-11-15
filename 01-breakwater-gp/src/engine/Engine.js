// Minimal game engine shell: renderer, camera, resize handling and a
// fixed-timestep loop with render interpolation.

import * as THREE from 'three';

export const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;

export class Engine {
  /**
   * @param {HTMLElement} container element the canvas fills
   * @param {{ maxPixelRatio?: number, pixelRatio?: number, manual?: boolean }} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.manual = !!options.manual;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x9cc8e6, 1);
    this.renderer = renderer;

    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
    this.scene.add(this.camera);

    this.width = 1;
    this.height = 1;
    this.aspect = 1;
    this.pixelRatio = 1;
    this.simTime = 0; // advanced in fixed steps
    this.accumulator = 0;
    this.running = false;
    this.paused = false;
    this.frame = 0;
    this._last = 0;
    this._slowFrames = 0;
    this._qualitySteps = 0;
    this._resizeListeners = [];
    this._restoreListeners = [];

    /** Called once per fixed step: (dt, simTime). */
    this.onUpdate = null;
    /** Called once per rendered frame: (frameDt, alpha, renderTime). */
    this.onRender = null;
    /** Optional: draws the frame itself (several viewports). Default: one full-size render. */
    this.onDraw = null;

    this._tick = this._tick.bind(this);
    this.resize = this.resize.bind(this);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this.resize);
      this._ro.observe(container);
    }
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.resize);

    document.addEventListener('visibilitychange', () => {
      // Drop the time that passed while hidden instead of fast-forwarding.
      this._last = performance.now();
    });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this._last = performance.now();
      for (const fn of this._restoreListeners) fn();
    });

    this.resize();
  }

  /** Rebuild GPU-only resources (render targets) after the browser drops the context. */
  onContextRestored(fn) {
    this._restoreListeners.push(fn);
  }

  onResize(fn) {
    this._resizeListeners.push(fn);
    fn(this.width, this.height, this.aspect);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const pr = this.options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w;
    this.height = h;
    this.aspect = w / h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    for (const fn of this._resizeListeners) fn(w, h, this.aspect);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    if (!this.manual) this.renderer.setAnimationLoop(this._tick);
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
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    this._adaptQuality(dt);
    this.advance(this.paused ? 0 : dt, dt);
  }

  /**
   * Advance the simulation by `dt` seconds of game time and draw one frame.
   * (Public so tests / capture tools can step deterministically.)
   */
  advance(dt, frameDt = dt, draw = true) {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT - 1e-9 && steps < 16) {
      this.simTime += FIXED_DT;
      if (this.onUpdate) this.onUpdate(FIXED_DT, this.simTime);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 16) this.accumulator = 0; // spiral-of-death guard
    if (!draw) return;
    const alpha = this.accumulator / FIXED_DT;
    const renderTime = this.simTime + this.accumulator;
    if (this.onRender) this.onRender(frameDt, alpha, renderTime);
    if (this.onDraw) this.onDraw(renderTime);
    else this.renderer.render(this.scene, this.camera);
    this.frame++;
  }

  /**
   * If the device cannot hold ~45 fps, trade resolution for smoothness.
   * Bounded to two steps: a browser that caps the frame rate itself (iOS Low
   * Power Mode runs at 30 fps) should not be driven down to a blurry picture.
   */
  _adaptQuality(dt) {
    if (this.options.pixelRatio != null || this.frame < 90 || this._qualitySteps >= 2) return;
    if (dt > 1 / 42) this._slowFrames++;
    else this._slowFrames = Math.max(0, this._slowFrames - 2);
    if (this._slowFrames > 75 && this.maxPixelRatio > 1) {
      this.maxPixelRatio = Math.max(1, this.maxPixelRatio * 0.82);
      this._slowFrames = 0;
      this._qualitySteps++;
      this.resize();
    }
  }
}
