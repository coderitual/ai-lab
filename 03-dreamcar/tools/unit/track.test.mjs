// The road, tested: everything docs/design.md asks of the course ("The road")
// and everything the car and the scenery rely on, asserted on the real track.
//
//   node tools/unit/track.test.mjs        (or: node tools/unit.mjs track)
//
// Three kinds of check: the course is the one that was designed (each stretch,
// its radii, gradients and what stands at its edge); it is fit to drive at
// 250 km/h (no kink, no crest a car could fly off, room between its parts);
// and the questions asked of it every step (locate, surfaceAt, profile,
// frameAt) agree with each other to the centimetre, from any point, with or
// without a hint. Random points come from a small seeded generator, so a
// failure is the same failure every time.

import { LAYOUT, SECTIONS, SHOULDER, TUNNEL, VIADUCT, segmentLength } from '../../src/game/trackLayout.js';
import { EDGE, GRIP, SURFACE, createTrack, speedEnvelope } from '../../src/game/track.js';

// ---- a very small harness -----------------------------------------------------------------------------------

let failures = 0;
let checks = 0;
const notes = [];
function test(name, fn) {
  const before = failures;
  try {
    fn();
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  console.log(`${failures === before ? '  ok  ' : 'FAILED'}  ${name}`);
}
function expect(condition, message) {
  checks++;
  if (condition) return;
  failures++;
  console.log(`      ${message}`);
}
const between = (v, lo, hi, what) => expect(v >= lo && v <= hi, `${what}: ${fmt(v)} is not within ${lo} .. ${hi}`);
const fmt = (v, digits = 3) => (Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : String(v));
const note = (text) => notes.push(text);

/** mulberry32: the same numbers every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the track and a few ways of reading it -------------------------------------------------------------------

const track = createTrack();
const { count: n, ds, length: L, halfWidth: hw } = track;
const G = 9.81;
const DEG = Math.PI / 180;
const pave = hw + SHOULDER;
const idx = (s) => ((Math.round(s / ds) % n) + n) % n;
const section = (id) => track.sections.find((sec) => sec.id === id);
const along = (a, b) => Math.abs(track.delta(a, b));

/** Indices of the samples that lie in a stretch, s0 <= s < s1 (it may run through the line). */
function samplesOf(s0, s1) {
  const out = [];
  const first = Math.ceil(s0 / ds - 1e-9);
  const count = Math.ceil((s0 + track.wrap(s1 - s0)) / ds - 1e-9) - first;
  for (let k = 0; k < count; k++) out.push((((first + k) % n) + n) % n);
  return out;
}
const inSection = (id) => samplesOf(section(id).s0, section(id).s1);

/** The bends of a stretch: runs of samples that curve the same way (tighter than `open` metres), with their tightest radius. */
function bendsOf(samples, open = 400) {
  const bends = [];
  let cur = null;
  for (const i of samples) {
    const k = track.curvature[i];
    const dir = Math.abs(k) > 1 / open ? Math.sign(k) : 0;
    if (dir === 0 || (cur && cur.dir !== dir)) cur = null;
    if (dir !== 0) {
      if (!cur) bends.push((cur = { dir, first: i, last: i, radius: Infinity, at: i, count: 0 }));
      cur.last = i;
      cur.count++;
      if (1 / Math.abs(k) < cur.radius) {
        cur.radius = 1 / Math.abs(k);
        cur.at = i;
      }
    }
  }
  return bends;
}

/** Where the pieces of the layout begin. */
const pieces = (() => {
  const out = {};
  let s = 0;
  for (const seg of LAYOUT.segments) {
    const len = segmentLength(seg);
    out[seg.id] = { seg, s0: s, s1: s + len, len };
    s += len;
  }
  return out;
})();

const speed = speedEnvelope(track);
const where = { index: 0, s: 0, lat: 0 };
const ground = {};
const prof = {};
const frame = {};

/** The map position of track coordinates, as the contract defines it: pos + lat * left. */
function mapPoint(s, lat) {
  track.frameAt(s, frame);
  return [frame.pos.x + lat * frame.left.x, frame.pos.z + lat * frame.left.z];
}
/** A random point of the corridor: anywhere along the lap, anywhere between the solid edges. */
function randomSpot(random) {
  const s = random() * L;
  const u = random();
  const lat = -track.edgeAt(s, -1) + u * (track.edgeAt(s, 1) + track.edgeAt(s, -1));
  return [s, lat];
}

// ---- the course as a whole --------------------------------------------------------------------------------------

test('a closed loop of 4.6 to 5.4 km that returns exactly to its start', () => {
  between(L, 4600, 5400, 'length (m)');
  between(ds, 0.95, 1.05, 'sample spacing (m)');
  expect(Math.abs(n * ds - L) < 1e-9, 'count * ds is not the length');
  expect(track.closure.gap < 0.01, `the baked layout misses its start by ${fmt(track.closure.gap, 4)} m (refit it)`);
  expect(Math.abs(track.closure.yawGap) < 0.01 * DEG, 'the turned angles do not add up to one full turn');
  between(track.closure.gradeScale, 0.995, 1.005, 'scale applied to the descent to close the height');
  expect(hw === 6, `paved half width ${hw} m, not 6 (three lanes)`);
  let turn = 0;
  let worstStep = 0;
  let worstTurn = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    turn += ((track.curvature[i] + track.curvature[j]) / 2) * ds;
    worstStep = Math.max(worstStep, Math.abs(Math.hypot(track.px[j] - track.px[i], track.pz[j] - track.pz[i]) - ds));
    // The change of heading between two samples is the curvature between them: no kink anywhere, the seam included.
    const cross = track._fz[i] * track._fx[j] - track._fx[i] * track._fz[j];
    worstTurn = Math.max(worstTurn, Math.abs(Math.asin(cross) - ((track.curvature[i] + track.curvature[j]) / 2) * ds));
  }
  expect(Math.abs(turn + 2 * Math.PI) < 1e-3, `signed curvature over a lap is ${fmt(turn, 5)}, not -2 pi (clockwise)`);
  expect(worstStep < 0.002, `samples are not evenly spaced: off by ${fmt(worstStep, 5)} m`);
  expect(worstTurn < 2e-4, `heading and curvature disagree by ${fmt(worstTurn, 6)} rad between two samples`);
  note(`length ${fmt(L, 1)} m, ${n} samples every ${fmt(ds, 4)} m`);
});

test('no NaN in any array, and every frame is a frame', () => {
  for (const [key, value] of Object.entries(track)) {
    if (!ArrayBuffer.isView(value)) continue;
    let bad = 0;
    for (let i = 0; i < value.length; i++) if (!Number.isFinite(value[i])) bad++;
    expect(bad === 0, `${key} holds ${bad} values that are not finite`);
    if (!key.startsWith('_')) expect(value.length === n, `${key} has ${value.length} entries, not ${n}`);
  }
  let unit = 0;
  let square = 0;
  let normal = 0;
  for (let i = 0; i < n; i++) {
    const t = [track.tx[i], track.ty[i], track.tz[i]];
    const l = [track.lx[i], track.ly[i], track.lz[i]];
    const u = [track.nx[i], track.ny[i], track.nz[i]];
    unit = Math.max(unit, Math.abs(Math.hypot(...t) - 1), Math.abs(Math.hypot(...l) - 1), Math.abs(Math.hypot(...u) - 1));
    // a banked climb tilts left off square to the tangent by about grade x sin(bank)
    square = Math.max(square, Math.abs(t[0] * l[0] + t[1] * l[1] + t[2] * l[2]) - Math.abs(track.grade[i] * Math.sin(track.bank[i])));
    // up = forward x left
    const c = [t[1] * l[2] - t[2] * l[1], t[2] * l[0] - t[0] * l[2], t[0] * l[1] - t[1] * l[0]];
    normal = Math.max(normal, Math.hypot(c[0] - u[0], c[1] - u[1], c[2] - u[2]));
    expect(Math.abs(l[1] - Math.sin(track.bank[i])) < 1e-6, `left is not tilted by the banking at sample ${i}`);
    // On the map, left is square to the direction of travel (it is the banking and the climb that tilt them).
    expect(Math.abs(t[0] * l[0] + t[2] * l[2]) < 1e-6, `left is not across the road on the map at sample ${i}`);
    expect(Math.abs(track.ty[i] / Math.hypot(track.tx[i], track.tz[i]) - track.grade[i]) < 1e-5, `tangent and grade disagree at ${i}`);
  }
  expect(unit < 1e-6, `a frame vector is not unit length (off by ${fmt(unit, 8)})`);
  expect(square < 0.001, `left is ${fmt(square, 4)} off square to the tangent (more than a banked climb explains)`);
  expect(normal < 0.001, `normal is not tangent x left (off by ${fmt(normal, 5)})`);
});

// (sea lane) the coast after the tunnel runs low over the bay, out and back: the top is where the road comes out of
// the tunnel
test('60 to 130 m between the lake and the top; the top is at the tunnel\'s way out', () => {
  let lo = Infinity;
  let hi = -Infinity;
  let top = 0;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, track.py[i]);
    if (track.py[i] > hi) {
      hi = track.py[i];
      top = i;
    }
  }
  between(hi - LAYOUT.lakeLevel, 60, 130, 'height of the top above the lake (m)');
  expect(Math.abs(lo) < 0.02, `the lowest point is ${fmt(lo)} m, not the shore`);
  expect(['tunnel'].includes(track.sectionAt(top * ds).id), `the highest point is on "${track.sectionAt(top * ds).id}"`);
  note(`height ${fmt(lo, 2)} to ${fmt(hi, 2)} m, top at s = ${fmt(top * ds, 0)} m`);
});

// ---- limits -------------------------------------------------------------------------------------------------------

test('gradient within 8 %, radius never under 50 m, banking into every bend, up to 12 degrees', () => {
  let steep = 0;
  let tight = Infinity;
  let bank = 0;
  let wrongWay = 0;
  for (let i = 0; i < n; i++) {
    steep = Math.max(steep, Math.abs(track.grade[i]));
    tight = Math.min(tight, 1 / Math.max(1e-9, Math.abs(track.curvature[i])));
    bank = Math.max(bank, Math.abs(track.bank[i]));
    // + bank lifts the left edge: a left-hander (+ curvature) must lift the right one.
    if (Math.abs(track.curvature[i]) > 0.002 && track.bank[i] * track.curvature[i] > 0) wrongWay++;
  }
  expect(steep <= 0.0805, `steepest gradient is ${fmt(steep * 100, 2)} %`);
  expect(tight >= 50, `tightest radius is ${fmt(tight, 2)} m`);
  between(bank / DEG, 8, 12.01, 'steepest banking (degrees)');
  expect(wrongWay === 0, `${wrongWay} samples are banked out of the bend`);
  // the pieces that name a banking get it in their middle
  for (const { seg, s0, s1 } of Object.values(pieces)) {
    if (seg.bank == null) continue;
    between(Math.abs(track.bank[idx((s0 + s1) / 2)]) / DEG, seg.bank - 0.3, seg.bank + 0.3, `banking in the middle of ${seg.id}`);
  }
  note(`gradient up to ${fmt(steep * 100, 2)} %, tightest radius ${fmt(tight, 2)} m, banking up to ${fmt(bank / DEG, 2)} degrees`);
});

test('curvature, gradient, banking and height are continuous round the whole lap, the line included', () => {
  let dk = 0;
  let dg = 0;
  let db = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    dk = Math.max(dk, Math.abs(track.curvature[j] - track.curvature[i]) / ds);
    dg = Math.max(dg, Math.abs(track.grade[j] - track.grade[i]) / ds);
    db = Math.max(db, Math.abs(track.bank[j] - track.bank[i]) / ds);
    dy = Math.max(dy, Math.abs(track.py[j] - track.py[i] - ((track.grade[i] + track.grade[j]) / 2) * ds));
  }
  expect(dk < 0.0036, `curvature changes by ${fmt(dk, 5)} per metre`);
  expect(dg < 0.003, `gradient changes by ${fmt(dg, 5)} per metre`);
  expect(db < 0.3 * DEG, `banking changes by ${fmt(db / DEG, 3)} degrees per metre`);
  expect(dy < 1e-4, `height is not the integral of the gradient (off by ${fmt(dy, 6)} m in one step)`);
  note(`per metre: curvature changes up to ${fmt(dk, 5)} /m, gradient ${fmt(dg, 5)}, banking ${fmt(db / DEG, 3)} degrees`);
});

// (sea lane, round 5) the crest that lifted the car went with the coast's old heights: no crest is sharper than 900 m
// now; the sharpest sag is a gentle one (the long right's, where it eases onto the level of the shore, or the low
// point by the bay)
test('no crest sharper than 900 m; no sag sharper than 500 m, by the vertical curves', () => {
  // The vertical radius of each crest and sag. The crest is felt at about 190 km/h (the autopilot's speed there is
  // checked against the wheels' loads in vehicle.test.mjs); everywhere else no crest is sharper than 900 m.
  let sharpCrest = { r: Infinity, s: 0 };
  let otherCrest = Infinity;
  let sharpSag = { r: Infinity, s: 0 };
  const crestZone = [0, 0];
  for (let i = 0; i < n; i++) {
    const bend = (track.grade[(i + 1) % n] - track.grade[(i + n - 1) % n]) / (2 * ds);
    const r = 1 / Math.max(1e-9, Math.abs(bend));
    const s = i * ds;
    if (bend < 0) {
      if (s >= crestZone[0] && s <= crestZone[1]) {
        if (r < sharpCrest.r) sharpCrest = { r, s };
      } else otherCrest = Math.min(otherCrest, r);
    } else if (r < sharpSag.r) sharpSag = { r, s };
  }
  void sharpCrest;
  expect(otherCrest >= 900, `another crest of ${fmt(otherCrest, 0)} m radius`);
  between(sharpSag.r, 500, 3000, 'vertical radius of the sharpest sag (m)');
  note(`crests: none sharper than ${fmt(otherCrest, 0)} m`);
  note(`the sharpest sag: vertical radius ${fmt(sharpSag.r, 0)} m at s = ${fmt(sharpSag.s, 0)} m (${track.sectionAt(sharpSag.s).id})`);
});

test('no self-crossing: stretches more than 150 m apart along the lap leave room for the hillside between them (bridges and the bore aside)', () => {
  // The rule the terrain needs (terrain.js shares the ground between two stretches that are near): between the
  // barriers of any two stretches at least 40 m of ground, no steeper on average than 1 in 2.
  const far = Math.ceil(150 / ds);
  let nearest = { free: Infinity };
  for (let i = 0; i < n; i += 2) {
    for (let j = i + far + 1; j < n; j += 2) {
      if (n - (j - i) <= far) break;
      const d = Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]);
      if (d > 200) continue;
      if (track.sky[i] < 1 || track.sky[j] < 1 || track._onBridge(i * ds) || track._onBridge(j * ds)) continue;
      const free = d - Math.max(track.edgeL[i], track.edgeR[i]) - Math.max(track.edgeL[j], track.edgeR[j]);
      if (free < nearest.free) nearest = { free, d, i, j, dh: Math.abs(track.py[i] - track.py[j]) };
    }
  }
  expect(nearest.free >= 40, `s = ${fmt(nearest.i * ds, 0)} and ${fmt(nearest.j * ds, 0)} m leave ${fmt(nearest.free, 1)} m between barriers`);
  expect(nearest.dh / nearest.free < 0.5, `the ground between s = ${fmt(nearest.i * ds, 0)} and ${fmt(nearest.j * ds, 0)} m rises 1 in ${fmt(nearest.free / nearest.dh, 1)}`);
  note(`closest approach of two stretches: ${fmt(nearest.d, 1)} m apart, ${fmt(nearest.free, 1)} m between barriers, ${fmt(nearest.dh, 1)} m of height (s = ${fmt(nearest.i * ds, 0)} and ${fmt(nearest.j * ds, 0)} m)`);
});

// ---- the stretches, in the order they are driven ---------------------------------------------------------------

test('the named stretches are the ones of the design, in order, and cover the lap', () => {
  const ids = ['straight', 'sweep', 'esses', 'tunnel', 'viaduct', 'carousel', 'crest', 'plunge', 'ledge', 'gully', 'sweepback'];
  expect(track.sections.map((sec) => sec.id).join() === ids.join(), `sections are ${track.sections.map((sec) => sec.id).join()}`);
  expect(JSON.stringify(SECTIONS) === JSON.stringify(track.sections), 'SECTIONS and track.sections disagree');
  for (let k = 0; k < track.sections.length; k++) {
    const a = track.sections[k];
    const b = track.sections[(k + 1) % track.sections.length];
    expect(Math.abs(a.s1 - b.s0) < 1e-9, `"${a.id}" ends at ${a.s1} but "${b.id}" starts at ${b.s0}`);
    expect(typeof a.name === 'string' && a.name.length > 3, `section ${a.id} has no name`);
  }
  expect(track.sections[0].s0 > track.sections[0].s1, 'the straight should run through the line');
  expect(track.sectionAt(0).id === 'straight' && track.sectionAt(L - 1).id === 'straight', 'the line is not on the straight');
  for (const sec of track.sections) {
    const range = `${fmt(sec.s0, 0).padStart(4)} .. ${fmt(sec.s1, 0).padStart(4)}`;
    note(`${sec.name.padEnd(18)} s = ${range} m  (${fmt(track.wrap(sec.s1 - sec.s0), 0)} m)`);
  }
});

test('lakeside straight: about 700 m along z = 0 towards +X, level, about 250 m of it after the line', () => {
  const flat = (i) => Math.abs(track.curvature[i]) < 1 / 3000 && Math.abs(track.grade[i]) < 0.003;
  let before = 0;
  while (before < n && flat((n - 1 - before) % n)) before++;
  let after = 0;
  while (after < n && flat(after)) after++;
  const run = (before + after) * ds;
  between(run, 600, 760, 'level, straight run through the line (m)');
  between(after * ds, 180, 260, 'of it after the line (m)');
  for (const i of [0, idx(150), idx(-150), idx(-400)]) {
    expect(Math.abs(track.py[i]) < 0.05 && Math.abs(track.pz[i]) < 0.05, `the straight is off z = 0, y = 0 at sample ${i}`);
    expect(track.tx[i] > 0.9999, `the straight does not run towards +X at sample ${i}`);
  }
  note(`straight and level for ${fmt(run, 0)} m, ${fmt(before * ds, 0)} m of it before the line`);
});

test('the bends: one slow carousel of about 55 m, the rest 180 to 450 m (the tunnel 1000 m)', () => {
  const bends = bendsOf([...Array(n).keys()], 1200);
  const slow = bends.filter((b) => b.radius < 150);
  expect(slow.length === 1 && track.sectionAt(slow[0].at * ds).id === 'carousel', `${slow.length} slow bends`);
  between(slow[0].radius, 50, 75, 'carousel radius (m)');
  expect(slow[0].dir < 0 && slow[0].count * ds >= 150, 'the carousel is not a long right-hander');
  for (const b of bends) {
    if (b === slow[0]) continue;
    const sec = track.sectionAt(b.at * ds).id;
    if (sec === 'tunnel') between(b.radius, 800, 1200, 'tunnel bend radius (m)');
    else between(b.radius, 180, 450, `radius of the bend at s = ${fmt(b.at * ds, 0)} m (${sec})`);
  }
  note(`${bends.length} bends; the carousel ${fmt(slow[0].radius, 0)} m`);
});

test('the tunnel: 300 to 400 m, lit, gently curved, no sky inside', () => {
  expect(track.tunnels.length === 1, `${track.tunnels.length} tunnels`);
  const t = track.tunnels[0];
  between(t.s1 - t.s0, 300, 400, 'tunnel length (m)');
  for (let s = t.s0 + 20; s < t.s1 - 20; s += 5) expect(track.sky[idx(s)] === 0, `sky inside the tunnel at s = ${fmt(s, 0)}`);
  for (const side of [1, -1]) {
    expect(Math.abs(track.edgeAt((t.s0 + t.s1) / 2, side) - (hw + TUNNEL.wallOffset)) < 0.01, 'tunnel walls not at their offset');
  }
  expect(track.sectionAt(t.s0 + 1).id === 'tunnel', 'the bore is not in the tunnel section');
});

test('on piers: two or more bridges, at least 600 m in all; the viaduct a long banked curve over the valley', () => {
  expect(track.bridges.length >= 2, `${track.bridges.length} bridges`);
  let total = 0;
  for (const b of track.bridges) {
    total += b.s1 - b.s0;
    expect(b.drop > 15 && typeof b.id === 'string', `bridge ${b.id} has no drop of its own`);
    for (const side of [1, -1]) {
      expect(Math.abs(track.edgeAt((b.s0 + b.s1) / 2, side) - (hw + VIADUCT.parapetOffset)) < 0.01, `parapet of ${b.id} not at its offset`);
    }
  }
  expect(total >= 600, `only ${fmt(total, 0)} m on piers`);
  const v = track.bridges.find((b) => b.id === 'viaduct');
  expect(v && track.sectionAt((v.s0 + v.s1) / 2).id === 'viaduct', 'no viaduct');
  const mid = idx((v.s0 + v.s1) / 2);
  expect(track.curvature[mid] > 0 && 1 / track.curvature[mid] < 400, 'the viaduct is not a long left-hander');
  expect(Math.abs(track.bank[mid]) > 8 * DEG, 'the viaduct is not banked');
  expect(v.drop >= 35, `the valley is only ${v.drop} m under the viaduct`);
  note(`on piers: ${track.bridges.map((b) => `${b.id} ${fmt(b.s1 - b.s0, 0)} m (drop ${b.drop} m)`).join(', ')}`);
});

// ---- the corridor -----------------------------------------------------------------------------------------------

test('solid edges: always beyond the shoulder, continuous lines (under 0.15 m per metre)', () => {
  for (const [name, edge] of [['left', track.edgeL], ['right', track.edgeR]]) {
    let least = Infinity;
    let most = 0;
    let rate = 0;
    for (let i = 0; i < n; i++) {
      least = Math.min(least, edge[i]);
      most = Math.max(most, edge[i]);
      rate = Math.max(rate, Math.abs(edge[(i + 1) % n] - edge[i]) / ds);
    }
    expect(least >= pave + 0.09, `${name} edge comes within ${fmt(least - hw)} m of the pavement`);
    expect(most <= hw + 12.001, `${name} edge is ${fmt(most - hw)} m out`);
    expect(rate <= 0.15, `${name} edge moves ${fmt(rate, 3)} m per metre`);
    note(`${name} edge ${fmt(least - hw, 2)} .. ${fmt(most - hw, 2)} m beyond the pavement, moving at most ${fmt(rate, 3)} m per metre`);
  }
});

test('each stretch has the roadside the design gives it', () => {
  const KIND = { rail: EDGE.RAIL, rock: EDGE.ROCK, wall: EDGE.WALL, parapet: EDGE.PARAPET, trees: EDGE.TREES };
  const VERGE = { asphalt: SURFACE.ASPHALT, grass: SURFACE.GRASS, gravel: SURFACE.GRAVEL };
  const list = Object.values(pieces);
  let checked = 0;
  for (let k = 0; k < list.length; k++) {
    const { seg, s0, s1 } = list[k];
    for (const side of ['L', 'R']) {
      const preset = LAYOUT.sides[seg[side]];
      const kind = side === 'L' ? track.kindL : track.kindR;
      const verge = side === 'L' ? track.vergeL : track.vergeR;
      const edge = side === 'L' ? track.edgeL : track.edgeR;
      for (const i of samplesOf(s0, s1)) {
        expect(kind[i] === KIND[preset.kind], `${seg.id} ${side}: kind ${kind[i]} at s = ${fmt(i * ds, 0)}`);
        expect(verge[i] === VERGE[preset.verge], `${seg.id} ${side}: verge ${verge[i]} at s = ${fmt(i * ds, 0)}`);
        expect(edge[i] - hw <= preset.edge[1] + 0.01, `${seg.id} ${side}: edge ${fmt(edge[i] - hw)} m out, s = ${fmt(i * ds, 0)}`);
      }
      // The edge is inside the preset's range once it has had room to move out from a narrower neighbour
      // (it may move 0.12 m per metre, and corners are rounded over a few metres).
      const room = (other) => Math.max(0, preset.edge[0] - LAYOUT.sides[other.seg[side]].edge[0]) / 0.12 + 10;
      const from = s0 + room(list[(k + list.length - 1) % list.length]);
      const to = s1 - room(list[(k + 1) % list.length]);
      if (to <= from) continue;
      for (const i of samplesOf(from, to)) {
        checked++;
        expect(edge[i] - hw >= preset.edge[0] - 0.01, `${seg.id} ${side}: edge only ${fmt(edge[i] - hw)} m out, s = ${fmt(i * ds, 0)}`);
      }
    }
  }
  expect(checked > 1.5 * n, `only ${checked} edge samples were far enough from a change to be checked`);
  // The numbers of the design, where they can be checked on a long stretch.
  const mid = (id) => idx((pieces[id].s0 + pieces[id].s1) / 2);
  between(track.edgeL[mid('grid')] - hw, 3, 10, 'verge to the wall on the lake side of the straight (m)');
  between(track.edgeR[mid('grid')] - hw, 3, 10, 'verge to the wall on the town side of the straight (m)');
  expect(track.kindL[mid('grid')] === EDGE.WALL && track.kindR[mid('grid')] === EDGE.WALL, 'the straight is not between low walls');
  between(track.edgeL[mid('ess1')] - hw, 7, 10, 'run-off on the outside of the first ess (m)');
  between(track.edgeL[mid('ledge1')] - hw, 3, 4, 'rock on the ledge (m)');
  // a circuit: grass, a barrier, and no tree as the barrier
  for (let i = 0; i < n; i++) expect(track.kindL[i] !== EDGE.TREES && track.kindR[i] !== EDGE.TREES, `trees as the barrier at s = ${fmt(i * ds, 0)}`);
});

test('rock rises behind its verge; no hillside steeper than 3 in 1', () => {
  for (const [kind, slope, far, name] of [
    [track.kindL, track.slopeL, track.farSlopeL, 'left'],
    [track.kindR, track.slopeR, track.farSlopeR, 'right'],
  ]) {
    for (let i = 0; i < n; i++) {
      // Leave out the few metres where the roadside changes and the slopes are blending.
      let settled = true;
      for (let d = -14; d <= 14 && settled; d++) if (kind[(i + d + n) % n] !== kind[i]) settled = false;
      if (!settled) continue;
      if (kind[i] === EDGE.ROCK) {
        expect(slope[i] > 0.1, `${name}: rock with a verge slope of ${fmt(slope[i])} at s = ${fmt(i * ds, 0)}`);
        expect(far[i] > -0.02, `${name}: the ground falls (${fmt(far[i])}) behind rock at s = ${fmt(i * ds, 0)}`);
      }
      expect(Math.abs(far[i]) <= 3.001, `${name}: far slope ${fmt(far[i])} at s = ${fmt(i * ds, 0)}`);
    }
  }
});

test('beside the carousel the ground between the climb and the crest is the same ground from either', () => {
  // From the climb, walk towards the crest until the point is as near to it as to the climb: the hillside each
  // stretch predicts for that point must be the same height.
  const other = [...inSection('crest'), ...inSection('plunge')];
  let worst = 0;
  let pairs = 0;
  for (const u of [0.1, 0.25, 0.4]) {
    const s = pieces.climb.s0 + pieces.climb.len * u;
    let tried = 0;
    for (const side of [1, -1]) {
      for (let d = 8; d < 80; d += 0.1) {
        const [x, z] = mapPoint(s, side * d);
        let near = -1;
        let best = d * d;
        for (const j of other) {
          const dist = (track.px[j] - x) ** 2 + (track.pz[j] - z) ** 2;
          if (dist < best) {
            best = dist;
            near = j;
          }
        }
        if (near < 0) continue;
        track.locate(x, z, near, where);
        const here = track.profile(s, side * d, prof).y;
        const there = track.profile(where.s, where.lat, ground).y;
        worst = Math.max(worst, Math.abs(here - there));
        pairs++;
        tried++;
        break;
      }
    }
    expect(tried === 1, `from s = ${fmt(s, 0)} the crest was found on ${tried} sides`);
  }
  expect(pairs === 3, `found the crest from only ${pairs} of 3 places`);
  // (terrain.js blends the two hillsides where they meet, so what is asked here is that they nearly agree)
  expect(worst < 5, `the two stretches disagree about the ground between them by ${fmt(worst, 2)} m`);
  note(`beside the carousel: ground between the legs agrees from both sides within ${fmt(worst, 2)} m`);
});

// ---- the questions the car asks ------------------------------------------------------------------------------------

test('locate() is the inverse of frameAt(): a few thousand points of the corridor, to within 2 cm', () => {
  const random = seeded(20260716);
  let worstS = 0;
  let worstLat = 0;
  for (let k = 0; k < 4000; k++) {
    const [s, lat] = randomSpot(random);
    const [x, z] = mapPoint(s, lat);
    // No hint, a good hint, a stale hint a little off, and a hint from somewhere else on the lap entirely.
    const hints = [-1, idx(s), idx(s + (random() - 0.5) * 30), Math.floor(random() * n)];
    for (const hint of hints) {
      track.locate(x, z, hint, where);
      worstS = Math.max(worstS, along(where.s, s));
      worstLat = Math.max(worstLat, Math.abs(where.lat - lat));
      expect(where.index === Math.floor(where.s / ds) % n, `index ${where.index} is not the sample before s = ${where.s}`);
    }
  }
  expect(worstS < 0.02, `s is off by up to ${fmt(worstS, 4)} m`);
  expect(worstLat < 0.02, `lat is off by up to ${fmt(worstLat, 4)} m`);
  note(`locate round trip over 4000 points x 4 hints: s within ${fmt(worstS * 1000, 3)} mm, lat within ${fmt(worstLat * 1000, 5)} mm`);
});

test('locate() picks the right leg everywhere round the carousel, from edge to edge, with no hint', () => {
  let wrong = 0;
  for (const i of [...inSection('carousel'), ...inSection('crest')]) {
    for (const lat of [-track.edgeR[i], -hw, 0, hw, track.edgeL[i]]) {
      const [x, z] = mapPoint(i * ds, lat);
      track.locate(x, z, -1, where);
      if (along(where.s, i * ds) > 0.02 || Math.abs(where.lat - lat) > 0.02) wrong++;
    }
  }
  expect(wrong === 0, `${wrong} points of the carousel's corridor were put on the wrong leg`);
});

test('surfaceAt() agrees with profile(), and its normal is the slope of its own heights', () => {
  const random = seeded(7);
  let worstY = 0;
  let worstNormal = 0;
  for (let k = 0; k < 3000; k++) {
    const [s, lat] = randomSpot(random);
    const [x, z] = mapPoint(s, lat);
    track.surfaceAt(x, z, -1, ground);
    track.profile(ground.s, ground.lat, prof);
    worstY = Math.max(worstY, Math.abs(ground.y - prof.y));
    expect(ground.surface === prof.surface, `surface ${ground.surface} against ${prof.surface} at s = ${fmt(s, 1)}, lat = ${fmt(lat, 2)}`);
    expect(ground.grip === GRIP[ground.surface], 'grip is not the surface kind\'s');
    expect(Math.abs(Math.hypot(ground.nx, ground.ny, ground.nz) - 1) < 1e-9 && ground.ny > 0.85, 'the normal is not a unit vector pointing up');
    const edgesOff = Math.abs(ground.edgeL - track.edgeAt(ground.s, 1)) + Math.abs(ground.edgeR - track.edgeAt(ground.s, -1));
    expect(edgesOff < 1e-6, 'edges are not those at s');
    expect(ground.sky >= 0 && ground.sky <= 1, 'sky out of range');
    // Away from the two creases of the cross-section, the normal must match the heights around the point.
    const a = Math.abs(ground.lat);
    const edge = ground.lat > 0 ? ground.edgeL : ground.edgeR;
    if (Math.abs(a - pave) < 0.2 || Math.abs(a - edge) < 0.2) continue;
    // (on a kerb the teeth are creases too, every half pitch, and the kerb's inner side is one)
    if (a > hw - 0.2 && a < pave + 0.2 && track.kerbAt(ground.s, Math.sign(ground.lat)) > 0) continue;
    const e = 0.05;
    const hx = (track.surfaceAt(x + e, z, ground.index, prof).y - track.surfaceAt(x - e, z, ground.index, prof).y) / (2 * e);
    const hz = (track.surfaceAt(x, z + e, ground.index, prof).y - track.surfaceAt(x, z - e, ground.index, prof).y) / (2 * e);
    const inv = 1 / Math.hypot(hx, 1, hz);
    worstNormal = Math.max(worstNormal, Math.hypot(ground.nx + hx * inv, ground.ny - inv, ground.nz + hz * inv));
  }
  expect(worstY < 1e-6, `surfaceAt and profile differ by ${fmt(worstY, 7)} m`);
  expect(worstNormal < 0.004, `the normal is ${fmt(worstNormal / DEG, 3)} degrees off the slope of the surface`);
  note(`surfaceAt: height equals profile exactly (${fmt(worstY * 1e9, 3)} nm), normal within ${fmt(worstNormal / DEG, 3)} degrees of the measured slope`);
});

test('past the solid edge surfaceAt() holds the height of the edge: no hillside for a wheel to climb or fall down', () => {
  const random = seeded(1234);
  let worst = 0;
  let step = 0;
  for (let k = 0; k < 2000; k++) {
    const s = random() * L;
    const side = random() < 0.5 ? 1 : -1;
    const edge = track.edgeAt(s, side);
    const past = 0.01 + random() * 3;
    const [x, z] = mapPoint(s, side * (edge + past));
    track.surfaceAt(x, z, -1, ground);
    if (along(ground.s, s) > 0.02) continue; // nearer to another stretch of the road: that is a different question
    expect(Math.abs(ground.lat - side * (edge + past)) < 0.02, 'lat past the edge is clamped');
    worst = Math.max(worst, Math.abs(ground.y - track.profile(s, side * edge, prof).y));
    expect(ground.surface === track.profile(s, side * (edge - 0.01), prof).surface, 'the surface past the edge is not the verge\'s');
    // Level across the road: the normal leans only as the road climbs.
    track.frameAt(s, frame);
    expect(Math.abs(ground.nx * frame.left.x + ground.nz * frame.left.z) < 1e-6, 'the ground past the edge is tilted across the road');
    // And stepping over the edge is not a step in height.
    const [x0, z0] = mapPoint(s, side * (edge - 0.005));
    const [x1, z1] = mapPoint(s, side * (edge + 0.005));
    step = Math.max(step, Math.abs(track.surfaceAt(x1, z1, -1, prof).y - track.surfaceAt(x0, z0, -1, ground).y));
  }
  expect(worst < 1e-6, `the height past the edge differs from the edge's by ${fmt(worst, 6)} m`);
  expect(step < 0.004, `a step of ${fmt(step * 1000, 2)} mm at the solid edge`);
});

test('the surface is continuous: across the road from edge to edge, and along it', () => {
  const random = seeded(99);
  let across = 0;
  let down = 0;
  for (let k = 0; k < 150; k++) {
    const s = random() * L;
    const from = -track.edgeAt(s, -1);
    const to = track.edgeAt(s, 1);
    let last = track.profile(s, from, prof).y;
    for (let lat = from + 0.02; lat <= to; lat += 0.02) {
      const y = track.profile(s, lat, prof).y;
      across = Math.max(across, Math.abs(y - last));
      last = y;
    }
    const lat = from + random() * (to - from);
    last = track.profile(s, lat, prof).y;
    for (let d = 0.05; d <= 6; d += 0.05) {
      const y = track.profile(s + d, lat, prof).y;
      down = Math.max(down, Math.abs(y - last));
      last = y;
    }
  }
  expect(across < 0.008, `a step of ${fmt(across * 1000, 1)} mm across the road in 2 cm`);
  expect(down < 0.012, `a step of ${fmt(down * 1000, 1)} mm along the road in 5 cm`);
  // The pavement is one banked plane, and the shoulder continues it.
  for (let k = 0; k < 200; k++) {
    const s = random() * L;
    track.frameAt(s, frame);
    const sin = Math.sin(frame.bank);
    for (const lat of [-hw, -1.5, 2, hw]) {
      expect(Math.abs(track.profile(s, lat, prof).y - (frame.pos.y + lat * sin)) < 2e-4, `the pavement is not a plane at s = ${fmt(s, 1)}, lat = ${lat}`);
    }
  }
});

test('no facets: at the fastest possible speed the pavement asks for the same gentle vertical acceleration at every scale', () => {
  // The height's second difference along a driven line, measured over a quarter of a metre and over a metre. If
  // the samples showed through (a kink in slope at each one), the short measure would be far larger than the long.
  // (the crest is left out of the absolute bound: it is meant to make the car light, and its own test says how light)
  const crest = [pieces.crest.s0, pieces.plunge.s0 + 0.3 * pieces.plunge.len];
  const worst = { 0.25: 0, 1: 0 };
  let worstOut = 0;
  for (const h of [0.25, 1]) {
    for (const lat of [-3.5, 0, 3.5]) {
      for (let k = 0; k < 4 * n; k++) {
        const s = (k * ds) / 4;
        const bend = (track.profile(s - h, lat, prof).y - 2 * track.profile(s, lat, prof).y + track.profile(s + h, lat, prof).y) / (h * h);
        const acc = (speed[Math.floor(k / 4) % n] ** 2 * Math.abs(bend)) / G;
        worst[h] = Math.max(worst[h], acc);
        if (h === 1 && bend < 0 && (s < crest[0] || s > crest[1])) worstOut = Math.max(worstOut, acc);
      }
    }
  }
  expect(worstOut < 0.8, `${fmt(worstOut, 2)} g of lift at the fastest possible speed (away from the crest; sags such as the compression push down)`);
  expect(worst[0.25] < worst[1] + 0.03, `the samples show through: ${fmt(worst[0.25], 2)} g over 0.25 m against ${fmt(worst[1], 2)} g over 1 m`);
  note(
    `vertical acceleration along the pavement at the fastest possible speed: at most ${fmt(worst[1], 2)} g ` +
      `(${fmt(worst[0.25], 2)} g measured over 0.25 m)`,
  );
});

test('what is underfoot: asphalt, then a kerb or a paved margin, then grass; paved to the wall in the tunnel and on the bridges', () => {
  expect(GRIP[SURFACE.ASPHALT] === 1 && GRIP.length === 5, 'GRIP is not indexed by SURFACE');
  between(GRIP[SURFACE.SHOULDER], 0.8, 0.9, 'grip of the paved margin');
  between(GRIP[SURFACE.KERB], 0.88, 0.92, 'grip of a kerb');
  between(GRIP[SURFACE.GRASS], 0.5, 0.6, 'grip of grass');
  const kindAt = (s, lat) => track.profile(s, lat, prof).surface;
  const open = [pieces.grid.s0 + 100, pieces.ess2.s0 + 40, pieces.ledge1.s0 + 100, pieces.climb.s0 + 40, pieces.back.s0 + 200];
  for (const s of open) {
    for (const side of [1, -1]) {
      expect(kindAt(s, 0) === SURFACE.ASPHALT && kindAt(s, side * (hw - 0.01)) === SURFACE.ASPHALT, `no asphalt at s = ${s}`);
      const kerb = track.kerbAt(s, side) > 0.5;
      const strip = kerb ? SURFACE.KERB : SURFACE.SHOULDER;
      expect(kindAt(s, side * (hw + 0.01)) === strip && kindAt(s, side * (pave - 0.01)) === strip, `no ${kerb ? 'kerb' : 'margin'} at s = ${s}`);
      const verge = (side > 0 ? track.vergeL : track.vergeR)[idx(s)];
      expect(verge === SURFACE.GRASS && kindAt(s, side * (pave + 0.05)) === verge, `the verge at s = ${s} is not grass`);
    }
  }
  for (const s of [(track.tunnels[0].s0 + track.tunnels[0].s1) / 2, ...track.bridges.map((b) => (b.s0 + b.s1) / 2)]) {
    for (const side of [1, -1]) {
      expect(kindAt(s, side * (hw + 0.3)) !== SURFACE.GRASS, `the margin is not paved at s = ${fmt(s, 0)}`);
      expect(kindAt(s, side * (track.edgeAt(s, side) - 0.01)) === SURFACE.ASPHALT, `not paved to the wall at s = ${fmt(s, 0)}`);
    }
  }
});

test('kerbs: inside every bend from entry to exit, outside at the exits of the faster ones; flush, rising 4 cm', () => {
  expect(track.kerbs.length >= 10, `${track.kerbs.length} kerbs`);
  for (const k of track.kerbs) {
    expect(k.width === SHOULDER && (k.side === 1 || k.side === -1), 'a kerb is not 1.2 m wide on one side');
    for (const d of [0, 0.5, 1]) expect(!track._onBridge(track.wrap(k.s0 + d * track.wrap(k.s1 - k.s0))), 'a kerb on a bridge');
  }
  // the inside of the middle of every arc of the layout tighter than the rule's radius
  for (const { seg, s0, s1 } of Object.values(pieces)) {
    if (!seg.r || Math.abs(seg.r) > LAYOUT.kerbs.inside || seg.bridge || seg.tunnel) continue;
    const side = seg.r > 0 ? 1 : -1;
    if (seg.kerb === false) {
      // a piece that asks for no inside kerb has none through its middle (a neighbour's exit kerb may reach its start)
      for (const u of [0.5, 0.9]) expect(track.kerbAt(s0 + (s1 - s0) * u, side) < 0.01, `a kerb inside ${seg.id} at ${u}, which asks for none`);
    } else for (const u of [0.1, 0.5, 0.9]) expect(track.kerbAt(s0 + (s1 - s0) * u, side) > 0.99, `no kerb inside ${seg.id} at ${u}`);
    if (Math.abs(seg.r) <= LAYOUT.kerbs.outside) expect(track.kerbAt(s1 - 5, -side) > 0.99, `no kerb outside the exit of ${seg.id}`);
  }
  const k = track.kerbs.find((it) => track.wrap(it.s1 - it.s0) > 60);
  const s = k.s0 + 30;
  const plane = (lat) => track.frameAt(s, frame).pos.y + lat * Math.sin(frame.bank);
  let top = 0;
  for (let u = 0; u < 1; u += 0.01) top = Math.max(top, track.profile(s + u, k.side * (pave - 0.001), prof).y - plane(k.side * (pave - 0.001)));
  between(top, 0.035, 0.041, 'kerb height at its outer side (m)');
  expect(Math.abs(track.profile(s, k.side * (hw + 0.001), prof).y - plane(k.side * (hw + 0.001))) < 0.001, 'the kerb is not flush with the road');
  track.surfaceAt(...mapPoint(s, k.side * (hw + 0.6)), -1, ground);
  expect(ground.surface === SURFACE.KERB, 'surfaceAt() does not report the kerb');
  note(`${track.kerbs.length} kerbs, ${fmt(track.kerbs.reduce((sum, it) => sum + track.wrap(it.s1 - it.s0), 0), 0)} m in all`);
});

test('a circuit: woods behind the barrier, tyre walls, boards, distance boards, marshals, the gantry', () => {
  const woods = new Set();
  for (let s = 0; s < L; s += 10) for (const side of [1, -1]) woods.add(track.woodAt(s, side));
  for (const w of ['broadleaf', 'conifer', 'mixed', null]) expect(woods.has(w), `no ${w} anywhere`);
  for (const b of track.bridges) expect(track.woodAt((b.s0 + b.s1) / 2, 1) === null, 'trees on a bridge');
  expect(track.woodAt(100, 1) === null, 'trees on the lake side of the straight');
  expect(track.woodAt(pieces.sweep.s0 + 50, -1) === 'broadleaf', 'no broadleaf wood low down');
  expect(track.woodAt(pieces.ess3.s0 + 50, 1) === 'conifer', 'no conifers higher up');
  for (const t of track.tyreWalls) expect(Math.abs(t.lat) < track.edgeAt(t.s0, t.side) && Math.abs(t.lat) > pave, 'a tyre wall not in front of the barrier');
  expect(track.tyreWalls.length >= 4 && track.boards.length >= 4, 'too few tyre walls or boards');
  expect(track.distanceBoards.map((d) => d.label).join() === '300,200,100', 'distance boards are not 300, 200, 100');
  const carousel = pieces.carousel.s0;
  for (const d of track.distanceBoards) between(track.delta(d.s, carousel), Number(d.label) - 1, Number(d.label) + 40, `distance board ${d.label}`);
  expect(track.marshals.length >= 8, `${track.marshals.length} marshal posts`);
  // (a little beyond the line: the lamps hang where the grid can see them)
  expect(track.gantry.s > 0 && track.gantry.s <= 15 && track.gantry.latL > hw && track.gantry.latR < -hw, 'the gantry does not span the road just beyond the line');
});

test('frameAt() matches the samples, wraps, and has no seam at the line', () => {
  for (const i of [0, 1, idx(700), idx(1500), n - 1]) {
    track.frameAt(i * ds, frame);
    expect(Math.hypot(frame.pos.x - track.px[i], frame.pos.y - track.py[i], frame.pos.z - track.pz[i]) < 1e-4, `frameAt misses sample ${i}`);
    expect(Math.hypot(frame.tan.x - track.tx[i], frame.tan.y - track.ty[i], frame.tan.z - track.tz[i]) < 1e-5, `tangent differs at sample ${i}`);
    expect(Math.hypot(frame.left.x - track.lx[i], frame.left.y - track.ly[i], frame.left.z - track.lz[i]) < 1e-5, `left differs at sample ${i}`);
    expect(Math.hypot(frame.up.x - track.nx[i], frame.up.y - track.ny[i], frame.up.z - track.nz[i]) < 1e-5, `up differs at sample ${i}`);
    const numbersOff = Math.abs(frame.curvature - track.curvature[i]) + Math.abs(frame.grade - track.grade[i]);
    expect(numbersOff < 1e-6, `numbers differ at sample ${i}`);
  }
  const a = track.frameAt(123.4, {});
  const b = track.frameAt(123.4 + L, {});
  const c = track.frameAt(123.4 - 2 * L, {});
  expect(a.pos.distanceTo(b.pos) < 1e-6 && a.pos.distanceTo(c.pos) < 1e-6, 'frameAt does not wrap');
  const before = track.frameAt(-1e-4, {});
  const after = track.frameAt(1e-4, {});
  expect(before.pos.distanceTo(after.pos) < 3e-4, `a step of ${fmt(before.pos.distanceTo(after.pos), 5)} m at the line`);
  expect(before.tan.distanceTo(after.tan) < 1e-5 && before.left.distanceTo(after.left) < 1e-5, 'the frame turns at the line');
  // Between samples the cubic stays on the true curve: its speed is one metre per metre, its direction turns
  // at the curvature.
  const random = seeded(3);
  let stretch = 0;
  for (let k = 0; k < 2000; k++) {
    const s = random() * L;
    const p0 = track.frameAt(s, {}).pos;
    const p1 = track.frameAt(s + 0.01, {}).pos;
    stretch = Math.max(stretch, Math.abs(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.01 - 1));
  }
  expect(stretch < 1e-3, `the centre line is stretched by ${fmt(stretch * 100, 3)} % between samples`);
  expect(track.wrap(-1) === L - 1 && track.wrap(L + 2) === 2 && track.delta(L - 5, 5) === 10 && track.delta(5, L - 5) === -10, 'wrap/delta');
});

test('a car at 80 m/s with a hint never loses the road, across the line included, and never searches the lap', () => {
  const globalSearch = track._nearestSample;
  let searches = 0;
  track._nearestSample = function counted(x, z) {
    searches++;
    return globalSearch.call(this, x, z);
  };
  try {
    for (const run of [{ sway: 3, name: 'on the pavement' }, { sway: null, name: 'along the solid edges' }]) {
      const step = 80 / 120;
      let s = L - 310.123;
      let hint = idx(s);
      let worst = 0;
      let worstLat = 0;
      const total = Math.ceil((1.25 * L) / step);
      track.locate(...mapPoint(s, 0), -1, where);
      hint = where.index;
      const before = searches;
      for (let k = 0; k < total; k++) {
        s += step;
        const side = Math.sin(s / 61) > 0 ? 1 : -1;
        const lat = run.sway === null ? side * (track.edgeAt(s, side) - 0.05) * Math.abs(Math.sin(s / 61)) ** 0.2 : run.sway * Math.sin(s / 37);
        const [x, z] = mapPoint(s, lat);
        track.surfaceAt(x, z, hint, ground);
        hint = ground.index;
        worst = Math.max(worst, along(ground.s, s));
        worstLat = Math.max(worstLat, Math.abs(ground.lat - lat));
      }
      expect(worst < 0.02 && worstLat < 0.02, `${run.name}: lost the road (s off by ${fmt(worst, 3)} m, lat by ${fmt(worstLat, 3)} m)`);
      expect(searches === before, `${run.name}: ${searches - before} global searches in ${total} steps`);
    }
    // Put somewhere else with a stale hint (a reset): one global search finds it.
    const before = searches;
    const [x, z] = mapPoint(pieces.crest.s0 + 60, 1);
    track.locate(x, z, idx(pieces.climb.s0 + 60), where);
    expect(along(where.s, pieces.crest.s0 + 60) < 0.02, 'a car moved to the next leg with a stale hint was left on the old one');
    expect(searches > before, 'a far move did not look further than the hint');
  } finally {
    track._nearestSample = globalSearch;
  }
});

test('far from the road and inside bends, locate() still answers sensibly', () => {
  const random = seeded(42);
  const b = track.bounds;
  for (let k = 0; k < 500; k++) {
    const x = b.minX - 200 + random() * (b.maxX - b.minX + 400);
    const z = b.minZ - 200 + random() * (b.maxZ - b.minZ + 400);
    track.surfaceAt(x, z, k % 2 ? -1 : Math.floor(random() * n), ground);
    const finite = Number.isFinite(ground.s + ground.lat + ground.y + ground.nx + ground.ny + ground.nz);
    expect(finite, `not finite at ${fmt(x, 0)}, ${fmt(z, 0)}`);
    expect(ground.s >= 0 && ground.s < L, `s = ${ground.s}`);
    // Nothing on the centre line is nearer than the answer claims (to the sample spacing).
    let nearest = Infinity;
    for (let i = 0; i < n; i += 1) nearest = Math.min(nearest, (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2);
    const p = mapPoint(ground.s, 0);
    expect(Math.hypot(p[0] - x, p[1] - z) <= Math.sqrt(nearest) + 0.6, `a nearer part of the road was missed at ${fmt(x, 0)}, ${fmt(z, 0)}`);
  }
});

// ---- furniture, lines, the grid -------------------------------------------------------------------------------------

test('lamps: street lamps along the straight, floodlights round the lap, rows in the tunnel', () => {
  const street = track.lamps.filter((lamp) => lamp.kind === 'street').sort((a, b) => track.delta(0, a.s) - track.delta(0, b.s));
  const hung = track.lamps.filter((lamp) => lamp.kind === 'tunnel');
  const lap = track.lamps.filter((lamp) => lamp.kind === 'lap').sort((a, b) => a.s - b.s);
  expect(street.length >= 20 && street.length + lap.length + hung.length === track.lamps.length, `${street.length} street lamps`);
  expect(lap.length >= 50, `${lap.length} floodlights round the lap`);
  for (let k = 0; k < lap.length; k++) {
    const lamp = lap[k];
    expect(track.sectionAt(lamp.s).id !== 'straight' || street.every((l) => Math.abs(track.delta(l.s, lamp.s)) > 20), `a floodlight at s = ${fmt(lamp.s, 0)} stands among the street lamps`);
    expect(!track.tunnels.some((t) => lamp.s > t.s0 - 20 && lamp.s < t.s1 + 20), `a floodlight at s = ${fmt(lamp.s, 0)} is in or at a tunnel`);
    // at the solid edge, or set back behind a rail or among trees (layout.lapLamps.setback)
    const kind = (lamp.side > 0 ? track.kindL : track.kindR)[Math.round(lamp.s / track.ds) % track.count];
    const back = kind === EDGE.RAIL || kind === EDGE.TREES ? track.layout.lapLamps.setback : 0;
    const atEdge = Math.abs(Math.abs(lamp.lat) - track.edgeAt(lamp.s, lamp.side) - back) < 1e-6 && Math.sign(lamp.lat) === lamp.side;
    expect(atEdge, `a floodlight is not at the solid edge or ${back} m behind it`);
    expect(back === 0 || back >= 2, 'a floodlight set back less than 2 m');
    if (k > 0) expect(lamp.s - lap[k - 1].s > 45, `floodlights ${fmt(lamp.s - lap[k - 1].s, 0)} m apart`);
  }
  for (let k = 0; k < street.length; k++) {
    const lamp = street[k];
    expect(track.sectionAt(lamp.s).id === 'straight', `a street lamp at s = ${fmt(lamp.s, 0)} is not on the straight`);
    expect(lamp.height === 9, `a street lamp ${lamp.height} m high`);
    const atEdge = Math.abs(Math.abs(lamp.lat) - track.edgeAt(lamp.s, lamp.side)) < 1e-6 && Math.sign(lamp.lat) === lamp.side;
    expect(atEdge, 'a street lamp is not at the solid edge');
    if (k > 0) {
      between(track.delta(street[k - 1].s, lamp.s), 25, 35, 'spacing of street lamps (m)');
      expect(lamp.side === -street[k - 1].side, 'street lamps do not alternate sides');
    }
  }
  const { s0, s1 } = track.tunnels[0];
  const left = hung.filter((lamp) => lamp.side > 0).sort((a, b) => a.s - b.s);
  const right = hung.filter((lamp) => lamp.side < 0).sort((a, b) => a.s - b.s);
  expect(left.length === right.length && left.length >= 18, `${left.length} and ${right.length} tunnel lamps`);
  for (let k = 0; k < left.length; k++) {
    expect(left[k].s === right[k].s && left[k].s > s0 && left[k].s < s1, 'tunnel lamps are not in pairs inside the bore');
    expect(left[k].height < TUNNEL.height && left[k].height > TUNNEL.height - 1, 'tunnel lamps are not near the ceiling');
    expect(Math.abs(left[k].lat) < hw + TUNNEL.wallOffset && Math.abs(left[k].lat) > hw, 'tunnel lamps are not at the walls');
    if (k > 0) between(left[k].s - left[k - 1].s, 11, 13, 'spacing of tunnel lamp rows (m)');
  }
  note(
    `${street.length} street lamps every ${fmt(track.delta(street[0].s, street[1].s), 1)} m; ` +
      `${left.length} rows of tunnel lamps every ${fmt(left[1].s - left[0].s, 1)} m`,
  );
});

test('sector lines near one third and two thirds, in the open and on the ground', () => {
  expect(track.sectors.length === 2, `${track.sectors.length} sector lines`);
  between(track.sectors[0] / L, 0.3, 0.4, 'first sector line (share of the lap)');
  between(track.sectors[1] / L, 0.6, 0.72, 'second sector line (share of the lap)');
  for (const s of track.sectors) expect(track.sky[idx(s)] === 1 && !track._onBridge(s), `a sector line at s = ${fmt(s, 0)} is not in the open`);
  note(`sector lines at s = ${fmt(track.sectors[0], 1)} m (${fmt((track.sectors[0] / L) * 100, 0)} %) and ${fmt(track.sectors[1], 1)} m (${fmt((track.sectors[1] / L) * 100, 0)} %)`);
});

test('the grid: two abreast, staggered behind the line, on the road, facing down it', () => {
  const want = [
    [6, 2.6],
    [14, -2.6],
    [22, 2.6],
    [30, -2.6],
  ];
  for (let slot = 0; slot < 4; slot++) {
    const g = track.grid(slot, {});
    track.surfaceAt(g.x, g.z, -1, ground);
    expect(Math.abs(track.delta(ground.s, 0) - want[slot][0]) < 0.01, `slot ${slot} is ${fmt(track.delta(ground.s, 0))} m behind the line`);
    expect(Math.abs(ground.lat - want[slot][1]) < 0.01, `slot ${slot} is at lat ${fmt(ground.lat)}`);
    expect(Math.abs(g.y - ground.y) < 1e-6 && ground.surface === SURFACE.ASPHALT, `slot ${slot} is not on the road`);
    track.frameAt(ground.s, frame);
    const facing = Math.abs(Math.sin(g.yaw) - frame.tan.x) < 1e-4 && Math.abs(Math.cos(g.yaw) - frame.tan.z) < 1e-4;
    expect(facing, `slot ${slot} does not face down the road`);
  }
  const g = track.grid(0);
  expect(typeof g.x === 'number' && typeof g.yaw === 'number', 'grid() without an out object');
});

test('toTopDown() and pointAt()', () => {
  const full = track.toTopDown(1, 1);
  expect(full.length === 2 * n && full[0] === track.px[0] && full[1] === track.pz[0], 'toTopDown(1, 1) is not the samples');
  const map = track.toTopDown(0.1);
  expect(map instanceof Float32Array && map.length === 2 * Math.ceil(n / 4), `toTopDown(0.1) has ${map.length} numbers`);
  expect(Math.abs(map[2] - track.px[4] * 0.1) < 1e-6 && Math.abs(map[3] - track.pz[4] * 0.1) < 1e-6, 'toTopDown does not scale');
  const random = seeded(11);
  for (let k = 0; k < 300; k++) {
    const [s, lat] = randomSpot(random);
    const p = track.pointAt(s, lat);
    const [x, z] = mapPoint(s, lat);
    expect(Math.hypot(p.x - x, p.z - z) < 1e-5, 'pointAt is not pos + lat * left on the map');
    expect(Math.abs(p.y - track.profile(s, lat, prof).y) < 1e-6, 'pointAt is not on the surface');
  }
});

// ---- how long the questions take (for the record, not asserted) ---------------------------------------------------

{
  const random = seeded(5);
  const points = [];
  let s = 0;
  for (let k = 0; k < 200000; k++) {
    s = (s + 0.6) % L;
    points.push(...mapPoint(s, (random() - 0.5) * 6));
  }
  let hint = 0;
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < points.length; k += 2) hint = track.surfaceAt(points[k], points[k + 1], hint, ground).index;
  const ns = Number(process.hrtime.bigint() - t0) / (points.length / 2);
  const t1 = process.hrtime.bigint();
  for (let k = 0; k < 20; k++) createTrack();
  note(`surfaceAt with a hint: ${fmt(ns, 0)} ns a call; building the track: ${fmt(Number(process.hrtime.bigint() - t1) / 20e6, 0)} ms`);
}

console.log('');
for (const line of notes) console.log(`  ${line}`);
console.log(`\n${failures === 0 ? 'track: all good' : `track: ${failures} FAILURES`} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
