// What the swan does.
//
// Two things live here. The first is the film: an eleven-second performance
// (drip, shake, turn through the light, dunk, lift, reach) written down as
// tracks of headings, speeds and neck shapes with the times measured from the
// reference, which the swan plays when the demo opens and whenever it is asked
// to. The second is a swan left to itself: it glides about the sunlit part of
// the pond, and now and then dunks its bill, reaches, looks round or shakes;
// it comes when the water is touched and feeds there.
//
// Either way this file only decides where the bird is, which way it faces and
// what shape its neck is in. The shapes themselves are assets/swan/poses.js;
// the drops are assets/fx/Droplets.js; the rings are the ripple field.

import * as THREE from 'three';
import { POSES, createPose, copyPose, blendPose } from '../assets/swan/Swan.js';
import { L } from '../assets/swan/anatomy.js';
import { angleDiff, clamp, damp } from '../engine/math.js';

const DEG = Math.PI / 180;
const _forward = new THREE.Vector3();
const _left = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _point = new THREE.Vector3();

/**
 * Staging for pictures, from the URL:
 *
 *   ?heading=10   which way the swan faces, as the film is described: 0 side-on
 *                 facing the left of the default picture, 90 facing the camera, 180 facing right
 *   ?pose=A       one of the film's neck shapes (A B C D E G F, see assets/swan/poses.js)
 *   ?still        no film, no drifting, no breathing: the swan stays exactly as staged
 *   ?turn= ?look= ?bill= ?sway=    degrees, written over the pose
 *   ?wing= ?bow= ?stretch= ?bodystretch= ?tail=    plain numbers, written over the pose
 *   ?film=0       do not open with the film: the swan is on its own from the start
 */
function readStage() {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const num = (key) => {
    const v = parseFloat(q.get(key));
    return Number.isFinite(v) ? v : undefined;
  };
  const over = {};
  for (const [key, field, scale] of [['turn', 'turn', DEG], ['look', 'look', DEG], ['bill', 'bill', DEG], ['sway', 'sway', DEG], ['wing', 'wingLift', 1], ['bow', 'bow', 1], ['stretch', 'stretch', 1], ['bodystretch', 'bodyStretch', 1], ['tail', 'tail', 1]]) {
    const v = num(key);
    if (v !== undefined) over[field] = v * scale;
  }
  const heading = num('heading');
  return {
    heading: heading === undefined ? undefined : (heading - 90) * DEG,
    pose: (q.get('pose') || '').toUpperCase(),
    still: q.has('still'),
    film: q.get('film') !== '0',
    over,
  };
}

/** A neck shape between two others, as a pose of its own. */
function between(a, b, t, extra) {
  return Object.assign(blendPose(createPose(), a, b, t), extra);
}

// Shapes the film passes through that are not among its seven still frames.
const SHAPES = {
  ...POSES,
  /** E a moment later: the head has sunk to eye level and drifted forward. */
  E2: between(POSES.E, POSES.F, 0.12, { bow: 0.85 }),
  /** Hovering just clear of the water between the two touches of the dunk. */
  H: between(POSES.E, POSES.D, 0.55, { bill: 1.5 }),
  /** Most of the way up from the dunk. */
  G1: between(POSES.D, POSES.G, 0.8),
  /** The reach at the moment the bill touches: longer than F, the body not yet drawn up to it. */
  F1: between(POSES.G, POSES.F, 1.0, { bodyStretch: 1, bow: 0.8, wingLift: 0.25 }),
};

/**
 * The film, as measured (docs/design.md, "The performance"). Seconds are real
 * seconds. Headings are the film's: 0 side-on facing the left of the picture,
 * 90 facing the camera, 180 facing right. Speeds are in body lengths a second.
 */
export const FILM = {
  duration: 11,
  heading: [[0, 10], [0.5, 18], [1, 26], [1.5, 32], [2, 40], [2.5, 45], [3, 55], [3.25, 63], [3.5, 76], [3.75, 92], [4, 106], [4.25, 118], [4.5, 123], [4.75, 125], [5.5, 126], [6, 130], [6.5, 135], [7, 148], [7.5, 155], [8, 162], [8.5, 168], [9, 170], [10.5, 172], [11, 172]],
  speed: [[0, 0.16], [3, 0.16], [4, 0.3], [5, 0.34], [7, 0.3], [8, 0.33], [9.5, 0.36], [10, 0.2], [11, 0.12]],
  pose: [[0, 'A'], [0.87, 'A'], [1.17, 'B'], [1.5, 'B'], [2, 'C'], [4.62, 'C'], [4.75, 'D'], [4.9, 'E'], [5.7, 'E2'], [5.92, 'H'], [6.08, 'H'], [6.2, 'E'], [6.33, 'H'], [6.4, 'H'], [7, 'G1'], [7.5, 'G'], [8.4, 'G'], [9.9, 'F1'], [10.5, 'F'], [11, 'F']],
  /** When the shake starts. */
  shake: 0.9,
  /** Drops that fall from the bill before the shake: it has just drunk. */
  drips: [0.0, 0.03, 0.32, 0.37, 0.58, 0.62, 0.65, 0.68],
};

/** The shake: two turns of the head and a bit, at 3.6 a second. */
const SHAKE = { rate: 3.64, seconds: 0.58, swing: 1.45, beads: 150 };

/** Value of a track of [time, value] pairs at t, smoothly (Catmull-Rom through the keys). */
function sample(track, t) {
  const n = track.length;
  if (t <= track[0][0]) return track[0][1];
  if (t >= track[n - 1][0]) return track[n - 1][1];
  let i = 0;
  while (i < n - 2 && track[i + 1][0] <= t) i++;
  const [t1, v1] = track[i];
  const [t2, v2] = track[i + 1];
  const [t0, v0] = track[Math.max(0, i - 1)];
  const [t3, v3] = track[Math.min(n - 1, i + 2)];
  const u = (t - t1) / (t2 - t1);
  // slopes at the two keys, from their neighbours; zero where a neighbour is missing
  const m1 = i > 0 ? ((v2 - v0) / (t2 - t0)) * (t2 - t1) : 0;
  const m2 = i < n - 2 ? ((v3 - v1) / (t3 - t1)) * (t2 - t1) : 0;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2;
}

/** The pose of a track of [time, pose] pairs at t: eased from each key to the next. */
function samplePose(out, track, t) {
  const n = track.length;
  if (t <= track[0][0]) return copyPose(out, track[0][1]);
  if (t >= track[n - 1][0]) return copyPose(out, track[n - 1][1]);
  let i = 0;
  while (i < n - 2 && track[i + 1][0] <= t) i++;
  const u = (t - track[i][0]) / (track[i + 1][0] - track[i][0]);
  return blendPose(out, track[i][1], track[i + 1][1], u * u * (3 - 2 * u));
}

const FILM_POSES = FILM.pose.map(([t, name]) => [t, SHAPES[name]]);

/** The patch of sunlit water the swan keeps to when left alone: centre and radii, metres. */
const HOME = { x: 0, z: 0.7, rx: 3.2, rz: 1.9 };

export class SwanMind {
  /**
   * @param {object} ctx the shared context (see World.js)
   * @param {import('../assets/swan/Swan.js').Swan} swan
   * @param {ReturnType<import('../assets/fx/Droplets.js').createDroplets>|null} droplets
   */
  constructor(ctx, swan, droplets) {
    this.ctx = ctx;
    this.swan = swan;
    this.droplets = droplets;
    this.rng = ctx.rng.fork('mind');
    /** Where the swan is on the water (y stays 0). */
    this.position = new THREE.Vector3(0, 0, 0);
    /** Radians; the swan faces (sin h, 0, cos h). */
    this.heading = (FILM.heading[0][1] - 90) * DEG;
    /** Metres a second. */
    this.speed = 0;
    /** Seconds into the film while it is playing, otherwise null. */
    this.filmTime = null;

    this._pose = copyPose(createPose(), POSES.A);
    this._rest = createPose();
    this._track = null; // { keys: [[t, pose]], t, end, name, slow }
    this._shake = null; // { t }
    this._look = 0; // where the head is turned to, radians
    this._lookWant = 0;
    this._lookFor = 0;
    this._goal = null; // { x, z } while called somewhere
    this._queued = null;
    this._wander = this.rng.range(0, 100);
    this._nextAct = this.rng.range(4, 7);
    this._sinceWake = 0;
    this._sinceStir = 0;
    this._billIn = false;
    this._under = 0; // seconds the bill has been under water
    this._wet = 0; // water left on the bill, 0..1
    this._nextDrip = 0;
    this._dripsDone = 0;
    this._tip = new THREE.Vector3();
    this._tipVelocity = new THREE.Vector3();

    this._stage = readStage();
    if (this._stage.still) {
      if (this._stage.heading !== undefined) this.heading = this._stage.heading;
      copyPose(this._pose, POSES[this._stage.pose] || POSES.A);
      swan.breathing.depth = 0;
    } else if (this._stage.film) {
      this.playFilm();
    } else if (this._stage.heading !== undefined) {
      this.heading = this._stage.heading;
    }
    this._write();
    this._tip.copy(swan.billTip);
  }

  /** 'film' | 'idle' | 'swim' | 'shake' | 'dunk' | 'reach' | 'look' */
  get state() {
    if (this.filmTime !== null) return 'film';
    if (this._shake) return 'shake';
    if (this._track) return this._track.name;
    if (this._goal) return 'swim';
    return this._lookFor > 0 ? 'look' : 'idle';
  }

  /** Whether the swan is in the middle of something it will finish before starting anything else. */
  get busy() {
    return this.filmTime !== null || !!this._track || !!this._shake;
  }

  /** Start the film from its first frame: the swan is put back where the film begins. */
  playFilm() {
    this.filmTime = 0;
    this.position.set(0, 0, 0);
    this.heading = (FILM.heading[0][1] - 90) * DEG;
    this.speed = FILM.speed[0][1] * L;
    this._track = null;
    this._shake = null;
    this._goal = null;
    this._queued = null;
    this._look = this._lookWant = this._lookFor = 0;
    this._wet = 0.5;
    this._dripsDone = 0;
    this._billIn = false;
    this._under = 0;
    copyPose(this._pose, POSES.A);
  }

  /** Leave the film where it is and carry on alone. */
  endFilm() {
    this.filmTime = null;
  }

  /** Swim to a point on the water and feed there. */
  callTo(x, z) {
    if (this._stage.still) return;
    if (this.ctx.pond.shoreDistance(x, z) > -1.5) return; // not onto the bank
    this.endFilm();
    this._goal = { x, z };
    // whatever it was doing with its head, it stops
    if (this._track && !this._billIn) this._track = null;
  }

  /**
   * Do one of the things the swan does in the film. If it is busy the request
   * waits its turn (only the latest one is kept).
   * @param {'shake'|'dunk'|'dip'|'reach'|'look'|'lift'} name
   */
  act(name) {
    if (this._stage.still) return;
    if (name === 'dip') name = 'dunk';
    if (name === 'lift') name = 'look';
    if (!['shake', 'dunk', 'reach', 'look'].includes(name)) return;
    this.endFilm();
    if (this.busy) {
      this._queued = name;
      return;
    }
    this._start(name);
  }

  _start(name) {
    const rng = this.rng;
    const now = copyPose(createPose(), this._pose);
    const rest = this._restPose(createPose());
    if (name === 'dunk') {
      const hold = rng.range(0.7, 1.5);
      const keys = [[0, now], [0.14, SHAPES.D], [0.3, SHAPES.E], [0.3 + hold, SHAPES.E2], [0.52 + hold, SHAPES.H]];
      let t = 0.52 + hold + rng.range(0.15, 0.5);
      keys.push([t, SHAPES.H]);
      if (rng.float() < 0.5) {
        // a second, shorter touch, as in the film
        keys.push([t + 0.13, SHAPES.E], [t + 0.28, SHAPES.H]);
        t += 0.34;
      }
      keys.push([t + 0.62, SHAPES.G1], [t + 1.1, SHAPES.G], [t + 2.4, rest]);
      this._track = { keys, t: 0, end: t + 2.4, name };
    } else if (name === 'reach') {
      const hold = rng.range(1.2, 2.6);
      const keys = [[0, now], [1.5, SHAPES.F1], [1.5 + hold, SHAPES.F], [2.6 + hold, SHAPES.G], [4.2 + hold, rest]];
      this._track = { keys, t: 0, end: 4.2 + hold, name, slow: [1.2, 1.7 + hold] };
    } else if (name === 'shake') {
      const keys = [[0, now], [0.3, SHAPES.B], [0.3 + SHAKE.seconds + 0.05, SHAPES.B], [1.5, SHAPES.C], [2.6, rest]];
      this._track = { keys, t: 0, end: 2.6, name, shakeAt: 0.3 };
    } else if (name === 'look') {
      this._lookWant = rng.sign() * rng.range(0.5, 1.0);
      this._lookFor = rng.range(1.6, 3.2);
    }
  }

  /** The shape the neck settles into when nothing else is asked of it: it wanders slowly between three of the film's. */
  _restPose(out) {
    const w = this._wander;
    blendPose(out, POSES.A, POSES.C, 0.5 + 0.5 * Math.sin(w * 0.13));
    return blendPose(out, out, POSES.G, 0.3 + 0.3 * Math.sin(w * 0.071 + 2.0));
  }

  /**
   * @param {number} dt seconds (already slowed, if time is)
   * @param {number} time seconds since the start
   */
  update(dt, time) {
    const { swan, ctx, rng } = this;
    if (this._stage.still || dt <= 0) {
      this._write();
      return;
    }
    this._wander += dt;

    let wantHeading = this.heading;
    let wantSpeed = 0.07;
    let turnRate = 0.9; // how quickly the heading follows, 1/s
    let glide = 1.2; // how quickly the speed follows, 1/s

    if (this.filmTime !== null) {
      // ---- the film: everything is read off its tracks
      const t = this.filmTime;
      this.heading = (sample(FILM.heading, t) - 90) * DEG;
      this.speed = sample(FILM.speed, t) * L;
      samplePose(this._pose, FILM_POSES, t);
      if (!this._shake && t >= FILM.shake && t - dt < FILM.shake) this._shake = { t: t - FILM.shake };
      while (this._dripsDone < FILM.drips.length && FILM.drips[this._dripsDone] <= t) {
        this._drip(0.0075);
        this._dripsDone++;
      }
      this.filmTime += dt;
      if (this.filmTime >= FILM.duration) {
        this.filmTime = null;
        this._nextAct = rng.range(2.5, 4);
        // carry on from the film's last frame: lift out of the reach
        const now = copyPose(createPose(), this._pose);
        this._track = { keys: [[0, now], [1.6, now], [2.7, SHAPES.G], [4.2, this._restPose(createPose())]], t: 0, end: 4.2, name: 'reach', slow: [0, 2] };
      }
      wantHeading = this.heading;
      wantSpeed = this.speed;
    } else {
      // ---- on its own
      if (this._goal) {
        const dx = this._goal.x - this.position.x;
        const dz = this._goal.z - this.position.z;
        // stop with the bill, not the breast, over the place
        const left = Math.hypot(dx, dz) - 0.42;
        wantHeading = Math.atan2(dx, dz);
        wantSpeed = clamp(0.12 + left * 0.35, 0.05, 0.5);
        turnRate = 1.6;
        if (left < 0.06 && Math.abs(angleDiff(this.heading, wantHeading)) < 0.25) {
          this._goal = null;
          if (!this.busy) this._start('reach');
          else this._queued = 'reach';
        }
      } else {
        // a slow winding glide that stays in the sun
        wantSpeed = 0.075 + 0.04 * Math.sin(this._wander * 0.17);
        wantHeading = this.heading + 0.5 * Math.sin(this._wander * 0.21) + 0.3 * Math.sin(this._wander * 0.083 + 1.7);
        const hx = (this.position.x - HOME.x) / HOME.rx;
        const hz = (this.position.z - HOME.z) / HOME.rz;
        const out = hx * hx + hz * hz;
        if (out > 0.55) {
          const home = Math.atan2(HOME.x - this.position.x, HOME.z - this.position.z);
          wantHeading = this.heading + angleDiff(this.heading, home) * clamp((out - 0.55) * 2.5, 0, 1) + (wantHeading - this.heading) * 0.3;
        }
        turnRate = 0.45;
      }

      // the neck
      if (this._track) {
        const tr = this._track;
        tr.t += dt;
        samplePose(this._pose, tr.keys, tr.t);
        if (tr.shakeAt !== undefined && !this._shake && tr.t >= tr.shakeAt && tr.t - dt < tr.shakeAt) this._shake = { t: 0 };
        // while the bill is down the swan all but stops: the body drifts up to it
        if (tr.slow && tr.t > tr.slow[0] && tr.t < tr.slow[1]) wantSpeed = Math.min(wantSpeed, 0.06);
        if (tr.name === 'dunk' && tr.t < 2) wantSpeed = Math.min(wantSpeed, 0.11);
        if (tr.t >= tr.end) this._track = null;
      } else {
        // settle toward the resting shape
        blendPose(this._pose, this._pose, this._restPose(this._rest), 1 - Math.exp(-dt * 1.4));
        if (this._queued) {
          const name = this._queued;
          this._queued = null;
          this._start(name);
        } else if (!this._goal) {
          this._nextAct -= dt;
          if (this._nextAct <= 0) {
            this._nextAct = rng.range(5, 11);
            const r = rng.float();
            // a wet bill gets shaken more often than not
            if (this._wet > 0.25 && r < 0.6) this._start('shake');
            else if (r < 0.4) this._start('dunk');
            else if (r < 0.62) this._start('reach');
            else this._start('look');
          }
        }
      }

      this.heading += angleDiff(this.heading, wantHeading) * Math.min(1, dt * turnRate);
      this.speed = damp(this.speed, wantSpeed, glide, dt);
    }

    // looking round: the head turns on the end of the neck
    if (this._lookFor > 0) {
      this._lookFor -= dt;
      if (this._lookFor <= 0) this._lookWant = 0;
    }
    this._look = damp(this._look, this._lookWant, 3.5, dt);

    // the shake rides on whatever the neck is doing
    let turn = 0;
    if (this._shake) {
      const s = this._shake;
      s.t += dt;
      const u = s.t / SHAKE.seconds;
      // quick to start, dying away over the last third
      const envelope = Math.min(1, s.t / 0.06) * (1 - clamp((u - 0.7) / 0.3, 0, 1) ** 2);
      const phase = s.t * SHAKE.rate * Math.PI * 2;
      turn = SHAKE.swing * envelope * Math.sin(phase);
      // Water leaves the bill fastest when the head is moving fastest, and
      // most of it in the middle of the shake, when the first turns have
      // gathered it at the tip.
      const swingSpeed = Math.abs(Math.cos(phase)) * envelope;
      const wetness = Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 1.5;
      this._fling(SHAKE.beads * 4.2 * swingSpeed * swingSpeed * wetness * dt, Math.sign(Math.cos(phase)));
      if (s.t >= SHAKE.seconds) {
        this._shake = null;
        this._wet *= 0.12;
      }
    }

    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.position.addScaledVector(_forward, this.speed * dt);
    this._write(turn);

    // ---- the bill and the water
    this._tipVelocity.copy(swan.billTip).sub(this._tip).divideScalar(dt);
    this._tip.copy(swan.billTip);
    const under = swan.billTip.y < 0;
    if (under !== this._billIn) {
      this._billIn = under;
      ctx.events.emit(under ? 'billEnter' : 'billExit', { x: swan.billTip.x, z: swan.billTip.z });
      ctx.ripple.disturb(swan.billTip.x, swan.billTip.z, 0.06, under ? 0.0035 : 0.0022);
      if (!under) {
        // it comes out streaming: a string of beads at once, then drips for a couple of seconds
        this._wet = Math.max(this._wet, clamp(0.5 + this._under, 0.6, 1));
        const beads = 3 + Math.floor(rng.float() * 4);
        for (let i = 0; i < beads; i++) this._drip(rng.range(0.004, 0.0065), i * 0.02);
        this._nextDrip = 0.12;
      }
      this._under = 0;
    }
    if (under) {
      this._under += dt;
      // the head working under water keeps the surface there alive
      this._sinceStir += dt;
      if (this._sinceStir > 0.11) {
        this._sinceStir = 0;
        ctx.ripple.disturb(swan.billTip.x + rng.gauss() * 0.02, swan.billTip.z + rng.gauss() * 0.02, 0.05, rng.range(0.001, 0.0025));
      }
    } else if (this._wet > 0.06 && !this._shake) {
      // drops gather at the tip and fall, further apart as it dries
      this._wet *= Math.exp(-dt / 1.1);
      this._nextDrip -= dt;
      if (this._nextDrip <= 0 && this.filmTime === null) {
        this._drip(rng.range(0.005, 0.0075));
        this._nextDrip = rng.range(0.14, 0.26) / Math.max(this._wet, 0.25);
      }
    }

    // The breast pushes water aside as it moves: a small dent every few
    // centimetres travelled, which the ripple field turns into the bow line.
    // (The churned water behind the tail is laid down by pond/surface.js,
    // from the body's movement alone.)
    this._sinceWake += this.speed * dt;
    if (this._sinceWake > 0.045) {
      this._sinceWake = 0;
      const reach = swan.footprint.length * 0.42;
      ctx.ripple.disturb(this.position.x + _forward.x * reach, this.position.z + _forward.z * reach, 0.1, 0.0005 + this.speed * 0.004);
    }
    // and it never sits perfectly still: a slow breath of a ripple under the body
    if (Math.floor(time * 0.7) !== Math.floor((time - dt) * 0.7)) {
      ctx.ripple.disturb(this.position.x, this.position.z, 0.3, 0.0006);
    }
  }

  /** One drop let go of the bill tip. */
  _drip(size, lift = 0) {
    if (!this.droplets) return;
    _point.copy(this.swan.billTip);
    _point.y = Math.max(_point.y, 0.01) + lift;
    // it leaves with the bill's own movement and nothing more
    _velocity.copy(this._tipVelocity).multiplyScalar(0.5);
    _velocity.y = Math.min(_velocity.y, 0.1);
    this.droplets.spawn({ position: _point, velocity: _velocity, spread: 0.03, count: 1, size });
  }

  /**
   * Beads thrown off the bill tip by the shake. They leave along the way the
   * tip is moving (sideways, swinging round the neck), most of them slowly
   * and a few fast, level or a little downward, some popping up.
   * @param {number} expected how many this step, on average
   * @param {number} side +1 when the bill is swinging to the bird's left, -1 to its right
   */
  _fling(expected, side) {
    if (!this.droplets || expected <= 0) return;
    const rng = this.rng;
    let count = Math.floor(expected);
    if (rng.float() < expected - count) count++;
    _left.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    for (let i = 0; i < count; i++) {
      // 0.66 to 3.4 m/s, mostly near the bottom of that
      const speed = 0.66 + 2.75 * rng.float() ** 2.6;
      const fan = rng.gauss() * 0.5; // how far off sideways, toward ahead or astern
      _velocity
        .copy(_left)
        .multiplyScalar(side * speed * Math.cos(fan))
        .addScaledVector(_forward, speed * Math.sin(fan) * 0.6);
      _velocity.y = rng.range(-0.3, 0.55) + (rng.float() < 0.12 ? rng.range(0.3, 0.9) : 0);
      this.droplets.spawn({ position: this.swan.billTip, velocity: _velocity, spread: 0.06, count: 1, size: rng.range(0.003, 0.0052) });
    }
  }

  _write(turn = 0) {
    const { swan } = this;
    const g = swan.group;
    g.position.copy(this.position);
    g.rotation.y = this.heading;
    copyPose(swan.pose, this._pose);
    if (turn !== 0) {
      // the whole arch swings round from below the bend, as it does in the film
      swan.pose.turn += turn;
      swan.pose.turnAt = 0.55;
    }
    swan.pose.look += this._look;
    Object.assign(swan.pose, this._stage.over);
    swan.update(0, 0);
  }
}
