---
name: real-disable-2026-07-30
description: 6 模块 toggle 从 SQLite KV 表搬到 Claude Code 实际读取位置
tags: [v5, real-disable, settings-writer, migration, profile-bug-fix]
summary: 推翻 V5 D6/D9 — enabled 状态写真实文件(settings.json / .disabled 后缀)
---

# 6 模块「真停用」 — 2026-07-30

## 背景

V5 D6 决策(2026-07-28 wave-1)把 6 个业务模块 toggle 的 enabled 状态写到
`mcp_server_state` SQLite KV 表,key 前缀区分(mcp:/skill:/cmd:/agent:/
hook:/plugin:)。理由:"不污染原文件" — 用户的 toggle 不破坏 `~/.claude.json` /
SKILL.md / commands/*.md 的语义。

2026-07-30 RD 阶段发现:**Claude Code 不读 SQLite KV 表**。本机实测:

- `~/.claude/plugins/installed_plugins.json` 无 `enabled` 字段(只有
  scope/installPath/version/installedAt/lastUpdated/gitCommitSha)
- `~/.claude.json` `mcpServers` 是 server 定义本身,不是停用字段
- 停用字段在 `~/.claude/settings.json`:
  - `enabledPlugins[name@marketplace] = bool` (插件)
  - `disabledMcpjsonServers[]` (MCP 黑名单)
  - `hooks[<event>]` 数组(hook 存在性 = 启用)
- Skills/Commands/Sub-Agents 无停用字段 — Claude Code 靠文件存在性加载

KV 表写入 100% 成功、UI 100% 正确、109 个测试 100% 全绿,但 Claude Code
侧**零影响**。109 测试反而锁死了错误行为 — 这是 Karpathy guideline 1
"Think Before Coding"反例:测试断言"KV 写对了"而非"Claude Code 真停用"。

## 决策

**推翻 D6 + D9,新决策 D10**:用户的"停用"语义必须写到 Claude Code 实际
读取的字段,KV 表**只**作 cache + audit log + profile_capture 快照。

### 6 模块真停用位置

| 模块 | 真实文件 | 字段 |
|---|---|---|
| 插件 | `~/.claude/settings.json` | `enabledPlugins[name@marketplace] = bool` |
| MCP | `~/.claude/settings.json` | `disabledMcpjsonServers[]` 黑名单 |
| Skills | `~/.claude/skills/<name>/` | mv → `~/.claude/disabled_skills/<name>/`(commit 9 镜像目录方案,2026-07-31 真机验失败修正) |
| Commands | `~/.claude/commands/<name>.md` | mv → `<name>.md.disabled` |
| Sub-Agents | `~/.claude/agents/<name>.md` | mv → `<name>.md.disabled` |
| Hooks | `settings.json.hooks[<event>]` | splice 移除(enable 需 createHook 重建) |

### 共享原子写抽象

新增 `electron/repo/settings-writer.ts`,基于 D7 tmp+rename 模式,提供 5
个语义化操作(setPluginEnabled / setMcpDisabled / setHookEnabled /
setDisabledSuffix)+ renameWithRetry(Windows EPERM 重试 5 次)+ D10 tmp
randomBytes 命名。

### 启动时一次性迁移

`electron/repo/migration.ts` `runMigration` 启动时调一次,读 6 prefix 的
KV 条目 → 写真实文件。失败 best-effort(KV 保留,下次再试)。**不**删 KV
条目 — 作为 audit log + profile_capture 快照源。

### 修正 Profiles KV prefix bug

V5 D9 时代代码用 `mcp:enabled:<name>` 写 profile_apply,但 mcp/state.ts
实际用 `enabled:<name>`(无 mcp: 前缀),导致 profile_apply 永远
capture 不到 MCP 状态。修正:6 模块 capture/apply/backup/restore 全部对齐
实际 writer 用的 prefix(MCP = `enabled:`,其余 5 = `<prefix>:enabled:`)。

## 关键修改

- 新增: `electron/repo/settings-writer.ts`(340 行) + `electron/repo/migration.ts`(180 行)
- 改: `electron/main.ts` 6 模块 toggle 改 async + `app.whenReady` 加 `runMigration`
- 改: 6 模块 `state.ts` setEnabled 写真实文件 + 保留 KV 作 cache
- 改: 6 模块 `scanner.ts` 读真实状态(不从 KV 覆盖)
- 改: `profiles/writer.ts` applyProfile 改 async + 写真实文件 + 修正 KV prefix
- 改: `profiles/state.ts` backupEnabledStates 修正 KV prefix
- 新增/改测试: 6 模块 Case 2 改"enabled 恒 true"(结构性存在性)+
  7 个真停用硬证据(2b/6)+ settings-writer 20 case + migration 7 case
- 全 143 tests pass,既有 109 + 新增 34 净增

## 验证

- 既有 109 tests + 新增 34 tests = 143/143 全绿
- 6 模块真停用硬证据(每个模块的 Case 2b / 6):toggle 后重读磁盘验证
  settings.json.disabledMcpjsonServers / enabledPlugins / hooks[] 数组 /
  .disabled 目录 / .md.disabled 文件
- 实测(commit 5 当时,2026-07-30):`mv foo foo.disabled && claude -p "/foo 可用吗?"` → NO,
  `/skills` 命令列表 grep 无输出(单次 Windows + 简单 skill 通过)
- **2026-07-31 复测发现**:`.disabled` 后缀方案在更复杂环境(多 symlink /
  不同 Claude Code 版本)不稳定 → commit 9 改用镜像目录方案
  `disabled_skills/<name>/`。scanner 只扫 `skills/`,镜像目录自动不扫,
  跨版本稳定,symlink 安全

## 为什么不在 v2.0/v2.1 做

- v2.0/v2.1 focus 在 build / schema / waves,没用户发现"假停用" —
  KV 写成功的乐观更新 + message.success 让 UI 看起来工作正常
- 2026-07-30 用户问"停用没有真的停用"才暴露根因

## commit 9 教训(2026-07-31)

- 即使 RD 阶段我自己跑过单 skill 实测通过,**不**代表所有环境稳定
- 验证强度:1 个 skill / 单次 / 简单环境 = "初步证据",不是"硬证据"
- 修复方向:换**不依赖隐式行为**的方案(.disabled 后缀是"赌 Claude Code
  不读"),改**依赖显式路径**的方案(镜像目录 = "Claude Code 只扫
  这个目录"是文档明确的)
- **教训**:commit 5 当时应该加"⚠️ 基于 .disabled 后缀不被读假设,需真机
  验证",没加是披露不充分

## 相关 commit

- `6ee824a` refactor(settings-writer) 抽统一抽象
- `ecc7728` feat(mcp) 写真实 settings.json disabledMcpjsonServers
- `09be355` feat(plugins) 写真实 settings.json enabledPlugins
- `da07786` feat(hooks) splice settings.json hooks[] 数组
- `c882028` feat(skills+commands+sub-agents) .disabled 后缀 mv
- `86e1ce2` feat(migration) 启动时一次性同步
- `d3c6e09` feat(profiles) applyProfile async + 写真实文件 + 修正 prefix bug
