use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct McpConfig {
    /// MCP 伺服器設定（序列化時使用 mcpServers 以相容官方格式）
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

impl<'de> Deserialize<'de> for McpConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;

        let mcp_servers = if let Some(obj) = value.as_object() {
            // 優先嘗試 mcpServers (camelCase) - 官方格式
            if let Some(servers) = obj.get("mcpServers") {
                serde_json::from_value(servers.clone()).unwrap_or_default()
            }
            // 然後嘗試 mcp_servers (snake_case)
            else if let Some(servers) = obj.get("mcp_servers") {
                serde_json::from_value(servers.clone()).unwrap_or_default()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        Ok(McpConfig { mcp_servers })
    }
}

impl McpConfig {
    pub fn config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Claude");
        config_dir.join("claude_desktop_config.json")
    }

    pub fn load() -> Result<Self, String> {
        let path = Self::config_path();

        if !path.exists() {
            return Ok(Self::default());
        }

        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;

        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
    }
}
