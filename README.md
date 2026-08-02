<div align="center">

# CC Manager

**Claude Code 一站式配置中心** — 把散落在 `~/.claude/` 里的 MCP / Skills / Commands / Sub-Agents / Hooks / Plugins 集中管理,再加会话搜索、Profile 切换、用量仪表盘。

[![Version](https://img.shields.io/badge/version-4.0.0-1677ff?style=flat-square)](./package.json)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20%7C%20macOS%2010.15%2B-1677ff?style=flat-square)](./src-tauri/tauri.conf.json)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tauri](https://img.shields.io/badge/tauri-2-FFC131?style=flat-square)](./src-tauri/Cargo.toml)

**所有数据存在本地 SQLite,不联网。** Windows 10/11 64-bit + macOS 10.15+(未签名),免安装,双击即用。

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

| 版本 | 文件 | 平台 | 大小 |
|---|---|---|---|
| **v4.0.0**(最新) | `cc-session-manager_4.0.0_x64-setup.exe` | Windows | ~25 MB |
| **v4.0.0**(最新) | `cc-session-manager_4.0.0_aarch64.dmg` | macOS Apple Silicon | ~15 MB |
| v0.3.0(legacy Electron) | `CC Manager-0.3.0-portable.exe` | Windows | ~80 MB |

> Windows 10/11 64-bit、macOS 10.15+(未签名,Gatekeeper 首次打开右键允许),**免安装,双击运行**。数据文件位置: `%APPDATA%\cc-session-manager\app.db`(Windows) / `~/Library/Application Support/com.freedom0x0.cc-session-manager/app.db`(macOS)

### macOS 用户

v4.0.0 起 macOS 装包 (`*.dmg` + `*.app`) 已上线,但未签名(CLAUDE.md §13 D11 决策 — Developer ID + notarization 留 v4.1+)。首次打开 Gatekeeper 警告,**右键 → 打开**绕过。
- 直接装包: 下载 `cc-session-manager_4.0.0_aarch64.dmg`,拖进 Applications
- 开发模式: 克隆后 `npm install` + `npm run dev:tauri`(需要 Node 22+ + Rust 1.78+)

---

## 🚀 快速开始

1. 下载 `cc-session-manager_4.0.0_x64-setup.exe`
2. 放到任意目录(比如 `D:\Tools\`)
3. 双击运行

首次启动自动完成:
- 创建数据文件 `%APPDATA%\cc-session-manager\app.db`
- 扫描 `C:\Users\<你>\.claude\projects\` 把所有 session 入库
- 后续 `~/.claude/` 下的文件变化会自动同步到 UI
- 左侧 9 Tab:会话 / MCP / Skills / Commands / Sub-Agents / Hooks / 插件 / Profiles / 用量分析

**卸载**:直接删除 portable .exe 即可,数据留在 `%APPDATA%\cc-session-manager\`,可手动删除。

---

## 🖼️ 截图

> **Screenshot coming soon** — 下一次发版前会重新截图嵌入。
> 原截图目录 `docs/screenshots/` 含 6 张自动生成的图(初始加载 / 项目选择 / 会话查看 / 搜索 / 回收站 / 软删确认)。

---

## 🔧 已知限制

- ⚠️ **macOS 无装包版** — `.dmg` 在 v4.0 规划中(Apple 签名 / notarization);开发模式(`npm run dev`)可用
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
- [rusqlite](https://github.com/rusqlite/rusqlite) — 同步 SQLite 绑定(bundled,无 native build)
- [notify](https://github.com/notify-rs/notify) — 跨平台文件监听
- [Tauri](https://tauri.app/) — 桌面应用框架(Rust + WebView,体积小)

---

<div align="center">

Made with ❤️ for Claude Code users · v4.0.0 / 2026-08-02

</div>