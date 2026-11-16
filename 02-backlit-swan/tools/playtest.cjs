// Dev tool: drive the demo through its real input paths and check that it
// does what it says.
//
//   npm run build && npm run preview          (in another terminal: http://localhost:4173)
//   node tools/playtest.cjs http://localhost:4173/
//   options: --only film,touch    run some groups     --list    what there is
//
// Everything is stepped, not timed (?manual and __swan.advance), so the
// result does not depend on how fast this machine draws. Pointer, touch and
// key events are real browser events, sent through Playwright and the
// DevTools protocol, and land on the same listeners a person's would.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');

const base = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:4173/').replace(/\/?$/, '/');
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const only = typeof flag('only') === 'string' ? flag('only').split(',') : null;

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const PHONE_SIDE = { width: 844, height: 390 };

let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail && !ok ? `   (${detail})` : ''}`);
};

/** A page on the demo, with every console error and warning collected. */
async function open(browser, query, { size = DESKTOP, mobile = false, dpr = 1 } = {}) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // headless Chromium without a GPU says this about every WebGL canvas it composites
    if (/GPU stall due to ReadPixels/.test(m.text())) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  return { page, context, problems };
}

const state = (page) =>
  page.evaluate(() => {
    const w = window.__swan.world;
    return {
      mind: w.mind.state,
      film: w.mind.filmTime,
      pos: w.mind.position.toArray(),
      heading: w.mind.heading,
      bill: w.swan.billTip.toArray(),
      az: w.rig.az,
      el: w.rig.el,
      dist: w.rig.dist,
      mode: w.director.mode,
      // main.js reads (and so clears) the error flag once after the first frame: count what it found
      gl: w.engine.renderer.getContext().getError() || w.startError,
      timeScale: w.time,
    };
  });
const advance = (page, seconds, render = false) => page.evaluate(([s, r]) => window.__swan.advance(s, { render: r }), [seconds, render]);

/**
 * Step half a second at a time until the swan's state is one of `states`, for
 * at most `seconds`. Returns the states it passed through on the way.
 */
async function until(page, states, seconds) {
  const seen = [];
  for (let t = 0; t < seconds; t += 0.5) {
    const s = (await state(page)).mind;
    if (seen[seen.length - 1] !== s) seen.push(s);
    if (states.includes(s)) break;
    await advance(page, 0.5);
  }
  return seen;
}

/** Mean brightness and the share of bright pixels of what is on the canvas now. */
async function picture(page) {
  await page.evaluate(() => window.__swan.advance(0));
  return page.evaluate(async () => {
    const src = document.querySelector('#scene canvas');
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((160 * src.height) / src.width);
    const g = c.getContext('2d');
    // the WebGL buffer is only valid right after it was drawn: draw, then copy at once
    window.__swan.advance(0);
    g.drawImage(src, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let bright = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y;
      if (y > 180) bright++;
      if (y < 40) dark++;
    }
    const n = d.length / 4;
    return { mean: sum / n, bright: bright / n, dark: dark / n };
  });
}

const GROUPS = {
  /** It starts, draws the low-key picture it should, and says nothing on the console. */
  async start(browser) {
    for (const [name, size, mobile] of [
      ['desktop', DESKTOP, false],
      ['phone upright', PHONE, true],
      ['phone on its side', PHONE_SIDE, true],
    ]) {
      const { page, context, problems } = await open(browser, 'manual&q=low', { size, mobile, dpr: mobile ? 2 : 1 });
      await advance(page, 0.5);
      const p = await picture(page);
      const s = await state(page);
      check(problems.length === 0, `${name}: no console errors or warnings`, problems.slice(0, 3).join(' | '));
      check(s.gl === 0, `${name}: no WebGL error`, String(s.gl));
      check(p.dark > 0.55 && p.bright > 0.001 && p.bright < 0.12, `${name}: a dark picture with a little of it bright`, JSON.stringify(p));
      const buttons = await page.evaluate(() => [...document.querySelectorAll('#ui button')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height, x: r.left, y: r.top, r: r.right, b: r.bottom })));
      check(buttons.length >= 8, `${name}: the controls are there`, String(buttons.length));
      check(buttons.every((b) => b.w >= 40 && b.h >= 40), `${name}: every control is big enough for a finger`);
      check(buttons.every((b) => b.x >= 0 && b.y >= 0 && b.r <= size.width && b.b <= size.height), `${name}: every control is inside the picture`);
      await context.close();
    }
  },

  /** The film: the performance happens at its measured times, and the swan carries on afterwards. */
  async film(browser) {
    const { page, context, problems } = await open(browser, 'manual&q=low&ui=0');
    let s = await state(page);
    check(s.mind === 'film' && s.mode === 'film', 'opens with the film and the film\'s camera', JSON.stringify(s));
    const start = s;
    // count what the swan does to the water and the air
    await page.evaluate(() => {
      window.__seen = { drop: 0, billEnter: 0, billExit: 0, peakDrops: 0 };
      for (const name of ['drop', 'billEnter', 'billExit']) window.__swan.ctx.events.on(name, () => window.__seen[name]++);
    });
    const inAir = () => page.evaluate(() => window.__swan.world.droplets.object.geometry.attributes.aSize.array.reduce((n, v) => n + (v > 0 ? 1 : 0), 0));
    await advance(page, 0.85);
    const beforeShake = await inAir();
    await advance(page, 0.6); // 1.45 s: the shake has just flung its water
    const afterShake = await inAir();
    check(afterShake > beforeShake + 25, 'the shake throws a spray of drops', `${beforeShake} -> ${afterShake}`);
    await advance(page, 1.3); // 2.75 s
    let seen = await page.evaluate(() => window.__seen);
    check(seen.drop > 20, 'the drops land on the water', JSON.stringify(seen));
    s = await state(page);
    check(s.bill[1] > 0.2, 'between the shake and the dunk the bill is in the air', String(s.bill[1]));
    await advance(page, 2.45); // 5.2 s: the dunk
    s = await state(page);
    seen = await page.evaluate(() => window.__seen);
    check(s.bill[1] < 0 && seen.billEnter >= 1, 'the dunk puts the bill under water at 4.9 s', `${s.bill[1]} ${JSON.stringify(seen)}`);
    await advance(page, 2.3); // 7.5 s
    s = await state(page);
    seen = await page.evaluate(() => window.__seen);
    check(s.bill[1] > 0.1 && seen.billExit >= 1, 'and it is out again, upright, by 7.5 s', String(s.bill[1]));
    await advance(page, 2.9); // 10.4 s: the reach
    s = await state(page);
    check(s.bill[1] < 0, 'the reach puts it under again by 10.4 s', String(s.bill[1]));
    const turned = (((s.heading - start.heading) * 180) / Math.PI + 360) % 360;
    check(turned > 140 && turned < 180, 'the swan has turned round through the light', `${turned.toFixed(0)} degrees`);
    check(s.dist < start.dist - 0.8, 'and has come nearer the camera', `${start.dist.toFixed(2)} -> ${s.dist.toFixed(2)}`);
    await advance(page, 1.2); // past the end
    s = await state(page);
    check(s.film === null && s.mode === 'free', 'when the film ends the swan and the camera are on their own', JSON.stringify({ film: s.film, mode: s.mode }));
    await advance(page, 40);
    s = await state(page);
    const d = Math.hypot(s.pos[0], s.pos[2] - 0.7);
    check(d < 4.5, 'left alone for 40 s it stays in the sunlit water', `${d.toFixed(2)} m from home`);
    check(s.gl === 0 && problems.length === 0, 'no errors along the way', problems.slice(0, 3).join(' | '));
    await context.close();
  },

  /** The same URL gives the same picture. */
  async repeat(browser) {
    const shots = [];
    for (let i = 0; i < 2; i++) {
      const { page, context } = await open(browser, 'manual&q=low&ui=0&t=1.4', { size: { width: 360, height: 640 } });
      shots.push(await page.screenshot({ type: 'png' }));
      await context.close();
    }
    check(shots[0].equals(shots[1]), 'two loads of the same moment of the film are the same picture, byte for byte');
  },

  /** A mouse: drag, wheel, click the water, double click, keys. */
  async mouse(browser) {
    const { page, context, problems } = await open(browser, 'manual&q=low&film=0');
    await advance(page, 0.2);
    const before = await state(page);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(760, 340, { steps: 6 });
    await page.mouse.up();
    await advance(page, 0.1);
    let s = await state(page);
    check(s.az > before.az + 10 && s.el > before.el + 2, 'dragging turns the camera round and lifts it', `${before.az.toFixed(1)},${before.el.toFixed(1)} -> ${s.az.toFixed(1)},${s.el.toFixed(1)}`);
    await page.mouse.wheel(0, -400);
    await advance(page, 0.1);
    const closer = await state(page);
    check(closer.dist < s.dist - 0.5, 'the wheel brings it closer', `${s.dist.toFixed(2)} -> ${closer.dist.toFixed(2)}`);
    await page.mouse.wheel(0, 100000);
    await advance(page, 0.1);
    s = await state(page);
    check(s.dist <= 9.001, 'and it cannot go further back than the pond allows', String(s.dist));
    // click the water in front of the swan: it should come
    await page.evaluate(() => window.__swan.view({ az: 0, el: 12, dist: 5 }));
    await page.evaluate(() => {
      window.__taps = [];
      window.__swan.ctx.events.on('tap', (e) => window.__taps.push(e));
    });
    await page.mouse.click(900, 600);
    await page.waitForTimeout(450); // a single tap waits to see that it is not a double one
    await advance(page, 0.3);
    s = await state(page);
    const taps = await page.evaluate(() => window.__taps);
    check(taps.length === 1 && !taps[0].swan, 'a click on the water is a touch on the water', JSON.stringify(taps));
    check(s.mind === 'swim', 'and the swan sets off toward it', s.mind);
    const far0 = taps.length ? Math.hypot(s.pos[0] - taps[0].x, s.pos[2] - taps[0].z) : 0;
    const passed = await until(page, ['reach'], 25);
    s = await state(page);
    const far1 = taps.length ? Math.hypot(s.pos[0] - taps[0].x, s.pos[2] - taps[0].z) : 99;
    check(far1 < 0.8 && far1 < far0, 'it gets there', `${far0.toFixed(2)} m -> ${far1.toFixed(2)} m`);
    check(s.mind === 'reach', 'and reaches down to feed', passed.join(' > '));
    await advance(page, 2);
    s = await state(page);
    check(s.bill[1] < 0, 'with its bill in the water', String(s.bill[1]));
    // keys (the swan finishes what it is doing first: wait until it is free)
    await until(page, ['idle', 'look'], 30);
    await page.keyboard.press('s');
    await advance(page, 0.5);
    s = await state(page);
    check(s.mind === 'shake', 'S makes it shake', s.mind);
    await until(page, ['idle', 'look'], 30);
    await page.keyboard.press('d');
    await advance(page, 0.6);
    s = await state(page);
    check(s.mind === 'dunk' && s.bill[1] < 0.02, 'D makes it dunk', `${s.mind} ${s.bill[1]}`);
    await page.keyboard.press('4');
    await advance(page, 2);
    s = await state(page);
    check(s.el > 25, '4 goes to the view from above', String(s.el));
    await page.keyboard.press('f');
    await advance(page, 0.1);
    s = await state(page);
    check(s.mind === 'film' && s.mode === 'film' && s.film < 0.3, 'F plays the film again', JSON.stringify({ m: s.mind, f: s.film }));
    await page.mouse.move(600, 300);
    await page.mouse.down();
    await page.mouse.move(640, 300, { steps: 3 });
    await page.mouse.up();
    await advance(page, 0.1);
    s = await state(page);
    check(s.mode === 'free' && s.mind === 'film', 'taking the camera during the film leaves the swan performing', JSON.stringify({ mode: s.mode, mind: s.mind }));
    check(s.gl === 0 && problems.length === 0, 'no errors along the way', problems.slice(0, 3).join(' | '));
    await context.close();
  },

  /** Fingers on a phone, upright and on its side: drag, pinch, tap, the buttons, the panel. */
  async touch(browser) {
    for (const [name, size] of [
      ['upright', PHONE],
      ['on its side', PHONE_SIDE],
    ]) {
      const { page, context, problems } = await open(browser, 'manual&q=low&film=0', { size, mobile: true, dpr: 2 });
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
      const cx = size.width / 2;
      const cy = size.height * 0.45;
      await advance(page, 0.2);
      const before = await state(page);
      // one finger: drag
      await touch('touchStart', [[cx, cy]]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx + i * 15, cy + i * 5]]);
      await touch('touchEnd', []);
      await advance(page, 0.1);
      let s = await state(page);
      check(s.az > before.az + 8, `${name}: a finger drags the camera round`, `${before.az.toFixed(1)} -> ${s.az.toFixed(1)}`);
      // two fingers: pinch out
      await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]);
      await touch('touchEnd', []);
      await advance(page, 0.1);
      const pinched = await state(page);
      check(pinched.dist < s.dist * 0.75, `${name}: spreading two fingers comes closer`, `${s.dist.toFixed(2)} -> ${pinched.dist.toFixed(2)}`);
      check(Math.abs(pinched.az - s.az) < 3, `${name}: and does not turn the camera`, `${s.az.toFixed(1)} -> ${pinched.az.toFixed(1)}`);
      // tap the water low in the picture
      await page.evaluate(() => {
        window.__swan.view({ az: 0, el: 12, dist: 5 });
        window.__taps = [];
        window.__swan.ctx.events.on('tap', (e) => window.__taps.push(e));
      });
      await page.touchscreen.tap(size.width * 0.3, size.height * 0.8);
      await page.waitForTimeout(450);
      await advance(page, 0.3);
      s = await state(page);
      const taps = await page.evaluate(() => window.__taps);
      check(taps.length === 1 && s.mind === 'swim', `${name}: a tap on the water calls the swan`, `${JSON.stringify(taps)} ${s.mind}`);
      // the buttons
      const press = (title) => page.evaluate((t) => [...document.querySelectorAll('#ui button')].find((b) => b.title.startsWith(t)).click(), title);
      await until(page, ['reach'], 25);
      await until(page, ['idle', 'look'], 30);
      await press('Shake');
      await advance(page, 0.5);
      s = await state(page);
      check(s.mind === 'shake', `${name}: the Shake button`, s.mind);
      await until(page, ['idle', 'look'], 30);
      await press('Reach');
      await advance(page, 1.8);
      s = await state(page);
      check(s.mind === 'reach' && s.bill[1] < 0.05, `${name}: the Reach button`, `${s.mind} ${s.bill[1]}`);
      await press('Play the film');
      await advance(page, 0.1);
      s = await state(page);
      check(s.mind === 'film', `${name}: the Film button`, s.mind);
      // slow motion halves... quarters the water's clock
      const t0 = await page.evaluate(() => window.__swan.world.time);
      await press('Slow motion');
      await advance(page, 1);
      const t1 = await page.evaluate(() => window.__swan.world.time);
      check(Math.abs(t1 - t0 - 0.25) < 0.02, `${name}: slow motion runs the scene at a quarter speed`, String(t1 - t0));
      await press('Slow motion');
      // the look panel
      await press('The look');
      const panel = await page.evaluate(() => {
        const p = document.querySelector('.ui-panel');
        const r = p.getBoundingClientRect();
        return { hidden: p.hidden, x: r.left, y: r.top, r: r.right, b: r.bottom };
      });
      check(!panel.hidden && panel.x >= 0 && panel.y >= 0 && panel.r <= size.width && panel.b <= size.height, `${name}: the look panel opens inside the picture`, JSON.stringify(panel));
      const sun = await page.evaluate(() => {
        const input = document.querySelector('.ui-panel input[type=range]');
        input.value = '40';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.__swan.advance(0.1);
        const d = window.__swan.ctx.light.uniforms.uSunDir.value;
        return (Math.atan2(d.x, -d.z) * 180) / Math.PI;
      });
      check(Math.abs(sun - 40) < 0.5, `${name}: its first slider turns the sun`, String(sun));
      await press('Close');
      await press('Hide');
      const hidden = await page.evaluate(() => document.querySelector('#ui').classList.contains('hidden') && getComputedStyle(document.querySelector('.ui-actions')).pointerEvents === 'none');
      check(hidden, `${name}: Hide puts the controls away`);
      await press('Show');
      s = await state(page);
      check(s.gl === 0 && problems.length === 0, `${name}: no errors along the way`, problems.slice(0, 3).join(' | '));
      await context.close();
    }
  },

  /** Two fingers as the very first gesture, while someone else has the camera: the film's operator, then a move to a view. */
  async pinch(browser) {
    const { page, context, problems } = await open(browser, 'manual&q=low&ui=0', { size: PHONE, mobile: true, dpr: 2 });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    const cx = PHONE.width / 2;
    const cy = PHONE.height * 0.45;
    const spread = async () => {
      await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]);
      await touch('touchEnd', []);
    };
    await advance(page, 0.5);
    const before = await state(page);
    await spread();
    await advance(page, 0.5);
    let s = await state(page);
    check(before.mode === 'film' && s.mode === 'free' && s.mind === 'film', 'a pinch during the film takes the camera and leaves the swan performing', JSON.stringify({ before: before.mode, mode: s.mode, mind: s.mind }));
    check(s.dist < before.dist * 0.75, 'and the camera stays as close as the fingers brought it', `${before.dist.toFixed(2)} -> ${s.dist.toFixed(2)}`);
    // on the way to the view from above (6.5 m away, 30 degrees up), pinch again
    await page.evaluate(() => window.__swan.world.director.view('high'));
    await advance(page, 0.2);
    await spread();
    await advance(page, 2);
    s = await state(page);
    check(s.dist < 3 && s.el < 20, 'a pinch stops a move to a view that was under way', `dist ${s.dist.toFixed(2)}, el ${s.el.toFixed(1)}`);
    check(s.gl === 0 && problems.length === 0, 'no errors along the way', problems.slice(0, 3).join(' | '));
    await context.close();
  },

  /** Turning the phone, losing the graphics context, the fallbacks and the tiers. */
  async sturdy(browser) {
    const { page, context, problems } = await open(browser, 'manual&q=low&ui=0', { size: PHONE, mobile: true, dpr: 2 });
    await advance(page, 1);
    const a = await picture(page);
    await page.setViewportSize(PHONE_SIDE);
    await page.waitForTimeout(400);
    await advance(page, 0.1);
    const size = await page.evaluate(() => {
      const c = document.querySelector('#scene canvas');
      return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
    });
    const b = await picture(page);
    check(size.cw === 844 && size.ch === 390 && size.w > size.h, 'turning the phone resizes the picture', JSON.stringify(size));
    check(b.dark > 0.5 && b.bright > 0.0005, 'and it is still the scene', JSON.stringify(b));
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(400);
    // lose the context and get it back
    const lost = await page.evaluate(async () => {
      const gl = window.__swan.engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return null;
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 100));
      window.__swan.advance(0.2);
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 300));
      window.__swan.advance(0.5);
      return window.__swan.engine.contextLost;
    });
    const c = await picture(page);
    check(lost === false, 'a lost graphics context comes back', String(lost));
    check(c.dark > 0.5 && c.bright > 0.0005 && Math.abs(c.mean - a.mean) < 12, 'with the picture it had', `${a.mean.toFixed(1)} -> ${c.mean.toFixed(1)}`);
    check(problems.filter((p) => !/context/i.test(p)).length === 0, 'no errors along the way', problems.slice(0, 3).join(' | '));
    await context.close();

    for (const q of ['medium', 'high']) {
      const t = await open(browser, `manual&q=${q}&ui=0&t=1.3`, { size: { width: 360, height: 640 } });
      const p = await picture(t.page);
      const s = await state(t.page);
      check(t.problems.length === 0 && s.gl === 0 && p.dark > 0.5 && p.bright > 0.001, `the ${q} tier draws the scene without errors`, `${JSON.stringify(p)} ${t.problems.slice(0, 2).join(' | ')}`);
      await t.context.close();
    }
    const hdr = await open(browser, 'manual&q=low&ui=0&t=1.3', { size: { width: 360, height: 640 } });
    const ldr = await open(browser, 'manual&q=low&ui=0&t=1.3&ldr', { size: { width: 360, height: 640 } });
    const p1 = await picture(hdr.page);
    const p2 = await picture(ldr.page);
    const s2 = await state(ldr.page);
    check(ldr.problems.length === 0 && s2.gl === 0, 'the 8-bit fallback (?ldr) runs without errors', ldr.problems.slice(0, 2).join(' | '));
    check(Math.abs(p1.mean - p2.mean) < 10 && p2.dark > 0.5, 'and draws nearly the same picture', `${p1.mean.toFixed(1)} vs ${p2.mean.toFixed(1)}`);
    await hdr.context.close();
    await ldr.context.close();
  },
};

(async () => {
  if (flag('list')) {
    console.log(Object.keys(GROUPS).join('\n'));
    return;
  }
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, run] of Object.entries(GROUPS)) {
    if (only && !only.includes(name)) continue;
    console.log(`\n${name}`);
    try {
      await run(browser);
    } catch (err) {
      check(false, `${name}: ran to the end`, err.message.split('\n')[0]);
    }
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
