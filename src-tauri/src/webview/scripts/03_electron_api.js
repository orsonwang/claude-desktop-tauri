// ========================================
// Electron IPC 模擬 - 核心機制
// ========================================

// IPC 事件監聽器存儲
window.__electronIpcListeners = {};
window.__electronIpcOnceListeners = {};

// 模擬 Electron 的 require 函數
window.require = function(moduleName) {
    if (moduleName === 'electron') {
        return {
            ipcRenderer: window.__ipcRenderer,
            contextBridge: window.__contextBridge,
            shell: {
                openExternal: function(url) {
                    window.open(url, '_blank');
                    return Promise.resolve();
                }
            }
        };
    }
    console.warn('[Electron] require() called with unknown module:', moduleName);
    return {};
};

// 模擬 ipcRenderer
window.__ipcRenderer = {
    // invoke - 雙向通訊，返回 Promise
    invoke: async function(channel, ...args) {
        console.log('[IPC] invoke CALLED:', channel);
        console.log('[IPC] invoke args:', JSON.stringify(args).substring(0, 200));
        // 記錄所有呼叫的 invoke channel
        if (!window.__invokedIpcChannels) window.__invokedIpcChannels = [];
        if (window.__invokedIpcChannels.indexOf(channel) < 0) {
            window.__invokedIpcChannels.push(channel);
            console.log('[IPC] All invoked channels:', window.__invokedIpcChannels);
        }

        // 等待 Tauri 初始化
        if (!window.__TAURI__) {
            for (var i = 0; i < 50; i++) {
                await new Promise(function(r) { setTimeout(r, 100); });
                if (window.__TAURI__) break;
            }
        }

        // 解析 channel 名稱，官方格式: $eipc_message$_UUID_$_namespace_$_interface_$_method
        var channelParts = channel.split('_$_');
        var namespace = channelParts.length > 1 ? channelParts[1] : '';
        var iface = channelParts.length > 2 ? channelParts[2] : '';
        var method = channelParts.length > 3 ? channelParts[3] : channel;

        console.log('[IPC] Parsed:', { namespace: namespace, iface: iface, method: method });

        // 路由到對應的處理函數
        try {
            // MCP 相關
            if (iface === 'MCP' || namespace === 'claude.settings' && method.toLowerCase().indexOf('mcp') >= 0) {
                return await window.__handleMcpIpc(method, args);
            }
            // Extensions 相關
            if (iface === 'Extensions') {
                return await window.__handleExtensionsIpc(method, args);
            }
            // AppConfig 相關
            if (iface === 'AppConfig') {
                return await window.__handleAppConfigIpc(method, args);
            }
            // AppFeatures 相關
            if (iface === 'AppFeatures') {
                return await window.__handleAppFeaturesIpc(method, args);
            }
            // 通用處理
            return await window.__handleGenericIpc(channel, args);
        } catch (e) {
            console.error('[IPC] invoke error:', e);
            throw e;
        }
    },

    // send - 單向通訊
    send: function(channel, ...args) {
        console.log('[IPC] send:', channel, args);
        // 觸發本地監聽器
        window.__triggerIpcEvent(channel, args);
    },

    // sendSync - 同步發送（模擬）
    sendSync: function(channel, ...args) {
        console.log('[IPC] sendSync:', channel, args);
        return null;
    },

    // on - 監聯事件
    on: function(channel, callback) {
        console.log('[IPC] on REGISTERED:', channel);
        // 記錄所有註冊的 channel 以便分析
        if (!window.__registeredIpcChannels) window.__registeredIpcChannels = [];
        if (window.__registeredIpcChannels.indexOf(channel) < 0) {
            window.__registeredIpcChannels.push(channel);
            console.log('[IPC] All registered channels:', window.__registeredIpcChannels);
        }
        if (!window.__electronIpcListeners[channel]) {
            window.__electronIpcListeners[channel] = [];
        }
        window.__electronIpcListeners[channel].push(callback);
        return window.__ipcRenderer;
    },

    // once - 監聽一次
    once: function(channel, callback) {
        console.log('[IPC] once:', channel);
        if (!window.__electronIpcOnceListeners[channel]) {
            window.__electronIpcOnceListeners[channel] = [];
        }
        window.__electronIpcOnceListeners[channel].push(callback);
        return window.__ipcRenderer;
    },

    // removeListener - 移除監聽器
    removeListener: function(channel, callback) {
        if (window.__electronIpcListeners[channel]) {
            var idx = window.__electronIpcListeners[channel].indexOf(callback);
            if (idx >= 0) window.__electronIpcListeners[channel].splice(idx, 1);
        }
        return window.__ipcRenderer;
    },

    // removeAllListeners - 移除所有監聽器
    removeAllListeners: function(channel) {
        if (channel) {
            delete window.__electronIpcListeners[channel];
            delete window.__electronIpcOnceListeners[channel];
        } else {
            window.__electronIpcListeners = {};
            window.__electronIpcOnceListeners = {};
        }
        return window.__ipcRenderer;
    }
};

// 觸發 IPC 事件（支援 MessagePort 傳遞）
window.__triggerIpcEvent = function(channel, args, ports) {
    var event = {
        sender: window.__ipcRenderer,
        ports: ports || []  // Electron 的 event.ports 用於傳遞 MessagePort
    };

    console.log('[IPC] triggerIpcEvent:', channel, 'listeners:', window.__electronIpcListeners[channel] ? window.__electronIpcListeners[channel].length : 0, 'ports:', ports ? ports.length : 0);

    // 觸發持續監聯器
    if (window.__electronIpcListeners[channel]) {
        for (var i = 0; i < window.__electronIpcListeners[channel].length; i++) {
            try {
                console.log('[IPC] Calling listener', i, 'for channel:', channel);
                window.__electronIpcListeners[channel][i](event, ...args);
            } catch (e) {
                console.error('[IPC] Event handler error:', e);
            }
        }
    } else {
        console.log('[IPC] No listeners for channel:', channel);
    }

    // 觸發一次性監聽器
    if (window.__electronIpcOnceListeners[channel]) {
        var listeners = window.__electronIpcOnceListeners[channel];
        window.__electronIpcOnceListeners[channel] = [];
        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](event, ...args);
            } catch (e) {
                console.error('[IPC] Once event handler error:', e);
            }
        }
    }
};

// MCP IPC 處理函數
window.__handleMcpIpc = async function(method, args) {
    console.log('[IPC:MCP] Handling:', method);

    switch (method) {
        case 'isLocalDevMcpEnabled':
            return true;

        case 'getMcpServersConfig':
            if (window.__TAURI__) {
                var config = await window.__TAURI__.core.invoke('mcp_get_config');
                return config.mcpServers || config.mcp_servers || {};
            }
            return {};

        case 'getMcpServersConfigWithStatus':
            // 必須返回 Object 格式 { serverName: serverData }，不是 Array！
            if (window.claudeAppBindings) {
                var serversArray = await window.claudeAppBindings.listMcpServers();
                // 轉換 Array 為 Object（以 server name 為 key）
                var serversObj = {};
                for (var i = 0; i < serversArray.length; i++) {
                    var srv = serversArray[i];
                    serversObj[srv.name] = srv;
                }
                console.log('[IPC:MCP] getMcpServersConfigWithStatus returning Object:', Object.keys(serversObj));
                return serversObj;
            }
            return {};

        case 'setMcpServerConfigs':
            console.log('[IPC:MCP] setMcpServerConfigs:', args[0]);
            return;

        case 'connectToMcpServer':
            var serverNameOrConfig = args[0];
            console.log('[IPC:MCP] connectToMcpServer:', serverNameOrConfig);

            // 直接呼叫 claudeAppBindings.connectToMcpServer
            // 這會透過 window.postMessage 發送 'mcp-server-connected' 事件，附帶 MessagePort
            return await window.claudeAppBindings.connectToMcpServer(serverNameOrConfig);

        case 'disconnectFromMcpServer':
            var serverName = args[0];
            console.log('[IPC:MCP] disconnectFromMcpServer:', serverName);
            if (window.__mcpTransports[serverName]) {
                delete window.__mcpTransports[serverName];
            }
            return { success: true };

        case 'getMcpServerStatus':
            var serverName = args[0];
            var servers = window.__mcpServersCache || {};
            if (servers[serverName]) {
                return {
                    status: 'running',
                    error: null,
                    tools: servers[serverName].tools || [],
                    resources: servers[serverName].resources || []
                };
            }
            return { status: 'disconnected', error: null };

        case 'callMcpTool':
            var serverName = args[0];
            var toolName = args[1];
            var toolArgs = args[2] || {};
            console.log('[IPC:MCP] callMcpTool:', serverName, toolName, toolArgs);
            return await window.__CLAUDE_DESKTOP_MCP__.callTool(serverName, toolName, toolArgs);

        case 'listMcpTools':
            var serverName = args[0];
            var servers = window.__mcpServersCache || {};
            if (servers[serverName]) {
                return servers[serverName].tools || [];
            }
            return [];

        case 'revealConfig':
        case 'revealLogs':
            return;

        default:
            console.warn('[IPC:MCP] Unknown method:', method);
            return null;
    }
};

// Extensions IPC 處理函數
window.__handleExtensionsIpc = async function(method, args) {
    console.log('[IPC:Extensions] Handling:', method);

    switch (method) {
        case 'isExtensionsEnabled':
            return true;

        case 'isDirectoryEnabled':
            return true;

        case 'getInstalledExtensionsWithState':
            return [];

        case 'getCompatibilityCheckResult':
            // 直接返回 compatibility result 物件（不需要 state 包裝）
            // 根據官方 yJ 驗證函數的要求
            return {
                nodeVersion: '20.18.0',
                builtInNodeVersion: '20.18.0',
                pythonVersion: null,
                appVersion: '0.14.10',
                supportedLatestMcpbManifestVersion: '1.0'
            };

        case 'getExtensionSettings':
            return { isEnabled: true };

        case 'setExtensionSettings':
            return;

        default:
            console.warn('[IPC:Extensions] Unknown method:', method);
            return null;
    }
};

// AppConfig IPC 處理函數
window.__handleAppConfigIpc = async function(method, args) {
    console.log('[IPC:AppConfig] Handling:', method);

    switch (method) {
        case 'getAppConfig':
            return {
                hasCompletedOnboarding: true,
                lastWindowState: null,
                mcpServers: await window['claude.settings'].MCP.getMcpServersConfig(),
                features: {
                    isSwiftEnabled: false,
                    isStudioEnabled: false,
                    isDxtEnabled: true,
                    isDxtDirectoryEnabled: true,
                    isLocalDevMcpEnabled: true
                },
                isUsingBuiltInNodeForMcp: true,
                isDxtAutoUpdatesEnabled: false
            };

        case 'setAppFeature':
            return true;

        case 'setIsUsingBuiltInNodeForMcp':
            return true;

        case 'setIsDxtAutoUpdatesEnabled':
            return true;

        default:
            console.warn('[IPC:AppConfig] Unknown method:', method);
            return null;
    }
};

// AppFeatures IPC 處理函數
window.__handleAppFeaturesIpc = async function(method, args) {
    console.log('[IPC:AppFeatures] Handling:', method);

    switch (method) {
        case 'getSupportedFeatures':
            return {
                mcp: true,
                extensions: true,
                globalShortcut: false,
                menuBar: false,
                quickEntry: false
            };

        default:
            console.warn('[IPC:AppFeatures] Unknown method:', method);
            return null;
    }
};

// Connectivity IPC 處理函數
window.__handleConnectivityIpc = async function(method, args) {
    console.log('[IPC:Connectivity] Handling:', method);

    switch (method) {
        case 'getOnlineStatus':
            return navigator.onLine;

        case 'onOnlineStatusChange':
            return function() {}; // 返回取消訂閱函數

        default:
            console.warn('[IPC:Connectivity] Unknown method:', method);
            return null;
    }
};

// AppLifecycle IPC 處理函數
window.__handleAppLifecycleIpc = async function(method, args) {
    console.log('[IPC:AppLifecycle] Handling:', method);

    switch (method) {
        case 'getAppState':
            return { state: 'active', isVisible: true };

        case 'onAppStateChange':
            return function() {};

        case 'onBeforeQuit':
            return function() {};

        case 'quit':
            return;

        default:
            console.warn('[IPC:AppLifecycle] Unknown method:', method);
            return null;
    }
};

// WindowManager IPC 處理函數
window.__handleWindowManagerIpc = async function(method, args) {
    console.log('[IPC:WindowManager] Handling:', method);

    switch (method) {
        case 'minimize':
        case 'maximize':
        case 'unmaximize':
        case 'close':
        case 'focus':
        case 'blur':
        case 'show':
        case 'hide':
            return true;

        case 'isMaximized':
            return false;

        case 'isMinimized':
            return false;

        case 'isVisible':
            return true;

        case 'isFocused':
            return document.hasFocus();

        case 'getBounds':
            return {
                x: window.screenX,
                y: window.screenY,
                width: window.innerWidth,
                height: window.innerHeight
            };

        case 'setBounds':
            return true;

        default:
            console.warn('[IPC:WindowManager] Unknown method:', method);
            return null;
    }
};

// DeepLinks IPC 處理函數
window.__handleDeepLinksIpc = async function(method, args) {
    console.log('[IPC:DeepLinks] Handling:', method);

    switch (method) {
        case 'getInitialDeepLink':
            return null;

        case 'onDeepLink':
            return function() {};

        default:
            console.warn('[IPC:DeepLinks] Unknown method:', method);
            return null;
    }
};

// Updates IPC 處理函數
window.__handleUpdatesIpc = async function(method, args) {
    console.log('[IPC:Updates] Handling:', method);

    switch (method) {
        case 'checkForUpdates':
            return { available: false };

        case 'getCurrentVersion':
            return '0.14.10';

        case 'downloadUpdate':
            return { success: false, reason: 'Updates not supported' };

        case 'installUpdate':
            return { success: false, reason: 'Updates not supported' };

        case 'onUpdateAvailable':
        case 'onDownloadProgress':
        case 'onUpdateDownloaded':
            return function() {};

        default:
            console.warn('[IPC:Updates] Unknown method:', method);
            return null;
    }
};

// 通用 IPC 處理函數
window.__handleGenericIpc = async function(channel, args) {
    console.log('[IPC:Generic] Handling:', channel);

    // 解析 channel 以找到 interface
    var channelParts = channel.split('_$_');
    var iface = channelParts.length > 2 ? channelParts[2] : '';
    var method = channelParts.length > 3 ? channelParts[3] : channel;

    // 根據 interface 路由
    switch (iface) {
        case 'Connectivity':
            return await window.__handleConnectivityIpc(method, args);

        case 'AppLifecycle':
            return await window.__handleAppLifecycleIpc(method, args);

        case 'WindowManager':
            return await window.__handleWindowManagerIpc(method, args);

        case 'DeepLinks':
            return await window.__handleDeepLinksIpc(method, args);

        case 'Updates':
            return await window.__handleUpdatesIpc(method, args);
    }

    // ping
    if (channel === 'ping' || channel.indexOf('ping') >= 0) {
        return 'pong';
    }

    // 其他未知 channel
    console.warn('[IPC:Generic] Unhandled channel:', channel);
    return null;
};

// 模擬 contextBridge
window.__contextBridge = {
    exposeInMainWorld: function(apiKey, api) {
        console.log('[contextBridge] exposeInMainWorld:', apiKey);
        window[apiKey] = api;
    }
};

// 將 ipcRenderer 暴露到 window.electron
window.electron = {
    ipcRenderer: window.__ipcRenderer
};

// claudeAppBindings - 使用 Proxy 攔截所有存取
var _claudeAppBindingsImpl = {
    getAppVersion: function() {
        console.log('[claudeAppBindings] getAppVersion called');
        return '0.14.10';
    },
    registerBinding: function(name, callback) {
        console.log('[claudeAppBindings] registerBinding:', name);
    },
    unregisterBinding: function(name) {
        console.log('[claudeAppBindings] unregisterBinding:', name);
    },
    listMcpServers: async function() {
        // 優先使用快取（Array 格式），但只有在已載入且有內容時
        if (window.__mcpServersLoaded && window.__mcpServersArray && window.__mcpServersArray.length > 0) {
            console.log('[claudeAppBindings] listMcpServers: using cache (Array)');
            return window.__mcpServersArray;
        }

        // 等待 __TAURI__ 可用
        if (!window.__TAURI__) {
            for (var i = 0; i < 50; i++) {
                await new Promise(function(r) { setTimeout(r, 100); });
                if (window.__TAURI__) break;
            }
        }
        if (!window.__TAURI__) {
            console.error('[claudeAppBindings] listMcpServers: Tauri not available');
            return [];
        }

        try {
            await window.__TAURI__.core.invoke('mcp_load_servers');
            var servers = await window.__TAURI__.core.invoke('mcp_list_servers');

            // 返回 Array 格式（for...of 可迭代）
            var result = [];
            var cacheObj = {};

            for (var j = 0; j < servers.length; j++) {
                var server = servers[j];
                var serverData = {
                    name: server.name,
                    status: 'connected',
                    error: null,
                    tools: server.tools.map(function(t) {
                        return {
                            name: t.name,
                            description: t.description || '',
                            inputSchema: t.input_schema || { type: 'object', properties: {} },
                            annotations: {
                                audience: ['user'],
                                priority: 0
                            }
                        };
                    }),
                    resources: server.resources || [],
                    resourceTemplates: [],
                    prompts: [],
                    serverInfo: {
                        name: server.name,
                        version: '1.0.0'
                    }
                };
                result.push(serverData);
                cacheObj[server.name] = serverData;
            }

            window.__mcpServersArray = result;
            window.__mcpServersCache = cacheObj;
            window.__mcpServersLoaded = true;  // 標記已載入，避免重複載入
            console.log('[claudeAppBindings] listMcpServers result (Array):', result.map(function(s) { return s.name; }));
            return result;
        } catch (e) {
            console.error('[claudeAppBindings] listMcpServers error:', e);
            window.__mcpServersLoaded = false;  // 載入失敗，允許重試
            return [];
        }
    },
    // 同步版本 - 立即返回快取（不會等待）
    listMcpServersSync: function() {
        return window.__mcpServersCache || {};
    },
    connectToMcpServer: function(serverNameOrConfig) {
        // === 最優先日誌：確認函數有被呼叫 ===
        console.log('[MCP ENTRY] ====== connectToMcpServer ENTERED ======');
        console.log('[MCP ENTRY] TIME:', new Date().toISOString());
        console.log('[MCP ENTRY] RAW INPUT:', JSON.stringify(serverNameOrConfig));

        // 詳細記錄傳入參數
        console.log('[claudeAppBindings] connectToMcpServer RAW INPUT:', serverNameOrConfig);
        console.log('[claudeAppBindings] connectToMcpServer RAW INPUT type:', typeof serverNameOrConfig);

        // 處理不同的參數格式：可能是 string 或 Object { name: string, ... }
        var serverName;
        if (typeof serverNameOrConfig === 'string') {
            serverName = serverNameOrConfig;
        } else if (serverNameOrConfig && typeof serverNameOrConfig === 'object') {
            serverName = serverNameOrConfig.name || serverNameOrConfig.serverName || Object.keys(serverNameOrConfig)[0];
        } else {
            console.error('[claudeAppBindings] connectToMcpServer: invalid parameter');
            return Promise.reject(new Error('Invalid parameter'));
        }

        console.log('[claudeAppBindings] connectToMcpServer CALLED:', serverName);

        // === 檢查是否已有現有連線，避免重複建立 ===
        if (!window.__mcpActiveConnections) {
            window.__mcpActiveConnections = {};
        }

        // === 連線計數器（用於追蹤） ===
        if (!window.__mcpConnectionCounter) {
            window.__mcpConnectionCounter = {};
        }
        if (!window.__mcpConnectionCounter[serverName]) {
            window.__mcpConnectionCounter[serverName] = 0;
        }
        window.__mcpConnectionCounter[serverName]++;
        var connectionId = window.__mcpConnectionCounter[serverName];
        console.log('[claudeAppBindings] connectToMcpServer #' + connectionId + ' for', serverName);

        // === 方法 18：移除連線重用，每次都建立新連線，並清理舊的 ports ===
        // 問題分析：
        // - 方法 14 重用連線時只返回 Promise 結果，不發送 mcp-server-connected 事件
        // - claude.ai 收到 notifications/cancelled 後認為連線失敗，不再發送 tools/call
        // - 舊的 serverPort.onmessage 可能還在運行，造成混亂
        // 解決方案：
        // 1. 每次 connectToMcpServer 都建立新連線並發送 mcp-server-connected 事件
        // 2. 關閉舊的 serverPort，避免舊連線繼續處理消息
        console.log('[MCP ENTRY] Checking for existing connection...');
        console.log('[MCP ENTRY] Existing connections:', JSON.stringify(Object.keys(window.__mcpActiveConnections || {})));

        if (window.__mcpActiveConnections[serverName]) {
            var existingConn = window.__mcpActiveConnections[serverName];
            var connectionAge = Date.now() - existingConn.timestamp;
            console.log('[MCP ENTRY] Found existing connection #' + existingConn.connectionId + ', age:', Math.round(connectionAge/1000), 's');
            console.log('[MCP ENTRY] toolsCallCount:', existingConn.toolsCallCount);
            console.log('[MCP ENTRY] ====== CLEARING OLD CONNECTION (方法 18) ======');

            // 方法 18：關閉舊的 serverPort，避免舊連線繼續處理消息
            if (existingConn.serverPort) {
                try {
                    // 先移除 onmessage handler，避免收到更多消息
                    existingConn.serverPort.onmessage = null;
                    existingConn.serverPort.onerror = null;
                    existingConn.serverPort.close();
                    console.log('[MCP ENTRY] Closed old serverPort');
                } catch (e) {
                    console.log('[MCP ENTRY] Failed to close old serverPort:', e);
                }
            }

            delete window.__mcpActiveConnections[serverName];
        }
        console.log('[MCP ENTRY] ====== CREATING NEW CONNECTION ======');

        // === 只在首次連線時清除舊請求記錄 ===
        if (window.__mcpHandledRequests) {
            var keysToDelete = [];
            for (var key in window.__mcpHandledRequests) {
                // 清除該伺服器的所有舊請求記錄
                if (key.startsWith(serverName + ':')) {
                    keysToDelete.push(key);
                }
            }
            for (var i = 0; i < keysToDelete.length; i++) {
                delete window.__mcpHandledRequests[keysToDelete[i]];
            }
            if (keysToDelete.length > 0) {
                console.log('[claudeAppBindings] Cleared', keysToDelete.length, 'old request records for', serverName);
            }
        }

        // === 關鍵改變：模擬 Electron 的流程 ===
        // 1. ipcRenderer.invoke('connectToMcpServer') 被呼叫
        // 2. main process 建立 MessageChannel，透過 webContents.postMessage 發送 McpServerConnected 事件
        // 3. preload 監聽此事件，透過 window.postMessage 將 port 傳遞給頁面
        // 4. 頁面透過 window.addEventListener('message') 接收 port

        return new Promise(function(resolve, reject) {
            try {
                // 建立 MessageChannel
                var channel = new MessageChannel();

                // === 方法 24：交換 port1/port2 角色 ===
                // 問題診斷（方法 22 確認）：
                // - serverPort.postMessage() 不會拋錯，但消息不會到達 clientPort
                // - window.postMessage 作為備用可以被接收
                // 假設：WebKitGTK 可能對 port1 vs port2 的 transfer 有不同行為
                // 嘗試：將 port2 作為 clientPort（transfer 給 claude.ai）
                //       將 port1 作為 serverPort（我們保留）
                var clientPort = channel.port2;  // 給 claude.ai 前端（改用 port2）
                var serverPort = channel.port1;  // 橋接到 Tauri 後端（改用 port1）

                console.log('[MCP CHANNEL] MessageChannel created');
                console.log('[MCP DEBUG 24] Port roles SWAPPED: clientPort=port2, serverPort=port1');
                // 不在 transfer 前調用 clientPort.start()，讓接收方自己處理

                // === 優先級 4 修復：每個連線獨立的 initialize 狀態 ===
                // 不使用全域跨連線的狀態，避免舊連線的失敗影響新連線
                var initializeHandled = false;
                var initializeResponse = null;

                // === 方法 11：使用 async onmessage 並增加診斷 ===
                // 設置 serverPort 的 JSON-RPC 處理器（橋接到 Tauri）
                serverPort.onmessage = async function(event) {
                    var data = event.data;
                    var startTime = Date.now();

                    console.log('[MCP ServerPort #' + connectionId + '] received:', serverName, 'method:', data && data.method, 'id:', data && data.id);

                    // 忽略非 JSON-RPC 訊息
                    if (!data || (!data.method && !data.jsonrpc)) {
                        console.log('[MCP ServerPort #' + connectionId + '] ignoring non-JSON-RPC message');
                        return;
                    }

                    // === 優化：initialize 完全同步處理，避免 timeout ===
                    if (data.method === 'initialize') {
                        // 使用本地連線狀態，不是全域狀態
                        if (initializeHandled && initializeResponse) {
                            console.log('[MCP ServerPort #' + connectionId + '] initialize: returning cached response for id:', data.id);
                            serverPort.postMessage(initializeResponse);
                            return;
                        }

                        var clientVersion = (data.params && data.params.protocolVersion) || '2024-11-05';
                        var initResponse = {
                            jsonrpc: '2.0',
                            id: data.id,
                            result: {
                                protocolVersion: clientVersion,
                                capabilities: {
                                    tools: { listChanged: true },
                                    resources: { listChanged: true, subscribe: true },
                                    prompts: { listChanged: true },
                                    logging: {}
                                },
                                serverInfo: {
                                    name: serverName,
                                    version: '1.0.0'
                                }
                            }
                        };
                        console.log('[MCP ServerPort #' + connectionId + '] initialize: immediate sync response for id:', data.id);
                        serverPort.postMessage(initResponse);
                        initializeHandled = true;
                        initializeResponse = initResponse;
                        return;
                    }

                    // === 方法 22：測試 serverPort -> clientPort 方向是否工作 ===
                    // 在處理之前立即發送一個 echo 消息
                    try {
                        var echoMsg = { __echo__: true, receivedMethod: data.method, receivedId: data.id, timestamp: Date.now() };
                        console.log('[MCP DEBUG 22] Sending immediate echo BEFORE processing:', JSON.stringify(echoMsg));
                        serverPort.postMessage(echoMsg);
                        console.log('[MCP DEBUG 22] Echo sent successfully');
                    } catch (echoErr) {
                        console.error('[MCP DEBUG 22] Echo FAILED:', echoErr);
                    }

                    // === 方法 11 + 21：直接 await 並追蹤 tools/call ===
                    try {
                        var isToolsCall = data.method === 'tools/call';
                        if (isToolsCall) {
                            console.log('[MCP DEBUG 21] ======== TOOLS/CALL REQUEST RECEIVED ========');
                            console.log('[MCP DEBUG 21] ServerPort #' + connectionId + ', id:', data.id);
                            console.log('[MCP DEBUG 21] Tool name:', data.params && data.params.name);
                        }
                        console.log('[MCP ServerPort #' + connectionId + '] processing method:', data.method, 'id:', data.id);

                        var response = await window.__handleMcpJsonRpc(serverName, data);

                        var elapsed = Date.now() - startTime;
                        if (isToolsCall) {
                            console.log('[MCP DEBUG 21] ======== TOOLS/CALL RESPONSE READY ========');
                            console.log('[MCP DEBUG 21] Elapsed:', elapsed, 'ms, response:', !!response);
                        }
                        console.log('[MCP ServerPort #' + connectionId + '] got response after', elapsed, 'ms for id:', data.id);

                        if (response) {
                            // 診斷：檢查 response 物件
                            var responseStr = JSON.stringify(response);
                            console.log('[MCP ServerPort #' + connectionId + '] response size:', responseStr.length, 'bytes');
                            console.log('[MCP ServerPort #' + connectionId + '] response preview:', responseStr.substring(0, 200));

                            // 嘗試 postMessage
                            if (isToolsCall) {
                                console.log('[MCP DEBUG 21] ======== SENDING TOOLS/CALL RESPONSE ========');
                                console.log('[MCP DEBUG 21] Response id:', response.id, 'result:', !!response.result);
                            }
                            console.log('[MCP ServerPort #' + connectionId + '] calling postMessage for id:', response.id);
                            serverPort.postMessage(response);
                            console.log('[MCP ServerPort #' + connectionId + '] postMessage completed (no throw) for id:', response.id);
                            if (isToolsCall) {
                                console.log('[MCP DEBUG 21] ======== TOOLS/CALL RESPONSE SENT ========');
                            }

                            // === 方法 22：額外通過 window.postMessage 發送回應作為備用 ===
                            // 如果 serverPort.postMessage 不工作，這可能是一個備用方案
                            if (isToolsCall) {
                                console.log('[MCP DEBUG 22] Also sending via window.postMessage as backup');
                                window.postMessage({
                                    type: 'mcp-tool-result',
                                    serverName: serverName,
                                    response: response
                                }, '*');
                                console.log('[MCP DEBUG 22] window.postMessage sent');
                            }

                            // 診斷：再發送一個簡單的 ack 訊息，看是否能到達
                            var ackMsg = { __ack__: true, id: response.id, timestamp: Date.now() };
                            serverPort.postMessage(ackMsg);
                            console.log('[MCP ServerPort #' + connectionId + '] ack message sent for id:', response.id);
                        } else {
                            console.warn('[MCP ServerPort #' + connectionId + '] no response for method:', data.method);
                            if (isToolsCall) {
                                console.error('[MCP DEBUG 21] ======== NO RESPONSE FOR TOOLS/CALL! ========');
                            }
                        }
                    } catch (err) {
                        console.error('[MCP ServerPort #' + connectionId + '] ERROR processing', data.method, ':', err);
                        // 發送錯誤回應
                        if (data.id !== undefined && data.id !== null) {
                            try {
                                serverPort.postMessage({
                                    jsonrpc: '2.0',
                                    id: data.id,
                                    error: { code: -32603, message: err.toString() }
                                });
                            } catch (postErr) {
                                console.error('[MCP ServerPort #' + connectionId + '] failed to send error response:', postErr);
                            }
                        }
                    }
                };
                serverPort.onerror = function(e) {
                    console.error('[MCP ServerPort] error:', serverName, e);
                };

                // 生成唯一 UUID
                var uuid = 'mcp-' + serverName + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

                // === 重要：先啟動 serverPort（這樣才能接收 clientPort 發來的訊息）===
                serverPort.start();
                console.log('[claudeAppBindings] connectToMcpServer: serverPort started for', serverName);

                // === 方法 29：使用假 MessagePort 繞過 WebKitGTK 問題 ===
                // 先發送 prepare 訊息創建假 port，然後發送 connected 訊息
                // 我們的 capture listener 會劫持 event.ports，替換成假 port
                console.log('[MCP METHOD 29] Starting fake port flow for', serverName);
                console.log('[claudeAppBindings] connectToMcpServer: clientPort ready:', !!clientPort, 'serverPort ready:', !!serverPort);

                // 步驟 1：發送 prepare 訊息，創建假 port
                window.postMessage({
                    type: 'mcp-server-connected-prepare',
                    serverName: serverName
                }, '*');
                console.log('[MCP METHOD 29] Sent prepare message for', serverName);

                // 給一個微小的延遲確保 prepare 訊息被處理
                // 使用 setTimeout(0) 確保事件循環處理了 prepare 訊息
                setTimeout(function() {
                    console.log('[MCP METHOD 29] Sending mcp-server-connected for', serverName);

                    // 步驟 2：發送 connected 訊息（帶著真正的 port）
                    // 我們的 capture listener 會攔截並替換 event.ports
                    window.postMessage({
                        type: 'mcp-server-connected',
                        serverName: serverName,
                        uuid: uuid
                    }, '*', [clientPort]);

                    console.log('[claudeAppBindings] connectToMcpServer #' + connectionId + ': message posted for', serverName, 'uuid:', uuid);
                }, 0);

                // 方法 29：假 port 系統會處理所有通訊

                // 儲存連線資訊（包含 connectionId 方便追蹤）
                var result = { serverName: serverName, uuid: uuid };
                window.__mcpActiveConnections[serverName] = {
                    result: result,
                    channel: channel,
                    serverPort: serverPort,
                    timestamp: Date.now(),
                    connectionId: connectionId
                };

                // Promise resolve（官方的 ipcRenderer.invoke 也會 resolve，但頁面主要靠 message 事件取得 port）
                resolve(result);

            } catch (e) {
                console.error('[claudeAppBindings] connectToMcpServer error:', e);
                reject(e);
            }
        });
    },
    disconnectFromMcpServer: async function(serverName) {
        console.log('[claudeAppBindings] disconnectFromMcpServer:', serverName);
        // 清除連線資訊
        if (window.__mcpActiveConnections && window.__mcpActiveConnections[serverName]) {
            delete window.__mcpActiveConnections[serverName];
            console.log('[claudeAppBindings] disconnectFromMcpServer: cleared connection for', serverName);
        }
        return { success: true };
    },
    openMcpSettings: async function(serverName) {
        console.log('[claudeAppBindings] openMcpSettings:', serverName);
    },
    getMcpServerStatus: function(serverName) {
        console.log('[claudeAppBindings] getMcpServerStatus:', serverName);
        var servers = window.__mcpServersCache || {};
        return servers[serverName] ? 'connected' : 'disconnected';
    }
};

// 使用 Proxy 攔截所有對 claudeAppBindings 的存取，並追蹤實際呼叫
window.__claudeAppBindingsCalls = [];
window.claudeAppBindings = new Proxy(_claudeAppBindingsImpl, {
    get: function(target, prop) {
        if (typeof target[prop] === 'undefined') {
            console.log('[claudeAppBindings] UNKNOWN property accessed:', prop);
            return function() {
                console.log('[claudeAppBindings] UNKNOWN method CALLED:', prop, Array.from(arguments));
                window.__claudeAppBindingsCalls.push({ method: prop, args: Array.from(arguments), unknown: true, time: Date.now() });
                return undefined;
            };
        }
        if (typeof target[prop] === 'function') {
            // 返回包裝函數來追蹤實際呼叫
            return function() {
                var args = Array.from(arguments);
                console.log('[claudeAppBindings] Method CALLED:', prop, args);
                window.__claudeAppBindingsCalls.push({ method: prop, args: args, time: Date.now() });
                return target[prop].apply(target, arguments);
            };
        } else {
            console.log('[claudeAppBindings] Property accessed:', prop, '=', target[prop]);
        }
        return target[prop];
    },
    set: function(target, prop, value) {
        console.log('[claudeAppBindings] Property set:', prop, '=', value);
        target[prop] = value;
        return true;
    }
});

window.electronWindowControl = {
    resize: async function() { return true; },
    focus: async function() { return true; },
    setThemeMode: async function() { return true; }
};

// __CLAUDE_DESKTOP_MCP__ - MCP Bridge API
window.__CLAUDE_DESKTOP_MCP__ = {
    servers: [],
    tools: {},

    loadServers: async function() {
        if (!window.__TAURI__) {
            for (var i = 0; i < 50; i++) {
                await new Promise(function(r) { setTimeout(r, 100); });
                if (window.__TAURI__) break;
            }
        }
        if (!window.__TAURI__) return [];

        try {
            var serverNames = await window.__TAURI__.core.invoke('mcp_load_servers');
            this.servers = await window.__TAURI__.core.invoke('mcp_list_servers');

            // Build tool lookup map
            this.tools = {};
            for (var i = 0; i < this.servers.length; i++) {
                var server = this.servers[i];
                for (var j = 0; j < server.tools.length; j++) {
                    var tool = server.tools[j];
                    this.tools[tool.name] = {
                        server: server.name,
                        tool: tool
                    };
                }
            }

            return serverNames;
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] loadServers error:', e);
            return [];
        }
    },

    listServers: async function() {
        if (!window.__TAURI__) return [];
        try {
            return await window.__TAURI__.core.invoke('mcp_list_servers');
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] listServers error:', e);
            return [];
        }
    },

    callTool: async function(server, tool, args) {
        // === 方法 21：詳細追蹤 Tauri invoke 返回 ===
        console.log('[MCP DEBUG 21] callTool START:', server, tool);
        if (!window.__TAURI__) {
            console.error('[MCP DEBUG 21] Tauri not available!');
            return { error: 'Tauri not available' };
        }
        try {
            console.log('[MCP DEBUG 21] Calling Tauri invoke...');
            var result = await window.__TAURI__.core.invoke('mcp_call_tool', {
                server: server,
                tool: tool,
                arguments: args || {}
            });
            console.log('[MCP DEBUG 21] Tauri invoke RETURNED:', typeof result);
            console.log('[MCP DEBUG 21] Result preview:', JSON.stringify(result).substring(0, 200));
            return result;
        } catch (e) {
            console.error('[MCP DEBUG 21] callTool EXCEPTION:', e);
            return { error: e.toString() };
        }
    },

    readResource: async function(server, uri) {
        if (!window.__TAURI__) return { error: 'Tauri not available' };
        try {
            return await window.__TAURI__.core.invoke('mcp_read_resource', {
                server: server,
                uri: uri
            });
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] readResource error:', e);
            return { error: e.toString() };
        }
    },

    stopServer: async function(name) {
        if (!window.__TAURI__) return false;
        try {
            return await window.__TAURI__.core.invoke('mcp_stop_server', { name: name });
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] stopServer error:', e);
            return false;
        }
    },

    getConfig: async function() {
        if (!window.__TAURI__) return {};
        try {
            return await window.__TAURI__.core.invoke('mcp_get_config');
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] getConfig error:', e);
            return {};
        }
    },

    saveConfig: async function(config) {
        if (!window.__TAURI__) return false;
        try {
            return await window.__TAURI__.core.invoke('mcp_save_config', { config: config });
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] saveConfig error:', e);
            return false;
        }
    },

    getConfigPath: async function() {
        if (!window.__TAURI__) return '';
        try {
            return await window.__TAURI__.core.invoke('mcp_get_config_path');
        } catch (e) {
            console.error('[__CLAUDE_DESKTOP_MCP__] getConfigPath error:', e);
            return '';
        }
    },

    findTool: function(toolName) {
        return this.tools[toolName] || null;
    },

    executeTool: async function(toolName, input) {
        var toolInfo = this.findTool(toolName);
        if (!toolInfo) {
            return {
                error: true,
                message: 'Tool not found: ' + toolName
            };
        }

        try {
            var result = await this.callTool(toolInfo.server, toolName, input);
            return {
                error: false,
                result: result
            };
        } catch (e) {
            return {
                error: true,
                message: e.toString()
            };
        }
    }
};

console.log('[Claude Desktop] __CLAUDE_DESKTOP_MCP__ initialized');

window.electronIntl = {
    getInitialLocale: function() { return navigator.language || 'en-US'; },
    requestLocaleChange: async function() { return true; },
    onLocaleChanged: function() { return function() {}; }
};

window.claudeAppSettings = {
    filePickers: {
        getPathForFile: function(file) { return file ? file.name || '' : ''; }
    }
};

window.process = {
    platform: 'darwin',
    arch: 'x64',
    type: 'renderer',
    version: 'v20.18.0',
    versions: {
        chrome: '128.0.6613.186',
        electron: '32.2.7',
        node: '20.18.0'
    }
};

// nativeTheme - 主題相關
window.nativeTheme = {
    themeSource: 'system',
    shouldUseDarkColors: window.matchMedia('(prefers-color-scheme: dark)').matches,
    shouldUseHighContrastColors: false,
    shouldUseInvertedColorScheme: false
};
