// Dev tool: test online play between two pages of one headless browser.
//
//   node tools/nettest.cjs http://localhost:4173/ [outDir] [--only=a|b|c|d]
//
// The pages exchange an invite and a reply exactly as two players would (by
// copying the text out of one page and into the other), then race.
//
//   A  the whole flow on a perfect link: lobby, race, results, rematch, leaving.
//      Both pages run in ?manual mode and are stepped in turn, so the outcome
//      does not depend on how fast software WebGL happens to render.
//   B  the same link made slow, uneven and lossy (?netlag / ?netjitter /
//      ?netloss): how far from the truth is the other rider drawn, how smoothly,
//      and what happens when one machine stalls.
//   C  both pages running in real time (no rendering): the parts that read the
//      wall clock — pings, the shared sea clock, long frames.
//   D  four players: a host and three friends, each joined with their own invite
//      and reply. Names, seats, positions passed on by the host, results, and
//      one of them leaving.
//
// This proves the signalling codes, the data channels, the clock sync and the
// prediction of remote crafts. It cannot prove NAT traversal: both pages are on
// one machine.
//
// Requires Playwright to be available to Node (it is not a project dependency).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const base = args[0] || 'http://localhost:4173/';
const outDir = args[1] || 'nettest';
const only = (flags.find((f) => f.startsWith('--only=')) || '').slice(7);
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Installed in each page: a compact snapshot, and "step then snapshot".
const PROBE = `
window.__probe = () => {
  const g = window.__bw.game; const o = g.online;
  return {
    phase: g.phase, mode: g.mode, race: g.race.state, sea: o._sea(), wall: performance.timeOrigin + performance.now(),
    time: g.race.time, active: o.active, isHost: o.isHost, link: o.connected, broken: o.broken, clockError: o.clockError, seat: o.seat, gone: [...o.gone],
    roster: o.roster.map((x) => x.kind + ':' + x.name), chips: [...document.querySelectorAll('#bw-roster li')].map((li) => li.textContent),
    tags: g.views[0] ? g.views[0].hud.tags.map((t) => ({ name: t.racer.name, shown: t.shown, text: t.node.textContent })) : [],
    racers: g.race.racers.map((r) => ({ name: r.name, control: r.control, x: r.craft.pos.x, z: r.craft.pos.z, y: r.craft.pos.y, vx: r.craft.vel.x, vz: r.craft.vel.z, kmh: r.craft.speed * 3.6, total: r.totalS, rank: r.rank, lap: r.lap, finished: r.finished, retired: r.retired, fin: r.finished ? r.finishTime : null, power: r.craft.power })),
    order: g.race.order.map((r) => r.index),
    lobbyReady: o.isHost ? !document.getElementById('bw-net-start').disabled && !document.getElementById('bw-lhost').hidden : !document.getElementById('bw-lready').hidden,
    lobbyError: document.getElementById('bw-lerror').textContent, startLabel: document.getElementById('bw-net-start').textContent,
    resultsHidden: g.hud.results.hidden, againHidden: document.getElementById('bw-again').hidden, waitHidden: document.getElementById('bw-rwait').hidden, waitText: document.getElementById('bw-rwait').textContent,
    toast: g.views[0] ? g.views[0].hud.toast.textContent : '',
  };
};
window.__stepProbe = (dt) => { window.__bw.game.engine.advance(dt, dt, false); return window.__probe(); };
`;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stats = (list) => {
  const s = list.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { mean, p95: s[Math.floor(s.length * 0.95)] || 0, max: s[s.length - 1] || 0 };
};
const fmt = (st, unit = 'm') => `mean ${st.mean.toFixed(2)} ${unit}, 95% under ${st.p95.toFixed(2)} ${unit}, worst ${st.max.toFixed(2)} ${unit}`;

(async () => {
  // without mDNS obfuscation the two pages can reach each other over loopback
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const problems = [];

  const open = async (context, label, url) => {
    const page = await context.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !t.includes('GL Driver')) problems.push(`[${label}] ${t}`);
    });
    page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true && !!window.__bw', null, { timeout: 90000 });
    await page.evaluate(PROBE);
    return page;
  };
  const probe = (page) => page.evaluate('window.__probe()');
  /** Advance both games together (manual mode), letting messages cross between steps. */
  const both = async (a, b, seconds, slice = 0.05) => {
    const n = Math.round(seconds / slice);
    for (let i = 0; i < n; i++) {
      await a.evaluate(`window.__bw.game.engine.advance(${slice}, ${slice}, false)`);
      await b.evaluate(`window.__bw.game.engine.advance(${slice}, ${slice}, false)`);
    }
  };

  /**
   * Two pages, joined as two players would join them.
   * @param {string} query options for both pages
   * @param {{ manual: boolean, lobbyChecks?: boolean }} o
   */
  const connect = async (query, { manual, lobbyChecks = false }) => {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const host = await open(context, 'host', base + query);
    // the host has been on the page a while: the two clocks start well apart
    if (manual) await host.evaluate('window.__bw.skip(7.3)');
    else await host.waitForTimeout(1500);
    await host.click('#bw-online');
    await host.click('#bw-host');
    await host.waitForFunction(`document.getElementById('bw-invite').value.includes('#join=BW1')`, null, { timeout: 20000 });
    const invite = await host.inputValue('#bw-invite');
    if (lobbyChecks) {
      check('host: invite link is produced', /#join=BW1[cu]\.[A-Za-z0-9_-]{100,}\.[a-z0-9]{7}$/.test(invite), `${invite.length} characters`);
      await host.click('#bw-copy-invite');
      const clip = await host.evaluate('navigator.clipboard.readText()').catch(() => '');
      check('host: Copy puts the invite on the clipboard', clip === invite);
    }

    if (lobbyChecks) {
      // someone who pastes instead of opening the link: chat apps wrap long text and people copy too much or too little
      const paster = await open(context, 'paster', base + query);
      await paster.click('#bw-online');
      await paster.click('#bw-join');
      const tryPaste = async (text) => {
        await paster.fill('#bw-invite-in', text);
        await paster.click('#bw-make-reply');
        await paster.waitForFunction(`document.getElementById('bw-lerror').textContent.length > 0 || !document.getElementById('bw-ljoin2').hidden`, null, { timeout: 20000 });
        return paster.evaluate(`({ error: document.getElementById('bw-lerror').textContent, reply: document.getElementById('bw-ljoin2').hidden ? '' : document.getElementById('bw-reply').value })`);
      };
      let r = await tryPaste(invite.slice(0, invite.length - 40));
      check('paste: a code cut short is explained', /incomplete|damaged/i.test(r.error) && !r.reply, r.error);
      r = await tryPaste('hello there');
      check('paste: something that is not a code is explained', /does not look like/i.test(r.error) && !r.reply, r.error);
      const code = invite.slice(invite.indexOf('#join=') + 6);
      const mangled = `Race me at Breakwater GP: ${invite.slice(0, invite.indexOf('#join=') + 6)}${code.slice(0, 200)}\n${code.slice(200, 380)} \n${code.slice(380)} see you there!`;
      r = await tryPaste(mangled);
      check('paste: a whole chat message with the link wrapped over lines still works', r.reply.startsWith('BW1') && !r.error, r.error || `${r.reply.length} characters`);
      await paster.close();
    }

    // the friend opens the invite link (the test adds the same query options to it)
    const guest = await open(context, 'guest', base + query + invite.slice(invite.indexOf('#join=')));
    await guest.waitForFunction(`document.getElementById('bw-reply').value.startsWith('BW1')`, null, { timeout: 20000 });
    const reply = await guest.inputValue('#bw-reply');
    if (lobbyChecks) {
      const g = await probe(guest);
      check('guest: opening the invite link produces a reply code', g.phase === 'lobby' && reply.length > 100, `${reply.length} characters`);
      check('guest: the invite is not left in the address bar', !(await guest.evaluate('location.hash')));
      // wrong pastes are explained, not fatal
      await host.fill('#bw-reply-in', invite);
      await host.click('#bw-connect');
      await host.waitForFunction(`document.getElementById('bw-lerror').textContent.length > 0`, null, { timeout: 5000 });
      const h = await probe(host);
      check('host: pasting the invite instead of the reply is explained', /reply/i.test(h.lobbyError), h.lobbyError);
    }

    await host.fill('#bw-reply-in', reply);
    await host.click('#bw-connect');
    await guest.waitForFunction(`!document.getElementById('bw-lready').hidden`, null, { timeout: 30000 });
    // the host's Start comes alive when the friend's hello arrives; stepped pages
    // on a delayed link only pass time (and so messages) when they are stepped
    for (let i = 0; i < 600; i++) {
      if (await host.evaluate(`!document.getElementById('bw-net-start').disabled`)) break;
      if (manual) await both(host, guest, 0.05, 1 / 60);
      await host.waitForTimeout(40);
    }
    // time for the guest to ping a few times and settle on the quickest round trips
    if (manual) await both(host, guest, 3, 1 / 60);
    else await host.waitForTimeout(1500);
    return { context, host, guest };
  };

  /** How far the two sea clocks are apart right now (seconds; guest minus host). */
  const clockGap = async (host, guest, manual) => {
    const h = await probe(host);
    const g = await probe(guest);
    // in real time the two snapshots are taken a few milliseconds apart: allow for it
    return manual ? g.sea - h.sea : g.sea - h.sea - (g.wall - h.wall) / 1000;
  };

  // ======================================================================= A
  if (!only || only === 'a') {
    console.log('\n— A: the whole flow on a perfect link —');
    const { context, host, guest } = await connect('?manual&dpr=1&laps=1&ap', { manual: true, lobbyChecks: true });
    let h = await probe(host);
    let g = await probe(guest);
    check('both: the link opens and both lobbies say so', h.lobbyReady && g.lobbyReady && h.link && g.link);
    check('guest: adopted the host sea clock', Math.abs(h.sea - g.sea) < 0.03, `host ${h.sea.toFixed(3)} s, guest ${g.sea.toFixed(3)} s`);
    check('guest: only the host can start', await guest.evaluate(`document.getElementById('bw-lhost').hidden && !document.getElementById('bw-lready').hidden && !document.getElementById('bw-lwait').hidden`));
    check('lobby: both see who is in', h.chips.length === 4 && g.chips.length === 4 && /open/.test(h.chips[2]) && /ms/.test(h.chips[1]) && /2 riders \+ 2 bots/.test(h.startLabel), `${h.chips.join(' | ')} · "${h.startLabel}"`);
    await host.screenshot({ path: path.join(outDir, 'lobby_host.jpg'), type: 'jpeg', quality: 85, timeout: 120000 });

    await host.click('#bw-net-start');
    await both(host, guest, 0.5);
    h = await probe(host);
    g = await probe(guest);
    check('both: the race is set up as host + guest + two bots', h.mode === 'online' && g.mode === 'online' && h.racers.map((r) => r.control).join() === 'local,remote,bot,bot' && g.racers.map((r) => r.control).join() === 'remote,local,remote,remote', `${h.racers.map((r) => r.control)} | ${g.racers.map((r) => r.control)}`);

    // GO: each page reports the sea time at which its own lights went out
    let goH = null;
    let goG = null;
    for (let i = 0; i < 400 && (goH === null || goG === null); i++) {
      const H = await host.evaluate(`window.__stepProbe(${1 / 60})`);
      const G = await guest.evaluate(`window.__stepProbe(${1 / 60})`);
      if (goH === null && H.race === 'racing') goH = H.sea;
      if (goG === null && G.race === 'racing') goG = G.sea;
    }
    check('both: GO falls at the same sea time', goH !== null && goG !== null && Math.abs(goH - goG) < 0.03, `host ${goH && goH.toFixed(3)}, guest ${goG && goG.toFixed(3)}`);

    // mid-race: does each side see the other where it really is?
    await both(host, guest, 14, 1 / 60);
    h = await probe(host);
    g = await probe(guest);
    const lagH = dist(h.racers[1], g.racers[1]); // guest's craft: as the host shows it vs where the guest has it
    const lagG = dist(g.racers[0], h.racers[0]);
    const botLag = Math.max(dist(g.racers[2], h.racers[2]), dist(g.racers[3], h.racers[3]));
    check('host: sees the guest where the guest really is', lagH < 1.5 && h.racers[1].kmh > 40, `${lagH.toFixed(2)} m off at ${h.racers[1].kmh.toFixed(0)} km/h`);
    check('guest: sees the host where the host really is', lagG < 1.5 && g.racers[0].kmh > 40, `${lagG.toFixed(2)} m off at ${g.racers[0].kmh.toFixed(0)} km/h`);
    check('guest: sees the host-run bots racing', botLag < 1.5 && g.racers[2].kmh > 40 && g.racers[3].kmh > 40, `worst ${botLag.toFixed(2)} m off`);
    const yGap = Math.max(...g.racers.map((r, i) => Math.abs(r.y - h.racers[i].y)));
    check('both: crafts sit at matching heights on the shared sea', yGap < 0.6, `worst ${yGap.toFixed(2)} m`);
    check('both: progress of remote riders is known', Math.abs(h.racers[1].total - g.racers[1].total) < 3 && Math.abs(g.racers[0].total - h.racers[0].total) < 3, `${(h.racers[1].total - g.racers[1].total).toFixed(1)} m, ${(g.racers[0].total - h.racers[0].total).toFixed(1)} m`);
    check('both: the race clocks agree', Math.abs(h.time - g.time) < 0.03, `host ${h.time.toFixed(3)} s, guest ${g.time.toFixed(3)} s`);
    await host.evaluate('window.__bw.advance(0.2, 10)');
    await host.screenshot({ path: path.join(outDir, 'race_host.jpg'), type: 'jpeg', quality: 85, timeout: 180000 });
    await guest.evaluate('window.__bw.advance(0.2, 10)');
    await guest.screenshot({ path: path.join(outDir, 'race_guest.jpg'), type: 'jpeg', quality: 85, timeout: 180000 });

    // the guest eases off, so the host is home first and has to wait for them
    await guest.evaluate('window.__bw.game.race.racers[1].craft.speedFactor = 0.6');
    for (let i = 0; i < 60; i++) {
      await both(host, guest, 1);
      h = await probe(host);
      if (h.phase === 'results') break;
    }
    await host.evaluate('window.__bw.advance(0.6, 10)');
    h = await probe(host);
    g = await probe(guest);
    check('results: the host cannot start a rematch while the friend is still racing', h.phase === 'results' && !g.racers[1].finished && h.againHidden && /still racing/i.test(h.waitText), `${h.phase}, guest finished: ${g.racers[1].finished}, "${h.waitText}"`);

    // finish + results
    for (let i = 0; i < 40; i++) {
      await both(host, guest, 2.5);
      h = await probe(host);
      g = await probe(guest);
      if (h.phase === 'results' && g.phase === 'results' && h.racers.every((r) => r.finished || r.retired) && g.racers.every((r) => r.finished || r.retired)) break;
    }
    await both(host, guest, 1.5);
    await host.evaluate('window.__bw.advance(0.6, 10)'); // the panel is refreshed as frames are drawn
    await guest.evaluate('window.__bw.advance(0.6, 10)');
    h = await probe(host);
    g = await probe(guest);
    check('both: the race finishes and results come up', h.phase === 'results' && g.phase === 'results' && !h.resultsHidden && !g.resultsHidden, `${h.phase}/${g.phase}`);
    check('both: everyone is reported in on both machines', h.racers.every((r) => r.finished) && g.racers.every((r) => r.finished), `${h.racers.map((r) => r.finished)} | ${g.racers.map((r) => r.finished)}`);
    check('both: the finishing order is the same on both machines', h.order.join() === g.order.join(), `host ${h.order} guest ${g.order}`);
    const finGap = Math.max(...h.racers.map((r, i) => Math.abs(r.fin - g.racers[i].fin)));
    check('both: finish times agree', finGap < 0.01, `worst difference ${finGap.toFixed(4)} s`);
    check('results: host may start the next race, guest is told to wait', !h.againHidden && g.againHidden && !g.waitHidden && /host/i.test(g.waitText), g.waitText);
    await guest.screenshot({ path: path.join(outDir, 'results_guest.jpg'), type: 'jpeg', quality: 85, timeout: 120000 });

    // rematch
    await host.click('#bw-again');
    await both(host, guest, 6);
    h = await probe(host);
    g = await probe(guest);
    check('rematch: the host restarts both machines', h.phase === 'race' && g.phase === 'race' && h.race === 'racing' && g.race === 'racing' && h.racers[0].kmh > 20 && g.racers[1].kmh > 20, `${h.race}/${g.race}`);

    // leaving mid-race
    await host.evaluate('window.__bw.game.toMenu()');
    await guest.waitForFunction('!window.__bw.game.online.link', null, { timeout: 15000 });
    await guest.evaluate('window.__bw.skip(0.5)');
    g = await probe(guest);
    h = await probe(host);
    check('leaving: the host is back on the title screen', h.phase === 'title' && h.mode === 'solo' && !h.link);
    check('leaving: the guest is told and carries on alone', g.broken && /left|lost/i.test(g.toast) && g.racers[0].retired && g.racers[1].kmh > 20, g.toast);
    for (let i = 0; i < 60 && g.phase !== 'results'; i++) {
      await guest.evaluate('window.__bw.skip(2.5)');
      g = await probe(guest);
    }
    await guest.evaluate('window.__bw.advance(0.6, 10)');
    g = await probe(guest);
    check('leaving: alone at the finish, the guest is told why there is no rematch', g.phase === 'results' && g.againHidden && !g.waitHidden && /left/i.test(g.waitText), g.waitText);
    await context.close();
  }

  // ======================================================================= B
  if (!only || only === 'b') {
    const LAG = 80;
    const JITTER = 40;
    const LOSS = 5;
    console.log(`\n— B: a slow, uneven, lossy link (${LAG}–${LAG + JITTER} ms each way, ${LOSS} % of updates lost) —`);
    const { context, host, guest } = await connect(`?manual&dpr=1&laps=1&ap&netlag=${LAG}&netjitter=${JITTER}&netloss=${LOSS}`, { manual: true });
    let gap = await clockGap(host, guest, true);
    check('guest: has the host sea clock despite the delay', Math.abs(gap) < 0.03, `${(gap * 1000).toFixed(0)} ms apart`);
    await host.click('#bw-net-start');
    await both(host, guest, 4.6, 1 / 60); // countdown + off the line
    let h = await probe(host);
    let g = await probe(guest);
    check('both: racing, on clocks that agree', h.race === 'racing' && g.race === 'racing' && Math.abs(h.time - g.time) < 0.03, `host ${h.time.toFixed(3)} s, guest ${g.time.toFixed(3)} s`);

    // 24 s of racing, compared step by step
    const err = { host: [], guest: [], bots: [] };
    const jerk = { host: [], guest: [] };
    let prev = null;
    const slice = 1 / 60;
    // the truth, moved to the instant the other page's clock shows
    const off = (truth, ghost, dSea) => Math.hypot(truth.x + truth.vx * dSea - ghost.x, truth.z + truth.vz * dSea - ghost.z);
    for (let i = 0; i < 24 * 60; i++) {
      const H = await host.evaluate(`window.__stepProbe(${slice})`);
      const G = await guest.evaluate(`window.__stepProbe(${slice})`);
      err.host.push(off(H.racers[0], G.racers[0], G.sea - H.sea));
      err.guest.push(off(G.racers[1], H.racers[1], H.sea - G.sea));
      err.bots.push(Math.max(off(H.racers[2], G.racers[2], G.sea - H.sea), off(H.racers[3], G.racers[3], G.sea - H.sea)));
      if (prev) {
        // smoothness: how much a drawn craft's step differs from the real craft's step
        const stepOf = (now, was) => ({ x: now.x - was.x, z: now.z - was.z });
        const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
        jerk.host.push(d(stepOf(G.racers[0], prev.G.racers[0]), stepOf(H.racers[0], prev.H.racers[0])));
        jerk.guest.push(d(stepOf(H.racers[1], prev.H.racers[1]), stepOf(G.racers[1], prev.G.racers[1])));
      }
      prev = { H, G };
    }
    const eh = stats(err.host);
    const eg = stats(err.guest);
    const eb = stats(err.bots);
    check('guest: draws the host close to where the host really is', eh.mean < 0.6 && eh.p95 < 1.5 && eh.max < 3.5, fmt(eh));
    check('host: draws the guest close to where the guest really is', eg.mean < 0.6 && eg.p95 < 1.5 && eg.max < 3.5, fmt(eg));
    check('guest: draws the bots close to where they really are', eb.mean < 0.8 && eb.p95 < 2 && eb.max < 4, fmt(eb));
    const jh = stats(jerk.host);
    const jg = stats(jerk.guest);
    // a craft covers about 0.4 m per 1/60 s: corrections must stay a small part of that
    check('both: remote crafts move smoothly (no visible snapping)', jh.p95 < 0.12 && jg.p95 < 0.12 && jh.max < 0.5 && jg.max < 0.5, `per 1/60 s — host as drawn: ${fmt(jh)}; guest as drawn: ${fmt(jg)}`);
    gap = await clockGap(host, guest, true);
    check('both: the sea clocks stay together through the race', Math.abs(gap) < 0.03, `${(gap * 1000).toFixed(0)} ms apart`);

    // the host stalls for 1.5 s (hidden tab, a long hitch) while the guest plays on
    const before = await probe(host);
    await host.evaluate('window.__bw.game.engine.onLostTime(1.5)');
    for (let i = 0; i < 90; i++) await guest.evaluate(`window.__bw.game.engine.advance(${slice}, ${slice}, false)`);
    g = await probe(guest);
    check('stall: a silent craft stops where it was last seen instead of sailing on', g.racers[0].kmh < 1 && dist(g.racers[0], before.racers[0]) < 12, `${g.racers[0].kmh.toFixed(0)} km/h, ${dist(g.racers[0], before.racers[0]).toFixed(1)} m from where the host stalled`);
    await both(host, guest, 3, slice);
    h = await probe(host);
    g = await probe(guest);
    gap = g.sea - h.sea;
    check('stall: afterwards both clocks still agree', Math.abs(gap) < 0.03 && Math.abs(h.time - g.time) < 0.03, `sea ${(gap * 1000).toFixed(0)} ms apart, race clocks ${((g.time - h.time) * 1000).toFixed(0)} ms apart`);
    check('stall: the stalled rider lost the time, not the clock', h.time - before.time > 4.4, `race clock moved on ${(h.time - before.time).toFixed(2)} s`);
    check('stall: the picture has caught up again', off(h.racers[0], g.racers[0], g.sea - h.sea) < 1.5, `${off(h.racers[0], g.racers[0], g.sea - h.sea).toFixed(2)} m off`);
    await context.close();
  }

  // ======================================================================= C
  if (!only || only === 'c') {
    console.log('\n— C: both pages in real time (60 ms lag, 20 ms jitter, 3 % loss) —');
    const { context, host, guest } = await connect('?nodraw&dpr=1&laps=1&ap&netlag=60&netjitter=20&netloss=3', { manual: false });
    let gap = await clockGap(host, guest, false);
    check('guest: has the host sea clock', Math.abs(gap) < 0.03, `${(gap * 1000).toFixed(0)} ms apart`);
    await host.click('#bw-net-start');
    await host.waitForFunction(`window.__bw.game.race.state === 'racing'`, null, { timeout: 20000 });
    await guest.waitForFunction(`window.__bw.game.race.state === 'racing'`, null, { timeout: 20000 });
    await host.waitForTimeout(5000);

    const sample = async (seconds) => {
      const err = [];
      const clocks = [];
      const end = Date.now() + seconds * 1000;
      while (Date.now() < end) {
        const [H, G] = await Promise.all([probe(host), probe(guest)]);
        const dSea = G.sea - H.sea - (G.wall - H.wall) / 1000;
        clocks.push(Math.abs(dSea));
        // the truth, moved to the instant the other snapshot was taken
        const dt = (G.wall - H.wall) / 1000;
        err.push(Math.hypot(H.racers[0].x + H.racers[0].vx * dt - G.racers[0].x, H.racers[0].z + H.racers[0].vz * dt - G.racers[0].z));
        err.push(Math.hypot(G.racers[1].x - G.racers[1].vx * dt - H.racers[1].x, G.racers[1].z - G.racers[1].vz * dt - H.racers[1].z));
        await host.waitForTimeout(120);
      }
      return { err: stats(err), clocks: stats(clocks) };
    };
    let s = await sample(12);
    let h = await probe(host);
    let g = await probe(guest);
    check('both: racing in real time', h.racers[0].kmh > 40 && g.racers[1].kmh > 40 && h.racers[1].kmh > 40 && g.racers[0].kmh > 40, `${h.racers.map((r) => r.kmh.toFixed(0))} | ${g.racers.map((r) => r.kmh.toFixed(0))} km/h`);
    check('both: the sea clocks agree in real time', s.clocks.p95 < 0.03 && s.clocks.max < 0.06, fmt({ mean: s.clocks.mean * 1000, p95: s.clocks.p95 * 1000, max: s.clocks.max * 1000 }, 'ms'));
    check('both: the other rider is drawn close to the truth in real time', s.err.mean < 0.8 && s.err.p95 < 2, fmt(s.err));

    // a 700 ms hitch on the host (its main thread is blocked)
    const t0 = await probe(host);
    await host.evaluate('(() => { const t = performance.now(); while (performance.now() - t < 700); })()');
    await host.waitForTimeout(2500);
    s = await sample(4);
    h = await probe(host);
    check('hitch: the clocks agree again afterwards', s.clocks.p95 < 0.03, fmt({ mean: s.clocks.mean * 1000, p95: s.clocks.p95 * 1000, max: s.clocks.max * 1000 }, 'ms'));
    check('hitch: the host clock ran on through it', Math.abs(h.sea - t0.sea - (h.wall - t0.wall) / 1000) < 0.05, `sea moved ${(h.sea - t0.sea).toFixed(2)} s in ${((h.wall - t0.wall) / 1000).toFixed(2)} s`);
    check('hitch: the picture has caught up again', s.err.p95 < 2, fmt(s.err));
    await context.close();
  }

  // ======================================================================= D
  if (!only || only === 'd') {
    console.log('\n— D: four players, each friend joined with an invite and a reply of their own —');
    const query = '?manual&dpr=1&laps=1';
    const context = await browser.newContext({ viewport: { width: 640, height: 360 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const setName = (page, name) => page.evaluate(`(() => { const f = document.getElementById('bw-name'); f.value = ${JSON.stringify(name)}; f.dispatchEvent(new Event('change')); })()`);
    const host = await open(context, 'host', base + query);
    await host.evaluate('window.__bw.skip(3.1)');
    await host.click('#bw-online');
    await setName(host, 'Mike');
    await host.click('#bw-host');
    const guests = [];
    let lastInvite = '';
    for (const name of ['ANNA', 'ben!', 'Cleo']) {
      // the host has a fresh invite on show for the next seat
      await host.waitForFunction(`(() => { const v = document.getElementById('bw-invite').value; return v.includes('#join=BW1') && v !== ${JSON.stringify(lastInvite)}; })()`, null, { timeout: 20000 });
      const invite = await host.inputValue('#bw-invite');
      lastInvite = invite;
      const guest = await open(context, name, base + query + invite.slice(invite.indexOf('#join=')));
      await setName(guest, name);
      await guest.waitForFunction(`document.getElementById('bw-reply').value.startsWith('BW1')`, null, { timeout: 20000 });
      await host.fill('#bw-reply-in', await guest.inputValue('#bw-reply'));
      await host.click('#bw-connect');
      await guest.waitForFunction(`!document.getElementById('bw-lready').hidden`, null, { timeout: 30000 });
      guests.push(guest);
    }
    const pages = [host, ...guests];
    const all = async (seconds, slice = 0.05) => {
      const n = Math.round(seconds / slice);
      for (let i = 0; i < n; i++) for (const page of pages) await page.evaluate(`window.__bw.game.engine.advance(${slice}, ${slice}, false)`);
    };
    await all(1.5, 1 / 60);
    let st = [];
    for (const page of pages) st.push(await probe(page));
    check('lobby: three friends are in, seats 2 to 4, under the names they chose', st[0].roster.join() === 'host:MIKE,guest:ANNA,guest:BEN,guest:CLEO' && st.every((x, i) => x.seat === i && x.roster.join() === st[0].roster.join()), st.map((x) => `${x.seat}:${x.roster.join('/')}`).join(' | '));
    check('lobby: the host is told the seats are full and what Start starts', await host.evaluate(`document.getElementById('bw-linvite').hidden && !document.getElementById('bw-lfull').hidden`) && /4 riders$/.test(st[0].startLabel), st[0].startLabel);
    check('lobby: everyone holds the host sea clock', st.every((x) => Math.abs(x.sea - st[0].sea) < 0.03), st.map((x) => x.sea.toFixed(3)).join(' '));
    await host.screenshot({ path: path.join(outDir, 'lobby_four.jpg'), type: 'jpeg', quality: 85, timeout: 120000 });

    await host.click('#bw-net-start');
    await all(0.6);
    // bots ride for everyone, as their riders
    for (const page of pages) await page.evaluate(`(() => { const g = window.__bw.game; for (const v of g.views) v.racer.driver = v.auto; })()`);
    st = [];
    for (const page of pages) st.push(await probe(page));
    check('race: each machine rides its own seat and sees three others', st.every((x, i) => x.mode === 'online' && x.racers.every((r, k) => r.control === (k === i ? 'local' : 'remote'))), st.map((x) => x.racers.map((r) => r.control[0]).join('')).join(' | '));
    check('race: the riders carry their names on every machine', st.every((x) => x.racers.map((r) => r.name).join() === 'MIKE,ANNA,BEN,CLEO'), st.map((x) => x.racers.map((r) => r.name).join()).join(' | '));

    await all(16, 1 / 60);
    st = [];
    for (const page of pages) st.push(await probe(page));
    // how far is each rider drawn, on each other machine, from where their own machine has them?
    let worst = 0;
    let worstPair = '';
    for (let viewer = 0; viewer < 4; viewer++) {
      for (let seat = 0; seat < 4; seat++) {
        if (seat === viewer) continue;
        const d = dist(st[viewer].racers[seat], st[seat].racers[seat]);
        if (d > worst) {
          worst = d;
          worstPair = `${st[seat].racers[seat].name} as seen by ${st[viewer].racers[viewer].name}`;
        }
      }
    }
    check('race: everyone is drawn where they really are, also guest to guest through the host', worst < 3 && st.every((x) => x.racers.every((r) => r.kmh > 40)), `worst ${worst.toFixed(2)} m (${worstPair})`);
    check('race: the race clocks agree on all four machines', st.every((x) => Math.abs(x.time - st[0].time) < 0.03), st.map((x) => x.time.toFixed(3)).join(' '));
    for (const page of pages) await page.evaluate('window.__bw.advance(0.3, 10)');
    st = [];
    for (const page of pages) st.push(await probe(page));
    // every other rider has a tag; the ones on screen say who, where in the race, and how far away on the wire
    const tagsOk = st.every((x, i) => x.tags.length === 3 && x.tags.every((t) => t.name !== x.racers[i].name && t.text.includes(t.name)));
    const shown = st.flatMap((x) => x.tags.filter((t) => t.shown));
    check('race: each view has a name tag over every other rider, with place and ping', tagsOk && shown.length >= 3 && shown.every((t) => /\d(st|nd|rd|th)/.test(t.text) && /\d+ ms/.test(t.text)), `${shown.length} on screen, e.g. ${shown.slice(0, 3).map((t) => t.text).join(' | ')}`);
    await guests[0].screenshot({ path: path.join(outDir, 'race_four.jpg'), type: 'jpeg', quality: 85, timeout: 180000 });

    // one friend closes the page
    await guests[2].close();
    pages.pop();
    await host.waitForFunction('window.__bw.game.online.peers.length === 2', null, { timeout: 20000 });
    await all(1);
    st = [];
    for (const page of pages) st.push(await probe(page));
    check('leaving: when one friend goes, the other three are told and race on', st.every((x) => x.racers[3].retired && x.gone.join() === '3' && x.active && !x.broken && x.racers.slice(0, 3).every((r) => r.kmh > 30)), st.map((x) => `${x.racers[3].retired}/${x.gone}/${x.active}/${x.broken}`).join(' | '));

    for (let i = 0; i < 50; i++) {
      await all(2.5);
      st = [];
      for (const page of pages) st.push(await probe(page));
      if (st.every((x) => x.phase === 'results' && x.racers.every((r) => r.finished || r.retired))) break;
    }
    await all(1.5);
    for (const page of pages) await page.evaluate('window.__bw.advance(0.6, 10)');
    st = [];
    for (const page of pages) st.push(await probe(page));
    check('results: the same order and times on every machine', st.every((x) => x.phase === 'results' && x.order.join() === st[0].order.join()) && Math.max(...st.map((x) => Math.max(...x.racers.slice(0, 3).map((r, k) => Math.abs(r.fin - st[0].racers[k].fin))))) < 0.01, st.map((x) => x.order.join('')).join(' | '));
    await host.screenshot({ path: path.join(outDir, 'results_four.jpg'), type: 'jpeg', quality: 85, timeout: 120000 });

    // the host goes back to the lobby to fill the empty seat again; the others follow and keep their links
    await host.click('#bw-rlobby');
    await all(1, 1 / 60);
    await host.waitForFunction(`document.getElementById('bw-invite').value.includes('#join=BW1')`, null, { timeout: 20000 });
    st = [];
    for (const page of pages) st.push(await probe(page));
    check('lobby again: links kept, the empty seat is open and a new invite is on show', st.every((x) => x.phase === 'lobby' && x.link) && st[0].roster.join() === 'host:MIKE,guest:ANNA,guest:BEN,open:JUNO' && (await host.inputValue('#bw-invite')).includes('#join=BW1'), st[0].roster.join());
    await host.click('#bw-net-start');
    await all(5);
    st = [];
    for (const page of pages) st.push(await probe(page));
    check('next race: three riders and a bot in the seat that emptied', st.every((x) => x.race === 'racing') && st[0].racers.map((r) => r.control).join() === 'local,remote,remote,bot' && st[1].racers.map((r) => r.control).join() === 'remote,local,remote,remote', `${st[0].racers.map((r) => r.control)} | ${st[1].racers.map((r) => r.control)}`);
    await context.close();
  }

  check('no console errors on any page', problems.length === 0, problems.slice(0, 4).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
