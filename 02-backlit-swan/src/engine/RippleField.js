// Ripples on still water, simulated on the GPU.
//
// A square window of the surface (`extent` metres across, `size` texels) holds
// the height of the water and how fast it is moving. Each step every texel is
// pulled toward the average of its four neighbours, which is all the wave
// equation asks for: a dent turns into rings that spread, cross and fade.
//
// There is one field, and everything that needs ripples reads it: the water
// shader bends its reflections with the slopes, things that float read the
// height. Poke it with disturb().
//
// Two textures are involved:
//   state  (private)  height and velocity, at full precision, read texel by texel
//   field  (public)   height, dHeight/dx, dHeight/dz, ready to be read with
//                     linear filtering through rippleSample() in `glsl`
//
// The window follows a point (the swan) by whole texels: when it moves, the
// next step reads the old state shifted by that many texels, so the water
// stays where it was in the world and nothing swims with the window.

import * as THREE from 'three';
import { createPassMaterial } from './material.js';
import { FullscreenPass } from './FullscreenPass.js';

/** Seconds of water time per simulation step. Small, so that slow motion still moves smoothly. */
const SUBSTEP = 1 / 240;
/** At most this many steps per call; more would mean the page hung, and that time is dropped. */
const MAX_SUBSTEPS = 8;
/** Disturbances applied in one step. More than that wait for the following steps. */
const DISTURB_MAX = 8;
/** How many past disturbances the CPU-side estimate remembers. */
const MEMORY = 32;

// Where there are no float targets at all, height and velocity are stored as
// 16-bit fixed point in two bytes each. These are the ranges that maps to.
const PACK_HEIGHT = 0.25; // metres, +-
const PACK_VELOCITY = 0.02; // metres per step, +-
// The public field in 8 bits: height is coarse there (it only bobs things),
// slopes get the precision of an ordinary normal map.
const FIELD8_HEIGHT = 0.05; // metres, +-
const FIELD8_SLOPE = 0.6; // rise over run, +-

// The two halves of reading and writing the state texture. Zero must be
// exactly representable in the packed form (hence 65534 steps, not 65535):
// otherwise still water would carry a tiny tilt that never settles.
const WRITE_STATE = /* glsl */ `
#ifdef PACKED
vec2 pack16(float v) {
  float x = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65534.0 + 0.5);
  float hi = floor(x / 256.0);
  return vec2(hi, x - hi * 256.0) / 255.0;
}
vec4 writeState(vec2 s) {
  return vec4(pack16(s.x / ${PACK_HEIGHT.toFixed(4)}), pack16(s.y / ${PACK_VELOCITY.toFixed(4)}));
}
#else
vec4 writeState(vec2 s) { return vec4(s, 0.0, 1.0); }
#endif
`;

const READ_STATE = /* glsl */ `
#ifdef PACKED
float unpack16(vec2 p) {
  return (dot(floor(p * 255.0 + 0.5), vec2(256.0, 1.0)) / 65534.0) * 2.0 - 1.0;
}
vec2 readState(ivec2 p) {
  vec4 t = texelFetch(uState, p, 0);
  return vec2(unpack16(t.rg) * ${PACK_HEIGHT.toFixed(4)}, unpack16(t.ba) * ${PACK_VELOCITY.toFixed(4)});
}
#else
vec2 readState(ivec2 p) { return texelFetch(uState, p, 0).rg; }
#endif
// Outside the window the water is flat and still.
vec2 stateAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= SIZE || p.y >= SIZE) return vec2(0.0);
  return readState(p);
}
`;

const STEP_FRAGMENT = /* glsl */ `
uniform sampler2D uState;
uniform ivec2 uShift;      // how many texels the window moved since the state was written
uniform vec4 uRect;        // window: min corner (x, z) in metres, texel size, 1 / extent
uniform vec4 uWave;        // (c dt / dx)^2, velocity kept per step, pull back to level, unused
uniform vec4 uDisturb[${DISTURB_MAX}]; // x, z, radius, strength
uniform int uDisturbCount;
${READ_STATE}${WRITE_STATE}
void main() {
  ivec2 here = ivec2(gl_FragCoord.xy);
  ivec2 p = here + uShift;
  vec2 c = stateAt(p);
  float around = stateAt(p + ivec2(1, 0)).x + stateAt(p - ivec2(1, 0)).x
               + stateAt(p + ivec2(0, 1)).x + stateAt(p - ivec2(0, 1)).x;
  float h = c.x;
  float v = c.y;
  // velocity first, then height with the new velocity: this order keeps the energy from creeping up
  v = (v + uWave.x * (around - 4.0 * h) - uWave.z * h) * uWave.y;
  h += v;

  // A sponge round the edge of the window swallows waves that reach it, so
  // that nothing bounces back off a wall that is not there in the world.
  vec2 uv = gl_FragCoord.xy / float(SIZE);
  vec2 e = min(uv, 1.0 - uv);
  float sponge = smoothstep(0.0, 0.08, min(e.x, e.y));
  float keep = mix(0.90, 1.0, sponge);
  h *= keep;
  v *= keep;

  // Disturbances move water without adding or removing any: a dip with a
  // raised ring round it (the "Mexican hat"), whose volume sums to zero.
  // It is added as a displacement only, the velocity stays as it is.
  vec2 xz = uRect.xy + gl_FragCoord.xy * uRect.z;
  for (int i = 0; i < ${DISTURB_MAX}; i++) {
    if (i >= uDisturbCount) break;
    vec4 d = uDisturb[i];
    vec2 q = (xz - d.xy) / d.z;
    float r2 = dot(q, q);
    if (r2 < 16.0) h += d.w * (1.0 - r2) * exp(-r2) * sponge;
  }
  outColor = writeState(vec2(clamp(h, -0.24, 0.24), v));
}
`;

const FIELD_FRAGMENT = /* glsl */ `
uniform sampler2D uState;
uniform vec4 uRect;
${READ_STATE}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float h = stateAt(p).x;
  // slopes by central differences, in metres per metre
  float dx = (stateAt(p + ivec2(1, 0)).x - stateAt(p - ivec2(1, 0)).x) / (2.0 * uRect.z);
  float dz = (stateAt(p + ivec2(0, 1)).x - stateAt(p - ivec2(0, 1)).x) / (2.0 * uRect.z);
#ifdef FIELD8
  // 254 steps, so that "level" is exactly the byte 127
  vec3 f = clamp(vec3(h / ${FIELD8_HEIGHT.toFixed(4)}, vec2(dx, dz) / ${FIELD8_SLOPE.toFixed(4)}), -1.0, 1.0);
  outColor = vec4((f * 0.5 + 0.5) * (254.0 / 255.0), 1.0);
#else
  outColor = vec4(h, dx, dz, 1.0);
#endif
}
`;

const CLEAR_FRAGMENT = /* glsl */ `
${WRITE_STATE}
void main() { outColor = writeState(vec2(0.0)); }
`;

export class RippleField {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [options]
   * @param {number} [options.size] texels along one side of the window
   * @param {number} [options.extent] metres along one side of the window
   * @param {number} [options.speed] how fast rings travel, in m/s
   * @param {number} [options.damping] how fast they fade, in 1/s
   * @param {boolean} [options.ldr] force the 8-bit packed fallback (testing)
   */
  constructor(renderer, { size = 256, extent = 12, speed = 0.42, damping = 0.35, ldr = false } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    this.texel = extent / size;
    this.speed = speed;
    this.damping = damping;

    const ext = renderer.extensions;
    const half = !ldr && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    const full = !ldr && ext.has('EXT_color_buffer_float');
    /**
     * 'float': 32-bit state (the good case). 'half': 16-bit float state, which
     * loses the smallest movements, so ripples die a little early. 'packed':
     * no float targets at all, 8-bit targets with hand-packed fixed point.
     */
    this.precision = full ? 'float' : half ? 'half' : 'packed';
    const packed = this.precision === 'packed';

    const stateOptions = {
      type: full ? THREE.FloatType : half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: packed ? THREE.RGBAFormat : THREE.RGFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this._read = new THREE.WebGLRenderTarget(size, size, stateOptions);
    this._write = new THREE.WebGLRenderTarget(size, size, stateOptions);
    this._field = new THREE.WebGLRenderTarget(size, size, {
      ...stateOptions,
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // The window's min corner in texels (always whole), now and where follow() wants it.
    this._origin = { x: -size / 2, z: -size / 2 };
    this._wanted = { x: -size / 2, z: -size / 2 };
    this._rect = new THREE.Vector4();

    /** For materials that read the field: share these objects. */
    this.uniforms = {
      uRippleTex: { value: this._field.texture },
      /** min corner x, min corner z, 1 / extent, texel size (all in metres) */
      uRippleRect: { value: new THREE.Vector4() },
    };

    /**
     * GLSL for any stage (it uses textureLod, so vertex shaders may call it
     * too). rippleSample(xz) returns the height of the water in metres and its
     * slopes dHeight/dx and dHeight/dz; all three are zero outside the window.
     */
    this.glsl = /* glsl */ `
uniform sampler2D uRippleTex;
uniform vec4 uRippleRect;
vec3 rippleSample(vec2 xz) {
  vec2 uv = (xz - uRippleRect.xy) * uRippleRect.z;
  vec2 e = min(uv, 1.0 - uv);
  float inside = smoothstep(0.0, 0.03, min(e.x, e.y));
  vec3 t = textureLod(uRippleTex, uv, 0.0).xyz;
  ${half ? '' : `t = (t * (255.0 / 254.0) * 2.0 - 1.0) * vec3(${FIELD8_HEIGHT.toFixed(4)}, ${FIELD8_SLOPE.toFixed(4)}, ${FIELD8_SLOPE.toFixed(4)});`}
  return t * inside;
}
`;

    const defines = { SIZE: size, ...(packed ? { PACKED: 1 } : {}), ...(half ? {} : { FIELD8: 1 }) };
    // these passes read and write raw numbers, never colours: the caps given
    // here only stop createPassMaterial from adding the colour encoding
    const raw = { hdr: true };
    this._disturbUniform = Array.from({ length: DISTURB_MAX }, () => new THREE.Vector4());
    this._stepPass = new FullscreenPass(
      createPassMaterial(raw, {
        fragmentShader: STEP_FRAGMENT,
        defines,
        uniforms: {
          uState: { value: null },
          uShift: { value: new THREE.Vector2() },
          uRect: { value: this._rect },
          uWave: { value: new THREE.Vector4() },
          uDisturb: { value: this._disturbUniform },
          uDisturbCount: { value: 0 },
        },
      }),
    );
    this._fieldPass = new FullscreenPass(
      createPassMaterial(raw, {
        fragmentShader: FIELD_FRAGMENT,
        defines,
        uniforms: { uState: { value: null }, uRect: { value: this._rect } },
      }),
    );
    this._clearPass = new FullscreenPass(createPassMaterial(raw, { fragmentShader: CLEAR_FRAGMENT, defines }));

    this._queue = []; // disturbances waiting for a step: [x, z, radius, strength]
    this._memory = []; // recent ones, for heightAt(): { x, z, radius, strength, time }
    this._accumulator = 0;
    /** Seconds of water time simulated so far. */
    this.time = 0;
    this._updateRect();
    this.reset();
  }

  _updateRect() {
    const { texel, extent } = this;
    this._rect.set(this._origin.x * texel, this._origin.z * texel, texel, 1 / extent);
    this.uniforms.uRippleRect.value.set(this._origin.x * texel, this._origin.z * texel, 1 / extent, texel);
  }

  /** Flat, still water (also needed after a lost WebGL context: the state lived on the GPU). */
  reset() {
    this._clearPass.render(this.renderer, this._read);
    this._clearPass.render(this.renderer, this._write);
    this._fieldPass.material.uniforms.uState.value = this._read.texture;
    this._fieldPass.render(this.renderer, this._field);
    this._queue.length = 0;
    this._memory.length = 0;
    this._accumulator = 0;
  }

  /**
   * Push the water down (positive strength) or up at a point; rings spread from there.
   * @param {number} x metres
   * @param {number} z metres
   * @param {number} radius metres; about the radius of the dent
   * @param {number} strength metres; depth of the dent at its centre
   */
  disturb(x, z, radius, strength) {
    // a dent narrower than two texels cannot be represented and would only flicker
    const r = Math.max(radius, this.texel * 1.5);
    this._queue.push([x, z, r, -strength]);
    this._memory.push({ x, z, radius: r, strength: -strength, time: this.time });
    if (this._memory.length > MEMORY) this._memory.shift();
  }

  /**
   * Keep the simulated window centred near a point. It moves by whole texels,
   * and only at the next step, so the water never slides.
   */
  follow(x, z) {
    this._wanted.x = Math.round(x / this.texel) - this.size / 2;
    this._wanted.z = Math.round(z / this.texel) - this.size / 2;
  }

  /**
   * Advance the water by `dt` seconds (already scaled for slow motion). The
   * simulation itself always moves in steps of 1/240 s, so its behaviour does
   * not depend on the frame rate; time that does not fill a step is kept for
   * the next call.
   */
  step(dt) {
    this._accumulator += dt;
    let steps = Math.floor(this._accumulator / SUBSTEP + 1e-6);
    if (steps <= 0) return;
    this._accumulator -= steps * SUBSTEP;
    if (steps > MAX_SUBSTEPS) {
      steps = MAX_SUBSTEPS;
      this._accumulator = 0;
    }
    const u = this._stepPass.material.uniforms;
    // (c dt / dx)^2 must stay below 0.5 for the scheme to be stable; with these
    // step sizes it is far below, the clamp only guards against odd settings
    const k = Math.min(0.45, (this.speed * SUBSTEP / this.texel) ** 2);
    u.uWave.value.set(k, Math.exp(-this.damping * SUBSTEP), 0.00002, 0);

    for (let i = 0; i < steps; i++) {
      // the window moves between steps, never during one
      const shiftX = this._wanted.x - this._origin.x;
      const shiftZ = this._wanted.z - this._origin.z;
      this._origin.x = this._wanted.x;
      this._origin.z = this._wanted.z;
      this._updateRect();
      u.uShift.value.set(shiftX, shiftZ);

      const count = Math.min(DISTURB_MAX, this._queue.length);
      for (let j = 0; j < count; j++) this._disturbUniform[j].fromArray(this._queue[j]);
      this._queue.splice(0, count);
      u.uDisturbCount.value = count;

      u.uState.value = this._read.texture;
      this._stepPass.render(this.renderer, this._write);
      const t = this._read;
      this._read = this._write;
      this._write = t;
      this.time += SUBSTEP;
    }
    this._fieldPass.material.uniforms.uState.value = this._read.texture;
    this._fieldPass.render(this.renderer, this._field);
  }

  /**
   * A cheap guess at the water's height at a point, without asking the GPU
   * (reading pixels back would stall the frame). It replays the remembered
   * disturbances as ideal rings. Good enough to bob something; not the value
   * the shaders see.
   * @returns {number} metres
   */
  heightAt(x, z) {
    let h = 0;
    for (const d of this._memory) {
      const age = this.time - d.time;
      const dist = Math.hypot(x - d.x, z - d.z);
      const q = (dist - this.speed * age) / d.radius;
      const q2 = q * q;
      if (q2 > 16) continue;
      // a ring thins out as it grows (energy over a longer circle) and fades with the damping
      const fade = Math.exp(-this.damping * age) / Math.sqrt(1 + (this.speed * age) / d.radius);
      h += d.strength * (1 - q2) * Math.exp(-q2) * fade;
    }
    return h;
  }

  dispose() {
    this._read.dispose();
    this._write.dispose();
    this._field.dispose();
    this._stepPass.dispose();
    this._fieldPass.dispose();
    this._clearPass.dispose();
  }
}
