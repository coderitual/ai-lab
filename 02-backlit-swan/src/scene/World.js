// The show: builds every part of the scene, steps them, and draws the frame.
//
// A frame, in order (see render()):
//   1. the simulation has already been stepped by update(): slow motion
//      applied, the swan moved, the ripple field advanced
//   2. the mirror camera is placed for this frame's view
//   3. the far scene (forest, bank, fence, shafts) is drawn small and thrown
//      out of focus
//   4. the same from the mirror camera, smaller: what the water reflects of
//      the surroundings
//   5. the subject (swan, drops) from the mirror camera, with alpha: what the
//      water reflects of them
//   6. the main picture: the defocused far layer as a backdrop, then the
//      water, the swan and everything else that is sharp
//   7. bloom, the grade into an 8-bit picture, then edge smoothing and film
//      grain onto the canvas
//
// Parts are made by factories that all receive the same context object, `ctx`
// (described at createContext below). Each factory owns its own file; this
// file only wires them together.

import * as THREE from 'three';
import { probeCaps } from '../engine/caps.js';
import { createRng } from '../engine/rng.js';
import { createEvents } from '../engine/events.js';
import { createMaterial, createPassMaterial } from '../engine/material.js';
import { FullscreenPass, fullscreenGeometry } from '../engine/FullscreenPass.js';
import { RippleField } from '../engine/RippleField.js';
import { PlanarMirror } from '../engine/PlanarMirror.js';
import { FarLayer } from '../engine/FarLayer.js';
import { PostChain } from '../engine/PostChain.js';
import { OrbitRig } from '../engine/OrbitRig.js';
import { clamp01 } from '../engine/math.js';
import { createLight } from '../assets/lighting.js';
import { pond } from '../assets/pond.js';
import { createSwan } from '../assets/swan/Swan.js';
import { createWater } from '../assets/pond/Water.js';
import { createSpecks } from '../assets/pond/Specks.js';
import { createForest } from '../assets/forest/Forest.js';
import { createDroplets } from '../assets/fx/Droplets.js';
import { createAmbience } from '../audio/Ambience.js';
import { SwanMind } from './SwanMind.js';
import { createDirector } from './Director.js';
import { createInteraction } from './Interaction.js';
import { LOOK, CAMERA, SIM, TIERS } from './config.js';

/** Render layers. An object is reflected in the water only if it is also on MIRROR. */
const LAYERS = { MAIN: 0, MIRROR: 2 };

const BACKDROP_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  // on the far plane, whatever the camera is doing
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
const BACKDROP_FRAGMENT = /* glsl */ `
uniform sampler2D uFar;
in vec2 vUv;
void main() {
  outColor = toTarget(vec4(fromTarget(texture(uFar, vUv)).rgb, 1.0));
}
`;

export class World {
  /**
   * @param {import('../engine/Engine.js').Engine} engine
   * @param {import('../engine/params.js').Params} params
   */
  constructor(engine, params) {
    this.engine = engine;
    this.params = params;
    const { renderer } = engine;

    const caps = probeCaps(renderer, { ldr: params.ldr });
    this.tier = params.quality || caps.tier;
    const quality = TIERS[this.tier];
    engine.setMaxPixelRatio(quality.pixelRatio);
    if (params.timeScale !== null) SIM.timeScale = params.timeScale;

    /** Seconds of slowed-down time (what the swan and the water live in). */
    this.time = 0;
    /** Seconds of real time (camera moves, film grain). */
    this.realTime = 0;

    this.scene = new THREE.Scene();
    this.farScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(20, engine.aspect, CAMERA.near, CAMERA.far);

    const ripple = new RippleField(renderer, {
      size: quality.rippleSize,
      extent: SIM.rippleExtent,
      speed: SIM.rippleSpeed,
      damping: SIM.rippleDamping,
      ldr: params.ldr,
    });
    this.ripple = ripple;

    this.ctx = this.createContext(caps, quality, ripple);
    const ctx = this.ctx;

    // --- the pipeline's own pieces
    this.mirror = new PlanarMirror(renderer, caps, { samples: quality.mirrorMsaa });
    this.far = new FarLayer(renderer, caps, { taps: quality.blurTaps, fillTaps: quality.blurFillTaps });
    this.farMirror = new FarLayer(renderer, caps, { taps: quality.blurTaps, fillTaps: quality.blurFillTaps });
    this.post = new PostChain(renderer, caps, { samples: quality.msaa, bloomLevels: quality.bloomLevels, fxaaSteps: quality.fxaaSteps });

    // The defocused far layer is put behind everything by a mesh inside the
    // main scene, not by a separate pass: a multisampled target is resolved
    // (and its samples thrown away) after every render call, so the backdrop
    // and the scene in front of it must go down in the same call.
    const backdrop = new THREE.Mesh(
      fullscreenGeometry(),
      ctx.createMaterial({
        vertexShader: BACKDROP_VERTEX,
        fragmentShader: BACKDROP_FRAGMENT,
        uniforms: { uFar: { value: this.far.texture } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    backdrop.name = 'backdrop';
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -1000;
    this.scene.add(backdrop);
    this.backdrop = backdrop;

    // --- the parts
    const wants = params.wants;
    this.forest = wants('forest') ? createForest(ctx) : null;
    if (this.forest) {
      this.farScene.add(this.forest.far);
      this.scene.add(this.forest.near);
    }
    this.water = wants('water') ? createWater(ctx, { mirror: this.mirror, farMirror: this.farMirror }) : null;
    if (this.water) this.scene.add(this.water.mesh);
    this.specks = wants('specks') ? createSpecks(ctx) : null;
    if (this.specks) this.scene.add(this.specks.object);
    this.droplets = wants('droplets') ? createDroplets(ctx) : null;
    if (this.droplets) this.scene.add(this.droplets.object);
    this.swan = wants('swan') ? createSwan(ctx) : null;
    if (this.swan) this.scene.add(this.swan.group);
    this.mind = this.swan ? new SwanMind(ctx, this.swan, this.droplets) : null;

    // --- camera, direction, interaction, sound
    this.rig = new OrbitRig(this.camera, renderer.domElement);
    Object.assign(this.rig.limits, CAMERA.limits);
    Object.assign(this.rig.drift, CAMERA.drift);
    this.rig.set({ az: CAMERA.az, el: CAMERA.el, dist: CAMERA.dist, fov: CAMERA.fov, target: CAMERA.target });
    // a camera staged in the URL is a request for exactly that picture: hold still
    this.staged = Object.keys(params.view).length > 0;
    if (this.staged) {
      this.rig.drift.az = 0;
      this.rig.drift.el = 0;
      this.rig.set(params.view);
    }
    this.director = createDirector(ctx, { rig: this.rig, mind: this.mind });
    this.interaction = createInteraction(ctx, { domElement: renderer.domElement, camera: this.camera, rig: this.rig, mind: this.mind });
    this.ambience = createAmbience(ctx);

    // Debug view of the ripple field: height in green, the two slopes in red and blue.
    this.rippleDebug = new FullscreenPass(
      createPassMaterial(caps, {
        fragmentShader: /* glsl */ `
${ripple.glsl}
uniform float uAspect;
void main() {
  // the square window, centred and as large as fits
  vec2 p = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0)) + 0.5;
  vec2 xz = uRippleRect.xy + p / uRippleRect.z;
  vec3 r = rippleSample(xz);
  vec3 c = 0.5 + vec3(r.y * 4.0, r.x * 60.0, r.z * 4.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) c = vec3(0.0);
  outColor = vec4(c, 1.0);
}`,
        uniforms: { ...ripple.uniforms, uAspect: { value: 1 } },
      }),
    );

    engine.onResize(() => this.resize());
    engine.onContextRestored(() => {
      // the heights lived only on the GPU; start from still water
      ripple.reset();
    });
    this.applyLook();
    // place the camera once, so that the first frame is right even before any time has passed
    this.placeCamera(0);
  }

  /**
   * The context handed to every factory.
   *
   *   renderer   the THREE.WebGLRenderer
   *   caps       what the device can do (engine/caps.js)
   *   quality    the tier's numbers (TIERS in config.js); quality.counts for assets
   *   rng        seeded random numbers; take your own stream: ctx.rng.fork('name')
   *   params     the URL parameters
   *   look       the LOOK object of config.js (live)
   *   uniforms   shared uniform objects: uTime (slowed seconds), uResolution
   *              (size in pixels of the target being drawn right now)
   *   light      assets/lighting.js: uniforms, glsl, setSun
   *   pond       assets/pond.js: SHORE, shoreRadius, shoreDistance, glsl
   *   ripple     the RippleField: uniforms, glsl, disturb, heightAt
   *   scene      the main scene (sharp things)
   *   farScene   the far scene (everything that is defocused as one layer)
   *   layers     { MAIN, MIRROR }
   *   events     on / off / emit: 'drop', 'billEnter', 'billExit', 'tap'
   *   subject    Vector3: where the swan is, kept up to date every step
   *   createMaterial(options)   a ShaderMaterial set up for this pipeline (engine/material.js)
   *   showInMirror(object)      put an object and all its children on the MIRROR layer too
   */
  createContext(caps, quality, ripple) {
    const { renderer } = this.engine;
    return {
      renderer,
      caps,
      quality,
      rng: createRng(this.params.seed),
      params: this.params,
      look: LOOK,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      light: createLight(),
      pond,
      ripple,
      scene: this.scene,
      farScene: this.farScene,
      layers: LAYERS,
      events: createEvents(),
      subject: new THREE.Vector3(),
      createMaterial: (options) => createMaterial(caps, options),
      showInMirror: (object) => object.traverse((o) => o.layers.enable(LAYERS.MIRROR)),
    };
  }

  /** Every target follows the canvas size, the tier's scales and the adaptive render scale. */
  resize() {
    const { engine } = this;
    const q = this.ctx.quality;
    const w = engine.targetWidth;
    const h = engine.targetHeight;
    this.post.setSize(w, h);
    this.far.setSize(w * q.farScale, h * q.farScale);
    this.farMirror.setSize(w * q.farMirrorScale, h * q.farMirrorScale);
    this.mirror.setSize(w * q.mirrorScale, h * q.mirrorScale);
  }

  /** Copy LOOK into the light and the post chain. Cheap; done every frame. */
  applyLook() {
    const { light } = this.ctx;
    light.setSun(LOOK.sunAzimuth, LOOK.sunElevation);
    light.uniforms.uSunColor.value.fromArray(LOOK.sunColor);
    light.uniforms.uSkyColor.value.fromArray(LOOK.skyColor);
    light.uniforms.uBounceColor.value.fromArray(LOOK.bounceColor);
    light.uniforms.uAmbient.value = LOOK.ambient;
    this.far.clearColor.fromArray(LOOK.farClear);
    this.farMirror.clearColor.fromArray(LOOK.farClear);
    this.post.setLook(LOOK, this.engine.pixelRatio);
  }

  /**
   * Step everything.
   * @param {number} dt seconds of real time
   */
  update(dt) {
    const { ctx, camera } = this;
    const slow = dt * SIM.timeScale;
    this.realTime += dt;
    this.time += slow;
    ctx.uniforms.uTime.value = this.time;

    if (this.mind) {
      this.mind.update(slow, this.time);
      ctx.subject.copy(this.mind.position);
    }
    if (this.swan) this.swan.update(slow, this.time);
    if (this.droplets) this.droplets.update(slow, this.time);
    this.ripple.speed = SIM.rippleSpeed;
    this.ripple.damping = SIM.rippleDamping;
    this.ripple.follow(ctx.subject.x, ctx.subject.z);
    this.ripple.step(slow);

    // the camera lives in real time: it does not slow down with the water
    this.director.update(dt, this.realTime);
    this.interaction.update(dt, this.realTime);
    this.placeCamera(dt);

    if (this.water) this.water.update(slow, this.time, camera);
    if (this.specks) this.specks.update(slow, this.time, camera);
    if (this.forest) this.forest.update(slow, this.time, camera);
    this.ambience.update(dt, this.realTime);
  }

  /**
   * Let the rig write the camera for the picture's current shape.
   * @param {number} dt seconds of real time the rig should move by (0: only re-place it)
   */
  placeCamera(dt) {
    const aspect = this.engine.aspect;
    // slide the subject's place in the picture between the two layouts as the window changes shape
    const wide = clamp01((aspect - 0.8) / 0.6);
    this.rig.offset.set(
      CAMERA.offsetPortrait[0] + (CAMERA.offsetLandscape[0] - CAMERA.offsetPortrait[0]) * wide,
      CAMERA.offsetPortrait[1] + (CAMERA.offsetLandscape[1] - CAMERA.offsetPortrait[1]) * wide,
    );
    this.rig.update(dt, aspect);
  }

  /** Draw one frame of the state as it is now. */
  render() {
    const { engine, ctx, camera, mirror, far, farMirror, post } = this;
    const { renderer } = engine;
    const resolution = ctx.uniforms.uResolution.value;
    renderer.info.reset();
    this.applyLook();

    // the view or the window may have changed since the last step (window.__swan.view, a resize)
    this.placeCamera(0);

    // 2. mirror camera
    mirror.update(camera);

    // 3. far layer, direct
    const blur = LOOK.aperture * LOOK.bokehMax;
    resolution.set(far.sharp.width, far.sharp.height);
    far.render(this.farScene, camera, blur);

    // 4. far layer, mirrored
    if (mirror.valid) {
      mirror.camera.layers.enableAll();
      resolution.set(farMirror.sharp.width, farMirror.sharp.height);
      farMirror.render(this.farScene, mirror.camera, blur);
    }

    // 5. subject, mirrored
    resolution.set(mirror.target.width, mirror.target.height);
    mirror.render(this.scene, LAYERS.MIRROR);

    // 6. main picture
    resolution.set(post.sceneTarget.width, post.sceneTarget.height);
    renderer.setRenderTarget(post.sceneTarget);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(null);

    // 7. onto the canvas
    const debug = this.params.debug;
    if (debug === 'far') post.present(far.texture);
    else if (debug === 'farmirror') post.present(farMirror.texture);
    else if (debug === 'mirror') post.present(mirror.texture, { alpha: true });
    else if (debug === 'ripple') {
      this.rippleDebug.material.uniforms.uAspect.value = engine.aspect;
      this.rippleDebug.render(renderer, null);
    } else if (debug === 'bloom') {
      post.renderBloom();
      post.present(post.bloomTexture);
    } else if (this.params.nopost) post.present(post.sceneTarget.texture);
    else post.render(this.realTime);
  }

  dispose() {
    for (const part of [this.forest, this.water, this.specks, this.droplets, this.swan, this.director, this.interaction, this.ambience, this.rig]) {
      if (part) part.dispose();
    }
    this.backdrop.material.dispose();
    this.rippleDebug.dispose();
    this.ripple.dispose();
    this.mirror.dispose();
    this.far.dispose();
    this.farMirror.dispose();
    this.post.dispose();
  }
}
