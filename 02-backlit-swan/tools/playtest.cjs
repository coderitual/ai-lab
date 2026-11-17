// Dev tool: drive the demo through its real input paths and check that it
// does what it says.
//
//   npm run build && npm run preview          (in another terminal: http://localhost:4173)
//   node tools/playtest.cjs http://localhost:4173/
//   options: --only film,steer    run some groups     --list    what there is
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
      speed: w.mind.speed,
      // how far inside the shore's outline the swan is (negative: on the water)
      shore: window.__swan.ctx.pond.shoreDistance(w.mind.position.x, w.mind.position.z),
      // the camera: where it is, and the picture's right and its depth as directions on the water
      cam: w.camera.position.toArray(),
      right: [w.camera.matrixWorld.elements[0], w.camera.matrixWorld.elements[2]],
      away: [-w.camera.matrixWorld.elements[8], -w.camera.matrixWorld.elements[10]],
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

/**
 * How far the swan went between two states, as the picture of the first one
 * shows it: metres away from the camera and metres to the picture's right.
 */
function travelled(from, to) {
  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  const unit = ([x, z]) => [x / Math.hypot(x, z), z / Math.hypot(x, z)];
  const away = unit(from.away);
  const right = unit(from.right);
  return { away: dx * away[0] + dz * away[1], right: dx * right[0] + dz * right[1] };
}
const metres = (t) => `${t.away.toFixed(2)} m away, ${t.right.toFixed(2)} m right`;

/** Whether two rectangles { x, y, r, b } share any area. */
const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

/** The rectangles of the stick, the block of actions, the tools and the look panel, and whether each can be seen and touched. */
const layout = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: !node.hidden && style.display !== 'none' && style.opacity !== '0' && style.pointerEvents !== 'none' };
    };
    return { stick: box('.ui-stick'), actions: box('.ui-actions'), tools: box('.ui-tools'), panel: box('.ui-panel') };
  });

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
      // the stick, the block of actions and the tools: each in its own corner
      let l = await layout(page);
      check(l.stick.shown && l.stick.w >= 104 && l.stick.h >= 104, `${name}: the stick is there and big enough for a thumb`, JSON.stringify(l.stick));
      check(l.stick.x >= 0 && l.stick.y >= 0 && l.stick.r <= size.width && l.stick.b <= size.height && l.stick.x < size.width / 2 && l.stick.b > size.height * 0.7, `${name}: it is inside the picture, bottom left`, JSON.stringify(l.stick));
      check(!overlap(l.stick, l.actions) && !overlap(l.stick, l.tools) && !overlap(l.actions, l.tools), `${name}: the stick, the actions and the tools do not overlap`, JSON.stringify(l));
      if (mobile) {
        const grid = await page.evaluate(() => [...document.querySelectorAll('.ui-act')].map((b) => b.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top)]));
        const two = grid.length === 4 && grid[0][1] === grid[1][1] && grid[2][1] === grid[3][1] && grid[0][0] === grid[2][0] && grid[1][0] === grid[3][0] && grid[2][1] > grid[0][1] && grid[1][0] > grid[0][0];
        check(two && l.actions.x > size.width / 2 && l.actions.b > size.height * 0.7, `${name}: the actions are a block of two by two, bottom right`, JSON.stringify(grid));
      }
      // with the look panel open, nothing that can be touched lies under or over it
      await page.evaluate(() => [...document.querySelectorAll('#ui button')].find((b) => b.title === 'The look').click());
      l = await layout(page);
      check(l.panel.shown && (!l.stick.shown || !overlap(l.stick, l.panel)) && (!l.actions.shown || !overlap(l.actions, l.panel)), `${name}: the open look panel does not share any of the picture with the stick or the actions`, JSON.stringify(l));
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
    await page.keyboard.press('Space');
    await advance(page, 0.5);
    s = await state(page);
    check(s.mind === 'shake', 'Space makes it shake', s.mind);
    await until(page, ['idle', 'look'], 30);
    await page.keyboard.press('e');
    await advance(page, 0.6);
    s = await state(page);
    check(s.mind === 'dunk' && s.bill[1] < 0.02, 'E makes it dunk', `${s.mind} ${s.bill[1]}`);
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

  /** W A S D: the swan is driven, as the picture shows it, and cannot be driven ashore. */
  async steer(browser) {
    const { page, context, problems } = await open(browser, 'manual&q=low&film=0');
    await advance(page, 0.2);
    let from = await state(page);
    await page.keyboard.down('w');
    await advance(page, 4);
    let s = await state(page);
    let t = travelled(from, s);
    check(s.mind === 'steer', 'with W held the swan is being steered', s.mind);
    check(t.away > 1 && Math.abs(t.right) < 0.5, 'and has swum away from the camera', metres(t));
    check(s.speed > 0.45 && s.speed < 0.6, 'at about half a metre a second', String(s.speed));
    const shown = await page.evaluate(() => {
      const node = document.querySelector('.ui-stick');
      return { on: node.classList.contains('on'), sx: parseFloat(node.style.getPropertyValue('--sx')), sy: parseFloat(node.style.getPropertyValue('--sy')) };
    });
    check(shown.on && shown.sx === 0 && shown.sy === -1, 'and the stick on the screen shows what the keys are asking for', JSON.stringify(shown));
    const far = Math.hypot(s.cam[0] - s.pos[0], s.cam[2] - s.pos[2]);
    check(Math.abs(far - Math.hypot(from.cam[0] - from.pos[0], from.cam[2] - from.pos[2])) < 0.5, 'with the camera keeping up', `${far.toFixed(2)} m from it`);
    await page.keyboard.up('w');
    await advance(page, 0.1);
    s = await state(page);
    check(s.mind !== 'steer' && s.speed > 0.3, 'let go, it is on its own again and still running on', `${s.mind} at ${s.speed.toFixed(2)} m/s`);
    await advance(page, 4);
    s = await state(page);
    check(['idle', 'look'].includes(s.mind) && s.speed < 0.15, 'and within a few seconds it has glided back to its idle drift', `${s.mind} at ${s.speed.toFixed(2)} m/s`);
    // turn the camera a quarter of the way round: the keys follow the picture, not the compass
    await page.evaluate(() => window.__swan.view({ az: 90 }));
    await advance(page, 0.1);
    from = await state(page);
    await page.keyboard.down('a');
    await advance(page, 4);
    s = await state(page);
    t = travelled(from, s);
    check(s.mind === 'steer' && t.right < -1 && Math.abs(t.away) < 0.6, 'with the camera turned 90 degrees, A still goes to the left of the picture', metres(t));
    // straight from A to D at full speed: it has to come about first
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await advance(page, 3.5);
    from = await state(page);
    const right = [from.right[0] / Math.hypot(...from.right), from.right[1] / Math.hypot(...from.right)];
    const facing = Math.sin(from.heading) * right[0] + Math.cos(from.heading) * right[1];
    t = travelled(s, from);
    check(from.mind === 'steer' && facing > 0.9 && from.speed > 0.3 && Math.abs(t.away) < 1, 'told to go the other way at full speed, it comes about in a body length or so and three and a half seconds', `facing ${facing.toFixed(2)} of 1 at ${from.speed.toFixed(2)} m/s, ${metres(t)}`);
    await advance(page, 3);
    s = await state(page);
    t = travelled(from, s);
    check(s.mind === 'steer' && t.right > 1 && Math.abs(t.away) < 0.3, 'and D goes to the right of the picture', metres(t));
    // a key that is down when the window loses the keyboard is never seen to come up
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await advance(page, 0.1);
    s = await state(page);
    check(s.mind !== 'steer', 'a key held when the window loses focus does not stick', s.mind);
    await page.keyboard.up('d');
    // asked to dunk on the move, it shakes at once but keeps its bill out of the water until it has been let go
    await page.keyboard.down('s');
    await advance(page, 3);
    await page.keyboard.press('e');
    await advance(page, 1.5);
    s = await state(page);
    check(s.mind === 'steer' && s.bill[1] > 0.2, 'asked to dunk at speed, it keeps its bill out of the water', `${s.mind} ${s.bill[1]}`);
    await page.keyboard.up('s');
    const then = await until(page, ['dunk'], 6);
    await advance(page, 0.6);
    s = await state(page);
    check(s.mind === 'dunk' && s.bill[1] < 0.02 && s.speed < 0.25, 'and dunks once it has slowed', `${then.join(' > ')} ${s.bill[1]} at ${s.speed.toFixed(2)} m/s`);
    // a minute's push at the bank
    await until(page, ['idle', 'look'], 30);
    await page.keyboard.down('w');
    for (let i = 0; i < 6; i++) await advance(page, 10);
    s = await state(page);
    check(s.mind === 'steer' && s.shore < -1.49 && s.shore > -1.6, 'held toward the bank for a minute, the swan is at the edge of the water it is allowed, and on it', `${s.shore.toFixed(2)} m from the shore`);
    await page.keyboard.up('w');
    await advance(page, 20);
    s = await state(page);
    check(s.shore < -1.49, 'and it stays on the water when let go there', `${s.shore.toFixed(2)} m from the shore`);
    check(s.gl === 0 && problems.length === 0, 'no errors along the way', problems.slice(0, 3).join(' | '));
    await context.close();

    // steering during the film
    const film = await open(browser, 'manual&q=low&ui=0');
    await advance(film.page, 8); // the operator has leaned in by now, and the bill has just come up from the dunk
    const before = await state(film.page);
    await film.page.keyboard.down('d');
    await advance(film.page, 2 / 60);
    s = await state(film.page);
    check(before.mind === 'film' && before.mode === 'film' && s.film === null && s.mind === 'steer', 'steering during the film ends the film', JSON.stringify({ before: before.mind, film: s.film, mind: s.mind }));
    check(s.mode === 'free', 'and frees the camera', s.mode);
    const jump = Math.hypot(s.cam[0] - before.cam[0], s.cam[1] - before.cam[1], s.cam[2] - before.cam[2]);
    check(jump < 0.03 && Math.abs(s.az - before.az) < 0.5 && Math.abs(s.dist - before.dist) < 0.03, 'which is handed over where it was, without a jump', `${jump.toFixed(3)} m, ${(s.az - before.az).toFixed(2)} degrees`);
    await advance(film.page, 5);
    const after = await state(film.page);
    t = travelled(s, after);
    check(after.mind === 'steer' && t.right > 1, 'the swan carries on from where the film had it, the way it is steered', metres(t));
    // is it still in the picture at full speed? where its body is, in the picture (-1..1 each way)
    const inPicture = await film.page.evaluate(() => {
      const w = window.__swan.world;
      const p = w.mind.position.clone().setY(0.15).project(w.camera);
      return [p.x, p.y];
    });
    check(after.speed > 0.5 && Math.abs(inPicture[0]) < 0.6 && Math.abs(inPicture[1]) < 0.8, 'and at full speed it stays well inside the picture', `${after.speed.toFixed(2)} m/s at ${inPicture.map((v) => v.toFixed(2))}`);
    await film.page.keyboard.up('d');
    check(after.gl === 0 && film.problems.length === 0, 'no errors along the way', film.problems.slice(0, 3).join(' | '));
    await film.context.close();
  },

  /** The stick under a thumb, upright and on its side, while the other hand has the camera and the buttons. */
  async stick(browser) {
    for (const [name, size] of [
      ['upright', PHONE],
      ['on its side', PHONE_SIDE],
    ]) {
      const { page, context, problems } = await open(browser, 'manual&q=low&film=0', { size, mobile: true, dpr: 2 });
      const cdp = await context.newCDPSession(page);
      // each finger keeps its own id: [x, y, id]. touchEnd lifts the fingers it names (all of them if none).
      const fingers = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
      const stick = () =>
        page.evaluate(() => {
          const node = document.querySelector('.ui-stick');
          const r = node.getBoundingClientRect();
          const k = node.querySelector('.ui-stick-knob').getBoundingClientRect();
          // where the knob has ended up (not where it is on its way to): the transition is skipped
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, on: node.classList.contains('on'), held: node.classList.contains('held'), sx: parseFloat(node.style.getPropertyValue('--sx')) || 0, sy: parseFloat(node.style.getPropertyValue('--sy')) || 0, knob: [k.left + k.width / 2 - (r.left + r.width / 2), k.top + k.height / 2 - (r.top + r.height / 2)] };
        });
      await advance(page, 0.2);
      const at = await stick();
      const reach = at.w * 0.3; // the knob's travel
      let from = await state(page);
      // a thumb on the stick, pushed up: away from the camera
      await fingers('touchStart', [[at.x, at.y, 0]]);
      for (let i = 1; i <= 4; i++) await fingers('touchMove', [[at.x, at.y - (reach * 1.2 * i) / 4, 0]]);
      await advance(page, 4);
      let s = await state(page);
      let t = travelled(from, s);
      let k = await stick();
      check(k.held && k.on && Math.abs(k.sx) < 0.01 && Math.abs(k.sy + 1) < 0.01 && Math.abs(k.knob[1] + reach) < 1.5 && Math.abs(k.knob[0]) < 1.5, `${name}: the knob follows the thumb as far as the rim`, JSON.stringify(k));
      check(s.mind === 'steer' && t.away > 1 && Math.abs(t.right) < 0.5, `${name}: the stick pushed up swims the swan away from the camera`, metres(t));
      // slide the thumb round to the right
      for (let i = 1; i <= 4; i++) await fingers('touchMove', [[at.x + (reach * i) / 4, at.y - (reach * (4 - i)) / 4, 0]]);
      from = s;
      await advance(page, 5);
      s = await state(page);
      t = travelled(from, s);
      check(s.mind === 'steer' && t.right > 1, `${name}: pushed right, to the right of the picture`, metres(t));
      // the other hand: a finger on the picture drags the camera round while the thumb holds the stick
      const cx = size.width * 0.55;
      const cy = size.height * 0.32;
      const thumb = [at.x + reach, at.y, 0];
      await fingers('touchStart', [thumb, [cx, cy, 1]]);
      for (let i = 1; i <= 6; i++) await fingers('touchMove', [thumb, [cx + i * 15, cy + i * 4, 1]]);
      await fingers('touchEnd', [[cx + 90, cy + 24, 1]]);
      await advance(page, 0.2);
      let now = await state(page);
      k = await stick();
      check(now.az > s.az + 8, `${name}: a second finger drags the camera while the stick is held`, `${s.az.toFixed(1)} -> ${now.az.toFixed(1)}`);
      check(now.mind === 'steer' && k.held, `${name}: and the thumb still has the stick`, `${now.mind} ${JSON.stringify(k)}`);
      // the same finger on a button: no browser makes a click of a second finger, the button must take it itself
      const shake = await page.evaluate(() => {
        const r = [...document.querySelectorAll('#ui button')].find((b) => b.title.startsWith('Shake')).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
      const drops = () => page.evaluate(() => window.__swan.world.droplets.object.geometry.attributes.aSize.array.reduce((n, v) => n + (v > 0 ? 1 : 0), 0));
      const dry = await drops();
      await fingers('touchStart', [thumb, [shake[0], shake[1], 1]]);
      await fingers('touchEnd', [[shake[0], shake[1], 1]]);
      await advance(page, 0.8);
      now = await state(page);
      const wet = await drops();
      check(now.mind === 'steer' && wet > dry + 20, `${name}: a second finger on Shake makes it shake as it swims`, `${now.mind}, ${dry} -> ${wet} drops`);
      // let go: the stick springs back and the swan is on its own
      await fingers('touchEnd', []);
      await advance(page, 0.1);
      await page.waitForTimeout(400); // the knob's spring is the page's own animation: let it finish
      k = await stick();
      now = await state(page);
      check(!k.held && !k.on && k.sx === 0 && k.sy === 0 && Math.hypot(k.knob[0], k.knob[1]) < 1.5, `${name}: let go, the stick springs back to the middle`, JSON.stringify(k));
      check(now.mind !== 'steer', `${name}: and the swan is no longer steered`, now.mind);
      check(now.gl === 0 && problems.length === 0, `${name}: no errors along the way`, problems.slice(0, 3).join(' | '));
      await context.close();
    }
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
