// Draws one material over a whole render target, or over a rectangle of it.
//
// The "quad" is a single triangle that is bigger than the screen: the part
// that sticks out is clipped away for free, and unlike two triangles there is
// no diagonal seam where pixels get shaded twice.

import * as THREE from 'three';
import { GLSL_COMMON, targetDefines } from './glsl.js';

let sharedGeometry = null;

/** The big triangle, for meshes that want to cover the screen from inside a scene. */
export function fullscreenGeometry() {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.BufferGeometry();
    sharedGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    // it never moves and is never culled, but three.js wants a bounding sphere to exist
    sharedGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }
  return sharedGeometry;
}

const PASS_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PASS_HEADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
layout(location = 0) out highp vec4 outColor;
in vec2 vUv;
`;

/**
 * A material for a full-screen pass. The fragment stage gets `vUv` (0..1 over
 * what is drawn), everything in GLSL_COMMON, and writes `outColor`. Nothing
 * from three.js is declared: it is a RawShaderMaterial in GLSL ES 3.00.
 *
 * A pass that reads one of the frame's targets wraps the lookup in
 * fromTarget(); one that writes into one ends with toTarget() (see glsl.js).
 *
 * @param {import('./caps.js').Caps} caps
 * @param {{ fragmentShader: string, uniforms?: object, defines?: object }} options
 * @returns {THREE.RawShaderMaterial}
 */
export function createPassMaterial(caps, { fragmentShader, uniforms = {}, defines = {} }) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PASS_VERTEX,
    fragmentShader: `${PASS_HEADER}${GLSL_COMMON}\n${fragmentShader}`,
    uniforms,
    defines: { ...targetDefines(caps), ...defines },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const savedViewport = new THREE.Vector4();
const savedScissor = new THREE.Vector4();

export class FullscreenPass {
  /** @param {THREE.Material} material made with createPassMaterial() */
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(fullscreenGeometry(), material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Draw into `target` (null: the canvas), or only into `rect` of it. The
   * previous render target, viewport and scissor are put back afterwards, so
   * a pass can be used from anywhere.
   *
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget|null} target
   * @param {{ x: number, y: number, w: number, h: number }|null} [rect] in the target's own pixels (device pixels
   *   for the canvas), origin bottom-left as in GL
   */
  render(renderer, target, rect = null) {
    const previous = renderer.getRenderTarget();
    let scissorTest = false;
    if (rect && target) {
      // a render target carries its own viewport, applied when it is bound
      savedViewport.copy(target.viewport);
      savedScissor.copy(target.scissor);
      scissorTest = target.scissorTest;
      target.viewport.set(rect.x, rect.y, rect.w, rect.h);
      target.scissor.set(rect.x, rect.y, rect.w, rect.h);
      target.scissorTest = true;
    }
    renderer.setRenderTarget(target);
    if (rect && !target) {
      // the renderer keeps the canvas's viewport in CSS pixels and multiplies by the pixel ratio itself
      const pr = renderer.getPixelRatio();
      renderer.getViewport(savedViewport);
      renderer.getScissor(savedScissor);
      scissorTest = renderer.getScissorTest();
      renderer.setViewport(rect.x / pr, rect.y / pr, rect.w / pr, rect.h / pr);
      renderer.setScissor(rect.x / pr, rect.y / pr, rect.w / pr, rect.h / pr);
      renderer.setScissorTest(true);
    }
    renderer.render(this.mesh, camera);
    if (rect && target) {
      target.viewport.copy(savedViewport);
      target.scissor.copy(savedScissor);
      target.scissorTest = scissorTest;
    } else if (rect) {
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(scissorTest);
    }
    renderer.setRenderTarget(previous);
  }

  /** Make the pass's program now rather than at its first use (for a pass first used in the middle of a run). */
  compile(renderer) {
    renderer.compile(this.mesh, camera);
  }

  dispose() {
    this.material.dispose();
  }
}
