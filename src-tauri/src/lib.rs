mod desktop_api;
mod extensions;
mod mcp;

use mcp::McpManager;
use std::sync::Arc;
use tokio::sync::RwLock;

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
        .plugin(desktop_api::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
