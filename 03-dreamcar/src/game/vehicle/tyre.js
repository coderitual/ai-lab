// The tyre: how much force a contact patch makes for how much slip.
//
// Two ideas. First, one curve (Pacejka's "Magic Formula") in a peak-normalised form: slip is divided by the slip at
// which the force peaks, so 1 means "at the limit" along the wheel, across it, or in any mixture, and the force is
// shared between the two directions in proportion to their normalised slips (a friction ellipse). Second, slip is
// kept as a velocity (m/s) and the force along the wheel is found implicitly: the wheel is light and the tyre is
// stiff, so stepping the wheel's spin forwards with the force of the slip it had oscillates at every speed a car
// drives at. solve() finds the slip the wheel ends the step with, which is also what makes a locked wheel bring the
// car to a dead stop and a stationary wheel hold it there.

/**
 * A Magic Formula curve y(x) = sin(C·atan(B·x − E·(B·x − atan(B·x)))) with B chosen so that the peak is at x = 1.
 * @param {number} C shape: what is left at large slip is sin(C·π/2)
 * @param {number} E curvature: below 0 the knee is sharper
 */
export function createCurve(C, E) {
  const target = Math.tan(Math.PI / (2 * C));
  let B = target;
  for (let i = 0; i < 40; i++) {
    const f = B - E * (B - Math.atan(B)) - target;
    B -= f / (1 - E * (1 - 1 / (1 + B * B)));
  }
  return { B, C, E, slope: B * C };
}

/** y(x) / x for x ≥ 0: the secant of the curve, which is what sharing a force between two directions needs. */
export function secant(curve, x) {
  if (x < 1e-5) return curve.slope;
  const bx = curve.B * x;
  return Math.sin(curve.C * Math.atan(bx - curve.E * (bx - Math.atan(bx)))) / x;
}

/**
 * One wheel's contact for one step: set it up with the load and the patch's velocity, then ask it for forces.
 * A single instance is reused for every wheel (nothing is allocated while driving).
 */
export class Contact {
  /** @param {object} tyre CAR.tyre */
  constructor(tyre) {
    this.tyre = tyre;
    this.curveX = createCurve(tyre.shapeX, tyre.curvatureX);
    this.curveY = createCurve(tyre.shapeY, tyre.curvatureY);
    this.peakX = 0; // N, the most the tyre can push along the wheel
    this.peakY = 0;
    this.perSlip = 0; // normalised slip per m/s of slip velocity along the wheel
    this.sigmaY = 0; // normalised slip across the wheel (signed: + makes a force to the wheel's left)
    this.rho = 0; // combined normalised slip of the last force asked for: 1 = at the limit
  }

  /**
   * @param {number} load N on the wheel
   * @param {number} grip the surface's, times the wheel's own
   * @param {number} surfaceGrip the surface's alone (decides how late a loose surface peaks)
   * @param {number} vx speed of the patch along the wheel (m/s)
   * @param {number} vy speed of the patch to the wheel's left (m/s)
   * @param {number} give how much later than the tyre's own figure this wheel's sideways force peaks (1 = as the tyre)
   */
  setup(load, grip, surfaceGrip, vx, vy, give) {
    const t = this.tyre;
    const ratio = load / t.loadRef;
    const sens = Math.min(1.12, Math.max(0.72, 1 - t.loadSensitivity * (ratio - 1)));
    const loose = 1 + t.looseSlip * Math.max(0, 1 - surfaceGrip);
    const ref = Math.max(Math.abs(vx), t.minSpeed);
    this.peakX = t.muX * grip * sens * load;
    this.peakY = t.muY * grip * sens * load;
    this.perSlip = 1 / (ref * t.kappaPeak * loose);
    this.sigmaY = -vy / (ref * t.alphaPeak * loose * give);
  }

  /** Force along the wheel (N) for a slip velocity sx (m/s; + = the tread moving backwards over the road: driving). */
  forceX(sx) {
    const sigmaX = sx * this.perSlip;
    const rho = Math.sqrt(sigmaX * sigmaX + this.sigmaY * this.sigmaY);
    this.rho = rho;
    return this.peakX * sigmaX * secant(this.curveX, rho);
  }

  /** Force to the wheel's left (N) with the same slip along the wheel. */
  forceY(sx) {
    const sigmaX = sx * this.perSlip;
    const rho = Math.sqrt(sigmaX * sigmaX + this.sigmaY * this.sigmaY);
    this.rho = rho;
    return this.peakY * this.sigmaY * secant(this.curveY, rho);
  }

  /**
   * The slip velocity the wheel ends the step with: the root of s − s0 + a·forceX(s) = 0, where s0 is the slip it
   * would have if the tyre made no force and a = dt / (the mass the tyre has to move, seen at the patch).
   * forceX grows no faster than its first slope, so the linear answer is a lower bound and usually exact; beyond
   * that, false position with the Illinois correction between the bound and s0.
   */
  solve(s0, a) {
    if (s0 === 0 || this.peakX <= 0) return s0;
    const sign = s0 < 0 ? -1 : 1;
    const target = s0 * sign;
    const stiffness = this.peakX * this.perSlip * secant(this.curveX, Math.abs(this.sigmaY));
    let lo = target / (1 + a * stiffness);
    let hLo = lo - target + a * this.forceX(lo);
    const tolerance = 1e-7 * target + 1e-10;
    if (hLo > -tolerance) return lo * sign;
    let hi = target;
    let hHi = a * this.forceX(hi);
    let s = lo;
    let kept = 0; // which end survived the last step: −1 the low one, +1 the high one
    for (let i = 0; i < 24; i++) {
      s = (lo * hHi - hi * hLo) / (hHi - hLo);
      const h = s - target + a * this.forceX(s);
      if (Math.abs(h) < tolerance) break;
      if (h > 0) {
        hi = s;
        hHi = h;
        if (kept === -1) hLo *= 0.5;
        kept = -1;
      } else {
        lo = s;
        hLo = h;
        if (kept === 1) hHi *= 0.5;
        kept = 1;
      }
    }
    return s * sign;
  }
}
