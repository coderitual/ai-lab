// Dev tool: the automated run-through, run before every push.
//
//   node tools/playtest.cjs http://localhost:4190/            the production build (npm run build && npm run preview)
//   node tools/playtest.cjs http://localhost:5190/ split touch  only the sections whose names are given
//
// Without a URL it takes $PREVIEW_URL, or http://localhost:4190/ (vite.config.js's preview port).
//
// It drives the game through its real input paths (key events, pointer events, a stand-in for the gamepad
// API, clicks on the HUD's buttons) and asks the page how the run went through window.__dreamcar (state(),
// stats()). Every claim is one named check, PASS or FAIL; any console error, page error or WebGL warning on a
// page is a failure of that page. It ends with a count and exits non-zero if anything failed.
//
// Each page is stepped by hand (?manual): skip(seconds) runs the fixed step without drawing, advance(seconds,
// fps) draws every frame. Pages are small and on the low tier, and most checks need no picture, because
// software WebGL is slow; the last sections draw one small frame of each tier at each time of day.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const BASE = (argv[0] || process.env.PREVIEW_URL || 'http://localhost:4190/').replace(/\/?$/, '/');
const ONLY = argv.slice(1);

let checks = 0;
let failures = 0;
const failed = [];
let section = '';
function check(name, ok, detail = '') {
  checks++;
  if (!ok) {
    failures++;
    failed.push(`${section}: ${name}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
}

let browser;
/** Messages that are not problems: Chromium's own notes about software rendering and readbacks. */
const BENIGN = [/GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/, /swiftshader/i];

/** A fresh page (its own context: its own storage) on `query`, ready to step. */
async function open(query, { w = 320, h = 180, mobile = false, storage = true, init = null, gpu = true, dpr = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dpr });
  if (!storage) {
    await context.addInitScript(() => {
      const no = () => {
        throw new DOMException('storage switched off', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: no, configurable: true });
    });
  }
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (!BENIGN.some((re) => re.test(text))) problems.push(`[${m.type()}] ${text}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const started = Date.now();
  await page.goto(BASE + query, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
  const ok = await page.evaluate('!!window.__dreamcar');
  // no picture needed: the frame still runs (input, cameras, HUD), only the GPU's work is left out
  if (ok && !gpu) await page.evaluate('window.__dreamcar.game.draw = () => {}');
  const p = {
    page,
    context,
    problems,
    loadMs: Date.now() - started,
    ok,
    state: () => page.evaluate('window.__dreamcar.state()'),
    d0: async () => (await page.evaluate('window.__dreamcar.state()')).drivers[0],
    /** Another address in the same page (the same storage), ready to step. */
    async go(q) {
      await page.goto(BASE + q, { waitUntil: 'load', timeout: 300000 });
      await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
      check(`${q} loads`, await page.evaluate('!!window.__dreamcar'));
    },
    skip: (s) => page.evaluate(`window.__dreamcar.skip(${s})`),
    advance: (s, fps = 30) => page.evaluate(`window.__dreamcar.advance(${s}, ${fps})`),
    /** Step without drawing at `fps` frames a second (the fixed step does not care how often it is asked). */
    steps: (s, fps) => page.evaluate(([s, fps]) => {
      const e = window.__dreamcar.engine;
      const n = Math.round(s * fps);
      for (let i = 0; i < n; i++) e.advance(e.paused ? 0 : 1 / fps, 1 / fps, false);
    }, [s, fps]),
    /** Skip in chunks until the condition (evaluated on state()) holds, or `max` s have gone by. */
    until: async (cond, max = 600, chunk = 5) => {
      for (let t = 0; t < max; t += chunk) {
        const s = await page.evaluate('window.__dreamcar.state()');
        if (cond(s)) return s;
        await page.evaluate(`window.__dreamcar.skip(${chunk})`);
      }
      return page.evaluate('window.__dreamcar.state()');
    },
    async close(label = 'this page') {
      check(`${label}: no console errors, page errors or WebGL warnings`, problems.length === 0,
        problems.length ? `${problems.length}: ${problems.slice(0, 3).join(' | ').slice(0, 400)}` : '');
      await context.close();
    },
  };
  check(`${query || '/'} loads (${(p.loadMs / 1000).toFixed(0)} s)`, ok);
  return p;
}

const toGo = (p) => p.until((s) => s.phase === 'run' && s.clock > 0, 30, 0.5);
const press = (p, key) => p.page.keyboard.press(key);
const down = (p, key) => p.page.keyboard.down(key);
const up = (p, key) => p.page.keyboard.up(key);
const pointer = (p, type, id, x, y) => p.page.evaluate(([type, id, x, y]) => {
  const el = document.getElementById('game');
  el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
}, [type, id, x, y]);
const visible = (p, selector) => p.page.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
}, selector);
const clickText = (p, text, scope = '.title') => p.page.click(`.hud ${scope} button:has-text("${text}")`, { timeout: 60000 });

// ---- sections -----------------------------------------------------------------------------------------------

const SECTIONS = {
  /** The title: its choices, the time of day buttons, the attract lap after idling, then into a run. */
  async title() {
    const p = await open('?manual&q=low', { w: 480, h: 270, gpu: false });
    const times = await p.page.evaluate('Object.keys(window.__dreamcar.times)');
    let s = await p.state();
    check('opens on the title', s.phase === 'title', s.phase);
    check('the title panel is shown', await visible(p, '.hud .title'));
    const buttons = await p.page.evaluate(`[...document.querySelectorAll('.timechoice button')].map((b) => b.textContent)`);
    check('one time-of-day button per time lighting.js has', buttons.length === times.length, `${buttons.join(', ')} for ${times.join(', ')}`);
    for (let i = 0; i < times.length; i++) {
      await p.page.click(`.timechoice button:nth-child(${i + 1})`);
      await p.advance(1.5);
      s = await p.state();
      check(`the ${buttons[i]} button switches the world to ${times[i]}`, s.time === times[i], s.time);
    }
    await clickText(p, 'Two players');
    await p.advance(0.1);
    check('Two players chooses split screen', (await p.state()).mode === 'split');
    await clickText(p, 'One player');
    await p.advance(0.1);
    s = await p.state();
    check('One player goes back to solo', s.mode === 'solo' && s.drivers.length === 1, `${s.mode}, ${s.drivers.length} drivers`);
    // idle: the attract lap
    await p.skip(10);
    check('no attract lap after 10 s', !(await p.state()).attract);
    s = await p.until((x) => x.attract, 40, 2);
    check('the attract lap starts after idling on the title', s.attract && s.phase === 'title');
    await p.skip(8);
    s = await p.state();
    check('the autopilot drives it', s.drivers[0].driver === 'auto' && s.drivers[0].kmh > 30, `${s.drivers[0].kmh} km/h`);
    await press(p, 'KeyX');
    await p.skip(1);
    s = await p.state();
    check('a key ends the attract lap', !s.attract, `attract ${s.attract}`);
    await press(p, 'Enter');
    await p.skip(0.2);
    s = await p.state();
    check('Enter starts a solo run (the countdown)', s.phase === 'countdown' && s.mode === 'solo', s.phase);
    check('the run starts on the grid at rest', Math.abs(s.drivers[0].kmh) < 1, `${s.drivers[0].kmh} km/h`);
    await p.close('title');
  },

  /** A solo run driven by key events: every control and every key the game has. */
  async keys() {
    const p = await open('?manual&q=low&auto&time=day', { w: 480, h: 270, gpu: false });
    let s = await p.state();
    check('?auto starts a countdown', s.phase === 'countdown');
    await down(p, 'KeyW');
    await p.skip(1);
    check('held on the grid during the countdown', Math.abs((await p.d0()).kmh) < 0.5);
    s = await toGo(p);
    await p.skip(4);
    let d = await p.d0();
    check('W: throttle, the car accelerates', d.throttle > 0.5 && d.kmh > 60, `${d.kmh} km/h, gear ${d.gear}`);
    check('it changes up', d.gear >= 2, `gear ${d.gear}`);
    await down(p, 'KeyD');
    await p.skip(0.4);
    d = await p.d0();
    check('D steers right (steer > 0)', d.steer > 0.1, `steer ${d.steer}`);
    await up(p, 'KeyD');
    await down(p, 'KeyA');
    await p.skip(0.4);
    d = await p.d0();
    // (at speed a key is given only the lock that fits the speed, and it first has to undo the right turn)
    check('A steers left (steer < 0)', d.steer < -0.03, `steer ${d.steer}`);
    await up(p, 'KeyA');
    await p.skip(0.5);
    check('released, the steering returns to centre', Math.abs((await p.d0()).steer) < 0.05);
    await up(p, 'KeyW');
    await down(p, 'KeyS');
    await p.skip(0.5);
    d = await p.d0();
    check('S brakes', d.brake > 0.5, `brake ${d.brake}`);
    await p.skip(5);
    d = await p.d0();
    check('S held brings the car to rest, then reverses', d.gear === -1 || d.kmh < 0, `${d.kmh} km/h, gear ${d.gear}`);
    await p.skip(2);
    d = await p.d0();
    check('reversing', d.kmh < -3, `${d.kmh} km/h`);
    await up(p, 'KeyS');
    await p.skip(3);
    await down(p, 'KeyW');
    await p.skip(3);
    await down(p, 'Space');
    await p.skip(0.3);
    const hand = await p.page.evaluate('window.__dreamcar.game.racers[0].controls.handbrake');
    check('Space pulls the handbrake', hand > 0.5, `handbrake ${hand}`);
    await up(p, 'Space');
    await up(p, 'KeyW');
    await p.skip(0.5);
    const before = (await p.d0()).putBacks;
    await press(p, 'KeyR');
    await p.skip(0.5);
    d = await p.d0();
    const halfWidth = await p.page.evaluate('window.__dreamcar.game.track.halfWidth');
    check('R puts the car back on the road', d.putBacks === before + 1 && Math.abs(d.lat) < halfWidth, `put-backs ${d.putBacks}, lat ${d.lat} of ±${halfWidth}`);
    const cams = [d.camera];
    for (let i = 0; i < 4; i++) {
      await press(p, 'KeyC');
      await p.skip(0.1);
      cams.push((await p.d0()).camera);
    }
    check('C cycles the cameras and comes back round', new Set(cams).size === 4 && cams[4] === cams[0], cams.join(' > '));
    await down(p, 'KeyB');
    await p.skip(0.2);
    check('B held looks back', (await p.d0()).lookBack === true);
    await up(p, 'KeyB');
    await p.skip(0.2);
    check('released, it looks ahead again', (await p.d0()).lookBack === false);
    const high = (await p.state()).highBeam;
    await press(p, 'KeyH');
    await p.skip(0.1);
    check('H switches the high beam', (await p.state()).highBeam === !high);
    await press(p, 'KeyP');
    await p.skip(0.1);
    s = await p.state();
    const c1 = s.clock;
    await p.skip(2);
    s = await p.state();
    check('P pauses: the clock stops', s.paused && s.clock === c1, `clock ${c1} -> ${s.clock}`);
    check('the pause panel is shown', await visible(p, '.hud .pause'));
    await press(p, 'Escape');
    await p.skip(1);
    s = await p.state();
    check('Esc resumes', !s.paused && s.clock > c1);
    const t0 = s.time;
    await press(p, 'KeyN');
    await p.skip(1.5);
    s = await p.state();
    check('N changes the time of day mid-run', s.time !== t0 && s.phase === 'run', `${t0} -> ${s.time}`);
    await p.advance(0.2);
    await p.close('keys');
  },

  /** Autopilot runs: one lap and three, the results, the board, the medal, again and menu, the ghost, the reload. */
  async results() {
    const p = await open('?manual&q=low&auto&ap&laps=1&time=day', { w: 640, h: 360, gpu: false });
    let s = await p.until((x) => x.phase === 'results', 400, 10);
    const d = s.drivers[0];
    check('?laps=1: the autopilot finishes and the results come up', s.phase === 'results', s.phase);
    const L1 = await p.page.evaluate('window.__dreamcar.game.track.length');
    check('one lap time, in a sensible range (a mean of 20 to 100 m/s over the lap)', d.laps.length === 1 && d.laps[0].ms > (L1 / 100) * 1000 && d.laps[0].ms < (L1 / 20) * 1000,
      d.laps.map((l) => l.ms).join(', '));
    check('three splits, rising, the last = the lap', d.laps[0].splits.length === 3 && d.laps[0].splits[0] < d.laps[0].splits[1]
      && d.laps[0].splits[2] === d.laps[0].ms);
    check('a medal from the lap', ['gold', 'silver', 'bronze', null].includes(d.medal), String(d.medal));
    await p.advance(0.5);
    check('the results panel is shown', await visible(p, '.hud .results'));
    const text = await p.page.evaluate(`document.querySelector('.hud .results').innerText`);
    check('the results show the lap time', text.includes(fmt(d.laps[0].ms)), fmt(d.laps[0].ms));
    check('the board shows the medal rows', /gold/i.test(text) && /silver/i.test(text) && /bronze/i.test(text));
    const stored = await p.page.evaluate(`JSON.parse(localStorage.getItem('dreamcar.best.v2'))`);
    check('the lap is kept under dreamcar.best.v2 for day', stored && stored.day && stored.day.laps.length === 1);
    check('the ghost of the lap is kept', await p.page.evaluate(`!!localStorage.getItem('dreamcar.ghost.v2')`));
    await p.advance(0.2);
    await clickText(p, 'Again', '.results');
    await p.skip(0.2);
    s = await p.state();
    check('Again starts a new run', s.phase === 'countdown', s.phase);
    s = await toGo(p);
    await p.skip(20);
    s = await p.state();
    check('the ghost is there on the second run, and drawn', s.ghost.has && s.ghost.on && s.ghost.visible, JSON.stringify(s.ghost));
    await press(p, 'KeyG');
    await p.skip(0.1);
    check('G hides the ghost', !(await p.state()).ghost.visible);
    await press(p, 'KeyG');
    s = await p.until((x) => x.phase === 'results', 400, 10);
    check('second run finishes', s.phase === 'results');
    await p.advance(0.2);
    await clickText(p, 'Menu', '.results');
    await p.skip(1.5);
    s = await p.state();
    check('Menu goes back to the title', s.phase === 'title', s.phase);
    // a reload: the board and the ghost are still there
    await p.page.reload();
    await p.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
    await p.page.evaluate('window.__dreamcar.skip(0.1)');
    const kept = await p.page.evaluate(`window.__dreamcar.game._board ? window.__dreamcar.game._board.board : JSON.parse(localStorage.getItem('dreamcar.best.v2'))`);
    check('best laps kept across a reload (two laps for day)', kept && kept.day && kept.day.laps.length === 2,
      kept && kept.day ? kept.day.laps.map((l) => l.ms).join(', ') : 'none');
    check('nothing for the other times of day', Object.keys(kept).filter((k) => k !== 'length' && k !== 'day' && kept[k].laps.length).length === 0);
    s = await p.state();
    check('the ghost is still there after the reload', s.ghost.has, JSON.stringify(s.ghost));
    await p.close('results');
  },

  /** The full distance by autopilot, the default three laps. */
  async three() {
    const p = await open('?manual&q=low&auto&ap&nodraw', { w: 320, h: 180 });
    const s = await p.until((x) => x.phase === 'results', 900, 20);
    const d = s.drivers[0];
    check('three laps by default, finished', s.phase === 'results' && d.laps.length === 3 && d.finished, `${d.laps.length} laps`);
    check('the total is the sum of the laps', d.total === d.laps.reduce((a, l) => a + l.ms, 0), `${d.total}`);
    check('lap one standing, the others flying', d.laps[0].standing && !d.laps[1].standing && !d.laps[2].standing);
    check('flying laps faster than the standing lap', d.laps[1].ms < d.laps[0].ms, d.laps.map((l) => l.ms).join(', '));
    const board = await p.page.evaluate(`JSON.parse(localStorage.getItem('dreamcar.best.v2'))`);
    const t = s.time;
    check('a three-lap total on the board', board && board[t] && board[t].best3 === d.total, `${board && board[t] && board[t].best3}`);
    await p.close('three laps');
  },

  /** One lap at each time of day in one browser (one storage), then a reload: each time keeps its own board and ghost. */
  async board() {
    const p = await open('?manual&q=low&nodraw', { w: 320, h: 180 });
    const times = await p.page.evaluate('Object.keys(window.__dreamcar.times)');
    const laps = {};
    for (const time of times) {
      await p.go(`?manual&q=low&auto&ap&laps=1&nodraw&time=${time}`);
      const s = await p.until((x) => x.phase === 'results', 400, 10);
      laps[time] = s.drivers[0].laps.map((l) => l.ms);
      check(`a lap at ${time}`, s.time === time && laps[time].length === 1, `${s.time}: ${laps[time].join(', ')}`);
    }
    // a reload onto the title, as somebody coming back would see it
    await p.go('?manual&q=low');
    await p.page.evaluate('window.__dreamcar.game.draw = () => {}');
    const stored = await p.page.evaluate(`JSON.parse(localStorage.getItem('dreamcar.best.v2'))`);
    for (const time of times) {
      const kept = stored && stored[time] ? stored[time].laps.map((l) => l.ms) : [];
      check(`after a reload, ${time} keeps its own lap and only that`, kept.length === 1 && kept[0] === laps[time][0], `${kept.join(', ')}`);
    }
    for (let i = 0; i < times.length; i++) {
      await p.page.click(`.timechoice button:nth-child(${i + 1})`);
      await p.skip(1.5);
      const s = await p.state();
      const text = await p.page.evaluate(`(document.querySelector('.hud .title') || document.body).innerText`);
      check(`the title at ${times[i]}: its ghost is there and its board shows its lap`, s.time === times[i] && s.ghost.has && text.includes(fmt(laps[times[i]][0])),
        `${s.time}, ghost ${s.ghost.has}, looking for ${fmt(laps[times[i]][0])}`);
    }
    await p.close('board');
  },

  /** Laps are taken only by driving the whole lap forwards: not by backing over a line, not by jumping a sector. */
  async lines() {
    const p = await open('?manual&q=low&auto&laps=1&time=day', { w: 320, h: 180, gpu: false });
    const L = await p.page.evaluate('window.__dreamcar.game.track.length');
    await toGo(p);
    let d = await p.d0();
    check('the grid is behind the start line', d.s > L - 60, `s ${d.s} of ${L.toFixed(0)}`);
    await down(p, 'KeyW');
    let s = await p.until((x) => x.drivers[0].s > 25 && x.drivers[0].s < 500, 30, 0.5);
    await up(p, 'KeyW');
    d = s.drivers[0];
    check('over the start line at go: no lap, sector 1 armed', d.laps.length === 0 && d.sector === 0, `s ${d.s}, ${d.laps.length} laps, next line ${d.sector}`);
    const lap = d.lap;
    await down(p, 'KeyS');
    s = await p.until((x) => x.drivers[0].s > L - 40 && x.drivers[0].s < L - 15, 60, 0.25);
    await up(p, 'KeyS');
    check('reversed back over the start line', s.drivers[0].s > L - 40, `s ${s.drivers[0].s}`);
    await p.skip(3);
    await down(p, 'KeyW');
    s = await p.until((x) => x.drivers[0].s > 25 && x.drivers[0].s < 500, 40, 0.5);
    await up(p, 'KeyW');
    d = s.drivers[0];
    check('backing over the line and driving over it again takes no lap', d.laps.length === 0 && d.lap === lap && d.sector === 0,
      `lap ${lap} -> ${d.lap}, ${d.laps.length} laps, next line ${d.sector}`);
    // a jump past both sector lines (as a teleport would: farther in one step than any car goes), then the autopilot
    // drives on over the finish line
    await p.page.evaluate(() => {
      const g = window.__dreamcar.game;
      const r = g.racers[0];
      // past the last sector line, read from the Track
      const at = g.track.sectors[g.track.sectors.length - 1] + 100;
      const f = g.track.frameAt(at, {});
      const pt = g.track.pointAt(at, 0);
      r.vehicle.reset({ x: pt.x, z: pt.z, yaw: Math.atan2(f.tan.x, f.tan.z) });
      r.driver = r.auto;
    });
    await p.skip(0.5);
    s = await p.until((x) => x.drivers[0].s > 30 && x.drivers[0].s < 1000, 200, 2);
    d = s.drivers[0];
    check('after jumping both sector lines, crossing the finish takes no lap', d.laps.length === 0 && d.sector === 0 && s.phase === 'run',
      `s ${d.s}, ${d.laps.length} laps, next line ${d.sector}, ${s.phase}`);
    s = await p.until((x) => x.phase === 'results', 300, 5);
    check('the next whole lap is taken', s.phase === 'results' && s.drivers[0].laps.length === 1, `${s.phase}, ${s.drivers[0].laps.length} laps`);
    await p.close('lines');
  },

  /** No storage at all (a private window, switched off): the game runs and finishes, the board lives for the page. */
  async nostorage() {
    const p = await open('?manual&q=low&auto&ap&laps=1&nodraw', { storage: false });
    const s = await p.until((x) => x.phase === 'results', 400, 10);
    check('without storage the run finishes', s.phase === 'results' && s.drivers[0].laps.length === 1);
    await p.close('no storage');
  },

  /** Split screen with two key sets; then both finish a race (the autopilot takes over to save time). */
  async split() {
    const p = await open('?manual&q=low&laps=1', { w: 480, h: 270, gpu: false });
    await clickText(p, 'Two players');
    await press(p, 'Enter');
    await p.skip(0.1);
    let s = await p.state();
    check('split screen: two drivers', s.mode === 'split' && s.drivers.length === 2);
    s = await toGo(p);
    await down(p, 'KeyW');
    await p.skip(3);
    s = await p.state();
    check('W drives car one only', s.drivers[0].kmh > 40 && Math.abs(s.drivers[1].kmh) < 2, `${s.drivers[0].kmh} / ${s.drivers[1].kmh}`);
    await down(p, 'ArrowUp');
    await down(p, 'ArrowLeft');
    await p.skip(1);
    s = await p.state();
    check('the arrows drive car two', s.drivers[1].kmh > 10 && s.drivers[1].steer < 0, `${s.drivers[1].kmh} km/h, steer ${s.drivers[1].steer}`);
    await up(p, 'ArrowLeft');
    const cams = s.drivers.map((x) => x.camera);
    await press(p, 'Period');
    await p.skip(0.1);
    s = await p.state();
    check('. changes car two\'s camera only', s.drivers[1].camera !== cams[1] && s.drivers[0].camera === cams[0]);
    await up(p, 'KeyW');
    await up(p, 'ArrowUp');
    await p.page.evaluate(`(() => { for (const r of window.__dreamcar.game.racers) r.driver = r.auto; })()`);
    s = await p.until((x) => x.phase === 'results', 400, 10);
    check('both cars finish; the race ends', s.phase === 'results' && s.drivers.every((x) => x.finished && x.laps.length === 1));
    check('positions one and two', s.drivers.map((x) => x.position).sort().join() === '1,2');
    await p.advance(0.3);
    check('the results panel is shown', await visible(p, '.hud .results'));
    await p.close('split');
  },

  /** Two stand-in gamepads: the first drives car one, the second car two. */
  async pads() {
    const init = () => {
      const b = () => ({ pressed: false, value: 0 });
      const pad = (index) => ({ connected: true, index, id: `stand-in ${index}`, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, b) });
      window.__pads = [pad(0), pad(1)];
      navigator.getGamepads = () => [window.__pads[0], window.__pads[1], null, null];
    };
    const p = await open('?manual&q=low&auto&mode=split', { w: 480, h: 270, init, gpu: false });
    await toGo(p);
    await p.page.evaluate(() => {
      window.__pads[0].buttons[7] = { pressed: true, value: 1 };
      window.__pads[0].axes[0] = 0.6;
      window.__pads[1].buttons[7] = { pressed: true, value: 0.5 };
    });
    await p.advance(1.5, 20);
    let s = await p.state();
    check('pad one: right trigger drives car one, the stick steers right', s.drivers[0].kmh > 10 && s.drivers[0].steer > 0.2 && s.drivers[0].input === 'pad',
      `${s.drivers[0].kmh} km/h steer ${s.drivers[0].steer} ${s.drivers[0].input}`);
    check('pad two drives car two', s.drivers[1].kmh > 5 && s.drivers[1].input === 'pad', `${s.drivers[1].kmh} km/h ${s.drivers[1].input}`);
    await p.page.evaluate(() => {
      window.__pads[0].buttons[7] = { pressed: false, value: 0 };
      window.__pads[0].buttons[6] = { pressed: true, value: 0.8 };
      window.__pads[0].axes[0] = 0.04;
    });
    await p.advance(0.3, 20);
    s = await p.state();
    check('left trigger brakes; a small stick is inside the dead zone', s.drivers[0].brake > 0.3 && Math.abs(s.drivers[0].steer) < 0.05,
      `brake ${s.drivers[0].brake} steer ${s.drivers[0].steer}`);
    const cam = s.drivers[1].camera;
    await p.page.evaluate(() => (window.__pads[1].buttons[3] = { pressed: true, value: 1 }));
    await p.advance(0.1, 20);
    await p.page.evaluate(() => (window.__pads[1].buttons[3] = { pressed: false, value: 0 }));
    await p.advance(0.1, 20);
    check('Y on pad two changes car two\'s camera', (await p.state()).drivers[1].camera !== cam);
    await p.page.evaluate(() => (window.__pads[0].buttons[9] = { pressed: true, value: 1 }));
    await p.advance(0.1, 20);
    await p.page.evaluate(() => (window.__pads[0].buttons[9] = { pressed: false, value: 0 }));
    await p.advance(0.1, 20);
    check('Start pauses', (await p.state()).paused);
    await p.close('pads');
  },

  /**
   * Touch on phone-sized windows, upright and on its side: the fixed controls (Input's layoutOf, read from the page).
   * The slider's centre never moves: a thumb landing off it steers at once by that much, dragging does not move it,
   * and lifting recentres the knob. On auto the car drives with nothing touched and BRAKE lifts; on manual only GAS
   * drives. Several fingers at once, each control keeping its finger; nothing outside the controls drives; the
   * arrows; split screen on a tablet-sized window.
   */
  async touch() {
    const raw = (p, i = 0) => p.page.evaluate((i) => {
      const s = window.__dreamcar.game.input.touch[i].steer;
      return s ? s.value : null;
    }, i);
    const hand = (p, i = 0) => p.page.evaluate((i) => window.__dreamcar.game.racers[i].controls.handbrake, i);
    /** The centre (client px) of the first shown element matching `sel` in view `vi`. */
    const centreOf = (p, sel, vi = 0) => p.page.evaluate(([sel, vi]) => {
      const e = document.querySelectorAll('.hud .view')[vi].querySelector(sel);
      if (!e || e.closest('[hidden]') || getComputedStyle(e).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2, r.width];
    }, [sel, vi]);
    for (const [w, h] of [[393, 852], [852, 393]]) {
      const p = await open('?manual&q=low&auto&time=day', { w, h, mobile: true, gpu: false });
      const at = (L, b) => [L.x0 + b.x, L.y0 + b.y];
      let L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      const cx = L.x0 + L.slider.cx;
      const cy = L.y0 + L.slider.cy;
      const half = L.slider.half;
      check(`${w}x${h}: the slider's travel suits a thumb (${half.toFixed(0)} px either side), the pedals at least 64 px`,
        half >= 56 && half <= 92 && [L.brake, L.drift].every((b) => 2 * b.r >= 64));
      await toGo(p);
      check(`${w}x${h}: the controls are named on the first touch run`, await visible(p, '.hud .view .controls.naming .slider .name'));
      await p.advance(2);
      let d = await p.d0();
      check(`${w}x${h}: on auto the car drives from the green light with nothing touched`, d.input === 'touch' && d.throttle > 0.5 && d.kmh > 10, `${d.input} ${d.kmh} km/h`);
      const mid = await centreOf(p, '.slider .mid');
      check(`${w}x${h}: the slider's centre mark is drawn where Input measures from`, !!mid && Math.abs(mid[0] - cx) < 2 && Math.abs(mid[1] - cy) < 2, mid && `${mid[0]} vs ${cx}`);
      // a thumb landing off the centre steers at once by that much
      await pointer(p, 'pointerdown', 1, cx + half * 0.5, cy + 10);
      await p.steps(1 / 60, 60);
      let v = await raw(p);
      check(`${w}x${h}: a thumb landing half way right steers half right at once`, v !== null && Math.abs(v - 0.5) < 0.02, `steer ${v}`);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: and the car steers right`, d.steer > 0.03, `steer ${d.steer}`);
      let knob = await centreOf(p, '.slider .knob');
      check(`${w}x${h}: the knob is drawn under the thumb`, !!knob && Math.abs(knob[0] - (cx + half * 0.5)) < 3, knob && `${knob[0]} vs ${cx + half * 0.5}`);
      // dragging far past the end and back: the centre has not moved
      await pointer(p, 'pointermove', 1, cx + half * 3, cy);
      await p.steps(1 / 60, 60);
      check(`${w}x${h}: past the end is full lock and no more`, (await raw(p)) === 1);
      await pointer(p, 'pointermove', 1, cx - half * 0.3, cy - 30);
      await p.steps(1 / 60, 60);
      v = await raw(p);
      check(`${w}x${h}: after a drag the centre is where it was (back to 0.3 left of it reads -0.3)`, Math.abs(v + 0.3) < 0.02, `steer ${v}`);
      await pointer(p, 'pointermove', 1, cx, cy);
      await p.steps(1 / 60, 60);
      check(`${w}x${h}: on the centre mark the steering is straight`, Math.abs(await raw(p)) < 0.01);
      // a second thumb on the steering is ignored
      await pointer(p, 'pointerdown', 3, cx - half * 0.8, cy);
      await p.steps(1 / 60, 60);
      check(`${w}x${h}: a second thumb on the steering is ignored`, Math.abs(await raw(p)) < 0.01);
      await pointer(p, 'pointerup', 3, cx - half * 0.8, cy);
      // BRAKE with the steering thumb still down; the finger slides off it and keeps it
      await pointer(p, 'pointermove', 1, cx + half * 0.4, cy);
      const brake = at(L, L.brake);
      await pointer(p, 'pointerdown', 2, brake[0], brake[1]);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: BRAKE brakes and the power lifts, the steering thumb still steering`, d.brake > 0.5 && d.throttle < 0.1 && Math.abs((await raw(p)) - 0.4) < 0.02,
        `brake ${d.brake} throttle ${d.throttle}`);
      check(`${w}x${h}: BRAKE and the knob are drawn pressed`, await p.page.evaluate(`!!document.querySelector('.hud .view .pedal.brake.held') && !!document.querySelector('.hud .view .slider.held')`));
      await pointer(p, 'pointermove', 2, w / 2, h / 2);
      await p.steps(0.1, 60);
      check(`${w}x${h}: a finger sliding off BRAKE keeps it until it lifts`, (await p.d0()).brake > 0.5);
      await pointer(p, 'pointerup', 2, w / 2, h / 2);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: BRAKE let go: the power is back`, d.brake < 0.05 && d.throttle > 0.5, `brake ${d.brake} throttle ${d.throttle}`);
      // anywhere outside the controls does nothing
      const s0 = await raw(p);
      await pointer(p, 'pointerdown', 6, w * 0.7, h * 0.3);
      await pointer(p, 'pointerdown', 7, w * 0.25, h * 0.2);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: touches outside the controls do nothing to the car`, d.brake < 0.05 && d.throttle > 0.5 && (await raw(p)) === s0, `brake ${d.brake} throttle ${d.throttle}`);
      await pointer(p, 'pointerup', 6, 0, 0);
      await pointer(p, 'pointerup', 7, 0, 0);
      // DRIFT
      const drift = at(L, L.drift);
      await pointer(p, 'pointerdown', 4, drift[0], drift[1]);
      await p.advance(0.2);
      d = await p.d0();
      const hb = await hand(p);
      check(`${w}x${h}: DRIFT pulls the handbrake, does not brake, and the power lifts`, hb > 0.5 && d.brake < 0.05 && d.throttle < 0.1, `hand ${hb} brake ${d.brake} throttle ${d.throttle}`);
      check(`${w}x${h}: DRIFT is drawn pressed`, await p.page.evaluate(`!!document.querySelector('.hud .view .pedal.drift.held')`));
      await pointer(p, 'pointerup', 4, drift[0], drift[1]);
      // release: the knob springs back to the centre
      await pointer(p, 'pointerup', 1, cx + half * 0.4, cy);
      await p.advance(0.5);
      knob = await centreOf(p, '.slider .knob');
      d = await p.d0();
      check(`${w}x${h}: let go, the knob is back at the centre and the car straightens`, (await raw(p)) === null && Math.abs(knob[0] - cx) < 1.5 && Math.abs(d.steer) < 0.05,
        `knob ${knob[0]} vs ${cx}, steer ${d.steer}`);
      // a cancelled pointer, a lost tab, a turned device: nothing sticks
      await pointer(p, 'pointerdown', 8, brake[0], brake[1]);
      await pointer(p, 'pointercancel', 8, brake[0], brake[1]);
      await p.steps(0.1, 60);
      check(`${w}x${h}: a cancelled pointer lets BRAKE go`, (await p.d0()).brake < 0.05);
      for (const [label, fire] of [
        ['the window losing focus', `window.dispatchEvent(new Event('blur'))`],
        ['the device turned', `window.dispatchEvent(new Event('orientationchange'))`],
      ]) {
        await pointer(p, 'pointerdown', 9, cx + half * 0.6, cy);
        await pointer(p, 'pointerdown', 10, brake[0], brake[1]);
        await p.page.evaluate(fire);
        await p.advance(0.2);
        d = await p.d0();
        check(`${w}x${h}: ${label} lets every control go`, (await raw(p)) === null && d.brake < 0.05, `brake ${d.brake}`);
        // (the fingers lifting afterwards are no trouble)
        await pointer(p, 'pointerup', 9, 0, 0);
        await pointer(p, 'pointerup', 10, 0, 0);
      }
      // manual: GAS appears at the corner and is the only power
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:manual')`);
      await p.advance(0.3);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: Throttle manual shows GAS (kept under dreamcar.throttle)`, (await visible(p, '.hud .view .pedal.gas'))
        && (await p.page.evaluate(`localStorage.getItem('dreamcar.throttle')`)) === 'manual' && 2 * L.gas.r >= 64 && L.gas.r >= L.brake.r && L.brake.x < L.gas.x);
      check(`${w}x${h}: on manual nothing touched is no power`, (await p.d0()).throttle < 0.05);
      await pointer(p, 'pointerdown', 1, cx + half * 0.3, cy);
      await p.advance(0.3);
      check(`${w}x${h}: on manual the steering alone is no power`, (await p.d0()).throttle < 0.05);
      const gas = at(L, L.gas);
      await pointer(p, 'pointerdown', 5, gas[0], gas[1]);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: GAS drives, the steering thumb still steering`, d.throttle > 0.5 && Math.abs((await raw(p)) - 0.3) < 0.02, `throttle ${d.throttle}`);
      const brake2 = at(L, L.brake);
      await pointer(p, 'pointerdown', 2, brake2[0], brake2[1]);
      await p.advance(0.2);
      d = await p.d0();
      check(`${w}x${h}: GAS, BRAKE and the steering at once: three fingers, three controls`, d.brake > 0.5 && (await p.page.evaluate('window.__dreamcar.game.input.controlsOf(0).held.gas')), `brake ${d.brake}`);
      for (const id of [1, 2, 5]) await pointer(p, 'pointerup', id, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:auto')`);
      // the arrows
      await p.page.evaluate(`window.__dreamcar.game.action('steering:arrows')`);
      await p.advance(0.1);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: Steering arrows shows two arrows, no slider (kept under dreamcar.steering)`, (await visible(p, '.hud .view .arrow.right')) && !(await visible(p, '.hud .view .slider'))
        && (await p.page.evaluate(`localStorage.getItem('dreamcar.steering')`)) === 'arrows' && 2 * L.arrows.left.r >= 64);
      const right = at(L, L.arrows.right);
      await pointer(p, 'pointerdown', 1, right[0], right[1]);
      await p.steps(1 / 30, 60);
      const early = (await p.d0()).steer;
      await p.advance(0.4);
      d = await p.d0();
      check(`${w}x${h}: the right arrow steers right, wound on like a key`, (await raw(p)) === 1 && d.steer > 0.03 && early < d.steer, `${early} then ${d.steer}`);
      const left = at(L, L.arrows.left);
      await pointer(p, 'pointermove', 1, left[0], left[1]);
      await p.advance(0.4);
      check(`${w}x${h}: the thumb rocked onto the left arrow steers left`, (await p.d0()).steer < -0.03);
      await pointer(p, 'pointerup', 1, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('steering:slider')`);
      await p.advance(3.5);
      check(`${w}x${h}: the controls' names go after the first seconds, for good`, !(await visible(p, '.hud .view .controls.naming'))
        && (await p.page.evaluate(`localStorage.getItem('dreamcar.zones.v1')`)) === '1');
      // BRAKE held at a standstill reverses
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      const brake3 = at(L, L.brake);
      await pointer(p, 'pointerdown', 2, brake3[0], brake3[1]);
      await p.skip(12);
      d = await p.d0();
      check(`${w}x${h}: BRAKE held at a standstill reverses`, d.kmh < -1 || d.gear < 0, `${d.kmh} km/h, gear ${d.gear}`);
      await pointer(p, 'pointerup', 2, 0, 0);
      const cam = (await p.d0()).camera;
      const tapped = await p.page.evaluate(() => {
        const b = document.querySelector('.hud .view .touchcol .icon');
        if (!b) return false;
        b.click();
        return b.getAttribute('aria-label');
      });
      await p.advance(0.1);
      check(`${w}x${h}: the first touch button (${tapped}) works`, tapped && (await p.d0()).camera !== cam);
      await p.close(`touch ${w}x${h}`);
    }
    // split, side by side on a tablet: each half has its own fixed controls, scaled to it
    const W = 1180;
    const H = 820;
    const p = await open('?manual&q=low&auto&mode=split&time=day', { w: W, h: H, mobile: true, gpu: false });
    await p.page.evaluate(() => window.__dreamcar.set('view.split', 'wide'));
    await p.page.evaluate(() => window.__dreamcar.game.layout());
    const Ls = await p.page.evaluate(() => [window.__dreamcar.touchLayout(0), window.__dreamcar.touchLayout(1)]);
    check('split touch: each half has its own controls inside it', Ls[1].x0 >= W / 2 - 1 && Ls[0].x0 + Ls[0].brake.x + Ls[0].brake.r <= W / 2 && Ls[1].x0 + Ls[1].slider.cx - Ls[1].slider.half > W / 2,
      Ls.map((L) => `${L.x0}+${L.slider.cx}`).join(' / '));
    await toGo(p);
    await p.advance(1.5);
    const sx = Ls.map((L) => L.x0 + L.slider.cx);
    const sy = Ls.map((L) => L.y0 + L.slider.cy);
    await pointer(p, 'pointerdown', 1, sx[0] + Ls[0].slider.half * 0.6, sy[0]);
    await pointer(p, 'pointerdown', 2, sx[1] - Ls[1].slider.half * 0.6, sy[1]);
    await p.advance(0.3);
    let s = await p.state();
    check('split touch: both cars drive by themselves', s.drivers.every((d) => d.input === 'touch' && d.kmh > 5), s.drivers.map((d) => `${d.input} ${d.kmh}`).join(' / '));
    check('split touch: each thumb steers its own car', s.drivers[0].steer > 0.03 && s.drivers[1].steer < -0.03, s.drivers.map((d) => d.steer).join(' / '));
    await pointer(p, 'pointerdown', 3, Ls[1].x0 + Ls[1].drift.x, Ls[1].y0 + Ls[1].drift.y);
    await pointer(p, 'pointerdown', 4, Ls[0].x0 + Ls[0].brake.x, Ls[0].y0 + Ls[0].brake.y);
    await p.advance(0.2);
    const hands = await p.page.evaluate('window.__dreamcar.game.racers.map((r) => r.controls.handbrake)');
    s = await p.state();
    check('split touch: the right half\'s DRIFT is car two\'s, the left half\'s BRAKE car one\'s', hands[1] > 0.5 && hands[0] < 0.5 && s.drivers[0].brake > 0.5 && s.drivers[1].brake < 0.05,
      `hand ${hands.join('/')} brake ${s.drivers.map((d) => d.brake).join('/')}`);
    for (const id of [1, 2, 3, 4]) await pointer(p, 'pointerup', id, 0, 0);
    await p.close('split touch');
  },

  /**
   * A slide through the real input path (keys: power, a turn, the handbrake) at the default driving help and at
   * Sport: the car's own slide measure rises past the readout's threshold and the readout shows; the driving help
   * chosen in the options is stored and reaches the car.
   */
  async slide() {
    const p = await open('?manual&q=low&auto&time=day', { w: 640, h: 360, gpu: false });
    await p.page.evaluate(`window.__dreamcar.game.action('assists:sport')`);
    check('Driving help Sport is kept under dreamcar.assists and reaches the car',
      (await p.page.evaluate(`localStorage.getItem('dreamcar.assists')`)) === 'sport'
      && (await p.page.evaluate('window.__dreamcar.game.racers[0].vehicle.level.name')) === 'Sport');
    await toGo(p);
    await down(p, 'KeyW');
    await p.skip(4);
    let most = 0;
    let shown = false;
    await down(p, 'KeyD');
    await down(p, 'Space');
    for (let k = 0; k < 24; k++) {
      await p.advance(1 / 15, 30);
      if (k === 6) await up(p, 'Space');
      const a = await p.page.evaluate('window.__dreamcar.game.racers[0].vehicle.slide.angle');
      most = Math.max(most, a);
      if (a >= 12) shown = shown || (await p.page.evaluate(`!!document.querySelector('.hud .view .slide.on')`));
    }
    await up(p, 'KeyD');
    await up(p, 'KeyW');
    check('a handbrake turn at speed slides the car past 12 degrees', most >= 12, `${most.toFixed(1)} degrees at most`);
    check('the slide readout shows while it does', shown);
    await p.advance(2.5, 30);
    check('and fades once the slide is over', !(await p.page.evaluate(`!!document.querySelector('.hud .view .slide.on')`)));
    await p.page.reload({ waitUntil: 'load' });
    await p.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
    check('the driving help survives a reload', (await p.page.evaluate('window.__dreamcar.game.racers[0].vehicle.level.name')) === 'Sport');
    await p.close('slide');
    // on a phone at the default help: the car drives itself, the slider held over and a tap of DRIFT
    const q = await open('?manual&q=low&auto&time=day', { w: 852, h: 393, mobile: true, gpu: false });
    const L = await q.page.evaluate(() => window.__dreamcar.touchLayout(0));
    await toGo(q);
    await q.skip(4);
    const kmh = (await q.d0()).kmh;
    await pointer(q, 'pointerdown', 1, L.x0 + L.slider.cx + L.slider.half, L.y0 + L.slider.cy);
    most = 0;
    for (let k = 0; k < 30; k++) {
      if (k === 2) await pointer(q, 'pointerdown', 2, L.x0 + L.drift.x, L.y0 + L.drift.y);
      if (k === 8) await pointer(q, 'pointerup', 2, 0, 0);
      await q.advance(1 / 15, 30);
      most = Math.max(most, await q.page.evaluate('window.__dreamcar.game.racers[0].vehicle.slide.angle'));
    }
    await pointer(q, 'pointerup', 1, 0, 0);
    check('on a phone (Full help): power by itself, the slider over and a tap of DRIFT slide the car past 12 degrees', most >= 12, `${most.toFixed(1)} degrees at most from ${kmh} km/h`);
    await q.close('touch slide');
  },

  /** Resizing and rotating mid-run; a lost and restored WebGL context mid-run. */
  async window() {
    const p = await open('?manual&q=low&auto&ap&time=day', { w: 480, h: 270 });
    await toGo(p);
    await p.skip(3);
    for (const [w, h] of [[270, 480], [640, 360], [360, 200]]) {
      await p.page.setViewportSize({ width: w, height: h });
      await p.advance(0.2);
      const size = await p.page.evaluate('[window.__dreamcar.engine.width, window.__dreamcar.engine.height]');
      check(`resized to ${w}x${h}: the engine follows`, size[0] === w && size[1] === h, size.join('x'));
    }
    const s0 = await p.d0();
    // only the context loss's own messages are expected here
    const n = p.problems.length;
    await p.page.evaluate(() => {
      window.__lose = window.__dreamcar.engine.renderer.getContext().getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await p.skip(1);
    await p.page.evaluate(() => window.__lose.restoreContext());
    await p.page.waitForTimeout(500);
    await p.skip(2);
    await p.advance(0.3);
    const s1 = await p.d0();
    check('context lost and restored: the run goes on', s1.s !== s0.s && s1.kmh > 20, `${s0.s} -> ${s1.s}`);
    const fresh = p.problems.splice(n).filter((m) => !/CONTEXT_LOST|context lost|loseContext/i.test(m));
    p.problems.push(...fresh);
    const px = await p.page.evaluate(() => {
      const gl = window.__dreamcar.engine.renderer.getContext();
      return !gl.isContextLost();
    });
    check('the context is back', px);
    await p.close('resize and context loss');
  },

  /**
   * The HUD at every size it is laid out for, solo and in both split-screen arrangements: in the chase view nothing
   * covers the car, no readout or button covers another, everything is inside its view, and the touch buttons are
   * at least 44 px; on touch the fixed controls are among them, at least 64 px, inside the safe area and drawn
   * where Input finds them (a phone's notch and home bar are stood in for by setting the HUD's --sl, --sr, --st,
   * --sb). The places are read from the page: a point on the start straight and the most banked point of the lap.
   * The line's gap and the lap banner are forced on, so that they are checked too.
   */
  async hud() {
    // one page per kind of screen; the sizes are taken by resizing it, the layouts by setting the run up again
    const groups = [
      [1, false, [[1920, 1080], [1280, 720]]],
      [3, true, [[852, 393], [932, 430], [393, 852], [852, 393, { sl: 47, sr: 47, st: 0, sb: 21 }], [393, 852, { sl: 0, sr: 0, st: 59, sb: 34 }]]],
      [2, true, [[1180, 820]]],
    ];
    for (const [dpr, mobile, sizes] of groups) {
      const p = await open('?manual&q=low&auto&ap&time=day&dpr=1', { w: sizes[0][0], h: sizes[0][1], mobile, gpu: false, dpr });
      for (const [w, h, insets] of sizes) {
      await p.page.setViewportSize({ width: w, height: h });
      await p.page.evaluate((insets) => {
        const st = document.querySelector('.hud').style;
        for (const k of ['sl', 'sr', 'st', 'sb']) {
          if (insets) st.setProperty(`--${k}`, `${insets[k]}px`);
          else st.removeProperty(`--${k}`);
        }
      }, insets || null);
      for (const layout of insets ? ['solo'] : ['solo', 'wide', 'tall']) {
        await p.page.evaluate((layout) => {
          const g = window.__dreamcar.game;
          const mode = layout === 'solo' ? 'solo' : 'split';
          if (layout !== 'solo') window.__dreamcar.set('view.split', layout);
          if (g.mode !== mode) {
            g.leave();
            g.setup(mode);
            g.start();
          }
          g.layout();
        }, layout);
        const places = await p.page.evaluate(() => {
          const t = window.__dreamcar.game.track;
          let bank = 0;
          let sb = 0;
          const f = {};
          for (let s = 0; s < t.length; s += 10) {
            t.frameAt(s, f);
            if (Math.abs(f.bank) > bank) {
              bank = Math.abs(f.bank);
              sb = s;
            }
          }
          return [Math.round(t.length * 0.03), Math.round(sb)];
        });
        const hits = [];
        let small = [];
        for (const target of places) {
          await p.page.evaluate(async (target) => {
            const g = window.__dreamcar.game;
            for (let k = 0; k < 400; k++) {
              const d = (((target - g.racers[0].vehicle.s) % g.track.length) + g.track.length) % g.track.length;
              if (d < 3 || d > g.track.length - 60) break;
              window.__dreamcar.skip(d > 200 ? 2 : d > 40 ? 0.5 : 0.05);
            }
            const clock = g.race.clock;
            for (const v of g.views) {
              v.hud.flashLine(-1234, true, clock + 5);
              v.hud.lapBanner(1, 93456, true, clock + 5);
            }
            window.__dreamcar.advance(2 / 30, 30);
          }, target);
          const r = await p.page.evaluate(() => {
            const g = window.__dreamcar.game;
            const out = [];
            const tiny = [];
            const views = document.querySelectorAll('.hud .view');
            const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
            g.views.forEach((v, vi) => {
              const car = g.carRect(vi);
              const vr = views[vi].getBoundingClientRect();
              const boxes = [];
              for (const e of views[vi].children) {
                if (!shown(e)) continue;
                const name = e.className.split(' ')[0];
                if (!/^(lapblock|next|pos|lamps|map|cluster|touchcol|flash|banner|controls)$/.test(name)) continue;
                if (name === 'controls') {
                  // the fixed touch controls: the slider (its whole travel and knob) or the arrows, and the pedals,
                  // each inside the view less the safe area's insets where the view meets the screen's edge
                  const L = window.__dreamcar.touchLayout(vi);
                  const st = getComputedStyle(document.querySelector('.hud'));
                  const px = (v) => parseFloat(st.getPropertyValue(v)) || 0;
                  const z = g.views[vi].zone;
                  const safe = {
                    left: vr.left + (z.left < 0.001 ? px('--sl') : 0),
                    right: vr.right - (z.left + z.width > 0.999 ? px('--sr') : 0),
                    bottom: vr.bottom - (z.top + z.height > 0.999 ? px('--sb') : 0),
                  };
                  for (const b of e.querySelectorAll(':scope > div')) {
                    if (!shown(b)) continue;
                    const q = b.getBoundingClientRect();
                    const what = b.className.split(' ').slice(0, 2).join(' ');
                    boxes.push({ name: what, r: q });
                    if (!what.startsWith('slider') && (q.width < 64 || q.height < 64)) tiny.push(`${what} ${Math.round(q.width)}x${Math.round(q.height)}`);
                    if (q.left < safe.left - 0.5 || q.right > safe.right + 0.5 || q.bottom > safe.bottom + 0.5) out.push(`view ${vi}: ${what} outside the safe area`);
                    // and a finger finds it where it is drawn
                    const key = what.startsWith('slider') ? 'slider' : what.startsWith('arrow') ? null : what.split(' ')[1];
                    if (key && L[key]) {
                      const c = key === 'slider' ? [L.slider.cx, L.slider.cy] : [L[key].x, L[key].y];
                      if (Math.abs(q.left + q.width / 2 - L.x0 - c[0]) > 1 || Math.abs(q.top + q.height / 2 - L.y0 - c[1]) > 1) out.push(`view ${vi}: ${what} drawn off where Input finds it`);
                    }
                  }
                  continue;
                }
                if (name === 'touchcol') {
                  for (const b of e.querySelectorAll('button')) {
                    if (!shown(b)) continue;
                    const q = b.getBoundingClientRect();
                    boxes.push({ name: 'button', r: q });
                    if (views[vi].classList.contains('touch') && (q.width < 44 || q.height < 44)) tiny.push(`${Math.round(q.width)}x${Math.round(q.height)}`);
                  }
                  continue;
                }
                boxes.push({ name, r: e.getBoundingClientRect() });
              }
              const over = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
              for (const b of boxes) {
                // the banner and the gap are moments over the sky, never over the car
                if (over(b.r, car)) out.push(`view ${vi}: ${b.name} over the car`);
                if (b.r.left < vr.left - 1 || b.r.right > vr.right + 1 || b.r.top < vr.top - 1 || b.r.bottom > vr.bottom + 1) out.push(`view ${vi}: ${b.name} outside its view`);
              }
              for (let i = 0; i < boxes.length; i++)
                for (let j = i + 1; j < boxes.length; j++)
                  if (over(boxes[i].r, boxes[j].r)) out.push(`view ${vi}: ${boxes[i].name} over ${boxes[j].name}`);
            });
            return { out, tiny };
          });
          hits.push(...r.out.map((x) => `s${target}: ${x}`));
          small = small.concat(r.tiny);
        }
        const label = `${w}x${h}${mobile ? ` (touch, x${dpr})` : ''}${insets ? ' with insets' : ''} ${layout}`;
        check(`${label}: nothing over the car, nothing over anything else, all inside the view`, hits.length === 0, [...new Set(hits)].join('; '));
        if (mobile) check(`${label}: touch buttons at least 44 px`, small.length === 0, small.join(', '));
      }
      }
      await p.close(`hud x${dpr}${mobile ? ' touch' : ''}`);
    }
  },

  /**
   * The options, on the title and on the pause sheet: quality (kept under dreamcar.quality, applied by reloading;
   * ?q= wins), sound, time of day, units, map; reachable by keyboard and by a pad.
   */
  async options() {
    const p = await open('?manual&time=day', { w: 960, h: 540, gpu: false });
    const tier0 = await p.page.evaluate('window.__dreamcar.stats().tier');
    await clickText(p, 'Options');
    await p.advance(0.1);
    check('Options opens the options sheet over the title', (await visible(p, '.hud .options')) && !(await visible(p, '.hud .title')));
    const rows = await p.page.evaluate(`[...document.querySelectorAll('.hud .options .optlabel')].filter((e) => !e.closest('[hidden]')).map((e) => e.textContent)`);
    check('it offers quality, sound, time of day, units and the map', rows.length >= 4 && /quality/i.test(rows.join()) && /time/i.test(rows.join()), rows.join(', '));
    check('at a desk it does not offer the touch steering and throttle', !/steering|throttle/i.test(rows.join()));
    const auto = await p.page.evaluate(`document.querySelector('.hud .options button[data-value="auto"]').classList.contains('on')`);
    check(`with nothing chosen the quality is Auto (drawing at ${tier0})`, auto);
    // units
    await clickText(p, 'mph', '.options');
    await p.advance(0.1);
    check('mph is kept under dreamcar.units', (await p.page.evaluate(`localStorage.getItem('dreamcar.units')`)) === 'mph');
    // map
    await clickText(p, 'Hidden', '.options');
    await p.advance(0.1);
    check('the map can be hidden (kept under dreamcar.map)', (await p.page.evaluate(`localStorage.getItem('dreamcar.map')`)) === 'off');
    // sound
    if (await visible(p, '.hud .options .optrow:nth-of-type(3)')) {
      await clickText(p, 'Off', '.options');
      await p.advance(0.1);
      check('sound off from the options', await p.page.evaluate('window.__dreamcar.game.muted === true'));
      await clickText(p, 'On', '.options');
      await p.advance(0.1);
      check('sound on again', await p.page.evaluate('window.__dreamcar.game.muted === false'));
    }
    // time of day from the options
    const times = await p.page.evaluate('Object.keys(window.__dreamcar.times)');
    const other = times.find((t) => t !== 'day');
    if (other) {
      await p.page.click(`.hud .options .segment button:has-text("${await p.page.evaluate((t) => document.querySelector('.hud .timechoice button:nth-child(' + (Object.keys(window.__dreamcar.times).indexOf(t) + 1) + ')').textContent, other)}")`);
      await p.advance(1);
      check(`the time of day from the options (${other})`, (await p.state()).time === other);
    }
    // a pad's d-pad and A: down moves the focus, A presses
    await p.page.evaluate(`document.activeElement && document.activeElement.blur()`);
    await p.page.evaluate(`window.__dreamcar.game.action('nav:down')`);
    const f1 = await p.page.evaluate('document.activeElement && document.activeElement.textContent');
    await p.page.evaluate(`window.__dreamcar.game.action('nav:down')`);
    const f2 = await p.page.evaluate('document.activeElement && document.activeElement.textContent');
    check('a pad moves through the options', !!f1 && !!f2 && f1 !== f2, `${f1} > ${f2}`);
    // Done, by keyboard: focus it and press Enter
    await p.page.focus('.hud .options .buttons button');
    await press(p, 'Enter');
    await p.advance(0.1);
    check('Done (Enter) goes back to the title', (await visible(p, '.hud .title')) && !(await visible(p, '.hud .options')));
    check('Tab reaches the options button', await p.page.evaluate(async () => {
      const b = [...document.querySelectorAll('.hud .title button')].find((x) => /options/i.test(x.textContent));
      return !!b && b.tabIndex >= 0;
    }));
    // into a run: the units and the map follow; the board is not on the run
    await press(p, 'Enter');
    await toGo(p);
    await p.advance(0.2);
    const unit = await p.page.evaluate(`document.querySelector('.hud .view .unit').textContent`);
    check('the speed reads in mph', /mph/i.test(unit), unit);
    check('the map is hidden on the run', !(await visible(p, '.hud .view .map')));
    check('no best-laps board on the run; the next time to beat is one line', !(await visible(p, '.hud .view .board')) && (await visible(p, '.hud .view .next')));
    // the pause sheet has the board and the options
    await press(p, 'KeyP');
    await p.advance(0.1);
    check('the pause sheet shows the board', await visible(p, '.hud .pause .boardlist'));
    await clickText(p, 'Options', '.pause');
    await p.advance(0.1);
    check('Options from the pause sheet', await visible(p, '.hud .options'));
    await press(p, 'Escape');
    await p.advance(0.1);
    check('Esc closes the options back to the pause sheet', (await visible(p, '.hud .pause')) && (await p.state()).paused);
    // quality: a choice is kept and the page is built again with it
    await clickText(p, 'Options', '.pause');
    await p.advance(0.1);
    await Promise.all([p.page.waitForNavigation({ waitUntil: 'load', timeout: 300000 }), clickText(p, 'Medium', '.options')]);
    await p.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
    check('Medium is kept under dreamcar.quality and the page reloads at medium', (await p.page.evaluate(`localStorage.getItem('dreamcar.quality')`)) === 'medium'
      && (await p.page.evaluate('window.__dreamcar.stats().tier')) === 'medium');
    await p.go('?manual&q=low&time=day');
    check('?q= in the address wins over the kept choice', (await p.page.evaluate('window.__dreamcar.stats().tier')) === 'low');
    await p.go('?manual&time=day');
    await clickText(p, 'Options');
    await Promise.all([p.page.waitForNavigation({ waitUntil: 'load', timeout: 300000 }), clickText(p, 'Auto', '.options')]);
    await p.page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
    check('Auto again: the tier the probe chooses', (await p.page.evaluate('window.__dreamcar.stats().tier')) === tier0);
    await p.close('options');
    // on a touch screen: Steering (slider / arrows) and Throttle (auto / manual), kept on the device
    const t = await open('?manual&q=low&time=day', { w: 393, h: 852, mobile: true, gpu: false });
    await clickText(t, 'Options');
    await t.advance(0.1);
    const trows = await t.page.evaluate(`[...document.querySelectorAll('.hud .options .optlabel')].filter((e) => !e.closest('[hidden]')).map((e) => e.textContent)`);
    check('on touch the options offer Steering and Throttle', /steering/i.test(trows.join()) && /throttle/i.test(trows.join()), trows.join(', '));
    const on = (v) => t.page.evaluate((v) => document.querySelector(`.hud .options button[data-value="${v}"]`).classList.contains('on'), v);
    check('with nothing chosen: Slider and Auto', (await on('slider')) && (await on('auto')));
    await clickText(t, 'Arrows', '.options');
    await clickText(t, 'Manual', '.options');
    await t.advance(0.1);
    check('Arrows and Manual are kept under dreamcar.steering and dreamcar.throttle and reach the hands',
      (await t.page.evaluate(`localStorage.getItem('dreamcar.steering') + ' ' + localStorage.getItem('dreamcar.throttle')`)) === 'arrows manual'
      && (await t.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle')) === 'arrows manual');
    await t.go('?manual&q=low&time=day');
    check('and survive a reload', (await t.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle')) === 'arrows manual');
    await t.close('touch options');
    const n = await open('?manual&q=low&time=day', { w: 393, h: 852, mobile: true, gpu: false, storage: false });
    await n.page.evaluate(`window.__dreamcar.game.action('steering:arrows'); window.__dreamcar.game.action('throttle:manual')`);
    check('with no storage the touch choices still apply (for this page)', (await n.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle')) === 'arrows manual');
    await n.close('touch options, no storage');
  },

  /**
   * The start: one race clock; the camera dives from high behind the car onto its tail while the lamps come on,
   * is settled before they go out, and does not jump at go. Solo and both halves of split screen.
   */
  async start() {
    for (const mode of ['solo', 'split']) {
      const p = await open(`?manual&q=low&auto&ap&time=day&mode=${mode}`, { w: 640, h: 360, gpu: false });
      const sample = () => p.page.evaluate(() => {
        const g = window.__dreamcar.game;
        return {
          clock: g.race.clock,
          lit: g.race.lit,
          cams: g.views.map((v) => ({ y: v.camera.position.y - v.racer.vehicle.position.y, x: v.camera.position.x, z: v.camera.position.z, settled: v.rig.settled })),
        };
      });
      await p.advance(1 / 30, 30);
      const first = await sample();
      check(`${mode}: the run opens with the camera high over the grid`, first.cams.every((c) => c.y > 6), first.cams.map((c) => c.y.toFixed(1)).join(', '));
      // to the moment the last lamp is lit
      let s = first;
      while (s.lit < 5 && s.clock < 0) {
        await p.advance(1 / 30, 30);
        s = await sample();
      }
      await p.advance(0.1, 30);
      s = await sample();
      check(`${mode}: settled behind the car before the lamps go out`, s.clock < 0 && s.cams.every((c) => c.settled === 1), `clock ${s.clock.toFixed(2)}`);
      // across go: the camera moves smoothly (no cut)
      let worst = 0;
      let prev = s;
      while (prev.clock < 0.5) {
        await p.advance(1 / 30, 30);
        const n = await sample();
        n.cams.forEach((c, i) => (worst = Math.max(worst, Math.hypot(c.x - prev.cams[i].x, c.z - prev.cams[i].z, c.y - prev.cams[i].y))));
        prev = n;
      }
      check(`${mode}: no jump at go (largest camera step ${worst.toFixed(2)} m in a 30th of a second)`, worst < 0.5);
      await p.close(`start ${mode}`);
    }
  },

  /** The staging camera: ?photo= and __dreamcar.photo() put the camera where they say, hide the HUD, and give it back. */
  async photo() {
    const q = '?manual&q=low&auto&ap&time=day&t=20&photo=4.5,2.2,0.9,22,1,46';
    const read = (p) => p.page.evaluate(() => {
      const g = window.__dreamcar.game;
      const v = g.views[0];
      const car = v.racer.car.object;
      const c = v.camera;
      const h = Math.atan2(2 * (car.quaternion.w * car.quaternion.y + car.quaternion.x * car.quaternion.z), 1 - 2 * (car.quaternion.y ** 2 + car.quaternion.z ** 2));
      const dx = c.position.x - car.position.x;
      const dz = c.position.z - car.position.z;
      const back = -(dx * Math.sin(h) + dz * Math.cos(h));
      const right = -dx * Math.cos(h) + dz * Math.sin(h);
      const d = new c.position.constructor();
      c.getWorldDirection(d);
      const yaw = ((Math.atan2(d.x, d.z) - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      return {
        back: +back.toFixed(3), right: +right.toFixed(3), up: +(c.position.y - car.position.y).toFixed(3), yaw: +((yaw * 180) / Math.PI).toFixed(2),
        pitch: +((Math.asin(d.y) * 180) / Math.PI).toFixed(2), fov: +c.fov.toFixed(2), hud: !document.querySelector('.hud').hidden,
      };
    });
    const p = await open(q, { w: 640, h: 360, gpu: false });
    const a = await read(p);
    check('?photo= puts the camera behind, right of and above the car, turned left and up, with its lens', Math.abs(a.back - 4.5) < 0.01 && Math.abs(a.right - 2.2) < 0.01
      && Math.abs(a.up - 0.9) < 0.01 && Math.abs(a.yaw - 22) < 0.1 && Math.abs(a.pitch - 1) < 0.1 && Math.abs(a.fov - 46) < 0.01, JSON.stringify(a));
    check('the HUD is hidden while it is on', !a.hud);
    await p.page.evaluate('window.__dreamcar.photo(null)');
    const b = await read(p);
    check('photo(null) gives the camera back to the chase rig and shows the HUD', b.hud && Math.abs(b.fov - 46) > 1, JSON.stringify(b));
    await p.page.evaluate('window.__dreamcar.photo({ back: 4.5, right: 2.2, up: 0.9, yaw: 22, pitch: 1, fov: 46, hud: true })');
    const c = await read(p);
    check('photo({ hud: true }) keeps the HUD', c.hud && JSON.stringify({ ...c, hud: 0 }) === JSON.stringify({ ...a, hud: 0 }));
    await p.close('photo');
    const p2 = await open(q, { w: 640, h: 360, gpu: false });
    const a2 = await read(p2);
    check('the same address gives the same camera', JSON.stringify(a2) === JSON.stringify(a), `${JSON.stringify(a2)}`);
    await p2.close('photo again');
    // a named place: it brings its moment and its time of day (read from the page's PHOTOS table)
    const p3 = await open('?manual&q=low&photo=d4', { w: 640, h: 360, gpu: false });
    const preset = await p3.page.evaluate('window.__dreamcar.game.photo');
    const st = await p3.state();
    const named = await p3.page.evaluate(() => {
      const c = window.__dreamcar.game.views[0].camera;
      return { fov: c.fov, hud: !document.querySelector('.hud').hidden };
    });
    const clock = await p3.page.evaluate('window.__dreamcar.game.race.clock + window.__dreamcar.game.race.lead');
    check('?photo=d4: the named camera, its time of day and its moment', !!preset && Math.abs(named.fov - preset.fov) < 0.01 && !named.hud
      && st.time === preset.time && Math.abs(clock - preset.t) < 0.05, `${st.time}, ${st.phase}, ${clock.toFixed(2)} s into the run, fov ${named.fov}`);
    await p3.close('photo d4');
  },

  /** The same run is the same run: twice by keys, and by the autopilot at 30, 60 and 144 frames a second. */
  async determinism() {
    const keyRun = async () => {
      const p = await open('?manual&q=low&auto&time=day&nodraw', { w: 240, h: 135 });
      await toGo(p);
      await down(p, 'KeyW'); await p.skip(5);
      await down(p, 'KeyA'); await p.skip(0.7); await up(p, 'KeyA');
      await down(p, 'Space'); await p.skip(0.3); await up(p, 'Space');
      await p.skip(3); await up(p, 'KeyW');
      await down(p, 'KeyS'); await p.skip(2); await up(p, 'KeyS');
      const d = await p.d0();
      await p.close('key run');
      return d;
    };
    const a = await keyRun();
    const b = await keyRun();
    const pick = (d) => JSON.stringify([d.s, d.lat, d.kmh, d.gear, d.rpm, d.dist]);
    check('the same scripted key run twice: the same car at the end', pick(a) === pick(b), `${pick(a)} vs ${pick(b)}`);
    const laps = {};
    for (const fps of [60, 30, 144, 60]) {
      const p = await open('?manual&q=low&auto&ap&laps=1&time=day&nodraw', { w: 240, h: 135 });
      let s = await p.state();
      for (let k = 0; k < 40 && s.phase !== 'results'; k++) {
        await p.steps(10, fps);
        s = await p.state();
      }
      const ms = s.drivers[0].laps.map((l) => [l.ms, ...l.splits].join('/')).join(',');
      if (laps[fps] !== undefined) check('the autopilot lap again at 60 fps: identical to the millisecond', laps[fps] === ms, `${laps[fps]} vs ${ms}`);
      else laps[fps] = ms;
      await p.close(`ap at ${fps} fps`);
    }
    check('lap and splits identical at 30, 60 and 144 frames a second', laps[30] === laps[60] && laps[144] === laps[60] && laps[60] !== '',
      `30: ${laps[30]} · 60: ${laps[60]} · 144: ${laps[144]}`);
  },

  /** Each switch of the URL loads and runs without errors. */
  async params() {
    for (const q of ['ui=0', 'nodraw', 'mute', 'fx=0', 'probe=0', 'shadows=0', 'post=0']) {
      const p = await open(`?manual&q=low&auto&ap&time=day&${q}`, { w: 320, h: 180 });
      await p.skip(12);
      await p.advance(0.2);
      const s = await p.state();
      check(`?${q}: runs`, s.phase === 'run' && s.drivers[0].kmh > 20, `${s.phase}, ${s.drivers[0].kmh} km/h`);
      if (q === 'ui=0') check('?ui=0: no HUD', !(await visible(p, '.hud .view .cluster')));
      if (q === 'mute') {
        await press(p, 'KeyW');
        await p.advance(0.2);
        const audio = await p.page.evaluate(`(() => { const a = window.__dreamcar.game.audio; return a ? { muted: a.muted, state: a.ctx ? a.ctx.state : 'none' } : null; })()`);
        check('?mute: the sound is muted', audio && audio.muted !== false, JSON.stringify(audio));
      }
      await p.close(`?${q}`);
    }
  },

  /** Every tier draws a frame of every time of day without a WebGL error or warning. */
  async tiers() {
    for (const tier of ['low', 'medium', 'high']) {
      const p = await open(`?manual&q=${tier}&auto&ap&dpr=1&t=9`, { w: 240, h: 135 });
      const times = await p.page.evaluate('Object.keys(window.__dreamcar.times)');
      for (const time of times) {
        await p.page.evaluate((t) => {
          const g = window.__dreamcar.game;
          g.setTime ? g.setTime(t) : g._onAction(`time:${t}`, -1);
        }, time);
        await p.advance(2, 15);
        const s = await p.state();
        const n = p.problems.length;
        check(`${tier} tier, ${time}: a frame drawn`, s.time === time && (await p.page.evaluate('window.__dreamcar.stats().drawCalls')) > 0, `${s.time}, ${n} problems so far`);
      }
      await p.close(`${tier} tier`);
    }
  },
};

const fmt = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

(async () => {
  const started = Date.now();
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const names = Object.keys(SECTIONS).filter((n) => ONLY.length === 0 || ONLY.includes(n));
  const times = [];
  for (const name of names) {
    section = name;
    const t0 = Date.now();
    console.log(`\n— ${name} —`);
    try {
      await SECTIONS[name]();
    } catch (error) {
      check(`${name} ran to the end`, false, String(error && error.stack ? error.stack.split('\n').slice(0, 3).join(' ') : error));
    }
    times.push(`${name} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();
  console.log(`\n${times.join(' · ')}`);
  console.log(`playtest: ${checks} checks, ${failures} failed, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  process.exit(failures ? 1 : 0);
})();
