use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::client::McpClient;
use super::config::{McpConfig, McpServerConfig};
use crate::extensions;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub tools: Vec<super::client::McpTool>,
    pub resources: Vec<super::client::McpResource>,
}

pub struct McpManager {
    clients: Arc<RwLock<HashMap<String, McpClient>>>,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn load_servers(&self) -> Result<Vec<String>, String> {
        println!("[MCP Manager] load_servers() called");
        let config = McpConfig::load()?;
        let mut loaded = Vec::new();

        println!(
            "[MCP Manager] Found {} servers in config file",
            config.mcp_servers.len()
        );

        // Load servers from claude_desktop_config.json
        for (name, server_config) in config.mcp_servers {
            match McpClient::spawn(&name, &server_config) {
                Ok(mut client) => {
                    if let Err(e) = client.initialize().await {
                        eprintln!("Failed to initialize MCP server '{}': {}", name, e);
                        continue;
                    }
                    loaded.push(name.clone());
                    self.clients.write().await.insert(name, client);
                }
                Err(e) => {
                    eprintln!("Failed to spawn MCP server '{}': {}", name, e);
                }
            }
        }

        // Load servers from installed extensions
        println!("[MCP Manager] About to load extension servers...");
        use std::io::Write;
        std::io::stdout().flush().ok();

        match extensions::extension_get_mcp_servers().await {
            Ok(ext_servers) => {
                println!("[MCP] Found {} extension MCP servers", ext_servers.len());
                for ext_server in ext_servers {
                    // Use extension_id as server name to avoid conflicts
                    let server_name = format!("ext_{}", ext_server.extension_id);

                    // Skip if already loaded (from config file)
                    if self.clients.read().await.contains_key(&server_name) {
                        continue;
                    }

                    let server_config = McpServerConfig {
                        command: ext_server.command,
                        args: ext_server.args,
                        env: ext_server.env,
                    };

                    println!(
                        "[MCP] Loading extension server '{}' ({})",
                        server_name, ext_server.name
                    );

                    match McpClient::spawn(&server_name, &server_config) {
                        Ok(mut client) => {
                            if let Err(e) = client.initialize().await {
                                eprintln!(
                                    "Failed to initialize extension MCP server '{}': {}",
                                    server_name, e
                                );
                                continue;
                            }
                            loaded.push(server_name.clone());
                            self.clients.write().await.insert(server_name, client);
                        }
                        Err(e) => {
                            eprintln!(
                                "Failed to spawn extension MCP server '{}': {}",
                                server_name, e
                            );
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[MCP] Failed to get extension MCP servers: {}", e);
            }
        }

        Ok(loaded)
    }

    pub async fn list_servers(&self) -> Vec<ServerInfo> {
        let clients = self.clients.read().await;
        clients
            .iter()
            .map(|(name, client)| ServerInfo {
                name: name.clone(),
                tools: client.tools.clone(),
                resources: client.resources.clone(),
            })
            .collect()
    }

    pub async fn call_tool(
        &self,
        server: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, String> {
        let clients = self.clients.read().await;
        let client = clients
            .get(server)
            .ok_or_else(|| format!("Server '{}' not found", server))?;
        client.call_tool(tool, arguments).await
    }

    pub async fn read_resource(&self, server: &str, uri: &str) -> Result<Value, String> {
        let clients = self.clients.read().await;
        let client = clients
            .get(server)
            .ok_or_else(|| format!("Server '{}' not found", server))?;
        client.read_resource(uri).await
    }

    pub async fn stop_server(&self, name: &str) -> Result<(), String> {
        let mut clients = self.clients.write().await;
        clients
            .remove(name)
            .ok_or_else(|| format!("Server '{}' not found", name))?;
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn stop_all(&self) {
        self.clients.write().await.clear();
    }
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}
