// Dev tool: regenerate every picture the README and the docs use.
//
//   npm run dev                                    (in another terminal)
//   node tools/screenshots.cjs                     all of them, into docs/images/ (and public/og.jpg)
//   node tools/screenshots.cjs --only hero,fleet   some of them
//   node tools/screenshots.cjs --list              what there is
//   options: --base http://localhost:5173/   --out docs/images
//
// It needs the dev server rather than the build, because the boat renders come
// from viewer.html, which is not part of the build.
//
// Every picture is made the same way each time: the game is stepped, not
// timed; its random numbers are seeded; the camera for the staged shots is
// placed by this script. Pictures are drawn at twice their size and scaled
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

// The same "random" numbers on every run (see capture.cjs).
const SEEDED_RANDOM = `(() => {
  let s = 0x2f6e2b1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})()`;

const DESKTOP = { w: 1280, h: 720 };
const WIDE = { w: 1200, h: 630 }; // the shape of a link preview
const PHONE = { w: 844, h: 390, mobile: true };
const PHONE_TALL = { w: 390, h: 760, mobile: true };

/**
 * A staged camera, placed relative to a boat: `back` metres astern of it,
 * `side` metres to port, `up` metres above the water there, looking at a point
 * `ahead` metres in front of the boat and `lift` metres above it.
 */
const cam = (back, side, up, ahead, lift, fov) => ({ back, side, up, ahead, lift, fov });

// What to make. `at` is seconds of race time; kinds:
//   viewer  one asset over the sea (viewer.html)
//   game    the game as it is played, HUD and all
//   staged  the game with the HUD off and the camera where `camera` says
//   sheet   the boat's painted texture sheets, laid out for the docs
const SHOTS = [
  // ---- the boat
  { name: 'boat-rear', kind: 'viewer', size: DESKTOP, query: 'asset=craft&flat&sea=0.06&fov=40&ty=0.45&az=250&el=17&dist=8.5', caption: 'The boat from astern, into the sun' },
  { name: 'boat-front', kind: 'viewer', size: DESKTOP, query: 'asset=craft&flat&sea=0.06&fov=40&ty=0.45&az=58&el=12&dist=6.9', caption: 'The boat from the port bow' },
  { name: 'boat-above', kind: 'viewer', size: DESKTOP, query: 'asset=craft&flat&sea=0.06&fov=40&ty=0.4&az=120&el=30&dist=7.2', caption: 'The boat from above the starboard bow' },
  { name: 'boat-engines', kind: 'viewer', size: DESKTOP, query: 'asset=craft&flat&sea=0.06&fov=36&tx=0&ty=0.55&tz=-2.5&az=243&el=14&dist=3.6', caption: 'Outboards, transoms and the engine hatch' },
  { name: 'boat-cockpit', kind: 'viewer', size: DESKTOP, query: 'asset=craft&flat&sea=0.06&fov=36&tx=0&ty=0.95&tz=0.05&az=38&el=24&dist=3.3', caption: 'Canopy, driver and foredeck' },
  { name: 'fleet', kind: 'viewer', size: DESKTOP, query: 'asset=crafts&sea=0.06&fov=42&ty=0.4&az=118&el=26&dist=13.5', caption: 'The four liveries' },
  { name: 'livery-sheet', kind: 'sheet', caption: 'The painted sheet, and the detail sheets every boat shares' },

  // ---- the island
  { name: 'island', kind: 'viewer', size: DESKTOP, query: 'asset=world&fov=50&tx=62&ty=5&tz=20&az=20&el=7&dist=70', caption: 'The island from beyond the pier' },
  { name: 'beach', kind: 'viewer', size: DESKTOP, query: 'asset=world&fov=50&tx=-52&ty=5&tz=-30&az=200&el=5&dist=26', caption: 'Palms, their shadows, and ripples in the sand' },
  { name: 'shore', kind: 'viewer', size: DESKTOP, query: 'asset=world&fov=50&tx=64&ty=4&tz=34&az=-10&el=5&dist=24', caption: 'The sunny side: surf running up the sand' },

  // ---- the game as played
  { name: 'title', kind: 'game', size: DESKTOP, query: '', at: 6, caption: 'Title screen' },
  { name: 'race', kind: 'game', size: DESKTOP, query: 'auto&ap', at: 31, caption: 'Racing: the view from the chase camera' },
  { name: 'race-open-sea', kind: 'game', size: DESKTOP, query: 'auto&ap', at: 40, caption: 'On the open-ocean side' },
  { name: 'rain', kind: 'game', size: DESKTOP, query: 'auto&ap', at: 13, caption: "In the pack: other boats' spray as rain on the lens" },
  { name: 'split-screen', kind: 'game', size: DESKTOP, query: 'mode=split&auto', drive: true, at: 22, caption: 'Two players on one keyboard' },
  { name: 'phone', kind: 'game', size: PHONE, query: 'auto&ap', at: 31, thumb: [660, 262, 688, 268], scale: 0.75, caption: 'Phone, held sideways, one thumb on the glass' },
  { name: 'phone-portrait', kind: 'game', size: PHONE_TALL, query: 'auto&ap', at: 24, scale: 0.75, caption: 'Phone, held upright' },

  // ---- staged: the same race, photographed
  { name: 'hero', kind: 'staged', size: WIDE, query: 'auto&ap&drops=0', at: 7.6, camera: cam(-13, -5.5, 1.5, -4, 0.6, 36), og: true, caption: 'The pack a few seconds after the start' },
  { name: 'pursuit', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0', at: 31.4, camera: cam(7.2, -3.0, 1.3, 4.5, 0.5, 38), caption: "In the leader's wake" },
  { name: 'plumes', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0', at: 40, camera: cam(2.2, 9.5, 1.3, 0.3, 0.7, 40), caption: 'Spray plumes at full power' },
  { name: 'drift', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0', at: 30, until: 'sliding', camera: cam(-8.5, 4.6, 1.2, 0.5, 0.5, 38), caption: 'Sliding through a turn' },
  { name: 'jump', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0', at: 44, until: 'airborne', camera: cam(-2.5, -8.5, 0.9, 0.5, 0.5, 38), caption: 'Off the top of a swell' },
  { name: 'wakes', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0', at: 30, camera: cam(16, 0, 26, 14, 0, 44), caption: 'Wakes from above' },
  { name: 'reflections', kind: 'staged', size: DESKTOP, query: 'auto&ap&drops=0&sea=0.3', at: 9, camera: cam(8, -2.5, 1.3, 14, 0.2, 40), caption: 'Calm water: rocks, marks and boats mirrored in it' },
];

async function downscale(page, pngBuffer, scale, quality = 0.88) {
  // Scale a picture down in the browser itself (so the tool needs nothing but Playwright).
  const dataUrl = await page.evaluate(
    async ({ b64, scale, quality }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality);
    },
    { b64: pngBuffer.toString('base64'), scale, quality },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

(async () => {
  const a = parseArgs(process.argv);
  if (a.list) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(16)} ${s.kind.padEnd(7)} ${s.caption}`);
    return;
  }
  const base = a.base || 'http://localhost:5173/';
  const outDir = path.resolve(a.out || path.join(__dirname, '..', 'docs', 'images'));
  const only = a.only ? String(a.only).split(',') : null;
  const shots = SHOTS.filter((s) => !only || only.includes(s.name));
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const scaler = await (await browser.newContext()).newPage();
  const problems = [];
  const save = async (shot, png, scale) => {
    const jpg = await downscale(scaler, png, scale);
    const file = path.join(outDir, `${shot.name}.jpg`);
    fs.writeFileSync(file, jpg);
    console.log('saved', path.relative(process.cwd(), file), `${Math.round(jpg.length / 1024)} kB`);
    if (shot.og) {
      const og = path.resolve(__dirname, '..', 'public', 'og.jpg');
      fs.writeFileSync(og, await downscale(scaler, png, 0.5));
      console.log('saved', path.relative(process.cwd(), og));
    }
  };
  const open = async (size, url) => {
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: !!size.mobile, hasTouch: !!size.mobile });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${url}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${url}: ${e.message}`));
    await page.addInitScript(SEEDED_RANDOM);
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
    return { context, page };
  };
  const shoot = (page) => page.screenshot({ type: 'png', timeout: 300000 });

  for (const shot of shots) {
    const scale = shot.scale || 0.625; // drawn at 2x, kept at 1.25x (1.5x on the phone)
    if (shot.kind === 'viewer') {
      const { context, page } = await open(shot.size, `${base}viewer.html?manual&dpr=2&${shot.query}`);
      // enough frames for the reflections to have been drawn all the way round
      await page.evaluate('window.__viewer.frames(8)');
      await save(shot, await shoot(page), scale);
      await context.close();
    } else if (shot.kind === 'sheet') {
      const { context, page } = await open({ w: 1280, h: 1000 }, `${base}viewer.html?manual&dpr=1&asset=craft&flat`);
      // lay the three sheets out on one canvas and photograph that
      await page.evaluate(`(() => {
        const hull = window.__viewer.subject.children[0].children.find((c) => c.name === 'hull');
        const m = hull.material;
        const sheets = [m.map.image, m.normalMap.image, m.aoMap.image];
        const w = 1280;
        const big = Math.round((w * sheets[0].height) / sheets[0].width);
        const small = Math.round(((w / 2 - 6) * sheets[1].height) / sheets[1].width);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = big + 12 + small;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0c2a3b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sheets[0], 0, 0, w, big);
        ctx.drawImage(sheets[1], 0, big + 12, w / 2 - 6, small);
        ctx.drawImage(sheets[2], w / 2 + 6, big + 12, w / 2 - 6, small);
        canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99;width:' + w / 2 + 'px;height:' + canvas.height / 2 + 'px';
        canvas.id = 'sheets';
        document.body.appendChild(canvas);
      })()`);
      const png = await page.locator('#sheets').screenshot({ type: 'png' });
      await save(shot, png, 1);
      await context.close();
    } else {
      const { context, page } = await open(shot.size, `${base}?manual&dpr=2&${shot.query}`);
      await page.waitForFunction('!!window.__bw');
      if (shot.drive) {
        // bots drive for the players, who keep their names
        await page.evaluate(`(() => { const g = window.__bw.game; for (const v of g.views) v.racer.driver = v.auto; })()`);
      }
      // draw the last moments: the chase camera settles and the reflections get drawn all the way round
      // (a staged shot brings its own camera, so it needs fewer)
      const settle = shot.kind === 'staged' ? 0.5 : 0.8;
      await page.evaluate(`window.__bw.skip(${Math.max(0, shot.at - settle)})`);
      await page.evaluate(`window.__bw.advance(${settle}, 12)`);
      if (shot.until === 'airborne') {
        // carry on until the boat is well clear of the water
        await page.evaluate(`(() => {
          const g = window.__bw.game;
          const c = g.views[0].racer.craft;
          for (let i = 0; i < 1800; i++) {
            g.engine.advance(1 / 60, 1 / 60, i % 5 === 0);
            if (c.airborne && c.pos.y - c.waterY > 0.75 && c.vel.y > -0.5) break;
          }
          g.engine.advance(1 / 60);
        })()`);
      }
      let lean = 1;
      if (shot.until === 'sliding') {
        // carry on until the boat is well into a slide, and stand on the side it is sliding toward
        lean = await page.evaluate(`(() => {
          const g = window.__bw.game;
          const c = g.views[0].racer.craft;
          for (let i = 0; i < 3600; i++) {
            g.engine.advance(1 / 60, 1 / 60, i % 5 === 0);
            if (!c.airborne && c.speed > 20 && Math.abs(c.slip) > 0.3) break;
          }
          g.engine.advance(1 / 60);
          return c.slip > 0 ? 1 : -1;
        })()`);
      }
      if (shot.thumb) {
        const [ox, oy, x, y] = shot.thumb;
        await page.evaluate(`(() => {
          const g = window.__bw.game;
          g.hud.root.classList.add('touch');
          g.input.steerPointer = { id: 99, originX: ${ox}, originY: ${oy}, x: ${x}, y: ${y} };
          g.hud.showTouch(g.input);
        })()`);
      }
      if (shot.kind === 'staged') {
        await page.evaluate(
          ({ c }) => {
            const g = window.__bw.game;
            const v = g.views[0];
            const boat = v.racer.craft;
            const p = boat.object.position;
            const fx = Math.sin(boat.yaw);
            const fz = Math.cos(boat.yaw);
            // port is (fz, -fx)
            const camera = v.camera;
            camera.position.set(p.x - fx * c.back + fz * c.side, boat.waterY + c.up, p.z - fz * c.back - fx * c.side);
            camera.fov = c.fov;
            camera.updateProjectionMatrix();
            camera.up.set(0, 1, 0);
            camera.lookAt(p.x + fx * c.ahead, p.y + c.lift, p.z + fz * c.ahead);
            camera.updateMatrixWorld();
            v.lens.clear();
            // the HUD off, and the picture drawn again from where the camera now is
            const style = document.createElement('style');
            style.textContent = '#game > :not(.bw-canvas) { visibility: hidden !important; }';
            document.head.appendChild(style);
            g.draw(g.engine.simTime + g.engine.accumulator);
          },
          { c: { ...shot.camera, side: shot.camera.side * lean } },
        );
      }
      await page.waitForTimeout(400); // CSS transitions
      await save(shot, await shoot(page), scale);
      await context.close();
    }
  }
  await browser.close();
  if (problems.length) {
    console.log('PROBLEMS\n' + problems.slice(0, 12).join('\n'));
    process.exitCode = 1;
  }
})();
