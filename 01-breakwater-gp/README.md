# Breakwater GP

A small, original jet-ski slalom racing demo for the browser, built with
[three.js](https://threejs.org). One island circuit, three laps, three bots,
a simulated sea that the crafts genuinely ride on. Everything you see is
generated in code: there are no model, texture or audio files.

It runs on desktop (keyboard) and on phones (touch), and is written for iPhone Safari.

**▶ Play it: https://coderitual.github.io/ai-lab/01-breakwater-gp/**

![Mid-air over a swell on the home stretch](public/og.jpg)
![Phone layout with thumb controls](docs/race-phone.jpg)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — also served on your LAN, so you can open it from a phone
npm run build      # static site in dist/  (relative paths: host it anywhere)
npm run preview    # serve the production build
```

## How to play

Three ways to race, chosen on the title screen:

- **Solo**: you against three bots.
- **Two players, split screen**: two riders on one keyboard, each with their
  own half of the screen, plus two bots. Player 1 uses `W` `A` `S` `D`,
  player 2 the arrow keys.
- **Two players, online**: see [Online play](#online-play) below.

Solo controls:

|            | Keyboard            | Phone                                   |
| ---------- | ------------------- | --------------------------------------- |
| Steer      | `←` `→` (or `A` `D`) | left thumb: press and drag sideways     |
| Throttle   | `↑` (or `W`)         | automatic                               |
| Brake      | `↓` / `S` / `Space`  | right thumb: hold                       |
| Start      | `Enter` or the button | tap the button                         |
| Sound      | `M` or the link on the panels | the link on the panels         |

The slalom marks follow real lateral marks:

- **Red can** (flat top): ride past on its **right**.
- **Green cone** (pointed top): ride past on its **left**.

Each clean pass adds one level of **power** (up to five) and with it top speed.
A miss drops power to zero and counts toward five allowed misses; the fifth
puts you out. Stay inside the orange floats: after five seconds outside you are
put back on course without power.

The sea is rough on the open-ocean side of the island and calmer in its lee.
Hitting the swell head-on at speed throws the craft into the air; you cannot
steer or drive in the air, and a hard landing costs speed.

## How it is put together

```
src/
  assets/     everything visible, generated with three.js
    palette.js      colour script + sun direction + team colours
    textures.js     tileable noise / ripple / label textures (CPU generated)
    sky.js          sky dome shader, shared sky-fog GLSL, PMREM environment
    water.js        ocean mesh (radial grid) + shader (scattering, foam trails, glitter)
    watercraft.js   lofted hull + trim            rider.js   IK-posed rider
    buoys.js        slalom marks, course floats, start arch
    island.js       analytic low-poly islands     scenery.js palms, rocks, lighthouse, pier, sailboats
    geo.js          modelling helpers (loft, merge, facet, two-bone IK)
  engine/     reusable runtime
    Engine.js       renderer, resize, fixed-timestep loop + interpolation, adaptive resolution
    waves.js        THE sea: one Gerstner wave set used by both the shaders and the physics
    ChaseCamera.js  chase / orbit camera        Input.js   keyboard + multi-touch
    Audio.js        synthesised engine, water and cues (Web Audio)
  game/       this particular game
    track.js        centre line, marks, racing line, grid
    World.js        builds the location from the assets, floats the props
    Craft.js        watercraft physics          drivers.js player + bot drivers
    Race.js         rules: marks, power, misses, laps, ranking, respawn
    effects.js      wake field (render-to-texture foam + shadows), spray particles
    Hud.js / hud.css   DOM HUD, minimap, panels
    Game.js         wires it all together
tools/        optional dev scripts (need Playwright): screenshots, frame-stepped capture, input smoke test
```

A few choices worth knowing about:

- **One sea, two consumers.** `engine/waves.js` defines six trochoidal waves and
  an amplitude field (calm near shores and behind the island). The same
  numbers feed the GLSL (vertex displacement, per-pixel analytic normals) and
  `sampleSurface()` on the CPU (buoyancy, pitch/roll, floating props, camera
  clearance). What you see is what the physics rides. A second tier of short,
  steep chop (under 10 cm high) is drawn by the GPU only: it sharpens the
  surface without touching the handling.
- **Water shading** (`assets/water.js`): a deep-blue body that lightens with
  wave height; sunlight scattering through thin crests and through faces
  turned toward the viewer (the turquoise glow); foam that is laid where the
  swell bunches up and then lingers behind the moving crest, drawn as lacy
  threads over a veil of aerated water; and sun glitter from a normal-map
  lookup held at constant size on screen, so facets sparkle near and far.
- **Craft physics** (`game/Craft.js`) is a one-sided buoyancy spring — water
  pushes up, only gravity pulls down — so jumps fall out of the simulation
  instead of being scripted. Wave faces push the hull downhill, grip and
  thrust fade as the hull leaves the water, and the hull's attitude is fitted
  to four samples of the surface.
- **Fixed 120 Hz simulation, interpolated rendering.** Handling is identical at
  30, 60 or 120 fps.
- **Wake field.** Wakes, hull wash, splash rings and soft craft shadows are drawn
  top-down into a small texture each frame and sampled by the ocean shader, so
  foam lies in the water surface and drifts with it. No geometry floating on top.
- **Cheap to draw.** Static scenery is merged and vertex-coloured, floats are
  instanced, there are no shadow maps or post-processing: about 100 draw calls
  and 170k triangles per frame.

## Phones

- Canvas pixel ratio is capped at 2 and steps down (at most twice) if the device
  cannot hold about 45 fps.
- Touch input uses Pointer Events with `touch-action: none`; scrolling, pinch
  zoom, double-tap zoom, text selection and long-press callouts are suppressed
  on the game surface. HUD padding respects the safe-area insets.
- Works in both orientations (landscape recommended); the lens widens in portrait.
- Audio starts on the Start tap, as iOS requires, and obeys the ring/silent switch.
- Needs WebGL 2 (iOS 15+).

## Dev tools

These are not part of the build and need Playwright available to Node.

```bash
node tools/shot.cjs --url "http://localhost:5173/viewer.html?asset=craft" --out craft.png   # asset viewer shots
node tools/capture.cjs --url "http://localhost:4173/?auto&ap&manual&dpr=1" --at 9,24,41 --out shots/lap   # stills
node tools/capture.cjs --url "…" --from 46 --seconds 10 --fps 30 --out clip/f                # frames for ffmpeg
node tools/playtest.cjs http://localhost:4173/                                                # input smoke test
```

Useful query options: `?auto` (skip the title), `?ap` (a bot rides your craft),
`?laps=1`, `?dpr=1`, `?sea=0.8` (wave height), `?manual` (step with
`__bw.advance(seconds)` / `__bw.skip(seconds)`).

`viewer.html?asset=sea|craft|crafts|world&az=…&el=…&dist=…` shows single assets
over the real sea and sky.

## What was (and was not) verified

Checked with the scripts in `tools/` in headless Chromium (software WebGL):
a full three-lap bot race, the keyboard path, the touch path on iPhone-sized
viewports in both orientations (drag steering, two-thumb braking, panels fit),
the rules (clean pass, miss, off-course reset, five misses and out), results
and restart, a lost and restored WebGL context, and the production build.

Not checked: real Safari/WebKit and real phone hardware (only Chromium was
available), frame rate on a device, and how the synthesised audio sounds.
