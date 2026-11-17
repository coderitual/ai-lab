// The atlas: the features' outlines (features.js) baked once, at start-up,
// into textures of distances over the skin's (u, v).
//
// Every texel is a point of the skin (the layout of body.js says which); its
// 3D point is projected into each feature's view and the distance to the
// outline there is measured. The shaders threshold the distances, so an edge
// stays sharp however close the camera comes (the texture only has to be
// fine enough for the outline's curvature, not for its edge), and they
// antialias it with the distance's screen-space derivatives.
//
// Distances are stored in 8 bits over +/- RANGE: 0.24 mm a step. A feature's
// outline is a dense polyline; a grid over its plane lists the segments near
// each cell, so a texel looks at a few dozen segments, not hundreds. The sign
// of an area's distance comes from the nearest segment (or, at a vertex, from
// the two segments that meet there); a cell with no segment near it is wholly
// inside or wholly outside, which is found once per cell.

import { CHANNELS, VIEWS, buildFeatures, viewBasis } from './features.js';

/** The distance the atlas holds either side of an edge (m). */
export const RANGE = 0.03;

/** Atlas size per tier [width (along the car), height (round the section)]. */
export const ATLAS_SIZE = { low: [512, 256], medium: [1024, 512], high: [1536, 768] };

/** One feature, made ready for measuring. */
function prepare(feature) {
  const dir = VIEWS[feature.view];
  const [e1, e2] = viewBasis(dir);
  const raw = feature.points;
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = pts[pts.length - 1];
    if (Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]) > 1e-5) pts.push(raw[i]);
  }
  if (feature.closed && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-5) pts.pop();
  const n = pts.length;
  const count = feature.closed ? n : n - 1;
  const ax = new Float64Array(count);
  const ay = new Float64Array(count);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const len2 = new Float64Array(count);
  let area = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    ax[i] = a[0];
    ay[i] = a[1];
    dx[i] = b[0] - a[0];
    dy[i] = b[1] - a[1];
    len2[i] = dx[i] * dx[i] + dy[i] * dy[i];
    area += a[0] * b[1] - b[0] * a[1];
    x0 = Math.min(x0, a[0], b[0]);
    y0 = Math.min(y0, a[1], b[1]);
    x1 = Math.max(x1, a[0], b[0]);
    y1 = Math.max(y1, a[1], b[1]);
  }
  // inside is on the left of a counter-clockwise outline
  const turn = area > 0 ? 1 : -1;
  // the grid, over the outline's box grown by RANGE
  const cell = RANGE / 2;
  x0 -= RANGE;
  y0 -= RANGE;
  const cols = Math.ceil((x1 + RANGE - x0) / cell) + 1;
  const rows = Math.ceil((y1 + RANGE - y0) / cell) + 1;
  const lists = Array.from({ length: cols * rows }, () => []);
  for (let i = 0; i < count; i++) {
    const c0 = Math.max(0, Math.floor((Math.min(ax[i], ax[i] + dx[i]) - RANGE - x0) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax[i], ax[i] + dx[i]) + RANGE - x0) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(ay[i], ay[i] + dy[i]) - RANGE - y0) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay[i], ay[i] + dy[i]) + RANGE - y0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * cols + c].push(i);
  }
  const start = new Int32Array(cols * rows + 1);
  lists.forEach((l, k) => (start[k + 1] = start[k] + l.length));
  const segs = new Int32Array(start[cols * rows]);
  lists.forEach((l, k) => segs.set(l, start[k]));
  // a cell with no segment near it is all inside or all outside: decide by its centre, a row at a time
  const inside = new Uint8Array(cols * rows);
  if (feature.closed) {
    const xs = [];
    for (let r = 0; r < rows; r++) {
      const py = y0 + (r + 0.5) * cell;
      xs.length = 0;
      for (let i = 0; i < count; i++) {
        const ya = ay[i];
        const yb = ay[i] + dy[i];
        if (ya > py !== yb > py) xs.push(ax[i] + ((py - ya) / dy[i]) * dx[i]);
      }
      xs.sort((a, b) => a - b);
      for (let c = 0, m = 0; c < cols; c++) {
        const px = x0 + (c + 0.5) * cell;
        while (m < xs.length && xs[m] < px) m++;
        inside[r * cols + c] = m & 1;
      }
    }
  }
  const gate = feature.gate;
  return {
    name: feature.name,
    closed: feature.closed,
    dir,
    e1,
    e2,
    gateN: gate.n,
    ymin: gate.y ? gate.y[0] : -Infinity,
    ymax: gate.y ? gate.y[1] : Infinity,
    zmin: gate.z ? gate.z[0] : -Infinity,
    zmax: gate.z ? gate.z[1] : Infinity,
    x0,
    y0,
    cols,
    rows,
    cell,
    start,
    segs,
    inside,
    count,
    turn,
    ax,
    ay,
    dx,
    dy,
    len2,
  };
}

/** Distance from a skin point (position p, normal n) to a prepared feature; +/- Infinity beyond RANGE. */
function measure(f, p, n) {
  if (p[1] < f.ymin || p[1] > f.ymax || p[2] < f.zmin || p[2] > f.zmax) return Infinity;
  const facing = n[0] * f.dir[0] + n[1] * f.dir[1] + n[2] * f.dir[2];
  if (facing < f.gateN) return Infinity;
  const px = p[0] * f.e1[0] + p[1] * f.e1[1] + p[2] * f.e1[2];
  const py = p[0] * f.e2[0] + p[1] * f.e2[1] + p[2] * f.e2[2];
  const c = Math.floor((px - f.x0) / f.cell);
  const r = Math.floor((py - f.y0) / f.cell);
  if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return Infinity;
  const k = r * f.cols + c;
  const s0 = f.start[k];
  const s1 = f.start[k + 1];
  if (s0 === s1) return f.inside[k] ? -Infinity : Infinity;
  let best = Infinity;
  let bi = -1;
  let bt = 0;
  for (let j = s0; j < s1; j++) {
    const i = f.segs[j];
    let t = ((px - f.ax[i]) * f.dx[i] + (py - f.ay[i]) * f.dy[i]) / f.len2[i];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - f.ax[i] - t * f.dx[i];
    const ey = py - f.ay[i] - t * f.dy[i];
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      bi = i;
      bt = t;
    }
  }
  // a distance in the view's plane is shorter than the same distance on a surface that leans away from it
  let d = Math.sqrt(best) / Math.max(facing, 0.3);
  if (d >= RANGE) d = Infinity; // beyond the range, only the side matters (and offsets of it stay beyond)
  if (!f.closed) return d;
  // which side: the segment's left normal, or at a vertex the sum of the two segments' normals
  let nx = -f.dy[bi] / Math.sqrt(f.len2[bi]);
  let ny = f.dx[bi] / Math.sqrt(f.len2[bi]);
  let vx = f.ax[bi];
  let vy = f.ay[bi];
  if (bt >= 1 || bt <= 0) {
    const other = bt >= 1 ? (bi + 1) % f.count : (bi - 1 + f.count) % f.count;
    const l = Math.sqrt(f.len2[other]);
    nx += -f.dy[other] / l;
    ny += f.dx[other] / l;
    if (bt >= 1) {
      vx += f.dx[bi];
      vy += f.dy[bi];
    }
  }
  const left = (px - vx) * nx + (py - vy) * ny > 0;
  return left === f.turn > 0 ? -d : d;
}

/**
 * Bakes the atlas.
 * @param {import('./skin.js').Skin} skin
 * @param {{ toU: (s: number) => number, toV: (t: number) => number }} lay the layout of body.js
 * @param {number[]} size [width, height]
 * @returns {{ width: number, height: number, data: Uint8Array[], sample: (channel: number, s: number, t: number) => number }}
 */
export function bakeAtlas(skin, lay, [width, height]) {
  const features = buildFeatures().map(prepare);
  const channels = CHANNELS.length;
  const textures = Math.ceil(channels / 4);
  const data = Array.from({ length: textures }, () => new Uint8Array(width * height * 4).fill(255));
  const us = Float64Array.from({ length: width }, (_, i) => lay.toU((i + 0.5) / width));
  const vs = Float64Array.from({ length: height }, (_, j) => lay.toV((j + 0.5) / height));
  const F = features.length;
  const frame = new Float64Array(6);
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  const d = Object.fromEntries(features.map((f) => [f.name, 0]));
  const dist = new Float64Array(F);
  const bytes = new Uint8Array(channels);
  const where = (i, j) => {
    skin.surface(us[i], vs[j], frame);
    p[0] = frame[0];
    p[1] = frame[1];
    p[2] = frame[2];
    n[0] = frame[3];
    n[1] = frame[4];
    n[2] = frame[5];
  };
  const encode = () => {
    for (let k = 0; k < F; k++) d[features[k].name] = dist[k];
    for (let c = 0; c < channels; c++) bytes[c] = Math.max(0, Math.min(255, Math.round(127.5 + (CHANNELS[c](d) / RANGE) * 127.5)));
  };
  // the bytes of a texel as one 32-bit word per texture
  const words = new Uint32Array(textures);
  const wordBytes = new Uint8Array(words.buffer).fill(255);
  const encodeWords = () => {
    encode();
    wordBytes.set(bytes);
  };
  const views = data.map((t) => new Uint32Array(t.buffer));
  const put = (i, j) => {
    const o = j * width + i;
    for (let t = 0; t < textures; t++) views[t][o] = words[t];
  };
  // Most of the atlas is far from every edge. Measure the corners of blocks of B x B texels first; inside a block
  // only the features that are not beyond RANGE on the same side at all four corners are measured, and a block
  // with none is filled from its corners without looking at the skin (B is small enough that no outline fits
  // between the corners unseen).
  const texelSize = Math.max(lay.extent[0] / width, lay.extent[1] / height);
  const B = [4, 2, 1].find((b) => b * texelSize * Math.SQRT1_2 < 0.65 * RANGE) ?? 1;
  const bw = Math.ceil(width / B) + 1;
  const bh = Math.ceil(height / B) + 1;
  const corner = new Float64Array(bw * bh * F);
  for (let bj = 0; bj < bh; bj++) {
    for (let bi = 0; bi < bw; bi++) {
      where(Math.min(bi * B, width - 1), Math.min(bj * B, height - 1));
      for (let k = 0; k < F; k++) corner[(bj * bw + bi) * F + k] = measure(features[k], p, n);
    }
  }
  const active = new Int32Array(F);
  for (let bj = 0; bj < bh - 1; bj++) {
    for (let bi = 0; bi < bw - 1; bi++) {
      let count = 0;
      const o00 = (bj * bw + bi) * F;
      const o10 = o00 + F;
      const o01 = o00 + bw * F;
      const o11 = o01 + F;
      for (let k = 0; k < F; k++) {
        const a = corner[o00 + k];
        if (Math.abs(a) === Infinity && corner[o10 + k] === a && corner[o01 + k] === a && corner[o11 + k] === a) dist[k] = a;
        else active[count++] = k;
      }
      if (!count) encodeWords();
      for (let j = bj * B; j < Math.min(height, (bj + 1) * B); j++) {
        for (let i = bi * B; i < Math.min(width, (bi + 1) * B); i++) {
          if (count) {
            where(i, j);
            for (let m = 0; m < count; m++) dist[active[m]] = measure(features[active[m]], p, n);
            encodeWords();
          }
          put(i, j);
        }
      }
    }
  }
  return {
    width,
    height,
    data,
    /** The least and greatest distance (m) of a channel over the atlas rectangle [s0, s1] x [t0, t1]. */
    extremes(channel, s0, s1, t0, t1) {
      const tex = data[channel >> 2];
      const c = channel & 3;
      const i0 = Math.max(0, Math.floor(s0 * width - 1));
      const i1 = Math.min(width - 1, Math.ceil(s1 * width));
      const j0 = Math.max(0, Math.floor(t0 * height - 1));
      const j1 = Math.min(height - 1, Math.ceil(t1 * height));
      let lo = 255;
      let hi = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const b = tex[(j * width + i) * 4 + c];
          if (b < lo) lo = b;
          if (b > hi) hi = b;
        }
      }
      return [((lo - 127.5) / 127.5) * RANGE, ((hi - 127.5) / 127.5) * RANGE];
    },
    /** A channel's distance (m) at atlas coordinates (s, t), interpolated as the GPU would. */
    sample(channel, s, t) {
      const tex = data[channel >> 2];
      const c = channel & 3;
      const x = Math.min(width - 1, Math.max(0, s * width - 0.5));
      const y = Math.min(height - 1, Math.max(0, t * height - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const at = (xx, yy) => tex[(yy * width + xx) * 4 + c];
      const value = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
      return ((value - 127.5) / 127.5) * RANGE;
    },
  };
}
