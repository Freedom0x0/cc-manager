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
    #[serde(default)]
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
        })
        .collect()
}

pub fn get_mcp_server(name: &str, config_path: Option<&Path>, settings_path: Option<&Path>) -> Option<McpServer> {
    list_mcp_servers(config_path, settings_path)
        .into_iter()
        .find(|s| s.name == name)
}