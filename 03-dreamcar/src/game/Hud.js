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
// upright phone gets the same instrument at its own size. The look is bold and
// sparse, to be read in sunlight at arm's length: heavy tabular figures on
// small dark plates, one cool accent (ice blue), amber for behind, green for
// ahead, red only for the limiter and warnings. Four corners carry readouts;
// the middle of the picture, where the car is, carries none. The best-laps
// board is on the title, the pause sheet and the results, not on the run.
//
// Buttons only report actions (onAction(name, driver)); the game decides.
// Words come from text.js.

import './hud.css';
import { TOUCH } from '../engine/Input.js';
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
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>',
  lights: '<path d="M11 6c-4 0-7 2.5-7 6s3 6 7 6z"/><path d="M14 8h7M14 12h7M14 16h7"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2-5"/><path d="M4 4v4h4"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  // the handbrake: a lever on its pivot, pulled up, with its button at the tip
  hand: '<path d="M6.5 19.5L16 7"/><circle cx="6.5" cy="19.5" r="2.2"/><path d="M14.2 5.2l3.6 2.9"/><path d="M3 22h8"/>',
  // the pedals: a foot pedal's face, ribbed (brake), and an arrow up (gas)
  brake: '<rect x="5" y="4" width="14" height="16" rx="3"/><path d="M8.5 9h7M8.5 12h7M8.5 15h7"/>',
  gas: '<path d="M12 19V6M7 11l5-5 5 5"/>',
};

/**
 * The one-thumb pad, drawn in a box of ±100 units (its radius is 100): the glass base and its rim, the steering's
 * full lock marked either side, the brake's arc along the foot of the rim (lit as far as the brake is pressed, from
 * the middle out), and below it the red arc that is the handbrake. The marks are where Input's TOUCH.pad puts them.
 */
function stickSvg() {
  const P = TOUCH.pad;
  const u = 100 / P.max; // units per px at the full size
  const lock = P.steer * u;
  const trip = P.trip * u;
  const arc = (r, a0, a1) => {
    const p0 = [r * Math.cos((a0 * Math.PI) / 180), r * Math.sin((a0 * Math.PI) / 180)];
    const p1 = [r * Math.cos((a1 * Math.PI) / 180), r * Math.sin((a1 * Math.PI) / 180)];
    return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  };
  return (
    `<defs><radialGradient id="glass" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#2a3a47" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#05090d" stop-opacity="0.5"/></radialGradient></defs>` +
    `<circle class="base" r="96"/>` +
    `<circle class="ring" r="${(lock * 0.55).toFixed(1)}"/>` +
    `<path class="axis" d="M${-lock} 0H-14M14 0H${lock}"/>` +
    `<path class="tick" d="M${-lock} -9V9M${lock} -9V9"/>` +
    `<path class="chev" d="M${-lock - 2} -5l-6 5 6 5M${lock + 2} -5l6 5-6 5"/>` +
    `<path class="up" d="M-6 ${-lock * 0.62}l6 -7 6 7"/>` +
    `<circle class="mid" r="4.5"/>` +
    `<path class="brakearc" d="${arc(88, 90, 52)}" pathLength="100"/><path class="brakearc" d="${arc(88, 90, 128)}" pathLength="100"/>` +
    `<path class="brakefill" d="${arc(88, 90, 52)}" pathLength="100" stroke-dasharray="0 100"/>` +
    `<path class="brakefill" d="${arc(88, 90, 128)}" pathLength="100" stroke-dasharray="0 100"/>` +
    `<path class="hand" d="${arc(trip + 8 * u, 62, 118)}"/>` +
    `<path class="handmark" d="M-6 ${(trip + 8 * u + 1).toFixed(1)}h12"/>`
  );
}
function iconButton(parent, name, label, onClick) {
  const b = button(parent, '', onClick, 'icon');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return b;
}

// ------------------------------------------------------------------ the rev arc

/** The arc's scale: 0 to SCALE_K thousand rpm (the limiter and a little more), red over the last 500 rpm before the limiter. */
const LIMITER = CAR.engine.limiter;
const SCALE_K = Math.ceil(LIMITER / 1000 + 0.25);
const RED_FROM = LIMITER - 500;
/** The arc: the upper part of a circle round the speed, from lower left over the top to lower right (SVG degrees). */
const A0 = 165;
const SWEEP = 210;
const R = 92;
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

function arcSvg() {
  const parts = [];
  parts.push(`<path class="track" d="${arcPath(A0, A0 + SWEEP, R)}"/>`);
  parts.push(`<path class="red" d="${arcPath(angleOf(RED_FROM), A0 + SWEEP, R)}"/>`);
  parts.push(`<path class="fill" pathLength="1000" stroke-dasharray="0 1000" d="${arcPath(A0, A0 + SWEEP, R)}"/>`);
  // a tick every thousand, cut through the bar
  for (let k = 1; k < SCALE_K; k++) {
    const deg = angleOf(k * 1000);
    const [x0, y0] = polar(deg, R - 9);
    const [x1, y1] = polar(deg, R + 9);
    parts.push(`<line class="cut" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`);
  }
  return parts.join('');
}

/** km/h to the units shown. */
const UNITS = { kmh: 1, mph: 1 / 1.609344 };

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
    this.units = 'kmh';

    // top left: the lap and the lap clock, on one plate; the best lap under it
    const lapBlock = make('div', 'lapblock plate', el);
    const lapLine = make('div', 'lapline', lapBlock);
    this.lapWord = cell('span', 'lapword', lapLine, TEXT.lap);
    this.lapNum = cell('span', 'lapnum', lapLine, '1');
    this.lapOf = cell('span', 'lapof', lapLine, '/3');
    const clockLine = make('div', 'clockline', lapBlock);
    this.clock = cell('span', 'clock', clockLine, '0:00.0');
    this.live = cell('span', 'live', clockLine);
    this.live.show(false);
    const bestLine = make('div', 'bestline', lapBlock);
    make('span', 'label', bestLine, TEXT.best);
    this.best = cell('span', 'besttime', bestLine, formatMs(null));

    // top right: the next time to beat (solo), or the place and the gap (split)
    this.next = cell('div', 'next plate', el);
    this.nextLabel = cell('span', 'label', this.next.el, TEXT.toBeat);
    this.nextTime = cell('span', 'time', this.next.el);
    this.nextTag = cell('span', 'tag', this.next.el);
    this.pos = cell('div', 'pos plate', el);
    this.posPlace = cell('span', 'place', this.pos.el);
    this.posGap = cell('span', 'gap', this.pos.el);
    this.pos.show(false);
    this._rowsKey = '';
    this._rows = [];
    this._clock = 0;

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

    // the upper middle, above the car: wrong way, the reset offer, the first-time hint
    this.warn = cell('div', 'warn', el, TEXT.wrongWay);
    this.warn.show(false);
    this.offer = cell('div', 'offer', el);
    this.offerWhy = cell('div', 'why', this.offer.el);
    this.offerButton = new Cell(button(this.offer.el, TEXT.resetKeys, () => act('reset', index)));
    this.offer.show(false);
    this.hint = cell('div', 'hint', el);
    this.hint.show(false);

    // bottom left: the map (it can be hidden)
    this.map = cell('div', 'map', el);
    this._dots = [];

    // bottom right: the speed in big figures under the rev arc, the gear beside it, the assists' lamps under it
    const cluster = make('div', 'cluster', el);
    this.clusterEl = cluster;
    const arc = make('svg:svg', 'arc', cluster);
    arc.setAttribute('viewBox', '0 0 200 134');
    arc.innerHTML = arcSvg();
    this.arc = new Cell(arc);
    this.fill = new Cell(arc.querySelector('.fill'));
    const readout = make('div', 'readout', cluster);
    this.gear = cell('div', 'gear', readout, 'N');
    this.speed = cell('div', 'speed', readout, '0');
    this.unit = cell('div', 'unit', readout, TEXT.kmh);
    const tells = make('div', 'tells', cluster);
    this.tell = {
      abs: cell('span', 'tell amber', tells, TEXT.lamps.abs),
      tc: cell('span', 'tell amber', tells, TEXT.lamps.tc),
      esc: cell('span', 'tell amber', tells, TEXT.lamps.esc),
      hand: cell('span', 'tell red round', tells, TEXT.lamps.hand),
      high: cell('span', 'tell blue beam', tells),
    };
    this.tell.high.el.innerHTML = `<svg viewBox="0 0 24 24" role="img" aria-label="${TEXT.lamps.high}">${ICONS.lights}</svg>`;

    // the drift readout (designed, not yet wired: the HANDLING lane's slide angle and score feed setDrift): over
    // the road above the car, only while the car slides beyond about 15 degrees, fading out after
    this.drift = cell('div', 'slide', el);
    this.driftAngle = cell('span', 'angle', this.drift.el, '0°');
    this.driftScore = cell('span', 'score', this.drift.el, '0');
    this._driftOn = false;

    // the touch controls, fixed (touch only): the steering at the bottom left (a slider with a marked centre, or two
    // arrows), the pedals at the bottom right, each with its word. Placed from Input's layoutOf(), the same numbers a
    // finger is found by; on the first touch run the steering is named too and all of them are outlined (setZoneHint)
    this.controls = cell('div', 'controls', el);
    const ctl = this.controls.el;
    const named = (c, name) => make('span', 'name', c.el, name);
    // the one-thumb pad: its glass base and marks (SVG), the knob over it
    this.stick = cell('div', 'stick', ctl);
    const base = make('svg:svg', 'face', this.stick.el);
    base.setAttribute('viewBox', '-112 -112 224 224');
    base.innerHTML = stickSvg();
    this.brakeFill = [...base.querySelectorAll('.brakefill')];
    this.stickKnob = make('i', 'knob', this.stick.el);
    named(this.stick, TEXT.pads.pad);
    this._stickKey = '';
    this.slider = cell('div', 'slider', ctl);
    make('b', 'rail', this.slider.el);
    make('b', 'mid', this.slider.el);
    this.knob = make('i', 'knob', this.slider.el);
    named(this.slider, TEXT.pads.steer);
    this.arrowL = cell('div', 'arrow left', ctl);
    this.arrowR = cell('div', 'arrow right', ctl);
    named(this.arrowL, TEXT.pads.steer);
    this.pedal = {};
    for (const name of ['brake', 'gas', 'drift']) {
      const c = cell('div', `pedal ${name}`, ctl);
      const icon = make('svg:svg', 'icon', c.el);
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.innerHTML = ICONS[name === 'drift' ? 'hand' : name];
      make('span', 'word', c.el, TEXT.pads[name]);
      this.pedal[name] = c;
    }
    this._ctlKey = '';
    this._knobKey = '';

    // the buttons: camera, lights, reset, pause, small and together (at a desk only pause shows)
    this.touchCol = cell('div', 'touchcol', el);
    iconButton(this.touchCol.el, 'camera', TEXT.buttons.camera, () => act('camera', index));
    iconButton(this.touchCol.el, 'lights', TEXT.buttons.lights, () => act('high', index));
    iconButton(this.touchCol.el, 'reset', TEXT.buttons.reset, () => act('reset', index));
    iconButton(this.touchCol.el, 'pause', TEXT.buttons.pause, () => act('pause', index));

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
    // 0.72 of a hundredth of a 16:9 picture's width: the figures are big enough for a phone at arm's length
    // and stay in the corners, clear of the car in the middle; an upright picture gets a little more
    const u = tall ? w / 62 : (Math.min(w, (h * 16) / 9) / 100) * 0.72;
    s.setProperty('--u', `${Math.max(3.6, Math.min(u, 10)).toFixed(2)}px`);
    this.cell.flag('tall', tall).flag('narrow', w < 700).flag('small', w < 460).flag('short', h < 330).flag('low', h < TOUCH.lowBelow).flag('thin', w < TOUCH.thinBelow).flag('squat', !tall && h < 450);
  }

  setVisible(on) {
    this.cell.show(on);
  }

  /** Split screen or not, and whether thumbs drive (the touch buttons show). */
  setMode(split, touch) {
    this.split = split;
    this.cell.flag('split', split).flag('touch', touch);
  }

  /** km/h or mph; whether the map shows. */
  setPrefs(units, map) {
    if (units !== this.units) {
      this.units = units;
      this.unit.text(units === 'mph' ? TEXT.mph : TEXT.kmh);
    }
    this.map.show(map);
  }

  // ---- timing

  setLap(lap, laps, finished) {
    const final = !finished && lap === laps && laps > 1;
    this.lapNum.text(Math.min(lap, laps));
    this.lapOf.text(`/${laps}`);
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
    // the banner and the line's gap share the top middle: the banner waits under the gap
    this.cell.flag('flashing', this._flashUntil >= 0);
  }

  /** Forget the moments of a run (a new run, back to the title). */
  clearMoments() {
    this._flashUntil = this._bannerUntil = -1;
    this.flash.show(false);
    this.banner.show(false);
    this._clock = 0;
  }

  // ---- the next time to beat, the place

  /**
   * The next time to beat on this time of day's board (the device's laps with the medal targets among them): the
   * slowest row still faster than this run's best lap (with no lap yet, the slowest row), as one line.
   * @param {{ laps: Array<{ ms: number }> }} table @param {Record<string, number>} medals @param {string} time
   * @param {number|null} mine this run's best lap
   */
  setBoard(table, medals, time, mine) {
    const solo = !this.split;
    this.next.show(solo);
    this.pos.show(!solo);
    if (!solo) return;
    let key = time;
    for (const l of table.laps) key += ',' + l.ms;
    if (key !== this._rowsKey) {
      this._rowsKey = key;
      this._rows = rowsOf(table, medals);
    }
    const rows = this._rows;
    let target = null;
    if (mine === null) target = rows[rows.length - 1];
    else for (const r of rows) if (r.ms < mine) target = r;
    this.next.flag('cleared', !target);
    this.nextLabel.text(target ? TEXT.toBeat : TEXT.allBeaten);
    this.nextTime.text(target ? formatMs(target.ms) : '');
    this.nextTag.text(target ? (target.medal ? TEXT.medal[target.medal] : TEXT.you) : '').attr('data-medal', target?.medal || '');
  }

  /** Split screen: the place, and the gap to the other car at the last line (ms, + = behind) or null. */
  setPosition(p, gap) {
    this.posPlace.text(TEXT.place(p)).flag('lead', p === 1);
    this.posGap.show(gap !== null);
    if (gap !== null) this.posGap.text(formatMs(gap, true).replace('-', '−')).flag('ahead', gap <= 0).flag('behind', gap > 0);
  }

  // ---- driving

  setSpeed(kmh) {
    this.speed.text(Math.round(Math.abs(kmh) * UNITS[this.units]));
  }

  /** The rev arc filled to `rpm`, red at the limiter; the gear beside the speed. */
  setRev(rpm, gear) {
    const f = Math.min(1, Math.round((Math.max(0, rpm) / (SCALE_K * 1000)) * 200) / 200);
    this.fill.attr('stroke-dasharray', `${Math.round(f * 1000)} 1000`);
    this.arc.flag('limit', rpm >= LIMITER - 150).flag('high', rpm >= RED_FROM - 300);
    this.gear.text(TEXT.gear(gear));
  }

  /** @param {{ abs: boolean, tc: boolean, esc: boolean, hand: boolean, high: boolean }} on */
  setTells(on) {
    for (const k in this.tell) this.tell[k].flag('on', on[k]);
  }

  /**
   * The drift readout: the slide angle (degrees) and the running score; `on` while the car slides beyond the
   * threshold. It fades out (CSS) when `on` goes false.
   */
  setDrift(angle, score, on) {
    this.drift.flag('on', on);
    if (!on && !this._driftOn) return;
    this._driftOn = on;
    this.driftAngle.text(`${Math.round(Math.abs(angle))}°`);
    this.driftScore.text(Math.round(score));
  }

  /**
   * The touch controls: where they are (Input's layoutOf, px from the view's top left), the steering the thumb asks
   * for (-1..1, or null: the knob at the centre) and which pedals are held.
   * @param {{ layout: object, steer: number|null, held: { brake: boolean, gas: boolean, drift: boolean } }} c
   */
  setControls(c) {
    const L = c.layout;
    const arrows = L.steering === 'arrows';
    const pad = !!L.pad;
    this.cell.flag('manual', !!L.gas).flag('pad', pad).flag('handleft', pad && L.hand === 'left');
    if (L.key !== this._ctlKey) {
      this._ctlKey = L.key;
      this._stickKey = this._knobKey = '';
      const place = (cellOf, x, y, w, h) => {
        const st = cellOf.el.style;
        st.left = `${(x - w / 2).toFixed(1)}px`;
        st.top = `${(y - h / 2).toFixed(1)}px`;
        st.width = `${w.toFixed(1)}px`;
        st.height = `${h.toFixed(1)}px`;
        writes++;
      };
      const vs = this.el.style;
      if (pad) {
        const p = L.pad;
        place(this.stick, p.cx, p.cy, 2 * p.r, 2 * p.r);
        this.stick.el.style.setProperty('--knob', `${p.knob.toFixed(1)}px`);
        // where the readouts may stand: above the pad on its side, above the handbrake button on the other (px from the view's bottom)
        const d = L.drift;
        const right = L.hand === 'right';
        vs.setProperty('--sticktop', `${(L.h - (p.cy - p.r)).toFixed(0)}px`);
        vs.setProperty('--stickside', `${(right ? L.w - (p.cx - p.r) : p.cx + p.r) + TOUCH.gap}px`);
        vs.setProperty('--handtop', `${(L.h - (d.y - d.r)).toFixed(0)}px`);
        vs.setProperty('--handside', `${(right ? d.x + d.r : L.w - (d.x - d.r)) + TOUCH.gap}px`);
      } else {
        const sl = L.slider;
        place(this.slider, sl.cx, sl.cy, 2 * (sl.half + sl.knob), 2 * sl.knob);
        this.slider.el.style.setProperty('--k', `${sl.knob}px`);
        this.slider.el.style.setProperty('--half', `${sl.half}px`);
        for (const [a, b] of [
          [this.arrowL, L.arrows.left],
          [this.arrowR, L.arrows.right],
        ])
          place(a, b.x, b.y, 2 * b.r, 2 * b.r);
      }
      this.stick.show(pad);
      this.slider.show(!pad && !arrows);
      this.arrowL.show(arrows);
      this.arrowR.show(arrows);
      for (const name of ['brake', 'gas', 'drift']) {
        const b = L[name];
        this.pedal[name].show(!!b);
        if (b) place(this.pedal[name], b.x, b.y, 2 * b.r, 2 * b.r);
      }
    }
    const v = c.steer;
    if (pad) {
      // the knob: where the thumb is (no further than the rim), clicked into the red arc while the handbrake is
      // pulled; with no thumb, back at the centre (an eased spring, hud.css), or across by the tilt
      const p = L.pad;
      const k = c.knob;
      let x = 0;
      let y = 0;
      if (k) {
        x = k.dx;
        y = k.dy;
        const len = Math.hypot(x, y);
        const most = p.r * 0.78;
        if (k.tripped) {
          // on the arc, no more than 28 degrees either side of straight down
          const a = Math.max(-0.49, Math.min(0.49, Math.atan2(x, Math.max(1, y))));
          const rr = (TOUCH.pad.trip + 8) * p.s; // (the red arc: stickSvg)
          x = rr * Math.sin(a);
          y = rr * Math.cos(a);
        } else if (len > most) {
          x *= most / len;
          y *= most / len;
        }
      } else if (c.tilt !== null && c.tilt !== undefined) x = c.tilt * TOUCH.pad.steer * p.s;
      const brake = k && !k.tripped ? Math.max(0, Math.min(1, (k.dy / (TOUCH.pad.brake * p.s) - TOUCH.pad.lift) / (1 - TOUCH.pad.lift))) : 0;
      const key = `${x.toFixed(1)},${y.toFixed(1)},${brake.toFixed(2)},${!!k}`;
      if (key !== this._stickKey) {
        this._stickKey = key;
        this.stickKnob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const dash = `${(brake * 100).toFixed(1)} 100`;
        for (const f of this.brakeFill) f.setAttribute('stroke-dasharray', dash);
        writes++;
      }
      this.stick.flag('held', !!k).flag('tripped', !!k && k.tripped).flag('braking', brake > 0);
    } else {
      // the slider's knob: where the thumb asks, at the centre when there is none
      const knob = `${arrows ? '' : v === null ? 0 : v.toFixed(3)}`;
      if (knob !== this._knobKey) {
        this._knobKey = knob;
        if (!arrows) this.knob.style.transform = `translateX(${((v || 0) * L.slider.half).toFixed(1)}px)`;
        writes++;
      }
      this.slider.flag('held', v !== null);
    }
    this.arrowL.flag('held', arrows && v !== null && v < 0);
    this.arrowR.flag('held', arrows && v !== null && v > 0);
    for (const name of ['brake', 'gas', 'drift']) this.pedal[name].flag('held', c.held[name]);
  }

  /** The touch controls stepped back (45 %, hud.css) while no finger is on them, a few seconds into a run. */
  setControlsDim(on) {
    this.controls.flag('dim', on);
  }

  /** The first-run naming of the touch controls. */
  setZoneHint(on) {
    this.controls.flag('naming', on);
  }

  setWarn(wrongWay) {
    this.warn.show(wrongWay);
    this._warned = wrongWay;
  }

  /** The reset offer: a reason code ('roof' | 'stuck' | 'wrong', or '' for none), and how to take it on this device. */
  setOffer(reason, how) {
    this.offer.show(!!reason);
    if (!reason) return;
    // the warning above already says it
    this.offerWhy.text(TEXT.offer[reason] || '').show(!(reason === 'wrong' && this._warned));
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
      c.setAttribute('r', i === this.index ? '7' : '5.5');
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

  dispose() {
    this.el.remove();
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

/** The board as HTML: a head and five rows, the device's best marked, a new lap (`mark`) lit. */
function boardHtml(table, medals, time, mark = null) {
  const own = table.laps.length ? table.laps[0].ms : null;
  let html = `<div class="head">${TEXT.boardTitle(TEXT.timeName(time))}</div>`;
  for (const row of rowsOf(table, medals)) {
    const isMark = !row.medal && row.ms === mark;
    const cls = `row${row.medal ? ' medal ' + row.medal : ''}${isMark ? ' new' : ''}${!row.medal && row.ms === own ? ' own' : ''}`;
    html +=
      `<div class="${cls}"><span class="rank">${row.medal ? '' : row.place}</span><span class="time">${formatMs(row.ms)}</span>` +
      `<span class="tag">${row.medal ? TEXT.medal[row.medal] : isMark || row.ms === own ? TEXT.you : ''}</span></div>`;
  }
  return html;
}

// ------------------------------------------------------------------ the options

/** A row of the options: a label and a segmented choice. Returns the buttons by value. */
function choiceRow(parent, label, values, names, onPick) {
  const row = make('div', 'optrow', parent);
  make('span', 'optlabel', row, label);
  const group = make('div', 'segment', row);
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const cells = new Map();
  values.forEach((v, i) => {
    const b = button(group, names[i], () => onPick(v), 'toggle');
    b.dataset.value = v;
    cells.set(v, new Cell(b));
  });
  return { row, group, cells };
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

    // the title: the menu beside the car on a wide screen, under it on an upright one
    this.title = cell('div', 'panel title', root);
    const t = this.title.el;
    make('h1', 'name', t, TEXT.name);
    make('p', 'tagline', t, TEXT.tagline);
    const choose = make('div', 'buttons', t);
    this.driveButton = button(choose, TEXT.drive, () => this.act('start'), 'primary');
    this.splitButton = new Cell(button(choose, TEXT.twoPlayers, () => this.act(this._mode === 'split' ? 'solo' : 'split'), 'toggle'));
    // the time of day: one button per time lighting.js has, the one showing pressed (made in setState)
    this.timeChoice = make('div', 'segment timechoice', t);
    this.timeChoice.setAttribute('role', 'group');
    this.timeChoice.setAttribute('aria-label', TEXT.timeOfDay);
    /** @type {Map<string, Cell>} */
    this.timeButtons = new Map();
    button(make('div', 'buttons small', t), TEXT.options, () => this.openOptions(), 'opt-open');
    this.titleBoard = cell('div', 'boardlist titleboard', t);
    this.legend = cell('dl', 'legend', t);
    this._legendKey = '';
    this._boardKey = '';

    // pause
    this.pause = cell('div', 'panel center pause', root);
    make('h2', '', this.pause.el, TEXT.paused);
    const prow = make('div', 'buttons column', this.pause.el);
    this.resumeButton = button(prow, TEXT.resume, () => this.act('pause'), 'primary');
    button(prow, TEXT.restart, () => this.act('again'));
    // tilt steering: straight ahead is wherever the device is when this is pressed
    this.recentreButton = new Cell(button(prow, TEXT.recentre, () => this.act('recentre')));
    button(prow, TEXT.options, () => this.openOptions(), 'opt-open');
    button(prow, TEXT.menu, () => this.act('leave'));
    this.pauseBoard = cell('div', 'boardlist', this.pause.el);
    this.pause.show(false);

    // the options: quality, sound, time of day, units, map; the same sheet from the title and from pause
    this.options = cell('div', 'panel center options', root);
    make('h2', '', this.options.el, TEXT.options);
    const o = this.options.el;
    this.optQuality = choiceRow(o, TEXT.quality, ['auto', 'low', 'medium', 'high'], TEXT.qualities, (v) => this.act(`quality:${v}`));
    this.qualityNote = cell('div', 'optnote', o);
    this.optSound = choiceRow(o, TEXT.sound, ['on', 'off'], [TEXT.on, TEXT.off], (v) => this.act(v === 'on' ? 'sound:on' : 'sound:off'));
    this.optTime = choiceRow(o, TEXT.timeOfDay, [], [], () => {});
    // the driving help (one button per ASSISTS level, made in setState) and, on touch, the throttle
    this.optAssists = choiceRow(o, TEXT.drivingHelp, [], [], () => {});
    this.optSteering = choiceRow(o, TEXT.steering, ['pad', 'slider', 'arrows', 'tilt'], [TEXT.pad, TEXT.slider, TEXT.arrows, TEXT.tilt], (v) => this.act(`steering:${v}`));
    this.steeringNote = cell('div', 'optnote', o);
    this.optHand = choiceRow(o, TEXT.hand, ['right', 'left'], [TEXT.right, TEXT.left], (v) => this.act(`hand:${v}`));
    this.optThrottle = choiceRow(o, TEXT.throttle, ['auto', 'manual'], [TEXT.auto, TEXT.manual], (v) => this.act(`throttle:${v}`));
    this.optUnits = choiceRow(o, TEXT.units, ['kmh', 'mph'], [TEXT.kmh, TEXT.mph], (v) => this.act(`units:${v}`));
    this.optMap = choiceRow(o, TEXT.map, ['on', 'off'], [TEXT.shown, TEXT.hidden], (v) => this.act(`map:${v}`));
    this.closeButton = button(make('div', 'buttons', o), TEXT.done, () => this.closeOptions(), 'primary');
    this.options.show(false);
    this.optionsOpen = false;

    // results: beside the car
    this.results = cell('div', 'panel results', root);
    make('h2', '', this.results.el, TEXT.results);
    this.resultsBody = make('div', 'body', this.results.el);
    const rrow = make('div', 'buttons', this.results.el);
    this.againButton = button(rrow, TEXT.again, () => this.act('again'), 'primary');
    button(rrow, TEXT.menu, () => this.act('leave'));
    this.results.show(false);

    this._state = '';
    this._s = null;
    this._mode = 'solo';
    this._results = '';
  }

  /**
   * The safe area's left, right and bottom insets in CSS px (where the touch controls stand inside), measured on
   * every layout (they change when the device is turned). Read through the HUD's own --sl, --sr, --sb, so that what
   * the CSS places and what the controls are placed by agree.
   */
  insets() {
    const probe = make('div', '', this.root);
    probe.style.cssText = 'position:absolute;visibility:hidden;padding-left:var(--sl);padding-right:var(--sr);padding-bottom:var(--sb)';
    const cs = getComputedStyle(probe);
    const out = { left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
    probe.remove();
    return out;
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

  /** Open the options sheet over the title or the pause sheet. */
  openOptions() {
    this.optionsOpen = true;
    this._state = '';
    if (this._s) this.setState(this._s);
    const on = this.options.el.querySelector('button.on') || this.closeButton;
    if (!this._touch) on.focus({ preventScroll: true });
  }

  closeOptions() {
    this.optionsOpen = false;
    this._state = '';
    if (this._s) this.setState(this._s);
    if (!this._touch) (this._s && this._s.phase === 'title' ? this.driveButton : this.resumeButton).focus({ preventScroll: true });
  }

  /** The panel that has the keys and the pad now, or null. */
  _activePanel() {
    if (this.optionsOpen && !this.options.el.hidden) return this.options.el;
    for (const p of [this.pause, this.results, this.title]) if (!p.el.hidden) return p.el;
    return null;
  }

  /**
   * A pad's (or the arrows') move through the open panel: dir 'up' | 'down' | 'left' | 'right'. Returns whether
   * a panel took it.
   */
  navigate(dir) {
    const panel = this._activePanel();
    if (!panel) return false;
    const list = [...panel.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    if (!list.length) return false;
    const now = document.activeElement;
    const i = list.indexOf(now);
    if (i < 0) {
      list[0].focus({ preventScroll: true });
      return true;
    }
    // up and down move between rows (the nearest button above or below), left and right along them
    const r = now.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    for (const b of list) {
      if (b === now) continue;
      const q = b.getBoundingClientRect();
      const dx = q.left + q.width / 2 - (r.left + r.width / 2);
      const dy = q.top + q.height / 2 - (r.top + r.height / 2);
      const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 && Math.abs(dy) < r.height : dx > 4 && Math.abs(dy) < r.height;
      if (!ok) continue;
      const d = dir === 'up' || dir === 'down' ? Math.abs(dy) * 4 + Math.abs(dx) : Math.abs(dx);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    (best || now).focus({ preventScroll: true });
    return true;
  }

  /** The pad's A on a focused button of the open panel: press it. Returns whether it did. */
  pressFocused() {
    const panel = this._activePanel();
    const now = document.activeElement;
    if (!panel || !(now instanceof HTMLButtonElement) || !panel.contains(now)) return false;
    now.click();
    return true;
  }

  /**
   * Which panels show, and the words on their toggles.
   * @param {{ phase: string, paused: boolean, mode: string, time: string, times: string[], muted: boolean, device: string,
   *   attract: boolean, quality: string, tier: string, qualityFixed: boolean, units: string, map: boolean, canSound: boolean }} s
   */
  setState(s) {
    const times = s.times || [s.time];
    const key = `${s.phase}|${s.paused}|${s.mode}|${s.time}|${s.muted}|${s.device}|${s.attract}|${times.join(',')}|${s.quality}|${s.tier}|${s.units}|${s.map}|${s.assists}|${s.throttle}|${s.steering}|${s.hand}|${s.tiltNote}|${this.optionsOpen}`;
    this._s = s;
    if (key === this._state) return;
    const [wasPhase, wasPaused] = this._state.split('|');
    this._state = key;
    this._mode = s.mode;
    writes++;
    const title = s.phase === 'title';
    const touch = s.device === 'touch';
    this._touch = touch;
    // the options close by themselves when there is nothing left to come back to
    if (this.optionsOpen && !title && !s.paused) this.optionsOpen = false;
    const opts = this.optionsOpen;
    this.title.show(title && !opts).flag('attract', s.attract);
    this.pause.show(s.paused && !title && !opts);
    this.options.show(opts);
    this.results.show(s.phase === 'results' && !s.paused).flag('split', s.mode === 'split');
    this.root.classList.toggle('attract', s.attract);
    this.splitButton.text(s.mode === 'split' ? TEXT.onePlayer : TEXT.twoPlayers);
    // the time of day, on the title and in the options: in lighting.js's order, only the times it has now
    for (const [group, map] of [
      [this.timeChoice, this.timeButtons],
      [this.optTime.group, this.optTime.cells],
    ]) {
      for (const name of times) {
        if (map.has(name)) continue;
        const b = button(group, TEXT.timeName(name), () => this.act(`time:${name}`), 'toggle');
        map.set(name, new Cell(b));
      }
      for (const name of times) group.appendChild(map.get(name).el);
      for (const [name, b] of map) b.show(times.includes(name)).flag('on', name === s.time).attr('aria-pressed', name === s.time);
    }
    const pick = (row, value) => {
      for (const [v, b] of row.cells) b.flag('on', v === value).attr('aria-pressed', v === value);
    };
    for (const id of s.assistLevels || []) {
      if (this.optAssists.cells.has(id)) continue;
      const b = button(this.optAssists.group, TEXT.assistName(id), () => this.act(`assists:${id}`), 'toggle');
      b.dataset.value = id;
      this.optAssists.cells.set(id, new Cell(b));
    }
    pick(this.optAssists, s.assists);
    pick(this.optThrottle, s.throttle);
    this.optThrottle.row.hidden = !touch;
    pick(this.optSteering, s.steering);
    this.optSteering.row.hidden = !touch;
    // under the steering: what the choice does, or why tilt is not steering
    const note = s.tiltNote ? TEXT.tiltNote[s.tiltNote] : TEXT.steeringNote[s.steering] || '';
    this.steeringNote.text(note).show(touch && !!note);
    pick(this.optHand, s.hand);
    // (the hand places the pad: tilt uses it too)
    this.optHand.row.hidden = !touch || !(s.steering === 'pad' || s.steering === 'tilt');
    this.recentreButton.show(touch && s.steering === 'tilt');
    pick(this.optQuality, s.quality);
    pick(this.optSound, s.muted ? 'off' : 'on');
    pick(this.optUnits, s.units);
    pick(this.optMap, s.map ? 'on' : 'off');
    this.optSound.row.hidden = !s.canSound;
    this.qualityNote.text(s.qualityFixed ? TEXT.qualityFixed(s.tier) : TEXT.qualityNow(s.tier));
    for (const v of this.views) {
      v.setVisible(!title);
      v.setMode(s.mode === 'split', touch);
      v.setPrefs(s.units, s.map);
      v.cell.flag('done', s.phase === 'results');
      if (title || (s.phase === 'countdown' && wasPhase !== 'countdown')) v.clearMoments();
    }
    this._legend(s.mode === 'split' && !touch ? 'split' : s.device);
    this.title.flag('touch', touch);
    // a panel that has just opened takes the focus on its first button, so that the keys can work it
    const active = document.activeElement;
    const free = !active || active === document.body;
    if (!touch && free && s.paused && wasPaused !== 'true' && !opts) this.resumeButton.focus({ preventScroll: true });
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

  /** The best-laps board of the time of day showing, on the title and on the pause sheet. */
  setBoard(table, medals, time) {
    let key = time;
    for (const l of table.laps) key += ',' + l.ms;
    if (key === this._boardKey) return;
    this._boardKey = key;
    const html = boardHtml(table, medals, time);
    this.titleBoard.el.innerHTML = html;
    this.pauseBoard.el.innerHTML = html;
    writes += 2;
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
        const slide = d.slide >= 1 ? `<div class="slideline">${TEXT.bestSlide} <b>${Math.round(d.slide)}</b></div>` : '';
        const medal = d.medal
          ? `<span class="award ${d.medal}"><i></i>${TEXT.medalWon(TEXT.medal[d.medal])}</span>`
          : `<span class="award none">${TEXT.noMedal}</span>`;
        return (
          `<div class="col">${head}<table>${laps}<tr class="total"><td>${TEXT.total}</td>` +
          `<td class="t">${d.finished ? formatMs(d.total) : '—'}</td><td></td></tr></table><div class="medalline">${medal}</div>${slide}</div>`
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
    html += `<div class="boardlist">${boardHtml(r.table, r.medals, r.time, r.mark)}</div>`;
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
