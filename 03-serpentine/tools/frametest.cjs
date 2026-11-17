// Dev tool: checks of the frame pipeline that need numbers rather than eyes.
//
//   node tools/frametest.cjs                       the tone curve's own numbers (no browser)
//   node tools/frametest.cjs --url "http://localhost:5191/?manual&auto&ap&t=6&time=dusk&q=medium&ui=0" \
//        --frames 6 --vary "ao=0|ao=1"            milliseconds per frame, for each variant of the URL
//        --pair out.png                            also: two frames 1/60 s apart, and how much they differ
//        --w 960 --h 540
//
// Timing: each frame is stepped with __serp.advance(1/60) (or __viewer.frames(1)), then one pixel is read back
// so that the time includes the GPU's work; the first frame after loading is not counted (it compiles shaders).
// Console errors and warnings of the page are printed and make the exit code 1.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
  }
  return args;
}

async function toneCheck() {
  const { toneResponse, TONE } = await import(path.join(__dirname, '../src/engine/glsl.js'));
  const grey = toneResponse(0.18);
  const ok = Math.abs(grey - 0.18) < 1e-4;
  console.log(`tone curve: 0.18 -> ${grey.toFixed(5)} (gain ${TONE.gain}) ${ok ? 'ok' : 'WRONG: work out TONE.gain again'}`);
  console.log(`            1 -> ${toneResponse(1).toFixed(3)}, 4 -> ${toneResponse(4).toFixed(3)}, 16 -> ${toneResponse(16).toFixed(3)}`);
  return ok;
}

async function pageRun(browser, url, a, problems) {
  const width = parseInt(a.w || 960, 10);
  const height = parseInt(a.h || 540, 10);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(900000);
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall due to ReadPixels')) {
      problems.push(`[${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true);
  const frames = parseInt(a.frames || 5, 10);
  const times = await page.evaluate(async (n) => {
    const step = () => (window.__serp ? window.__serp.advance(1 / 60) : window.__viewer.frames(1));
    const engine = window.__serp ? window.__serp.engine : window.__viewer.engine;
    const gl = engine.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    step();
    sync();
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      step();
      sync();
      out.push(performance.now() - t0);
    }
    return out;
  }, frames);
  let stats = null;
  try {
    stats = await page.evaluate(() => (window.__serp ? window.__serp.stats().pipeline : window.__viewer.pipeline.stats()));
  } catch {
    stats = null;
  }
  let pair = null;
  if (a.pair) {
    const first = await page.screenshot();
    await page.evaluate(() => (window.__serp ? window.__serp.advance(1 / 60) : window.__viewer.frames(1)));
    const second = await page.screenshot();
    pair = { first, second };
  }
  await context.close();
  return { times, stats, pair };
}

function median(values) {
  const v = [...values].sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
}

(async () => {
  const a = parseArgs(process.argv);
  const toneOk = await toneCheck();
  if (!a.url) process.exit(toneOk ? 0 : 1);

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];
  const variants = a.vary ? String(a.vary).split('|') : [''];
  for (const variant of variants) {
    const url = variant ? `${a.url}&${variant}` : a.url;
    const { times, stats, pair } = await pageRun(browser, url, a, problems);
    console.log(`${variant || '(as given)'}: median ${median(times).toFixed(0)} ms per frame  [${times.map((t) => t.toFixed(0)).join(' ')}]`);
    if (stats) console.log(`  passes ${stats.passes}, targets ${JSON.stringify(stats.targets)}`);
    if (pair) {
      const base = String(a.pair).replace(/\.png$/, '');
      const tag = variant.replace(/[^a-z0-9]+/gi, '_') || 'page';
      fs.writeFileSync(`${base}-${tag}-1.png`, pair.first);
      fs.writeFileSync(`${base}-${tag}-2.png`, pair.second);
      console.log(`  two frames 1/60 s apart: ${base}-${tag}-1.png, -2.png`);
    }
  }
  await browser.close();
  for (const p of problems) console.log(p);
  process.exit(toneOk && problems.length === 0 ? 0 : 1);
})();
