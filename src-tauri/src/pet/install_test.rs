//! v1.2 c4: install_status_hooks tests

use std::fs;
use tempfile::TempDir;

use crate::pet::install;
use crate::pet::install::uninstall_status_hooks;
use crate::pet::state::InstallResult;
use crate::repo::hooks_scanner::HOOK_EVENTS;

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
        assert!(
            cmd.ends_with(&format!("--event {}", event)),
            "hook command must pass the hook event name, got: {}",
            cmd
        );
    }
}

#[test]
fn test_install_repairs_old_status_hook_commands() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Old versions passed a state value instead of the Claude Code event name.
    // Reinstall must repair it rather than treating it as already correct.
    let pre = r#"{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"/path/cc-status-emit --event tool-use"}]}]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 6);  // 5 new + 1 repaired
    assert_eq!(result.skipped, 0);

    // PreToolUse still has exactly one entry, and it's the original cc-status-emit
    // (we did not push a duplicate alongside the existing one).
    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let pre_entries = parsed["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_entries.len(), 1, "PreToolUse should keep its single existing entry, not get a duplicate");
    let command = pre_entries[0]["hooks"][0]["command"].as_str().unwrap();
    assert!(command.ends_with("--event PreToolUse"), "old command was not repaired: {}", command);
}

#[test]
fn test_install_quotes_emit_path_with_spaces() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let emit_path = dir.path().join("cc manager").join("cc-status-emit");
    install_status_hooks_with_events(&settings_path, "secret", &emit_path, &["Stop"]).unwrap();

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let command = parsed["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
    let expected_quote = if cfg!(windows) { '"' } else { '\'' };
    assert!(command.starts_with(expected_quote), "path should be shell quoted: {}", command);
    assert!(command.ends_with("--event Stop"));
}

#[test]
fn test_install_is_idempotent_when_commands_are_current() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    fs::write(&settings_path, "{}").unwrap();
    let emit_path = dir.path().join("cc-status-emit");

    install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 0);
    assert_eq!(result.skipped, 6);
}

#[test]
fn test_install_preserves_unrelated_hook_on_same_event() {
    let dir = TempDir::new().unwrap();
    let settings_path = dir.path().join("settings.json");
    // Pre-existing PreToolUse hook is some unrelated tool (not cc-status-emit).
    // Per install.rs:43-56, the skip check looks for a "cc-status-emit" substring,
    // so other-tool does NOT count as "already installed" — our hook should still
    // be added alongside it, and the unrelated hook must be preserved.
    let pre = r#"{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"other-tool"}]}]}}"#;
    fs::write(&settings_path, pre).unwrap();

    let emit_path = dir.path().join("cc-status-emit.exe");
    let result = install_status_hooks_impl(&settings_path, "secret", &emit_path).unwrap();

    assert_eq!(result.installed, 6);  // all 6 events installed
    assert_eq!(result.skipped, 0);    // none skipped — other-tool is not "ours"

    let raw = fs::read_to_string(&settings_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let pre_entries = parsed["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(pre_entries.len(), 2, "PreToolUse should now have both other-tool and cc-status-emit");
    // both commands present
    assert!(raw.contains("other-tool"));
    assert!(raw.contains("cc-status-emit"));
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

// Helper signatures — defined in install.rs
//
// Note: install_status_hooks_impl uses crate::repo::hooks_scanner::HOOK_EVENTS
// directly so the test stays in sync if HOOK_EVENTS ever changes (e.g. a 7th
// event is added). install.rs itself iterates the same constant, so any new
// event automatically appears in both production and test paths.
fn install_status_hooks_impl(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, HOOK_EVENTS)
}

fn install_status_hooks_with_events(
    settings_path: &std::path::Path,
    secret: &str,
    emit_path: &std::path::Path,
    events: &[&str],
) -> Result<InstallResult, String> {
    install::install_status_hooks(settings_path, secret, emit_path, events)
}
