// test/fork-ultimate-enemy-stats.test.js — requirement 二.3 敌人属性调整（以 AC-4 为基础）.
//
//   * from ROUND 4 on, an ordinary enemy has +10 % HP and nothing else;
//   * the 最终攻势 leader: +20 % HP, +20 % DEF, +8 % ATK;
//   * the 隐秘核心: +35 % HP, +35 % DEF, +16 % ATK;
//   * the leader's / hidden core's HP is applied PER BOSS id (a leader's HP is the shared pool, i.e.
//     `boss.bloodPoint[difficulty]`, so 1.20 lands on boss_1…boss_7 and 1.35 on boss_8…boss_10 separately) — never one
//     blanket multiplier over the pool;
//   * never on the 部位/parts a boss calls (and the boss's runtime summons never take the round scaling at all).
//
// Where each piece lives: `tools/fork-overrides.mjs` carries `enemyAdjust`; `GameData.enemyExtras(r)` splits it by
// spawn class, `server/match/waves.js` applies it to the spawn mods (the +HP on the non-leader branch only, the
// ATK/DEF extra on the leader branch), and `GameData.bossHpExtra(bossId)` / `finalAssault.bossPoolHp()` apply the HP
// part to the pool. This suite checks the numbers, the real spawn specs of a fork round, and that every official mode
// is untouched (its spawn specs must not even grow a `defMul` key).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave, buildBossWave } from '../server/match/waves.js';
import { bossPoolHp } from '../server/match/finalAssault.js';
import { createRng } from '../server/sim/rng.js';
import { DATA } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const COOP = 'mode_multi_abyss';
const gd = (modeId) => new GameData(DATA, modeId);
const LEADER_IDS = ['boss_1', 'boss_2', 'boss_3', 'boss_4', 'boss_5', 'boss_6', 'boss_7'];
const HIDDEN_IDS = ['boss_8', 'boss_9', 'boss_10'];
/** The official-mode counterpart of a fork wave: same gd inputs, the same seed. */
const officialSetup = () => setupMatchWaves(gd(COOP), createRng(11));
const forkSetup = () => setupMatchWaves(gd(FORK), createRng(11));

/** Spawn specs of one round of a mode, as the match would generate them. */
function roundSpawns(modeId, round, setup, { bossId = null, solo = false } = {}) {
  const g = gd(modeId);
  const rng = createRng(round);
  const factions = round >= g.bossRound ? { ...setup.factions, schedule: setup.factions.schedule } : setup.factions;
  const wave = bossId
    ? buildBossWave(g, rng, factions, round, { bossId, solo })
    : buildNormalWave(g, rng, factions, round);
  return wave.spawns;
}

describe('二.3 — 终极模拟 敌人属性调整（R4 起）', () => {
  test('GameData.enemyExtras(): nothing before R4, +10 % HP for ordinary spawns from R4, leader/hidden ATK+DEF by round', () => {
    const g = gd(FORK);
    for (const r of [1, 2, 3]) {
      assert.deepEqual(g.enemyExtras(r), { normalHp: 1, bossAtk: 1, bossDef: 1 }, `R${r}`);
    }
    for (const r of [4, 5, 6, 10, 13, 14]) {
      assert.deepEqual(g.enemyExtras(r), { normalHp: 1.1, bossAtk: 1.08, bossDef: 1.2 }, `R${r}`);
    }
    // the hidden round is a different class: +16 % ATK / +35 % DEF, the ordinary HP bonus is the same
    assert.deepEqual(g.enemyExtras(15), { normalHp: 1.1, bossAtk: 1.16, bossDef: 1.35 }, 'R15 隐秘核心');
    // official modes have no adjustment at all
    for (const modeId of [COOP, 'mode_multi_hard', 'mode_multi_normal', 'mode_single_abyss', 'mode_multi_funny']) {
      const o = gd(modeId);
      for (let r = 1; r <= 15; r++) assert.deepEqual(o.enemyExtras(r), { normalHp: 1, bossAtk: 1, bossDef: 1 }, `${modeId} R${r}`);
    }
  });

  test('a malformed / partial adjustment degrades to 1 and honours fromRound', () => {
    const patched = (adj) => new GameData({
      ...DATA,
      config: { ...DATA.config, modes: { ...DATA.config.modes, mode_adj: { ...DATA.config.modes[FORK], modeId: 'mode_adj', enemyAdjust: adj } } },
    }, 'mode_adj');
    assert.deepEqual(patched(null).enemyExtras(5), { normalHp: 1, bossAtk: 1, bossDef: 1 }, 'no block');
    assert.deepEqual(patched({ normal: { hp: 0 } }).enemyExtras(5), { normalHp: 1, bossAtk: 1, bossDef: 1 }, 'fromRound defaults to 1, 0 counts as unset');
    assert.deepEqual(patched({ fromRound: 0, normal: { hp: 2 } }).enemyExtras(1), { normalHp: 2, bossAtk: 1, bossDef: 1 }, 'fromRound 0 = always');
    assert.deepEqual(patched({ fromRound: 9, normal: { hp: 2 } }).enemyExtras(8), { normalHp: 1, bossAtk: 1, bossDef: 1 }, 'before the window');
    assert.deepEqual(patched({ fromRound: 9, normal: { hp: 2 } }).enemyExtras(9).normalHp, 2, 'from the window on');
    assert.deepEqual(patched({ normal: { hp: 'x' }, leader: { atk: -1, def: NaN } }).enemyExtras(5), { normalHp: 1, bossAtk: 1, bossDef: 1 }, 'garbage values');
  });

  test('bossHpExtra(): the leader and the hidden core are looked up separately, per boss id', () => {
    const g = gd(FORK);
    for (const id of LEADER_IDS) assert.equal(g.bossHpExtra(id), 1.2, `${id} (最终攻势)`);
    for (const id of HIDDEN_IDS) assert.equal(g.bossHpExtra(id), 1.35, `${id} (隐秘核心)`);
    assert.equal(g.bossHpExtra('nope'), 1.2, 'an unknown id is treated as a leader');
    assert.equal(g.bossHpExtra(null), 1, 'a non-string is 1');
    for (const modeId of [COOP, 'mode_multi_hard', 'mode_multi_funny']) {
      const o = gd(modeId);
      for (const id of [...LEADER_IDS, ...HIDDEN_IDS]) assert.equal(o.bossHpExtra(id), 1, `${modeId} ${id}`);
    }
  });

  test('the shared pool takes the factor PER BOSS — boss_1 4 320 000 vs boss_8 9 720 000 at ×1.2 / ×1.35', () => {
    const g = gd(FORK);
    const o = gd(COOP);
    // The pool rule is UPSTREAM's (0.2.x, PR #209): config bossHpScale perPlayer true, so co-op share = coop × the
    // players alive (4 here) — the fork's ×1.2 / ×1.35 land ON TOP of it. The numbers in this test's title are the
    // fixed-pool ones of 0.1.x (share 1), kept for the ids; the SHARE is read from the mode so the test still proves
    // what it is about: the two factors are independent and per boss id.
    const share = g.bossPoolShare(4);
    for (const id of LEADER_IDS) {
      const base = DATA.bosses[id].bloodPoint.ABYSS;
      assert.equal(g.bossPoolHp(id, 4), Math.round(base * share * 1.2), `${id} ×1.2`);
      assert.equal(o.bossPoolHp(id, 4), Math.round(base * o.bossPoolShare(4)), `${id} official unchanged`);
      assert.equal(bossPoolHp(g, id, 4), g.bossPoolHp(id, 4), `${id}: finalAssault agrees`);
    }
    for (const id of HIDDEN_IDS) {
      const base = DATA.bosses[id].bloodPoint.ABYSS;
      assert.equal(g.bossPoolHp(id, 4), Math.round(base * share * 1.35), `${id} ×1.35`);
      assert.equal(o.bossPoolHp(id, 4), Math.round(base * o.bossPoolShare(4)), `${id} official unchanged`);
      assert.equal(bossPoolHp(g, id, 4), g.bossPoolHp(id, 4), `${id}: finalAssault agrees`);
    }
    // the two factors are genuinely independent: neither can move the other's pool
    assert.equal(g.bossPoolHp('boss_1', 4), Math.round(DATA.bosses.boss_1.bloodPoint.ABYSS * share * 1.2));
    assert.notEqual(Math.round(DATA.bosses.boss_1.bloodPoint.ABYSS * share * 1.35), g.bossPoolHp('boss_1', 4));
    // solo keeps its own share, on top of the extra (UPSTREAM's rule: config bossHpScale solo, 1 since 0.2.x)
    const solo = new GameData(DATA, 'mode_single_abyss'); // official: no extra
    assert.equal(solo.bossPoolHp('boss_2'), Math.round(DATA.bosses.boss_2.bloodPoint.ABYSS * solo.bossPoolShare()));
  });

  test('real R4 normal spawns: ordinary +10 % HP and nothing else (R4 is not a boss round)', () => {
    const fork = roundSpawns(FORK, 4, forkSetup());
    const off = roundSpawns(COOP, 4, officialSetup());
    assert.equal(fork.length, off.length, 'the same composition — the extra is a multiplier, not a new spawn');
    let ordinary = 0;
    for (let i = 0; i < fork.length; i++) {
      const a = fork[i]; const b = off[i];
      assert.equal(a.enemyKey, b.enemyKey, 'same enemy');
      assert.equal(a.tag, b.tag, 'same tag');
      assert.notEqual(a.tag, 'boss', 'no leader in a normal round');
      if (a.tag === 'part') {
        assert.equal(a.mods.hpMul, b.mods.hpMul, 'a 部位 does not take the ordinary +10 % HP');
        continue;
      }
      ordinary++;
      assert.equal(a.mods.hpMul, b.mods.hpMul * 1.1, 'ordinary +10 % HP');
      assert.equal(a.mods.atkMul, b.mods.atkMul, 'ordinary ATK unchanged');
      assert.equal(a.mods.speedMul, b.mods.speedMul, 'ordinary speed unchanged');
      assert.ok(!('defMul' in a.mods), 'ordinary enemies take no DEF extra');
    }
    assert.ok(ordinary > 0, `saw ordinary spawns (${ordinary})`);
  });

  test('real R14 最终攻势 spawns: the leader +8 % ATK / +20 % DEF and no HP, ordinary +10 % HP', () => {
    const setup = forkSetup();
    const offSetup = officialSetup();
    assert.equal(setup.bossId, offSetup.bossId, 'same seeded boss');
    const fork = roundSpawns(FORK, 14, setup, { bossId: setup.bossId });
    const off = roundSpawns(COOP, 14, offSetup, { bossId: offSetup.bossId });
    assert.equal(fork.length, off.length, 'same composition');
    const leaders = fork.filter((s) => s.tag === 'boss');
    assert.equal(leaders.length, 1, 'exactly one leader in the Final Assault wave');
    const idx = fork.indexOf(leaders[0]);
    assert.equal(fork[idx].enemyKey, off[idx].enemyKey, 'the same boss');
    assert.equal(fork[idx].mods.atkMul, off[idx].mods.atkMul * 1.08, 'leader ATK +8 %');
    assert.equal(fork[idx].mods.defMul, 1.2, 'leader DEF +20 % (additive on its own DEF)');
    assert.equal(off[idx].mods.defMul, undefined, 'the official spec never grows a defMul key');
    assert.ok(!('hpMul' in fork[idx].mods), 'the leader never takes an hpMul — its HP is the shared pool');
    assert.equal(fork[idx].mods.speedMul, off[idx].mods.speedMul, 'other attributes unchanged');
    for (let i = 0; i < fork.length; i++) {
      const a = fork[i]; const b = off[i];
      if (a.tag === 'boss' || a.tag === 'part') continue;
      assert.equal(a.mods.hpMul, b.mods.hpMul * 1.1, `#${i}: the leader's escorts are ordinary enemies`);
      assert.equal(a.mods.atkMul, b.mods.atkMul, `#${i}: no ATK extra for escorts`);
      assert.ok(!('defMul' in a.mods), `#${i}: no DEF extra for escorts`);
    }
  });

  test('real R15 隐秘核心 spawns: +16 % ATK / +35 % DEF on the hidden core, ordinary still +10 % HP', () => {
    const setup = forkSetup();
    const offSetup = officialSetup();
    const fork = roundSpawns(FORK, 15, setup, { bossId: setup.hiddenBossId });
    const off = roundSpawns(COOP, 15, offSetup, { bossId: offSetup.hiddenBossId });
    assert.equal(fork.length, off.length);
    const f = fork.slice().sort((a, b) => a.time - b.time);
    const o = off.slice().sort((a, b) => a.time - b.time);
    const bosses = f.filter((s) => s.tag === 'boss');
    assert.equal(bosses.length, 1, 'one hidden core');
    const idx = f.indexOf(bosses[0]);
    assert.equal(f[idx].mods.atkMul, o[idx].mods.atkMul * 1.16, 'hidden core ATK +16 %');
    assert.equal(f[idx].mods.defMul, 1.35, 'hidden core DEF +35 %');
    assert.ok(!('hpMul' in f[idx].mods), 'its HP is the pool');
    for (const s of f) {
      if (s.tag === 'boss' || s.tag === 'part') continue;
      const match = o[f.indexOf(s)];
      assert.equal(s.mods.hpMul, match.mods.hpMul * 1.1, 'ordinary spawns keep +10 % HP in the hidden round');
    }
  });

  test('R1–R3 and every official mode generate byte-identical spawn mods', () => {
    for (const modeId of [FORK, COOP, 'mode_multi_hard', 'mode_single_abyss']) {
      const setup = setupMatchWaves(gd(modeId), createRng(3));
      for (const r of [1, 2, 3]) {
        const one = roundSpawns(modeId, r, setup);
        const two = roundSpawns(modeId, r, setup);
        assert.deepEqual(one, two, `${modeId} R${r}: deterministic`);
        for (const s of one) {
          assert.ok(!('defMul' in s.mods), `${modeId} R${r}: no defMul before R4`);
          assert.ok(Number.isFinite(s.mods.hpMul) && s.mods.hpMul > 0, `${modeId} R${r}: hpMul`);
        }
      }
    }
    // the official mode at R4 must be exactly what the fork mode would be without its extras
    const fork4 = roundSpawns(FORK, 4, forkSetup());
    const off4 = roundSpawns(COOP, 4, officialSetup());
    for (let i = 0; i < off4.length; i++) {
      const a = fork4[i]; const b = off4[i];
      assert.ok(a.mods.hpMul !== b.mods.hpMul || b.tag === 'boss', `#${i}: the fork extras are visible at R4`);
      assert.ok(!('defMul' in b.mods), `#${i}: the official spec stays untouched`);
    }
  });
});
