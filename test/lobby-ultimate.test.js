// test/lobby-ultimate.test.js — 终极模拟, the fork's THIRD room mode (shared/constants.js ROOM_MODES / ULTIMATE_SEATS):
// a room of up to six 博士 that runs the AC-4 table, created with `room.create {mode: 'ultimate'}`.
//
// What this suite pins down:
//   * the protocol accepts the third mode and a seat index up to 6, and still refuses anything beyond it;
//   * an ultimate room has SIX seat slots and always runs ABYSS (the client's difficulty pick is forced server-side);
//   * the pre-existing modes are untouched: a coop room still has exactly MAX_SEATS (4) slots and its own difficulty
//     picker keeps working.
// The mode's own content (its config record, bond bans, shop slots, enemy scaling, the 机变 vote) is covered by the
// suites of its own changes; this one is only about the room model.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, MAX_SEATS, ULTIMATE_SEATS, ULTIMATE_DIFFICULTY, ROOM_MODES, roomSeatCap, modeIdFor } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const occupied = (state) => state.seats.filter(Boolean);
/** Create a room of `mode`/`difficulty` and resolve with the creator's room.state. */
async function createRoom(c, mode, difficulty) {
  await ok(c, { t: 'room.create', mode, difficulty });
  const st = await c.waitFor('room.state', (s) => s.hostId === c.id);
  return st;
}

describe('终极模拟 rooms (6 seats, AC-4)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: StubMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('constants: the three room modes and their caps; MAX_SEATS keeps its old meaning', () => {
    assert.deepEqual([...ROOM_MODES], ['solo', 'coop', 'ultimate']);
    assert.equal(roomSeatCap('solo'), 1);
    assert.equal(roomSeatCap('coop'), MAX_SEATS);
    assert.equal(roomSeatCap('ultimate'), ULTIMATE_SEATS);
    assert.equal(ULTIMATE_SEATS, 6);
    assert.equal(roomSeatCap('nope'), MAX_SEATS, 'unknown mode: the pre-fork cap');
    assert.equal(modeIdFor('ultimate', 'ABYSS'), 'mode_ultimate_abyss');
    assert.equal(modeIdFor('coop', 'ABYSS'), 'mode_multi_abyss', 'the existing ids are unchanged');
    assert.equal(modeIdFor('solo', 'HARD'), 'mode_single_hard');
  });

  test('protocol: mode ultimate is accepted, an unknown mode is not; a seat index runs to 6 and stops there', () => {
    assert.equal(validateC2S({ t: 'room.create', mode: 'ultimate', difficulty: 'ABYSS' }), null);
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'ABYSS' }), null);
    assert.notEqual(validateC2S({ t: 'room.create', mode: 'ultimate2', difficulty: 'ABYSS' }), null);
    assert.notEqual(validateC2S({ t: 'room.create', mode: 'MULTI', difficulty: 'ABYSS' }), null);
    for (const t of ['room.removeBot', 'room.kick']) {
      const msg = (seat) => (t === 'room.kick' ? { t, seat, playerId: 'p_0123456789' } : { t, seat });
      for (let seat = 0; seat <= ULTIMATE_SEATS - 1; seat++) assert.equal(validateC2S(msg(seat)), null, `${t} seat ${seat}`);
      assert.notEqual(validateC2S(msg(ULTIMATE_SEATS)), null, `${t} seat ${ULTIMATE_SEATS} is out of range`);
      assert.notEqual(validateC2S(msg(-1)), null, `${t} seat -1`);
    }
  });

  test('an ultimate room has six seats and always runs ABYSS, whatever difficulty the creator sent', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host, 'ultimate', 'HARD');
    assert.equal(st.mode, 'ultimate');
    assert.equal(st.difficulty, ULTIMATE_DIFFICULTY, 'the client cannot pick another difficulty');
    assert.equal(st.seats.length, ULTIMATE_SEATS);
    assert.equal(occupied(st).length, 1);
    assert.equal(st.seats[0].playerId, host.id);
  });

  test('six seats fill up; the seventh join is ROOM_FULL', async () => {
    const host = await pool.player('Host');
    let st = await createRoom(host, 'ultimate', 'ABYSS');
    for (let i = 1; i < ULTIMATE_SEATS; i++) {
      await ok(host, { t: 'room.addBot' });
      st = await host.waitFor('room.state', (s) => occupied(s).length === i + 1);
    }
    assert.equal(occupied(st).length, 6);
    assert.equal(st.seats.length, 6);
    assert.deepEqual(st.seats.map((s) => (s ? s.seat : null)), [0, 1, 2, 3, 4, 5]);
    assert.equal(st.seats.filter((s) => s?.isBot).length, 5);
    const late = await pool.player('Late');
    await err(late, { t: 'room.join', code: st.code }, ERR.ROOM_FULL);
    // a bot on the last seat can be removed again (seat 5 is only valid because ULTIMATE_SEATS > MAX_SEATS)
    await ok(host, { t: 'room.removeBot', seat: 5 });
    const freed = await host.waitFor('room.state', (s) => s.seats[5] === null);
    assert.equal(occupied(freed).length, 5);
    await ok(late, { t: 'room.join', code: st.code });
    const joined = await late.waitFor('room.state', (s) => s.code === st.code && !!s.seats[5] && s.seats[5].playerId === late.id);
    assert.equal(joined.seats[5].seat, 5, 'the newcomer takes the highest free seat');
  });

  test('six humans join the same room, seat order by arrival', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host, 'ultimate', 'ABYSS');
    const guests = [];
    for (let i = 1; i < ULTIMATE_SEATS; i++) {
      const g = await pool.player(`Guest${i}`);
      await ok(g, { t: 'room.join', code: st.code });
      await g.waitFor('room.state', (s) => !!s.seats[i] && s.seats[i].playerId === g.id);
      guests.push(g);
    }
    const all = await host.waitFor('room.state', (s) => occupied(s).length === ULTIMATE_SEATS);
    assert.deepEqual(occupied(all).map((s) => s.seat), [0, 1, 2, 3, 4, 5]);
    assert.equal(new Set(occupied(all).map((s) => s.playerId)).size, 6, 'six distinct 博士');
  });

  test('the room difficulty is fixed: setDifficulty refuses another value and accepts ABYSS', async () => {
    const host = await pool.player('Host');
    await createRoom(host, 'ultimate', 'ABYSS');
    await err(host, { t: 'room.setDifficulty', difficulty: 'HARD' }, ERR.BAD_MSG);
    await err(host, { t: 'room.setDifficulty', difficulty: 'FUNNY' }, ERR.BAD_MSG);
    // the room's own value is a no-op OK (like re-picking the current difficulty anywhere else)
    await ok(host, { t: 'room.setDifficulty', difficulty: 'ABYSS' });
    await host.expectNone('room.state', (s) => s.difficulty !== 'ABYSS', 120);
  });

  test('a six-player ultimate match starts and is handed the AC-4 fork mode id', async () => {
    const started = [];
    class CapturingMatch extends StubMatch {
      constructor(opts) { super(opts); started.push(opts); }
    }
    const srv2 = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: CapturingMatch, lobbyGraceMs: 60_000 });
    const c = await TestClient.connect(`ws://127.0.0.1:${srv2.port}/ws`);
    try {
      const w = await c.hello('Host');
      c.id = w.playerId;
      await ok(c, { t: 'room.create', mode: 'ultimate', difficulty: 'ABYSS' });
      await c.waitFor('room.state', (s) => s.hostId === c.id);
      for (let i = 1; i < ULTIMATE_SEATS; i++) await ok(c, { t: 'room.addBot' });
      await c.waitFor('room.state', (s) => s.seats.filter(Boolean).length === ULTIMATE_SEATS);
      await ok(c, { t: 'room.start' });
      await c.waitFor('room.state', (s) => s.inMatch === true);
      assert.equal(started.length, 1);
      assert.equal(started[0].mode, 'ultimate');
      assert.equal(started[0].modeId, 'mode_ultimate_abyss');
      assert.equal(started[0].difficulty, 'ABYSS');
      assert.equal(started[0].seats.length, ULTIMATE_SEATS, 'every seat reaches the match');
    } finally {
      await c.terminate().catch(() => {});
      await srv2.close();
    }
  });

  test('the pre-existing modes are untouched: coop still has MAX_SEATS seats and its own difficulty picker', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host, 'coop', 'FUNNY');
    assert.equal(st.mode, 'coop');
    assert.equal(st.difficulty, 'FUNNY');
    assert.equal(st.seats.length, MAX_SEATS);
    for (let i = 1; i < MAX_SEATS; i++) {
      await ok(host, { t: 'room.addBot' });
      await host.waitFor('room.state', (s) => occupied(s).length === i + 1);
    }
    await err(host, { t: 'room.addBot' }, ERR.ROOM_FULL, 'a coop room never grows a fifth seat');
    await ok(host, { t: 'room.setDifficulty', difficulty: 'HARD' });
    const changed = await host.waitFor('room.state', (s) => s.difficulty === 'HARD');
    assert.equal(changed.seats.length, MAX_SEATS);
    await err(host, { t: 'room.removeBot', seat: MAX_SEATS }, ERR.BAD_TARGET, 'seat 4 does not exist in a coop room');
  });

  test('solo is still a single seat and refuses AI teammates', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host, 'solo', 'FUNNY');
    assert.equal(st.seats.length, 1);
    await err(host, { t: 'room.addBot' }, ERR.ROOM_FULL);
  });
});
