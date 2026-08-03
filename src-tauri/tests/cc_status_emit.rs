//! v1.2 c3: cc-status-emit tests
//!
//! Tests stdin JSON parsing + HMAC signing + state mapping.
//! HTTP POST is mocked (no real network).
//!
//! Moved from src/bin/cc_status_emit_test.rs to src-tauri/tests/ in
//! commit that follows D34 c3: previously sat in src/bin/ so cargo
//! auto-discovered it as a binary target (3rd bin target alongside
//! cc-session-manager / cc-status-emit), which made `cargo run` (and
//! `cargo tauri dev`) exit 101 with "could not determine which binary
//! to run". Moving to tests/ makes cargo treat it as an integration
//! test target, invoked via `cargo test --test cc_status_emit_test`.
//!
//! `env!("CARGO_BIN_EXE_cc-status-emit")` still works: cargo provides
//! this env var to integration tests pointing at the bin target of the
//! same name.

use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn test_cc_status_emit_signs_body_with_hmac() {
    // Build the cc-status-emit binary in test mode
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let secret = "test-secret-32-bytes-aaaaaaaaaaaa";

    // Pipe stdin JSON
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("tool-use")
        .arg("--secret")
        .arg(secret)
        .arg("--dry-run") // c3 feature: dry-run prints signed body, doesn't POST
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn cc-status-emit");

    let stdin = child.stdin.as_mut().expect("stdin pipe");
    stdin.write_all(br#"{"session_id":"abc","cwd":"/tmp","tool_name":"Skill"}"#).unwrap();

    let output = child.wait_with_output().expect("failed to wait");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // dry-run should print signed JSON + signature
    assert!(stdout.contains("session_id"), "stdout missing session_id: {}", stdout);
    assert!(stdout.contains("X-Signature"), "stdout missing signature header line: {}", stdout);
    assert!(stdout.contains("hmac-sha256"), "stdout missing hmac-sha256 marker: {}", stdout);
}

#[test]
fn test_cc_status_emit_maps_event_to_state() {
    // The binary should use state_for_hook from pet::state to set "state" field
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("Stop")
        .arg("--secret")
        .arg("dummy-secret")
        .arg("--dry-run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    child.stdin.as_mut().unwrap().write_all(br#"{"session_id":"x"}"#).unwrap();
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Stop → Completed (per HOOK_TO_STATE)
    assert!(
        stdout.contains("\"state\":\"completed\""),
        "expected state=completed, got: {}", stdout
    );
}

#[test]
fn test_cc_status_emit_unknown_event_exits_zero() {
    // PermissionRequest (v1.2 F5: doesn't exist) — binary must exit 0, not panic
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("PermissionRequest")
        .arg("--secret")
        .arg("dummy")
        .arg("--dry-run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    child.stdin.as_mut().unwrap().write_all(br#"{}"#).unwrap();
    let status = child.wait().unwrap();

    // Unknown event: exit 0 silently (E1 silent drop)
    assert!(status.success(), "expected exit 0 for unknown event, got: {:?}", status);
}

#[test]
fn test_cc_status_emit_missing_secret_exits_zero() {
    // No CC_PET_SECRET env, no --secret arg → exit 0 silently (E1).
    // Strip CC_PET_SECRET from the spawned env so a leaked value in the
    // parent shell can't make the test pass for the wrong reason.
    let bin = env!("CARGO_BIN_EXE_cc-status-emit");
    let mut child = Command::new(bin)
        .arg("--event")
        .arg("Stop")
        .env_remove("CC_PET_SECRET")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    let status = child.wait().unwrap();
    assert!(status.success(), "expected exit 0 when no secret, got: {:?}", status);
}