// Wires the engine, the world, the racers, the rules and the HUD together.

import { Engine } from '../engine/Engine.js';
import { ChaseCamera } from '../engine/ChaseCamera.js';
import { Input } from '../engine/Input.js';
import { GameAudio } from '../engine/Audio.js';
import { clamp01 } from '../engine/math.js';
import { sea } from '../engine/waves.js';
import { TEAMS } from '../assets/palette.js';
import { createWorld } from './World.js';
import { Craft, collideCrafts } from './Craft.js';
import { BotDriver, PlayerDriver } from './drivers.js';
import { Race } from './Race.js';
import { Hud } from './Hud.js';
import { Spray, WakeField } from './effects.js';
import { RULES } from './config.js';

// Bots: how much power they can build, base pace, and their habits.
const BOTS = [
  { powerCap: 5, pace: 0.958, bias: 0.0, wobble: 0.6, sharpness: 2.5 },
  { powerCap: 4, pace: 0.968, bias: -3.4, wobble: 1.0, sharpness: 2.2 },
  { powerCap: 4, pace: 0.945, bias: 3.4, wobble: 1.4, sharpness: 2.0 },
];

export class Game {
  /**
   * @param {HTMLElement} root
   * @param {{ pixelRatio?: number, manual?: boolean, autopilot?: boolean, laps?: number, seaScale?: number }} [options]
   */
  constructor(root, options = {}) {
    this.options = options;
    if (options.laps) RULES.laps = options.laps;
    if (options.seaScale) sea.scale = options.seaScale;

    const hud = new Hud(root);
    this.hud = hud;
    const audio = new GameAudio();
    this.audio = audio;
    hud.setSoundLabel(audio.muted);
    hud.onToggleSound = () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
      hud.setSoundLabel(audio.muted);
    };
    const coarse = matchMedia('(pointer: coarse)').matches;

    const engine = new Engine(hud.canvasHost, { pixelRatio: options.pixelRatio, manual: options.manual });
    this.engine = engine;
    const world = createWorld(engine, { waterSegments: coarse ? 176 : 256 });
    this.world = world;

    this.wake = new WakeField(engine.renderer, { size: coarse ? 512 : 1024, extent: 176, maxCrafts: RULES.racers });
    world.env.water.userData.setWake(this.wake.uniforms);
    this.spray = new Spray(1400);
    engine.scene.add(this.spray.points);

    // ---- racers
    this.input = new Input(hud.touchLayer);
    this.crafts = TEAMS.slice(0, RULES.racers).map((team, i) => {
      const craft = new Craft({ team, number: i + 1, isPlayer: i === 0 });
      engine.scene.add(craft.object);
      return craft;
    });
    this.playerDriver = new PlayerDriver(this.input);
    this.autoDriver = new BotDriver(world.track, { bias: 0, wobble: 0.4, sharpness: 2.6, phase: 1.1 });
    const entries = this.crafts.map((craft, i) => {
      if (i === 0) return { craft, driver: options.autopilot ? this.autoDriver : this.playerDriver, name: team0Name(options), isPlayer: true };
      const b = BOTS[(i - 1) % BOTS.length];
      return { craft, driver: new BotDriver(world.track, { ...b, phase: i * 2.1 }), name: craft.team.name, powerCap: b.powerCap, pace: b.pace };
    });

    this.race = new Race({
      track: world.track,
      entries,
      on: {
        countdown: (n) => {
          hud.flash(String(n));
          world.arch.userData.setLights(4 - n);
          audio.countdown();
        },
        go: () => {
          hud.flash('GO!', 'go');
          audio.go();
          world.arch.userData.setLights(4);
          this._lightsOff = 3;
        },
        gate: (r, gate, ok) => {
          if (!r.isPlayer) return;
          if (ok) {
            const full = r.craft.power >= RULES.maxPower;
            hud.say(full ? 'Full power' : 'Clean pass', 'good', 1.0);
            audio.pass(full);
          } else {
            audio.miss();
            hud.flash('MISS', 'bad small');
            hud.say(`Power lost · ${RULES.maxMisses - r.misses} misses left`, 'warn', 1.8);
            this.camera.kick(0.35);
          }
        },
        lap: (r, lap) => {
          if (!r.isPlayer) return;
          hud.flash(lap === this.race.laps ? 'FINAL LAP' : `LAP ${lap}`, 'small');
          audio.lap();
        },
        finish: (r) => {
          if (!r.isPlayer) return;
          hud.flash('FINISH', 'go small');
          audio.finish();
        },
        retire: () => {
          hud.flash('OUT', 'bad');
          audio.miss();
        },
        raceOver: (player) => {
          player.driver = this.autoDriver; // cruise while the results come up
          this._resultsIn = 2.2;
          this._orbitIn = 1.0;
          hud.hush();
        },
        offCourse: (r, left) => {
          if (left === null) hud.hush();
          else hud.say(`Back inside the floats · ${Math.ceil(left)}`, 'warn', 0);
        },
        wrongWay: (on) => (on ? hud.say('Wrong way', 'warn', 0) : hud.hush()),
        respawn: (r) => {
          this.wake.trails[r.index].reset();
          if (r.isPlayer) this.camera.snap(r.craft);
        },
      },
    });
    hud.setStandings(this.race.racers);

    // ---- camera
    this.camera = new ChaseCamera(engine.camera);
    engine.onResize((w, h, aspect) => this.camera.setAspect(aspect));

    // ---- input feedback
    this.input.onTouchChange = (input) => {
      hud.setTouch(input.isTouch);
      hud.showTouch(input);
    };

    // browsers may suspend audio (tab switch, phone call): any touch brings it back
    const resumeAudio = () => this.audio.ctx && this.audio.unlock();
    window.addEventListener('pointerdown', resumeAudio, true);
    window.addEventListener('keydown', resumeAudio, true);

    hud.startBtn.addEventListener('click', () => this.start());
    hud.againBtn.addEventListener('click', () => this.restart());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') hud.onToggleSound();
      // Enter starts / restarts (a focused button handles its own Enter as a click)
      if (e.code !== 'Enter' || e.target instanceof HTMLButtonElement) return;
      if (this.phase === 'title') this.start();
      else if (this.phase === 'results') this.restart();
    });

    this.phase = 'title'; // title | race | results
    this._resultsIn = 0;
    this._orbitIn = 0;
    this._lightsOff = 0;
    this._mapTimer = 0;
    this._resultsTimer = 0;
    this._emitAcc = this.crafts.map(() => ({ tail: 0, bow: 0 }));

    this.race.reset(0);
    this.camera.mode = 'orbit';
    this.camera.snap(this.crafts[0]);
    hud.showRace(false);
    hud.showTitle(true);

    engine.onUpdate = (dt, time) => this.update(dt, time);
    engine.onRender = (frameDt, alpha, time) => this.render(frameDt, alpha, time);
    engine.start();
    if (engine.manual) engine.advance(0);
  }

  /** @param {boolean} [fromGesture] false when started by script (no tap to unlock audio with) */
  start(fromGesture = true) {
    if (this.phase !== 'title') return;
    if (fromGesture) this.audio.unlock(); // we are inside the tap / key press that started the race
    this.phase = 'race';
    this.hud.showTitle(false);
    this.hud.showRace(true);
    this.camera.mode = 'chase';
    this.race.startCountdown();
  }

  restart() {
    const { race, hud } = this;
    this.audio.unlock();
    race.player.driver = this.options.autopilot ? this.autoDriver : this.playerDriver;
    race.reset(this.engine.simTime);
    this.wake.reset();
    this.spray.reset();
    this.world.arch.userData.setLights(0);
    hud.showResults(race, false);
    hud.showRace(true);
    hud.hush();
    this.phase = 'race';
    this._resultsIn = 0;
    this._orbitIn = 0;
    this.camera.mode = 'chase';
    this.camera.snap(this.crafts[0]);
    race.startCountdown();
  }

  // ------------------------------------------------------------ fixed step

  update(dt, time) {
    const { race, world, crafts } = this;
    race.preStep(dt, time);

    for (const c of crafts) c.step(dt, time);

    for (const c of crafts) {
      for (const col of world.colliders) {
        const dx = c.pos.x - col.x;
        const dz = c.pos.z - col.z;
        const reach = col.r + 1.4;
        if (dx * dx + dz * dz < reach * reach) c.collideCircle(col.x, col.z, col.r, col.bounce, col.soft);
      }
      c.collideTerrain(world.terrainHeightAt);
    }
    for (let i = 0; i < crafts.length; i++) {
      for (let j = i + 1; j < crafts.length; j++) collideCrafts(crafts[i], crafts[j]);
    }

    race.postStep(dt, time);
    this._effects(dt, time);
    this.spray.update(dt, time);

    if (this._lightsOff > 0) {
      this._lightsOff -= dt;
      if (this._lightsOff <= 0) world.arch.userData.setLights(0);
    }
    // after the flag: swing the camera round, then bring up the results
    if (this._orbitIn > 0) {
      this._orbitIn -= dt;
      if (this._orbitIn <= 0) this.camera.mode = 'orbit';
    }
    if (this._resultsIn > 0) {
      this._resultsIn -= dt;
      if (this._resultsIn <= 0) {
        this.phase = 'results';
        this._resultsTimer = 0;
        this.hud.showRace(false);
        this.hud.showResults(race, true);
      }
    }
  }

  /** Wakes, spray and splashes from what the crafts did this step. */
  _effects(dt, time) {
    const player = this.crafts[0];
    for (let i = 0; i < this.crafts.length; i++) {
      const c = this.crafts[i];
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const lx = fz;
      const lz = -fx;
      const speedK = clamp01(c.speed / 24);

      // wake: travel direction where there is one, heading otherwise
      const inv = c.speed > 1 ? 1 / c.speed : 0;
      const dirX = inv ? c.vel.x * inv : fx;
      const dirZ = inv ? c.vel.z * inv : fz;
      const strength = c.grip > 0.3 ? clamp01(c.speed / 8) * (0.5 + 0.5 * c.throttle) : 0;
      this.wake.emit(i, c.undisplacedX, c.undisplacedZ, dirX, dirZ, time, strength);

      const dxp = c.pos.x - player.pos.x;
      const dzp = c.pos.z - player.pos.z;
      const near = dxp * dxp + dzp * dzp < 130 * 130;

      if (near && c.grip > 0.3) {
        const acc = this._emitAcc[i];
        // rooster tail from the jet
        acc.tail += dt * 120 * c.throttle * (0.35 + 0.65 * speedK);
        while (acc.tail >= 1) {
          acc.tail -= 1;
          const side = (Math.random() - 0.5) * 1.6;
          this.spray.emit(
            c.pos.x - fx * 1.55 + lx * side * 0.2,
            c.pos.y + 0.12,
            c.pos.z - fz * 1.55 + lz * side * 0.2,
            c.vel.x * 0.5 - fx * (2 + Math.random() * 3) + lx * side,
            2.6 + Math.random() * 3.6 * (0.4 + c.throttle),
            c.vel.z * 0.5 - fz * (2 + Math.random() * 3) + lz * side,
            0.05 + Math.random() * Math.random() * 0.16,
            0.4 + Math.random() * 0.5,
          );
        }
        // sheets of spray peeling off the bow, heavier on the outside of a turn
        if (c.speed > 8) {
          acc.bow += dt * 110 * speedK;
          while (acc.bow >= 1) {
            acc.bow -= 1;
            const turn = Math.max(-1, Math.min(1, c.yawRate));
            const sideSign = Math.random() < 0.5 - turn * 0.3 ? 1 : -1; // +1 = port
            const out = 2.2 + Math.random() * 2.8;
            this.spray.emit(
              c.pos.x + fx * 0.55 + lx * sideSign * 0.5,
              c.pos.y + 0.1,
              c.pos.z + fz * 0.55 + lz * sideSign * 0.5,
              c.vel.x * 0.72 + lx * sideSign * out,
              1.5 + Math.random() * 2.4,
              c.vel.z * 0.72 + lz * sideSign * out,
              0.045 + Math.random() * Math.random() * 0.14,
              0.3 + Math.random() * 0.4,
            );
          }
        }
      }

      // one-shot events
      for (const ev of c.events) {
        if (ev.type === 'land') {
          this.wake.splash(c.undisplacedX + fx * 1.0, c.undisplacedZ + fz * 1.0, time, 2.4 + ev.strength * 3.2, 0.6 + 0.4 * ev.strength);
          if (near) {
            const n = Math.round(18 + ev.strength * 46);
            for (let k = 0; k < n; k++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 2.5 + Math.random() * 5 * (0.5 + ev.strength);
              this.spray.emit(c.pos.x + Math.cos(a) * 0.8, c.pos.y + 0.1, c.pos.z + Math.sin(a) * 0.8, c.vel.x * 0.6 + Math.cos(a) * sp, 2.5 + Math.random() * 5.5 * (0.4 + ev.strength), c.vel.z * 0.6 + Math.sin(a) * sp, 0.06 + Math.random() * Math.random() * 0.2, 0.55 + Math.random() * 0.5);
            }
          }
          if (c.isPlayer) {
            this.camera.kick(0.25 + ev.strength * 0.6);
            this.audio.splash(ev.strength);
          }
        } else if (ev.type === 'bump' && c.isPlayer) {
          this.camera.kick(0.2 + ev.strength * 0.6);
          this.audio.splash(0.2 + ev.strength * 0.5);
        }
      }
      c.events.length = 0;
    }
  }

  // --------------------------------------------------------------- render

  render(frameDt, alpha, time) {
    const { engine, race, hud, world } = this;
    const player = this.crafts[0];

    for (const c of this.crafts) c.render(alpha, frameDt);

    this.camera.update(frameDt, player, time);
    this.spray.setProjection(engine.height * engine.pixelRatio, engine.camera.fov);

    // foam + shadows into the wake field, centred on the player
    this.wake.beginStamps();
    for (const c of this.crafts) {
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const wash = c.grip > 0.2 ? 0.16 + 0.42 * clamp01(c.speed / 16) : 0;
      this.wake.stampCraft(c.undisplacedX + fx * 1.05, c.undisplacedZ + fz * 1.05, fx, fz, wash, Math.max(0, c.pos.y - c.waterY));
    }
    this.wake.render(time, player.object.position.x, player.object.position.z);

    const nextGate = this.phase === 'race' ? race.player.nextGate : -1;
    for (let i = 0; i < world.buoys.length; i++) world.buoys[i].userData.setActive(i === nextGate);
    world.update(time, frameDt, engine.camera, player.object.position.x, player.object.position.z);

    this.audio.update(player, this.phase === 'race' && race.state !== 'grid');

    // HUD
    if (this.phase !== 'title') {
      hud.update(frameDt, race, player);
      this._mapTimer -= frameDt;
      if (this._mapTimer <= 0) {
        this._mapTimer = 0.08;
        hud.drawMap(race);
      }
    }
    if (this.phase === 'results' && !this._settledShown) {
      this._resultsTimer -= frameDt;
      if (this._resultsTimer <= 0) {
        this._resultsTimer = 0.5;
        hud.showResults(race, true);
        if (race.settled) this._settledShown = true;
      }
    }
    if (this.phase !== 'results') this._settledShown = false;
  }
}

function team0Name(options) {
  return options.autopilot ? 'AUTO' : TEAMS[0].name;
}
