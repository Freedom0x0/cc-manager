//! v1.2 cc-pet: PetState enum + AgentStateEvent schema + HOOK_TO_STATE mapping
//!
//! Spec §5.1 (7 states, no PermissionPrompt), §5.2 (HOOK_TO_STATE single source
//! of truth), §5.3 (AgentStateEvent schema).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PetState {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "responding")]
    Responding,
    #[serde(rename = "thinking")]
    Thinking,
    #[serde(rename = "tool-use")]
    ToolUse,
    #[serde(rename = "ask-user")]
    AskUser,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "error-interrupted")]
    ErrorInterrupted,
}

impl PetState {
    /// Wire-format string, identical to the `#[serde(rename)]` above.
    /// Exhaustive match: adding a variant without a string here fails to compile.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Responding => "responding",
            Self::Thinking => "thinking",
            Self::ToolUse => "tool-use",
            Self::AskUser => "ask-user",
            Self::Completed => "completed",
            Self::ErrorInterrupted => "error-interrupted",
        }
    }

    pub fn priority(&self) -> u8 {
        match self {
            Self::AskUser => 100,
            Self::ErrorInterrupted => 90,
            Self::ToolUse => 80,
            Self::Thinking => 70,
            Self::Responding => 60,
            Self::Completed => 50,
            Self::Idle => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateEvent {
    pub session_id: String,
    pub cwd: Option<String>,
    pub state: PetState,
    pub tool_name: Option<String>,
    pub skill_name: Option<String>,
    pub mcp_server: Option<String>,
    pub elapsed_ms: Option<i64>,
    pub timestamp_ms: i64,
    #[serde(default)]
    pub payload: serde_json::Value,
}

pub const HOOK_TO_STATE: &[(&str, PetState)] = &[
    ("UserPromptSubmit", PetState::Responding),
    ("PreToolUse",       PetState::ToolUse),
    ("PostToolUse",      PetState::ToolUse),
    ("Stop",             PetState::Completed),
    ("SubagentStop",     PetState::Completed),
    ("Notification",     PetState::AskUser),
];

pub fn state_for_hook(event: &str) -> Option<PetState> {
    HOOK_TO_STATE.iter()
        .find(|(e, _)| *e == event)
        .map(|(_, s)| *s)
}

/// Hook event name → wire-format state string, unknown events → `"idle"`.
///
/// Single source of truth for callers that need the string form directly —
/// notably the `cc-status-emit` binary, which injects it into the event JSON.
/// Keeps HOOK_TO_STATE the one mapping table (D34.14).
pub fn event_name_to_state_str(event: &str) -> &'static str {
    state_for_hook(event)
        .unwrap_or(PetState::Idle)
        .as_str()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub installed: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub removed: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_ordering() {
        // AskUser > ErrorInterrupted > ToolUse > Thinking > Responding > Completed > Idle
        assert!(PetState::AskUser.priority() > PetState::ErrorInterrupted.priority());
        assert!(PetState::ErrorInterrupted.priority() > PetState::ToolUse.priority());
        assert!(PetState::ToolUse.priority() > PetState::Thinking.priority());
        assert!(PetState::Thinking.priority() > PetState::Responding.priority());
        assert!(PetState::Responding.priority() > PetState::Completed.priority());
        assert!(PetState::Completed.priority() > PetState::Idle.priority());
        assert_eq!(PetState::Idle.priority(), 0);
    }

    #[test]
    fn test_serde_rename_roundtrip() {
        for s in [PetState::Idle, PetState::Responding, PetState::Thinking,
                  PetState::ToolUse, PetState::AskUser, PetState::Completed,
                  PetState::ErrorInterrupted] {
            let json = serde_json::to_string(&s).unwrap();
            let back: PetState = serde_json::from_str(&json).unwrap();
            assert_eq!(s, back);
        }
    }

    #[test]
    fn test_hook_to_state_mapping_all_6() {
        assert_eq!(state_for_hook("UserPromptSubmit"), Some(PetState::Responding));
        assert_eq!(state_for_hook("PreToolUse"), Some(PetState::ToolUse));
        assert_eq!(state_for_hook("PostToolUse"), Some(PetState::ToolUse));
        assert_eq!(state_for_hook("Stop"), Some(PetState::Completed));
        assert_eq!(state_for_hook("SubagentStop"), Some(PetState::Completed));
        assert_eq!(state_for_hook("Notification"), Some(PetState::AskUser));
    }

    #[test]
    fn test_state_for_hook_unknown_returns_none() {
        // PermissionRequest does NOT exist in Claude Code (v1.2 F5 fix).
        // Unknown events must return None, not panic.
        assert_eq!(state_for_hook("PermissionRequest"), None);
        assert_eq!(state_for_hook(""), None);
        assert_eq!(state_for_hook("UnknownEvent"), None);
    }

    #[test]
    fn test_hook_to_state_table_has_6_entries() {
        // D34.14: single source of truth. If a 7th event is added later,
        // both this test and §3.1 spec update together.
        assert_eq!(HOOK_TO_STATE.len(), 6);
    }

    #[test]
    fn test_event_name_to_state_str_matches_serde_rename() {
        // The string form must stay byte-identical to the serde wire format,
        // because cc-status-emit injects it straight into the event JSON.
        for (event, state) in HOOK_TO_STATE {
            let via_serde = serde_json::to_string(state).unwrap();
            assert_eq!(
                format!("\"{}\"", event_name_to_state_str(event)),
                via_serde,
                "mismatch for hook event {}", event
            );
        }
        // Unknown events fall back to idle (E1 silent drop, never panics).
        assert_eq!(event_name_to_state_str("PermissionRequest"), "idle");
        assert_eq!(event_name_to_state_str(""), "idle");
    }

    #[test]
    fn test_agent_state_event_default_payload() {        // payload should default to Null when missing from JSON (D34 spec)
        let json = r#"{"session_id":"abc","state":"idle","timestamp_ms":1234}"#;
        let event: AgentStateEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.session_id, "abc");
        assert_eq!(event.state, PetState::Idle);
        assert_eq!(event.timestamp_ms, 1234);
        assert_eq!(event.payload, serde_json::Value::Null);
    }
}
