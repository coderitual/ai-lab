# ai-lab

Small browser experiments, one per numbered folder (`NN-name/`), each published
to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

## Standing rules

- **Keep the docs current.** Each demo has a `docs/` folder describing its
  design, what the build does (`spec.md`), how the tricky parts work
  (`techniques.md`) and what to do next (`ideas.md`). Change them in the same
  commit as the code they describe. A number in a spec that no longer matches
  the source is a bug.
- **Keep the pictures current.** After any visual change, regenerate the
  screenshots and commit them (for 01, 02 and 03: `node tools/screenshots.cjs`,
  with the dev server running). They are staged by the script, so they should
  look good, not merely exist: if a staged camera no longer frames its
  subject well, fix the camera in the script.
- **Run the tests before pushing** (for 01: `playtest`, `soundtest`,
  `nettest` against `npm run preview`; see `01-breakwater-gp/docs/tools.md`.
  For 02: `playtest` against `npm run preview`; see
  `02-backlit-swan/docs/tools.md`. For 03: `node tools/unit.mjs`, then
  `playtest` and `soundtest` against `npm run preview`; see
  `03-dreamcar/docs/tools.md`). Do not rebuild `dist/` while a test is
  running against the preview.
- **Say what was not verified.** These demos are developed in headless
  Chromium on software WebGL. Real phones, Safari, device frame rates and real
  networks are untested unless someone says otherwise; keep that list honest
  in `docs/tools.md`.

## 01-breakwater-gp

- Everything is generated in code: no model, texture or audio files. Keep it
  that way.
- It is an original game. Other games may be looked at for what quality looks
  like, never copied (names, characters, courses, art, HUD).
- The sea is defined once (`src/engine/waves.js`) and used by both the shaders
  and the physics. Never give one of them its own copy.
- Hull dimensions live in two places that must agree: the model
  (`src/assets/boat/lines.js`) and what the physics and effects assume
  (`HULL` in `src/game/config.js`).
- Layers: `engine/` knows nothing about this game; `assets/` builds what is
  visible; `game/` is the race; `net/` is online play.
- Dev scripts in `tools/` need Playwright available to Node (not a project
  dependency) and step the game deterministically (`?manual`).
- Anything that changes the state of the game (how wet a camera's lens is, for
  example) belongs in the fixed step, not in the per-picture render: tests and
  pictures fast-forward without drawing, and must find the same game.
- The land's height function (`heightAt` in `src/assets/island.js`) is what
  boats run aground on. Up to the back of the beach it is part of the course;
  above that it is scenery and can be reshaped freely.
- A team is `{ hull, accent, mark, pattern }` (`src/assets/palette.js`): each
  boat is painted to its own design. Keep them tellable apart from any side.
- Rock, sea stacks and the thicket are all cut by one function
  (`src/assets/rocks.js`) and painted from one set of tones. On the islands
  they stand only on ground no boat can reach; a rock a boat could touch
  needs a collider (`colliders` in `src/game/World.js`), as the sea stacks
  have.

## 02-backlit-swan

- It recreates a piece of film from measurements. `docs/design.md` holds the
  measurements and is the target; when the build and the design disagree,
  decide which is wrong and fix that one.
- Everything is generated in code: no model, texture, font or audio files,
  and nothing fetched at run time. Keep it that way. Nothing from the
  reference recording itself (its caption, names, interface) is reproduced.
- Defined once, never copied: the light (`src/assets/lighting.js`, including
  where the wood's shadow falls), the ripple field
  (`src/engine/RippleField.js`, read by the water and by everything that
  floats), the pond's outline (`src/assets/pond.js`), the swan's dimensions
  (`src/assets/swan/anatomy.js`, read by the meshes, the animation and the
  shader's stand-in for the bird), and the numbers of the look
  (`src/scene/config.js`).
- The scene is lit almost neutrally; the teal, olive and cream of the picture
  come from `printCurve` in `src/engine/PostChain.js`, fitted to the film. Do
  not compensate for it with odd colours in a shader: judge colour in the
  finished picture.
- Layers: `engine/` knows nothing about swans or ponds; `assets/` builds what
  is visible; `scene/` is the show (behaviour, camera, interaction); `ui/`;
  `audio/`.
- No `Math.random` and no clock in `src/` outside the engine's loop and
  gesture handling: random numbers come from `ctx.rng.fork('name')`, so that
  `?manual&t=…` is the same picture every time. The tests and the screenshot
  tool depend on it.
- The main picture must be one render call into the multisampled scene
  target (see `docs/engine.md`, "Things about the frame that are easy to
  break").
- Dev scripts in `tools/` need Playwright available to Node (not a project
  dependency).

## 03-dreamcar

- Everything is generated in code: no model, texture, font or audio files,
  and nothing fetched at run time. Keep it that way.
- It is an original demo. The owner's reference frames (kept out of the
  repository; described in `docs/design.md`, "The look") set the look and
  feel: a sunlit day with the sun's glare, the night after rain, and above all
  a wet dusk. Nothing of any game's content is copied: no names, logos, HUD
  artwork, track shapes or scenery. When the light, the materials or the
  grade change, stage the comparison stills again and judge them beside the
  references.
- The car is a model of a real one, made from photographs: the star is its
  only emblem and there is no brand lettering anywhere. Its number plate text
  is a parameter (`?plate=`).
- Defined once, never copied: the car's dimensions
  (`src/assets/car/spec.js`: read by the meshes, the physics, the cameras and
  the lamps), the road and its corridor (the `Track` built by
  `src/game/track.js` from `src/game/trackLayout.js`: read by the physics, by
  everything the world builds along the road, and by the HUD's map), the
  light of each time of day (`src/assets/world/lighting.js`: sky, fog, lamps,
  wetness, the car's lamps, exposure and the grade all read its tables), and
  the numbers of the run (`src/game/config.js`).
- Layers: `engine/` knows nothing about cars or roads; `assets/` builds what
  is visible and may import `engine/`, never `game/`; `game/` is the run
  (physics, rules, cameras, HUD, sound, flow).
- No `Math.random` and no clock in `src/` outside the engine's loop and raw
  gesture handling: random numbers come from `rng.fork('name')`. Anything
  that changes the state of the run belongs in the fixed step (1/120 s), not
  in the per-picture render: tests and pictures fast-forward without drawing
  and must find the same run, and `?manual&t=…` must be the same picture
  every time.
- The times of day are whatever `TIMES` in `lighting.js` holds, in that
  order (day, dusk, night; the demo opens on the first). Code iterates over them
  and never assumes how many there are. Best laps, the board and the ghost are
  kept per time of day.
- The scene is one render call per view into the multisampled HDR target;
  exposure, the tone curve and the sRGB curve are the last pass's (see
  `docs/engine.md`, "Things about the frame that are easy to break"). Lamps
  and the sky are bright in real ratios; judge colour in the finished picture.
- The number of lights in the scene is fixed: lamps are switched by
  intensity, not by `visible`, so that no shader is recompiled mid-run.
- The corridor's solid edges (`edgeL`, `edgeR` of the `Track`) are what cars
  hit. Scenery stands at or beyond them; whatever is inside them is part of
  the course and must be exactly `track.profile()`.
- The physics is pure JavaScript and is tested in Node (`node tools/unit.mjs`;
  `node tools/handling.mjs` prints the car's numbers for `docs/spec.md`).
  After changing the car, its tyres or the road, run both and update the
  spec.
- Every pass and every effect has a quality tier (`low`, `medium`, `high`);
  software WebGL and unknown phones start `low`. Nothing may require float
  render targets without the fallback `caps` chooses.
- Dev scripts in `tools/` need Playwright available to Node (not a project
  dependency). The whole world takes a minute or two to start and to draw on
  software WebGL at full quality: stage stills with `?manual`, test with
  `?q=low`.
