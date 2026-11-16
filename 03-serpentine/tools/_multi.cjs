// Scratch: one page load, several views. usage: node multi.cjs URL OUTDIR PREFIX 'JSON list of [name, viewChange, evalAfter?]' [w] [h]
const { chromium } = require('playwright');
(async () => {
  const [url, outDir, prefix, listJson, w = '960', h = '540'] = process.argv.slice(2);
  const list = JSON.parse(listJson);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })).newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (m.text().includes('GPU stall due to ReadPixels')) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 240000 }).catch(() => problems.push('timeout'));
  console.log('ready in', Date.now() - t0, 'ms');
  for (const [name, change, after] of list) {
    if (change) await page.evaluate((c) => { window.__viewer.view(c); }, change);
    if (after) {
      const r = await page.evaluate(after).catch((e) => `eval error: ${e.message}`);
      if (r !== undefined) console.log(name, typeof r === 'string' ? r : JSON.stringify(r));
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}/${prefix}${name}.png` });
    console.log('saved', `${outDir}/${prefix}${name}.png`);
  }
  console.log([...new Set(problems)].slice(0, 20).join('\n'));
  await browser.close();
})();
