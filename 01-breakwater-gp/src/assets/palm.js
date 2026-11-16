// Coconut palms.
//
// A palm is a ringed trunk that leans out and then straightens up, and a crown
// of fronds: young ones standing, mature ones arching, old ones hanging. A
// frond is a strip folded along its spine; what makes it a frond is the
// picture on it, a spine with some ninety tapering leaflets, painted here on a
// canvas, with the gaps between the leaflets cut out. The trees lean with the
// gusts and their fronds bob (in the vertex shader), and the sun shines
// through a leaf seen from below.

import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU, DEG } from '../engine/math.js';
import { withSkyFog } from './sky.js';

/** Shared by every palm: the clock the wind runs on. */
export const palmUniforms = { uPalmTime: { value: 0 } };

// ---------------------------------------------------------------- textures

const FROND_HALF = 0.8; // half the width of the strip a frond is drawn on, in metres

/** The frond: colour (opaque, so that nothing dark bleeds in at the cut edges) and, separately, its outline. */
function frondTextures(scale = 1, anisotropy = 4) {
  const W = Math.round(384 * scale);
  const H = Math.round(1024 * scale);
  const colour = document.createElement('canvas');
  const mask = document.createElement('canvas');
  colour.width = mask.width = W;
  colour.height = mask.height = H;
  const c = colour.getContext('2d');
  const m = mask.getContext('2d');
  c.fillStyle = '#5c9a3c';
  c.fillRect(0, 0, W, H);
  m.fillStyle = '#000';
  m.fillRect(0, 0, W, H);
  m.fillStyle = '#fff';
  const rng = makeRng(77);
  const N = 46;
  const mid = W / 2;
  // base at the bottom of the canvas, tip at the top
  const yAt = (t) => H * (1 - (0.03 + 0.95 * t));
  const leaflets = [];
  for (let i = 0; i < N; i++) {
    for (const side of [-1, 1]) {
      const t = (i + (side > 0 ? 0.75 : 0.25) + (rng() - 0.5) * 0.3) / N;
      leaflets.push({ t, side, k: rng(), bend: rng() });
    }
  }
  // from the tip back to the base, so that each leaflet lies over the one beyond it
  leaflets.sort((a, b) => b.t - a.t);
  for (const { t, side, k, bend } of leaflets) {
    const y0 = yAt(t);
    const reach = mid * 0.97 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)), 0.55) * (1 - 0.22 * t) * (0.86 + 0.14 * k);
    const angle = lerp(64, 20, Math.pow(t, 0.8)) * DEG + (k - 0.5) * 0.1;
    const dx = Math.sin(angle) * side;
    const dy = -Math.cos(angle);
    const half = W * 0.021 * (1 - 0.45 * t) * (0.8 + 0.4 * k);
    const tipX = mid + dx * reach;
    const tipY = y0 + dy * reach + reach * 0.16 * bend; // the tip hangs a little
    const cx = mid + dx * reach * 0.55;
    const cy = y0 + dy * reach * 0.55 - reach * 0.03;
    for (const ctx of [c, m]) {
      ctx.beginPath();
      ctx.moveTo(mid, y0 - half * 1.3);
      ctx.quadraticCurveTo(cx - dy * half, cy + dx * half - half * 0.6, tipX, tipY);
      ctx.quadraticCurveTo(cx + dy * half, cy - dx * half + half * 0.9, mid, y0 + half * 1.3);
      ctx.closePath();
      if (ctx === c) {
        const g = c.createLinearGradient(mid, y0, tipX, tipY);
        const light = 0.82 + 0.3 * k;
        const dry = k > 0.9 ? 1 : 0; // now and then a tip has dried
        g.addColorStop(0, `rgb(${Math.round(52 * light)},${Math.round(112 * light)},${Math.round(40 * light)})`);
        g.addColorStop(0.55, `rgb(${Math.round(88 * light)},${Math.round(156 * light)},${Math.round(52 * light)})`);
        g.addColorStop(1, dry ? 'rgb(176,150,74)' : `rgb(${Math.round(142 * light)},${Math.round(190 * light)},${Math.round(72 * light)})`);
        c.fillStyle = g;
        c.fill();
        // its midrib and the shade of the leaflet lying over it
        c.strokeStyle = 'rgba(190,214,120,0.5)';
        c.lineWidth = Math.max(1, W / 256);
        c.beginPath();
        c.moveTo(mid, y0);
        c.quadraticCurveTo(cx, cy, tipX, tipY);
        c.stroke();
        c.strokeStyle = 'rgba(18,48,18,0.42)';
        c.beginPath();
        c.moveTo(mid, y0 + half * 1.3);
        c.quadraticCurveTo(cx + dy * half, cy - dx * half + half * 0.9, tipX, tipY);
        c.stroke();
      } else ctx.fill();
    }
  }
  // the spine
  for (const ctx of [c, m]) {
    ctx.beginPath();
    ctx.moveTo(mid - W * 0.022, H);
    ctx.lineTo(mid - W * 0.004, yAt(1));
    ctx.lineTo(mid + W * 0.004, yAt(1));
    ctx.lineTo(mid + W * 0.022, H);
    ctx.closePath();
    if (ctx === c) {
      const g = c.createLinearGradient(mid - W * 0.022, 0, mid + W * 0.022, 0);
      g.addColorStop(0, '#8f9a48');
      g.addColorStop(0.5, '#d2d489');
      g.addColorStop(1, '#7d8a3e');
      c.fillStyle = g;
    }
    ctx.fill();
  }
  const finish = (canvas, srgb) => {
    const tex = new THREE.CanvasTexture(canvas);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  };
  return { map: finish(colour, true), alphaMap: finish(mask, false) };
}

/** The trunk: rings where fronds once grew, fibres running up it. Tiles both ways. Colour and relief. */
function barkTextures(anisotropy = 4) {
  const W = 128;
  const H = 256;
  const RINGS = 9;
  const rng = makeRng(311);
  const column = Array.from({ length: W }, () => rng());
  const speck = Array.from({ length: W * H }, () => rng());
  const height = new Float32Array(W * H);
  const colour = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * TAU;
      const ringAt = (y / H) * RINGS + 0.13 * Math.sin(u * 2 + 1.3) + 0.06 * Math.sin(u * 5 + (y / H) * TAU);
      const f = ringAt - Math.floor(ringAt);
      const scar = 1 - smoothstep(0.0, 0.16, f); // the dark groove
      const swell = smoothstep(0.16, 0.3, f) * (1 - smoothstep(0.3, 0.95, f)); // the band stands out just above it
      const fibre = (column[x] - 0.5) * 0.5 + (column[(x * 7 + 3) % W] - 0.5) * 0.3;
      const grit = speck[y * W + x] - 0.5;
      height[y * W + x] = swell * 0.8 - scar * 1.0 + fibre * 0.25 + grit * 0.12;
      const shade = 1 + swell * 0.16 - scar * 0.42 + fibre * 0.2 + grit * 0.1;
      const i = (y * W + x) * 4;
      colour[i] = 196 * shade;
      colour[i + 1] = 172 * shade;
      colour[i + 2] = 140 * shade;
      colour[i + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(W * H * 4);
  const at = (x, y) => height[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * 1.6;
      const dy = (at(x, y - 1) - at(x, y + 1)) * 1.6;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      normal[i] = (dx * inv * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy * inv * 0.5 + 0.5) * 255; // (rows run downward in the data, upward on the trunk)
      normal[i + 2] = (inv * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const finish = (data, srgb) => {
    const tex = new THREE.DataTexture(new Uint8Array(data.buffer), W, H, THREE.RGBAFormat);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  };
  return { map: finish(colour, true), normalMap: finish(normal, false) };
}

// ---------------------------------------------------------------- geometry

/** Collects vertices: position, normal, uv, colour, and `sway` (how far it moves in the wind, a phase, how much it bobs). */
class Builder {
  constructor() {
    this.position = [];
    this.normal = [];
    this.uv = [];
    this.color = [];
    this.sway = [];
    this.index = [];
  }
  get count() {
    return this.position.length / 3;
  }
  vertex(p, n, u, v, c, flex, bob) {
    this.position.push(p.x, p.y, p.z);
    this.normal.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.color.push(c[0], c[1], c[2]);
    this.sway.push(flex, 0, bob);
    return this.count - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 3));
    g.setIndex(this.index);
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** One palm standing at the origin. Returns its two geometries: the woody parts and the fronds. */
function buildPalm(rng, height) {
  const wood = new Builder();
  const leaf = new Builder();
  const v = () => new THREE.Vector3();

  // ---- trunk: leans out from its foot, then grows straight toward the light
  const leanDir = rng() * TAU;
  const lean = height * (0.1 + 0.26 * rng());
  const wobble = rng() * TAU;
  const spine = (t) => {
    const out = lean * (1.9 * t - 0.9 * t * t) * 0.9 + 0.12 * Math.sin(t * 5.5 + wobble);
    const side = 0.14 * Math.sin(t * 4.1 + wobble * 2);
    return v().set(Math.cos(leanDir) * out - Math.sin(leanDir) * side, height * t - 0.45, Math.sin(leanDir) * out + Math.cos(leanDir) * side);
  };
  const RINGS = 9;
  const SIDES = 7;
  const tint = 0.86 + 0.14 * rng();
  let run = 0;
  let before = spine(0);
  const tangent = v();
  const a = v();
  const b = v();
  const n = v();
  const p = v();
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const at = spine(t);
    run += at.distanceTo(before);
    before = at;
    tangent.copy(spine(Math.min(1, t + 0.02))).sub(spine(Math.max(0, t - 0.02))).normalize();
    a.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    b.crossVectors(tangent, a);
    const radius = 0.19 * (1 - 0.3 * t) + 0.15 * Math.exp(-t * 11) + 0.04 * Math.exp(-(((t - 0.97) / 0.05) ** 2));
    const shade = tint * (0.78 + 0.22 * smoothstep(0, 0.12, t)) * (1 - 0.25 * smoothstep(0.86, 1, t));
    for (let s = 0; s <= SIDES; s++) {
      const ang = (s / SIDES) * TAU;
      n.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
      p.copy(at).addScaledVector(n, radius);
      wood.vertex(p, n, (s / SIDES) * 2, run / 1.25, [shade, shade, shade], 0.34 * t * t, 0);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let s = 0; s < SIDES; s++) {
      const k = i * (SIDES + 1) + s;
      wood.index.push(k, k + 1, k + SIDES + 1, k + 1, k + SIDES + 2, k + SIDES + 1);
    }
  }
  const top = spine(1);

  // ---- the heart of the crown, and the nuts under it
  const ball = (centre, radius, colour, flex) => {
    const g = new THREE.SphereGeometry(radius, 6, 4);
    const base = wood.count;
    for (let i = 0; i < g.attributes.position.count; i++) {
      n.fromBufferAttribute(g.attributes.normal, i);
      p.fromBufferAttribute(g.attributes.position, i).add(centre);
      wood.vertex(p, n, 0.31 + n.x * 0.04, 0.62 + n.y * 0.02, colour, flex, 0);
    }
    for (let i = 0; i < g.index.count; i++) wood.index.push(base + g.index.getX(i));
    g.dispose();
  };
  ball(v().copy(top).add(v().set(0, 0.05, 0)), 0.3, [0.62, 0.52, 0.34], 0.34);
  const nuts = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nuts; i++) {
    const ang = rng() * TAU;
    const green = rng() > 0.5;
    ball(v().copy(top).add(v().set(Math.cos(ang) * 0.27, -0.22 - rng() * 0.1, Math.sin(ang) * 0.27)), 0.15 + rng() * 0.03, green ? [0.6, 0.78, 0.3] : [0.78, 0.6, 0.34], 0.34);
  }

  // ---- fronds, placed round the crown by the golden angle so that no two lie over each other
  const SEGMENTS = 7;
  const count = 22 + Math.floor(rng() * 5);
  const side = v();
  const face = v();
  const dir = v();
  const edge = v();
  const en = v();
  for (let f = 0; f < count; f++) {
    const age = (f + rng() * 0.6) / count; // 0: the newest, standing in the middle .. 1: the oldest, hanging
    const azimuth = f * 2.39996 + rng() * 0.3;
    const length = lerp(2.9, 4.5, Math.sin(Math.PI * clamp01(age * 1.05))) * (0.9 + 0.2 * rng()) * (height / 8.5) ** 0.4;
    const rise = lerp(76, -22, Math.pow(age, 0.9)) * DEG + (rng() - 0.5) * 0.2;
    const droop = lerp(0.75, 1.25, age) + (rng() - 0.5) * 0.3;
    const twist = (rng() - 0.5) * 0.5;
    const hx = Math.cos(azimuth);
    const hz = Math.sin(azimuth);
    side.set(-hz, 0, hx);
    // colour: fresh yellow-green when new, deep green in its prime, yellowing and then brown at the end
    const colour =
      age < 0.25
        ? [0.9, 1.0, 0.62]
        : age < 0.72
          ? [0.72 + 0.1 * rng(), 0.92, 0.55]
          : age < 0.9
            ? [0.95, 0.9, 0.42]
            : [0.86, 0.62, 0.34];
    const base = leaf.count;
    p.copy(top).add(v().set(hx * 0.12, 0.1, hz * 0.12));
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      const theta = rise - droop * Math.pow(s, 1.25);
      dir.set(hx * Math.cos(theta), Math.sin(theta), hz * Math.cos(theta));
      if (i > 0) p.addScaledVector(dir, length / SEGMENTS);
      face.crossVectors(side, dir).normalize();
      // the two halves stand up in a V near the stem and hang toward the tip
      const fold = lerp(0.5, -0.75, smoothstep(0.05, 0.85, s)) + twist * s;
      const shade = lerp(0.5, 1, smoothstep(0, 0.3, s));
      const c = [colour[0] * shade, colour[1] * shade, colour[2] * shade];
      const flex = 0.34 + 0.66 * s * s;
      const bob = s * s * (0.5 + 0.5 * age);
      for (const k of [1, -1]) {
        edge.copy(side).multiplyScalar(k * Math.cos(fold)).addScaledVector(face, Math.sin(fold));
        en.copy(face).multiplyScalar(Math.cos(fold)).addScaledVector(side, -k * Math.sin(fold));
        leaf.vertex(v().copy(p).addScaledVector(edge, FROND_HALF), en, 0.5 + k * 0.5, s, c, flex, bob);
      }
      leaf.vertex(p, face, 0.5, s, c, flex, bob * 0.8);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const k = base + i * 3; // per station: left edge, right edge, spine
      const l0 = k;
      const r0 = k + 1;
      const m0 = k + 2;
      const l1 = k + 3;
      const r1 = k + 4;
      const m1 = k + 5;
      leaf.index.push(m0, l0, m1, l0, l1, m1, m0, m1, r0, m1, r1, r0);
    }
  }
  return { wood: wood.build(), leaf: leaf.build() };
}

// ---------------------------------------------------------------- materials

// Trees lean with the gusts, more the higher up, and the fronds bob. Positions are world positions (the groves are
// merged in place), so every tree is at a different point in the gust.
function withSway(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    Object.assign(shader.uniforms, palmUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 sway;\nuniform float uPalmTime;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          float gust = sin(uPalmTime * 0.8 + sway.y) * 0.6 + sin(uPalmTime * 1.9 + sway.y * 1.7) * 0.4;
          transformed.xz += vec2(0.8, 0.6) * (0.1 + gust * 0.22) * sway.x;
          transformed.y += sin(uPalmTime * 2.3 + sway.y * 3.0 + position.x * 0.9 + position.z * 1.1) * 0.13 * sway.z;
        }`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${key}|sway`;
  return material;
}

// The sun through a leaf: a leaf seen from its shaded side glows yellow-green.
function withTranslucency(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      /* glsl */ `
      #include <lights_fragment_begin>
      #if NUM_DIR_LIGHTS > 0
      {
        float through = max(dot(-normal, directionalLights[0].direction), 0.0);
        reflectedLight.directDiffuse += directionalLights[0].color * through * 0.62 * diffuseColor.rgb * vec3(1.0, 1.0, 0.5) * RECIPROCAL_PI;
      }
      #endif`,
    );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${key}|through`;
  return material;
}

let shared = null;
function textures(scale, anisotropy) {
  if (!shared) shared = { frond: frondTextures(scale, anisotropy), bark: barkTextures(anisotropy) };
  return shared;
}

/**
 * A grove: every palm of one island as two meshes (wood, fronds).
 * @param {{x: number, y: number, z: number}[]} spots where they stand, in world space
 * @param {{ seed?: number, scale?: number, anisotropy?: number, extend?: (m: THREE.Material) => THREE.Material }} [o]
 *   `scale`: size of the frond picture (0.5 on phones); `extend`: further material patches (the island's baked shadow)
 */
export function createPalms(spots, { seed = 5, scale = 1, anisotropy = 4, extend = (m) => m } = {}) {
  const rng = makeRng(seed);
  const tex = textures(scale, anisotropy);
  const variants = [7.0, 8.4, 9.6, 6.2, 10.4].map((h) => buildPalm(rng, h));
  const woods = [];
  const leaves = [];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const at = new THREE.Vector3();
  spots.forEach((spot, i) => {
    const variant = variants[i % variants.length];
    const k = 0.85 + rng() * 0.35;
    matrix.compose(at.set(spot.x, spot.y, spot.z), q.setFromAxisAngle(UP, rng() * TAU), size.setScalar(k));
    const phase = rng() * TAU;
    for (const [from, into] of [
      [variant.wood, woods],
      [variant.leaf, leaves],
    ]) {
      const g = from.clone().applyMatrix4(matrix);
      const sway = g.attributes.sway;
      for (let j = 0; j < sway.count; j++) sway.setY(j, phase);
      into.push(g);
    }
  });
  variants.forEach((variant) => {
    variant.wood.dispose();
    variant.leaf.dispose();
  });
  const group = new THREE.Group();
  group.name = 'palms';
  const add = (geometries, material, name) => {
    if (!geometries.length) return;
    const merged = mergeAll(geometries);
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  add(
    woods,
    withSkyFog(extend(withSway(new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), vertexColors: true, roughness: 0.92, metalness: 0 })))),
    'palm-wood',
  );
  add(
    leaves,
    withSkyFog(
      extend(
        withTranslucency(
          withSway(
            new THREE.MeshStandardMaterial({
              map: tex.frond.map,
              alphaMap: tex.frond.alphaMap,
              alphaTest: 0.4,
              alphaToCoverage: true,
              side: THREE.DoubleSide,
              vertexColors: true,
              roughness: 0.72,
              metalness: 0,
            }),
          ),
        ),
      ),
    ),
    'palm-fronds',
  );
  group.matrixAutoUpdate = false;
  return group;
}

/** Join geometries that all have the same attributes into one. */
function mergeAll(geometries) {
  const names = Object.keys(geometries[0].attributes);
  let vertices = 0;
  let indices = 0;
  for (const g of geometries) {
    vertices += g.attributes.position.count;
    indices += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geometries[0].attributes[name].itemSize;
    const data = new Float32Array(vertices * size);
    let offset = 0;
    for (const g of geometries) {
      data.set(g.attributes[name].array, offset);
      offset += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const index = new Uint32Array(indices);
  let io = 0;
  let vo = 0;
  for (const g of geometries) {
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) index[io++] = src[i] + vo;
    vo += g.attributes.position.count;
    g.dispose();
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
