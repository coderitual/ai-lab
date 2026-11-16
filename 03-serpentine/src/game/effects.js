// SEAM for the effects lane: tyre smoke, skid marks and sparks. Empty for now.
//
// The game makes one Effects and calls update(dt, cars) once per fixed step,
// after the vehicles and the race have stepped; nothing else. Each entry of
// `cars` is { vehicle, impacts }: the Vehicle (its wheels' skid, surface and
// contact points, its scrape) and the impacts drained from it in this step.
// The same impact list goes to the sound: whoever reads it must not change it.
// Whatever is drawn is added to `scene` and kept up to date here, in the
// fixed step, so that a fast-forwarded run shows the same marks.

export class Effects {
  /**
   * @param {object} options
   * @param {import('three').Scene} options.scene
   * @param {import('./track.js').Track} options.track
   * @param {import('../engine/caps.js').Tier} options.tier
   * @param {import('../engine/rng.js').Rng} options.rng
   */
  constructor({ scene, track, tier, rng }) {
    this.scene = scene;
    this.track = track;
    this.tier = tier;
    this.rng = rng;
  }

  /**
   * @param {number} dt
   * @param {Array<{ vehicle: import('./vehicle/Vehicle.js').Vehicle, impacts: object[] }>} cars
   */
  update(dt, cars) {
    void dt;
    void cars;
  }

  /** A new run: forget every mark and every last contact. */
  reset() {}

  dispose() {}
}
