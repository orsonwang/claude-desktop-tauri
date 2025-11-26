use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Chrome 相容性腳本 - 在頁面載入前注入
const CHROME_COMPAT_SCRIPT: &str = r#"
// Chrome 環境模擬
if (!window.chrome) {
    window.chrome = {
        app: {},
        runtime: {
            id: undefined,
            connect: function() {},
            sendMessage: function() {},
            onMessage: { addListener: function() {} }
        },
        csi: function() { return {}; },
        loadTimes: function() { return {}; }
    };
}
"#;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("chrome-compat")
        .js_init_script(CHROME_COMPAT_SCRIPT.to_string())
        .build()
}
