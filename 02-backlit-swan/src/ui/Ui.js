// The HTML overlay. STUB. Later: the few on-screen controls (actions for the
// swan, aperture and time, a way to hide everything), laid out for a thumb on
// a phone and for a pointer on a desktop.
//
// For now it owns one thing: the veil over the canvas, which fades away once
// the first frame has been drawn.

import './ui.css';

/**
 * @param {object|null} ctx the shared context (see World.js); null if the scene could not start
 * @param {{ root?: HTMLElement, enabled?: boolean, instant?: boolean }} [options]
 *   `enabled: false` (?ui=0): no controls. `instant`: the veil goes at once
 *   instead of fading (used when frames are stepped by hand, so that a
 *   screenshot taken right after never catches it half gone).
 * @returns {{ ready: () => void, fail: (message: string) => void, update: (dt: number, time: number) => void, dispose: () => void }}
 */
export function createUi(ctx, { root = document.body, enabled = true, instant = false } = {}) {
  void ctx;
  void root;
  const veil = document.getElementById('loading');
  return {
    /** The first frame is on the screen. */
    ready() {
      if (!veil) return;
      if (instant || !enabled) {
        veil.remove();
        return;
      }
      veil.classList.add('done');
      veil.addEventListener('transitionend', () => veil.remove(), { once: true });
    },
    /** The scene could not start: say why, in place of the loading mark. */
    fail(message) {
      if (veil) veil.textContent = message;
    },
    update() {},
    dispose() {
      if (veil) veil.remove();
    },
  };
}
