---
title: cc-session-manager 项目历程（v1 → v2 → v3）
kind: project
created: 2026-07-28
tags: [project-history, electron, antd, fts5]
---

# cc-session-manager 项目历程

## 项目本质
本地 Windows 桌面工具，管理 Claude Code 会话历史。原始痛点：cc_switch 搜索弱。

## 三个迭代的关键决策

### v1（2026-07-28 早上）
- **技术栈切换**：Tauri+Rust → Electron+Node。理由：本机没装 Rust，装 Rust+VS Build Tools 30-60min，Electron 用现有 Node 22 零环境。功能不变。
- **核心栈**：Electron 32 + better-sqlite3 + FTS5 + React 18 + TypeScript + Vite
- **4 能力落地**：查看 / 搜索 / 继续（claude --resume） / 软删除+回收站
- **关键修复**：
  - `better-sqlite3` ABI 不匹配：测试改用 `ELECTRON_RUN_AS_NODE=1 electron --import tsx --test ...`
  - `tsconfig.electron.json` `rootDir: "electron"`（不是 `.`）让输出直接到 `dist-electron/`
  - schema 全部 DDL 加 `IF NOT EXISTS` + 老库自动 ALTER 兼容

### v2（2026-07-28 上午）
用户提 7 条改进 + 我自检 5 条 + 用户加 1 条（继续会话修复）= **13 条改进**。

- **最复杂一条**：项目聚类（schema 加 `parent_project_id` + clusterPath 算法）
- **聚类算法迭代 3 次**（教训：规则加法越加越乱，最后是单循环"剥到剩 1 段"）
- **UI 重做**：手写 inline-style → Ant Design 6 全量引入（781KB / gzip 254KB）
- **继续会话修复**：`spawn('claude', ...)` → `spawn('claude.cmd', ..., { shell: true, detached: true, stdio: 'ignore' })` + cwd 兜底到 home

### v3（2026-07-28 下午）
用户反馈 v2 聚类结果太复杂（出现 15532/Desktop 等噪声顶层，重复 prompt-project）。

- **简化聚类**：`clusterPath()` 改成 `path.basename(projectPath)`，**只看最后一段**
- 删父子折叠：ProjectTree 从 antd `Tree` 改回 `List`
- 删 breadcrumb 相关代码（App + SessionList）
- 真实数据：33 个项目，12 个有 session

## 用户认知 vs 算法 的重要教训
v2 聚类时我设计"剥前缀到剩 2 段"逻辑，想把 `prompt/react-prompt-editor` 拆成"父项目+子项目"。但用户实际认知是"每个会话的 cwd 最后一段就是项目"。

**教训**：**聚类应该服务用户的认知，不是路径分析的逻辑正确性**。以后类似工具直接 `path.basename(cwd)` 即可，不要发明"父项目"概念。

## 已知陷阱（CLAUDE.md 已记）
1. **better-sqlite3 ABI**：Node 22 vs Electron 不同 → 用 `ELECTRON_RUN_AS_NODE=1` 跑测试
2. **dist-electron 路径**：`rootDir: "electron"` 否则输出 `dist-electron/electron/main.js`
3. **FTS5 中文**：`unicode61 remove_diacritics 2`，按词切分够用
4. **soft delete + FTS 同步**：trigger 自动，`is_deleted=1` 的会话消息保留，搜索自动不返回
5. **Schema ALTER 兼容**：老库自动加列，新加列必须先 `PRAGMA table_info` 检测

## dev 启动
- `npm run dev` 同时起 Vite (5173) + Electron
- Vite 端口占用要先 kill：`cmd //c "taskkill /F /IM electron.exe"`
- 重建 DB：删 `%APPDATA%/cc-session-manager/app.db` + 重启 dev

## 测试
- 27/27 单元 + 集成测试通过（v1:17, v2:+10, v3 重构保 27）
- 命令：`npm test`
- **必须用 ELECTRON_RUN_AS_NODE 跑**，否则 better-sqlite3 报 ABI 错

## 项目结构
```
electron/    # Node 后端 (main + preload + db + importer + repo + resumer)
src/         # React 渲染 (App + 6 组件 + mock + api + types)
tests/       # 27 个测试
docs/        # specs/ plans/ screenshots/ DELIVERY_REPORT_V2.md
CLAUDE.md    # 项目宪法（15 章节，包括"全栈工程师"角色 + 三层链路纪律）
```
