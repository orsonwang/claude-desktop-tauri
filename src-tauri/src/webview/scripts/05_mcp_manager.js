// ========================================
// MCP MessagePort 監聽器（等待官方 UI 使用）
// ========================================
// 註：claude.ai 官方 UI 會透過 ipcRenderer.on('mcp-server-port') 接收 MessagePort
// 我們已經在 connectToMcpServer 和 triggerMcpEvents 中實作了這個機制

// ========================================
// Fetch 攔截 - 用於處理 API 請求和 tool_use
// ========================================

// 儲存待處理的 tool calls
window.__pendingToolCalls = [];
window.__toolResults = {};

// 攔截 fetch
(function() {
    var originalFetch = window.fetch;

    window.fetch = async function(input, init) {
        var url = (typeof input === 'string') ? input : (input.url || '');
        var method = (init && init.method) ? init.method.toUpperCase() : 'GET';
        var body = init ? init.body : null;

        // 檢查是否是 Claude API 請求
        var isClaudeApi = url.indexOf('/api/') >= 0 && (
            url.indexOf('conversation') >= 0 ||
            url.indexOf('chat') >= 0 ||
            url.indexOf('completion') >= 0 ||
            url.indexOf('message') >= 0
        );

        // 注入 MCP 工具到 POST 請求
        if (isClaudeApi && method === 'POST' && body) {
            try {
                var bodyObj = JSON.parse(body);

                // 獲取 MCP 工具
                var servers = window.__mcpServersCache || {};
                var serverNames = Object.keys(servers);
                var mcpTools = [];

                // 建立安全名稱到原始名稱的映射表
                if (!window.__mcpToolNameMap) window.__mcpToolNameMap = {};

                for (var i = 0; i < serverNames.length; i++) {
                    var serverName = serverNames[i];
                    var server = servers[serverName];
                    var tools = server.tools || [];

                    for (var j = 0; j < tools.length; j++) {
                        var tool = tools[j];
                        // 工具名稱必須符合 Claude API 規則: ^[a-zA-Z0-9_-]{1,64}$
                        // 將不合法字元（如 .）替換為底線
                        var safeName = ('mcp_' + serverName + '_' + tool.name)
                            .replace(/[^a-zA-Z0-9_-]/g, '_')
                            .substring(0, 64);

                        // 儲存映射關係
                        window.__mcpToolNameMap[safeName] = {
                            serverName: serverName,
                            toolName: tool.name
                        };

                        mcpTools.push({
                            name: safeName,
                            description: '[MCP: ' + serverName + '] ' + (tool.description || tool.name),
                            input_schema: tool.inputSchema || { type: 'object', properties: {} }
                        });
                    }
                }

                // 如果有 MCP 工具，注入到請求中
                if (mcpTools.length > 0) {
                    if (!bodyObj.tools) bodyObj.tools = [];
                    bodyObj.tools = bodyObj.tools.concat(mcpTools);
                    // 不要加入 mcp_tools_injected，Claude API 不接受額外欄位

                    init = init || {};
                    init.body = JSON.stringify(bodyObj);

                    console.log('[Fetch] Injected', mcpTools.length, 'MCP tools into request');
                }

                // 檢查是否有待提交的 tool_result
                if (Object.keys(window.__toolResults).length > 0) {
                    if (!bodyObj.tool_results) bodyObj.tool_results = [];
                    var resultIds = Object.keys(window.__toolResults);
                    for (var k = 0; k < resultIds.length; k++) {
                        var resultId = resultIds[k];
                        bodyObj.tool_results.push(window.__toolResults[resultId]);
                    }
                    window.__toolResults = {};
                    console.log('[Fetch] Submitted', resultIds.length, 'tool results');
                }
            } catch (e) {
                console.warn('[Fetch] Failed to process request body:', e);
            }
        }

        // 執行原始 fetch
        var response = await originalFetch.apply(this, [input, init]);

        // 監控 Claude API 回應以偵測 tool_use
        if (isClaudeApi) {
            var clonedResponse = response.clone();

            // 非同步處理回應（不阻塞）
            (async function() {
                try {
                    var text = await clonedResponse.text();

                    // 檢查是否包含 tool_use
                    if (text.indexOf('tool_use') >= 0) {
                        console.log('[Fetch] Detected tool_use in response');

                        // 解析 SSE 事件
                        var lines = text.split('\n');
                        var currentTool = null;

                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i];
                            if (line.indexOf('data: ') !== 0) continue;

                            try {
                                var data = JSON.parse(line.substring(6));

                                // 偵測 tool_use 開始
                                if (data.type === 'content_block_start' &&
                                    data.content_block &&
                                    data.content_block.type === 'tool_use') {
                                    currentTool = {
                                        id: data.content_block.id,
                                        name: data.content_block.name,
                                        inputJson: ''
                                    };
                                }

                                // 收集 tool input
                                if (data.type === 'content_block_delta' &&
                                    data.delta &&
                                    data.delta.type === 'input_json_delta' &&
                                    currentTool) {
                                    currentTool.inputJson += data.delta.partial_json || '';
                                }

                                // tool block 完成
                                if (data.type === 'content_block_stop' && currentTool) {
                                    // 解析 input
                                    var input = {};
                                    try {
                                        if (currentTool.inputJson) {
                                            input = JSON.parse(currentTool.inputJson);
                                        }
                                    } catch (parseErr) {
                                        console.warn('[Fetch] Failed to parse tool input:', parseErr);
                                    }

                                    // 檢查是否是 MCP 工具
                                    var toolName = currentTool.name;
                                    if (toolName.indexOf('mcp_') === 0 && window.__mcpToolNameMap && window.__mcpToolNameMap[toolName]) {
                                        // 使用映射表取得原始的 server name 和 tool name
                                        var mapping = window.__mcpToolNameMap[toolName];
                                        var serverName = mapping.serverName;
                                        var actualToolName = mapping.toolName;

                                        console.log('[Fetch] Executing MCP tool:', serverName, actualToolName, input);

                                        // 執行 MCP 工具
                                        var result = await window.__CLAUDE_DESKTOP_MCP__.callTool(
                                            serverName, actualToolName, input
                                        );

                                        console.log('[Fetch] MCP tool result:', result);

                                        // 儲存結果以便下次請求提交
                                        window.__toolResults[currentTool.id] = {
                                            tool_use_id: currentTool.id,
                                            type: 'tool_result',
                                            content: JSON.stringify(result)
                                        };
                                    }

                                    currentTool = null;
                                }
                            } catch (jsonErr) {
                                // 忽略非 JSON 行
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Fetch] Error processing response:', err);
                }
            })();
        }

        return response;
    };

    console.log('[Fetch] Interceptor installed');
})();

console.log('[Claude Desktop] All desktop APIs initialized');

// ========================================
// React State 偵測與注入（實驗性）
// ========================================

// 嘗試透過 React DevTools 的內部 API 找到 MCP 相關的 React 元件
(function() {
    // 等待 React 初始化
    setTimeout(function detectReactMcpState() {
        console.log('[React Debug] Attempting to detect MCP state in React...');

        // 方法 1: 檢查 __REACT_DEVTOOLS_GLOBAL_HOOK__
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
            console.log('[React Debug] React DevTools hook found');
            var renderers = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers;
            if (renderers && renderers.size > 0) {
                console.log('[React Debug] Found', renderers.size, 'renderer(s)');
            }
        }

        // 方法 2: 尋找 React Fiber Root
        var rootElement = document.getElementById('root') || document.getElementById('__next') || document.querySelector('[data-reactroot]');
        if (rootElement) {
            var fiberKey = Object.keys(rootElement).find(function(k) { return k.startsWith('__reactFiber') || k.startsWith('__reactContainer'); });
            if (fiberKey) {
                console.log('[React Debug] Found React Fiber key:', fiberKey);
                var fiber = rootElement[fiberKey];
                console.log('[React Debug] Fiber type:', fiber ? fiber.type : 'none');
            }
        }

        // 方法 3: 監聽所有 React 狀態更新（透過 MutationObserver）
        var mcpUIObserver = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.type === 'childList') {
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === 1) {
                            // 檢查是否有 MCP 相關的 UI 元素
                            var mcpElements = node.querySelectorAll ? node.querySelectorAll('[data-testid*="mcp"], [class*="mcp"], [class*="tool"], [class*="hammer"], [class*="extension"]') : [];
                            if (mcpElements.length > 0) {
                                console.log('[MCP UI] Found MCP-related elements:', mcpElements.length);
                                // 詳細記錄每個元素
                                for (var k = 0; k < mcpElements.length; k++) {
                                    var el = mcpElements[k];
                                    try {
                                        var styles = window.getComputedStyle(el);
                                        console.log('[MCP UI] Element', k, ':', {
                                            tag: el.tagName,
                                            id: el.id,
                                            className: el.className,
                                            testId: el.getAttribute('data-testid'),
                                            display: styles.display,
                                            visibility: styles.visibility,
                                            opacity: styles.opacity,
                                            width: styles.width,
                                            height: styles.height,
                                            innerHTML: el.innerHTML ? el.innerHTML.substring(0, 200) : ''
                                        });
                                        // 記錄父元素鏈
                                        var parent = el.parentElement;
                                        var parentChain = [];
                                        while (parent && parentChain.length < 5) {
                                            parentChain.push(parent.tagName + '.' + (parent.className || '').split(' ')[0]);
                                            parent = parent.parentElement;
                                        }
                                        console.log('[MCP UI] Parent chain:', parentChain.join(' > '));
                                    } catch (e) {
                                        console.log('[MCP UI] Element', k, 'error:', e);
                                    }
                                }
                            }

                            // 檢查是否有 🔨 圖示
                            if (node.textContent && node.textContent.indexOf('🔨') >= 0) {
                                console.log('[MCP UI] Found hammer icon!');
                            }

                            // 檢查 SVG 工具圖示
                            var svgTools = node.querySelectorAll ? node.querySelectorAll('svg[class*="tool"], svg[class*="hammer"], [data-icon*="tool"], [data-icon*="hammer"]') : [];
                            if (svgTools.length > 0) {
                                console.log('[MCP UI] Found SVG tool icons:', svgTools.length);
                            }
                        }
                    }
                }
            }
        });

        mcpUIObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[React Debug] MutationObserver installed');
    }, 3000);

    // 嘗試直接注入 MCP 工具到 claude.ai 的某些全局狀態
    setTimeout(function injectMcpTools() {
        console.log('[MCP Inject] Attempting to find claude.ai internal state...');

        // 檢查是否有任何 window 屬性包含 MCP 或 tools
        var globalKeys = Object.keys(window);
        var mcpRelatedKeys = globalKeys.filter(function(k) {
            var kLower = k.toLowerCase();
            return kLower.indexOf('mcp') >= 0 ||
                   kLower.indexOf('tool') >= 0 ||
                   kLower.indexOf('extension') >= 0 ||
                   kLower.indexOf('claude') >= 0 ||
                   kLower.indexOf('store') >= 0 ||
                   kLower.indexOf('state') >= 0;
        });

        console.log('[MCP Inject] Found potentially relevant global keys:', mcpRelatedKeys.slice(0, 20));

        // 檢查 localStorage 中是否有 MCP 相關資料
        try {
            var storageKeys = Object.keys(localStorage);
            var mcpStorageKeys = storageKeys.filter(function(k) {
                return k.toLowerCase().indexOf('mcp') >= 0 || k.toLowerCase().indexOf('tool') >= 0;
            });
            if (mcpStorageKeys.length > 0) {
                console.log('[MCP Inject] Found MCP-related localStorage keys:', mcpStorageKeys);
                // 顯示每個 key 的內容
                for (var i = 0; i < mcpStorageKeys.length; i++) {
                    var key = mcpStorageKeys[i];
                    var value = localStorage.getItem(key);
                    console.log('[MCP Inject] localStorage[' + key + ']:', value ? value.substring(0, 500) : 'null');

                    // 嘗試解析 JSON
                    try {
                        var parsed = JSON.parse(value);
                        console.log('[MCP Inject] localStorage[' + key + '] parsed:', parsed);
                    } catch (parseErr) {
                        // 不是 JSON
                    }
                }
            }

            // 列出所有 localStorage keys 以便分析
            console.log('[MCP Inject] All localStorage keys:', storageKeys);

        } catch (e) {
            console.log('[MCP Inject] Cannot access localStorage:', e);
        }

        // 檢查 sessionStorage
        try {
            var sessionKeys = Object.keys(sessionStorage);
            var mcpSessionKeys = sessionKeys.filter(function(k) {
                return k.toLowerCase().indexOf('mcp') >= 0 || k.toLowerCase().indexOf('tool') >= 0;
            });
            if (mcpSessionKeys.length > 0) {
                console.log('[MCP Inject] Found MCP-related sessionStorage keys:', mcpSessionKeys);
                for (var i = 0; i < mcpSessionKeys.length; i++) {
                    var key = mcpSessionKeys[i];
                    var value = sessionStorage.getItem(key);
                    console.log('[MCP Inject] sessionStorage[' + key + ']:', value ? value.substring(0, 500) : 'null');
                }
            }
        } catch (e) {
            console.log('[MCP Inject] Cannot access sessionStorage:', e);
        }

        // 顯示找到的全局變數名稱
        console.log('[MCP Inject] Relevant global keys (full list):', mcpRelatedKeys);

    }, 5000);

    // === 嘗試透過 localStorage 注入 MCP 狀態 ===
    setTimeout(function tryLocalStorageInjection() {
        console.log('[MCP LocalStorage] Attempting to inject MCP state via localStorage...');

        var servers = window.__mcpServersCache || {};
        var serverNames = Object.keys(servers);

        if (serverNames.length === 0) {
            console.log('[MCP LocalStorage] No servers to inject');
            return;
        }

        // 嘗試各種可能的 localStorage key 格式
        var possibleKeys = [
            'mcp_servers',
            'mcpServers',
            'mcp-servers',
            'claude_mcp_servers',
            'claude-mcp-servers',
            'desktop_mcp_config',
            'mcp_config',
            'mcp_tools',
            'mcpTools'
        ];

        var mcpData = {
            servers: servers,
            timestamp: Date.now()
        };

        var mcpDataStr = JSON.stringify(mcpData);

        for (var i = 0; i < possibleKeys.length; i++) {
            var key = possibleKeys[i];
            try {
                localStorage.setItem(key, mcpDataStr);
                console.log('[MCP LocalStorage] Set localStorage[' + key + ']');
            } catch (e) {
                console.error('[MCP LocalStorage] Failed to set', key, e);
            }
        }

        // 觸發 storage 事件（模擬另一個 tab 修改了 storage）
        try {
            var storageEvent = new StorageEvent('storage', {
                key: 'mcp_servers',
                newValue: mcpDataStr,
                oldValue: null,
                storageArea: localStorage,
                url: window.location.href
            });
            window.dispatchEvent(storageEvent);
            console.log('[MCP LocalStorage] Dispatched storage event');
        } catch (e) {
            console.error('[MCP LocalStorage] Failed to dispatch storage event:', e);
        }

    }, 6000);
})();

// ========================================
// 模擬完整的 MCP Server 管理（主程序風格）
// ========================================

// 建立一個完整的 MCP 管理器，模擬 Electron main process 的行為
window.__mcpManager = {
    servers: {},
    transports: {},
    connected: {},

    // 模擬 main process 的 MCP server 連線管理
    connectServer: async function(serverName) {
        console.log('[MCP Manager] Connecting to server:', serverName);

        if (this.connected[serverName]) {
            console.log('[MCP Manager] Already connected to:', serverName);
            return this.transports[serverName];
        }

        // 標記為連線中
        this.connected[serverName] = true;

        // 從快取取得 server 資訊
        var serverData = window.__mcpServersCache ? window.__mcpServersCache[serverName] : null;
        if (serverData) {
            this.servers[serverName] = serverData;
            console.log('[MCP Manager] Server data loaded:', serverName, serverData.tools ? serverData.tools.length : 0, 'tools');
        }

        // 廣播連線成功事件
        this.broadcastStatus(serverName, 'connected');

        return {
            serverName: serverName,
            status: 'connected',
            tools: serverData ? serverData.tools : []
        };
    },

    broadcastStatus: function(serverName, status) {
        console.log('[MCP Manager] Broadcasting status:', serverName, status);

        // 透過所有可能的機制廣播狀態
        // 1. 自定義事件
        var event = new CustomEvent('mcp:status', {
            detail: { serverName: serverName, status: status }
        });
        window.dispatchEvent(event);

        // 2. 更新 __mcpServersCache
        if (window.__mcpServersCache && window.__mcpServersCache[serverName]) {
            window.__mcpServersCache[serverName].status = status;
        }

        // 3. 發送到 message channel（如果存在）
        if (window.__mcpMessagePorts && window.__mcpMessagePorts[serverName]) {
            try {
                window.__mcpMessagePorts[serverName].postMessage({
                    type: 'status',
                    serverName: serverName,
                    status: status
                });
            } catch (e) {
                console.error('[MCP Manager] Failed to post to MessagePort:', e);
            }
        }
    },

    getStatus: function(serverName) {
        return this.connected[serverName] ? 'connected' : 'disconnected';
    },

    getAllServers: function() {
        return window.__mcpServersCache || {};
    }
};

console.log('[MCP Manager] MCP Manager initialized');
