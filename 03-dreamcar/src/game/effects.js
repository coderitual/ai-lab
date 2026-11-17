// The effects of driving: skid marks, tyre smoke, dust and stones off the verge, spray off a wet road, sparks.
//
// The game makes one Effects and calls update(dt, cars) once per fixed step, after the vehicles and the race
// have stepped. Each entry of `cars` is { vehicle, impacts }: the Vehicle (its wheels' skid, slip, surface,
// load and contact points, its scrape) and the impacts drained from it in this step. The same impact list goes
// to the sound and the camera: nothing here changes it.
//
// Everything is decided here, in the fixed step, on the simulated clock and with seeded random numbers, so a
// fast-forwarded run (tests, stills) shows the same marks and the same puffs as one that was watched. What it
// looks like is in assets/fx/ (SkidMarks, Particles); render() only sends what changed and sets the clock and
// the light. The numbers are FX in config.js, one row per tier; ?fx=0 makes none of it.

import { Particles, KINDS } from '../assets/fx/particles.js';
import { SkidMarks } from '../assets/fx/skidMarks.js';
import { FX } from './config.js';
import { SURFACE } from './track.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Effects {
  /**
   * @param {object} options
   * @param {import('three').Scene} options.scene
   * @param {import('./track.js').Track} options.track
   * @param {import('../engine/caps.js').Tier} options.tier
   * @param {import('../engine/rng.js').Rng} options.rng
   * @param {{ wetness: number }} [options.world] how wet the road is now
   * @param {number} [options.cars] the most cars there will be
   * @param {boolean} [options.enabled] false: nothing at all (?fx=0)
   */
  constructor({ scene, track, tier, rng, world = null, cars = 2, enabled = true }) {
    this.scene = scene;
    this.track = track;
    this.tier = tier;
    this.rng = rng;
    this.world = world;
    this.enabled = enabled;
    this.time = 0;
    /** Everything drawn (the reflection probe leaves it out). */
    this.objects = [];
    if (!enabled) return;
    const t = FX.tiers[tier] || FX.tiers.medium;
    this.t = t;
    this.cars = cars;
    this.marks = new SkidMarks({ wheels: cars * 4, perWheel: t.marks, width: FX.markWidth });
    this.particles = new Particles({ soft: t.soft, sparks: t.sparks });
    this.objects.push(this.marks.mesh, ...this.particles.objects);
    for (const o of this.objects) scene.add(o);
    const n = cars * 4;
    /** Per wheel: how strongly it is marking now (eased), where the mark was last laid, emission owed. */
    this._level = new Float32Array(n);
    this._lastX = new Float64Array(n);
    this._lastZ = new Float64Array(n);
    this._owed = new Float32Array(n * 4); // smoke, dust, stones, spray
    this._sparkOwed = new Float32Array(cars);
    this._light = null;
  }

  /**
   * Fixed step.
   * @param {number} dt
   * @param {Array<{ vehicle: import('./vehicle/Vehicle.js').Vehicle, impacts: object[] }>} cars
   */
  update(dt, cars) {
    if (!this.enabled || dt <= 0) return;
    this.time += dt;
    const wet = this.world ? this.world.wetness : 0;
    const wetRoad = wet > FX.wetFrom;
    for (let c = 0; c < cars.length && c < this.cars; c++) {
      const { vehicle: v, impacts } = cars[c];
      this._wheels(c, v, dt, wet, wetRoad);
      this._sparks(c, v, impacts, dt);
    }
  }

  _wheels(c, v, dt, wet, wetRoad) {
    const rng = this.rng;
    const t = this.t;
    const speed = Math.abs(v.speed);
    const vel = v.velocity;
    for (let j = 0; j < 4; j++) {
      const w = v.wheels[j];
      const i = c * 4 + j;
      const down = w.grounded && w.load > 0;
      const p = w.contact;
      const sample = w._sample;
      // the road, its paved margin and the kerbs: rubber marks and smoke; grass and gravel: dust and stones
      const paved = w.surface === SURFACE.ASPHALT || w.surface === SURFACE.SHOULDER || w.surface === SURFACE.KERB;

      // ---- the mark: from the slide, eased in and out, on paved ground only
      const want = down && paved ? clamp01((w.skid - FX.markFrom) / FX.markFull) : 0;
      this._level[i] += (want - this._level[i]) * Math.min(1, dt * FX.markEase);
      const level = this._level[i];
      if (level > 0.03 && down) {
        const dx = p.x - this._lastX[i];
        const dz = p.z - this._lastZ[i];
        const d2 = dx * dx + dz * dz;
        if (d2 > FX.markStep * FX.markStep || d2 > 25) {
          if (d2 > 25) this.marks.lift(i); // the car was put somewhere else
          const alpha = level * FX.markDark * (wetRoad ? FX.markWet : 1);
          this.marks.add(i, p.x, p.y, p.z, sample.nx, sample.ny, sample.nz, dx, dz, alpha);
          this._lastX[i] = p.x;
          this._lastZ[i] = p.z;
        }
      } else {
        if (level <= 0.03) this.marks.lift(i);
        this._lastX[i] = p.x;
        this._lastZ[i] = p.z;
      }
      if (!down) continue;

      // ---- what comes off the tyre
      const o = i * 4;
      const ground = p.y;
      if (paved && !wetRoad) {
        // smoke: only a tyre really sliding on dry asphalt (a locked wheel, a slide past the limit, a burnout),
        // judged by how fast the rubber scrubs over the road, not by the skid alone: a wheel that spins a little
        // off the line, or one an assist is holding at its limit, makes next to none
        const ref = Math.max(Math.abs(w._vlong ?? speed), 1);
        const across = Math.tan(Math.max(-1.4, Math.min(1.4, w.slipAngle))) * ref;
        const scrub = Math.hypot(w._slip ?? w.slipRatio * ref, across);
        const held = 1 - FX.smokeHeld * Math.max(v.assists.tc, v.assists.abs, v.assists.esc);
        const s = clamp01((w.skid - FX.smokeFrom) / (1 - FX.smokeFrom)) * clamp01((scrub - FX.smokeScrub) / FX.smokeScrubFull) * held;
        this._owed[o] += s * FX.smokeRate * t.rate * dt;
        while (this._owed[o] >= 1) {
          this._owed[o] -= 1;
          const big = 0.5 + 0.5 * s;
          this.particles.emit(
            KINDS.smoke,
            p.x + rng.range(-0.1, 0.1), ground + 0.12, p.z + rng.range(-0.1, 0.1),
            vel.x * 0.3 + rng.range(-0.5, 0.5), rng.range(0.05, 0.35), vel.z * 0.3 + rng.range(-0.5, 0.5),
            this.time, rng.range(1.0, 1.8), rng.range(0.12, 0.2), rng.range(0.45, 0.8) * big, rng.next(), ground,
          );
        }
      } else if (!paved && speed > 2) {
        // dust off the verge, more when the tyre slides; stones off gravel
        const k = (speed / 20) * (1 + 2 * w.skid) * (w.surface === SURFACE.GRASS ? 0.4 : 1);
        this._owed[o + 1] += FX.dustRate * t.rate * Math.min(k, 2.5) * dt;
        while (this._owed[o + 1] >= 1) {
          this._owed[o + 1] -= 1;
          this.particles.emit(
            KINDS.dust,
            p.x, ground + 0.15, p.z,
            vel.x * 0.35 + rng.range(-1.2, 1.2), rng.range(0.4, 1.4), vel.z * 0.35 + rng.range(-1.2, 1.2),
            this.time, rng.range(1.4, 2.4), rng.range(0.2, 0.35), rng.range(0.9, 1.5), rng.next(), ground,
          );
        }
        if (w.surface !== SURFACE.GRASS) {
          this._owed[o + 2] += FX.stoneRate * t.rate * Math.min(k, 2) * dt;
          while (this._owed[o + 2] >= 1) {
            this._owed[o + 2] -= 1;
            this.particles.emit(
              KINDS.stone,
              p.x, ground + 0.05, p.z,
              vel.x * 0.6 + rng.range(-1.5, 1.5), rng.range(1, 3.5), vel.z * 0.6 + rng.range(-1.5, 1.5),
              this.time, rng.range(0.5, 0.9), 0.025, 0.02, rng.next(), ground,
            );
          }
        }
      }
      if (wetRoad && paved && speed > FX.sprayFrom) {
        // spray: a low, fine mist behind the tyre (never a wall), growing with speed; the rear wheels throw most
        const rear = j >= 2 ? 1 : 0.45;
        const k = clamp01((speed - FX.sprayFrom) / 25) * clamp01((wet - FX.wetFrom) / 0.4) * rear;
        this._owed[o + 3] += FX.sprayRate * t.rate * k * dt;
        while (this._owed[o + 3] >= 1) {
          this._owed[o + 3] -= 1;
          this.particles.emit(
            KINDS.spray,
            p.x + rng.range(-0.1, 0.1), ground + 0.08, p.z + rng.range(-0.1, 0.1),
            vel.x * 0.62 + rng.range(-0.6, 0.6), rng.range(0.15, 0.6), vel.z * 0.62 + rng.range(-0.6, 0.6),
            this.time, rng.range(0.5, 0.9), rng.range(0.12, 0.2), rng.range(0.4, 0.75) * (0.6 + 0.4 * k), rng.next(), ground,
          );
        }
      }
    }
  }

  _sparks(c, v, impacts, dt) {
    const rng = this.rng;
    const t = this.t;
    const vel = v.velocity;
    // a hit: a burst where it happened, thrown off along the edge and away from it
    for (const hit of impacts) {
      if (hit.kind !== 'edge' || !(hit.strength > 0)) continue;
      const n = Math.min(FX.burstMax, Math.round(hit.strength * FX.burstPer * t.rate));
      for (let k = 0; k < n; k++) {
        this.particles.emit(
          KINDS.spark,
          hit.x, hit.y - 0.15 + rng.range(-0.1, 0.2), hit.z,
          vel.x * 0.7 + hit.nx * rng.range(0.5, 3) + rng.range(-2, 2), rng.range(0.5, 3.5), vel.z * 0.7 + hit.nz * rng.range(0.5, 3) + rng.range(-2, 2),
          this.time, rng.range(0.25, 0.6), 0.02, 0.012, rng.next(), hit.y - 0.6,
        );
      }
    }
    // a scrape: a stream from the side of the car against the edge
    if (v.scrape > FX.scrapeFrom && Math.abs(v.speed) > 3) {
      this._sparkOwed[c] += v.scrape * FX.scrapeRate * t.rate * dt;
      if (this._sparkOwed[c] < 1) return;
      const s = v._centre;
      const track = this.track;
      const idx = v.trackIndex ?? s.index;
      const left = s.edgeL - s.lat < s.edgeR + s.lat;
      const lx = track.lx ? track.lx[idx] : 0;
      const lz = track.lz ? track.lz[idx] : 0;
      const side = left ? 1 : -1;
      const half = 0.95;
      // along the body, front to back, wherever it is rubbing
      const fx = v._fx ?? 0;
      const fz = v._fz ?? 0;
      while (this._sparkOwed[c] >= 1) {
        this._sparkOwed[c] -= 1;
        const along = rng.range(-2, 2);
        const x = v.position.x + lx * side * half + fx * along;
        const z = v.position.z + lz * side * half + fz * along;
        this.particles.emit(
          KINDS.spark,
          x, v.position.y - 0.05 + rng.range(-0.1, 0.15), z,
          vel.x * 0.75 - lx * side * rng.range(0, 1.5) + rng.range(-1, 1), rng.range(0.3, 2.5), vel.z * 0.75 - lz * side * rng.range(0, 1.5) + rng.range(-1, 1),
          this.time, rng.range(0.2, 0.45), 0.018, 0.01, rng.next(), v.position.y - 0.5,
        );
      }
    }
  }

  /**
   * Once per drawn frame: send what the steps changed, set the clock (interpolated within the step) and the light.
   * @param {number} alpha 0..1 how far the picture is between the last two steps
   * @param {number} stepDt the fixed step
   * @param {import('../assets/world/lighting.js').TimeOfDay} time
   * @param {Array<{ head: number, headPos: import('three').Vector3, headDir: import('three').Vector3, tail: number, tailPos: import('three').Vector3 }>} lamps
   */
  render(alpha, stepDt, time, lamps) {
    if (!this.enabled) return;
    this.marks.upload();
    const P = this.particles;
    P.upload();
    P.time = this.time - (1 - alpha) * stepDt;
    if (time !== this._light) {
      this._light = time;
      P.setLight(time);
    }
    const u = P.uniforms;
    for (let i = 0; i < 2; i++) {
      const l = lamps[i];
      u.uHead.value[i] = l ? l.head : 0;
      u.uTail.value[i] = l ? l.tail : 0;
      if (l) {
        u.uHeadPos.value[i].copy(l.headPos);
        u.uHeadDir.value[i].copy(l.headDir);
        u.uTailPos.value[i].copy(l.tailPos);
      }
    }
  }

  /** The light changed by hand (lighting.js numbers): read it again. */
  refresh() {
    this._light = null;
  }

  /** A new run: forget every mark and every particle. */
  reset() {
    if (!this.enabled) return;
    this.marks.clear();
    this.particles.clear();
    this._level.fill(0);
    this._owed.fill(0);
    this._sparkOwed.fill(0);
    for (let i = 0; i < this.cars * 4; i++) this.marks.lift(i);
  }

  dispose() {
    if (!this.enabled) return;
    for (const o of this.objects) this.scene.remove(o);
    this.marks.dispose();
    this.particles.dispose();
  }
}
