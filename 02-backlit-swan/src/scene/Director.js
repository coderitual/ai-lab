// Camera direction: who is holding the camera, and where it looks.
//
// There are two operators. The first is the film's: someone crouched on the
// south bank, a metre above the water, who keeps the swan in the picture as
// it turns and comes toward them, leaning in a little near the end. While the
// film plays, the camera stands where that person stood and is aimed at the
// swan from there, so the background slides past as it did in the film. The
// second is whoever is looking at the demo: the moment they touch the camera
// it is theirs, and it circles the swan wherever the swan goes.

import * as THREE from 'three';
import { CAMERA } from './config.js';
import { clamp, damp } from '../engine/math.js';
import { FILM } from './SwanMind.js';

const DEG = Math.PI / 180;
const _camera = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * Where the film's operator is, as seconds into the film: [time, east (m),
 * north (m)] from where they started. They lean in over the second half (the
 * swan fills 35 % more of the picture at the end than its own approach
 * accounts for).
 */
const OPERATOR = [
  [0, 0, 0],
  [3.5, 0, 0],
  [7, 0, 0.35],
  [10.5, 0, 0.75],
  [11, 0, 0.75],
];

/** Views a person can jump to: az and el are relative to the film's opening view. */
export const VIEWS = {
  film: { az: 0, el: CAMERA.el, dist: CAMERA.dist, label: 'The film’s view' },
  low: { az: -8, el: 3, dist: 3.4, label: 'Low on the water' },
  close: { az: 12, el: 9, dist: 2.3, label: 'Close' },
  high: { az: -25, el: 30, dist: 6.5, label: 'From above' },
  meadow: { az: 46, el: 8, dist: 5.5, label: 'Toward the meadow' },
};

function track(keys, t, column) {
  if (t <= keys[0][0]) return keys[0][column];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1][0]) {
      const u = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
      return keys[i][column] + (keys[i + 1][column] - keys[i][column]) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1][column];
}

/**
 * @param {object} ctx the shared context (see World.js)
 * @param {{ rig: import('../engine/OrbitRig.js').OrbitRig, mind: import('./SwanMind.js').SwanMind|null, staged?: boolean, view?: object }} parts
 *   `staged`: the camera was placed by the URL (`view`, as parsed by engine/params.js). It keeps exactly
 *   that angle, height and distance, and stays on the swan: ?tx= and ?tz= are then metres from the swan.
 */
export function createDirector(ctx, { rig, mind, staged = false, view = {} }) {
  // where the film's operator starts: where the default view puts the camera
  const start = new THREE.Vector3(
    CAMERA.target[0] - Math.sin(CAMERA.az * DEG) * Math.cos(CAMERA.el * DEG) * CAMERA.dist,
    CAMERA.target[1] + Math.sin(CAMERA.el * DEG) * CAMERA.dist,
    CAMERA.target[2] + Math.cos(CAMERA.az * DEG) * Math.cos(CAMERA.el * DEG) * CAMERA.dist,
  );
  const follow = new THREE.Vector3().fromArray(CAMERA.target);
  /** 'film': the film's operator has the camera. 'free': the person has. */
  let mode = mind && mind.filmTime !== null && !staged ? 'film' : 'free';
  let filmWasPlaying = mode === 'film';

  rig.onGrab = () => {
    if (mode === 'film') {
      mode = 'free';
      ctx.events.emit('camera', { mode });
    }
  };

  const director = {
    get mode() {
      return mode;
    },
    /** Start the film again, with its camera. */
    replay() {
      if (!mind) return;
      ctx.events.emit('cut', {});
      mind.playFilm();
      ctx.ripple.reset();
      follow.set(mind.position.x, CAMERA.target[1], mind.position.z);
      mode = 'film';
      filmWasPlaying = true;
      ctx.events.emit('camera', { mode });
      director.update(0);
    },
    /**
     * Go to one of VIEWS (by name), keeping the camera in the person's hands.
     * @param {keyof typeof VIEWS} name
     * @param {number} [seconds]
     */
    view(name, seconds = 1.4) {
      const v = VIEWS[name];
      if (!v) return;
      mode = 'free';
      rig.set({ az: CAMERA.az + v.az, el: v.el, dist: v.dist, fov: CAMERA.fov }, seconds);
      rig.idle = 0;
      ctx.events.emit('camera', { mode, view: name });
    },
    /**
     * @param {number} dt seconds of real time
     */
    update(dt) {
      if (!mind) return;
      if (staged) {
        const t = view.target || [];
        rig.target.set(mind.position.x + (t[0] ?? 0), t[1] ?? CAMERA.target[1], mind.position.z + (t[2] ?? 0));
        return;
      }
      const playing = mind.filmTime !== null;
      // The film is over, or was cut short (the swan was steered, called or
      // asked to do something): the camera stays exactly where the operator
      // had it, and now goes round the swan like any other.
      if (mode === 'film' && filmWasPlaying && !playing) {
        mode = 'free';
        ctx.events.emit('camera', { mode });
      }
      // The point the camera looks at trails the swan a little, as a hand on
      // a tripod head does, so that the picture breathes instead of being
      // nailed to it. From close up the picture holds less water, and a
      // swimming swan would leave it: the hand follows more tightly there.
      const lag = mode === 'film' ? 3.2 : 2.2 * clamp(CAMERA.dist / rig.dist, 1, 2.5);
      follow.x = damp(follow.x, mind.position.x, lag, dt);
      follow.z = damp(follow.z, mind.position.z, lag, dt);

      if (mode === 'film') {
        // stand where the operator stands and aim at the swan from there
        const t = playing ? mind.filmTime : FILM.duration;
        _camera.set(start.x + track(OPERATOR, t, 1), start.y, start.z - track(OPERATOR, t, 2));
        _aim.copy(follow);
        const dx = _aim.x - _camera.x;
        const dy = _camera.y - _aim.y;
        const dz = _aim.z - _camera.z;
        const flat = Math.hypot(dx, dz);
        rig.set({
          target: _aim,
          az: Math.atan2(dx, -dz) / DEG,
          el: clamp(Math.atan2(dy, flat) / DEG, rig.limits.minEl, rig.limits.maxEl),
          dist: Math.hypot(flat, dy),
        });
      } else {
        rig.target.set(follow.x, CAMERA.target[1], follow.z);
      }
      filmWasPlaying = playing;
    },
    dispose() {
      rig.onGrab = null;
    },
  };
  return director;
}
