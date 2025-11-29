// Claude Desktop API - 在頁面載入前注入
window.isElectron = true;

// === 隱藏 MCP 連線錯誤 toast ===
// claude.ai 會因為 race condition 顯示 "Could not attach to MCP server" 錯誤
// 但實際上連線是成功的，所以用 CSS 隱藏這個特定的 toast
(function() {
    var style = document.createElement('style');
    style.textContent = `
        /* 隱藏 MCP 連線錯誤 toast - 這是 race condition 造成的誤報 */
        div[data-sonner-toast] [data-content]:has(div:first-child:contains("Could not attach")) {
            display: none !important;
        }
    `;
    // 使用 MutationObserver 監控並隱藏 MCP 錯誤 toast
    var hideToast = function() {
        var toasts = document.querySelectorAll('[data-sonner-toast], [role="alert"], .toast, [class*="toast"], [class*="Toast"]');
        toasts.forEach(function(toast) {
            var text = toast.textContent || '';
            if (text.indexOf('Could not attach to MCP server') >= 0) {
                toast.style.display = 'none';
                console.log('[MCP] Hid false-positive error toast');
            }
        });
    };

    // 頁面載入後開始監控
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            var observer = new MutationObserver(hideToast);
            observer.observe(document.body, { childList: true, subtree: true });
            setInterval(hideToast, 500); // 備用：定時檢查
        });
    } else {
        var observer = new MutationObserver(hideToast);
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setInterval(hideToast, 500);
    }
})();
