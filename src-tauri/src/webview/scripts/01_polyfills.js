// Claude Desktop API - 在頁面載入前注入
window.isElectron = true;

// === 隱藏 MCP 連線錯誤 toast ===
// claude.ai 會因為 race condition 顯示 "Could not attach to MCP server" 錯誤
// 但實際上連線是成功的，所以只隱藏這個特定的 toast
// 注意：只隱藏精確匹配的 toast，不影響其他錯誤訊息
(function() {
    var MCP_ERROR_TEXT = 'Could not attach to MCP server';

    // 只隱藏包含特定 MCP 錯誤的單一 toast，不影響其他訊息
    var hideMcpErrorToast = function() {
        // 只選擇 Sonner toast 元素（claude.ai 使用的 toast 庫）
        var toasts = document.querySelectorAll('[data-sonner-toast]');
        toasts.forEach(function(toast) {
            // 已經處理過的跳過
            if (toast.dataset.mcpHidden === 'true') return;

            // 檢查這個 toast 的直接內容文字
            var contentEl = toast.querySelector('[data-content]');
            if (!contentEl) return;

            var text = contentEl.textContent || '';
            // 精確匹配 MCP 連線錯誤
            if (text.indexOf(MCP_ERROR_TEXT) >= 0) {
                toast.style.display = 'none';
                toast.dataset.mcpHidden = 'true';
                console.log('[MCP] Hid false-positive error toast:', text.substring(0, 50));
            }
        });
    };

    // 頁面載入後開始監控
    var startObserver = function() {
        var target = document.body || document.documentElement;
        if (!target) return;

        var observer = new MutationObserver(function(mutations) {
            // 只在有新增節點時才檢查
            var hasNewNodes = mutations.some(function(m) { return m.addedNodes.length > 0; });
            if (hasNewNodes) hideMcpErrorToast();
        });
        observer.observe(target, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
