// Dev tool: regenerate every picture the README and the docs use.
//
//   npm run dev                                    (in another terminal: http://localhost:5190/)
//   node tools/screenshots.cjs                     all of them, into docs/images/ (and public/og.jpg)
//   node tools/screenshots.cjs --only night,tunnel some page loads or single pictures (see --list)
//   node tools/screenshots.cjs --list              what there is
//   options: --base http://localhost:5190/   --out docs/images   --q medium
//
// Every picture is made the same way each time: the page is stepped, not timed (?manual), its random numbers are
// seeded (?seed=1), the autopilot drives (?ap), the moments are distances along the run and the cameras are the
// staging camera's poses (__dreamcar.photo: metres behind, right of and above the car, degrees left and up, the
// lens). Nothing depends on how fast this machine is. So after a visual change, run this, look at what it made
// and commit it: the pictures cannot go stale. If a staged camera no longer frames its subject (the road was
// moved, the car changed), fix the pose here.
//
// The world takes a minute or two to build on software WebGL, so each page load makes several pictures: one load
// per time of day and one per kind of screen. Pictures are drawn at their own size (no supersampling: the medium
// tier's multisampling and its anti-aliasing are what a player sees), as JPEG.
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
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
  }
  return args;
}

const WIDE = { w: 1280, h: 720 };
const CARD = { w: 1200, h: 630 }; // the shape of a link preview
const PHONE = { w: 390, h: 844, dpr: 2, mobile: true }; // a phone held upright

// The page loads, in order. Each has a window size, a query (added to ?manual&seed=1&q=...) and its pictures,
// taken in the order given; a picture's moment only ever moves the run forward.
//   start   true: press Drive (the title's button) before this picture; the run begins with its countdown
//   dist    run the steps until the first car has covered this many metres of the run (the line is at 0; the
//           lap is the Track's length, printed by tools/trackmap.mjs)
//   skip    run the steps this many seconds further
//   photo   the staging camera's pose { back, right, up, yaw, pitch, fov } (null: the game's own camera, HUD on)
//   shutter with a photo: the share of the game's motion-blur shutter (default 0.2: the staged camera rides with
//           the car, so at the game's shutter the whole world would streak past it)
//   size    a different window size for this picture (the page lays itself out again)
//   out     a file of its own instead of docs/images/<name>.jpg
const LOADS = [
  {
    name: 'day',
    size: WIDE,
    query: 'time=day&ap',
    shots: [
      { name: 'title', caption: 'The title by day: the hero picture behind the menu' },
      // the grid, at rest, before Drive: the car on its slot under the gantry, the sun beyond it down the straight
      {
        name: 'car-front',
        photo: { back: -5.6, right: 3.4, up: 0.9, yaw: 151, pitch: -2, fov: 34 },
        caption: 'The car, three-quarter front, on the grid by day',
      },
      {
        name: 'car-rear',
        photo: { back: 5.8, right: -3.2, up: 1.1, yaw: -29, pitch: -4, fov: 34 },
        caption: 'Three-quarter rear, into the sun',
      },
      // the golden wood (config.js PHOTOS.r3's camera and moment; design.md, "The golden wood"): the car is behind it
      {
        name: 'golden-wood',
        start: true,
        dist: 869,
        photo: { back: -6, right: -2.2, up: 1.45, yaw: -26, pitch: 5, fov: 50 },
        shutter: 0.1,
        caption: 'The golden wood: the forest esses between walls of turned broadleaves',
      },
      // the approach to the tunnel from photograph R1's camera (PHOTOS.r1 in game/config.js): the car is behind it
      {
        name: 'approach',
        dist: 1379,
        photo: { back: -6, right: 3.2, up: 1.3, yaw: -17, pitch: 6, fov: 36 },
        caption: 'The approach to the tunnel: a meadow, and the portal set into the hillside',
      },
      { name: 'tunnel', dist: 1640, caption: 'In the tunnel: a lit bore of 349 m with a gentle right-hand bend' },
      {
        name: 'sky-road',
        dist: 2240,
        photo: { back: 45, right: 18, up: 24, yaw: 8, pitch: -20, fov: 55 },
        caption: 'The sky road: a left-hand bend of 576 m on piers, 42 m over the valley',
      },
      // the lakeside (config.js PHOTOS.r2's camera and moment; design.md, "The lakeside")
      {
        name: 'lakeside',
        dist: 2664,
        photo: { back: 24, right: -2, up: 1.45, yaw: 5, pitch: 0, fov: 52 },
        shutter: 0.1,
        caption: 'The lakeside: out of the sky road above the tarn, the far range beyond it',
      },
      {
        name: 'carousel',
        dist: 2800,
        photo: { back: 10, right: -25, up: 40, yaw: -60, pitch: -50, fov: 60 },
        caption: 'The carousel: the slow corner, 190 degrees round a radius of 55 m',
      },
      { name: 'chase', dist: 10010, caption: 'The chase view at speed on the straight, driving into the sun' },
      { name: 'og', dist: 10050, size: CARD, out: 'public/og.jpg', caption: 'Link preview' },
    ],
  },
  {
    name: 'dusk',
    size: WIDE,
    query: 'time=dusk&ap',
    shots: [
      {
        name: 'grid-dusk',
        start: true,
        skip: 4.6,
        photo: { back: 7.5, right: 1.6, up: 0.75, yaw: 4, pitch: 9, fov: 52 },
        caption: 'Golden hour: on the grid under the gantry while the start lamps count',
      },
    ],
  },
  {
    name: 'night',
    size: WIDE,
    query: 'time=night&ap',
    shots: [{ name: 'night', start: true, dist: 4880, caption: 'The wet night: the end of the lap, onto the lit straight' }],
  },
  {
    name: 'split',
    size: WIDE,
    query: 'time=day&ap&mode=split',
    shots: [{ name: 'split', start: true, dist: 900, caption: 'Two players on one screen, through the forest esses' }],
  },
  {
    name: 'phone',
    size: PHONE,
    // (finish lane) the tier a recent iPhone gets (caps.js), which is what the owner plays on
    query: 'time=day&q=medium',
    shots: [{ name: 'phone', start: true, skip: 9, hands: true, caption: 'On a phone held upright: the touch controls' }],
  },
];

(async () => {
  const a = parseArgs(process.argv);
  if (a.list) {
    for (const load of LOADS) {
      console.log(`${load.name}: ?${load.query}`);
      for (const s of load.shots) console.log(`  ${s.name.padEnd(12)} ${s.caption}`);
    }
    return;
  }
  const root = path.join(__dirname, '..');
  const base = String(a.base || 'http://localhost:5190/').replace(/\/?$/, '/');
  const outDir = path.resolve(root, a.out || 'docs/images');
  const q = a.q || 'medium';
  const only = typeof a.only === 'string' ? a.only.split(',') : null;
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];
  const began = Date.now();
  const secs = (t) => `${((Date.now() - t) / 1000).toFixed(0)} s`;

  for (const load of LOADS) {
    if (only && !only.includes(load.name) && !load.shots.some((s) => only.includes(s.name))) continue;
    const t0 = Date.now();
    const size = load.size;
    const context = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: size.dpr || 1,
      isMobile: !!size.mobile,
      hasTouch: !!size.mobile,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(900000);
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) problems.push(`${load.name}: [${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${load.name}: [pageerror] ${e.message}`));
    // a page's own query wins over the tool's tier (the phone asks for what a phone gets)
    const query = /(^|&)q=/.test(load.query) ? load.query : `q=${q}&${load.query}`;
    // the page builds its whole world before 'load' fires: wait for it to say it has drawn instead
    await page.goto(`${base}?manual&seed=1&${query}`, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 900000 });
    await page.evaluate(async () => {
      const h = window.__dreamcar;
      // the game's shutter (VIEW in config.js), so that a staged camera riding with a fast car can shorten it: the
      // same module instance the game reads (the dev server serves it by its path; a build has no such path, and
      // its staged pictures keep the game's shutter)
      try {
        h.view = (await import(new URL('src/game/config.js', location.href).href)).VIEW;
        h.shutter = [h.view.motionBlurSlow, h.view.motionBlur];
      } catch {
        h.view = null;
      }
      // the steps without drawing, until the first car has covered `dist` m of the run or `seconds` have gone
      h.runTo = (dist, seconds) => {
        const e = h.engine;
        const steps = seconds != null ? Math.round(seconds * 60) : 60 * 600;
        for (let i = 0; i < steps; i++) {
          if (dist != null && i % 15 === 0 && h.state().drivers[0].dist >= dist) break;
          e.advance(e.paused ? 0 : 1 / 60, 1 / 60, false);
        }
      };
    });
    console.log(`${load.name}: page ready in ${secs(t0)}`);

    for (const shot of load.shots) {
      const t1 = Date.now();
      // a picture not asked for still moves the run on, so that the others are taken at their own moments
      if (only && !only.includes(load.name) && !only.includes(shot.name)) {
        await page.evaluate(({ shot }) => {
          const h = window.__dreamcar;
          if (shot.start) h.game.start();
          if (shot.skip) h.runTo(null, shot.skip);
          if (shot.dist != null) h.runTo(shot.dist);
        }, { shot });
        continue;
      }
      if (shot.size) await page.setViewportSize({ width: shot.size.w, height: shot.size.h });
      await page.evaluate(
        ({ shot }) => {
          const h = window.__dreamcar;
          if (shot.start) h.game.start();
          if (shot.skip) h.runTo(null, shot.skip);
          if (shot.dist != null) h.runTo(shot.dist);
          // a staged camera moves with the car: at the game's shutter everything but the car would be a smear
          if (h.view) {
            const k = shot.photo ? (shot.shutter ?? 0.2) : 1;
            h.view.motionBlurSlow = h.shutter[0] * k;
            h.view.motionBlur = h.shutter[1] * k;
          }
          h.photo(shot.photo || null);
          // a frame drawn twice: the first after a cut fills the blur's history and the probe's faces
          h.engine.advance(0);
          h.engine.advance(1 / 60);
        },
        { shot },
      );
      // the touch controls are shown once a finger has been seen: put one down on the steering side and lift it
      if (shot.hands) {
        await page.touchscreen.tap(size.w * 0.2, size.h * 0.8);
        await page.evaluate(() => window.__dreamcar.engine.advance(0));
      }
      const file = shot.out ? path.resolve(root, shot.out) : path.join(outDir, `${shot.name}.jpg`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
      const where = await page.evaluate(() => {
        const d = window.__dreamcar.state().drivers[0];
        return `s ${Math.round(d.s)} m, ${Math.round(d.kmh)} km/h`;
      });
      console.log(`  ${path.relative(root, file).padEnd(30)} ${shot.caption} (${where}; ${secs(t1)})`);
    }
    await context.close();
  }
  await browser.close();
  console.log(`done in ${secs(began)}`);
  if (problems.length) {
    const unique = [...new Set(problems)];
    console.log(`\n${unique.length} problem(s) on the console:\n${unique.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
})();
