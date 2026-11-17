// The sun, or at night the moon: one DirectionalLight and its shadow, and the
// HemisphereLight that is the table's `ambient` fill. Always the same two
// lights: the time of day changes their colours and strengths, never their
// number, so no shader is compiled again when it changes.
//
// The shadow is one map that follows each view. Four things make it hold up
// under a sun 24 degrees high:
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
  low: { size: 1024, reach: 46, radius: 1.2 },
  medium: { size: 2048, reach: 56, radius: 1.8 },
  high: { size: 4096, reach: 66, radius: 2.5 },
};

/** How far in from the edge of its square a view's car is kept (m): shadows also fall on what is behind it. */
const BEHIND = 20;
/** The tallest thing that must still be able to cast into the square, above the square's centre (m). */
const CASTER_HEIGHT = 110;
/** How far the ground inside the square may lie below (or above) its centre (m). */
const GROUND_DROP = 45;
/** The share of the square, from its edge inwards, over which the shadow fades away. */
const EDGE_FADE = 0.08;
/** Depth the shadow is pushed away from the light (m), and how far a surface is lifted off itself, in texels. */
const BIAS = { depth: 0.02, normal: 1.6 };

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
 * @typedef {object} Sun
 * @property {THREE.DirectionalLight} light
 * @property {THREE.HemisphereLight} fill
 * @property {THREE.Object3D[]} objects everything that goes into the scene
 * @property {(time: import('./lighting.js').TimeOfDay, fillSky: number[], fillGround: number[]) => void} setTime
 *   `fillSky`, `fillGround`: what the fill lays on a surface facing up and one facing down
 * @property {(camera: THREE.Camera, focus: THREE.Vector3) => void} prepareView puts the shadow round what this
 *   view looks at, and asks for the map to be drawn
 * @property {(share: number) => void} setFill how much of the fill reaches the view's car (none in the tunnel)
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
  const texel = (2 * reach) / size;

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

  const fill = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); // its two colours carry the brightness

  const dir = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const fillSky = new THREE.Color();
  const fillGround = new THREE.Color();
  let standOff = 0;

  return {
    light,
    fill,
    objects: [light, light.target, fill],

    setTime(time, sky, ground) {
      dir.fromArray(time.sun.dir).normalize();
      light.color.setRGB(...time.sun.color);
      light.intensity = time.sun.intensity;
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
      const towards = reach / slope + CASTER_HEIGHT / dir.y;
      const away = reach / slope + GROUND_DROP;
      standOff = towards + 10;
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
      const y = Math.round(centre.dot(up) / texel) * texel;
      const z = centre.dot(dir);
      centre.set(0, 0, 0).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(dir, z);
      light.target.position.copy(centre);
      light.position.copy(centre).addScaledVector(dir, standOff);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
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
