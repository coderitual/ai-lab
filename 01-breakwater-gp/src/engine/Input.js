// Player input: keyboard on desktop, one thumb (or two) on a phone.
//
// Touch (throttle is automatic while touch is in use):
//   - touch anywhere: a stick appears under the thumb. Drag sideways to steer,
//     pull down to brake. One hand is enough.
//   - a second finger anywhere is the brake as well, for two-thumb riders.

import { clamp } from './math.js';

const STEER_RANGE = 62; // px of thumb travel for full lock
const BRAKE_DEAD = 26; // px the thumb may drift down before the brake starts to bite
const BRAKE_RANGE = 44; // px from there to full brake

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

    this.steerPointer = null; // the stick: { id, originX, originY, x, y }
    this.brakePointer = null; // a second finger: { id, x, y }
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
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: fine */
    }
    // the first finger down is the stick, wherever it lands; one more is the brake
    if (!this.steerPointer) {
      this.steerPointer = { id: e.pointerId, originX: e.clientX, originY: e.clientY, x: e.clientX, y: e.clientY };
    } else if (!this.brakePointer) {
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
      // the origin trails the thumb, so reversing direction answers at once
      if (s.x - s.originX > STEER_RANGE) s.originX = s.x - STEER_RANGE;
      if (s.x - s.originX < -STEER_RANGE) s.originX = s.x + STEER_RANGE;
      // likewise up and down: the brake is a pull from wherever the thumb has got to
      const maxPull = BRAKE_DEAD + BRAKE_RANGE + 12;
      if (s.y < s.originY) s.originY = s.y;
      if (s.y - s.originY > maxPull) s.originY = s.y - maxPull;
      this._notify();
      return;
    }
    const b = this.brakePointer;
    if (b && b.id === e.pointerId) {
      b.x = e.clientX;
      b.y = e.clientY;
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

  /** How hard the brake is on, 0 .. 1: the thumb pulled down, or a second finger held. */
  get touchBrake() {
    if (this.brakePointer) return 1;
    const s = this.steerPointer;
    if (!s) return 0;
    return clamp((s.y - s.originY - BRAKE_DEAD) / BRAKE_RANGE, 0, 1);
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
      const brake = this.touchBrake;
      out.steer = this.touchSteer;
      out.brake = brake;
      out.throttle = brake > 0.12 ? 0 : 1;
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
