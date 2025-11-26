use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir");
        std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");

        let db_path: PathBuf = app_dir.join("claude_desktop.db");
        let conn = Connection::open(db_path)?;

        let db = Database { conn };
        db.init_tables()?;

        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conversation
             ON messages(conversation_id)",
            [],
        )?;

        Ok(())
    }

    pub fn create_conversation(&self, id: &str, title: &str) -> Result<StoredConversation> {
        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, now, now],
        )?;

        Ok(StoredConversation {
            id: id.to_string(),
            title: title.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn get_conversations(&self) -> Result<Vec<StoredConversation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC",
        )?;

        let conversations = stmt.query_map([], |row| {
            Ok(StoredConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;

        conversations.collect()
    }

    pub fn update_conversation_title(&self, id: &str, title: &str) -> Result<()> {
        let now = chrono_now();
        self.conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )?;
        self.conn
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn add_message(&self, conversation_id: &str, message: &StoredMessage) -> Result<()> {
        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                message.id,
                conversation_id,
                message.role,
                message.content,
                message.timestamp
            ],
        )?;

        // Update conversation timestamp
        let now = chrono_now();
        self.conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )?;

        Ok(())
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<StoredMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, conversation_id, role, content, timestamp
             FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC",
        )?;

        let messages = stmt.query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;

        messages.collect()
    }

    pub fn update_message_content(&self, id: &str, content: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2",
            params![content, id],
        )?;
        Ok(())
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
