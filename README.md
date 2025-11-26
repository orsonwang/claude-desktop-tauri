# Claude Desktop Tauri

[English](#english) | [繁體中文](#繁體中文)

---

## English

A native Claude Desktop application for Linux/Wayland, built with Tauri 2.0.

This project wraps the official claude.ai website in a WebView, providing native desktop integration including **MCP (Model Context Protocol)** support and **Extensions** functionality.

### Features

- **Native Linux Support** - Runs natively on Linux with Wayland/X11 support
- **MCP Server Integration** - Full support for Model Context Protocol servers
- **Extensions Support** - Install and manage Claude Desktop Extensions
- **Extension Runtime** - Automatically start MCP servers from installed Extensions
- **User Config Placeholders** - Support for `${user_config.*}` in Extension manifests

### Screenshots

The application displays MCP servers in the Connectors menu, just like the official Claude Desktop:

- MCP servers appear with toggle switches
- Tools are available for Claude to use
- Extensions can be installed from the Extensions directory

### Requirements

- Linux (tested on Ubuntu/Debian with Wayland)
- Rust 1.70+
- Node.js 18+
- pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/anthropics/claude-desktop-tauri.git
cd claude-desktop-tauri

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

### MCP Server Configuration

Configure MCP servers in `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem", "/home/user/projects"],
      "env": {}
    }
  }
}
```

### Extensions

Extensions are stored in `~/.config/Claude/extensions/`. Install Extensions directly from the claude.ai Extensions directory.

Extension settings are stored in `~/.config/Claude/extension-settings/`.

### How It Works

This application simulates the official Claude Desktop's Electron environment:

1. **API Injection** - Injects `claudeAppBindings` and `claude.settings` APIs via Tauri's `js_init_script`
2. **MCP Communication** - Uses `window.postMessage()` with MessagePort to communicate with MCP servers
3. **Extension Runtime** - Automatically loads and starts MCP servers from installed Extensions

### Architecture

```
src-tauri/
  src/
    lib.rs            # Tauri main entry, plugin initialization
    desktop_api.rs    # Claude Desktop API simulation (js_init_script injection)
    mcp/              # MCP module
      client.rs       # MCP Client, subprocess management
      manager.rs      # MCP Server manager
      commands.rs     # Tauri commands for MCP API
    extensions/       # Extensions module
      mod.rs          # Extension install/list/delete/enable
```

### License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

### Acknowledgments

- [Anthropic](https://anthropic.com) for Claude and the Model Context Protocol
- [claude-desktop-debian](https://github.com/aaddrick/claude-desktop-debian) for reverse engineering insights

---

## 繁體中文

Linux/Wayland 原生 Claude Desktop 應用程式，使用 Tauri 2.0 建置。

本專案將官方 claude.ai 網站包裝在 WebView 中，提供原生桌面整合，包括 **MCP（Model Context Protocol）** 支援和 **Extensions** 功能。

### 功能特色

- **原生 Linux 支援** - 在 Linux 上原生執行，支援 Wayland/X11
- **MCP Server 整合** - 完整支援 Model Context Protocol 伺服器
- **Extensions 支援** - 安裝和管理 Claude Desktop 擴充功能
- **Extension Runtime** - 自動從已安裝的 Extensions 啟動 MCP 伺服器
- **用戶設定佔位符** - 支援 Extension manifest 中的 `${user_config.*}`

### 螢幕截圖

應用程式在 Connectors 選單中顯示 MCP 伺服器，與官方 Claude Desktop 相同：

- MCP 伺服器顯示開關切換
- 工具可供 Claude 使用
- 可從 Extensions 目錄安裝擴充功能

### 系統需求

- Linux（在 Ubuntu/Debian + Wayland 上測試）
- Rust 1.70+
- Node.js 18+
- pnpm

### 安裝方式

```bash
# 複製儲存庫
git clone https://github.com/anthropics/claude-desktop-tauri.git
cd claude-desktop-tauri

# 安裝依賴
pnpm install

# 開發模式執行
pnpm tauri dev

# 建置正式版本
pnpm tauri build
```

### MCP Server 設定

在 `~/.config/Claude/claude_desktop_config.json` 中設定 MCP 伺服器：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem", "/home/user/projects"],
      "env": {}
    }
  }
}
```

### Extensions 擴充功能

擴充功能儲存於 `~/.config/Claude/extensions/`。可直接從 claude.ai 的 Extensions 目錄安裝。

擴充功能設定儲存於 `~/.config/Claude/extension-settings/`。

### 運作原理

本應用程式模擬官方 Claude Desktop 的 Electron 環境：

1. **API 注入** - 透過 Tauri 的 `js_init_script` 注入 `claudeAppBindings` 和 `claude.settings` API
2. **MCP 通訊** - 使用 `window.postMessage()` 配合 MessagePort 與 MCP 伺服器通訊
3. **Extension Runtime** - 自動從已安裝的 Extensions 載入並啟動 MCP 伺服器

### 架構

```
src-tauri/
  src/
    lib.rs            # Tauri 主程式，插件初始化
    desktop_api.rs    # Claude Desktop API 模擬（js_init_script 注入）
    mcp/              # MCP 模組
      client.rs       # MCP Client，子程序管理
      manager.rs      # MCP Server 管理器
      commands.rs     # Tauri commands 暴露 MCP API
    extensions/       # Extensions 模組
      mod.rs          # Extension 安裝/列表/刪除/啟用
```

### 授權條款

Apache License 2.0 - 詳見 [LICENSE](LICENSE)。

### 致謝

- [Anthropic](https://anthropic.com) - Claude 和 Model Context Protocol
- [claude-desktop-debian](https://github.com/aaddrick/claude-desktop-debian) - 逆向工程參考
