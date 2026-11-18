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
// share a tablet, and every zone has the same fixed controls, laid out for its
// size by layoutOf() (which the HUD draws from, so a finger finds what it
// sees): at the bottom left the steering, either a slider (a track with a
// marked centre: the steering is how far the thumb is from that centre, which
// never moves, and the knob springs back when the thumb lifts) or two arrows
// (steering as keys do); at the bottom right the pedals: BRAKE, GAS (only
// with the throttle on manual: the corner is then GAS's, BRAKE beside it) and
// DRIFT (the handbrake) above them. A thumb anywhere in the steering zone
// (the lower part of the zone's left side) takes the steering; each control
// keeps the pointer that took it until that pointer lifts or is cancelled,
// wherever it slides; a touch anywhere else does nothing to the car. With the
// throttle on auto (the default) the car drives by itself, touched or not,
// and lifts while BRAKE or DRIFT is held. Holding BRAKE at a standstill
// reverses (the vehicle does that; this only reports the brake).
//
// Steering, pedals and the held look back are read by the drivers in the
// fixed step (read). Everything else is a moment: an action ('camera',
// 'reset', 'pause', 'time', 'high', 'ghost', 'mute', 'start', 'press', 'nav:up' ...) delivered to onAction as
// it happens, with the driver it belongs to (-1: nobody in particular). The
// engine knows nothing about cars: these are only names.

import { clamp } from './math.js';

/**
 * The touch controls of a zone, in CSS px inside the safe area (see layoutOf). The steering zone is the zone's
 * left `steerShare` below `steerTop` of its height. The slider's half travel is `half.base + half.perWidth` × the
 * zone's width, from `half.min` to `half.max`; it is shortened to stay clear of the pedals down to `half.ok`, and
 * beyond that the pedals in its way stand above it instead (BRAKE beside GAS on an upright phone; all of them on
 * half of one). Its knob's radius, and its centre `lift` px above the bottom edge. The arrows' and the pedals' radii; `gap` between controls and
 * `margin` from the edges. On a zone lower than `lowBelow` px (a stacked half on a phone) DRIFT stands beside the
 * pedals instead of above them. A finger finds a pedal within `slop` px more than its drawn radius.
 */
export const TOUCH = {
  steerShare: 0.5,
  steerTop: 0.45,
  margin: 18,
  gap: 12,
  half: { base: 56, perWidth: 0.05, min: 48, ok: 70, max: 92 },
  knob: 26,
  lift: 40,
  arrow: 38,
  gas: 44,
  brake: 40,
  drift: 34,
  lowBelow: 330,
  slop: 8,
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
     * Per zone: the steering thumb { id, x, value } (client x, and the steering it asks for, -1..1, worked out as
     * it moves) or null, and the fingers on the pedals (pointer id -> 'brake' | 'gas' | 'drift').
     */
    this.touch = [this._zone(), this._zone()];
    /** The throttle on touch: 'auto' (the car drives by itself, BRAKE lifts) or 'manual' (only while GAS is held). */
    this.throttle = 'auto';
    /** The steering on touch: 'slider' (a fixed centre, steering by the thumb's distance from it) or 'arrows'. */
    this.steering = 'slider';
    /** The safe area's insets (CSS px), which the controls stand inside (set by the game). */
    this.insets = { left: 0, right: 0, bottom: 0 };
    /** (name, driver) for each action as it happens. */
    this.onAction = null;
    /** (input) whenever a control is taken, moved or let go, for drawing it. */
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
      this.release();
    };
    // a hidden tab or a turned device: no finger is still where it was
    this._hidden = () => {
      if (document.hidden) this._blur();
    };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', this._blur);
    window.addEventListener('orientationchange', this._blur);
    document.addEventListener('visibilitychange', this._hidden);

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
    return { steer: null, pedals: new Map() };
  }

  /** Every finger let go: the knob back at the centre, no pedal held. */
  release() {
    for (let i = 0; i < this.touch.length; i++) this.touch[i] = this._zone();
    this._notify();
  }

  /** The zone's rectangle in client pixels. */
  _rectOf(i) {
    const r = this.surface.getBoundingClientRect();
    const z = this.zones[i] || this.zones[0];
    return { left: r.left + z.left * r.width, top: r.top + z.top * r.height, width: z.width * r.width, height: z.height * r.height };
  }

  /**
   * Where zone `i`'s touch controls are, in CSS px from the zone's top left (`x0`, `y0`: the zone's own top left in
   * client px): the steering zone { x1, y0 } (left of x1, below y0), the slider { cx, cy, half, knob } or the arrows
   * { left, right } ({ x, y, r } each), and the pedals { brake, gas (null on auto), drift }. The HUD draws them from
   * this, so a finger finds what it sees.
   */
  layoutOf(i) {
    const zr = this._rectOf(i);
    const z = this.zones[i] || this.zones[0];
    const ins = this.insets;
    const key = `${zr.left},${zr.top},${zr.width},${zr.height},${ins.left},${ins.right},${ins.bottom},${this.throttle},${this.steering},${z.left},${z.width},${z.top},${z.height}`;
    if (this._layouts && this._layouts[i] && this._layouts[i].key === key) return this._layouts[i];
    const T = TOUCH;
    const w = zr.width;
    const h = zr.height;
    // the safe area's insets only where the zone meets the screen's edge
    const left = (z.left < 0.001 ? ins.left : 0) + T.margin;
    const right = w - (z.left + z.width > 0.999 ? ins.right : 0) - T.margin;
    const bottom = h - (z.top + z.height > 0.999 ? ins.bottom : 0) - T.margin;
    // the pedals: the corner is GAS's on manual (BRAKE to its left), BRAKE's on auto; DRIFT above the corner, or
    // beside the row on a low zone
    const manual = this.throttle === 'manual';
    const c = manual ? T.gas : T.brake;
    const corner = { x: right - c, y: bottom - c, r: c };
    const gas = manual ? corner : null;
    const brake = manual ? { x: corner.x - c - T.gap - T.brake, y: bottom - T.brake, r: T.brake } : corner;
    const low = h < T.lowBelow;
    const leftmost = manual ? brake : corner;
    const drift = low
      ? { x: leftmost.x - leftmost.r - T.gap - T.drift, y: bottom - T.drift, r: T.drift }
      : { x: corner.x, y: corner.y - c - T.gap - T.drift, r: T.drift };
    // (too narrow for GAS and BRAKE side by side: one column, GAS, BRAKE, DRIFT from the bottom)
    if (manual && brake.x - brake.r < left) {
      Object.assign(brake, { x: corner.x, y: corner.y - c - T.gap - T.brake });
      Object.assign(drift, { x: corner.x, y: brake.y - T.brake - T.gap - T.drift });
    }
    const pedals = [gas, brake, drift].filter(Boolean);
    const leftOf = (list) => Math.min(...list.map((b) => b.x - b.r)) - T.gap;
    // the steering: the slider's travel for the zone's width; the arrows side by side
    const k = T.knob;
    const want = Math.max(Math.min(T.half.min, (right - left - 2 * k) / 2), Math.min(T.half.max, T.half.base + T.half.perWidth * w, (right - left - 2 * k) / 2));
    const fits = (leftOf(pedals) - left - 2 * k) / 2;
    const a = T.arrow;
    const arrows = { left: { x: left + a, y: bottom - a, r: a }, right: { x: left + 3 * a + T.gap, y: bottom - a, r: a } };
    const half = this.steering === 'arrows' || fits >= Math.min(want, T.half.ok) ? Math.max(Math.min(want, fits), Math.min(want, T.half.min)) : want;
    const slider = { cx: left + k + half, cy: bottom - T.lift, half, knob: k };
    const steerRight = this.steering === 'arrows' ? arrows.right.x + a : slider.cx + half + k;
    const steerTop = this.steering === 'arrows' ? bottom - 2 * a : slider.cy - k;
    // pedals in the steering's way (BRAKE beside GAS on an upright phone; all of them on half an upright phone)
    // stand above it: the corner's pedal takes the ones above it along
    const lift = bottom - (steerTop - T.gap);
    const inWay = (b) => b.x - b.r - T.gap < steerRight;
    if (inWay(corner)) for (const b of pedals) b.y -= lift;
    else for (const b of pedals) if (b !== corner && b.y > steerTop - b.r && inWay(b)) b.y = Math.min(b.y, steerTop - T.gap - b.r);
    const x1 = Math.max(w * T.steerShare, steerRight + T.gap);
    const out = { key, x0: zr.left, y0: zr.top, w, h, steering: this.steering, zone: { x1, y0: h * T.steerTop }, slider, arrows, brake, gas, drift };
    if (!this._layouts) this._layouts = [];
    this._layouts[i] = out;
    return out;
  }

  /** Which of a zone's pedals is under a point (client px), or ''. */
  _pedalAt(i, x, y) {
    const L = this.layoutOf(i);
    const hit = (b) => b && Math.hypot(x - L.x0 - b.x, y - L.y0 - b.y) <= Math.max(32, b.r + TOUCH.slop);
    if (hit(L.gas)) return 'gas';
    if (hit(L.brake)) return 'brake';
    if (hit(L.drift)) return 'drift';
    return '';
  }

  /** The steering a thumb at client x asks for in zone `i`, -1..1 (+ = right). */
  _steerAt(i, x) {
    const L = this.layoutOf(i);
    const u = x - L.x0;
    if (L.steering === 'arrows') return u < (L.arrows.left.x + L.arrows.right.x) / 2 ? -1 : 1;
    return clamp((u - L.slider.cx) / L.slider.half, -1, 1);
  }

  _down(e) {
    if (e.pointerType === 'mouse' || this._onButton(e)) return;
    e.preventDefault();
    this.isTouch = true;
    const zi = this._zoneAt(e.clientX, e.clientY);
    if (zi < 0) return;
    this.source[zi] = 'touch';
    if (this.onAnyInput) this.onAnyInput('touch');
    const z = this.touch[zi];
    const L = this.layoutOf(zi);
    const pedal = this._pedalAt(zi, e.clientX, e.clientY);
    const u = e.clientX - L.x0;
    const v = e.clientY - L.y0;
    let took = false;
    if (pedal) {
      z.pedals.set(e.pointerId, pedal);
      took = true;
    } else if (!z.steer && u < L.zone.x1 && v >= L.zone.y0) {
      // the steering zone: the first thumb there steers at once by where it is from the fixed centre
      z.steer = { id: e.pointerId, x: e.clientX, value: this._steerAt(zi, e.clientX) };
      took = true;
    }
    // anywhere else (or a second thumb on the steering) does nothing to the car
    if (took) {
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable: the moves still arrive while the finger is over the surface */
      }
    }
    this._notify();
  }

  _move(e) {
    for (let i = 0; i < this.touch.length; i++) {
      const s = this.touch[i].steer;
      if (!s || s.id !== e.pointerId) continue;
      e.preventDefault();
      s.x = e.clientX;
      s.value = this._steerAt(i, e.clientX);
      this._notify();
    }
  }

  _up(e) {
    let changed = false;
    for (const z of this.touch) {
      if (z.steer && z.steer.id === e.pointerId) {
        z.steer = null;
        changed = true;
      }
      if (z.pedals.delete(e.pointerId)) changed = true;
    }
    if (changed) this._notify();
  }

  _notify() {
    if (this.onTouchChange) this.onTouchChange(this);
  }

  /** Whether zone `i` has a finger on that pedal. */
  _held(i, name) {
    const z = this.touch[i];
    if (!z) return false;
    for (const p of z.pedals.values()) if (p === name) return true;
    return false;
  }

  /**
   * Zone `i`'s controls as drawn: the layout, the steering the thumb asks for (-1..1, or null with no thumb) and
   * which pedals are held.
   */
  controlsOf(i) {
    const z = this.touch[i];
    return {
      layout: this.layoutOf(i),
      steer: z && z.steer ? z.steer.value : null,
      held: { brake: this._held(i, 'brake'), gas: this._held(i, 'gas'), drift: this._held(i, 'drift') },
    };
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
    const brake = this._held(i, 'brake') ? 1 : 0;
    const drift = this._held(i, 'drift') ? 1 : 0;
    out.steer = z.steer ? z.steer.value : 0;
    out.brake = brake;
    out.handbrake = drift;
    // auto: the car drives by itself, and lifts while BRAKE or DRIFT is held; manual: only while GAS is held
    out.throttle = this.throttle === 'manual' ? (this._held(i, 'gas') ? 1 : 0) : !brake && !drift ? 1 : 0;
    out.lookBack = false;
    // the slider is a stick (its curve and smoothing are the hands', HANDS.thumb); the arrows are keys
    out.analog = this.steering !== 'arrows';
    out.device = 'touch';
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('blur', this._blur);
    window.removeEventListener('orientationchange', this._blur);
    document.removeEventListener('visibilitychange', this._hidden);
  }
}
