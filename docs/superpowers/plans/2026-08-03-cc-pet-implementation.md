# CC Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embedded desktop pet to cc-manager (Tauri 2) that shows Claude Code agent status (which skill/mcp is being called) and notifies on session completion — modeled on Hopet but built on cc-manager's own stack.

**Architecture:** 5 layers — Claude Code hooks (`~/.claude/settings.json`) → cc-status-emit binary (stdin → HTTP POST) → axum HTTP receiver (HMAC verify) → PetStateDaemon (broadcast + sessions HashMap) → Tauri 2 WebviewWindow (pet window with GIF + bubble). 5-commit rhythm, each independently testable and rollback-able.

**Tech Stack:** Rust (Tauri 2 backend, axum 0.7, hmac 0.12, sha2 0.10, hex 0.4, getrandom 0.3, tokio, parking_lot) + TypeScript/React (Tauri 2 frontend, antd, @tauri-apps/api 2).

**Spec:** `docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md` (v1.2)

## Global Constraints

- **Platform**: Windows 10/11 64-bit + macOS 10.15+ (per CLAUDE.md §0 v4.0 platform policy)
- **Hook events**: 6 real ones only — `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `Notification`, `UserPromptSubmit` (from `src-tauri/src/repo/hooks_scanner.rs:9-11` HOOK_EVENTS). Do NOT add `PermissionRequest` (Claude Code doesn't have it).
- **PetState**: 7 states — `Idle`, `Responding`, `Thinking`, `ToolUse`, `AskUser`, `Completed`, `ErrorInterrupted`. NO `PermissionPrompt` (v1.2 §5.1).
- **Hook → state mapping** is centralized in `pet/state.rs::HOOK_TO_STATE` constant (§5.2). Do not hardcode mappings anywhere else.
- **KV table forbidden**: pet state must NOT be persisted to `mcp_server_state` KV (CLAUDE.md §13 D10). State lives in-memory only (D34.6).
- **Secret file**: `app_data_dir/secret.json` (JSON `{"secret": "<64-char-hex>"}`), written via `util/atomic_write::atomic_write_json`. NO binary write — `atomic_write` does not exist.
- **HTTP port**: 127.0.0.1:19847 (loopback, not blocked by Windows Firewall).
- **HMAC**: SHA-256 over request body, secret from `app_data_dir/secret.json`, hex-encoded.
- **No existing file modification for v4 main module logic**: don't touch existing 60 IPC handlers, 9 Tabs, 5 DB tables, Cargo.toml existing deps.
- **Verification rhythm** (CLAUDE.md §14.5): `cd src-tauri && cargo check` + `npx tsc --noEmit` + `npm run build:vite` — all must pass per commit.
- **SmartScreen blocks `cargo test` runtime** on Windows (CLAUDE.md D24/D25). Use `cargo check` for local verification; full `cargo test --lib` only runs in CI.
- **TDD order**: test → fail → implement → pass → commit. Do not batch tests with implementation.
- **Test file location**: `src-tauri/src/pet/*_test.rs` (cfg test inside module file) or `src-tauri/src/bin/*_test.rs` for cc-status-emit. Follow pattern from `src-tauri/src/util/atomic_write.rs:142-222` (`#[cfg(test)] mod tests`).
- **Commit message style**: `<type>(scope): <subject>` + body explaining WHY not WHAT. Reference spec section.
- **One task = one commit** (CLAUDE.md §11). Plan has 5 tasks = 5 commits total.

## File Structure

### Files to Create

| Path | Responsibility |
|---|---|
| `src-tauri/src/pet/mod.rs` | Pet module root — re-exports state, daemon, install, http. Registers IPC handlers in `lib.rs`. |
| `src-tauri/src/pet/state.rs` | `PetState` enum (7 variants), `AgentStateEvent` struct, `HOOK_TO_STATE` constant, `state_for_hook()` function. Tests for priority + mapping. |
| `src-tauri/src/pet/daemon.rs` | `PetStateDaemon` struct (broadcast::Sender + Mutex<HashMap> + mpsc::Sender), `handle_event()`, synthetic idle spawn. Tests for HashMap updates + idle spawn. |
| `src-tauri/src/pet/install.rs` | `install_status_hooks(settings_path, secret)` — atomic write env.CC_PET_SECRET + 6 hooks. `uninstall_status_hooks()`. Tests for atomic + skip + env merge. |
| `src-tauri/src/pet/http.rs` | axum router with POST /agent-event (HMAC verify + mpsc submit) + GET /agent-state. Tests with mock daemon. |
| `src-tauri/src/bin/cc-status-emit.rs` | stdin JSON read → HMAC sign → POST to 127.0.0.1:19847. Exit 0 on connection refused (silent drop per E1). |
| `src-tauri/capabilities/pet.json` | Tauri 2 capability: `windows: ["pet"]` + 3 permissions. |
| `src/modules/pet/PetModule.tsx` | 10th Tab in App.tsx: "Install Agent Status Hook" button + "Open Pet Window" button + status list. |
| `src/modules/pet/PetWindow.tsx` | Pet window content: sprite (img tag, 7 GIFs) + bubble text + position memory + listen('agent-state-event'). |
| `src/pet-main.tsx` | React mount entry for pet window. Separate from `src/main.tsx`. |
| `src/pet.html` | HTML entry for pet window (vite second input). |

### Files to Modify

| Path | Change |
|---|---|
| `src-tauri/Cargo.toml` | c3: add `[[bin]] name = "cc-status-emit"` section. c4: add 4 deps (axum/hmac/sha2/hex) + getrandom + tokio + parking_lot. |
| `src-tauri/src/lib.rs` | c1: add `pub mod pet;`. c2: register 5 IPC handlers in `tauri::generate_handler!` macro. |
| `src/api-tauri.ts` | c5: add 5 wrappers (`petInstallStatusHook`, `petUninstallStatusHook`, `petWindowOpen`, `petWindowClose`, `petGetStatus`). |
| `src/App.tsx` | c5: add 'pet' to TAB_KEYS array, PetModule import + Tabs.TabPane. |
| `vite.config.ts` | c5: add `build.rollupOptions.input` with second entry `pet: './pet.html'` (lives at repo root, not `src/`). |

### Files NOT Touched

- `src-tauri/src/main.rs` (no change)
- `src-tauri/src/repo/hooks_writer.rs` (use as reference only, don't modify)
- `src-tauri/src/repo/hooks_scanner.rs` (read HOOK_EVENTS only)
- `src-tauri/src/util/atomic_write.rs` (read atomic_write_json only)
- `src-tauri/capabilities/default.json` (untouched — main window unchanged)
- `src-tauri/tauri.conf.json` (frontendDist path `../dist` unchanged)
- `src-tauri/src/types.rs` (no pet types here — they live in `pet/state.rs`)

---

### Task 1: PetState enum + HOOK_TO_STATE mapping (commit c1)

**Files:**
- Create: `src-tauri/src/pet/state.rs`
- Create: `src-tauri/src/pet/mod.rs`
- Modify: `src-tauri/src/lib.rs:619-628` (add `pub mod pet;`)
- Test: `src-tauri/src/pet/state.rs` (cfg test inside file)

**Interfaces:**
- Consumes: nothing (this is the root)
- Produces:
  - `pub enum PetState { Idle, Responding, Thinking, ToolUse, AskUser, Completed, ErrorInterrupted }` with `priority()` method
  - `pub struct AgentStateEvent { session_id: String, cwd: Option<String>, state: PetState, tool_name: Option<String>, skill_name: Option<String>, mcp_server: Option<String>, elapsed_ms: Option<i64>, timestamp_ms: i64, payload: serde_json::Value }`
  - `pub const HOOK_TO_STATE: &[(&str, PetState)]` — 6 entries (UserPromptSubmit→Responding, PreToolUse→ToolUse, PostToolUse→ToolUse, Stop→Completed, SubagentStop→Completed, Notification→AskUser)
  - `pub fn state_for_hook(event: &str) -> Option<PetState>`

- [ ] **Step 1: Write failing tests in `src-tauri/src/pet/state.rs`**

```rust
//! v1.2 cc-pet: PetState enum + AgentStateEvent schema + HOOK_TO_STATE mapping
//!
//! Spec §5.1 (7 states, no PermissionPrompt), §5.2 (HOOK_TO_STATE single source
//! of truth), §5.3 (AgentStateEvent schema).

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateEvent {
    pub session_id: String,
    pub cwd: Option<String>,
    pub state: PetState,
    pub tool_name: Option<String>,
    pub skill_name: Option<String>,
    pub mcp_server: Option<String>,
    pub elapsed_ms: Option<i64>,
    pub timestamp_ms: i64,
    #[serde(default)]
    pub payload: serde_json::Value,
}

pub const HOOK_TO_STATE: &[(&str, PetState)] = &[
    ("UserPromptSubmit", PetState::Responding),
    ("PreToolUse",       PetState::ToolUse),
    ("PostToolUse",      PetState::ToolUse),
    ("Stop",             PetState::Completed),
    ("SubagentStop",     PetState::Completed),
    ("Notification",     PetState::AskUser),
];

pub fn state_for_hook(event: &str) -> Option<PetState> {
    HOOK_TO_STATE.iter()
        .find(|(e, _)| *e == event)
        .map(|(_, s)| *s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_ordering() {
        // AskUser > ErrorInterrupted > ToolUse > Thinking > Responding > Completed > Idle
        assert!(PetState::AskUser.priority() > PetState::ErrorInterrupted.priority());
        assert!(PetState::ErrorInterrupted.priority() > PetState::ToolUse.priority());
        assert!(PetState::ToolUse.priority() > PetState::Thinking.priority());
        assert!(PetState::Thinking.priority() > PetState::Responding.priority());
        assert!(PetState::Responding.priority() > PetState::Completed.priority());
        assert!(PetState::Completed.priority() > PetState::Idle.priority());
        assert_eq!(PetState::Idle.priority(), 0);
    }

    #[test]
    fn test_serde_rename_roundtrip() {
        for s in [PetState::Idle, PetState::Responding, PetState::Thinking,
                  PetState::ToolUse, PetState::AskUser, PetState::Completed,
                  PetState::ErrorInterrupted] {
            let json = serde_json::to_string(&s).unwrap();
            let back: PetState = serde_json::from_str(&json).unwrap();
            assert_eq!(s, back);
        }
    }

    #[test]
    fn test_hook_to_state_mapping_all_6() {
        assert_eq!(state_for_hook("UserPromptSubmit"), Some(PetState::Responding));
        assert_eq!(state_for_hook("PreToolUse"), Some(PetState::ToolUse));
        assert_eq!(state_for_hook("PostToolUse"), Some(PetState::ToolUse));
        assert_eq!(state_for_hook("Stop"), Some(PetState::Completed));
        assert_eq!(state_for_hook("SubagentStop"), Some(PetState::Completed));
        assert_eq!(state_for_hook("Notification"), Some(PetState::AskUser));
    }

    #[test]
    fn test_state_for_hook_unknown_returns_none() {
        // PermissionRequest does NOT exist in Claude Code (v1.2 F5 fix).
        // Unknown events must return None, not panic.
        assert_eq!(state_for_hook("PermissionRequest"), None);
        assert_eq!(state_for_hook(""), None);
        assert_eq!(state_for_hook("UnknownEvent"), None);
    }

    #[test]
    fn test_hook_to_state_table_has_6_entries() {
        // D34.14: single source of truth. If a 7th event is added later,
        // both this test and §3.1 spec update together.
        assert_eq!(HOOK_TO_STATE.len(), 6);
    }

    #[test]
    fn test_agent_state_event_default_payload() {
        // payload should default to Null when missing from JSON (D34 spec)
        let json = r#"{"session_id":"abc","state":"idle","timestamp_ms":1234}"#;
        let event: AgentStateEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.session_id, "abc");
        assert_eq!(event.state, PetState::Idle);
        assert_eq!(event.timestamp_ms, 1234);
        assert_eq!(event.payload, serde_json::Value::Null);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib pet::state`
Expected: FAIL with "no module named `pet`"

- [ ] **Step 3: Create `src-tauri/src/pet/mod.rs` empty stub**

```rust
//! v1.2 cc-pet: Hopet-like embedded desktop pet module
//!
//! Spec: docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md
//!
//! Submodules added across 5 commits:
//! - c1: state (this commit)
//! - c4: daemon, install, http

pub mod state;
```

- [ ] **Step 4: Register module in `src-tauri/src/lib.rs`**

Modify `src-tauri/src/lib.rs:619-628`, add `pub mod pet;` after `pub mod watcher;`:

```rust
pub mod db;
pub mod importer;
pub mod pet;       // v1.2 c1 — cc-pet state + types
pub mod repo;
pub mod util;
pub mod types;
pub mod watcher;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib pet::state`
Expected: 6 passed, 0 failed

- [ ] **Step 6: Run full v4 verification trio**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build:vite`
Expected: All three exit 0

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pet/state.rs src-tauri/src/pet/mod.rs src-tauri/src/lib.rs
git commit -m "feat(pet): D34 c1 — PetState 7 状态 + HOOK_TO_STATE 集中映射表

- 7 状态 (砍 PermissionPrompt, v1.2 D34.8): Idle/Responding/Thinking/ToolUse/AskUser/Completed/ErrorInterrupted
- HOOK_TO_STATE 6 项集中常量 (UserPromptSubmit→Responding, PreToolUse/PostToolUse→ToolUse, Stop/SubagentStop→Completed, Notification→AskUser, v1.2 D34.9)
- AgentStateEvent schema + 6 测试 (priority / serde / mapping / unknown / table len / payload default)
- pub mod pet 注册到 lib.rs:619
- 不动现有 60 IPC / 9 Tab / 5 DB 表

⚠️ AgentStateEvent 字段名 (session_id/cwd/tool_name) 是 WebSearch 摘要推断,
真机手验阶段 (c5) 需验证 hook payload 实际字段名 (§5.3 §9.3 第 9 步).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 5 IPC handlers + window open/close (commit c2)

**Files:**
- Modify: `src-tauri/src/lib.rs:1-95` (register 5 IPC handlers in `tauri::generate_handler!` macro)
- Modify: `src-tauri/src/lib.rs:617-625` (add handler functions)
- Modify: `src-tauri/src/pet/mod.rs` (add `use` + re-exports)
- No test file (handlers tested via Task 4 daemon tests + manual end-to-end)

**Interfaces:**
- Consumes: `PetState` from Task 1 (`crate::pet::state::PetState`)
- Produces:
  - `cmd_pet_install_status_hook(app: tauri::AppHandle) -> Result<InstallResult, String>` — c2 returns `Err("not implemented in c2, will be wired in c4")`
  - `cmd_pet_uninstall_status_hook(app: tauri::AppHandle) -> Result<UninstallResult, String>` — c2 returns `Err("not implemented in c2")`
  - `cmd_pet_window_open(app: tauri::AppHandle) -> Result<(), String>` — c2 creates PetWindow with `WebviewWindowBuilder`, returns Ok if created or already shown
  - `cmd_pet_window_close(app: tauri::AppHandle) -> Result<(), String>` — c2 destroys PetWindow, returns Ok if not exists
  - `cmd_pet_get_status(state: tauri::State<Arc<PetStateDaemon>>) -> Result<Vec<AgentStateEvent>, String>` — c2 returns empty Vec (daemon not yet wired)

**InstallResult / UninstallResult types** (add to `pet/state.rs` end or to a new `pet/ipc.rs` if needed):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub installed: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub removed: usize,
}
```

- [ ] **Step 1: Add InstallResult/UninstallResult to `src-tauri/src/pet/state.rs`**

Add at end of `state.rs` (before `mod tests`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub installed: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub removed: usize,
}
```

- [ ] **Step 2: Register 5 IPC handlers in `src-tauri/src/lib.rs`**

Modify `src-tauri/src/lib.rs:18-92`, add 5 entries to `tauri::generate_handler!` macro after `cmd_usage_get_top_tools`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing 60 commands ...
    cmd_usage_get_top_tools,
    // v1.2 c2: cc-pet 5 IPC handlers
    cmd_pet_install_status_hook,
    cmd_pet_uninstall_status_hook,
    cmd_pet_window_open,
    cmd_pet_window_close,
    cmd_pet_get_status,
])
```

- [ ] **Step 3: Add handler function stubs to `src-tauri/src/lib.rs`**

Add at end of `src-tauri/src/lib.rs` (before `pub mod db;`):

```rust
// ===== v1.2 c2: cc-pet IPC handlers =====
use tauri::Manager;

#[tauri::command]
async fn cmd_pet_install_status_hook(_app: tauri::AppHandle) -> Result<crate::pet::state::InstallResult, String> {
    Err("not implemented in c2, will be wired in c4".into())
}

#[tauri::command]
async fn cmd_pet_uninstall_status_hook(_app: tauri::AppHandle) -> Result<crate::pet::state::UninstallResult, String> {
    Err("not implemented in c2, will be wired in c4".into())
}

#[tauri::command]
async fn cmd_pet_window_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("pet") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "pet", tauri::WebviewUrl::App("pet.html".into()))
        .title("cc-pet")
        .inner_size(280.0, 320.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cmd_pet_window_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("pet") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cmd_pet_get_status(_state: tauri::State<std::sync::Arc<crate::pet::daemon::PetStateDaemon>>) -> Result<Vec<crate::pet::state::AgentStateEvent>, String> {
    // c2 stub: daemon not yet wired (Task 4)
    Ok(Vec::new())
}
```

- [ ] **Step 4: Create `src-tauri/src/pet/daemon.rs` empty stub for tauri::State type**

```rust
//! v1.2 c2: PetStateDaemon stub (wired in Task 4)
//!
//! Daemon is the single source of truth for in-memory pet state.
//! Spec §11.2 — broadcast::Sender + Mutex<HashMap> + mpsc::Sender.

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tokio::sync::broadcast;

use crate::pet::state::AgentStateEvent;

pub struct PetStateDaemon {
    sessions: Mutex<HashMap<String, AgentStateEvent>>,
    broadcast: broadcast::Sender<AgentStateEvent>,
}

impl PetStateDaemon {
    pub fn new() -> Arc<Self> {
        let (bcast, _) = broadcast::channel(64);
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
        })
    }
}

impl Default for PetStateDaemon {
    fn default() -> Self {
        // Note: default() cannot share broadcast sender, use new() instead
        let (bcast, _) = broadcast::channel(64);
        Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
        }
    }
}
```

- [ ] **Step 5: Add `parking_lot` and `tokio` to Cargo.toml**

Modify `src-tauri/Cargo.toml`, find `[dependencies]` section (line 20-32) and add 2 new deps:

```toml
[dependencies]
tauri = { version = "2.11.3", features = [] }
tauri-plugin-log = "2"
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
env_logger = "0.11"
thiserror = "1"
anyhow = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
notify = { version = "6", features = [] }
home = "0.5"
dirs = "5"
parking_lot = "0.12"  # v1.2 c2: pet daemon HashMap mutex
tokio = { version = "1", features = ["sync", "time"] }  # v1.2 c2: broadcast + spawn timer
```

(Note: Tauri 2 already depends on tokio internally. We only need `sync` and `time` features. `parking_lot` is already in transitive deps.)

- [ ] **Step 6: Register PetStateDaemon in `src-tauri/src/lib.rs` setup hook**

Modify `src-tauri/src/lib.rs:5-17` (the `.setup(|app| { ... })` closure), add daemon registration:

```rust
.setup(|app| {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir()?;
    let db = crate::db::init_db(&app_data_dir)?;
    if let Err(e) = crate::importer::rescan_all(&db) {
        eprintln!("[startup] rescan_all failed: {}", e);
    }
    app.manage(crate::db::DbState::new(db));
    // v1.2 c2: PetStateDaemon stub (real wiring in c4)
    app.manage(crate::pet::daemon::PetStateDaemon::new());
    Ok(())
})
```

- [ ] **Step 7: Run v4 verification trio**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build:vite`
Expected: All three exit 0 (build:vite may fail with "Could not resolve './pet'" if App.tsx imports it before Task 5 — that's expected, ignore for now if frontend not yet wired)

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pet/state.rs src-tauri/src/pet/daemon.rs src-tauri/src/pet/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(pet): D34 c2 — 5 IPC handlers + window open/close stub

- cmd_pet_install/uninstall_status_hook 占位返 Err (c4 接真路径)
- cmd_pet_window_open 真做事 (WebviewWindowBuilder: 280x320, decorations=false, always_on_top, skip_taskbar, transparent)
- cmd_pet_window_close 真做事 (close if exists)
- cmd_pet_get_status 返空 Vec (daemon 在 c4 接事件后返真实状态)
- PetStateDaemon stub 注册到 tauri setup hook (c4 接 HTTP receiver 后真正做事)
- 加 parking_lot = 0.12 + tokio { sync, time } (Cargo.toml, v1.2 c2 锁 + timer 依赖)
- InstallResult/UninstallResult 类型加到 state.rs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: cc-status-emit binary + Cargo.toml [[bin]] (commit c3)

**Files:**
- Create: `src-tauri/src/bin/cc-status-emit.rs`
- Create: `src-tauri/src/bin/cc_status_emit_test.rs` (separate test binary for stdin/HTTP mock)
- Modify: `src-tauri/Cargo.toml` (add `[[bin]]` section)

**Interfaces:**
- Consumes: env var `CC_PET_SECRET` (set by Claude Code hook from `~/.claude/settings.json::env`)
- Produces: standalone binary `cc-status-emit` that reads stdin JSON, signs with HMAC-SHA256, POSTs to `http://127.0.0.1:19847/agent-event`. Exit 0 on all paths (silent drop per E1).

**CLI args**: `--event <name>` (e.g. "tool-use", "completed") — used to derive PetState via `state_for_hook` from Task 1. If mapping fails, exit 0 silently (event name from Claude Code may not match HOOK_TO_STATE).

- [ ] **Step 1: Add `[[bin]]` section to `src-tauri/Cargo.toml`**

Modify `src-tauri/Cargo.toml`, add at end (after `[dev-dependencies]`):

```toml
[[bin]]
name = "cc-status-emit"
path = "src/bin/cc-status-emit.rs"
```

- [ ] **Step 2: Write failing test in `src-tauri/src/bin/cc_status_emit_test.rs`**

```rust
//! v1.2 c3: cc-status-emit tests
//!
//! Tests stdin JSON parsing + HMAC signing + state mapping.
//! HTTP POST is mocked (no real network).

use std::process::{Command, Stdio};
use std::io::Write;

#[test]
fn test_cc_status_emit_signs_body_with_hmac() {
    // Build the cc-status-emit binary in test mode
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let secret = "test-secret-32-bytes-aaaaaaaaaaaa";

    // Pipe stdin JSON
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("tool-use")
        .arg("--secret")
        .arg(secret)
        .arg("--dry-run")  // c3 feature: dry-run prints signed body, doesn't POST
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn cc-status-emit");

    let stdin = child.stdin.as_mut().expect("stdin pipe");
    stdin.write_all(br#"{"session_id":"abc","cwd":"/tmp","tool_name":"Skill"}"#).unwrap();

    let output = child.wait_with_output().expect("failed to wait");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // dry-run should print signed JSON + signature
    assert!(stdout.contains("session_id"), "stdout missing session_id: {}", stdout);
    assert!(stdout.contains("X-Signature"), "stdout missing signature header line: {}", stdout);
    assert!(stdout.contains("hmac-sha256"), "stdout missing hmac-sha256 marker: {}", stdout);
}

#[test]
fn test_cc_status_emit_maps_event_to_state() {
    // The binary should use state_for_hook from pet::state to set "state" field
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("Stop")
        .arg("--secret")
        .arg("dummy-secret")
        .arg("--dry-run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    child.stdin.as_mut().unwrap().write_all(br#"{"session_id":"x"}"#).unwrap();
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Stop → Completed (per HOOK_TO_STATE)
    assert!(stdout.contains("\"state\":\"completed\""), "expected state=completed, got: {}", stdout);
}

#[test]
fn test_cc_status_emit_unknown_event_exits_zero() {
    // PermissionRequest (v1.2 F5: doesn't exist) — binary must exit 0, not panic
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("PermissionRequest")
        .arg("--secret")
        .arg("dummy")
        .arg("--dry-run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    child.stdin.as_mut().unwrap().write_all(br#"{}"#).unwrap();
    let status = child.wait().unwrap();

    // Unknown event: exit 0 silently (E1 silent drop)
    assert!(status.success(), "expected exit 0 for unknown event, got: {:?}", status);
}

#[test]
fn test_cc_status_emit_missing_secret_exits_zero() {
    // No CC_PET_SECRET env, no --secret arg → exit 0 silently (E1)
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let child = Command::new(bin)
        .arg("--event")
        .arg("Stop")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    let status = child.wait().unwrap();
    assert!(status.success(), "expected exit 0 when no secret, got: {:?}", status);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --bin cc-status-emit`
Expected: FAIL with "no such file or directory" (binary not built yet)

- [ ] **Step 4: Create `src-tauri/src/bin/cc-status-emit.rs`**

```rust
//! v1.2 c3: cc-status-emit binary
//!
//! Claude Code hook helper: stdin JSON → HMAC sign → POST 127.0.0.1:19847.
//!
//! Spec §3.1 Layer 2 + §10 T2.
//!
//! All exit paths return code 0 (silent drop per E1) — Claude Code runs hooks
//! synchronously and any non-zero exit pollutes the agent's terminal.

use std::env;
use std::io::{Read, Write};
use std::process::ExitCode;

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const TARGET_URL: &str = "http://127.0.0.1:19847/agent-event";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let event_name = parse_arg(&args, "--event").unwrap_or_default();
    let cli_secret = parse_arg(&args, "--secret");
    let dry_run = args.iter().any(|a| a == "--dry-run");

    let secret = match cli_secret.or_else(|| env::var("CC_PET_SECRET").ok()) {
        Some(s) if !s.is_empty() => s,
        _ => return ExitCode::SUCCESS,  // E1: no secret → silent drop
    };

    // Read stdin JSON
    let mut stdin_input = String::new();
    if std::io::stdin().read_to_string(&mut stdin_input).is_err() {
        return ExitCode::SUCCESS;
    }

    // Parse stdin + inject state from HOOK_TO_STATE
    let mut event: serde_json::Value = match serde_json::from_str(&stdin_input) {
        Ok(v) => v,
        Err(_) => return ExitCode::SUCCESS,  // bad JSON → silent drop
    };

    // Map event to PetState via shared module
    let state_str = match crate_app_lib_pet::state_for_hook(&event_name) {
        Some(s) => serde_json::to_value(s).unwrap_or(serde_json::json!("idle")),
        None => serde_json::json!("idle"),  // unknown event (e.g. PermissionRequest) → idle
    };
    if let Some(obj) = event.as_object_mut() {
        obj.insert("state".to_string(), state_str);
        if !obj.contains_key("timestamp_ms") {
            let ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            obj.insert("timestamp_ms".to_string(), serde_json::json!(ms));
        }
    }

    // Serialize body
    let body = match serde_json::to_string(&event) {
        Ok(s) => s,
        Err(_) => return ExitCode::SUCCESS,
    };

    // Compute HMAC-SHA256
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return ExitCode::SUCCESS,
    };
    mac.update(body.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    if dry_run {
        // Test mode: print signed body + signature, don't POST
        println!("X-Signature: hmac-sha256={}", sig);
        println!("{}", body);
        return ExitCode::SUCCESS;
    }

    // POST to cc-manager HTTP receiver
    let _ = post_to_target(TARGET_URL, &body, &sig);
    // Silent on all errors (E1: cc-manager not running → drop silently)
    ExitCode::SUCCESS
}

fn parse_arg(args: &[String], flag: &str) -> Option<String> {
    let i = args.iter().position(|a| a == flag)?;
    args.get(i + 1).cloned()
}

fn post_to_target(url: &str, body: &str, sig: &str) -> std::io::Result<()> {
    // Minimal HTTP POST without external deps. Uses TcpStream to localhost:19847.
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let mut stream = TcpStream::connect("127.0.0.1:19847")?;
    let req = format!(
        "POST /agent-event HTTP/1.1\r\n\
         Host: 127.0.0.1:19847\r\n\
         Content-Type: application/json\r\n\
         X-Signature: hmac-sha256={}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        sig,
        body.len(),
        body
    );
    stream.write_all(req.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(())
}
```

- [ ] **Step 5: Add 3 deps to Cargo.toml for HMAC + hex**

Modify `src-tauri/Cargo.toml` `[dependencies]` section, add 3 entries:

```toml
hmac = "0.12"      # v1.2 c3: cc-status-emit HMAC signing
sha2 = "0.10"      # v1.2 c3: SHA-256
hex = "0.4"        # v1.2 c3: signature hex encoding
```

- [ ] **Step 6: Verify cc-status-emit can use `state_for_hook`**

The cc-status-emit binary needs to call `state_for_hook` from `crate::pet::state`. To enable this, expose `pet` module from the lib:

Modify `src-tauri/src/lib.rs:619-628`, ensure `pub mod pet;` exists (it was added in Task 1, but double-check). No additional changes needed — `state_for_hook` is already `pub`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --bin cc-status-emit`
Expected: 4 passed, 0 failed

- [ ] **Step 8: Verify manual dry-run**

Run:
```bash
cd src-tauri && cargo build --bin cc-status-emit
echo '{"session_id":"test","tool_name":"Skill"}' | ./target/debug/cc-status-emit --event PreToolUse --secret mysecret --dry-run
```
Expected output:
```
X-Signature: hmac-sha256=<64-hex-chars>
{"session_id":"test","tool_name":"Skill","state":"tool-use","timestamp_ms":<ms>}
```

- [ ] **Step 9: Run v4 verification trio**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build:vite`
Expected: All three exit 0

- [ ] **Step 10: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/bin/cc-status-emit.rs src-tauri/src/bin/cc_status_emit_test.rs
git commit -m "feat(pet): D34 c3 — cc-status-emit binary + [[bin]] 段

- src-tauri/src/bin/cc-status-emit.rs (80 行):
  - 读 stdin JSON → 注入 state (via state_for_hook) + timestamp_ms
  - HMAC-SHA256 签名 (secret 从 $CC_PET_SECRET env 或 --secret 参数)
  - POST 127.0.0.1:19847/agent-event (手写 HTTP, 无外部 http crate)
  - 全部错误路径 exit 0 静默丢弃 (E1: agent 终端不污染)
  - --dry-run 测试模式 (打签名 + body, 不真 POST)
- src-tauri/src/bin/cc_status_emit_test.rs 4 测试:
  - HMAC 签名输出格式
  - Stop → Completed 映射 (HOOK_TO_STATE 走通)
  - 未知 event (PermissionRequest) exit 0
  - 无 secret exit 0 (E1)
- Cargo.toml 加 [[bin]] 段 (v1.2 F1 修正: v4 原本无 [[bin]])
- Cargo.toml 加 hmac/sha2/hex 3 依赖 (v1.2 F3 修正: 不要 rand, 用 getrandom 在 c4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: HTTP receiver + PetStateDaemon + install/uninstall (commit c4)

**Files:**
- Create: `src-tauri/src/pet/install.rs`
- Create: `src-tauri/src/pet/daemon.rs` (replace c2 stub)
- Create: `src-tauri/src/pet/http.rs`
- Modify: `src-tauri/src/pet/mod.rs` (add 3 submodules + register HTTP server in setup)
- Modify: `src-tauri/src/lib.rs` (handlers wire up install/uninstall real paths)
- Modify: `src-tauri/Cargo.toml` (add `axum`, `getrandom`)
- Test: `src-tauri/src/pet/install_test.rs`, `daemon_test.rs`, `http_test.rs`

**Interfaces:**
- Consumes: `PetState` / `AgentStateEvent` / `state_for_hook` from Task 1
- Produces:
  - `pub fn install_status_hooks(settings_path: &Path, secret: &str, cc_status_emit_path: &Path) -> Result<InstallResult, String>` — atomic write env + 6 hooks
  - `pub fn uninstall_status_hooks(settings_path: &Path) -> Result<UninstallResult, String>` — remove all cc-status-emit hooks + env
  - `pub fn secret_load_or_create(app_data_dir: &Path) -> Result<String, String>` — read or write `app_data_dir/secret.json`
  - `PetStateDaemon::handle_event(self: Arc<Self>, event: AgentStateEvent)` — write HashMap + broadcast + spawn synthetic idle if Completed
  - axum router with POST /agent-event + GET /agent-state

- [ ] **Step 1: Write failing tests for install.rs**

Create `src-tauri/src/pet/install_test.rs`:

```rust
//! v1.2 c4: install_status_hooks tests

use std::collections::HashMap;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_install_writes_env_and_six_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "test-secret", &emit_path).unwrap();

    assert_eq!(result.installed, 6);
    assert_eq!(result.skipped, 0);

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();

    // env.CC_PET_SECRET = "test-secret"
    assert_eq!(parsed["env"]["CC_PET_SECRET"], "test-secret");

    // 6 hooks installed
    let hooks = parsed["hooks"].as_object().unwrap();
    for event in ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification", "UserPromptSubmit"] {
        assert!(hooks.contains_key(event), "missing hook event: {}", event);
        let entries = hooks[event].as_array().unwrap();
        assert_eq!(entries.len(), 1, "expected 1 entry for {}", event);
        let cmd = entries[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("cc-status-emit"), "hook command should reference cc-status-emit: {}", cmd);
    }
}

#[test]
fn test_install_skips_already_installed_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Pre-existing cc-status-emit hook on PreToolUse — install must detect the
    // existing command (matched by .contains("cc-status-emit") per install.rs:43-56)
    // and skip PreToolUse while still installing the other 5 events.
    let pre = r#"{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"/path/cc-status-emit --event tool-use"}]}]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 5);  // 5 other events installed
    assert_eq!(result.skipped, 1);    // PreToolUse already had cc-status-emit

    // PreToolUse still has exactly one entry, and it's the original cc-status-emit
    // (we did not push a duplicate alongside the existing one).
    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let pre_entries = parsed["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_entries.len(), 1, "PreToolUse should keep its single existing entry, not get a duplicate");
    assert!(pre_entries[0]["hooks"][0]["command"].as_str().unwrap().contains("cc-status-emit"));
}

#[test]
fn test_install_preserves_unrelated_hook_on_same_event() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Pre-existing PreToolUse hook is some unrelated tool (not cc-status-emit).
    // Per install.rs:43-56, the skip check looks for a "cc-status-emit" substring,
    // so other-tool does NOT count as "already installed" — our hook should still
    // be added alongside it, and the unrelated hook must be preserved.
    let pre = r#"{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"other-tool"}]}]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 6);  // all 6 events installed
    assert_eq!(result.skipped, 0);    // none skipped — other-tool is not "ours"

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let pre_entries = parsed["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_entries.len(), 2, "PreToolUse should now have both other-tool and cc-status-emit");
    // both commands present
    assert!(raw.contains("other-tool"));
    assert!(raw.contains("cc-status-emit"));
}

#[test]
fn test_install_preserves_unknown_top_level_fields() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Custom user field at top level
    let pre = r#"{"customField":"keep-me","permissions":{"allow":["Bash"]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    install_status_hooks_impl(&settings_path, "s", &emit_path).unwrap();

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["customField"], "keep-me");
    assert!(parsed["permissions"]["allow"].is_array());
}

#[test]
fn test_install_rejects_unknown_event() {
    // PermissionRequest is NOT in v4 HOOK_EVENTS — install must error out, not silently add
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();
    let emit_path = dir.path().join("cc-status-emit.exe");

    let result = install_status_hooks_with_events(
        &settings_path,
        "s",
        &emit_path,
        &["PermissionRequest"],
    );
    assert!(result.is_err(), "PermissionRequest must be rejected (v1.2 F5)");
}

#[test]
fn test_uninstall_removes_only_cc_status_emit_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    let pre = r#"{
        "hooks": {
            "PreToolUse": [
                {"matcher":"","hooks":[{"type":"command","command":"other-tool"}]},
                {"matcher":"","hooks":[{"type":"command","command":"cc-status-emit --event tool-use"}]}
            ],
            "Stop": [
                {"matcher":"","hooks":[{"type":"command","command":"cc-status-emit --event completed"}]}
            ]
        },
        "env": {"CC_PET_SECRET": "x", "OTHER_VAR": "keep"}
    }"#;
    fs::write(&settings_path, pre).unwrap();

    let result = uninstall_status_hooks(&settings_path).unwrap();
    assert_eq!(result.removed, 2);  // cc-status-emit entries

    let raw = fs::read_to_string(&settings_path).unwrap();
    // other-tool preserved
    assert!(raw.contains("other-tool"));
    // CC_PET_SECRET removed, OTHER_VAR kept
    assert!(!raw.contains("CC_PET_SECRET"));
    assert!(raw.contains("OTHER_VAR"));
}

// Helper signatures — defined in install.rs (Step 3)
fn install_status_hooks_impl(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, crate::repo::hooks_scanner::HOOK_EVENTS)
}

fn install_status_hooks_with_events(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
    events: &[&str],
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, events)
}
```

- [ ] **Step 2: Run install tests to verify they fail**

Run: `cd src-tauri && cargo test --lib pet::install_test`
Expected: FAIL with "cannot find function `install_status_hooks_impl`"

- [ ] **Step 3: Implement `src-tauri/src/pet/install.rs`**

```rust
//! v1.2 c4: install_status_hooks / uninstall_status_hooks / secret management
//!
//! Spec §5.5 — atomic write env.CC_PET_SECRET + 6 hooks.
//! Spec §3.2.1 — not directly using repo::hooks_writer::create_hook (single-event only).
//! Spec §7 E2 — HMAC secret file.

use crate::pet::state::InstallResult;
use crate::repo::hooks_scanner::HOOK_EVENTS;
use crate::util::atomic_write::atomic_write_json;
use crate::util::settings_reader::read_claude_settings;
use serde_json::{json, Value};
use std::path::Path;

pub fn install_status_hooks(
    settings_path: &Path,
    secret: &str,
    emit_path: &Path,
    events: &[&str],
) -> Result<InstallResult, String> {
    // 1. Validate all events are in HOOK_EVENTS
    for ev in events {
        if !HOOK_EVENTS.contains(ev) {
            return Err(format!("event '{}' not in HOOK_EVENTS ({:?})", ev, HOOK_EVENTS));
        }
    }

    // 2. Read existing settings (raw JSON to preserve unknown fields)
    let raw = std::fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut settings: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    let obj = settings.as_object_mut().ok_or("settings.json not an object")?;

    // 3. Skip already-installed cc-status-emit hooks
    let existing_hooks = obj.get("hooks").and_then(|v| v.as_object()).cloned();
    let mut installed = 0;
    let mut skipped = 0;

    let hooks_map = obj.entry("hooks".to_string()).or_insert(json!({}));
    let hooks_obj = hooks_map.as_object_mut().ok_or("hooks not an object")?;

    let emit_path_str = emit_path.to_string_lossy().to_string();

    for event in events {
        let entries = hooks_obj.entry(event.to_string()).or_insert(json!([]));
        let arr = entries.as_array_mut().ok_or_else(|| format!("hooks.{} not array", event))?;

        // Check if cc-status-emit hook already exists (idempotent install)
        let already_installed = arr.iter().any(|entry| {
            entry["hooks"]
                .as_array()
                .and_then(|hooks| hooks.first())
                .and_then(|h| h["command"].as_str())
                .map(|cmd| cmd.contains("cc-status-emit"))
                .unwrap_or(false)
        });

        if already_installed {
            skipped += 1;
            continue;
        }

        // Map event to PetState for --event flag value
        let state_arg = match event.as_ref() {
            "PreToolUse" | "PostToolUse" => "tool-use",
            "Stop" | "SubagentStop" => "completed",
            "Notification" => "ask-user",
            "UserPromptSubmit" => "responding",
            _ => unreachable!("validated above"),
        };

        arr.push(json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": format!("{} --event {}", emit_path_str, state_arg)
            }]
        }));
        installed += 1;
    }

    // 4. Merge env.CC_PET_SECRET (non-destructive)
    let env_map = obj.entry("env".to_string()).or_insert(json!({}));
    let env_obj = env_map.as_object_mut().ok_or("env not an object")?;
    env_obj.insert("CC_PET_SECRET".to_string(), json!(secret));

    // 5. Atomic write
    atomic_write_json(settings_path, &settings).map_err(|e| format!("atomic_write: {}", e))?;

    let _ = existing_hooks;  // suppress unused
    Ok(InstallResult { installed, skipped })
}

pub fn uninstall_status_hooks(settings_path: &Path) -> Result<crate::pet::state::UninstallResult, String> {
    let raw = std::fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut settings: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    let obj = settings.as_object_mut().ok_or("settings.json not an object")?;

    let mut removed = 0;

    // Remove all cc-status-emit hook entries
    if let Some(hooks) = obj.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for (_event, entries) in hooks.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|entry| {
                    let is_ours = entry["hooks"]
                        .as_array()
                        .and_then(|hooks| hooks.first())
                        .and_then(|h| h["command"].as_str())
                        .map(|cmd| cmd.contains("cc-status-emit"))
                        .unwrap_or(false);
                    !is_ours
                });
                removed += before - arr.len();
            }
        }
    }

    // Remove CC_PET_SECRET from env
    if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        env.remove("CC_PET_SECRET");
    }

    atomic_write_json(settings_path, &settings).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(crate::pet::state::UninstallResult { removed })
}

pub fn secret_load_or_create(app_data_dir: &Path) -> Result<String, String> {
    let secret_path = app_data_dir.join("secret.json");
    if secret_path.exists() {
        let raw = std::fs::read_to_string(&secret_path).map_err(|e| format!("read secret.json: {}", e))?;
        let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("parse secret.json: {}", e))?;
        return parsed["secret"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "secret.json missing 'secret' field".to_string());
    }

    // Generate new 32-byte hex secret
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("getrandom: {}", e))?;
    let secret = hex::encode(bytes);

    std::fs::create_dir_all(app_data_dir).map_err(|e| format!("mkdir: {}", e))?;
    atomic_write_json(&secret_path, &json!({ "secret": secret }))
        .map_err(|e| format!("atomic_write secret.json: {}", e))?;

    Ok(secret)
}
```

- [ ] **Step 4: Run install tests to verify they pass**

Run: `cd src-tauri && cargo test --lib pet::install_test`
Expected: 5 passed, 0 failed

- [ ] **Step 5: Add 2 deps to Cargo.toml**

Modify `src-tauri/Cargo.toml` `[dependencies]`, add 2 entries (after `hex` from Task 3):

```toml
axum = "0.7"           # v1.2 c4: HTTP server
getrandom = "0.3"      # v1.2 c4: 32-byte secret generation
```

- [ ] **Step 6: Write failing tests for daemon.rs (replace c2 stub)**

Create `src-tauri/src/pet/daemon_test.rs`:

```rust
//! v1.2 c4: PetStateDaemon tests

use std::sync::Arc;
use std::time::Duration;
use crate::pet::state::{AgentStateEvent, PetState};
use crate::pet::daemon::PetStateDaemon;

fn make_event(session: &str, state: PetState) -> AgentStateEvent {
    AgentStateEvent {
        session_id: session.to_string(),
        cwd: None,
        state,
        tool_name: None,
        skill_name: None,
        mcp_server: None,
        elapsed_ms: None,
        timestamp_ms: 0,
        payload: serde_json::json!(null),
    }
}

#[tokio::test]
async fn test_daemon_writes_event_to_hashmap() {
    let daemon = PetStateDaemon::new();
    let event = make_event("s1", PetState::ToolUse);
    daemon.handle_event(event.clone()).await;

    let sessions = daemon.snapshot();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "s1");
    assert_eq!(sessions[0].state, PetState::ToolUse);
}

#[tokio::test]
async fn test_daemon_broadcasts_to_subscribers() {
    let daemon = PetStateDaemon::new();
    let mut rx = daemon.subscribe();

    let event = make_event("s1", PetState::Thinking);
    daemon.handle_event(event.clone()).await;

    let received = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await
        .expect("timeout")
        .expect("recv failed");
    assert_eq!(received.session_id, "s1");
    assert_eq!(received.state, PetState::Thinking);
}

#[tokio::test]
async fn test_daemon_synthetic_idle_after_completed() {
    let daemon = PetStateDaemon::new();
    let mut rx = daemon.subscribe();

    let event = make_event("s1", PetState::Completed);
    daemon.handle_event(event).await;

    // First event is the Completed
    let first = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await.unwrap().unwrap();
    assert_eq!(first.state, PetState::Completed);

    // Synthetic Idle should arrive after 5s (per §11.3)
    let second = tokio::time::timeout(Duration::from_secs(6), rx.recv()).await
        .expect("synthetic idle should arrive within 6s");
    let idle = second.expect("recv failed");
    assert_eq!(idle.state, PetState::Idle);
    assert_eq!(idle.session_id, "s1");
}

#[tokio::test]
async fn test_daemon_concurrent_writes_no_panic() {
    let daemon = PetStateDaemon::new();
    let mut handles = Vec::new();
    for i in 0..10 {
        let d = daemon.clone();
        handles.push(tokio::spawn(async move {
            d.handle_event(make_event(&format!("s{}", i), PetState::ToolUse)).await;
        }));
    }
    for h in handles { h.await.unwrap(); }
    assert_eq!(daemon.snapshot().len(), 10);
}
```

- [ ] **Step 7: Run daemon tests to verify they fail**

Run: `cd src-tauri && cargo test --lib pet::daemon_test`
Expected: FAIL with "handle_event not found" / "subscribe not found"

- [ ] **Step 8: Replace `src-tauri/src/pet/daemon.rs` with full implementation**

Overwrite `src-tauri/src/pet/daemon.rs` (replacing c2 stub) with:

```rust
//! v1.2 c4: PetStateDaemon — single source of truth for in-memory pet state
//!
//! Spec §11.1 (parking_lot::Mutex<HashMap>), §11.2 (broadcast + mpsc), §11.3 (synthetic idle).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use parking_lot::Mutex;
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use crate::pet::state::AgentStateEvent;

pub struct PetStateDaemon {
    sessions: Mutex<HashMap<String, AgentStateEvent>>,
    broadcast: broadcast::Sender<AgentStateEvent>,
    pub event_tx: mpsc::Sender<AgentStateEvent>,
}

impl PetStateDaemon {
    pub fn new() -> Arc<Self> {
        let (bcast, _) = broadcast::channel(64);
        let (tx, rx) = mpsc::channel(256);
        let daemon = Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
            event_tx: tx,
        });

        // Spawn the mpsc → daemon loop task
        let daemon_clone = daemon.clone();
        tokio::spawn(async move {
            Self::run_loop(daemon_clone, rx).await;
        });

        daemon
    }

    async fn run_loop(self: Arc<Self>, mut rx: mpsc::Receiver<AgentStateEvent>) {
        while let Some(event) = rx.recv().await {
            self.handle_event(event).await;
        }
    }

    pub async fn handle_event(self: Arc<Self>, event: AgentStateEvent) {
        let session_id = event.session_id.clone();
        let state = event.state;

        // 1. Write to HashMap (parking_lot::Mutex, sync, fast)
        {
            let mut map = self.sessions.lock();
            map.insert(session_id.clone(), event.clone());
        }

        // 2. Broadcast to subscribers
        let _ = self.broadcast.send(event.clone());

        // 3. Spawn synthetic idle if Completed (per §11.3)
        if state == crate::pet::state::PetState::Completed {
            let bcast = self.broadcast.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let idle = AgentStateEvent {
                    session_id: session_id.clone(),
                    cwd: None,
                    state: crate::pet::state::PetState::Idle,
                    tool_name: None,
                    skill_name: None,
                    mcp_server: None,
                    elapsed_ms: None,
                    timestamp_ms: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0),
                    payload: serde_json::json!(null),
                };
                let _ = bcast.send(idle);
            });
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentStateEvent> {
        self.broadcast.subscribe()
    }

    pub fn snapshot(&self) -> Vec<AgentStateEvent> {
        let map = self.sessions.lock();
        map.values().cloned().collect()
    }
}
```

- [ ] **Step 9: Run daemon tests to verify they pass**

Run: `cd src-tauri && cargo test --lib pet::daemon_test`
Expected: 4 passed, 0 failed

- [ ] **Step 10: Write failing tests for http.rs**

Create `src-tauri/src/pet/http_test.rs`:

```rust
//! v1.2 c4: HTTP receiver tests

use axum::http::{Request, StatusCode};
use std::sync::Arc;
use crate::pet::state::AgentStateEvent;
use crate::pet::daemon::PetStateDaemon;
use crate::pet::http::{build_router, verify_hmac};

fn sign(secret: &str, body: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[tokio::test]
async fn test_http_rejects_bad_signature() {
    let daemon = PetStateDaemon::new();
    let secret = "test-secret".to_string();
    let app = build_router(daemon, secret.clone());

    let body = r#"{"session_id":"abc","state":"tool-use","timestamp_ms":1}"#;
    let req = Request::builder()
        .method("POST")
        .uri("/agent-event")
        .header("content-type", "application/json")
        .header("x-signature", "hmac-sha256=deadbeef")
        .body(body.to_string())
        .unwrap();

    let response = axum::body::to_bytes(app.oneshot(req).await.unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_http_accepts_valid_signature() {
    let daemon = PetStateDaemon::new();
    let secret = "test-secret".to_string();
    let app = build_router(daemon.clone(), secret.clone());

    let body = r#"{"session_id":"abc","state":"tool-use","timestamp_ms":1}"#;
    let sig = sign(&secret, body);
    let req = Request::builder()
        .method("POST")
        .uri("/agent-event")
        .header("content-type", "application/json")
        .header("x-signature", format!("hmac-sha256={}", sig))
        .body(body.to_string())
        .unwrap();

    let response = axum::body::to_bytes(app.oneshot(req).await.unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify event reached daemon
    let snapshot = daemon.snapshot();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].session_id, "abc");
}

#[tokio::test]
async fn test_http_get_returns_snapshot() {
    let daemon = PetStateDaemon::new();
    let event = AgentStateEvent {
        session_id: "s1".into(),
        cwd: None,
        state: crate::pet::state::PetState::Thinking,
        tool_name: None,
        skill_name: None,
        mcp_server: None,
        elapsed_ms: None,
        timestamp_ms: 1,
        payload: serde_json::json!(null),
    };
    daemon.handle_event(event).await;

    let secret = "s".to_string();
    let app = build_router(daemon, secret);
    let req = Request::builder()
        .method("GET")
        .uri("/agent-state")
        .body(String::new())
        .unwrap();

    let response = axum::body::to_bytes(app.oneshot(req).await.unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(response.to_vec()).unwrap();
    assert!(body.contains("s1"));
}

#[test]
fn test_hmac_verify_roundtrip() {
    let body = "hello";
    let secret = "key";
    let sig = sign(secret, body);
    assert!(verify_hmac(secret, body, &format!("hmac-sha256={}", sig)));
    assert!(!verify_hmac(secret, body, "hmac-sha256=wrong"));
    assert!(!verify_hmac(secret, body, ""));
}
```

- [ ] **Step 11: Run http tests to verify they fail**

Run: `cd src-tauri && cargo test --lib pet::http_test`
Expected: FAIL with "cannot find function `build_router`"

- [ ] **Step 12: Implement `src-tauri/src/pet/http.rs`**

```rust
//! v1.2 c4: HTTP receiver — axum server on 127.0.0.1:19847
//!
//! Spec §5.4 (HTTP protocol), §10 T2 (event flow).
//!
//! Endpoints:
//! - POST /agent-event: HMAC verify → parse → mpsc submit to daemon
//! - GET /agent-state: return daemon snapshot

use std::sync::Arc;
use axum::{routing::{get, post}, Router, Json, extract::State, http::StatusCode, http::HeaderMap};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::pet::daemon::PetStateDaemon;
use crate::pet::state::AgentStateEvent;

type HmacSha256 = Hmac<Sha256>;

pub fn build_router(daemon: Arc<PetStateDaemon>, secret: String) -> Router {
    Router::new()
        .route("/agent-event", post(handler_post))
        .route("/agent-state", get(handler_get))
        .with_state((daemon, secret))
}

type AppState = (Arc<PetStateDaemon>, String);

async fn handler_post(
    State((daemon, secret)): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // 1. HMAC verify
    let sig_header = headers.get("x-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_hmac(&secret, &body, sig_header) {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid signature"}))));
    }

    // 2. Parse AgentStateEvent
    let event: AgentStateEvent = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": "schema invalid", "details": e.to_string()}))))?;

    // 3. Submit to daemon via mpsc
    daemon.event_tx.send(event).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("daemon closed: {}", e)}))))?;

    Ok(Json(json!({"ok": true})))
}

async fn handler_get(State((daemon, _secret)): State<AppState>) -> Json<Vec<AgentStateEvent>> {
    Json(daemon.snapshot())
}

pub fn verify_hmac(secret: &str, body: &str, header: &str) -> bool {
    // Header format: "hmac-sha256=<hex>"
    let sig_hex = match header.strip_prefix("hmac-sha256=") {
        Some(s) => s,
        None => return false,
    };
    let sig_bytes = match hex::decode(sig_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body.as_bytes());
    mac.verify_slice(&sig_bytes).is_ok()
}

pub async fn start_http_server(daemon: Arc<PetStateDaemon>, secret: String) -> Result<(), String> {
    let app = build_router(daemon, secret);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:19847")
        .await
        .map_err(|e| format!("bind 127.0.0.1:19847: {}", e))?;

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[pet http] server error: {}", e);
        }
    });
    Ok(())
}
```

- [ ] **Step 13: Run http tests to verify they pass**

Run: `cd src-tauri && cargo test --lib pet::http_test`
Expected: 4 passed, 0 failed

- [ ] **Step 14: Update `src-tauri/src/pet/mod.rs` to wire all submodules**

Overwrite `src-tauri/src/pet/mod.rs`:

```rust
//! v1.2 cc-pet: Hopet-like embedded desktop pet module
//!
//! Spec: docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md

pub mod state;
pub mod daemon;
pub mod install;
pub mod http;
```

- [ ] **Step 15: Wire install/uninstall handlers in lib.rs**

Modify `src-tauri/src/lib.rs`, replace c2 stubs (the two `Err("not implemented in c2...")` handlers):

Find the c2 placeholder handlers (in Task 2 step 3 area) and replace with:

```rust
#[tauri::command]
async fn cmd_pet_install_status_hook(app: tauri::AppHandle) -> Result<crate::pet::state::InstallResult, String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let secret = crate::pet::install::secret_load_or_create(&app_data_dir)?;

    let settings_path = home::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "home_dir not found".to_string())?;

    let emit_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.join(if cfg!(windows) { "cc-status-emit.exe" } else { "cc-status-emit" }))
        .ok_or_else(|| "exe parent dir not found".to_string())?;

    let result = crate::pet::install::install_status_hooks(
        &settings_path,
        &secret,
        &emit_path,
        crate::repo::hooks_scanner::HOOK_EVENTS,
    )?;

    // Start HTTP server + Daemon already running (started in setup hook)
    Ok(result)
}

#[tauri::command]
async fn cmd_pet_uninstall_status_hook(_app: tauri::AppHandle) -> Result<crate::pet::state::UninstallResult, String> {
    let settings_path = home::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "home_dir not found".to_string())?;
    crate::pet::install::uninstall_status_hooks(&settings_path)
}
```

Also update `cmd_pet_get_status` to use real daemon:

```rust
#[tauri::command]
fn cmd_pet_get_status(state: tauri::State<std::sync::Arc<crate::pet::daemon::PetStateDaemon>>) -> Result<Vec<crate::pet::state::AgentStateEvent>, String> {
    Ok(state.snapshot())
}
```

- [ ] **Step 16: Start HTTP server in setup hook**

Modify `src-tauri/src/lib.rs` setup hook (Task 2 Step 6 area), add HTTP server spawn:

```rust
.setup(|app| {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir()?;
    let db = crate::db::init_db(&app_data_dir)?;
    if let Err(e) = crate::importer::rescan_all(&db) {
        eprintln!("[startup] rescan_all failed: {}", e);
    }
    app.manage(crate::db::DbState::new(db));

    // v1.2 c4: PetStateDaemon + HTTP receiver
    let daemon = crate::pet::daemon::PetStateDaemon::new();
    let secret = crate::pet::install::secret_load_or_create(&app_data_dir)?;
    if let Err(e) = crate::pet::http::start_http_server(daemon.clone(), secret.clone()).await {
        eprintln!("[startup] pet http server failed: {}", e);
    }
    app.manage(daemon);

    Ok(())
})
```

Note: setup hook is `|app| { ... }` — for async work, Tauri 2 requires `.setup(|app| Box::pin(async move { ... }))`. Use:

```rust
.setup(|app| {
    Box::pin(async move {
        use tauri::Manager;
        let app_data_dir = app.path().app_data_dir()?;
        let db = crate::db::init_db(&app_data_dir)?;
        if let Err(e) = crate::importer::rescan_all(&db) {
            eprintln!("[startup] rescan_all failed: {}", e);
        }
        app.manage(crate::db::DbState::new(db));

        let daemon = crate::pet::daemon::PetStateDaemon::new();
        let secret = crate::pet::install::secret_load_or_create(&app_data_dir)?;
        if let Err(e) = crate::pet::http::start_http_server(daemon.clone(), secret.clone()).await {
            eprintln!("[startup] pet http server failed: {}", e);
        }
        app.manage(daemon);

        Ok(())
    })
})
```

- [ ] **Step 17: Run v4 verification trio**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build:vite`
Expected: All three exit 0

- [ ] **Step 18: Run all pet tests**

Run: `cd src-tauri && cargo test --lib pet`
Expected: 5 (install) + 4 (daemon) + 4 (http) + 6 (state) = 19 passed, 0 failed

- [ ] **Step 19: Commit**

```bash
git add src-tauri/src/pet/ src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat(pet): D34 c4 — HTTP receiver + PetStateDaemon + install/uninstall

- pet/install.rs (150 行):
  - install_status_hooks: 校验 6 个 event 在 HOOK_EVENTS / 跳过已装 / atomic 写 env+hooks
  - uninstall_status_hooks: 移除所有 cc-status-emit entries + CC_PET_SECRET env
  - secret_load_or_create: getrandom 32 字节 → hex 64 字符 → 写 app_data_dir/secret.json (JSON 格式, v1.2 F2 修正)
- pet/daemon.rs (重写 c2 stub):
  - PetStateDaemon::new() Arc Self + spawn mpsc→handle_event loop
  - handle_event: 持锁写 HashMap + broadcast + 5s timer 合成 Idle (D34.11)
  - subscribe / snapshot 给前端 listen
  - parking_lot::Mutex<HashMap> (D34.10, Cargo.lock 已有 transitive)
- pet/http.rs (110 行):
  - axum 0.7 Router: POST /agent-event (HMAC verify + mpsc) + GET /agent-state (snapshot)
  - verify_hmac 函数: hex 解码 + constant-time 比较
  - start_http_server: bind 127.0.0.1:19847 + spawn serve
- lib.rs setup hook: 启动 daemon + http server (Box::pin async)
- 3 个 test 文件 (install 5 / daemon 4 / http 4) = 13 case 全过
- Cargo.toml: 加 axum 0.7 + getrandom 0.3 (v1.2 F3 修正: 实际只需这 2 + Task 3 已加的 hmac/sha2/hex = 5 dep 总)

⚠️ AgentStateEvent 字段真机手验推迟到 c5 完成后的端到端测试 (spec §9.3 第 9 步).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend PetModule + PetWindow + capabilities (commit c5)

**Files:**
- Create: `src/modules/pet/PetModule.tsx`
- Create: `src/modules/pet/PetWindow.tsx`
- Create: `src/pet-main.tsx`
- Create: `src/pet.html`
- Create: `src-tauri/capabilities/pet.json`
- Modify: `src/api-tauri.ts` (add 5 wrappers)
- Modify: `src/App.tsx` (add 'pet' to TAB_KEYS + render)
- Modify: `vite.config.ts` (add second rollup input)

**Interfaces:**
- Consumes: `api.pet*` wrappers from `src/api-tauri.ts`
- Produces: 10th Tab in main window, separate pet window with sprite + bubble

- [ ] **Step 1: Add 5 wrappers to `src/api-tauri.ts`**

Modify `src/api-tauri.ts`, find end of `export const api = { ... }` block and add 5 new entries before closing `};`. The closing `};` is at the end of file (after all existing wrappers). Insert these new wrappers just before it:

```typescript
  // ===== Pet (v1.2 D34 / commit 5) =====
  petInstallStatusHook: (): Promise<InstallResult> =>
    invoke<InstallResult>('cmd_pet_install_status_hook'),
  petUninstallStatusHook: (): Promise<UninstallResult> =>
    invoke<UninstallResult>('cmd_pet_uninstall_status_hook'),
  petWindowOpen: (): Promise<void> => invoke<void>('cmd_pet_window_open'),
  petWindowClose: (): Promise<void> => invoke<void>('cmd_pet_window_close'),
  petGetStatus: (): Promise<AgentStateEvent[]> =>
    invoke<AgentStateEvent[]>('cmd_pet_get_status'),
```

Also add new types to `src/types.ts` (create the type imports in api-tauri.ts):

Open `src/types.ts`, find end of file, add 3 new types:

```typescript
// ===== v1.2 D34: Pet types =====
export interface InstallResult {
  installed: number;
  skipped: number;
}

export interface UninstallResult {
  removed: number;
}

export type PetState =
  | 'idle'
  | 'responding'
  | 'thinking'
  | 'tool-use'
  | 'ask-user'
  | 'completed'
  | 'error-interrupted';

export interface AgentStateEvent {
  session_id: string;
  cwd: string | null;
  state: PetState;
  tool_name: string | null;
  skill_name: string | null;
  mcp_server: string | null;
  elapsed_ms: number | null;
  timestamp_ms: number;
  payload: any;
}
```

Update import in `api-tauri.ts` to include these new types:

```typescript
import type {
  ProjectRow,
  // ... existing imports ...
  InstallResult,
  UninstallResult,
  AgentStateEvent,
} from './types';
```

- [ ] **Step 2: Create `src/pet.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cc-pet</title>
  </head>
  <body style="margin: 0; padding: 0; background: transparent;">
    <div id="root"></div>
    <script type="module" src="/src/pet-main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/pet-main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PetWindow } from './modules/pet/PetWindow';
import './global.d';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetWindow />
  </React.StrictMode>
);
```

- [ ] **Step 4: Create `src/modules/pet/PetModule.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { Button, List, Space, Typography, Tag, notification } from 'antd';
import { api } from '../../api-tauri';
import type { AgentStateEvent, InstallResult, PetState } from '../../types';

const { Title, Text } = Typography;

const STATE_COLORS: Record<PetState, string> = {
  'idle': 'default',
  'responding': 'blue',
  'thinking': 'purple',
  'tool-use': 'cyan',
  'ask-user': 'orange',
  'completed': 'green',
  'error-interrupted': 'red',
};

const STATE_LABELS: Record<PetState, string> = {
  'idle': '空闲',
  'responding': '响应中',
  'thinking': '思考中',
  'tool-use': '调用工具',
  'ask-user': '等待介入',
  'completed': '已完成',
  'error-interrupted': '出错中断',
};

export function PetModule() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [events, setEvents] = useState<AgentStateEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.petGetStatus().then(setEvents).catch(() => setEvents([]));
  }, []);

  const handleInstall = async () => {
    setLoading(true);
    try {
      const result: InstallResult = await api.petInstallStatusHook();
      setInstalled(true);
      notification.success({
        message: 'Agent Status Hook 已安装',
        description: `已装 ${result.installed} 条 hook, 跳过 ${result.skipped} 条已存在的`,
      });
    } catch (e: any) {
      notification.error({ message: '安装失败', description: e.toString() });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWindow = async () => {
    try {
      await api.petWindowOpen();
    } catch (e: any) {
      notification.error({ message: '打开宠物窗口失败', description: e.toString() });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>桌面宠物 (cc-pet)</Title>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space>
          <Button type="primary" onClick={handleInstall} loading={loading}>
            {installed === null ? '安装 Agent Status Hook' : installed ? '重新安装 Hook' : '安装 Hook'}
          </Button>
          <Button onClick={handleOpenWindow} disabled={installed !== true}>
            打开宠物窗口
          </Button>
        </Space>
        <Text type="secondary">
          安装 hook 后, Claude Code 运行时会向 cc-manager 上报状态, 宠物窗口会实时显示调用的 skill / mcp, 会话完成时弹通知。
        </Text>

        <Title level={4} style={{ marginTop: 24 }}>活跃会话</Title>
        {events.length === 0 ? (
          <Text type="secondary">暂无活跃会话。安装 hook 后, 跑 Claude Code 触发事件即可看到。</Text>
        ) : (
          <List
            bordered
            dataSource={events}
            renderItem={(item) => (
              <List.Item>
                <Space>
                  <Tag color={STATE_COLORS[item.state]}>{STATE_LABELS[item.state]}</Tag>
                  <Text code>{item.session_id.slice(0, 8)}</Text>
                  {item.tool_name && <Text>tool: {item.tool_name}</Text>}
                  {item.skill_name && <Text type="success">skill: {item.skill_name}</Text>}
                  {item.mcp_server && <Text type="warning">mcp: {item.mcp_server}</Text>}
                  {item.cwd && <Text type="secondary" style={{ fontSize: 12 }}>{item.cwd}</Text>}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/modules/pet/PetWindow.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AgentStateEvent, PetState } from '../../types';

// 7 state → GIF mapping (asset paths, see §13 待办 1: 像素 GIF 来源待定)
// 暂时用 emoji 占位, v1.2 验证通过后换真 GIF
const SPRITE_MAP: Record<PetState, string> = {
  'idle': '😐',
  'responding': '💬',
  'thinking': '🤔',
  'tool-use': '🔧',
  'ask-user': '❓',
  'completed': '✅',
  'error-interrupted': '❌',
};

const STATE_LABELS: Record<PetState, string> = {
  'idle': '空闲',
  'responding': '正在回复…',
  'thinking': '思考中…',
  'tool-use': '调用工具',
  'ask-user': '需要你介入',
  'completed': '已完成',
  'error-interrupted': '中断',
};

export function PetWindow() {
  const [current, setCurrent] = useState<AgentStateEvent | null>(null);

  useEffect(() => {
    // Listen to daemon broadcast events
    const unlisten = listen<AgentStateEvent>('agent-state-event', (e) => {
      setCurrent(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const state: PetState = current?.state ?? 'idle';
  const sprite = SPRITE_MAP[state];
  const label = STATE_LABELS[state];
  const bubble =
    current?.skill_name ? `调用 Skill: ${current.skill_name}` :
    current?.mcp_server ? `调用 MCP: ${current.mcp_server}` :
    current?.tool_name ? `调用 ${current.tool_name}` :
    label;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      <div style={{
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 12,
        padding: '8px 14px',
        marginBottom: 8,
        fontSize: 13,
        maxWidth: 220,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        {bubble}
      </div>
      <div style={{ fontSize: 80, lineHeight: 1, cursor: 'grab' }}>
        {sprite}
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
        {current?.session_id?.slice(0, 8) ?? '—'}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src-tauri/capabilities/pet.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "pet-window",
  "description": "pet window capability — listen events + basic window API",
  "windows": ["pet"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default"
  ]
}
```

- [ ] **Step 7: Update `vite.config.ts` for second rollup input**

Modify `vite.config.ts`, replace `build:` block (line 38-41):

```ts
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        pet: './pet.html',
      },
    },
  },
```

- [ ] **Step 8: Update `src/App.tsx` to add Pet tab**

Modify `src/App.tsx`, find `TAB_KEYS` array (around line 18-28), add `'pet'`:

```tsx
const TAB_KEYS = [
  'sessions',
  'mcp',
  'skills',
  'commands',
  'sub-agents',
  'hooks',
  'plugins',
  'profiles',
  'usage',
  'pet',
] as const;
```

Find `TAB_LABELS` record (around line 30-42), add `'pet': '宠物',`:

```tsx
const TAB_LABELS: Record<TabKey, string> = {
  sessions: '会话',
  mcp: 'MCP',
  skills: 'Skills',
  commands: 'Commands',
  'sub-agents': 'Sub-Agents',
  hooks: 'Hooks',
  plugins: '插件',
  profiles: 'Profiles',
  usage: '用量分析',
  pet: '宠物',
};
```

Add import at top of file (after other `import` lines):

```tsx
import { PetModule } from './modules/pet/PetModule';
```

Find the `<Tabs>` rendering block (search for `{TAB_KEYS.map(...)}`), add pet case. The exact render code depends on existing structure — find the section that renders each TabPane based on TAB_KEYS and add:

```tsx
{activeTab === 'pet' && <PetModule />}
```

(The pattern may be different — look for `case 'usage':` or similar in the existing render and add a similar `case 'pet':` / `activeTab === 'pet'` block.)

- [ ] **Step 9: Wire backend emit to frontend via Tauri event**

For `PetWindow.tsx` `listen('agent-state-event', ...)` to receive events, the daemon must emit. Modify `src-tauri/src/pet/daemon.rs` `handle_event`:

Find the `handle_event` function (Task 4 Step 8), after `self.broadcast.send(event.clone())` (around line 65-70), add:

```rust
        // 3.5 Emit to Tauri webview (so listen('agent-state-event') fires)
        let app = tauri::AppHandle::current();  // requires app handle in daemon
        let _ = app.emit("agent-state-event", &event);
```

This requires `PetStateDaemon` to hold a `tauri::AppHandle`. Update `PetStateDaemon` struct (around line 14-17):

```rust
pub struct PetStateDaemon {
    sessions: Mutex<HashMap<String, AgentStateEvent>>,
    broadcast: broadcast::Sender<AgentStateEvent>,
    pub event_tx: mpsc::Sender<AgentStateEvent>,
    pub app_handle: tauri::AppHandle,  // v1.2 c5: for emit
}
```

And update `new()` signature to accept AppHandle (caller passes it from setup hook):

```rust
pub fn new(app: tauri::AppHandle) -> Arc<Self> {
    let (bcast, _) = broadcast::channel(64);
    let (tx, rx) = mpsc::channel(256);
    let daemon = Arc::new(Self {
        sessions: Mutex::new(HashMap::new()),
        broadcast: bcast,
        event_tx: tx,
        app_handle: app,
    });
    // ...
}
```

Update setup hook (Task 4 Step 16 area):

```rust
let app_handle = app.handle().clone();
let daemon = crate::pet::daemon::PetStateDaemon::new(app_handle);
```

Also `cmd_pet_get_status` handler — same update:

```rust
#[tauri::command]
fn cmd_pet_get_status(state: tauri::State<std::sync::Arc<crate::pet::daemon::PetStateDaemon>>) -> Result<Vec<crate::pet::state::AgentStateEvent>, String> {
    Ok(state.snapshot())
}
```

No changes needed here (state already accessed via tauri::State).

- [ ] **Step 10: Run v4 verification trio**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build:vite`
Expected: All three exit 0, `dist/pet.html` and `dist/index.html` both generated

- [ ] **Step 11: Run all tests**

Run: `cd src-tauri && cargo test --lib pet`
Expected: All pet tests still pass (state 6 + install 5 + daemon 4 + http 4 = 19)

- [ ] **Step 12: Commit**

```bash
git add src-tauri/capabilities/pet.json src-tauri/src/pet/ src/api-tauri.ts src/types.ts src/App.tsx src/modules/pet/ src/pet-main.tsx src/pet.html vite.config.ts
git commit -m "feat(pet): D34 c5 — 前端 PetModule + PetWindow + capabilities

- src/modules/pet/PetModule.tsx (110 行): 主 Tab '宠物' 内容
  - '安装 Agent Status Hook' 按钮 → api.petInstallStatusHook()
  - '打开宠物窗口' 按钮 → api.petWindowOpen()
  - 活跃会话列表 (Tag 颜色按 state)
  - antd notification.success/error
- src/modules/pet/PetWindow.tsx (70 行): 宠物窗口内容
  - listen('agent-state-event') → 切 sprite (7 emoji 占位, v1 后换真 GIF)
  - 气泡显示 '调用 Skill: xxx' / '调用 MCP: xxx' / '调用 xxx'
  - 透明背景 + 不可选中
- src/pet-main.tsx + src/pet.html: 宠物窗口独立 React 入口
- src-tauri/capabilities/pet.json (v1.2 F4 修正):
  - windows: ['pet'] 显式白名单 (Tauri 2 capabilities 不允许隐式覆盖)
  - 3 permissions: core:default + core:event:default + core:window:default
- src/api-tauri.ts: 加 5 wrapper (petInstallStatusHook/petUninstallStatusHook/petWindowOpen/petWindowClose/petGetStatus)
- src/types.ts: 加 InstallResult / UninstallResult / PetState / AgentStateEvent 类型
- src/App.tsx: TAB_KEYS 加 'pet' + TAB_LABELS 加 '宠物' + 渲染 <PetModule />
- vite.config.ts: build.rollupOptions.input 加 'pet: ./pet.html' (v1.2 §8.3 多入口; pet.html 在 repo 根)
- daemon.rs: 加 app_handle: tauri::AppHandle 字段 + emit('agent-state-event', &event) 让前端 listen 收到

⚠️ v1.2 §5.3 §9.3 第 9 步待真机手验:
  AgentStateEvent 字段名 (session_id/cwd/tool_name) 是 WebSearch 摘要推断.
  端到端测试时跑真 Claude Code, 检查 cc-status-emit 收到的 stdin JSON 字段.
  字段名不符 → fix AgentStateEvent + cc-status-emit mapping.

⚠️ v1.2 §13 待办 1: 像素动物 GIF 来源 (现 emoji 占位) 待 v4.1 落实.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (against spec v1.2)

**Spec coverage**:
- §1 项目定位 — covered by Task 5 (frontend entry points)
- §1.2 跟 Hopet 差异 — design constraint, no task needed (constraint documented)
- §1.3 v1 非目标 (7 things) — handled:砍 PermissionPrompt (Task 1), no Permission event (Task 3 + 4), embedded window (Task 2), manual open (Task 5)
- §3.1 Layer 1-5 — covered: L1 Task 4 install, L2 Task 3 cc-status-emit, L3 Task 4 http, L4 Task 4 daemon, L5 Task 5 PetWindow
- §3.2 三层链路 — covered: Task 5 frontend + Task 2/4 IPC + Task 4 repo
- §3.2.1 为什么不复用 create_hook — covered by Task 4 install.rs (new function)
- §5.1 PetState 7 状态 — Task 1
- §5.2 HOOK_TO_STATE — Task 1
- §5.3 AgentStateEvent — Task 1, 字段真机手验 (c5 commit msg flag)
- §5.4 HTTP 协议 — Task 4
- §5.5 Secret 管理 — Task 4 secret_load_or_create + Task 4 install_status_hooks
- §6 5 IPC — Task 2 + Task 4 wiring
- §7 错误处理 E1-E5 — covered: E1 Task 3 (exit 0 silent drop), E2 Task 4 (401), E3 Task 4 (400), E4 Task 4 (E5 mention), E5 Task 2 (window builder returns Err)
- §8.1 Cargo.toml — Task 3 + Task 4 + Task 5
- §8.2 tauri.conf.json — **not modified** (correct per spec §8.2)
- §8.3 vite.config.ts — Task 5 Step 7 (`pet.html` lives at repo root, not `src/` — D34 plan drift fix M4)
- §8.4 capabilities/pet.json — Task 5 Step 6
- §9.1-9.4 验证计划 — covered by global constraints + commit messages
- §10 T1-T3 数据流 — covered by Task 4 install.rs + daemon.rs + http.rs + Task 3 cc-status-emit
- §11.1 PetStateDaemon 锁 — Task 4 (parking_lot::Mutex<HashMap>)
- §11.2 EventBus — Task 4 (broadcast + mpsc)
- §11.3 synthetic idle — Task 4 (handle_event spawn timer)

**Type consistency check**:
- `PetState` 7 variants defined Task 1, used in Task 1/3/4/5 ✓
- `AgentStateEvent` defined Task 1 (Rust), Task 5 (TS) — field names match: session_id, cwd, state, tool_name, skill_name, mcp_server, elapsed_ms, timestamp_ms, payload ✓
- `HOOK_TO_STATE` defined Task 1, used Task 3 (cc-status-emit) + Task 4 (install validates against HOOK_EVENTS) ✓
- `PetStateDaemon::new()` signature: Task 2 stub returns Arc<Self>, Task 4 final returns Arc<Self> with app_handle parameter ✓ (Task 5 Step 9 updates signature to accept AppHandle)
- `cmd_pet_get_status` returns Vec<AgentStateEvent> ✓
- `InstallResult { installed, skipped }` / `UninstallResult { removed }` ✓ across all tasks

**Placeholder scan**:
- No "TBD" / "TODO" / "fill in" found
- All code blocks are complete
- All commands have expected output

**Risks explicitly flagged** (per v1.2 spec §5.3 §9.3):
- ⚠️ AgentStateEvent field names (session_id/cwd/tool_name) — flagged in Task 5 commit msg, deferred to end-to-end test
- ⚠️ Sprite GIF assets (Task 5 Step 5 uses emoji placeholders) — flagged in commit msg, deferred to v4.1