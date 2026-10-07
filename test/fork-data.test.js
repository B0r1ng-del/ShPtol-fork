// test/fork-data.test.js — the fork's data layer (tools/fork-overrides.mjs) against the committed data files.
//
// `data/config.json` and `data/choices.json` are build products of tools/build-data.mjs, which now calls
// applyForkOverrides() / applyForkChoices() before writing. `node tools/fork-data.mjs` applies the same functions to the
// committed files in place (the small reviewable diff).
//
// The first test is the drift guard and the reason the override is written as a pure, idempotent function:
// applyForkOverrides(committed config) must return the committed config EXACTLY (same for the choices schedule). It
// fails when
//   * a data file is regenerated without the override (or hand-edited),
//   * the fork record in it no longer matches what the override builds, or
//   * someone edits the data file instead of tools/fork-overrides.mjs.
// The rest pin down what the fork's mode actually is, so a later change to it is a deliberate one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyForkOverrides, forkUltimateMode, applyForkChoices, FORK_MODE_ID, FORK_BASE_MODE_ID } from '../tools/fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(readFileSync(join(ROOT, 'data', `${name}.json`), 'utf8'));
const readConfig = () => readJson('config');

describe('fork data layer (tools/fork-overrides.mjs ⇄ data/)', () => {
  const config = readConfig();
  const choices = readJson('choices');

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
    // fields the fork has NOT (yet) changed: they must still mirror AC-4 exactly, and be their own copies. A fork
    // change moves its field OUT of this list into its own assertion below (二.1: bans; 二.2: shopSlots; …).
    for (const key of ['rounds', 'enemyScale', 'spRounds', 'upgradePrices', 'maxShopLevel',
      'stages', 'bossWeights', 'hiddenBossWeights', 'activeBondIds', 'inactiveBondIds', 'inactiveEnemyKeys',
      'lastRound', 'bossRound', 'hiddenRound', 'combatTimeLimit', 'bossHpScale', 'levelTagColors']) {
      assert.deepEqual(m[key], base[key], `${FORK_MODE_ID}.${key} still mirrors ${FORK_BASE_MODE_ID}`);
      // structured values must not be shared: a later fork change to one mode may never reach the other
      if (m[key] !== null && typeof m[key] === 'object') {
        assert.notEqual(m[key], base[key], `${FORK_MODE_ID}.${key} is its own copy`);
      }
    }
  });

  test('二.1: the fork mode carries its own bond-ban table and advertises the unlocked roster', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.bans, { core: 0, addon: 0 }, 'no per-match bond draw in 终极模拟');
    assert.equal(config.modes[FORK_BASE_MODE_ID].bans, undefined, 'the official AC-4 record stays difficulty-keyed');
    assert.deepEqual(config.bans.ABYSS, { core: 3, addon: 4 }, 'and the ABYSS difficulty table is untouched');
    assert.equal(m.inactiveBondIds.length, 0);
    assert.equal(m.activeBondIds.length, 23, 'every 盟约 stays active');
    assert.ok(m.effectDescList.some((l) => l.includes('盟约与干员全部解锁')), 'the card says so');
    assert.deepEqual(
      config.modes[FORK_BASE_MODE_ID].effectDescList,
      ['·作战环境无比困难', '·出现极度危险的敌人'],
      'the official AC-4 card does not change',
    );
  });

  test('二.2: the fork mode carries the shop-slot table (one 干员槽 per level, the last upgrade a 道具槽)', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.shopSlots, {
      1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 5, item: 1 },
      4: { chess: 6, item: 1 }, 5: { chess: 7, item: 1 }, 6: { chess: 7, item: 2 },
    });
    assert.deepEqual(config.modes[FORK_BASE_MODE_ID].shopSlots, {
      1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 },
      4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 },
    }, 'the official AC-4 table stays as it was');
    assert.deepEqual(m.upgradePrices, [5, 8, 11, 12, 13], 'the upgrade prices are the AC-4 ones');
    assert.equal(m.maxShopLevel, 6);
  });

  test('二.3: the fork mode carries the enemy adjustment block, and only the fork mode', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.enemyAdjust, {
      fromRound: 4,
      normal: { hp: 1.1 },
      leader: { hp: 1.2, def: 1.2, atk: 1.08 },
      hidden: { hp: 1.35, def: 1.35, atk: 1.16 },
    });
    assert.equal(config.modes[FORK_BASE_MODE_ID].enemyAdjust, undefined, 'the official AC-4 record has none');
    for (const [id, mode] of Object.entries(config.modes)) {
      if (id === FORK_MODE_ID) continue;
      assert.equal(mode.enemyAdjust, undefined, `${id} must not carry a fork adjustment`);
    }
    // the official per-round table itself is untouched by 二.3 (the extras sit beside it, they do not rewrite it)
    assert.deepEqual(m.enemyScale, config.modes[FORK_BASE_MODE_ID].enemyScale);
    assert.ok(m.effectDescList.some((l) => l.includes('第 4 回合起敌人强度提升')), 'the card says so');
  });

  test('二.4: the fork mode carries the 机变 rules, and only the fork mode', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.spDraft, { untimed: true, parallel: true, randomVote: { families: ['supply', 'shop', 'tactic'] } });
    for (const [id, mode] of Object.entries(config.modes)) {
      if (id === FORK_MODE_ID) continue;
      assert.equal(mode.spDraft, undefined, `${id} must not carry a fork 机变 block`);
    }
    assert.ok(!m.spDraft.randomVote.families.includes('bounty'), '悬赏类不要添加随机机制');
  });

  test('二.4: data/choices.json already carries the fork schedule (the same drift guard as config.json)', () => {
    assert.deepEqual(applyForkChoices(choices), choices, 'data/choices.json is stale — run: node tools/fork-data.mjs');
    const fork = choices.schedule[FORK_MODE_ID];
    const base = choices.schedule[FORK_BASE_MODE_ID];
    assert.ok(fork, `${FORK_MODE_ID} has no 机变 schedule (the mode would fall back to a 道具补给 draft every round)`);
    assert.deepEqual(fork, base, 'the schedule is the AC-4 one');
    assert.notEqual(fork, base, 'and its own copy');
    for (const r of [3, 9, 11]) {
      assert.deepEqual(fork.rounds[String(r)].families, base.rounds[String(r)].families, `R${r} families`);
    }
    assert.equal(fork.rounds['3'].families[0].family, 'bounty', 'AC-4 R3 is 悬赏决策 — the fork keeps that');
    assert.equal(applyForkChoices(null), null);
    assert.deepEqual(applyForkChoices({}), {});
    const noBase = { schedule: { mode_multi_hard: { rounds: {} } } };
    assert.equal(applyForkChoices(noBase), noBase, 'without the base schedule there is nothing to copy');
  });
});
