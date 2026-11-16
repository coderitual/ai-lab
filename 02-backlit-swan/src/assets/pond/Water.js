// The surface of the pond: a black mirror with ripples on it.
//
// How a pixel of water gets its colour:
//
//   1. The slope of the surface there. Two things add up:
//      - the simulated ripple field (engine/RippleField.js): rings from drops,
//        from the bill, from whatever disturbs the water. Its texels are 2 to
//        3 cm, so it carries waves of 9 cm and up;
//      - the fine ripple that is always there (fineSlope below): wave trains
//        4 to 13 cm long that radiate from the swan, written as formulas so
//        they are sharp at any distance. They are small on calm water and
//        grow where the field says the water is agitated.
//   2. The eye ray is reflected about that slope and followed to where the
//      swan stands, and that point is looked up in the mirror picture (see
//      PlanarMirror.js: the mirror camera sees the real world, so any world
//      point can be projected into its picture). A level surface gives exactly
//      the mirror image. A tilted one lands somewhere else, further off the
//      further the reflected thing is, and because the water is seen from only
//      10 degrees above, a tilt toward or away from the eye moves the image
//      six times as far as the same tilt sideways. Nothing here blurs or
//      stretches the image on purpose: the fraying lower edge, the horizontal
//      slivers and the closed loops under the reflected head are all this.
//   3. The surroundings are looked up the same way in the defocused far
//      mirror, further along the ray, and the swan is laid over them.
//   4. How much is mirror and how much is the water's own dark colour depends
//      on the angle (Fresnel), with the curve fitted to the film.
//   5. The sun. A patch of water shows the sun to the eye when it is tilted
//      just so; how much of a pixel is tilted just so follows from the slope
//      there and from how rough the water is below what a pixel can show
//      (the agitation). Calm water is nowhere near; a splash is.

import * as THREE from 'three';
import { pondSurface } from './surface.js';

const TAU = Math.PI * 2;
const GRAVITY = 9.81;
/** Surface tension of water over its density, m3/s2: what makes centimetre waves run faster than gravity alone would. */
const CAPILLARY = 7.3e-5;

/**
 * Three slow, broad waves that carry nothing themselves: the wave trains
 * below add them to their phase, each in its own mix, and swell and thin with
 * their products. Two of them are rings round the swan like the trains: they
 * bunch the crests up in one place and spread them out in another without
 * turning them, so the bands under the swan come at uneven spacings but stay
 * level. The third lies across the pond and breaks crests along their length.
 * `length` in metres; `spiral` as for the trains, or `angle` in degrees for
 * the one across; `rate` in radians per second (they drift, so the crests are
 * not bunched in fixed places).
 */
const WARP = [
  { length: 0.23, spiral: 3, rate: 0.9 },
  { length: 0.37, spiral: -5, rate: -0.6 },
  { length: 0.31, angle: 70, rate: 0.5 },
];

/**
 * The wave trains of the fine ripple. Each is a ring wave spreading from the
 * swan: phase = 2 pi r / length + spiral * (angle round the swan) + warp.
 *   length  metres from crest to crest. The film shows two scales: fine, 4 to
 *           5 cm, and long-crested, about 10 cm.
 *   spiral  whole number; turns the rings into spiral arms, so that trains
 *           cross each other at a shallow angle instead of lying parallel.
 *           Kept small: seen from 10 degrees a crest turned by more than
 *           about 15 degrees no longer reads as a level band
 *   weight  share of the slope
 *   warp    how far (radians) each of the three WARP waves pushes its phase
 *   packet  two of the WARP waves whose product swells and thins the train
 *           (sign and strength in the third number). This is what makes the
 *           fine ripple come in short dashes while every dash stays level;
 *           the long waves go without, their crests are 0.2 to 0.4 m long
 *   detail  the lowest waterDetail that includes it
 * Their speed is not chosen: it is what water does (see phaseRate).
 */
const TRAINS = [
  { length: 0.105, spiral: 2, weight: 0.8, warp: [0.7, 0.5, 0.4], packet: null, detail: 0 },
  { length: 0.132, spiral: -3, weight: 0.7, warp: [-0.6, 0.7, -0.35], packet: null, detail: 0 },
  { length: 0.086, spiral: 4, weight: 0.6, warp: [0.5, -0.8, 0.4], packet: null, detail: 1 },
  { length: 0.045, spiral: -6, weight: 1.0, warp: [1.2, 0.9, 0.5], packet: [0, 2, 0.8], detail: 0 },
  { length: 0.052, spiral: 9, weight: 0.9, warp: [-1.0, 1.1, -0.5], packet: [1, 2, 0.8], detail: 0 },
  { length: 0.038, spiral: 5, weight: 0.8, warp: [0.9, -1.2, 0.55], packet: [0, 1, -0.8], detail: 0 },
  { length: 0.059, spiral: -11, weight: 0.8, warp: [-1.3, -0.8, -0.45], packet: [1, 2, -0.8], detail: 1 },
];

/**
 * How fast the phase of a wave of this length turns, radians per second:
 * the dispersion relation of water with gravity and surface tension. A 10 cm
 * wave runs at 0.40 m/s and a 4.5 cm one at 0.28 m/s, which from 10 degrees
 * up and 5 m away is the slow downward creep of the bands in the film.
 */
function phaseRate(length) {
  const k = TAU / length;
  return Math.sqrt(GRAVITY * k + CAPILLARY * k * k * k);
}

const f = (v) => {
  const s = String(Math.round(v * 1e5) / 1e5);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/** The GLSL of fineSlope() for the trains of one detail level. */
function fineSlopeGlsl(trains) {
  // Weights scaled so that the sum has a root-mean-square slope of 1. A
  // train swelling and thinning as 1 + p * (sine * sine) carries 1 + p^2 / 4
  // times the energy of a steady one.
  const energy = (t) => t.weight * t.weight * (t.packet ? 1 + (t.packet[2] * t.packet[2]) / 4 : 1);
  const norm = Math.sqrt(trains.reduce((sum, t) => sum + energy(t), 0) / 2);
  const warp = WARP.map((w, i) => {
    const k = TAU / w.length;
    const phase = `uWarpPhase.${'xyz'[i]}`;
    if (w.spiral !== undefined) {
      return /* glsl */ `
  float wa${i} = ${f(k)} * rlen + ${f(w.spiral)} * theta - ${phase};
  float w${i} = sin(wa${i});
  vec2 g${i} = (${f(k)} * rhat + (${f(w.spiral)} / rr) * that) * cos(wa${i});`;
    }
    const a = (w.angle * Math.PI) / 180;
    return /* glsl */ `
  vec2 wp${i} = vec2(${f(k * Math.cos(a))}, ${f(k * Math.sin(a))});
  float wa${i} = dot(xz, wp${i}) + ${phase};
  float w${i} = sin(wa${i});
  vec2 g${i} = wp${i} * cos(wa${i});`;
  }).join('');
  const body = trains
    .map((t, j) => {
      const k = TAU / t.length;
      const w = t.weight / norm;
      const swell = t.packet ? `(1.0 + ${f(t.packet[2])} * w${t.packet[0]} * w${t.packet[1]})` : '1.0';
      return /* glsl */ `
  {
    // which way and how fast this train's phase changes here, in radians per metre
    vec2 kv = ${f(k)} * rhat + (${f(t.spiral)} / rr) * that + ${f(t.warp[0])} * g0 + ${f(t.warp[1])} * g1 + ${f(t.warp[2])} * g2;
    float ph = ${f(k)} * rlen + ${f(t.spiral)} * theta + ${f(t.warp[0])} * w0 + ${f(t.warp[1])} * w1 + ${f(t.warp[2])} * w2 - uTrainPhase[${j}];
    // radians per pixel across and down the screen: past about two pixels a wave it cannot be drawn
    float keep = 1.0 - smoothstep(1.9, 3.3, max(abs(dot(kv, jx)), abs(dot(kv, jy))));
    slope += (${f(w / k)} * ${swell} * keep * cos(ph)) * kv;
    lost += ${f(energy(t) / (norm * norm * 2))} * (1.0 - keep * keep);
  }`;
    })
    .join('');
  return /* glsl */ `
const float HULL_HALF = 0.28;
uniform vec3 uWarpPhase;
uniform float uTrainPhase[${trains.length}];
// The slope of the fine ripple at a point of the water, scaled to a
// root-mean-square of 1. The trains spread from the swan's waterline: "r" is
// the distance to a line HULL_HALF either way along the body, so beside the
// bird the crests run straight and parallel to it (the level bands under a
// swan seen side-on) and round its ends they are rings. jx and jy are how far
// (metres) one pixel to the right and one pixel up move over the water; a
// train too fine for the pixels here is left out, and "lost" says how much of
// the whole that was (0 none .. 1 all), so that the caller can treat it as
// roughness instead. "away" is the direction the ripples travel in here.
vec2 fineSlope(vec2 xz, vec2 centre, vec2 axis, vec2 jx, vec2 jy, out float lost, out vec2 away) {
  vec2 rel = xz - centre;
  vec2 side = vec2(-axis.y, axis.x);
  float along = dot(rel, axis);
  vec2 q = vec2(along - clamp(along, -HULL_HALF, HULL_HALF), dot(rel, side));
  float rlen = length(q);
  vec2 qhat = q / max(rlen, 1.0e-4);
  vec2 rhat = axis * qhat.x + side * qhat.y;
  vec2 that = vec2(-rhat.y, rhat.x);
  away = rhat;
  // close in the spiral arms would wind up tight; hold them where they are at 0.3 m
  float rr = max(rlen, 0.3);
  float theta = rlen > 1.0e-4 ? atan(q.y, q.x) : 0.0;
${warp}
  vec2 slope = vec2(0.0);
  lost = 0.0;
${body}
  return slope;
}
`;
}

const VERTEX = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (ctx, surface, trains, mirrorTaps) => /* glsl */ `
${ctx.light.glsl}
${ctx.ripple.glsl}
${ctx.pond.glsl}
${surface.glsl}
${fineSlopeGlsl(trains)}
uniform sampler2D uMirrorTex;     // the subject, premultiplied, with alpha
uniform sampler2D uFarMirrorTex;  // the surroundings, defocused
uniform mat4 uMirrorMatrix;
uniform vec3 uSubject;            // where the reflected subject stands (world)
uniform vec3 uWaterShade;         // the water's own colour without the sun
uniform vec3 uWaterSun;           // what the sun adds to it
uniform vec3 uMirrorTint;
uniform vec4 uMirror;             // reflectance looking straight down, exponent of its rise toward grazing, distance to the surroundings, how fast the water's own glow fades toward grazing
uniform vec4 uRipple;             // fine slope on calm water, fine slope added per unit of agitation, spread of the sun's light (as a roughness), unused
uniform float uChopTime;          // the clock of the mottling (it runs at about six changes a second)
uniform vec4 uGlint;              // strength, roughness of calm water, roughness per unit of simulated slope, brightest allowed
in vec3 vWorldPos;

vec2 mirrorUv(vec3 world) {
  vec4 c = uMirrorMatrix * vec4(world, 1.0);
  return c.xy / c.w;
}

// The mirror picture of the subject at a world point. Beyond the picture's
// edge there is nothing (the clamped edge texel must not smear outward).
vec4 subjectAt(vec3 world) {
  vec2 uv = mirrorUv(world);
  vec2 e = min(uv, 1.0 - uv);
  float inside = step(0.0, min(e.x, e.y));
#if ${mirrorTaps} > 1
  // Where ripples squeeze a tall piece of the swan into a few pixels the
  // lookup jumps several texels from one pixel to the next and the slivers
  // would come out as staircases: take two half a pixel apart.
  vec2 d = dFdy(uv) * 0.25;
  vec4 t = 0.5 * (fromTarget(texture(uMirrorTex, uv + d)) + fromTarget(texture(uMirrorTex, uv - d)));
#else
  vec4 t = fromTarget(texture(uMirrorTex, uv));
#endif
  return t * inside;
}

void main() {
  vec2 xz = vWorldPos.xz;
  vec3 surface = vec3(xz.x, 0.0, xz.y);
  vec3 toEye = cameraPosition - surface;
  vec3 v = normalize(toEye);

  // ---- 1. the slope
  vec4 field = rippleSample4(xz);
  float agitation = field.w;
  float lost;
  vec2 away;
  vec2 fine = fineSlope(xz, uSubject.xz, uHullAxis.xy, dFdx(xz), dFdy(xz), lost, away);
  float fineSize = uRipple.x + uRipple.y * agitation;
  vec2 slope = field.yz + fine * fineSize;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ---- 2. the mirror
  vec3 r = reflect(-v, n);
  // a reflected ray that dives under the surface would see nothing; keep it just above
  r.y = max(r.y, 0.012);
  r = normalize(r);
  // Follow the ray to the upright plane the subject stands in (the plane
  // through it that faces the eye). For level water that is exactly the
  // mirror image; the more the ray is bent and the further away that plane
  // is, the further from it the lookup lands.
  vec2 ahead = normalize(-v.xz);
  float run = max(dot(r.xz, ahead), 0.2);
  float toSubject = clamp(dot(uSubject.xz - xz, ahead), 0.03, 9.0);
  vec4 near = subjectAt(surface + r * (toSubject / run));
  vec3 far = fromTarget(texture(uFarMirrorTex, mirrorUv(surface + r * (uMirror.z / run)))).rgb;
  vec3 reflection = far * (1.0 - near.a) + near.rgb;

  // ---- 4. mirror against the water's own colour
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = uMirror.x + (1.0 - uMirror.x) * pow(1.0 - ndv, uMirror.y);
  float sun = sunReach(surface);
  float open = hullLight(surface);
  // under water the light spreads: the swan's shadow dims the glow below it, it does not cut it out
  vec3 body = uWaterShade + uWaterSun * (sun * (0.45 + 0.55 * open));
  // Looking along the surface less of that glow reaches the eye than the
  // mirror's share alone accounts for (measured: the film's water is 2.5
  // times brighter at the bottom of the picture, seen from 22 degrees, than
  // behind the swan, seen from 8).
  body *= pow(clamp(v.y / 0.37, 0.05, 1.25), uMirror.w);
  vec3 col = body * (1.0 - fresnel) + reflection * uMirrorTint * fresnel;

  // ---- 5. the sun
  // The slope a patch of water needs to throw the sun at this eye: the one
  // whose normal lies halfway between the two directions.
  vec3 halfway = normalize(v + uSunDir);
  vec2 wanted = -halfway.xz / max(halfway.y, 0.05);
  vec2 miss = wanted - slope;
  // Roughness below what the pixels show: a little always (and the sun is not
  // a point), the ripple trains too fine to draw here, and the chop: what the
  // field calls agitation, plus what rides on steep simulated waves. Chop is
  // not spread evenly. Some of it sits on the faces of the fine ripples that
  // look away from the swan, and churned water is mottled besides, in patches
  // a few centimetres across that come and go: from this low they are rows of
  // short level dashes, never a smooth patch or a clean ring.
  float face = clamp(0.6 + 0.34 * dot(fine, away), 0.12, 1.45);
  float stirred = agitation + length(field.yz) * uGlint.z;
  if (stirred > 0.02) {
    float mottle = valueNoise(vec3(xz * 24.0, uChopTime));
    face = mix(face, 0.2 + 1.6 * mottle, 0.6);
  }
  // (a fresh splash is rough nearly all over: the dashes come as it dies down)
  face = mix(face, 1.0, 0.7 * smoothstep(0.4, 0.75, agitation));
  float chop = stirred * face;
  float rough2 = uGlint.y * uGlint.y + lost * fineSize * fineSize + chop * chop;
  // The share of the pixel tilted just so: a bell over the miss, as wide as
  // the roughness. Smooth water would make it a needle thousands high, the
  // sun's bare disc; here the sun comes through leaves and haze, which is put
  // in as a floor under the bell's width where its height is worked out.
  float share = exp(-dot(miss, miss) / (2.0 * rough2)) / (6.2832 * max(rough2, uRipple.z * uRipple.z));
  float vh = clamp(dot(v, halfway), 0.0, 1.0);
  float mirrorAtHalfway = uMirror.x + (1.0 - uMirror.x) * pow(1.0 - vh, 5.0);
  float hy2 = halfway.y * halfway.y;
  vec3 glint = uSunColor * (uGlint.x * 3.1416 * mirrorAtHalfway * share / (4.0 * max(v.y, 0.03) * hy2 * hy2));
  col += min(glint, vec3(uGlint.w)) * (sun * open);

  // fade out over the last two metres before the shore, where the bank takes over
  // (a falling ramp is written as one minus a rising one: smoothstep with its edges the wrong way round is undefined in GLSL ES)
  float alpha = 1.0 - smoothstep(-2.0, 0.0, shoreDistance(xz));
  outColor = toTarget(vec4(col, alpha));
}
`;

/**
 * @param {object} ctx the shared context (see World.js)
 * @param {{ mirror: import('../../engine/PlanarMirror.js').PlanarMirror, farMirror: import('../../engine/FarLayer.js').FarLayer }} sources
 *   `mirror.uniforms` gives uMirrorTex (the subject, premultiplied, with
 *   alpha) and uMirrorMatrix; `farMirror.texture` is the defocused reflection
 *   of the surroundings, to be looked up with the same matrix.
 * @returns {{ mesh: THREE.Mesh, update: (dt: number, time: number, camera: THREE.Camera) => void, dispose: () => void }}
 */
export function createWater(ctx, { mirror, farMirror }) {
  const surface = pondSurface(ctx);
  const detail = ctx.quality.waterDetail ?? 1;
  const trains = TRAINS.filter((t) => t.detail <= detail);
  const rates = trains.map((t) => phaseRate(t.length));
  // every train starts somewhere else in its cycle
  const rng = ctx.rng.fork('water');
  const starts = trains.map(() => rng.range(0, TAU));
  const warpStarts = WARP.map(() => rng.range(0, TAU));

  const radius = ctx.pond.SHORE_MAX_RADIUS + 1;
  const geometry = new THREE.CircleGeometry(radius, 96);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    ...ctx.light.uniforms,
    ...ctx.ripple.uniforms,
    ...mirror.uniforms,
    ...surface.uniforms,
    uFarMirrorTex: { value: farMirror.texture },
    uSubject: { value: new THREE.Vector3() },
    uWaterShade: { value: new THREE.Vector3() },
    uWaterSun: { value: new THREE.Vector3() },
    uMirrorTint: { value: new THREE.Vector3(1, 1, 1) },
    uMirror: { value: new THREE.Vector4(0.02, 2.6, 14, 0) },
    uRipple: { value: new THREE.Vector4(0.008, 0.07, 0, 0) },
    uGlint: { value: new THREE.Vector4(3, 0.02, 1.5, 30) },
    uWarpPhase: { value: new THREE.Vector3() },
    uChopTime: { value: 0 },
    uTrainPhase: { value: trains.map(() => 0) },
  };
  const material = ctx.createMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment(ctx, surface, trains, detail >= 2 ? 2 : 1),
    uniforms,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  // after the swan (so its underwater part is covered), before everything that glows on top
  mesh.renderOrder = 10;

  return {
    mesh,
    update(dt, time) {
      const look = ctx.look;
      surface.update(dt, time);
      uniforms.uSubject.value.copy(ctx.subject);
      uniforms.uWaterShade.value.fromArray(look.waterColor);
      uniforms.uWaterSun.value.fromArray(look.waterSunColor ?? [0.012, 0.016, 0.012]);
      uniforms.uMirrorTint.value.fromArray(look.mirrorTint ?? [0.93, 1.0, 0.79]);
      uniforms.uMirror.value.set(look.mirrorBase ?? 0.02, look.mirrorRise ?? 2.6, look.mirrorFarDistance ?? 14, look.waterLowAngle ?? 0.4);
      uniforms.uRipple.value.set(look.ambientRipple, look.agitatedRipple ?? 0.07, look.glintSun ?? 0.2, 0);
      uniforms.uGlint.value.set(look.glintStrength ?? 14, look.glintCalm ?? 0.008, look.glintSteep ?? 2.5, look.glintMax ?? 40);
      uniforms.uChopTime.value = (time * 6) % 4096;
      // Phases are wrapped here, in double precision, and not in the shader:
      // after an hour "rate * time" would have lost its fraction in 32 bits.
      for (let i = 0; i < trains.length; i++) uniforms.uTrainPhase.value[i] = (rates[i] * time + starts[i]) % TAU;
      uniforms.uWarpPhase.value.set(
        (WARP[0].rate * time + warpStarts[0]) % TAU,
        (WARP[1].rate * time + warpStarts[1]) % TAU,
        (WARP[2].rate * time + warpStarts[2]) % TAU,
      );
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
