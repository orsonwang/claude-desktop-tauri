use crate::db::{Database, StoredConversation, StoredMessage};
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct DbState {
    pub db: Mutex<Option<Database>>,
}

#[tauri::command]
pub fn init_database(app: AppHandle, state: State<'_, DbState>) -> Result<(), String> {
    let db = Database::new(&app).map_err(|e| e.to_string())?;
    let mut db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    *db_lock = Some(db);
    Ok(())
}

#[tauri::command]
pub fn db_create_conversation(
    state: State<'_, DbState>,
    id: String,
    title: String,
) -> Result<StoredConversation, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.create_conversation(&id, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_conversations(state: State<'_, DbState>) -> Result<Vec<StoredConversation>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.get_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_conversation(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.delete_conversation(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_add_message(
    state: State<'_, DbState>,
    conversation_id: String,
    message: StoredMessage,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.add_message(&conversation_id, &message)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_messages(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<StoredMessage>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.get_messages(&conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_message(
    state: State<'_, DbState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.update_message_content(&id, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_conversation_title(
    state: State<'_, DbState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database")?;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    db.update_conversation_title(&id, &title)
        .map_err(|e| e.to_string())
}
