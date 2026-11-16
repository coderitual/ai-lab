// The dust on the water: thousands of tiny bright specks (pollen, seeds, down)
// lying on the surface and catching the low sun. PLACEHOLDER: plain additive
// points that ride the ripple field and twinkle. The real version replaces the
// contents of this file and keeps what createSpecks() returns.

import * as THREE from 'three';

const vertex = (ctx) => /* glsl */ `
${ctx.ripple.glsl}
uniform float uTime;
uniform vec2 uResolution;
in vec4 aSeed; // size (metres), brightness, twinkle phase, twinkle speed
out float vGlow;
void main() {
  vec3 p = position;
  vec3 rip = rippleSample(p.xz);
  p.y += rip.x;
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;

  // A speck lights up when the ripple under it tilts it toward the sun, and
  // otherwise glimmers slowly on its own.
  float tilt = clamp(1.0 + 30.0 * (rip.y + rip.z), 0.3, 4.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * aSeed.w + aSeed.z);
  vGlow = aSeed.y * tilt * twinkle;

  // size in pixels of the target being drawn; never below a pixel and a half,
  // smaller points flicker in and out as they cross pixel centres
  float px = aSeed.x * uResolution.y * projectionMatrix[1][1] / (2.0 * gl_Position.w);
  vGlow *= min(1.0, px * px / 2.25);
  gl_PointSize = max(px, 1.5);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
in float vGlow;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float soft = 1.0 - d;
  outColor = toTarget(vec4(uColor * vGlow * soft * soft, 1.0));
}
`;

/**
 * @param {object} ctx the shared context (see World.js); uses ctx.quality.counts.specks
 * @returns {{ object: THREE.Points, update: (dt: number, time: number, camera: THREE.Camera) => void, dispose: () => void }}
 */
export function createSpecks(ctx) {
  const rng = ctx.rng.fork('specks');
  const count = ctx.quality.counts.specks;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // more of them near the middle of the pond, where the camera looks
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 8; tries++) {
      const r = 26 * Math.pow(rng.float(), 0.7);
      const a = rng.range(0, Math.PI * 2);
      x = r * Math.sin(a);
      z = -r * Math.cos(a);
      if (ctx.pond.shoreDistance(x, z) < -3) break;
    }
    positions.set([x, 0.003, z], i * 3);
    // a few big bright ones among many faint ones
    const big = rng.float() < 0.04;
    seeds.set([big ? rng.range(0.012, 0.02) : rng.range(0.004, 0.009), big ? rng.range(2, 6) : rng.range(0.3, 1.6), rng.range(0, Math.PI * 2), rng.range(0.3, 1.4)], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);

  const material = ctx.createMaterial({
    vertexShader: vertex(ctx),
    fragmentShader: FRAGMENT,
    uniforms: { ...ctx.uniforms, ...ctx.ripple.uniforms, uColor: { value: new THREE.Vector3(1.0, 0.86, 0.55) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const object = new THREE.Points(geometry, material);
  object.name = 'specks';
  object.renderOrder = 20;

  return {
    object,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
