use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
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
    loading: AtomicBool,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            loading: AtomicBool::new(false),
        }
    }

    pub async fn load_servers(&self) -> Result<Vec<String>, String> {
        // Prevent concurrent loading - if already loading, wait and return existing servers
        if self
            .loading
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            eprintln!("[MCP Manager] load_servers() - already loading, skipping");
            // Return existing loaded servers
            return Ok(self
                .clients
                .read()
                .await
                .keys()
                .cloned()
                .collect());
        }

        eprintln!("[MCP Manager] load_servers() started");
        let result = self.do_load_servers().await;
        self.loading.store(false, Ordering::SeqCst);
        eprintln!("[MCP Manager] load_servers() completed");
        result
    }

    async fn do_load_servers(&self) -> Result<Vec<String>, String> {
        let config = McpConfig::load()?;
        let mut loaded = Vec::new();

        eprintln!(
            "[MCP Manager] Found {} servers in config file",
            config.mcp_servers.len()
        );

        // Load servers from claude_desktop_config.json
        for (name, server_config) in config.mcp_servers {
            // Skip if already loaded
            if self.clients.read().await.contains_key(&name) {
                eprintln!("[MCP] Skipping {} - already loaded", name);
                continue;
            }

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
        eprintln!("[MCP Manager] Loading extension servers...");

        match extensions::extension_get_mcp_servers().await {
            Ok(ext_servers) => {
                eprintln!("[MCP] Found {} extension MCP servers", ext_servers.len());
                for ext_server in ext_servers {
                    // Use extension_id as server name to avoid conflicts
                    let server_name = format!("ext_{}", ext_server.extension_id);

                    // Skip if already loaded
                    if self.clients.read().await.contains_key(&server_name) {
                        eprintln!("[MCP] Skipping {} - already loaded", server_name);
                        continue;
                    }

                    let server_config = McpServerConfig {
                        command: ext_server.command.clone(),
                        args: ext_server.args.clone(),
                        env: ext_server.env.clone(),
                    };

                    eprintln!(
                        "[MCP] Loading extension server '{}' ({}) - cmd: {} {:?}",
                        server_name, ext_server.name, server_config.command, server_config.args
                    );

                    match McpClient::spawn(&server_name, &server_config) {
                        Ok(mut client) => {
                            if let Err(e) = client.initialize().await {
                                eprintln!(
                                    "[MCP] Failed to initialize '{}': {}",
                                    server_name, e
                                );
                                continue;
                            }
                            eprintln!("[MCP] Successfully loaded '{}'", server_name);
                            loaded.push(server_name.clone());
                            self.clients.write().await.insert(server_name, client);
                        }
                        Err(e) => {
                            eprintln!(
                                "[MCP] Failed to spawn '{}': {}",
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
