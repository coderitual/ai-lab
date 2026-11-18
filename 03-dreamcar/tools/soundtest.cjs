// Dev tool: check the sound without ears.
//
//   node tools/soundtest.cjs http://localhost:5190/ [outDir]
//
// Without a URL it takes $DEV_URL, or http://localhost:5190/ (vite.config.js's dev port: npm run dev).
//
// The dev server's sound bench (sound.html) renders scenarios on an OfflineAudioContext with the game's own audio
// code (engine/Audio.js, game/Sound.js); this script hands it scenarios, takes the samples back and measures
// them: which partials are there and how strong, levels, sides, tails, jumps. Each claim the sound makes about
// itself is one line of the table: PASS or FAIL, and the numbers it was judged by. Along the way it prints what
// each scenario sounds like to a spectrum analyser.
//
// What it cannot tell is whether any of it sounds *good*: nobody has listened. With outDir the scenarios are
// kept as WAV files, so that somebody can.
//
// Requires Playwright to be available to Node (it is not a project dependency), and the DEV server: the bench
// is not part of the build.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const lab = require('./soundlab.cjs');

const { dB } = lab;
const arg = process.argv[2] || process.env.DEV_URL || 'http://localhost:5190/';
const url = arg.endsWith('.html') ? arg : arg.replace(/\/?$/, '/') + 'sound.html';
const outDir = process.argv[3] || '';
if (outDir) fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
let checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (name) => console.log(`\n— ${name} —`);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f0 = (v) => (Number.isFinite(v) ? v.toFixed(0) : String(v));

// ---- what a car is doing, as the sound is told it (CarSound in game/Sound.js)
const still = (o = {}) => ({ rpm: 750, throttle: 0, speed: 0, gear: 1, skid: 0, surface: 0, scrape: 0, pan: 0, sky: 1, ...o });
const cruise = (o = {}) => still({ rpm: 1900, throttle: 0.22, speed: 27.8, gear: 6, ...o });
/** Key frames that hold each state in turn for `seconds`, moving on in `ramp`. */
const stairs = (states, seconds, ramp = 0.05) => {
  const keys = [];
  states.forEach((state, i) => keys.push([i * seconds + (i ? ramp : 0), state], [(i + 1) * seconds, state]));
  return keys;
};
/** The stretch of step `i` that is past its settling. */
const step = (i, seconds, settle = 0.6) => [i * seconds + settle, (i + 1) * seconds - 0.03];

/** What a spectrum analyser would say about a stretch of sound. */
function describe(sig, rate, t0, t1) {
  const spec = lab.spectrum(sig, rate, t0, t1);
  const total = lab.band(spec, 15, 24000);
  const rel = (lo, hi) => dB(lab.band(spec, lo, hi)) - dB(total);
  return {
    spec,
    rms: dB(lab.rms(sig, rate, t0, t1)),
    peak: dB(lab.peak(sig, rate, t0, t1)),
    centroid: lab.centroid(spec),
    bands: [rel(15, 150), rel(150, 500), rel(500, 1500), rel(1500, 4000), rel(4000, 8000), rel(8000, 24000)],
    partials: lab.partials(spec, { f0: 15, f1: 12000, count: 7, floor: 1e-6 }),
  };
}

function report(label, d) {
  console.log(`  ${label.padEnd(30)} rms ${f1(d.rms).padStart(6)} dBFS  peak ${f1(d.peak).padStart(6)}  centre ${f0(d.centroid).padStart(5)} Hz`
    + `  | <150 Hz ${f0(d.bands[0])}, -500 ${f0(d.bands[1])}, -1.5k ${f0(d.bands[2])}, -4k ${f0(d.bands[3])}, -8k ${f0(d.bands[4])}, above ${f0(d.bands[5])} dB`);
  console.log(`  ${''.padEnd(30)} partials  ${d.partials.map((p) => `${f0(p.f)} Hz ${f0(dB(p.a))}`).join(' · ')}`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
  const problems = [];
  const watch = (page, label) => {
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${label}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  };
  const open = async (label, { query = '', init = '' } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    watch(page, label);
    await page.goto(url + query, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
    return page;
  };

  const page = await open('bench');

  /** Render a scenario (a name, or data) in the page; samples come back as Float32Arrays. */
  const render = async (what, options = {}, onPage = page) => {
    const r = await onPage.evaluate(([w, o]) => window.__sound.render(w, o), [what, options]);
    r.left = lab.decode(r.left);
    r.right = lab.decode(r.right);
    r.mono = new Float32Array(r.left.length);
    for (let i = 0; i < r.mono.length; i++) r.mono[i] = 0.5 * (r.left[i] + r.right[i]);
    r.impulse = { rate: r.impulse.rate, left: lab.decode(r.impulse.left), right: lab.decode(r.impulse.right) };
    return r;
  };
  const keep = (name, r) => {
    if (outDir) lab.writeWav(path.join(outDir, `sound_${name}.wav`), r.left, r.right, r.rate);
  };
  const everything = [];
  const remember = (name, r) => {
    everything.push({ name, r });
    keep(name, r);
    return r;
  };

  // =========================================================================================== the engine
  section('the engine, standing: what it is made of');
  const RPMS = [800, 1000, 1300, 1700, 2200, 2800, 3500, 4300, 5200, 6000, 6500];
  const CELL = 1.5;
  const sweeps = {};
  for (const throttle of [0, 0.25, 1]) {
    const r = await render({ duration: RPMS.length * CELL, cars: [{ keys: stairs(RPMS.map((rpm) => still({ rpm, throttle })), CELL) }] });
    sweeps[throttle] = remember(`engine_throttle_${throttle}`, r);
  }
  const tracking = [];
  for (const throttle of [0, 0.25, 1]) {
    const r = sweeps[throttle];
    RPMS.forEach((rpm, i) => {
      const [t0, t1] = step(i, CELL);
      const d = describe(r.mono, r.rate, t0, t1);
      const low = lab.partials(d.spec, { f0: 15, f1: 600, count: 1 })[0];
      tracking.push({ rpm, throttle, f: low ? low.f : 0, want: rpm / 30, d });
      if (throttle !== 0.25 && [0, 2, 4, 6, 8, 10].includes(i)) report(`${rpm} rpm, throttle ${throttle}`, d);
    });
  }
  const worstTrack = tracking.reduce((w, x) => (Math.abs(x.f / x.want - 1) > Math.abs(w.f / w.want - 1) ? x : w));
  check('engine: the strongest low partial is the firing frequency, rpm / 30 Hz, at every speed and load', tracking.every((x) => Math.abs(x.f / x.want - 1) < 0.03),
    `${tracking.length} states from ${RPMS[0]} to ${RPMS[RPMS.length - 1]} rpm; furthest off ${f1((worstTrack.f / worstTrack.want - 1) * 100)} % (${f1(worstTrack.f)} Hz for ${f1(worstTrack.want)} at ${worstTrack.rpm} rpm, throttle ${worstTrack.throttle})`);

  const at = (throttle, rpm) => tracking.find((x) => x.throttle === throttle && x.rpm === rpm).d;
  {
    const rise = RPMS.map((rpm) => at(1, rpm).rms - at(0, rpm).rms);
    const mid = RPMS.map((rpm) => at(0.25, rpm).rms - at(0, rpm).rms);
    check('engine: louder with the throttle at every speed, by a sensible amount', rise.every((x, i) => x > 4 && x < 13 && mid[i] > 0.5 && mid[i] < x),
      `closed to wide open: +${f1(Math.min(...rise))} to +${f1(Math.max(...rise))} dB; a quarter throttle: +${f1(Math.min(...mid))} to +${f1(Math.max(...mid))} dB`);
    const levels = RPMS.map((rpm) => at(1, rpm).rms);
    const from = RPMS.indexOf(1700);
    let rising = true;
    for (let i = from + 1; i < RPMS.length; i++) if (levels[i] < levels[i - 1] - 0.3) rising = false;
    const gain = levels[RPMS.length - 1] - levels[from];
    check('engine: louder with revs, by a sensible amount', rising && gain > 3 && gain < 12 && at(0, 800).rms < at(1, 6500).rms - 10,
      `wide open ${RPMS.map((rpm, i) => `${rpm}: ${f1(levels[i])}`).join(', ')} dBFS; idle ${f1(at(0, 800).rms)} dBFS`);
  }
  {
    // the edge: how much of the sound is between 500 Hz and 3 kHz
    const edge = (d) => dB(lab.band(d.spec, 500, 3000)) - dB(lab.band(d.spec, 15, 24000));
    const rows = [2200, 3500, 5200].map((rpm) => ({ rpm, closed: edge(at(0, rpm)), open: edge(at(1, rpm)), c0: at(0, rpm).centroid, c1: at(1, rpm).centroid }));
    check('engine: smooth on a trailing throttle, harder-edged under load', rows.every((x) => x.open - x.closed > 5 && x.c1 > x.c0 * 1.2),
      rows.map((x) => `${x.rpm} rpm: 0.5-3 kHz is ${f1(x.closed)} dB of the sound closed, ${f1(x.open)} dB open; centre ${f0(x.c0)} -> ${f0(x.c1)} Hz`).join(' | '));
  }
  {
    // a fixed wave played faster would keep the same balance of harmonics at every speed; an engine does not
    const r = sweeps[1];
    const rows = RPMS.map((rpm, i) => {
      const [t0, t1] = step(i, CELL);
      const h = [1, 2, 3, 4, 6].map((k) => dB(lab.tone(r.mono, r.rate, t0, t1, (k * rpm) / 30)));
      return { rpm, h2: h[1] - h[0], h3: h[2] - h[0], h4: h[3] - h[0], h6: h[4] - h[0], order: at(1, rpm).centroid / (rpm / 30) };
    });
    const spread = (key) => Math.max(...rows.map((x) => x[key])) - Math.min(...rows.map((x) => x[key]));
    console.log('  harmonics against the first, wide open:  ' + rows.map((x) => `${x.rpm}: ${f0(x.h2)}/${f0(x.h3)}/${f0(x.h4)}/${f0(x.h6)}`).join('  '));
    // the note spans only a few semitones in each gear, so brightness has to climb faster than pitch (design A3):
    // from the middle of the range to the top the sound's centre, counted in harmonics, must go up, not down
    const mid = rows.find((x) => x.rpm === 2200);
    const topRow = rows[rows.length - 1];
    check('engine: the timbre changes across the rev range, and brightness climbs faster than the pitch',
      spread('h2') > 2.5 && spread('h4') > 4 && topRow.order >= mid.order,
      `2nd harmonic moves ${f1(spread('h2'))} dB against the 1st, the 4th ${f1(spread('h4'))} dB, the 6th ${f1(spread('h6'))} dB; the sound's centre is at harmonic ${f1(mid.order)} at ${mid.rpm} rpm and ${f1(topRow.order)} at ${topRow.rpm}`);
    const first = rows.filter((x) => x.rpm >= 1300);
    check('engine: a deep note, not a buzz: the firing frequency leads, the next harmonics follow within 14 dB', first.every((x) => x.h2 < -2 && x.h2 > -14 && x.h3 > -20),
      `from 1300 rpm the 2nd is ${f0(Math.min(...first.map((x) => x.h2)))} to ${f0(Math.max(...first.map((x) => x.h2)))} dB, the 3rd ${f0(Math.min(...first.map((x) => x.h3)))} to ${f0(Math.max(...first.map((x) => x.h3)))} dB`);
  }

  // ---- band limits: the tone alone, as a perfect machine, at speeds where a folded partial could not hide
  section('the engine: nothing aliases');
  {
    const rate = 48000;
    // a partial folded at the top of the band lands at rate - k f; make sure that is never on the engine's own grid
    const offGrid = (rpm) => {
      let r = rpm;
      for (;;) {
        const frac = (rate / (r / 120)) % 1;
        if (frac > 0.3 && frac < 0.7) return r;
        r += 1;
      }
    };
    const speeds = [2500, 4000, 5500, 6500].map(offGrid);
    const tonal = { breath: 0, whistle: 0, wind: 0, road: 0, wobble: 0 };
    const a = await render({ duration: speeds.length * CELL, cars: [{ keys: stairs(speeds.map((rpm) => still({ rpm, throttle: 1 })), CELL) }] }, { mix: tonal });
    const b = await render({ duration: speeds.length * CELL, cars: [{ keys: stairs(speeds.map((rpm) => still({ rpm: rpm * 1.02, throttle: 1 })), CELL) }] }, { mix: tonal });
    const STRAY_DB = 80;
    let strayTop = -Infinity;
    let strays = 0;
    let falling = 0;
    let counted = 0;
    let top = 0;
    let worst = '';
    let above = -Infinity;
    speeds.forEach((rpm, i) => {
      const [t0, t1] = step(i, CELL, 0.7);
      // a Hann window's own side lobes reach -72 dB within a dozen bins of a strong partial: look with one that does not
      const sa = lab.spectrum(a.mono, rate, t0, t1, 2, 'bh');
      const sb = lab.spectrum(b.mono, rate, t0, t1, 2, 'bh');
      const pa = lab.partials(sa, { f0: 15, f1: 23900, count: 400, floor: 0 });
      const pb = lab.partials(sb, { f0: 15, f1: 23900, count: 400, floor: 0 });
      const floor = pa[0].a * 10 ** (-80 / 20);
      const loudFloor = pa[0].a * 10 ** (-STRAY_DB / 20);
      const grid = rpm / 120;
      for (const p of pa) {
        if (p.a < floor) break;
        counted++;
        top = Math.max(top, p.f);
        const off = Math.abs(p.f / grid - Math.round(p.f / grid)) * grid;
        if (off > 1 + 0.001 * p.f) {
          strayTop = Math.max(strayTop, dB(p.a / pa[0].a));
          if (process.env.STRAYS && dB(p.a / pa[0].a) > -72) console.log(`    stray ${f1(p.f)} Hz at ${rpm} rpm (grid ${f1(grid)}): ${f0(dB(p.a / pa[0].a))} dB`);
          if (p.a < loudFloor) continue;
          strays++;
          worst = `${f1(p.f)} Hz at ${rpm} rpm (${f0(dB(p.a / pa[0].a))} dB)`;
        }
        // the same partial at 2 % more revs must be 2 % higher: one that falls, or stays, is a folded one
        if (p.a >= loudFloor && !pb.some((q) => Math.abs(q.f / p.f - 1.02) < 0.002 + 1 / p.f && q.a > p.a * 0.3)) falling++;
      }
      above = Math.max(above, dB(lab.band(sa, 12000, 24000)) - dB(lab.band(sa, 15, 24000)));
    });
    check(`engine: every partial down to -${STRAY_DB} dB is a multiple of a quarter of the firing frequency`, strays === 0 && counted > 60,
      `${counted} partials down to -80 dB at ${speeds.join(', ')} rpm wide open, the highest at ${f0(top)} Hz; ${strays} off the grid above -${STRAY_DB} dB${worst ? ', e.g. ' + worst : ''}; the strongest off the grid at all ${f0(strayTop)} dB`);
    check('engine: every partial rises when the revs rise (none is folded back from the top of the band)', falling === 0, `${falling} of those above -${STRAY_DB} dB did not`);
    check('engine: the tone itself has nothing above 12 kHz', above < -80, `${f0(above)} dB of it at most`);
  }

  // =========================================================================================== on the road
  section('on the road');
  const SPEEDS = [0, 15, 30, 45, 60];
  {
    const r = remember('speed', await render({ duration: SPEEDS.length * CELL, cars: [{ keys: stairs(SPEEDS.map((speed) => cruise({ speed })), CELL, 0.3) }] }));
    const rows = SPEEDS.map((speed, i) => {
      const [t0, t1] = step(i, CELL, 0.8);
      const d = describe(r.mono, r.rate, t0, t1);
      if (speed === 30) report('cruise, 1900 rpm, 108 km/h', d);
      // away from the engine's own partials: the road low down, the wind above
      return { speed, road: dB(lab.band(d.spec, 200, 420)), wind: dB(lab.band(d.spec, 900, 3000)), d };
    });
    let rising = true;
    for (let i = 1; i < rows.length; i++) if (rows[i].wind < rows[i - 1].wind + 2) rising = false;
    for (let i = 2; i < rows.length; i++) if (rows[i].road < rows[i - 1].road + 1) rising = false;
    check('road roar and wind rise with speed', rising,
      rows.map((x) => `${f0(x.speed * 3.6)} km/h: 200-420 Hz ${f0(x.road)}, 0.9-3 kHz ${f0(x.wind)} dBFS`).join(' | '));
    const c = rows[2].d;
    const below = dB(lab.band(c.spec, 15, 1500)) - dB(lab.band(c.spec, 15, 24000));
    const upper = dB(lab.band(c.spec, 1500, 24000)) - dB(lab.band(c.spec, 15, 24000));
    check('cruise: the sound is mostly below 1.5 kHz', upper < -15, `what is above 1.5 kHz is ${f1(upper)} dB of the whole (below: ${below.toFixed(2)} dB)`);
    check('cruise: little above 8 kHz', c.bands[5] < -40, `${f1(c.bands[5])} dB of the whole; at 216 km/h ${f1(rows[4].d.bands[5])} dB`);
    check('cruise: refined: a level well under full load', c.rms < -22 && c.rms > -36, `${f1(c.rms)} dBFS rms at 108 km/h`);
  }

  // ---- tyres
  {
    const SKID = 1.6;
    const states = [cruise({ speed: 25 }), cruise({ speed: 25, skid: 0.1, slipLat: 1 }), cruise({ speed: 25, skid: 0.25, slipLat: 1 }),
      cruise({ speed: 25, skid: 0.9, slipLat: 1 }), cruise({ speed: 25 }),
      cruise({ speed: 25, surface: 2, skid: 0.7, slipLat: 1 }), cruise({ speed: 25, surface: 2 }), cruise({ speed: 12.5, surface: 4 }),
      cruise({ speed: 8, rpm: 4000, throttle: 0.8, gear: 1, skid: 0.7, slipLong: 1, slipLat: 0 }), cruise({ speed: 25 })];
    const r = remember('tyres', await render({ duration: states.length * SKID, cars: [{ keys: stairs(states, SKID) }] }));
    const rows = states.map((s, i) => {
      const [t0, t1] = step(i, SKID, 0.7);
      const d = describe(r.mono, r.rate, t0, t1);
      const inBand = lab.partials(d.spec, { f0: 600, f1: 1400, count: 1, floor: 0 })[0];
      // how far the strongest thing between 600 and 1400 Hz stands out of what surrounds that band
      const around = Math.hypot(lab.band(d.spec, 350, 550), lab.band(d.spec, 1700, 2100));
      return { d, squeal: dB(lab.band(d.spec, 650, 1250)), f: inBand.f, stands: dB(lab.band(d.spec, inBand.f - 60, inBand.f + 60)) - dB(around),
        scrub: dB(lab.band(d.spec, 1500, 4000)), thrum: dB(lab.band(d.spec, 20, 45)), rough: dB(lab.band(d.spec, 450, 1000)) };
    });
    report('at the limit (skid 0.25)', rows[2].d);
    report('sliding (skid 0.9)', rows[3].d);
    report('sliding on grass', rows[5].d);
    report('wheelspin in first', rows[8].d);
    const [none, early, limit, over, after, grass, grassRoll, shoulder, spin] = rows;
    check('tyres: no squeal without skid', none.stands < 6 && after.stands < 6 && Math.abs(after.squeal - none.squeal) < 1.5,
      `the strongest thing in 600-1400 Hz stands ${f1(none.stands)} dB out of its surroundings before, ${f1(after.stands)} dB after`);
    check('tyres: the squeal comes in before the limit and grows past it', early.squeal > none.squeal + 3 && limit.squeal > early.squeal + 3 && over.squeal > limit.squeal + 2 && limit.stands > 12,
      `650-1250 Hz: no skid ${f0(none.squeal)}, skid 0.1 ${f0(early.squeal)}, 0.25 (the limit) ${f0(limit.squeal)}, 0.9 ${f0(over.squeal)} dBFS; at the limit it stands ${f0(limit.stands)} dB out`);
    check('tyres: the squeal is a narrow band between 700 and 1200 Hz, falling in pitch as the tyre is worked harder',
      limit.f > 700 && limit.f < 1200 && over.f > 700 && over.f < limit.f - 40,
      `${f0(early.f)} Hz at skid 0.1, ${f0(limit.f)} Hz at the limit, ${f0(over.f)} Hz sliding`);
    check('tyres: on grass they scrub, they do not sing', grass.stands < 8 && grass.scrub > none.scrub + 8 && grassRoll.scrub > none.scrub + 3,
      `sliding on grass: nothing stands more than ${f1(grass.stands)} dB out, 1.5-4 kHz up ${f0(grass.scrub - none.scrub)} dB; rolling on it: up ${f0(grassRoll.scrub - none.scrub)} dB`);
    const strip = lab.partials(shoulder.d.spec, { f0: 15, f1: 45, count: 1, floor: 0 })[0];
    check('tyres: the kerb thrums at the rate its bumps go by', shoulder.thrum > none.thrum + 8 && Math.abs(strip.f / (12.5 / 0.45) - 1) < 0.04,
      `20-45 Hz up ${f0(shoulder.thrum - none.thrum)} dB; strongest at ${f1(strip.f)} Hz for ${f1(12.5 / 0.45)} (12.5 m/s over its 0.45 m teeth)`);
    check('tyres: wheelspin is the rougher, lower band', spin.rough > rows[9].rough + 8 && spin.stands < limit.stands,
      `450-1000 Hz up ${f0(spin.rough - rows[9].rough)} dB over the engine at the same revs... against a later cruise`);
  }

  // ---- contact
  {
    const hits = [0.3, 1, 3, 7, 15];
    const events = hits.map((impact, i) => ({ t: 1 + i * 1.2, impact }));
    const base = { duration: 12, cars: [{ keys: [[0, cruise({ speed: 14, rpm: 1500 })], [7.5, cruise({ speed: 14, rpm: 1500 })],
      [7.7, cruise({ speed: 14, rpm: 1500, scrape: 0.8 })], [9, cruise({ speed: 13, rpm: 1500, scrape: 0.8 })], [9.2, cruise({ speed: 13, rpm: 1500 })],
      [10.2, cruise({ speed: 13, rpm: 1500, edge: 1 })], [10.4, cruise({ speed: 13, rpm: 1500, scrape: 0.8, edge: 1 })],
      [11.6, cruise({ speed: 12, rpm: 1500, scrape: 0.8, edge: 1 })], [11.8, cruise({ speed: 12, rpm: 1500, edge: 1 })]] }] };
    const withHits = remember('contact', await render({ ...base, events: [...events, { t: 6.4, impact: 9 }, { t: 6.45, impact: 9 }] }));
    const without = await render(base);
    // what the hits added: everything else is the same sample for sample
    const added = new Float32Array(withHits.mono.length);
    for (let i = 0; i < added.length; i++) added[i] = withHits.mono[i] - without.mono[i];
    const loud = events.map((e) => dB(lab.rms(added, withHits.rate, e.t, e.t + 0.12)));
    const bright = events.map((e) => lab.centroid(lab.spectrum(added, withHits.rate, e.t, e.t + 0.12)));
    let grows = loud[0] < -90;
    for (let i = 2; i < hits.length; i++) if (!(loud[i] > loud[i - 1] + 3 && bright[i] > bright[i - 1])) grows = false;
    check('contact: a thud is louder and brighter the faster the meeting; below 0.6 m/s there is none', grows && loud[4] > -22,
      hits.map((h, i) => `${h} m/s: ${loud[i] < -90 ? 'nothing' : `${f0(loud[i])} dBFS, centre ${f0(bright[i])} Hz`}`).join(' | '));
    // 9 m/s is ((9 / 7) ** 0.7) = +1.5 dB over 7 m/s, a little brighter; doubled it would be about 3 dB more again
    const seven = dB(lab.rms(added, withHits.rate, 4.6, 4.9));
    const two = dB(lab.rms(added, withHits.rate, 6.4, 6.7));
    const fifteen = dB(lab.rms(added, withHits.rate, 5.8, 6.1));
    check('contact: two reports of one hit 50 ms apart make one thud', two < seven + 1.5 + 1.5 && two > seven && two < fifteen,
      `7 m/s alone ${f1(seven)} dBFS, 9 m/s reported twice ${f1(two)} dBFS, 15 m/s alone ${f1(fifteen)} dBFS`);
    const quiet = describe(withHits.mono, withHits.rate, 7, 7.45);
    const rail = describe(withHits.mono, withHits.rate, 8, 8.9);
    const rock = describe(withHits.mono, withHits.rate, 10.7, 11.5);
    report('along a steel rail', rail);
    report('along rock', rock);
    const hf = (d) => dB(lab.band(d.spec, 1500, 5000));
    const ring = lab.partials(rail.spec, { f0: 1500, f1: 5000, count: 1, floor: 0 })[0];
    check('contact: a scrape while sliding along an edge, and none otherwise', hf(rail) > hf(quiet) + 15 && hf(rock) > hf(quiet) + 8 && dB(lab.rms(withHits.mono, withHits.rate, 9.8, 10.1)) < quiet.rms + 1,
      `1.5-5 kHz: clear ${f0(hf(quiet))}, rail ${f0(hf(rail))}, rock ${f0(hf(rock))} dBFS`);
    check('contact: steel rings (a narrow band near 2.3 kHz), rock grinds (lower and wider)', Math.abs(ring.f - 2350) < 120 && rock.centroid < rail.centroid * 0.8,
      `rail: strongest at ${f0(ring.f)} Hz, centre ${f0(rail.centroid)} Hz; rock: centre ${f0(rock.centroid)} Hz`);
  }

  // =========================================================================================== gear changes and lifting off
  section('gear changes and lifting off (the real car on a level road)');
  const run = remember('run', await render('run'));
  const runData = await page.evaluate(() => window.__sound.scenario('run'));
  {
    const keys = runData.cars[0].keys;
    const shifts = [];
    for (let i = 1; i < keys.length; i++) if (keys[i][1].gear !== keys[i - 1][1].gear) shifts.push({ t: keys[i][0], from: keys[i - 1][1].gear, to: keys[i][1].gear, throttle: keys[i][1].throttle });
    const ups = shifts.filter((s) => s.to > s.from && s.throttle > 0.8);
    console.log(`  the car changed gear at ${shifts.map((s) => `${f1(s.t)} s (${s.from}>${s.to})`).join(', ')}`);
    const rpmAt = (t) => {
      const i = Math.min(keys.length - 2, Math.max(0, Math.floor(t * 60)));
      const u = t * 60 - i;
      return keys[i][1].rpm + (keys[i + 1][1].rpm - keys[i][1].rpm) * u;
    };
    // the real sweep: away from the changes, the firing frequency is where the rev counter says
    let worst = 0;
    let n = 0;
    for (let t = 3.4; t < 14.3; t += 0.37) {
      if (shifts.some((s) => Math.abs(s.t - t) < 0.4)) continue;
      const spec = lab.spectrum(run.mono, run.rate, t - 0.06, t + 0.06, 8);
      const p = lab.partials(spec, { f0: 40, f1: 600, count: 1, floor: 0 })[0];
      worst = Math.max(worst, Math.abs(p.f / (rpmAt(t) / 30) - 1));
      n++;
    }
    check('engine: through the gears the firing frequency follows the rev counter', worst < 0.03 && n > 15, `${n} moments between changes, furthest off ${f1(worst * 100)} %`);
    const dips = ups.map((s) => {
      const before = dB(lab.rms(run.mono, run.rate, s.t - 0.13, s.t - 0.02));
      let least = Infinity;
      for (let t = s.t; t < s.t + 0.16; t += 0.01) least = Math.min(least, dB(lab.rms(run.mono, run.rate, t, t + 0.04)));
      const after = dB(lab.rms(run.mono, run.rate, s.t + 0.3, s.t + 0.42));
      return { ...s, dip: before - least, back: after - before };
    });
    check('a gear change up under power is an event: the drive is cut for a moment', ups.length >= 3 && dips.every((x) => x.dip > 2.5 && x.dip < 10 && x.back > -6),
      dips.map((x) => `${x.from}>${x.to}: -${f1(x.dip)} dB, then ${f1(x.back)} dB of where it was`).join(' | '));
    const lift = keys.find((k, i) => i > 60 && k[1].throttle < 0.05 && keys[i - 6][1].throttle > 0.9)[0];
    // the car's own voice: at speed the wind and the road rightly come forward when the engine drops back
    const dry = await render('run', { mix: { wind: 0, road: 0 } });
    const on = describe(dry.mono, dry.rate, lift - 0.5, lift - 0.05);
    const off = describe(dry.mono, dry.rate, lift + 0.45, lift + 0.9);
    check('lifting off: quieter and smoother at once (the car without wind and road)', on.rms - off.rms > 5 && off.centroid < on.centroid,
      `at ${f1(lift)} s: ${f1(on.rms)} -> ${f1(off.rms)} dBFS, centre ${f0(on.centroid)} -> ${f0(off.centroid)} Hz`);
  }
  {
    // pops: under the firing frequency of a fast-turning engine there is nothing else, so that is where to look
    const scene = (rpm) => ({ duration: 5, cars: [{ keys: [[0, still({ rpm, throttle: 1 })], [2, still({ rpm, throttle: 1 })], [2.02, still({ rpm, throttle: 0 })], [5, still({ rpm: rpm * 0.8, throttle: 0 })]] }] });
    // what the pops add: the same render with the pops turned down to nothing is the same sample for sample otherwise
    const count = (r, r0) => {
      const levels = [];
      for (let t = 2.0; t < 3.4; t += 0.005) {
        let e = 0;
        const i0 = Math.round(t * r.rate);
        const n = Math.round(0.02 * r.rate);
        for (let i = i0; i < i0 + n; i++) e += (r.mono[i] - r0.mono[i]) ** 2;
        levels.push({ t, v: dB(Math.sqrt(e / n)) });
      }
      const bursts = [];
      let inside = false;
      for (const x of levels) {
        if (!inside && x.v > -50) {
          bursts.push(x.t);
          inside = true;
        } else if (inside && x.v < -62) inside = false;
      }
      return bursts;
    };
    const high = remember('liftoff_5600', await render(scene(5600)));
    const low = await render(scene(2600));
    const bursts = count(high, await render(scene(5600), { mix: { pop: 0 } }));
    const lowBursts = count(low, await render(scene(2600), { mix: { pop: 0 } }));
    check('lifting off at high revs: a pop or two, soon after', bursts.length >= 1 && bursts.length <= 2 && bursts[0] - 2.02 < 0.25,
      `${bursts.length} at ${bursts.map((t) => `${f0((t - 2.02) * 1000)} ms`).join(' and ')} after the throttle shut at 5600 rpm; peak then ${f1(dB(lab.peak(high.mono, high.rate, 2.05, 2.6)))} dBFS against ${f1(dB(lab.peak(high.mono, high.rate, 1.5, 2)))} under power`);
    check('lifting off at low revs: no pop', lowBursts.length === 0, `${lowBursts.length} at 2600 rpm`);
  }
  remember('liftoff', await render('liftoff'));

  // =========================================================================================== signals
  section('signals');
  const NOTES = { count: [622.25], go: [1244.5], ahead: [880, 1174.66], behind: [783.99, 587.33], lap: [1046.5, 1567.98], finish: [783.99, 1046.5, 1318.51, 1567.98], ui: [1800] };
  const cues = remember('cues', await render('cues'));
  {
    const sig = cues.mono;
    const rate = cues.rate;
    const heard = (t, f) => {
      const before = lab.tone(sig, rate, t - 0.12, t - 0.01, f);
      const during = lab.tone(sig, rate, t + 0.004, t + 0.034, f);
      // when it starts: the first 4 ms slice in which the tone has reached a third of what it gets to
      let onset = NaN;
      for (let u = t - 0.03; u < t + 0.06; u += 0.001) {
        if (lab.tone(sig, rate, u, u + 0.008, f) > during * 0.33) {
          onset = u + 0.004;
          break;
        }
      }
      return { level: dB(during), over: dB(during) - dB(before), late: (onset - t) * 1000 };
    };
    const log = cues.log;
    const rows = [];
    const expect = (e, label, notes, gaps) => notes.forEach((f, i) => rows.push({ label: `${label}${notes.length > 1 ? ' ' + (i + 1) : ''}`, f, ...heard(e.t + gaps[i], f) }));
    const counts = log.filter((e) => e.cue === 'count');
    counts.forEach((e, i) => expect(e, `count ${i + 1}`, NOTES.count, [0]));
    const go = log.find((e) => e.cue === 'go');
    expect(go, 'go', NOTES.go, [0]);
    const sectors = log.filter((e) => e.cue === 'sector');
    expect(sectors[0], 'sector ahead', NOTES.ahead, [0, 0.1]);
    expect(sectors[1], 'sector behind', NOTES.behind, [0, 0.1]);
    expect(log.find((e) => e.cue === 'lap'), 'lap', NOTES.lap, [0, 0.11]);
    expect(log.find((e) => e.cue === 'finish'), 'finish', NOTES.finish, [0, 0.12, 0.24, 0.36]);
    log.filter((e) => e.cue === 'ui').forEach((e, i) => expect(e, `tick ${i + 1}`, NOTES.ui, [0]));
    console.log('  ' + rows.map((x) => `${x.label} ${f0(x.f)} Hz ${f0(x.level)} dBFS (+${f0(x.over)} dB, ${x.late >= 0 ? '+' : ''}${f1(x.late)} ms)`).join(' · '));
    const missing = rows.filter((x) => !(x.level > -40 && x.over > 15 && Math.abs(x.late) < 12));
    check('every signal is heard at its moment, at its pitch', missing.length === 0 && counts.length === 5,
      `${rows.length} notes of ${log.filter((e) => e.cue && e.cue !== 'shift').length} signals, each at least ${f0(Math.min(...rows.map((x) => x.over)))} dB over what was there, within ${f1(Math.max(...rows.map((x) => Math.abs(x.late))))} ms${missing.length ? '; MISSING ' + missing.map((x) => x.label).join(', ') : ''}`);
    const ringing = (t, f) => dB(lab.tone(sig, rate, t + 0.3, t + 0.4, f));
    // a count's own level is the engine's 25th harmonic at idle (625 Hz) once it has gone; so judge each by its fall
    const fall = (t, f) => ringing(t, f) - dB(lab.tone(sig, rate, t + 0.004, t + 0.034, f));
    check('go is an octave above the count and rings on', Math.abs(NOTES.go[0] / NOTES.count[0] - 2) < 0.001 && fall(go.t, NOTES.go[0]) > -22 && fall(counts[4].t, NOTES.count[0]) < -30,
      `0.3 s on: go ${f0(fall(go.t, NOTES.go[0]))} dB under its start, a count ${f0(fall(counts[4].t, NOTES.count[0]))} dB`);
    const strongest = (t0) => lab.partials(lab.spectrum(sig, rate, t0, t0 + 0.09), { f0: 400, f1: 1400, count: 1, floor: 0 })[0].f;
    const sa = [strongest(sectors[0].t + 0.005), strongest(sectors[0].t + 0.13)];
    const sb = [strongest(sectors[1].t + 0.005), strongest(sectors[1].t + 0.13)];
    const near = (f, g) => Math.abs(f / g - 1) < 0.02;
    check('the sector signal rises when ahead and falls when behind', near(sa[0], NOTES.ahead[0]) && near(sa[1], NOTES.ahead[1]) && near(sb[0], NOTES.behind[0]) && near(sb[1], NOTES.behind[1]),
      `strongest note ahead ${f0(sa[0])} -> ${f0(sa[1])} Hz, behind ${f0(sb[0])} -> ${f0(sb[1])} Hz`);
    const shift = log.find((e) => e.cue === 'shift');
    const thump = dB(lab.band(lab.spectrum(sig, rate, shift.t, shift.t + 0.06, 1), 55, 220)) - dB(lab.band(lab.spectrum(sig, rate, shift.t - 0.2, shift.t - 0.14, 1), 55, 220));
    check('the shift signal is a low thump', thump > 8, `55-220 Hz up ${f0(thump)} dB for 60 ms`);
    const idle = describe(sig, rate, 0.4, 0.95);
    report('idle', idle);
    check('idle: quiet, low, and its firing is heard', idle.rms < -28 && idle.rms > -42 && Math.abs(idle.partials[0].f / 25 - 1) < 0.03 && idle.bands[2] > -24,
      `${f1(idle.rms)} dBFS, strongest partial ${f1(idle.partials[0].f)} Hz, 0.5-1.5 kHz is ${f0(idle.bands[2])} dB of it`);
  }

  // =========================================================================================== the tunnel
  section('the tunnel');
  {
    const ir = cues.impulse;
    const t60 = lab.decayTime(ir.left, ir.rate, 0.01);
    let early = 0;
    let most = 0;
    for (let i = 0; i < ir.left.length; i++) most = Math.max(most, Math.abs(ir.left[i]));
    const first = ir.left.findIndex((v) => Math.abs(v) > most * 0.05) / ir.rate;
    for (let i = 1; i < Math.round(ir.rate * 0.1); i++) {
      const v = Math.abs(ir.left[i]);
      if (v > most * 0.2 && v >= Math.abs(ir.left[i - 1]) && v > Math.abs(ir.left[i + 1])) early++;
    }
    let same = 0;
    for (let i = 0; i < ir.left.length; i++) same += ir.left[i] * ir.right[i];
    check('the reverb is a hard-walled tube: about 1.6 s, with dense early reflections', t60 > 1.3 && t60 < 1.9 && early >= 20 && first > 0.005 && first < 0.03,
      `it falls 60 dB in ${t60.toFixed(2)} s; first reflection after ${f0(first * 1000)} ms, ${early} separate reflections in the first 100 ms; left and right ${f0(Math.abs(same / (ir.left.length * lab.rms(ir.left, ir.rate) * lab.rms(ir.right, ir.rate))) * 100)} % alike`);
    const scene = (hits) => ({ duration: 13, cars: [{ keys: [[0, cruise({ speed: 30 })], [2, cruise({ speed: 30 })], [3, cruise({ speed: 30, sky: 0 })], [7.5, cruise({ speed: 30, sky: 0 })],
      [8.5, cruise({ speed: 30 })], [13, cruise({ speed: 30 })]] }], events: hits ? [{ t: 5, impact: 6 }, { t: 10.5, impact: 6 }] : [] });
    const a = remember('tunnel', await render(scene(true)));
    const b = await render(scene(false));
    const added = new Float32Array(a.mono.length);
    for (let i = 0; i < added.length; i++) added[i] = a.mono[i] - b.mono[i];
    const tail = (t) => dB(lab.rms(added, a.rate, t + 0.5, t + 1.2)) - dB(lab.rms(added, a.rate, t, t + 0.15));
    const inside = tail(5);
    const outside = tail(10.5);
    check('the tunnel adds a tail: a thud inside rings on, one outside does not', inside > -40 && outside < -70,
      `0.5 to 1.2 s after the thud there is ${f0(inside)} dB of it left inside, ${f0(outside)} dB outside`);
    const open = describe(b.mono, b.rate, 1, 1.9);
    const roofed = describe(b.mono, b.rate, 5, 7);
    const wind = (d) => dB(lab.band(d.spec, 1500, 4000));
    const low = (d) => dB(lab.band(d.spec, 60, 400));
    report('in the open, 108 km/h', open);
    report('in the tunnel, 108 km/h', roofed);
    check('under the roof the world changes a little: more of the car, less of the wind', roofed.rms - open.rms > 0.5 && roofed.rms - open.rms < 6 && wind(roofed) - low(roofed) < wind(open) - low(open) - 0.5,
      `level ${f1(open.rms)} -> ${f1(roofed.rms)} dBFS; 1.5-4 kHz against 60-400 Hz: ${f1(wind(open) - low(open))} -> ${f1(wind(roofed) - low(roofed))} dB`);
    const afterExit = dB(lab.rms(b.mono, b.rate, 9.5, 10.4)) - open.rms;
    check('out of the tunnel the sound is what it was', Math.abs(afterExit) < 0.7, `${afterExit >= 0 ? '+' : ''}${afterExit.toFixed(2)} dB against before`);
  }

  // =========================================================================================== two cars
  section('split screen and solo');
  {
    const PAN = await page.evaluate(() => window.__sound.SPLIT_PAN);
    const a = still({ rpm: 2600, throttle: 0.6, speed: 30, gear: 4, pan: -PAN });
    const b = still({ rpm: 3700, throttle: 0.6, speed: 30, gear: 4, pan: PAN });
    const r = remember('two_cars', await render({ duration: 6, cars: [{ keys: [[0, a], [6, a]] }, { keys: [[0, b], [6, b]] }],
      events: [{ t: 2, impact: 8, pan: -PAN }, { t: 3, impact: 8, pan: PAN }, { t: 4, cue: 'sector', pan: -PAN, detail: { ahead: true } }, { t: 5, cue: 'lap', pan: PAN }] }));
    const lean = (t0, t1, f) => dB(lab.tone(r.left, r.rate, t0, t1, f)) - dB(lab.tone(r.right, r.rate, t0, t1, f));
    const first = lean(0.8, 1.9, 2600 / 30);
    const second = -lean(0.8, 1.9, 3700 / 30);
    check('split screen: each car is at least 6 dB stronger on its own side', first > 6 && second > 6,
      `pan ${PAN}: the first car's ${f1(2600 / 30)} Hz is ${f1(first)} dB stronger on the left, the second's ${f1(3700 / 30)} Hz ${f1(second)} dB stronger on the right`);
    const quiet = await render({ duration: 6, cars: [{ keys: [[0, a], [6, a]] }, { keys: [[0, b], [6, b]] }] });
    const addedSide = (ch, t0, t1) => {
      let e = 0;
      for (let i = Math.round(t0 * r.rate); i < Math.round(t1 * r.rate); i++) e += (r[ch][i] - quiet[ch][i]) ** 2;
      return e;
    };
    const hitL = 10 * Math.log10(addedSide('left', 2, 2.15) / addedSide('right', 2, 2.15));
    const hitR = 10 * Math.log10(addedSide('left', 3, 3.15) / addedSide('right', 3, 3.15));
    const cueL = lean(4.11, 4.25, NOTES.ahead[1]);
    const cueR = -lean(5.12, 5.3, NOTES.lap[1]);
    check('split screen: a thud and a signal are heard on the side of the driver they belong to', hitL > 3 && hitR < -3 && cueL > 6 && cueR > 6,
      `thuds are ${f1(hitL)} dB stronger left and ${f1(-hitR)} dB stronger right; signals lean ${f1(cueL)} dB left and ${f1(cueR)} dB right`);
    const pair = dB(lab.rms(r.mono, r.rate, 0.8, 1.9));
    const one = await render({ duration: 2, cars: [{ keys: [[0, { ...a, pan: 0 }], [2, { ...a, pan: 0 }]] }], events: [{ t: 1, cue: 'go' }] });
    let apart = 0;
    for (let i = 0; i < one.left.length; i++) apart = Math.max(apart, Math.abs(one.left[i] - one.right[i]));
    check('solo: one car, in the middle', apart < 1e-6, `left and right differ by at most ${apart.toExponential(1)}`);
    const alone = dB(lab.rms(one.mono, one.rate, 0.8, 1.9));
    check('two cars are only a little louder than one', pair - alone > -2 && pair - alone < 4, `one ${f1(alone)} dBFS, two ${f1(pair)} dBFS (in mono)`);
  }

  // =========================================================================================== loudness, clipping, silence
  section('loud moments, silence, and nothing that should not be there');
  {
    const PAN = 0.7;
    const hard = (pan) => still({ rpm: 6300, throttle: 1, speed: 60, gear: 3, skid: 1, slipLat: 1, slipLong: 1, scrape: 1, sky: 0, pan });
    const events = [];
    for (let t = 1.5; t < 5.6; t += 0.5) events.push({ t, impact: 25, pan: -PAN }, { t, impact: 25, pan: PAN }, { t, cue: t < 3 ? 'go' : 'finish' });
    const r = remember('worst', await render({ duration: 6, cars: [{ keys: [[0, hard(-PAN)], [6, hard(-PAN)]] }, { keys: [[0, hard(PAN)], [6, hard(PAN)]] }], events }));
    const top = Math.max(lab.peak(r.left, r.rate), lab.peak(r.right, r.rate));
    check('nothing clips: two cars flat out in the tunnel, sliding, scraping, hitting, with signals on top', dB(top) < -1,
      `loudest sample ${dB(top).toFixed(2)} dBFS; ${f1(dB(lab.rms(r.mono, r.rate, 1, 6)))} dBFS rms`);
    const single = sweeps[1];
    const [t0, t1] = step(RPMS.length - 1, CELL);
    const loudest = dB(lab.peak(single.mono, single.rate, t0, t1));
    check('one engine at full load leaves the limiter alone', loudest < -9, `peak ${f1(loudest)} dBFS at ${RPMS[RPMS.length - 1]} rpm (the limiter starts at about -8 after its own gain)`);
  }
  {
    const worst = { name: '', v: 0 };
    const sub = { name: '', v: -Infinity };
    for (const { name, r } of everything) {
      for (const sig of [r.left, r.right]) {
        const m = Math.abs(lab.mean(sig, r.rate));
        if (m > worst.v) Object.assign(worst, { name, v: m });
      }
      const spec = lab.spectrum(r.mono, r.rate, 0.5, Math.min(r.seconds, 8.5), 1);
      const low = dB(lab.band(spec, 0, 12)) - dB(lab.band(spec, 0, 24000));
      if (low > sub.v) Object.assign(sub, { name, v: low });
    }
    check('no DC offset in anything rendered', dB(worst.v) < -60 && sub.v < -20,
      `${everything.length} renders; largest mean ${f0(dB(worst.v))} dBFS (${worst.name}); most below 12 Hz: ${f0(sub.v)} dB of the sound (${sub.name})`);
    let bad = 0;
    for (const { r } of everything) for (const sig of [r.left, r.right]) for (let i = 0; i < sig.length; i++) if (!Number.isFinite(sig[i])) bad++;
    check('every sample of everything rendered is a number', bad === 0, `${bad} that are not`);
  }
  {
    const muted = await render('run', { mute: true });
    check('?mute is silence', lab.peak(muted.left, muted.rate) === 0 && lab.peak(muted.right, muted.rate) === 0, `loudest sample ${lab.peak(muted.mono, muted.rate)}`);
    const state = cruise({ rpm: 3000, throttle: 0.7, speed: 30 });
    const r = remember('mute', await render({ duration: 6, cars: [{ keys: [[0, state], [6, state]] }], events: [{ t: 2, mute: true }, { t: 2.6, cue: 'go' }, { t: 4, mute: false }] }));
    const before = dB(lab.rms(r.mono, r.rate, 1, 2));
    const during = lab.peak(r.mono, r.rate, 2.2, 4);
    const after = dB(lab.rms(r.mono, r.rate, 4.15, 5));
    check('setMuted(true) is silence within a fifth of a second, and setMuted(false) brings the sound back', during === 0 && Math.abs(after - before) < 1,
      `${f1(before)} dBFS before, loudest sample while muted ${during}, ${f1(after)} dBFS after`);
  }

  // ---- clicks
  {
    const limit = 0.003; // a step of -50 dBFS
    const rows = [];
    const add = (label, r, times, span = 0.25) => {
      let most = 0;
      for (const t of times) most = Math.max(most, lab.jump(r.left, r.rate, t - 0.02, t + span), lab.jump(r.right, r.rate, t - 0.02, t + span));
      rows.push({ label, most });
    };
    // cars that come and go
    const a = still({ rpm: 4200, throttle: 0.8, speed: 35, gear: 3, pan: -0.7 });
    const b = still({ rpm: 3100, throttle: 0.8, speed: 35, gear: 3, pan: 0.7 });
    const coming = remember('come_and_go', await render({ duration: 5, cars: [{ keys: [[0, a], [5, a]] }, { keys: [[0, b], [5, b]] }],
      events: [{ t: 2, voices: 1 }, { t: 3, voices: 0 }, { t: 3.6, voices: 2 }, { t: 4.3, paused: true }] }));
    add('two cars start', coming, [0], 0.4);
    add('one stops', coming, [2], 0.5);
    add('the other stops', coming, [3], 0.5);
    add('both start again', coming, [3.6], 0.4);
    add('pause', coming, [4.3], 0.4);
    const silent = lab.peak(coming.mono, coming.rate, 3.45, 3.6);
    const hushed = dB(lab.rms(coming.mono, coming.rate, 4.7, 5));
    const mute = everything.find((x) => x.name === 'mute').r;
    add('mute', mute, [2], 0.3);
    add('unmute', mute, [4], 0.3);
    add('signals', cues, cues.log.filter((e) => e.cue && e.cue !== 'shift').map((e) => e.t), 1);
    add('shift signal', cues, cues.log.filter((e) => e.cue === 'shift').map((e) => e.t));
    const keys = runData.cars[0].keys;
    const shiftTimes = [];
    for (let i = 1; i < keys.length; i++) if (keys[i][1].gear !== keys[i - 1][1].gear) shiftTimes.push(keys[i][0]);
    add('gear changes', run, shiftTimes, 0.3);
    add('lift-off, pops', everything.find((x) => x.name === 'liftoff_5600').r, [2.02], 0.6);
    add('tunnel in and out', everything.find((x) => x.name === 'tunnel').r, [2, 7.5], 1.2);
    const steady = lab.jump(run.mono, run.rate, 6, 8);
    console.log('  largest jump, as a step: ' + rows.map((x) => `${x.label} ${f0(dB(x.most))}`).join(' · ') + ` dBFS (steady full throttle: ${f0(dB(steady))})`);
    const loud = rows.filter((x) => x.most > limit);
    check('no clicks: nothing jumps at starts, stops, pause, mute, signals, gear changes or lift-off', loud.length === 0,
      `the largest jump is a step of ${f0(dB(Math.max(...rows.map((x) => x.most))))} dBFS (${rows.reduce((w, x) => (x.most > w.most ? x : w)).label}); allowed -50${loud.length ? '; TOO LARGE: ' + loud.map((x) => x.label).join(', ') : ''}`);
    check('a car that has gone is silent, and a paused one is hushed', silent < 1e-4 && hushed < -70, `loudest sample with no cars ${silent.toExponential(1)}; paused ${f0(hushed)} dBFS`);
  }

  // ---- frame rates
  {
    const keys = [[0, still({ rpm: 900 })], [0.5, still({ rpm: 2300, throttle: 1 })], [2.5, still({ rpm: 6200, throttle: 1, speed: 20, gear: 1 })],
      [2.55, still({ rpm: 3800, throttle: 1, speed: 21, gear: 2 })], [4.5, still({ rpm: 6000, throttle: 1, speed: 33, gear: 2, skid: 0.5 })],
      [4.6, still({ rpm: 5800, throttle: 0, speed: 33, gear: 2, skid: 0.8, sky: 0.5 })], [6, still({ rpm: 3000, throttle: 0, speed: 20, gear: 2, sky: 0 })],
      [7, still({ rpm: 2000, throttle: 0.4, speed: 18, gear: 3, sky: 1 })]];
    const scene = { duration: 7, cars: [{ keys }] };
    const rates = [30, 60, 144];
    const out = [];
    for (const fps of rates) out.push(await render(scene, { fps }));
    remember('fps_30', out[0]);
    let apart = 0;
    let where = 0;
    for (let t = 0.5; t < 6.75; t += 0.25) {
      const levels = out.map((r) => dB(lab.rms(r.mono, r.rate, t, t + 0.25)));
      const d = Math.max(...levels) - Math.min(...levels);
      if (d > apart) {
        apart = d;
        where = t;
      }
    }
    // stepping would put a step in the sound at every frame: look for jumps while everything is changing
    const jumps = out.map((r) => lab.jump(r.mono, r.rate, 0.3, 2.45));
    const tilt = out.map((r) => {
      const spec = lab.spectrum(r.mono, r.rate, 0.6, 2.4, 1);
      return dB(lab.band(spec, 3000, 24000)) - dB(lab.band(spec, 15, 3000));
    });
    check('30, 60 and 144 updates a second sound the same, and none of them steps', apart < 1 && Math.max(...jumps) < 0.001 && Math.max(...tilt) - Math.min(...tilt) < 1,
      `levels within ${apart.toFixed(2)} dB of each other in every quarter second (furthest at ${f1(where)} s); largest jump ${jumps.map((j, i) => `${rates[i]}: ${f0(dB(j))}`).join(', ')} dBFS; above 3 kHz ${tilt.map((x) => f1(x)).join(' / ')} dB of the rest`);
  }

  // ---- what must never reach an audio parameter
  {
    const junk = { rpm: NaN, throttle: Infinity, speed: undefined, gear: 'three', skid: -Infinity, surface: 9, scrape: NaN, pan: NaN, sky: null, slipLong: NaN, slipLat: 'x', offroad: NaN, edge: -1 };
    const good = cruise({ rpm: 3000, throttle: 0.6 });
    const r = await render({ duration: 4, cars: [{ keys: [[0, good], [1, good], [1.001, junk], [2, junk], [2.001, good], [4, good]] }],
      events: [{ t: 1.5, impact: NaN }, { t: 1.6, cue: 'nonsense' }, { t: 1.7, cue: 'sector', pan: NaN }, { t: 1.8, impact: Infinity, pan: 2 }] });
    let bad = 0;
    for (const sig of [r.left, r.right]) for (let i = 0; i < sig.length; i++) if (!Number.isFinite(sig[i])) bad++;
    const through = dB(lab.rms(r.mono, r.rate, 1.2, 2));
    const after = dB(lab.rms(r.mono, r.rate, 3, 4)) - dB(lab.rms(r.mono, r.rate, 0.5, 1));
    const direct = await page.evaluate(() => {
      const { GameAudio, Sound } = window.__sound;
      const ctx = new OfflineAudioContext(2, 4800, 48000);
      const audio = new GameAudio({ context: ctx, storageKey: '' });
      const sound = new Sound(audio);
      try {
        sound.update(NaN, null);
        sound.update(-1, [null, undefined]);
        sound.update(1e9, [{}, { rpm: 'fast' }, {}]);
        sound.update(0, []);
        sound.cue();
        sound.cue('impact', NaN, { strength: 'hard' });
        sound.cue('shift', 5);
        sound.impact();
        audio.setVolume(NaN);
        audio.setReverb(NaN);
        audio.setMuted();
        audio.setMuted(false);
        return 'ok';
      } catch (err) {
        return String(err && err.stack ? err.stack : err);
      }
    });
    check('nonsense in, sound out: NaN, infinity and missing values never reach an audio parameter', bad === 0 && through > -60 && Math.abs(after) < 1 && direct === 'ok',
      `${bad} samples that are not numbers; ${f1(through)} dBFS while fed nonsense, ${after.toFixed(2)} dB against before once fed sense again; called with rubbish directly: ${direct}`);
  }

  // =========================================================================================== the graph
  section('the graph');
  {
    const a = cruise({ pan: -0.7 });
    const b = cruise({ rpm: 2300, speed: 31, pan: 0.7 });
    const r = await render({ duration: 3, cars: [{ keys: [[0, a], [3, a]] }, { keys: [[0, b], [3, b]] }] });
    const kinds = Object.entries(r.nodes.kinds).map(([k, v]) => `${v} ${k.replace('create', '')}`).join(', ');
    check('two cars at cruise are under about 60 nodes', r.nodes.created <= 60 && r.nodes.live === 0, `${r.nodes.created} nodes (${kinds})`);
  }
  {
    const events = [];
    const names = ['count', 'go', 'sector', 'lap', 'finish', 'ui', 'shift'];
    for (let i = 0; i < 100; i++) events.push(i % 2 ? { t: 0.5 + i * 0.2, impact: 3 + (i % 9) } : { t: 0.5 + i * 0.2, cue: names[(i >> 1) % names.length], pan: (i % 3) - 1 });
    const keys = [[0, cruise()], [21, cruise()], [21.2, cruise({ skid: 0.8, scrape: 0.7, surface: 1 })], [22, cruise({ skid: 0.8, scrape: 0.7, surface: 1 })], [22.2, cruise()], [25, cruise()]];
    const gc = await page.evaluate(async ([scene]) => {
      // every node the scenario makes is watched; when it is over and forgotten, the collector should take them all
      const made = { n: 0, gone: 0 };
      const registry = new FinalizationRegistry(() => made.gone++);
      const names = ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createWaveShaper', 'createConvolver', 'createDynamicsCompressor'];
      const originals = names.map((name) => OfflineAudioContext.prototype[name] || BaseAudioContext.prototype[name]);
      names.forEach((name, i) => {
        OfflineAudioContext.prototype[name] = function (...args) {
          const node = originals[i].apply(this, args);
          made.n++;
          registry.register(node, name);
          return node;
        };
      });
      let result;
      try {
        result = await window.__sound.render(scene, { raw: true });
      } finally {
        names.forEach((name) => delete OfflineAudioContext.prototype[name]);
      }
      const nodes = result.nodes;
      result = null;
      for (let i = 0; i < 10 && made.gone < made.n; i++) {
        if (typeof gc === 'function') gc();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return { nodes, made: made.n, gone: made.gone, canCollect: typeof gc === 'function' };
    }, [{ duration: 25, cars: [{ keys }], events }]);
    check('a hundred one-off sounds and three passing voices leave nothing behind', gc.nodes.live === 0 && gc.nodes.mostLive > 3 && gc.nodes.created > 300,
      `${gc.nodes.created} nodes made in 25 s, at most ${gc.nodes.mostLive} sounds alive at once, ${gc.nodes.live} still held at the end`);
    check('and the browser can free every node once the sound is over', !gc.canCollect || gc.gone >= gc.made * 0.98,
      gc.canCollect ? `${gc.gone} of ${gc.made} nodes collected` : 'the collector cannot be called here: not measured');
  }

  // =========================================================================================== the whole thing
  section('the whole thing: the real car, the real road, the autopilot');
  for (const name of ['idle', 'tunnel', 'skid', 'impacts', 'split', 'lap']) remember(name, await render(name));
  {
    const lap = everything.find((x) => x.name === 'lap').r;
    const split = everything.find((x) => x.name === 'split').r;
    const lapData = await page.evaluate(() => {
      const s = window.__sound.scenario('lap');
      const keys = s.cars[0].keys;
      const dark = keys.filter((k) => k[1].sky < 0.05).map((k) => k[0]);
      return { hits: s.events.filter((e) => e.impact !== undefined).length, sectors: s.events.filter((e) => e.cue === 'sector').map((e) => e.t),
        tunnel: dark.length ? [dark[0], dark[dark.length - 1]] : null, top: Math.max(...keys.map((k) => k[1].speed)) * 3.6, skid: Math.max(...keys.map((k) => k[1].skid)),
        gears: Math.max(...keys.map((k) => k[1].gear)) };
    });
    const go = lap.log.find((e) => e.cue === 'go').t;
    const driving = describe(lap.mono, lap.rate, go + 4, lap.seconds - 1);
    report('75 s of a lap', driving);
    const peak = Math.max(lab.peak(lap.left, lap.rate), lab.peak(lap.right, lap.rate), lab.peak(split.left, split.rate), lab.peak(split.right, split.rate));
    const quietest = { v: Infinity, t: 0 };
    for (let t = go + 1; t + 1 < lap.seconds; t++) {
      const v = dB(lab.rms(lap.mono, lap.rate, t, t + 1));
      if (v < quietest.v) Object.assign(quietest, { v, t });
    }
    check('a lap with the autopilot: a sensible level, no second falls silent, nothing clips', driving.rms > -30 && driving.rms < -14 && quietest.v > -45 && dB(peak) < -1,
      `${f1(driving.rms)} dBFS rms after the start, quietest second ${f1(quietest.v)} dBFS at ${quietest.t} s, loudest sample (solo and split) ${f1(dB(peak))} dBFS; top speed ${f0(lapData.top)} km/h, gear ${lapData.gears}, most skid ${lapData.skid.toFixed(2)}, ${lapData.hits} hits`);
    if (lapData.tunnel) {
      const [t0, t1] = lapData.tunnel;
      console.log(`  the tunnel: ${f1(t0)} to ${f1(t1)} s; sector line at ${lapData.sectors.map((t) => f1(t)).join(', ')} s`);
    }
    const splitDrive = describe(split.mono, split.rate, go + 4, split.seconds - 1);
    report('40 s of two cars', splitDrive);
    const balance = dB(lab.rms(split.left, split.rate, go + 4, split.seconds - 1)) - dB(lab.rms(split.right, split.rate, go + 4, split.seconds - 1));
    check('two cars racing: both sides busy, neither drowned', Math.abs(balance) < 6 && splitDrive.rms > -30 && splitDrive.rms < -12, `left against right ${balance >= 0 ? '+' : ''}${f1(balance)} dB, ${f1(splitDrive.rms)} dBFS rms`);
  }
  await page.context().close();

  // =========================================================================================== the browser
  section('the browser: gestures, mute, and no Web Audio at all');
  {
    const live = await open('live');
    const before = await live.evaluate(() => ({ ctx: !!window.__sound.audio.ctx, ready: window.__sound.audio.tick() }));
    await live.evaluate(() => {
      window.__sound.sound.update(1 / 60, [{ rpm: 3000, throttle: 1 }]);
      window.__sound.sound.cue('go');
    });
    const untouched = await live.evaluate(() => !!window.__sound.audio.ctx);
    await live.click('#bench button');
    await live.waitForTimeout(900);
    const after = await live.evaluate(() => {
      const { audio } = window.__sound;
      const an = window.__sound.analyser();
      let rms = 0;
      if (an) {
        const w = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(w);
        for (const v of w) rms += v * v;
        rms = Math.sqrt(rms / w.length);
      }
      return { state: audio.ctx ? audio.ctx.state : 'none', rate: audio.ctx ? audio.ctx.sampleRate : 0, rms, time: audio.ctx ? audio.ctx.currentTime : 0 };
    });
    check('sound starts only from a gesture', !before.ctx && !before.ready && !untouched && after.state === 'running' && after.time > 0.3 && after.rms > 1e-4,
      `before a click: no context, also after update() and cue(); after one: ${after.state} at ${after.rate} Hz, ${f1(dB(after.rms))} dBFS at the output`);

    // mute: remembered, silent, asleep; unmute: awake again
    await live.click('#bench div:last-child button:last-child');
    await live.waitForTimeout(700);
    const muted = await live.evaluate(() => {
      const { audio } = window.__sound;
      const an = window.__sound.analyser();
      const w = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(w);
      let peak = 0;
      for (const v of w) peak = Math.max(peak, Math.abs(v));
      return { muted: audio.muted, stored: localStorage.getItem('dreamcar.muted'), state: audio.ctx.state, peak };
    });
    await live.keyboard.press('a'); // any other gesture must not wake a muted context
    await live.waitForTimeout(200);
    const stillAsleep = await live.evaluate(() => window.__sound.audio.ctx.state);
    await live.click('#bench div:last-child button:last-child');
    await live.waitForTimeout(500);
    const unmuted = await live.evaluate(() => ({ muted: window.__sound.audio.muted, stored: localStorage.getItem('dreamcar.muted'), state: window.__sound.audio.ctx.state }));
    check('the sound button: silent and asleep when off (and remembered), awake when on again',
      muted.muted && muted.stored === '1' && muted.peak === 0 && muted.state === 'suspended' && stillAsleep === 'suspended' && !unmuted.muted && unmuted.stored === '0' && unmuted.state === 'running',
      `off: stored '${muted.stored}', loudest sample ${muted.peak}, context ${muted.state} (after another key press: ${stillAsleep}); on: stored '${unmuted.stored}', context ${unmuted.state}`);

    // a context the browser has suspended (a hidden tab, a phone call) comes back on the next gesture
    await live.evaluate(() => window.__sound.audio.ctx.suspend());
    const asleep = await live.evaluate(() => ({ state: window.__sound.audio.ctx.state, ready: window.__sound.audio.tick() }));
    await live.keyboard.press('a');
    await live.waitForTimeout(300);
    const awake = await live.evaluate(() => ({ state: window.__sound.audio.ctx.state, ready: window.__sound.audio.tick() }));
    check('a context that was suspended is resumed by the next gesture', asleep.state === 'suspended' && !asleep.ready && awake.state === 'running' && awake.ready, `${asleep.state} -> ${awake.state} on a key press`);

    // remembered across a reload; and ?mute
    await live.click('#bench div:last-child button:last-child');
    await live.reload({ waitUntil: 'load' });
    await live.waitForFunction('window.__ready === true');
    await live.click('#bench button');
    await live.waitForTimeout(300);
    const reloaded = await live.evaluate(() => ({ muted: window.__sound.audio.muted, ctx: !!window.__sound.audio.ctx }));
    await live.evaluate(() => localStorage.removeItem('dreamcar.muted'));
    await live.context().close();
    const viaQuery = await open('query', { query: '?mute' });
    await viaQuery.click('#bench button');
    await viaQuery.waitForTimeout(300);
    const q = await viaQuery.evaluate(() => ({ muted: window.__sound.audio.muted, ctx: !!window.__sound.audio.ctx, stored: localStorage.getItem('dreamcar.muted') }));
    await viaQuery.context().close();
    check('a muted page makes no audio context at all: after a reload, and with ?mute (which is not remembered)', reloaded.muted && !reloaded.ctx && q.muted && !q.ctx && q.stored === null,
      `reloaded: muted ${reloaded.muted}, context ${reloaded.ctx}; ?mute: muted ${q.muted}, context ${q.ctx}, stored ${q.stored}`);
  }
  {
    const exercise = () => {
      const { audio, sound } = window.__sound;
      const out = [];
      try {
        out.push(window.__sound.play('idle'));
        audio.unlock();
        sound.update(1 / 60, [{ rpm: 3000, throttle: 1, speed: 30, gear: 3, skid: 1, surface: 0, scrape: 1, pan: 0, sky: 0 }]);
        for (const name of ['count', 'go', 'sector', 'lap', 'finish', 'ui', 'impact', 'shift']) sound.cue(name, 0, { ahead: true, strength: 5 });
        sound.impact(8, 0);
        sound.setPaused(true);
        audio.setReverb(1);
        audio.setVolume(0.5);
        audio.setMuted(true);
        audio.setMuted(false);
        out.push(audio.tick(), !!audio.ctx, audio.now, !!audio.spot(0, 0), !!audio.bus());
        return out.join(',');
      } catch (err) {
        return String(err && err.stack ? err.stack : err);
      }
    };
    const before = problems.length;
    const none = await open('no web audio', { init: 'delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined;' });
    await none.click('#bench button');
    const a = await none.evaluate(exercise);
    await none.context().close();
    const refuses = await open('refuses', { init: 'window.AudioContext = function () { throw new Error("no audio for you"); }; window.webkitAudioContext = undefined;' });
    await refuses.click('#bench button');
    const b = await refuses.evaluate(exercise);
    await refuses.context().close();
    const stuck = await open('stuck', { init: `{
      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        get state() { return 'suspended'; }
        resume() { return Promise.reject(new Error('not allowed')); }
      };
    }` });
    await stuck.click('#bench button');
    await stuck.waitForTimeout(300);
    const c = await stuck.evaluate(exercise);
    await stuck.waitForTimeout(300);
    await stuck.context().close();
    const expected = 'false,false,false,0,false,false';
    check('safe with no Web Audio at all, with a context that throws, and with one that will not start', a === expected && b === expected && c === 'true,false,true,' + c.split(',')[3] + ',true,true' && problems.length === before,
      `none: ${a} | throws: ${b} | will not start: ${c}${problems.length > before ? ' | ' + problems.slice(before, before + 3).join(' | ') : ''}`);
  }

  check('no console errors or warnings anywhere', problems.length === 0, problems.slice(0, 4).join(' | '));
  await browser.close();
  console.log(`\n${checks} checks, ${failures} failed${outDir ? `; WAV files in ${outDir}` : ''}`);
  console.log('Nobody has listened to this: the table says what a spectrum analyser hears, not whether it sounds good.');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
