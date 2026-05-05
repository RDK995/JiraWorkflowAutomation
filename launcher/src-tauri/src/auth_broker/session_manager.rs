use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::Child;
use serde_json::json;
use uuid::Uuid;

use super::types::{auth_error, now_iso_like, Provider, Session, SessionState};

#[derive(Clone)]
pub struct ProcessHandle {
    pub child: Arc<Mutex<Box<dyn Child + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

#[derive(Clone)]
pub struct SessionManager {
    pub sessions: Arc<Mutex<HashMap<String, Session>>>,
    pub processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
}

impl SessionManager {
    pub fn new() -> SessionManager {
        SessionManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(&self, provider: Provider) -> Session {
        let now = now_iso_like();
        let session = Session {
            id: Uuid::new_v4().to_string(),
            provider,
            state: SessionState::Idle,
            output: String::new(),
            browser_url: String::new(),
            code: String::new(),
            requires_code: false,
            persistence_verified: false,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(session.id.clone(), session.clone());
        session
    }

    pub fn update_session<F>(&self, session_id: &str, mut update_fn: F) -> Option<Session>
    where
        F: FnMut(&mut Session),
    {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id)?;
        update_fn(session);
        session.updated_at = now_iso_like();
        Some(session.clone())
    }

    pub fn get_session(&self, session_id: &str) -> Option<Session> {
        self.sessions.lock().unwrap().get(session_id).cloned()
    }

    pub fn fail_session(&self, session_id: &str, code: &str, message: &str, remediation: &str) {
        let _ = self.update_session(session_id, |session| {
            session.state = SessionState::Failed;
            session.error = Some(auth_error(code, message, remediation));
        });
    }

    pub fn set_cancelled(&self, session_id: &str) -> Option<Session> {
        self.update_session(session_id, |session| {
            session.state = SessionState::Cancelled;
            session.error = None;
        })
    }

    pub fn session_payload(&self, session_id: &str) -> serde_json::Value {
        if let Some(session) = self.get_session(session_id) {
            json!({
                "ok": !matches!(session.state, SessionState::Failed),
                "session": session
            })
        } else {
            json!({
                "ok": false,
                "session": null,
                "error": auth_error("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
            })
        }
    }

    pub fn insert_process(&self, session_id: String, handle: ProcessHandle) {
        self.processes.lock().unwrap().insert(session_id, handle);
    }

    pub fn remove_process(&self, session_id: &str) -> Option<ProcessHandle> {
        self.processes.lock().unwrap().remove(session_id)
    }

    pub fn get_process(&self, session_id: &str) -> Option<ProcessHandle> {
        self.processes.lock().unwrap().get(session_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::SessionManager;
    use crate::auth_broker::types::{Provider, SessionState};

    #[test]
    fn creates_and_updates_session_lifecycle() {
        let manager = SessionManager::new();
        let session = manager.create_session(Provider::Claude);
        assert_eq!(session.state, SessionState::Idle);

        let _ = manager.update_session(&session.id, |s| {
            s.state = SessionState::Starting;
        });
        let stored = manager
            .get_session(&session.id)
            .expect("session should exist");
        assert_eq!(stored.state, SessionState::Starting);

        let cancelled = manager.set_cancelled(&session.id).expect("cancelled");
        assert_eq!(cancelled.state, SessionState::Cancelled);
    }
}
