// The start: a steel gantry over the start/finish line with a row of five red
// lamps that count the start down and a slim timing board beside them, and,
// off the road on the meadow side of the straight, a lay-by with a wooden
// chalet (its windows lit at night), a fence and two benches.
//
// The gantry's legs stand just beyond the Track's solid edges at s = 0, so the
// line a driver sees is the line the clock reads. The lamps are switched by
// colour, never by visibility (setStartLights): five instances of one mesh.
// The street lamps along the straight are lamps.js's.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { footBox, levelFrame, row, upright } from './furniture.js';

/** A lit start lamp's radiance (linear, scene units): far beyond white by day too. */
const START_LAMP = [45, 2, 0.8];
const START_DARK = [0.04, 0.004, 0.003];
/** The chalet's windows at full (lighting.js lamps.windows = 1). */
const WINDOW = [1.6, 1.0, 0.55];
/** The gantry's chords: heights of the bottom and top one above the road. */
const CHORDS = [6.3, 7.3];

/**
 * Where the lay-by is: its middle on the map and the heading its chalet faces. Pure, from the Track: the forest
 * can keep its trees off it (a circle of `radius` metres).
 * @param {object} track
 */
export function layBy(track) {
  const s = 118;
  const frame = levelFrame(track, s, {});
  const lat = -(track.edgeAt(s, -1) + 7);
  const at = track.pointAt(s, lat, new THREE.Vector3());
  return { s, lat, x: at.x, z: at.z, yaw: frame.yaw + Math.PI / 2, radius: 11 };
}

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js (heightAt)
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createStart({ track, terrain, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'start';
  const standard = (options) => atmosphere.patch(new THREE.MeshStandardMaterial(options));
  const frame = levelFrame(track, 0, {});
  const P = (lat, h, along = 0) =>
    new THREE.Vector3(
      frame.pos.x + frame.flat.x * lat + frame.ahead.x * along,
      frame.pos.y + h,
      frame.pos.z + frame.flat.z * lat + frame.ahead.z * along,
    );

  // ---- the gantry: two legs a side, two chords across, struts between them
  const steel = standard({ color: 0x6e7479, metalness: 0.75, roughness: 0.42 });
  const dark = standard({ color: 0x15171a, metalness: 0.3, roughness: 0.55 });
  const left = track.edgeAt(0, 1) + 0.7;
  const right = track.edgeAt(0, -1) + 0.7;
  const span = left + right;
  const mid = (left - right) / 2;
  const members = [];
  for (const lat of [left, -right]) {
    const foot = P(lat, 0);
    const ground = terrain.heightAt(foot.x, foot.z) - frame.pos.y;
    for (const along of [-0.7, 0.7]) {
      members.push(upright(P(lat, ground - 0.6, along), frame.yaw, 0.32, CHORDS[1] + 0.2 - ground + 0.6, 0.32));
      // a concrete footing round each leg
      members.push(upright(P(lat, ground - 0.4, along), frame.yaw, 0.7, 0.75, 0.7));
    }
    // the legs' cross braces
    for (const h of [1.5, 3.5, 5.5]) members.push(upright(P(lat, h - 0.06, 0), frame.yaw, 0.12, 0.12, 1.4));
  }
  for (const h of CHORDS) {
    for (const along of [-0.7, 0.7]) members.push(upright(P(mid, h, along), frame.yaw, span, 0.24, 0.24));
  }
  // verticals and cross pieces between the chords
  const bays = Math.round(span / 1.6);
  for (let k = 0; k <= bays; k++) {
    const lat = -right + (span * k) / bays;
    for (const along of [-0.7, 0.7]) members.push(upright(P(lat, CHORDS[0], along), frame.yaw, 0.1, CHORDS[1] - CHORDS[0], 0.1));
    members.push(upright(P(lat, CHORDS[0] + 0.1, 0), frame.yaw, 0.08, 0.08, 1.4));
  }
  group.add(row(footBox(), steel, members, { name: 'gantry' }));

  // the lamp panel over the middle of the road, the board beside it
  const panelH = CHORDS[0] - 0.85;
  const panels = [
    upright(P(0, panelH, 0), frame.yaw, 2.9, 0.75, 0.3),
    upright(P(4.2, panelH + 0.15, 0), frame.yaw, 2.2, 0.5, 0.18),
    // hangers
    upright(P(-1.2, panelH + 0.7, 0), frame.yaw, 0.08, CHORDS[0] - panelH - 0.6, 0.08),
    upright(P(1.2, panelH + 0.7, 0), frame.yaw, 0.08, CHORDS[0] - panelH - 0.6, 0.08),
    upright(P(4.2, panelH + 0.6, 0), frame.yaw, 0.08, CHORDS[0] - panelH - 0.55, 0.08),
  ];
  group.add(row(footBox(), dark, panels, { name: 'start-panel' }));

  // five lamps facing the grid (behind the line), each in a short hood
  const lampMaterial = atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const lampGeometry = new THREE.CircleGeometry(0.19, 20).rotateY(Math.PI).translate(0, 0, -0.16);
  const hoodGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 16, 1, true, -Math.PI / 2, Math.PI)
    .rotateX(Math.PI / 2)
    .translate(0, 0, -0.25);
  const lampMatrices = [];
  for (let k = 0; k < 5; k++) lampMatrices.push(upright(P((k - 2) * 0.55, panelH + 0.38, 0), frame.yaw));
  const lamps = row(lampGeometry, lampMaterial, lampMatrices, { shadow: false, name: 'start-lamps' });
  group.add(lamps);
  group.add(row(hoodGeometry, standard({ color: 0x15171a, roughness: 0.6, side: THREE.DoubleSide }), lampMatrices, { shadow: false, name: 'start-hoods' }));
  // the timing board: a dark face with a thin amber strip, nothing written on it
  const strip = atmosphere.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.3) }));
  group.add(
    row(new THREE.PlaneGeometry(1.9, 0.06).rotateY(Math.PI).translate(0, 0.25, -0.1), strip, [upright(P(4.2, panelH + 0.15, 0), frame.yaw)], {
      shadow: false,
      name: 'start-board-strip',
    }),
  );

  // ---- the lay-by
  const spot = layBy(track);
  const lay = { group: new THREE.Group(), windows: null };
  buildLayBy(lay, spot, terrain, standard);
  group.add(lay.group);

  const color = new THREE.Color();
  const setLamps = (n) => {
    for (let k = 0; k < 5; k++) lamps.setColorAt(k, color.setRGB(...(k < n ? START_LAMP : START_DARK)));
    lamps.instanceColor.needsUpdate = true;
  };
  setLamps(0);

  return {
    group,
    setStartLights: setLamps,
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      lay.windows.emissive.setRGB(...WINDOW).multiplyScalar(time.lamps.windows);
    },
  };
}

/** The chalet on its gravel pad, a fence between it and the road, two benches. */
function buildLayBy(lay, spot, terrain, standard) {
  const c = Math.cos(spot.yaw);
  const s = Math.sin(spot.yaw);
  // local (x along the front, z towards the road) to the map
  const at = (x, z, y = 0) => new THREE.Vector3(spot.x + x * c + z * s, y, spot.z - x * s + z * c);
  const ground = (x, z) => {
    const p = at(x, z);
    return terrain.heightAt(p.x, p.z);
  };
  let floor = Infinity;
  for (const [x, z] of [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]]) floor = Math.min(floor, ground(x, z));
  const base = floor + 0.35;

  const wood = standard({ color: 0x5b3b22, roughness: 0.85 });
  const stone = standard({ color: 0x77736c, roughness: 0.95 });
  const roof = standard({ color: 0x3a3c40, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  const gravel = standard({ color: 0x8c8676, roughness: 1 });
  lay.windows = standard({ color: 0x101418, roughness: 0.15, metalness: 0.1, emissive: 0x000000 });
  const place = (x, z, y, sx, sy, sz, yaw = 0) => upright(at(x, z, y), spot.yaw + yaw, sx, sy, sz);
  const box = footBox();

  lay.group.add(
    row(box, stone, [place(0, 0, floor - 0.5, 6.4, base - floor + 0.5, 5.4)], { name: 'chalet-plinth' }),
    row(box, wood, [place(0, 0, base, 6, 2.6, 5)], { name: 'chalet-walls' }),
  );
  // the gables and the roof: a prism along the front, its ridge 1.8 m over the eaves, overhanging all round
  const roofGeometry = (() => {
    const w = 3.6;
    const d = 3.2;
    const h = 1.8;
    const pts = [
      [-w, 0, -d], [w, 0, -d], [w, h, 0], [-w, h, 0],
      [-w, h, 0], [w, h, 0], [w, 0, d], [-w, 0, d],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    g.computeVertexNormals();
    return g;
  })();
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([3, 0, -2.5, 3, 0, 2.5, 3, 1.4, 0, -3, 0, 2.5, -3, 0, -2.5, -3, 1.4, 0], 3));
  gable.computeVertexNormals();
  lay.group.add(
    row(roofGeometry, roof, [place(0, 0, base + 2.45, 1, 1, 1)], { name: 'chalet-roof' }),
    row(gable, wood, [place(0, 0, base + 2.6, 1, 1, 1)], { name: 'chalet-gables' }),
  );
  // windows and door on the front (z = 2.5) and a window in each end
  const panes = [place(-1.7, 2.51, base + 1.0, 1.0, 0.85, 0.02), place(1.7, 2.51, base + 1.0, 1.0, 0.85, 0.02)];
  panes.push(place(3.01, 0, base + 1.0, 0.02, 0.85, 1.0), place(-3.01, 0, base + 1.0, 0.02, 0.85, 1.0));
  lay.group.add(row(box, lay.windows, panes, { shadow: false, name: 'chalet-windows' }));
  lay.group.add(row(box, standard({ color: 0x2e1d10, roughness: 0.8 }), [place(0, 2.52, base, 0.95, 2.0, 0.04)], { name: 'chalet-door' }));

  // the pad: a patch of gravel following the ground
  const pad = new THREE.PlaneGeometry(16, 12, 8, 6).rotateX(-Math.PI / 2);
  const pp = pad.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const p = at(pp.getX(i), pp.getZ(i) + 2);
    pp.setXYZ(i, p.x, terrain.heightAt(p.x, p.z) + 0.04, p.z);
  }
  pad.computeVertexNormals();
  const padMesh = new THREE.Mesh(pad, gravel);
  padMesh.receiveShadow = true;
  padMesh.name = 'lay-by';
  lay.group.add(padMesh);

  // a fence along the front of the pad, and two benches facing the road
  const fence = [];
  for (let k = 0; k <= 8; k++) {
    const x = -8 + k * 2;
    fence.push(place(x, 7.6, ground(x, 7.6) - 0.3, 0.12, 1.35, 0.12));
    if (k < 8) for (const h of [0.45, 0.9]) fence.push(place(x + 1, 7.6, ground(x + 1, 7.6) + h, 2.0, 0.09, 0.05));
  }
  lay.group.add(row(box, wood, fence, { name: 'lay-by-fence' }));
  const bench = mergeGeometries([
    new THREE.BoxGeometry(1.6, 0.06, 0.4).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.6, 0.35, 0.05).translate(0, 0.72, -0.2),
    new THREE.BoxGeometry(0.08, 0.45, 0.36).translate(-0.7, 0.22, 0),
    new THREE.BoxGeometry(0.08, 0.45, 0.36).translate(0.7, 0.22, 0),
  ]);
  lay.group.add(row(bench, wood, [place(-4.8, 4.8, ground(-4.8, 4.8)), place(4.8, 4.8, ground(4.8, 4.8))], { name: 'lay-by-benches' }));
}
