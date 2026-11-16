// The HTML overlay: one instrument set per view, and the panels shared by the
// page (title, pause, results, the fade's veil).
//
// Two ideas.
//
// The DOM is written only when what it shows has changed. Every readout is a
// small cell that remembers its last value (text, class, attribute, shown or
// not) and counts its writes, so calling the set...() methods every frame
// costs a comparison. Numbers are quantised to what the eye can use (the
// clock to tenths, the rev hand to 1/400 of its scale, the map to half a
// unit) before they are compared, which is what keeps the count in the dozens
// a second. `Hud.writes` is the running total, for tests.
//
// Everything is sized from one unit per view (--u, set when the view is laid
// out): the instruments scale with the view, so a half of a split screen or an
// upright phone gets the same instrument at its own size. The look is a car's
// digital cluster: thin strokes, tabular figures, one cool accent (ice blue),
// amber for behind, green for ahead, red only for the limiter and warnings;
// a dark ground only in the corners that carry readouts.
//
// Buttons only report actions (onAction(name, driver)); the game decides.
// Words come from text.js.

import './hud.css';
import { STICK_RANGE } from '../engine/Input.js';
import { formatMs } from './Race.js';
import { TEXT } from './text.js';
import { CAR } from './vehicle/params.js';

const SVG = 'http://www.w3.org/2000/svg';
let writes = 0;

/** Make an element (HTML, or SVG with an 'svg:' tag) with a class, under a parent. */
function make(tag, className, parent, text) {
  const el = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  if (className) el.setAttribute('class', className);
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** A cell: an element whose text, classes, attributes and visibility are written only when they change. */
class Cell {
  constructor(el) {
    this.el = el;
    this._text = null;
    this._flags = new Map();
    this._attrs = new Map();
    this._shown = !el.hidden;
  }
  text(v) {
    const s = String(v);
    if (s === this._text) return this;
    this.el.textContent = this._text = s;
    writes++;
    return this;
  }
  flag(name, on) {
    on = !!on;
    if (this._flags.get(name) === on) return this;
    this._flags.set(name, on);
    this.el.classList.toggle(name, on);
    writes++;
    return this;
  }
  attr(name, v) {
    const s = String(v);
    if (this._attrs.get(name) === s) return this;
    this._attrs.set(name, s);
    this.el.setAttribute(name, s);
    writes++;
    return this;
  }
  show(on) {
    on = !!on;
    if (on === this._shown) return this;
    this._shown = on;
    this.el.hidden = !on;
    writes++;
    return this;
  }
}
const cell = (tag, className, parent, text) => new Cell(make(tag, className, parent, text));

/** A button that reports an action and gives the focus back, so the keys drive again at once. */
function button(parent, label, onClick, className = '') {
  const b = make('button', className, parent);
  b.type = 'button';
  if (label) b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
    if (e.detail > 0) b.blur(); // a mouse or a finger; a key press keeps the focus where it is
  });
  return b;
}

/** Small line icons for the touch buttons and the high-beam lamp (24-unit boxes, stroked). */
const ICONS = {
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>',
  lights: '<path d="M11 6c-4 0-7 2.5-7 6s3 6 7 6z"/><path d="M14 8h7M14 12h7M14 16h7"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2-5"/><path d="M4 4v4h4"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
};
function iconButton(parent, name, label, onClick) {
  const b = button(parent, '', onClick, 'icon');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return b;
}

// ------------------------------------------------------------------ the rev counter

/** The dial's scale: 0 to SCALE_K thousand rpm (the limiter and a little more), red over the last 500 rpm before the limiter. */
const LIMITER = CAR.engine.limiter;
const SCALE_K = Math.ceil(LIMITER / 1000 + 0.25);
const RED_FROM = LIMITER - 500;
/** The arc: 260 degrees, open at the bottom; angles in SVG's frame (0 = right, clockwise). */
const A0 = 140;
const SWEEP = 260;
const R = 84;
const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
};
const arcPath = (from, to, r) => {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const angleOf = (rpm) => A0 + (SWEEP * Math.min(rpm, SCALE_K * 1000)) / (SCALE_K * 1000);

function dialSvg() {
  const parts = [];
  parts.push(`<path class="track" d="${arcPath(A0, A0 + SWEEP, R)}"/>`);
  parts.push(`<path class="red" d="${arcPath(angleOf(RED_FROM), A0 + SWEEP, R + 8)}"/>`);
  for (let k = 0; k <= SCALE_K * 2; k++) {
    const deg = angleOf(k * 500);
    const major = k % 2 === 0;
    const [x0, y0] = polar(deg, major ? 68 : 73);
    const [x1, y1] = polar(deg, 78);
    const hot = k * 500 >= RED_FROM ? ' hot' : '';
    parts.push(`<line class="${major ? 'major' : 'minor'}${hot}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`);
    if (major) {
      const [tx, ty] = polar(deg, 55);
      parts.push(`<text class="num${hot}" x="${tx.toFixed(2)}" y="${(ty + 5.5).toFixed(2)}">${k / 2}</text>`);
    }
  }
  parts.push(`<path class="fill" pathLength="1000" stroke-dasharray="0 1000" d="${arcPath(A0, A0 + SWEEP, R)}"/>`);
  parts.push('<g class="hand" transform="rotate(140 100 100)"><line x1="166" y1="100" x2="195" y2="100"/></g>');
  parts.push('<text class="gear" x="100" y="122">N</text>');
  parts.push(`<text class="unit" x="100" y="160">${TEXT.rpm}</text>`);
  return parts.join('');
}

// ------------------------------------------------------------------ one view

export class ViewHud {
  /**
   * @param {HTMLElement} root
   * @param {number} index
   * @param {(name: string, driver: number) => void} act
   */
  constructor(root, index, act) {
    this.index = index;
    const el = make('div', 'view', root);
    this.el = el;
    this.cell = new Cell(el);
    this._zone = '';
    this.split = false;
    this.wide = true;
    make('div', 'scrim tl', el);
    make('div', 'scrim br', el);

    // top left: the lap, large; the lap clock with the live gap beside it; the best lap
    const lapBlock = make('div', 'lapblock', el);
    const lapLine = make('div', 'lapline', lapBlock);
    this.lapNum = cell('span', 'lapnum', lapLine, '1');
    const lapSide = make('div', 'lapside', lapLine);
    this.lapOf = cell('span', 'lapof', lapSide, '/ 3');
    this.lapWord = cell('span', 'lapword', lapSide, TEXT.lap);
    const clockLine = make('div', 'clockline', lapBlock);
    this.clock = cell('span', 'clock', clockLine, '0:00.0');
    this.live = cell('span', 'live', clockLine);
    this.live.show(false);
    const bestLine = make('div', 'bestline', lapBlock);
    make('span', 'label', bestLine, TEXT.best);
    this.best = cell('span', 'besttime', bestLine, formatMs(null));

    // top right: the board (solo, wide), one line of it (solo, narrow), or the place and the gap (split)
    this.board = cell('div', 'board', el);
    this.boardHead = cell('div', 'head', this.board.el);
    this.boardRows = [];
    for (let i = 0; i < 5; i++) {
      const row = cell('div', 'row', this.board.el);
      this.boardRows.push({ row, rank: cell('span', 'rank', row.el), time: cell('span', 'time', row.el), tag: cell('span', 'tag', row.el) });
    }
    this._boardKey = '';
    this._boardSeen = null;
    this._newUntil = -1;
    this._newMs = null;
    this._rows = [];
    this._clock = 0;
    this.next = cell('div', 'next', el);
    this.nextLabel = cell('span', 'label', this.next.el, TEXT.toBeat);
    this.nextTime = cell('span', 'time', this.next.el);
    this.nextTag = cell('span', 'tag', this.next.el);
    this.pos = cell('div', 'pos', el);
    this.posPlace = cell('span', 'place', this.pos.el);
    this.posGap = cell('span', 'gap', this.pos.el);
    this.pos.show(false);

    // top middle: the countdown lamps, the line's gap, the lap banner
    this.lamps = cell('div', 'lamps', el);
    this.lampDots = [];
    for (let i = 0; i < 5; i++) this.lampDots.push(cell('i', '', this.lamps.el));
    this.lamps.show(false);
    this.flash = cell('div', 'flash', el);
    this.flash.show(false);
    this._flashUntil = -1;
    this.banner = cell('div', 'banner', el);
    this.bannerWord = cell('div', 'word', this.banner.el);
    this.bannerTime = cell('div', 'time', this.banner.el);
    this.bannerNote = cell('div', 'note', this.banner.el);
    this.banner.show(false);
    this._bannerUntil = -1;

    // the middle: wrong way, the reset offer, the first-time hint
    this.warn = cell('div', 'warn', el, TEXT.wrongWay);
    this.warn.show(false);
    this.offer = cell('div', 'offer', el);
    this.offerWhy = cell('div', 'why', this.offer.el);
    this.offerButton = new Cell(button(this.offer.el, TEXT.resetKeys, () => act('reset', index)));
    this.offer.show(false);
    this.hint = cell('div', 'hint', el);
    this.hint.show(false);

    // bottom left: the map
    this.map = cell('div', 'map', el);
    this._dots = [];

    // bottom right: speed and lamps, the rev counter with the gear
    const cluster = make('div', 'cluster', el);
    const readout = make('div', 'readout', cluster);
    this.speed = cell('div', 'speed', readout, '0');
    make('div', 'kmh', readout, TEXT.kmh);
    const tells = make('div', 'tells', readout);
    this.tell = {
      abs: cell('span', 'tell amber', tells, TEXT.lamps.abs),
      tc: cell('span', 'tell amber', tells, TEXT.lamps.tc),
      esc: cell('span', 'tell amber', tells, TEXT.lamps.esc),
      hand: cell('span', 'tell red round', tells, TEXT.lamps.hand),
      high: cell('span', 'tell blue beam', tells),
    };
    this.tell.high.el.innerHTML = `<svg viewBox="0 0 24 24" role="img" aria-label="${TEXT.lamps.high}">${ICONS.lights}</svg>`;
    const dial = make('svg:svg', 'dial', cluster);
    dial.setAttribute('viewBox', '0 0 200 200');
    dial.innerHTML = dialSvg();
    this.dial = new Cell(dial);
    this.fill = new Cell(dial.querySelector('.fill'));
    this.hand = new Cell(dial.querySelector('.hand'));
    this.gear = new Cell(dial.querySelector('.gear'));

    // touch: camera, lights, reset, pause (on a desk only pause shows, small)
    this.touchCol = cell('div', 'touchcol', el);
    iconButton(this.touchCol.el, 'camera', TEXT.buttons.camera, () => act('camera', index));
    iconButton(this.touchCol.el, 'lights', TEXT.buttons.lights, () => act('high', index));
    iconButton(this.touchCol.el, 'reset', TEXT.buttons.reset, () => act('reset', index));
    iconButton(this.touchCol.el, 'pause', TEXT.buttons.pause, () => act('pause', index));

    // the stick under the thumb (placed in page pixels, so it lives in the root, not the view)
    this.stick = cell('div', 'stick', root);
    this.stick.el.style.setProperty('--r', `${STICK_RANGE}px`);
    make('b', 'brake', this.stick.el);
    this.knob = make('i', '', this.stick.el);
    this.stick.show(false);
    this._stickKey = '';
  }

  /**
   * Place the view over its rectangle and size its unit from it.
   * @param {{ left: number, top: number, width: number, height: number }} zone fractions of the window
   * @param {number} w @param {number} h the view's size in CSS pixels
   */
  setZone(zone, w, h) {
    const key = `${zone.left},${zone.top},${zone.width},${zone.height},${w},${h}`;
    if (key === this._zone) return;
    this._zone = key;
    const s = this.el.style;
    s.left = `${zone.left * 100}%`;
    s.top = `${zone.top * 100}%`;
    s.width = `${zone.width * 100}%`;
    s.height = `${zone.height * 100}%`;
    const tall = h > w * 1.2;
    // a hundredth of a 16:9 picture's width; an upright picture is read from further away and gets more
    const u = tall ? w / 72 : Math.min(w, (h * 16) / 9) / 100;
    s.setProperty('--u', `${Math.max(3.4, Math.min(u, 20)).toFixed(2)}px`);
    this.cell.flag('tall', tall).flag('narrow', w < 700).flag('small', w < 460);
    this.wide = w >= 700;
  }

  setVisible(on) {
    this.cell.show(on);
    if (!on) this.stick.show(false);
  }

  /** Split screen or not, and whether thumbs drive (the touch buttons show). */
  setMode(split, touch) {
    this.split = split;
    this.cell.flag('split', split).flag('touch', touch);
  }

  // ---- timing

  setLap(lap, laps, finished) {
    const final = !finished && lap === laps && laps > 1;
    this.lapNum.text(Math.min(lap, laps));
    this.lapOf.text(`/ ${laps}`);
    this.lapWord.text(finished ? TEXT.finished : final ? TEXT.finalLap : TEXT.lap).flag('final', final);
  }

  /** The lap clock (ms), to tenths while it runs; dimmed before the start. */
  setClock(ms, waiting) {
    this.clock.text(formatMs(Math.floor(ms / 100) * 100).slice(0, -2)).flag('wait', waiting);
  }

  /** The live gap to the best lap (ms, + = behind), to tenths, or null. */
  setLive(ms) {
    this.live.show(ms !== null);
    if (ms === null) return;
    const t = Math.round(ms / 100);
    this.live.text(`${t > 0 ? '+' : t < 0 ? '−' : '±'}${(Math.abs(t) / 10).toFixed(1)}`).flag('ahead', t < 0).flag('behind', t > 0);
  }

  setBest(ms) {
    this.best.text(formatMs(ms));
  }

  /** Countdown lamps: n lit (red) while waiting; all green for a moment at the start; gone after. */
  setLamps(n, state) {
    this.lamps.show(state !== 'off').flag('go', state === 'go');
    for (let i = 0; i < 5; i++) this.lampDots[i].flag('on', state === 'go' || i < n);
  }

  /** A line was taken: the gap (ms, + = behind) or, with no reference, the plain split; held until `until` (race clock s). */
  flashLine(ms, isGap, until) {
    const text = isGap ? formatMs(ms, true).replace('-', '−') : formatMs(ms);
    this.flash.text(text).flag('ahead', isGap && ms <= 0).flag('behind', isGap && ms > 0).show(true);
    this._flashUntil = until;
  }

  /** The lap's banner: which lap, its time, and whether it is a new best. */
  lapBanner(lap, ms, best, until) {
    this.bannerWord.text(`${TEXT.lap} ${lap}`);
    this.bannerTime.text(formatMs(ms));
    this.bannerNote.text(best ? TEXT.newBest : '').show(best);
    this.banner.show(true);
    this._bannerUntil = until;
  }

  /** @param {number} clock the race clock (s) */
  tick(clock) {
    this._clock = clock;
    if (this._flashUntil >= 0 && clock >= this._flashUntil) {
      this._flashUntil = -1;
      this.flash.show(false);
    }
    if (this._bannerUntil >= 0 && clock >= this._bannerUntil) {
      this._bannerUntil = -1;
      this.banner.show(false);
    }
  }

  /** Forget the moments of a run (a new run, back to the title). */
  clearMoments() {
    this._flashUntil = this._bannerUntil = this._newUntil = -1;
    this.flash.show(false);
    this.banner.show(false);
    this._boardSeen = null;
    this._clock = 0;
  }

  // ---- the board, its one line, the place

  /**
   * The best-times board of this time of day: five rows from the device's laps with the medal targets among them.
   * @param {{ laps: Array<{ ms: number }> }} table @param {Record<string, number>} medals @param {string} time
   * @param {number|null} mine this run's best lap (for the one-line form)
   */
  setBoard(table, medals, time, mine) {
    const solo = !this.split;
    this.board.show(solo && this.wide);
    this.next.show(solo && !this.wide);
    this.pos.show(!solo);
    if (!solo) return;
    const laps = table.laps;
    let key = time;
    for (const l of laps) key += ',' + l.ms;
    if (key !== this._boardKey) {
      // a lap that was not on the board a moment ago lights its row
      const seen = this._boardSeen;
      if (seen && this._boardKey.split(',')[0] === time) {
        const fresh = laps.find((l) => !seen.includes(l.ms));
        if (fresh) {
          this._newMs = fresh.ms;
          this._newUntil = this._clock + 4;
        }
      }
      this._boardSeen = laps.map((l) => l.ms);
      this._boardKey = key;
      this._rows = rowsOf(table, medals);
    }
    const rows = this._rows;
    const newOn = this._newUntil >= 0 && this._clock < this._newUntil;
    const own = laps.length ? laps[0].ms : null;
    if (this.wide) {
      this.boardHead.text(TEXT.boardTitle(time));
      for (let i = 0; i < 5; i++) {
        const r = rows[i];
        const v = this.boardRows[i];
        v.row.show(!!r);
        if (!r) continue;
        const mineRow = !r.medal && r.ms === own;
        v.rank.text(r.medal ? '' : String(r.place));
        v.time.text(formatMs(r.ms));
        v.tag.text(r.medal ? TEXT.medal[r.medal] : mineRow ? TEXT.you : '');
        v.row.flag('medal', !!r.medal).flag('gold', r.medal === 'gold').flag('silver', r.medal === 'silver').flag('bronze', r.medal === 'bronze');
        v.row.flag('own', mineRow).flag('new', newOn && !r.medal && r.ms === this._newMs);
      }
      return;
    }
    // the one line: the slowest row still faster than this run's best (or, with no lap yet, the last row)
    let target = null;
    if (mine === null) target = rows[rows.length - 1];
    else for (const r of rows) if (r.ms < mine) target = r;
    this.next.flag('cleared', !target);
    this.nextLabel.text(target ? TEXT.toBeat : TEXT.allBeaten);
    this.nextTime.text(target ? formatMs(target.ms) : '');
    this.nextTag.text(target ? (target.medal ? TEXT.medal[target.medal] : TEXT.you) : '');
  }

  /** Split screen: the place, and the gap to the other car at the last line (ms, + = behind) or null. */
  setPosition(p, gap) {
    this.posPlace.text(TEXT.place(p)).flag('lead', p === 1);
    this.posGap.show(gap !== null);
    if (gap !== null) this.posGap.text(formatMs(gap, true).replace('-', '−')).flag('ahead', gap <= 0).flag('behind', gap > 0);
  }

  // ---- driving

  setSpeed(kmh) {
    this.speed.text(Math.round(Math.abs(kmh)));
  }

  /** The rev counter: the fill and the hand at `rpm`, the gear inside; red at the limiter. */
  setRev(rpm, gear) {
    const f = Math.min(1, Math.round((Math.max(0, rpm) / (SCALE_K * 1000)) * 400) / 400);
    this.fill.attr('stroke-dasharray', `${Math.round(f * 1000)} 1000`);
    this.hand.attr('transform', `rotate(${(A0 + SWEEP * f).toFixed(1)} 100 100)`);
    this.dial.flag('limit', rpm >= LIMITER - 150);
    this.gear.text(TEXT.gear(gear));
  }

  /** @param {{ abs: boolean, tc: boolean, esc: boolean, hand: boolean, high: boolean }} on */
  setTells(on) {
    for (const k in this.tell) this.tell[k].flag('on', on[k]);
  }

  setWarn(wrongWay) {
    this.warn.show(wrongWay);
  }

  /** The reset offer: a reason code ('roof' | 'stuck' | 'wrong', or '' for none), and how to take it on this device. */
  setOffer(reason, how) {
    this.offer.show(!!reason);
    if (!reason) return;
    this.offerWhy.text(TEXT.offer[reason] || '');
    this.offerButton.text(how);
  }

  setHint(text) {
    this.hint.show(!!text);
    if (text) this.hint.text(text);
  }

  // ---- the map

  /** @param {{ d: string, lines: number[][], w: number, h: number }} map in map units @param {number} cars */
  setMap(map, cars) {
    const svg = make('svg:svg', '');
    svg.setAttribute('viewBox', `-8 -8 ${(map.w + 16).toFixed(1)} ${(map.h + 16).toFixed(1)}`);
    const ticks = map.lines
      .map((l, i) => `<path class="${i === 0 ? 'start' : 'sector'}" d="M${l[0].toFixed(1)} ${l[1].toFixed(1)}L${l[2].toFixed(1)} ${l[3].toFixed(1)}"/>`)
      .join('');
    svg.innerHTML = `<path class="under" d="${map.d}"/><path class="road" d="${map.d}"/>${ticks}`;
    this.map.el.replaceChildren(svg);
    this.map.el.style.setProperty('--ar', ((map.w + 16) / (map.h + 16)).toFixed(3));
    this._dots = [];
    for (let i = 0; i < cars; i++) {
      const c = make('svg:circle', i === this.index ? 'dot own' : 'dot', svg);
      c.setAttribute('r', i === this.index ? '5' : '4');
      this._dots.push(new Cell(c));
    }
    // the view's own car on top
    if (this._dots[this.index]) svg.appendChild(this._dots[this.index].el);
  }

  /** Car `i` at map units (x, y). */
  setDot(i, x, y) {
    const d = this._dots[i];
    if (d) d.attr('transform', `translate(${Math.round(x * 2) / 2} ${Math.round(y * 2) / 2})`);
  }

  // ---- the stick

  /**
   * @param {{ x: number, y: number, originX: number, originY: number }|null} stick client pixels
   * @param {DOMRect} rect the page's box @param {number} brake 0..1
   */
  setStick(stick, rect, brake) {
    this.stick.show(!!stick);
    if (!stick) return;
    const key = `${stick.originX},${stick.originY},${stick.x},${stick.y},${brake.toFixed(2)}`;
    if (key === this._stickKey) return;
    this._stickKey = key;
    const s = this.stick.el.style;
    s.transform = `translate(${stick.originX - rect.left}px, ${stick.originY - rect.top}px)`;
    s.setProperty('--brake', brake.toFixed(2));
    this.knob.style.transform = `translate(${stick.x - stick.originX}px, ${stick.y - stick.originY}px)`;
    this.stick.flag('braking', brake > 0.05);
    writes += 3;
  }

  dispose() {
    this.el.remove();
    this.stick.el.remove();
  }
}

/** The board's rows: the device's laps and the medal targets together, fastest first, five of them. */
function rowsOf(table, medals) {
  const rows = table.laps.map((l) => ({ ms: l.ms, medal: null, place: 0 }));
  for (const [medal, ms] of Object.entries(medals)) rows.push({ ms, medal, place: 0 });
  rows.sort((a, b) => a.ms - b.ms || (a.medal ? 1 : -1));
  let place = 0;
  for (const r of rows) if (!r.medal) r.place = ++place;
  return rows.slice(0, 5);
}

// ------------------------------------------------------------------ the page

export class Hud {
  /**
   * @param {HTMLElement} container
   * @param {{ onAction: (name: string, driver: number) => void, enabled?: boolean }} options
   */
  constructor(container, { onAction, enabled = true }) {
    this.act = (name, driver = -1) => onAction(name, driver);
    const root = make('div', 'hud', container);
    root.hidden = !enabled;
    this.root = root;
    /** @type {ViewHud[]} */
    this.views = [];

    this.veil = cell('div', 'veil', root);
    this.veil.show(false);

    // the title: over the orbiting car, at the lower left
    this.title = cell('div', 'panel title', root);
    const t = this.title.el;
    make('h1', 'name', t, TEXT.name);
    make('p', 'tagline', t, TEXT.tagline);
    const choose = make('div', 'buttons', t);
    button(choose, TEXT.drive, () => this.act('start'), 'primary');
    this.splitButton = new Cell(button(choose, TEXT.twoPlayers, () => this.act(this._mode === 'split' ? 'solo' : 'split'), 'toggle'));
    this.timeButton = new Cell(button(choose, TEXT.night, () => this.act('time'), 'toggle'));
    this.soundButton = new Cell(button(choose, TEXT.soundOn, () => this.act('mute'), 'toggle'));
    this.titleBest = cell('div', 'titlebest', t);
    this.legend = cell('dl', 'legend', t);
    this._legendKey = '';

    // pause
    this.pause = cell('div', 'panel center pause', root);
    make('h2', '', this.pause.el, TEXT.paused);
    const prow = make('div', 'buttons column', this.pause.el);
    this.resumeButton = button(prow, TEXT.resume, () => this.act('pause'), 'primary');
    button(prow, TEXT.restart, () => this.act('again'));
    this.pauseTime = new Cell(button(prow, TEXT.night, () => this.act('time'), 'toggle'));
    this.pauseSound = new Cell(button(prow, TEXT.soundOn, () => this.act('mute'), 'toggle'));
    button(prow, TEXT.menu, () => this.act('leave'));
    this.pause.show(false);

    // results: beside the car
    this.results = cell('div', 'panel results', root);
    make('h2', '', this.results.el, TEXT.results);
    this.resultsBody = make('div', 'body', this.results.el);
    const rrow = make('div', 'buttons', this.results.el);
    this.againButton = button(rrow, TEXT.again, () => this.act('again'), 'primary');
    button(rrow, TEXT.menu, () => this.act('leave'));
    this.results.show(false);

    this._state = '';
    this._mode = 'solo';
    this._results = '';
  }

  /** DOM writes so far (all views and panels): the HUD's cost, for tests. */
  get writes() {
    return writes;
  }

  /** @param {number} n views wanted */
  setViews(n) {
    while (this.views.length > n) this.views.pop().dispose();
    while (this.views.length < n) this.views.push(new ViewHud(this.root, this.views.length, this.act));
    this._state = '';
  }

  /**
   * Which panels show, and the words on their toggles.
   * @param {{ phase: string, paused: boolean, mode: string, time: string, muted: boolean, device: string, attract: boolean }} s
   */
  setState(s) {
    const key = `${s.phase}|${s.paused}|${s.mode}|${s.time}|${s.muted}|${s.device}|${s.attract}`;
    if (key === this._state) return;
    const [wasPhase, wasPaused] = this._state.split('|');
    this._state = key;
    this._mode = s.mode;
    writes++;
    const title = s.phase === 'title';
    this.title.show(title);
    this.pause.show(s.paused && !title);
    this.results.show(s.phase === 'results' && !s.paused);
    this.root.classList.toggle('attract', s.attract);
    this.splitButton.text(s.mode === 'split' ? TEXT.onePlayer : TEXT.twoPlayers);
    const other = s.time === 'day' ? TEXT.night : TEXT.day;
    this.timeButton.text(other);
    this.pauseTime.text(other);
    this.soundButton.text(s.muted ? TEXT.soundOff : TEXT.soundOn).flag('off', s.muted);
    this.pauseSound.text(s.muted ? TEXT.soundOff : TEXT.soundOn).flag('off', s.muted);
    const touch = s.device === 'touch';
    for (const v of this.views) {
      v.setVisible(!title);
      v.setMode(s.mode === 'split', touch);
      if (title || (s.phase === 'countdown' && wasPhase !== 'countdown')) v.clearMoments();
    }
    this._legend(s.mode === 'split' && !touch ? 'split' : s.device);
    // a panel that has just opened takes the focus on its first button, so that the keys can work it
    const active = document.activeElement;
    const free = !active || active === document.body;
    if (!touch && free && s.paused && wasPaused !== 'true') this.resumeButton.focus({ preventScroll: true });
    else if (!touch && free && s.phase === 'results' && wasPhase !== 'results') this.againButton.focus({ preventScroll: true });
    // and gives it back when it closes, so that Enter and Space drive again
    if (!s.paused && !title && s.phase !== 'results' && active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  _legend(kind) {
    if (kind === this._legendKey) return;
    this._legendKey = kind;
    const rows = TEXT.legend[kind] || TEXT.legend.keys;
    this.legend.el.replaceChildren();
    for (const [k, what] of rows) {
      make('dt', '', this.legend.el, k);
      make('dd', '', this.legend.el, what);
    }
    writes++;
  }

  /** The title's line about this time of day's best lap and its medal. */
  setTitleBest(table, time, medal) {
    const best = table.laps.length ? table.laps[0].ms : null;
    this.titleBest.text(`${TEXT.boardTitle(time)}   ${best === null ? '—' : formatMs(best)}${medal ? '  ·  ' + TEXT.medal[medal] : ''}`);
  }

  /**
   * The results panel.
   * @param {{ time: string, drivers: Array<{ laps: Array<{ ms: number, putBack: boolean }>, best: number|null,
   *   total: number|null, finished: boolean, position: number, medal: string|null }>,
   *   table: { laps: Array<{ ms: number }> }, medals: Record<string, number>, mark: number|null }} r
   */
  setResults(r) {
    const split = r.drivers.length > 1;
    const cols = r.drivers
      .map((d, i) => {
        const laps = d.laps
          .map(
            (l, k) =>
              `<tr class="${l.ms === d.best ? 'best' : ''}"><td>${TEXT.lap} ${k + 1}</td><td class="t">${formatMs(l.ms)}</td>` +
              `<td class="tag">${l.ms === d.best ? TEXT.best : ''}${l.putBack ? ' ' + TEXT.putBack : ''}</td></tr>`,
          )
          .join('');
        const head = split
          ? `<div class="who${d.position === 1 && d.finished ? ' win' : ''}">${TEXT.driver(i)} · ${d.finished ? TEXT.place(d.position) : TEXT.dnf}</div>`
          : '';
        const medal = d.medal
          ? `<span class="medal ${d.medal}"><i></i>${TEXT.medalWon(TEXT.medal[d.medal])}</span>`
          : `<span class="medal none">${TEXT.noMedal}</span>`;
        return (
          `<div class="col">${head}<table>${laps}<tr class="total"><td>${TEXT.total}</td>` +
          `<td class="t">${d.finished ? formatMs(d.total) : '—'}</td><td></td></tr></table><div class="medalline">${medal}</div></div>`
        );
      })
      .join('');
    let html = '';
    if (split) {
      const winner = r.drivers.findIndex((d) => d.finished && d.position === 1);
      if (winner >= 0) html += `<div class="winner">${TEXT.wins(winner)}</div>`;
    }
    html += `<div class="cols">${cols}</div>`;
    // the board: five rows with the targets among them, the new lap marked
    const own = r.table.laps.length ? r.table.laps[0].ms : null;
    html += `<div class="boardlist"><div class="head">${TEXT.boardTitle(r.time)}</div>`;
    for (const row of rowsOf(r.table, r.medals)) {
      const mark = !row.medal && row.ms === r.mark;
      const cls = `row${row.medal ? ' medal ' + row.medal : ''}${mark ? ' new' : ''}${!row.medal && row.ms === own ? ' own' : ''}`;
      html +=
        `<div class="${cls}"><span class="rank">${row.medal ? '' : row.place}</span><span class="time">${formatMs(row.ms)}</span>` +
        `<span class="tag">${row.medal ? TEXT.medal[row.medal] : mark ? TEXT.you : ''}</span></div>`;
    }
    html += '</div>';
    if (html !== this._results) {
      this.resultsBody.innerHTML = this._results = html;
      writes++;
    }
  }

  /** How the screen is shared: '' one view, 'wide' side by side, 'tall' stacked. */
  setSplit(kind) {
    if (kind === this._split) return;
    this._split = kind;
    this.root.classList.toggle('wide', kind === 'wide');
    this.root.classList.toggle('tall', kind === 'tall');
  }

  /** The day-night switch's veil over the instruments: 0 = clear, 1 = black. */
  setFade(level) {
    const q = Math.round(level * 20) / 20;
    this.veil.show(q > 0);
    if (q > 0) this.veil.attr('style', `opacity:${q}`);
  }
}
