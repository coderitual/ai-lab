# The engine and the frame

How a picture of Dreamcar is made: the passes of one view, the targets they
use on each tier, the tone curve and the grade, the motion blur, the
reflections, and the rules that are easy to break when adding something. Every
number here is in the source and should be changed there first; a number here
that no longer matches the source is a bug.

## Layout

```
src/engine/            reusable; knows nothing about cars or roads
  Engine.js            renderer, canvas, fixed-step loop, manual stepping, resize, lost context, adaptive render scale
  caps.js              capability probe, tier guess, TIERS (the pipeline's numbers per tier), createTarget / resizeTarget
  params.js            URL parameters, read once (including the grade overrides used to match a picture)
  glsl.js              GLSL_COMMON (hashes, noise, luma, sRGB, toneCurve, toTarget / fromTarget), GLSL_PROBE, TONE
  FullscreenPass.js    one big triangle; createPassMaterial
  FramePipeline.js     everything from the scene target to the canvas (this document)
  ReflectionProbe.js   a cube picture round one point, a face or two a frame
  PlanarMirror.js      a flat mirror in any plane (the wet road's)
  rng.js math.js noise.js Input.js Audio.js
tools/frametest.cjs    the tone curve's numbers; frame times and frame pairs of any page (see below)
tools/shot.cjs         one screenshot of any URL
```

## One view, pass by pass

`FramePipeline.render(scene, camera, rect, view)` draws one view into a
rectangle of the canvas. Split screen calls it once per view. Before it the
game has already called `world.prepareView` for that camera, which draws the
road's mirror; the car's reflection probe is updated just before the call.

| # | pass | size | format | tiers |
| --- | --- | --- | --- | --- |
| a | road mirror (`PlanarMirror`, from `world.prepareView`) | 0.35 (medium) / 0.5 (high) of the view's height | half-float + depth renderbuffer | medium, high, and only with `caps.hdr` |
| b | reflection probe faces (`ReflectionProbe.update`, from the game) | 64 / 128 / 256 per face at speed, 128 / 256 / 512 standing still | half-float cube, mipmapped | all (`PROBE` in game/config.js) |
| 1 | **the scene**, one render call | the view x render scale | half-float, depth texture, MSAA 0 / 4 / 4 | all |
| 2 | ambient occlusion term | half | RGBA8 | medium, high; only when `look.ao > 0` |
| 3 | its blur along x, then along y | half (two passes) | RGBA8 | as 2 |
| 4 | occlusion into the picture | full | half-float | as 2 |
| 5 | motion blur | full | half-float | medium, high (low: inside pass 10) |
| 6 | bloom: halvings, the first with Karis's average | 1/2, 1/4 ... (4 / 5 / 6 levels) | half-float | all, when bloom, ghosts, glare or star asks |
| 7 | flare source (the sun) | 1 x 1 | half-float | medium, high, when ghosts or glare > 0 |
| 8 | star of the glints | 1/4 (the second level) | half-float | medium, high, when `look.star > 0` |
| 9 | bloom: back up the pyramid | 1/2 ... | half-float | as 6 |
| 10 | final: lens, bloom mix, exposure, tint, vignette, tone curve, saturation, split toning, lift, sRGB, grain, dither | the canvas rectangle | canvas (low: an RGBA8 target) | all |
| 11 | FXAA and grain | the canvas rectangle | canvas | low (no MSAA) |

"Half-float" means the 8-bit encoding of glsl.js where `caps.hdr` is false
(`?ldr` forces it). The road mirror is not made at all then.

Measured with `__dreamcar.stats().pipeline` at 960x540 on dusk, medium: scene
960x540 (4 samples), blur 960x540, AO 480x270 (two) + 960x540, bloom 480x270
down to 30x17, star 240x135; 15 full-screen passes with AO, 11 without. High
adds a sixth bloom level (15x9) and has 19 passes by day with AO, the star and
the flare source.

### The scene (1)

One render call into a multisampled target with a depth texture. three.js
resolves a multisampled target after every render call and throws the samples
away, so a second call into the same target would draw over garbage: anything
that must be in the picture is in the scene. The sky dome is drawn last
(`renderOrder` 1000) without writing depth, so a pixel whose depth is still 1
shows the sky; the AO pass relies on that.

### Ambient occlusion (2-4)

Sky-only light (dusk, and the shade by day) looks pasted on without it: the
foot of a wall, the ground under a car or a tree row, the inside of a window
reveal all get as much sky as open ground. The pass is after McGuire's Scalable
Ambient Obscurance:

- **Grid.** Half the view's size. A half-size pixel takes its distance from
  one full-size depth texel, (2i, 2j), in every pass, so the term, the blurs
  and the upsampling agree about which surface it belongs to.
- **Normal** from depth: view-space positions of the neighbours one half-size
  pixel away on each side; of the two one-sided differences the one with the
  smaller depth step is taken, so a normal at a silhouette is not tilted by the
  other surface.
- **Samples.** `aoSamples` per pixel (TIERS: 0 low, 8 medium, 14 high) on a
  spiral that winds `aoTurns` times (5, 9) inside a disc of 1.2 m
  (`AO.radius`) projected to the screen, capped at 12 % of the view's height
  (`AO.maxScreen`). Each sample counts by the cosine between the normal and
  the way to it, minus a bias that grows with distance (depth steps grow with
  it), times a falloff `1 - d²/r²`. The term is `1 - gain x mean`, gain 5.
- **Pattern.** The spiral is turned by a fixed 4x4 Bayer value per pixel. It
  is a function of the pixel position alone, so a still is the same every time
  (there is no temporal accumulation in this pipeline, nothing to converge).
- **Blur.** Separable, five taps with weights 1/2, 1, 1, 1, 1/2: exactly one
  period of the 4x4 pattern, which therefore cancels completely on an even
  surface. Each tap also counts by `exp(-(Δd / (0.06 d))²)`, so occlusion is
  not mixed across a silhouette.
- **Distance.** No occlusion where the projected radius is under 1.5 pixels,
  and it fades out between 60 and 160 m (`AO.fade`): far away it would only be
  depth noise. Sky pixels (depth 1) get exactly 1.
- **Apply** (full size): the four nearest half-size values, each by its
  bilinear share and the same distance weight. A pixel that none of them
  agrees with (a lamp post one pixel wide) is left open: thin things never
  print a dark outline. The term is faded out on pixels whose exposed light is
  over 0.9 to 3 times what the exposure calls white (`AO.emit`): lamps, lit
  windows, glints and their images in the wet road emit light and are not
  occluded. Under the car the road's mirror image of the car is dark, and is
  darkened further: that is the car's contact shadow, and it is right.
- Then the picture with the occlusion in it stands in for the scene in every
  pass that follows (blur, bloom, final).

It costs nothing when `look.ao` is 0: none of the four passes runs (the
targets exist on medium and high). It is skipped for orthographic cameras
(the viewer's blueprint views), for `?post=0` and for the other debug views.
`?debug=ao` shows the term alone (white open, black enclosed), at full strength
when the Look has none.

What it cannot do: it is screen space, so what is off screen or hidden behind
the nearest surface does not occlude; transparent things take the occlusion of
what is behind them (the car's glass, if it writes no depth, shows the cabin's
occlusion over its reflection, which reads as a darker rear screen); smoke and
spray take the occlusion of the road under them.

Cost, measured on software WebGL (SwiftShader, 4 cores shared with other
work) at 960x540, the four passes alone, median of 5: **36 ms on medium (8
samples), 45 ms on high (14 samples)**; the final pass alone is 34 / 40 ms on
the same machine, and a whole frame of the world is about 10 s there, so
whole-frame timings (`tools/frametest.cjs --vary "ao=0|ao=1"`: 10.7 s and
11.4 s at medium) are inside their noise. On a GPU expect the AO to cost about
what the final pass does.

Two frames 1/60 s apart of a moving camera (forest, t = 24) differ by the
same amount with and without AO (mean 4.19 levels in the forest, 5.2 on the
road); the term itself changes by 1.6 levels on average under the car and
0.02 on open road: no flicker of its own.

### Motion blur (5, or inside 10 on low)

From depth and two frames' matrices. For a pixel, its window position and
depth give a point in clip space; `uReproject[0]` (the last frame's
view-projection times this frame's inverse, multiplied in double precision on
the CPU so that a camera that has not moved gives exactly no movement) says
where that point was. The streak is the difference times the shutter:

    streak = (now - then) / 2 * viewSize * shutter / (time between the frames) * (1/60)

clamped to `blurLength` of the view's width (TIERS: 4 % low, 6 % medium,
7.5 % high) and averaged along with up to `blurTaps` samples (6 / 10 / 16),
jittered by interleaved gradient noise. A shorter streak gets fewer taps, about
one per two pixels. The shutter is a time (`ViewFrame.motionBlur` is a
fraction of 1/60 s), not a share of the frame, so a 30 Hz phone and a 144 Hz
monitor show the same streak.

Sharp boxes: up to four boxes (the cars) are declared with this frame's and the
last frame's matrices. A pixel inside a box is carried back by the box's own
movement, so a car that keeps its place in front of the camera has no streak
while the road under it has. A sample that belongs to another box (or to the
scenery) counts only if its own streak reaches this pixel (in front) or, for
scenery pixels, not at all (what follows a point of road across the pixel is
more road, never the car). With MSAA the nearest of a pixel and its four
neighbours decides the movement, so a car's antialiased outline moves with the
car instead of being torn off by the road's blur.

Limits: one velocity per pixel, so what is behind a moving edge is not known
(the edge of a streaked tree against the sky smears the sky a little);
transparent and additive things blur with what is behind them; the first frame
after a cut, a resize or a gap of more than 0.25 s is sharp.

Against references D1 and D3 (a simulator at speed): their nearest boards,
kerbs and grass streak about 5 to 8 % of the frame width at the lower corners,
the cars stay razor sharp. Here, at 124 km/h on the descent (t = 95, high),
the game's shutter of 0.47 gives streaks of 2 to 3 %; with `?shutter=0.9` the
rock face and the verge streak about as in D1, the car stays sharp and its
outline clean. The clamp was 4 % on every tier before; it is now 7.5 % on high
so that such a shutter is not cut short.

### Bloom (6, 9)

No threshold, nothing added: the picture is mixed with a blurred copy of
itself (`look.bloom` is the share), so what glows is whatever is much brighter
than its surroundings, in proportion. The blur is a pyramid of halvings
(13-tap filter that weighs every source texel equally, so a small light can
cross the pixel grid without its glow flickering) and of enlargements with a
3x3 tent. Each level's weight comes from three lobes whose sizes are angles
(a share of the focal length), so a lamp has the same glow in a full view, in
half a split screen and on a phone: a core (0.008, 45 %), a veil (0.075, 55 %)
and, with `look.halo`, a halo (0.025, its own share, all three then scaled
back to a total of 1). The first halving uses Karis's average above a knee
far over any lamp, so a single wild pixel cannot light a blob.

### Lens: flare source, ghosts, glare, star (7, 8, in 10)

Only on medium and high. The flare source is one pixel that sums, over the
first pyramid level no more than 48 texels wide, the light above 30 times
white: where it is and how much. Only the sun gets there. Ghosts (discs and
rings on the line from it through the middle) and the glare veil round it are
drawn in the final pass as shapes from that pixel. `look.flare` lets a sun
just outside the frame still flare if the edge of the view nearest it shows
open sky.

The star (`look.star`) is a pass at a quarter of the picture's size: each pixel
gathers what lies above 4 times white along three lines through it (six arms,
turned 15 degrees from upright, 6 % of the focal length long, fading as
`(1 - t)²`), and the final pass adds it, like the ghosts, as light the lens
moved. One extra pass of 36 taps at 240x135 for a 960x540 view.

### The final pass (10)

In this order:

1. the picture (read pixel for pixel when the view is drawn at full scale),
   motion blur here on the low tier, lateral chromatic aberration (`chroma`,
   medium and high)
2. the bloom mixed in (`bloom`), ghosts, glare and star added
3. times the exposure (`ViewFrame.exposure`, eased by the game) and `tint`
   (white balance before the curve, so white lamps stay white)
4. vignette (before the curve: it darkens as less light would)
5. the tone curve with `contrast` (below)
6. `saturation` (about luma)
7. split toning (`splitShadows`, `splitHighlights`, `splitBalance`), on display
   brightness
8. `lift` (a colour added to the darkest values, fading out toward white)
9. sRGB, grain (`grain`, in 8-bit steps, strongest in the mid-darks, changing
   with the run's own time in 1/240 s steps), dither of one 8-bit step

### The tone curve (glsl.js, `toneCurve`, `TONE`)

Per channel, x >= 0, after exposure:

    toe       x' = (g x)² / (g x + 0.012)          g = 1.1053101
    contrast  x'' = 0.18 (x' / 0.18)^k             k = look.contrast
    shoulder  y = x'' / (1 + x''^1.6)^(1/1.6)

With contrast 1: 0.18 -> 0.18, 1 -> 0.677, 4 -> 0.946, 16 -> 0.994. Before it
the colour is pulled 4 % toward its own grey and after it the same is taken
out again (as AgX does), so a pure colour keeps its hue and goes to white as it
burns out. `gain` must be worked out again if the toe or the shoulder change;
`node tools/frametest.cjs` checks it.

Is a separate shoulder control needed to hold the dusk sky near 62 % of white
while lamps reach white? Measured, no: the dusk still of the start straight
(medium, `lookstats.py --crop 0,0,960,470`) has p90 140 / p99 157 against the
reference's 146 / 157, with lamps and tail lamps white-cored. The curve is long
(it reaches 0.95 only at 4 times white), so exposure alone places the sky and
the lamps still burn out.

### Split toning

`splitShadows` and `splitHighlights` are multipliers ([1, 1, 1]: none),
normalised in the pipeline to keep brightness. On display brightness b (luma to
the power 1/2.2), the shadows' colour is in full a third of the scale below
`splitBalance` and fades out toward it; the highlights' fades in over a third
above it. The balance point itself is untouched. (Fading over the whole scale
instead was tried first: in a low-key picture, which has nothing near white,
it did next to nothing.) When both colours are grey the code is skipped.

## The Look (lighting.js, one per time of day)

Every field is optional and neutral when missing (`NEUTRAL_LOOK`).

| field | what | neutral |
| --- | --- | --- |
| `contrast` | power about middle grey inside the tone curve | 1 |
| `saturation` | about luma | 1 |
| `tint` | white balance, multiplies the light before the curve | [1, 1, 1] |
| `lift` | colour added to the darkest values | [0, 0, 0] |
| `vignette` | how much darker the corners are, 0..1 | 0 |
| `chroma` | lateral chromatic aberration, a share of the view (medium, high) | 0 |
| `grain` | film grain in 8-bit steps | 0 |
| `bloom` | share of the picture replaced by its glow | 0 |
| `halo` | extra glow of middling size (2.5 % of the focal length): lamps in damp air | 0 |
| `ghosts` | lens ghosts' share of the sun each (medium, high) | 0 |
| `glare` | the veil round the sun (medium, high) | 0 |
| `flare` | `{ dir, light, reach, sky }`: a sun that flares from just outside the frame | none |
| `star` | six-armed star on the very brightest points (medium, high) | 0 |
| `ao` | ambient occlusion strength, about 1 = full (medium, high) | 0 |
| `splitShadows` | the shadows' colour, multipliers | [1, 1, 1] |
| `splitHighlights` | the highlights' colour, multipliers | [1, 1, 1] |
| `splitBalance` | display brightness neither touches | 0.5 |

Values tried on the stills and recommended (to be set in lighting.js by its
owner):

| | day | dusk | night |
| --- | --- | --- | --- |
| `ao` | 0.8 (fades out on sunlit surfaces brighter than white anyway) | 1.0 | 0.9 |
| `star` | 0.02 (sun glints on paint and glass) | 0.015 | 0.015 |
| `halo` | 0 | 0.1 | 0.15 |
| `splitShadows` | none | [1.1, 0.98, 0.92] | none |
| `splitHighlights` | none | [0.9, 1.02, 1.15] | none |
| `splitBalance` | | 0.45 | |
| `ghosts` | 0 to 0.002 (D1 shows glare and glints, not rings) | 0 | 0 |

The dusk split toning moves the measured road from (65, 56, 69) to
(67, 56, 67) and the top of the sky a little toward blue: the reference's road
is (78, 68, 74), less blue than ours, and its sky top (150, 145, 168) more. It
is a small correction; most of the sky's difference is the sky's own colour.

The game's shutter (`VIEW.motionBlur` in game/config.js) is 0.9 at 70 m/s
and above, 0.12 at rest (eased between by the 1.5th power of the speed's
share): 0.8 to 0.9 matches references D1 and D3.

## The probe and the mirror in materials

`GLSL_PROBE` (glsl.js) is the whole convention: look the cube up with the plain
world-space direction from the probe's centre, unflipped (it is a cube render
target drawn by this renderer, which three.js does not flip), and pick the mip
level from roughness: `level = log2(1.65 r² size)`, clamped. The mips are plain
2x2 averages. What comes back is linear scene light; a material that reads it
must carry `targetDefines(caps)` so the 8-bit fallback's encoding is undone.

The probe redraws `faces` of its six faces per update, round and round; the
first update after construction or `reset()` draws all six. Its cameras skip
what the caller hides (the car itself, effects) and the shadow maps are not
drawn again for it.

The road's mirror (`PlanarMirror`) is a camera mirrored in the road's plane
under the view's car, drawn into its own small target before the view, with
the near plane slanted into the mirror plane (oblique clipping) rather than a
clip plane in every shader. Materials read it through `mirror.uniforms`
(`uMirrorTex`, `uMirrorMatrix`: world position to the mirror's picture,
`uMirrorOn`: 0 when the eye is under the plane or nothing was drawn).

## Split screen and the render scale

Split screen calls `render` once per view with that view's rectangle. One set
of targets serves every view: it is as large as the largest view of this
frame and the last (so two halves that differ by a pixel do not reallocate
twice a frame), and each view fills only the corner it needs. Every read of a
target is clamped to the view's last texel (`uTexels.zw`), so a filtered read
at a view's edge never picks up what another view left beyond it. The AO's
half-size grid is clamped the same way (`uHalf`).

The render scale (Engine.js: 1, 0.85, 0.72, 0.6, 0.5; it steps down when frames
run long and back up when they are short again) shrinks only the off-screen
targets; the final pass stretches the picture back to the canvas rectangle.
Everything that has a size in the frame (bloom lobes, AO radius, star length,
streak clamp) is an angle or a share of the view, so it looks the same at
every scale.

## How to add a pass

1. Write the fragment shader as a string. It gets `vUv` and everything in
   `GLSL_COMMON`, writes `outColor`; read targets with `fromTarget()`, write
   with `toTarget()`. Clamp reads to the view's last texel.
2. In `setTier`: make its targets with `createTarget(caps)` (or a plain RGBA8
   target for something that is not light) through `keep()`, and its material
   through `pass()`, both only if the tier wants it. Share uniform objects
   (`this._texels`, `this._viewSize`, `this._motion`) instead of copying them.
3. In `_allocate`: size its targets from the shared size.
4. In `render`: run it only when its Look field asks for it (a field at 0
   must cost nothing), count it in `this._passes`, and add its target to
   `stats()`.
5. A Look field it reads goes in the typedef with what it means and its
   neutral value, in `NEUTRAL_LOOK`, and here.
6. Add a URL override in params.js (`LOOK_NUMBERS` / `LOOK_COLOURS`) so it can
   be tried without touching lighting.js.

## Things about the frame that are easy to break

- **The scene is one render call.** A second call into the multisampled
  target draws over a resolved, discarded buffer. Anything that must be in the
  picture is in the scene; anything added later is a pass.
- **Nothing may write the scene target after it is drawn.** The AO writes a
  separate full-size target and hands that on; the blur pass's source is set
  every frame (`uColor`), because it is no longer always the scene target.
- **The sun's shadow map is drawn by the view's own render** (`scene.
  onBeforeRender` in world/index.js). The mirror and the probe turn shadow
  updates off while they draw, so they use the map left by the last view drawn;
  on the very first frame there is none yet. Do not draw a mirror or probe
  with shadow updates on: the map would be fitted to the wrong camera.
- **The flare source must stay above lamps.** It counts light over 30 times
  white; a lower floor makes every street lamp a sun with ghosts.
- **Depth 1 is the sky.** The sky dome writes no depth. The AO gives depth 1
  exactly no occlusion; something drawn at the far plane that writes depth
  would be treated as a surface.
- **Determinism.** Every pattern (blur jitter, AO rotation, dither) is a
  function of the pixel position; grain changes with the run's own time. No
  `Math.random`, no clock: `?manual&t=N` is the same picture every time.
- **No WebGL errors or warnings ever**: the playtest counts them. A uniform
  declared but set to a texture of the wrong kind, or a target read while it
  is written, shows up there.
- **Integer uniforms** (`ivec2 uHalf`, `uStep`, `uSize`) are set from
  `THREE.Vector2`; three.js sends them as integers because the shader declares
  them so.
- **The 8-bit fallback**: targets that hold light go through `toTarget` /
  `fromTarget`; the AO's term targets do not (they hold 0..1 and are RGBA8
  everywhere).

## Debugging

`?debug=` shows one buffer instead of the picture: `scene` (exposure and the
tone curve only), `depth`, `velocity` (red and green: the streak, blue: sharp
boxes), `bloom`, `probe` (the cube unrolled), `ao` (the occlusion term).

Grade overrides replace the Look's fields in every view (FramePipeline reads
them from the page's URL through params.js): `?ao=`, `?halo=`, `?star=`,
`?contrast=`, `?saturation=`, `?bloom=`, `?vignette=`, `?grain=`,
`?tint=r,g,b`, `?lift=r,g,b`, `?splitlo=r,g,b`, `?splithi=r,g,b`,
`?splitbal=`, and `?ev=` (stops on top of the game's exposure), `?shutter=`
(in place of the game's).

`node tools/frametest.cjs --url URL --frames 4 --vary "ao=0|ao=1" --pair out.png`
prints milliseconds per frame for each variant (a pixel is read back after
each frame so the GPU's work is counted), the pipeline's targets, and saves two
frames 1/60 s apart for a flicker check.

## Not verified

Everything above was made and measured in headless Chromium on software WebGL
(SwiftShader), at 960x540 and smaller. Real GPUs, phones, Safari, real frame
rates and the cost of these passes on a GPU are untested. The AO's look was
judged on the start straight, the forest and the descent of this working copy,
which had no town yet: walls, window reveals and canopies are untested.
