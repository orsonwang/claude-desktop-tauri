mod error;
mod extensions;
mod mcp;
mod webview;

use mcp::McpManager;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

/// Read file content as base64 for drag-drop upload
#[tauri::command]
async fn read_file_base64(path: String) -> Result<(String, String), String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let contents = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let base64 = base64_encode(&contents);

    Ok((file_name, base64))
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut i = 0;

    while i < data.len() {
        let b0 = data[i] as usize;
        let b1 = if i + 1 < data.len() { data[i + 1] as usize } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as usize } else { 0 };

        result.push(CHARS[b0 >> 2] as char);
        result.push(CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] as char);

        if i + 1 < data.len() {
            result.push(CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }

        if i + 2 < data.len() {
            result.push(CHARS[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }

        i += 3;
    }

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_manager = Arc::new(RwLock::new(McpManager::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 當有第二個實例嘗試啟動時，聚焦現有視窗
            eprintln!("[Single Instance] Another instance detected, focusing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(webview::init())
        .manage(mcp_manager)
        .invoke_handler(tauri::generate_handler![
            mcp::mcp_load_servers,
            mcp::mcp_list_servers,
            mcp::mcp_call_tool,
            mcp::mcp_read_resource,
            mcp::mcp_stop_server,
            mcp::mcp_get_config,
            mcp::mcp_save_config,
            mcp::mcp_get_config_path,
            extensions::extension_install,
            extensions::extension_list,
            extensions::extension_delete,
            extensions::extension_set_enabled,
            extensions::extension_get_path,
            extensions::extension_get_mcp_servers,
            extensions::extension_set_user_config,
            extensions::extension_get_user_config,
            extensions::extension_get_manifest,
            read_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
