// What the hands are doing: keys, gamepads and thumbs, for one or two drivers.
//
// Two ideas.
//
// Each driver reads the device they touched last. A driver's controls come
// from their keys, their pad (the first pad is driver 1's, the second driver
// 2's) or their thumbs, whichever of those was used most recently, so a pad
// can be picked up mid-run without a menu and keys left resting on the desk do
// not fight it.
//
// Touch is cut into zones, one per view rectangle, so that two people can
// share a tablet. In a zone the left part (TOUCH.steerShare) steers: the first
// finger there is a stick that appears where it lands and reads sideways
// travel only (a second finger there is ignored). Anywhere in the right part
// is the brake, except two round buttons at its bottom right that the HUD
// draws: DRIFT (the handbrake while held) and, with the throttle on manual,
// GAS. With the throttle on auto (the default) the car drives while the
// steering thumb is down, or was a moment ago (TOUCH.grace s, counted in the
// fixed step by step()), and not while the brake or DRIFT is held. Holding
// the brake at a standstill reverses (the vehicle does that; this only
// reports the brake).
//
// Steering, pedals and the held look back are read by the drivers in the
// fixed step (read). Everything else is a moment: an action ('camera',
// 'reset', 'pause', 'time', 'high', 'ghost', 'mute', 'start', 'press', 'nav:up' ...) delivered to onAction as
// it happens, with the driver it belongs to (-1: nobody in particular). The
// engine knows nothing about cars: these are only names.

import { clamp } from './math.js';

const STEER_RANGE = 96; // px of thumb travel for full lock
const STEER_CURVE = 1.15; // power of the thumb's response
/**
 * The touch layout of a zone: the share of its width (from the left) that steers, the round buttons by their
 * radius and their centre's distance from the zone's right and bottom edges (CSS px, inside the safe area), and
 * how long the automatic throttle stays on after the steering thumb lifts (s).
 */
export const TOUCH = {
  steerShare: 0.55,
  drift: { r: 38, right: 64, bottom: 150 },
  gas: { r: 44, right: 64, bottom: 56 },
  /** On a zone lower than `lowBelow` px (a stacked half on a phone) DRIFT stands beside GAS instead, at the bottom. */
  lowBelow: 330,
  driftLow: { r: 38, right: 160, bottom: 56 },
  grace: 0.4,
};
const PAD_DEAD = 0.12; // of the stick's travel that does nothing
const PAD_CURVE = 1.6; // power of the stick's response: fine near the centre, all of the lock at the edge
const PAD_PEDAL_DEAD = 0.04;

/** Key presses that belong to a text field are not for the game. */
const isTyping = (e) =>
  e.target instanceof HTMLElement && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable);

/**
 * Which keys drive. Solo: `all` (both sets). Split screen: one set each; the second driver's extra keys sit by the
 * arrows (`.` camera, `,` look back, `/` put back, right Shift handbrake).
 */
const KEYS = {
  all: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], hand: ['Space'], back: ['KeyB'] },
  wasd: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], hand: ['Space'], back: ['KeyB'] },
  arrows: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], hand: ['ShiftRight'], back: ['Comma'] },
};
/** Keys that are a moment, not a held control: action and which scheme's driver it is for (null: anyone). */
const ACTIONS = {
  KeyC: ['camera', 'wasd'],
  Period: ['camera', 'arrows'],
  KeyR: ['reset', 'wasd'],
  Slash: ['reset', 'arrows'],
  KeyN: ['time', null],
  KeyH: ['high', null],
  KeyG: ['ghost', null],
  KeyM: ['mute', null],
  KeyP: ['pause', null],
  Escape: ['pause', null],
  Enter: ['start', null],
  NumpadEnter: ['start', null],
};
/** Keys whose browser default (scrolling, focus moves) must not happen while driving. */
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Enter']);
/** Keys a focused button takes for itself. */
const PRESSES = new Set(['Enter', 'NumpadEnter', 'Space']);
/** Pad buttons (standard mapping) that are actions. */
const PAD_ACTIONS = [
  [3, 'camera'], // Y
  [1, 'reset'], // B
  [9, 'pause'], // Start
  [8, 'time'], // Back / View
  [0, 'press'], // A (also the handbrake; as an action it presses the focused button of a menu, or starts a run)
  [12, 'nav:up'], // the d-pad moves through a menu's buttons
  [13, 'nav:down'],
  [14, 'nav:left'],
  [15, 'nav:right'],
];

export class Input {
  /** @param {HTMLElement} surface the element that receives touches (covers the views) */
  constructor(surface) {
    this.surface = surface;
    this.keys = new Set();
    /** Which key set each driver uses: ['all'] solo, ['wasd', 'arrows'] split. */
    this.schemes = ['all'];
    /** Per driver: 'keys' | 'pad' | 'touch', the device touched last. */
    this.source = ['keys', 'keys'];
    this.isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) this.source = ['touch', 'touch'];
    /** Touch zones as fractions of the surface from its top left: { left, top, width, height } per driver. */
    this.zones = [{ left: 0, top: 0, width: 1, height: 1 }];
    /**
     * Per zone: the stick { id, originX, originY, x, y }, the fingers on the brake (pointer ids), on DRIFT and on
     * GAS, and how long the automatic throttle has left after the stick went (s of simulated time).
     */
    this.touch = [this._zone(), this._zone()];
    /** The throttle on touch: 'auto' (the car drives while a thumb steers) or 'manual' (the GAS button). */
    this.throttle = 'auto';
    /** The safe area's right and bottom insets (CSS px), which the buttons stand inside (set by the game). */
    this.insets = { right: 0, bottom: 0 };
    /** (name, driver) for each action as it happens. */
    this.onAction = null;
    /** (input) whenever a stick appears, moves or goes, for drawing it. */
    this.onTouchChange = null;
    /** (kind) on any input at all: 'key', 'pad', 'touch' (sound unlock, idle timers). */
    this.onAnyInput = null;
    this._padButtons = [[], []];

    this._keydown = (e) => {
      if (isTyping(e)) return;
      // Enter or Space on a focused button presses that button and nothing else (not the start, not the handbrake)
      if (PRESSES.has(e.code) && e.target instanceof Element && e.target.closest('button')) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.isTouch) {
        this.isTouch = false;
        this._notify();
      }
      for (let d = 0; d < this.schemes.length; d++) if (this._isDriversKey(e.code, this.schemes[d])) this.source[d] = 'keys';
      const action = ACTIONS[e.code];
      if (action) this._emit(action[0], this._driverOf(action[1]));
      if (this.onAnyInput) this.onAnyInput('key');
    };
    this._keyup = (e) => this.keys.delete(e.code);
    this._blur = () => {
      this.keys.clear();
      for (let i = 0; i < this.touch.length; i++) this.touch[i] = this._zone();
      this._notify();
    };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', this._blur);

    const opts = { passive: false };
    surface.addEventListener('pointerdown', (e) => this._down(e), opts);
    surface.addEventListener('pointermove', (e) => this._move(e), opts);
    surface.addEventListener('pointerup', (e) => this._up(e), opts);
    surface.addEventListener('pointercancel', (e) => this._up(e), opts);
    surface.addEventListener('lostpointercapture', (e) => this._up(e), opts);
    // no scrolling, zooming, callouts or double-tap zoom under the thumbs (buttons still get their clicks)
    for (const type of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'contextmenu', 'dblclick']) {
      surface.addEventListener(
        type,
        (e) => {
          if (!this._onButton(e)) e.preventDefault();
        },
        opts,
      );
    }
  }

  /** @param {string} code @param {string} scheme */
  _isDriversKey(code, scheme) {
    const map = KEYS[scheme] || KEYS.all;
    for (const k in map) if (map[k].includes(code)) return true;
    const action = ACTIONS[code];
    return !!action && (action[1] === null || scheme === 'all' || action[1] === scheme);
  }

  /** Which driver an action key belongs to: in solo everything is driver 0's. */
  _driverOf(scheme) {
    if (scheme === null) return -1;
    if (this.schemes.length === 1) return 0;
    const d = this.schemes.indexOf(scheme);
    return d < 0 ? 0 : d;
  }

  _emit(name, driver) {
    if (this.onAction) this.onAction(name, driver);
  }

  _onButton(e) {
    return e.target instanceof Element && !!e.target.closest('button, a, input, select');
  }

  /** The zone under a point of the surface (client coordinates), or -1. */
  _zoneAt(x, y) {
    const r = this.surface.getBoundingClientRect();
    const u = (x - r.left) / Math.max(1, r.width);
    const v = (y - r.top) / Math.max(1, r.height);
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (u >= z.left && u < z.left + z.width && v >= z.top && v < z.top + z.height) return i;
    }
    return this.zones.length ? 0 : -1;
  }

  _zone() {
    return { stick: null, brakes: new Set(), drift: null, gas: null, grace: 0 };
  }

  /** The zone's rectangle in client pixels. */
  _rectOf(i) {
    const r = this.surface.getBoundingClientRect();
    const z = this.zones[i] || this.zones[0];
    return { left: r.left + z.left * r.width, top: r.top + z.top * r.height, width: z.width * r.width, height: z.height * r.height };
  }

  /** Which of a zone's round buttons (TOUCH.drift, TOUCH.gas) is under a point, or ''. */
  _buttonAt(i, x, y) {
    const zr = this._rectOf(i);
    const hit = (b) => {
      const cx = zr.left + zr.width - this.insets.right - b.right;
      const cy = zr.top + zr.height - this.insets.bottom - b.bottom;
      // a little more than the drawn circle, never less than a 64 px target
      return Math.hypot(x - cx, y - cy) <= Math.max(32, b.r + 6);
    };
    if (hit(zr.height < TOUCH.lowBelow ? TOUCH.driftLow : TOUCH.drift)) return 'drift';
    if (this.throttle === 'manual' && hit(TOUCH.gas)) return 'gas';
    return '';
  }

  _down(e) {
    if (e.pointerType === 'mouse' || this._onButton(e)) return;
    e.preventDefault();
    this.isTouch = true;
    const zi = this._zoneAt(e.clientX, e.clientY);
    if (zi < 0) return;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: the moves still arrive while the finger is over the surface */
    }
    const z = this.touch[zi];
    const zr = this._rectOf(zi);
    const button = this._buttonAt(zi, e.clientX, e.clientY);
    if (button === 'drift') z.drift = e.pointerId;
    else if (button === 'gas') z.gas = e.pointerId;
    else if ((e.clientX - zr.left) / Math.max(1, zr.width) < TOUCH.steerShare) {
      // the left part steers: the first finger is the stick, wherever it lands; another one there is ignored
      if (!z.stick) z.stick = { id: e.pointerId, originX: e.clientX, originY: e.clientY, x: e.clientX, y: e.clientY };
    } else z.brakes.add(e.pointerId);
    this.source[zi] = 'touch';
    this._notify();
    if (this.onAnyInput) this.onAnyInput('touch');
  }

  _move(e) {
    for (const z of this.touch) {
      const s = z.stick;
      if (!s || s.id !== e.pointerId) continue;
      e.preventDefault();
      s.x = e.clientX;
      s.y = e.clientY;
      // the origin trails the thumb, so reversing direction answers at once
      if (s.x - s.originX > STEER_RANGE) s.originX = s.x - STEER_RANGE;
      if (s.x - s.originX < -STEER_RANGE) s.originX = s.x + STEER_RANGE;
      s.originY = s.y;
      this._notify();
    }
  }

  _up(e) {
    let changed = false;
    for (const z of this.touch) {
      if (z.stick && z.stick.id === e.pointerId) {
        z.stick = null;
        changed = true;
      }
      if (z.brakes.delete(e.pointerId)) changed = true;
      if (z.drift === e.pointerId) {
        z.drift = null;
        changed = true;
      }
      if (z.gas === e.pointerId) {
        z.gas = null;
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  /** Once per fixed step: the automatic throttle's moment after the steering thumb lifts runs out. */
  step(dt) {
    for (const z of this.touch) z.grace = z.stick ? TOUCH.grace : Math.max(0, z.grace - dt);
  }

  _notify() {
    if (this.onTouchChange) this.onTouchChange(this);
  }

  /** The stick of zone `i` as drawn: { x, y, originX, originY } in client pixels, or null. */
  stickOf(i) {
    return this.touch[i] ? this.touch[i].stick : null;
  }

  /** How hard zone `i`'s fingers brake right now, 0 or 1. */
  brakeOf(i) {
    const z = this.touch[i];
    return z && z.brakes.size ? 1 : 0;
  }

  /** Which of zone `i`'s buttons are held: { drift, gas } (for drawing them pressed). */
  heldOf(i) {
    const z = this.touch[i];
    return { drift: !!(z && z.drift !== null), gas: !!(z && z.gas !== null) };
  }

  /** The pad driver `d` holds, or null. */
  _pad(d) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let n = 0;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      if (n === d) return pad;
      n++;
    }
    return null;
  }

  /**
   * Once per drawn frame: look at the pads, so that their buttons can be actions and the stick can claim its
   * driver. (Their axes are read again in read(), in the fixed step.)
   */
  poll() {
    for (let d = 0; d < 2; d++) {
      const pad = this._pad(d);
      const prev = this._padButtons[d];
      if (!pad) {
        prev.length = 0;
        continue;
      }
      let used = false;
      for (let b = 0; b < pad.buttons.length; b++) {
        const down = pad.buttons[b].pressed || pad.buttons[b].value > 0.5;
        if (down) used = true;
        const pressed = down && !prev[b];
        // remembered before the action goes out: whoever receives it may well poll again
        prev[b] = down;
        if (pressed) for (const [button, name] of PAD_ACTIONS) if (button === b) this._emit(name, d < this.schemes.length ? d : 0);
      }
      if (Math.abs(pad.axes[0] || 0) > 0.3) used = true;
      if (used) {
        this.source[d] = 'pad';
        if (this.isTouch) {
          this.isTouch = false;
          this._notify();
        }
        if (this.onAnyInput) this.onAnyInput('pad');
      }
    }
  }

  /**
   * The controls of one driver, as they are now.
   * @param {{ steer: number, throttle: number, brake: number, handbrake: number, analog: boolean, lookBack?: boolean }} out
   * @param {'all'|'wasd'|'arrows'} [scheme] the driver's keys
   * @param {number} [zone] the driver's number: their touch zone and their pad
   */
  read(out, scheme = 'all', zone = 0) {
    const d = zone || 0;
    const source = this.source[d];
    if (source === 'pad') {
      const pad = this._pad(d);
      if (pad) return this._readPad(out, pad);
    }
    if (source === 'touch') return this._readTouch(out, d);
    const k = this.keys;
    const map = KEYS[scheme] || KEYS.all;
    const held = (codes) => codes.some((c) => k.has(c));
    out.steer = (held(map.right) ? 1 : 0) - (held(map.left) ? 1 : 0);
    out.throttle = held(map.up) ? 1 : 0;
    out.brake = held(map.down) ? 1 : 0;
    out.handbrake = held(map.hand) ? 1 : 0;
    out.lookBack = held(map.back);
    out.analog = false;
    out.device = 'keys';
    return out;
  }

  _readPad(out, pad) {
    const x = pad.axes[0] || 0;
    const a = Math.abs(x);
    const v = a < PAD_DEAD ? 0 : Math.pow((a - PAD_DEAD) / (1 - PAD_DEAD), PAD_CURVE);
    const pedal = (b) => {
      const btn = pad.buttons[b];
      const value = btn ? Math.max(btn.value, btn.pressed ? 1 : 0) : 0;
      return value < PAD_PEDAL_DEAD ? 0 : value;
    };
    out.steer = Math.sign(x) * Math.min(1, v);
    out.throttle = pedal(7);
    out.brake = pedal(6);
    // the handbrake on A, and on the right shoulder (RB) under the finger that rests there
    out.handbrake = pedal(0) > 0.5 || pedal(5) > 0.5 ? 1 : 0;
    out.lookBack = pedal(2) > 0.5;
    out.analog = true;
    out.device = 'pad';
    return out;
  }

  _readTouch(out, zone) {
    const i = this.touch[zone] ? zone : 0;
    const z = this.touch[i];
    const s = z.stick;
    let steer = 0;
    if (s) {
      const v = clamp((s.x - s.originX) / STEER_RANGE, -1, 1);
      steer = Math.sign(v) * Math.pow(Math.abs(v), STEER_CURVE);
    }
    const brake = this.brakeOf(i);
    const drift = z.drift !== null ? 1 : 0;
    out.steer = steer;
    out.brake = brake;
    out.handbrake = drift;
    // auto: the car drives while a thumb steers (and a moment after), not while the brake or DRIFT is held;
    // manual: only while GAS is held
    out.throttle = this.throttle === 'manual' ? (z.gas !== null ? 1 : 0) : (s || z.grace > 0) && !brake && !drift ? 1 : 0;
    out.lookBack = false;
    out.analog = true;
    out.device = 'touch';
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('blur', this._blur);
  }
}

/** Thumb travel for full lock (px): the drawn stick's ring is this wide either side. */
export { STEER_RANGE as STICK_RANGE };
