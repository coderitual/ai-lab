// Water on the camera lens.
//
// Spray and landings throw drops onto the "glass". Each drop is a little lens:
// it shows the scene behind it upside down and squeezed, with a bright edge on
// one side and a dark one on the other. Small drops sit still and dry off; big
// ones are pushed outward by the airflow at speed (or run down at a standstill),
// stretch as they go, swallow the small ones in their path and leave a trail of
// beads behind.
//
// Drawing: after a view has been rendered, its pixels are copied into a texture
// and the drops are drawn over the view, sampling that copy. Nothing is copied
// or drawn while the lens is dry.

import * as THREE from 'three';

const MAX = 220;
// Drops live in "height units": y from 0 (bottom) to 1 (top), x from 0 to the aspect ratio.
const R_GONE = 0.0016; // smaller than this and a drop has dried off

const vertexShader = /* glsl */ `
attribute vec4 aDrop;     // centre x, centre y (height units), radius, stretch
attribute vec3 aLook;     // direction x, direction y, opacity
uniform float uAspect;
varying vec2 vUv;
varying vec2 vCentre;     // view uv
varying float vRadius;    // in view-height units
varying float vAlpha;
void main() {
  vec2 dir = aLook.xy;
  vec2 across = vec2(-dir.y, dir.x);
  vec2 p = aDrop.xy + (across * position.x + dir * position.y * aDrop.w) * aDrop.z;
  vUv = position.xy;
  vCentre = vec2(aDrop.x / uAspect, aDrop.y);
  vRadius = aDrop.z;
  vAlpha = aLook.z;
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uScene;   // the view as it was just drawn (display colours)
uniform float uAspect;
varying vec2 vUv;
varying vec2 vCentre;
varying float vRadius;
varying float vAlpha;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  // a drop is a flattened dome: steep at the rim, nearly flat in the middle
  float dome = sqrt(1.0 - r2);
  vec3 n = normalize(vec3(vUv * (0.35 + 0.65 * r2), dome + 0.25));

  // the little lens: most of the scene, upside down, squeezed into the drop
  // (so the bright sky sits low in it and the dark sea high: that is what makes
  // a bead of water read as a bead)
  vec2 about = mix(vec2(0.5), vCentre, 0.35);
  vec2 uv = about - vec2(vUv.x * 0.36, vUv.y * 0.46) * (0.6 + 0.4 * r2);
  uv = clamp(uv, vec2(0.002), vec2(0.998));
  vec3 col = texture2D(uScene, uv).rgb;

  // water darkens what it bends, most toward the rim
  col *= 0.92 - 0.3 * smoothstep(0.55, 1.0, r);
  // light caught in the drop: a soft glint up and to one side, a brighter lower edge
  float glint = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 26.0);
  float lower = smoothstep(0.45, 0.95, r) * max(-vUv.y * 0.8 + vUv.x * 0.2, 0.0);
  col += vec3(1.0, 0.99, 0.96) * (glint * 0.75 + lower * 0.22);

  float edge = 1.0 - smoothstep(0.86, 1.0, r);
  gl_FragColor = vec4(col, edge * vAlpha);
}
`;

export class LensDrops {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.count = 0;
    // per drop: x, y, radius, vx, vy, age, trail distance, seed
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.r = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.left = new Float32Array(MAX); // distance travelled since the last bead was left behind
    this.seed = new Float32Array(MAX);
    this.aspect = 16 / 9;

    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    this.aDrop = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aLook = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aDrop', this.aDrop);
    g.setAttribute('aLook', this.aLook);
    g.instanceCount = 0;
    this.geometry = g;

    this.background = null; // FramebufferTexture, (re)made to fit the view
    this.material = new THREE.ShaderMaterial({
      name: 'LensDrops',
      vertexShader,
      fragmentShader,
      uniforms: { uScene: { value: null }, uAspect: { value: this.aspect } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // the quads are turned to face along each drop's travel, either way round
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._corner = new THREE.Vector2();
  }

  clear() {
    this.count = 0;
  }

  _add(x, y, r, vx = 0, vy = 0) {
    let i = this.count;
    if (i >= MAX) {
      // full: the smallest drop makes way
      i = 0;
      for (let k = 1; k < MAX; k++) if (this.r[k] < this.r[i]) i = k;
      if (this.r[i] >= r) return -1;
    } else this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.r[i] = r;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.left[i] = 0;
    this.seed[i] = Math.random();
    return i;
  }

  /**
   * Water hits the lens.
   * @param {number} amount roughly how many drops
   * @param {number} [heavy] 0…1: how much of it comes as big drops (a hard landing)
   */
  splash(amount, heavy = 0) {
    const n = Math.round(amount);
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.1 + 0.22 * heavy;
      const u = Math.random();
      const r = big ? 0.011 + 0.02 * u * u * (0.5 + heavy) : 0.0028 + 0.0075 * u * u * u;
      // thrown up from below: a little more of it lands low on the glass
      this._add(Math.random() * this.aspect, Math.pow(Math.random(), 1.25), r);
    }
  }

  /**
   * @param {number} dt
   * @param {number} speedK 0 (standing) … 1 (flat out): how hard the air pushes on the glass
   */
  update(dt, speedK) {
    if (!this.count) return;
    const { x, y, r, vx, vy, age, left } = this;
    const fx = this.aspect * 0.5; // the air parts round the middle of the picture, a little below centre
    const fy = 0.4;
    const wind = 2.0 * speedK * speedK;
    const dry = 0.0009 + 0.002 * speedK;
    for (let i = this.count - 1; i >= 0; i--) {
      age[i] += dt;
      // the push on this drop: air outward from the middle, gravity down
      let dx = x[i] - fx;
      let dy = y[i] - fy;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const ax = dx * wind;
      const ay = dy * wind * 0.8 + wind * 0.25 - 0.38;
      const push = Math.hypot(ax, ay);
      // surface tension holds small drops where they are; big ones let go first
      const drive = push * (r[i] / 0.012) - 0.5;
      if (drive > 0) {
        const speed = Math.min(0.95, drive * 0.24) * (0.7 + 0.6 * this.seed[i]);
        // a wandering path, the way drops find their way over glass
        const wobble = Math.sin(age[i] * (5 + this.seed[i] * 7) + this.seed[i] * 40) * 0.35;
        const tx = (ax / push) * speed - (ay / push) * speed * wobble;
        const ty = (ay / push) * speed + (ax / push) * speed * wobble;
        const k = Math.min(1, dt * 7);
        vx[i] += (tx - vx[i]) * k;
        vy[i] += (ty - vy[i]) * k;
      } else {
        const k = Math.min(1, dt * 12);
        vx[i] -= vx[i] * k;
        vy[i] -= vy[i] * k;
      }
      const stepLen = Math.hypot(vx[i], vy[i]) * dt;
      if (stepLen > 0) {
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        // a sliding drop leaves beads behind and gets smaller for it
        left[i] += stepLen;
        if (left[i] > r[i] * 2.6 && r[i] > 0.006) {
          left[i] = 0;
          const bead = r[i] * (0.22 + 0.2 * Math.random());
          const inv = 1 / (Math.hypot(vx[i], vy[i]) || 1);
          this._add(x[i] - vx[i] * inv * r[i] * 1.3 + (Math.random() - 0.5) * r[i] * 0.5, y[i] - vy[i] * inv * r[i] * 1.3 + (Math.random() - 0.5) * r[i] * 0.5, bead);
          r[i] *= 0.985;
        }
      }
      r[i] -= dry * dt * (0.4 + 0.6 * Math.min(1, 0.006 / r[i]));
      if (r[i] < R_GONE || x[i] < -0.06 || x[i] > this.aspect + 0.06 || y[i] < -0.06 || y[i] > 1.06) this._remove(i);
    }
    // sliding drops swallow the still ones they run over
    for (let i = 0; i < this.count; i++) {
      if (r[i] < 0.008 || vx[i] * vx[i] + vy[i] * vy[i] < 0.0004) continue;
      for (let k = this.count - 1; k >= 0; k--) {
        if (k === i || r[k] >= r[i]) continue;
        const ddx = x[k] - x[i];
        const ddy = y[k] - y[i];
        const reach = r[i] * 0.9 + r[k] * 0.4;
        if (ddx * ddx + ddy * ddy < reach * reach && age[k] > 0.25) {
          r[i] = Math.min(0.045, Math.sqrt(r[i] * r[i] + r[k] * r[k] * 0.6));
          this._remove(k);
          if (k < i) i--;
        }
      }
    }
  }

  _remove(i) {
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.x, this.y, this.r, this.vx, this.vy, this.age, this.left, this.seed]) a[i] = a[last];
  }

  /**
   * Draw the drops over the view that has just been rendered.
   * @param {number} px @param {number} py lower-left corner of the view, device pixels
   * @param {number} pw @param {number} ph size of the view, device pixels
   */
  render(px, py, pw, ph) {
    this.aspect = pw / Math.max(1, ph);
    if (!this.count) return;
    const { renderer } = this;
    if (!this.background || this.background.image.width !== pw || this.background.image.height !== ph) {
      if (this.background) this.background.dispose();
      this.background = new THREE.FramebufferTexture(pw, ph);
      this.background.minFilter = this.background.magFilter = THREE.LinearFilter;
      this.material.uniforms.uScene.value = this.background;
    }
    renderer.copyFramebufferToTexture(this.background, this._corner.set(px, py));

    const drop = this.aDrop.array;
    const look = this.aLook.array;
    for (let i = 0; i < this.count; i++) {
      const speed = Math.hypot(this.vx[i], this.vy[i]);
      const stretch = 1 + Math.min(1.6, speed * 2.6);
      // still drops are not quite round either
      const wonk = speed > 0.02 ? 0 : (this.seed[i] - 0.5) * 0.3;
      drop[i * 4] = this.x[i];
      drop[i * 4 + 1] = this.y[i];
      drop[i * 4 + 2] = this.r[i] * (1 - wonk * 0.5) / Math.sqrt(stretch);
      drop[i * 4 + 3] = stretch + wonk;
      const a = speed > 0.02 ? Math.atan2(this.vy[i], this.vx[i]) : this.seed[i] * 6.283;
      look[i * 3] = Math.cos(a);
      look[i * 3 + 1] = Math.sin(a);
      // fade in as it lands, fade out as it dries
      look[i * 3 + 2] = Math.min(1, this.age[i] * 14) * Math.min(1, (this.r[i] - R_GONE) / 0.0012);
    }
    this.aDrop.needsUpdate = true;
    this.aLook.needsUpdate = true;
    this.geometry.instanceCount = this.count;
    this.material.uniforms.uAspect.value = this.aspect;

    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose() {
    if (this.background) this.background.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
