<div align="center">

# CC Manager

**Claude Code 一站式配置中心** — 9 业务模块 + Profiles + 用量分析,本地桌面工具,数据全本地存储。

[![Version](https://img.shields.io/badge/version-0.3.0-1677ff?style=flat-square)](./package.json)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-1677ff?style=flat-square)](./electron-builder.json)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-147%20%2F%20147%20passing-22c55e?style=flat-square)](./tests)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat-square)](./tsconfig.json)
[![Electron](https://img.shields.io/badge/electron-32-47848F?style=flat-square)](./package.json)

把 Claude Code 的 `~/.claude/` 散落配置(MCP / Skills / Commands / Sub-Agents / Hooks / Plugins)集中管理,Profiles 一键切换,Session 全文搜索,用量仪表盘。
无需登录云端,数据全本地 `better-sqlite3` 存储,Windows 免安装双击即用。

</div>

---

## ✨ 核心特性

| 模块 | 能做什么 | 数据源 |
|---|---|---|
| 📁 **会话** | 浏览 / 搜索 / 软删 / 恢复 / 复制 `claude --resume <id>` 命令 | `~/.claude/projects/<folder>/*.jsonl` |
| 🧩 **MCP** | 看 / 改 / 删 / 启停 全部 MCP server | `~/.claude.json` 的 `mcpServers` |
| 📚 **Skills** | 看 / 改 / 删 / 启停(`~/.claude/skills/` ↔ `disabled_skills/` 镜像目录) | `~/.claude/skills/<name>/SKILL.md` |
| ⚡ **Commands** | 看 / 改 / 删 / 启停(`.md.disabled` 后缀) | `~/.claude/commands/<name>.md` |
| 🤖 **Sub-Agents** | 看 / 改 / 删 / 启停 | `~/.claude/agents/<name>.md` |
| 🪝 **Hooks** | 看 / 改 / 删 / 启停(原子写 settings.json) | `~/.claude/settings.json` 的 `hooks` 字段 |
| 🔌 **Plugins** | 看 / 改 / 删 / 启停(严格 schema 校验) | `~/.claude/plugins/<name>/plugin.json` |
| 🎛️ **Profiles** | 命名快照 + 一键 apply(失败回滚) + 完整替代语义 | `~/.claude/profiles.json` |
| 📊 **用量分析** | 按日 / 按项目 / 按工具聚合 token + 消息数 + 时长 | sessions / messages 聚合 SQL |

**工程亮点**

- 🔒 **原子写** — JSON 配置 tmp + rename,失败 catch 还原原文件(D7 决策)
- 👀 **chokidar 5 事件驱动 watcher** — 文件变化自动刷新 UI,`usePolling: false`,无 polling
- 🎯 **真停用语义** — toggle 写真实 `settings.json` / 镜像目录 / `.disabled` 后缀,不是 KV cache(D10 决策)
- 🧪 **147 测试 case / 0 typecheck 错误** — `node:test` + `ELECTRON_RUN_AS_NODE=1 electron`

---

## 📥 下载

前往 [**Releases 页面**](https://github.com/Freedom0x0/cc-manager/releases) 下载最新版本:

| 版本 | 文件 | 大小 | 说明 |
|---|---|---|---|
| **v0.3.0**(最新) | `CC Manager-0.3.0-portable.exe` | ~80 MB | 免安装,Windows 10/11 64-bit,首次启动自动扫描 `~/.claude/projects/` |
| v0.2.0 | `CC Manager-0.2.0-portable.exe` | ~80 MB | MCP / Skills / Commands 3 模块 |
| v0.1.0 | `CC Manager-0.1.0-portable.exe` | ~80 MB | 骨架版本(8 占位模块) |

> 📌 **macOS 用户**:v3.1 装包配置已就绪(arm64 + x64,DMG + ZIP),但**真机未验证**。当前推荐 `npm run dev` 开发模式;`dmg` 装包支持延后到 v4.0(详见下方"开发者"章节)。

---

## 🚀 快速开始(Windows 用户)

1. 下载 `CC Manager-0.3.0-portable.exe`
2. 放到任意目录(比如 `D:\Tools\`)
3. 双击运行

**首次启动**自动完成:
- 创建数据文件 `%APPDATA%\cc-session-manager\app.db`
- 扫描 `C:\Users\<你>\.claude\projects\` 把所有 session 入库
- chokidar watcher 启动,后续文件变化自动刷新 UI
- 9 Tab 导航:会话 / MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析

---

## 🖼️ 截图

> **Screenshot coming soon** — 6 张占位截图待补充。
> 原截图目录 `docs/screenshots/` 含 6 张自动生成的图(初始加载 / 项目选择 / 会话查看 / 搜索 / 回收站 / 软删确认),由 `npx tsx scripts/screenshot.ts` 生成。下一次发版前会重新截并替换到 README。

---

## 🏗️ 架构

### 三层链路(全栈修改必须同步走完)

```
[React 组件]
    ↓ 调用
[src/api.ts] → [window.api] → [preload.ts]
                                  ↓ IPC channel
                            [main.ts handler]
                                  ↓ 调用
                            [repo/<module>/*.ts]   ← pure DB / 文件读写
                                  ↓
                          [better-sqlite3 + FTS5]
```

> 改任何一环之前,**先把整条链在脑子里过一遍**。漏一环 = 编译错或运行时崩。新增 IPC 必须 7 个文件全改(repo + handler + preload + global.d.ts + api.ts + mock.ts + 调用方)。详见 `CLAUDE.md` §3。

### 模块化目录(v2+ 沿用)

```
cc-manager/
├── electron/
│   ├── main.ts                          # initDB → startWatcher → IPC 注册
│   ├── watcher.ts                       # chokidar 5 事件驱动 + dynamic import
│   ├── db/connection.ts                 # schema + 兼容 ALTER
│   ├── resumer.ts                       # 生成 claude --resume 命令字符串
│   └── repo/
│       ├── _template/                   # 4 文件 + README(业务模块 cp -r)
│       ├── mcp/                         # v2.0
│       ├── skills/                      # v2.0(镜像目录方案)
│       ├── commands/                    # v2.0(.md.disabled 后缀)
│       ├── sub-agents/                  # v2.1
│       ├── hooks/                       # v2.1(原子写 settings.json)
│       ├── plugins/                     # v2.1(严格 schema 校验)
│       ├── profiles/                    # v3.0(命名快照 + 事务化 apply)
│       ├── usage/                       # v3.0(只读聚合 SQL)
│       ├── watcher-state.ts             # 3 列 KV 模型(D1 决策)
│       └── projects/sessions/messages/search/tree.ts
├── src/
│   ├── App.tsx (99 行)                  # 9 Tab 导航壳子(D4 决策)
│   ├── components/                      # 共享组件
│   ├── modules/
│   │   ├── sessions/                    # 9 components + SessionsModule 入口
│   │   ├── mcp/skills/commands/sub_agents/hooks/plugins/
│   │   ├── profiles/ProfileManager.tsx        # v3.0
│   │   └── analytics/AnalyticsModule.tsx      # v3.0
│   └── api.ts / types.ts / mock.ts / global.d.ts
├── tests/                               # 147 case / 13 文件
├── docs/superpowers/specs/              # 设计 spec(2026-07-28 系列)
└── electron-builder.json                # NSIS + Portable + DMG 配置
```

### IPC 累计 63 个

| 来源 | 数量 | 备注 |
|---|---|---|
| 基线 (v1+) | 13 | `list_sessions` / `list_project_tree` / 搜索 / 树 / resumer 等 |
| watcher (v5) | 2 | `watcher_rescan_all` + `watcher_get_status` |
| wave-1 业务模块 | 18 | MCP / Skills / Commands 各 6 |
| wave-2 业务模块 | 18 | Sub-Agents / Hooks / 插件 各 6 |
| wave-3 业务模块 | 12 | Profiles / 用量分析 各 6 |

---

## 🎯 关键设计决策

完整决策记录见 [`CLAUDE.md` §13](./CLAUDE.md)。以下是影响用户使用行为的关键决策:

| ID | 决策 | 影响 |
|---|---|---|
| **D1** | watcher_state 走 3 列 KV 模型 | Simplicity First,故意偏离 5 列模板 |
| **D6** | enabled 状态不复用原文件 | toggle 走 KV 表,不污染 `~/.claude.json` / SKILL.md |
| **D7** | settings.json / plugin.json 走原子写 | tmp + rename,失败 catch unlink + 保留原文件 |
| **D10** | 真停用 = 写真实文件 | KV 表只作 cache;plugins 写 `enabledPlugins`,MCP 写 `disabledMcpjsonServers`,skills 用镜像目录,commands/agents 用 `.md.disabled` 后缀 |
| **D12** | skills 改用镜像目录方案 | 修 D11 `.disabled` 后缀方案"UI 看不到停用项"的对称性 bug |
| **D13** | applyProfile 走完整替代语义 | profile 应用是完整快照,非"只保 enabled,其他不动" |
| **D15** | captureProfileFromState 走 6 scanner | 修 KV 表"漏掉未 toggle 的默认 enabled 项"的对账 bug |
| **v5** | Windows 优先 | v2.0 / v2.1 / v3.0 三波全部产 Windows installer,macOS 适配延后到 v4.0 |

---

## 🛠️ 开发者

### 环境要求

- **Node.js 22+**(`ELECTRON_RUN_AS_NODE=1 electron` 跑测试,避免 better-sqlite3 ABI 不匹配)
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

### 跑测试

```bash
npm test         # 147 个 case(必须用 ELECTRON_RUN_AS_NODE,已配在 scripts.test)
```

### 类型检查

```bash
npm run typecheck   # electron + renderer 都检查,要求 0 errors
```

### 打包

```bash
npm run package              # 出 NSIS + Portable 双产物(到 release/)
npm run package:portable     # 只出 Portable(~80 MB)
npm run package:mac          # 出 macOS DMG + ZIP(arm64 + x64,未签名)
```

---

## 🔧 已知限制

- ⚠️ **macOS 装包未签名** — `.dmg` 在 v4.0 规划中(Apple 签名 / notarization);开发模式(`npm run dev`)完全可用
- ⚠️ **macOS 首次安装需手动重编 better-sqlite3** — 见上方「macOS 开发指南」
- ⚠️ **chokidar 5 pure ESM** — Electron 主进程 CJS 需 `await import('chokidar')` + tsconfig `module: NodeNext`
- ⚠️ **frontmatter 解析简化** — Skills / Commands / Sub-Agents 用正则手 parse,只支持 `key: value` 单行(YAML 复杂特性不支持)
- ⚠️ **continue session** — 返回 `claude --resume <id>` 命令字符串让用户复制到终端执行,**不**在应用里直接 spawn
- ⚠️ **scanner 排序不在 repo 层** — UI 组件内 `localeCompare(name)` 一处搞定,真 IPC 和 mock 走同一路径

---

## 🐛 反馈

- [GitHub Issues](https://github.com/Freedom0x0/cc-manager/issues) — 报 bug / 提需求
- 项目宪法:见 [`CLAUDE.md`](./CLAUDE.md)(根目录)
- 设计 spec:见 `docs/superpowers/specs/`
- 决策记录:见 [`CLAUDE.md` §13](./CLAUDE.md)

## 📜 许可证

[MIT](./LICENSE) © 2026 Freedom0x0

## 🙏 致谢

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic 的 CLI 工具
- [antd](https://ant.design/) — UI 组件库
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 同步 SQLite 绑定
- [chokidar](https://github.com/paulmillr/chokidar) — 文件监听
- [electron-builder](https://www.electron.build/) — 打包工具

---

<div align="center">

Made with ❤️ for Claude Code users · v0.3.0 / 2026-07-31

</div>