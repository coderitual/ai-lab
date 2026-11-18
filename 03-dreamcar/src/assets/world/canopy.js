// How much of the sky a point on or beside the road still sees past the woods
// that stand along it: the canopy's share of the sky's light, defined once and
// read by everything the sky lights there (the asphalt, the kerbs and the
// verges through their baked sky share, aBake.z; the car's own sky through the
// game).
//
// The woods are the Track's (woodAt(s, side): what grows behind the barrier;
// forest.js plants them from BARRIER_CLEAR beyond the solid edge). Seen from
// the road a wood is a wall of crowns: its height is the trees' and the rise
// of the hillside under them, its near face the first trunks less what the
// crowns reach out over the verge. A wall that stands up to an angle t above
// one side of the horizon hides (1 - cos t) / 2 of a cosine-weighted sky (a
// street canyon's sky view factor); by day the low sky it hides is the bright
// part, so it counts LOW_SKY times that, and leaves let some through
// (DENSITY). Both sides add up. The terrain's bake already holds what ridges
// and cuttings hide; this is only what the trees hide, multiplied in.
//
// Pure arithmetic over the Track: no Three.js, runs in Node.

/** Crown height by the wood's mix (m), how far crowns reach out over the verge (m), and how far trees stand back. */
export const CANOPY = {
  height: { broadleaf: 16, conifer: 20, mixed: 18 },
  overhang: 3.5,
  /** forest.js BARRIER_CLEAR: the first trees stand this far beyond the solid edge (m). */
  clear: 2,
  /** How far up the hillside the crowns' middle stands from the near face (m): the slope lifts them by that much. */
  depth: 6,
  /** Share of the light the crowns stop. */
  DENSITY: 0.85,
  /** How much more the low sky the woods hide counts than the sky as a whole. */
  LOW_SKY: 1.3,
  /** Woods are averaged over this many metres either way along the road: a gap of a tree or two changes little. */
  reach: 15,
  /** The least share of the sky that is left. */
  floor: 0.3,
};

const tables = new WeakMap();

/** Per Track sample and side, smoothed along the road: the wooded share, the wood's near face (m from the centre line) and height. */
function tableOf(track) {
  let t = tables.get(track);
  if (t) return t;
  const n = track.count;
  const ds = track.ds;
  const span = Math.max(1, Math.round(CANOPY.reach / ds));
  t = [1, -1].map((side) => {
    const slopes = side > 0 ? track.farSlopeL : track.farSlopeR;
    const wooded = new Uint8Array(n);
    const nearRaw = new Float32Array(n);
    const heightRaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const wood = track.woodAt ? track.woodAt(i * ds, side) : null;
      if (!wood) continue;
      wooded[i] = 1;
      nearRaw[i] = track.edgeAt(i * ds, side) + CANOPY.clear - CANOPY.overhang;
      heightRaw[i] = (CANOPY.height[wood] ?? CANOPY.height.mixed) + Math.max(0, slopes ? slopes[i] : 0) * (CANOPY.overhang + CANOPY.depth);
    }
    const share = new Float32Array(n);
    const near = new Float32Array(n);
    const height = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let count = 0;
      let sumNear = 0;
      let sumHeight = 0;
      for (let j = -span; j <= span; j++) {
        const k = (i + j + n) % n;
        if (!wooded[k]) continue;
        count++;
        sumNear += nearRaw[k];
        sumHeight += heightRaw[k];
      }
      share[i] = count / (2 * span + 1);
      near[i] = count ? sumNear / count : 0;
      height[i] = count ? sumHeight / count : 0;
    }
    return { share, near, height };
  });
  tables.set(track, t);
  return t;
}

/**
 * The share of the sky's light that reaches a point `lat` metres left of the centre line at `s`, past the woods
 * (1 in the open).
 * @param {object} track the Track @param {number} s @param {number} lat
 */
export function canopyOpen(track, s, lat) {
  const t = tableOf(track);
  const i = Math.round(track.wrap(s) / track.ds) % track.count;
  let lost = 0;
  for (let h = 0; h < 2; h++) {
    const side = h === 0 ? 1 : -1;
    const w = t[h];
    if (w.share[i] <= 0) continue;
    const d = Math.max(0.5, w.near[i] - side * lat);
    const cos = d / Math.hypot(d, w.height[i]);
    lost += w.share[i] * CANOPY.DENSITY * CANOPY.LOW_SKY * (1 - cos) * 0.5;
  }
  return Math.max(CANOPY.floor, 1 - lost);
}
