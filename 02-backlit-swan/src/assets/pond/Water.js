// The surface of the pond. PLACEHOLDER: flat geometry and a compact shader
// that already does the essential thing, mirroring the scene with the ripples
// bending the mirror. The real water (finer ambient ripples, glints, depth
// tint, the meadow's glow on the far water) replaces the contents of this file
// and keeps what createWater() returns.
//
// How a pixel of water gets its colour here:
//   1. the surface normal comes from the ripple field's slopes plus a little
//      ever-present ripple made of moving noise;
//   2. the eye ray is reflected about that normal, and the reflected ray is
//      followed for some distance to a point in the world;
//   3. that point is looked up in the mirror pictures (see PlanarMirror.js:
//      the mirror camera sees the real world, so any world point can be
//      projected into its picture). For a flat normal this is exactly the
//      mirror image; a tilted normal lands somewhere else, and the further
//      away the reflected thing is, the further it lands. That is why a
//      reflection is crisp where the swan meets the water and breaks up
//      toward the reflection of its head.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (ctx) => /* glsl */ `
${ctx.light.glsl}
${ctx.ripple.glsl}
${ctx.pond.glsl}
uniform float uTime;
uniform sampler2D uMirrorTex;     // the subject, with alpha
uniform sampler2D uFarMirrorTex;  // the surroundings, defocused
uniform mat4 uMirrorMatrix;
uniform vec3 uWaterColor;
uniform float uAmbientRipple;
uniform vec3 uSubject;            // where the reflected subject stands (world)
in vec3 vWorldPos;

// Slopes of the small ripples that are always there: two layers of noise
// sliding across each other, differentiated by hand.
vec2 ambientSlope(vec2 xz) {
  vec2 p = xz * 5.0 + vec2(uTime * 0.11, uTime * 0.07);
  vec2 q = xz * 11.0 - vec2(uTime * 0.09, -uTime * 0.13);
  float e = 0.05;
  float a = valueNoise(p), b = valueNoise(q);
  vec2 da = vec2(valueNoise(p + vec2(e, 0.0)) - a, valueNoise(p + vec2(0.0, e)) - a);
  vec2 db = vec2(valueNoise(q + vec2(e, 0.0)) - b, valueNoise(q + vec2(0.0, e)) - b);
  return (da + db * 0.6) / e;
}

vec2 mirrorUv(vec3 world) {
  vec4 c = uMirrorMatrix * vec4(world, 1.0);
  return c.xy / c.w;
}

void main() {
  vec2 xz = vWorldPos.xz;
  vec3 toEye = cameraPosition - vWorldPos;
  float eyeDist = length(toEye);
  vec3 v = toEye / eyeDist;

  vec3 rip = rippleSample(xz);
  // far away the small ripples are finer than a pixel and would only sparkle: fade them out
  vec2 slope = rip.yz + ambientSlope(xz) * uAmbientRipple / (1.0 + eyeDist * 0.03);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec3 r = reflect(-v, n);
  // a reflected ray that dives under the surface would see nothing; keep it just above
  r.y = max(r.y, 0.02);
  r = normalize(r);

  // How far along the reflected ray the reflected thing is. For the subject:
  // the horizontal distance from here to where it stands, measured along the
  // line of sight. For the surroundings: far.
  vec2 ahead = normalize(-v.xz);
  float toSubject = clamp(dot(uSubject.xz - xz, ahead), 0.05, 6.0);
  vec3 surface = vec3(xz.x, 0.0, xz.y);
  vec4 near = fromTarget(texture(uMirrorTex, mirrorUv(surface + r * toSubject)));
  vec3 far = fromTarget(texture(uFarMirrorTex, mirrorUv(surface + r * 25.0))).rgb;
  vec3 reflection = far * (1.0 - near.a) + near.rgb; // the mirror picture is premultiplied

  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 col = mix(uWaterColor, reflection, fresnel);

  // the sun itself, glancing off a ripple that happens to face the right way
  // (kept faint: in this wood the sun reaches the water only in patches, and
  // the placeholder does not know where)
  float glint = pow(max(dot(r, uSunDir), 0.0), 900.0);
  col += uSunColor * glint * 0.3;

  // fade out over the last two metres before the shore, where the bank takes over
  float alpha = smoothstep(0.0, -2.0, shoreDistance(xz));
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
  const radius = ctx.pond.SHORE_MAX_RADIUS + 1;
  const geometry = new THREE.CircleGeometry(radius, 96);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    ...ctx.uniforms,
    ...ctx.light.uniforms,
    ...ctx.ripple.uniforms,
    ...mirror.uniforms,
    uFarMirrorTex: { value: farMirror.texture },
    uWaterColor: { value: new THREE.Vector3() },
    uAmbientRipple: { value: 0.012 },
    uSubject: { value: new THREE.Vector3() },
  };
  const material = ctx.createMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment(ctx),
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
    update() {
      uniforms.uWaterColor.value.fromArray(ctx.look.waterColor);
      uniforms.uAmbientRipple.value = ctx.look.ambientRipple;
      // the scene says where its subject is; the placeholder needs nothing else per frame
      uniforms.uSubject.value.copy(ctx.subject);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
