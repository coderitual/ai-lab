// What a person can do to the scene. STUB. Later: tap or click the water to
// call the swan there (ctx.events 'tap', SwanMind.callTo), drag to orbit, pinch
// or wheel to zoom, and the keys that go with the on-screen controls.

/**
 * @param {object} ctx the shared context (see World.js)
 * @param {{ domElement: HTMLElement, camera: import('three').Camera, rig: import('../engine/OrbitRig.js').OrbitRig, mind: import('./SwanMind.js').SwanMind|null }} parts
 * @returns {{ update: (dt: number, time: number) => void, dispose: () => void }}
 */
export function createInteraction(ctx, { domElement, camera, rig, mind }) {
  void ctx;
  void domElement;
  void camera;
  void rig;
  void mind;
  return {
    update() {},
    dispose() {},
  };
}
