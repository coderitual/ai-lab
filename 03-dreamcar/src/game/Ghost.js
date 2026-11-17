// The ghost of the best lap: a recording of where the car was, played back
// against the lap being driven (solo only).
//
// Recorded in the fixed step at 10 Hz on the lap's own clock (position and
// orientation, rounded to a centimetre and to 1e-4), so that the same lap
// always makes the same recording. Played back per drawn frame by
// interpolating between the two samples either side of the lap clock. As
// with the gaps, the first lap races the best lap from the grid and the
// others the best flying lap, so two recordings are kept per time of day, in
// localStorage under `dreamcar.ghost.v1`. A recording made on a road of
// another length is dropped, and storage that fails is ignored.

import * as THREE from 'three';

const STORE_KEY = 'dreamcar.ghost.v1';
/** Samples a second. */
export const GHOST_RATE = 10;
/** Numbers a sample: x, y, z, qx, qy, qz, qw. */
const STRIDE = 7;
/** A lap longer than this is not worth keeping (s). */
const MAX_SECONDS = 600;

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

const round = (v, k) => Math.round(v * k) / k;

function load(length) {
  // per time of day (whichever lighting.js has), made when first asked for
  const kept = { length: Math.round(length) };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || raw.length !== kept.length) return kept;
    for (const time of Object.keys(raw)) {
      if (time === 'length' || !/^[a-z]{1,16}$/.test(time) || !raw[time] || typeof raw[time] !== 'object') continue;
      for (const kind of ['standing', 'flying']) {
        const g = raw[time][kind];
        const ok =
          g &&
          Number.isInteger(g.ms) &&
          g.ms > 0 &&
          Array.isArray(g.frames) &&
          g.frames.length >= 2 * STRIDE &&
          g.frames.length % STRIDE === 0 &&
          g.frames.length <= MAX_SECONDS * GHOST_RATE * STRIDE &&
          g.frames.every(Number.isFinite);
        if (ok) slot(kept, time)[kind] = { ms: g.ms, frames: g.frames };
      }
    }
  } catch {
    // no storage, or something else's data under our key
  }
  return kept;
}

/** The recordings of `time`, made empty when there are none yet. */
const slot = (kept, time) => (kept[time] ||= { standing: null, flying: null });

export class Ghost {
  /** @param {number} trackLength the road the recordings belong to */
  constructor(trackLength) {
    this.kept = load(trackLength);
    /** @type {number[]} the lap being recorded */
    this.recording = [];
    this._next = 0;
  }

  /** Start recording a new lap (its clock is at zero). */
  begin() {
    this.recording = [];
    this._next = 0;
  }

  /**
   * Fixed step: record the car if the lap clock has reached the next sample.
   * @param {number} lapMs the lap clock
   * @param {{ position: THREE.Vector3, quaternion: THREE.Quaternion }} vehicle
   */
  record(lapMs, vehicle) {
    if (lapMs < 0) return;
    while (this._next * (1000 / GHOST_RATE) <= lapMs && this.recording.length < MAX_SECONDS * GHOST_RATE * STRIDE) {
      const p = vehicle.position;
      const q = vehicle.quaternion;
      this.recording.push(
        round(p.x, 100),
        round(p.y, 100),
        round(p.z, 100),
        round(q.x, 1e4),
        round(q.y, 1e4),
        round(q.z, 1e4),
        round(q.w, 1e4),
      );
      this._next++;
    }
  }

  /** The lap just recorded is the best of its kind ('standing' | 'flying') on this device for `time`: keep it. */
  keep(time, kind, ms) {
    slot(this.kept, time)[kind] = { ms, frames: this.recording.slice() };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.kept));
    } catch {
      // full, private, or switched off: the ghost lives for this page only
    }
  }

  /** Whether there is a ghost to race for `time` (and `kind`, if given). */
  has(time, kind) {
    const t = slot(this.kept, time);
    return kind ? !!t[kind] : !!(t.standing || t.flying);
  }

  /**
   * Pose `object` where the ghost of `time` and `kind` was `seconds` into its lap. Returns false when the ghost's lap
   * is over (or there is none).
   */
  pose(time, kind, seconds, object) {
    const g = slot(this.kept, time)[kind];
    if (!g || seconds < 0) return false;
    const f = g.frames;
    const n = f.length / STRIDE;
    const u = seconds * GHOST_RATE;
    const i = Math.floor(u);
    if (i >= n - 1) return false;
    const t = u - i;
    const a = i * STRIDE;
    const b = a + STRIDE;
    object.position.set(
      f[a] + (f[b] - f[a]) * t,
      f[a + 1] + (f[b + 1] - f[a + 1]) * t,
      f[a + 2] + (f[b + 2] - f[a + 2]) * t,
    );
    qa.set(f[a + 3], f[a + 4], f[a + 5], f[a + 6]).normalize();
    qb.set(f[b + 3], f[b + 4], f[b + 5], f[b + 6]).normalize();
    object.quaternion.slerpQuaternions(qa, qb, t);
    return true;
  }
}
