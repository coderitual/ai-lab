// What the pond's surface needs to know about the body floating on it.
//
// The water shader and the specks both ask the same two questions about the
// swan: "is this bit of water in its shadow?" and "what has it just done to
// the water here?". This file answers both once, from nothing but the point
// the scene calls its subject (ctx.subject): which way the body is heading is
// read off its own movement, so whatever moves that point gets a shadow and a
// wake without having to say so.
//
//   shadow   the body is treated as an ellipsoid sitting in the water; a
//            point is shaded when the line from it toward the sun passes
//            through that ellipsoid. With the sun 32 degrees up the shadow
//            reaches 0.5 m in front of a 0.3 m tall bird: that is why the
//            film has only half as many specks, and no glints, in the first
//            stretch of water below the swan.
//   wake     a gliding swan is slower than the slowest ripple (0.23 m/s), so
//            it leaves no V: only churned water behind the tail and along
//            the hull. That is not a wave the simulation could carry; it is
//            agitation (see RippleField.stir), laid down wherever the hull
//            passes, more of it the faster the bird moves.

import * as THREE from 'three';

/** The ellipsoid that stands in for the swan's body: half length, half width, half height, in metres. */
const HULL = { length: 0.35, width: 0.2, height: 0.29, centreHeight: 0.02 };
/** Below this speed (m/s) the water behind the body stays smooth; at `full` the wake is at its strongest. */
const WAKE = { from: 0.03, full: 0.2, amount: 0.22 };

const cache = new WeakMap();

/**
 * One shared helper per context.
 * @param {object} ctx the shared context (see World.js)
 * @returns {{ uniforms: object, glsl: string, update: (dt: number, time: number) => void, heading: THREE.Vector2, speed: number }}
 *   `glsl` declares `float hullLight(vec3 worldPos)`: 1 where the sun gets
 *   past the body, 0 in the middle of its shadow.
 */
export function pondSurface(ctx) {
  let surface = cache.get(ctx);
  if (surface) return surface;

  const uniforms = {
    // where the ellipsoid's centre is, in the world
    uHullCentre: { value: new THREE.Vector3(0, HULL.centreHeight, 0) },
    // unit vector along the body (x, z), then 1 / half length and 1 / half width
    uHullAxis: { value: new THREE.Vector4(-1, 0, 1 / HULL.length, 1 / HULL.width) },
  };

  const glsl = /* glsl */ `
uniform vec3 uHullCentre;
uniform vec4 uHullAxis;
// The line from a point toward the sun, in a space squeezed so that the body
// is a unit ball: how close does it pass to the centre?
float hullLight(vec3 worldPos) {
  vec3 o = worldPos - uHullCentre;
  vec2 across = vec2(-uHullAxis.y, uHullAxis.x);
  vec3 scale = vec3(uHullAxis.z, ${(1 / HULL.height).toFixed(4)}, uHullAxis.w);
  vec3 p = vec3(dot(o.xz, uHullAxis.xy), o.y, dot(o.xz, across)) * scale;
  vec3 s = vec3(dot(uSunDir.xz, uHullAxis.xy), uSunDir.y, dot(uSunDir.xz, across)) * scale;
  float along = -dot(p, s) / dot(s, s);
  // the body is on the far side of the point from the sun: nothing in the way
  if (along <= 0.0) return 1.0;
  float miss = length(p + s * along);
  // the edge of a shadow this small is never sharp: feathers, and half a degree of sun
  return smoothstep(0.78, 1.12, miss);
}
`;

  const previous = new THREE.Vector3();
  const velocity = new THREE.Vector2();
  const heading = new THREE.Vector2(-1, 0); // the swan starts facing west
  let started = false;
  let stamp = -1;

  surface = {
    uniforms,
    glsl,
    heading,
    speed: 0,
    /**
     * Once per simulation step (it ignores a second call with the same time,
     * so the water and the specks may both call it).
     */
    update(dt, time) {
      if (time === stamp) return;
      stamp = time;
      const s = ctx.subject;
      if (!started) {
        previous.copy(s);
        started = true;
      }
      if (dt > 0) {
        const vx = (s.x - previous.x) / dt;
        const vz = (s.z - previous.z) / dt;
        // a jump (the scene put the swan somewhere else) is not a movement
        const jumped = Math.hypot(vx, vz) > 2.5;
        const blend = jumped ? 1 : 1 - Math.exp(-dt * 6);
        velocity.x += ((jumped ? 0 : vx) - velocity.x) * blend;
        velocity.y += ((jumped ? 0 : vz) - velocity.y) * blend;
        previous.copy(s);
      }
      const speed = velocity.length();
      surface.speed = speed;
      // the heading only follows the movement while there is enough of it to tell
      if (speed > 0.03) {
        const turn = 1 - Math.exp(-dt * 4);
        heading.x += (velocity.x / speed - heading.x) * turn;
        heading.y += (velocity.y / speed - heading.y) * turn;
        heading.normalize();
      }
      uniforms.uHullCentre.value.set(s.x, HULL.centreHeight, s.z);
      uniforms.uHullAxis.value.set(heading.x, heading.y, 1 / HULL.length, 1 / HULL.width);

      // The wake. stir() only ever raises the agitation to the amount given,
      // so calling it every step gives the same water at any frame rate.
      const drive = THREE.MathUtils.smoothstep(speed, WAKE.from, WAKE.full);
      if (drive > 0.02 && dt > 0) {
        const hx = heading.x;
        const hz = heading.y;
        const amount = WAKE.amount * drive;
        // behind the tail, where the two flows round the body meet again: a
        // band about as long as the bird, dying away toward its end
        ctx.ripple.stir(s.x - hx * 0.34, s.z - hz * 0.34, 0.1, amount * 1.15);
        ctx.ripple.stir(s.x - hx * 0.47, s.z - hz * 0.47, 0.12, amount * 0.88);
        ctx.ripple.stir(s.x - hx * 0.61, s.z - hz * 0.61, 0.13, amount * 0.7);
        // along both flanks, where the hull cuts the surface
        for (const side of [-1, 1]) {
          const px = -hz * side * (HULL.width + 0.02);
          const pz = hx * side * (HULL.width + 0.02);
          ctx.ripple.stir(s.x + hx * 0.12 + px, s.z + hz * 0.12 + pz, 0.06, amount * 0.75);
          ctx.ripple.stir(s.x - hx * 0.12 + px, s.z - hz * 0.12 + pz, 0.07, amount * 0.75);
        }
      }
    },
  };
  cache.set(ctx, surface);
  return surface;
}
