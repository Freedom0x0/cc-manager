//! v4.0 Skills scanner (commit 6a)
//! 平移自 v3.1 electron/repo/skills/scanner.ts
//! 主目录 ~/.claude/skills/<name>/SKILL.md + 镜像目录 ~/.claude/disabled_skills/<name>/
//! 同名冲突主目录赢 + console.warn(D12 决策)

use crate::types::Skill;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn default_skills_dir() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("skills")).unwrap_or_else(|| PathBuf::from("skills"))
}

pub fn default_disabled_skills_dir() -> PathBuf {
    home::home_dir().map(|h| h.join(".claude").join("disabled_skills")).unwrap_or_else(|| PathBuf::from("disabled_skills"))
}

fn skill_md_path(skills_dir: &Path, name: &str) -> PathBuf {
    skills_dir.join(name).join("SKILL.md")
}

pub fn list_skills(skills_dir: Option<&Path>, disabled_dir: Option<&Path>) -> Vec<Skill> {
    let skills_dir = skills_dir.map(|p| p.to_path_buf()).unwrap_or_else(default_skills_dir);
    let disabled_dir = disabled_dir.map(|p| p.to_path_buf()).unwrap_or_else(default_disabled_skills_dir);
    let mut result = Vec::new();
    let mut names = HashSet::new();

    // 主目录: enabled=true
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                let md = skill_md_path(&skills_dir, name);
                if md.exists() {
                    let content = std::fs::read_to_string(&md).unwrap_or_default();
                    result.push(Skill {
                        name: name.to_string(),
                        content,
                        path: md.to_string_lossy().to_string(),
                        enabled: true,
                    });
                    names.insert(name.to_string());
                }
            }
        }
    }

    // 镜像目录: enabled=false
    if let Ok(entries) = std::fs::read_dir(&disabled_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if names.contains(name) {
                    eprintln!("warn: skill '{}' exists in both main and disabled dir, main wins", name);
                    continue;
                }
                let md = skill_md_path(&disabled_dir, name);
                if md.exists() {
                    let content = std::fs::read_to_string(&md).unwrap_or_default();
                    result.push(Skill {
                        name: name.to_string(),
                        content,
                        path: md.to_string_lossy().to_string(),
                        enabled: false,
                    });
                    names.insert(name.to_string());
                }
            }
        }
    }
    result
}

pub fn get_skill(name: &str, skills_dir: Option<&Path>, disabled_dir: Option<&Path>) -> Option<Skill> {
    list_skills(skills_dir, disabled_dir).into_iter().find(|s| s.name == name)
}