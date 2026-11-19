// The scenery of frame K5 (the owner's strict spec at dusk), at the place
// landmarks.js names (K5, k5Site): the end of the sweepback's first piece,
// where the road, high over the bay, turns right towards the shore.
//
//  - On the right, beyond the barrier, a big dark round tower: a drum of dark
//    ribbed concrete with a walkway and a railing round its top and one warm
//    window high up, turned towards the road that comes.
//  - On the left, beyond the barrier: two tall dark feather flags on poles
//    (plain: no mark, no lettering) and a yellow chevron board pointing into
//    the bend.
//  - Far below on the left, small warm lamps along the shore of the bay.
//
// It stands at every time of day. All of it is three meshes and a cloud of
// points (four draw calls where it is in view); the window and the lamps are
// emissive, not lights, so the scene's lights stay as many as they were. The
// far cones across the sea are far.js's.

import * as THREE from 'three';
import { K5, k5Site } from './landmarks.js';
import { GLSL_TARGET, targetDefines } from '../../engine/glsl.js';
import { extend } from './shading.js';

/** Segments round the drum, per tier. */
const ROUND = { low: 40, medium: 72, high: 96 };
/** The window: its width and height (m), how far down from the top, its radiance at full (times lamps.windows). */
const WINDOW = { w: 3.2, h: 1.3, down: 2.6, radiance: [0.22, 0.13, 0.06] };
/** (round 4) How much the flags' sails glow at each time of day (lit by a lamp at their foot), against their colour. */
const SAIL_GLOW = { day: 0, dusk: 0.06, twilight: 0.12, night: 0.12 };
/** The far lamps: their radiance at a kilometre (times lamps.street). */
const LAMP = { radiance: [1.0, 0.62, 0.3], gain: 0.5 };

/** A writer of plain coloured triangles. */
function writer() {
  const pos = [];
  const col = [];
  /** per vertex: a normal given by hand (the drum's round wall), or null for the facet's */
  const given = [];
  const tri = (a, b, c, rgb, na = null, nb = null, nc = null) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(...rgb);
    given.push(na, nb, nc);
  };
  const quad = (a, b, c, d, rgb, n = null) => {
    tri(a, b, c, rgb, n?.[0], n?.[1], n?.[2]);
    tri(a, c, d, rgb, n?.[0], n?.[2], n?.[3]);
  };
  /** A box from its centre, three half-axes (arrays). */
  const box = (c, ax, ay, az, rgb) => {
    const p = (sx, sy, sz) => [0, 1, 2].map((k) => c[k] + sx * ax[k] + sy * ay[k] + sz * az[k]);
    const v = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) quad(v[a], v[b], v[cc], v[d], rgb);
  };
  const geometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    given.forEach((n, v) => n && nrm.setXYZ(v, n[0], n[1], n[2]));
    g.computeBoundingSphere();
    return g;
  };
  return { tri, quad, box, geometry };
}

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createK5({ track, terrain, caps, tier, rng, atmosphere }) {
  const group = new THREE.Group();
  group.name = 'k5';
  const site = k5Site(track);
  const empty = { group, stats: { triangles: 0 }, setTime() {}, setPixelRatio() {}, dispose() {} };
  if (!site) return empty;
  const P = new THREE.Vector3();
  const frame = {};
  /** A point `beyond` m behind the solid edge of a side at `ahead` m past the place, on the ground there. */
  const beside = (ahead, side, beyond) => {
    const s = track.wrap(site.s + ahead);
    track.pointAt(s, side * (track.edgeAt(s, side) + beyond), P);
    const ground = terrain.heightAt(P.x, P.z);
    return { x: P.x, y: ground, z: P.z, road: track.profile(s, side * track.edgeAt(s, side), {}).y, s };
  };
  const solid = writer();
  const sail = writer();

  // ---- the tower
  const T = K5.tower;
  const c = beside(T.ahead, -1, T.beyond + T.r);
  const top = c.road + T.h;
  const foot = Math.min(c.y, c.road) - 4;
  const n = ROUND[tier] ?? ROUND.medium;
  // its front: towards the place, where the cars come from
  const fx = site.x - c.x;
  const fz = site.z - c.z;
  const front = Math.atan2(fx, fz);
  const at = (a, r, y) => [c.x + Math.sin(a) * r, y, c.z + Math.cos(a) * r];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    // dark concrete in vertical ribs, a shade lighter every other panel; a dark band under the walkway
    // (smooth: the wall's normals point straight out from the axis, so the drum shades round, not in facets)
    const rib = k % 2 ? [0.04, 0.045, 0.055] : [0.03, 0.033, 0.04];
    const n0 = [Math.sin(a0), 0, Math.cos(a0)];
    const n1 = [Math.sin(a1), 0, Math.cos(a1)];
    const round = [n0, n1, n1, n0];
    // vertical ribbed cladding: every other panel stands 0.18 m proud, its sides square to the wall
    const rr = k % 2 ? T.r + 0.18 : T.r;
    solid.quad(at(a0, rr, foot), at(a1, rr, foot), at(a1, rr, top - 1.4), at(a0, rr, top - 1.4), rib, round);
    if (k % 2) {
      const side0 = [Math.cos(a0), 0, -Math.sin(a0)];
      const side1 = [-Math.cos(a1), 0, Math.sin(a1)];
      solid.quad(at(a0, T.r, foot), at(a0, rr, foot), at(a0, rr, top - 1.4), at(a0, T.r, top - 1.4), rib, [side0, side0, side0, side0].map((v) => v.map((c) => -c)));
      solid.quad(at(a1, rr, foot), at(a1, T.r, foot), at(a1, T.r, top - 1.4), at(a1, rr, top - 1.4), rib, [side1, side1, side1, side1].map((v) => v.map((c) => -c)));
    }
    solid.quad(at(a0, T.r, top - 1.4), at(a1, T.r, top - 1.4), at(a1, T.r, top), at(a0, T.r, top), [0.022, 0.024, 0.028], round);
    // the walkway round the top, overhanging, and the roof
    const R = T.r + 1.1;
    solid.quad(at(a0, T.r, top), at(a1, T.r, top), at(a1, R, top), at(a0, R, top), [0.06, 0.06, 0.065]);
    solid.quad(at(a1, T.r, top - 0.25), at(a0, T.r, top - 0.25), at(a0, R, top - 0.25), at(a1, R, top - 0.25), [0.03, 0.03, 0.035]);
    solid.quad(at(a0, R, top - 0.25), at(a1, R, top - 0.25), at(a1, R, top), at(a0, R, top), [0.05, 0.05, 0.055]);
    solid.tri(at(a0, T.r, top + 0.05), at(a1, T.r, top + 0.05), [c.x, top + 0.9, c.z], [0.045, 0.045, 0.05]);
  }
  // the railing on the walkway: posts and two rails, steel grey
  {
    const R = T.r + 0.95;
    const posts = Math.round((2 * Math.PI * R) / (tier === 'low' ? 3.2 : 1.6));
    const steel = [0.12, 0.125, 0.13];
    for (let k = 0; k < posts; k++) {
      const a = (k / posts) * Math.PI * 2;
      const p = at(a, R, top + 0.55);
      solid.box(p, [Math.cos(a) * 0.04, 0, -Math.sin(a) * 0.04], [0, 0.55, 0], [Math.sin(a) * 0.04, 0, Math.cos(a) * 0.04], steel);
      const b = ((k + 1) / posts) * Math.PI * 2;
      for (const y of [top + 0.6, top + 1.1]) {
        const q0 = at(a, R, y);
        const q1 = at(b, R, y);
        const mid = q0.map((v, i) => (v + q1[i]) / 2);
        const half = q1.map((v, i) => (v - q0[i]) / 2);
        solid.box(mid, half, [0, 0.03, 0], [Math.sin(a) * 0.03, 0, Math.cos(a) * 0.03], steel);
      }
    }
  }

  // ---- the feather flags and the chevron board, beyond the left edge
  for (const f of K5.flags) {
    const p = beside(f.ahead, 1, f.beyond);
    const base = Math.min(p.y, p.road) - 0.3;
    const s = track.frameAt(p.s, frame);
    // the sail stands across the road, blowing out from the pole towards it (so the cars that come see it broadside)
    const toRoad = [-s.left.x, 0, -s.left.z];
    const l = Math.hypot(toRoad[0], toRoad[2]);
    const ax = [toRoad[0] / l, 0, toRoad[2] / l];
    const pole = [p.x, base + f.h / 2, p.z];
    solid.box(pole, [0.04, 0, 0], [0, f.h / 2, 0], [0, 0, 0.04], [0.08, 0.08, 0.085]);
    // the sail: a feather (a long teardrop) along the upper two thirds of the pole, bowed out across the road; our own
    // colours: a yellow band down the pole's side, the rest green (frame K5's are green and yellow, about 1.4 by 4.5 m)
    const H = f.h - 2.0;
    const y0 = base + 2.0;
    const width = (t) => 1.9 * Math.sin(Math.PI * Math.min(1, 0.04 + 0.96 * t)) ** 0.55 * (0.35 + 0.65 * Math.min(1, t / 0.7));
    const steps = 10;
    const yellow = [0.7, 0.6, 0.04];
    const green = [0.08, 0.36, 0.07];
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const w0 = width(t0);
      const w1 = width(t1);
      // a point of the sail: u across it (0 at the pole, 1 at the far edge), at height t; the edge droops a little
      const pt = (u, t, w) => [p.x + ax[0] * w * u, y0 + H * t - 0.18 * w * u * u, p.z + ax[2] * w * u];
      for (const [u0, u1, rgb] of [[0, 0.28, yellow], [0.28, 1, green]]) {
        const a0 = pt(u0, t0, w0), a1 = pt(u0, t1, w1), b0 = pt(u1, t0, w0), b1 = pt(u1, t1, w1);
        sail.quad(a0, b0, b1, a1, rgb);
        sail.quad(a0, a1, b1, b0, rgb);
      }
    }
  }
  {
    const p = beside(K5.chevron.ahead, 1, K5.chevron.beyond);
    const s = track.frameAt(p.s, frame);
    // facing the cars that come; the chevron points into the bend (to the right of the way they run)
    const back = [-s.tan.x, 0, -s.tan.z];
    const l = Math.hypot(back[0], back[2]);
    const fwd = [back[0] / l, 0, back[2] / l];
    const right = [fwd[2], 0, -fwd[0]];
    const base = Math.min(p.y, p.road);
    solid.box([p.x, base + 0.55, p.z], [0.04, 0, 0], [0, 0.55, 0], [0, 0, 0.04], [0.08, 0.08, 0.085]);
    const cy = base + 1.45;
    const half = 0.38;
    const pt = (u, v, out = 0) => [p.x + right[0] * u + fwd[0] * out, cy + v, p.z + right[2] * u + fwd[2] * out];
    solid.box([p.x, cy, p.z], right.map((x) => x * half), [0, half, 0], fwd.map((x) => x * 0.02), [0.62, 0.42, 0.02]);
    // the chevron, black, a hair in front (pointing to the board's right as the driver sees it: the road's right)
    const k = 1; // (seen from the road it must point to the right, into the bend)
    const ink = [0.01, 0.01, 0.01];
    solid.quad(pt(k * -0.2, 0.26, 0.025), pt(k * 0.14, 0, 0.025), pt(k * 0.03, 0, 0.025), pt(k * -0.31, 0.26, 0.025), ink);
    solid.quad(pt(k * 0.03, 0, 0.025), pt(k * 0.14, 0, 0.025), pt(k * -0.2, -0.26, 0.025), pt(k * -0.31, -0.26, 0.025), ink);
  }

  // ---- (round 4) dark low scrub on the right verge, between the barrier and the tower
  {
    const scrubRng = rng.fork('k5-scrub');
    for (let k = 0; k < (tier === 'low' ? 14 : 28); k++) {
      const p = beside(scrubRng.range(2, T.ahead + 6), -1, scrubRng.range(0.6, T.beyond + 0.5));
      const r = scrubRng.range(0.35, 0.8);
      const g = Math.max(p.y, p.road - 0.4);
      const ang = scrubRng.range(0, Math.PI);
      solid.box([p.x, g + r * 0.45, p.z], [Math.cos(ang) * r, 0, -Math.sin(ang) * r], [0, r * 0.5, 0], [Math.sin(ang) * r * 0.8, 0, Math.cos(ang) * r * 0.8], [0.02, 0.035, 0.022]);
    }
  }

  const solidMaterial = atmosphere.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  solidMaterial.name = 'k5';
  const solidMesh = new THREE.Mesh(solid.geometry(), solidMaterial);
  solidMesh.name = 'k5-scenery';
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  solidMesh.matrixAutoUpdate = false;
  group.add(solidMesh);

  // ---- the sails: their own mesh, so that a lamp at their foot can light them after dark (SAIL_GLOW)
  const sailGlow = { value: 0 };
  const sailMaterial = atmosphere.patch(
    extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }), 'k5-sail', (shader) => {
      shader.uniforms.uSailGlow = sailGlow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSailGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSailGlow;');
    }),
  );
  sailMaterial.name = 'k5-sails';
  const sailMesh = new THREE.Mesh(sail.geometry(), sailMaterial);
  sailMesh.name = 'k5-sails';
  sailMesh.castShadow = true;
  sailMesh.matrixAutoUpdate = false;
  group.add(sailMesh);

  // ---- the window: one warm pane high on the drum, turned towards the road that comes
  const pane = writer();
  {
    // (round 4) where the frame has it: seen from K5's camera (T.camera m behind the place), T.window degrees right of
    // the road's heading, on the side of the drum facing that camera
    const hd = (site.heading * Math.PI) / 180;
    const cam = { x: site.x - Math.sin(hd) * T.camera, z: site.z - Math.cos(hd) * T.camera };
    const want = hd - (T.window * Math.PI) / 180;
    let a = front - 0.18;
    let bestErr = Infinity;
    for (let k = 0; k < 360; k++) {
      const b = (k / 360) * Math.PI * 2;
      const [px, , pz] = at(b, T.r, 0);
      // facing the camera
      if (Math.sin(b) * (cam.x - px) + Math.cos(b) * (cam.z - pz) <= 0) continue;
      let err = Math.atan2(px - cam.x, pz - cam.z) - want;
      err = Math.abs(Math.atan2(Math.sin(err), Math.cos(err)));
      if (err < bestErr) { bestErr = err; a = b; }
    }
    const half = WINDOW.w / 2 / T.r;
    const y1 = top - WINDOW.down;
    const y0 = y1 - WINDOW.h;
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const b0 = a - half + (2 * half * k) / steps;
      const b1 = a - half + (2 * half * (k + 1)) / steps;
      pane.quad(at(b0, T.r + 0.26, y0), at(b1, T.r + 0.26, y0), at(b1, T.r + 0.26, y1), at(b0, T.r + 0.26, y1), [1, 1, 1]);
    }
  }
  const paneMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });
  paneMaterial.name = 'k5-window';
  const paneMesh = new THREE.Mesh(pane.geometry(), paneMaterial);
  paneMesh.name = 'k5-window';
  paneMesh.matrixAutoUpdate = false;
  group.add(paneMesh);

  // ---- the far lamps along the shore of the bay, below on the left
  const lampRng = rng.fork('k5-lamps');
  const level = terrain.lake?.level ?? terrain.sea?.level ?? 0;
  const lamps = [];
  for (let tries = 0; tries < 400 && lamps.length < K5.lamps.count; tries++) {
    const b = lampRng.range(K5.lamps.bearings[0], K5.lamps.bearings[1]) * (Math.PI / 180);
    const d = lampRng.range(K5.lamps.near, K5.lamps.far);
    const x = site.x + Math.sin(b) * d;
    const z = site.z + Math.cos(b) * d;
    const h = terrain.heightAt(x, z);
    if (h < level + 1 || h > level + 30) continue;
    lamps.push(x, h + 4, z);
  }
  const lampGeometry = new THREE.BufferGeometry();
  lampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
  lampGeometry.computeBoundingSphere();
  const lampUniforms = { ...atmosphere.uniforms, uLamp: { value: new THREE.Vector3() }, uPixel: { value: 1 } };
  const lampMaterial = new THREE.ShaderMaterial({
    defines: targetDefines(caps),
    uniforms: lampUniforms,
    vertexShader: /* glsl */ `
uniform vec3 uLamp;
uniform float uPixel;
varying vec3 vColor;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  float d = length(w.xyz - cameraPosition);
  vColor = uLamp * clamp(1.0e6 / (d * d), 0.0, 25.0);
  gl_PointSize = 3.0 * uPixel;
}`,
    fragmentShader: /* glsl */ `
${GLSL_TARGET}
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  gl_FragColor = toTarget(vec4(vColor * exp(-dot(q, q) * 3.0), 1.0));
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  lampMaterial.name = 'k5-lamps';
  const lampPoints = new THREE.Points(lampGeometry, lampMaterial);
  lampPoints.name = 'k5-lamps';
  lampPoints.renderOrder = 11;
  lampPoints.matrixAutoUpdate = false;
  group.add(lampPoints);

  return {
    group,
    stats: { triangles: solidMesh.geometry.attributes.position.count / 3, lamps: lamps.length / 3, tower: { x: Math.round(c.x), z: Math.round(c.z) } },
    /** @param {import('./lighting.js').TimeOfDay} time */
    setTime(time) {
      sailGlow.value = SAIL_GLOW[time.name] ?? 0;
      const w = time.lamps.windows ?? 0;
      paneMaterial.color.setRGB(0.012 + WINDOW.radiance[0] * w, 0.014 + WINDOW.radiance[1] * w, 0.018 + WINDOW.radiance[2] * w);
      const s = (time.lamps.street ?? 0) * LAMP.gain;
      lampUniforms.uLamp.value.set(LAMP.radiance[0] * s, LAMP.radiance[1] * s, LAMP.radiance[2] * s);
      lampPoints.visible = s > 0;
    },
    /** @param {number} ratio the renderer's pixel ratio */
    setPixelRatio(ratio) {
      lampUniforms.uPixel.value = ratio;
    },
    dispose() {
      solidMesh.geometry.dispose();
      solidMaterial.dispose();
      sailMesh.geometry.dispose();
      sailMaterial.dispose();
      paneMesh.geometry.dispose();
      paneMaterial.dispose();
      lampGeometry.dispose();
      lampMaterial.dispose();
    },
  };
}
