//! v1.2 c4: install_status_hooks tests

use std::fs;
use tempfile::TempDir;

#[test]
fn test_install_writes_env_and_six_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "test-secret", &emit_path).unwrap();

    assert_eq!(result.installed, 6);
    assert_eq!(result.skipped, 0);

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();

    // env.CC_PET_SECRET = "test-secret"
    assert_eq!(parsed["env"]["CC_PET_SECRET"], "test-secret");

    // 6 hooks installed
    let hooks = parsed["hooks"].as_object().unwrap();
    for event in ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification", "UserPromptSubmit"] {
        assert!(hooks.contains_key(event), "missing hook event: {}", event);
        let entries = hooks[event].as_array().unwrap();
        assert_eq!(entries.len(), 1, "expected 1 entry for {}", event);
        let cmd = entries[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("cc-status-emit"), "hook command should reference cc-status-emit: {}", cmd);
    }
}

#[test]
fn test_install_skips_already_installed_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Pre-existing hook on PreToolUse (not ours — different command)
    let pre = r#"{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"other-tool"}]}]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 5);  // PreToolUse skipped (other-tool), 5 others installed
    assert_eq!(result.skipped, 1);

    // PreToolUse still has other-tool (we didn't overwrite)
    let raw = fs::read_to_string(&settings_path).unwrap();
    assert!(raw.contains("other-tool"));
}

#[test]
fn test_install_preserves_unknown_top_level_fields() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Custom user field at top level
    let pre = r#"{"customField":"keep-me","permissions":{"allow":["Bash"]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    install_status_hooks_impl(&settings_path, "s", &emit_path).unwrap();

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["customField"], "keep-me");
    assert!(parsed["permissions"]["allow"].is_array());
}

#[test]
fn test_install_rejects_unknown_event() {
    // PermissionRequest is NOT in v4 HOOK_EVENTS — install must error out, not silently add
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();
    let emit_path = dir.path().join("cc-status-emit.exe");

    let result = install_status_hooks_with_events(
        &settings_path,
        "s",
        &emit_path,
        &["PermissionRequest"],
    );
    assert!(result.is_err(), "PermissionRequest must be rejected (v1.2 F5)");
}

#[test]
fn test_uninstall_removes_only_cc_status_emit_hooks() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    let pre = r#"{
        "hooks": {
            "PreToolUse": [
                {"matcher":"","hooks":[{"type":"command","command":"other-tool"}]},
                {"matcher":"","hooks":[{"type":"command","command":"cc-status-emit --event tool-use"}]}
            ],
            "Stop": [
                {"matcher":"","hooks":[{"type":"command","command":"cc-status-emit --event completed"}]}
            ]
        },
        "env": {"CC_PET_SECRET": "x", "OTHER_VAR": "keep"}
    }"#;
    fs::write(&settings_path, pre).unwrap();

    let result = uninstall_status_hooks(&settings_path).unwrap();
    assert_eq!(result.removed, 2);  // cc-status-emit entries

    let raw = fs::read_to_string(&settings_path).unwrap();
    // other-tool preserved
    assert!(raw.contains("other-tool"));
    // CC_PET_SECRET removed, OTHER_VAR kept
    assert!(!raw.contains("CC_PET_SECRET"));
    assert!(raw.contains("OTHER_VAR"));
}

// Helper signatures — defined in install.rs (Step 3)
fn install_status_hooks_impl(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, &HOOK_EVENTS_REAL[..])
}

fn install_status_hooks_with_events(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
    events: &[&str],
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, events)
}

use crate::pet::install;
use crate::pet::install::uninstall_status_hooks;
use crate::pet::state::InstallResult;

/// Real HOOK_EVENTS list from repo::hooks_scanner — used so test_install_*
/// exercises the production path with the actual 6 events.
const HOOK_EVENTS_REAL: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SubagentStop",
    "Notification",
    "UserPromptSubmit",
];
