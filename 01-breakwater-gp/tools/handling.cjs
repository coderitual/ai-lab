// How the boat answers the helm: scripted manoeuvres on a calm sea, measured.
//
//   node tools/handling.cjs [URL]        default http://localhost:5173/ (the dev server); the build does as well
//
// For each manoeuvre and each phase of it: how far the boat turned, the angle between where it points and where it
// is going (slip) now and at most, its speed now and at least, and the radius of its turn. These are the figures in
// docs/spec.md, section 4: run this after changing anything in CRAFT_TUNE and bring that table up to date.

const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${base}?auto&manual&dpr=1&reflect=0&shadows=0&sea=0.04`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__ready === true && !!window.__bw', null, { timeout: 120000 });
  const results = await page.evaluate(() => {
    const game = window.__bw.game;
    game.race.respawn = () => {}; // the manoeuvres are out on open water: nobody is put back on the course
    const engine = game.engine;
    const racer = game.views[0].racer;
    const boat = racer.craft;
    const helm = { steer: 0, throttle: 1, brake: 0 };
    racer.driver = {
      update() {
        Object.assign(boat.input, { analog: true, steer: helm.steer, throttle: helm.throttle, brake: helm.brake });
      },
    };
    // the others stay on the grid
    for (const other of game.race.racers) {
      if (other !== racer) other.driver = { update: () => Object.assign(other.craft.input, { throttle: 0, steer: 0, brake: 1 }) };
    }
    const run = (seconds, each) => {
      const steps = Math.round(seconds * 120);
      for (let i = 0; i < steps; i++) {
        engine.advance(1 / 120, 1 / 120, false);
        if (each) each();
      }
    };
    const degrees = (radians) => +((radians * 180) / Math.PI).toFixed(1);
    run(5); // past the countdown

    const manoeuvre = (phases) => {
      // out to open water, straight, at full power
      boat.place(400, 400, 0.6, engine.simTime, 26);
      boat.power = 5;
      Object.assign(helm, { steer: 0, throttle: 1, brake: 0 });
      run(3);
      return phases.map(([name, seconds, set]) => {
        Object.assign(helm, set);
        const yaw0 = boat.yaw;
        let mostSlip = 0;
        let leastSpeed = Infinity;
        run(seconds, () => {
          mostSlip = Math.max(mostSlip, Math.abs(boat.slip));
          leastSpeed = Math.min(leastSpeed, boat.speed);
        });
        return {
          phase: `${name} ${seconds} s`,
          turned: degrees(Math.abs(boat.yaw - yaw0)),
          slip: degrees(Math.abs(boat.slip)),
          mostSlip: degrees(mostSlip),
          kmh: Math.round(boat.speed * 3.6),
          leastKmh: Math.round(leastSpeed * 3.6),
          radius: Math.abs(boat.yawRate) > 0.02 ? Math.round(boat.speed / Math.abs(boat.yawRate)) : null,
          roll: degrees(boat.roll),
        };
      });
    };
    return {
      'half lock': manoeuvre([['hold', 3, { steer: 0.5 }]]),
      'full lock, then let go': manoeuvre([
        ['lock', 1, { steer: 1 }],
        ['lock', 2, {}],
        ['let go', 0.5, { steer: 0 }],
        ['let go', 1, {}],
      ]),
      'full lock and brake, then power': manoeuvre([
        ['lock', 0.4, { steer: 1 }],
        ['brake', 0.9, { brake: 1, throttle: 0 }],
        ['power', 1.5, { brake: 0, throttle: 1 }],
        ['let go', 1.2, { steer: 0 }],
      ]),
      'flick one way, then the other': manoeuvre([
        ['left', 0.7, { steer: -1 }],
        ['right', 1.2, { steer: 1 }],
        ['let go', 1.2, { steer: 0 }],
      ]),
    };
  });
  for (const [name, rows] of Object.entries(results)) {
    console.log(`\n${name}`);
    console.table(rows);
  }
  if (problems.length) {
    console.log('PROBLEMS\n' + problems.join('\n'));
    process.exitCode = 1;
  }
  await browser.close();
})();
