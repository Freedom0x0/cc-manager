//! v4.0 Plugins writer (commit 10b)
//! 平移自 v3.1 electron/repo/plugins/writer.ts

use crate::types::{PluginCreateInput, PluginUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use std::path::Path;

pub fn create_plugin(input: PluginCreateInput, plugins_root: Option<&Path>) -> Result<(), String> {
    let root = plugins_root.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::plugins_scanner::default_plugins_root());
    let dir = root.join(&input.name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let plugin_dir = dir.join(".claude-plugin");
    std::fs::create_dir_all(&plugin_dir).map_err(|e| format!("mkdir: {}", e))?;
    let path = plugin_dir.join("plugin.json");
    if path.exists() {
        return Err(format!("plugin '{}' already exists", input.name));
    }
    let wrapper = serde_json::json!({
        "name": input.name,
        "version": input.version,
        "description": input.description,
        "scope": input.scope,
    });
    atomic_write_json(&path, &wrapper).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn update_plugin(_full_name: &str, patch: PluginUpdatePatch, plugins_root: Option<&Path>) -> Result<(), String> {
    let root = plugins_root.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::plugins_scanner::default_plugins_root());
    let path = root.join(_full_name.split('@').next().unwrap_or(_full_name))
        .join(".claude-plugin")
        .join("plugin.json");
    if !path.exists() {
        return Err(format!("plugin '{}' not found", _full_name));
    }
    let mut current: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).map_err(|e| format!("read: {}", e))?)
        .map_err(|e| format!("parse: {}", e))?;
    if let Some(v) = patch.version { current["version"] = serde_json::json!(v); }
    if let Some(d) = patch.description { current["description"] = serde_json::json!(d); }
    atomic_write_json(&path, &current).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn delete_plugin(full_name: &str, plugins_root: Option<&Path>) -> Result<(), String> {
    let root = plugins_root.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::plugins_scanner::default_plugins_root());
    let dir = root.join(full_name.split('@').next().unwrap_or(full_name));
    if !dir.exists() {
        return Err(format!("plugin '{}' not found", full_name));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("rm: {}", e))?;
    Ok(())
}