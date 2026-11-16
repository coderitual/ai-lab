// Draws one material over a whole render target.
//
// The "quad" is a single triangle that is bigger than the screen: the part
// that sticks out is clipped away for free, and unlike two triangles there is
// no diagonal seam where pixels get shaded twice.

import * as THREE from 'three';

let sharedGeometry = null;
function triangle() {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.BufferGeometry();
    sharedGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    // it never moves and is never culled, but three.js wants a bounding sphere to exist
    sharedGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }
  return sharedGeometry;
}

/** The big triangle, for meshes that want to cover the screen from inside a scene. */
export const fullscreenGeometry = triangle;

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class FullscreenPass {
  /** @param {THREE.Material} material made with createPassMaterial() */
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(triangle(), material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Draw into `target` (null: the canvas). The previous render target is put
   * back afterwards, so a pass can be used from anywhere.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget|null} target
   */
  render(renderer, target) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, camera);
    renderer.setRenderTarget(previous);
  }

  dispose() {
    this.material.dispose();
  }
}
