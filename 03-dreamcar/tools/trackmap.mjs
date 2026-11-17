// Draws the course: a map from above and, under it, the height, the gradient
// and the speed the road allows, all against distance. This is how the layout
// in src/game/trackLayout.js is judged before anyone drives it.
//
//   node tools/trackmap.mjs out.svg [--png out.png] [--fit idA,idB]
//
// --png  also renders the SVG to a PNG (needs Playwright available to Node).
// --fit  the plan no longer closes after an edit: solve the lengths of the two
//        straights named so that it does, print them (paste them into the
//        layout), and draw the fitted course.
//
// The map is a true view from above with north (+Z) up the page, so world +X
// runs to the left. Solid edges are drawn by kind: rail, rock and trees in
// colour, the tunnel's walls and the viaduct's parapets in ink (they are
// labelled where they stand).

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
import { LAYOUT, TUNNEL, segmentLength } from '../src/game/trackLayout.js';
import { EDGE, closureOf, createTrack, speedEnvelope } from '../src/game/track.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1];
};
const pngPath = flag('--png');
const fitIds = flag('--fit');
const svgPath = args[0];
if (!svgPath) {
  console.error('usage: node tools/trackmap.mjs out.svg [--png out.png] [--fit idA,idB]');
  process.exit(2);
}

// ---- closing the loop ---------------------------------------------------------------------------------------

/**
 * Solves the lengths of two straights so that the lap ends where it began. Where the lap ends moves in a straight
 * line as a straight grows, so one step from any valid layout lands on the answer; a second step only tidies rounding.
 */
function fit(layout, ids) {
  const pieces = ids.map((id) => {
    const seg = layout.segments.find((it) => it.id === id);
    if (!seg || seg.r) throw new Error(`--fit: "${id}" is not a straight of the layout`);
    return seg;
  });
  if (pieces.length !== 2) throw new Error('--fit takes two piece ids: a,b');
  for (let it = 0; it < 2; it++) {
    const base = closureOf(layout);
    const cols = pieces.map((seg) => {
      seg.len += 1;
      const moved = closureOf(layout);
      seg.len -= 1;
      return [moved.dx - base.dx, moved.dz - base.dz];
    });
    const det = cols[0][0] * cols[1][1] - cols[1][0] * cols[0][1];
    if (Math.abs(det) < 1e-6) throw new Error('--fit: the two straights are parallel; pick another pair');
    pieces[0].len += (-base.dx * cols[1][1] + base.dz * cols[1][0]) / det;
    pieces[1].len += (-base.dz * cols[0][0] + base.dx * cols[0][1]) / det;
    for (const seg of pieces) {
      const i = layout.segments.indexOf(seg);
      const least = ((seg.ease ?? 0) + (layout.segments[(i + 1) % layout.segments.length].ease ?? 0)) / 2;
      if (seg.len < least) {
        console.error(`--fit: "${seg.id}" would have to be ${seg.len.toFixed(1)} m, less than the ${least} m its eases need`);
        const other = pieces.find((it) => it !== seg);
        console.error(`       (the other one, "${other.id}", comes out at ${other.len.toFixed(1)} m)`);
        process.exit(1);
      }
    }
  }
  for (const seg of pieces) seg.len = Math.round(seg.len * 1e4) / 1e4;
  return pieces;
}

const layout = { ...LAYOUT, segments: LAYOUT.segments.map((seg) => ({ ...seg })) };
const before = closureOf(layout);
console.log(
  `closure as written: ${Math.hypot(before.dx, before.dz).toFixed(4)} m, ${((before.dyaw * 180) / Math.PI).toFixed(4)} degrees`,
);
if (fitIds) {
  for (const seg of fit(layout, fitIds.split(','))) console.log(`fit: ${seg.id}  len: ${seg.len}`);
}

const track = createTrack(layout);
const { count: n, ds, length, halfWidth: hw } = track;

// ---- numbers ------------------------------------------------------------------------------------------------

const speed = speedEnvelope(track);
let minRadius = Infinity;
let minY = Infinity;
let maxY = -Infinity;
let maxGrade = 0;
let minGrade = 0;
let top = 0;
for (let i = 0; i < n; i++) {
  minRadius = Math.min(minRadius, 1 / Math.max(1e-9, Math.abs(track.curvature[i])));
  if (track.py[i] > maxY) {
    maxY = track.py[i];
    top = i;
  }
  minY = Math.min(minY, track.py[i]);
  maxGrade = Math.max(maxGrade, track.grade[i]);
  minGrade = Math.min(minGrade, track.grade[i]);
}
const km = (s) => (s / 1000).toFixed(3);
console.log(`length ${length.toFixed(1)} m in ${n} samples of ${ds.toFixed(4)} m`);
console.log(`tightest radius ${minRadius.toFixed(1)} m`);
console.log(`height ${minY.toFixed(1)} to ${maxY.toFixed(1)} m (top at s = ${(top * ds).toFixed(0)} m)`);
console.log(
  `gradient ${(minGrade * 100).toFixed(2)} to ${(maxGrade * 100).toFixed(2)} per cent, descent scaled by ${track.closure.gradeScale.toFixed(4)}`,
);
for (const sec of track.sections) {
  const len = track.wrap(sec.s1 - sec.s0);
  console.log(`  ${sec.name.padEnd(18)} ${sec.s0.toFixed(0).padStart(5)} to ${sec.s1.toFixed(0).padStart(5)}  (${len.toFixed(0)} m)`);
}
for (const t of track.tunnels) console.log(`  tunnel ${t.s0.toFixed(0)} to ${t.s1.toFixed(0)} (${(t.s1 - t.s0).toFixed(0)} m)`);
for (const b of track.bridges) console.log(`  bridge ${b.s0.toFixed(0)} to ${b.s1.toFixed(0)} (${(b.s1 - b.s0).toFixed(0)} m)`);
console.log(`  sector lines at ${track.sectors.map((s) => `${s.toFixed(0)} m (${((s / length) * 100).toFixed(0)} %)`).join(', ')}`);
console.log('pieces:');
{
  let s = 0;
  for (const seg of layout.segments) {
    const len = segmentLength(seg);
    const what = seg.r ? `${seg.r > 0 ? 'left ' : 'right'} R ${Math.abs(seg.r)} through ${seg.deg} deg` : 'straight';
    console.log(`  ${seg.id.padEnd(8)} ${s.toFixed(0).padStart(5)} +${len.toFixed(1).padStart(6)}  ${what}`);
    s += len;
  }
}

// ---- drawing ------------------------------------------------------------------------------------------------

const INK = '#0b0b0b';
const INK2 = '#52514e';
const MUTED = '#8b8a84';
const GRID = '#e4e3dd';
const SURFACE_BG = '#fcfcfb';
const VERGE = '#eeede7';
const PAVEMENT = '#9a9993';
const TUNNEL_FILL = '#55544f';
const DECK_FILL = '#c9c8c1';
const SERIES = '#2a78d6';
const EDGE_STYLE = {
  [EDGE.RAIL]: { name: 'steel rail', stroke: '#2a78d6', width: 1.6, dash: '' },
  [EDGE.ROCK]: { name: 'rock', stroke: '#eb6834', width: 2.4, dash: '' },
  [EDGE.TREES]: { name: 'trees', stroke: '#1baf7a', width: 2.4, dash: '1.5 3.5' },
  [EDGE.WALL]: { name: 'tunnel wall', stroke: INK, width: 1.6, dash: '' },
  [EDGE.PARAPET]: { name: 'parapet', stroke: INK, width: 1.2, dash: '5 2.5' },
};
const FONT = 'font-family="system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"';

const PAD = 70;
const MAP_W = 1500;
const b = track.bounds;
const reach = 60;
const spanX = b.maxX - b.minX + 2 * reach;
const spanZ = b.maxZ - b.minZ + 2 * reach;
const scale = Math.min(MAP_W / spanX, 1500 / spanZ);
const mapW = spanX * scale;
const mapH = spanZ * scale;
const STRIP_W = Math.max(mapW, 1100);
const WIDTH = Math.max(mapW, STRIP_W) + 2 * PAD;
const mapX0 = PAD + (WIDTH - 2 * PAD - mapW) / 2;
const mapY0 = PAD + 30;
// World (x, z) to the page: +X to the left, +Z up.
const X = (x) => mapX0 + (b.maxX + reach - x) * scale;
const Y = (z) => mapY0 + (b.maxZ + reach - z) * scale;
const P = new Vector3();
const at = (s, lat) => {
  track.pointAt(s, lat, P);
  return [X(P.x), Y(P.z)];
};
const f1 = (v) => v.toFixed(1);
const out = [];
const text = (x, y, str, { size = 13, fill = INK2, anchor = 'start', weight = 400 } = {}) => {
  out.push(
    `<text x="${f1(x)}" y="${f1(y)}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${str}</text>`,
  );
};

/** How far (px) the point `beyond` metres outside the pavement on one side of s is from every other part of the road. */
function roomAt(s, side, beyond) {
  const [x, y] = at(s, side * (hw + beyond));
  let room = Infinity;
  for (let i = 0; i < n; i += 4) {
    if (Math.abs(track.delta(i * ds, s)) < 70) continue;
    room = Math.min(room, Math.hypot(X(track.px[i]) - x, Y(track.pz[i]) - y));
  }
  return room;
}

/** A closed band between two offsets of the centre line over [i0, i1] samples. */
function band(i0, i1, latA, latB, fill) {
  const fwd = [];
  const back = [];
  for (let i = i0; i <= i1; i++) {
    const s = i * ds;
    const a = typeof latA === 'function' ? latA(i % n) : latA;
    const c = typeof latB === 'function' ? latB(i % n) : latB;
    fwd.push(at(s, a).map(f1).join(','));
    back.push(at(s, c).map(f1).join(','));
  }
  out.push(`<polygon points="${fwd.concat(back.reverse()).join(' ')}" fill="${fill}"/>`);
}

const total = STRIP_W;
const stripX0 = PAD + (WIDTH - 2 * PAD - STRIP_W) / 2;
const SX = (s) => stripX0 + (s / length) * total;
const strips = [
  { title: 'Height above the lake shore (m)', h: 190, values: track.py, unit: 1, lo: 0, hi: Math.ceil(maxY / 20) * 20, step: 20, area: true },
  { title: 'Gradient (per cent, climbing is positive)', h: 120, values: track.grade, unit: 100, lo: -10, hi: 10, step: 5, zero: true },
  {
    title: 'Fastest possible speed here (km/h): an envelope with more grip and brakes than the car has',
    h: 120,
    values: speed,
    unit: 3.6,
    lo: 0,
    hi: 260,
    step: 50,
  },
];
const stripsY0 = mapY0 + mapH + 70;
const HEIGHT = stripsY0 + strips.reduce((sum, st) => sum + st.h + 62, 0) + 20;

out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f1(WIDTH)}" height="${f1(HEIGHT)}" viewBox="0 0 ${f1(WIDTH)} ${f1(HEIGHT)}">`);
out.push(`<rect width="100%" height="100%" fill="${SURFACE_BG}"/>`);
text(PAD, 44, 'Dreamcar: the course', { size: 22, fill: INK, weight: 600 });
text(
  PAD,
  66,
  `${km(length)} km, driven clockwise · ${f1(maxY - minY)} m of climb · tightest radius ${f1(minRadius)} m · ` +
    `gradient ${f1(minGrade * 100)} to +${f1(maxGrade * 100)} %`,
  { size: 14 },
);

// The corridor: verge, pavement, structures.
band(0, n, (i) => track.edgeL[i], (i) => -track.edgeR[i], VERGE);
band(0, n, hw, -hw, PAVEMENT);
const bore = hw + TUNNEL.wallOffset;
for (const t of track.tunnels) band(Math.ceil(t.s0 / ds), Math.floor(t.s1 / ds), bore, -bore, TUNNEL_FILL);
for (const br of track.bridges) band(Math.ceil(br.s0 / ds), Math.floor(br.s1 / ds), hw, -hw, DECK_FILL);

// Solid edges, one line per run of the same kind.
for (const side of [1, -1]) {
  const kind = side > 0 ? track.kindL : track.kindR;
  const edge = side > 0 ? track.edgeL : track.edgeR;
  let i = 0;
  while (i < n) {
    let j = i;
    const pts = [];
    while (j < n && kind[j] === kind[i]) {
      pts.push(at(j * ds, side * edge[j]).map(f1).join(','));
      j++;
    }
    if (j < n) pts.push(at(j * ds, side * edge[j]).map(f1).join(','));
    else pts.push(at(0, side * edge[0]).map(f1).join(','));
    const st = EDGE_STYLE[kind[i]];
    out.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`,
    );
    i = j;
  }
}

// Centre line and distance marks.
{
  const pts = [];
  for (let i = 0; i <= n; i += 2) pts.push(at(i * ds, 0).map(f1).join(','));
  out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#ffffff" stroke-width="0.8" stroke-dasharray="6 6" opacity="0.85"/>`);
  for (let s = 100; s < length - 30; s += 100) {
    const major = s % 500 === 0;
    const [x0, y0] = at(s, hw + (major ? 7 : 3));
    const [x1, y1] = at(s, -hw - (major ? 7 : 3));
    out.push(`<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${INK2}" stroke-width="${major ? 1.2 : 0.6}"/>`);
    if (major) {
      // Inside the loop, unless another part of the road is in the way there.
      const side = roomAt(s, -1, 30) < 40 && roomAt(s, 1, 30) > roomAt(s, -1, 30) ? 1 : -1;
      const [lx, ly] = at(s, side * (hw + 30));
      text(lx, ly + 4, `${(s / 1000).toFixed(1)} km`, { size: 11, anchor: 'middle', fill: MUTED });
    }
  }
}

// Lamps.
for (const lamp of track.lamps) {
  const [x, y] = at(lamp.s, lamp.lat);
  out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${lamp.kind === 'street' ? 2.2 : 1}" fill="#eda100" stroke="${SURFACE_BG}" stroke-width="0.5"/>`);
}

// Lines across the road: start/finish and the two sector lines.
const lines = [
  { s: 0, label: 'Start / finish' },
  { s: track.sectors[0], label: 'Sector 1' },
  { s: track.sectors[1], label: 'Sector 2' },
];
for (const line of lines) {
  const [x0, y0] = at(line.s, track.edgeAt(line.s, 1));
  const [x1, y1] = at(line.s, -track.edgeAt(line.s, -1));
  out.push(`<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${INK}" stroke-width="2.4"/>`);
  // Lines are labelled inside the loop (the right of travel); the stretches are named outside it.
  const [lx, ly] = at(line.s, -track.edgeAt(line.s, -1) - 14);
  const [cx] = at(line.s, 0);
  const anchor = Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end';
  text(lx, ly + (anchor === 'middle' ? (ly < y0 ? -2 : 12) : 4), line.label, { size: 13, fill: INK, weight: 600, anchor });
}

// Grid slots and the direction of travel.
for (let slot = 0; slot < 4; slot++) {
  const g = track.grid(slot);
  out.push(`<circle cx="${f1(X(g.x))}" cy="${f1(Y(g.z))}" r="1.8" fill="${INK}"/>`);
}
{
  const [x0, y0] = at(40, hw + 22);
  const [x1, y1] = at(95, hw + 22);
  const a = Math.atan2(y1 - y0, x1 - x0);
  const head = [
    [x1, y1],
    [x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)],
    [x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)],
  ];
  out.push(`<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${INK}" stroke-width="1.6"/>`);
  out.push(`<polygon points="${head.map((p) => p.map(f1).join(',')).join(' ')}" fill="${INK}"/>`);
}

// Names of the stretches, set outside the loop (the left of a clockwise lap).
for (const sec of track.sections) {
  // Half way along the stretch, or wherever near there the outside of the road has most room for a name.
  let mid = sec.id === 'straight' ? 150 : track.wrap(sec.s0 + track.wrap(sec.s1 - sec.s0) / 2);
  if (roomAt(mid, 1, 40) < 60) {
    for (let u = 0.1; u < 0.95; u += 0.1) {
      const s = track.wrap(sec.s0 + track.wrap(sec.s1 - sec.s0) * u);
      if (roomAt(s, 1, 40) > roomAt(mid, 1, 40)) mid = s;
    }
  }
  const [x, y] = at(mid, track.edgeAt(mid, 1) + 16);
  const [cx, cy] = at(mid, 0);
  // Set the name beside the road, on the outside: to the left or right of it where the road runs up the page,
  // above or below where it runs across.
  const sideways = Math.abs(x - cx) > Math.abs(y - cy);
  const anchor = sideways ? (x > cx ? 'start' : 'end') : 'middle';
  text(x + (sideways ? Math.sign(x - cx) * 6 : 0), y + (sideways ? 5 : y > cy ? 16 : -8), sec.name, { size: 14, fill: INK, anchor, weight: 600 });
}

// North, scale, legend.
{
  const x = mapX0 + mapW - 30;
  const y = mapY0 + 30;
  out.push(`<line x1="${x}" y1="${y + 34}" x2="${x}" y2="${y}" stroke="${INK}" stroke-width="1.6"/>`);
  out.push(`<polygon points="${x},${y - 8} ${x - 5},${y + 4} ${x + 5},${y + 4}" fill="${INK}"/>`);
  text(x, y + 50, 'N', { size: 13, fill: INK, anchor: 'middle', weight: 600 });
  const bx = mapX0 + mapW - 30 - 100 * scale;
  const by = mapY0 + 108;
  out.push(`<path d="M${f1(bx)} ${by - 5}V${by}H${f1(bx + 100 * scale)}V${by - 5}" fill="none" stroke="${INK}" stroke-width="1.4"/>`);
  text(bx + 50 * scale, by - 8, '100 m', { size: 12, fill: INK, anchor: 'middle' });
  let ly = mapY0 + mapH - 150;
  const lx = mapX0 + 8;
  text(lx, ly, 'What stands at the edge', { size: 12, fill: INK, weight: 600 });
  for (const kind of [EDGE.RAIL, EDGE.ROCK, EDGE.TREES, EDGE.WALL, EDGE.PARAPET]) {
    ly += 19;
    const st = EDGE_STYLE[kind];
    out.push(
      `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 34}" y2="${ly - 4}" stroke="${st.stroke}" stroke-width="${st.width + 0.6}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`,
    );
    text(lx + 42, ly, st.name, { size: 12 });
  }
  ly += 19;
  out.push(`<circle cx="${lx + 17}" cy="${ly - 4}" r="2.4" fill="#eda100"/>`);
  text(lx + 42, ly, 'lamp', { size: 12 });
}

// The strips: one measure each, all against distance from the line.
let y0 = stripsY0;
for (const st of strips) {
  const SY = (v) => y0 + st.h - ((v - st.lo) / (st.hi - st.lo)) * st.h;
  text(stripX0, y0 - 12, st.title, { size: 13, fill: INK, weight: 600 });
  for (const range of [...track.tunnels, ...track.bridges]) {
    out.push(`<rect x="${f1(SX(range.s0))}" y="${f1(y0)}" width="${f1(SX(range.s1) - SX(range.s0))}" height="${st.h}" fill="${VERGE}"/>`);
  }
  for (let v = st.lo; v <= st.hi + 1e-9; v += st.step) {
    const strong = st.zero && v === 0;
    out.push(`<line x1="${f1(stripX0)}" y1="${f1(SY(v))}" x2="${f1(stripX0 + total)}" y2="${f1(SY(v))}" stroke="${strong ? MUTED : GRID}" stroke-width="1"/>`);
    text(stripX0 - 8, SY(v) + 4, `${v}`, { size: 11, anchor: 'end', fill: MUTED });
  }
  for (const sec of track.sections) {
    if (sec.s0 > sec.s1) continue;
    out.push(`<line x1="${f1(SX(sec.s0))}" y1="${f1(y0)}" x2="${f1(SX(sec.s0))}" y2="${f1(y0 + st.h)}" stroke="${GRID}" stroke-width="1"/>`);
  }
  {
    const tail = track.sections[0];
    out.push(`<line x1="${f1(SX(tail.s0))}" y1="${f1(y0)}" x2="${f1(SX(tail.s0))}" y2="${f1(y0 + st.h)}" stroke="${GRID}" stroke-width="1"/>`);
    out.push(`<line x1="${f1(SX(tail.s1))}" y1="${f1(y0)}" x2="${f1(SX(tail.s1))}" y2="${f1(y0 + st.h)}" stroke="${GRID}" stroke-width="1"/>`);
  }
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(`${f1(SX(i * ds))},${f1(SY(st.values[i % n] * st.unit))}`);
  if (st.area) {
    out.push(`<polygon points="${f1(SX(0))},${f1(SY(st.lo))} ${pts.join(' ')} ${f1(SX(length))},${f1(SY(st.lo))}" fill="${SERIES}" opacity="0.12"/>`);
  }
  out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${SERIES}" stroke-width="2" stroke-linejoin="round"/>`);
  for (const s of track.sectors) {
    out.push(`<line x1="${f1(SX(s))}" y1="${f1(y0)}" x2="${f1(SX(s))}" y2="${f1(y0 + st.h)}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3"/>`);
  }
  for (let s = 0; s <= length; s += 250) {
    out.push(`<line x1="${f1(SX(s))}" y1="${f1(y0 + st.h)}" x2="${f1(SX(s))}" y2="${f1(y0 + st.h + 4)}" stroke="${MUTED}" stroke-width="1"/>`);
    if (s % 500 === 0) text(SX(s), y0 + st.h + 17, `${(s / 1000).toFixed(1)}`, { size: 11, anchor: 'middle', fill: MUTED });
  }
  if (st.area) {
    for (const sec of track.sections) {
      const a = sec.s0 > sec.s1 ? 0 : sec.s0;
      text(SX((a + sec.s1) / 2), y0 + st.h + 34, sec.id, { size: 11, anchor: 'middle' });
    }
    text(SX(track.sections[0].s0 + (length - track.sections[0].s0) / 2), y0 + st.h + 34, 'straight', { size: 11, anchor: 'middle' });
    text(SX(top * ds), SY(maxY) - 7, `${f1(maxY)} m`, { size: 12, fill: INK, anchor: 'middle', weight: 600 });
    text(SX(track.tunnels[0].s0) + 4, y0 + 14, 'in the tunnel', { size: 11 });
    text(SX(track.bridges[0].s0) + 4, y0 + 30, 'on the viaduct', { size: 11 });
    for (let k = 0; k < 2; k++) text(SX(track.sectors[k]) + 5, y0 + st.h - 8, `sector line ${k + 1}`, { size: 11 });
  }
  text(stripX0 + total, y0 + st.h + 17, 'km from the line', { size: 11, anchor: 'end', fill: MUTED });
  y0 += st.h + 62;
}
out.push('</svg>');

writeFileSync(svgPath, out.join('\n'));
console.log(`wrote ${svgPath}`);

if (pngPath) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Math.ceil(WIDTH), height: Math.ceil(HEIGHT) } });
  await page.goto(`file://${resolve(svgPath)}`);
  await page.screenshot({ path: pngPath });
  await browser.close();
  console.log(`wrote ${pngPath}`);
}
