// The swan: three meshes (the body with its few feather shapes, the neck
// with head and bill, the fringe of down along the neck) that share one way
// of taking the light, and a pose that is applied without rebuilding
// anything.
//
//   anatomy.js   every dimension, measured from the film
//   poses.js     the pose's fields, the film's seven neck shapes, the solver
//   body.js      the body mesh (wings arched and relaxed)
//   neck.js      the neck, head and bill, and the fringe
//   feathers.js  the feathers that show as shapes
//   material.js  the shaders
//
// Coordinates of `group` ("bird space"): the origin is on the water plane
// under the middle of the body, +Z is the way the swan faces, +Y is up, +X
// is the bird's left. Metres.
//
// Why the neck is posed in the vertex shader and not rebuilt in JavaScript:
// a pose is 49 rings, each a position and an orientation, worked out by the
// solver in a few microseconds. The skin, the head and the fringe (several
// thousand vertices on the highest tier) all just name the ring they ride
// on, so the same 600 numbers pose all of them, in the main picture and in
// the mirror alike, and no vertex buffer is ever written after start.

import * as THREE from 'three';
import { L, U_ORIGIN, BOW_DROP, BODY_STRETCH, TAIL_SWING, TAIL_PIVOT, NECK_LENGTH, NECK_SUNK, NECK_CORE, PROXY_TAIL, BILL_START, bowShape, neckRadius, proxyShapes } from './anatomy.js';
import { NECK_RINGS, POSES, createPose, copyPose, blendPose, mixPoses, createNeckSolution, solveNeck, measurePose, ringArc } from './poses.js';
import { buildBody } from './body.js';
import { buildNeck, buildFringe } from './neck.js';
import { BODY_VERTEX, NECK_VERTEX, FRINGE_VERTEX, feather, N_ELLIPSOIDS, N_SEGMENTS } from './material.js';

export { POSES, createPose, copyPose, blendPose, mixPoses, measurePose };

/**
 * What each feather-detail level (ctx.quality.counts.featherDetail) builds.
 * Triangles: about 9,000 / 18,000 / 38,000.
 */
const DETAIL = [
  { stations: 44, section: 0.75, sides: 16, perRing: 1, strips: 16, fringePerRing: 1 },
  { stations: 64, section: 1, sides: 20, perRing: 1, strips: 24, fringePerRing: 2 },
  { stations: 112, section: 1.5, sides: 28, perRing: 2, strips: 36, fringePerRing: 2 },
];

/** Teeth of the fringe: one every 2.2 % of L (the film shows bumps every 2 to 3 %). */
const TOOTH_SPACING = 0.022;

const _quat = new THREE.Quaternion();

/**
 * @typedef {object} Swan
 * @property {THREE.Group} group origin on the water under the middle of the body, +Z forward, +Y up
 * @property {THREE.Vector3} billTip world position of the tip of the bill; valid after update()
 * @property {THREE.Vector3} headPosition world position of the middle of the head; valid after update()
 * @property {{ length: number, width: number }} footprint the ellipse where the body cuts the water, metres
 * @property {import('./poses.js').SwanPose} pose the numbers the animation writes before update()
 * @property {typeof POSES} poses the film's seven neck shapes (A, B, C, D, E, G, F), read-only
 * @property {typeof blendPose} blendPose blendPose(out, a, b, t)
 * @property {typeof mixPoses} mixPoses mixPoses(out, poses, weights)
 * @property {typeof copyPose} copyPose copyPose(to, from)
 * @property {typeof createPose} createPose a fresh pose object
 * @property {(pose: import('./poses.js').SwanPose) => { billTip: THREE.Vector3, head: THREE.Vector3 }} measure
 *   where a pose would put the bill tip and the head, in world space, without posing the swan
 *   (uses the group's transform as it is now; the two vectors are reused between calls)
 * @property {{ rate: number, depth: number }} breathing the swan breathes by itself: breaths per second and
 *   how deep (1 is 2.5 mm of swell); added to pose.breath
 * @property {(dt: number, time: number) => void} update apply the pose; dt and time are in slowed-down seconds
 * @property {() => void} dispose
 */

/**
 * @param {object} ctx the shared context (see World.js)
 * @returns {Swan}
 */
export function createSwan(ctx) {
  const rng = ctx.rng.fork('swan');
  const detail = DETAIL[Math.min(2, Math.max(0, ctx.quality.counts.featherDetail | 0))];
  const look = ctx.look;
  const group = new THREE.Group();
  group.name = 'swan';

  const solution = createNeckSolution();
  const uniforms = {
    ...ctx.uniforms,
    ...ctx.light.uniforms,
    uSunLocal: { value: new THREE.Vector3(0, 0.3, -1) },
    uEllM: { value: new Float32Array(9 * N_ELLIPSOIDS) },
    uEllC: { value: new Float32Array(4 * N_ELLIPSOIDS) },
    uEllPlane: { value: new Float32Array(4 * N_ELLIPSOIDS) },
    uSeg: { value: new Float32Array(4 * (N_SEGMENTS + 1)) },
    uSegDensity: { value: 2 },
    // the solver's own arrays: posing the neck is writing these
    uRingPos: { value: solution.positions },
    uRingRot: { value: solution.frames },
    uRingBend: { value: solution.bends },
    uBody: { value: new THREE.Vector4(1, 0, 1, 0) },
    uTailSwing: { value: new THREE.Vector3(TAIL_PIVOT[1] * L, (U_ORIGIN - TAIL_PIVOT[0]) * L, 0) },
    uFringe: { value: new THREE.Vector4(0.0036, 2.2, 0, 0) },
    uAbsorb: { value: new THREE.Vector3(20, 30, 48) },
    uFeather: { value: new THREE.Vector4(0.45, 0.35, 0.22, 0.2) },
    uSky: { value: new THREE.Vector4(0.1, 0.45, 1, 0) },
    uNeckSky: { value: new THREE.Vector2(0.3, 0.05) },
    uAlbedo: { value: new THREE.Vector3(0.93, 0.92, 0.9) },
    uStain: { value: new THREE.Vector3(0.92, 0.86, 0.72) },
    uBillColor: { value: new THREE.Vector3(0.8, 0.24, 0.035) },
  };

  const fragment = feather(ctx.light);
  const bodyMaterial = ctx.createMaterial({ vertexShader: BODY_VERTEX, fragmentShader: fragment, uniforms });
  const neckMaterial = ctx.createMaterial({ vertexShader: NECK_VERTEX, fragmentShader: fragment, uniforms });
  // The fringe is cut out of its strips by alpha. Where the target is
  // multisampled, alpha-to-coverage turns the soft edge of each tooth into
  // partly covered pixels (smooth, sorted by the depth buffer, no blending);
  // elsewhere the edge is simply cut, and the picture's edge smoothing has
  // to do.
  const msaa = ctx.quality.msaa > 0;
  const fringeMaterial = ctx.createMaterial({
    vertexShader: FRINGE_VERTEX,
    fragmentShader: fragment,
    uniforms,
    defines: { FRINGE: 1, TOOTH: TOOTH_SPACING.toFixed(4) },
    side: THREE.DoubleSide,
    alphaToCoverage: msaa,
  });
  fringeMaterial.alphaTest = 0; // the shader discards what is all but transparent itself

  const body = new THREE.Mesh(buildBody({ stations: detail.stations, detail: detail.section, seed: rng.int(1 << 30), rng, featherDetail: ctx.quality.counts.featherDetail | 0 }), bodyMaterial);
  body.name = 'swan-body';
  const neck = new THREE.Mesh(buildNeck({ sides: detail.sides, perRing: detail.perRing }), neckMaterial);
  neck.name = 'swan-neck';
  const fringe = new THREE.Mesh(buildFringe({ strips: detail.strips, perRing: detail.fringePerRing, rng: rng.fork('fringe') }), fringeMaterial);
  fringe.name = 'swan-fringe';
  // the shaders move the vertices: three.js cannot know where they end up
  for (const mesh of [body, neck, fringe]) mesh.frustumCulled = false;
  group.add(body, neck, fringe);

  // The sun in the bird's own space. Worked out when a mesh is about to be
  // drawn, not in update(), so that a sun moved after the step (or a swan
  // turned after it) is right in the very next picture.
  const sunLocal = uniforms.uSunLocal.value;
  body.onBeforeRender = neck.onBeforeRender = fringe.onBeforeRender = () => {
    group.getWorldQuaternion(_quat).invert();
    sunLocal.copy(ctx.light.uniforms.uSunDir.value).applyQuaternion(_quat);
  };

  ctx.showInMirror(group);

  const pose = copyPose(createPose(), POSES.A);
  const measured = { billTip: new THREE.Vector3(), head: new THREE.Vector3() };

  /** Put the stand-in shapes (anatomy.js, proxyShapes) where the pose has the body, as the shader wants them. */
  function writeProxies() {
    const shapes = proxyShapes(pose.wingLift);
    const stretch = 1 + BODY_STRETCH * pose.bodyStretch;
    const M = uniforms.uEllM.value;
    const C = uniforms.uEllC.value;
    const P = uniforms.uEllPlane.value;
    for (let i = 0; i < N_ELLIPSOIDS; i++) {
      const s = shapes[i];
      let tilt = s.tilt;
      let y = (s.centre[1] - BOW_DROP * pose.bow * bowShape(s.centre[0])) * L;
      let z = (U_ORIGIN - s.centre[0]) * L;
      if (i === PROXY_TAIL) {
        // swing with the tail, about the same hinge as the mesh
        const a = TAIL_SWING * pose.tail;
        const hy = TAIL_PIVOT[1] * L;
        const hz = (U_ORIGIN - TAIL_PIVOT[0]) * L;
        const ry = y - hy;
        const rz = z - hz;
        y = hy + ry * Math.cos(a) - rz * Math.sin(a);
        z = hz + ry * Math.sin(a) + rz * Math.cos(a);
        tilt += a;
      }
      z *= stretch;
      const ra = s.radii[0] * L * stretch;
      const rb = s.radii[1] * L;
      const rc = s.radii[2] * L;
      const sn = Math.sin(tilt);
      const cs = Math.cos(tilt);
      // rows: the long axis (0, sin, -cos), the short upright one (0, cos, sin), across (1, 0, 0); column-major for GLSL
      M.set([0, 0, 1 / rc, sn / ra, cs / rb, 0, -cs / ra, sn / rb, 0], i * 9);
      C.set([s.centre[2] * L, y, z, s.density], i * 4);
      if (s.plane) {
        const w = s.plane.width;
        P.set([0, -s.plane.m / (L * w), -1 / (L * stretch * w), (U_ORIGIN - s.plane.u0) / w], i * 4);
      } else {
        P.set([0, 0, 0, 1], i * 4);
      }
    }
    // the neck and head: every sixth ring, then the base of the bill
    const seg = uniforms.uSeg.value;
    const step = (NECK_RINGS - 1) / (N_SEGMENTS - 1);
    for (let i = 0; i < N_SEGMENTS; i++) {
      const ring = Math.round(i * step);
      const o = ring * 4;
      const s = (ringArc(ring) * (NECK_LENGTH + NECK_SUNK) - NECK_SUNK) / NECK_LENGTH;
      seg.set([solution.positions[o], solution.positions[o + 1], solution.positions[o + 2], neckRadius(s) * L * NECK_CORE * solution.positions[o + 3]], i * 4);
    }
    const last = (NECK_RINGS - 1) * 4;
    const reach = BILL_START * L;
    const q = solution.frames;
    // the head's long axis is the last ring's z axis
    const ax = 2 * (q[last] * q[last + 2] + q[last + 3] * q[last + 1]);
    const ay = 2 * (q[last + 1] * q[last + 2] - q[last + 3] * q[last]);
    const az = 1 - 2 * (q[last] * q[last] + q[last + 1] * q[last + 1]);
    seg.set([solution.positions[last] + ax * reach, solution.positions[last + 1] + ay * reach, solution.positions[last + 2] + az * reach, 0.065 * L], N_SEGMENTS * 4);
  }

  /** Copy the tunables (LOOK.swan*) into the uniforms. Cheap; done every step so that they are live. */
  function applyLook() {
    const a = look.swanAbsorb;
    uniforms.uAbsorb.value.set(a[0], a[1], a[2]).divideScalar(look.swanFreePath);
    uniforms.uFeather.value.set(look.swanThrough, look.swanWrap, look.swanSkyAtWater, look.swanSkyHeight);
    uniforms.uSky.value.set(look.swanSkyTilt[0], look.swanSkyTilt[1], look.swanSkyTilt[2], look.swanSkyTilt[3]);
    uniforms.uAlbedo.value.fromArray(look.swanAlbedo);
    uniforms.uStain.value.fromArray(look.swanStain);
    uniforms.uBillColor.value.fromArray(look.swanBill);
    uniforms.uSegDensity.value = look.swanNeckDensity;
    uniforms.uNeckSky.value.set(look.swanNeckSky, look.swanNeckThrough);
    uniforms.uFringe.value.set(look.swanFringe, look.swanFringeBend, 0, 0);
  }

  const swan = {
    group,
    billTip: new THREE.Vector3(),
    headPosition: new THREE.Vector3(),
    footprint: { length: 1.02 * L, width: 0.64 * L },
    pose,
    poses: POSES,
    blendPose,
    mixPoses,
    copyPose,
    createPose,
    breathing: { rate: 0.28, depth: 1 },
    measure(p) {
      const m = measurePose(p);
      group.updateMatrixWorld(true);
      measured.billTip.fromArray(m.billTip).applyMatrix4(group.matrixWorld);
      measured.head.fromArray(m.head).applyMatrix4(group.matrixWorld);
      return measured;
    },
    update(dt, time) {
      applyLook();
      solveNeck(pose, solution);
      writeProxies();
      const breath = pose.breath + swan.breathing.depth * Math.sin(time * swan.breathing.rate * Math.PI * 2);
      uniforms.uBody.value.set(pose.wingLift, BOW_DROP * L * pose.bow, 1 + BODY_STRETCH * pose.bodyStretch, breath * 0.0025);
      uniforms.uTailSwing.value.z = TAIL_SWING * pose.tail;
      group.updateMatrixWorld(true);
      swan.billTip.fromArray(solution.billTip).applyMatrix4(group.matrixWorld);
      swan.headPosition.fromArray(solution.head).applyMatrix4(group.matrixWorld);
    },
    dispose() {
      body.geometry.dispose();
      neck.geometry.dispose();
      fringe.geometry.dispose();
      bodyMaterial.dispose();
      neckMaterial.dispose();
      fringeMaterial.dispose();
    },
  };
  swan.update(0, 0);
  return swan;
}
