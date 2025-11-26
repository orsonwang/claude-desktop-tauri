use crate::models::{ChatRequest, Message, StreamEvent};
use futures_util::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter};

const API_URL: &str = "https://api.anthropic.com/v1/messages";

pub async fn send_message_stream(
    app: AppHandle,
    api_key: &str,
    oauth_token: Option<&str>,
    messages: Vec<Message>,
    model: &str,
) -> Result<String, String> {
    let client = Client::new();

    let request = ChatRequest {
        model: model.to_string(),
        max_tokens: 4096,
        messages,
        stream: true,
    };

    let mut req_builder = client
        .post(API_URL)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");

    // Use session cookie if available, otherwise use API key
    if let Some(session_key) = oauth_token {
        req_builder = req_builder.header("Cookie", format!("sessionKey={}", session_key));
    } else {
        req_builder = req_builder.header("x-api-key", api_key);
    }

    let response = req_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut full_response = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process SSE events
        while let Some(pos) = buffer.find("\n\n") {
            let event = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            if let Some(data) = event.strip_prefix("data: ") {
                if data == "[DONE]" {
                    continue;
                }

                if let Ok(stream_event) = serde_json::from_str::<StreamEvent>(data) {
                    if let Some(delta) = stream_event.delta {
                        if let Some(text) = delta.text {
                            full_response.push_str(&text);
                            // Emit chunk to frontend
                            let _ = app.emit("message-chunk", &text);
                        }
                    }
                }
            }
        }
    }

    // Signal stream complete
    let _ = app.emit("message-complete", &full_response);

    Ok(full_response)
}
