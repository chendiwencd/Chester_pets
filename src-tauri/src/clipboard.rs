use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::FileInfoPayload;
use crate::state::{images_dir, AppState, ClipboardSignatures, SavedResourceInput};

fn preview_text(kind: &'static str, value: &str) -> String {
    if kind == "image" {
        return "图片".to_string();
    }
    let single_line = value.replace('\n', " ");
    let mut chars = single_line.chars();
    let preview: String = chars.by_ref().take(28).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

pub(crate) fn append_history(app: &AppHandle, kind: &'static str, value: String) -> u64 {
    append_history_with_resources(app, kind, value, &[])
}

pub(crate) fn append_history_with_resources(
    app: &AppHandle,
    kind: &'static str,
    value: String,
    resources: &[SavedResourceInput],
) -> u64 {
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let resources = crate::state::prepare_resource_paths(app, resources);

    let result = crate::db::database_mut(app, |database| {
        database.insert_history(
            kind,
            &value,
            &preview_text(kind, &value),
            created_at_ms,
            Some("not_uploaded"),
            None,
            &resources,
        )
    });
    let Ok(((item, inserted), history)) = result.and_then(|result| {
        crate::db::database_mut(app, |database| database.load_history())
            .map(|history| (result, history))
    }) else {
        eprintln!("[db] failed to append history item");
        return 0;
    };

    let state = app.state::<AppState>();
    *state.clipboard_history.lock().unwrap() = history;
    if inserted {
        let _ = app.emit_to("preview", "history-appended", item.clone());
    }
    item.id
}

pub fn append_manual_text_history_with_resources(
    app: &AppHandle,
    value: String,
    resources: &[SavedResourceInput],
) -> u64 {
    append_history_with_resources(app, "note", value, resources)
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
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

fn image_resource(
    path: String,
    name: String,
    size_bytes: u64,
    width: u32,
    height: u32,
) -> SavedResourceInput {
    SavedResourceInput {
        kind: "image".to_string(),
        name,
        path: Some(path),
        summary: None,
        extracted_text: None,
        remote_file_id: None,
        size_bytes: Some(size_bytes),
        mime_type: Some("image/png".to_string()),
        extension: Some("png".to_string()),
        width: Some(width),
        height: Some(height),
    }
}

fn capture_image(
    app: &AppHandle,
    sig: &mut ClipboardSignatures,
    persist: bool,
) -> Option<FileInfoPayload> {
    let Ok(image) = app.clipboard().read_image() else {
        return None;
    };
    let width = image.width();
    let height = image.height();
    let rgba = image.rgba().to_vec();
    if width == 0 || height == 0 || rgba.is_empty() {
        return None;
    }
    let signature = format!("image:{width}x{height}:{}", hash_bytes(&rgba));

    let Some(buffer) = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba) else {
        return None;
    };

    let mut png_bytes = Vec::new();
    if DynamicImage::ImageRgba8(buffer)
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), ImageFormat::Png)
        .is_err()
    {
        return None;
    }

    let Some(directory) = images_dir(app) else {
        eprintln!("[clipboard] image directory unavailable");
        return None;
    };
    let storage_name = format!("clipboard-image-{}.png", hash_bytes(&png_bytes));
    let path = directory.join(&storage_name);
    if !path.exists() {
        if let Err(error) = std::fs::write(&path, &png_bytes) {
            eprintln!("[clipboard] failed to write image: {error}");
            return None;
        }
    }

    let path_string = path.to_string_lossy().to_string();
    let created_at_ms = now_ms();
    let display_name = format!("剪贴板-{created_at_ms}.png");
    let is_new = sig.image.as_ref() != Some(&signature);
    let persisted = if persist && is_new {
        let resource = image_resource(
            path_string.clone(),
            display_name.clone(),
            png_bytes.len() as u64,
            width,
            height,
        );
        append_history_with_resources(app, "image", path_string.clone(), &[resource]) != 0
    } else {
        true
    };
    if persisted {
        sig.image = Some(signature);
    }

    Some(FileInfoPayload {
        status: "ready".to_string(),
        kind: "image".to_string(),
        name: display_name,
        size_bytes: Some(png_bytes.len() as u64),
        mime_type: Some("image/png".to_string()),
        display_size: format_file_size(png_bytes.len() as u64),
        overview: String::new(),
        type_placeholder: String::new(),
        preview: path_string,
        file_id: None,
    })
}

fn capture_text(
    app: &AppHandle,
    sig: &mut ClipboardSignatures,
    persist: bool,
) -> Option<FileInfoPayload> {
    let Ok(text) = app.clipboard().read_text() else {
        return None;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let is_web = trimmed.starts_with("http://") || trimmed.starts_with("https://");
    let signature = if is_web {
        format!("web:{trimmed}")
    } else {
        format!("text:{trimmed}")
    };
    let already = if is_web { &sig.web } else { &sig.text };
    let is_new = already.as_ref() != Some(&signature);
    let persisted = if persist && is_new {
        append_history(app, "text", trimmed.to_string()) != 0
    } else {
        true
    };
    if persisted {
        if is_web {
            sig.web = Some(signature);
        } else {
            sig.text = Some(signature);
        }
    }

    let created_at_ms = now_ms();
    Some(FileInfoPayload {
        status: "ready".to_string(),
        kind: "text".to_string(),
        name: format!("剪贴板-{created_at_ms}.txt"),
        size_bytes: Some(trimmed.as_bytes().len() as u64),
        mime_type: Some("text/plain".to_string()),
        display_size: format_file_size(trimmed.as_bytes().len() as u64),
        overview: String::new(),
        type_placeholder: String::new(),
        preview: trimmed.to_string(),
        file_id: None,
    })
}

pub fn capture_latest_clipboard(
    app: &AppHandle,
    sig: &mut ClipboardSignatures,
    persist: bool,
) -> Option<FileInfoPayload> {
    capture_image(app, sig, persist).or_else(|| capture_text(app, sig, persist))
}

pub fn spawn_clipboard_monitor(app: AppHandle) {
    thread::spawn(move || {
        loop {
            let monitor_enabled = *app.state::<AppState>().monitor_mode.lock().unwrap();
            if monitor_enabled {
                let state = app.state::<AppState>();
                let mut signatures = state.clipboard_signatures.lock().unwrap();
                let _ = capture_latest_clipboard(&app, &mut signatures, true);
            }
            thread::sleep(Duration::from_millis(450));
        }
    });
}
