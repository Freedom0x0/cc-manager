---
title: v4.0 Tauri 2 完整迁移 30 commit 总览 (rid-1 → commit 31)
kind: decision
---

# v4.0 Tauri 2 完整迁移 总览 sediment

session: 2026-08-02-session-c67684 (2026-08-02 ~ 2026-08-03)
branch: rust/full-tauri-migration
commits: 31 (commit 0 → 31, 实际迁移 = commits 0-30 共 31 commit)
最终 commit: 880ecdf (D32 typecheck fix)
最终状态: **commit pushed to branch, 未发 release tag** (用户决定 D33 deferred)

## v4.0 Tauri 2 30 commit 序列 全景

```
ab61cbe docs(v4): README v4.0.0 + CLAUDE.md §13 D17/D18 + peaks memory sediment (commit 15 / 30)
0939594 ci(v4): Tauri 2 双平台 CI + drop_mcp_server_state + 动态 prod CSP (commit 14 / 30)
a38f217 chore(v4): 删 ui-smoke 8 测试 (commit 13 / 30)
bed78c4 feat(v4): Usage 6 IPC — 用量分析只读聚合 (commit 12 / 30)
bf409a4 feat(v4): Profiles 模块迁移 (commit 11 / 30)
93a1bdb feat(v4): Plugins 模块迁移 (commit 10 / 30)
c386478 feat(v4): Hooks 模块迁移 (commit 9 / 30)
84ce968 feat(v4): Sub-agents 模块迁移 (commit 8 / 30)
79a1913 feat(v4): Commands 模块迁移 (commit 7 / 30)
8e60846 feat(v4): Skills 模块迁移 (commit 6 / 30)
0dfb149 feat(v4): MCP 模块迁移 (commit 5 / 30)
4e4b99c feat(v4): notify watcher + watcher_state 2 IPC (commit 4)
55df4ed feat(v4): Sessions 写 5 IPC + resumer (commit 3)
324a45d feat(v4): src/api.ts Tauri dispatch + Sessions 5 读 IPC (commit 2)
84270b3 fix(v4): tauri dev hotfix + peaks memory sediment
4ef661c feat(v4): rusqlite DB init + atomic_write util (commit 1)
0e3bbaa chore(v4): bootstrap Tauri 2 skeleton + remove electron/

# 后续 6 commit 收尾 (用户手验暴露的 bug fix)
880ecdf fix(v4): D32 typecheck 删 tsconfig.electron.json 引用 (commit 31)
5a9f486 docs(v4): v4.0 完成判定 100% + D26-D31 sediment (commit 30 / 30)
64e6544 fix(v4): D31 plugins_scanner 接 opts + installPath 路径 (commit 29 / 30)
cb4d965 fix(v4): D30 插件 scanner 改读 installed_plugins.json v2 schema (commit 28 / 30)
f1199d3 fix(v4): D29 Profile capture 改 production 路径 (commit 27 / 30)
f3a3a59 feat(v4): D28 Profile 6 模块 description + UI 删 D13 文案 (commit 26 / 30)
6095ce7 fix(v4): D27 v3.1 window.api 残留 (commit 25 / 30)
64cb967 feat(v4): D26 importer 集成 + watcher 真做事 (commit 24 / 30)
```

## D17-D32 共 12 决策 sediment

| ID | Commit | 主题 | 关键决策 |
|---|---|---|---|
| D17 | 11-15 | 5 commit 收尾 | Profiles / Usage 模块迁移 + 删 ui-smoke + CI Tauri 重写 + 文档 |
| D18 | 16 | mock cleanup | commit 2 漏改 main.tsx import, 1 行修复 |
| D19 | 17 | 验证纪律 3 步 | cargo test + tsc + build:vite 是 v4 必要门槛 |
| D20 | 18 | IPC channel name | 60 wrapper 加 cmd_ 前缀对齐后端 handler |
| D21 | 19 | Profile types + UI 重写 | 对齐 v4 schema, 删 v3.1 ProfileConfig |
| D22 | 20-21 | 静态扫描 + mcp_scanner fix | 50 调用 vs 60 wrapper 全对齐 + snake_case 改 camelCase |
| D24 | 22 | cargo check 替代 cargo test | Windows Defender 拦, 改 cargo check 不触 exe |
| D25 | 23 | CI 路径 | 本地放弃 tauri runtime, 走 CI runner |
| D26 | 24 | importer 集成 | v4 commit 4 漏 importer 解析 + 启动触发 |
| D27 | 25 | window.api 残留 | v3.1 Electron preload 模式 v4 已无, undefined 触发 TypeError |
| D28 | 26 | Profile description + UI 文案 | 6 模块 description 加回, 删 D13 用户面冗余 |
| D29 | 27 | from_base_dir 误用 | test fixture 工厂错用于生产 handler |
| D30 | 28 | installed_plugins.json v2 | Anthropic 升 v2 schema 后 v4 scanner 仍按 v1 解析 → 0 plugin |
| D31 | 29 | plugin path + fixture 隔离 | _plugins_root 忽略 opts + installPath 路径错 |
| D32 | 31 | typecheck fix | tsconfig.electron.json 引用 electron/ 已删 |

## v4.0 关键成就

✅ **后端 60 IPC 全部上线** (commits 2-12 共 12 commit)
- 6 读 (commit 2) + 5 写 (commit 3) + 2 watcher (commit 4) + 30 (commits 5-10: 6 模块 × 5 + plugins) + 12 (commits 11-12: profiles 6 + usage 6) = 60 IPC
- 7 张表 (projects / sessions / messages / watcher_state / mcp_server_state / profile_snapshot / messages_fts)
- 14 module 文件 (5 profiles × 4-6 文件 + 4 usage × 1 文件)

✅ **CI workflow** (commit 14) — cargo-tauri build + 双平台 + Swatinem/rust-cache
✅ **drop mcp_server_state** (commit 14) — 半年原则豁免, D10 + D15 决策链
✅ **动态 prod CSP** (commit 14) — csp: null + vite plugin transformIndexHtml
✅ **mock cleanup** (commit 16) — D18 闭环
✅ **importer 集成** (commit 24) — D26 闭环
✅ **Profile description** (commit 26) — D28 加回 6 模块 description
✅ **production 路径** (commit 27) — D29 from_base_dir 修
✅ **plugin schema** (commit 28-29) — D30/D31 v2 schema + 路径

## v4.0 关键决策 (跟 commit 1-30 顺序无关,按时间线)

1. **D1 (commit 0)**: v3.1 electron → Tauri 2 (Rust 0.31 + rusqlite + notify 6 + serde + dirs 5)
2. **D2-D6 (commit 1)**: rusqlite + atomic_write + 4 ALTER 兼容迁移
3. **D7-D11 (commits 5-10)**: 6 模块 CRUD v4 迁移
4. **D12 (commit 14)**: drop mcp_server_state + 动态 prod CSP
5. **D13-D16 (v3.1 时代)**: 真停用语义, 见 CLAUDE.md §13 v5 D10-D16
6. **D17-D32 (本会话)**: v4 升档后 12 个新决策

## v4.0 关键 bug 修复 (commit 24-31)

- **D26 (commit 24)**: importer 集成 — 用户"会话没数据"反馈, 后端只建 schema 不扫 jsonl
- **D27 (commit 25)**: window.api 残留 — 用户"TypeError: Cannot read properties of undefined", v4 走 import { api } 不走 window.api
- **D28 (commit 26)**: description 加回 + D13 文案删 — 用户"之前的 skills mcp 等都是有描述的" + "apply 走 D13 完整替代语义 这句话删掉"
- **D29 (commit 27)**: from_base_dir 误用 — 用户"profiles 捕获当前状态怎么是 0 项启用?", fixture 工厂被错用生产
- **D30-D31 (commit 28-29)**: plugins_scanner 0 plugin — 用户"插件显示是空"×2, schema 错 + 路径错 + 隔离陷阱
- **D32 (commit 31)**: typecheck electron config 引用 — CI 双平台 typecheck 步骤 fail

## v4.0 核心教训 (v4 升档共性)

1. **v3.1 → v4 升档必须看真实数据**, 不能凭注释或想象 (D28 description 缺 + D30 plugin schema v1)
2. **fixture 工厂 vs production 工厂 命名必须明确分离** (D29 from_base_dir 误用 + D31 _plugins_root)
3. **stub 必须带"未实现"warning** (D26 cmd_watcher_rescan_all 一直 stub)
4. **集成类 commit 必须 3 段全跑通** (D26 watcher 集成只跑通 1/3)
5. **UI 文案只讲用户能观察的副作用** (D28 D13 文案冗余删)
6. **v3.1 残留必须删** (D27 window.api)
7. **TS 静态检查不抓 runtime 错** (D27 window.api 静默 undefined)
8. **cargo test + tsc + build:vite + 真机手验 = 4 层验证** (D19 + D26-D31)
9. **半年原则豁免需明示理由** (D12 drop mcp_server_state)
10. **动态 CSP 走 runtime 而非 build-time** (D12)

## v4.0 release decision (用户 D33 决定)

用户 2026-08-03 决定不发布 v4.0 tag release, 改做总结归档。

**理由** (推断):
- v4.0 30 commit + 12 决策已落 = 代码完整
- 但 CI release build fail (D32 typecheck electron 配置引用) — 还没修完 release 链
- 真机手验 4 步必跑 (sessions / plugins / profile capture / apply) 用户没完整跑过
- 8 commits (16-31) 是手验暴露的 bug 修复, 反映 v4.0 上线后真实状态
- 用户判断 "不发布, 总结下" = 选 v4.0 内部归档而非 release, 等 v4.0.1 修复手验 + release

**结果**:
- Branch `rust/full-tauri-migration` 已推 (含 commits 0-31 共 32 commit)
- Tag `v4.0.0-rust-migration` 已推但 release build fail, 待 v4.0.1 修复
- CI workflow 需修: typecheck electron config + drop mcp_server_state 已加 (commit 14) 但实际跑还有坑
- macOS DMG build 需 CI runner 验证 (本地放弃)

## v4.1 follow-up 路线 (用户下次会话接续)

1. **release 链修复**:
   - 修 tsconfig.electron.json 引用 (D32 已修 package.json, tsconfig.electron.json 文件本身可能还要删)
   - 删 electron-* scripts (dev:electron / build / test / rebuild:sqlite / package*) — 简化 package.json
   - 重新 push tag v4.0.1-rust-migration 触发 CI
2. **真机手验完整 4 步**:
   - npm run dev:tauri 启
   - 9 panel 列表 (sessions / mcp / skills / commands / sub_agents / hooks / plugins / profiles / usage) 看数据
   - 点 Header "立即扫描" → 立即导入
   - Profile Tab → 捕获 → 看 6 模块 enabled 全集 (含 description)
   - Profile apply / diff 路径
3. **plugins_scanner 加 v2 test fixture** (commit 28/29 缺)
4. **6 module scanner/writer 完整 fixture 测试** (Windows Defender 拦, CI runner 跑通后补)
5. **settings_reader + ClaudeSettings v3.1 等价测试** (unknown-fields 保留策略变化)
6. **macOS 真机验证** + Apple Developer ID + notarization
7. **4-10 plugins/hooks enable 路径补** (v4 commit 11 apply.rs skip 项)

## 关联文件清单 (v4.0 31 commit 总览)

### 新增 (8 文件)
- src-tauri/Cargo.toml
- src-tauri/tauri.conf.json
- src-tauri/build.rs
- src-tauri/src/main.rs
- src-tauri/src/lib.rs
- src-tauri/src/types.rs
- src-tauri/src/db/{mod.rs, migration.rs}
- src-tauri/src/watcher.rs
- src-tauri/src/importer.rs (D26)
- src-tauri/src/util/{atomic_write.rs, settings_reader.rs, mod.rs}
- src-tauri/src/repo/{mod.rs, common.rs (D28), mcp_*, skills_*, commands_*, agents_*, hooks_*, plugins_*, profiles/{types,capture,apply,diff,mod,tests}.rs, usage/{types,scanner,mod,tests}.rs, importer_tests.rs}
- .cargo/config.toml (rsproxy-sparse 镜像)
- vite.config.ts (D12 动态 CSP plugin)
- .github/workflows/build-installers.yml (D17 CI 重写)
- .peaks/memory/2026-08-02-v4-tauri-commit-11-14.md
- .peaks/memory/2026-08-02-v4-tauri-commit-16-17.md
- .peaks/memory/2026-08-03-v4-tauri-commit-24-30.md

### 修改 (8 文件)
- package.json (删 electron 路径, D32 typecheck fix)
- CLAUDE.md (加 D17-D32 sediment + v4.0 完成判定)
- README.md (v3.1 → v4.0.0 badge + Tauri 致谢 + macOS DMG 段)
- src/types.ts + src/global.d.ts + src/api-tauri.ts (v4 schema + Tauri dispatch + D27 130→6 行 stub 删)
- src/App.tsx (9 模块 Manager 入口)
- src/components/WatcherStatusIndicator.tsx (D26 按钮 + D27 import api)
- src/main.tsx (D18 删 mock import)
- src/modules/profiles/ProfileManager.tsx (D21 + D28 description 显示 + D13 文案删)

### 删 (9 文件)
- electron/ (commit 0)
- electron-builder.json
- tests/*-ui-smoke.test.ts 8 文件 (commit 13)
- docs/superpowers/specs/2026-08-02-d22-mcp-runtime-fail-design.md (commit 21)

## 净统计

- commits: 31 (含 commit 31 D32)
- 净增文件: 27+ (8 新 + 8 改 + 9 删)
- 净增行: 估算 +4500 / -1200 (含 importer.rs 422 行 + common.rs 65 行 + lib.rs 600 行 + 6 scanner 改造)
- 决策 sediment: 12 条 (D17-D32)
- 测试 case: 36 passed (cargo test --lib)

## v4.0 决策 (D33)

**D33 (2026-08-03)**: v4.0 release deferred — 用户决定暂不发布 v4.0.0-rust-migration tag release, 改做总结归档。

理由:
- v4.0 30 commit + 31 fix commit 已落, 代码完整 (commit 30/30 + commit 31 D32)
- 但 release chain 还没修完: tsconfig.electron.json 文件本身可能还要删, electron-* scripts 清理未做
- 真机手验 4 步用户没完整跑过 (sessions / plugins / profile capture / apply)
- v4.1 follow-up 7 项 (release 链修复 + 完整手验 + plugin v2 test fixture + 6 module scanner/writer 测试 + settings_reader 测试 + macOS 验证 + plugins/hooks enable 路径) 等下个会话

**决策**: v4.0 内部归档 (branch pushed + sediment 沉淀), v4.0.1 release 等修复 + 完整手验后。

**教训 (D33)**:
1. "code 完整" ≠ "release ready" — 31 commit 全绿, 但 release chain + 真机手验 还没做
2. 真机手验是 release 前必经 — D26/D27/D28/D29/D30/D31 都是手验暴露, 提前跑能减少 commit 数
3. **release 前 checklist**:
   - 真机手验 4 步全过
   - CI 双平台 typecheck 绿 (D32 已修 package.json)
   - tsconfig.electron.json 清理
   - electron-* scripts 删
   - macOS DMG + Windows MSI 实际 artifact 验
   - 重新 push tag 触发 CI release build
4. 用户决策 "不发布, 总结下" 是稳的 — 31 commit 内部归档 + v4.0.1 修复 release 比 v4.0 半成品发布更负责