// Where the town stands: the plan of the lakeside resort the lap starts in,
// worked out from the Track alone (pure: no meshes, no terrain, usable in Node).
//
// The lakeside straight is the town's main street. The Track's corridor there
// is wide (the solid edges lie 11 to 16 m from the centre line), so the street
// reads as a boulevard: the carriageway, a paved forecourt on each side that
// is still corridor (a car can run onto it, nothing stands on it), and then,
// exactly on the solid edge, something a driver can see: a granite kerb with
// bollards on the land side, the guard rail on the lake side, a parapet wall
// round the outside of the first bend. Everything built stands beyond those
// lines:
//   land side   a kerb zone (bollards, lamps, palms in pits, parked cars in
//               bays), a pavement, and the street front: houses of 2 to 6
//               floors, a hotel with an arcade beside the grid, a cafe
//               pavilion on a small piazza, a church with its tower, side
//               streets, and more houses on the slope behind;
//   lake side   a promenade on a quay wall with a balustrade, palms, lamps
//               and benches, the water beyond;
//   the bend    a parapet with the lake's cove behind it and a grand hotel
//               on a terrace over the water, which closes the view down the
//               straight.
//
// Distances along the road are SIGNED here: s counted from the start line,
// negative before it (the run-up is the end of the lap). `beyond` always means
// metres beyond the solid edge, away from the road.
//
// The rules that make the street front varied are few: a house never shares
// its colour, height or roof with its neighbour; ground floors alternate
// between shops, arcades and plain; age and material go with the style. The
// landmarks are placed by hand, because the picture is composed round them.

/** The Track's EDGE values (the world never imports from game/). */
const EDGE_RAIL = 0;
const EDGE_WALL = 2;
const SURFACE_ASPHALT = 0;

/** The town's street: signed s of its two ends (the paved forecourts, the kerbs, the pavements). */
export const STREET = { from: -110, to: 312 };
/** The promenade on the lake side (it ends where the guard rail ends, at the bend). */
export const PROMENADE = { from: -86, width: 7.2 };
/** The parapet round the outside of the first bend, to the grand hotel's terrace and a little past it. */
export const PARAPET = { to: 348 };
/** Beyond the land-side edge the ground is kept level this far (m) before the hill rises (the terrain builds it). */
export const SITE_DEPTH = 78;

/**
 * The street front on the land side, in driving order: [from, to (signed s), kind, floors, roof, ground floor, flags].
 * Gaps between entries are side streets, the piazza and the church's parvis.
 */
const FRONT = [
  [-104, -90, 'house', 3, 'hip', 'plain', { villa: 1 }],
  [-90, -77, 'house', 4, 'gable', 'shops', { park: 1 }],
  [-77, -66, 'house', 3, 'gable', 'shops', { park: 1 }],
  // side street A
  [-58, -43, 'house', 5, 'hip', 'shops', { awnings: 1 }],
  [-43, -11, 'hotel', 6, 'mansard', 'arcade', { balconies: 1 }],
  [-11, 8, 'house', 4, 'gable', 'shops', { awnings: 1 }],
  [8, 21, 'house', 5, 'flat', 'shops', {}],
  // side street B
  [29, 45, 'house', 3, 'flat', 'shops', { park: 1, modern: 1 }],
  [45, 57, 'house', 4, 'gable', 'plain', { park: 1 }],
  // the piazza with the cafe pavilion
  [91, 105, 'house', 5, 'hip', 'arcade', { palazzo: 1 }],
  // side street C
  [113, 127, 'house', 4, 'gable', 'shops', { park: 1, awnings: 1 }],
  [127, 139, 'house', 3, 'gable', 'plain', { park: 1 }],
  // the church
  [171, 186, 'house', 4, 'hip', 'arcade', {}],
  [186, 199, 'house', 5, 'gable', 'shops', { awnings: 1 }],
  // side street D
  [207, 223, 'house', 3, 'hip', 'plain', { villa: 1 }],
  [223, 237, 'house', 4, 'gable', 'shops', {}],
  [239, 253, 'house', 3, 'gable', 'plain', {}],
  [255, 267, 'house', 3, 'hip', 'plain', {}],
  [275, 289, 'house', 2, 'hip', 'plain', { villa: 1 }],
  [293, 305, 'house', 2, 'gable', 'plain', {}],
];

/** The gaps in the front, for the paving and the furniture: [from, to, kind]. */
const GAPS = [
  [-66, -58, 'street'],
  [21, 29, 'street'],
  [57, 91, 'piazza'],
  [105, 113, 'street'],
  [139, 171, 'parvis'],
  [199, 207, 'street'],
  [267, 275, 'lane'],
];

/** Plaster, stone and brick as the resort has them (linear albedo), with the trim that goes with each. */
const PALETTE = [
  { wall: [0.58, 0.42, 0.25], trim: [0.62, 0.58, 0.5], mat: 0 }, // ochre
  { wall: [0.6, 0.36, 0.3], trim: [0.66, 0.62, 0.56], mat: 0 }, // terracotta pink
  { wall: [0.66, 0.6, 0.48], trim: [0.5, 0.48, 0.44], mat: 0 }, // cream
  { wall: [0.62, 0.52, 0.3], trim: [0.68, 0.66, 0.6], mat: 0 }, // straw yellow
  { wall: [0.42, 0.41, 0.39], trim: [0.56, 0.55, 0.52], mat: 1 }, // grey granite
  { wall: [0.56, 0.4, 0.38], trim: [0.64, 0.6, 0.56], mat: 0 }, // dusty rose
  { wall: [0.43, 0.47, 0.4], trim: [0.62, 0.62, 0.56], mat: 0 }, // sage
  { wall: [0.68, 0.67, 0.63], trim: [0.46, 0.45, 0.43], mat: 0 }, // off-white
  { wall: [0.36, 0.2, 0.15], trim: [0.6, 0.57, 0.5], mat: 2 }, // brick
  { wall: [0.5, 0.46, 0.4], trim: [0.6, 0.58, 0.54], mat: 1 }, // warm sandstone
];
/** Shutters and woodwork. */
const SHUTTERS = [
  [0.07, 0.13, 0.09],
  [0.16, 0.09, 0.05],
  [0.1, 0.12, 0.16],
  [0.3, 0.3, 0.28],
  [0.18, 0.05, 0.04],
];
/** Roofs: clay tiles new and old, slate, sheet metal. */
const ROOFS = [
  [0.3, 0.13, 0.08],
  [0.24, 0.12, 0.08],
  [0.2, 0.14, 0.11],
  [0.11, 0.11, 0.12],
];

/**
 * @typedef {object} Lot one building: a box on a straight front line
 * @property {'house'|'hotel'|'grand'|'church'|'tower'|'pavilion'|'back'} kind
 * @property {number} ax @property {number} az front line, the end met first when driving
 * @property {number} bx @property {number} bz the other end of the front line
 * @property {number} ox @property {number} oz unit vector away from the road (the direction of its depth)
 * @property {number} w @property {number} d width along the front and depth (m)
 * @property {number} s the signed s of its middle, and `beyond`: metres from the solid edge to its front
 * @property {number} floors upper floors (the ground floor not counted)
 * @property {number} groundH @property {number} floorH @property {number} attic wall above the top floor (m)
 * @property {'gable'|'hip'|'flat'|'mansard'|'front'|'spire'} roof `front`: a gable roof whose ridge runs away from the road
 * @property {'plain'|'shops'|'arcade'|'lobby'|'church'|'glass'} ground
 * @property {number} mat 0 plaster, 1 stone, 2 brick @property {number} age 0..1
 * @property {number[]} wall @property {number[]} trim @property {number[]} shutter @property {number[]} roofColor
 * @property {{ w: number, h: number, sill: number, arch: number, shutters: number, surround: number, rail: number }} win
 * @property {number} bay bay width aimed at (m) @property {number} margin wall left blank at each end (m)
 * @property {number} seed @property {object} flags
 * @property {boolean} openA @property {boolean} openB whether the end wall at A / B is free (a gap) and has windows
 */

/** s brought into (-length / 2, length / 2]: negative before the start line. */
export function signed(track, s) {
  const w = track.wrap(s);
  return w > track.length / 2 ? w - track.length : w;
}

/**
 * The plan. `rng` only varies what a rule leaves open (a seed per house, a bay width, the age): the lots
 * themselves are where the table above puts them.
 * @param {object} track the Track
 * @param {import('../../engine/rng.js').Rng} rng
 */
export function townPlan(track, rng) {
  const p = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  /** A point of the map at signed s and lat (metres left of the centre line). */
  const at = (sg, lat) => {
    track.pointAt(track.wrap(sg), lat, p);
    return { x: p.x, z: p.z };
  };
  const frame = {};
  /** The road's level direction at signed s. */
  const heading = (sg) => {
    track.frameAt(track.wrap(sg), frame);
    const l = Math.hypot(frame.tan.x, frame.tan.z);
    return { x: frame.tan.x / l, z: frame.tan.z / l };
  };
  const edge = (sg, side) => track.edgeAt(track.wrap(sg), side);
  /** The widest the corridor gets on a side over a span. */
  const widest = (a, b, side) => {
    let e = 0;
    for (let s = a; s <= b + 1e-6; s += 1) e = Math.max(e, edge(Math.min(s, b), side));
    return e;
  };

  // ---- the street front
  const styleRng = rng.fork('style');
  /** @type {Lot[]} */
  const lots = [];
  let last = { palette: -1, roofColor: -1, shutter: -1 };
  const box = (a, b, side, beyond, depth) => {
    const E = widest(a, b, side);
    const lat = side * (E + beyond);
    const A = at(a, lat);
    const B = at(b, lat);
    const w = Math.hypot(B.x - A.x, B.z - A.z);
    const tx = (B.x - A.x) / w;
    const tz = (B.z - A.z) / w;
    // away from the road: to the right of travel on the land side, to the left on the lake side
    const ox = side < 0 ? -tz : tz;
    const oz = side < 0 ? tx : -tx;
    return { ax: A.x, az: A.z, bx: B.x, bz: B.z, ox, oz, w, d: depth, s: (a + b) / 2, a, b, side, beyond, edge: E };
  };
  FRONT.forEach(([a, b, kind, floors, roof, ground, flags], index) => {
    const r = styleRng.fork(`lot${index}`);
    let palette = r.int(PALETTE.length);
    while (palette === last.palette || (flags.palazzo && PALETTE[palette].mat !== 1) || (flags.modern && palette !== 7)) palette = (palette + 1) % PALETTE.length;
    if (kind === 'hotel') palette = 2;
    let roofColor = r.int(3);
    if (roofColor === last.roofColor) roofColor = (roofColor + 1) % 3;
    if (roof === 'mansard') roofColor = 3;
    let shutter = r.int(SHUTTERS.length);
    if (shutter === last.shutter) shutter = (shutter + 1) % SHUTTERS.length;
    last = { palette, roofColor, shutter };
    const look = PALETTE[palette];
    const grand = kind === 'hotel' || flags.palazzo;
    const beyond = flags.park ? 6.0 : kind === 'hotel' ? 3.9 : 3.5 + r.range(0, 0.9);
    const depth = kind === 'hotel' ? 15 : r.range(10.5, 13.5);
    const lot = box(a, b, -1, beyond, depth);
    // window styles go with the house: tall arched ones on the grand houses, shuttered ones on the old plaster
    // houses, wide plain ones on the one modern block
    const win = flags.modern
      ? { w: 1.9, h: 1.45, sill: 0.95, arch: 0, shutters: 0, surround: 0, rail: 0 }
      : kind === 'hotel'
        ? { w: 1.25, h: 2.3, sill: 0.12, arch: 0, shutters: 0, surround: 1, rail: 0 }
        : flags.palazzo
          ? { w: 1.15, h: 2.05, sill: 0.75, arch: 1, shutters: 0, surround: 1, rail: 0 }
          : flags.villa
            ? { w: 1.1, h: 1.75, sill: 0.85, arch: r.next() < 0.5 ? 1 : 0, shutters: 1, surround: 1, rail: 0 }
            : { w: r.range(0.95, 1.1), h: r.range(1.5, 1.7), sill: 0.92, arch: 0, shutters: r.next() < 0.75 ? 1 : 0, surround: r.next() < 0.6 ? 1 : 0, rail: r.next() < 0.25 ? 1 : 0 };
    Object.assign(lot, {
      kind,
      floors,
      groundH: ground === 'plain' ? r.range(3.3, 3.7) : grand ? 4.9 : r.range(4.0, 4.5),
      floorH: grand ? 3.35 : flags.modern ? 2.95 : r.range(3.0, 3.3),
      attic: roof === 'flat' ? 1.0 : r.range(0.35, 0.8),
      roof,
      ground,
      mat: look.mat,
      age: flags.modern ? 0.25 : grand ? 0.35 : r.range(0.25, 0.95),
      wall: look.wall,
      trim: look.trim,
      shutter: SHUTTERS[shutter],
      roofColor: ROOFS[roofColor],
      win,
      bay: flags.modern ? 3.4 : kind === 'hotel' ? 3.2 : r.range(2.7, 3.3),
      margin: r.range(0.5, 0.9),
      seed: 17 + index * 7 + r.int(5),
      flags,
      pitch: r.range(0.42, 0.56),
    });
    lots.push(lot);
  });
  // an end wall is free where the next lot does not touch it
  lots.forEach((lot, i) => {
    lot.openA = i === 0 || lots[i - 1].b < lot.a - 0.5;
    lot.openB = i === lots.length - 1 || lots[i + 1].a > lot.b + 0.5;
  });

  // ---- the landmarks beyond the plain houses
  const special = styleRng.fork('special');
  // the cafe pavilion on the piazza: a glazed box under a wide flat canopy whose edge is lit
  const pavilion = Object.assign(box(66, 80, -1, 9.5, 7), {
    kind: 'pavilion', floors: 0, groundH: 3.5, floorH: 3, attic: 0.1, roof: 'flat', ground: 'glass', mat: 0, age: 0.1,
    wall: [0.5, 0.5, 0.48], trim: [0.2, 0.2, 0.2], shutter: SHUTTERS[3], roofColor: ROOFS[3],
    win: { w: 1.6, h: 1.4, sill: 0.9, arch: 0, shutters: 0, surround: 0, rail: 0 }, bay: 2.8, margin: 0.25, seed: 211, flags: {}, pitch: 0.4,
    openA: true, openB: true,
  });
  // the church: its tower on the street, the nave end-on behind a small parvis
  const tower = Object.assign(box(139.5, 146, -1, 2.9, 6.5), {
    kind: 'tower', floors: 5, groundH: 5.2, floorH: 4.3, attic: 0.5, roof: 'spire', ground: 'plain', mat: 1, age: 0.7,
    wall: [0.47, 0.44, 0.39], trim: [0.58, 0.56, 0.5], shutter: SHUTTERS[1], roofColor: ROOFS[1],
    win: { w: 0.7, h: 1.9, sill: 1.2, arch: 1, shutters: 0, surround: 0, rail: 0 }, bay: 6, margin: 0.9, seed: 301, flags: { tower: 1 }, pitch: 1.2,
    openA: true, openB: true,
  });
  const church = Object.assign(box(149, 165, -1, 9.5, 26), {
    kind: 'church', floors: 1, groundH: 6.4, floorH: 5.2, attic: 0.4, roof: 'front', ground: 'church', mat: 0, age: 0.6,
    wall: [0.63, 0.57, 0.46], trim: [0.55, 0.52, 0.46], shutter: SHUTTERS[1], roofColor: ROOFS[1],
    win: { w: 1.3, h: 3.3, sill: 1.1, arch: 1, shutters: 0, surround: 1, rail: 0 }, bay: 5.2, margin: 1.2, seed: 302, flags: {}, pitch: 0.62,
    openA: true, openB: true,
  });
  // the grand hotel at the head of the cove: it stands square to the straight, which looks at its long front
  const grandX = 338;
  const grand = {
    ax: grandX, az: 9, bx: grandX, bz: -37, ox: 1, oz: 0, w: 46, d: 17, s: 322, a: 300, b: 344, side: 1, beyond: 12, edge: 0,
    kind: 'grand', floors: 6, groundH: 5.0, floorH: 3.4, attic: 0.6, roof: 'mansard', ground: 'lobby', mat: 0, age: 0.3,
    wall: [0.7, 0.66, 0.56], trim: [0.56, 0.54, 0.5], shutter: SHUTTERS[0], roofColor: ROOFS[3],
    win: { w: 1.3, h: 2.3, sill: 0.12, arch: 0, shutters: 0, surround: 1, rail: 0 }, bay: 3.3, margin: 1.0, seed: 401,
    flags: { balconies: 1, terrace: 1 }, pitch: 0.5, openA: true, openB: true,
  };
  lots.push(pavilion, tower, church, grand);

  // ---- more of the town on the slope behind: plain houses, seen through the gaps and over the low roofs
  const backRng = rng.fork('back');
  const back = [];
  const BACK = [
    // [signed s of the middle, metres beyond the edge to the front, floors]
    [-62, 22, 3], [25, 22, 3], [64, 30, 3], [84, 33, 4], [109, 22, 3], [203, 22, 3], [271, 20, 2],
    [-88, 33, 2], [-34, 34, 3], [-6, 37, 2], [44, 36, 3], [128, 35, 3], [158, 44, 2], [186, 35, 3], [232, 33, 2],
    [-58, 52, 3], [-14, 55, 2], [24, 58, 3], [70, 56, 2], [104, 59, 3], [142, 62, 2], [178, 57, 3], [214, 55, 2], [252, 50, 2],
  ];
  BACK.forEach(([s, beyond, floors], index) => {
    const r = backRng.fork(`b${index}`);
    const w = r.range(10, 15);
    const palette = (index * 3 + r.int(2)) % PALETTE.length;
    const look = PALETTE[palette];
    const roof = r.next() < 0.5 ? 'hip' : 'gable';
    back.push(
      Object.assign(box(s - w / 2, s + w / 2, -1, beyond, r.range(9, 11.5)), {
        kind: 'back', floors, groundH: r.range(3.0, 3.4), floorH: r.range(2.9, 3.2), attic: r.range(0.3, 0.7), roof, ground: 'plain',
        mat: look.mat === 2 ? 0 : look.mat, age: r.range(0.3, 0.9), wall: look.wall, trim: look.trim, shutter: SHUTTERS[r.int(SHUTTERS.length)],
        roofColor: ROOFS[r.int(3)], win: { w: 1.0, h: 1.55, sill: 0.92, arch: 0, shutters: r.next() < 0.7 ? 1 : 0, surround: 0, rail: 0 },
        bay: r.range(2.8, 3.4), margin: r.range(0.6, 1.0), seed: 500 + index * 3, flags: {}, pitch: r.range(0.42, 0.55), openA: true, openB: true,
      }),
    );
  });

  // ---- the solid edge made visible, and what stands in the kerb zone
  const inGap = (sg) => GAPS.find(([a, b]) => sg >= a && sg <= b) ?? null;
  const lotAt = (sg) => lots.find((l) => l.side === -1 && l.kind !== 'pavilion' && l.kind !== 'church' && sg >= l.a && sg <= l.b) ?? null;
  /** Metres from the land-side edge to the back of the paving at signed s (the house front, or the depth of a gap). */
  const pavingDepth = (sg) => {
    const gap = inGap(sg);
    if (gap) return gap[2] === 'piazza' ? 19 : gap[2] === 'parvis' ? 9.6 : gap[2] === 'lane' ? 14 : 24;
    const lot = lotAt(sg);
    if (lot) return lot.edge + lot.beyond - edge(sg, -1);
    return 3.2;
  };

  // bollards with a chain along the kerb, except where cars are parked behind it (they are the barrier there)
  const bollards = [];
  const parkedBays = [];
  for (const lot of lots) if (lot.flags.park) parkedBays.push([lot.a + 0.6, lot.b - 0.6]);
  const inBay = (sg) => parkedBays.some(([a, b]) => sg > a && sg < b);
  for (let sg = STREET.from + 1.25; sg < STREET.to; sg += 2.5) bollards.push({ s: sg, chain: !inBay(sg) && !inBay(sg + 2.5), post: !inBay(sg) });

  // parked cars: in the bays (two thirds of the places taken), on the piazza, one in each side street
  const carRng = rng.fork('cars');
  const cars = [];
  for (const [a, b] of parkedBays) {
    for (let sg = a + 2.9; sg < b - 2.4; sg += 5.6) {
      if (carRng.next() < 0.3) continue;
      cars.push({ s: sg + carRng.range(-0.3, 0.3), beyond: 1.55 + carRng.range(-0.08, 0.08), turn: carRng.range(-0.03, 0.03) + (carRng.next() < 0.2 ? Math.PI : 0), model: carRng.int(3), paint: carRng.int(8) });
    }
  }
  for (const [sg, beyond, turn] of [[59.8, 7.5, 1.57], [59.9, 10.4, 1.6], [60.1, 13.2, -1.55], [87.9, 12.6, -1.57], [88.2, 15.6, 1.6], [-63.4, 9, 1.57], [23.6, 10.5, -1.57], [107.6, 8.5, 1.57], [201.6, 11, -1.57], [152.5, 5.6, 0.02], [158.4, 5.5, 3.12]]) {
    cars.push({ s: sg, beyond, turn, model: carRng.int(3), paint: carRng.int(8) });
  }

  // palms and trees. Lake side: a row along the promenade, every fifth place a pair of cypresses or a pollarded
  // plane; land side: a palm at each corner of a gap, where it hides no house front
  const treeRng = rng.fork('trees');
  const trees = [];
  {
    let k = 0;
    for (let sg = PROMENADE.from + 5; sg < 228; sg += 12.4, k++) {
      const kind = k % 5 === 2 ? 'cypress' : k % 5 === 4 ? 'plane' : 'palm';
      if (kind === 'cypress') {
        trees.push({ kind, s: sg - 1.4, side: 1, beyond: 2.5, h: treeRng.range(9, 12), seed: treeRng.int(1e6) });
        trees.push({ kind, s: sg + 1.5, side: 1, beyond: 2.9, h: treeRng.range(7.5, 10), seed: treeRng.int(1e6) });
      } else trees.push({ kind, s: sg + treeRng.range(-0.8, 0.8), side: 1, beyond: 2.7 + treeRng.range(-0.2, 0.2), h: kind === 'palm' ? treeRng.range(8.5, 13.5) : treeRng.range(5.5, 6.5), seed: treeRng.int(1e6) });
    }
    for (const sg of [-62, 25, 59.5, 88.5, 109, 147.5, 167, 203, 271]) trees.push({ kind: 'palm', s: sg, side: -1, beyond: 1.3, h: treeRng.range(8, 11.5), seed: treeRng.int(1e6) });
    // on the cove's bank behind the parapet and on the grand hotel's terrace
    for (const [sg, beyond] of [[246, 3.2], [263, 4.4], [281, 4.0], [297, 5.5]]) trees.push({ kind: 'palm', s: sg, side: 1, beyond, h: treeRng.range(9, 13), seed: treeRng.int(1e6) });
    for (const [x, z] of [[grandX - 4.5, 12.5], [grandX - 4.5, -8], [grandX - 4.5, -24], [grandX - 4.5, -40.5]]) trees.push({ kind: 'palm', x, z, h: treeRng.range(9.5, 12.5), seed: treeRng.int(1e6) });
    for (const [x, z] of [[grandX + 20, 13], [grandX + 23, 9]]) trees.push({ kind: 'cypress', x, z, h: treeRng.range(10, 13), seed: treeRng.int(1e6) });
  }

  // lamps beyond the corridor (heads and glow only; the Track's own street lamps are lamps.js's): globes along
  // the promenade, lanterns on the house fronts
  const lamps = [];
  for (let sg = PROMENADE.from + 11.2, k = 0; sg < 226; sg += 16.5, k++) lamps.push({ kind: 'globe', s: sg, side: 1, beyond: PROMENADE.width - 0.75, height: 4.3 });
  for (const sg of [240, 258, 276, 294]) lamps.push({ kind: 'globe', s: sg, side: 1, beyond: 0.2, height: 4.3, onWall: true });
  for (const lot of lots) {
    if (lot.kind !== 'house' && lot.kind !== 'hotel') continue;
    const n = lot.w > 24 ? 4 : lot.w > 12.5 ? 2 : 1;
    for (let k = 0; k < n; k++) lamps.push({ kind: 'lantern', lot, u: n === 1 ? lot.w / 2 : 0.9 + ((lot.w - 1.8) * k) / (n - 1), height: Math.min(lot.groundH - 0.55, 3.7) });
  }

  // signals on mast arms at the side streets: green towards the driver
  const signals = [-59.2, 106.2, 200.4].map((sg) => ({ s: sg, side: -1, beyond: 0.55, reach: edge(sg, -1) - 1.6, height: 6.1 }));

  // what stands on the pavements and the promenade
  const furniture = [];
  const put = (kind, sg, side, beyond, turn = 0) => furniture.push({ kind, s: sg, side, beyond, turn });
  for (let sg = PROMENADE.from + 11.2, k = 0; sg < 226; sg += 16.5, k++) {
    put('bench', sg + 3.1, 1, PROMENADE.width - 1.25, 0);
    if (k % 2 === 0) put('bin', sg - 1.2, 1, PROMENADE.width - 0.9);
    if (k % 3 === 1) put('planter', sg + 8.2, 1, 1.25);
  }
  put('shelter', 36.5, -1, 2.3, Math.PI);
  for (const sg of [62, 70, 78, 86]) put('planter', sg, -1, 0.55);
  put('bench', 63.5, -1, 5.2, Math.PI);
  put('bench', 84.5, -1, 5.2, Math.PI);
  put('bench', 153, -1, 2.2, Math.PI);
  put('bench', 163, -1, 2.2, Math.PI);
  for (const sg of [-88, -47, 3, 33, 93, 121, 176, 212, 243]) put('bin', sg, -1, 0.85);
  put('bikes', -50, -1, 1.2);
  put('bikes', 96.5, -1, 1.2);
  put('bikes', 190, -1, 1.2);
  for (const [a, b, kind] of GAPS) {
    if (kind !== 'street') continue;
    put('tactile', a + 0.8, -1, 0.35);
    put('tactile', b - 0.8, -1, 0.35);
  }
  for (let sg = STREET.from + 9; sg < STREET.to; sg += 23) put('drain', sg, -1, -0.32);

  return { lots, back, gaps: GAPS, bollards, cars, trees, lamps, signals, furniture, pavingDepth, at, heading, edge, grand, pavilion, tower, church };
}

/**
 * The town's footprint as the other builders of the world need it, pure, from the Track:
 *  - `land`: a view of the Track for the terrain, whose hillside beyond the land-side edge is level along the
 *    street (the houses and pavements stand on it; the hill rises behind them);
 *  - `planting`: a view for the forest: no tree rows on the town's edges, and the corridor "ends" SITE_DEPTH
 *    further out there, so nothing is planted on the town;
 *  - `verges`: a view for whatever grows or stands on the verges (grass tufts, bushes, guide posts): the town's
 *    verges are paved and its edges are built;
 *  - `inside(x, z)`: whether a point of the map lies on the town (for anything else that scatters things).
 * The views share everything with the Track but the arrays named here; the physics never sees them.
 * @param {object} track
 */
export function townSite(track) {
  const n = track.count;
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const sOf = (i) => signed(track, i * track.ds);
  // how much each sample belongs to the town, on the land side and on the lake side
  const landShare = (sg) => smooth(STREET.from - 40, STREET.from, sg) * (1 - smooth(STREET.to, STREET.to + 40, sg));
  const onLand = (sg) => sg >= STREET.from - 4 && sg <= STREET.to + 4;
  const onLake = (sg) => sg >= PROMENADE.from - 4 && sg <= PARAPET.to + 4;

  const land = Object.create(track);
  land.farSlopeR = Float32Array.from(track.farSlopeR);
  land.kindR = Uint8Array.from(track.kindR);
  land.kindL = Uint8Array.from(track.kindL);
  const verges = Object.create(track);
  verges.kindR = land.kindR;
  verges.kindL = land.kindL;
  verges.vergeR = Uint8Array.from(track.vergeR);
  verges.vergeL = Uint8Array.from(track.vergeL);
  for (let i = 0; i < n; i++) {
    const sg = sOf(i);
    land.farSlopeR[i] *= 1 - landShare(sg);
    if (onLand(sg)) {
      land.kindR[i] = EDGE_WALL;
      verges.vergeR[i] = SURFACE_ASPHALT;
    }
    if (onLake(sg)) {
      // (the guard rail itself is drawn from the Track, which still says RAIL)
      land.kindL[i] = EDGE_WALL;
      verges.vergeL[i] = SURFACE_ASPHALT;
    }
  }
  const planting = Object.create(verges);
  planting.edgeAt = (s, side) => {
    const sg = signed(track, s);
    const e = track.edgeAt(s, side);
    if (side < 0) return e + SITE_DEPTH * landShare(sg);
    // the promenade, the cove's bank and the grand hotel's terrace
    return e + (onLake(sg) ? (sg > 226 ? 52 * smooth(226, 262, sg) * (1 - smooth(PARAPET.to - 6, PARAPET.to + 4, sg)) + 12 : 12) : 0);
  };
  const spot = { index: -1, s: 0, lat: 0 };
  return {
    land,
    verges,
    planting,
    inside(x, z) {
      track.locate(x, z, -1, spot);
      const side = spot.lat >= 0 ? 1 : -1;
      const beyond = Math.abs(spot.lat) - track.edgeAt(spot.s, side);
      return beyond < planting.edgeAt(spot.s, side) - track.edgeAt(spot.s, side) && (side < 0 ? onLand(signed(track, spot.s)) : onLake(signed(track, spot.s)));
    },
    stretch: { street: STREET, promenade: PROMENADE, parapet: PARAPET },
    railEnd: (() => {
      // the signed s at which the lake side's guard rail gives way to the parapet (the Track's kind changes)
      for (let sg = 180; sg < 300; sg += 1) if (track.kindL[Math.round(track.wrap(sg) / track.ds) % n] !== EDGE_RAIL) return sg;
      return 232;
    })(),
  };
}
