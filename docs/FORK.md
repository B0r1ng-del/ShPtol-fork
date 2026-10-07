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
- **二.2 局内商店升级** — the mode carries its own `shopSlots` table: every operator level adds one 干员购买槽位
  (3 → 4 → 5 → 6 → 7) and the last one adds a second 道具购买槽位 instead
  (`{1:{3,1}, 2:{4,1}, 3:{5,1}, 4:{6,1}, 5:{7,1}, 6:{7,2}}`; official AC-4 is `{3,4,4,5,5,5}` with one item slot
  throughout). `GameData.shopSlots()` already reads the record and clamps to `chess ≤ 8 / item ≤ 4`, and
  `PlayerState.rollShop()` lays the slots out from it, so only the numbers change — but the bar is 17.6rem wide at
  level 6 instead of 12.7rem (measured in Chromium at 1920×1080, 1440×810, 1280×720, 1024×576 and 844×390: it still
  fits every viewport). `test/fork-ultimate-shop.test.js`.
- **二.3 敌人属性调整** — the mode carries `enemyAdjust: { fromRound: 4, normal: { hp: 1.1 }, leader: { hp: 1.2, def: 1.2,
  atk: 1.08 }, hidden: { hp: 1.35, def: 1.35, atk: 1.16 } }` (R4 on). `GameData.enemyExtras(r)` splits it by spawn
  class and `server/match/waves.js` folds it into the spawn mods: the ordinary +10 % HP goes on the non-leader branch
  only (so never on the leader, and never on a 部位/`isPart`), while the leader's / hidden core's ATK and DEF land on
  the leader branch as `atkMul` × factor and a `defMul` that is **only added when it is not 1** — an official spawn
  spec is therefore byte-identical to before. `defMul` is the spawn mod `server/sim/Battle.js:807-812` already
  supports, and `def × (1 + pct)` is exactly the additive reading of "防御 +20 %" in the damage formula
  (`server/sim/damage.js:12`). The HP part is **per boss id**: `GameData.bossHpExtra(bossId)` looks a hidden core up in
  `mode.hiddenBossWeights` (boss_8…boss_10 ⇒ ×1.35) and treats everything else as a 最终攻势 leader (boss_1…boss_7 ⇒
  ×1.20), and `bossPoolHp()` (both `GameData` and `server/match/finalAssault.js`) multiplies that boss's OWN
  `bloodPoint[difficulty]` — so the two classes are computed separately and neither can move the other's pool.
  Boss-owned runtime summons (`server/sim/content/bosses.js` `summon.hp_ratio`) never come from `enemyScale` and so
  stay outside all of it. `test/fork-ultimate-enemy-stats.test.js`.
- **二.4 机变阶段改造** — the mode carries `spDraft: { untimed: true, parallel: true, randomVote: { families: ['supply',
  'shop', 'tactic'] } }`. `GameData.spDraftRules` normalises it (all off without the block), `Match.enterSpDraft` turns
  the draft untimed and parallel, and `Match.voteRandomChoice` (the `g.choiceRandom` intent, `Match.js` SP_DRAFT
  section) tallies votes: `votes × 2 ≥ alive` resolves the draft by `resolveRandomChoice`, which shuffles the
  random-eligible cards and the alive players and hands one card to each — over their own pick, which is the point of
  the vote; below half every player keeps the card it picked, and a voter who picked nothing takes nothing. UNTIMED
  ("移除原有的时间限制") means the phase ends when every alive player has picked or voted; PARALLEL replaces the
  sequential turn order, because without a clock waiting on one player at a time could stall the round forever
  (`g.choice` from any player, `spTurn()` = the first player still to act, the AI seats schedule themselves). 悬赏 cards
  are never drawn (`randomChoiceEligible` refuses `family === 'bounty'`) and in a 悬赏决策 draft the vote is not offered
  at all — "悬赏类不要添加随机机制" (a bounty adds its enemies to the PICKER's own next battles, so handing it to
  somebody else would break the attribution). The draft's `randomOffer` in `m.public` is non-null exactly when the vote
  is offered for that draft, so `public/js/ui/choiceOverlay.js` renders the 随机分配 button on the frame alone.
  `server/match/audit.js` accepts a player ending after only a lost vote. `test/fork-ultimate-sp-vote.test.js`.
- **二.4 also needed a 机变 schedule** — `choices.schedule` is keyed by modeId and the official data has no entry for a
  mode that never shipped, so without one the fork mode fell back to a plain 道具补给 draft every round (no 悬赏 at all,
  and the vote would have had nothing to gate). `applyForkChoices()` in `tools/fork-overrides.mjs` copies AC-4's
  schedule onto the fork modeId in `data/choices.json`; `tools/fork-data.mjs` and `tools/build-data.mjs` apply it like
  the config layer, and `test/fork-data.test.js` guards it with the same idempotence check.

## Fork change log

| Change | What it does | Where |
|---|---|---|
| 终极模拟 room | the third room mode, six seats, fixed AC-4, `mode_ultimate_abyss` | as listed above |
| 二.1 盟约不禁用 | the mode draws 0 bond bans (`bans: { core: 0, addon: 0 }`) and its card says 盟约与干员全部解锁 | `tools/fork-overrides.mjs`, `server/match/gamedata.js` (`bans()`), `test/fork-ultimate-bans.test.js` |
| 二.2 商店升级槽位 | one 干员槽 per operator level (3→7) and a second 道具槽 at level 6 | `tools/fork-overrides.mjs` (`shopSlots`), `test/fork-ultimate-shop.test.js` |
| 二.3 敌人属性调整 | R4 on: ordinary +10 % HP; leader +20 % HP/+20 % DEF/+8 % ATK; hidden core +35 % HP/+35 % DEF/+16 % ATK — HP per boss id | `tools/fork-overrides.mjs` (`enemyAdjust`), `server/match/gamedata.js` (`enemyExtras`/`bossHpExtra`), `server/match/waves.js`, `server/match/finalAssault.js`, `test/fork-ultimate-enemy-stats.test.js` |
| 二.4 机变去时限 + 投票 | untimed, parallel draft with a 随机分配 vote (half the alive players resolves it randomly, one card each; 悬赏 never drawn and never voted on) + the AC-4 机变 schedule for the fork mode | `tools/fork-overrides.mjs` (`spDraft`, `applyForkChoices`), `server/match/Match.js` (SP_DRAFT), `server/match/gamedata.js` (`spDraftRules`), `shared/protocol.js` (`g.choiceRandom`), `server/match/audit.js`, `public/js/ui/choiceOverlay.js`, `public/js/ui/gameLogic.js`, `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `test/fork-ultimate-sp-vote.test.js` |
