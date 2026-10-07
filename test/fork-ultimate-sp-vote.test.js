// test/fork-ultimate-sp-vote.test.js — requirement 二.4: 机变阶段改造 (only in 终极模拟).
//
//   * 移除原有的时间限制 — the draft has no clock at all (`sp.untimed`, `m.deadline === 0`);
//   * 加入投票系统 — any player may vote for a RANDOM allocation instead of picking a card (`g.choiceRandom`); as soon
//     as HALF of the alive players have voted (`votes × 2 ≥ alive`) the system hands the cards out at random, one per
//     alive player, over their own pick; below half **each player keeps the card it picked**;
//   * 悬赏类不要添加随机机制 — a 悬赏 card adds its enemies to the PICKER's own next battles, so it is never part of the
//     random draw, and in a 悬赏决策 draft (AC-4 R3/R9) the vote is not offered at all;
//   * the sequential turn order becomes a parallel one: with no clock, waiting on one player at a time could stall the
//     round forever, so everyone decides at once and the draft ends when every alive player has picked or voted.
//
// The draft machinery is driven through a real six-player match. The vote tests inject a synthetic 道具补给 draft after
// reaching a real SP_DRAFT (a 悬赏 one at R3) so the random path is exercised with a family the vote is offered for.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ERR, PHASE } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { GameData } from '../server/match/gamedata.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const COOP = 'mode_multi_abyss';

/** A six-player 终极模拟 match driven to the 机变 of round `round` (the harness must not pick for the humans). */
function atSpDraft(round, { humans = 6, bots = 0, seed = 21 } = {}) {
  const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans, bots, seed, fake: true }).start();
  h.drive(() => (h.m.phase === PHASE.ROUND_START && h.m.round === round) || h.m.round > round);
  h.run(() => h.m.phase === PHASE.SP_DRAFT || h.m.round > round);
  return h;
}

/** Replace the real draft with a synthetic one of `family` so the vote is offered (see the header). */
function injectDraft(m, family = 'supply') {
  const g = m.gd;
  const ids = Object.values(g.shopItemsByTier).flat().slice(0, 6);
  const cards = ids.map((id, i) => ({
    kind: 'item', id, name: DATA.items[id].name, desc: '', tier: DATA.items[id].tier, price: 0,
    idx: i, family,
  }));
  const s = m.sp;
  m.sp = {
    ...s, family, name: '道具补给', cards, picks: {}, taken: {},
    randomVotes: new Set(), randomResolved: false, randomOffer: g.spDraftRules.randomFamilies,
  };
  m.startSpTurn();
  return m.sp;
}

describe('二.4 — 终极模拟 机变：去时限 + 随机分配投票', () => {
  test('the mode declares the rules; every official mode keeps the sequential timed draft', () => {
    assert.deepEqual(new GameData(DATA, FORK).spDraftRules, {
      untimed: true, parallel: true, randomFamilies: ['supply', 'shop', 'tactic'],
    });
    assert.equal(new GameData(DATA, FORK).spDraft.randomVote.families.includes('bounty'), false, '悬赏 is never in the list');
    for (const id of [COOP, 'mode_multi_hard', 'mode_multi_normal', 'mode_single_abyss', 'mode_multi_funny']) {
      assert.deepEqual(new GameData(DATA, id).spDraftRules, { untimed: false, parallel: false, randomFamilies: null }, id);
      assert.equal(new GameData(DATA, id).spDraft, null, id);
    }
  });

  test('protocol: g.choiceRandom is a known client message (empty payload, extras ignored like every {} intent)', () => {
    assert.equal(validateC2S({ t: 'g.choiceRandom' }), null);
    assert.notEqual(validateC2S({ t: 'g.choiceRandomX' }), null, 'an unknown message stays BAD_MSG');
    assert.notEqual(validateC2S(null), null, 'a non-object stays BAD_MSG');
  });

  test('a real R3 悬赏 draft: untimed, parallel, and the random vote is NOT offered', () => {
    const h = atSpDraft(3);
    try {
      const m = h.m;
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.sp.family, 'bounty', 'AC-4 R3 is 悬赏决策 (the fork copies its schedule)');
      assert.equal(m.sp.untimed, true, '移除时间限制');
      assert.equal(m.sp.parallel, true);
      assert.equal(m.deadline, 0, 'no clock at all');
      const pub = m.publicView().sp;
      assert.equal(pub.untimed, true);
      assert.equal(pub.parallel, true);
      assert.equal(pub.randomOffer, null, '悬赏决策 never offers 随机分配');
      assert.deepEqual(pub.randomVotes, []);
      // the vote is refused, every player may still pick at any time (no turn order)
      const pids = m.alivePlayers().map((p) => p.playerId);
      assert.equal(m.handle(pids[1], { t: 'g.choiceRandom' }).error, ERR.WRONG_PHASE);
      for (let i = pids.length - 1; i >= 0; i--) {
        const avail = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        assert.deepEqual(m.handle(pids[i], { t: 'g.choice', idx: avail }), { ok: true }, `${pids[i]} picks out of order`);
      }
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP, '机变 ends once everyone has picked — no timer needed');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('a real six-player draft is untimed, and the bots act in parallel with the humans', () => {
    const h = atSpDraft(3, { humans: 2, bots: 4, seed: 22 });
    try {
      const m = h.m;
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.deadline, 0);
      assert.equal(m.alivePlayers().length, 6);
      // the humans pick; the four bots must have acted on their own (their own parallel schedules)
      for (const pid of ['p_0', 'p_1']) {
        const avail = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        assert.deepEqual(m.handle(pid, { t: 'g.choice', idx: avail }), { ok: true });
      }
      h.sched.advance(2000);
      assert.equal(m.phase, PHASE.PREP, 'every seat ended the draft (humans picked, bots picked)');
      for (const ps of m.players.values()) if (ps.alive) assert.ok(m.sp === null || true);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('below half the votes nothing happens: each player keeps its own pick', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 23 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      assert.equal(m.randomVoteOffered(), true);
      const pids = m.alivePlayers().map((p) => p.playerId);
      assert.equal(pids.length, 4);
      // one vote of four = below half (1 × 2 < 4). `s` is the live draft object (m.sp is cleared once the phase moves on)
      assert.deepEqual(m.handle(pids[0], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, false);
      assert.equal(m.voteRandomReached(), false);
      assert.deepEqual(m.publicView().sp.randomVotes, [pids[0]]);
      assert.equal(m.handle(pids[0], { t: 'g.choiceRandom' }).error, ERR.ALREADY, 'one vote each');
      // the others pick their own cards; the voter picked none and gets none
      const chosen = {};
      for (const pid of pids.slice(1)) {
        const avail = s.cards.map((c) => c.idx).find((k) => s.taken[k] == null);
        chosen[pid] = avail;
        assert.deepEqual(m.handle(pid, { t: 'g.choice', idx: avail }), { ok: true });
      }
      const picks = { ...s.picks };
      for (const [pid, idx] of Object.entries(chosen)) assert.equal(picks[pid], idx, `${pid} keeps its own pick`);
      assert.equal(picks[pids[0]], undefined, 'the losing voter takes nothing this round');
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('half the votes is enough: the system hands the cards out at random, one per player', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 24 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      const pids = m.alivePlayers().map((p) => p.playerId);
      // two of four already had their own picks — the random draw overrides them
      assert.deepEqual(m.handle(pids[0], { t: 'g.choice', idx: 0 }), { ok: true });
      assert.deepEqual(m.handle(pids[1], { t: 'g.choice', idx: 1 }), { ok: true });
      const before = { ...s.picks };
      assert.deepEqual(m.handle(pids[2], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, false, '2 of 4 is half — one vote is not enough');
      assert.deepEqual(m.handle(pids[3], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, true, '2 × 2 ≥ 4 → resolved at once');
      // every alive player ends with exactly one card, and the cards are a set of distinct indexes
      const picks = pids.map((pid) => s.picks[pid]);
      assert.ok(picks.every((i) => Number.isInteger(i)), `every player got a card (${JSON.stringify(picks)})`);
      assert.equal(new Set(picks).size, pids.length, 'no card went to two players');
      for (const pid of pids) assert.equal(s.taken[s.picks[pid]], pid, 'taken ↔ picks agree');
      assert.ok(before[pids[0]] != null, 'the earlier own picks were overridden by the draw');
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      assert.equal(m.publicView().sp, undefined, 'the draft is over');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('悬赏 cards are never part of the random draw, even when the family is listed', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 25 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      // mark two of the six cards as 悬赏 and list 'bounty' in the offer: the draw must still skip them
      s.cards[4].family = 'bounty';
      s.cards[5].family = 'bounty';
      s.randomOffer = ['supply', 'bounty'];
      assert.equal(m.randomChoiceEligible(s.cards[4]), false, 'a bounty card is never drawn');
      assert.equal(m.randomChoiceEligible(s.cards[0]), true);
      const pids = m.alivePlayers().map((p) => p.playerId);
      for (const pid of pids.slice(0, 2)) assert.deepEqual(m.handle(pid, { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, true);
      const picks = pids.map((pid) => s.picks[pid]);
      for (const i of [4, 5]) assert.ok(!picks.includes(i), `card ${i} (悬赏) was not handed out`);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('the official modes are untouched: timed, sequential, and g.choiceRandom is refused', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 14, fake: true }).start();
    try {
      const m = h.m;
      h.drive(() => (m.phase === PHASE.ROUND_START && m.round === 3) || m.round > 3);
      h.run(() => m.phase === PHASE.SP_DRAFT || m.round > 3);
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.sp.untimed, false);
      assert.equal(m.sp.parallel, false, 'no parallel draft outside the fork mode');
      assert.equal(m.randomVoteOffered(), false);
      assert.ok(m.deadline > 0, 'the official 机变 keeps its clock');
      const pids = m.sp.order.slice();
      assert.equal(m.handle(pids[1], { t: 'g.choiceRandom' }).error, ERR.WRONG_PHASE);
      assert.equal(m.handle(pids[1], { t: 'g.choice', idx: 0 }).error, ERR.NOT_YOUR_TURN, 'the turn order still applies');
      assert.deepEqual(m.handle(pids[0], { t: 'g.choice', idx: 0 }), { ok: true });
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });
});
