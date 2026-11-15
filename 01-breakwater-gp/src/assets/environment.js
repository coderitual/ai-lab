// Everything that makes "a sea under a sky": textures, sky dome, ocean,
// sun + ambient light. Shared by the game and the asset viewer.

import * as THREE from 'three';
import { makeCausticTexture, makeNoiseTexture, makeWaterNormalTexture } from './textures.js';
import { createSky, createSkyEnvironment } from './sky.js';
import { createWater } from './water.js';
import { PALETTE, SUN_DIR } from './palette.js';
import { updateWaveUniforms } from '../engine/waves.js';

export function createEnvironment(engine, { waterSegments = 256 } = {}) {
  const { renderer, scene } = engine;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const noiseTex = makeNoiseTexture(256, Math.min(4, anisotropy));
  const normalTex = makeWaterNormalTexture(256, anisotropy);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const causticTex = makeCausticTexture(coarse ? 192 : 256, coarse ? 2 : 3);

  const sky = createSky(noiseTex);
  scene.add(sky);

  const water = createWater({ normalTex, noiseTex, causticTex, segments: waterSegments });
  scene.add(water, water.userData.coarse);

  // Key light from the sun, soft fill from the sky.
  const sun = new THREE.DirectionalLight(PALETTE.sunColor, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);
  scene.add(sun.target);

  // Image-based light from the sky needs half-float render targets.
  const canPmrem = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const fill = new THREE.HemisphereLight('#cfe6ff', '#1f6f9a', 1.5);
  scene.add(fill);
  function buildEnvironment() {
    const envMap = canPmrem ? createSkyEnvironment(renderer, sky) : null;
    if (scene.environment) scene.environment.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = 1.0;
    fill.intensity = envMap ? 0.7 : 1.7;
  }
  buildEnvironment();
  if (engine.onContextRestored) engine.onContextRestored(buildEnvironment);

  return {
    sky,
    water,
    sun,
    noiseTex,
    normalTex,
    anisotropy,
    /** Swap the sea for its low-detail stand-in (and back) round a picture that only sees it small. */
    coarseWater(on) {
      water.visible = !on;
      water.userData.coarse.visible = on;
    },
    /** Call every rendered frame. */
    update(time, camera, focusX = camera.position.x, focusZ = camera.position.z) {
      sky.material.uniforms.uTime.value = time;
      updateWaveUniforms(time, camera.position.y);
      water.userData.follow(focusX, focusZ);
    },
  };
}
