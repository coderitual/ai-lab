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
export const SPECIES = ['spruce', 'fir', 'larch', 'birch', 'maple', 'lime'];

/**
 * Per species: the height range of grown trees (m); `green` the linear multiplier of the atlas colour in summer
 * leaf; `autumn` the tints a turned tree takes (one per tree, mixed); `turns` how readily it turns (0..1) where the
 * wood has turned; `value` [lo, hi] a tree's own brightness spread; `hue` how far its green strays towards yellow
 * (+) or blue (-); `lean` the largest lean (rad); `through` how much light its foliage lets through (0..1).
 */
export const SPECIES_DATA = {
  spruce: { height: [15, 30], green: [0.36, 0.5, 0.42], autumn: [], turns: 0, value: [0.8, 1.12], hue: 0.15, lean: 0.05, through: 0.3 },
  fir: { height: [13, 25], green: [0.3, 0.46, 0.36], autumn: [], turns: 0, value: [0.82, 1.1], hue: 0.1, lean: 0.04, through: 0.25 },
  larch: { height: [14, 26], green: [0.4, 0.66, 0.3], autumn: [[0.95, 0.78, 0.3]], turns: 0.35, value: [0.85, 1.15], hue: 0.3, lean: 0.07, through: 0.75 },
  birch: { height: [10, 19], green: [0.42, 0.66, 0.16], autumn: [[1.0, 0.86, 0.22], [0.92, 0.74, 0.16]], turns: 0.55, value: [0.88, 1.15], hue: 0.4, lean: 0.13, through: 0.9 },
  maple: { height: [9, 16], green: [0.34, 0.6, 0.12], autumn: [[1.1, 0.42, 0.06], [1.05, 0.62, 0.08], [0.95, 0.2, 0.06], [1.05, 0.8, 0.14]], turns: 1, value: [0.85, 1.12], hue: 0.35, lean: 0.08, through: 1.0 },
  lime: { height: [12, 21], green: [0.36, 0.62, 0.14], autumn: [[1.05, 0.82, 0.16], [1.0, 0.64, 0.1]], turns: 0.45, value: [0.85, 1.12], hue: 0.3, lean: 0.06, through: 0.95 },
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
 * Broadleaves (kind 'broadleaf'):
 *   trunkR, bend as above · fork share of H at which the trunk first divides · crown: cy, ry (shares of H) and rx
 *   (m): the ellipsoid no limb leaves · levels of forking after the trunk · forks children per level · leader
 *   chance per level that one child carries straight on · spread angle of the others (rad) · ratio child length
 *   over parent · up how limbs of each level turn towards the light · gnarl how much they wander · clusters leaf
 *   cards on a last limb · leaf [lo, hi] size of one (m) · hang true where the leaves hang in sprays (birch).
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
    bark: BARK.BIRCH,
    // a slim white stem carried to the top, thin rising branches, the leaves hanging from them in sprays
    P: {
      H: 16,
      trunkR: 0.15,
      bend: 0.55,
      fork: 0.34,
      crown: { cy: 0.66, ry: 0.36, rx: 2.9 },
      levels: 3,
      forks: [3, 3, 2],
      leader: [1, 1, 0.9],
      spread: [0.85, 0.8, 0.7],
      ratio: [0.74, 0.72, 0.7],
      side: 0.42,
      up: [0, 0.1, -0.05, -0.25],
      gnarl: 0.16,
      shoots: [3, 3, 2],
      clusters: 9,
      clump: 0.9,
      leaf: [0.9, 1.4],
      hang: true,
    },
  },
  {
    name: 'maple-a',
    species: 'maple',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.MAPLE,
    bark: BARK.BROADLEAF,
    // a round crown on a short trunk that divides into a few strong rising limbs
    P: {
      H: 13,
      trunkR: 0.27,
      bend: 0.25,
      fork: 0.22,
      crown: { cy: 0.62, ry: 0.385, rx: 4.9 },
      levels: 3,
      forks: [4, 3, 3],
      leader: [1, 0.4, 0.3],
      spread: [0.62, 0.7, 0.75],
      ratio: [1.45, 0.6, 0.62],
      side: 1,
      up: [0, 0.18, 0.1, 0.05],
      gnarl: 0.2,
      shoots: [0, 3, 2],
      clusters: 9,
      clump: 1.15,
      leaf: [0.8, 1.15],
      hang: false,
    },
  },
  {
    name: 'maple-b',
    species: 'maple',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.MAPLE,
    bark: BARK.BROADLEAF,
    // an older one: twin stems from low down, a wider, flatter, more open crown
    P: {
      H: 14,
      trunkR: 0.31,
      bend: 0.4,
      fork: 0.15,
      crown: { cy: 0.6, ry: 0.4, rx: 5.6 },
      levels: 3,
      forks: [2, 3, 3],
      leader: [0, 0.4, 0.3],
      spread: [0.45, 0.75, 0.8],
      ratio: [2.6, 0.58, 0.62],
      side: 1,
      up: [0, 0.1, 0.08, 0.03],
      gnarl: 0.26,
      shoots: [0, 4, 2],
      clusters: 10,
      clump: 1.25,
      leaf: [0.8, 1.2],
      hang: false,
    },
  },
  {
    name: 'lime-a',
    species: 'lime',
    kind: 'broadleaf',
    frame: 'wide',
    tile: TILE.LIME,
    bark: BARK.BROADLEAF,
    // an avenue tree: a clear stem, a leader most of the way up, a tall dense dome
    P: {
      H: 18,
      trunkR: 0.34,
      bend: 0.2,
      fork: 0.27,
      crown: { cy: 0.63, ry: 0.385, rx: 4.5 },
      levels: 3,
      forks: [4, 3, 3],
      leader: [1, 0.8, 0.4],
      spread: [1.0, 0.8, 0.75],
      ratio: [1.05, 0.72, 0.66],
      side: 1,
      up: [0, 0.2, 0.14, 0.08],
      gnarl: 0.15,
      shoots: [0, 3, 3],
      clusters: 9,
      clump: 1.3,
      leaf: [0.8, 1.1],
      hang: false,
    },
  },
];

/** Which variants each species has, as indices into VARIANTS. */
export const VARIANTS_OF = SPECIES.map((name) => VARIANTS.map((v, i) => (v.species === name ? i : -1)).filter((i) => i >= 0));
