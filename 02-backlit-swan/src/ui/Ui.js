// The overlay: the few controls laid over the picture.
//
// Bottom left, under the left thumb: the stick that swims the swan. Bottom
// right, under the other (bottom middle on a wide screen): what the swan can
// be asked to do (shake, dunk, reach) and the film again. Top right: slow
// motion, sound, the look panel, and hiding all of this. The look panel has
// the sliders for the light, the lens and the print, the views, and the
// quality setting.
//
// Everything is plain DOM built here, with the icons drawn as small inline
// SVGs: no images, no fonts to fetch. Buttons are at least 44 px across, the
// stick at least 104, and all of it keeps clear of the notch and the home bar
// (safe-area insets in ui.css).

import './ui.css';
import { LOOK, SIM } from '../scene/config.js';
import { VIEWS } from '../scene/Director.js';
import { KEYS } from '../scene/Interaction.js';

const SVG = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  // three drops flung sideways
  shake: SVG('<path d="M5 6.5c1.6 2 2.4 3.3 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1.100.8-2.400 2.400-4.400z"/><path d="M13 3.500c1.300 1.600 2 2.700 2 3.600a2 2 0 0 1-4 0c0-.9.700-2 2-3.600z"/><path d="M18.500 11c1.400 1.800 2.100 3 2.100 4a2.100 2.100 0 0 1-4.200 0c0-1 .7-2.200 2.100-4z"/><path d="M4 19.500h16"/>'),
  // the neck curled over, bill to the water
  dunk: SVG('<path d="M7 20V10a5 5 0 0 1 10 0v3"/><path d="M14.500 10.500 17 13l2.500-2.500"/><path d="M3 20c1.500-1.200 3-1.200 4.500 0s3 1.200 4.500 0 3-1.200 4.500 0 3 1.200 4.500 0"/>'),
  // a long low arch forward
  reach: SVG('<path d="M4 18V12a4 4 0 0 1 4-4c6 0 9 4 12 9"/><path d="M16.200 16.800 20 17l.300-3.800"/><path d="M3 21h18"/>'),
  film: SVG('<path d="M8 5.500v13l11-6.500z" fill="currentColor" stroke="none"/><path d="M4.500 5v14"/>'),
  sound: SVG('<path d="M4 10v4h3l4 3.500v-11L7 10z"/><path d="M15 9.500a3.500 3.500 0 0 1 0 5"/><path d="M17.500 7a7 7 0 0 1 0 10"/>'),
  mute: SVG('<path d="M4 10v4h3l4 3.500v-11L7 10z"/><path d="m15.500 9.500 5 5m0-5-5 5"/>'),
  look: SVG('<path d="M5 7h9m4 0h1M5 12h2m4 0h8M5 17h7m4 0h3"/><circle cx="16" cy="7" r="1.800"/><circle cx="9" cy="12" r="1.800"/><circle cx="14" cy="17" r="1.800"/>'),
  hide: SVG('<path d="M2.500 12s3.500-6 9.500-6 9.500 6 9.500 6-3.500 6-9.500 6-9.500-6-9.500-6z"/><circle cx="12" cy="12" r="2.600"/>'),
  close: SVG('<path d="m6 6 12 12M18 6 6 18"/>'),
};

/** The stick's face: four small arrowheads at the rim, the one for "away" a little stronger. */
const STICK_FACE = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m45 13.500 5-5 5 5" opacity="0.9"/><path d="m86.500 45 5 5-5 5M55 86.500l-5 5-5-5M13.500 55l-5-5 5-5" opacity="0.5"/></svg>`;

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

/** The sliders of the look panel: label, key of LOOK, range. */
const SLIDERS = [
  ['Sun, round', 'sunAzimuth', -60, 90, 1],
  ['Sun, height', 'sunElevation', 16, 62, 1],
  ['Aperture', 'aperture', 0, 1, 0.01],
  ['Glow', 'bloomStrength', 0, 0.6, 0.01],
  ['Exposure', 'exposure', 0.4, 2.2, 0.01],
  ['Print', 'print', 0, 1, 0.01],
];

/**
 * @param {object|null} ctx the shared context (see World.js); null if the scene could not start
 * @param {{ world?: object, enabled?: boolean, instant?: boolean }} [options]
 *   `world`: the World, for its mind, director, ambience and engine.
 *   `enabled: false` (?ui=0): no controls. `instant`: the veil goes at once
 *   instead of fading (used when frames are stepped by hand, so that a
 *   screenshot taken right after never catches it half gone).
 * @returns {{ ready: () => void, fail: (message: string, detail?: string, onTap?: (() => void)|null) => void, update: (dt: number, time: number) => void, dispose: () => void }}
 */
export function createUi(ctx, { world = null, enabled = true, instant = false } = {}) {
  const veil = document.getElementById('loading');
  const offs = [];
  let root = null;
  let hintTimer = 0;
  let hintGone = false;
  let panelOpen = false;
  let failed = false;
  let refresh = () => {};

  if (ctx && world && enabled) {
    const { mind, director, ambience, engine } = world;
    const defaults = Object.fromEntries(SLIDERS.map(([, key]) => [key, LOOK[key]]));
    root = el('div', 'ui');
    root.id = 'ui';

    // ---- title and hint
    const head = el('div', 'ui-head');
    head.append(el('h1', 'ui-title', 'Backlit Swan'));
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const hint = el('p', 'ui-hint', coarse ? 'The stick swims the swan · drag to look round · pinch to come closer · touch the water' : 'W A S D or the stick to swim · drag to look round · scroll to come closer · click the water');
    head.append(hint);
    root.append(head);

    const button = (className, icon, label, title, onPress) => {
      const b = el('button', className, `${ICONS[icon] || ''}${label ? `<span>${label}</span>` : ''}`);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      const press = () => {
        onPress(b);
        b.blur();
      };
      // A browser only turns a touch into a click when it is the one finger
      // on the glass, and here a thumb may be holding the stick. So a finger
      // that lifts off the button it came down on presses it there and then,
      // and the click that follows (if one does) is let pass.
      let pressedAt = -1e9;
      b.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        const r = b.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        pressedAt = e.timeStamp;
        press();
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.timeStamp - pressedAt < 700) return;
        press();
      });
      return b;
    };

    // ---- the stick: swims the swan
    const stick = el('div', 'ui-stick', `${STICK_FACE}<div class="ui-stick-knob"></div>`);
    stick.title = 'Swim (W A S D)';
    stick.setAttribute('role', 'img');
    stick.setAttribute('aria-label', 'Stick: drag it to swim the swan that way (or hold W A S D)');
    const interaction = world.interaction;
    let stickPointer = null; // the finger (or mouse) that has it
    let shownX = 0;
    let shownY = 0;
    /** Put the knob at x (right), y (up), each -1..1 of its travel, and tell the scene. */
    const pushStick = (x, y, tell = true) => {
      shownX = x;
      shownY = y;
      // ui.css turns these into the knob's place
      stick.style.setProperty('--sx', x.toFixed(3));
      stick.style.setProperty('--sy', (-y).toFixed(3));
      if (tell && interaction) interaction.setStick(x, y);
    };
    const dragStick = (e) => {
      const r = stick.getBoundingClientRect();
      // the knob is 40 % of the base and stays inside it: 30 % of the base is its travel (ui.css)
      const travel = r.width * 0.3;
      let x = (e.clientX - (r.left + r.width / 2)) / travel;
      let y = -(e.clientY - (r.top + r.height / 2)) / travel;
      const far = Math.hypot(x, y);
      if (far > 1) {
        x /= far;
        y /= far;
      }
      pushStick(x, y);
    };
    /** The stick springs back. With an event: only if it is from the finger that has it. */
    const dropStick = (e) => {
      if (e && e.pointerId !== stickPointer) return;
      stickPointer = null;
      stick.classList.remove('held', 'on');
      pushStick(0, 0);
    };
    stick.addEventListener('pointerdown', (e) => {
      if (stickPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      stickPointer = e.pointerId;
      // its own finger, wherever that goes: the rest of the glass stays free
      // for the other hand (the camera, the buttons)
      try {
        stick.setPointerCapture(e.pointerId);
      } catch {
        // a pointer that is already gone cannot be captured: nothing to do
      }
      stick.classList.add('held', 'on');
      dragStick(e);
      dropHint();
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickPointer) dragStick(e);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, dropStick);
    stick.addEventListener('contextmenu', (e) => e.preventDefault());
    root.append(stick);

    // ---- what the swan does
    const actions = el('div', 'ui-actions');
    actions.append(
      button('ui-act', 'shake', 'Shake', 'Shake the water off (Space)', () => mind && mind.act('shake')),
      button('ui-act', 'dunk', 'Dunk', 'Dunk the bill (E)', () => mind && mind.act('dunk')),
      button('ui-act', 'reach', 'Reach', 'Reach forward and feed (R)', () => mind && mind.act('reach')),
      button('ui-act', 'film', 'Film', 'Play the film again (F)', () => director && director.replay()),
    );
    root.append(actions);

    // ---- tools
    const tools = el('div', 'ui-tools');
    const slow = button('ui-tool ui-text', '', '¼×', 'Slow motion (T)', () => toggleSlow());
    const sound = button('ui-tool', 'mute', '', 'Sound (M)', () => toggleSound());
    const look = button('ui-tool', 'look', '', 'The look', () => togglePanel());
    const hide = button('ui-tool', 'hide', '', 'Hide the controls (H)', () => toggleHidden());
    tools.append(slow, sound, look, hide);
    root.append(tools);

    function toggleSlow() {
      SIM.timeScale = SIM.timeScale < 0.99 ? 1 : 0.25;
      slow.classList.toggle('on', SIM.timeScale < 0.99);
      slow.setAttribute('aria-pressed', String(SIM.timeScale < 0.99));
    }
    function toggleSound() {
      if (!ambience) return;
      ambience.setEnabled(!ambience.enabled);
      sound.innerHTML = ambience.enabled ? ICONS.sound : ICONS.mute;
      sound.classList.toggle('on', ambience.enabled);
      sound.setAttribute('aria-pressed', String(ambience.enabled));
    }
    function toggleHidden() {
      const hidden = !root.classList.contains('hidden');
      dropStick(); // it may be about to go out of reach
      root.classList.toggle('hidden', hidden);
      if (hidden && panelOpen) togglePanel();
      hide.title = hidden ? 'Show the controls (H)' : 'Hide the controls (H)';
      hide.setAttribute('aria-label', hide.title);
    }

    // ---- the look panel
    const panel = el('div', 'ui-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'The look');
    panel.hidden = true;
    const top = el('div', 'ui-panel-top');
    top.append(el('h2', '', 'The look'), button('ui-x', 'close', '', 'Close', () => togglePanel()));
    panel.append(top);
    const inputs = [];
    for (const [label, key, min, max, step] of SLIDERS) {
      const row = el('label', 'ui-row');
      const input = el('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(LOOK[key]);
      input.addEventListener('input', () => {
        LOOK[key] = parseFloat(input.value);
      });
      row.append(el('span', '', label), input);
      panel.append(row);
      inputs.push([input, key]);
    }
    refresh = () => {
      for (const [input, key] of inputs) input.value = String(LOOK[key]);
    };

    const views = el('div', 'ui-chips');
    views.append(el('span', 'ui-chips-label', 'View'));
    for (const [name, v] of Object.entries(VIEWS)) {
      views.append(button('ui-chip', '', name === 'film' ? 'Film' : name.charAt(0).toUpperCase() + name.slice(1), v.label, () => director && director.view(name)));
    }
    panel.append(views);

    const quality = el('div', 'ui-chips');
    quality.append(el('span', 'ui-chips-label', 'Quality'));
    const current = ctx.params && ctx.params.quality ? ctx.params.quality : 'auto';
    for (const q of ['auto', 'low', 'medium', 'high']) {
      const chip = button('ui-chip', '', q.charAt(0).toUpperCase() + q.slice(1), `Quality: ${q} (reloads the page)`, () => {
        const url = new URL(location.href);
        if (q === 'auto') url.searchParams.delete('q');
        else url.searchParams.set('q', q);
        location.href = url.toString();
      });
      if (q === current) chip.classList.add('on');
      quality.append(chip);
    }
    panel.append(quality);

    const foot = el('div', 'ui-panel-foot');
    foot.append(
      button('ui-chip', '', 'Reset', 'Put the look back as the film has it', () => {
        Object.assign(LOOK, defaults);
        refresh();
      }),
    );
    const stat = el('span', 'ui-stat', '');
    foot.append(stat);
    panel.append(foot);
    // Which paths this device took: on a phone there is nowhere else to read them.
    const info = el('p', 'ui-stat ui-info', '');
    panel.append(info);

    if (!coarse) {
      const keys = el('p', 'ui-keys', KEYS.map(([k, what]) => `<kbd>${k}</kbd> ${what}`).join(' &nbsp; '));
      panel.append(keys);
    }
    root.append(panel);

    function togglePanel() {
      panelOpen = !panelOpen;
      dropStick(); // on a phone the sheet covers it
      panel.hidden = !panelOpen;
      root.classList.toggle('panel-open', panelOpen);
      look.classList.toggle('on', panelOpen);
      if (panelOpen) refresh();
    }

    // controls must not move the camera or drop things in the pond
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'dblclick', 'touchstart']) {
      root.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }

    const dropHint = () => {
      if (hintGone) return;
      hintGone = true;
      hint.classList.add('gone');
    };
    const canvas = engine.renderer.domElement;
    canvas.addEventListener('pointerdown', dropHint, { passive: true });
    offs.push(() => canvas.removeEventListener('pointerdown', dropHint));

    offs.push(
      ctx.events.on('key', ({ name }) => {
        if (name === 'slow') toggleSlow();
        if (name === 'sound') toggleSound();
        if (name === 'hide') toggleHidden();
      }),
    );
    // a cut (the film starting again) is covered by a quick dip to black
    offs.push(
      ctx.events.on('cut', () => {
        canvas.style.transition = 'none';
        canvas.style.opacity = '0';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            canvas.style.transition = 'opacity 0.7s ease';
            canvas.style.opacity = '1';
          }),
        );
      }),
    );

    let sinceStat = 0;
    root._tick = (dt) => {
      // with the keys doing the swimming, the stick shows what they ask for
      if (stickPointer === null && interaction) {
        const { x, y } = interaction.steering;
        if (x !== shownX || y !== shownY) {
          pushStick(x, y, false);
          stick.classList.toggle('on', x !== 0 || y !== 0);
        }
      }
      if (!hintGone) {
        hintTimer += dt;
        if (hintTimer > 14) dropHint();
      }
      if (panelOpen) {
        sinceStat += dt;
        if (sinceStat > 0.5) {
          sinceStat = 0;
          const fps = engine.frameMs ? Math.round(1000 / engine.frameMs) : 0;
          stat.textContent = `${world.tier} · ${Math.round(engine.targetWidth)}×${Math.round(engine.targetHeight)} · ${fps} fps`;
          const { caps } = ctx;
          const samples = world.post.sceneTarget.samples;
          info.textContent = [
            caps.gpu || 'GPU not named',
            caps.hdr ? 'half-float' : '8-bit',
            samples > 0 ? `${samples}× multisampled` : caps.hdr && !caps.msaaHdr ? 'multisampling refused' : 'not multisampled',
            `ripples ${world.ripple.precision}`,
            `pixel ratio ${Math.round(engine.pixelRatio * 100) / 100}`,
            `render scale ${engine.renderScale}`,
            world.startError ? `WebGL error 0x${world.startError.toString(16)} at start` : '',
          ]
            .filter(Boolean)
            .join(' · ');
        }
      }
    };
    // iOS Safari zooms the whole page when two fingers spread on anything that
    // does not forbid it (it ignores user-scalable=no), and with the canvas
    // taking every pinch for the camera there would be no easy way back.
    // gesturestart is Safari's own event; other browsers obey touch-action (ui.css).
    const noZoom = (e) => e.preventDefault();
    document.addEventListener('gesturestart', noZoom, { passive: false });
    offs.push(() => document.removeEventListener('gesturestart', noZoom));
    document.body.append(root);
  }

  return {
    /** The first frame is on the screen. */
    ready() {
      if (root) root.classList.add('ready');
      // a failure reported while the first frame was drawn stays on the page
      if (!veil || failed) return;
      if (instant || !enabled) {
        veil.remove();
        return;
      }
      veil.classList.add('done');
      veil.addEventListener('transitionend', () => !failed && veil.remove(), { once: true });
    },
    /**
     * Something is wrong: say what over the picture, where the loading mark
     * was (it is put back if it has already gone, and stays).
     * @param {string} message
     * @param {string} [detail] small print, such as a graphics driver's own words
     * @param {(() => void)|null} [onTap] makes the whole notice a button
     */
    fail(message, detail = '', onTap = null) {
      failed = true;
      if (!veil) return;
      veil.classList.remove('done');
      veil.textContent = message;
      if (detail) {
        const small = document.createElement('small');
        small.textContent = detail;
        veil.append(small);
      }
      if (onTap) veil.addEventListener('click', onTap, { once: true });
      if (!veil.isConnected) document.body.append(veil);
    },
    update(dt) {
      if (root && root._tick) root._tick(dt);
    },
    dispose() {
      for (const off of offs) off();
      if (root) root.remove();
      if (veil) veil.remove();
    },
  };
}
