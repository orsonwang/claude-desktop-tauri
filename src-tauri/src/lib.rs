mod error;
mod extensions;
mod mcp;
mod webview;

use mcp::McpManager;
use std::sync::Arc;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
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
        let b1 = if i + 1 < data.len() {
            data[i + 1] as usize
        } else {
            0
        };
        let b2 = if i + 2 < data.len() {
            data[i + 2] as usize
        } else {
            0
        };

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

/// 判斷 URL 是否為外部連結（非 claude.ai 網域）
fn is_external_url(url: &tauri::Url) -> bool {
    match url.host_str() {
        Some(host) => !host.ends_with("claude.ai") && !host.ends_with("anthropic.com"),
        None => false,
    }
}

/// 使用系統對話框顯示儲存檔案對話框
/// 優先使用 zenity（GNOME）或 kdialog（KDE）
fn show_save_dialog(file_name: &str, default_dir: &str) -> Option<String> {
    use std::process::Command;

    let default_path = format!("{}/{}", default_dir, file_name);

    // 嘗試使用 zenity（GNOME/GTK 桌面）
    let zenity_result = Command::new("zenity")
        .args([
            "--file-selection",
            "--save",
            "--confirm-overwrite",
            "--title=儲存檔案",
            &format!("--filename={}", default_path),
        ])
        .output();

    if let Ok(output) = zenity_result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
        // 如果 zenity 回傳非 0（使用者取消），回傳 None
        if output.status.code() == Some(1) {
            return None;
        }
    }

    // 備用：嘗試使用 kdialog（KDE 桌面）
    let kdialog_result = Command::new("kdialog")
        .args([
            "--getsavefilename",
            &default_path,
            "--title",
            "儲存檔案",
        ])
        .output();

    if let Ok(output) = kdialog_result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // 都失敗時，使用預設路徑
    eprintln!("[Download] No dialog available, using default path: {}", default_path);
    Some(default_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_manager = Arc::new(RwLock::new(McpManager::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        .setup(|app| {
            // 從設定檔取得視窗設定並手動建立視窗
            let window_config = app.config().app.windows.first().cloned();

            let handle = app.handle().clone();
            let mut builder = if let Some(config) = window_config {
                WebviewWindowBuilder::from_config(&handle, &config)?
            } else {
                // 備用設定
                WebviewWindowBuilder::new(&handle, "main", tauri::WebviewUrl::External(
                    "https://claude.ai".parse().unwrap()
                ))
                .title("Claude Desktop")
                .inner_size(1200.0, 800.0)
                .center()
            };

            // 外部連結處理：在預設瀏覽器中開啟
            let handle_for_new_window = app.handle().clone();
            builder = builder.on_new_window(move |url, _features| {
                eprintln!("[WebView] on_new_window: {}", url);
                if is_external_url(&url) {
                    eprintln!("[WebView] Opening external URL in browser: {}", url);
                    let _ = handle_for_new_window.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                } else {
                    // claude.ai 內部連結也拒絕新視窗，讓它在當前視窗開啟
                    NewWindowResponse::Deny
                }
            });

            // 下載處理：顯示儲存檔案對話框
            builder = builder.on_download(move |_webview, event| {
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        eprintln!("[Download] Requested: {} -> {:?}", url, destination);

                        // 從 URL query parameter 取得檔案名稱（claude.ai 使用 path= 參數）
                        let file_name = url
                            .query_pairs()
                            .find(|(key, _)| key == "path")
                            .map(|(_, value)| {
                                // path 參數包含完整路徑，取最後一段作為檔案名
                                std::path::Path::new(value.as_ref())
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or(&value)
                                    .to_string()
                            })
                            .or_else(|| {
                                // 備用：從 URL path 取得
                                url.path_segments()
                                    .and_then(|segments| segments.last())
                                    .map(|s| {
                                        urlencoding::decode(s)
                                            .unwrap_or_else(|_| s.into())
                                            .into_owned()
                                    })
                            })
                            .unwrap_or_else(|| "download".to_string());

                        eprintln!("[Download] File name: {}", file_name);

                        // 取得預設下載目錄
                        let default_dir = destination
                            .parent()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| {
                                dirs::download_dir()
                                    .map(|p| p.to_string_lossy().to_string())
                                    .unwrap_or_else(|| ".".to_string())
                            });

                        // 使用 zenity 或 kdialog 顯示儲存對話框（避免 GTK 主執行緒問題）
                        let save_path = show_save_dialog(&file_name, &default_dir);

                        if let Some(path) = save_path {
                            eprintln!("[Download] User selected: {:?}", path);
                            *destination = std::path::PathBuf::from(path);
                            true // 允許下載
                        } else {
                            eprintln!("[Download] User cancelled");
                            false // 取消下載
                        }
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        eprintln!(
                            "[Download] Finished: {} -> {:?}, success: {}",
                            url, path, success
                        );
                        true
                    }
                    _ => true,
                }
            });

            // 導航處理：外部連結在瀏覽器開啟
            let handle_for_nav = app.handle().clone();
            builder = builder.on_navigation(move |url| {
                if is_external_url(&url) {
                    eprintln!("[WebView] Navigation to external URL, opening in browser: {}", url);
                    let _ = handle_for_nav.opener().open_url(url.as_str(), None::<&str>);
                    false // 阻止 WebView 導航
                } else {
                    true // 允許 claude.ai 內部導航
                }
            });

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
