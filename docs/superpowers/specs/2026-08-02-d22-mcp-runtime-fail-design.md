---
title: D22 MCP runtime fail — mcp_scanner snake_case 错位修复
kind: design
---

# D22 MCP runtime fail 设计 (commit 21)

## 问题

用户 2026-08-02 报 "MCP panel 没显示"。诊断:

- 其他 5 module (Skills / Commands / Sub-Agents / Hooks / Plugins) 都有数据
- `~/.claude.json` 存在 (29580 字节) + `~/.claude/settings.json` 存在
- `~/.claude.json` 实际字段是 `mcpServers` (camelCase, Anthropic 官方 schema)
- `src-tauri/src/repo/mcp_scanner.rs:13-16` `struct ClaudeJson` 字段名是 `mcp_servers` (snake_case, 无 `rename_all` 装饰)
- `serde_json::from_str::<ClaudeJson>` 找不到 `mcp_servers` → 返 default empty HashMap → list_mcp_servers 返 `[]`
- McpManager UI 接 `await api.mcpList()` 返 `[]` → 列表空, 但不报错(spec §3 容错契约)

## 根因

v3.1 → v4 commit 5 平移 mcp_scanner 时,字段名假设错误:
- v3.1 electron 走 `JSON.parse(content).mcpServers` (camelCase, JS 字段访问天然)
- v4 Rust serde 默认字段名 = 字段名直接 = `mcp_servers` (snake_case)
- 缺 `#[serde(rename = "mcpServers")]` 或 `#[serde(rename_all = "camelCase")]`

## 修复

**方案 A (推荐)**: mcp_scanner.rs:13-16 `struct ClaudeJson` 加 `#[serde(rename = "mcpServers")]`,1 行修改。

```rust
#[derive(Debug, Deserialize, Default)]
struct ClaudeJson {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: std::collections::HashMap<String, McpServerRaw>,
}
```

## 测试

加 1 case (commit 5 旧 case 3 + commit 18 加的 test fixture 都用 snake_case `mcp_servers` key 绕过 bug):
- 写 fixture: `{"mcpServers": {"github": {"command": "gh"}}}` (camelCase, 跟 ~/.claude.json 一致)
- 调 list_mcp_servers(Option<None>, Option<None>) 验证返 1 个 McpServer (name=github, command=Some("gh"))

## 不影响范围

- mcp_writer.rs 写 `mcp_servers` (serde_json::json!({"mcpServers": servers})) 已用 camelCase, 平移正确
- commit 5 + 18 旧 fixture 用 snake_case `mcp_servers` key 实际是绕过 bug 的 "假测试" — commit 21 改回 camelCase 真实场景
- D10 真停用 settings.json 字段 (disabledMcpjsonServers) 走 ClaudeSettings struct, 已用 camelCase, 正确

## 验证门槛

- cargo test --lib 23 passed (commit 21 新增 1 case) + 0 failed
- npx tsc --noEmit 0 错
- npm run build:vite 成功
- 用户手验 `npm run dev:tauri` → MCP panel 看到 ~3 个 mcp server (用户 ~/.claude.json 实际有 3 个 mcpServers 项)

## 风险

低 — 1 行修改, ClaudeJson 是 scanner 内部 struct, 不外露。生产路径下 mcp_servers 字段从无 (default empty) 变有 (~3 项), 没副作用。

## 教训

- v3.1 → v4 平移 scanner 时, 应核对实际 JSON 文件 (head -c 200 ~/.claude.json 看字段名), 不是照搬 v3.1 source code 的字段访问 (JS dot 访问无 schema 检查)
- Rust serde 默认行为严格: 字段名不匹配 = 静默 default = 静默空数据 = 看起来 "工作但无数据" = 最难发现的 bug 类型
- 测试 fixture 应该用真实场景数据 (camelCase 真实 ~/.claude.json 字段), 不是绕过 schema 的 snake_case fake data
