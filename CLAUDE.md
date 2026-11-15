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
  screenshots and commit them (for 01: `node tools/screenshots.cjs`, with the
  dev server running). They are staged by the script, so they should look
  good, not merely exist: if a staged camera no longer frames its subject
  well, fix the camera in the script.
- **Run the tests before pushing** (for 01: `playtest`, `soundtest`,
  `nettest` against `npm run preview`; see `01-breakwater-gp/docs/tools.md`).
  Do not rebuild `dist/` while a test is running against the preview.
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
