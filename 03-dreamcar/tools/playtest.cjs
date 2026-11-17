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
async function open(query, { w = 320, h = 180, mobile = false, storage = true, init = null, gpu = true } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
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
    check('A steers left (steer < 0)', d.steer < -0.1, `steer ${d.steer}`);
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
    check('R puts the car back on the road', d.putBacks === before + 1 && Math.abs(d.lat) < 3, `put-backs ${d.putBacks}, lat ${d.lat}`);
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
    check('one lap time, in a sensible range', d.laps.length === 1 && d.laps[0].ms > 90000 && d.laps[0].ms < 160000,
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
      const at = 2100;
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

  /** Touch on phone-sized windows: the stick under the thumb, pull to brake, a second finger, the buttons; split. */
  async touch() {
    for (const [w, h] of [[390, 844], [844, 390]]) {
      const p = await open('?manual&q=low&auto&time=day', { w, h, mobile: true, gpu: false });
      await toGo(p);
      const x = w * 0.3;
      const y = h * 0.75;
      await pointer(p, 'pointerdown', 1, x, y);
      await p.advance(2);
      let d = await p.d0();
      check(`${w}x${h}: a thumb down drives (throttle is automatic)`, d.input === 'touch' && d.throttle > 0.5 && d.kmh > 10, `${d.input} ${d.kmh} km/h`);
      check(`${w}x${h}: the stick appears under the thumb`, await p.page.evaluate(([x, y]) => {
        // the stick is a point at the thumb's first touch (its ring is drawn round it)
        const e = [...document.querySelectorAll('.hud .stick')].find((s) => !s.hidden && getComputedStyle(s).display !== 'none');
        if (!e) return false;
        const r = e.getBoundingClientRect();
        return Math.abs(r.left - x) < 30 && Math.abs(r.top - y) < 30;
      }, [x, y]));
      await pointer(p, 'pointermove', 1, x + 50, y);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: thumb to the right steers right`, d.steer > 0.2, `steer ${d.steer}`);
      await pointer(p, 'pointermove', 1, x, y + 60);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: pulling down brakes`, d.brake > 0.3 && d.throttle < 0.2, `brake ${d.brake} throttle ${d.throttle}`);
      await pointer(p, 'pointermove', 1, x, y);
      await p.advance(0.3);
      await pointer(p, 'pointerdown', 2, w * 0.8, h * 0.3);
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: a second finger brakes`, d.brake > 0.3, `brake ${d.brake}`);
      await pointer(p, 'pointerup', 2, w * 0.8, h * 0.3);
      await pointer(p, 'pointerup', 1, x, y);
      await p.advance(0.5);
      d = await p.d0();
      check(`${w}x${h}: released, no throttle`, d.throttle < 0.1, `throttle ${d.throttle}`);
      const cam = d.camera;
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
    // split: a stick in each half
    const p = await open('?manual&q=low&auto&mode=split&time=day', { w: 844, h: 390, mobile: true, gpu: false });
    await toGo(p);
    await pointer(p, 'pointerdown', 1, 200, 300);
    await pointer(p, 'pointerdown', 2, 640, 300);
    await p.advance(1.5);
    await pointer(p, 'pointermove', 1, 250, 300);
    await pointer(p, 'pointermove', 2, 590, 300);
    await p.advance(0.3);
    const s = await p.state();
    check('split touch: each half drives its own car', s.drivers.every((d) => d.input === 'touch' && d.kmh > 5),
      s.drivers.map((d) => `${d.input} ${d.kmh}`).join(' / '));
    check('split touch: each thumb steers its own car', s.drivers[0].steer > 0.2 && s.drivers[1].steer < -0.2,
      s.drivers.map((d) => d.steer).join(' / '));
    await pointer(p, 'pointerup', 1, 250, 300);
    await pointer(p, 'pointerup', 2, 590, 300);
    await p.close('split touch');
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

  /** The HUD never covers the car in the default chase view, at the sizes the HUD was laid out for. */
  async hud() {
    for (const [w, h] of [[960, 540], [1280, 720], [1920, 1080], [844, 390], [390, 844], [1024, 768]]) {
      const p = await open('?manual&q=low&auto&ap&time=day', { w, h, mobile: w < 900 && h < 900, gpu: false });
      const hits = [];
      for (const target of [150, 1150]) {
        await p.page.evaluate(async (target) => {
          const g = window.__dreamcar.game;
          for (let k = 0; k < 400; k++) {
            const d = (((target - g.racers[0].vehicle.s) % g.track.length) + g.track.length) % g.track.length;
            if (d < 3 || d > g.track.length - 60) break;
            window.__dreamcar.skip(d > 200 ? 2 : d > 40 ? 0.5 : 0.05);
          }
          window.__dreamcar.advance(2 / 30, 30);
        }, target);
        const r = await p.page.evaluate(() => {
          const g = window.__dreamcar.game;
          const out = [];
          const views = document.querySelectorAll('.hud .view');
          g.views.forEach((v, vi) => {
            const car = v.racer.car;
            const cam = v.camera;
            const V = cam.position.constructor;
            car.object.updateMatrixWorld();
            cam.updateMatrixWorld();
            const vr = views[vi].getBoundingClientRect();
            let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
            const c = car.box.center, hh = car.box.half;
            for (let i = 0; i < 8; i++) {
              const q = new V(c.x + (i & 1 ? 1 : -1) * hh.x, c.y + (i & 2 ? 1 : -1) * hh.y, c.z + (i & 4 ? 1 : -1) * hh.z).applyMatrix4(car.object.matrixWorld).project(cam);
              x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
            }
            const box = { l: vr.left + ((x0 + 1) / 2) * vr.width, r: vr.left + ((x1 + 1) / 2) * vr.width, t: vr.top + ((1 - y1) / 2) * vr.height, b: vr.top + ((1 - y0) / 2) * vr.height };
            for (const e of views[vi].children) {
              if (e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') continue;
              if (!/lapblock|board|next|pos|lamps|map|cluster|touchcol/.test(e.className)) continue;
              const b = e.getBoundingClientRect();
              const ox = Math.min(b.right, box.r) - Math.max(b.left, box.l);
              const oy = Math.min(b.bottom, box.b) - Math.max(b.top, box.t);
              if (ox > 2 && oy > 2) out.push(`${e.className.split(' ')[0]} ${Math.round(ox)}x${Math.round(oy)}`);
            }
          });
          return out;
        });
        hits.push(...r.map((x) => `s${target}: ${x}`));
      }
      check(`${w}x${h}: no HUD box over the car (s 150 straight, s 1150 bend)`, hits.length === 0, hits.join('; '));
      await p.close(`hud ${w}x${h}`);
    }
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
