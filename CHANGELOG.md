# Changelog

## [Unreleased]

### v5 D16 — 撤销顶部「全局搜索」+「选择项目」

- **删** `GlobalSearchBar.tsx` / `ProjectSelector.tsx` —— 波 0 的 `disabled` 占位空壳,placeholder 标「波 1+ 启用」,但波 1/2/3 全做完(v3.0 已发)都没接上,是过期承诺
- **删整条 `global_search` 后端链**(照 D5「0 引用不留死代码」):`repo/search.ts:globalSearch()` + `GlobalSearchHit` 类型(src/types.ts 与 repo 各一份) / `main.ts` handler / `preload.ts` / `global.d.ts` / `api.ts` / `mock.ts` / `tests/global-search.test.ts` / `package.json` 测试列表
- **保留** `search.ts:search()` —— 会话 Tab 的 FTS5 全文搜索仍在用,与本次无关
- spec §8 整节标作废(原设计折叠保留);顺带发现 §8.2 的 SQL 引用 `mcp_metadata` / `skill_metadata` / `command_metadata` **三张表从未存在**,该设计从写下起就不可实现
- 测试 150 → 147

### v5 amendment — platform strategy

- **Platform**: Windows-first. v2.0 / v2.1 / v3.0 produce Windows installers (NSIS + Portable) only.
- **macOS**: Adaptation deferred to v4.0 (spec §15). Rationale: current dev machine + CI are Windows; macOS adaptation involves Apple signing / notarization / native menu — better isolated as a dedicated release.
- **Dev mode**: Cross-platform (`npm run dev` works on macOS). Only `npm run package` is Windows-only until v4.0.

### Notes

- electron-builder.json reserves `mac.target: ["dmg", "zip"]` for v4.0 enablement
- Test fixtures must use `os.tmpdir()` instead of hardcoded Windows paths (D10)
- macOS signing: NOT in v4.0 scope (D11) — Gatekeeper warning + right-click open expected

## v5 wave-0 — 模块化骨架 (2026-07-28)

- 抽出 `electron/repo/_template/` 标准骨架 (4 文件 + README) — 波 1+ 业务模块 cp -r 替换
- `src/App.tsx` 改 antd `Layout` + `Tabs` 导航壳子,9 个 Tab(会话 / MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析)
- 8 个业务模块占位 `src/modules/<name>/<Name>Manager>.tsx`(3 行 ComingSoon)
- 3 个 Header 占位组件(GlobalSearchBar / ProjectSelector / WatcherStatusIndicator)
- chokidar 事件驱动的文件 watcher(`electron/watcher.ts` + `electron/repo/watcher-state.ts`),无 polling
- 3 个新 IPC channel:`global_search` / `watcher_rescan_all` / `watcher_get_status`
- sessions 模块迁到 `src/modules/sessions/`(9 components,7 原始 + 2 抽离),SessionsModule.tsx re-export 入口
- 删孤儿组件 `ProjectList.tsx`(v3 残留,全代码库 0 引用,违反 D5)
- 测试 28 → 44(基线 30 + 14 新 case,RD §4 估 28 偏旧)
- npm test: 44 passed / 0 failed

## v2.0 — 业务模块上线 (2026-07-29)

- MCP 模块:扫描 `~/.claude.json` 的 mcpServers,看 / 改 / 删 / 启停 5 个 IPC(`mcp_list` / `mcp_get` / `mcp_create` / `mcp_update` / `mcp_delete` + `mcp_toggle_enabled`)
- Skills 模块:扫描 `~/.claude/skills/<name>/SKILL.md`,看 / 改 / 删 / 启停 5 个 IPC(`skill_*` + `skill_toggle_enabled`)
- Commands 模块:扫描 `~/.claude/commands/<name>.md`,看 / 改 / 删 / 启停 5 个 IPC(`command_*` + `command_toggle_enabled`)
- 18 个新 IPC channel,每个模块 6 个(共 18 覆盖 3 模块)
- enabled 状态写 `mcp_server_state` KV 表(D6 决策,不复用原文件,避免污染 ~/.claude.json)
- McpManager / SkillsManager / CommandsManager 三个 UI 完整实装(各 ~150-330 行),antd List + Switch + Modal + Form
- 测试 44 → 69(基线 30 + 14 wave-0 + 5 + 3 + 5 + 3 + 5 + 3 = 69)
- npm test: 69 passed / 0 failed

## v2.1 — wave-2 业务模块上线 (2026-07-29)

- Sub-Agents 模块:扫描 `~/.claude/agents/<name>.md`,看 / 改 / 删 / 启停 6 个 IPC(`subagent_list` / `subagent_get` / `subagent_create` / `subagent_update` / `subagent_delete` + `subagent_toggle_enabled`)
- Hooks 模块:扫描 `~/.claude/settings.json` 的 `hooks` 字段(pre/post tool 触发),看 / 改 / 删 / 启停 6 个 IPC(`hook_*` + `hook_toggle_enabled`)
- 插件模块:扫描 `~/.claude/plugins/<name>/plugin.json`,看 / 改 / 删 / 启停 6 个 IPC(`plugin_*` + `plugin_toggle_enabled`)
- 18 个新 IPC channel,每个模块 6 个(共 18 覆盖 3 模块)
- 累计 IPC channel:34 → 52
- enabled 状态走 KV 表(D6 决策延伸,不污染原文件)
- settings.json / plugin.json 原子写(D7 决策,失败不破坏原文件)
- SubAgentsManager / HooksManager / PluginsManager 三个 UI 完整实装
- 测试 69 → 93(基线 30 + 14 wave-0 + 5+3+5+3+5+3 wave-1 + 5+3+5+3+5+3 wave-2 = 93)
- npm test: 93 passed / 0 failed
