// DOM heads-up display. Text is real text (crisp at any pixel ratio), values
// are only written when they change, and the layout adapts with CSS.
//
//   Hud      — everything shared: canvas host, touch layer and pads, the title,
//              results and online-lobby panels.
//   ViewHud  — one player's readouts, laid over that player's viewport
//              (there are two of them in split screen).

import * as THREE from 'three';
import css from './hud.css?inline';
import { formatTime, ordinal } from '../engine/math.js';
import { HULL, KMH, RULES } from './config.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const _tagPos = new THREE.Vector3();

/** Only touch the DOM when the value really changed. */
function setText(node, value) {
  if (node.__v !== value) {
    node.__v = value;
    node.textContent = value;
  }
}

export class ViewHud {
  /** @param {HTMLElement} parent */
  constructor(parent) {
    const root = el('div', 'bw-view');
    this.root = root;

    const top = el('div', 'bw-top');
    const pos = el('div', 'bw-pos');
    this.posN = el('span', 'bw-pos-n', '1');
    this.posSfx = el('span', 'bw-pos-sfx', 'st');
    pos.append(this.posN, this.posSfx, el('span', 'bw-pos-of', `/ ${RULES.racers}`));

    const clock = el('div', 'bw-clock');
    const lap = el('div', 'bw-lap', 'Lap ');
    this.lapN = el('b', '', '1');
    lap.append(this.lapN, document.createTextNode(` / ${RULES.laps}`));
    this.time = el('div', 'bw-time', '0:00.000');
    this.next = el('div', 'bw-next right');
    this.nextTxt = el('span', 'bw-next-txt', 'pass right');
    this.nextArrow = el('span', 'bw-next-arrow', '▶');
    this.next.append(this.nextArrow, el('span', 'bw-mark'), this.nextTxt);
    clock.append(lap, this.time, this.next);

    const speed = el('div', 'bw-speed');
    this.speedN = el('span', 'bw-speed-n', '0');
    speed.append(this.speedN, el('span', 'bw-speed-u', 'km/h'));
    const meters = el('div', 'bw-meters');
    this.powerMeter = el('div', 'bw-meter');
    const pips = el('div', 'bw-pips');
    this.pips = Array.from({ length: RULES.maxPower }, () => pips.appendChild(el('i', 'bw-pip')));
    this.powerMeter.append(el('span', 'bw-meter-label', 'Power'), pips);
    const missMeter = el('div', 'bw-meter');
    const misses = el('div', 'bw-pips');
    this.missDots = Array.from({ length: RULES.maxMisses }, () => misses.appendChild(el('i', 'bw-miss')));
    missMeter.append(el('span', 'bw-meter-label', 'Miss'), misses);
    meters.append(this.powerMeter, missMeter);
    speed.append(meters);
    top.append(pos, clock, speed);

    this.standings = el('ol', 'bw-standings');
    this.rows = [];
    this.map = el('canvas', 'bw-map');
    this.mapCtx = this.map.getContext('2d');
    this.banner = el('div', 'bw-banner');
    this.toast = el('div', 'bw-toast');
    /** Name tags that float over the other drivers (multiplayer). */
    this.tagHost = el('div', 'bw-tags');
    this.tags = [];
    root.append(this.tagHost, top, this.standings, this.map, this.banner, this.toast);
    parent.append(root);

    this._toastTimer = 0;
    this._mapStatic = null;
    this._mapSize = 0;
  }

  /** Place this HUD over its viewport (fractions of the game area, from the top-left). */
  setRect(left, top, width, height) {
    const s = this.root.style;
    s.left = `${left * 100}%`;
    s.top = `${top * 100}%`;
    s.width = `${width * 100}%`;
    s.height = `${height * 100}%`;
    this._mapStatic = null;
  }

  dispose() {
    this.root.remove();
  }

  flash(text, cls = '') {
    const b = this.banner;
    b.className = `bw-banner ${cls}`;
    b.textContent = text;
    void b.offsetWidth; // restart the animation
    b.classList.add('show');
  }

  /** A line of status text near the bottom. Pass 0 seconds to keep it up. */
  say(text, cls = '', seconds = 1.6) {
    this.toast.textContent = text;
    this.toast.className = `bw-toast show ${cls}`;
    this._toastTimer = seconds > 0 ? seconds : Infinity;
  }

  hush() {
    this.toast.classList.remove('show');
    this._toastTimer = 0;
  }

  /** @param {object[]} racers all racers  @param {object} me the racer this view follows */
  setStandings(racers, me) {
    this.standings.textContent = '';
    this.rows = racers.map((r) => {
      const li = el('li', r === me ? 'me' : '');
      const n = el('span', 'n', String(r.rank));
      const chip = el('i', 'chip');
      chip.style.background = r.team.css;
      li.append(n, chip, el('span', '', r.name));
      this.standings.append(li);
      return { li, n, racer: r, shown: -1 };
    });
    this._power = this._misses = this._gate = undefined;
  }

  /**
   * Which drivers get a name tag in this view (none in solo play).
   * @param {object[]} racers the drivers to tag
   */
  setTags(racers) {
    this.tagHost.textContent = '';
    this.tags = racers.map((r) => {
      const node = el('div', `bw-tag${r.isPlayer || r.isRemote ? ' human' : ''}`);
      const chip = el('i', 'chip');
      chip.style.background = r.team.css;
      const place = el('span', 'place', '');
      const info = el('small', '', '');
      node.append(chip, el('b', '', r.name), place, info);
      node.hidden = true;
      this.tagHost.append(node);
      return { node, place, info, racer: r, shown: false, x: 0, y: 0, dist: 0 };
    });
  }

  /**
   * Keep the tags over their drivers.
   * @param {THREE.Camera} camera this view's camera
   * @param {number} w  @param {number} h size of this view in CSS pixels
   * @param {(racer: object) => string} infoOf extra line per driver (connection quality online)
   */
  updateTags(camera, w, h, infoOf) {
    const placed = this._placed || (this._placed = []);
    placed.length = 0;
    for (const tag of this.tags) {
      const p = tag.racer.craft.object.position;
      _tagPos.set(p.x, p.y + HULL.top + 0.9, p.z);
      const dist = _tagPos.distanceTo(camera.position);
      _tagPos.project(camera);
      const visible = _tagPos.z < 1 && dist < 170 && Math.abs(_tagPos.x) < 1.02 && _tagPos.y > -1 && _tagPos.y < 0.98;
      if (visible !== tag.shown) {
        tag.shown = visible;
        tag.node.hidden = !visible;
      }
      if (!visible) continue;
      tag.x = (_tagPos.x * 0.5 + 0.5) * w;
      tag.y = (-_tagPos.y * 0.5 + 0.5) * h;
      tag.dist = dist;
      placed.push(tag);
    }
    // drivers bunched together: the nearer one keeps its place, tags behind it step up out of the way
    placed.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < placed.length; i++) {
      const tag = placed[i];
      const scale = Math.max(0.62, Math.min(1, 16 / tag.dist + 0.55));
      for (let k = 0; k < i; k++) {
        const other = placed[k];
        if (Math.abs(tag.x - other.x) < 118 * scale && Math.abs(tag.y - other.y) < 22) tag.y = other.y - 24;
      }
      tag.node.style.transform = `translate(${tag.x.toFixed(1)}px, ${tag.y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      tag.node.style.opacity = tag.dist > 120 ? ((170 - tag.dist) / 50).toFixed(2) : '1';
      setText(tag.place, `${tag.racer.rank}${ordinal(tag.racer.rank)}`);
      setText(tag.info, infoOf ? infoOf(tag.racer) : '');
    }
  }

  /** Per-frame refresh. Cheap: every write is guarded. */
  update(dt, race, racer) {
    if (this._toastTimer > 0 && this._toastTimer !== Infinity) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast.classList.remove('show');
    }
    const craft = racer.craft;
    setText(this.posN, String(racer.rank));
    setText(this.posSfx, ordinal(racer.rank));
    setText(this.lapN, String(Math.min(racer.lap, race.laps)));
    setText(this.time, formatTime(race.state === 'racing' || race.state === 'finished' ? (racer.finished ? racer.finishTime : race.time) : 0));
    setText(this.speedN, String(Math.round(craft.speed * KMH)));

    const power = Math.round(craft.power);
    if (this._power !== power) {
      this._power = power;
      this.pips.forEach((pip, i) => pip.classList.toggle('on', i < power));
      this.powerMeter.classList.toggle('full', power >= RULES.maxPower);
    }
    if (this._misses !== racer.misses) {
      this._misses = racer.misses;
      this.missDots.forEach((d, i) => d.classList.toggle('on', i < racer.misses));
    }
    const gate = race.track.gates[racer.nextGate];
    if (this._gate !== gate.index) {
      this._gate = gate.index;
      this.next.className = `bw-next ${gate.pass}`;
      this.nextTxt.textContent = gate.pass === 'right' ? 'pass right' : 'pass left';
      this.nextArrow.textContent = gate.pass === 'right' ? '▶' : '◀';
    }
    for (const row of this.rows) {
      const rank = row.racer.rank;
      if (row.shown !== rank) {
        row.shown = rank;
        row.n.textContent = String(rank);
        row.li.style.order = String(rank);
      }
    }
  }

  // ------------------------------------------------------------ minimap

  _prepareMap(track) {
    const cssSize = this.map.clientWidth || 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(cssSize * dpr);
    if (size === this._mapSize && this._mapStatic) return;
    this._mapSize = size;
    this.map.width = this.map.height = size;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.samples; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const pad = size * 0.1;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    this._toMap = (x, z) => [size / 2 + (x - cx) * scale, size / 2 + (z - cz) * scale];

    const off = document.createElement('canvas');
    off.width = off.height = size;
    const c = off.getContext('2d');
    c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i <= track.samples; i += 4) {
      const [x, y] = this._toMap(track.px[i % track.samples], track.pz[i % track.samples]);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.strokeStyle = 'rgba(9,30,44,0.62)';
    c.lineWidth = size * 0.105;
    c.stroke();
    c.strokeStyle = 'rgba(255,248,234,0.9)';
    c.lineWidth = size * 0.022;
    c.stroke();
    // the islands, under the course
    c.globalCompositeOperation = 'destination-over';
    for (const land of track.land || []) {
      c.fillStyle = land.town ? 'rgba(150,170,186,0.85)' : 'rgba(127,176,76,0.85)';
      c.beginPath();
      land.outline.forEach(([x, z], i) => {
        const [mx, my] = this._toMap(x, z);
        if (i) c.lineTo(mx, my);
        else c.moveTo(mx, my);
      });
      c.closePath();
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    // start line
    const a = track.pointAt(0, -track.halfWidth * 0.8);
    const [ax, ay] = this._toMap(a.x, a.z);
    const b = track.pointAt(0, track.halfWidth * 0.8);
    const [bx, by] = this._toMap(b.x, b.z);
    c.strokeStyle = '#fff8ea';
    c.lineWidth = size * 0.03;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
    this._mapStatic = off;
  }

  drawMap(race, me) {
    const track = race.track;
    this._prepareMap(track);
    const size = this._mapSize;
    const c = this.mapCtx;
    c.clearRect(0, 0, size, size);
    c.drawImage(this._mapStatic, 0, 0);
    // marks
    const next = me.nextGate;
    for (const g of track.gates) {
      const [x, y] = this._toMap(g.x, g.z);
      c.fillStyle = g.pass === 'right' ? '#e8343f' : '#17b26a';
      c.beginPath();
      c.arc(x, y, size * (g.index === next ? 0.04 : 0.024), 0, Math.PI * 2);
      c.fill();
      if (g.index === next) {
        c.strokeStyle = '#fff8ea';
        c.lineWidth = size * 0.012;
        c.stroke();
      }
    }
    // racers (this view's driver last so it is on top)
    for (let pass = 0; pass < 2; pass++) {
      for (const r of race.racers) {
        const mine = r === me;
        if ((pass === 1) !== mine) continue;
        const [x, y] = this._toMap(r.craft.pos.x, r.craft.pos.z);
        c.fillStyle = r.team.css;
        c.strokeStyle = mine ? '#fff8ea' : 'rgba(9,30,44,0.8)';
        c.lineWidth = size * (mine ? 0.018 : 0.012);
        c.beginPath();
        c.arc(x, y, size * (mine ? 0.05 : 0.036), 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
  }
}

export class Hud {
  /** @param {HTMLElement} root the element the game lives in */
  constructor(root) {
    if (!document.getElementById('bw-style')) {
      const style = document.createElement('style');
      style.id = 'bw-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    root.classList.add('bw');
    this.root = root;

    this.canvasHost = el('div', 'bw-canvas');
    this.touchLayer = el('div', 'bw-touch');
    root.append(this.canvasHost, this.touchLayer);

    // ---- race readouts: one ViewHud per viewport, plus the shared thumb pads
    this.race = el('div', 'bw-race');
    this.race.hidden = true;
    this.viewHost = el('div', 'bw-views');
    this.divider = el('div', 'bw-divider');
    this.divider.hidden = true;
    // touch: a stick that appears under the thumb, and a badge under a second finger
    this.stick = el('div', 'bw-stick', '<div class="bw-stick-ring"><span>◀</span><span>▶</span></div><div class="bw-stick-brake">BRAKE</div><div class="bw-knob"></div>');
    this.stick.hidden = true;
    this.knob = this.stick.querySelector('.bw-knob');
    this.finger = el('div', 'bw-finger', 'BRAKE');
    this.finger.hidden = true;
    this.touchHint = el('div', 'bw-touchhint', 'Touch anywhere · drag to steer · pull down to brake');
    this.touchHint.hidden = true;
    this.rotate = el('div', 'bw-rotate', 'Tip: turn your phone sideways');
    this.race.append(this.viewHost, this.divider, this.stick, this.finger, this.touchHint, this.rotate);
    root.append(this.race);
    /** @type {ViewHud[]} */
    this.views = [];

    // ---- title
    this.title = el('div', 'bw-overlay');
    this.title.innerHTML = `
      <div class="bw-panel" role="dialog" aria-label="Breakwater GP">
        <h1 class="bw-title">BREAKWATER <span>GP</span></h1>
        <p class="bw-sub">${RULES.laps} laps · ${RULES.racers} boats · two islands · one river</p>
        <ul class="bw-rules">
          <li><i class="bw-ico can"></i><span><b>Red can</b> — pass on its <b>right</b></span></li>
          <li><i class="bw-ico cone"></i><span><b>Green cone</b> — pass on its <b>left</b></span></li>
          <li><i class="bw-ico bolt"></i><span>Each clean pass adds <b>power</b>. A miss resets it; ${RULES.maxMisses} misses and you are out.</span></li>
          <li class="bw-ctl-keys"><i class="bw-ico key">←→</i><span>steer</span><i class="bw-ico key">↑</i><span>throttle</span><i class="bw-ico key">↓</i><span>brake</span></li>
          <li class="bw-ctl-touch" hidden><span><b>Touch anywhere</b> and drag sideways to steer · <b>pull down</b> to brake. One thumb is enough; throttle is automatic.</span></li>
        </ul>
        <button class="bw-btn" id="bw-start" type="button">Start race</button>
        <div class="bw-modes">
          <button class="bw-btn2" id="bw-split" type="button">2 players<small>split screen · WASD + arrows</small></button>
          <button class="bw-btn2" id="bw-online" type="button">2–4 players<small>online · no server</small></button>
        </div>
        <button class="bw-link bw-soundbtn" type="button">Sound: on</button>
      </div>`;
    this.startBtn = this.title.querySelector('#bw-start');
    this.splitBtn = this.title.querySelector('#bw-split');
    this.onlineBtn = this.title.querySelector('#bw-online');
    this.ctlKeys = this.title.querySelector('.bw-ctl-keys');
    this.ctlTouch = this.title.querySelector('.bw-ctl-touch');

    // ---- results
    this.results = el('div', 'bw-overlay');
    this.results.hidden = true;
    this.results.innerHTML = `
      <div class="bw-panel" role="dialog" aria-label="Results">
        <div class="bw-result-head">
          <div class="bw-result-pos" id="bw-rpos"></div>
          <div class="bw-result-note" id="bw-rnote"></div>
        </div>
        <table class="bw-table"><tbody id="bw-rbody"></tbody></table>
        <button class="bw-btn" id="bw-again" type="button">Race again</button>
        <p class="bw-wait" id="bw-rwait" hidden></p>
        <button class="bw-link" id="bw-rlobby" type="button" hidden>Invite more players</button>
        <button class="bw-link" id="bw-menu" type="button">Back to menu</button>
        <button class="bw-link bw-soundbtn" type="button">Sound: on</button>
      </div>`;
    this.againBtn = this.results.querySelector('#bw-again');
    this.menuBtn = this.results.querySelector('#bw-menu');
    this.lobbyBtn = this.results.querySelector('#bw-rlobby');
    this.rWait = this.results.querySelector('#bw-rwait');
    this.rPos = this.results.querySelector('#bw-rpos');
    this.rNote = this.results.querySelector('#bw-rnote');
    this.rBody = this.results.querySelector('#bw-rbody');

    // ---- online lobby: the host swaps an invite and a reply with each friend, nothing else
    this.lobby = el('div', 'bw-overlay');
    this.lobby.hidden = true;
    this.lobby.innerHTML = `
      <div class="bw-panel bw-panel-wide" role="dialog" aria-label="Play online">
        <div class="bw-lhead">
          <h2 class="bw-h2">Play online</h2>
          <label class="bw-name">Your name <input id="bw-name" type="text" maxlength="10" placeholder="Name" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        </div>
        <p class="bw-note" id="bw-lnote">Up to four players, connected straight from browser to browser. There is no game server: the host swaps an invite and a reply with each friend by any chat app. Empty seats are filled by bots.</p>
        <ol class="bw-roster" id="bw-roster" hidden></ol>
        <div class="bw-lstep" id="bw-lchoose">
          <button class="bw-btn" id="bw-host" type="button">Invite friends</button>
          <button class="bw-btn2" id="bw-join" type="button">I have an invite</button>
        </div>
        <div class="bw-lstep" id="bw-lhost" hidden>
          <div class="bw-lsplit" id="bw-linvite">
            <div class="bw-lcol">
              <label for="bw-invite">1 · Send this invite link to a friend</label>
              <textarea id="bw-invite" class="bw-code" readonly rows="3"></textarea>
              <div class="bw-pair">
                <button class="bw-btn2" id="bw-copy-invite" type="button">Copy link</button>
                <button class="bw-btn2" id="bw-share-invite" type="button" hidden>Share…</button>
              </div>
            </div>
            <div class="bw-lcol">
              <label for="bw-reply-in">2 · Paste the reply code they send back</label>
              <textarea id="bw-reply-in" class="bw-code" rows="3" placeholder="Reply code" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
              <button class="bw-btn2" id="bw-connect" type="button">Connect</button>
            </div>
          </div>
          <p class="bw-wait" id="bw-lfull" hidden>All four seats are taken.</p>
          <button class="bw-btn" id="bw-net-start" type="button" disabled>Start race</button>
        </div>
        <div class="bw-lstep bw-lsplit" id="bw-ljoin" hidden>
          <div class="bw-lcol">
            <label for="bw-invite-in">1 · Paste the invite link or code</label>
            <textarea id="bw-invite-in" class="bw-code" rows="3" placeholder="Invite link or code" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
            <button class="bw-btn2" id="bw-make-reply" type="button">Make reply code</button>
          </div>
          <div class="bw-lcol" id="bw-ljoin2" hidden>
            <label for="bw-reply">2 · Send this reply code back to your friend</label>
            <textarea id="bw-reply" class="bw-code" readonly rows="3"></textarea>
            <div class="bw-pair">
              <button class="bw-btn2" id="bw-copy-reply" type="button">Copy code</button>
              <button class="bw-btn2" id="bw-share-reply" type="button" hidden>Share…</button>
            </div>
            <p class="bw-wait">Waiting for your friend to paste it…</p>
          </div>
        </div>
        <div class="bw-lstep" id="bw-lready" hidden>
          <p class="bw-ready" id="bw-lstatus">Connected</p>
          <p class="bw-wait" id="bw-lwait">Waiting for the host to start…</p>
        </div>
        <p class="bw-error" id="bw-lerror" hidden></p>
        <button class="bw-link" id="bw-lback" type="button">Back</button>
      </div>`;
    const q = (id) => this.lobby.querySelector(id);
    this.l = {
      note: q('#bw-lnote'),
      name: q('#bw-name'),
      roster: q('#bw-roster'),
      choose: q('#bw-lchoose'),
      host: q('#bw-lhost'),
      inviteBox: q('#bw-linvite'),
      full: q('#bw-lfull'),
      join: q('#bw-ljoin'),
      join2: q('#bw-ljoin2'),
      ready: q('#bw-lready'),
      hostBtn: q('#bw-host'),
      joinBtn: q('#bw-join'),
      invite: q('#bw-invite'),
      copyInvite: q('#bw-copy-invite'),
      shareInvite: q('#bw-share-invite'),
      replyIn: q('#bw-reply-in'),
      connect: q('#bw-connect'),
      inviteIn: q('#bw-invite-in'),
      makeReply: q('#bw-make-reply'),
      reply: q('#bw-reply'),
      copyReply: q('#bw-copy-reply'),
      shareReply: q('#bw-share-reply'),
      status: q('#bw-lstatus'),
      start: q('#bw-net-start'),
      wait: q('#bw-lwait'),
      error: q('#bw-lerror'),
      back: q('#bw-lback'),
    };

    root.append(this.title, this.results, this.lobby);

    /** Set by the game: called when a sound toggle is pressed. */
    this.onToggleSound = null;
    this.soundBtns = [...root.querySelectorAll('.bw-soundbtn')];
    this.soundBtns.forEach((b) => b.addEventListener('click', () => this.onToggleSound && this.onToggleSound()));

    this.setTouch(matchMedia('(pointer: coarse)').matches);
  }

  /**
   * (Re)build the per-player HUDs.
   * @param {Array<{left:number, top:number, width:number, height:number}>} rects
   */
  setViews(rects) {
    while (this.views.length > rects.length) this.views.pop().dispose();
    while (this.views.length < rects.length) this.views.push(new ViewHud(this.viewHost));
    rects.forEach((r, i) => this.views[i].setRect(r.left, r.top, r.width, r.height));
    const split = rects.length > 1;
    this.root.classList.toggle('split', split);
    this.divider.hidden = !split;
    if (split) {
      const sideBySide = rects[1].left > 0;
      this.divider.className = `bw-divider ${sideBySide ? 'v' : 'h'}`;
    }
    return this.views;
  }

  setSoundLabel(muted) {
    this.soundBtns.forEach((b) => (b.textContent = muted ? 'Sound: off' : 'Sound: on'));
  }

  setTouch(isTouch) {
    this.root.classList.toggle('touch', isTouch);
    this.ctlKeys.hidden = isTouch;
    this.ctlTouch.hidden = !isTouch;
    this.splitBtn.hidden = isTouch; // split screen needs a keyboard
  }

  /** Draw the stick under the thumb (and the brake badge under a second finger). */
  showTouch(input) {
    const s = input.steerPointer;
    const b = input.brakePointer;
    const box = this.race.getBoundingClientRect();
    this.stick.hidden = !s;
    if (s) {
      this.stick.style.left = `${(s.originX - box.left).toFixed(1)}px`;
      this.stick.style.top = `${(s.originY - box.top).toFixed(1)}px`;
      const dx = Math.max(-62, Math.min(62, s.x - s.originX));
      const dy = Math.max(-8, Math.min(82, s.y - s.originY));
      this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      this.stick.classList.toggle('braking', input.touchBrake > 0.12);
      this.touchHint.hidden = true; // they have found it
    }
    this.finger.hidden = !b;
    if (b) {
      this.finger.style.left = `${(b.x - box.left).toFixed(1)}px`;
      this.finger.style.top = `${(b.y - box.top).toFixed(1)}px`;
    }
  }

  /** A line of help for touch drivers until their first touch of a race. */
  showTouchHint(show) {
    this.touchHint.hidden = !show;
  }

  showTitle(show) {
    this.title.hidden = !show;
  }

  showRace(show) {
    this.race.hidden = !show;
  }

  showLobby(show) {
    this.lobby.hidden = !show;
  }

  /** Which lobby step is showing: 'choose' | 'host' | 'join' | 'ready'. */
  /** @param {'choose'|'host'|'join'|'ready'} step */
  lobbyStep(step, { status = '' } = {}) {
    const l = this.l;
    l.choose.hidden = step !== 'choose';
    l.host.hidden = step !== 'host';
    l.join.hidden = step !== 'join';
    l.ready.hidden = step !== 'ready';
    l.note.hidden = step !== 'choose'; // the steps explain themselves; keep them on one screen
    l.roster.hidden = step !== 'host' && step !== 'ready';
    if (step === 'ready') l.status.textContent = status;
    this.lobbyError('');
  }

  /**
   * Who is in: one chip per seat.
   * @param {Array<{ kind: 'host'|'guest'|'bot'|'open', name: string, css: string, info?: string }>} seats
   * @param {number} mine the seat of the player on this machine
   */
  setRoster(seats, mine) {
    const list = this.l.roster;
    list.textContent = '';
    seats.forEach((seat, i) => {
      const li = el('li', `${seat.kind}${i === mine ? ' me' : ''}`);
      const chip = el('i', 'chip');
      chip.style.background = seat.css;
      li.append(chip, el('b', '', seat.kind === 'open' ? 'open' : seat.name));
      if (seat.info) li.append(el('small', '', seat.info));
      list.append(li);
    });
  }

  lobbyError(text) {
    this.l.error.hidden = !text;
    this.l.error.textContent = text;
  }

  // ------------------------------------------------------------ results

  /**
   * @param {import('./Race.js').Race} race
   * @param {boolean} show
   * @param {{ canRestart?: boolean, note?: string, toLobby?: boolean }} [opts] `note` says why there
   *   is no "Race again"; `toLobby` offers the online host a way back to the lobby
   */
  showResults(race, show = true, { canRestart = true, note = '', toLobby = false } = {}) {
    this.results.hidden = !show;
    if (!show) return;
    this.againBtn.hidden = !canRestart;
    this.lobbyBtn.hidden = !toLobby;
    this.rWait.hidden = canRestart || !note;
    this.rWait.textContent = note;
    const locals = race.players;
    const humans = race.racers.filter((r) => r.isPlayer || r.isRemote);
    if (humans.length === 1) {
      const p = locals[0];
      if (p.retired) {
        this.rPos.textContent = 'OUT';
        this.rNote.textContent = `${RULES.maxMisses} marks missed`;
      } else {
        this.rPos.innerHTML = `${p.rank}<small>${ordinal(p.rank)}</small>`;
        const best = p.lapTimes.length ? Math.min(...p.lapTimes) : NaN;
        this.rNote.innerHTML = `${p.rank === 1 ? 'Winner' : 'Finished'}<br>best lap ${formatTime(best)}`;
      }
    } else {
      // two drivers: say who came out ahead
      const done = humans.filter((r) => r.finished).sort((a, b) => a.finishTime - b.finishTime);
      const racing = humans.some((r) => !r.finished && !r.retired);
      if (done.length) this.rPos.textContent = `${done[0].name} ${done[0].rank === 1 ? 'wins' : 'leads'}`;
      else this.rPos.textContent = racing ? 'Racing…' : 'All out';
      this.rNote.textContent = racing ? 'still racing' : done.length >= 2 ? `by ${(done[1].finishTime - done[0].finishTime).toFixed(3)} s` : '';
    }
    this.rBody.textContent = '';
    const leader = race.order[0];
    for (const r of race.order) {
      const tr = el('tr', r.isPlayer ? 'me' : r.isRemote ? 'them' : '');
      let t;
      if (r.retired) t = 'OUT';
      else if (r.finished) t = r === leader ? formatTime(r.finishTime) : `+${(r.finishTime - leader.finishTime).toFixed(3)}`;
      else t = 'still racing';
      // colours are set through the CSSOM (no inline style attributes), which strict CSPs allow
      const who = el('td');
      const chip = el('i', 'chip');
      chip.style.background = r.team.css;
      who.append(chip, document.createTextNode(r.name));
      tr.append(el('td', '', String(r.rank)), who, el('td', '', t));
      this.rBody.append(tr);
    }
  }
}
