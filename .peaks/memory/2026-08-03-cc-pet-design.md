---
name: cc-pet-design-2026-08-03
description: cc-pet (Hopet-like 嵌入式桌面宠物) 整体设计 7 项决策
tags: [v4, pet, hopet, desktop-pet, hook-injection, eventbus, hmac, embedded-window]
summary: cc-manager 内嵌 Hopet 风格的桌面宠物 5 commit 落地 — 走 hook → HMAC HTTP → Rust EventBus → 多窗口 React 渲染
---

# cc-pet 集成设计 — 2026-08-03

## 背景

v4.0 Tauri 2 主线已 97% 完成 (D33 release deferred, commit 32)。用户在 v4.0
release 暂缓决策后,提出新需求:在 cc-manager 内集成 Hopet (https://github.com/
BinaryFroggy/Hopet) 类似功能的桌面宠物 — 用 cc-manager 自有栈 (Rust + React)
实现,不引入 Swift,不引入新构建目标。

核心需求:
- 实时显示 Claude Code agent 当前在调用哪些 skill 和 mcp
- 会话完成时提醒用户
- 像素动物 + 动画 + 气泡状态显示
- 手动开窗 (不自动启动)
- 嵌入式 (主 App 关 = 宠物消失)

v4 后端现状 (已 `git grep` 验证路径):
- `src-tauri/src/repo/hooks_scanner.rs` / `hooks_writer.rs` (commit 9)
- `src-tauri/src/util/atomic_write.rs:88` (`atomic_write_json`)
- `src-tauri/src/util/settings_reader.rs`
- `src-tauri/src/types.rs:232` (`HookCreateInput`)
- `src-tauri/src/lib.rs:18-92` 已注册 60 个 IPC handler

## 决策

### D34: cc-pet 模块整体设计

**选定**: 嵌入式宠物窗口, 5 commit 节奏 (c1-c5) 落地。

**放弃**: 3 个替代方案
- 独立进程 (Hopet 同款) — 工程量 2-3x, 不必要
- 嵌入 cc-manager 进程但**自动**启动宠物 — 用户说"手动开窗"
- 仅主 App 状态条 + OS 通知 — 不是"桌面宠物", 形态不对

### D34.1: 嵌入式宠物窗口

cc-manager 主进程内多开一个 Tauri 2 `WebviewWindow`, 无边框/置顶/不可聚焦,
~280x320 像素。位置记忆走 `app_data_dir/pet_position.json`。
用户主动点 "Open Pet Window" 才创建 (手动开窗, 符合 D1.3)。

**生命周期**: 主 App 关 = 宠物消失 (跟 Hopet 独立进程不同)。

### D34.2: HTTP localhost:19847 替代 UDS

Hopet 用 Unix Domain Socket (UDS), 但 cc-manager 跨 Windows + macOS 必须走 TCP。
**端口 19847**: 选这个是因为没被常用服务占用。

**Windows Firewall 不拦**: 绑 `127.0.0.1` (loopback), 防火墙只拦 inbound 公网/
局域网, loopback 默认放行. macOS 应用防火墙同样. 不需要额外防火墙规则.

**为什么不直接走 Tauri event channel (前端 listen)**: hook 事件从 Claude Code
进程触发, 不在 cc-manager 进程内. 必须有进程间通信层.

### D34.3: HMAC-SHA256 防假事件

**secret**: 32 字节随机, 存 `app_data_dir/secret.key`。
- Windows: 默认 ACL = 当前用户读/写, 够用, **不**额外 chmod/icacls
- macOS: 0700 默认权限, 够用

**嵌入方式**: 通过 `~/.claude/settings.json` 顶层 `env.CC_PET_SECRET` 注入到
hook 子进程的环境变量. hook 命令模板 `<cc-status-emit> --event <state>`
(secret 从 env 读, 不在命令行暴露).

**为什么不依赖 CC-manager 进程的 OS-level 隔离**: 127.0.0.1:19847 任何本机
进程都能连. HMAC 是最小防御, 防其他程序恶意伪造状态事件.

### D34.4: 5 commit 节奏 (c1-c5)

每个 commit 独立可回滚, 每个 commit 都有"做完了能跑"的最小验证。

| c | 内容 | 行数 |
|---|---|---|
| c1 | state + test + mod 空壳 + lib.rs 注册 | +120 |
| c2 | 4 写 + 1 读 IPC (install/uninstall 占位) | +80 |
| c3 | cc-status-emit bin target + tests | +100 |
| c4 | install.rs + http.rs + axum/hmac/sha2/hex/rand 依赖 | +400 |
| c5 | 前端 PetModule/PetWindow/pet-main/pet.html + capabilities + vite 多入口 | +500 |

### D34.5: v1 非目标

明确不做 (v2+ 接口预留):
- 多 session 优先级聚合 (v1 单 session, EventBus 是为 v2 留的)
- 用户自定义主题导入 (v1 只有内置 8 GIF)
- 灵动岛 / 顶部状态条 (macOS 专属, v1 不做)
- Permission 气泡 Allow/Deny (v1 只观察不介入)
- Codex CLI 集成 (v1 只 Claude Code)

### D34.6: 宠物状态不写 KV 表 (D10 延伸)

CLAUDE.md §13 D10 决策: KV 表 (`mcp_server_state`) 是 cache + profile_capture
专用, 不作 UI 真实状态源.

宠物当前状态走 **in-memory EventBus** (`tokio::sync::broadcast`), 关闭 cc-
manager = 状态丢. 这符合"嵌入式宠物"语义, 也避开 D10 禁令.

**前端 PetWindow 用 `appDataDir/pet_position.json`** (位置记忆) — 这是**文件**,
不是 KV 表, 也不冲突 D10.

### D34.7: install_status_hooks 是新函数, 不直接复用 create_hook

`repo/hooks_writer::create_hook` (hooks_writer.rs:23-33) 的限制:

| 项 | create_hook | install_status_hooks (新) |
|---|---|---|
| 一次写几条 | 1 条 | 6 条 |
| 写 env 段 | ❌ | ✅ CC_PET_SECRET |
| 已存在检查 | ❌ 无脑 push | ✅ scanner skip |
| matcher | 透传 | "" (空) |
| 错误回滚 | 写一半坏 | 全部 atomic (单文件) |

**内部仍用** `atomic_write_json` + `read_claude_settings` 这两个底层原语
(跟 create_hook 同样依赖, 复用已验 150+ case).

## 关联

- spec: `docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md`
- v4 spec: `docs/superpowers/specs/2026-07-28-cc-session-manager-v4-design.md`
- CLAUDE.md §13 D10 (KV 表禁令)
- CLAUDE.md §14.5 v4.0 三步验证纪律
- Hopet 参考: `C:\Users\15532\Desktop\xj\Hopet`

## 教训

1. **写 spec 前必须 `git grep` 验证 v4 路径**, 不能凭 v3.1 印象. v3.1→v4
   重命名/重构密集, 凭记忆列依赖 90% 会错. 本次幸运 v4 路径与我猜的一致
   (hooks_writer/atomic_write/settings_reader 都还在), 但**应该**作为 spec
   写的硬约束.
2. **CLAUDE.md §13 决策记录模板** = `.peaks/memory/<date>-<topic>.md` +
   `index.json` 更新. spec 里写决策段 (D34.x) 是**摘要**, 完整记录必须在
   `.peaks/memory/`. 之前我 spec 写了 §11 但漏 .peaks/memory, 用户 review
   点出.
3. **跨平台陷阱**: secret 文件权限 (chmod 600 vs icacls) / Windows Firewall
   端口 (loopback 不拦) 这类"看似要处理其实不用"的项目, spec 应该**明确
   说明**为什么不处理, 不留"看起来应该有"的歧义.

---

# v1.1 review fixes (commit 5fffb94)

## 用户第二轮 review 命中

5 个事实硬错 (F1-F5) + 3 个设计澄清 (D34.x 后续), 全部修.

### F1: 编造的 `[[bin]]` 段

**v1.0/v1.1 spec §8.1 写**: "Cargo.toml 加 `[[bin]] name = "cc-status-emit" path = "src/bin/cc-status-emit.rs"`"

**真实**: Cargo.toml:13-15 只有 `[lib]`, **没有任何 `[[bin]]` 段**; `src-tauri/src/bin/`
目录**不存在**; cargo metadata 只识别默认 `src/main.rs` bin.

**根因**: 凭 v3.1 Electron 时代印象 (v3.1 是 Electron 进程, 没 Cargo.toml), 没读 v4.

**修复**: v1.2 spec §8.1 改成正确格式 - 加 `[[bin]] name = "cc-status-emit" path = "src/bin/cc-status-emit.rs"`,
 单独 `[[bin]]` 段, 现有 main.rs 仍然靠 cargo 默认推断.

### F2: 捏造的 `atomic_write` binary 函数

**v1.0/v1.1 spec §4.1 写**: "util/atomic_write::atomic_write secret.key (binary 写)"

**真实**: atomic_write.rs:88 只有 `atomic_write_json<T: Serialize>`. **没有** binary 写函数.

**修复**: v1.2 spec §4.1 表格改: secret 走 `atomic_write_json` 写 `{"secret": "..."}` JSON 格式,
 不需要 binary 写. §5.5 secret.json 替代 secret.key.

### F3: 编造的依赖列表

**v1.0/v1.1 spec §8.1 写**: "加 axum/hmac/sha2/hex/rand 5 依赖"

**真实**: Cargo.toml 9 个 dep 无这 5 个. 而 `rand` 不需要 - `getrandom` 是 Rust 实践,
 v4 Cargo.lock 已有 transitive.

**修复**: v1.2 spec §4.3 改成 4 依赖 (axum/hmac/sha2/hex) + getrandom + tokio + parking_lot.

### F4: 漏 capabilities/pet.json ACL

**v1.0/v1.1 spec §4.1 写**: "capabilities/pet.json 允许 pet 窗口权限"

**真实**: capabilities/default.json 是白名单模式 `windows: ["main"]`. Tauri 2 不允许
 default 隐式覆盖 — 加新 window **必须** 显式列出, 而且需要 permissions 数组.

**修复**: v1.2 spec §8.4 完整写 capabilities/pet.json 模板 + 3 个 permissions.

### F5: 二手信息 PermissionRequest

**v1.0/v1.1 spec §3.1 Layer 1 写**: "PermissionRequest → PermissionPrompt"

**真实**: Claude Code **没有** PermissionRequest hook event (Hopet 文档里写的 PermissionRequest
 是 Hopet 自己的概念, 不是 Claude Code 的 hook event 名). 同时 spec 还漏了 `SubagentStop`
 (Claude Code 真实有).

**根因**: 我网络沙箱拒了 docs.anthropic.com, 但凭 Hopet 文档 + 中文博客抄了二手信息.

**修复**: v1.2 spec §3.2.2 用 v4 `repo/hooks_scanner::HOOK_EVENTS` 真实名单 (hooks_scanner.rs:9-11),
 砍 PermissionPrompt (PetState 8→7), 加 SubagentStop, D34.8 决策记录.

### F5 副作用: PermissionPrompt 状态砍掉

webSearch 摘要 + v4 HOOK_EVENTS 交叉验证 6 个真实 event:
PreToolUse/PostToolUse/Stop/SubagentStop/Notification/UserPromptSubmit.

Notification 重新映射到 AskUser (Claude Code "通知" 是最接近"需用户介入"的概念).

### 3 个设计澄清 (D34.10-D34.14)

| 决策 | v1.2 加在哪 |
|---|---|
| D34.10 PetStateDaemon 独立 daemon + mpsc + parking_lot 锁 | §11.1 / §11.2 |
| D34.11 synthetic idle 后端 spawn timer, 不走前端 setTimeout | §11.3 |
| D34.12 secret.json (JSON) 替代 binary 写 | §5.5 |
| D34.13 capabilities/pet.json 显式白名单 | §8.4 |
| D34.14 HOOK_TO_STATE 集中常量 | §5.2 |

## 教训 (二手信息)

1. **网络沙箱拒 docs.anthropic.com 不能编造答案**. 上轮我 spec 抄 Hopet 文档 + 博客,
   写出 F5. 本轮由 WebSearch 摘要 + v4 HOOK_EVENTS 实测数据交叉验证, 仍带"⚠️ 待真机手验"
   风险标签 (§5.3 §9.3 第 9 步).
2. **凭印象写代码 = 写错误代码**. F1-F3 全是凭 v3.1 印象. v4 commit 11 教训 (D17) 同样
   写过 "v3.1 → v4 schema 平移必须看真实数据", 这次踩坑是没把这教训同步到 pet spec 写作.
3. **真机手验是 spec 写完后的最后一道闸**. §9.3 第 9 步专门查字段名, 因为 AgentStateEvent
   字段是 WebSearch 摘要推断, 真实 hook payload 字段名可能完全不一样.
4. **用户 review 是 spec 质量的实际门控**. v1.0 → v1.1 (4 fix) → v1.2 (5 fix + 3 澄清) = 
   3 轮 review 才把硬错挖出来. brainstorming 自查 + 自我检查覆盖不到二手信息 / v4 路径,
   只有用户实战 review 才能命中.

---

# v1.2 → implementation 落地 sediment (commit 0e7f5c1..0048807, 10 commits)

## 执行流程

走 `superpowers:subagent-driven-development` skill (5 task = 5 implementer subagent + 5 task reviewer + 4 fix subagent + 1 final reviewer + 1 final cleanup).

每个 task 严格 TDD: test → fail → impl → pass → commit.
每个 commit 后跑 v4 三步验证 (cargo check + tsc + build:vite), 全 exit 0.

## 10 commit 链

| commit | type | 内容 |
|---|---|---|
| 0e7f5c1 | feat (c1) | PetState 7 状态 + HOOK_TO_STATE 集中映射表 |
| 5d7f4cf | feat (c2) | 5 IPC handlers + window open/close stub |
| b36311c | feat (c3) | cc-status-emit binary + [[bin]] 段 |
| 2f8236e | fix  (c3 review) | 3 required issues: 删 duplicated state_for_hook (改用 app_lib::pet::state::event_name_to_state_str) / 修 test env leak / 删 _url dead param |
| 3a2774d | feat (c4) | HTTP receiver + PetStateDaemon + install/uninstall |
| 109473c | fix  (c4 review) | install_test C1 (断言逻辑错) + I1 (HOOK_EVENTS_REAL 改用真 HOOK_EVENTS) |
| 00266b0 | feat (c5) | 前端 PetModule/PetWindow + capabilities |
| ff5c682 | fix  (c5 review) | 3 Critical + 2 Minor: vite path (git mv src/pet.html → pet.html) / synthetic idle emit / install gate / catch any / payload any |
| fed6272 | fix  (c5 review2) | JSX comment 包装 (// 行注释被 JSX 当 children 渲染) |
| 0048807 | chore | Final cleanup: use position + dead_code + plan doc drift |

## 关键 bug 修复 (per-task review 抓到)

1. **c3 review**: duplicated `state_for_hook` 在 binary 里 (破坏 single source of truth)
   → 加 `event_name_to_state_str` helper 到 state.rs, binary 调 `app_lib::pet::state::event_name_to_state_str`
2. **c4 review**: `test_install_skips_already_installed_hooks` 断言 `installed=5, skipped=1` 但 pre-seed 用 `other-tool` (没 cc-status-emit), 实际应是 `installed=6, skipped=0`
   → 改 pre-seed 为 `cc-status-emit --event tool-use` + 加单独 test 测 `other-tool` 保留场景
3. **c5 review Critical**: vite 输出 `dist/src/pet.html` 而 `WebviewUrl::App("pet.html")` 要 `dist/pet.html` —— 404
   → `git mv src/pet.html pet.html` + vite config `pet: 'pet.html'`
4. **c5 review Critical**: synthetic idle spawn 闭包没 clone AppHandle, broadcast 没 prod 订阅者 → 宠物卡 ✅ 不切回 😐
   → spawn 闭包加 `let app = self.app.clone();` + emit 同步调用
5. **c5 review Critical**: "打开宠物窗口" 按钮 `disabled={installed !== true}` 但 `installed` 不持久化 → 重启后无法打开
   → 删 disabled (PetWindow 无 hook 也无害, 显示 idle)
6. **c5 review2**: JSX 里 `// D34 fix` 行注释不是 JSX 注释, 被当 children 渲染成中文文本泄露到 UI
   → 改 `{/* */}` JSX 注释语法

## Final review verdict

Spec compliance ✅ / Code quality Approved / Integration ✅ / Ready to merge: **No** (real-device test gate)

**唯一阻塞风险 (N3)**: AgentStateEvent 字段名 (`session_id` / `cwd` / `tool_name` / `skill_name` / `mcp_server`) 是 WebSearch 摘要推断, 没查 Claude Code 官方文档. **真机手验必跑** (spec §9.3 第 9 步). 字段名不符就 fix `state.rs` + `cc-status-emit.rs` mapping. 这是发布前最后闸门.

## 教训 (这次执行)

1. **reviewer 抓到的 bug 全是真 bug, 不能 performative agree**.
   c3 duplicated state_for_hook / c5 vite path / c5 synthetic idle emit / c5 JSX comment — 每条都是破坏性 bug, 不是 nit. per-task review 不能省.

2. **fix subagent 也可能出 bug, 必须 re-review**.
   c5 fix subagent 把 `//` 行注释写进 JSX, 又被抓. **fix 完直接进 final review 不行**, 必须 fix-review loop.

3. **vite multi-entry 的 input key 不决定 output 路径**.
   `pet: 'src/pet.html'` → 输出 `dist/src/pet.html` (不是 `dist/pet.html`). Vite/rollup 从 input 路径推 output. 文件必须在 root + `pet: 'pet.html'` 才能输出 `dist/pet.html`.

4. **broadcast::Sender 没 prod 订阅者就是死代码**.
   c5 第一次实现 spawn synthetic idle 只广播, 没 emit. broadcast channel 是 daemon 内部组件, 没 Tauri emit 桥接 = 前端收不到. **daemon emit 必须跟 broadcast 同步**.

5. **CLAUDE.md §14.5 三步 `cargo check` 不编译 `#[cfg(test)]` 模块**.
   Test-only edit (改断言) 不会触发 cargo check 验证. 必须加 `cargo check --all-targets` 或 `cargo check --profile test` 覆盖. 4-task reviewer N1 抓到. v4 验证纪律需要扩.

6. **JSX `//` 不是注释, 是字符串 children**.
   Rust 写代码习惯 `//` 行注释, JSX 不识别. 必须 `{/* */}`. 这条 v3.1 Electron 时代不存在, 但 Tauri 2 + React 项目必须注意.

7. **subagent 不应假设 push, dispatch prompt 必须明确说 "local commits only, no push"**.
   第一次 Task 5 dispatch 被 auto-mode classifier 误判 push 拒绝. 第二次明确写 "DO NOT push, local commits only" 通过. 跟 CLAUDE.md §11 保持一致, 也让 subagent 知道约束.