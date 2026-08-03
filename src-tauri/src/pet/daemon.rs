//! v1.2 c4: PetStateDaemon — single source of truth for in-memory pet state
//!
//! Spec §11.1 (parking_lot::Mutex<HashMap>), §11.2 (broadcast + mpsc), §11.3 (synthetic idle).
//!
//! Holds an optional `tauri::AppHandle` so Task 5 can `app.emit("agent-state-event", ...)`
//! to the frontend; in Task 4 the handle is stored but unused. Tests use `new_for_test`
//! which builds a daemon without an AppHandle.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use crate::pet::state::{AgentStateEvent, PetState};
use tauri::Emitter;

pub struct PetStateDaemon {
    /// Stored for Task 5 frontend event emission. Unused in Task 4.
    pub(crate) app: Option<tauri::AppHandle>,
    pub(crate) sessions: Mutex<HashMap<String, AgentStateEvent>>,
    pub(crate) broadcast: broadcast::Sender<AgentStateEvent>,
    pub event_tx: mpsc::Sender<AgentStateEvent>,
}

impl PetStateDaemon {
    /// Production constructor — takes a Tauri `AppHandle` so Task 5 can emit
    /// `agent-state-event` to the frontend without changing this signature.
    pub fn new(app: tauri::AppHandle) -> Arc<Self> {
        let (bcast, _) = broadcast::channel(64);
        let (tx, rx) = mpsc::channel(256);
        let daemon = Arc::new(Self {
            app: Some(app),
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
            event_tx: tx,
        });

        // Spawn the mpsc → daemon loop task. Use Tauri's async_runtime
        // (Tauri 2 wraps tokio + guarantees a runtime is running) instead of
        // `tokio::spawn`, which panics with "there is no reactor running"
        // when called from a sync setup-hook context. — D34 fix after
        // dev:tauri panic at daemon.rs:43 in commit 0e7f5c1..0048807 follow-up.
        let daemon_clone = daemon.clone();
        tauri::async_runtime::spawn(async move {
            Self::run_loop(daemon_clone, rx).await;
        });

        daemon
    }

    /// Test-only constructor — no AppHandle required.
    #[cfg(test)]
    pub fn new_for_test() -> Arc<Self> {
        let (bcast, _) = broadcast::channel(64);
        let (tx, rx) = mpsc::channel(256);
        let daemon = Arc::new(Self {
            app: None,
            sessions: Mutex::new(HashMap::new()),
            broadcast: bcast,
            event_tx: tx,
        });

        let daemon_clone = daemon.clone();
        tauri::async_runtime::spawn(async move {
            Self::run_loop(daemon_clone, rx).await;
        });

        daemon
    }

    async fn run_loop(self: Arc<Self>, mut rx: mpsc::Receiver<AgentStateEvent>) {
        while let Some(event) = rx.recv().await {
            self.clone().handle_event(event).await;
        }
    }

    pub async fn handle_event(self: Arc<Self>, event: AgentStateEvent) {
        let session_id = event.session_id.clone();
        let state = event.state;

        // 1. Write to HashMap (parking_lot::Mutex, sync, fast)
        {
            let mut map = self.sessions.lock();
            map.insert(session_id.clone(), event.clone());
        }

        // 2. Broadcast to subscribers (HTTP receiver, frontend listener, etc.)
        let _ = self.broadcast.send(event.clone());

        // 2.5 Emit to Tauri webview (PetWindow listen('agent-state-event'))
        // Optional<AppHandle> may be None in tests; production wiring (lib.rs setup)
        // passes Some(app). Errors are intentionally swallowed — frontend may not
        // be listening yet, that's not a daemon fault.
        if let Some(app) = self.app.as_ref() {
            let _ = app.emit("agent-state-event", &event);
        }

        // 3. Spawn synthetic idle if Completed (per §11.3)
        if state == PetState::Completed {
            let bcast = self.broadcast.clone();
            // D34 fix (c5 review C2): clone AppHandle so spawned closure can
            //   also emit to frontend. Without this, only broadcast fires
            //   (which has no production subscribers) — PetWindow listen()
            //   never sees the synthetic Idle.
            let app = self.app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let idle = AgentStateEvent {
                    session_id: session_id.clone(),
                    cwd: None,
                    state: PetState::Idle,
                    tool_name: None,
                    skill_name: None,
                    mcp_server: None,
                    elapsed_ms: None,
                    timestamp_ms: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0),
                    payload: serde_json::json!(null),
                };
                let _ = bcast.send(idle.clone());
                if let Some(app) = app.as_ref() {
                    let _ = app.emit("agent-state-event", &idle);
                }
            });
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentStateEvent> {
        self.broadcast.subscribe()
    }

    pub fn snapshot(&self) -> Vec<AgentStateEvent> {
        let map = self.sessions.lock();
        map.values().cloned().collect()
    }
}
