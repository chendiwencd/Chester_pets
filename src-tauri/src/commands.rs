use base64::{engine::general_purpose::STANDARD, Engine};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::image::Image;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::state::{save_history, save_position, AppState, ClipboardHistoryItem, PetPosition};
use crate::windows::{position_image_viewer, position_panel, position_preview, PanelKind};
use crate::{settings, windows};

#[derive(Clone, serde::Serialize)]
struct PanelContentPayload {
    id: Option<u64>,
    kind: String,
    value: String,
}

fn position_all_panels(app: &AppHandle, main_x: i32, main_y: i32) {
    println!("[panel visibility] position_all_panels main=({main_x}, {main_y})");
    for kind in PanelKind::ALL {
        let Some(window) = app.get_webview_window(kind.label()) else {
            eprintln!(
                "[panel visibility] {} missing before positioning; setup should have prebuilt it",
                kind.label()
            );
            continue;
        };
        println!("[panel visibility] reuse {}", kind.label());
        position_panel(&window, kind, main_x, main_y);
        match window.outer_position() {
            Ok(pos) => println!(
                "[panel visibility] {} positioned outer=({}, {})",
                kind.label(),
                pos.x,
                pos.y
            ),
            Err(err) => eprintln!(
                "[panel visibility] failed to read {} outer_position after set_position: {err}",
                kind.label()
            ),
        }
    }
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
    let logical_position = position.to_logical::<f64>(scale_factor);
    println!(
        "[panel visibility] main outer=({}, {}), scale_factor={}, logical=({}, {})",
        position.x,
        position.y,
        scale_factor,
        logical_position.x,
        logical_position.y
    );

    if open {
        position_all_panels(
            &app,
            logical_position.x.round() as i32,
            logical_position.y.round() as i32,
        );
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
    let logical = position.to_logical::<f64>(scale_factor);

    if let Some(preview) = app.get_webview_window("preview") {
        position_preview(&preview, logical.x.round() as i32, logical.y.round() as i32);
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
pub fn open_storage(app: AppHandle, state: State<AppState>) {
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
    let logical = position.to_logical::<f64>(scale_factor);

    let Some(preview) = app.get_webview_window("preview") else {
        eprintln!("[open_storage] preview window not found");
        return;
    };
    position_preview(&preview, logical.x.round() as i32, logical.y.round() as i32);
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

#[tauri::command]
pub fn open_original_image(app: AppHandle, value: String) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(scale_factor)) = (main_window.outer_position(), main_window.scale_factor()) else {
        return;
    };
    let logical = position.to_logical::<f64>(scale_factor);

    if let Some(window) = app.get_webview_window("image-viewer") {
        position_image_viewer(&window, logical.x.round() as i32, logical.y.round() as i32);
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
        let Some((_, base64_part)) = item.value.split_once(',') else {
            return;
        };
        let Ok(bytes) = STANDARD.decode(base64_part) else {
            return;
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
