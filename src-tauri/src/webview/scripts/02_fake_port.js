// ========================================
// 方法 29：創建假的 MessagePort，完全繞過 WebKitGTK 的 MessagePort 問題
// ========================================
// 問題分析（Method 28 確認）：
// - WebKitGTK 的 MessagePort 雙向通訊有問題
// - serverPort.postMessage() 不會拋錯，但訊息不會到達 clientPort
// - claude.ai 設置的 handler 是 arrow function，this 無法被改變
// - handler 內部的 this.onmessage 指向 claude.ai 內部對象，我們無法訪問
//
// 解決方案：
// - 不使用真正的 MessagePort
// - 創建一個假的 MessagePort 對象，完全由我們控制
// - 劫持 event.ports 讓 claude.ai 收到我們的假 port
// - 假 port 的雙向通訊完全由我們控制
(function() {
    console.log('[MCP METHOD 29] Initializing FakeMessagePort system...');

    // 存儲每個 serverName 對應的假 port
    window.__mcpFakePorts = {};
    window.__mcpPortHandlers = {};  // 保持兼容

    // 創建假的 MessagePort
    function createFakeMessagePort(serverName) {
        var fakePort = {
            __isFakePort: true,
            __serverName: serverName,
            __onmessageHandler: null,
            __listeners: [],
            __started: false,

            // 模擬 start()
            start: function() {
                console.log('[FakePort:' + serverName + '] start() called');
                this.__started = true;
            },

            // 模擬 close()
            close: function() {
                console.log('[FakePort:' + serverName + '] close() called');
                this.__started = false;
            },

            // 模擬 postMessage - claude.ai 發送請求時會調用
            postMessage: function(data) {
                console.log('[FakePort:' + serverName + '] postMessage called');
                console.log('[FakePort:' + serverName + '] data:', JSON.stringify(data).substring(0, 200));

                // 通過 window.postMessage 轉發給我們的處理邏輯
                window.postMessage({
                    type: 'mcp-fake-port-message',
                    serverName: serverName,
                    data: data
                }, '*');
            },

            // 模擬 addEventListener
            addEventListener: function(type, listener, options) {
                console.log('[FakePort:' + serverName + '] addEventListener:', type);
                if (type === 'message') {
                    this.__listeners.push(listener);
                    console.log('[FakePort:' + serverName + '] message listener added, total:', this.__listeners.length);
                }
            },

            // 模擬 removeEventListener
            removeEventListener: function(type, listener, options) {
                console.log('[FakePort:' + serverName + '] removeEventListener:', type);
                if (type === 'message') {
                    var index = this.__listeners.indexOf(listener);
                    if (index >= 0) {
                        this.__listeners.splice(index, 1);
                    }
                }
            },

            // 模擬 dispatchEvent
            dispatchEvent: function(event) {
                console.log('[FakePort:' + serverName + '] dispatchEvent:', event.type);
                if (event.type === 'message') {
                    // 觸發 onmessage
                    if (this.__onmessageHandler) {
                        try {
                            this.__onmessageHandler(event);
                        } catch (e) {
                            console.error('[FakePort:' + serverName + '] onmessage error:', e);
                        }
                    }
                    // 觸發所有 listeners
                    this.__listeners.forEach(function(listener) {
                        try {
                            listener(event);
                        } catch (e) {
                            console.error('[FakePort:' + serverName + '] listener error:', e);
                        }
                    });
                }
                return true;
            },

            // 模擬 onerror
            onerror: null,

            // 用於發送消息到 claude.ai（我們調用）
            __deliverMessage: function(data) {
                console.log('[FakePort:' + serverName + '] __deliverMessage called');
                console.log('[FakePort:' + serverName + '] data id:', data && data.id);
                console.log('[FakePort:' + serverName + '] has onmessage:', !!this.__onmessageHandler);
                console.log('[FakePort:' + serverName + '] listeners count:', this.__listeners.length);

                var event;
                try {
                    event = new MessageEvent('message', {
                        data: data,
                        origin: window.location.origin,
                        lastEventId: '',
                        source: null,
                        ports: []
                    });
                } catch (e) {
                    event = {
                        data: data,
                        type: 'message',
                        origin: window.location.origin,
                        source: null,
                        ports: []
                    };
                }

                // 直接調用 onmessage handler
                if (this.__onmessageHandler) {
                    console.log('[FakePort:' + serverName + '] Calling onmessage handler...');
                    try {
                        this.__onmessageHandler(event);
                        console.log('[FakePort:' + serverName + '] onmessage handler completed');
                    } catch (err) {
                        console.error('[FakePort:' + serverName + '] onmessage handler error:', err);
                    }
                }

                // 調用所有 listeners
                var listenersCount = this.__listeners.length;
                console.log('[FakePort:' + serverName + '] Calling', listenersCount, 'listeners...');
                for (var i = 0; i < listenersCount; i++) {
                    try {
                        this.__listeners[i](event);
                        console.log('[FakePort:' + serverName + '] Listener', i, 'completed');
                    } catch (err) {
                        console.error('[FakePort:' + serverName + '] Listener', i, 'error:', err);
                    }
                }
            }
        };

        // 定義 onmessage 作為 getter/setter
        Object.defineProperty(fakePort, 'onmessage', {
            get: function() {
                return this.__onmessageHandler;
            },
            set: function(handler) {
                console.log('[FakePort:' + serverName + '] onmessage SET');
                console.log('[FakePort:' + serverName + '] handler type:', typeof handler);
                if (handler) {
                    console.log('[FakePort:' + serverName + '] handler.toString (first 200):', handler.toString().substring(0, 200));
                }
                this.__onmessageHandler = handler;
            },
            configurable: true,
            enumerable: true
        });

        return fakePort;
    }

    // 存儲待處理的 fake port（在 postMessage 之前創建）
    window.__mcpPendingFakePorts = {};

    // 監聽 mcp-server-connected-prepare 訊息，準備假 port
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'mcp-server-connected-prepare') {
            var serverName = event.data.serverName;
            console.log('[MCP METHOD 29] Preparing fake port for:', serverName);

            var fakePort = createFakeMessagePort(serverName);
            window.__mcpFakePorts[serverName] = fakePort;
            window.__mcpPendingFakePorts[serverName] = fakePort;

            // 也保存到 __mcpPortHandlers 保持兼容
            window.__mcpPortHandlers[serverName] = {
                port: fakePort,
                handler: null,
                listeners: []
            };

            console.log('[MCP METHOD 29] Fake port prepared for:', serverName);
        }
    });

    // 攔截 mcp-server-connected 訊息，替換 event.ports
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'mcp-server-connected') {
            var serverName = event.data.serverName;
            var pendingFakePort = window.__mcpPendingFakePorts[serverName];

            console.log('[MCP METHOD 29] Intercepted mcp-server-connected for:', serverName);
            console.log('[MCP METHOD 29] Has pending fake port:', !!pendingFakePort);
            console.log('[MCP METHOD 29] Original ports length:', event.ports ? event.ports.length : 0);

            if (pendingFakePort) {
                // 劫持 event.ports，讓 claude.ai 收到我們的假 port
                try {
                    Object.defineProperty(event, 'ports', {
                        value: [pendingFakePort],
                        writable: false,
                        configurable: true
                    });
                    console.log('[MCP METHOD 29] Successfully hijacked event.ports for:', serverName);
                    console.log('[MCP METHOD 29] New ports[0] is fake port:', event.ports[0].__isFakePort);
                } catch (err) {
                    console.error('[MCP METHOD 29] Failed to hijack event.ports:', err);
                }

                // 清除 pending
                delete window.__mcpPendingFakePorts[serverName];
            }
        }
    }, true);  // capture 模式，在 claude.ai 的 handler 之前執行

    // 監聯 mcp-fake-port-message，處理 claude.ai 發送的請求
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'mcp-fake-port-message') {
            var serverName = event.data.serverName;
            var data = event.data.data;

            console.log('[MCP METHOD 29] Received fake port message from:', serverName);
            console.log('[MCP METHOD 29] Method:', data && data.method, 'ID:', data && data.id);

            // 轉發給 serverPort 處理邏輯
            // 這裡需要調用 window.__handleMcpJsonRpc 並返回結果
            (async function() {
                try {
                    var response = await window.__handleMcpJsonRpc(serverName, data);
                    console.log('[MCP METHOD 29] Got response for id:', data && data.id);

                    if (response) {
                        // 通過假 port 發送回應
                        var fakePort = window.__mcpFakePorts[serverName];
                        if (fakePort) {
                            console.log('[MCP METHOD 29] Delivering response via fake port...');
                            fakePort.__deliverMessage(response);
                        } else {
                            console.error('[MCP METHOD 29] No fake port found for:', serverName);
                        }
                    }
                } catch (err) {
                    console.error('[MCP METHOD 29] Error handling message:', err);
                    // 發送錯誤回應
                    if (data && data.id !== undefined) {
                        var fakePort = window.__mcpFakePorts[serverName];
                        if (fakePort) {
                            fakePort.__deliverMessage({
                                jsonrpc: '2.0',
                                id: data.id,
                                error: { code: -32603, message: err.toString() }
                            });
                        }
                    }
                }
            })();
        }
    });

    // 監聽 mcp-tool-result 訊息（保持兼容，作為備用）
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'mcp-tool-result') {
            var serverName = event.data.serverName;
            var response = event.data.response;

            console.log('[MCP METHOD 29] Received mcp-tool-result for:', serverName);
            console.log('[MCP METHOD 29] Response id:', response && response.id);

            var fakePort = window.__mcpFakePorts[serverName];
            if (fakePort) {
                console.log('[MCP METHOD 29] Delivering via fake port...');
                fakePort.__deliverMessage(response);
            } else {
                console.warn('[MCP METHOD 29] No fake port for:', serverName);
                // 嘗試舊方法
                var portInfo = window.__mcpPortHandlers[serverName];
                if (portInfo && portInfo.handler) {
                    console.log('[MCP METHOD 29] Fallback: calling handler directly...');
                    try {
                        var realEvent = new MessageEvent('message', {
                            data: response,
                            origin: '',
                            lastEventId: '',
                            source: null,
                            ports: []
                        });
                        portInfo.handler(realEvent);
                        console.log('[MCP METHOD 29] Fallback handler completed');
                    } catch (err) {
                        console.error('[MCP METHOD 29] Fallback handler error:', err);
                    }
                }
            }
        }
    });

    // 追蹤所有添加的 message listener
    var listenerCount = 0;
    var originalAddEventListener = window.addEventListener;
    window.addEventListener = function(type, listener, options) {
        if (type === 'message') {
            listenerCount++;
            console.log('[Window] message listener added, total:', listenerCount);
        }
        return originalAddEventListener.call(this, type, listener, options);
    };

    // 監聽所有 window.message 事件（用於調試）
    originalAddEventListener.call(window, 'message', function(event) {
        if (event.data && typeof event.data === 'object') {
            var type = event.data.type;
            if (type && type.indexOf('mcp') >= 0) {
                console.log('[Window] MCP message received:', type, 'serverName:', event.data.serverName, 'has ports:', !!(event.ports && event.ports.length));
            }
        }
    }, true);  // 使用 capture 模式優先捕獲

    console.log('[MCP METHOD 29] Initialization complete');
})();
