# FORK.md — the fork's own layer

This repository is a fork of [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)
(itself an unofficial fan remake of Arknights' 「卫戍协议：盟约」). Upstream is built to *reproduce* the official
game: every number in `data/*.json` is derived from the official client tables by `tools/build-data.mjs`, and the
project's own docs state that there is no custom balance (see the header of `server/match/gamedata.js`).

A fork that wants to **add** something the official game never shipped therefore cannot just edit the data files.
This document is the contract for how it does it.

## The rule

> Generated data is never hand-edited. A fork change to generated data lives in `tools/fork-overrides.mjs` and is
> applied by `node tools/fork-data.mjs`.

- `tools/fork-overrides.mjs` — one pure, **idempotent** function, `applyForkOverrides(config)`, holding every
  fork-only value in the generated config. It never mutates its input, returns the input unchanged when the data it
  needs is absent, and applying it twice yields the same object.
- `node tools/fork-data.mjs` — applies it to the committed `data/config.json` in place (atomic write, compact JSON
  exactly like the build pipeline). `--check` exits 1 when the file is stale (for CI).
- `tools/build-data.mjs` calls `applyForkOverrides()` on the freshly built config **before writing**, so a full
  `npm run build-data` (or a CI rebuild that reproduces `data/` byte-for-byte) keeps the fork's changes instead of
  dropping them.
- `test/fork-data.test.js` is the drift guard: it asserts `applyForkOverrides(require(data/config.json))` deep-equals
  the committed file, so a regeneration without the override, a hand-edit, or an edit to `data/config.json` instead of
  the override module all fail the suite with a one-line fix (`node tools/fork-data.mjs`).

Why not regenerate the whole of `data/` in every fork PR: the pipeline re-encodes ~6 MB of untouched data, which
makes a one-line fork change unreviewable. Why not patch at runtime (on load, in `server/data.js`): the browser reads
the same `data/config.json` over HTTP, so the file itself must carry the value.

## Running it

```bash
node tools/fork-data.mjs           # apply the overrides to data/config.json (idempotent)
node tools/fork-data.mjs --check   # exit 1 when data/config.json is stale
node --test test/fork-data.test.js # the drift guard
```

## 终极模拟 — the fork's third room mode

`终极模拟` is the official game's third 模拟方式 (alongside 独立模拟 and 同盟模拟) but upstream only models the first
two: a room is `solo` or `coop` and the mode id is `mode_{single|multi}_{difficulty}`. The fork adds it as a real
third room mode.

| | 独立模拟 `solo` | 同盟模拟 `coop` | 终极模拟 `ultimate` |
|---|---|---|---|
| seats | 1 | 4 (`MAX_SEATS`) | 6 (`ULTIMATE_SEATS`) |
| difficulty | picker (AC-1…AC-4) | picker (AC-1…AC-4) | fixed AC-4 (`ULTIMATE_DIFFICULTY`) |
| mode id | `mode_single_*` | `mode_multi_*` | `mode_ultimate_abyss` |
| data record | official | official | fork (`tools/fork-overrides.mjs`) |

Where it is wired in:

- `shared/constants.js` — `ULTIMATE_SEATS = 6`, `ROOM_MODES`, `SEATS_BY_MODE`, `roomSeatCap(roomMode)`,
  `ULTIMATE_DIFFICULTY = 'ABYSS'`, and `modeIdFor()`'s `MODE_TYPE` table (`ultimate → 'ultimate'`). `MAX_SEATS = 4`
  keeps its old meaning for every pre-existing room.
- `shared/protocol.js` — `room.create.mode` accepts `ROOM_MODES`; the `room.removeBot` / `room.kick` seat indexes are
  validated against `ULTIMATE_SEATS - 1` (the lobby refuses a seat its own room does not have).
- `server/lobby.js` — `Room` allocates `roomSeatCap(mode)` seats and `create()` forces
  `ULTIMATE_DIFFICULTY` for an `ultimate` room; `setDifficulty` refuses another value there.
- `server/match/Match.js` — `this.roomMode` keeps the third value (`'solo' | 'coop' | 'ultimate'`) while `this.mode`
  stays the two-valued *behaviour* switch, so 终极模拟 plays with the co-op rules (联防, pairing, merged LP).
- `public/js/screens/lobby.js` — the third mode card and the single-difficulty rendering (`MODE_CARDS`,
  `difficultyInfo`, `effDifficulty`).
- `public/js/screens/room.js` — `normalizeSeats()` pads to `roomSeatCap(room.mode)`; the difficulty picker is
  replaced by a fixed tag.
- `tools/fork-overrides.mjs` — the `mode_ultimate_abyss` record (a copy of the AC-4 co-op mode plus the fork's own
  fields).

What the fork mode deliberately starts as: **an exact copy of AC-4 co-op**, so the room is playable the moment it
exists. The fork's per-mode rules land on top of it one change at a time, each one extending
`tools/fork-overrides.mjs` and its own test file:
- **二.1 盟约不会被禁用** — the mode carries `bans: { core: 0, addon: 0 }` and `GameData.bans()` prefers a mode's own
  table over the difficulty's one (`config.bans`, ABYSS = 3 core + 4 add-on). Without it the seeded per-match draw of
  `server/match/pool.js` removes up to 7 盟约 and takes every 干员 whose whole bond list they cover out of the shop
  for the run. `test/fork-ultimate-bans.test.js`.

## Fork change log

| Change | What it does | Where |
|---|---|---|
| 终极模拟 room | the third room mode, six seats, fixed AC-4, `mode_ultimate_abyss` | as listed above |
| 二.1 盟约不禁用 | the mode draws 0 bond bans (`bans: { core: 0, addon: 0 }`) and its card says 盟约与干员全部解锁 | `tools/fork-overrides.mjs`, `server/match/gamedata.js` (`bans()`), `test/fork-ultimate-bans.test.js` |
