// Runs the unit tests: every tools/unit/*.test.mjs, each in its own Node
// process, one after the other. A test file is a plain script that exits
// non-zero when something is wrong; this runner only finds them, runs them and
// says loudly which failed.
//
//   node tools/unit.mjs            all of them
//   node tools/unit.mjs track      only the files whose name contains "track"
//
// No browser, no build: these test the parts of the game that are pure
// JavaScript (the road, the car's physics).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'unit');
const filters = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
  .sort();

if (files.length === 0) {
  console.error(`unit: no test files in ${dir}${filters.length ? ` matching ${filters.join(', ')}` : ''}`);
  process.exit(1);
}

const failed = [];
for (const name of files) {
  console.log(`\n=== ${name} ===`);
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, [join(dir, name)], { stdio: 'inherit' });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const ok = run.status === 0;
  if (!ok) failed.push(name);
  const how = run.signal ? `killed by ${run.signal}` : `exit code ${run.status}`;
  console.log(`--- ${name}: ${ok ? 'passed' : `FAILED (${how})`} in ${seconds.toFixed(1)} s`);
}

if (failed.length) {
  console.error(`\nUNIT TESTS FAILED: ${failed.join(', ')} (${failed.length} of ${files.length} files)`);
  process.exit(1);
}
console.log(`\nunit: all ${files.length} test file${files.length === 1 ? '' : 's'} passed`);
