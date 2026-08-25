use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const DEFAULT_X: i32 = 800;
pub const DEFAULT_Y: i32 = 500;
pub const DEFAULT_STORAGE_SHORTCUT: &str = "CmdOrCtrl+Shift+V";
pub const DEFAULT_SCREENSHOT_SHORTCUT: &str = "Alt+D";

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
    pub monitor_mode: Mutex<bool>,
    pub shortcuts: Mutex<ShortcutSettings>,
    pub clipboard_signatures: Mutex<ClipboardSignatures>,
    pub clipboard_history: Mutex<Vec<ClipboardHistoryItem>>,
    pub clipboard_history_seq: Mutex<u64>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub monitor_mode: bool,
    // 开机自启，默认关。#[serde(default)] 保证旧版 settings.json（没有该字段）也能正常加载。
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            monitor_mode: false,
            autostart: false,
            shortcuts: ShortcutSettings::default(),
        }
    }
}

fn position_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("pet_position.json"))
}

fn history_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("clipboard_history.json"))
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

pub fn load_history(app: &AppHandle) -> Vec<ClipboardHistoryItem> {
    history_config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_history(app: &AppHandle, history: &[ClipboardHistoryItem]) -> std::io::Result<()> {
    let Some(path) = history_config_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(history)?)
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
