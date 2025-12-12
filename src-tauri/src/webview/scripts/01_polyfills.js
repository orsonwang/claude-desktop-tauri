// Claude Desktop API - 在頁面載入前注入
window.isElectron = true;

// === 靜默阻擋被 CSP 限制的遙測請求 ===
// claude.ai 的 CSP 阻擋了 a-api.anthropic.com（遙測/分析 API）
// 這不是核心功能，我們直接靜默忽略這些請求，避免 console 錯誤
(function() {
    var BLOCKED_DOMAINS = ['a-api.anthropic.com'];

    function isBlockedUrl(url) {
        if (!url) return false;
        return BLOCKED_DOMAINS.some(function(domain) {
            return url.indexOf(domain) >= 0;
        });
    }

    // === 攔截 fetch ===
    var originalFetch = window.fetch;
    window.fetch = function(input, init) {
        var url;
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        } else if (input instanceof URL) {
            url = input.href;
        } else {
            return originalFetch.apply(this, arguments);
        }

        // 靜默忽略遙測請求
        if (isBlockedUrl(url)) {
            // 返回一個假的成功回應
            return Promise.resolve(new Response('{}', {
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'application/json' })
            }));
        }

        return originalFetch.apply(this, arguments);
    };

    // === 攔截 XMLHttpRequest ===
    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        var xhr = new OriginalXHR();
        var _url = '';
        var _blocked = false;

        var originalOpen = xhr.open;
        xhr.open = function(method, url, async) {
            _url = url;
            _blocked = isBlockedUrl(url);

            if (_blocked) {
                // 不呼叫原始 open
                return;
            }

            return originalOpen.apply(xhr, arguments);
        };

        var originalSetRequestHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function(name, value) {
            if (_blocked) return;
            return originalSetRequestHeader.apply(xhr, arguments);
        };

        var originalSend = xhr.send;
        xhr.send = function(body) {
            if (_blocked) {
                // 模擬成功回應
                setTimeout(function() {
                    Object.defineProperty(xhr, 'status', { value: 200, writable: false, configurable: true });
                    Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false, configurable: true });
                    Object.defineProperty(xhr, 'responseText', { value: '{}', writable: false, configurable: true });
                    Object.defineProperty(xhr, 'response', { value: '{}', writable: false, configurable: true });
                    Object.defineProperty(xhr, 'readyState', { value: 4, writable: false, configurable: true });

                    if (xhr.onreadystatechange) xhr.onreadystatechange();
                    if (xhr.onload) xhr.onload();
                }, 0);
                return;
            }

            return originalSend.apply(xhr, arguments);
        };

        return xhr;
    };
    Object.keys(OriginalXHR).forEach(function(key) {
        window.XMLHttpRequest[key] = OriginalXHR[key];
    });
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;

    // === 攔截 navigator.sendBeacon ===
    if (navigator.sendBeacon) {
        var originalSendBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
            if (isBlockedUrl(url)) {
                return true; // 假裝成功
            }
            return originalSendBeacon(url, data);
        };
    }

    console.log('[Telemetry Block] Silently blocking requests to:', BLOCKED_DOMAINS.join(', '));
})();

// === 隱藏 MCP 連線錯誤 toast ===
// claude.ai 會因為 race condition 顯示 "Could not attach to MCP server" 錯誤
// 但實際上連線是成功的，所以隱藏這些 toast
(function() {
    var MCP_ERROR_TEXT = 'Could not attach to MCP server';

    // 隱藏包含 MCP 錯誤的 toast
    var hideMcpErrorToast = function() {
        // 方法 1: Sonner toast（claude.ai 使用的 toast 庫）
        var sonnerToasts = document.querySelectorAll('[data-sonner-toast]');
        sonnerToasts.forEach(function(toast) {
            if (toast.dataset.mcpHidden === 'true') return;
            var text = toast.textContent || '';
            if (text.indexOf(MCP_ERROR_TEXT) >= 0) {
                toast.style.display = 'none';
                toast.dataset.mcpHidden = 'true';
                console.log('[MCP Toast] Hidden sonner toast:', text.substring(0, 60));
            }
        });

        // 方法 2: 通用 toast 選擇器（檢查 role="alert" 或 aria-live）
        var alertElements = document.querySelectorAll('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
        alertElements.forEach(function(el) {
            if (el.dataset.mcpHidden === 'true') return;
            var text = el.textContent || '';
            if (text.indexOf(MCP_ERROR_TEXT) >= 0) {
                el.style.display = 'none';
                el.dataset.mcpHidden = 'true';
                console.log('[MCP Toast] Hidden alert element:', text.substring(0, 60));
            }
        });

        // 方法 3: 檢查所有 li 元素（Sonner 的 toast 可能是 li）
        var listItems = document.querySelectorAll('li');
        listItems.forEach(function(li) {
            if (li.dataset.mcpHidden === 'true') return;
            var text = li.textContent || '';
            if (text.indexOf(MCP_ERROR_TEXT) >= 0) {
                // 確保這是一個 toast（檢查是否有 toast 相關的樣式或屬性）
                var style = window.getComputedStyle(li);
                var isFloating = style.position === 'fixed' || style.position === 'absolute';
                var parent = li.parentElement;
                var parentStyle = parent ? window.getComputedStyle(parent) : null;
                var parentFloating = parentStyle && (parentStyle.position === 'fixed' || parentStyle.position === 'absolute');

                if (isFloating || parentFloating || li.closest('[data-sonner-toaster]') || li.closest('[role="region"]')) {
                    li.style.display = 'none';
                    li.dataset.mcpHidden = 'true';
                    console.log('[MCP Toast] Hidden list item:', text.substring(0, 60));
                }
            }
        });

        // 方法 4: 直接查找包含錯誤文字的元素並隱藏其 toast 容器
        var allElements = document.body ? document.body.getElementsByTagName('*') : [];
        for (var i = 0; i < allElements.length; i++) {
            var el = allElements[i];
            if (el.dataset.mcpHidden === 'true') continue;

            // 只檢查葉子節點或小型元素
            if (el.children.length > 5) continue;

            var text = el.textContent || '';
            if (text.indexOf(MCP_ERROR_TEXT) >= 0 && text.length < 200) {
                // 找到最近的 toast 容器
                var container = el.closest('[data-sonner-toast]') ||
                               el.closest('[role="alert"]') ||
                               el.closest('li') ||
                               el;

                if (container && container.dataset.mcpHidden !== 'true') {
                    container.style.display = 'none';
                    container.dataset.mcpHidden = 'true';
                    console.log('[MCP Toast] Hidden container:', text.substring(0, 60));
                }
            }
        }
    };

    // 頁面載入後開始監控
    var startObserver = function() {
        var target = document.body || document.documentElement;
        if (!target) {
            // 如果 body 還不存在，延遲重試
            setTimeout(startObserver, 100);
            return;
        }

        console.log('[MCP Toast] Starting MutationObserver...');

        // 立即執行一次
        hideMcpErrorToast();

        var observer = new MutationObserver(function(mutations) {
            // 使用 requestAnimationFrame 來批次處理
            requestAnimationFrame(hideMcpErrorToast);
        });

        observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });

        // 每隔一段時間也檢查一次（備用）
        setInterval(hideMcpErrorToast, 1000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();

// === 定時 MCP 測試 ===
// 每 30 秒輪流呼叫 Filesystem MCP 的 read_file 和 list_directory
// 可透過 window.__mcpTestEnabled = false 關閉
(function() {
    var TEST_INTERVAL = 30000;  // 30 秒
    var STARTUP_DELAY = 15000;  // 延遲 15 秒啟動（等待 MCP server 載入）
    var testCount = 0;

    // 預設啟用測試
    window.__mcpTestEnabled = true;

    // 找到 Filesystem server 的 internalName
    function findFilesystemServer() {
        var mapping = window.__mcpNameMapping || {};
        // 嘗試常見的名稱
        var candidates = ['Filesystem', 'filesystem', 'ext_ant.dir.ant.anthropic.filesystem'];
        for (var i = 0; i < candidates.length; i++) {
            var name = candidates[i];
            if (mapping[name]) {
                return mapping[name];
            }
        }
        // 如果沒有映射，搜尋包含 filesystem 的 key
        for (var key in mapping) {
            if (key.toLowerCase().indexOf('filesystem') >= 0) {
                return mapping[key];
            }
        }
        return null;
    }

    async function runMcpTest() {
        if (!window.__mcpTestEnabled) {
            console.log('[MCP Test] Test disabled');
            return;
        }

        if (!window.__TAURI__) {
            console.log('[MCP Test] Tauri not available, skipping');
            return;
        }

        var serverName = findFilesystemServer();
        if (!serverName) {
            console.log('[MCP Test] Filesystem server not found, waiting...');
            console.log('[MCP Test] Available mappings:', JSON.stringify(window.__mcpNameMapping || {}));
            return;
        }

        testCount++;
        var isReadFile = (testCount % 2 === 1);
        var startTime = Date.now();

        var tool, args;
        if (isReadFile) {
            tool = 'read_file';
            args = { path: '/tmp/read.txt' };
        } else {
            tool = 'list_directory';
            args = { path: '/tmp' };
        }

        console.log('[MCP Test] ======================================');
        console.log('[MCP Test] Test #' + testCount + ' - ' + new Date().toISOString());
        console.log('[MCP Test] Server:', serverName);
        console.log('[MCP Test] Tool:', tool);
        console.log('[MCP Test] Args:', JSON.stringify(args));

        try {
            var result = await window.__TAURI__.core.invoke('mcp_call_tool', {
                server: serverName,
                tool: tool,
                arguments: args
            });

            var elapsed = Date.now() - startTime;
            console.log('[MCP Test] SUCCESS in', elapsed, 'ms');
            console.log('[MCP Test] Result:', JSON.stringify(result).substring(0, 500));
        } catch (err) {
            var elapsed = Date.now() - startTime;
            console.error('[MCP Test] FAILED in', elapsed, 'ms');
            console.error('[MCP Test] Error:', err);
        }
        console.log('[MCP Test] ======================================');
    }

    // 延遲啟動
    setTimeout(function() {
        if (!window.__mcpTestEnabled) {
            console.log('[MCP Test] Test disabled at startup');
            return;
        }

        console.log('[MCP Test] Starting periodic tests (every 30 seconds)...');
        console.log('[MCP Test] To disable: window.__mcpTestEnabled = false');

        // 立即執行第一次
        runMcpTest();

        // 設定定時執行
        setInterval(runMcpTest, TEST_INTERVAL);
    }, STARTUP_DELAY);

    console.log('[MCP Test] Scheduled to start in', STARTUP_DELAY / 1000, 'seconds');
})();
