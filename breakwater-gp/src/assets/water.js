// The ocean: a camera-centred radial grid (dense near the rider, sparse toward
// the horizon) displaced by the shared Gerstner waves in the vertex shader and
// shaded per-pixel with analytic normals, sky reflection, sun glitter and foam.

import * as THREE from 'three';
import { WAVE_GLSL, waveUniforms } from '../engine/waves.js';
import { SKY_GLSL, atmosphereUniforms } from './sky.js';
import { PALETTE } from './palette.js';

/**
 * Radial grid in the XZ plane. Ring spacing grows with radius so that quads
 * stay roughly square in world space: lots of detail close by, almost none far.
 */
export function createRadialGridGeometry({ segments = 192, innerStep = 0.45, maxRadius = 4200 } = {}) {
  const radii = [0];
  const growth = 1 + (Math.PI * 2) / segments;
  let r = innerStep;
  while (r < maxRadius) {
    radii.push(r);
    r = Math.max(r + innerStep, r * growth);
  }
  radii.push(maxRadius);

  const rings = radii.length;
  const positions = new Float32Array((1 + (rings - 1) * segments) * 3);
  let p = 3; // vertex 0 is the centre
  for (let i = 1; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      // offset every other ring by half a step to avoid long aligned edges
      const a = ((s + (i % 2) * 0.5) / segments) * Math.PI * 2;
      positions[p++] = Math.cos(a) * radii[i];
      positions[p++] = 0;
      positions[p++] = Math.sin(a) * radii[i];
    }
  }
  const indices = [];
  const ringStart = (i) => 1 + (i - 1) * segments;
  for (let s = 0; s < segments; s++) {
    indices.push(0, ringStart(1) + ((s + 1) % segments), ringStart(1) + s);
  }
  for (let i = 1; i < rings - 1; i++) {
    const a = ringStart(i);
    const b = ringStart(i + 1);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      if (i % 2 === 1) {
        indices.push(a + s, a + s1, b + s1, a + s, b + s1, b + s);
      } else {
        indices.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const vertexShader = /* glsl */ `
${WAVE_GLSL}
uniform vec2 uCenter;
varying vec3 vWorldPos;
varying vec2 vBase;

void main() {
  vec2 base = position.xz + uCenter;
  float dist = length(position.xz);
  vec3 d = waveDisplace(base, waveAmpField(base), dist);
  vec3 wp = vec3(base.x + d.x, d.y, base.y + d.z);
  vWorldPos = wp;
  vBase = base;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
${WAVE_GLSL}
${SKY_GLSL}
uniform sampler2D uNormalTex;
uniform sampler2D uNoiseTex;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uScatterColor;
uniform vec3 uFoamColor;
uniform float uDetail;
uniform sampler2D uWakeTex;   // r: foam laid down by crafts, g: their shadows
uniform vec3 uWake;           // centre x, centre z, 1 / extent
varying vec3 vWorldPos;
varying vec2 vBase;

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float shore = shoreDistance(vBase);
  float ampScale = waveAmpFromShore(vBase, shore);
  vec3 N;
  float jac;
  waveNormal(vBase, ampScale, dist, N, jac);

  // ripples: three scrolling layers of the tiling normal map
  float t = uWaveTime;
  vec2 n1 = texture2D(uNormalTex, vBase * 0.083 + t * vec2(0.021, 0.013)).xy - 0.5;
  vec2 n2 = texture2D(uNormalTex, vec2(vBase.y, -vBase.x) * 0.231 + t * vec2(-0.034, 0.027)).xy - 0.5;
  vec2 n3 = texture2D(uNormalTex, vBase * 0.023 + t * vec2(0.004, -0.006)).xy - 0.5;
  vec2 n4 = texture2D(uNormalTex, vec2(-vBase.y, vBase.x) * 0.71 + t * vec2(0.06, 0.05)).xy - 0.5;
  vec2 ripple = (n1 * 0.9 + n2 * 0.7 + n3 * 0.4 + n4 * 0.45) * uDetail;
  ripple *= 0.4 + 0.6 * ampScale;                  // glassier in sheltered water
  N = normalize(N + vec3(ripple.x, 0.0, ripple.y));

  float NdV = max(dot(N, V), 0.0);
  float NdL = max(dot(N, uSunDir), 0.0);

  // ---- what the crafts have done to the water around the player
  vec2 wuv = (vBase - uWake.xy) * uWake.z + 0.5;
  vec2 wedge = abs(wuv - 0.5) * 2.0;
  vec2 wake = texture2D(uWakeTex, wuv).rg * (1.0 - smoothstep(0.86, 1.0, max(wedge.x, wedge.y)));
  float shade = 1.0 - wake.g * 0.5;

  // ---- water body
  float shallow = exp(-max(shore, 0.0) * 0.05);
  vec3 body = mix(uDeepColor, uShallowColor, shallow * 0.85);
  // light scattering through the top of the swells
  float crest = smoothstep(-0.25, 1.15, vWorldPos.y);
  float backlit = pow(max(dot(normalize(V.xz), -normalize(uSunDir.xz)), 0.0), 2.0);
  body += uScatterColor * crest * (0.10 + 0.22 * backlit);
  // exaggerate the light / dark faces of the swell so its shape reads at speed
  body *= clamp(0.80 + 1.7 * (NdL - uSunDir.y), 0.45, 1.5) * shade;

  // ---- reflection of the sky
  float fresnel = 0.02 + 0.86 * pow(1.0 - NdV, 4.6);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.03;
  vec3 refl = skyGradient(normalize(R));

  // ---- sun glitter
  vec3 H = normalize(uSunDir + V);
  float NdH = max(dot(N, H), 0.0);
  float glitter = pow(NdH, 420.0) * 7.0 + pow(NdH, 46.0) * 0.2;

  vec3 col = mix(body, refl * mix(1.0, shade, 0.6), fresnel) + uSunColor * glitter * shade * shade;

  // ---- foam: whitecaps where the surface bunches up, and along the shore
  float veins = texture2D(uNoiseTex, vBase * 0.071 + t * vec2(0.008, 0.005)).g;
  float fine = texture2D(uNoiseTex, vBase * 0.19 - t * vec2(0.011, 0.004)).b;
  float cap = smoothstep(0.215, 0.33, 1.0 - jac);
  float foam = cap * smoothstep(0.30, 0.78, veins * 0.75 + fine * 0.55);
  float sd = shore + (fine - 0.5) * 3.5 + sin(t * 0.9 + vBase.x * 0.05) * 0.8;
  float wash = smoothstep(9.0, 0.5, sd);
  float lap = 0.5 + 0.5 * sin(sd * 1.15 - t * 1.4);
  foam = max(foam, wash * mix(0.25, 1.0, lap) * smoothstep(0.18, 0.62, veins + fine * 0.35));
  foam *= 1.0 - smoothstep(350.0, 900.0, dist);
  float churn = veins * 0.55 + fine * 0.6 + 0.12;
  foam = max(foam, smoothstep(1.3 - wake.r * 1.3, 1.6 - wake.r * 1.3, churn));
  vec3 foamCol = uFoamColor * (0.52 + 0.62 * NdL) * mix(1.0, shade, 0.7);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0));

  col = applySkyFog(col, -V, dist);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let blackTex = null;
function getBlackTexture() {
  if (!blackTex) {
    blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    blackTex.needsUpdate = true;
  }
  return blackTex;
}

export function createWater({ normalTex, noiseTex, segments = 192 }) {
  const material = new THREE.ShaderMaterial({
    name: 'Water',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...waveUniforms,
      ...atmosphereUniforms,
      uCenter: { value: new THREE.Vector2() },
      uNormalTex: { value: normalTex },
      uNoiseTex: { value: noiseTex },
      uDeepColor: { value: PALETTE.waterDeep.clone() },
      uShallowColor: { value: PALETTE.waterShallow.clone() },
      uScatterColor: { value: PALETTE.waterScatter.clone() },
      uFoamColor: { value: PALETTE.foam.clone() },
      uDetail: { value: 0.55 },
      uWakeTex: { value: getBlackTexture() },
      uWake: { value: new THREE.Vector3(0, 0, 0.001) },
    },
  });
  const mesh = new THREE.Mesh(createRadialGridGeometry({ segments }), material);
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 10; // after opaque scenery so hidden pixels are skipped early

  /** Keep the dense part of the grid under the action. */
  mesh.userData.follow = (x, z) => material.uniforms.uCenter.value.set(x, z);
  /** Plug in a WakeField's uniforms ({ uWakeTex, uWake }). */
  mesh.userData.setWake = (wakeUniforms) => {
    material.uniforms.uWakeTex = wakeUniforms.uWakeTex;
    material.uniforms.uWake = wakeUniforms.uWake;
  };
  return mesh;
}
