// The impostor atlas: pictures of every tree variant, taken at start-up from
// the real (grown) trees, that stand in for the trees of the mass of the
// forest and the far hills (one card per tree, treeMaterial.js
// impostorMaterial).
//
// Each variant gets one row of the atlas: VIEWS pictures from all round at the
// level of its middle, then VIEWS from above at ELEVATION. Two atlases share
// the layout: COLOUR (the leaves' and the bark's own colour, untinted, with
// the crown's occlusion, and alpha where the tree is) and SHAPE (the normal in
// the tree's own frame as rgb, and in alpha 0 where it is bark, 0.4 to 1 where
// it is foliage, by how much light gets into the crown there).
// So the card is lit by the same code, the same sun, sky and lamps as the
// tree, at every time of day, and takes the same per-tree tint.
//
// A picture's frame is the variant's box: across its widest reach, from just
// under its foot to its top. Pictures are taken upside down, so that a cell's
// v runs from the top of the tree down, as the card's does.
//
// Mip levels are made by the GPU: a far card is a few dozen pixels tall and
// its crown, a body of leaf clusters seen from far, keeps its mass in the
// average; the material's cut (or coverage) is set low for that.

import * as THREE from 'three';

/** Pictures round the level ring and the raised ring. */
const VIEWS = 8;
/** How far above the level the raised pictures are taken (rad). */
const ELEVATION = 0.55;

const VERTEX = /* glsl */ `
attribute vec4 aShade;
varying vec4 vShade;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vShade = aShade;
  vUv = uv;
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uFoliage;
uniform sampler2D uBark;
uniform float uPass;
varying vec4 vShade;
varying vec2 vUv;
varying vec3 vN;
void main() {
  bool bark = vShade.y > 0.75;
  vec4 c = bark ? vec4( texture2D( uBark, vUv ).rgb * 0.72, 1.0 ) : texture2D( uFoliage, vUv );
  if ( c.a < 0.5 ) discard;
  // a dead twig keeps its own, greyer colour
  if ( ! bark && vShade.y > 0.25 ) c.rgb *= 0.55;
  if ( uPass < 0.5 ) gl_FragColor = vec4( c.rgb * mix( 1.0, vShade.x, 0.9 ), 1.0 );
  // (alpha: 0 bark, else 0.4 + 0.6 * the light inside the crown, which the card's tint follows)
  else gl_FragColor = vec4( normalize( vN ) * 0.5 + 0.5, bark ? 0.0 : 0.4 + 0.6 * vShade.x );
}`;

/**
 * @typedef {object} ImpostorAtlas
 * @property {THREE.Texture} color @property {THREE.Texture} normal
 * @property {number} variants @property {number} rows rings of pictures (2) @property {number} elevation (rad)
 * @property {THREE.Vector4[]} cells per variant: uv of its first cell, size of a cell
 * @property {THREE.Vector4[]} runs per variant: cells in an atlas row, first cell's number, pictures per ring (level,
 *   raised)
 * @property {THREE.Vector4[]} boxes per variant: the frame of its pictures in its own metres (half width, bottom, top)
 * @property {THREE.Vector2} inset @property {number} bytes @property {number} ms
 * @property {() => void} dispose
 */

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {import('./treeGeometry.js').TreeModel[]} o.models
 * @param {THREE.Texture} o.foliage @param {THREE.Texture} o.bark
 * @param {number} o.cell texels of one picture's edge
 * @param {number} [o.rings] 2: the level and the raised pictures; 1: the level ones only (the low tier)
 * @returns {ImpostorAtlas}
 */
export function bakeImpostors({ renderer, models, foliage, bark, cell, rings = 2 }) {
  const started = performance.now();
  const n = models.length;
  const perRow = VIEWS * rings;
  const width = cell * perRow;
  const height = cell * n;
  const target = (srgb) => {
    const t = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    t.texture.anisotropy = 4;
    return t;
  };
  const colorTarget = target(true);
  const shapeTarget = target(false);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uFoliage: { value: foliage }, uBark: { value: bark }, uPass: { value: 0 } },
    side: THREE.DoubleSide,
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(undefined, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera();

  const saved = {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    color: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    shadows: renderer.shadowMap.enabled,
  };
  renderer.autoClear = false;
  renderer.shadowMap.enabled = false;

  const cells = [];
  const runs = [];
  const boxes = [];
  const centre = new THREE.Vector3();
  for (const [pass, rt, clear] of [
    [0, colorTarget, [0.16, 0.17, 0.12, 0]],
    [1, shapeTarget, [0.5, 0.85, 0.5, 1]],
  ]) {
    material.uniforms.uPass.value = pass;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), clear[3]);
    rt.scissorTest = false;
    rt.viewport.set(0, 0, width, height);
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, false);
    models.forEach((model, v) => {
      mesh.geometry = model.full ?? model.reduced;
      const half = model.radius * 1.04;
      const bottom = -0.5;
      const top = model.top * 1.02;
      if (pass === 0) {
        cells.push(new THREE.Vector4(0, v / n, 1 / perRow, 1 / n));
        runs.push(new THREE.Vector4(perRow, 0, VIEWS, rings > 1 ? VIEWS : 0));
        boxes.push(new THREE.Vector4(half, bottom, top, 0));
      }
      const halfH = (top - bottom) / 2;
      centre.set(0, (top + bottom) / 2, 0);
      for (let k = 0; k < perRow; k++) {
        const raised = k >= VIEWS;
        const a = ((k % VIEWS) / VIEWS) * Math.PI * 2;
        const e = raised ? ELEVATION : 0;
        const far = Math.max(half, halfH) * 4 + 10;
        camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(far).add(centre);
        camera.up.set(0, 1, 0);
        camera.lookAt(centre);
        // upside down: the cell's v runs from the top of the tree
        camera.left = -half;
        camera.right = half;
        camera.top = -halfH;
        camera.bottom = halfH;
        camera.near = 0.1;
        camera.far = far * 2;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        rt.viewport.set(k * cell, v * cell, cell, cell);
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
      }
    });
  }
  // (the mip levels are made when the targets are let go)
  renderer.setRenderTarget(null);
  colorTarget.viewport.set(0, 0, width, height);
  shapeTarget.viewport.set(0, 0, width, height);
  renderer.setRenderTarget(saved.target);
  renderer.autoClear = saved.autoClear;
  renderer.setClearColor(saved.color, saved.alpha);
  renderer.shadowMap.enabled = saved.shadows;
  material.dispose();

  return {
    color: colorTarget.texture,
    normal: shapeTarget.texture,
    variants: n,
    rows: rings,
    elevation: ELEVATION,
    cells,
    runs,
    boxes,
    inset: new THREE.Vector2(1.5 / cell, 1.5 / cell),
    bytes: Math.round(width * height * 4 * 2 * 1.34),
    size: [width, height],
    ms: Math.round(performance.now() - started),
    targets: [colorTarget, shapeTarget],
    dispose() {
      colorTarget.dispose();
      shapeTarget.dispose();
    },
  };
}
