//! v1.2 c4: HTTP receiver — axum server on 127.0.0.1:19847
//!
//! Spec §5.4 (HTTP protocol), §10 T2 (event flow).
//!
//! Endpoints:
//! - POST /agent-event: HMAC verify → parse → mpsc submit to daemon
//! - GET /agent-state: return daemon snapshot

use std::sync::Arc;
use axum::{
    routing::{get, post},
    Router, Json, extract::State, http::StatusCode, http::HeaderMap,
};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::pet::daemon::PetStateDaemon;
use crate::pet::state::AgentStateEvent;

type HmacSha256 = Hmac<Sha256>;

type AppState = (Arc<PetStateDaemon>, String);

pub fn build_router(daemon: Arc<PetStateDaemon>, secret: String) -> Router {
    Router::new()
        .route("/agent-event", post(handler_post))
        .route("/agent-state", get(handler_get))
        .with_state((daemon, secret))
}

async fn handler_post(
    State((daemon, secret)): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // 1. HMAC verify
    let sig_header = headers.get("x-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_hmac(&secret, &body, sig_header) {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid signature"}))));
    }

    // 2. Parse AgentStateEvent
    let event: AgentStateEvent = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": "schema invalid", "details": e.to_string()}))))?;

    // 3. Submit to daemon via mpsc
    daemon.event_tx.send(event).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("daemon closed: {}", e)}))))?;

    Ok(Json(json!({"ok": true})))
}

async fn handler_get(State((daemon, _secret)): State<AppState>) -> Json<Vec<AgentStateEvent>> {
    Json(daemon.snapshot())
}

pub fn verify_hmac(secret: &str, body: &str, header: &str) -> bool {
    // Header format: "hmac-sha256=<hex>"
    let sig_hex = match header.strip_prefix("hmac-sha256=") {
        Some(s) => s,
        None => return false,
    };
    let sig_bytes = match hex::decode(sig_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body.as_bytes());
    mac.verify_slice(&sig_bytes).is_ok()
}

pub async fn start_http_server(daemon: Arc<PetStateDaemon>, secret: String) -> Result<(), String> {
    let app = build_router(daemon, secret);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:19847")
        .await
        .map_err(|e| format!("bind 127.0.0.1:19847: {}", e))?;

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[pet http] server error: {}", e);
        }
    });
    Ok(())
}
