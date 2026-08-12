use std::thread;
use std::time::Duration;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::state::{images_dir, save_history, AppState, ClipboardHistoryItem, ClipboardSignatures};

#[derive(Clone, serde::Serialize)]
struct PanelContent {
    id: u64,
    kind: &'static str,
    value: String,
}

fn emit_panel_content(app: &AppHandle, target: &str, id: u64, kind: &'static str, value: String) {
    let _ = app.emit_to(
        target,
        "panel-content",
        PanelContent {
            id,
            kind,
            value,
        },
    );
}

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

fn append_history(app: &AppHandle, kind: &'static str, value: String) -> u64 {
    let state = app.state::<AppState>();
    {
        let history = state.clipboard_history.lock().unwrap();
        if let Some(existing) = history.iter().find(|item| item.kind == kind && item.value == value) {
            return existing.id;
        }
    }

    let mut seq = state.clipboard_history_seq.lock().unwrap();
    *seq += 1;
    let id = *seq;
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut history = state.clipboard_history.lock().unwrap();
    history.push(ClipboardHistoryItem {
        id,
        kind: kind.to_string(),
        preview: preview_text(kind, &value),
        value: value.clone(),
        created_at_ms,
        pinned: false,
        pinned_at_ms: None,
    });
    // 到达上限时删最旧的，但跳过置顶项——从最旧一端起找第一个“未置顶”的删除，
    // 直到回到上限内。如果剩下的全是置顶（没有可删的未置顶项），宁可暂时超过上限也不动置顶内容。
    const MAX_HISTORY: usize = 100;
    while history.len() > MAX_HISTORY {
        match history.iter().position(|item| !item.pinned) {
            Some(pos) => {
                history.remove(pos);
            }
            None => break,
        }
    }

    let snapshot = history.clone();
    let item = history.last().cloned();
    drop(history);
    let _ = save_history(app, &snapshot);
    if let Some(item) = item {
        let _ = app.emit_to("preview", "history-appended", item);
    }
    id
}

pub fn append_manual_text_history(app: &AppHandle, value: String) -> u64 {
    append_history(app, "text", value)
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn try_forward_image(app: &AppHandle, sig: &mut ClipboardSignatures) -> bool {
    let Ok(image) = app.clipboard().read_image() else {
        return false;
    };
    let width = image.width();
    let height = image.height();
    let rgba = image.rgba().to_vec();
    let signature = format!("image:{width}x{height}:{}", hash_bytes(&rgba));
    if sig.image.as_ref() == Some(&signature) {
        return true;
    }

    let Some(buffer) = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba)
    else {
        return false;
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    let encoded = DynamicImage::ImageRgba8(buffer)
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), ImageFormat::Png)
        .is_ok();
    if !encoded {
        return false;
    }

    // 图片以文件形式落盘到 app_data_dir/images/<内容hash>.png，历史里只存文件路径，
    // 避免把整段 base64 塞进 clipboard_history.json（图片一多 JSON 会膨胀且每次全量重写变慢）。
    // 用内容 hash 命名：完全相同的图片会得到同一路径，天然完成去重（append_history 按 value 去重）。
    let Some(dir) = images_dir(app) else {
        eprintln!("[clipboard] images_dir unavailable, skip image");
        return false;
    };
    let file_name = format!("{}.png", hash_bytes(&png_bytes));
    let path = dir.join(&file_name);
    if !path.exists() {
        if let Err(err) = std::fs::write(&path, &png_bytes) {
            eprintln!("[clipboard] failed to write image file {}: {err}", path.display());
            return false;
        }
    }
    let path_str = path.to_string_lossy().to_string();

    let id = append_history(app, "image", path_str.clone());
    emit_panel_content(app, "panel-img", id, "image", path_str);
    sig.image = Some(signature);
    true
}

fn try_forward_text(app: &AppHandle, sig: &mut ClipboardSignatures) {
    let Ok(text) = app.clipboard().read_text() else {
        return;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let signature = format!("web:{trimmed}");
        if sig.web.as_ref() == Some(&signature) {
            return;
        }
        let value = trimmed.to_string();
        let id = append_history(app, "text", value.clone());
        emit_panel_content(app, "panel-text", id, "text", value);
        sig.web = Some(signature);
    } else {
        let signature = format!("text:{trimmed}");
        if sig.text.as_ref() == Some(&signature) {
            return;
        }
        let value = trimmed.to_string();
        let id = append_history(app, "text", value.clone());
        emit_panel_content(app, "panel-text", id, "text", value);
        sig.text = Some(signature);
    }
}

// 面板打开期间由前端定时轮询，只同步“最新的一条”剪贴板内容，不抢系统 Ctrl+V。
pub fn forward_latest_clipboard(app: &AppHandle, sig: &mut ClipboardSignatures) {
    if try_forward_image(app, sig) {
        return;
    }
    try_forward_text(app, sig);
}

pub fn spawn_clipboard_monitor(app: AppHandle) {
    thread::spawn(move || {
        let mut signatures = ClipboardSignatures::default();
        loop {
            let monitor_enabled = *app.state::<AppState>().monitor_mode.lock().unwrap();
            if monitor_enabled {
                forward_latest_clipboard(&app, &mut signatures);
            }
            thread::sleep(Duration::from_millis(450));
        }
    });
}
