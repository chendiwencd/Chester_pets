use tauri::{AppHandle, Emitter, Manager};

use crate::{
    state::{load_settings, save_settings, AppState},
    tray,
};

#[derive(Clone, serde::Serialize)]
struct MonitorModePayload {
    enabled: bool,
}

pub fn is_monitor_mode_enabled(app: &AppHandle) -> bool {
    *app.state::<AppState>().monitor_mode.lock().unwrap()
}

pub fn apply_monitor_mode(app: &AppHandle, enabled: bool) {
    {
        let state = app.state::<AppState>();
        *state.monitor_mode.lock().unwrap() = enabled;
    }

    // 读现有设置再改，避免把 autostart 等其它字段覆盖掉。
    let mut settings = load_settings(app);
    settings.monitor_mode = enabled;
    let _ = save_settings(app, &settings);
    let _ = tray::refresh_tray_menu(app);
    let _ = app.emit("monitor-mode-changed", MonitorModePayload { enabled });
    let _ = app.emit_to(
        "control-panel",
        "monitor-mode-changed",
        MonitorModePayload { enabled },
    );
}
