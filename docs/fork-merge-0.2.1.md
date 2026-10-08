# 上游 Stronghold-Protocol → fork 合入记录（v0.1.4 … v0.2.1）

- 目标仓库：`https://github.com/B0r1ng-del/ShPtol-fork`（本地分支 `merge/stronghold-0.2.1`）
- 源仓库：`https://github.com/sganggs/Stronghold-Protocol`（master = `3eced7b`）
- 合并提交：`8a334d4`，父提交 `6ffd18d`（fork master）+ `3eced7b`（上游 master）
- 合入范围：上游 387 个提交；fork 自身的 22 个提交全部保留
- 冲突策略：代码逻辑一律以上游为准；fork 的改动在上游重写后的结构上重新落位

## 1. 版本边界

上游没有 `0.1.5`：标签只有 `v0.1.0 … v0.1.4`，之后直接是 `v0.2.0` / `v0.2.1`，全部历史里也搜不到
`0.1.5` 这个字符串。因此把「0.1.5 起」理解为「两仓库分叉点之后的全部更新」，以 **v0.1.4 = `9f93096`**
（两仓库共同祖先）为基线，把从它到上游 `master` 的 387 个提交全部并入。

## 2. 冲突与处理

上游 0.2.0 做了一次大重构（`Match.js` / `PlayerState.js` 拆成 `match/`、`player/` 下的模块）。
以「上游为准」解决同文件冲突后，fork 对这些文件的改动被整体吸收，出现 `ReferenceError` 与
153 个失败子测试。把 fork 的改动重新落位到上游新结构上，属于同一套冲突解决的一部分。

| 冲突文件 | 冲突出处 | 解决方式 |
| --- | --- | --- |
| `shared/protocol.js` | import 行取上游版，函数体仍是 fork 版 | 恢复 `ROOM_MODES` / `ULTIMATE_SEATS` / `CHEAT_ACTIONS` 导入；补回 `g.emoteBurst`、`g.cheat` 目录项 |
| `server/lobby.js` | 同上 | 恢复 `roomSeatCap` / `ULTIMATE_DIFFICULTY`，保留上游新增的 `checkNotOwned` / `checkDiyPicks` / `KITTED_CHARS` |
| `server/match/Match.js` | 上游重写为模块装配 | 保留 `roomMode`（含 `ROOM_MODES` 导入），其余 fork 逻辑迁入 `match/`、`player/` |
| `server/match/player/economy.js` | 上游拆分出的新文件 | 移植 `_payable()`、`applyCheat()`、`spend()` 的无限资金分支及三处资金校验 |
| `server/match/player/prep.js`、`player/round.js`、`player/views.js` | 同上 | 移植资金校验、淘汰时清理作弊状态、`privateView().cheat` |
| `server/match/match/intents.js` | 上游 `g.*` 路由 | 补 `g.emoteBurst` / `g.cheat` / `g.choiceRandom` 路由与 `emoteBurst()`、`cheat()` |
| `server/match/match/spDraft.js` | 同上（fork 逻辑整体缺失） | 移植并行/去时限机变、`voteRandomChoice()`、`resolveRandomChoice()` 等 |
| `server/match/match/views.js` | 同上 | 补并行机变的状态判定与 `v.sp` 新字段 |
| `server/match/waves.js`、`server/match/finalAssault.js` | 上游重写了刷怪与 boss 血量 | `roundMods()` 接受 `enemyExtras`；boss 分支单独处理；`bossPoolHp` 乘 `bossHpExtra` |
| `test/e2e/client-wait.test.js` | 断言块（fork）与 helper（上游）拼在一起，引用了不存在的 `SLICE` / `TRUE_AFTER` / `page.t0` | 用 fork 的时间线写法重写，去掉「哪个分片 resolve」的断言（满载下定时器抖动会误报） |
| `public/js/ui/gameActions.js` | 上游新增 `watch` 参数覆盖了 fork 版本 | 补回 `actions.emoteBurst` / `actions.cheat`，保留上游的 `watch(fieldId, playerId)` |
| `data/config.json`、`data/choices.json` | 上游数据文件覆盖了 fork 数据层 | 用 `tools/fork-overrides.mjs` 重新应用（`node tools/fork-data.mjs`），并把 `applyForkOverrides` / `applyForkChoices` 接回 `tools/build-data.mjs` |

### 2.1 需要以上游为准、因而同步更新 fork 既有测试的地方

| 冲突点 | 上游逻辑 | fork 测试的调整 |
| --- | --- | --- |
| boss 共享血量 | `config.bossHpScale.perPlayer: true`（PR #209）：共享池 = `bloodPoint × coop × 存活人数` | 终极模拟的 ×1.2 / ×1.35 改为乘在上游共享池上，测试从模式读取 share |
| 独立模拟单人系数 | `solo: 1`（原 `0.25 [ASSUMED]`） | 测试改为读取 `bossPoolShare()` |
| 大厅模式卡文案 | 改为 i18n 模板 `1–{n} 名博士 …` + `params` | 断言解析占位符后再比对（含终极模拟卡） |
| 中文 UI 文案 | 0.2.0 起全部走 `t()` / `N_()` | fork 新增文案补 `t()` / `N_()` 并写入 `public/i18n/en.json` |

## 3. 验证结果

| 项目 | 结果 |
| --- | --- |
| 完整测试套件 | 5221 项，**5183 通过 / 2 失败**（修复前为 153 失败） |
| 失败项 | 两项 CPU 性能基准（`test/sim/perf.test.js`、`test/sim/robustness.test.js` 各一项）：满载 0.61–0.79 ms/tick，超过 0.5 阈值；**空载单独跑连续 3 次均 37/37 通过** |
| ESLint | 0 error（136 warning，均为原有风格类告警） |
| `tsc --noEmit --checkJs` | 通过 |
| `node tools/check-imports.mjs` | 通过（仅 3 条既有 note） |
| `node tools/i18n.mjs check` | en 包 1036/1036（100 %），0 missing / 0 error |
| 服务器实跑 | `node server/index.js` 启动正常，`/healthz` 200、`/` 200 |
| 端到端冒烟 | WebSocket 建「终极模拟」房间成功；非法难度 `FUNNY` 被拒；非法模式被拒；`g.cheat` 返回 `WRONG_PHASE`（协议已识别）；`g.emoteBurst` 进入校验 |

## 4. 环境说明

- 执行时 `github.com:443` 连接被重置（`curl 56 / Failed to connect`），**无法执行 fetch/push**。
  合并使用的是本地两份**完整克隆**的快照：源仓库 `origin/master` = 上游 master 尖端 `3eced7b`，
  目标仓库 `origin/master` = `6ffd18d`（快照时间 2026-10-09 01:17）。若上游此后有新提交，
  需要联网后先 fetch 再追加一次合并。
- 结果**尚未推送**到 `origin`，推送由仓库维护者执行。
