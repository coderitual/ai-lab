// The lamps along the road: the street lamps of the start straight and the two
// rows of luminaires in the tunnel. Each is three things that add up to one
// lamp, so that a car can drive under it without anything popping:
//  - its HEAD, an emitter far brighter than anything it lights (it blooms,
//    and the cars' reflection probes see it slide over their paint);
//  - a REAL LIGHT, but only near a car: the scene keeps a fixed pool of spot
//    lights (2, 4 or 6 by tier) and prepareView hands them to the lamps
//    nearest the view's car, each faded in and out by its distance and its
//    rank, so the cars and the road's speculars are lit by the lamps they
//    pass under;
//  - a GLOW on the ground under it, cheap and additive: the same spot light
//    worked out analytically on a patch of the corridor's surface, times
//    one minus the lamp's share of the pool. Real light and glow cross-fade
//    lamp by lamp, so the sum stays the same as a lamp is handed over.
// The tunnel's bore reads the same weights (`real`) for its baked lamp light.
//
// Lamps follow lighting.js: street lamps are off by day, the tunnel's always on.

import * as THREE from 'three';
import { ATMOSPHERE_PARS } from './atmosphere.js';
import { GLSL_TARGET, targetDefines } from '../../engine/glsl.js';
import { footBox, levelFrame, row, upright } from './furniture.js';

/**
 * What each kind of lamp is, in scene units (lighting.js): `intensity` candela on the spot's axis, `range` the
 * distance at which its light has faded to nothing, `angle` and `penumbra` as three.js's SpotLight has them,
 * `tilt` how far the spot leans towards the road (rad), `head` the radiance of its emitter, `color` linear.
 */
export const LAMP_KINDS = {
  street: { intensity: 14, range: 26, angle: 1.25, penumbra: 0.65, tilt: 0.42, head: 90, color: [1.0, 0.86, 0.7], arm: 2.4 },
  tunnel: { intensity: 26, range: 18, angle: 1.3, penumbra: 0.5, tilt: 0.6, head: 55, color: [1.0, 0.62, 0.3], arm: 0 },
};
/** Pool size per tier. */
const POOL = { low: 2, medium: 4, high: 6 };
/** Beyond this distance from the view's car (m) a lamp is head and glow only; it fades in over the half inside. */
const REACH = { low: 18, medium: 26, high: 34 };
/** A lamp hands its light over across this many metres of rank (see weigh()). */
const HANDOVER = 5;
/** What the glow assumes the ground sends back (asphalt and grass, 0.07..0.11). */
const GROUND_ALBEDO = 0.09;

/** GLSL: what one spot lamp lays on a surface, exactly as three.js's SpotLight does with decay 2. */
export const SPOT_GLSL = /* glsl */ `
float spotIrradiance(vec3 P, vec3 N, vec3 lampPos, vec3 lampDir, float intensity, float range, vec2 cone) {
  vec3 L = lampPos - P;
  float d = length(L);
  L /= max(d, 1.0e-3);
  float spot = smoothstep(cone.x, cone.y, dot(-L, lampDir));
  float fade = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0);
  return intensity * spot * fade * fade / max(d * d, 0.01) * max(dot(N, L), 0.0);
}
`;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createLamps({ track, caps, tier, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'lamps';
  const frame = {};
  const p = new THREE.Vector3();

  // ---- where each lamp is: the light's position and its axis
  const lamps = track.lamps.map((lamp, index) => {
    const kind = LAMP_KINDS[lamp.kind] ? lamp.kind : lamp.height > 6 ? 'street' : 'tunnel';
    const spec = LAMP_KINDS[kind];
    levelFrame(track, lamp.s, frame);
    const lat = lamp.lat ?? lamp.side * track.edgeAt(lamp.s, lamp.side);
    const foot = track.pointAt(lamp.s, lat, new THREE.Vector3());
    // the head reaches in over the road on its arm
    const inward = frame.flat.clone().multiplyScalar(-lamp.side);
    const head = foot.clone().addScaledVector(inward, spec.arm);
    head.y = foot.y + lamp.height;
    const dir = new THREE.Vector3(0, -1, 0).addScaledVector(inward, Math.tan(spec.tilt)).normalize();
    return { index, kind, spec, s: lamp.s, side: lamp.side, lat, foot, head, dir, yaw: frame.yaw };
  });
  const byKind = (kind) => lamps.filter((l) => l.kind === kind);

  /** Each lamp's share of the pool's real light, 0..1 (read by the glow and by the bore's baked light). */
  const real = { value: new Array(Math.max(1, lamps.length)).fill(0) };
  /** How far each kind is turned up (lighting.js lamps). */
  const on = { street: 0, tunnel: 1 };
  const onUniform = { value: new Array(Math.max(1, lamps.length)).fill(0) };

  // ---- the heads (and the street lamps' poles)
  const metal = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x585d63, roughness: 0.45, metalness: 0.7 }));
  const emitters = {};
  for (const kind of Object.keys(LAMP_KINDS)) {
    emitters[kind] = atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0x000000 }));
  }
  const street = byKind('street');
  if (street.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 1, 10, 1).translate(0, 0.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1).translate(0, 0, 0.5);
    const housing = new THREE.BoxGeometry(0.34, 0.1, 0.72);
    const emitter = new THREE.PlaneGeometry(0.28, 0.6).rotateX(Math.PI / 2);
    const m = (l, fn) => street.map((lamp) => fn(lamp));
    const inwardYaw = (lamp) => lamp.yaw + (lamp.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(
      row(pole, metal, m(street, (l) => upright(l.foot, l.yaw, 1, l.head.y - l.foot.y + 0.1, 1)), { name: 'lamp-poles' }),
      row(arm, metal, m(street, (l) => upright(p.copy(l.foot).setY(l.head.y + 0.12), inwardYaw(l), 1, 1, l.spec.arm)), { name: 'lamp-arms' }),
      row(housing, metal, m(street, (l) => upright(p.copy(l.head).setY(l.head.y + 0.05), inwardYaw(l))), { name: 'lamp-housings' }),
      row(emitter, emitters.street, m(street, (l) => upright(p.copy(l.head).setY(l.head.y - 0.005), inwardYaw(l))), { shadow: false, name: 'lamp-emitters' }),
    );
  }
  const tunnel = byKind('tunnel');
  if (tunnel.length) {
    const housing = new THREE.BoxGeometry(0.42, 0.16, 1.3);
    const emitter = new THREE.PlaneGeometry(0.32, 1.15).rotateX(Math.PI / 2);
    const bracket = footBox();
    group.add(
      row(housing, metal, tunnel.map((l) => upright(p.copy(l.head).setY(l.head.y + 0.08), l.yaw)), { shadow: false, name: 'tunnel-lamp-housings' }),
      row(bracket, metal, tunnel.map((l) => upright(p.copy(l.head).setY(l.head.y + 0.16), l.yaw, 0.06, 0.5, 0.06)), { shadow: false, name: 'tunnel-lamp-brackets' }),
      row(emitter, emitters.tunnel, tunnel.map((l) => upright(p.copy(l.head).setY(l.head.y - 0.005), l.yaw)), { shadow: false, name: 'tunnel-lamp-emitters' }),
    );
  }

  // ---- the glow on the ground: a patch of the corridor's surface under each lamp
  const glowGeometry = buildGlowGeometry(track, lamps);
  const glowMaterial = new THREE.ShaderMaterial({
    defines: { ...targetDefines(caps), LAMPS: Math.max(1, lamps.length) },
    uniforms: { ...atmosphere.uniforms, uReal: real, uOn: onUniform, uAlbedo: { value: GROUND_ALBEDO } },
    vertexShader: /* glsl */ `
attribute vec3 aLampPos;
attribute vec3 aLampDir;
attribute vec4 aLampSpec; // intensity, range, cos outer, cos inner
attribute vec3 aLampColor;
attribute float aLampIndex;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLampPos; varying vec3 vLampDir;
varying vec4 vSpec; varying vec3 vColor; flat varying int vIndex;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
  vLampPos = aLampPos; vLampDir = aLampDir; vSpec = aLampSpec; vColor = aLampColor; vIndex = int(aLampIndex + 0.5);
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    fragmentShader: /* glsl */ `
${GLSL_TARGET}
${ATMOSPHERE_PARS}
${SPOT_GLSL}
uniform float uReal[LAMPS];
uniform float uOn[LAMPS];
uniform float uAlbedo;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLampPos; varying vec3 vLampDir;
varying vec4 vSpec; varying vec3 vColor; flat varying int vIndex;
void main() {
  float share = uOn[vIndex] * (1.0 - uReal[vIndex]);
  float E = share * spotIrradiance(vWorld, normalize(vNormal), vLampPos, vLampDir, vSpec.x, vSpec.y, vSpec.zw);
  vec3 ray = vWorld - cameraPosition;
  vec3 light = vColor * uAlbedo / 3.14159265 * E * (1.0 - hazeBetween(cameraPosition.y, ray));
  gl_FragColor = toTarget(vec4(light, 1.0));
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.name = 'lamp-glow';
  glow.renderOrder = 1;
  group.add(glow);

  // ---- the pool of real lights
  const size = POOL[tier] ?? 4;
  const reach = REACH[tier] ?? 26;
  const pool = [];
  for (let k = 0; k < size; k++) {
    const light = new THREE.SpotLight(0xffffff, 0, 1, 1, 0.5, 2);
    light.castShadow = false;
    light.name = `lamp-pool-${k}`;
    group.add(light, light.target);
    pool.push(light);
  }
  const order = lamps.map((_, i) => i);
  const dist = new Float32Array(lamps.length);

  /** Hands the pool to the lamps nearest `focus`. */
  function weigh(focus) {
    for (let i = 0; i < lamps.length; i++) dist[i] = lamps[i].head.distanceTo(focus);
    order.sort((a, b) => dist[a] - dist[b]);
    const cut = order.length > size ? dist[order[size]] : Infinity;
    real.value.fill(0);
    for (let k = 0; k < size; k++) {
      const light = pool[k];
      const i = order[k];
      const lamp = i === undefined ? null : lamps[i];
      const lit = lamp ? on[lamp.kind] : 0;
      if (!lamp || lit <= 0) {
        light.intensity = 0;
        continue;
      }
      const d = dist[i];
      // nearer than the first lamp left out by HANDOVER: full; and full inside half the reach
      const w = Math.min(1, Math.max(0, (cut - d) / HANDOVER)) * (1 - smooth(reach * 0.5, reach, d));
      real.value[i] = w;
      const spec = lamp.spec;
      light.position.copy(lamp.head);
      light.target.position.copy(lamp.head).add(lamp.dir);
      light.target.updateMatrixWorld();
      light.color.setRGB(...spec.color);
      light.intensity = spec.intensity * lit * w;
      light.distance = spec.range;
      light.angle = spec.angle;
      light.penumbra = spec.penumbra;
    }
  }

  return {
    group,
    lamps,
    /** Each lamp's share of the real light (a uniform's value object: shared with the bore). */
    real,
    on: onUniform,
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      on.street = time.lamps.street;
      on.tunnel = time.lamps.tunnel;
      lamps.forEach((lamp, i) => (onUniform.value[i] = on[lamp.kind]));
      for (const [kind, material] of Object.entries(emitters)) {
        const spec = LAMP_KINDS[kind];
        material.color.setRGB(...spec.color.map((c) => c * spec.head * on[kind]));
      }
    },
    prepareView(camera, focus) {
      weigh(focus);
    },
    stats: { lamps: lamps.length, pool: size },
    dispose() {
      glowGeometry.dispose();
      glowMaterial.dispose();
    },
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One patch of the corridor's own surface per lamp, as far round its foot as its light reaches, lifted a few
 * centimetres; every vertex carries its lamp. Columns sit on the profile's kinks so the patch never dips under
 * the pavement's edge.
 */
function buildGlowGeometry(track, lamps) {
  const pos = [];
  const nor = [];
  const lampPos = [];
  const lampDir = [];
  const spec = [];
  const color = [];
  const index = [];
  const ids = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const lamp of lamps) {
    const s = lamp.spec;
    const reach = s.range * 0.85;
    const lo = -track.edgeAt(lamp.s, -1) + 0.02;
    const hi = track.edgeAt(lamp.s, 1) - 0.02;
    const centre = lamp.lat - lamp.side * s.arm;
    const from = Math.max(lo, centre - reach);
    const to = Math.min(hi, centre + reach);
    const cols = new Set([from, to]);
    for (let k = 0; k <= 10; k++) cols.add(from + ((to - from) * k) / 10);
    for (const kink of [track.halfWidth, track.halfWidth + 0.6]) {
      for (const sign of [1, -1]) if (sign * kink > from && sign * kink < to) cols.add(sign * kink);
    }
    const lats = [...cols].sort((x, y) => x - y);
    const rows = Math.max(4, Math.ceil((2 * reach) / 2));
    const base = pos.length / 3;
    const cos = [Math.cos(s.angle), Math.cos(s.angle * (1 - s.penumbra))];
    for (let r = 0; r <= rows; r++) {
      const along = lamp.s - reach + (2 * reach * r) / rows;
      for (const lat of lats) {
        track.pointAt(along, lat, a);
        track.pointAt(along + 0.3, lat, b).sub(a);
        track.pointAt(along, lat + 0.3 * Math.sign(lat || 1), c).sub(a).multiplyScalar(Math.sign(lat || 1));
        const n = new THREE.Vector3().crossVectors(c, b).normalize();
        if (n.y < 0) n.negate();
        pos.push(a.x, a.y + 0.03, a.z);
        nor.push(n.x, n.y, n.z);
        lampPos.push(lamp.head.x, lamp.head.y, lamp.head.z);
        lampDir.push(lamp.dir.x, lamp.dir.y, lamp.dir.z);
        spec.push(s.intensity, s.range, cos[0], cos[1]);
        color.push(...s.color);
        ids.push(lamp.index);
      }
    }
    const m = lats.length;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < m - 1; k++) {
        const v = base + r * m + k;
        index.push(v, v + 1, v + m, v + 1, v + m + 1, v + m);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aLampPos', new THREE.Float32BufferAttribute(lampPos, 3));
  geometry.setAttribute('aLampDir', new THREE.Float32BufferAttribute(lampDir, 3));
  geometry.setAttribute('aLampSpec', new THREE.Float32BufferAttribute(spec, 4));
  geometry.setAttribute('aLampColor', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('aLampIndex', new THREE.Float32BufferAttribute(ids, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}
