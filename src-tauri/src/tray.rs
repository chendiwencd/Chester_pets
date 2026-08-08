use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::{settings, windows};

const TRAY_ID: &str = "main-tray";

fn build_tray_menu(app: &AppHandle, monitor_enabled: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle_item = MenuItem::with_id(app, "toggle_pet", "显示/隐藏宠物", true, None::<&str>)?;
    let monitor_item = CheckMenuItem::with_id(
        app,
        "monitor_mode",
        "监控模式",
        true,
        monitor_enabled,
        None::<&str>,
    )?;
    let open_control_panel_item = MenuItem::with_id(
        app,
        "open_control_panel",
        "打开控制面板",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&toggle_item, &monitor_item, &open_control_panel_item, &quit_item])
}

pub fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    let monitor_enabled = settings::is_monitor_mode_enabled(app);
    let menu = build_tray_menu(app, monitor_enabled)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, settings::is_monitor_mode_enabled(app))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("missing default window icon"),
        )
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_pet" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(true);
                    if visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "monitor_mode" => {
                let next = !settings::is_monitor_mode_enabled(app);
                settings::apply_monitor_mode(app, next);
            }
            "open_control_panel" => {
                let _ = windows::show_control_panel(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
