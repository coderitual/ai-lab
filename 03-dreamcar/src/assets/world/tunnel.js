// The tunnel: for each of the Track's tunnels a cut-and-cover box, a portal
// at each end, the cuttings that lead to them and the ground closed over the
// portals' cuts. The owner's video (docs/design.md, "The tunnel") is the
// spec for the inside, the cutting with its acoustic screens and the exit
// portal; the entrance is set into a meadow on the hillside, after a
// photograph ("The approach to the tunnel"; entrance.js, approach.js).
//
// The box (measured in the road's frame: `s` along it, `lat` to the left, `h`
// up from the centre line's height; the section is upright, not banked): a
// raised walkway whose kerb face stands at the Track's solid edge (what the
// cars hit), a wall of cast panels behind it, a chamfered haunch and a flat
// ceiling at TUNNEL.height. Along the haunches the two lines of LED
// luminaires: emissive fittings, packed close in the entrance zone and spaced
// out inside, that bloom and that the cars' reflection probes mirror as
// streaks. Under the ceiling the services (a pipe run, a cable tray, pairs of
// jet fans, lane signals); on the walls green guidance lights, lit emergency
// doors and signs, fire points.
//
// The light on the walls and the ceiling is the Track's tunnel lamps', baked
// into the box's material: the shader knows where every lamp of the rows is
// (they are evenly spaced, so the nearest few are found from the fragment's
// distance along the box) and sums what each lays on the surface, as lamps.js's
// spot lights would, times the lamp's own gain (the entrance zone's lamps are
// brighter) and one minus its share of the real light pool, so the lamps near
// the car light the walls for real and the sum does not change when one is
// handed over. Daylight reaches a few metres in from each portal: the box's
// vertices carry an openness that scales the sun and the sky's light (the
// same `aBake` the terrain carries). The fittings' radiance is not a light:
// the number of real lights in the scene is fixed (lamps.js's pool).
//
// What the road mirrors of all this, the lines of light and the tail lamps in
// the dry asphalt, is road.js's (TUNNEL_SHEEN), from BORE_UNIFORMS set here.
//
// Everything of one material is one mesh per tunnel: the box, the emitters
// (fittings, signs, signals: vertex colours carry their radiance), the painted
// steel and fittings, the concrete of the portals and cuttings, the acoustic
// screens; world/index.js cuts them into 400 m pieces.

import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE } from '../../engine/glsl.js';
import { PROBE_LAYER } from '../../engine/ReflectionProbe.js';
import { levelFrame } from './furniture.js';
import { GLOW, PAINT, Parts, UNIT_BOX, pictogram, place } from './parts.js';
import { LAMP_KINDS, SPOT_GLSL } from './lamps.js';
import { BORE_UNIFORMS, extend, withBake } from './shading.js';
import { APPROACH, approachesOf } from './approach.js';
import { buildApron, buildEntrance, buildLowWalls } from './entrance.js';

/** The ceiling over the road: TUNNEL.height in game/trackLayout.js (the cameras keep under it). */
const CEILING = 6.4;
/** The walkway behind the kerb (its face is the Track's solid edge): width and height (m). */
const WALK = { width: 1.0, height: 0.22 };
/** The chamfer where wall meets ceiling: how far across and how far down (m). */
const HAUNCH = { across: 0.9, down: 0.7 };
/** The wall's cast panels: length along the road, and the joint along them over the dado (m). */
const PANEL = 5;
const DADO = 1.15;
/** The box's shell, for the reveal at the portals (m). */
const SHELL = 0.5;
/** Rows of the box along the road: one every this many metres, per tier (its faces are flat: a 1000 m bend needs few). */
const ROW = { low: 4, medium: 2, high: 2 };
/** The box's own light bounced about, as a share of what one lamp lays on the wall beside it. */
const BOUNCE = 0.45;
/**
 * The luminaires: how far in from the wall (m, on the ceiling at the haunch's foot), their emitter's size across and
 * along, the gap between a pair's two bars, and the zones: pairs of bars every `entrance[1]` m over the first
 * `entrance[0]` m, single bars every `transition[1]` m to `transition[0]` m in and over the last `exit[0]` m, and
 * every `interior` m between. Their radiance is LAMP_KINDS.tunnel.head times its colour.
 */
const LUMINAIRE = { inset: 1.15, across: 0.24, along: 1.25, alongPair: 0.7, pair: 0.34, entrance: [60, 2.0], transition: [130, 3.0], exit: [36, 3.0], interior: 6 };
/**
 * What the cars' reflection probes see of the fittings instead (a stand-in on PROBE_LAYER): a bar as wide as `across`
 * (m) and `along` times as long, at `radiance` of the fittings' own. A fitting 0.24 m wide 5 m away is half a texel of a
 * 128-texel face: it flickered in and out of the paint and lost half its light in the filter.
 */
const PROBE_BAR = { across: 0.6, along: 1.2, radiance: 0.8 };
/** An emergency door with its lit frame and a green sign over it every NICHE m (alternating sides); a fire point between. */
const NICHE = 60;
/** Green guidance lights along both walls, every GUIDE m, GUIDE_H over the road. */
const GUIDE = 12.5;
const GUIDE_H = 1.0;
/** Jet fans: a pair every FANS m, the first FAN_FIRST m in. Lane signals every SIGNALS m (and at the entrance). */
const FANS = 110;
const FAN_FIRST = 70;
const SIGNALS = 120;
/** The three lanes' middles (m left of the centre line): where the lane signals hang. */
const LANES = [4, 0, -4];
/**
 * Daylight in the mouth: seen from deep inside, the opening is a white glare (the eye, and the frame's exposure, are
 * set for the lamps). A veil across each opening adds `veil` times the haze's brightness (so it is the time of day's
 * own: nothing at night), in full for an eye more than `far` m inside the box and clearing to nothing over the last
 * `near` m; `grey` of the haze's colour is lost in it.
 */
const MOUTH = { veil: 1.3, near: 12, far: 70, grey: 0.7 };
/** How far daylight carries into the box (m to fall to a third). */
const DAYLIGHT = 5;
/** The portal: how far its face reaches beyond the walls, the lintel over the mouth (height, how far it stands out). */
const FACE_WIDE = 9;
const LINTEL = { height: 1.1, out: 0.6 };
/**
 * Concrete instead of the rock faces (rock.js leaves these stretches to us: concreteCut). After the exit upright
 * retaining walls for `exit` m; beside the mouth they stand up to `back` m behind the solid edge (the terrain's cliff
 * rises from 0.8 m behind it: terrain.js FOOT). Before the entrance, for `entrance` m, there is no cutting at all: a
 * meadow, and a low wall at the edge (approach.js, entrance.js).
 */
const CUT = { entrance: APPROACH.before + APPROACH.ease, exit: 110, back: 0.7 };
/** The acoustic screens on the exit's walls: `screen` m high at the portal, `rise` higher every `step` m, up to `top`; posts every `post` m. */
const SCREEN = { screen: 2.4, step: 26, rise: 0.6, top: 4.2, post: 4 };
/** The sign gantry over the approach to the entrance: how far before the portal, the bottom chord's height. */
const GANTRY = { before: 185, height: 6.6 };

/**
 * Where the tunnel's own walls take the place of the rock faces: 'slope' (the meadow's low walls before an entrance),
 * 'screen' (the retaining walls after an exit) or null. rock.js draws no rock there.
 * @param {object} track @param {number} s
 */
export function concreteCut(track, s) {
  for (const t of track.tunnels ?? []) {
    // (and the first metres inside: the terrain keeps the approach's low wall to the row behind the face)
    if (track.delta(t.s0 - CUT.entrance, s) >= 0 && track.delta(s, t.s0) >= -8) return 'slope';
    if (track.delta(t.s1, s) >= 0 && track.delta(s, t.s1 + CUT.exit) >= 0) return 'screen';
  }
  return null;
}

/** Half the box's section, the left side (lat > 0), from the kerb's foot to the middle of the ceiling: [lat, h, nLat, nH], the normal into the box; corners doubled. */
function halfSection(W) {
  const Wb = W + WALK.width;
  const hl = Math.hypot(HAUNCH.across, HAUNCH.down);
  const hn = [-HAUNCH.down / hl, -HAUNCH.across / hl];
  return [
    [W, -0.15, -1, 0],
    [W, WALK.height, -1, 0],
    [W, WALK.height, 0, 1],
    [Wb, WALK.height, 0, 1],
    [Wb, WALK.height, -1, 0],
    [Wb, DADO, -1, 0],
    [Wb, CEILING - HAUNCH.down, -1, 0],
    [Wb, CEILING - HAUNCH.down, ...hn],
    [Wb - HAUNCH.across, CEILING, ...hn],
    [Wb - HAUNCH.across, CEILING, 0, -1],
    [0, CEILING, 0, -1],
  ];
}

/** The whole section, right kerb to left kerb under the ceiling. */
function section(W) {
  const half = halfSection(W);
  const right = half.map(([l, h, nl, nh]) => [-l, h, -nl, nh]);
  return [...right, ...half.reverse().slice(1)];
}

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js: heightAt, bakeAt, cliffAt, material
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {ReturnType<import('./lamps.js').createLamps>} options.lamps the lamp pool (its `shares`: on, real share and gain per lamp)
 * @param {import('../../engine/caps.js').Tier} [options.tier]
 */
export function createTunnels({ track, terrain, atmosphere, lamps, tier = 'medium' }) {
  const group = new THREE.Group();
  group.name = 'tunnels';
  const frame = {};
  const disposables = [];
  const low = tier === 'low';
  /** The veils of daylight in the mouths: their material, a point of the sheet and the way out. */
  const veils = [];
  /** What the reflection probes leave out: the emitters as the eye sees them (they see a stand-in: PROBE_BAR). */
  const probeHidden = [];
  const eye = new THREE.Vector3();
  const spec = LAMP_KINDS.tunnel;
  const approaches = approachesOf(track);

  // materials, shared by every tunnel
  const glowMaterial = atmosphere.patch(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }));
  const paintMaterial = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }));
  const concrete = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }));
  concreteDetail(concrete);
  const screenMaterial = screenShader(atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide })));
  disposables.push(glowMaterial, paintMaterial, concrete, screenMaterial);

  track.tunnels.forEach((t, which) => {
    // the kerb's face stands at the Track's solid edge in the box (TUNNEL.wallOffset beyond the pavement)
    const W = track.edgeAt((t.s0 + t.s1) / 2, 1);
    const Wb = W + WALK.width;
    const tunnelLamps = lamps.lamps.filter((l) => l.kind === 'tunnel' && l.s >= t.s0 - 1 && l.s <= t.s1 + 1);
    const first = tunnelLamps.length ? Math.min(...tunnelLamps.map((l) => l.index)) : 0;
    const rows = Math.max(1, tunnelLamps.length / 2);
    const lampLat = tunnelLamps.length ? Math.abs(tunnelLamps[0].lat) : W - 0.2;
    const lampH = tunnelLamps.length ? tunnelLamps[0].head.y - track.frameAt(tunnelLamps[0].s, frame).pos.y : CEILING - 0.3;
    const leftFirst = tunnelLamps.length && tunnelLamps[0].side > 0;
    const glow = new Parts();
    const probeGlow = new Parts();
    const paint = new Parts();
    const cast = new Parts();
    const screens = new Parts();

    // ---- the box, portal to portal
    const pts = section(W);
    const length = t.s1 - t.s0;
    const steps = Math.ceil(length / (ROW[tier] ?? 2));
    const rowsOut = [];
    const local = [];
    const localN = [];
    const bake = [];
    for (let r = 0; r <= steps; r++) {
      const s = t.s0 + (length * r) / steps;
      levelFrame(track, s, frame);
      const inside = Math.min(s - t.s0, t.s1 - s);
      const open = Math.exp(-Math.max(0, inside) / DAYLIGHT);
      rowsOut.push(pts.map(([lat, h]) => [frame.pos.x + frame.flat.x * lat, frame.pos.y + h, frame.pos.z + frame.flat.z * lat, s]));
      local.push(pts.map(([lat, h]) => [s - t.s0, lat, h]));
      localN.push(pts.map(([, , nl, nh]) => [nl, nh]));
      bake.push(pts.map(() => [open, open, open]));
    }
    const box = stripRows(rowsOut, { aLocal: { size: 3, rows: local }, aLocalN: { size: 2, rows: localN }, aBake: { size: 3, rows: bake } });
    // the normals as drawn (the upright section turned into the road's heading), not averaged across the corners
    const normals = box.attributes.normal;
    rowsOut.forEach((rowPts, r) => {
      levelFrame(track, rowPts[0][3], frame);
      pts.forEach(([, , nl, nh], k) => normals.setXYZ(r * pts.length + k, frame.flat.x * nl, nh, frame.flat.z * nl));
    });
    const boxMaterial = boxShader(
      atmosphere.patch(withBake(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 }))),
      { lamps, first, rows, spacing: length / rows, lampLat, lampH, leftFirst, spec, W, Wb },
    );
    // what the road in the box mirrors: the walls as a lamp lights them, on average about a third of that along the
    // wall (0.45 is the walls' paint), and the lines of luminaires (road.js TUNNEL_SHEEN)
    BORE_UNIFORMS.uBoreGlow.value.fromArray(spec.color).multiplyScalar(((0.45 / Math.PI) * 0.35 * spec.intensity) / (lampH * lampH));
    BORE_UNIFORMS.uBoreLines.value.set(Wb - LUMINAIRE.inset, CEILING - 0.1, spec.head, LUMINAIRE.across);
    BORE_UNIFORMS.uBoreZone.value.set(t.s0, t.s1, LUMINAIRE.along / LUMINAIRE.interior, LUMINAIRE.exit[0]);
    BORE_UNIFORMS.uBoreLineColor.value.fromArray(spec.color);
    const boxMesh = new THREE.Mesh(box, boxMaterial);
    boxMesh.name = `tunnel-box-${which}`;
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMaterial.shadowSide = THREE.DoubleSide;
    group.add(boxMesh);
    disposables.push(box, boxMaterial);

    // ---- the luminaires: emitters on the ceiling at the haunch's foot, each in a dark housing (medium and high)
    const lumLat = Wb - LUMINAIRE.inset;
    const spacingAt = (d, toExit) =>
      d < LUMINAIRE.entrance[0] ? LUMINAIRE.entrance[1] : d < LUMINAIRE.transition[0] || toExit < LUMINAIRE.exit[0] ? LUMINAIRE.transition[1] : LUMINAIRE.interior;
    const lumColor = spec.color.map((c) => c * spec.head);
    for (let d = 1.5; d < length - 1; ) {
      const { M } = place(track, t.s0 + d);
      const pair = d < LUMINAIRE.entrance[0];
      const along = pair ? LUMINAIRE.alongPair : LUMINAIRE.along;
      for (const side of [1, -1]) {
        for (const lat of pair ? [lumLat + LUMINAIRE.pair / 2, lumLat - LUMINAIRE.pair / 2] : [lumLat]) {
          glow.add(UNIT_BOX, M(side * lat, CEILING - 0.11, 0, [LUMINAIRE.across, 0.02, along]), lumColor);
          if (!low) paint.add(UNIT_BOX, M(side * lat, CEILING - 0.05, 0, [LUMINAIRE.across + 0.1, 0.1, along + 0.1]), PAINT.housing);
        }
        probeGlow.add(UNIT_BOX, M(side * lumLat, CEILING - 0.11, 0, [PROBE_BAR.across, 0.02, along * PROBE_BAR.along]), lumColor.map((c) => c * PROBE_BAR.radiance));
      }
      d += spacingAt(d, length - d);
    }

    // ---- on the walls: guidance lights, emergency doors with lit frames and signs, fire points
    for (let d = GUIDE / 2; d < length; d += GUIDE) {
      const { M } = place(track, t.s0 + d);
      for (const side of [1, -1]) glow.add(UNIT_BOX, M(side * (Wb - 0.01), GUIDE_H, 0, [0.04, 0.12, 0.12]), GLOW.guide);
    }
    const count = Math.max(1, Math.round(length / NICHE));
    for (let k = 0; k < count; k++) {
      const d = ((k + 0.5) * length) / count;
      const side = k % 2 === 0 ? 1 : -1;
      const { M } = place(track, t.s0 + d);
      paint.add(UNIT_BOX, M(side * (Wb - 0.02), WALK.height + 1.05, 0, [0.06, 2.1, 1.2]), PAINT.door);
      for (const e of [-0.66, 0.66]) glow.add(UNIT_BOX, M(side * (Wb - 0.03), WALK.height + 1.1, e, [0.04, 2.2, 0.05]), GLOW.green);
      glow.add(UNIT_BOX, M(side * (Wb - 0.04), WALK.height + 2.55, 0, [0.06, 0.3, 0.75]), GLOW.green);
      // a fire point half way to the next door, on the other wall
      const half = length / count / 2;
      const { M: M2 } = place(track, t.s0 + (d + half < length - 5 ? d + half : d - half));
      glow.add(UNIT_BOX, M2(-side * (Wb - 0.03), WALK.height + 1.6, 0, [0.05, 0.6, 0.45]), GLOW.red);
    }

    // ---- under the ceiling: lane signals over each lane, a pipe run, a cable tray, pairs of jet fans
    const signalsAt = [6];
    for (let d = SIGNALS; d < length - 30; d += SIGNALS) signalsAt.push(d);
    for (const d of signalsAt) {
      const { M } = place(track, t.s0 + d);
      paint.add(UNIT_BOX, M(0, CEILING - 0.35, 0, [2 * (Wb - 1.2), 0.12, 0.12]), PAINT.steel);
      for (const lat of LANES) {
        paint.add(UNIT_BOX, M(lat, CEILING - 0.75, 0, [0.7, 0.7, 0.3]), PAINT.signal);
        arrow(glow, M, lat, CEILING - 0.75, -0.16, GLOW.arrow);
      }
    }
    if (!low) {
      const pipe = new THREE.CylinderGeometry(0.12, 0.12, 1, 8, 1, true).rotateX(Math.PI / 2);
      const STEP = 12;
      for (let d = 0; d < length; d += STEP) {
        const len = Math.min(STEP, length - d);
        const { M } = place(track, t.s0 + d + len / 2);
        paint.add(pipe, M(6.0, CEILING - 0.3, 0, [1, 1, len]), PAINT.pipe);
        paint.add(UNIT_BOX, M(-5.9, CEILING - 0.14, 0, [0.6, 0.08, len]), PAINT.galvanised);
        paint.add(UNIT_BOX, M(6.0, CEILING - 0.1, 0, [0.06, 0.2, 0.06]), PAINT.steel);
      }
      pipe.dispose();
    }
    {
      const sides = low ? 8 : 16;
      const shell = new THREE.CylinderGeometry(0.56, 0.56, 1, sides, 1, true).rotateX(Math.PI / 2);
      const face = new THREE.CircleGeometry(0.52, sides);
      for (let d = FAN_FIRST; d < length - 40; d += FANS) {
        const { M } = place(track, t.s0 + d);
        for (const lat of [3.1, -3.1]) {
          paint.add(shell, M(lat, CEILING - 0.82, 0, [1, 1, 3.6]), PAINT.fan);
          if (!low) for (const e of [-1.7, 1.7]) paint.add(face, M(lat, CEILING - 0.82, e, [1, 1, 1], [0, e > 0 ? 0 : Math.PI, 0]), PAINT.fanInside);
          for (const e of [-1, 1]) paint.add(UNIT_BOX, M(lat, CEILING - 0.14, e, [0.1, 0.28, 0.1]), PAINT.steel);
        }
      }
      shell.dispose();
      face.dispose();
    }

    // ---- the portals
    for (const [s, out] of [
      [t.s0, -1],
      [t.s1, 1],
    ]) {
      // the veil of daylight across the opening (MOUTH): a sheet just outside the face, additive, set per view
      {
        levelFrame(track, s, frame);
        const ahead = frame.ahead.clone().multiplyScalar(out);
        const at = frame.pos.clone().addScaledVector(ahead, 0.15);
        const corner = (lat, h) => [at.x + frame.flat.x * lat, at.y + h, at.z + frame.flat.z * lat];
        const sheet = new THREE.BufferGeometry();
        sheet.setAttribute('position', new THREE.Float32BufferAttribute([...corner(-Wb, -0.2), ...corner(Wb, -0.2), ...corner(Wb, CEILING), ...corner(-Wb, CEILING)], 3));
        sheet.setIndex([0, 1, 2, 0, 2, 3]);
        const light = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const veil = new THREE.Mesh(sheet, light);
        veil.name = 'tunnel-mouth-light';
        veil.renderOrder = 2;
        // (finish lane) culled like anything else, and not drawn at all while it adds nothing (prepareView)
        sheet.computeBoundingSphere();
        group.add(veil);
        veils.push({ light, at, outward: ahead, mesh: veil });
        disposables.push(sheet, light);
      }
      // (ref lane) the entrance is set into a meadow (entrance.js): a headwall, a hood, and the ground behind them
      const entrance = out < 0;
      if (entrance) buildEntrance({ track, A: approaches[which], Wb, ceiling: CEILING, cast, paint, glow, low });
      else buildPortal({ track, terrain, s, Wb, cast, paint, glow, low });
      const lid = entrance ? buildApron({ track, terrain, A: approaches[which], low }) : buildLid(track, terrain, s, out, Wb);
      const lidMesh = new THREE.Mesh(lid, terrain.material);
      lidMesh.name = 'tunnel-lid';
      lidMesh.receiveShadow = true;
      lidMesh.castShadow = true;
      group.add(lidMesh);
      disposables.push(lid);
    }
    // ---- the low walls before the entrance, the cutting after the exit, the gantry
    buildLowWalls({ track, terrain, A: approaches[which], Wb, cast, low });
    buildCutting({ track, terrain, t, Wb, cast, paint, screens, low });
    buildGantry({ track, terrain, s: t.s0 - GANTRY.before, paint, glow, low });

    for (const [parts, material, name, shadow] of [
      [glow, glowMaterial, 'tunnel-glow', false],
      [probeGlow, glowMaterial, 'tunnel-probe-glow', false],
      [paint, paintMaterial, 'tunnel-fittings', true],
      [cast, concrete, 'tunnel-concrete', true],
      [screens, screenMaterial, 'tunnel-screens', true],
    ]) {
      if (parts.empty) continue;
      const geometry = parts.build();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // the fittings as the probes see them: on the probes' layer alone; the probes leave out what the eye sees
      if (parts === probeGlow) mesh.layers.set(PROBE_LAYER);
      if (parts === glow) probeHidden.push(mesh);
      group.add(mesh);
      disposables.push(geometry);
    }
  });

  return {
    group,
    probeHidden,
    /** The tunnel's lamps follow lighting.js (on at every time of day there is). */
    setTime(time) {
      glowMaterial.color.setScalar(time.lamps?.tunnel ?? 1);
    },
    /** Before each view: how much of the mouths' glare this eye sees (see MOUTH). @param {THREE.Camera} camera */
    prepareView(camera) {
      const haze = atmosphere.uniforms.uHazeColor.value;
      const grey = 0.2126 * haze.x + 0.7152 * haze.y + 0.0722 * haze.z;
      eye.setFromMatrixPosition(camera.matrixWorld);
      for (const v of veils) {
        const inside = -(eye.x - v.at.x) * v.outward.x - (eye.z - v.at.z) * v.outward.z;
        const k = Math.min(1, Math.max(0, (inside - MOUTH.near) / (MOUTH.far - MOUTH.near)));
        const show = MOUTH.veil * k * k * (3 - 2 * k);
        v.mesh.visible = show > 1e-4;
        v.light.color.setRGB(
          show * (haze.x + (grey - haze.x) * MOUTH.grey),
          show * (haze.y + (grey - haze.y) * MOUTH.grey),
          show * (haze.z + (grey - haze.z) * MOUTH.grey),
        );
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Rows of [x, y, z, ...] points as one indexed strip, with extra attributes; the normals are left for the caller. */
function stripRows(rows, attributes) {
  const m = rows[0].length;
  const pos = new Float32Array(rows.length * m * 3);
  rows.forEach((row, r) => row.forEach((p, k) => pos.set([p[0], p[1], p[2]], (r * m + k) * 3)));
  const index = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < m - 1; k++) {
      const a = r * m + k;
      const b = a + m;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rows.length * m * 3), 3));
  for (const [name, { size, rows: values }] of Object.entries(attributes)) {
    const data = new Float32Array(rows.length * m * size);
    values.forEach((row, r) => row.forEach((value, k) => data.set(value, (r * m + k) * size)));
    geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A lit arrow pointing down on the face of a signal box (its face `face` m along the road from the box's middle). */
function arrow(glow, M, lat, h, face, color) {
  glow.add(UNIT_BOX, M(lat, h + 0.07, face, [0.08, 0.26, 0.02]), color);
  // the head: two short bars leaning in
  glow.add(UNIT_BOX, M(lat + 0.07, h - 0.08, face, [0.07, 0.2, 0.02], [0, 0, 0.75]), color);
  glow.add(UNIT_BOX, M(lat - 0.07, h - 0.08, face, [0.07, 0.2, 0.02], [0, 0, -0.75]), color);
}

/**
 * The exit's portal (the owner's video): a plain pale headwall with the box's mouth in it, the shell's reveal, a
 * lintel over the mouth, a coping with a railing along it, signal heads beside the mouth. (The entrance is
 * entrance.js's: a headwall and a hood set into a meadow.)
 */
function buildPortal({ track, terrain, s, Wb, cast, paint, glow, low }) {
  const { P, M } = place(track, s, 1);
  const top = faceTop(terrain, P);
  const wide = Wb + FACE_WIDE;
  const deep = -4;
  const ink = [0.52, 0.52, 0.5];
  // the face: a rectangle with the mouth cut out of it
  const shape = new THREE.Shape([new THREE.Vector2(-wide, deep), new THREE.Vector2(wide, deep), new THREE.Vector2(wide, top), new THREE.Vector2(-wide, top)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-Wb, -0.3), new THREE.Vector2(-Wb, CEILING), new THREE.Vector2(Wb, CEILING), new THREE.Vector2(Wb, -0.3)]));
  const face = new THREE.ShapeGeometry(shape);
  const fp = face.attributes.position;
  const fi = face.index;
  for (let i = 0; i < fi.count; i += 3) cast.poly([0, 1, 2].map((k) => P(fp.getX(fi.getX(i + k)), fp.getY(fi.getX(i + k)), 0)), ink);
  face.dispose();
  // the reveal: the shell's thickness round the mouth
  for (const side of [1, -1]) cast.add(UNIT_BOX, M(side * (Wb + SHELL / 2), (CEILING - 0.3) / 2, -SHELL / 2, [SHELL, CEILING + 0.3, SHELL]), ink);
  cast.add(UNIT_BOX, M(0, CEILING + SHELL / 2, -SHELL / 2, [2 * Wb + 2 * SHELL, SHELL, SHELL]), ink);
  // the lintel standing out over the mouth, the coping along the top, the face's ends
  cast.add(UNIT_BOX, M(0, CEILING + LINTEL.height / 2, LINTEL.out / 2, [2 * Wb + 1.2, LINTEL.height, LINTEL.out]), ink.map((c) => c * 0.92));
  cast.add(UNIT_BOX, M(0, top + 0.2, 0.05, [2 * wide + 0.4, 0.4, 0.9]), ink.map((c) => c * 1.05));
  for (const side of [1, -1]) cast.add(UNIT_BOX, M(side * (wide - 0.3), (top + deep) / 2, -0.4, [0.6, top - deep, 0.8]), ink);

  // the parapet's railing: posts and two rails along the top
  for (let k = 0; k < (low ? 1 : 2); k++) paint.add(UNIT_BOX, M(0, top + 0.75 + 0.42 * k, 0.1, [2 * wide, 0.06, 0.06]), PAINT.galvanised);
  if (!low) for (let lat = -wide + 0.5; lat <= wide; lat += 2) paint.add(UNIT_BOX, M(lat, top + 0.8, 0.1, [0.06, 1.2, 0.06]), PAINT.galvanised);
  // signal heads hanging under the lintel's front at the mouth's corners, facing whoever comes towards it from outside
  for (const side of [1, -1]) {
    const lat = side * (Wb - 0.7);
    paint.add(UNIT_BOX, M(lat, CEILING - 0.2, LINTEL.out - 0.2, [0.06, 0.4, 0.06]), PAINT.steel);
    paint.add(UNIT_BOX, M(lat, CEILING - 0.8, LINTEL.out - 0.2, [0.36, 0.8, 0.26]), PAINT.signal);
    glow.add(UNIT_BOX, M(lat, CEILING - 1.0, LINTEL.out - 0.06, [0.2, 0.2, 0.02]), GLOW.signal);
  }
}

/** How high a portal's face stands above the road: a little above the ground just behind it. */
function faceTop(terrain, P) {
  let top = 0;
  for (const lat of [-8, 0, 8]) {
    const p = P(lat, 0, -2);
    top = Math.max(top, terrain.heightAt(p.x, p.z) - p.y);
  }
  return Math.min(11, Math.max(CEILING + LINTEL.height + 1.0, top + 0.6));
}

/**
 * The cutting after a tunnel's exit, where rock.js leaves the edge to us (concreteCut): an upright retaining wall of
 * pale concrete with a cap, and on it the acoustic screens between steel posts, stepping up away from the portal.
 * (Before the entrance there is no cutting: low walls in a meadow, entrance.js.)
 */
function buildCutting({ track, terrain, t, Wb, cast, paint, screens, low }) {
  const prof = { y: 0 };
  const step = low ? 4 : 2;
  const s0 = t.s1 - 0.5;
  const s1 = t.s1 + CUT.exit;
  for (const side of [1, -1]) {
    const rows = [];
    const screenRows = [];
    const n = Math.ceil((s1 - s0) / step);
    for (let r = 0; r <= n; r++) {
      const s = track.wrap(s0 + ((s1 - s0) * r) / n);
      const f = levelFrame(track, s, {});
      // beside the mouth the walls stand back a little towards the box's own (but never behind the foot of the
      // terrain's cliff, which would then stand in front of them)
      const solid = track.edgeAt(s, side);
      const edge = solid + Math.min(CUT.back, Math.max(0, Wb - solid));
      const yE = track.profile(s, side * solid, prof).y;
      const h = Math.max(0, terrain.cliffAt(s, side).height);
      const at = (d, y) => new THREE.Vector3(f.pos.x + f.flat.x * side * (edge + d), y, f.pos.z + f.flat.z * side * (edge + d));
      const top = yE + h;
      rows.push([at(0.02, yE - 0.5), at(0.02, top), at(0.02, top), at(0.62, top), at(0.62, top), at(0.62, top - 1.5)]);
      // the screen's height: lowest at the portal, a step up every SCREEN.step m
      const away = track.delta(t.s1, s);
      const hs = Math.min(SCREEN.top, SCREEN.screen + SCREEN.rise * Math.floor(Math.max(0, away) / SCREEN.step));
      if (h > 0.5) screenRows.push({ f, bottom: at(0.32, top), hs, topY: top });
      else screenRows.push(null);
    }
    cast.strip(rows, [0.56, 0.55, 0.52]);
    // the blue sign on the wall, on the right of whoever looks into the mouth from outside, facing the road
    if (side > 0) {
      const s = track.wrap(t.s1 + 10);
      const edge = track.edgeAt(s, side) + Math.min(CUT.back, Math.max(0, Wb - track.edgeAt(s, side)));
      pictogram(paint, place(track, s).M(side * (edge - 0.01), 2.7, 0, [1, 1, 1], [0, -Math.PI / 2, 0]));
    }
    // the screens: a flat panel from post to post, as high as the lower of its two ends (the steps are square)
    const every = Math.max(1, Math.round(SCREEN.post / step));
    screenRows.forEach((a, k) => {
      if (!a) return;
      const b = screenRows[k - 1];
      if (b) {
        const hs = Math.min(a.hs, b.hs);
        screens.poly([b.bottom, a.bottom, a.bottom.clone().setY(a.topY + hs), b.bottom.clone().setY(b.topY + hs)], [1, 1, 1]);
      }
      if (k % every === 0) {
        const m = new THREE.Matrix4().compose(
          a.bottom.clone().setY(a.topY + a.hs / 2 + 0.05),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.f.yaw),
          new THREE.Vector3(0.16, a.hs + 0.1, 0.16),
        );
        paint.add(UNIT_BOX, m, PAINT.steel);
      }
    });
  }
}

/** The sign gantry over the approach: two posts beyond the edges, a truss across, three lane signals, a camera box. */
function buildGantry({ track, terrain, s, paint, glow, low }) {
  s = track.wrap(s);
  const { P, M } = place(track, s);
  const reach = Math.max(track.edgeAt(s, 1), track.edgeAt(s, -1)) + 1.2;
  const H = GANTRY.height;
  for (const side of [1, -1]) {
    const g = P(side * reach, 0);
    const foot = terrain.heightAt(g.x, g.z) - g.y;
    paint.add(UNIT_BOX, M(side * reach, (H + 1.6 + foot) / 2, 0, [0.42, H + 1.6 - foot, 0.42]), PAINT.galvanised);
    if (!low) paint.add(UNIT_BOX, M(side * reach, foot + 0.15, 0, [0.9, 0.3, 0.9]), [0.4, 0.4, 0.38]);
  }
  // the truss: two chords, posts between them, one long diagonal
  for (const h of [H, H + 1.5]) paint.add(UNIT_BOX, M(0, h, 0, [2 * reach, 0.16, 0.16]), PAINT.galvanised);
  if (!low) {
    for (let lat = -reach + 1.5; lat < reach - 0.5; lat += 1.8) paint.add(UNIT_BOX, M(lat, H + 0.75, 0, [0.07, 1.5, 0.07]), PAINT.galvanised);
    paint.add(UNIT_BOX, M(0, H + 0.75, 0, [Math.hypot(2 * reach, 1.5), 0.05, 0.05], [0, 0, Math.atan2(1.5, 2 * reach)]), PAINT.galvanised);
    // the camera box hanging under the bottom chord on a rod
    paint.add(UNIT_BOX, M(-3.0, H - 0.6, 0, [0.04, 1.1, 0.04]), PAINT.steel);
    paint.add(UNIT_BOX, M(-3.0, H - 1.25, 0, [0.22, 0.2, 0.4]), PAINT.signal);
  }
  for (const lat of LANES) {
    paint.add(UNIT_BOX, M(lat, H - 0.55, 0, [1.1, 1.1, 0.3]), PAINT.signal);
    arrow(glow, M, lat, H - 0.55, -0.16, GLOW.arrow);
  }
  // the tunnel's pictogram on the right-hand post, facing the road before it
  pictogram(paint, M(-reach, 2.8, -0.3, [1, 1, 1], [0, Math.PI, 0]));
}

/**
 * The box's own shading: its colours from where a point is (walkway, kerb face, cast wall panels with joints and a
 * dado, grime at the foot, the ceiling's slabs and soot) and its lamps' light baked in.
 */
function boxShader(material, { lamps, first, rows, spacing, lampLat, lampH, leftFirst, spec, W, Wb }) {
  const cone = new THREE.Vector2(Math.cos(spec.angle), Math.cos(spec.angle * (1 - spec.penumbra)));
  const uniforms = {
    uShares: lamps.shares,
    uBore: { value: new THREE.Vector4(rows, spacing, lampLat, lampH) },
    uBoreLamp: { value: new THREE.Vector4(spec.intensity, spec.range, cone.x, cone.y) },
    uBoreColor: { value: new THREE.Vector3(...spec.color) },
    uBoreFirst: { value: first },
    // a lamp's axis in (along, lat, h), down and across the road by its tilt (lat's sign is the lamp's side)
    uBoreAxis: { value: new THREE.Vector3(0, Math.sin(spec.tilt), -Math.cos(spec.tilt)) },
  };
  const f = (v) => v.toFixed(3);
  return extend(material, 'tunnel-box', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLocal;\nattribute vec2 aLocalN;\nvarying vec3 vLocal;\nvarying vec2 vLocalN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = aLocal;\nvLocalN = aLocalN;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${GLSL_HASH}
${GLSL_NOISE}
${SPOT_GLSL}
varying vec3 vLocal;
varying vec2 vLocalN;
float boxRough;
uniform sampler2D uShares; // per lamp: on, share of the real pool, gain / 4
uniform vec4 uBore;      // rows, spacing, lamp lat, lamp height
uniform vec4 uBoreLamp;  // intensity, range, cos outer, cos inner
uniform vec3 uBoreColor;
uniform int uBoreFirst;
uniform vec3 uBoreAxis;
float boxGain;           // the nearest lamps' gain (for the light bounced about)
vec3 boreLampLight(vec3 P, vec3 N) {
  float sum = 0.0;
  float k0 = floor(P.x / uBore.y - 0.5);
  boxGain = 0.0;
  for (int j = -2; j <= 3; j++) {
    float k = k0 + float(j);
    if (k < 0.0 || k >= uBore.x) continue;
    float s = (k + 0.5) * uBore.y;
    for (int side = 0; side < 2; side++) {
      float lat = (side == 0 ? ${leftFirst ? '1.0' : '-1.0'} : ${leftFirst ? '-1.0' : '1.0'}) * uBore.z;
      int index = uBoreFirst + int(k) * 2 + side;
      vec3 lamp = texelFetch(uShares, ivec2(index, 0), 0).rgb;
      float gain = lamp.b * 4.0;
      if (j == 0 || j == 1) boxGain = max(boxGain, gain * lamp.r);
      float share = lamp.r * (1.0 - lamp.g) * gain;
      // each lamp leans across the road, towards the far wall
      vec3 axis = uBoreAxis * vec3(0.0, -sign(lat), 1.0);
      sum += share * spotIrradiance(P, N, vec3(s, lat, uBore.w), axis, uBoreLamp.x, uBoreLamp.y, uBoreLamp.zw);
    }
  }
  return sum * uBoreColor;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float s = vLocal.x;
  float lat = abs(vLocal.y);
  float h = vLocal.z;
  float aa = fwidth(s) + 1.0e-3;
  float fine = 1.0 - smoothstep(0.02, 0.12, aa);
  float upright = step(0.9, abs(vLocalN.x));
  float ceiling = step(${f(CEILING - HAUNCH.down - 0.02)}, h) * (1.0 - upright);
  float walkTop = (1.0 - upright) * (1.0 - ceiling);
  float kerb = upright * step(lat, ${f(W + 0.05)});
  float wall = upright * (1.0 - kerb);
  float blot = valueNoise(vec2(s * 0.31, h * 0.55 + vLocal.y * 0.4));
  float streak = valueNoise(vec2(s * 1.9, h * 0.1 + valueNoise(vec2(s * 0.27, 3.0)) * 2.0));
  // the wall: cast panels PANEL m long, each a shade of its own, with fine dark joints; a joint along the dado, the
  // foot grimed by the road's spray, a little soot up towards the haunch
  float panel = floor(s / ${f(PANEL)});
  float joint = 1.0 - smoothstep(0.01, 0.01 + aa, abs(fract(s / ${f(PANEL)} + 0.5) - 0.5) * ${f(PANEL)});
  joint = max(joint, 1.0 - smoothstep(0.008, 0.008 + fwidth(h) + 1.0e-3, abs(h - ${f(DADO)})));
  vec3 paint = vec3(0.5, 0.47, 0.41) * (0.94 + 0.08 * hash11(panel * 7.13 + sign(vLocal.y) * 3.0)) * (0.9 + 0.14 * blot);
  paint *= mix(0.72, 1.0, smoothstep(0.25, ${f(DADO + 0.2)}, h + 0.3 * (streak - 0.5)));
  paint *= mix(1.0, 0.86, smoothstep(3.5, ${f(CEILING)}, h));
  paint *= 1.0 - 0.5 * joint * fine;
  // the walkway's kerb face, pale; its top, dark and worn
  vec3 kerbCol = vec3(0.56, 0.555, 0.53) * (0.9 + 0.12 * streak);
  vec3 walkCol = vec3(0.2, 0.2, 0.19) * (0.85 + 0.25 * blot);
  // the ceiling: slabs 10 m long, sooted towards the middle
  float slab = 1.0 - smoothstep(0.015, 0.015 + aa, abs(fract(s / 10.0 + 0.5) - 0.5) * 10.0);
  vec3 ceil = vec3(0.34, 0.33, 0.31) * (0.85 + 0.2 * blot) * mix(0.7, 1.0, smoothstep(2.0, ${f(Wb - 1.0)}, lat));
  ceil *= 1.0 - 0.45 * slab * fine;
  vec3 c = paint * wall + kerbCol * kerb + walkCol * walkTop + ceil * ceiling;
  boxRough = wall * 0.62 + kerb * 0.55 + walkTop * 0.9 + ceiling * 0.88;
  diffuseColor.rgb *= c;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// the lamps' light, lamp by lamp, and what the box's own pale walls send round (BOUNCE of a lamp's light on the wall
// beside it: intensity over the square of the lamp's height above the road, times the nearest lamps' gain)
{
  vec3 lampLight = boreLampLight(vLocal, vec3(0.0, vLocalN.x, vLocalN.y));
  totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * (lampLight + uBoreColor * (${BOUNCE.toFixed(2)} * boxGain * uBoreLamp.x / (uBore.w * uBore.w)));
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = boxRough;');
  });
}

/** Cast concrete for the portals and the cuttings: board marks, soft stains and weathering running down. */
export function concreteDetail(material) {
  return extend(material, 'portal-concrete', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPortalWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPortalWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${GLSL_NOISE}\nvarying vec3 vPortalWorld;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vPortalWorld;
  float boards = 0.95 + 0.05 * hash11(floor(p.y / 0.3));
  float stain = valueNoise(vec2(p.x * 0.25 + p.z * 0.25, p.y * 0.08)) * valueNoise(vec2((p.x - p.z) * 1.3, p.y * 0.05));
  // streaks of weathering running down from the tops: fine across, long down
  float run = valueNoise(vec2((p.x + p.z) * 2.1, p.y * 0.18));
  diffuseColor.rgb *= boards * (1.0 - 0.4 * stain) * (0.86 + 0.22 * run);
}`,
      );
  });
}

/**
 * The acoustic screens: panels of vertical slats in a light anodised gold between the posts, a rail every 0.6 m; the
 * slats are shading only (a panel is one quad), so that they catch the low sun as the owner's video shows.
 */
function screenShader(material) {
  return extend(material, 'tunnel-screens', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScreenWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScreenWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${GLSL_NOISE}\nvarying vec3 vScreenWorld;\nfloat screenRib;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vScreenWorld;
  float u = (p.x + p.z) * 0.7071;
  float aa = fwidth(u) + 1.0e-3;
  float rib = fract(u / 0.16);
  screenRib = smoothstep(0.0, 0.5, rib) * smoothstep(1.0, 0.5, rib);
  screenRib = mix(0.5, screenRib, 1.0 - smoothstep(0.02, 0.08, aa));
  float rail = 1.0 - smoothstep(0.02, 0.05 + fwidth(p.y), abs(fract(p.y / 0.6 + 0.5) - 0.5) * 0.6);
  vec3 gold = vec3(0.42, 0.33, 0.17) * (0.9 + 0.15 * valueNoise(vec2(u * 0.4, p.y * 0.3)));
  diffuseColor.rgb *= mix(gold * (0.65 + 0.5 * screenRib), vec3(0.2, 0.19, 0.17), rail);
}`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + 0.35 * (screenRib - 0.5) * normalize(cross(normal, vec3(0.0, 1.0, 0.0)) + 1.0e-4));');
  });
}

/**
 * The ground over a portal: the terrain's own height function, drawn with its material, over the square the
 * terrain mesh leaves open there, kept above the box's roof inside and off the road outside.
 */
function buildLid(track, terrain, s, out, Wb) {
  const frame = levelFrame(track, s, {});
  const ahead = frame.ahead.clone().multiplyScalar(out);
  const wide = Wb + FACE_WIDE + 3;
  const cols = 24;
  const rows = 14;
  const from = -9; // inside the hill
  const to = 6; // out in front of the face
  const pos = [];
  const bake = [];
  const mask = [];
  const keep = [];
  const b = [0, 0, 0];
  for (let r = 0; r <= rows; r++) {
    const along = from + ((to - from) * r) / rows;
    for (let c = 0; c <= cols; c++) {
      const lat = -wide + (2 * wide * c) / cols;
      const x = frame.pos.x + frame.flat.x * lat + ahead.x * along;
      const z = frame.pos.z + frame.flat.z * lat + ahead.z * along;
      let y = terrain.heightAt(x, z);
      // over the box it keeps clear of the roof and the lintel
      if (along < 0.5) y = Math.max(y, frame.pos.y + CEILING + SHELL + LINTEL.height + 0.3);
      pos.push(x, y, z);
      terrain.bakeAt(x, z, b, 0);
      bake.push(...b);
      mask.push(0.2, 0.5);
      // out in front, nothing over the corridor (the band and the cuttings are there)
      const edge = track.edgeAt(track.wrap(s + out * along), lat >= 0 ? 1 : -1) + 4;
      keep.push(along < 0.5 || Math.abs(lat) > edge);
    }
  }
  const index = [];
  const m = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = r * m + c;
      if (!keep[v] || !keep[v + 1] || !keep[v + m] || !keep[v + m + 1]) continue;
      // wound to face up: lat runs to the left, `along` runs outwards (forwards at the exit, backwards at the entrance)
      if (out > 0) index.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
      else index.push(v, v + 1, v + m, v + 1, v + m + 1, v + m);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 3));
  geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
