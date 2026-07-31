<div align="center">

# CC Manager

**Claude Code 一站式配置中心** — 把散落在 `~/.claude/` 里的 MCP / Skills / Commands / Sub-Agents / Hooks / Plugins 集中管理,再加会话搜索、Profile 切换、用量仪表盘。

[![Version](https://img.shields.io/badge/version-0.3.0-1677ff?style=flat-square)](./package.json)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-1677ff?style=flat-square)](./electron-builder.json)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Electron](https://img.shields.io/badge/electron-32-47848F?style=flat-square)](./package.json)

**所有数据存在本地 SQLite,不联网。** Windows 10/11 64-bit 免安装双击即用；macOS Apple Silicon / Intel 均有 `.dmg` 安装包。

</div>

---

## ✨ CC Manager 能做什么

| 模块 | 能做什么 | 数据源 |
|---|---|---|
| 📁 **会话** | 浏览 / 搜索 / 软删 / 恢复 / 复制 `claude --resume <id>` 命令到终端 | `~/.claude/projects/<folder>/*.jsonl` |
| 🧩 **MCP** | 看 / 改 / 删 / 启停 全部 MCP server | `~/.claude.json` |
| 📚 **Skills** | 看 / 改 / 删 / 启停 | `~/.claude/skills/` |
| ⚡ **Commands** | 看 / 改 / 删 / 启停 | `~/.claude/commands/` |
| 🤖 **Sub-Agents** | 看 / 改 / 删 / 启停 | `~/.claude/agents/` |
| 🪝 **Hooks** | 看 / 改 / 删 / 启停 | `~/.claude/settings.json` 的 `hooks` 字段 |
| 🔌 **Plugins** | 看 / 改 / 删 / 启停 | `~/.claude/plugins/` |
| 🎛️ **Profiles** | 给当前所有启用状态拍快照,一键还原 | `~/.claude/profiles.json` |
| 📊 **用量分析** | 按日 / 按项目 / 按工具看 token 消耗和消息数 | sessions / messages 聚合 |

**为什么需要这个工具?** Claude Code 的配置散落在 `~/.claude/` 的 5-6 个目录里,要查某个 Skill 是否启用、要临时停用某个 Hook,都得切目录找文件。CC Manager 把这些集中到 9 个 Tab,**开关一次点击,真停用**(写回真实文件,不是临时屏蔽),还能 Profile 整套切换。

---

## 📥 下载

前往 [**Releases 页面**](https://github.com/Freedom0x0/cc-manager/releases) 下载最新版本:

### Windows

| 版本 | 文件 | 大小 | 说明 |
|---|---|---|---|
| **v0.3.0**(最新) | `CC Manager-0.3.0-portable.exe` | ~80 MB | 免安装,双击运行 |
| v0.2.0 | `CC Manager-0.2.0-portable.exe` | ~80 MB | 免安装,双击运行 |
| v0.1.0 | `CC Manager-0.1.0-portable.exe` | ~80 MB | 免安装,双击运行 |

> 数据文件位置: `%APPDATA%\cc-session-manager\app.db`

### macOS

| 文件 | 架构 | 大小 | 适用机型 |
|---|---|---|---|
| `CC Manager-0.3.0-mac-arm64.dmg` | Apple Silicon (arm64) | ~114 MB | M1 / M2 / M3 / M4 |
| `CC Manager-0.3.0-mac-x64.dmg` | Intel (x64) | ~119 MB | Intel MacBook / iMac |

> 数据文件位置: `~/Library/Application Support/cc-session-manager/app.db`

⚠️ **未签名应用** — 首次打开时 macOS Gatekeeper 会拦截,需要:
1. 右键点击应用 → **打开** → 仍要打开;或
2. 终端执行: `xattr -cr "/Applications/CC Manager.app"`

> Apple 签名(notarization)将在后续版本加入。

---

## 🚀 快速开始

1. 下载对应平台的安装包
   - **Windows**: `CC Manager-0.3.0-portable.exe`
   - **macOS (M1/M2/M3/M4)**: `CC Manager-0.3.0-mac-arm64.dmg`
   - **macOS (Intel)**: `CC Manager-0.3.0-mac-x64.dmg`
2. Windows:放到任意目录(比如 `D:\Tools\`),双击运行；macOS:打开 `.dmg`,拖入 Applications 文件夹
3. 双击运行

首次启动自动完成:
- 创建数据文件(Windows: `%APPDATA%\cc-session-manager\app.db`; macOS: `~/Library/Application Support/cc-session-manager/app.db`)
- 扫描 `C:\Users\<你>\.claude\projects\` 把所有 session 入库
- 后续 `~/.claude/` 下的文件变化会自动同步到 UI
- 左侧 9 Tab:会话 / MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析

**卸载**: Windows 直接删除 portable .exe; macOS 从 Applications 删除 app 即可。数据留在上述目录,可手动删除。

---

## 🖼️ 截图

> **Screenshot coming soon** — 下一次发版前会重新截图嵌入。
> 原截图目录 `docs/screenshots/` 含 6 张自动生成的图(初始加载 / 项目选择 / 会话查看 / 搜索 / 回收站 / 软删确认)。

---

## 🔧 已知限制

- ⚠️ **macOS 未签名** — `.dmg` 可正常安装,但首次打开需绕过 Gatekeeper(右键→打开,或 `xattr -cr`)。Apple 签名 / notarization 将在后续版本加入
- ⚠️ **frontmatter 解析简化** — Skills / Commands / Sub-Agents 支持标准 YAML `key: value` 单行,复杂 YAML 嵌套结构不识别(用 Claude Code 默认模板写的都能识别)
- ⚠️ **continue session** — 返回 `claude --resume <id>` 命令字符串让你复制到终端执行,**不**在应用里直接启动 Claude Code(避免和已运行的 Claude Code 进程冲突)

---

## 🐛 反馈

- [GitHub Issues](https://github.com/Freedom0x0/cc-manager/issues) — 报 bug / 提需求
- 项目源代码:https://github.com/Freedom0x0/cc-manager

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