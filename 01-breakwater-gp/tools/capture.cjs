// Dev tool: drive the game deterministically in headless Chromium and capture
// stills or a frame-accurate recording (the game is stepped, not timed, so the
// result does not depend on how fast software WebGL renders).
//
//   stills:  node tools/capture.cjs --url "http://localhost:5173/?auto&ap&manual&dpr=1" --at 1,4.5,9,20 --out shots/race
//   video:   node tools/capture.cjs --url "…" --from 3 --seconds 8 --fps 30 --out shots/clip   (then ffmpeg -i clip_%04d.jpg)
//   with sound, straight to a file (needs ffmpeg):
//            node tools/capture.cjs --url "http://localhost:4173/?mode=split&manual&dpr=1" --ride --seconds 30 --out clip/f --sound --mp4 clip/split.mp4
//   options: --w 1280 --h 720 --dpr 1 --mobile --landscape/--portrait handled by w/h, --stats
//            --ride        bots ride every craft on this machine (riders keep their names) and the race starts
//            --sound       also write <out>.wav: the game's own sound, in step with the frames
//            --sound-only  the sound without the frames (quick)
//            --mp4 FILE    join the frames and the sound into an H.264 / AAC file
//
// Sound cannot be recorded off the speakers here (frames take far longer to
// draw than to play): see soundcap.cjs for how it is done instead.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const soundcap = require('./soundcap.cjs');

// Runs in the page before the game: the same "random" numbers on every run, so
// that a recording can be repeated exactly (to redo its sound, or a stretch of
// its frames).
const SEEDED_RANDOM = `(() => {
  let s = 0x2f6e2b1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})()`;

// CSS animations and transitions (the countdown banner, fades) run on the wall
// clock, and a captured frame takes far longer than a frame lasts: hold them
// and move them on with the game instead.
const stepAnimations = (ms) => `(() => {
  const held = (window.__heldAnimations ||= new WeakMap());
  for (const a of document.getAnimations()) {
    try {
      const t = (held.has(a) ? held.get(a) : 0) + ${ms};
      if (!held.has(a)) a.pause();
      held.set(a, t);
      a.currentTime = t;
    } catch {
      /* an animation that went away between the two lines */
    }
  }
})()`;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const STATS = `(() => {
  const g = window.__bw.game;
  const r = g.race;
  const p = r.player;
  return {
    state: r.state, phase: g.phase, time: +r.time.toFixed(2),
    racers: r.racers.map((x) => ({ n: x.name, rank: x.rank, lap: x.lap, s: Math.round(x.s), total: Math.round(x.totalS), lat: +x.lateral.toFixed(1),
      kmh: Math.round(x.craft.speed * 3.6), pw: x.craft.power, miss: x.misses, gate: x.nextGate, air: x.craft.airborne, fin: x.finished ? +x.finishTime.toFixed(2) : null, laps: x.lapTimes.map((t) => +t.toFixed(2)) })),
  };
})()`;

(async () => {
  const a = parseArgs(process.argv);
  const width = parseInt(a.w || 1280, 10);
  const height = parseInt(a.h || 720, 10);
  const out = a.out || 'capture';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: parseFloat(a.dpr || 1),
    isMobile: !!a.mobile,
    hasTouch: !!a.mobile,
    userAgent: a.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' : undefined,
  });
  await context.addInitScript(SEEDED_RANDOM);
  const sound = !!(a.sound || a['sound-only'] || a.mp4);
  const frameless = !!a['sound-only'];
  if (sound) {
    if (a.at) throw new Error('--sound goes with a recording (--seconds), not with stills (--at)');
    await soundcap.install(context, parseFloat(a.seconds || 5));
  }
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    const t = m.text();
    if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GL Driver')) problems.push(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(a.url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true && !!window.__bw', null, { timeout: 90000 });
  if (a.eval) await page.evaluate(a.eval);
  if (a.ride) {
    await page.evaluate(`(() => {
      const g = window.__bw.game;
      for (const v of g.views) v.racer.driver = v.auto;
      g.start(false);
    })()`);
  }
  // sound only: keep the per-frame logic (it feeds the audio) but put nothing on the canvas
  if (frameless) await page.evaluate('window.__bw.game.engine.onDraw = () => {}');

  // software WebGL can lag far behind the script: give the frame time to arrive
  const shot = (file) => page.screenshot({ path: file, type: 'jpeg', quality: 90, timeout: 180000 });
  let now = 0;

  if (a.at) {
    for (const t of String(a.at).split(',').map(Number)) {
      const dt = Math.max(0, t - now);
      // fast-forward, then draw the last moments so the camera has settled
      const settle = Math.min(dt, 0.8);
      await page.evaluate(`window.__bw.skip(${dt - settle})`);
      if (settle > 0) await page.evaluate(`window.__bw.advance(${settle}, 12)`);
      now = t;
      const file = `${out}_${String(t).replace('.', 'p')}.jpg`;
      await page.waitForTimeout(350); // let CSS transitions settle
      await shot(file);
      console.log('saved', file);
      if (a.stats) console.log(JSON.stringify(await page.evaluate(STATS)));
    }
  } else {
    const from = parseFloat(a.from || 0);
    const seconds = parseFloat(a.seconds || 5);
    const fps = parseInt(a.fps || 30, 10);
    if (from > 0) await page.evaluate(`window.__bw.skip(${from})`);
    const frames = Math.round(seconds * fps);
    if (sound) await soundcap.start(page);
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      await page.evaluate(`window.__bw.advance(${1 / fps}, ${fps})`);
      if (!frameless) {
        await page.evaluate(stepAnimations(1000 / fps));
        await shot(`${out}_${String(i).padStart(4, '0')}.jpg`);
      }
      if (a.progress && i % 60 === 59) console.log(`frame ${i + 1}/${frames}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    if (!frameless) console.log('saved', frames, 'frames to', `${out}_%04d.jpg`);
    if (a.stats) console.log(JSON.stringify(await page.evaluate(STATS)));

    if (sound) {
      const rendered = await soundcap.render(page);
      const wav = `${out}.wav`;
      soundcap.writeWav(wav, rendered.pcm);
      console.log('saved', wav, `(${rendered.seconds.toFixed(2)} s, peak ${rendered.peak.toFixed(3)})`);
      if (a.mp4 && !frameless) {
        const r = spawnSync(
          'ffmpeg',
          ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${out}_%04d.jpg`, '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(a.crf || 21), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', a.mp4],
          { stdio: 'inherit' },
        );
        if (r.error || r.status !== 0) console.log('ffmpeg did not produce the file:', r.error ? r.error.message : `exit ${r.status}`);
        else console.log('saved', a.mp4);
      }
    }
  }
  if (problems.length) console.log(problems.slice(0, 20).join('\n'));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
