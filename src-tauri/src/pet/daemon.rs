//! v1.2 c2: PetStateDaemon stub (wired in Task 4)
//!
//! Daemon is the single source of truth for in-memory pet state.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::broadcast;

use crate::pet::state::AgentStateEvent;

pub struct PetStateDaemon {
    pub(crate) sessions: Mutex<HashMap<String, AgentStateEvent>>,
    pub(crate) broadcast: broadcast::Sender<AgentStateEvent>,
}

impl PetStateDaemon {
    pub fn new() -> Arc<Self> {
        let (broadcast, _) = broadcast::channel(64);
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast,
        })
    }
}

impl Default for PetStateDaemon {
    fn default() -> Self {
        let (broadcast, _) = broadcast::channel(64);
        Self {
            sessions: Mutex::new(HashMap::new()),
            broadcast,
        }
    }
}
