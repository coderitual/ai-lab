// The tunnel: for each of the Track's tunnels a concrete bore, a portal at each
// end and the ground closed over the portals' cuts.
//
// The bore is lit by its own two rows of lamps, day and night, and that light
// is baked into its material: the shader knows where every lamp of the rows
// is (they are evenly spaced, so the nearest few are found from the fragment's
// distance along the bore) and sums what each lays on the wall, as lamps.js's
// spot lights would. Each lamp's term is scaled by one minus its share of the
// real light pool, so the lamps near the car light the walls for real and the
// sum does not change when one is handed over. Daylight reaches a few metres
// in from each portal: the bore's vertices carry an openness that scales the
// sun and the sky's light (the same `aBake` the terrain carries).
//
// The bore is lined: pale glazed panels up the walls to LINING (they throw the
// lamps' light back onto the road and show its rhythm at speed), a teal waist
// stripe, a grimy base, bare concrete above and a sooted vault; and under each
// lamp of the rows a luminous panel faces the driver, far brighter than what
// it lights, so that the lamps go by as streaks. What the walls send to each
// other (a pale bore is evenly lit, not a row of pools in the dark) is one
// more baked term, BOUNCE.
//
// Everything is built in the road's frame: `s` along it, `lat` to the left,
// `h` up from the centre line's height. The cross-section is upright, not
// banked.

import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE } from '../../engine/glsl.js';
import { levelFrame, row, stripGeometry, upright } from './furniture.js';
import { LAMP_KINDS, SPOT_GLSL } from './lamps.js';
import { BORE_UNIFORMS, extend, withBake } from './shading.js';

/** The bore: walls up to SPRING above the road, then a vault to CROWN at the middle. */
const SPRING = 4.3;
/** The crown: TUNNEL.height in game/trackLayout.js (the cameras keep under it). */
const CROWN = 6.4;
const KERB = { width: 0.3, height: 0.12 };
/** The lining of pale panels up each wall (m above the road), their width along the road, and the waist stripe in it. */
const LINING = 3.3;
const PANEL = 1.25;
const WAIST = [1.08, 1.3];
/** The bore's own light bounced about, as a share of what one lamp lays on the wall beside it. */
const BOUNCE = 0.2;
/**
 * Daylight in the mouth: seen from deep inside, the opening is a white glare (the eye, and the frame's exposure, are
 * set for the lamps: frame A's tunnel and every photograph of one). A veil across each opening adds `veil` times the
 * haze's brightness (so it is the time of day's own: nothing at night), in full for an eye more than `far` m inside
 * the bore and clearing to nothing over the last `near` m; `grey` of the haze's colour is lost in it.
 */
const MOUTH = { veil: 1.3, near: 12, far: 70, grey: 0.7 };
/** The luminous panel under each lamp: metres along the road, across and thick; how far it leans to face the road
 * (rad); how far in from the wall and under the lamp's head it hangs (m); its radiance against the lamp's colour. */
const LUMINAIRE = { along: 1.5, across: 0.42, thick: 0.08, lean: 0.75, inset: 0.32, drop: 0.3, radiance: 9 };
/** The portal: how far the face reaches beyond the walls and above the road, and the collar round the opening. */
const FACE_WIDE = 9;
const COLLAR = { width: 0.7, depth: 0.6 };
/** An emergency niche (a lit recess under a green sign) every this many metres. */
const NICHE = 60;
/** How far daylight carries into the bore (m to fall to a third). */
const DAYLIGHT = 5;
/** The Track's tunnel walls stand this far beyond the pavement (TUNNEL.wallOffset in game/trackLayout.js). */
const WALL_OFFSET = 1.5;

/**
 * Half the bore's cross-section, the left side (lat > 0), from the kerb's foot up to the crown: [lat, h, nLat, nH]
 * with the normal pointing into the bore. Corners are doubled so they stay sharp.
 */
function halfSection(W) {
  const pts = [
    [W - KERB.width, 0, -1, 0],
    [W - KERB.width, KERB.height, -1, 0],
    [W - KERB.width, KERB.height, 0, 1],
    [W, KERB.height, 0, 1],
    [W, KERB.height, -1, 0],
    [W, LINING, -1, 0],
    [W, SPRING, -1, 0],
  ];
  const n = 10;
  for (let k = 1; k <= n; k++) {
    const a = (k / n) * (Math.PI / 2);
    const lat = W * Math.cos(a);
    const h = SPRING + (CROWN - SPRING) * Math.sin(a);
    const nl = -Math.cos(a) / W;
    const nh = -Math.sin(a) / (CROWN - SPRING);
    const len = Math.hypot(nl, nh);
    pts.push([lat, h, nl / len, nh / len]);
  }
  return pts;
}

/** The whole cross-section, right kerb to left kerb over the crown. */
function section(W) {
  const half = halfSection(W);
  const right = half.map(([l, h, nl, nh]) => [-l, h, -nl, nh]);
  return [...right, ...half.reverse().slice(1)];
}

/**
 * @param {object} options
 * @param {object} options.track
 * @param {object} options.terrain terrain.js: heightAt, bakeAt, material
 * @param {import('./atmosphere.js').Atmosphere} options.atmosphere
 * @param {ReturnType<import('./lamps.js').createLamps>} options.lamps the lamp pool (its `real` weights)
 */
export function createTunnels({ track, terrain, atmosphere, lamps }) {
  const group = new THREE.Group();
  group.name = 'tunnels';
  const frame = {};
  const disposables = [];
  /** The veils of daylight in the mouths: their material, a point of the sheet and the way out. */
  const veils = [];
  const eye = new THREE.Vector3();
  // the walls stand at the Track's solid edge in the bore (TUNNEL.wallOffset beyond the pavement)
  const W = track.tunnels.length ? track.edgeAt((track.tunnels[0].s0 + track.tunnels[0].s1) / 2, 1) : track.halfWidth + WALL_OFFSET;
  const spec = LAMP_KINDS.tunnel;

  track.tunnels.forEach((t, which) => {
    const tunnelLamps = lamps.lamps.filter((l) => l.kind === 'tunnel' && l.s >= t.s0 - 1 && l.s <= t.s1 + 1);
    const first = tunnelLamps.length ? Math.min(...tunnelLamps.map((l) => l.index)) : 0;
    const rows = Math.max(1, tunnelLamps.length / 2);
    const lampLat = tunnelLamps.length ? Math.abs(tunnelLamps[0].lat - tunnelLamps[0].side * spec.arm) : W - 0.45;
    const lampH = tunnelLamps.length ? tunnelLamps[0].head.y - track.frameAt(tunnelLamps[0].s, frame).pos.y : 5;
    const leftFirst = tunnelLamps.length && tunnelLamps[0].side > 0;

    // ---- the bore, from collar to collar
    const pts = section(W);
    const ext = COLLAR.depth;
    const length = t.s1 - t.s0 + 2 * ext;
    const steps = Math.ceil(length / 2);
    const rowsOut = [];
    const local = [];
    const localN = [];
    const bake = [];
    for (let r = 0; r <= steps; r++) {
      const s = t.s0 - ext + (length * r) / steps;
      levelFrame(track, s, frame);
      const inside = Math.min(s - t.s0, t.s1 - s);
      const open = Math.exp(-Math.max(0, inside) / DAYLIGHT);
      const ptsRow = [];
      const lRow = [];
      const nRow = [];
      const bRow = [];
      for (const [lat, h, nl, nh] of pts) {
        const x = frame.pos.x + frame.flat.x * lat;
        const z = frame.pos.z + frame.flat.z * lat;
        ptsRow.push([x, frame.pos.y + h, z, s, lat]);
        lRow.push([s - t.s0, lat, h]);
        nRow.push([nl, nh]);
        bRow.push([open, open, open]);
      }
      rowsOut.push(ptsRow);
      local.push(lRow);
      localN.push(nRow);
      bake.push(bRow);
    }
    const bore = stripGeometry(rowsOut, {
      attributes: { aLocal: { size: 3, rows: local }, aLocalN: { size: 2, rows: localN }, aBake: { size: 3, rows: bake } },
    });
    // the normals as drawn (upright section turned into the road's heading), not averaged across the corners
    const normals = bore.attributes.normal;
    rowsOut.forEach((rowPts, r) => {
      levelFrame(track, rowPts[0][3], frame);
      pts.forEach(([, , nl, nh], k) => {
        normals.setXYZ(r * pts.length + k, frame.flat.x * nl, nh, frame.flat.z * nl);
      });
    });
    const boreMaterial = boreShader(
      atmosphere.patch(withBake(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }))),
      { lamps, first, rows, spacing: (t.s1 - t.s0) / rows, lampLat, lampH, leftFirst, spec },
    );
    // what the road in the bore mirrors: the lining as a lamp lights it from its own height, on average about a third
    // of that along the wall (0.58 is the lining's paint)
    BORE_UNIFORMS.uBoreGlow.value.fromArray(spec.color).multiplyScalar(((0.58 / Math.PI) * 0.35 * spec.intensity) / (lampH * lampH));
    const boreMesh = new THREE.Mesh(bore, boreMaterial);
    boreMesh.name = `tunnel-bore-${which}`;
    boreMesh.castShadow = true;
    boreMesh.receiveShadow = true;
    // the bore must shadow the road from either side of its shell
    boreMaterial.shadowSide = THREE.DoubleSide;
    group.add(boreMesh);
    disposables.push(bore, boreMaterial);

    // small accents: an emergency niche every NICHE metres, alternating sides, a green sign glowing over it and
    // a recess with a lit back
    const signs = [];
    const niches = [];
    const count = Math.max(1, Math.round((t.s1 - t.s0) / NICHE));
    for (let k = 0; k < count; k++) {
      const s = t.s0 + ((k + 0.5) * (t.s1 - t.s0)) / count;
      const side = k % 2 === 0 ? 1 : -1;
      levelFrame(track, s, frame);
      const at = (lat, h) => new THREE.Vector3(frame.pos.x + frame.flat.x * lat, frame.pos.y + h, frame.pos.z + frame.flat.z * lat);
      const facing = frame.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      signs.push(upright(at(side * (W - 0.02), 2.35), facing, 0.6, 0.28, 0.04));
      niches.push(upright(at(side * (W - 0.01), 0.2), facing, 1.3, 1.9, 0.02));
    }
    const green = atmosphere.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.6, 0.9) }));
    const recess = atmosphere.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.022, 0.02, 0.017) }));
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    group.add(row(unit, green, signs, { shadow: false, name: 'tunnel-signs' }), row(unit, recess, niches, { shadow: false, name: 'tunnel-niches' }));
    disposables.push(green, recess, unit);

    // the luminous panels: one under each lamp of the rows, hung a little in from the wall and leant to face the road
    if (tunnelLamps.length) {
      const panel = new THREE.BoxGeometry(LUMINAIRE.across, LUMINAIRE.thick, LUMINAIRE.along);
      const glow = atmosphere.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(...spec.color).multiplyScalar(LUMINAIRE.radiance) }));
      const turn = new THREE.Quaternion();
      const lean = new THREE.Quaternion();
      const at = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      const matrices = tunnelLamps.map((l) => {
        levelFrame(track, l.s, frame);
        // (the head already hangs `inset` in from the wall by the Track's own number; this is a little further in and lower)
        at.copy(l.head).addScaledVector(frame.flat, -l.side * LUMINAIRE.inset);
        at.y -= LUMINAIRE.drop;
        turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw);
        lean.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -l.side * LUMINAIRE.lean);
        return new THREE.Matrix4().compose(at, turn.clone().multiply(lean), one);
      });
      group.add(row(panel, glow, matrices, { shadow: false, name: 'tunnel-luminaires' }));
      disposables.push(panel, glow);
    }

    // ---- the portals
    const concrete = atmosphere.patch(new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.88, side: THREE.DoubleSide }));
    concreteDetail(concrete);
    disposables.push(concrete);
    for (const [s, out] of [
      [t.s0, -1],
      [t.s1, 1],
    ]) {
      // the veil of daylight across the opening (MOUTH): a sheet just outside the collar, additive, set per view
      {
        levelFrame(track, s, frame);
        const ahead = frame.ahead.clone().multiplyScalar(out);
        const at = frame.pos.clone().addScaledVector(ahead, COLLAR.depth + 0.15);
        const corner = (lat, h) => [at.x + frame.flat.x * lat, at.y + h, at.z + frame.flat.z * lat];
        const sheet = new THREE.BufferGeometry();
        sheet.setAttribute('position', new THREE.Float32BufferAttribute([...corner(-W, 0), ...corner(W, 0), ...corner(W, CROWN), ...corner(-W, CROWN)], 3));
        sheet.setIndex([0, 1, 2, 0, 2, 3]);
        const light = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const veil = new THREE.Mesh(sheet, light);
        veil.name = 'tunnel-mouth-light';
        veil.renderOrder = 2;
        veil.frustumCulled = false;
        group.add(veil);
        veils.push({ light, at, outward: ahead });
        disposables.push(sheet, light);
      }
      const portal = buildPortal(track, terrain, s, out, W);
      const mesh = new THREE.Mesh(portal, concrete);
      mesh.name = 'tunnel-portal';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      disposables.push(portal);
      const lid = buildLid(track, terrain, s, out, W);
      const lidMesh = new THREE.Mesh(lid, terrain.material);
      lidMesh.name = 'tunnel-lid';
      lidMesh.receiveShadow = true;
      lidMesh.castShadow = true;
      group.add(lidMesh);
      disposables.push(lid);
    }
  });

  return {
    group,
    /** Before each view: how much of the mouths' glare this eye sees (see MOUTH). @param {THREE.Camera} camera */
    prepareView(camera) {
      const haze = atmosphere.uniforms.uHazeColor.value;
      const grey = 0.2126 * haze.x + 0.7152 * haze.y + 0.0722 * haze.z;
      eye.setFromMatrixPosition(camera.matrixWorld);
      for (const v of veils) {
        const inside = -(eye.x - v.at.x) * v.outward.x - (eye.z - v.at.z) * v.outward.z;
        const k = Math.min(1, Math.max(0, (inside - MOUTH.near) / (MOUTH.far - MOUTH.near)));
        const show = MOUTH.veil * k * k * (3 - 2 * k);
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

/**
 * The bore's own shading: its colours from where a point is (painted band, concrete panels with joints, soot on
 * the vault, kerb) and its lamps' light baked in.
 */
function boreShader(material, { lamps, first, rows, spacing, lampLat, lampH, leftFirst, spec }) {
  const cone = new THREE.Vector2(Math.cos(spec.angle), Math.cos(spec.angle * (1 - spec.penumbra)));
  const uniforms = {
    uReal: lamps.real,
    uOn: lamps.on,
    uBore: { value: new THREE.Vector4(rows, spacing, lampLat, lampH) },
    uBoreLamp: { value: new THREE.Vector4(spec.intensity, spec.range, cone.x, cone.y) },
    uBoreColor: { value: new THREE.Vector3(...spec.color) },
    uBoreFirst: { value: first },
    // a lamp's axis in (along, lat, h), down and across the road by its tilt (lat's sign is the lamp's side)
    uBoreAxis: { value: new THREE.Vector3(0, Math.sin(spec.tilt), -Math.cos(spec.tilt)) },
  };
  const count = Math.max(1, lamps.real.value.length);
  return extend(material, `bore${count}`, (shader) => {
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
float boreGloss;         // 1 on the glazed lining
uniform float uReal[${count}];
uniform float uOn[${count}];
uniform vec4 uBore;      // rows, spacing, lamp lat, lamp height
uniform vec4 uBoreLamp;  // intensity, range, cos outer, cos inner
uniform vec3 uBoreColor;
uniform int uBoreFirst;
uniform vec3 uBoreAxis;
vec3 boreLampLight(vec3 P, vec3 N) {
  float sum = 0.0;
  float k0 = floor(P.x / uBore.y - 0.5);
  for (int j = -2; j <= 3; j++) {
    float k = k0 + float(j);
    if (k < 0.0 || k >= uBore.x) continue;
    float s = (k + 0.5) * uBore.y;
    for (int side = 0; side < 2; side++) {
      float lat = (side == 0 ? ${leftFirst ? '1.0' : '-1.0'} : ${leftFirst ? '-1.0' : '1.0'}) * uBore.z;
      int index = uBoreFirst + int(k) * 2 + side;
      float share = uOn[index] * (1.0 - uReal[index]);
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
  float h = vLocal.z;
  float wall = step(0.5, abs(vLocalN.x));
  // concrete: pours 10 m long with dark joints, streaks running down from the vault, damp near the foot
  float joint = smoothstep(0.03, 0.0, abs(fract(s / 10.0 + 0.5) - 0.5) * 10.0 - 0.02);
  float streak = valueNoise(vec2(s * 1.7, h * 0.12 + valueNoise(vec2(s * 0.3, 1.0)) * 2.0));
  float blot = valueNoise(vec2(s * 0.35, h * 0.6 + vLocal.y * 0.4));
  vec3 concrete = vec3(0.30, 0.295, 0.28) * (0.78 + 0.35 * streak) * (0.85 + 0.25 * blot);
  // the vault is sooted by the exhaust that collects under it
  concrete *= mix(1.0, 0.45, smoothstep(${SPRING.toFixed(1)}, ${CROWN.toFixed(1)}, h));
  // the lining: pale glazed panels, each a shade of its own, a fine joint between them and one along the middle;
  // a waist stripe in the circuit's teal; road grime up from the foot
  float lining = wall * step(h, ${LINING.toFixed(2)});
  float aa = fwidth(s) + 1.0e-3;
  float panel = floor(s / ${PANEL.toFixed(2)});
  float seam = 1.0 - smoothstep(0.008, 0.008 + aa, abs(fract(s / ${PANEL.toFixed(2)} + 0.5) - 0.5) * ${PANEL.toFixed(2)});
  seam = max(seam, 1.0 - smoothstep(0.008, 0.008 + fwidth(h) + 1.0e-3, abs(h - ${((LINING + WAIST[1]) / 2).toFixed(2)})));
  seam *= 1.0 - smoothstep(0.02, 0.12, aa);
  vec3 paint = vec3(0.6, 0.585, 0.54) * (0.93 + 0.1 * hash11(panel * 7.13 + sign(vLocal.y) * 3.0)) * (0.92 + 0.1 * blot);
  float waist = step(${WAIST[0].toFixed(2)}, h) * step(h, ${WAIST[1].toFixed(2)});
  paint = mix(paint, vec3(0.035, 0.3, 0.32), waist);
  paint *= mix(0.4, 1.0, smoothstep(0.12, 0.75, h + 0.25 * (streak - 0.5)));
  paint *= 1.0 - 0.55 * seam;
  vec3 kerb = vec3(0.36, 0.35, 0.33) * (0.85 + 0.2 * streak);
  vec3 c = mix(concrete, paint, lining);
  c = mix(c, kerb, step(h, ${(KERB.height + 0.01).toFixed(2)}));
  c *= 1.0 - 0.6 * joint * wall * (1.0 - lining);
  // a thin dark line where lining and concrete meet
  c *= 1.0 - 0.5 * wall * smoothstep(0.03, 0.0, abs(h - ${LINING.toFixed(2)}));
  boreGloss = lining * (1.0 - waist * 0.3);
  diffuseColor.rgb *= c;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// the lamps' light, lamp by lamp, and what the bore's own pale walls send round (BOUNCE of a lamp's light on the
// wall beside it: intensity over the square of the lamp's height above the road)
totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * (boreLampLight(vLocal, vec3(0.0, vLocalN.x, vLocalN.y)) + uBoreColor * (${BOUNCE.toFixed(2)} * uBoreLamp.x / (uBore.w * uBore.w)) * uOn[uBoreFirst]);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.38, boreGloss);');
  });
}

/** Board-marked concrete for the portals: soft stains in a small texture-free shader edit. */
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
  float boards = 0.94 + 0.06 * hash11(floor(p.y / 0.15));
  float stain = valueNoise(vec2(p.x * 0.25 + p.z * 0.25, p.y * 0.08)) * valueNoise(vec2((p.x - p.z) * 1.3, p.y * 0.05));
  diffuseColor.rgb *= boards * (1.0 - 0.45 * stain);
}`,
      );
  });
}

/**
 * One portal: a collar round the opening, the face out to a rectangle, a coping along its top and a wing wall on
 * each side that runs out along the road and down. `out`: -1 at the entrance (outside is behind s), +1 at the exit.
 * Drawn double-sided, so the winding of its faces does not matter.
 */
function buildPortal(track, terrain, s, out, W) {
  const frame = levelFrame(track, s, {});
  const ahead = frame.ahead.clone().multiplyScalar(out);
  const left = frame.flat.clone();
  const origin = frame.pos.clone();
  const P = (lat, h, along) =>
    new THREE.Vector3(origin.x + left.x * lat + ahead.x * along, origin.y + h, origin.z + left.z * lat + ahead.z * along);
  const FACE_TOP = faceTop(terrain, P);
  const positions = [];
  const quad = (a, b, c, d) => positions.push(a, b, c, a, c, d);

  // the opening's outline (walls and vault, without the kerbs), right foot to left foot, and the same grown outwards
  const arch = section(W).filter(
    ([lat, h], k, all) => h > KERB.height - 1e-3 && Math.abs(lat) > W - 0.01 - (h > SPRING ? W : 0) && !(k > 0 && all[k - 1][0] === lat && all[k - 1][1] === h),
  );
  const opening = arch.map(([lat, h]) => [lat, h]);
  const grown = arch.map(([lat, h, nl, nh]) => [lat - nl * COLLAR.width, h - nh * COLLAR.width]);
  for (const ring of [opening, grown]) {
    ring[0][1] = 0;
    ring[ring.length - 1][1] = 0;
  }
  grown[0][0] = -(W + COLLAR.width);
  grown[grown.length - 1][0] = W + COLLAR.width;
  // the collar: its front ring and its outer side
  const front = COLLAR.depth;
  for (let k = 0; k < opening.length - 1; k++) {
    const [l0, h0] = opening[k];
    const [l1, h1] = opening[k + 1];
    const [g0, j0] = grown[k];
    const [g1, j1] = grown[k + 1];
    quad(P(l0, h0, front), P(g0, j0, front), P(g1, j1, front), P(l1, h1, front));
    quad(P(g0, j0, front), P(g0, j0, 0), P(g1, j1, 0), P(g1, j1, front));
  }
  // the face: a rectangle down into the ground with the grown outline cut out of it
  const wide = W + FACE_WIDE;
  const deep = -5;
  const shape = new THREE.Shape([
    new THREE.Vector2(-wide, deep),
    new THREE.Vector2(wide, deep),
    new THREE.Vector2(wide, FACE_TOP),
    new THREE.Vector2(-wide, FACE_TOP),
  ]);
  shape.holes.push(new THREE.Path(grown.map(([l, h]) => new THREE.Vector2(l, h))));
  const face = new THREE.ShapeGeometry(shape);
  const fp = face.attributes.position;
  const fi = face.index;
  for (let i = 0; i < fi.count; i++) positions.push(P(fp.getX(fi.getX(i)), fp.getY(fi.getX(i)), 0));
  face.dispose();
  // the coping along the top, and thickness at the face's two ends
  const back = -1.2;
  box(positions, P, -wide - 0.2, wide + 0.2, FACE_TOP, FACE_TOP + 0.5, back, 0.35);
  box(positions, P, wide - 0.6, wide, deep, FACE_TOP, back, 0.25);
  box(positions, P, -wide, -wide + 0.6, deep, FACE_TOP, back, 0.25);

  // the wing walls: from the face beside the opening out along the road, turned away from it, falling with it
  for (const sign of [1, -1]) {
    const lat0 = sign * (W + COLLAR.width + 0.2);
    // where the ground falls away beside the road the wall only has to hold the road's edge: keep it short
    const probe = P(lat0 + sign * 7, 0, 16);
    const falls = terrain.heightAt(probe.x, probe.z) < origin.y;
    const reach = falls ? 6 : 16;
    const lat1 = lat0 + sign * (falls ? 2.5 : 7);
    const end = P(lat1, 0, reach);
    const ground = terrain.heightAt(end.x, end.z) - origin.y;
    const top0 = FACE_TOP - 0.5;
    const top1 = Math.max(1.4, Math.min(FACE_TOP - 2, ground + 1.2));
    const bottom = Math.min(deep, ground - 3);
    const t = sign * 0.7;
    const inner = [P(lat0, bottom, 0), P(lat1, bottom, reach), P(lat1, top1, reach), P(lat0, top0, 0)];
    const outer = [P(lat0 + t, bottom, 0), P(lat1 + t, bottom, reach), P(lat1 + t, top1, reach), P(lat0 + t, top0, 0)];
    quad(inner[0], inner[1], inner[2], inner[3]);
    quad(outer[0], outer[1], outer[2], outer[3]);
    quad(inner[3], inner[2], outer[2], outer[3]);
    quad(inner[1], outer[1], outer[2], inner[2]);
  }

  const geometry = new THREE.BufferGeometry();
  const flat = new Float32Array(positions.length * 3);
  positions.forEach((p, i) => flat.set([p.x, p.y, p.z], i * 3));
  geometry.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** How high a portal's face stands above the road: a little above the ground just behind it. */
function faceTop(terrain, P) {
  let top = 0;
  for (const lat of [-8, 0, 8]) {
    const p = P(lat, 0, -2);
    top = Math.max(top, terrain.heightAt(p.x, p.z) - p.y);
  }
  return Math.min(13, Math.max(CROWN + 2.4, top + 0.8));
}

/** An axis-aligned box in the portal's frame (lat, h, along). */
function box(positions, P, l0, l1, h0, h1, a0, a1) {
  const c = (l, h, a) => P(l, h, a);
  const f = [
    [c(l0, h0, a1), c(l1, h0, a1), c(l1, h1, a1), c(l0, h1, a1)], // front (towards the outside)
    [c(l1, h0, a0), c(l0, h0, a0), c(l0, h1, a0), c(l1, h1, a0)], // back
    [c(l0, h1, a1), c(l1, h1, a1), c(l1, h1, a0), c(l0, h1, a0)], // top
    [c(l1, h0, a1), c(l1, h0, a0), c(l1, h1, a0), c(l1, h1, a1)], // left
    [c(l0, h0, a0), c(l0, h0, a1), c(l0, h1, a1), c(l0, h1, a0)], // right
  ];
  for (const [a, b, cc, d] of f) positions.push(a, b, cc, a, cc, d);
}

/**
 * The ground over a portal: the terrain's own height function, drawn with its material, over the square the
 * terrain mesh leaves open there, kept above the bore's crown inside and off the road outside.
 */
function buildLid(track, terrain, s, out, W) {
  const frame = levelFrame(track, s, {});
  const ahead = frame.ahead.clone().multiplyScalar(out);
  const wide = W + FACE_WIDE + 3;
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
      // over the bore it keeps clear of the vault
      if (along < 0.5) y = Math.max(y, frame.pos.y + CROWN + 0.8);
      pos.push(x, y, z);
      terrain.bakeAt(x, z, b, 0);
      bake.push(...b);
      mask.push(0.2, 0.5);
      // out in front, nothing over the corridor (the band and the rock are there)
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
