// Skid marks: one ribbon per wheel, laid where a tyre slides, kept for the whole run.
//
// All the wheels of all the cars share one mesh and one draw call. Each wheel owns a ring of `perWheel`
// quads; a quad joins the last point laid to the new one, a tyre's width across, lifted a little off the
// road along its normal. Its four corners carry an alpha (how dark the rubber is there), so a mark fades in
// as the slide builds and out as it ends. When a ring is full the oldest quad is reused, and only the quads
// written since the last frame are sent to the GPU.
//
// What is laid is decided by the caller (game/effects.js) in the fixed step; this file only stores and
// draws it.

import * as THREE from 'three';

const LIFT = 0.015; // m above the road along its normal

export class SkidMarks {
  /**
   * @param {object} o
   * @param {number} o.wheels how many ribbons
   * @param {number} o.perWheel quads in each ribbon's ring
   * @param {number} [o.width] m across
   */
  constructor({ wheels, perWheel, width = 0.24 }) {
    this.wheels = wheels;
    this.perWheel = perWheel;
    this.halfWidth = width / 2;
    const quads = wheels * perWheel;
    const position = new Float32Array(quads * 4 * 3);
    const color = new Float32Array(quads * 4 * 4);
    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    }
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // the marks are anywhere on the road: never culled as a whole
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geometry;

    const material = new THREE.MeshBasicMaterial({
      color: 0x050505,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    material.name = 'fx-skidmarks';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'fx-skidmarks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;

    /** Per wheel: next quad in its ring, and the last edge laid (left xyz, right xyz, alpha), if any. */
    this._next = new Int32Array(wheels);
    this._last = new Float32Array(wheels * 7);
    this._has = new Uint8Array(wheels);
    this._dirtyLo = Infinity;
    this._dirtyHi = -1;
    /** Quads laid since the start (for tests). */
    this.laid = 0;
    this.clear();
  }

  /** Forget every mark. */
  clear() {
    this.position.array.fill(0);
    this.color.array.fill(0);
    this._next.fill(0);
    this._has.fill(0);
    this._dirtyLo = 0;
    this._dirtyHi = this.wheels * this.perWheel - 1;
    this.laid = 0;
  }

  /** The ribbon of wheel `w` is broken: the next point starts a new one. */
  lift(w) {
    this._has[w] = 0;
  }

  /**
   * Lay the ribbon of wheel `w` on to the point (x, y, z) on a road whose normal is n, darkness `alpha` (0..1),
   * heading (dx, dz) (the direction the tyre moves over the road). The first point after a lift only starts it.
   */
  add(w, x, y, z, nx, ny, nz, dx, dz, alpha) {
    // across the ribbon: the normal crossed with the direction of travel
    let sx = ny * dz;
    let sy = nz * dx - nx * dz;
    let sz = -ny * dx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const h = this.halfWidth / sl;
    sx *= h;
    sy *= h;
    sz *= h;
    const cx = x + nx * LIFT;
    const cy = y + ny * LIFT;
    const cz = z + nz * LIFT;
    const L = this._last;
    const o = w * 7;
    if (this._has[w]) {
      const q = w * this.perWheel + this._next[w];
      this._next[w] = (this._next[w] + 1) % this.perWheel;
      const p = this.position.array;
      const c = this.color.array;
      const v = q * 12;
      p[v] = L[o];
      p[v + 1] = L[o + 1];
      p[v + 2] = L[o + 2];
      p[v + 3] = L[o + 3];
      p[v + 4] = L[o + 4];
      p[v + 5] = L[o + 5];
      p[v + 6] = cx - sx;
      p[v + 7] = cy - sy;
      p[v + 8] = cz - sz;
      p[v + 9] = cx + sx;
      p[v + 10] = cy + sy;
      p[v + 11] = cz + sz;
      const a0 = L[o + 6];
      const k = q * 16;
      for (let i = 0; i < 4; i++) {
        c[k + i * 4] = c[k + i * 4 + 1] = c[k + i * 4 + 2] = 1;
        c[k + i * 4 + 3] = i < 2 ? a0 : alpha;
      }
      if (q < this._dirtyLo) this._dirtyLo = q;
      if (q > this._dirtyHi) this._dirtyHi = q;
      this.laid++;
    }
    L[o] = cx - sx;
    L[o + 1] = cy - sy;
    L[o + 2] = cz - sz;
    L[o + 3] = cx + sx;
    L[o + 4] = cy + sy;
    L[o + 5] = cz + sz;
    L[o + 6] = alpha;
    this._has[w] = 1;
  }

  /** Send what changed to the GPU (once per drawn frame is enough). */
  upload() {
    if (this._dirtyHi < 0) return;
    const lo = this._dirtyLo;
    const n = this._dirtyHi - lo + 1;
    this.position.clearUpdateRanges();
    this.color.clearUpdateRanges();
    this.position.addUpdateRange(lo * 12, n * 12);
    this.color.addUpdateRange(lo * 16, n * 16);
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this._dirtyLo = Infinity;
    this._dirtyHi = -1;
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
