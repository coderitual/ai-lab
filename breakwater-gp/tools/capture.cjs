// Dev tool: drive the game deterministically in headless Chromium and capture
// stills or a frame-accurate recording (the game is stepped, not timed, so the
// result does not depend on how fast software WebGL renders).
//
//   stills:  node tools/capture.cjs --url "http://localhost:5173/?auto&ap&manual&dpr=1" --at 1,4.5,9,20 --out shots/race
//   video:   node tools/capture.cjs --url "…" --from 3 --seconds 8 --fps 30 --out shots/clip   (then ffmpeg -i clip_%04d.jpg)
//   options: --w 1280 --h 720 --dpr 1 --mobile --landscape/--portrait handled by w/h, --stats
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

  const shot = (file) => page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  let now = 0;

  if (a.at) {
    for (const t of String(a.at).split(',').map(Number)) {
      const dt = Math.max(0, t - now);
      // fast-forward, then draw the last moments so the camera has settled
      const settle = Math.min(dt, 0.8);
      await page.evaluate(`window.__bw.skip(${dt - settle})`);
      if (settle > 0) await page.evaluate(`window.__bw.advance(${settle}, 30)`);
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
    for (let i = 0; i < frames; i++) {
      await page.evaluate(`window.__bw.advance(${1 / fps}, ${fps})`);
      await shot(`${out}_${String(i).padStart(4, '0')}.jpg`);
    }
    console.log('saved', frames, 'frames to', `${out}_%04d.jpg`);
    if (a.stats) console.log(JSON.stringify(await page.evaluate(STATS)));
  }
  if (problems.length) console.log(problems.slice(0, 20).join('\n'));
  await browser.close();
})();
