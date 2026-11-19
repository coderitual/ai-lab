// Dev tool: stills of the sea lab (sealab.html: the water alone under the game's light), several views from one
// page load, so that a round of work on the water's shader costs one start-up and a few seconds a view.
//
//   node tools/sealab.cjs --base http://localhost:5190 --out shots --views views.json
//   options: --q medium --sea mobile --shed --land toy|real --time day --w 960 --h 540 --prefix lab --only name1,name2 --mobile
//
// views.json: [{ "name": "beach", "eye": [x, y, z], "at": [x, y, z] (or "sunward": -4), "fov": 50, "t": 12, "time": "day",
//               "read": { "surf": [480, 300] } }, ...]
// A view's `time` (default --time) picks the time of day and its `look` other numbers for SEA_LOOK (sealab.js,
// ?look=): the page is loaded once per pair used (give such views names of their own). `t` is the waves' clock (it
// only runs forward: list a page's views in the order of their clocks). `read`: named
// CSS pixels whose 8-bit colour is printed (a 5 x 5 mean), for tables.
//
// Requires Playwright to be available to Node (it is not a project dependency). The page's errors are printed:
// a shader that does not compile shows here.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[argv[i].slice(2)] = true;
    else args[argv[i++].slice(2)] = next;
  }
  return args;
}

(async () => {
  const a = parseArgs(process.argv);
  if (!a.base || !a.views) {
    console.log('usage: node tools/sealab.cjs --base URL --views views.json [--out dir] [--q medium] [--land toy] [--time day] [--w 960] [--h 540]');
    process.exit(1);
  }
  const out = a.out || '.';
  const prefix = a.prefix || 'lab';
  const only = a.only ? String(a.only).split(',') : null;
  const views = JSON.parse(fs.readFileSync(a.views, 'utf8')).filter((v) => !only || only.includes(v.name));
  // one page per time of day and set of numbers used
  const pageOf = (v) => JSON.stringify([v.time || a.time || 'day', v.look || null]);
  const pages = [...new Set(views.map(pageOf))];
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width: parseInt(a.w || 960, 10), height: parseInt(a.h || 540, 10) },
    deviceScaleFactor: 1,
    isMobile: !!a.mobile,
    hasTouch: !!a.mobile,
  });
  let failed = false;
  for (const key of pages) {
    const [time, look] = JSON.parse(key);
    const page = await context.newPage();
    page.setDefaultTimeout(600000);
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      if (m.text().includes('GPU stall due to ReadPixels')) return;
      failed = failed || m.type() === 'error';
      console.log(`[${m.type()}] ${m.text().slice(0, 3000)}`);
    });
    page.on('pageerror', (e) => {
      failed = true;
      console.log(`[pageerror] ${e.message}`);
    });
    const started = Date.now();
    await page.goto(`${a.base}/sealab.html?manual&q=${a.q || 'medium'}&land=${a.land || 'toy'}${a.sea ? `&sea=${a.sea}` : ''}${a.shed ? '&shed=1' : ''}&time=${time}${look ? `&look=${encodeURIComponent(JSON.stringify(look))}` : ''}`);
    await page.waitForFunction('window.__ready === true');
    console.log(`${time}: ready in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const view of views.filter((v) => pageOf(v) === key)) {
      const t0 = Date.now();
      const read = await page.evaluate((v) => {
        window.__sealab.view(v.sunward === undefined ? { eye: v.eye, at: v.at, fov: v.fov || 50 } : { eye: v.eye, sunward: v.sunward, fov: v.fov || 50 });
        window.__sealab.clock(v.t || 0);
        const said = {};
        for (const [name, at] of Object.entries(v.read || {})) said[name] = window.__sealab.read(at[0], at[1], 2);
        window.__sealab.engine.advance(0);
        return said;
      }, view);
      const file = path.join(out, `${prefix}-${view.name}${view.time ? `-${time}` : ''}.png`);
      await page.screenshot({ path: file });
      console.log(`${file} (${((Date.now() - t0) / 1000).toFixed(1)} s)${Object.keys(read).length ? ` ${JSON.stringify(read)}` : ''}`);
    }
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 2 : 0);
})();
