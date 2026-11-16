// What the camera's glass and sensor do to the picture.
//
// After a view has been drawn, its pixels are copied into a texture and drawn
// back through one shader that does two jobs:
//
//   Rain on the glass. Spray, hard landings and above all another boat's plume
//   put droplets on it. A droplet lands and sits; more land on it and it
//   swells; when it is too heavy to hang on it lets go and runs down the
//   glass, in fits and starts, gathering up what lies in its way and leaving a
//   wet track and a string of beads behind it; what is left dries. Every drop
//   is a small lens holding the whole scene upside down, and a soaked glass
//   mists over except where a drop has just wiped it.
//
//   The drops are simulated here, a few hundred of them per view. They are
//   drawn each frame into a small "glass map": red is a smooth field that is
//   high inside drops (cut at a threshold, it gives drops that are crisp at
//   any size and flow into one another when they touch), alpha is the wet
//   track, which is not wiped between frames but left to dry slowly. The
//   finishing shader reads that map.
//
//   The look. A glow round whatever is bright (the sun on the water, white
//   foam), a little sharpening, firmer contrast and colour, darker corners.
//   This is most of the difference between a picture that looks rendered and
//   one that looks photographed.
//
// Phones get the rain only, and the pass is skipped while their glass is dry.

import * as THREE from 'three';
import { makeRng } from '../engine/math.js';

/** At most this many drops on one glass. */
const MAX_DROPS = 460;
/** How many droplets land for each unit of wetness the game adds (1 would soak dry glass). */
const DROPS_PER_WET = 130;
/** Drops are simulated at this rate, whatever the game is stepped at. */
const STEP = 1 / 60;
/** Where the drop field is cut: at a drop's rim it has this value. Also in the shaders below. */
const RIM = 0.4;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// What is bright enough to glow, at half size (each pixel is the average of four).
const brightShader = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 lit(vec2 uv) {
  vec3 c = textureLod(uScene, uv, 0.0).rgb;
  float top = max(c.r, max(c.g, c.b));
  return c * smoothstep(0.8, 1.0, top);
}
void main() {
  vec2 o = uTexel * 0.5;
  vec3 sum = lit(vUv + o) + lit(vUv - o) + lit(vUv + vec2(o.x, -o.y)) + lit(vUv + vec2(-o.x, o.y));
  gl_FragColor = vec4(sum * 0.25, 1.0);
}
`;

// ---- the glass map

// Before the drops are drawn: the drop field fades fast (so a drop that has moved on leaves only a short tail, and
// one that has just landed swells into place), the wet tracks dry slowly.
const fadeShader = /* glsl */ `
precision highp float;
uniform vec4 uFade;   // rgb: what is kept of the drop field; a: how much is taken off the tracks
void main() {
  gl_FragColor = uFade;
}
`;

// One drop: a quad that covers the drop where it is now and the line from where it was a frame ago.
// Places are in units of the view's height: x from 0 to the aspect ratio, y from 0 (bottom) to 1.
const dropVertex = /* glsl */ `
attribute vec4 aPath;   // where it was (xy) and where it is (zw)
attribute vec2 aDrop;   // radius; how much of a track it leaves (0 while it sits)
uniform float uAspect;
varying vec2 vAt;
varying vec2 vFrom;
varying vec2 vTo;
varying vec2 vDrop;
void main() {
  vec2 a = aPath.xy;
  vec2 b = aPath.zw;
  vec2 d = b - a;
  float run = length(d);
  vec2 along = run > 1.0e-5 ? d / run : vec2(0.0, 1.0);
  vec2 across = vec2(along.y, -along.x);
  float reach = aDrop.x * 1.34;
  vec2 p = (a + b) * 0.5 + along * position.y * (run * 0.5 + reach) + across * position.x * reach;
  vAt = p;
  vFrom = a;
  vTo = b;
  vDrop = aDrop;
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);
}
`;
const dropFragment = /* glsl */ `
precision highp float;
uniform float uGain;
varying vec2 vAt;
varying vec2 vFrom;
varying vec2 vTo;
varying vec2 vDrop;
void main() {
  // the drop: 1 at its middle, ${RIM} at its rim, nothing a little beyond
  float rho = length(vAt - vTo) / vDrop.x;
  float field = clamp(1.0 - rho * rho * ${(1 - RIM).toFixed(2)}, 0.0, 1.0);
  // its track: the line it has just run along, narrower than the drop
  vec2 ab = vTo - vFrom;
  float h = clamp(dot(vAt - vFrom, ab) / max(dot(ab, ab), 1.0e-9), 0.0, 1.0);
  float off = length(vAt - vFrom - ab * h) / (vDrop.x * 0.6);
  gl_FragColor = vec4(field * uGain, 0.0, 0.0, vDrop.y * smoothstep(1.0, 0.25, off));
}
`;

// ---- the finishing pass

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uScene;   // the view as it was just drawn (display colours), with coarser copies when it is raining
uniform sampler2D uBright;  // its highlights at half size, with coarser copies
uniform sampler2D uGlass;   // the glass map: r drops, a wet tracks
uniform vec2 uTexel;        // one pixel of the view
uniform vec2 uGlassTexel;   // one texel of the glass map
uniform float uTime;
uniform vec4 uWater;        // how wet the glass is; a sheet of water running off it; 1 if there is anything on the glass; mist
uniform vec4 uLook;         // glow, sharpening, grade, dark corners
varying vec2 vUv;

float hash1(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1317, 0.1113, 0.0971));
  q += dot(q, q.yzx + 31.27);
  return fract((q.x + q.y) * q.z);
}

vec3 tent(sampler2D map, vec2 uv, vec2 texel, float lod) {
  vec2 o = texel * exp2(lod) * 0.5;
  return (textureLod(map, uv + o, lod).rgb + textureLod(map, uv - o, lod).rgb
        + textureLod(map, uv + vec2(o.x, -o.y), lod).rgb + textureLod(map, uv + vec2(-o.x, o.y), lod).rgb) * 0.25;
}

void main() {
  vec2 uv = vUv;
  float sheet = uWater.y;
  float drop = 0.0;        // how much of a drop is here
  vec2 on = vec2(0.0);     // where this is on that drop: 0 at its middle, length 1 at its rim
  float size = 0.0;        // its radius, in units of the view's height
  float film = 0.0;        // how much wet track is here
  vec2 slope = vec2(0.0);  // which way the track's surface rises

  if (uWater.z > 0.5) {
    vec4 here = texture2D(uGlass, vUv);
    vec4 east = texture2D(uGlass, vUv + vec2(uGlassTexel.x, 0.0));
    vec4 west = texture2D(uGlass, vUv - vec2(uGlassTexel.x, 0.0));
    vec4 north = texture2D(uGlass, vUv + vec2(0.0, uGlassTexel.y));
    vec4 south = texture2D(uGlass, vUv - vec2(0.0, uGlassTexel.y));
    // a drop is wherever the field is above its rim value; two that touch flow together. The glass is far nearer
    // than what the camera is focused on, so its edge is soft
    drop = smoothstep(${RIM.toFixed(2)} - 0.15, ${RIM.toFixed(2)} + 0.13, here.r);
    vec2 rise = vec2(east.r - west.r, north.r - south.r) * 0.5;
    float steep = length(rise);
    // the field falls away from the middle as the square of the distance, which tells how far out this is
    float rho = sqrt(clamp((1.0 - here.r) / ${(1 - RIM).toFixed(2)}, 0.0, 1.0));
    on = steep > 1.0e-5 ? -rise / steep * rho : vec2(0.0);
    size = ${(2 * (1 - RIM)).toFixed(2)} * rho / max(steep, 1.0e-4) * uGlassTexel.y;
    film = here.a * (1.0 - drop);
    slope = vec2(east.a - west.a, north.a - south.a) * 0.5;

    // a wet track is a long thin lens: it shifts what is seen through its flanks
    uv -= slope * (1.0 - drop) * vec2(0.05 * uTexel.x / uTexel.y, 0.05);
    // and a sheet of water running off wobbles everything behind it
    uv += sheet * 0.006 * vec2(sin(uv.y * 31.0 + uTime * 9.0 + sin(uv.x * 9.0) * 2.0), cos(uv.x * 23.0 - uTime * 6.0));
  }

  // the picture: soft where the glass has misted over (least in the middle, where the wind is strongest),
  // clear where a drop has just passed
  float clear = max(drop, smoothstep(0.0, 0.35, film));
  float haze = uWater.w * (1.0 - clear) * (0.3 + 0.7 * smoothstep(0.08, 0.5, length(vUv - vec2(0.5, 0.45)))) + sheet * 1.1 + film * 0.9;
  vec3 col = haze > 0.01 ? tent(uScene, uv, uTexel, haze) : textureLod(uScene, uv, 0.0).rgb;

  // sharpen what is soft, leave what is already hard-edged: push each pixel away from its neighbours' average
  if (uLook.y > 0.0 && haze < 0.5) {
    vec3 a = textureLod(uScene, uv + vec2(uTexel.x, 0.0), 0.0).rgb;
    vec3 b = textureLod(uScene, uv - vec2(uTexel.x, 0.0), 0.0).rgb;
    vec3 c = textureLod(uScene, uv + vec2(0.0, uTexel.y), 0.0).rgb;
    vec3 d = textureLod(uScene, uv - vec2(0.0, uTexel.y), 0.0).rgb;
    vec3 lo = min(col, min(min(a, b), min(c, d)));
    vec3 hi = max(col, max(max(a, b), max(c, d)));
    float range = max(hi.r - lo.r, max(hi.g - lo.g, hi.b - lo.b));
    float k = uLook.y * (1.0 - smoothstep(0.1, 0.45, range)) * (1.0 - haze * 2.0);
    col = clamp(col + (col - (a + b + c + d) * 0.25) * k, 0.0, 1.0);
  }

  // the light a wet track catches: darker where it is steep, bright on the flank toward the sun
  if (film > 0.0) {
    float edge = length(slope);
    col *= 1.0 - min(0.2, edge * 1.3) * (1.0 - drop);
    col += vec3(0.9, 0.95, 1.0) * (0.05 * film + 0.55 * max(dot(slope, vec2(0.6, -0.8)), 0.0)) * (1.0 - drop);
  }
  // a drop is a small lens, out of focus: through it the view is blurred, turned over and a little brighter,
  // with light gathered along its lower edge
  if (drop > 0.0) {
    float rim = dot(on, on);
    float big = smoothstep(0.004, 0.014, size);
    vec2 through = uv - on * vec2(0.07 * uTexel.x / uTexel.y, 0.07) * (0.35 + 0.65 * big);
    vec3 held = textureLod(uScene, clamp(through, 0.003, 0.997), 2.2 + 1.2 * big).rgb;
    held = mix(held, vec3(1.0), 0.06 + 0.16 * smoothstep(0.25, 1.0, rim) * smoothstep(0.35, -0.85, on.y));
    held *= 1.0 - 0.2 * smoothstep(0.3, 1.0, rim) * smoothstep(-0.35, 0.85, on.y);
    held += vec3(1.0, 0.98, 0.95) * 0.2 * big * smoothstep(0.42, 0.0, length(on - vec2(-0.3, 0.38)));
    col = mix(col, held, drop * 0.92);
  }

  // glow: what is bright spills into its surroundings
  if (uLook.x > 0.0) {
    vec2 bt = uTexel * 2.0;
    vec3 glow = tent(uBright, vUv, bt, 1.0) * 0.42 + tent(uBright, vUv, bt, 2.6) * 0.34 + tent(uBright, vUv, bt, 4.2) * 0.3;
    col = 1.0 - (1.0 - col) * (1.0 - min(glow * uLook.x, 1.0));
  }

  // grade: a little more colour, firmer contrast
  float g = uLook.z;
  if (g > 0.0) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, 1.0 + 0.08 * g);
    col = clamp(col, 0.0, 1.0);
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.16 * g);
  }
  // darker corners
  col *= 1.0 - uLook.w * smoothstep(0.42, 1.05, length((vUv - 0.5) * vec2(1.0, 0.86)) * 1.3);
  // a grain too fine to see, so that the soft gradients above do not band
  col += (hash1(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class Lens {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ look?: boolean, low?: boolean, seed?: number }} [o] `look`: the glow, sharpening and grade as well as
   *   the rain; `low`: a coarser glass map (phones); `seed`: which rain this glass gets
   */
  constructor(renderer, { look = true, low = false, seed = 1 } = {}) {
    this.renderer = renderer;
    this.look = look;
    this.low = low;
    /** How wet the glass is, 0 (dry) to 1 (a downpour): what mists it over. */
    this.wet = 0;
    /** A sheet of water running off after a soaking, 0 to 1. */
    this.sheet = 0;
    this.time = 0;
    /** Width over height of the view. Drops live in units of its height: x from 0 to this, y from 0 (bottom) to 1. */
    this.aspect = 16 / 9;
    // Its own random numbers: the rain on the glass must not change what the rest of the game draws from Math.random.
    this._rng = makeRng(9173 + seed * 131);

    // ---- the drops, as parallel arrays
    const field = () => new Float32Array(MAX_DROPS);
    this.count = 0;
    this.x = field();
    this.y = field();
    this.r = field(); // radius
    this.vx = field();
    this.vy = field();
    this.px = field(); // where it was when it was last drawn
    this.py = field();
    this.fall = field(); // the size at which it will let go
    this.hold = field(); // seconds it will still hang on once it is that size
    this.run = field(); // 1 while it is running down
    this.wander = field(); // which way it is drifting sideways
    this.gone = field(); // how far it has run since it last left a bead
    this.next = field(); // how far it will run before the next one
    this.caught = field(); // seconds it is held up for
    this._fields = [this.x, this.y, this.r, this.vx, this.vy, this.px, this.py, this.fall, this.hold, this.run, this.wander, this.gone, this.next, this.caught];
    this._owed = 0; // droplets still to land
    this._gained = 0; // wetness added since the last step
    this._inflow = 0; // wetness arriving per second, smoothed
    this._simTime = 0; // time not yet simulated
    this._merge = 0;
    this._wet = 0; // seconds for which there may still be wet tracks on the glass
    this._wipe = true; // the glass map is to be cleared
    this._frameDt = 1 / 60;
    this._fadeOwed = 0;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const plane = new THREE.PlaneGeometry(2, 2);
    const flat = { vertexShader, depthTest: false, depthWrite: false };

    this.brightMaterial = new THREE.ShaderMaterial({
      name: 'LensBright',
      fragmentShader: brightShader,
      uniforms: { uScene: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ...flat,
    });
    this.brightScene = new THREE.Scene();
    this.brightScene.add(new THREE.Mesh(plane, this.brightMaterial));

    // the glass map: first what is there fades (colour is multiplied, alpha has a little taken off) ...
    this.fadeMaterial = new THREE.ShaderMaterial({
      name: 'LensFade',
      fragmentShader: fadeShader,
      uniforms: { uFade: { value: new THREE.Vector4(0, 0, 0, 1) } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.ReverseSubtractEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      ...flat,
    });
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(new THREE.Mesh(plane, this.fadeMaterial));

    // ... then the drops are added to the field, and their tracks laid over what is left of the old ones
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this._path = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._drop = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aPath', this._path);
    quad.setAttribute('aDrop', this._drop);
    quad.instanceCount = 0;
    this.dropMaterial = new THREE.ShaderMaterial({
      name: 'LensDrops',
      vertexShader: dropVertex,
      fragmentShader: dropFragment,
      uniforms: { uAspect: { value: this.aspect }, uGain: { value: 0.2 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.drops = new THREE.Mesh(quad, this.dropMaterial);
    this.dropScene = new THREE.Scene();
    this.dropScene.add(this.drops);

    this.material = new THREE.ShaderMaterial({
      name: 'Lens',
      fragmentShader,
      uniforms: {
        uScene: { value: null },
        uBright: { value: null },
        uGlass: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uGlassTexel: { value: new THREE.Vector2(1 / 640, 1 / 360) },
        uTime: { value: 0 },
        uWater: { value: new THREE.Vector4() },
        uLook: { value: new THREE.Vector4() },
      },
      ...flat,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(plane, this.material));
    for (const s of [this.scene, this.brightScene, this.fadeScene, this.dropScene]) s.children[0].frustumCulled = false;

    this.copy = null; // the view's pixels (FramebufferTexture), remade to fit the view
    this.bright = null; // its highlights at half size (WebGLRenderTarget)
    this.glass = null; // the glass map (WebGLRenderTarget)
    this._corner = new THREE.Vector2();
  }

  /** Dry, clean glass. */
  clear() {
    this.wet = 0;
    this.sheet = 0;
    this.count = 0;
    this._owed = 0;
    this._gained = 0;
    this._inflow = 0;
    this._wet = 0;
    this._wipe = true;
  }

  /**
   * Water reaches the lens.
   * @param {number} amount how much wetter the glass gets (1 would soak dry glass)
   * @param {number} [heavy] 0…1: how much of it arrives as one sheet (a hard landing)
   */
  splash(amount, heavy = 0) {
    this.wet = Math.min(1, this.wet + amount);
    this.sheet = Math.min(1, Math.max(this.sheet, heavy));
    this._owed += amount * DROPS_PER_WET;
    this._gained += amount;
    if (heavy > 0.05) {
      // a soaking: big drops that run at once, and whatever was hanging on the glass is shaken loose
      const rng = this._rng;
      const big = Math.round(3 + heavy * 9);
      for (let k = 0; k < big; k++) this._land(0.013 + rng() * 0.013 * (0.5 + heavy), true, rng() * this.aspect, 0.4 + rng() * 0.62);
      for (let i = 0; i < this.count; i++) if (this.r[i] > 0.0075) this.run[i] = 1;
    }
  }

  /**
   * The rain moves on, and the glass dries. Call once per step of the game, where the splashes are made, so that the
   * glass is in the same state when the game is being fast-forwarded as when it is being watched.
   * @param {number} dt
   * @param {number} speedK 0 (standing) .. 1 (flat out): the wind dries the glass and pushes the drops outward
   */
  update(dt, speedK) {
    this.wet = Math.max(0, this.wet - dt * (0.09 + 0.12 * speedK) * (0.35 + this.wet));
    this.sheet = Math.max(0, this.sheet - dt * 1.1);
    this._simTime += dt;
    while (this._simTime >= STEP) {
      this._simTime -= STEP;
      this._step(STEP, speedK);
    }
  }

  /** Call once per picture, with the time since the last one. */
  tick(frameDt) {
    this.time += frameDt;
    this._frameDt = frameDt;
  }

  // ------------------------------------------------------------ the drops

  _add(x, y, r) {
    if (this.count >= MAX_DROPS) return -1;
    const i = this.count++;
    const rng = this._rng;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.r[i] = r;
    this.vx[i] = this.vy[i] = 0;
    this.fall[i] = 0.016 + rng() * 0.009;
    this.hold[i] = 0.15 + rng() * 1.4;
    this.run[i] = 0;
    this.wander[i] = 0;
    this.gone[i] = 0;
    this.next[i] = r * (2 + rng() * 3);
    this.caught[i] = 0;
    return i;
  }

  _remove(i) {
    const last = --this.count;
    if (i !== last) for (const f of this._fields) f[i] = f[last];
  }

  /** A droplet lands. If there is a drop there already, the two become one. */
  _land(r, running = false, x = this._rng() * this.aspect, y = this._rng()) {
    for (let j = 0; j < this.count; j++) {
      const dx = this.x[j] - x;
      const dy = this.y[j] - y;
      const reach = this.r[j] + r * 0.5;
      if (dx * dx + dy * dy < reach * reach) {
        this.r[j] = Math.min(0.036, Math.hypot(this.r[j], r));
        if (running) this.run[j] = 1;
        return;
      }
    }
    const i = this._add(x, y, r);
    if (i >= 0 && running) this.run[i] = 1;
  }

  _step(dt, speedK) {
    const rng = this._rng;
    const aspect = this.aspect;
    this._inflow += (this._gained / dt - this._inflow) * Math.min(1, dt * 4);
    this._gained = 0;

    // new droplets land: most of them fine, a few fat
    while (this._owed >= 1) {
      this._owed -= 1;
      const u = rng();
      this._land(0.0058 + 0.0125 * u * u);
    }

    const swell = this._inflow * 0.0045; // fine spray feeds what is already there
    const dry = 0.00025 + 0.0011 * speedK;
    for (let i = this.count - 1; i >= 0; i--) {
      let r = this.r[i];
      if (!this.run[i]) {
        // it sits: swelling while water keeps arriving, drying when it does not (small ones first)
        r += (swell - dry * (0.4 + 0.004 / r)) * dt;
        if (r < 0.0036) {
          this._remove(i);
          continue;
        }
        this.r[i] = r;
        // too heavy to hang on: a moment more, and it lets go
        if (r > this.fall[i]) {
          this.hold[i] -= dt;
          if (this.hold[i] <= 0) this.run[i] = 1;
        }
        continue;
      }

      // it runs down the glass: the bigger the faster, and faster still when the boat is shaking at speed
      let vy = this.vy[i];
      if (this.caught[i] > 0) {
        this.caught[i] -= dt;
        vy *= Math.max(0, 1 - dt * 14);
      } else {
        const top = Math.min(0.95, Math.max(0.05, (r - 0.007) * 30)) * (1 + 0.4 * speedK);
        vy += (-top - vy) * Math.min(1, dt * 5);
        // small drops catch on the glass now and then; big ones run on
        if (rng() < dt * Math.max(0, 2.2 - r * 110)) this.caught[i] = 0.06 + rng() * 0.35;
      }
      // it wanders as it goes, and at speed the wind bears it outward from the middle
      this.wander[i] += (rng() - 0.5) * dt * 9 - this.wander[i] * dt * 1.6;
      const side = (this.x[i] - aspect * 0.5) / (aspect * 0.5);
      const vx = -vy * (0.85 * speedK * side * (0.35 + 0.65 * Math.abs(side)) + this.wander[i] * 0.45);
      this.vx[i] = vx;
      this.vy[i] = vy;
      const speed = Math.hypot(vx, vy);
      const step = speed * dt;
      this.x[i] += vx * dt;
      this.y[i] += vy * dt;

      // it leaves water behind: its track, and now and then a bead a little way back up it
      r -= step * 0.011;
      this.gone[i] += step;
      if (this.gone[i] > this.next[i] && speed > 0.02) {
        this.gone[i] = 0;
        this.next[i] = r * (2.4 + rng() * 3.6);
        const bead = r * (0.2 + 0.22 * rng());
        if (bead > 0.004) {
          const back = (r * 1.7) / speed;
          const k = this._add(this.x[i] - vx * back + (rng() - 0.5) * r * 0.6, this.y[i] - vy * back, bead);
          if (k >= 0) r = Math.sqrt(Math.max(r * r - bead * bead, 1e-8));
        }
      }
      if (r < 0.0064) {
        // run out: what is left of it stays where it is
        this.run[i] = 0;
        this.vx[i] = this.vy[i] = 0;
        this.fall[i] = r + 0.004 + rng() * 0.006;
        this.hold[i] = 0.3 + rng();
      }
      this.r[i] = r;
      if (this.y[i] < -0.07 || this.x[i] < -0.07 || this.x[i] > aspect + 0.07) this._remove(i);
    }

    // a running drop gathers up what lies in its way, and leans toward what lies just beside it
    for (let i = this.count - 1; i >= 0; i--) {
      if (!this.run[i]) continue;
      for (let j = this.count - 1; j >= 0; j--) {
        if (j === i) continue;
        const dx = this.x[j] - this.x[i];
        const dy = this.y[j] - this.y[i];
        const both = this.r[i] + this.r[j];
        const d2 = dx * dx + dy * dy;
        if (d2 < both * both * 0.8) {
          const a = this.r[i] * this.r[i];
          const b = this.r[j] * this.r[j];
          this.r[i] = Math.min(0.036, Math.sqrt(a + b));
          this.x[i] += (dx * b) / (a + b);
          this.y[i] += (dy * b) / (a + b);
          this._remove(j);
          if (i === this.count) i = j; // (the running drop was the last one, and has just been moved into the gap)
        } else if (dy < 0 && d2 < both * both * 7) {
          this.wander[i] += Math.sign(dx) * dt * 2.5;
        }
      }
    }

    // now and then, sitting drops that have grown into each other become one
    if (++this._merge % 12 === 0) {
      for (let i = this.count - 1; i > 0; i--) {
        if (this.run[i]) continue;
        for (let j = i - 1; j >= 0; j--) {
          if (this.run[j]) continue;
          const dx = this.x[j] - this.x[i];
          const dy = this.y[j] - this.y[i];
          const both = this.r[i] + this.r[j];
          if (dx * dx + dy * dy < both * both * 0.62) {
            const a = this.r[i] * this.r[i];
            const b = this.r[j] * this.r[j];
            // the smaller goes into the bigger
            const keep = a >= b ? i : j;
            const lose = a >= b ? j : i;
            this.r[keep] = Math.min(0.036, Math.sqrt(a + b));
            this._remove(lose);
            break;
          }
        }
        if (i >= this.count) i = this.count;
      }
    }
  }

  /** Is there anything on the glass to draw? */
  get raining() {
    return this.count > 0 || this._wet > 0 || this.sheet > 0.003 || this.wet > 0.003;
  }

  // -------------------------------------------------------------- drawing

  /** Draw the drops into the glass map. */
  _drawGlass(pw, ph) {
    const { renderer } = this;
    const aspect = pw / Math.max(1, ph);
    if (Math.abs(aspect - this.aspect) > 1e-4) {
      // the view has changed shape: the drops keep their places across it
      const k = aspect / this.aspect;
      for (let i = 0; i < this.count; i++) {
        this.x[i] *= k;
        this.px[i] *= k;
      }
      this.aspect = aspect;
    }
    // four fifths of the view's size: the field is smooth, so the drops stay crisp when it is stretched back
    const gh = Math.round(Math.min(this.low ? 600 : 900, Math.max(300, ph / 1.25)));
    const gw = Math.max(2, Math.round(gh * aspect));
    if (!this.glass || this.glass.width !== gw || this.glass.height !== gh) {
      if (this.glass) this.glass.dispose();
      this.glass = new THREE.WebGLRenderTarget(gw, gh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      this.material.uniforms.uGlass.value = this.glass.texture;
      this._wipe = true;
    }
    this.material.uniforms.uGlassTexel.value.set(1 / gw, 1 / gh);

    // where each drop is now (a little ahead of the last step it was moved in), and where it was last drawn
    const path = this._path.array;
    const drop = this._drop.array;
    const lead = this._simTime;
    let tracks = false;
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i] + this.vx[i] * lead;
      const y = this.y[i] + this.vy[i] * lead;
      let fromX = this.px[i];
      let fromY = this.py[i];
      if (!this.run[i] || Math.hypot(x - fromX, y - fromY) > 0.12) {
        fromX = x;
        fromY = y;
      }
      path[i * 4] = fromX;
      path[i * 4 + 1] = fromY;
      path[i * 4 + 2] = x;
      path[i * 4 + 3] = y;
      drop[i * 2] = this.r[i];
      drop[i * 2 + 1] = this.run[i] ? 0.92 : 0;
      if (this.run[i]) tracks = true;
      this.px[i] = x;
      this.py[i] = y;
    }
    this._path.needsUpdate = true;
    this._drop.needsUpdate = true;
    this.drops.geometry.instanceCount = this.count;
    this.dropMaterial.uniforms.uAspect.value = aspect;

    // The drop field keeps four fifths of itself from one sixtieth of a second to the next, and each drop adds the
    // other fifth of what it should be. The tracks dry by a fixed amount per second, a little faster in the wind;
    // the texture holds 255 levels, so that is taken off in whole levels as they fall due.
    const dt = Math.min(0.1, this._frameDt);
    const keep = this._wipe ? 0 : Math.pow(0.8, dt * 60);
    this._fadeOwed += dt * 0.13 * 255;
    const levels = Math.floor(this._fadeOwed);
    this._fadeOwed -= levels;
    this.fadeMaterial.uniforms.uFade.value.set(keep, keep, keep, this._wipe ? 1 : levels / 255);
    this.dropMaterial.uniforms.uGain.value = 1 - Math.pow(0.8, dt * 60);
    this._wipe = false;
    this._wet = tracks ? 8 : Math.max(0, this._wet - dt);

    renderer.setRenderTarget(this.glass);
    renderer.render(this.fadeScene, this.camera);
    if (this.count > 0) renderer.render(this.dropScene, this.camera);
    renderer.setRenderTarget(null);
  }

  /**
   * Finish the view that has just been drawn into the canvas.
   * @param {number} px @param {number} py lower-left corner of the view, device pixels
   * @param {number} pw @param {number} ph size of the view, device pixels
   * @param {{ rain?: boolean, look?: boolean }} [o] leave either job out
   */
  render(px, py, pw, ph, { rain = true, look = true } = {}) {
    const wantLook = this.look && look;
    const wantRain = rain && this.raining;
    if (!wantLook && !wantRain) return;
    const { renderer } = this;
    const u = this.material.uniforms;

    if (!this.copy || this.copy.image.width !== pw || this.copy.image.height !== ph) {
      if (this.copy) this.copy.dispose();
      this.copy = new THREE.FramebufferTexture(pw, ph);
      this.copy.magFilter = THREE.LinearFilter;
      // room for coarser copies: the drops and the mist read them (they are only filled in while it rains)
      this.copy.minFilter = THREE.LinearMipmapLinearFilter;
      u.uScene.value = this.brightMaterial.uniforms.uScene.value = this.copy;
    }
    renderer.copyFramebufferToTexture(this.copy, this._corner.set(px, py));
    if (wantRain) {
      const gl = renderer.getContext();
      const handle = renderer.properties.get(this.copy).__webglTexture;
      if (handle) {
        renderer.state.bindTexture(gl.TEXTURE_2D, handle);
        gl.generateMipmap(gl.TEXTURE_2D);
        renderer.state.unbindTexture();
      }
    }

    const auto = renderer.autoClear;
    renderer.autoClear = false;
    if (wantRain) this._drawGlass(pw, ph);
    if (wantLook) {
      const bw = Math.max(1, pw >> 1);
      const bh = Math.max(1, ph >> 1);
      if (!this.bright || this.bright.width !== bw || this.bright.height !== bh) {
        if (this.bright) this.bright.dispose();
        this.bright = new THREE.WebGLRenderTarget(bw, bh, {
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
          generateMipmaps: true,
          depthBuffer: false,
        });
        u.uBright.value = this.bright.texture;
      }
      this.brightMaterial.uniforms.uTexel.value.set(1 / pw, 1 / ph);
      renderer.setRenderTarget(this.bright);
      renderer.render(this.brightScene, this.camera);
      renderer.setRenderTarget(null); // (back to the canvas, and to the view's own rectangle)
    }

    u.uTexel.value.set(1 / pw, 1 / ph);
    u.uTime.value = this.time;
    const wet = wantRain ? this.wet : 0;
    const mist = Math.min(1, Math.max(0, (wet - 0.45) / 0.55));
    u.uWater.value.set(wet, wantRain ? this.sheet : 0, wantRain ? 1 : 0, mist * mist * (3 - 2 * mist) * 0.75);
    if (wantLook) u.uLook.value.set(0.6, 0.5, 1, 0.16);
    else u.uLook.value.set(0, 0, 0, 0);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose() {
    if (this.copy) this.copy.dispose();
    if (this.bright) this.bright.dispose();
    if (this.glass) this.glass.dispose();
    this.drops.geometry.dispose();
    for (const m of [this.material, this.brightMaterial, this.fadeMaterial, this.dropMaterial]) m.dispose();
  }
}
