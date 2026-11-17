// The forest's one texture: an atlas drawn on a canvas at start-up, so every
// tree of every species is drawn with one material.
//
// Foliage is drawn pale (the tree's colour is its instance tint times this):
//   FROND    a spruce twig seen from above: a stem, side shoots, needles; alpha
//   LEAVES   a spray of small leaves (birch); alpha
//   MASS     needles packed solid, for the core of a crown; opaque
//   SIL      a whole tree's silhouette per species, for the far level of detail; alpha
// Bark is drawn in its own colour (not tinted):
//   BARK     grey-brown, flaking in plates (spruce, fir, larch)
//   BIRCH    white with dark lenticels and black diamonds
//
// Canvas coordinates are the texture coordinates (flipY is off): u right, v down.

import * as THREE from 'three';

/** Regions of the atlas, [u0, v0, u1, v1]. */
export const ATLAS = {
  FROND: [0, 0, 0.5, 0.25],
  LEAVES: [0.5, 0, 1, 0.25],
  BARK: [0, 0.25, 0.25, 0.5],
  BIRCH: [0.25, 0.25, 0.5, 0.5],
  MASS: [0.5, 0.25, 1, 0.5],
  // (a transparent gutter of 0.04 above them: the opaque bark and needle regions must not bleed into their tops
  // in the small mip levels)
  SIL: [
    [0.01, 0.54, 0.24, 1],
    [0.26, 0.54, 0.49, 1],
    [0.51, 0.54, 0.74, 1],
    [0.76, 0.54, 0.99, 1],
  ],
};

const grey = (l, g = 1.04, b = 0.96) => `rgb(${Math.round(255 * Math.min(1, l))},${Math.round(255 * Math.min(1, l * g))},${Math.round(255 * Math.min(1, l * b))})`;

/**
 * @param {number} size atlas edge in texels
 * @param {import('../../engine/rng.js').Rng} rng
 * @returns {THREE.CanvasTexture}
 */
export function createForestAtlas(size, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  const px = 1 / size; // one texel in atlas units
  ctx.setTransform(size, 0, 0, size, 0, 0);

  // ---- a spruce twig: stem from the left edge to the right, side shoots angled forward, needles all round them
  {
    const [u0, v0, u1, v1] = ATLAS.FROND;
    const w = u1 - u0;
    const h = v1 - v0;
    const cy = v0 + h / 2;
    const envelope = (t) => 0.46 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)), 0.7) * (1 - 0.25 * t);
    const needle = (x, y, angle, len, l) => {
      ctx.strokeStyle = grey(l);
      ctx.lineWidth = 2.2 * px;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    };
    // side shoots, both sides, with needles along them
    for (let t = 0.03; t < 0.97; t += 0.022 + rng.next() * 0.014) {
      for (const side of [-1, 1]) {
        const reach = envelope(t) * h * rng.range(0.8, 1.05);
        const x0 = u0 + t * w;
        const a = side * rng.range(0.55, 0.85);
        const len = reach / Math.sin(Math.abs(a));
        const ex = x0 + Math.cos(a) * Math.min(len, w * 0.3);
        const ey = cy + side * reach;
        const steps = Math.max(5, Math.round(reach / (3.5 * px)));
        for (let k = 0; k <= steps; k++) {
          const f = k / steps;
          const x = x0 + (ex - x0) * f;
          const y = cy + (ey - cy) * f;
          const nl = (9 + 6 * (1 - f)) * px * rng.range(0.8, 1.2);
          const l = rng.range(0.62, 0.95) * (0.8 + 0.2 * f);
          needle(x, y, a * 0.3 - 0.7 + rng.range(-0.3, 0.3), nl, l);
          needle(x, y, a * 0.3 + 0.7 + rng.range(-0.3, 0.3), nl, l * 0.9);
        }
        ctx.strokeStyle = grey(0.5, 0.95, 0.85);
        ctx.lineWidth = 1.6 * px;
        ctx.beginPath();
        ctx.moveTo(x0, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
    // needles on the stem itself, then the stem
    for (let x = u0; x < u1 - 4 * px; x += 2.5 * px) {
      needle(x, cy, rng.range(-2.6, -0.5), 9 * px, rng.range(0.6, 0.9));
      needle(x, cy, rng.range(0.5, 2.6), 9 * px, rng.range(0.6, 0.9));
    }
    ctx.strokeStyle = grey(0.45, 0.9, 0.8);
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.moveTo(u0, cy);
    ctx.lineTo(u1 - 2 * px, cy);
    ctx.stroke();
  }

  // ---- leaves: a spray of small ovals round a few twigs
  {
    const [u0, v0, u1, v1] = ATLAS.LEAVES;
    const w = u1 - u0;
    const h = v1 - v0;
    for (let k = 0; k < 900; k++) {
      const t = rng.next();
      const spread = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * h;
      const x = u0 + (0.04 + 0.92 * t) * w;
      const y = v0 + h / 2 + rng.range(-1, 1) * spread * Math.sqrt(rng.next());
      ctx.fillStyle = grey(rng.range(0.55, 1), 1.0, 0.75);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(5, 8) * px, rng.range(3, 5) * px, rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- bark: plates in vertical runs
  {
    const [u0, v0, u1, v1] = ATLAS.BARK;
    ctx.fillStyle = 'rgb(88,74,62)';
    ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
    for (let k = 0; k < 700; k++) {
      const x = u0 + rng.next() * (u1 - u0);
      const y = v0 + rng.next() * (v1 - v0);
      const l = rng.range(0.22, 0.5);
      ctx.fillStyle = `rgb(${Math.round(255 * l)},${Math.round(232 * l)},${Math.round(205 * l)})`;
      ctx.fillRect(x, y, rng.range(3, 9) * px, rng.range(6, 20) * px);
    }
    ctx.fillStyle = 'rgba(25,20,16,0.7)';
    for (let k = 0; k < 120; k++) ctx.fillRect(u0 + rng.next() * (u1 - u0), v0 + rng.next() * (v1 - v0), 1.5 * px, rng.range(10, 40) * px);
  }

  // ---- birch: white, grey lenticels across the trunk, a few black diamonds
  {
    const [u0, v0, u1, v1] = ATLAS.BIRCH;
    ctx.fillStyle = 'rgb(228,226,218)';
    ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
    for (let k = 0; k < 260; k++) {
      ctx.fillStyle = `rgba(${rng.next() < 0.3 ? '30,28,26' : '120,115,108'},${rng.range(0.5, 0.9)})`;
      ctx.fillRect(u0 + rng.next() * (u1 - u0), v0 + rng.next() * (v1 - v0), rng.range(6, 22) * px, rng.range(1, 2.5) * px);
    }
    for (let k = 0; k < 10; k++) {
      const x = u0 + rng.next() * (u1 - u0);
      const y = v0 + rng.next() * (v1 - v0);
      const r = rng.range(4, 10) * px;
      ctx.fillStyle = 'rgb(28,26,24)';
      ctx.beginPath();
      ctx.moveTo(x - r * 1.6, y);
      ctx.lineTo(x, y - r * 0.6);
      ctx.lineTo(x + r * 1.6, y);
      ctx.lineTo(x, y + r * 0.6);
      ctx.fill();
    }
  }

  // ---- packed needles, opaque and darker (the inside of a crown)
  {
    const [u0, v0, u1, v1] = ATLAS.MASS;
    ctx.fillStyle = grey(0.32);
    ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
    ctx.lineWidth = 2 * px;
    for (let k = 0; k < 2600; k++) {
      const x = u0 + rng.next() * (u1 - u0);
      const y = v0 + rng.next() * (v1 - v0);
      const a = rng.range(0, Math.PI * 2);
      ctx.strokeStyle = grey(rng.range(0.3, 0.75));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 8 * px, y + Math.sin(a) * 8 * px);
      ctx.stroke();
    }
  }

  // ---- silhouettes: tiers of drooping branches round a trunk, lit from the upper side of each tier
  const silhouette = ([u0, v0, u1, v1], kind) => {
    const w = u1 - u0;
    const h = v1 - v0;
    const cx = u0 + w / 2;
    const bottom = v1 - 2 * px;
    const top = v0 + 3 * px;
    const crownBase = kind === 2 ? 0.45 : kind === 3 ? 0.18 : 0.1; // share of the height below the crown
    // trunk
    ctx.fillStyle = kind === 2 ? grey(0.85, 1, 1) : grey(0.4, 0.9, 0.8);
    ctx.fillRect(cx - (kind === 2 ? 3 : 4) * px, top + h * 0.05, (kind === 2 ? 6 : 8) * px, bottom - top - h * 0.05);
    if (kind === 2) {
      // birch: a loose oval crown of leaf blobs
      for (let k = 0; k < 520; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next());
        const x = cx + Math.cos(a) * r * w * 0.42;
        const y = top + h * 0.33 + Math.sin(a) * r * h * 0.3;
        ctx.fillStyle = grey(rng.range(0.5, 1), 1.0, 0.75);
        ctx.beginPath();
        ctx.arc(x, y, rng.range(3, 7) * px, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    const tiers = kind === 1 ? 26 : 32;
    const crownH = (bottom - top) * (1 - crownBase);
    for (let i = tiers - 1; i >= 0; i--) {
      const t = i / (tiers - 1); // 0 at the top, 1 at the crown's base
      const y = top + crownH * t + rng.range(-1, 1) * px * 3;
      let reach = (kind === 1 ? 0.36 : 0.46) * w * Math.pow(t, kind === 1 ? 0.75 : 0.95) + 4 * px;
      if (kind === 1) reach = Math.min(reach, 0.3 * w + 0.2 * w * t);
      reach *= rng.range(0.8, 1.1);
      const droop = (kind === 3 ? 0.04 : 0.09) * h * (0.4 + t);
      for (const side of [-1, 1]) {
        const r = reach * rng.range(0.85, 1.1);
        // the branch's mass: a drooping fan, darker underneath
        for (let k = 0; k < (kind === 3 ? 18 : 34); k++) {
          const f = Math.sqrt(rng.next());
          const x = cx + side * r * f;
          const yy = y + droop * f * f + rng.range(-0.5, 1) * 10 * px * (0.5 + f);
          const l = (kind === 3 ? 0.9 : 0.8) * rng.range(0.5, 1) * (0.75 + 0.25 * f);
          ctx.strokeStyle = grey(l);
          ctx.lineWidth = rng.range(2, 4) * px;
          ctx.beginPath();
          ctx.moveTo(x, yy);
          ctx.lineTo(x + side * rng.range(2, 7) * px, yy + rng.range(2, 12) * px);
          ctx.stroke();
        }
      }
    }
  };
  ATLAS.SIL.forEach((region, kind) => silhouette(region, kind));

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}
