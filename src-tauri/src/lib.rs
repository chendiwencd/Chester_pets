mod clipboard;
mod commands;
mod settings;
mod state;
mod tray;
mod windows;

use tauri::{Emitter, Manager, WindowEvent};
use std::time::Duration;
use windows::{position_panel, PanelKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::add_text_history_item,
            commands::clear_clipboard_history,
            commands::copy_clipboard_history_item,
            commands::delete_clipboard_history_item,
            commands::get_monitor_mode,
            commands::log_debug,
            commands::get_clipboard_history,
            commands::open_control_panel,
            commands::open_original_image,
            commands::open_preview,
            commands::open_storage,
            commands::close_preview,
            commands::poll_clipboard,
            commands::toggle_pin_clipboard_history_item,
            commands::save_pet_position,
            commands::set_panel_visibility,
            commands::set_monitor_mode,
        ])
        .setup(|app| {
            let handle = app.handle();
            let position = state::load_position(handle);
            let history = state::load_history(handle);
            let settings = state::load_settings(handle);
            println!(
                "[setup] loaded pet position ({}, {})",
                position.x, position.y
            );
            println!("[setup] loaded clipboard history count={}", history.len());
            println!(
                "[setup] loaded settings monitor_mode={}",
                settings.monitor_mode
            );
            {
                let app_state = handle.state::<state::AppState>();
                *app_state.clipboard_history.lock().unwrap() = history.clone();
                *app_state.clipboard_history_seq.lock().unwrap() =
                    history.iter().map(|item| item.id).max().unwrap_or(0);
                *app_state.monitor_mode.lock().unwrap() = settings.monitor_mode;
            }
            windows::build_main_window(handle, position)?;
            windows::build_all_panel_windows(handle, position)?;
            tray::setup_tray(handle)?;
            clipboard::spawn_clipboard_monitor(handle.clone());
            println!("[setup] main window, panel windows and tray initialized");
            Ok(())
        })
        .on_window_event(|window, event| {
            // 全局聚焦管理：只有当本应用所有窗口都失焦时，才关闭面板/预览并让宠物回到等待态。
            if let WindowEvent::Focused(focused) = event {
                let label = window.label().to_string();
                let state = window.state::<state::AppState>();
                {
                    let mut focused_set = state.focused_windows.lock().unwrap();
                    // 每次 focus 事件都推进 epoch，用于去抖动判定“真的失焦”
                    let epoch = {
                        let mut e = state.focus_epoch.lock().unwrap();
                        *e += 1;
                        *e
                    };
                    if *focused {
                        focused_set.insert(label.clone());
                    } else {
                        focused_set.remove(&label);
                    }

                    if focused_set.is_empty() {
                        // 去抖：窗口切换焦点（main -> preview）可能出现极短暂的“全部失焦”
                        let app = window.app_handle().clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(120));
                            let state = app.state::<state::AppState>();
                            let still_empty = state.focused_windows.lock().unwrap().is_empty();
                            let still_same_epoch = *state.focus_epoch.lock().unwrap() == epoch;
                            if still_empty && still_same_epoch {
                                println!("[app] deactivated -> hide overlays");
                                *state.panel_open.lock().unwrap() = false;
                                commands::hide_all_overlays(&app);
                                let _ = app.emit_to("main", "app-deactivated", ());
                            }
                        });
                    }
                }
            }

            if window.label() == "main" && matches!(event, WindowEvent::Moved(_)) {
                let panel_open = *window.state::<state::AppState>().panel_open.lock().unwrap();
                if panel_open {
                    let handle = window.app_handle();
                    if let (Ok(position), Ok(scale_factor)) =
                        (window.outer_position(), window.scale_factor())
                    {
                        let logical = position.to_logical::<f64>(scale_factor);
                        println!(
                            "[main moved] outer=({}, {}), scale_factor={}, logical=({}, {}), panel_open={panel_open}",
                            position.x,
                            position.y,
                            scale_factor,
                            logical.x,
                            logical.y
                        );
                        for kind in PanelKind::ALL {
                            if let Some(panel_window) = handle.get_webview_window(kind.label()) {
                                position_panel(
                                    &panel_window,
                                    kind,
                                    logical.x.round() as i32,
                                    logical.y.round() as i32,
                                );
                            }
                        }
                    }
                }
            }

            // 宠物窗口和 3 个面板窗口都只是"隐藏"，不真的销毁：
            // - 面板隐藏后内容还在，下次打开面板不用重新粘贴
            // - 宠物窗口隐藏后靠托盘菜单"显示/隐藏宠物"找回，只有托盘"退出"才真正结束进程
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main"
                    || label == "preview"
                    || label == "image-viewer"
                    || label == "control-panel"
                    || label.starts_with("panel-")
                {
                    println!("[window close requested] hide {label} instead of destroy");
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
