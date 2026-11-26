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

/** The split-screen night check's places (track metres) and how far apart the halves' road may be (playtest split). */
const SPLIT_NIGHT = { places: [240, 300, 420], factor: 1.5 };

/**
 * (split-bug lane) "On 2 players there is water on the track": at night one half of a split screen showed the wet
 * road as a pale sheet in the moon's light and the other, a few metres away, dark under the trees, because the trees
 * that cast into each view's shadow map were chosen by where its car stood (forest.js). Side by side on an upright
 * phone, at night: the same patch of road seen from both halves must be about as bright in both; the trees that cast
 * must not depend on where the car stands; and what prepareView sets for a view must be what that view's draw uses.
 */
async function splitNight() {
  const p = await open('?manual&q=low&auto&mode=split&time=night', { w: 393, h: 852, mobile: true });
  await p.page.evaluate(() => {
    window.__dreamcar.set('view.split', 'wide');
    window.__dreamcar.game.layout();
  });
  // (after go: before it the cameras dive in from the grid's sweep, not from behind the cars)
  await toGo(p);
  // under the trees after the start and further on, the cars abreast and one 9 m behind the other; the patch is the
  // middle of the road 14 m ahead of the leading car, seen by both halves
  for (const s0 of SPLIT_NIGHT.places) {
    for (const behind of [0, 9]) {
      const r = await p.page.evaluate(({ s0, behind }) => {
        const d = window.__dreamcar;
        const g = d.game;
        const { track } = g;
        const renderer = g.engine.renderer;
        const spots = [[s0, 2.5], [s0 - behind, -2.5]];
        g.racers.forEach((racer, i) => {
          const [s, lat] = spots[i];
          const at = track.pointAt(s, lat);
          const f = track.frameAt(s, {});
          racer.vehicle.reset({ x: at.x, z: at.z, yaw: Math.atan2(f.tan.x, f.tan.z) });
        });
        d.skip(0.05);
        for (const v of g.views) v.rig.snap(v.racer.vehicle);
        d.advance(0.1);
        g.engine.advance(0, 0, true);
        // read straight after the draw, in the same task, before the canvas is handed on
        const patch = track.pointAt(s0 + 14, 0);
        const gl = renderer.getContext();
        renderer.setRenderTarget(null);
        return g.views.map((v) => {
          const n = patch.clone().project(v.camera);
          const x = Math.round(v.rect.x + ((n.x + 1) / 2) * v.rect.w);
          const y = Math.round(v.rect.y + ((n.y + 1) / 2) * v.rect.h);
          const R = 7;
          const buf = new Uint8Array((2 * R + 1) ** 2 * 4);
          gl.readPixels(x - R, y - R, 2 * R + 1, 2 * R + 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          let sum = 0;
          for (let k = 0; k < buf.length; k += 4) sum += 0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2];
          return Math.round((10 * sum) / (buf.length / 4)) / 10;
        });
      }, { s0, behind });
      const ratio = Math.max(...r) / Math.max(1, Math.min(...r));
      check(`split at night, s ${s0}, ${behind ? `car two ${behind} m behind` : 'abreast'}: the road ahead as bright in both halves (within ${SPLIT_NIGHT.factor}x)`,
        ratio <= SPLIT_NIGHT.factor, `luma ${r.join(' / ')}, ${ratio.toFixed(2)}x`);
    }
  }

  // what prepareView set for each view is what that view's draw used, and nothing of one view leaks into the other's
  const used = await p.page.evaluate(() => {
    const g = window.__dreamcar.game;
    const w = g.world;
    const renderer = g.engine.renderer;
    let shares = null;
    let road = null;
    w.scene.traverse((o) => {
      if (!shares && o.material?.uniforms?.uShares) shares = o.material.uniforms.uShares.value;
      if (!road && o.material?.name === 'asphalt') road = o.material;
    });
    const glints = () => {
      const u = renderer.properties.get(road).uniforms?.uGlintPos;
      return u ? u.value.map((v) => [v.x, v.y, v.z, v.w].map((n) => n.toFixed(2)).join(',')).join(';') : 'none';
    };
    const box = () => [w.shadowBox.x, w.shadowBox.y, w.shadowBox.z].map((n) => n.toFixed(2)).join(',');
    const snap = () => ({
      shares: shares.version,
      glints: glints(),
      box: box(),
      mirror: w.mirror ? w.mirror.uniforms.uMirrorOn.value : -1,
      casters: w.forest.stats.view.casters,
    });
    const set = [];
    const atDraw = [];
    const uploaded = [];
    const shadowFor = [];
    const sm = renderer.shadowMap;
    const smRender = sm.render;
    sm.render = function (lights, scene, camera) {
      if (sm.needsUpdate) shadowFor.push(g.views.findIndex((v) => v.camera === camera));
      return smRender.apply(this, arguments);
    };
    const prepare = w.prepareView;
    w.prepareView = function (...a) {
      const r = prepare.apply(this, a);
      set.push(snap());
      return r;
    };
    g.pipeline.render = function (...a) {
      atDraw.push(snap());
      const r = Object.getPrototypeOf(this).render.apply(this, a);
      uploaded.push(renderer.properties.get(shares).__version === shares.version);
      return r;
    };
    try {
      g.engine.advance(0, 0, true);
    } finally {
      sm.render = smRender;
      w.prepareView = prepare;
      delete g.pipeline.render;
    }
    // the trees that cast into a view's map, with the map where that view put it, asked from either car
    const view = g.views[1];
    w.prepareView(view.camera, view.racer.car.object.position, g.beams);
    const own = w.forest.stats.view.casters;
    w.forest.prepareView(view.camera, g.views[0].racer.car.object.position, w.shadowBox);
    const other = w.forest.stats.view.casters;
    return { set, atDraw, uploaded, shadowFor, own, other };
  });
  check('split at night: each view\'s draw uses what its own prepareView set (lamp shares, glints, shadow box, mirror, casters)',
    used.set.length === 2 && JSON.stringify(used.set) === JSON.stringify(used.atDraw) && used.set[0].box !== used.set[1].box,
    JSON.stringify(used.atDraw.map((s) => ({ ...s, glints: s.glints.slice(0, 40) }))).slice(0, 400));
  check('split at night: the lamp shares are uploaded anew for each view before its draw',
    used.uploaded.length === 2 && used.uploaded.every(Boolean) && used.set[1].shares > used.set[0].shares,
    `uploaded ${used.uploaded.join('/')}, versions ${used.set.map((s) => s.shares).join('/')}`);
  check('split at night: the shadow map is drawn once for each view, by its own draw', used.shadowFor.join() === '0,1', used.shadowFor.join());
  check('split at night: the trees casting into a view\'s shadow map do not depend on where its car stands', used.own > 0 && used.own === used.other,
    `${used.own} from its own car, ${used.other} from the other`);
  await p.close('split at night');
}

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
    await splitNight();
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
   * The default, the one-thumb pad: it appears under the thumb (a ghost at the home place at rest), its centre
   * never moves while the thumb is down; across is the steering, down lifts and then brakes, on into the red arc
   * pulls the handbrake (with hysteresis); a second finger anywhere, and the HANDBRAKE button, are the handbrake;
   * held at a standstill it reverses; Hand left moves the ghost and the button; manual makes up the throttle.
   * Placement is tried at seven places, edges included (compressed travel, the nudge and the hold). A control is drawn pressed at once;
   * the controls step back after a few seconds. Then the slider with its pedals, the arrows, tilt (synthetic
   * deviceorientation events; refused, the pad steers), and split screen on a tablet-sized window.
   */
  async touch() {
    const raw = (p, i = 0) => p.page.evaluate((i) => {
      const s = window.__dreamcar.game.input.touch[i].steer;
      return s ? s.value : null;
    }, i);
    /** What the hands give the car this moment (Input.read for driver i). */
    const hands = (p, i = 0) => p.page.evaluate((i) => {
      const g = window.__dreamcar.game;
      const o = g.input.read({}, 'all', i);
      return { steer: o.steer, throttle: o.throttle, brake: o.brake, handbrake: o.handbrake };
    }, i);
    /** The placed pad of zone i (px from the zone's top left) while a thumb is on it. */
    const padAt = (p, i = 0) => p.page.evaluate((i) => {
      const st = window.__dreamcar.game.input.touch[i].steer;
      return st ? [st.cx, st.cy, st.hold, st.fl, st.fr, st.fd] : null;
    }, i);
    /** The pedal gauge's readings [brake, handbrake, throttle] in per cent, of view i. */
    const gauge = (p, i = 0) => p.page.evaluate((i) => [...document.querySelectorAll('.hud .view')[i].querySelectorAll('.gauge .bar')].map((b) => +b.getAttribute('aria-valuenow')), i);
    const hand = (p, i = 0) => p.page.evaluate((i) => window.__dreamcar.game.racers[i].controls.handbrake, i);
    /** The centre (client px) of the first shown element matching `sel` in view `vi`. */
    const centreOf = (p, sel, vi = 0) => p.page.evaluate(([sel, vi]) => {
      const e = document.querySelectorAll('.hud .view')[vi].querySelector(sel);
      if (!e || e.closest('[hidden]') || getComputedStyle(e).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2, r.width];
    }, [sel, vi]);
    const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
    const near2 = (a, b) => Math.abs(a - b) <= 1.5;
    // (the sensors granted, as Safari does once its prompt is answered yes; whether this Chromium has the prompt or not)
    const grant = () => {
      if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
    };
    for (const [w, h] of [[393, 852], [852, 393]]) {
      const p = await open('?manual&q=low&auto&time=day', { w, h, mobile: true, gpu: false, init: grant });
      const at = (L, b) => [L.x0 + b.x, L.y0 + b.y];
      let L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: the default steering is the one-thumb pad, bottom right, ${Math.round(2 * (L.pad ? L.pad.r : 0))} px across`, L.steering === 'pad' && !!L.pad
        && L.pad.cx > w / 2 && 2 * L.pad.r >= 140 && 2 * L.pad.r <= 170 && !L.brake && !L.gas);
      const P = await p.page.evaluate(() => window.__dreamcar.touch);
      const { cx: px0, cy: py0, s } = L.pad;
      const cx = L.x0 + px0;
      const cy = L.y0 + py0;
      if (w < h) check(`${w}x${h}: the pad's centre ${Math.round(w - cx)} px from the side, ${Math.round(h - cy)} px up (about 105 and 150, under the car)`, Math.abs(w - cx - 105) <= 4 && h - cy >= 125 && h - cy <= 155 && cy - L.pad.r >= h * 0.75 - 1);
      check(`${w}x${h}: the HANDBRAKE button in the other bottom corner, at least 64 px`, L.drift.x < w / 2 && 2 * L.drift.r >= 64 && L.drift.y > h * 0.7);
      await toGo(p);
      check(`${w}x${h}: the controls are named on the first touch run`, await visible(p, '.hud .view .controls.naming .stick .name'));
      const hint = await p.page.evaluate(`(document.querySelector('.hud .view .hint') || {}).textContent || ''`);
      check(`${w}x${h}: the first-run hint says how the pad works`, /touch anywhere/i.test(hint) && /pull back to brake/i.test(hint) && /red/i.test(hint), hint);
      await p.advance(2);
      let d = await p.d0();
      check(`${w}x${h}: on auto the car drives from the green light with nothing touched`, d.input === 'touch' && d.throttle > 0.5 && d.kmh > 10, `${d.input} ${d.kmh} km/h`);
      let gz = await gauge(p);
      check(`${w}x${h}: the pedal gauge shows the throttle full while the car drives itself on auto (brake ${gz[0]}, throttle ${gz[2]})`, gz[2] >= 90 && gz[0] === 0 && gz[1] === 0, gz.join('/'));
      const gbox = await p.page.evaluate(() => { const r = document.querySelector('.hud .view .gauge .bar').getBoundingClientRect(); const t = document.querySelector('.hud .view .gauge .bar.throttle').getBoundingClientRect(); return [r.width, r.height, t.width]; });
      check(`${w}x${h}: the gauge's bars are slim and tall (${gbox[0].toFixed(1)} x ${gbox[1].toFixed(0)} px)`, gbox[0] >= 4 && gbox[0] <= 12 && gbox[1] >= 30 && gbox[1] <= 80);
      const mid = await centreOf(p, '.stick.ghost');
      check(`${w}x${h}: the resting ghost is drawn where Input measures the home place from`, !!mid && Math.abs(mid[0] - cx) < 1.5 && Math.abs(mid[1] - cy) < 1.5, mid && `${mid[0]},${mid[1]} vs ${cx},${cy}`);
      // a thumb landing off the centre steers at once by that much; above the centre is full power
      const lock = P.pad.steer * s;
      const bra = P.pad.brake * s;
      await pointer(p, 'pointerdown', 1, cx, cy);
      check(`${w}x${h}: the pad is drawn held at once (before the next frame)`, await p.page.evaluate(`!!document.querySelector('.hud .view .stick.held')`));
      await p.steps(1 / 60, 60);
      let c = await hands(p);
      check(`${w}x${h}: a thumb landing on the centre asks for nothing: straight, full power`, c.steer === 0 && c.throttle === 1 && c.brake === 0 && c.handbrake === 0, JSON.stringify(c));
      await pointer(p, 'pointermove', 1, cx + lock * 0.5, cy - 10);
      c = await hands(p);
      check(`${w}x${h}: half way right steers half right, full power above the centre`, near(c.steer, 0.5) && c.throttle === 1 && c.brake === 0, JSON.stringify(c));
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: and the car steers right`, d.steer > 0.03, `steer ${d.steer}`);
      let knob = await centreOf(p, '.stick .knob');
      check(`${w}x${h}: the knob is drawn under the thumb`, !!knob && Math.abs(knob[0] - (cx + lock * 0.5)) < 3 && Math.abs(knob[1] - (cy - 10)) < 3, knob && `${knob[0]},${knob[1]}`);
      await pointer(p, 'pointermove', 1, cx + lock * 3, cy);
      check(`${w}x${h}: past the end is full lock and no more`, (await raw(p)) === 1);
      await pointer(p, 'pointermove', 1, cx - lock * 0.3, cy - 30);
      check(`${w}x${h}: after a drag the centre is where it was (0.3 left of it reads -0.3)`, near(await raw(p), -0.3), `steer ${await raw(p)}`);
      await pointer(p, 'pointermove', 1, cx + 1, cy);
      check(`${w}x${h}: no dead step at the centre (1 px is a little steering)`, (await raw(p)) > 0 && (await raw(p)) < 0.03);
      // down: the first quarter lifts, the rest brakes
      await pointer(p, 'pointermove', 1, cx, cy + bra * P.pad.lift * 0.5);
      c = await hands(p);
      check(`${w}x${h}: pulled down an eighth: half the throttle, no brake (lift)`, near(c.throttle, 0.5) && c.brake === 0, JSON.stringify(c));
      await pointer(p, 'pointermove', 1, cx, cy + bra * (P.pad.lift + (1 - P.pad.lift) * 0.5));
      c = await hands(p);
      check(`${w}x${h}: further: no throttle, half the brake`, c.throttle === 0 && near(c.brake, 0.5), JSON.stringify(c));
      await p.advance(0.3);
      d = await p.d0();
      check(`${w}x${h}: and the car brakes`, d.brake > 0.3 && d.throttle < 0.1, `brake ${d.brake}`);
      gz = await gauge(p);
      check(`${w}x${h}: the gauge shows the brake above zero and the throttle zero (${gz[0]}/${gz[2]})`, gz[0] > 0 && gz[2] === 0, gz.join('/'));
      await pointer(p, 'pointermove', 1, cx, cy + bra);
      c = await hands(p);
      check(`${w}x${h}: ${Math.round(bra)} px down: the full brake, no handbrake`, c.brake === 1 && c.handbrake === 0, JSON.stringify(c));
      // the handbrake: on beyond the trip, with hysteresis
      await pointer(p, 'pointermove', 1, cx + lock * 0.4, cy + (P.pad.trip - 3) * s);
      check(`${w}x${h}: just short of the red arc: still the brake`, (await hands(p)).handbrake === 0);
      await pointer(p, 'pointermove', 1, cx + lock * 0.4, cy + (P.pad.trip + 4) * s);
      c = await hands(p);
      check(`${w}x${h}: into the red arc: the handbrake, the steering still read, no brake, no power`, c.handbrake === 1 && c.brake === 0 && c.throttle === 0 && near(c.steer, 0.4), JSON.stringify(c));
      check(`${w}x${h}: the knob clicks into the red arc`, await p.page.evaluate(`!!document.querySelector('.hud .view .stick.tripped')`));
      await p.advance(0.2);
      check(`${w}x${h}: and the car's handbrake is pulled`, (await hand(p)) > 0.5);
      await pointer(p, 'pointermove', 1, cx, cy + (P.pad.untrip + 3) * s);
      check(`${w}x${h}: back up a little: still held (hysteresis)`, (await hands(p)).handbrake === 1);
      await pointer(p, 'pointermove', 1, cx, cy + (P.pad.untrip - 3) * s);
      c = await hands(p);
      check(`${w}x${h}: back above ${P.pad.untrip} px: let go, the brake again`, c.handbrake === 0 && c.brake === 1, JSON.stringify(c));
      // a second finger anywhere else is the handbrake while it is held; the pad keeps its own finger and its place
      await pointer(p, 'pointermove', 1, cx + lock * 0.4, cy - 20);
      const idBefore = () => p.page.evaluate(() => window.__dreamcar.game.input.touch[0].steer.id);
      await pointer(p, 'pointerdown', 3, cx - lock * 0.8, cy);
      c = await hands(p);
      check(`${w}x${h}: a second finger on the pad's own disc is the handbrake, and the pad still steers`, c.handbrake === 1 && near(c.steer, 0.4) && (await idBefore()) === 1, JSON.stringify(c));
      await pointer(p, 'pointerup', 3, 0, 0);
      await pointer(p, 'pointerdown', 6, w * 0.7, h * 0.3);
      await pointer(p, 'pointermove', 6, w * 0.2, h * 0.2);
      c = await hands(p);
      check(`${w}x${h}: a second finger far away is the handbrake (no power) and does not move or steal the pad`, c.handbrake === 1 && c.throttle === 0 && near(c.steer, 0.4) && (await idBefore()) === 1 && near((await padAt(p))[0], px0, 0.01) && near((await padAt(p))[1], py0, 0.01), JSON.stringify(c));
      await pointer(p, 'pointerup', 6, 0, 0);
      c = await hands(p);
      check(`${w}x${h}: lifting it lets the handbrake go; the pad's finger kept the pad`, c.handbrake === 0 && c.throttle === 1 && near(c.steer, 0.4), JSON.stringify(c));
      // the HANDBRAKE button, for the other thumb
      const hb = at(L, L.drift);
      await pointer(p, 'pointerdown', 4, hb[0], hb[1]);
      check(`${w}x${h}: HANDBRAKE is drawn pressed at once`, await p.page.evaluate(`!!document.querySelector('.hud .view .pedal.drift.held')`));
      await p.advance(0.2);
      d = await p.d0();
      check(`${w}x${h}: HANDBRAKE pulls the handbrake, does not brake, and the power lifts; the pad still steers`, (await hand(p)) > 0.5 && d.brake < 0.05 && d.throttle < 0.1 && near(await raw(p), 0.4), `brake ${d.brake} throttle ${d.throttle}`);
      await pointer(p, 'pointerup', 4, 0, 0);
      // let go: the knob springs back, the car straightens and drives on
      await pointer(p, 'pointerup', 1, 0, 0);
      await p.advance(0.5);
      const tf = await p.page.evaluate(`document.querySelector('.hud .view .stick .knob').style.transform`);
      d = await p.d0();
      c = await hands(p);
      check(`${w}x${h}: let go, the knob goes back to the centre, the steering straight and full power`, (await raw(p)) === null && /translate\(0(\.0)?px, 0(\.0)?px\)/.test(tf) && c.steer === 0 && c.throttle === 1,
        `${tf}, ${JSON.stringify(c)}`);
      // the pad appears under the thumb: at rest a faint ghost at the home place; a thumb landing anywhere else (not on
      // a HUD button) puts the pad's centre exactly there; it never moves while the thumb moves; the first input is zero
      await p.page.waitForTimeout(900);
      const ghost = await p.page.evaluate(() => {
        const v = document.querySelector('.hud .view');
        const g = v.querySelector('.stick.ghost');
        const l = v.querySelector('.stick:not(.ghost)');
        const r = g.getBoundingClientRect();
        return { go: parseFloat(getComputedStyle(g).opacity), lv: getComputedStyle(l).visibility, c: [r.left + r.width / 2, r.top + r.height / 2] };
      });
      check(`${w}x${h}: at rest the pad is a faint ghost at the home place (opacity ${ghost.go.toFixed(2)}), no live pad`, ghost.go > 0.15 && ghost.go < 0.5 && ghost.lv === 'hidden' && Math.abs(ghost.c[0] - cx) < 1.5 && Math.abs(ghost.c[1] - cy) < 1.5, JSON.stringify(ghost));
      const sideOf = (x) => (x > w / 2 ? -1 : 1); // the way with room
      const lockPx = lock;
      const spots = [
        ['left low', w * 0.2, h * 0.78],
        ['right low', w * 0.8, h * 0.78],
        ['centre', w * 0.5, h * 0.5],
        ['left high', w * 0.2, h * 0.22],
        ['right high', w * 0.8, h * 0.18],
      ];
      let was = null;
      for (const [name, x, y] of spots) {
        await pointer(p, 'pointerdown', 1, x, y);
        const pa = await padAt(p);
        const c0 = await hands(p);
        check(`${w}x${h}: thumb down ${name}: the pad's centre is the landing point`, !!pa && near2(pa[0], x) && near2(pa[1], y) && pa[2] === false, JSON.stringify(pa));
        check(`${w}x${h}: ${name}: the first input is exactly zero (straight, no brake, no handbrake)`, c0.steer === 0 && c0.brake === 0 && c0.handbrake === 0 && c0.throttle === 1, JSON.stringify(c0));
        if (was) check(`${w}x${h}: ${name}: a new touch puts it afresh (not where the last one was)`, Math.abs(pa[0] - was[0]) + Math.abs(pa[1] - was[1]) > 20);
        was = pa;
        await p.page.waitForTimeout(150);
        const dr = await centreOf(p, '.stick:not(.ghost)');
        check(`${w}x${h}: ${name}: and it is drawn there (held, ${dr ? Math.round(dr[2]) : 0} px across)`, !!dr && Math.abs(dr[0] - x) < 1.5 && Math.abs(dr[1] - y) < 1.5 && (await p.page.evaluate(`!!document.querySelector('.hud .view .stick.held')`)));
        const sd = sideOf(x);
        await pointer(p, 'pointermove', 1, x + sd * lockPx * 0.5, y);
        c = await hands(p);
        check(`${w}x${h}: ${name}: half the lock across reads ${sd * 0.5}`, near(c.steer, sd * 0.5), JSON.stringify(c));
        const room = h - y;
        await pointer(p, 'pointermove', 1, x, y + Math.min(bra * 0.5, room));
        c = await hands(p);
        check(`${w}x${h}: ${name}: down half the brake travel brakes ${(Math.min(bra * 0.5, room) / bra).toFixed(2)} of the way`, near(c.brake, Math.max(0, (Math.min(bra * 0.5, room) / bra - P.pad.lift) / (1 - P.pad.lift)), 0.03), JSON.stringify(c));
        await pointer(p, 'pointermove', 1, x + sd * 100, y - 60);
        const pb = await padAt(p);
        const dr2 = await centreOf(p, '.stick:not(.ghost)');
        check(`${w}x${h}: ${name}: dragged 100 px the centre has not moved (no trailing, no rebasing)`, near2(pb[0], x) && near2(pb[1], y) && !!dr2 && Math.abs(dr2[0] - x) < 1.5 && Math.abs(dr2[1] - y) < 1.5, JSON.stringify(pb));
        check(`${w}x${h}: ${name}: and 100 px across is full lock`, Math.abs((await hands(p)).steer) === 1);
        await pointer(p, 'pointerup', 1, 0, 0);
        c = await hands(p);
        check(`${w}x${h}: ${name}: lifted: straight on, no brake`, c.steer === 0 && c.brake === 0 && c.handbrake === 0);
      }
      // (the ghost is back at the home place after 0.4 s, the live pad gone)
      await p.page.waitForTimeout(1000);
      const gh2 = await p.page.evaluate(() => {
        const v = document.querySelector('.hud .view');
        return [parseFloat(getComputedStyle(v.querySelector('.stick.ghost')).opacity), getComputedStyle(v.querySelector('.stick:not(.ghost)')).visibility];
      });
      check(`${w}x${h}: after the thumb lifts the pad fades back to its ghost`, gh2[0] > 0.15 && gh2[0] < 0.5 && gh2[1] === 'hidden', JSON.stringify(gh2));
      // room at the edges: compressed travel (never under 60 %), else the centre is nudged inward by what is missing
      // and the input held at zero until the thumb has moved 6 px from where it landed
      const needSide = P.pad.steer * s;
      const needDown = P.pad.trip * s;
      const edges = [
        ['near the bottom edge', w * 0.5, h - 20, 'down', 20],
        ['a little short of room below', w * 0.5, h - 60, 'down', 60],
        ['near the left edge', 25, h * 0.5, 'left', 25],
        ['near the right edge', w - 25, h * 0.5, 'right', 25],
        ['a little short of room at the left', 50, h * 0.5, 'left', 50],
      ];
      for (const [name, x, y, dir, roomPx] of edges) {
        await pointer(p, 'pointerdown', 1, x, y);
        const pa = await padAt(p);
        const need = dir === 'down' ? needDown : needSide;
        const nudge = Math.max(0, 0.6 * need - roomPx);
        const ex = dir === 'left' ? x + nudge : dir === 'right' ? x - nudge : x;
        const ey = dir === 'down' ? y - nudge : y;
        const c0 = await hands(p);
        check(`${w}x${h}: ${name}: ${nudge > 0 ? `centre nudged inward by ${nudge.toFixed(1)} px and the input held` : 'centre at the landing point, travel compressed'}`,
          !!pa && near2(pa[0], ex) && near2(pa[1], ey) && pa[2] === (nudge > 0), JSON.stringify(pa));
        check(`${w}x${h}: ${name}: first input zero`, c0.steer === 0 && c0.brake === 0 && c0.handbrake === 0 && c0.throttle === 1, JSON.stringify(c0));
        const fac = dir === 'down' ? pa[5] : dir === 'left' ? pa[3] : pa[4];
        check(`${w}x${h}: ${name}: the travel is ${fac.toFixed(2)} of the normal, not under 0.6`, fac >= 0.6 - 1e-9 && fac <= 1 && near(fac, Math.max(0.6, Math.min(1, roomPx / need)), 0.01), `${fac}`);
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'down' ? 1 : 0;
        if (nudge > 0) {
          await pointer(p, 'pointermove', 1, x + dx * 4, y + dy * 4);
          c = await hands(p);
          check(`${w}x${h}: ${name}: 4 px in: still held at zero`, c.steer === 0 && c.brake === 0 && c.handbrake === 0 && c.throttle === 1, JSON.stringify(c));
          await pointer(p, 'pointermove', 1, x + dx * 7, y + dy * 7);
          c = await hands(p);
          check(`${w}x${h}: ${name}: 7 px in: the hold is over and the thumb reads`, (await padAt(p))[2] === false && (dir === 'down' ? c.brake > 0 || c.handbrake === 1 : Math.abs(c.steer) > 0), JSON.stringify(c));
        }
        // all the room there is reaches the full travel (the lock, or the handbrake's red)
        await pointer(p, 'pointermove', 1, x + dx * (roomPx + 0.5), y + dy * (roomPx + 0.5));
        c = await hands(p);
        check(`${w}x${h}: ${name}: the whole room there is reaches ${dir === 'down' ? 'the handbrake' : 'full lock'}`, dir === 'down' ? c.handbrake === 1 : Math.abs(c.steer) >= 0.999, JSON.stringify(c));
        // the disc is drawn inside the safe area
        await p.page.waitForTimeout(150);
        const base = await p.page.evaluate(() => {
          const r = document.querySelector('.hud .view .stick:not(.ghost) .base').getBoundingClientRect();
          return [r.left, r.top, r.right, r.bottom];
        });
        check(`${w}x${h}: ${name}: the disc is drawn inside the screen`, base[0] >= -1 && base[1] >= -1 && base[2] <= w + 1 && base[3] <= h + 1, base.map(Math.round).join(','));
        await pointer(p, 'pointerup', 1, 0, 0);
      }
      // the HUD's own buttons do not place the pad
      {
        const b = await p.page.evaluate(() => {
          const e = document.querySelector('.hud .view .touchcol button');
          const r = e.getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2];
        });
        const camBefore = (await p.d0()).camera;
        await p.page.touchscreen.tap(b[0], b[1]);
        await p.advance(0.1);
        const st = await p.page.evaluate(() => { const z = window.__dreamcar.game.input.touch[0]; return [!!z.steer, z.pedals.size]; });
        check(`${w}x${h}: a tap on a HUD button (camera) works and places no pad`, !st[0] && st[1] === 0 && (await p.d0()).camera !== camBefore && !(await p.page.evaluate(`!!document.querySelector('.hud .view .stick.held')`)), JSON.stringify(st));
        await p.page.evaluate((b) => {
          const e = document.querySelector('.hud .view .touchcol button');
          e.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: b[0], clientY: b[1], bubbles: true, cancelable: true }));
        }, b);
        const st2 = await p.page.evaluate(() => { const z = window.__dreamcar.game.input.touch[0]; return [!!z.steer, z.pedals.size]; });
        check(`${w}x${h}: a pointer pressed on a HUD button does not place the pad either`, !st2[0] && st2[1] === 0, JSON.stringify(st2));
        await p.page.evaluate(() => document.querySelector('.hud .view .touchcol button').dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, pointerType: 'touch', bubbles: true })));
      }
      // the handbrake button when no thumb is on the pad does not place it either, and a thumb landing after it does
      {
        const hb2 = at(L, L.drift);
        await pointer(p, 'pointerdown', 4, hb2[0], hb2[1]);
        let st = await padAt(p);
        check(`${w}x${h}: the HANDBRAKE button first: it pulls the handbrake and places no pad`, st === null && (await hands(p)).handbrake === 1);
        await pointer(p, 'pointerdown', 1, w * 0.6, h * 0.5);
        st = await padAt(p);
        check(`${w}x${h}: then a thumb elsewhere places the pad and steers from zero`, !!st && near2(st[0], w * 0.6) && (await hands(p)).steer === 0 && (await hands(p)).handbrake === 1);
        await pointer(p, 'pointerup', 4, 0, 0);
        await pointer(p, 'pointerup', 1, 0, 0);
      }
      // a cancelled pointer, a lost focus, a turned device: nothing sticks
      for (const [label, fire] of [
        ['a cancelled pointer', null],
        ['the window losing focus', `window.dispatchEvent(new Event('blur'))`],
        ['the device turned', `window.dispatchEvent(new Event('orientationchange'))`],
      ]) {
        await pointer(p, 'pointerdown', 9, cx + lock * 0.6, cy + bra);
        if (fire) await p.page.evaluate(fire);
        else await pointer(p, 'pointercancel', 9, 0, 0);
        c = await hands(p);
        check(`${w}x${h}: ${label} lets the pad go`, (await raw(p)) === null && c.brake === 0 && c.steer === 0);
        await pointer(p, 'pointerup', 9, 0, 0);
      }
      // the controls step back a few seconds into the run, and come back under a finger
      await p.advance(2.5);
      check(`${w}x${h}: the controls' names go after the first seconds, for good`, !(await visible(p, '.hud .view .controls.naming'))
        && (await p.page.evaluate(`localStorage.getItem('dreamcar.zones.v1')`)) === '1');
      const dim = () => p.page.evaluate(`document.querySelector('.hud .view .controls').classList.contains('dim')`);
      check(`${w}x${h}: a few seconds in, untouched, the controls step back`, await dim());
      await pointer(p, 'pointerdown', 1, cx, cy);
      await p.advance(1 / 30);
      check(`${w}x${h}: a thumb on the pad brings them back`, !(await dim()));
      // held down at a standstill: reverse
      await pointer(p, 'pointermove', 1, cx, cy + bra);
      await p.skip(12);
      d = await p.d0();
      check(`${w}x${h}: the pad held down at a standstill reverses`, d.kmh < -1 || d.gear < 0, `${d.kmh} km/h, gear ${d.gear}`);
      await pointer(p, 'pointerup', 1, 0, 0);
      // manual: up is the throttle, the centre coasts, down brakes
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:manual')`);
      check(`${w}x${h}: Throttle manual (kept under dreamcar.throttle): nothing touched is no power`, (await p.page.evaluate(`localStorage.getItem('dreamcar.throttle')`)) === 'manual' && (await hands(p)).throttle === 0);
      await p.advance(0.4);
      gz = await gauge(p);
      check(`${w}x${h}: manual with nothing pressed: the gauge reads zero and zero`, gz[0] === 0 && gz[2] === 0, gz.join('/'));
      await pointer(p, 'pointerdown', 1, cx, cy);
      await pointer(p, 'pointermove', 1, cx + lock * 0.2, cy - bra * 0.5);
      c = await hands(p);
      check(`${w}x${h}: manual: half way up is half the throttle`, near(c.throttle, 0.5) && c.brake === 0, JSON.stringify(c));
      await pointer(p, 'pointermove', 1, cx, cy);
      c = await hands(p);
      check(`${w}x${h}: manual: at the centre it coasts`, c.throttle === 0 && c.brake === 0, JSON.stringify(c));
      await pointer(p, 'pointermove', 1, cx, cy + bra * 0.5);
      c = await hands(p);
      check(`${w}x${h}: manual: half way down is half the brake`, c.throttle === 0 && near(c.brake, 0.5), JSON.stringify(c));
      await pointer(p, 'pointerup', 1, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:auto')`);
      // the left hand: everything mirrored
      await p.page.evaluate(`window.__dreamcar.game.action('hand:left')`);
      await p.advance(1 / 30);
      const R = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: Hand left (kept under dreamcar.hand) mirrors the pad and the HANDBRAKE button`, (await p.page.evaluate(`localStorage.getItem('dreamcar.hand')`)) === 'left'
        && Math.abs(R.pad.cx - (w - px0)) < 1 && R.pad.cy === py0 && Math.abs(R.drift.x - (w - L.drift.x)) < 1 && R.drift.y === L.drift.y);
      const sm = await centreOf(p, '.stick.ghost');
      check(`${w}x${h}: and draws it there`, !!sm && Math.abs(sm[0] - R.x0 - R.pad.cx) < 1.5);
      await pointer(p, 'pointerdown', 1, R.x0 + R.pad.cx, R.y0 + R.pad.cy);
      await pointer(p, 'pointermove', 1, R.x0 + R.pad.cx - lock * 0.5, R.y0 + R.pad.cy);
      check(`${w}x${h}: a thumb on the left pad steers (half left)`, near(await raw(p), -0.5));
      await pointer(p, 'pointerup', 1, 0, 0);
      // (Hand only moves the ghost and the button: with the left hand a thumb lands on the right side as well)
      await pointer(p, 'pointerdown', 1, w * 0.8, h * 0.75);
      const rp = await padAt(p);
      check(`${w}x${h}: Hand left: a thumb landing on the right side places the pad there too`, !!rp && near2(rp[0], w * 0.8) && near2(rp[1], h * 0.75) && (await hands(p)).steer === 0);
      await pointer(p, 'pointerup', 1, 0, 0);
      await pointer(p, 'pointerdown', 4, R.x0 + R.drift.x, R.y0 + R.drift.y);
      check(`${w}x${h}: the HANDBRAKE button on the right`, (await hands(p)).handbrake === 1);
      await pointer(p, 'pointerup', 4, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('hand:right')`);
      // the slider with its pedals
      await p.page.evaluate(`window.__dreamcar.game.action('steering:slider')`);
      await p.advance(1 / 30);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      const sx = L.x0 + L.slider.cx;
      const sy = L.y0 + L.slider.cy;
      const half = L.slider.half;
      check(`${w}x${h}: Steering slider: a slider (${half.toFixed(0)} px either side) and the pedals, no pad`, !!L.slider && !L.pad && half >= 56 && half <= 92 && (await visible(p, '.hud .view .slider')) && !(await visible(p, '.hud .view .stick'))
        && [L.brake, L.drift].every((b) => 2 * b.r >= 64));
      const smid = await centreOf(p, '.slider .mid');
      check(`${w}x${h}: the slider's centre mark is drawn where Input measures from`, !!smid && Math.abs(smid[0] - sx) < 2 && Math.abs(smid[1] - sy) < 2);
      await pointer(p, 'pointerdown', 1, sx + half * 0.5, sy + 10);
      check(`${w}x${h}: slider: a thumb landing half way right steers half right at once`, near(await raw(p), 0.5));
      const brake = at(L, L.brake);
      await pointer(p, 'pointerdown', 2, brake[0], brake[1]);
      c = await hands(p);
      check(`${w}x${h}: slider: BRAKE brakes and the power lifts, the steering thumb still steering`, c.brake === 1 && c.throttle === 0 && near(c.steer, 0.5), JSON.stringify(c));
      await pointer(p, 'pointermove', 2, w / 2, h / 2);
      check(`${w}x${h}: slider: a finger sliding off BRAKE keeps it until it lifts`, (await hands(p)).brake === 1);
      await pointer(p, 'pointerup', 2, 0, 0);
      const drift = at(L, L.drift);
      await pointer(p, 'pointerdown', 4, drift[0], drift[1]);
      check(`${w}x${h}: slider: DRIFT pulls the handbrake`, (await hands(p)).handbrake === 1);
      await pointer(p, 'pointerup', 4, 0, 0);
      await pointer(p, 'pointerup', 1, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:manual')`);
      await p.advance(1 / 30);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      const gas = at(L, L.gas);
      await pointer(p, 'pointerdown', 5, gas[0], gas[1]);
      check(`${w}x${h}: slider, manual: GAS drives`, (await visible(p, '.hud .view .pedal.gas')) && (await hands(p)).throttle === 1);
      await pointer(p, 'pointerup', 5, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('throttle:auto')`);
      // the arrows
      await p.page.evaluate(`window.__dreamcar.game.action('steering:arrows')`);
      await p.advance(0.1);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: Steering arrows shows two arrows (kept under dreamcar.steering)`, (await visible(p, '.hud .view .arrow.right')) && !(await visible(p, '.hud .view .slider'))
        && (await p.page.evaluate(`localStorage.getItem('dreamcar.steering')`)) === 'arrows' && 2 * L.arrows.left.r >= 64);
      const right = at(L, L.arrows.right);
      await pointer(p, 'pointerdown', 1, right[0], right[1]);
      await p.steps(1 / 30, 60);
      const early = (await p.d0()).steer;
      await p.advance(0.4);
      d = await p.d0();
      check(`${w}x${h}: the right arrow steers right, wound on like a key`, (await raw(p)) === 1 && d.steer > 0.03 && early < d.steer, `${early} then ${d.steer}`);
      await pointer(p, 'pointerup', 1, 0, 0);
      // tilt: synthetic deviceorientation events (a device rolled by `roll` degrees, its screen tipped back 20)
      await p.page.evaluate(`window.__dreamcar.game.action('steering:tilt')`);
      await p.advance(1 / 30);
      const tilt = (roll) => p.page.evaluate((roll) => {
        const r = Math.PI / 180;
        const a = (screen.orientation && screen.orientation.angle) || 0;
        const c = Math.cos(20 * r);
        const sx = -Math.sin(roll * r) * c;
        const sy = Math.cos(roll * r) * c;
        const ux = sx * Math.cos(a * r) + sy * Math.sin(a * r);
        const uy = -sx * Math.sin(a * r) + sy * Math.cos(a * r);
        const uz = Math.sin(20 * r);
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: Math.asin(uy) / r, gamma: Math.atan2(-ux, uz) / r, absolute: false }));
      }, roll);
      await p.advance(1 / 30);
      L = await p.page.evaluate(() => window.__dreamcar.touchLayout(0));
      check(`${w}x${h}: Steering tilt: the pad is drawn for the speed, the option names it untested on a real phone`, !!L.pad && (await p.page.evaluate(`window.__dreamcar.game.input.tilt.state`)) === 'granted'
        && /untested/i.test(await p.page.evaluate(`document.querySelector('.hud .options .optnote:not([hidden])') ? [...document.querySelectorAll('.hud .options .optnote')].map((e) => e.textContent).join(' ') : ''`)));
      await tilt(8);
      await p.page.evaluate(`window.__dreamcar.game.action('recentre')`);
      check(`${w}x${h}: tilt: recentred, held still is straight ahead`, near((await hands(p)).steer, 0, 0.01));
      await tilt(8 + 15);
      check(`${w}x${h}: tilt: rolled 15 degrees right is half the lock`, near((await hands(p)).steer, 0.5), `${(await hands(p)).steer}`);
      await tilt(8 - 45);
      check(`${w}x${h}: tilt: 45 left is full lock left, no more`, (await hands(p)).steer === -1);
      await tilt(8 + 6);
      await pointer(p, 'pointerdown', 1, cx, cy);
      await pointer(p, 'pointermove', 1, cx + lock, cy + bra);
      c = await hands(p);
      check(`${w}x${h}: tilt: the pad's thumb brakes, the tilt still steers`, c.brake === 1 && near(c.steer, 0.2), JSON.stringify(c));
      await pointer(p, 'pointerup', 1, 0, 0);
      await p.page.evaluate(`window.__dreamcar.game.action('steering:pad')`);
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
    // tilt refused (Safari's permission prompt answered no): the pad steers and the options say why
    {
      const init = () => {
        window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied');
      };
      const p = await open('?manual&q=low&time=day', { w: 393, h: 852, mobile: true, gpu: false, init });
      await clickText(p, 'Options');
      await clickText(p, 'Tilt', '.options');
      await p.advance(0.1);
      const st = await p.page.evaluate(`[window.__dreamcar.game.steering, [...document.querySelectorAll('.hud .options .optnote')].map((e) => e.textContent).join(' | ')]`);
      check('tilt refused: the pad steers, and the options say so', st[0] === 'pad' && /not allowed/i.test(st[1]), st.join(' / '));
      await p.close('tilt refused');
    }
    // split, side by side on a tablet: each half has its own fixed pad, scaled to it
    const W = 1180;
    const H = 820;
    const p = await open('?manual&q=low&auto&mode=split&time=day', { w: W, h: H, mobile: true, gpu: false });
    await p.page.evaluate(() => window.__dreamcar.set('view.split', 'wide'));
    await p.page.evaluate(() => window.__dreamcar.game.layout());
    const Ls = await p.page.evaluate(() => [window.__dreamcar.touchLayout(0), window.__dreamcar.touchLayout(1)]);
    check('split touch: each half has its own pad and HANDBRAKE inside it', Ls[1].x0 >= W / 2 - 1 && Ls[0].x0 + Ls[0].pad.cx + Ls[0].pad.r <= W / 2 && Ls[1].x0 + Ls[1].drift.x - Ls[1].drift.r > W / 2,
      Ls.map((L) => `${L.x0}+${L.pad.cx}`).join(' / '));
    await toGo(p);
    await p.advance(1.5);
    const lk = Ls.map((L) => L.pad.r * 70 / 80);
    await pointer(p, 'pointerdown', 1, Ls[0].x0 + Ls[0].pad.cx, Ls[0].y0 + Ls[0].pad.cy);
    await pointer(p, 'pointerdown', 2, Ls[1].x0 + Ls[1].pad.cx, Ls[1].y0 + Ls[1].pad.cy);
    await pointer(p, 'pointermove', 1, Ls[0].x0 + Ls[0].pad.cx + lk[0] * 0.6, Ls[0].y0 + Ls[0].pad.cy);
    await pointer(p, 'pointermove', 2, Ls[1].x0 + Ls[1].pad.cx - lk[1] * 0.6, Ls[1].y0 + Ls[1].pad.cy);
    await p.advance(0.3);
    let s = await p.state();
    check('split touch: both cars drive by themselves', s.drivers.every((d) => d.input === 'touch' && d.kmh > 5), s.drivers.map((d) => `${d.input} ${d.kmh}`).join(' / '));
    check('split touch: each thumb steers its own car', s.drivers[0].steer > 0.03 && s.drivers[1].steer < -0.03, s.drivers.map((d) => d.steer).join(' / '));
    await pointer(p, 'pointerdown', 3, Ls[1].x0 + Ls[1].drift.x, Ls[1].y0 + Ls[1].drift.y);
    await p.advance(0.2);
    const hbs = await p.page.evaluate('window.__dreamcar.game.racers.map((r) => r.controls.handbrake)');
    check('split touch: the right half\'s HANDBRAKE is car two\'s', hbs[1] > 0.5 && hbs[0] < 0.5, `hand ${hbs.join('/')}`);
    for (const id of [1, 2, 3]) await pointer(p, 'pointerup', id, 0, 0);
    // a thumb landing anywhere in a half puts that half's pad there, inside that half (clamped to it at the edges); a
    // second finger in a half is that half's handbrake
    const half = (i) => p.page.evaluate((i) => {
      const st = window.__dreamcar.game.input.touch[i].steer;
      return st ? { cx: st.cx, cy: st.cy, ox: st.ox, hold: st.hold, fl: st.fl, fr: st.fr } : null;
    }, i);
    const Lh = Ls.map((L, i) => [L.x0 + 90, L.y0 + 120, i]);
    // (left half, 90 px in: 90 px of room at the half's own edge; right half likewise from its own edge)
    await pointer(p, 'pointerdown', 1, Lh[0][0], Lh[0][1]);
    await pointer(p, 'pointerdown', 2, Lh[1][0], Lh[1][1]);
    let h0 = await half(0);
    let h1 = await half(1);
    check('split touch: a thumb landing high in each half puts that half\'s pad exactly there', !!h0 && !!h1 && near2(h0.cx, 90) && near2(h0.cy, 120) && near2(h1.cx, 90) && near2(h1.cy, 120), JSON.stringify([h0, h1]));
    let hh = await p.page.evaluate(() => [0, 1].map((i) => window.__dreamcar.game.input.read({}, 'all', i)).map((o) => [o.steer, o.throttle, o.brake, o.handbrake]));
    check('split touch: and both start at zero', hh.every((o) => o[0] === 0 && o[1] === 1 && o[2] === 0 && o[3] === 0), JSON.stringify(hh));
    await pointer(p, 'pointerdown', 4, Ls[0].x0 + 200, Ls[0].y0 + 300);
    hh = await p.page.evaluate(() => [0, 1].map((i) => window.__dreamcar.game.input.read({}, 'all', i)).map((o) => [o.steer, o.throttle, o.brake, o.handbrake]));
    check('split touch: a second finger in the left half is the left car\'s handbrake only', hh[0][3] === 1 && hh[1][3] === 0, JSON.stringify(hh));
    for (const id of [1, 2, 4]) await pointer(p, 'pointerup', id, 0, 0);
    // a thumb at the right half's own left edge (the half's edge is the room, not the screen's), and at the left half's right edge
    await pointer(p, 'pointerdown', 1, Ls[1].x0 + 6, Ls[1].y0 + 200);
    await pointer(p, 'pointerdown', 2, Ls[0].x0 + Ls[0].w - 6, Ls[0].y0 + 200);
    h1 = await half(1);
    h0 = await half(0);
    check('split touch: near a half\'s own edge the pad is nudged inside that half (and held at zero)', !!h1 && !!h0 && h1.cx >= 0.6 * 70 * Ls[1].pad.s - 6 + 5.9 && h0.cx <= Ls[0].w - 0.6 * 70 * Ls[0].pad.s + 6 - 5.9 && h1.hold && h0.hold, JSON.stringify([h0, h1]));
    for (const id of [1, 2]) await pointer(p, 'pointerup', id, 0, 0);
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
    // on a phone at the default help: the car drives itself; one thumb on the pad, hard over and pulled down into the
    // red arc for a moment (the handbrake), then up again; and the same with the HANDBRAKE button under the other thumb
    for (const how of ['the pad\'s red arc', 'the HANDBRAKE button']) {
      const q = await open('?manual&q=low&auto&time=day', { w: 393, h: 852, mobile: true, gpu: false });
      const L = await q.page.evaluate(() => window.__dreamcar.touchLayout(0));
      const T = await q.page.evaluate(() => window.__dreamcar.touch);
      const cx = L.x0 + L.pad.cx;
      const cy = L.y0 + L.pad.cy;
      const s = L.pad.s;
      await toGo(q);
      await q.skip(4);
      const kmh = (await q.d0()).kmh;
      await pointer(q, 'pointerdown', 1, cx, cy);
      await pointer(q, 'pointermove', 1, cx + T.pad.steer * s, cy - 10);
      let most = 0;
      let pulled = 0;
      for (let k = 0; k < 30; k++) {
        if (k === 2) {
          if (how.includes('arc')) await pointer(q, 'pointermove', 1, cx + T.pad.steer * s, cy + (T.pad.trip + 6) * s);
          else await pointer(q, 'pointerdown', 2, L.x0 + L.drift.x, L.y0 + L.drift.y);
        }
        if (k === 8) {
          if (how.includes('arc')) await pointer(q, 'pointermove', 1, cx + T.pad.steer * s, cy - 10);
          else await pointer(q, 'pointerup', 2, 0, 0);
        }
        await q.advance(1 / 15, 30);
        pulled = Math.max(pulled, await q.page.evaluate('window.__dreamcar.game.racers[0].controls.handbrake'));
        most = Math.max(most, await q.page.evaluate('window.__dreamcar.game.racers[0].vehicle.slide.angle'));
      }
      await pointer(q, 'pointerup', 1, 0, 0);
      check(`on a phone (Full help), one thumb hard over and ${how}: the handbrake pulled and the car slides past 12 degrees`, pulled > 0.5 && most >= 12, `${most.toFixed(1)} degrees at most from ${kmh} km/h`);
      await q.close(`touch slide, ${how}`);
    }
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
      // (on touch: the pad in the right hand and in the left, solo and in both splits, on auto and on manual; and
      // the slider with its pedals on manual, solo and in both splits: GAS in the corner, BRAKE beside it)
      const touchLayouts = ['solo', 'wide', 'tall', 'manual', 'left', 'left-wide', 'left-tall-manual', 'slider-manual', 'slider-wide-manual', 'slider-tall-manual'];
      for (const layout of insets ? ['solo', 'left'] : mobile ? touchLayouts : ['solo', 'wide', 'tall']) {
        await p.page.evaluate((layout) => {
          const g = window.__dreamcar.game;
          const parts = layout.split('-');
          // (the performance readout on: it must stand clear of everything in every layout)
          g.action('stats:on');
          g.action(parts.includes('manual') ? 'throttle:manual' : 'throttle:auto');
          g.action(parts.includes('slider') ? 'steering:slider' : 'steering:pad');
          g.action(parts.includes('left') ? 'hand:left' : 'hand:right');
          const split = parts.find((x) => x === 'wide' || x === 'tall');
          const mode = split ? 'split' : 'solo';
          if (mode === 'split') window.__dreamcar.set('view.split', split);
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
                    const key = what.startsWith('slider') ? 'slider' : what.startsWith('stick') ? 'pad' : what.startsWith('arrow') ? null : what.split(' ')[1];
                    if (key && L[key]) {
                      const c = key === 'slider' ? [L.slider.cx, L.slider.cy] : key === 'pad' ? [L.pad.cx, L.pad.cy] : [L[key].x, L[key].y];
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
                // the pedal gauge stands beside the speed: its own box, clear of everything else
                const gz = name === 'cluster' && e.querySelector('.gauge');
                if (gz && shown(gz)) boxes.push({ name: 'gauge', r: gz.getBoundingClientRect() });
              }
              const over = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
              // the performance readout is the page's, not a view's: one line at the bottom edge, which must not
              // touch anything of any view (nor the car)
              const perf = document.querySelector('.hud .perf');
              if (!perf || !shown(perf) || !/fps/.test(perf.textContent)) out.push(`view ${vi}: no performance readout`);
              else {
                const q = perf.getBoundingClientRect();
                const page = document.querySelector('.hud').getBoundingClientRect();
                if (q.left < page.left - 1 || q.right > page.right + 1 || q.bottom > page.bottom + 1) out.push('the readout does not fit the page');
                for (const b of boxes) if (over(b.r, q)) out.push(`view ${vi}: the readout over ${b.name}`);
                if (over(q, car)) out.push(`view ${vi}: the readout over the car`);
              }
              for (const b of boxes) {
                // the banner and the gap are moments over the sky, never over the car
                const rr = (q) => `${Math.round(q.left - vr.left)},${Math.round(q.top - vr.top)}-${Math.round(q.right - vr.left)},${Math.round(q.bottom - vr.top)}`;
                if (over(b.r, car)) out.push(`view ${vi}: ${b.name} over the car (${rr(b.r)} against ${rr(car)})`);
                if (b.r.left < vr.left - 1 || b.r.right > vr.right + 1 || b.r.top < vr.top - 1 || b.r.bottom > vr.bottom + 1) out.push(`view ${vi}: ${b.name} outside its view (${rr(b.r)} in ${Math.round(vr.width)}x${Math.round(vr.height)}, ${views[vi].className})`);
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
    // the performance readout: off until asked for, kept under dreamcar.stats, one line with the tier and the frame rate
    const statsRow = `[...document.querySelectorAll('.hud .options .optrow')].find((r) => /readout/i.test(r.querySelector('.optlabel').textContent))`;
    check('the readout is offered, and is off with nothing chosen', (await p.page.evaluate(`!!${statsRow} && ${statsRow}.querySelector('button[data-value="off"]').classList.contains('on')`)) && !(await visible(p, '.hud .perf')));
    await p.page.evaluate(`${statsRow}.querySelector('button[data-value="on"]').click()`);
    await p.advance(0.1);
    const line = await p.page.evaluate(`document.querySelector('.hud .perf').textContent`);
    check('Readout: Shown is kept under dreamcar.stats and shows one line: tier, canvas, scale, edge smoothing, frames a second, the ladder',
      (await p.page.evaluate(`localStorage.getItem('dreamcar.stats')`)) === 'on' && (await visible(p, '.hud .perf')) && new RegExp(`^${tier0} \\d+×\\d+@[\\d.]+ ×1\\.00 (msaa\\d|fxaa) \\d+/\\d+fps all on`).test(line), line);
    check('the readout is one line no taller than 12 px, at the bottom edge', await p.page.evaluate(`(() => { const r = document.querySelector('.hud .perf').getBoundingClientRect(); return r.height <= 12 && r.bottom >= innerHeight - 14; })()`));
    await p.page.evaluate(`${statsRow}.querySelector('button[data-value="off"]').click()`);
    await p.advance(0.1);
    check('and hidden again', !(await visible(p, '.hud .perf')) && (await p.page.evaluate(`localStorage.getItem('dreamcar.stats')`)) === 'off');
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
    // on a touch screen: Steering (pad / slider / arrows / tilt), Hand (right / left) and Throttle (auto / manual), kept on the device
    const t = await open('?manual&q=low&time=day', { w: 393, h: 852, mobile: true, gpu: false });
    await clickText(t, 'Options');
    await t.advance(0.1);
    const trows = await t.page.evaluate(`[...document.querySelectorAll('.hud .options .optlabel')].filter((e) => !e.closest('[hidden]')).map((e) => e.textContent)`);
    check('on touch the options offer Steering, Hand and Throttle', /steering/i.test(trows.join()) && /hand/i.test(trows.join()) && /throttle/i.test(trows.join()), trows.join(', '));
    const steerings = await t.page.evaluate(`[...document.querySelectorAll('.hud .options button')].filter((b) => ['pad', 'slider', 'arrows', 'tilt'].includes(b.dataset.value)).map((b) => b.textContent)`);
    check('Steering: Pad, Slider, Arrows, Tilt', steerings.join() === 'Pad,Slider,Arrows,Tilt', steerings.join());
    const on = (v) => t.page.evaluate((v) => document.querySelector(`.hud .options button[data-value="${v}"]`).classList.contains('on'), v);
    check('with nothing chosen: Pad, the right hand and Auto', (await on('pad')) && (await on('right')) && (await on('auto')));
    await clickText(t, 'Left', '.options');
    await t.advance(0.1);
    check('Hand left is kept under dreamcar.hand and reaches the pad', (await t.page.evaluate(`localStorage.getItem('dreamcar.hand')`)) === 'left' && (await t.page.evaluate('window.__dreamcar.game.input.hand')) === 'left');
    await clickText(t, 'Arrows', '.options');
    await clickText(t, 'Manual', '.options');
    await t.advance(0.1);
    check('Arrows and Manual are kept under dreamcar.steering and dreamcar.throttle and reach the hands',
      (await t.page.evaluate(`localStorage.getItem('dreamcar.steering') + ' ' + localStorage.getItem('dreamcar.throttle')`)) === 'arrows manual'
      && (await t.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle')) === 'arrows manual');
    check('the Hand row goes with the pad (the arrows have none)', !(await visible(t, '.hud .options .optrow:has(button[data-value="left"])')));
    await t.go('?manual&q=low&time=day');
    check('and survive a reload', (await t.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle + " " + window.__dreamcar.game.input.hand')) === 'arrows manual left');
    await t.close('touch options');
    const n = await open('?manual&q=low&time=day', { w: 393, h: 852, mobile: true, gpu: false, storage: false });
    check('with no storage: the pad, the right hand, auto', (await n.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.hand + " " + window.__dreamcar.game.input.throttle')) === 'pad right auto');
    await n.page.evaluate(`window.__dreamcar.game.action('steering:arrows'); window.__dreamcar.game.action('throttle:manual'); window.__dreamcar.game.action('hand:left')`);
    check('with no storage the touch choices still apply (for this page)', (await n.page.evaluate('window.__dreamcar.game.input.steering + " " + window.__dreamcar.game.input.throttle + " " + window.__dreamcar.game.input.hand')) === 'arrows manual left');
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
    // the lakeside's camera (design.md, "The lakeside"): the same, and its car is on that stretch
    const p4 = await open('?manual&q=low&photo=r2', { w: 640, h: 360, gpu: false });
    const preset4 = await p4.page.evaluate('window.__dreamcar.game.photo');
    const st4 = await p4.state();
    const named4 = await p4.page.evaluate(() => {
      const c = window.__dreamcar.game.views[0].camera;
      return { fov: c.fov, hud: !document.querySelector('.hud').hidden };
    });
    const clock4 = await p4.page.evaluate('window.__dreamcar.game.race.clock + window.__dreamcar.game.race.lead');
    const place4 = await p4.page.evaluate(() => {
      const g = window.__dreamcar.game;
      const side = g.world.terrain.lakeside;
      return side ? { along: side.along(g.racers[0].vehicle.s), stretch: side.stretch(g.racers[0].vehicle.s) } : null;
    });
    check('?photo=r2: the named camera, its time of day and its moment, on the lakeside', !!preset4 && Math.abs(named4.fov - preset4.fov) < 0.01 && !named4.hud
      && st4.time === preset4.time && Math.abs(clock4 - preset4.t) < 0.05 && !!place4 && place4.stretch === 1,
      `${st4.time}, ${clock4.toFixed(2)} s into the run, fov ${named4.fov}, ${place4 ? place4.along.toFixed(0) : '?'} m after the sky road`);
    await p4.close('photo r2');
    // the golden wood's camera (design.md): the same, and its car is on that stretch
    for (const [name, where, what] of [
      ['r3', (g) => { const w = g.world.terrain.goldwood; return w ? { along: w.along(g.racers[0].vehicle.s), stretch: w.stretch(g.racers[0].vehicle.s) } : null; }, 'into the esses'],
    ]) {
      const p5 = await open(`?manual&q=low&photo=${name}`, { w: 640, h: 360, gpu: false });
      const preset5 = await p5.page.evaluate('window.__dreamcar.game.photo');
      const st5 = await p5.state();
      const named5 = await p5.page.evaluate(() => {
        const c = window.__dreamcar.game.views[0].camera;
        return { fov: c.fov, hud: !document.querySelector('.hud').hidden };
      });
      const clock5 = await p5.page.evaluate('window.__dreamcar.game.race.clock + window.__dreamcar.game.race.lead');
      const place5 = await p5.page.evaluate(`(${where.toString()})(window.__dreamcar.game)`);
      check(`?photo=${name}: the named camera, its time of day and its moment, in its place`, !!preset5 && Math.abs(named5.fov - preset5.fov) < 0.01 && !named5.hud
        && st5.time === preset5.time && Math.abs(clock5 - preset5.t) < 0.05 && !!place5 && place5.stretch === 1,
        `${st5.time}, ${clock5.toFixed(2)} s into the run, fov ${named5.fov}, ${place5 ? place5.along.toFixed(0) : '?'} m ${what}`);
      await p5.close(`photo ${name}`);
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
    // ?stats: the readout without the option, not kept; ?scale= and ?shed=: an exact picture, the governor off
    {
      const p = await open('?manual&q=low&auto&ap&time=day&stats', { w: 320, h: 180 });
      await p.advance(0.2);
      check('?stats: the readout shows and is not kept', (await visible(p, '.hud .perf')) && (await p.page.evaluate(`localStorage.getItem('dreamcar.stats')`)) === null,
        await p.page.evaluate(`document.querySelector('.hud .perf').textContent`));
      await p.close('?stats');
    }
  },

  /**
   * (perf lane) The quality ladder (engine/governor.js; its decisions are tested in tools/unit/governor.test.mjs):
   * every level of a tier draws, sheds what its name says and nothing else, never goes under the tier's floor, and
   * compiles no shader; a page stepped by hand has no governor; ?scale= and ?shed= give an exact picture; a page
   * that runs by itself has one and stays inside the ladder.
   */
  async ladder() {
    const read = (p) => p.page.evaluate(`(() => { const s = window.__dreamcar.stats(); return { q: s.quality, p: s.pipeline, programs: s.programs, buffer: s.buffer, scale: s.renderScale }; })()`);
    for (const tier of ONLY.includes('ladder-low') ? ['low'] : ['low', 'medium']) {
      const p = await open(`?manual&q=${tier}&auto&ap&time=day&t=9`, { w: 240, h: 135 });
      await p.advance(0.2, 30);
      const top = await read(p);
      const rungs = top.q.rungs;
      check(`${tier}: a page stepped by hand has no governor, nothing shed, full resolution`,
        top.q.adaptive === false && top.q.level === 0 && top.q.shed.length === 0 && top.scale === 1 && top.p.upscaled === false, JSON.stringify(top.q));
      check(`${tier}: the ladder is ${rungs.join(', ')}, then the render scale down to ${top.q.floor}`, rungs.length >= 3 && rungs[0] === 'probe' && top.q.max > rungs.length && top.q.floor >= 0.6);
      const wrong = [];
      let last = top;
      for (let level = 1; level <= top.q.max; level++) {
        await p.page.evaluate(`window.__dreamcar.engine.setQualityStep(${level})`);
        await p.advance(3 / 30, 30);
        const s = await read(p);
        const shed = Math.min(level, rungs.length);
        const say = (what) => wrong.push(`level ${level}: ${what}`);
        if (s.q.shed.join() !== rungs.slice(0, shed).join()) say(`sheds ${s.q.shed.join()}`);
        if (shed < rungs.length && s.scale !== 1) say(`scale ${s.scale} with rungs left`);
        if (s.scale < top.q.floor - 1e-6) say(`scale ${s.scale} under the floor`);
        if (level > rungs.length && !(s.scale < last.scale)) say(`scale ${s.scale} after ${last.scale}`);
        if (s.p.upscaled !== s.scale < 1) say(`upscale ${s.p.upscaled} at scale ${s.scale}`);
        if (Math.abs(s.p.targets.scene[0] - Math.round(s.buffer[0] * s.scale)) > 1) say(`scene ${s.p.targets.scene} of ${s.buffer} at ${s.scale}`);
        const has = (name) => s.q.shed.includes(name);
        if (s.p.blurTaps !== (has('blur') ? Math.max(2, Math.ceil(top.p.blurTaps / 2)) : top.p.blurTaps)) say(`${s.p.blurTaps} blur taps`);
        if (s.p.aoSamples !== (has('ao') ? 0 : top.p.aoSamples)) say(`${s.p.aoSamples} occlusion samples`);
        if (s.p.samples !== (has('msaa') ? Math.min(2, top.p.samples) : top.p.samples)) say(`${s.p.samples} samples`);
        if (s.programs !== top.programs) say(`${s.programs} programs, ${top.programs} before`);
        last = s;
      }
      check(`${tier}: each of its ${top.q.max} levels sheds its own rung, resolution last and never under the floor, and compiles nothing`, wrong.length === 0, wrong.join('; '));
      check(`${tier}: the bottom is all ${rungs.length} rungs and scale ${top.q.floor}, through the upscale (strength ${last.p.sharp.toFixed(2)})`,
        last.q.shed.length === rungs.length && last.scale === top.q.floor && last.p.upscaled && last.p.sharp > 0.3 && last.p.sharp <= 1);
      await p.page.evaluate('window.__dreamcar.engine.setQualityStep(0)');
      await p.advance(3 / 30, 30);
      const back = await read(p);
      check(`${tier}: back at the top everything is as it was`, back.scale === 1 && back.q.shed.length === 0 && JSON.stringify(back.p.targets.scene) === JSON.stringify(top.p.targets.scene)
        && back.p.samples === top.p.samples && back.p.blurTaps === top.p.blurTaps && back.p.aoSamples === top.p.aoSamples && back.programs === top.programs && !back.p.upscaled,
        JSON.stringify(back.p).slice(0, 200));
      await p.close(`${tier} ladder`);
    }
    {
      const p = await open('?manual&q=low&auto&ap&time=day&t=9&scale=0.6&shed=2', { w: 240, h: 135 });
      await p.advance(0.1, 30);
      const s = await read(p);
      check('?scale=0.6&shed=2: that scale, those two rungs, no governor', s.scale === 0.6 && s.q.shed.length === 2 && s.q.adaptive === false && s.p.upscaled, JSON.stringify(s.q));
      await p.go('?manual&q=low&auto&ap&time=day&t=9&scale=0.6&upscale=0');
      await p.advance(0.1, 30);
      check('?upscale=0: the plain stretch', (await read(p)).p.upscaled === false);
      await p.close('?scale=');
    }
    {
      // a page that runs by itself: the governor is on, and whatever this machine makes it do stays on the ladder
      const p = await open('?q=low&auto&ap&time=day&mute', { w: 240, h: 135 });
      await p.page.waitForTimeout(12000);
      const s = await read(p);
      check('a running page has a governor', s.q.adaptive === true, JSON.stringify(s.q));
      check('and it stays on the ladder, at or above the floor', s.q.level >= 0 && s.q.level <= s.q.max && s.scale >= s.q.floor - 1e-6 && s.q.shed.length <= s.q.rungs.length, JSON.stringify(s.q));
      await p.go('?q=low&auto&ap&time=day&mute&dpr=1');
      await p.page.waitForTimeout(3000);
      const f = await read(p);
      check('?dpr= switches it off: nothing shed, full resolution', f.q.adaptive === false && f.q.level === 0 && f.scale === 1, JSON.stringify(f.q));
      await p.close('the governor running');
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
  const names = Object.keys(SECTIONS).filter((n) => ONLY.length === 0 || ONLY.includes(n) || (n === 'ladder' && ONLY.includes('ladder-low')));
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
