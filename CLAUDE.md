# ai-lab

Small browser experiments, one per numbered folder (`NN-name/`), each published
to GitHub Pages by `.github/workflows/pages.yml` on every push to the default
branch.

## Standing rules

- **Keep the docs current.** Each demo has a `docs/` folder describing its
  design, what the build does (`spec.md`), how the tricky parts work
  (`techniques.md`) and what to do next (`ideas.md`). Change them in the same
  commit as the code they describe. A number in a spec that no longer matches
  the source is a bug.
- **Keep the pictures current.** After any visual change, regenerate the
  screenshots and commit them (for 01 and 02: `node tools/screenshots.cjs`,
  with the dev server running). They are staged by the script, so they should
  look good, not merely exist: if a staged camera no longer frames its
  subject well, fix the camera in the script.
- **Run the tests before pushing** (for 01: `playtest`, `soundtest`,
  `nettest` against `npm run preview`; see `01-breakwater-gp/docs/tools.md`.
  For 02: `playtest` against `npm run preview`; see
  `02-backlit-swan/docs/tools.md`). Do not rebuild `dist/` while a test is
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
