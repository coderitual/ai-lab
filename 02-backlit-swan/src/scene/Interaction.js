// What a person can do to the scene, apart from moving the camera (which is
// the rig's own business, engine/OrbitRig.js).
//
//   touch the water   a drop falls there: rings, a glint, and the swan comes
//                     over and feeds
//   touch the swan    it shakes its head
//   double tap        back to the film's view
//   W A S D, or the   the swan swims that way for as long as they are held,
//   on-screen stick   as the picture shows it: up is away from the camera,
//                     left is the picture's left
//   keys              the same things as the on-screen buttons (see KEYS)

import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _from = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _look = new THREE.Vector3();
const WATER = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** What each key does; shown in the help panel. */
export const KEYS = [
  ['W A S D', 'swim'],
  ['Space', 'shake'],
  ['E', 'dunk'],
  ['R', 'reach'],
  ['F', 'play the film again'],
  ['1 – 5', 'views'],
  ['Arrows', 'move the camera'],
  ['+ −', 'closer, further'],
  ['T', 'slow motion'],
  ['M', 'sound'],
  ['H', 'hide the controls'],
];

/**
 * The keys that swim the swan, by where they are on the keyboard (so that
 * the same four fingers work on a French or a German one): [right, away].
 */
const SWIM_KEYS = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };

/** The stick does nothing until it is pushed this far (of its travel): a resting thumb is not an order. */
const STICK_DEAD = 0.14;

/**
 * @param {object} ctx the shared context (see World.js)
 * @param {{ domElement: HTMLElement, camera: THREE.Camera, rig: import('../engine/OrbitRig.js').OrbitRig,
 *   mind: import('./SwanMind.js').SwanMind|null, droplets?: object|null, director?: object|null }} parts
 * @returns {{ touchWater: (x: number, z: number) => boolean, setStick: (x: number, y: number) => void, steering: { x: number, y: number },
 *   update: (dt: number, time: number) => void, dispose: () => void }}
 *   `setStick`: where the on-screen stick is, x to the right and y up, each -1..1 (0, 0 when let go).
 *   `steering`: what the keys and the stick together are asking for right now, in the same terms
 *   (its length is the strength, 0..1): for the UI to show.
 */
export function createInteraction(ctx, { domElement, camera, rig, mind, droplets = null, director = null }) {
  /**
   * A drop let fall on the water at a point, and the swan called to it.
   * @returns {boolean} whether the point was on the pond
   */
  function touchWater(x, z) {
    if (ctx.pond.shoreDistance(x, z) > -1.5) return false; // the same margin SwanMind.callTo keeps from the bank
    if (droplets) {
      // from just above, so that it is seen to fall and lands a moment later
      droplets.spawn({ position: _from.set(x, 0.55, z), velocity: _velocity.set(0, -0.6, 0), spread: 0.02, count: 1, size: 0.011 });
    } else {
      ctx.ripple.disturb(x, z, 0.06, 0.006);
    }
    ctx.events.emit('tap', { x, z });
    if (mind) mind.callTo(x, z);
    return true;
  }

  rig.onTap = (px, py) => {
    const w = domElement.clientWidth || 1;
    const h = domElement.clientHeight || 1;
    _ndc.set((px / w) * 2 - 1, 1 - (py / h) * 2);
    _ray.setFromCamera(_ndc, camera);
    // the swan itself? (a ball round its body and one round its head are near enough)
    if (mind) {
      const s = mind.swan;
      _hit.copy(mind.position).setY(0.14);
      const body = _ray.ray.distanceSqToPoint(_hit) < 0.3 * 0.3;
      const head = _ray.ray.distanceSqToPoint(s.headPosition) < 0.12 * 0.12;
      if (body || head) {
        mind.act('shake');
        ctx.events.emit('tap', { x: mind.position.x, z: mind.position.z, swan: true });
        return;
      }
    }
    if (_ray.ray.direction.y >= -0.01) return; // above the horizon: sky, trees
    if (!_ray.ray.intersectPlane(WATER, _hit)) return;
    touchWater(_hit.x, _hit.z);
  };
  rig.onDoubleTap = () => {
    if (director) director.view('film');
  };

  const actions = {
    ' ': () => mind && mind.act('shake'),
    e: () => mind && mind.act('dunk'),
    r: () => mind && mind.act('reach'),
    f: () => director && director.replay(),
    1: () => director && director.view('film'),
    2: () => director && director.view('low'),
    3: () => director && director.view('close'),
    4: () => director && director.view('high'),
    5: () => director && director.view('meadow'),
    arrowleft: () => rig.nudge(-4, 0),
    arrowright: () => rig.nudge(4, 0),
    arrowup: () => rig.nudge(0, 2),
    arrowdown: () => rig.nudge(0, -2),
    '+': () => rig.nudge(0, 0, 0.9),
    '=': () => rig.nudge(0, 0, 0.9),
    '-': () => rig.nudge(0, 0, 1.1),
    t: () => ctx.events.emit('key', { name: 'slow' }),
    m: () => ctx.events.emit('key', { name: 'sound' }),
    h: () => ctx.events.emit('key', { name: 'hide' }),
  };
  /** Which of SWIM_KEYS are down. */
  const held = new Set();
  const stick = { x: 0, y: 0 };
  const steering = { x: 0, y: 0 };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      // A shortcut of the browser's, not ours; and the key that goes up
      // while Command is down is never reported, so nothing stays held.
      held.clear();
      return;
    }
    if (e.defaultPrevented) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (SWIM_KEYS[e.code]) {
      e.preventDefault();
      held.add(e.code);
      return;
    }
    // Space on a control that has the keyboard's focus presses that control
    if (tag === 'BUTTON' && e.key === ' ') return;
    const action = actions[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault();
    action();
  };
  const onKeyUp = (e) => held.delete(e.code);
  // A key that is down when the window loses the keyboard never comes up as
  // far as this page is told: let go of everything.
  const letGo = () => held.clear();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', letGo);

  return {
    touchWater,
    setStick(x, y) {
      stick.x = Number.isFinite(x) ? x : 0;
      stick.y = Number.isFinite(y) ? y : 0;
    },
    steering,
    /**
     * Once a step: pass on what the keys and the stick ask for. (The swan is
     * steered for as long as it keeps being told; see SwanMind.steer.)
     */
    update() {
      let x = 0;
      let y = 0;
      for (const code of held) {
        x += SWIM_KEYS[code][0];
        y += SWIM_KEYS[code][1];
      }
      let strength = 0;
      if (x !== 0 || y !== 0) {
        // keys are all or nothing; two together are a diagonal, not a faster swan
        strength = 1;
      } else if (held.size === 0) {
        x = stick.x;
        y = stick.y;
        strength = Math.min(1, Math.max(0, (Math.hypot(x, y) - STICK_DEAD) / (1 - STICK_DEAD)));
      }
      const length = Math.hypot(x, y);
      if (!(strength > 0) || !(length > 0)) {
        steering.x = steering.y = 0;
        return;
      }
      x /= length;
      y /= length;
      steering.x = x * strength;
      steering.y = y * strength;
      if (!mind) return;
      // "Away" is where the camera looks, laid flat on the water; "right" is
      // the picture's right. (The camera never looks straight down: the rig
      // stops well short of it.)
      camera.getWorldDirection(_look);
      const flat = Math.hypot(_look.x, _look.z) || 1;
      const fx = _look.x / flat;
      const fz = _look.z / flat;
      mind.steer(fx * y - fz * x, fz * y + fx * x, strength);
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', letGo);
      rig.onTap = null;
      rig.onDoubleTap = null;
    },
  };
}
