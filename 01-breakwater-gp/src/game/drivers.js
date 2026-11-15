// Who is at the helm.

import { angleDiff, clamp } from '../engine/math.js';

/** A human on this machine: copies the input device state onto the craft. */
export class PlayerDriver {
  /**
   * @param {import('../engine/Input.js').Input} input
   * @param {'all'|'wasd'|'arrows'} [scheme] which keys this driver uses
   */
  constructor(input, scheme = 'all') {
    this.input = input;
    this.scheme = scheme;
  }

  update(dt, racer) {
    this.input.read(racer.craft.input, this.scheme);
  }
}

/**
 * A simple bot: aim at a point a little way ahead on the ideal line through
 * the slalom marks, ease off when badly misaligned, shuffle sideways to avoid
 * riding up another craft's stern.
 */
export class BotDriver {
  /**
   * @param {ReturnType<import('./track.js').createTrack>} track
   * @param {{ bias?: number, sharpness?: number, wobble?: number, phase?: number }} [skill]
   */
  constructor(track, skill = {}) {
    this.track = track;
    this.bias = skill.bias ?? 0; // habitual offset from the ideal line (m)
    this.sharpness = skill.sharpness ?? 2.3;
    this.wobble = skill.wobble ?? 1.0;
    this.phase = skill.phase ?? 0;
    this._avoid = 0;
    this._pt = {};
  }

  update(dt, racer, racers, time) {
    const craft = racer.craft;
    const track = this.track;
    const look = 12 + craft.speed * 0.6;
    const s = racer.s + look;

    // steer round anyone just ahead
    let avoid = 0;
    const fx = Math.sin(craft.yaw);
    const fz = Math.cos(craft.yaw);
    for (const other of racers) {
      if (other === racer) continue;
      const dx = other.craft.pos.x - craft.pos.x;
      const dz = other.craft.pos.z - craft.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > 14) continue;
      const side = dx * fz - dz * fx; // > 0: the other boat is to our left (port)
      if (Math.abs(side) < 3.3) avoid += side > 0 ? 4.2 : -4.2; // lateral > 0 is to the right
    }
    this._avoid += (avoid - this._avoid) * Math.min(1, dt * 3);

    const wobble = Math.sin(time * 0.37 + this.phase) * this.wobble;
    let lateral = clamp(track.lineOffset(s) + this.bias + wobble + this._avoid, -track.halfWidth + 3, track.halfWidth - 3);
    // whatever else is going on, never aim at the wrong side of the next mark
    const gate = track.gates[racer.nextGate];
    let toGate = gate.s - racer.s;
    if (toGate < -track.length / 2) toGate += track.length;
    if (toGate > -4 && toGate < look + 18) {
      const clear = (lateral - gate.lateral) * gate.side;
      if (clear < 4.2) lateral = gate.lateral + gate.side * 4.2;
    }
    const pt = track.pointAt(s, lateral, this._pt);
    const want = Math.atan2(pt.x - craft.pos.x, pt.z - craft.pos.z);
    const err = angleDiff(craft.yaw, want); // > 0: target is to port
    const steer = clamp(-err * this.sharpness + craft.yawRate * 0.18, -1, 1); // P on heading, D on yaw rate

    const input = craft.input;
    input.analog = true;
    input.steer = steer;
    const off = Math.abs(err);
    input.throttle = off > 1.1 ? 0.35 : 1;
    input.brake = off > 0.8 && craft.speed > 12 ? 1 : 0;
  }
}
