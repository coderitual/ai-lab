// A cube picture of the surroundings of one point, for mirror-like and glossy
// surfaces (the cars' paint, glass, trim and tyres), kept up to date a face or
// two a frame and filtered for roughness.
//
// Two cubes:
//  - `raw`: what the probe's cameras draw, a face or two per update (the faces
//    that change fastest first, see `update`), with plain 2x2 mips that the
//    hardware makes. Nobody reads it but the filter.
//  - `target` (its `texture` is what materials read): `levels` mip levels, each
//    the raw cube convolved with the GGX lobe of one roughness (level 0 the
//    sharp picture, a copy; level k >= 1 alpha = roughness^2 = 2^(k - M), M the
//    last level, whose faces are 4 texels wide and hold roughness 1). The
//    convolution is filtered importance sampling (Krivanek and Colbert): a few
//    GGX samples per texel, each read from the raw cube's mip whose texel is as
//    large as the sample's share of the lobe (one level coarser still), so a
//    small bright light is spread over the whole lobe instead of printed once
//    per sample. Every level of every face is drawn into with blending: the
//    filtered result is mixed into what is there (`fade`, a time constant), so
//    a face that is redrawn somewhere else, or a light that comes into one, is
//    eased in over a few frames instead of popping.
//
// Reading it: GLSL_PROBE in glsl.js (the plain world-space direction, no flip,
// and `probeLevel` from the roughness). `uniforms` describe the local proxy for
// a parallax correction (GLSL_PROBE_PROXY): the ground plane under the car and,
// in a tunnel, the bore as a box.
//
// What keeps it cheap: the faces are drawn without the shadow maps being drawn
// again, whatever is in `hidden` is skipped, its cameras have a layer mask of
// their own (`layers`, with PROBE_LAYER for cheaper stand-ins), the far plane is
// short (`far`, per update); the filter's passes are small (a 256 cube's level 1
// is 128 x 128 a face) and only `levelsPerUpdate` of the rough levels are
// filtered per update, round and round (level 0 every update).

import * as THREE from 'three';
import { createPassMaterial, fullscreenGeometry } from './FullscreenPass.js';
import { ldrEncodingInstalled, probeLevelCount } from './glsl.js';

/**
 * A layer only reflection probes see (the game's cameras have only layer 0): a cheaper stand-in for something
 * big goes on it, and the full thing draws nothing when `camera.layers.isEnabled(PROBE_LAYER)`.
 */
export const PROBE_LAYER = 30;

/** Where each face looks and which way is up in it: OpenGL's cube faces, in the order +X -X +Y -Y +Z -Z. */
const FACES = [
  { look: [1, 0, 0], up: [0, 1, 0] },
  { look: [-1, 0, 0], up: [0, 1, 0] },
  { look: [0, 1, 0], up: [0, 0, -1] },
  { look: [0, -1, 0], up: [0, 0, 1] },
  { look: [0, 0, 1], up: [0, 1, 0] },
  { look: [0, 0, -1], up: [0, 1, 0] },
];

/**
 * How much more often a face is redrawn when the car moves across it (`update`'s `velocity`): a face that looks
 * sideways sees the roadside go by at the car's speed, one that looks ahead or back sees it come and go slowly,
 * the one under the car sees road, which the materials' ground correction places anyway. At full speed
 * (`FULL_SPEED` m/s) the side faces are redrawn `1 + SIDE_GAIN` times as often as the front and back.
 */
const SIDE_GAIN = 2;
const FULL_SPEED = 40;
const DOWN_WEIGHT = 0.6;

/** A move of more than this between two updates (m) is a cut: everything is drawn again, nothing eased. */
const CUT = 6;

/**
 * The filter, one level of one face: the texel's direction, then either a copy of the raw cube (level 0) or GGX
 * samples of it read at the mip their share of the lobe asks for, weighted by the cosine (the split-sum
 * prefilter of a lobe whose view direction is its normal). `outColor.a` is the share the result is blended in with.
 */
const FILTER = /* glsl */ `
uniform samplerCube uSource;
uniform int uFace;
uniform float uAlpha;      // GGX alpha (roughness squared) of this level; 0: the sharp copy
uniform int uCount;        // samples
uniform float uSourceSize; // edge of the raw cube's faces in texels
uniform float uBlend;      // share of the new result
vec3 faceDirection(int face, vec2 uv) {
  // OpenGL's table: the texel (s, t) of a face looks along ma, with sc, tc across it
  vec2 c = uv * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}
float radicalInverse(uint b) {
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return float(b) * 2.3283064365386963e-10;
}
// A texel that is not a number or overflowed (the road's shader has written one, seen exactly edge on) must not get
// in: blended into the output it would stay there for good.
vec3 finite(vec3 c) {
  return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(6.0e4));
}
void main() {
  vec3 N = normalize(faceDirection(uFace, vUv));
  if (uAlpha <= 0.0) {
    // texel centre to texel centre: exact, and in the 8-bit encoding as it is
    outColor = vec4(finite(textureLod(uSource, N, 0.0).rgb), uBlend);
    return;
  }
  vec3 T = normalize(cross(abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), N));
  vec3 B = cross(N, T);
  float a2 = uAlpha * uAlpha;
  float texelAngle = 12.566371 / (6.0 * uSourceSize * uSourceSize);
  float n = float(uCount);
  vec3 sum = vec3(0.0);
  float weight = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    float u = (float(i) + 0.5) / n;
    float v = radicalInverse(uint(i));
    float phi = 6.2831853 * u;
    float cosT = sqrt((1.0 - v) / (1.0 + (a2 - 1.0) * v));
    float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    vec3 H = (T * cos(phi) + B * sin(phi)) * sinT + N * cosT;
    vec3 L = 2.0 * cosT * H - N;
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;
    float d = cosT * cosT * (a2 - 1.0) + 1.0;
    float pdf = a2 / (3.1415927 * d * d) * 0.25; // D(h) cos / (4 v.h), the view along the normal
    float lod = max(0.5 * log2(1.0 / (n * pdf * texelAngle)) + 1.0, 0.0);
    sum += finite(fromTarget(textureLod(uSource, L, lod)).rgb) * NoL;
    weight += NoL;
  }
  outColor = toTarget(vec4(sum / max(weight, 1e-6), uBlend));
}
`;

const ahead = new THREE.Vector3();
const heading = new THREE.Vector3();
const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class ReflectionProbe {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} size edge of a face in texels (a power of two, at least 16)
   * @param {object} [options]
   * @param {number} [options.near] the faces' near plane (m)
   * @param {number} [options.far] how far away something can be and still show in a reflection (m); an update may
   *   give a nearer one
   * @param {import('./caps.js').Caps} [options.caps] for the targets' format (the 8-bit fallback)
   * @param {number} [options.samples] GGX samples per texel of a rough level
   * @param {number} [options.levelsPerUpdate] rough levels (1..M) filtered per update, round and round; level 0 is
   *   filtered every update
   * @param {number} [options.fade] time constant (s) with which a new picture is eased in; 0: at once
   */
  constructor(renderer, size, { near = 0.3, far = 400, caps = null, samples = 16, levelsPerUpdate = Infinity, fade = 0.05 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.samples = samples;
    this.fade = fade;
    /** Mip levels of `texture`: 0 .. levels - 1 (probeLevelCount in glsl.js). */
    this.levels = probeLevelCount(size);
    this.levelsPerUpdate = Math.max(1, Math.min(this.levels - 1, levelsPerUpdate));
    // Half-float where the device can draw into it. Under the 8-bit fallback every material writes encoded
    // values, and 8 bits hold them.
    const float = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    const ldr = caps ? !caps.hdr : ldrEncodingInstalled();
    const type = float && !ldr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.raw = new THREE.WebGLCubeRenderTarget(size, {
      type,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      type,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    // the levels drawn by the filter (three.js allocates them and a framebuffer for each, and limits the chain to them)
    this.target.texture.mipmaps = Array.from({ length: this.levels }, () => ({}));
    /** The cube map materials read: prefiltered for roughness, linear light in scene units (GLSL_PROBE). */
    this.texture = this.target.texture;

    /**
     * The local proxy for a parallax correction (GLSL_PROBE_PROXY): where the cube was drawn from, the ground's plane
     * (n, d: n.x + d = 0) and a box (world to its own -1..1 cube), and which of the two are in use (x plane, y box).
     */
    this.uniforms = {
      probeCenter: { value: new THREE.Vector3() },
      probePlane: { value: new THREE.Vector4(0, 1, 0, 0) },
      probeBox: { value: new THREE.Matrix4() },
      probeProxy: { value: new THREE.Vector2(0, 0) },
    };

    /**
     * What the probe's cameras see: layer 0, as every camera. To leave something out of every reflection
     * without listing it in `hidden`, move it to a layer the game's cameras have enabled and this mask has not.
     * Lights must stay visible to it, or three.js builds a second set of shaders for the probe's light count.
     */
    this.layers = new THREE.Layers();
    // and PROBE_LAYER, which no other camera has: what is on it alone is drawn for probes only (a cheaper stand-in)
    this.layers.enable(PROBE_LAYER);

    // A negative field of view turns the picture upside down and left to right, which is how a cube face is
    // stored (three.js's CubeCamera does the same).
    this._cameras = FACES.map((face) => {
      const camera = new THREE.PerspectiveCamera(-90, 1, near, far);
      camera.layers = this.layers;
      camera.up.fromArray(face.up);
      camera.lookAt(ahead.fromArray(face.look));
      return camera;
    });
    this._far = far;
    this._filled = false;
    this._wasVisible = [];
    /** Updates since each face was drawn. */
    this._age = [0, 0, 0, 0, 0, 0];
    this._weight = [1, 1, 1, 1, 1, 1];
    this._order = [0, 1, 2, 3, 4, 5];
    /** The next rough level to filter, and the time each level was last filtered (s, the caller's clock). */
    this._nextLevel = 1;
    this._levelTime = new Array(this.levels).fill(-Infinity);
    this._at = new THREE.Vector3();

    this._filter = createPassMaterial(caps || { hdr: !ldr }, {
      fragmentShader: FILTER,
      uniforms: {
        uSource: { value: this.raw.texture },
        uFace: { value: 0 },
        uAlpha: { value: 0 },
        uCount: { value: samples },
        uSourceSize: { value: size },
        uBlend: { value: 1 },
      },
    });
    // the new result is mixed into what the level holds: src alpha is the share
    this._filter.blending = THREE.CustomBlending;
    this._filter.blendEquation = THREE.AddEquation;
    this._filter.blendSrc = THREE.SrcAlphaFactor;
    this._filter.blendDst = THREE.OneMinusSrcAlphaFactor;
    this._filter.blendSrcAlpha = THREE.OneFactor;
    this._filter.blendDstAlpha = THREE.ZeroFactor;
    this._pass = new THREE.Mesh(fullscreenGeometry(), this._filter);
    this._pass.frustumCulled = false;
    /** What the last update cost: faces drawn, filter passes. */
    this.stats = { faces: 0, passes: 0 };
  }

  /**
   * Redraw some of the faces from `position` and filter them into `texture`.
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position where the probe stands, world space
   * @param {THREE.Object3D[]} [hidden] not drawn into the probe (the car it belongs to, small things)
   * @param {number} [faces] how many faces to redraw now, 1..6; the first update (and one after a cut) draws all six
   * @param {number} [far] the faces' far plane for this update (m), if not the one it was made with: an enclosed
   *   place (a tunnel) sees no further, and whatever lies beyond is culled
   * @param {{ velocity?: THREE.Vector3, time?: number }} [motion] the probe's velocity (m/s, world), which decides
   *   which faces are redrawn first, and the caller's clock (s) for easing new pictures in (none: no easing)
   */
  update(scene, position, hidden = [], faces = 1, far = this._far, motion = {}) {
    const { renderer, raw } = this;
    const cut = !this._filled || this._at.distanceTo(position) > CUT;
    const count = cut ? 6 : Math.min(6, Math.max(1, Math.round(faces)));
    this._at.copy(position);
    this.uniforms.probeCenter.value.copy(position);

    // which faces: the ones that have waited longest, weighted by how fast what they see goes by
    const v = motion.velocity;
    const speed = v ? v.length() : 0;
    const side = SIDE_GAIN * Math.min(1, speed / FULL_SPEED);
    if (speed > 1e-3) heading.copy(v).divideScalar(speed);
    for (let f = 0; f < 6; f++) {
      const look = FACES[f].look;
      if (f === 2) this._weight[f] = 1;
      else if (f === 3) this._weight[f] = DOWN_WEIGHT;
      else this._weight[f] = 1 + (speed > 1e-3 ? side * (1 - Math.abs(heading.x * look[0] + heading.z * look[2])) : 0);
      this._age[f]++;
    }
    const order = this._order;
    order.sort((a, b) => this._age[b] * this._weight[b] - this._age[a] * this._weight[a] || a - b);

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    for (let i = 0; i < hidden.length; i++) {
      this._wasVisible[i] = hidden[i].visible;
      hidden[i].visible = false;
    }

    for (let k = 0; k < count; k++) {
      const face = cut ? k : order[k];
      this._age[face] = 0;
      const camera = this._cameras[face];
      camera.position.copy(position);
      if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      // The shadow maps are the main view's and stay as they are. Only when the whole cube is drawn at once
      // (the very first frame may not have any yet) does the first face draw them.
      renderer.shadowMap.autoUpdate = shadowUpdate && !this._filled && k === 0;
      // the raw cube's plain mips (the filter's source) are made once, after the last face of this update
      raw.texture.mipmapsAutoUpdate = k === count - 1;
      renderer.setRenderTarget(raw, face);
      renderer.render(scene, camera);
    }
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = this._wasVisible[i];
    renderer.shadowMap.autoUpdate = shadowUpdate;

    // the filter: level 0 and `levelsPerUpdate` of the rough ones, every face, eased in by the time since that level
    // was last filtered (all of them at once after a cut)
    const time = motion.time;
    const u = this._filter.uniforms;
    let passes = 0;
    const filterLevel = (level) => {
      let share = 1;
      if (!cut && this.fade > 0 && time !== undefined) {
        const dt = Math.max(0, time - this._levelTime[level]);
        share = 1 - Math.exp(-dt / this.fade);
      }
      if (time !== undefined) this._levelTime[level] = time;
      // a level whose share rounds to nothing is left as it is
      if (share < 0.004) return;
      u.uAlpha.value = level === 0 ? 0 : Math.pow(2, level - (this.levels - 1));
      u.uBlend.value = share;
      // a render target's viewport is its level 0's: set it to this level's size while drawing into it
      const edge = Math.max(1, this.size >> level);
      this.target.viewport.set(0, 0, edge, edge);
      for (let face = 0; face < 6; face++) {
        u.uFace.value = face;
        renderer.setRenderTarget(this.target, face, level);
        renderer.render(this._pass, passCamera);
        passes++;
      }
      this.target.viewport.set(0, 0, this.size, this.size);
    };
    filterLevel(0);
    const rough = cut ? this.levels - 1 : this.levelsPerUpdate;
    for (let k = 0; k < rough; k++) {
      filterLevel(this._nextLevel);
      this._nextLevel = this._nextLevel + 1 >= this.levels ? 1 : this._nextLevel + 1;
    }

    renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
    this._filled = true;
    this.stats.faces = count;
    this.stats.passes = passes;
  }

  /**
   * The local proxy the materials' parallax correction uses until it is set again: the ground's plane (normal and a
   * point on it), and optionally a box (`box`: world to the box's own -1..1 cube; null: none).
   * @param {THREE.Vector3|null} normal
   * @param {THREE.Vector3|null} point
   * @param {THREE.Matrix4|null} [box]
   */
  setProxy(normal, point, box = null) {
    const u = this.uniforms;
    if (normal && point) u.probePlane.value.set(normal.x, normal.y, normal.z, -normal.dot(point));
    u.probeProxy.value.set(normal && point ? 1 : 0, box ? 1 : 0);
    if (box) u.probeBox.value.copy(box);
  }

  /** Forget what was drawn (after a lost WebGL context): the next update draws all six faces again. */
  reset() {
    this._filled = false;
    this._age.fill(0);
    this._nextLevel = 1;
    this._levelTime.fill(-Infinity);
  }

  dispose() {
    this.raw.dispose();
    this.target.dispose();
    this._filter.dispose();
  }
}
