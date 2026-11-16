// One way to make a material, so that every shader in the demo is set up the
// same: GLSL ES 3.00, the shared functions of glsl.js in front of both stages,
// an output called outColor, and the LDR_TARGETS switch where the device has
// no float targets.

import * as THREE from 'three';
import { GLSL_COMMON } from './glsl.js';

const FRAGMENT_OUT = 'layout(location = 0) out highp vec4 outColor;\n';

/**
 * A ShaderMaterial for things in the scenes.
 *
 * three.js still adds its usual declarations in front (precision, `position`,
 * `normal`, `uv`, `modelMatrix`, `viewMatrix`, `projectionMatrix`,
 * `cameraPosition`, `instanceMatrix` for instanced meshes...), then comes
 * GLSL_COMMON, then your code. Write `in`/`out` instead of attribute/varying,
 * and end the fragment stage with
 *
 *     outColor = toTarget(vec4(rgb, alpha));
 *
 * Uniform objects ({ value }) may be shared between materials: pass the very
 * same object and a change shows up everywhere. That is how the light, the
 * clock and the ripple field reach every material.
 *
 * @param {{ hdr: boolean }} caps
 * @param {THREE.ShaderMaterialParameters & { vertexShader: string, fragmentShader: string }} options
 * @returns {THREE.ShaderMaterial}
 */
export function createMaterial(caps, options) {
  const { vertexShader, fragmentShader, defines, ...rest } = options;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `${GLSL_COMMON}\n${vertexShader}`,
    fragmentShader: `${FRAGMENT_OUT}${GLSL_COMMON}\n${fragmentShader}`,
    defines: { ...(caps.hdr ? {} : { LDR_TARGETS: 1 }), ...defines },
    ...rest,
  });
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

/**
 * A material for a full-screen pass (see FullscreenPass.js). The fragment
 * stage gets `vUv` (0..1 over the target), GLSL_COMMON and `outColor`.
 * Nothing from three.js is declared: it is a RawShaderMaterial.
 *
 * @param {{ hdr: boolean }} caps
 * @param {{ fragmentShader: string, uniforms?: object, defines?: object }} options
 * @returns {THREE.RawShaderMaterial}
 */
export function createPassMaterial(caps, { fragmentShader, uniforms = {}, defines = {} }) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PASS_VERTEX,
    fragmentShader: `precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n${FRAGMENT_OUT}in vec2 vUv;\n${GLSL_COMMON}\n${fragmentShader}`,
    uniforms,
    defines: { ...(caps.hdr ? {} : { LDR_TARGETS: 1 }), ...defines },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}
