// Camera direction. STUB. Later: the opening move, the staged views of the
// film (wide portrait, the slow push in, the low side view with the meadow),
// following the swan as it swims, and handing the camera back and forth
// between the director and the person's own orbiting.

/**
 * @param {object} ctx the shared context (see World.js)
 * @param {{ rig: import('../engine/OrbitRig.js').OrbitRig, mind: import('./SwanMind.js').SwanMind|null }} parts
 * @returns {{ update: (dt: number, time: number) => void, dispose: () => void }}
 */
export function createDirector(ctx, { rig, mind }) {
  void ctx;
  void rig;
  void mind;
  return {
    update() {},
    dispose() {},
  };
}
