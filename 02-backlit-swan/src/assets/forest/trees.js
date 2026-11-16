// Trees as shapes: every trunk and bough of the wood in one mesh.
//
// A tree here is a skeleton of limbs, and a limb is a bent tube that tapers:
// a trunk that flares at the root, wanders a little on its way up and thins
// toward the top; boughs that leave it at an angle and curve toward the light;
// on the trees at the water's edge, a few thin dead branches low down; on some,
// leaves up the trunk on the side of their light. The
// trees on the bank lean out over the pond and carry their boughs low, as
// trees at the edge of a wood do, because that is where their light is.
//
// Nothing here knows where the wood is: Forest.js chooses the places and calls
// growTree for each. What comes back are the places where leaves belong (the
// ends and the outer halves of the boughs, the crown), for foliage.js.

import * as THREE from 'three';

const _tangent = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * The arrays one mesh of limbs is collected in.
 * @returns {{ positions: number[], normals: number[], indices: number[] }}
 */
export function createLimbs() {
  return { positions: [], normals: [], indices: [] };
}

/**
 * Add one limb: a tube through `points`, round, with the radius given at each point.
 * The ends are left open (one is inside the limb it grows from, the other is too thin to see into).
 * @param {{ positions: number[], normals: number[], indices: number[] }} limbs
 * @param {{ x: number, y: number, z: number, r: number }[]} points at least two
 * @param {number} sides how many faces round the tube
 */
function addLimb(limbs, points, sides) {
  const first = limbs.positions.length / 3;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    _tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // Two directions across the limb. Carried from ring to ring (each is the
    // last one straightened against the new direction), so the tube does not
    // twist where it bends.
    if (i === 0) _u.set(1, 0, 0.37);
    _u.addScaledVector(_tangent, -_u.dot(_tangent)).normalize();
    _v.crossVectors(_tangent, _u);
    const p = points[i];
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      _n.copy(_u).multiplyScalar(Math.cos(angle)).addScaledVector(_v, Math.sin(angle));
      limbs.positions.push(p.x + _n.x * p.r, p.y + _n.y * p.r, p.z + _n.z * p.r);
      limbs.normals.push(_n.x, _n.y, _n.z);
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = first + i * sides + s;
      const b = first + i * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      limbs.indices.push(a, b, c, b, d, c);
    }
  }
}

/**
 * Grow one tree into `limbs`.
 *
 * @param {{ positions: number[], normals: number[], indices: number[] }} limbs
 * @param {import('../../engine/rng.js').Rng} rng
 * @param {object} spot
 * @param {number} spot.x
 * @param {number} spot.z
 * @param {number} spot.y height of the ground there
 * @param {number} spot.girth radius of the trunk at chest height, metres
 * @param {number} spot.height
 * @param {'edge' | 'inner' | 'framing'} spot.kind
 *   edge: on the bank, leaning out, boughs from low down; inner: a pole with its crown out of sight;
 *   framing: a big tree with heavy boughs
 * @param {[number, number]} spot.toward unit (x, z): where its light is (the pond; for a framing tree, the clearing)
 * @param {boolean} [spot.bare] no leaves low on its trunk, and no bough on its lower two fifths
 * @param {boolean} [spot.leafy] in leaf from low down: a column of leaves up its trunk, and (inside the wood) boughs from 2.5 m
 * @param {number} [spot.detail] 0..2, the quality tier: fewer faces and boughs when low
 * @returns {{ x: number, y: number, z: number, size: number, low: boolean, edge: boolean }[]}
 *   where its leaves belong: a place and the radius of the clump there; `low` if on a bough rather than in
 *   the crown, `edge` if the tree is one of those on the bank
 */
export function growTree(limbs, rng, spot) {
  const { x, z, y, girth, height, kind, toward } = spot;
  const detail = spot.detail ?? 1;
  const edge = kind !== 'inner';
  const anchors = [];

  // The trunk. It leans toward its light, more the nearer the edge, and wanders.
  const lean = kind === 'edge' ? rng.range(0.03, 0.16) : kind === 'framing' ? 0.04 : rng.range(0, 0.04);
  const leanX = toward[0] * lean + rng.gauss() * 0.02;
  const leanZ = toward[1] * lean + rng.gauss() * 0.02;
  const rings = (edge ? 6 : 4) + (detail > 1 ? 1 : 0);
  const sides = kind === 'framing' ? 9 : edge ? 7 - (detail < 1 ? 1 : 0) : 6 - (detail < 1 ? 1 : 0);
  const trunk = [];
  let wx = 0;
  let wz = 0;
  for (let i = 0; i <= rings; i++) {
    // rings crowd toward the ground, where the trunk is looked at
    const t = Math.pow(i / rings, 1.5);
    const h = t * height;
    if (i > 0) {
      wx += rng.gauss() * girth * 0.55;
      wz += rng.gauss() * girth * 0.55;
    }
    // a flare at the root, then an even taper to a third at the top
    const r = girth * (1.0 - 0.67 * t + 0.45 * Math.exp(-h / (girth * 2.2)));
    trunk.push({ x: x + leanX * h + wx, y: y - 0.4 + h, z: z + leanZ * h + wz, r });
  }
  addLimb(limbs, trunk, sides);

  /** The trunk's centre and radius at height `h` above its foot. */
  const trunkAt = (h) => {
    const t = Math.min(Math.max(h / height, 0), 1);
    const f = Math.pow(t, 1 / 1.5) * rings;
    const i = Math.min(Math.floor(f), rings - 1);
    const k = f - i;
    const a = trunk[i];
    const b = trunk[i + 1];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, r: a.r + (b.r - a.r) * k };
  };

  // Boughs. On the bank they start low and most reach out toward the light;
  // inside the wood there are few, and high, except on a tree that stands in
  // a gap and is in leaf from low down (leafy).
  const boughs = kind === 'framing' ? 6 : edge || spot.leafy ? 2 + rng.int(3) : 1 + rng.int(2);
  // (the framing tree's begin above the film's picture: only their leaves hang into it)
  const lowest = spot.bare ? height * 0.4 : kind === 'framing' ? 4 : edge ? 1.5 : spot.leafy ? 2.5 : height * 0.45;
  const facing = Math.atan2(toward[0], toward[1]);
  for (let b = 0; b < boughs; b++) {
    const h = lowest + (height * 0.72 - lowest) * Math.pow(rng.float(), edge ? 1.7 : 1);
    const from = trunkAt(h);
    // round the compass, but twice as likely on the side of the light
    const around = facing + (rng.float() < 0.65 ? rng.gauss() * 0.9 : rng.range(0, Math.PI * 2));
    let rise = rng.range(0.15, 0.95); // radians above level, where it leaves the trunk
    const length = rng.range(2.2, 5.2) * (kind === 'framing' ? 1.5 : 1) * (1 - 0.35 * (h / height));
    const steps = 3;
    const thick = from.r * rng.range(0.38, 0.6);
    // low boughs sag under their leaves, high ones turn up toward the sky
    const bend = h < 5 ? rng.range(-0.3, 0.12) : rng.range(-0.05, 0.3);
    const points = [{ x: from.x, y: from.y, z: from.z, r: thick }];
    let px = from.x;
    let py = from.y;
    let pz = from.z;
    let turn = around;
    for (let s = 1; s <= steps; s++) {
      const step = length / steps;
      px += Math.sin(turn) * Math.cos(rise) * step;
      py += Math.sin(rise) * step;
      pz += Math.cos(turn) * Math.cos(rise) * step;
      points.push({ x: px, y: py, z: pz, r: thick * (1 - s / steps) * 0.85 + 0.012 });
      // leaves on its outer two thirds: a clump at the end and a smaller one before it
      if (s >= 2) anchors.push({ x: px, y: py, z: pz, size: rng.range(0.45, 0.8) * (0.55 + 0.15 * s), low: true, edge });
      rise += bend;
      turn += rng.gauss() * 0.3;
    }
    addLimb(limbs, points, kind === 'framing' ? 6 : detail > 0 ? 5 : 4);
  }

  // Leaves low on the trunk. A tree with light at its side is often in leaf
  // nearly to the ground there (shoots from the trunk, ivy, a sapling in
  // front of it): from the water, a tall column of leaves. The film's lit
  // foliage stands in such columns, not in round clumps. Leafy trees have
  // them, and one in four of the others on the bank.
  if (!spot.bare && (spot.leafy || (kind === 'edge' && rng.float() < 0.25))) {
    const top = rng.range(6, 11);
    const side = facing + rng.gauss() * 0.6;
    for (let h = rng.range(1.6, 2.6); h < top; h += rng.range(0.9, 1.5)) {
      const from = trunkAt(h);
      const out = from.r + rng.range(0.2, 0.9);
      const around = side + rng.gauss() * 0.5;
      anchors.push({ x: from.x + Math.sin(around) * out, y: from.y, z: from.z + Math.cos(around) * out, size: rng.range(0.5, 0.9), low: true, edge });
    }
  }

  // Thin dead branches low on the trunk: lines across the dark, as in the film.
  if (edge && detail > 0) {
    const twigs = 1 + rng.int(3);
    for (let t = 0; t < twigs; t++) {
      const h = rng.range(1.0, 6.5);
      const from = trunkAt(h);
      const around = rng.range(0, Math.PI * 2);
      const rise = rng.range(-0.35, 0.5);
      const length = rng.range(0.9, 2.6);
      const mid = { x: from.x + Math.sin(around) * Math.cos(rise) * length * 0.5, y: from.y + Math.sin(rise) * length * 0.5, z: from.z + Math.cos(around) * Math.cos(rise) * length * 0.5, r: 0.028 };
      const tip = { x: from.x + Math.sin(around + 0.25) * Math.cos(rise) * length, y: from.y + Math.sin(rise - 0.2) * length, z: from.z + Math.cos(around + 0.25) * Math.cos(rise) * length, r: 0.012 };
      addLimb(limbs, [{ x: from.x, y: from.y, z: from.z, r: 0.045 }, mid, tip], 3);
    }
  }

  // The crown: mostly above the picture, but it is what a low camera looks up
  // into, and what the water shows upside down.
  const crowns = edge ? 4 : 3;
  for (let c = 0; c < crowns; c++) {
    const h = height * rng.range(0.55, 1.0);
    const at = trunkAt(h);
    const out = rng.range(0.5, 3.2);
    const around = rng.range(0, Math.PI * 2);
    anchors.push({ x: at.x + Math.sin(around) * out, y: at.y, z: at.z + Math.cos(around) * out, size: rng.range(1.0, 1.8), low: false, edge });
  }
  return anchors;
}

/**
 * The finished mesh geometry.
 * @param {{ positions: number[], normals: number[], indices: number[] }} limbs
 * @returns {THREE.BufferGeometry}
 */
export function limbGeometry(limbs) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(limbs.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(limbs.normals, 3));
  geometry.setIndex(limbs.indices);
  return geometry;
}
