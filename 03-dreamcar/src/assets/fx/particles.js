// Particles: tyre smoke, dust, stones, spray and sparks, in two draw calls.
//
// Each particle is written once, when it is born (where, how fast, when, for how long, what kind), into a
// ring of instance slots; after that the vertex shader works out where it is from the clock alone (a drag
// that slows it, a rise or a fall, a growth), so a particle costs nothing on the CPU while it lives and the
// same clock always gives the same picture. A pool that is full reuses its oldest slot.
//
// The soft pool (smoke, dust, stones, spray) is alpha-blended and lit in the vertex shader by what lights
// the scene, with a fixed number of terms: the sky's fill, the sun (or moon) with a forward-scattering lobe,
// and each car's head lamps (a cone) and tail lamps (a red glow round them). It fades where it meets the
// ground it was born over, so a puff does not end in a hard line on the road. Sparks are their own pool:
// additive, streaked along their motion on screen, bright enough to bloom.
//
// Kinds and their numbers are in KINDS; the caller (game/effects.js) decides what is born, in the fixed
// step, from its own seeded random numbers.

import * as THREE from 'three';

/** What each kind does: drag (1/s), fall (m/s2, + = down), rise (m/s, buoyancy), opacity, albedo, streak. */
export const KINDS = {
  smoke: { id: 0, drag: 1.8, fall: 0, rise: 0.18, opacity: 0.22, color: [0.82, 0.82, 0.84] },
  dust: { id: 1, drag: 2.2, fall: 0.25, rise: 0.15, opacity: 0.4, color: [0.55, 0.47, 0.36] },
  stone: { id: 2, drag: 0.4, fall: 9.81, rise: 0, opacity: 1, color: [0.18, 0.16, 0.14] },
  spray: { id: 3, drag: 2.6, fall: 0.6, rise: 0.04, opacity: 0.16, color: [0.85, 0.87, 0.9] },
  spark: { id: 4, drag: 1.2, fall: 9.81, rise: 0, opacity: 1, color: [1.0, 0.55, 0.18] },
};
const KIND_LIST = Object.values(KINDS);

const VERTEX = /* glsl */ `
attribute vec4 aStart; // x y z birth
attribute vec4 aVel;   // vx vy vz life
attribute vec4 aShape; // kind size0 size1 seed
attribute float aGround;
uniform float uTime;
uniform vec4 uKind[5];   // drag fall rise opacity
uniform vec3 uAlbedo[5];
uniform vec3 uAmbient;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uHeadPos[2];
uniform vec3 uHeadDir[2];
uniform float uHead[2];
uniform vec3 uTailPos[2];
uniform float uTail[2];
uniform float uSpark;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  int kind = int(aShape.x + 0.5);
  vec4 k = uKind[kind];
  float t = uTime - aStart.w;
  // (lead) a life or a size of nothing would divide by zero below: 0/0 is not a number, and a pixel that is not a
  // number in the frame is smeared by the blur and the glow into a dark slab over the picture (real GPUs only)
  float life = max(aVel.w, 1e-3);
  vUv = uv;
  vSeed = aShape.w;
  if (t < 0.0 || t > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    vColor = vec3(0.0);
    return;
  }
  float drag = k.x;
  float f = (1.0 - exp(-drag * t)) / drag;
  vec3 p = aStart.xyz + aVel.xyz * f;
  p.y += k.z * t - 0.5 * k.y * t * t;
  float above = p.y - aGround;
  p.y = max(p.y, aGround + 0.02);
  float u = t / life;
  float size = max(mix(aShape.y, aShape.z, sqrt(max(u, 0.0))), 1e-3);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec2 corner = uv * 2.0 - 1.0;
  if (kind == 4) {
    // a spark: a streak along where it is going, on screen
    vec3 vel = aVel.xyz * exp(-drag * t) - vec3(0.0, k.y * t, 0.0);
    vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 axis = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 side = vec2(-axis.y, axis.x);
    float len = size + length(vel) * 0.022;
    mv.xy += axis * corner.y * len + side * corner.x * size;
  } else {
    // turn the puff a little with its seed, so the same texture does not line up
    float a = aShape.w * 6.2832 + t * (aShape.w - 0.5);
    mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
    mv.xy += r * corner * size;
  }
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>

  // (smoothstep between equal edges is undefined: a spark is simply there from the start)
  float fadeIn = kind == 4 ? 1.0 : smoothstep(0.0, 0.12, u);
  float fadeOut = 1.0 - smoothstep(kind == 4 ? 0.5 : 0.35, 1.0, u);
  // soft against the ground it was born over
  float ground = kind == 2 || kind == 4 ? 1.0 : smoothstep(0.0, 0.6 * size, above + 0.15 * size);
  vAlpha = k.w * fadeIn * fadeOut * ground;

  if (kind == 4) {
    vColor = uAlbedo[4] * uSpark * (1.0 - 0.6 * u);
    return;
  }
  // light: the sky's fill, the sun with a lobe towards it (a puff glows with the sun behind it), the lamps
  vec3 toEye = normalize(cameraPosition - p);
  float lobe = 0.55 + 1.6 * pow(max(dot(-toEye, uSunDir), 0.0), 6.0);
  vec3 light = uAmbient + uSun * lobe;
  for (int i = 0; i < 2; i++) {
    vec3 d = p - uHeadPos[i];
    float dist = length(d);
    float cone = smoothstep(0.80, 0.95, dot(d / max(dist, 1e-3), uHeadDir[i]));
    light += vec3(1.0, 0.95, 0.88) * uHead[i] * cone / max(dist * dist, 1.0);
    vec3 e = p - uTailPos[i];
    light += vec3(1.0, 0.06, 0.03) * uTail[i] / max(dot(e, e), 0.8);
  }
  vColor = uAlbedo[kind] * light * 0.3183;
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2);
  a *= a;
  // a little lumpiness, fixed per particle
  float lump = 0.75 + 0.25 * sin(q.x * 5.0 + vSeed * 40.0) * sin(q.y * 4.0 - vSeed * 23.0);
  float alpha = vAlpha * a * lump;
  // nothing that is not a number reaches the frame
  if (!(alpha >= 0.0) || !(dot(vColor, vec3(1.0)) < 1.0e6)) discard;
  gl_FragColor = vec4(max(vColor, 0.0), min(alpha, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const SPARK_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float a = (1.0 - q.x * q.x) * (1.0 - abs(q.y));
  vec3 c = vColor * a * vAlpha;
  if (!(dot(c, vec3(1.0)) < 1.0e6) || !(dot(c, vec3(1.0)) >= 0.0)) discard;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** One pool of instanced quads, one draw call. */
class Pool {
  constructor(count, shared, additive) {
    this.count = count;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage);
    this.start = attr(4);
    this.vel = attr(4);
    this.shape = attr(4);
    this.ground = attr(1);
    // never born: dead from the start
    for (let i = 0; i < count; i++) this.start.array[i * 4 + 3] = -1e9;
    g.setAttribute('aStart', this.start);
    g.setAttribute('aVel', this.vel);
    g.setAttribute('aShape', this.shape);
    g.setAttribute('aGround', this.ground);
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: VERTEX,
      fragmentShader: additive ? SPARK_FRAGMENT : FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.name = additive ? 'fx-sparks' : 'fx-particles';
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = material.name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 12;
    this._next = 0;
    this._lo = Infinity;
    this._hi = -1;
    this.born = 0;
  }

  emit(x, y, z, vx, vy, vz, time, life, kind, size0, size1, seed, groundY) {
    const i = this._next;
    this._next = (i + 1) % this.count;
    this.start.array.set([x, y, z, time], i * 4);
    this.vel.array.set([vx, vy, vz, life], i * 4);
    this.shape.array.set([kind, size0, size1, seed], i * 4);
    this.ground.array[i] = groundY;
    if (i < this._lo) this._lo = i;
    if (i > this._hi) this._hi = i;
    this.born++;
  }

  clear() {
    for (let i = 0; i < this.count; i++) this.start.array[i * 4 + 3] = -1e9;
    this._lo = 0;
    this._hi = this.count - 1;
    this._next = 0;
  }

  upload() {
    if (this._hi < 0) return;
    const lo = this._lo;
    const n = this._hi - lo + 1;
    for (const [a, size] of [[this.start, 4], [this.vel, 4], [this.shape, 4], [this.ground, 1]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * size, n * size);
      a.needsUpdate = true;
    }
    this._lo = Infinity;
    this._hi = -1;
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class Particles {
  /**
   * @param {object} o
   * @param {number} o.soft the most smoke, dust, stones and spray alive at once
   * @param {number} o.sparks the most sparks alive at once
   */
  constructor({ soft, sparks }) {
    const v3 = () => ({ value: new THREE.Vector3() });
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uKind: { value: KIND_LIST.map((k) => new THREE.Vector4(k.drag, k.fall, k.rise, k.opacity)) },
      uAlbedo: { value: KIND_LIST.map((k) => new THREE.Vector3(...k.color)) },
      uAmbient: v3(),
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSun: v3(),
      uHeadPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uHeadDir: { value: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)] },
      uHead: { value: [0, 0] },
      uTailPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uTail: { value: [0, 0] },
      uSpark: { value: 30 },
    };
    this.soft = new Pool(soft, this.uniforms, false);
    this.sparks = new Pool(sparks, this.uniforms, true);
    this.objects = [this.soft.mesh, this.sparks.mesh];
  }

  /** The clock the particles are drawn at (simulated seconds). */
  set time(t) {
    this.uniforms.uTime.value = t;
  }

  /**
   * Born now. `kind` is a KINDS entry.
   * @param {{ id: number }} kind
   */
  emit(kind, x, y, z, vx, vy, vz, time, life, size0, size1, seed, groundY) {
    const pool = kind.id === KINDS.spark.id ? this.sparks : this.soft;
    pool.emit(x, y, z, vx, vy, vz, time, life, kind.id, size0, size1, seed, groundY);
  }

  /**
   * The light the puffs are lit by.
   * @param {import('../world/lighting.js').TimeOfDay} time
   */
  setLight(time) {
    const u = this.uniforms;
    const s = time.sun;
    u.uSunDir.value.fromArray(s.dir).normalize();
    // the sun as it reaches the road (below the horizon it does not)
    const up = Math.min(1, Math.max(0, s.dir[1] * 6 + 0.2));
    u.uSun.value.fromArray(s.color).multiplyScalar(s.intensity * up);
    const sky = time.sky;
    const env = time.env ? time.env.intensity : 1;
    const a = time.ambient;
    u.uAmbient.value.set(
      Math.PI * 0.5 * (sky.zenith[0] + sky.horizon[0]) * env + a.sky[0] * a.intensity,
      Math.PI * 0.5 * (sky.zenith[1] + sky.horizon[1]) * env + a.sky[1] * a.intensity,
      Math.PI * 0.5 * (sky.zenith[2] + sky.horizon[2]) * env + a.sky[2] * a.intensity,
    );
    // sparks: brighter than anything lit near them, by day and by night alike (the exposure differs ~100x)
    u.uSpark.value = 6 + 30 * s.intensity * up;
  }

  /** Forget every particle. */
  clear() {
    this.soft.clear();
    this.sparks.clear();
  }

  upload() {
    this.soft.upload();
    this.sparks.upload();
  }

  dispose() {
    this.soft.dispose();
    this.sparks.dispose();
  }
}
