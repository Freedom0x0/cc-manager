# CC Pet 集成设计 (Hopet-like Desktop Pet)

> 版本: v1.0
> 日期: 2026-08-03
> 状态: Draft — 待评审后进入 plan 阶段
> 关联: v4 spec (`2026-07-28-cc-session-manager-v4-design.md`) · Hopet README & DevDocs

---

## 1. 概述

### 1.1 项目定位

在 cc-manager (Tauri 2) 内做一个**嵌入式桌面宠物**，提供类似 [Hopet](https://github.com/BinaryFroggy/Hopet) 的功能：
- 实时显示 Claude Code agent 当前在调用哪些 skill 和 mcp
- 会话完成时提醒用户
- 像素动物 + 动画 + 气泡状态显示

**不引入新依赖**：不引入 Swift（Hopet 是 Swift），不引入新 Tauri 构建目标，纯 Rust + React。

### 1.2 跟 Hopet 的差异

| 维度 | Hopet | cc-pet |
|---|---|---|
| 语言 | Swift 5.10 | Rust + TypeScript |
| 平台 | macOS 14+ only | Windows 10/11 + macOS 10.15+ |
| 进程模型 | 独立 `.app` | 嵌入 cc-manager 主进程（多 WebviewWindow） |
| 生命周期 | 独立运行，主 App 关掉宠物仍在 | 主 App 关 = 宠物消失（嵌入式语义） |
| IPC | Unix Domain Socket | HTTP localhost:19847 (跨平台兼容) |
| 主题 | 内置 Hopi 像素海豹 + 用户自定义 | v1 只内置 Hopi 风格的 8 状态 GIF（无主题导入） |

### 1.3 非目标 (v1)

- ❌ 跨 session 优先级聚合（v1 只反映当前焦点 session）
- ❌ 用户自定义主题导入（v1 只有内置 8 GIF）
- ❌ 灵动岛 / 顶部状态条（macOS 专属能力，v1 不做）
- ❌ Permission 气泡 Allow/Deny（v1 只观察不介入）
- ❌ 多 session 同时显示多个气泡（v1 单气泡）
- ❌ Codex CLI 集成（v1 只支持 Claude Code）

### 1.4 v2+ 接口预留

| 能力 | 预留接口 |
|---|---|
| 多 session 聚合 | `AgentStateEvent.session_id` 已有，`PetState::priority()` 已实现 |
| 自定义主题 | `PetWindow.tsx` 接 `theme_id` 参数 + `~/.claude/themes/<id>/` 目录约定 |
| 灵动岛 | Tauri 2 `WebviewWindow` 配置项加 macOS-specific 段 |
| Permission 气泡 | `PermissionRequest` hook 已在 hook 列表，v2 加 `response_url` 字段 |
| Codex CLI | `~/.codex/hooks.json` 同款模式，cc-status-emit 支持 `--target codex` |

---

## 2. 术语表

| 术语 | 含义 |
|---|---|
| **PetWindow** | Tauri 2 独立 WebviewWindow，无边框/置顶/不可聚焦，显示像素动物 + 气泡 |
| **PetState** | 8 状态枚举 (`Idle/Responding/Thinking/ToolUse/PermissionPrompt/AskUser/Completed/ErrorInterrupted`) |
| **AgentStateEvent** | hook 上报的单个事件，含 session_id / state / tool_name 等 |
| **EventBus** | Rust `tokio::sync::broadcast<AgentStateEvent>`，主窗口和宠物窗口都订阅 |
| **cc-status-emit** | 新增 Rust 二进制，从 stdin 读 hook payload → HTTP POST 到 cc-manager |
| **HTTP Receiver** | axum server (127.0.0.1:19847)，验证 HMAC + 推到 EventBus |
| **Secret** | 32 字节随机密钥，存 `app_data_dir/secret.key`，嵌入 hook 环境变量 `CC_PET_SECRET` |

---

## 3. 系统架构

### 3.1 五层架构

```
┌────────────────────────────────────────────────────────────┐
│ Layer 5: 宠物窗口（独立 Tauri WebviewWindow）                 │
│   PetWindow.tsx — 像素动物 GIF + 气泡                       │
│   - 始终置顶 + 透明 + skip taskbar + 无焦点                  │
│   - 位置记忆: app_data_dir/pet_position.json                │
└────────────────────────────────────────────────────────────┘
                         ↑ listen('agent-state-event')
┌────────────────────────────────────────────────────────────┐
│ Layer 4: EventBus (Rust in-process broadcast)               │
│   - tokio::sync::broadcast<AgentStateEvent>                │
│   - 主窗口订阅 → 写 React state                             │
│   - 宠物窗口订阅 → 写自己的 state                            │
│   - 内存 sessions HashMap<session_id, AgentStateEvent>     │
└────────────────────────────────────────────────────────────┘
                         ↑ HTTP POST /agent-event (HMAC signed)
┌────────────────────────────────────────────────────────────┐
│ Layer 3: HTTP Receiver (axum, 127.0.0.1:19847)              │
│   POST /agent-event                                        │
│     - 验签: HMAC-SHA256(secret, body)                       │
│     - 解析 AgentStateEvent                                   │
│     - EventBus.broadcast(event)                             │
│   GET /agent-state — 主窗口启动时拉取当前状态              │
└────────────────────────────────────────────────────────────┘
                         ↑ stdin JSON
┌────────────────────────────────────────────────────────────┐
│ Layer 2: cc-status-emit (Rust bin, <workspace>/target/)    │
│   - 从 stdin 读 Claude Code hook payload (JSON)            │
│   - 加 HMAC 签名 → POST 127.0.0.1:19847/agent-event       │
│   - 失败静默 (exit 0), 不污染 agent 终端                    │
└────────────────────────────────────────────────────────────┘
                         ↑ hook event
┌────────────────────────────────────────────────────────────┐
│ Layer 1: Claude Code hooks (装在 ~/.claude/settings.json)   │
│   - UserPromptSubmit → Responding                          │
│   - PreToolUse        → ToolUse                            │
│   - PostToolUse       → ToolUse (completed 部分)           │
│   - Stop              → Completed                          │
│   - Notification      → PermissionPrompt                   │
│   - PermissionRequest → PermissionPrompt                   │
└────────────────────────────────────────────────────────────┘
```

### 3.2 三层链路 (CLAUDE.md §3)

**前端 → IPC → 后端 → DB**:

1. **前端**: PetModule.tsx 调 `api.installStatusHook()` (Tauri invoke)
2. **IPC**: `cmd_pet_install_status_hook` (lib.rs 新增)
3. **后端**: 调用 `repo/hooks_writer.rs` 的 `create_hook` 模式写 `~/.claude/settings.json` (复用 commit 9)
4. **DB**: 不写 DB，secret 写 `app_data_dir/secret.key`

**事件上报链路**:

1. **前端**: 宠物窗口 `listen('agent-state-event', cb)` (Tauri event)
2. **IPC**: 不走 invoke，事件走 Rust 内部 broadcast → emit → JS 端 event listener
3. **后端**: HTTP receiver 接收 → 解析 → broadcast

---

## 4. 组件设计

### 4.1 文件清单

| 路径 | 作用 | 行数估算 | commit |
|---|---|---|---|
| `src-tauri/src/pet/mod.rs` | EventBus + HTTP 接收器 + 5 IPC handler 注册 | 220 | c1 + c2 + c4 |
| `src-tauri/src/pet/state.rs` | `PetState` 枚举 + `AgentStateEvent` schema + priority + 测试 | 80 | c1 |
| `src-tauri/src/bin/cc-status-emit.rs` | stdin → HTTP POST helper | 80 | c3 |
| `src/modules/pet/PetModule.tsx` | 主 Tab: 装 hook 按钮 + 打开宠物窗口按钮 + 状态总览 | 220 | c5 |
| `src/modules/pet/PetWindow.tsx` | 宠物窗口内容 (像素 + 气泡) | 280 | c5 |
| `src/pet-main.tsx` | PetWindow 独立 React 入口 | 40 | c5 |
| `src/pet.html` | Tauri pet window 加载的 HTML | 5 | c5 |
| `src-tauri/capabilities/pet.json` | Tauri capability: pet 窗口权限 | 30 | c5 |
| `src-tauri/src/pet/state_test.rs` (cfg test) | 8 状态 priority + 转换测试 | 60 | c1 |
| `src-tauri/src/bin/cc-status-emit_test.rs` (cfg test) | stdin → HTTP POST mock 测试 | 60 | c3 |
| `src-tauri/src/pet/http_test.rs` (cfg test) | HTTP receiver 验签 + 解析 | 80 | c4 |
| `docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md` | 本文档 | — | c0 |

### 4.2 复用现有模块

| 现有 | 用途 |
|---|---|
| `repo/hooks_scanner.rs` | 安装 hook 前扫描, 检查是否已存在 (避免覆盖) |
| `repo/hooks_writer.rs` | `create_hook` 模式 — 走 atomic_write_json (commit 9 已验) |
| `util/settings_reader.rs` | 读 `~/.claude/settings.json` |
| `util/atomic_write.rs` | 原子写 (commit 7 模式, 已验 150+ case) |
| `types::HookCreateInput` | 创建 hook 的输入类型 (commit 9) |
| `tauri::WebviewWindowBuilder` | 第二窗口创建 (Tauri 2 原生) |

---

## 5. 数据模型

### 5.1 PetState 枚举 (state.rs)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PetState {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "responding")]
    Responding,
    #[serde(rename = "thinking")]
    Thinking,
    #[serde(rename = "tool-use")]
    ToolUse,
    #[serde(rename = "permission-prompt")]
    PermissionPrompt,
    #[serde(rename = "ask-user")]
    AskUser,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "error-interrupted")]
    ErrorInterrupted,
}

impl PetState {
    pub fn priority(&self) -> u8 {
        match self {
            Self::AskUser => 100,
            Self::PermissionPrompt => 90,
            Self::ErrorInterrupted => 80,
            Self::ToolUse => 70,
            Self::Thinking => 60,
            Self::Responding => 50,
            Self::Completed => 40,
            Self::Idle => 0,
        }
    }
}
```

### 5.2 AgentStateEvent schema

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateEvent {
    pub session_id: String,                    // Claude Code session uuid
    pub cwd: Option<String>,                   // 当前工作目录
    pub title: Option<String>,                 // session 标题
    pub state: PetState,
    pub tool_name: Option<String>,             // 触发的 tool 名字
    pub skill_name: Option<String>,            // 若 tool_name 是 Skill, 提取
    pub mcp_server: Option<String>,            // 若 tool_name 是 mcp__xxx__yyy
    pub elapsed_ms: Option<i64>,               // 当前状态持续
    pub timestamp_ms: i64,                     // ms since epoch
    #[serde(default)]
    pub payload: serde_json::Value,            // 原始 hook payload
}
```

### 5.3 HTTP 协议

```
POST /agent-event
Content-Type: application/json
X-Signature: hmac-sha256=<hex>           # HMAC(secret, body)
X-Project: <cwd basename>

Body: AgentStateEvent (JSON)

Response:
  200 OK    {"ok": true, "active_sessions": 3}
  401 Unauthorized  {"error": "invalid signature"}
  400 Bad Request  {"error": "schema invalid", "details": "..."}

GET /agent-state
  Response: Vec<AgentStateEvent>           # 所有 session 最新事件
```

### 5.4 Secret 管理

- **生成时机**: 第一次启动 cc-manager 时 (`cmd_pet_install_status_hook` 首次调用时若不存在)
- **存储**: `app_data_dir/secret.key`, 仅本机用户可读 (chmod 600 / icacls)
- **长度**: 32 字节随机, hex 编码 = 64 字符
- **嵌入方式**: hook 命令模板 `<cc-status-emit> --secret "$CC_PET_SECRET"`, 通过 settings.json 的 env 段注入

**settings.json env 段** (Claude Code 支持):
```json
{
  "env": {
    "CC_PET_SECRET": "<64-char-hex>"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<path-to-cc-status-emit> --event tool-use"
          }
        ]
      }
    ]
  }
}
```

---

## 6. 6 个 IPC (5 写 + 1 读)

```rust
// c1: 不挂线 (空壳 mod 注册)
// c2: 注册 4 个 IPC
#[tauri::command]
async fn cmd_pet_install_status_hook(app: tauri::AppHandle) -> Result<InstallResult, String>;

#[tauri::command]
async fn cmd_pet_uninstall_status_hook(app: tauri::AppHandle) -> Result<UninstallResult, String>;

#[tauri::command]
async fn cmd_pet_window_open(app: tauri::AppHandle) -> Result<(), String>;

#[tauri::command]
async fn cmd_pet_window_close(app: tauri::AppHandle) -> Result<(), String>;

#[tauri::command]
fn cmd_pet_get_status(state: tauri::State<PetStateManager>) -> Result<PetStatusResponse, String>;
```

```typescript
// c5: 前端 api-tauri.ts 加 5 个 wrapper
export const api = {
  // ...existing 60...
  petInstallStatusHook: () => invoke<InstallResult>('cmd_pet_install_status_hook'),
  petUninstallStatusHook: () => invoke<UninstallResult>('cmd_pet_uninstall_status_hook'),
  petWindowOpen: () => invoke<void>('cmd_pet_window_open'),
  petWindowClose: () => invoke<void>('cmd_pet_window_close'),
  petGetStatus: () => invoke<PetStatusResponse>('cmd_pet_get_status'),
};
```

---

## 7. 错误处理 (5 类)

| ID | 场景 | 处理 |
|---|---|---|
| E1 | cc-manager 未启动时 agent 发事件 | `cc-status-emit` POST 失败 → 静默丢弃 (exit 0), 不污染终端 |
| E2 | HMAC 验签失败 (假事件) | 返 401, 不上 EventBus, 记 `eprintln!` |
| E3 | schema 不合法 | 返 400 + 详情, 不上 EventBus, 写 `agent_event_dropped.log` |
| E4 | 端口 19847 被占 | 启动 bind 失败 → cmd_pet_window_open 返错, 主 App 其他功能正常 |
| E5 | Tauri 窗口创建失败 (权限/DWM) | 返错给前端, antd notification.error 提示 |

---

## 8. 部署: 5 commit 节奏

| commit | 内容 | 行数 | 风险 | 验证 |
|---|---|---|---|---|
| **c1** | `pet/state.rs` + 测试 + `pet/mod.rs` 空壳 + lib.rs 注册 | +120 | 0 | cargo check + tsc + build:vite |
| **c2** | `cmd_pet_get_status` + `cmd_pet_window_open/close` + `cmd_pet_install/uninstall_status_hook` 占位 | +80 | 0 | 同上 |
| **c3** | `bin/cc-status-emit.rs` + Cargo.toml `[[bin]]` + tests | +100 | 中 (首次第二 bin) | cargo test --lib pet cc-status-emit |
| **c4** | HTTP 接收器 (axum) + HMAC + EventBus + 真装 hook (用 hooks_writer 模式) + axum 依赖 | +220 | 中 (首次 HTTP) | cargo test --lib pet::http |
| **c5** | 前端 PetModule/PetWindow/pet-main/pet.html + 5 wrapper + capabilities/pet.json | +500 | 高 (前端最大改动) | 端到端手验 4 步 |

### 8.1 Cargo.toml 改动

c3:
```toml
[[bin]]
name = "cc-session-manager"  # 现有
path = "src/main.rs"

[[bin]]
name = "cc-status-emit"
path = "src/bin/cc-status-emit.rs"
```

c4:
```toml
[dependencies]
axum = "0.7"
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
rand = "0.8"
```

### 8.2 tauri.conf.json 改动 (c2)

不修改 `app.windows` 数组（宠物窗口运行时创建，不在 conf 预声明）。

### 8.3 反向兼容 / 回滚

- 全部新增, 回滚 = `git revert <commit>`
- hook 安装走 **非破坏性 merge** (跟 Hopet 同款, 跟 v3.1 commit 5 同款)
- secret 删了 = hook 失败, 事件丢但不破坏其他功能
- 端口冲突 = E4, 宠物窗打不开但其他模块正常

---

## 9. 验证计划

### 9.1 自动化 (CLAUDE.md §14.5 v4.0 三步)

| 步骤 | 命令 | 期望 |
|---|---|---|
| 1 | `cd src-tauri && cargo check` | 0 错 |
| 2 | `npx tsc --noEmit` | 0 错 |
| 3 | `npm run build:vite` | dist 含 `pet.html` |

### 9.2 单元测试 (CI 跑)

| 文件 | case 数 |
|---|---|
| `state_test.rs` | 8 状态 priority 排序 + 转换合法性 (≥5 case) |
| `cc-status-emit_test.rs` | stdin JSON → HTTP POST mock (≥3 case) |
| `http_test.rs` | HMAC 验签 + schema 校验 + EventBus 广播 (≥5 case) |

合计 ≥13 case, 全过。

### 9.3 端到端手验 (release 前必跑, v4 D24/D25 节奏)

1. `npm run dev:tauri` → 主窗口起
2. 点 Pet Tab → 看 "Install Agent Status Hook" 按钮
3. 点按钮 → 装 6 个 hook 到 `~/.claude/settings.json`
4. 验: `cat ~/.claude/settings.json | jq '.hooks | keys'`
5. 点 "Open Pet Window" → 看像素动物 + 气泡
6. 跑真 Claude Code (用 dev:tauri 的同 shell 起 `claude`)
7. 观察: 气泡切换到 "Tool Use: xxx" / "Thinking" / "Completed"
8. 验 4 步全过 → commit c5 → tag v4.1.0-pet-alpha

### 9.4 v4.1 验证纪律延伸

CLAUDE.md D24/D25 已写明: SmartScreen 拦 cargo test runtime, 本次也走 `cargo check` 兜底。runtime 验证留给 CI runner (Linux, 无 SmartScreen)。

---

## 10. 数据流 (3 个时序)

### T1: 用户装 hook

```
User: Pet Tab → 点 "Install Agent Status Hook"
  → api.petInstallStatusHook() → invoke('cmd_pet_install_status_hook')
  → 后端:
     1. 读 ~/.claude/settings.json (settings_reader)
     2. 若 secret 不存在 → 生成 32 字节随机, 写 app_data_dir/secret.key
     3. atomic_write: env.CC_PET_SECRET = secret (非破坏性 merge)
     4. atomic_write: hooks.PreToolUse/PostToolUse/Stop/Notification/PermissionRequest/UserPromptSubmit
        各加一条 → "<cc-status-emit> --event <state> --secret \"$CC_PET_SECRET\""
     5. 启动 axum HTTP server (若未起) — spawn tokio task
  → 返回 InstallResult { installed: 6, skipped: 0 }
```

### T2: agent PreToolUse 触发 (调用 Skill)

```
Claude Code: PreToolUse hook 触发
  → <cc-status-emit> --event tool-use
     stdin = {session_id, cwd, tool_name: "Skill", tool_input: {skill: "commit"}, ...}
  → cc-status-emit:
     1. 读 stdin JSON
     2. 加 HMAC-SHA256(secret, body) → X-Signature header
     3. POST 127.0.0.1:19847/agent-event
  → HTTP receiver:
     1. 验签 (HMAC 比对)
     2. 解析 AgentStateEvent
     3. EventBus.broadcast(event)
     4. sessions HashMap 写入 (覆盖旧 event)
  → PetWindow (若开着): listen('agent-state-event') → 切到 tool-use GIF
     → 气泡: "调用 Skill: commit"
  → 主窗口 PetModule: 同 listen → 更新 status badge
```

### T3: agent Stop 触发 (完成)

```
Claude Code: Stop hook 触发
  → <cc-status-emit> --event completed
  → POST → HTTP receiver → EventBus
  → PetWindow: 切到 completed GIF + 气泡 "完成: <last assistant text 前 80 字>"
  → 同时: 主窗口 listen → antd notification.success 弹窗
  → PetWindow 5 秒后自动切回 Idle (delay 5s, then send synthetic idle event)
```

---

## 11. 关联决策

| 决策 | 内容 |
|---|---|
| D34 | cc-pet 模块整体设计 (本 spec) |
| D34.1 | 嵌入式宠物窗口, 跟随主 App 生命周期 |
| D34.2 | HTTP localhost:19847 替代 UDS, 跨平台 |
| D34.3 | HMAC-SHA256 防假事件, secret 存 app_data_dir |
| D34.4 | 5 commit 节奏 (c1-c5), 每个独立可回滚 |
| D34.5 | v1 不做多 session 聚合 / 自定义主题 / 灵动岛 / Permission 介入 / Codex CLI |

---

## 12. 待办 (留给 writing-plans 阶段)

1. **像素动物 GIF**: 8 个状态各一段 GIF, 来源待定 (自画/采购/简化抽象)
2. **气泡布局**: 头像周围/上方, 滚动 / 折叠行为
3. **位置记忆**: 拖拽事件 + localStorage 同步逻辑
4. **透明背景**: macOS NSPanel vs Win32 alpha 兼容性测试
5. **5 commit 各自 TDD 红绿重构节奏**: test → impl → 绿 → commit, 不批量