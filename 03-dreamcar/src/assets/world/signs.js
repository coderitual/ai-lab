// Everything painted on the circuit's dressing, in one picture drawn at
// start-up: the gantry's name board, the trackside boards, the distance
// boards, the tyre walls' rubber, the pit building's doors and glazing, and a
// row of plain swatches (steel, concrete, paint) for every face that is just a
// colour. With one picture and one material the whole dressing of a stretch
// of road is one draw call.
//
// Beside it a second picture of the same layout holds only what glows (lit
// windows, the light panels of the marshal posts): the material's emissive
// map, turned up by the time of day.
//
// Every word and mark here is made up: invented firms of invented places in
// this project's own letters (assets/car/plate.js draws them stroke by stroke,
// no font), with simple abstract marks. Nothing is meant to resemble a real
// name or logo. The boards are big fields of flat colour with large letters,
// so that at speed they streak cleanly and at rest they read.

import * as THREE from 'three';
import { drawGlyph } from '../car/plate.js';

/** The atlas at full size (px); the low tier draws it at half. */
const W = 2048;
const H = 1536;

/** The circuit's own name, on the gantry and on the pit building. */
export const CIRCUIT_NAME = 'CALVENNA';

/**
 * The trackside boards: [name, field, letters, mark, mark colour]. Field and letters are CSS colours. The mark
 * is one of the shapes drawn by drawMark().
 */
const BOARDS = [
  ['VARNO', '#b8231d', '#f4f1ea', 'ring', '#f4f1ea'],
  ['TORVEL', '#eeeeea', '#16346b', 'diamond', '#1d5fc0'],
  ['MIRALTA', '#1c1d21', '#e3b64a', 'peak', '#e3b64a'],
  ['BRENNIK', '#f2c21b', '#141414', 'bars', '#141414'],
  ['OSKALI', '#1a56a8', '#f6f6f2', 'half', '#f6f6f2'],
  ['LUNDAR', '#0f6b46', '#f3f3ee', 'chevron', '#f3f3ee'],
  ['PELLORA', '#f1f0eb', '#c0261f', 'dot', '#c0261f'],
  [CIRCUIT_NAME, '#163a4c', '#efe6cf', 'lake', '#e59a2c'],
  ['ARVENT', '#e8742a', '#1b1b1d', 'wave', '#1b1b1d'],
  ['SOLMERE', '#2a2b30', '#f1f1ec', 'sun', '#f0a224'],
  // a red block and a white one with the word across both (the run of the ledge's first bend)
  ['TERNA', '#c4261f', '#f4f1ea', 'split', '#f2f1ec'],
];
/** Designs by index, for runs that want a palette of their own. */
export const DESIGN = { varno: 0, torvel: 1, miralta: 2, brennik: 3, oskali: 4, lundar: 5, pellora: 6, calvenna: 7, arvent: 8, solmere: 9, terna: 10 };
/** Board designs available (cells), and how many there are. */
export const BOARD_COUNT = BOARDS.length;

/**
 * The tall hoardings of the lake side of the straight (2 : 1, about 7.6 by 3.8 m): [layout, field, ink, words,
 * accent]. Bold blocks of flat colour with one or two big words, so that at speed each streaks as one colour.
 */
const TALL = [
  ['bar', '#14234a', '#f2f2ee', ['VARNO'], '#d23a2c'],
  ['two', '#c4261f', '#f6f3ec', ['TORVEL', 'SPORT'], '#f6f3ec'],
  ['oval', '#f1f1ec', '#1f7a4c', ['OSKALI'], '#1f7a4c'],
  ['grid', '#1d5fb8', '#f6f6f2', ['MI', 'RA'], '#f6f6f2'],
  ['mark', '#f2f1ec', '#c0261f', ['PELLORA'], '#c0261f'],
  ['bar', '#1b1c20', '#f0c020', ['BRENNIK'], '#f0c020'],
  ['two', '#0f6b46', '#f3f3ee', ['LUNDAR', 'ACQUA'], '#f3f3ee'],
  ['mark', '#e8742a', '#17181b', ['SOLMERE'], '#17181b'],
];
export const TALL_COUNT = TALL.length;

/** The distance boards' labels, in their cells' order. */
const DISTANCES = ['300', '200', '100', '150'];

/** Plain colours (sRGB hex), each a swatch of the atlas: faces that are only a colour point at one. */
export const SWATCH = {
  white: '#e6e6e1',
  steel: '#7d848a',
  dark: '#1a1c1f',
  concrete: '#9a978f',
  rubber: '#121213',
  red: '#b3241d',
  frame: '#3b4146',
  pitWall: '#d9d8d2',
  roof: '#5d6166',
  glassDark: '#1d2a33',
  asphalt: '#2f3032',
  fence: '#4a5055',
  green: '#2f5a3e',
  stand: '#8d9196',
  seat: '#2b5ea0',
  orange: '#d9772a',
  yellow: '#e2b52a',
  lampHood: '#0b0c0d',
};

// ---- the layout (in units of the full-size atlas)
const GANTRY_CELL = [0, 0, 2048, 256];
const DIST_CELL = (k) => (k < 3 ? [k * 256, 256, 256, 256] : [1024 + (k - 3) * 128, 896, 128, 128]);
const BOARD_CELL = (k) => [(k % 4) * 512, 512 + Math.floor(k / 4) * 128, 512, 128];
const TALL_CELL = (k) => [(k % 4) * 512, 1024 + Math.floor(k / 4) * 256, 512, 256];
/** Special cells: tyres (plain, white band, red band), garage door, glazing, light panel, warning stripes. */
const SPECIAL = {
  tyres: [768, 256, 128, 128],
  tyresWhite: [896, 256, 128, 128],
  tyresRed: [1024, 256, 128, 128],
  garage: [1152, 256, 128, 128],
  glazing: [1280, 256, 128, 128],
  panel: [1408, 256, 128, 128],
  stripes: [1536, 256, 256, 128],
  checker: [1792, 256, 256, 128],
};
const SWATCH_KEYS = Object.keys(SWATCH);
/** Swatches: 64 px squares along the row under the special cells (16 to a row, from x 768). */
const SWATCH_CELL = (k) => [768 + (k % 20) * 64, 384 + Math.floor(k / 20) * 64, 64, 64];

/**
 * The atlas: its two textures and where things are in it, as uv rectangles [u0, v0, u1, v1] (v up, as three.js
 * reads a texture that is flipped on upload).
 * @param {{ tier: string, anisotropy?: number }} options
 */
export function createSigns({ tier, anisotropy = 1 }) {
  const scale = tier === 'low' ? 0.5 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  const glow = document.createElement('canvas');
  glow.width = (W * scale) / 2;
  glow.height = (H * scale) / 2;
  const e = glow.getContext('2d');
  e.scale(scale / 2, scale / 2);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);

  g.fillStyle = '#808080';
  g.fillRect(0, 0, W, H);
  drawGantryBoard(g, GANTRY_CELL);
  // the name board is lit from behind at dusk and at night: its letters and mark glow, dimmer than a window
  drawGantryGlow(e, GANTRY_CELL);
  DISTANCES.forEach((label, k) => drawDistance(g, DIST_CELL(k), label));
  BOARDS.forEach((b, k) => drawBoard(g, BOARD_CELL(k), b));
  TALL.forEach((b, k) => drawTall(g, TALL_CELL(k), b));
  drawTyres(g, SPECIAL.tyres, null);
  drawTyres(g, SPECIAL.tyresWhite, '#e8e8e2');
  drawTyres(g, SPECIAL.tyresRed, '#b3241d');
  drawGarage(g, e, SPECIAL.garage);
  drawGlazing(g, e, SPECIAL.glazing);
  drawPanel(g, e, SPECIAL.panel);
  drawStripes(g, SPECIAL.stripes);
  drawChecker(g, SPECIAL.checker);
  SWATCH_KEYS.forEach((key, k) => {
    const [x, y, w, h] = SWATCH_CELL(k);
    g.fillStyle = SWATCH[key];
    g.fillRect(x, y, w, h);
  });

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const emissiveMap = new THREE.CanvasTexture(glow);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  /** A cell in uv, inset by `pad` px so that the filter does not reach the neighbour. */
  const uvOf = ([x, y, w, h], pad = 3) => [(x + pad) / W, 1 - (y + h - pad) / H, (x + w - pad) / W, 1 - (y + pad) / H];
  const swatches = {};
  SWATCH_KEYS.forEach((key, k) => {
    const [x, y, w, h] = SWATCH_CELL(k);
    const u = (x + w / 2) / W;
    const v = 1 - (y + h / 2) / H;
    swatches[key] = [u, v, u, v];
  });
  return {
    map,
    emissiveMap,
    gantry: uvOf(GANTRY_CELL, 2),
    distance: Object.fromEntries(DISTANCES.map((label, k) => [label, uvOf(DIST_CELL(k))])),
    boards: BOARDS.map((_, k) => uvOf(BOARD_CELL(k))),
    tall: TALL.map((_, k) => uvOf(TALL_CELL(k))),
    special: Object.fromEntries(Object.entries(SPECIAL).map(([key, cell]) => [key, uvOf(cell, 2)])),
    swatch: swatches,
    dispose() {
      map.dispose();
      emissiveMap.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Lettering

/** Width of a character as a share of the letter height (the glyphs are 4 by 7 on their grid). */
const NARROW = { I: 0.18, 1: 0.4 };

/**
 * Writes a word of capitals and digits with its baseline at y, starting at x, letters `h` high. `wide` stretches
 * the letters (1 = the plate's proportions), `slant` leans them (italic, as a share of the height).
 * @returns {number} the width written
 */
function write(g, text, x, y, h, { pen = 0.17, wide = 1.15, gap = 0.2, slant = 0, measure = false } = {}) {
  const p = pen * h;
  const cw = (4 / 7) * h * wide;
  let cx = 0;
  for (const c of text) {
    if (c === ' ') {
      cx += cw * 0.6;
      continue;
    }
    const w = NARROW[c] != null ? Math.max(p, NARROW[c] * h) : cw;
    if (!measure) {
      g.save();
      g.translate(x + cx, y);
      if (slant) g.transform(1, 0, -slant, 1, 0, 0);
      drawGlyph(g, c, 0, 0, w, h, p);
      g.restore();
    }
    cx += w + gap * h;
  }
  return cx - gap * h;
}

/** Writes a word centred in a box, as large as fits `maxH` high and `maxW` wide. */
function writeFit(g, text, cx, cy, maxW, maxH, options = {}) {
  const width = write(g, text, 0, 0, maxH, { ...options, measure: true });
  const h = Math.min(maxH, (maxH * maxW) / width);
  const w = write(g, text, 0, 0, h, { ...options, measure: true });
  g.lineCap = 'butt';
  // bevelled corners: a sharp V or A keeps a clean point instead of a long mitre spike
  g.lineJoin = 'bevel';
  write(g, text, cx - w / 2 + (options.slant ?? 0) * h * 0.5, cy + h / 2, h, options);
  return { w, h };
}

/** The abstract marks: simple shapes in a square of side `s` centred at (x, y). */
function drawMark(g, kind, x, y, s, color, field) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  const r = s / 2;
  g.beginPath();
  switch (kind) {
    case 'ring':
      g.lineWidth = s * 0.16;
      g.arc(x, y, r * 0.78, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(x, y, r * 0.26, 0, Math.PI * 2);
      g.fill();
      break;
    case 'diamond':
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.8, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r * 0.8, y);
      g.fill();
      g.fillStyle = field;
      g.fillRect(x - r * 0.8, y - s * 0.05, s * 0.8, s * 0.1);
      break;
    case 'peak':
      g.moveTo(x - r, y + r * 0.7);
      g.lineTo(x - r * 0.15, y - r * 0.8);
      g.lineTo(x + r * 0.25, y - r * 0.1);
      g.lineTo(x + r * 0.5, y - r * 0.45);
      g.lineTo(x + r, y + r * 0.7);
      g.fill();
      break;
    case 'bars':
      g.fillRect(x - r, y - r * 0.7, s * 0.3, s * 1.4 * 0.7 * 1.43);
      g.fillRect(x - r * 0.2, y - r * 0.3, s * 0.3, s * 0.65);
      g.fillRect(x + r * 0.6, y - r * 0.7, s * 0.2, s * 0.25);
      break;
    case 'half':
      g.arc(x, y + r * 0.35, r, Math.PI, 0);
      g.fill();
      break;
    case 'chevron':
      g.lineWidth = s * 0.2;
      g.lineJoin = 'miter';
      g.moveTo(x - r * 0.6, y - r * 0.8);
      g.lineTo(x + r * 0.35, y);
      g.lineTo(x - r * 0.6, y + r * 0.8);
      g.stroke();
      break;
    case 'dot':
      g.arc(x, y, r * 0.6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'lake':
      // a peak over two lines of water, in a disc
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = field;
      g.beginPath();
      g.moveTo(x - r * 0.62, y + r * 0.12);
      g.lineTo(x - r * 0.05, y - r * 0.62);
      g.lineTo(x + r * 0.62, y + r * 0.12);
      g.fill();
      g.fillRect(x - r * 0.62, y + r * 0.28, r * 1.24, r * 0.13);
      g.fillRect(x - r * 0.45, y + r * 0.52, r * 0.9, r * 0.13);
      break;
    case 'wave':
      g.lineWidth = s * 0.14;
      for (const dy of [-0.3, 0.15]) {
        g.beginPath();
        g.moveTo(x - r, y + dy * r);
        g.bezierCurveTo(x - r * 0.4, y + (dy - 0.5) * r, x + r * 0.1, y + (dy + 0.5) * r, x + r, y + dy * r);
        g.stroke();
      }
      break;
    case 'sun':
      g.arc(x, y, r * 0.45, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = s * 0.08;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62);
        g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
        g.stroke();
      }
      break;
    default:
      break;
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// The cells

/** The circuit's name: heavy, wide letters that fill the board. */
const NAME_LETTERS = { pen: 0.33, wide: 1.55, slant: 0.1, gap: 0.16 };

function drawGantryBoard(g, [x, y, w, h]) {
  g.fillStyle = '#163a4c';
  g.fillRect(x, y, w, h);
  // a lighter rim and a thin gold rule along the foot
  g.strokeStyle = '#2b5a70';
  g.lineWidth = 10;
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  g.fillStyle = '#e59a2c';
  g.fillRect(x + 40, y + h - 34, w - 80, 8);
  drawMark(g, 'lake', x + 150, y + h * 0.46, 170, '#e59a2c', '#163a4c');
  g.strokeStyle = '#efe6cf';
  writeFit(g, CIRCUIT_NAME, x + 1070, y + h * 0.47, 1640, 185, NAME_LETTERS);
}

function drawGantryGlow(e, [x, y, w, h]) {
  e.strokeStyle = '#6b604c';
  e.lineWidth = 1;
  writeFit(e, CIRCUIT_NAME, x + 1070, y + h * 0.47, 1640, 185, NAME_LETTERS);
  drawMark(e, 'lake', x + 150, y + h * 0.46, 170, '#5a3c14', '#000000');
}

function drawDistance(g, [x, y, w, h], label) {
  g.fillStyle = '#f2f2ee';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#141414';
  g.lineWidth = w * 0.055;
  g.strokeRect(x + w * 0.04, y + h * 0.04, w * 0.92, h * 0.92);
  writeFit(g, label, x + w / 2, y + h / 2, w * 0.73, h * 0.47, { pen: 0.2, wide: 1.0, gap: 0.22 });
}

function drawTall(g, [x, y, w, h], [layout, field, ink, words, accent]) {
  g.fillStyle = field;
  g.fillRect(x, y, w, h);
  g.strokeStyle = ink;
  const bold = { pen: 0.24, wide: 1.2, slant: 0.08, gap: 0.22 };
  if (layout === 'bar') {
    writeFit(g, words[0], x + w / 2, y + h * 0.44, w - 60, 110, bold);
    g.fillStyle = accent;
    g.fillRect(x + 50, y + h * 0.72, w - 100, 16);
  } else if (layout === 'two') {
    writeFit(g, words[0], x + w / 2, y + h * 0.36, w - 60, 100, bold);
    writeFit(g, words[1], x + w / 2, y + h * 0.72, w * 0.5, 46, { ...bold, pen: 0.2 });
  } else if (layout === 'oval') {
    g.save();
    g.strokeStyle = accent;
    g.lineWidth = 16;
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w * 0.42, h * 0.36, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    writeFit(g, words[0], x + w / 2, y + h / 2, w * 0.66, 84, bold);
  } else if (layout === 'grid') {
    writeFit(g, words[0], x + w / 2, y + h * 0.3, w * 0.5, 96, { ...bold, gap: 0.6 });
    writeFit(g, words[1], x + w / 2, y + h * 0.72, w * 0.5, 96, { ...bold, gap: 0.6 });
  } else {
    drawMark(g, 'dot', x + 70, y + h / 2, 90, accent, field);
    writeFit(g, words[0], x + w / 2 + 40, y + h / 2, w - 170, 96, bold);
  }
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(x, y + h - 10, w, 10);
}

function drawBoard(g, [x, y, w, h], [name, field, ink, mark, markColor]) {
  g.fillStyle = field;
  g.fillRect(x, y, w, h);
  if (mark === 'split') {
    // the right part white, the word in red over it; a white bar on the red
    g.fillStyle = markColor;
    g.fillRect(x + w * 0.42, y, w * 0.58, h);
    g.fillRect(x + 30, y + h / 2 - 12, w * 0.3, 20);
    g.strokeStyle = field;
    writeFit(g, name, x + w * 0.71, y + h / 2 - 4, w * 0.5, 70, { pen: 0.2, wide: 1.1, slant: 0.1 });
    return;
  }
  // a darker band along the foot, as a printed board has
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x, y + h - 12, w, 12);
  drawMark(g, mark, x + 62, y + h / 2 - 4, 76, markColor, field);
  g.strokeStyle = ink;
  writeFit(g, name, x + 112 + (w - 130) / 2, y + h / 2 - 4, w - 150, 70, { pen: 0.19, wide: 1.1, slant: 0.1 });
}

/** Four tyres stacked (v up the cell), seen from the front: rubber with a lighter tread line between them. */
function drawTyres(g, [x, y, w, h], band) {
  for (let k = 0; k < 4; k++) {
    const ty = y + (k * h) / 4;
    const grad = g.createLinearGradient(0, ty, 0, ty + h / 4);
    const base = band && k % 2 === 1 ? band : '#161617';
    grad.addColorStop(0, '#060606');
    grad.addColorStop(0.18, base);
    grad.addColorStop(0.5, band && k % 2 === 1 ? base : '#232325');
    grad.addColorStop(0.82, base);
    grad.addColorStop(1, '#060606');
    g.fillStyle = grad;
    g.fillRect(x, ty, w, h / 4);
  }
}

function drawGarage(g, e, [x, y, w, h]) {
  // a roller door, its slats, a lit strip of the garage under it where it stands a little open
  g.fillStyle = '#c9cbcc';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#a9acae';
  for (let k = 0; k < 16; k++) g.fillRect(x, y + k * 6.5, w, 2);
  g.fillStyle = '#2a2d30';
  g.fillRect(x, y + h - 22, w, 22);
  e.fillStyle = '#ffd9a0';
  e.fillRect(x, y + h - 20, w, 18);
}

function drawGlazing(g, e, [x, y, w, h]) {
  // the glazed upper floor: tall panes with mullions, a lit room behind
  g.fillStyle = '#1f2c35';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#3a4a55';
  g.fillRect(x, y + h * 0.15, w, h * 0.3);
  e.fillStyle = '#ffce8a';
  e.fillRect(x, y, w, h);
  e.fillStyle = '#7a5a30';
  e.fillRect(x, y + h * 0.7, w, h * 0.3);
  for (const c of [g, e]) {
    c.fillStyle = '#26292c';
    c.fillRect(x, y, 6, h);
    c.fillRect(x + w / 2 - 3, y, 6, h);
    c.fillRect(x + w - 6, y, 6, h);
  }
}

function drawPanel(g, e, [x, y, w, h]) {
  g.fillStyle = '#d8d5cc';
  g.fillRect(x, y, w, h);
  e.fillStyle = '#fff6e0';
  e.fillRect(x + 6, y + 6, w - 12, h - 12);
}

function drawStripes(g, [x, y, w, h]) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#efefea';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#c4261f';
  for (let k = -2; k < 8; k++) {
    g.beginPath();
    g.moveTo(x + k * 48, y + h);
    g.lineTo(x + k * 48 + 24, y + h);
    g.lineTo(x + k * 48 + 24 + h, y);
    g.lineTo(x + k * 48 + h, y);
    g.fill();
  }
  g.restore();
}

function drawChecker(g, [x, y, w, h]) {
  const n = 8;
  const c = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < h / c; j++) {
    g.fillStyle = (i + j) % 2 ? '#141414' : '#f2f2ee';
    g.fillRect(x + i * c, y + j * c, c, c);
  }
}
