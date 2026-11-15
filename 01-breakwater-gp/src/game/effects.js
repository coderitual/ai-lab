// Water effects driven by the crafts.
//
// WakeField: every frame the wakes, hull wash, splash rings and soft shadows
// are drawn top-down into a small texture that the ocean shader samples. The
// foam therefore sits *in* the water surface (it bends over the swell and
// drifts with it) instead of being geometry floating on top.
//
// Spray: a pooled point cloud for the rooster tail, bow spray and landings.

import * as THREE from 'three';
import { SUN_DIR } from '../assets/palette.js';
import { SKY_GLSL, atmosphereUniforms } from '../assets/sky.js';
import { waterHeight } from '../engine/waves.js';

const TRAIL_POINTS = 76;
const TRAIL_LIFE = 6.5; // seconds until a stretch of wake has dissolved

// Vertices are in "undisplaced" sea coordinates and mapped straight to the
// texture: u = (x - cx) / extent + 0.5, v = (z - cz) / extent + 0.5.
const fieldVertex = /* glsl */ `
uniform vec3 uField;     // centre x, centre z, 2 / extent
attribute vec3 aData;    // across (-1..1), age (s) or 0..1 phase, strength
varying vec3 vData;
void main() {
  vData = aData;
  gl_Position = vec4((position.xz - uField.xy) * uField.z, 0.0, 1.0);
}
`;

// What the field holds: r = how much air is churned into the water (foam),
// g = craft shadows, b = how fresh the churn is (1 at the jet, 0 when gone).
const trailFragment = /* glsl */ `
precision highp float;
varying vec3 vData;
void main() {
  float x = vData.x;
  float age = vData.y;
  float life = clamp(1.0 - age / ${TRAIL_LIFE.toFixed(1)}, 0.0, 1.0);
  // straight behind the jet: solid white water for the first second or so
  float core = exp(-x * x * 9.0) * clamp(1.0 - age / 1.5, 0.0, 1.0);
  // the turbulent band that spreads out behind it and thins as the air escapes
  float band = (1.0 - smoothstep(0.3, 0.8, abs(x))) * pow(life, 1.35) * 0.6;
  // the two edges of the wake: thin lines of foam that outlast the middle
  float ax = abs(x) - 0.85;
  float arms = exp(-ax * ax * 95.0) * life * 0.46;
  float a = (max(core, band) + arms) * vData.z * smoothstep(1.0, 0.93, abs(x));
  gl_FragColor = vec4(a, 0.0, life * step(0.004, a), 1.0);
}
`;

const stampFragment = /* glsl */ `
precision highp float;
varying vec3 vData;       // x,y: quad coords (-1..1), z: strength (negative = shadow)
uniform float uRing;      // 0 = soft blob, 1 = ring
void main() {
  float r = length(vData.xy);
  float blob = smoothstep(1.0, 0.25, r);
  float ring = smoothstep(0.45, 0.78, r) * smoothstep(1.0, 0.86, r);
  float a = mix(blob, ring, uRing) * abs(vData.z);
  // white water thrown up by a hull or a landing is as fresh as it gets
  gl_FragColor = vData.z < 0.0 ? vec4(0.0, a, 0.0, 1.0) : vec4(a, 0.0, min(1.0, a * 1.6), 1.0);
}
`;

class Trail {
  constructor() {
    this.count = 0;
    this.head = 0;
    // ring buffer of emitted points: x, z, dirX, dirZ, birth, strength
    this.data = new Float32Array(TRAIL_POINTS * 6);
    this.lastX = 0;
    this.lastZ = 0;
    this.started = false;
    // the point currently under the stern (rewritten every frame)
    this.liveX = 0;
    this.liveZ = 0;
    this.liveDX = 1;
    this.liveDZ = 0;
    this.liveStrength = 0;
  }

  push(x, z, dx, dz, time, strength) {
    const i = this.head * 6;
    this.data[i] = x;
    this.data[i + 1] = z;
    this.data[i + 2] = dx;
    this.data[i + 3] = dz;
    this.data[i + 4] = time;
    this.data[i + 5] = strength;
    this.head = (this.head + 1) % TRAIL_POINTS;
    if (this.count < TRAIL_POINTS) this.count++;
    this.lastX = x;
    this.lastZ = z;
    this.started = true;
  }

  reset() {
    this.count = 0;
    this.head = 0;
    this.started = false;
    this.liveStrength = 0;
  }
}

export class WakeField {
  constructor(renderer, { size = 512, extent = 176, maxCrafts = 4 } = {}) {
    this.renderer = renderer;
    this.extent = extent;
    this.size = size;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.target.texture.wrapS = this.target.texture.wrapT = THREE.ClampToEdgeWrapping;

    /** Hand these to the ocean material. */
    this.uniforms = {
      uWakeTex: { value: this.target.texture },
      uWake: { value: new THREE.Vector3(0, 0, 1 / extent) },
    };

    this.fieldUniform = { value: new THREE.Vector3(0, 0, 2 / extent) };
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const common = {
      vertexShader: fieldVertex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // keep the strongest contribution: overlapping strips (tight turns,
      // crossing wakes) must not pile up into solid white
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
    };
    this.trailMaterial = new THREE.ShaderMaterial({ ...common, fragmentShader: trailFragment, uniforms: { uField: this.fieldUniform } });
    this.blobMaterial = new THREE.ShaderMaterial({ ...common, fragmentShader: stampFragment, uniforms: { uField: this.fieldUniform, uRing: { value: 0 } } });
    this.ringMaterial = new THREE.ShaderMaterial({ ...common, fragmentShader: stampFragment, uniforms: { uField: this.fieldUniform, uRing: { value: 1 } } });

    // ---- trails: one strip per craft, all in a single buffer
    this.trails = Array.from({ length: maxCrafts }, () => new Trail());
    const stripVerts = (TRAIL_POINTS + 1) * 2;
    const tPos = new Float32Array(maxCrafts * stripVerts * 3);
    const tData = new Float32Array(maxCrafts * stripVerts * 3);
    const tIndex = [];
    for (let c = 0; c < maxCrafts; c++) {
      const base = c * stripVerts;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const a = base + i * 2;
        tIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute('aData', new THREE.BufferAttribute(tData, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setIndex(tIndex);
    this.stripVerts = stripVerts;
    const trailMesh = new THREE.Mesh(this.trailGeo, this.trailMaterial);
    trailMesh.frustumCulled = false;
    this.scene.add(trailMesh);

    // ---- stamps (quads): hull wash + shadow per craft, pooled splash rings
    this.maxBlobs = maxCrafts * 2;
    this.maxRings = 12;
    this.blobGeo = this._quadGeometry(this.maxBlobs);
    this.ringGeo = this._quadGeometry(this.maxRings);
    const blobMesh = new THREE.Mesh(this.blobGeo, this.blobMaterial);
    const ringMesh = new THREE.Mesh(this.ringGeo, this.ringMaterial);
    blobMesh.frustumCulled = ringMesh.frustumCulled = false;
    this.scene.add(blobMesh, ringMesh);
    this.rings = Array.from({ length: this.maxRings }, () => ({ x: 0, z: 0, t0: -100, size: 1, strength: 0 }));
    this.ringCursor = 0;
    this._blobCount = 0;
    this._prevClear = new THREE.Color();
  }

  _quadGeometry(count) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < count; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    g.setIndex(index);
    return g;
  }

  _writeQuad(geo, i, cx, cz, ax, az, halfLen, halfWid, strength) {
    // (ax, az) = unit long axis
    const pos = geo.attributes.position.array;
    const dat = geo.attributes.aData.array;
    const bx = -az;
    const bz = ax;
    let k = i * 12;
    for (let c = 0; c < 4; c++) {
      const u = c & 1 ? 1 : -1;
      const v = c & 2 ? 1 : -1;
      pos[k] = cx + ax * halfLen * v + bx * halfWid * u;
      pos[k + 1] = 0;
      pos[k + 2] = cz + az * halfLen * v + bz * halfWid * u;
      dat[k] = u;
      dat[k + 1] = v;
      dat[k + 2] = strength;
      k += 3;
    }
  }

  reset() {
    this.trails.forEach((t) => t.reset());
    this.rings.forEach((r) => (r.t0 = -100));
  }

  /** A ring of foam where something hit the water. */
  splash(x, z, time, size = 3, strength = 1) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.maxRings;
    r.x = x;
    r.z = z;
    r.t0 = time;
    r.size = size;
    r.strength = strength;
  }

  /**
   * Record where a craft is leaving its wake. Positions are the *undisplaced*
   * sea coordinates under the stern so the foam drifts with the water.
   */
  emit(index, x, z, dirX, dirZ, time, strength) {
    const t = this.trails[index];
    const lastStrength = t.count > 0 ? t.data[((t.head + TRAIL_POINTS - 1) % TRAIL_POINTS) * 6 + 5] : 0;
    if (strength <= 0.02) {
      // airborne / stopped: close the strip so nothing is drawn across the gap
      if (lastStrength > 0) t.push(t.liveX, t.liveZ, dirX, dirZ, time, 0);
      t.liveStrength = 0;
      return;
    }
    if (lastStrength === 0) {
      // (re)entering the water: open a fresh strip with a zero-strength cap
      t.push(x, z, dirX, dirZ, time, 0);
      t.push(x, z, dirX, dirZ, time, strength);
    } else {
      const dx = x - t.lastX;
      const dz = z - t.lastZ;
      if (dx * dx + dz * dz > 1.9 * 1.9) t.push(x, z, dirX, dirZ, time, strength);
    }
    t.liveX = x;
    t.liveZ = z;
    t.liveDX = dirX;
    t.liveDZ = dirZ;
    t.liveStrength = strength;
  }

  /** Per-craft soft stamps for this frame: white water round the hull + shadow. */
  beginStamps() {
    this._blobCount = 0;
  }

  stampCraft(x, z, dirX, dirZ, washStrength, altitude) {
    if (this._blobCount + 2 > this.maxBlobs) return;
    this._writeQuad(this.blobGeo, this._blobCount++, x - dirX * 0.35, z - dirZ * 0.35, dirX, dirZ, 3.1, 1.75, washStrength);
    // soft shadow thrown away from the sun; it slides out and fades as the craft leaves the water
    const sx = -SUN_DIR.x;
    const sz = -SUN_DIR.z;
    const sl = Math.hypot(sx, sz) || 1;
    const perMetre = sl / Math.max(SUN_DIR.y, 0.15); // shadow travel per metre of height
    const reach = (0.45 + altitude) * perMetre;
    const fade = Math.max(0.15, 1 - altitude * 0.22);
    this._writeQuad(this.blobGeo, this._blobCount++, x + (sx / sl) * reach, z + (sz / sl) * reach, sx / sl, sz / sl, 1.9 + 0.75 * perMetre, 1.5, -0.62 * fade);
  }

  /** Once per frame, after emit()/stampCraft(): rebuild the strips and stamps. */
  update(time) {
    // --- trails
    const pos = this.trailGeo.attributes.position.array;
    const dat = this.trailGeo.attributes.aData.array;
    for (let c = 0; c < this.trails.length; c++) {
      const t = this.trails[c];
      let k = c * this.stripVerts * 3;
      const write = (x, z, dx, dz, age, strength) => {
        // half-width: a craft's beam at the stern, spreading as the churn drifts apart
        const w = 0.5 + 3.3 * (1 - Math.exp(-age * 0.5));
        const nx = -dz * w;
        const nz = dx * w;
        pos[k] = x - nx;
        pos[k + 1] = 0;
        pos[k + 2] = z - nz;
        dat[k] = -1;
        dat[k + 1] = age;
        dat[k + 2] = strength;
        pos[k + 3] = x + nx;
        pos[k + 4] = 0;
        pos[k + 5] = z + nz;
        dat[k + 3] = 1;
        dat[k + 4] = age;
        dat[k + 5] = strength;
        k += 6;
      };
      // newest first: the live point under the stern, then the stored history
      let written = 0;
      if (t.liveStrength > 0) {
        write(t.liveX, t.liveZ, t.liveDX, t.liveDZ, 0, t.liveStrength);
      } else {
        write(0, 0, 1, 0, TRAIL_LIFE, 0);
      }
      written++;
      for (let j = 0; j < TRAIL_POINTS; j++) {
        if (j < t.count) {
          const i = ((t.head - 1 - j + TRAIL_POINTS * 2) % TRAIL_POINTS) * 6;
          const age = time - t.data[i + 4];
          write(t.data[i], t.data[i + 1], t.data[i + 2], t.data[i + 3], age, age > TRAIL_LIFE ? 0 : t.data[i + 5]);
        } else {
          // collapse unused segments onto the last point (zero area)
          const lx = pos[k - 6];
          const lz = pos[k - 4];
          pos[k] = pos[k + 3] = lx;
          pos[k + 1] = pos[k + 4] = 0;
          pos[k + 2] = pos[k + 5] = lz;
          dat[k + 2] = dat[k + 5] = 0;
          k += 6;
        }
        written++;
      }
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.aData.needsUpdate = true;

    // --- blobs written by stampCraft(); hide the unused ones
    for (let i = this._blobCount; i < this.maxBlobs; i++) this._writeQuad(this.blobGeo, i, 0, 0, 1, 0, 0, 0, 0);
    this.blobGeo.attributes.position.needsUpdate = true;
    this.blobGeo.attributes.aData.needsUpdate = true;

    // --- splash rings
    for (let i = 0; i < this.maxRings; i++) {
      const r = this.rings[i];
      const age = time - r.t0;
      const life = 1.5;
      if (age < 0 || age > life) {
        this._writeQuad(this.ringGeo, i, 0, 0, 1, 0, 0, 0, 0);
        continue;
      }
      const p = age / life;
      const size = r.size * (0.35 + 1.25 * Math.sqrt(p));
      this._writeQuad(this.ringGeo, i, r.x, r.z, 1, 0, size, size, r.strength * (1 - p) * (1 - p));
    }
    this.ringGeo.attributes.position.needsUpdate = true;
    this.ringGeo.attributes.aData.needsUpdate = true;
  }

  /** Per view: draw the field around that view's rider (cx, cz). */
  render(cx, cz) {
    const texel = this.extent / this.size;
    cx = Math.round(cx / texel) * texel;
    cz = Math.round(cz / texel) * texel;
    this.fieldUniform.value.set(cx, cz, 2 / this.extent);
    this.uniforms.uWake.value.set(cx, cz, 1 / this.extent);

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._prevClear);
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this._prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
  }
}

// --------------------------------------------------------------------- spray

const sprayVertex = /* glsl */ `
attribute vec2 aInfo;       // size (m), alpha
uniform float uPixelsPerUnit;
varying float vAlpha;
varying vec3 vViewDir;
varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlpha = aInfo.y;
  vDist = length(mv.xyz);
  vViewDir = position - cameraPosition;
  gl_Position = projectionMatrix * mv;
  float px = aInfo.x * uPixelsPerUnit / max(-mv.z, 0.5);
  gl_PointSize = clamp(px, 1.5, 11.0);
  vAlpha *= clamp(9.0 / px, 0.0, 1.0);       // spray right at the lens thins out instead of ballooning
}
`;

const sprayFragment = /* glsl */ `
precision highp float;
${SKY_GLSL}
uniform vec3 uColor;
varying float vAlpha;
varying vec3 vViewDir;
varying float vDist;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2 * 0.5) * vAlpha;
  vec3 col = applySkyFog(uColor, normalize(vViewDir), vDist);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Spray {
  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.info = new Float32Array(max * 2);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.cursor = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      name: 'Spray',
      vertexShader: sprayVertex,
      fragmentShader: sprayFragment,
      uniforms: {
        ...atmosphereUniforms,
        uColor: { value: new THREE.Color('#fffaf0').multiplyScalar(1.05) },
        uPixelsPerUnit: { value: 600 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.name = 'spray';
  }

  /** Keep point sizes right for the current viewport + lens. */
  setProjection(viewportHeightPx, fovDeg) {
    this.material.uniforms.uPixelsPerUnit.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
  }

  reset() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) {
      this.pos[i * 3 + 1] = -1000;
      this.info[i * 2 + 1] = 0;
    }
  }

  update(dt, time) {
    const { pos, vel, life, maxLife, info, size0 } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const k = i * 3;
      vel[k + 1] -= 11 * dt;
      const drag = 1 - 1.4 * dt;
      vel[k] *= drag;
      vel[k + 2] *= drag;
      pos[k] += vel[k] * dt;
      pos[k + 1] += vel[k + 1] * dt;
      pos[k + 2] += vel[k + 2] * dt;
      const p = Math.max(life[i] / maxLife[i], 0);
      info[i * 2] = size0[i] * (1.5 - 0.5 * p);
      info[i * 2 + 1] = Math.min(1, p * 2.4) * 0.72;
      if (life[i] <= 0 || (vel[k + 1] < 0 && pos[k + 1] < waterHeight(pos[k], pos[k + 2], time) - 0.1)) {
        life[i] = 0;
        info[i * 2 + 1] = 0;
        pos[k + 1] = -1000;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aInfo.needsUpdate = true;
  }
}
