// Dev tool: check the game's sound without ears.
//
//   node tools/soundtest.cjs http://localhost:4173/ [outDir]
//
// The game's own audio code is rendered offline against the game clock (see
// soundcap.cjs) while bots drive. Every sound the game asks for is written down
// with its time and its side, and then looked for in the rendered soundtrack:
// is the tone there, at that moment, on that side? It also checks the overall
// level, that nothing clips, that each split-screen driver's engine sits on
// their side, that solo play stays centred, and that mute is silent.
//
// What it cannot tell is whether any of it sounds *good*.
// With outDir the soundtracks are kept as WAV files to listen to.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const soundcap = require('./soundcap.cjs');

const base = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || '';
if (outDir) fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const RATE = soundcap.SAMPLE_RATE;
const dB = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const at = (sig, t) => Math.max(0, Math.min(sig.length, Math.round(t * RATE)));

function rms(sig, t0, t1) {
  const a = at(sig, t0);
  const b = at(sig, t1);
  let sum = 0;
  for (let i = a; i < b; i++) sum += sig[i] * sig[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** Amplitude of the tone at `f` Hz within a stretch of the signal (Hann window). */
function tone(sig, t0, t1, f, rate = RATE) {
  const a = Math.max(0, Math.round(t0 * rate));
  const b = Math.min(sig.length, Math.round(t1 * rate));
  const n = b - a;
  if (n < 8) return 0;
  const w = (2 * Math.PI * f) / rate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const s = sig[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    re += s * Math.cos(w * i);
    im -= s * Math.sin(w * i);
  }
  return (4 * Math.hypot(re, im)) / n;
}

/** 48 kHz -> 1 kHz by averaging: enough to look at engine notes. */
function decimate(sig) {
  const out = new Float32Array(Math.floor(sig.length / 48));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < 48; k++) s += sig[i * 48 + k];
    out[i] = s / 48;
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];

  /**
   * Bots drive for `seconds` of game time; returns the soundtrack and the list
   * of cues the game asked for: { name, t, args }.
   */
  const record = async (label, { query, width, height, seconds, during = '' }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await soundcap.install(context, seconds);
    const page = await context.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GL Driver')) problems.push(`[${label}] ${t}`);
    });
    page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
    await page.goto(base + query, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true && !!window.__bw', null, { timeout: 90000 });
    await page.evaluate(`(() => {
      const g = window.__bw.game;
      for (const v of g.views) v.racer.driver = v.auto;
      g.engine.onDraw = () => {}; // nothing on the canvas: the per-frame logic is what feeds the audio
      g.start(false);
      // Two bots of the same skill take every mark and every wave together, and
      // then their sounds cannot be told apart: hold the second one back a little.
      if (g.views[1]) g.views[1].racer.craft.speedFactor = 0.9;
    })()`);
    await soundcap.start(page);
    const info = await page.evaluate(`(() => {
      const g = window.__bw.game;
      const a = g.audio;
      const t0 = window.__audioCapture.t0;
      const cues = [];
      for (const name of ['countdown', 'go', 'pass', 'miss', 'lap', 'finish', 'splash']) {
        const original = a[name].bind(a);
        a[name] = (...args) => {
          cues.push({ name, t: g.engine.simTime - t0, args });
          return original(...args);
        };
      }
      const frames = Math.round(${seconds} * 60);
      for (let i = 0; i < frames; i++) {
        g.engine.advance(1 / 60, 1 / 60);
        ${during}
      }
      return { cues, pans: g.views.map((v) => v.pan), voices: a.voices.length };
    })()`);
    const sound = await soundcap.render(page);
    if (outDir) soundcap.writeWav(path.join(outDir, `sound_${label}.wav`), sound.pcm);
    await context.close();
    return { ...info, ...sound };
  };

  // ============================================================ split screen
  console.log('\n— split screen, side by side —');
  const split = await record('split', { query: '?mode=split&manual&dpr=1', width: 1280, height: 720, seconds: 45 });
  const { left: L, right: R, cues } = split;
  check('two drivers, two voices, one on each side', split.voices === 2 && split.pans[0] < -0.3 && split.pans[1] > 0.3, `pans ${split.pans.map((p) => p.toFixed(2)).join(' / ')}`);

  const go = cues.find((c) => c.name === 'go');
  const raceFrom = go ? go.t + 2 : 5;
  const level = dB(Math.hypot(rms(L, raceFrom, split.seconds), rms(R, raceFrom, split.seconds)) / Math.SQRT2);
  check('racing: the level is in a sensible range', level > -27 && level < -15, `${level.toFixed(1)} dBFS average`);
  check('nothing clips', split.peak < 0.89, `loudest sample ${dB(split.peak).toFixed(1)} dBFS`);
  const quiet = [];
  for (let t = Math.ceil(raceFrom); t + 1 <= split.seconds; t++) if (dB(rms(L, t, t + 1)) < -40 || dB(rms(R, t, t + 1)) < -40) quiet.push(t);
  check('racing: no second falls silent on either side', quiet.length === 0, quiet.length ? `quiet at ${quiet.join(', ')} s` : '');

  // the start signals belong to both drivers: centred
  const counts = cues.filter((c) => c.name === 'countdown');
  const beeps = counts.map((c) => ({ l: tone(L, c.t + 0.01, c.t + 0.11, 440), r: tone(R, c.t + 0.01, c.t + 0.11, 440), t: c.t }));
  check('start: three count beeps are heard, the same on both sides', beeps.length === 3 && beeps.every((b) => b.l > 0.04 && Math.abs(dB(b.l) - dB(b.r)) < 1), beeps.map((b) => `${b.t.toFixed(2)} s ${dB(b.l).toFixed(0)}/${dB(b.r).toFixed(0)} dB`).join(', '));
  const goL = go ? tone(L, go.t + 0.01, go.t + 0.25, 880) : 0;
  const goR = go ? tone(R, go.t + 0.01, go.t + 0.25, 880) : 0;
  check('start: GO is heard, the same on both sides, an octave up', goL > 0.06 && Math.abs(dB(goL) - dB(goR)) < 1, go ? `${go.t.toFixed(2)} s ${dB(goL).toFixed(0)}/${dB(goR).toFixed(0)} dB` : 'no GO cue');

  // each driver's engine on their side: on the grid both idle at the same revs,
  // so the two notes differ only by the second engine's higher pitch
  {
    const l = decimate(L);
    const r = decimate(R);
    const t0 = counts[1] ? counts[1].t + 0.3 : 1.3;
    const t1 = t0 + 0.65; // between two beeps
    const scan = [];
    for (let f = 45; f <= 90; f += 0.25) scan.push({ f, l: tone(l, t0, t1, f, 1000), r: tone(r, t0, t1, f, 1000) });
    const strongest = (list) => list.reduce((best, x) => (x.l + x.r > best.l + best.r ? x : best), list[0]);
    const first = strongest(scan);
    const second = strongest(scan.filter((x) => Math.abs(x.f - first.f) > 2.5));
    const [low, high] = first.f < second.f ? [first, second] : [second, first];
    const leanLow = dB(low.l) - dB(low.r);
    const leanHigh = dB(high.r) - dB(high.l);
    check('engines: player 1 idles on the left, player 2 a little higher on the right', leanLow > 6 && leanHigh > 6 && high.f / low.f > 1.03 && high.f / low.f < 1.12, `${low.f.toFixed(1)} Hz is ${leanLow.toFixed(1)} dB stronger on the left, ${high.f.toFixed(1)} Hz is ${leanHigh.toFixed(1)} dB stronger on the right`);
  }

  // each driver's mark chimes on their side
  const passes = cues.filter((c) => c.name === 'pass');
  const alone = passes.filter((c) => !passes.some((o) => o !== c && Math.abs(o.t - c.t) < 0.4));
  let leftOk = 0;
  let rightOk = 0;
  let leftN = 0;
  let rightN = 0;
  const worst = { lean: Infinity };
  for (const c of alone) {
    const pan = c.args[1] || 0;
    const l = tone(L, c.t + 0.005, c.t + 0.1, 660);
    const r = tone(R, c.t + 0.005, c.t + 0.1, 660);
    const lean = pan < 0 ? dB(l) - dB(r) : dB(r) - dB(l);
    const heard = Math.max(l, r) > 0.03;
    if (lean < worst.lean) Object.assign(worst, { lean, t: c.t });
    if (pan < 0) {
      leftN++;
      if (heard && lean > 6) leftOk++;
    } else if (pan > 0) {
      rightN++;
      if (heard && lean > 6) rightOk++;
    }
  }
  check('chimes: there are clean passes by both drivers to listen for', leftN >= 2 && rightN >= 2, `${passes.length} passes, ${alone.length} not overlapping (${leftN} player 1, ${rightN} player 2)`);
  check('chimes: each is heard, on the side of the driver who made the pass', leftOk === leftN && rightOk === rightN, `player 1 ${leftOk}/${leftN} left, player 2 ${rightOk}/${rightN} right; weakest lean ${worst.lean.toFixed(1)} dB at ${worst.t === undefined ? '-' : worst.t.toFixed(1)} s`);

  // landings: a burst of noise and a thump, on the side of the driver who landed.
  // Judged on the hard ones that have the moment to themselves, by how the
  // balance between the sides shifts when they hit.
  {
    const splashes = cues.filter((c) => c.name === 'splash');
    const others = cues.filter((c) => c.name !== 'splash');
    const hard = splashes.filter((c) => (c.args[0] || 0) > 0.5 && (c.args[1] || 0) !== 0 && !others.some((o) => Math.abs(o.t - c.t) < 0.5) && !splashes.some((o) => o !== c && Math.abs(o.t - c.t) < 0.12));
    let ok = 0;
    let quietest = Infinity;
    for (const c of hard) {
      const balance = (t0, t1) => dB(rms(L, t0, t1)) - dB(rms(R, t0, t1));
      const shift = balance(c.t + 0.01, c.t + 0.14) - balance(c.t - 0.15, c.t - 0.01);
      const side = c.args[1] < 0 ? L : R;
      const rise = dB(rms(side, c.t + 0.01, c.t + 0.14)) - dB(rms(side, c.t - 0.15, c.t - 0.01));
      quietest = Math.min(quietest, rise);
      if ((c.args[1] < 0 ? shift : -shift) > 2 && rise > 3) ok++;
    }
    check('splashes: there are hard landings to listen for', hard.length >= 3, `${splashes.length} splashes, ${hard.length} hard and alone`);
    check('splashes: a hard landing stands out over the engine, on the side of the driver who landed', hard.length > 0 && ok >= Math.ceil(hard.length * 0.8), `${ok} of ${hard.length}; the quietest still ${quietest.toFixed(1)} dB over what was playing`);
  }

  // ==================================================================== solo
  console.log('\n— solo —');
  const solo = await record('solo', { query: '?manual&dpr=1', width: 1280, height: 720, seconds: 20 });
  let apart = 0;
  for (let i = 0; i < solo.left.length; i++) apart = Math.max(apart, Math.abs(solo.left[i] - solo.right[i]));
  const soloGo = solo.cues.find((c) => c.name === 'go');
  const soloLevel = dB(rms(solo.left, (soloGo ? soloGo.t : 3) + 2, solo.seconds));
  check('one driver, one voice, in the middle', solo.voices === 1 && solo.pans[0] === 0 && apart < 1e-4, `left and right differ by at most ${apart.toExponential(1)}`);
  check('solo is about as loud as split screen', Math.abs(soloLevel - level) < 3 && solo.peak < 0.89, `${soloLevel.toFixed(1)} dBFS average (split screen ${level.toFixed(1)}), loudest sample ${dB(solo.peak).toFixed(1)} dBFS`);

  // ================================================ split screen, upright phone
  console.log('\n— split screen, one view above the other —');
  const stacked = await record('stacked', { query: '?mode=split&manual&dpr=1', width: 720, height: 1280, seconds: 12 });
  apart = 0;
  for (let i = 0; i < stacked.left.length; i++) apart = Math.max(apart, Math.abs(stacked.left[i] - stacked.right[i]));
  check('no left and right to speak of: both drivers in the middle', stacked.voices === 2 && stacked.pans.every((p) => p === 0) && apart < 1e-4, `pans ${stacked.pans.join(' / ')}, sides differ by at most ${apart.toExponential(1)}`);

  // ==================================================================== mute
  console.log('\n— mute —');
  const muted = await record('mute', { query: '?mode=split&manual&dpr=1', width: 1280, height: 720, seconds: 10, during: 'if (i === 6 * 60) a.setMuted(true);' });
  const before = dB(rms(muted.left, 4.5, 5.9));
  const after = dB(rms(muted.left, 7, 10));
  check('sound off means silence', before > -40 && after < -70, `${before.toFixed(0)} dBFS before, ${after.toFixed(0)} dBFS after`);

  check('no console errors', problems.length === 0, problems.slice(0, 4).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
