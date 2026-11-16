// The car's dimensions, defined once.
//
// The meshes, the physics, the cameras, the lamps and the effects all read
// these numbers; nobody keeps a copy. Pure data: no imports, so that the
// physics can be run in Node without a browser.
//
// Car space (the frame every number here is in, and the frame of the model's
// root object):
//
//   origin   on the ground, on the centre line, midway between the axles
//   +Z       forward (towards the bonnet)
//   +Y       up
//   +X       the car's LEFT (the driver's side on this left-hand-drive car)
//
// Metres, kilograms, radians.

/**
 * Outer dimensions and hard points of the body (W206 saloon, AMG Line).
 *
 * The AMG Line bumpers make the car 42 mm longer than the 4.751 m usually quoted (835 + 2865 + 1093), and
 * its staggered 18-inch wheels (7.5J ET40 front, 8.5J ET52 rear) give tracks of 1.590 / 1.579 m, not the
 * 1.582 / 1.594 m of the base wheels. Photographs of the car agree: nose at +2.27, tail at -2.53.
 */
export const DIMS = {
  length: 4.793,
  width: 1.82, // body, without mirrors
  widthWithMirrors: 2.033,
  height: 1.438,
  wheelbase: 2.865,
  trackFront: 1.59,
  trackRear: 1.579,
  frontOverhang: 0.835, // front axle to the nose (the upper edge of the grille)
  rearOverhang: 1.093, // rear axle to the tail (the bumper, 0.47 m up)
  groundClearance: 0.13, // unladen, under the floor (the maker quotes 94 mm fully laden); the sills are at 0.19
};

/** Z of the axles and of the body's ends in car space. */
export const STATIONS = {
  frontAxle: DIMS.wheelbase / 2,
  rearAxle: -DIMS.wheelbase / 2,
  nose: DIMS.wheelbase / 2 + DIMS.frontOverhang,
  tail: -DIMS.wheelbase / 2 - DIMS.rearOverhang,
};

/** Tyres: 225/45 R18 front, 245/40 R18 rear. */
export const TYRES = {
  front: { width: 0.225, aspect: 0.45, rim: 18 * 0.0254, radius: (18 * 0.0254) / 2 + 0.225 * 0.45 },
  rear: { width: 0.245, aspect: 0.4, rim: 18 * 0.0254, radius: (18 * 0.0254) / 2 + 0.245 * 0.4 },
};

/**
 * The wheels, in the order used everywhere: 0 front-left, 1 front-right,
 * 2 rear-left, 3 rear-right. `x`, `z`: the wheel centre's place in car space
 * (its height is the tyre's radius when the car stands on level ground).
 */
export const WHEELS = [
  { name: 'FL', x: DIMS.trackFront / 2, z: STATIONS.frontAxle, front: true, left: true, tyre: TYRES.front },
  { name: 'FR', x: -DIMS.trackFront / 2, z: STATIONS.frontAxle, front: true, left: false, tyre: TYRES.front },
  { name: 'RL', x: DIMS.trackRear / 2, z: STATIONS.rearAxle, front: false, left: true, tyre: TYRES.rear },
  { name: 'RR', x: -DIMS.trackRear / 2, z: STATIONS.rearAxle, front: false, left: false, tyre: TYRES.rear },
];

/** Mass properties (with a driver and half a tank). The centre of mass is given in car space. */
export const MASS = {
  mass: 1700,
  frontShare: 0.53, // of the weight on the front axle at rest
  comHeight: 0.54,
  /** z of the centre of mass: ahead of the wheelbase midpoint when the front carries more */
  get comZ() {
    return (this.frontShare - 0.5) * DIMS.wheelbase;
  },
};

/** Where the lamps are (centres of the light sources, car space; x for the left lamp, mirror for the right). */
export const LAMPS = {
  head: { x: 0.67, y: 0.67, z: STATIONS.nose - 0.31 }, // between the two projectors; the lamps sit well back on the swept nose
  tail: { x: 0.62, y: 0.84, z: STATIONS.tail + 0.235 }, // middle of the lamp, where the boot lid's cut crosses it
  thirdBrake: { x: 0, y: 1.305, z: -1.56 }, // inside the rear screen, 30 mm under its upper edge
  plateRear: { x: 0, y: 0.842, z: STATIONS.tail + 0.095 }, // the lamps above the plate; the plate's centre is at y 0.771, tail + 0.108
};

/** The driver's eye, the bonnet camera and the bumper camera (car space). */
export const VIEWPOINTS = {
  eye: { x: 0.37, y: 1.14, z: 0.05 },
  bonnet: { x: 0, y: 1.12, z: 0.95 }, // 0.11 above the bonnet, just ahead of the windscreen's foot (z 0.84): outside the glass
  bumper: { x: 0, y: 0.5, z: STATIONS.nose + 0.03 }, // ahead of the grille (its star is at y 0.573), above the plate
};
