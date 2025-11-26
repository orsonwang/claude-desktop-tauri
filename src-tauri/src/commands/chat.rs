use crate::api::send_message_stream;
use crate::auth::OAuthState;
use crate::models::Message;
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub api_key: Mutex<Option<String>>,
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    state: State<'_, AppState>,
    oauth_state: State<'_, OAuthState>,
    messages: Vec<Message>,
    model: String,
) -> Result<String, String> {
    // First try API key
    let api_key = state
        .api_key
        .lock()
        .map_err(|_| "Failed to access API key")?
        .clone();

    if let Some(key) = api_key {
        return send_message_stream(app, &key, None, messages, &model).await;
    }

    // Then try session key (from WebView login)
    let session_key = oauth_state
        .session
        .lock()
        .map_err(|_| "Failed to access session")?
        .as_ref()
        .map(|s| s.session_key.clone());

    if let Some(key) = session_key {
        return send_message_stream(app, "", Some(&key), messages, &model).await;
    }

    Err("請先設定 API key 或登入 Claude 帳號".to_string())
}

#[tauri::command]
pub fn set_api_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let mut api_key = state.api_key.lock().map_err(|_| "Failed to access state")?;
    *api_key = Some(key);
    Ok(())
}

#[tauri::command]
pub fn get_api_key(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let api_key = state.api_key.lock().map_err(|_| "Failed to access state")?;
    Ok(api_key.clone())
}
