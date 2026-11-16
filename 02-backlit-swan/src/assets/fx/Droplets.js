// Water drops in the air: what falls from the bill when the swan lifts its
// head, what flies when it shakes.
//
// In the film they are round neutral-white dots about 0.8 % of the swan's
// length across, on clean parabolas, with no streak (the shutter was fast).
// So that is all they are here: points thrown under gravity, each a tiny lens
// that is bright wherever the sun reaches it. A drop that reaches the water
// dents the ripple field there (the water turns that into rings and glints),
// throws up two or three specks of splash that hop a few centimetres, and
// announces itself: ctx.events.emit('drop', { x, z, size }).

import * as THREE from 'three';

const GRAVITY = 9.81;
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

const VERTEX = /* glsl */ `
uniform vec2 uResolution;
in float aSize; // metres; 0 hides the drop
out float vOn;
out vec3 vWorldPos;
void main() {
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  float px = aSize * uResolution.y * projectionMatrix[1][1] / (2.0 * gl_Position.w);
  // a drop smaller than the smallest point drawn is dimmed by the area it lacks, but never to nothing:
  // a bead of water against the light shows well below the size at which its shape could
  vOn = clamp(px * px / 4.0, 0.35, 1.0);
  gl_PointSize = max(px, 2.0);
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
  // A drop is a tiny lens: it gathers the sun from behind it and shows it as
  // a point of plain white, brighter the more nearly the eye looks into the
  // light. Out of the sun it has only the sky to show, which is very little.
  vec3 v = normalize(cameraPosition - vWorldPos);
  float back = towardSun(v);
  vec3 col = uSunColor * sunReach(vWorldPos) * (0.4 + 0.7 * back * back) + uSkyColor * 0.05;
  // (a soft-edged disc, so that a drop two pixels wide does not crawl)
  outColor = toTarget(vec4(col * (1.0 - d * d) * vOn, 1.0));
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
  const splash = new Uint8Array(max); // 1: a speck thrown up by a landing; it lands without a splash of its own
  let next = 0;
  let alive = 0;
  const landed = []; // x, z, size of the drops that reached the water this step

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
    spawn({ position, velocity, spread = 0.3, count = 1, size = 0.008, isSplash = false }) {
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
        sizes[i] = size * rng.range(0.75, 1.25);
        splash[i] = isSplash ? 1 : 0;
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
            if (splash[i]) {
              ctx.ripple.disturb(x, z, size * 3, size * 0.2);
            } else {
              ctx.ripple.disturb(x, z, size * 4, size * 0.32);
              ctx.events.emit('drop', { x, z, size });
              // the rebound: a couple of specks hop up and out and are gone in a tenth of a second
              landed.push(x, z, size);
            }
          }
        }
      }
      // (thrown after the loop: spawning reuses slots of the very pool being walked)
      for (let n = 0; n < landed.length; n += 3) {
        const hops = 2 + (rng.float() < 0.4 ? 1 : 0);
        for (let h = 0; h < hops; h++) {
          const a = rng.range(0, Math.PI * 2);
          const out = rng.range(0.08, 0.3);
          this.spawn({
            position: _p.set(landed[n], 0.004, landed[n + 1]),
            velocity: _v.set(Math.cos(a) * out, rng.range(0.45, 0.85), Math.sin(a) * out),
            spread: 0,
            size: landed[n + 2] * 0.5,
            isSplash: true,
          });
        }
      }
      landed.length = 0;
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
