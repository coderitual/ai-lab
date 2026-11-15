// A stylised rider, built from primitives and posed procedurally every frame:
// hands stay on the grips and feet in the footwells (two-bone IK) while the
// hips and torso lean, tuck and stand up with the ride.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { merge, part, solveJoint } from './geo.js';
import { withSkyFog } from './sky.js';
import { CRAFT } from './watercraft.js';
import { makeNumberTexture } from './textures.js';

const TORSO = 0.5;
const UPPER_ARM = 0.31;
const FORE_ARM = 0.3;
const THIGH = 0.46;
const SHIN = 0.46;
const UP = new THREE.Vector3(0, 1, 0);

/** Limb along +Y from the root joint (y = 0) to the end joint (y = length). */
function limbGeometry(length, r0, r1, color, extras = []) {
  const parts = [part(new THREE.CylinderGeometry(r1, r0, length, 8), color, { pos: [0, length / 2, 0] })];
  parts.push(part(new THREE.SphereGeometry(r0 * 1.12, 8, 6), color));
  for (const e of extras) parts.push(e);
  return merge(parts);
}

function placeLimb(mesh, from, to, tmp) {
  tmp.subVectors(to, from).normalize();
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, tmp);
}

export function createRider(team, number = 1) {
  const group = new THREE.Group();
  group.name = `rider-${team.name}`;

  const suit = new THREE.Color(team.suit);
  const vest = new THREE.Color(team.vest);
  const helmet = new THREE.Color(team.helmet);
  const visor = new THREE.Color(team.visor);
  const dark = new THREE.Color('#15171c');

  const cloth = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  const gloss = withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, envMapIntensity: 1.2 }));

  // ---- torso (local +Y runs from the hips to the base of the neck)
  const torso = new THREE.Mesh(
    merge([
      part(new THREE.SphereGeometry(0.16, 12, 8), suit, { pos: [0, 0.02, 0], scale: [1.15, 0.85, 1.0] }),
      part(new THREE.CapsuleGeometry(0.16, 0.22, 4, 12), suit, { pos: [0, 0.25, 0], scale: [1.25, 1, 0.9] }),
      part(new RoundedBoxGeometry(0.46, 0.34, 0.34, 3, 0.11), vest, { pos: [0, 0.31, 0.0] }),
      part(new RoundedBoxGeometry(0.26, 0.2, 0.02, 2, 0.008), '#fbfaf5', { pos: [0, 0.32, -0.171] }), // back panel
      part(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), suit, { pos: [0, TORSO + 0.02, 0] }),
    ]),
    cloth,
  );
  group.add(torso);

  // race number on the back of the vest, where the chase camera sees it
  const bibMat = withSkyFog(new THREE.MeshStandardMaterial({ map: makeNumberTexture(number, team.suit), roughness: 0.7 }));
  const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.2), bibMat);
  bib.position.set(0, 0.32, -0.184);
  bib.rotation.y = Math.PI;
  torso.add(bib);

  // ---- head
  const head = new THREE.Mesh(
    merge([
      part(new THREE.SphereGeometry(0.165, 16, 12), helmet, { scale: [0.94, 1.0, 1.07] }),
      part(new THREE.SphereGeometry(0.09, 10, 8), helmet, { pos: [0, -0.075, 0.11], scale: [1.25, 0.8, 1] }),
      part(new RoundedBoxGeometry(0.21, 0.022, 0.15, 2, 0.01), helmet, { pos: [0, 0.105, 0.155], rot: [0.28, 0, 0] }),
      part(new THREE.SphereGeometry(0.172, 14, 6, Math.PI / 2 - 1.0, 2.0, 1.02, 0.62), visor, { scale: [0.94, 1.0, 1.07] }),
    ]),
    gloss,
  );
  torso.add(head);
  head.position.set(0, TORSO + 0.17, 0.03);

  // ---- limbs
  const hand = part(new THREE.SphereGeometry(0.068, 8, 6), dark, { pos: [0, FORE_ARM, 0], scale: [1, 1.15, 1.2] });
  const makeArm = () => ({
    upper: new THREE.Mesh(limbGeometry(UPPER_ARM, 0.076, 0.062, suit), cloth),
    fore: new THREE.Mesh(limbGeometry(FORE_ARM, 0.062, 0.05, suit, [hand.clone()]), cloth),
  });
  const makeLeg = () => ({
    upper: new THREE.Mesh(limbGeometry(THIGH, 0.112, 0.088, suit), cloth),
    lower: new THREE.Mesh(limbGeometry(SHIN, 0.088, 0.066, suit), cloth),
  });
  const arms = { L: makeArm(), R: makeArm() };
  const legs = { L: makeLeg(), R: makeLeg() };
  for (const s of ['L', 'R']) group.add(arms[s].upper, arms[s].fore, legs[s].upper, legs[s].lower);
  hand.dispose();

  const footX = 0.36;
  const footZ = -0.3;
  const ankleY = CRAFT.footY + 0.03;
  const boots = new THREE.Mesh(
    merge([1, -1].map((sx) => part(new RoundedBoxGeometry(0.115, 0.11, 0.29, 2, 0.04), dark, { pos: [sx * footX, CRAFT.footY, footZ + 0.07] }))),
    cloth,
  );
  group.add(boots);

  // ---- posing
  const v = {
    hip: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    side: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    neck: new THREE.Vector3(),
    shoulder: new THREE.Vector3(),
    handPos: new THREE.Vector3(),
    elbow: new THREE.Vector3(),
    hipJoint: new THREE.Vector3(),
    ankle: new THREE.Vector3(),
    knee: new THREE.Vector3(),
    hint: new THREE.Vector3(),
    tmp: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
  };

  /**
   * @param {object} p
   * @param {number} p.lean   -1..1, positive leans to starboard (the craft's right)
   * @param {number} p.steer  -1..1, positive steers right
   * @param {number} p.stand  0..1, rising off the saddle (jumps, rough water)
   * @param {number} p.tuck   0..1, extra forward lean
   */
  function pose({ lean = 0, steer = 0, stand = 0, tuck = 0 } = {}) {
    const roll = lean * 0.36;
    const pitch = 0.5 + tuck * 0.16 + stand * 0.1;

    v.hip.set(-lean * 0.11, 0.79 + stand * 0.24, -0.47 + stand * 0.08);
    v.axis.set(-Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch), Math.sin(pitch));
    v.side.set(Math.cos(roll), Math.sin(roll), 0);
    v.fwd.crossVectors(v.side, v.axis).normalize();
    v.side.crossVectors(v.axis, v.fwd).normalize();
    v.basis.makeBasis(v.side, v.axis, v.fwd);
    torso.position.copy(v.hip);
    torso.quaternion.setFromRotationMatrix(v.basis);
    v.neck.copy(v.hip).addScaledVector(v.axis, TORSO);

    // keep the eyes up and looking into the corner
    head.rotation.set(-pitch * 0.82, -steer * 0.38 - lean * 0.12, -roll * 0.55, 'YXZ');

    const barAngle = -steer * 0.5;
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      // arm
      v.shoulder.copy(v.neck).addScaledVector(v.axis, -0.075).addScaledVector(v.side, sx * 0.215);
      v.handPos.set(sx * CRAFT.gripX * Math.cos(barAngle), 0.012, -sx * CRAFT.gripX * Math.sin(barAngle)).add(CRAFT.barPivot);
      v.hint.set(sx * 0.75, -1, -0.25);
      solveJoint(v.shoulder, v.handPos, UPPER_ARM, FORE_ARM, v.hint, v.elbow);
      placeLimb(arms[s].upper, v.shoulder, v.elbow, v.tmp);
      placeLimb(arms[s].fore, v.elbow, v.handPos, v.tmp);
      // leg
      v.hipJoint.copy(v.hip).addScaledVector(v.side, sx * 0.115);
      v.ankle.set(sx * footX, ankleY, footZ);
      v.hint.set(sx * 0.55, 0.55, 1);
      solveJoint(v.hipJoint, v.ankle, THIGH, SHIN, v.hint, v.knee);
      placeLimb(legs[s].upper, v.hipJoint, v.knee, v.tmp);
      placeLimb(legs[s].lower, v.knee, v.ankle, v.tmp);
    }
  }

  pose();
  group.userData.pose = pose;
  group.userData.materials = [cloth, gloss, bibMat];
  return group;
}
