# CLAUDE.md

> 我是这个项目的唯一全栈开发工程师。**任何对前端的修改都必须同步检查后端是否需要改，反之亦然。** 没有"只动前端"或"只动后端"的小修改 —— 改一处前，永远先想一遍三层链路（IPC contract / 数据模型 / 业务规则）。
>
> **平台策略**：Windows 优先（v2.0 / v2.1 / v3.0 三波全部产出 Windows installer）。macOS 适配延后到 v4.0（详见 `docs/superpowers/specs/2026-07-28-cc-manager-modules-design.md` §15）。开发模式（`npm run dev`）跨平台可用。

---

## 1. 角色与基本姿态

- **角色**：全栈开发工程师。栈 = Electron（main + preload）+ Node.js（better-sqlite3）+ React + TypeScript + Ant Design + Vite + Playwright（截屏）。
- **第一原则**：每个改动都要画清楚「前端→IPC→后端→DB」这条链，缺一段就补一段。
- **没有"只动样式"** 的微改动 —— 哪怕只改 antd 主题 token，也要确认 `ConfigProvider` 嵌套、是否需要 `ConfigContext` 透传、CSS variable 是否冲突。
- **不做"半步"**。改 schema 就连带改 repo / IPC / mock / 类型 / 测试。一次到位。

## 2. 仓库布局

```
cc-session-manager/
├── electron/                       # Node 后端
│   ├── main.ts                     # Electron 主进程 + IPC 注册 + 启动
│   ├── preload.ts                  # contextBridge 暴露 window.api
│   ├── db/connection.ts            # schema + 兼容 ALTER
│   ├── importer/{parser,scanner,cluster,index}.ts
│   ├── repo/{projects,sessions,messages,search,tree,types}.ts
│   └── resumer.ts                  # 生成 claude --resume 命令字符串（返回给前端复制）
├── src/                            # React 渲染进程
│   ├── main.tsx / App.tsx
│   ├── global.d.ts                 # window.api 类型
│   ├── api.ts                      # 包装 window.api
│   ├── types.ts                    # 跨层共享类型
│   ├── mock.ts + mock-data.ts      # 浏览器 dev mock（仅 vite serve 模式）
│   ├── components/                 # 6 个 antd 组件
│   └── hooks/useSearch.ts
├── tests/                          # node --test（用 ELECTRON_RUN_AS_NODE 跑）
├── scripts/screenshot.ts           # Playwright 截屏
├── docs/
│   ├── superpowers/{specs,plans}/
│   └── screenshots/
├── package.json / tsconfig.json / tsconfig.electron.json / vite.config.ts
```

## 3. 三层链路是单一真理

每个功能都走这条链。改任何一环前，**先把整条链在脑子里过一遍**：

```
[React 组件] → [src/api.ts 包装] → [window.api] → [preload.ts] → [IPC channel] → [main.ts handler] → [repo 函数] → [SQL]
```

每次加新功能，**所有 7 个文件都改**（如果链路完整）。漏一个 = 编译错或运行时崩。

### 改前必跑的 4 步 checklist

1. **数据类型** — `src/types.ts` + `src/global.d.ts`（Api 类型）先加
2. **mock 同步** — `src/mock.ts` + `src/mock-data.ts` 补假数据（让浏览器开发模式立即可用）
3. **IPC 链路** — `electron/repo/*.ts` 函数 → `electron/main.ts` handler → `electron/preload.ts` invoke
4. **组件 + 测试** — `src/components/*.tsx` 用新 API + `tests/*.test.ts` 验证 repo 函数

## 4. 数据库迁移

- **永远不直接 `DROP TABLE`**。要改 schema：先 `CREATE TABLE IF NOT EXISTS` 新结构，再写迁移逻辑把老数据搬过来。
- **加列必须 ALTER 兼容**：在 `initDB()` 里用 `PRAGMA table_info` 检测列存在性，缺则 `ALTER TABLE ADD COLUMN`。
- **删字段先标记**：不删列，加 `is_archived` 之类，半年后确认没人用再真正删。

## 5. 前后端类型共享

- `src/types.ts` 是**唯一**跨层类型源
- `electron/repo/types.ts` 在 IPC 返回值给主进程时用（不直接 import src/types.ts，因为 Electron main 不能用浏览器模块）
- **关键约定**：两边都重复定义 `ProjectRow / SessionRow / MessageRow / SearchHit / ProjectTreeNode` 字段，**每次改字段都要双修**
- 字段命名：`camelCase`（DB 里 `snake_case`，repo 函数 select 时 AS camelCase 转换）

## 6. IPC 契约规则

- **每个 IPC channel 必须有**：
  - `electron/repo/*.ts` 实现函数（pure DB）
  - `electron/main.ts` handler（薄包装，调 repo）
  - `electron/preload.ts` invoke 暴露
  - `src/global.d.ts` `Api` 类型字段
  - `src/api.ts` 包装函数
  - `src/mock.ts` mock 实现
- **参数 ≤ 4 个**，多了就传对象
- **错误用 throw** → main handler 捕获 → IPC 返回 rejected promise → 前端 `try/catch`
- **新 channel 命名**：`动词_名词`（如 `list_sessions`、`resume_session`）

## 7. 测试纪律

- **每个后端函数都有测试**：`tests/<module>.test.ts` 用 `node:test`
- **跑测试命令**：`npm test`（已配 `ELECTRON_RUN_AS_NODE=1 electron --import tsx --test ...`）
- **TDD 顺序**：测试先写 → 失败 → 实现 → 通过 → commit
- **跑测试是收尾门槛**：所有 task 完成前必跑 `npm test`，30+ 个全绿才交付
- **一次性不要改超过 1 个测试逻辑**：改 schema → 改测试 → 改实现，一组

## 8. 编译 / 构建命令

| 用途 | 命令 |
|---|---|
| 跑测试 | `npm test` |
| 类型检查 renderer | `npx tsc --noEmit` |
| 编译 electron | `npx tsc -p tsconfig.electron.json` |
| 跑 dev（Vite + Electron） | `npm run dev` |
| 仅 Vite | `npx vite` |
| 构建生产 | `npm run build` |
| 截屏 | `npx tsx scripts/screenshot.ts` |

## 9. 端口与进程

- **Vite 5173**（renderer 服务）
- **Electron 单独进程**，通过 preload + IPC 通信
- **背景跑必须用 `run_in_background: true`**，完成后查 task id 状态

## 10. 已知陷阱

- **better-sqlite3 ABI**：用 Node 22 跑测试会报 `NODE_MODULE_VERSION` 错。**必须**用 `ELECTRON_RUN_AS_NODE=1 electron` 跑测试，package.json 已配。
- **Mac 首次安装（或切换平台后）**：系统 Node.js 版本与 Electron 内置 Node ABI 不同，`npm install` 会因 node-gyp 编译 better-sqlite3 失败而退出。正确流程：
  ```bash
  npm install --ignore-scripts            # 跳过 native 编译
  node node_modules/electron/install.js   # 下载 Electron 二进制
  # 然后用 Electron 的 headers 编译 better-sqlite3：
  HOME=~/.electron-gyp node_modules/.bin/node-gyp rebuild \
    --target=$(cat node_modules/electron/dist/version) \
    --arch=arm64 \  # x64 机器改为 x64
    --dist-url=https://electronjs.org/headers \
    --module-name=better_sqlite3 \
    --module-path=build/Release \
    2>&1  # 在 node_modules/better-sqlite3/ 目录内执行
  ```
  或者直接用封装好的脚本：`npm run rebuild:sqlite`（内部调 electron-rebuild，Node v26 下可能不兼容，见上）。
- **`rootDir: "electron"`** 才能输出 `dist-electron/main.js`（不是 `dist-electron/electron/main.js`）
- **FTS5 中文分词**：`unicode61 remove_diacritics 2` 是当前方案，按词切分；够用就别动
- **soft delete + FTS**：FTS5 触发器自动同步 `INSERT/DELETE/UPDATE messages`，所以 `is_deleted=1` 的会话消息**不删**，搜索自动不返回
- **mock 模式**：浏览器打开 `http://localhost:5173` 时用 mock（fixture 数据）。Electron 打开用真 IPC。**两份实现必须同形**（同名函数、同参数、同返回）

## 11. 提交纪律

- 一个 task 一个 commit（type prefix：`feat` / `fix` / `refactor` / `docs` / `chore`）
- commit message 写**为什么**，不写**做了什么**（diff 自己看）
- commit 前必跑 `npm test` 全绿
- 重大改动（schema / IPC 协议）单独 commit，附数据迁移说明

## 12. 禁止事项

- ❌ 直接 `rm` 用户文件（除非明确删除 .peaks / dist 等生成物）
- ❌ 跳过 IPC 链中任一环直接调数据库
- ❌ 改 schema 不更新 mock
- ❌ 加新 IPC 不更新 Api 类型
- ❌ 在 React 组件里写业务逻辑（提到 hooks 或 repo）
- ❌ 用 `any` 糊弄类型错误
- ❌ `git push --force` / `git reset --hard` 任何分支
- ❌ 跳过测试直接 commit

## 13. 决策记录（project-local memory）

**重要决策**（写进 `.peaks/memory/`，按日期）：

- **2026-07-28** ：技术栈从 Tauri 改成 Electron。理由：本机没装 Rust，Electron 用现有 Node 22 零额外环境
- **2026-07-28** ：项目聚类采用"剥路径前缀"算法，最后 2 段 = top/sub；顶层有数字/短名（≤4 字符）作为个人命名空间时继续剥
- **2026-07-28** ：UI 用 antd 6 全量引入，不按需（开发速度优先，体积非瓶颈）
- **2026-07-28** ：Tree 默认折叠，用户可主动展开（v1 全展开体验过重）
- **2026-07-28 v3** ：聚类简化为 `path.basename(cwd)`，单层扁平（v2 父子折叠用户嫌复杂）；删除 antd `Tree`，改用 `List`；删除 breadcrumb
- **2026-07-28 v4** ：项目以 `~/.claude/projects/<folder>` 为单位入库（scanner 扫 folder 一级，不再递归 jsonl）；project.name 走 `path.basename(cwd)` 单源；新增 `projects.cwd` / `projects.is_archived` / `sessions.cwd` / `messages.content_blocks` 4 列；启动时一次性 migrate 把 v1-v3 误入库的 cwd-style 假 project 标 `is_archived=1`
- **2026-07-28 v4** ：parser 同时返回纯文本 + 结构化 `ContentBlock[]`（text/tool_use/tool_result/thinking/unknown），MessageView 按 block type 渲染
- **2026-07-28 v4** ：resumer 改为返回 `ResumeCommand { command, cwd? }` 字符串，spawn 代码 `// [停用]` 注释保留；UI 用 `ResumeCommandCard`（navigator.clipboard + execCommand 降级）展示可复制命令
- **2026-07-28 v5**：单一真相 = 原文件；metadata 是缓存，watcher 是唯一写入路径
- **2026-07-28 v5**：模块化目录结构（src/modules/ + electron/repo/<module>/）
- **2026-07-28 v5**：文件 watch 走 chokidar 事件驱动，无 polling（学 VS Code `files.usePolling: false`）
- **2026-07-28 v5**：App.tsx 改为导航壳子，业务逻辑全部下放到 modules/
- **2026-07-28 v5**：3 波节奏（v2.0 / v2.1 / v3.0），每波结束 npm run package
- **2026-07-28 v5 amendment**：平台策略改为 **Windows 优先**，macOS 适配延后到 v4.0（spec §15）。理由：当前开发机 + CI 是 Windows；macOS 适配涉及 Apple 签名 / notarization / native menu，单独留一整版本处理更稳
- **2026-07-28 v5 D8**：跨平台代码用 `process.platform` 运行时检测 + `os.homedir()` 取 `~/.claude`（OS 中性，无需特判）
- **2026-07-28 v5 D9**：electron-builder 配置**预留** `mac.target: ["dmg", "zip"]`，v4.0 启用 `--mac`，v2.0-v3.0 只跑 `--win`
- **2026-07-28 v5 D10**：测试 fixture 路径改 `os.tmpdir()` 而非硬编码 Windows 风格（防止 v4.0 macOS runner 跑挂）
- **2026-07-28 v5 D11**：macOS 签名 v4.0 起步**未签名**（Gatekeeper 警告 + 右键打开），Developer ID / notarization 不在 v4.0 范围
- **2026-07-28 v5 D12**：v3.0 → v4.0 过渡期 macOS 本地可 dev 但不可 package（预期行为）
- **2026-07-28 v5 D1**：watcher_state 表用 3 列 KV 模型（key PRIMARY KEY + value + updated_at），故意偏离 RD §4 模板的 5 列 — Simplicity First
- **2026-07-28 v5 D2**：chokidar 5.0.0 在 Electron 32 + Node 22 ABI 兼容，真实事件触发稳定；`usePolling: false` 显式声明
- **2026-07-28 v5 D3**：模块化目录 = `src/modules/` + `electron/repo/<module>/`（SessionsModule.tsx re-export 入口减少 import 噪音）
- **2026-07-28 v5 D4**：App.tsx 改导航壳子，业务逻辑全部下放到 modules/（本 wave-0 抽出 SessionsPane 181 行 + SearchResultsPane 55 行让 App.tsx 压到 99 行）
- **2026-07-28 v5 D5**：`ProjectList.tsx` 全代码库 0 引用孤儿组件，`git rm` 删（不留死代码）
- **2026-07-28 v5 D6**：enabled 状态走 KV 表（`mcp_server_state.enabled:<name>` 或 `skill:` / `cmd:` 前缀），不复用原文件（避免污染 `~/.claude.json` / SKILL.md / commands/*.md 的语义）。这是 wave-1 v2.0 的核心约束 — 用户 toggle 不破坏原文件结构
- **2026-07-29 v5 D7**：`~/.claude/settings.json` 和 `~/.claude/plugins/<name>/plugin.json` 等 JSON 配置走原子写（tmp + rename），失败 catch unlink tmp 残留 + 保留原文件。Hook / 插件模块的 create/update/delete 都走此模式，不破坏原文件其他字段
- **2026-07-29 v5 D9**：所有 6 个业务模块（MCP / Skills / Commands / Sub-Agents / Hooks / 插件）的 enabled 状态都走 `mcp_server_state` KV 表，不复用各自原文件。key 前缀区分（`mcp:` / `skill:` / `cmd:` / `agent:` / `hook:` / `plugin:`）。D6 决策延伸，统一走一张表简化

## 14. 用户语言

- **中文交流**（用户偏好）

## 15. 文档同步纪律（防误解）

**改代码的同时改文档**。任何时候发现以下情况，**主动更新**：

- **spec / plan / README / 注释** 与实际代码不一致 → 改文字
- **CLAUDE.md 自身** 的约定与实际做法冲突 → 改 CLAUDE.md
- **类型名 / 字段名 / 函数名** 重命名 → 更新所有引用它的文档、注释、commit message
- **新形成的约束**（命名、依赖、陷阱、决策）→ 追加到 CLAUDE.md
- **过时的事实**（如"用 Tauri"已经改成 Electron、API 列表变了、端口换了）→ 立即更新对应文档

**原则**：文档存在的目的是"让未来的人（或未来的我）看时不会误解"。发现会让别人误解的描述，**立刻改**，不要等用户说"这个不对"。

典型场景：
- 改完 IPC handler 名 → 全局搜引用 → 改 spec / preload / mock / api.ts
- 加新依赖 → 更新 CLAUDE.md "编译命令"和"已知陷阱"
- 改 schema → 更新 `docs/superpowers/specs/` 里对应的 spec 章节
- 改 Tree 折叠行为 → 更新 spec §3 决策表 + MANUAL_VERIFICATION

## 16. 改这个文件

任何时候发现本文档有错漏、或新形成的约束应该写进来，**直接 Edit 这个文件**。这是项目级宪法，不是只读文档。
