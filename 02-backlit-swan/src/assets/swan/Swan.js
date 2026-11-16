// The swan. PLACEHOLDER: a stand-in with the right size, the right interface
// and a first version of the feather material, so that the mirror, the bloom
// and the grade have something white and backlit to work on. The real bird
// (modelled body, wings, neck with a skeleton, head, feather detail) replaces
// the contents of this file and keeps what createSwan() returns.
//
// Coordinates of `group`: the origin is on the water plane under the middle of
// the body, +Z is the way the swan faces, +Y is up. Metres.

import * as THREE from 'three';

const FEATHER_VERTEX = /* glsl */ `
out vec3 vWorldPos;
out vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  // the model is only ever turned and moved, never squashed, so the model matrix will do for normals
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Feathers lit from behind, first version.
 *
 *   wrap:     sunlight creeping round the form, as it does on anything soft
 *   through:  light that enters the far side and comes out toward the eye;
 *             strongest where the body is thin when seen from the camera
 *             (the edges) and when looking toward the sun
 *   fuzz:     the bright line of lit down standing off the silhouette
 *   fill:     cool sky light on the shadow side, which the grade turns teal
 */
const feather = (light) => /* glsl */ `
${light.glsl}
uniform vec3 uAlbedo;
uniform vec3 uThroughTint;
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float edge = 1.0 - ndv;
  float back = towardSun(v);

  vec3 sun = uSunColor * sunWrap(n, 0.35);
  float thin = edge * edge;
  vec3 through = uSunColor * uThroughTint * back * back * (0.006 + 0.5 * thin) * sunWrap(-n, 0.8);
  float rim = pow(edge, 4.0) * (0.25 + 0.75 * back * back) * sunWrap(n, 0.9);

  vec3 col = uAlbedo * (sun * 0.32 + fillLight(n)) + through + uSunColor * rim * 0.9;
  outColor = toTarget(vec4(col, 1.0));
}
`;

const DARK_FRAGMENT = (light) => /* glsl */ `
${light.glsl}
uniform vec3 uAlbedo;
in vec3 vWorldPos;
in vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 col = uAlbedo * (uSunColor * sunWrap(n, 0.1) * 0.3 + fillLight(n));
  outColor = toTarget(vec4(col, 1.0));
}
`;

/** An egg-like body: a sphere pulled into the proportions of a floating swan. */
function bodyGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // fuller toward the tail, which also lifts into a point
    const tail = Math.max(0, -z);
    const width = 0.21 * (1 + 0.12 * tail - 0.1 * Math.max(0, z));
    const top = 0.3 * (1 - 0.25 * z * z) + 0.1 * tail * tail * tail;
    p.setXYZ(i, x * width, y > 0 ? y * top : y * 0.09, z * 0.41 - 0.02 + 0.05 * tail * tail * (y > 0 ? 1 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A tube along a curve lying in the YZ plane, with a radius that changes along it.
 * @param {THREE.Curve<THREE.Vector3>} curve
 * @param {(t: number) => number} radius
 */
function tubeGeometry(curve, radius, segments = 28, sides = 12) {
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPoint(t, point);
    curve.getTangent(t, tangent);
    up.crossVectors(tangent, side).normalize();
    const r = radius(t);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      positions.push(
        point.x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * r,
        point.y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * r,
        point.z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * r,
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * @typedef {object} Swan
 * @property {THREE.Group} group origin on the water under the middle of the body, +Z forward, +Y up
 * @property {THREE.Vector3} billTip world position of the tip of the bill; valid after update()
 * @property {THREE.Vector3} headPosition world position of the middle of the head; valid after update()
 * @property {{ length: number, width: number }} footprint the ellipse where the body cuts the water, metres
 * @property {object} pose numbers the animation writes before update(); see the fields below
 * @property {(dt: number, time: number) => void} update apply the pose; dt and time are in slowed-down seconds
 * @property {() => void} dispose
 */

/**
 * @param {object} ctx the shared context (see World.js)
 * @returns {Swan}
 */
export function createSwan(ctx) {
  const group = new THREE.Group();
  group.name = 'swan';

  const featherMaterial = ctx.createMaterial({
    vertexShader: FEATHER_VERTEX,
    fragmentShader: feather(ctx.light),
    uniforms: {
      ...ctx.light.uniforms,
      uAlbedo: { value: new THREE.Vector3(0.9, 0.89, 0.86) },
      uThroughTint: { value: new THREE.Vector3(1.0, 0.86, 0.6) },
    },
  });
  const darkMaterial = ctx.createMaterial({
    vertexShader: FEATHER_VERTEX,
    fragmentShader: DARK_FRAGMENT(ctx.light),
    uniforms: { ...ctx.light.uniforms, uAlbedo: { value: new THREE.Vector3(0.25, 0.09, 0.02) } },
  });

  const body = new THREE.Mesh(bodyGeometry(), featherMaterial);
  group.add(body);

  // The neck swings about its base when the swan reaches down; the placeholder
  // moves it as one stiff piece.
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.16, 0.27);
  group.add(neckPivot);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.04, -0.02),
    new THREE.Vector3(0, 0.14, 0.13),
    new THREE.Vector3(0, 0.34, 0.12),
    new THREE.Vector3(0, 0.52, 0.05),
    new THREE.Vector3(0, 0.61, 0.09),
    new THREE.Vector3(0, 0.6, 0.17),
  ]);
  const neck = new THREE.Mesh(tubeGeometry(curve, (t) => 0.062 - 0.03 * Math.min(1, t * 1.4)), featherMaterial);
  neckPivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), featherMaterial);
  head.scale.set(0.036, 0.04, 0.055);
  head.position.set(0, 0.585, 0.2);
  head.rotation.x = 0.45;
  neckPivot.add(head);

  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 8), darkMaterial);
  // a cone points along +Y; lay it forward and a little down
  bill.rotation.x = Math.PI / 2 + 0.45;
  bill.position.set(0, 0.555, 0.265);
  neckPivot.add(bill);

  // where the tip of the bill is, in the neck's own space
  const billTipLocal = new THREE.Vector3(0, 0.537, 0.303);
  const headLocal = head.position.clone();

  ctx.showInMirror(group);

  const swan = {
    group,
    billTip: new THREE.Vector3(),
    headPosition: new THREE.Vector3(),
    footprint: { length: 0.8, width: 0.42 },
    /**
     * dip: 0 neck upright .. 1 bill in the water just ahead of the breast.
     * (Placeholder pose. The real swan will define more: neck curl, head
     * turn, wing lift, tail wag...)
     */
    pose: { dip: 0 },
    update() {
      neckPivot.rotation.x = swan.pose.dip * 1.4;
      group.updateMatrixWorld(true);
      swan.billTip.copy(billTipLocal).applyMatrix4(neckPivot.matrixWorld);
      swan.headPosition.copy(headLocal).applyMatrix4(neckPivot.matrixWorld);
    },
    dispose() {
      body.geometry.dispose();
      neck.geometry.dispose();
      head.geometry.dispose();
      bill.geometry.dispose();
      featherMaterial.dispose();
      darkMaterial.dispose();
    },
  };
  swan.update(0, 0);
  return swan;
}
