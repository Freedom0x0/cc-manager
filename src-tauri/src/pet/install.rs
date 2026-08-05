//! v1.2 c4: install_status_hooks / uninstall_status_hooks / secret management
//!
//! Spec §5.5 — atomic write env.CC_PET_SECRET + 6 hooks.
//! Spec §3.2.1 — not directly using repo::hooks_writer::create_hook (single-event only).
//! Spec §7 E2 — HMAC secret file.

use crate::pet::state::{InstallResult, UninstallResult};
use crate::repo::hooks_scanner::HOOK_EVENTS;
use crate::util::atomic_write::atomic_write_json;
use serde_json::{json, Value};
use std::path::Path;

fn is_status_hook(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .map(|command| command.contains("cc-status-emit"))
        .unwrap_or(false)
}

fn hook_command(emit_path: &Path, event: &str) -> String {
    let path = emit_path.to_string_lossy();

    #[cfg(windows)]
    let quoted_path = format!("\"{}\"", path.replace('"', "\\\""));

    #[cfg(not(windows))]
    let quoted_path = format!("'{}'", path.replace('\'', "'\\''"));

    format!("{} --event {}", quoted_path, event)
}

pub fn install_status_hooks(
    settings_path: &Path,
    secret: &str,
    emit_path: &Path,
    events: &[&str],
) -> Result<InstallResult, String> {
    // 1. Validate all events are in HOOK_EVENTS
    for ev in events {
        if !HOOK_EVENTS.contains(ev) {
            return Err(format!("event '{}' not in HOOK_EVENTS ({:?})", ev, HOOK_EVENTS));
        }
    }

    // 2. Read existing settings (raw JSON to preserve unknown fields)
    let raw = std::fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut settings: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    let obj = settings.as_object_mut().ok_or("settings.json not an object")?;

    let mut installed = 0;
    let mut skipped = 0;

    let hooks_map = obj.entry("hooks".to_string()).or_insert(json!({}));
    let hooks_obj = hooks_map.as_object_mut().ok_or("hooks not an object")?;

    for event in events {
        let entries = hooks_obj.entry(event.to_string()).or_insert(json!([]));
        let arr = entries.as_array_mut().ok_or_else(|| format!("hooks.{} not array", event))?;

        // --event must be the Claude Code hook event name. cc-status-emit owns
        // the event -> PetState mapping; passing "tool-use"/"completed" here
        // made every installed hook fall back to idle.
        let command = hook_command(emit_path, event);

        // Reinstall is also an upgrade path: repair old commands in place when
        // the event argument or the app path changed. Merely skipping any
        // command containing cc-status-emit leaves previously broken installs
        // broken forever.
        let mut found = false;
        let mut changed = false;
        for entry in arr.iter_mut() {
            let Some(hooks) = entry.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            for hook in hooks.iter_mut().filter(|hook| is_status_hook(hook)) {
                found = true;
                if hook.get("command").and_then(Value::as_str) != Some(command.as_str()) {
                    hook["command"] = json!(command.clone());
                    changed = true;
                }
                if hook.get("type").and_then(Value::as_str) != Some("command") {
                    hook["type"] = json!("command");
                    changed = true;
                }
            }
        }

        if found {
            if changed {
                installed += 1;
            } else {
                skipped += 1;
            }
            continue;
        }

        arr.push(json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": command
            }]
        }));
        installed += 1;
    }

    // 4. Merge env.CC_PET_SECRET (non-destructive)
    let env_map = obj.entry("env".to_string()).or_insert(json!({}));
    let env_obj = env_map.as_object_mut().ok_or("env not an object")?;
    env_obj.insert("CC_PET_SECRET".to_string(), json!(secret));

    // 5. Atomic write
    atomic_write_json(settings_path, &settings).map_err(|e| format!("atomic_write: {}", e))?;

    Ok(InstallResult { installed, skipped })
}

pub fn uninstall_status_hooks(settings_path: &Path) -> Result<UninstallResult, String> {
    let raw = std::fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut settings: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    let obj = settings.as_object_mut().ok_or("settings.json not an object")?;

    let mut removed = 0;

    // Remove all cc-status-emit hook entries
    if let Some(hooks) = obj.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for (_event, entries) in hooks.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|entry| {
                    let is_ours = entry["hooks"]
                        .as_array()
                        .map(|hooks| hooks.iter().any(is_status_hook))
                        .unwrap_or(false);
                    !is_ours
                });
                removed += before - arr.len();
            }
        }
    }

    // Remove CC_PET_SECRET from env
    if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        env.remove("CC_PET_SECRET");
    }

    atomic_write_json(settings_path, &settings).map_err(|e| format!("atomic_write: {}", e))?;
    Ok(UninstallResult { removed })
}

pub fn secret_load_or_create(app_data_dir: &Path) -> Result<String, String> {
    let secret_path = app_data_dir.join("secret.json");
    if secret_path.exists() {
        let raw = std::fs::read_to_string(&secret_path).map_err(|e| format!("read secret.json: {}", e))?;
        let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("parse secret.json: {}", e))?;
        return parsed["secret"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "secret.json missing 'secret' field".to_string());
    }

    // Generate new 32-byte hex secret
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("getrandom: {}", e))?;
    let secret = hex::encode(bytes);

    std::fs::create_dir_all(app_data_dir).map_err(|e| format!("mkdir: {}", e))?;
    atomic_write_json(&secret_path, &json!({ "secret": secret }))
        .map_err(|e| format!("atomic_write secret.json: {}", e))?;

    Ok(secret)
}
