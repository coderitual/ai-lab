// Online two-player races over a PeerLink.
//
// Who simulates what:
//   - each machine rides its own craft with its own physics and rules
//   - the host also runs the two bots
//   - everything else is a "remote" craft: its pose and race progress arrive in
//     small state messages 20 times a second; its position is predicted forward
//     to now, its attitude replayed a moment late (see applyRemote)
//
// One clock. Both machines keep the same "sea time": the guest sets its clock
// to the host's (ping / pong, taking the quickest of the recent round trips)
// and keeps trimming it during the race. The waves, the start lights, the race
// clock and the timestamps on the state messages all read that clock. While a
// link is up the clock is tied to real time: a machine that drops frames or
// has its tab hidden loses ground on the water, not time on the clock.

import { PeerLink, rtcSupported } from './PeerLink.js';
import { makeSurfaceSample, sampleSurface } from '../engine/waves.js';
import { angleDiff, clamp } from '../engine/math.js';

const PROTOCOL = 1;
const SEND_HZ = 20;
const REPLAY_DELAY = 0.08; // attitude is replayed this far behind now, between the last two reports
const MAX_EXTRAPOLATE = 0.3; // seconds a craft is coasted past its newest report
const START_LEAD = 0.9; // the host announces the countdown this far ahead, so the message is there in time
const sStern = makeSurfaceSample();

const round = (v, p = 100) => Math.round(v * p) / p;

export class OnlinePlay {
  /** @param {import('../game/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.link = null;
    this.isHost = false;
    /** true while a race is being played over an open link */
    this.active = false;
    this.broken = false;
    this.raceId = 0;
    this._sendAcc = 0;
    this._pingAcc = 0;
    this._rtts = []; // recent ping round trips, seconds
    this._synced = false; // guest: has the host's clock
    this._pendingStart = null; // guest: a start that arrived before the clock did
    this._elapsed = 0; // seconds of stepping (the stopwatch under ?manual)
    /** How far the guest's clock was from the host's at the last ping, seconds (for checks). */
    this.clockError = 0;

    // dev: ?netlag=80&netjitter=30&netloss=5 holds back / drops what this page
    // receives, to try the game on a bad connection without having one
    const sim = game.options.net;
    this.conditions = sim && (sim.lag > 0 || sim.jitter > 0 || sim.loss > 0) ? sim : null;
    this._inbox = [];
    this._inboxOrder = 0;
    this._seed = 12345;
    /** per racer index: states received from the other machine, oldest first */
    this.buffers = new Map();
    /** per racer index: prediction state of the craft drawn here */
    this.ghosts = new Map();

    this._wireLobby();

    // an invite link opens straight into "join"
    const m = location.hash.match(/^#join=(.+)$/);
    if (m) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        /* sandboxed frames may refuse; harmless */
      }
      queueMicrotask(() => this.openLobby('join', m[1]));
    }
  }

  // ------------------------------------------------------------ lobby

  _wireLobby() {
    const { hud } = this.game;
    const l = hud.l;
    hud.onlineBtn.addEventListener('click', () => this.openLobby());
    l.back.addEventListener('click', () => this.game.toMenu());
    l.hostBtn.addEventListener('click', () => this._host());
    l.joinBtn.addEventListener('click', () => hud.lobbyStep('join'));
    l.makeReply.addEventListener('click', () => this._join(l.inviteIn.value));
    l.connect.addEventListener('click', () => this._connect(l.replyIn.value));
    l.start.addEventListener('click', () => this.hostStart());
    const copy = (button, field, label) =>
      button.addEventListener('click', async () => {
        field.focus();
        field.select();
        try {
          await navigator.clipboard.writeText(field.value);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Selected: press Ctrl/Cmd+C';
        }
        setTimeout(() => (button.textContent = label), 1800);
      });
    copy(l.copyInvite, l.invite, 'Copy link');
    copy(l.copyReply, l.reply, 'Copy code');
    // phones: hand the text straight to a chat app through the system share sheet
    const share = (button, data) => {
      if (typeof navigator.share !== 'function') return;
      button.hidden = false;
      button.addEventListener('click', async () => {
        try {
          await navigator.share(data());
        } catch {
          /* cancelled, or sharing is not allowed here: Copy still works */
        }
      });
    };
    share(l.shareInvite, () => ({ text: 'Race me at Breakwater GP:', url: l.invite.value }));
    share(l.shareReply, () => ({ text: l.reply.value }));
  }

  /** Show the lobby. `step` 'join' with a code starts answering that invite at once. */
  openLobby(step = 'choose', inviteCode = '') {
    const { game } = this;
    const { hud } = game;
    if (game.phase !== 'title' && game.phase !== 'lobby') return;
    this.close();
    game.phase = 'lobby';
    hud.showTitle(false);
    hud.showLobby(true);
    hud.lobbyStep(step);
    hud.l.join2.hidden = true;
    hud.l.invite.value = hud.l.reply.value = hud.l.replyIn.value = '';
    hud.l.inviteIn.value = inviteCode;
    if (!rtcSupported() || game.options.online === false) {
      // an old browser, or an embedded preview that may not open direct connections
      const where = game.options.playUrl ? `Open ${game.options.playUrl} to play online.` : 'Open the game from its public web address to play online.';
      hud.lobbyStep('choose');
      hud.l.hostBtn.disabled = hud.l.joinBtn.disabled = true;
      hud.lobbyError(`Direct connections are not possible from this page. ${where}`);
      return;
    }
    hud.l.hostBtn.disabled = hud.l.joinBtn.disabled = false;
    if (step === 'join' && inviteCode) this._join(inviteCode);
  }

  _newLink(isHost) {
    this.close();
    this.isHost = isHost;
    this.broken = false;
    this._synced = false;
    this._pendingStart = null;
    this._rtts.length = 0;
    this._inbox.length = 0;
    this._inboxOrder = 0;
    this.link = new PeerLink({
      onOpen: () => this._onOpen(),
      onClose: (reason) => this._onGone(reason),
      onMessage: (msg) => this._receive(msg),
    });
    return this.link;
  }

  async _host() {
    const { hud } = this.game;
    hud.lobbyStep('host');
    hud.l.invite.value = 'Preparing your invite…';
    hud.l.copyInvite.disabled = hud.l.shareInvite.disabled = hud.l.connect.disabled = true;
    try {
      const code = await this._newLink(true).createInvite();
      hud.l.invite.value = `${location.origin}${location.pathname}#join=${code}`;
      hud.l.copyInvite.disabled = hud.l.shareInvite.disabled = hud.l.connect.disabled = false;
    } catch (err) {
      hud.lobbyError(`Could not prepare an invite: ${err.message}`);
    }
  }

  async _join(invite) {
    const { hud } = this.game;
    hud.lobbyStep('join');
    hud.l.inviteIn.value = invite;
    hud.l.makeReply.disabled = true;
    try {
      const reply = await this._newLink(false).acceptInvite(invite);
      hud.l.reply.value = reply;
      hud.l.join2.hidden = false;
    } catch (err) {
      hud.lobbyError(err.message);
    }
    hud.l.makeReply.disabled = false;
  }

  async _connect(reply) {
    const { hud } = this.game;
    if (!this.link) return;
    hud.lobbyError('');
    hud.l.connect.disabled = true;
    try {
      await this.link.acceptReply(reply);
      hud.l.connect.textContent = 'Connecting…';
    } catch (err) {
      hud.lobbyError(err.message);
      hud.l.connect.disabled = false;
    }
  }

  _onOpen() {
    this.link.send({ k: 'hello', v: PROTOCOL }, true);
    if (!this.isHost) this._ping();
    this._showReady();
  }

  _showReady() {
    const { game } = this;
    if (game.phase !== 'lobby') return;
    game.hud.l.connect.textContent = 'Connect';
    game.hud.lobbyStep('ready', {
      isHost: this.isHost,
      status: this.isHost ? 'Your friend is connected' : 'Connected to your friend',
    });
  }

  _onGone(reason) {
    const { game } = this;
    this.link = null;
    if (game.phase === 'lobby') {
      if (reason !== 'closed') {
        // the invite and the reply died with the link: back to the first step for fresh ones
        game.hud.lobbyStep('choose');
        game.hud.l.connect.disabled = false;
        game.hud.l.connect.textContent = 'Connect';
        game.hud.lobbyError(reason);
      }
      return;
    }
    if (!this.active) return;
    // mid-race: carry on alone; the riders from the other machine drop out
    this.active = false;
    this.broken = true;
    for (const r of game.race.racers) {
      if (r.control !== 'remote') continue;
      if (!r.finished) r.retired = true;
      r.craft.vel.set(0, 0, 0);
      r.craft.speed = r.craft.forwardSpeed = 0;
      r.craft.throttle = 0;
    }
    if (game.phase === 'results') game.refreshResults();
    else {
      const what = /left/.test(reason) ? 'Your friend left' : 'Connection lost';
      for (const v of game.views) v.hud.say(`${what} · finishing alone`, 'warn', 4);
    }
  }

  /** Drop the link (leaving the lobby or the race). */
  close() {
    if (this.link) this.link.close();
    this.link = null;
    this.active = false;
    this._pendingStart = null;
    this._inbox.length = 0;
    this.buffers.clear();
    this.ghosts.clear();
  }

  // ------------------------------------------------------------ the shared clock

  /** Sea time at this instant (also between frames, and while the tab is hidden). */
  _sea() {
    const e = this.game.engine;
    return e.simTime + e.accumulator + e.sinceFrame();
  }

  /** A local stopwatch for timing round trips. Stepped by hand under ?manual, where only stepping passes time. */
  _stopwatch() {
    return this.game.engine.manual ? this._elapsed : performance.now() / 1000;
  }

  /** Real time that was not simulated: with a link up, the clock runs through it. */
  lostTime(seconds) {
    if (this.link) this.game.engine.simTime += seconds;
  }

  _ping() {
    if (this.link) this.link.send({ k: 'ping', t: this._stopwatch() }, true);
  }

  /** Guest: a pong came back. Move our sea clock onto the host's. */
  _onPong(msg) {
    const rtt = this._stopwatch() - msg.t;
    if (!(rtt >= 0) || !Number.isFinite(msg.sea)) return;
    // a slow round trip says little about the clock: only the quick ones count
    const rtts = this._rtts;
    rtts.push(rtt);
    if (rtts.length > 8) rtts.shift();
    if (rtt > Math.min(...rtts) + 0.015) return;
    // the reply left the host about half a round trip ago
    const offset = msg.sea + rtt / 2 - this._sea();
    this.clockError = offset;
    const racing = this.active && this.game.race.state !== 'grid';
    if (!racing || Math.abs(offset) > 0.25) {
      // free to jump while nothing depends on it yet (or when badly out)
      if (Math.abs(offset) > 0.002) this.game.engine.simTime += offset;
    } else {
      // mid-race the sea must not lurch under the rider: trim a little per ping
      this.game.engine.simTime += clamp(offset * 0.5, -0.012, 0.012);
    }
    this._synced = true;
    if (this._pendingStart) {
      const start = this._pendingStart;
      this._pendingStart = null;
      this._onMessage(start);
    }
  }

  // ------------------------------------------------------------ messages

  /** Everything the link delivers comes through here. */
  _receive(msg) {
    const sim = this.conditions;
    if (!sim) {
      this._onMessage(msg);
      return;
    }
    // dev: a slow, uneven, lossy connection
    const rand = () => {
      // small repeatable generator (mulberry32), so a test run can be repeated
      let t = (this._seed = (this._seed + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const unreliable = msg.k === 's';
    if (unreliable && rand() < sim.loss) return;
    let due = this._stopwatch() + sim.lag + rand() * sim.jitter;
    if (!unreliable) due = this._reliableDue = Math.max(due, this._reliableDue || 0); // these keep their order
    this._inbox.push({ due, order: this._inboxOrder++, msg });
  }

  /** Every physics step, whatever the game is doing. */
  pump(dt) {
    this._elapsed += dt;
    if (this._inbox.length) {
      const now = this._stopwatch();
      const due = this._inbox.filter((m) => m.due <= now).sort((a, b) => a.due - b.due || a.order - b.order);
      if (due.length) {
        this._inbox = this._inbox.filter((m) => m.due > now);
        for (const m of due) if (this.link) this._onMessage(m.msg);
      }
    }
    if (!this.link || !this.link.open || this.isHost) return;
    // the guest keeps checking its clock: often before the race, steadily during it
    this._pingAcc += dt;
    if (this._pingAcc >= (this.active ? 1 : 0.35)) {
      this._pingAcc = 0;
      this._ping();
    }
  }

  _onMessage(msg) {
    const { game } = this;
    switch (msg.k) {
      case 'hello':
        if (msg.v !== PROTOCOL) {
          this.close();
          if (game.phase === 'lobby') {
            game.hud.lobbyStep('choose');
            game.hud.lobbyError('You and your friend are on different versions of the game. Both reload the page and try again.');
          }
        }
        break;
      case 'ping':
        this.link.send({ k: 'pong', t: msg.t, sea: this._sea() }, true);
        break;
      case 'pong':
        if (!this.isHost) this._onPong(msg);
        break;
      case 'start':
        if (this.isHost || !Number.isFinite(msg.at)) break;
        if (!this._synced) {
          // the start time means nothing until we have the host's clock
          this._pendingStart = msg;
          this._ping();
          break;
        }
        this.raceId = msg.r;
        this._begin(msg.at);
        break;
      case 's':
        if (msg.r === this.raceId && this.active) this._store(msg);
        break;
      case 'bye':
        if (this.link) this.link._gone('The other player left.');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ race flow

  /** Host: start (or restart) the race on both machines at the same sea time. */
  hostStart() {
    if (!this.link || !this.isHost) return;
    this.raceId++;
    const at = round(this._sea() + START_LEAD, 1000);
    this.link.send({ k: 'start', r: this.raceId, at }, true);
    this._begin(at, true);
  }

  _begin(at, fromGesture = false) {
    const { game } = this;
    this.buffers.clear();
    this.ghosts.clear();
    this.active = true;
    this._sendAcc = 0;
    if (game.mode !== 'online' || game.phase === 'lobby' || game.phase === 'title') {
      game.setupRace('online', { isHost: this.isHost });
      game.start(fromGesture, at);
    } else {
      game.restart(at);
    }
  }

  /** After each physics step: tell the other machine about the crafts we simulate. */
  afterStep(dt, time) {
    if (!this.active || !this.link) return;
    this._sendAcc += dt;
    if (this._sendAcc < 1 / SEND_HZ) return;
    this._sendAcc = 0;
    const list = [];
    for (const r of this.game.race.racers) {
      if (r.control === 'remote') continue;
      const c = r.craft;
      list.push([
        r.index,
        round(c.pos.x),
        round(c.pos.y - c.waterY), // height over the water: the receiver puts it on its own sea
        round(c.pos.z),
        round(c.yaw, 1000),
        round(c.pitch, 1000),
        round(c.roll, 1000),
        round(c.vel.x),
        round(c.vel.z),
        round(c.steer),
        round(c.throttle),
        (c.airborne ? 1 : 0) | (r.finished ? 2 : 0) | (r.retired ? 4 : 0),
        c.power,
        round(r.totalS),
        r.lap,
        r.misses,
        r.nextGate,
        r.finished ? round(r.finishTime, 1000) : 0,
        round(c.yawRate),
      ]);
    }
    this.link.send({ k: 's', r: this.raceId, t: round(time, 1000), c: list });
  }

  _store(msg) {
    if (!Number.isFinite(msg.t) || !Array.isArray(msg.c)) return;
    for (const d of msg.c) {
      // nothing but numbers may reach the scene
      if (!Array.isArray(d) || d.length < 19 || !d.every(Number.isFinite)) continue;
      let buf = this.buffers.get(d[0]);
      if (!buf) this.buffers.set(d[0], (buf = []));
      if (buf.length && msg.t <= buf[buf.length - 1].t) continue; // late or duplicate
      buf.push({ t: msg.t, d });
      if (buf.length > 24) buf.shift();
    }
  }

  /**
   * Before each physics step: place the remote crafts.
   *
   * Where a craft is on the course is *predicted*: its newest reported position
   * coasted forward to now on its reported speed and turn rate, so in a close
   * fight it is drawn beside you when it is beside you (replaying the past
   * would draw it a few metres back). Each new report corrects the prediction;
   * the correction is blended in over a few frames instead of snapping.
   * How it sits on the water (height, pitch, roll) is replayed a moment late,
   * between the last two reports, which is smoother and where lag is harmless.
   */
  applyRemote(time, dt = 1 / 120) {
    if (!this.active) return;
    const at = time - REPLAY_DELAY;
    const blend = Math.exp(-dt * 12);
    for (const r of this.game.race.racers) {
      if (r.control !== 'remote') continue;
      const buf = this.buffers.get(r.index);
      if (!buf || !buf.length) continue;
      const N = buf[buf.length - 1];
      const P = buf[Math.max(0, buf.length - 2)];
      const c = r.craft;
      c.prevPos.copy(c.pos);
      c.prevQuat.copy(c.quat);

      // ---- course position: predicted to now, corrections eased in
      let ghost = this.ghosts.get(r.index);
      if (!ghost) this.ghosts.set(r.index, (ghost = { n: null, ox: 0, oz: 0, oyaw: 0 }));
      const sinceReport = time - N.t;
      // nothing new for a while (their tab is hidden, or the link is dying): stop coasting
      const silent = sinceReport > MAX_EXTRAPOLATE + 0.25;
      const age = clamp(sinceReport, 0, MAX_EXTRAPOLATE);
      let x = N.d[1] + N.d[7] * age;
      let z = N.d[3] + N.d[8] * age;
      let yaw = N.d[4] + N.d[18] * age;
      if (ghost.n && ghost.n !== N) {
        // where the previous report would have put it now: keep the picture continuous
        const o = ghost.n;
        const oAge = clamp(time - o.t, 0, MAX_EXTRAPOLATE);
        ghost.ox += o.d[1] + o.d[7] * oAge - x;
        ghost.oz += o.d[3] + o.d[8] * oAge - z;
        ghost.oyaw += angleDiff(yaw, o.d[4] + o.d[18] * oAge);
        if (Math.hypot(ghost.ox, ghost.oz) > 12) {
          // put back on course over there, or a long silence: just jump
          ghost.ox = ghost.oz = ghost.oyaw = 0;
          this.game.wake.trails[r.index].reset();
        }
      }
      ghost.n = N;
      ghost.ox *= blend;
      ghost.oz *= blend;
      ghost.oyaw *= blend;
      x += ghost.ox;
      z += ghost.oz;
      yaw += ghost.oyaw;

      // ---- how it sits on the water: replayed between the last two reports
      const span = N.t - P.t;
      const k = span > 1e-6 ? clamp((at - P.t) / span, 0, 1) : 1;
      const lerp = (j) => P.d[j] + (N.d[j] - P.d[j]) * k;

      sampleSurface(x - Math.sin(yaw) * 1.05, z - Math.cos(yaw) * 1.05, time, sStern);
      c.undisplacedX = sStern.px;
      c.undisplacedZ = sStern.pz;
      sampleSurface(x, z, time, sStern);
      c.waterY = sStern.y;
      const prevY = c.pos.y;
      c.pos.set(x, sStern.y + lerp(2), z);
      c.yaw = yaw;
      c.pitch = lerp(5);
      c.roll = lerp(6);
      if (silent) c.vel.set(0, 0, 0);
      else c.vel.set(N.d[7], (c.pos.y - prevY) / dt, N.d[8]);
      c.speed = Math.hypot(c.vel.x, c.vel.z);
      c.forwardSpeed = c.speed;
      c.steer = lerp(9);
      c.throttle = silent ? 0 : lerp(10);
      c.yawRate = silent ? 0 : N.d[18];
      c.airborne = (N.d[11] & 1) !== 0;
      c.grip = c.airborne ? 0 : 1;
      c.power = N.d[12];
      c._syncQuat();

      // race progress: the newest report, nudged forward to now for a fair ranking
      const done = (N.d[11] & 2) !== 0;
      r.totalS = N.d[13] + (done ? 0 : Math.hypot(N.d[7], N.d[8]) * age);
      r.lap = N.d[14];
      r.misses = N.d[15];
      r.nextGate = N.d[16];
      r.retired = (N.d[11] & 4) !== 0;
      if (done && !r.finished) {
        r.finished = true;
        r.finishTime = N.d[17];
      }
    }
  }
}
