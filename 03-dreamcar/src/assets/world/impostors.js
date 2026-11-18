// The impostor atlas: pictures of every tree variant, taken at start-up from
// the real (grown, full) trees, that stand in for the trees beyond the reach
// of the meshes (one card per tree, treeMaterial.js impostorMaterial).
//
// Each variant gets a STRIP of VIEWS pictures from all round at the level of
// its middle and, where the tier has them, a second strip of VIEWS pictures
// from above at ELEVATION, at half the size (they are what a wood far below
// the road is seen by). A picture's frame is the variant's box: across its
// widest reach, from just under its foot to its top; its size in texels
// follows the tree's height and shape, so a slim spruce does not get the
// square a broad maple needs and a shrub gets a small one. The strips are
// packed on shelves.
//
// Two atlases share the layout:
//   COLOUR  the leaves' and the bark's own colour, untinted (bark with the
//           crown's shade on it), PREMULTIPLIED by what the picture covers,
//           and that coverage in alpha: the mip levels (made by the GPU) and
//           every filtered lookup then average leaves with the gaps between
//           them correctly, and no edge pulls towards a background colour.
//   SHAPE   at half the size: the BENT NORMAL of what is seen, in the tree's
//           own frame (rgb), and in alpha what it is: 0.04 to 0.24 bark (by
//           how much light gets to it), 0.3 to 1 a leaf (by how open the crown
//           is there, as its square root). It has no coverage of its own to be
//           weighted by, so it has no holes: each picture is first drawn with
//           every leaf card as a whole square and every limb thickened, then
//           again as it is, so that a gap between leaves holds what the card
//           round it holds, or what the leaf seen through it does.
// So the card is lit by the same code, the same sun, sky and lamps as the
// tree, at every time of day, and takes the same per-tree tint.
//
// Pictures are taken upside down, so that a cell's v runs from the top of the
// tree down, as the card's does.

import * as THREE from 'three';

/** Pictures round each ring. */
const VIEWS = 8;
/** How far above the level the raised pictures are taken (rad). */
const ELEVATION = 0.55;
/** The height of tree (m) that gets a picture of the full cell height; smaller ones get smaller pictures. */
const FULL_HEIGHT = 12;
/** Picture sizes are multiples of this (texels): the half-size atlas and the raised pictures stay on whole texels. */
const STEP = 16;

const VERTEX = /* glsl */ `
attribute vec4 aShade;
uniform float uFat;
varying vec4 vShade;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vShade = aShade;
  vUv = uv;
  vN = normal;
  // (uFat: bark drawn this much thicker, see the shape atlas's first drawing)
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position + normal * ( uFat * step( 0.75, aShade.y ) ), 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uFoliage;
uniform sampler2D uBark;
uniform float uPass;
uniform float uWhole;
varying vec4 vShade;
varying vec2 vUv;
varying vec3 vN;
void main() {
  bool bark = vShade.y > 0.75;
  vec4 c = bark ? vec4( texture2D( uBark, vUv ).rgb * ( ( 0.3 + 1.4 * vShade.z ) * 0.72 * vShade.x ), 1.0 ) : texture2D( uFoliage, vUv );
  if ( c.a < 0.5 && uWhole < 0.5 ) discard;
  if ( ! bark ) {
    // a dead twig keeps its own, greyer colour; a leaf card its own lightness (its hue is the tint's)
    if ( vShade.y > 0.25 ) c.rgb *= 0.55;
    else c.rgb *= 1.0 + 0.08 * ( vShade.z - 0.5 ) * 2.0;
  }
  if ( uPass < 0.5 ) gl_FragColor = vec4( c.rgb, 1.0 );
  // (a leaf's openness as its square root: where a picture's texel averages an open leaf with a dark one seen past
  // it, the average then leans to the dark one, as the light of the two does)
  else gl_FragColor = vec4( normalize( vN ) * 0.5 + 0.5, bark ? 0.04 + 0.2 * vShade.x : 0.3 + 0.7 * sqrt( vShade.x ) );
}`;

/**
 * @typedef {object} ImpostorAtlas
 * @property {THREE.Texture} color @property {THREE.Texture} shape
 * @property {number} variants @property {number} rows rings of pictures (1 or 2) @property {number} elevation (rad)
 * @property {THREE.Vector4[]} level per variant: the uv of its level strip's first picture (xy), the size of a picture (zw)
 * @property {THREE.Vector4[]} raised the same for its raised strip (zero where there is none)
 * @property {THREE.Vector4[]} boxes per variant: the frame of its pictures in its own metres (half width, bottom,
 *   top), and how far in from a picture's edge the lookups stay, as a share of the picture (w)
 * @property {number} views pictures per ring
 * @property {number[]} size the colour atlas, texels @property {number} bytes @property {number} ms
 * @property {() => void} dispose
 */

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {import('./treeGeometry.js').TreeModel[]} o.models
 * @param {THREE.Texture} o.foliage @param {THREE.Texture} o.bark
 * @param {number} o.cell texels of a level picture's height, for a tree of FULL_HEIGHT or more
 * @param {number} [o.rings] 2: the level and the raised pictures; 1: the level ones only (the low tier)
 * @returns {ImpostorAtlas}
 */
export function bakeImpostors({ renderer, models, foliage, bark, cell, rings = 2 }) {
  const started = performance.now();
  const n = models.length;

  // each variant's frame and the size of its pictures
  const frames = models.map((model) => {
    const half = model.radius * 1.04;
    const bottom = -0.5;
    const top = model.top * 1.02;
    const h = Math.max(2 * STEP, Math.min(cell, Math.ceil((cell * (top - bottom)) / FULL_HEIGHT / (2 * STEP)) * 2 * STEP));
    const w = Math.max(2 * STEP, Math.min(cell, Math.ceil((h * 2 * half) / (top - bottom) / (2 * STEP)) * 2 * STEP));
    return { half, bottom, top, w, h };
  });
  // the strips, tallest first, on shelves as wide as the widest strip
  const strips = [];
  frames.forEach((f, v) => {
    strips.push({ v, raised: false, w: f.w, h: f.h });
    if (rings > 1) strips.push({ v, raised: true, w: f.w / 2, h: f.h / 2 });
  });
  strips.sort((a, b) => b.h - a.h || b.w - a.w);
  const width = Math.max(...strips.map((s) => s.w * VIEWS));
  const shelves = [];
  let height = 0;
  for (const s of strips) {
    let shelf = shelves.find((x) => x.h >= s.h && x.used + s.w * VIEWS <= width);
    if (!shelf) {
      shelf = { y: height, h: s.h, used: 0 };
      shelves.push(shelf);
      height += s.h;
    }
    s.x = shelf.used;
    s.y = shelf.y;
    shelf.used += s.w * VIEWS;
  }

  const target = (srgb, scale) => {
    const t = new THREE.WebGLRenderTarget(width * scale, height * scale, {
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
  const colorTarget = target(true, 1);
  const shapeTarget = target(false, 0.5);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uFoliage: { value: foliage }, uBark: { value: bark }, uPass: { value: 0 }, uWhole: { value: 0 }, uFat: { value: 0 } },
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

  const centre = new THREE.Vector3();
  for (const [pass, rt, scale] of [
    [0, colorTarget, 1],
    [1, shapeTarget, 0.5],
  ]) {
    material.uniforms.uPass.value = pass;
    rt.scissorTest = false;
    rt.viewport.set(0, 0, width * scale, height * scale);
    renderer.setRenderTarget(rt);
    // (the shape of nothing: a leaf half open to the sky, which is what a picture's edge is mixed with)
    if (pass === 0) renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
    else renderer.setClearColor(new THREE.Color(0.5, 0.8, 0.5), 0.65);
    renderer.clear(true, true, false);
    for (const s of strips) {
      const model = models[s.v];
      const f = frames[s.v];
      mesh.geometry = model.full ?? model.reduced;
      const halfH = (f.top - f.bottom) / 2;
      centre.set(0, (f.top + f.bottom) / 2, 0);
      for (let k = 0; k < VIEWS; k++) {
        const a = (k / VIEWS) * Math.PI * 2;
        const e = s.raised ? ELEVATION : 0;
        const far = Math.max(f.half, halfH) * 4 + 10;
        camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(far).add(centre);
        camera.up.set(0, 1, 0);
        camera.lookAt(centre);
        // upside down: the cell's v runs from the top of the tree
        camera.left = -f.half;
        camera.right = f.half;
        camera.top = -halfH;
        camera.bottom = halfH;
        camera.near = 0.1;
        camera.far = far * 2;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        rt.viewport.set((s.x + k * s.w) * scale, s.y * scale, s.w * scale, s.h * scale);
        renderer.setRenderTarget(rt);
        if (pass === 1) {
          // whole cards and thickened limbs first (by some three texels: a trunk's edge is then mixed with bark, a
          // leaf's with leaves), then the tree itself over them
          material.uniforms.uWhole.value = 1;
          material.uniforms.uFat.value = (3 * (f.top - f.bottom)) / (s.h * scale);
          renderer.render(scene, camera);
          renderer.clearDepth();
          material.uniforms.uWhole.value = 0;
          material.uniforms.uFat.value = 0;
        }
        renderer.render(scene, camera);
      }
    }
  }
  // (the mip levels are made when the targets are let go)
  renderer.setRenderTarget(null);
  colorTarget.viewport.set(0, 0, width, height);
  shapeTarget.viewport.set(0, 0, width / 2, height / 2);
  renderer.setRenderTarget(saved.target);
  renderer.autoClear = saved.autoClear;
  renderer.setClearColor(saved.color, saved.alpha);
  renderer.shadowMap.enabled = saved.shadows;
  material.dispose();

  const rect = (s) => (s ? new THREE.Vector4(s.x / width, s.y / height, s.w / width, s.h / height) : new THREE.Vector4());
  return {
    color: colorTarget.texture,
    shape: shapeTarget.texture,
    variants: n,
    rows: rings,
    elevation: ELEVATION,
    views: VIEWS,
    level: frames.map((_, v) => rect(strips.find((s) => s.v === v && !s.raised))),
    raised: frames.map((_, v) => rect(strips.find((s) => s.v === v && s.raised))),
    // (the lookups stay two texels of the smallest, raised, half-size picture in from the edge)
    boxes: frames.map((f) => new THREE.Vector4(f.half, f.bottom, f.top, (rings > 1 ? 4 : 2) / Math.min(f.w, f.h))),
    bytes: Math.round(width * height * 4 * 1.25 * 1.34),
    size: [width, height],
    ms: Math.round(performance.now() - started),
    targets: [colorTarget, shapeTarget],
    dispose() {
      colorTarget.dispose();
      shapeTarget.dispose();
    },
  };
}
