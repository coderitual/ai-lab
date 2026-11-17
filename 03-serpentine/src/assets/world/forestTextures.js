// The trees' textures, all made at start-up: what the leaves, the needles and
// the bark are drawn with.
//
// FOLIAGE is one atlas of eight tiles drawn on a canvas, so that every tree of
// every species is one material. A tile is a picture of what one card of a
// tree carries: a spruce bough seen from above, the curtain of twigs that
// hangs under it, a fir spray, a larch spray, a hanging spray of birch leaves,
// a cluster of maple leaves, one of lime leaves, and a bare twig. The pictures
// are painted in their own colours at a middling brightness; a tree's tint
// (treeSpecies.js) multiplies them down to what its foliage sends back.
//   FAN tiles (all but the two below): the stem comes in at the middle of the
//     left edge and runs to the right (+u).
//   HANG tiles (SPRUCE_HANG, BIRCH): what hangs is attached along the top
//     edge and hangs down (+v).
//
// MIP LEVELS ARE MADE HERE, not by the GPU, for two reasons. A needle is a
// texel or two wide: averaged down, its alpha falls under the cut-off and the
// tree thins out and vanishes with distance. So each level's alpha is scaled
// until the same share of the tile passes the cut-off as in the full picture
// (per tile: thin needles need more than broad leaves). And the colour of a
// transparent texel must be the colour of the leaves next to it, or every
// edge filters towards black: colours are spread into the holes first and
// averaged weighted by alpha.
//
// BARK is four tiles side by side (spruce and fir, birch, larch, the grey
// ridged bark of maple and lime), each made from noise.js fields so that it
// wraps: u goes once round the trunk inside a tile, v repeats along it. A
// second texture holds the relief as a normal map.
//
// Canvas coordinates are the texture coordinates: u right, v down.

import * as THREE from 'three';
import { gradientField, heightToNormals, valueField, worleyField } from '../../engine/noise.js';

/** Tiles of the foliage atlas, in a 4 x 2 grid. */
export const TILE = { SPRUCE: 0, SPRUCE_HANG: 1, FIR: 2, LARCH: 3, BIRCH: 4, MAPLE: 5, LIME: 6, TWIG: 7 };
const TILE_COLS = 4;
const TILE_ROWS = 2;
/** The margin of a tile nothing is drawn in (share of the tile): so the small mip levels do not mix neighbours. */
const GUTTER = 0.03;

/** [u0, v0, u1, v1] of a foliage tile. */
export function tileRect(tile) {
  const col = tile % TILE_COLS;
  const row = Math.floor(tile / TILE_COLS);
  return [col / TILE_COLS, row / TILE_ROWS, (col + 1) / TILE_COLS, (row + 1) / TILE_ROWS];
}

/** Bark tiles, left to right. */
export const BARK = { SPRUCE: 0, BIRCH: 1, LARCH: 2, BROADLEAF: 3 };
const BARK_TILES = 4;

/** The alpha below which foliage is not drawn; the mip levels are made to keep the coverage at this cut. */
export const ALPHA_CUT = 0.5;

// ------------------------------------------------------------------------------------------------ mip levels

/**
 * A full mip chain for a picture with holes in it (see the header): colours spread into the holes, levels averaged
 * weighted by alpha, and each level's alpha scaled so that the share of every region that passes `cutoff` stays what
 * it is in the full picture.
 * @param {Uint8Array|Uint8ClampedArray} base RGBA, straight alpha, `width` x `height`; changed in place (the spread)
 * @param {number} width @param {number} height
 * @param {object} [o]
 * @param {number[][]} [o.regions] [x0, y0, x1, y1] in texels of the base: where coverage is kept, each on its own
 *   (default: the whole picture as one)
 * @param {number} [o.cutoff] 0..1
 * @param {(Uint8Array|Uint8ClampedArray)[]} [o.riders] other pictures of the same size (a normal map) that are
 *   averaged with this one's alpha as the weight; their chains are returned in `riders`
 * @returns {{ levels: { data: Uint8Array, width: number, height: number }[], riders: { data: Uint8Array, width: number, height: number }[][] }}
 */
export function alphaMips(base, width, height, { regions = [[0, 0, width, height]], cutoff = ALPHA_CUT, riders = [] } = {}) {
  const cut = Math.round(cutoff * 255);
  spread(base, width, height, riders);

  // what share of each region passes the cut in the full picture
  const share = regions.map(([x0, y0, x1, y1]) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0, i = (y * width + x0) * 4 + 3; x < x1; x++, i += 4) if (base[i] >= cut) n++;
    return n / Math.max(1, (x1 - x0) * (y1 - y0));
  });

  const levels = [{ data: base instanceof Uint8Array ? base : new Uint8Array(base.buffer, base.byteOffset, base.length), width, height }];
  const riderLevels = riders.map((r) => [{ data: r instanceof Uint8Array ? r : new Uint8Array(r.buffer, r.byteOffset, r.length), width, height }]);
  // `raw` is the chain as plain averages (the next level is always made from it); what is stored has its alpha scaled
  let raw = levels[0].data;
  let rawRiders = riderLevels.map((l) => l[0].data);
  let w = width;
  let h = height;
  const histogram = new Uint32Array(256);
  for (let level = 1; w > 1 || h > 1; level++) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = new Uint8Array(nw * nh * 4);
    const nextRiders = rawRiders.map(() => new Uint8Array(nw * nh * 4));
    for (let y = 0; y < nh; y++) {
      const ya = Math.min(h - 1, y * 2) * w;
      const yb = Math.min(h - 1, y * 2 + 1) * w;
      for (let x = 0; x < nw; x++) {
        const xa = Math.min(w - 1, x * 2);
        const xb = Math.min(w - 1, x * 2 + 1);
        const a = (ya + xa) * 4;
        const b = (ya + xb) * 4;
        const c = (yb + xa) * 4;
        const d = (yb + xb) * 4;
        // (the 1 keeps the spread colours where all four are holes)
        const wa = raw[a + 3] + 1;
        const wb = raw[b + 3] + 1;
        const wc = raw[c + 3] + 1;
        const wd = raw[d + 3] + 1;
        const sum = wa + wb + wc + wd;
        const o = (y * nw + x) * 4;
        next[o] = (raw[a] * wa + raw[b] * wb + raw[c] * wc + raw[d] * wd) / sum + 0.5;
        next[o + 1] = (raw[a + 1] * wa + raw[b + 1] * wb + raw[c + 1] * wc + raw[d + 1] * wd) / sum + 0.5;
        next[o + 2] = (raw[a + 2] * wa + raw[b + 2] * wb + raw[c + 2] * wc + raw[d + 2] * wd) / sum + 0.5;
        next[o + 3] = (sum - 4 + 2) >> 2;
        for (let r = 0; r < rawRiders.length; r++) {
          const src = rawRiders[r];
          const dst = nextRiders[r];
          for (let k = 0; k < 4; k++) dst[o + k] = (src[a + k] * wa + src[b + k] * wb + src[c + k] * wc + src[d + k] * wd) / sum + 0.5;
        }
      }
    }
    // the stored level: alpha scaled, region by region, until the share that passes the cut is the full picture's
    const stored = new Uint8Array(next);
    const f = nw / width;
    const g = nh / height;
    regions.forEach(([rx0, ry0, rx1, ry1], k) => {
      const x0 = Math.round(rx0 * f);
      const y0 = Math.round(ry0 * g);
      const x1 = Math.max(x0 + 1, Math.round(rx1 * f));
      const y1 = Math.max(y0 + 1, Math.round(ry1 * g));
      const count = (x1 - x0) * (y1 - y0);
      if (count < 4 || share[k] <= 0) return;
      histogram.fill(0);
      for (let y = y0; y < y1 && y < nh; y++) for (let x = x0, i = (y * nw + x0) * 4 + 3; x < x1 && x < nw; x++, i += 4) histogram[next[i]]++;
      // the alpha that the wanted share of texels reaches or exceeds
      let above = 0;
      let level255 = 255;
      const want = share[k] * count;
      for (; level255 > 1; level255--) {
        above += histogram[level255];
        if (above >= want) break;
      }
      const scale = Math.min(4, Math.max(1, cut / level255));
      if (scale <= 1.001) return;
      for (let y = y0; y < y1 && y < nh; y++) {
        for (let x = x0, i = (y * nw + x0) * 4 + 3; x < x1 && x < nw; x++, i += 4) stored[i] = Math.min(255, next[i] * scale + 0.5);
      }
    });
    levels.push({ data: stored, width: nw, height: nh });
    nextRiders.forEach((data, r) => riderLevels[r].push({ data, width: nw, height: nh }));
    raw = next;
    rawRiders = nextRiders;
    w = nw;
    h = nh;
  }
  return { levels, riders: riderLevels };
}

/**
 * Spreads the colour of what is drawn into the holes beside it: four sweeps, each carrying the last drawn colour
 * along a row or a column for a few texels. The riders are spread by the same rule.
 */
function spread(data, width, height, riders) {
  const REACH = 6;
  const all = [data, ...riders];
  const known = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) known[i] = data[i * 4 + 3] > 24 ? 1 : 0;
  const sweep = (start, step, count, lines, lineStep) => {
    for (let l = 0; l < lines; l++) {
      let from = -1;
      let left = 0;
      let i = start + l * lineStep;
      for (let k = 0; k < count; k++, i += step) {
        if (known[i] === 1) {
          from = i;
          left = REACH;
        } else if (from >= 0 && left > 0 && known[i] === 0) {
          for (const d of all) {
            d[i * 4] = d[from * 4];
            d[i * 4 + 1] = d[from * 4 + 1];
            d[i * 4 + 2] = d[from * 4 + 2];
          }
          for (const r of riders) r[i * 4 + 3] = r[from * 4 + 3];
          known[i] = 2;
          left--;
        } else if (known[i] === 2) left = 0;
      }
    }
  };
  sweep(0, 1, width, height, width);
  sweep(width - 1, -1, width, height, width);
  for (let i = 0; i < known.length; i++) if (known[i] === 2) known[i] = 1;
  sweep(0, width, height, width, 1);
  sweep((height - 1) * width, -width, height, width, 1);
}

/** A DataTexture from a mip chain made here. */
export function chainTexture(levels, { srgb = true, anisotropy = 4, repeat = false } = {}) {
  const texture = new THREE.DataTexture(levels[0].data, levels[0].width, levels[0].height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.mipmaps = levels;
  texture.generateMipmaps = false;
  texture.minFilter = levels.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Bytes a mip chain takes on the GPU. */
export const chainBytes = (levels) => levels.reduce((sum, l) => sum + l.width * l.height * 4, 0);

// ------------------------------------------------------------------------------------------------ foliage

const hsl = (h, s, l) => `hsl(${h.toFixed(0)},${Math.max(0, Math.min(100, s)).toFixed(0)}%,${Math.max(0, Math.min(100, l)).toFixed(1)}%)`;

/**
 * A twig with needles: from (x0, y0) to (x1, y1), bowed sideways by `bow` of its length.
 * @param {CanvasRenderingContext2D} ctx @param {import('../../engine/rng.js').Rng} rng
 * @param {object} o len: needle length; step: spacing along the twig; splay: [lo, hi] angle off the twig (rad);
 *   hue, sat: needle colour; light: [lo, hi] lightness %; tip: lightness added at the twig's end; width: stroke width;
 *   wood: the twig's own colour (null: not drawn); shade: 0..1 multiplies the lightness (a lower layer)
 */
function needleTwig(ctx, rng, x0, y0, x1, y1, bow, o) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 1e-4) return;
  const mx = (x0 + x1) / 2 - (dy / length) * bow * length;
  const my = (y0 + y1) / 2 + (dx / length) * bow * length;
  const at = (t) => {
    const a = 1 - t;
    return [a * a * x0 + 2 * a * t * mx + t * t * x1, a * a * y0 + 2 * a * t * my + t * t * y1, Math.atan2(2 * a * (my - y0) + 2 * t * (y1 - my), 2 * a * (mx - x0) + 2 * t * (x1 - mx))];
  };
  if (o.wood) {
    ctx.strokeStyle = o.wood;
    ctx.lineWidth = o.width * 1.3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
  }
  ctx.lineWidth = o.width;
  const n = Math.max(2, Math.round(length / o.step));
  for (let k = 0; k <= n; k++) {
    const t = (k + rng.range(-0.4, 0.4)) / n;
    if (t < 0 || t > 1.02) continue;
    const [x, y, dir] = at(Math.min(1, t));
    for (const side of [-1, 1]) {
      const a = dir + side * rng.range(o.splay[0], o.splay[1]);
      const l = o.len * rng.range(0.7, 1.15) * (1 - 0.35 * t * t);
      const light = (rng.range(o.light[0], o.light[1]) + o.tip * t * t * t) * (o.shade ?? 1) * (rng.next() < 0.07 ? 0.6 : 1);
      ctx.strokeStyle = hsl(o.hue + rng.range(-8, 8) - 22 * t * t * (o.tip > 0 ? 1 : 0), o.sat + rng.range(-6, 6), light);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }
}

/** A bough seen from above: a stem with side twigs swept forward, needles all along them. */
function paintFan(ctx, rng, px, o) {
  const envelope = (t) => o.reach * Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, 0.05 + t * 0.95), o.belly)), 0.85) * (1 - o.taper * t);
  const X0 = 0.035;
  const X1 = 0.955;
  // two layers of side twigs: the lower one darker, for depth
  for (const layer of [0, 1]) {
    const shade = layer === 0 ? 0.62 : 1;
    for (let t = 0.04 + layer * 0.012; t < 0.94; t += rng.range(o.spacing[0], o.spacing[1])) {
      for (const side of [-1, 1]) {
        if (rng.next() < o.gaps) continue;
        const tt = Math.min(0.96, t + rng.range(-0.01, 0.01));
        const a = side * rng.range(o.sweep[0], o.sweep[1]);
        const reach = envelope(tt) * rng.range(0.72, 1.04) * (layer === 0 ? 0.9 : 1);
        const length = reach / Math.sin(Math.abs(a));
        const x = X0 + (X1 - X0) * tt;
        needleTwig(ctx, rng, x, 0.5, x + Math.cos(a) * length, 0.5 + Math.sin(a) * length, -side * 0.08, { ...o.needle, wood: o.wood, width: o.needle.width * px, shade });
      }
    }
  }
  // the stem and its own needles
  needleTwig(ctx, rng, X0, 0.5, X1, 0.5, 0, { ...o.needle, wood: null, width: o.needle.width * px, len: o.needle.len * 0.8 });
  ctx.strokeStyle = o.wood;
  ctx.lineWidth = 3.2 * px;
  ctx.beginPath();
  ctx.moveTo(X0 - 0.01, 0.5);
  ctx.lineTo(X0 + (X1 - X0) * 0.75, 0.5);
  ctx.stroke();
}

/** Twigs hanging from a branch that runs along the top edge. */
function paintHang(ctx, rng, px, o) {
  const n = o.count;
  for (const layer of [0, 1]) {
    for (let k = 0; k < n; k++) {
      const x = 0.06 + (0.88 * (k + rng.range(0.1, 0.9))) / n;
      const length = rng.range(o.length[0], o.length[1]) * (layer === 0 ? 0.9 : 1);
      const sway = rng.range(-0.07, 0.07);
      needleTwig(ctx, rng, x, 0.045, x + sway, 0.045 + length, rng.range(-0.06, 0.06), { ...o.needle, wood: o.wood, width: o.needle.width * px, shade: layer === 0 ? 0.62 : 1 });
    }
  }
  // the branch they hang from
  needleTwig(ctx, rng, 0.04, 0.05, 0.96, 0.05, 0, { ...o.needle, wood: o.wood, width: o.needle.width * px, len: o.needle.len * 0.8 });
  ctx.strokeStyle = o.wood;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(0.035, 0.05);
  ctx.lineTo(0.965, 0.05);
  ctx.stroke();
}

/** A larch spray: thin twigs, and on them rosettes of soft needles. */
function paintLarch(ctx, rng, px) {
  const wood = 'rgb(84,62,44)';
  const tuft = (x, y, size, shade) => {
    ctx.lineWidth = 1.5 * px;
    const n = 13;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const l = size * rng.range(0.6, 1.1);
      ctx.strokeStyle = hsl(rng.range(38, 52), rng.range(72, 90), rng.range(44, 66) * shade);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  };
  const twig = (x0, y0, x1, y1, shade) => {
    ctx.strokeStyle = wood;
    ctx.lineWidth = 1.8 * px;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const length = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0.012; d < length; d += rng.range(0.02, 0.032)) {
      const t = d / length;
      tuft(x0 + (x1 - x0) * t + rng.range(-0.006, 0.006), y0 + (y1 - y0) * t + rng.range(-0.006, 0.006), rng.range(0.02, 0.03), shade);
    }
  };
  for (const layer of [0, 1]) {
    for (let t = 0.05 + layer * 0.02; t < 0.93; t += rng.range(0.045, 0.07)) {
      for (const side of [-1, 1]) {
        if (rng.next() < 0.18) continue;
        const a = side * rng.range(0.7, 1.15);
        const reach = 0.4 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.8) * (1 - 0.3 * t) * rng.range(0.6, 1.05);
        const length = reach / Math.sin(Math.abs(a));
        const x = 0.035 + 0.92 * t;
        twig(x, 0.5, x + Math.cos(a) * length, 0.5 + Math.sin(a) * length, layer === 0 ? 0.7 : 1);
      }
    }
  }
  twig(0.03, 0.5, 0.955, 0.5, 1);
  ctx.strokeStyle = wood;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(0.03, 0.5);
  ctx.lineTo(0.7, 0.5);
  ctx.stroke();
}

/** One leaf at (x, y), pointing along `angle`, `size` long: `shape(ctx)` draws its outline for a leaf from (0, 0) to (0, 1). */
function leaf(ctx, x, y, angle, size, fill, edge, vein, shape, px) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle - Math.PI / 2);
  ctx.scale(size, size);
  ctx.beginPath();
  const veins = shape(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = (1.1 * px) / size;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.strokeStyle = vein;
  ctx.lineWidth = (1.2 * px) / size;
  ctx.beginPath();
  for (const [vx, vy] of veins) {
    ctx.moveTo(0, 0.06);
    ctx.lineTo(vx, vy);
  }
  ctx.stroke();
  ctx.restore();
}

/** A maple leaf: five pointed lobes. Returns where its main veins end. */
function mapleShape(ctx) {
  const tips = [
    [-104, 0.5],
    [-46, 0.86],
    [0, 1],
    [46, 0.86],
    [104, 0.5],
  ];
  const point = (deg, r) => [Math.sin((deg * Math.PI) / 180) * r, 0.42 + Math.cos((deg * Math.PI) / 180) * r * 0.58];
  ctx.moveTo(0, 0);
  ctx.lineTo(...point(-150, 0.3));
  tips.forEach(([deg, r], k) => {
    ctx.lineTo(...point(deg - 11, r * 0.7));
    ctx.lineTo(...point(deg, r));
    ctx.lineTo(...point(deg + 11, r * 0.7));
    if (k < tips.length - 1) ctx.lineTo(...point((deg + tips[k + 1][0]) / 2, 0.36));
  });
  ctx.lineTo(...point(150, 0.3));
  ctx.closePath();
  return tips.map(([deg, r]) => point(deg, r * 0.9));
}

/** A lime (or beech) leaf: a heart drawn out to a point. */
function limeShape(ctx) {
  ctx.moveTo(0, 0.04);
  ctx.bezierCurveTo(0.5, -0.12, 0.62, 0.42, 0.04, 0.98);
  ctx.lineTo(0, 1);
  ctx.bezierCurveTo(-0.56, 0.44, -0.46, -0.1, 0, 0.04);
  return [
    [0, 0.96],
    [0.3, 0.5],
    [-0.28, 0.5],
    [0.26, 0.24],
    [-0.24, 0.24],
  ];
}

/** A birch leaf: a small pointed egg. */
function birchShape(ctx) {
  ctx.moveTo(0, 0.05);
  ctx.bezierCurveTo(0.48, 0.1, 0.4, 0.6, 0, 1);
  ctx.bezierCurveTo(-0.4, 0.6, -0.48, 0.1, 0, 0.05);
  return [[0, 0.92]];
}

/** Autumn colours as [hue, saturation, lightness]: `warmth` 0 is the yellow end of a palette, 1 its red end. */
const autumn = (palette, warmth, rng) => {
  const f = Math.max(0, Math.min(0.999, warmth)) * (palette.length - 1);
  const a = palette[Math.floor(f)];
  const b = palette[Math.floor(f) + 1];
  const t = f - Math.floor(f);
  return [a[0] + (b[0] - a[0]) * t + rng.range(-3, 3), a[1] + (b[1] - a[1]) * t + rng.range(-5, 5), a[2] + (b[2] - a[2]) * t + rng.range(-4, 4)];
};
const MAPLE_COLOURS = [
  [50, 92, 56],
  [40, 94, 53],
  [28, 92, 50],
  [16, 86, 46],
  [6, 78, 40],
];
const LIME_COLOURS = [
  [64, 70, 48],
  [54, 88, 54],
  [46, 92, 52],
  [36, 84, 46],
  [26, 70, 38],
];
const BIRCH_COLOURS = [
  [70, 62, 48],
  [58, 86, 56],
  [50, 92, 55],
  [42, 86, 48],
];

/** A cluster of leaves on a forking twig that comes in from the left. */
function paintCluster(ctx, rng, px, { colours, shape, size, leaves, wood }) {
  // the twigs: a main one and a few side shoots
  const twigs = [[0.03, 0.5, 0.78, 0.5 + rng.range(-0.06, 0.06)]];
  for (let k = 0; k < 5; k++) {
    const t = rng.range(0.15, 0.75);
    const a = rng.sign() * rng.range(0.45, 1.0);
    const l = rng.range(0.16, 0.36);
    const x = 0.03 + 0.75 * t;
    twigs.push([x, 0.5, x + Math.cos(a) * l, 0.5 + Math.sin(a) * l]);
  }
  ctx.strokeStyle = wood;
  twigs.forEach(([x0, y0, x1, y1], k) => {
    ctx.lineWidth = (k === 0 ? 4 : 2.4) * px;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  });
  // the leaves: the lower ones first and darker (they are in the others' shade); each cluster leans towards one end
  // of its palette, with strays
  const lean = rng.range(0.25, 0.75);
  for (let k = 0; k < leaves; k++) {
    const [x0, y0, x1, y1] = twigs[rng.int(twigs.length)];
    const t = Math.pow(rng.next(), 0.6);
    const along = Math.atan2(y1 - y0, x1 - x0);
    const a = along + rng.sign() * rng.range(0.25, 1.25);
    const s = size * rng.range(0.7, 1.15);
    // (the stalk carries the leaf off the twig)
    const stalk = s * rng.range(0.15, 0.5);
    const x = Math.min(0.9, Math.max(0.1, x0 + (x1 - x0) * t + Math.cos(a) * stalk));
    const y = Math.min(0.9, Math.max(0.1, y0 + (y1 - y0) * t + Math.sin(a) * stalk));
    const depth = k / leaves;
    const [h, sat, l] = autumn(colours, lean + rng.range(-0.3, 0.3) + (rng.next() < 0.12 ? rng.range(-0.5, 0.5) : 0), rng);
    const light = l * (0.68 + 0.36 * depth);
    leaf(ctx, x, y, a, s, hsl(h, sat, light), hsl(h - 4, sat, light * 0.72), hsl(h + 6, sat * 0.8, Math.min(92, light * 1.28)), shape, px);
  }
}

/** Hanging twigs with small leaves on short stalks (birch). */
function paintBirch(ctx, rng, px) {
  const wood = 'rgb(58,46,40)';
  const lean = rng.range(0.3, 0.6);
  for (const layer of [0, 1]) {
    for (let k = 0; k < 11; k++) {
      const x0 = 0.07 + (0.86 * (k + rng.range(0.1, 0.9))) / 11;
      const length = rng.range(0.5, 0.9);
      const sway = rng.range(-0.08, 0.08);
      const bow = rng.range(-0.05, 0.05);
      const at = (t) => [x0 + sway * t + bow * Math.sin(Math.PI * t), 0.04 + length * t];
      ctx.strokeStyle = wood;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      for (let t = 0; t <= 1.001; t += 0.1) ctx.lineTo(...at(t));
      ctx.stroke();
      for (let t = 0.06; t < 1; t += rng.range(0.035, 0.06)) {
        const [x, y] = at(t);
        const a = Math.PI / 2 + rng.sign() * rng.range(0.3, 1.2);
        const s = rng.range(0.036, 0.054);
        const [h, sat, l] = autumn(BIRCH_COLOURS, lean + rng.range(-0.35, 0.35), rng);
        const light = l * (layer === 0 ? 0.7 : 1) * rng.range(0.9, 1.06);
        leaf(ctx, x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3, a, s, hsl(h, sat, light), hsl(h - 4, sat, light * 0.75), hsl(h + 4, sat * 0.8, Math.min(92, light * 1.2)), birchShape, px);
      }
    }
  }
  ctx.strokeStyle = wood;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(0.04, 0.045);
  ctx.lineTo(0.96, 0.045);
  ctx.stroke();
}

/** A bare twig, forking: dead lower branches and the fine ends of limbs. */
function paintTwig(ctx, rng, px) {
  const grow = (x, y, a, l, w, depth) => {
    const x1 = x + Math.cos(a) * l;
    const y1 = y + Math.sin(a) * l;
    const tone = rng.range(70, 104);
    ctx.strokeStyle = `rgb(${tone.toFixed(0)},${(tone * 0.88).toFixed(0)},${(tone * 0.76).toFixed(0)})`;
    ctx.lineWidth = w * px;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x1) / 2 + rng.range(-0.02, 0.02), (y + y1) / 2 + rng.range(-0.02, 0.02), x1, y1);
    ctx.stroke();
    if (depth === 0 || l < 0.05) return;
    const n = depth > 2 ? 3 : 2 + rng.int(2);
    for (let k = 0; k < n; k++) {
      const t = rng.range(0.35, 1);
      grow(x + (x1 - x) * t, y + (y1 - y) * t, a + rng.sign() * rng.range(0.3, 0.9), l * rng.range(0.45, 0.7), Math.max(1.3, w * 0.62), depth - 1);
    }
  };
  grow(0.03, 0.5, 0, 0.62, 5, 4);
}

/**
 * The foliage atlas.
 * @param {number} tile edge of one tile in texels (the atlas is 4 x 2 of them)
 * @param {import('../../engine/rng.js').Rng} rng
 * @param {number} anisotropy
 * @returns {{ texture: THREE.DataTexture, bytes: number, width: number, height: number }}
 */
export function createFoliageAtlas(tile, rng, anisotropy = 4) {
  const width = tile * TILE_COLS;
  const height = tile * TILE_ROWS;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const px = 1 / 512; // one texel of a 512 tile, in tile units: strokes keep their share of the tile at any size

  const SPRUCE_NEEDLE = { len: 0.03, step: 0.0075, splay: [0.55, 1.15], hue: 128, sat: 34, light: [24, 44], tip: 16, width: 1.7 };
  const painters = {
    [TILE.SPRUCE]: (r) =>
      paintFan(ctx, r, px, { reach: 0.44, belly: 0.72, taper: 0.38, spacing: [0.03, 0.046], sweep: [0.8, 1.15], gaps: 0.06, wood: 'rgb(74,54,40)', needle: SPRUCE_NEEDLE }),
    [TILE.SPRUCE_HANG]: (r) => paintHang(ctx, r, px, { count: 15, length: [0.42, 0.9], wood: 'rgb(74,54,40)', needle: { ...SPRUCE_NEEDLE, splay: [0.4, 0.9] } }),
    [TILE.FIR]: (r) =>
      paintFan(ctx, r, px, {
        reach: 0.42,
        belly: 0.62,
        taper: 0.2,
        spacing: [0.03, 0.036],
        sweep: [1.0, 1.15],
        gaps: 0.02,
        wood: 'rgb(86,70,54)',
        needle: { len: 0.024, step: 0.0062, splay: [1.2, 1.5], hue: 150, sat: 30, light: [22, 38], tip: 10, width: 1.9 },
      }),
    [TILE.LARCH]: (r) => paintLarch(ctx, r, px),
    [TILE.BIRCH]: (r) => paintBirch(ctx, r, px),
    [TILE.MAPLE]: (r) => paintCluster(ctx, r, px, { colours: MAPLE_COLOURS, shape: mapleShape, size: 0.2, leaves: 64, wood: 'rgb(60,44,36)' }),
    [TILE.LIME]: (r) => paintCluster(ctx, r, px, { colours: LIME_COLOURS, shape: limeShape, size: 0.135, leaves: 110, wood: 'rgb(56,46,40)' }),
    [TILE.TWIG]: (r) => paintTwig(ctx, r, px),
  };
  const regions = [];
  for (const [key, paint] of Object.entries(painters)) {
    const k = Number(key);
    const col = k % TILE_COLS;
    const row = Math.floor(k / TILE_COLS);
    ctx.save();
    ctx.setTransform(tile, 0, 0, tile, col * tile, row * tile);
    ctx.beginPath();
    ctx.rect(GUTTER, GUTTER, 1 - 2 * GUTTER, 1 - 2 * GUTTER);
    ctx.clip();
    paint(rng.fork(`tile${k}`));
    ctx.restore();
    regions.push([col * tile, row * tile, (col + 1) * tile, (row + 1) * tile]);
  }
  const pixels = ctx.getImageData(0, 0, width, height).data;
  // The broadleaves' tiles keep only their light and a hint of their hue: the tree's tint (treeSpecies.js) gives
  // them their colour, green or turned, so one picture serves a green lime and a red maple.
  for (const k of [TILE.BIRCH, TILE.MAPLE, TILE.LIME]) {
    const x0 = (k % TILE_COLS) * tile;
    const y0 = Math.floor(k / TILE_COLS) * tile;
    for (let y = y0; y < y0 + tile; y++) {
      for (let x = x0; x < x0 + tile; x++) {
        const o = (y * width + x) * 4;
        if (!pixels[o + 3]) continue;
        const lum = 0.3 * pixels[o] + 0.59 * pixels[o + 1] + 0.11 * pixels[o + 2];
        // (a little lifted: the tint, not the picture, says how dark the leaves are)
        const v = Math.min(235, lum * 1.25);
        for (let c = 0; c < 3; c++) pixels[o + c] = Math.max(0, Math.min(255, Math.round(v + 0.18 * (pixels[o + c] - lum))));
      }
    }
  }
  const { levels } = alphaMips(pixels, width, height, { regions });
  return { texture: chainTexture(levels, { anisotropy }), bytes: chainBytes(levels), width, height };
}

// ------------------------------------------------------------------------------------------------ bark

/** A field read with its x wrapped `k` times: its features `k` times narrower, so taller than wide; still tiles. */
const narrow = (field, size, k) => {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = field[y * size + ((x * k) % size)];
  return out;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (a, b, v) => clamp01((v - a) / (b - a));
const toSrgb = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/**
 * Each bark as { color(i) -> [r, g, b] linear albedo, height: Float32Array 0..1, relief }, on a `size` square that wraps.
 * @param {number} size @param {import('../../engine/rng.js').Rng} rng
 */
function barkTiles(size, rng) {
  const seed = rng.int(1 << 20);
  const grain = gradientField(size, { seed: seed + 1, cells: 16, octaves: 3 });
  const stain = valueField(size, { seed: seed + 2, cells: 4, octaves: 3 });
  const patches = valueField(size, { seed: seed + 9, cells: 6, octaves: 2 });
  const tiles = [];

  // spruce and fir: grey-brown scales, flaking in plates taller than wide, dark between them, lichen here and there
  {
    const edge = narrow(worleyField(size, { seed: seed + 3, cells: 5, mode: 'edge' }), size, 2);
    const id = narrow(worleyField(size, { seed: seed + 3, cells: 5, mode: 'id' }), size, 2);
    const fine = narrow(worleyField(size, { seed: seed + 4, cells: 14, mode: 'edge' }), size, 2);
    const height = new Float32Array(size * size);
    const color = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      const plate = ramp(0.0, 0.14, edge[i]);
      const flake = ramp(0.0, 0.2, fine[i]);
      height[i] = clamp01(plate * (0.5 + 0.35 * id[i]) + 0.15 * flake + 0.12 * (grain[i] - 0.5));
      const tone = (0.55 + 0.6 * id[i]) * (0.82 + 0.36 * grain[i]) * (0.75 + 0.25 * flake);
      const lichen = ramp(0.62, 0.8, stain[i]) * 0.55;
      const base = [0.2 * tone, 0.155 * tone, 0.12 * tone];
      const crack = 0.25 + 0.75 * plate;
      color[i * 3] = (base[0] * (1 - lichen) + 0.3 * lichen) * crack;
      color[i * 3 + 1] = (base[1] * (1 - lichen) + 0.31 * lichen) * crack;
      color[i * 3 + 2] = (base[2] * (1 - lichen) + 0.26 * lichen) * crack;
    }
    tiles.push({ color, height, relief: 0.07 });
  }

  // birch: white paper, grey lenticels across the trunk, black scars where branches were
  {
    const height = new Float32Array(size * size).fill(0.6);
    const color = new Float32Array(size * size * 3);
    const dark = new Float32Array(size * size);
    const r = rng.fork('birch');
    const dash = (cx, cy, w, h, strength) => {
      for (let y = -h; y <= h; y++) {
        for (let x = -w; x <= w; x++) {
          const fall = (1 - Math.abs(x) / (w + 1)) * (1 - Math.abs(y) / (h + 1));
          const i = (((cy + y) % size) + size) % size * size + ((((cx + x) % size) + size) % size);
          dark[i] = Math.max(dark[i], strength * Math.min(1, fall * 2.5));
        }
      }
    };
    const unit = size / 256;
    for (let k = 0; k < 90; k++) dash(r.int(size), r.int(size), Math.round(r.range(4, 22) * unit), Math.round(r.range(0.6, 1.6) * unit), r.range(0.35, 0.8));
    // scars: a dark eyebrow, wide and low
    for (let k = 0; k < 3; k++) {
      const cx = r.int(size);
      const cy = r.int(size);
      const w = Math.round(r.range(16, 30) * unit);
      for (let x = -w; x <= w; x++) dash(cx + x, cy + Math.round((Math.abs(x) / w) ** 1.6 * w * 0.5), Math.round(1 * unit), Math.round(r.range(2, 4) * unit), 1);
    }
    for (let i = 0; i < size * size; i++) {
      const d = dark[i];
      const tone = 0.74 + 0.2 * (stain[i] - 0.5) + 0.1 * (grain[i] - 0.5);
      // a little warm where the paper peels
      const peel = ramp(0.55, 0.75, patches[i]) * 0.25;
      color[i * 3] = (tone + 0.03 * peel) * (1 - d) + 0.03 * d;
      color[i * 3 + 1] = (tone * 0.985 - 0.02 * peel) * (1 - d) + 0.028 * d;
      color[i * 3 + 2] = (tone * 0.94 - 0.08 * peel) * (1 - d) + 0.026 * d;
      height[i] = 0.6 - 0.35 * d + 0.08 * (grain[i] - 0.5);
    }
    tiles.push({ color, height, relief: 0.025 });
  }

  // larch: deep furrows up and down, red-brown inside, grey ridges
  {
    const ridge = narrow(gradientField(size, { seed: seed + 5, cells: 3, octaves: 3 }), size, 4);
    const plates = narrow(worleyField(size, { seed: seed + 6, cells: 6, mode: 'edge' }), size, 3);
    const height = new Float32Array(size * size);
    const color = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      const fold = 1 - Math.abs(2 * ridge[i] - 1) * 1.6;
      const h = clamp01(0.75 * clamp01(fold) + 0.25 * ramp(0, 0.2, plates[i]) + 0.1 * (grain[i] - 0.5));
      height[i] = h;
      const tone = 0.8 + 0.4 * grain[i];
      color[i * 3] = (0.085 + 0.2 * h * h) * tone;
      color[i * 3 + 1] = (0.04 + 0.16 * h * h) * tone;
      color[i * 3 + 2] = (0.03 + 0.125 * h * h) * tone;
    }
    tiles.push({ color, height, relief: 0.1 });
  }

  // maple and lime: grey, in long interlacing ridges
  {
    const ridge = narrow(gradientField(size, { seed: seed + 7, cells: 4, octaves: 3 }), size, 3);
    const cells = narrow(worleyField(size, { seed: seed + 8, cells: 4, mode: 'edge' }), size, 4);
    const height = new Float32Array(size * size);
    const color = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      const fold = clamp01(1 - Math.abs(2 * ridge[i] - 1) * 1.9);
      const h = clamp01(0.6 * fold + 0.4 * ramp(0, 0.16, cells[i]) + 0.1 * (grain[i] - 0.5));
      height[i] = h;
      const tone = (0.06 + 0.2 * h) * (0.8 + 0.4 * grain[i]);
      const moss = ramp(0.6, 0.85, stain[i]) * 0.35;
      color[i * 3] = tone * (1 - moss) + 0.1 * moss;
      color[i * 3 + 1] = tone * 0.95 * (1 - moss) + 0.13 * moss;
      color[i * 3 + 2] = tone * 0.86 * (1 - moss) + 0.06 * moss;
    }
    tiles.push({ color, height, relief: 0.07 });
  }
  return tiles;
}

/** A plain mip chain (2 x 2 averages) of an RGBA picture whose sides are powers of two. */
function boxMips(data, width, height) {
  const levels = [{ data, width, height }];
  let w = width;
  let h = height;
  let last = data;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const a = (Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2)) * 4;
        const b = (Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2 + 1)) * 4;
        const c = (Math.min(h - 1, y * 2 + 1) * w + Math.min(w - 1, x * 2)) * 4;
        const d = (Math.min(h - 1, y * 2 + 1) * w + Math.min(w - 1, x * 2 + 1)) * 4;
        for (let k = 0; k < 4; k++) next[(y * nw + x) * 4 + k] = (last[a + k] + last[b + k] + last[c + k] + last[d + k] + 2) >> 2;
      }
    }
    levels.push({ data: next, width: nw, height: nh });
    last = next;
    w = nw;
    h = nh;
  }
  return levels;
}

/**
 * The bark's two textures: colour (sRGB, with the hollows already darkened) and relief (a tangent-space normal map).
 * Four tiles side by side; v repeats.
 * @param {number} size edge of one tile in texels
 * @param {import('../../engine/rng.js').Rng} rng
 * @param {number} anisotropy
 * @returns {{ map: THREE.DataTexture, normal: THREE.DataTexture, bytes: number }}
 */
export function createBarkTextures(size, rng, anisotropy = 4) {
  const tiles = barkTiles(size, rng);
  const width = size * BARK_TILES;
  const color = new Uint8Array(width * size * 4);
  const normal = new Uint8Array(width * size * 4);
  tiles.forEach((tile, k) => {
    const normals = heightToNormals(tile.height, size, tile.relief);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const o = (y * width + k * size + x) * 4;
        // the hollows are darker than the faces: they see less of the sky
        const cavity = 0.55 + 0.45 * tile.height[i];
        color[o] = toSrgb(clamp01(tile.color[i * 3] * cavity));
        color[o + 1] = toSrgb(clamp01(tile.color[i * 3 + 1] * cavity));
        color[o + 2] = toSrgb(clamp01(tile.color[i * 3 + 2] * cavity));
        color[o + 3] = 255;
        normal[o] = Math.round((normals[i * 3] * 0.5 + 0.5) * 255);
        normal[o + 1] = Math.round((normals[i * 3 + 1] * 0.5 + 0.5) * 255);
        normal[o + 2] = Math.round((normals[i * 3 + 2] * 0.5 + 0.5) * 255);
        normal[o + 3] = Math.round(tile.height[i] * 255);
      }
    }
  });
  const colorLevels = boxMips(color, width, size);
  const normalLevels = boxMips(normal, width, size);
  return {
    map: chainTexture(colorLevels, { anisotropy, repeat: true }),
    normal: chainTexture(normalLevels, { srgb: false, anisotropy, repeat: true }),
    bytes: chainBytes(colorLevels) + chainBytes(normalLevels),
  };
}

/** [u0, u1] of a bark tile: the trunk's seam vertices sit half a texel inside it, so the neighbour never shows. */
export function barkSpan(tile, size) {
  const half = 0.5 / (size * BARK_TILES);
  return [tile / BARK_TILES + half, (tile + 1) / BARK_TILES - half];
}
