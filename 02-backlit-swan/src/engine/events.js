// A very small event emitter, for the few things that parts of the scene tell
// each other about without knowing who is listening ('drop', 'billEnter', ...).

/**
 * @returns {{
 *   on: (name: string, fn: (payload?: any) => void) => () => void,
 *   off: (name: string, fn: Function) => void,
 *   emit: (name: string, payload?: any) => void,
 * }} `on` returns a function that removes the listener again.
 */
export function createEvents() {
  const listeners = new Map();
  const off = (name, fn) => {
    const list = listeners.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => off(name, fn);
    },
    off,
    emit(name, payload) {
      const list = listeners.get(name);
      if (!list) return;
      // a copy, so that a listener may remove itself while being called
      for (const fn of list.slice()) fn(payload);
    },
  };
}
