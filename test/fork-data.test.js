// test/fork-data.test.js — the fork's data layer (tools/fork-overrides.mjs) against the committed data/config.json.
//
// `data/config.json` is a build product of tools/build-data.mjs, which now calls applyForkOverrides() before writing.
// `node tools/fork-data.mjs` applies the same function to the committed file in place (the small reviewable diff).
//
// The first test is the drift guard and the reason the override is written as a pure, idempotent function:
// applyForkOverrides(committed config) must return the committed config EXACTLY. It fails when
//   * `data/config.json` is regenerated without the override (or hand-edited),
//   * the fork record in `data/config.json` no longer matches what the override builds, or
//   * someone edits data/config.json instead of tools/fork-overrides.mjs.
// The rest pin down what the fork's mode actually is, so a later change to it is a deliberate one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyForkOverrides, forkUltimateMode, FORK_MODE_ID, FORK_BASE_MODE_ID } from '../tools/fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readConfig = () => JSON.parse(readFileSync(join(ROOT, 'data', 'config.json'), 'utf8'));

describe('fork data layer (tools/fork-overrides.mjs ⇄ data/config.json)', () => {
  const config = readConfig();

  test('data/config.json already carries every fork override (idempotence drift guard)', () => {
    assert.deepEqual(
      applyForkOverrides(config),
      config,
      'data/config.json is stale — run: node tools/fork-data.mjs',
    );
  });

  test('applyForkOverrides is pure: the input config is never mutated', () => {
    const before = JSON.stringify(config);
    const out = applyForkOverrides(config);
    assert.equal(JSON.stringify(config), before, 'the input is untouched');
    assert.notEqual(out, config, 'a new object is returned');
    assert.deepEqual(applyForkOverrides(out), out, 'idempotent');
    assert.notEqual(applyForkOverrides(out), out, 'idempotent, and still a fresh object');
  });

  test('a partial data set is a no-op, never a throw', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { modes: null }, { modes: [] }, { modes: {} }]) {
      assert.doesNotThrow(() => applyForkOverrides(bad));
    }
    assert.equal(applyForkOverrides(null), null);
    const noBase = { modes: { mode_multi_hard: { modeId: 'mode_multi_hard' } } };
    assert.equal(applyForkOverrides(noBase), noBase, 'without the base mode there is nothing to build from');
    assert.equal(forkUltimateMode(noBase.modes), null);
  });

  test('mode_ultimate_abyss exists as the AC-4 co-op room, derived from mode_multi_abyss', () => {
    const m = config.modes[FORK_MODE_ID];
    const base = config.modes[FORK_BASE_MODE_ID];
    assert.ok(m, `${FORK_MODE_ID} missing from data/config.json`);
    assert.ok(base, `${FORK_BASE_MODE_ID} missing`);
    assert.equal(m.modeId, FORK_MODE_ID);
    assert.equal(m.name, '终极模拟');
    assert.equal(m.code, 'AC-4');
    assert.equal(m.difficulty, 'ABYSS');
    assert.equal(m.type, 'MULTI', 'a multiplayer room: every `type` reader must treat it like 同盟模拟');
    assert.equal(m.inScope, true);
    assert.notEqual(m.sortId, base.sortId, 'its own slot in the mode list');
  });

  test('the fork room starts from the AC-4 table and shares no object with the base mode', () => {
    const m = config.modes[FORK_MODE_ID];
    const base = config.modes[FORK_BASE_MODE_ID];
    for (const key of ['rounds', 'enemyScale', 'spRounds', 'shopSlots', 'upgradePrices', 'maxShopLevel',
      'stages', 'bossWeights', 'hiddenBossWeights', 'activeBondIds', 'inactiveBondIds', 'inactiveEnemyKeys',
      'lastRound', 'bossRound', 'hiddenRound', 'combatTimeLimit', 'bossHpScale', 'levelTagColors']) {
      assert.deepEqual(m[key], base[key], `${FORK_MODE_ID}.${key} still mirrors ${FORK_BASE_MODE_ID}`);
      // structured values must not be shared: a later fork change to one mode may never reach the other
      if (m[key] !== null && typeof m[key] === 'object') {
        assert.notEqual(m[key], base[key], `${FORK_MODE_ID}.${key} is its own copy`);
      }
    }
  });
});
