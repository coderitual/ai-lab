// DOM heads-up display. Text is real text (crisp at any pixel ratio), values
// are only written when they change, and the layout adapts with CSS.

import css from './hud.css?inline';
import { formatTime, ordinal } from '../engine/math.js';
import { KMH, RULES } from './config.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Only touch the DOM when the value really changed. */
function setText(node, value) {
  if (node.__v !== value) {
    node.__v = value;
    node.textContent = value;
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

    // ---- race readouts
    this.race = el('div', 'bw-race');
    this.race.hidden = true;
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
    this.race.append(top, this.standings, this.map);
    root.append(this.race);

    // ---- touch pads (visual only; the touch layer receives the input)
    this.steerPad = el('div', 'bw-pad bw-pad-steer', '<div class="bw-rail"><span>◀</span><span>▶</span></div><div class="bw-knob"></div>');
    this.knob = this.steerPad.querySelector('.bw-knob');
    this.brakePad = el('div', 'bw-pad bw-pad-brake', '<div class="bw-brake">BRAKE</div>');
    this.rotate = el('div', 'bw-rotate', 'Tip: turn your phone sideways');
    this.race.append(this.steerPad, this.brakePad, this.rotate);

    this.banner = el('div', 'bw-banner');
    this.toast = el('div', 'bw-toast');
    root.append(this.banner, this.toast);

    // ---- title + results
    this.title = el('div', 'bw-overlay');
    this.title.innerHTML = `
      <div class="bw-panel" role="dialog" aria-label="Breakwater GP">
        <h1 class="bw-title">BREAKWATER <span>GP</span></h1>
        <p class="bw-sub">${RULES.laps} laps · ${RULES.racers} riders · one island</p>
        <ul class="bw-rules">
          <li><i class="bw-ico can"></i><span><b>Red can</b> — ride past on its <b>right</b></span></li>
          <li><i class="bw-ico cone"></i><span><b>Green cone</b> — ride past on its <b>left</b></span></li>
          <li><i class="bw-ico bolt"></i><span>Each clean pass adds <b>power</b>. A miss resets it; ${RULES.maxMisses} misses and you are out.</span></li>
          <li class="bw-ctl-keys"><i class="bw-ico key">←→</i><span>steer</span><i class="bw-ico key">↑</i><span>throttle</span><i class="bw-ico key">↓</i><span>brake</span></li>
          <li class="bw-ctl-touch" hidden><span><b>Left thumb</b> drag to steer · <b>right thumb</b> hold to brake. Throttle is automatic.</span></li>
        </ul>
        <button class="bw-btn" id="bw-start" type="button">Start race</button>
        <button class="bw-link bw-soundbtn" type="button">Sound: on</button>
      </div>`;
    this.startBtn = this.title.querySelector('#bw-start');
    this.ctlKeys = this.title.querySelector('.bw-ctl-keys');
    this.ctlTouch = this.title.querySelector('.bw-ctl-touch');

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
        <button class="bw-link bw-soundbtn" type="button">Sound: on</button>
      </div>`;
    this.againBtn = this.results.querySelector('#bw-again');
    this.rPos = this.results.querySelector('#bw-rpos');
    this.rNote = this.results.querySelector('#bw-rnote');
    this.rBody = this.results.querySelector('#bw-rbody');
    root.append(this.title, this.results);

    /** Set by the game: called when a sound toggle is pressed. */
    this.onToggleSound = null;
    this.soundBtns = [...root.querySelectorAll('.bw-soundbtn')];
    this.soundBtns.forEach((b) => b.addEventListener('click', () => this.onToggleSound && this.onToggleSound()));

    this._toastTimer = 0;
    this._mapStatic = null;
    this._mapSize = 0;
    this.setTouch(matchMedia('(pointer: coarse)').matches);
  }

  setSoundLabel(muted) {
    this.soundBtns.forEach((b) => (b.textContent = muted ? 'Sound: off' : 'Sound: on'));
  }

  setTouch(isTouch) {
    this.root.classList.toggle('touch', isTouch);
    this.ctlKeys.hidden = isTouch;
    this.ctlTouch.hidden = !isTouch;
  }

  /** Reflect the thumbs on the on-screen pads. */
  showTouch(input) {
    const s = input.steerPointer;
    this.steerPad.classList.toggle('active', !!s);
    const travel = this.steerPad.clientWidth * 0.5 - this.knob.clientWidth * 0.5 - 4;
    this.knob.style.transform = `translateX(${(input.touchSteer * travel).toFixed(1)}px)`;
    this.brakePad.classList.toggle('active', !!input.brakePointer);
  }

  showTitle(show) {
    this.title.hidden = !show;
  }

  showRace(show) {
    this.race.hidden = !show;
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

  setStandings(racers) {
    this.standings.textContent = '';
    this.rows = racers.map((r) => {
      const li = el('li', r.isPlayer ? 'me' : '');
      const n = el('span', 'n', String(r.rank));
      const chip = el('i', 'chip');
      chip.style.background = r.team.css;
      li.append(n, chip, el('span', '', r.name));
      this.standings.append(li);
      return { li, n, racer: r, shown: -1 };
    });
  }

  /** Per-frame refresh. Cheap: every write is guarded. */
  update(dt, race, craft) {
    if (this._toastTimer > 0 && this._toastTimer !== Infinity) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast.classList.remove('show');
    }
    const p = race.player;
    setText(this.posN, String(p.rank));
    setText(this.posSfx, ordinal(p.rank));
    setText(this.lapN, String(Math.min(p.lap, race.laps)));
    setText(this.time, formatTime(race.state === 'racing' || race.state === 'finished' ? (p.finished ? p.finishTime : race.time) : 0));
    setText(this.speedN, String(Math.round(craft.speed * KMH)));

    const power = Math.round(craft.power);
    if (this._power !== power) {
      this._power = power;
      this.pips.forEach((pip, i) => pip.classList.toggle('on', i < power));
      this.powerMeter.classList.toggle('full', power >= RULES.maxPower);
    }
    if (this._misses !== p.misses) {
      this._misses = p.misses;
      this.missDots.forEach((d, i) => d.classList.toggle('on', i < p.misses));
    }
    const gate = race.track.gates[p.nextGate];
    if (this._gate !== gate.index) {
      this._gate = gate.index;
      this.next.className = `bw-next ${gate.pass}`;
      this.nextTxt.textContent = gate.pass === 'right' ? 'pass right' : 'pass left';
      this.nextArrow.textContent = gate.pass === 'right' ? '▶' : '◀';
    }
    // standings order
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
    // island
    const [ix, iy] = this._toMap(0, 0);
    c.fillStyle = 'rgba(127,176,76,0.85)';
    c.beginPath();
    c.arc(ix, iy, 70 * scale, 0, Math.PI * 2);
    c.fill();
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

  drawMap(race) {
    if (this.race.hidden) return;
    const track = race.track;
    this._prepareMap(track);
    const size = this._mapSize;
    const c = this.mapCtx;
    c.clearRect(0, 0, size, size);
    c.drawImage(this._mapStatic, 0, 0);
    // marks
    const next = race.player.nextGate;
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
    // racers (player last so it is on top)
    const sorted = race.racers.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const r of sorted) {
      const [x, y] = this._toMap(r.craft.pos.x, r.craft.pos.z);
      c.fillStyle = r.team.css;
      c.strokeStyle = r.isPlayer ? '#fff8ea' : 'rgba(9,30,44,0.8)';
      c.lineWidth = size * (r.isPlayer ? 0.018 : 0.012);
      c.beginPath();
      c.arc(x, y, size * (r.isPlayer ? 0.05 : 0.036), 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }

  // ------------------------------------------------------------ results

  showResults(race, show = true) {
    this.results.hidden = !show;
    if (!show) return;
    const p = race.player;
    if (p.retired) {
      this.rPos.innerHTML = 'OUT';
      this.rNote.textContent = `${RULES.maxMisses} marks missed`;
    } else {
      this.rPos.innerHTML = `${p.rank}<small>${ordinal(p.rank)}</small>`;
      const best = p.lapTimes.length ? Math.min(...p.lapTimes) : NaN;
      this.rNote.innerHTML = `${p.rank === 1 ? 'Winner' : 'Finished'}<br>best lap ${formatTime(best)}`;
    }
    this.rBody.textContent = '';
    const leader = race.order[0];
    for (const r of race.order) {
      const tr = el('tr', r.isPlayer ? 'me' : '');
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
