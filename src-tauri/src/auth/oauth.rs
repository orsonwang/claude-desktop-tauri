use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionAuth {
    pub session_key: String,
}

pub struct OAuthState {
    pub session: Arc<Mutex<Option<SessionAuth>>>,
}

impl Default for OAuthState {
    fn default() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub fn set_session_key(
    state: tauri::State<'_, OAuthState>,
    session_key: String,
) -> Result<(), String> {
    let mut session_lock = state.session.lock().map_err(|_| "Failed to lock session")?;
    *session_lock = Some(SessionAuth { session_key });
    Ok(())
}

#[tauri::command]
pub fn get_session_key(state: tauri::State<'_, OAuthState>) -> Result<Option<String>, String> {
    let session_lock = state.session.lock().map_err(|_| "Failed to lock session")?;
    Ok(session_lock.as_ref().map(|s| s.session_key.clone()))
}

#[tauri::command]
pub fn clear_session(state: tauri::State<'_, OAuthState>) -> Result<(), String> {
    let mut session_lock = state.session.lock().map_err(|_| "Failed to lock session")?;
    *session_lock = None;
    Ok(())
}
