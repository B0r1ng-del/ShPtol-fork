// test/fork-ultimate-shop.test.js — requirement 二.2: the 终极模拟 shop-slot table.
//
//   level 1→2, 2→3, 3→4, 4→5 : +1 干员购买槽位   (3 → 4 → 5 → 6 → 7)
//   level 5→6                : +1 道具购买槽位   (1 → 2)
//
// The official AC-4 co-op table is { 3, 4, 4, 5, 5, 5 } with ONE item slot at every level, so the fork mode's top
// operator level is two slots wider and level 6 carries a second item slot. `config.bans`-style: the mode record is
// the only thing that changes — GameData.shopSlots() already reads `modes[modeId].shopSlots` and clamps it, and
// PlayerState.rollShop() lays the slots out from that count, so this suite drives a REAL six-player match through
// every level and then buys out of the two new slot positions.
//
// What this suite pins down: the table itself, that the official modes keep theirs, that the engine really opens
// 7 + 2 slots (with the shop `layout` the invariants check), that the two new positions are usable, and that a
// refresh / freeze at level 6 keeps them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData, DEFAULTS } from '../server/match/gamedata.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';
import { ERR } from '../shared/constants.js';

const FORK = 'mode_ultimate_abyss';
const COOP_ABYSS = 'mode_multi_abyss';
/** The fork mode's table, written out so a change to it is a deliberate edit of this test too. */
const FORK_SLOTS = { 1: [3, 1], 2: [4, 1], 3: [5, 1], 4: [6, 1], 5: [7, 1], 6: [7, 2] };
/** The official AC-4 co-op table. */
const OFFICIAL_SLOTS = { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] };
const gd = (modeId) => new GameData(DATA, modeId);
const counts = (slots) => ({
  chess: slots.filter((s) => s && s.kind === 'chess').length,
  item: slots.filter((s) => s && s.kind === 'item').length,
});

describe('二.2 — 终极模拟 商店升级槽位', () => {
  test('GameData.shopSlots(): the fork table, and the engine clamp still holds', () => {
    const g = gd(FORK);
    for (let lv = 1; lv <= 6; lv++) {
      assert.deepEqual(g.shopSlots(lv), { chess: FORK_SLOTS[lv][0], item: FORK_SLOTS[lv][1] }, `L${lv}`);
    }
    assert.equal(g.maxShopLevel, 6);
    assert.deepEqual(g.upgradePrices(), [5, 8, 11, 12, 13], 'the upgrade prices are the AC-4 ones');
    // one operator slot per upgrade, and the last upgrade is the item slot instead
    for (let lv = 2; lv <= 5; lv++) {
      const a = g.shopSlots(lv - 1); const b = g.shopSlots(lv);
      assert.equal(b.chess - a.chess, 1, `L${lv - 1}→L${lv}: +1 干员槽`);
      assert.equal(b.item - a.item, 0, `L${lv - 1}→L${lv}: no item slot`);
    }
    assert.equal(g.shopSlots(6).chess - g.shopSlots(5).chess, 0, 'L5→L6: no 干员槽');
    assert.equal(g.shopSlots(6).item - g.shopSlots(5).item, 1, 'L5→L6: +1 道具槽');
    // the clamp in gamedata.js takes a fork table that overshoots down to 8 / 4, never further up
    const wide = { ...DATA, config: { ...DATA.config, modes: { ...DATA.config.modes, mode_wide: { ...DATA.config.modes[FORK], modeId: 'mode_wide', shopSlots: { 6: { chess: 99, item: 99 } } } } } };
    assert.deepEqual(new GameData(wide, 'mode_wide').shopSlots(6), { chess: 8, item: 4 });
  });

  test('the official modes keep their own table, and the built-in default is untouched', () => {
    // every official mode's table as committed (they are NOT all the same: 标准 caps the operator slots at 4 until L6,
    // and 入门协议 has no item slot below L5) — the fork's change may not touch any of them
    const OFFICIAL = {
      mode_training_1: { 1: [3, 0], 2: [3, 0], 3: [3, 0], 4: [3, 0], 5: [3, 1], 6: [3, 1] },
      mode_single_funny: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [4, 1], 5: [4, 1], 6: [5, 1] },
      mode_multi_funny: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [4, 1], 5: [4, 1], 6: [5, 1] },
      mode_single_normal: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] },
      mode_single_hard: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] },
      mode_single_abyss: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] },
      mode_multi_normal: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] },
      mode_multi_hard: { 1: [3, 1], 2: [4, 1], 3: [4, 1], 4: [5, 1], 5: [5, 1], 6: [5, 1] },
      mode_multi_abyss: OFFICIAL_SLOTS,
    };
    for (const [id, table] of Object.entries(OFFICIAL)) {
      const g = gd(id);
      for (let lv = 1; lv <= 6; lv++) {
        assert.deepEqual(g.shopSlots(lv), { chess: table[lv][0], item: table[lv][1] }, `${id} L${lv}`);
      }
    }
    assert.deepEqual(DEFAULTS.shopSlots[6], { chess: 5, item: 1 }, 'the last-resort default stays the official one');
  });

  test('a six-player 终极模拟 match really opens 7 + 2 slots at level 6', () => {
    const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 6, seed: 5, fake: true }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      const ps = h.ps('p_0');
      assert.equal(m.modeId, FORK);
      ps.funds = 999;
      for (let lv = 1; lv <= 6; lv++) {
        ps.shop.level = lv;
        ps.rollShop();
        assert.equal(ps.shop.slots.length, FORK_SLOTS[lv][0] + FORK_SLOTS[lv][1], `L${lv}: slot count`);
        assert.deepEqual(ps.shop.layout, { chess: FORK_SLOTS[lv][0], item: FORK_SLOTS[lv][1] }, `L${lv}: layout`);
        assert.deepEqual(counts(ps.shop.slots), { chess: FORK_SLOTS[lv][0], item: FORK_SLOTS[lv][1] }, `L${lv}: kinds`);
        // the shop's chess slots are at the front, the item slots at the back (PlayerState.rollShop)
        assert.deepEqual(ps.shop.slots.map((s) => (s && s.kind) || 'none'), [
          ...Array(FORK_SLOTS[lv][0]).fill('chess'), ...Array(FORK_SLOTS[lv][1]).fill('item'),
        ], `L${lv}: ordering`);
        checkInvariants(m);
      }
      // the private frame the browser draws from carries all nine slots and the level
      const priv = ps.privateView();
      assert.equal(priv.shop.level, 6);
      assert.equal(priv.shop.slots.length, 9);
      assert.equal(priv.shop.slots.filter((s) => s && s.kind === 'item').length, 2);
    } finally {
      h.m.dispose();
    }
  });

  test('the two new positions are usable: the 7th 干员槽 and the 2nd 道具槽 both buy', () => {
    const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 6, seed: 5, fake: true }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      const ps = h.ps('p_0');
      ps.shop.level = 6;
      ps.rollShop();
      assert.equal(ps.shop.slots.length, 9);
      ps.funds = 999;
      // slot 6 = the 7th operator card, slot 8 = the 2nd item card
      for (const [idx, kind] of [[6, 'chess'], [8, 'item']]) {
        const s = ps.shop.slots[idx];
        assert.equal(s.kind, kind, `slot ${idx}`);
        assert.equal(s.sold, false, `slot ${idx} starts unsold`);
        assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: idx }), { ok: true }, `slot ${idx} buys`);
        assert.equal(ps.shop.slots[idx].sold, true, `slot ${idx} is spent`);
      }
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('refresh and freeze at level 6 keep the nine slots (and the official mode keeps six)', () => {
    const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 6, seed: 6, fake: true }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      const ps = h.ps('p_0');
      ps.shop.level = 6;
      ps.rollShop();
      ps.funds = 999;
      ps.shop.freeRefreshes = 2;
      assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
      assert.equal(ps.shop.slots.length, 9, 'a refresh keeps the level-6 layout');
      assert.deepEqual(counts(ps.shop.slots), { chess: 7, item: 2 });
      assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
      const frozen = ps.shop.slots.filter((s) => s && s.frozen).length;
      assert.equal(frozen, 9, 'freeze covers every slot');
      ps.rollShop({ keepFrozen: true });
      assert.equal(ps.shop.slots.length, 9, 'a round-start reroll keeps them too');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
    const coop = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 6, fake: true }).start();
    try {
      coop.toPrep(1);
      const ps = coop.ps('p_0');
      ps.shop.level = 6;
      ps.rollShop();
      assert.equal(ps.shop.slots.length, 6, 'the official AC-4 room still has 5 + 1');
      assert.deepEqual(counts(ps.shop.slots), { chess: 5, item: 1 });
    } finally {
      coop.m.dispose();
    }
  });

  test('buying past the last slot is still refused, and the error codes are unchanged', () => {
    const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 6, seed: 7, fake: true }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      const ps = h.ps('p_0');
      ps.shop.level = 6;
      ps.rollShop();
      ps.funds = 999;
      assert.equal(m.handle('p_0', { t: 'g.buy', slot: 9 }).error, ERR.BAD_TARGET);
      assert.equal(m.handle('p_0', { t: 'g.buy', slot: 15 }).error, ERR.BAD_TARGET);
      ps.shop.level = 1;
      ps.rollShop();
      assert.equal(ps.shop.slots.length, 4);
      assert.equal(m.handle('p_0', { t: 'g.buy', slot: 4 }).error, ERR.BAD_TARGET, 'the level-1 layout has 4 slots');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });
});
