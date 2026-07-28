# cc-session-manager v2 — 优化设计

- **日期**：2026-07-28
- **状态**：待批准
- **作者**：Claude（brainstorming skill）

## 1. 背景

v1 已完成：查看/搜索/继续/软删除+回收站 4 大能力落地，UI 是手写 inline-style 的极简版本。用户上手后给出 7 条改进意见 + 5 条设计补充（自检发现）。

## 2. 目标

7 个改进点落地，UI 用 Ant Design 重构，搜索体验（点击跳到命中位置）打通。

## 3. 7+5 个改进点（已确认）

| # | 改进点 | 决策 |
|---|---|---|
| 1 | 左栏项目按路径聚类 | **Tree 组件**：顶层/子项目两层嵌套，**默认折叠**，可展开 |
| 2 | 搜索结果归属标签 | **面包屑** `prompt / react-prompt-editor · 会话标题` |
| 3 | 跳到关键字位置 | **滚动 + `<mark>` 高亮**（复用 FTS5 snippet） |
| 4 | 左/中栏同步选中 | **用现有蓝底**选中 UI，不另加高亮 |
| 5 | 项目筛选下拉 | 保留多选下拉，**去掉 Ctrl 多选**（直接点击切换） |
| 6 | 回收站假数据 bug | mock `listSessions` 1 行修复 |
| 7 | UI 重做 | **Ant Design 全量引入** |
| +1 | 时间范围默认 | **改"全部"**（不是 30 天） |
| +2 | 删除按钮 | **图标按钮**（🗑️ 无文字，hover tooltip） |
| +3 | Tree 默认状态 | **折叠**（不是展开） |
| +4 | 搜索匹配 | **精确匹配**（不做模糊/语义） |
| +5 | 搜索无结果 | 显示 **3 条建议文案**（拼写/时间/已删除） |
| +6 | 继续会话按钮不生效 | 修复 `spawn` 参数：`shell: true` + `cwd` 兜底 + `claude.cmd` 优先 |

## 4. 数据模型改动

### projects 表加 `parent_project_id`

```sql
ALTER TABLE projects ADD COLUMN parent_project_id INTEGER REFERENCES projects(id);
CREATE INDEX idx_projects_parent ON projects(parent_project_id);
```

**聚类算法**（导入时）：根据 `project_path`，按 `/` 或 `\` 切分：
- 第一段作为顶层项目名
- 剩余路径作为子项目名
- 例：`C:/Users/15532/Desktop/prompt/react-prompt-editor` → 顶层 `prompt`，子项目 `react-prompt-editor`

**示例路径 → 树形**：
```
prompt
  ├─ boss-prompts-manager
  ├─ docs
  ├─ project
  ├─ prompt-project
  └─ react-prompt-editor
cc-session-manager
peaks-loop
  ├─ peaks-code
  ├─ peaks-content
  └─ ...
```

### 新增 IPC handler

- `list_project_tree(): { id, name, sessionCount, children: [...] }[]` — 返回 2 层 Tree 结构

## 4.5 继续会话修复（+6）

**问题根因**：
- `spawn('claude', ...)` 在 Windows 上找不到 `claude.cmd`（需 `shell: true`）
- `cwd: path.dirname(sourceFile)` 可能指向已删除目录
- `stdio: 'ignore' + unref()` 在 Windows 下让 GUI 进程静默丢失

**修复**：
```typescript
import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';

export function resumeSession(sessionId: string, cwd?: string): number {
  const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const child = spawn('claude.cmd', ['--resume', sessionId], {
    cwd: safeCwd,
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid ?? 0;
}
```

**额外**：UI 上加 toast/notification 反馈（antd `notification.success`）"已在新窗口打开会话"。

**错误处理**：
- `spawn` 抛错 → main 进程捕获 → 推回 IPC 错误 → UI 显示 `notification.error`"无法启动 claude，请检查 PATH"
- 父进程不阻塞，Electron 窗口保留

## 5. UI 架构

### 5.1 Ant Design 组件映射

| 旧组件 | 新组件 |
|---|---|
| 手写 div SearchBar | antd `Input.Search` + `Select(mode="multiple")` + `Select(time range)` |
| 手写 div ProjectList | antd `Tree`（2 层，defaultExpandAll=false） |
| 手写 div SessionList | antd `List` + `Card` + `Empty` |
| 手写 div MessageView | antd `Bubble`（用户/Claude 双侧气泡） |
| 手写 div ConfirmDialog | antd `Modal.confirm()` |
| 手写 div RecycleBinView | antd `List` + 红色 `Button` |

### 5.2 关键交互

**搜索结果点击**：
1. 用户在搜索结果点 `prompt / react-prompt-editor · 用 claude code 改写...`
2. App 设置 `selectedProjectId = react-prompt-editor.id`
3. 加载该子项目的 sessions
4. 自动选中第一条匹配 message
5. 右栏滚动到该 message，**`<mark>` 高亮**（FTS5 snippet 已给）
6. 左栏 Tree **自动展开** `prompt` 父节点，**滚动到可视区** + 蓝底选中

**项目筛选下拉**：
- antd `Select mode="multiple"` 天然支持点击切换
- 顶部显示已选 chip 形式（antd 内置）
- 不再需要 Ctrl

**删除按钮**：
- antd `Button icon={<DeleteOutlined />}` 无文字
- `Tooltip title="删除"`
- 永久删除按钮：`Button danger icon={<DeleteOutlined />}`

**Tree 默认折叠**：
- `defaultExpandedKeys={[]}` 只显示顶层
- 顶层项名前有 `▶/▼` 三角图标
- 用户点击展开/折叠

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| FTS5 snippet 包含未转义 HTML | 用 DOMPurify 清理（避免 XSS） |
| Tree 节点数 > 50 | 仍可滚动，Ant Design 虚拟化（如需要可后续） |
| 选中子项目后该子项目已被永久删除 | 弹 Modal 提示"会话已不存在"，重置选中态 |

## 7. 测试策略

| 范围 | 方法 |
|---|---|
| 聚类算法 | 单元测试（10+ 路径样本） |
| Tree 数据结构 | 单元测试 |
| `listSessions` mock 修复 | 单元测试 |
| UI 渲染 | Playwright 截图（同 v1 流程） |
| 搜索点击联动 | Playwright E2E（点击 → Tree 展开 + 右栏滚动） |

## 8. 风险

| 风险 | 缓解 |
|---|---|
| antd 全量引入 +200KB | Electron 应用不在乎，仍 < 1MB |
| 真实 `~/.claude/projects/` 路径可能不规范 | 聚类算法做容错（路径只有 1 段 → 顶层 = 子项目） |
| 老 `app.db` 没 `parent_project_id` 字段 | 加 ALTER TABLE 兼容 |
| 第一次启动老库 | `IF NOT EXISTS` 兼容（已 v1 实现） |

## 9. 验收标准

- [ ] Tree 显示 2 层结构（顶层 + 子项目），**默认折叠**
- [ ] 搜索结果归属用面包屑 `顶层 / 子项目 · 标题`
- [ ] 点击搜索结果：Tree 展开父 + 滚动 + 蓝底选中 + 右栏跳到该 message
- [ ] 关键字在右栏 message 内**黄底高亮**（FTS5 snippet）
- [ ] 项目多选下拉**不需要 Ctrl**（直接点）
- [ ] 时间范围**默认"全部"**
- [ ] 删除按钮**图标无文字**
- [ ] 搜索无结果显示 **3 条建议**
- [ ] 17/17 v1 测试 + 新增 5+ 个测试全部通过
- [ ] Playwright 截图：Tree 折叠态 + 搜索结果点击联动 + antd UI
- [ ] ▶ 继续会话能成功拉起 `claude.cmd --resume <id>`（`shell: true`）
- [ ] cwd 失效时兜底到 home，UI 显示成功通知
- [ ] 找不到 `claude` 时 UI 显示错误提示

## 10. 范围

- 单 spec 范围：UI 重做 + 7 个改进 + 5 个补充，共 12 条
- 实施计划拆 6-8 个 task，每个独立可测
