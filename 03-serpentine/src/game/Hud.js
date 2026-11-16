// The HTML overlay. FIRST VERSION: plain text readouts and plain panels; the
// HUD stage designs the real thing behind the same methods.
//
// The one rule: the DOM is touched only when a value has really changed.
// Every readout goes through a field that remembers what it last showed, so
// calling the set...() methods every frame costs a comparison, not a layout.
//
// Hud holds what is shared (the title, pause and results panels, the buttons
// for the whole page); each view gets a ViewHud placed over its rectangle.
// Buttons only report actions (onAction(name, driver)); the game decides.

import './hud.css';
import { formatMs } from './Race.js';

/** A text node that is only written when its text changes. */
function field(parent, className, tag = 'div') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent.appendChild(el);
  let text = null;
  let cls = className;
  let hidden = false;
  return {
    el,
    set(value) {
      const v = String(value);
      if (v !== text) el.textContent = text = v;
    },
    cls(name) {
      const c = className + (name ? ' ' + name : '');
      if (c !== cls) el.className = cls = c;
    },
    show(on) {
      if (hidden === !on) return;
      hidden = !on;
      el.hidden = hidden;
    },
  };
}

function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
    b.blur();
  });
  parent.appendChild(b);
  return b;
}

export class ViewHud {
  /** @param {HTMLElement} root @param {number} index @param {(name: string, driver: number) => void} act */
  constructor(root, index, act) {
    this.index = index;
    const el = document.createElement('div');
    el.className = 'view';
    root.appendChild(el);
    this.el = el;
    this._zone = '';

    const timing = document.createElement('div');
    timing.className = 'timing';
    el.appendChild(timing);
    this.lamps = field(timing, 'lamps');
    this.lap = field(timing, 'lap');
    this.clock = field(timing, 'clock');
    this.live = field(timing, 'live');
    this.flash = field(timing, 'flash');
    this.position = field(timing, 'position');

    const drive = document.createElement('div');
    drive.className = 'drive';
    el.appendChild(drive);
    this.speed = field(drive, 'speed');
    this.gear = field(drive, 'gear');
    this.marks = field(drive, 'marks');

    this.note = field(el, 'note');
    const tools = document.createElement('div');
    tools.className = 'tools';
    el.appendChild(tools);
    button(tools, 'View', () => act('camera', index));
    this.resetButton = button(tools, 'Put back', () => act('reset', index));
    this.resetButton.hidden = true;

    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.stick.appendChild(document.createElement('i'));
    this.stick.hidden = true;
    root.appendChild(this.stick);
    this._flashUntil = -1;
  }

  /** @param {{ left: number, top: number, width: number, height: number }} zone fractions of the window */
  setZone(zone) {
    const key = `${zone.left},${zone.top},${zone.width},${zone.height}`;
    if (key === this._zone) return;
    this._zone = key;
    const s = this.el.style;
    s.left = `${zone.left * 100}%`;
    s.top = `${zone.top * 100}%`;
    s.width = `${zone.width * 100}%`;
    s.height = `${zone.height * 100}%`;
  }

  setVisible(on) {
    this.el.hidden = !on;
  }

  /** Countdown lamps lit, 0..5 (shown only before the start). */
  setLamps(n, waiting) {
    this.lamps.show(waiting);
    this.lamps.set('●'.repeat(n) + '○'.repeat(5 - n));
  }

  setLap(lap, laps, finished) {
    this.lap.set(finished ? 'Finished' : `Lap ${Math.min(lap, laps)} / ${laps}`);
  }

  setClock(ms, waiting) {
    this.clock.set(formatMs(ms));
    this.clock.cls(waiting ? 'wait' : '');
  }

  /** The live gap to the best lap (ms, + = behind), or null. */
  setLive(ms) {
    this.live.show(ms !== null);
    if (ms !== null) this.live.set(formatMs(Math.round(ms / 100) * 100, true).replace(/\d\d$/, ''));
  }

  /** A line was taken: the gap (ms) or the plain split, held until `until` on the race clock. */
  flashLine(text, kind, until) {
    this.flash.set(text);
    this.flash.cls(kind);
    this.flash.show(true);
    this._flashUntil = until;
  }

  /** @param {number} clock the race clock (s) */
  tick(clock) {
    if (this._flashUntil >= 0 && clock >= this._flashUntil) {
      this._flashUntil = -1;
      this.flash.show(false);
    }
  }

  setPosition(p, of) {
    this.position.show(of > 1);
    this.position.set(`P${p} of ${of}`);
  }

  setSpeed(kmh) {
    this.speed.set(`${Math.round(Math.abs(kmh))} km/h`);
  }

  setGear(gear, rpm) {
    this.gear.set(`${gear < 0 ? 'R' : gear === 0 ? 'N' : gear}  ·  ${Math.round(rpm / 100) * 100} rpm`);
  }

  /** Assists working and lamps on, as short words. */
  setMarks(words) {
    this.marks.set(words);
  }

  /** The put-back offer, and why (or '' for none). */
  setOffer(reason) {
    const on = !!reason;
    if (this.resetButton.hidden === on) this.resetButton.hidden = !on;
    this.note.show(on);
    if (on) this.note.set(reason);
  }

  /** @param {{ x: number, y: number, originX: number, originY: number }|null} stick client pixels */
  setStick(stick, rect) {
    this.stick.hidden = !stick;
    if (!stick) return;
    this.stick.style.left = `${stick.originX - rect.left}px`;
    this.stick.style.top = `${stick.originY - rect.top}px`;
    const knob = /** @type {HTMLElement} */ (this.stick.firstChild);
    knob.style.transform = `translate(${stick.x - stick.originX}px, ${stick.y - stick.originY}px)`;
  }

  dispose() {
    this.el.remove();
    this.stick.remove();
  }
}

export class Hud {
  /**
   * @param {HTMLElement} container
   * @param {{ onAction: (name: string, driver: number) => void, enabled?: boolean }} options
   */
  constructor(container, { onAction, enabled = true }) {
    this.act = (name, driver = -1) => onAction(name, driver);
    const root = document.createElement('div');
    root.className = 'hud';
    root.hidden = !enabled;
    container.appendChild(root);
    this.root = root;
    /** @type {ViewHud[]} */
    this.views = [];

    const bar = document.createElement('div');
    bar.className = 'bar';
    root.appendChild(bar);
    this.timeButton = button(bar, 'Night', () => this.act('time'));
    this.muteButton = button(bar, 'Sound', () => this.act('mute'));
    this.pauseButton = button(bar, 'Pause', () => this.act('pause'));

    this.title = this._panel('Serpentine');
    this.titleText = field(this.title, 'text');
    const choose = document.createElement('div');
    choose.className = 'row';
    this.title.appendChild(choose);
    this.soloButton = button(choose, 'One driver', () => this.act('solo'));
    this.splitButton = button(choose, 'Two drivers', () => this.act('split'));
    const go = document.createElement('div');
    go.className = 'row';
    this.title.appendChild(go);
    button(go, 'Drive', () => this.act('start'));
    this.titleBoard = document.createElement('div');
    this.title.appendChild(this.titleBoard);

    this.pause = this._panel('Paused');
    const prow = document.createElement('div');
    prow.className = 'row';
    this.pause.appendChild(prow);
    button(prow, 'Go on', () => this.act('pause'));
    button(prow, 'Start again', () => this.act('again'));
    button(prow, 'Leave', () => this.act('leave'));

    this.results = this._panel('Results');
    this.resultsBody = document.createElement('div');
    this.results.appendChild(this.resultsBody);
    const rrow = document.createElement('div');
    rrow.className = 'row';
    this.results.appendChild(rrow);
    button(rrow, 'Again', () => this.act('again'));
    button(rrow, 'Leave', () => this.act('leave'));
    this._state = '';
  }

  _panel(heading) {
    const el = document.createElement('div');
    el.className = 'panel';
    el.hidden = true;
    const h = document.createElement('h1');
    h.textContent = heading;
    el.appendChild(h);
    this.root.appendChild(el);
    return el;
  }

  /** @param {number} n views wanted */
  setViews(n) {
    while (this.views.length > n) this.views.pop().dispose();
    while (this.views.length < n) this.views.push(new ViewHud(this.root, this.views.length, this.act));
  }

  /**
   * Which panels show.
   * @param {{ phase: string, paused: boolean, mode: string, time: string, muted: boolean }} s
   */
  setState(s) {
    const key = `${s.phase}|${s.paused}|${s.mode}|${s.time}|${s.muted}`;
    if (key === this._state) return;
    this._state = key;
    this.title.hidden = s.phase !== 'title';
    this.pause.hidden = !s.paused;
    this.results.hidden = s.phase !== 'results' || s.paused;
    this.pauseButton.hidden = s.phase === 'title';
    this.timeButton.textContent = s.time === 'day' ? 'Night' : 'Day';
    this.muteButton.classList.toggle('on', !s.muted);
    this.soloButton.classList.toggle('on', s.mode === 'solo');
    this.splitButton.classList.toggle('on', s.mode === 'split');
    for (const v of this.views) v.setVisible(s.phase !== 'title');
  }

  /** The board for one time of day, with the medal targets as fixed rows; `mark` is the ms of a lap to mark new. */
  boardHtml(table, medals, time, mark = null) {
    const rows = table.laps.map((l) => ({ ms: l.ms, label: l.standing ? 'from the grid' : '', ref: false }));
    for (const [name, ms] of Object.entries(medals)) rows.push({ ms, label: name, ref: true });
    rows.sort((a, b) => a.ms - b.ms);
    const body = rows
      .map((r) => `<tr class="${r.ref ? 'ref' : r.ms === mark ? 'new' : ''}"><td>${formatMs(r.ms)}</td><td>${r.label}</td></tr>`)
      .join('');
    const best3 = table.best3 ? `<div>Best three laps: ${formatMs(table.best3)}</div>` : '';
    return `<div>Best laps, ${time}</div><table>${body}</table>${best3}`;
  }

  /** How the screen is shared: '' one view, 'wide' side by side, 'tall' stacked (the page's buttons sit on the seam). */
  setSplit(kind) {
    if (kind === this._split) return;
    this._split = kind;
    this.root.classList.toggle('wide', kind === 'wide');
    this.root.classList.toggle('tall', kind === 'tall');
  }

  setTitleBoard(html) {
    if (this._titleBoard !== html) this.titleBoard.innerHTML = this._titleBoard = html;
  }

  setResults(html) {
    if (this._results !== html) this.resultsBody.innerHTML = this._results = html;
  }

  setTitleText(text) {
    this.titleText.set(text);
  }
}
