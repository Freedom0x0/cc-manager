# v4.0 · Tauri 2 全栈迁移设计

> 日期：2026-08-01
> 分支：`rust/full-tauri-migration`
> 决策者：用户（确认 A 完整迁移 + 同步做 macOS + 保留 main fallback + 按功能 commit）
> 状态：**草案，待用户 review**

---

## 0. 背景与目标

**v3.1 (Electron)** 已发布并稳定（130+ 提交，main 分支），用户最初因本机无 Rust 选 Electron；现已装 Rust 1.97.1 + Tauri CLI 2.11.4，准备用 Tauri 2 替换整个后端 + 跨平台装包栈。前端 React/Vite/antd 6 保留，仅替换 IPC 适配层。

**目标**：在 `rust/full-tauri-migration` 分支完成 Tauri 2 全栈迁移，**Windows + macOS** 双平台双装包，**保留 main 分支 Electron 版作 fallback**。

**非目标（v4.0 不做）**：
- 不重写 UI 任何一行业务代码（仅改 `src/api.ts` + `src/global.d.ts`）
- 不重写 antd 主题、Layout、视觉
- 不引入新的状态管理库
- 不引入 IPC 类型 codegen（手写类型即可，60 channel 体量可控）

---

## 1. 架构总览

### 1.1 当前形态（v3.1, Electron）

```
React 组件
  ↓
src/api.ts ── window.api.*
  ↓
electron/preload.ts ── contextBridge ── ipcRenderer.invoke
  ↓
electron/main.ts ── ipcMain.handle (60 channels)
  ↓
electron/repo/<module>/*.ts (pure DB / pure FS)
  ↓
better-sqlite3 + chokidar + fs
```

### 1.2 目标形态（v4.0, Tauri 2）

```
React 组件 (不变)
  ↓
src/api.ts ── isTauri 检测
  ├─ Tauri: invoke('list_projects') ── window.__TAURI_INTERNALS__
  └─ 浏览器 dev: 不支持(删 mock)
  ↓
src-tauri/src/lib.rs ── #[tauri::command] (60 commands, 注册到 tauri::generate_handler!)
  ↓
src-tauri/src/repo/<module>.rs (pure DB / pure FS)
  ↓
rusqlite (bundled) + notify (bundled) + std::fs
```

### 1.3 单层目录（重要）

- `electron/`, `electron/repo/`, `electron/importer/`, `electron/db/` **本分支全部删除**
- 仅保留 `src-tauri/`（Tauri Rust 后端）和 `src/api-tauri.ts`（Tauri 适配层）
- `src/api.ts` 改为 **运行时检测**：Tauri 环境 → 走 `api-tauri.ts`，否则抛错（mock 模式删除）
- **单层目录的好处**：rust 分支里 0 个 electron/ 文件，IDE 不会跳错、import 不会混淆、typecheck 不混 ts/rs

### 1.4 分支拓扑（commit 0 之前必做）

```
main (rust trunk, v4.0+)
  └─ rust/full-tauri-migration  ← 当前开发分支(提交点)
electron-v3.1-fallback  ← v3.1 冻结分支,永久保护,只读
```

**操作**（**必须在 commit 0 之前完成**）：
1. 当前 `main` HEAD（v3.1 完整版）→ 新分支 `electron-v3.1-fallback` 并 push
2. 迁移完成后，`rust/full-tauri-migration` 通过 PR 合入 main（**用 `--no-ff` merge commit，不是 fast-forward**），main 升级为 v4.0 Tauri。保留 "v3.1 → v4.0 完整迁移" 的合并证据
3. `electron-v3.1-fallback` 加保护（GitHub branch protection：禁止 force push，禁止删除，maintainer 才能改）
4. README 首页加注："v3.1 fallback checkout `electron-v3.1-fallback` 分支"

**v3.1 不 backport 到 v4.0**：fallback 分支修 bug 只留 fallback，**不回写** v4.0。理由：v4.0 是完全不同的栈（Rust + Tauri 2），v3.1 bug 在 v4.0 未必复现；backport 维护成本高。

**为什么这样**：
- main 作 v4.x 长期 trunk，跟着 rust 分支合入
- electron-v3.1-fallback 永久保存 v3.1 完整体（用户本地 dev / CI 调试 / 真机回退仍可用）
- 任何 v3.1 bug fix 在 fallback 分支上 commit，main 不再回写
- 旧 CLAUDE.md §13 决策日志（D1-D16）保留在 fallback 分支历史里可查

**注意事项**（CLAUDE.md §11 黑名单）：
- ❌ 不用 `git push --force` 切 main（用 `git merge --ff-only` 或新建分支 PR 合入）
- ❌ 不用 `git reset --hard`（fallback 分支一旦创建立即加保护）
- ✅ 用 GitHub PR 合 rust 分支入 main（review 流程）
- ✅ fallback 分支 push 走 PR，maintainer 自己批准

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| Rust 工具链 | rustc 1.97.1（已装） | 用户本机 |
| Tauri | Tauri 2.x（CLI 2.11.4） | 跨平台、安全模型现代、binary 小 |
| WebView | Windows WebView2 + macOS WKWebView（系统内置） | 零额外运行时 |
| 前端 | React 18 + Vite 5 + antd 6 + TypeScript 5.6 | **完全复用 v3.1** |
| SQLite | rusqlite 0.31+（bundled feature） | 同步 API 与现有 better-sqlite3 schema 1:1，迁移阻力最小 |
| Watcher | notify 6.x（bundled feature） | 事件驱动，跨平台 |
| 序列化 | serde + serde_json | Tauri 命令 JSON 必选 |
| 错误处理 | thiserror（自定义错误）+ anyhow（仅 main.rs 入口） | 命令错误转 IPC string |
| 异步 | 不引入 tokio（rusqlite 同步足够，notify 阻塞用 std::thread） | Simplicity First |
| 日志 | log + env_logger（仅 stderr）+ 文件 log（平移 v3.1 的 logFile 模式） | 同 v3.1 |
| 测试 | cargo test（内联 `#[cfg(test)]` 单元测试） | Rust 原生 |
| 装包 | cargo-tauri build（Windows MSI + NSIS；macOS dmg + zip） | 替代 electron-builder |

### 2.1 Bash PATH 持久化（CLAUDE.md §13 D17 决策）

`~/.cargo/bin` 不在 Git Bash 默认 PATH 中。**写入 `~/.bash_profile`**（Git Bash 启动时 source 优先级高于 `.bashrc`，non-interactive shell 也覆盖）：

```bash
# appended by cc-session-manager v4.0 migration (2026-08-01)
export PATH="/c/Users/15532/.cargo/bin:$PATH"
```

CLAUDE.md §10 已知陷阱补充此条目。

---

## 3. 数据模型（DB schema 平移）

### 3.1 平移原则

`electron/db/connection.ts` 的 5 表（projects / sessions / messages / watcher_state / mcp_server_state）+ FTS5 + 触发器 + 4 个 ALTER 迁移**逐字平移到 Rust**。schema 不变（snake_case），repo 函数返回时用 serde rename 转 camelCase 喂前端。

### 3.2 DB 文件位置（跨平台）

- Windows: `%APPDATA%\cc-session-manager\app.db`
- macOS: `~/Library/Application Support/cc-session-manager/app.db`
- Linux: `$XDG_CONFIG_HOME/cc-session-manager/app.db` 或 `~/.config/cc-session-manager/app.db`

Tauri 提供 `app_handle.path().app_data_dir()`（v3.1 中 main.ts 自写的 `getDataDir()` 删除，**单一来源用 Tauri API**）。

### 3.3 initDB 迁移逻辑

```rust
// src-tauri/src/db/mod.rs 平移 §3 现有逻辑
pub fn init_db(app_data_dir: &Path) -> Result<DB> {
    fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("app.db");
    let conn = Connection::open(&db_path)?;
    conn.execute_batch(SCHEMA_SQL)?;  // CREATE TABLE IF NOT EXISTS + FTS5 + 触发器
    run_migrations(&conn)?;            // 4 个 ALTER 兼容
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(DB(conn))
}
```

**幂等性测试** 4 case（覆盖 v1 → v2 → v4 三轮迁移、列已存在、缺 WAL、跨平台路径）。

### 3.4 共享 DB 连接（Tauri 关键）

Tauri command 不能直接持有 `Connection`（rusqlite 的 `Connection` 是 `Send + !Sync`，必须 `Send + Sync` 才能装进 `tauri::State`），用 `tauri::State<DbState>` 包装 `Mutex<Connection>`：

```rust
pub struct DbState(pub Mutex<Connection>);

#[tauri::command]
fn list_projects(state: tauri::State<DbState>) -> Result<Vec<ProjectRow>, String> {
    let conn = state.0.lock().unwrap();
    projects_repo::list_with_counts(&conn).map_err(|e| e.to_string())
}
```

**Send + Sync 推导**：`Connection: Send + !Sync` → `Mutex<Connection>: Send + Sync` → `DbState: Send + Sync` → 能 `app.manage(DbState::new(...))?`。

**权衡（v3.1 vs v4.0 并发口径）**：v3.1 Node.js 是**事件循环**（多 channel 并发，单 handler 慢不卡其他）；v4.0 `Mutex<Connection>` 是**互斥锁**（串行，慢 handler 全卡）。单 SQL 操作量级无差；高并发场景 v3.1 占优。**未来若变瓶颈改 `Arc<Connection>` + connection pool**（rusqline pooled crate）。详见 §12 风险表第 11 行。

### 3.5 watcher state schema

v3.1 KV 表 `watcher_state` 保留（**跟 6 模块开关无关**），平移到 `src-tauri/src/db/watcher.rs`：

```rust
#[derive(Serialize, Deserialize)]
pub struct WatcherStatus {
    pub state: String,                   // "idle" | "scanning" | "error"
    pub last_event_at: Option<i64>,      // ms epoch
    pub last_event_path: Option<String>, // 触发的 jsonl 路径
    pub error: Option<String>,           // state="error" 时的错误信息
}
```

**存储位置**：DB 内 `watcher_state` 表（单行，key="global"），setup hook 启动时初始化 + watcher 事件回调时更新。

---

## 4. IPC 契约对齐（核心难点）

### 4.1 设计原则

**Rust command 名 = v3.1 IPC channel 名**，JSON 入参/出参**结构同形**。例：

| v3.1 IPC | v4.0 Tauri command | 入参 JSON | 出参 JSON |
|---|---|---|---|
| `list_projects` | `list_projects` | `[]` | `ProjectRow[]`（camelCase） |
| `list_sessions` | `list_sessions` | `[projectId: number, includeDeleted: boolean]` | `SessionRow[]` |
| `search_messages` | `search_messages` | `[query: string, projectIds: number[] \| null, fromMs: number \| null, toMs: number \| null]` | `SearchHit[]` |
| `resume_session` | `resume_session` | `[sessionId: string]` | `ResumeCommand \| null` |

### 4.2 类型双修（CLAUDE.md §5）

- `src/types.ts` 不动（前端 UI 消费 camelCase）
- `src-tauri/src/types.rs` 新增，**字段同形但 serde rename 双向**：
  - `#[derive(Serialize)]` 输出到前端：`#[serde(rename_all = "camelCase")]`
  - 反向（如果需要 deserialize 前端入参）：`#[serde(rename_all = "camelCase")]` + `#[serde(default)]`
  - 字段命名不一致处（如 `parent_project_id` ↔ `parentProjectId`）逐字段标注 `#[serde(rename = "parentProjectId")]`

### 4.2.1 新装项目默认 enabled 语义（D15 + D17 决策延伸）

**核心约束**：6 模块（MCP / Skills / Commands / Sub-agents / Plugins）的所有"启停状态"以**真实文件**为准：

| 模块 | 新装后默认 | 判定方法（scanner） |
|---|---|---|
| MCP | enabled | `~/.claude.json` 的 `mcpServers.<name>` 存在 |
| Skills | enabled | `<name>/SKILL.md` 在 `~/.claude/skills/` 下 |
| Commands | enabled | `<name>.md` 在 `~/.claude/commands/` 下（**不含** `.md.disabled`） |
| Sub-agents | enabled | `<name>.md` 在 `~/.claude/agents/` 下（**不含** `.md.disabled`） |
| Hooks | enabled | `settings.json.hooks[<event>]` 数组非空 |
| Plugins | enabled | `settings.json.enabledPlugins[<name>@<marketplace>]` 不存在 false 标记；或 installed_plugins.json 有此 plugin |

**profiles 模块的处理**：
- **capture**（保存快照）：D15 决策走 6 scanner 拿真实 enabled 全集（**不读 KV 表**）→ 新装未点 toggle 的项目**自动包含**在快照里
- **apply**（应用快照）：D13 决策"完整替代"语义 → `curEnabled \ target` 全部反向 disable 写真实文件 → **新装但未在 target 里的项会被正确停用**（写黑名单 / 挪镜像目录 / 加后缀）

**这条**保证新装 skill 没有 `enabled` 字段也不会漏：scanner 直接问"在不在主目录"就完事，**不依赖任何 KV 字段**。

### 4.3 60 个 IPC 全清单（按模块）

按 v3.1 main.ts 实测 `ipcMain.handle` 计数 60 channel：

- **Sessions 12**：`list_projects`, `list_project_tree`, `list_sessions`, `list_deleted_sessions`, `list_messages`, `search_messages`, `soft_delete_session`, `restore_session`, `permanent_delete_session`, `resume_session`, `watcher_rescan_all`, `watcher_get_status`
- **MCP 6**：`mcp_list`, `mcp_get`, `mcp_create`, `mcp_update`, `mcp_delete`, `mcp_toggle_enabled`
- **Skills 6**：同上
- **Commands 6**：同上
- **Sub-agents 6**：`subagent_list/get/create/update/delete/toggle_enabled`
- **Hooks 6**：`hook_list/get/create/update/delete/toggle_enabled`
- **Plugins 6**：`plugin_list/get/create/update/delete/toggle_enabled`
- **Profiles 6**：`profile_list/get/capture/apply/delete/update`
- **Usage 6**：`usage_summary`, `usage_get_session_cost/timeline`, `usage_get_project_breakdown`, `usage_get_daily_breakdown`, `usage_get_top_tools`

### 4.4 前端适配层

`src/api-tauri.ts`：

```typescript
import { invoke } from '@tauri-apps/api/core';

export const api = {
  listProjects: (): Promise<ProjectRow[]> => invoke('list_projects'),
  listSessions: (projectId: number, includeDeleted: boolean): Promise<SessionRow[]> =>
    invoke('list_sessions', { projectId, includeDeleted }),
  // ... 60 函数全列出,参数命名 camelCase(serde 自动转 snake_case)
};
```

`src/api.ts` 改为 dispatch：

```typescript
import * as tauriApi from './api-tauri';

// Tauri 2 注入 window.__TAURI_INTERNALS__ 用于运行时检测(详见 https://v2.tauri.app/reference/architecture/)
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
if (!isTauri) {
  throw new Error('Electron fallback removed in v4.0 — please use `npm run tauri dev`');
}
export const api = tauriApi;
```

> **决策（spec §13 D17 草案）**：mock 模式删除。`src/mock.ts` 和 `src/mock-data.ts` 在 commit 13 删除，浏览器开 `localhost:5173` 不再能跑（vite 仅服务 HMR，必须 `npm run tauri dev` 启动 WebView）。

---

## 5. 文件 watch（chokidar → notify）

### 5.1 API 差异

| 维度 | chokidar (v3.1) | notify (v4.0) |
|---|---|---|
| 事件类型 | `add` / `change` / `unlink` | `Create` / `Modify(Any/Name/Data)` / `Remove` |
| 启动模式 | `fs.watch` based | `RecommendedWatcher::new().add(path)` |
| debounce | 内置 `awaitWriteFinish` | 无内置，需手动 debouncer 或 v3.1 同样策略 |
| recursive | 内置 | `RecursiveMode::Recursive` 显式 |

### 5.2 平移策略

v3.1 `electron/watcher.ts` 65 行，监听 `~/.claude/projects/<folder>/*.jsonl` 的 add/change/unlink，每事件 → `importFile(db, path)`。notify 平移后：

```rust
use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::sync::mpsc::channel;
use std::time::Duration;

pub fn start_watcher(db: Arc<DbState>, source_dir: &Path) -> Result<RecommendedWatcher> {
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(source_dir, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        // 简易 debounce: 同一 path 100ms 内多事件合并
        let mut last_event: HashMap<PathBuf, Instant> = HashMap::new();
        for res in rx {
            match res {
                Ok(Event { paths, kind, .. }) if matches!(kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) => {
                    for p in paths {
                        if last_event.get(&p).map_or(true, |t| t.elapsed() > Duration::from_millis(200)) {
                            import_file(&db, &p);  // best-effort,失败 log
                            last_event.insert(p, Instant::now());
                        }
                    }
                }
                _ => {}
            }
        }
    });
    Ok(watcher)
}
```

**关键差异**：chokidar `change` 包含内容修改；notify `Modify(Data(_))` 才匹配内容。**测试**：单测写 tmp 文件 → 改内容 → 断言收到 Modify 事件。

**debounce 阈值（D18 决策）**：沿用 v3.1 chokidar `awaitWriteFinish` 默认 200ms（写文件 fsync 完成到事件触发）。notify raw 事件比 chokidar 早到 ~100ms，200ms 阈值正好覆盖 fsync + 多次 write 合并窗口。**不要**调成 100ms（v3.1 早期试过，会在网络盘 / 慢盘上把同一次写入拆成多次 import）。

### 5.3 启动期首跑

v3.1 main.ts:121-147 在 setTimeout 1500ms 后跑 `scanProjectFolders + importProjectFolder`。Rust 同样逻辑平移到 `src-tauri/src/importer.rs`，setup hook 中 `app.manage()` 之前同步跑一次（**不上 setTimeout**，Tauri 启动后立即后台 spawn 跑）。

---

## 6. 原文件 IO（settings.json / .claude.json 等）

6 模块管理器都涉及"写真实文件"。v3.1 `electron/repo/settings-writer.ts` 364 行用 **原子写**（tmp + rename）模式，commit 5-10 全要平移为 Rust 实现：

```rust
// src-tauri/src/util/atomic_write.rs
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    // 注意：不能用 with_extension("json.tmp") —— SKILL.md 会变成 SKILL.json.tmp
    // 改成显式 push ".tmp" 后缀（保留原扩展名 + 加 .tmp）
    let mut tmp_os = path.as_os_str().to_owned();
    tmp_os.push(".tmp");
    let tmp = PathBuf::from(tmp_os);
    let json = serde_json::to_string_pretty(value)?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)?;  // POSIX atomic, Win ReplaceFile
    Ok(())
}
```

**6 模块文件路径**（跨平台）：

| 模块 | 主文件 | 镜像/黑名单 |
|---|---|---|
| MCP | `~/.claude.json` | `~/.claude/settings.json` 的 `disabledMcpjsonServers` 黑名单 |
| Skills | `~/.claude/skills/<name>/SKILL.md` | `~/.claude/disabled_skills/<name>/`（D12 镜像目录） |
| Commands | `~/.claude/commands/<name>.md` | `<name>.md.disabled`（D14 后缀） |
| Sub-agents | `~/.claude/agents/<name>.md` | `<name>.md.disabled`（D14 同） |
| Hooks | `~/.claude/settings.json` 的 `hooks[<event>]` 数组 | splice 移除 |
| Plugins | `~/.claude/plugins/<name>/.claude-plugin/plugin.json` + `~/.claude/settings.json` 的 `enabledPlugins[<name>@<marketplace>]` | boolean toggle |
| Profiles | `~/.claude/profiles.json` | 备份在 `<name>.bak.json` |

路径解析统一用 `home_dir()` crate（避免手工 `dirs::home_dir()` 的 cargo dependency 混乱），spec 锁版本。

### 6.1 真停用语义（D10 决策）

**6 模块启用/停用全部写到 Claude Code 实际读取字段**（不是 KV 表）：
- plugins: `settings.json.enabledPlugins[<name>@<marketplace>] = bool`
- mcp: `settings.json.disabledMcpjsonServers[]` 黑名单
- skills: 镜像目录（commit 6 钉死）
- commands/agents: `.md.disabled` 后缀（D14）
- hooks: `settings.json.hooks[<event>]` 数组 splice

### 6.2 KV 表清理（D17 决策：豁免 §4 半年原则）

v3.1 KV 表 5 张 → v4.0 平移时按 D15 决策清理：

| 表 | v4.0 处理 | 理由 |
|---|---|---|
| `projects` / `sessions` / `messages` | 保留 | 主数据，5 表 → 3 表平移 |
| `watcher_state` | 保留 | 存 watcher 运行态（idle / 错误 / 上次事件），**跟 6 模块开关无关** |
| `mcp_server_state` | **commit 15 删表** | D15 后无人查（captureProfileFromState 走 6 scanner 不读 KV），是死代码 |

**豁免 §4 半年原则**：CLAUDE.md §4 写"删字段先标记，半年后确认没人用再真正删"。本表 2026-07-31 D15 决策后已确认无读路径，距 2026-08-01 仅 1 天。**D17 决策特殊豁免**：v4.0 启动期清死代码，不留技术债。

**迁移步骤**（commit 15）：
1. `src-tauri/src/db/migration.rs` 加 `drop_mcp_server_state` 函数，检测表存在则 DROP
2. 单元测试覆盖"表不存在"（idempotent）+ "表存在删除"
3. `init_db` 在 run_migrations 后调 `drop_mcp_server_state`

**captureProfileFromState 走 6 scanner（D15 决策）**：详细在 §4.2.1。**不读 KV 表**。

---

## 7. 测试纪律（迁移）

### 7.1 测试 1:1 平移

v3.1 `tests/*.test.ts` 28 文件，CLAUDE.md §13 决策日志显示全绿时 150+ 个 case。**逐文件平移到 Rust**：

| v3.1 ts 文件 | v4.0 rust 位置 |
|---|---|
| `tests/db.test.ts` | `src-tauri/src/db/mod.rs::tests` |
| `tests/parser.test.ts` | `src-tauri/src/importer/parser.rs::tests` |
| `tests/importer.test.ts` | `src-tauri/src/importer/mod.rs::tests` |
| `tests/projects-repo.test.ts` | `src-tauri/src/repo/projects.rs::tests` |
| `tests/sessions-repo.test.ts` | `src-tauri/src/repo/sessions.rs::tests` |
| `tests/search.test.ts` | `src-tauri/src/repo/search.rs::tests` |
| `tests/tree.test.ts` | `src-tauri/src/repo/tree.rs::tests` |
| `tests/resumer.test.ts` | `src-tauri/src/resumer.rs::tests` |
| `tests/watcher.test.ts` | `src-tauri/src/watcher.rs::tests` |
| `tests/mcp.test.ts` + `tests/mcp-ui-smoke.test.ts` | `src-tauri/src/repo/mcp/{scanner,writer,state}.rs::tests` |
| `tests/skills.test.ts` + `tests/skills-ui-smoke.test.ts` | `src-tauri/src/repo/skills/*::tests`（含镜像目录 4 case） |
| `tests/commands.test.ts` + `tests/commands-ui-smoke.test.ts` | `src-tauri/src/repo/commands/*::tests` |
| `tests/sub-agents.test.ts` + `tests/sub-agents-ui-smoke.test.ts` | `src-tauri/src/repo/sub_agents/*::tests` |
| `tests/hooks.test.ts` + `tests/hooks-ui-smoke.test.ts` | `src-tauri/src/repo/hooks/*::tests` |
| `tests/plugins.test.ts` + `tests/plugins-ui-smoke.test.ts` | `src-tauri/src/repo/plugins/*::tests` |
| `tests/profiles.test.ts` + `tests/profiles-ui-smoke.test.ts` | `src-tauri/src/repo/profiles/*::tests` |
| `tests/usage.test.ts` + `tests/usage-ui-smoke.test.ts` | `src-tauri/src/repo/usage/*::tests` |
| `tests/settings-writer.test.ts` | `src-tauri/src/util/atomic_write.rs::tests` |
| `tests/migration.test.ts` | `src-tauri/src/db/migration.rs::tests` |

### 7.2 UI smoke 测试

v3.1 用 tsx 跑 `tests/*-ui-smoke.test.ts` 验证 mock-data 渲染（**v4.0 删 mock 后**这 12 个文件**整批删**），UI 真实路径改 Playwright 集成测试（spec 后续单开计划）。

### 7.3 `npm test` 命运

**rust 分支不跑 `npm test`**（没有 ts 测试）。**跑 `cargo test`**。`package.json` 的 `test` script 改：

```json
"test": "cargo test --manifest-path src-tauri/Cargo.toml --all-features"
```

`main` 分支保留原 `npm test` 不动（v3.1 fallback 可跑）。

---

## 8. 跨平台打包（CI + cargo-tauri）

### 8.1 cargo-tauri 配置

`src-tauri/tauri.conf.json`：

```json
{
  "productName": "cc-session-manager",
  "version": "4.0.0",
  "identifier": "com.freedom0x0.cc-session-manager",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [{ "width": 1280, "height": 800, "title": "cc-session-manager" }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "app", "dmg"],
    "icon": ["icons/icon.ico", "icons/icon.icns"],
    "category": "DeveloperTool",
    "shortDescription": "本地管理 Claude Code 会话历史",
    "longDescription": "...",
    "macOS": { "minimumSystemVersion": "10.15" }
  }
}
```

### 8.2 CI（`.github/workflows/build-installers.yml`）

> **注意**：`electron-v3.1-fallback` 分支**无 CI**，仅作代码存档。v3.1 走 v3.1 时的 CI workflow（如有）独立维护，**不**与本 workflow 联动。

```yaml
name: Build Installers
on: { push: { branches: [main, rust/full-tauri-migration] }, pull_request: {} }

jobs:
  test-rust:
    strategy:
      matrix: { os: [windows-latest, macos-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: cargo test --manifest-path src-tauri/Cargo.toml --all-features
      - run: npm run typecheck  # 仅前端

  package:
    needs: test-rust
    strategy:
      matrix: { os: [windows-latest, macos-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os == 'windows-latest' && 'windows-msi' || 'macos-dmg' }}
          path: |
            src-tauri/target/release/bundle/msi/*.msi
            src-tauri/target/release/bundle/dmg/*.dmg
            src-tauri/target/release/bundle/macos/*.app
```

### 8.3 macOS 签名

**v4.0 不签名**（D11 决策延续）。CI 跑出的 dmg 装包时 Gatekeeper 警告 + 右键打开。**Developer ID + notarization** 留给 v4.x patch（需 Apple Developer Program 账号）。

### 8.4 electron-builder fallback 保留

`electron-builder.json` 保留不删，README 加 §"Electron fallback (v3.1)"说明：checkout main 分支仍可 `npm run package:win/package:mac` 跑 v3.1。

### 8.5 CSP 策略（D18 决策）

`tauri.conf.json` 的 `security.csp`：

| 环境 | CSP 值 | 理由 |
|---|---|---|
| dev | `null`（§8.1 现状） | vite HMR 用 inline script，`null` 放开最省事 |
| prod | `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost"` | 最小可用：antd 6 + React 18 生产构建全 inline style → 需要 `'unsafe-inline' style`，但 script 不需要 inline |

**配置方式**：`tauri.conf.json` 静态只填 dev 用的 `null`；prod CSP 通过 `src-tauri/src/lib.rs` 的 setup hook 在 release build 时动态覆盖 `app_handle.config().app.security.csp`（commit 14 实施时实现）。

**为什么不全 `null`**：WebView2 / WKWebView 内的 React 代码本身没 CSP 兜底。Tauri 走 IPC invoke 隔离是进程级的，但 web 安全（XSS / 资源加载）需要 CSP 第二层防线。

---

## 9. 端到端里程碑（按功能 commit）

**commit / push 纪律（沿用 CLAUDE.md §11）**：
- **commit 由 Claude 代跑**：满足 `cargo test` 全绿 + `npx tsc --noEmit` 0 错 + commit message 已与用户对齐
- **push 由用户亲手跑**：CLAUDE.md §11 黑名单条目，rust 分支严格执行

每个 commit 是**完整功能边界**（不是一行一行），commit 后：
- `npm run tauri dev` 能开（至少不崩）
- `cargo test --manifest-path src-tauri/Cargo.toml` 全绿
- `npx tsc --noEmit` 0 错
- 用户本地手验一次（"我点开 xxx 能用"）

| Commit | 范围 | 新增 IPC | commit 后能跑 |
|---|---|---|---|
| **0** | `cargo-tauri init` + Vite/antd/原 React 不动 + Rust 侧 `hello_world` command + **`git rm -r electron/ electron/repo/ electron/importer/ electron/db/`** | 0 (测试用) | Tauri 窗口能开 antd 界面 + electron/ 0 引用 |
| **1** | `src-tauri/src/db/mod.rs`（rusqlite + bundled + initDB + 5 表 + FTS5 + 4 个 ALTER 迁移 + app_data_dir） + atomic_write 工具（§6 路径 bug 修后版本） | 0 | DB 文件能在 %APPDATA% 创建 + 原子写可用 |
| **2** | `src/api.ts` 改 Tauri dispatch（运行时检测 `__TAURI_INTERNALS__`）+ `src/api-tauri.ts` 新增 + **物理删除 `src/mock.ts` + `src/mock-data.ts`**（commit 2 一并删，CLAUDE.md §16「不留死代码」）+ Sessions 读 5 IPC + src-tauri/src/repo/{projects,sessions,messages,search,tree}.rs | 5 | 项目树 + 会话列表 + 消息 + 搜索能查；vite 5173 浏览器开就报错（强制 tauri dev） |
| **3** | Sessions 写 5 IPC（soft_delete / restore / permanent_delete / watcher_rescan_all / watcher_get_status）+ notify watcher + 首跑 import + watcher_state schema（§3.5） | 5 | 删除/恢复/永久删能操作 + watcher 状态查询 |
| **4** | resumer + resume_session + scanner + parser + importer + cluster | 1 | "复制 claude --resume" 按钮能用 |
| **5a** | MCP scanner + `mcp_list` / `mcp_get` IPC（只读）+ 解析 `~/.claude.json` | 2 | MCP 列表能查 |
| **5b** | MCP writer + 原子写 + `mcp_create` / `mcp_update` / `mcp_delete` IPC（写）+ 黑名单迁移 | 3 | MCP 新增/编辑/删除能用 |
| **5c** | MCP `mcp_toggle_enabled` + settings.json `disabledMcpjsonServers` 黑名单（D10 决策） | 1 | MCP 停用 toggle 改黑名单 |
| **6a** | Skills scanner + 镜像目录扫描（D12 决策）+ `skill_list` / `skill_get` IPC | 2 | Skills 列表能查（合并主目录 + 镜像目录） |
| **6b** | Skills writer + `skill_create` / `skill_update` / `skill_delete` IPC | 3 | Skills 新增/编辑/删除能用 |
| **6c** | Skills `skill_toggle_enabled` + 镜像目录移动（D12） | 1 | Skills 停用 toggle 挪到 `disabled_skills/` |
| **7a** | Commands scanner + `.md.disabled` 扫描（D14 决策）+ `command_list` / `command_get` IPC | 2 | Commands 列表能查 |
| **7b** | Commands writer + `command_create` / `command_update` / `command_delete` IPC | 3 | Commands 新增/编辑/删除能用 |
| **7c** | Commands `command_toggle_enabled` + `.md.disabled` 后缀（D14） | 1 | Commands 停用 toggle 加后缀 |
| **8a** | Sub-agents scanner + `.md.disabled` 扫描 + `subagent_list` / `subagent_get` IPC | 2 | Sub-agents 列表能查 |
| **8b** | Sub-agents writer + `subagent_create` / `subagent_update` / `subagent_delete` IPC | 3 | Sub-agents 新增/编辑/删除能用 |
| **8c** | Sub-agents `subagent_toggle_enabled` + `.md.disabled` 后缀 | 1 | Sub-agents 停用 toggle 加后缀 |
| **9a** | Hooks scanner + `hook_list` / `hook_get` IPC | 2 | Hooks 列表能查 |
| **9b** | Hooks writer + `hook_create` / `hook_update` / `hook_delete` IPC（**不**含 toggle） | 3 | Hooks 新增/编辑/删除能用 |
| **9c** | Hooks `hook_toggle_enabled` + settings.json `hooks[<event>]` splice | 1 | Hooks 停用 toggle splice 移除 |
| **10a** | Plugins scanner + installed_plugins.json 解析 + `plugin_list` / `plugin_get` IPC | 2 | Plugins 列表能查 |
| **10b** | Plugins writer + `plugin_create` / `plugin_update` / `plugin_delete` IPC | 3 | Plugins 新增/编辑/删除能用 |
| **10c** | Plugins `plugin_toggle_enabled` + settings.json `enabledPlugins[<name>@<marketplace>]` boolean | 1 | Plugins 停用 toggle 改 enabledPlugins |
| **11a** | Profiles scanner（读 `~/.claude/profiles.json`）+ KV→真实文件迁移逻辑（§6.2 步骤）+ 单元测试（双 fixture：KV + 真实文件） | 0 | KV 表数据能迁移到真实文件 |
| **11b** | Profiles writer + captureProfileFromState 走 6 scanner（D15）+ applyProfile 完整替代（D13）+ `profile_list` / `profile_capture` / `profile_apply` IPC + 双 fixture 手工验证 | 3 | Profiles 保存/应用能用，新装默认 enabled 正确处理 |
| **11c** | Profiles `profile_get` / `profile_update` / `profile_delete` IPC | 3 | Profiles 编辑/删除能用 |
| **12** | Usage 6 IPC + 只读聚合 + token 估算（**不写真实文件**） | 6 | Usage 分析模块全功能 |
| **13** | 删 12 个 `tests/*-ui-smoke.test.ts`（v3.1 UI 假测试整批删，CLAUDE.md §16「删了的代码不留死代码」）。mock 文件已在 commit 2 删除，本 commit 只清理 ui-smoke 测试 + 验证 cargo test + tsc --noEmit 双绿 | - | mock 完全清理，UI 真实路径改 Playwright 集成测试（v4.x sprint） |
| **14** | CI 双平台 + cargo-tauri build 装包 + 动态 prod CSP（§8.5）+ drop_mcp_server_state（§6.2 步骤 1-3） | - | Actions 上 windows-latest + macos-latest 出 MSI + DMG + mcp_server_state 表删除 |
| **15** | 文档同步 + CLAUDE.md §13 追加 D17 / D18 + §1 整段重写 + §10 加 atomic_write 路径坑 + CSP 策略 + notify debounce + electron/ 保留加 README 标注 fallback | - | README 主页描述 Tauri 装包流程 + v3.1 fallback 说明 |

总 **30 个 commit**。数法：commit 0-4（5 个）+ commit 5-10 每模块拆 a/b/c（6 × 3 = 18 个）+ commit 11a/b/c（3 个）+ commit 12-15（4 个）= **5 + 18 + 3 + 4 = 30 commit**。

> **微调空间**：实施时如发现某模块拆分粒度太细（review 不便），可合并 a+b 写成单 commit。spec 钉死"每个 commit 改 ≤ 7 文件、≤ 200 行"为合并上限。

### 9.1 验证收尾

commit 15 后**一次性手验 10 路径**（不验不算完成）：

1. 启动应用 → 项目树显示（commit 2）
2. 点击会话 → 消息渲染（FTS5 搜索能命中"中文"）
3. 复制 resume 命令 → cmd 粘贴能跑 claude --resume
4. MCP 管理器：新增/编辑/删除/停用 toggle → 看 settings.json 黑名单
5. Skills 管理器：停用一个 skill → 看 disabled_skills/ 镜像目录 + 重启 Claude Code 行为
6. Profiles：capture 当前 → apply P1 → 看 6 模块 enabled 全集变化
7. Usage：点击会话 → cost/timeline 显示
8. 删除会话 → 软删 + 回收站恢复
9. 关 app → 重开 → watcher 状态 = idle,lastEvent 有
10. CI 上 windows + mac 双绿

---

## 10. 兼容性矩阵

| 功能 | v3.1 Electron | v4.0 Tauri Win | v4.0 Tauri Mac | v3.1 fallback (main) |
|---|---|---|---|---|
| 项目树 + 会话 + 消息 + 搜索 | ✓ | ✓ (commit 2) | ✓ (commit 2) | ✓ |
| 软删/恢复/永久删 | ✓ | ✓ (commit 3) | ✓ (commit 3) | ✓ |
| resumer 命令复制 | ✓ | ✓ (commit 4) | ✓ (commit 4) | ✓ |
| MCP 管理器 6 操作 | ✓ | ✓ (commit 5) | ✓ (commit 5) | ✓ |
| Skills 管理器 6 操作 | ✓ | ✓ (commit 6) | ✓ (commit 6) | ✓ |
| Commands / Sub-agents | ✓ | ✓ (7,8) | ✓ (7,8) | ✓ |
| Hooks / Plugins | ✓ | ✓ (9,10) | ✓ (9,10) | ✓ |
| Profiles | ✓ | ✓ (commit 11) | ✓ (commit 11) | ✓ |
| Usage 分析 | ✓ | ✓ (commit 12) | ✓ (commit 12) | ✓ |
| chokidar → notify 事件语义 | ✓ | ✓ (commit 3 测试) | ✓ (commit 3 测试) | ✓ |
| FTS5 中文分词 | ✓ unicode61 | ✓ unicode61 (commit 1) | ✓ (commit 1) | ✓ |
| WebView2 渲染 antd 6 | n/a | 待 commit 0 实测 | n/a | n/a |
| WKWebView 渲染 antd 6 | n/a | n/a | 待 CI 装包验证 | n/a |
| macOS 未签名 dmg 安装 | n/a | n/a | Gatekeeper 警告 + 右键打开（D11） | n/a |

---

## 11. 文档同步（commit 15 收尾）

- **README.md** 主页重写：装包说明改 Tauri 2（`cargo-tauri build` 产 MSI/DMG），v3.1 fallback 说明独立小节："checkout `electron-v3.1-fallback` 分支仍可 `npm install && npm run dev` 跑 v3.1"
- **CHANGELOG.md** 加 v4.0 条目（Rust 全栈迁移 + macOS 首发 + electron-v3.1-fallback 冻结）
- **CLAUDE.md** 全面同步（commit 15 一并改）：
  - **§1 整段重写**：栈从 `Electron + Node.js + better-sqlite3` 改为 `Tauri 2 + Rust + rusqlite + notify`，前/后端姿势描述全套换
  - **§2 仓库布局**：加 `src-tauri/`（替代 `electron/`），加 "rust 分支单层目录" 说明
  - **§10 已知陷阱**：加 3 条 — PATH 持久化（§2.1）/ atomic_write `with_extension` 路径 bug 改成 push ".tmp"（§6）/ notify debounce 200ms 沿用 chokidar（D18 决策，§5.2）
  - **§13 追加 D17 / D18 决策日志**
- **docs/superpowers/specs/** 加本 spec 文件
- **rust 分支无 electron/ 目录**：commit 0 `git rm -r electron/ electron/repo/ electron/importer/ electron/db/` 一并删（CLAUDE.md §12 ❌ 禁直接 `rm` 用户文件，但 git 历史里 rm 仓库文件是常规操作，可走 commit）

---

## 12. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| WebView2 渲染 antd 6 异常（CSS 变量 / 字体 / 颜色） | 中 | commit 0 阻塞 | commit 0 第一件事：开 antd 主界面 + 截屏对比 v3.1；不行就改 antd 主题 token |
| WKWebView 渲染 antd 差异（你本地无 Mac） | 高 | commit 14 CI 红 | macos-latest 跑 + Playwright 截屏对比；用户报 issue 再补 |
| notify 事件语义与 chokidar 偏差 | 中 | commit 3 watcher 漏事件 | 单元测试用 tmp 文件 add/change/unlink 验证事件类型 + 防抖合并 |
| FTS5 中文分词在 rusqlite 行为不同 | 低 | commit 1 搜索不命中中文 | unicode61 remove_diacritics 2 已在 better-sqlite3 实测可用；rusqlite 同 tokenize 参数应一致，单元测试覆盖 |
| Cargo build time 拖慢开发体验 | 高 | 全程痛点 | 用 `cargo check` 代替 `cargo build` 跑 typecheck；sccache CI 缓存；本地加 `.cargo/config.toml` 走国内 crates 镜像 |
| 60 IPC 跨层类型双修漂移 | 中 | 中后期踩坑 | 每 commit 跑 `npx tsc --noEmit` + `cargo test`；新增字段时强制走 §4.2 类型对齐清单 |
| electron/ 和 src-tauri/ 双栈并存导致 import 混乱 | 中 | 后续维护混乱 | commit 13 前全部从 `electron/` 迁出（除了 main 分支保留）；rust 分支不引 electron/ 任何模块 |
| Cargo 依赖版本冲突 / 安全告警 | 低 | cargo build 红 | 锁 `Cargo.lock` 进 git（CLAUDE.md §11 已知）；CI 上 deny audit |
| macOS 代码签名缺失 | 中 | mac 用户首次开 Gatekeeper 警告 | 文档明示"D11 决策未签名，右键打开"；v4.x 后补 |
| **Mutex<Connection> 串行 vs v3.1 Node event loop 并发**（§3.4） | 中 | 高并发场景 v4.0 慢 | 单 SQL 操作量级无差；未来若变瓶颈改 `Arc<Connection>` + connection pool |
| **KV→真实文件迁移破坏性**（§6.2 commit 11a） | 中 | commit 11a 写用户家目录 settings.json / disabled_skills/ 等 | 单元测试用 fixture 目录；commit 11b 手工双 fixture 验证；首次运行前备份 settings.json |
| **electron/ 残留引用**（§1.3 单层目录） | 中 | rust 分支引 electron/ 路径导致 import 混乱 | commit 0 `git rm -r electron/` 后，CI 加 grep 守门 `grep -r "from '\.\./\.\./electron" src/` 必须空 |

---

## 13. CLAUDE.md §13 D17 决策日志草案（commit 15 时正式追加）

```markdown
- **2026-08-01 v5 D17**：完整迁移到 Rust + Tauri 2.x。
  - 触发:用户已装 Rust 1.97.1 + Tauri CLI 2.11.4,不再需要 Electron 零环境优势。
  - 范围:rust/full-tauri-migration 分支独立开发,保留 main v3.1 作 fallback。
  - 栈替换:Electron 32 → Tauri 2.11.4;better-sqlite3 → rusqlite 0.31+ bundled;
    chokidar 5 → notify 6.x bundled;Node IPC → Rust tauri::command;
    electron-builder → cargo-tauri build。
  - 前端 src/ 保原样,仅 src/api.ts + src/global.d.ts 切到 invoke;mock 模式删除(commit 13)。
  - 跨平台:Windows + macOS 双装包,macOS 未签名(D11 决策延续)。
  - 验证:CI macos-latest 跑 cargo test + cargo-tauri build 产 dmg;用户本地只 Win。
  - 按功能 commit(30 个,commit 0-4 + 6 模块拆 a/b/c 共 18 + Profiles 拆 a/b/c 共 3 + commit 12-15 共 4),CLAUDE.md §11 纪律不变。
  - main 升级为 v4.x trunk,通过 --no-ff merge 合入 rust 分支,保留 "v3.1 → v4.0 完整迁移" 合并证据。
  - electron-v3.1-fallback 分支永久冻结(v3.1 完整代码存档),不与 v4.0 联动 CI,bug fix 仅 fallback 内 commit。
  - 分支拓扑:
    - main: rust trunk (v4.0+)
    - rust/full-tauri-migration: 开发分支(提交点)
    - electron-v3.1-fallback: v3.1 冻结,只读保护
  - 删 mcp_server_state 表(豁免 CLAUDE.md §4 半年原则,D15 后已无读路径),commit 14 实施。
  - D18 子决策:
    - notify debounce 阈值 200ms(沿用 v3.1 chokidar awaitWriteFinish)
    - prod CSP 最小可用(setup hook 动态覆盖)
    - atomic_write 路径用 push ".tmp" 后缀,不用 with_extension("json.tmp")(避免 SKILL.md → SKILL.json.tmp)
  - mock 模式删除:commit 2 立即删 mock.ts/mock-data.ts(不留死代码,CLAUDE.md §16 原则),commit 13 删 12 个 ui-smoke 测试。
```

---

## 14. open questions（用户回答前不入 commit 0）

> **brainstorming 流程要求 spec 自审扫 placeholder / TBD / 矛盾 / 范围**

- [x] Q1 Rust 熟练度：**新手，边开发边学**（每文件教学注释）
- [x] Q2 前端复用：原封 src/，仅 api.ts + global.d.ts 切
- [x] Q3 SQLite 栈：rusqlite 同步 + bundled
- [x] Q4 watcher 栈：notify 6.x bundled
- [x] Q5 Day-1 范围：按功能 commit，不设里程碑（30 个 commit 切分：commit 0-4 + 6 模块拆 a/b/c 共 18 + Profiles 拆 a/b/c 共 3 + commit 12-15 共 4 = 30）
- [x] Q6 PATH 持久化：写入 `~/.bash_profile`
- [x] Q7 macOS 真机验证：完全靠 CI（windows-latest + macos-latest），本地只 Win
- [x] Q8 mock 模式：**删除**，vite 5173 浏览器开就报错（强制 tauri dev）
- [x] Q9 双分支关系：rust 分支独立 + main 留 v3.1

> **未决（不影响 commit 0 启动，但 commit 0/13 必须闭环）**：
- ⚠️ **Q10 antd 6 在 WebView2 渲染异常**：commit 0 第一件事 — `npm run tauri dev` 启动后截屏对比 v3.1，CSS 变量 / 字体 / 颜色差异登记到 `findings.md`。不行就改 antd ConfigProvider token。
- ✓ **Q11 cargo 镜像**：启用国内 crates 镜像（`.cargo/config.toml` 配 `rsproxy-sparse` 或 `ustc`），节省 commit 1 首次 `cargo build` 时间（30-60 分钟 → 5-10 分钟）。
- ✓ **Q12 mock 删除**：commit 13 **一并删 12 个 `tests/*-ui-smoke.test.ts`**（不留 fixture，CLAUDE.md §16「改代码同时改文档」精神：删了的代码不留死代码）。UI 真实路径改 Playwright 集成测试，留到 v4.x sprint。

---

## 15. 范围检查（spec §3.4 自审要求）

- ✓ **单一焦点**：v4.0 Tauri 全栈迁移，不掺 v4.x 后补特性
- ✓ **可执行**：16 commit × 每 commit 有明确边界 + 验证方式
- ✓ **不重复造轮**：CLI / build / test 命令尽量复用（Tauri CLI 跑 cargo test 用 `--manifest-path`）
- ⚠️ **范围边界**：commit 5-11 的 6 模块迁移是核心工作量，估计每模块 2-3 commit（写测试 + 写真实文件 IO + 写原子写 + 写 IPC command + 写 main 集成）—— 实际是 16 commit 包含所有，**可能拉长到 20 commit 以内**。D17 不预设 commit 数,以实施时实际为准,但本 spec 是骨架。
- ⚠️ **依赖顺序**：commit 6/7/8 互相独立，可并行；commit 5-11 都依赖 commit 1（DB） + commit 2（JSON serde 模式）

---

> **下一步**：用户 review 本 spec → 调 writing-plans 写实施计划（commit 0-15 的 task list + 详细子任务）→ 开始 commit 0 实施