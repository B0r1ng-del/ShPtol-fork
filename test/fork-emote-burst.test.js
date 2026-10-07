// test/fork-emote-burst.test.js — requirement 二.5 「一键十连」(EVERY mode, not only 终极模拟).
//
// The switch itself is per device (`public/js/ui/emotes.js` PREF_TEN_PULL) and lives in the emote panel; what the server
// owns is the message it sends: `g.emoteBurst { id }` broadcasts the SAME emote `EMOTE_BURST_COUNT` times, so one tap
// shows ten arrivals. The burst shares the single-send cooldown — it is one send, not ten — so ten quick taps can never
// flood a room, and `g.emote` itself is untouched (an official-mode client never sends or sees anything new).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ERR, EMOTE_BURST_COUNT, EMOTE_COOLDOWN_MS, EMOTES } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { makeMatch } from './match/harness.js';

const EMOTE_ID = EMOTES[0]; // 'autochess_battle_happy'
const emotes = (h, pid = null) => h.bc.filter((m) => m.t === 'm.emote' && (pid == null || m.playerId === pid));

describe('二.5 — 一键十连 (g.emoteBurst, every mode)', () => {
  test('the catalogue knows g.emoteBurst and still validates the id', () => {
    assert.equal(EMOTE_BURST_COUNT, 10);
    assert.equal(validateC2S({ t: 'g.emoteBurst', id: EMOTE_ID }), null);
    assert.equal(validateC2S({ t: 'g.emote', id: EMOTE_ID }), null, 'the single send is unchanged');
    assert.notEqual(validateC2S({ t: 'g.emoteBurst', id: 'nope' }), null, 'an unknown emote stays BAD_MSG');
    assert.notEqual(validateC2S({ t: 'g.emoteBurst' }), null, 'the id is required');
    assert.notEqual(validateC2S({ t: 'g.emoteBurstX', id: EMOTE_ID }), null, 'an unknown message stays BAD_MSG');
  });

  test('one g.emoteBurst broadcasts the same emote ten times; one g.emote still broadcasts exactly one', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 1, fake: true }).start();
    try {
      const m = h.m;
      assert.deepEqual(m.handle('p_0', { t: 'g.emoteBurst', id: EMOTE_ID }), { ok: true });
      const burst = emotes(h, 'p_0');
      assert.equal(burst.length, EMOTE_BURST_COUNT, 'ten frames');
      assert.ok(burst.every((f) => f.id === EMOTE_ID), 'all of them the emote that was tapped');
      assert.ok(burst.every((f) => f.playerId === 'p_0'), 'credited to the sender');
      // a burst is ONE send: the cooldown is charged once, so every later send inside it is refused
      assert.equal(m.handle('p_0', { t: 'g.emoteBurst', id: EMOTE_ID }).error, ERR.RATE);
      assert.equal(m.handle('p_0', { t: 'g.emote', id: EMOTE_ID }).error, ERR.RATE, 'the cooldown is shared');
      assert.equal(emotes(h, 'p_0').length, EMOTE_BURST_COUNT, 'nothing extra got out');
      // another player is unaffected
      assert.deepEqual(m.handle('p_1', { t: 'g.emote', id: EMOTE_ID }), { ok: true });
      assert.equal(emotes(h, 'p_1').length, 1, 'the single send is a single frame');
      // and after the cooldown the burst works again
      h.sched.advance(EMOTE_COOLDOWN_MS + 1);
      assert.deepEqual(m.handle('p_0', { t: 'g.emoteBurst', id: EMOTE_ID }), { ok: true });
      assert.equal(emotes(h, 'p_0').length, 2 * EMOTE_BURST_COUNT);
    } finally {
      h.m.dispose();
    }
  });

  test('an unknown emote id is refused without sending anything, in every phase-independent path', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 2, fake: true }).start();
    try {
      const m = h.m;
      assert.equal(m.handle('p_0', { t: 'g.emoteBurst', id: 'nope' }).error, ERR.BAD_MSG);
      assert.equal(m.handle('p_0', { t: 'g.emote', id: 'nope' }).error, ERR.BAD_MSG);
      assert.equal(emotes(h).length, 0, 'nothing was broadcast');
      // neither call charged the cooldown: a valid send still goes through
      assert.deepEqual(m.handle('p_0', { t: 'g.emoteBurst', id: EMOTE_ID }), { ok: true });
      assert.equal(emotes(h, 'p_0').length, EMOTE_BURST_COUNT);
    } finally {
      h.m.dispose();
    }
  });

  test('the burst is a fork feature of EVERY mode — a 终极模拟 room and a solo room behave the same', () => {
    for (const [mode, difficulty, seed] of [['ultimate', 'ABYSS', 3], ['solo', 'NORMAL', 4]]) {
      const h = makeMatch({ mode, difficulty, humans: 0, bots: 0, seats: [{ seat: 0, playerId: 'me', name: 'Me', isBot: false, connected: true }], seed, fake: true }).start();
      try {
        assert.deepEqual(h.m.handle('me', { t: 'g.emoteBurst', id: EMOTE_ID }), { ok: true }, mode);
        assert.equal(emotes(h, 'me').length, EMOTE_BURST_COUNT, mode);
      } finally {
        h.m.dispose();
      }
    }
  });
});
