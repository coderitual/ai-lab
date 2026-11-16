// What the swan does.
//
// Two things live here. The first is the film: an eleven-second performance
// (drip, shake, turn through the light, dunk, lift, reach) written down as
// tracks of headings, speeds and neck shapes with the times measured from the
// reference, which the swan plays when the demo opens and whenever it is asked
// to. The second is a swan left to itself: it glides about the sunlit part of
// the pond, and now and then dunks its bill, reaches, looks round or shakes;
// it comes when the water is touched and feeds there. And it can be taken in
// hand: while steer() is being called it swims where it is pointed, and when
// the calls stop it glides to rest and goes back to its own life.
//
// Either way this file only decides where the bird is, which way it faces and
// what shape its neck is in. The shapes themselves are assets/swan/poses.js;
// the drops are assets/fx/Droplets.js; the rings are the ripple field.

import * as THREE from 'three';
import { POSES, createPose, copyPose, blendPose, mixPoses } from '../assets/swan/Swan.js';
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

/**
 * Swimming where it is steered (steer()). Metres, seconds, radians.
 */
export const STEER = {
  /** Metres a second at full strength: a mute swan's unhurried cruise, two and a half times the film's fastest (0.22 m/s). */
  speed: 0.55,
  /** How quickly it gathers way, 1/s: nine tenths of its speed in about two seconds. */
  gather: 1.1,
  /** How quickly it loses way once let go, 1/s, for `coastFor` seconds: a heavy bird runs on. */
  coast: 0.7,
  coastFor: 4,
  /** Let go away from its own patch of water, it keeps its course while it runs on, and only over this many seconds more does the pull back there return. */
  homeAfter: 8,
  /** The fastest it turns, radians a second: paddling round at rest, and at full speed (a circle 0.6 m in radius, one body length). */
  turnSlow: 1.5,
  turnFast: 0.9,
  /** Rate of turn asked for per radian still to turn, 1/s, and how quickly the turn itself builds and dies, 1/s. */
  turnGain: 2.4,
  turnEase: 5,
  /** Share of its speed it keeps while pointing 90 degrees or more off the way it was told to go: it turns first, then goes. */
  askew: 0.3,
  /** It stays this many metres inside the shore's outline (the same margin a call to the water keeps)... */
  margin: 1.5,
  /** ...and from this many metres short of that line a push toward the bank is bent along it. */
  shy: 0.8,
  /** A dunk or a reach asked for on the move waits until it has been let go and has slowed to this, m/s (or `coastFor` seconds have passed). */
  settle: 0.22,
};

/** The dents the breast leaves in the water: one every `every` metres travelled, deepening with speed up to `full` m/s (see where they are made, in update()). */
const BOW = { every: 0.045, full: 0.32 };

/**
 * The carriage of a swan that is going somewhere, as weights of four of the
 * film's shapes (A, C, B, G) at a paddle and at full speed: the proud S
 * drawn up taller, the bill lifted and the wings let down a little as it
 * presses on.
 */
const SWIM_SHAPES = [POSES.A, POSES.C, POSES.B, POSES.G];
const SWIM_SLOW = [0.62, 0.38, 0, 0];
const SWIM_FAST = [0.2, 0.1, 0.5, 0.2];
const _weights = [0, 0, 0, 0];

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
    this._steer = { x: 0, z: 0, strength: 0 }; // where it is told to go while steered: a unit direction on the water
    this._steering = false; // being steered
    this._steerHeld = false; // steer() has been called since the last step
    this._steerFor = 0; // seconds it has been steered
    this._turnSpeed = 0; // radians a second
    this._sinceSteer = 1e9; // seconds since it was let go
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

  /** 'film' | 'steer' | 'idle' | 'swim' | 'shake' | 'dunk' | 'reach' | 'look' */
  get state() {
    if (this._steering) return 'steer';
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
    this._steering = this._steerHeld = false;
    this._turnSpeed = 0;
    this._sinceSteer = 1e9;
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

  /**
   * Swim this way. Call it every step for as long as a control is held: the
   * swan is steered from the first call until a step passes without one.
   *
   * Taking it in hand ends the film where it is (the swan carries on from
   * there), drops a call to the water, and breaks off whatever the neck was
   * doing, except a shake, which it finishes on the move.
   * @param {number} dirX the way to go, on the water in world space (any length)
   * @param {number} dirZ
   * @param {number} [strength] 0..1: how hard the control is pushed; its speed is in proportion
   */
  steer(dirX, dirZ, strength = 1) {
    if (this._stage.still) return;
    const length = Math.hypot(dirX, dirZ);
    if (!(length > 1e-6) || !(strength > 0)) return;
    this._steer.x = dirX / length;
    this._steer.z = dirZ / length;
    this._steer.strength = Math.min(1, strength);
    this._steerHeld = true;
    if (this._steering) return;
    this._steering = true;
    this._steerFor = 0;
    this.endFilm();
    this._goal = null;
    this._queued = null;
    this._lookFor = 0;
    if (this._track && this._track.name !== 'shake') this._track = null;
  }

  /** Let go: it runs on, slows, and is on its own again. */
  _release() {
    this._steering = false;
    this._sinceSteer = 0;
    this._lookWant = 0;
    // it has been made to work: it does something of its own soon after
    this._nextAct = this.rng.range(3, 6);
  }

  /** Swim to a point on the water and feed there. */
  callTo(x, z) {
    if (this._stage.still || this._steering) return;
    if (this.ctx.pond.shoreDistance(x, z) > -STEER.margin) return; // not onto the bank
    this.endFilm();
    this._goal = { x, z };
    // whatever it was doing with its head, it stops
    if (this._track && !this._billIn) this._track = null;
  }

  /**
   * Do one of the things the swan does in the film. If it is busy the request
   * waits its turn (only the latest one is kept). While it is steered it will
   * shake or look round as it swims, but a dunk or a reach waits until it has
   * been let go and has slowed: it does not put its bill down at speed.
   * @param {'shake'|'dunk'|'dip'|'reach'|'look'|'lift'} name
   */
  act(name) {
    if (this._stage.still) return;
    if (name === 'dip') name = 'dunk';
    if (name === 'lift') name = 'look';
    if (!['shake', 'dunk', 'reach', 'look'].includes(name)) return;
    this.endFilm();
    if (this.busy || (this._steering && (name === 'dunk' || name === 'reach'))) {
      this._queued = name;
      return;
    }
    this._start(name);
  }

  _start(name) {
    const rng = this.rng;
    const now = copyPose(createPose(), this._pose);
    const rest = this._steering ? this._swimPose(createPose()) : this._restPose(createPose());
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

  /** The shape the neck is carried in while it is steered: between SWIM_SLOW and SWIM_FAST by how fast it is going. */
  _swimPose(out) {
    const u = clamp(this.speed / STEER.speed, 0, 1);
    const fast = u * u * (3 - 2 * u);
    for (let i = 0; i < _weights.length; i++) _weights[i] = SWIM_SLOW[i] + (SWIM_FAST[i] - SWIM_SLOW[i]) * fast;
    return mixPoses(out, SWIM_SHAPES, _weights);
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
    // steered for as long as steer() keeps being called: one step without it lets go
    if (this._steering && !this._steerHeld) this._release();
    this._steerHeld = false;

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
      // ---- on its own, or steered
      if (this._steering) {
        const st = this._steer;
        this._steerFor += dt;
        let dx = st.x;
        let dz = st.z;
        // Near the bank, the part of the push that points at it is taken
        // away, so the swan turns and swims along the shore instead of
        // paddling against a wall; held straight at the bank it stops.
        const px = this.position.x;
        const pz = this.position.z;
        const r = Math.hypot(px, pz);
        const room = -STEER.margin - ctx.pond.shoreDistance(px, pz); // metres of water left
        if (room < STEER.shy && r > 1e-3) {
          const toBank = (dx * px + dz * pz) / r;
          if (toBank > 0) {
            const k = (1 - clamp(room / STEER.shy, 0, 1)) * toBank;
            dx -= (px / r) * k;
            dz -= (pz / r) * k;
          }
        }
        const push = Math.hypot(dx, dz); // what is left of it: 1 in open water
        if (push > 0.05) wantHeading = Math.atan2(dx, dz);
        const off = angleDiff(this.heading, wantHeading);
        // A head that is down comes up before anything else: until the bill
        // is well clear of the water the swan does not set off and barely turns.
        const up = clamp((swan.billTip.y + 0.02) / 0.2, 0, 1);
        // It turns first and then goes: little way on while it points the wrong way.
        const facing = STEER.askew + (1 - STEER.askew) * clamp(Math.cos(off), 0, 1);
        wantSpeed = STEER.speed * st.strength * push * facing * up;
        glide = STEER.gather;
        // The turn: quicker the further there is to go, up to what a swan
        // manages (less at speed), building and dying smoothly.
        const way = clamp(this.speed / STEER.speed, 0, 1);
        const most = (STEER.turnSlow + (STEER.turnFast - STEER.turnSlow) * way) * (0.5 + 0.5 * st.strength) * (0.3 + 0.7 * up);
        this._turnSpeed = damp(this._turnSpeed, clamp(off * STEER.turnGain, -most, most), STEER.turnEase, dt);
        turnRate = 0; // the heading is turned below, by _turnSpeed alone
        // the head leads into a turn, unless it is looking round at something
        if (this._lookFor <= 0) this._lookWant = clamp(off * 0.6, -0.55, 0.55);
      } else if (this._goal) {
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
          // (just let go somewhere else, it does not turn for home at once)
          const homesick = clamp((this._sinceSteer - STEER.coastFor) / STEER.homeAfter, 0, 1);
          wantHeading = this.heading + angleDiff(this.heading, home) * clamp((out - 0.55) * 2.5, 0, 1) * homesick + (wantHeading - this.heading) * 0.3;
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
      } else if (this._steering) {
        // The swimming carriage. From wherever the neck was (the film may
        // have been cut off with the bill under water) it goes there
        // smoothly, and in a hurry while the bill is still near the surface.
        const low = 1 - clamp(swan.billTip.y / 0.2, 0, 1);
        const rate = (2.4 + 5 * low) * clamp(this._steerFor / 0.15, 0.2, 1);
        blendPose(this._pose, this._pose, this._swimPose(this._rest), 1 - Math.exp(-dt * rate));
        if (this._queued === 'shake' || this._queued === 'look') {
          const name = this._queued;
          this._queued = null;
          this._start(name);
        }
      } else {
        // settle toward the resting shape
        blendPose(this._pose, this._pose, this._restPose(this._rest), 1 - Math.exp(-dt * 1.4));
        if (this._queued && (this._sinceSteer > STEER.coastFor || this.speed < STEER.settle)) {
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

      if (!this._steering) {
        // let go in the middle of a turn, it does not stop turning dead
        this._turnSpeed = damp(this._turnSpeed, 0, 2.5, dt);
        this._sinceSteer += dt;
        if (this._sinceSteer < STEER.coastFor && wantSpeed < this.speed) glide = STEER.coast;
      }
      this.heading += angleDiff(this.heading, wantHeading) * Math.min(1, dt * turnRate) + this._turnSpeed * dt;
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
    if (this.filmTime === null) {
      // It cannot leave the water: a point past the line it keeps from the
      // shore is put back on it, toward the pond's centre (shoreDistance is
      // measured along that line), so what is left of its movement slides
      // it along the bank.
      const over = ctx.pond.shoreDistance(this.position.x, this.position.z) + STEER.margin;
      if (over > 0) {
        const r = Math.hypot(this.position.x, this.position.z);
        this.position.multiplyScalar(Math.max(0, r - over) / r);
      }
    }
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
    // from the body's movement alone.) Up to BOW.full, half as fast again
    // as the film's fastest, the dents deepen with speed; beyond it they
    // stay as they are and come no more often, or a swan steered at full
    // speed would light up a sheet of glints either side of itself.
    this._sinceWake += this.speed * dt;
    if (this._sinceWake > BOW.every * Math.max(1, this.speed / BOW.full)) {
      this._sinceWake = 0;
      const reach = swan.footprint.length * 0.42;
      ctx.ripple.disturb(this.position.x + _forward.x * reach, this.position.z + _forward.z * reach, 0.1, 0.0005 + Math.min(this.speed, BOW.full) * 0.004);
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
