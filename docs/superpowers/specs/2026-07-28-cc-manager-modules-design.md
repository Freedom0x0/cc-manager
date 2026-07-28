# CC Manager v5 — 一站式配置中心（8 模块 + Profiles + 用量分析）

- **日期**：2026-07-28
- **状态**：设计中（待用户审）
- **承接**：v4（folder 语义 + 内容块 + 命令卡片）
- **目标版本**：v2.0.0（波 1 完成）/ v2.1.0（波 2 完成）/ v3.0.0（波 3 完成）

## 0. 背景

v4 完成 28/28 测试 + NSIS/Portable 双产物发布。用户反馈："现在能管会话了，但我还有 7 类配置散落在 `~/.claude/`、`~/.claude.json`、`.claude/` 等各处，切来切去很烦。想要一个 GUI 把它们都管起来。"

同时调研了 7 个候选开源项目（见 §11），发现：
- **真实存在且活跃**：Pruthil123/claude-code-manager（功能范围 80% 重合，Web 栈）、MarkShawn2020/claude-code-manager、Bendzae/claude-manager（CLI/TUI）、everything-claude-code（黑客松冠军，模板库）
- **搜不到**：claude-session-manager-mcp、mcp-dashboard、claude-plugin-dashboard、skills-installer —— 大概率是别名/私有/不存在
- **可直接调用**：Claude Code 官方 `/plugin` 命令
- **可直接抄模板**：everything-claude-code 的 9 subagents + 11 skills + 11 commands + 10 hooks 模板

结论：**借鉴 UX + 借鉴模板 + 自己实现代码**（模式 B）。理由是 cc-session-manager 已有 Electron + SQLite 强基座，重写 Web 栈方案 = 倒退。

## 1. 目标

把 cc-session-manager 从"会话管理器"升级为"Claude Code 一站式配置中心"：

- **8 个模块**：会话管理增强 + MCP + Skills + Commands + Sub-Agents + Hooks + 插件 + 配置 Profiles
- **3 大基础设施**：文件 watch（chokidar）+ 顶部全局搜索 + 用量分析仪表盘
- **3 波交付**：每波结束 = 可安装包 + npm test 全绿
- **平台策略**：**Windows 优先**（v2.0 / v2.1 / v3.0 三波全部产出 Windows installer），**macOS 适配延后到 v4.0**（详见 §16）

每个模块最小切片 = **能配置 + 能查看/列表 + 能搜索**（三件套），不堆自动化推荐。

## 2. 核心设计决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | 目标用户 | A. Claude Code 重度玩家一站式配置中心 | 单人项目，用户=自己 |
| D2 | 数据策略 | C. 元数据入库 + 内容直读 + 文件 watch | 快 + 新鲜 + 能搜索 + 支持 Profiles |
| D3 | 实施波次 | A. 3 波 | 每波可交付、可回滚 |
| D4 | 架构形态 | Y. 模块化目录 | 边界清晰、波次友好、App.tsx 不膨胀 |
| D5 | 文件 watch | chokidar 事件驱动，无 polling | 学 VS Code：`files.usePolling` 默认 false |
| D6 | Profiles 快照 | 元数据 + 文件 hash | 体积小、永不漂移、失败可降级 |
| D7 | 搜索栏 | 顶部全局 + 模块内 | 跨模块发现是配置中心灵魂 |

### 关键架构原则（继承并强化 CLAUDE.md §3）

**单一真相 = 原文件**：用户改 UI → 写回原文件 → chokidar watcher 200ms debounce → scanner 重扫 metadata 表 → UI polling 5s 拉新状态。**metadata 表永远由 watcher 写，不由 IPC handler 直接写**。

这一条写进 CLAUDE.md §13 v5 决策记录。

## 3. 项目结构

```
cc-session-manager/
├── electron/
│   ├── main.ts                      # IPC dispatch 中心（按模块遍历注册）
│   ├── preload.ts                   # contextBridge
│   ├── watcher.ts                   # chokidar 主控（监听 7 目录，路由 scanner）
│   ├── db/connection.ts             # schema + ALTER 迁移（v5 加 8 张 metadata 表）
│   ├── resumer.ts                   # 已存在
│   └── repo/
│       ├── projects/  sessions/  messages/  search/  tree/   ← v1-v4 保留
│       ├── _template/                                          ← 波 0 抽出
│       ├── mcp/                     # types/scanner/writer/reader/index/parser
│       ├── skills/
│       ├── commands/
│       ├── sub_agents/              # 波 2
│       ├── hooks/                   # 波 2
│       ├── plugins/                 # 波 2
│       ├── profiles/                # 波 3
│       └── analytics/               # 波 3
├── src/
│   ├── App.tsx                      # antd Tabs 导航壳子（不再写业务）
│   ├── api.ts / global.d.ts / types.ts / mock.ts
│   ├── components/
│   │   ├── GlobalSearchBar.tsx      # 新增：顶部跨模块搜索
│   │   ├── ProjectSelector.tsx      # 新增：选 active project
│   │   ├── WatcherStatusIndicator.tsx  # 新增：watcher 状态
│   │   └── （v4 的 7 个组件迁到 modules/sessions/）
│   ├── modules/
│   │   ├── _template/
│   │   ├── sessions/                # 从 src/components 迁入
│   │   ├── mcp/
│   │   ├── skills/
│   │   ├── commands/
│   │   ├── sub_agents/              # 波 2
│   │   ├── hooks/                   # 波 2
│   │   ├── plugins/                 # 波 2
│   │   ├── profiles/                # 波 3
│   │   └── analytics/               # 波 3
│   └── hooks/
│       ├── useSearch.ts             # 已有
│       └── useGlobalSearch.ts       # 新增
└── tests/
    ├── （v4 的 7 个测试保留）
    ├── _helpers/sandbox.ts          # 新增：tmpdir 沙盒
    ├── watcher.test.ts              # 新增
    ├── global-search.test.ts        # 新增
    ├── template.test.ts             # 新增：验证 _template 可用
    └── <module>/<name>.test.ts      # 每模块 5 类测试
```

## 4. 数据库 Schema

### 4.1 v5 新增表（继承 CLAUDE.md §4 迁移纪律）

```sql
-- ===== 波 1 =====

CREATE TABLE IF NOT EXISTS mcp_metadata (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,                 -- 'user' | 'project'
  source_path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_hash TEXT NOT NULL,
  transport TEXT,                      -- 'stdio' | 'http' | 'sse'
  last_scanned_at INTEGER NOT NULL,
  UNIQUE(name, scope, source_path)
);
CREATE INDEX IF NOT EXISTS idx_mcp_scope ON mcp_metadata(scope);
CREATE INDEX IF NOT EXISTS idx_mcp_enabled ON mcp_metadata(enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_name ON mcp_metadata(name);

CREATE TABLE IF NOT EXISTS skill_metadata (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  source_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER NOT NULL,
  UNIQUE(name, scope, source_path)
);
CREATE INDEX IF NOT EXISTS idx_skill_scope ON skill_metadata(scope);
CREATE INDEX IF NOT EXISTS idx_skill_name ON skill_metadata(name);

CREATE TABLE IF NOT EXISTS command_metadata (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER NOT NULL,
  UNIQUE(name, source_path)
);
CREATE INDEX IF NOT EXISTS idx_command_name ON command_metadata(name);

-- ===== 波 2 =====

CREATE TABLE IF NOT EXISTS agent_metadata (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER NOT NULL,
  UNIQUE(name, source_path)
);

CREATE TABLE IF NOT EXISTS hook_metadata (
  id INTEGER PRIMARY KEY,
  event TEXT NOT NULL,                 -- 'PreToolUse' | 'PostToolUse' | 'Notification' | 'Stop' | 'UserPromptSubmit'
  matcher TEXT,
  source_path TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hook_event ON hook_metadata(event);

CREATE TABLE IF NOT EXISTS plugin_metadata (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  marketplace TEXT,
  version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  install_path TEXT NOT NULL,
  last_scanned_at INTEGER NOT NULL,
  UNIQUE(name, marketplace)
);

-- ===== 波 3 =====

CREATE TABLE IF NOT EXISTS profile_snapshot (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL          -- 元数据 + hash 快照
);

-- ===== 所有波共享 =====

CREATE TABLE IF NOT EXISTS watcher_state (
  id INTEGER PRIMARY KEY,              -- 固定 = 1（单行）
  status TEXT NOT NULL,                -- 'idle' | 'scanning' | 'error'
  last_event_at INTEGER,
  last_error TEXT,
  watched_paths TEXT NOT NULL          -- JSON 数组
);
```

### 4.2 设计决策

- **每模块独立表**：字段不同、删除独立、Profile 按表分块
- **`config_hash` / `file_hash`**：变更检测 + Profile 验证双重用途
- **`scope` 字段**：user / project 区分；project 级受 active project 影响
- **`enabled` 字段**：写回策略各模块不同 —— MCP 用 `disabledMcpServers` 数组（CC 原生支持），Skills/Commands/Agents 用 `.disabled` 后缀，Hooks 用注释 + enabled=false，插件通过 settings.json 控制
- **不存全文内容**：永远直读原文件，保证新鲜

## 5. IPC 契约（继承 CLAUDE.md §6）

命名规范：`<module>_<verb>_<noun>`。

### 5.1 MCP 模块

| channel | 参数 | 返回 |
|---|---|---|
| `mcp_list` | `(scope?: 'user' \| 'project', projectRoot?: string)` | `McpMetadata[]` |
| `mcp_get` | `(id: number)` | `McpServerDetail`（含直读 config） |
| `mcp_toggle_enabled` | `(id: number, enabled: boolean)` | `void` |
| `mcp_create` | `(input: McpServerInput)` | `McpMetadata` |
| `mcp_update` | `(id: number, input: McpServerInput)` | `McpMetadata` |
| `mcp_delete` | `(id: number)` | `void` |
| `mcp_test_connection` | `(id: number)` | `McpTestResult` |
| `mcp_import` | `({format: 'json' \| 'cli', content: string})` | `McpMetadata[]` |

### 5.2 Skills 模块

| channel | 参数 | 返回 |
|---|---|---|
| `skill_list` | `(scope?: 'user' \| 'project')` | `SkillMetadata[]` |
| `skill_get` | `(id: number)` | `SkillDetail`（含 SKILL.md 全文） |
| `skill_toggle_enabled` | `(id: number, enabled: boolean)` | `void`（`.disabled` 后缀） |
| `skill_import_template` | `(templateId: string)` | `SkillMetadata`（v2.0 后期，预置 5-10 个模板） |

### 5.3 Commands 模块

| channel | 参数 | 返回 |
|---|---|---|
| `command_list` | `()` | `CommandMetadata[]` |
| `command_get` | `(id: number)` | `CommandDetail`（含 Markdown 全文） |
| `command_create` | `({name: string, content: string})` | `CommandMetadata` |
| `command_update` | `(id: number, {name?: string, content: string})` | `CommandMetadata` |
| `command_delete` | `(id: number)` | `void` |
| `command_import_template` | `(templateId: string)` | `CommandMetadata` |

### 5.4 会话管理增强

| channel | 参数 | 返回 |
|---|---|---|
| `usage_get_summary` | `(timeRange: '7d' \| '30d' \| 'all')` | `UsageSummary`（日活、token、模型占比） |
| `usage_get_session_cost` | `(sessionId: string)` | `SessionCost`（成本估算） |
| `usage_get_tool_frequency` | `(timeRange)` | `ToolFrequency[]` |

### 5.5 波 2 模块（Sub-Agents / Hooks / 插件）

命名同模式，波次内详细 spec。

### 5.6 波 3 模块（Profiles）

| channel | 参数 | 返回 |
|---|---|---|
| `profile_list` | `()` | `ProfileSummary[]` |
| `profile_create` | `(name: string)` | `ProfileSnapshot` |
| `profile_restore` | `(id: number, options?: RestoreOptions)` | `RestoreResult` |
| `profile_delete` | `(id: number)` | `void` |
| `profile_diff` | `(id: number)` | `ProfileDiff` |

### 5.7 全局（所有波共享）

| channel | 参数 | 返回 |
|---|---|---|
| `global_search` | `(query: string, limit?: number)` | `GlobalSearchHit[]` |
| `watcher_rescan_all` | `()` | `{ ok: boolean, scanned: number }` |
| `watcher_get_status` | `()` | `WatcherStatus` |

### 5.8 关键 IPC 设计原则

**toggle 操作只写原文件，不直接改 metadata 表**：

```typescript
ipcMain.handle('mcp_toggle_enabled', async (_e, id, enabled) => {
  const detail = mcpRepo.getDetail(db, id);
  await mcpWriter.toggle(detail.sourcePath, detail.name, enabled);
  // 不写 metadata —— chokidar 200ms 后自动触发 scanner 重扫
});
```

理由：保证单一真相 = 原文件，metadata 是缓存不是真相。

## 6. 文件 Watcher 架构

### 6.1 监听目录清单

| 路径 | 模块 | 来源 |
|---|---|---|
| `~/.claude.json` | MCP | user |
| `~/.claude/projects/` | sessions | user（已有） |
| `~/.claude/skills/` | skills | user |
| `~/.claude/agents/` | sub_agents | user |
| `~/.claude/plugins/` | plugins | user |
| `~/.claude/settings.json` | hooks + plugins | user |
| `<active-project>/.claude/` | skills + commands + agents | project |
| `<active-project>/.mcp.json` | MCP | project |

### 6.2 主控 `electron/watcher.ts`

```typescript
import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import * as os from 'os';

interface ModuleScanner {
  name: string;
  shouldHandle(filePath: string): boolean;
  scan(filePath: string): Promise<void>;
}

const scanners: ModuleScanner[] = [];  // 各模块注册自己

export function startWatcher(db: DB): FSWatcher {
  const home = os.homedir();
  const watchedPaths = [
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'agents'),
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.claude', 'settings.json'),
    // active project paths 动态加入
  ];

  const watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    persistent: true,
  });

  const debouncedScan = debounce(async (filePath: string) => {
    for (const scanner of scanners) {
      if (scanner.shouldHandle(filePath)) {
        await scanner.scan(filePath);
        break;
      }
    }
    updateWatcherState(db, { last_event_at: Date.now() });
  }, 300);

  watcher.on('add', debouncedScan);
  watcher.on('change', debouncedScan);
  watcher.on('unlink', debouncedScan);
  return watcher;
}
```

### 6.3 学 VS Code 的取舍

- VS Code `files.usePolling` 默认 false（用 OS 原生 watcher）
- 本项目同样：依赖 chokidar 的原生事件，**不轮询**
- chokidar 漏事件时：UI 顶部 "🔄 立即刷新" 按钮兜底
- watcher_state 表记 `last_event_at`，UI 5s polling 拉状态

## 7. Profiles 设计

### 7.1 快照格式（纯元数据 + 文件 hash）

```json
{
  "name": "工作",
  "created_at": 1722163200000,
  "updated_at": 1722163200000,
  "modules": {
    "mcp": [
      {
        "name": "github",
        "scope": "user",
        "source_path": "C:\\Users\\xxx\\.claude.json",
        "enabled": true,
        "config_hash": "sha256:abc123..."
      }
    ],
    "skills": [
      {
        "name": "code-review",
        "scope": "project",
        "source_path": "D:\\work\\proj\\.claude\\skills\\code-review\\SKILL.md",
        "file_hash": "sha256:def456...",
        "enabled": true
      }
    ],
    "commands": [...],
    "sub_agents": [...],
    "hooks": {...},
    "plugins": [...]
  }
}
```

### 7.2 恢复失败的降级

恢复时按 hash 验证：
- ✅ 匹配 → 写回原文件
- ⚠️ hash 不匹配 → 弹 modal「模块 X 的配置文件已被外部修改，无法精确恢复。A) 用当前状态恢复 B) 跳过该模块 C) 取消」
- ❌ 文件不存在 → 跳过该模块，记录 warning

### 7.3 diff 功能

`profile_diff(id)` 返回当前状态 vs 快照的差异：
- 新增的（在当前但不在快照）
- 删除的（在快照但不在当前）
- 修改的（hash 不同）

UI 用 antd Table 展示 + 一键"接受 / 拒绝 / 保留现状"。

## 8. 顶部全局搜索

### 8.1 UI

antd `AutoComplete` + `Input.Search` 组合，顶部 Header 居中：
- 500ms debounce
- IPC `global_search(query, limit=10)`
- 结果按模块分组，最多每组 3 条
- 点击结果跳模块页 + 携带 `selected_id` URL hash 自动定位

### 8.2 后端 SQL（v2.0 覆盖 mcp/skill/command）

```sql
SELECT 'mcp' as type, name, id, source_path, enabled FROM mcp_metadata WHERE name LIKE ? LIMIT 3
UNION ALL
SELECT 'skill', name, id, source_path, enabled FROM skill_metadata WHERE name LIKE ? LIMIT 3
UNION ALL
SELECT 'command', name, id, source_path, enabled FROM command_metadata WHERE name LIKE ? LIMIT 3
UNION ALL
SELECT 'project', name, id, NULL, 1 FROM projects WHERE is_archived = 0 AND name LIKE ? LIMIT 3
```

每波扩展覆盖的模块表。

## 9. 波次时间线

### 波 0：模块化骨架（3 天）

| Day | 任务 |
|---|---|
| 1 | 抽 `_template/`（electron + src）+ App.tsx 改造为导航壳子 |
| 2 | `watcher.ts` 主控 + `registerIpcHandlers(db)` 函数 + watcher_state 表 |
| 3 | GlobalSearchBar 骨架（只搜 sessions）+ 5 个 template test |

产出：可运行的 v1.1 骨架，App.tsx 9 Tab 占位。

### 波 1：会话增强 + MCP + Skills + Commands（10 天）

| Day | 任务 |
|---|---|
| 1-2 | MCP: scanner + writer + mcp_metadata 表 + 6 测试 |
| 3 | MCP UI: McpManager + McpServerCard + toggle/CRUD |
| 4 | MCP 高级: 连接测试 + 导入（JSON/CLI）+ 3 测试 |
| 5 | Skills: scanner + skill_metadata + SkillsManager + toggle (.disabled) + 5 测试 |
| 6 | Skills 高级: 跨客户端安装（v2.0 只支持本地，预置模板）+ 2 测试 |
| 7 | Commands: scanner + command_metadata + CommandsManager + CRUD + 5 测试 |
| 8 | Commands 高级: Markdown 编辑器 + 模板导入（抄 everything-claude-code 5-10 个）+ 2 测试 |
| 9 | 会话增强: usage_get_summary/cost/tool_frequency + 4 测试 |
| 10 | 全局搜索扩展 + npm test 全绿 + npm run package:portable → v2.0 |

### 波 2：Sub-Agents + Hooks + 插件（7 天）

| Day | 任务 |
|---|---|
| 1 | Sub-Agents: scanner + agent_metadata + SubAgentsManager + 模板导入（抄 everything-claude-code 9 个）+ 4 测试 |
| 2 | Hooks: scanner + hook_metadata + HooksManager（事件筛选 + matcher 编辑 + preview "这会触发：xxx"）+ 4 测试 |
| 3-4 | 插件: scanner + plugin_metadata + PluginsManager + 调 `claude plugin install/uninstall`（spawn 子进程）+ 5 测试 |
| 5-6 | 集成: watcher 覆盖新目录 + 全局搜索覆盖 + UI 收尾 + 4 集成测试 |
| 7 | npm test + npm run package:portable → v2.1 |

### 波 3：Profiles + 用量分析（5 天）

| Day | 任务 |
|---|---|
| 1 | Profiles: profile_snapshot 表 + ProfileManager + 快照生成 + 3 测试 |
| 2 | Profiles 高级: profile_diff + profile_restore（含 hash 失败 modal）+ 2 测试 |
| 3-4 | 用量分析: Analytics 模块 + antd Charts（折线/饼/柱）+ 7d/30d/all 切换 + 3 测试 |
| 5 | 收尾: README/CHANGELOG 更新 + npm run package → v3.0 |

### 测试增长预期

| 阶段 | 测试数 | 覆盖 |
|---|---|---|
| v4 当前 | 28 | sessions 完整 |
| 波 0 完成 | 33 | +5 template |
| 波 1 完成 | 55+ | +22（mcp/skill/command/usage） |
| 波 2 完成 | 70+ | +17（agents/hooks/plugins + 集成） |
| 波 3 完成 | 85+ | +8（profiles/analytics） |

每波 ≥ 80% 行覆盖，IPC handler 100%。

## 10. 风险预案

| 风险 | 应对 |
|---|---|
| chokidar 漏事件 | UI "🔄 立即刷新" 按钮 + watcher_state.status 指示 |
| 原子写失败（磁盘满/权限） | writer 用 try/catch，restore 备份，UI 显示"上次同步失败" |
| MCP server 配置格式不兼容 | parser 宽松匹配，保留未知字段 |
| Skills YAML frontmatter 不规范 | parser 只取已知字段，未知字段保留为 raw |
| Hooks 误触（matcher 错） | UI 编辑时实时校验 + 保存前 preview 触发工具列表 |
| License 不兼容（候选项目） | spec 标 TODO，先自写；后续决定 |
| 波 2/3 推不动 | 各加 1-2 天 buffer，砍"高级功能"保核心三件套 |

## 11. 参考项目调研（带 License 待确认）

| 项目 | URL | 范围 | 状态 | License | 处理 |
|---|---|---|---|---|---|
| Pruthil123/claude-code-manager | [github](https://github.com/Pruthil123/claude-code-manager) | MCP/Skills/Commands/Documents 一站式 | 真实存在 | **TODO 待确认** | 借鉴 UX + 功能清单，不抄代码（栈不同） |
| MarkShawn2020/claude-code-manager | [github](https://github.com/MarkShawn2020/claude-code-manager) | 集成 MCP/Skills/Commands | 真实存在 | **TODO 待确认** | 同上 |
| Bendzae/claude-manager | [github](https://github.com/Bendzae/claude-manager) | CLI/TUI | 真实存在 | **TODO 待确认** | 栈不匹配，仅参考 |
| leesgit/claude-session-continuity-mcp | [github](https://github.com/leesgit/claude-session-continuity-mcp) | 会话连续性 MCP | 真实存在 | **TODO 待确认** | 不需要 MCP 化，跳过 |
| dlupiak/claude-session-dashboard | [github](https://github.com/dlupiak/claude-session-dashboard) | Web 会话面板 | 真实存在 | **TODO 待确认** | 不同栈，跳过 |
| RD2100/blackboard-mcp | [github](https://github.com/RD2100/blackboard-mcp) | 跨会话协调 | 真实存在 | **TODO 待确认** | 不需要，跳过 |
| everything-claude-code | 黑客松冠军 | 9 subagents + 11 skills + 11 commands + 10 hooks 模板 | 真实存在 | **TODO 待确认** | **直接抄模板** |
| claude-code-subagents | [github](https://github.com/zoserpan/claude-code-subagents) | Sub-agent 范例 | 真实存在 | **TODO 待确认** | 抄模板 |
| claude-session-manager-mcp | （搜不到） | 会话管理 MCP Server | 搜不到 | — | **用户确认仓库 URL** |
| mcp-dashboard | （搜不到） | MCP 图形化 CRUD | 搜不到 | — | **用户确认仓库 URL** |
| claude-plugin-dashboard | （搜不到） | 插件 CLI TUI | 搜不到 | — | **用户确认仓库 URL** |
| skills-installer | （搜不到） | 跨客户端 Skills 安装 | 搜不到 | — | **用户确认仓库 URL** |

**License 调研 TODO**（波 0 启动时做）：
1. 每个"真实存在"项目查 LICENSE 文件
2. 标 MIT/Apache-2.0 可借鉴，GPL/AGPL 弃用
3. "直接抄模板"的需确认引用条款
4. 搜不到的项目请用户提供 URL 或确认放弃

## 12. CLAUDE.md 更新项（每波结束做）

新增到 §13 决策记录：
- **2026-07-28 v5**：单一真相 = 原文件；metadata 是缓存，watcher 是唯一写入路径
- **2026-07-28 v5**：模块化目录结构（src/modules/ + electron/repo/<module>/）
- **2026-07-28 v5**：文件 watch 走 chokidar 事件驱动，无 polling（学 VS Code）
- **2026-07-28 v5**：Profile 快照 = 元数据 + 文件 hash，不复制内容
- **2026-07-28 v5**：App.tsx 改为导航壳子，业务逻辑全部下放到 modules/
- **2026-07-28 v5**：3 波节奏（v2.0 / v2.1 / v3.0），每波结束 npm run package

新增到 §15 文档同步纪律：
- CHANGELOG.md 启动（波 0），每波末尾追加

## 13. 范围外（v5 不做）

- ❌ 跨客户端 Skills 安装（v2.0 只支持本地路径，跨客户端延后）
- ❌ 插件市场自定义（只对接官方 `/plugin` 命令，不做私有市场）
- ❌ Profile 云同步 / 团队共享（本地单用户）
- ❌ 智能推荐（"你的 MCP 有 3 个没启用，要不要看看"）
- ❌ 新手引导 / 模板市场（用户是 A：重度玩家）
- ❌ macOS / Linux 打包（**v2.0 / v2.1 / v3.0 阶段限制**；macOS 适配延后到 v4.0，详见 §16）
- ❌ MCP / Skills / Commands 的语义搜索（仅 LIKE 匹配 + 名称搜索）
- ❌ 用量预测 / 成本优化建议（只展示数据，不建议）

## 14. 后续（v6 候选）

- 高保真 antd `Bubble` 替换 MessageView 手写 div（v4 留下来的）
- Sub-Agent 调试器（看 subagent 的 prompt/output）
- Hook 实时日志面板（捕获 hooks 触发日志）
- 配置文件 diff 可视化（vscode 风格的 split view）
- **macOS 适配（v4.0）** — 详见 §16
- Linux 适配（v4.x，仅当用户需求明确时）

## 15. macOS 适配 spec（v4.0 详细计划）

> **Status**: 延期到 v4.0；v2.0 / v2.1 / v3.0 仍 Windows-only。本节是预留的工程契约，避免后续返工。

### 15.1 平台策略（继承 v5 D8-D12）

- **构建时**：electron-builder 配置文件已包含 `mac.target: ["dmg", "zip"]`，v4.0 启用 `--mac`
- **运行时**：`process.platform === 'darwin'` 走 macOS 路径分支
- **数据目录**：`~/.claude/` 跨平台一致（用 `os.homedir()`，无需特判）
- **签名**：v4.0 起步阶段**未签名**（Gatekeeper 警告需用户右键打开）；后续视需要加 Developer ID

### 15.2 关键改动清单（v4.0 任务）

| 任务 | 工作量 | 风险 |
|---|---|---|
| `electron-builder.json` 启用 `mac.target` | 0.5h | 低 |
| 加 `build/icon.icns` 资源 | 1h | 低（设计师出图） |
| `process.env.APPDATA` fallback（macOS 用 `~/.config/cc-session-manager`） | 2h | 中（影响所有 IPC handler 的 dataDir） |
| `ResumeCommand` 跨平台路径 + shell escape | 3h | 中（Windows cmd.exe vs macOS bash 完全不同） |
| 测试 fixture 改 `os.tmpdir()` 而非硬编码 `C:\\Users\\...` | 2h | 低 |
| CI 加 macOS runner（GitHub Actions `macos-latest`） | 2h | 中（首次跑可能要修 native binding） |
| macOS menu bar（native menu 替代 window 内 menu） | 4h | 中 |
| ⌘ 快捷键映射 | 2h | 低（antd 大部分自动适配） |
| DMG 拖拽安装测试 + ZIP 绿色版测试 | 3h | 中（需 macOS 真机） |
| README 加 macOS 安装说明 | 1h | 低 |
| **合计** | **~3-4 天** | |

### 15.3 v4.0 验收

- [ ] `npm run package --mac` 在 macOS runner 上产出 `.dmg` 和 `.zip`
- [ ] DMG 拖拽到 Applications 后能正常启动（未签名，右键打开确认 Gatekeeper）
- [ ] 所有现有 85+ 测试在 macOS runner 上 PASS
- [ ] `process.platform === 'darwin'` 分支代码路径被单测覆盖
- [ ] macOS native menu 显示 File / Edit / View 等标准菜单
- [ ] README 提供 macOS 安装指南

### 15.4 不在 v4.0 范围

- ❌ Apple Developer ID 签名（成本 $99/年 + Apple Developer Program 申请流程）
- ❌ Mac App Store 上架
- ❌ Notarization（公证）
- ❌ iCloud 同步
- ❌ Touch Bar 支持
- ❌ Linux 适配（独立 v4.x 评估）

### 15.5 v3.0 → v4.0 过渡期预期行为

- macOS 本地开发：`npm run dev` **可工作**（Vite + Electron 都跨平台）
- macOS 打包：`npm run package` 会**失败**或出错版本（预期，等 v4.0 修复）
- 用户使用 macOS：能跑 dev 模式，但拿不到 installer；等 v4.0 发布
- macOS / Linux 打包（如有需求）

## 16. 验收标准

每波结束必须满足：

- [ ] `npm test` 全绿（用例数 ≥ 当前阶段预期）
- [ ] `npm run typecheck` 全绿
- [ ] `npm run package` 出 NSIS + Portable 双产物（**Windows-only**，macOS 见 §15）
- [ ] 安装包能正常打开、能完成该波所有模块的核心三件套（配置/查看/搜索）
- [ ] CLAUDE.md §13 决策记录已追加
- [ ] CHANGELOG.md 已追加该波变更
- [ ] README.md 特性列表已更新
- [ ] git 已 commit，commit message 写"为什么"不写"做了什么"
