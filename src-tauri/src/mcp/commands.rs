use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

use super::config::McpConfig;
use super::manager::{McpManager, ServerInfo};

type McpManagerState = Arc<RwLock<McpManager>>;

#[tauri::command]
pub async fn mcp_load_servers(manager: State<'_, McpManagerState>) -> Result<Vec<String>, String> {
    manager.read().await.load_servers().await
}

#[tauri::command]
pub async fn mcp_list_servers(
    manager: State<'_, McpManagerState>,
) -> Result<Vec<ServerInfo>, String> {
    Ok(manager.read().await.list_servers().await)
}

#[tauri::command]
pub async fn mcp_call_tool(
    manager: State<'_, McpManagerState>,
    server: String,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    eprintln!(
        "[TAURI] mcp_call_tool START: server={}, tool={}",
        server, tool
    );
    let result = manager
        .read()
        .await
        .call_tool(&server, &tool, arguments)
        .await;
    match &result {
        Ok(_) => eprintln!(
            "[TAURI] mcp_call_tool SUCCESS: server={}, tool={}",
            server, tool
        ),
        Err(e) => eprintln!(
            "[TAURI] mcp_call_tool ERROR: server={}, tool={}, error={}",
            server, tool, e
        ),
    }
    result
}

#[tauri::command]
pub async fn mcp_read_resource(
    manager: State<'_, McpManagerState>,
    server: String,
    uri: String,
) -> Result<Value, String> {
    manager.read().await.read_resource(&server, &uri).await
}

#[tauri::command]
pub async fn mcp_stop_server(
    manager: State<'_, McpManagerState>,
    name: String,
) -> Result<(), String> {
    manager.read().await.stop_server(&name).await
}

#[tauri::command]
pub fn mcp_get_config() -> Result<McpConfig, String> {
    McpConfig::load()
}

#[tauri::command]
pub fn mcp_save_config(config: McpConfig) -> Result<(), String> {
    config.save()
}

#[tauri::command]
pub fn mcp_get_config_path() -> String {
    McpConfig::config_path().to_string_lossy().to_string()
}
