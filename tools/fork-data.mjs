// tools/fork-data.mjs — apply the fork's data layer (tools/fork-overrides.mjs) to the committed data files.
//
// `npm run build-data` (tools/build-data.mjs) rebuilds every data/*.json from the official tables and preserves the fork
// layer by calling applyForkOverrides() / applyForkChoices() before writing. This CLI is the other direction: it patches
// the COMMITTED files in place, so a fork change stays a small, reviewable diff instead of a full regeneration that would
// re-encode megabytes of untouched data.
//
// Idempotent: running it twice writes the same bytes (the second run only reports that each file is up to date).
// Usage: node tools/fork-data.mjs [--check]   (--check exits 1 when a file is stale, for CI)
//
// Files written: every entry of LAYER below — data/config.json and data/choices.json today (compact JSON, exactly like
// build-data.mjs writes them).

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyForkOverrides, applyForkChoices, FORK_MODE_ID } from './fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/**
 * The fork's per-file appliers: the data file, the function that returns the patched object (or null when the file does
 * not have the shape it needs — then the file is left alone with an error), and a short description for the log.
 */
const LAYER = [
  {
    name: 'config',
    what: 'modes',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.modes || typeof json.modes !== 'object') return null;
      return applyForkOverrides(json);
    },
  },
  {
    name: 'choices',
    what: 'schedule',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.schedule || typeof json.schedule !== 'object') return null;
      return applyForkChoices(json);
    },
  },
];

let failed = false;
for (const { name, what, apply } of LAYER) {
  const file = join(ROOT, 'data', `${name}.json`);
  if (!existsSync(file)) {
    console.error(`fork-data: ${file} is missing — build the data first (node tools/build-data.mjs)`);
    failed = true;
    continue;
  }
  const before = readFileSync(file, 'utf8');
  const out = apply(JSON.parse(before));
  if (!out) {
    console.error(`fork-data: data/${name}.json has no ${what} — refusing to patch`);
    failed = true;
    continue;
  }
  const text = JSON.stringify(out);
  if (text === before) {
    console.log(`fork-data: data/${name}.json is up to date (${FORK_MODE_ID})`);
  } else if (check) {
    console.error(`fork-data: data/${name}.json is stale — run: node tools/fork-data.mjs`);
    failed = true;
  } else {
    // Atomic like build-data: a crash mid-write never leaves a truncated JSON behind.
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
    console.log(`fork-data: data/${name}.json updated (${FORK_MODE_ID}); ${text.length - before.length >= 0 ? '+' : ''}${text.length - before.length} bytes`);
  }
}
if (failed) process.exitCode = 1;
