//! v1.2 c4: PetStateDaemon tests

use std::time::Duration;
use crate::pet::state::{AgentStateEvent, PetState};
use crate::pet::daemon::PetStateDaemon;

fn make_event(session: &str, state: PetState) -> AgentStateEvent {
    AgentStateEvent {
        session_id: session.to_string(),
        cwd: None,
        state,
        tool_name: None,
        skill_name: None,
        mcp_server: None,
        elapsed_ms: None,
        timestamp_ms: 0,
        payload: serde_json::json!(null),
    }
}

#[tokio::test]
async fn test_daemon_writes_event_to_hashmap() {
    let daemon = PetStateDaemon::new_for_test();
    let event = make_event("s1", PetState::ToolUse);
    daemon.clone().handle_event(event.clone()).await;

    let sessions = daemon.snapshot();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "s1");
    assert_eq!(sessions[0].state, PetState::ToolUse);
}

#[tokio::test]
async fn test_daemon_broadcasts_to_subscribers() {
    let daemon = PetStateDaemon::new_for_test();
    let mut rx = daemon.subscribe();

    let event = make_event("s1", PetState::Thinking);
    daemon.clone().handle_event(event.clone()).await;

    let received = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await
        .expect("timeout")
        .expect("recv failed");
    assert_eq!(received.session_id, "s1");
    assert_eq!(received.state, PetState::Thinking);
}

#[tokio::test]
async fn test_daemon_synthetic_idle_after_completed() {
    let daemon = PetStateDaemon::new_for_test();
    let mut rx = daemon.subscribe();

    let event = make_event("s1", PetState::Completed);
    daemon.clone().handle_event(event).await;

    // First event is the Completed
    let first = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await.unwrap().unwrap();
    assert_eq!(first.state, PetState::Completed);

    // Synthetic Idle should arrive after 5s (per §11.3)
    let second = tokio::time::timeout(Duration::from_secs(6), rx.recv()).await
        .expect("synthetic idle should arrive within 6s");
    let idle = second.expect("recv failed");
    assert_eq!(idle.state, PetState::Idle);
    assert_eq!(idle.session_id, "s1");
}

#[tokio::test]
async fn test_daemon_concurrent_writes_no_panic() {
    let daemon = PetStateDaemon::new_for_test();
    let mut handles = Vec::new();
    for i in 0..10 {
        let d = daemon.clone();
        handles.push(tokio::spawn(async move {
            d.handle_event(make_event(&format!("s{}", i), PetState::ToolUse)).await;
        }));
    }
    for h in handles { h.await.unwrap(); }
    assert_eq!(daemon.snapshot().len(), 10);
}
