// Dev tool: regenerate every picture the README and the docs use.
//
//   npm run dev                                    (in another terminal: http://localhost:5180)
//   node tools/screenshots.cjs                     all of them, into docs/images/ (and public/og.jpg)
//   node tools/screenshots.cjs --only hero,film    some of them
//   node tools/screenshots.cjs --list              what there is
//   options: --base http://localhost:5180/   --out docs/images   --q high
//
// Every picture is made the same way each time: the scene is stepped, not
// timed (?manual), its random numbers are seeded, and the moment and the
// camera are in the URL. Pictures are drawn at twice their size and scaled
// down, which is the cheapest good anti-aliasing there is. So after a visual
// change, run this and commit what changed: the pictures cannot go stale.
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

const TALL = { w: 450, h: 800 }; // the film's shape: a phone held upright
const WIDE = { w: 1280, h: 720 };
const CARD = { w: 1200, h: 630 }; // the shape of a link preview
const PHONE = { w: 390, h: 844, mobile: true };
const PHONE_SIDE = { w: 844, h: 390, mobile: true };

// What to make.
//   query   added to ?manual&seed=1&q=...  (t= is seconds into the film)
//   ui      keep the controls in the picture
//   eval    script run in the page before the picture is taken
//   strip   several moments side by side in one picture: [query, ...]
const SHOTS = [
  { name: 'hero', size: TALL, query: 't=1.27', caption: 'The shake, 1.3 s into the film' },
  { name: 'film', size: { w: 300, h: 534 }, strip: ['t=0.3', 't=1.3', 't=3.8', 't=5.2', 't=7.5', 't=10.6'], caption: 'The film: drips, the shake, the turn, the dunk, up again, the reach' },
  { name: 'desktop', size: WIDE, query: 't=7.4', ui: true, eval: "document.querySelector('.ui-tool[title=\"The look\"]').click()", caption: 'On a desktop, with the look panel open' },
  { name: 'phone', size: PHONE, query: 't=5.25', ui: true, caption: 'On a phone held upright' },
  { name: 'phone-side', size: PHONE_SIDE, query: 't=7.6', ui: true, caption: 'On a phone held sideways' },
  { name: 'steer', size: PHONE, query: 'film=0&t=2', ui: true, eval: "__swan.world.interaction.setStick(-0.75, 0.35); __swan.advance(3.2)", caption: 'Steering: the stick held over to the left, the swan swimming that way' },
  { name: 'close', size: WIDE, query: 'still&heading=28&pose=A&az=14&el=7&dist=2.3&tx=-0.14&ty=0.3&fov=24', caption: 'Close: the fringe of down along the neck, light through the tail' },
  { name: 'head-on', size: TALL, query: 't=3.75', caption: 'Head-on at 3.75 s: the two wing lobes either side of the neck' },
  { name: 'reach', size: WIDE, query: 'still&heading=172&pose=F&az=16&el=11&dist=3.4', caption: 'The reach, bill in the water' },
  { name: 'sunny-side', size: WIDE, query: 'still&heading=200&pose=A&az=178&el=14&dist=4.2', caption: 'From the sunny side, where the film never went: a white swan with an orange bill' },
  { name: 'above', size: WIDE, query: 't=6.9&az=-25&el=30&dist=4.2', caption: 'From above, as the swan comes up from the dunk' },
  { name: 'meadow', size: WIDE, query: 'still&heading=160&pose=G&az=46&el=8&dist=5.5', caption: 'Toward the meadow and the fence' },
  { name: 'water', size: WIDE, query: 't=1.75&el=16&dist=4.2', caption: 'The spray landing: glints only where the water is disturbed' },
  { name: 'transmission', size: WIDE, query: 'still&heading=10&pose=A&dist=3.6&el=9', eval: "__swan.set('look.skyColor', [0, 0, 0])", caption: 'The sun alone: light that has crossed the bird' },
  { name: 'sky-only', size: WIDE, query: 'still&heading=10&pose=A&dist=3.6&el=9', eval: "__swan.set('look.swanThrough', 0); __swan.set('look.swanNeckThrough', 0)", caption: 'Without transmission: the sky and the rim' },
  { name: 'no-print', size: WIDE, query: 't=7.4', eval: "__swan.set('look.print', 0)", caption: 'The same frame before the print curve' },
  { name: 'buffer-far', size: WIDE, query: 't=7.4&debug=far', caption: 'The far layer: drawn small, defocused as one' },
  { name: 'buffer-mirror', size: WIDE, query: 't=7.4&debug=mirror', eval: "__swan.set('camera.offsetLandscape', [0.04, 0.3])", caption: 'The mirror picture of the swan' },
  { name: 'buffer-ripple', size: { w: 720, h: 720 }, query: 't=5.3&debug=ripple', eval: "const r = __swan.ctx.ripple; for (const [x, z, k] of [[-0.9, 0.5, 0.012], [0.6, -0.4, 0.009], [0.1, 0.9, 0.015], [-0.4, -0.6, 0.007]]) r.disturb(x, z, 0.06, k); __swan.advance(0.7)", caption: 'The ripple field, a moment after four drops have landed round the swan' },
  { name: 'og', size: CARD, query: 't=7.45', out: 'public/og.jpg', caption: 'Link preview' },
];

(async () => {
  const a = parseArgs(process.argv);
  if (a.list) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(16)} ${s.caption}`);
    return;
  }
  const root = path.join(__dirname, '..');
  const base = String(a.base || 'http://localhost:5180/').replace(/\/?$/, '/');
  const outDir = path.resolve(root, a.out || 'docs/images');
  const q = a.q || 'high';
  const only = typeof a.only === 'string' ? a.only.split(',') : null;
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];

  /** One frame of the scene as PNG bytes, drawn at twice the size asked for. */
  async function frame(shot, query) {
    const context = await browser.newContext({
      viewport: { width: shot.size.w, height: shot.size.h },
      deviceScaleFactor: 2,
      isMobile: !!shot.size.mobile,
      hasTouch: !!shot.size.mobile,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) problems.push(`${shot.name}: [${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${shot.name}: [pageerror] ${e.message}`));
    await page.goto(`${base}?manual&seed=1&q=${q}&dpr=2${shot.ui ? '' : '&ui=0'}&${query}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
    if (shot.eval) await page.evaluate(shot.eval);
    await page.evaluate(() => window.__swan.advance(0));
    // the controls fade in: let them arrive
    if (shot.ui) await page.waitForTimeout(2000);
    const png = await page.screenshot({ type: 'png' });
    await context.close();
    return png;
  }

  /** Scale pictures down to their real size, lay them side by side, and save as JPEG. */
  async function save(pngs, w, h, file) {
    const page = await browser.newPage();
    const gap = pngs.length > 1 ? 4 : 0;
    const data = await page.evaluate(
      async ({ images, w, h, gap }) => {
        const canvas = document.createElement('canvas');
        canvas.width = images.length * w + (images.length - 1) * gap;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.imageSmoothingQuality = 'high';
        for (let i = 0; i < images.length; i++) {
          const img = new Image();
          img.src = `data:image/png;base64,${images[i]}`;
          await img.decode();
          g.drawImage(img, i * (w + gap), 0, w, h);
        }
        return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
      },
      { images: pngs.map((p) => p.toString('base64')), w, h, gap },
    );
    await page.close();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  for (const shot of SHOTS) {
    if (only && !only.includes(shot.name)) continue;
    const queries = shot.strip || [shot.query];
    const pngs = [];
    for (const query of queries) pngs.push(await frame(shot, query));
    const file = shot.out ? path.resolve(root, shot.out) : path.join(outDir, `${shot.name}.jpg`);
    await save(pngs, shot.size.w, shot.size.h, file);
    console.log(`${path.relative(root, file).padEnd(34)} ${shot.caption}`);
  }
  await browser.close();
  if (problems.length) {
    console.log(`\n${problems.length} problem(s) on the console:\n${problems.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
})();
