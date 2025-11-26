mod desktop_api;
mod extensions;
mod mcp;

use mcp::{McpManager, McpProxy};
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_manager = Arc::new(RwLock::new(McpManager::new()));
    let mcp_manager_for_tauri = mcp_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(desktop_api::init())
        .manage(mcp_manager_for_tauri)
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
        .setup(move |_app| {
            // Start MCP proxy for tool interception
            let proxy = McpProxy::new(3456, mcp_manager.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = proxy.start().await {
                    eprintln!("[MCP Proxy] Failed to start: {}", e);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
