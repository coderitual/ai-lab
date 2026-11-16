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

/** Outer dimensions and hard points of the body (W206 saloon, AMG Line). */
export const DIMS = {
  length: 4.751,
  width: 1.82, // body, without mirrors
  widthWithMirrors: 2.033,
  height: 1.438,
  wheelbase: 2.865,
  trackFront: 1.582,
  trackRear: 1.594,
  frontOverhang: 0.812, // front axle to the nose
  rearOverhang: 1.074, // rear axle to the tail
  groundClearance: 0.13,
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
  head: { x: 0.71, y: 0.685, z: STATIONS.nose - 0.14 },
  tail: { x: 0.66, y: 0.9, z: STATIONS.tail + 0.06 },
  thirdBrake: { x: 0, y: 1.3, z: -1.62 },
  plateRear: { x: 0, y: 0.72, z: STATIONS.tail + 0.01 },
};

/** The driver's eye, the bonnet camera and the bumper camera (car space). */
export const VIEWPOINTS = {
  eye: { x: 0.37, y: 1.14, z: 0.05 },
  bonnet: { x: 0, y: 1.08, z: 0.55 },
  bumper: { x: 0, y: 0.55, z: STATIONS.nose - 0.05 },
};
