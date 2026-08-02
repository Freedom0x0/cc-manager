//! v4.0 Sub-agents scanner (commit 8a)
//! 平移自 v3.1 electron/repo/sub-agents/scanner.ts

use crate::types::SubAgent;
use std::path::{Path, PathBuf};

pub fn default_agents_dir() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("agents")).unwrap_or_else(|| PathBuf::from("agents"))
}

fn parse_md_file(path: &Path) -> Option<(String, bool)> {
    let file_name = path.file_name()?.to_str()?.to_string();
    if file_name.ends_with(".md.disabled") {
        Some((file_name.trim_end_matches(".md.disabled").to_string(), false))
    } else if file_name.ends_with(".md") {
        Some((file_name.trim_end_matches(".md").to_string(), true))
    } else {
        None
    }
}

pub fn list_sub_agents(agents_dir: Option<&Path>) -> Vec<SubAgent> {
    let agents_dir = agents_dir.map(|p| p.to_path_buf()).unwrap_or_else(default_agents_dir);
    let Ok(entries) = std::fs::read_dir(&agents_dir) else { return Vec::new() };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        if let Some((name, enabled)) = parse_md_file(&entry.path()) {
            let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
            let description = crate::repo::common::parse_frontmatter_description(&content);
            result.push(SubAgent {
                name, content,
                path: entry.path().to_string_lossy().to_string(),
                enabled,
                description,
            });
        }
    }
    result
}

pub fn get_sub_agent(name: &str, agents_dir: Option<&Path>) -> Option<SubAgent> {
    list_sub_agents(agents_dir).into_iter().find(|a| a.name == name)
}