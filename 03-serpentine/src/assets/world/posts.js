// The small things at the road's edge that a driver reads at night: white
// guide posts with a black band and a reflector (white on the left of the way
// the road is driven, red on the right), every 50 m on the straight and
// closer in the bends; red-and-white chevron boards round the outside of
// every hairpin and of the hook; a warning triangle before each of them.
//
// Reflectors and sheeting are retro-reflective (retro.js): by day they are
// paint, at night they blaze in the head lamps of the car behind which the
// camera rides. The pictures on the boards are drawn here, pixel by pixel:
// generic chevrons and a bend, no lettering.

import * as THREE from 'three';
import { EDGE, along, levelFrame, row, runsOf, upright } from './furniture.js';
import { retroReflective } from './retro.js';

/** Guide post spacing by the bend's radius: [radius above which, spacing] (m). */
const POST_SPACING = [
  [400, 50],
  [200, 25],
  [60, 16],
  [0, 10],
];
/** A bend gets chevrons where it is tighter than this for at least CHEVRON_RUN metres. */
const CHEVRON_CURVATURE = 1 / 60;
const CHEVRON_RUN = 15;
/** One board per this much turning (rad), never closer than CHEVRON_GAP metres. */
const CHEVRON_TURN = (11 * Math.PI) / 180;
const CHEVRON_GAP = 5;
/** The triangle stands this far before a chevroned bend. */
const WARNING_AHEAD = 90;

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createPosts({ track, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'posts';
  const frame = {};
  const p = new THREE.Vector3();
  const inside = (s, ranges, margin) => ranges.some((r) => s > r.s0 - margin && s < r.s1 + margin);
  const kindAt = (s, side) => (side > 0 ? track.kindL : track.kindR)[Math.round(track.wrap(s) / track.ds) % track.count];
  const standard = (options) => atmosphere.patch(new THREE.MeshStandardMaterial(options));

  // ---- guide posts
  const posts = [];
  const postColors = [];
  const spacingAt = (s) => {
    const r = 1 / Math.max(1e-6, Math.abs(track.frameAt(s, frame).curvature));
    return POST_SPACING.find(([radius]) => r > radius)[1];
  };
  along(track, 0, track.length, spacingAt, (s) => {
    if (inside(s, track.tunnels, 25) || inside(s, track.bridges, 3)) return;
    for (const side of [1, -1]) {
      const kind = kindAt(s, side);
      if (kind === EDGE.RAIL || kind === EDGE.WALL || kind === EDGE.PARAPET) continue;
      const edge = track.edgeAt(s, side);
      const lat = Math.min(track.halfWidth + 1.1, edge - 0.3);
      if (lat < track.halfWidth + 0.7) continue;
      levelFrame(track, s, frame);
      track.pointAt(s, side * lat, p);
      posts.push(upright(p.clone().setY(p.y - 0.2), frame.yaw));
      postColors.push(side > 0 ? [1, 1, 1] : [1, 0.05, 0.02]);
    }
  });
  const white = standard({ color: 0xe8e8e2, roughness: 0.55 });
  const black = standard({ color: 0x0c0c0c, roughness: 0.6 });
  const sheeting = retroReflective(standard({ color: 0xffffff, roughness: 0.35 }));
  group.add(
    row(new THREE.BoxGeometry(0.11, 1.2, 0.1).translate(0, 0.6, 0), white, posts, { name: 'guide-posts' }),
    row(new THREE.BoxGeometry(0.116, 0.24, 0.106).translate(0, 1.0, 0), black, posts, { shadow: false, name: 'guide-post-bands' }),
  );
  const postReflectors = row(new THREE.BoxGeometry(0.045, 0.13, 0.01).translate(0, 1.0, -0.056), sheeting, posts, {
    shadow: false,
    name: 'guide-post-reflectors',
  });
  postColors.forEach((c, i) => postReflectors.setColorAt(i, new THREE.Color(...c)));
  group.add(postReflectors);

  // ---- chevron boards round the outside of the tight bends, and a warning triangle before each
  const boards = { 1: [], [-1]: [] }; // by the way the arrow points: 1 left, -1 right
  const poles = [];
  const triangles = [];
  const bends = runsOf(track, (i) => Math.abs(track.curvature[i]) > CHEVRON_CURVATURE).filter((r) => r.s1 - r.s0 >= CHEVRON_RUN);
  for (const bend of bends) {
    const mid = track.curvature[Math.round((bend.i0 + bend.i1) / 2) % track.count];
    const turnSide = Math.sign(mid); // +1 bends left
    const outside = -turnSide;
    let turn = 0;
    for (let i = bend.i0; i <= bend.i1; i++) turn += Math.abs(track.curvature[i % track.count]) * track.ds;
    const s0 = bend.s0 - 8;
    const s1 = bend.s1 + 4;
    const count = Math.max(3, Math.min(Math.round(turn / CHEVRON_TURN), Math.floor((s1 - s0) / CHEVRON_GAP)));
    along(track, s0, s1, (s1 - s0) / count, (s) => {
      const edge = track.edgeAt(s, outside);
      const lat = outside * (edge + (kindAt(s, outside) === EDGE.RAIL ? 0.45 : 0.25));
      track.pointAt(s, lat, p);
      // turned to face a driver about 30 m back down the road
      const eye = track.pointAt(s - 30, 0, new THREE.Vector3());
      const yaw = Math.atan2(eye.x - p.x, eye.z - p.z);
      boards[turnSide].push(upright(p.clone().setY(p.y + 0.95), yaw));
      poles.push(upright(p.clone().setY(p.y - 0.3), yaw, 1, 1.75, 1));
    });
    // the triangle: on the right, before the bend
    const sw = bend.s0 - WARNING_AHEAD;
    const edge = track.edgeAt(sw, -1);
    const lat = -(kindAt(sw, -1) === EDGE.RAIL ? edge + 0.5 : Math.min(edge - 0.3, track.halfWidth + 1.4));
    track.pointAt(sw, lat, p);
    levelFrame(track, sw, frame);
    triangles.push({ at: p.clone(), yaw: frame.yaw + Math.PI });
  }

  const chevron = chevronTexture();
  const boardMaterial = retroReflective(standard({ map: chevron, roughness: 0.4 }));
  const boardBack = standard({ color: 0x6b6f72, roughness: 0.6, metalness: 0.4 });
  const pole = standard({ color: 0x7d8286, roughness: 0.45, metalness: 0.6 });
  const W = 0.55;
  const H = 0.75;
  for (const turnSide of [1, -1]) {
    const face = new THREE.PlaneGeometry(W, H).translate(0, H / 2, 0.012);
    // a bend to the left is the same picture mirrored
    if (turnSide > 0) {
      const uv = face.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    group.add(row(face, boardMaterial, boards[turnSide], { shadow: false, name: 'chevron-faces' }));
    group.add(row(new THREE.BoxGeometry(W, H, 0.02).translate(0, H / 2, 0), boardBack, boards[turnSide], { name: 'chevron-boards' }));
  }
  group.add(row(new THREE.CylinderGeometry(0.03, 0.03, 1, 8).translate(0, 0.5, -0.04), pole, poles, { name: 'chevron-poles' }));

  // warning triangles: a pole and a board each
  const triangleTexture = warningTexture();
  const triangleMaterial = retroReflective(standard({ map: triangleTexture, roughness: 0.4, alphaTest: 0.5 }));
  const signs = triangles.map(({ at, yaw }) => upright(at.clone().setY(at.y + 1.45), yaw));
  const signPoles = triangles.map(({ at, yaw }) => upright(at.clone().setY(at.y - 0.3), yaw, 1, 2.6, 1));
  const triangleGeometry = new THREE.PlaneGeometry(0.9, 0.8).translate(0, 0.4, 0.03);
  group.add(row(triangleGeometry, triangleMaterial, signs, { name: 'warning-signs' }));
  group.add(row(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), pole, signPoles, { name: 'warning-poles' }));

  return {
    group,
    stats: { posts: posts.length, chevrons: boards[1].length + boards[-1].length, bends: bends.length, warnings: triangles.length },
  };
}

/** Drawn in a little sRGB picture, with a smooth edge of `soft` pixels. */
function picture(width, height, paint) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint((x + 0.5) / width, (y + 0.5) / height);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const RED = [190, 24, 28];
const WHITE = [236, 236, 230];
const BLACK = [18, 18, 18];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const cover = (d, px) => Math.min(1, Math.max(0, 0.5 - d / px));

/** A white chevron on red pointing right (u to the right, v up), with a thin white border. */
function chevronTexture() {
  const w = 64;
  const h = 96;
  return picture(w, h, (u, v) => {
    const border = Math.min(u, 1 - u, v * 1.5, (1 - v) * 1.5);
    const tip = 0.3 + 0.42 * (1 - Math.abs(2 * v - 1));
    const arm = Math.abs(u - tip) - 0.14;
    const inBand = Math.max(arm, 0.16 - Math.min(v, 1 - v) * 1.0);
    let c = mix(RED, WHITE, cover(inBand * w, 1.2));
    c = mix(c, WHITE, cover((border - 0.045) * w, 1.2));
    return c;
  });
}

/** An upright triangle: white, a red rim, a black bend in it; transparent outside. */
function warningTexture() {
  const s = 96;
  return picture(s, s, (u, v) => {
    // distance inside the triangle (positive inside), in units of the picture
    const x = u - 0.5;
    const y = v - 0.06;
    const k = Math.sqrt(3) / 2;
    const d = Math.min(y, k * (0.5 - Math.abs(x)) - 0.5 * y);
    if (d < 0) return [0, 0, 0, 0];
    let c = mix(RED, WHITE, cover((0.075 - d) * s, 1));
    // the bend: a thick curve up the middle
    const bend = Math.abs(x - 0.07 * Math.sin((y - 0.16) * 7.5)) - 0.035;
    if (y > 0.16 && y < 0.56) c = mix(c, BLACK, cover(bend * s, 1));
    return [...c, 255];
  });
}
