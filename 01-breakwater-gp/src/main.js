// Entry point. Query options (all optional, mostly for testing):
//   ?auto      start the race straight away
//   ?ap        let a bot ride the player's craft
//   ?mode=split  two riders on one keyboard
//   ?laps=1    shorter race
//   ?dpr=1     force the canvas pixel ratio
//   ?sea=0.8   scale the wave height
//   ?manual    do not run the frame loop (step with __bw.advance)
//   ?nodraw    run the frame loop without rendering
//   ?netlag=80&netjitter=30&netloss=5
//              online play: hold back (ms) and drop (%) what this page receives

import { Game } from './game/Game.js';

const q = new URLSearchParams(location.search);
const num = (key) => (q.has(key) ? parseFloat(q.get(key)) : undefined);
const loading = document.getElementById('loading');
// The host page can switch online play off (data-online="off": an embed that
// cannot open direct connections) and say where the full game lives (data-play-url).
const root = document.getElementById('game');

try {
  const game = new Game(root, {
    online: root.dataset.online !== 'off',
    playUrl: root.dataset.playUrl || '',
    pixelRatio: num('dpr'),
    manual: q.has('manual'),
    autopilot: q.has('ap'),
    laps: num('laps'),
    seaScale: num('sea'),
    draw: !q.has('nodraw'),
    net: { lag: (num('netlag') || 0) / 1000, jitter: (num('netjitter') || 0) / 1000, loss: (num('netloss') || 0) / 100 },
  });
  if (q.get('mode') === 'split') game.setupRace('split');
  if (q.has('auto')) game.start(false);
  if (loading) loading.remove();

  // Small handle for automated checks and for poking around in the console.
  window.__bw = {
    game,
    /** Advance `seconds` of game time at `fps`, drawing every frame. */
    advance(seconds, fps = 60) {
      const n = Math.round(seconds * fps);
      for (let i = 0; i < n; i++) game.engine.advance(1 / fps);
    },
    /** Fast-forward without drawing, then draw once. */
    skip(seconds) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) game.engine.advance(1 / 60, 1 / 60, false);
      game.engine.advance(1 / 60);
    },
  };
  window.__ready = true;
} catch (err) {
  console.error(err);
  if (loading) loading.textContent = 'This device could not start WebGL. Try a recent version of Safari or Chrome.';
  window.__ready = true;
}
