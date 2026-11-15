// Dev tool: smoke-test the real input paths in headless Chromium.
//
//   node tools/playtest.cjs http://localhost:5173/ [outDir]
//
// 1. Desktop: click Start, hold the arrow keys, check the craft answers.
// 2. Phone (iPhone-sized touch viewport, landscape + portrait): tap Start,
//    touch anywhere and drag to steer, pull down (or add a finger) to brake.
// 3. Finish a short race on autopilot and check results + "Race again".
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const base = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || 'playtest';
fs.mkdirSync(outDir, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const state = `(() => {
  const g = window.__bw.game; const c = g.crafts[0]; const i = g.input;
  return { phase: g.phase, race: g.race.state, kmh: c.speed * 3.6, yaw: c.yaw, steer: c.steer, throttle: c.throttle, brake: c.brake,
    isTouch: i.isTouch, touchSteer: i.touchSteer, braking: i.touchBrake > 0.12, pull: i.touchBrake, time: g.race.time, rank: g.race.player.rank,
    stick: g.hud.stick.hidden ? null : [parseFloat(g.hud.stick.style.left), parseFloat(g.hud.stick.style.top)], hint: !g.hud.touchHint.hidden,
    titleHidden: g.hud.title.hidden, resultsHidden: g.hud.results.hidden, touchClass: g.hud.root.classList.contains('touch'),
    w: g.engine.width, h: g.engine.height, pr: g.engine.pixelRatio, fov: g.engine.camera.fov };
})()`;

async function open(browser, { width, height, mobile, query = '' }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: !!mobile,
    hasTouch: !!mobile,
    userAgent: mobile ? IPHONE_UA : undefined,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('GL Driver')) problems.push(t);
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true && !!window.__bw', null, { timeout: 90000 });
  return { context, page, problems };
}

/** Step game time deterministically without drawing every frame (the page runs with ?manual). */
const run = (page, seconds) => page.evaluate(`window.__bw.skip(${seconds})`);

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ------------------------------------------------------------ desktop keys
  {
    const { context, page, problems } = await open(browser, { width: 1280, height: 720, query: '?manual&dpr=1' });
    let s = await page.evaluate(state);
    check('desktop: title is showing', s.phase === 'title' && !s.titleHidden);
    check('desktop: keyboard layout (no thumb pads)', s.touchClass === false);
    await page.screenshot({ path: path.join(outDir, 'desktop_title.jpg'), type: 'jpeg', quality: 88 });
    await page.click('#bw-start');
    s = await page.evaluate(state);
    check('desktop: Start button begins the countdown', s.phase === 'race' && s.race === 'countdown' && s.titleHidden);
    await run(page, 3.8);
    s = await page.evaluate(state);
    check('desktop: race is on after the countdown', s.race === 'racing', `state=${s.race}`);
    check('desktop: craft waits without throttle', s.kmh < 12, `${s.kmh.toFixed(1)} km/h`);
    await page.keyboard.down('ArrowUp');
    await run(page, 3);
    s = await page.evaluate(state);
    check('desktop: ArrowUp accelerates', s.kmh > 40 && s.throttle > 0.9, `${s.kmh.toFixed(0)} km/h`);
    const yaw0 = s.yaw;
    await page.keyboard.down('ArrowLeft');
    await run(page, 0.8);
    s = await page.evaluate(state);
    check('desktop: ArrowLeft turns to port', s.yaw > yaw0 + 0.15 && s.steer < -0.5, `yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowRight');
    await run(page, 1.2);
    const yaw1 = (await page.evaluate(state)).yaw;
    check('desktop: ArrowRight turns to starboard', yaw1 < s.yaw - 0.15, `yaw ${s.yaw.toFixed(2)} -> ${yaw1.toFixed(2)}`);
    await page.keyboard.up('ArrowRight');
    await page.screenshot({ path: path.join(outDir, 'desktop_race.jpg'), type: 'jpeg', quality: 88 });
    const v0 = (await page.evaluate(state)).kmh;
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await run(page, 1.2);
    s = await page.evaluate(state);
    check('desktop: ArrowDown brakes', s.kmh < v0 * 0.6 && s.brake > 0.9, `${v0.toFixed(0)} -> ${s.kmh.toFixed(0)} km/h`);
    await page.keyboard.up('ArrowDown');
    check('desktop: no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------ phone touch
  for (const [label, width, height] of [
    ['landscape', 844, 390],
    ['portrait', 390, 844],
  ]) {
    const { context, page, problems } = await open(browser, { width, height, mobile: true, query: '?manual' });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 12, radiusY: 12, force: 1 })) });
    let s = await page.evaluate(state);
    check(`phone ${label}: touch layout detected`, s.touchClass === true);
    check(`phone ${label}: canvas fills the screen`, s.w === width && s.h === height, `${s.w}x${s.h} @${s.pr}`);
    check(`phone ${label}: pixel ratio capped at 2`, s.pr <= 2, `pr=${s.pr}`);
    const overflow = await page.evaluate('[document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight]');
    check(`phone ${label}: page does not scroll`, !overflow[0] && !overflow[1]);
    const fits = await page.evaluate(`(() => { const r = document.querySelector('.bw-overlay .bw-panel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; })()`);
    check(`phone ${label}: title panel fits on screen`, fits);
    await page.screenshot({ path: path.join(outDir, `phone_${label}_title.jpg`), type: 'jpeg', quality: 88 });

    await page.touchscreen.tap(width / 2, await page.evaluate(`(() => { const r = document.getElementById('bw-start').getBoundingClientRect(); return r.top + r.height / 2; })()`));
    s = await page.evaluate(state);
    check(`phone ${label}: tapping Start begins the countdown`, s.phase === 'race' && s.race === 'countdown');
    await run(page, 3.8);
    await run(page, 2.5);
    s = await page.evaluate(state);
    check(`phone ${label}: throttle is automatic`, s.isTouch && s.kmh > 35, `${s.kmh.toFixed(0)} km/h`);

    s = await page.evaluate(state);
    check(`phone ${label}: a hint explains the touch controls until the first touch`, s.hint === true);

    // one thumb, anywhere on the screen (here: right of centre): press, drag right
    const lx = width * 0.62;
    const ly = height * 0.55;
    await touch('touchStart', [[lx, ly, 1]]);
    s = await page.evaluate(state);
    check(`phone ${label}: a stick appears under the thumb, wherever it lands`, s.stick && Math.abs(s.stick[0] - lx) < 2 && Math.abs(s.stick[1] - ly) < 2 && s.hint === false, JSON.stringify(s.stick));
    await touch('touchMove', [[lx + 30, ly, 1]]);
    await touch('touchMove', [[lx + 70, ly, 1]]);
    const yaw0 = (await page.evaluate(state)).yaw;
    await run(page, 0.8);
    s = await page.evaluate(state);
    check(`phone ${label}: dragging the thumb right steers right`, s.touchSteer > 0.9 && s.yaw < yaw0 - 0.15 && !s.braking, `steer=${s.touchSteer.toFixed(2)} yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);

    // the same thumb pulls down: brake, while still steering (one hand does it all)
    let v0 = s.kmh;
    await touch('touchMove', [[lx + 70, ly + 14, 1]]);
    s = await page.evaluate(state);
    check(`phone ${label}: a small downward drift does not brake`, !s.braking && s.pull === 0);
    await touch('touchMove', [[lx + 70, ly + 45, 1]]);
    await touch('touchMove', [[lx + 70, ly + 80, 1]]);
    await run(page, 1.0);
    s = await page.evaluate(state);
    check(`phone ${label}: pulling the thumb down brakes while it still steers`, s.braking && s.pull > 0.9 && s.kmh < v0 * 0.75 && s.touchSteer > 0.9, `${v0.toFixed(0)} -> ${s.kmh.toFixed(0)} km/h`);
    await page.screenshot({ path: path.join(outDir, `phone_${label}_race.jpg`), type: 'jpeg', quality: 88 });
    // easing the thumb back up lets go of the brake
    await touch('touchMove', [[lx + 70, ly + 40, 1]]);
    await touch('touchMove', [[lx + 70, ly + 4, 1]]);
    s = await page.evaluate(state);
    check(`phone ${label}: easing the thumb back up releases the brake`, !s.braking && s.touchSteer > 0.9);
    await run(page, 1.2);

    // a second finger anywhere is a brake too (two-thumb drivers)
    v0 = (await page.evaluate(state)).kmh;
    await touch('touchStart', [[lx + 70, ly + 4, 1], [width * 0.15, height * 0.3, 2]]);
    await run(page, 1.0);
    s = await page.evaluate(state);
    check(`phone ${label}: a second finger brakes while the first still steers`, s.braking && s.kmh < v0 * 0.8 && s.touchSteer > 0.9, `${v0.toFixed(0)} -> ${s.kmh.toFixed(0)} km/h`);

    // reverse the thumb quickly
    await touch('touchMove', [[lx - 40, ly + 4, 1], [width * 0.15, height * 0.3, 2]]);
    await run(page, 0.3);
    s = await page.evaluate(state);
    check(`phone ${label}: reversing the thumb steers left at once`, s.touchSteer < -0.5 && s.braking, `steer=${s.touchSteer.toFixed(2)}`);
    // lift only the second finger (CDP can only end all touches, so send the pointer event the browser would)
    await page.evaluate(`(() => { const i = window.__bw.game.input; i.surface.dispatchEvent(new PointerEvent('pointerup', { pointerId: i.brakePointer.id, pointerType: 'touch', bubbles: true })); })()`);
    s = await page.evaluate(state);
    check(`phone ${label}: lifting the second finger releases the brake only`, !s.braking && s.touchSteer < -0.5);
    await touch('touchEnd', []);
    await run(page, 0.3);
    s = await page.evaluate(state);
    check(`phone ${label}: lifting the thumb centres the steering and hides the stick`, s.touchSteer === 0 && Math.abs(s.steer) < 0.2 && s.stick === null, `steer=${s.steer.toFixed(2)}`);
    check(`phone ${label}: no console errors`, problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }

  // ---------------------------------------------- finish, results, race again
  {
    const { context, page, problems } = await open(browser, { width: 844, height: 390, mobile: true, query: '?manual&ap&laps=1&auto' });
    await page.evaluate('window.__bw.skip(64)');
    await run(page, 3.5);
    let s = await page.evaluate(state);
    check('results: shown after the flag', s.phase === 'results' && !s.resultsHidden, `phase=${s.phase} race=${s.race}`);
    const rows = await page.evaluate(`[...document.querySelectorAll('#bw-rbody tr')].map((tr) => tr.textContent.trim())`);
    check('results: lists all four drivers', rows.length === 4, rows.join(' / '));
    const fits = await page.evaluate(`(() => { const r = document.querySelector('.bw-overlay:not([hidden]) .bw-panel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()`);
    check('results: panel fits a landscape phone', fits);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'phone_results.jpg'), type: 'jpeg', quality: 88 });
    await page.touchscreen.tap(422, await page.evaluate(`(() => { const r = document.getElementById('bw-again').getBoundingClientRect(); return r.top + r.height / 2; })()`));
    s = await page.evaluate(state);
    check('results: Race again restarts on the grid', s.phase === 'race' && s.race === 'countdown' && s.resultsHidden && s.kmh < 5);
    await run(page, 6);
    s = await page.evaluate(state);
    check('results: second race runs', s.race === 'racing' && s.kmh > 30, `${s.kmh.toFixed(0)} km/h`);
    check('results: no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------ split screen
  {
    const { context, page, problems } = await open(browser, { width: 1280, height: 720, query: '?manual&dpr=1' });
    const st = `(() => { const g = window.__bw.game; return { mode: g.mode, phase: g.phase, race: g.race.state, views: g.views.length,
      rects: g.views.map((v) => [v.rect.left, v.rect.width]), aspects: g.views.map((v) => +v.camera.aspect.toFixed(2)), huds: document.querySelectorAll('.bw-view').length,
      split: g.hud.root.classList.contains('split'), names: g.race.racers.map((r) => r.name + ':' + r.control),
      p: g.views.map((v) => ({ kmh: v.racer.craft.speed * 3.6, yaw: v.racer.craft.yaw, power: v.racer.craft.power, misses: v.racer.misses, gate: v.racer.nextGate, rank: v.racer.rank, finished: v.racer.finished })) }; })()`;
    await page.click('#bw-split');
    let s = await page.evaluate(st);
    check('split: the button starts a two-driver race', s.mode === 'split' && s.phase === 'race' && s.race === 'countdown' && s.views === 2, JSON.stringify(s.names));
    check('split: two viewports side by side, each with its own HUD', s.split && s.huds === 2 && s.rects[0][0] === 0 && s.rects[1][0] === 0.5 && s.aspects[0] < 1, `aspects ${s.aspects}`);
    check('split: drivers are P1 and P2 plus two bots', s.names.join() === 'P1:local,P2:local,MIRA:bot,JUNO:bot', s.names.join());
    await run(page, 3.8);
    await page.keyboard.down('KeyW');
    await run(page, 2.5);
    s = await page.evaluate(st);
    check('split: W drives P1 only', s.p[0].kmh > 40 && s.p[1].kmh < 12, `P1 ${s.p[0].kmh.toFixed(0)} km/h, P2 ${s.p[1].kmh.toFixed(0)} km/h`);
    await page.keyboard.down('ArrowUp');
    await run(page, 2.5);
    s = await page.evaluate(st);
    check('split: ArrowUp drives P2', s.p[1].kmh > 40, `P2 ${s.p[1].kmh.toFixed(0)} km/h`);
    const y0 = s.p.map((p) => p.yaw);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowLeft');
    await run(page, 0.8);
    s = await page.evaluate(st);
    check('split: D turns P1 right while ArrowLeft turns P2 left', s.p[0].yaw < y0[0] - 0.15 && s.p[1].yaw > y0[1] + 0.15, `P1 ${y0[0].toFixed(2)}->${s.p[0].yaw.toFixed(2)}  P2 ${y0[1].toFixed(2)}->${s.p[1].yaw.toFixed(2)}`);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    // a miss for P2 must not touch P1
    await page.evaluate(`(() => {
      const g = window.__bw.game; const t = g.race.track;
      g.views.forEach((v, i) => { const r = v.racer; const gate = t.gates[r.nextGate];
        const p = t.pointAt(gate.s - 14, gate.lateral + gate.side * (i === 0 ? 5 : -5) + (i === 0 ? 0 : 0));
        r.craft.place(p.x + (i ? 0 : 0), p.z, p.heading, g.engine.simTime, 20);
        t.locate(p.x, p.z, -1, g.race._loc); r.locIndex = g.race._loc.index; r.s = g.race._loc.s; });
    })()`);
    await run(page, 1.6);
    s = await page.evaluate(st);
    check('split: marks are judged per driver', s.p[0].power === 1 && s.p[0].misses === 0 && s.p[1].power === 0 && s.p[1].misses === 1, JSON.stringify(s.p.map((p) => [p.power, p.misses])));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'split_race.jpg'), type: 'jpeg', quality: 88, timeout: 180000 });
    check('split: no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }
  {
    // a whole split-screen race on autopilot: finish, results, rematch, back to the menu
    const { context, page, problems } = await open(browser, { width: 1280, height: 720, query: '?manual&dpr=1&ap&laps=1&mode=split&auto' });
    const st = `(() => { const g = window.__bw.game; return { mode: g.mode, phase: g.phase, race: g.race.state, views: g.views.length, finished: g.views.map((v) => v.racer.finished),
      resultsHidden: g.hud.results.hidden, titleHidden: g.hud.title.hidden, head: document.getElementById('bw-rpos').textContent, rows: document.querySelectorAll('#bw-rbody tr').length, split: g.hud.root.classList.contains('split') }; })()`;
    await page.evaluate('window.__bw.skip(72)');
    let s = await page.evaluate(st);
    check('split: results come up once both drivers are in', s.phase === 'results' && !s.resultsHidden && s.finished.every(Boolean) && s.rows === 4, `${s.phase} ${s.head}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'split_results.jpg'), type: 'jpeg', quality: 88, timeout: 180000 });
    await page.click('#bw-again');
    s = await page.evaluate(st);
    check('split: Race again keeps both drivers', s.phase === 'race' && s.race === 'countdown' && s.views === 2 && s.mode === 'split');
    await page.evaluate('window.__bw.skip(72)');
    await page.click('#bw-menu');
    s = await page.evaluate(st);
    check('split: Back to menu returns to the solo title screen', s.phase === 'title' && !s.titleHidden && s.views === 1 && s.mode === 'solo' && !s.split);
    check('split: no console errors (full race)', problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }

  // ------------------------------------------------- rules: miss, off course, out
  {
    const { context, page, problems } = await open(browser, { width: 960, height: 540, query: '?manual&dpr=1&auto' });
    await run(page, 4.2);
    // put the craft just before mark 0 on the wrong side, rolling forward
    const place = (lateralFromMark) => page.evaluate(`(() => {
      const g = window.__bw.game; const r = g.race.player; const t = g.race.track;
      const gate = t.gates[r.nextGate];
      const p = t.pointAt(gate.s - 14, gate.lateral + gate.side * ${lateralFromMark});
      r.craft.place(p.x, p.z, p.heading, g.engine.simTime, 20);
      t.locate(p.x, p.z, -1, g.race._loc); r.locIndex = g.race._loc.index; r.s = g.race._loc.s;
      return gate.index;
    })()`);
    const info = `(() => { const g = window.__bw.game; const r = g.race.player; return { misses: r.misses, power: r.craft.power, gate: r.nextGate, retired: r.retired, state: g.race.state, phase: g.phase, toast: g.views[0].hud.toast.textContent, toastOn: g.views[0].hud.toast.classList.contains('show'), lat: r.lateral, off: r.offTimer }; })()`;
    await page.keyboard.down('ArrowUp');
    await place(5); // correct side
    await run(page, 1.6);
    let s = await page.evaluate(info);
    check('rules: a clean pass adds power', s.power === 1 && s.misses === 0 && s.gate === 1, JSON.stringify(s));
    await place(-5); // wrong side
    await run(page, 1.6);
    s = await page.evaluate(info);
    check('rules: a miss resets power and is counted', s.power === 0 && s.misses === 1 && s.gate === 2, JSON.stringify(s));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, 'rules_miss.jpg'), type: 'jpeg', quality: 88 });

    // off course: park outside the floats and wait
    await page.keyboard.up('ArrowUp');
    await page.evaluate(`(() => { const g = window.__bw.game; const r = g.race.player; const t = g.race.track; const p = t.pointAt(r.s + 30, t.halfWidth + 12); r.craft.place(p.x, p.z, p.heading, g.engine.simTime, 0); t.locate(p.x, p.z, -1, g.race._loc); r.locIndex = g.race._loc.index; r.s = g.race._loc.s; })()`);
    await run(page, 2);
    s = await page.evaluate(info);
    check('rules: leaving the floats shows a countdown', s.toastOn && /floats/i.test(s.toast) && s.off > 1.5, s.toast);
    await run(page, 3.6);
    s = await page.evaluate(info);
    check('rules: after 5 s you are put back on course', Math.abs(s.lat) < 20 && s.off === 0 && !s.toastOn, `lateral=${s.lat.toFixed(1)}`);

    // five misses and you are out
    await page.keyboard.down('ArrowUp');
    for (let i = 0; i < 4; i++) {
      await place(-5);
      await run(page, 1.6);
    }
    s = await page.evaluate(info);
    check('rules: the fifth miss ends your race', s.misses === 5 && s.retired && s.state === 'finished', JSON.stringify(s));
    await page.keyboard.up('ArrowUp');
    await run(page, 3);
    const out = await page.evaluate(`document.getElementById('bw-rpos').textContent`);
    check('rules: results say OUT', out === 'OUT', out);
    check('rules: no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
