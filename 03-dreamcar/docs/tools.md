# Tools, tests and what has been verified

Everything in `tools/` is a development script; none of it is part of the
build. The browser scripts (`*.cjs` except `soundlab.cjs`) need
[Playwright](https://playwright.dev) available to Node (it is not a project
dependency); the `*.mjs` scripts need nothing but Node.

They share one idea: the run can be *stepped* instead of played (`?manual`,
`__dreamcar.skip`, `__dreamcar.advance`), and every step is the same whether
a frame was drawn or not, so a result never depends on how fast the machine
draws. See [techniques.md](techniques.md#determinism).

## Servers

```bash
npm run dev                          # http://localhost:5190   edits reload the page; also serves the sound bench (sound.html)
npm run build && npm run preview     # http://localhost:4190   the production build
```

The playtest runs against the build (it takes `$PREVIEW_URL`, default
4190); the soundtest needs the dev server (its bench is not in the build;
`$DEV_URL`, default 5190). The screenshot tool works against either: use the
build if files are being edited while it runs, because a reload in the
middle of a picture stops it. Do not rebuild `dist/` while a test is running
against the preview.

The machine all of this was developed on has no GPU: Chromium draws with
SwiftShader on four busy cores. Times below are from that machine.

## The scripts

| script | what it does | checks | time here |
| --- | --- | --- | --- |
| `node tools/unit.mjs [name]` | Runs every `tools/unit/*.test.mjs` in its own Node process. `race.test.mjs`: the clock, the start, lines and sectors, gaps, medals, the board (82 checks). `track.test.mjs`: the road is closed, smooth, invertible to a hundredth of a millimetre, has the course's numbers, kerbs, lamps and sectors (112 166 checks). `vehicle.test.mjs`: the car's numbers against the targets (0 to 100, top speed, braking, grip, key steering, no spin at full lock, rail touches, no objects made while stepping) and laps of the real road by the autopilot at three paces, a thumb, a pad, keys and a ham-fisted keyboard driver, the crest, two autopilots side by side (37 tests). `drift.test.mjs`: the feel: each device's turn-in time, the three assist levels, slides asked for, held and let go on every device, what the default level never lets happen, people's laps on the real road (7 tests). | 4 files | about 1 min |
| `node tools/handling.mjs` | The car measured the way a road test would; prints the table of spec.md. `--json`, `--no-laps`. | (a table, not checks) | 6 s |
| `node tools/trackmap.mjs out.svg` | Draws the circuit from above with its height, gradient and speed envelope, and prints its numbers (sections, structures, kerbs, dressing, lamps, sectors, pieces). `--png out.png`, `--fit a,b` (close the loop after an edit). | | under 1 s |
| `node tools/playtest.cjs [URL] [sections]` | The run-through before a push: drives the game through its real inputs (keys, a stand-in for the gamepad API, touch, the HUD's buttons) and asks the page through `__dreamcar`. Sections: title, keys, results, three, board, lines, nostorage, split, pads, touch (the fixed controls upright and on its side, 76 checks: the slider's fixed centre, a thumb landing off it steering at once, no drift of the centre after a drag, the knob springing back; power with nothing touched on auto and only from GAS on manual; BRAKE lifting the power and reversing at a standstill; DRIFT; two and three fingers at once, a finger sliding off a pedal, pointercancel, blur and orientationchange; touches elsewhere doing nothing; the arrows; the first-run names; both halves of a tablet split), slide (a handbrake turn through the keys and one through the touch slider and DRIFT, the readout, the driving help kept and applied), window, hud (the touch controls among the boxes: at least 64 px, inside the safe area with a phone's insets stood in for, drawn where Input finds them; solo again on manual), options (with Steering and Throttle on touch, kept, and with no storage), start, photo, determinism, params, tiers. Any console error, page error or WebGL warning fails that page. | about 250 | an hour or more |
| `node tools/soundtest.cjs [URL] [outDir]` | Renders scenarios offline with the game's own audio code (the dev server's `sound.html`) and measures them: partials, levels, sides, tails, jumps, gestures, mute. With `outDir` it keeps the WAV files so that someone can listen. | 62 | about 45 s idle |
| `node tools/frametest.cjs` | The tone curve's numbers (no browser); with `--url` milliseconds per frame for variants of a page (`--vary "ao=0\|ao=1"`), the pipeline's targets, and a pair of frames 1/60 s apart for a flicker check (`--pair`). | | |
| `node tools/screenshots.cjs` | Regenerates every picture of the README and these documents, and `public/og.jpg`. `--list`, `--only day,night` (page loads or picture names), `--base URL` (default 5190), `--q medium`, `--out dir`. | | 45 to 60 min |
| `node tools/shot.cjs --url URL` | One screenshot of any URL. `--out --w --h --dpr --mobile --eval "js" --resize WxH --wait`. | | 1 to 3 min |
| `tools/soundlab.cjs` | The arithmetic the soundtest is built on (spectra, levels); not run by itself. | | |

`npm test` runs the unit tests, the playtest and the soundtest one after the
other.

### The screenshot tool

`tools/screenshots.cjs` loads the page once per time of day and once per kind
of screen (five loads: day, dusk, night, split, phone) and makes several
pictures in each, because building the world takes three to five minutes on
software WebGL on a busy machine and each 1280x720 picture at `medium` two
to five more. Each
picture is a moment of an autopilot run (`?ap`, `?seed=1`, `?manual`), given
as a distance covered (`dist`, in metres from the line) or a time, and a
staging camera's pose (`photo`); with no pose it is the game's own camera
with the HUD. A staged camera rides with the car, so for those pictures the
tool shortens the game's motion-blur shutter to a fifth (`shutter`), or the
whole world would streak past (this needs the dev server, where the tool can
reach `VIEW` in config.js; against a build the game's shutter stays).
Nothing depends on the machine's speed, so the same command makes the same
pictures.

| load | pictures |
| --- | --- |
| day | `title` (the menu over the hero picture), `car-front`, `car-rear` (on the grid before Drive), `tunnel` (chase view in the bore), `sky-road` (from beside and below the deck), `carousel` (from above), `chase` (the second lap onto the straight at speed, into the sun), `og` (1200x630, `public/og.jpg`) |
| dusk | `grid-dusk`: low behind the car under the gantry while the lamps count |
| night | `night`: the end of the first lap onto the wet, lit straight |
| split | `split`: two players in the esses |
| phone | `phone`: 390x844 at 2x, touch, `medium` (what a recent iPhone gets), with the touch controls |

When a stretch of road moves or the car changes, the distances and poses in
the tool's `LOADS` table are what to adjust; then look at every picture.

## A typical session before a push

```bash
node tools/unit.mjs                       # the physics and the rules (Node, ~2 min)
node tools/handling.mjs                   # if the car, its tyres or the road changed: update spec.md
node tools/trackmap.mjs /tmp/map.svg      # if the road changed: update spec.md and design.md
npm run build && npm run preview &
node tools/playtest.cjs                   # against the build
npm run dev &
node tools/soundtest.cjs                  # if anything that sounds changed
node tools/screenshots.cjs                # if anything visible changed; look at every picture
```

## The page handle and URL parameters for testing

`window.__dreamcar` (src/main.js):

| | |
| --- | --- |
| `game`, `engine`, `times` | the objects themselves; `times` is lighting.js's `TIMES` |
| `skip(seconds)` | run the fixed step that long without drawing, then draw one frame |
| `advance(seconds, fps = 60)` | play that long, drawing every frame |
| `state()` | a plain JSON picture of the run: phase, mode, time of day, clock, lamps; per driver lap, `s`, `lat`, distance, speed, gear, rpm, pedals, laps and splits, sector, gaps, position, medal, camera, lamps, assists, the put-back offer |
| `stats()` | frame time, draw calls, triangles, programs, textures, buffer size, HUD writes, pixel ratio, render scale, the pipeline's targets, tier, `hdr`, GPU string |
| `photo({ back, right, up, yaw, pitch, fov, hud })` or `photo('d1')` | the staging camera (techniques.md); a name is one of `PHOTOS` in config.js (`d1`, `d3`, `d4`); `photo(null)` ends it |
| `set(path, value)` | change a number of lighting.js or config.js and show it: `set('times.night.exposure', 20)`, `set('camera.chase.distance', 6)` |

`window.__ready` is true once the first frame has been drawn.

The parameters tests use most: `?manual`, `?t=`, `?seed=`, `?auto` (a run at
once), `?ap` (the autopilot), `?q=low` (always test on low: the full world at
medium takes minutes to draw on software WebGL), `?nodraw`, `?time=`,
`?mode=split`, `?laps=`, `?ui=0`, `?mute`, `?photo=`, `?debug=`. All of them
are in [spec.md](spec.md#url-parameters).

## What has been verified

Only in headless Chromium on software WebGL (SwiftShader), on one Linux
machine without a GPU, and only what is listed here.

- **The road** (`tools/unit.mjs`, track): closes on itself; samples every
  metre; `frameAt` and `locate` invert each other; the surface the wheels
  read equals the profile exactly; vertical acceleration at the fastest
  possible speed at most 0.9 g; gradients, radii, banking, kerbs, lamps and
  sector lines as spec.md says. Run on 2026-11-18 at the finish lane's head:
  112 166 checks, passed.
- **The car** (`tools/unit.mjs`, vehicle; `tools/handling.mjs`): every number
  of spec.md's handling table, and clean laps of the real road by the
  autopilot at paces 1.0, 0.9 and 0.7, a thumb, a pad, keys and a ham-fisted
  keyboard driver (scripted drivers, in Node). Run for this document:
  passed.
- **The rules** (`tools/unit.mjs`, race): 82 checks, passed.
- **The sea** (`tools/unit.mjs`, sea; sea lane, 2026-11-18, round 2): the
  coast presets keep the edges and slopes of the presets they replaced (the
  carousel's and the crest's verge is now gravel); no water within 2 m
  beyond any solid edge off the decks (1.5 m over the water at the lowest),
  and every deck at least 39 m over it; open water within 90 m of the sea
  side of the sky road (10 m: under its deck), the climb, the carousel,
  the crest and the plunge (60 to 70 m: the cliff); the bay off the start
  line; the sea map; the waves deterministic. Round 2's look was judged in
  stills of `e1` at the medium tier (day, golden hour, night) beside the
  owner's frame E1, and in the chase camera every 2 s from the tunnel's exit
  to the end of the plunge on the low tier (1280x720 and 393x700).
- **The feel** (`tools/unit.mjs`, drift): 8 tests, passed (2026-11-18).
- **The game in a browser** (`tools/playtest.cjs`): a full run against the
  production build of the controls round (FEEL lane): 296 checks, 290 passed.
  Of the six failures, five came from the HUD overlap layout and one from a
  photo check left stale by the lead's new d4 moment. All six were fixed, and
  the sections they touch (hud, photo, touch, window) were re-run against a
  fresh production build: 96 of 96. The sixth failure was
  a WebGL warning after the simulated context loss in the window section
  ("delete: object does not belong to this context", 19 times); it did not
  recur in the re-run, so it is intermittent and its source is not known.
  The touch scheme and the slide readout are checked through the real
  pointer and key paths (touch 2 sizes plus split, slide).
- **The fixed touch controls** (CONTROLS lane, 2026-11-18): touch, slide,
  options, hud and start against a production build: 179 checks, 178
  passed (touch 76, slide 10, options 35, start 10, hud 47 of 48). The one
  failure, the lap banner over the car at 852x393 with the insets stood in
  for, did not recur in a re-run of hud (48 of 48) and passed in the run
  before: intermittent, the banner and the car's top are a few px apart on
  a landscape phone. `node tools/unit.mjs` passed (the scripted thumb now
  drives a linear slider, `HUMAN.thumb` range 76 px).
- **The one-thumb pad** (CONTROLS lane, round 2, 2026-11-18): touch, slide,
  options, start and split against a production build: 201 of 201 (touch
  130, slide 13, options 39, start 10, split 9); hud re-run after the last
  layout change: 100 of 100 (the pad in either hand, solo and both splits,
  auto and manual, and the slider with its pedals on manual in both splits).
  In an earlier hud run the pad overlapped the car once on 393x852 with the
  insets stood in for: the car's box was drawn 120 px lower than at the same
  place in every other run (intermittent, not explained). `node
  tools/unit.mjs` passed; drift.test.mjs now has 8 tests (the pad's lap,
  braking while turning, the red-arc and button slides, a clumsy thumb).
  Tilt is checked with synthetic deviceorientation events only.
- **The pad under the thumb and the pedal gauge** (CONTROLS lane, round 3,
  2026-11-19): touch, slide, options, hud, start and split against a
  production build: 481 of 481 (split 27 s, touch 122 s, slide 113 s, hud 178
  s, options 241 s, start 47 s). The touch section places the pad at five
  spots and four edge cases in both orientations (centre = landing point or
  the documented nudge, first input zero, no movement under a 100 px drag,
  compressed travel reaches full lock or the red, the 6 px hold, a second
  finger = handbrake, HUD buttons place nothing, both hands, both halves of a
  split); the gauge reads full on auto, brake with no throttle under the pad's
  pull, zero and zero on manual untouched, and its box is in the hud overlap
  checks. In earlier runs the hud check "nothing over the car" failed once
  with the insets stood in for (393x852, solo: the car's box 120 px low; the
  ghost and the gauge were over it): not reproduced in the lane's last run, still
  unexplained. It failed again in the lead's run of touch, hud, split, options
  and start on the merged build (468 checks, 467 passed; at s 154 the car's
  box reached 763 of 852 px down and the gauge and the ghost overlapped it):
  open. `node tools/unit.mjs` passed (the scripted thumb needed no
  change). Not verified: a real phone, Safari, real thumbs (is 60 % of the
  travel and a 6 px hold right at a real edge? does a second finger anywhere
  feel like a handbrake?), the gauge's eased bars at a real frame rate.
- **The two-player "water on the track"** (CONTROLS lane, round 2): reproduced
  at night on low in a side-by-side split of an upright phone
  (`?mode=split&time=night&t=14`, view.split wide, 393x852): the second
  half's road reads as a sheet of water, the first half's beside it does not.
  It does not depend on the order the halves are drawn in, on the wet road's
  mirror (low has none; at medium night the mirror is drawn once per view
  with that view's camera), on the cars' head lamp beams, or on which car's
  half it is: drawn from the second camera's place, the first half shows it
  too. So it follows where the camera stands, by a few metres; the likeliest
  cause is the per-eye choice of lit lamps at night (lamps.js, the world's
  lane), not fixed here (src/assets/ is another lane's).
- **The sound** (`tools/soundtest.cjs`): 62 of 62 checks (audio lane). The
  squeal "stands out at the limit" passes at exactly its 12 dB threshold.
- **The pictures**: the stills in `docs/images/` and the lanes' comparison
  stills beside the owner's reference frames (sky, environment, trees, start,
  car and look lanes) were looked at by eye on software WebGL at `medium`,
  and a few at `high`.
- **The render lane's changes** (golden dusk, board lettering, the fitted
  shadow map and narrower filter, the tighter AO, the verge's green, the
  tunnel's fittings, the massif's strata and relief, the ledge's lower bank):
  looked at by eye in stills on software WebGL at `medium`, 1280x720 for
  d1, d3 and d4 and 393x852 at device scale 2 for the chase view on the sky
  road and in the tunnel; `node tools/unit.mjs` passed (4 files). Not looked
  at on `low` or `high`, at night, or in motion; the playtest was not run.
- **The picture lane's changes** (meshes cut into pieces for culling, the
  probe's cadence and stand-in massif, the lamps' glow, skid marks, the
  ledge bend's banking 10 to 7 degrees, the grade of the three times of day):
  triangles counted per pass at phone shape on low and medium (spec.md,
  "Quality tiers and budgets"); stills on software WebGL at `medium`, 1280x720
  for d1, d3, d4 and a night chase, 393x852 at scale 2 for the sky road by day
  and the grid by night, compared by eye and with `lookstats.py` before and
  after; `node tools/unit.mjs` passed and `node tools/handling.mjs` was run
  for spec.md. Not looked at on `high`; the playtest was not run; frame times
  were not measured, only triangles and draw calls.
- **The night lane's changes** (floodlights round the lap with cones in the
  damp air, the shares texture, the mirror's streaked copy and halos, the wet
  film, the tail lamps' and the low tier's analytic streaks, the night's sky,
  moon and wetness, the canopy term, the warmer asphalt): stills on software
  WebGL at `medium`, 1280x720, at the grid, the forest of the sweep, the
  tunnel's exit and the sky road, before and after, by eye; the grid and the
  sky road at phone shape (393x700, scale 1); the grid and the forest on
  `low`; d3 and d1 by day. Triangles counted per pass at phone shape
  (spec.md). `node tools/unit.mjs` passed. Not looked at on `high`, at golden
  hour, in split screen or in motion; the playtest and the soundtest were not
  run.
- **The finish lane's changes** (one green for all grass, the lens ghosts
  kept on the sun's side, floodlights set back and raised, the draw-call
  merges and draw distances, the kerbs' and rails' retro-reflection): stills
  on software WebGL before and after, by eye, at `medium` 1280x720 by day
  (t = 6, 14, 40 of the autopilot run), at dusk (t = 6) and by night
  (t = 20, 50, 56), at 393x700 by night (t = 3, 45, 60) and at 393x852
  scale 2 on `low` by day (t = 20, 79); draw calls counted at four moments
  (spec.md); every picture of `tools/screenshots.cjs` regenerated and looked
  at (no staged camera needed moving; the phone picture is now on
  `medium`); `node tools/unit.mjs` passed (4 files). The kerbs' sparkle was
  not caught in any still (no kerb lay in the beam ahead of the car in the
  ones made); the rails' reflectors were. Not looked at on `high`, in split
  screen at night or in motion; the playtest and the soundtest were not
  run. The page raised no console error in any of these loads.
- **The day lane's changes** (a bluer day sky and a group of cumulus placed
  over the massif's shoulder, the massif darker with ribs, scree fans,
  buttresses and a back-lit rim, its saddle raised; the straight's tall
  boards in two groups with green rows behind the warm-painted low wall; a
  darker, more contrasty asphalt with a narrower glare; the D3 preset
  restaged; the green hill beyond the lake; low boards on the ledge's inside
  wall; thinner valley mist by day): four rounds of stills on software WebGL
  at `medium` 1280x720 for d1 and d3 beside the frames, d4 once at the end
  and the d1 place by night once; compositions found on `low`; draw calls and
  triangles counted with the picture lane's measure tool at phone shape
  (low by day, medium by night, t = 0, 33, 79, 100) against the head before
  the lane; `node tools/unit.mjs` passed. The golden-hour sun's clearance of
  the green hill was worked out on paper, not seen in a still (the one
  staged towards it looked into the stand). Not looked at on `high`, in
  motion, in split screen or in the chase view; the playtest, the soundtest
  and the docs' screenshots were not run.
- **The dusk lane's changes** (the twilight dome, dusk clouds lit on the
  sun's side, first stars, the horizon-coloured haze, the dusk grade, lamps
  and windows on with halos, the tail lamps' red pool on the road): chase
  stills on software WebGL at `medium` before and after, 1280x720 and
  393x700 `--mobile`, at t = 29 to 58 of the autopilot run (the approach,
  inside the tunnel, its exit and the viaduct after it) and d4, by eye; one
  round on `low`. The pool's final strength (2) was set after the last
  still (it was judged at 3, too red on the edge line). The tunnel's own
  exposure was tried at 3.6 and made no visible difference in the stills, so
  it stays 6. Not looked at on `high`, at night (the pool is on at night
  too), in motion, in split screen or over the coming sea; draw calls were
  not counted (no geometry was added); the playtest was not run.
- **The tunnel lane's changes** (the box tunnel, its portals and cuttings,
  the lamps' zones and cool white, the road's sheen and the cars' shade in the
  tunnel, the probe's cadence and reach there, no wet mirror under the roof):
  stills on software WebGL at `medium` 1280x720 by day in four rounds at six
  places of the autopilot run (t = 34.5, 36.2, 37.2, 39.4, 42.2, 43.1), put
  beside the owner's video's frames (approach, portal, near the entrance,
  deep inside) and judged by eye; by night and at golden hour at four of
  them; from a low rear three-quarter photo camera and at 393x700 inside; at
  `low` 1280x720 by day once. Draw calls and triangles counted at four
  moments before and after (`low` by day at 393x852, `medium` by night at
  1280x720: spec.md). `node tools/unit.mjs` passed (4 files). Not looked at
  on `high`, in split screen, in motion or with a player driving; the
  playtest (which has no tunnel section) and the soundtest were not run (the
  sound's tunnel reverb reads the Track's sky, which did not move).
- **The road lane's changes** (the asphalt of frames E2 and E5: its tone,
  wear, grit, paint, edge, more patches and cracks; 2026-11-19): stills on
  software WebGL at `medium` 1280x720 by day from the chase camera (t = 29,
  with and without the speed blur), from two low trackside cameras at bends
  (t = 17 and 29), on the coast road (t = 50) and at `photo=d1`; at golden
  hour and in the wet night (t = 29); at `low` 393x852 by day; each beside
  the branch point's and the references, the asphalt's sRGB measured in
  patches (sunlit about 77 to 118 luma, against E2's 100 to 145; the woods'
  shade about 56 against E2's 42; trackside about 98 to 108 against E5's 74
  to 98; the wet night's road 11 against 8 before). `node tools/unit.mjs`
  passed (5 files); the playtest's keys section 22 of 22 checks and tiers
  15 of 15 (a first tiers run was cut off by the session's time limit while
  drawing the high tier at night, and was run again alone). Not looked at on `high` beyond the playtest's frames, in
  split screen, or in motion: the grit and the paint's ragged edges were
  made not to sparkle by construction (averaged where a pixel spans many
  cells) but no frame sequence was watched for crawl.
- **No WebGL errors**: the playtest fails a page on any; the night-time
  `GL_INVALID_OPERATION` of the first frame (the mirror drawn before the
  sun's shadow map existed) was found and fixed by the look lane.

## What has not been verified

Read this before believing anything above about a device.

- **Real phones and tablets.** The only evidence from a real device is the
  owner's own screenshots from his iPhone, held upright, of an older build
  (tier `medium`, before the fixed touch controls): they show that it ran and
  how it looked then, nothing about frame rates, heat or the current build.
  Touch has only been simulated by Playwright on phone-sized viewports, with
  synthetic pointer events: no real thumb has used the pad, the slider or the
  pedals (the pad's size, place, travels, red-arc threshold and the thumb's
  22 to 50 ms follow were tuned by the scripted thumb in Node and by eye on
  stills), tilt has only been fed synthetic deviceorientation events (it is
  untested on a real phone, its iOS permission prompt has never been met, and
  the option's hint says so), `navigator.vibrate` has never buzzed anything
  (iOS has none: the guard keeps it quiet there),
  iOS Safari's own gestures (the bottom toolbar, the home bar swipe, edge
  swipes for back) have not been met, and the safe-area insets were stood in
  for by setting the HUD's variables. The controls' sizes and the thumb's
  curve are untuned by a real hand. Whether `medium` or `low` is fast
  enough on any phone, whether a phone overheats, whether the buttons are
  where a thumb is, and whether the capability probe's guesses for Apple,
  Adreno and Mali GPUs are right are all unknown.
- **Frame rates.** Every cost here is from software WebGL, where a medium
  frame of the full world takes tens of seconds to draw. No frame rate on
  any real GPU has been measured. The adaptive render scale has been seen to
  step, never on a real device.
- **The budgets.** Counted, not timed, at four moments of one autopilot
  run (spec.md): after the finish lane the low tier draws 133 to 149 calls
  by day (budget 150) and medium 228 to 291 by night (budget 300); triangles
  are still over (low 293 to 358 k against 250 k, medium up to 1.3 M against
  600 k). Other places on the lap, the high tier and split screen were not
  counted. Whether a phone draws any of it at a usable frame rate is
  unknown.
- **Browsers.** Only headless Chromium. Safari (desktop and iOS: the owner's
  iPhone screenshots aside, which say nothing about its correctness) and
  Firefox are untested, including WebGL 2 on older iOS, half-float targets, the
  multisampled half-float probe (`caps.msaaHdr`) and audio unlocking.
- **Real networks.** Every page here was loaded from a server on the same
  machine. How long the 1.3 MB script takes over a phone's connection, and
  what GitHub Pages' caching does to a returning player, have not been
  measured. (There is nothing online in the game itself.)
- **Real input devices.** No real gamepad has been plugged in (the playtest
  uses a stand-in for the Gamepad API); no real touch screen; no keyboard
  with another layout. Two players on one keyboard have only been simulated.
- **Driving in human hands.** Every lap in the tests is driven by a script:
  the autopilot, a "thumb", a "pad", "keys" and a ham-fisted keyboard
  driver. Whether the car is fun, whether the key steering feels right at
  250 km/h, whether a rail feels fair, and whether the medal times are
  reachable by a person have not been tried by anyone.
- **The sound.** Nobody has listened to it. The soundtest measures spectra
  and levels; whether the engine sounds like an engine, or good, is unknown.
- **The high tier on a real GPU.** High-tier pictures have been made only on
  software WebGL, and only a few; its costs on real hardware are unknown.
- **The look against the references.** Each lane put its stills beside the
  owner's frames and listed what still differs (ideas.md keeps those lists);
  none of them claims a match.
- **The full run of the world at the last head.** The lanes' stills were made
  in their own working copies; the merged head has been looked at only
  through this document's screenshots and the FEEL lane's sheets.
- **Context loss.** A lost and restored WebGL context was tested by the
  playtest; it left 19 "object does not belong to this context" warnings on
  the build at one point (render targets resized after the restore). Whether
  that is gone was not re-checked.
- **Long sessions.** Nobody has driven for an hour; memory over many runs,
  the board and ghost storage after many laps, and the time-of-day fade
  repeated many times are untested.
- **Wet grip.** The wet road at night is a look; the tyres do not notice it.
- **The sea** (sea lane): the waves' motion was only seen in stills (no
  frame sequence was watched for shimmer or swimming of the disc that
  follows the eye); the high tier's sea, split screen over the sea, the
  surf from close by (no camera stood on a shore) were not looked at; the
  sea's cost on a real GPU is unknown. The coast road after round 2 was
  judged at the medium tier in `e1` only and at the low tier in the chase
  camera only (the high tier there, and the bonnet and far cameras, were not
  looked at). The low crossing and its big swell were seen in one medium
  still each by day, golden hour and night and in the chase camera at
  393x700 on the low tier; `?photo=waves`'s pose was not staged; frame D1
  was checked after the far massif's change at a later moment of the run
  than its preset (its skyline unchanged).
- **Accessibility** beyond keyboard reachability of the buttons (screen
  readers, colour blindness, reduced motion) has not been considered.
