// What this device can do, and which quality tier it gets.
//
// The probe looks at the WebGL context once. Nothing here is measured by
// timing: a wrong guess is corrected later by the adaptive render scale in
// Engine.js, which trades resolution for frame rate while the page runs.

import * as THREE from 'three';

/**
 * @typedef {object} Caps
 * @property {boolean} hdr half-float render targets are available (false: 8-bit fallback)
 * @property {boolean} forcedLdr the fallback was asked for with ?ldr
 * @property {boolean} floatTargets full 32-bit float targets are available (used by the ripple simulation)
 * @property {boolean} msaaHdr multisampled half-float targets work
 * @property {number} maxSamples
 * @property {number} maxTextureSize
 * @property {string} gpu renderer string, lower case ('' if the browser hides it)
 * @property {boolean} software a CPU rasteriser (SwiftShader, llvmpipe)
 * @property {boolean} mobile
 * @property {'low'|'medium'|'high'} tier the probe's suggestion
 */

/**
 * Tries the one thing that cannot be read from the extension list: whether a
 * multisampled half-float colour buffer can really be made. Some mobile
 * drivers list the extension and still refuse the renderbuffer.
 */
function canMultisampleHalfFloat(gl) {
  const rb = gl.createRenderbuffer();
  const fb = gl.createFramebuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA16F, 4, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  // reading the error also clears it, so a refusal here does not show up later as someone else's
  const clean = gl.getError() === gl.NO_ERROR;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(rb);
  return complete && clean;
}

/** Rough classes of GPU, from the renderer string. Unknown mobile chips count as weak. */
function guessTier(gpu, software, mobile) {
  if (software) return 'low';
  if (mobile) {
    if (/apple/.test(gpu)) return 'medium';
    // recent flagship families; everything older or unnamed starts low and can only be told apart by running
    if (/adreno \(tm\) (6[4-9]\d|7\d\d|8\d\d)|mali-g(7[1-9]|[6-9]1\d|7\d\d)|immortalis|xclipse/.test(gpu)) return 'medium';
    return 'low';
  }
  if (/intel/.test(gpu) && !/arc|iris\(r\) xe|iris xe/.test(gpu)) return 'medium';
  return 'high';
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ ldr?: boolean }} [options] `ldr` forces the 8-bit fallback
 * @returns {Caps}
 */
export function probeCaps(renderer, options = {}) {
  const gl = renderer.getContext();
  const ext = renderer.extensions;
  const halfFloat = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
  const hdr = halfFloat && !options.ldr;

  let gpu = '';
  const info = ext.get('WEBGL_debug_renderer_info');
  try {
    gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').toLowerCase();
  } catch {
    gpu = '';
  }
  const software = /swiftshader|llvmpipe|software|basic render/.test(gpu);

  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  // iPadOS calls itself a Mac; the touch points give it away
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua) || (/macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1);

  return {
    hdr,
    forcedLdr: !!options.ldr,
    floatTargets: hdr && ext.has('EXT_color_buffer_float'),
    msaaHdr: hdr ? canMultisampleHalfFloat(gl) : true,
    maxSamples: gl.getParameter(gl.MAX_SAMPLES) || 0,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048,
    gpu,
    software,
    mobile,
    tier: guessTier(gpu, software, mobile),
  };
}

/**
 * A colour render target in the format the whole pipeline uses: half-float
 * linear light, or the 8-bit encoding described in glsl.js when `caps.hdr` is
 * false. Never 32-bit float: half-float is the only float format every WebGL 2
 * device can also filter.
 *
 * @param {Caps} caps
 * @param {{ depth?: boolean, samples?: number, filter?: number }} [options]
 * @returns {THREE.WebGLRenderTarget}
 */
export function createTarget(caps, { depth = false, samples = 0, filter = THREE.LinearFilter } = {}) {
  const msaa = caps.hdr && !caps.msaaHdr ? 0 : Math.min(samples, caps.maxSamples);
  return new THREE.WebGLRenderTarget(4, 4, {
    type: caps.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: depth,
    stencilBuffer: false,
    samples: msaa,
  });
}

/** Resizes a target only when the size really changes (setSize reallocates). */
export function resizeTarget(target, width, height) {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  if (target.width !== w || target.height !== h) target.setSize(w, h);
}
