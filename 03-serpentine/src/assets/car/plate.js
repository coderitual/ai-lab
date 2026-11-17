// The number plate's picture, drawn at start-up: a Polish plate (520 x 114 mm), white and
// reflective with black characters, the blue band with its ring of stars and "PL", a thin
// black rim.
//
// The characters are this file's own: each is a few strokes on a grid 4 wide and 7 high,
// drawn with one pen, corners rounded where a letter turns (the plain, condensed look of a
// stamped plate). No font is used, so the plate reads the same on every machine.

import * as THREE from 'three';

/** Corner radii used below (grid units). */
const R = 1.5;
const S = 1.3;

/**
 * The strokes of each character. A stroke is a list of points [x, y] or [x, y, r] (a corner rounded to radius r);
 * a stroke that starts with 'z' is closed. x 0..4 left to right, y 0..7 bottom to top.
 */
const GLYPHS = {
  A: [[[0, 0], [2, 7], [4, 0]], [[0.75, 2.2], [3.25, 2.2]]],
  B: [[[0, 0], [0, 7], [3.7, 7, S], [3.7, 3.7, S], [0, 3.7]], [[0, 3.7], [4, 3.7, R], [4, 0, R], [0, 0]]],
  C: [[[4, 5.3], [4, 7, R], [0, 7, R], [0, 0, R], [4, 0, R], [4, 1.7]]],
  D: [['z', [0, 0], [0, 7], [4, 7, 1.9], [4, 0, 1.9]]],
  E: [[[4, 7], [0, 7], [0, 0], [4, 0]], [[0, 3.6], [3.2, 3.6]]],
  F: [[[4, 7], [0, 7], [0, 0]], [[0, 3.6], [3.2, 3.6]]],
  G: [[[4, 5.3], [4, 7, R], [0, 7, R], [0, 0, R], [4, 0, R], [4, 3.2], [2.2, 3.2]]],
  H: [[[0, 0], [0, 7]], [[4, 0], [4, 7]], [[0, 3.6], [4, 3.6]]],
  I: [[[0, 0], [0, 7]]],
  J: [[[3.6, 7], [3.6, 0, R], [0, 0, R], [0, 2]]],
  K: [[[0, 0], [0, 7]], [[4, 7], [0, 2.7]], [[1.45, 4.25], [4, 0]]],
  L: [[[0, 7], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 7], [2, 2.8], [4, 7], [4, 0]]],
  N: [[[0, 0], [0, 7], [4, 0], [4, 7]]],
  O: [['z', [0, 0, 1.8], [0, 7, 1.8], [4, 7, 1.8], [4, 0, 1.8]]],
  P: [[[0, 0], [0, 7], [4, 7, R], [4, 3.3, R], [0, 3.3]]],
  Q: [['z', [0, 0, 1.8], [0, 7, 1.8], [4, 7, 1.8], [4, 0, 1.8]], [[2.4, 1.9], [4.2, -0.3]]],
  R: [[[0, 0], [0, 7], [4, 7, R], [4, 3.3, R], [0, 3.3]], [[2, 3.3], [4, 0]]],
  S: [[[4, 5.5], [4, 7, R], [0, 7, R], [0, 3.6, R], [4, 3.6, R], [4, 0, R], [0, 0, R], [0, 1.5]]],
  T: [[[0, 7], [4, 7]], [[2, 7], [2, 0]]],
  U: [[[0, 7], [0, 0, 1.8], [4, 0, 1.8], [4, 7]]],
  V: [[[0, 7], [2, 0], [4, 7]]],
  W: [[[0, 7], [1, 0], [2, 4.6], [3, 0], [4, 7]]],
  X: [[[0, 0], [4, 7]], [[0, 7], [4, 0]]],
  Y: [[[0, 7], [2, 3.3], [4, 7]], [[2, 3.3], [2, 0]]],
  Z: [[[0, 7], [4, 7], [0, 0], [4, 0]]],
  0: [['z', [0.2, 0, 1.9], [0.2, 7, 1.9], [3.8, 7, 1.9], [3.8, 0, 1.9]]],
  1: [[[0, 5.2], [4, 7], [4, 0]]],
  2: [[[0, 5.4], [0, 7, R], [4, 7, R], [4, 4.1, 1.2], [0, 0], [4, 0]]],
  3: [[[0, 5.5], [0, 7, R], [4, 7, R], [4, 3.7, S], [1.5, 3.7]], [[1.5, 3.7], [4, 3.7, S], [4, 0, R], [0, 0, R], [0, 1.5]]],
  4: [[[3, 0], [3, 7], [0, 2.2], [4, 2.2]]],
  5: [[[4, 7], [0, 7], [0, 4.1], [4, 4.1, R], [4, 0, R], [0, 0, R], [0, 1.4]]],
  6: [[[4, 5.5], [4, 7, R], [0, 7, R], [0, 0, R], [4, 0, R], [4, 3.9, R], [0, 3.9]]],
  7: [[[0, 7], [4, 7], [1.4, 0]]],
  8: [['z', [0.2, 3.7, S], [0.2, 7, S], [3.8, 7, S], [3.8, 3.7, S]], ['z', [0, 0, R], [0, 3.7, R], [4, 3.7, R], [4, 0, R]]],
  9: [[[0, 1.5], [0, 0, R], [4, 0, R], [4, 7, R], [0, 7, R], [0, 3.1, R], [4, 3.1]]],
  '-': [[[0.8, 3.5], [3.2, 3.5]]],
};

/**
 * Draws one character with its lower left corner at (x, y) (y down the canvas), `w` wide and `h` high over all,
 * with a pen `pen` thick.
 */
function drawGlyph(g, char, x, y, w, h, pen) {
  const strokes = GLYPHS[char];
  if (!strokes) return;
  const ux = (w - pen) / 4;
  const uy = (h - pen) / 7;
  for (const stroke of strokes) {
    const closed = stroke[0] === 'z';
    const pts = closed ? stroke.slice(1) : stroke;
    g.beginPath();
    // the path is laid down in grid units; the pen is put to it with the transform taken off again, so that it
    // stays one thickness though the grid is not square
    g.save();
    g.translate(x + pen / 2, y - pen / 2);
    g.scale(ux, -uy);
    const n = pts.length;
    if (closed) {
      const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      g.moveTo(mid[0], mid[1]);
      for (let i = 1; i <= n; i++) {
        const p = pts[i % n];
        const q = pts[(i + 1) % n];
        if (p[2]) g.arcTo(p[0], p[1], q[0], q[1], p[2]);
        else g.lineTo(p[0], p[1]);
      }
      g.closePath();
    } else {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n; i++) {
        const p = pts[i];
        if (p[2] && i < n - 1) g.arcTo(p[0], p[1], pts[i + 1][0], pts[i + 1][1], p[2]);
        else g.lineTo(p[0], p[1]);
      }
    }
    g.restore();
    g.lineWidth = pen;
    g.stroke();
  }
}

/** Characters narrower than the rest: their width as a share of a full character's (the pen's own width is the least). */
const NARROW = { I: 0, 1: 0.5 };

/** Pixels per millimetre of the plate's picture. */
const PX = 2;

/**
 * @param {string} text capitals, digits, spaces and hyphens
 * @returns {{ map: THREE.Texture, normalMap: THREE.Texture } | null} null where there is no canvas (Node)
 */
export function createPlateTextures(text) {
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return null;
  const W = 520 * PX;
  const H = 114 * PX;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const mm = (v) => v * PX;
  const rounded = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  g.fillStyle = '#0c0c0c';
  g.fillRect(0, 0, W, H);
  // the white field, and the blue band 45 mm wide at its left end
  rounded(mm(1), mm(1), W - mm(2), H - mm(2), mm(7));
  g.fillStyle = '#efefea';
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = '#17389a';
  g.fillRect(0, 0, mm(45), H);
  g.restore();
  // twelve stars in a ring
  g.fillStyle = '#f4c800';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cx = mm(23) + Math.cos(a) * mm(11.5);
    const cy = mm(31) + Math.sin(a) * mm(11.5);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = mm(k % 2 ? 1.25 : 3.1);
      const b = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r);
    }
    g.fill();
  }
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.miterLimit = 2.5;
  g.strokeStyle = '#f2f2f2';
  drawGlyph(g, 'P', mm(10.5), mm(98), mm(11), mm(22), mm(3.2));
  drawGlyph(g, 'L', mm(24.5), mm(98), mm(11), mm(22), mm(3.2));
  // the thin black rim
  rounded(mm(3), mm(3), W - mm(6), H - mm(6), mm(5.5));
  g.strokeStyle = '#111';
  g.lineWidth = mm(1.6);
  g.stroke();
  // the characters: 80 mm high, 45 wide, a pen of 12.5; 8 mm apart, a space 26; squeezed if they would not fit
  const chars = [...text];
  const [cw, ch, pen, gap, space] = [45, 80, 12.5, 8, 26];
  const wide = (c) => (c in NARROW ? Math.max(pen, cw * NARROW[c]) : cw);
  let width = 0;
  chars.forEach((c, i) => {
    width += c === ' ' ? space - gap : wide(c) + (i < chars.length - 1 ? gap : 0);
  });
  const room = 520 - 45 - 2 * 9;
  const squeeze = Math.min(1, room / width);
  let x = 45 + 9 + (room - width * squeeze) / 2;
  for (const c of chars) {
    if (c === ' ') {
      x += (space - gap) * squeeze;
      continue;
    }
    const thick = pen * Math.min(1, squeeze + 0.08);
    drawGlyph(g, c, mm(x), mm(97), mm(Math.max(thick, wide(c) * squeeze)), mm(ch), mm(thick));
    x += (wide(c) + gap) * squeeze;
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // embossing: the characters and the rim stand 1 mm proud. The slope of the darkness, at half size.
  const img = g.getImageData(0, 0, W, H).data;
  const w = W / 2;
  const h = H / 2;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const o = (y * 2 * W + xx * 2) * 4;
      // dark ink is raised; the blue band and its yellow stars are flat print
      height[y * w + xx] = xx * 2 < mm(45.5) ? 0 : 1 - img[o + 1] / 255;
    }
  }
  const nd = new Uint8Array(w * h * 4);
  const at = (xx, yy) => height[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const dx = (at(xx + 1, y) - at(xx - 1, y)) * 0.8;
      const dy = (at(xx, y + 1) - at(xx, y - 1)) * 0.8;
      const l = Math.hypot(dx, dy, 1);
      const o = ((h - 1 - y) * w + xx) * 4; // flipped: the canvas's rows run down, the texture's up
      nd[o] = Math.round((-dx / l) * 127.5 + 127.5);
      nd[o + 1] = Math.round((dy / l) * 127.5 + 127.5);
      nd[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      nd[o + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(nd, w, h, THREE.RGBAFormat);
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.needsUpdate = true;
  return { map, normalMap };
}
