use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::Hasher;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::db::Database;

pub const DEFAULT_X: i32 = 800;
pub const DEFAULT_Y: i32 = 500;
pub const DEFAULT_STORAGE_SHORTCUT: &str = "CmdOrCtrl+Shift+V";
pub const DEFAULT_SCREENSHOT_SHORTCUT: &str = "Alt+D";
pub const DEFAULT_WORKSPACE_DIR: &str = "user/chesterbot/workspace";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
}

impl Default for PetPosition {
    fn default() -> Self {
        Self {
            x: DEFAULT_X,
            y: DEFAULT_Y,
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub panel_open: Mutex<bool>,
    pub file_drag_active: Mutex<bool>,
    pub monitor_mode: Mutex<bool>,
    pub close_on_blur: Mutex<bool>,
    pub shortcuts: Mutex<ShortcutSettings>,
    pub clipboard_signatures: Mutex<ClipboardSignatures>,
    pub clipboard_history: Mutex<Vec<ClipboardHistoryItem>>,
    pub database: Mutex<Option<Database>>,
    pub workspace_dir: Mutex<PathBuf>,
    pub focused_windows: Mutex<HashSet<String>>,
    pub focus_epoch: Mutex<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutSettings {
    #[serde(default = "default_storage_shortcut")]
    pub storage: String,
    #[serde(default = "default_screenshot_shortcut")]
    pub screenshot: String,
}

fn default_storage_shortcut() -> String {
    DEFAULT_STORAGE_SHORTCUT.to_string()
}

fn default_screenshot_shortcut() -> String {
    DEFAULT_SCREENSHOT_SHORTCUT.to_string()
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            storage: default_storage_shortcut(),
            screenshot: default_screenshot_shortcut(),
        }
    }
}

#[derive(Debug, Default)]
pub struct ClipboardSignatures {
    pub image: Option<String>,
    pub text: Option<String>,
    pub web: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardHistoryItem {
    pub id: u64,
    pub kind: String,
    pub value: String,
    pub preview: String,
    pub created_at_ms: u64,
    pub pinned: bool,
    pub pinned_at_ms: Option<u64>,
    #[serde(default)]
    pub resources: Vec<SavedResourceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedResourceInput {
    pub kind: String,
    pub name: String,
    pub path: Option<String>,
    pub summary: Option<String>,
    pub extracted_text: Option<String>,
    pub remote_file_id: Option<String>,
    pub size_bytes: Option<u64>,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub monitor_mode: bool,
    #[serde(default = "default_close_on_blur")]
    pub close_on_blur: bool,
    // 开机自启，默认关。#[serde(default)] 保证旧版 settings.json（没有该字段）也能正常加载。
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
    #[serde(default = "default_workspace_dir")]
    pub workspace_dir: String,
}

fn default_workspace_dir() -> String {
    DEFAULT_WORKSPACE_DIR.to_string()
}

fn default_close_on_blur() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            monitor_mode: false,
            close_on_blur: true,
            autostart: false,
            shortcuts: ShortcutSettings::default(),
            workspace_dir: default_workspace_dir(),
        }
    }
}

fn position_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("pet_position.json"))
}

fn settings_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

// 图片历史的落盘目录：app_data_dir/images/。首次访问时创建。
pub fn images_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("images");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn resolve_workspace_dir(app: &AppHandle, configured: &str) -> Result<PathBuf, String> {
    let configured = configured.trim();
    if configured.is_empty() {
        return Err("工作目录不能为空".to_string());
    }

    let configured_path = PathBuf::from(configured);
    let path = if configured_path.is_absolute() {
        configured_path
    } else {
        app.path()
            .home_dir()
            .map_err(|err| format!("无法获取用户目录：{err}"))?
            .join(configured_path)
    };

    std::fs::create_dir_all(&path)
        .map_err(|err| format!("无法创建工作目录 {}：{err}", path.to_string_lossy()))?;
    Ok(path)
}

pub fn current_workspace_dir(app: &AppHandle) -> Option<PathBuf> {
    let path = app
        .state::<AppState>()
        .workspace_dir
        .lock()
        .unwrap()
        .clone();
    (!path.as_os_str().is_empty()).then_some(path)
}

pub fn copy_file_to_workspace(app: &AppHandle, source: &Path) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err(format!("文件不存在或不是普通文件：{}", source.display()));
    }

    let workspace = current_workspace_dir(app).ok_or_else(|| "工作目录尚未初始化".to_string())?;
    std::fs::create_dir_all(&workspace).map_err(|err| format!("无法创建工作目录：{err}"))?;

    let file_name = source
        .file_name()
        .ok_or_else(|| format!("无法读取文件名：{}", source.display()))?;
    let mut destination = workspace.join(file_name);

    if let (Ok(source_absolute), Ok(destination_absolute)) =
        (source.canonicalize(), destination.canonicalize())
    {
        if source_absolute == destination_absolute {
            return Ok(destination);
        }
    }

    if destination.exists() {
        if files_have_same_content(source, &destination) {
            return Ok(destination);
        }
        let stem = destination
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("file");
        let extension = destination
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        let mut index = 1u32;
        loop {
            let candidate = workspace.join(format!("{stem} ({index}){extension}"));
            if !candidate.exists() {
                destination = candidate;
                break;
            }
            index += 1;
        }
    }

    std::fs::copy(source, &destination).map_err(|err| {
        format!(
            "无法复制文件到工作目录 {}：{err}",
            destination.to_string_lossy()
        )
    })?;
    Ok(destination)
}

fn files_have_same_content(left: &Path, right: &Path) -> bool {
    let (Ok(left_metadata), Ok(right_metadata)) =
        (std::fs::metadata(left), std::fs::metadata(right))
    else {
        return false;
    };
    if left_metadata.len() != right_metadata.len() {
        return false;
    }

    let hash_file = |path: &Path| -> std::io::Result<u64> {
        let mut file = std::fs::File::open(path)?;
        let mut hasher = DefaultHasher::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.write(&buffer[..read]);
        }
        Ok(hasher.finish())
    };

    hash_file(left).ok() == hash_file(right).ok()
}

pub fn prepare_resource_paths(
    app: &AppHandle,
    resources: &[SavedResourceInput],
) -> Vec<SavedResourceInput> {
    resources
        .iter()
        .cloned()
        .map(|mut resource| {
            if (resource.kind == "file" || resource.kind == "image")
                && resource.path.as_deref().is_some()
            {
                let source = Path::new(resource.path.as_deref().unwrap_or_default());
                if source.is_file() {
                    match copy_file_to_workspace(app, source) {
                        Ok(destination) => {
                            resource.path = Some(destination.to_string_lossy().to_string());
                        }
                        Err(err) => {
                            eprintln!("[workspace] {err}");
                        }
                    }
                }
            }
            resource
        })
        .collect()
}

pub fn load_position(app: &AppHandle) -> PetPosition {
    position_config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_position(app: &AppHandle, position: PetPosition) -> std::io::Result<()> {
    let Some(path) = position_config_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&position)?)
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    settings_config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> std::io::Result<()> {
    let Some(path) = settings_config_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(settings)?)
}
