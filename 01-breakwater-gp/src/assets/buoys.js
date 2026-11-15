// Course furniture that floats: slalom marks, boundary floats and the
// start/finish arch.
//
// The slalom marks follow real-world lateral marks: a red flat-topped "can" is
// left to port (pass on its right), a green pointed "cone" is left to
// starboard (pass on its left). A chevron sign above each one points to
// the side you have to take.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { merge, part } from './geo.js';
import { withSkyFog } from './sky.js';
import { PALETTE } from './palette.js';
import { makeCanvasTexture } from './textures.js';

const lit = (opts) => withSkyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, ...opts }));
const glowing = (color, intensity = 1) =>
  withSkyFog(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 }));

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const white = PALETTE.buoyWhite;
  const dark = '#22262c';

  const canBody = merge([
    part(new THREE.CylinderGeometry(0.66, 0.7, 1.15, 16), PALETTE.buoyRed, { pos: [0, 0.6, 0] }),
    part(new THREE.CylinderGeometry(0.67, 0.67, 0.3, 16), white, { pos: [0, 1.3, 0] }),
    part(new THREE.CylinderGeometry(0.66, 0.66, 0.62, 16), PALETTE.buoyRed, { pos: [0, 1.76, 0] }),
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10), dark, { pos: [0, 2.24, 0] }),
    part(new THREE.TorusGeometry(0.82, 0.17, 8, 20), dark, { pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.5, 0.3, 1.0, 10), dark, { pos: [0, -0.5, 0] }),
  ]);
  const coneBody = merge([
    part(new THREE.CylinderGeometry(0.66, 0.7, 0.8, 16), PALETTE.buoyGreen, { pos: [0, 0.42, 0] }),
    part(new THREE.CylinderGeometry(0.6, 0.66, 0.28, 16), white, { pos: [0, 0.96, 0] }),
    part(new THREE.ConeGeometry(0.6, 1.3, 16), PALETTE.buoyGreen, { pos: [0, 1.75, 0] }),
    part(new THREE.TorusGeometry(0.82, 0.17, 8, 20), dark, { pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.5, 0.3, 1.0, 10), dark, { pos: [0, -0.5, 0] }),
  ]);

  // "»" sign pointing toward +X
  const chevron = new THREE.Shape();
  [
    [0.0, 0.62],
    [0.56, 0.0],
    [0.0, -0.62],
    [-0.42, -0.62],
    [0.14, 0.0],
    [-0.42, 0.62],
  ].forEach(([x, y], i) => (i ? chevron.lineTo(x, y) : chevron.moveTo(x, y)));
  const chevGeo = new THREE.ExtrudeGeometry(chevron, { depth: 0.16, bevelEnabled: false });
  chevGeo.translate(0, 0, -0.08);
  const sign = merge([part(chevGeo, null, { pos: [-0.4, 0, 0] }), part(chevGeo, null, { pos: [0.42, 0, 0] })]);

  shared = {
    canBody,
    coneBody,
    sign,
    bodyMat: lit({ roughness: 0.42 }),
    lamp: new THREE.SphereGeometry(0.16, 10, 8),
    redGlow: glowing(PALETTE.buoyRed.clone().lerp(new THREE.Color('#ff7a6a'), 0.35), 1.6),
    greenGlow: glowing(PALETTE.buoyGreen.clone().lerp(new THREE.Color('#7dffb0'), 0.4), 1.6),
  };
  return shared;
}

/**
 * @param {'right'|'left'} passSide which side the driver must take
 * Local axes once placed by the track: +Z = direction of travel, +X = port.
 * userData: body (tilts with the water), sign (stays level), pose(time, emphasis)
 */
export function createSlalomBuoy(passSide) {
  const a = sharedAssets();
  const isCan = passSide === 'right';
  const group = new THREE.Group();
  group.name = `slalom-${passSide}`;

  const body = new THREE.Mesh(isCan ? a.canBody : a.coneBody, a.bodyMat);
  group.add(body);

  const glow = isCan ? a.redGlow : a.greenGlow;
  const lamp = new THREE.Mesh(a.lamp, glow);
  lamp.position.y = isCan ? 2.5 : 2.46;
  body.add(lamp);

  const sign = new THREE.Mesh(a.sign, glow);
  // +X is port; "pass on the right" means the chevrons point to starboard (-X)
  const dir = isCan ? -1 : 1;
  sign.rotation.y = isCan ? Math.PI : 0;
  sign.position.set(dir * 0.4, 4.2, 0);
  group.add(sign);

  group.userData.body = body;
  group.userData.sign = sign;
  group.userData.radius = 0.85;
  /**
   * Pose the sign for one view. `emphasis` (0..1) is how strongly this mark is
   * that view's next target; the caller smooths it per driver.
   */
  group.userData.pose = (time, emphasis) => {
    const nudge = Math.sin(time * 5.5) * 0.5 + 0.5;
    const s = 1.0 + emphasis * (0.55 + 0.12 * nudge);
    sign.scale.setScalar(s);
    sign.position.x = dir * (0.4 + nudge * (0.25 + 0.5 * emphasis));
    sign.position.y = 4.2 + emphasis * 0.9 + Math.sin(time * 2.1) * 0.08;
    lamp.scale.setScalar(1 + emphasis * (0.6 + 0.6 * Math.sin(time * 9)));
  };
  return group;
}

/** Geometry + material for the small boundary floats (use with InstancedMesh). */
export function createCourseFloatAssets() {
  const geometry = merge([
    part(new THREE.CylinderGeometry(0.34, 0.38, 0.5, 12), PALETTE.floatOrange, { pos: [0, 0.12, 0] }),
    part(new THREE.CylinderGeometry(0.2, 0.34, 0.26, 12), PALETTE.buoyWhite, { pos: [0, 0.5, 0] }),
    part(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), '#d8d8d2', { pos: [0, 1.3, 0] }),
    part(new THREE.SphereGeometry(0.11, 8, 6), PALETTE.floatOrange, { pos: [0, 2.08, 0] }),
  ]);
  return { geometry, material: lit({ roughness: 0.5 }) };
}

/**
 * Inflatable start/finish arch. Local axes: +Z = direction of travel, the arch
 * spans X from -halfSpan to +halfSpan.
 * userData.setLights(stage): 0 = off, 1..3 = amber countdown, 4 = green.
 */
export function createStartArch({ halfSpan = 20, height = 9.5 } = {}) {
  const group = new THREE.Group();
  group.name = 'startArch';

  // tube: half torus squashed to a low arch, painted in bold segments
  const tubeR = 1.25;
  const torus = new THREE.TorusGeometry(halfSpan, tubeR, 12, 56, Math.PI);
  torus.scale(1, height / halfSpan, 1);
  torus.computeVertexNormals();
  const g = torus.toNonIndexed();
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = PALETTE.archA;
  const cB = PALETTE.archB;
  const cC = new THREE.Color('#1e2b4a');
  for (let i = 0; i < pos.count; i += 3) {
    // colour per triangle by its angle along the arch
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const ang = Math.atan2(y / (height / halfSpan), x) / Math.PI; // 0..1
    const band = Math.floor(ang * 14);
    const c = band === 6 || band === 7 ? cC : band % 2 === 0 ? cA : cB;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  const pontoons = [];
  for (const sx of [1, -1]) {
    // tall caissons so the swell can rise and fall around them
    pontoons.push(part(new THREE.CylinderGeometry(2.6, 2.8, 5.4, 18), '#f2c230', { pos: [sx * halfSpan, -0.6, 0] }));
    pontoons.push(part(new THREE.CylinderGeometry(2.75, 2.75, 0.3, 18), '#22262c', { pos: [sx * halfSpan, 2.2, 0] }));
    pontoons.push(part(new THREE.CylinderGeometry(tubeR * 1.1, tubeR * 1.25, 1.6, 14), cC, { pos: [sx * halfSpan, 3.0, 0] }));
  }
  const structure = new THREE.Mesh(merge([g, ...pontoons]), lit({ roughness: 0.6 }));
  group.add(structure);

  // banner hanging under the crown, readable from both directions
  const bannerTex = makeCanvasTexture(1024, 192, (ctx, w, h) => {
    ctx.fillStyle = '#1e2b4a';
    ctx.fillRect(0, 0, w, h);
    const sq = 24;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < Math.ceil(w / sq); x++) {
        ctx.fillStyle = (x + y) % 2 ? '#fdf6e6' : '#14161c';
        ctx.fillRect(x * sq, y * sq, sq, sq);
        ctx.fillRect(x * sq, h - (y + 1) * sq, sq, sq);
      }
    }
    ctx.fillStyle = '#fdf6e6';
    ctx.font = 'italic 800 86px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BREAKWATER  GP', w / 2, h / 2 + 4);
  });
  const bannerMat = withSkyFog(new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.8 }));
  const bannerW = halfSpan * 0.95;
  const bannerH = bannerW * (192 / 1024);
  const bannerY = height - tubeR - bannerH * 0.5 - 0.1;
  for (const facing of [0, Math.PI]) {
    // one face per direction so the lettering never reads mirrored
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bannerW, bannerH), bannerMat);
    banner.position.set(0, bannerY, facing ? -0.03 : 0.03);
    banner.rotation.y = facing;
    group.add(banner);
  }

  // start lights: three lamps in a housing below the banner, facing the grid (-Z)
  const lampY = bannerY - bannerH * 0.5 - 0.75;
  const housing = new THREE.Mesh(part(new RoundedBoxGeometry(5.4, 1.5, 0.5, 2, 0.15), '#16181d', { pos: [0, lampY, 0] }), lit({ roughness: 0.7 }));
  group.add(housing);
  const lampGeo = new THREE.SphereGeometry(0.52, 14, 10);
  const lamps = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PALETTE.lampOff.clone(), emissiveIntensity: 1, roughness: 1 });
    const lampMesh = new THREE.Mesh(lampGeo, mat);
    lampMesh.position.set((i - 1) * 1.65, lampY, -0.18);
    lampMesh.scale.set(1, 1, 0.55);
    group.add(lampMesh);
    lamps.push(mat);
  }
  group.userData.setLights = (stage) => {
    lamps.forEach((m, i) => {
      if (stage >= 4) {
        m.emissive.copy(PALETTE.lampGreen);
        m.emissiveIntensity = 2.6;
      } else if (stage > i) {
        m.emissive.copy(PALETTE.lampAmber);
        m.emissiveIntensity = 2.4;
      } else {
        m.emissive.copy(PALETTE.lampOff);
        m.emissiveIntensity = 1;
      }
    });
  };
  group.userData.halfSpan = halfSpan;
  return group;
}
