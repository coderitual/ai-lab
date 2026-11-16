// The lines of the body: the single source of its shape.
//
// Everything here is a table in car space (metres; +Z forward, +Y up, +X the
// car's left; the left half only), taken from the modelling sheet of the car
// (docs/car.md: its side profile, plan curves and cross-sections, measured on
// photographs) and then faired by eye against the same photographs. skin.js
// lofts one surface through them; body.js draws what is flush with that
// surface (glass, shut lines, lamps) from the outlines at the end of this
// file. Nothing else knows what the car looks like.
//
// How the body is described
//   - Three lines run the whole way round the half car, from the centre line
//     at the nose to the centre line at the tail: the LOWER edge of the body,
//     the WIDEST line (the plan outline: the doors' fullest point, the
//     bumpers' faces) and the SHOULDER (the crease under the windows, which
//     becomes the upper edge of the head lamp and of the grille in front, and
//     the upper edge of the tail lamp and the lip of the boot lid behind).
//   - CENTRE_TOP is the profile over the bonnet, the roof and the boot.
//   - The glasshouse stands on the shoulder: BELT (foot of the side glass),
//     DLO_TOP (its upper edge) and TOP_EDGE (where windscreen, roof and rear
//     screen end and the pillars begin).
//   - Between those lines the section is filled in by a few numbers that
//     change along the car (the tables called SHAPE): how full the flank is,
//     how sharp the shoulder, how crowned the roof.
//
// Tables are written nose to tail.

import { STATIONS } from './spec.js';

export const NOSE = STATIONS.nose; // +2.2675
export const TAIL = STATIONS.tail; // -2.5255

/**
 * The centre line over the top, [z, y]: from the foremost point of the car (the grille's upper edge) over
 * bonnet, windscreen, roof, rear screen and boot lid to the sharp edge of the lid's lip. A trailing 1 marks a
 * corner of the profile (the foot of each screen).
 */
export const CENTRE_TOP = [
  [NOSE, 0.71],
  [2.258, 0.733],
  [2.228, 0.757],
  [2.177, 0.783],
  [2.13, 0.802],
  [2.05, 0.832],
  [1.95, 0.863],
  [1.8, 0.9],
  [1.6, 0.936],
  [1.4325, 0.958],
  [1.2, 0.984],
  [1.0, 1.002],
  [0.86, 1.015, 1],
  [0.84, 1.022, 1],
  [0.65, 1.125],
  [0.45, 1.23],
  [0.25, 1.328],
  [0.115, 1.386],
  [0.0, 1.408],
  [-0.15, 1.425],
  [-0.35, 1.436],
  [-0.5, 1.438],
  [-0.7, 1.434],
  [-0.9, 1.422],
  [-1.1, 1.401],
  [-1.3, 1.37],
  [-1.45, 1.34],
  [-1.53, 1.322],
  [-1.7, 1.232],
  [-1.85, 1.146],
  [-1.96, 1.078, 1],
  [-2.1, 1.062],
  [-2.25, 1.044],
  [-2.38, 1.024],
  [-2.435, 1.017],
  [-2.449, 1.008],
];

/** The lower edge of the body, [x, y, z]: front lip, bumper corner, the skirt between the arches, rear valance. */
export const LOWER = [
  [0, 0.185, 2.24],
  [0.2, 0.181, 2.233],
  [0.4, 0.177, 2.205],
  [0.53, 0.175, 2.165],
  [0.65, 0.174, 2.12],
  [0.75, 0.174, 2.07],
  [0.8, 0.176, 2.03],
  [0.835, 0.18, 1.95],
  [0.85, 0.188, 1.86],
  [0.857, 0.198, 1.78],
  [0.86, 0.2, 1.4325],
  [0.86, 0.196, 1.047],
  [0.86, 0.186, 0.95],
  [0.86, 0.186, 0.7],
  [0.86, 0.188, 0.3],
  [0.86, 0.19, -0.1],
  [0.86, 0.192, -0.5],
  [0.86, 0.195, -0.9],
  [0.86, 0.2, -1.04],
  [0.862, 0.225, -1.4325],
  [0.86, 0.25, -1.822],
  [0.855, 0.275, -1.95],
  [0.838, 0.3, -2.1],
  [0.795, 0.325, -2.25],
  [0.715, 0.345, -2.38],
  [0.6, 0.335, -2.445],
  [0.45, 0.305, -2.478],
  [0.25, 0.272, -2.492],
  [0, 0.262, -2.495],
];

/**
 * The widest line, [x, y, z]: the plan outline of the car. At the ends it is the bumpers' plan curve (0.45 up
 * in front, 0.47 behind); along the sides it climbs to the arches' crowns and the doors' fullest point.
 */
export const WIDEST = [
  [0, 0.45, 2.25],
  [0.2, 0.45, 2.243],
  [0.4, 0.45, 2.215],
  [0.53, 0.45, 2.175],
  [0.65, 0.45, 2.13],
  [0.75, 0.45, 2.08],
  [0.8, 0.45, 2.04],
  [0.84, 0.45, 1.96],
  [0.862, 0.46, 1.85],
  [0.88, 0.55, 1.7],
  [0.905, 0.66, 1.4325],
  [0.892, 0.64, 1.1],
  [0.893, 0.64, 0.75],
  [0.897, 0.65, 0.4],
  [0.901, 0.66, 0.04],
  [0.905, 0.68, -0.42],
  [0.906, 0.69, -0.8],
  [0.907, 0.69, -1.1],
  [0.91, 0.69, -1.4325],
  [0.905, 0.66, -1.75],
  [0.887, 0.6, -1.9],
  [0.87, 0.5, -2.0],
  [0.84, 0.47, -2.15],
  [0.78, 0.47, -2.3],
  [0.69, 0.47, -2.395],
  [0.57, 0.47, -2.46],
  [0.45, 0.47, -2.505],
  [0.3, 0.47, -2.52],
  [0, 0.47, TAIL],
];

/**
 * The shoulder, [x, y, z]. From the nose: the grille's upper edge, the head lamp's upper edge, the crown of the
 * front wing, the soft crease under the side windows, the rear wing, the tail lamp's upper edge, and the lip of
 * the boot lid in to the centre line.
 */
export const SHOULDER = [
  [0, 0.71, NOSE],
  [0.15, 0.708, 2.262],
  [0.3, 0.703, 2.243],
  [0.4, 0.697, 2.212],
  [0.47, 0.703, 2.14],
  [0.53, 0.713, 2.047],
  [0.6, 0.728, 1.975],
  [0.68, 0.744, 1.865],
  [0.75, 0.756, 1.776],
  [0.8, 0.772, 1.6],
  [0.82, 0.796, 1.4325],
  [0.83, 0.865, 1.1],
  [0.833, 0.925, 0.75],
  [0.836, 0.935, 0.66],
  [0.848, 0.94, 0.3],
  [0.855, 0.945, -0.1],
  [0.857, 0.948, -0.42],
  [0.85, 0.952, -0.8],
  [0.83, 0.955, -1.2],
  [0.815, 0.955, -1.4325],
  [0.812, 0.952, -1.6],
  [0.815, 0.943, -1.8],
  [0.822, 0.925, -1.93],
  [0.818, 0.912, -2.0],
  [0.8, 0.908, -2.06],
  [0.76, 0.91, -2.116],
  [0.7, 0.908, -2.197],
  [0.64, 0.904, -2.267],
  [0.6, 0.905, -2.3],
  [0.5, 0.955, -2.38],
  [0.3, 1.0, -2.435],
  [0, 1.008, -2.449],
];

/** The belt line, [x, y, z]: the foot of the side glass, from its front tip to its rear tip. */
export const BELT = [
  [0.795, 0.932, 0.68],
  [0.803, 0.944, 0.55],
  [0.81, 0.955, 0.4],
  [0.815, 0.964, 0.25],
  [0.818, 0.972, 0.1],
  [0.82, 0.981, -0.1],
  [0.82, 0.988, -0.3],
  [0.82, 0.992, -0.42],
  [0.815, 0.996, -0.6],
  [0.805, 1.0, -0.8],
  [0.79, 1.003, -1.0],
  [0.77, 1.006, -1.2],
  [0.752, 1.012, -1.35],
  [0.738, 1.022, -1.45],
  [0.73, 1.035, -1.5],
];

/** The upper edge of the side glass, [x, y, z]: up the A-pillar, along the roof and down the rear arc. */
export const DLO_TOP = [
  [0.795, 0.932, 0.68],
  [0.8, 0.99, 0.6],
  [0.798, 1.07, 0.48],
  [0.79, 1.15, 0.35],
  [0.78, 1.21, 0.24],
  [0.77, 1.25, 0.15],
  [0.752, 1.283, 0.06],
  [0.736, 1.31, -0.04],
  [0.722, 1.333, -0.16],
  [0.706, 1.35, -0.3],
  [0.692, 1.358, -0.42],
  [0.676, 1.361, -0.56],
  [0.658, 1.359, -0.7],
  [0.636, 1.351, -0.85],
  [0.616, 1.341, -0.96],
  [0.598, 1.33, -1.06],
  [0.6, 1.311, -1.141],
  [0.638, 1.269, -1.254],
  [0.652, 1.228, -1.321],
  [0.681, 1.167, -1.403],
  [0.704, 1.106, -1.448],
  [0.718, 1.066, -1.48],
  [0.73, 1.035, -1.5],
];

/**
 * Where the top surfaces end, [x, y, z]: a little outside the windscreen's side edge, along the roof where it
 * turns down into the cant rail, and a little outside the rear screen's side edge.
 */
export const TOP_EDGE = [
  [0.7, 0.99, 0.713],
  [0.665, 1.094, 0.5],
  [0.63, 1.193, 0.3],
  [0.598, 1.318, 0.045],
  [0.612, 1.374, -0.15],
  [0.628, 1.386, -0.42],
  [0.603, 1.378, -0.8],
  [0.575, 1.352, -1.1],
  [0.556, 1.318, -1.3],
  [0.535, 1.268, -1.473],
  [0.588, 1.152, -1.7],
  [0.645, 1.05, -1.885],
];

/**
 * Stations: where the control sections of the surface stand. `main` are heights of the centre line's z (the
 * sides of a section stand off it by SHAPE.sweep, so that a section can follow the foot of a screen); in front
 * of the first and behind the last, `noseSteps` and `tailSteps` sections fan round the ends to the centre line.
 */
export const SECTIONS = {
  main: [1.72, 1.5, 1.3, 1.1, 0.96, 0.87, 0.84, 0.76, 0.66, 0.54, 0.4, 0.25, 0.115, 0.0, -0.15, -0.42, -0.7, -0.95, -1.2, -1.4, -1.53, -1.63, -1.75, -1.87, -1.955],
  /** z of the first section that belongs to the boot lid: the fan round the tail starts here */
  tailStart: -1.975,
  noseSteps: 8,
  tailSteps: 8,
  /** the foot of the windscreen and of the rear screen on the centre line: the glasshouse is between them */
  cowl: 0.85,
  rearFoot: -1.965,
  /** how far behind the nose, and ahead of the lip, the centre line's own rail begins */
  corner: 0.03,
};

/**
 * Numbers of the section that change along the car, as tables against `q`: the centre line's z between the
 * first and last main sections, running on to +1 beyond the first at the nose's centre line and to -1 beyond
 * the last at the tail's.
 */
const Q_NOSE = SECTIONS.main[0] + 1; // 2.72
const Q_TAIL = SECTIONS.tailStart - 1; // -2.975
export const SHAPE = {
  /** how far the sides of a section stand behind (+) or ahead of (-) its centre, [z, m] */
  sweep: [
    [1.72, 0.1],
    [1.3, 0.13],
    [0.87, 0.16],
    [0.84, 0.16],
    [0.115, 0.153],
    [-0.2, 0.04],
    [-0.42, 0],
    [-0.9, 0],
    [-1.2, -0.04],
    [-1.53, -0.125],
    [-1.975, -0.115],
  ],
  /** x at which the sweep is complete (it grows with the square of x up to there) */
  sweepWidth: 0.78,
  /** exponent of the fall from the centre line to the edge of a top surface: 2 is a parabola, more is flatter in the middle */
  crown: [
    [Q_NOSE, 2.6],
    [2.2, 3.0],
    [1.72, 3.3],
    [0.87, 3.3],
    [0.84, 2.2],
    [0.115, 2.4],
    [-0.42, 2.7],
    [-1.4, 2.6],
    [-1.63, 2.3],
    [-1.955, 2.3],
    [-1.975, 5.5],
    [-2.6, 5.0],
    [Q_TAIL, 3.0],
  ],
  /** half the width of the band the shoulder's crease is rounded over */
  shoulderSoft: [
    [Q_NOSE, 0.008],
    [2.1, 0.012],
    [1.72, 0.03],
    [0.7, 0.03],
    [0.3, 0.022],
    [-1.0, 0.02],
    [-1.6, 0.014],
    [-2.2, 0.008],
    [-2.4, 0.004],
    [Q_TAIL, 0.004],
  ],
  /**
   * The rails between the lower edge and the widest line: for each, how far across (in plan) and how far up it
   * sits between the two, [q, across, up]. Along the doors they draw the skirt, the door's lower edge, the
   * lower crease and the flank; at the ends the bumpers' faces.
   */
  lower: [
    [
      [Q_NOSE, 0.3, 0.11],
      [1.9, 0.3, 0.1],
      [1.0, 0.53, 0.03],
      [-1.0, 0.53, 0.03],
      [-1.9, 0.4, 0.08],
      [Q_TAIL, 0.3, 0.1],
    ],
    [
      [Q_NOSE, -0.5, 0.25],
      [1.9, 0.5, 0.28],
      [1.0, 0.58, 0.18],
      [-1.0, 0.58, 0.18],
      [-1.9, 0.5, 0.25],
      [Q_TAIL, 0.56, 0.28],
    ],
    [
      [Q_NOSE, -0.5, 0.5],
      [1.9, 0.75, 0.55],
      [1.0, 0.73, 0.51],
      [-1.0, 0.73, 0.51],
      [-1.9, 0.8, 0.55],
      [Q_TAIL, 0.88, 0.64],
    ],
    [
      [Q_NOSE, 0.3, 0.75],
      [1.9, 0.95, 0.8],
      [1.0, 0.93, 0.755],
      [-1.0, 0.93, 0.755],
      [-1.9, 0.95, 0.8],
      [Q_TAIL, 0.97, 0.85],
    ],
  ],
  /** The rails between the widest line and the shoulder, likewise: the flank's fullness, the haunches, the bumper's shelf under the tail lamps. */
  upper: [
    [
      [Q_NOSE, 0.25, 0.25],
      [1.9, 0.25, 0.25],
      [1.43, 0.14, 0.22],
      [0.6, 0.06, 0.2],
      [-1.0, 0.06, 0.2],
      [-1.43, 0.05, 0.23],
      [-1.955, 0.06, 0.25],
      [-2.3, 0.08, 0.3],
      [-2.75, 0.4, 0.25],
      [Q_TAIL, 0.73, 0.21],
    ],
    [
      [Q_NOSE, 0.5, 0.5],
      [1.9, 0.5, 0.5],
      [1.43, 0.435, 0.6],
      [0.6, 0.17, 0.41],
      [-1.0, 0.17, 0.41],
      [-1.43, 0.26, 0.53],
      [-1.955, 0.3, 0.5],
      [-2.3, 0.5, 0.5],
      [-2.75, 0.9, 0.42],
      [Q_TAIL, 1.2, 0.34],
    ],
    [
      [Q_NOSE, 0.78, 0.78],
      [1.9, 0.78, 0.78],
      [1.43, 0.75, 0.85],
      [0.6, 0.52, 0.75],
      [-1.0, 0.52, 0.75],
      [-1.43, 0.63, 0.81],
      [-1.955, 0.75, 0.75],
      [-2.3, 0.93, 0.66],
      [-2.75, 1.1, 0.72],
      [Q_TAIL, 1.2, 0.8],
    ],
  ],
  /**
   * Where the rails of a top surface without a glasshouse on it (bonnet, boot lid) lie between the centre line
   * (0) and the shoulder (1). The first six continue the glasshouse's own lines (belt, two on the glass, upper
   * edge of the glass, pillar, top edge), which is why they crowd towards the shoulder.
   */
  deck: [0.965, 0.955, 0.945, 0.93, 0.89, 0.84, 0.63, 0.42, 0.21, 0],
  /** height of the floor on the centre line, [q, y] */
  floor: [
    [Q_NOSE, 0.17],
    [1.9, 0.168],
    [1.2, 0.15],
    [-1.2, 0.15],
    [-1.9, 0.2],
    [Q_TAIL, 0.245],
  ],
  /** how far the pillars and the glass stand proud of the straight line between their edges: A-pillar, cant rail, C-pillar, [z, m] */
  pillarFull: [
    [0.7, 0.012],
    [0.1, 0.012],
    [-0.2, 0.004],
    [-1.0, 0.004],
    [-1.3, 0.01],
    [-1.9, 0.012],
  ],
  glassFull: 0.004,
};
