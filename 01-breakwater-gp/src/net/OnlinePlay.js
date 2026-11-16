// Online races for up to four players over PeerLinks.
//
// One player hosts. Every friend swaps an invite and a reply with the host, so
// the links form a star: a guest talks to the host only, and the host passes
// each guest's position on to the others.
//
// Who simulates what:
//   - each machine rides its own craft with its own physics and rules
//   - the host also runs the bots that fill the empty seats
//   - everything else is a "remote" craft: its pose and race progress arrive in
//     small state messages 20 times a second; its position is predicted forward
//     to now, its attitude replayed a moment late (see applyRemote)
//
// One clock. Every machine keeps the same "sea time": a guest sets its clock
// to the host's (ping / pong, taking the quickest of the recent round trips)
// and keeps trimming it during the race. The waves, the start lights, the race
// clock and the timestamps on the state messages all read that clock. While a
// link is up the clock is tied to real time: a machine that drops frames or
// has its tab hidden loses ground on the water, not time on the clock.

import { PeerLink, rtcSupported } from './PeerLink.js';
import { makeSurfaceSample, sampleSurface } from '../engine/waves.js';
import { angleDiff, clamp } from '../engine/math.js';
import { HULL } from '../game/config.js';

const PROTOCOL = 3;
const SEATS = 4;
const SEND_HZ = 20;
const REPLAY_DELAY = 0.08; // attitude is replayed this far behind now, between the last two reports
const MAX_EXTRAPOLATE = 0.3; // seconds a craft is coasted past its newest report
const START_LEAD = 0.9; // the host announces the countdown this far ahead, so the message is there in time
const sStern = makeSurfaceSample();

const round = (v, p = 100) => Math.round(v * p) / p;
/** Names travel between machines and end up on screen: letters, digits and a little punctuation only. */
const cleanName = (text) =>
  String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 10);

export class OnlinePlay {
  /** @param {import('../game/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.isHost = false;
    /** Which craft is ours (the host has seat 0). */
    this.seat = 0;
    /** Guest: the link to the host. */
    this.link = null;
    /** Host: one per friend who is in: { link, seat, name, rtt, hello, state, sent }. */
    this.peers = [];
    /** Host: the friend whose invite is on show and who has not connected yet. */
    this.offer = null;
    /** The four seats as last agreed: { kind: 'host' | 'guest' | 'bot' | 'open', name }. */
    this.roster = [];
    /** Guest: round trips of the other guests to the host, ms (for the name tags). */
    this.pings = [];
    /** Seats whose driver left mid-race. */
    this.gone = new Set();
    /** true while a race is being played over an open link */
    this.active = false;
    this.broken = false;
    this.raceId = 0;
    this.rtt = 0; // guest: our round trip to the host, seconds
    this.name = '';
    try {
      this.name = cleanName(localStorage.getItem('bw-name'));
    } catch {
      /* storage unavailable */
    }
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
    /** per racer index: states received from the other machines, oldest first */
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

  /** Is anyone on the other end? */
  get connected() {
    return this.isHost ? this.peers.some((p) => p.link.open) : !!this.link && this.link.open;
  }

  // ------------------------------------------------------------ lobby

  _wireLobby() {
    const { hud } = this.game;
    const l = hud.l;
    hud.onlineBtn.addEventListener('click', () => this.openLobby());
    hud.lobbyBtn.addEventListener('click', () => this.backToLobby());
    l.back.addEventListener('click', () => this.game.toMenu());
    l.hostBtn.addEventListener('click', () => this._host());
    l.joinBtn.addEventListener('click', () => hud.lobbyStep('join'));
    l.makeReply.addEventListener('click', () => this._join(l.inviteIn.value));
    l.connect.addEventListener('click', () => this._connect(l.replyIn.value));
    l.start.addEventListener('click', () => this.hostStart());
    l.name.value = this.name;
    l.name.addEventListener('change', () => this._setName(l.name.value));
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

  _setName(text) {
    this.name = cleanName(text);
    this.game.hud.l.name.value = this.name;
    try {
      localStorage.setItem('bw-name', this.name);
    } catch {
      /* ignore */
    }
    if (this.isHost) {
      if (this.peers.length || this.offer) this._rosterChanged();
    } else if (this.link) this.link.send({ k: 'name', name: this.name }, true);
  }

  _resetLink(isHost) {
    this.close();
    this.isHost = isHost;
    this.seat = 0;
    this.broken = false;
    this._synced = false;
    this._pendingStart = null;
    this._rtts.length = 0;
    this._inbox.length = 0;
    this._inboxOrder = 0;
    this.rtt = 0;
    this.pings = [];
  }

  // ---- host

  async _host() {
    this._resetLink(true);
    this.game.hud.lobbyStep('host');
    this._rosterChanged();
    await this._offerInvite();
  }

  _freeSeat() {
    for (let s = 1; s < SEATS; s++) if (!this.peers.some((p) => p.seat === s)) return s;
    return -1;
  }

  /** Put a fresh invite on show for the next free seat (if there is one). */
  async _offerInvite() {
    const { game } = this;
    const l = game.hud.l;
    if (!this.isHost || game.phase !== 'lobby') return;
    const full = this._freeSeat() === -1;
    l.inviteBox.hidden = full;
    l.full.hidden = !full;
    if (full || this.offer) return;
    l.invite.value = 'Preparing an invite…';
    l.replyIn.value = '';
    l.connect.textContent = 'Connect';
    l.copyInvite.disabled = l.shareInvite.disabled = l.connect.disabled = true;
    const peer = { link: null, seat: -1, name: '', rtt: null, hello: false, state: null, sent: {} };
    peer.link = new PeerLink({
      onOpen: () => this._guestOpen(peer),
      onClose: (reason) => this._guestGone(peer, reason),
      onMessage: (msg) => this._receive(msg, peer),
    });
    this.offer = peer;
    try {
      const code = await peer.link.createInvite();
      if (this.offer !== peer) return; // the lobby moved on meanwhile
      l.invite.value = `${location.origin}${location.pathname}#join=${code}`;
      l.copyInvite.disabled = l.shareInvite.disabled = l.connect.disabled = false;
    } catch (err) {
      if (this.offer === peer) this.offer = null;
      game.hud.lobbyError(`Could not prepare an invite: ${err.message}`);
    }
  }

  async _connect(reply) {
    const { hud } = this.game;
    const peer = this.offer;
    if (!peer) return;
    hud.lobbyError('');
    hud.l.connect.disabled = true;
    try {
      await peer.link.acceptReply(reply);
      hud.l.connect.textContent = 'Connecting…';
    } catch (err) {
      hud.lobbyError(err.message);
      hud.l.connect.disabled = false;
    }
  }

  _guestOpen(peer) {
    if (this.offer === peer) this.offer = null;
    peer.seat = this._freeSeat();
    if (peer.seat === -1) {
      peer.link.close(); // no seat left (cannot happen: no invite is offered when full)
      return;
    }
    peer.name = `P${peer.seat + 1}`;
    this.peers.push(peer);
    // their hello (with their name) is on its way; the roster goes out when it lands
    this._rosterChanged();
    this._offerInvite();
  }

  _guestGone(peer, reason) {
    const { game } = this;
    if (this.offer === peer) {
      // the invite on show came to nothing
      this.offer = null;
      if (game.phase === 'lobby' && this.isHost && reason !== 'closed') {
        game.hud.lobbyError(reason);
        this._offerInvite();
      }
      return;
    }
    const i = this.peers.indexOf(peer);
    if (i === -1) return;
    this.peers.splice(i, 1);
    if (reason === 'closed') return; // we hung up ourselves
    if (game.phase === 'lobby') {
      this._rosterChanged();
      this._offerInvite();
      return;
    }
    if (!this.active) return;
    // mid-race: their driver drops out, and the others are told
    this._dropRacer(peer.seat, peer.name);
    this._broadcast({ k: 'left', seat: peer.seat }, true);
    if (!this.peers.length) this.broken = true;
    if (game.phase === 'results') game.refreshResults();
  }

  // ---- guest

  async _join(invite) {
    const { hud } = this.game;
    hud.lobbyStep('join');
    hud.l.inviteIn.value = invite;
    hud.l.makeReply.disabled = true;
    try {
      this._resetLink(false);
      this.link = new PeerLink({
        onOpen: () => this._hostOpen(),
        onClose: (reason) => this._hostGone(reason),
        onMessage: (msg) => this._receive(msg, null),
      });
      const reply = await this.link.acceptInvite(invite);
      hud.l.reply.value = reply;
      hud.l.join2.hidden = false;
    } catch (err) {
      hud.lobbyError(err.message);
    }
    hud.l.makeReply.disabled = false;
  }

  _hostOpen() {
    this.link.send({ k: 'hello', v: PROTOCOL, name: this.name }, true);
    this._ping();
    if (this.game.phase === 'lobby') this.game.hud.lobbyStep('ready', { status: 'Connected to the host' });
  }

  _hostGone(reason) {
    const { game } = this;
    this.link = null;
    if (game.phase === 'lobby') {
      if (reason !== 'closed') {
        // the invite and the reply died with the link: back to the first step for fresh ones
        game.hud.lobbyStep('choose');
        game.hud.lobbyError(reason);
      }
      return;
    }
    if (!this.active) return;
    // mid-race: carry on alone; everyone who was racing elsewhere drops out
    this.active = false;
    this.broken = true;
    for (const r of game.race.racers) if (r.control === 'remote') this._dropRacer(r.index, '');
    if (game.phase === 'results') game.refreshResults();
    else {
      const what = /left/.test(reason) ? 'The host left' : 'Connection lost';
      for (const v of game.views) v.hud.say(`${what} · finishing alone`, 'warn', 4);
    }
  }

  // ---- both

  /** A driver on another machine is gone: stop their craft where it is. */
  _dropRacer(seat, name) {
    const { game } = this;
    const r = game.race.racers[seat];
    if (!r || r.control !== 'remote') return;
    this.gone.add(seat);
    if (!r.finished) r.retired = true;
    r.craft.vel.set(0, 0, 0);
    r.craft.speed = r.craft.forwardSpeed = 0;
    r.craft.throttle = 0;
    if (name && game.phase === 'race') for (const v of game.views) v.hud.say(`${name} left the race`, 'warn', 3);
  }

  /** The seats as they stand. Before a race an empty seat is "open"; in a race a bot rides it. */
  _buildRoster(forRace) {
    const { crafts } = this.game;
    const seats = [];
    for (let s = 0; s < SEATS; s++) {
      const peer = this.peers.find((p) => p.seat === s);
      if (s === 0) seats.push({ kind: 'host', name: this.name || 'P1' });
      else if (peer) seats.push({ kind: 'guest', name: peer.name || `P${s + 1}` });
      else seats.push({ kind: forRace ? 'bot' : 'open', name: crafts[s].team.name });
    }
    return seats;
  }

  /** Host: somebody came, went or renamed themselves. Tell everyone and redraw. */
  _rosterChanged() {
    if (!this.isHost) return;
    this.roster = this._buildRoster(false);
    for (const p of this.peers) if (p.hello) p.link.send({ k: 'roster', seat: p.seat, roster: this.roster }, true);
    this._showRoster();
  }

  /** Draw the seat chips (and, for the host, say what Start will start). */
  _showRoster() {
    const { game } = this;
    const { hud } = game;
    if (game.phase !== 'lobby') return;
    const seats = this.roster.map((seat, s) => {
      let info = '';
      if (seat.kind === 'guest') {
        const ms = this._pingOf(s);
        if (ms !== null) info = `${ms} ms`;
      } else if (seat.kind === 'host') info = 'host';
      return { kind: seat.kind, name: seat.name, css: game.crafts[s].team.css, info };
    });
    hud.setRoster(seats, this.seat);
    if (this.isHost) {
      const friends = this.peers.filter((p) => p.hello).length;
      hud.l.start.disabled = friends === 0;
      const bots = SEATS - 1 - friends;
      hud.l.start.textContent = friends === 0 ? 'Start race' : `Start race · ${friends + 1} drivers${bots ? ` + ${bots} bot${bots > 1 ? 's' : ''}` : ''}`;
    }
  }

  /** Round trip between here and the driver in `seat`, ms (null if unknown). */
  _pingOf(seat) {
    if (this.isHost) {
      const p = this.peers.find((q) => q.seat === seat);
      return p && p.rtt !== null ? Math.round(p.rtt) : null;
    }
    if (seat === this.seat) return null;
    const mine = Math.round(this.rtt * 1000);
    if (seat === 0) return mine;
    return Number.isFinite(this.pings[seat]) ? mine + Math.round(this.pings[seat]) : null;
  }

  /** The line under a driver's name tag: how far away they are on the wire. */
  tagInfo(racer) {
    if (!racer.isRemote || this.gone.has(racer.index)) return '';
    const ms = this._pingOf(racer.index);
    return ms === null ? '' : `${ms} ms`;
  }

  _broadcast(msg, reliable = false) {
    for (const p of this.peers) p.link.send(msg, reliable);
  }

  /** Drop every link (leaving the lobby or the race). */
  close() {
    if (this.link) this.link.close();
    this.link = null;
    const peers = this.peers;
    this.peers = [];
    for (const p of peers) p.link.close();
    if (this.offer) {
      const offer = this.offer;
      this.offer = null;
      offer.link.close();
    }
    this.active = false;
    this.roster = [];
    this._pendingStart = null;
    this._inbox.length = 0;
    this.buffers.clear();
    this.ghosts.clear();
    this.gone.clear();
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
    if (this.link || this.peers.length || this.offer) this.game.engine.simTime += seconds;
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
    this.rtt = rtt;
    // the reply left the host about half a round trip ago
    const offset = msg.sea + rtt / 2 - this._sea();
    this.clockError = offset;
    const racing = this.active && this.game.race.state !== 'grid';
    if (!racing || Math.abs(offset) > 0.25) {
      // free to jump while nothing depends on it yet (or when badly out)
      if (Math.abs(offset) > 0.002) this.game.engine.simTime += offset;
    } else {
      // mid-race the sea must not lurch under the driver: trim a little per ping
      this.game.engine.simTime += clamp(offset * 0.5, -0.012, 0.012);
    }
    this._synced = true;
    // before the race the host shows everyone's ping in the lobby
    if (!this.active && this.link) this.link.send({ k: 'rtt', ms: Math.round(rtt * 1000) }, true);
    if (this._pendingStart) {
      const start = this._pendingStart;
      this._pendingStart = null;
      this._onMessage(start, null);
    }
  }

  // ------------------------------------------------------------ messages

  /** Everything a link delivers comes through here. `peer` is the sender on the host, null on a guest. */
  _receive(msg, peer) {
    const sim = this.conditions;
    if (!sim) {
      this._onMessage(msg, peer);
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
    this._inbox.push({ due, order: this._inboxOrder++, msg, peer });
  }

  /** Every physics step, whatever the game is doing. */
  pump(dt) {
    this._elapsed += dt;
    if (this._inbox.length) {
      const now = this._stopwatch();
      const due = this._inbox.filter((m) => m.due <= now).sort((a, b) => a.due - b.due || a.order - b.order);
      if (due.length) {
        this._inbox = this._inbox.filter((m) => m.due > now);
        for (const m of due) if (this.link || this.peers.includes(m.peer)) this._onMessage(m.msg, m.peer);
      }
    }
    if (this.isHost || !this.link || !this.link.open) return;
    // a guest keeps checking its clock: often before the race, steadily during it
    this._pingAcc += dt;
    if (this._pingAcc >= (this.active ? 1 : 0.35)) {
      this._pingAcc = 0;
      this._ping();
    }
  }

  _validRoster(list) {
    if (!Array.isArray(list) || list.length !== SEATS) return null;
    const kinds = ['host', 'guest', 'bot', 'open'];
    const out = [];
    for (let s = 0; s < SEATS; s++) {
      const seat = list[s];
      if (!seat || !kinds.includes(seat.kind)) return null;
      out.push({ kind: seat.kind, name: cleanName(seat.name) || `P${s + 1}` });
    }
    return out[0].kind === 'host' ? out : null;
  }

  _onMessage(msg, peer) {
    if (peer) this._fromGuest(msg, peer);
    else this._fromHost(msg);
  }

  /** Host: a message from one of the friends. */
  _fromGuest(msg, peer) {
    switch (msg.k) {
      case 'hello':
        if (msg.v !== PROTOCOL) {
          peer.link.send({ k: 'version' }, true);
          break;
        }
        peer.hello = true;
        peer.name = cleanName(msg.name) || `P${peer.seat + 1}`;
        peer.link.send({ k: 'welcome', v: PROTOCOL, seat: peer.seat }, true);
        this._rosterChanged();
        break;
      case 'name':
        peer.name = cleanName(msg.name) || `P${peer.seat + 1}`;
        this._rosterChanged();
        break;
      case 'ping':
        peer.link.send({ k: 'pong', t: msg.t, sea: this._sea() }, true);
        break;
      case 'rtt':
        if (Number.isFinite(msg.ms)) {
          peer.rtt = clamp(msg.ms, 0, 9999);
          this._showRoster();
        }
        break;
      case 's':
        if (msg.r === this.raceId && this.active) this._store(msg, peer);
        break;
      case 'bye':
        peer.link._gone('The other player left.');
        break;
      default:
        break;
    }
  }

  /** Guest: a message from the host. */
  _fromHost(msg) {
    const { game } = this;
    switch (msg.k) {
      case 'version':
        this.close();
        if (game.phase === 'lobby') {
          game.hud.lobbyStep('choose');
          game.hud.lobbyError('You and the host are on different versions of the game. Both reload the page and try again.');
        }
        break;
      case 'welcome':
        if (Number.isInteger(msg.seat) && msg.seat > 0 && msg.seat < SEATS) this.seat = msg.seat;
        break;
      case 'roster': {
        const roster = this._validRoster(msg.roster);
        if (!roster) break;
        if (Number.isInteger(msg.seat) && msg.seat > 0 && msg.seat < SEATS) this.seat = msg.seat;
        this.roster = roster;
        this._showRoster();
        break;
      }
      case 'pong':
        this._onPong(msg);
        break;
      case 'start': {
        const roster = this._validRoster(msg.roster);
        if (!roster || !Number.isFinite(msg.at)) break;
        if (!this._synced) {
          // the start time means nothing until we have the host's clock
          this._pendingStart = msg;
          this._ping();
          break;
        }
        this.raceId = msg.r;
        this.roster = roster;
        this._begin(msg.at);
        break;
      }
      case 's':
        if (msg.r === this.raceId && this.active) this._store(msg, null);
        break;
      case 'left':
        if (this.active && Number.isInteger(msg.seat) && msg.seat !== this.seat) {
          const r = game.race.racers[msg.seat];
          this._dropRacer(msg.seat, r ? r.name : '');
          if (game.phase === 'results') game.refreshResults();
        }
        break;
      case 'lobby':
        this.active = false;
        this.buffers.clear();
        this.ghosts.clear();
        this.gone.clear();
        game.toLobby();
        game.hud.lobbyStep('ready', { status: 'Connected to the host' });
        this._showRoster();
        break;
      case 'bye':
        if (this.link) this.link._gone('The other player left.');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ race flow

  /** Host: start (or restart) the race on every machine at the same sea time. */
  hostStart() {
    if (!this.isHost || !this.peers.some((p) => p.hello && p.link.open)) return;
    this.raceId++;
    this.roster = this._buildRoster(true);
    const at = round(this._sea() + START_LEAD, 1000);
    this._broadcast({ k: 'start', r: this.raceId, at, roster: this.roster }, true);
    this._begin(at, true);
  }

  /** Host: from the results back to the lobby, links kept, to invite more players. */
  backToLobby() {
    const { game } = this;
    if (!this.isHost || !this.connected) return;
    this.active = false;
    this.buffers.clear();
    this.ghosts.clear();
    this.gone.clear();
    this._broadcast({ k: 'lobby' }, true);
    game.toLobby();
    game.hud.lobbyStep('host');
    this._rosterChanged();
    this._offerInvite();
  }

  _begin(at, fromGesture = false) {
    const { game } = this;
    this.buffers.clear();
    this.ghosts.clear();
    this.gone.clear();
    for (const p of this.peers) {
      p.state = null;
      p.sent = {};
    }
    this.active = true;
    this.broken = false;
    this._sendAcc = 0;
    // the drivers can differ from race to race (somebody left, somebody joined): build it afresh
    game.setupRace('online', { seat: this.seat, roster: this.roster, isHost: this.isHost });
    game.startOnline(fromGesture, at);
  }

  _pack(r) {
    const c = r.craft;
    return [
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
    ];
  }

  /**
   * After each physics step: tell the others about the crafts we simulate.
   * A message is a list of groups [time, [craft, …]]. A guest sends one group
   * (its own craft). The host sends its own group (its craft and the bots) and
   * passes on, each with its original time, what the other guests last said.
   */
  afterStep(dt, time) {
    if (!this.active) return;
    this._sendAcc += dt;
    if (this._sendAcc < 1 / SEND_HZ) return;
    this._sendAcc = 0;
    const mine = [];
    for (const r of this.game.race.racers) if (r.control !== 'remote') mine.push(this._pack(r));
    const t = round(time, 1000);
    if (!this.isHost) {
      if (this.link) this.link.send({ k: 's', r: this.raceId, g: [[t, mine]], p: Math.round(this.rtt * 1000) });
      return;
    }
    const pings = [];
    for (let s = 0; s < SEATS; s++) pings.push(this._pingOf(s) || 0);
    for (const p of this.peers) {
      if (!p.link.open) continue;
      const groups = [[t, mine]];
      for (const q of this.peers) {
        if (q === p || !q.state || q.state.t <= (p.sent[q.seat] ?? -1)) continue;
        groups.push([q.state.t, [q.state.d]]);
        p.sent[q.seat] = q.state.t;
      }
      p.link.send({ k: 's', r: this.raceId, g: groups, p: pings });
    }
  }

  _store(msg, peer) {
    if (!Array.isArray(msg.g)) return;
    for (const group of msg.g) {
      if (!Array.isArray(group) || !Number.isFinite(group[0]) || !Array.isArray(group[1])) continue;
      const t = group[0];
      for (const d of group[1]) {
        // nothing but numbers may reach the scene
        if (!Array.isArray(d) || d.length < 19 || !d.every(Number.isFinite)) continue;
        const seat = d[0];
        // a guest speaks for its own craft and nobody else's; nobody speaks for ours
        if (peer ? seat !== peer.seat : seat === this.seat) continue;
        let buf = this.buffers.get(seat);
        if (!buf) this.buffers.set(seat, (buf = []));
        if (buf.length && t <= buf[buf.length - 1].t) continue; // late or duplicate
        buf.push({ t, d });
        if (buf.length > 24) buf.shift();
        if (peer) peer.state = { t, d };
      }
    }
    if (peer) {
      if (Number.isFinite(msg.p)) peer.rtt = clamp(msg.p, 0, 9999);
    } else if (Array.isArray(msg.p)) this.pings = msg.p.map((v) => (Number.isFinite(v) ? v : 0));
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
      if (r.control !== 'remote' || this.gone.has(r.index)) continue;
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

      sampleSurface(x - Math.sin(yaw) * HULL.stern, z - Math.cos(yaw) * HULL.stern, time, sStern);
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
      // how far its bows point away from where it is going (for the spray a slide throws up)
      const ahead = c.vel.x * Math.sin(yaw) + c.vel.z * Math.cos(yaw);
      const aside = c.vel.x * Math.cos(yaw) - c.vel.z * Math.sin(yaw);
      c.slip = c.speed > 3 ? Math.atan2(aside, Math.max(Math.abs(ahead), 3)) : 0;
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
