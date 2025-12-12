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

## 功能狀態（2025-12-12 更新）

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
- MCP Server 名稱顯示修正（displayName vs internalName）
- CSP 遙測請求靜默阻擋（`a-api.anthropic.com`）
- MCP 連線錯誤 toast 自動隱藏
- 定時 MCP 測試腳本（除錯用）

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

## ✅ MCP 連線問題（2025-11-29 已解決 - 方法 29）

### 解決方案摘要
**根本原因**：WebKitGTK 的 MessagePort 雙向通訊有缺陷 - `serverPort.postMessage()` 訊息無法到達 `clientPort`。

**解決方案**：創建假的 MessagePort 對象，完全繞過 WebKitGTK 原生實作：
1. 創建模擬 MessagePort API 的 JavaScript 對象
2. 劫持 `event.ports`，讓 claude.ai 收到我們的假 port
3. 雙向通訊完全由 JavaScript 控制

**程式碼位置**：`src/webview/scripts/02_fake_port.js`

---

## 🧪 定時 MCP 測試（2025-12-12）

用於除錯 MCP 連線穩定性的自動測試腳本。

### 功能
- 每 30 秒輪流呼叫 `read_file` 和 `list_directory`
- 測試路徑：`/tmp/read.txt` 和 `/tmp`
- 自動尋找 Filesystem MCP server

### 控制方式
```javascript
// 在 DevTools Console 執行
window.__mcpTestEnabled = false;  // 關閉測試
window.__mcpTestEnabled = true;   // 重新啟用
```

### 日誌輸出
```
[MCP Test] ======================================
[MCP Test] Test #1 - 2025-12-12T12:00:00.000Z
[MCP Test] Server: ext_ant.dir.ant.anthropic.filesystem
[MCP Test] Tool: read_file
[MCP Test] Args: {"path":"/tmp/read.txt"}
[MCP Test] SUCCESS in 150 ms
[MCP Test] Result: {"content":[{"type":"text","text":"test\n"}]}
[MCP Test] ======================================
```

### 測試前準備
```bash
echo "test content" > /tmp/read.txt
```

**程式碼位置**：`src/webview/scripts/01_polyfills.js` 第 227-331 行

---

## 📜 MCP 問題調查歷史（2025-11-28）

### 問題描述
MCP 工具在啟動約 1 分鐘後失效，或者第一次/第二次呼叫就失敗。

### 已嘗試但失敗的方法

#### 方法 1: MessagePort Heartbeat（❌ 失敗）
- **假設**: MessagePort 可能因為閒置而失效
- **實作**: 每 30 秒發送 `__heartbeat__` 訊息保持連線活躍
- **結果**: 失敗，MCP 仍然無法使用
- **原因分析**: MessagePort 不會因為閒置而失效

#### 方法 2: mcpStatusChanged IPC 事件（❌ 失敗）
- **假設**: 需要像官方 Electron 一樣發送 `mcpStatusChanged` 事件
- **實作**: 在 heartbeat 中觸發 `window.dispatchEvent(new CustomEvent('mcpStatusChanged', ...))`
- **結果**: 失敗，MCP 完全無法使用
- **原因分析**: claude.ai 可能不監聽這個事件，或事件格式不對

#### 方法 3: 移除 2 分鐘連線重用時間限制（❌ 失敗）
- **假設**: 2 分鐘後連線被判斷為 stale 並重建，導致問題
- **實作**: 移除 `connectionAge < 120000` 檢查，只要 port 有效就重用
- **結果**: 失敗，第一次就失敗
- **原因分析**: 問題不在時間限制

#### 方法 4: 每次都建立新連線（❌ 失敗）
- **假設**:
  1. MessagePort 只能 transfer 一次
  2. claude.ai 是 SPA，頁面內導航後前端可能移除舊的 MessagePort 監聽器
  3. 重用連線只返回 Promise 結果而不 postMessage，前端收不到 port
- **實作**: 每次 `connectToMcpServer` 都清除舊連線並建立新 MessageChannel
- **結果**: 失敗，問題依舊
- **已恢復**: 恢復到原本的 2 分鐘連線重用機制

#### 方法 5: 添加詳細調試日誌（✅ 有助於診斷）
- **目的**: 追蹤訊息流向，確定問題確切位置
- **實作**:
  1. 追蹤所有 `window.addEventListener('message')` 呼叫
  2. 監聽所有 MCP 相關的 `window.message` 事件
  3. 在 `serverPort.postMessage` 添加 try-catch 和成功/失敗日誌
- **結果**: 發現後端（Rust）所有 `tools/call` 都成功，問題在前端

#### 方法 6: 修復 listMcpServers 快取標記 + 移除連線重用（🔄 測試中）
- **發現的問題**:
  1. `listMcpServers` 成功後沒有設定 `window.__mcpServersLoaded = true`
  2. 導致每次呼叫都重新載入 MCP servers
  3. 連線重用時只返回 Promise 結果，但不發送 `mcp-server-connected` 事件
  4. claude.ai 前端期望每次 `connectToMcpServer` 都收到新的 MessagePort
- **修復**:
  1. 在 `listMcpServers` 成功後設定 `window.__mcpServersLoaded = true`
  2. 移除連線重用機制，每次都建立新 MessageChannel 並發送 `mcp-server-connected`
- **程式碼位置**: `desktop_api.rs` 第 681-689 行, 第 719-729 行
- **待驗證**: 用戶測試中

### 根本原因分析
1. **連線重用的問題**:
   - 當重用連線時，只返回 `Promise.resolve(existingConn.result)`
   - 但 claude.ai 前端透過 `window.addEventListener('message')` 監聽 `mcp-server-connected` 事件來獲取 MessagePort
   - 如果不發送 `mcp-server-connected` 事件，前端就沒有 port 可以發送請求
2. **listMcpServers 快取標記缺失**:
   - 每次呼叫都會執行 `mcp_load_servers`，雖然後端有防重複機制，但仍產生不必要的開銷

### 參考：官方 Electron 實作
位置: `/home/orsonwang/projects/claude_desktop_tauri/reference/claude-official/`

#### 關鍵發現（2025-11-28 更新）

**主進程 (index.js)**:
```javascript
// 使用 MessageChannelMain 建立通道
webContents.postMessage(Ya.McpServerConnected, {serverName, uuid}, [port2])
```

**渲染進程 preload (mainView.js)**:
```javascript
// ipcRenderer 接收 port，轉發給頁面
c.ipcRenderer.on(I.McpServerConnected,(t,e)=>{
    window.postMessage({
        type:I.McpServerConnected,
        serverName:e.serverName,
        uuid:e==null?void 0:e.uuid
    },"*",t.ports)  // 關鍵！t.ports 是從 ipcRenderer 接收的
});

// 自動重連事件
c.ipcRenderer.on(I.McpServerAutoReconnect,(t,e)=>{
    window.postMessage({type:I.McpServerAutoReconnect,serverName:e},"*")
});
```

**重要區別**:
- 官方：主進程建立 MessageChannelMain → ipcRenderer.on 接收 → window.postMessage 轉發
- 我們：js_init_script 直接建立 MessageChannel → window.postMessage 傳遞
- 問題：我們的 port 可能因為 SPA 導航而失效，因為 clientPort 的 onmessage 監聽器可能被移除

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
