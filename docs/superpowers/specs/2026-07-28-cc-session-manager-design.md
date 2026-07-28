# cc-session-manager — 设计文档

- **日期**：2026-07-28
- **状态**：已批准，待进入实现计划
- **作者**：Claude（brainstorming skill）

## 1. 背景与目标

### 1.1 问题
使用 Claude Code 开发时，会话历史散落在 `~/.claude/projects/` 下的多个 JSONL 文件中，缺少统一管理工具。现有 cc_switch 工具的搜索能力不足，无法通过关键词检索历史会话内容。

### 1.2 目标
为个人开发者（Windows 单机）提供一个本地桌面工具，集中管理 Claude Code 的历史会话，支持：
- 查看历史会话（按项目分组）
- 关键词全文搜索（用户消息 + Claude 回复）
- 继续历史会话
- 软删除 + 回收站还原

### 1.3 非目标（v1）
- 多人协作、权限隔离
- 多设备同步
- 语义搜索（基于词向量）
- 标签、收藏、导出
- 跨平台（v1 仅 Windows）

## 2. 使用者与场景

- **使用者**：个人开发者，本机 Windows
- **典型场景**：
  1. 几周后想找回"当时那个登录 token 过期的解决方案" → 搜索关键词 → 定位会话 → 继续
  2. 误删了某个会话 → 从回收站恢复
  3. 想看某个项目都聊过哪些 → 按项目筛选

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | Tauri 2.x | 启动快、包小、原生窗口体验好 |
| 前端 | React + TypeScript + Vite | 生态成熟，与 Tauri 配合良好 |
| 后端 | Rust | JSONL 解析健壮、SQLite 绑定稳定 |
| 数据存储 | SQLite + FTS5 | 全文搜索毫秒级、软删除用字段标记 |
| 数据位置 | `%APPDATA%/cc-session-manager/app.db` | Windows 标准配置目录 |

## 4. 架构

### 4.1 三层结构

```
┌────────────────────────────────────────────┐
│ UI 层（React）                              │
│ - 搜索 + 筛选 + 三栏视图 + 回收站           │
└──────────────┬─────────────────────────────┘
               │ Tauri commands (invoke)
┌──────────────▼─────────────────────────────┐
│ 数据层（Rust）                              │
│ - Importer：扫描 ~/.claude/projects/       │
│ - Repository：CRUD + FTS5 查询             │
│ - Resumer：启动 claude --resume 子进程    │
└──────────────┬─────────────────────────────┘
               │ rusqlite
┌──────────────▼─────────────────────────────┐
│ 存储层                                      │
│ SQLite (app.db)                            │
│ - projects / sessions / messages            │
│ - messages_fts（FTS5 虚表）                │
└────────────────────────────────────────────┘
```

### 4.2 数据流

**导入流程（首次 + 增量）**：
1. 扫描 `~/.claude/projects/**/*.jsonl`
2. 对比文件 mtime + size，跳过未变文件
3. 解析 JSONL，按 sessionId 分组
4. 写入 `sessions` 和 `messages`（用 uuid 去重）
5. FTS5 通过 trigger 自动同步

**搜索流程**：
1. 用户输入关键词 → 拆分 tokens
2. 前端调用 `search_messages(tokens, project_ids, time_range)`
3. Rust 端构造 FTS5 `MATCH` 查询 + WHERE 筛选
4. 返回命中行 + 高亮片段

**继续会话流程**：
1. 用户点击「继续会话」
2. Rust 端用 `tokio::process::Command` 启动 `claude --resume <sessionId>`
3. 父进程不等子进程结束，工具窗口保留

## 5. 数据模型

### 5.1 表结构

```sql
-- 项目
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);

-- 会话
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 消息
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  uuid TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 全文索引
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
```

### 5.2 软删除
- 软删除 = `UPDATE sessions SET is_deleted = 1, deleted_at = ?`
- 回收站视图 = `WHERE is_deleted = 1`
- 恢复 = `UPDATE sessions SET is_deleted = 0, deleted_at = NULL`
- 不删除 messages 记录
- FTS5 索引通过 trigger 同步增删

### 5.3 搜索行为
- 多关键词 = 空格拆分，FTS5 `MATCH` 默认为 AND
- 命中片段 = 第一个命中位置前后 80 字符，用 `highlight()` 高亮
- 筛选 = 项目 ID 列表 + 时间范围，在 WHERE 中叠加

## 6. UI 设计

### 6.1 整体布局

三栏 + 顶部工具栏：

```
┌──────────────────────────────────────────────────────────────┐
│ [🔍 搜索框]    [项目▼] [时间▼] [🗑️回收站]                    │
├────────────┬──────────────────────────┬─────────────────────┤
│ 项目列表    │ 会话列表                  │ 消息详情             │
│ ▸ foo (12) │ ● 会话标题1   2小时前     │ [用户] 14:30         │
│   bar (5)  │   首条消息预览... 5条     │ 帮我写个登录 API      │
│   baz (3)  │                          │                     │
│            │ ● 会话标题2   昨天         │ [Claude] 14:31       │
│            │   首条消息预览... 12条    │ 好的，我先确认需求...  │
│            │                          │                     │
│            │                          │ [继续会话] [删除]    │
└────────────┴──────────────────────────┴─────────────────────┘
```

### 6.2 核心交互

1. **搜索**：300ms 防抖输入即搜索；按消息维度返回，点消息跳到会话 + 定位
2. **筛选**：项目多选 + 时间下拉（今天/7天/30天/全部，默认 30 天）
3. **查看详情**：用户消息左气泡，Claude 消息右气泡
4. **继续会话**：调用 `claude --resume <sessionId>`，工具窗口保留
5. **删除/回收站**：删除 = 二次确认后软删除；回收站视图 = `is_deleted = 1`；永久删除 = 必须输入会话标题确认

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 首次启动找不到 `~/.claude/projects/` | 友好提示，未导入任何数据 |
| 目录为空 | 显示"暂无历史会话" |
| 目录有文件 | 进度条导入 |
| 原 JSONL 文件 mtime 变化 | 增量解析，用 uuid 去重 |
| Claude Code 删了原文件 | 工具库数据保留；继续会话时弹窗确认 |
| 搜索无结果 | 明确提示 + 放宽建议 |
| SQLite 损坏 | 备份损坏文件到 `app.db.bak.<ts>`，新建空库并提示 |

## 8. 测试策略

| 层 | 范围 |
|---|---|
| 单元（Rust） | JSONL 解析器、FTS5 查询、软删除/恢复逻辑 |
| 集成（Rust） | 模拟 100 个 JSONL 跑完整导入流程 |
| E2E（前端） | Playwright：搜索 → 命中 → 查看 → 删除 → 恢复 |
| 手动验证 | 真实项目下导入 50+ 会话；真实点击"继续会话" |

## 9. 风险与权衡

| 风险 | 缓解 |
|---|---|
| Tauri 2 在 Windows 上需 Visual Studio Build Tools + WebView2 | README 中说明依赖 |
| 首次导入 100+ 真实会话可能慢 | 进度条 + 后台线程，不阻塞 UI |
| FTS5 中文分词能力有限 | v1 接受此限制；按词切分足够覆盖大多数场景 |
| `claude --resume` 行为可能因 Claude Code 版本变化 | 启动前检测版本，不兼容时给提示 |

## 10. 验收标准

- [ ] 首次启动能正确导入 `~/.claude/projects/` 下所有 JSONL
- [ ] 启动后自动检测增量文件并同步
- [ ] 三栏布局正常显示，搜索响应 < 200ms
- [ ] 多关键词搜索结果正确（AND 逻辑）
- [ ] 项目/时间筛选生效
- [ ] 软删除后能从回收站恢复
- [ ] 永久删除需要输入标题确认
- [ ] 「继续会话」能成功拉起 `claude --resume`
- [ ] 4 类测试全部通过
- [ ] 在 50+ 真实会话上手动验证通过
