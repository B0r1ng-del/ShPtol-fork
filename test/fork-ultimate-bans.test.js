// test/fork-ultimate-bans.test.js — requirement 二.1: "此模式下所有盟约不会被禁用".
//
// The game removes bonds from play per match: server/match/pool.js drawDisabledBonds() draws `core` core bonds and
// `addon` add-on bonds out of the difficulty's table (config.bans, ABYSS = 3 + 4) and bans every 干员 whose whole bond
// list is covered by that draw plus the mode's inactiveBondIds. Removing one bond is enough to take a 干员 out of the
// shop for the whole run, so "盟约全部解锁" means: the 终极模拟 mode draws NOTHING.
//
// `config.bans` is difficulty-keyed, so the fork's mode carries its own table (`modes[mode_ultimate_abyss].bans =
// { core: 0, addon: 0 }`) and GameData.bans() prefers it. This suite pins down both halves: the counts the engine
// resolves, the draw the engine produces, and a real match's pool — plus that the official modes keep their draws.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { SharedPool, drawDisabledBonds } from '../server/match/pool.js';
import { createRng } from '../server/sim/rng.js';
import { DATA, makeMatch } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const COOP_ABYSS = 'mode_multi_abyss';
const gd = (modeId) => new GameData(DATA, modeId);

describe('二.1 — 终极模拟 draws no bond bans', () => {
  test('GameData.bans(): the mode table wins over the difficulty table, and a partial mode table means 0 for the rest', () => {
    assert.deepEqual(gd(FORK).bans('ABYSS'), { core: 0, addon: 0 });
    // the official modes are untouched: still the difficulty's table
    assert.deepEqual(gd(COOP_ABYSS).bans('ABYSS'), { core: 3, addon: 4 });
    assert.deepEqual(gd('mode_multi_hard').bans('HARD'), { core: 3, addon: 4 });
    assert.deepEqual(gd('mode_multi_funny').bans('FUNNY'), { core: 0, addon: 1 });
    assert.deepEqual(gd('mode_single_normal').bans('NORMAL'), { core: 3, addon: 4 });
    assert.deepEqual(gd('mode_training_1').bans('TRAINING'), { core: 0, addon: 0 });
    // a mode table that names only `core` must NOT inherit the difficulty's `addon` (4 for ABYSS)
    const patched = {
      ...DATA,
      config: {
        ...DATA.config,
        modes: {
          ...DATA.config.modes,
          mode_partial_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_partial_bans', bans: { core: 2 } },
          mode_empty_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_empty_bans', bans: {} },
          mode_bad_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_bad_bans', bans: 'nope' },
        },
      },
    };
    assert.deepEqual(new GameData(patched, 'mode_partial_bans').bans('ABYSS'), { core: 2, addon: 0 });
    assert.deepEqual(new GameData(patched, 'mode_empty_bans').bans('ABYSS'), { core: 0, addon: 0 });
    assert.deepEqual(new GameData(patched, 'mode_bad_bans').bans('ABYSS'), { core: 3, addon: 4 }, 'a malformed table falls back');
  });

  test('the per-match draw is empty for the fork mode, over many seeds, and never bans a 干员', () => {
    const g = gd(FORK);
    assert.equal(g.modeInactiveBonds.size, 0, 'no statically inactive bond either');
    for (let seed = 1; seed <= 40; seed++) {
      const { drawn, staticOff, banned } = drawDisabledBonds(g, createRng(seed));
      assert.deepEqual(drawn, [], `seed ${seed}: nothing drawn`);
      assert.deepEqual(staticOff, [], `seed ${seed}: nothing statically off`);
      assert.deepEqual(banned, [], `seed ${seed}: no banned 干员`);
    }
  });

  test('every 盟约 stays active and every visible 干员 stays in the shop pool', () => {
    const g = gd(FORK);
    assert.equal(g.bondIds.length, 23);
    assert.deepEqual([...g.modeInactiveBonds], []);
    const all = new Set(g.bondIds);
    for (const id of g.mode.activeBondIds) assert.ok(all.has(id), id);
    assert.equal(g.mode.activeBondIds.length, 23, 'all 23 bonds are active in the mode record');
    const pool = new SharedPool(g, { banned: [] });
    assert.equal(pool.entries.size, g.visibleChess.length, 'the whole visible roster can be rolled');
    assert.equal(pool.entries.size, 112);
  });

  test('a real 终极模拟 match opens the whole pool; an AC-4 co-op match still bans its 7 bonds', () => {
    const fork = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true });
    try {
      const m = fork.m;
      assert.equal(m.modeId, FORK);
      assert.deepEqual(m.disabledBonds, []);
      assert.deepEqual(m.staticInactiveBonds, []);
      assert.deepEqual(m.bannedChess, []);
      assert.deepEqual(m.pool.banned, []);
      assert.equal(m.pool.entries.size, m.gd.visibleChess.length);
      assert.equal(m.pool.entries.size, 112);
    } finally {
      fork.m.dispose();
    }
    const coop = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true });
    try {
      const m = coop.m;
      assert.equal(m.modeId, COOP_ABYSS);
      assert.equal(m.disabledBonds.length, 7, '3 core + 4 add-on, unchanged');
      assert.ok(m.pool.entries.size < m.gd.visibleChess.length, 'and that removes 干员 from the pool');
    } finally {
      coop.m.dispose();
    }
  });

  test('the mode advertises it (the difficulty card line) — the official modes do not', () => {
    assert.ok(gd(FORK).mode.effectDescList.some((l) => l.includes('盟约与干员全部解锁')), '终极模拟 says so');
    assert.ok(!gd(COOP_ABYSS).mode.effectDescList.some((l) => l.includes('全部解锁')), '同盟模拟 AC-4 does not');
  });
});
