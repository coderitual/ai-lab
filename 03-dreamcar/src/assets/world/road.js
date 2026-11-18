// The road: one mesh of the pavement built from the Track sample by sample,
// and the asphalt it is made of. The kerbs that stand on its margins are
// kerbs.js's.
//
// The mesh. Each row is a cross-section of the Track at one sample: the edges
// of the margin (the 1.2 m strip beyond the pavement's edge), the pavement's
// edges and a few columns between. Every vertex is track.pointAt(s, lat), the
// very surface the physics drives on, except on the margin where a kerb
// stands: there the mesh lies on the pavement's plane under the kerb, which
// kerbs.js draws exactly on track.profile(). Its outermost vertices are the
// terrain band's innermost ones (terrain.js uses the same rows), so road and
// verge meet without a crack.
//
// Conventions for whoever builds on it: `aRoad` is (lat, s, paved, open) per
// vertex: metres left of the centre line, metres from the start line (the
// last row repeats the first with s = length, so s never jumps inside a
// triangle), 1 where the strip beyond the margin is paved (tunnel, bridges),
// and how much sky is overhead.
//
// The asphalt is a circuit's: dark, fine and smooth, drawn in the fragment
// shader from (lat, s), in layers, each at the scale it belongs to:
//  - the stones (roadTextures.js): tone, height, polish and relief of the
//    wearing course, looked up twice at shifted places and blended, the
//    choice of places changing from one patch of road to the next, so the
//    texture never repeats; each stone glints on its own near the camera and
//    the mip chain's record of what it averaged away turns that into a steady
//    satin further off (no sparkle, no crawl). This is what breaks up the low
//    sun's glare: GGX at a grazing angle, its lobe drawn out towards the sun.
//  - the racing line (corridor.js): a broad polished band where every car
//    runs, darker and glossier rubber on it through the bends and into the
//    braking zones;
//  - the road's history (roadHistory.js): runs of surfacing of different ages
//    with joints between, the paver's seams along the road, patches, sealed
//    cracks, expansion joints on the decks, drains at the portals, drips, and
//    the tyre marks before the slow corner: single things placed by rule,
//    drawn exactly;
//  - paint: a solid white line inside each edge of the pavement, the start
//    line and the grid's boxes; on the pieces whose scheme (trackLayout.js
//    SCHEMES, schemes.js) asks for it a double yellow centre line too, the
//    asphalt there older, paler and more cracked, and a flush concrete strip
//    along the margin's outer side (forest lane); a few millimetres proud (it
//    catches the light along its edges), worn where tyres cross it, cut away
//    where the road was patched, full of glass beads that send a car's head
//    lamps back;
//  - the margin beyond the edge line: the same asphalt, older and dusty,
//    leaves where woods stand behind the barrier;
//  - water (world.wetness; lighting.js says how wet each time of day is). Not
//    a gloss slider: a level. The surface has a height in millimetres (the
//    crown or the banking, dips, whatever was laid proud or has sunk) and the
//    rain a level against it. Below the level by more than the stones' own
//    height, water stands: a mirror. Within the stones' height the gaps are
//    full and the tops stand clear: a broken film. Above it the asphalt is
//    damp: dark, its pores full, matt. Under the tunnel's roof it is dry but
//    for what tyres carry in.
// With a `mirror` (engine/PlanarMirror.js, medium and high tiers) the water
// shows the scene's real reflection: sharp where it stands, drawn out towards
// the viewer into long streaks where the film is broken (the mirror's own
// streaked copy). Without one the same roughness and Fresnel take the sky from
// the environment map, and the heads of the nearest lamps (`glints`, filled by
// lamps.js) are drawn as the same streaks analytically.

import * as THREE from 'three';
import { GLSL_HASH } from '../../engine/glsl.js';
import { createRng } from '../../engine/rng.js';
import { corridorOf } from './corridor.js';
import { FEATURE_CELL, GRID_SLOTS, SEAM_LAT, roadHistory } from './roadHistory.js';
import { BIG_TILE, ROUGH_GAIN, VARIANCE_GAIN, roadTextures } from './roadTextures.js';
import { BORE_UNIFORMS, WET_UNIFORMS, extend, withBake } from './shading.js';
import { GLINTS } from './lamps.js';
import { canopyOpen } from './canopy.js';
import { PIECE } from './terrain.js';
import { schemeTable } from './schemes.js';

/** The edge line: its width (m), its outer edge on the pavement's edge. */
const EDGE_LINE = 0.28;
/** (forest lane) The double yellow centre line of a scheme's pieces: each line's width (m), and its paint (linear). */
const CENTRE_LINE = { width: 0.12, yellow: [0.52, 0.33, 0.035] };
/** Columns of the mesh across the pavement, metres from the centre line (the edges are added). */
const INNER = { low: [0], medium: [4, 2, 0, -2, -4], high: [4, 2, 0, -2, -4] };
/**
 * The low sun's glare on dry asphalt (ASPHALT_SHEEN), fitted to frame D1 row by row (a hundred samples of its road
 * at the day's exposure, within 13 levels rms): a dark matt base under one GGX lobe of the stones' polished tops,
 * 0.12 `along` the line of sight and 0.18 `across` it, at a quarter (`gain`) of a plain dielectric's strength,
 * beside a quarter (`keep`) of MeshStandardMaterial's own rough lobe. The streak's length needs no long axis: at
 * a grazing angle a turn of the surface across the line of sight moves the mirrored sun far less than the same
 * turn along it, so even a round lobe is seen drawn out towards the sun; the SHORT axis along the view is what
 * keeps the far road from burning white across its whole width (the frame's is light grey there, not white).
 * Across, the frame allows 0.18 to 0.3 equally well; the narrow end is taken, so that seen from the middle of the
 * road the streak leaves dark asphalt on both sides. `grain`: how much of each stone's own tilt the lobe follows
 * (the rest sees the road's plane: one streak under the sun, broken up by the stones, not scattered into sparks).
 */
const SHEEN = { along: 0.12, across: 0.18, gain: 0.25, grain: 0.5, keep: 0.25 };
/**
 * The sky in the road (ASPHALT_SKY): seen at a glancing angle asphalt mirrors the low sky ahead as a soft broad
 * sheen (frames D3 and D4: it is what fills the shade). `gain` of the sky's own radiance at the horizon of the
 * view, falling off as (1 - cos)^`power` (a rough surface's rise is broader than a mirror's fifth power); read from
 * the environment map `blur` rough, about a normal leant `lift` towards the eye (the mirrored direction rises off
 * the horizon by twice that); `grey` of the sky's colour is lost on the way, in this sheen and in the material's
 * own share of the sky (pitted stone, not glass: the frames' asphalt is a grey a shade warm by day and a shade
 * cool at golden hour, never the sky's blue or rose); never more than `cap` (the sun's aureole is in that map: its
 * glare is the sun's own lobe's business).
 */
const SKY_SHEEN = { gain: 0.5, power: 4, blur: 0.36, lift: 0.12, grey: 0.9, cap: 1.2 };
/** Head lamp brightness (THROW in assets/car/index.js: candela-like units at the beam's peak, per lamp). */
const LAMP_LOW = 1600;
const LAMP_HIGH = 4500;
/** Up to this many cars' head lamps answered by the paint. */
const BEAMS = 2;
/** Per tier: how much of the shader runs (0: one lookup of each texture). */
const SHADER = { low: { tier: 0 }, medium: { tier: 1 }, high: { tier: 2 } };
/**
 * A lamp's head seen in wet asphalt without a mirror (GLINTS of lamps.js): a lobe about the mirrored direction,
 * `across` wide across the plane of incidence and `along` long in it (the streak; both as the length of the
 * difference of unit vectors, about radians), at `gain` of the head's radiance, less on a merely damp surface.
 */
const GLINT = { across: 0.006, along: 0.12, gain: 0.12 };
/**
 * The cars' tail lamps in the wet road, on every tier: the same lobe as GLINT, wider and longer (a tail lamp is a
 * broad source close to the road, its streak reaches from under the bumper towards the eye), `radiance` of the
 * lamp's red as the lobe sees it at the tail light, `brake` times that with the brake lamps. The mirror shows the
 * lamps themselves too small to streak: seen from under the road they are thin bars edge on.
 */
const TAIL_GLINT = { across: 0.05, along: 0.3, radiance: 1.6, brake: 3, gain: 0.6, color: [1.0, 0.03, 0.015] };
/**
 * (tunnel lane) Under the tunnel's roof the dry asphalt mirrors, softly (TUNNEL_SHEEN): the two lines of luminaires
 * (shading.js BORE_UNIFORMS: where they are and how bright), blurred `blur[0]` m across plus `blur[1]` m for every
 * metre the ray travels to them, at `gain` of the sky's sheen; and the cars' tail lamps as short broad streaks
 * (`tail`: gain against the wet road's, and the lobe's width across and along). And each car shades the road under
 * it from the box's diffuse light (`shade`: how much at most, the half length and half width of the car's plan, the
 * soft edge's width, m), as the sun's shadow map, which does not reach in, would not. And the light the pale walls
 * and ceiling send down onto it (`bounce` times the lining's radiance, shading.js uBoreGlow: what the sky's fill is
 * outside), which the cars shade too.
 */
const TUNNEL_SHEEN = { blur: [0.18, 0.06], gain: 0.5, tail: [0.35, 0.12, 0.8], shade: [0.55, 2.1, 0.8, 0.75], bounce: 5 };
/** The thin film on wet asphalt outside the puddles: how much of a puddle's mirror it shows (always streaked). */
const FILM = { share: 0.55 };

/**
 * @param {object} options
 * @param {object} options.track
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {{ bakeAt: (x: number, z: number, out: ArrayLike<number>, offset: number) => void }} options.terrain for the baked light
 * @param {number} options.rowStep one row every this many samples (the terrain band's own step)
 * @param {import('../../engine/rng.js').Rng} [options.rng]
 * @param {{ uniforms: object, texture: THREE.Texture }|null} [options.mirror] the wet road's planar reflection (its
 *   uniforms, with uMirrorPlane added: the plane as (normal, constant), and uMirrorStreak), or null for speculars
 *   and lamp glints only
 */
export function createRoad({ track, caps, tier, atmosphere, terrain, rowStep, rng = createRng(3), mirror = null }) {
  const n = track.count;
  const ds = track.ds;
  const half = track.halfWidth;
  const pave = half + track.shoulder;
  const co = corridorOf(track);
  const history = roadHistory({ track, rng: rng.fork('history'), tier });

  // ---- the mesh, in chunks of PIECE m (terrain.js: 400, 240 and 160 m by tier)
  const ACROSS = [1, pave, half, ...(INNER[tier] ?? INNER.medium), -half, -pave, -1]; // ±1: the outer columns, filled below
  const cols = ACROSS.length;
  const geometries = [];
  const pt = new THREE.Vector3();
  const frame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const rows = [];
  for (let i = 0; i < n; i += rowStep) rows.push(i);
  rows.push(n); // the lap closes on its first row again, with s = length
  const CHUNK = Math.round((PIECE[tier] ?? 160) / (ds * rowStep));
  const byte = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  for (let a = 0; a < rows.length - 1; a += CHUNK) {
    const list = rows.slice(a, Math.min(rows.length, a + CHUNK + 1));
    const count = list.length * cols;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const road = new Float32Array(count * 4);
    const along = new Float32Array(count * 4);
    const bake = new Float32Array(count * 4);
    const codeB = new Uint8Array(count * 4);
    for (let r = 0; r < list.length; r++) {
      const i = list[r] % n;
      const s = list[r] * ds;
      const pavedL = track.vergeL[i] === 0; // SURFACE.ASPHALT: paved up to the wall or the parapet
      const pavedR = track.vergeR[i] === 0;
      const lats = ACROSS.slice();
      lats[0] = pavedL ? track.edgeL[i] : pave;
      lats[cols - 1] = pavedR ? -track.edgeR[i] : -pave;
      const sw = s % track.length;
      track.frameAt(sw, frame);
      // the pavement's plane, for the margin under a kerb: the cross-section is one banked plane out to the margin's edge
      const y0 = track.pointAt(sw, 0, pt).y;
      const yL = track.pointAt(sw, half, pt).y;
      const yR = track.pointAt(sw, -half, pt).y;
      for (let k = 0; k < cols; k++) {
        const v = r * cols + k;
        track.pointAt(sw, lats[k], pt);
        const a = Math.abs(lats[k]);
        if (a > half && a <= pave + 1e-6) pt.y = y0 + ((lats[k] > 0 ? yL : yR) - y0) * (a / half);
        pt.toArray(pos, v * 3);
        // pavement and shoulder are one banked plane: its normal is the Track's own
        frame.up.toArray(nor, v * 3);
        road[v * 4] = lats[k];
        road[v * 4 + 1] = s;
        road[v * 4 + 2] = lats[k] > 0 ? (pavedL ? 1 : 0) : pavedR ? 1 : 0;
        // how much sky is over it: rain does not reach far into the tunnel
        road[v * 4 + 3] = track.sky ? track.sky[i] : 1;
        frame.tan.toArray(along, v * 4);
        along[v * 4 + 3] = co.pond[i];
        (terrain.bake4At ?? terrain.bakeAt)(pt.x, pt.z, bake, v * 4);
        // what the woods beside the road hide of the sky (canopy.js)
        bake[v * 4 + 2] *= canopyOpen(track, sw, lats[k]);
        codeB[v * 4] = byte(0.5 + co.line[i] / 8);
        codeB[v * 4 + 1] = byte(co.rubber[i]);
        codeB[v * 4 + 2] = byte(co.tongue[i]);
        codeB[v * 4 + 3] = byte(0.5 + 0.5 * co.bank[i]);
      }
    }
    const index = [];
    for (let r = 0; r < list.length - 1; r++) {
      for (let k = 0; k < cols - 1; k++) {
        const v = r * cols + k;
        // columns run from left to right: (v, v+1) points right, (v, v+cols) forward
        index.push(v, v + 1, v + cols, v + 1, v + cols + 1, v + cols);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 4));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    geometry.setAttribute('aCodeB', new THREE.BufferAttribute(codeB, 4, true));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    geometries.push(geometry);
  }

  // ---- what lies along each edge, per metre: r, g leaves left and right; b, a a kerb left and right
  const edges = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) edges.set([byte(co.leafL[i]), byte(co.leafR[i]), byte(co.kerbL[i]), byte(co.kerbR[i])], i * 4);
  const edgeTexture = new THREE.DataTexture(edges, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  edgeTexture.magFilter = edgeTexture.minFilter = THREE.LinearFilter;
  edgeTexture.wrapS = THREE.RepeatWrapping;
  edgeTexture.needsUpdate = true;

  // (forest lane) the pieces' schemes, per metre: r the lines (1 on the scheme's own pieces: they start and end at its
  // ends), g how much older and paler the asphalt is, b how many more cracks, a the concrete strip's width (m); the
  // last three blended into the neighbours (schemes.js)
  const st = schemeTable(track);
  const schemeBytes = new Uint8Array(n * 4);
  let gap = 0.16;
  for (let i = 0; i < n; i++) {
    const k = st.index[i];
    if (k < 0) continue;
    const def = st.defs[k];
    if (def.gap) gap = def.gap;
    // (r: 255 the lines; 200 or 150 the lines with yellow dashes beside them on the left or the right, over the first
    // `dashes` m of a scheme's run: the inside of the bend that begins there)
    let lines = st.on[i] && def.lines === 'double-yellow' ? 255 : 0;
    if (lines && def.dashes) {
      const run = st.runs.find((r) => r.def === def && track.wrap(i * ds - r.s0) <= track.wrap(r.s1 - r.s0));
      if (run && track.wrap(i * ds - run.s0) < def.dashes) lines = track.curvature[Math.round(track.wrap(run.s0 + 30) / ds) % n] > 0 ? 200 : 150;
    }
    schemeBytes.set([lines, byte(st.w[i] * (def.asphalt ?? 0)), byte(st.w[i] * (def.cracks ?? 0)), byte(st.w[i] * (def.strip ?? 0))], i * 4);
  }
  const schemeTexture = new THREE.DataTexture(schemeBytes, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  schemeTexture.magFilter = schemeTexture.minFilter = THREE.NearestFilter;
  schemeTexture.wrapS = THREE.RepeatWrapping;
  schemeTexture.needsUpdate = true;

  const textures = roadTextures({ caps, tier });

  // the grid's boxes, in track coordinates (s counted back from the line is negative)
  const where = { index: -1, s: 0, lat: 0 };
  const slots = [];
  for (let slot = 0; slot < GRID_SLOTS; slot++) {
    const g = track.grid(slot);
    track.locate(g.x, g.z, -1, where);
    const s = where.s > track.length / 2 ? where.s - track.length : where.s;
    slots.push(new THREE.Vector4(s, where.lat, 0, 0));
  }

  const uniforms = {
    uAgg: { value: textures.surface },
    uAggN: { value: textures.relief },
    uBig: { value: textures.big },
    uEdge: { value: edgeTexture },
    uScheme: { value: schemeTexture },
    uFeat: { value: history.texture },
    uLength: { value: track.length },
    uGrid: { value: slots },
    uHalf: { value: half },
    uBeamPos: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, -1e4, 0)) },
    uBeamDir: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, 0, 1)) },
    uBeamPower: { value: new Array(BEAMS).fill(0) },
    uTailPos: { value: Array.from({ length: BEAMS * 2 }, () => new THREE.Vector3(0, -1e4, 0)) },
    uTailPower: { value: new Array(BEAMS).fill(0) },
    uGlintPos: { value: Array.from({ length: GLINTS }, () => new THREE.Vector4()) },
    uGlintColor: { value: Array.from({ length: GLINTS }, () => new THREE.Vector3()) },
    ...WET_UNIFORMS,
    ...BORE_UNIFORMS,
    ...(mirror ? mirror.uniforms : {}),
  };
  if (mirror) prepareMirror(mirror);

  const shade = SHADER[tier] ?? SHADER.medium;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  material.name = 'asphalt';
  material.defines = {
    ...material.defines,
    ROAD_TIER: shade.tier,
    AGG_TILE: textures.tile.toFixed(3),
    ROAD_SLOTS: history.slots,
    CENTRE_HALF_GAP: (gap / 2).toFixed(3),
    ROAD_SHOULDER: track.shoulder.toFixed(3),
    ...(mirror && shade.tier > 0 ? { ROAD_MIRROR: 1 } : {}),
  };
  extend(material, 'asphalt', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aRoad;\nattribute vec4 aAlong;\nattribute vec4 aCodeB;\nvarying vec4 vRoad;\nvarying vec4 vRoadWorld;\nvarying vec4 vRoadAlong;\nvarying vec4 vCodeB;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRoad = aRoad;\nvRoadAlong = aAlong;\nvCodeB = aCodeB;\nvRoadWorld = vec4( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, ${EYE_FROM_PROJECTION} );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${WET_MIRROR_PARS}\n${ASPHALT_PARS}`)
      .replace('#include <map_fragment>', ASPHALT_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRoughness;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = roadMetal;')
      .replace('#include <normal_fragment_maps>', ASPHALT_NORMAL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ASPHALT_BEADS}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${WET_SPECULAR}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${ASPHALT_SKY}\n${WET_MIRROR}\n${WET_GLINTS}\n${TUNNEL_SHEEN_GLSL}`);
  });
  withBake(material);
  // the low sun's glare: a second, anisotropic lobe on every direct light, after the bake has unrolled the loop
  extend(material, 'asphalt-sheen', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${ASPHALT_SHEEN}`)
      .replaceAll(
        'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
        '{ vec3 isoBefore = reflectedLight.directSpecular;\nRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\nreflectedLight.directSpecular = isoBefore + ( reflectedLight.directSpecular - isoBefore ) * roadIsoKeep + roadSheen( directLight, roadSheenNormal, geometryViewDir ); }',
      );
  });
  atmosphere.patch(material);

  const group = new THREE.Group();
  group.name = 'road';
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  return {
    group,
    material,
    uniforms,
    /** The lamps' heads the wet road glints with where it has no mirror (lamps.js fills them each view). */
    glints: { pos: uniforms.uGlintPos, color: uniforms.uGlintColor },
    /** What the road's history holds, and what its textures cost. */
    stats: { history: history.stats, textureBytes: textures.bytes, textureMs: textures.ms },
    /** 0..1 */
    setWetness(w) {
      WET_UNIFORMS.uWet.value = w;
    },
    /** @param {import('./index.js').Beam[]} beams */
    setBeams(beams) {
      for (let i = 0; i < BEAMS; i++) {
        const b = beams?.[i];
        if (b) {
          uniforms.uBeamPos.value[i].copy(b.pos);
          uniforms.uBeamDir.value[i].copy(b.dir).normalize();
          // two lamps, seen from the road as one
          uniforms.uBeamPower.value[i] = 2 * (LAMP_LOW * b.low + LAMP_HIGH * b.high);
          if (b.tailL) {
            uniforms.uTailPos.value[i * 2].copy(b.tailL);
            uniforms.uTailPos.value[i * 2 + 1].copy(b.tailR);
          }
          uniforms.uTailPower.value[i] = TAIL_GLINT.radiance * ((b.tail ?? 0) + TAIL_GLINT.brake * (b.brake ?? 0));
        } else {
          uniforms.uBeamPower.value[i] = 0;
          uniforms.uTailPower.value[i] = 0;
        }
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      edgeTexture.dispose();
      history.dispose();
      material.dispose();
    },
  };
}

/**
 * The mirror's picture is read blurred as well as sharp (a broken film of water smears what it shows): its target
 * gets a mip chain, made by the GPU after each of its renders.
 * @param {{ texture: THREE.Texture }} mirror
 */
export function prepareMirror(mirror) {
  mirror.texture.generateMipmaps = true;
  mirror.texture.minFilter = THREE.LinearMipmapLinearFilter;
}

/**
 * GLSL (vertex): 1 for a camera that is an eye, 0 for a reflection probe's cube face (90 degrees square, which no
 * view uses): what comes back towards a lamp, and the mirror's picture, belong to the view's own eye.
 */
export const EYE_FROM_PROJECTION =
  '( abs( abs( projectionMatrix[ 1 ][ 1 ] ) - 1.0 ) < 1.0e-3 && abs( abs( projectionMatrix[ 0 ][ 0 ] ) - 1.0 ) < 1.0e-3 ? 0.0 : 1.0 )';

/**
 * GLSL (fragment, declarations): the planar mirror as wet ground reads it. A material that uses it defines
 * ROAD_MIRROR and carries the mirror's uniforms; one without it gets the lamp glints' uniforms instead.
 *
 * A wet road draws each light out into a streak from the point that mirrors it towards the viewer: the nearer road
 * sees the light at a glancing angle off the far side of its bumps. The mirror draws that streak once for the whole
 * picture (PlanarMirror's `streak`: each texel the weighted sum of what lies above it); here the sharp picture
 * (standing water, roughness near zero, a little softer as it roughens) gives way to the streaked one as the film
 * breaks up: two lookups a pixel, sharp across, long along.
 */
export const WET_MIRROR_PARS = /* glsl */ `
float roadWater;      // the share of this pixel under water, 0..1
float roadFilm;       // how much of the rest still carries a thin film after rain (a rough, streaking mirror)
float roadPuddle;     // 1 where water stands clear over the stones
float roadWaterRough; // the water surface's own roughness
#ifdef ROAD_MIRROR
uniform sampler2D uMirrorTex;
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
uniform vec2 uMirrorTexel;
uniform vec4 uMirrorPlane;
uniform sampler2D uMirrorStreak;
// rgb: what the water at 'world' mirrors; a: how far to believe it (0 off the mirror's plane or beyond its picture)
vec4 wetMirror( vec3 world, vec2 push, float rough ) {
  float trust = 1.0 - smoothstep( 0.4, 2.5, abs( dot( world, uMirrorPlane.xyz ) + uMirrorPlane.w ) );
  if ( uMirrorOn < 0.5 || trust <= 0.0 ) return vec4( 0.0 );
  vec4 mc = uMirrorMatrix * vec4( world, 1.0 );
  vec2 uv = mc.xy / mc.w + push;
  vec3 sharp = textureLod( uMirrorTex, uv, clamp( rough * 8.0, 0.0, 1.5 ) ).rgb;
  // (a texel below the point: the streak runs from the light's own image towards the eye, and starts at it)
  vec3 streak = textureLod( uMirrorStreak, uv - vec2( 0.0, uMirrorTexel.y ), 0.0 ).rgb;
  vec3 seen = mix( sharp, streak, smoothstep( 0.08, 0.3, rough ) );
  vec2 inside = smoothstep( vec2( 0.0 ), vec2( 0.03 ), uv ) * smoothstep( vec2( 0.0 ), vec2( 0.03 ), 1.0 - uv );
  return vec4( seen, trust * inside.x * inside.y );
}
#else
uniform vec4 uGlintPos[${GLINTS}];
uniform vec3 uGlintColor[${GLINTS}];
#endif
uniform vec3 uTailPos[${BEAMS * 2}];
uniform float uTailPower[${BEAMS}];
// A light at 'lamp' seen in wet ground at P: a lobe about the mirrored view, 'across' wide across the plane of
// incidence and 'along' long in it (the streak towards the eye)
float wetGlint( vec3 P, vec3 N, vec3 V, vec3 lamp, float across, float along ) {
  vec3 R = reflect( - V, N );
  vec3 A = normalize( cross( N, V ) );
  vec3 dev = normalize( lamp - P ) - R;
  float x = dot( dev, A ) / across;
  float y = dot( dev, cross( R, A ) ) / along;
  return exp( - x * x - y * y );
}
`;

/** GLSL (fragment, after lights_physical_fragment): water reflects less head on than stone does (n = 1.33). */
export const WET_SPECULAR = /* glsl */ `
material.specularColor = mix( vec3( 0.04 ), vec3( 0.02 ), roadWater );
material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
`;

/**
 * GLSL (fragment, after the lights): the water's share of the surface shows the mirror's picture instead of the
 * environment map's, and the lamps' own highlights give way to their mirrored heads. Expects vRoadWorld (xyz the
 * world position, w 0 in a reflection probe's cube face).
 */
export const WET_MIRROR = /* glsl */ `
#ifdef ROAD_MIRROR
if ( vRoadWorld.w > 0.5 && roadWater + roadFilm > 0.003 ) {
  // pushed about by the surface's own tilt (stones standing out of the film): reflections break up. The film reads
  // the streaked picture only, at about half a puddle's strength.
  float mShare = roadWater / max( roadWater + ${FILM.share.toFixed(2)} * roadFilm, 1.0e-3 );
  vec4 mirrored = wetMirror( vRoadWorld.xyz, ( normal.xy - nonPerturbedNormal.xy ) * vec2( 0.03, 0.08 ), mix( 0.42, roadWaterRough, mShare ) );
  float mWet = max( roadWater, ${FILM.share.toFixed(2)} * roadFilm ) * mirrored.a;
  // the brightest things are held to a few times white: a lamp's head in a puddle glares, it does not burn a hole
  vec3 mCol = mirrored.rgb * ( 3.0 / ( 3.0 + max( mirrored.r, max( mirrored.g, mirrored.b ) ) ) );
  // water's Fresnel (n = 1.33) on the unbroken surface; a broken film faces the eye a little more than the road does
  float mCos = clamp( dot( nonPerturbedNormal, normalize( vViewPosition ) ) + 0.35 * roadWaterRough * roadWaterRough, 0.0, 1.0 );
  float mF = 0.02 + 0.98 * pow( 1.0 - mCos, 5.0 );
  reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, mCol * mF, mWet );
  reflectedLight.directSpecular *= 1.0 - 0.85 * mWet;
}
#endif
`;

/**
 * GLSL (fragment, after the lights): lights drawn into the wet road analytically, as long streaks about the mirrored
 * direction of the view, narrow across the plane of incidence and drawn out in it (wetGlint), with water's Fresnel,
 * shorter and fainter on a merely damp surface: the cars' tail lamps on every tier (TAIL_GLINT; only behind the car,
 * which hides them from the road ahead of it), and where there is no mirror the heads of the nearest lamps (GLINT).
 */
const WET_GLINTS = /* glsl */ `
if ( vRoadWorld.w > 0.5 && uWet > 0.02 ) {
  vec3 gP = vRoadWorld.xyz;
  vec3 gV = normalize( cameraPosition - gP );
  vec3 gN = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz ); // view space to world
  float gWet = max( roadWater, ${FILM.share.toFixed(2)} * roadFilm );
  float gF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( gN, gV ), 0.0, 1.0 ), 5.0 );
  float gLong = mix( 0.5, 1.0, roadWater );
  vec3 glint = vec3( 0.0 );
#ifndef ROAD_MIRROR
  for ( int i = 0; i < ${GLINTS}; i ++ ) {
    if ( uGlintPos[ i ].w <= 0.0 ) continue;
    glint += uGlintColor[ i ] * ( uGlintPos[ i ].w * wetGlint( gP, gN, gV, uGlintPos[ i ].xyz, ${GLINT.across.toFixed(3)}, gLong * ${GLINT.along.toFixed(3)} ) );
  }
  glint *= ${GLINT.gain.toFixed(2)} * 3.0 / ( 3.0 + max( glint.r, max( glint.g, glint.b ) ) );
#endif
  float tail = 0.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    if ( uTailPower[ i ] <= 0.0 ) continue;
    // a tail lamp shines backwards: the road ahead of the car (and under it) is in the car's own shadow
    vec3 back = - uBeamDir[ i ];
    for ( int k = 0; k < 2; k ++ ) {
      vec3 lamp = uTailPos[ i * 2 + k ];
      float behind = smoothstep( -0.1, 0.4, dot( normalize( gP - lamp ), back ) );
      tail += uTailPower[ i ] * behind * wetGlint( gP, gN, gV, lamp, ${TAIL_GLINT.across.toFixed(3)}, gLong * ${TAIL_GLINT.along.toFixed(3)} );
    }
  }
  tail *= ${TAIL_GLINT.gain.toFixed(2)} * 3.0 / ( 3.0 + tail );
  reflectedLight.indirectSpecular += ( glint + tail * vec3( ${TAIL_GLINT.color.map((c) => c.toFixed(3)).join(', ')} ) ) * ( gF * gWet );
}
`;

/**
 * (tunnel lane) GLSL (fragment, after the lights): under the tunnel's roof (TUNNEL_SHEEN). The mirrored ray is
 * followed up to the plane of the luminaires; where it meets it, across the road, says how near it passes to either
 * line of them, blurred more the further it travels; along the road, how densely the line is lit there (the
 * entrance zone's pairs of bars, the interior's spaced ones). Not in a reflection probe's faces.
 */
const TUNNEL_SHEEN_GLSL = /* glsl */ `
if ( vRoadWorld.w > 0.5 && vRoad.w < 0.6 && uBoreZone.y > uBoreZone.x ) {
  float tIn = 1.0 - smoothstep( 0.0, 0.6, vRoad.w );
  vec3 tP = vRoadWorld.xyz;
  vec3 tV = normalize( cameraPosition - tP );
  vec3 tN = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 tA = normalize( vRoadAlong.xyz - tN * dot( vRoadAlong.xyz, tN ) );
  vec3 tL = cross( tN, tA );
  vec3 tR = reflect( - tV, tN );
  float tNoV = clamp( dot( tN, tV ), 0.0, 1.0 );
  float tW = roadSkySheen * pow( 1.0 - tNoV, ${SKY_SHEEN.power.toFixed(1)} );
  float tUp = dot( tR, tN );
  vec3 tAdd = vec3( 0.0 );
  if ( tUp > 0.03 ) {
    float tT = uBoreLines.y / tUp;
    float hitLat = vRoad.x + dot( tR, tL ) * tT;
    float hitS = vRoad.y + dot( tR, tA ) * tT;
    float w = ${TUNNEL_SHEEN.blur[0].toFixed(2)} + ${TUNNEL_SHEEN.blur[1].toFixed(3)} * tT * tT * tUp;
    float d = ( abs( hitLat ) - uBoreLines.x ) / w;
    float across = exp( - d * d ) * uBoreLines.w / ( 1.7725 * w );
    float into = hitS - uBoreZone.x;
    float toExit = uBoreZone.y - hitS;
    float duty = mix( 1.25, 0.42, smoothstep( 50.0, 70.0, into ) );
    duty = mix( duty, uBoreZone.z, smoothstep( 120.0, 140.0, into ) );
    duty = max( duty, 0.42 * ( 1.0 - smoothstep( uBoreZone.w - 10.0, uBoreZone.w + 10.0, toExit ) ) );
    duty *= smoothstep( -1.0, 1.0, into ) * smoothstep( -1.0, 1.0, toExit );
    tAdd += uBoreLineColor * ( uBoreLines.z * duty * across * ${TUNNEL_SHEEN.gain.toFixed(3)} );
  }
  // the tail lamps, short and broad in the dry stone
  float tTail = 0.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    if ( uTailPower[ i ] <= 0.0 ) continue;
    for ( int k = 0; k < 2; k ++ ) {
      vec3 lamp = uTailPos[ i * 2 + k ];
      float behind = smoothstep( -0.1, 0.4, dot( normalize( tP - lamp ), - uBeamDir[ i ] ) );
      tTail += uTailPower[ i ] * behind * wetGlint( tP, tN, tV, lamp, ${TUNNEL_SHEEN.tail[1].toFixed(3)}, ${TUNNEL_SHEEN.tail[2].toFixed(3)} );
    }
  }
  tAdd += vec3( ${TAIL_GLINT.color.map((c) => c.toFixed(3)).join(', ')} ) * ( ${(TUNNEL_SHEEN.tail[0] * TAIL_GLINT.gain).toFixed(3)} * 3.0 * tTail / ( 3.0 + tTail ) );
  reflectedLight.indirectSpecular += tAdd * ( tW * tIn );
  // the cars' shade on the road under them: a soft rounded box round each car's plan
  float tShade = 1.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 f = normalize( vec3( uBeamDir[ i ].x, 0.0, uBeamDir[ i ].z ) + vec3( 0.0, 0.0, 1.0e-4 ) );
    vec3 c = uBeamPos[ i ] - f * ${(2.2 - 0.13).toFixed(2)};
    vec3 q = tP - c;
    if ( abs( q.y ) > 2.0 ) continue;
    vec2 e = max( abs( vec2( dot( q.xz, f.xz ), dot( q.xz, vec2( - f.z, f.x ) ) ) ) - vec2( ${TUNNEL_SHEEN.shade[1].toFixed(2)}, ${TUNNEL_SHEEN.shade[2].toFixed(2)} ), 0.0 );
    float r = length( e ) / ${TUNNEL_SHEEN.shade[3].toFixed(2)};
    tShade *= 1.0 - ${TUNNEL_SHEEN.shade[0].toFixed(2)} * exp( - r * r );
  }
  tShade = mix( 1.0, tShade, tIn );
  reflectedLight.indirectDiffuse += material.diffuseColor * uBoreGlow * ( ${TUNNEL_SHEEN.bounce.toFixed(2)} * tIn * tShade );
  reflectedLight.directDiffuse *= tShade;
  reflectedLight.directSpecular *= tShade;
}
`;

/**
 * GLSL (fragment, after lights_pars_begin): the asphalt's glare (SHEEN). One anisotropic GGX lobe whose axes are the
 * view's direction laid on the road and the direction across it, on every direct light, added to what is kept of
 * the material's own.
 */
const ASPHALT_SHEEN = /* glsl */ `
vec3 roadSheen( IncidentLight L, vec3 N, vec3 V ) {
  float NoL = dot( N, L.direction );
  if ( NoL <= 0.0 || roadSheenGain <= 0.0 ) return vec3( 0.0 );
  float NoV = max( dot( N, V ), 1.0e-3 );
  vec3 H = normalize( L.direction + V );
  vec3 T = V - N * dot( V, N );
  float tl = length( T );
  T = tl > 1.0e-4 ? T / tl : normalize( cross( N, vec3( 1.0, 0.0, 0.0 ) ) );
  vec3 B = cross( N, T );
  float ax = ${SHEEN.along.toFixed(3)};
  float ay = ${SHEEN.across.toFixed(3)};
  float th = dot( H, T ) / ax;
  float bh = dot( H, B ) / ay;
  float nh = dot( H, N );
  float d = th * th + bh * bh + nh * nh;
  float D = 1.0 / ( PI * ax * ay * d * d );
  float a2 = ax * ay;
  float Vis = 0.5 / ( NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 ) + NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 ) );
  float F = 0.04 + 0.96 * pow( 1.0 - clamp( dot( L.direction, H ), 0.0, 1.0 ), 5.0 );
  return L.color * ( NoL * D * Vis * F * roadSheenGain );
}
`;

/**
 * GLSL (fragment, after the lights): the sky in the road (SKY_SHEEN). Only where there is an environment map; in
 * the tunnel the world turns that map down and the sheen goes with it. Before aomap_fragment, so the baked share of
 * the sky (shading.js) holds it back under a cliff as it does the rest of the sky's light.
 */
const ASPHALT_SKY = /* glsl */ `
#ifdef USE_ENVMAP
{
  float skyNoV = clamp( dot( nonPerturbedNormal, geometryViewDir ), 0.0, 1.0 );
  // the stones' faces that look back at the eye are the ones it sees: the mirrored direction is lifted off the horizon
  vec3 skyN = normalize( nonPerturbedNormal + ( geometryViewDir - nonPerturbedNormal * skyNoV ) * ${SKY_SHEEN.lift.toFixed(2)} );
  vec3 skyLow = getIBLRadiance( geometryViewDir, skyN, ${SKY_SHEEN.blur.toFixed(2)} );
  skyLow *= ${SKY_SHEEN.cap.toFixed(2)} / ( ${SKY_SHEEN.cap.toFixed(2)} + max( skyLow.r, max( skyLow.g, skyLow.b ) ) );
  // (the material's own share of the sky first, then the sheen: both lose the sky's colour on dry stone)
  vec3 skyOwn = reflectedLight.indirectSpecular;
  skyOwn = mix( skyOwn, vec3( dot( skyOwn, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ${SKY_SHEEN.grey.toFixed(2)} * ( 1.0 - roadWater ) );
  skyLow = mix( skyLow, vec3( dot( skyLow, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ${SKY_SHEEN.grey.toFixed(2)} );
  reflectedLight.indirectSpecular = skyOwn + skyLow * ( roadSkySheen * pow( 1.0 - skyNoV, ${SKY_SHEEN.power.toFixed(1)} ) );
}
#endif
// under the tunnel's roof the same sheen mirrors the lit lining instead (shading.js BORE_UNIFORMS)
reflectedLight.indirectSpecular += uBoreGlow * ( ( 1.0 - smoothstep( 0.0, 0.6, vRoad.w ) ) * roadSkySheen * pow( 1.0 - clamp( dot( nonPerturbedNormal, geometryViewDir ), 0.0, 1.0 ), ${SKY_SHEEN.power.toFixed(1)} ) );
`;

const ASPHALT_PARS = /* glsl */ `
uniform sampler2D uAgg;
uniform sampler2D uAggN;
uniform sampler2D uBig;
uniform sampler2D uEdge;
uniform sampler2D uScheme;
uniform highp sampler2D uFeat;
uniform float uLength;
uniform vec4 uGrid[${GRID_SLOTS}];
uniform float uHalf;
uniform float uWet;
uniform vec3 uBoreGlow;
uniform vec4 uBoreLines;
uniform vec3 uBoreLineColor;
uniform vec4 uBoreZone;
uniform vec3 uBeamPos[${BEAMS}];
uniform vec3 uBeamDir[${BEAMS}];
uniform float uBeamPower[${BEAMS}];
varying vec4 vRoad;       // lat, s, paved beyond the pavement, sky overhead
varying vec4 vRoadWorld;  // world position; w: 0 in a reflection probe's cube face (retro.js says why)
varying vec4 vRoadAlong;  // the road's direction; w: how readily water stands here
varying vec4 vCodeB;      // the racing line, rubber on it, water carried in, banking
float roadRoughness;
float roadSheenGain;     // how much of the glare lobe this pixel shows
float roadSkySheen;      // and of the sky's sheen
vec3 roadSheenNormal;    // the glare lobe's normal: part of the way from the road's plane to the stone's own
float roadIsoKeep;       // how much of the material's own lobe it keeps (all of it under water)
float roadMetal;
float roadPaint;
float roadFade;
float roadGravel;
float roadBump;           // height of what stands proud of the surface or is cut into it (m)
vec2 roadTilt;            // the stones' slope, across and along
float roadTiltGain;

// The share of a pixel of half width a, a distance d from the middle of a band of half width w, that the band
// covers: lines keep their true weight however small they get, and never alias.
float roadCover( float d, float w, float a ) {
  return ( clamp( d + w, -a, a ) - clamp( d - w, -a, a ) ) / ( 2.0 * a );
}
`;

const ASPHALT_COLOR = /* glsl */ `
// ================= where this pixel is on the road, and how much road it covers
float rLat = vRoad.x;
float rS = vRoad.y;
float rA = abs( rLat );
// s counted back from the line is negative near the end of the lap
float rS0 = rS > uLength * 0.5 ? rS - uLength : rS;
vec2 rUv = vec2( rLat, rS );
vec2 rDx = dFdx( rUv );
vec2 rDy = dFdy( rUv );
// half a pixel's reach across the road and along it (m): every edge is smoothed over that
float aaL = 0.6 * ( abs( rDx.x ) + abs( rDy.x ) ) + 4.0e-4;
float aaS = 0.6 * ( abs( rDx.y ) + abs( rDy.y ) ) + 4.0e-4;
float aaM = max( aaL, aaS );
float rDist = length( vRoadWorld.xyz - cameraPosition );
roadFade = 1.0 - smoothstep( 18.0, 110.0, rDist );
// 1 where single stones are told apart, 0 where a pixel holds many
float rNear = 1.0 - smoothstep( 0.012, 0.05, max( length( rDx ), length( rDy ) ) );
float rOnRoad = smoothstep( uHalf + aaL, uHalf - aaL, rA );
// (forest lane) the piece's scheme: lines, older asphalt, more cracks, the concrete strip (schemes.js)
vec4 rScheme = texture2D( uScheme, vec2( ( floor( rS / uLength * float( textureSize( uScheme, 0 ).x ) ) + 0.5 ) / float( textureSize( uScheme, 0 ).x ), 0.5 ) );

// ================= the large fields and the stones
vec4 rBig = texture2D( uBig, rUv / ${BIG_TILE.toFixed(1)} );
vec4 rBig2 = texture2D( uBig, rUv.yx / ${(BIG_TILE * 3.1).toFixed(1)} );
vec2 rP = rUv / AGG_TILE;
#if ROAD_TIER > 0
  // looked up at two places and blended, the pair changing from one patch of road to the next: no repeat to find
  vec2 rGx = rDx / AGG_TILE;
  vec2 rGy = rDy / AGG_TILE;
  float rK = rBig.r * 9.0 + rBig2.b * 6.0 + rS * 0.031;
  float rKi = floor( rK );
  vec2 rOa = hash22( vec2( rKi, 3.0 ) );
  vec2 rOb = hash22( vec2( rKi + 1.0, 3.0 ) );
  vec4 rAggA = textureGrad( uAgg, rP + rOa, rGx, rGy );
  vec4 rAggB = textureGrad( uAgg, rP + rOb, rGx, rGy );
  // (the higher stone wins where they cross over, so stones keep their shapes)
  float rSwap = smoothstep( 0.3, 0.7, rK - rKi + ( rAggB.g - rAggA.g ) * 0.3 );
  vec4 rAgg = mix( rAggA, rAggB, rSwap );
  vec4 rRelief = mix( textureGrad( uAggN, rP + rOa, rGx, rGy ), textureGrad( uAggN, rP + rOb, rGx, rGy ), rSwap );
#else
  vec4 rAgg = texture2D( uAgg, rP );
  vec4 rRelief = texture2D( uAggN, rP );
#endif
float rMottle = rAgg.a;
roadTilt = ( rRelief.xy * 2.0 - 1.0 ) / max( rRelief.z * 2.0 - 1.0, 0.25 );
float rVariance = rRelief.a / ${VARIANCE_GAIN.toFixed(1)};

// ================= the racing line: where every car runs, and the rubber it lays
float rLine = ( vCodeB.x - 0.5 ) * 8.0;
float rLineD = rLat - rLine;
// a broad band, polished and a shade darker, wandering a little as drivers do
float rWander = 0.25 * sin( rS * 0.021 ) + 0.15 * sin( rS * 0.057 + 1.3 );
float rTracks = 0.55 * exp( -pow( ( rLineD + rWander ) / 1.7, 2.0 ) ) * rOnRoad * ( 0.75 + 0.5 * rBig.b );
float rCrown = exp( -pow( rLat / 1.6, 2.0 ) );
float rDrip = 0.0;
// rubber on the line, two tyres wide, as long smears drawn out along the road
float rRubber = vCodeB.y * ( exp( -pow( ( abs( rLineD + 0.6 * rWander ) - 0.8 ) / 0.35, 2.0 ) ) + 0.35 * exp( -pow( rLineD / 1.3, 2.0 ) ) );
#if ROAD_TIER > 0
  rRubber *= 0.5 + 1.0 * smoothstep( 0.25, 0.65, texture2D( uBig, vec2( rLat * 0.9, rS * 0.017 ) ).b );
#endif
rRubber = min( rRubber, 1.0 ) * rOnRoad;

// ================= the road's history: the few things that reach into this cell of the lap
float ftFresh = 0.0;      // newer asphalt laid into the old
float ftTone = 0.5;       // and how new
float ftTar = 0.0;        // sealed edges and cracks
float ftMetal = 0.0;      // iron and steel set into the road
float ftMetalTone = 0.5;
float ftHole = 0.0;       // a slot one looks down into
float ftStain = 0.0;
float ftStainTone = 0.0;  // 0 oil .. 0.5 a pale crust .. 1 rubber
float ftHeight = 0.0;     // mm proud of the road, or sunk
float ftErase = 0.0;      // paint cut away
float ftCell = floor( rS / ${FEATURE_CELL.toFixed(1)} );
int ftColumn = int( ftCell );
float ftX0 = ftCell * ${FEATURE_CELL.toFixed(1)};
vec4 ftHead = texelFetch( uFeat, ivec2( ftColumn, 0 ), 0 );
for ( int slot = 1; slot <= ROAD_SLOTS; slot ++ ) {
  vec4 ft = texelFetch( uFeat, ivec2( ftColumn, slot ), 0 );
  if ( ft.w < 0.5 ) break;
  float kind = mod( ft.w, 16.0 );
  float seed = mod( floor( ft.w / 16.0 ), 256.0 ) / 255.0;
  float param = floor( ft.w / 4096.0 ) / 255.0;
  float hl = floor( ft.z / 4096.0 ) * 0.01;
  float hw = mod( ft.z, 4096.0 ) * 0.01;
  vec2 q = vec2( rS - ftX0 - ft.x, rLat - ft.y );   // along and across from its middle
  if ( kind < 3.5 ) {
    // 1 a patch, 2 a trench along the road, 3 a cut across it: a rectangle of newer asphalt, its edges sealed
    float turn = kind < 1.5 ? 0.0 : ( seed - 0.5 ) * 1.2 + ( kind > 2.5 ? 1.5708 : 0.0 );
    float ca = cos( turn );
    float sa = sin( turn );
    vec2 r = vec2( ca * q.x + sa * q.y, ca * q.y - sa * q.x );
    vec2 e = abs( r ) - vec2( hl, hw );
    // (cut by hand: the edge wavers by a centimetre)
    float d = max( e.x, e.y ) + 0.014 * ( rMottle - 0.5 );
    float a = mix( e.x > e.y ? aaS : aaL, e.x > e.y ? aaL : aaS, sa * sa );
    float inside = smoothstep( a, -a, d );
    ftFresh = max( ftFresh, inside );
    ftTone = mix( ftTone, param, inside );
    ftTar = max( ftTar, roadCover( d + 0.004, 0.022 + 0.012 * seed, a ) * ( 0.5 + 0.5 * smoothstep( 0.3, 0.5, rBig.b + seed - 0.5 ) ) );
    ftHeight += inside * ( kind < 1.5 ? ( param - 0.4 ) * 4.0 : -3.5 );
    ftErase = max( ftErase, inside );
  } else if ( kind < 5.5 ) {
    // 4 a crack along the road, 5 one across it: a wandering line, sealed
    vec2 r = kind < 4.5 ? q : q.yx;
    float len = kind < 4.5 ? hl : hw;
    float amp = kind < 4.5 ? hw : hl;
    float way = amp * ( 0.6 * sin( r.x * 0.9 + seed * 40.0 ) + 0.3 * sin( r.x * 2.3 + seed * 71.0 ) + 0.14 * sin( r.x * 6.1 + seed * 13.0 ) );
    float d = r.y - way + 0.008 * ( rMottle - 0.5 );
    float wide = 0.009 + 0.02 * param;
    ftTar = max( ftTar, roadCover( d, wide, kind < 4.5 ? aaL : aaS ) * smoothstep( len, len - 0.5, abs( r.x ) ) );
  } else if ( kind < 6.5 ) {
    // 6 a cast iron cover in its frame, in the square of asphalt it was set in
    float r = length( q );
    float a = ( abs( q.x ) * aaS + abs( q.y ) * aaL ) / max( r, 1.0e-3 );
    float lid = roadCover( r, hw, a );
    float rim = roadCover( r - hw - 0.03, 0.03, a );
    float collar = smoothstep( aaM, -aaM, max( abs( q.x ), abs( q.y ) ) - hw - 0.3 + 0.012 * ( rMottle - 0.5 ) );
    vec2 g = fract( vec2( q.x + q.y, q.x - q.y ) / 0.085 ) - 0.5;
    float studs = smoothstep( 0.34, 0.24, max( abs( g.x ), abs( g.y ) ) ) * smoothstep( hw - 0.025, hw - 0.07, r ) * ( 1.0 - smoothstep( 0.012, 0.04, aaM ) );
    ftFresh = max( ftFresh, collar );
    ftTone = mix( ftTone, 0.3, collar );
    ftTar = max( ftTar, roadCover( max( abs( q.x ), abs( q.y ) ) - hw - 0.3, 0.02, aaM ) * 0.7 );
    ftMetal = max( ftMetal, max( lid, rim ) );
    ftMetalTone = mix( ftMetalTone, 0.42 + 0.3 * studs, lid );
    ftMetalTone = mix( ftMetalTone, 0.3, rim );
    ftHeight += lid * ( 3.0 * studs - 5.0 ) - 2.0 * rim;
    ftErase = max( ftErase, max( collar, lid ) );
  } else if ( kind < 7.5 ) {
    // 7 a grating: bars across its length, slots between them
    vec2 e = abs( q ) - vec2( hl, hw );
    float a = e.x > e.y ? aaS : aaL;
    float inside = smoothstep( a, -a, max( e.x, e.y ) );
    float inner = smoothstep( a, -a, max( e.x, e.y ) + 0.028 );
    float run = hl > hw ? q.x : q.y;
    float bars = roadCover( fract( run / 0.046 ) - 0.5, 0.27, ( hl > hw ? aaS : aaL ) / 0.046 );
    ftMetal = max( ftMetal, inside );
    ftMetalTone = mix( ftMetalTone, 0.36, inside );
    ftHole = max( ftHole, inner * ( 1.0 - bars ) );
    ftHeight += -3.0 * inside - 10.0 * inner * ( 1.0 - bars );
    ftErase = max( ftErase, inside );
  } else if ( kind < 8.5 ) {
    // 8 an expansion joint: steel plates either side of a gap that runs in a saw-tooth (param 0: a plain sealed joint)
    float plate = roadCover( q.x, hl, aaS ) * roadCover( q.y, hw, aaL );
    float tooth = param * ( abs( fract( q.y / 0.24 ) - 0.5 ) * 0.1 - 0.025 );
    float gap = roadCover( q.x - tooth, 0.013, aaS ) * plate;
    ftMetal = max( ftMetal, plate * step( 0.5, param ) );
    ftMetalTone = mix( ftMetalTone, 0.22, plate );
    ftTar = max( ftTar, plate * ( 1.0 - step( 0.5, param ) ) );
    ftHole = max( ftHole, gap * step( 0.5, param ) );
    ftHeight += plate * 1.0 - gap * 9.0;
    ftErase = max( ftErase, plate );
  } else {
    // 9 a stain with a ragged edge
    float r = length( q / vec2( hl, hw ) ) + ( rMottle - 0.5 ) * 0.5 + ( rBig.b - 0.5 ) * 0.3;
    float mark = smoothstep( 1.0, 0.55, r ) * ( param > 0.7 ? 0.75 * smoothstep( 0.25, 0.6, rBig.b + 0.3 * rMottle ) : 0.9 );
    ftStainTone = mix( ftStainTone, param, step( ftStain, mark ) );
    ftStain = max( ftStain, mark );
  }
}

// ================= the surfacing: how old the asphalt is here (0 laid this year, 1 a generation ago)
float rJointX = rS - ftX0 - ftHead.z;
float rAge = ftHead.z >= 0.0 ? mix( ftHead.x, ftHead.y, smoothstep( -aaS, aaS, rJointX ) ) : ftHead.x;
float rSeamTar = ftHead.z >= 0.0 ? roadCover( rJointX, 0.02, aaS ) : 0.0;
rAge = clamp( rAge + ( rBig2.r - 0.5 ) * 0.22, 0.0, 1.0 );
rAge = mix( rAge, ftTone * 0.5, ftFresh );
// (forest lane) an old road's surface: weathered, its binder worn off the stones (frame e2's pale grey)
rAge = mix( rAge, max( rAge, 0.92 ), rScheme.g );
float rWorn = mix( 0.3, 1.0, rAge );
// new: binder over everything, black. Old: the binder weathered grey and worn off the stones' tops.
// (night lane, frame D3: the sunlit road is a warm light grey; the stones are a warm limestone under the binder)
vec3 rCol = mix( vec3( 0.03, 0.029, 0.028 ), vec3( 0.084, 0.078, 0.069 ), rAge );
rCol *= 1.0 + ( rAgg.r - 0.5 ) * mix( 0.45, 1.5, rAge );
rCol *= ( 0.86 + 0.28 * rBig.r ) * ( 0.92 + 0.16 * rBig2.r ) * ( 0.92 + 0.16 * rMottle );
rCol *= 1.0 - 0.2 * rTracks * rWorn;
rCol *= 1.0 + 0.1 * rCrown * rWorn;
rCol *= 1.0 - 0.12 * rDrip * rWorn;
rCol = mix( rCol, vec3( 0.03, 0.03, 0.032 ) * ( 0.8 + 0.4 * rAgg.r ), 0.78 * rRubber * ( 1.0 - 0.6 * rScheme.g ) );
// (forest lane) paler: pale stone showing through, dust in the pores
rCol = mix( rCol, rCol * 1.55 + vec3( 0.026, 0.025, 0.023 ) * ( 0.8 + 0.4 * rMottle ), rScheme.g );
// roughness as alpha squared (what averages truly over a pixel): each stone its own polish, the binder dull
float rAlpha2 = rAgg.b * ${ROUGH_GAIN.toFixed(2)} * mix( 1.35, 0.9, rAge );
rAlpha2 *= 1.0 - 0.5 * min( rTracks, 1.0 ) * rWorn;
rAlpha2 *= 0.8 + 0.4 * rBig.b;
rAlpha2 = mix( rAlpha2, 0.07, 0.6 * rRubber );
rAlpha2 *= 1.0 + 0.4 * rScheme.g;
roadTiltGain = 1.0 - 0.35 * min( rTracks, 1.0 ) * rWorn;

// ================= paint: an edge line inside each edge, the start line, the grid
float rMarks = roadCover( rA - ( uHalf - ${(EDGE_LINE / 2).toFixed(3)} ), ${(EDGE_LINE / 2).toFixed(3)}, aaL );
rMarks += roadCover( rS0, 0.2, aaS ) * roadCover( rLat, uHalf - ${EDGE_LINE.toFixed(3)}, aaL );
for ( int i = 0; i < ${GRID_SLOTS}; i ++ ) {
  float d = rS0 - uGrid[ i ].x;
  float l = rLat - uGrid[ i ].y;
  // a bar across in front of the place, and short arms back along its sides
  rMarks += roadCover( d - 2.7, 0.07, aaS ) * roadCover( l, 1.25, aaL );
  rMarks += roadCover( abs( l ) - 1.18, 0.07, aaL ) * roadCover( d - 2.05, 0.65, aaS );
}
// (forest lane) the scheme's double yellow centre line, two solid lines either side of the centre
float rYellow = step( 0.5, rScheme.r ) * roadCover( rA - ( CENTRE_HALF_GAP + ${(CENTRE_LINE.width / 2).toFixed(3)} ), ${(CENTRE_LINE.width / 2).toFixed(3)}, aaL );
// and short yellow dashes beside it on the inside of a bend's first part (r 200: left, 150: right)
float rDashSide = rScheme.r < 0.9 && rScheme.r > 0.5 ? ( rScheme.r > 0.7 ? 1.0 : -1.0 ) : 0.0;
rYellow += abs( rDashSide ) * roadCover( rLat * rDashSide - ( CENTRE_HALF_GAP + 0.55 ), 0.06, aaL ) * roadCover( fract( rS / 3.0 ) - 0.5, 0.17, aaS / 3.0 );
rMarks += rYellow;
// worn: thin where the tyres run, gone in places, broken by the stones up close, newer where the road is
float rWear = 0.55 + 0.25 * rBig.b + 0.2 * rMottle - 0.3 * rRubber + 0.2 * ( rAgg.g - 0.5 ) * rNear + 0.2 * ( 1.0 - rAge );
roadPaint = clamp( rMarks, 0.0, 1.0 ) * rOnRoad * smoothstep( 0.14, 0.38, rWear ) * ( 1.0 - ftErase );
rCol = mix( rCol, mix( vec3( 0.68, 0.68, 0.655 ), vec3( ${CENTRE_LINE.yellow.map((v) => v.toFixed(3)).join(', ')} ), clamp( rYellow, 0.0, 1.0 ) ) * ( 0.88 + 0.16 * rAgg.r ) * ( 0.88 + 0.12 * rBig.r ), roadPaint );
rAlpha2 = mix( rAlpha2, 0.085, roadPaint );
roadTiltGain *= 1.0 - 0.65 * roadPaint;

// ================= what lies on top of the paint: tar, stains, iron
// cracks that broke the old road into blocks, and the seam between the lanes
float rBlocks = roadCover( rBig.g * 5.3, 0.011, aaM ) * smoothstep( 0.55 - 0.4 * rScheme.b, 0.75 - 0.4 * rScheme.b, rBig2.b ) * smoothstep( 0.5, 0.8, rAge ) * ( 1.0 - ftFresh );
float rSeam = 0.45 * roadCover( abs( rLat ) - ${SEAM_LAT.toFixed(2)} - 0.015 * sin( rS * 0.3 ), 0.012, aaL ) * smoothstep( 0.35, 0.6, rBig2.g + rAge * 0.3 );
float rTar = clamp( max( max( ftTar, rSeamTar ), max( rBlocks, rSeam ) ), 0.0, 1.0 ) * rOnRoad;
rCol = mix( rCol, vec3( 0.021, 0.021, 0.023 ), 0.93 * rTar );
rAlpha2 = mix( rAlpha2, 0.012, rTar );
roadTiltGain *= 1.0 - 0.7 * rTar;
vec3 rStainCol = ftStainTone < 0.3 ? rCol * 0.3 : ftStainTone < 0.7 ? mix( rCol, vec3( 0.16, 0.17, 0.14 ), 0.55 ) : rCol * 0.42;
rCol = mix( rCol, rStainCol, ftStain );
rAlpha2 = mix( rAlpha2, ftStainTone < 0.3 ? 0.02 : 0.12, ftStain * 0.8 );
vec3 rIron = mix( vec3( 0.2, 0.19, 0.18 ), vec3( 0.42, 0.4, 0.37 ), ftMetalTone ) * ( 0.8 + 0.4 * rMottle );
rCol = mix( rCol, rIron, ftMetal );
rCol = mix( rCol, vec3( 0.004 ), ftHole );
rAlpha2 = mix( rAlpha2, 0.16, ftMetal );
roadMetal = ftMetal * 0.8 * ( 1.0 - ftHole );
roadTiltGain *= 1.0 - 0.8 * ftMetal;
roadBump = ( ftHeight + 2.5 * roadPaint + 1.2 * rTar ) * 0.001;

// ================= the margin beyond the edge line: the same asphalt, older, dusty, leaves where woods stand
roadGravel = 0.0;
float rLeaves = 0.0;
float rOut = rA - uHalf;
if ( rOut > -0.6 ) {
  vec4 rEdge = textureLod( uEdge, vec2( rS / uLength, 0.5 ), 0.0 );
  float leafy = rLat > 0.0 ? rEdge.r : rEdge.g;
  // the same stones three times the size: grit blown off the verge, and the shapes of fallen leaves
  vec2 gP = rUv / ( AGG_TILE * 3.1 ) + 0.37;
  vec4 gAgg = textureGrad( uAgg, gP, rDx / ( AGG_TILE * 3.1 ), rDy / ( AGG_TILE * 3.1 ) );
  float loose = 1.0 - step( 0.5, vRoad.z );
  float margin = smoothstep( -aaL, aaL, rOut ) * loose;
  // dust thickens outwards, in drifts
  float dust = margin * smoothstep( 0.0, 1.3, rOut + 0.4 * ( rBig.b - 0.5 ) ) * ( 0.55 + 0.6 * gAgg.a );
  rCol = mix( rCol, vec3( 0.1, 0.095, 0.085 ) * ( 0.8 + 0.5 * rAgg.r ), 0.5 * margin );
  rCol = mix( rCol, vec3( 0.16, 0.152, 0.14 ) * ( 0.6 + 0.8 * gAgg.r ), clamp( dust, 0.0, 0.7 ) );
  rAlpha2 = mix( rAlpha2, 0.35, margin );
  roadGravel = clamp( dust, 0.0, 1.0 );
  // leaves gather along the edge under trees
  float lying = leafy * smoothstep( -0.6, 0.6, rOut ) * ( 0.55 + 0.9 * rBig2.r );
  rLeaves = smoothstep( 1.02 - 0.3 * lying, 1.06 - 0.3 * lying, gAgg.b + 0.25 ) * step( 0.02, lying );
  rCol = mix( rCol, mix( vec3( 0.16, 0.085, 0.025 ), vec3( 0.05, 0.03, 0.015 ), gAgg.r ), rLeaves );
  rAlpha2 = mix( rAlpha2, 0.2, rLeaves );
  roadTiltGain *= 1.0 - 0.8 * rLeaves;
  // (forest lane) the scheme's flush concrete strip along the margin's outer side: precast pieces a metre long
  float stripW = rScheme.a;
  if ( stripW > 0.01 ) {
    float stripIn = rOut - ( ROAD_SHOULDER - stripW );
    float strip = smoothstep( -aaL, aaL, stripIn ) * loose;
    float joint = roadCover( fract( rS ) - 0.5, 0.008, aaS ) + roadCover( stripIn, 0.012, aaL );
    vec3 concrete = vec3( 0.36, 0.35, 0.32 ) * ( 0.82 + 0.3 * gAgg.r ) * ( 0.85 + 0.3 * rBig2.r );
    rCol = mix( rCol, mix( concrete, vec3( 0.05, 0.048, 0.045 ), clamp( joint, 0.0, 1.0 ) * 0.8 ), strip * smoothstep( 0.0, 0.3, stripW / 0.32 ) );
    rAlpha2 = mix( rAlpha2, 0.5, strip );
    roadGravel *= 1.0 - strip;
  }
}

// ================= water
// what fell here, and what tyres carried in under the roof
float rRain = uWet * smoothstep( 0.05, 0.6, vRoad.w );
float rCarried = uWet * vCodeB.z * ( 0.25 + 0.75 * min( rTracks, 1.0 ) ) * ( 0.5 + rBig.b );
// The surface's height in millimetres above where water would lie level: the crown on the straight or the banking
// in a bend, dips (drawn out along the road, as water lies), the ruts, and whatever was laid proud or has sunk.
float rBank = ( vCodeB.w - 0.5 ) * 2.0;
float hCrown = 6.5 * ( 1.0 - smoothstep( 0.5, 3.9, rA ) );
float hBank = 3.5 + 6.0 * rBank * rLat / uHalf;
float hDips = ( 0.5 - 0.6 * texture2D( uBig, vec2( rLat, rS * 0.4 ) / 9.0 ).a - 0.4 * rBig.a ) * 8.0;
float hMacro = mix( hBank, hCrown, 1.0 - smoothstep( 0.08, 0.4, abs( rBank ) ) ) + hDips + ( rMottle - 0.5 ) * 1.6;
hMacro -= ( 2.0 + 2.5 * rBig.b ) * min( rTracks, 1.2 ) * rWorn;
// held back along the pavement's edge by the edge line and the verge
hMacro -= 2.5 * exp( -pow( ( rA - ( uHalf - 0.55 ) ) / 0.3, 2.0 ) );
hMacro += ftHeight + 2.5 * roadPaint + 1.2 * rTar + 2.0 * roadGravel;
float rDepth = mix( -10.0, 6.0, rRain ) - 6.0 * ( 1.0 - vRoadAlong.w ) - hMacro;
// measured in stones' heights: below 0 only the pores are full, at 1 the last tops go under
float rFill = clamp( rDepth / 2.4, -4.0, 1.3 );
float rRaining = step( 0.02, rRain );
roadWater = rRaining * mix( smoothstep( 0.0, 1.0, rFill ), smoothstep( -0.14, 0.14, rFill * 1.1 - rAgg.g ), rNear );
roadPuddle = rRaining * smoothstep( 0.9, 1.08, rFill + ( rAgg.g - 0.5 ) * 0.2 * rNear );
roadWater = max( roadWater, 0.4 * rCarried * smoothstep( 0.6, 0.3, rAgg.g * rNear + 0.45 * ( 1.0 - rNear ) ) ) * ( 1.0 - ftHole );
// damp darkens: the pores full, light lost inside. Driest on the crown, darkest at the water's edge.
float rSoaked = max( smoothstep( 0.0, 0.2, rRain ) * mix( 0.55, 1.0, smoothstep( -4.0, -0.3, rFill ) ), min( rCarried, 1.0 ) );
rCol *= mix( 1.0, mix( mix( 0.5, 0.8, roadPaint ), 0.9, roadMetal ), rSoaked );
rCol *= 1.0 - 0.12 * roadPuddle;
rAlpha2 *= mix( 1.0, 0.75, rSoaked );
// a broken film scatters what it mirrors, standing water does not
roadWaterRough = mix( 0.42, 0.05, smoothstep( 0.35, 1.05, rFill ) );
// (night lane) after rain the whole surface is wet, not only where water stands: the binder between the stones holds
// a film that mirrors lights as long soft streaks (the mirror's streaked copy), weaker on paint and dust
roadFilm = rRaining * smoothstep( 0.3, 0.7, rRain ) * ( 1.0 - roadWater ) * ( 1.0 - 0.5 * roadPaint ) * ( 1.0 - 0.7 * roadGravel ) * ( 1.0 - ftHole );
roadTiltGain *= 1.0 - roadWater;

diffuseColor.rgb *= rCol;
// the glare lobe: on the stones' polished tops close by (the grain breaks it up), a steady sheen further off; the
// rubbered line is glossier, water has its own mirror, paint and dust are matt
roadSheenGain = ${SHEEN.gain.toFixed(2)} * ( 1.0 - roadWater ) * ( 1.0 - 0.6 * roadPaint ) * ( 1.0 - 0.7 * roadGravel ) * ( 1.0 + 0.5 * rRubber );
roadSheenGain *= mix( 1.0, 0.3 + 1.4 * smoothstep( 0.35, 0.75, rAgg.g ), rNear );
roadIsoKeep = mix( ${SHEEN.keep.toFixed(2)}, 1.0, max( roadWater, roadPaint * 0.5 ) );
// the sky's sheen: the dry road's (standing water shows the mirror or the environment map itself)
roadSkySheen = ${SKY_SHEEN.gain.toFixed(2)} * ( 1.0 - roadWater ) * ( 1.0 - 0.5 * roadGravel );
roadSkySheen *= mix( 1.0, 0.4 + 1.2 * smoothstep( 0.35, 0.75, rAgg.g ), rNear );
// the stones' tilts that a pixel averages away come back as roughness (see roadTextures.js)
float rRoughDry = pow( clamp( rAlpha2 + rVariance * roadTiltGain * roadTiltGain, 0.0004, 1.0 ), 0.25 );
roadRoughness = mix( rRoughDry, roadWaterRough, roadWater );
`;

const ASPHALT_NORMAL = /* glsl */ `
{
  vec3 n0 = normal;
  vec3 alongV = ( viewMatrix * vec4( vRoadAlong.xyz, 0.0 ) ).xyz;
  alongV = normalize( alongV - n0 * dot( alongV, n0 ) );
  vec3 acrossV = cross( n0, alongV ); // towards +lat, the left
  vec3 bent = n0 + ( acrossV * roadTilt.x + alongV * roadTilt.y ) * roadTiltGain * ( 0.3 + 0.7 * roadFade );
  // what stands proud (paint, tar, a patch's lip) or is cut in (a cover, a grating): its slope from one pixel to the next
  vec3 dPx = - dFdx( vViewPosition );
  vec3 dPy = - dFdy( vViewPosition );
  vec3 r1 = cross( dPy, n0 );
  vec3 r2 = cross( n0, dPx );
  float det = dot( dPx, r1 );
  // (multiplied by the sign, never divided by it: sign( 0 ) is 0, and a road seen exactly edge-on, as the car's
  // reflection probe can see it, would be 0 / 0: one such pixel is enough to bloom the whole picture white)
  vec3 grad = sign( det ) * ( dFdx( roadBump ) * r1 + dFdy( roadBump ) * r2 ) / max( abs( det ), 1.0e-10 );
  grad *= roadFade * ( 1.0 - roadPuddle ) / max( 1.0, length( grad ) );
  normal = normalize( bent - grad );
  roadSheenNormal = normalize( mix( n0, normal, ${SHEEN.grain.toFixed(2)} ) );
}
`;

const ASPHALT_BEADS = /* glsl */ `
{
  // glass beads in the paint: light from a head lamp comes back towards the lamp, so a driver sees the lines lit
  // far beyond what their diffuse white would show
  vec3 toEye = normalize( cameraPosition - vRoadWorld.xyz );
  float retro = 0.0;
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 l = uBeamPos[ i ] - vRoadWorld.xyz;
    float d = max( length( l ), 1.0 );
    l /= d;
    float cone = smoothstep( 0.86, 0.975, dot( -l, uBeamDir[ i ] ) );
    float e = uBeamPower[ i ] * cone * max( l.y, 0.0 ) / ( d * d );
    float a = acos( clamp( dot( l, toEye ), -1.0, 1.0 ) );
    retro += e * exp( -a * a / 0.018 );
  }
  // (under standing water the beads are drowned: they need air behind the glass to send light back)
  totalEmissiveRadiance += roadPaint * 0.9 * retro * vRoadWorld.w * ( 1.0 - 0.8 * roadPuddle ) * vec3( 1.0, 0.98, 0.93 );

  // The head lamps' pool. Lit at a glancing angle, asphalt sends much of the light back the way it came (each stone
  // shades the next; its lit faces look back at the lamp): a driver sees the road ahead brighter than its cosine
  // says, the far end of the pool most of all. The beam's shape is the lamp's own (assets/car/lamps.js): a cut-off
  // just under the horizontal, dimmer the steeper it points down, wide across. Water mirrors it away instead.
  vec3 pool = vec3( 0.0 );
  for ( int i = 0; i < ${BEAMS}; i ++ ) {
    vec3 v = vRoadWorld.xyz - uBeamPos[ i ];
    float d = max( length( v ), 1.0 );
    v /= d;
    vec3 ax = uBeamDir[ i ];
    vec3 axUp = normalize( vec3( 0.0, 1.0, 0.0 ) - ax * ax.y );
    vec3 axRight = cross( ax, axUp );
    float vert = degrees( asin( clamp( dot( v, axUp ), -1.0, 1.0 ) ) );
    float side = degrees( asin( clamp( dot( v, axRight ), -1.0, 1.0 ) ) );
    float cutOff = -0.57 + min( 1.1, max( 0.0, side ) * 0.268 );
    float edge = clamp( ( cutOff - vert ) / 0.3 + 0.5, 0.0, 1.0 );
    float depth = pow( min( 1.0, 1.5 / max( 1.5, 0.3 - vert ) ), 2.6 );
    float spread = exp( -pow( side / 17.0, 2.0 ) ) * 0.75 + exp( -pow( side / 6.0, 2.0 ) ) * 0.25;
    float e = uBeamPower[ i ] * edge * depth * spread * step( 0.0, dot( v, ax ) ) / ( d * d );
    vec3 l = -v;
    float back = exp( -pow( acos( clamp( dot( l, toEye ), -1.0, 1.0 ) ), 2.0 ) / 0.09 );
    pool += e * back;
  }
  totalEmissiveRadiance += vRoadWorld.w * pool * diffuseColor.rgb * ( 0.6 * RECIPROCAL_PI ) * ( 1.0 - 0.85 * roadPuddle ) * ( 1.0 - roadPaint ) * vec3( 0.96, 0.98, 1.0 );
}
`;
