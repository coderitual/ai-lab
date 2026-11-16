// Dev tool: take a screenshot of a page with headless Chromium (software WebGL).
//
//   node tools/shot.cjs --url "http://localhost:5180/?manual&t=3" --out swan.png
//   options: --w 1280 --h 720 --dpr 1 --wait 300 --mobile
//            --eval "js to run before the shot"   (its result, if any, is printed)
//            --resize 1280x720   change the viewport after loading, then shoot
//
// The page is ready when it sets window.__ready. With ?manual nothing moves
// between frames, so the same URL and --eval always give the same picture.
// Console errors and warnings of the page are printed.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

(async () => {
  const a = parseArgs(process.argv);
  const width = parseInt(a.w || 1280, 10);
  const height = parseInt(a.h || 720, 10);
  const out = a.out || 'shot.png';
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: parseFloat(a.dpr || 1),
    isMobile: !!a.mobile,
    hasTouch: !!a.mobile,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Headless Chromium without a GPU reads every WebGL canvas back to put it
    // on the page, and its driver remarks on that. It happens for an empty
    // canvas too; it says nothing about the page.
    if (m.text().includes('GPU stall due to ReadPixels')) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(a.url, { waitUntil: 'load' });
  // software rendering is slow: a first frame with ?t= can take a while
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 }).catch(() => problems.push('timeout waiting for __ready'));
  if (a.resize) {
    const [w, h] = String(a.resize).split('x').map((v) => parseInt(v, 10));
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
  }
  if (a.eval) {
    const result = await page.evaluate(a.eval).catch((e) => problems.push(`[eval] ${e.message}`));
    if (result !== undefined && typeof result !== 'number') console.log(typeof result === 'string' ? result : JSON.stringify(result));
  }
  await page.waitForTimeout(parseInt(a.wait || 300, 10));
  await page.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: out.endsWith('.jpg') ? 88 : undefined });
  // the same complaint a hundred times is one complaint
  const unique = [...new Set(problems)];
  if (unique.length) console.log(unique.slice(0, 30).join('\n'));
  console.log('saved', out);
  await browser.close();
})();
