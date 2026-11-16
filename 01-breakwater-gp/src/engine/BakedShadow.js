// Sun shadows for things that never move, drawn once.
//
// The shadows the boats cast are redrawn every frame over a small patch of sea
// that follows the boat (assets/environment.js). An island is far too big for
// that patch and does not move, so its shadows are baked: the island and
// everything standing on it are drawn once from the sun's direction into a
// depth picture, and their materials then ask that picture "is anything
// between this point and the sun?" for as long as the game runs.

import * as THREE from 'three';

export class BakedShadow {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ size?: number, center: THREE.Vector3, radius: number, toSun: THREE.Vector3 }} o
   *   the sphere that everything casting or receiving fits in, and the unit vector toward the sun
   */
  constructor(renderer, { size = 2048, center, radius, toSun }) {
    this.renderer = renderer;
    this.size = size;
    const depth = new THREE.DepthTexture(size, size);
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    depth.compareFunction = THREE.LessEqualCompare; // read it as "how much of this spot is lit", already smoothed
    this.target = new THREE.WebGLRenderTarget(size, size, { depthTexture: depth, depthBuffer: true });
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.NearestFilter;

    this.camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.5, radius * 2 + 0.5);
    this.camera.position.copy(center).addScaledVector(toSun, radius + 0.5);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    // world -> where in the picture (xy, 0..1) and how far from the sun (z, 0..1)
    const matrix = new THREE.Matrix4()
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    /** One world unit along the sun's direction, as a step in depth. */
    const perMetre = 1 / (radius * 2);
    this.uniforms = {
      uBakedShadow: { value: depth },
      uBakedMatrix: { value: matrix },
      // x: one texel; y: how far a receiver is pushed toward the sun before it is tested (stops a surface shading itself);
      // z: how far it is pushed along its own normal, in metres
      uBakedInfo: { value: new THREE.Vector3(1 / size, 0.05 * perMetre, (2.4 * radius) / size) },
    };
    this.scene = new THREE.Scene();
    this._plain = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this._cut = new Map();
  }

  /**
   * Draw the picture. Call again after the context has been lost.
   * @param {THREE.Object3D[]} casters meshes (or groups of them); a material with an `alphaMap` or a `map` and an
   *   `alphaTest` casts the shadow of its cut-out shape
   */
  bake(casters) {
    const { renderer, scene } = this;
    scene.clear();
    for (const caster of casters) {
      caster.updateMatrixWorld(true);
      caster.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        let material = this._plain;
        if (m && m.alphaTest > 0 && (m.alphaMap || m.map)) {
          const key = (m.alphaMap || m.map).uuid;
          material = this._cut.get(key);
          if (!material) {
            material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, alphaTest: m.alphaTest, alphaMap: m.alphaMap, map: m.alphaMap ? null : m.map });
            this._cut.set(key, material);
          }
        }
        const copy = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, material, o.count) : new THREE.Mesh(o.geometry, material);
        if (o.isInstancedMesh) copy.instanceMatrix = o.instanceMatrix;
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(o.matrixWorld);
        copy.matrixWorld.copy(o.matrixWorld);
        copy.frustumCulled = false;
        scene.add(copy);
      });
    }
    const previous = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
    renderer.shadowMap.enabled = shadows;
    scene.clear();
  }

  dispose() {
    this.target.dispose();
    this._plain.dispose();
    for (const m of this._cut.values()) m.dispose();
  }
}

/**
 * Make a lit built-in material (Standard / Lambert / Phong) take the sun's light only where the baked picture says
 * the sun reaches. `material.userData.bakedShadow` may be changed later to another BakedShadow's uniforms.
 */
export function withBakedShadow(material, baked) {
  const uniforms = baked.uniforms;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `
        uniform mat4 uBakedMatrix;
        uniform vec3 uBakedInfo;
        varying vec3 vBaked;
        void main() {`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        {
          vec3 bakedNormal = objectNormal;
          vec4 bakedAt = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            bakedNormal = mat3(instanceMatrix) * bakedNormal;
            bakedAt = instanceMatrix * bakedAt;
          #endif
          bakedNormal = normalize(mat3(modelMatrix) * bakedNormal);
          bakedAt = modelMatrix * bakedAt;
          bakedAt.xyz += bakedNormal * uBakedInfo.z;
          vBaked = (uBakedMatrix * bakedAt).xyz;
          vBaked.z -= uBakedInfo.y;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        uniform sampler2DShadow uBakedShadow;
        uniform vec3 uBakedInfo;
        varying vec3 vBaked;
        // how much of the sun reaches this point: nine looks at the picture, each already smoothed over four texels
        float bakedSun() {
          if (vBaked.x <= 0.0 || vBaked.x >= 1.0 || vBaked.y <= 0.0 || vBaked.y >= 1.0 || vBaked.z >= 1.0) return 1.0;
          float t = uBakedInfo.x;
          float sum = texture(uBakedShadow, vBaked);
          sum += texture(uBakedShadow, vBaked + vec3(t, 0.0, 0.0)) + texture(uBakedShadow, vBaked - vec3(t, 0.0, 0.0));
          sum += texture(uBakedShadow, vBaked + vec3(0.0, t, 0.0)) + texture(uBakedShadow, vBaked - vec3(0.0, t, 0.0));
          sum += texture(uBakedShadow, vBaked + vec3(t, t, 0.0)) + texture(uBakedShadow, vBaked - vec3(t, t, 0.0));
          sum += texture(uBakedShadow, vBaked + vec3(t, -t, 0.0)) + texture(uBakedShadow, vBaked + vec3(-t, t, 0.0));
          return sum / 9.0;
        }
        void main() {`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          float bakedLit = bakedSun();
          reflectedLight.directDiffuse *= bakedLit;
          reflectedLight.directSpecular *= bakedLit;
          #ifdef BAKED_SUN_OUT
            bakedSunOut = bakedLit;
          #endif
        }`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${key}|baked`;
  return material;
}
