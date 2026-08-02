//! v4.0 Commands scanner (commit 7a)
//! 平移自 v3.1 electron/repo/commands/scanner.ts
//! 主目录 ~/.claude/commands/<name>.md + .md.disabled 后缀

use crate::types::Command;
use std::path::{Path, PathBuf};

pub fn default_commands_dir() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("commands")).unwrap_or_else(|| PathBuf::from("commands"))
}

fn parse_md_file(path: &Path) -> Option<(String, bool)> {
    let file_name = path.file_name()?.to_str()?.to_string();
    if file_name.ends_with(".md.disabled") {
        let name = file_name.trim_end_matches(".md.disabled").to_string();
        Some((name, false))
    } else if file_name.ends_with(".md") {
        let name = file_name.trim_end_matches(".md").to_string();
        Some((name, true))
    } else {
        None
    }
}

pub fn list_commands(commands_dir: Option<&Path>) -> Vec<Command> {
    let commands_dir = commands_dir.map(|p| p.to_path_buf()).unwrap_or_else(default_commands_dir);
    let Ok(entries) = std::fs::read_dir(&commands_dir) else { return Vec::new() };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        if let Some((name, enabled)) = parse_md_file(&entry.path()) {
            let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
            result.push(Command {
                name,
                content,
                path: entry.path().to_string_lossy().to_string(),
                enabled,
            });
        }
    }
    result
}

pub fn get_command(name: &str, commands_dir: Option<&Path>) -> Option<Command> {
    list_commands(commands_dir).into_iter().find(|c| c.name == name)
}