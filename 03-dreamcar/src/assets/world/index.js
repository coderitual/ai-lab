// The world the car drives through: createWorld() builds it from the Track
// and returns the one object the game talks to. It assembles:
//   lighting.js     the numbers, one table per time of day (sky, fog, lamps, wetness, exposure, the grade)
//   atmosphere.js   haze: the helper every world material is patched with
//   sky.js          the dome, the clouds, the stars
//   environment.js  the sky as an environment map, one per time of day
//   sun.js          the sun or moon, its shadow, the fill light
//   terrain.js, groundMaterial.js   the mountain (height field, band, grid, far land, baked light), its one
//                   ground material and the grass's one green (GRASS)
//   road.js         the pavement and its asphalt, its wetness and the wet road's mirror (with PlanarMirror)
//   kerbs.js        the red and white kerbs on the margins, from track.kerbs
//   rock.js         the cut rock faces at the rock edges
//   approach.js     the meadow on the tunnel's approach, as numbers (terrain, tunnel, forest, cover, meadow.js)
//   lake.js         the water beside the straight
//   far.js          the mountains on the horizon, mist in the valleys, the village's lights at night
//   forest.js       the trees (treeGeometry.js, forestTextures.js), planted from the Track and the ground
//   groundCover.js  grass, bushes and rocks along the verges and under the trees
//   structures.js   what people built: lamps (lamps.js), tunnels, viaducts, rails, walls and the circuit's
//                   dressing (dressing.js: the start, boards, tyre walls, pits, town)
//   studs.js        lit road studs (none on the circuit: the Track has no stud lines)
// Whatever runs the length of the lap in one mesh (structures, kerbs, rock) is cut into 400 m pieces here.
//
// Three rules the parts keep between them:
//  - The scene always holds the same lights. setTime changes what they are,
//    never how many there are, so the time of day switches without a shader
//    being compiled.
//  - Whatever depends on where a view is (the shadow's square, the fog a
//    standard material sees, how much sky is over the car) is set in
//    prepareView, once for each view, straight before it is drawn.
//  - Nothing moves outside update(): the clouds drift with the run's own
//    clock, so `?manual&t=` is the same picture every time.

import * as THREE from 'three';
import { createAtmosphere } from './atmosphere.js';
import { createEnvironment } from './environment.js';
import { TIMES, placeLights } from './lighting.js';
import { createGroundMaterial } from './groundMaterial.js';
import { createLake } from './lake.js';
import { createFar } from './far.js';
import { CASTER_LAYER, createForest } from './forest.js';
import { createGroundCover } from './groundCover.js';
import { selectBake } from './shading.js';
import { createSky } from './sky.js';
import { SHADOW, createSun } from './sun.js';
import { chunk } from '../../engine/chunks.js';
import { createRoad } from './road.js';
import { createRockFaces } from './rock.js';
import { keepOut as startKeepOut } from './startPlan.js';
import { createStructures } from './structures.js';
import { concreteCut } from './tunnel.js';
import { createStuds } from './studs.js';
import { createKerbs } from './kerbs.js';
import { ROW_STEP, createTerrain } from './terrain.js';
import { PlanarMirror } from '../../engine/PlanarMirror.js';
import { TIERS, forDevice } from '../../engine/caps.js';

/**
 * The wet road's planar reflection, per tier: the target's height against the view's, how far it reaches (m), and
 * the length of its streaked copy (a share of its height: the long streaks of lamps in wet asphalt). Low: none (the
 * asphalt keeps its speculars and the environment map, and glints with the nearest lamps). Only with half-float
 * targets.
 */
const MIRROR = { medium: { scale: 0.35, far: 220, streak: 0.3 }, high: { scale: 0.5, far: 320, streak: 0.3 } };

/**
 * (finish lane) How far from the eye (m) the small things along the road are drawn, per tier: rail posts and beams,
 * kerbs, the lamps' poles, arms and housings, the low dressing (tyre walls, huts, fences). A piece (400 m) whose
 * sphere lies wholly beyond this is not drawn in any pass of that view. At these distances a post or a kerb is less
 * than a pixel on a phone and lies in the haze; each piece was a draw call. The lamps' heads, cones and glow, the
 * boards and the buildings are not in the list: they read from far away.
 */
const SMALL_REACH = { low: 300, medium: 500, high: 800 };
/** Which (by name), and how many times SMALL_REACH: the barriers are long lines that read further than a post. */
const SMALL = new Map([
  ['rail-beams', 2],
  ['viaduct-rails', 2],
  ['kerbs', 1],
  ['lamp-fittings', 1],
  ['viaduct-joints', 1],
]);

/**
 * (perf lane) The ladder's `detail` rung: what the forest's detail distances are multiplied by while it is shed. On
 * medium the full trees then end at 41 m instead of 58 and the reduced ones at 56 instead of 80; the impostors
 * that take their place are two triangles each.
 */
const DETAIL_SHED = 0.7;

/**
 * @typedef {object} Beam one car's head lamps, for whatever answers them (reflectors), and its tail lamps (the wet
 *   road's red streaks)
 * @property {THREE.Vector3} pos @property {THREE.Vector3} dir
 * @property {number} low 0..1 @property {number} high 0..1
 * @property {THREE.Vector3} [tailL] @property {THREE.Vector3} [tailR] the tail lamps' middles
 * @property {number} [tail] 0..1 the tail lamps @property {number} [brake] 0..1 the brake lamps
 *
 * @typedef {object} World
 * @property {THREE.Scene} scene
 * @property {import('./lighting.js').TimeOfDay} time the time of day now showing
 * @property {(name: 'day'|'night') => import('./lighting.js').TimeOfDay} setTime switch the whole world: sun or moon,
 *   sky, haze, environment map, fill, lamps
 * @property {(dt: number, simTime: number) => void} update fixed step, deterministic (anything animated)
 * @property {(camera: THREE.Camera, focus: THREE.Vector3, beams?: Beam[], hidden?: THREE.Object3D[]) => void} prepareView
 *   before each view is drawn (and before its reflection probe, if that is drawn first): puts the shadow map round
 *   `focus` (the view's car) and asks for it to be drawn again, sets the fog for this camera, shuts the sky's light
 *   out where the car is in the tunnel and draws the wet road's mirror, leaving out `hidden` as well (what lies on
 *   the road and would hide the cars' own reflections: their contact shadows, smoke, spray). A view drawn without
 *   it has last view's shadows. The trees that cast into the map are chosen by the map's box (forest.js), never by
 *   where the car stands, so two views of the same place shade it alike.
 * @property {import('./sun.js').ShadowBox} shadowBox the shadow map's box as prepareView last placed it (for tests)
 * @property {(n: number) => void} setStartLights the gantry's countdown lamps, 0..5 lit
 * @property {THREE.Object3D[]} probeHidden what to hide while a reflection probe is drawn
 * @property {number} wetness 0..1 road wetness: the time of day's (lighting.js), unless ?wet= or a setter overrides it
 * @property {import('./atmosphere.js').Atmosphere} atmosphere the haze; `atmosphere.patch(material)` makes a
 *   material of one's own fade into it
 * @property {(shed: boolean) => void} setDetail the ladder's `detail` rung (caps.js LADDER): shed, the trees go to
 *   their simpler forms at DETAIL_SHED of the tier's distances and the wood's floor reaches that much less far
 * @property {() => void} refresh apply the numbers of lighting.js again after they were changed by hand
 * @property {() => void} restore draw again what only lived on the GPU, after a lost WebGL context has come back
 * @property {() => void} dispose
 */

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {import('../../engine/caps.js').Caps} options.caps
 * @param {import('../../engine/caps.js').Tier} options.tier
 * @param {object} options.track the Track (game/track.js): the road and its corridor
 * @param {import('../../engine/rng.js').Rng} options.rng
 * @param {import('../../engine/params.js').Params} options.params
 * @param {(x: number, z: number) => boolean} [options.keepOut] where no tree may stand (the start area, the town)
 * @returns {World}
 */
export function createWorld({ renderer, caps, tier, track, rng, params, keepOut }) {
  const scene = new THREE.Scene();
  /** Start-up milliseconds of each part (world.stats.ms). */
  const ms = {};
  let clock = performance.now();
  const lap = (name) => {
    const now = performance.now();
    ms[name] = Math.round(now - clock);
    clock = now;
  };
  // (sky lane) the sun and the moon stand where they do relative to the start straight: turn them to its heading
  {
    const line = track.frameAt(0, {});
    placeLights(Math.atan2(line.tan.x, line.tan.z) / (Math.PI / 180));
  }
  const atmosphere = createAtmosphere(caps);
  const sky = createSky({ tier, rng: rng.fork('sky'), atmosphere });
  lap('sky');
  const environment = createEnvironment({ renderer, caps, sky, atmosphere });
  const sun = createSun({ renderer, tier, caps, shadows: params.shadows });
  // (look lane) the sun's shadow map is drawn by the view's own render, not by a probe or mirror before it
  scene.onBeforeRender = (_renderer, _scene, camera) => sun.beforeRender(camera);
  const groundMaterial = createGroundMaterial({ caps, tier, atmosphere });
  lap('groundMaterial');
  const terrain = createTerrain({
    track,
    tier,
    rng: rng.fork('terrain'),
    material: groundMaterial.material,
    lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir, dusk: TIMES.dusk?.sun.dir },
  });
  lap('terrain');
  const mirror = MIRROR[tier] && caps.hdr ? new PlanarMirror(renderer, caps, MIRROR[tier]) : null;
  if (mirror) mirror.uniforms.uMirrorPlane = { value: new THREE.Vector4(0, 1, 0, 0) };
  const road = createRoad({ track, caps, tier, atmosphere, terrain, rowStep: ROW_STEP[tier] ?? 1, mirror });
  lap('road');
  const kerbs = createKerbs({ track, caps, tier, atmosphere, terrain });
  lap('kerbs');
  // (the tunnel's cuttings are concrete: tunnel.js builds them where concreteCut says)
  const rock = createRockFaces({ track, terrain, tier, rng: rng.fork('rock'), except: (s) => !!concreteCut(track, s) });
  lap('rock');
  const lake = createLake({ caps, atmosphere, heightAt: terrain.heightAt, ...terrain.lake });
  lap('lake');
  // (the trees' alpha becomes coverage where the scene target is multisampled: the pipeline's rule, caps.js)
  const coverage = (TIERS[tier]?.msaa ?? 0) > 0 && !(caps.hdr && !caps.msaaHdr) && caps.maxSamples > 0;
  // no tree where the pit building, the stand and the towns stand (startPlan.js), nor where the caller says
  const built = startKeepOut(track, terrain.heightAt);
  const noTrees = keepOut ? (x, z) => built(x, z) || keepOut(x, z) : built;
  const forest = createForest({ renderer, track, terrain, tier, caps, coverage, rng: rng.fork('forest'), atmosphere, shadow: forDevice(SHADOW, tier, caps), keepOut: noTrees });
  // the trees' shadow-only proxies live on a layer only the sun's shadow camera sees
  sun.light.shadow.camera.layers.enable(CASTER_LAYER);
  lap('forest');
  const cover = createGroundCover({ track, terrain, tier, rng: rng.fork('cover'), atmosphere, uniforms: forest.uniforms });
  lap('cover');
  const far = createFar({ track, terrain, caps, tier, rng: rng.fork('far'), atmosphere });
  far.setPixelRatio(renderer.getPixelRatio());
  lap('far');
  const structures = createStructures({ track, terrain, caps, tier, atmosphere, rng: rng.fork('structures'), glints: road.glints });
  lap('structures');
  const studs = createStuds({ track, caps });
  lap('studs');

  // (picture lane) whatever runs the length of the lap in one mesh (rails, posts, kerbs, the lamps' glow) is cut
  // into 400 m pieces, so that each pass draws only the pieces it can see (engine/chunks.js). Smaller pieces cull
  // more triangles but cost more draw calls: the low tier has 150 of those.
  const chunked = [structures.group, kerbs.mesh, rock.group].map((root) => chunk(root, { cell: 400, minRadius: 300 }));
  // the pieces of the small things, and the low dressing's patches, each with its sphere (SMALL_REACH)
  const small = [];
  for (const root of [structures.group, kerbs.mesh]) {
    root.traverse((o) => {
      const piece = o.parent?.userData.chunked && SMALL.has(o.parent.name);
      const lowDressing = o.isMesh && o.parent?.name === 'dressing-low';
      if (!piece && !lowDressing) return;
      const sphere = (o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere)?.clone();
      if (sphere) small.push({ object: o, sphere: sphere.applyMatrix4(o.matrixWorld), reach: SMALL.get(o.parent.name) ?? 1 });
    });
  }
  const smallReach = SMALL_REACH[tier] ?? SMALL_REACH.medium;
  const eye = new THREE.Vector3();
  scene.add(studs.points, terrain.group, road.group, kerbs.mesh, rock.group, structures.group, lake.mesh, forest.group, cover.group, far.group, sky.dome, sky.stars, ...sun.objects);
  scene.fog = atmosphere.fog;

  let wetness = 0;
  /** A wetness given by hand (?wet=, or world.wetness set), which the time of day no longer changes. */
  let wetOverride = params.wet;
  const setWetness = (value) => {
    wetness = Math.min(1, Math.max(0, value));
    road.setWetness(wetness);
    forest.setWetness(wetness);
  };
  let startLights = 0;
  /** What the wet road's mirror leaves out: the road itself and what lies under or far beyond it. */
  const mirrorHidden = [road.group, kerbs.mesh, terrain.group, rock.group, lake.mesh, cover.group, far.group, ...structures.mirrorHidden];
  /** mirrorHidden and what the caller of prepareView adds (the cars' contact shadows, smoke and spray). */
  const mirrorHiddenAll = [];
  const mirrorPoint = new THREE.Vector3();
  const mirrorFrame = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
  const drawing = new THREE.Vector2();
  /** The Track sample each camera's car was last found at: the next search starts there. */
  const hints = new WeakMap();
  const spot = { index: -1, s: 0, lat: 0 };

  /** How much sky is over a point of the map, 0..1: none in the tunnel, easing at its portals. */
  function skyOver(camera, point) {
    if (!track.sky) return 1;
    track.locate(point.x, point.z, hints.get(camera) ?? -1, spot);
    hints.set(camera, spot.index);
    const a = spot.index;
    const b = (a + 1) % track.count;
    return track.sky[a] + (track.sky[b] - track.sky[a]) * (spot.s / track.ds - a);
  }

  function probeLeavesOut() {
    const list = [kerbs.mesh, cover.group];
    if (tier === 'low') {
      forest.group.traverse((o) => {
        if (/^forest-(reduced|full|floor)-/.test(o.name)) list.push(o);
      });
      // and the small things along the road (SMALL): less than a texel of a 64-texel face
      for (const p of small) list.push(p.object);
    }
    return list;
  }

  /** @type {World} */
  const world = {
    scene,
    time: null,
    // (finish lane) the probe's faces leave out the kerbs and the ground cover, and on the low tier (64 texels) the
    // near trees (the impostors stay) and the small things: a face cost thirty to fifty draw calls, a sixth of the
    // frame's budget
    probeHidden: [sky.stars, ...structures.probeHidden, ...probeLeavesOut()],
    /** The wet road's planar reflection (null on the low tier): its target, camera, last cost (`ms`). */
    mirror,
    atmosphere,
    terrain,
    /** The trees (forest.js): where they stand (woodAt, turnedAt), single trees for the viewer (specimen). */
    forest,
    /** The sun's shadow map's box as the last prepareView placed it (sun.js), for tests. */
    shadowBox: sun.box,
    /** Start-up milliseconds per part, and the terrain's own counts. */
    stats: { ms, chunked, small: small.length, terrain: terrain.stats, structures: structures.stats, studs: studs.stats, kerbs: kerbs.stats, forest: forest.stats, far: far.stats, cover: cover.stats },

    setTime(name) {
      const time = TIMES[name];
      world.time = time;
      atmosphere.setTime(time);
      sky.setTime(time);
      selectBake(name);
      // the road's wetness follows the time of day unless ?wet= (or whoever set world.wetness) says otherwise
      if (wetOverride == null) setWetness(time.wetness ?? 0);

      const { ambient, sky: dome } = time;
      const above = ambient.sky.map((v) => v * ambient.intensity);
      const below = ambient.ground.map((v) => v * ambient.intensity);
      if (!environment.available) {
        // No environment map: the fill also has to be the sky. A sky of radiance L lays PI * L on the ground;
        // most of what reaches level ground comes from high up, where the sky is nearer its zenith's colour.
        for (let i = 0; i < 3; i++) {
          above[i] += Math.PI * (0.7 * dome.zenith[i] + 0.3 * dome.horizon[i]) * time.env.intensity;
          below[i] += Math.PI * dome.ground[i] * time.env.intensity;
        }
      }
      sun.setTime(time, above, below);
      scene.environment = environment.get(name);
      scene.environmentIntensity = time.env.intensity;
      forest.setTime(time);
      far.setTime(time);
      structures.setTime(time);
      studs.setTime(time);
      groundMaterial.setTime(time);
      return time;
    },

    update(dt, simTime) {
      sky.update(dt, simTime);
      lake.update(simTime);
      forest.update(dt, simTime);
      far.update(dt, simTime);
      structures.update(dt);
    },

    prepareView(camera, focus, beams, hidden = null) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      for (const p of small) p.object.visible = p.sphere.center.distanceTo(eye) - p.sphere.radius < smallReach * p.reach;
      sun.prepareView(camera, focus);
      forest.prepareView(camera, focus, sun.box);
      cover.prepareView(camera);
      road.setBeams(beams);
      structures.prepareView(camera, focus, beams);
      atmosphere.prepareView(camera);
      renderer.getDrawingBufferSize(drawing);
      const viewHeight = Math.min(drawing.y, drawing.x / (camera.aspect || 1));
      studs.prepareView(camera, viewHeight);
      // The environment map and the fill are the open sky's light. It does not follow the car into the tunnel
      // (the sun is kept out by its shadow map; these two have none).
      const open = skyOver(camera, focus);
      scene.environmentIntensity = world.time.env.intensity * open;
      sun.setFill(open);
      // the wet road's reflection, about the road's plane under this view's car (skyOver has just located it)
      if (mirror) {
        // (tunnel lane) not under the tunnel's roof, where the road is dry and the wet road outside is a patch of light
        // in the far mouth: there the mirror's draw calls go to the car's probe instead (PROBE.tunnelFaces)
        if (wetness > 0.02 && camera.isPerspectiveCamera && open > 0.02) {
          const s = Math.min(track.length - 1e-3, Math.max(0, spot.s));
          const lat = Math.max(-track.halfWidth, Math.min(track.halfWidth, spot.lat));
          track.frameAt(s, mirrorFrame);
          track.pointAt(s, lat, mirrorPoint);
          mirror.uniforms.uMirrorPlane.value.set(mirrorFrame.up.x, mirrorFrame.up.y, mirrorFrame.up.z, -mirrorFrame.up.dot(mirrorPoint));
          mirrorHiddenAll.length = 0;
          mirrorHiddenAll.push(...mirrorHidden);
          if (hidden) mirrorHiddenAll.push(...hidden);
          // the lamps' heads as soft halos, which only the mirror sees (lamps.js HALO)
          structures.halos?.show(Math.max(16, Math.round(viewHeight * mirror.scale)));
          mirror.render(scene, camera, mirrorPoint, mirrorFrame.up, mirrorHiddenAll, viewHeight);
          structures.halos?.hide();
        } else mirror.uniforms.uMirrorOn.value = 0;
      }
    },

    setDetail(shed) {
      forest.setDetail(shed ? DETAIL_SHED : 1);
    },

    setStartLights(n) {
      startLights = n;
      structures.setStartLights(n);
    },

    get startLights() {
      return startLights;
    },

    get wetness() {
      return wetness;
    },
    set wetness(value) {
      wetOverride = value;
      setWetness(value);
    },

    refresh() {
      environment.build();
      world.setTime(world.time.name);
    },

    restore() {
      // The environment maps went with the old context. They are dropped, not disposed: three.js would try to
      // delete GL objects that no longer belong to anything.
      environment.forget();
      world.refresh();
    },

    dispose() {
      environment.dispose();
      sun.dispose();
      sky.dispose();
      forest.dispose();
      far.dispose();
      cover.dispose();
      terrain.dispose();
      road.dispose();
      lake.dispose();
      rock.dispose();
      structures.dispose();
      studs.dispose();
      kerbs.dispose();
      groundMaterial.dispose();
      mirror?.dispose();
    },
  };

  if (wetOverride != null) setWetness(wetOverride);
  environment.build();
  lap('environment');
  world.setTime(params.time);
  world.update(0, 0);
  ms.total = Object.values(ms).reduce((a, b) => a + b, 0);
  return world;
}
