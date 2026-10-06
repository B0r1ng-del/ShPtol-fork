// tools/fork-data.mjs — apply the fork's data layer (tools/fork-overrides.mjs) to the committed data files.
//
// `npm run build-data` (tools/build-data.mjs) rebuilds every data/*.json from the official tables and preserves the fork
// layer by calling applyForkOverrides() before writing. This CLI is the other direction: it patches the COMMITTED
// data/config.json in place, so a fork change stays a small, reviewable diff instead of a full regeneration that would
// re-encode megabytes of untouched data.
//
// Idempotent: running it twice writes the same bytes (the second run only reports that the file is up to date).
// Usage: node tools/fork-data.mjs [--check]   (--check exits 1 when the file is stale, for CI)
//
// Files written: data/config.json (compact JSON, exactly like build-data.mjs writes it).

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyForkOverrides, FORK_MODE_ID } from './fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'config.json');
const check = process.argv.includes('--check');

if (!existsSync(FILE)) {
  console.error(`fork-data: ${FILE} is missing — build the data first (node tools/build-data.mjs)`);
  process.exitCode = 1;
} else {
  const before = readFileSync(FILE, 'utf8');
  const config = JSON.parse(before);
  if (!config.modes || typeof config.modes !== 'object') {
    console.error('fork-data: data/config.json has no modes — refusing to patch');
    process.exitCode = 1;
  } else {
    const text = JSON.stringify(applyForkOverrides(config));
    if (text === before) {
      console.log(`fork-data: data/config.json is up to date (${FORK_MODE_ID})`);
    } else if (check) {
      console.error('fork-data: data/config.json is stale — run: node tools/fork-data.mjs');
      process.exitCode = 1;
    } else {
      // Atomic like build-data: a crash mid-write never leaves a truncated config.json behind.
      const tmp = `${FILE}.tmp-${process.pid}`;
      writeFileSync(tmp, text);
      renameSync(tmp, FILE);
      console.log(`fork-data: data/config.json updated (${FORK_MODE_ID}); +${text.length - before.length} bytes`);
    }
  }
}
