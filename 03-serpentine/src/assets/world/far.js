// What lies beyond the terrain: the mountains on the horizon, mist lying in
// the valleys, and at night the lights of a village down by the lake.
//
// MOUNTAINS. Three rings of jagged ridges round the course, 5 to 11 km out,
// each a strip of faces from below the far land up to a ridge line made of
// ridged noise, with gullies cut into the faces and snow on what faces up
// high. They are a standard material, so they take the sun by day and the
// moon by night, and the haze (atmosphere.patch) fades their feet into the
// valley air and leaves the peaks clear. They lie beyond the camera's far
// plane, so their vertex shader puts them at the very back of the depth range
// (just in front of where the sky is drawn): they are drawn first, farthest
// ring first, without a depth test, and everything real draws over them.
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
import { extend, planeNoise, smoothstep } from './shading.js';

/** The rings: distance from the middle of the course (m), the ridge's height range (m), columns round. */
const RINGS = [
  { r: 10500, lo: 1500, hi: 2700, cols: 540, scale: 2600, seed: 3 },
  { r: 7600, lo: 1000, hi: 1900, cols: 600, scale: 1800, seed: 7 },
  { r: 5300, lo: 650, hi: 1250, cols: 640, scale: 1300, seed: 11 },
];
const ROWS = 14;

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
  const mountainMaterial = (order) => {
    const m = atmosphere.patch(
      extend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), 'far-mountain', (shader) => {
        // at the back of the depth range, in front of the sky only (see above)
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\ngl_Position.z = gl_Position.w * ( 1.0 - 1.0e-6 );',
        );
      }),
    );
    m.depthTest = false;
    m.name = `far-mountains-${order}`;
    return m;
  };
  const mountains = [];
  let mountainTriangles = 0;
  RINGS.forEach((ring, layer) => {
    const cols = lowTier ? Math.round(ring.cols * 0.6) : ring.cols;
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
      heights.push(ring.lo + (ring.hi - ring.lo) * Math.min(1, Math.max(0, 0.15 + 1.1 * ridge * (0.5 + broad))));
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
        const snowLine = 0.55 * ring.hi + 300 * (noise.fbm(i * 0.05 + layer, 2.5, 2) - 0.5);
        const snow = smoothstep(snowLine - 120, snowLine + 120, y) * (0.55 + 0.45 * gully);
        const rock = 0.075 + 0.05 * gully + 0.02 * noise.fbm(i * 0.3, j * 0.7, 2);
        const green = 1 - smoothstep(200, 700, y); // forest and pasture low down
        col[v * 3] = rock * (1 - 0.45 * green) + (0.72 - rock) * snow;
        col[v * 3 + 1] = rock * (0.96 - 0.25 * green) + (0.75 - rock) * snow;
        col[v * 3 + 2] = rock * (0.88 - 0.4 * green) + (0.8 - rock) * snow;
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

  // ---------------------------------------------------------------- the village
  const lightRng = rng.fork('village');
  const lights = [];
  let village = null;
  {
    // on the far shore: walk the lake's rim away from the course and take the first gentle, dry spot
    const ext = terrain.lake.extent;
    const cx = (ext.x0 + ext.x1) / 2;
    const cz = (ext.z0 + ext.z1) / 2;
    let best = null;
    for (let k = 0; k < 48; k++) {
      const a = Math.PI * (1.15 + (k / 48) * 0.7); // the half of the rim facing away from the straight
      for (let f = 1.0; f < 1.6; f += 0.05) {
        const x = cx + Math.cos(a) * (ext.x1 - ext.x0) * 0.5 * f;
        const z = cz + Math.sin(a) * (ext.z1 - ext.z0) * 0.5 * f;
        const h = terrain.heightAt(x, z);
        if (h < terrain.lake.level + 2) continue;
        const slope = Math.abs(terrain.heightAt(x + 20, z) - h) + Math.abs(terrain.heightAt(x, z + 20) - h);
        track.locate(x, z, -1, spot);
        const score = slope + Math.max(0, 600 - Math.abs(spot.lat)) * 0.1 + Math.max(0, h - 30) * 0.5;
        if (!best || score < best.score) best = { x, z, h, score };
        break;
      }
    }
    village = best ?? { x: cx, z: ext.z0 - 150, h: 5 };
    // a few streets from the middle, lamps along them, windows beside them
    const streets = 5;
    for (let st = 0; st < streets; st++) {
      let a = lightRng.range(0, Math.PI * 2);
      let x = village.x + lightRng.range(-40, 40);
      let z = village.z + lightRng.range(-40, 40);
      const steps = lightRng.int(8) + 6;
      for (let k = 0; k < steps; k++) {
        a += lightRng.range(-0.35, 0.35);
        x += Math.cos(a) * 28;
        z += Math.sin(a) * 28;
        const h = terrain.heightAt(x, z);
        if (h < terrain.lake.level + 0.5) break;
        // a street lamp: sodium or a warm LED
        const sodium = lightRng.next() < 0.6;
        lights.push({ x, y: h + 6, z, c: sodium ? [1, 0.55, 0.2] : [1, 0.82, 0.6], i: lightRng.range(0.8, 1.2) });
        // a window or two beside it
        for (let w = 0; w < 2; w++) {
          if (lightRng.next() < 0.45) continue;
          const side = lightRng.sign();
          const wx = x - Math.sin(a) * side * lightRng.range(10, 18);
          const wz = z + Math.cos(a) * side * lightRng.range(10, 18);
          lights.push({ x: wx, y: terrain.heightAt(wx, wz) + 3, z: wz, c: [1, 0.72, 0.42], i: lightRng.range(0.25, 0.5) });
        }
      }
    }
    // two lit windows far apart on the slopes (farms)
    for (let k = 0; k < 40 && lights.length < 400; k++) {
      const a = lightRng.range(0, Math.PI * 2);
      const r = lightRng.range(900, 1800);
      const x = mid.x + Math.cos(a) * r;
      const z = mid.z + Math.sin(a) * r;
      track.locate(x, z, -1, spot);
      const h = terrain.heightAt(x, z);
      if (Math.abs(spot.lat) < 300 || h < 40 || h > 250) continue;
      lights.push({ x, y: h + 3, z, c: [1, 0.7, 0.4], i: 0.4, farm: true });
      if (lights.filter((l) => l.farm).length >= 2) break;
    }
  }
  const lightPoints = (() => {
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
      defines: targetDefines(caps),
      uniforms: { ...hazeUniforms, ...shared, uRadiance: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
attribute vec4 aLight;
uniform float uTime;
uniform float uRadiance;
uniform float uPixel;
varying vec3 vColor;
${GLSL_HASH}
${GLSL_NOISE}
${ATMOSPHERE_PARS}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  // a lamp a kilometre or two away covers less than a pixel: its light is spread over a fixed small spot, and
  // its brightness goes with the inverse square of the distance relative to 1 km
  float d = length(w.xyz - cameraPosition);
  float shimmer = 1.0 + 0.22 * (valueNoise(vec2(uTime * 6.0, aLight.w * 97.0)) - 0.5) * smoothstep(300.0, 1500.0, d);
  vec3 c = aLight.rgb * uRadiance * shimmer * clamp(1.0e6 / (d * d), 0.0, 25.0);
  // through the air: dimmed by the haze between (its own glow is too faint to matter)
  vColor = c * (1.0 - hazeBetween(cameraPosition.y, w.xyz - cameraPosition));
  gl_PointSize = 3.0 * uPixel;
}`,
      fragmentShader: /* glsl */ `
${GLSL_TARGET}
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float spot = exp(-dot(q, q) * 3.0);
  gl_FragColor = toTarget(vec4(vColor * spot, 1.0));
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    material.name = 'far-lights';
    const points = new THREE.Points(geometry, material);
    points.name = 'far-lights';
    points.renderOrder = 11;
    points.matrixAutoUpdate = false;
    return points;
  })();
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
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 360), material);
    mesh.position.set(village.x, village.h + 120, village.z);
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
    stats: { mountainTriangles, sheets: sheets.length, lights: lights.length, village: { x: Math.round(village.x), z: Math.round(village.z) }, ms: Math.round(performance.now() - started) },
    setTime(time) {
      const night = time.name === 'night';
      // the mist: lit from above by the sun or moon and the sky, albedo about 0.8
      const e = time.sun.intensity * Math.max(0.1, time.sun.dir[1]) + Math.PI * (0.7 * time.sky.zenith[1] + 0.3 * time.sky.horizon[1]) * 1.2;
      const s = (0.8 * e) / Math.PI;
      shared.uMistColor.value.set(s * (0.75 + 0.25 * time.sun.color[0]), s * (0.8 + 0.2 * time.sun.color[1]), s * (0.85 + 0.15 * time.sun.color[2]));
      shared.uMistOpacity.value = night ? 0.3 : 0.65;
      const lamps = time.lamps.windows;
      lightPoints.material.uniforms.uRadiance.value = 0.35 * lamps;
      lightPoints.visible = lamps > 0;
      glow.material.uniforms.uGlow.value.set(0.0012, 0.0006, 0.00035).multiplyScalar(lamps);
      glow.visible = lamps > 0;
    },
    /** @param {number} ratio the renderer's pixel ratio (the lights' spot is a few pixels across) */
    setPixelRatio(ratio) {
      lightPoints.material.uniforms.uPixel.value = ratio;
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
