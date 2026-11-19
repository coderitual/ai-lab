// The night-race livery's picture (PAINTS.night), drawn at start-up on a canvas: an original street-racing
// livery for the dark, in the spirit of the expressway racers (nothing of any team, brand, film or game): a black
// base, sharp angular blades in magenta along the lower flanks rising over the rear wheels, a cyan line beside
// them, acid-yellow ticks, a big number, made-up marks ("YORU SPEED", "DOMI RACING") and katakana of its own
// drawing (ドリームカー "dream car", ヨル "night"), and a stripe between two cyan lines over the bonnet, the roof and the boot.
//
// The picture has three bands, read by the paint (materials.js, `paintLivery`) in car space, so nothing depends on
// the skin's own layout:
//  - the left flank (+x): u = (FRONT - z) / LENGTH (the front at the left, as the flank is seen from outside),
//    v = (TOP - y) / HEIGHT over the band;
//  - the right flank: u = (z - BACK) / LENGTH (the front at the right), the same graphics mirrored, the words not;
//  - the top: u as on the left flank, v = (x + HALF) / (2 HALF) over the band.
// A pixel's alpha is how much of the livery covers the paint there. No font is used: the letters are plate.js's
// pen, the katakana the strokes below.

import * as THREE from 'three';
import { drawGlyph } from './plate.js';

/** Where the bands lie on the car (m), and where in the picture (share of its height, from the top). */
export const LIVERY = {
  front: 2.4,
  back: -2.5,
  top: 1.05,
  bottom: 0.15,
  half: 0.95,
  /** the bands' top edges in the picture (v), and each band's height */
  bands: [0, 0.3, 0.6],
  band: 0.3,
};
const LENGTH = LIVERY.front - LIVERY.back;
const HEIGHT = LIVERY.top - LIVERY.bottom;

/** The picture's size per tier (px): the words want the medium tier's to be read from the chase camera. */
const SIZE = { low: 512, medium: 1024, high: 2048 };

const MAGENTA = '#ff1a8c';
const CYAN = '#18e8ff';
const ACID = '#c8ff1a';
const WHITE = '#f4f6ff';

/** Katakana of this file's own, as strokes on plate.js's 4 x 7 grid (the dakuten are two short ticks). */
const KANA = {
  ド: [[[1.2, 7], [1.2, 0]], [[1.2, 4.4], [3.3, 3.1]], [[2.9, 7], [3.3, 6.0]], [[3.8, 7], [4.2, 6.0]]],
  リ: [[[0.6, 6.4], [0.6, 2.8]], [[3.4, 7], [3.4, 2.6], [2.0, 0]]],
  ー: [[[0, 3.5], [4, 3.5]]],
  ム: [[[2.3, 7], [0.4, 1.0], [3.4, 1.5]], [[2.8, 3.4], [4, 0.4]]],
  カ: [[[0.2, 5.0], [3.8, 5.0], [3.8, 0.8], [2.8, 0]], [[2.0, 7], [1.5, 3], [0.2, 0]]],
  ヨ: [[[0.3, 6.6], [3.8, 6.6], [3.8, 0.4], [0.3, 0.4]], [[0.6, 3.5], [3.8, 3.5]]],
  ル: [[[1.2, 7], [1.2, 3.2], [0, 0]], [[2.7, 7], [2.7, 0.5], [4.2, 2.0]]],
};

/** Writes `text` (capitals, digits, spaces; or the katakana above) from (x, y) (its baseline), each character h high. */
function write(g, text, x, y, h, pen, gap = 0.28) {
  const w = h * 0.57;
  for (const ch of text) {
    if (ch !== ' ') {
      if (KANA[ch]) drawStrokes(g, KANA[ch], x, y, w, h, pen);
      else drawGlyph(g, ch, x, y, w, h, pen);
    }
    x += w + h * gap;
  }
  return x;
}

/** The width `write` takes for `text`. */
const measure = (text, h, gap = 0.28) => text.length * h * (0.57 + gap) - h * gap;

function drawStrokes(g, strokes, x, y, w, h, pen) {
  const ux = (w - pen) / 4;
  const uy = (h - pen) / 7;
  g.lineWidth = pen;
  for (const stroke of strokes) {
    g.beginPath();
    stroke.forEach(([sx, sy], i) => {
      const px = x + pen / 2 + sx * ux;
      const py = y - pen / 2 - sy * uy;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
  }
}

/**
 * One flank's graphics, front at the left, in metres along (from the front) and up (from the band's top): the
 * blades and lines only (the words are put on by `flankWords`, so that they are never mirrored).
 */
function flankGraphics(g, X, Y) {
  const poly = (color, pts) => {
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))));
    g.closePath();
    g.fill();
  };
  // the main blade: from under the front wing, low along the doors, kicking up over the rear wheel to the tail
  poly(MAGENTA, [[0.55, 0.55], [1.1, 0.52], [3.1, 0.6], [3.75, 0.25], [4.75, 0.22], [4.9, 0.3], [3.95, 0.4], [3.35, 0.72], [1.0, 0.68]]);
  // a violet shard from the C-pillar's foot down to the rear wheel, and a white pinstripe under the blade
  poly('#7c1cff', [[3.25, 0.1], [4.35, 0.16], [3.62, 0.44], [3.45, 0.3]]);
  poly(WHITE, [[1.05, 0.69], [3.33, 0.73], [3.95, 0.415], [4.86, 0.315], [4.86, 0.33], [3.97, 0.43], [3.36, 0.75], [1.05, 0.71]]);
  // a cyan line along its upper edge, broken where the blade turns
  poly(CYAN, [[0.95, 0.495], [3.05, 0.565], [3.6, 0.27], [4.7, 0.18], [4.72, 0.205], [3.66, 0.3], [3.12, 0.585], [0.95, 0.515]]);
  // sharp slashes ahead of the front wheel and behind the rear one
  for (let k = 0; k < 3; k++) {
    const a = 0.12 + k * 0.11;
    poly(k === 1 ? ACID : MAGENTA, [[a, 0.62], [a + 0.05, 0.62], [a + 0.2, 0.3], [a + 0.15, 0.3]]);
  }
  for (let k = 0; k < 4; k++) {
    const a = 4.12 + k * 0.08;
    poly(ACID, [[a, 0.47], [a + 0.035, 0.47], [a + 0.1, 0.33], [a + 0.065, 0.33]]);
  }
  // the number's plate on the front door: a white slanted box with a magenta edge
  poly(MAGENTA, [[1.62, 0.12], [2.36, 0.12], [2.26, 0.48], [1.52, 0.48]]);
  poly('#08080c', [[1.645, 0.14], [2.33, 0.14], [2.235, 0.46], [1.545, 0.46]]);
}

/** The words of one flank, `X` mapping metres from the front to the picture (front at the left or right). */
function flankWords(g, X, Y, px, flip) {
  // where a word `w` px long starts so that it covers the car from `m` metres behind the front, on either flank
  const at = (m, w) => (flip ? X(m) - w : X(m));
  g.strokeStyle = WHITE;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // the big number
  const nh = 0.3 * px;
  const nw = measure('01', nh, 0.18);
  g.strokeStyle = WHITE;
  write(g, '01', at(1.73, nw), Y(0.43), nh, nh * 0.17, 0.18);
  // a made-up sponsor on the front wing, white on magenta
  const sh = 0.055 * px;
  const sw = measure('YORU SPEED', sh);
  g.fillStyle = MAGENTA;
  g.fillRect(at(0.36, sw + sh), Y(0.38) - sh * 1.5, sw + sh, sh * 2);
  g.strokeStyle = WHITE;
  write(g, 'YORU SPEED', at(0.36, sw + sh) + sh / 2, Y(0.38) - sh * 0.25, sh, sh * 0.2);
  // the katakana on the rear door, over the blade, cyan
  const kh = 0.07 * px;
  const kw = measure('ドリームカー', kh, 0.2);
  g.strokeStyle = CYAN;
  write(g, 'ドリームカー', at(2.75, kw), Y(0.46), kh, kh * 0.14, 0.2);
  // the team's name under the rear window, small
  const th = 0.04 * px;
  const tw = measure('DOMI RACING', th);
  g.strokeStyle = WHITE;
  write(g, 'DOMI RACING', at(3.2, tw), Y(0.16), th, th * 0.2);
}

/**
 * The night-race livery's picture for a tier (null where there is no canvas: Node).
 * @param {'low'|'medium'|'high'} tier
 * @returns {THREE.CanvasTexture|null}
 */
export function createLiveryTexture(tier = 'medium') {
  if (typeof document === 'undefined') return null;
  const W = SIZE[tier] ?? SIZE.medium;
  const H = Math.round(W / 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const px = W / LENGTH; // pixels per metre along the car
  const bandH = LIVERY.band * H;
  // the two flanks
  for (const side of [0, 1]) {
    const y0 = LIVERY.bands[side] * H;
    const Y = (m) => y0 + (m / HEIGHT) * bandH;
    const flip = side === 1;
    const X = (m) => (flip ? W - m * px : m * px);
    flankGraphics(g, X, Y);
    flankWords(g, X, Y, bandH / HEIGHT, flip);
  }
  // the top: a wide magenta stripe and a narrow cyan one beside it, over the bonnet, the roof and the boot lid
  const y0 = LIVERY.bands[2] * H;
  const across = (x) => y0 + ((x + LIVERY.half) / (2 * LIVERY.half)) * bandH;
  g.fillStyle = MAGENTA;
  g.fillRect(0, across(-0.1), W, across(0.1) - across(-0.1));
  g.fillStyle = CYAN;
  g.fillRect(0, across(0.14), W, across(0.17) - across(0.14));
  g.fillRect(0, across(-0.17), W, across(-0.14) - across(-0.17));
  // ヨル on the bonnet, across the stripe, read from the driver's seat's side (the car's left)
  g.strokeStyle = '#08080c';
  g.lineCap = 'round';
  const kh = across(0.08) - across(-0.08);
  write(g, 'ヨル', 0.35 * px, across(0.08), kh, kh * 0.16, 0.25);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
