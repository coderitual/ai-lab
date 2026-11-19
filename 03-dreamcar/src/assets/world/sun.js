// The sun, or at night the moon: one DirectionalLight and its shadow, and the
// HemisphereLight that is the table's `ambient` fill. Always the same two
// lights: the time of day changes their colours and strengths, never their
// number, so no shader is compiled again when it changes.
//
// The shadow is one map that follows each view. Five things make it hold up
// under a sun 16 degrees high:
//  - (render lane) It is no taller in the light's view than the ground of the
//    square needs: reach x sin(height) plus what stands on it. Under a low sun
//    a square map wastes most of its rows on ground far beyond the square;
//    cut to size, the same map is two to three times finer along the ground
//    towards the sun, and the car's shadow gets a crisp outline.
//  - It covers a square of the light's own view, a little ahead of the car in
//    the direction the camera looks. A low light looks along the ground, so
//    that square is a long strip of country towards the sun: the trees whose
//    shadows cross the road are all in it.
//  - Its centre moves in whole texels of the map. A map that slides by a
//    fraction of a texel redraws every shadow edge slightly differently, and
//    the edges crawl as the car moves.
//  - Its depth range is set from the light's height: far enough towards the
//    light for a ridge a hundred metres up to cast into the square, far
//    enough the other way for the ground at the square's far edge.
//  - The shadow fades out over the last few per cent of the square instead of
//    ending in a line that travels along the road ahead of the car.
//
// The map is drawn once for each view, in prepareView's wake, not once for
// every render call: the pictures a reflection probe takes of the same
// scene in the same frame use the map as it is.

import * as THREE from 'three';

/**
 * Per tier: the map's edge in texels, half the side of the square it covers (m), and how wide the shadow's edge
 * is filtered (texels). A texel is 2 * reach / size: 9, 5 and 3 cm.
 */
export const SHADOW = {
  // (render lane: the filter was 1.2 / 1.8 / 2.5 texels; with the map fitted to the sun's height a texel is finer
  // along the ground, and a narrower filter keeps the car's shadow crisp instead of a soft blob)
  low: { size: 1024, reach: 46, radius: 1.0 },
  medium: { size: 2048, reach: 56, radius: 1.2 },
  high: { size: 4096, reach: 66, radius: 1.6 },
};

/** How far in from the edge of its square a view's car is kept (m): shadows also fall on what is behind it. */
const BEHIND = 20;
/** The tallest thing that must still be able to cast into the square, above the square's centre (m). */
const CASTER_HEIGHT = 110;
/** How far the ground inside the square may lie below (or above) its centre (m). */
const GROUND_DROP = 45;
/** The share of the square, from its edge inwards, over which the shadow fades away. */
const EDGE_FADE = 0.08;
/**
 * (render lane) How high above the ground a surface that RECEIVES the shadow may stand and still be inside the map
 * (m): the car, walls, boards, the lower crowns. The map's height in the light's view is cut to what level ground of
 * the square plus this needs (see setTime), not the whole square: under a low sun that is two to three times as
 * many texels along the ground towards the sun.
 */
const RECEIVER_HEIGHT = 14;
/**
 * Depth the shadow is pushed away from the light (m), and how far a surface is lifted off itself, in texels.
 * (render lane: the lift was 1.6 texels: under a 16 degree sun that lifted the road some 9 cm into the light and
 * moved the car's shadow 30 cm away from its tyres; with the finer map 0.8 texel does without acne)
 */
const BIAS = { depth: 0.02, normal: 0.8 };

let fadeInstalled = false;

/**
 * three.js ends a shadow map's shadow at the map's edge. This adds the fade to its filtered lookup, in its shader
 * library, before anything is compiled (spot lights use the same lookup: their shadows fade at the rim of the
 * cone, where there is no light anyway).
 */
function installShadowFade() {
  if (fadeInstalled) return;
  fadeInstalled = true;
  const fade = `
				vec2 fromEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
				shadow = mix( 1.0, shadow, smoothstep( 0.0, ${EDGE_FADE.toFixed(3)}, min( fromEdge.x, fromEdge.y ) ) );
`;
  // the first lookup in the chunk is the filtered (PCF) one: the one this demo uses
  THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(/\) \* 0\.2;\n/, (found) => `${found}${fade}`);
}

/**
 * The map's box in the light's own frame, as prepareView last placed it: a point p is in it when
 * |p.right - x| < halfX, |p.up - y| < halfY and -away < p.dir - z < towards (`dir` points at the light).
 * @typedef {object} ShadowBox
 * @property {THREE.Vector3} right @property {THREE.Vector3} up @property {THREE.Vector3} dir
 * @property {number} x @property {number} y @property {number} z
 * @property {number} halfX @property {number} halfY @property {number} towards @property {number} away
 * @property {boolean} on false while the map is not drawn at all (no shadows)
 */

/**
 * @typedef {object} Sun
 * @property {THREE.DirectionalLight} light
 * @property {THREE.HemisphereLight} fill
 * @property {THREE.Object3D[]} objects everything that goes into the scene
 * @property {(time: import('./lighting.js').TimeOfDay, fillSky: number[], fillGround: number[]) => void} setTime
 *   `fillSky`, `fillGround`: what the fill lays on a surface facing up and one facing down
 * @property {(camera: THREE.Camera, focus: THREE.Vector3) => void} prepareView puts the shadow round what this
 *   view looks at, and asks for the map to be drawn
 * @property {(share: number) => void} setFill how much of the fill reaches the view's car (none in the tunnel)
 * @property {ShadowBox} box what the map covers for the view prepareView last placed it for (forest.js chooses the
 *   trees that cast from it)
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {boolean} options.shadows
 * @returns {Sun}
 */
export function createSun({ renderer, tier, shadows }) {
  installShadowFade();
  const { size, reach, radius } = SHADOW[tier];
  // the map's texels across the light's view (x) and up it (y): y is set per time of day, from the light's height
  const texel = (2 * reach) / size;
  let texelUp = texel;

  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // drawn when prepareView asks, not for every render call
  renderer.shadowMap.autoUpdate = false;

  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  const shadow = light.shadow;
  shadow.mapSize.set(size, size);
  shadow.radius = radius;
  shadow.normalBias = BIAS.normal * texel;
  Object.assign(shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
  // The map itself, made here because three.js would make it four times the size: a colour buffer nobody reads
  // at 32 bits a texel and 32 bits of depth. One byte and 16 bits do (the depth range is some 600 m: a step is
  // a centimetre, half the bias).
  shadow.map = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false });
  const depth = new THREE.DepthTexture(size, size, THREE.UnsignedShortType);
  depth.format = THREE.DepthFormat;
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  shadow.map.depthTexture = depth;
  // (look lane) Made in GL now and cleared to "nothing in the way": a pass drawn before the first shadow pass (the
  // wet road's mirror, which never draws shadow maps) would otherwise find no depth texture on the shadow sampler's
  // unit and the driver would skip its draws (GL_INVALID_OPERATION, sampler type mismatch).
  if (shadows && renderer.initRenderTarget) {
    const previous = renderer.getRenderTarget();
    renderer.initRenderTarget(shadow.map);
    renderer.setRenderTarget(shadow.map);
    renderer.clear(false, true, false);
    renderer.setRenderTarget(previous);
  }

  const fill = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); // its two colours carry the brightness

  const dir = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const fillSky = new THREE.Color();
  const fillGround = new THREE.Color();
  let standOff = 0;
  /** @type {ShadowBox} */
  const box = { right, up, dir, x: 0, y: 0, z: 0, halfX: reach, halfY: reach, towards: 0, away: 0, on: shadows };
  /** @type {THREE.Camera|null} */
  let pendingFor = null;

  return {
    light,
    fill,
    objects: [light, light.target, fill],
    box,

    setTime(time, sky, ground) {
      // (look lane, dusk) a sun under the horizon lights nothing directly: `light` is then the soft key the
      // directional light stands for (high, from the bright side of the sky), its shadow grounding what stands
      dir.fromArray(time.sun.light?.dir ?? time.sun.dir).normalize();
      light.color.setRGB(...time.sun.color);
      light.intensity = time.sun.light?.intensity ?? time.sun.intensity;
      fillSky.setRGB(...sky);
      fillGround.setRGB(...ground);
      fill.color.copy(fillSky);
      fill.groundColor.copy(fillGround);

      // the light's own right and up, as three.js's shadow camera will have them (it looks down -dir, y up)
      right.set(0, 1, 0).cross(dir).normalize();
      up.crossVectors(dir, right);
      // Level ground at the square's top and bottom edges lies reach / tan(height) nearer to or further from
      // the light than its centre: a low light needs a deep map.
      const slope = dir.y / Math.hypot(dir.x, dir.z);
      // (render lane) Up the light's view, level ground of the square spans only reach x sin(height); what stands
      // on it reaches RECEIVER_HEIGHT x cos(height) higher. A map no taller than that puts all its texels where
      // the shadows fall: under the day's 16 degree sun twice as fine along the ground as a square map.
      const sinH = Math.min(1, Math.max(0.02, dir.y));
      const upReach = Math.min(reach, reach * sinH + RECEIVER_HEIGHT * Math.sqrt(1 - sinH * sinH));
      shadow.camera.top = upReach;
      shadow.camera.bottom = -upReach;
      texelUp = (2 * upReach) / size;
      const towards = upReach / slope + CASTER_HEIGHT / dir.y;
      const away = upReach / slope + GROUND_DROP;
      standOff = towards + 10;
      box.halfY = upReach;
      box.towards = towards;
      box.away = away;
      shadow.camera.near = 10;
      shadow.camera.far = standOff + away;
      shadow.camera.updateProjectionMatrix();
      shadow.bias = -BIAS.depth / (shadow.camera.far - shadow.camera.near);
    },

    setFill(share) {
      fill.color.copy(fillSky).multiplyScalar(share);
      fill.groundColor.copy(fillGround).multiplyScalar(share);
    },

    prepareView(camera, focus) {
      // The square's centre: ahead of the car along the camera's level heading (a camera looking straight down has
      // none, and the square stays on the car), moved to the nearest whole texel across and up the light's view.
      camera.getWorldDirection(ahead);
      ahead.y = 0;
      const level = ahead.length();
      centre.copy(focus);
      if (level > 0.2) centre.addScaledVector(ahead, (reach - BEHIND) / level);
      const x = Math.round(centre.dot(right) / texel) * texel;
      const y = Math.round(centre.dot(up) / texelUp) * texelUp;
      const z = centre.dot(dir);
      centre.set(0, 0, 0).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(dir, z);
      box.x = x;
      box.y = y;
      box.z = z;
      light.target.position.copy(centre);
      light.position.copy(centre).addScaledVector(dir, standOff);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
      // (look lane) not drawn here but at the first render made with this camera: a reflection probe or the
      // road's mirror drawn in between hides the car and the land, and the map drawn with them would lack them
      // (the car cast no shadow in the game by day)
      pendingFor = camera;
    },

    /** Called by the scene before every render: draws the shadow map if this is the view it was moved for. */
    beforeRender(camera) {
      if (pendingFor !== null && camera === pendingFor) {
        renderer.shadowMap.needsUpdate = true;
        pendingFor = null;
      }
    },

    dispose() {
      depth.dispose();
      shadow.map.dispose();
      // (the map is ours: three.js must not try to free it a second time)
      shadow.map = null;
      light.dispose();
      fill.dispose();
    },
  };
}
