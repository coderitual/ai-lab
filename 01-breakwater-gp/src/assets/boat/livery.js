// Paintwork. Each boat's colours, stripes, numbers and lettering are painted
// onto one canvas, laid out as lines.js describes (the boat from above, its two
// sides, its transoms), and wrapped round the hull as a texture. A second pair
// of sheets, the same for every boat, carries what paint alone cannot show:
// seams, louvres and the grit of the step pads as a normal map, and how rough
// and how tucked-away each bit of surface is.
//
// Everything is drawn in metres, in the boat's own coordinates, so a stripe is
// placed against the hull lines it follows rather than against pixels.

import * as THREE from 'three';
import { lerp, smoothstep } from '../../engine/math.js';
import { BLANK, BOAT, CANOPY, NOSE, PORT, SCALE, SHEET, SIDE_SCALE, STBD, TOP, TRANSOM_MID, TRANSOM_PORT, TRANSOM_SCALE, TRANSOM_STBD, canopyRadius, chineAt, innerAt, outerAt, sheerAt, tAt, zAt } from './lines.js';

const INK = '#101318';
const WHITE = '#fbfaf5';
const font = (px, weight = 800) => `italic ${weight} ${Math.round(px)}px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
/** The lettering, for checking whether the web font has arrived. */
export const LIVERY_FONT = font(64);

const luminance = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** The three colours of a team's boat: hull, accent, and a third that stands out against both. */
export function teamColors(team) {
  const third = luminance(team.accent) > 0.35 ? '#12203a' : '#f5f2ea';
  return { hull: team.hull, accent: team.accent, third };
}

function sheet(scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SHEET.w * scale);
  canvas.height = Math.round(SHEET.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

// ---- drawing spaces

/** Draw in the plan view: coordinates are (z, x) in metres, bow to the right, port side up. */
function inTop(ctx, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(TOP.x, TOP.y, TOP.w, TOP.h);
  ctx.clip();
  ctx.transform(SCALE, 0, 0, -SCALE, -TOP.z0 * SCALE, TOP.xMax * SCALE);
  draw();
  ctx.restore();
}

/** Draw on one side: coordinates are (z, y) in metres as seen from outside that side. */
function inSide(ctx, port, draw) {
  const chart = port ? PORT : STBD;
  ctx.save();
  ctx.beginPath();
  ctx.rect(chart.x, chart.y, chart.w, chart.h);
  ctx.clip();
  // the port side is seen with the bow on the left
  if (port) ctx.transform(-SCALE, 0, 0, -SIDE_SCALE, TOP.z1 * SCALE, chart.y + chart.yTop * SIDE_SCALE);
  else ctx.transform(SCALE, 0, 0, -SIDE_SCALE, -TOP.z0 * SCALE, chart.y + chart.yTop * SIDE_SCALE);
  draw();
  ctx.restore();
}

/** Draw on a transom: coordinates are pixels from its top left corner. */
function inTransom(ctx, chart, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(chart.x, chart.y, chart.w, chart.h);
  ctx.clip();
  ctx.translate(chart.x, chart.y);
  draw(chart.w, chart.h);
  ctx.restore();
}

/** Font pixels per metre: lettering is set at this size and then scaled into place. */
const P = SCALE;

/**
 * Lettering at (a, b) of the current drawing space, `size` metres tall, read
 * along the direction `dir`, with the tops of the letters to the left of that
 * direction as the boat is seen (so `dir` toward the stern on the port side
 * stands the letters upright for somebody looking at that side).
 */
function label(ctx, text, a, b, { size = 0.2, dir = [1, 0], color = INK, align = 'center', weight = 800, stroke = null, squeeze = 1 } = {}) {
  ctx.save();
  ctx.translate(a, b);
  // some drawing spaces are mirror images of others: find out which way round this one is
  const m = ctx.getTransform();
  const flip = m.a * m.d - m.b * m.c < 0 ? -1 : 1;
  ctx.rotate(Math.atan2(dir[1], dir[0]));
  ctx.scale(squeeze / P, flip / P);
  ctx.font = font(size * P, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.width * P;
    ctx.strokeStyle = stroke.color;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function path(ctx, points, close = true) {
  ctx.beginPath();
  points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
  if (close) ctx.closePath();
}

function roundRect(ctx, a, b, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(a + r, b);
  ctx.arcTo(a + w, b, a + w, b + h, r);
  ctx.arcTo(a + w, b + h, a, b + h, r);
  ctx.arcTo(a, b + h, a, b, r);
  ctx.arcTo(a, b, a + w, b, r);
  ctx.closePath();
}

// ---- the hull's outlines in the plan view
const N = 40;
/** (z, x) along a line of the hull for t from a to b, pulled `inset` metres toward the centre line. */
function edge(lineAt, side, a, b, inset = 0) {
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = lerp(a, b, i / N);
    out.push([zAt(t), side * (lineAt(t) - inset)]);
  }
  return out;
}
/** The part of a sponson deck between two cuts, each running from the outer edge (at t = o) to the inner edge (at t = i). */
const deckBand = (side, [o0, i0], [o1, i1]) => [...edge(outerAt, side, o0, o1), ...edge(innerAt, side, i1, i0)];
/** The outline of the canopy, grown by `grow` metres. */
function canopyOutline(grow = 0) {
  const out = [];
  const n = 28;
  const at = (i) => [lerp(CANOPY.z0 - grow, CANOPY.z1 + grow, i / n), CANOPY.halfWidth * canopyRadius(i / n) + grow];
  for (let i = 0; i <= n; i++) out.push(at(i));
  for (let i = n; i >= 0; i--) out.push([at(i)[0], -at(i)[1]]);
  return out;
}

// where things are, shared by the paint and the detail maps
const TIP = [0.8, 0.875]; // the painted bow tips start on this slanting line
const PLATE = { z: zAt(0.139), x: 0.765, across: 0.4, along: 0.42 };
const PAD = { z0: -1.02, z1: 0.12, x0: 0.535, x1: 0.8 };
const HATCH = { z0: -2.58, z1: -1.0, half: 0.33 }; // the engine hatch on the centre body
const SCOOP = { z0: zAt(0.1), z1: zAt(0.275) };
export const FILLER = { z: -1.32, x: 0.79 }; // the fuel caps (the fittings themselves are in hull.js)
const louvres = () => {
  const out = [];
  for (let k = 0; k < 9; k++) out.push(-2.36 + k * 0.085);
  return out;
};

/** The band along the bottom of each side: how far up the side it reaches, as a fraction, at t. */
const sideBandAt = (t) => lerp(0.46, 0.14, smoothstep(0.0, 0.78, t)) * (1 - smoothstep(0.86, 0.97, t));
/** A point on the side of the hull: fraction `v` of the way from the spray rail up to the rub rail. */
function sidePoint(t, v) {
  const yc = chineAt(t);
  const ys = sheerAt(t);
  const h = ys - yc;
  const low = yc + 0.1 * h;
  const high = ys - 0.06 * Math.min(1, h / 0.3);
  return [zAt(t), lerp(low, high, v)];
}

// ---- the four designs
//
// Each team's boat is painted to a different design, not the same one in other colours. A design paints the
// decks (`top`, once per side, in the plan view) and the flanks (`side`, in the side view); everything the
// boats have in common (number plates, step pads, the hatch, the lettering) goes on afterwards.
//   c: { H hull colour, A accent, T third colour }

const midAt = (t) => (outerAt(t) + innerAt(t)) / 2;
/** A leaning band on a flank: between z0 and z1 at the top, raked aft by `rake` metres at the bottom. */
const rakedBand = (z0, z1, rake = 0.42) => [
  [z0, PORT.yTop],
  [z1, PORT.yTop],
  [z1 - rake, PORT.yBottom],
  [z0 - rake, PORT.yBottom],
];
/** The usual run of colour along the bottom of a flank, tall at the stern and running out toward the bow. */
function lowerBand(ctx, fill, line, tall = 1) {
  const lower = [];
  const upper = [];
  const pin = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    lower.push([zAt(t), PORT.yBottom]);
    upper.push(sidePoint(t, sideBandAt(t) * tall));
    pin.push(sidePoint(t, sideBandAt(t) * tall + 0.055));
  }
  ctx.fillStyle = fill;
  path(ctx, [...lower, ...upper.slice().reverse()]);
  ctx.fill();
  ctx.fillStyle = line;
  path(ctx, [...upper, ...pin.slice().reverse()]);
  ctx.fill();
}
function chequers(ctx, side, rows = 2) {
  const sq = 0.062;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < 10; k++) {
      ctx.fillStyle = (r + k) % 2 ? INK : WHITE;
      ctx.fillRect(BOAT.sternZ + r * sq, side * (0.46 + k * sq) - (side < 0 ? sq : 0), sq, sq);
    }
  }
}
const fillPath = (ctx, colour, points) => {
  ctx.fillStyle = colour;
  path(ctx, points);
  ctx.fill();
};

const PATTERNS = {
  // Broad bands slashed across the boat, raked back like a blade.
  slash: {
    top(ctx, side, c) {
      fillPath(ctx, c.T, deckBand(side, TIP, [1, 1]));
      fillPath(ctx, c.A, deckBand(side, [TIP[0] - 0.05, TIP[1] - 0.05], [TIP[0] - 0.022, TIP[1] - 0.022]));
      fillPath(ctx, c.T, deckBand(side, [0.262, 0.4], [0.288, 0.426]));
      fillPath(ctx, c.A, deckBand(side, [0.305, 0.443], [0.47, 0.608]));
      fillPath(ctx, c.A, deckBand(side, [0.5, 0.638], [0.545, 0.683]));
      fillPath(ctx, c.T, deckBand(side, [0.562, 0.7], [0.578, 0.716]));
      // the stern quarter in the third colour, behind a raked edge
      fillPath(ctx, c.T, deckBand(side, [0, 0], [0.04, 0.178]));
      chequers(ctx, side);
    },
    side(ctx, c) {
      lowerBand(ctx, c.T, c.A, 0.8);
      fillPath(ctx, c.T, [sidePoint(TIP[0], 0), [BOAT.bowZ + 0.05, PORT.yBottom], [BOAT.bowZ + 0.05, PORT.yTop], sidePoint(TIP[0] + 0.03, 1.3)]);
      fillPath(ctx, c.T, rakedBand(zAt(0.262), zAt(0.288)));
      fillPath(ctx, c.A, rakedBand(zAt(0.305), zAt(0.47)));
      fillPath(ctx, c.A, rakedBand(zAt(0.5), zAt(0.545)));
      fillPath(ctx, c.T, rakedBand(zAt(0.562), zAt(0.578)));
    },
  },

  // One long sweep of dark water curling along each hull, edged in white.
  wave: {
    top(ctx, side, c) {
      const sweep = (t) => {
        const k = smoothstep(0.0, 0.72, t);
        return lerp(innerAt(t) + 0.03, outerAt(t) + 0.02, k * k * (3 - 2 * k) * 0.999);
      };
      const inner = [];
      const pin = [];
      for (let i = 0; i <= N; i++) {
        const t = lerp(0, 0.72, i / N);
        inner.push([zAt(t), side * sweep(t)]);
        pin.push([zAt(t), side * (sweep(t) - 0.035)]);
      }
      fillPath(ctx, c.A, [...edge(outerAt, side, 0, 0.72), ...inner.slice().reverse()]);
      fillPath(ctx, c.T, [...inner, ...pin.slice().reverse()]);
      // a second, smaller curl over the bows
      const curl = [];
      for (let i = 0; i <= N; i++) {
        const t = lerp(0.76, 1, i / N);
        curl.push([zAt(t), side * lerp(outerAt(t), innerAt(t) - 0.01, Math.pow(i / N, 0.6))]);
      }
      fillPath(ctx, c.A, [...curl, ...edge(innerAt, side, 1, 0.9)]);
      fillPath(ctx, c.T, [...curl, ...curl.map(([z, x]) => [z - 0.045, x]).reverse()]);
    },
    side(ctx, c) {
      // the wave: high at the stern, falling, lifting once more before it runs out at the bow
      const crest = (t) => lerp(0.92, 0.06, smoothstep(0.0, 0.8, t)) + 0.16 * Math.sin(t * 9.5 + 0.6) * (1 - t) * smoothstep(0.02, 0.2, t);
      const lower = [];
      const upper = [];
      const pin = [];
      const foam = [];
      for (let i = 0; i <= N * 2; i++) {
        const t = i / (N * 2);
        lower.push([zAt(t), PORT.yBottom]);
        upper.push(sidePoint(t, crest(t)));
        pin.push(sidePoint(t, crest(t) + 0.07));
        foam.push(sidePoint(t, crest(t) + 0.13));
      }
      fillPath(ctx, c.A, [...lower, ...upper.slice().reverse()]);
      fillPath(ctx, c.T, [...upper, ...pin.slice().reverse()]);
      ctx.strokeStyle = c.T;
      ctx.lineWidth = 0.012;
      path(ctx, foam.slice(4, 62), false);
      ctx.stroke();
    },
  },

  // Black shards, as if the paint had been cut with a knife.
  shard: {
    top(ctx, side, c) {
      const o = (t, inset = 0) => [zAt(t), side * (outerAt(t) - inset)];
      const n = (t, inset = 0) => [zAt(t), side * (innerAt(t) + inset)];
      const shards = [
        [o(0.0), o(0.3), n(0.1)],
        [o(0.34), o(0.66), n(0.6), n(0.5)],
        [n(0.2), n(0.44), o(0.3)],
        [o(0.7), o(0.86), n(0.93), n(0.84)],
        [o(0.9), o(1), n(1), n(0.97)],
      ];
      for (const [i, pts] of shards.entries()) fillPath(ctx, i === 2 ? c.T : c.A, pts);
      ctx.strokeStyle = c.T;
      ctx.lineWidth = 0.018;
      ctx.lineJoin = 'miter';
      for (const i of [0, 1, 3]) {
        path(ctx, shards[i]);
        ctx.stroke();
      }
    },
    side(ctx, c) {
      const up = (z0, z1, zTop, top = PORT.yTop) => [
        [z0, PORT.yBottom],
        [z1, PORT.yBottom],
        [zTop, top],
      ];
      const shards = [up(-2.75, -1.2, -2.3), up(-1.5, 0.2, -0.35, 0.5), up(0.0, 1.5, 1.25, 0.56), up(1.3, 3.2, 3.15)];
      for (const pts of shards) fillPath(ctx, c.A, pts);
      ctx.strokeStyle = c.T;
      ctx.lineWidth = 0.018;
      for (const pts of shards) {
        path(ctx, [pts[0], pts[2], pts[1]], false);
        ctx.stroke();
      }
      fillPath(ctx, c.T, [
        [-1.1, PORT.yBottom],
        [-0.72, PORT.yBottom],
        [-0.98, 0.26],
      ]);
    },
  },

  // Twin racing stripes from stern to stem.
  stripe: {
    top(ctx, side, c) {
      const run = (from, to, t0 = 0, t1 = 0.9) => [...edge(midAt, side, t0, t1, from), ...edge(midAt, side, t1, t0, to)];
      fillPath(ctx, c.A, run(-0.2, -0.045));
      fillPath(ctx, c.A, run(0.045, 0.2));
      fillPath(ctx, c.T, run(-0.02, 0.02));
      // a dark nose with a white chevron across it
      fillPath(ctx, c.A, deckBand(side, [0.86, 0.9], [1, 1]));
      fillPath(ctx, c.T, deckBand(side, [0.82, 0.86], [0.84, 0.88]));
      chequers(ctx, side, 3);
    },
    side(ctx, c) {
      const strip = (v0, v1, t0 = 0, t1 = 0.93) => {
        const a = [];
        const b = [];
        for (let i = 0; i <= N; i++) {
          const t = lerp(t0, t1, i / N);
          a.push(sidePoint(t, v0));
          b.push(sidePoint(t, v1));
        }
        return [...a, ...b.reverse()];
      };
      fillPath(ctx, c.A, strip(-0.2, 0.3));
      fillPath(ctx, c.A, strip(0.4, 0.58));
      fillPath(ctx, c.T, strip(0.32, 0.38));
      fillPath(ctx, c.A, [sidePoint(0.86, -0.3), [BOAT.bowZ + 0.05, PORT.yBottom], [BOAT.bowZ + 0.05, PORT.yTop], sidePoint(0.89, 1.3)]);
      // the stripes break up into squares toward the stern
      const sq = 0.07;
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 7 - r; k++) {
          if ((r + k) % 2) continue;
          ctx.fillStyle = c.T;
          ctx.fillRect(BOAT.sternZ + 0.04 + k * sq, 0.26 + r * sq, sq, sq);
        }
      }
    },
  },
};

/** A carbon-fibre weave to fill dark panels with (the pattern is in pixels whatever space it is used in). */
function weave(ctx) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 8;
  const t = tile.getContext('2d');
  t.fillStyle = '#14171c';
  t.fillRect(0, 0, 8, 8);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      // a 2/2 twill: each tow goes over two and under two, stepping one along each row
      const over = ((i + j) & 3) < 2;
      t.fillStyle = over ? '#262b33' : '#0d0f13';
      t.fillRect(i * 2, j * 2, 2, 2);
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  // one tile is eight pixels of a full-size sheet, whatever the scale of the space it is used in
  const k = ctx.canvas.width / SHEET.w;
  const m = ctx.getTransform();
  pattern.setTransform(new DOMMatrix([k / Math.hypot(m.a, m.b), 0, 0, k / Math.hypot(m.c, m.d), 0, 0]));
  return pattern;
}

/**
 * Paint a team's boat.
 * @param {{ hull: string, accent: string }} team
 * @param {number} number race number
 * @param {number} [scale] size of the sheet (1 = 2048 x 1280)
 * @returns {HTMLCanvasElement}
 */
export function paintLivery(team, number, scale = 1) {
  const { canvas, ctx } = sheet(scale);
  const { hull: H, accent: A, third: T } = teamColors(team);
  const deep = shade(H, 0.72);
  const design = PATTERNS[team.pattern] || PATTERNS.slash;
  const mark = team.mark || 'BREAKWATER';
  const colours = { H, A, T };

  // gaps between the charts take the hull colour, so nothing odd bleeds in from a distance
  ctx.fillStyle = H;
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);

  // ------------------------------------------------------------ from above
  inTop(ctx, () => {
    // the colour deepens toward the bows
    const fade = ctx.createLinearGradient(0.3, 0, BOAT.bowZ, 0);
    fade.addColorStop(0, H);
    fade.addColorStop(1, deep);
    ctx.fillStyle = fade;
    ctx.fillRect(TOP.z0, -TOP.xMax, TOP.z1 - TOP.z0, 2 * TOP.xMax);

    for (const side of [1, -1]) {
      design.top(ctx, side, colours);

      // step pads beside the cockpit
      ctx.fillStyle = 'rgba(28, 31, 37, 0.92)';
      roundRect(ctx, PAD.z0, side > 0 ? PAD.x0 : -PAD.x1, PAD.z1 - PAD.z0, PAD.x1 - PAD.x0, 0.05);
      ctx.fill();
      ctx.lineWidth = 0.012;
      ctx.strokeStyle = A;
      roundRect(ctx, PAD.z0 - 0.022, (side > 0 ? PAD.x0 : -PAD.x1) - 0.022, PAD.z1 - PAD.z0 + 0.044, PAD.x1 - PAD.x0 + 0.044, 0.07);
      ctx.stroke();

      // the number, on a plate, read from astern
      ctx.fillStyle = WHITE;
      roundRect(ctx, PLATE.z - PLATE.along / 2, side * PLATE.x - PLATE.across / 2, PLATE.along, PLATE.across, 0.06);
      ctx.fill();
      ctx.lineWidth = 0.014;
      ctx.strokeStyle = INK;
      roundRect(ctx, PLATE.z - PLATE.along / 2 + 0.025, side * PLATE.x - PLATE.across / 2 + 0.025, PLATE.along - 0.05, PLATE.across - 0.05, 0.04);
      ctx.stroke();
      label(ctx, String(number), PLATE.z - 0.012, side * PLATE.x + 0.012, { size: 0.33, dir: [0, -1], color: INK, weight: 900 });

      // the name along the foredeck, read from that side of the boat
      label(ctx, mark, 0.98, side * 0.735, { size: 0.165, dir: [-side, 0], color: luminance(A) > 0.4 ? A : WHITE, squeeze: 0.96, stroke: { color: 'rgba(8,10,14,0.55)', width: 0.012 } });
      // a filler cap with its label, and a mark by the bow cleat
      ctx.lineWidth = 0.008;
      ctx.strokeStyle = 'rgba(8, 10, 14, 0.55)';
      ctx.beginPath();
      ctx.arc(FILLER.z, side * FILLER.x, 0.062, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, 'FUEL', FILLER.z, side * (FILLER.x - 0.11), { size: 0.045, dir: [-side, 0], color: A, weight: 700 });
      label(ctx, 'LIFT', zAt(0.8), side * (outerAt(0.8) - 0.2), { size: 0.04, dir: [-side, 0], color: WHITE, weight: 700 });
    }

    // ---- the centre body
    // engine hatch: a panel in the third colour with a spine in the accent
    ctx.fillStyle = T;
    roundRect(ctx, HATCH.z0, -HATCH.half, HATCH.z1 - HATCH.z0, 2 * HATCH.half, 0.09);
    ctx.fill();
    ctx.fillStyle = A;
    ctx.fillRect(HATCH.z0, -0.055, HATCH.z1 - HATCH.z0, 0.11);
    ctx.fillStyle = luminance(T) > 0.4 ? 'rgba(16, 19, 24, 0.9)' : 'rgba(0, 0, 0, 0.75)';
    for (const z of louvres()) {
      for (const side of [1, -1]) {
        roundRect(ctx, z, side > 0 ? 0.105 : -0.285, 0.036, 0.18, 0.014);
        ctx.fill();
      }
    }
    // the air scoop sits on the hatch: accent, darker round the mouth
    ctx.fillStyle = A;
    roundRect(ctx, SCOOP.z0 - 0.02, -0.22, SCOOP.z1 - SCOOP.z0 + 0.04, 0.44, 0.1);
    ctx.fill();
    ctx.fillStyle = T;
    ctx.fillRect(SCOOP.z1 - 0.09, -0.22, 0.035, 0.44);

    // a dull dark panel of bare carbon round the canopy, running forward to the nose, so the glass does not glare
    ctx.fillStyle = weave(ctx);
    path(ctx, canopyOutline(0.075));
    ctx.fill();
    path(ctx, [
      [0.5, 0.33],
      [zAt(NOSE) + 0.02, 0.16],
      [zAt(NOSE) + 0.02, -0.16],
      [0.5, -0.33],
    ]);
    ctx.fill();
    // hairlines either side of it on the foredeck, and the number again on the nose
    ctx.lineWidth = 0.016;
    ctx.strokeStyle = A;
    for (const side of [1, -1]) {
      path(ctx, [[0.62, side * 0.385], [zAt(NOSE) - 0.02, side * 0.24]], false);
      ctx.stroke();
    }
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(1.42, 0, 0.115, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, String(number), 1.412, 0.004, { size: 0.17, dir: [0, -1], color: INK, weight: 900 });

    // seams: the hatches, drawn fine and dark
    ctx.lineWidth = 0.006;
    ctx.strokeStyle = 'rgba(6, 8, 12, 0.5)';
    roundRect(ctx, HATCH.z0 + 0.03, -HATCH.half + 0.03, HATCH.z1 - HATCH.z0 - 0.06, 2 * HATCH.half - 0.06, 0.07);
    ctx.stroke();
  });

  // ---------------------------------------------------------------- sides
  for (const port of [true, false]) {
    inSide(ctx, port, () => {
      const fade = ctx.createLinearGradient(0.3, 0, BOAT.bowZ, 0);
      fade.addColorStop(0, H);
      fade.addColorStop(1, deep);
      ctx.fillStyle = fade;
      ctx.fillRect(TOP.z0, PORT.yBottom, TOP.z1 - TOP.z0, PORT.yTop - PORT.yBottom);

      design.side(ctx, colours);

      // the name, large
      const away = port ? -1 : 1; // reading direction along z
      label(ctx, mark, -0.2, 0.345, { size: 0.235, dir: [away, 0], color: WHITE, squeeze: 1.0, weight: 900, stroke: { color: INK, width: 0.03 } });
      label(ctx, 'BREAKWATER GP', -0.95, 0.088, { size: 0.072, dir: [away, 0], color: WHITE, weight: 700, stroke: { color: 'rgba(8,10,14,0.7)', width: 0.012 } });
      // the number in a roundel toward the bow
      const [rz, ry] = [zAt(0.745), 0.34];
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.ellipse(rz, ry, 0.15, 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.016;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.ellipse(rz, ry, 0.125, 0.125, 0, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, String(number), rz + away * 0.008, ry - 0.008, { size: 0.2, dir: [away, 0], color: INK, weight: 900 });
      // a bilge outlet near the tail
      ctx.fillStyle = '#0a0c10';
      ctx.beginPath();
      ctx.ellipse(-2.42, 0.12, 0.022, 0.022, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // -------------------------------------------------------------- transoms
  ctx.fillStyle = WHITE;
  ctx.fillRect(BLANK.x - 6, BLANK.y - 6, BLANK.w + 12, BLANK.h + 12);
  for (const chart of [TRANSOM_PORT, TRANSOM_STBD]) {
    inTransom(ctx, chart, (w, h) => {
      ctx.fillStyle = shade(H, 0.8);
      ctx.fillRect(0, 0, w, h);
      // a panel with the number
      ctx.fillStyle = T;
      roundRect(ctx, 14, 16, w - 28, 118, 14);
      ctx.fill();
      ctx.fillStyle = luminance(T) > 0.4 ? INK : WHITE;
      ctx.font = font(96, 900);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), w / 2 - 4, 80);
      ctx.fillStyle = A;
      ctx.fillRect(14, 144, w - 28, 7);
      // a drain plug, low down
      ctx.fillStyle = '#0a0c10';
      ctx.beginPath();
      ctx.arc(w / 2, h - 34, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#aeb5bd';
      ctx.beginPath();
      ctx.arc(w / 2, h - 34, 5.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  inTransom(ctx, TRANSOM_MID, (w, h) => {
    ctx.fillStyle = weave(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = A;
    ctx.fillRect(0, 6, w, 5);
  });
  return canvas;
}

let detail = null;

/**
 * The sheets every boat shares: a normal map (seams, louvres, the grit of the
 * step pads) and a map of occlusion (red), roughness (green) and metalness (blue).
 * @returns {{ normal: HTMLCanvasElement, orm: HTMLCanvasElement }}
 */
export function paintDetail(scale = 1) {
  if (detail && detail.scale === scale) return detail;

  // ---- heights: mid grey is the surface, darker is cut in, lighter stands proud
  const height = sheet(scale);
  const hc = height.ctx;
  hc.fillStyle = 'rgb(128, 128, 128)';
  hc.fillRect(0, 0, SHEET.w, SHEET.h);
  const groove = 'rgb(40, 40, 40)';
  inTop(hc, () => {
    // grit on the step pads
    const dots = document.createElement('canvas');
    dots.width = dots.height = 8;
    const dc = dots.getContext('2d');
    dc.fillStyle = 'rgb(128, 128, 128)';
    dc.fillRect(0, 0, 8, 8);
    dc.fillStyle = 'rgb(215, 215, 215)';
    dc.beginPath();
    dc.arc(2, 2, 1.5, 0, Math.PI * 2);
    dc.arc(6, 6, 1.5, 0, Math.PI * 2);
    dc.fill();
    const grit = hc.createPattern(dots, 'repeat');
    grit.setTransform(new DOMMatrix().scale(1.3 / SCALE)); // a dot every centimetre and a half
    for (const side of [1, -1]) {
      hc.fillStyle = grit;
      roundRect(hc, PAD.z0, side > 0 ? PAD.x0 : -PAD.x1, PAD.z1 - PAD.z0, PAD.x1 - PAD.x0, 0.05);
      hc.fill();
      // filler cap recess
      hc.lineWidth = 0.012;
      hc.strokeStyle = groove;
      hc.beginPath();
      hc.arc(FILLER.z, side * FILLER.x, 0.062, 0, Math.PI * 2);
      hc.stroke();
    }
    // engine hatch seam and louvres
    hc.lineWidth = 0.012;
    hc.strokeStyle = groove;
    roundRect(hc, HATCH.z0 + 0.03, -HATCH.half + 0.03, HATCH.z1 - HATCH.z0 - 0.06, 2 * HATCH.half - 0.06, 0.07);
    hc.stroke();
    for (const z of louvres()) {
      for (const side of [1, -1]) {
        // each slat: cut in at its front edge, lifting toward the back
        const g = hc.createLinearGradient(z, 0, z + 0.05, 0);
        g.addColorStop(0, 'rgb(20, 20, 20)');
        g.addColorStop(0.55, 'rgb(128, 128, 128)');
        g.addColorStop(1, 'rgb(200, 200, 200)');
        hc.fillStyle = g;
        roundRect(hc, z, side > 0 ? 0.105 : -0.285, 0.05, 0.18, 0.014);
        hc.fill();
      }
    }
    // the canopy's seat in the deck
    hc.lineWidth = 0.014;
    path(hc, canopyOutline(0.03));
    hc.stroke();
  });
  // a seam under the rub rail and a recessed outlet on each side
  for (const port of [true, false]) {
    inSide(hc, port, () => {
      hc.fillStyle = 'rgb(20, 20, 20)';
      hc.beginPath();
      hc.ellipse(-2.42, 0.12, 0.026, 0.026, 0, 0, Math.PI * 2);
      hc.fill();
    });
  }
  for (const chart of [TRANSOM_PORT, TRANSOM_STBD]) {
    inTransom(hc, chart, (w, h) => {
      hc.lineWidth = 3;
      hc.strokeStyle = groove;
      roundRect(hc, 14, 16, w - 28, 118, 14);
      hc.stroke();
      hc.fillStyle = 'rgb(205, 205, 205)';
      hc.beginPath();
      hc.arc(w / 2, h - 34, 7, 0, Math.PI * 2);
      hc.fill();
    });
  }

  // heights -> normals
  const w = height.canvas.width;
  const h = height.canvas.height;
  const src = hc.getImageData(0, 0, w, h).data;
  const normal = document.createElement('canvas');
  normal.width = w;
  normal.height = h;
  const nc = normal.getContext('2d');
  const img = nc.createImageData(w, h);
  const out = img.data;
  const strength = 2.2;
  for (let y = 0; y < h; y++) {
    const yu = Math.max(y - 1, 0) * w;
    const yd = Math.min(y + 1, h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xl = Math.max(x - 1, 0);
      const xr = Math.min(x + 1, w - 1);
      const dx = (src[(y * w + xr) * 4] - src[(y * w + xl) * 4]) / 255;
      const dy = (src[(yd + x) * 4] - src[(yu + x) * 4]) / 255;
      // the picture's rows run down, texture coordinates run up
      let nx = -dx * strength;
      let ny = dy * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const k = (y * w + x) * 4;
      out[k] = Math.round((nx * 0.5 + 0.5) * 255);
      out[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[k + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[k + 3] = 255;
    }
  }
  nc.putImageData(img, 0, 0);

  // ---- occlusion (red), roughness (green), metalness (blue)
  const orm = sheet(scale);
  const oc = orm.ctx;
  const rough = (r) => `rgb(255, ${Math.round(r * 255)}, 0)`;
  oc.fillStyle = rough(0.3);
  oc.fillRect(0, 0, SHEET.w, SHEET.h);
  /** Darken the red channel only: a soft shadow `width` metres wide along the path just built. */
  const tuck = (width, depth = 0.72) => {
    oc.save();
    oc.globalCompositeOperation = 'multiply';
    oc.lineJoin = 'round';
    oc.lineCap = 'round';
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      oc.lineWidth = width * (1 - i / layers);
      oc.strokeStyle = `rgb(${Math.round(255 * Math.pow(depth, 1 / layers))}, 255, 255)`;
      oc.stroke();
    }
    oc.restore();
  };
  inTop(oc, () => {
    oc.fillStyle = rough(0.88);
    for (const side of [1, -1]) {
      roundRect(oc, PAD.z0, side > 0 ? PAD.x0 : -PAD.x1, PAD.z1 - PAD.z0, PAD.x1 - PAD.x0, 0.05);
      oc.fill();
    }
    // the dull panel round the canopy
    oc.fillStyle = rough(0.62);
    path(oc, canopyOutline(0.075));
    oc.fill();
    path(oc, [
      [0.5, 0.33],
      [zAt(NOSE) + 0.02, 0.16],
      [zAt(NOSE) + 0.02, -0.16],
      [0.5, -0.33],
    ]);
    oc.fill();
    // louvres are open: dark inside
    oc.fillStyle = 'rgb(120, 200, 0)';
    for (const z of louvres()) {
      for (const side of [1, -1]) {
        roundRect(oc, z, side > 0 ? 0.105 : -0.285, 0.036, 0.18, 0.014);
        oc.fill();
      }
    }
    // tucked-away places gather less sky: the hollow where each deck meets the
    // centre body, round the foot of the canopy and of the scoop, under the fins
    for (const side of [1, -1]) {
      path(oc, edge(innerAt, side, 0.02, NOSE - 0.03), false);
      tuck(0.26, 0.62);
      path(oc, [[BOAT.sternZ + 0.2, side * 1.0], [BOAT.sternZ + 0.95, side * 1.0]], false);
      tuck(0.12, 0.7);
    }
    path(oc, canopyOutline(0.0));
    tuck(0.16, 0.6);
    roundRect(oc, SCOOP.z0, -0.2, SCOOP.z1 - SCOOP.z0, 0.4, 0.1);
    tuck(0.12, 0.7);
  });
  for (const port of [true, false]) {
    inSide(oc, port, () => {
      // under the rub rail, and down toward the water
      const top = [];
      const bottom = [];
      for (let i = 0; i <= N; i++) {
        top.push(sidePoint(i / N, 1.0));
        bottom.push(sidePoint(i / N, -0.05));
      }
      path(oc, top, false);
      tuck(0.14, 0.62);
      path(oc, bottom, false);
      tuck(0.2, 0.75);
    });
  }
  for (const chart of [TRANSOM_PORT, TRANSOM_STBD, TRANSOM_MID]) {
    inTransom(oc, chart, (cw, ch) => {
      const g = oc.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, 'rgb(215, 255, 255)');
      g.addColorStop(0.3, 'rgb(255, 255, 255)');
      g.addColorStop(1, 'rgb(170, 255, 255)');
      oc.save();
      oc.globalCompositeOperation = 'multiply';
      oc.fillStyle = g;
      oc.fillRect(0, 0, cw, ch);
      oc.restore();
    });
  }

  detail = { scale, normal, orm: orm.canvas };
  return detail;
}
