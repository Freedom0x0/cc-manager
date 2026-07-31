---
name: mac-adapter-2026-07-30
description: macOS 装包配置已就绪 v3.1, 真机验证 deferred 到 mac 贡献者
tags: [v3.1, mac-adapter, electron-builder, gatekeeper, deferred-verification]
summary: mac target dmg+zip 已配, package:mac 脚本已加; mac 真机验证待 mac 贡献者跑; 未签名策略 D11
---

# mac 适配 (v3.1) — 2026-07-30

## 背景

CLAUDE.md §0 战略:Windows 优先(v2.0/v2.1/v3.0 出 Windows installer),macOS
适配延后到 v4.0。CLAUDE.md §13 D9 决策原本说"v4.0 启用 `--mac`"。

2026-07-30 复盘时发现:**mac 装包配置实际上已部分就绪**(比 D9 决策超前):

- `electron-builder.json` mac target = `dmg` + `zip`,arm64 + x64 双架构
- `package.json` 有 `package:mac` 脚本
- `main.ts` `getDataDir()` macOS 分支已实现(Library/Application Support)
- `chokidar 5` macOS ABI 兼容(CLAUDE.md §13 D2 决策)

**但**:**mac 真机验证从未跑过**。本仓库目前没有 mac 贡献者,
且 Apple 签名 / notarization 是大工作(Developer ID 申请 + 密钥管理 +
公证流程 + CI 集成)。CLAUDE.md §13 D11 决策:v4.0 起步**未签名**。

## 决策

**v3.1**:
1. **配置已就绪** — electron-builder.json + package.json scripts 不动
2. **未签名策略** — 沿用 D11 决策,首次双击 DMG 需右键 → 打开
3. **真机验证 deferred** — 文档化 checklist 等 mac 贡献者跑

**v4.0(后续)**:
- Developer ID 申请 + 签名
- Apple notarization 集成
- macOS CI runner (GitHub Actions macos-latest)
- Gatekeeper 流程自动化测试

## 改动

- README.md §macOS 段:`v4.0 规划中` → `v3.1 已配置,待真机验证`
  + 加 mac 装包命令 + Gatekeeper 流程 + mac 真机验证 checklist
- CLAUDE.md §13 D9 决策:加 `D9 续` 标记已实现部分 + deferred 验证
- 本文件(.peaks/memory/2026-07-30-mac-adapter.md):决策记录

## 验证

代码层面:**0 改动**(仅 docs)。npm test 仍 143/143 全绿。

待 mac 贡献者跑(README §macOS 真机验证 checklist 7 步):
1. macOS 12+ + Xcode Command Line Tools
2. clone + 编译 better-sqlite3
3. `npm test` 期望 143/143
4. `npm run dev` 验证 6 模块 toggle 真实文件变化
5. `npm run package:mac` 出 DMG + ZIP
6. 双击 DMG → 右键 → 打开 → 验证 Gatekeeper 流程
7. 回填跑测结果到 PR/issue

## 已知风险

- **build/icon.icns 缺失**:macOS 装包理想需要 .icns(可由 electron-builder
  从 .png 转换,实测可能不完美)。首次 mac build 跑出再补
- **Apple Silicon vs Intel**:D9 决策配了 arm64 + x64 双架构,出 4 个文件
  (2 DMG + 2 ZIP)。universal binary 留 v4.0 优化
- **chokidar 5 macOS FSEvents**:理论上 OK(D2 决策),未真机验证
  FSEvents 队列背压行为(大批量 add 事件时稳定性)

## 为什么在 v3.1 推, 不等 v4.0

- v3.0 真停用 push 完, codebase 稳定
- D9 决策本身已"预留"配置 — 实际推进阻力小(主要 docs 工作)
- 让 mac 贡献者能开始跑(就算出 DMG 失败,也能识别具体问题)
- v4.0 集中精力做签名 + notarization(独立大工作)

## 相关 commit

(待 push 后填)
