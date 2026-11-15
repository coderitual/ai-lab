// Race rules and bookkeeping.
//
//  - Laps are counted from progress along the track's centre line.
//  - Slalom marks must be passed on their signed side. A clean pass adds one
//    level of power (more top speed); a miss drops power to zero and counts
//    toward the miss limit.
//  - Leave the floats for too long and you are put back on course, powerless.

import { clamp } from '../engine/math.js';
import { RULES } from './config.js';

export class Race {
  /**
   * @param {object} o
   * @param {ReturnType<import('./track.js').createTrack>} o.track
   * @param {Array<{craft: import('./Craft.js').Craft, driver: any, name: string, isPlayer: boolean, powerCap?: number, pace?: number}>} o.entries
   * @param {object} [o.on] event callbacks
   */
  constructor({ track, entries, on = {} }) {
    this.track = track;
    this.on = on;
    this.laps = RULES.laps;
    this.racers = entries.map((e, index) => ({
      index,
      craft: e.craft,
      driver: e.driver,
      name: e.name,
      team: e.craft.team,
      isPlayer: !!e.isPlayer,
      powerCap: e.powerCap ?? RULES.maxPower,
      pace: e.pace ?? 1,
      s: 0,
      lateral: 0,
      locIndex: -1,
      totalS: 0,
      lap: 1,
      nextGate: 0,
      misses: 0,
      finished: false,
      retired: false,
      finishTime: Infinity,
      lapStart: 0,
      lapTimes: [],
      offTimer: 0,
      wrongTimer: 0,
      stuckTimer: 0,
      rank: index + 1,
    }));
    this.player = this.racers.find((r) => r.isPlayer) || this.racers[0];
    this.order = this.racers.slice();
    this.state = 'grid'; // grid | countdown | racing | finished
    this.time = 0; // race clock (starts at GO)
    this.countdown = 0;
    this._countShown = 0;
    this._loc = {};
    this._pt = {};
    this.endTimer = 0;
  }

  _emit(name, ...args) {
    const fn = this.on[name];
    if (fn) fn(...args);
  }

  /** Line everyone up on the grid. */
  reset(seaTime) {
    const { track } = this;
    // player starts on the outside (far left) with a clear view
    const slots = [0, 1, 2, 3];
    this.racers.forEach((r, i) => {
      const slot = track.gridSlot(slots[i]);
      r.craft.place(slot.x, slot.z, slot.heading, seaTime, 0);
      r.craft.power = 0;
      r.craft.speedFactor = r.pace;
      track.locate(slot.x, slot.z, -1, this._loc);
      r.locIndex = this._loc.index;
      r.s = this._loc.s;
      r.lateral = this._loc.lateral;
      r.totalS = r.s - track.length; // a little behind the line
      r.lap = 1;
      r.nextGate = 0;
      r.misses = 0;
      r.finished = false;
      r.retired = false;
      r.finishTime = Infinity;
      r.lapStart = 0;
      r.lapTimes = [];
      r.offTimer = r.wrongTimer = r.stuckTimer = 0;
      r.rank = i + 1;
    });
    this.state = 'grid';
    this.time = 0;
    this.endTimer = 0;
    this._rank();
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdown = 3.6;
    this._countShown = 4;
  }

  /** Before physics: let the drivers set their controls. */
  preStep(dt, seaTime) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.6);
      if (n !== this._countShown && n >= 1 && n <= 3) {
        this._countShown = n;
        this._emit('countdown', n);
      }
      if (this.countdown <= 0.6 && this._countShown !== 0) {
        this._countShown = 0;
        this.state = 'racing';
        this.time = 0;
        this._emit('go');
      }
    }
    const racing = this.state === 'racing' || this.state === 'finished';
    for (const r of this.racers) {
      const input = r.craft.input;
      if (!racing || r.retired) {
        input.steer = 0;
        input.throttle = 0;
        input.brake = r.retired ? 0.6 : 1; // hold station on the grid
        input.analog = true;
        continue;
      }
      r.driver.update(dt, r, this.racers, seaTime);
      if (r.finished) {
        // cruise after the flag
        input.throttle = Math.min(input.throttle, 0.45);
      }
    }
  }

  /** After physics: progress, marks, laps, ranking. */
  postStep(dt, seaTime) {
    const { track } = this;
    const L = track.length;
    const racing = this.state === 'racing' || this.state === 'finished';
    if (this.state === 'racing') this.time += dt;
    else if (this.state === 'finished') {
      this.time += dt;
      this.endTimer += dt;
    }

    for (const r of this.racers) {
      const c = r.craft;
      const prevS = r.s;
      track.locate(c.pos.x, c.pos.z, r.locIndex, this._loc);
      r.locIndex = this._loc.index;
      r.s = this._loc.s;
      r.lateral = this._loc.lateral;
      let ds = r.s - prevS;
      if (ds > L / 2) ds -= L;
      else if (ds < -L / 2) ds += L;
      r.totalS += ds;
      if (!racing || r.finished || r.retired) continue;

      // ---- slalom mark
      const gate = track.gates[r.nextGate];
      let before = prevS - gate.s;
      if (before > L / 2) before -= L;
      else if (before < -L / 2) before += L;
      const after = before + ds;
      if (before < 0 && after >= 0 && ds < 30) {
        const ok = (r.lateral - gate.lateral) * gate.side > 0.4;
        r.nextGate = (r.nextGate + 1) % track.gates.length;
        if (ok) {
          c.power = Math.min(r.powerCap, c.power + 1);
        } else if (r.isPlayer) {
          c.power = 0;
          r.misses++;
        } else {
          c.power = Math.max(0, c.power - 2);
        }
        this._emit('gate', r, gate, ok);
        if (r.isPlayer && r.misses >= RULES.maxMisses) {
          r.retired = true;
          this._emit('retire', r, 'misses');
          this._finishRace();
          continue;
        }
      }

      // ---- laps
      const lapsDone = r.totalS >= 0 ? Math.floor(r.totalS / L) : 0;
      if (lapsDone + 1 > r.lap) {
        const overshoot = r.totalS - lapsDone * L;
        const stamp = this.time - overshoot / Math.max(c.speed, 1);
        r.lapTimes.push(stamp - r.lapStart);
        r.lapStart = stamp;
        r.lap = lapsDone + 1;
        if (lapsDone >= this.laps) {
          r.finished = true;
          r.finishTime = stamp;
          r.lap = this.laps;
          this._emit('finish', r);
          if (r.isPlayer) this._finishRace();
        } else {
          this._emit('lap', r, r.lap, r.lapTimes[r.lapTimes.length - 1]);
        }
      }

      // ---- course limits
      const out = Math.abs(r.lateral) > track.halfWidth + 1.5;
      if (out) {
        r.offTimer += dt;
        const limit = r.isPlayer ? RULES.offCourseSeconds : 3;
        if (r.isPlayer) this._emit('offCourse', r, Math.max(0, limit - r.offTimer));
        if (r.offTimer >= limit) this.respawn(r, seaTime);
      } else if (r.offTimer > 0) {
        r.offTimer = 0;
        if (r.isPlayer) this._emit('offCourse', r, null);
      }

      if (r.isPlayer) {
        const f = track.sample(r.s, this._pt);
        const facing = Math.sin(c.yaw) * f.tx + Math.cos(c.yaw) * f.tz;
        const wrong = facing < -0.35 && c.forwardSpeed > 4;
        const was = r.wrongTimer > 1.0;
        r.wrongTimer = wrong ? r.wrongTimer + dt : 0;
        if (r.wrongTimer > 1.0 !== was) this._emit('wrongWay', r.wrongTimer > 1.0);
      } else {
        // bots that get wedged somewhere are put back on the line
        r.stuckTimer = c.speed < 2.5 ? r.stuckTimer + dt : 0;
        if (r.stuckTimer > 3.5) this.respawn(r, seaTime);
        // keep the pack interesting: a small, bounded catch-up
        const gap = this.player.totalS - r.totalS;
        c.speedFactor = r.pace + clamp(gap / 6000, -0.025, 0.045);
      }
    }

    this._rank();
  }

  _finishRace() {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.endTimer = 0;
    this._emit('raceOver', this.player);
  }

  /** Put a racer back on the ideal line where they left the course. */
  respawn(r, seaTime) {
    const { track } = this;
    const s = r.s;
    const pt = track.pointAt(s, track.lineOffset(s), this._pt);
    r.craft.place(pt.x, pt.z, pt.heading, seaTime, 7);
    r.craft.power = 0;
    r.offTimer = 0;
    r.stuckTimer = 0;
    track.locate(pt.x, pt.z, -1, this._loc);
    r.locIndex = this._loc.index;
    r.s = this._loc.s;
    r.lateral = this._loc.lateral;
    // next mark = the first one still ahead
    const gates = track.gates;
    let next = gates.findIndex((g) => g.s > r.s + 4);
    if (next === -1) next = 0;
    r.nextGate = next;
    if (r.isPlayer) this._emit('offCourse', r, null);
    this._emit('respawn', r);
  }

  _rank() {
    if (this.state === 'grid' || this.state === 'countdown') {
      // nobody has gone anywhere yet: show the grid order (player lines up last)
      this.order.sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0) || a.index - b.index);
      this.order.forEach((r, i) => (r.rank = i + 1));
      return;
    }
    this.order.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return b.totalS - a.totalS;
    });
    this.order.forEach((r, i) => (r.rank = i + 1));
  }

  /** True once the results can be shown as final. */
  get settled() {
    return this.state === 'finished' && (this.racers.every((r) => r.finished || r.retired) || this.endTimer > 25);
  }
}
