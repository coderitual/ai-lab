// The ocean: a camera-centred radial grid (dense near the driver, sparse toward
// the horizon) displaced by the shared Gerstner waves in the vertex shader and
// shaded per pixel: analytic normals, a deep body that sunlight shines through
// (most where a wave is thin and where you look sunward into its face),
// caustics inside the waves and on the sand in the shallows, the reflection of
// the sky and of whatever stands on the water (see engine/WaterMirror.js), sun
// glitter, and foam that trails behind breaking waves.

import * as THREE from 'three';
import { SEA_HEIGHT, WAVE_GLSL, setWaveMeshDensity, waveUniforms, waves } from '../engine/waves.js';
import { mirrorUniforms } from '../engine/WaterMirror.js';
import { SKY_GLSL, atmosphereUniforms } from './sky.js';
import { PALETTE } from './palette.js';

// Phones look back over fewer moments when laying foam behind the crests.
const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const FOAM_LAGS = coarsePointer ? 2 : 4;

/**
 * Radial grid in the XZ plane. Ring spacing grows with radius so that quads
 * stay roughly square in world space: lots of detail close by, almost none far.
 */
export function createRadialGridGeometry({ segments = 192, innerStep = 0.34, maxRadius = 4200 } = {}) {
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
#define FOAM_LAGS ${FOAM_LAGS}
uniform sampler2D uNormalTex;
uniform sampler2D uNoiseTex;
uniform sampler2D uCausticTex;
uniform vec3 uDeepColor;
uniform vec3 uMidColor;
uniform vec3 uShallowColor;
uniform vec3 uScatterColor;
uniform vec3 uSandColor;
uniform vec3 uFoamColor;
uniform float uDetail;
uniform float uSeaHeight;     // typical crest-to-trough range of the open sea (m)
uniform vec2 uSwellDir;       // travel direction of the main swell: foam streaks line up with it
uniform vec3 uFoam;           // crest steepening, threshold low, threshold high
uniform vec4 uGlint;          // texture scale, normal spread, exponent, strength
uniform sampler2D uWakeTex;   // r: water churned by crafts, g: their shadows, b: how fresh the churn is
uniform vec3 uWake;           // centre x, centre z, 1 / extent
uniform sampler2D uMirrorTex; // boats, marks and land as the water mirrors them (a: something is there)
uniform mat4 uMirrorMatrix;   // a point on the mirror plane -> where it is in that picture
uniform vec3 uMirror;         // height of the plane, how much shows, how far ripples push it about
varying vec3 vWorldPos;
varying vec2 vBase;

// Two copies of the light net sliding over each other: lines flare where they
// meet and fade where they part, the way real caustics shimmer.
// About 0.25 on average, 1 and more on the lines.
float caustic(vec2 uv, float time) {
  float a = texture2D(uCausticTex, uv + time * vec2(0.031, 0.017)).r;
  float b = texture2D(uCausticTex, uv * 1.31 + vec2(0.37, 0.61) - time * vec2(0.023, 0.029)).r;
  return a * b * 3.2;
}

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float t = uWaveTime;

  float shore = shoreDistance(vBase);
  float ampScale = waveAmpFromShore(vBase, shore);
  vec3 N;
  float jac;
  waveNormal(vBase, ampScale, dist, N, jac);

  // swell-aligned coordinates: x runs with the main swell, y along its crests
  vec2 sp = vec2(dot(vBase, uSwellDir), dot(vBase, vec2(-uSwellDir.y, uSwellDir.x)));

  // ---- ripples: four scrolling layers of the tiling normal map, squeezed along
  //      the swell so they read as fine wind streaks lying across it
  vec2 n1 = texture2D(uNormalTex, sp * vec2(0.16, 0.07) + t * vec2(0.03, 0.012)).xy - 0.5;
  vec2 n2 = texture2D(uNormalTex, sp.yx * vec2(0.21, 0.47) + t * vec2(-0.03, 0.05)).xy - 0.5;
  vec2 n3 = texture2D(uNormalTex, vBase * 0.023 + t * vec2(0.004, -0.006)).xy - 0.5;
  vec2 n4 = texture2D(uNormalTex, sp * vec2(1.25, 0.55) + t * vec2(0.09, 0.04)).xy - 0.5;
  vec2 rs = n1 * 0.8 + n2.yx * 0.75 + n4 * 0.65;       // in swell space
  vec2 ripple = (uSwellDir * rs.x + vec2(-uSwellDir.y, uSwellDir.x) * rs.y + n3 * 0.35) * uDetail;
  ripple *= 0.4 + 0.6 * ampScale;                  // glassier in sheltered water

  // ---- what the crafts have done to the water around the player
  vec2 wuv = (vBase - uWake.xy) * uWake.z + 0.5;
  vec2 wedge = abs(wuv - 0.5) * 2.0;
  vec3 wake = texture2D(uWakeTex, wuv).rgb * (1.0 - smoothstep(0.86, 1.0, max(wedge.x, wedge.y)));
  float shade = 1.0 - wake.g * 0.5;
  // churned water is rough: it boils, and stops mirroring the sky
  vec2 boil = texture2D(uNormalTex, vBase * 0.83 + t * vec2(0.09, -0.06)).xy + texture2D(uNormalTex, vBase * 0.37 - t * vec2(0.05, 0.07)).xy - 1.0;
  ripple += boil * wake.r * (0.25 + 0.5 * wake.b);
  // the finest ripples mostly show up in what the surface mirrors, less in its colour
  vec3 Nr = normalize(N + vec3(ripple.x, 0.0, ripple.y) * 2.4);
  N = normalize(N + vec3(ripple.x, 0.0, ripple.y));

  float NdV = max(dot(Nr, V), 0.0);
  // 0.55 on flat water, brighter on faces turned to the sun, darker on the far side
  float lit = clamp((dot(N, uSunDir) - uSunDir.y) * 2.3 + 0.55, 0.0, 1.3);

  // ---- foam mask
  // Breaking crests leave foam behind that lingers while the wave moves on:
  // ask how hard the swell was bunching up here now and a little while ago.
  float crestNow = swellCrest(vBase, ampScale, 0.0, uFoam.x);
  float crest = smoothstep(uFoam.y, uFoam.z, crestNow);
  crest = max(crest, 0.8 * smoothstep(uFoam.y, uFoam.z, swellCrest(vBase, ampScale, 0.9, uFoam.x)));
  #if FOAM_LAGS > 2
  crest = max(crest, 0.6 * smoothstep(uFoam.y, uFoam.z, swellCrest(vBase, ampScale, 1.9, uFoam.x)));
  crest = max(crest, 0.4 * smoothstep(uFoam.y, uFoam.z, swellCrest(vBase, ampScale, 3.1, uFoam.x)));
  #endif
  // even a breaking crest is streaks of white on water, never a sheet
  crest *= 0.82;
  // small whitecaps where the short chop piles up as well
  float chop = 1.0 - jac;
  crest = max(crest, 0.75 * smoothstep(0.5, 0.7, chop));

  // lacy pattern, stretched along the swell so foam reads as streaks
  float veins = texture2D(uNoiseTex, sp * vec2(0.032, 0.075) + t * vec2(0.004, 0.002)).g;
  float veins2 = texture2D(uNoiseTex, sp * vec2(0.085, 0.2) + 0.37 - t * vec2(0.006, 0.003)).g;
  float veins3 = texture2D(uNoiseTex, sp * vec2(0.29, 0.6) + 0.71 + t * vec2(0.01, -0.006)).g;
  float fine = texture2D(uNoiseTex, sp * vec2(0.1, 0.19) - t * vec2(0.011, 0.004)).b;
  // close to the eye the finest layer carries the pattern, so threads stay crisp
  float nearK = 1.0 - smoothstep(5.0, 28.0, dist);
  float churn = veins * mix(0.42, 0.2, nearK) + veins2 * 0.3 + veins3 * mix(0.18, 0.42, nearK) + fine * 0.5 + 0.1;

  // surf along the shore
  float sd = shore + (fine - 0.5) * 3.5 + sin(t * 0.9 + vBase.x * 0.05) * 0.8;
  float wash = smoothstep(9.0, 0.5, sd) * mix(0.3, 1.0, 0.5 + 0.5 * sin(sd * 1.15 - t * 1.4));

  float mask = max(crest, wash * 0.85);
  // white threads where the pattern is strong; in between, a thin veil of bubbles
  float foam = smoothstep(1.25 - mask * 1.05, 1.5 - mask * 1.05, churn);

  // ---- a craft's wake
  // Fresh from the propellers it is solid white water. As the air escapes, the same
  // bubble pattern is cut by a rising threshold: it opens into lace, then
  // flecks, then it is gone. Two layers sliding against each other keep it alive.
  float cells = texture2D(uNoiseTex, vBase * 0.19 + t * vec2(0.013, -0.009)).g;
  float cells2 = texture2D(uNoiseTex, vBase * 0.43 - t * vec2(0.016, 0.011) + 0.31).g;
  float grit = texture2D(uNoiseTex, vBase * 1.25 + t * vec2(0.045, 0.03)).b;
  float bubbles = cells * 0.42 + cells2 * 0.38 + grit * 0.5;
  float wfoam = smoothstep(0.93 - wake.r * 0.95, 1.1 - wake.r * 0.9, bubbles + wake.b * 0.22);
  // light and shade inside the foam, so thick white water has some body
  float foamBody = 0.74 + 0.42 * grit - 0.16 * cells2;
  foam = max(foam, wfoam);

  mask = max(mask, wake.r);
  float veil = mask * (0.14 + 0.3 * fine) * (1.0 - foam);
  // bubbles just under the surface around the foam turn the water milky
  float aerated = smoothstep(0.04, 0.7, mask);

  // ---- water body: dark in the troughs, clearer toward the tops
  float hn = clamp(0.5 + vWorldPos.y / (uSeaHeight * max(ampScale, 0.3)), 0.0, 1.0);
  vec3 body = mix(uDeepColor, uMidColor, smoothstep(0.1, 0.85, hn));
  body *= 0.55 + 0.82 * lit;
  // little peaks catch the light, the hollows between them go dark
  body *= clamp(1.0 + chop * 0.9, 0.6, 1.4);

  // which way "further into the water" lies as seen from here (for parallax)
  vec2 into = V.xz / max(V.y, 0.3);

  // ---- sunlight through the wave
  // The less water behind the surface, the more gets through: the upper part
  // of a wave, a crest where the swell bunches up, a peak of the chop.
  float top = smoothstep(0.3, 1.0, hn);
  float thin = max(top * top * 0.8, smoothstep(0.03, 0.36, crestNow) * (0.35 + 0.65 * top));
  thin = max(thin, 0.55 * smoothstep(0.16, 0.5, chop));
  // strongest looking toward the sun: the wave stands between you and the light
  float sunward = pow(clamp(dot(V, -normalize(uSunDir + N * 0.5)) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  // steep faces turned toward the viewer: you look into the wave, not at its skin
  vec2 nh = N.xz / max(length(N.xz), 1.0e-4);
  vec2 vh = V.xz / max(length(V.xz), 1.0e-4);
  float faceOn = max(dot(nh, vh), 0.0) * clamp((1.0 - N.y) * 5.0, 0.0, 1.0) * smoothstep(0.25, 0.85, hn);
  float scatter = thin * (0.3 + 0.92 * sunward) + faceOn * (0.18 + 0.5 * sunward);
  // caustics drifting inside the wave give that glow its texture
  float cIn = caustic((vBase - into * 1.8) * 0.05 + N.xz * 0.45, t * 0.6);
  scatter *= 0.68 + 1.3 * cIn;
  body += uScatterColor * scatter * (0.35 + 0.65 * lit);
  // and a trace of it everywhere near the top of a wave, sun or no sun
  body += uScatterColor * cIn * (0.03 + 0.1 * top) * (0.4 + 0.6 * lit);

  // ---- the sandy bed showing through where the water is shallow, with the
  //      light net sharp on it
  float depth = 0.25 + max(shore, 0.0) * 0.1;
  float clear = exp(-depth * 0.55);
  float cBed = caustic((vBase - into * depth * 0.8 + N.xz * depth * 1.5) * 0.17, t);
  vec3 bed = uSandColor * (0.42 + 0.7 * lit) * (0.72 + 1.5 * cBed * (0.3 + 0.7 * lit));
  // the more water over it, the more of the water's own colour it takes
  bed *= mix(vec3(1.0), uShallowColor * 1.2, 1.0 - exp(-depth * 0.75));
  body = mix(body, bed, clear * 0.9);

  body = mix(body, uScatterColor * (0.5 + 0.45 * lit) + 0.05, aerated * 0.4);
  body *= shade;

  // ---- reflection of the sky
  // rough water mirrors a blurred patch of sky from higher up, not the bright horizon line
  float fresnel = 0.02 + 0.7 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, Nr);
  R.y = abs(R.y) + 0.12;
  vec3 refl = skyGradient(normalize(R)) * mix(1.0, shade, 0.6);

  // ---- and of what stands on the water. The picture was drawn for a flat sea;
  //      ripples tilt the mirror, which slides the image up and down the screen
  //      far more than sideways: that is what draws reflections out into streaks.
  float mirrored = 0.0;
  if (uMirror.y > 0.0) {
    vec4 mc = uMirrorMatrix * vec4(vWorldPos.x, uMirror.x, vWorldPos.z, 1.0);
    vec2 camRight = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]));
    vec2 camAhead = -normalize(vec2(viewMatrix[0][2], viewMatrix[2][2]) + 1.0e-5);
    vec2 muv = mc.xy / max(mc.w, 1.0e-4) + vec2(dot(Nr.xz, camRight), dot(Nr.xz, camAhead) * 2.2) * uMirror.z;
    vec4 mirror = texture2D(uMirrorTex, muv, 1.2);
    vec2 inside = smoothstep(vec2(0.0), vec2(0.03), muv) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - muv);
    mirrored = mirror.a * inside.x * inside.y * uMirror.y;
    refl = mix(refl, mirror.rgb * mix(1.0, shade, 0.6), mirrored);
  }

  // ---- sun glitter: tiny facets (a normal-map lookup kept at a constant
  //      size on screen) flash when they happen to mirror the sun
  vec3 H = normalize(uSunDir + V);
  float lvl = log2(max(dist, 2.0));
  float band = floor(lvl);
  float gs = exp2(-band) * uGlint.x;
  vec2 drift = t * vec2(0.013, 0.008);
  vec2 g0 = texture2D(uNormalTex, vBase * gs + drift).xy - 0.5;
  vec2 g1 = texture2D(uNormalTex, vBase * gs * 0.5 + drift).xy - 0.5;
  vec2 g = mix(g0, g1, lvl - band) * uGlint.y;
  vec3 Ng = normalize(Nr + vec3(g.x, 0.0, g.y));
  float glint = pow(max(dot(Ng, H), 0.0), uGlint.z) * uGlint.w;
  // and a broad soft glare under the sun
  float NdH = max(dot(Nr, H), 0.0);
  float sheen = pow(NdH, 48.0) * 0.3 + pow(NdH, 12.0) * 0.06;

  // (a painted hull a few metres away shows in the water more than bare physics allows: it is the point of having it)
  vec3 col = mix(body, refl, min(1.0, fresnel + mirrored * 0.38));
  col += uSunColor * (glint + sheen) * shade * shade * (1.0 - foam);

  // the veil is aerated water: pale turquoise rather than white
  vec3 foamCol = uFoamColor * (0.6 + 0.5 * lit) * mix(1.0, shade, 0.7) * mix(1.0, foamBody, wfoam);
  vec3 veilCol = mix(uScatterColor, uFoamColor, 0.55) * (0.55 + 0.5 * lit) * mix(1.0, shade, 0.7);
  col = mix(col, veilCol, veil);
  col = mix(col, foamCol, foam);

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

export function createWater({ normalTex, noiseTex, causticTex, segments = 192 }) {
  setWaveMeshDensity(segments);
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
      uCausticTex: { value: causticTex },
      uSandColor: { value: PALETTE.sand.clone() },
      uDeepColor: { value: PALETTE.waterDeep.clone() },
      uMidColor: { value: PALETTE.waterMid.clone() },
      uShallowColor: { value: PALETTE.waterShallow.clone() },
      uScatterColor: { value: PALETTE.waterScatter.clone() },
      uFoamColor: { value: PALETTE.foam.clone() },
      uDetail: { value: 0.3 },
      uSeaHeight: { value: SEA_HEIGHT },
      uSwellDir: { value: new THREE.Vector2(waves[0].dx, waves[0].dz) },
      uFoam: { value: new THREE.Vector3(1.7, 0.3, 0.66) },
      uGlint: { value: new THREE.Vector4(2.2, 1.45, 1000, 18) },
      uWakeTex: { value: getBlackTexture() },
      uWake: { value: new THREE.Vector3(0, 0, 0.001) },
      ...mirrorUniforms,
    },
  });
  const mesh = new THREE.Mesh(createRadialGridGeometry({ segments }), material);
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 10; // after opaque scenery so hidden pixels are skipped early

  // A stand-in with a small fraction of the triangles, for pictures in which the
  // sea is only ever seen small (the map the boats' paintwork mirrors).
  const coarse = new THREE.Mesh(createRadialGridGeometry({ segments: 48, innerStep: 1.1 }), material);
  coarse.name = 'water-coarse';
  coarse.frustumCulled = false;
  coarse.matrixAutoUpdate = false;
  coarse.renderOrder = 10;
  coarse.visible = false;
  mesh.userData.coarse = coarse;

  /** Keep the dense part of the grid under the action. */
  mesh.userData.follow = (x, z) => material.uniforms.uCenter.value.set(x, z);
  /** Plug in a WakeField's uniforms ({ uWakeTex, uWake }). */
  mesh.userData.setWake = (wakeUniforms) => {
    material.uniforms.uWakeTex = wakeUniforms.uWakeTex;
    material.uniforms.uWake = wakeUniforms.uWake;
  };
  return mesh;
}
