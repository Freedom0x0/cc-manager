//! v4.0 settings.json 共享 reader
//!
//! 6 模块 (mcp / skills / commands / sub-agents / hooks / plugins) 都
//! 需要读 ~/.claude/settings.json 不同字段:
//! - mcp: disabledMcpjsonServers 黑名单(D10 真停用)
//! - hooks: hooks[<event>] 数组(hook_list/get)
//! - plugins: enabledPlugins[<fullName>] boolean
//!
//! 平移自 v3.1 electron/repo/settings-writer.ts:readSettings
//! 容错: 文件不存在 / JSON 损坏 → 返 None (各模块按 None 当空配置)

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_mcpjson_servers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_plugins: Option<std::collections::HashMap<String, bool>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hooks: Option<std::collections::HashMap<String, Vec<serde_json::Value>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<serde_json::Value>,
    // 兜底保留未知字段 (Serialize 不需要 - serde_json::Value 已经序列化)
}

/// 读 settings.json, 文件不存在或 JSON 损坏返 None。
/// 不抛错: 前端 UI 不应崩(spec §3 容错)。
pub fn read_claude_settings(path: &Path) -> Option<ClaudeSettings> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}