# cc-session-manager v4 — folder 语义 + 内容块 + 命令卡片

- **日期**：2026-07-28
- **状态**：已交付（commit a806f43 / 50f0428 / 5901b6c）
- **承接**：v3（扁平聚类 + antd UI）

## 1. 背景

v3 完成 27/27 测试,用户用起来报 3 类问题：

1. **项目栏显示 60+ 个项目,实际 `~/.claude/projects/` 只有 10 个 folder** — scanner 把每个 `<uuid>.jsonl` 的 cwd 当成独立 project 入库,跨 session 的同名 cwd 重复入库。
2. **消息框经常空内容** — Claude 真实 jsonl 里大量消息 `content` 是 array(`tool_use` / `tool_result` / `thinking` 块),v3 parser 只保留 `text` 块,其它全丢。
3. **继续会话按钮不工作** — Electron 主进程 `spawn('claude.cmd', ...)` 在 Windows 下脱离主进程生命周期,失败无回调,用户看不到。

## 2. 目标

3 个问题一次性修,1 个新功能(可复制命令卡片)。每改一处都画清楚「前端→IPC→后端→DB」整条链,一次到位。

## 3. 改动清单

### 3.1 项目以 folder 为单位（commit a806f43）

**根因**：`scanner.ts` 递归扫所有 `*.jsonl`,每个 jsonl 第一行有 `cwd` 字段,被 `parseLine` 提取后用 `cwd` 作为 `project_path` 入库。同一个 folder 下 10 个 session 若 cwd 不同,会入库 10 个 project。

**修复**：
- `scanner.ts`:新增 `scanProjectFolders(sourceDir)`,只扫 `~/.claude/projects/<folder>/` 一级,folder 内的 `<uuid>.jsonl` 视为该项目的 sessions,`<uuid>/` 子目录(运行时工作区)跳过
- `importer.ts`:新增 `importProjectFolder(db, folder)`,主入口走这个;保留 `importFile` 旧接口供测试/回退
- **schema 改动**：
  - `projects.cwd TEXT` — 存首条 message 的真实 cwd
  - `projects.is_archived INTEGER DEFAULT 0` — 隐藏 v1-v3 误入库的 cwd-style 假 project
  - `sessions.cwd TEXT` — 存每条 session 真实 cwd,给 resumer 用
- **migrate**:`importer/migrate.ts` 启动时一次性把老库 `project_path` 不在 `~/.claude/projects/` 父目录下的标 `is_archived=1`
- **project.name**:从 `path.basename(cwd)` 取(单一真实来源,不再做 folder 编码名反推 —— v2 在 `cc-session-manager` 这种连字符项目上踩过坑,不再重蹈)
- **删除**：`electron/importer/cluster.ts`(老 `clusterPath`/`topPath`)/`tests/cluster.test.ts`

**测试新增 4 case**:
- `scanProjectFolders returns folder with jsonl list, skips subdirs`
- `importProjectFolder creates one project for two sessions with same cwd`
- `sessions.cwd is set per-session from first message cwd`
- `archiveLegacyFakeProjects hides old v3 projects whose path is a cwd`

### 3.2 消息保留非文本 content 块（commit 50f0428）

**根因**:parser `extractContent()` 遇到 array 元素不是 text 就跳过,`tool_use`/`tool_result`/`thinking` 块全丢,渲染时空框。

**修复**:
- `parser.ts` 返回 `{ content: 纯文本拼接, blocks: ContentBlock[] }`
- **schema 改动**：`messages.content_blocks TEXT`(JSON),ALTER 兼容老库
- `messages repo` 读时反序列化
- `MessageView.tsx` 按 `block.type` 渲染:
  - `text` → 正常显示
  - `tool_use` → 灰底标签 `🔧 调用工具:Name(input 摘要)`
  - `tool_result` → 边框块 `📋 工具结果(截断 200 字符)`,`isError` 红色
  - `thinking` → `<details>` 折叠的 `💭 思考过程`
  - 空 content + 有 blocks → "(空内容,可能为纯工具调用或思考块)" 占位
  - 空 content + 无 blocks → 同样占位

**新增 3 个 parser 测试**:覆盖混合 blocks / 纯 tool_use / unknown 类型。

### 3.3 resumer 改返回命令字符串 + 命令卡片（commit 5901b6c）

**根因**:Electron 主进程 `spawn('claude.cmd', ...)` 在 Windows 下:
- 需要 shell 环境才能找到 `claude.cmd`,易丢 PATH
- `stdio: 'ignore' + unref()` 让 GUI 进程静默丢失
- 失败无回调,用户看不到

**修复**:
- `resumer.ts`:`spawn` 代码用 `// [停用 2026-07-28 v4 ...]` 注释保留,改 `buildResumeCommand` 返回 `{ command, cwd? }` 对象
- `main.ts`:IPC `resume_session` handler 改返回 `ResumeCommand | null`(`null` 当 session 不存在)
- `preload` / `global.d.ts` / `src/api.ts` / `src/mock.ts` 同步返回类型
- `src/components/ResumeCommandCard.tsx`(新):antd Card + monospace + 复制按钮(navigator.clipboard + execCommand 降级)+ 2s "已复制" 反馈;含 cwd 时附 `# cwd: <path>` 注释
- `App.tsx` 接入:切 session 时 `fetchResumeCommand` 自动调 IPC,`MessageView` 去掉旧的"继续会话"按钮

**测试**:`tests/resumer.test.ts` 重写,覆盖 `buildResumeCommand` / `buildResumeCommandString` 新行为。

## 4. 数据模型汇总（v4 终态）

```sql
-- projects:加 cwd / is_archived
projects(id, project_path UNIQUE, name, cwd, parent_project_id, imported_at, is_archived DEFAULT 0)

-- sessions:加 cwd
sessions(id, session_id UNIQUE, project_id, title, cwd, started_at, last_message_at,
         message_count, source_file, is_deleted DEFAULT 0, deleted_at)

-- messages:加 content_blocks(JSON)
messages(id, uuid UNIQUE, session_id, role, content, content_blocks, created_at)
```

**所有新列都有 ALTER 兼容迁移**(在 `initDB` 里 `PRAGMA table_info` 检测 + `ADD COLUMN`)。

## 5. IPC 契约

| channel | 改动 |
|---|---|
| `list_projects` | 隐式:加 `WHERE is_archived = 0` 过滤(返回类型不变) |
| `list_project_tree` | 同上 |
| `list_sessions` / `list_messages` | 返回多 `cwd` 字段(listByProject 不变,listBySession 返回 MessageRow.blocks) |
| `search_messages` | SearchHit.message.blocks 默认为 `[]`(搜索结果只显示 snippet) |
| `resume_session` | **返回类型变**:`Promise<number>` → `Promise<ResumeCommand \| null>` |

## 6. 测试覆盖

| 文件 | case 数 | 覆盖 |
|---|---|---|
| `db.test.ts` | 1 | initDB 创建所有表(含新列)+ 老库 ALTER |
| `parser.test.ts` | 7 | 含 v4 新增 3 case(混合 blocks / 纯 tool_use / unknown) |
| `importer.test.ts` | 5 | 含 v4 新增 4 case(folder 扫描 / 导入 / sessions.cwd / archiveLegacy) |
| `projects-repo.test.ts` | 2 | folder-level + archiveLegacy |
| `sessions-repo.test.ts` | 4 | 含 v4 新增 sessions.cwd 断言 |
| `search.test.ts` | 3 | 不变 |
| `tree.test.ts` | 1 | 不变 |
| `resumer.test.ts` | 4 | v4 重写,覆盖 buildResumeCommand / buildResumeCommandString |
| **合计** | **27 → 28** | 全绿 |

## 7. 范围外

- 没做 session 标题手动编辑(用户的"想修改标题"需求归到 v5 — 见 §8)
- 没做 mock 端 content blocks 覆盖(测试覆盖 27/27 在后端,UI 渲染肉眼验)

## 8. 后续

- session 标题可编辑(用户 v4 提的剩余需求)
- 高保真 antd `Bubble` 替换 MessageView 手写 div(提升美感)
- Playwright 截屏:folder 折叠态 + 命令卡片 + tool_use 块展示
