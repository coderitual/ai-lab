// The trees that grow here, as numbers: six species and, of each, one or two
// individuals ("variants") that treeGeometry.js grows from these rules. Every
// tree of the forest is one of the variants, scaled to its own height, turned,
// leaned and tinted.
//
// The season is early autumn: most broadleaves are still green (each tree its
// own green), maples and some limes have turned and stand in groups (most of
// them round the start), birches are yellowing, larches are still green-gold,
// spruce and fir are dark. A tree's colour is its species' `green` tint mixed
// towards one of its `autumn` tints by how far it has turned (forest.js asks
// the place how much of the wood has turned; `turns` is how readily this
// species follows). The tints multiply the foliage atlas, whose broadleaf
// tiles are painted nearly grey (forestTextures.js).

import { BARK, TILE } from './forestTextures.js';

/** The species, in the order the forest stores them. */
export const SPECIES = ['spruce', 'fir', 'larch', 'birch', 'maple', 'lime', 'hazel', 'hornbeam'];

/**
 * Per species: the height range of grown trees (m); `green` the linear multiplier of the atlas colour in summer
 * leaf; `autumn` the tints a turned tree takes (one per tree, mixed); `turns` how readily it turns (0..1) where the
 * wood has turned; `value` [lo, hi] a tree's own brightness spread; `hue` how far its green strays towards yellow
 * (+) or blue (-); `lean` the largest lean (rad); `through` how much light its foliage lets through (0..1).
 */
export const SPECIES_DATA = {
  spruce: { height: [15, 30], green: [0.52, 0.66, 0.56], autumn: [], turns: 0, value: [0.8, 1.12], hue: 0.15, lean: 0.05, through: 0.3 },
  fir: { height: [13, 25], green: [0.46, 0.61, 0.5], autumn: [], turns: 0, value: [0.82, 1.1], hue: 0.1, lean: 0.04, through: 0.25 },
  larch: { height: [14, 26], green: [0.447, 0.621, 0.38], autumn: [[0.855, 0.779, 0.564]], turns: 0.35, value: [0.85, 1.15], hue: 0.3, lean: 0.07, through: 0.75 },
  birch: { height: [10, 19], green: [0.62, 0.7, 0.24], autumn: [[0.944, 0.851, 0.422], [0.857, 0.737, 0.348]], turns: 0.4, value: [0.88, 1.15], hue: 0.4, lean: 0.13, through: 0.9 },
  maple: { height: [9, 16], green: [0.58, 0.66, 0.22], autumn: [[1.2, 0.38, 0.05], [1.18, 0.48, 0.05], [1.05, 0.24, 0.05], [1.2, 0.42, 0.05], [1.15, 0.5, 0.05]], turns: 1, value: [0.85, 1.12], hue: 0.35, lean: 0.08, through: 1.0 },
  hazel: { height: [1.8, 3.4], green: [0.48, 0.58, 0.19], autumn: [[0.95, 0.42, 0.07], [1.0, 0.55, 0.08]], turns: 0.35, value: [0.8, 1.1], hue: 0.35, lean: 0.12, through: 0.9 },
  hornbeam: { height: [14, 21], green: [0.6, 0.69, 0.23], autumn: [[0.95, 0.8, 0.3]], turns: 0.15, value: [0.85, 1.12], hue: 0.3, lean: 0.1, through: 1.0 },
  lime: { height: [12, 21], green: [0.6, 0.69, 0.23], autumn: [[0.973, 0.819, 0.377], [0.897, 0.656, 0.294]], turns: 0.3, value: [0.85, 1.12], hue: 0.3, lean: 0.06, through: 0.95 },
};

/**
 * The individuals. `frame` is the shape of the pictures the impostor atlas keeps of it (narrow: conifers and
 * birch; wide: the broad crowns).
 *
 * Conifers (kind 'conifer'), all lengths at the template height H:
 *   trunkR radius at the foot · bend how far the trunk wanders (m) · crownBase share of H below the lowest live
 *   branches · whorls, per [lo, hi] branches in each · R the longest branch · power the crown's profile (1: a
 *   cone, less: fuller above) · elevBase, elevTop how a branch leaves the trunk, low and high in the crown (rad
 *   above the horizontal) · sag, upturn how it then hangs and lifts its tip (shares of its length) · frond length
 *   of a side frond · curtain how far the twigs hang under a low bough (m; 0: none) · dead dead stubs under the
 *   crown · gaps share of branches missing · lop how lopsided the crown is.
 *
 * Broadleaves (kind 'broadleaf'; `tile` the sprig tile of its leaves and `subs` which quarters of it, `massTile` the
 * leaf mass of its inside, `hang`: its leaves hang in sprays from a HANG tile):
 *   trunkR, bend as above · fork share of H at which the trunk divides · mains main limbs from the fork (stems, when
 *   the fork is near the ground) · leader true where the trunk carries on up the middle · rise how steeply the main
 *   limbs leave (0: straight to their lobes, 1: up first) · divide how far along the way to their lobes they divide ·
 *   crown: cy, ry (shares of H) and rx (m): the outline the lobes are arranged in · lobes: rings [count, angle from
 *   the top (rad), place as a share of the outline's radius], r [lo, hi] a lobe's radius as a share of rx, core the
 *   same for the dark middle of the crown (0: none) · cards leaf cards · leaf [lo, hi] edge of one (m) · under share
 *   of the cards kept on the underside of a lobe · flat how much the cards face the sky · fill big cards of leaf mass
 *   inside each lobe · twigs per lobe · floor how far below its middle the crown ends (share of ry) · barkTone how
 *   pale the bark is (0.5: as painted)
 */
export const VARIANTS = [
  {
    name: 'spruce-a',
    species: 'spruce',
    kind: 'conifer',
    frame: 'narrow',
    tile: TILE.SPRUCE,
    hangTile: TILE.SPRUCE_HANG,
    bark: BARK.SPRUCE,
    // a tree of the forest's edge: branched nearly to the ground, long sweeping boughs
    P: { H: 22, trunkR: 0.31, bend: 0.2, crownBase: 0.13, whorls: 19, per: [4, 6], R: 3.4, power: 0.92, elevBase: -0.3, elevTop: 0.7, sag: 0.4, upturn: 0.24, frond: 1.0, curtain: 0.8, dead: 4, gaps: 0.08, lop: 0.15 },
  },
  {
    name: 'spruce-b',
    species: 'spruce',
    kind: 'conifer',
    frame: 'narrow',
    tile: TILE.SPRUCE,
    hangTile: TILE.SPRUCE_HANG,
    bark: BARK.SPRUCE,
    // one grown up inside the wood: a tall bare bole with dead stubs, a shorter, gappy, lopsided crown
    P: { H: 24, trunkR: 0.3, bend: 0.3, crownBase: 0.4, whorls: 15, per: [4, 5], R: 2.8, power: 0.85, elevBase: -0.42, elevTop: 0.65, sag: 0.52, upturn: 0.26, frond: 0.95, curtain: 0.95, dead: 12, gaps: 0.17, lop: 0.34 },
  },
  {
    name: 'fir-a',
    species: 'fir',
    kind: 'conifer',
    frame: 'narrow',
    tile: TILE.FIR,
    hangTile: -1,
    bark: BARK.SPRUCE,
    // a narrow, regular spire of level tiers
    P: { H: 20, trunkR: 0.27, bend: 0.1, crownBase: 0.15, whorls: 21, per: [5, 6], R: 2.5, power: 0.62, elevBase: -0.06, elevTop: 0.5, sag: 0.13, upturn: 0.05, frond: 0.82, curtain: 0, dead: 4, gaps: 0.03, lop: 0.08 },
  },
  {
    name: 'larch-a',
    species: 'larch',
    kind: 'conifer',
    frame: 'narrow',
    tile: TILE.LARCH,
    hangTile: -1,
    bark: BARK.LARCH,
    // open and irregular: few, thin, drooping branches with upturned ends; one can see through it
    P: { H: 20, trunkR: 0.25, bend: 0.34, crownBase: 0.26, whorls: 13, per: [3, 5], R: 3.1, power: 0.8, elevBase: -0.2, elevTop: 0.6, sag: 0.56, upturn: 0.36, frond: 1.05, curtain: 0, dead: 6, gaps: 0.2, lop: 0.3, droopFronds: 1 },
  },
  {
    name: 'birch-a',
    species: 'birch',
    kind: 'broadleaf',
    frame: 'narrow',
    tile: TILE.BIRCH,
    hang: true,
    massTile: TILE.LIME_MASS,
    bark: BARK.BIRCH,
    // a slim white stem carried to the top, the leaves hanging in sprays from small masses up along it
    P: {
      H: 16,
      trunkR: 0.15,
      bend: 0.5,
      fork: 0.3,
      mains: 3,
      leader: true,
      rise: 0.3,
      crown: { cy: 0.64, ry: 0.36, rx: 2.7 },
      lobes: { rings: [[1, 0, 0.6], [3, 0.7, 0.55], [4, 1.3, 0.6], [4, 1.85, 0.6], [3, 2.3, 0.5]], r: [0.36, 0.46], core: 0 },
      cards: 400,
      leaf: [1.0, 1.4],
      under: 0.85,
      flat: 0,
      fill: 1,
      twigs: 2,
      floor: 1.0,
    },
  },
  {
    name: 'maple-a',
    species: 'maple',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.MAPLE,
    massTile: TILE.MAPLE_MASS,
    bark: BARK.BROADLEAF,
    // a broad round crown of billowing masses on a short trunk that divides into a few strong rising limbs
    P: {
      H: 14,
      trunkR: 0.26,
      bend: 0.3,
      fork: 0.24,
      mains: 4,
      leader: true,
      rise: 0.6,
      crown: { cy: 0.58, ry: 0.4, rx: 4.9 },
      lobes: { rings: [[1, 0, 0.62], [5, 0.8, 0.64], [7, 1.45, 0.7], [5, 2.1, 0.6]], r: [0.36, 0.44], core: 0.5 },
      cards: 1800,
      leaf: [0.85, 1.05],
      under: 0.5,
      flat: 0.2,
      fill: 2,
      twigs: 2,
      floor: 0.95,
      barkTone: 0.62,
    },
  },
  {
    name: 'maple-b',
    species: 'maple',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.MAPLE,
    massTile: TILE.MAPLE_MASS,
    bark: BARK.BROADLEAF,
    // an older one: stems from low down, a wider, flatter crown
    P: {
      H: 14,
      trunkR: 0.3,
      bend: 0.4,
      fork: 0.16,
      mains: 3,
      leader: false,
      rise: 0.7,
      crown: { cy: 0.6, ry: 0.36, rx: 5.6 },
      lobes: { rings: [[2, 0.3, 0.6], [6, 0.95, 0.68], [8, 1.55, 0.72], [5, 2.15, 0.6]], r: [0.33, 0.42], core: 0.48 },
      cards: 1900,
      leaf: [0.85, 1.1],
      under: 0.5,
      flat: 0.2,
      fill: 2,
      twigs: 2,
      floor: 0.95,
      barkTone: 0.62,
    },
  },
  {
    name: 'lime-a',
    species: 'lime',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.LIME,
    subs: [0, 1],
    massTile: TILE.LIME_MASS,
    bark: BARK.BROADLEAF,
    // an avenue tree: a clear stem, a leader most of the way up, a tall dense dome
    P: {
      H: 18,
      trunkR: 0.34,
      bend: 0.2,
      fork: 0.25,
      mains: 4,
      leader: true,
      rise: 0.5,
      crown: { cy: 0.62, ry: 0.37, rx: 4.4 },
      lobes: { rings: [[1, 0, 0.64], [4, 0.6, 0.62], [6, 1.1, 0.66], [7, 1.6, 0.7], [6, 2.1, 0.64]], r: [0.36, 0.44], core: 0.55 },
      cards: 1800,
      leaf: [0.85, 1.05],
      under: 0.4,
      flat: 0.15,
      fill: 2,
      twigs: 2,
      floor: 0.95,
    },
  },
  {
    name: 'hornbeam-a',
    species: 'hornbeam',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.LIME,
    subs: [2, 3],
    massTile: TILE.LIME_MASS,
    bark: BARK.BROADLEAF,
    // a tall tree of the bank: pale stems that part near the ground and rise far before they divide, an open crown of
    // separate airy masses of small leaves that reaches out over whatever lies below
    P: {
      H: 17,
      trunkR: 0.3,
      bend: 0.3,
      fork: 0.07,
      mains: 4,
      leader: false,
      rise: 0.85,
      divide: 0.62,
      gnarl: 0.035,
      crown: { cy: 0.66, ry: 0.33, rx: 5.4 },
      lobes: { rings: [[2, 0.35, 0.66], [5, 1.0, 0.74], [5, 1.6, 0.8]], r: [0.3, 0.4], core: 0 },
      cards: 1300,
      leaf: [0.85, 1.1],
      under: 0.75,
      flat: 0.1,
      fill: 1,
      twigs: 4,
      floor: 1.1,
      barkTone: 0.85,
    },
  },
  {
    name: 'hazel-a',
    species: 'hazel',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.LIME,
    subs: [0, 1],
    massTile: TILE.LIME_MASS,
    bark: BARK.BROADLEAF,
    // the undergrowth at the wood's edge: a shrub of several stems from the ground, leafy to the ground
    P: {
      H: 4,
      trunkR: 0.07,
      bend: 0.15,
      fork: 0.04,
      mains: 5,
      leader: false,
      rise: 0.6,
      crown: { cy: 0.52, ry: 0.5, rx: 2.2 },
      lobes: { rings: [[1, 0, 0.45], [5, 1.15, 0.6]], r: [0.4, 0.52], core: 0 },
      cards: 170,
      leaf: [0.7, 0.9],
      under: 0.6,
      flat: 0.1,
      fill: 1,
      twigs: 1,
      floor: 1.2,
    },
  },
];

/** Which variants each species has, as indices into VARIANTS. */
export const VARIANTS_OF = SPECIES.map((name) => VARIANTS.map((v, i) => (v.species === name ? i : -1)).filter((i) => i >= 0));
