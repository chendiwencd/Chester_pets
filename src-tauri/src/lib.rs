mod clipboard;
mod commands;
mod settings;
mod state;
mod tray;
mod windows;

use std::time::Duration;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

fn normalize_shortcut(value: &str, fallback: &str) -> String {
    value
        .parse::<Shortcut>()
        .or_else(|_| fallback.parse::<Shortcut>())
        .map(|shortcut| shortcut.to_string())
        .unwrap_or_else(|_| fallback.to_string())
}

#[derive(Clone, serde::Serialize)]
struct FileDragStatePayload {
    active: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例保护必须第一个注册：第二次启动时唤醒已有宠物窗口而不是再开一个进程。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    let configured = app
                        .state::<state::AppState>()
                        .shortcuts
                        .lock()
                        .unwrap()
                        .clone();
                    if configured
                        .storage
                        .parse::<Shortcut>()
                        .map(|expected| shortcut == &expected)
                        .unwrap_or(false)
                    {
                        commands::open_storage_impl(app);
                    } else if configured
                        .screenshot
                        .parse::<Shortcut>()
                        .map(|expected| shortcut == &expected)
                        .unwrap_or(false)
                    {
                        commands::open_screenshot_selector(app.clone());
                    }
                })
                .build(),
        )
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::add_text_history_item,
            commands::clear_clipboard_history,
            commands::close_screenshot_selector,
            commands::close_screenshot_result,
            commands::complete_screenshot_selection,
            commands::copy_clipboard_history_item,
            commands::delete_clipboard_history_item,
            commands::get_autostart,
            commands::get_monitor_mode,
            commands::get_shortcut_settings,
            commands::log_debug,
            commands::get_clipboard_history,
            commands::open_control_panel,
            commands::open_original_image,
            commands::open_preview,
            commands::open_screenshot_selector,
            commands::open_storage,
            commands::close_preview,
            commands::paste_clipboard_to_input_panel,
            commands::poll_clipboard,
            commands::read_image_data_url,
            commands::recall_pet,
            commands::resize_input_panel,
            commands::set_autostart,
            commands::show_file_info,
            commands::set_shortcut,
            commands::toggle_pin_clipboard_history_item,
            commands::save_pet_position,
            commands::set_panel_visibility,
            commands::set_monitor_mode,
        ])
        .setup(|app| {
            let handle = app.handle();
            let position = state::load_position(handle);
            let history = state::load_history(handle);
            let mut settings = state::load_settings(handle);
            settings.shortcuts.storage = normalize_shortcut(
                &settings.shortcuts.storage,
                state::DEFAULT_STORAGE_SHORTCUT,
            );
            settings.shortcuts.screenshot = normalize_shortcut(
                &settings.shortcuts.screenshot,
                state::DEFAULT_SCREENSHOT_SHORTCUT,
            );
            if settings.shortcuts.storage == settings.shortcuts.screenshot {
                settings.shortcuts.storage =
                    normalize_shortcut("", state::DEFAULT_STORAGE_SHORTCUT);
                if settings.shortcuts.storage == settings.shortcuts.screenshot {
                    settings.shortcuts.screenshot =
                        normalize_shortcut("", state::DEFAULT_SCREENSHOT_SHORTCUT);
                }
            }
            let _ = state::save_settings(handle, &settings);
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
                *app_state.shortcuts.lock().unwrap() = settings.shortcuts.clone();
            }

            // 让系统自启注册状态与 settings.json 里的 autostart 一致（默认 false）。
            {
                use tauri_plugin_autostart::ManagerExt;
                let manager = handle.autolaunch();
                let currently = manager.is_enabled().unwrap_or(false);
                if settings.autostart && !currently {
                    let _ = manager.enable();
                } else if !settings.autostart && currently {
                    let _ = manager.disable();
                }
                println!("[setup] autostart target={}", settings.autostart);
            }

            // 注册设置中保存的全局快捷键（常驻，整个应用生命周期都在）。
            match handle
                .global_shortcut()
                .register(settings.shortcuts.storage.as_str())
            {
                Ok(_) => println!(
                    "[setup] registered storage shortcut {}",
                    settings.shortcuts.storage
                ),
                Err(err) => {
                    eprintln!(
                        "[setup] failed to register storage shortcut {}: {err}",
                        settings.shortcuts.storage
                    )
                }
            }
            match handle
                .global_shortcut()
                .register(settings.shortcuts.screenshot.as_str())
            {
                Ok(_) => println!(
                    "[setup] registered screenshot shortcut {}",
                    settings.shortcuts.screenshot
                ),
                Err(err) => {
                    eprintln!(
                        "[setup] failed to register screenshot shortcut {}: {err}",
                        settings.shortcuts.screenshot
                    )
                }
            }

            windows::build_main_window(handle, position)?;
            windows::build_all_panel_windows(handle, position)?;
            tray::setup_tray(handle)?;
            clipboard::spawn_clipboard_monitor(handle.clone());
            println!("[setup] main window, panel windows and tray initialized");
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::DragDrop(drag_event) = event {
                    match drag_event {
                        DragDropEvent::Enter { paths, .. } => {
                            if !paths.is_empty() {
                                let _ = window.app_handle().emit_to(
                                    "main",
                                    "file-drag-state",
                                    FileDragStatePayload { active: true },
                                );
                            }
                        }
                        DragDropEvent::Over { .. } => {
                            let _ = window.app_handle().emit_to(
                                "main",
                                "file-drag-state",
                                FileDragStatePayload { active: true },
                            );
                        }
                        DragDropEvent::Drop { paths, .. } => {
                            let _ = window.app_handle().emit_to(
                                "main",
                                "file-drag-state",
                                FileDragStatePayload { active: false },
                            );
                            if let Some(path) = paths.first() {
                                commands::show_file_info_for_path(window.app_handle(), path);
                            }
                        }
                        DragDropEvent::Leave => {
                            let _ = window.app_handle().emit_to(
                                "main",
                                "file-drag-state",
                                FileDragStatePayload { active: false },
                            );
                        }
                        _ => {}
                    }
                }
            }

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
                        println!(
                            "[main moved] outer=({}, {}), scale_factor={}, panel_open={panel_open}",
                            position.x, position.y, scale_factor
                        );
                        windows::position_panels_around(
                            handle,
                            position.x,
                            position.y,
                            scale_factor,
                        );
                    }
                }
            }

            // 宠物窗口和常驻面板窗口都只是"隐藏"，不真的销毁：
            // - 面板隐藏后内容还在，下次打开面板不用重新粘贴
            // - 宠物窗口隐藏后靠托盘菜单"显示/隐藏宠物"找回，只有托盘"退出"才真正结束进程
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main"
                    || label == "preview"
                    || label == "image-viewer"
                    || label == "control-panel"
                    || label == "screenshot-selector"
                    || label == "screenshot-result"
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
