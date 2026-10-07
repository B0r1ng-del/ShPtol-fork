// test/fork-cheat-menu.test.js — requirement 三 全模式通用作弊菜单 (server half).
//
//   三.1 激活 — the code is a CLIENT-side gate (`CHEAT_CODE` ships in the bundle), so the server validates the ACTION
//        only; `g.cheat { action, on? }` with action ∈ CHEAT_ACTIONS.
//   三.3 功能 — 无限资金 (a switch) / 复原资金 / 商店满级 / 免费刷新 +5 / 盟约层数 +100, each touching ONLY the
//        activating player's own state (the owner's call "谁开谁负责").
//   Plus: the FIRST time a player uses any cheat in a match the whole room is told once — the red banner
//        `"<name>"纸尿裤兜不住了!!` as `m.cheat`.
//
// Every official path is checked too: with no cheat, spending still refuses ERR.NO_FUNDS when the funds are short, and
// a second player's economy is never touched by the first one's cheats.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ERR, PHASE, CHEAT_CODE, CHEAT_ACTIONS, CHEAT_INFINITE_FUNDS, CHEAT_FREE_REFRESHES, CHEAT_BOND_LAYERS, cheatBannerText } from '../shared/constants.js';
import { validateC2S, S2C } from '../shared/protocol.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const BANNER = (name) => `"${name}"纸尿裤兜不住了!!`;
const cheats = (h, pid = null) => h.bc.filter((m) => m.t === 'm.cheat' && (pid == null || m.playerId === pid));

/** A co-op match sitting in its first prep, where the shop / funds / bonds are all live. */
function atPrep({ humans = 2, seed = 11 } = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans, seed, fake: true }).start();
  h.toPrep(1);
  h.ps('p_0').funds = 7;
  return h;
}

describe('三 — 作弊菜单 (every mode, server side)', () => {
  test('the code, the action list, the banner text and the protocol entry', () => {
    // the user asked for this exact string (j and q swapped from the first version)
    assert.equal(CHEAT_CODE, 'Ojq1887415157!');
    assert.deepEqual([...CHEAT_ACTIONS], ['infiniteFunds', 'restoreFunds', 'maxShop', 'freeRefresh', 'bondLayers']);
    assert.equal(cheatBannerText('杨某'), '"杨某"纸尿裤兜不住了!!');
    assert.equal(cheatBannerText(''), '"博士"纸尿裤兜不住了!!', 'a nameless player still gets a banner');
    assert.ok(S2C.includes('m.cheat'), 'the banner is a declared server→client type');
    for (const action of CHEAT_ACTIONS) {
      assert.equal(validateC2S({ t: 'g.cheat', action }), null, action);
      assert.equal(validateC2S({ t: 'g.cheat', action, on: true }), null, `${action} on`);
      assert.equal(validateC2S({ t: 'g.cheat', action, on: false }), null, `${action} off`);
    }
    assert.notEqual(validateC2S({ t: 'g.cheat', action: 'nope' }), null, 'an unknown action stays BAD_MSG');
    assert.notEqual(validateC2S({ t: 'g.cheat' }), null, 'the action is required');
    assert.notEqual(validateC2S({ t: 'g.cheat', action: 'maxShop', on: 'yes' }), null, 'on is a boolean');
  });

  test('无限资金: purchases and refreshes stop taking funds, and 复原资金 puts the pre-switch value back', () => {
    const h = atPrep();
    try {
      const m = h.m;
      const ps = h.ps('p_0');
      assert.equal(ps.funds, 7);
      // the switch on: the pre-switch value is captured and the panel's number is topped up
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds', on: true }), { ok: true });
      assert.equal(ps.cheat.infiniteFunds, true);
      assert.equal(ps.cheat.fundsBaseline, 7);
      assert.equal(ps.funds, CHEAT_INFINITE_FUNDS);
      assert.equal(ps.privateView().cheat.infiniteFunds, true, 'the panel reads it from the server');
      // …and it really is free: after wiping the funds, a buy and a level-up still go through and take nothing
      ps.funds = 0;
      const slot = ps.shop.slots.findIndex((s) => s && !s.sold);
      assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot }), { ok: true });
      assert.equal(ps.funds, 0, 'nothing was taken');
      assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
      assert.equal(ps.funds, 0, 'the level-up was free too');
      assert.equal(ps.shop.level, 2);
      // 复原资金
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'restoreFunds' }), { ok: true });
      assert.equal(ps.funds, 7, 'the captured value is back');
      assert.equal(ps.cheat.infiniteFunds, false);
      assert.equal(ps.cheat.fundsBaseline, null);
      assert.equal(ps.privateView().cheat.infiniteFunds, false);
      checkInvariants(m);
    } finally { h.m.dispose(); }
  });

  test('无限资金 toggles off without 复原资金 (the baseline is restored either way)', () => {
    const h = atPrep({ seed: 12 });
    try {
      const m = h.m;
      const ps = h.ps('p_0');
      m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds', on: true });
      ps.funds = 0;
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds', on: false }), { ok: true });
      assert.equal(ps.cheat.infiniteFunds, false);
      assert.equal(ps.funds, 7);
      // toggling twice with no argument flips it
      m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds' });
      assert.equal(ps.cheat.infiniteFunds, true);
      m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds' });
      assert.equal(ps.cheat.infiniteFunds, false);
      checkInvariants(m);
    } finally { h.m.dispose(); }
  });

  test('商店满级 / 免费刷新 +5 / 盟约层数 +100', () => {
    const h = atPrep({ seed: 13 });
    try {
      const m = h.m;
      const ps = h.ps('p_0');
      // 商店满级: free, the top level, and the shelf is re-laid out for it
      const before = ps.funds;
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'maxShop' }), { ok: true });
      assert.equal(ps.shop.level, ps.gd.maxShopLevel);
      assert.equal(ps.funds, before, 'free');
      assert.deepEqual(ps.shop.layout, { chess: 5, item: 1 }, 'the official AC-4 layout at level 6');
      assert.equal(ps.shop.slots.length, 6);
      checkInvariants(m);
      // 免费刷新 +5
      const free0 = ps.shop.freeRefreshes;
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'freeRefresh' }), { ok: true });
      assert.equal(ps.shop.freeRefreshes, free0 + CHEAT_FREE_REFRESHES);
      // 盟约层数 +100 — over the ACTIVE bonds, through addLayers (so BOND_LABEL_CAP 999 still holds)
      ps.bonds = { yanShip: { active: true }, sargonShip: { active: true }, victoriaShip: { active: false } };
      ps.layers = {};
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'bondLayers' }), { ok: true });
      assert.equal(ps.layers.yanShip, CHEAT_BOND_LAYERS);
      assert.equal(ps.layers.sargonShip, CHEAT_BOND_LAYERS);
      assert.equal(ps.layers.victoriaShip, undefined, 'an inactive bond is not raised');
      // the cap holds: a second +100 on a bond already at 950 adds only 49
      ps.bonds = { yanShip: { active: true } };
      ps.layers = { yanShip: 950 };
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'bondLayers' }), { ok: true });
      assert.equal(ps.layers.yanShip, 999, 'BOND_LAYER_CAP');
      // no active bond: refused, not silently ignored
      ps.bonds = {};
      assert.equal(m.handle('p_0', { t: 'g.cheat', action: 'bondLayers' }).error, ERR.BAD_TARGET);
      // the test faked `ps.bonds` above; a real recompute restores the derived snapshot so the invariants pass again
      ps.recompute();
      checkInvariants(m);
    } finally { h.m.dispose(); }
  });

  test('the red banner fires once per player per match, for the player who cheated', () => {
    const h = atPrep({ seed: 14 });
    try {
      const m = h.m;
      const name = h.ps('p_0').name;
      assert.deepEqual(cheats(h), [], 'nothing before the first cheat');
      assert.deepEqual(m.handle('p_0', { t: 'g.cheat', action: 'freeRefresh' }), { ok: true });
      const first = cheats(h, 'p_0');
      assert.equal(first.length, 1, 'exactly one banner');
      assert.equal(first[0].text, BANNER(name));
      assert.equal(first[0].name, name);
      assert.equal(first[0].playerId, 'p_0');
      assert.equal(first[0].text, cheatBannerText(name));
      // the SECOND and third cheat of the same player raise nothing more
      m.handle('p_0', { t: 'g.cheat', action: 'maxShop' });
      m.handle('p_0', { t: 'g.cheat', action: 'freeRefresh' });
      assert.equal(cheats(h, 'p_0').length, 1, 'one per player, however many cheats are used');
      assert.equal(h.ps('p_0').cheat.used, true);
      // another player gets their own banner (their own name)
      const name1 = h.ps('p_1').name;
      assert.deepEqual(m.handle('p_1', { t: 'g.cheat', action: 'freeRefresh' }), { ok: true });
      assert.equal(cheats(h, 'p_1').length, 1);
      assert.equal(cheats(h, 'p_1')[0].text, BANNER(name1));
      assert.equal(cheats(h).length, 2);
    } finally { h.m.dispose(); }
  });

  test('another player is never touched, and the official economy still refuses NO_FUNDS without a cheat', () => {
    const h = atPrep({ seed: 15 });
    try {
      const m = h.m;
      const a = h.ps('p_0'); const b = h.ps('p_1');
      const bFunds = b.funds; const bLevel = b.shop.level;
      a.funds = 7;
      m.handle('p_0', { t: 'g.cheat', action: 'infiniteFunds', on: true });
      m.handle('p_0', { t: 'g.cheat', action: 'maxShop' });
      m.handle('p_0', { t: 'g.cheat', action: 'freeRefresh' });
      assert.equal(b.funds, bFunds, "B's funds are untouched");
      assert.equal(b.shop.level, bLevel, "B's shop is untouched");
      assert.equal(b.shop.freeRefreshes, 0);
      assert.equal(b.cheat.infiniteFunds, false);
      assert.equal(b.cheat.used, false);
      // B still pays, and is refused when short — the official path is intact
      b.funds = 0;
      const slot = b.shop.slots.findIndex((s) => s && !s.sold && s.basePrice > 0);
      assert.equal(m.handle('p_1', { t: 'g.buy', slot }).error, ERR.NO_FUNDS);
      b.funds = 50;
      assert.deepEqual(m.handle('p_1', { t: 'g.buy', slot }), { ok: true });
      assert.ok(b.funds < 50, 'B really paid');
      checkInvariants(m);
    } finally { h.m.dispose(); }
  });

  test('the panel is available in EVERY mode: a 终极模拟 room and a solo room behave the same', () => {
    for (const [mode, difficulty, seed] of [['ultimate', 'ABYSS', 16], ['solo', 'NORMAL', 17]]) {
      const h = makeMatch({ mode, difficulty, humans: 0, bots: 0, seats: [{ seat: 0, playerId: 'me', name: 'Me', isBot: false, connected: true }], seed, fake: true }).start();
      try {
        h.toPrep(1);
        const ps = h.ps('me');
        ps.funds = 3;
        assert.deepEqual(h.m.handle('me', { t: 'g.cheat', action: 'restoreFunds' }), { ok: true }, `${mode}: restoreFunds`);
        assert.deepEqual(h.m.handle('me', { t: 'g.cheat', action: 'freeRefresh' }), { ok: true }, `${mode}: freeRefresh`);
        assert.equal(ps.shop.freeRefreshes, CHEAT_FREE_REFRESHES, mode);
        assert.equal(cheats(h, 'me').length, 1, `${mode}: one banner`);
        assert.equal(h.m.phase, PHASE.PREP, `${mode}: the phase is untouched`);
      } finally { h.m.dispose(); }
    }
  });

  test('an unknown action never reaches the state (defensive: the dispatcher validates first)', () => {
    const h = atPrep({ seed: 18 });
    try {
      const m = h.m;
      const ps = h.ps('p_0');
      const free0 = ps.shop.freeRefreshes;
      assert.equal(m.cheat(ps, 'nope').error, ERR.BAD_MSG, 'the direct call answers the fail() shape');
      assert.equal(ps.shop.freeRefreshes, free0);
      assert.equal(cheats(h).length, 0, 'no banner for a refused action');
      assert.equal(ps.cheat.used, false);
      assert.equal(DATA.config.modes.mode_multi_normal.modeId, 'mode_multi_normal', 'sanity: the data is loaded');
    } finally { h.m.dispose(); }
  });
});
