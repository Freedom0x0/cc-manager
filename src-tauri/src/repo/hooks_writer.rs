//! v4.0 Hooks writer (commit 9b)

use crate::types::{HookCreateInput, HookUpdatePatch};
use crate::util::atomic_write::atomic_write_json;
use crate::util::settings_reader::{read_claude_settings, ClaudeSettings};
use crate::repo::hooks_scanner::HOOK_EVENTS;
use serde_json::json;
use std::path::Path;

fn settings_path_or_default(p: Option<&Path>) -> std::path::PathBuf {
    p.map(|x| x.to_path_buf())
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("settings.json")).unwrap_or_else(|| "settings.json".into()))
}

fn read_or_default(path: &Path) -> ClaudeSettings {
    read_claude_settings(path).unwrap_or_default()
}

fn write_settings(path: &Path, settings: &ClaudeSettings) -> Result<(), String> {
    atomic_write_json(path, settings).map_err(|e| format!("atomic_write: {}", e))
}

pub fn create_hook(input: HookCreateInput, settings_path: Option<&Path>) -> Result<(), String> {
    let path = settings_path_or_default(settings_path);
    let mut settings = read_or_default(&path);
    let hooks_map = settings.hooks.get_or_insert_with(Default::default);
    let entries = hooks_map.entry(input.event.clone()).or_insert_with(Vec::new);
    entries.push(json!({
        "matcher": input.matcher,
        "hooks": [{"type": input.hook_type, "command": input.command}],
    }));
    write_settings(&path, &settings)
}

pub fn update_hook(event: &str, index: usize, patch: HookUpdatePatch, settings_path: Option<&Path>) -> Result<(), String> {
    let path = settings_path_or_default(settings_path);
    let mut settings = read_or_default(&path);
    let Some(hooks_map) = settings.hooks.as_mut() else { return Err("no hooks".into()) };
    let Some(entries) = hooks_map.get_mut(event) else { return Err(format!("event '{}' not found", event)) };
    if index >= entries.len() { return Err(format!("index {} out of range", index)); }
    if let Some(m) = patch.matcher { entries[index]["matcher"] = json!(m); }
    if let Some(t) = patch.hook_type {
        if let Some(arr) = entries[index]["hooks"].as_array_mut() {
            if let Some(h0) = arr.first_mut() { h0["type"] = json!(t); }
        }
    }
    if let Some(c) = patch.command {
        if let Some(arr) = entries[index]["hooks"].as_array_mut() {
            if let Some(h0) = arr.first_mut() { h0["command"] = json!(c); }
        }
    }
    write_settings(&path, &settings)
}

pub fn delete_hook(event: &str, index: usize, settings_path: Option<&Path>) -> Result<(), String> {
    let path = settings_path_or_default(settings_path);
    let mut settings = read_or_default(&path);
    let Some(hooks_map) = settings.hooks.as_mut() else { return Err("no hooks".into()) };
    let Some(entries) = hooks_map.get_mut(event) else { return Err(format!("event '{}' not found", event)) };
    if index >= entries.len() { return Err(format!("index {} out of range", index)); }
    entries.remove(index);
    write_settings(&path, &settings)
}

#[allow(dead_code)]
pub fn hook_events() -> &'static [&'static str] {
    HOOK_EVENTS
}