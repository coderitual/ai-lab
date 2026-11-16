// The camera on a boom: it looks at a target from a compass direction, an
// angle above the ground and a distance, through a lens of a given width.
//
// Angles are in degrees, lengths in metres.
//
//   az    the compass direction the camera LOOKS in: 0 looks north (toward -Z)
//         from due south of the target, 90 looks east (toward +X) from the west
//   el    how far above the horizontal plane through the target the camera is
//   dist  from the target
//   fov   the field of view of a square picture with the same area as the
//         real one (see update() for why)
//
// Views can be set from code (set(), optionally eased), and a person can move
// the camera directly: drag with one finger or the mouse to go round and up
// and down, pinch or turn the wheel to come closer or back off. A drag keeps
// a little of its speed when let go and coasts to a stop. A press that does
// not move is a tap and is handed to whoever asked for taps (onTap); two taps
// close together are a double tap (onDoubleTap). Left alone, the camera
// breathes a little on its own.

import * as THREE from 'three';
import { DEG, angleDiffDeg, clamp, lerp } from './math.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class OrbitRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement what gestures will be listened on (unused so far)
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    /** Whether gestures move the camera (there are none yet). Views set from code always apply. */
    this.enabled = true;

    this.target = new THREE.Vector3();
    this.az = 0;
    this.el = 6;
    this.dist = 20;
    this.fov = 12;
    /**
     * Where the target sits in the picture, in units of half the picture
     * (0, 0 is the centre, y = -0.3 is 30 % of the way down). The camera is
     * turned, not moved, so the perspective on the target does not change.
     */
    this.offset = new THREE.Vector2();

    /** Limits applied to whatever is set. `minHeight` keeps the lens out of the water. */
    this.limits = { minEl: 1, maxEl: 60, minDist: 2, maxDist: 60, minFov: 3, maxFov: 50, minHeight: 0.12 };
    /** Idle movement: degrees of sway and seconds per cycle. Zero amplitude switches it off. */
    this.drift = { az: 0.35, el: 0.12, period: 46 };

    this._blend = null; // { from, to, t, seconds }
    this._time = 0;

    // --- gestures
    /** Degrees of orbit per CSS pixel dragged, and how quickly a released drag dies away (1/s). */
    this.feel = { az: 0.22, el: 0.14, coast: 5.5 };
    /** Called with canvas coordinates (CSS pixels from its top-left) when the canvas is tapped. */
    this.onTap = null;
    /** Called when it is tapped twice within a third of a second. */
    this.onDoubleTap = null;
    /** Called when a person starts moving the camera (a drag past the tap threshold, a second finger landing, the wheel, a key). */
    this.onGrab = null;
    /** Seconds since a person last moved the camera; large if never. */
    this.idle = 1e9;
    this._pointers = new Map(); // id -> { x, y, startX, startY, moved, time }
    this._pinch = 0; // distance between two fingers at the last move
    this._spin = { az: 0, el: 0 }; // degrees per second left over from the last drag
    this._lastTap = -1e9;
    this._tapTimer = null;
    this._listeners = [];
    if (domElement && typeof domElement.addEventListener === 'function') this._listen(domElement);
  }

  _listen(el) {
    const on = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this._listeners.push(() => target.removeEventListener(type, fn, options));
    };
    const grab = () => {
      this.idle = 0;
      this._blend = null;
      if (this.onGrab) this.onGrab();
    };
    const local = (e) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    on(el, 'pointerdown', (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // a pointer that is already gone cannot be captured: nothing to do
        }
      }
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, time: e.timeStamp });
      this._spin.az = this._spin.el = 0;
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._pinch = Math.hypot(a.x - b.x, a.y - b.y);
        a.moved = b.moved = true; // two fingers down is never a tap
        // A pinch takes the camera here: marking both fingers as moved means
        // the "first real movement" test in pointermove will never fire for
        // them, and without this whoever is setting views from code (a blend,
        // or a director writing the distance every frame) would undo the pinch.
        grab();
      }
    });

    on(el, 'pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      // a finger never rests perfectly still: a few pixels are still a tap
      if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > (e.pointerType === 'mouse' ? 4 : 9)) {
        p.moved = true;
        grab();
      }
      if (!p.moved) return;
      if (this._pointers.size >= 2) {
        const [a, b] = [...this._pointers.values()];
        const spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch > 0 && spread > 0) this.dist = clamp((this.dist * this._pinch) / spread, this.limits.minDist, this.limits.maxDist);
        this._pinch = spread;
        this.idle = 0;
        return;
      }
      // Dragging right brings the camera round to the left of the subject (as
      // if the scene were turned by hand); dragging down lifts the camera.
      const daz = dx * this.feel.az;
      const del = dy * this.feel.el;
      this.az += daz;
      this.el = clamp(this.el + del, this.limits.minEl, this.limits.maxEl);
      // remember the speed for coasting (pixels arrive in bursts: smooth it a little)
      const dt = Math.max(1 / 240, (e.timeStamp - (p.last ?? e.timeStamp - 16)) / 1000);
      p.last = e.timeStamp;
      this._spin.az = this._spin.az * 0.5 + (daz / dt) * 0.5;
      this._spin.el = this._spin.el * 0.5 + (del / dt) * 0.5;
      this.idle = 0;
    });

    const release = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this._pointers.delete(e.pointerId);
      this._pinch = 0;
      if (this._pointers.size > 0) {
        // one finger of a pinch lifted: the other carries on as a drag, without a jump
        this._spin.az = this._spin.el = 0;
        return;
      }
      if (e.type === 'pointercancel') {
        this._spin.az = this._spin.el = 0;
        return;
      }
      if (p.moved) {
        // a drag that had stopped before the finger lifted does not coast
        if (e.timeStamp - (p.last ?? 0) > 90) this._spin.az = this._spin.el = 0;
        return;
      }
      if (e.timeStamp - p.time > 600) return; // a long press is not a tap
      const now = e.timeStamp;
      const [x, y] = local(e);
      if (now - this._lastTap < 330) {
        this._lastTap = -1e9;
        clearTimeout(this._tapTimer);
        this._tapTimer = null;
        if (this.onDoubleTap) this.onDoubleTap(x, y);
      } else {
        this._lastTap = now;
        // wait to see whether a second tap follows, unless nobody cares about double taps
        const fire = () => {
          this._tapTimer = null;
          if (this.onTap) this.onTap(x, y);
        };
        if (this.onDoubleTap) this._tapTimer = setTimeout(fire, 340);
        else fire();
      }
    };
    on(el, 'pointerup', release);
    on(el, 'pointercancel', release);

    on(
      el,
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        grab();
        // a notch of a mouse wheel is about 100; a trackpad sends many small ones
        const step = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey ? 3 : 1);
        this.dist = clamp(this.dist * Math.exp(step * 0.0012), this.limits.minDist, this.limits.maxDist);
      },
      { passive: false },
    );
    // the browser's own gestures on the canvas (scroll, zoom, the long-press menu) would fight these
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'gesturestart', (e) => e.preventDefault());
  }

  /** Whether a finger or the mouse is holding the camera right now. */
  get held() {
    return this._pointers.size > 0;
  }

  /**
   * Turn and tilt by hand from code (keys): degrees.
   */
  nudge(daz, del, zoom = 1) {
    this._blend = null;
    this.idle = 0;
    this.az += daz;
    this.el = clamp(this.el + del, this.limits.minEl, this.limits.maxEl);
    this.dist = clamp(this.dist * zoom, this.limits.minDist, this.limits.maxDist);
    if (this.onGrab) this.onGrab();
  }

  /**
   * Go to a view. Values that are left out stay as they are.
   * @param {{ az?: number, el?: number, dist?: number, fov?: number, target?: THREE.Vector3|number[], offset?: number[] }} view
   *   `target` may be an array with holes (undefined keeps that coordinate).
   * @param {number} [seconds] time to ease there; 0 jumps
   */
  set(view, seconds = 0) {
    const to = this._snapshot();
    for (const key of ['az', 'el', 'dist', 'fov']) if (Number.isFinite(view[key])) to[key] = view[key];
    if (view.target) {
      const t = view.target.isVector3 ? view.target.toArray() : view.target;
      for (let i = 0; i < 3; i++) if (Number.isFinite(t[i])) to.target[i] = t[i];
    }
    if (view.offset) for (let i = 0; i < 2; i++) if (Number.isFinite(view.offset[i])) to.offset[i] = view.offset[i];
    this._clampView(to);
    if (seconds > 0) {
      const from = this._snapshot();
      // go round the short way
      to.az = from.az + angleDiffDeg(from.az, to.az);
      this._blend = { from, to, t: 0, seconds };
    } else {
      this._blend = null;
      this._apply(to);
    }
  }

  _snapshot() {
    return { az: this.az, el: this.el, dist: this.dist, fov: this.fov, target: this.target.toArray(), offset: this.offset.toArray() };
  }

  _apply(v) {
    this.az = v.az;
    this.el = v.el;
    this.dist = v.dist;
    this.fov = v.fov;
    this.target.fromArray(v.target);
    this.offset.fromArray(v.offset);
  }

  _clampView(v) {
    const l = this.limits;
    v.el = clamp(v.el, l.minEl, l.maxEl);
    v.dist = clamp(v.dist, l.minDist, l.maxDist);
    v.fov = clamp(v.fov, l.minFov, l.maxFov);
  }

  /**
   * Move toward the view being blended to and write the camera.
   * @param {number} dt seconds of real time
   * @param {number} aspect width / height of the picture
   */
  update(dt, aspect) {
    this._time += dt;
    this.idle += dt;
    // a released drag coasts on and dies away
    if (!this.held && (this._spin.az !== 0 || this._spin.el !== 0)) {
      this.az += this._spin.az * dt;
      this.el = clamp(this.el + this._spin.el * dt, this.limits.minEl, this.limits.maxEl);
      const keep = Math.exp(-this.feel.coast * dt);
      this._spin.az *= keep;
      this._spin.el *= keep;
      if (Math.abs(this._spin.az) + Math.abs(this._spin.el) < 0.05) this._spin.az = this._spin.el = 0;
      else this.idle = 0;
    }
    if (this._blend) {
      const b = this._blend;
      b.t = Math.min(1, b.t + dt / b.seconds);
      const k = b.t * b.t * (3 - 2 * b.t);
      this._apply({
        az: lerp(b.from.az, b.to.az, k),
        el: lerp(b.from.el, b.to.el, k),
        dist: lerp(b.from.dist, b.to.dist, k),
        fov: lerp(b.from.fov, b.to.fov, k),
        target: b.from.target.map((v, i) => lerp(v, b.to.target[i], k)),
        offset: b.from.offset.map((v, i) => lerp(v, b.to.offset[i], k)),
      });
      if (b.t >= 1) this._blend = null;
    }

    const { camera, limits } = this;
    // Two slow sways with periods that never line up, so the idle movement
    // does not read as a loop. They fade out while the camera is being moved
    // by hand and come back a few seconds after it is let go.
    const phase = (this._time / Math.max(1, this.drift.period)) * Math.PI * 2;
    const calm = clamp((this.idle - 1.5) / 4, 0, 1);
    const az = (this.az + this.drift.az * calm * Math.sin(phase)) * DEG;
    const el = clamp(this.el + this.drift.el * calm * Math.sin(phase * 0.618 + 1.3), limits.minEl, limits.maxEl) * DEG;

    // from the target back to the camera
    _dir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(this.target).addScaledVector(_dir, this.dist);
    if (camera.position.y < limits.minHeight) camera.position.y = limits.minHeight;

    // The lens. A phone held upright and a wide desktop window should both
    // show the subject at a sensible size. Keeping the vertical angle would
    // make it tiny in a wide window; keeping the horizontal angle would crop
    // it on the phone. Keeping the AREA of the view gives both: `fov` is the
    // angle of a square picture, a tall picture gets a taller and narrower
    // one, a wide picture a wider and lower one.
    const a = clamp(aspect, 0.4, 2.4);
    const tanSquare = Math.tan((this.fov * DEG) / 2);
    const tanV = tanSquare / Math.sqrt(a);
    const tanH = tanV * aspect;
    camera.fov = (2 * Math.atan(tanV)) / DEG;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // Aim so that the target lands at `offset` in the picture: swing the line
    // of sight by the matching angles instead of pointing straight at it.
    _right.set(Math.cos(az), 0, Math.sin(az));
    _up.crossVectors(_right, _dir).negate();
    const d = camera.position.distanceTo(this.target);
    _aim.copy(this.target).addScaledVector(_right, -this.offset.x * tanH * d).addScaledVector(_up, -this.offset.y * tanV * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(_aim);
    camera.updateMatrixWorld(true);
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
    this._pointers.clear();
    clearTimeout(this._tapTimer);
  }
}
