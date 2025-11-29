//! Unified error types for the application.
//!
//! This module provides a centralized error handling system.
#![allow(dead_code)]

use serde::Serialize;
use std::fmt;

/// Application-wide error type
#[derive(Debug)]
pub enum AppError {
    /// MCP server related errors
    Mcp(McpError),
    /// Extension related errors
    Extension(ExtensionError),
    /// Configuration errors
    Config(ConfigError),
    /// I/O errors
    Io(std::io::Error),
    /// JSON serialization/deserialization errors
    Json(serde_json::Error),
    /// Generic error with message
    Other(String),
}

/// MCP-specific errors
#[derive(Debug)]
pub enum McpError {
    /// Server not found
    ServerNotFound(String),
    /// Failed to spawn server process
    SpawnFailed { server: String, reason: String },
    /// Server initialization failed
    InitFailed { server: String, reason: String },
    /// Request timeout
    Timeout { method: String, timeout_secs: u64 },
    /// Request cancelled
    Cancelled,
    /// JSON-RPC error from server
    JsonRpc { code: i64, message: String },
    /// Communication error
    Communication(String),
}

/// Extension-specific errors
#[derive(Debug)]
pub enum ExtensionError {
    /// Extension not found
    NotFound(String),
    /// Invalid manifest
    InvalidManifest { id: String, reason: String },
    /// Installation failed
    InstallFailed { id: String, reason: String },
    /// Missing required configuration
    MissingConfig { id: String, field: String },
    /// Invalid extension package
    InvalidPackage(String),
}

/// Configuration errors
#[derive(Debug)]
pub enum ConfigError {
    /// Config file not found
    NotFound(String),
    /// Failed to read config
    ReadFailed(String),
    /// Failed to write config
    WriteFailed(String),
    /// Invalid config format
    InvalidFormat(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Mcp(e) => write!(f, "MCP error: {}", e),
            AppError::Extension(e) => write!(f, "Extension error: {}", e),
            AppError::Config(e) => write!(f, "Config error: {}", e),
            AppError::Io(e) => write!(f, "I/O error: {}", e),
            AppError::Json(e) => write!(f, "JSON error: {}", e),
            AppError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl fmt::Display for McpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            McpError::ServerNotFound(name) => write!(f, "Server '{}' not found", name),
            McpError::SpawnFailed { server, reason } => {
                write!(f, "Failed to spawn server '{}': {}", server, reason)
            }
            McpError::InitFailed { server, reason } => {
                write!(f, "Failed to initialize server '{}': {}", server, reason)
            }
            McpError::Timeout {
                method,
                timeout_secs,
            } => {
                write!(f, "Request '{}' timed out after {}s", method, timeout_secs)
            }
            McpError::Cancelled => write!(f, "Request cancelled"),
            McpError::JsonRpc { code, message } => {
                write!(f, "JSON-RPC error {}: {}", code, message)
            }
            McpError::Communication(msg) => write!(f, "Communication error: {}", msg),
        }
    }
}

impl fmt::Display for ExtensionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExtensionError::NotFound(id) => write!(f, "Extension '{}' not found", id),
            ExtensionError::InvalidManifest { id, reason } => {
                write!(f, "Invalid manifest for '{}': {}", id, reason)
            }
            ExtensionError::InstallFailed { id, reason } => {
                write!(f, "Failed to install '{}': {}", id, reason)
            }
            ExtensionError::MissingConfig { id, field } => {
                write!(f, "Missing required config '{}' for '{}'", field, id)
            }
            ExtensionError::InvalidPackage(reason) => {
                write!(f, "Invalid extension package: {}", reason)
            }
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::NotFound(path) => write!(f, "Config file not found: {}", path),
            ConfigError::ReadFailed(reason) => write!(f, "Failed to read config: {}", reason),
            ConfigError::WriteFailed(reason) => write!(f, "Failed to write config: {}", reason),
            ConfigError::InvalidFormat(reason) => write!(f, "Invalid config format: {}", reason),
        }
    }
}

impl std::error::Error for AppError {}
impl std::error::Error for McpError {}
impl std::error::Error for ExtensionError {}
impl std::error::Error for ConfigError {}

// Conversions for ergonomic error handling
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e)
    }
}

impl From<McpError> for AppError {
    fn from(e: McpError) -> Self {
        AppError::Mcp(e)
    }
}

impl From<ExtensionError> for AppError {
    fn from(e: ExtensionError) -> Self {
        AppError::Extension(e)
    }
}

impl From<ConfigError> for AppError {
    fn from(e: ConfigError) -> Self {
        AppError::Config(e)
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}

// Serialize for Tauri command responses
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
}

impl From<AppError> for ErrorResponse {
    fn from(e: AppError) -> Self {
        let (code, message) = match &e {
            AppError::Mcp(McpError::ServerNotFound(_)) => ("MCP_SERVER_NOT_FOUND", e.to_string()),
            AppError::Mcp(McpError::Timeout { .. }) => ("MCP_TIMEOUT", e.to_string()),
            AppError::Mcp(_) => ("MCP_ERROR", e.to_string()),
            AppError::Extension(ExtensionError::NotFound(_)) => ("EXT_NOT_FOUND", e.to_string()),
            AppError::Extension(_) => ("EXT_ERROR", e.to_string()),
            AppError::Config(_) => ("CONFIG_ERROR", e.to_string()),
            AppError::Io(_) => ("IO_ERROR", e.to_string()),
            AppError::Json(_) => ("JSON_ERROR", e.to_string()),
            AppError::Other(_) => ("UNKNOWN_ERROR", e.to_string()),
        };
        ErrorResponse {
            code: code.to_string(),
            message,
        }
    }
}

// For Tauri command compatibility - convert to String
impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

/// Result type alias using AppError
pub type AppResult<T> = Result<T, AppError>;
