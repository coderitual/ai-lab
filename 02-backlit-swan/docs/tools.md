# Tools, tests and what has been verified

Everything in `tools/` is a development script. None of it is part of the
build, and all of it needs [Playwright](https://playwright.dev) available to
Node (it is not a project dependency).

They share one idea: the scene can be *stepped* instead of run (`?manual`,
`__swan.advance`), so a result does not depend on how fast the machine draws.
See [techniques.md](techniques.md#13-pictures-and-tests-that-do-not-depend-on-the-clock).

## Servers

```bash
npm run dev                          # http://localhost:5180   edits reload the page
npm run build && npm run preview     # http://localhost:4173   the production build
```

Tests run against the build. The screenshot tool works against either; use
the build if source files are being edited while it runs (a reload in the
middle of a picture stops it). Do not rebuild while a test is running against
the preview.

## The scripts

| script | what it does |
| --- | --- |
| `tools/playtest.cjs URL` | Drives the demo through its real input paths: mouse, touch on phone-sized viewports upright and sideways, keys, the buttons and the look panel; the film's events at their times; determinism; a turned phone, a lost WebGL context, each tier, the 8-bit fallback. 78 checks. `--only start,film,repeat,mouse,touch,sturdy`, `--list`. |
| `tools/screenshots.cjs` | Regenerates every picture in the README and these documents, and `public/og.jpg`. `--list`, `--only hero,film`, `--base URL`, `--q medium`. |
| `tools/shot.cjs` | One screenshot of any URL. `--url --out --w --h --dpr --mobile --eval "js" --resize WxH`. |

Typical session before a push:

```bash
npm run build && npm run preview &
node tools/playtest.cjs http://localhost:4173/
node tools/screenshots.cjs --base http://localhost:4173/     # if anything visible changed
```

On a machine without a GPU (software WebGL) the tests take about ten minutes
and the pictures about twenty.

## URL parameters

| | |
| --- | --- |
| `manual` | no animation loop; frames are drawn only by `__swan.advance`, `__swan.view`, `__swan.set`, and once on resize |
| `t=` | seconds to run before the first frame (with the film playing, seconds into the film) |
| `film=0` | do not open with the film |
| `still` `heading=` `pose=` | hold the swan as staged (see [swan.md](swan.md#staging-the-bird-for-a-picture)) |
| `az= el= dist= fov= tx= ty= tz=` | a staged camera, which stays on the swan |
| `q=low\|medium\|high` | force a quality tier |
| `dpr=` | force the canvas pixel ratio (and switch adaptive resolution off) |
| `seed=` | seed of all random choices (default 1) |
| `ui=0` | no controls |
| `time=` | time scale (default 1) |
| `ldr` | the 8-bit fallback for devices without float render targets |
| `nopost` | the scene target straight to the screen |
| `only=swan,water,specks,forest,droplets` | build only these parts |
| `debug=far\|farmirror\|mirror\|bloom\|ripple` | show one buffer full screen |

## In the console

`window.__swan`: `engine`, `world`, `ctx`; `advance(seconds)`; `view({ az,
el, dist, fov, target })`; `set('look.exposure', 1.2)` for any key of `LOOK`,
`SIM` or `CAMERA`; `stats()`. Useful one-liners:

```js
__swan.world.mind.act('shake')            // or 'dunk', 'reach', 'look'
__swan.world.mind.callTo(1.5, 1)          // swim there and feed
__swan.world.director.replay()            // the film again
__swan.ctx.ripple.disturb(1, 1, 0.1, 0.01) // a dent in the water
__swan.set('look.skyColor', [0, 0, 0])    // the sun's part of the light alone
```

## What has been verified

With the scripts above, in headless Chromium on software WebGL.

- **Starting**, on a desktop viewport and on phone-sized touch viewports
  upright and sideways: no console errors or warnings, no WebGL error, a
  low-key picture (most of it dark, a little of it bright), every control at
  least 40 px across and inside the picture.
- **The film**: the shake throws its spray and the drops land; the bill is
  under water at the dunk and at the reach and in the air between; the swan
  turns through about 160 degrees and comes nearer; when the film ends the
  swan and the camera are on their own; left alone for 40 s it stays in the
  sunlit water.
- **Determinism**: two loads of the same moment are the same picture, byte
  for byte.
- **Mouse and keys**: drag turns and lifts the camera, the wheel brings it
  closer and stops at the limit; a click on the water is a touch there, the
  swan swims to it, gets there and feeds with its bill under water; `S`,
  `D`, `4`, `F`; taking the camera during the film leaves the swan
  performing.
- **Touch**, upright and sideways: one finger drags, two fingers pinch
  without turning, a tap on the water calls the swan, the Shake, Reach and
  Film buttons, slow motion runs the scene at a quarter speed, the look
  panel opens inside the picture and its first slider turns the sun, Hide
  and Show.
- **Sturdiness**: turning the phone resizes the picture; a lost WebGL context
  comes back with the picture it had; the medium and high tiers and the 8-bit
  fallback draw the scene without errors.
- **The build**: `npm run build`, and the whole-site build
  (`node scripts/build-site.mjs`).

## What has not

- **Real phones, real Safari/WebKit, Firefox, a real GPU.** Only headless
  Chromium on a software rasteriser was available. The demo is written for
  iPhone Safari and Android Chrome (WebGL 2, pointer events, safe-area
  insets, half-float targets with an 8-bit fallback, audio started from a
  tap), but none of that has been seen on a device.
- **Frame rate on any device.** A frame is four scene passes and about
  twenty full-screen passes on small targets, with a costly water shader over
  most of the picture. Everything expensive scales with the tier and the
  render scale steps down when frames run long, but what a given phone
  manages is not known. Software rendering here takes about half a second a
  frame.
- **Multisampled half-float targets, and mip generation on them, on mobile
  GPUs.** A probe falls back to no multisampling if the driver refuses; that
  branch never ran.
- **Whether it sounds good.** The sound is generated and nobody has listened
  to it; the tests do not cover it at all.
- **The feel of the gestures**: coasting, pinch speed and the double-tap
  delay were chosen by reasoning, not by hand on glass.
- **Colour on a real display.** The print curve was fitted to pixel values;
  how dark the picture reads on a phone in daylight is not known.
