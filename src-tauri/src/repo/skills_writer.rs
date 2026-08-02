//! v4.0 Skills writer (commit 6b)
//! 平移自 v3.1 electron/repo/skills/writer.ts
//! 写真实文件 ~/.claude/skills/<name>/SKILL.md + atomic_write_json

use crate::types::{SkillCreateInput, SkillUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use std::path::Path;

pub fn create_skill(input: SkillCreateInput, skills_dir: Option<&Path>) -> Result<(), String> {
    let skills_dir = skills_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::skills_scanner::default_skills_dir());
    let dir = skills_dir.join(&input.name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let path = dir.join("SKILL.md");
    if path.exists() {
        return Err(format!("skill '{}' already exists", input.name));
    }
    atomic_write_json(&path, &serde_json::json!({"content": input.content}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn update_skill(name: &str, patch: SkillUpdatePatch, skills_dir: Option<&Path>) -> Result<(), String> {
    let skills_dir = skills_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::skills_scanner::default_skills_dir());
    let path = skills_dir.join(name).join("SKILL.md");
    if !path.exists() {
        return Err(format!("skill '{}' not found", name));
    }
    let new_content = patch.content.unwrap_or_default();
    atomic_write_json(&path, &serde_json::json!({"content": new_content}))
        .map_err(|e| format!("atomic_write: {}", e))?;
    Ok(())
}

pub fn delete_skill(name: &str, skills_dir: Option<&Path>) -> Result<(), String> {
    let skills_dir = skills_dir.map(|p| p.to_path_buf())
        .unwrap_or_else(|| super::skills_scanner::default_skills_dir());
    let dir = skills_dir.join(name);
    if !dir.exists() {
        return Err(format!("skill '{}' not found", name));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("rm: {}", e))?;
    Ok(())
}