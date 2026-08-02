//! v4.0 MCP 配置 scanner
//!
//! 平移自 v3.1 electron/repo/mcp/scanner.ts
//! - 读 ~/.claude.json 的 mcpServers 字段(全局配置)
//! - enabled 状态从 settings.json 的 disabledMcpjsonServers 黑名单反推(D10 真停用)
//! - 容错: 文件不存在 / JSON 损坏 / mcpServers 字段缺失 → 返 []

use crate::types::McpServer;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize, Default)]
struct ClaudeJson {
    /// v3.1 electron 走 `JSON.parse(content).mcpServers` (camelCase, JS 字段访问天然),
    /// v4 Rust serde 默认字段名 = snake_case, 缺 `#[serde(rename = "mcpServers")]` =
    /// `serde_json::from_str` 找不到 `mcp_servers` 字段 → 静默 default empty → list_mcp_servers 返 []。
    /// 实际 `~/.claude.json` 用 `mcpServers` (Anthropic 官方 schema, 跟 mcp_writer
    /// 写时一致, 见 mcp_writer.rs:36 `serde_json::json!({"mcpServers": servers})`)。
    /// commit 5 平移时漏 rename 装饰, commit 21 修 (D22 决策)。
    #[serde(rename = "mcpServers", default)]
    mcp_servers: std::collections::HashMap<String, McpServerRaw>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct McpServerRaw {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none", default)]
    pub server_type: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub url: Option<String>,
}

/// 默认生产路径 ~/.claude.json
pub fn default_mcp_config_path() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude.json")).unwrap_or_else(|| PathBuf::from(".claude.json"))
}

/// 平移自 v3.1 listMcpServers
pub fn list_mcp_servers(config_path: Option<&Path>, settings_path: Option<&Path>) -> Vec<McpServer> {
    let config_path = config_path.map(|p| p.to_path_buf()).unwrap_or_else(default_mcp_config_path);
    let raw = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: ClaudeJson = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    // 读 settings.json 的 disabledMcpjsonServers 黑名单
    let disabled: std::collections::HashSet<String> = {
        use crate::util::settings_reader::read_claude_settings;
        let sp = settings_path.map(|p| p.to_path_buf())
            .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("settings.json")).unwrap_or_else(|| PathBuf::from("settings.json")));
        read_claude_settings(&sp)
            .and_then(|s| s.disabled_mcpjson_servers)
            .map(|arr| arr.into_iter().collect())
            .unwrap_or_default()
    };

    parsed
        .mcp_servers
        .into_iter()
        .map(|(name, raw)| McpServer {
            name: name.clone(),
            server_type: raw.server_type,
            command: raw.command,
            args: raw.args,
            env: raw.env,
            url: raw.url,
            enabled: !disabled.contains(&name),
            last_modified: None,
            description: None, // commit 26: mcp_scanner 不从 disabledMcpjsonServers 读 description, 留 None
        })
        .collect()
}

pub fn get_mcp_server(name: &str, config_path: Option<&Path>, settings_path: Option<&Path>) -> Option<McpServer> {
    list_mcp_servers(config_path, settings_path)
        .into_iter()
        .find(|s| s.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// D22 commit 21 关键 case: 写 `~/.claude.json` 实际 schema (camelCase mcpServers),
    /// 验证 list_mcp_servers 读到 1 个 server。commit 5 + 18 旧测试用 snake_case `mcp_servers`
    /// key 绕过 schema 错位 — 这 case 钉死真实场景。
    #[test]
    fn case_d22_camelcase_mcp_servers_real_schema() {
        let dir = TempDir::new().unwrap();
        let config = dir.path().join(".claude.json");
        let settings = dir.path().join("settings.json");
        // 实际 ~/.claude.json 字段名 = mcpServers (Anthropic 官方)
        fs::write(
            &config,
            r#"{"mcpServers":{"github":{"command":"gh","args":["api"]}}}"#,
        )
        .unwrap();
        fs::write(&settings, "{}").unwrap();
        let servers = list_mcp_servers(Some(&config), Some(&settings));
        assert_eq!(servers.len(), 1, "should parse camelCase mcpServers");
        assert_eq!(servers[0].name, "github");
        assert_eq!(servers[0].command.as_deref(), Some("gh"));
        assert!(servers[0].enabled, "not in disabledMcpjsonServers → enabled");
    }

    /// D22 commit 21 钉死: D10 真停用从 settings.json 的 disabledMcpjsonServers 黑名单
    /// 反推 enabled。mcpServers 含 2 个, 黑名单 1 个 → 1 enabled + 1 disabled。
    #[test]
    fn case_d22_disabled_blacklist() {
        let dir = TempDir::new().unwrap();
        let config = dir.path().join(".claude.json");
        let settings = dir.path().join("settings.json");
        fs::write(
            &config,
            r#"{"mcpServers":{"github":{"command":"gh"},"slack":{"command":"slack-cli"}}}"#,
        )
        .unwrap();
        fs::write(&settings, r#"{"disabledMcpjsonServers":["slack"]}"#).unwrap();
        let servers = list_mcp_servers(Some(&config), Some(&settings));
        assert_eq!(servers.len(), 2);
        let github = servers.iter().find(|s| s.name == "github").unwrap();
        let slack = servers.iter().find(|s| s.name == "slack").unwrap();
        assert!(github.enabled, "github not in blacklist → enabled");
        assert!(!slack.enabled, "slack in blacklist → disabled");
    }
}