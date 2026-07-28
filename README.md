# CC Manager

> 本地管理 Claude Code 会话历史：查看、搜索、继续会话

一款跨平台桌面工具，自动接管 `~/.claude/projects/` 下所有会话，提供比 `cc_switch` 更强的搜索和分类能力，无需登录云端。支持 **macOS / Windows / Linux**。

## ✨ 特性

- 📁 **自动扫描**：`~/.claude/projects/` 下所有 folder，每个 folder 视为一个项目
- 🔍 **毫秒级全文搜索** — 基于 SQLite FTS5（unicode61 中文友好）
- 🗑️ **软删除 + 回收站** — 误删可恢复
- 📋 **继续会话一键复制** — 返回 `claude --resume <id>` 命令字符串，粘贴到终端执行
- 🎨 **Ant Design UI** — 现代化交互，主题蓝色 `#2563eb`
- 💾 **本地存储** — 所有数据存 `better-sqlite3` 库，无云端依赖

## 📥 下载

前往 [Releases 页面](https://github.com/Freedom0x0/cc-manager/releases)下载最新版本：

### macOS

| 文件 | 说明 |
|---|---|
| `CC Manager-0.1.0-mac-arm64.dmg` | Apple Silicon（M 系列芯片）安装包 |
| `CC Manager-0.1.0-mac-x64.dmg` | Intel Mac 安装包 |

> 首次启动若提示"无法验证开发者"，右键 → 打开 即可。

### Windows

| 文件 | 说明 |
|---|---|
| `CC Manager-0.1.0-x64.exe` | NSIS 安装器（传统 Next 安装流程）|
| `CC Manager-0.1.0-portable.exe` | 免安装绿色版，双击即用 |

## 🚀 快速开始

### macOS

1. 下载对应芯片的 `.dmg`
2. 双击挂载 → 把 CC Manager 拖到 Applications
3. 启动 → 首次自动扫描 `~/.claude/projects/` 并入库

### Windows

1. 下载 `CC Manager-0.1.0-x64.exe`
2. 双击安装 → 选目录 → 完成
3. 桌面双击 "CC Manager" 图标启动

首次启动会自动：
- 创建应用数据库（路径见下表）
- 扫描 `~/.claude/projects/` 把所有 session 入库
- 显示项目栏（左）、会话列表（中）、消息视图（右）

### 数据目录

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/cc-session-manager/` |
| Windows | `%APPDATA%\cc-session-manager\` |
| Linux | `~/.config/cc-session-manager/` |

## 🛠️ 开发者

### 环境要求

- Node.js 22+（用 `ELECTRON_RUN_AS_NODE` 跑测试，避免 better-sqlite3 ABI 不匹配）
- npm 9+
- macOS / Windows / Linux 均支持

### 开发模式

```bash
git clone https://github.com/Freedom0x0/cc-manager.git
cd cc-manager
npm install --ignore-scripts        # 跳过 native 编译（避免 node-gyp ABI 不匹配）
node node_modules/electron/install.js   # 下载 Electron 二进制

# 编译 better-sqlite3（Electron ABI，在 node_modules/better-sqlite3/ 目录下执行）
# macOS Apple Silicon：
HOME=~/.electron-gyp node_modules/.bin/node-gyp rebuild \
  --target=$(cat node_modules/electron/dist/version) \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers \
  --module-name=better_sqlite3 \
  --module-path=build/Release
# macOS Intel 改 --arch=x64

npm run dev      # 同时启 Vite(5173) + Electron
```

### 跑测试

```bash
npm test         # 30 个 case，必须用 ELECTRON_RUN_AS_NODE
```

### 类型检查

```bash
npm run typecheck   # electron + renderer 都检查
```

### 打包

```bash
npm run package:mac          # macOS DMG + ZIP（arm64 + x64，输出到 release/）
npm run package:win          # Windows NSIS + Portable
npm run package              # 当前平台默认目标
```

> **macOS 打包**：需要安装 Xcode Command Line Tools（`xcode-select --install`）。如需代码签名，配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 环境变量。

## 🏗️ 架构

```
[React 组件] → [src/api.ts 包装] → [window.api] → [preload.ts]
                                              ↓
                                       [IPC channel]
                                              ↓
[main.ts handler] → [repo 函数] → [better-sqlite3 + FTS5]
```

每加一个功能，**7 个文件都改**（`types.ts` / `global.d.ts` / `mock.ts` / `main.ts` / `preload.ts` / `api.ts` / 组件）。漏一个 = 编译错或运行时崩。

### 项目结构

```
cc-manager/
├── electron/                       # Node 后端
│   ├── main.ts                     # Electron 主进程 + IPC 注册
│   ├── preload.ts                  # contextBridge 暴露 window.api
│   ├── db/connection.ts            # schema + 兼容 ALTER
│   ├── importer/{scanner,parser,index,migrate}.ts
│   ├── repo/{projects,sessions,messages,search,tree,types}.ts
│   └── resumer.ts                  # 生成 claude --resume 命令
├── src/                            # React 渲染进程
│   ├── main.tsx / App.tsx
│   ├── components/                 # 7 个 antd 组件
│   ├── hooks/useSearch.ts
│   ├── api.ts / types.ts / mock.ts / mock-data.ts
│   └── global.d.ts                 # window.api 类型
├── tests/                          # 30 个 node --test case
├── docs/superpowers/specs/         # 设计 spec
├── build/                          # electron-builder 资源（icon, LICENSE）
├── electron-builder.json           # macOS + Windows 打包配置
└── package.json
```

## 🔧 已知限制

- ⚠️ **数据迁移**：v1 → v4 升级时老库 cwd-style 假 project 会自动归档（`is_archived=1`），不显示
- ⚠️ **继续会话**：返回命令字符串让用户复制到终端执行，**不**在应用里直接 spawn（避免进程生命周期问题）

## 🐛 反馈

- [GitHub Issues](https://github.com/Freedom0x0/cc-manager/issues) — 报 bug / 提需求
- 已知问题 + 解决方案：见 `CLAUDE.md`（项目根目录）

## 📜 许可证

[MIT](./LICENSE) © 2026 Freedom0x0

## 🙏 致谢

- [Claude Code](https://code.claude.com/docs/en/overview) — Anthropic 的 AI 编程工具，本项目读取它的 session 存储
- [cc-switch-cli](https://github.com/SaladDay/cc-switch-cli) — 灵感来源（本项目解决它的搜索弱问题）
- [Ant Design](https://ant.design/) — UI 组件库
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 同步 SQLite 绑定
- [electron-builder](https://www.electron.build/) — 打包工具

---

<p align="center">
  Made with ❤️ for Claude Code users
</p>
