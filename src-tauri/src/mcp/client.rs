use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

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
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut process = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server '{}': {}", name, e))?;

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

        // Spawn stdout reader thread with improved error handling
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line_result in reader.lines() {
                match line_result {
                    Ok(line) => {
                        // Skip empty lines
                        if line.trim().is_empty() {
                            continue;
                        }

                        // Try to parse as JSON-RPC response
                        match serde_json::from_str::<Value>(&line) {
                            Ok(response) => {
                                // Handle JSON-RPC response
                                if let Some(id) = response.get("id").and_then(|v| v.as_u64()) {
                                    if let Some(sender) = pending_clone.lock().unwrap().remove(&id)
                                    {
                                        if let Some(error) = response.get("error") {
                                            eprintln!(
                                                "[MCP] Received error response: id={}, error={:?}",
                                                id, error
                                            );
                                            let _ = sender.send(Err(error.to_string()));
                                        } else if let Some(result) = response.get("result") {
                                            eprintln!(
                                                "[MCP] Received success response: id={}, result_size={} bytes",
                                                id,
                                                serde_json::to_string(result).map(|s| s.len()).unwrap_or(0)
                                            );
                                            let _ = sender.send(Ok(result.clone()));
                                        }
                                    } else {
                                        eprintln!(
                                            "[MCP] Received response for unknown or already-completed request: id={}",
                                            id
                                        );
                                    }
                                } else {
                                    // This might be a request from server to client (e.g., roots/list)
                                    if let Some(method) =
                                        response.get("method").and_then(|v| v.as_str())
                                    {
                                        eprintln!(
                                            "[MCP] Received request from server '{}': method={}, treating as notification",
                                            name_clone, method
                                        );
                                        // Server-to-client requests (like roots/list) should be handled
                                        // but we currently don't support them - just log
                                    } else {
                                        // Notification or malformed response
                                        eprintln!(
                                            "[MCP] Received notification or response without id: {:?}",
                                            response
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!(
                                    "[MCP] Failed to parse JSON response from '{}': {} | Line: {}",
                                    name_clone, e, line
                                );
                                // Don't exit - continue reading next line
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[MCP] Error reading line from '{}': {}", name_clone, e);
                        // Don't exit immediately - the error might be temporary
                        // But if it's EOF or broken pipe, the loop will end naturally
                    }
                }
            }
            eprintln!("[MCP] stdout reader thread exited for '{}'", name_clone);
        });

        // Spawn stderr reader thread to prevent blocking with improved error handling
        let name_clone = name.to_string();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line_result in reader.lines() {
                match line_result {
                    Ok(line) => {
                        if !line.trim().is_empty() {
                            eprintln!("[MCP stderr] {}: {}", name_clone, line);
                        }
                    }
                    Err(e) => {
                        eprintln!("[MCP] Error reading stderr from '{}': {}", name_clone, e);
                    }
                }
            }
            eprintln!("[MCP] stderr reader thread exited for '{}'", name_clone);
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
        {
            let mut pending = self.pending_requests.lock().unwrap();
            eprintln!("[MCP] Pending requests before insert: {}", pending.len());
            pending.insert(id, tx);
            eprintln!("[MCP] Pending requests after insert: {}", pending.len());
        }

        let mut request_str = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;
        request_str.push('\n');

        eprintln!(
            "[MCP] Sending request: id={}, method={}, server={}, params_size={} bytes",
            id,
            method,
            self.name,
            serde_json::to_string(&params).map(|s| s.len()).unwrap_or(0)
        );

        // Critical: Write and flush in a separate scope to drop the lock before await
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin
                .write_all(request_str.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;

            // Flush to ensure the request is sent immediately
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        } // Lock is dropped here, before the await

        // Add 30-second timeout to prevent hanging requests
        let result = timeout(Duration::from_secs(30), rx).await;

        match result {
            Ok(Ok(response)) => {
                eprintln!("[MCP] Request completed: id={}, method={}", id, method);
                response
            }
            Ok(Err(_)) => {
                eprintln!("[MCP] Request cancelled: id={}, method={}", id, method);
                Err("Request cancelled".to_string())
            }
            Err(_) => {
                // Timeout - remove from pending_requests to prevent memory leak
                self.pending_requests.lock().unwrap().remove(&id);
                eprintln!(
                    "[MCP] Request timeout after 30s: id={}, method={}, server={}",
                    id, method, self.name
                );
                Err(format!("Request timeout after 30s: {}", method))
            }
        }
    }

    pub async fn initialize(&mut self) -> Result<(), String> {
        let params = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "sampling": {}
            },
            "clientInfo": {
                "name": "claude-desktop-tauri",
                "version": "0.1.0"
            }
        });

        let _result = self.send_request("initialize", params).await?;

        // Send initialized notification
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        let mut notif_str = serde_json::to_string(&notification)
            .map_err(|e| format!("Failed to serialize notification: {}", e))?;
        notif_str.push('\n');

        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin
                .write_all(notif_str.as_bytes())
                .map_err(|e| format!("Failed to send initialized notification: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush initialized notification: {}", e))?;
        } // Drop lock before any potential await

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
