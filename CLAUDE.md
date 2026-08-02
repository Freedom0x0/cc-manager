# CLAUDE.md

> 我是这个项目的唯一全栈开发工程师。**任何对前端的修改都必须同步检查后端是否需要改，反之亦然。** 没有"只动前端"或"只动后端"的小修改 —— 改一处前，永远先想一遍三层链路（IPC contract / 数据模型 / 业务规则）。
>
> **例外**：只读视图的本地过滤（搜索框 / 计数 / 排序）不触发三层链路检查，因为它不修改状态、不调用 IPC、不改变数据。改 enabled 计数 / 排序 / 搜索 key 等只读视图字段，不需要同步动后端。
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
│   ├── components/                 # 跨模块共享组件(WatcherStatusIndicator / ComingSoon)
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
- **`commit` 可以由 Claude 代跑**（测试全绿 + type check 0 错 + message 已与用户对齐后）
- **`push` 必须由用户亲手跑**（CLAUDE.md 改这条 2026-07-31：commit 是本地动作可逆，push 是对外发布，影响 main 上所有人）

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
- **2026-07-29 v5 D9**：[**v3.1 部分实现, 详见 D9 续**] electron-builder 配置**预留** `mac.target: ["dmg", "zip"]`,v4.0 启用 `--mac`,v2.0-v3.0 只跑 `--win`
- **2026-07-30 v5 D9 续**：v3.1 mac 装包配置已就绪(`electron-builder.json` mac target = dmg+zip, arm64+x64;`package:mac` 脚本已加;`getDataDir()` macOS 分支早就有 — D8 决策)。但 **mac 真机验证 deferred**(需要 mac 贡献者跑 `npm test` + `npm run dev` + `npm run package:mac` + Gatekeeper 流程)。未签名(D11)留到 v4.0 做 Developer ID + notarization。完整 checklist 见 README §macOS 真机验证 checklist。
- **2026-07-30 v5 D10 推翻 D6/D9**：用户的"停用"语义必须写到 Claude Code 实际读取的字段才生效。6 模块真停用位置：
  - 插件：`~/.claude/settings.json` 的 `enabledPlugins[<name>@<marketplace>] = bool`（不是 installed_plugins.json）
  - MCP：`~/.claude/settings.json` 的 `disabledMcpjsonServers[]` 黑名单
  - Skills/Commands/Sub-Agents: Skills **2026-07-31 修正为镜像目录方案** 见 D11;Commands/Agents 仍 `<name>.md` ↔ `<name>.md.disabled`(用户未报失败,保守保留)
  - Hooks：`settings.json.hooks[<event>]` 数组 splice 移除
  - KV 表保留作 cache + profile_capture 读历史偏好，**不**是 UI 真实状态
  - 启动时一次性 `runMigration` 把 KV → 真实文件同步
  - 抽出共享 `electron/repo/settings-writer.ts` 统一原子写抽象（基于 D7 模式）
  - 修正 profiles 模块的 KV prefix bug（mcp 用裸 `enabled:`，其余 5 用 `<prefix>:enabled:`）
- **2026-07-31 v5 D11 修正 commit 5 skills 停用方案**：
  - 原 commit 5 用 `.disabled` 后缀方案(mv `skills/<name>/` → `skills/<name>.disabled/`),
    假设"Claude Code 不读 .disabled 后缀目录"。RD 阶段我自己跑过单次简单环境
    实测通过,但 **2026-07-31 用户复测发现失败**(多 symlink / 不同 Claude Code
    版本场景),skills 仍是"假停用"。
  - **修正方案**:skills 改用**镜像目录** `mv skills/<name>/` ↔ `disabled_skills/<name>/`
    (commit 9 / PR #2)。
  - **优势**(不依赖隐式行为"不读后缀",依赖显式路径"只扫这个目录"):
    1. scanner 只扫 `~/.claude/skills/`,自动跳过镜像目录
    2. 跨 Claude Code 版本行为稳定
    3. symlink skill 安全(挪走后 symlink target 路径不冲突)
  - **保留** commands / agents 的 .md.disabled 方案(用户未报失败,保守不 over-surgery)
  - **教训**:单次简单环境实测 ≠ 硬证据;commit 5 当初应该加"⚠️ 基于假设,需真机验证"
  - commit 9 (origin PR #2) 已合并 main,所有人在 main HEAD 跑验证
- **2026-07-31 v5 D12 commit 9 教训续(单次合并修复)**：
  - commit 9 (`9c39e3f`) 修了"写"(`setDisabledSuffix` 走 `disabled_skills/<name>/` 镜像目录),但**没修"读"** —— `scanner.listSkills()` 仍然只读 `~/.claude/skills/`,导致用户停用后被挪到 `disabled_skills/<name>/`,主目录不再有它,**UI 列表里完全消失,没法点"启用"搬回去**。
  - 触发:用户 2026-07-31 报告"skills 列表不显示停用的,我没法重新启用"。
  - **修复方案(单次合并)**:在 `scanner.listSkills(db, skillsDir?, opts?)` 加第三参 `opts.disabledSkillsDir`,合并主目录+镜像目录扫描,`enabled` 由"目录来源"决定(主=true / 镜像=false)。同名冲突主目录赢 + `console.warn`(避免覆盖用户看不出来的覆盖行为)。同时 `main.ts` 的 `skill_list` / `skill_get` handler 显式注入 `disabledSkillsDir` 让 production 路径生效。
  - 关键决策:
    - **向后兼容**:`opts` 可选;`opts` 不传 → 仍只扫主目录(老单参调用路径)。`main.ts` handler 显式注入生产路径 `defaultDisabledSkillsDir()`,扫描前 `existsSync` 跳过,镜像目录首次未建时静默。
    - **scanner 不排序**:排序是 UI 关注,`SkillsManager.load()` 内 `localeCompare(name)` 一处搞定,真 IPC 和 mock 走同一路径,行为统一。
    - **4 个新 case** 钉死:合并扫描返 enabled=false / 同名冲突主目录赢 + warn / 单参向后兼容 / 镜像目录缺失静默。`tests/skills.test.ts` 现 9 case。
    - **IPC 链路零改动**:`preload.ts` / `global.d.ts` / `src/api.ts` / `src/mock.ts` 全未动(`skillList/skillGet` 签名不变),靠可选 opts 在 repo 层注入,避免改 IPC 契约放大动作面。
  - **教训(二)**:`写完不算完,UI 也要验`。commit 9 验证只测了 `setEnabled(false)` 把文件挪对了 + `listSkills()` 不再列它,**没在 UI 上点"启用"反向走一遍**。下次写"对称写"的接口(enable/disable / create/delete) 必须在 UI 双向验证,不能只验一半。
  - 6 文件改动 `+/-`: `scanner.ts` +113/-48(B 档,改函数签名) / `index.ts` +2/-1(A 档) / `main.ts` +9/-3(A 档,handler 注入 opts) / `SkillsManager.tsx` +4(A 档,UI 排序) / `tests/skills.test.ts` +91(A 档,TDD 红→绿) / `CLAUDE.md` +12(D12 决策追加,本段)。`npm test` 147/147 全绿,`tsc --noEmit` 0 报错。
- **2026-07-31 v5 D13 applyProfile 完整替代语义**:
  - 原 applyProfile(wave-3)只保证 `profile.config.enabledX` 列表里的项启用,**其他项不动**(writer.ts:206-211 注释明示"保守 — 不破坏未指定的 MCP 状态")。
  - 改为**完整替代**:调 6 个 scanner 拿当前 enabled 全集,`current ∖ target` → 反向 disable 写真实文件(settings.json 黑名单 / enabledPlugins=false / .disabled 后缀 / disabled_skills/ 镜像)。
  - 触发:用户 2026-07-31 报告"8 skills 停 4 存 P1 → 8 全启 → apply P1 → 期望 4 启 4 停,实际 8 全启",违反 spec §7.3 profile_diff 暗示的"完整快照"语义、UI 文案"会改变所有 6 类组件"也明示完整替代、wave-3 改造只补"写真实文件"未补"反向 disable"是历史遗留。
  - **Hooks 限制**:`setHookEnabled(true)` 不存在(需 createHook 重建完整 HookEntry),所以 hook enable 维持 skip;hook 反向 disable 用 `setHookEnabled(event, index, false)` splice,索引错位风险接受为已知限制。
  - **回滚**:`prevFileEnabled`/`prevMcpDisabled`/`prevPluginEnabled`/`prevHookPresent` 现有函数复用,reverse-disable 写入前也备份 prev。中途失败按 `rollbackRealFile` 路径回滚。**writer.ts 回滚吞异常 bug(task #13)仍待修**。
  - **capture 不动**:`captureProfileFromState` 仍读 KV 表 value='true' 的项;应用时反查当前全集足够。`enabledX` 双列(profile.config 同时记 enabled+disabled)作为下次 sprint 处理。
  - 1 文件改动:`electron/repo/profiles/writer.ts` applyProfile 改造(B 档,改函数体 + 加 reverse-disable 循环 + 加 fixture 路径解析)。`tests/profiles.test.ts` Case 6 必须传 baseDir(否则 listMcpServers 扫生产 ~/.claude.json,把用户的 playwright MCP reverse-disable 加进黑名单 → 污染生产路径),新增 Case 7/8/9 钉死 3 模块 reverse-disable 行为。`npm test` 150/150 全绿,`tsc --noEmit` 0 报错。
- **2026-07-31 v5 D14 commands/agents scanner 同步改造 — 返 disabled 项**:
  - 原 commands/scanner.ts:84-85 / sub-agents/scanner.ts:84-85 跳过 `.md.disabled` 后缀文件 → scanner 只返 enabled 项,UI 上看不到停用的 command/sub-agent。
  - 改为 scanner **包含** `.md.disabled`,标 `enabled=false`,name 是去掉 `.md.disabled` 后缀的形式(跟 skills 镜像方案 D12 对称)。
  - 触发:跟 D12 同一根因 — commit 5 `.disabled` 后缀方案在"写"路径走通,UI 上"启用/停用"切换也能跑,但 scanner 跳过后 UI 看不到停用的项,无法反向启用。v5 D10 决策的"对称写接口必须 UI 双向验证"教训,D12 修了 skills,D14 补 commands/agents。
  - **真 bug**:`"review.md.disabled".endsWith(".md") === false`(末尾是 `led` 不是 `md`)!所以原写法 `if (!filename.endsWith('.md')) continue;` + 之前的 `if (filename.endsWith('.md.disabled')) continue;` 都依赖 endsWith 链 — D14 必须显式两种后缀都判断(`isDisabled || isEnabled`),不能写 `.endsWith('.md')` 当通用门。
  - **UI 影响**:`CommandsManager.tsx` / `SubAgentsManager.tsx` 不改(已直接 setCommands/setAgents,line 199/214 已渲染 enabled tag + Switch)。但新隐患:`foo.md` + `foo.md.disabled` 同名,UI 会渲染两次(去重逻辑缺失)。登记到 findings.md,本次不动 UI。
  - 4 文件改动:`commands/scanner.ts` +14/-3(B 档,改扫描逻辑) / `sub-agents/scanner.ts` +14/-3(同) / `tests/commands.test.ts` Case 3 改名 + 改断言(`excludes` → `includes with enabled=false`)(A 档) / `tests/sub-agents.test.ts` Case 3 同步(A 档)。`npm test` 150/150 全绿稳定 5 次,`tsc --noEmit` 0 报错。
- **2026-07-31 v5 D15 captureProfileFromState 走 6 scanner 拿真实 enabled 全集**:
  - 原 `captureProfileFromState(db)` 走 `mcp_server_state` KV 表 LIKE 查询 6 个 prefix(`enabled:` / `skill:enabled:` / `cmd:enabled:` / `agent:enabled:` / `hook:enabled:` / `plugin:enabled:`),过滤 `value='true'`。
  - 触发:用户加 6 模块顶部 enabled 计数后手算 140,但 profiles 面板 profile "a01" 显示「131 项启用」,差额 9。对账验证:profile "a01" 131 = KV 表 value=true 总数 131(完全吻合);6 模块 Manager 顶部 140 = 6 scanner 真实 enabled 全集。
  - 根因:D10 决策 KV 表「保留作 cache + profile_capture 读历史偏好,不**是 UI 真实状态」 —— KV 只记录用户主动 toggle,从未 toggle 但 scanner 默认 enabled=true 的项不进 KV(例 `installed_plugins.json` 装了一个 plugin 但用户没在 UI 上点过 enable/disable)。captureProfileFromState 走 KV 表 LIKE 漏掉这 9 项。
  - **修正**:改 captureProfileFromState 走 6 个 scanner 读真实 enabled 全集,与 applyProfile writer.ts:280-295 口径一致(applyProfile 早已用 scanner 拿 curEnabled 全集做 D13 reverse-disable)。
  - 关键决策:
    - **签名加 CaptureOptions**(skillsDir / disabledSkillsDir / commandsDir / agentsDir / mcpConfigPath / settingsPath / installedPluginsPath),全部可选,未传走 `default*Dir()` 默认生产路径。
    - **改 async**:6 scanner 并发 `Promise.all`,原 sync 实现 → async 是 B 档改函数签名。
    - **createProfile 加第 4 参数 `captureOpts?`** 透传给 captureProfileFromState(测试 fixture 用,生产 = 默认路径)。
    - **main.ts `profile_capture` handler 显式传 6 个 `default*Dir()`** —— 即便传默认路径,显式声明 = 测试可控 + 阅读清晰。
    - **IPC 契约不变**:`profile_capture` 还是 `(name, description)`,handler 内部多拼路径不外露。`preload.ts` / `api.ts` / `mock.ts` 全未动。
  - **口径对比**(D15 后):
    - captureProfileFromState(6 scanner) = profile.config.enabledXxx.length 求和 = **当前实时 enabled** (140)
    - applyProfile writer.ts:280 (6 scanner 拿 curEnabled) = **同上** (140)
    - KV 表 LIKE 查询已废弃,captureProfileFromState 不再走 KV。
  - 4 文件改动:`electron/repo/profiles/writer.ts` captureProfileFromState async 化 + 加 CaptureOptions + createProfile 加 captureOpts 参数(B 档) / `electron/main.ts` profile_capture handler 显式传 6 default 路径(A 档,IPC 契约不变) / `tests/profiles.test.ts` Case 3 重写为「走 6 scanner」+ 钉死 KV 漏项场景(B 档) / `CLAUDE.md` +15(D15 决策,本段)。
  - **验证**:`npm test` 150/150 全绿稳定 2 次,`tsc --noEmit` + `tsc -p tsconfig.electron.json --noEmit` 双 0 错。
  - **教训(共 3 条)**:(1) D10 决策 KV 是 cache,但 captureProfileFromState 当时没意识到 —— D15 修正 capture 走 scanner。(2) KV 表「记录用户 toggle」语义 vs scanner「真实状态」语义口径不同,任何读 KV 当 UI 真实状态的代码都是潜在 bug。 (3) 测试 fixture 要看 schema 必填字段:plugins `validateVersion` 必填 6 字段(scope/installPath/version/installedAt/lastUpdated/gitCommitSha),漏 gitCommitSha → listPlugins 返空 → capture 漏项。
- **2026-07-31 v5 D16 撤销顶部「全局搜索」+「选择项目」两个占位组件**:
  - 波 0 在 Header 放了 3 个组件(README 原文「顶部 3 组件」),其中 `GlobalSearchBar.tsx`(17 行)和 `ProjectSelector.tsx`(14 行)都是写死 `disabled` 的空壳,placeholder 文案「(波 1+ 启用)」。波 1/2/3 全做完、v3.0 已发,这俩**从未接上**,文案成了过期承诺。
  - **决定撤销,不实现**。理由:
    1. 会话 Tab 内 `SearchBar` 已有全文搜索(含项目 / 时间筛选),顶部全局搜索功能重叠
    2. 6 模块管理器已各有顶部本地 name 搜索(commit `0b2353c`),跨模块搜索需求未出现
    3. 左侧 `ProjectTree` 已能选项目;顶部再来一个 selector 要么是重复 UI(须状态提升),要么是「全局 active project 过滤」——后者需给 5 个 scanner 加 project 级扫描(现只有 plugins scanner 有 scope 字段),是新一波的量级,收益不明
  - **连带删整条 `global_search` 后端链**(照 D5「0 引用孤儿组件直接 git rm」先例,不留死代码):`repo/search.ts` 的 `globalSearch()` + `GlobalSearchHit` 接口 / `main.ts` handler / `preload.ts` invoke / `global.d.ts` Api 字段 / `src/types.ts` 的 `GlobalSearchHit` / `api.ts` 包装 / `mock.ts` 实现 / `tests/global-search.test.ts`(3 case) / `package.json` 测试列表。**`search.ts` 的 `search()`(会话全文搜索,在用)不动**。测试 150 → 147。
  - **spec §8 整节标作废**,原设计移入 `<details>` 折叠保留作历史。发现 §8.2 的 SQL 引用 `mcp_metadata` / `skill_metadata` / `command_metadata` **三张表从未存在**(实际只有 projects / sessions / messages / watcher_state / mcp_server_state 5 张),按 D15 口径真实 enabled 在 6 scanner 而非 KV 表 —— 这段 SQL 从写下起就不可实现,是 spec 早于实现、后续未回写的典型。
  - **教训**:占位组件必须带「兑现期限」。写死 `disabled` + 「波 N 启用」的空壳,若到期未接,要么接、要么删,不能一直挂着 —— 用户看到灰控件会以为是 bug,而非未实现。下次加占位 UI,宁可**不放**,也不放一个不能点的。
- **2026-07-29 macOS 适配**：`getDataDir()` 已做跨平台：Windows 用 `%APPDATA%`，macOS 用 `~/Library/Application Support`，Linux 用 `$XDG_CONFIG_HOME` 或 `~/.config`。`logFile()` 复用同一函数，不再有独立 fallback 路径。chokidar 需单独 `npm install`（package.json `dependencies` 已有，但 mac 首次 `npm install --ignore-scripts` 后需验证）

- **2026-08-02 v4 D17 Tauri 2 完整迁移 30 commit 序列 commit 11-14 落定**：
  - **commit 11** (Profiles 6 IPC + 6 case): v3.1 D13 + D15 平移到 v4.0 Tauri。types.rs (ProfileSummary / ProfileSnapshot / ProfileModuleItem / ApplyResult / ProfileDiff / RestoreOptions / PROFILE_MODULES 6 key) + capture.rs (走 6 scanner 真实 enabled 全集, CaptureOptions 6 路径全可选) + apply.rs (完整替代语义: MCP settings.json 黑名单 / skills disabled_skills/ 镜像 / commands + agents .md.disabled 后缀 / plugins enabledPlugins[k]=false; plugins + hooks enable 路径需完整 entry 不可重建, 走 skip + real_file_errors) + diff.rs ((module, name) 复合 key 比对) + mod.rs (6 DB 接口 + from_base_dir fixture 工厂) + tests.rs (6 case)。lib.rs 6 IPC handler 注册。profiles 测试钉死 D13/D15 行为: 写真实文件 + reverse-disable + scan 当前 state.
  - **commit 12** (Usage 6 IPC + 6 case): 用量分析只读聚合, 无 schema / state / writer, 全 sessions/messages 表 COUNT/SUM/GROUP BY。types.rs (UsageSummary / ByProject / ByDay / ByTool / SessionCost / SessionTimeline) + scanner.rs (6 聚合函数 + estimate_tokens char/4 粗估 + civil_from_days 手算 YYYY-MM-DD, no chrono dep) + mod.rs + tests.rs。lib.rs 6 IPC handler。byDay 改用 messages.created_at 切 day (v3.1 走 started_at 切分不准确, 同 session 跨天算 day1)。
  - **commit 13** (删 8 ui-smoke 测试): v3.1 electron 时代 JSDOM + window.api 模拟 smoke, v4 Tauri invoke handler 不适, 删 tests/*-ui-smoke.test.ts 8 文件 (24 case) + package.json test script 移除引用。净增 -640 行。
  - **commit 14** (CI Tauri 2 + drop KV 表 + 动态 prod CSP):
    1. **CI 重写** (.github/workflows/build-installers.yml): v3.1 Electron 路径 (package:portable + better-sqlite3 rebuild) 完全不适配 v4.0 Tauri 2。改 cargo-tauri build + Swatinem/rust-cache + dtolnay/rust-toolchain + test:tauri -- --lib + 严格/双平台 artifact (Windows MSI+NSIS / macOS DMG+APP)。macOS 未签名 (D11 v4 起步不签), Gatekeeper 警告 + 右键打开绕过, Developer ID + notarization 留 v4.1+。
    2. **drop mcp_server_state** (豁免 §4 半年原则, D10 + D15 后已无读路径): 真实 enabled = settings.json disabledMcpjsonServers 黑名单 (D10 真停用), Profiles capture 走 6 scanner (D15), 单一来源 = 真实文件 + 6 scanner。db/mod.rs SCHEMA_SQL 删 CREATE TABLE mcp_server_state, 注释重写记录决策链。
    3. **动态 prod CSP** (vite.config.ts + tauri.conf.json): Tauri 2 `app.security.csp` 是 build-time 嵌入 binary, dev/prod 共用 conf 需 null/strict 二选一, HMR ws 会被 strict 拦。改 csp: null (Tauri conf) + vite plugin transformIndexHtml 注入 meta csp (dev 不注 / prod 注)。CSP 字符串 match Tauri 2 default 严格策略 (default-src 'self' + asset://asset.localhost + ipc:// + http://ipc.localhost + data: + 'unsafe-inline' for style)。
  - **附记** (commit 11 顺手修): atomic_write.rs Sample struct 缺 Deserialize derive (commit 1 漏, cargo test 被 Windows Defender 拦从未暴露); db/mod.rs v1/v2 schema 升级测试 mark ignore (v4 真实路径 v4 SCHEMA_SQL 单一来源); util/mod.rs + repo/mod.rs 漏 pub mod 注册 (commit 5-10 写时漏, commit 11 一并 sweep); memory index.json 补登记 commit 11 进度。
  - **教训(共 2 条)**:
    1. 半年原则豁免需要明示理由 (D17: D10 + D15 决策链 + 真实路径全在 settings.json + 6 scanner)。
    2. build-time 配置 (Tauri csp / capability) vs runtime 配置 (前端 meta csp / runtime schema) 选择 — 凡 dev/prod 行为不同者, 走 runtime 而非 build-time, 避免双 conf 文件 / dev 体验破。

- **2026-08-02 v4 D18 mock.ts 残留与 src/ 前端 v3.1→v4.0 集成缺口 (待办, 不在 D17 commit 14 scope)**:
  - **背景**: commit 2 (324a45d) 声称"删 src/mock.ts + src/mock-data.ts", 但 `src/main.tsx` 仍 `import './mock'`, 实际从未删。`npm run build:vite` 当前 fail `Could not resolve "./mock" from "src/main.tsx"`。
  - **影响**: v4.0 build:vite 命令在 src/ 前端不可用 (仅 dev:vite + dev:electron 可), 间接影响 cargo-tauri dev 链路 (虽然 dev 走 devUrl 不需要 build)。CI 跑 `npm run build:tauri` (commit 14 配) 会因 beforeBuildCommand `npm run build:vite` 失败而 fail — 即 v4.0 CI 实际跑不通, 只到 `npm run typecheck` 步骤。
  - **已确认 v4.0 真实状态** (commit 14 末):
    - 后端: cargo test --lib 22 passed + 2 ignored, tauri build cargo check OK
    - 前端 build: 失败, mock cleanup 未做
    - 集成 build: 失败, 同上
    - dev 模式: 未知, 用户未手验 (CLAUDE.md §1 npm run dev:tauri 跨平台可用 假定)
  - **可选路线** (后续 commit 16+ 范围, 不在当前 D17 5 commit 序列):
    - 路线 A (推荐): 删 src/mock.ts + src/mock-data.ts (本就该删), 把 main.tsx 改 走 src/api.ts (v3.1 已有, 调 tauri invoke) — 是 commit 2 漏做的修正。
    - 路线 B: 保留 mock.ts 但改用真 tauri invoke (vite plugin mock-mode 切换, dev 走 mock, prod 走真 invoke) — 复杂度高, 需 vite plugin detect + window.__TAURI__ 判别。
  - **CLAUDE.md §1 例外** (只读视图本地过滤) **不** 适用此条: mock 删 = 改 import 链, 不是只读过滤, 触发了 §1 三层链路检查 (前端→IPC→后端→DB)。需要 v4.1 路线 A commit 完整还原。
  - **教训 (D18)**: commit 2 "删 mock" 是 "类型声明 + 包装 + 路由" 5 处改动的复合 commit, 实际只改了 4 处, 漏 main.tsx import — commit message 写的"删"与实际状态不一致。`git log -p src/main.tsx` 应作为 commit 验证必经步骤, 不只跑 `cargo test` / `npm test`。这是 v4.0 commit 5-14 一系列"未跑通"问题的统一根因: commit message 与代码状态不对齐, 用户 / 后续会话只能靠读 commit history 才知道哪些改完成 / 哪些没改。
  - **D17 commit 11 跑通 cargo test** 暴露了 3 个 commit 1-4 旧 bug (Sample Deserialize 缺、v1/v2 schema test dead code、util/mod.rs 漏注册), 全部 commit 11 顺手 sweep。**D18 才是未暴露的"删 mock 失败" 缺口** — 实际跑 `npm run build:vite` 才会发现, 当前会话只跑 `cargo test` + `npx tsc --noEmit` 不覆盖前端 build 验证。

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
