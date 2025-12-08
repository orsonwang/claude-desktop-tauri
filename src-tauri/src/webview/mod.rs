//! WebView JavaScript injection module.
//!
//! This module manages the JavaScript code that is injected into the WebView
//! before the page loads. The scripts simulate the Electron Desktop API that
//! claude.ai expects.
//!
//! ## Script Loading Order
//! 1. `01_polyfills.js` - Basic polyfills and toast hiding
//! 2. `02_fake_port.js` - FakeMessagePort system (Method 29 fix)
//! 3. `03_electron_api.js` - Electron IPC simulation
//! 4. `04_mcp_bridge.js` - MCP transport and JSON-RPC
//! 5. `05_mcp_manager.js` - MCP server manager
//! 6. `06_file_handling.js` - Drag-drop and clipboard support

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// JavaScript scripts embedded at compile time
mod scripts {
    /// Polyfills and toast hiding
    pub const POLYFILLS: &str = include_str!("scripts/01_polyfills.js");
    /// FakeMessagePort system
    pub const FAKE_PORT: &str = include_str!("scripts/02_fake_port.js");
    /// Electron API simulation
    pub const ELECTRON_API: &str = include_str!("scripts/03_electron_api.js");
    /// MCP bridge and JSON-RPC
    pub const MCP_BRIDGE: &str = include_str!("scripts/04_mcp_bridge.js");
    /// MCP manager
    pub const MCP_MANAGER: &str = include_str!("scripts/05_mcp_manager.js");
    /// File drag-drop and clipboard handling
    pub const FILE_HANDLING: &str = include_str!("scripts/06_file_handling.js");
}

/// Returns the platform string for the current OS.
fn get_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    { "win32" }
    #[cfg(target_os = "macos")]
    { "darwin" }
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { "linux" }
}

/// Returns the architecture string for the current platform.
fn get_arch() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    { "x64" }
    #[cfg(target_arch = "aarch64")]
    { "arm64" }
    #[cfg(target_arch = "x86")]
    { "ia32" }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "x86")))]
    { "x64" }
}

/// Builds the complete init script by concatenating all JavaScript files.
fn build_init_script() -> String {
    let platform = get_platform();
    let arch = get_arch();

    // Header comment with platform info
    let header = format!(
        r#"// Claude Desktop API - Injected before page load
window.isElectron = true;
window.__TAURI_PLATFORM__ = '{}';
window.__TAURI_ARCH__ = '{}';
"#,
        platform, arch
    );

    // Concatenate all scripts in order
    [
        header.as_str(),
        scripts::POLYFILLS,
        scripts::FAKE_PORT,
        scripts::ELECTRON_API,
        scripts::MCP_BRIDGE,
        scripts::MCP_MANAGER,
        scripts::FILE_HANDLING,
    ]
    .join("\n\n")
}

/// Creates the desktop-api plugin with JavaScript injection.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("desktop-api")
        .js_init_script(build_init_script())
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scripts_not_empty() {
        assert!(!scripts::POLYFILLS.is_empty());
        assert!(!scripts::FAKE_PORT.is_empty());
        assert!(!scripts::ELECTRON_API.is_empty());
        assert!(!scripts::MCP_BRIDGE.is_empty());
        assert!(!scripts::MCP_MANAGER.is_empty());
        assert!(!scripts::FILE_HANDLING.is_empty());
    }

    #[test]
    fn test_build_init_script() {
        let script = build_init_script();
        // Should contain the isElectron flag
        assert!(script.contains("window.isElectron = true"));
        // Should contain FakeMessagePort
        assert!(script.contains("FakeMessagePort"));
        // Should be reasonably sized (original was ~130KB)
        assert!(script.len() > 100_000);
    }
}
