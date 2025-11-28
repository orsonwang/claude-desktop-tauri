# Claude Desktop Tauri

## 專案概述
Linux/Wayland 原生 Claude Desktop 應用程式，使用 Tauri 2.0 建置。
採用 WebView 包裝 claude.ai 網站的架構（與官方 Electron 版本相同設計）。

## 技術棧
- **後端**: Rust + Tauri 2.0
- **前端**: WebView 直接載入 https://claude.ai

## 開發指令
```bash
cargo tauri dev    # 開發模式
cargo tauri build  # 建置發佈版本
```

**前置需求**：安裝 tauri-cli
```bash
cargo install tauri-cli --version "^2.0"
```

## 可用工具
- ripgrep
- fd-find

## 專案架構
```
src-tauri/
  src/
    lib.rs            # Tauri 主程式，插件初始化
    desktop_api.rs    # Claude Desktop API 模擬（js_init_script 注入）
    mcp/
      mod.rs          # MCP 模組匯出
      config.rs       # 設定檔讀取/儲存
      client.rs       # MCP Client，子程序管理與 JSON-RPC 通訊
      manager.rs      # MCP Server 管理器
      commands.rs     # Tauri commands 暴露 MCP API
      proxy.rs        # HTTP Proxy（備用）
    extensions/
      mod.rs          # Extensions 模組
                      # - extension_install: 安裝擴充功能
                      # - extension_list: 列出已安裝擴充功能
                      # - extension_delete: 刪除擴充功能
                      # - extension_set_enabled: 啟用/停用
                      # - extension_get_mcp_servers: 取得 Extension MCP Server
                      # - extension_set_user_config: 設定用戶設定
                      # - extension_get_user_config: 取得用戶設定
                      # - extension_get_manifest: 取得 manifest
  tauri.conf.json     # 視窗設定，url 指向 claude.ai
dist/
  index.html          # Tauri 必要的佔位檔案
```

---

## 功能狀態（2025-11-26）

### ✅ 已完成功能
- claude.ai 偵測為 Claude Desktop (`window.isElectron = true`)
- 版本檢查通過 (0.14.10)
- MCP Server 連線成功（手動設定 + Extension）
- MCP 工具在 UI 顯示（Connectors Menu）
- MCP 工具執行成功（tools/call）
- Extensions 安裝/刪除/啟用/停用
- Extension Runtime（自動啟動 Extension MCP Server）
- `${user_config.*}` 佔位符解析
- MCP 連線重用機制（減少 timeout 錯誤）

---

## MCP Server 支援

### 設定檔位置
`~/.config/Claude/claude_desktop_config.json`

### 設定格式
```json
{
  "mcpServers": {
    "server-name": {
      "command": "/path/to/executable",
      "args": ["arg1", "arg2"],
      "env": {}
    }
  }
}
```

---

## Extensions 支援

### 擴充功能儲存路徑
```
~/.config/Claude/
  extensions/
    {extensionId}/
      manifest.json
      ... (解壓縮的 .dxt 內容)
  extension-settings/
    {extensionId}.json  # { "isEnabled": true, "user_config": {...} }
```

### Extension MCP Server 命名格式
- `ext_{extension_id}` - 例如 `ext_context7`

### user_config 佔位符
Extension manifest 支援以下佔位符：
- `${__dirname}` - Extension 安裝目錄
- `${user_config.field}` - 用戶設定值

**範例**：
```json
{
  "server": {
    "mcp_config": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem", "${user_config.allowed_directories}"]
    },
    "user_config": {
      "allowed_directories": {
        "type": "string",
        "multiple": true,
        "required": true
      }
    }
  }
}
```

---

## Claude Desktop API 模擬

透過 `desktop_api.rs` 的 `js_init_script` 在頁面載入前注入。

### 核心 API
- `window.isElectron = true`
- `window.claudeAppBindings` - MCP servers 列表、連線管理
- `window['claude.settings'].MCP` - MCP 設定 API
- `window['claude.settings'].Extensions` - Extensions API
- `window['claude.settings'].AppConfig` - 應用程式設定
- `window['claude.settings'].AppFeatures` - 功能支援

### MCP 通訊機制
使用 `window.postMessage()` 傳遞 MessagePort，模擬官方 Electron 的機制：

```javascript
// connectToMcpServer 實作
var channel = new MessageChannel();
var clientPort = channel.port1;  // 給 claude.ai 前端
var serverPort = channel.port2;  // 橋接到 Tauri 後端

// 透過 window.postMessage 傳遞 port
window.postMessage({
    type: 'mcp-server-connected',
    serverName: serverName,
    uuid: uuid
}, '*', [clientPort]);
```

---

## 重要決策記錄

### 架構轉型
- **問題**: OAuth PKCE 和 API key 認證都失敗
- **解決方案**: 採用 WebView 包裝 claude.ai（參考 claude-desktop-debian）

### MCP 通訊機制發現（2025-11-26）
- **問題**: claude.ai 不使用 `connectToMcpServer` 的返回值
- **發現**: 官方使用 `window.postMessage()` 將 MessagePort 傳遞給前端
- **解決方案**: 模擬相同機制，透過 postMessage 傳遞 port

### MCP 工具名稱規則
- **問題**: Extension ID 包含 `.`，不符合 `^[a-zA-Z0-9_-]{1,64}$` 規則
- **解決方案**: 將非法字元替換為底線，並建立反向映射表

### MCP 連線重用
- **問題**: 每次 `connectToMcpServer` 都建立新 MessageChannel，導致 timeout
- **解決方案**: 實作 2 分鐘內連線重用機制

### MCP 第二次呼叫失敗問題（2025-11-28）
- **問題**: MCP 工具第一次呼叫成功，第二次呼叫無回應或超時
- **根本原因**: 
  - stdout reader 線程在遇到 JSON 解析錯誤時直接退出
  - 缺少 flush 操作導致請求未立即發送
  - `MutexGuard` 跨越 await point 導致 Send trait 問題
- **解決方案**:
  - 改善 stdout/stderr reader 錯誤處理，遇到錯誤時記錄但不退出
  - 在每次寫入 stdin 後立即 flush
  - 使用區塊作用域在 await 前釋放 `MutexGuard`
  - 新增 30 秒請求超時機制
  - 新增詳細的日誌追蹤（請求 ID、結果大小等）

---

## 發佈資訊

### v0.1.2 (2025-11-27)
- 更新應用程式圖標為牛頭圖案
- 移除 tauri-plugin-updater 插件

### v0.1.1 (2025-11-26)
- 優化 MCP 連線重用機制，避免重複 timeout 錯誤
- 加入 deb 套件 maintainer 資訊
- 移除 pnpm 依賴，改用 cargo tauri 直接建置

### v0.1.0 (2025-11-26)
- 初始版本

- **GitHub**: https://github.com/orsonwang/claude-desktop-tauri
- **Release**: https://github.com/orsonwang/claude-desktop-tauri/releases
- **授權**: Apache 2.0

### 建置產出
```
src-tauri/target/release/bundle/
├── deb/Claude Desktop_x.x.x_amd64.deb     # Debian/Ubuntu
├── rpm/Claude Desktop-x.x.x-1.x86_64.rpm  # Fedora/RHEL
└── appimage/Claude Desktop_x.x.x_amd64.AppImage  # 通用
```

### 跨平台支援
- **Linux**: ✅ 完全支援（目前開發環境）
- **Windows/macOS**: 程式碼相容，需在對應平台編譯（Tauri 不支援跨平台編譯）

---

## 參考資源

### 官方文件
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Claude Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions)

### 參考實作
- `/home/orsonwang/projects/claude-desktop-debian` - 官方 Electron app.asar 分析來源
- [GitHub: claude-desktop-debian](https://github.com/aaddrick/claude-desktop-debian)
