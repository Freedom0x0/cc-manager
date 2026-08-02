//! v4.0 Hooks scanner (commit 9a)
//! 平移自 v3.1 electron/repo/hooks/scanner.ts
//! 读 settings.json 的 hooks[<event>] 数组

use crate::types::Hook;
use crate::util::settings_reader::read_claude_settings;
use std::path::Path;

pub const HOOK_EVENTS: &[&str] = &[
    "PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification", "UserPromptSubmit",
];

pub fn list_hooks(settings_path: Option<&Path>) -> Vec<Hook> {
    let path = settings_path.map(|p| p.to_path_buf())
        .unwrap_or_else(|| home::home_dir().map(|h| h.join(".claude").join("settings.json")).unwrap_or_else(|| "settings.json".into()));
    let Some(settings) = read_claude_settings(&path) else { return Vec::new() };
    let Some(hooks_map) = settings.hooks else { return Vec::new() };
    let mut result = Vec::new();
    let mut counter = 0;
    for (event, entries) in hooks_map {
        for entry in entries {
            counter += 1;
            let matcher = entry.get("matcher").and_then(|v| v.as_str()).map(String::from);
            let command = entry.get("hooks").and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|h| h.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let hook_type = entry.get("hooks").and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|h| h.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("command")
                .to_string();
            result.push(Hook {
                id: format!("{}-{}", event, counter),
                event: event.clone(),
                matcher, hook_type, command, enabled: true,
            });
        }
    }
    result
}

pub fn get_hook(id: &str, settings_path: Option<&Path>) -> Option<Hook> {
    list_hooks(settings_path).into_iter().find(|h| h.id == id)
}