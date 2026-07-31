# CC Manager

> **Claude Code 一站式配置中心** — 管理 MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析,本地桌面工具(Windows installer / macOS 开发模式)

一款本地桌面工具,把 Claude Code 的 `~/.claude/` 散落配置(MCP server、Skills、Commands、Sub-Agents、Hooks、插件)集中管理 + Profiles 切换 + 用量分析仪表盘。无需登录云端,数据全本地 `better-sqlite3` 存储。

> **平台说明**:Windows 提供打包好的 `.exe` 直接下载；macOS 目前支持**开发模式**(`npm run dev`),打包版(`.dmg`)在 v4.0 规划中。

## 🤝 v3.1 真停用待验证(欢迎帮验)

2026-07-30 推 v3.1 真停用(8 commit + 1 docs commit = 9 commit):
- 6 模块 toggle 写真实文件(settings.json / .disabled 后缀 / .md.disabled)
- 启动时一次性 KV → 真实文件迁移
- profiles 修正 KV prefix bug

**Plugins 模块的真停用**基于"settings.json.enabledPlugins[<fullName>] = false"的推断,**未真机验证 Claude Code 是否真的不加载该 plugin**。需要 Windows + Claude Code 环境(已装至少 1 个 plugin) 跑下面 7 步验:

1. **Clone v3.1 分支**:
   ```bash
   git clone -b mac-adapter-2026-07-30 https://github.com/Freedom0x0/cc-manager.git
   cd cc-manager
   ```
2. **装 deps** (Windows): `npm install && npm run rebuild:sqlite`
3. **测试**: `npm test` — 期望 `143/143` 全绿
4. **构建 Windows 测试版**: `npm run package:portable` → 产物 `release/CC Manager-0.3.0-portable.exe`
5. **跑应用 + 找 1 个已装 plugin** (建议用 `playwright@claude-plugins-official` 或其它本机已装的)
6. **点 toggle 关闭** → 检查:
   - `~/.claude/settings.json` 出现 `enabledPlugins["<fullName>"]: false` (写盘验证)
   - **关闭 Claude Code 重启** → 跑 `claude /plugin list` 或观察 `claude` 启动日志
   - 验证该 plugin **是否真的不加载** ⚠️ **这是关键证据**
7. **回填**: 验证结果(真/假 + 任何异常)开 issue 或 PR 评论,标 `v3.1-verification`

**mac 贡献者额外跑**: README §macOS 真机验证 checklist 7 步(含 `npm run package:mac` 出 DMG + Gatekeeper 流程)。

**未验证时**: 不要 merge PR `mac-adapter-2026-07-30` 到 main(branch 留作 v3.1 docs 草稿,等验证结果)。

## ✨ 特性

### 核心
- 📁 **自动扫描** `~/.claude/projects/` 下所有 folder,每个 folder 视为一个项目(基线 v1-v4 沿用)
- 🔍 **毫秒级全文搜索** — SQLite FTS5(unicode61 中文友好)
- 🗑️ **软删除 + 回收站** — 误删可恢复
- 📋 **继续会话一键复制** — 返回 `claude --resume <id>` 命令字符串,你粘贴到终端执行

### v2.0+ 业务模块
- 🧩 **6 业务模块 UI**(看 / 改 / 删 / 启停)
  - **MCP** — 扫 `~/.claude.json` 的 `mcpServers`
  - **Skills** — 扫 `~/.claude/skills/<name>/SKILL.md`
  - **Commands** — 扫 `~/.claude/commands/<name>.md`
  - **Sub-Agents** — 扫 `~/.claude/agents/<name>.md`
  - **Hooks** — 改 `~/.claude/settings.json` 的 `hooks` 字段(原子写)
  - **插件** — 扫 `~/.claude/plugins/<name>/plugin.json`(严格 schema)
- 🔌 **chokidar 5 事件驱动 watcher** — 文件变化自动刷新 UI,无 polling
- 🎛️ **Profiles 切换**(v3.0) — 命名快照 + 一键恢复整个 enabled 状态
- 📊 **用量分析仪表盘**(v3.0) — 按日 / 按项目 / 按工具的 token / 消息 / 时长聚合 SQL

### 工程
- 🏗️ **模块化目录** — `electron/repo/<module>/` + `src/modules/<module>/`(D3 决策)
- 🔒 **原子写** — JSON 配置 tmp + rename,失败 catch 还原(D7 决策)
- 🧪 **109 测试 case / 0 typecheck 错误**
- 💾 **enabled 状态走 KV 表** — 不污染原文件,统一 6 业务模块共用一张表(D6/D9 决策)

## 📥 下载

### Windows

前往 [Releases 页面](https://github.com/Freedom0x0/cc-manager/releases)下载最新 portable:

| 版本 | 文件 | 大小 | 包含 |
|---|---|---|---|
| v0.3.0 | `CC Manager-0.3.0-portable.exe` | ~80 MB | 完整版(8 业务模块 + Profiles + 用量分析 + 3 IPC + watch) |
| v0.2.0 | `CC Manager-0.2.0-portable.exe` | ~80 MB | MCP / Skills / Commands 3 模块 |
| v0.1.0 | `CC Manager-0.1.0-portable.exe` | ~80 MB | 骨架(8 占位模块) |

> Windows 10/11 64-bit,免安装,双击即用。首次启动自动扫描 `C:\Users\<你>\.claude\projects\` 并入库。

### macOS

macOS 装包配置(`electron-builder.json` mac target = `dmg` + `zip`,arm64 + x64 双架构)在 v3.1 已就绪,**待 mac 真机验证**。当前可用方式:

**A. 开发模式**(`npm run dev`,无需装包):

```bash
git clone https://github.com/Freedom0x0/cc-manager.git
cd cc-manager
# macOS 首次需要用 Electron headers 编译 better-sqlite3(见下方"macOS 开发指南")
npm install --ignore-scripts
node node_modules/electron/install.js
npm run rebuild:sqlite     # 若不兼容见下方手动步骤
npm run dev
```

**B. 装包**(`npm run package:mac`,需 macOS + Xcode Command Line Tools):

```bash
npm install --ignore-scripts
node node_modules/electron/install.js
npm run rebuild:sqlite
npm run package:mac
# 产物:release/CC Manager-0.3.0-mac-{arm64,x64}.{dmg,zip}
```

> **未签名策略**(CLAUDE.md §13 D11 决策):v3.1 mac 装包不签名。Gatekeeper 会拦截,需**右键打开**(`Open With → Open`)首次允许即可。Developer ID / notarization 留到 v4.0。

> 数据文件路径:`~/Library/Application Support/cc-session-manager/app.db`

## 🚀 快速开始

1. 下载 `CC Manager-0.3.0-portable.exe`
2. 放到任意目录(比如 `D:\Tools\`)
3. 双击运行

首次启动自动:
- Windows 创建 `%APPDATA%\cc-session-manager\app.db`
- macOS 创建 `~/Library/Application Support/cc-session-manager/app.db`
- 扫描 `~/.claude/projects/` 把所有 session 入库
- 顶部 3 组件:全局搜索 / 项目选择 / Watcher 状态
- 左侧 9 Tab:会话 / MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析

## 🧩 9 Tab 业务模块

| Tab | 状态 | 读取 | 编辑 |
|---|---|---|---|
| **会话**(Sessions) | ✅ 真实 | `~/.claude/projects/<folder>/*.jsonl` | 看消息 / 搜 / 删 / 恢复 / 复制 resume 命令 |
| **MCP** | ✅ 真实 | `~/.claude.json` mcpServers | 看 / 改 / 删 / 启停 |
| **Skills** | ✅ 真实 | `~/.claude/skills/<name>/SKILL.md` | 看 / 改 / 删 / 启停 |
| **Commands** | ✅ 真实 | `~/.claude/commands/<name>.md` | 看 / 改 / 删 / 启停 |
| **Sub-Agents** | ✅ 真实 | `~/.claude/agents/<name>.md` | 看 / 改 / 删 / 启停 |
| **Hooks** | ✅ 真实 | `~/.claude/settings.json` hooks 字段 | 看 / 改 / 删 / 启停(原子写) |
| **插件** | ✅ 真实 | `~/.claude/plugins/<name>/plugin.json` | 看 / 改 / 删 / 启停(严格 schema 校验) |
| **Profiles** | ✅ 真实 | `~/.claude/profiles.json` | 命名快照 + 一键 apply + 启用事务化(失败回滚) |
| **用量分析** | ✅ 真实 | sessions / messages 聚合 | 按日 / 按项目 / 按工具的 token + 消息数 + 时长 |

## 🏗️ 架构

### 三层链路(基线 v1+ 沿用)
```
[React 组件] → [src/api.ts] → [window.api] → [preload.ts]
                                           ↓
                                    [IPC channel]
                                           ↓
[main.ts handler] → [repo 函数] → [better-sqlite3 + FTS5]
```

### 模块化目录(v2+ 沿用)
```
cc-manager/
├── electron/
│   ├── main.ts                     # initDB → startWatcher → IPC 注册
│   ├── watcher.ts                  # chokidar 5 事件驱动 + dynamic import
│   ├── db/connection.ts            # schema + 兼容 ALTER
│   ├── repo/
│   │   ├── _template/              # 4 文件 + README(波 1+ 业务模块 cp -r)
│   │   ├── mcp/                    # v2.0
│   │   ├── skills/                 # v2.0
│   │   ├── commands/               # v2.0
│   │   ├── sub-agents/             # v2.1
│   │   ├── hooks/                  # v2.1(原子写 settings.json)
│   │   ├── plugins/                # v2.1(严格 schema 校验)
│   │   ├── profiles/               # v3.0(命名快照 + 事务化 apply)
│   │   ├── usage/                  # v3.0(只读聚合 SQL)
│   │   ├── watcher-state.ts        # 4 prepared statement(D1 决策 3 列 KV)
│   │   └── projects/sessions/messages/search/tree.ts
│   └── resumer.ts                  # 生成 claude --resume 命令
├── src/
│   ├── App.tsx (99 行)             # 9 Tab 导航壳子(D4 决策)
│   ├── components/                 # 3 Header 占位 + ComingSoon
│   ├── modules/
│   │   ├── sessions/               # 9 components + SessionsModule 入口
│   │   ├── mcp/McpManager.tsx      # v2.0 实装
│   │   ├── skills/SkillsManager.tsx
│   │   ├── commands/CommandsManager.tsx
│   │   ├── sub_agents/SubAgentsManager.tsx # v2.1
│   │   ├── hooks/HooksManager.tsx
│   │   ├── plugins/PluginsManager.tsx
│   │   ├── profiles/ProfileManager.tsx   # v3.0
│   │   └── analytics/AnalyticsModule.tsx # v3.0
│   └── api.ts / types.ts / mock.ts / global.d.ts
├── tests/                          # 109 case / 13 文件
├── docs/superpowers/specs/         # 设计 spec
└── electron-builder.json           # NSIS + Portable 配置
```

### IPC 累计 61 个

| 来源 | 数量 | 备注 |
|---|---|---|
| 基线 (v1+) | 13 | list/list_project_tree/list_sessions 等 |
| watcher (v5) | 3 | global_search + watcher_rescan_all + watcher_get_status |
| wave-1 业务模块 | 18 | MCP / Skills / Commands 各 6 |
| wave-2 业务模块 | 18 | Sub-Agents / Hooks / 插件 各 6 |
| wave-3 业务模块 | 12 | Profiles / 用量分析 各 6 |

### 关键决策(CLAUDE.md §13)

- **D1**:watcher_state 3 列 KV 模型(Simplicity First)
- **D2**:chokidar 5.0.0 ABI 兼容 Electron 32 + Node 22,`usePolling: false` 显式声明
- **D3**:模块化目录 = `src/modules/` + `electron/repo/<module>/`
- **D4**:App.tsx 改导航壳子,业务下放 modules/(248 → 99 行)
- **D5**:`ProjectList.tsx` 删(全代码库 0 引用,违反"不留死代码")
- **D6**:enabled 状态走 KV 表(不复用原文件,避免污染)
- **D7**:settings.json / plugin.json 原子写(tmp + rename)
- **D8**:跨平台代码用 `process.platform` + `os.homedir()`(OS 中性)
- **D9**:6 模块 enabled 状态统一走 `mcp_server_state` 表(D6 延伸)

## 🛠️ 开发者

### 环境要求

- **Node.js 22+**(用 `ELECTRON_RUN_AS_NODE=1 electron` 跑测试,避免 better-sqlite3 ABI 不匹配)
- npm 9+
- **Windows 10/11 64-bit**(打包产物目标平台) 或 **macOS 12+**(开发模式可用)
- TypeScript 5+ / Electron 32 / better-sqlite3 11 / chokidar 5 / antd 6

### Windows 开发模式

```bash
git clone https://github.com/Freedom0x0/cc-manager.git
cd cc-manager
npm install
npm run dev      # 同时启 Vite(5173) + Electron
```

### macOS 开发指南

macOS 系统 Node.js 版本与 Electron 内置 Node ABI 不同,`npm install` 时 `better-sqlite3` 的 node-gyp 编译会失败。正确流程:

```bash
git clone https://github.com/Freedom0x0/cc-manager.git
cd cc-manager

# 1. 跳过 native 编译,只装 JS 包
npm install --ignore-scripts

# 2. 下载 Electron 二进制
node node_modules/electron/install.js

# 3a. 用封装脚本重编 better-sqlite3(优先)
npm run rebuild:sqlite

# 3b. 若 3a 不兼容(Node v26+ 下 electron-rebuild 可能失败),手动重编:
cd node_modules/better-sqlite3
HOME=~/.electron-gyp node_modules/.bin/node-gyp rebuild \
  --target=$(cat ../../node_modules/electron/dist/version) \
  --arch=arm64 \          # Intel Mac 改为 x64
  --dist-url=https://electronjs.org/headers \
  --module-name=better_sqlite3 \
  --module-path=build/Release
cd ../..

# 4. 启动
npm run dev
```

**数据文件路径**(macOS): `~/Library/Application Support/cc-session-manager/app.db`  
**日志路径**(macOS): `~/Library/Application Support/cc-session-manager/app.log`

> **未签名 mac 装包**(CLAUDE.md §13 D11 决策):首次双击 `.dmg` 时 Gatekeeper 会拦截,需**右键 → 打开**(或在「系统设置 → 隐私与安全性」点击「仍要打开」)。Developer ID 签名 + Apple notarization 留到 v4.0。

### macOS 真机验证 checklist(待 mac 贡献者)

> 以下步骤在 v3.1 配置就绪后,**未在 mac 机器上跑过**。欢迎有 mac 的贡献者按此跑一遍回填结果:

1. **环境**: macOS 12+,Xcode Command Line Tools (`xcode-select --install`)
2. **clone + 编译**: `npm install --ignore-scripts && node node_modules/electron/install.js && npm run rebuild:sqlite`
3. **测试**: `npm test` — 期望 `143/143` 全绿
4. **dev 模式**: `npm run dev` — 启应用,确认 6 模块 toggle 真实文件变化:
   - MCP / 插件 / Hooks: `~/.claude/settings.json` 改
   - Skills: `~/.claude/skills/<name>/` ↔ `<name>.disabled/`
   - Commands/Sub-Agents: `<name>.md` ↔ `<name>.md.disabled`
5. **装包**: `npm run package:mac` — 出 `.dmg` + `.zip` (arm64 + x64)
6. **Gatekeeper**: 双击 `.dmg` → 右键 → 打开 → 验证首次运行 Gatekeeper 警告流程
7. **回填**: 把跑测结果贴到 PR 评论或 issue,有问题开新 issue

### 跑测试

```bash
npm test         # 143 个 case
                 # 必须用 ELECTRON_RUN_AS_NODE(已配在 scripts.test)
```

### 类型检查

```bash
npm run typecheck   # electron + renderer 都检查,要求 0 errors
```

### 打包

```bash
npm run package              # 出 NSIS + Portable 双产物(到 release/)
npm run package:portable     # 只出 Portable(80 MB 左右)
```

### 推送(SSH 协议)

> 本机 443 端口被 ISP 挡,推 GitHub 用 SSH 22 端口。

```bash
git remote set-url origin git@github.com:Freedom0x0/cc-manager.git
git push origin main --tags
```

## 🔧 已知限制

- ⚠️ **macOS 无打包版** — `.dmg` 在 v4.0 规划中(Apple 签名 / notarization);开发模式(`npm run dev`)完全可用
- ⚠️ **macOS 首次安装需手动重编 better-sqlite3** — 见上方"macOS 开发指南"
- ⚠️ **chokidar 5 pure ESM** — Electron 主进程 CJS 需 `await import('chokidar')` + tsconfig `module: NodeNext`
- ⚠️ **enabled KV 表名 `mcp_server_state`** — 表名 6 模块复用,key 前缀区分(`mcp:` / `skill:` / `cmd:` / `agent:` / `hook:` / `plugin:`)
- ⚠️ **frontmatter 解析简化** — Skills / Commands / Sub-Agents 用正则手 parse,只支持 `key: value` 单行(YAML 复杂特性不支持)
- ⚠️ **continue session** — 返回命令字符串让用户复制到终端执行,**不**在应用里直接 spawn

## 🐛 反馈

- [GitHub Issues](https://github.com/Freedom0x0/cc-manager/issues) — 报 bug / 提需求
- 项目宪法:见 `CLAUDE.md`(根目录)
- 决策记录:见 `CLAUDE.md` §13

## 📜 许可证

[MIT](./LICENSE) © 2026 Freedom0x0

## 🙏 致谢

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic 的 CLI 工具
- [antd](https://ant.design/) — UI 组件库
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 同步 SQLite 绑定
- [chokidar](https://github.com/paulmillr/chokidar) — 文件监听
- [electron-builder](https://www.electron.build/) — 打包工具

---

<p align="center">
  Made with ❤️ for Claude Code users · v0.3.0 / 2026-07-29
</p>
