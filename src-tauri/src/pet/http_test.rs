//! v1.2 c4: HTTP receiver tests

use axum::body::Body;
use axum::http::{Request, StatusCode};
use std::sync::Arc;
use tower::util::ServiceExt;  // for `oneshot`
use crate::pet::state::AgentStateEvent;
use crate::pet::daemon::PetStateDaemon;
use crate::pet::http::{build_router, verify_hmac};

fn sign(secret: &str, body: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[tokio::test]
async fn test_http_rejects_bad_signature() {
    let daemon = PetStateDaemon::new_for_test();
    let secret = "test-secret".to_string();
    let app = build_router(daemon, secret.clone());

    let body = r#"{"session_id":"abc","state":"tool-use","timestamp_ms":1}"#;
    let req = Request::builder()
        .method("POST")
        .uri("/agent-event")
        .header("content-type", "application/json")
        .header("x-signature", "hmac-sha256=deadbeef")
        .body(body.to_string())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_http_accepts_valid_signature() {
    let daemon = PetStateDaemon::new_for_test();
    let secret = "test-secret".to_string();
    let app = build_router(Arc::clone(&daemon), secret.clone());

    let body = r#"{"session_id":"abc","state":"tool-use","timestamp_ms":1}"#;
    let sig = sign(&secret, body);
    let req = Request::builder()
        .method("POST")
        .uri("/agent-event")
        .header("content-type", "application/json")
        .header("x-signature", format!("hmac-sha256={}", sig))
        .body(body.to_string())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Give the mpsc loop a moment to process the event.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Verify event reached daemon
    let snapshot = daemon.snapshot();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].session_id, "abc");
}

#[tokio::test]
async fn test_http_get_returns_snapshot() {
    let daemon = PetStateDaemon::new_for_test();
    let event = AgentStateEvent {
        session_id: "s1".into(),
        cwd: None,
        state: crate::pet::state::PetState::Thinking,
        tool_name: None,
        skill_name: None,
        mcp_server: None,
        elapsed_ms: None,
        timestamp_ms: 1,
        payload: serde_json::json!(null),
    };
    daemon.clone().handle_event(event).await;

    let secret = "s".to_string();
    let app = build_router(daemon, secret);
    let req = Request::builder()
        .method("GET")
        .uri("/agent-state")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(response.into_body(), 1_000_000).await.unwrap();
    let body = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body.contains("s1"));
}

#[test]
fn test_hmac_verify_roundtrip() {
    let body = "hello";
    let secret = "key";
    let sig = sign(secret, body);
    assert!(verify_hmac(secret, body, &format!("hmac-sha256={}", sig)));
    assert!(!verify_hmac(secret, body, "hmac-sha256=wrong"));
    assert!(!verify_hmac(secret, body, ""));
}
