// A plain studio for judging the car's surfaces (dev viewer only: `studio=1`, `stripes=1`).
//
// The world is hidden and the car stands on a grey floor inside a dome that is its own light:
//  - studio: dark walls, a long soft box overhead and a band of light round the horizon, as a
//    car is photographed: the highlights run the length of the body and show its lines;
//  - stripes: a light tunnel, bright horizontal tubes running the length of the car, as designers
//    use to hunt wobbles: every tube's mirror image must flow along the body without a kink.
// The car's reflection probe sees the dome, so the paint mirrors it; the world's sun stays on
// as the key light (and for the sparkle of the flake near its highlight).

import * as THREE from 'three';

/**
 * @param {{ stripes?: boolean, exposure?: number }} [options] `exposure`: the picture's exposure, so that the
 *   studio looks the same at any time of day
 * @returns {{ group: THREE.Group, dispose: () => void }}
 */
export function createStudio({ stripes = false, exposure = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'studio';
  // (it writes depth: the world's sky and its far forest are drawn after the scene's meshes, and would cover it)
  const dome = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
  dome.defines = { STUDIO_STRIPES: stripes ? 1 : 0 };
  dome.onBeforeCompile = (shader) => {
    shader.uniforms.studioGain = { value: 1 / exposure };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStudioDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStudioDir = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStudioDir;\nuniform float studioGain;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  {
    vec3 d = normalize(vStudioDir);
    float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
    vec3 c;
  #if STUDIO_STRIPES == 1
    // a light tunnel: tubes running the length of the car, every 10 degrees round its long axis
    float round_ = degrees(atan(d.y, abs(d.x)));
    float band = smoothstep(0.22, 0.28, abs(fract(round_ / 10.0) - 0.5));
    c = mix(vec3(2.2), vec3(0.015), band);
    if (el < -1.0) c = vec3(0.05);
  #else
    // a showroom: dark walls, a dim band round the horizon (the far wall's foot, lit), two long strip lights high
    // on either side running the length of the car (the lines along its shoulders) and the soft box overhead
    c = vec3(0.02, 0.021, 0.024);
    c += vec3(0.32, 0.33, 0.35) * smoothstep(-1.0, 1.0, el) * (1.0 - smoothstep(3.0, 12.0, el));
    float along = abs(d.z) / max(length(d.xz), 1e-4);
    c += vec3(2.6, 2.6, 2.55) * smoothstep(0.6, 1.2, abs(el - 24.0) * -1.0 + 2.0) * (1.0 - smoothstep(0.55, 0.7, along));
    // the soft box overhead: 9 m long, 3 m wide, 6 m up, lying along the car
    if (d.y > 0.05) {
      vec2 at = d.xz * (6.0 / d.y);
      float box = (1.0 - smoothstep(1.3, 1.7, abs(at.x))) * (1.0 - smoothstep(4.2, 4.8, abs(at.y)));
      c += vec3(3.2, 3.2, 3.1) * box;
    }
    if (el < -1.0) c = vec3(0.05);
  #endif
    diffuseColor.rgb = c * studioGain;
  }`,
      );
  };
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 32), dome);
  sphere.renderOrder = -10;
  sphere.frustumCulled = false;
  const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
  floorMaterial.color.setRGB(0.07, 0.07, 0.075, THREE.LinearSRGBColorSpace);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  group.add(sphere, floor);
  return {
    group,
    dispose() {
      sphere.geometry.dispose();
      floor.geometry.dispose();
      dome.dispose();
      floorMaterial.dispose();
    },
  };
}
