# Changelog

## [Unreleased]

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
