//! v4.0 Sub-agents writer (commit 8b)

use crate::types::{SubAgentCreateInput, SubAgentUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use std::path::Path;

pub fn create_sub_agent(input: SubAgentCreateInput, agents_dir: Option<&Path>) -> Result<(), String> {
    let dir = agents_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::agents_scanner::default_agents_dir());
    let path = dir.join(format!("{}.md", input.name));
    if path.exists() {
        return Err(format!("agent '{}' already exists", input.name));
    }
    atomic_write_json(&path, &serde_json::json!({"content": input.content}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn update_sub_agent(name: &str, patch: SubAgentUpdatePatch, agents_dir: Option<&Path>) -> Result<(), String> {
    let dir = agents_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::agents_scanner::default_agents_dir());
    let path = dir.join(format!("{}.md", name));
    if !path.exists() {
        return Err(format!("agent '{}' not found", name));
    }
    atomic_write_json(&path, &serde_json::json!({"content": patch.content.unwrap_or_default()}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn delete_sub_agent(name: &str, agents_dir: Option<&Path>) -> Result<(), String> {
    let dir = agents_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::agents_scanner::default_agents_dir());
    let path = dir.join(format!("{}.md", name));
    if !path.exists() {
        return Err(format!("agent '{}' not found", name));
    }
    std::fs::remove_file(&path).map_err(|e| format!("rm: {}", e))?;
    Ok(())
}