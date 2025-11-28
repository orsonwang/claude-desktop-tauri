use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use super::config::McpServerConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(default, alias = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

pub struct McpClient {
    #[allow(dead_code)]
    name: String,
    process: Child,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    request_id: AtomicU64,
    pub tools: Vec<McpTool>,
    pub resources: Vec<McpResource>,
}

impl McpClient {
    pub fn spawn(name: &str, config: &McpServerConfig) -> Result<Self, String> {
        eprintln!(
            "[MCP] Spawning server '{}': {} {:?}",
            name, config.command, config.args
        );

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut process = cmd.spawn().map_err(|e| {
            eprintln!("[MCP] Failed to spawn '{}': {}", name, e);
            format!("Failed to spawn MCP server '{}': {}", name, e)
        })?;
        eprintln!("[MCP] Spawned server '{}' successfully", name);

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| format!("Failed to get stdin for '{}'", name))?;

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| format!("Failed to get stdout for '{}'", name))?;

        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| format!("Failed to get stderr for '{}'", name))?;

        let pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_clone = pending_requests.clone();
        let name_clone = name.to_string();

        // Spawn stdout reader thread
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(response) = serde_json::from_str::<Value>(&line) {
                        if let Some(id) = response.get("id").and_then(|v| v.as_u64()) {
                            if let Some(sender) = pending_clone.lock().unwrap().remove(&id) {
                                if let Some(error) = response.get("error") {
                                    let _ = sender.send(Err(error.to_string()));
                                } else if let Some(result) = response.get("result") {
                                    let _ = sender.send(Ok(result.clone()));
                                }
                            }
                        }
                    }
                }
            }
        });

        // Spawn stderr reader thread to capture MCP server errors
        let name_for_stderr = name_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    eprintln!("[MCP:{}:stderr] {}", name_for_stderr, line);
                }
            }
        });

        Ok(Self {
            name: name.to_string(),
            process,
            stdin: Arc::new(Mutex::new(stdin)),
            pending_requests,
            request_id: AtomicU64::new(1),
            tools: Vec::new(),
            resources: Vec::new(),
        })
    }

    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().unwrap().insert(id, tx);

        let mut request_str = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;
        request_str.push('\n');

        self.stdin
            .lock()
            .unwrap()
            .write_all(request_str.as_bytes())
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;

        rx.await.map_err(|_| "Request cancelled".to_string())?
    }

    pub async fn initialize(&mut self) -> Result<(), String> {
        eprintln!("[MCP] Initializing server '{}'...", self.name);
        let params = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "roots": { "listChanged": true },
                "sampling": {}
            },
            "clientInfo": {
                "name": "claude-desktop-tauri",
                "version": "0.1.0"
            }
        });

        eprintln!("[MCP] Sending initialize request to '{}'", self.name);
        let _result = self.send_request("initialize", params).await.map_err(|e| {
            eprintln!("[MCP] Initialize failed for '{}': {}", self.name, e);
            e
        })?;
        eprintln!("[MCP] Initialize succeeded for '{}'", self.name);

        // Send initialized notification
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        let mut notif_str = serde_json::to_string(&notification)
            .map_err(|e| format!("Failed to serialize notification: {}", e))?;
        notif_str.push('\n');

        self.stdin
            .lock()
            .unwrap()
            .write_all(notif_str.as_bytes())
            .map_err(|e| format!("Failed to send initialized notification: {}", e))?;

        // List tools
        if let Ok(result) = self.send_request("tools/list", json!({})).await {
            eprintln!("[MCP] tools/list response: {:?}", result);
            if let Some(tools) = result.get("tools").and_then(|v| v.as_array()) {
                self.tools = tools
                    .iter()
                    .filter_map(|t| {
                        eprintln!("[MCP] Parsing tool: {:?}", t);
                        serde_json::from_value(t.clone()).ok()
                    })
                    .collect();
                eprintln!("[MCP] Parsed tools: {:?}", self.tools);
            }
        }

        // List resources
        if let Ok(result) = self.send_request("resources/list", json!({})).await {
            if let Some(resources) = result.get("resources").and_then(|v| v.as_array()) {
                self.resources = resources
                    .iter()
                    .filter_map(|r| serde_json::from_value(r.clone()).ok())
                    .collect();
            }
        }

        Ok(())
    }

    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let params = json!({
            "name": name,
            "arguments": arguments
        });
        self.send_request("tools/call", params).await
    }

    pub async fn read_resource(&self, uri: &str) -> Result<Value, String> {
        let params = json!({
            "uri": uri
        });
        self.send_request("resources/read", params).await
    }

    #[allow(dead_code)]
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}
