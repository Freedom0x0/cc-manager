//! v4.0 Commands writer (commit 7b)

use crate::types::{CommandCreateInput, CommandUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use std::path::Path;

pub fn create_command(input: CommandCreateInput, commands_dir: Option<&Path>) -> Result<(), String> {
    let dir = commands_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::commands_scanner::default_commands_dir());
    let path = dir.join(format!("{}.md", input.name));
    if path.exists() {
        return Err(format!("command '{}' already exists", input.name));
    }
    atomic_write_json(&path, &serde_json::json!({"content": input.content}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn update_command(name: &str, patch: CommandUpdatePatch, commands_dir: Option<&Path>) -> Result<(), String> {
    let dir = commands_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::commands_scanner::default_commands_dir());
    let path = dir.join(format!("{}.md", name));
    if !path.exists() {
        return Err(format!("command '{}' not found", name));
    }
    atomic_write_json(&path, &serde_json::json!({"content": patch.content.unwrap_or_default()}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn delete_command(name: &str, commands_dir: Option<&Path>) -> Result<(), String> {
    let dir = commands_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::commands_scanner::default_commands_dir());
    let path = dir.join(format!("{}.md", name));
    if !path.exists() {
        return Err(format!("command '{}' not found", name));
    }
    std::fs::remove_file(&path).map_err(|e| format!("rm: {}", e))?;
    Ok(())
}