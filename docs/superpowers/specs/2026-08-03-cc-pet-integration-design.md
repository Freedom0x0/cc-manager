# CC Pet 集成设计 (Hopet-like Desktop Pet)

> 版本: v1.2
> 日期: 2026-08-03
> 状态: Draft — 待用户 review 通过 + 真机手验后进 writing-plans
> 关联: v4 spec (`2026-07-28-cc-session-manager-v4-design.md`) · Hopet README & DevDocs

---

## 1. 概述

### 1.1 项目定位

在 cc-manager (Tauri 2) 内做一个**嵌入式桌面宠物**，提供类似 [Hopet](https://github.com/BinaryFroggy/Hopet) 的功能：
- 实时显示 Claude Code agent 当前在调用哪些 skill 和 mcp
- 会话完成时提醒用户
- 像素动物 + 动画 + 气泡状态显示

**不引入新依赖**:不引入 Swift (Hopet 是 Swift), 不引入新 Tauri 构建目标, 纯 Rust + React。

### 1.2 跟 Hopet 的差异

| 维度 | Hopet | cc-pet |
|---|---|---|
| 语言 | Swift 5.10 | Rust + TypeScript |
| 平台 | macOS 14+ only | Windows 10/11 + macOS 10.15+ |
| 进程模型 | 独立 `.app` | 嵌入 cc-manager 主进程 (多 WebviewWindow) |
| 生命周期 | 独立运行, 主 App 关掉宠物仍在 | 主 App 关 = 宠物消失 (嵌入式语义) |
| IPC | Unix Domain Socket | HTTP localhost:19847 (跨平台兼容) |
| 主题 | 内置 Hopi 像素海豹 + 用户自定义 | v1 只内置 Hopi 风格的 7 状态 GIF (无主题导入) |

### 1.3 非目标 (v1)

- ❌ 跨 session 优先级聚合 (v1 只反映当前焦点 session)
- ❌ 用户自定义主题导入 (v1 只有内置 7 GIF)
- ❌ 灵动岛 / 顶部状态条 (macOS 专属能力, v1 不做)
- ❌ Permission 气泡 Allow/Deny (v1 只观察不介入)
- ❌ 多 session 同时显示多个气泡 (v1 单气泡)
- ❌ Codex CLI 集成 (v1 只支持 Claude Code)
- ❌ **PermissionPrompt 状态** (v1.2 砍 — Claude Code 无此 hook event, 见 D34.8)

### 1.4 v2+ 接口预留

| 能力 | 预留接口 |
|---|---|
| 多 session 聚合 | `AgentStateEvent.session_id` 已有, `PetState::priority()` 已实现 |
| 自定义主题 | `PetWindow.tsx` 接 `theme_id` 参数 + `~/.claude/themes/<id>/` 目录约定 |
| 灵动岛 | Tauri 2 `WebviewWindow` 配置项加 macOS-specific 段 |
| Codex CLI | `~/.codex/hooks.json` 同款模式, cc-status-emit 支持 `--target codex` |

---

## 2. 术语表

| 术语 | 含义 |
|---|---|
| **PetWindow** | Tauri 2 独立 WebviewWindow, 无边框/置顶/不可聚焦, 显示像素动物 + 气泡 |
| **PetState** | 7 状态枚举 (v1.2 砍 PermissionPrompt) |
| **AgentStateEvent** | hook 上报的单个事件, 含 session_id / state / tool_name 等 |
| **EventBus** | Rust `tokio::sync::broadcast<AgentStateEvent>`, 主窗口和宠物窗口都订阅 |
| **PetStateDaemon** | 后台 tokio task, 维护 sessions HashMap + 触发 synthetic idle (v1.2 §11.3) |
| **cc-status-emit** | 新增 Rust 二进制, 从 stdin 读 hook payload → HTTP POST 到 cc-manager |
| **HTTP Receiver** | axum server (127.0.0.1:19847), 验证 HMAC + 推到 EventBus |
| **Secret** | 32 字节随机 hex 字符串, 存 `app_data_dir/secret.json` (不是 binary 文件) |

---

## 3. 系统架构

### 3.1 五层架构

```
┌────────────────────────────────────────────────────────────┐
│ Layer 5: 宠物窗口 (独立 Tauri WebviewWindow)                │
│   PetWindow.tsx — 像素动物 GIF + 气泡                       │
│   - 始终置顶 + 透明 + skip taskbar + 无焦点                  │
│   - 位置记忆: app_data_dir/pet_position.json                │
└────────────────────────────────────────────────────────────┘
                         ↑ listen('agent-state-event')
┌────────────────────────────────────────────────────────────┐
│ Layer 4: EventBus + PetStateDaemon (Rust in-process)       │
│   - tokio::sync::broadcast<AgentStateEvent>                │
│   - PetStateDaemon 维护 sessions HashMap<session_id, event>│
│     + 触发 synthetic idle (Stop 后 5s)                     │
│   - 主窗口订阅 → 写 React state                             │
│   - 宠物窗口订阅 → 写自己的 state                            │
└────────────────────────────────────────────────────────────┘
                         ↑ HTTP POST /agent-event (HMAC signed)
┌────────────────────────────────────────────────────────────┐
│ Layer 3: HTTP Receiver (axum, 127.0.0.1:19847)              │
│   POST /agent-event                                        │
│     - 验签: HMAC-SHA256(secret, body)                       │
│     - 解析 AgentStateEvent                                   │
│     - 提交到 PetStateDaemon (mpsc channel)                   │
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
│   仅装 6 个真实存在的 hook event (v4 HOOK_EVENTS 实测):     │
│   - UserPromptSubmit → Responding                          │
│   - PreToolUse        → ToolUse                            │
│   - PostToolUse       → ToolUse (completed 部分)           │
│   - Stop              → Completed                          │
│   - SubagentStop      → Completed                          │
│   - Notification      → NotificationPrompt (v1.2 新增)    │
│                                                              │
│   **不**装 PermissionRequest (Claude Code 无此 event)       │
└────────────────────────────────────────────────────────────┘
```

### 3.2 三层链路 (CLAUDE.md §3)

**前端 → IPC → 后端 → DB**:

1. **前端**: PetModule.tsx 调 `api.petInstallStatusHook()` (Tauri invoke)
2. **IPC**: `cmd_pet_install_status_hook` (lib.rs 新增)
3. **后端**: 调用**新**函数 `repo/pet/install.rs::install_status_hooks(settings_path, secret)`
   - **不**直接复用 `repo/hooks_writer::create_hook` — 见 §3.2.1
   - 调用 `repo/hooks_scanner::list_hooks` + `HOOK_EVENTS` 做"是 6 个真实存在的 event"检查
   - 调用 `util/settings_reader::read_claude_settings` + 手动 serde_json merge env 段
   - 调用 `util/atomic_write::atomic_write_json` 原子写
   - 用 `getrandom` 生成 32 字节 hex secret, 写 `app_data_dir/secret.json` (JSON 格式, 不是 binary)
4. **DB**: 不写 DB; secret 写 `app_data_dir/secret.json` 文件
   - **不**走 KV 表 (CLAUDE.md §13 D10 决策: KV 表是 cache + profile_capture 专用, 不作 UI 真实状态源)

**事件上报链路**:

1. **前端**: 宠物窗口 `listen('agent-state-event', cb)` (Tauri event)
2. **IPC**: 不走 invoke, 事件走 Rust 内部 broadcast → emit → JS 端 event listener
3. **后端**: HTTP receiver 接收 → 解析 → mpsc 提交 → PetStateDaemon 更新 HashMap + broadcast

### 3.2.1 为什么不直接复用 create_hook

`repo/hooks_writer::create_hook` (hooks_writer.rs:23-33) 限制:

| 项 | create_hook | install_status_hooks (新) |
|---|---|---|
| 一次写几条 | 1 条 | 6 条 |
| 写 `env` 段 | ❌ 不动 env | ✅ 写 CC_PET_SECRET |
| 已存在检查 | ❌ 无脑 push | ✅ scanner skip |
| 校验 event 名 | ❌ 透传 | ✅ 只允许 v4 HOOK_EVENTS |
| matcher 格式 | 透传 | "" (空, 匹配所有) |
| 错误回滚 | 写一半坏 | 全部 atomic (单文件) |

所以 install_status_hooks 是**新函数**, 但**内部**继续用 `atomic_write_json` + `read_claude_settings` 这两个底层原语 (跟 create_hook 同样依赖)。

### 3.2.2 hook event 名 vs Claude Code 真实 event 名

v1.0 spec 抄 Hopet 文档 / 中文博客, 误用了 `PermissionRequest` (不存在) 和漏了 `SubagentStop` (存在)。
v1.2 用 v4 `repo/hooks_scanner::HOOK_EVENTS` (hooks_scanner.rs:9-11) 真实名单:

```
PreToolUse, PostToolUse, Stop, SubagentStop, Notification, UserPromptSubmit
```

**WebSearch 摘要交叉验证**: 同样 6 个 (PreToolUse/PostToolUse/UserPromptSubmit/Notification/Stop/SubagentStop), 跟 v4 HOOK_EVENTS 一致。✅

---

## 4. 组件设计

### 4.1 文件清单

| 路径 | 作用 | 行数估算 | commit |
|---|---|---|---|
| `src-tauri/src/pet/mod.rs` | EventBus + PetStateDaemon + 5 IPC handler 注册 | 220 | c1 + c2 + c4 |
| `src-tauri/src/pet/state.rs` | `PetState` 7 状态 + `AgentStateEvent` + `HOOK_TO_STATE` 映射表 | 100 | c1 |
| `src-tauri/src/pet/daemon.rs` | PetStateDaemon: 接收 mpsc + 维护 HashMap + 触发 synthetic idle | 140 | c4 |
| `src-tauri/src/pet/install.rs` | `install_status_hooks` (写 env + 6 hooks atomic) + tests | 120 | c4 |
| `src-tauri/src/pet/http.rs` | axum server + HMAC + mpsc 提交 + tests | 180 | c4 |
| `src-tauri/src/bin/cc-status-emit.rs` | stdin → HTTP POST helper | 80 | c3 |
| `src-tauri/capabilities/pet.json` | Tauri capability: pet 窗口白名单 + permissions | 35 | c5 |
| `src/modules/pet/PetModule.tsx` | 主 Tab: 装 hook 按钮 + 打开宠物窗口按钮 + 状态总览 | 220 | c5 |
| `src/modules/pet/PetWindow.tsx` | 宠物窗口内容 (像素 + 气泡) | 280 | c5 |
| `src/pet-main.tsx` | PetWindow 独立 React 入口 | 40 | c5 |
| `src/pet.html` | Tauri pet window 加载的 HTML | 5 | c5 |
| `src-tauri/src/pet/state_test.rs` (cfg test) | 7 状态 priority + 转换测试 + HOOK_TO_STATE 映射 | 80 | c1 |
| `src-tauri/src/bin/cc-status-emit_test.rs` (cfg test) | stdin → HTTP POST mock 测试 | 60 | c3 |
| `src-tauri/src/pet/install_test.rs` (cfg test) | install_status_hooks atomic + 重复装 skip + env 段 merge | 80 | c4 |
| `src-tauri/src/pet/http_test.rs` (cfg test) | HTTP receiver 验签 + 解析 + mpsc 提交 | 80 | c4 |
| `src-tauri/src/pet/daemon_test.rs` (cfg test) | PetStateDaemon HashMap 更新 + synthetic idle 触发 | 80 | c4 |
| `docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md` | 本文档 | — | c0 |

### 4.2 复用现有模块 (v4 真实路径, 已 `git grep` 验证)

| 现有 (v4) | 用途 | 行 |
|---|---|---|
| `repo/hooks_scanner::HOOK_EVENTS` | 校验 event 在允许名单里 | repo/hooks_scanner.rs:9 |
| `repo/hooks_scanner::list_hooks` | 安装 hook 前扫描, 检查是否已存在 | repo/hooks_scanner.rs:13 |
| `util/settings_reader::read_claude_settings` | 读 `~/.claude/settings.json` | util/settings_reader.rs |
| `util/atomic_write::atomic_write_json` | 原子写 settings.json + secret.json | util/atomic_write.rs:88 |
| `repo/hooks_writer::create_hook` (单条) | **不直接复用**, 仅作"单条添加"参考模式 | repo/hooks_writer.rs:23 |

### 4.3 新增 crate 依赖 (v1.2 修正)

| Crate | 版本 | 用途 | 验证 |
|---|---|---|---|
| `axum` | 0.7 | HTTP server | ✅ Cargo.lock 已有 transitive |
| `hmac` | 0.12 | HMAC 验签 | 新增 |
| `sha2` | 0.10 | SHA-256 | 新增 |
| `hex` | 0.4 | secret hex 编码 | 新增 |
| `getrandom` | 0.3 | 32 字节随机 secret | ✅ Cargo.lock 已有 transitive |
| `tokio` | (Tauri 2 已带) | broadcast + mpsc | ✅ |
| `parking_lot` | (watcher 已带) | HashMap 互斥 | ✅ Cargo.lock 已有 transitive |

**v1.0 spec 误写** (v1.2 修正):
- ❌ `rand` crate — 实际不需要, `getrandom` 是 Rust 标准实践, v4 已有 transitive
- ❌ `atomic_write` binary 函数 — 实际不存在, secret 走 `atomic_write_json` 写 `{"secret": "..."}`

---

## 5. 数据模型

### 5.1 PetState 枚举 (7 状态, v1.2 砍 PermissionPrompt)

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
            Self::ErrorInterrupted => 90,
            Self::ToolUse => 80,
            Self::Thinking => 70,
            Self::Responding => 60,
            Self::Completed => 50,
            Self::Idle => 0,
        }
    }
}
```

### 5.2 HOOK_TO_STATE 映射表 (v1.2 新增, 单一来源)

```rust
// pet/state.rs
pub const HOOK_TO_STATE: &[(&str, PetState)] = &[
    ("UserPromptSubmit", PetState::Responding),
    ("PreToolUse",       PetState::ToolUse),
    ("PostToolUse",      PetState::ToolUse),  // completed 部分由后续 BUG 决定
    ("Stop",             PetState::Completed),
    ("SubagentStop",     PetState::Completed),
    ("Notification",     PetState::AskUser),  // v1.2: Notification 映射到 AskUser
                                              // (Claude Code 无 PermissionRequest,
                                              //  Notification 是最接近"需用户介入"的 event)
];

pub fn state_for_hook(event: &str) -> Option<PetState> {
    HOOK_TO_STATE.iter()
        .find(|(e, _)| *e == event)
        .map(|(_, s)| *s)
}
```

**为什么 Notification 映射到 AskUser, 不是 ErrorInterrupted**:
- Notification 是 Claude Code "需要通知用户" 的通用 event (白话: "我需要你注意")
- 错误是 ErrorInterrupted (停止 / 失败)
- 通知 ≠ 错误, 但都是"需用户介入"

### 5.3 AgentStateEvent schema

**字段命名基于 WebSearch 摘要** (Claude Code 官方 hook payload 字段, **未直接验证官方文档**):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateEvent {
    pub session_id: String,                    // Claude Code session uuid
    pub cwd: Option<String>,                   // 当前工作目录
    pub state: PetState,                       // 已映射 (cc-status-emit 用 HOOK_TO_STATE 算)
    pub tool_name: Option<String>,             // PreToolUse/PostToolUse 的 tool 名
    pub skill_name: Option<String>,            // 若 tool_name == "Skill", 提取
    pub mcp_server: Option<String>,            // 若 tool_name 是 mcp__xxx__yyy, 提取 server
    pub elapsed_ms: Option<i64>,               // 当前状态持续
    pub timestamp_ms: i64,                     // ms since epoch
    #[serde(default)]
    pub payload: serde_json::Value,            // 原始 hook payload (保留)
}
```

⚠️ **v1.2 待真机手验**: `session_id` / `cwd` / `tool_name` / `tool_input` 字段名是按 WebSearch 摘要 + Hopet 文档推断。**真机手验**阶段(§9.3) 跑真 Claude Code 触发 hook, 检查 cc-status-emit 收到的 stdin JSON 字段名, **不符**就 fix。

### 5.4 HTTP 协议

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

### 5.5 Secret 管理

- **生成时机**: 第一次启动 cc-manager 时 (`cmd_pet_install_status_hook` 首次调用时若不存在)
- **生成方式**: `getrandom::getrandom(&mut [0u8; 32])` → hex 编码 = 64 字符
- **存储**: `app_data_dir/secret.json`, 内容 `{"secret": "<64-char-hex>"}`
  - v1.0 误写 "binary 写" — v1.2 改为 JSON 格式, 复用 `atomic_write_json`
  - Windows: `C:\Users\<user>\AppData\Roaming\com.freedom0x0.cc-session-manager\secret.json`
  - macOS: `~/Library/Application Support/com.freedom0x0.cc-session-manager/secret.json`
  - **权限**: 依赖 Tauri 2 `app.path().app_data_dir()` 默认权限 (Windows = 当前用户 ACL, macOS = 0700). 不需要额外 chmod/icacls.
- **嵌入方式**: hook 命令模板 `<cc-status-emit> --event <state>`, 通过 settings.json 顶层 `env.CC_PET_SECRET` 注入到 hook 子进程环境变量

**settings.json 写入片段** (install_status_hooks 函数):
```json
{
  "env": {
    "CC_PET_SECRET": "<64-char-hex>"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{"type": "command", "command": "<cc-status-emit-path> --event tool-use"}]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{"type": "command", "command": "<cc-status-emit-path> --event completed"}]
      }
    ]
    // ... 6 个 event 全装
  }
}
```

注意 `env` 段是 settings.json 顶层字段 (`ClaudeSettings.env: Option<HashMap<String, String>>`), 跟 `hooks` 平级. install_status_hooks 必须用 `serde_json::Value` 整体读 + 改 env 段 + 改 hooks 段 + atomic_write, 不能直接用 `ClaudeSettings` struct (会丢未识别字段).

---

## 6. 5 个 IPC (4 写 + 1 读)

```rust
// c2: 注册 4 写 + 1 读, 但 install/uninstall 在 c2 是占位 (返 Err "未实现"), c4 才接真路径
#[tauri::command]
async fn cmd_pet_install_status_hook(app: tauri::AppHandle) -> Result<InstallResult, String>;
//   c2: 返 Err("not implemented in c2, will be wired in c4")
//   c4: 真装 hook + 生成 secret + 起 HTTP server + 起 PetStateDaemon

#[tauri::command]
async fn cmd_pet_uninstall_status_hook(app: tauri::AppHandle) -> Result<UninstallResult, String>;
//   c2: 返 Err("not implemented in c2")
//   c4: 真卸载 hook + 删 env 段 + 关 HTTP server (可选)

#[tauri::command]
async fn cmd_pet_window_open(app: tauri::AppHandle) -> Result<(), String>;
//   c2: 真做事, 创建 PetWindow

#[tauri::command]
async fn cmd_pet_window_close(app: tauri::AppHandle) -> Result<(), String>;
//   c2: 真做事, 销毁 PetWindow

#[tauri::command]
fn cmd_pet_get_status(state: tauri::State<PetStateDaemon>) -> Result<PetStatusResponse, String>;
//   c1/c2: 真做事, 返当前 PetStateDaemon 所有 session 最新事件
//   c1 阶段: PetStateDaemon 是空 stub, 返空数组
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

**Windows Firewall 注**: 端口 19847 绑 `127.0.0.1` (loopback), **不会**被 Windows Defender Firewall 拦截 (只拦 inbound 公网/局域网). 同样 macOS 应用防火墙默认放行 loopback. 不需要额外防火墙规则.

---

## 8. 部署: 5 commit 节奏

| commit | 内容 | 行数 | 风险 | 验证 |
|---|---|---|---|---|
| **c1** | `pet/state.rs` (7 状态 + HOOK_TO_STATE) + tests + `pet/mod.rs` 空壳 + lib.rs 注册 | +140 | 0 | cargo check + tsc + build:vite |
| **c2** | `cmd_pet_get_status` 真做事 + `cmd_pet_window_open/close` 真做事 + `cmd_pet_install/uninstall_status_hook` 占位 (返 Err) | +80 | 0 | 同上 |
| **c3** | `bin/cc-status-emit.rs` + Cargo.toml `[[bin]]` 段 + tests | +100 | 中 (首次第二 bin) | cargo test --lib pet cc-status-emit |
| **c4** | `pet/install.rs` + `pet/daemon.rs` + `pet/http.rs` + 4 依赖 (axum/hmac/sha2/hex) | +520 | 中 (首次 HTTP + daemon) | cargo test --lib pet::http pet::install pet::daemon |
| **c5** | 前端 PetModule/PetWindow/pet-main/pet.html + 5 wrapper + capabilities/pet.json + vite 多入口 | +530 | 高 (前端最大改动) | 端到端手验 4 步 |

### 8.1 Cargo.toml 改动 (v1.2 修正: 不写 [[bin]] 是错的)

v4 当前 Cargo.toml 只有 `[lib]` 段 (line 13-15) + 默认 `src/main.rs` bin target (line 4 `app_lib::run()`). **没有任何 `[[bin]]` 段**. cc-status-emit 需要新增 `[[bin]]` 段:

**c3 改动**:
```toml
# Cargo.toml 现有内容保留, 加:
[[bin]]
name = "cc-session-manager"
path = "src/main.rs"  # 现有 bin, 显式声明虽非必需, 加了让 cargo metadata 列出

[[bin]]
name = "cc-status-emit"
path = "src/bin/cc-status-emit.rs"
```

实际**只需加第二个**。 `src/main.rs` 的现有 bin 是 cargo 默认推断 (lib + src/main.rs 不冲突, lib 用 rlib 给 main.rs 用).

**c4 改动** ([dependencies] 段加):
```toml
axum = "0.7"          # HTTP server
hmac = "0.12"         # HMAC 验签
sha2 = "0.10"         # SHA-256
hex = "0.4"           # secret hex 编码
getrandom = "0.3"     # 32 字节随机 secret (非 rand crate, 用 getrandom 是 Rust 实践)
```

注: 之前 v1.0/v1.1 spec 写的 `rand` crate **不需要** — `getrandom` 是更轻的标准做法, v4 Cargo.lock 已有 transitive.

### 8.2 tauri.conf.json 改动 (c2)

不修改 `app.windows` 数组 (宠物窗口运行时创建, 不在 conf 预声明).

### 8.3 vite.config.ts 改动 (c5)

加 `build.rollupOptions.input` 第二个入口:

```ts
input: {
  main: 'index.html',
  pet: 'src/pet.html',
}
```

build 后 `dist/index.html` + `dist/pet.html` 都生成, tauri.conf.json 的 frontendDist 引用 `../dist` 不变.

### 8.4 capabilities/pet.json (c5, v1.2 新增)

**v1.0/v1.1 漏**, capabilities 是 Tauri 2 的白名单, 必须显式列出新 window.

v4 现有 `capabilities/default.json`:
```json
{
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

**capabilities/pet.json** (新文件):
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "pet-window",
  "description": "pet window capability — allow PetWindow to listen events + basic API",
  "windows": ["pet"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default"
  ]
}
```

**要点**:
- `windows: ["pet"]` 限定只对 PetWindow 生效 (主窗口 main 用 default.json)
- `core:event:default` 允许 `listen('agent-state-event', ...)`
- `core:window:default` 允许 `getCurrentWindow()` 读取自身位置
- 主窗口的 `default.json` 不动, 不影响 pc-manager 现有 60 IPC

### 8.5 反向兼容 / 回滚

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
| `state_test.rs` | 7 状态 priority 排序 + HOOK_TO_STATE 映射 6 个 event + 转换合法性 (≥8 case) |
| `cc-status-emit_test.rs` | stdin JSON → HTTP POST mock + HMAC 签名 (≥4 case) |
| `install_test.rs` | atomic 写 + 重复装 skip + env 段 merge + 校验 event 在 HOOK_EVENTS (≥5 case) |
| `http_test.rs` | HMAC 验签 + schema 校验 + mpsc 提交 (≥5 case) |
| `daemon_test.rs` | HashMap 更新 + synthetic idle 触发 (≥3 case) |

合计 ≥25 case, 全过.

### 9.3 端到端手验 (release 前必跑, v4 D24/D25 节奏)

1. `npm run dev:tauri` → 主窗口起
2. 点 Pet Tab → 看 "Install Agent Status Hook" 按钮
3. 点按钮 → 装 6 个 hook 到 `~/.claude/settings.json`
4. 验: `cat ~/.claude/settings.json | jq '.hooks | keys'` 应包含 6 个 event (PreToolUse/PostToolUse/Stop/SubagentStop/Notification/UserPromptSubmit)
5. 点 "Open Pet Window" → 看像素动物 + 气泡
6. 跑真 Claude Code (用 dev:tauri 的同 shell 起 `claude`)
7. **关键手验**: 看 `~/.claude/projects/<session>/` 是否有 .jsonl 文件, 跑 cc-status-emit 手动模式 (`./cc-status-emit --event tool-use --secret $CC_PET_SECRET` 喂假 stdin) 看 HTTP 接收行为
8. 观察: 气泡切换到 "Tool Use: Skill: commit" / "Thinking" / "Completed"
9. **⚠️ v1.2 必查**: `AGENT_STATE_EVENT` 字段 `session_id` / `cwd` / `tool_name` 是不是真名 — 字段名来自 WebSearch 摘要, **真名可能错**. 字段名错就 fix AgentStateEvent + cc-status-emit.
10. 验 4 步全过 → commit c5 → tag v4.1.0-pet-alpha

### 9.4 v4.1 验证纪律延伸

CLAUDE.md D24/D25 已写明: SmartScreen 拦 cargo test runtime, 本次也走 `cargo check` 兜底. runtime 验证留给 CI runner (Linux, 无 SmartScreen).

---

## 10. 数据流 (3 个时序)

### T1: 用户装 hook

```
User: Pet Tab → 点 "Install Agent Status Hook"
  → api.petInstallStatusHook() → invoke('cmd_pet_install_status_hook')
  → 后端:
     1. 若 secret.json 不存在 → getrandom 32 字节 → hex 64 字符 → atomic_write_json 写
     2. 读 ~/.claude/settings.json (settings_reader, serde_json::Value 整体读)
     3. 已存在检查 (hooks_scanner.list_hooks) — 跳过已装的事件
     4. 校验: 要装的 6 个 event 必须在 HOOK_EVENTS (hooks_scanner.rs:9)
     5. merge env.CC_PET_SECRET = secret
     6. merge hooks.PreToolUse/PostToolUse/Stop/SubagentStop/Notification/UserPromptSubmit
        各加一条 → "<cc-status-emit> --event <state>"
     7. atomic_write_json 写回整个 settings.json
     8. 启动 axum HTTP server (若未起) — spawn tokio task
     9. 启动 PetStateDaemon — spawn tokio task
  → 返回 InstallResult { installed: 6, skipped: 0 }
```

### T2: agent PreToolUse 触发 (调用 Skill)

```
Claude Code: PreToolUse hook 触发
  → <cc-status-emit> --event tool-use
     stdin = {session_id: "abc", cwd: "/proj", tool_name: "Skill", tool_input: {skill: "commit"}, ...}
  → cc-status-emit:
     1. 读 stdin JSON
     2. 解析 → AgentStateEvent { state: ToolUse, tool_name: "Skill", skill_name: "commit" }
     3. 加 HMAC-SHA256(secret, body) → X-Signature header
     4. POST 127.0.0.1:19847/agent-event
  → HTTP receiver:
     1. 验签 (HMAC 比对)
     2. 解析 AgentStateEvent
     3. mpsc::Sender.send(event) → PetStateDaemon 接收
  → PetStateDaemon:
     1. HashMap.insert(session_id, event)
     2. broadcast::Sender.send(event)
  → PetWindow (若开着): listen('agent-state-event') → 切到 tool-use GIF
     → 气泡: "调用 Skill: commit"
  → 主窗口 PetModule: 同 listen → 更新 status badge
```

### T3: agent Stop 触发 (完成)

```
Claude Code: Stop hook 触发
  → <cc-status-emit> --event completed
  → POST → HTTP receiver → mpsc → PetStateDaemon
  → PetStateDaemon:
     1. HashMap.insert(session_id, Completed event)
     2. broadcast::Sender.send(event)
     3. spawn 5s timer → 到时 broadcast 合成 Idle event
  → PetWindow: 切到 completed GIF + 气泡 "完成: <last assistant text 前 80 字>"
  → 同时: 主窗口 listen → antd notification.success 弹窗
  → 5s 后 PetWindow 自动切回 Idle (synthetic idle, 见 §11.3)
```

---

## 11. 详细设计 (v1.2 新增 3 段)

### 11.1 PetStateDaemon 锁策略

**锁选**: `parking_lot::Mutex<HashMap<String, AgentStateEvent>>`

**为什么不用 std::sync::Mutex**:
- v4 Cargo.lock 已有 parking_lot transitive, 加为直接依赖**零成本**
- parking_lot 快 2-3x, 对每事件加锁有用
- 不阻塞 async, 但 hold 时间短 (insert + 复制)

**为什么不用 DashMap**:
- 过度工程, v1.1 spec 写"HashMap 锁"已够
- DashMap 内部并发复杂, 出问题难调试

**锁的 hold 模式** (3 步, 1 持锁 1 释放):
```rust
// PetStateDaemon::handle_event()
fn handle_event(&self, event: AgentStateEvent) {
    // 1. 持锁写 HashMap
    {
        let mut map = self.sessions.lock();
        map.insert(event.session_id.clone(), event.clone());
    } // 锁释放

    // 2. 持锁计算当前最高 priority state
    let current = {
        let map = self.sessions.lock();
        map.values()
            .max_by_key(|e| e.state.priority())
            .cloned()
    };

    // 3. broadcast (无锁)
    let _ = self.broadcast.send(event);
}
```

**锁顺序**: 单锁, 无顺序问题.

**死锁风险**: 持锁不调外部 await, 持锁时间 < 1ms, 不会死锁.

### 11.2 EventBus 设计

```rust
// pet/daemon.rs
use tokio::sync::{broadcast, mpsc};
use parking_lot::Mutex;
use std::collections::HashMap;

pub struct PetStateDaemon {
    sessions: Mutex<HashMap<String, AgentStateEvent>>,
    broadcast: broadcast::Sender<AgentStateEvent>,
    tx: mpsc::Sender<AgentStateEvent>,  // 给 HTTP receiver 用
}

impl PetStateDaemon {
    pub fn new(capacity: usize) -> (Arc<Self>, mpsc::Receiver<AgentStateEvent>) {
        let (tx, rx) = mpsc::channel(256);
        let (bcast, _) = broadcast::channel(capacity);
        let daemon = Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
            tx,
        });
        (daemon, rx)
    }
}
```

**HTTP receiver 提交**:
```rust
// pet/http.rs
async fn handler(
    State(daemon): State<Arc<PetStateDaemon>>,
    body: String,
    headers: HeaderMap,
) -> Result<Json<Value>, String> {
    // 1. 验签
    let sig = headers.get("x-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !verify_hmac(&secret, &body, sig) {
        return Err("invalid signature".into());
    }
    // 2. 解析
    let event: AgentStateEvent = serde_json::from_str(&body)
        .map_err(|e| format!("schema invalid: {}", e))?;
    // 3. 提交到 daemon
    daemon.tx.send(event).await
        .map_err(|e| format!("daemon closed: {}", e))?;
    Ok(Json(json!({"ok": true})))
}
```

### 11.3 synthetic idle 触发者 (v1.2 明确)

**v1.0 spec 写"EventBus 内部 tokio timer"** 是模糊的. v1.2 明确职责:

**PetStateDaemon 负责 synthetic idle**, 流程:

```rust
fn handle_event(&self, event: AgentStateEvent) {
    // 1. 写 HashMap (持锁)
    {
        let mut map = self.sessions.lock();
        map.insert(event.session_id.clone(), event.clone());
    }

    // 2. broadcast (无锁)
    let _ = self.broadcast.send(event.clone());

    // 3. 如果状态是 Completed, spawn 5s delay 后合成 Idle
    if event.state == PetState::Completed {
        let bcast = self.broadcast.clone();
        let session_id = event.session_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let idle = AgentStateEvent {
                session_id,
                state: PetState::Idle,
                timestamp_ms: now_ms(),
                ..Default::default()
            };
            let _ = bcast.send(idle);
        });
    }
}
```

**为什么不让前端 setTimeout**:
- 前端 setTimeout 在 PetWindow 关闭时丢失, 重新开窗看不到 idle
- 后端 single source of truth, 一致性更好
- 后端 timer fire 失败也不影响主事件流

**为什么不用 daemon task 轮询**:
- spawn timer 更轻, 不需要常驻 task
- fire-and-forget, 不需要 tracked

---

## 12. 关联决策

| ID | 决策 | 落地位置 |
|---|---|---|
| **D34** | cc-pet 模块整体设计 | 本 spec |
| D34.1 | 嵌入式宠物窗口, 跟随主 App 生命周期 | §1.2 / §3.1 |
| D34.2 | HTTP localhost:19847 替代 UDS, 跨平台 | §5.4 / §7 (E4 Firewall 注) |
| D34.3 | HMAC-SHA256 防假事件, secret 存 app_data_dir | §5.5 / §7 (E2) |
| D34.4 | 5 commit 节奏 (c1-c5), 每个独立可回滚 | §8 |
| D34.5 | v1 不做多 session 聚合 / 自定义主题 / 灵动岛 / Permission 介入 / Codex CLI | §1.3 / §1.4 |
| D34.6 | 宠物状态不写 KV 表, 遵循 D10 禁令 | §3.2 |
| D34.7 | install_status_hooks 是新函数不直接复用 create_hook | §3.2.1 |
| D34.8 | **v1.2 砍 PermissionPrompt, PetState 8→7** — Claude Code 无 PermissionRequest hook event | §1.3 / §5.1 |
| D34.9 | **v1.2 Notification 映射到 AskUser** (无 PermissionRequest, 通知=最接近"需介入") | §5.2 |
| D34.10 | **v1.2 PetStateDaemon 独立 daemon + mpsc 提交 + parking_lot 锁** | §11.1 / §11.2 |
| D34.11 | **v1.2 synthetic idle 由 PetStateDaemon spawn timer 触发, 不走前端 setTimeout** | §11.3 |
| D34.12 | **v1.2 secret.json (JSON 格式) 替代 binary 写** | §5.5 |
| D34.13 | **v1.2 capabilities/pet.json 显式白名单 pet window** | §8.4 |
| D34.14 | **v1.2 HOOK_TO_STATE 集中常量, 单一来源** | §5.2 |

**完整决策记录**: `.peaks/memory/2026-08-03-cc-pet-design.md` (按 CLAUDE.md §13 模板).

---

## 13. 待办 (留给 writing-plans 阶段)

1. **像素动物 GIF**: 7 个状态各一段 GIF, 来源待定 (自画/采购/简化抽象)
2. **气泡布局**: 头像周围/上方, 滚动 / 折叠行为
3. **位置记忆**: 拖拽事件 + localStorage 同步逻辑
4. **透明背景**: macOS NSPanel vs Win32 alpha 兼容性测试
5. **5 commit 各自 TDD 红绿重构节奏**: test → impl → 绿 → commit, 不批量
6. **⚠️ AgentStateEvent 字段真机手验**: `session_id` / `cwd` / `tool_name` 字段名是 WebSearch 摘要推断, 真机需 fix (commit c3 之前或 c5 之前)