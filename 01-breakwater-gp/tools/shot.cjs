// Dev tool: take a screenshot of a page with headless Chromium (software WebGL).
//
//   node tools/shot.cjs --url "http://localhost:5173/viewer.html?asset=sea" --out sea.png
//   options: --w 1280 --h 720 --dpr 1 --wait 800 --mobile --eval "js to run before the shot"
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
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(a.url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => problems.push('timeout waiting for __ready'));
  if (a.eval) await page.evaluate(a.eval);
  await page.waitForTimeout(parseInt(a.wait || 600, 10));
  await page.screenshot({ path: a.out || 'shot.png', type: (a.out || '').endsWith('.jpg') ? 'jpeg' : 'png', quality: (a.out || '').endsWith('.jpg') ? 88 : undefined });
  if (problems.length) console.log(problems.slice(0, 30).join('\n'));
  console.log('saved', a.out || 'shot.png');
  await browser.close();
})();
