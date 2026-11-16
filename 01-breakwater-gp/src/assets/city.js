// A city of glass towers.
//
// Every building is the same box, drawn many times over (one instanced mesh):
// a tower is one or more boxes stacked, each narrower than the one below, and
// perhaps a mast. What makes a box a building is the material, which draws the
// facade from where on the box a pixel is: floors and bays, mullions and
// spandrels, and panes of mirror glass each tilted a hair differently, so the
// sky they reflect breaks up the way it does on a real curtain wall. Far away,
// where a pane is smaller than a pixel, the pattern melts into its average
// instead of shimmering.

import * as THREE from 'three';
import { makeRng } from '../engine/math.js';
import { withSkyFog } from './sky.js';

/** Glass tints the towers come in (the colour the glass adds to what it mirrors). */
const GLASS = ['#7fb6d8', '#63c7c4', '#9aa9c9', '#c7b08a', '#8fd0e8', '#b9c4cf'];
/** And what their frames and bare walls are made of. */
const FRAME = ['#e9edf0', '#cfd6dc', '#2b3138', '#f4efe6', '#8a949e'];

function facadeMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0, envMapIntensity: 1.25 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `
        attribute vec4 aLook;   // glass tint (rgb, linear) and a random number
        attribute vec4 aFrame;  // frame colour (rgb, linear) and how much of the wall is frame (0 all glass .. 1 punched windows)
        varying vec3 vCityAt;   // where on the box, in metres from its middle
        varying vec3 vCityFace; // which face
        varying vec3 vCitySize;
        varying vec4 vCityLook;
        varying vec4 vCityFrame;
        void main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vCitySize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vCityAt = position * vCitySize;
        vCityFace = normal;
        vCityLook = aLook;
        vCityFrame = aFrame;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        varying vec3 vCityAt;
        varying vec3 vCityFace;
        varying vec3 vCitySize;
        varying vec4 vCityLook;
        varying vec4 vCityFrame;
        float cityHash(vec2 p) {
          vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z);
        }
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        float cityGlass = 0.0;
        float cityPane = 0.5;
        vec3 cityFace = abs(vCityFace);
        if (cityFace.y > 0.5) {
          // the roof: gravel, plant
          diffuseColor.rgb = vec3(0.22, 0.23, 0.24);
        } else {
          vec2 wall = cityFace.x > 0.5 ? vec2(vCityAt.z, vCityAt.y) : vec2(vCityAt.x, vCityAt.y);
          float bay = mix(2.4, 4.0, vCityLook.a);
          vec2 cell = vec2(wall.x / bay, (wall.y + vCitySize.y * 0.5) / 3.7);
          vec2 inCell = fract(cell);
          cityPane = cityHash(floor(cell) + vCityLook.a * 71.0);
          // mullions between the bays, a spandrel at each floor; more of both on a building of punched windows
          float mullion = mix(0.06, 0.34, vCityFrame.a);
          float spandrel = mix(0.2, 0.46, vCityFrame.a);
          float edge = 0.5 * fwidth(cell.x);
          float glass = smoothstep(mullion * 0.5 - edge, mullion * 0.5 + edge, min(inCell.x, 1.0 - inCell.x))
                      * smoothstep(spandrel - fwidth(cell.y), spandrel + fwidth(cell.y), inCell.y);
          // where a pane is finer than a pixel, the wall is its own average
          float fine = smoothstep(0.3, 0.9, max(fwidth(cell.x), fwidth(cell.y)));
          cityGlass = mix(glass, (1.0 - mullion) * (1.0 - spandrel), fine);
          cityPane = mix(cityPane, 0.5, fine);
          // a band of plain wall at the foot and under the roof
          float trim = step(vCityAt.y + vCitySize.y * 0.5, 4.6) + step(vCitySize.y * 0.5 - vCityAt.y, 1.6);
          cityGlass *= 1.0 - min(trim, 1.0) * 0.85;
          vec3 pane = vCityLook.rgb * (0.42 + 0.3 * cityPane);
          diffuseColor.rgb = mix(vCityFrame.rgb, pane, cityGlass);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.62, 0.05 + 0.1 * cityPane, cityGlass);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(0.05, 0.92, cityGlass);')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        // no two panes are quite in one plane
        normal = normalize(normal + (vec3(cityPane, fract(cityPane * 7.31), fract(cityPane * 3.17)) - 0.5) * 0.045 * cityGlass);`,
      );
  };
  material.customProgramCacheKey = () => 'city';
  return material;
}

/**
 * Build a city.
 * @param {{ x: number, y: number, z: number, w: number, d: number, h: number, turn?: number }[]} lots
 *   where each building stands (the middle of its foot), its footprint and its height, and how it is turned
 * @param {{ seed?: number, extend?: (m: THREE.Material) => THREE.Material }} [o] `extend`: further patches to the
 *   material (baked shadows)
 * @returns {THREE.InstancedMesh}
 */
export function createCity(lots, { seed = 77, extend = (m) => m } = {}) {
  const rng = makeRng(seed);
  // every building is some boxes: its body, perhaps a narrower crown or two, perhaps a mast
  const boxes = [];
  for (const lot of lots) {
    const glass = new THREE.Color(GLASS[Math.floor(rng() * GLASS.length)]);
    const frame = new THREE.Color(FRAME[Math.floor(rng() * FRAME.length)]);
    const punched = rng() < 0.3 ? 0.55 + rng() * 0.45 : rng() * 0.25;
    const look = [glass.r, glass.g, glass.b, rng()];
    const fr = [frame.r, frame.g, frame.b, punched];
    const turn = lot.turn || 0;
    let w = lot.w;
    let d = lot.d;
    let base = lot.y;
    let left = lot.h;
    // taller buildings step back as they rise
    const steps = lot.h > 70 ? (rng() < 0.75 ? 2 : 3) : lot.h > 38 && rng() < 0.4 ? 2 : 1;
    for (let k = 0; k < steps; k++) {
      const h = k === steps - 1 ? left : left * (0.5 + rng() * 0.22);
      boxes.push({ x: lot.x, y: base + h / 2, z: lot.z, w, h, d, turn, look, fr });
      base += h;
      left -= h;
      w *= 0.62 + rng() * 0.2;
      d *= 0.62 + rng() * 0.2;
    }
    if (lot.h > 90 && rng() < 0.6) {
      const mast = 12 + rng() * 26;
      boxes.push({ x: lot.x, y: base + mast / 2, z: lot.z, w: 0.9, h: mast, d: 0.9, turn, look: [0.3, 0.32, 0.34, 0], fr: [0.75, 0.77, 0.8, 1] });
    }
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, withSkyFog(extend(facadeMaterial())), boxes.length);
  const look = new Float32Array(boxes.length * 4);
  const frame = new Float32Array(boxes.length * 4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  boxes.forEach((b, i) => {
    m.compose(at.set(b.x, b.y, b.z), q.setFromAxisAngle(up, b.turn), size.set(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
    look.set(b.look, i * 4);
    frame.set(b.fr, i * 4);
  });
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
  geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(frame, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'city';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
