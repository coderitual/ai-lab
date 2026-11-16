// What the camera's glass and sensor do to the picture.
//
// After a view has been drawn, its pixels are copied into a texture and drawn
// back through one shader that does two jobs:
//
//   Rain on the lens. Spray, hard landings and above all another boat's plume
//   wet the glass. Drops run across it in fits and starts, each one a small
//   lens showing the whole scene upside down, and leave a wet track with beads
//   on it; small beads sit and dry; a soaked lens mists over except where a
//   drop has just wiped it. Nothing is simulated: where every drop is at any
//   moment is a formula of time and place, so a downpour costs the same as a
//   drizzle. At a standstill the drops run down; at speed the wind blows them
//   outward from the middle.
//
//   The look. A glow round whatever is bright (the sun on the water, white
//   foam), a little sharpening, firmer contrast and colour, darker corners.
//   This is most of the difference between a picture that looks rendered and
//   one that looks photographed.
//
// Phones get the rain only, and the pass is skipped while their glass is dry.

import * as THREE from 'three';

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

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uScene;   // the view as it was just drawn (display colours), with coarser copies when it is raining
uniform sampler2D uBright;  // its highlights at half size, with coarser copies
uniform vec2 uTexel;        // one pixel of the view
uniform float uAspect;
uniform float uTime;
uniform vec4 uWater;        // how wet the glass is; a sheet of water running off it; 0 = drops run down .. 1 = blown outward; mist
uniform vec4 uLook;         // glow, sharpening, grade, dark corners
varying vec2 vUv;

float hash1(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1317, 0.1113, 0.0971));
  q += dot(q, q.yzx + 31.27);
  return fract((q.x + q.y) * q.z);
}
vec2 hash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1113, 0.1317, 0.1031));
  q += dot(q, q.yzx + 27.19);
  return fract((q.xx + q.yz) * q.zy);
}

// What lies on the glass at one place.
struct Wet {
  vec2 on;      // where this is on a drop: 0 at its middle, length 1 at its rim
  float drop;   // how much of a drop is here
  float size;   // that drop's radius, in units of the view's height
  vec2 bend;    // across a wet track: -1 at one edge, 1 at the other, along the direction that crosses it
  float film;   // how much wet track is here
};
const Wet DRY = Wet(vec2(0.0), 0.0, 0.0, vec2(0.0), 0.0);

// keep the nearer drop and the wetter track
void over(inout Wet a, Wet b) {
  if (b.drop > a.drop) { a.on = b.on; a.drop = b.drop; a.size = b.size; }
  if (b.film > a.film) { a.bend = b.bend; a.film = b.film; }
}

// One layer of drops that run "down" the glass (toward -y), each in its own
// tall cell: it starts near the top, slides in fits and starts, and is gone by
// the bottom, leaving a wet track with beads on it that dries behind it.
//   p        place on the glass, in units of the view's height
//   amount   0..1, the share of cells that have a drop
//   drawn    how far the drop is drawn out behind (1 round .. 0.3 long), and how soon its track dries
Wet runners(vec2 p, float t, vec2 cells, float amount, float seed, vec2 drawn) {
  vec2 g = p * cells;
  g.y += hash1(vec2(floor(g.x), seed)) * 7.0;             // stagger the columns
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash1(id + seed * 17.0);
  float pace = 0.16 + 0.3 * hash1(id.yx + seed * 5.0);
  float turn = t * pace + h;
  float lap = floor(turn);                                // each time round is another drop
  float ph = turn - lap;
  vec2 r = hash2(id + lap * 1.61 + seed);
  float on = smoothstep(0.0, 0.1, amount - r.y * 0.9);
  if (on <= 0.0) return DRY;

  // three slides with a pause between them
  float s3 = ph * 3.0;
  float slide = (floor(s3) + smoothstep(0.1, 0.9, fract(s3))) / 3.0;
  float headY = mix(0.93, 0.07, slide);
  float x0 = 0.3 + 0.4 * r.x;
  // its path wanders a little
  #define PATH(y) (x0 + 0.08 * sin((y) * 7.0 + h * 6.283) + 0.03 * sin((y) * 19.0 + h * 40.0))
  float radius = (0.062 + 0.1 * r.x * r.x) * (0.6 + 0.4 * on) / cells.x;   // in units of the view's height
  float life = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.93, 1.0, ph)) * on;

  // the drop: round in front, drawn out behind, never quite a circle
  vec2 d = (f - vec2(PATH(headY), headY)) / cells;
  d.x += d.y * (h - 0.5) * 0.5;
  if (d.y > 0.0) d.y *= drawn.x;
  float rho = length(d) / radius;

  // the track it has left: a rivulet that narrows and dries with distance from the drop
  float above = f.y - headY;
  float width = radius * (0.5 - 0.28 * smoothstep(0.0, 0.6, above));
  float across = (f.x - PATH(f.y)) / cells.x / width;
  float track = (1.0 - smoothstep(0.55, 1.0, abs(across))) * smoothstep(-0.01, 0.02, above) * exp(-max(above, 0.0) * drawn.y)
              * (1.0 - smoothstep(0.9, 0.95, f.y));

  Wet w = Wet(d / radius, smoothstep(1.0, 1.0 - clamp(1.5 * uTexel.y / radius, 0.08, 0.7), rho) * life, radius,
              vec2(clamp(across, -1.0, 1.0), 0.0), track * life);
  if (rho >= 1.0) {
    // beads left on the track, smaller the longer ago the drop passed
    const float ROWS = 16.0;
    float row = floor(f.y * ROWS);
    float cy = (row + 0.5) / ROWS;
    float rr = hash1(vec2(row, lap) + id * 3.1 + seed);
    float age = cy - headY;
    float beadR = radius * (0.2 + 0.34 * rr) * smoothstep(0.0, 0.04, age) * exp(-max(age, 0.0) * drawn.y * 0.7) * step(cy, 0.93);
    vec2 bd = vec2((f.x - PATH(cy)) / cells.x + (rr - 0.5) * radius * 0.7, (f.y - cy) / cells.y);
    float brho = length(bd) / max(beadR, 1.0e-5);
    w.on = bd / max(beadR, 1.0e-5);
    w.drop = smoothstep(1.0, 1.0 - clamp(1.5 * uTexel.y / max(beadR, 1.0e-5), 0.08, 0.7), brho) * life;
    w.size = beadR;
  }
  return w;
}

// Beads that sit where they landed and slowly dry: many small, a few big.
Wet beads(vec2 p, float t, float amount) {
  const float CELLS = 15.0;
  vec2 g = p * CELLS;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash2(id);
  float turn = t * (0.04 + 0.05 * h.x) + h.y;
  float lap = floor(turn);
  float ph = turn - lap;
  vec2 r = hash2(id + lap * 2.3 + 11.0);
  float on = smoothstep(0.0, 0.08, amount - r.x);
  if (on <= 0.0) return DRY;
  float radius = (0.05 + 0.3 * r.y * r.y * r.y) * smoothstep(0.0, 0.02, ph) * (1.0 - 0.75 * ph) * on;   // in cells
  vec2 d = f - (hash2(id + lap + 5.0) - 0.5) * 0.3;
  d.x += d.y * (h.y - 0.5) * 0.6;
  float rho = length(d) / max(radius, 1.0e-5);
  float edge = clamp(1.5 * uTexel.y * CELLS / max(radius, 1.0e-5), 0.08, 0.7);
  return Wet(d / max(radius, 1.0e-5), smoothstep(1.0, 1.0 - edge, rho), radius / CELLS, vec2(0.0), 0.0);
}

vec3 tent(sampler2D map, vec2 uv, vec2 texel, float lod) {
  vec2 o = texel * exp2(lod) * 0.5;
  return (textureLod(map, uv + o, lod).rgb + textureLod(map, uv - o, lod).rgb
        + textureLod(map, uv + vec2(o.x, -o.y), lod).rgb + textureLod(map, uv + vec2(-o.x, o.y), lod).rgb) * 0.25;
}

void main() {
  vec2 uv = vUv;
  float wet = uWater.x;
  float sheet = uWater.y;
  Wet glass = DRY;

  if (wet + sheet > 0.003) {
    vec2 p = vec2(uv.x * uAspect, uv.y);
    float t = uTime;
    float down = wet * (1.0 - uWater.z);
    float blown = wet * uWater.z;
    // running down
    if (down + sheet > 0.004) {
      over(glass, runners(p, t, vec2(4.6, 1.15), down * 0.85 + sheet, 1.0, vec2(0.62, 2.6)));
      #ifndef LOW
      over(glass, runners(p + 3.3, t * 1.3, vec2(10.0, 2.3), down * 0.9 + sheet * 0.6, 2.0, vec2(0.62, 2.6)));
      #endif
    }
    // blown outward from the middle, and a little upward
    if (blown > 0.004) {
      float side = p.x < 0.5 * uAspect ? -1.0 : 1.0;
      vec2 q = vec2(abs(p.x - 0.5 * uAspect), p.y - 0.42);
      const vec2 ACROSS = vec2(0.26, -0.966);
      const vec2 BACK = vec2(-0.966, -0.26);            // "up the glass" for these runs toward the middle
      vec2 pw = vec2(dot(q, ACROSS), dot(q, BACK)) + vec2(7.0, 9.0) + side * vec2(3.7, 1.9);
      float open = smoothstep(0.02, 0.18, q.x);        // they form a little way out from the middle
      Wet b = runners(pw, t * 2.4, vec2(4.6, 1.25), blown * 0.85 * open, 3.0, vec2(0.36, 1.5));
      #ifndef LOW
      over(b, runners(pw + 2.7, t * 3.1, vec2(9.5, 2.3), blown * 0.9 * open, 4.0, vec2(0.36, 1.5)));
      #endif
      b.on = ACROSS * b.on.x + BACK * b.on.y;
      b.on.x *= side;
      b.bend = ACROSS * b.bend.x;
      b.bend.x *= side;
      over(glass, b);
    }
    over(glass, beads(p, t, 0.3 * pow(wet, 1.2) + sheet * 0.2));

    // a rivulet is a long thin lens: it turns the view over across its width
    uv -= glass.bend * glass.film * (1.0 - glass.drop) * vec2(0.012 / uAspect, 0.012);
    // and a sheet of water running off wobbles everything behind it
    uv += sheet * 0.006 * vec2(sin(uv.y * 31.0 + t * 9.0 + sin(uv.x * 9.0) * 2.0), cos(uv.x * 23.0 - t * 6.0));
  }

  // the picture: soft where the glass has misted over (least in the middle, where the wind is strongest),
  // clear where a drop has just passed
  float clear = max(glass.drop, glass.film);
  float haze = uWater.w * (1.0 - clear) * (0.3 + 0.7 * smoothstep(0.08, 0.5, length(vUv - vec2(0.5, 0.45)))) + sheet * 1.1;
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

  // the light a rivulet catches: darker at its edges, bright along the side toward the sun
  if (glass.film > 0.0) {
    float c = length(glass.bend);
    float lit = dot(glass.bend, vec2(-0.6, 0.8));
    col *= 1.0 - 0.3 * glass.film * smoothstep(0.45, 1.0, c);
    col += vec3(0.9, 0.95, 1.0) * 0.16 * glass.film * smoothstep(0.15, 0.6, lit) * (1.0 - smoothstep(0.7, 1.0, c));
  }
  // a drop is a strong lens: it holds the whole scene, upside down
  if (glass.drop > 0.0) {
    float rim = dot(glass.on, glass.on);
    float big = smoothstep(0.003, 0.011, glass.size);       // (a small bead is too small to show a dark rim: it only glints)
    vec2 through = mix(uv, vec2(0.5, 0.54), 0.62) - glass.on * vec2(0.34, 0.4);
    vec3 held = textureLod(uScene, clamp(through, 0.003, 0.997), 4.0 - big).rgb;
    held *= 1.0 - (0.25 + 0.4 * big) * smoothstep(0.4, 1.0, rim);                                  // dark toward its rim
    held += vec3(1.0, 0.98, 0.94) * (1.0 - smoothstep(0.1, 0.36, length(glass.on - vec2(-0.34, 0.42)))) * 0.65;   // the sun on it
    held += vec3(0.8, 0.9, 1.0) * smoothstep(0.5, 1.0, rim) * (1.0 - smoothstep(-0.9, -0.2, glass.on.y)) * 0.22;      // sky along its lower rim
    col = mix(col, held, glass.drop);
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
   * @param {{ look?: boolean, low?: boolean }} [o] `look`: the glow, sharpening and grade as well as the rain;
   *   `low`: half as many running drops (phones)
   */
  constructor(renderer, { look = true, low = false } = {}) {
    this.renderer = renderer;
    this.look = look;
    /** How wet the glass is, 0 (dry) to 1 (a downpour). */
    this.wet = 0;
    /** A sheet of water running off after a soaking, 0 to 1. */
    this.sheet = 0;
    /** 0: drops run down the glass; 1: the wind blows them outward. */
    this.flow = 0;
    this.time = Math.random() * 40;
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

    this.material = new THREE.ShaderMaterial({
      name: 'Lens',
      fragmentShader,
      defines: low ? { LOW: 1 } : {},
      uniforms: {
        uScene: { value: null },
        uBright: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uAspect: { value: 1.78 },
        uTime: { value: 0 },
        uWater: { value: new THREE.Vector4() },
        uLook: { value: new THREE.Vector4() },
      },
      ...flat,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(plane, this.material));
    for (const s of [this.scene, this.brightScene]) s.children[0].frustumCulled = false;

    this.copy = null; // the view's pixels (FramebufferTexture), remade to fit the view
    this.bright = null; // its highlights at half size (WebGLRenderTarget)
    this._corner = new THREE.Vector2();
  }

  /** Dry glass. */
  clear() {
    this.wet = 0;
    this.sheet = 0;
  }

  /**
   * Water reaches the lens.
   * @param {number} amount how much wetter the glass gets (1 would soak dry glass)
   * @param {number} [heavy] 0…1: how much of it arrives as one sheet (a hard landing)
   */
  splash(amount, heavy = 0) {
    this.wet = Math.min(1, this.wet + amount);
    this.sheet = Math.min(1, Math.max(this.sheet, heavy));
  }

  /**
   * The glass dries. Call once per step of the game, where the splashes are made, so that it dries as fast when the
   * game is being fast-forwarded as when it is being watched.
   * @param {number} dt
   * @param {number} speedK 0 (standing) .. 1 (flat out): the wind dries the glass and blows the drops outward
   */
  update(dt, speedK) {
    this.wet = Math.max(0, this.wet - dt * (0.09 + 0.12 * speedK) * (0.35 + this.wet));
    this.sheet = Math.max(0, this.sheet - dt * 1.1);
    const want = Math.min(1, Math.max(0, (speedK - 0.3) / 0.45));
    this.flow += (want - this.flow) * Math.min(1, dt * 1.5);
  }

  /** The drops move on. Call once per picture. */
  tick(frameDt, speedK) {
    this.time += frameDt * (0.7 + 0.9 * speedK);
  }

  /**
   * Finish the view that has just been drawn into the canvas.
   * @param {number} px @param {number} py lower-left corner of the view, device pixels
   * @param {number} pw @param {number} ph size of the view, device pixels
   * @param {{ rain?: boolean, look?: boolean }} [o] leave either job out
   */
  render(px, py, pw, ph, { rain = true, look = true } = {}) {
    const wantLook = this.look && look;
    const wantRain = rain && (this.wet > 0.003 || this.sheet > 0.003);
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
    u.uAspect.value = pw / Math.max(1, ph);
    u.uTime.value = this.time;
    const wet = wantRain ? this.wet : 0;
    const mist = Math.min(1, Math.max(0, (wet - 0.45) / 0.55));
    u.uWater.value.set(wet, wantRain ? this.sheet : 0, this.flow, mist * mist * (3 - 2 * mist) * 0.75);
    if (wantLook) u.uLook.value.set(0.6, 0.5, 1, 0.16);
    else u.uLook.value.set(0, 0, 0, 0);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose() {
    if (this.copy) this.copy.dispose();
    if (this.bright) this.bright.dispose();
    this.material.dispose();
    this.brightMaterial.dispose();
  }
}
