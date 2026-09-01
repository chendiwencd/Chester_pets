use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::state::{
    images_dir, save_position, AppState, ClipboardHistoryItem, PetPosition, SavedResourceInput,
};
use crate::windows::{position_image_viewer, position_preview, PanelKind, ScreenRect};
use crate::{settings, windows};

// main_x/main_y 为主窗口物理坐标，main_scale 为主窗口所在屏缩放。
// 具体的边界翻转/防重叠布局在 windows::position_panels_around 里。
fn position_all_panels(app: &AppHandle, main_x: i32, main_y: i32, main_scale: f64) {
    println!(
        "[panel visibility] position_all_panels main_phys=({main_x}, {main_y}) scale={main_scale}"
    );
    windows::position_panels_around(app, main_x, main_y, main_scale);
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

pub fn reset_input_panel(app: &AppHandle) {
    let _ = app.emit_to("panel-web", "input-panel-reset", ());
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
    reset_input_panel(&app);
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
            eprintln!(
                "[panel visibility] {} missing after positioning",
                kind.label()
            );
            continue;
        };
        if open {
            if let Err(err) = window.show() {
                eprintln!("[panel visibility] failed to show {}: {err}", kind.label());
            } else {
                let visible = window.is_visible().unwrap_or(false);
                println!(
                    "[panel visibility] showed {} visible={visible}",
                    kind.label()
                );
            }
        } else if let Err(err) = window.hide() {
            eprintln!("[panel visibility] failed to hide {}: {err}", kind.label());
        } else {
            let visible = window.is_visible().unwrap_or(true);
            println!("[panel visibility] hid {} visible={visible}", kind.label());
        }
    }

    open
}

#[tauri::command]
pub fn resize_input_panel(app: AppHandle, height: f64) {
    let Some(window) = app.get_webview_window(PanelKind::Web.label()) else {
        return;
    };
    let height = height.clamp(windows::PANEL_HEIGHT, 560.0);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        windows::PANEL_WIDTH,
        height,
    )));

    if let Some(main_window) = app.get_webview_window("main") {
        if let (Ok(position), Ok(scale_factor)) =
            (main_window.outer_position(), main_window.scale_factor())
        {
            windows::position_panels_around(&app, position.x, position.y, scale_factor);
        }
    }
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
pub fn get_close_on_blur(app: AppHandle) -> bool {
    settings::is_close_on_blur_enabled(&app)
}

#[tauri::command]
pub fn set_close_on_blur(app: AppHandle, enabled: bool) -> bool {
    settings::apply_close_on_blur(&app, enabled);
    enabled
}

#[tauri::command]
pub fn get_auto_sync(app: AppHandle) -> bool {
    crate::state::load_settings(&app).auto_sync
}

#[tauri::command]
pub fn set_auto_sync(app: AppHandle, enabled: bool) -> bool {
    let mut settings = crate::state::load_settings(&app);
    settings.auto_sync = enabled;
    if let Err(err) = crate::state::save_settings(&app, &settings) {
        eprintln!("[auto_sync] failed to save enabled={enabled}: {err}");
        return settings.auto_sync;
    }
    enabled
}

#[tauri::command]
pub fn get_text_upload_batch_size(app: AppHandle) -> u32 {
    crate::state::load_settings(&app).text_upload_batch_size
}

#[tauri::command]
pub fn set_text_upload_batch_size(app: AppHandle, batch_size: u32) -> u32 {
    // 保护：避免 0 或过大导致 UI 卡死。上限先给一个保守值。
    let batch_size = batch_size.clamp(1, 500);
    let mut settings = crate::state::load_settings(&app);
    settings.text_upload_batch_size = batch_size;
    if let Err(err) = crate::state::save_settings(&app, &settings) {
        eprintln!("[text_upload_batch_size] failed to save batch_size={batch_size}: {err}");
        return settings.text_upload_batch_size;
    }
    batch_size
}

#[tauri::command]
pub fn get_shortcut_settings(state: State<AppState>) -> crate::state::ShortcutSettings {
    state.shortcuts.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_workspace_directory(state: State<AppState>) -> String {
    state
        .workspace_dir
        .lock()
        .unwrap()
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub fn set_workspace_directory(
    app: AppHandle,
    state: State<AppState>,
    directory: String,
) -> Result<String, String> {
    let directory = directory.trim();
    let resolved = crate::state::resolve_workspace_dir(&app, directory)?;

    let mut settings = crate::state::load_settings(&app);
    settings.workspace_dir = directory.to_string();
    crate::state::save_settings(&app, &settings)
        .map_err(|err| format!("工作目录设置保存失败：{err}"))?;

    *state.workspace_dir.lock().unwrap() = resolved.clone();
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    state: State<AppState>,
    action: String,
    shortcut: String,
) -> Result<crate::state::ShortcutSettings, String> {
    let parsed = shortcut
        .trim()
        .parse::<Shortcut>()
        .map_err(|err| format!("快捷键格式无效：{err}"))?;
    if parsed.mods.is_empty() {
        return Err("快捷键至少需要包含一个修饰键。".to_string());
    }
    let normalized = parsed.to_string();

    let mut current = state.shortcuts.lock().unwrap().clone();
    let (old_value, other_value) = match action.as_str() {
        "storage" => (current.storage.clone(), current.screenshot.clone()),
        "screenshot" => (current.screenshot.clone(), current.storage.clone()),
        _ => return Err("未知的快捷键动作。".to_string()),
    };
    if normalized == other_value {
        return Err("该快捷键已被其他功能占用。".to_string());
    }
    if normalized == old_value {
        return Ok(current);
    }

    let shortcuts = app.global_shortcut();
    if shortcuts.is_registered(old_value.as_str()) {
        shortcuts
            .unregister(old_value.as_str())
            .map_err(|err| format!("无法释放旧快捷键：{err}"))?;
    }
    if let Err(err) = shortcuts.register(normalized.as_str()) {
        let _ = shortcuts.register(old_value.as_str());
        return Err(format!("无法注册快捷键：{err}"));
    }

    if action == "storage" {
        current.storage = normalized;
    } else {
        current.screenshot = normalized;
    }
    let mut settings = crate::state::load_settings(&app);
    settings.shortcuts = current.clone();
    if let Err(err) = crate::state::save_settings(&app, &settings) {
        let _ = shortcuts.unregister(current_value(&current, &action));
        let _ = shortcuts.register(old_value.as_str());
        return Err(format!("快捷键保存失败：{err}"));
    }
    *state.shortcuts.lock().unwrap() = current.clone();
    Ok(current)
}

fn current_value<'a>(settings: &'a crate::state::ShortcutSettings, action: &str) -> &'a str {
    if action == "storage" {
        &settings.storage
    } else {
        &settings.screenshot
    }
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

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct ScreenshotSelectionRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, serde::Serialize)]
struct ScreenshotResultPayload {
    ocr_text: String,
    image_data_url: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct FileInfoPayload {
    #[serde(default)]
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) size_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) mime_type: Option<String>,
    pub(crate) display_size: String,
    #[serde(default)]
    pub(crate) overview: String,
    #[serde(default)]
    pub(crate) type_placeholder: String,
    #[serde(default)]
    pub(crate) preview: String,
    #[serde(default)]
    pub(crate) file_id: Option<String>,
}

fn format_file_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 || value >= 10.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn capture_screenshot_data_url(rect: &ScreenshotSelectionRect) -> Option<String> {
    use screenshots::image::codecs::png::PngEncoder;
    use screenshots::image::{ColorType, ImageEncoder};

    let screen = screenshots::Screen::from_point(rect.x, rect.y).ok()?;
    let display = screen.display_info;
    let local_x = rect.x - display.x;
    let local_y = rect.y - display.y;
    let image = screen
        .capture_area(local_x, local_y, rect.width, rect.height)
        .ok()?;

    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8,
        )
        .ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

pub fn show_file_info_payload(app: &AppHandle, payload: FileInfoPayload) {
    let mut payload = payload;
    if payload.kind.is_empty() {
        payload.kind = "file".to_string();
    }
    if payload.preview.is_empty() {
        payload.preview = payload.name.clone();
    }
    let window = match app.get_webview_window("panel-web") {
        Some(existing) => existing,
        None => match windows::build_panel_window(app, PanelKind::Web) {
            Ok(window) => window,
            Err(err) => {
                eprintln!("[input-panel] failed to build window: {err}");
                return;
            }
        },
    };

    if let Some(main_window) = app.get_webview_window("main") {
        if let (Ok(position), Ok(scale_factor)) =
            (main_window.outer_position(), main_window.scale_factor())
        {
            windows::position_panels_around(app, position.x, position.y, scale_factor);
        }
    }

    *app.state::<AppState>().panel_open.lock().unwrap() = true;
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to("panel-web", "input-panel-content", payload);
}

pub fn show_file_info_for_path_with_summary(
    app: &AppHandle,
    path: &Path,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let payload =
        persist_file_info_for_path_with_summary(app, path, overview, extracted_text, remote_file_id)?;
    show_file_info_payload(app, payload.clone());
    Some(payload)
}

fn persist_file_info_for_path_with_summary(
    app: &AppHandle,
    path: &Path,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let stored_path = match crate::state::copy_file_to_workspace(app, path) {
        Ok(path) => path,
        Err(err) => {
            eprintln!("[workspace] {err}");
            path.to_path_buf()
        }
    };
    let kind = classify_path_kind(path);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.display().to_string());
    let size_bytes = std::fs::metadata(&stored_path)
        .ok()
        .map(|metadata| metadata.len());
    let display_size = size_bytes
        .map(format_file_size)
        .unwrap_or_else(|| "0 B".to_string());
    let stored_value = stored_path.to_string_lossy().to_string();
    let mime_type = guess_mime_type(path);
    let overview = overview.unwrap_or_default().trim().to_string();
    let extracted_text = extracted_text.unwrap_or_default();
    let extracted_text = (!extracted_text.trim().is_empty()).then_some(extracted_text);
    let remote_file_id = remote_file_id.and_then(|value| {
        let value = value.trim();
        (!value.is_empty()).then_some(value.to_string())
    });
    let resource = SavedResourceInput {
        kind: kind.to_string(),
        name: name.clone(),
        path: Some(stored_value.clone()),
        summary: (!overview.is_empty()).then_some(overview.clone()),
        extracted_text: extracted_text.clone(),
        remote_file_id: remote_file_id.clone(),
        size_bytes,
        mime_type: mime_type.clone(),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
        width: None,
        height: None,
    };
    let _ = crate::clipboard::append_history_with_resources(
        app,
        kind,
        stored_value.clone(),
        &[resource],
    );

    let payload = FileInfoPayload {
        status: "ready".to_string(),
        kind: kind.to_string(),
        name,
        size_bytes,
        mime_type,
        display_size,
        overview,
        type_placeholder: String::new(),
        preview: stored_value,
        file_id: remote_file_id,
    };
    Some(payload)
}

fn classify_path_kind(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "avif" | "bmp" | "gif" | "heic" | "jpeg" | "jpg" | "png" | "svg" | "webp" => "image",
        _ => "file",
    }
}

fn guess_mime_type(path: &Path) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "heic" => "image/heic",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "csv" => "text/csv",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => return None,
    };
    Some(mime.to_string())
}

#[tauri::command]
pub fn paste_clipboard_to_input_panel(
    app: AppHandle,
    state: State<AppState>,
) -> Option<FileInfoPayload> {
    if !*state.panel_open.lock().unwrap() {
        return None;
    }

    let mut signatures = state.clipboard_signatures.lock().unwrap();
    let payload = crate::clipboard::capture_latest_clipboard(&app, &mut signatures, false)?;
    if payload.kind == "text" {
        let _ = crate::clipboard::append_history(&app, "text", payload.preview.clone());
    }
    // 文件和图片类型已在后端自动保存到素材区，不需要前端显示确认界面
    // 只有通过拖拽且没有路径的情况才需要前端确认
    // 这里剪贴板捕获的内容已经完成导入，不发送事件
    Some(payload)
}

#[tauri::command]
pub fn save_file_to_material(
    app: AppHandle,
    path: String,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let path = Path::new(path.trim());
    if !path.is_file() {
        eprintln!("[workspace] dropped path is not a file: {}", path.display());
        return None;
    }
    show_file_info_for_path_with_summary(&app, path, overview, extracted_text, remote_file_id)
}

#[tauri::command]
pub fn save_file_to_material_silent(
    app: AppHandle,
    path: String,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let path = Path::new(path.trim());
    if !path.is_file() {
        eprintln!("[workspace] dropped path is not a file: {}", path.display());
        return None;
    }
    persist_file_info_for_path_with_summary(&app, path, overview, extracted_text, remote_file_id)
}

#[tauri::command]
pub fn read_file_data_url(value: String) -> Option<String> {
    if value.starts_with("data:") {
        return Some(value);
    }
    let path = Path::new(value.trim());
    let bytes = std::fs::read(path).ok()?;
    let mime_type = guess_mime_type(path).unwrap_or_else(|| "application/octet-stream".to_string());
    Some(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn save_file_data_url_to_material(
    app: AppHandle,
    name: String,
    mime_type: Option<String>,
    data_url: String,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let (_, encoded) = data_url.split_once(',')?;
    let bytes = STANDARD.decode(encoded.trim()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let temp_dir = app.path().temp_dir().ok()?.join(format!(
        "desktop-shell-import-{}",
        SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_nanos(),
    ));
    std::fs::create_dir_all(&temp_dir).ok()?;
    let file_name = Path::new(name.trim())
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let temp_path = temp_dir.join(file_name);
    std::fs::write(&temp_path, bytes).ok()?;
    let mut payload = show_file_info_for_path_with_summary(
        &app,
        &temp_path,
        overview,
        extracted_text,
        remote_file_id,
    );
    let _ = std::fs::remove_dir_all(temp_dir);
    if let (Some(payload), Some(mime_type)) = (payload.as_mut(), mime_type) {
        payload.mime_type = Some(mime_type);
    }
    payload
}

#[tauri::command]
pub fn save_file_data_url_to_material_silent(
    app: AppHandle,
    name: String,
    mime_type: Option<String>,
    data_url: String,
    overview: Option<String>,
    extracted_text: Option<String>,
    remote_file_id: Option<String>,
) -> Option<FileInfoPayload> {
    let (_, encoded) = data_url.split_once(',')?;
    let bytes = STANDARD.decode(encoded.trim()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let temp_dir = app.path().temp_dir().ok()?.join(format!(
        "desktop-shell-import-{}",
        SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_nanos(),
    ));
    std::fs::create_dir_all(&temp_dir).ok()?;
    let file_name = Path::new(name.trim())
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let temp_path = temp_dir.join(file_name);
    std::fs::write(&temp_path, bytes).ok()?;
    let mut payload = persist_file_info_for_path_with_summary(
        &app,
        &temp_path,
        overview,
        extracted_text,
        remote_file_id,
    );
    let _ = std::fs::remove_dir_all(temp_dir);
    if let (Some(payload), Some(mime_type)) = (payload.as_mut(), mime_type) {
        payload.mime_type = Some(mime_type);
    }
    payload
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
    reset_input_panel(&app);
    for label in ["panel-web"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }

    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(scale_factor)) =
        (main_window.outer_position(), main_window.scale_factor())
    else {
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
    reset_input_panel(&app);
    for label in ["panel-web"] {
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
        latest
            .as_ref()
            .map_or("none".to_string(), |item| item.id.to_string())
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
    let mut settings = crate::state::load_settings(&app);
    settings.monitor_mode = *app.state::<AppState>().monitor_mode.lock().unwrap();
    settings.autostart = actual;
    let _ = crate::state::save_settings(&app, &settings);
    actual
}

#[tauri::command]
pub fn open_original_image(app: AppHandle, value: String) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(scale_factor)) =
        (main_window.outer_position(), main_window.scale_factor())
    else {
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
pub fn get_clipboard_history(app: AppHandle, state: State<AppState>) -> Vec<ClipboardHistoryItem> {
    if let Ok(history) = crate::db::database_mut(&app, |database| database.load_history()) {
        *state.clipboard_history.lock().unwrap() = history.clone();
        return history;
    }
    state.clipboard_history.lock().unwrap().clone()
}

#[tauri::command]
pub fn clear_clipboard_history(app: AppHandle, state: State<AppState>) {
    let _ = crate::db::database_mut(&app, |database| database.clear_history());
    state.clipboard_history.lock().unwrap().clear();
    *state.clipboard_signatures.lock().unwrap() = crate::state::ClipboardSignatures::default();
    let _ = app.emit_to("preview", "history-cleared", ());
}

#[tauri::command]
pub fn delete_clipboard_history_item(app: AppHandle, state: State<AppState>, id: u64) {
    let Ok(deleted) = crate::db::database_mut(&app, |database| database.delete_history(id)) else {
        return;
    };
    if deleted {
        state
            .clipboard_history
            .lock()
            .unwrap()
            .retain(|item| item.id != id);
        let _ = app.emit_to("preview", "history-deleted", id);
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
        let image = Image::new_owned(rgba.as_raw().clone(), rgba.width(), rgba.height());
        let _ = app.clipboard().write_image(&image);
    } else {
        // text / note 都是内联文本，直接回写。
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
pub fn add_text_history_item(
    app: AppHandle,
    value: String,
    resources: Option<Vec<SavedResourceInput>>,
) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let resources = resources.unwrap_or_default();
    let id = crate::clipboard::append_manual_text_history_with_resources(
        &app,
        trimmed.to_string(),
        &resources,
    );
    Some(id)
}

#[tauri::command]
pub fn create_note_history_item(
    app: AppHandle,
    state: State<AppState>,
    title: String,
    value: String,
) -> Option<u64> {
    let title = title.trim().to_string();
    let has_title = !title.is_empty();
    let has_value = !value.trim().is_empty();
    if !has_title && !has_value {
        return None;
    }

    let preview = if has_title {
        title
    } else {
        // 标题为空时，回退为正文首行（截断）
        let single_line = value
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .replace('\n', " ");
        let mut chars = single_line.chars();
        let preview: String = chars.by_ref().take(28).collect();
        if chars.next().is_some() {
            format!("{preview}…")
        } else {
            preview
        }
    };

    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let normalized_value = if has_value {
        value.trim_end().to_string()
    } else {
        "".to_string()
    };

    let result = crate::db::database_mut(&app, |database| {
        database.insert_history(
            "note",
            &normalized_value,
            &preview,
            created_at_ms,
            Some("not_uploaded"),
            None,
            &[],
        )
    });
    let Ok(((item, inserted), history)) = result.and_then(|result| {
        crate::db::database_mut(&app, |database| database.load_history()).map(|history| (result, history))
    }) else {
        eprintln!("[db] failed to append note history item");
        return None;
    };

    *state.clipboard_history.lock().unwrap() = history;
    if inserted {
        let _ = app.emit_to("preview", "history-appended", item.clone());
    }
    Some(item.id)
}

#[tauri::command]
pub fn copy_text_to_clipboard(app: AppHandle, value: String) {
    let _ = app.clipboard().write_text(value);
}

#[tauri::command]
pub fn save_screenshot_note(
    app: AppHandle,
    image_data_url: String,
    ocr_text: String,
) -> Result<u64, String> {
    let (_, encoded) = image_data_url
        .split_once(',')
        .ok_or_else(|| "截图数据格式无效".to_string())?;
    let png_bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|err| format!("截图数据解码失败：{err}"))?;
    if png_bytes.is_empty() {
        return Err("截图数据为空".to_string());
    }

    let dir = images_dir(&app).ok_or_else(|| "无法创建图片存储目录".to_string())?;
    let file_name = format!("screenshot-{}.png", hash_bytes(&png_bytes));
    let path = dir.join(&file_name);
    if !path.exists() {
        std::fs::write(&path, &png_bytes).map_err(|err| format!("图片保存失败：{err}"))?;
    }

    let path_string = path.to_string_lossy().to_string();
    let summary = ocr_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let summary = if summary.is_empty() {
        "截图".to_string()
    } else {
        summary.chars().take(120).collect()
    };
    let resource_input = SavedResourceInput {
        kind: "image".to_string(),
        name: file_name.clone(),
        path: Some(path_string.clone()),
        summary: Some(summary.clone()),
        extracted_text: None,
        remote_file_id: None,
        size_bytes: Some(png_bytes.len() as u64),
        mime_type: Some("image/png".to_string()),
        extension: Some("png".to_string()),
        width: None,
        height: None,
    };
    let resources = json!([{
        "kind": "image",
        "name": file_name,
        "summary": summary,
        "size": format_file_size(png_bytes.len() as u64),
        "value": path_string,
    }]);

    let mut sections = Vec::new();
    let trimmed_ocr = ocr_text.trim();
    if !trimmed_ocr.is_empty() {
        sections.push(trimmed_ocr.to_string());
    }
    sections.push(format!("[[desktop-shell:resources:v1]]\n{}", resources));
    Ok(crate::clipboard::append_manual_text_history_with_resources(
        &app,
        sections.join("\n\n"),
        &[resource_input],
    ))
}

#[tauri::command]
pub fn toggle_pin_clipboard_history_item(app: AppHandle, state: State<AppState>, id: u64) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let Ok(Some(updated)) =
        crate::db::database_mut(&app, |database| database.toggle_pin(id, now_ms))
    else {
        return;
    };

    if let Some(item) = state
        .clipboard_history
        .lock()
        .unwrap()
        .iter_mut()
        .find(|item| item.id == id)
    {
        *item = updated.clone();
    }

    let _ = app.emit_to("preview", "history-pin-toggled", updated);
}

#[tauri::command]
pub fn update_clipboard_history_item(
    app: AppHandle,
    state: State<AppState>,
    id: u64,
    value: String,
    preview: String,
) {
    let Ok(Some(updated)) =
        crate::db::database_mut(&app, |database| database.update_history_item(id, &value, &preview))
    else {
        return;
    };

    if let Some(item) = state
        .clipboard_history
        .lock()
        .unwrap()
        .iter_mut()
        .find(|item| item.id == id)
    {
        *item = updated.clone();
    }

    let _ = app.emit_to("preview", "history-updated", updated);
}

#[tauri::command]
pub fn update_history_upload_state(
    app: AppHandle,
    state: State<AppState>,
    id: u64,
    upload_state: String,
    remote_file_id: Option<String>,
    overview: Option<String>,
    extracted_text: Option<String>,
) {
    let Ok(Some(updated)) = crate::db::database_mut(&app, |database| {
        database.update_upload_state(
            id,
            upload_state.as_str(),
            remote_file_id.as_deref(),
            overview.as_deref(),
            extracted_text.as_deref(),
        )
    }) else {
        return;
    };

    if let Ok(history) = crate::db::database_mut(&app, |database| database.load_history()) {
        *state.clipboard_history.lock().unwrap() = history;
    }

    // 和 update_clipboard_history_item 对齐：发 history-updated 让 preview 端刷新 UI。
    let _ = app.emit_to("preview", "history-updated", updated);
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

#[tauri::command]
pub fn open_screenshot_selector(app: AppHandle) {
    if let Err(err) = windows::show_screenshot_selector(&app) {
        eprintln!("[screenshot] failed to show selector: {err}");
    }
}

#[tauri::command]
pub fn close_screenshot_selector(app: AppHandle) {
    if let Some(window) = app.get_webview_window("screenshot-selector") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn close_screenshot_result(app: AppHandle) {
    if let Some(window) = app.get_webview_window("screenshot-result") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn complete_screenshot_selection(app: AppHandle, rect: ScreenshotSelectionRect) {
    if let Some(window) = app.get_webview_window("screenshot-selector") {
        let _ = window.hide();
    }
    if rect.width < 2 || rect.height < 2 {
        return;
    }
    let image_data_url = capture_screenshot_data_url(&rect).unwrap_or_default();
    let window = match app.get_webview_window("screenshot-result") {
        Some(existing) => existing,
        None => match windows::build_screenshot_result_window(&app) {
            Ok(window) => window,
            Err(err) => {
                eprintln!("[screenshot] failed to build result window: {err}");
                return;
            }
        },
    };
    windows::position_screenshot_result(
        &app,
        ScreenRect {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        },
    );
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(
        "screenshot-result",
        "screenshot-result",
        ScreenshotResultPayload {
            ocr_text: String::new(),
            image_data_url,
        },
    );
}

#[tauri::command]
pub fn show_file_info(app: AppHandle, payload: FileInfoPayload) {
    show_file_info_payload(&app, payload);
}

#[tauri::command]
pub fn complete_file_explanation(app: AppHandle) {
    let _ = app.emit_to("main", "file-explanation-complete", ());
}

// 供 lib.rs 在“应用整体失焦”时调用：一把梭隐藏所有面板/预览窗口
pub fn hide_all_overlays(app: &AppHandle) {
    reset_input_panel(app);
    for label in ["panel-web", "preview", "screenshot-selector"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
}
