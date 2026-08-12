use base64::{engine::general_purpose::STANDARD, Engine};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::image::Image;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::state::{save_history, save_position, AppState, ClipboardHistoryItem, PetPosition};
use crate::windows::{position_image_viewer, position_preview, PanelKind};
use crate::{settings, windows};

#[derive(Clone, serde::Serialize)]
struct PanelContentPayload {
    id: Option<u64>,
    kind: String,
    value: String,
}

// main_x/main_y 为主窗口物理坐标，main_scale 为主窗口所在屏缩放。
// 具体的边界翻转/防重叠布局在 windows::position_panels_around 里。
fn position_all_panels(app: &AppHandle, main_x: i32, main_y: i32, main_scale: f64) {
    println!("[panel visibility] position_all_panels main_phys=({main_x}, {main_y}) scale={main_scale}");
    windows::position_panels_around(app, main_x, main_y, main_scale);
}

fn latest_history_value(history: &[ClipboardHistoryItem], kind: &str) -> Option<(u64, String)> {
    history
        .iter()
        .rev()
        .find(|item| item.kind == kind)
        .map(|item| (item.id, item.value.clone()))
}

fn refresh_primary_panels_from_history(app: &AppHandle, state: &State<AppState>) {
    let history = state.clipboard_history.lock().unwrap().clone();

    let image_payload = latest_history_value(&history, "image");
    let _ = app.emit_to(
        "panel-img",
        "panel-content",
        PanelContentPayload {
            id: image_payload.as_ref().map(|(id, _)| *id),
            kind: "image".to_string(),
            value: image_payload.map(|(_, value)| value).unwrap_or_default(),
        },
    );

    let text_payload = latest_history_value(&history, "text");
    let _ = app.emit_to(
        "panel-text",
        "panel-content",
        PanelContentPayload {
            id: text_payload.as_ref().map(|(id, _)| *id),
            kind: "text".to_string(),
            value: text_payload.map(|(_, value)| value).unwrap_or_default(),
        },
    );
}

#[tauri::command]
pub fn save_pet_position(app: AppHandle, x: i32, y: i32) {
    println!("[pet] save_pet_position ({x}, {y})");
    let _ = save_position(&app, PetPosition { x, y });
}

#[tauri::command]
pub fn log_debug(message: String) {
    println!("{message}");
}

#[tauri::command]
pub fn set_panel_visibility(app: AppHandle, state: State<AppState>, open: bool) -> bool {
    {
        let mut panel_open = state.panel_open.lock().unwrap();
        *panel_open = open;
    }
    {
        let mut sig = state.clipboard_signatures.lock().unwrap();
        *sig = crate::state::ClipboardSignatures::default();
    }
    println!("[panel visibility] requested open={open}");

    let Some(main_window) = app.get_webview_window("main") else {
        eprintln!("[panel visibility] main window not found, skip");
        return open;
    };
    let position = match main_window.outer_position() {
        Ok(pos) => pos,
        Err(err) => {
            eprintln!("[panel visibility] failed to read main window position: {err}");
            return open;
        }
    };
    let scale_factor = match main_window.scale_factor() {
        Ok(scale) => scale,
        Err(err) => {
            eprintln!("[panel visibility] failed to read main window scale factor: {err}");
            return open;
        }
    };
    println!(
        "[panel visibility] main outer=({}, {}), scale_factor={}",
        position.x, position.y, scale_factor
    );

    if open {
        position_all_panels(&app, position.x, position.y, scale_factor);
    }

    for kind in PanelKind::ALL {
        let Some(window) = app.get_webview_window(kind.label()) else {
            eprintln!("[panel visibility] {} missing after positioning", kind.label());
            continue;
        };
        if open {
            if let Err(err) = window.show() {
                eprintln!("[panel visibility] failed to show {}: {err}", kind.label());
            } else {
                let visible = window.is_visible().unwrap_or(false);
                println!("[panel visibility] showed {} visible={visible}", kind.label());
            }
        } else if let Err(err) = window.hide() {
            eprintln!("[panel visibility] failed to hide {}: {err}", kind.label());
        } else {
            let visible = window.is_visible().unwrap_or(true);
            println!("[panel visibility] hid {} visible={visible}", kind.label());
        }
    }

    if open {
        refresh_primary_panels_from_history(&app, &state);
    }

    open
}

#[tauri::command]
pub fn poll_clipboard(app: AppHandle, state: State<AppState>) {
    let panel_open = *state.panel_open.lock().unwrap();
    let monitor_mode = *state.monitor_mode.lock().unwrap();
    if !panel_open || monitor_mode {
        return;
    }

    let mut sig = state.clipboard_signatures.lock().unwrap();
    crate::clipboard::forward_latest_clipboard(&app, &mut sig);
}

#[tauri::command]
pub fn get_monitor_mode(state: State<AppState>) -> bool {
    *state.monitor_mode.lock().unwrap()
}

#[tauri::command]
pub fn set_monitor_mode(app: AppHandle, enabled: bool) -> bool {
    settings::apply_monitor_mode(&app, enabled);
    enabled
}

#[tauri::command]
pub fn open_control_panel(app: AppHandle) {
    let _ = windows::show_control_panel(&app);
}

#[tauri::command]
pub fn recall_pet(app: AppHandle) {
    recall_pet_impl(&app);
}

// 召回宠物：把主窗口移回主显示器工作区中央并显示聚焦。无论之前因为跨屏坐标问题被摆到哪，
// 这个都能把它找回来。托盘菜单和 recall_pet 命令共用。
pub fn recall_pet_impl(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[recall_pet] main window not found");
        return;
    };

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let mpos = monitor.position();
        let msize = monitor.size();
        let win = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize::new(120, 120));
        let cx = mpos.x + (msize.width as i32 - win.width as i32) / 2;
        let cy = mpos.y + (msize.height as i32 - win.height as i32) / 2;
        let _ = window.set_position(tauri::PhysicalPosition::new(cx, cy));
        println!("[recall_pet] centered at ({cx}, {cy}) on primary monitor");
    }

    let _ = window.show();
    let _ = window.set_focus();

    // 保存新位置（逻辑像素，与 build_main_window 的还原口径一致）。
    if let (Ok(pos), Ok(scale)) = (window.outer_position(), window.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        let _ = save_position(
            app,
            PetPosition {
                x: logical.x.round() as i32,
                y: logical.y.round() as i32,
            },
        );
    }
}

#[derive(Clone, serde::Serialize)]
struct PreviewPayload {
    id: Option<u64>,
    kind: String,
    value: String,
}

#[derive(Clone, serde::Serialize)]
struct PreviewStatePayload {
    open: bool,
}

#[derive(Clone, serde::Serialize)]
struct OriginalImagePayload {
    value: String,
}

#[tauri::command]
pub fn open_preview(
    app: AppHandle,
    state: State<AppState>,
    id: Option<u64>,
    kind: String,
    value: String,
) {
    // 进入预览时，收起三个面板窗口（并停止剪贴板轮询）
    {
        let mut panel_open = state.panel_open.lock().unwrap();
        *panel_open = false;
    }
    for label in ["panel-img", "panel-text", "panel-web"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }

    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(scale_factor)) = (main_window.outer_position(), main_window.scale_factor()) else {
        return;
    };

    if let Some(preview) = app.get_webview_window("preview") {
        position_preview(&preview, position.x, position.y, scale_factor);
        let _ = preview.show();
        let _ = preview.set_focus();
        let _ = app.emit_to(
            "preview",
            "preview-content",
            PreviewPayload { id, kind, value },
        );
        let _ = app.emit_to("main", "preview-state", PreviewStatePayload { open: true });
    }
}

// 打开“存储区”：不针对某一条具体内容，直接把剪贴板历史列表展开。
// 展示逻辑和 open_preview 一致（同一个 preview 窗口），区别只在于选中哪一条——
// 这里默认选中最新的一条，避免右侧内容区一进来就是空白；历史为空时只展示空列表。
#[tauri::command]
pub fn open_storage(app: AppHandle) {
    open_storage_impl(&app);
}

// 打开存储区的实际逻辑，抽成普通函数，供 open_storage 命令和全局快捷键(Ctrl+Shift+V)共用。
pub fn open_storage_impl(app: &AppHandle) {
    let state = app.state::<AppState>();
    // 和 open_preview 保持一致：进入存储区时收起三个面板窗口
    {
        let mut panel_open = state.panel_open.lock().unwrap();
        *panel_open = false;
    }
    for label in ["panel-img", "panel-text", "panel-web"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }

    let Some(main_window) = app.get_webview_window("main") else {
        eprintln!("[open_storage] main window not found");
        return;
    };
    let (Ok(position), Ok(scale_factor)) =
        (main_window.outer_position(), main_window.scale_factor())
    else {
        eprintln!("[open_storage] failed to read main window position/scale");
        return;
    };

    let Some(preview) = app.get_webview_window("preview") else {
        eprintln!("[open_storage] preview window not found");
        return;
    };
    position_preview(&preview, position.x, position.y, scale_factor);
    let _ = preview.show();
    let _ = preview.set_focus();

    let latest = {
        let history = state.clipboard_history.lock().unwrap();
        history.last().cloned()
    };
    println!(
        "[open_storage] shown, preselect={}",
        latest.as_ref().map_or("none".to_string(), |item| item.id.to_string())
    );
    if let Some(item) = latest {
        let _ = app.emit_to(
            "preview",
            "preview-content",
            PreviewPayload {
                id: Some(item.id),
                kind: item.kind,
                value: item.value,
            },
        );
    }

    let _ = app.emit_to("main", "preview-state", PreviewStatePayload { open: true });
}

// 开机自启：读/写系统实际的自启注册状态，并把选择同步进 settings.json。
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(err) = result {
        eprintln!("[autostart] failed to set enabled={enabled}: {err}");
    }

    // 以系统实际状态为准回写 settings.json，避免设置文件和注册表状态不一致。
    let actual = manager.is_enabled().unwrap_or(false);
    let monitor_mode = *app.state::<AppState>().monitor_mode.lock().unwrap();
    let _ = crate::state::save_settings(
        &app,
        &crate::state::AppSettings {
            monitor_mode,
            autostart: actual,
        },
    );
    actual
}

#[tauri::command]
pub fn open_original_image(app: AppHandle, value: String) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(scale_factor)) = (main_window.outer_position(), main_window.scale_factor()) else {
        return;
    };

    if let Some(window) = app.get_webview_window("image-viewer") {
        position_image_viewer(&window, position.x, position.y, scale_factor);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to(
            "image-viewer",
            "original-image-content",
            OriginalImagePayload { value },
        );
    }
}

#[tauri::command]
pub fn get_clipboard_history(state: State<AppState>) -> Vec<ClipboardHistoryItem> {
    state.clipboard_history.lock().unwrap().clone()
}

#[tauri::command]
pub fn clear_clipboard_history(app: AppHandle, state: State<AppState>) {
    state.clipboard_history.lock().unwrap().clear();
    *state.clipboard_signatures.lock().unwrap() = crate::state::ClipboardSignatures::default();
    let _ = save_history(&app, &[]);
    let _ = app.emit_to("preview", "history-cleared", ());
    if *state.panel_open.lock().unwrap() {
        refresh_primary_panels_from_history(&app, &state);
    }
}

#[tauri::command]
pub fn delete_clipboard_history_item(app: AppHandle, state: State<AppState>, id: u64) {
    let mut history = state.clipboard_history.lock().unwrap();
    history.retain(|item| item.id != id);
    let snapshot = history.clone();
    drop(history);
    let _ = save_history(&app, &snapshot);
    let _ = app.emit_to("preview", "history-deleted", id);
    if *state.panel_open.lock().unwrap() {
        refresh_primary_panels_from_history(&app, &state);
    }
}

#[tauri::command]
pub fn copy_clipboard_history_item(app: AppHandle, state: State<AppState>, id: u64) {
    let item = {
        let history = state.clipboard_history.lock().unwrap();
        history.iter().find(|item| item.id == id).cloned()
    };
    let Some(item) = item else {
        return;
    };

    if item.kind == "image" {
        // 新数据 value 是文件路径；旧数据可能仍是 data URL，两种都兼容。
        let bytes = if let Some((_, base64_part)) = item
            .value
            .starts_with("data:")
            .then(|| item.value.split_once(','))
            .flatten()
        {
            let Ok(bytes) = STANDARD.decode(base64_part) else {
                return;
            };
            bytes
        } else {
            let Ok(bytes) = std::fs::read(&item.value) else {
                eprintln!("[copy] failed to read image file {}", item.value);
                return;
            };
            bytes
        };
        let Ok(decoded) = image::load_from_memory(&bytes) else {
            return;
        };
        let rgba = decoded.to_rgba8();
        let image = Image::new_owned(
            rgba.as_raw().clone(),
            rgba.width(),
            rgba.height(),
        );
        let _ = app.clipboard().write_image(&image);
    } else {
        let _ = app.clipboard().write_text(item.value);
    }
}

// 按需把图片文件读成 data URL 给前端 <img> 显示。只有真正要显示某张图时才调用，
// 历史 JSON 本身只存路径，保持轻量。旧的 data: 数据直接原样返回，向后兼容。
#[tauri::command]
pub fn read_image_data_url(value: String) -> Option<String> {
    if value.starts_with("data:") {
        return Some(value);
    }
    let bytes = std::fs::read(&value).ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)))
}

#[tauri::command]
pub fn add_text_history_item(app: AppHandle, value: String) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let id = crate::clipboard::append_manual_text_history(&app, trimmed.to_string());
    let state = app.state::<AppState>();
    if *state.panel_open.lock().unwrap() {
        refresh_primary_panels_from_history(&app, &state);
    }
    Some(id)
}

#[tauri::command]
pub fn toggle_pin_clipboard_history_item(app: AppHandle, state: State<AppState>, id: u64) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let updated = {
        let mut history = state.clipboard_history.lock().unwrap();
        let Some(index) = history.iter().position(|item| item.id == id) else {
            return;
        };
        let item = &mut history[index];
        item.pinned = !item.pinned;
        item.pinned_at_ms = if item.pinned { Some(now_ms) } else { None };
        let updated = item.clone();
        let snapshot = history.clone();
        drop(history);
        let _ = save_history(&app, &snapshot);
        updated
    };

    let _ = app.emit_to("preview", "history-pin-toggled", updated);
}

#[tauri::command]
pub fn close_preview(app: AppHandle) {
    if let Some(preview) = app.get_webview_window("preview") {
        let was_visible = preview.is_visible().unwrap_or(false);
        let _ = preview.hide();
        if was_visible {
            let _ = app.emit_to("main", "preview-state", PreviewStatePayload { open: false });
        }
    }
}

// 供 lib.rs 在“应用整体失焦”时调用：一把梭隐藏所有面板/预览窗口
pub fn hide_all_overlays(app: &AppHandle) {
    for label in ["panel-img", "panel-text", "panel-web", "preview"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
}
