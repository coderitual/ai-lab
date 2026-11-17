// The engine, the torque converter and the nine-speed automatic, as far as the rear axle.
//
// The engine has no speed of its own to integrate. Its speed is a function of the speed of the driven wheels (through
// the gear in use) and of the speed the converter lets it reach against a stopped car, joined smoothly: at a standstill
// it is the stall speed for the throttle given, on the move it is the wheels', and in between the converter slips and
// multiplies torque. That cannot stall, cannot oscillate, and gives the launch and the engine braking of an automatic.
// The engine's inertia is still felt: update() says how much of it the rear wheels have to turn in this gear.
//
// The box shifts on road speed and on how the pedals have been used lately: up early on a light throttle, late on a
// wide one, down when the next gear down would still be below the up-shift point (which is what a kick-down is), and
// it holds revs under braking so that the right gear is waiting at the exit of the bend.

const RPM = 30 / Math.PI; // rad/s to rev/min

export class Drivetrain {
  /**
   * @param {object} car CAR (vehicle/params.js)
   * @param {number} radius rolling radius of the driven wheels (m)
   */
  constructor(car, radius) {
    this.engine = car.engine;
    this.box = car.gearbox;
    this.radius = radius;
    /** Torque on the rear axle (N·m, both wheels together; negative drives backwards or brakes). */
    this.axleTorque = 0;
    /** Engine inertia as each rear wheel feels it (kg·m²). */
    this.wheelInertia = 0;
    this.reset();
  }

  reset() {
    this.gear = 1; // -1 reverse, 1..9
    this.rpm = this.engine.idle; // what a rev counter would show
    this.shifting = false;
    this.axleTorque = 0;
    this.wheelInertia = 0;
    this._forward = 1; // the forward gear engaged, kept while in reverse
    this._next = 1;
    this._timer = 0;
    this._time = 1;
    this._sinceShift = 1;
    this._load = 0; // the throttle as the engine has answered it so far
    this._memory = 0; // the widest recent throttle, fading: what the shift points go by
  }

  /** Full-throttle torque (N·m) at an engine speed (rpm). */
  fullTorque(rpm) {
    const t = this.engine.torque;
    const last = t.length - 2;
    if (rpm <= t[0]) return t[1];
    if (rpm >= t[last]) return t[last + 1];
    let i = 2;
    while (t[i] < rpm) i += 2;
    const f = (rpm - t[i - 2]) / (t[i] - t[i - 2]);
    return t[i - 1] + (t[i + 1] - t[i - 1]) * f;
  }

  /**
   * @param {number} dt
   * @param {number} throttle 0..1 the driver's throttle: what the engine answers and the shift points go by
   * @param {number} keep 0..1 how much of the engine's torque the traction and stability controls let through
   *   (they cut the spark, which is immediate, where the throttle is not)
   * @param {number} brake 0..1
   * @param {number} wheelOmega mean spin of the driven wheels (rad/s, + = forwards)
   * @param {number} roadSpeed the car's forward speed (m/s)
   * @param {number} cornering lateral acceleration in g (the box does not shift up in the middle of a bend)
   * @param {boolean} reverse reverse is selected
   */
  update(dt, throttle, keep, brake, wheelOmega, roadSpeed, cornering, reverse) {
    const e = this.engine;
    const b = this.box;
    const rise = throttle > this._load ? e.riseTime : e.fallTime;
    this._load += (throttle - this._load) * (1 - Math.exp(-dt / rise));
    const load = this._load;

    this._sinceShift += dt;
    if (reverse) {
      this._forward = 1;
      this._timer = 0;
    } else {
      this._memory = throttle > this._memory ? throttle : Math.max(throttle, this._memory - dt / b.holdAfterLift);
      const light = b.upLight + (b.upFull - b.upLight) * this._memory ** 1.4;
      const braking = brake > 0.1 ? b.brakeLight + (b.brakeFull - b.brakeLight) * brake : 0;
      const up = Math.max(light, braking);
      if (this._timer > 0) {
        this._timer -= dt;
        if (this._timer <= this._time * 0.5) this._forward = this._next;
        if (this._timer <= 0) this._sinceShift = 0;
      } else {
        const perRatio = (Math.max(roadSpeed, 0) / this.radius) * b.final * RPM; // engine rpm per unit of gear ratio
        let target = this._forward;
        while (target > 1 && perRatio * b.ratios[target - 2] < b.downFraction * up) target--;
        if (target < this._forward) {
          if (this._sinceShift > b.minInterval * 0.5) this._begin(target, b.kickdownTime);
        } else if (this._forward < b.ratios.length && this._sinceShift > b.minInterval) {
          const now = perRatio * b.ratios[this._forward - 1];
          const next = perRatio * b.ratios[this._forward];
          // on a wide throttle, also as soon as the next gear would make more power than this one does
          const stronger = this._memory > 0.9 && now > 4000 && this.fullTorque(next) * next >= this.fullTorque(now) * now;
          if ((now > up || stronger) && (cornering < 0.6 || now > b.upFull)) this._begin(this._forward + 1, b.shiftTime);
        }
      }
    }
    this.shifting = this._timer > 0;
    this.gear = reverse ? -1 : this._forward;

    // from the wheels back to the engine
    const ratio = (reverse ? -b.reverse : b.ratios[this._forward - 1]) * b.final;
    const turbine = Math.max(wheelOmega * ratio, 0); // rad/s; a car rolling the wrong way for its gear is a stalled converter
    const stall = (e.idle + (b.stallRpm - e.idle) * load ** 0.8) / RPM;
    const t2 = turbine * turbine;
    const s2 = stall * stall;
    const omega = Math.sqrt(Math.sqrt(t2 * t2 + s2 * s2));
    const coupled = turbine / omega; // 0 stalled .. 1 locked
    const rpm = omega * RPM;

    const limit = Math.min(1, Math.max(0, (e.limiter + 50 - rpm) / 100));
    const multiply = 1 + (b.stallRatio - 1) * (1 - coupled) ** 1.5;
    const drive = load * keep * this.fullTorque(rpm) * limit * multiply;
    const overrun = Math.max(0, rpm - e.limiter) * 0.6;
    const drag = ((1 - load) * (e.frictionBase + e.frictionSlope * rpm) + overrun) * coupled * coupled;
    let torque = drive - drag;
    if (this._timer > 0) torque *= b.shiftTorque + (1 - b.shiftTorque) * Math.abs((2 * this._timer) / this._time - 1);
    this.axleTorque = torque * ratio * (torque > 0 ? b.efficiency : 1);
    const c2 = coupled * coupled;
    this.wheelInertia = 0.5 * e.inertia * ratio * ratio * c2 * c2;
    this.rpm += (rpm - this.rpm) * (1 - Math.exp(-dt * 22));
  }

  _begin(gear, time) {
    this._next = gear;
    this._time = time;
    this._timer = time;
  }
}
