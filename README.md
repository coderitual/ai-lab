# ai-lab

Small experiments that run in the browser. Each one lives in its own numbered
folder and is published to GitHub Pages under the same name.

**▶ Play Breakwater GP: https://coderitual.github.io/ai-lab/01-breakwater-gp/**

All demos: https://coderitual.github.io/ai-lab/

| #  | Demo | Play |
| -- | ---- | ---- |
| 01 | [Breakwater GP](01-breakwater-gp/) — an original jet-ski slalom race on simulated waves, built with three.js. Solo, two-player split screen, or up to four players online with no server | https://coderitual.github.io/ai-lab/01-breakwater-gp/ |

## Publishing

`.github/workflows/pages.yml` runs on every push to the default branch. It
builds each `NN-name/` folder that has a `package.json` with a `build` script
and publishes its `dist/` at `https://coderitual.github.io/ai-lab/NN-name/`,
plus an index page at the site root.

One-time setup: repository **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

To add a demo, create `02-name/` whose `npm run build` writes a static site to
`dist/` using relative asset paths (for Vite: `base: './'`). Set `displayName`
and `description` in its `package.json`; they are shown on the index page.

Build the whole site locally with `node scripts/build-site.mjs` (output in
`_site/`).
