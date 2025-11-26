use http_body_util::{BodyExt, Full};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{body::Incoming, Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use super::manager::McpManager;

pub struct McpProxy {
    port: u16,
    manager: Arc<RwLock<McpManager>>,
}

impl McpProxy {
    pub fn new(port: u16, manager: Arc<RwLock<McpManager>>) -> Self {
        Self { port, manager }
    }

    pub async fn start(&self) -> Result<(), String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|e| format!("Failed to bind proxy: {}", e))?;

        println!("[MCP Proxy] Listening on http://{}", addr);

        let manager = self.manager.clone();

        tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(conn) => conn,
                    Err(e) => {
                        eprintln!("[MCP Proxy] Accept error: {}", e);
                        continue;
                    }
                };

                let io = TokioIo::new(stream);
                let manager = manager.clone();

                tokio::spawn(async move {
                    let service = service_fn(move |req| {
                        let manager = manager.clone();
                        handle_request(req, manager)
                    });

                    if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                        eprintln!("[MCP Proxy] Connection error: {}", e);
                    }
                });
            }
        });

        Ok(())
    }
}

async fn handle_request(
    req: Request<Incoming>,
    _manager: Arc<RwLock<McpManager>>,
) -> Result<Response<Full<bytes::Bytes>>, Infallible> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri.path();

    println!("[MCP Proxy] {} {}", method, path);

    // Forward request to claude.ai API
    let client = reqwest::Client::new();

    // Build target URL
    let target_url = format!(
        "https://claude.ai{}",
        uri.path_and_query().map(|pq| pq.as_str()).unwrap_or(path)
    );

    // Collect headers
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        if name != "host" {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()) {
                if let Ok(value) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                    headers.insert(name, value);
                }
            }
        }
    }

    // Get request body
    let body_bytes = req.collect().await.unwrap().to_bytes();

    // Make request to target
    let response = match method.as_str() {
        "GET" => client.get(&target_url).headers(headers).send().await,
        "POST" => {
            client
                .post(&target_url)
                .headers(headers)
                .body(body_bytes.to_vec())
                .send()
                .await
        }
        "PUT" => {
            client
                .put(&target_url)
                .headers(headers)
                .body(body_bytes.to_vec())
                .send()
                .await
        }
        "DELETE" => client.delete(&target_url).headers(headers).send().await,
        _ => {
            return Ok(Response::builder()
                .status(405)
                .body(Full::new(bytes::Bytes::from("Method not allowed")))
                .unwrap());
        }
    };

    match response {
        Ok(resp) => {
            let status = resp.status();
            let response_body = resp.bytes().await.unwrap_or_default();

            // TODO: Parse response for tool_use and execute MCP tools
            // For now, just forward the response

            Ok(Response::builder()
                .status(status.as_u16())
                .body(Full::new(response_body))
                .unwrap())
        }
        Err(e) => {
            eprintln!("[MCP Proxy] Request failed: {}", e);
            Ok(Response::builder()
                .status(502)
                .body(Full::new(bytes::Bytes::from(format!("Proxy error: {}", e))))
                .unwrap())
        }
    }
}
