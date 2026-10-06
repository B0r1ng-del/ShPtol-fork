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
// Every fork feature that lives in generated data lands here, one block per feature, each with the reason it exists.

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
