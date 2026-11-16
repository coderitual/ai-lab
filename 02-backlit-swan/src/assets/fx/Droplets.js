// Water drops in the air: what falls from the bill when the swan lifts its
// head, what flies when it shakes. PLACEHOLDER: points thrown under gravity
// that light up against the sun. The real version (streaks, refraction
// sparkle, strings of drops) replaces the contents of this file and keeps
// what createDroplets() returns.
//
// A drop that reaches the water dents the ripple field there and announces
// itself: ctx.events.emit('drop', { x, z, size }).

import * as THREE from 'three';

const GRAVITY = 9.81;

const VERTEX = /* glsl */ `
uniform vec2 uResolution;
in float aSize; // metres; 0 hides the drop
out float vOn;
out vec3 vWorldPos;
void main() {
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  float px = aSize * uResolution.y * projectionMatrix[1][1] / (2.0 * gl_Position.w);
  vOn = min(1.0, px * px / 2.25);
  gl_PointSize = max(px, 1.5);
  // a point of size zero may still be drawn as one pixel: move unused drops off the screen instead
  if (aSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const fragment = (ctx) => /* glsl */ `
${ctx.light.glsl}
in float vOn;
in vec3 vWorldPos;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  // a drop is a tiny lens: it flares when the sun is behind it
  vec3 v = normalize(cameraPosition - vWorldPos);
  float back = towardSun(v);
  vec3 col = uSunColor * (0.04 + 1.6 * pow(back, 6.0)) + uSkyColor * 0.6;
  outColor = toTarget(vec4(col * (1.0 - d) * vOn, 1.0));
}
`;

/**
 * @param {object} ctx the shared context (see World.js); uses ctx.quality.counts.droplets as the pool size
 * @returns {{
 *   object: THREE.Points,
 *   spawn: (options: { position: THREE.Vector3, velocity?: THREE.Vector3, spread?: number, count?: number, size?: number }) => void,
 *   update: (dt: number, time: number) => void,
 *   dispose: () => void,
 * }}
 *   spawn: `count` drops leave `position` with `velocity` (m/s), each given a
 *   random extra velocity of up to `spread` m/s; `size` is their diameter in metres.
 */
export function createDroplets(ctx) {
  const rng = ctx.rng.fork('droplets');
  const max = ctx.quality.counts.droplets;
  const positions = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const velocities = new Float32Array(max * 3);
  let next = 0;
  let alive = 0;

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aSize', sizeAttribute);

  const material = ctx.createMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment(ctx),
    uniforms: { ...ctx.uniforms, ...ctx.light.uniforms },
    transparent: true,
    depthWrite: false,
    // additive in colour, and leaving alpha alone: in the mirror picture a
    // drop must add its light without claiming to cover what is behind it
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });

  const object = new THREE.Points(geometry, material);
  object.name = 'droplets';
  object.frustumCulled = false; // the points move every frame; a bounding sphere would always be stale
  object.renderOrder = 30;
  object.visible = false;
  ctx.showInMirror(object);

  return {
    object,
    spawn({ position, velocity, spread = 0.3, count = 1, size = 0.008 }) {
      for (let n = 0; n < count; n++) {
        // the pool is a ring: when it is full the oldest drop is reused
        const i = next;
        next = (next + 1) % max;
        if (sizes[i] === 0) alive++;
        positions.set([position.x, position.y, position.z], i * 3);
        velocities.set(
          [(velocity ? velocity.x : 0) + rng.gauss() * spread, (velocity ? velocity.y : 0) + rng.gauss() * spread, (velocity ? velocity.z : 0) + rng.gauss() * spread],
          i * 3,
        );
        sizes[i] = size * rng.range(0.6, 1.4);
      }
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      object.visible = true;
    },
    update(dt) {
      if (alive === 0) {
        object.visible = false;
        return;
      }
      for (let i = 0; i < max; i++) {
        if (sizes[i] === 0) continue;
        const k = i * 3;
        velocities[k + 1] -= GRAVITY * dt;
        positions[k] += velocities[k] * dt;
        positions[k + 1] += velocities[k + 1] * dt;
        positions[k + 2] += velocities[k + 2] * dt;
        if (positions[k + 1] <= 0) {
          const x = positions[k];
          const z = positions[k + 2];
          const size = sizes[i];
          sizes[i] = 0;
          alive--;
          // only on the pond; a drop that somehow reaches the bank just disappears
          if (ctx.pond.shoreDistance(x, z) < 0) {
            ctx.ripple.disturb(x, z, size * 4, size * 0.5);
            ctx.events.emit('drop', { x, z, size });
          }
        }
      }
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
