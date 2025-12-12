// ========================================
// electronAPI - contextBridge 暴露的主要 API
// ========================================
window.electronAPI = {
    // MCP 相關
    getMcpServersConfig: async function() {
        return await window['claude.settings'].MCP.getMcpServersConfig();
    },
    getMcpServersConfigWithStatus: async function() {
        return await window['claude.settings'].MCP.getMcpServersConfigWithStatus();
    },
    setMcpServerConfigs: async function(configs) {
        return await window['claude.settings'].MCP.setMcpServerConfigs(configs);
    },
    isLocalDevMcpEnabled: async function() {
        return true;
    },

    // Extensions 相關
    isExtensionsEnabled: async function() {
        return true;
    },
    getInstalledExtensionsWithState: async function() {
        return [];
    },

    // App 相關
    getAppVersion: function() {
        return '0.14.10';
    },
    getSupportedFeatures: async function() {
        return {
            mcp: true,
            extensions: true,
            globalShortcut: false,
            menuBar: false,
            quickEntry: false
        };
    },

    // 視窗控制
    minimizeWindow: function() {},
    maximizeWindow: function() {},
    closeWindow: function() {},

    // IPC
    invoke: async function(channel, ...args) {
        return await window.__ipcRenderer.invoke(channel, ...args);
    },
    on: function(channel, callback) {
        return window.__ipcRenderer.on(channel, callback);
    },
    send: function(channel, ...args) {
        return window.__ipcRenderer.send(channel, ...args);
    }
};

// ========================================
// MCP Transport 儲存（使用瀏覽器原生 MessageChannel）
// ========================================
window.__mcpMessagePorts = {};      // serverName -> clientPort (給 renderer)
window.__mcpServerPorts = {};       // serverName -> serverPort (橋接到 Tauri)
window.__mcpTransports = {};        // serverName -> transport 包裝器
window.__mcpChannels = {};          // serverName -> MessageChannel (共用)

// 註：我們現在使用瀏覽器原生的 MessageChannel API
// 重要：每個 server 只建立一個 MessageChannel，確保 port 共用

// 處理 MCP JSON-RPC
// 追蹤已處理的請求和快取的回應
window.__mcpHandledRequests = window.__mcpHandledRequests || {};
window.__mcpCachedResponses = window.__mcpCachedResponses || {};

window.__handleMcpJsonRpc = async function(serverName, request) {
    console.log('[MCP JSON-RPC]', serverName, request);

    var id = request.id;
    var method = request.method;
    var params = request.params || {};

    // 直接處理每個請求，不使用快取
    // claude.ai 前端可能需要每個請求都得到新的回應

    // === 關鍵修復：serverName 可能是 internalName，需要轉換為 displayName 來查詢 cache ===
    // 因為 __mcpServersCache 的 key 是 displayName
    var displayName = serverName;
    if (window.__mcpReverseNameMapping && window.__mcpReverseNameMapping[serverName]) {
        displayName = window.__mcpReverseNameMapping[serverName];
    }
    console.log('[MCP JSON-RPC] serverName:', serverName, 'displayName:', displayName);

    try {
        var response;
        switch (method) {
            case 'initialize':
                // 使用客戶端請求的 protocolVersion，或回退到已知版本
                var clientVersion = params.protocolVersion || '2024-11-05';
                // displayName 已在上方計算
                var displayNameForInit = displayName;
                response = {
                    jsonrpc: '2.0',
                    id: id,
                    result: {
                        protocolVersion: clientVersion,
                        capabilities: {
                            tools: { listChanged: true },
                            resources: { listChanged: true, subscribe: true },
                            prompts: { listChanged: true },
                            logging: {}
                        },
                        serverInfo: {
                            name: displayNameForInit,  // 使用 displayName 而不是 internalName
                            version: '1.0.0'
                        }
                    }
                };
                console.log('[MCP JSON-RPC] initialize response:', JSON.stringify(response), 'displayName:', displayNameForInit);
                return response;

            case 'tools/list':
                var servers = window.__mcpServersCache || {};
                // 使用 displayName 查詢 cache（因為 cache 的 key 是 displayName）
                var serverData = servers[displayName];
                var tools = serverData ? serverData.tools : [];
                console.log('[MCP JSON-RPC] tools/list for:', displayName, 'found:', !!serverData, 'tools count:', tools.length);
                return {
                    jsonrpc: '2.0',
                    id: id,
                    result: { tools: tools }
                };

            case 'tools/call':
                // === 方法 21：詳細追蹤 tools/call 處理流程 ===
                var toolName = params.name;
                var toolArgs = params.arguments || {};
                console.log('[MCP DEBUG 21] tools/call HANDLER START:', serverName, toolName, 'id:', id);
                console.log('[MCP DEBUG 21] tools/call args:', JSON.stringify(toolArgs).substring(0, 100));

                try {
                    console.log('[MCP DEBUG 21] Calling __CLAUDE_DESKTOP_MCP__.callTool...');
                    var result = await window.__CLAUDE_DESKTOP_MCP__.callTool(serverName, toolName, toolArgs);
                    console.log('[MCP DEBUG 21] callTool RETURNED for id:', id);
                    console.log('[MCP DEBUG 21] result type:', typeof result, 'has content:', !!(result && result.content));
                    console.log('[MCP DEBUG 21] result preview:', JSON.stringify(result).substring(0, 300));

                    // 方法 16：記錄 tools/call 成功次數，用於判斷是否觸發 auto-reconnect
                    if (window.__mcpActiveConnections && window.__mcpActiveConnections[serverName]) {
                        var conn = window.__mcpActiveConnections[serverName];
                        conn.toolsCallCount = (conn.toolsCallCount || 0) + 1;
                        console.log('[MCP DEBUG 21] tools/call success count for', serverName, ':', conn.toolsCallCount);
                    }

                    // MCP server 已經返回正確格式 { content: [...] }，直接使用
                    var response = {
                        jsonrpc: '2.0',
                        id: id,
                        result: result
                    };
                    console.log('[MCP DEBUG 21] tools/call RETURNING response for id:', id);
                    return response;
                } catch (toolCallErr) {
                    console.error('[MCP DEBUG 21] tools/call EXCEPTION for id:', id, toolCallErr);
                    return {
                        jsonrpc: '2.0',
                        id: id,
                        error: { code: -32603, message: toolCallErr.toString() }
                    };
                }

            case 'resources/list':
                var servers = window.__mcpServersCache || {};
                // 使用 displayName 查詢 cache（因為 cache 的 key 是 displayName）
                var serverData = servers[displayName];
                var resources = serverData ? serverData.resources : [];
                console.log('[MCP JSON-RPC] resources/list for:', displayName, 'found:', !!serverData, 'resources count:', resources.length);
                return {
                    jsonrpc: '2.0',
                    id: id,
                    result: { resources: resources }
                };

            case 'resources/read':
                var uri = params.uri;
                var readResult = await window.__CLAUDE_DESKTOP_MCP__.readResource(serverName, uri);
                return {
                    jsonrpc: '2.0',
                    id: id,
                    result: { contents: [{ uri: uri, text: JSON.stringify(readResult) }] }
                };

            case 'prompts/list':
                return {
                    jsonrpc: '2.0',
                    id: id,
                    result: { prompts: [] }
                };

            case 'roots/list':
                // MCP 伺服器請求客戶端的 roots（例如 filesystem extension 需要知道允許的目錄）
                // 通常在 initialize 時 MCP 客戶端會告訴伺服器它的 roots
                // 但如果伺服器主動請求，我們返回一個空列表
                console.log('[MCP JSON-RPC] Server requested roots/list');
                return {
                    jsonrpc: '2.0',
                    id: id,
                    result: { roots: [] }
                };

            case 'notifications/initialized':
                // 這是通知，不需要回應
                console.log('[MCP JSON-RPC] Client initialized notification received');
                return null;

            case 'notifications/cancelled':
                // === 方法 20：完全忽略 notifications/cancelled (requestId=0) ===
                // 問題分析：
                // - requestId=0 是 initialize 請求超時
                // - 但日誌顯示 tools/call 仍然可以發送，表示連線實際上是正常的
                // - notifications/cancelled 可能只是一個 timing 警告，不影響功能
                // - claude.ai 的超時閾值可能太短（可能只有幾百毫秒）
                // 解決方案：
                // - 完全忽略 requestId=0 的 notifications/cancelled
                // - 只記錄日誌，不觸發任何重連
                // - 測試連線是否實際上是正常的
                console.log('[MCP DEBUG 20] notifications/cancelled for:', serverName, 'requestId:', params.requestId);

                if (params.requestId === 0) {
                    // 方法 20：完全忽略 initialize 超時，只記錄日誌
                    console.log('[MCP DEBUG 20] Initialize timeout detected, but IGNORING (connection still works)');
                    console.log('[MCP DEBUG 20] This is likely just a timing issue, not a real failure');
                } else {
                    console.log('[MCP JSON-RPC] Request cancelled - requestId:', params.requestId, 'reason:', params.reason);
                }
                return null;

            default:
                // 如果是通知（沒有 id），不需要回應
                if (id === undefined || id === null) {
                    console.log('[MCP JSON-RPC] Notification received:', method);
                    return null;
                }
                return {
                    jsonrpc: '2.0',
                    id: id,
                    error: { code: -32601, message: 'Method not found: ' + method }
                };
        }
    } catch (e) {
        return {
            jsonrpc: '2.0',
            id: id,
            error: { code: -32603, message: e.toString() }
        };
    }
};

// ========================================
// 監聽 message 事件（用於 MessagePort 傳遞）
// ========================================

// 追蹤所有 message 事件監聽器
var originalAddEventListener = window.addEventListener;
var messageListenerCount = 0;
window.addEventListener = function(type, listener, options) {
    if (type === 'message') {
        messageListenerCount++;
        console.log('[Window] message listener added, total:', messageListenerCount);
        // 包裝監聽器以記錄所有 message 事件
        var wrappedListener = function(event) {
            console.log('[Window Message] Listener received:', {
                origin: event.origin,
                dataType: typeof event.data,
                data: event.data ? JSON.stringify(event.data).substring(0, 200) : null,
                ports: event.ports ? event.ports.length : 0,
                source: event.source === window ? 'self' : 'other'
            });
            return listener.call(this, event);
        };
        return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
};

window.addEventListener('message', function(event) {
    // 詳細記錄所有 message 事件
    console.log('[Window Message] Global handler:', {
        origin: event.origin,
        dataType: typeof event.data,
        dataKeys: event.data && typeof event.data === 'object' ? Object.keys(event.data) : [],
        ports: event.ports ? event.ports.length : 0
    });

    if (event.data && typeof event.data === 'object') {
        console.log('[Window Message] type:', event.data.type, 'channel:', event.data.channel, 'ports:', event.ports ? event.ports.length : 0);
    }

    // 處理來自模擬 webContents.postMessage 的 MessagePort
    if (event.data && event.data.type === 'ELECTRON_PORT' && event.ports && event.ports.length > 0) {
        var serverName = event.data.serverName;
        console.log('[MCP] Received ELECTRON_PORT for:', serverName, 'port:', event.ports[0]);
        window.__mcpMessagePorts[serverName] = event.ports[0];

        // 自動設置 port 的 onmessage 處理器
        event.ports[0].onmessage = function(e) {
            console.log('[MCP Port] Received message:', serverName, JSON.stringify(e.data));
        };
        event.ports[0].start();
    }

    // 處理來自主程序的 MessagePort
    if (event.data && event.data.type === 'mcp-port' && event.ports && event.ports.length > 0) {
        var serverName = event.data.serverName;
        console.log('[MCP] Received MessagePort for:', serverName);
        window.__mcpMessagePorts[serverName] = event.ports[0];
    }

    // 處理 mcp-transport-ready
    if (event.data && event.data.type === 'mcp-transport-ready' && event.ports && event.ports.length > 0) {
        var serverName = event.data.serverName;
        console.log('[MCP] Transport ready for:', serverName, 'port:', event.ports[0]);
        window.__mcpMessagePorts[serverName] = event.ports[0];
    }
});

// 追蹤 API 呼叫
window.__apiCallLog = [];
window.__apiAccessLog = [];
function logApiCall(api, method, args) {
    var entry = { api: api, method: method, args: args, time: Date.now() };
    window.__apiCallLog.push(entry);
    console.log('[API CALL]', api + '.' + method, args || '');
}

function logApiAccess(path, type) {
    var entry = { path: path, type: type, time: Date.now() };
    window.__apiAccessLog.push(entry);
    console.log('[API ACCESS]', type, path);
}

// 建立帶追蹤的 Proxy 物件
function createTrackedProxy(target, path) {
    return new Proxy(target, {
        get: function(obj, prop) {
            var fullPath = path + '.' + String(prop);
            if (prop === Symbol.toStringTag) {
                return obj[prop];
            }
            if (typeof prop === 'symbol') {
                return obj[prop];
            }
            // 跳過 then/catch 檢查（Promise 檢測）
            if (prop === 'then' || prop === 'catch') {
                return undefined;
            }
            logApiAccess(fullPath, 'get');
            var value = obj[prop];
            if (typeof value === 'function') {
                // 直接返回函數，不包裝
                return value;
            }
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                return createTrackedProxy(value, fullPath);
            }
            return value;
        },
        set: function(obj, prop, value) {
            var fullPath = path + '.' + String(prop);
            logApiAccess(fullPath, 'set');
            obj[prop] = value;
            return true;
        }
    });
}

window['claude.settings'] = {
    MCP: {
        isLocalDevMcpEnabled: async function() {
            logApiCall('MCP', 'isLocalDevMcpEnabled');
            return true;
        },
        getMcpServersConfig: async function(forceReload) {
            logApiCall('MCP', 'getMcpServersConfig', { forceReload: forceReload });
            // 從 Tauri 後端取得真正的設定檔內容
            if (!window.__TAURI__) {
                for (var i = 0; i < 50; i++) {
                    await new Promise(function(r) { setTimeout(r, 100); });
                    if (window.__TAURI__) break;
                }
            }
            if (window.__TAURI__) {
                try {
                    var config = await window.__TAURI__.core.invoke('mcp_get_config');
                    console.log('[MCP] getMcpServersConfig:', config);
                    return config.mcpServers || config.mcp_servers || {};
                } catch (e) {
                    console.error('[MCP] getMcpServersConfig error:', e);
                    return {};
                }
            }
            return {};
        },
        getMcpServersConfigWithStatus: async function() {
            logApiCall('MCP', 'getMcpServersConfigWithStatus');
            // 優先使用快取（已包含完整格式，Object 格式）
            if (window.__mcpServersCache && Object.keys(window.__mcpServersCache).length > 0) {
                console.log('[MCP] getMcpServersConfigWithStatus: using cache (Object)', Object.keys(window.__mcpServersCache));
                return window.__mcpServersCache;
            }
            // 從 claudeAppBindings 取得 MCP servers 狀態
            if (window.claudeAppBindings && window.claudeAppBindings.listMcpServers) {
                try {
                    var serversArray = await window.claudeAppBindings.listMcpServers();
                    // 轉換 Array 為 Object 格式（以 server name 為 key）
                    var serversObj = {};
                    for (var i = 0; i < serversArray.length; i++) {
                        var srv = serversArray[i];
                        serversObj[srv.name] = srv;
                    }
                    // 更新快取為 Object 格式
                    window.__mcpServersCache = serversObj;
                    console.log('[MCP] getMcpServersConfigWithStatus returning Object:', Object.keys(serversObj));
                    return serversObj;
                } catch (e) {
                    console.error('[MCP] getMcpServersConfigWithStatus error:', e);
                    return {};
                }
            }
            return {};
        },
        setMcpServerConfigs: async function(configs) {
            logApiCall('MCP', 'setMcpServerConfigs', configs);
            return;
        },
        revealConfig: async function() {
            logApiCall('MCP', 'revealConfig');
            return;
        },
        revealLogs: async function() {
            logApiCall('MCP', 'revealLogs');
            return;
        },
        onMcpConfigChange: function(callback) {
            logApiCall('MCP', 'onMcpConfigChange', 'callback registered');
            if (!window.__mcpConfigCallbacks) window.__mcpConfigCallbacks = [];
            window.__mcpConfigCallbacks.push(callback);
            console.log('[MCP] onMcpConfigChange registered');
            return function() {
                const idx = window.__mcpConfigCallbacks.indexOf(callback);
                if (idx >= 0) window.__mcpConfigCallbacks.splice(idx, 1);
            };
        },
        onMcpStatusChanged: function(callback) {
            logApiCall('MCP', 'onMcpStatusChanged', 'callback registered');
            if (!window.__mcpStatusCallbacks) window.__mcpStatusCallbacks = [];
            window.__mcpStatusCallbacks.push(callback);
            console.log('[MCP] onMcpStatusChanged registered');
            return function() {
                const idx = window.__mcpStatusCallbacks.indexOf(callback);
                if (idx >= 0) window.__mcpStatusCallbacks.splice(idx, 1);
            };
        },
        onRevealMcpServerSettingsRequested: function(callback) { return function() {}; }
    },
    AppConfig: {
        getAppConfig: async function() {
            return {
                hasCompletedOnboarding: true,
                lastWindowState: null,
                appFeatures: { mcpEnabled: true },
                isUsingBuiltInNodeForMcp: true,
                isDxtAutoUpdatesEnabled: false
            };
        },
        setAppFeature: async function(feature, value) { return true; },
        setIsUsingBuiltInNodeForMcp: async function(value) { return true; },
        setIsDxtAutoUpdatesEnabled: async function(value) { return true; }
    },
    AppFeatures: {
        getSupportedFeatures: async function() {
            logApiCall('AppFeatures', 'getSupportedFeatures');
            var features = {
                mcp: true,
                extensions: true,
                globalShortcut: false,
                menuBar: false,
                quickEntry: false
            };
            console.log('[AppFeatures] getSupportedFeatures returning:', features);
            return features;
        }
    },
    AppPreferences: {
        getPreferences: async function() { return {}; },
        setPreference: async function(key, value) { return true; },
        onPreferencesChanged: function(callback) { return function() {}; }
    },
    Extensions: {
        isExtensionsEnabled: async function() {
            logApiCall('Extensions', 'isExtensionsEnabled');
            return true;
        },
        isDirectoryEnabled: async function() {
            logApiCall('Extensions', 'isDirectoryEnabled');
            return true;
        },
        getInstalledExtensionsWithState: async function() {
            logApiCall('Extensions', 'getInstalledExtensionsWithState');
            try {
                // 從 Tauri 後端取得已安裝的擴充功能
                var extensions = await window.__TAURI__.core.invoke('extension_list');
                console.log('[Extensions] Got installed extensions:', extensions);
                // 轉換為 claude.ai 期望的格式，包含 userConfig
                var results = await Promise.all(extensions.map(async function(ext) {
                    // 取得此 extension 的 userConfig
                    var userConfig = {};
                    try {
                        userConfig = await window.__TAURI__.core.invoke('extension_get_user_config', {
                            extensionId: ext.id
                        });
                    } catch (e) {
                        console.warn('[Extensions] Failed to get userConfig for', ext.id, ':', e);
                    }
                    console.log('[Extensions] Extension', ext.id, 'userConfig:', JSON.stringify(userConfig));
                    return {
                        id: ext.id,
                        manifest: ext.manifest,
                        state: ext.enabled ? 'enabled' : 'disabled',
                        settings: { isEnabled: ext.enabled, userConfig: userConfig },
                        mcpServerState: null,
                        path: ext.path
                    };
                }));
                return results;
            } catch (e) {
                console.error('[Extensions] Failed to get installed extensions:', e);
                return [];
            }
        },
        getCompatibilityCheckResult: async function() {
            logApiCall('Extensions', 'getCompatibilityCheckResult');
            return {
                nodeVersion: '20.18.0',
                builtInNodeVersion: '20.18.0',
                pythonVersion: null,
                appVersion: '0.14.10',
                supportedLatestMcpbManifestVersion: '1.0'
            };
        },
        getIsUpdateAvailable: async function(extensionId, manifest) {
            logApiCall('Extensions', 'getIsUpdateAvailable');
            return null;
        },
        getExtensionSettings: async function(extensionId) {
            logApiCall('Extensions', 'getExtensionSettings', extensionId);
            try {
                // Get userConfig from backend
                var userConfig = await window.__TAURI__.core.invoke('extension_get_user_config', {
                    extensionId: extensionId
                });
                console.log('[Extensions] getExtensionSettings for', extensionId, '- userConfig:', JSON.stringify(userConfig));
                return {
                    isEnabled: true,
                    userConfig: userConfig || {}
                };
            } catch (e) {
                console.error('[Extensions] Failed to get extension settings:', e);
                return { isEnabled: true, userConfig: {} };
            }
        },
        setExtensionSettings: async function(extensionId, settings) {
            logApiCall('Extensions', 'setExtensionSettings', extensionId, settings);
            console.log('[Extensions] setExtensionSettings called with:', extensionId, JSON.stringify(settings));
            try {
                // Handle isEnabled
                if (settings.isEnabled !== undefined) {
                    await window.__TAURI__.core.invoke('extension_set_enabled', {
                        extensionId: extensionId,
                        enabled: settings.isEnabled
                    });
                    console.log('[Extensions] Set isEnabled:', settings.isEnabled);
                }

                // Handle userConfig (camelCase from claude.ai) or user_config (snake_case)
                var userConfig = settings.userConfig || settings.user_config;
                if (userConfig) {
                    console.log('[Extensions] Setting userConfig:', JSON.stringify(userConfig));
                    for (var key in userConfig) {
                        if (userConfig.hasOwnProperty(key)) {
                            var value = userConfig[key];
                            console.log('[Extensions] Setting userConfig key:', key, '=', JSON.stringify(value));
                            await window.__TAURI__.core.invoke('extension_set_user_config', {
                                extensionId: extensionId,
                                key: key,
                                value: value
                            });
                        }
                    }
                    console.log('[Extensions] User config saved successfully');

                    // Trigger extension change callback to reload MCP servers
                    if (window.__extensionCallbacks) {
                        window.__extensionCallbacks.forEach(function(cb) {
                            try { cb(); } catch (e) { console.error('[Extensions] Callback error:', e); }
                        });
                    }
                }
            } catch (e) {
                console.error('[Extensions] Failed to set extension settings:', e);
            }
        },
        installDxt: async function(extensionId, dxtFilePath) {
            logApiCall('Extensions', 'installDxt');
            return null;
        },
        installDxtUnpacked: async function(folderPath) {
            logApiCall('Extensions', 'installDxtUnpacked');
            return null;
        },
        installDxtFromDirectory: async function(extensionId, version) {
            logApiCall('Extensions', 'installDxtFromDirectory', extensionId, version);
            console.log('[Extensions] installDxtFromDirectory called:', extensionId, version);

            try {
                // 1. 取得 organization ID
                // 優先順序: cookie lastActiveOrg > URL path > localStorage
                var orgId = null;

                // 方法 1: 從 cookie 讀取 lastActiveOrg（官方方式）
                var cookies = document.cookie.split(';');
                for (var i = 0; i < cookies.length; i++) {
                    var cookie = cookies[i].trim();
                    if (cookie.indexOf('lastActiveOrg=') === 0) {
                        orgId = decodeURIComponent(cookie.substring('lastActiveOrg='.length));
                        console.log('[Extensions] Got orgId from cookie:', orgId);
                        break;
                    }
                }

                // 方法 2: 從 URL 路徑取得
                if (!orgId) {
                    var match = window.location.pathname.match(/\/organization\/([^\/]+)/);
                    if (match) {
                        orgId = match[1];
                        console.log('[Extensions] Got orgId from URL:', orgId);
                    }
                }

                // 方法 3: 從 localStorage 取得
                if (!orgId) {
                    var stored = localStorage.getItem('lastActiveOrg') || localStorage.getItem('lastOrgId');
                    if (stored) {
                        orgId = stored;
                        console.log('[Extensions] Got orgId from localStorage:', orgId);
                    }
                }

                console.log('[Extensions] Final Organization ID:', orgId);

                // 如果沒有 orgId，無法下載
                if (!orgId) {
                    throw new Error('Could not determine organization ID. Please make sure you are logged in.');
                }

                // 2. 建構下載 URL（需要 orgId）
                var baseUrl = window.location.origin;
                var downloadUrl = baseUrl + '/api/organizations/' + orgId + '/dxt/extensions/' + extensionId + '/download';
                if (version) {
                    downloadUrl += '/' + version;
                }

                console.log('[Extensions] Download URL:', downloadUrl);

                // 3. 發送下載進度事件
                if (window.__extensionDownloadProgressCallbacks) {
                    window.__extensionDownloadProgressCallbacks.forEach(function(cb) {
                        cb(extensionId, 'downloading', 0, 100, null);
                    });
                }

                // 4. 下載 .dxt 檔案
                var response = await fetch(downloadUrl, {
                    credentials: 'include',
                    headers: {
                        'x-dxt-registry-version': '2'
                    }
                });

                if (!response.ok) {
                    throw new Error('Download failed: ' + response.status + ' ' + response.statusText);
                }

                // 5. 取得二進位資料
                var arrayBuffer = await response.arrayBuffer();
                var dxtData = Array.from(new Uint8Array(arrayBuffer));

                console.log('[Extensions] Downloaded', dxtData.length, 'bytes');

                // 6. 發送下載進度事件
                if (window.__extensionDownloadProgressCallbacks) {
                    window.__extensionDownloadProgressCallbacks.forEach(function(cb) {
                        cb(extensionId, 'installing', 100, 100, null);
                    });
                }

                // 7. 呼叫 Tauri 後端安裝
                var result = await window.__TAURI__.core.invoke('extension_install', {
                    extensionId: extensionId,
                    dxtData: dxtData
                });

                console.log('[Extensions] Install result:', result);

                // 8. 觸發擴充功能變更事件
                if (window.__extensionCallbacks) {
                    window.__extensionCallbacks.forEach(function(cb) {
                        try { cb(); } catch (e) { console.error(e); }
                    });
                }

                return result ? result.id : null;
            } catch (e) {
                console.error('[Extensions] installDxtFromDirectory failed:', e);
                // 發送錯誤進度事件
                if (window.__extensionDownloadProgressCallbacks) {
                    window.__extensionDownloadProgressCallbacks.forEach(function(cb) {
                        cb(extensionId, 'error', 0, 100, e.message);
                    });
                }
                return null;
            }
        },
        handleDxtFile: async function(dxtPath) {
            logApiCall('Extensions', 'handleDxtFile');
        },
        showInstallDxtDialog: async function() {
            logApiCall('Extensions', 'showInstallDxtDialog');
        },
        deleteExtension: async function(extensionId) {
            logApiCall('Extensions', 'deleteExtension', extensionId);
            try {
                await window.__TAURI__.core.invoke('extension_delete', {
                    extensionId: extensionId
                });
                // 觸發擴充功能變更事件
                if (window.__extensionCallbacks) {
                    window.__extensionCallbacks.forEach(function(cb) {
                        try { cb(); } catch (e) { console.error(e); }
                    });
                }
            } catch (e) {
                console.error('[Extensions] Failed to delete extension:', e);
            }
        },
        showExtensionInFolder: async function(extensionId) {
            logApiCall('Extensions', 'showExtensionInFolder');
        },
        openExtensionsFolder: async function() {
            logApiCall('Extensions', 'openExtensionsFolder');
            try {
                var path = await window.__TAURI__.core.invoke('extension_get_path');
                console.log('[Extensions] Extensions folder:', path);
            } catch (e) {
                console.error('[Extensions] Failed to get extensions path:', e);
            }
        },
        openExtensionSettingsFolder: async function() {
            logApiCall('Extensions', 'openExtensionSettingsFolder');
        },
        getDirectoryUrl: async function() {
            logApiCall('Extensions', 'getDirectoryUrl');
            // 動態取得 Directory URL
            var orgId = null;
            var match = window.location.pathname.match(/\/organization\/([^\/]+)/);
            if (match) {
                orgId = match[1];
            }
            if (orgId) {
                return window.location.origin + '/api/organizations/' + orgId + '/dxt';
            }
            return window.location.origin + '/api/dxt';
        },
        getExtension: async function(request) {
            logApiCall('Extensions', 'getExtension');
            return { data: null, url: '' };
        },
        getExtensions: async function(request) {
            logApiCall('Extensions', 'getExtensions');
            return { data: [], url: '' };
        },
        getExtensionVersion: async function(request) {
            logApiCall('Extensions', 'getExtensionVersion');
            return null;
        },
        getExtensionVersions: async function(request) {
            logApiCall('Extensions', 'getExtensionVersions');
            return { data: [], url: '' };
        },
        onExtensionsChanged: function(callback) {
            if (!window.__extensionCallbacks) window.__extensionCallbacks = [];
            window.__extensionCallbacks.push(callback);
            return function() {
                var idx = window.__extensionCallbacks.indexOf(callback);
                if (idx >= 0) window.__extensionCallbacks.splice(idx, 1);
            };
        },
        onExtensionSettingsChanged: function(callback) { return function() {}; },
        onPreviewExtensionInstallation: function(callback) { return function() {}; },
        onExtensionDownloadProgress: function(callback) {
            if (!window.__extensionDownloadProgressCallbacks) window.__extensionDownloadProgressCallbacks = [];
            window.__extensionDownloadProgressCallbacks.push(callback);
            return function() {
                var idx = window.__extensionDownloadProgressCallbacks.indexOf(callback);
                if (idx >= 0) window.__extensionDownloadProgressCallbacks.splice(idx, 1);
            };
        },
        installExtensionFromPreview: async function(extensionId, dxtPath) {
            logApiCall('Extensions', 'installExtensionFromPreview');
            return null;
        },
        getExtensionManifest: async function(extensionId) {
            logApiCall('Extensions', 'getExtensionManifest', extensionId);
            try {
                var manifest = await window.__TAURI__.core.invoke('extension_get_manifest', {
                    extensionId: extensionId
                });
                console.log('[Extensions] Got manifest for', extensionId, ':', manifest);
                return manifest;
            } catch (e) {
                console.error('[Extensions] Failed to get manifest:', e);
                return null;
            }
        },
        getUserConfig: async function(extensionId) {
            logApiCall('Extensions', 'getUserConfig', extensionId);
            try {
                var config = await window.__TAURI__.core.invoke('extension_get_user_config', {
                    extensionId: extensionId
                });
                console.log('[Extensions] Got user config for', extensionId, ':', config);
                return config;
            } catch (e) {
                console.error('[Extensions] Failed to get user config:', e);
                return {};
            }
        },
        setUserConfig: async function(extensionId, key, value) {
            logApiCall('Extensions', 'setUserConfig', extensionId, key, value);
            try {
                await window.__TAURI__.core.invoke('extension_set_user_config', {
                    extensionId: extensionId,
                    key: key,
                    value: value
                });
                console.log('[Extensions] Set user config for', extensionId, ':', key, '=', value);
                // Trigger extension change callback to reload MCP servers
                if (window.__extensionCallbacks) {
                    window.__extensionCallbacks.forEach(function(cb) {
                        try { cb(); } catch (e) { console.error('[Extensions] Callback error:', e); }
                    });
                }
            } catch (e) {
                console.error('[Extensions] Failed to set user config:', e);
            }
        }
    },
    FilePickers: {
        getDirectoryPath: async function(options) {
            logApiCall('FilePickers', 'getDirectoryPath', options);
            try {
                // Use Tauri dialog plugin to select directory
                var result = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    title: options && options.title ? options.title : 'Select Directory'
                });
                console.log('[FilePickers] Raw result type:', typeof result);
                console.log('[FilePickers] Raw result:', result);
                console.log('[FilePickers] Raw result JSON:', JSON.stringify(result));
                // Ensure we return a string path
                var path = '';
                if (result) {
                    if (typeof result === 'string') {
                        path = result;
                    } else if (result.path) {
                        path = result.path;
                    } else if (Array.isArray(result) && result.length > 0) {
                        path = result[0];
                    }
                }
                console.log('[FilePickers] Final path:', path);
                // Try returning as array since claude.ai might be using spread/destructuring
                var pathArray = path ? [String(path)] : [];
                console.log('[FilePickers] Returning array:', JSON.stringify(pathArray));
                return pathArray;
            } catch (e) {
                console.error('[FilePickers] Failed to open directory dialog:', e);
                return '';
            }
        },
        getFilePath: async function(options) {
            logApiCall('FilePickers', 'getFilePath', options);
            try {
                var result = await window.__TAURI__.dialog.open({
                    directory: false,
                    multiple: false,
                    title: options && options.title ? options.title : 'Select File'
                });
                console.log('[FilePickers] Raw file result type:', typeof result);
                console.log('[FilePickers] Raw file result:', result);
                // Ensure we return a string path
                var path = '';
                if (result) {
                    if (typeof result === 'string') {
                        path = result;
                    } else if (result.path) {
                        path = result.path;
                    } else if (Array.isArray(result) && result.length > 0) {
                        path = result[0];
                    }
                }
                console.log('[FilePickers] Final file path:', path);
                var pathString = path ? String(path) : '';
                console.log('[FilePickers] Returning file string:', pathString);
                return pathString;
            } catch (e) {
                console.error('[FilePickers] Failed to open file dialog:', e);
                return '';
            }
        }
    },
    Startup: {
        isStartupOnLoginEnabled: async function() { return false; },
        setStartupOnLoginEnabled: async function(enabled) { return true; },
        isMenuBarEnabled: async function() { return false; },
        setMenuBarEnabled: async function(enabled) { return true; }
    },
    GlobalShortcut: {
        setGlobalShortcut: async function(shortcut) { return true; },
        getGlobalShortcut: async function() { return ''; },
        onGlobalShortcutChange: function(callback) { return function() {}; }
    }
};

// 將 claude.settings 包裝為追蹤 Proxy
window['claude.settings'] = createTrackedProxy(window['claude.settings'], 'claude.settings');

console.log('[Claude Desktop] Desktop APIs injected before page load');

// 快取 MCP servers - 在頁面載入前就開始
window.__mcpServersCache = null;
window.__mcpServersLoading = false;
window.__mcpServersLoaded = false;

// 預先載入 MCP servers（非同步但立即開始）
(async function preloadMcpServers() {
    if (window.__mcpServersLoading) return;
    window.__mcpServersLoading = true;

    console.log('[Claude Desktop] Preloading MCP servers...');

    // 等待 Tauri 初始化
    for (var i = 0; i < 100; i++) {
        if (window.__TAURI__) break;
        await new Promise(function(r) { setTimeout(r, 50); });
    }

    if (!window.__TAURI__) {
        console.error('[Claude Desktop] Tauri not available after 5 seconds');
        return;
    }

    try {
        await window.__TAURI__.core.invoke('mcp_load_servers');
        var servers = await window.__TAURI__.core.invoke('mcp_list_servers');

        // 同時維護 Array 和 Object 格式
        var resultArray = [];
        var resultObj = {};

        for (var idx = 0; idx < servers.length; idx++) {
            var server = servers[idx];
            // 使用 display_name 作為顯示名稱（如 "Filesystem"），server.name 是內部 ID
            var displayName = server.display_name || server.name;
            var internalName = server.name;  // 內部 ID，用於 MCP 通訊
            var serverData = {
                name: displayName,  // claude.ai UI 顯示這個
                internalName: internalName,  // 用於 MCP 通訊
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
                    name: displayName,
                    version: '1.0.0'
                }
            };
            resultArray.push(serverData);
            // 只用 displayName 作為 key（claude.ai UI 顯示用）
            resultObj[displayName] = serverData;
        }

        // 另外建立名稱映射表，用於 connectToMcpServer 和 displayName 查詢
        window.__mcpNameMapping = {};
        window.__mcpReverseNameMapping = {};  // internalName -> displayName
        for (var idx2 = 0; idx2 < resultArray.length; idx2++) {
            var s = resultArray[idx2];
            window.__mcpNameMapping[s.name] = s.internalName;  // displayName -> internalName
            window.__mcpNameMapping[s.internalName] = s.internalName;  // internalName -> internalName
            window.__mcpReverseNameMapping[s.internalName] = s.name;  // internalName -> displayName
        }

        window.__mcpServersArray = resultArray;
        window.__mcpServersCache = resultObj;
        window.__mcpServersLoaded = true;
        console.log('[Claude Desktop] MCP servers preloaded:', resultArray.map(function(s) { return s.name; }));

        // 注意：不在這裡建立 MessageChannel
        // MessageChannel 由 connectToMcpServer 統一建立
        // 這樣可以避免重複的 port 和 handler

        // 立即觸發配置變更事件
        if (resultArray.length > 0) {
            triggerMcpEvents(resultObj);
        }
    } catch (e) {
        console.error('[Claude Desktop] Failed to preload MCP servers:', e);
        // 標記載入失敗，讓 listMcpServers 可以重試
        window.__mcpServersLoaded = false;
        window.__mcpServersLoading = false;
    }
})();

// 追蹤 MCP 事件是否已觸發
window.__mcpEventsTriggered = false;

// 觸發 MCP 事件的函數
function triggerMcpEvents(servers, force) {
    // 如果已經觸發過且不是強制觸發，跳過
    if (window.__mcpEventsTriggered && !force) {
        console.log('[Claude Desktop] MCP events already triggered, skipping...');
        return;
    }
    window.__mcpEventsTriggered = true;
    console.log('[Claude Desktop] Triggering MCP events for:', Object.keys(servers));

    // 官方 IPC channel 前綴
    var IPC_PREFIX = '$eipc_message$_77d4e567-c444-4f71-92e9-9f2fbad120fd_$_claude.settings_$_MCP_$_';

    // 發送 MCP 狀態變更 IPC 事件
    var serverNames = Object.keys(servers);
    for (var i = 0; i < serverNames.length; i++) {
        var name = serverNames[i];
        console.log('[IPC] Dispatching mcpStatusChanged for:', name);
        window.__triggerIpcEvent(IPC_PREFIX + 'mcpStatusChanged', [name, 'running', null]);
    }

    // 發送 MCP 配置變更事件
    var configWithStatus = {};
    for (var i = 0; i < serverNames.length; i++) {
        var name = serverNames[i];
        var server = servers[name];
        configWithStatus[name] = {
            config: { command: 'mcp-server', args: [] },
            status: 'running',
            error: null,
            tools: server.tools || [],
            resources: server.resources || [],
            resourceTemplates: []
        };
    }

    console.log('[IPC] Dispatching mcpConfigChange:', configWithStatus);
    window.__triggerIpcEvent(IPC_PREFIX + 'mcpConfigChange', [configWithStatus]);

    // 注意：MessageChannel 由 connectToMcpServer 建立，這裡不重複建立
    // claude.ai 會在需要時呼叫 connectToMcpServer 取得 MessagePort
    console.log('[MCP] Servers available for connection:', serverNames);

    // 觸發舊版回調（相容性）
    if (window.__mcpStatusCallbacks && window.__mcpStatusCallbacks.length > 0) {
        console.log('[MCP] Triggering legacy status callbacks...');
        for (var i = 0; i < window.__mcpStatusCallbacks.length; i++) {
            try { window.__mcpStatusCallbacks[i](servers); } catch (e) { console.error('[MCP] Status callback error:', e); }
        }
    }

    if (window.__mcpConfigCallbacks && window.__mcpConfigCallbacks.length > 0) {
        console.log('[MCP] Triggering legacy config callbacks...');
        for (var i = 0; i < window.__mcpConfigCallbacks.length; i++) {
            try { window.__mcpConfigCallbacks[i](servers); } catch (e) { console.error('[MCP] Config callback error:', e); }
        }
    }

    // 注意：不要觸發 extension callbacks
    // Extensions 和 MCP 是分開的系統，觸發這些回調可能導致無限迴圈
    // if (window.__extensionCallbacks && window.__extensionCallbacks.length > 0) { ... }

    // 模擬 McpServerAutoReconnect 事件
    for (var i = 0; i < serverNames.length; i++) {
        window.__triggerIpcEvent('McpServerAutoReconnect', [serverNames[i]]);
    }

    // 觸發自訂事件，讓 claude.ai 可以監聽
    try {
        var mcpEvent = new CustomEvent('mcp-servers-updated', {
            detail: { servers: configWithStatus }
        });
        window.dispatchEvent(mcpEvent);
        console.log('[MCP] Dispatched mcp-servers-updated event');
    } catch (e) {
        console.error('[MCP] Failed to dispatch custom event:', e);
    }
}

// 在 DOMContentLoaded 時再次觸發（確保 claude.ai 已經註冊監聽器）
document.addEventListener('DOMContentLoaded', async function() {
    console.log('[Claude Desktop] DOMContentLoaded, checking MCP status...');

    // 如果已經載入，立即觸發事件
    if (window.__mcpServersLoaded && window.__mcpServersCache) {
        var servers = window.__mcpServersCache;
        if (Object.keys(servers).length > 0) {
            // 等待一小段時間讓 claude.ai 有機會註冊監聽器
            await new Promise(function(r) { setTimeout(r, 500); });
            triggerMcpEvents(servers);
        }
    }
});

// 在頁面載入完成後，再次觸發 MCP 狀態變更通知（最後一次嘗試）
window.addEventListener('load', async function() {
    console.log('[Claude Desktop] Page loaded, final MCP event trigger...');

    // 等待一小段時間讓 claude.ai 的 React 完全渲染
    await new Promise(function(r) { setTimeout(r, 1000); });

    // 使用快取或重新取得
    var servers = window.__mcpServersCache;
    if (!servers || Object.keys(servers).length === 0) {
        try {
            servers = await window.claudeAppBindings.listMcpServers();
            window.__mcpServersCache = servers;
            console.log('[MCP] Servers loaded (fallback):', servers);
        } catch (e) {
            console.error('[MCP] Failed to load servers:', e);
            servers = {};
        }
    }

    // 觸發事件
    if (Object.keys(servers).length > 0) {
        triggerMcpEvents(servers);
    }

    console.log('[Claude Desktop] MCP initialization complete');

    // 注意：移除了 heartbeat 機制
    // 原本的 45 秒 ping 會觸發 claude.ai 內部的 timeout 檢查
    // 導致顯示 "Could not attach to MCP server" 錯誤
    // MCP 連線不需要 heartbeat，claude.ai 會在需要時自動重連
});
