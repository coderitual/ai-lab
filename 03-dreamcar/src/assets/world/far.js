// What lies beyond the terrain: the mountains on the horizon, mist lying in
// the valleys, and at night the lights of a town across the lake (mirrored in it) and of a hamlet up the far slope.
//
// MOUNTAINS. Three rings of jagged ridges round the course, 5 to 11 km out,
// each a strip of faces from below the far land up to a ridge line made of
// ridged noise, with gullies cut into the faces and snow on what faces up
// high. They are a standard material, so they take the sun by day and the
// moon by night, and the haze (atmosphere.patch) fades their feet into the
// valley air and leaves the peaks clear. They lie beyond the camera's far
// plane, so their vertex shader puts them at the very back of the depth range
// (just in front of where the sky is drawn): they are drawn first, farthest
// ring first, every fragment passing the depth test (AlwaysDepth: still writing depth, so the sky does not paint over them), and everything real draws over them.
//
// MIST. A few soft sheets lying in the low ground outside the course and over
// the far end of the lake. Each vertex knows how deep the sheet is over the
// ground there, so the sheet thins to nothing where the land rises through it
// and never shows a hard line against the terrain; seen from close to its own
// height it fades away rather than show itself as a plane. It drifts with
// update()'s clock. Thick by day, thin at night.
//
// THE VILLAGE. At night a few dozen warm points along a few streets on the far
// shore, a dull glow of the sky over them, and two lit windows on far slopes.
// HDR-bright points, so they bloom faintly; they flicker only a little, as
// light seen through a long column of air does.

import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE, GLSL_TARGET, targetDefines } from '../../engine/glsl.js';
import { ATMOSPHERE_PARS } from './atmosphere.js';
import { extend, planeNoise, smoothstep, withBake } from './shading.js';
import { TIMES } from './lighting.js';
import { PROBE_LAYER } from '../../engine/ReflectionProbe.js';
import { K5, k5Site } from './landmarks.js';

/** The rings: distance from the middle of the course (m), the ridge's height range (m), columns round. */
const RINGS = [
  { r: 10500, lo: 1500, hi: 2700, cols: 540, scale: 2600, seed: 3 },
  { r: 7600, lo: 700, hi: 1400, cols: 600, scale: 1800, seed: 7 },
  { r: 5300, lo: 350, hi: 800, cols: 640, scale: 1300, seed: 11 },
];
const ROWS = 14;
const DEG = Math.PI / 180;
/** (day lane) How bright the massif's back-lit rim is (see mountainMaterial): set per time of day in setTime. */
const RIM = { value: 1 };
const RIM_BY_TIME = { day: 1, dusk: 0.6, twilight: 0.3, night: 0.4 };
/**
 * (sky lane) The limestone massif: how far it is turned from the start straight's heading towards the land side
 * (degrees), its nearest distance from the start line and how far it stands clear of the course's bounds (m), its
 * depth, its span seen from the start (degrees), its crest's height (m), and its grid per tier.
 */
const MASSIF = {
  // the skyline from the start line: [degrees left of the heading, degrees above the eye] (D1, R0 addendum 2): the
  // main peak 17 left at 19, a greater shoulder further left (25 and more by 40 left), 9 under the day sun (3 right)
  // and lower beyond
  profile: [
    // (round three: read off D1 from its camera, 22 degrees left of the road, lens 46 degrees, horizon 3.6 below
    // the frame's centre) a great shoulder climbing out of the frame's left edge, a saddle at 40 left, the main
    // pyramid at 15 left (58 % across the frame) nearly as high, then the ridge falling to the right under the sun
    [-75, 3], [-40, 6], [-25, 8], [-15, 10], [-9, 11.6], [-2, 13], [5, 17], [10, 20.5], [15, 23.6], [19, 21.5],
    // (day lane) the saddle and the shoulder re-read from D1's camera: the frame's ridge left of the peak stays high
    // (about 21 degrees from 26 to 40 left, 22 at 45) and the shoulder climbs more gently out of the frame (25 at 53
    // left, 27 at 60); ours fell to 17 and rose to 29
    [26, 21], [33, 20.6], [40, 21.2], [46, 22.4], [52, 24.6], [58, 26.4], [62, 27],
    // (day lane, frame K5) beyond D1's left edge (62 left) the massif falls away: from K5's place, high over the bay,
    // its west end stands just behind the drum tower, and the sky over the sea is clear
    [68, 14], [74, 5], [95, 2],
  ],
  // (round three: the angles of the table times this; set from the D1 camera's still beside the frame, where the
  // main peak stood too low)
  lift: 1.0,
  right: -75, // the field's ends, degrees left of the heading
  left: 95,
  near: 2600, // the foot's distance from the start line, at least (m)
  clear: 900, // and its distance beyond the course's bounds
  crest: 5200, // the crest's distance (m)
  depth: 6200, // from the foot to the far edge
  cols: { low: 170, medium: 420, high: 560 },
  rows: { low: 50, medium: 110, high: 150 },
};

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 */
export function createFar({ track, terrain, caps, tier, rng, atmosphere }) {
  const started = performance.now();
  const group = new THREE.Group();
  group.name = 'far';
  const b = track.bounds;
  const mid = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const noise = planeNoise(rng.int(1 << 30));
  const lowTier = tier === 'low';

  // ---------------------------------------------------------------- mountains
  const mountainMaterial = (order, relief = false, rim = false) => {
    const m = atmosphere.patch(
      extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), `far-mountain${relief ? '-relief' : ''}`, (shader) => {
        // at the back of the depth range, in front of the sky only (see above)
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\ngl_Position.z = gl_Position.w * ( 1.0 - 1.0e-6 );',
        );
        // (sky lane) rock: the form is the geometry's and the sun's (no per-pixel bump: against a low sun its
        // derivatives broke into a stair-stepped speckle). The pixels only add a soft mottle of the stone's own
        // tone, smooth noise with no thresholds, averaged away where a pixel covers more than its scale.
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${GLSL_NOISE}\nvarying vec3 vRockWorld;`)
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  float footprint = length(fwidth(vRockWorld));
  float mottle = fbm(vRockWorld.xz / 140.0 + vRockWorld.y / 230.0, 2) - 0.5;
  diffuseColor.rgb *= 1.0 + 0.35 * mottle * smoothstep(60.0, 15.0, footprint);
  // (render lane) What makes a far mountain read as rock in haze rather than one blue-grey surface (D1): the
  // limestone in beds, pale and grey by turns, slightly dipping and warped; dark streaks where water and scree run
  // down the faces; dark specks of pine on every ledge gentle enough to hold them; all of it world-space and
  // smooth noise, faded out where a pixel covers more than its scale, so nothing shimmers. Only on bare rock (the
  // vertex colour says where: the wood below the tree line is dark green).
  vec3 gN = normalize(cross(dFdx(vRockWorld), dFdy(vRockWorld)));
  float flatness = abs(gN.y);
  float rockShare = smoothstep(0.07, 0.17, diffuseColor.g);
  float bedAt = (vRockWorld.y + 60.0 * fbm(vRockWorld.xz / 900.0, 2) + 0.05 * (vRockWorld.x + vRockWorld.z)) / 22.0;
  float bedTone = hash11(floor(bedAt) + 7.0);
  float ledge = smoothstep(0.78, 0.97, fract(bedAt));
  float beds = ((bedTone - 0.5) * 0.42 - 0.3 * ledge) * (1.0 - smoothstep(6.0, 16.0, footprint));
  // (day lane: y / 520 drew streaks the whole height of the face, a curtain; now they run a hundred metres or two)
  float streakN = fbm(vec2(dot(vRockWorld.xz, vec2(0.71, 0.7)) / 34.0, vRockWorld.y / 170.0), 3);
  float streak = smoothstep(0.56, 0.8, streakN) * (1.0 - smoothstep(5.0, 14.0, footprint));
  float pine = smoothstep(0.55, 0.85, flatness) * smoothstep(0.56, 0.7, fbm(vRockWorld.xz / 45.0, 3)) * (1.0 - smoothstep(10.0, 30.0, footprint));
  vec3 rockCol = diffuseColor.rgb * (1.0 + beds) * (1.0 - 0.28 * streak);
  rockCol = mix(rockCol, vec3(0.03, 0.045, 0.028), 0.75 * pine);
  // the gentle ground above the tree line is scree and turf, lighter, with the ledges catching the sky
  diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockShare);
}`,
          );
        if (rim) {
          // (day lane) D1's bright rim: against a sun standing behind the ridge, rock and grass seen edge-on near the
          // skyline send light forwards (the sheen of a rough surface at a grazing angle, and the haze's own glow over
          // it), so the ridges on the sun's side are drawn by a thin bright line while the faces below are in shade.
          // Only where the sun's baked light reaches, and only looking towards it. (The massif only: it needs aBake.)
          shader.uniforms.uRim = RIM;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uRim;')
            .replace(
              '#include <lights_fragment_end>',
              `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  vec3 Lv = directionalLights[0].direction;
  vec3 Vv = normalize(vViewPosition);
  float graze = 1.0 - clamp(dot(normal, Vv), 0.0, 1.0);
  float fwd = max(dot(-Vv, Lv), 0.0);
  float lift = smoothstep(-0.15, 0.35, dot(normal, Lv));
  reflectedLight.directDiffuse += directionalLights[0].color * bakedSun() * uRim * (graze * graze * graze) * (fwd * fwd * fwd * fwd) * lift * 0.3;
}
#endif`,
            );
        }
        if (relief) {
          // (render lane) the faces' relief in the light: the normal tipped by the slope of a world-space field of
          // ridges and buttresses some 60 to 200 m across (finite differences of smooth noise in world space, not
          // screen derivatives, so it does not speckle), so that under the low sun facets light up and turn away
          // between the gullies the geometry has. Faded out where a pixel covers more than the field's finest
          // scale. Medium and high only.
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
{
  float fp = length(fwidth(vRockWorld));
  float reliefFade = 1.0 - smoothstep(18.0, 45.0, fp);
  if (reliefFade > 0.0) {
    vec3 q = vRockWorld / vec3(110.0, 160.0, 110.0);
    float e = 0.08;
    float h0 = fbm(q, 3);
    vec3 g = vec3(fbm(q + vec3(e, 0.0, 0.0), 3) - h0, fbm(q + vec3(0.0, e, 0.0), 3) - h0, fbm(q + vec3(0.0, 0.0, e), 3) - h0) / e;
    vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
    gv -= normal * dot(gv, normal);
    normal = normalize(normal - 0.8 * reliefFade * gv);
  }
}`,
          );
        }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vRockWorld;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvRockWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      }),
    );
    // (sky lane) every fragment passes but still writes its depth: with the depth test switched off WebGL writes no
    // depth either, and the sky dome, drawn last into whatever is still empty, painted over every ring
    m.depthFunc = THREE.AlwaysDepth;
    m.name = `far-mountains-${order}`;
    if (rim) m.customProgramCacheKey = ((key) => () => `${key()}|rim`)(m.customProgramCacheKey.bind(m));
    return m;
  };
  // (sky lane) THE MASSIF (reference D1): one great limestone mountain ahead and to the land side of the start
  // straight, where the day's sun stands beside it. Placed from the Track (its start and its heading), on the side
  // away from the lake, far enough out to stand clear of the course.
  const start = track.frameAt(0, {});
  const head = new THREE.Vector2(start.tan.x, start.tan.z).normalize();
  const lakeBox = terrain.lake.extent;
  const toLake = new THREE.Vector2((lakeBox.x0 + lakeBox.x1) / 2 - start.pos.x, (lakeBox.z0 + lakeBox.z1) / 2 - start.pos.z);
  // across the road, on the land's side
  const landSide = new THREE.Vector2(-head.y, head.x);
  if (landSide.dot(toLake) > 0) landSide.negate();
  // (sky lane, R0 addendum 2) the massif is composed as seen from the start line looking down the road: angles are
  // measured from the straight's heading, positive towards the lake (left)
  const lakeSide = landSide.clone().negate();
  const leftSign = Math.sign(head.x * lakeSide.y - head.y * lakeSide.x) || 1; // +1: left is anticlockwise in (x, z)
  const headAngle = Math.atan2(head.y, head.x);
  const offsetCentre = (MASSIF.left + MASSIF.right) / 2;
  const massifDir = new THREE.Vector2(Math.cos(headAngle + leftSign * offsetCentre * DEG), Math.sin(headAngle + leftSign * offsetCentre * DEG));
  const reachOut = Math.max(
    ...[b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => (x - start.pos.x) * massifDir.x + (z - start.pos.z) * massifDir.y)),
  );
  const massifNear = Math.max(MASSIF.near, reachOut + MASSIF.clear);
  /** 0..1: how much a direction seen from the middle of the course lies in the massif's sector */
  const massifCentre = new THREE.Vector2(start.pos.x, start.pos.z).addScaledVector(massifDir, massifNear + MASSIF.depth * 0.45);
  const inMassif = (x, z) => {
    const v = new THREE.Vector2(x - mid.x, z - mid.z).normalize();
    const c = new THREE.Vector2(massifCentre.x - mid.x, massifCentre.y - mid.z).normalize();
    const off = Math.acos(Math.min(1, Math.max(-1, v.dot(c))));
    return Math.exp(-((off / ((MASSIF.left - MASSIF.right) * 0.45 * DEG)) ** 2));
  };

  const mountains = [];
  let mountainTriangles = 0;
  RINGS.forEach((ring, layer) => {
    const cols = lowTier ? Math.round(ring.cols * 0.4) : ring.cols;
    const pos = new Float32Array((cols + 1) * (ROWS + 1) * 3);
    const col = new Float32Array((cols + 1) * (ROWS + 1) * 3);
    const circumference = 2 * Math.PI * ring.r;
    const heights = [];
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      // the ridge: sampled round a circle in the noise's plane so it closes on itself
      const u = Math.cos(a) * (circumference / ring.scale / (2 * Math.PI));
      const v = Math.sin(a) * (circumference / ring.scale / (2 * Math.PI));
      const ridge = noise.ridged(u + ring.seed, v, 6);
      const broad = noise.fbm(u * 0.35 + ring.seed * 3, v * 0.35, 3);
      const h = ring.lo + (ring.hi - ring.lo) * Math.min(1, Math.max(0, 0.15 + 1.1 * ridge * (0.5 + broad)));
      // (sky lane) the near rings stand aside where the massif is: they would be in front of it but drawn behind
      // (all of them, round two: the farthest showed over the massif's low right-hand ridge as pale hills)
      // (sea lane) and where the sea runs to the horizon: no far shore (terrain.sea's bearings)
      const open = terrain.sea ? terrain.sea.sector(mid.x + Math.cos(a) * ring.r, mid.z + Math.sin(a) * ring.r) : 0;
      const aside = Math.max(smoothstep(0.3, 0.6, inMassif(mid.x + Math.cos(a), mid.z + Math.sin(a))), smoothstep(0.05, 0.5, open));
      heights.push(h * (1 - aside) - 300 * aside);
    }
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const top = heights[i % cols];
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS; // 0 at the foot, 1 on the ridge
        // the face recedes as it climbs (a slope of about 35 degrees), gullies cut into it
        const gully = noise.ridged((i / cols) * circumference / 260 + layer * 9, t * 3, 3);
        const y = -250 + (top + 250) * Math.pow(t, 0.9);
        const back = (top + 250) * 1.3 * (1 - (1 - t) ** 1.4) + 160 * (1 - gully) * Math.sin(Math.PI * t);
        const r = ring.r - (top + 250) * 0.8 + back;
        const v = i * (ROWS + 1) + j;
        pos[v * 3] = mid.x + ca * r;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = mid.z + sa * r;
        // rock, darker in the gullies; snow above a line that wanders, more where the face is gentle
        // (sky lane, round two) wooded hills with bare rock above a ragged tree line; snow only on the farthest
        // ring's highest ground, and there only in the gullies (patches, not caps)
        const treeLine = 1050 + 350 * (noise.fbm(i * 0.04 + layer * 5, 1.5, 3) - 0.5) + 250 * (gully - 0.5);
        const wood = 1 - smoothstep(treeLine - 60, treeLine + 60, y);
        const snow = layer === 0 ? smoothstep(0.7 * ring.hi, 0.85 * ring.hi, y) * smoothstep(0.45, 0.8, 1 - gully) * 0.8 : 0;
        const rock = 0.15 + 0.06 * gully + 0.03 * noise.fbm(i * 0.3, j * 0.7, 2);
        const canopy = 0.03 + 0.012 * noise.fbm(i * 0.21 + layer, j * 0.5, 2);
        // clearings and fields low down, the odd pale crag breaking through the wood
        const field = smoothstep(0.62, 0.72, noise.fbm(i * 0.11 + layer * 3, j * 0.2 + 7, 3)) * (1 - smoothstep(150, 450, y));
        const crag = smoothstep(0.7, 0.8, noise.fbm(i * 0.37 + 11, j * 0.6 + layer, 2)) * smoothstep(250, 600, y) * wood;
        const green = [canopy, canopy * 1.45, canopy * 0.8].map((c, k) => c * (1 - field) + [0.07, 0.09, 0.04][k] * field);
        const base = [rock, rock * 0.97, rock * 0.92].map((c, k) => c * (1 - wood) + (green[k] * (1 - crag) + c * crag) * wood);
        col[v * 3] = base[0] + (0.72 - base[0]) * snow;
        col[v * 3 + 1] = base[1] + (0.75 - base[1]) * snow;
        col[v * 3 + 2] = base[2] + (0.8 - base[2]) * snow;
      }
    }
    const index = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < ROWS; j++) {
        const v = i * (ROWS + 1) + j;
        const w = v + ROWS + 1;
        // faces towards the middle (seen from inside the ring)
        index.push(v, v + 1, w, w, v + 1, w + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // which way is in: make sure the normals face the middle (flip if the winding came out the other way)
    {
      const n = geometry.attributes.normal;
      const p = geometry.attributes.position;
      const dx = mid.x - p.getX(ROWS);
      const dz = mid.z - p.getZ(ROWS);
      if (n.getX(ROWS) * dx + n.getZ(ROWS) * dz < 0) {
        for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
        geometry.setIndex(index);
        geometry.computeVertexNormals();
      }
    }
    mountainTriangles += index.length / 3;
    const mesh = new THREE.Mesh(geometry, mountainMaterial(layer));
    mesh.name = `far-mountains-${layer}`;
    mesh.renderOrder = -30 + layer; // the farthest first
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    mountains.push(mesh);
  });

  // ---------------------------------------------------------------- the massif
  // A height field on a polar grid round the start: columns across the massif's span, rows outwards. Its crest
  // runs across the middle of its depth; ridged noise cuts spurs, gullies and crisp arêtes into it, and the vertex
  // normals are what make it read: faces turned to the sun are lit, the rest stands in the sky's blue light. It is
  // drawn like the rings (at the back of the depth range, every fragment passing), its rows farthest first, so
  // that the nearer spurs paint over what lies behind them.
  let massifTriangles = 0;
  {
    const cols = MASSIF.cols[tier] ?? MASSIF.cols.high;
    const rows = MASSIF.rows[tier] ?? MASSIF.rows.high;
    const n = (cols + 1) * (rows + 1);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const at = (i, j) => j * (cols + 1) + i;
    const crestNoise = planeNoise(rng.int(1 << 30));
    // (sky lane, R0 addendum 2: "the whole exact screenshot") The crest is drawn to D1's skyline as seen from the
    // start line: PROFILE gives, for an angle off the road's heading (degrees, + left), how high the crest stands
    // (degrees above the eye). The crest lies CREST metres out (give or take); in front of it a steep face falls to
    // the foot, cut by gullies that run straight down it (ridged noise across the face, stretched down it), with
    // spurs between them; behind it the land falls away. The low sun behind it draws the form.
    const span = MASSIF.left - MASSIF.right;
    const eyeY = start.pos.y + 1.5;
    const profile = (o) => {
      const P = MASSIF.profile;
      if (o <= P[0][0]) return P[0][1];
      for (let k = 1; k < P.length; k++) {
        if (o <= P[k][0]) {
          const t = (o - P[k - 1][0]) / (P[k][0] - P[k - 1][0]);
          const e = t * t * (3 - 2 * t);
          return P[k - 1][1] + (P[k][1] - P[k - 1][1]) * e;
        }
      }
      return P[P.length - 1][1];
    };
    for (let j = 0; j <= rows; j++) {
      const v = j / rows; // 0 at the far edge, 1 at the near edge: rows are laid out far first
      const r = massifNear + MASSIF.depth * (1 - v);
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const o = MASSIF.right + u * span; // degrees left of the heading
        const a = headAngle + leftSign * o * DEG;
        const x = start.pos.x + Math.cos(a) * r;
        const z = start.pos.z + Math.sin(a) * r;
        // the crest: where it lies, and how high, with a little jag of its own so the skyline is not a curve
        const crestR = MASSIF.crest * (1 + 0.12 * (crestNoise.fbm(o * 0.06 + 3, 0.7, 3) - 0.5));
        // (the jag is smooth and only touches the top of the face: a jag that changed from column to column tilted
        // whole columns of the face and striped it like a curtain in a raking light)
        // (day lane: 0.1 and 0.03 cut the skyline into a row of little spikes; D1's ridge is a few big forms)
        const jag = 0.07 * (crestNoise.ridged(o * 0.22 + 1, 2.3, 3) - 0.5) + 0.012 * (crestNoise.ridged(o * 0.9 + 4, 1.1, 2) - 0.5);
        const crestH = eyeY + crestR * Math.tan(profile(o) * MASSIF.lift * DEG);
        // gullies across the face (about one per 1.5 degrees, i.e. 150 m), wandering, deeper low on the face
        const along = (o * DEG * crestR) / 160;
        // (warped, so they wander and fork instead of hanging like a curtain)
        const down = (crestR - r) / 1400;
        const warp = 1.6 * (crestNoise.fbm(along * 0.12 + 5, down * 1.3, 3) - 0.5);
        // (day lane) the gullies change as they run down (down * 2.2, was 1): they fork and end instead of hanging
        // the whole height of the face as a curtain
        const g = crestNoise.ridged(along * 0.5 + 7 + warp, down * 2.2 + 0.4 * warp, 4);
        const fine = crestNoise.ridged(along * 1.7 + 2, (crestR - r) / 300, 3);
        // (day lane) buttresses: a few great spurs, 600 to 1000 m apart, that stand out of the face towards the
        // valley with deep hollows between them, so that their flanks turn towards the low sun or away from it (D1's
        // ribs, lit on the right and dark on the left)
        const spur = crestNoise.ridged(along * 0.17 + 3 + 0.5 * warp, down * 0.6 + 11, 3);
        let y;
        if (r <= crestR) {
          const t = Math.max(0, (r - massifNear) / (crestR - massifNear)); // 0 at the foot, 1 at the crest
          const face = t ** 1.7 * 0.82 + 0.18 * t;
          // the gullies bite deepest mid-face and fade out at the crest, so the ridge line stays whole
          const cut = 1 - (0.13 * (1 - g) + 0.04 * (1 - fine) + 0.2 * (1 - spur)) * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7;
          y = -60 + (crestH + 60) * face * cut * (1 + jag * t ** 3);
        } else {
          const t = Math.min(1, (r - crestR) / 2600);
          y = -60 + (crestH + 60) * (1 + jag) * (1 - 0.55 * t * t) * (0.94 + 0.06 * g);
        }
        // the ends of the field fade into the land, so it never ends in a wall
        const edge = smoothstep(0, 0.06, u) * smoothstep(1, 0.94, u) * smoothstep(1, 0.92, v);
        // (sea lane, round 2) where the column's bearing from the course's middle is wholly the sea's (its far end on
        // the land side, 60 to 75 degrees off the straight: outside frame D1, which sees -13 to 63) it sinks under the
        // horizon: from the coast road (frame E1) it stood across the open sea as a far shore
        const sink = terrain.sea ? smoothstep(0.85, 1, terrain.sea.sector(start.pos.x + Math.cos(a) * MASSIF.crest, start.pos.z + Math.sin(a) * MASSIF.crest)) : 0;
        y = -60 + (y + 60) * edge * (1 - sink);
        const p = at(i, j);
        pos[p * 3] = x;
        pos[p * 3 + 1] = y;
        pos[p * 3 + 2] = z;
      }
    }
    const index = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const p = at(i, j);
        const q = at(i, j + 1);
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // make sure the normals point up
    const flipped = geometry.attributes.normal.getY(at(cols >> 1, rows >> 1)) < 0;
    if (flipped) {
      for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
      geometry.setIndex(index);
      geometry.computeVertexNormals();
    }
    // Sun and moon on the massif (shading.js, aBake): each vertex marches over the massif's own height field
    // towards the light, so the gullies and the faces under the crests lie in the shadow of the ridges, and the
    // sky's share falls in the hollows.
    const heightAt = (x, z) => {
      const dx = x - start.pos.x, dz = z - start.pos.z;
      let da = Math.atan2(dz, dx) - headAngle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const fu = ((leftSign * da) / DEG - MASSIF.right) / span * cols;
      const fv = (1 - (Math.hypot(dx, dz) - massifNear) / MASSIF.depth) * rows;
      if (fu < 0 || fv < 0 || fu >= cols || fv >= rows) return -Infinity;
      const i = Math.floor(fu), j = Math.floor(fv), a = fu - i, c = fv - j;
      const h = (ii, jj) => pos[at(ii, jj) * 3 + 1];
      return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - c) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * c;
    };
    const lit = (x, y, z, dir) => {
      if (dir[1] <= 0.01) return 0;
      const flat = Math.hypot(dir[0], dir[2]);
      let open = 1;
      for (let d = 30; d < 6000; d *= 1.12) {
        const above = y + 6 + (d * dir[1]) / flat - heightAt(x + (dir[0] / flat) * d, z + (dir[2] / flat) * d);
        open = Math.min(open, smoothstep(-25, 25, above));
        if (open <= 0) break;
      }
      return open;
    };
    // (w: the golden hour's low sun, the channel shading.js reads at dusk)
    const bake = new Float32Array(n * 4);
    for (let p = 0; p < n; p++) {
      const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
      bake[p * 4] = lit(x, y, z, TIMES.day.sun.dir);
      bake[p * 4 + 1] = lit(x, y, z, TIMES.night.sun.dir);
      bake[p * 4 + 2] = 0.55 + 0.45 * geometry.attributes.normal.getY(p);
      bake[p * 4 + 3] = TIMES.dusk ? lit(x, y, z, TIMES.dusk.sun.dir) : 1;
    }
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    // Colour by height and slope: forest up to a ragged tree line, scrub and pale scree above it on the gentler
    // ground, bare limestone on the steep faces and the crests, darker in the gullies.
    const nrm = geometry.attributes.normal;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const p = at(i, j);
        const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
        const up = nrm.getY(p);
        const steep = smoothstep(0.82, 0.55, up);
        const treeLine = 620 + 260 * crestNoise.fbm(x / 900, z / 900, 3);
        const forest = smoothstep(treeLine + 60, treeLine - 80, y) * (1 - 0.7 * steep);
        const scree = smoothstep(0.6, 0.85, up) * (1 - forest) * smoothstep(treeLine - 50, treeLine + 250, y);
        const stain = 0.85 + 0.3 * crestNoise.fbm(x / 160, z / 260, 3);
        // (round three: pale limestone, darker in the gullies and on the ledges)
        // (day lane) darker (0.3 was a mid-grey mass against D1's deep blue-grey shade), the ribs paler than the
        // gullies between them, and pale fans of scree where the gullies open onto the gentler ground at the foot
        const rr = massifNear + MASSIF.depth * (1 - j / rows);
        const along = ((MASSIF.right + (i / cols) * span) * DEG * MASSIF.crest) / 160;
        const gully = crestNoise.ridged(along * 0.5 + 7, (MASSIF.crest - rr) / 640, 3);
        const rib = 0.55 + 0.9 * gully * gully;
        const lime = [0.19 * stain * rib, 0.19 * stain * rib, 0.188 * stain * rib];
        const fan = smoothstep(0.72, 0.9, up) * smoothstep(treeLine - 220, treeLine - 40, y) * smoothstep(treeLine + 260, treeLine + 60, y) * smoothstep(0.55, 0.25, gully);
        const scr = [0.3, 0.295, 0.28];
        const green = [0.026, 0.038, 0.022];
        const c = lime.map((l, k) => l * (1 - Math.max(scree, fan)) + scr[k] * Math.max(scree, fan));
        for (let k = 0; k < 3; k++) col[p * 3 + k] = c[k] * (1 - forest) + green[k] * forest;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    massifTriangles = index.length / 3;
    const mesh = new THREE.Mesh(geometry, withBake(mountainMaterial(3, !lowTier, true)));
    mesh.name = 'far-massif';
    mesh.renderOrder = -26; // after the rings: it stands in front of them
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    mountains.push(mesh);
    // (picture lane) What the cars' reflection probes draw instead: the same vertices on every other column and
    // row, a quarter of the triangles. A probe's face is 64 to 256 texels across 90 degrees: the massif is a band a
    // few texels high in it, and the full grid only cost its triangles (some 90 thousand a face on medium).
    const coarse = [];
    for (let j = 0; j < rows; j += 2) {
      const j1 = Math.min(rows, j + 2);
      for (let i = 0; i < cols; i += 2) {
        const i1 = Math.min(cols, i + 2);
        const p = at(i, j);
        const q = at(i, j1);
        const a = at(i1, j);
        const b = at(i1, j1);
        if (flipped) coarse.push(p, a, q, a, b, q);
        else coarse.push(p, q, a, a, q, b);
      }
    }
    const probeGeometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) probeGeometry.setAttribute(name, attribute);
    probeGeometry.setIndex(coarse);
    const probeMesh = new THREE.Mesh(probeGeometry, mesh.material);
    probeMesh.name = 'far-massif-probe';
    probeMesh.renderOrder = mesh.renderOrder;
    probeMesh.frustumCulled = false;
    probeMesh.matrixAutoUpdate = false;
    probeMesh.layers.set(PROBE_LAYER);
    // the full grid draws nothing for a probe's camera (it is on layer 0, which every camera sees)
    const full = index.length;
    mesh.onBeforeRender = (_r, _s, camera) => geometry.setDrawRange(0, camera.layers.isEnabled(PROBE_LAYER) ? 0 : full);
    group.add(probeMesh);
    mountains.push(probeMesh);
  }

  // ---------------------------------------------------------------- the far cones (frame K5)
  // (day lane) Across the open sea from K5's place (landmarks.js K5, k5Site), 14 to 17 km out: a long low range
  // with three volcano-like cones on it, snow on their upper flanks. Built like a ring (a strip of faces from below
  // the sea's horizon up to a crest, facing the place, drawn at the back of the depth range before the rings): at dusk
  // a dark blue silhouette under the horizon's band, by day blue in the thin air with white tops.
  let conesTriangles = 0;
  const k5 = k5Site(track);
  if (k5) {
    const B0 = K5.view[0] + 10;
    const B1 = K5.view[1] + 15;
    const cols = lowTier ? 90 : 220;
    const rows = lowTier ? 6 : 10;
    const cn = planeNoise(rng.int(1 << 30));
    const crestAt = (b) => {
      let ridge = 260 + 220 * cn.fbm(b * 0.09 + 3, 0.4, 3) + 60 * (cn.ridged(b * 0.4 + 1, 2.2, 3) - 0.5);
      let dist = 15500;
      let cone = 0;
      for (const c of K5.cones) {
        const off = (Math.abs(b - c.bearing) * DEG) * c.dist; // metres across from the cone's axis
        const q = off / c.r;
        // a cone with straight flanks, a slightly blunt top (an old crater), steeper near the top
        const h = c.h * Math.max(0, 1 - q) ** 1.25 * (1 - 0.05 * Math.exp(-((q / 0.06) ** 2)));
        if (h > cone) { cone = h; dist = c.dist; }
      }
      ridge *= smoothstep(B0, B0 + 12, b) * smoothstep(B1, B1 - 12, b);
      return { y: Math.max(ridge, cone), cone, dist };
    };
    const n = (cols + 1) * (rows + 1);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i <= cols; i++) {
      const b = B0 + ((B1 - B0) * i) / cols;
      const c = crestAt(b);
      const sb = Math.sin(b * DEG);
      const cb = Math.cos(b * DEG);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows; // 0 at the foot (under the horizon), 1 on the crest
        const y = -80 + (c.y + 80) * t ** 0.85;
        const r = c.dist - (c.y + 80) * 1.6 * (1 - t);
        const v = (i * (rows + 1) + j) * 3;
        pos[v] = k5.x + sb * r;
        pos[v + 1] = y;
        pos[v + 2] = k5.z + cb * r;
        // dark rock and scrub; snow on a cone's upper third, ragged
        const snow = c.cone > 600 ? smoothstep(0.6, 0.72, y / c.cone + 0.08 * (cn.fbm(b * 2.1, t * 3, 2) - 0.5)) : 0;
        const base = 0.05 + 0.02 * cn.fbm(b * 0.7, t * 2 + 5, 2);
        col[v] = base * 0.9 + (0.74 - base * 0.9) * snow;
        col[v + 1] = base + (0.76 - base) * snow;
        col[v + 2] = base * 1.1 + (0.8 - base * 1.1) * snow;
      }
    }
    const index = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const v = i * (rows + 1) + j;
        const w = v + rows + 1;
        index.push(v, v + 1, w, w, v + 1, w + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // facing the place
    {
      const nr = geometry.attributes.normal;
      const k = (cols >> 1) * (rows + 1) + (rows >> 1);
      if (nr.getX(k) * (k5.x - pos[k * 3]) + nr.getZ(k) * (k5.z - pos[k * 3 + 2]) < 0) {
        for (let q = 0; q < index.length; q += 3) [index[q + 1], index[q + 2]] = [index[q + 2], index[q + 1]];
        geometry.setIndex(index);
        geometry.computeVertexNormals();
      }
    }
    conesTriangles = index.length / 3;
    const mesh = new THREE.Mesh(geometry, mountainMaterial(4));
    mesh.name = 'far-cones';
    mesh.renderOrder = -31; // the farthest of all
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    mountains.push(mesh);
  }

  // ---------------------------------------------------------------- mist
  const shared = {
    uTime: { value: 0 },
    uMistColor: { value: new THREE.Vector3() },
    uMistOpacity: { value: 0.6 },
    uLightColor: { value: new THREE.Vector3() },
    uFlicker: { value: 0 },
  };
  const hazeUniforms = atmosphere.uniforms;
  const spot = { index: -1, s: 0, lat: 0 };
  const mistRng = rng.fork('mist');
  const sheets = [];
  {
    // low ground outside the course, well away from the road, and the far end of the lake
    const tries = 160;
    for (let k = 0; k < tries && sheets.length < 9; k++) {
      const a = mistRng.range(0, Math.PI * 2);
      const r = mistRng.range(700, 2600);
      const x = mid.x + Math.cos(a) * r;
      const z = mid.z + Math.sin(a) * r * 0.9;
      const h = terrain.heightAt(x, z);
      track.locate(x, z, -1, spot);
      if (Math.abs(spot.lat) < 260) continue;
      if (h > 60) continue;
      // (sea lane) not over the open sea, where from the coast road a sheet read as a blot on the water
      if (terrain.sea && terrain.sea.at(x, z) > 0.3) continue;
      if (sheets.some((s) => Math.hypot(s.x - x, s.z - z) < 500)) continue;
      sheets.push({ x, z, y: Math.max(terrain.lake.level, h) + mistRng.range(14, 30), radius: mistRng.range(380, 650) });
    }
    const ext = terrain.lake.extent;
    sheets.push({ x: (ext.x0 + ext.x1) / 2, z: ext.z0 + 120, y: terrain.lake.level + 9, radius: 420 });
  }
  let mistMesh = null;
  {
    const pos = [];
    const depth = [];
    const index = [];
    const RES = lowTier ? 10 : 16;
    for (const sheet of sheets) {
      const base = pos.length / 3;
      for (let j = 0; j <= RES; j++) {
        for (let i = 0; i <= RES; i++) {
          const x = sheet.x + ((i / RES) * 2 - 1) * sheet.radius;
          const z = sheet.z + ((j / RES) * 2 - 1) * sheet.radius;
          const edge = 1 - smoothstep(0.55, 1, Math.hypot(i / RES - 0.5, j / RES - 0.5) * 2);
          const under = terrain.heightAt(x, z);
          pos.push(x, sheet.y, z);
          // how deep the sheet is over the ground here, scaled to 0..1, times the falloff to its rim
          depth.push(smoothstep(0, 22, sheet.y - Math.max(under, terrain.lake.level)) * edge);
        }
      }
      for (let j = 0; j < RES; j++) {
        for (let i = 0; i < RES; i++) {
          const v = base + j * (RES + 1) + i;
          index.push(v, v + RES + 1, v + 1, v + 1, v + RES + 1, v + RES + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      defines: targetDefines(caps),
      uniforms: { ...hazeUniforms, ...shared },
      vertexShader: /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vWorld;
void main() {
  vDepth = aDepth;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: /* glsl */ `
${GLSL_HASH}
${GLSL_NOISE}
${GLSL_TARGET}
${ATMOSPHERE_PARS}
uniform float uTime;
uniform vec3 uMistColor;
uniform float uMistOpacity;
varying float vDepth;
varying vec3 vWorld;
void main() {
  vec3 ray = vWorld - cameraPosition;
  vec3 dir = normalize(ray);
  vec2 p = vWorld.xz / 190.0 + vec2(uTime * 0.0021, uTime * 0.0009);
  float n = valueNoise(p) * 0.55 + valueNoise(p * 2.7 + 3.1) * 0.3 + valueNoise(p * 7.1 - uTime * 0.004) * 0.15;
  float thick = vDepth * smoothstep(0.32, 0.75, n);
  // through a thin sheet the light crosses more of it the flatter it is seen, but a sheet seen from its own
  // height would show as a plane: it fades away there
  float slant = max(abs(dir.y), 0.04);
  float a = (1.0 - exp(-thick * 0.35 / slant)) * uMistOpacity;
  a *= smoothstep(6.0, 40.0, abs(ray.y)) * smoothstep(60.0, 260.0, length(ray));
  if (a < 0.003) discard;
  vec3 col = throughHaze(uMistColor, cameraPosition, vWorld);
  gl_FragColor = toTarget(vec4(col, a));
}`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    material.name = 'far-mist';
    mistMesh = new THREE.Mesh(geometry, material);
    mistMesh.name = 'far-mist';
    mistMesh.renderOrder = 10;
    mistMesh.matrixAutoUpdate = false;
    group.add(mistMesh);
  }

  // ---------------------------------------------------------------- the town by the lake
  // (look lane) A small town on the lake's far shore, climbing the lower slope behind it, and a hamlet high on the
  // slope beyond it (seen from the hairpins, which the town is hidden from): what the descent, the summit and the hairpins look out over at night (look reference B's city, here
  // a few hundred lamps). Its streets run along the slope (level, as streets on a hillside do) and down it to the
  // water; a promenade of lamps lines the shore, and the lake mirrors them (the second cloud of points below).
  // Placed where the most of those views see it (worked out against the height field when it was laid out).
  const lightRng = rng.fork('village');
  const lights = [];
  const level = terrain.lake.level;
  const ext = terrain.lake.extent;
  const lakeMid = { x: (ext.x0 + ext.x1) / 2, z: (ext.z0 + ext.z1) / 2, rx: (ext.x1 - ext.x0) / 2.2, rz: (ext.z1 - ext.z0) / 2.2 };
  const TOWN = { x: -170, z: -760, rx: 520, rz: 260, top: 175 };
  const HAMLET = { x: 200, z: -1430, rx: 150, rz: 90, top: 520 };
  const share = tier === 'low' ? 0.45 : tier === 'medium' ? 0.75 : 1;
  const village = { x: TOWN.x, z: TOWN.z, h: Math.max(level + 2, terrain.heightAt(TOWN.x, TOWN.z)) };
  const SODIUM = [1, 0.5, 0.16];
  const WARM = [1, 0.8, 0.55];
  const COOL = [0.72, 0.84, 1.0];
  const lampColour = () => {
    const r = lightRng.next();
    return r < 0.5 ? SODIUM : r < 0.8 ? WARM : COOL;
  };
  /** A lamp or a window at (x, z) if the ground there is dry land below the place's top; returns whether it was put. */
  const put = (place, x, z, rise, c, i, kind) => {
    const h = terrain.heightAt(x, z);
    if (h < level + 0.6 || h > place.top) return false;
    lights.push({ x, y: h + rise, z, c, i, kind });
    return true;
  };
  for (const [place, density] of [[TOWN, 1], [HAMLET, 0.35]]) {
    // streets along the slope: walk from a seed along the level (the gradient's normal), lamps every 30 m or so
    const streets = Math.round(21 * density);
    for (let st = 0; st < streets; st++) {
      let x = place.x + lightRng.range(-1, 1) * place.rx;
      let z = place.z + lightRng.range(-1, 1) * place.rz;
      let heading = lightRng.sign();
      const steps = 4 + lightRng.int(9);
      for (let k = 0; k < steps; k++) {
        const e = ((x - place.x) / place.rx) ** 2 + ((z - place.z) / place.rz) ** 2;
        if (e > 1.3) break;
        // closer together in the middle of town
        if (lightRng.next() < share * (1.15 - 0.6 * e)) {
          if (put(place, x, z, 6, lampColour(), lightRng.range(0.7, 1.2), 'street')) {
            // a window or two beside it, warm
            for (let w = 0; w < 3; w++) {
              if (lightRng.next() > 0.4 * share) continue;
              put(place, x + lightRng.range(-14, 14), z + lightRng.range(-14, 14), lightRng.range(3, 9), lightRng.next() < 0.8 ? [1, 0.7, 0.42] : COOL, lightRng.range(0.2, 0.45), 'window');
            }
          }
        }
        const h0 = terrain.heightAt(x, z);
        const gx = terrain.heightAt(x + 8, z) - h0;
        const gz = terrain.heightAt(x, z + 8) - h0;
        const g = Math.hypot(gx, gz) || 1;
        // along the level, with a little wander; now and then a street that climbs
        const climb = k % 5 === 4 ? 0.8 : 0.1;
        let dx = (-gz / g) * heading + (gx / g) * climb * lightRng.range(-1, 1);
        let dz = (gx / g) * heading + (gz / g) * climb * lightRng.range(-1, 1);
        const n = Math.hypot(dx, dz) || 1;
        x += (dx / n) * lightRng.range(24, 34);
        z += (dz / n) * lightRng.range(24, 34);
      }
    }
  }
  // the promenade: lamps along the waterline in front of the town, every 25 m where there is shore
  for (let a = -0.85; a <= 0.85; a += 0.012) {
    // walk outwards from the lake's middle until dry land
    const ang = -Math.PI / 2 + a * 1.4;
    for (let f = 0.8; f < 1.5; f += 0.01) {
      const x = lakeMid.x + Math.cos(ang) * lakeMid.rx * f;
      const z = lakeMid.z + Math.sin(ang) * lakeMid.rz * f;
      const h = terrain.heightAt(x, z);
      if (h < level + 0.8) continue;
      if (((x - TOWN.x) / (TOWN.rx * 1.25)) ** 2 + ((z - TOWN.z) / (TOWN.rz * 2)) ** 2 < 1 && lightRng.next() < 0.85 * share + 0.15) {
        lights.push({ x, y: h + 5, z, c: lightRng.next() < 0.7 ? SODIUM : WARM, i: 1.1, kind: 'shore' });
      }
      break;
    }
  }
  // a few brighter ones: floodlit squares, a petrol station's canopy; a church tower; a radio mast on the slope above
  for (let k = 0; k < 8; k++) put(TOWN, TOWN.x + lightRng.range(-0.8, 0.8) * TOWN.rx, TOWN.z + lightRng.range(-0.6, 0.6) * TOWN.rz, 8, k % 3 ? WARM : COOL, lightRng.range(2.5, 4), 'bright');
  put(TOWN, TOWN.x + 60, TOWN.z + 40, 32, [1, 0.85, 0.6], 3.5, 'church');
  {
    // the mast stands on the first high ground behind the town
    let mx = TOWN.x - 120;
    let mz = TOWN.z - TOWN.rz;
    for (let k = 0; k < 20 && terrain.heightAt(mx, mz) < TOWN.top + 40; k++) mz -= 25;
    lights.push({ x: mx, y: terrain.heightAt(mx, mz) + 70, z: mz, c: [1, 0.06, 0.03], i: 5, kind: 'mast' });
    lights.push({ x: mx, y: terrain.heightAt(mx, mz) + 38, z: mz, c: [1, 0.06, 0.03], i: 3, kind: 'mast' });
  }
  // two lit windows far apart on the slopes (farms)
  for (let k = 0; k < 40; k++) {
    const a = lightRng.range(0, Math.PI * 2);
    const r = lightRng.range(900, 1800);
    const x = mid.x + Math.cos(a) * r;
    const z = mid.z + Math.sin(a) * r;
    track.locate(x, z, -1, spot);
    const h = terrain.heightAt(x, z);
    if (Math.abs(spot.lat) < 300 || h < 40 || h > 250) continue;
    lights.push({ x, y: h + 3, z, c: [1, 0.7, 0.4], i: 0.4, kind: 'farm' });
    if (lights.filter((l) => l.kind === 'farm').length >= 2) break;
  }
  const lakeUniform = { value: new THREE.Vector4(lakeMid.x, lakeMid.z, lakeMid.rx, lakeMid.rz) };
  const levelUniform = { value: level };
  const makeLights = (mirror) => {
    const n = lights.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 4);
    lights.forEach((l, k) => {
      pos.set([l.x, l.y, l.z], k * 3);
      col.set([l.c[0] * l.i, l.c[1] * l.i, l.c[2] * l.i, lightRng.next()], k * 4);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aLight', new THREE.BufferAttribute(col, 4));
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      defines: { ...targetDefines(caps), ...(mirror ? { LAKE_MIRROR: 1 } : {}) },
      uniforms: { ...hazeUniforms, ...shared, uRadiance: { value: 0 }, uPixel: { value: 1 }, uLake: lakeUniform, uLevel: levelUniform },
      vertexShader: /* glsl */ `
attribute vec4 aLight;
uniform float uTime;
uniform float uRadiance;
uniform float uPixel;
uniform vec4 uLake;
uniform float uLevel;
varying vec3 vColor;
${GLSL_HASH}
${GLSL_NOISE}
${ATMOSPHERE_PARS}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float gain = 1.0;
#ifdef LAKE_MIRROR
  // The lake mirrors the lamp: its reflection lies where the line from the eye to the lamp's mirror image (as far
  // under the water as the lamp is above it) meets the water. Drawn a hair nearer than the water on that line, so
  // it wins against the lake and loses against the land in front. Only over the lake (its ellipse), only with the
  // eye above the water, and dimmed: water at a glancing angle, broken by ripples.
  vec3 m = vec3(w.x, 2.0 * uLevel - w.y, w.z);
  float above = cameraPosition.y - uLevel;
  float t = above / max(cameraPosition.y - m.y, 1.0e-3);
  vec3 p = cameraPosition + (m - cameraPosition) * t * 0.995;
  vec2 e = (p.xz - uLake.xy) / uLake.zw;
  gain = 0.35 * step(dot(e, e), 0.92) * step(0.5, above);
  w.xyz = p;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
  // a lamp a kilometre or two away covers less than a pixel: its light is spread over a fixed small spot, and
  // its brightness goes with the inverse square of the distance relative to 1 km
  float d = length(w.xyz - cameraPosition);
  float shimmer = 1.0 + 0.22 * (valueNoise(vec2(uTime * 6.0, aLight.w * 97.0)) - 0.5) * smoothstep(300.0, 1500.0, d);
#ifdef LAKE_MIRROR
  shimmer = 0.6 + 0.8 * valueNoise(vec2(uTime * 1.3, aLight.w * 61.0));
#endif
  vec3 c = aLight.rgb * uRadiance * gain * shimmer * clamp(1.0e6 / (d * d), 0.0, 25.0);
  // through the air: dimmed by the haze between (its own glow is too faint to matter)
  vColor = c * (1.0 - hazeBetween(cameraPosition.y, w.xyz - cameraPosition));
#ifdef LAKE_MIRROR
  gl_PointSize = 7.0 * uPixel;
#else
  gl_PointSize = 3.0 * uPixel;
#endif
}`,
      fragmentShader: /* glsl */ `
${GLSL_TARGET}
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
#ifdef LAKE_MIRROR
  // a short upright streak (point sprites are square: the streak is drawn inside one)
  float spot = exp(-q.x * q.x * 22.0 - q.y * q.y * 1.6) * 2.3;
#else
  float spot = exp(-dot(q, q) * 3.0);
#endif
  gl_FragColor = toTarget(vec4(vColor * spot, 1.0));
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    material.name = mirror ? 'far-lights-lake' : 'far-lights';
    const points = new THREE.Points(geometry, material);
    points.name = material.name;
    points.renderOrder = 11;
    points.matrixAutoUpdate = false;
    if (mirror) points.frustumCulled = false;
    return points;
  };
  const lightPoints = makeLights(false);
  // the lake's reflection of them (not on the low tier)
  const lakePoints = lowTier ? null : makeLights(true);
  if (lakePoints) group.add(lakePoints);
  group.add(lightPoints);

  // the glow of the village on the air over it: a soft card that always faces the camera
  const glow = (() => {
    const material = new THREE.ShaderMaterial({
      defines: targetDefines(caps),
      uniforms: { uGlow: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * (centre + vec4(position.xy, 0.0, 0.0));
}`,
      fragmentShader: /* glsl */ `
${GLSL_TARGET}
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  float g = exp(-vUv.x * vUv.x * 3.0 - max(vUv.y, -0.2) * max(vUv.y, -0.2) * 5.0) * smoothstep(-1.0, -0.2, vUv.y);
  gl_FragColor = toTarget(vec4(uGlow * g, 1.0));
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1700, 460), material);
    mesh.position.set(village.x, village.h + 140, village.z);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;
    mesh.name = 'far-glow';
    return mesh;
  })();
  group.add(glow);

  return {
    group,
    stats: { mountainTriangles, massifTriangles, conesTriangles, massif: { near: Math.round(massifNear), x: Math.round(massifCentre.x), z: Math.round(massifCentre.y) }, sheets: sheets.length, lights: lights.length, village: { x: Math.round(village.x), z: Math.round(village.z) }, ms: Math.round(performance.now() - started) },
    setTime(time) {
      const night = time.name === 'night';
      // (look lane) the far ranges by moonlight: snow under a three-quarter moon read as dusk at the night's exposure;
      // reference B's far hills are near black, so they are let down to a dim silhouette
      for (const mesh of mountains) mesh.material.color.setScalar(night ? 0.15 : 1);
      RIM.value = RIM_BY_TIME[time.name] ?? 1;
      // the mist: lit from above by the sun or moon and the sky, albedo about 0.8
      const e = time.sun.intensity * Math.max(0.1, time.sun.dir[1]) + Math.PI * (0.7 * time.sky.zenith[1] + 0.3 * time.sky.horizon[1]) * 1.2;
      const s = (0.8 * e) / Math.PI;
      shared.uMistColor.value.set(s * (0.75 + 0.25 * time.sun.color[0]), s * (0.8 + 0.2 * time.sun.color[1]), s * (0.85 + 0.15 * time.sun.color[2]));
      // (day lane: 0.65 by day laid a pale sheet like snow over the valley seen from the ledge's bend, frame D3)
      shared.uMistOpacity.value = night ? 0.15 : time.name === 'dusk' ? 0.45 : time.name === 'twilight' ? 0.25 : 0.35;
      const lamps = time.lamps.windows;
      lightPoints.material.uniforms.uRadiance.value = 0.6 * lamps;
      lightPoints.visible = lamps > 0;
      if (lakePoints) {
        lakePoints.material.uniforms.uRadiance.value = 0.6 * lamps;
        lakePoints.visible = lamps > 0;
      }
      // the town's light on the haze over it: a soft warm band (reference B's is a dull red-brown)
      glow.material.uniforms.uGlow.value.set(0.0032, 0.0019, 0.0011).multiplyScalar(lamps);
      glow.visible = lamps > 0;
    },
    /** @param {number} ratio the renderer's pixel ratio (the lights' spot is a few pixels across) */
    setPixelRatio(ratio) {
      lightPoints.material.uniforms.uPixel.value = ratio;
      if (lakePoints) lakePoints.material.uniforms.uPixel.value = ratio;
    },
    update(dt, simTime) {
      shared.uTime.value = simTime;
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
