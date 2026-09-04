use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Clone, Serialize)]
pub struct ActionResult {
    ok: bool,
    action: String,
    target: String,
    message: String,
}

#[derive(Clone, Serialize)]
pub struct DesktopToolCapability {
    name: &'static str,
    description: &'static str,
    input_schema: Value,
    risk_level: &'static str,
    requires_confirmation: bool,
}

#[derive(Clone, Serialize)]
pub struct WindowInfo {
    id: u64,
    title: String,
    class_name: String,
    process_id: u32,
    is_active: bool,
    is_minimized: bool,
}

#[derive(Clone, Serialize)]
pub struct DisplayInfo {
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    is_primary: bool,
}

#[derive(Clone, Serialize)]
pub struct OsInfo {
    os: &'static str,
    family: &'static str,
    arch: &'static str,
}

#[derive(Clone, Serialize)]
pub struct NetworkStatus {
    likely_online: bool,
    local_address: Option<String>,
    note: String,
}

#[derive(Clone, Deserialize)]
pub struct CalendarEventInput {
    title: String,
    start: String,
    end: String,
    timezone: String,
    location: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
pub fn client_actions_list_tools() -> Vec<DesktopToolCapability> {
    desktop_tool_capabilities()
}

fn desktop_tool_capabilities() -> Vec<DesktopToolCapability> {
    vec![
        DesktopToolCapability {
            name: "windows.open_app",
            description: "Open an allowlisted Windows app.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app_id": {
                        "type": "string",
                        "enum": ["calculator", "notepad", "explorer", "paint", "snipping_tool", "settings"]
                    }
                },
                "required": ["app_id"],
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "windows.open_settings",
            description: "Open an approved Windows Settings page.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "page": {
                        "type": "string",
                        "enum": [
                            "home",
                            "display",
                            "sound",
                            "bluetooth",
                            "wifi",
                            "network",
                            "apps",
                            "privacy",
                            "windows_update",
                            "storage",
                            "power_sleep",
                            "date_time",
                            "language",
                            "default_apps"
                        ]
                    }
                },
                "required": ["page"],
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "browser.open_url",
            description: "Open an http or https URL in the default browser.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2048,
                        "pattern": "^https?://"
                    }
                },
                "required": ["url"],
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "browser.search_web",
            description: "Search the web with an approved search engine.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 300
                    },
                    "engine": {
                        "type": "string",
                        "enum": ["bing", "google", "duckduckgo"],
                        "default": "bing"
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "windows.list_windows",
            description: "List visible top-level desktop windows.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "windows.focus_window",
            description: "Bring a visible top-level window to the foreground.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "window_id": {
                        "type": "integer",
                        "minimum": 1
                    },
                    "title_contains": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200
                    }
                },
                "additionalProperties": false,
                "anyOf": [
                    { "required": ["window_id"] },
                    { "required": ["title_contains"] }
                ]
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "clipboard.set_text",
            description: "Write text to the clipboard.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "maxLength": 20000
                    }
                },
                "required": ["text"],
                "additionalProperties": false
            }),
            risk_level: "medium",
            requires_confirmation: true,
        },
        DesktopToolCapability {
            name: "windows.calendar.open_ics",
            description: "Create a calendar event on this Windows client.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "start": { "type": "string" },
                    "end": { "type": "string" },
                    "timezone": { "type": "string" },
                    "location": { "type": "string" },
                    "notes": { "type": "string" }
                },
                "required": ["title", "start", "end", "timezone"],
                "additionalProperties": false
            }),
            risk_level: "medium",
            requires_confirmation: true,
        },
        DesktopToolCapability {
            name: "system.get_os_info",
            description: "Read basic OS and CPU architecture information.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "system.get_active_window",
            description: "Read the current foreground window.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "system.get_display_info",
            description: "Read monitor bounds and scale factors.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
        DesktopToolCapability {
            name: "system.get_network_status",
            description: "Read a best-effort local network status.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            risk_level: "low",
            requires_confirmation: false,
        },
    ]
}

#[tauri::command]
pub fn client_action_launch_app(app: String) -> Result<ActionResult, String> {
    let app = normalize_key(&app);
    let target = match app.as_str() {
        "calculator" => LaunchTarget::Executable {
            command: "calc.exe",
            args: &[],
        },
        "notepad" => LaunchTarget::Executable {
            command: "notepad.exe",
            args: &[],
        },
        "explorer" => LaunchTarget::Executable {
            command: "explorer.exe",
            args: &[],
        },
        "paint" => LaunchTarget::Executable {
            command: "mspaint.exe",
            args: &[],
        },
        "snipping_tool" => LaunchTarget::Executable {
            command: "snippingtool.exe",
            args: &[],
        },
        "terminal" => LaunchTarget::Executable {
            command: "wt.exe",
            args: &[],
        },
        "settings" => LaunchTarget::Uri("ms-settings:"),
        "task_manager" => LaunchTarget::Executable {
            command: "taskmgr.exe",
            args: &[],
        },
        _ => {
            return Err(format!(
                "Unsupported app '{app}'. Allowed: calculator, notepad, explorer, paint, snipping_tool, terminal, settings, task_manager"
            ))
        }
    };
    launch_target(target)?;
    Ok(action_result(
        "windows.open_app",
        &app,
        "Application launch requested.",
    ))
}

#[tauri::command]
pub fn client_action_open_settings(page: String) -> Result<ActionResult, String> {
    let page = normalize_key(&page);
    let uri = match page.as_str() {
        "home" => "ms-settings:",
        "display" => "ms-settings:display",
        "sound" => "ms-settings:sound",
        "bluetooth" => "ms-settings:bluetooth",
        "wifi" => "ms-settings:network-wifi",
        "network" => "ms-settings:network",
        "apps" => "ms-settings:appsfeatures",
        "privacy" => "ms-settings:privacy",
        "windows_update" => "ms-settings:windowsupdate",
        "storage" => "ms-settings:storagesense",
        "power_sleep" => "ms-settings:powersleep",
        "date_time" => "ms-settings:dateandtime",
        "language" => "ms-settings:regionlanguage",
        "default_apps" => "ms-settings:defaultapps",
        _ => {
            return Err(format!(
                "Unsupported settings page '{page}'. Allowed: home, display, sound, bluetooth, wifi, network, apps, privacy, windows_update, storage, power_sleep, date_time, language, default_apps"
            ))
        }
    };
    launch_uri(uri)?;
    Ok(action_result(
        "windows.open_settings",
        &page,
        "Settings page open requested.",
    ))
}

#[tauri::command]
pub fn client_action_open_url(url: String) -> Result<ActionResult, String> {
    let url = validate_http_url(&url)?;
    launch_uri(&url)?;
    Ok(action_result(
        "browser.open_url",
        &url,
        "URL open requested.",
    ))
}

#[tauri::command]
pub fn client_action_search_web(
    query: String,
    engine: Option<String>,
) -> Result<ActionResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Search query cannot be empty.".to_string());
    }
    if query.chars().count() > 300 {
        return Err("Search query is too long; limit is 300 characters.".to_string());
    }
    if query.chars().any(|ch| ch.is_control()) {
        return Err("Search query cannot contain control characters.".to_string());
    }

    let engine = normalize_key(engine.as_deref().unwrap_or("bing"));
    let encoded = percent_encode(query);
    let url = match engine.as_str() {
        "bing" => format!("https://www.bing.com/search?q={encoded}"),
        "google" => format!("https://www.google.com/search?q={encoded}"),
        "duckduckgo" | "ddg" => format!("https://duckduckgo.com/?q={encoded}"),
        _ => {
            return Err("Unsupported search engine. Allowed: bing, google, duckduckgo.".to_string())
        }
    };
    launch_uri(&url)?;
    Ok(action_result(
        "browser.search_web",
        &engine,
        "Web search open requested.",
    ))
}

#[tauri::command]
pub fn client_action_list_windows() -> Result<Vec<WindowInfo>, String> {
    platform::list_windows()
}

#[tauri::command]
pub fn client_action_focus_window(
    window_id: Option<u64>,
    title_contains: Option<String>,
) -> Result<ActionResult, String> {
    let target = platform::focus_window(window_id, title_contains)?;
    Ok(action_result(
        "windows.focus_window",
        &target,
        "Window focus requested.",
    ))
}

#[tauri::command]
pub fn client_action_set_clipboard_text(
    app: AppHandle,
    text: String,
) -> Result<ActionResult, String> {
    if text.chars().count() > 20_000 {
        return Err("Clipboard text is too long; limit is 20000 characters.".to_string());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|err| format!("Failed to write clipboard text: {err}"))?;
    Ok(action_result(
        "clipboard.set_text",
        "text",
        "Clipboard text written.",
    ))
}

#[tauri::command]
pub fn client_action_open_calendar_ics(
    app: AppHandle,
    input: CalendarEventInput,
) -> Result<ActionResult, String> {
    let title = validate_single_line_text(&input.title, "title", 200)?;
    let timezone = validate_timezone(&input.timezone)?;
    let start = parse_calendar_value(&input.start, &timezone)?;
    let end = parse_calendar_value(&input.end, &timezone)?;
    let location = input
        .location
        .as_deref()
        .map(|value| validate_single_line_text(value, "location", 500))
        .transpose()?;
    let notes = input
        .notes
        .as_deref()
        .map(|value| validate_multiline_text(value, "notes", 4000))
        .transpose()?;

    let ics = build_calendar_ics(&title, &start, &end, location.as_deref(), notes.as_deref())?;
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|err| format!("Failed to resolve temp directory: {err}"))?
        .join("calendar-events");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("Failed to create calendar temp directory: {err}"))?;

    let safe_title = sanitize_file_component(&title);
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let file_name = if safe_title.is_empty() {
        format!("calendar-{stamp}.ics")
    } else {
        format!("calendar-{stamp}-{safe_title}.ics")
    };
    let path = temp_dir.join(file_name);
    std::fs::write(&path, ics).map_err(|err| format!("Failed to write ICS file: {err}"))?;
    platform::open_file_path(&path)?;

    Ok(action_result(
        "windows.calendar.open_ics",
        &path.to_string_lossy(),
        "Calendar event file created and opened.",
    ))
}

#[tauri::command]
pub fn client_action_get_os_info() -> OsInfo {
    OsInfo {
        os: std::env::consts::OS,
        family: std::env::consts::FAMILY,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
pub fn client_action_get_active_window() -> Result<Option<WindowInfo>, String> {
    platform::active_window()
}

#[tauri::command]
pub fn client_action_get_display_info(app: AppHandle) -> Vec<DisplayInfo> {
    let primary_name = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let name = monitor.name().cloned();
            let is_primary = name.is_some() && name == primary_name;
            DisplayInfo {
                name,
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
                is_primary,
            }
        })
        .collect()
}

#[tauri::command]
pub fn client_action_get_network_status() -> NetworkStatus {
    match std::net::UdpSocket::bind("0.0.0.0:0").and_then(|socket| {
        socket.connect("8.8.8.8:80")?;
        socket.local_addr()
    }) {
        Ok(address) => NetworkStatus {
            likely_online: !address.ip().is_loopback(),
            local_address: Some(address.ip().to_string()),
            note: "Best-effort local route check; it does not contact the remote host.".to_string(),
        },
        Err(err) => NetworkStatus {
            likely_online: false,
            local_address: None,
            note: format!("No default IPv4 route detected: {err}"),
        },
    }
}

enum LaunchTarget {
    Executable {
        command: &'static str,
        args: &'static [&'static str],
    },
    Uri(&'static str),
}

fn launch_target(target: LaunchTarget) -> Result<(), String> {
    match target {
        LaunchTarget::Executable { command, args } => std::process::Command::new(command)
            .args(args)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to launch {command}: {err}")),
        LaunchTarget::Uri(uri) => launch_uri(uri),
    }
}

fn launch_uri(uri: &str) -> Result<(), String> {
    platform::open_uri(uri)
}

fn action_result(action: &str, target: &str, message: &str) -> ActionResult {
    ActionResult {
        ok: true,
        action: action.to_string(),
        target: target.to_string(),
        message: message.to_string(),
    }
}

fn validate_single_line_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let text = value.trim();
    if text.is_empty() {
        return Err(format!("{field} cannot be empty."));
    }
    if text.chars().count() > max_chars {
        return Err(format!("{field} is too long; limit is {max_chars} characters."));
    }
    if text.chars().any(|ch| ch.is_control()) {
        return Err(format!("{field} cannot contain control characters."));
    }
    Ok(text.to_string())
}

fn validate_multiline_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let text = value.trim();
    if text.is_empty() {
        return Err(format!("{field} cannot be empty."));
    }
    if text.chars().count() > max_chars {
        return Err(format!("{field} is too long; limit is {max_chars} characters."));
    }
    if text
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t')
    {
        return Err(format!("{field} cannot contain control characters."));
    }
    Ok(text.to_string())
}

fn validate_timezone(value: &str) -> Result<String, String> {
    let timezone = value.trim();
    if timezone.is_empty() {
        return Err("timezone cannot be empty.".to_string());
    }
    if timezone.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("timezone cannot contain whitespace or control characters.".to_string());
    }
    Ok(timezone.to_string())
}

fn sanitize_file_component(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            ch
        } else if ch.is_whitespace() {
            '_'
        } else {
            '_'
        };
        output.push(next);
        if output.len() >= 48 {
            break;
        }
    }
    output.trim_matches('_').to_string()
}

fn escape_ics_text(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            ';' => escaped.push_str("\\;"),
            ',' => escaped.push_str("\\,"),
            '\r' | '\n' => escaped.push_str("\\n"),
            ch if ch.is_control() => escaped.push(' '),
            ch => escaped.push(ch),
        }
    }
    escaped
}

enum CalendarValue {
    Date(String),
    DateTimeUtc(String),
    DateTimeLocal { value: String, tzid: String },
}

fn parse_calendar_value(value: &str, timezone: &str) -> Result<CalendarValue, String> {
    let input = value.trim();
    if input.is_empty() {
        return Err("Calendar datetime cannot be empty.".to_string());
    }

    if let Ok(date) = NaiveDate::parse_from_str(input, "%Y-%m-%d") {
        return Ok(CalendarValue::Date(date.format("%Y%m%d").to_string()));
    }

    for format in [
        "%Y-%m-%dT%H:%M:%S%:z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S%:z",
        "%Y-%m-%d %H:%M:%S%z",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(input, format) {
            return Ok(CalendarValue::DateTimeUtc(
                dt.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ").to_string(),
            ));
        }
    }

    for format in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(input, format) {
            return Ok(CalendarValue::DateTimeLocal {
                value: dt.format("%Y%m%dT%H%M%S").to_string(),
                tzid: timezone.to_string(),
            });
        }
    }

    Err(format!(
        "Unsupported datetime format '{input}'. Use YYYY-MM-DD, RFC3339, or YYYY-MM-DD HH:MM[:SS]."
    ))
}

fn format_calendar_value(name: &str, value: &CalendarValue) -> String {
    match value {
        CalendarValue::Date(date) => format!("{name};VALUE=DATE:{date}"),
        CalendarValue::DateTimeUtc(dt) => format!("{name}:{dt}"),
        CalendarValue::DateTimeLocal { value, tzid } => {
            format!("{name};TZID={tzid}:{value}")
        }
    }
}

fn build_calendar_ics(
    title: &str,
    start: &CalendarValue,
    end: &CalendarValue,
    location: Option<&str>,
    notes: Option<&str>,
) -> Result<String, String> {
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let uid_seed = sanitize_file_component(title);
    let uid = if uid_seed.is_empty() {
        format!("{}@desktop-shell", Utc::now().timestamp_micros())
    } else {
        format!("{}-{}@desktop-shell", Utc::now().timestamp_micros(), uid_seed)
    };

    let mut ics = String::new();
    ics.push_str("BEGIN:VCALENDAR\r\n");
    ics.push_str("VERSION:2.0\r\n");
    ics.push_str("PRODID:-//desktop-shell//EN\r\n");
    ics.push_str("CALSCALE:GREGORIAN\r\n");
    ics.push_str("METHOD:PUBLISH\r\n");
    ics.push_str("BEGIN:VEVENT\r\n");
    ics.push_str(&format!("UID:{}\r\n", escape_ics_text(&uid)));
    ics.push_str(&format!("DTSTAMP:{stamp}\r\n"));
    ics.push_str(&format!("SUMMARY:{}\r\n", escape_ics_text(title)));
    ics.push_str(&format!("{}\r\n", format_calendar_value("DTSTART", start)));
    ics.push_str(&format!("{}\r\n", format_calendar_value("DTEND", end)));
    if let Some(location) = location {
        ics.push_str(&format!("LOCATION:{}\r\n", escape_ics_text(location)));
    }
    if let Some(notes) = notes {
        ics.push_str(&format!("DESCRIPTION:{}\r\n", escape_ics_text(notes)));
    }
    ics.push_str("STATUS:CONFIRMED\r\n");
    ics.push_str("TRANSP:OPAQUE\r\n");
    ics.push_str("END:VEVENT\r\n");
    ics.push_str("END:VCALENDAR\r\n");
    Ok(ics)
}

fn normalize_key(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn validate_http_url(value: &str) -> Result<String, String> {
    let url = value.trim();
    if url.is_empty() {
        return Err("URL cannot be empty.".to_string());
    }
    if url.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("URL cannot contain whitespace or control characters.".to_string());
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are allowed.".to_string());
    }
    Ok(url.to_string())
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(windows)]
mod platform {
    use super::WindowInfo;
    use std::path::Path;
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE, SW_SHOWNORMAL,
    };

    pub fn open_uri(uri: &str) -> Result<(), String> {
        let wide = to_wide(uri);
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                windows::core::PCWSTR(wide.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;
        if code <= 32 {
            Err(format!("ShellExecuteW failed with code {code}."))
        } else {
            Ok(())
        }
    }

    pub fn open_file_path(path: &Path) -> Result<(), String> {
        let wide = to_wide(&path.to_string_lossy());
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                windows::core::PCWSTR(wide.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;
        if code <= 32 {
            Err(format!("ShellExecuteW failed with code {code}."))
        } else {
            Ok(())
        }
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        let mut windows = Vec::new();
        unsafe {
            EnumWindows(
                Some(enum_windows_proc),
                LPARAM((&mut windows as *mut Vec<WindowInfo>) as isize),
            )
            .map_err(|err| format!("EnumWindows failed: {err}"))?;
        }
        Ok(windows)
    }

    pub fn active_window() -> Result<Option<WindowInfo>, String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return Ok(None);
        }
        Ok(window_info(hwnd))
    }

    pub fn focus_window(
        window_id: Option<u64>,
        title_contains: Option<String>,
    ) -> Result<String, String> {
        let windows = list_windows()?;
        let target = if let Some(id) = window_id {
            windows.into_iter().find(|window| window.id == id)
        } else {
            let Some(title_contains) = title_contains else {
                return Err("Provide either window_id or title_contains.".to_string());
            };
            let query = title_contains.trim().to_ascii_lowercase();
            if query.is_empty() {
                return Err("title_contains cannot be empty.".to_string());
            }
            windows
                .into_iter()
                .find(|window| window.title.to_ascii_lowercase().contains(&query))
        };
        let Some(target) = target else {
            return Err("No matching visible window found.".to_string());
        };

        let hwnd = HWND(target.id as *mut core::ffi::c_void);
        unsafe {
            if target.is_minimized {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err(
                    "SetForegroundWindow was rejected by Windows foreground rules.".to_string(),
                );
            }
        }
        Ok(target.title)
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if let Some(info) = window_info(hwnd) {
            let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
            windows.push(info);
        }
        BOOL(1)
    }

    fn window_info(hwnd: HWND) -> Option<WindowInfo> {
        if unsafe { !IsWindowVisible(hwnd).as_bool() } {
            return None;
        }
        let title = read_window_text(hwnd);
        if title.trim().is_empty() {
            return None;
        }
        let class_name = read_class_name(hwnd);
        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        }
        let active = unsafe { GetForegroundWindow() } == hwnd;
        let minimized = unsafe { IsIconic(hwnd).as_bool() };
        Some(WindowInfo {
            id: hwnd.0 as u64,
            title,
            class_name,
            process_id,
            is_active: active,
            is_minimized: minimized,
        })
    }

    fn read_window_text(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
    }

    fn read_class_name(hwnd: HWND) -> String {
        let mut buffer = vec![0u16; 256];
        let copied = unsafe { GetClassNameW(hwnd, &mut buffer) };
        String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
    }

    fn to_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(windows))]
mod platform {
    use super::WindowInfo;
    use std::path::Path;

    pub fn open_uri(uri: &str) -> Result<(), String> {
        std::process::Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open URI: {err}"))
    }

    pub fn open_file_path(path: &Path) -> Result<(), String> {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open file: {err}"))
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        Err("Window listing is only implemented on Windows.".to_string())
    }

    pub fn active_window() -> Result<Option<WindowInfo>, String> {
        Err("Active window lookup is only implemented on Windows.".to_string())
    }

    pub fn focus_window(
        _window_id: Option<u64>,
        _title_contains: Option<String>,
    ) -> Result<String, String> {
        Err("Window focus is only implemented on Windows.".to_string())
    }
}
