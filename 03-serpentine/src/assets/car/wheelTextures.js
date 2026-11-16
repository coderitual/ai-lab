// The wheel's textures, all computed at start-up.
//
// Three things are made here, once per quality tier, and shared by every wheel:
//
//  - the tyre: a height field of the tread (four grooves round the tyre, ribs
//    cut by sipes, open shoulders) and of the sidewall (fine rings, a hatched
//    band; no lettering), stored as a normal map with the height in alpha. A
//    second copy holds each row's average round the tyre: what a camera sees
//    of the same tyre once it turns fast. The material blends the two.
//  - a palette: one texel per finish (machined face, gloss black, disc, ...).
//    The rim and the brake are each one mesh; every vertex points at its
//    finish through its uv, so a whole two-tone wheel is one draw call.
//  - the spokes' coverage: for every radius, which part of a turn is bright
//    metal, which is black and which is open. It is stored as a running sum
//    round the wheel (minus its mean), so that the average over ANY arc is two
//    texture reads: the exact picture of the spokes smeared over the angle
//    they turn through while the shutter is open.

import * as THREE from 'three';
import { valueField } from '../../engine/noise.js';

/** Where the tread lies in the tyre's v coordinate: the sidewalls take a quarter each. */
export const TYRE_TREAD_V = [0.25, 0.75];
/** How many times the tyre texture repeats round the wheel, and the tread pitches in one repeat. */
export const TYRE_REPEAT = 9;
const PITCHES = 8;
/** What the height field stands for, in millimetres: the widths the texture is drawn over. */
const TREAD_MM = 205;
const SIDEWALL_MM = 125;
const REPEAT_MM = 230;
/** Height range stored in the normal map's alpha: alpha = 0.5 + height / HEIGHT_SPAN_MM. */
const HEIGHT_SPAN_MM = 16;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** The four grooves that run round the tyre: centre and width across the tread, mm from its inner edge. */
const GROOVES = [
  [37, 10],
  [82, 9.5],
  [125, 9.5],
  [166, 7.5],
];

/**
 * Depth (mm, 0 or negative) of a cut that crosses the tread at `angle` to the tyre's axis, once every `every`
 * pitches: `along` and `across` in mm, `width` and `depth` of the cut in mm.
 */
function crossCut(along, across, angle, every, phase, width, depth) {
  const period = (REPEAT_MM / PITCHES) * every;
  const k = (along + across * Math.tan(angle)) / period + phase;
  const off = Math.abs(k - Math.floor(k) - 0.5) * period;
  return -depth * clamp01((width / 2 - off) / 0.9 + 0.5);
}

/** Height of the tread, mm: `along` round the tyre, `across` from the inner edge of the tread to the outer. */
function treadHeight(along, across) {
  let h = 0;
  for (const [centre, width] of GROOVES) h = Math.min(h, -7 * clamp01((width / 2 - Math.abs(across - centre)) / 1.1));
  if (h < -0.01) return h;
  const deg = Math.PI / 180;
  let cut = 0;
  if (across < 32) {
    // inner shoulder: open slots every pitch, a fine sipe between them
    cut = Math.min(crossCut(along, across, 8 * deg, 1, 0, 2.6, 5.5) * smooth(27, 22, across), crossCut(along, across, 8 * deg, 1, 0.5, 1.1, 2.5) * smooth(30, 26, across));
  } else if (across < 78) {
    cut = crossCut(along, across, -28 * deg, 1, 0.2, 1.4, 3.5);
  } else if (across < 121) {
    // the centre rib: short notches from alternate edges
    const fromInner = crossCut(along, across, 20 * deg, 1, 0, 1.3, 3) * smooth(106, 102, across);
    const fromOuter = crossCut(along, across, 20 * deg, 1, 0.5, 1.3, 3) * smooth(101, 105, across);
    cut = Math.min(fromInner, fromOuter);
  } else if (across < 163) {
    cut = crossCut(along, across, 28 * deg, 1, 0.7, 1.4, 3.5);
  } else {
    // outer shoulder: bigger blocks, closed towards the groove
    cut = crossCut(along, across, -6 * deg, 1, 0.35, 3.2, 5.5) * smooth(176, 181, across);
  }
  return Math.min(h, cut);
}

/** Height of a sidewall, mm: `s` from the bead (0) to the edge of the tread (1). `outer`: the car's outer side. */
function sidewallHeight(along, s, outer) {
  let h = 0;
  // the shoulder's slots run on over the edge and fade out
  if (s > 0.74) {
    const slot = outer ? crossCut(along, 190, -6 * (Math.PI / 180), 1, 0.35, 3.2, 4) : crossCut(along, 10, 8 * (Math.PI / 180), 1, 0, 2.6, 4);
    h += slot * smooth(0.76, 0.93, s);
  }
  // two raised rings bound a band of fine hatching, in panels with plain ones between (where lettering would be)
  const mm = s * SIDEWALL_MM;
  for (const ring of [45, 84]) h += 0.6 * clamp01(1.5 - Math.abs(mm - ring) / 0.9);
  if (mm > 48 && mm < 81) {
    const panel = (along / REPEAT_MM) * 2;
    const inPanel = panel - Math.floor(panel);
    const on = smooth(0.04, 0.07, inPanel) * smooth(0.7, 0.67, inPanel) * smooth(48, 51, mm) * smooth(81, 78, mm);
    h += 0.4 * on * (0.5 + 0.5 * Math.cos(((along + mm * 0.8) / 3.6) * Math.PI * 2));
  }
  // fine rings above the rim protector
  if (mm > 13 && mm < 29) h += 0.3 * (0.5 + 0.5 * Math.cos(((mm - 13) / 4) * Math.PI * 2)) * smooth(13, 14, mm) * smooth(29, 28, mm);
  return h;
}

/**
 * @typedef {object} TyreTextures
 * @property {THREE.DataTexture} normal tangent-space normals of the tread and sidewalls, the height in alpha
 * @property {THREE.DataTexture} spun the same, averaged round the tyre (one texel wide)
 * @property {THREE.DataTexture} color what the rubber looks like across the tyre (bead to bead, one texel wide)
 * @property {THREE.DataTexture} rough its roughness (green, as three.js reads it)
 */

/**
 * The tyre's maps. u runs round the tyre (TYRE_REPEAT repeats), v across it from the inner bead to the outer:
 * a quarter sidewall, half tread, a quarter sidewall.
 * @param {number} width texels round one repeat
 * @param {number} height texels from bead to bead
 * @param {number} anisotropy
 * @returns {TyreTextures}
 */
export function createTyreTextures(width, height, anisotropy = 1) {
  const grainSize = 128;
  const grain = valueField(grainSize, { seed: 23, cells: 32, octaves: 2 });
  const field = new Float32Array(width * height);
  const mmPerU = REPEAT_MM / width;
  const [v0, v1] = TYRE_TREAD_V;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const along = (x + 0.5) * mmPerU;
      let h;
      if (v < v0) h = sidewallHeight(along, v / v0, false);
      else if (v > v1) h = sidewallHeight(along, (1 - v) / (1 - v1), true);
      else h = treadHeight(along, ((v - v0) / (v1 - v0)) * TREAD_MM);
      field[y * width + x] = h + 0.08 * (grain[(y % grainSize) * grainSize + (x % grainSize)] - 0.5);
    }
  }

  // millimetres per texel across the tyre: the sidewalls and the tread are drawn at slightly different scales
  const mmPerV = (v) => (v < v0 || v > v1 ? SIDEWALL_MM / (v0 * height) : TREAD_MM / ((v1 - v0) * height));
  const data = new Uint8Array(width * height * 4);
  const spun = new Uint8Array(height * 4);
  for (let y = 0; y < height; y++) {
    const up = Math.min(height - 1, y + 1) * width;
    const down = Math.max(0, y - 1) * width;
    const dv = mmPerV((y + 0.5) / height) * (y > 0 && y < height - 1 ? 2 : 1);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sh = 0;
    for (let x = 0; x < width; x++) {
      const right = (x + 1) % width;
      const left = (x + width - 1) % width;
      const nx = -(field[y * width + right] - field[y * width + left]) / (2 * mmPerU);
      const ny = -(field[up + x] - field[down + x]) / dv;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const h = clamp01(0.5 + field[y * width + x] / HEIGHT_SPAN_MM);
      const o = (y * width + x) * 4;
      data[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[o + 3] = Math.round(h * 255);
      sx += nx * inv;
      sy += ny * inv;
      sz += inv;
      sh += h;
    }
    spun[y * 4] = Math.round(((sx / width) * 0.5 + 0.5) * 255);
    spun[y * 4 + 1] = Math.round(((sy / width) * 0.5 + 0.5) * 255);
    spun[y * 4 + 2] = Math.round(((sz / width) * 0.5 + 0.5) * 255);
    spun[y * 4 + 3] = Math.round((sh / width) * 255);
  }

  const normal = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.magFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.generateMipmaps = true;
  normal.anisotropy = anisotropy;
  normal.repeat.set(TYRE_REPEAT, 1);
  normal.needsUpdate = true;

  const column = (bytes) => {
    const texture = new THREE.DataTexture(bytes, 1, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };

  // colour and roughness across the tyre: dusty tread, cleaner and slightly smoother sidewalls, a scuffed shoulder
  const colorBytes = new Uint8Array(height * 4);
  const roughBytes = new Uint8Array(height * 4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const tread = smooth(v0 - 0.03, v0 + 0.01, v) * smooth(v1 + 0.03, v1 - 0.01, v);
    const shoulder = Math.max(smooth(v0 - 0.07, v0, v) * smooth(v0 + 0.05, v0, v), smooth(v1 + 0.07, v1, v) * smooth(v1 - 0.05, v1, v));
    const albedo = 0.017 + 0.011 * tread + 0.006 * shoulder;
    const byte = Math.round(toSrgb(albedo) * 255);
    colorBytes.set([byte, byte, byte, 255], y * 4);
    roughBytes.set([255, Math.round((0.78 + 0.14 * tread) * 255), 0, 255], y * 4);
  }
  const color = column(colorBytes);
  color.colorSpace = THREE.SRGBColorSpace;
  return { normal, spun: column(spun), color, rough: column(roughBytes) };
}

/**
 * The finishes of the wheel and its brake, as rows of the palette: linear colour, roughness, metalness. A vertex
 * picks one with paletteU().
 */
export const FINISH = {
  machined: { color: [0.8, 0.8, 0.8], roughness: 0.22, metalness: 1 },
  black: { color: [0.012, 0.012, 0.013], roughness: 0.16, metalness: 0.3 },
  chrome: { color: [0.83, 0.84, 0.86], roughness: 0.1, metalness: 1 },
  capRing: { color: [0.62, 0.63, 0.64], roughness: 0.34, metalness: 1 },
  bolt: { color: [0.02, 0.02, 0.021], roughness: 0.38, metalness: 0.8 },
  valve: { color: [0.022, 0.022, 0.022], roughness: 0.7, metalness: 0 },
  disc: { color: [0.35, 0.34, 0.33], roughness: 0.42, metalness: 1 },
  discWorn: { color: [0.29, 0.28, 0.27], roughness: 0.5, metalness: 1 },
  discEdge: { color: [0.11, 0.1, 0.095], roughness: 0.72, metalness: 0.8 },
  hat: { color: [0.05, 0.05, 0.052], roughness: 0.6, metalness: 0.5 },
  caliper: { color: [0.45, 0.45, 0.46], roughness: 0.45, metalness: 0.6 },
  iron: { color: [0.055, 0.052, 0.05], roughness: 0.7, metalness: 0.4 },
  matte: { color: [0.02, 0.02, 0.022], roughness: 0.68, metalness: 0 },
  pad: { color: [0.03, 0.028, 0.026], roughness: 0.85, metalness: 0 },
};
const FINISH_NAMES = Object.keys(FINISH);
const PALETTE_SIZE = 16;

/** The u coordinate (v is 0.5) of a finish's texel. */
export function paletteU(name) {
  const index = FINISH_NAMES.indexOf(name);
  if (index < 0) throw new Error(`Unknown finish: ${name}`);
  return (index + 0.5) / PALETTE_SIZE;
}

/**
 * The palette as the two textures a three.js material reads: `color` (sRGB) and `orm` (green roughness, blue
 * metalness: give it to both roughnessMap and metalnessMap).
 * @returns {{ color: THREE.DataTexture, orm: THREE.DataTexture }}
 */
export function createPalette() {
  const colorBytes = new Uint8Array(PALETTE_SIZE * 4);
  const ormBytes = new Uint8Array(PALETTE_SIZE * 4);
  FINISH_NAMES.forEach((name, i) => {
    const finish = FINISH[name];
    colorBytes.set([...finish.color.map((c) => Math.round(toSrgb(c) * 255)), 255], i * 4);
    ormBytes.set([255, Math.round(finish.roughness * 255), Math.round(finish.metalness * 255), 255], i * 4);
  });
  const make = (bytes) => {
    const texture = new THREE.DataTexture(bytes, PALETTE_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };
  const color = make(colorBytes);
  color.colorSpace = THREE.SRGBColorSpace;
  return { color, orm: make(ormBytes) };
}

/**
 * The spokes' coverage, in polar coordinates: u is the angle round the wheel (one turn across the texture, from
 * the first pair), v the radius (0 at the axle, 1 at `radius`).
 *
 *   red, green   running sums round the wheel of (bright - its mean) and (solid - its mean), as fractions of a turn
 *   blue, alpha  those means: how much of the circle at this radius is bright metal, and how much is not open
 *
 * The mean over the arc from u0 to u1 is then  mean + (sum(u1) - sum(u0)) / (u1 - u0).
 *
 * @param {(a: number, b: number) => number} classify what the wheel's face is at a point of its plane (metres;
 *   b along the first pair, a across it): 0 open, 1 bright, 2 black
 * @param {{ width: number, height: number, radius: number, capRadius: number }} options `width` must be a multiple
 *   of 15: the spokes repeat five times round the wheel and the star in the cap three times
 * @returns {THREE.DataTexture} half floats, with its own mip chain
 */
export function createCoverTexture(classify, { width, height, radius, capRadius }) {
  const sub = 4; // samples per texel along each axis
  const level = new Float32Array(width * height * 4);
  const bright = new Float32Array(width);
  const solid = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    const fold = ((y + 0.5) / height) * radius < capRadius ? 3 : 5;
    const sector = width / fold;
    bright.fill(0);
    solid.fill(0);
    // one sector is sampled; the others are copies of it
    for (let x = 0; x < sector; x++) {
      let nb = 0;
      let ns = 0;
      for (let j = 0; j < sub; j++) {
        const r = ((y + (j + 0.5) / sub) / height) * radius;
        for (let i = 0; i < sub; i++) {
          const angle = ((x + (i + 0.5) / sub) / width) * Math.PI * 2;
          const kind = classify(r * Math.sin(angle), r * Math.cos(angle));
          if (kind === 1) nb++;
          if (kind !== 0) ns++;
        }
      }
      for (let k = 0; k < fold; k++) {
        bright[x + k * sector] = nb / (sub * sub);
        solid[x + k * sector] = ns / (sub * sub);
      }
    }
    let meanB = 0;
    let meanS = 0;
    for (let x = 0; x < width; x++) {
      meanB += bright[x] / width;
      meanS += solid[x] / width;
    }
    let sumB = 0;
    let sumS = 0;
    for (let x = 0; x < width; x++) {
      // the sum up to the middle of this texel, where the texture is read
      const o = (y * width + x) * 4;
      level[o] = sumB + (0.5 * (bright[x] - meanB)) / width;
      level[o + 1] = sumS + (0.5 * (solid[x] - meanS)) / width;
      level[o + 2] = meanB;
      level[o + 3] = meanS;
      sumB += (bright[x] - meanB) / width;
      sumS += (solid[x] - meanS) / width;
    }
  }

  // the mip chain, halving while both sides stay even (sums and means average like anything else)
  const toHalf = (floats) => {
    const out = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) out[i] = THREE.DataUtils.toHalfFloat(floats[i]);
    return out;
  };
  const mipmaps = [{ data: toHalf(level), width, height }];
  let last = level;
  let w = width;
  let h = height;
  while (w % 2 === 0 && h % 2 === 0 && h > 2) {
    const nw = w / 2;
    const nh = h / 2;
    const next = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const a = (y * 2 * w + x * 2) * 4;
        const o = (y * nw + x) * 4;
        for (let k = 0; k < 4; k++) next[o + k] = 0.25 * (last[a + k] + last[a + 4 + k] + last[a + w * 4 + k] + last[a + w * 4 + 4 + k]);
      }
    }
    mipmaps.push({ data: toHalf(next), width: nw, height: nh });
    last = next;
    w = nw;
    h = nh;
  }

  const texture = new THREE.DataTexture(mipmaps[0].data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mipmaps = mipmaps;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
