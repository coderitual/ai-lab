// The golden wood: the forest esses in autumn, as numbers (docs/design.md,
// "The golden wood": the reference is a photograph, r3). The road runs between
// two continuous walls of turned broadleaves whose foliage comes down to the
// verge; the verge is pale dry grass under fallen leaves, and long pale grass
// stands at its outer edge.
//
// Nothing here is geometry and nothing here is inside the corridor: the place
// moves no ground at all. It says where it is and what stands there, and the
// others read it:
//   forest.js          which of the lap's own trees give way, and the rows
//                      planted in their place
//   terrain.js         marks the band beside the road (aVerge.w) so that
//   groundMaterial.js  paints the leaf litter and the pale grass
//   groundCover.js     the long pale grass at the verge's edge
//
// It is found from the Track (a named section), never from map coordinates.
//
// Pure numbers and functions: no three.js, no DOM (the unit tests build the
// terrain in Node).

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const GOLDWOOD = {
  /** The Track's section the place is measured from (its start). */
  section: 'esses',
  /**
   * The dressed stretch: metres from the section's start, easing in and out over `ease` m. It ends before the
   * meadow of the tunnel's approach opens (approach.js `open`, 190 m before the face).
   */
  from: -22,
  to: 600,
  ease: 26,
  /** The lap's own trees give way this far beyond each solid edge (m); the mass of the forest stands behind. */
  clear: 38,
  /**
   * The walls. Rows of { off: metres beyond where trees may begin (2 m behind the solid edge), step: metres between
   * trunks, height (m over the ground), r: the room a trunk needs, detail, inside, low: the share kept on the low
   * tier }. Each tree stands `sink` of its height under the ground and is `wide` times as wide as it grew: the
   * foliage begins at the grass and the crowns overlap, so that the trunks are dark lines half hidden in leaves and
   * never bare poles. `gold`: the share that has turned whatever its species.
   */
  rows: [
    { off: [0.2, 1.6], step: [3.4, 4.8], height: [7.5, 10.5], r: 2.3, detail: 1.5, inside: 0.1, low: 1 },
    { off: [3.6, 6.4], step: [3.8, 5.4], height: [10, 14], r: 2.6, detail: 1.2, inside: 0.35, low: 1 },
    { off: [8.5, 12.5], step: [4.4, 6.2], height: [13, 17], r: 3, detail: 1, inside: 0.5, low: 0.7 },
    { off: [15, 21], step: [5, 7], height: [15, 20], r: 3.2, detail: 0.8, inside: 0.6, low: 0.6 },
    { off: [24, 33], step: [5.5, 8], height: [17, 22], r: 3.4, detail: 0.6, inside: 0.65, low: 0.5 },
  ],
  sink: 0.24,
  wide: 1.38,
  gold: 0.86,
  /**
   * What the rows are made of (shares; the rest is maple): limes and birches turn gold, hornbeams a duller yellow,
   * maples orange. From the row `conifers[0]` back, the share `conifers[1]` is a dark spruce or fir instead: accents
   * behind the gold, never a wall of their own.
   */
  mix: { lime: 0.34, birch: 0.22, hornbeam: 0.19 },
  conifers: [3, 0.14],
  /**
   * The stand's own tone over each tree's colour (the photograph's aspens are a deep orange gold, darker and redder
   * than the lap's lemon limes and birches in full sun): for the trees that turn gold, and for the maples.
   */
  tone: { gold: [0.34, 0.165, 0.22], maple: [0.44, 0.46, 0.8] },
  /** A conifer's tone over its green (darker and bluer than the lap's sunlit spruces), and how wide it stands. */
  dark: [0.5, 0.6, 0.7],
  /**
   * The side the day's sun stands on: there no crown may stand higher than the sun's ray that reaches the middle
   * of the road `over` m above it. That wall is low at the barrier and rises away from it at the sun's own angle
   * (16 degrees by day), so the sun comes over it and lies on the asphalt and on the wall across the road, as in
   * the photograph, instead of the whole road lying in the wall's shade. No crown is lower than `least` m; where
   * the hillside itself stands within `hill` m of that ray it shades the road with or without trees, and the rule
   * lets them be.
   */
  sun: { over: 0.5, least: 3.4, hill: 1.2 },
  /** Low growth in front of the first row and between its trunks (hazel, turned): metres between, heights. */
  shrubs: { step: [3.2, 5.6], off: [-0.9, 0.6], height: [2.2, 3.6] },
  /**
   * The ground (groundMaterial.js): the verge is pale dry grass, `pale`, flecked with fallen leaves (`leaf`: gold,
   * orange, brown; linear albedo), which lie thickest in a drift along the paved margin (`drift` m wide) and at the
   * barrier's foot; behind the barrier the wood's floor is litter out to `floor` m beyond the solid edge.
   */
  ground: {
    pale: [0.095, 0.055, 0.024],
    leaf: [
      [0.27, 0.115, 0.016],
      [0.25, 0.062, 0.011],
      [0.1, 0.04, 0.012],
    ],
    drift: 1.3,
    floor: [12, 26],
  },
  /**
   * The long pale grass (groundCover.js: the approach meadow's seed-headed cards, bleached): cards per metre of
   * road and side as a share of the meadow's, their tint over the cards' own green, and their heights (m).
   */
  grass: { share: 0.4, tint: [0.62, 0.27, 0.12], height: [0.4, 0.7] },
  /** The lap's low bushes under the first rows, turned with the wood: a tint over their green. */
  bush: [4.2, 1.9, 0.6],
};

const cache = new WeakMap();

/**
 * The golden wood of a Track, or null on one that has no such section.
 * @param {object} track
 * @returns {{ s0: number, along: (s: number) => number, stretch: (s: number) => number, here: (s: number) => boolean } | null}
 */
export function goldwoodOf(track) {
  if (cache.has(track)) return cache.get(track);
  const section = track.sections?.find((x) => x.id === GOLDWOOD.section);
  let place = null;
  if (section) {
    const G = GOLDWOOD;
    const s0 = section.s0;
    /** Metres from the section's start, signed (the lap's shortest way). */
    const along = (s) => track.delta(s0, s);
    /** 0..1 how much of the place a point of the road is. */
    const stretch = (s) => {
      const d = along(s);
      return smoothstep(G.from - G.ease, G.from, d) * (1 - smoothstep(G.to, G.to + G.ease, d));
    };
    place = { s0, along, stretch, here: (s) => stretch(s) > 0.5 };
  }
  cache.set(track, place);
  return place;
}
