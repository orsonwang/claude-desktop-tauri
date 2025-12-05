// 檔案拖放和剪貼簿支援
(function() {
    'use strict';

    console.log('[FileHandling] === SCRIPT LOADED ===');

    // 等待 Tauri API 可用
    function waitForTauri(callback) {
        if (window.__TAURI__) {
            callback();
        } else {
            setTimeout(function() { waitForTauri(callback); }, 100);
        }
    }

    // MIME 類型映射
    var MIME_TYPES = {
        'txt': 'text/plain',
        'html': 'text/html',
        'htm': 'text/html',
        'css': 'text/css',
        'js': 'text/javascript',
        'mjs': 'text/javascript',
        'json': 'application/json',
        'xml': 'application/xml',
        'pdf': 'application/pdf',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp',
        'ico': 'image/x-icon',
        'bmp': 'image/bmp',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'avi': 'video/x-msvideo',
        'zip': 'application/zip',
        'tar': 'application/x-tar',
        'gz': 'application/gzip',
        '7z': 'application/x-7z-compressed',
        'rar': 'application/x-rar-compressed',
        'md': 'text/markdown',
        'markdown': 'text/markdown',
        'py': 'text/x-python',
        'rs': 'text/x-rust',
        'ts': 'text/typescript',
        'tsx': 'text/typescript-jsx',
        'jsx': 'text/javascript-jsx',
        'c': 'text/x-c',
        'cpp': 'text/x-c++',
        'h': 'text/x-c',
        'hpp': 'text/x-c++',
        'java': 'text/x-java',
        'go': 'text/x-go',
        'rb': 'text/x-ruby',
        'php': 'text/x-php',
        'swift': 'text/x-swift',
        'kt': 'text/x-kotlin',
        'scala': 'text/x-scala',
        'sh': 'text/x-shellscript',
        'bash': 'text/x-shellscript',
        'zsh': 'text/x-shellscript',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        'toml': 'text/toml',
        'ini': 'text/plain',
        'cfg': 'text/plain',
        'conf': 'text/plain',
        'log': 'text/plain',
        'csv': 'text/csv',
        'sql': 'text/x-sql',
        'graphql': 'text/x-graphql',
        'vue': 'text/x-vue',
        'svelte': 'text/x-svelte'
    };

    function getMimeType(filename) {
        var ext = filename.split('.').pop().toLowerCase();
        return MIME_TYPES[ext] || 'application/octet-stream';
    }

    // Base64 解碼為 Uint8Array
    function base64ToUint8Array(base64) {
        var binaryString = atob(base64);
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    // 創建 File 物件
    function createFile(filename, base64Data, mimeType) {
        var bytes = base64ToUint8Array(base64Data);
        var blob = new Blob([bytes], { type: mimeType });
        return new File([blob], filename, { type: mimeType, lastModified: Date.now() });
    }

    // 找到檔案上傳輸入元素
    function findFileInput() {
        // 優先找主要的檔案輸入
        var inputs = document.querySelectorAll('input[type="file"]');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            // 跳過隱藏或禁用的
            if (!input.disabled && input.offsetParent !== null) {
                return input;
            }
        }
        // 返回第一個可用的
        return inputs[0] || null;
    }

    // 找到聊天輸入區域
    function findChatArea() {
        // 嘗試各種選擇器
        var selectors = [
            '.ProseMirror',
            '[data-placeholder]',
            '[contenteditable="true"]',
            'textarea[placeholder*="message"]',
            'textarea[placeholder*="Message"]',
            'div[role="textbox"]'
        ];

        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el) return el;
        }
        return null;
    }

    // 觸發檔案上傳
    function triggerFileUpload(files) {
        if (!files || files.length === 0) return;

        console.log('[FileHandling] Uploading', files.length, 'file(s)');

        // 方法 1: 使用 DataTransfer 設置到 file input
        var fileInput = findFileInput();
        if (fileInput) {
            try {
                var dt = new DataTransfer();
                for (var i = 0; i < files.length; i++) {
                    dt.items.add(files[i]);
                }
                fileInput.files = dt.files;

                // 觸發 change 事件
                var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                fileInput.dispatchEvent(changeEvent);

                // 也觸發 input 事件
                var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                fileInput.dispatchEvent(inputEvent);

                console.log('[FileHandling] Files set via file input');
                return;
            } catch (e) {
                console.log('[FileHandling] File input method failed:', e.message);
            }
        }

        // 方法 2: 模擬拖放到聊天區域
        var chatArea = findChatArea();
        if (chatArea) {
            try {
                var dt = new DataTransfer();
                for (var i = 0; i < files.length; i++) {
                    dt.items.add(files[i]);
                }

                // 先觸發 dragenter
                var dragEnter = new DragEvent('dragenter', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                });
                chatArea.dispatchEvent(dragEnter);

                // 再觸發 dragover
                var dragOver = new DragEvent('dragover', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                });
                chatArea.dispatchEvent(dragOver);

                // 最後觸發 drop
                var dropEvent = new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                });
                chatArea.dispatchEvent(dropEvent);

                console.log('[FileHandling] Files dropped via simulated drag-drop');
                return;
            } catch (e) {
                console.log('[FileHandling] Drag-drop simulation failed:', e.message);
            }
        }

        console.warn('[FileHandling] Could not find a way to upload files');
    }

    // 顯示/隱藏拖放指示器
    function showDropIndicator(show) {
        var indicatorId = '__tauri_drop_indicator__';
        var indicator = document.getElementById(indicatorId);

        if (show && !indicator) {
            indicator = document.createElement('div');
            indicator.id = indicatorId;
            indicator.style.cssText = [
                'position: fixed',
                'top: 0',
                'left: 0',
                'right: 0',
                'bottom: 0',
                'background: rgba(59, 130, 246, 0.15)',
                'border: 4px dashed #3b82f6',
                'pointer-events: none',
                'z-index: 999999',
                'display: flex',
                'align-items: center',
                'justify-content: center',
                'font-size: 28px',
                'font-weight: 600',
                'color: #3b82f6',
                'backdrop-filter: blur(2px)'
            ].join(';');
            indicator.innerHTML = '<div style="background:white;padding:20px 40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)">Drop files here to upload</div>';
            document.body.appendChild(indicator);
        } else if (!show && indicator) {
            indicator.remove();
        }
    }

    // 初始化拖放處理
    function initDragDrop() {
        console.log('[FileHandling] Initializing drag-drop handlers');

        var tauri = window.__TAURI__;
        if (!tauri || !tauri.event) {
            console.error('[FileHandling] Tauri event API not available');
            return;
        }

        // 監聽 Tauri 拖放事件
        tauri.event.listen('tauri://drag-drop', async function(event) {
            console.log('[FileHandling] tauri://drag-drop event:', event.payload);
            showDropIndicator(false);

            var paths = event.payload.paths;
            if (!paths || paths.length === 0) return;

            var files = [];

            for (var i = 0; i < paths.length; i++) {
                var filePath = paths[i];
                console.log('[FileHandling] Reading file:', filePath);

                try {
                    // 使用 Tauri invoke 讀取檔案
                    var result = await tauri.core.invoke('read_file_base64', { path: filePath });
                    var fileName = result[0];
                    var base64Data = result[1];
                    var mimeType = getMimeType(fileName);

                    console.log('[FileHandling] File read:', fileName, 'MIME:', mimeType, 'Size:', base64Data.length);

                    var file = createFile(fileName, base64Data, mimeType);
                    files.push(file);
                } catch (err) {
                    console.error('[FileHandling] Error reading file:', filePath, err);
                }
            }

            if (files.length > 0) {
                triggerFileUpload(files);
            }
        });

        tauri.event.listen('tauri://drag-enter', function(event) {
            console.log('[FileHandling] tauri://drag-enter');
            showDropIndicator(true);
        });

        tauri.event.listen('tauri://drag-leave', function(event) {
            console.log('[FileHandling] tauri://drag-leave');
            showDropIndicator(false);
        });

        tauri.event.listen('tauri://drag-over', function(event) {
            // 保持指示器顯示
        });

        console.log('[FileHandling] Tauri drag-drop listeners registered');
    }

    // 剪貼簿處理 - 使用 Tauri clipboard API 讀取圖片
    function initClipboardPaste() {
        console.log('[FileHandling] Clipboard paste handler initialized');

        document.addEventListener('keydown', async function(event) {
            // 檢測 Ctrl+V 或 Cmd+V
            if (!((event.ctrlKey || event.metaKey) && event.key === 'v')) return;

            var tauri = window.__TAURI__;
            if (!tauri || !tauri.clipboardManager) return;

            try {
                var image = await tauri.clipboardManager.readImage();
                if (!image || typeof image.rgba !== 'function') return;

                // 獲取圖片尺寸
                var width, height;
                if (typeof image.size === 'function') {
                    var size = await image.size();
                    width = size.width || size.w || size[0];
                    height = size.height || size.h || size[1];
                }

                // 獲取 RGBA 數據
                var bytes = await image.rgba();
                if (!bytes || bytes.length === 0) return;

                // 如果沒有維度，從像素數計算
                if (!width || !height) {
                    var totalPixels = bytes.length / 4;
                    // 嘗試常見比例
                    var ratios = [[16, 9], [16, 10], [4, 3], [3, 2], [1, 1], [21, 9]];
                    for (var i = 0; i < ratios.length; i++) {
                        var r = ratios[i];
                        var w = Math.sqrt(totalPixels * r[0] / r[1]);
                        var h = totalPixels / w;
                        if (Number.isInteger(w) && Number.isInteger(h)) {
                            width = w;
                            height = h;
                            break;
                        }
                    }
                    // 嘗試正方形
                    if (!width || !height) {
                        var side = Math.sqrt(totalPixels);
                        if (Number.isInteger(side)) {
                            width = height = side;
                        }
                    }
                }

                if (!width || !height) return;

                console.log('[FileHandling] Clipboard image:', width, 'x', height);

                event.preventDefault();
                event.stopPropagation();

                // RGBA 轉 PNG
                var canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d');
                var imgData = ctx.createImageData(width, height);
                imgData.data.set(new Uint8ClampedArray(bytes));
                ctx.putImageData(imgData, 0, 0);

                canvas.toBlob(function(blob) {
                    if (blob) {
                        var file = new File([blob], 'clipboard-image.png', { type: 'image/png', lastModified: Date.now() });
                        console.log('[FileHandling] Pasting image:', file.size, 'bytes');
                        triggerFileUpload([file]);
                    }
                }, 'image/png');

            } catch (err) {
                // 沒有圖片或錯誤，讓原生處理
            }
        }, true);
    }

    // 阻止瀏覽器預設的拖放行為（避免開啟檔案）
    function preventBrowserDragDrop() {
        document.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, true);

        document.addEventListener('drop', function(e) {
            // 檢查是否為內部拖放（例如網頁元素拖放）
            var dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        console.log('[FileHandling] Browser default drag-drop prevented');
    }

    // 主初始化
    function init() {
        preventBrowserDragDrop();
        initClipboardPaste();

        waitForTauri(function() {
            console.log('[FileHandling] Tauri API available');
            initDragDrop();
        });
    }

    // 等待 DOM 準備好
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[FileHandling] === SETUP COMPLETE ===');
})();
