// Wires the engine, the world, the racers, the rules and the HUD together.
//
// Three ways to play, all on the same four crafts:
//   solo    one rider here, three bots
//   split   two riders on one keyboard (WASD + arrows), two viewports, two bots
//   online  one rider here, up to three on other machines (see net/), bots run by the host in the empty seats

import * as THREE from 'three';
import { Engine } from '../engine/Engine.js';
import { ChaseCamera } from '../engine/ChaseCamera.js';
import { Input } from '../engine/Input.js';
import { GameAudio } from '../engine/Audio.js';
import { clamp, clamp01 } from '../engine/math.js';
import { sea } from '../engine/waves.js';
import { TEAMS } from '../assets/palette.js';
import { createWorld } from './World.js';
import { Craft, collideCrafts, collideWithGhost } from './Craft.js';
import { BotDriver, PlayerDriver } from './drivers.js';
import { Race } from './Race.js';
import { Hud } from './Hud.js';
import { Spray, WakeField } from './effects.js';
import { LensDrops } from './LensDrops.js';
import { RULES } from './config.js';
import { OnlinePlay } from '../net/OnlinePlay.js';

// Bots: how much power they can build, base pace, and their habits.
const BOTS = [
  { powerCap: 5, pace: 0.958, bias: 0.0, wobble: 0.6, sharpness: 2.5 },
  { powerCap: 4, pace: 0.968, bias: -3.4, wobble: 1.0, sharpness: 2.2 },
  { powerCap: 4, pace: 0.945, bias: 3.4, wobble: 1.4, sharpness: 2.0 },
];

export class Game {
  /**
   * @param {HTMLElement} root
   * @param {{ pixelRatio?: number, manual?: boolean, draw?: boolean, autopilot?: boolean, laps?: number, seaScale?: number, drops?: boolean, online?: boolean, playUrl?: string, net?: { lag: number, jitter: number, loss: number } }} [options]
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

    const engine = new Engine(hud.canvasHost, { pixelRatio: options.pixelRatio, manual: options.manual, draw: options.draw });
    this.engine = engine;
    const world = createWorld(engine, { waterSegments: coarse ? 176 : 256 });
    this.world = world;

    this.wake = new WakeField(engine.renderer, { size: coarse ? 512 : 1024, extent: 176, maxCrafts: RULES.racers });
    world.env.water.userData.setWake(this.wake.uniforms);
    this.spray = new Spray(coarse ? 1500 : 2200);
    engine.scene.add(this.spray.points);

    this.input = new Input(hud.touchLayer);
    this.crafts = TEAMS.slice(0, RULES.racers).map((team, i) => {
      const craft = new Craft({ team, number: i + 1 });
      engine.scene.add(craft.object);
      return craft;
    });

    /** One per rider on this machine: { racer, camera, chase, hud, rect, pan, emphasis, human, auto, lens, wet }. */
    this.views = [];
    /** Water on each view's camera lens (kept from race to race). */
    this.lenses = [];
    this.mode = 'solo';
    this.phase = 'title'; // title | lobby | race | results
    this._countdownAt = null; // online: the sea time at which both machines start counting down
    this._resultsIn = 0;
    this._orbitIn = 0;
    this._lightsOff = 0;
    this._mapTimer = 0;
    this._resultsTimer = 0;
    this._settledShown = false;
    this._emitAcc = this.crafts.map(() => ({ tail: 0, bow: 0 }));

    this.setupRace('solo');

    engine.onResize(() => this.layout());

    // ---- input feedback
    this.input.onTouchChange = (input) => {
      hud.setTouch(input.isTouch);
      hud.showTouch(input);
    };

    // browsers may suspend audio (tab switch, phone call): any touch brings it back.
    // It also starts it for a rider who was put into a race without tapping Start
    // (the guest of an online race).
    const resumeAudio = () => (this.audio.ctx || this.phase !== 'title') && this.audio.unlock();
    window.addEventListener('pointerdown', resumeAudio, true);
    window.addEventListener('keydown', resumeAudio, true);

    hud.startBtn.addEventListener('click', () => this.start());
    hud.splitBtn.addEventListener('click', () => {
      this.setupRace('split');
      this.start();
    });
    hud.againBtn.addEventListener('click', () => this.restart());
    hud.menuBtn.addEventListener('click', () => this.toMenu());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
      if (typing) return;
      if (e.code === 'KeyM') hud.onToggleSound();
      // Enter starts / restarts (a focused button handles its own Enter as a click)
      if (e.code !== 'Enter' || e.target instanceof HTMLButtonElement) return;
      if (this.phase === 'title') this.start();
      else if (this.phase === 'results' && this.canRestart) this.restart();
    });

    this.online = new OnlinePlay(this);
    this._tagInfo = (racer) => this.online.tagInfo(racer);

    engine.onLostTime = (seconds) => this.online.lostTime(seconds);
    engine.onUpdate = (dt, time) => this.update(dt, time);
    engine.onRender = (frameDt, alpha, time) => this.render(frameDt, alpha, time);
    engine.onDraw = (time) => this.draw(time);
    engine.start();
    if (engine.manual) engine.advance(0);
  }

  // ------------------------------------------------------------ race setup

  /**
   * Build the race for a mode and put everyone on the grid.
   * @param {'solo'|'split'|'online'} mode
   * @param {{ isHost?: boolean, seat?: number, roster?: Array<{ kind: string, name: string }> }} [net]
   *   online only: which seat is ours and who sits in the others
   */
  setupRace(mode, net = {}) {
    const { hud, world, crafts } = this;
    this.mode = mode;
    const auto = !!this.options.autopilot;
    const bot = (i, k) => {
      const b = BOTS[k % BOTS.length];
      return { craft: crafts[i], control: 'bot', driver: new BotDriver(world.track, { ...b, phase: i * 2.1 }), name: crafts[i].team.name, powerCap: b.powerCap, pace: b.pace };
    };
    const local = (i, name, scheme) => ({ craft: crafts[i], control: 'local', driver: new PlayerDriver(this.input, scheme), name: auto ? 'AUTO' : name });
    const remote = (i, name, human) => ({ craft: crafts[i], control: 'remote', human, name });

    let entries;
    if (mode === 'split') entries = [local(0, 'P1', 'wasd'), local(1, 'P2', 'arrows'), bot(2, 0), bot(3, 1)];
    else if (mode === 'online') {
      // our own seat is ridden here; the host also runs the bots; the rest arrive over the link
      let bots = 0;
      entries = net.roster.map((seat, i) => {
        if (i === net.seat) return local(i, seat.name, 'all');
        if (seat.kind === 'bot') return net.isHost ? bot(i, bots++) : remote(i, crafts[i].team.name, false);
        return remote(i, seat.name, true);
      });
    } else entries = [local(0, 'YOU', 'all'), bot(1, 0), bot(2, 1), bot(3, 2)];

    this.race = new Race({ track: world.track, entries, on: this._raceEvents() });
    const race = this.race;

    // one view per rider on this machine
    const locals = race.players;
    this.views = locals.map((racer, n) => {
      const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
      const chase = new ChaseCamera(camera);
      if (!this.lenses[n]) this.lenses[n] = new LensDrops(this.engine.renderer);
      this.lenses[n].clear();
      return {
        lens: this.lenses[n],
        wet: 0,
        racer,
        camera,
        chase,
        hud: null,
        rect: { left: 0, top: 0, width: 1, height: 1 },
        pan: 0,
        emphasis: new Float32Array(world.buoys.length),
        human: racer.driver,
        auto: new BotDriver(world.track, { bias: racer.index ? 1.5 : 0, wobble: 0.4, sharpness: 2.6, phase: 1.1 + racer.index }),
      };
    });
    for (const v of this.views) if (auto) v.racer.driver = v.auto;

    race.reset(this.engine.simTime);
    this.wake.reset();
    this.spray.reset();
    world.arch.userData.setLights(0);
    this.layout();
    for (const v of this.views) {
      v.hud.setStandings(race.racers, v.racer);
      // with friends in the race, every other rider carries a name tag
      v.hud.setTags(mode === 'solo' ? [] : race.racers.filter((r) => r !== v.racer));
      v.hud.hush();
      v.chase.mode = this.phase === 'race' ? 'chase' : 'orbit';
      v.chase.snap(v.racer.craft);
    }
    this._resultsIn = 0;
    this._orbitIn = 0;
    this._settledShown = false;
    this._countdownAt = null;
  }

  /** Size the viewports: side by side on a wide window, stacked on a tall one. */
  layout() {
    const { engine, hud, views } = this;
    if (!views.length) return;
    const two = views.length > 1;
    const sideBySide = engine.aspect >= 1;
    views.forEach((v, i) => {
      if (!two) v.rect = { left: 0, top: 0, width: 1, height: 1 };
      else if (sideBySide) v.rect = { left: i * 0.5, top: 0, width: 0.5, height: 1 };
      else v.rect = { left: 0, top: i * 0.5, width: 1, height: 0.5 };
      const aspect = (engine.width * v.rect.width) / Math.max(1, engine.height * v.rect.height);
      v.camera.aspect = aspect;
      v.camera.updateProjectionMatrix();
      v.chase.setAspect(aspect);
      // sound: a rider is heard from their side of the screen (left / right halves only)
      v.pan = two ? clamp((v.rect.left + v.rect.width / 2 - 0.5) * 2.4, -0.6, 0.6) : 0;
    });
    const huds = hud.setViews(views.map((v) => v.rect));
    views.forEach((v, i) => (v.hud = huds[i]));
    /** What the audio follows: one voice per rider on this machine. */
    this.riders = views.map((v) => ({ craft: v.racer.craft, pan: v.pan }));
  }

  viewOf(racer) {
    for (const v of this.views) if (v.racer === racer) return v;
    return null;
  }

  /**
   * Online, only the host can start the next race: while the link is up, and
   * once the other rider is home too (a rematch would cut their race short).
   */
  get canRestart() {
    if (this.mode !== 'online') return true;
    const o = this.online;
    return o.isHost && o.connected && !o.broken && this.race.humans.every((h) => h.finished || h.retired);
  }

  /** (Re)draw the results panel from the race as it stands. */
  refreshResults() {
    const canRestart = this.canRestart;
    const o = this.online;
    const hosting = this.mode === 'online' && o.isHost && o.connected;
    let note = '';
    if (!canRestart) {
      if (!o.connected) note = 'Everyone else has left. Go back to the menu to play again.';
      else if (o.isHost) note = 'Other riders are still racing…';
      else note = 'Waiting for the host to start the next race…';
    }
    this.hud.showResults(this.race, true, { canRestart, note, toLobby: hosting });
  }

  _raceEvents() {
    const { hud, audio, world } = this;
    return {
      countdown: (n) => {
        for (const v of this.views) v.hud.flash(String(n));
        world.arch.userData.setLights(4 - n);
        audio.countdown();
      },
      go: () => {
        for (const v of this.views) v.hud.flash('GO!', 'go');
        audio.go();
        world.arch.userData.setLights(4);
        this._lightsOff = 3;
      },
      gate: (r, gate, ok) => {
        const v = this.viewOf(r);
        if (!v) return;
        if (ok) {
          const full = r.craft.power >= RULES.maxPower;
          v.hud.say(full ? 'Full power' : 'Clean pass', 'good', 1.0);
          audio.pass(full, v.pan);
        } else {
          audio.miss(v.pan);
          v.hud.flash('MISS', 'bad small');
          v.hud.say(`Power lost · ${RULES.maxMisses - r.misses} misses left`, 'warn', 1.8);
          v.chase.kick(0.35);
        }
      },
      lap: (r, lap) => {
        const v = this.viewOf(r);
        if (!v) return;
        v.hud.flash(lap === this.race.laps ? 'FINAL LAP' : `LAP ${lap}`, 'small');
        audio.lap(v.pan);
      },
      finish: (r) => {
        const v = this.viewOf(r);
        if (!v) return;
        v.hud.flash('FINISH', 'go small');
        audio.finish(v.pan);
        r.driver = v.auto; // cruise while the others come in
        if (this.race.humans.some((h) => h !== r && !h.finished && !h.retired)) v.hud.say('Finished · waiting for the other rider', 'good', 0);
      },
      retire: (r) => {
        const v = this.viewOf(r);
        if (!v) return;
        v.hud.flash('OUT', 'bad');
        audio.miss(v.pan);
      },
      raceOver: () => {
        this._resultsIn = 2.2;
        this._orbitIn = 1.0;
        for (const v of this.views) v.hud.hush();
      },
      offCourse: (r, left) => {
        const v = this.viewOf(r);
        if (!v) return;
        if (left === null) v.hud.hush();
        else v.hud.say(`Back inside the floats · ${Math.ceil(left)}`, 'warn', 0);
      },
      wrongWay: (r, on) => {
        const v = this.viewOf(r);
        if (!v) return;
        if (on) v.hud.say('Wrong way', 'warn', 0);
        else v.hud.hush();
      },
      respawn: (r) => {
        this.wake.trails[r.index].reset();
        const v = this.viewOf(r);
        if (v) v.chase.snap(r.craft);
      },
    };
  }

  // ------------------------------------------------------------ flow

  /**
   * @param {boolean} [fromGesture] false when started by script (no tap to unlock audio with)
   */
  start(fromGesture = true) {
    if (this.phase !== 'title' && this.phase !== 'lobby') return;
    if (fromGesture) this.audio.unlock(); // we are inside the tap / key press that started the race
    this.phase = 'race';
    this.hud.showTitle(false);
    this.hud.showLobby(false);
    this.hud.showRace(true);
    this.hud.showTouchHint(this.input.isTouch && this.views.length === 1);
    for (const v of this.views) v.chase.mode = 'chase';
    this.race.startCountdown();
  }

  /**
   * Online: the race the link has just set up begins on every machine at sea
   * time `at`, wherever this machine was (lobby, results, mid-race).
   */
  startOnline(fromGesture, at) {
    if (fromGesture) this.audio.unlock();
    this.phase = 'race';
    this.hud.showTitle(false);
    this.hud.showLobby(false);
    this.hud.showResults(this.race, false);
    this.hud.showRace(true);
    this.hud.showTouchHint(this.input.isTouch);
    for (const v of this.views) {
      v.chase.mode = 'chase';
      v.chase.snap(v.racer.craft);
    }
    this._countdownAt = at;
  }

  /**
   * Same riders, new race.
   */
  restart() {
    const { race, hud } = this;
    if (this.mode === 'online') {
      this.online.hostStart(); // the link sets the race up again on every machine
      return;
    }
    this.audio.unlock();
    for (const v of this.views) v.racer.driver = this.options.autopilot ? v.auto : v.human;
    race.reset(this.engine.simTime);
    this.wake.reset();
    this.spray.reset();
    this.world.arch.userData.setLights(0);
    hud.showResults(race, false);
    hud.showRace(true);
    this.phase = 'race';
    this._resultsIn = 0;
    this._orbitIn = 0;
    this._settledShown = false;
    for (const v of this.views) {
      v.hud.hush();
      v.chase.mode = 'chase';
      v.chase.snap(v.racer.craft);
    }
    this.race.startCountdown();
  }

  /** Online: back to the lobby with the links kept (between races). */
  toLobby() {
    this.phase = 'lobby';
    this.setupRace('solo');
    this.hud.showResults(this.race, false);
    this.hud.showRace(false);
    this.hud.showTitle(false);
    this.hud.showLobby(true);
  }

  /** Leave the race (and any online link) and go back to the title screen. */
  toMenu() {
    this.online.close();
    this.phase = 'title';
    this.setupRace('solo');
    this.hud.showResults(this.race, false);
    this.hud.showLobby(false);
    this.hud.showRace(false);
    this.hud.showTitle(true);
  }

  // ------------------------------------------------------------ fixed step

  update(dt, time) {
    const { race, world } = this;
    const racers = race.racers;
    this.online.pump(dt);
    if (this._countdownAt !== null && time >= this._countdownAt) {
      // online: both machines count down from the same sea time, however late this one got here
      race.startCountdown(this._countdownAt);
      this._countdownAt = null;
    }
    race.preStep(dt, time);

    // riders simulated on the other machine are placed from what it last told us
    this.online.applyRemote(time, dt);
    for (const r of racers) if (r.control !== 'remote') r.craft.step(dt, time);

    for (const r of racers) {
      if (r.control === 'remote') continue;
      const c = r.craft;
      for (const col of world.colliders) {
        const dx = c.pos.x - col.x;
        const dz = c.pos.z - col.z;
        const reach = col.r + 1.4;
        if (dx * dx + dz * dz < reach * reach) c.collideCircle(col.x, col.z, col.r, col.bounce, col.soft);
      }
      c.collideTerrain(world.terrainHeightAt);
    }
    for (let i = 0; i < racers.length; i++) {
      for (let j = i + 1; j < racers.length; j++) {
        const a = racers[i];
        const b = racers[j];
        const ra = a.control === 'remote';
        const rb = b.control === 'remote';
        if (ra && rb) continue;
        if (ra) collideWithGhost(b.craft, a.craft);
        else if (rb) collideWithGhost(a.craft, b.craft);
        else collideCrafts(a.craft, b.craft);
      }
    }

    race.postStep(dt, time);
    this.online.afterStep(dt, time);
    this._effects(dt, time);
    this._wetLenses(dt);
    this.spray.update(dt, time);

    if (this._lightsOff > 0) {
      this._lightsOff -= dt;
      if (this._lightsOff <= 0) world.arch.userData.setLights(0);
    }
    // after the flag: swing the cameras round, then bring up the results
    if (this._orbitIn > 0) {
      this._orbitIn -= dt;
      if (this._orbitIn <= 0) for (const v of this.views) v.chase.mode = 'orbit';
    }
    if (this._resultsIn > 0) {
      this._resultsIn -= dt;
      if (this._resultsIn <= 0) {
        this.phase = 'results';
        this._resultsTimer = 0;
        this.hud.showRace(false);
        this.refreshResults();
      }
    }
  }

  /** Spray that reaches a camera all the time: the rider's own at speed, and a rooster tail followed too closely. */
  _wetLenses(dt) {
    for (const v of this.views) {
      const me = v.racer.craft;
      let rate = me.grip > 0.3 ? 0.8 * clamp01((me.speed - 14) / 12) : 0;
      for (const c of this.crafts) {
        if (c === me || c.grip < 0.3 || c.speed < 8) continue;
        const dx = me.pos.x - c.pos.x;
        const dz = me.pos.z - c.pos.z;
        const fx = Math.sin(c.yaw);
        const fz = Math.cos(c.yaw);
        const behind = -(dx * fx + dz * fz);
        const side = Math.abs(dx * fz - dz * fx);
        if (behind > 1 && behind < 10 && side < 2.4) rate += 13 * (1 - behind / 10) * (1 - side / 2.4) * c.throttle;
      }
      v.wet += rate * dt;
      while (v.wet >= 1) {
        v.wet -= 1;
        v.lens.splash(1, 0);
      }
    }
  }

  /** Wakes, spray and splashes from what the crafts did this step. */
  _effects(dt, time) {
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

      // only bother with spray near somebody who is watching
      let near = false;
      let view = null;
      for (const v of this.views) {
        const vc = v.racer.craft;
        if (vc === c) view = v;
        const dxp = c.pos.x - vc.pos.x;
        const dzp = c.pos.z - vc.pos.z;
        if (dxp * dxp + dzp * dzp < 130 * 130) near = true;
      }

      if (near && c.grip > 0.3) {
        const acc = this._emitAcc[i];
        // rooster tail from the jet
        acc.tail += dt * 210 * c.throttle * (0.35 + 0.65 * speedK);
        while (acc.tail >= 1) {
          acc.tail -= 1;
          const side = (Math.random() - 0.5) * 1.6;
          this.spray.emit(
            c.pos.x - fx * 1.55 + lx * side * 0.2,
            c.pos.y + 0.12,
            c.pos.z - fz * 1.55 + lz * side * 0.2,
            c.vel.x * 0.5 - fx * (2 + Math.random() * 3) + lx * side,
            2.6 + Math.random() * 4.2 * (0.4 + c.throttle),
            c.vel.z * 0.5 - fz * (2 + Math.random() * 3) + lz * side,
            0.03 + Math.random() * Math.random() * 0.09,
            0.4 + Math.random() * 0.55,
          );
        }
        // sheets of spray peeling off the bow, heavier on the outside of a turn
        if (c.speed > 8) {
          acc.bow += dt * 150 * speedK;
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
              0.03 + Math.random() * Math.random() * 0.085,
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
              this.spray.emit(c.pos.x + Math.cos(a) * 0.8, c.pos.y + 0.1, c.pos.z + Math.sin(a) * 0.8, c.vel.x * 0.6 + Math.cos(a) * sp, 2.5 + Math.random() * 5.5 * (0.4 + ev.strength), c.vel.z * 0.6 + Math.sin(a) * sp, 0.04 + Math.random() * Math.random() * 0.13, 0.55 + Math.random() * 0.5);
            }
          }
          if (view) {
            view.chase.kick(0.25 + ev.strength * 0.6);
            this.audio.splash(ev.strength, view.pan);
            // the splash comes up over the camera
            if (ev.strength > 0.28) view.lens.splash(3 + 30 * ev.strength, ev.strength);
          }
          // and somebody else coming down close by wets the lens too
          for (const v of this.views) {
            if (v === view) continue;
            const d = Math.hypot(c.pos.x - v.racer.craft.pos.x, c.pos.z - v.racer.craft.pos.z);
            if (d < 6) v.lens.splash((2 + 12 * ev.strength) * (1 - d / 6), ev.strength * 0.4);
          }
        } else if (ev.type === 'bump' && view) {
          view.chase.kick(0.2 + ev.strength * 0.6);
          this.audio.splash(0.2 + ev.strength * 0.5, view.pan);
          view.lens.splash(3 + 10 * ev.strength, ev.strength * 0.5);
        }
      }
      c.events.length = 0;
    }
  }

  // --------------------------------------------------------------- render

  /** Once per frame: pose everything, move the cameras, refresh the HUD. */
  render(frameDt, alpha, time) {
    const { race, hud, world } = this;

    for (const c of this.crafts) c.render(alpha, frameDt);
    world.update(time, frameDt);

    // foam + shadows for the wake field (drawn per view in draw())
    this.wake.beginStamps();
    for (const c of this.crafts) {
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const wash = c.grip > 0.2 ? 0.16 + 0.42 * clamp01(c.speed / 16) : 0;
      this.wake.stampCraft(c.undisplacedX + fx * 1.05, c.undisplacedZ + fz * 1.05, fx, fz, wash, Math.max(0, c.pos.y - c.waterY));
    }
    this.wake.update(time);

    const racing = this.phase === 'race';
    for (const v of this.views) {
      v.chase.update(frameDt, v.racer.craft, time);
      v.lens.update(frameDt, clamp01(v.racer.craft.speed / 26));
      // each rider's next mark stands out in their own view
      const next = racing ? v.racer.nextGate : -1;
      const k = Math.min(1, frameDt * 6);
      for (let i = 0; i < v.emphasis.length; i++) v.emphasis[i] += ((i === next ? 1 : 0) - v.emphasis[i]) * k;
      if (this.phase !== 'title' && this.phase !== 'lobby') {
        v.hud.update(frameDt, race, v.racer);
        if (v.hud.tags.length) {
          v.camera.updateMatrixWorld(); // the chase camera has just moved: project with where it is now
          v.hud.updateTags(v.camera, this.engine.width * v.rect.width, this.engine.height * v.rect.height, this._tagInfo);
        }
      }
    }
    if (this.phase !== 'title' && this.phase !== 'lobby') {
      this._mapTimer -= frameDt;
      if (this._mapTimer <= 0) {
        this._mapTimer = 0.08;
        if (!hud.race.hidden) for (const v of this.views) v.hud.drawMap(race, v.racer);
      }
    }

    this.audio.update(this.riders, racing && race.state !== 'grid');

    if (this.phase === 'results' && !this._settledShown) {
      this._resultsTimer -= frameDt;
      if (this._resultsTimer <= 0) {
        this._resultsTimer = 0.5;
        this.refreshResults();
        // online, what the panel offers can still change (the friend finishes, or leaves)
        if (race.settled && (this.mode !== 'online' || !this.online.link)) this._settledShown = true;
      }
    }
  }

  /** Draw every rider's viewport. */
  draw(time) {
    const { engine, world } = this;
    const renderer = engine.renderer;
    const W = engine.width;
    const H = engine.height;
    const split = this.views.length > 1;
    renderer.setScissorTest(split);
    for (const v of this.views) {
      const p = v.racer.craft.object.position;
      // the foam field and the dense part of the ocean mesh sit under this view's rider
      this.wake.render(p.x, p.z);
      world.prepareView(time, v.camera, p.x, p.z);
      const w = Math.round(v.rect.width * W);
      const h = Math.round(v.rect.height * H);
      const x = Math.round(v.rect.left * W);
      const y = H - Math.round(v.rect.top * H) - h; // GL's origin is bottom-left
      this.spray.setProjection(h * engine.pixelRatio, v.camera.fov);
      for (let i = 0; i < world.buoys.length; i++) world.buoys[i].userData.pose(time, v.emphasis[i]);
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.render(engine.scene, v.camera);
      // water on the lens goes on last, bending what was just drawn
      // (left out on devices that are already struggling to keep up)
      if (this.options.drops !== false && engine._qualitySteps < 2) {
        const pr = engine.pixelRatio;
        v.lens.render(Math.round(x * pr), Math.round(y * pr), Math.round(w * pr), Math.round(h * pr));
      }
    }
  }
}
