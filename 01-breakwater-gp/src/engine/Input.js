// Player input: keyboard on desktop, two thumbs on a phone.
//
// Touch layout (auto-throttle is on while touch is in use):
//   left half   — press and drag sideways to steer (analog, floating origin)
//   lower right — hold to brake / tighten the turn

import { clamp } from './math.js';

const STEER_RANGE = 62; // px of thumb travel for full lock

/** Key presses that belong to a text field (the online invite boxes) are not for the game. */
const isTyping = (e) => e.target instanceof HTMLElement && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');

// Which keys a rider uses. Solo: both sets work. Split screen: one set each.
const KEYS = {
  all: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS', 'Space'] },
  wasd: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'] },
  arrows: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'] },
};

export class Input {
  /** @param {HTMLElement} surface element that receives touches (covers the game) */
  constructor(surface) {
    this.surface = surface;
    this.keys = new Set();
    // Start in touch mode on phones/tablets; switch with whatever is used last.
    this.isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.enabled = true;

    this.steerPointer = null; // { id, originX, x, y }
    this.brakePointer = null;
    this.onTouchChange = null; // (state) => void, for drawing the on-screen stick
    this.onAnyInput = null;

    this._keydown = (e) => {
      if (e.repeat || isTyping(e)) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (this.isTouch) {
        this.isTouch = false;
        this._notify();
      }
      if (this.onAnyInput) this.onAnyInput('key', e.code);
    };
    this._keyup = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.steerPointer = null;
      this.brakePointer = null;
      this._notify();
    });

    // A touch anywhere (e.g. on the Start button) means thumbs are in charge.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'mouse' && !this.isTouch) {
          this.isTouch = true;
          this._notify();
        }
      },
      true,
    );

    const opts = { passive: false };
    surface.addEventListener('pointerdown', (e) => this._down(e), opts);
    surface.addEventListener('pointermove', (e) => this._move(e), opts);
    surface.addEventListener('pointerup', (e) => this._up(e), opts);
    surface.addEventListener('pointercancel', (e) => this._up(e), opts);
    surface.addEventListener('lostpointercapture', (e) => this._up(e), opts);
    // Stop the page from scrolling, zooming or showing callouts mid-race.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'contextmenu', 'dblclick']) {
      surface.addEventListener(type, (e) => e.preventDefault(), opts);
    }
  }

  _down(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    if (!this.isTouch) this.isTouch = true;
    const rect = this.surface.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const left = u < 0.5;
    // the brake only answers in the lower right, where its button is drawn, so a
    // stray palm or a finger on the readouts does not stop the craft
    const onBrake = u > 0.55 && v > 0.4;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: fine */
    }
    if (left && !this.steerPointer) {
      this.steerPointer = { id: e.pointerId, originX: e.clientX, x: e.clientX, y: e.clientY };
    } else if (onBrake && !this.brakePointer) {
      this.brakePointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
    this._notify();
    if (this.onAnyInput) this.onAnyInput('touch');
  }

  _move(e) {
    const s = this.steerPointer;
    if (s && s.id === e.pointerId) {
      e.preventDefault();
      s.x = e.clientX;
      s.y = e.clientY;
      // let the origin trail the thumb so reversing direction is immediate
      if (s.x - s.originX > STEER_RANGE) s.originX = s.x - STEER_RANGE;
      if (s.x - s.originX < -STEER_RANGE) s.originX = s.x + STEER_RANGE;
      this._notify();
    }
  }

  _up(e) {
    let changed = false;
    if (this.steerPointer && this.steerPointer.id === e.pointerId) {
      this.steerPointer = null;
      changed = true;
    }
    if (this.brakePointer && this.brakePointer.id === e.pointerId) {
      this.brakePointer = null;
      changed = true;
    }
    if (changed) this._notify();
  }

  _notify() {
    if (this.onTouchChange) this.onTouchChange(this);
  }

  /** Analog steer from the thumb, -1 (left) .. 1 (right), with a gentle curve. */
  get touchSteer() {
    const s = this.steerPointer;
    if (!s) return 0;
    const v = clamp((s.x - s.originX) / STEER_RANGE, -1, 1);
    return Math.sign(v) * Math.pow(Math.abs(v), 1.25);
  }

  /**
   * Read the current controls into `out` = { steer, throttle, brake, analog }.
   * @param {'all'|'wasd'|'arrows'} [scheme] which keys count; touch only applies to 'all'
   */
  read(out, scheme = 'all') {
    if (!this.enabled) {
      out.steer = 0;
      out.throttle = 0;
      out.brake = 0;
      out.analog = false;
      return out;
    }
    if (this.isTouch && scheme === 'all') {
      out.steer = this.touchSteer;
      out.brake = this.brakePointer ? 1 : 0;
      out.throttle = this.brakePointer ? 0 : 1;
      out.analog = true;
      return out;
    }
    const k = this.keys;
    const map = KEYS[scheme] || KEYS.all;
    const held = (codes) => codes.some((c) => k.has(c));
    out.steer = (held(map.right) ? 1 : 0) - (held(map.left) ? 1 : 0);
    out.throttle = held(map.up) ? 1 : 0;
    out.brake = held(map.down) ? 1 : 0;
    out.analog = false;
    return out;
  }
}
