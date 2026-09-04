import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopActionRead,
  DesktopActionRisk,
  DesktopClientContext,
  DesktopCapabilitiesPayload,
  DesktopToolCapability as ApiDesktopToolCapability,
} from "./api/types";

export type { DesktopActionRisk, DesktopCapabilitiesPayload };

export interface DesktopToolCapability extends ApiDesktopToolCapability {
  label_name: string;
  label_description: string;
}

export interface ActionResult {
  ok: boolean;
  action: string;
  target: string;
  message: string;
}

export interface WindowInfo {
  id: number;
  title: string;
  class_name: string;
  process_id: number;
  is_active: boolean;
  is_minimized: boolean;
}

export interface DisplayInfo {
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  is_primary: boolean;
}

export interface OsInfo {
  os: string;
  family: string;
  arch: string;
}

export interface NetworkStatus {
  likely_online: boolean;
  local_address?: string;
  note: string;
}

export type LaunchableApp =
  | "calculator"
  | "notepad"
  | "explorer"
  | "paint"
  | "snipping_tool"
  | "terminal"
  | "settings"
  | "task_manager";

export type SettingsPage =
  | "home"
  | "display"
  | "sound"
  | "bluetooth"
  | "wifi"
  | "network"
  | "apps"
  | "privacy"
  | "windows_update"
  | "storage"
  | "power_sleep"
  | "date_time"
  | "language"
  | "default_apps";

export type SearchEngine = "bing" | "google" | "duckduckgo";
export interface CalendarEventInput {
  title: string;
  start: string;
  end: string;
  timezone: string;
  location?: string;
  notes?: string;
}

export interface DesktopActionExecutionOutcome {
  status: "success" | "error";
  data?: Record<string, unknown>;
  error_message?: string;
}

const LAUNCHABLE_APPS = new Set<LaunchableApp>([
  "calculator",
  "notepad",
  "explorer",
  "paint",
  "snipping_tool",
  "terminal",
  "settings",
  "task_manager",
]);

const SETTINGS_PAGES = new Set<SettingsPage>([
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
  "default_apps",
]);

const SEARCH_ENGINES = new Set<SearchEngine>(["bing", "google", "duckduckgo"]);

export const DESKTOP_TOOL_CAPABILITIES: DesktopToolCapability[] = [
  {
    name: "windows.open_app",
    description: "Open an allowlisted Windows app.",
    label_name: "打开应用",
    label_description: "打开白名单中的 Windows 应用。",
    input_schema: {
      type: "object",
      properties: {
        app_id: {
          type: "string",
          enum: ["calculator", "notepad", "explorer", "paint", "snipping_tool", "settings"],
        },
      },
      required: ["app_id"],
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "windows.open_settings",
    description: "Open an approved Windows Settings page.",
    label_name: "打开设置页",
    label_description: "打开受支持的 Windows 设置页面。",
    input_schema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          enum: [
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
            "default_apps",
          ],
        },
      },
      required: ["page"],
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "browser.open_url",
    description: "Open an http or https URL in the default browser.",
    label_name: "打开网址",
    label_description: "在默认浏览器中打开 http 或 https 链接。",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          minLength: 1,
          maxLength: 2048,
          pattern: "^https?://",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "browser.search_web",
    description: "Search the web with an approved search engine.",
    label_name: "搜索网页",
    label_description: "使用允许的搜索引擎执行网页搜索。",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 300,
        },
        engine: {
          type: "string",
          enum: ["bing", "google", "duckduckgo"],
          default: "bing",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "windows.list_windows",
    description: "List visible top-level desktop windows.",
    label_name: "列出窗口",
    label_description: "读取当前可见的顶层桌面窗口。",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "windows.focus_window",
    description: "Bring a visible top-level window to the foreground.",
    label_name: "聚焦窗口",
    label_description: "将指定的可见窗口置于前台。",
    input_schema: {
      type: "object",
      properties: {
        window_id: {
          type: "integer",
          minimum: 1,
        },
        title_contains: {
          type: "string",
          minLength: 1,
          maxLength: 200,
        },
      },
      additionalProperties: false,
      anyOf: [{ required: ["window_id"] }, { required: ["title_contains"] }],
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "clipboard.set_text",
    description: "Write text to the clipboard.",
    label_name: "写入剪贴板",
    label_description: "将文本写入系统剪贴板。",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          maxLength: 20000,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    risk_level: "medium",
    requires_confirmation: true,
  },
  {
    name: "windows.calendar.open_ics",
    description: "Create a calendar event on this Windows client.",
    label_name: "新建日历事件",
    label_description: "生成 .ics 文件并用默认日历应用打开。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        timezone: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "end", "timezone"],
      additionalProperties: false,
    },
    risk_level: "medium",
    requires_confirmation: true,
  },
  {
    name: "system.get_os_info",
    description: "Read basic OS and CPU architecture information.",
    label_name: "读取系统信息",
    label_description: "读取当前操作系统和架构信息。",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "system.get_active_window",
    description: "Read the current foreground window.",
    label_name: "读取活动窗口",
    label_description: "读取当前前台窗口信息。",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "system.get_display_info",
    description: "Read monitor bounds and scale factors.",
    label_name: "读取显示信息",
    label_description: "读取显示器边界和缩放信息。",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
  {
    name: "system.get_network_status",
    description: "Read a best-effort local network status.",
    label_name: "读取网络状态",
    label_description: "读取本机的网络连通性状态。",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk_level: "low",
    requires_confirmation: false,
  },
];

export function createDesktopCapabilitiesPayload(): DesktopCapabilitiesPayload {
  return {
    capabilities: DESKTOP_TOOL_CAPABILITIES.map(({ label_name, label_description, ...capability }) => capability),
  };
}

export function createDesktopClientContext(platform: string = "windows"): DesktopClientContext {
  return {
    platform,
    ...createDesktopCapabilitiesPayload(),
  };
}

export async function loadDesktopCapabilitiesPayload(): Promise<DesktopCapabilitiesPayload> {
  return {
    capabilities: await listClientActionTools(),
  };
}

export function listClientActionTools(): Promise<ApiDesktopToolCapability[]> {
  return invoke("client_actions_list_tools");
}

export function launchApp(app: LaunchableApp): Promise<ActionResult> {
  return invoke("client_action_launch_app", { app });
}

export function openSettings(page: SettingsPage): Promise<ActionResult> {
  return invoke("client_action_open_settings", { page });
}

export function openUrl(url: string): Promise<ActionResult> {
  return invoke("client_action_open_url", { url });
}

export function searchWeb(
  query: string,
  engine: SearchEngine = "bing",
): Promise<ActionResult> {
  return invoke("client_action_search_web", { query, engine });
}

export function listWindows(): Promise<WindowInfo[]> {
  return invoke("client_action_list_windows");
}

export function focusWindow(input: {
  windowId?: number;
  titleContains?: string;
}): Promise<ActionResult> {
  return invoke("client_action_focus_window", {
    windowId: input.windowId,
    titleContains: input.titleContains,
  });
}

export function setClipboardText(text: string): Promise<ActionResult> {
  return invoke("client_action_set_clipboard_text", { text });
}

export function openCalendarIcs(event: CalendarEventInput): Promise<ActionResult> {
  return invoke("client_action_open_calendar_ics", { input: event });
}

export function getOsInfo(): Promise<OsInfo> {
  return invoke("client_action_get_os_info");
}

export function getActiveWindow(): Promise<WindowInfo | null> {
  return invoke("client_action_get_active_window");
}

export function getDisplayInfo(): Promise<DisplayInfo[]> {
  return invoke("client_action_get_display_info");
}

export function getNetworkStatus(): Promise<NetworkStatus> {
  return invoke("client_action_get_network_status");
}

function normalizeActionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function readStringArgument(
  arguments_: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  const raw = arguments_[key];
  if (typeof raw !== "string") {
    throw new Error(`Missing string argument '${key}'.`);
  }
  const value = options.trim === false ? raw : raw.trim();
  if (!options.allowEmpty && !value) {
    throw new Error(`Argument '${key}' cannot be empty.`);
  }
  return value;
}

function readOptionalStringArgument(
  arguments_: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = arguments_[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`Argument '${key}' must be a string.`);
  }
  const value = raw.trim();
  return value || undefined;
}

function readOptionalIntegerArgument(
  arguments_: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = arguments_[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Argument '${key}' must be an integer.`);
  }
  return value;
}

function isLaunchableApp(value: string): value is LaunchableApp {
  return LAUNCHABLE_APPS.has(value as LaunchableApp);
}

function isSettingsPage(value: string): value is SettingsPage {
  return SETTINGS_PAGES.has(value as SettingsPage);
}

function isSearchEngine(value: string): value is SearchEngine {
  return SEARCH_ENGINES.has(value as SearchEngine);
}

function asResultData(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

export async function executeDesktopAction(
  action: DesktopActionRead,
): Promise<DesktopActionExecutionOutcome> {
  try {
    switch (action.tool_name) {
      case "windows.open_app": {
        const appId = normalizeActionKey(readStringArgument(action.arguments, "app_id"));
        if (!isLaunchableApp(appId)) {
          throw new Error(`Unsupported app '${appId}'.`);
        }
        return { status: "success", data: asResultData(await launchApp(appId)) };
      }
      case "windows.open_settings": {
        const page = normalizeActionKey(readStringArgument(action.arguments, "page"));
        if (!isSettingsPage(page)) {
          throw new Error(`Unsupported settings page '${page}'.`);
        }
        return { status: "success", data: asResultData(await openSettings(page)) };
      }
      case "browser.open_url": {
        const url = readStringArgument(action.arguments, "url");
        return { status: "success", data: asResultData(await openUrl(url)) };
      }
      case "browser.search_web": {
        const query = readStringArgument(action.arguments, "query");
        const engineRaw = readOptionalStringArgument(action.arguments, "engine");
        const engine = engineRaw ? normalizeActionKey(engineRaw) : "bing";
        if (!isSearchEngine(engine)) {
          throw new Error(`Unsupported search engine '${engine}'.`);
        }
        return { status: "success", data: asResultData(await searchWeb(query, engine)) };
      }
      case "windows.list_windows": {
        return { status: "success", data: { windows: await listWindows() } };
      }
      case "windows.focus_window": {
        const windowId = readOptionalIntegerArgument(action.arguments, "window_id");
        const titleContains = readOptionalStringArgument(action.arguments, "title_contains");
        if (windowId === undefined && !titleContains) {
          throw new Error("Provide either window_id or title_contains.");
        }
        return {
          status: "success",
          data: asResultData(await focusWindow({ windowId, titleContains })),
        };
      }
      case "clipboard.set_text": {
        const text = readStringArgument(action.arguments, "text", { allowEmpty: true, trim: false });
        return { status: "success", data: asResultData(await setClipboardText(text)) };
      }
      case "windows.calendar.open_ics": {
        const title = readStringArgument(action.arguments, "title");
        const start = readStringArgument(action.arguments, "start");
        const end = readStringArgument(action.arguments, "end");
        const timezone = readStringArgument(action.arguments, "timezone");
        const location = readOptionalStringArgument(action.arguments, "location");
        const notes = readOptionalStringArgument(action.arguments, "notes");
        return {
          status: "success",
          data: asResultData(
            await openCalendarIcs({
              title,
              start,
              end,
              timezone,
              location,
              notes,
            }),
          ),
        };
      }
      case "system.get_os_info": {
        return { status: "success", data: { os_info: await getOsInfo() } };
      }
      case "system.get_active_window": {
        return { status: "success", data: { active_window: await getActiveWindow() } };
      }
      case "system.get_display_info": {
        return { status: "success", data: { display_info: await getDisplayInfo() } };
      }
      case "system.get_network_status": {
        return { status: "success", data: { network_status: await getNetworkStatus() } };
      }
      default:
        throw new Error(`Unsupported desktop tool '${action.tool_name}'.`);
    }
  } catch (error) {
    return {
      status: "error",
      error_message: error instanceof Error ? error.message : String(error),
    };
  }
}
