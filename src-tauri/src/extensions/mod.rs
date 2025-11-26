use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use tauri::command;
use zip::ZipArchive;

/// Extension manifest structure (from .dxt file)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<ExtensionAuthor>,
    #[serde(default)]
    pub server: Option<ExtensionServer>,
    #[serde(default)]
    pub user_config: Option<HashMap<String, UserConfigField>>,
}

/// User config field definition in manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserConfigField {
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub multiple: Option<bool>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
}

/// Extension settings (stored in extension-settings/{id}.json)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionSettings {
    #[serde(rename = "isEnabled", default = "default_true")]
    pub is_enabled: bool,
    #[serde(default)]
    pub user_config: HashMap<String, serde_json::Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionAuthor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionServer {
    #[serde(rename = "type")]
    pub server_type: String,
    pub entry_point: String,
    #[serde(default)]
    pub mcp_config: Option<McpConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

/// Extension MCP Server config (resolved with actual paths)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionMcpServer {
    pub extension_id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
}

/// Installed extension info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledExtension {
    pub id: String,
    pub manifest: ExtensionManifest,
    pub path: String,
    pub enabled: bool,
}

/// Get extensions directory path
fn get_extensions_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".config").join("Claude").join("extensions")
}

/// Get extension settings directory path
fn get_extension_settings_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".config")
        .join("Claude")
        .join("extension-settings")
}

/// Install extension from binary data (.dxt file content)
#[command]
pub async fn extension_install(
    extension_id: String,
    dxt_data: Vec<u8>,
) -> Result<InstalledExtension, String> {
    let extensions_dir = get_extensions_dir();
    let extension_dir = extensions_dir.join(&extension_id);

    // Create directories if needed
    fs::create_dir_all(&extension_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Extract .dxt file (it's a zip archive)
    let cursor = Cursor::new(dxt_data);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Failed to read dxt archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;
        let outpath = match file.enclosed_name() {
            Some(path) => extension_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile =
                fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }

    // Read manifest.json
    let manifest_path = extension_dir.join("manifest.json");
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
    let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    // Create settings file if not exists
    let settings_dir = get_extension_settings_dir();
    fs::create_dir_all(&settings_dir).ok();
    let settings_path = settings_dir.join(format!("{}.json", extension_id));
    if !settings_path.exists() {
        fs::write(&settings_path, r#"{"isEnabled":true}"#).ok();
    }

    Ok(InstalledExtension {
        id: extension_id,
        manifest,
        path: extension_dir.to_string_lossy().to_string(),
        enabled: true,
    })
}

/// Get list of installed extensions
#[command]
pub async fn extension_list() -> Result<Vec<InstalledExtension>, String> {
    let extensions_dir = get_extensions_dir();
    let settings_dir = get_extension_settings_dir();

    if !extensions_dir.exists() {
        return Ok(vec![]);
    }

    let mut extensions = Vec::new();

    let entries = fs::read_dir(&extensions_dir)
        .map_err(|e| format!("Failed to read extensions directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let extension_id = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let manifest_content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[Extensions] Failed to read manifest for {}: {}",
                    extension_id, e
                );
                continue;
            }
        };

        let manifest: ExtensionManifest = match serde_json::from_str(&manifest_content) {
            Ok(m) => m,
            Err(e) => {
                eprintln!(
                    "[Extensions] Failed to parse manifest for {}: {}",
                    extension_id, e
                );
                continue;
            }
        };

        // Check if enabled
        let settings_path = settings_dir.join(format!("{}.json", extension_id));
        let enabled = if settings_path.exists() {
            fs::read_to_string(&settings_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("isEnabled").and_then(|e| e.as_bool()))
                .unwrap_or(true)
        } else {
            true
        };

        extensions.push(InstalledExtension {
            id: extension_id,
            manifest,
            path: path.to_string_lossy().to_string(),
            enabled,
        });
    }

    Ok(extensions)
}

/// Delete an extension
#[command]
pub async fn extension_delete(extension_id: String) -> Result<(), String> {
    let extensions_dir = get_extensions_dir();
    let extension_dir = extensions_dir.join(&extension_id);

    if extension_dir.exists() {
        fs::remove_dir_all(&extension_dir)
            .map_err(|e| format!("Failed to delete extension: {}", e))?;
    }

    // Also remove settings
    let settings_dir = get_extension_settings_dir();
    let settings_path = settings_dir.join(format!("{}.json", extension_id));
    if settings_path.exists() {
        fs::remove_file(&settings_path).ok();
    }

    Ok(())
}

/// Set extension enabled/disabled
#[command]
pub async fn extension_set_enabled(extension_id: String, enabled: bool) -> Result<(), String> {
    let settings_dir = get_extension_settings_dir();
    fs::create_dir_all(&settings_dir).ok();

    let settings_path = settings_dir.join(format!("{}.json", extension_id));
    let settings = serde_json::json!({ "isEnabled": enabled });

    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).unwrap(),
    )
    .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

/// Get extensions directory path
#[command]
pub async fn extension_get_path() -> Result<String, String> {
    Ok(get_extensions_dir().to_string_lossy().to_string())
}

/// Load extension settings from file
fn load_extension_settings(extension_id: &str) -> ExtensionSettings {
    let settings_dir = get_extension_settings_dir();
    let settings_path = settings_dir.join(format!("{}.json", extension_id));

    if settings_path.exists() {
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        ExtensionSettings::default()
    }
}

/// Resolve ${user_config.xxx} placeholders in a string
fn resolve_user_config_placeholder(
    arg: &str,
    user_config: &HashMap<String, serde_json::Value>,
) -> Vec<String> {
    // Check if arg contains ${user_config.xxx} pattern
    if let Some(start) = arg.find("${user_config.") {
        if let Some(end) = arg[start..].find('}') {
            let placeholder = &arg[start..start + end + 1];
            let key = &arg[start + 14..start + end]; // Extract key after "${user_config."

            if let Some(value) = user_config.get(key) {
                match value {
                    // For array values (like allowed_directories), expand to multiple args
                    serde_json::Value::Array(arr) => {
                        return arr
                            .iter()
                            .filter_map(|v| v.as_str().map(|s| arg.replace(placeholder, s)))
                            .collect();
                    }
                    // For string values, simple replacement
                    serde_json::Value::String(s) => {
                        return vec![arg.replace(placeholder, s)];
                    }
                    // For other types, convert to string
                    _ => {
                        return vec![arg.replace(placeholder, &value.to_string())];
                    }
                }
            } else {
                // Placeholder not found in user_config, return empty (will be filtered)
                return vec![];
            }
        }
    }
    // No placeholder, return as-is
    vec![arg.to_string()]
}

/// Get MCP server configs from all enabled extensions
#[command]
pub async fn extension_get_mcp_servers() -> Result<Vec<ExtensionMcpServer>, String> {
    println!("[Extensions] Getting MCP servers from extensions...");
    let extensions = extension_list().await?;
    println!(
        "[Extensions] Found {} installed extensions",
        extensions.len()
    );
    let mut mcp_servers = Vec::new();

    for ext in extensions {
        println!(
            "[Extensions] Checking extension: {} (enabled: {})",
            ext.id, ext.enabled
        );

        // Skip disabled extensions
        if !ext.enabled {
            println!("[Extensions] Skipping disabled extension: {}", ext.id);
            continue;
        }

        // Load extension settings (includes user_config values)
        let settings = load_extension_settings(&ext.id);

        // Check if extension has MCP server config
        println!(
            "[Extensions] Extension {} has server: {}",
            ext.id,
            ext.manifest.server.is_some()
        );
        if let Some(server) = &ext.manifest.server {
            println!(
                "[Extensions] Extension {} has mcp_config: {}",
                ext.id,
                server.mcp_config.is_some()
            );
            if let Some(mcp_config) = &server.mcp_config {
                // Resolve placeholders in args
                let mut resolved_args: Vec<String> = Vec::new();
                let mut has_unresolved_required = false;

                for arg in &mcp_config.args {
                    // First resolve ${__dirname}
                    let arg_with_dirname = arg.replace("${__dirname}", &ext.path);

                    // Then resolve ${user_config.xxx}
                    if arg_with_dirname.contains("${user_config.") {
                        let expanded = resolve_user_config_placeholder(
                            &arg_with_dirname,
                            &settings.user_config,
                        );
                        if expanded.is_empty() {
                            // Check if this is a required field
                            let key = arg_with_dirname
                                .split("${user_config.")
                                .nth(1)
                                .and_then(|s| s.split('}').next())
                                .unwrap_or("");
                            if let Some(user_config_def) = &ext.manifest.user_config {
                                if let Some(field_def) = user_config_def.get(key) {
                                    if field_def.required.unwrap_or(false) {
                                        has_unresolved_required = true;
                                        println!(
                                            "[Extensions] Extension {} has unresolved required user_config: {}",
                                            ext.id, key
                                        );
                                    }
                                }
                            }
                        } else {
                            resolved_args.extend(expanded);
                        }
                    } else {
                        resolved_args.push(arg_with_dirname);
                    }
                }

                // Skip extension if required user_config is missing
                if has_unresolved_required {
                    println!(
                        "[Extensions] Skipping extension {} due to missing required user_config",
                        ext.id
                    );
                    continue;
                }

                mcp_servers.push(ExtensionMcpServer {
                    extension_id: ext.id.clone(),
                    name: ext
                        .manifest
                        .display_name
                        .clone()
                        .unwrap_or(ext.manifest.name.clone()),
                    command: mcp_config.command.clone(),
                    args: resolved_args,
                    env: mcp_config.env.clone(),
                });
            }
        }
    }

    Ok(mcp_servers)
}

/// Set user config for an extension
#[command]
pub async fn extension_set_user_config(
    extension_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let settings_dir = get_extension_settings_dir();
    fs::create_dir_all(&settings_dir).ok();

    let settings_path = settings_dir.join(format!("{}.json", extension_id));

    // Load existing settings
    let mut settings = load_extension_settings(&extension_id);

    // Update user_config
    settings.user_config.insert(key, value);

    // Save settings
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

/// Get user config for an extension
#[command]
pub async fn extension_get_user_config(
    extension_id: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let settings = load_extension_settings(&extension_id);
    Ok(settings.user_config)
}

/// Get extension manifest (including user_config definitions)
#[command]
pub async fn extension_get_manifest(extension_id: String) -> Result<ExtensionManifest, String> {
    let extensions_dir = get_extensions_dir();
    let manifest_path = extensions_dir.join(&extension_id).join("manifest.json");

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))
}
