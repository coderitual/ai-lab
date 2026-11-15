#!/usr/bin/env node
// Builds the GitHub Pages site for this repo.
//
// Every numbered demo folder at the repo root ("01-something/", "02-…") that
// has a package.json with a "build" script is built, and its dist/ is copied to
// _site/<folder>/, so each demo is served from its own sub-path:
//
//   https://<owner>.github.io/<repo>/01-something/
//
// A small index page linking to all demos is written to _site/index.html.
//
//   node scripts/build-site.mjs                 # install + build everything
//   node scripts/build-site.mjs --skip-install  # reuse existing node_modules (local use)
//
// SITE_URL (optional) is the public base URL of the site; it is handed to each
// build as VITE_SITE_URL=<SITE_URL>/<folder>/ for absolute share-preview links.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const skipInstall = process.argv.includes('--skip-install');
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/*$/, '/') : '';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titleFromFolder = (name) =>
  name
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const demos = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{2,}-/.test(e.name))
  .map((e) => e.name)
  .filter((name) => existsSync(join(root, name, 'package.json')))
  .sort();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const built = [];
for (const name of demos) {
  const dir = join(root, name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (!pkg.scripts || !pkg.scripts.build) {
    console.log(`- ${name}: no build script, skipped`);
    continue;
  }
  console.log(`\n=== ${name} ===`);
  const env = { ...process.env, VITE_SITE_URL: siteUrl ? `${siteUrl}${name}/` : '' };
  if (!skipInstall) execSync('npm ci --no-audit --no-fund', { cwd: dir, stdio: 'inherit', env });
  execSync('npm run build', { cwd: dir, stdio: 'inherit', env });
  const dist = join(dir, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${name}: build did not produce dist/index.html`);
  cpSync(dist, join(out, name), { recursive: true });
  built.push({
    name,
    number: name.match(/^\d+/)[0],
    title: pkg.displayName || titleFromFolder(name),
    description: pkg.description || '',
  });
}

if (!built.length) throw new Error('No demos were built.');

const items = built
  .map(
    (d) => `      <li>
        <a class="demo" href="./${encodeURI(d.name)}/">
          <span class="n">${escapeHtml(d.number)}</span>
          <span>
            <span class="t">${escapeHtml(d.title)}</span>
            <span class="d">${escapeHtml(d.description)}</span>
          </span>
          <span class="go" aria-hidden="true">Open →</span>
        </a>
      </li>`,
  )
  .join('\n');

const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ai-lab</title>
    <meta name="description" content="Small browser experiments." />
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f5f3ee;
        --fg: #18222c;
        --dim: #5a6673;
        --card: #ffffff;
        --line: #d8d4ca;
        --accent: #c9480f;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f161c;
          --fg: #eef2f5;
          --dim: #98a5b1;
          --card: #17212a;
          --line: #293641;
          --accent: #ff8a4c;
        }
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font: 17px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      main {
        max-width: 640px;
        margin: 0 auto;
        padding: 56px 20px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 34px;
        letter-spacing: -0.02em;
      }
      .lead {
        margin: 0 0 32px;
        color: var(--dim);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      .demo {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 16px;
        align-items: center;
        padding: 16px 18px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--card);
        color: inherit;
        text-decoration: none;
      }
      .demo:hover,
      .demo:focus-visible {
        border-color: var(--accent);
        outline: none;
      }
      .n {
        font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--dim);
      }
      .t {
        display: block;
        font-weight: 650;
      }
      .d {
        display: block;
        color: var(--dim);
        font-size: 15px;
      }
      .go {
        color: var(--accent);
        font-weight: 650;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>ai-lab</h1>
      <p class="lead">Small experiments that run in the browser.</p>
      <ol>
${items}
      </ol>
    </main>
  </body>
</html>
`;
writeFileSync(join(out, 'index.html'), index);
console.log(`\nSite ready in _site/: ${built.map((d) => d.name).join(', ')}`);
