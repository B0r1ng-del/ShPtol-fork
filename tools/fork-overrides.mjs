// tools/fork-overrides.mjs — the fork's own data layer over the generated `data/*.json`.
//
// WHY THIS FILE EXISTS. `data/config.json` is a build product: tools/build-data.mjs `buildConfig()` (build-data.mjs:
// 2927-2993) derives every `modes[modeId]` entry from the official client tables (`act.modeDataDict` /
// `battleDataDict` / `shopLevelDataDict`, decoded from the game's activity data) — a fork cannot add a mode the game
// never shipped by editing that generator alone, and hand-editing `data/config.json` would be erased by the next
// `npm run build-data`. So the fork keeps its additions HERE, as one explicit, reviewable, pure function:
//
//   * `applyForkOverrides(config)` returns a NEW config object with the fork's modes/fields applied. It never mutates
//     its input and is IDEMPOTENT — applying it to an already-overridden config yields the same object, which is what
//     `test/fork-data.test.js` asserts against the committed `data/config.json` (drift guard).
//   * tools/build-data.mjs calls it on the freshly built config before writing (so a full regeneration keeps it), and
//     `node tools/fork-data.mjs` applies it to the committed `data/config.json` in place (the small, reviewable diff).
//
// Every fork feature that lives in generated data lands here, one block per feature, each with the reason it exists:
//   * `bans: { core: 0, addon: 0 }` on the 终极模拟 mode — no per-match bond ban there (requirement 二.1)

/** modeId of the fork's third room mode (终极模拟, AC-4, up to six 博士). */
export const FORK_MODE_ID = 'mode_ultimate_abyss';
/** The official mode every fork field of `FORK_MODE_ID` is derived from (identical rules, difficulty ABYSS). */
export const FORK_BASE_MODE_ID = 'mode_multi_abyss';

/** Structured deep copy of plain JSON (the override owns its records; nothing is shared with the input). */
function cloneJson(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneJson);
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = cloneJson(x);
  return out;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The fork's 终极模拟 mode record: the AC-4 co-op mode (`FORK_BASE_MODE_ID`) under a modeId and a name of its own.
 *
 * It is a copy of the official AC-4 room — same rounds, shop, enemy table, bond set, stages and boss weights — so the
 * mode is playable the moment it exists; the fork's per-mode rules (no bond bans, the shop-slot table, the enemy stat
 * adjustments, the voting 机变) are added on top by their own changes and land here.
 *
 * `type: 'MULTI'` is deliberate: 终极模拟 is a multiplayer room, and every `type` reader (GameData.isSolo,
 * build-data's inScope / bossHpScale / prepTime branches, the client) must treat it like 同盟模拟, never like a solo
 * run. `difficulty: 'ABYSS'` keeps the difficulty-keyed lookups (bans, bloodPointAbyss, the mode's own enemyScale)
 * on the AC-4 table, which is the baseline the fork's numbers are defined against.
 *
 * @param {Record<string, any>} modes `config.modes`
 * @returns {object | null} the record, or null when the base mode is missing (partial data → no-op)
 */
export function forkUltimateMode(modes) {
  const base = isPlainObject(modes) ? modes[FORK_BASE_MODE_ID] : null;
  if (!isPlainObject(base)) return null;
  return {
    ...cloneJson(base),
    modeId: FORK_MODE_ID,
    name: '终极模拟',
    code: 'AC-4',
    sortId: 6,
    type: 'MULTI',
    difficulty: 'ABYSS',
    inScope: true,
    desc: '敌方攻击强度到达极限的模拟训练',
    // The mode's own bond table (requirement 二.1 "此模式下所有盟约不会被禁用"): 0 core + 0 add-on banned.
    // `config.bans` is difficulty-keyed (ABYSS = 3 + 4), so the per-match draw that removes 干员 from the shop has
    // to be switched off by the mode itself — GameData.bans() prefers this record over the difficulty's (see the
    // comment there). `activeBondIds` already lists all 23 bonds and `inactiveBondIds` is empty, so with no draw
    // every 盟约 stays in play.
    bans: { core: 0, addon: 0 },
    // …and it says so on the difficulty card, like the official 终极模拟 ("盟约与干员全部解锁").
    effectDescList: ['·盟约与干员全部解锁', '·第 4 回合起敌人强度提升', '·作战环境无比困难', '·出现极度危险的敌人'],
    // 局内商店升级规则 (requirement 二.2): every operator level adds one 干员购买槽位 (3→4→5→6→7); the LAST one adds a
    // second 道具购买槽位 instead. The official AC-4 table is {3,4,4,5,5,5} with ONE item slot throughout, so the top
    // operator level is 7 slots — two more than AC-4's 5 — and level 6 carries two item slots.
    // GameData.shopSlots(level) reads this table (clamping to chess ≤ 8, item ≤ 4) and PlayerState.rollShop lays the
    // slots out from it (`shop.layout = { chess, item }`), so nothing but these numbers changes.
    shopSlots: {
      1: { chess: 3, item: 1 },
      2: { chess: 4, item: 1 },
      3: { chess: 5, item: 1 },
      4: { chess: 6, item: 1 },
      5: { chess: 7, item: 1 },
      6: { chess: 7, item: 2 },
    },
    // 敌人属性调整 (requirement 二.3), from round 4 on, on top of the AC-4 table:
    //   * ordinary enemies — never the leader, never the hidden core, never one of their 部位/parts: +10 % HP only;
    //   * the 最终攻势 leader: +20 % HP, +20 % DEF, +8 % ATK;
    //   * the 隐秘核心: +35 % HP, +35 % DEF, +16 % ATK.
    // Every value is a multiplier (1.2 = +20 %). GameData.enemyExtras(r) hands the ordinary HP bonus and the leader /
    // hidden-core ATK + DEF to server/match/waves.js per spawn, and GameData.bossHpExtra(bossId) applies the HP part
    // PER BOSS: a leader's HP is the shared pool and the pool is `boss.bloodPoint[difficulty]`, so the 1.20 lands on
    // boss_1…boss_7 and the 1.35 on boss_8…boss_10 separately (a hidden core is a boss id of `hiddenBossWeights`) —
    // "领袖和隐秘核心分开计算", never one blanket multiplier over the pool. DEF is an additive percentage on the
    // enemy's own DEF (`def × (1 + pct)`), i.e. the `defMul` spawn mod Battle.js already supports.
    enemyAdjust: {
      fromRound: 4,
      normal: { hp: 1.1 },
      leader: { hp: 1.2, def: 1.2, atk: 1.08 },
      hidden: { hp: 1.35, def: 1.35, atk: 1.16 },
    },
    // 机变阶段改造 (requirement 二.4): the draft has NO time limit, every alive player picks at the same time instead
    // of waiting for a turn, and any player may vote for a random allocation instead of picking. As soon as HALF of the
    // alive players have voted (votes × 2 ≥ alive) the system hands the cards out at random — one per alive player,
    // over their own pick — and the round moves on.
    //   * UNTIMED — "移除原有的时间限制"; the draft ends when every alive player has picked or voted.
    //   * PARALLEL — the sequential turn order (spFirst 30 s / spTurn 16 s) would be pointless without a clock: with
    //     no timer, waiting on one player at a time could stall the round forever, so everyone decides at once.
    //   * randomVote.families — the card families the random draw may hand out. 悬赏 (bounty) is deliberately NOT
    //     listed: "悬赏类不要添加随机机制" — its card adds its enemies to the PICKER's own next battles, so handing it
    //     to somebody else would break the attribution. In a 悬赏决策 draft the vote button is simply not offered.
    // Below half the votes each player keeps the card they picked; a player who only voted and lost the vote takes
    // nothing this round (the phase still ends).
    spDraft: {
      untimed: true,
      parallel: true,
      randomVote: { families: ['supply', 'shop', 'tactic'] },
    },
  };
}

/**
 * Apply every fork override to a config object. Pure and idempotent; returns the input unchanged when the data it
 * needs is absent (a partial data set must still yield a working server).
 * @param {Record<string, any>} config `data/config.json`
 * @returns {Record<string, any>} a new config (or the input when nothing applies)
 */
export function applyForkOverrides(config) {
  if (!isPlainObject(config)) return config;
  const modes = isPlainObject(config.modes) ? config.modes : null;
  if (!modes) return config;
  const mode = forkUltimateMode(modes);
  if (!mode) return config;
  return { ...config, modes: { ...modes, [FORK_MODE_ID]: mode } };
}

/**
 * The fork's own `data/choices.json` layer: the 机变 draft schedule of the fork mode.
 *
 * `choices.schedule` is keyed by modeId (`schedule[modeId].rounds[r].families`, read by
 * `server/match/choices.js:100-106 scheduleFor`), and the official data naturally has no entry for a mode that never
 * shipped. Without this copy the fork mode falls back to a plain 道具补给 draft every 机变 round: it would no longer be
 * "以 AC-4 为基础", and 悬赏决策 drafts would never appear at all (AC-4 R3/R9 are 100 % 悬赏, R11 mostly) — which would
 * also make 二.4's "悬赏类不要添加随机机制" unreachable in real play. The fork therefore copies the AC-4 schedule onto
 * its own modeId, so the mode drafts exactly like AC-4 and the vote is offered exactly where AC-4 offers a non-悬赏
 * family.
 *
 * Pure and idempotent like applyForkOverrides.
 * @param {Record<string, any>} choices `data/choices.json`
 * @returns {Record<string, any>} a new object (or the input when the data it needs is absent)
 */
export function applyForkChoices(choices) {
  if (!isPlainObject(choices)) return choices;
  const schedule = isPlainObject(choices.schedule) ? choices.schedule : null;
  if (!schedule) return choices;
  // always rebuilt from the BASE mode, never from an existing fork entry: a hand-edit of the fork's own schedule is
  // then reverted by the applier and caught by test/fork-data.test.js (the same reason applyForkOverrides overwrites)
  const base = schedule[FORK_BASE_MODE_ID];
  if (!isPlainObject(base)) return choices;
  return { ...choices, schedule: { ...schedule, [FORK_MODE_ID]: cloneJson(base) } };
}
