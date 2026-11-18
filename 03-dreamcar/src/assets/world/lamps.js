// The lamps along the road: the street lamps of the start straight, the
// floodlights round the rest of the lap and the two rows of luminaires in the
// tunnel. Each is three things that add up to one lamp, so that a car can
// drive under it without anything popping:
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
// The tunnel's bore reads the same weights (`shares`) for its baked lamp light.
// A lamp on a pole has a fourth part at night: its CONE, the light seen in the
// damp air under it (lighting.js lamps.haze), additive and drawn as the
// surface of a cone whose brightness is the length of air a ray crosses.
//
// Lamps follow lighting.js: street lamps and floodlights are off by day, the
// tunnel's always on. How far each lamp is on, and its share of the pool, are
// one small texture (`shares`, a texel per lamp) rather than uniform arrays: a
// lap has a hundred and fifty lamps, more uniforms than a phone's shader holds.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOSPHERE_PARS } from './atmosphere.js';
import { GLSL_TARGET, targetDefines } from '../../engine/glsl.js';
import { footBox, levelFrame, upright } from './furniture.js';
import { WET_UNIFORMS } from './shading.js';

/**
 * What each kind of lamp is, in scene units (lighting.js): `intensity` candela on the spot's axis, `range` the
 * distance at which its light has faded to nothing, `angle` and `penumbra` as three.js's SpotLight has them,
 * `tilt` how far the spot leans towards the road (rad), `head` the radiance of its emitter, `color` linear.
 */
export const LAMP_KINDS = {
  street: { intensity: 14, range: 26, angle: 1.25, penumbra: 0.65, tilt: 0.42, head: 90, color: [1.0, 0.86, 0.7], arm: 2.4 },
  // (night lane) the floodlights round the lap: taller, a cooler white than the straight's warm lamps, so that the
  // wet road mirrors two colours of light
  // (finish lane) they stand back from the edge (trackLayout.js lapLamps.setback) and higher, leaning further in, so
  // that the chase camera never has a pole between it and the car and is never close under a head
  lap: { intensity: 18, range: 32, angle: 1.2, penumbra: 0.6, tilt: 0.44, head: 120, color: [0.84, 0.92, 1.0], arm: 2.2 },
  // (render lane) a warm white, not sodium orange: under the orange lamps the bore, the road and the car were one
  // murky brown; a little stronger, so that each lamp lays a pool on the road
  tunnel: { intensity: 34, range: 18, angle: 1.3, penumbra: 0.5, tilt: 0.6, head: 55, color: [1.0, 0.85, 0.66], arm: 0 },
};
/** Pool size per tier. */
const POOL = { low: 2, medium: 4, high: 6 };
/** Beyond this distance from the view's car (m) a lamp is head and glow only; it fades in over the half inside. */
const REACH = { low: 18, medium: 26, high: 34 };
/** A lamp hands its light over across this many metres of rank (see weigh()). */
const HANDOVER = 5;
/** What the glow assumes the ground sends back (asphalt and grass, 0.07..0.11). */
const GROUND_ALBEDO = 0.09;
/**
 * The cone of light in the damp air under a lamp on a pole: its half angle (rad), its radiance seen through its
 * middle near the head at full haze (scene units: about 1/4000 of the head's), and how it fades towards the
 * ground (a power of the distance from the head, as the light thins out over the cone's widening section). `near`:
 * from how far (m) to how far it fades in with its distance from the eye (finish lane: a cone a dozen metres from the
 * chase camera filled a phone's portrait frame with its light).
 */
const CONE = { angle: 0.45, radiance: 0.018, fade: 2.0, sides: 10, near: [12, 36] };
/**
 * What the wet road's mirror sees of a lamp's head: a soft disc of light `radius` metres across the damp air round
 * it (gaussian, `radiance` at its middle), drawn only into the mirror, where a head a few centimetres wide would
 * vanish between its texels and the picture has no bloom of its own. It is what the road draws out into a streak.
 */
const HALO = { radius: 2.2, radiance: 2.5 };
/** Lamps whose heads the wet road glints with where there is no mirror (low tier): the nearest, ahead. */
export const GLINTS = 6;

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
 * @param {{ pos: { value: THREE.Vector4[] }, color: { value: THREE.Vector3[] } }} [options.glints] filled in each
 *   prepareView with the heads of the GLINTS lit lamps nearest the eye (xyz, w the head's radiance): the wet road's
 *   stand-in for its mirror where there is none
 */
export function createLamps({ track, terrain = null, caps, tier, atmosphere, glints = null }) {
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
    // the head reaches in over the road on its arm, `height` over the corridor's level where the pole stands
    const inward = frame.flat.clone().multiplyScalar(-lamp.side);
    const head = foot.clone().addScaledVector(inward, spec.arm);
    head.y = foot.y + lamp.height;
    // (finish lane) a pole set back beyond the solid edge stands on the ground there, if that lies lower
    if (terrain && Math.abs(lat) > track.edgeAt(lamp.s, lamp.side) + 0.05) foot.y = Math.min(foot.y, terrain.heightAt(foot.x, foot.z) - 0.1);
    const dir = new THREE.Vector3(0, -1, 0).addScaledVector(inward, Math.tan(spec.tilt)).normalize();
    return { index, kind, spec, s: lamp.s, side: lamp.side, lat, foot, head, dir, yaw: frame.yaw };
  });
  const byKind = (kind) => lamps.filter((l) => l.kind === kind);

  /** Each lamp's share of the pool's real light, 0..1 (what the shares texture's green holds). */
  const real = new Float32Array(Math.max(1, lamps.length));
  /** How far each kind is turned up (lighting.js lamps; the floodlights go with the street lamps). */
  const on = { street: 0, lap: 0, tunnel: 1 };
  /** Per lamp: red how far it is on, green its share of the pool (read by the glow and by the bore's baked light). */
  const shareData = new Uint8Array(Math.max(1, lamps.length) * 4);
  const shares = new THREE.DataTexture(shareData, Math.max(1, lamps.length), 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  shares.magFilter = shares.minFilter = THREE.NearestFilter;
  const sharesUniform = { value: shares };
  const writeShares = () => {
    for (let i = 0; i < lamps.length; i++) {
      shareData[i * 4] = Math.round(255 * on[lamps[i].kind]);
      shareData[i * 4 + 1] = Math.round(255 * real[i]);
    }
    shares.needsUpdate = true;
  };

  // ---- the heads (and the poles of the lamps that stand on them)
  // (finish lane) Everything of one material is one mesh: a lamp's pole, arm and housing are baked into one geometry
  // with every other lamp's (world/index.js then cuts it into 400 m pieces), and the emitters of the street lamps
  // and the floodlights, which switch together, are one mesh whose vertex colours carry each kind's colour and
  // radiance. Five instanced rows per piece were five draw calls; this is two.
  const metal = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x585d63, roughness: 0.45, metalness: 0.7 }));
  /** The emitters: the poled lamps' (street and lap, vertex colours) and the tunnel's; their colour is how far they are on. */
  const emitters = {
    poled: atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true })),
    tunnel: atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0x000000 })),
  };
  const emitterMeshes = {};
  const street = lamps.filter((l) => l.kind === 'street' || l.kind === 'lap');
  if (street.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 1, 10, 1).translate(0, 0.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1).translate(0, 0, 0.5);
    const housing = new THREE.BoxGeometry(0.34, 0.1, 0.72);
    const emitter = new THREE.PlaneGeometry(0.28, 0.6).rotateX(Math.PI / 2);
    const inwardYaw = (lamp) => lamp.yaw + (lamp.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    const fittings = baked(
      street.flatMap((l) => [
        [pole, upright(l.foot, l.yaw, 1, l.head.y - l.foot.y + 0.1, 1)],
        [arm, upright(p.copy(l.foot).setY(l.head.y + 0.12), inwardYaw(l), 1, 1, l.spec.arm)],
        [housing, upright(p.copy(l.head).setY(l.head.y + 0.05), inwardYaw(l))],
      ]),
    );
    group.add(plain(fittings, metal, { name: 'lamp-fittings' }));
    const heads = baked(street.map((l) => [emitter, upright(p.copy(l.head).setY(l.head.y - 0.005), inwardYaw(l)), l.spec.color.map((c) => c * l.spec.head)]));
    emitterMeshes.poled = plain(heads, emitters.poled, { shadow: false, name: 'lamp-emitters' });
    group.add(emitterMeshes.poled);
    for (const g of [pole, arm, housing, emitter]) g.dispose();
  }
  const tunnel = byKind('tunnel');
  if (tunnel.length) {
    const housing = new THREE.BoxGeometry(0.42, 0.16, 1.3);
    const emitter = new THREE.PlaneGeometry(0.32, 1.15).rotateX(Math.PI / 2);
    const bracket = footBox();
    const fittings = baked(
      tunnel.flatMap((l) => [
        [housing, upright(p.copy(l.head).setY(l.head.y + 0.08), l.yaw)],
        [bracket, upright(p.copy(l.head).setY(l.head.y + 0.16), l.yaw, 0.06, 0.5, 0.06)],
      ]),
    );
    group.add(plain(fittings, metal, { shadow: false, name: 'tunnel-lamp-fittings' }));
    const heads = baked(tunnel.map((l) => [emitter, upright(p.copy(l.head).setY(l.head.y - 0.005), l.yaw)]));
    emitterMeshes.tunnel = plain(heads, emitters.tunnel, { shadow: false, name: 'tunnel-lamp-emitters' });
    group.add(emitterMeshes.tunnel);
    for (const g of [housing, emitter, bracket]) g.dispose();
  }

  // ---- the glow on the ground: a patch of the corridor's surface under each lamp
  // (picture lane) one mesh per kind that switches, so that a kind switched off (the street lamps by day) is not drawn
  // at all; (finish lane) the street lamps and the floodlights switch together, so they are one mesh
  const glowGeometries = [
    ['street', street],
    ['tunnel', tunnel],
  ]
    .filter(([, l]) => l.length)
    .map(([kind, l]) => [kind, buildGlowGeometry(track, l)]);
  const glowMaterial = new THREE.ShaderMaterial({
    defines: { ...targetDefines(caps) },
    uniforms: { ...atmosphere.uniforms, uShares: sharesUniform, uAlbedo: { value: GROUND_ALBEDO }, uWet: WET_UNIFORMS.uWet },
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
uniform sampler2D uShares;
uniform float uAlbedo;
uniform float uWet;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLampPos; varying vec3 vLampDir;
varying vec4 vSpec; varying vec3 vColor; flat varying int vIndex;
void main() {
  vec2 lamp = texelFetch(uShares, ivec2(vIndex, 0), 0).rg;
  float share = lamp.r * (1.0 - lamp.g);
  float E = share * spotIrradiance(vWorld, normalize(vNormal), vLampPos, vLampDir, vSpec.x, vSpec.y, vSpec.zw);
  vec3 ray = vWorld - cameraPosition;
  // (night lane) wet ground is darker: its pores are full and what it does not soak up it mirrors (road.js)
  vec3 light = vColor * uAlbedo * (1.0 - 0.45 * uWet) / 3.14159265 * E * (1.0 - hazeBetween(cameraPosition.y, ray));
  gl_FragColor = toTarget(vec4(light, 1.0));
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const glows = glowGeometries.map(([kind, geometry]) => {
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.name = `lamp-glow-${kind}`;
    glow.renderOrder = 1;
    glow.userData.kind = kind;
    group.add(glow);
    return glow;
  });

  // ---- the cones of light in the damp air under the lamps on poles (night only: lighting.js lamps.haze)
  const poled = lamps.filter((l) => l.kind === 'street' || l.kind === 'lap');
  const coneGain = { value: 0 };
  const coneMaterial = new THREE.ShaderMaterial({
    defines: { ...targetDefines(caps) },
    uniforms: { ...atmosphere.uniforms, uShares: sharesUniform, uConeGain: coneGain },
    vertexShader: /* glsl */ `
attribute vec2 aCone; // 0 at the head .. 1 at the ground; the lamp's index
attribute vec3 aConeColor;
varying vec3 vWorld; varying vec3 vNormal; varying float vT; varying vec3 vColor; flat varying int vIndex;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
  vT = aCone.x; vIndex = int(aCone.y + 0.5); vColor = aConeColor;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    fragmentShader: /* glsl */ `
${GLSL_TARGET}
${ATMOSPHERE_PARS}
uniform sampler2D uShares;
uniform float uConeGain;
varying vec3 vWorld; varying vec3 vNormal; varying float vT; varying vec3 vColor; flat varying int vIndex;
void main() {
  float lit = texelFetch(uShares, ivec2(vIndex, 0), 0).r;
  vec3 ray = vWorld - cameraPosition;
  float d = length(ray);
  // the air a ray crosses inside the cone: longest through its middle, nothing along its edge
  float through = abs(dot(normalize(vNormal), ray / d));
  // brightest near the head, thinning out as the light spreads; gone a little above the ground (no seam with it)
  float along = pow(1.0 - vT, ${CONE.fade.toFixed(2)}) * smoothstep(1.0, 0.8, vT);
  // seen from inside or close to the cone (the car under the lamp) the air is all round: no surface to draw
  float near = smoothstep(${CONE.near[0].toFixed(1)}, ${CONE.near[1].toFixed(1)}, d);
  float k = uConeGain * lit * through * through * along * near * (1.0 - hazeBetween(cameraPosition.y, ray));
  gl_FragColor = toTarget(vec4(vColor * k, 1.0));
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coneGeometry = poled.length ? buildConeGeometry(track, poled) : null;
  const cones = coneGeometry ? new THREE.Mesh(coneGeometry, coneMaterial) : null;
  if (cones) {
    cones.name = 'lamp-cones';
    cones.renderOrder = 2;
    cones.visible = false;
    group.add(cones);
  }

  // ---- the heads' halos as the road's mirror sees them (world/index.js shows them for the mirror's pass only)
  const haloHeight = { value: 256 };
  const haloMaterial = new THREE.ShaderMaterial({
    defines: { ...targetDefines(caps) },
    uniforms: { ...atmosphere.uniforms, uShares: sharesUniform, uHeight: haloHeight },
    vertexShader: /* glsl */ `
attribute float aLamp;
attribute vec3 aHaloColor;
uniform float uHeight;
varying vec3 vColor; varying vec3 vWorld; flat varying int vIndex;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vWorld = world.xyz; vColor = aHaloColor; vIndex = int(aLamp + 0.5);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(${(2 * HALO.radius).toFixed(2)} * projectionMatrix[1][1] * 0.5 * uHeight / max(-view.z, 0.1), 1.0, 256.0);
}`,
    fragmentShader: /* glsl */ `
${GLSL_TARGET}
${ATMOSPHERE_PARS}
uniform sampler2D uShares;
varying vec3 vColor; varying vec3 vWorld; flat varying int vIndex;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float lit = texelFetch(uShares, ivec2(vIndex, 0), 0).r;
  float k = ${HALO.radiance.toFixed(2)} * lit * exp(-4.0 * r2) * (1.0 - r2) * (1.0 - hazeBetween(cameraPosition.y, vWorld - cameraPosition));
  gl_FragColor = toTarget(vec4(vColor * k, 1.0));
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  let halos = null;
  if (poled.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(poled.flatMap((l) => [l.head.x, l.head.y - 0.1, l.head.z]), 3));
    geometry.setAttribute('aLamp', new THREE.Float32BufferAttribute(poled.map((l) => l.index), 1));
    geometry.setAttribute('aHaloColor', new THREE.Float32BufferAttribute(poled.flatMap((l) => l.spec.color), 3));
    geometry.computeBoundingSphere();
    halos = new THREE.Points(geometry, haloMaterial);
    halos.name = 'lamp-halos';
    halos.frustumCulled = false;
    halos.visible = false;
    group.add(halos);
  }

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
    real.fill(0);
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
      real[i] = w;
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

  /** The lit lamps on poles nearest the eye, ahead of it, into `glints`. */
  const ahead = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const near = [];
  function glint(camera) {
    if (!glints) return;
    camera.getWorldPosition(eye);
    camera.getWorldDirection(ahead);
    near.length = 0;
    for (const lamp of poled) {
      if (on[lamp.kind] <= 0) continue;
      const dx = lamp.head.x - eye.x;
      const dz = lamp.head.z - eye.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 220 * 220 || dx * ahead.x + dz * ahead.z < -10) continue;
      near.push([d2, lamp]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < GLINTS; k++) {
      const lamp = near[k]?.[1];
      const pos = glints.pos.value[k];
      if (!lamp) {
        pos.w = 0;
        continue;
      }
      pos.set(lamp.head.x, lamp.head.y, lamp.head.z, lamp.spec.head * on[lamp.kind]);
      glints.color.value[k].fromArray(lamp.spec.color);
    }
  }

  return {
    group,
    lamps,
    /** The glow on the ground, one mesh per kind of lamp. */
    glows,
    /** The cones of light under the lamps on poles (null without any). */
    cones,
    /** The poled lamps' emitters (null without any): the road's mirror sees their halos instead. */
    heads: emitterMeshes.poled ?? null,
    /**
     * The heads' halos for the road's mirror (null without lamps on poles): shown only while the mirror is drawn,
     * with `height` the mirror picture's height in pixels.
     */
    halos: halos && {
      object: halos,
      show(height) {
        haloHeight.value = height;
        halos.visible = on.street > 0;
      },
      hide() {
        halos.visible = false;
      },
    },
    /** Per lamp, a texel: red how far it is on, green its share of the pool's real light (shared with the bore). */
    shares: sharesUniform,
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      on.street = time.lamps.street;
      on.lap = time.lamps.street;
      on.tunnel = time.lamps.tunnel;
      writeShares();
      for (const glow of glows) glow.visible = on[glow.userData.kind] > 0;
      // (the poled emitters' colour and radiance are in their vertex colours; a lamp switched off is not drawn)
      emitters.poled.color.setScalar(on.street);
      const tunnelSpec = LAMP_KINDS.tunnel;
      emitters.tunnel.color.setRGB(...tunnelSpec.color.map((c) => c * tunnelSpec.head * on.tunnel));
      if (emitterMeshes.poled) emitterMeshes.poled.visible = on.street > 0;
      coneGain.value = CONE.radiance * (time.lamps.haze ?? 0);
      if (cones) cones.visible = coneGain.value > 0 && on.street > 0;
    },
    prepareView(camera, focus) {
      weigh(focus);
      writeShares();
      glint(camera);
    },
    stats: { lamps: lamps.length, pool: size, cones: poled.length },
    dispose() {
      for (const [, geometry] of glowGeometries) geometry.dispose();
      glowMaterial.dispose();
      coneGeometry?.dispose();
      coneMaterial.dispose();
      halos?.geometry.dispose();
      haloMaterial.dispose();
      shares.dispose();
    },
  };
}

/**
 * An open cone from each lamp's head down its axis to the ground, CONE.sides around; `aCone` is (how far from the
 * head, 0..1; the lamp's index), `aConeColor` the lamp's colour.
 */
function buildConeGeometry(track, lamps) {
  const pos = [];
  const nor = [];
  const cone = [];
  const color = [];
  const index = [];
  const frame = {};
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const r = new THREE.Vector3();
  const tan = Math.tan(CONE.angle);
  const n = CONE.sides;
  for (const lamp of lamps) {
    track.frameAt(lamp.s, frame);
    const ground = track.pointAt(lamp.s, lamp.lat - lamp.side * lamp.spec.arm, new THREE.Vector3()).y;
    // the axis's length to the ground under the head
    const length = Math.max(2, (lamp.head.y - ground) / Math.max(0.3, -lamp.dir.y));
    u.set(1, 0, 0).addScaledVector(lamp.dir, -lamp.dir.x);
    if (u.lengthSq() < 1e-4) u.set(0, 0, 1).addScaledVector(lamp.dir, -lamp.dir.z);
    u.normalize();
    v.crossVectors(lamp.dir, u);
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      r.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
      for (const t of [0, 1]) {
        const along = t === 0 ? 0.12 : length;
        const radius = t === 0 ? 0.18 : length * tan;
        pos.push(lamp.head.x + lamp.dir.x * along + r.x * radius, lamp.head.y + lamp.dir.y * along + r.y * radius, lamp.head.z + lamp.dir.z * along + r.z * radius);
        // the side's normal: out from the axis, leaning back towards the head by the half angle
        const nx = r.x - lamp.dir.x * tan;
        const ny = r.y - lamp.dir.y * tan;
        const nz = r.z - lamp.dir.z * tan;
        const l = Math.hypot(nx, ny, nz);
        nor.push(nx / l, ny / l, nz / l);
        cone.push(t, lamp.index);
        color.push(...lamp.spec.color);
      }
    }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aCone', new THREE.Float32BufferAttribute(cone, 2));
  geometry.setAttribute('aConeColor', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
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
    // (picture lane) the light is worked out per pixel: the grid only has to follow the surface, which bends at the
    // pavement's edges (columns there) and hardly at all along the road. It was 10 columns and a row every metre:
    // 28 thousand triangles for the tunnel's lamps alone, drawn two and three deep where the patches overlap.
    const cols = new Set([from, to]);
    for (let k = 0; k <= 4; k++) cols.add(from + ((to - from) * k) / 4);
    for (const kink of [track.halfWidth, track.halfWidth + 0.6]) {
      for (const sign of [1, -1]) if (sign * kink > from && sign * kink < to) cols.add(sign * kink);
    }
    const lats = [...cols].sort((x, y) => x - y);
    const rows = Math.max(4, Math.ceil((2 * reach) / 5));
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

/**
 * (finish lane) One geometry of many placed copies: each [geometry, matrix, colour?] is transformed by its matrix (and
 * coloured, if a colour is given: an attribute `color` on every vertex) and all are merged.
 * @param {Array<[THREE.BufferGeometry, THREE.Matrix4, number[]?]>} parts
 */
function baked(parts) {
  const list = parts.map(([geometry, matrix, colour]) => {
    const g = geometry.clone().applyMatrix4(matrix);
    if (colour) g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(colour).flat(), 3));
    return g;
  });
  const out = mergeGeometries(list);
  for (const g of list) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** A plain mesh of a baked geometry, casting shadows unless told not to, receiving them. */
function plain(geometry, material, { shadow = true, name = '' } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.name = name;
  return mesh;
}
