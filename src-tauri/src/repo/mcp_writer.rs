//! v4.0 MCP writer (commit 5b)
//! 平移自 v3.1 electron/repo/mcp/writer.ts
//! 写真实文件 ~/.claude.json 的 mcpServers + atomic_write_json

use crate::types::{McpCreateInput, McpUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use crate::util::settings_reader::read_claude_settings;
use crate::repo::mcp_scanner::default_mcp_config_path;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize)]
struct ClaudeJsonWrite {
    #[serde(rename = "mcpServers")]
    mcp_servers: HashMap<String, McpCreateInput>,
}

fn read_mcp_json(path: &Path) -> ClaudeJsonWrite {
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let mut existing: HashMap<String, serde_json::Value> = serde_json::from_str(&raw)
        .and_then(|v: serde_json::Value| serde_json::from_value(v.get("mcpServers").cloned().unwrap_or(serde_json::Value::Null)))
        .unwrap_or_default();
    let _ = &mut existing; // placeholder
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let parsed: HashMap<String, McpCreateInput> = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| serde_json::from_value(v.get("mcpServers").cloned().unwrap_or(serde_json::Value::Null)).ok())
        .unwrap_or_default();
    ClaudeJsonWrite { mcp_servers: parsed }
}

fn write_mcp_json(path: &Path, servers: &HashMap<String, McpCreateInput>) -> Result<(), String> {
    let wrapper = serde_json::json!({"mcpServers": servers});
    atomic_write_json(path, &wrapper).map_err(|e| format!("atomic_write: {}", e))?;
    let _ = read_claude_settings; // suppress unused import
    Ok(())
}

pub fn create_mcp_server(input: McpCreateInput, config_path: Option<&Path>) -> Result<(), String> {
    let path = config_path.map(|p| p.to_path_buf()).unwrap_or_else(default_mcp_config_path);
    let mut servers = read_mcp_json(&path).mcp_servers;
    if servers.contains_key(&input.name) {
        return Err(format!("mcp '{}' already exists", input.name));
    }
    servers.insert(input.name.clone(), input);
    write_mcp_json(&path, &servers)?;
    Ok(())
}

pub fn update_mcp_server(name: &str, patch: McpUpdatePatch, config_path: Option<&Path>) -> Result<(), String> {
    let path = config_path.map(|p| p.to_path_buf()).unwrap_or_else(default_mcp_config_path);
    let mut servers = read_mcp_json(&path).mcp_servers;
    let entry = servers.get_mut(name).ok_or_else(|| format!("mcp '{}' not found", name))?;
    if let Some(t) = patch.server_type { entry.server_type = Some(t); }
    if let Some(c) = patch.command { entry.command = Some(c); }
    if let Some(a) = patch.args { entry.args = Some(a); }
    if let Some(e) = patch.env { entry.env = Some(e); }
    if let Some(u) = patch.url { entry.url = Some(u); }
    write_mcp_json(&path, &servers)?;
    Ok(())
}

pub fn delete_mcp_server(name: &str, config_path: Option<&Path>) -> Result<(), String> {
    let path = config_path.map(|p| p.to_path_buf()).unwrap_or_else(default_mcp_config_path);
    let mut servers = read_mcp_json(&path).mcp_servers;
    if servers.remove(name).is_none() {
        return Err(format!("mcp '{}' not found", name));
    }
    write_mcp_json(&path, &servers)?;
    Ok(())
}