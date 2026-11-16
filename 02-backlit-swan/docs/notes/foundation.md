# Foundation notes

What the foundation of `02-backlit-swan` is, as built: the frame pipeline, the
shared context, the URL parameters and debug hooks, and the rules the parts
that replace the placeholders have to keep. Written to be folded into the
final docs; every number here is in the source and should be changed there
first.

## Layout

```
index.html              the page: #scene (canvas goes here), #loading (veil)
src/main.js             boots Engine, World, Ui; window.__swan, window.__ready
src/engine/             reusable; knows nothing about swans or ponds
  Engine.js             renderer, canvas, loop, manual stepping, resize, lost context, adaptive render scale
  caps.js               capability probe, tier guess, createTarget / resizeTarget
  params.js             URL parameters
  rng.js                seeded random numbers with named sub-streams
  events.js             on / off / emit
  math.js               clamp, lerp, damp, angles
  glsl.js               GLSL_COMMON: hashes, value noise, fbm, luma, sRGB, toTarget / fromTarget
  material.js           createMaterial (scene), createPassMaterial (full screen)
  FullscreenPass.js     one big triangle
  RippleField.js        the ripple simulation
  PlanarMirror.js       mirror camera, texture matrix, subject mirror target
  FarLayer.js           a scene drawn small and defocused with a disc blur
  PostChain.js          scene target, bloom, grade, FXAA + grain
  OrbitRig.js           the camera (placeholder: no gestures)
src/assets/             what is visible
  lighting.js           the light, once
  pond.js               the shore outline, once (JS and GLSL from one table)
  swan/Swan.js          PLACEHOLDER
  pond/Water.js         PLACEHOLDER
  pond/Specks.js        PLACEHOLDER
  forest/Forest.js      PLACEHOLDER
  fx/Droplets.js        PLACEHOLDER
src/scene/              the show
  config.js             LOOK, CAMERA, SIM, TIERS
  World.js              builds ctx and every part, owns the frame
  SwanMind.js           PLACEHOLDER
  Director.js           stub
  Interaction.js        stub
src/ui/Ui.js, ui.css    stub: only the loading veil
src/audio/Ambience.js   stub
tools/shot.cjs          one screenshot of any URL
```

## Conventions

- Metres, Y up, water is the plane y = 0, the pond's centre is the origin.
- Compass: north is -Z, east is +X. Compass angles are measured from north
  toward east. The sun's azimuth (`LOOK.sunAzimuth`), `pond.shoreRadius(theta)`
  and the camera's `az` all use this. `rig.az` is the direction the camera
  *looks* in: `az = 0` looks north from due south of the target, so the scene
  is backlit when `rig.az` is near `LOOK.sunAzimuth` (14).
- The swan faces `(sin h, 0, cos h)` for heading `h`; it starts at the origin
  facing west (`h = -PI/2`), side-on to the default camera.
- Two clocks. Slowed time (`world.time`, the `uTime` uniform, the `dt`/`time`
  given to assets and to `SwanMind`) is real time times `SIM.timeScale` (0.4).
  Real time (`world.realTime`) drives the camera, Director, Interaction, Ui,
  Ambience and the film grain.
- No `Math.random`, no `Date.now` anywhere in `src`. `performance.now` is read
  only by the engine's loop. Random numbers come from `ctx.rng.fork('name')`.

## The frame

`World.update(dt)` steps, `World.render()` draws. Sizes are relative to the
scene target, which is the canvas in device pixels times the adaptive render
scale.

| # | What | Target | Size | Format |
| - | ---- | ------ | ---- | ------ |
| 1 | Ripple step, 0 to 8 times (1/240 s of slowed time each; about 1.6 a frame at 60 fps) | ripple state, ping-pong | `rippleSize`² | RG32F, nearest (RG16F if only half-float targets exist; RGBA8 hand-packed 16-bit with `?ldr`) |
| 1 | Ripple field (once per frame that stepped) | ripple field | `rippleSize`² | RGBA16F, linear: height, dH/dx, dH/dz (RGBA8 with `?ldr`) |
| 2 | Mirror camera placed (no drawing) | | | |
| 3 | Far scene from the camera | `far.sharp` | `farScale` | RGBA16F + depth, mip chain |
| 3 | Disc blur, `blurTaps` taps, each read from the mip level that matches the gap between taps | `far.half` | `farScale` | RGBA16F |
| 3 | Fill blur, `blurFillTaps` taps | `far.blurred` | `farScale` | RGBA16F |
| 4 | The same three from the mirror camera | `farMirror.*` | `farMirrorScale` | as above |
| 5 | Main scene, MIRROR layer only, from the mirror camera, cleared to transparent | `mirror.target` | `mirrorScale` | RGBA16F + depth, MSAA `mirrorMsaa`, alpha |
| 6 | Main scene from the camera: backdrop mesh (reads `far.blurred`), opaque things, water, specks, droplets | `post.sceneTarget` | 1 | RGBA16F + depth, MSAA `msaa` |
| 7 | Bloom down: `bloomLevels` passes, 13 taps (the first with threshold and firefly damping) | `post.down[i]` | 1/2, 1/4, ... | RGBA16F |
| 7 | Bloom up: `bloomLevels - 1` passes, 9-tap tent + this level weighted and tinted | `post.up[i]` | 1/2 ... | RGBA16F |
| 7 | Grade: scene + bloom, exposure, vignette, tone curve, split toning, saturation, lift, sRGB, dither (chromatic aberration if `LOOK.chroma > 0`) | `post.gradeTarget` | 1 | RGBA8 (sRGB values, luma in alpha) |
| 7 | Finish: FXAA, film grain | canvas | canvas | |

With `?ldr`, or where neither `EXT_color_buffer_half_float` nor
`EXT_color_buffer_float` exists, every RGBA16F above is RGBA8 holding
`sqrt(c / (1 + c))` per channel (see `GLSL_TARGET` in `engine/glsl.js`).

The renderer is created with `antialias: false`, no depth, no stencil, tone
mapping off and a linear output colour space: the canvas only ever receives
the finish pass, and the sRGB curve is applied by the grade pass.

### Tiers (`TIERS` in `scene/config.js`)

|  | low | medium | high |
| - | --- | ------ | ---- |
| pixel ratio cap | 1.5 | 2 | 2 |
| scene MSAA | 0 | 4 | 4 |
| mirror MSAA | 0 | 4 | 4 |
| `farScale` | 0.4 | 0.5 | 0.5 |
| `farMirrorScale` | 0.25 | 0.3 | 0.4 |
| `mirrorScale` | 0.4 | 0.5 | 0.6 |
| blur taps (disc + fill) | 12 + 6 | 16 + 8 | 24 + 10 |
| bloom levels | 5 | 6 | 7 |
| FXAA search steps | 5 | 7 | 10 |
| ripple texture | 128² | 256² | 512² |
| specks / leaves / trunks / droplets | 1500 / 2500 / 80 / 192 | 3500 / 5000 / 140 / 384 | 7000 / 9000 / 220 / 768 |
| `featherDetail` (unused so far) | 0 | 1 | 2 |

The tier is `?q=` if given, else the probe's guess (`caps.tier`): software
rasterisers low; phones medium for Apple GPUs and recent Adreno / Mali /
Xclipse, otherwise low; desktops high, except older Intel graphics medium.

Sizes on a 390 x 844 CSS-pixel phone with a device pixel ratio of 2 or more:

| | canvas = scene | far | far mirror | mirror | bloom levels |
| - | - | - | - | - | - |
| low | 585 x 1266 | 234 x 506 | 146 x 317 | 234 x 506 | 293 x 633 ... 19 x 40 |
| medium | 780 x 1688 (4x) | 390 x 844 | 234 x 506 | 390 x 844 (4x) | 390 x 844 ... 13 x 27 |
| high | 780 x 1688 (4x) | 390 x 844 | 312 x 675 | 468 x 1013 (4x) | 390 x 844 ... 7 x 14 |

### What a frame costs (medium)

Four geometry passes (far, far mirrored, subject mirrored, main), about 45
draw calls and 33,000 triangles with the placeholders, and 19 to 20
full-screen passes on small targets (2 to 3 ripple, 4 blur, 11 bloom, grade,
finish). Texture lookups per scene pixel, roughly: blur of the far layer 6
(24 taps on a quarter of the pixels), of the far mirror 2, bloom 8, grade 2,
finish 5 on flat areas and about 24 on edges, water 3 (ripple field and two
mirrors) plus eight evaluations of value noise. Low tier: about 19 lookups a
pixel on 0.74 million pixels.

### Things about the frame that are easy to break

- **The main picture must be one `renderer.render` call.** three.js resolves a
  multisampled target after every render call and then invalidates its
  samples. A second call into `post.sceneTarget` would draw over garbage.
  That is why the defocused background is a mesh in the main scene
  (`backdrop`, `renderOrder = -1000`, no depth test) and not a pass. Put
  things in `ctx.scene`; do not add render calls.
- **Order in the main scene**: backdrop (-1000), opaque things (the swan),
  water (`renderOrder` 10, transparent, no depth write), specks (20),
  droplets (30). The water covers whatever is under y = 0 because it is drawn
  after the opaque things with the depth test on.
- **The far scene is one layer.** Everything in `ctx.farScene` is drawn at
  reduced size and blurred by the same amount (`LOOK.aperture * LOOK.bokehMax`
  of the picture height). It never occludes anything in the main scene.
  Small things much brighter than white become bokeh discs; that is the
  intended way to make them. It is cleared to `LOOK.farClear`.
- **The far scene is also drawn mirrored**, with the near plane slanted into
  the water plane 3 cm below the surface: nothing under water shows in a
  reflection, and geometry does not need a clip plane of its own.
- **The mirror picture is premultiplied with alpha.** Opaque things on the
  MIRROR layer write alpha 1. Additive things there must leave alpha alone
  (`blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor`, as `Droplets.js`
  does), or the water will treat their glow as an opaque object. The water
  itself must never be on the MIRROR layer. Call `ctx.showInMirror(object)`
  after the object's children exist: layers are not inherited.
- **`uResolution` changes during the frame.** It is the size in pixels of the
  target being drawn (far, far mirror, mirror, main in turn), so that points
  sized with it keep their size in every pass.
- **Blur and bloom are linear.** They decode with `fromTarget`, filter, and
  encode with `toTarget`. A shader that reads a pipeline texture without
  `fromTarget` works in HDR and is wrong with `?ldr`.

## Materials

Make every scene material with `ctx.createMaterial({ vertexShader,
fragmentShader, uniforms, ... })` (`engine/material.js`). It is a three.js
`ShaderMaterial` in GLSL ES 3.00:

- three.js still declares `position`, `normal`, `uv`, `modelMatrix`,
  `viewMatrix`, `projectionMatrix`, `cameraPosition`, and for instanced meshes
  `instanceMatrix` and `instanceColor`. Do not declare them again.
- `GLSL_COMMON` is put in front of both stages: `hash11/12/13/22/33`,
  `valueNoise`, `fbm(p, octaves)`, `luma`, `saturateColor`, `linearToSrgb`,
  `srgbToLinear`, `toTarget`, `fromTarget`. three.js's own prefix already has
  a function called `luminance` (hence `luma`); a function of ours with the
  same name as one of its fails to compile.
- Write `in` / `out`. The fragment output is `outColor`. End with
  `outColor = toTarget(vec4(rgb, alpha));`.
- Share uniform objects by reference: `{ ...ctx.uniforms, ...ctx.light.uniforms,
  ...ctx.ripple.uniforms, uMine: { value } }`, and paste `ctx.light.glsl`,
  `ctx.ripple.glsl`, `ctx.pond.glsl` into the shader where their functions are
  needed.

Full-screen passes use `createPassMaterial(caps, { fragmentShader, uniforms,
defines })` with `FullscreenPass`; the fragment stage gets `vUv`.

## The context (`ctx`)

Built in `World.createContext`, handed to every factory.

| key | what |
| --- | ---- |
| `renderer` | the `THREE.WebGLRenderer` |
| `caps` | `{ hdr, forcedLdr, floatTargets, msaaHdr, maxSamples, maxTextureSize, gpu, software, mobile, tier }` |
| `quality` | the tier's entry of `TIERS`; assets read `quality.counts` |
| `rng` | `{ float, range, int, sign, gauss, pick, fork, seed }`; take `ctx.rng.fork('yourName')` |
| `params` | the parsed URL parameters |
| `look` | the live `LOOK` object (added to the contract: assets may not import `scene/config.js`) |
| `uniforms` | `{ uTime, uResolution }` (`uResolution` added to the contract) |
| `light` | `{ uniforms: { uSunDir, uSunColor, uSkyColor, uBounceColor, uAmbient }, setSun(azDeg, elDeg), glsl }`; the GLSL adds `sunWrap(n, wrap)`, `fillLight(n)`, `towardSun(viewDir)` |
| `pond` | `{ SHORE, SHORE_MAX_RADIUS, shoreRadius(theta), shoreTheta(x, z), shoreDistance(x, z), glsl }`; the GLSL has `shoreRadius(float)` and `shoreDistance(vec2 xz)` |
| `ripple` | the `RippleField` |
| `scene`, `farScene` | the two scenes |
| `layers` | `{ MAIN: 0, MIRROR: 2 }` |
| `events` | `on(name, fn)` (returns an unsubscribe), `off`, `emit`. Emitted so far: `'drop' { x, z, size }`, `'billEnter' { x, z }`, `'billExit' { x, z }`. `'tap'` is reserved for Interaction |
| `subject` | `Vector3`, where the swan is; copied from `SwanMind.position` every step (added to the contract; the ripple window and the water's reflection follow it) |
| `createMaterial(options)` | see above (added) |
| `showInMirror(object)` | enables the MIRROR layer on the object and all its children (added) |

`World` also has `engine`, `camera`, `rig`, `mirror`, `far`, `farMirror`,
`post`, `ripple`, `swan`, `mind`, `water`, `specks`, `forest`, `droplets`,
`director`, `interaction`, `ambience`, `tier`, `time`, `realTime`.

## Interfaces as built

Same as the contract, with these additions and one clarification.

- `RippleField(renderer, { size, extent, speed, damping, ldr })`. Also
  `reset()`, `time`, `precision` (`'float' | 'half' | 'packed'`), `size`,
  `extent`, `texel`. `uRippleRect` is (min x, min z, 1 / extent, texel size).
  `disturb(x, z, radius, strength)`: **positive strength pushes the water
  down** at the centre, by `strength` metres, with a raised ring round it so
  that no water is added; a radius under 1.5 texels is widened to that. At
  most 8 disturbances are applied per step, the rest wait. `heightAt` is an
  estimate from the last 32 disturbances replayed as ideal rings, not a
  readback. `rippleSample` uses `textureLod`, so vertex shaders may call it.
- `PlanarMirror(renderer, caps, { level, clipBias, samples })`: `camera`,
  `matrix`, `valid`, `target`, `texture`, `uniforms { uMirrorTex,
  uMirrorMatrix }`, `setSize`, `update(camera)`, `render(scene, layer)`.
  `uMirrorMatrix * vec4(world, 1)` then `.xy / .w` is where a world point is
  in the mirror picture. The placeholder water uses that for more than the
  flat mirror: it reflects the eye ray about the rippled normal, follows it a
  distance, and looks that world point up.
- `FarLayer(renderer, caps, { taps, fillTaps })`: `texture` (blurred),
  `sharpTexture`, `clearColor`, `setSize`, `render(scene, camera, radius)`.
  `createWater` receives the mirrored one as `farMirror` and reads
  `farMirror.texture` with the mirror matrix.
- `PostChain(renderer, caps, { samples, bloomLevels, fxaaSteps })`:
  `sceneTarget`, `bloomTexture`, `setLook(look, pixelRatio)`, `setSize`,
  `renderBloom()`, `render(realSeconds)`, `present(texture, { alpha })`.
- `OrbitRig`: also `offset` (where the target sits in the picture, in
  half-pictures from the centre), `limits`, `drift`. `fov` is the field of
  view of a square picture of the same *area* as the real one: a tall picture
  gets a taller, narrower angle and a wide one a wider, lower angle, which is
  what keeps the swan a sensible size on both. `World.placeCamera` sets
  `rig.offset` every frame from `CAMERA.offsetPortrait` / `offsetLandscape`
  by aspect; the Director will have to take that over if it wants its own
  framing. `enabled` is for gestures (none yet); views set from code always
  apply.
- `Engine(container, { manual, pixelRatio, maxPixelRatio, adaptive })`:
  `onUpdate(dt)`, `onRender()`, `onResize(fn)`, `onContextRestored(fn)`,
  `advance(dt, render)`, `start`, `stop`, `targetWidth`, `targetHeight`,
  `aspect`, `pixelRatio`, `renderScale`, `frameMs`, `frame`, `contextLost`.
  The live loop passes real frame time (capped at 1/15 s) to `onUpdate`;
  there is no fixed-step accumulator. Everything fixed-step goes through
  `__swan.advance`, which uses 1/60 s.
- `createUi(ctx, { root, enabled, instant })` returns `ready()` and
  `fail(message)` besides `update` and `dispose`.
- `Swan.pose` has one field so far, `dip` (0 upright, 1 bill in the water).
  The swan's owner and `SwanMind`'s owner have to agree on the real set.
- `createSwan`'s feather material is `Swan.js`'s own. Nothing else depends on
  it.

## Adaptive resolution

`Engine._adapt`. The canvas keeps its size; only the off-screen targets
shrink (steps 1, 0.85, 0.72, 0.6, 0.5) and the finish pass stretches them
back. Down after about 1.5 s of frames slower than 1/48 s. If the frame time
does not improve by 7 % after a step down, the step is undone and no further
steps down are tried (a browser capping the frame rate itself). Up after 6 s
of steady frames; if that brings slow frames back within 10 s the wait
doubles. Off with `?manual` and with `?dpr=`.

## URL parameters

| | |
| --- | --- |
| `manual` | no animation loop; frames are drawn only by `__swan.advance`, `__swan.view`, `__swan.set`, and once on resize |
| `q=low\|medium\|high` | force a tier |
| `dpr=` | force the canvas pixel ratio (and switch adaptive resolution off) |
| `seed=` | seed of all random choices (default 1) |
| `ui=0` | no overlay; the veil is removed at once |
| `az= el= dist= fov= tx= ty= tz=` | staged camera; any of them also stops the idle drift |
| `t=` | seconds of real time to simulate before the first frame |
| `time=` | time scale (default 0.4) |
| `ldr` | the 8-bit fallback, including the packed ripple simulation |
| `nopost` | the scene target straight to the screen (exposure only) |
| `only=swan,water,specks,forest,droplets` | build only these parts |
| `debug=far\|farmirror\|mirror\|bloom\|ripple` | show one buffer full screen. `mirror` marks transparent pixels with a checker. `ripple` shows the window with height in green and the slopes in red and blue, +z up |

## Console and test hooks

`window.__ready` becomes true after the first complete frame (or after a
failure to start). `window.__swan`:

- `engine`, `world`, `ctx`
- `advance(seconds, { render = true })`: fixed 1/60 s steps, then one frame
- `view({ az, el, dist, fov, target: [x, y, z], offset: [x, y] }, seconds = 0)`:
  `rig.set`
- `set('look.exposure', 1.2)`, `set('sim.timeScale', 1)`,
  `set('camera.offsetPortrait', [0, -0.1])`: any key of `LOOK`, `SIM`,
  `CAMERA`. `LOOK` and `SIM` are applied every frame (except
  `SIM.rippleExtent`, which sizes the simulation at start); `CAMERA` is read
  once at start, except the two offsets.
- `stats()`: `{ fps, frameMs, drawCalls, triangles, renderScale, tier }`,
  counted over all passes of the last frame (`fps` and `frameMs` are 0 with
  `?manual`)

Useful one-liners: `__swan.ctx.ripple.disturb(1, 1, 0.15, 0.02)`,
`__swan.world.mind.act('shake')`, `__swan.world.mind.callTo(2, 1)`,
`__swan.engine.renderer.getContext().getError()`.

## Taking a picture

Playwright must be available to Node (it is not a project dependency).

```bash
npm run dev                     # http://localhost:5180
node tools/shot.cjs --url "http://localhost:5180/?manual&q=medium&t=6" --w 390 --h 844 --dpr 2 --out swan.png
node tools/shot.cjs --url "http://localhost:5180/?manual&debug=far" --out far.png --eval "__swan.set('look.aperture', 1)"
```

Options: `--w --h --dpr --wait --mobile --eval "js"` (a returned string or
object is printed) `--resize 1280x720`. Console errors and warnings of the
page are printed. One message is filtered out: headless Chromium without a
GPU reads every WebGL canvas back to composite it and its driver reports
"GPU stall due to ReadPixels"; an empty canvas produces it too.

With `?manual` the same URL and the same `--eval` give the same file, byte
for byte.

## What was checked, and how

All in headless Chromium 153 on SwiftShader (software WebGL 2 with float
targets and 4x MSAA), dev server and production build.

- No console errors or warnings (other than the one above); `gl.getError()`
  is 0 after a frame in every tier, with `?ldr`, in each debug view, after a
  resize and after a lost and restored context.
- The mirror: six camera positions (az -70 to 180, el 1.5 to 40, dist 7 to
  30) with the ambient ripple off; the reflection meets the body at the
  waterline in each.
- The far layer: `debug=far` at aperture 0, 0.3 and 1.
- Bloom: `debug=bloom`. Dark gradients: an 8x contrast stretch of a dark
  area of the final picture, with and without grain, shows noise and no
  steps.
- Ripples: `debug=ripple` and the main view after `disturb`; drops landing
  after `act('shake')` (40 `'drop'` events); the window scrolled by 1.5 m
  and 0.75 m with a ring in it, which stayed where it was in the world.
- Determinism: two separate page loads, `advance`, a disturbance, a shake,
  `advance`: the screenshots are byte-identical.
- Resize: 390 x 844 to 1280 x 720 and back; every target takes the new size,
  the swan stays framed, and the picture after the round trip is
  byte-identical to the one before.
- A lost context (`WEBGL_lose_context`): stepping while lost does not throw;
  after restore the picture is back, with still water.
- The live loop: runs at 4 to 5 frames a second in software, and the render
  scale stepped from 1 to 0.85 without errors.
- `npm run build`, and `npm run preview` on port 4180 gives a picture
  byte-identical to the dev server's.

## What was not checked

- Real phones, Safari/WebKit, Firefox, a real GPU. Frame rates are unknown.
- Multisampled half-float targets on mobile GPUs (the probe in `caps.js`
  falls back to no MSAA if the driver refuses; that branch never ran).
- Mip generation on half-float targets on iOS (three.js's own transmission
  pass relies on the same thing).
- The `'half'` ripple precision (half-float targets but no 32-bit float
  ones): SwiftShader has both, so only `'float'` and `'packed'` ran.
- The branch of the adaptive scale that detects a browser capping the frame
  rate, and the step back up.
- `orientationchange` and `visualViewport` on a device; only viewport
  resizes were tried.
- Touch input of any kind (there is none yet).

## Known weaknesses

- With `?ldr`, additive blending and the far layer's mips work on encoded
  values: glows come out about twice as bright where they overlap dark
  things, bokeh discs dimmer, and values above about 60 clip. The 8-bit
  intermediate targets can band in very dark gradients before the final
  dither.
- Multisampling resolves linear light, so the bright rim's edge is still
  jagged after the resolve; FXAA on the graded picture is what smooths it.
  FXAA also softens single bright pixels a little (`LOOK.fxaaSubpixel`),
  which the specks pay for.
- The blur radius is a fraction of the picture height and does not follow
  the lens: zooming in does not increase the defocus by itself.
- Bokeh discs are slightly square-shouldered at large apertures (they are
  built from mip texels).
- The adaptive scale can only see frame time, not GPU load: it may sit one
  step lower than necessary for a while.
- The placeholder water's ambient ripple is finite-differenced value noise
  and aliases into horizontal streaks at grazing angles.
