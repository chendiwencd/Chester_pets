import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { apiClient } from "./api/authClient";
import type {
  DesktopActionRead,
  DesktopAgentDocumentEvent,
  DesktopAgentInvokeResponse,
  DesktopDocumentRead,
} from "./api/types";
import { authStore } from "./authStore";
import {
  DESKTOP_TOOL_CAPABILITIES,
  createDesktopClientContext,
  executeDesktopAction,
} from "./clientActions";
import { resolveImageSrc } from "./media";
import { createWorkspaceIcon, type WorkspaceIconName } from "./workspaceIcons";
import { initWorkspaceSettingsPage } from "./workspaceSettingsPage";

type PanelKind = "image" | "file" | "text" | "web" | "note";
type WorkspacePage = "assets" | "notebook" | "chat" | "settings";
type AssetFilter = "all" | "image" | "text" | "file";

const NOTE_RESOURCE_MARKER = "[[desktop-shell:resources:v1]]";
const LAST_ASSET_KEY = "desktop-shell.workspace.last-asset-id";
const LAST_NOTE_KEY = "desktop-shell.workspace.last-note-id";
const NOTE_ORDER_KEY = "desktop-shell.workspace.note-order";
const ASSISTANT_PLACEHOLDER = "正在打开 Agent...";

interface PanelContentPayload {
  id?: number;
  kind: PanelKind;
  value: string;
}

interface ClipboardHistoryItem {
  id: number;
  kind: PanelKind;
  value: string;
  preview: string;
  created_at_ms: number;
  pinned: boolean;
  pinned_at_ms?: number | null;
  upload_state?: UploadState;
  remote_file_id?: string | null;
  resources?: SavedResource[];
}

type UploadState = "not_uploaded" | "uploading" | "uploaded" | "failed";

interface SavedResourceSummary {
  id?: number; // 璧勬簮鐨?history item id
  kind: "text" | "image" | "file";
  name: string;
  summary: string;
  size?: string;
}

interface SavedResource {
  kind: "text" | "image" | "file";
  name: string;
  path?: string | null;
  summary?: string | null;
  extracted_text?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  history_item_id?: number;
}

interface AssetSelection {
  kind: PanelKind;
  title: string;
  summary: string;
  content?: string;
  createdAtLabel: string;
  detailLines: Array<{ label: string; value: string }>;
  imageValue?: string;
  id?: number;
  pinned?: boolean;
  uploadState?: UploadState;
  remoteFileId?: string | null;
}

interface NoteSelection {
  kind: "note";
  title: string;
  summary: string;
  text: string;
  resources: SavedResourceSummary[];
  createdAtLabel: string;
  id?: number;
  pinned?: boolean;
  uploadState?: UploadState;
  remoteFileId?: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  documents?: DesktopDocumentRead[];
  actions?: DesktopActionRead[];
  error?: boolean;
}

type ChatDrawerState =
  | { kind: "closed" }
  | { kind: "tools" }
  | { kind: "document"; document: DesktopDocumentRead; citationIndex: number };

function normalizedUploadState(item: ClipboardHistoryItem): UploadState {
  const state = item.upload_state;
  if (state === "uploaded" || state === "uploading" || state === "failed" || state === "not_uploaded") {
    return state;
  }
  return item.remote_file_id ? "uploaded" : "not_uploaded";
}

interface AssetTranslationState {
  key: string;
  source: string;
  status: "loading" | "success" | "error";
  translatedText?: string;
  error?: string;
}

function assetTranslationKey(selection: AssetSelection): string {
  return `${selection.id ?? "transient"}:${selection.content ?? ""}`;
}

function parseNoteWithResources(value: string): { text: string; resources: SavedResourceSummary[] } {
  const parts = value.split(NOTE_RESOURCE_MARKER);
  if (parts.length < 2) {
    return { text: value.trim(), resources: [] };
  }
  const text = parts[0].trim();
  const resourceJson = parts[1].trim();
  try {
    const resources = JSON.parse(resourceJson) as SavedResourceSummary[];
    return { text, resources: Array.isArray(resources) ? resources : [] };
  } catch {
    return { text: value.trim(), resources: [] };
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function ellipsize(value: string, max: number): string {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function basenameOf(value: string): string {
  const normalized = value.replace(/[?#].*$/, "").trim();
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || value;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    // 当日：只显示时分
    return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  const sameMonth =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth();

  if (sameMonth) {
    // 当月非当日：只显示月日
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }

  // 非当月：显示年月日
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function kindLabel(kind: PanelKind): string {
  switch (kind) {
    case "image":
      return "图片";
    case "web":
      return "文本";
    case "note":
      return "记事本";
    case "file":
      return "文件";
    default:
      return "文本";
  }
}

function assetTitle(kind: PanelKind, value: string, preview?: string): string {
  if (kind === "image" || kind === "file") return basenameOf(value);
  return ellipsize((preview || value).split(/\r?\n/)[0] || "未命名素材", 28) || "未命名素材";
}

function assetSummary(kind: PanelKind, value: string, preview?: string): string {
  if (kind === "image") return "点击后查看素材信息";
  if (kind === "file") return "文件素材";
  return ellipsize(preview || value || "暂无摘要", 42) || "暂无摘要";
}

function noteTitle(value: string, preview?: string): string {
  const parsed = parseNoteWithResources(value);
  const titleFromPreview = (preview || "").trim();
  if (titleFromPreview) {
    return titleFromPreview.split(/\r?\n/)[0] || "未命名便签";
  }
  const firstLine = parsed.text.split(/\r?\n/)[0] || "未命名便签";
  return firstLine;
}

function noteSummary(value: string, _preview?: string): string {
  const parsed = parseNoteWithResources(value);
  if (!parsed.text && parsed.resources.length > 0) {
    return `${parsed.resources.length} 个关联资源`;
  }
  return ellipsize(parsed.text || "暂无正文", 42) || "暂无正文";
}

function matchesQuery(item: ClipboardHistoryItem, query: string): boolean {
  if (!query) return true;
  const parsed = item.kind === "note" ? parseNoteWithResources(item.value) : undefined;
  const haystack = [
    item.preview,
    item.value,
    parsed?.text,
    ...(parsed?.resources.map((resource) => `${resource.name} ${resource.summary}`) ?? []),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortHistory(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  return [...items].sort((a, b) => {
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    if (a.pinned && b.pinned) {
      return (b.pinned_at_ms ?? 0) - (a.pinned_at_ms ?? 0);
    }
    return b.created_at_ms - a.created_at_ms;
  });
}

function notebookOrderIds(history: ClipboardHistoryItem[]): number[] {
  const notes = sortHistory(history.filter((item) => item.kind === "note"));
  const storedOrder = readNotebookOrder();
  if (storedOrder.length === 0) {
    return notes.map((item) => item.id ?? 0).filter((id) => id > 0);
  }
  const noteIds = new Set(notes.map((item) => item.id ?? 0));
  const ordered = storedOrder.filter((id) => noteIds.has(id));
  const used = new Set(ordered);
  for (const note of notes) {
    if (note.id !== undefined && !used.has(note.id)) {
      ordered.push(note.id);
      used.add(note.id);
    }
  }
  return ordered;
}

function assetItems(history: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  return sortHistory(history.filter((item) => item.kind !== "note"));
}

function notebookItems(history: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  const notes = history.filter((item) => item.kind === "note");
  const byId = new Map(sortHistory(notes).map((item) => [item.id ?? 0, item]));
  const orderedIds = notebookOrderIds(history);
  if (orderedIds.length === 0) {
    return sortHistory(notes);
  }
  return orderedIds.map((id) => byId.get(id)).filter((item): item is ClipboardHistoryItem => item !== undefined);
}

function removeNotebookFromOrder(noteId: number): void {
  const next = readNotebookOrder().filter((id) => id !== noteId);
  writeNotebookOrder(next);
}

function filteredAssets(
  history: ClipboardHistoryItem[],
  filter: AssetFilter,
  query: string,
): ClipboardHistoryItem[] {
  return assetItems(history).filter((item) => {
    const filterPassed =
      filter === "all" ||
      (filter === "image" && item.kind === "image") ||
      (filter === "text" && (item.kind === "text" || item.kind === "web")) ||
      (filter === "file" && item.kind === "file");
    return filterPassed && matchesQuery(item, query);
  });
}

function filteredNotes(history: ClipboardHistoryItem[], query: string): ClipboardHistoryItem[] {
  return notebookItems(history).filter((item) => matchesQuery(item, query));
}

function assetSelectionFromItem(item: ClipboardHistoryItem): AssetSelection {
  const resource = item.resources?.find((candidate) => candidate.kind === item.kind) ?? item.resources?.[0];
  const parsedDescription =
    resource?.summary?.trim() ||
    resource?.extracted_text?.trim() ||
    "";
  const fallbackDescription =
    item.kind === "image"
      ? "图片素材，点击可查看原图。"
      : item.kind === "file"
        ? "文件素材。"
        : normalizeText(item.preview || item.value) || "暂无描述";
  const description = parsedDescription || fallbackDescription;

  // 监控模式下的纯文本素材：value 保存全文，preview 只是截断标题。
  // 详情面板需要用全文渲染，避免看起来“只保存了标题”。
  const content =
    item.kind === "text" || item.kind === "web"
      ? item.value
      : undefined;

  return {
    kind: item.kind,
    title: assetTitle(item.kind, item.value, item.preview),
    summary: description,
    content,
    createdAtLabel: formatTime(item.created_at_ms),
    detailLines: [
      { label: "名称", value: assetTitle(item.kind, item.value, item.preview) },
      { label: "类型", value: kindLabel(item.kind) },
      { label: "导入时间", value: formatTime(item.created_at_ms) },
      { label: "描述", value: description },
    ],
    imageValue: item.kind === "image" ? item.value : undefined,
    id: item.id,
    pinned: item.pinned,
    uploadState: normalizedUploadState(item),
    remoteFileId: item.remote_file_id ?? null,
  };
}

function assetSelectionFromPayload(payload: PanelContentPayload): AssetSelection {
  return {
    kind: payload.kind,
    title: assetTitle(payload.kind, payload.value, payload.value),
    summary: assetSummary(payload.kind, payload.value, payload.value),
    content: payload.kind === "text" || payload.kind === "web" ? payload.value : undefined,
    createdAtLabel: "临时预览",
    detailLines: [
      { label: "名称", value: assetTitle(payload.kind, payload.value, payload.value) },
      { label: "类型", value: kindLabel(payload.kind) },
      { label: "导入时间", value: "临时预览" },
      { label: "描述", value: payload.kind === "image" ? "图片素材，点击可查看原图。" : payload.kind === "file" ? "文件素材。" : normalizeText(payload.value) || "暂无描述" },
    ],
    imageValue: payload.kind === "image" ? payload.value : undefined,
    uploadState: "not_uploaded",
    remoteFileId: null,
  };
}

function noteSelectionFromItem(item: ClipboardHistoryItem): NoteSelection {
  const parsed = parseNoteWithResources(item.value);
  return {
    kind: "note",
    title: noteTitle(item.value, item.preview),
    summary: noteSummary(item.value, item.preview),
    text: parsed.text,
    resources: parsed.resources,
    createdAtLabel: formatTime(item.created_at_ms),
    id: item.id,
    pinned: item.pinned,
    uploadState: normalizedUploadState(item),
    remoteFileId: item.remote_file_id ?? null,
  };
}

function noteSelectionFromPayload(payload: PanelContentPayload): NoteSelection {
  const parsed = parseNoteWithResources(payload.value);
  return {
    kind: "note",
    title: noteTitle(payload.value, payload.value),
    summary: noteSummary(payload.value, payload.value),
    text: parsed.text,
    resources: parsed.resources,
    createdAtLabel: "临时查看",
    uploadState: "not_uploaded",
    remoteFileId: null,
  };
}

function workspacePlaceholder(page: WorkspacePage): string {
  if (page === "assets") return "搜索素材、文件或标签";
  if (page === "notebook") return "搜索便签、分类或正文";
  if (page === "settings") return "设置页不支持搜索";
  return "搜索消息、文件或任务";
}

function safeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readNotebookOrder(): number[] {
  const raw = safeRead(NOTE_ORDER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const order: number[] = [];
    const seen = new Set<number>();
    for (const value of parsed) {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    return order;
  } catch {
    return [];
  }
}

function writeNotebookOrder(order: number[]): void {
  safeStore(NOTE_ORDER_KEY, JSON.stringify(order));
}

function createEmptyState(title: string, detail: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "workspace-empty";
  const heading = document.createElement("div");
  heading.className = "workspace-empty-title";
  heading.textContent = title;
  const desc = document.createElement("div");
  desc.className = "workspace-empty-desc";
  desc.textContent = detail;
  wrap.appendChild(heading);
  wrap.appendChild(desc);
  return wrap;
}

function renderAssetFilters(root: HTMLElement, active: AssetFilter, onSelect: (filter: AssetFilter) => void): void {
  const filters: Array<{ key: AssetFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "image", label: "图片" },
    { key: "file", label: "文件" },
    { key: "text", label: "文本" },
  ];
  root.innerHTML = "";
  for (const filter of filters) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "workspace-filter-pill" + (filter.key === active ? " is-active" : "");
    pill.textContent = filter.label;
    pill.addEventListener("click", () => onSelect(filter.key));
    root.appendChild(pill);
  }
}

function renderAssetGrid(
  root: HTMLElement,
  items: ClipboardHistoryItem[],
  activeId: number | undefined,
  onSelect: (item: ClipboardHistoryItem) => void,
): void {
  const listKey = items.map((item) => String(item.id ?? "")).join("|");
  // 仅切换选中项时，不要重建整个网格（否则所有图片 <img> 会被重新创建并闪烁刷新）
  if (root.dataset.assetListKey === listKey && root.childElementCount > 0) {
    root.querySelectorAll<HTMLElement>(".workspace-asset-card").forEach((node) => {
      const id = Number(node.dataset.assetId || "");
      node.classList.toggle("is-active", Number.isFinite(id) && id === activeId);
    });
    return;
  }

  root.dataset.assetListKey = listKey;
  root.innerHTML = "";
  if (items.length === 0) {
    root.appendChild(createEmptyState("暂无素材", "当前筛选条件下没有可显示的素材。"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "workspace-asset-card" + (item.id === activeId ? " is-active" : "");
    if (item.id !== undefined) {
      card.dataset.assetId = String(item.id);
    }
    const preview = document.createElement("div");
    preview.className = `workspace-asset-preview kind-${item.kind}`;
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.className = "workspace-asset-preview-image";
      void resolveImageSrc(item.value).then((src) => {
        image.src = src;
      });
      preview.appendChild(image);
    } else {
      const iconName: WorkspaceIconName = "file-text";
      const icon = createWorkspaceIcon(
        iconName,
        `workspace-inline-icon workspace-asset-preview-icon kind-${item.kind}`,
      );
      preview.appendChild(icon);
    }
    const title = document.createElement("div");
    title.className = "workspace-asset-title";
    title.textContent = assetTitle(item.kind, item.value, item.preview);
    const meta = document.createElement("div");
    meta.className = "workspace-asset-meta";
    meta.textContent = `${formatTime(item.created_at_ms)} · ${kindLabel(item.kind)}`;
    card.append(preview, title, meta);
    card.addEventListener("click", () => onSelect(item));
    root.appendChild(card);
  }
}

function renderAssetDetail(
  root: HTMLElement,
  selection: AssetSelection | undefined,
  onPin?: () => void,
  onCopy?: () => void,
  onDelete?: () => void,
  translation?: AssetTranslationState,
  onTranslate?: () => void,
  onSync?: () => void,
): void {
  root.innerHTML = "";
  if (!selection) {
    root.appendChild(createEmptyState("素材信息", "从左侧选择一项素材后，这里会显示详细信息。"));
    return;
  }

  // 文本类型：详情面板仅显示内容（不显示名称/类型/时间/概述等信息）
  if (selection.kind === "text" || selection.kind === "web") {
    const header = document.createElement("div");
    header.className = "workspace-detail-header";
    const kicker = document.createElement("p");
    kicker.className = "workspace-kicker";
    kicker.textContent = "内容";
    const badges = document.createElement("div");
    badges.className = "workspace-detail-badges";

    const uploadState = selection.uploadState ?? "not_uploaded";
    if (selection.id) {
      const uploadPill = document.createElement("span");
      uploadPill.className = "workspace-status-pill is-soft";
      uploadPill.textContent =
        uploadState === "uploaded"
          ? "已上传"
          : uploadState === "uploading"
            ? "上传中"
            : uploadState === "failed"
              ? "上传失败"
              : "未上传";
      badges.appendChild(uploadPill);
    }
    const translateButton = document.createElement("button");
    translateButton.type = "button";
    translateButton.className = "workspace-action-button workspace-translate-button";
    translateButton.textContent = translation?.status === "loading" ? "正在翻译" : "翻译";
    translateButton.disabled = translation?.status === "loading";
    translateButton.addEventListener("click", () => onTranslate?.());
    badges.appendChild(translateButton);

    if (selection.id && uploadState !== "uploaded") {
      const authState = authStore.getState();
      const syncButton = document.createElement("button");
      syncButton.type = "button";
      syncButton.className = "workspace-action-button";
      syncButton.textContent = uploadState === "uploading" ? "同步中" : "同步";
      const disabled =
        uploadState === "uploading" || !authState.onlineMode || !authState.isLoggedIn;
      syncButton.disabled = disabled;
      syncButton.title = disabled && (!authState.onlineMode || !authState.isLoggedIn)
        ? "需开启在线模式并登录后才可同步"
        : "同步到云端";
      syncButton.addEventListener("click", () => onSync?.());
      badges.appendChild(syncButton);
    }

    header.append(kicker, badges);
    root.appendChild(header);

    const scroll = document.createElement("div");
    scroll.className = "workspace-detail-scroll";
    const content = document.createElement("div");
    content.className = "workspace-detail-text";
    content.textContent = selection.content ?? selection.summary ?? "";
    scroll.appendChild(content);

    if (translation) {
      const translationBlock = document.createElement("div");
      translationBlock.className = "workspace-detail-translation";
      const translationLabel = document.createElement("div");
      translationLabel.className = "workspace-detail-translation-label";
      translationLabel.textContent = translation.status === "error" ? "翻译失败" : "翻译";
      translationBlock.appendChild(translationLabel);

      const translationContent = document.createElement("div");
      translationContent.className = "workspace-detail-text workspace-detail-translation-text";
      translationContent.textContent =
        translation.status === "loading"
          ? "正在翻译..."
          : translation.status === "error"
            ? translation.error ?? "翻译失败"
            : translation.translatedText ?? "未返回翻译结果";
      translationBlock.appendChild(translationContent);
      scroll.appendChild(translationBlock);
    }
    root.appendChild(scroll);

    if (selection.id) {
      const footer = document.createElement("div");
      footer.className = "workspace-detail-actions";
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "workspace-action-button";
      pin.textContent = selection.pinned ? "取消置顶" : "置顶";
      pin.addEventListener("click", () => onPin?.());
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "workspace-action-button";
      copyButton.textContent = "复制";
      copyButton.addEventListener("click", () => onCopy?.());
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "workspace-action-button is-danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => onDelete?.());
      footer.append(pin, copyButton, deleteButton);
      root.appendChild(footer);
    }
    return;
  }

  const header = document.createElement("div");
  header.className = "workspace-detail-header";
  const kicker = document.createElement("p");
  kicker.className = "workspace-kicker";
  kicker.textContent = "素材信息";
  const badges = document.createElement("div");
  badges.className = "workspace-detail-badges";
  const status = document.createElement("span");
  status.className = "workspace-status-pill is-soft";
  status.textContent = selection.pinned ? "已置顶" : selection.createdAtLabel;
  badges.appendChild(status);

  const uploadState = selection.uploadState ?? "not_uploaded";
  if (selection.id) {
    const uploadPill = document.createElement("span");
    uploadPill.className = "workspace-status-pill is-soft";
    uploadPill.textContent =
      uploadState === "uploaded"
        ? "已上传"
          : uploadState === "uploading"
          ? "上传中"
            : uploadState === "failed"
            ? "上传失败"
            : "未上传";
    badges.appendChild(uploadPill);
  }

  if (selection.id && uploadState !== "uploaded") {
    const authState = authStore.getState();
    const syncButton = document.createElement("button");
    syncButton.type = "button";
    syncButton.className = "workspace-action-button";
    syncButton.textContent = uploadState === "uploading" ? "同步中" : "同步";
    const disabled = uploadState === "uploading" || !authState.onlineMode || !authState.isLoggedIn;
    syncButton.disabled = disabled;
    syncButton.title = disabled && (!authState.onlineMode || !authState.isLoggedIn)
      ? "需开启在线模式并登录后才可同步"
      : "同步到云端";
    syncButton.addEventListener("click", () => onSync?.());
    badges.appendChild(syncButton);
  }

  header.append(kicker, badges);
  root.appendChild(header);

  const detailScroll = document.createElement("div");
  detailScroll.className = "workspace-detail-scroll";

  if (selection.imageValue) {
    const media = document.createElement("button");
    media.type = "button";
    media.className = "workspace-detail-image";
    const image = document.createElement("img");
    void resolveImageSrc(selection.imageValue).then((src) => {
      image.src = src;
    });
    media.appendChild(image);
    media.addEventListener("click", () => {
      invoke("open_original_image", { value: selection.imageValue }).catch(() => {});
    });
    detailScroll.appendChild(media);
  }

  const fields = document.createElement("div");
  fields.className = "workspace-detail-fields";
  for (const [index, line] of selection.detailLines.entries()) {
    const isOverview = index === selection.detailLines.length - 1;
    const field = document.createElement("div");
    field.className = "workspace-detail-field";
    const label = document.createElement("p");
    label.className = "workspace-detail-field-label";
    label.textContent = isOverview ? "概述" : line.label;
    const value = document.createElement("p");
    value.className = `workspace-detail-field-value${isOverview ? " workspace-detail-overview-value" : ""}`;
    value.textContent = line.value;
    if (isOverview) {
      const overview = document.createElement("div");
      overview.className = "workspace-detail-overview";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "workspace-detail-overview-toggle";
      toggle.textContent = "...";
      toggle.title = "查看完整概述";
      toggle.setAttribute("aria-label", "查看完整概述");
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const expanded = value.classList.toggle("is-expanded");
        // 兜底：部分环境下 class 切换可能被其它样式覆盖，这里补一层 inline style 保证展开/收起生效。
        if (expanded) {
          (value as HTMLElement).style.display = "block";
          (value as HTMLElement).style.maxHeight = "none";
          (value as HTMLElement).style.overflow = "visible";
          (value as HTMLElement).style.setProperty("-webkit-line-clamp", "unset");
        } else {
          (value as HTMLElement).style.removeProperty("display");
          (value as HTMLElement).style.removeProperty("max-height");
          (value as HTMLElement).style.removeProperty("overflow");
          (value as HTMLElement).style.removeProperty("-webkit-line-clamp");
        }
        toggle.title = expanded ? "收起概述" : "查看完整概述";
        toggle.setAttribute("aria-label", expanded ? "收起概述" : "查看完整概述");
        toggle.textContent = expanded ? "收起" : "...";
      });
      overview.append(value, toggle);
      field.append(label, overview);

      // 如果概述内容没有溢出（两行以内），不显示 ... 按钮，同时去掉右侧预留 padding
      const syncToggleVisibility = () => {
        const valueEl = value as HTMLElement;
        const toggleEl = toggle as HTMLElement;
        // 已展开时保留 toggle（用于收起），且本身就说明存在“可展开”需求
        if (valueEl.classList.contains("is-expanded")) {
          toggleEl.style.display = "";
          valueEl.style.paddingRight = "24px";
          return;
        }

        const rect = valueEl.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          // 还没布局完成，延迟一帧再测
          requestAnimationFrame(syncToggleVisibility);
          return;
        }

        const probe = document.createElement("div");
        probe.textContent = valueEl.textContent || "";
        const style = window.getComputedStyle(valueEl);
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.pointerEvents = "none";
        probe.style.left = "0";
        probe.style.top = "0";
        probe.style.width = `${rect.width}px`;
        probe.style.font = style.font;
        probe.style.fontSize = style.fontSize;
        probe.style.fontFamily = style.fontFamily;
        probe.style.fontWeight = style.fontWeight;
        probe.style.lineHeight = style.lineHeight;
        probe.style.letterSpacing = style.letterSpacing;
        probe.style.whiteSpace = "normal";
        probe.style.wordBreak = style.wordBreak;
        probe.style.overflowWrap = style.overflowWrap as string;
        probe.style.maxHeight = "none";
        probe.style.overflow = "visible";
        probe.style.display = "block";
        overview.appendChild(probe);
        const expandedHeight = probe.scrollHeight;
        probe.remove();

        const clampedHeight = rect.height;
        const overflow = expandedHeight > clampedHeight + 1;
        toggleEl.style.display = overflow ? "" : "none";
        valueEl.style.paddingRight = overflow ? "24px" : "0";
      };
      requestAnimationFrame(syncToggleVisibility);
    } else {
      field.append(label, value);
    }
    fields.appendChild(field);
  }
  detailScroll.appendChild(fields);
  root.appendChild(detailScroll);

  if (selection.id) {
    const footer = document.createElement("div");
    footer.className = "workspace-detail-actions";
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "workspace-action-button";
    pin.textContent = selection.pinned ? "取消置顶" : "置顶";
    pin.addEventListener("click", () => onPin?.());
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "workspace-action-button";
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", () => onCopy?.());
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "workspace-action-button is-danger";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => onDelete?.());
    footer.append(pin, copyButton, deleteButton);
    root.appendChild(footer);
  }
}

function renderNotebookList(
  root: HTMLElement,
  items: ClipboardHistoryItem[],
  activeId: number | undefined,
  manageMode: boolean,
  onSelect: (item: ClipboardHistoryItem) => void,
  onPin: (item: ClipboardHistoryItem) => void,
  onDelete: (item: ClipboardHistoryItem) => void,
): void {
  root.innerHTML = "";
  if (items.length === 0) {
    root.appendChild(createEmptyState("暂无便签", "保存一条记事本内容后，这里会同步出现。"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "workspace-note-card" + (item.id === activeId ? " is-active" : "") + (manageMode ? " is-managing" : "");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "workspace-note-card-main";
    const row = document.createElement("div");
    row.className = "workspace-note-card-top";
    const title = document.createElement("h3");
    title.className = "workspace-note-card-title";
    title.textContent = noteTitle(item.value, item.preview);
    const badge = document.createElement("span");
    badge.className = "workspace-note-card-badge";
    badge.textContent = item.pinned ? "置顶" : formatTime(item.created_at_ms);
    row.append(title, badge);
    const summary = document.createElement("p");
    summary.className = "workspace-note-card-summary";
    summary.textContent = noteSummary(item.value, item.preview);
    main.append(row, summary);
    main.addEventListener("click", () => onSelect(item));

    const actions = document.createElement("div");
    actions.className = "workspace-note-card-actions";
    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "workspace-icon-button workspace-note-card-action";
    pinButton.setAttribute("aria-label", item.pinned ? "取消置顶" : "置顶");
    pinButton.title = item.pinned ? "取消置顶" : "置顶";
    pinButton.appendChild(createWorkspaceIcon("pin", "workspace-inline-icon workspace-note-card-action-icon"));
    pinButton.classList.toggle("is-active", item.pinned);
    pinButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onPin(item);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "workspace-icon-button workspace-note-card-action is-danger";
    deleteButton.setAttribute("aria-label", "删除");
    deleteButton.title = "删除";
    deleteButton.appendChild(createWorkspaceIcon("trash-2", "workspace-inline-icon workspace-note-card-action-icon"));
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onDelete(item);
    });
    actions.append(pinButton, deleteButton);

    card.append(main, actions);
    root.appendChild(card);
  }
}

function renderNotebookDetail(
  root: HTMLElement,
  selection: NoteSelection | undefined,
  onPin?: () => void,
  onCopy?: () => void,
  onDelete?: () => void,
  onSync?: () => void,
  onSave?: (title: string, text: string) => void,
  allMaterials?: SavedResourceSummary[],
  editorState?: { isEditing: boolean; title: string; text: string },
  onEditorStateChange?: (next: { isEditing: boolean; title: string; text: string }) => void,
): void {
  root.innerHTML = "";
  if (!selection) {
    root.appendChild(createEmptyState("便签正文", "从左侧选择一条便签后，这里会展示正文与关联素材。"));
    return;
  }

  let isEditing = editorState?.isEditing ?? false;
  let editedTitle = editorState?.title ?? selection.title;
  let editedText = editorState?.text ?? selection.text;
  let saveTimeout: number | undefined;
  let drawerMaterial: SavedResourceSummary | undefined;
  let drawerRoot: HTMLElement | undefined;
  let drawerTitle: HTMLElement | undefined;
  let drawerBody: HTMLElement | undefined;
  let getCurrentTitle: () => string = () => editedTitle;
  let getCurrentText: () => string = () => editedText;

  const autoSave = () => {
    if (saveTimeout !== undefined) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
      if (isEditing && onSave) {
        // 不依赖缓存变量，直接读取当前 DOM 状态，避免偶发截断/丢字符
        const currentTitle = getCurrentTitle();
        const currentText = getCurrentText();
        editedTitle = currentTitle;
        editedText = currentText;
        onEditorStateChange?.({ isEditing: true, title: currentTitle, text: currentText });
        onSave(currentTitle, currentText);
      }
    }, 1000);
  };

  const materialKindLabel = (kind: SavedResourceSummary["kind"]) =>
    kind === "text" ? "文本" : kind === "image" ? "图片" : "文件";

  const ensureDrawer = (): { drawer: HTMLElement; title: HTMLElement; body: HTMLElement } => {
    if (drawerRoot && drawerTitle && drawerBody) {
      return { drawer: drawerRoot, title: drawerTitle, body: drawerBody };
    }
    const drawer = document.createElement("div");
    drawer.className = "workspace-material-drawer";
    drawer.setAttribute("aria-hidden", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "workspace-material-drawer-backdrop";
    backdrop.addEventListener("click", () => {
      drawerMaterial = undefined;
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    });

    const sheet = document.createElement("div");
    sheet.className = "workspace-material-drawer-sheet";

    const header = document.createElement("div");
    header.className = "workspace-material-drawer-header";
    const title = document.createElement("div");
    title.className = "workspace-material-drawer-title";
    const closeBtn = document.createElement("button");
    closeBtn.className = "workspace-icon-button";
    closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.title = "关闭";
    closeBtn.appendChild(createWorkspaceIcon("x", "workspace-inline-icon"));
    closeBtn.addEventListener("click", () => {
      drawerMaterial = undefined;
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    });
    header.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "workspace-material-drawer-body";

    sheet.append(header, body);
    drawer.append(backdrop, sheet);
    root.appendChild(drawer);

    drawerRoot = drawer;
    drawerTitle = title;
    drawerBody = body;
    return { drawer, title, body };
  };

  const openMaterialDrawer = (material: SavedResourceSummary) => {
    drawerMaterial = material;
    const { drawer, title, body } = ensureDrawer();

    title.textContent = material.name;
    body.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "workspace-material-drawer-grid";

    const addRow = (labelText: string, valueText: string) => {
      const label = document.createElement("div");
      label.className = "workspace-material-drawer-label";
      label.textContent = labelText;
      const value = document.createElement("div");
      value.className = "workspace-material-drawer-value";
      value.textContent = valueText;
      grid.append(label, value);
    };

    addRow("类型", materialKindLabel(material.kind));
    if (material.size) addRow("大小", material.size);
    addRow("概览", material.summary?.trim() || "暂无概览");

    body.appendChild(grid);
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
  };

  const render = () => {
    root.innerHTML = "";
    drawerRoot = undefined;
    drawerTitle = undefined;
    drawerBody = undefined;
    root.style.position = "relative";

    const header = document.createElement("div");
    header.className = "workspace-detail-header";
    const headerCopy = document.createElement("div");
    headerCopy.className = "workspace-detail-header-copy";

    if (isEditing) {
      // 编辑模式：标题可编辑
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "workspace-detail-title-input";
      titleInput.value = editedTitle;
      titleInput.placeholder = "便签标题";
      titleInput.addEventListener("input", () => {
        editedTitle = titleInput.value;
        onEditorStateChange?.({ isEditing: true, title: editedTitle, text: editedText });
        autoSave();
      });
      headerCopy.appendChild(titleInput);
      getCurrentTitle = () => titleInput.value;
    } else {
      // 查看模式：标题只读
      const title = document.createElement("h3");
      title.className = "workspace-detail-title";
      title.textContent = selection.title;
      headerCopy.appendChild(title);
    }
    const badges = document.createElement("div");
    badges.className = "workspace-detail-badges";

    if (selection.id) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "workspace-icon-button";
      editButton.setAttribute("aria-label", isEditing ? "完成编辑" : "编辑便签");
      editButton.title = isEditing ? "完成编辑" : "编辑便签";
      editButton.appendChild(createWorkspaceIcon(isEditing ? "check" : "pencil", "workspace-inline-icon"));
      editButton.addEventListener("click", () => {
        if (isEditing && saveTimeout !== undefined) {
          clearTimeout(saveTimeout);
          onSave?.(editedTitle, editedText);
        }
        isEditing = !isEditing;
        onEditorStateChange?.({ isEditing, title: editedTitle, text: editedText });
        render();
      });
      badges.appendChild(editButton);

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "workspace-icon-button";
      pinButton.setAttribute("aria-label", selection.pinned ? "取消置顶" : "置顶");
      pinButton.title = selection.pinned ? "取消置顶" : "置顶";
      pinButton.appendChild(createWorkspaceIcon("pin", "workspace-inline-icon workspace-note-pin-icon"));
      pinButton.classList.toggle("is-active", selection.pinned);
      pinButton.addEventListener("click", () => onPin?.());
      badges.appendChild(pinButton);

      const uploadState = selection.uploadState ?? "not_uploaded";
      const uploadPill = document.createElement("span");
      uploadPill.className = "workspace-status-pill is-soft";
      uploadPill.textContent =
        uploadState === "uploaded"
          ? "已上传"
            : uploadState === "uploading"
            ? "上传中"
              : uploadState === "failed"
              ? "上传失败"
              : "未上传";
      badges.appendChild(uploadPill);

      if (uploadState !== "uploaded") {
        const authState = authStore.getState();
        const syncButton = document.createElement("button");
        syncButton.type = "button";
        syncButton.className = "workspace-action-button";
        syncButton.textContent = uploadState === "uploading" ? "同步中" : "同步";
        const disabled =
          uploadState === "uploading" || !authState.onlineMode || !authState.isLoggedIn;
        syncButton.disabled = disabled;
        syncButton.title = disabled && (!authState.onlineMode || !authState.isLoggedIn)
          ? "需开启在线模式并登录后才可同步"
          : "同步到云端";
        syncButton.addEventListener("click", () => onSync?.());
        badges.appendChild(syncButton);
      }
    }
    header.append(headerCopy, badges);
    root.appendChild(header);

    if (isEditing) {
      // 编辑模式
      const editorWrap = document.createElement("div");
      editorWrap.className = "workspace-note-editor";
      editorWrap.style.position = "relative";

      const materials: SavedResourceSummary[] = Array.isArray(allMaterials) ? allMaterials : [];
      const materialsById = new Map<number, SavedResourceSummary>();
      for (const item of materials) {
        if (typeof item.id === "number") materialsById.set(item.id, item);
      }

      const createMention = (material: SavedResourceSummary) => {
        const mention = document.createElement("span");
        mention.className = "workspace-mention";
        if (material.id !== undefined) {
          mention.dataset.fileId = String(material.id);
        }
        mention.textContent = `@${material.name}`;
        mention.setAttribute("contenteditable", "false");
        mention.style.cursor = "pointer";
        mention.addEventListener("click", () => openMaterialDrawer(material));
        return mention;
      };

      const editor = document.createElement("div");
      editor.className = "workspace-note-editor-rich";
      editor.contentEditable = "true";
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "true");
      editor.setAttribute("data-placeholder", "输入便签内容...");

      const renderEditorFromText = (text: string) => {
        editor.innerHTML = "";
        if (!text) return;
        const parts = text.split(/(@file_id_\d+)/g);
        for (const part of parts) {
          const match = part.match(/^@file_id_(\d+)$/);
          if (match) {
            const fileId = Number(match[1]);
            const material = materialsById.get(fileId);
            if (material) {
              editor.appendChild(createMention(material));
              continue;
            }
          }
          const lines = part.split(/\n/g);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]) editor.appendChild(document.createTextNode(lines[i]));
            if (i < lines.length - 1) editor.appendChild(document.createElement("br"));
          }
        }
      };

      const serializeEditorText = () => {
        const chunks: string[] = [];
        const walk = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            chunks.push((node as Text).data);
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as HTMLElement;
          if (el.classList.contains("workspace-mention") && el.dataset.fileId) {
            chunks.push(`@file_id_${el.dataset.fileId}`);
            return;
          }
          if (el.tagName === "BR") {
            chunks.push("\n");
            return;
          }
          for (const child of Array.from(el.childNodes)) {
            walk(child);
          }
          // contenteditable 可能会产生 div/p 作为换行容器
          if (el !== editor && (el.tagName === "DIV" || el.tagName === "P")) {
            chunks.push("\n");
          }
        };
        for (const child of Array.from(editor.childNodes)) walk(child);
        return chunks.join("").replace(/\n{3,}/g, "\n\n");
      };

      const setCaretAfter = (node: Node) => {
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        editor.focus();
      };

      // 自动补全相关状态
      let autocompleteVisible = false;
      let autocompleteSelectedIndex = 0;
      let mentionQueryNode: Text | null = null;
      let mentionQueryAtIndex = 0;

      const autocompleteDropdown = document.createElement("div");
      autocompleteDropdown.className = "workspace-autocomplete-dropdown";
      autocompleteDropdown.style.display = "none";

      const hideAutocomplete = () => {
        autocompleteDropdown.style.display = "none";
        autocompleteVisible = false;
        autocompleteSelectedIndex = 0;
        mentionQueryNode = null;
        mentionQueryAtIndex = 0;
      };

      const caretRectForRange = (range: Range) => {
        const rect = range.getBoundingClientRect();
        if ((rect.width > 0 || rect.height > 0) && Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
          return rect;
        }
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          const node = range.startContainer as Text;
          if (range.startOffset > 0) {
            const fallback = range.cloneRange();
            fallback.setStart(node, range.startOffset - 1);
            fallback.setEnd(node, range.startOffset);
            const fr = fallback.getBoundingClientRect();
            // 光标一般位于字符右侧
            return new DOMRect(fr.right, fr.bottom, 0, 0);
          }
        }
        return rect;
      };

      const positionAutocomplete = (range: Range) => {
        const wrapRect = editorWrap.getBoundingClientRect();
        const caretRect = caretRectForRange(range);
        // 先展示（但隐藏）以便测量尺寸
        const wasHidden = autocompleteDropdown.style.display === "none";
        const previousVisibility = autocompleteDropdown.style.visibility;
        autocompleteDropdown.style.visibility = "hidden";
        autocompleteDropdown.style.display = "block";

        const dropdownWidth = Math.max(220, autocompleteDropdown.offsetWidth || 0);
        const dropdownHeight = Math.max(120, autocompleteDropdown.offsetHeight || 0);

        let left = caretRect.left - wrapRect.left;
        const below = caretRect.bottom - wrapRect.top + 6;
        const above = caretRect.top - wrapRect.top - dropdownHeight - 6;
        let top = below;

        // 底部不够则向上翻转
        if (below + dropdownHeight > wrapRect.height - 8 && above >= 8) {
          top = above;
        }

        // 边缘吸附/限制在容器内
        left = Math.min(Math.max(8, left), Math.max(8, wrapRect.width - dropdownWidth - 8));
        top = Math.min(Math.max(8, top), Math.max(8, wrapRect.height - dropdownHeight - 8));

        autocompleteDropdown.style.left = `${left}px`;
        autocompleteDropdown.style.top = `${top}px`;

        // 还原可见性
        autocompleteDropdown.style.visibility = previousVisibility;
        if (wasHidden) {
          autocompleteDropdown.style.display = "none";
        }
      };

      const insertMentionForMaterial = (material: SavedResourceSummary) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();

        // 如果当前在 @ 查询态，尽量把 '@xxx' 整段替换成 mention
        if (mentionQueryNode && sel.anchorNode === mentionQueryNode) {
          const textNode = mentionQueryNode;
          const caretOffset = sel.anchorOffset;
          const full = textNode.data;
          const before = full.slice(0, mentionQueryAtIndex);
          const after = full.slice(caretOffset);
          textNode.data = before;

          const mentionEl = createMention(material);
          const afterNode = document.createTextNode(after);
          textNode.parentNode?.insertBefore(mentionEl, textNode.nextSibling);
          mentionEl.after(afterNode);
          setCaretAfter(mentionEl);
        } else {
          const mentionEl = createMention(material);
          range.insertNode(mentionEl);
          setCaretAfter(mentionEl);
        }

        editedText = serializeEditorText();
        autoSave();
        hideAutocomplete();
      };

      const showAutocomplete = (query: string, range: Range) => {
        const filtered = materials.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
        if (filtered.length === 0) {
          hideAutocomplete();
          return;
        }

        autocompleteDropdown.innerHTML = "";
        autocompleteSelectedIndex = 0;
        filtered.forEach((material, index) => {
          const item = document.createElement("div");
          item.className = "workspace-autocomplete-item";
          if (index === 0) item.classList.add("is-selected");

          const name = document.createElement("div");
          name.className = "workspace-autocomplete-item-name";
          name.textContent = material.name;

          const summary = document.createElement("div");
          summary.className = "workspace-autocomplete-item-summary";
          summary.textContent = material.summary;

          item.append(name, summary);
          item.addEventListener("mousedown", (e) => {
            e.preventDefault(); // 防止 editor 失去焦点
            insertMentionForMaterial(material);
          });
          autocompleteDropdown.appendChild(item);
        });

        positionAutocomplete(range);
        autocompleteDropdown.style.display = "block";
        autocompleteVisible = true;
      };

      const updateAutocompleteSelection = (delta: number) => {
        const items = autocompleteDropdown.querySelectorAll(".workspace-autocomplete-item");
        if (items.length === 0) return;
        items[autocompleteSelectedIndex]?.classList.remove("is-selected");
        autocompleteSelectedIndex = (autocompleteSelectedIndex + delta + items.length) % items.length;
        items[autocompleteSelectedIndex]?.classList.add("is-selected");
        (items[autocompleteSelectedIndex] as HTMLElement)?.scrollIntoView({ block: "nearest" });
      };

      const maybeTriggerAutocomplete = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
          hideAutocomplete();
          return;
        }
        const range = sel.getRangeAt(0);
        if (!range.collapsed || !editor.contains(range.startContainer)) {
          hideAutocomplete();
          return;
        }
        if (range.startContainer.nodeType !== Node.TEXT_NODE) {
          hideAutocomplete();
          return;
        }
        const node = range.startContainer as Text;
        const offset = range.startOffset;
        const before = node.data.slice(0, offset);
        const atIndex = before.lastIndexOf("@");
        if (atIndex < 0) {
          hideAutocomplete();
          return;
        }
        const query = before.slice(atIndex + 1);
        if (/[\s]/.test(query)) {
          hideAutocomplete();
          return;
        }
        mentionQueryNode = node;
        mentionQueryAtIndex = atIndex;
        showAutocomplete(query, range);
      };

      renderEditorFromText(editedText);
      getCurrentText = () => serializeEditorText();

      editor.addEventListener("input", () => {
        editedText = serializeEditorText();
        onEditorStateChange?.({ isEditing: true, title: editedTitle, text: editedText });
        autoSave();
        maybeTriggerAutocomplete();
      });

      editor.addEventListener("keydown", (event) => {
        if (autocompleteVisible) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            updateAutocompleteSelection(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            updateAutocompleteSelection(-1);
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const items = autocompleteDropdown.querySelectorAll(".workspace-autocomplete-item");
            const selectedItem = items[autocompleteSelectedIndex] as HTMLElement | undefined;
            if (selectedItem) {
              selectedItem.dispatchEvent(new MouseEvent("mousedown"));
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            hideAutocomplete();
            return;
          }
        }
      });

      editor.addEventListener("blur", () => {
        setTimeout(() => hideAutocomplete(), 200);
      });

      editor.addEventListener("dragover", (event) => {
        event.preventDefault();
        editor.classList.add("is-drag-over");
      });

      editor.addEventListener("dragleave", () => {
        editor.classList.remove("is-drag-over");
      });

      editor.addEventListener("drop", async (event) => {
        event.preventDefault();
        editor.classList.remove("is-drag-over");

        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length === 0) return;

        for (const file of files) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));

            const result = await invoke<SavedResource>("import_material", {
              kind: file.type.startsWith("image/") ? "image" : "file",
              value: `data:${file.type};base64,${base64}`,
              name: file.name,
            });

            if (!result.history_item_id) continue;

            const fallback: SavedResourceSummary = {
              id: result.history_item_id,
              kind: result.kind === "image" ? "image" : result.kind === "text" ? "text" : "file",
              name: result.name,
              summary: result.summary?.trim() || "暂无概览",
              size: result.size_bytes ? formatBytes(result.size_bytes) : undefined,
            };
            materialsById.set(fallback.id ?? 0, fallback);

            insertMentionForMaterial(fallback);
            onEditorStateChange?.({ isEditing: true, title: editedTitle, text: serializeEditorText() });
          } catch (error) {
            console.error("Failed to import file:", error);
          }
        }
      });

      editorWrap.append(editor, autocompleteDropdown);
      root.appendChild(editorWrap);

      // 工具栏提示
      const hint = document.createElement("div");
      hint.className = "workspace-note-editor-hint";
      hint.textContent = "使用 @ 引用资源库文件，或拖拽文件到此处 • 自动保存";
      root.appendChild(hint);

    } else {
      // 查看模式
      const content = document.createElement("div");
      content.className = "workspace-note-detail-content";
      if (selection.text) {
        const blocks = selection.text
          .replace(/\r\n/g, "\n")
          .split(/\n{2,}/)
          .map((block) => block.trimEnd());

        for (const block of blocks) {
          if (!block.trim()) continue;
          const p = document.createElement("p");

          const lines = block.split("\n");
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];

            // 解析 @file_id_{id} 并高亮显示
            const parts = line.split(/(@file_id_\d+)/g);
            for (const part of parts) {
              const match = part.match(/^@file_id_(\d+)$/);
              if (match) {
                const fileId = parseInt(match[1], 10);
                const material = allMaterials?.find((m) => m.id === fileId);
                if (material) {
                  const mention = document.createElement("span");
                  mention.className = "workspace-mention";
                  mention.textContent = `@${material.name}`;
                  mention.dataset.fileId = String(fileId);
                  mention.style.cursor = "pointer";
                  mention.addEventListener("click", () => openMaterialDrawer(material));
                  p.appendChild(mention);
                } else {
                  p.appendChild(document.createTextNode(part));
                }
              } else {
                p.appendChild(document.createTextNode(part));
              }
            }

            if (lineIndex < lines.length - 1) {
              p.appendChild(document.createElement("br"));
            }
          }

          content.appendChild(p);
        }
      }
      if (!selection.text) {
        const fallback = document.createElement("p");
        fallback.textContent = "这条便签暂时没有正文。";
        content.appendChild(fallback);
      }
      root.appendChild(content);
    }

    if (selection.id && !isEditing) {
      const footer = document.createElement("div");
      footer.className = "workspace-detail-actions";
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "workspace-action-button";
            copyButton.textContent = "复制";
      copyButton.addEventListener("click", () => onCopy?.());
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "workspace-action-button is-danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => onDelete?.());
      footer.append(copyButton, deleteButton);
      root.appendChild(footer);
    }
    
    // 抽屉（默认关闭；点击 mention 时打开）
    const { drawer } = ensureDrawer();
    if (drawerMaterial) {
      openMaterialDrawer(drawerMaterial);
    } else {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    }
  };

  render();
}

function createDesktopThreadId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `desktop-${globalThis.crypto.randomUUID()}`;
  }
  return `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDesktopActionRead(value: unknown): value is DesktopActionRead {
  if (!isRecord(value)) return false;
  return (
    typeof value.action_id === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.tool_name === "string" &&
    isRecord(value.arguments) &&
    typeof value.display_text === "string" &&
    typeof value.risk_level === "string" &&
    typeof value.requires_confirmation === "boolean" &&
    typeof value.status === "string"
  );
}

function collectDesktopActions(value: unknown): DesktopActionRead[] {
  if (isDesktopActionRead(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectDesktopActions);
  if (!isRecord(value)) return [];
  const candidates = [
    value.action,
    value.actions,
    value.desktop_action,
    value.desktop_actions,
    value.proposed_action,
    value.proposed_actions,
    value.tool_call,
    value.tool_calls,
  ];
  return candidates.flatMap(collectDesktopActions);
}

function isDesktopDocumentRead(value: unknown): value is DesktopDocumentRead {
  if (!isRecord(value)) return false;
  return (
    typeof value.file_id === "string" &&
    typeof value.file_name === "string" &&
    typeof value.chunk_id === "string" &&
    typeof value.chunk_index === "number" &&
    Number.isInteger(value.chunk_index) &&
    typeof value.content === "string" &&
    isRecord(value.metadata) &&
    typeof value.score === "number"
  );
}

function collectDesktopDocuments(value: unknown): DesktopDocumentRead[] {
  if (isDesktopDocumentRead(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectDesktopDocuments);
  if (!isRecord(value)) return [];
  const candidates = [
    value.document,
    value.documents,
    value.desktop_document,
    value.desktop_documents,
    value.chunk,
    value.chunks,
  ];
  return candidates.flatMap(collectDesktopDocuments);
}

const ACTION_STATUS_PRIORITY: Record<DesktopActionRead["status"], number> = {
  proposed: 0,
  approved: 1,
  cancelled: 2,
  error: 3,
  success: 4,
};

function mergeDesktopActions(
  existing: DesktopActionRead[] | undefined,
  incoming: DesktopActionRead[],
): DesktopActionRead[] {
  const merged = new Map<string, DesktopActionRead>();
  for (const action of existing ?? []) {
    merged.set(action.action_id, action);
  }
  for (const action of incoming) {
    const previous = merged.get(action.action_id);
    if (!previous) {
      merged.set(action.action_id, action);
      continue;
    }
    const previousRank = ACTION_STATUS_PRIORITY[previous.status];
    const nextRank = ACTION_STATUS_PRIORITY[action.status];
    merged.set(action.action_id, nextRank >= previousRank ? { ...previous, ...action } : previous);
  }
  return [...merged.values()];
}

function documentKey(document: DesktopDocumentRead): string {
  return `${document.file_id}:${document.chunk_id}`;
}

function mergeDesktopDocuments(
  existing: DesktopDocumentRead[] | undefined,
  incoming: DesktopDocumentRead[],
): DesktopDocumentRead[] {
  const merged = new Map<string, DesktopDocumentRead>();
  for (const document of existing ?? []) {
    merged.set(documentKey(document), document);
  }
  for (const document of incoming) {
    merged.set(documentKey(document), document);
  }
  return [...merged.values()];
}

function responseText(value: DesktopAgentInvokeResponse): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const keys = ["output_text", "message", "answer", "display_text", "text", "content", "response"];
  if (isRecord(value)) {
    for (const key of keys) {
      const next = value[key];
      if (typeof next === "string" && next.trim()) return next.trim();
    }
  }
  const documents = collectDesktopDocuments(value);
  if (documents.length > 0) {
    return `已返回 ${documents.length} 条引用`;
  }
  const actions = collectDesktopActions(value);
  if (actions.length > 0) {
    return actions.map((action) => action.display_text || action.reason || action.tool_name).join("\n");
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

interface MarkdownRenderContext {
  documents: DesktopDocumentRead[];
  onCitationClick?: (document: DesktopDocumentRead, citationIndex: number) => void;
  activeDocument?: DesktopDocumentRead;
}

function isSafeMarkdownUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function appendMarkdownInline(root: HTMLElement, text: string, context: MarkdownRenderContext): void {
  let index = 0;
  while (index < text.length) {
    const remaining = text.slice(index);
    const citationMatch = remaining.match(/^\[(\d+)\]/);
    if (citationMatch) {
      const citationIndex = Number(citationMatch[1]);
      const doc = context.documents[citationIndex - 1];
      if (doc) {
        const citation = document.createElement("button");
        citation.type = "button";
        citation.className = "workspace-chat-citation";
        if (
          context.activeDocument &&
          context.activeDocument.file_id === doc.file_id &&
          context.activeDocument.chunk_id === doc.chunk_id
        ) {
          citation.classList.add("is-active");
        }
        citation.textContent = citationMatch[0];
        citation.title = "打开引用 " + citationIndex;
        citation.addEventListener("click", () => context.onCitationClick?.(doc, citationIndex));
        root.appendChild(citation);
        index += citationMatch[0].length;
        continue;
      }
    }

    if (remaining.startsWith("**")) {
      const endIndex = text.indexOf("**", index + 2);
      if (endIndex > index + 2) {
        const strong = document.createElement("strong");
        appendMarkdownInline(strong, text.slice(index + 2, endIndex), context);
        root.appendChild(strong);
        index = endIndex + 2;
        continue;
      }
    }

    if (remaining.startsWith("*")) {
      const endIndex = text.indexOf("*", index + 1);
      if (endIndex > index + 1) {
        const em = document.createElement("em");
        appendMarkdownInline(em, text.slice(index + 1, endIndex), context);
        root.appendChild(em);
        index = endIndex + 1;
        continue;
      }
    }

    if (remaining.startsWith("`")) {
      const endIndex = text.indexOf("`", index + 1);
      if (endIndex > index + 1) {
        const code = document.createElement("code");
        code.textContent = text.slice(index + 1, endIndex);
        root.appendChild(code);
        index = endIndex + 1;
        continue;
      }
    }

    if (remaining.startsWith("[")) {
      const linkMatch = remaining.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
      if (linkMatch) {
        if (isSafeMarkdownUrl(linkMatch[2])) {
          const link = document.createElement("a");
          link.href = linkMatch[2];
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = linkMatch[1];
          root.appendChild(link);
        } else {
          root.appendChild(document.createTextNode(linkMatch[0]));
        }
        index += linkMatch[0].length;
        continue;
      }
    }

    let next = text.length;
    for (const marker of ["[", "*", "`"]) {
      const markerIndex = text.indexOf(marker, index);
      if (markerIndex >= 0 && markerIndex < next) {
        next = markerIndex;
      }
    }
    if (next <= index) {
      next = index + 1;
    }
    root.appendChild(document.createTextNode(text.slice(index, next)));
    index = next;
  }
}

function renderMarkdownText(
  root: HTMLElement,
  text: string,
  context: MarkdownRenderContext,
): void {
  root.innerHTML = "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let codeLines: string[] | null = null;
  let listKind: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement("p");
    appendMarkdownInline(paragraph, paragraphLines.join(" "), context);
    root.appendChild(paragraph);
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const quote = document.createElement("blockquote");
    appendMarkdownInline(quote, quoteLines.join(" "), context);
    root.appendChild(quote);
    quoteLines = [];
  };

  const flushCode = () => {
    if (!codeLines) return;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.appendChild(code);
    root.appendChild(pre);
    codeLines = null;
  };

  const flushList = () => {
    if (!listKind) return;
    const list = document.createElement(listKind);
    for (const itemText of listItems) {
      const item = document.createElement("li");
      appendMarkdownInline(item, itemText, context);
      list.appendChild(item);
    }
    root.appendChild(list);
    listKind = null;
    listItems = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      if (codeLines) {
        flushCode();
      } else {
        flushParagraph();
        flushQuote();
        flushList();
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      const headingTag = "h" + headingMatch[1].length;
      const heading = document.createElement(headingTag);
      appendMarkdownInline(heading, headingMatch[2], context);
      root.appendChild(heading);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    if (quoteLines.length) {
      flushQuote();
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listKind !== "ul") {
        flushList();
        listKind = "ul";
        listItems = [];
      }
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listKind !== "ol") {
        flushList();
        listKind = "ol";
        listItems = [];
      }
      listItems.push(orderedMatch[1]);
      continue;
    }

    if (listKind) {
      flushList();
    }

    paragraphLines.push(line.trim());
  }

  flushParagraph();
  flushQuote();
  flushList();
  flushCode();
}

function renderChatMessageText(
  root: HTMLElement,
  message: ChatMessage,
  onCitationClick?: (document: DesktopDocumentRead, citationIndex: number) => void,
  activeDocument?: DesktopDocumentRead,
): void {
  renderMarkdownText(root, message.text || "", {
    documents: message.documents ?? [],
    onCitationClick,
    activeDocument,
  });
}

function renderChatMessage(
  root: HTMLElement,
  message: ChatMessage,
  onCitationClick?: (document: DesktopDocumentRead, citationIndex: number) => void,
  activeDocument?: DesktopDocumentRead,
): void {
  const row = document.createElement("div");
  row.className = `workspace-chat-row is-${message.role === "user" ? "outgoing" : "incoming"}`;

  const bubble = document.createElement("div");
  bubble.className = `workspace-chat-bubble is-${message.role === "user" ? "outgoing" : "incoming"}`;
  if (message.error) bubble.classList.add("is-error");

  const text = document.createElement("div");
  text.className = "workspace-chat-message-text";
  renderChatMessageText(text, message, onCitationClick, activeDocument);
  bubble.appendChild(text);

  if (message.actions?.length) {
    const actions = document.createElement("div");
    actions.className = "workspace-chat-action-list";
    for (const action of message.actions) {
      const item = document.createElement("article");
      item.className = "workspace-chat-action-card";
      item.dataset.risk = action.risk_level;
      item.dataset.status = action.status;

      const title = document.createElement("div");
      title.className = "workspace-chat-action-title";
      title.textContent = action.tool_name;
      const body = document.createElement("div");
      body.className = "workspace-chat-action-body";
      body.textContent = action.reason || action.display_text;
      const meta = document.createElement("div");
      meta.className = "workspace-chat-action-meta";
      meta.textContent = `${action.status} / ${action.risk_level}${action.requires_confirmation ? " / confirm" : ""}`;
      const args = document.createElement("pre");
      args.className = "workspace-chat-action-args";
      args.textContent = JSON.stringify(action.arguments, null, 2);

      item.append(title, body, meta, args);
      if (action.error_message) {
        const error = document.createElement("div");
        error.className = "workspace-chat-action-error";
        error.textContent = action.error_message;
        item.appendChild(error);
      }
      actions.appendChild(item);
    }
    bubble.appendChild(actions);
  }

  row.appendChild(bubble);
  root.appendChild(row);
}

function renderToolCapabilityList(root: HTMLElement): void {
  root.innerHTML = "";

  const panel = document.createElement("section");
  panel.className = "workspace-tool-panel";

  const list = document.createElement("div");
  list.className = "workspace-tool-capability-list";
  for (const capability of DESKTOP_TOOL_CAPABILITIES) {
    const item = document.createElement("article");
    item.className = "workspace-tool-capability";
    item.dataset.risk = capability.risk_level;

    const main = document.createElement("div");
    main.className = "workspace-tool-capability-main";
    const name = document.createElement("div");
    name.className = "workspace-tool-capability-name";
    name.textContent = capability.label_name;
    const description = document.createElement("div");
    description.className = "workspace-tool-capability-desc";
    description.textContent = capability.label_description;
    main.append(name, description);

    const meta = document.createElement("div");
    meta.className = "workspace-tool-capability-meta";
    const risk = document.createElement("span");
    risk.className = `workspace-tool-risk is-${capability.risk_level}`;
    risk.textContent = capability.risk_level;
    meta.appendChild(risk);
    if (capability.requires_confirmation) {
      const confirm = document.createElement("span");
      confirm.className = "workspace-tool-confirm";
      confirm.textContent = "confirm";
      meta.appendChild(confirm);
    }

    item.append(main, meta);
    list.appendChild(item);
  }

  panel.append(list);
  root.appendChild(panel);
}

function renderChatDrawer(
  root: HTMLElement,
  drawerState: ChatDrawerState,
  onClose: () => void,
): void {
  root.innerHTML = "";
  root.classList.toggle("is-open", drawerState.kind !== "closed");
  root.setAttribute("aria-hidden", drawerState.kind === "closed" ? "true" : "false");

  if (drawerState.kind === "closed") return;

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "workspace-chat-drawer-backdrop";
  backdrop.setAttribute("aria-label", "关闭抽屉");
  backdrop.addEventListener("click", onClose);

  const sheet = document.createElement("section");
  sheet.className = "workspace-chat-drawer-sheet";

  const header = document.createElement("div");
  header.className = "workspace-chat-drawer-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "workspace-chat-drawer-header-copy";
  const kicker = document.createElement("div");
  kicker.className = "workspace-kicker";
  kicker.textContent = drawerState.kind === "tools" ? "工具" : `引用 ${drawerState.citationIndex}`;
  const title = document.createElement("div");
  title.className = "workspace-chat-drawer-title";
  title.textContent =
    drawerState.kind === "tools" ? "工具能力" : drawerState.document.file_name;
  titleWrap.append(kicker, title);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "workspace-icon-button";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.title = "关闭";
  closeBtn.appendChild(createWorkspaceIcon("x", "workspace-inline-icon"));
  closeBtn.addEventListener("click", onClose);
  header.append(titleWrap, closeBtn);

  const body = document.createElement("div");
  body.className = "workspace-chat-drawer-body";

  if (drawerState.kind === "tools") {
    renderToolCapabilityList(body);
  } else {
    const meta = document.createElement("div");
    meta.className = "workspace-chat-drawer-meta";
    meta.textContent = `chunk ${drawerState.document.chunk_index}`;

    const content = document.createElement("pre");
    content.className = "workspace-chat-drawer-content";
    content.textContent = drawerState.document.content;

    body.append(meta, content);
  }

  sheet.append(header, body);
  root.append(backdrop, sheet);
}

function renderStaticChat(
  feedRoot: HTMLElement,
  toolbarRoot: HTMLElement,
  resourcesRoot: HTMLElement,
  messages: ChatMessage[],
  sending: boolean,
  drawerState: ChatDrawerState,
  onToggleTools: () => void,
  onOpenDocument: (document: DesktopDocumentRead, citationIndex: number) => void,
  onCloseDrawer: () => void,
): void {
  feedRoot.innerHTML = "";
  toolbarRoot.innerHTML = "";

  const outgoingWrap = document.createElement("div");


  const incomingWrap = document.createElement("div");
  incomingWrap.className = "workspace-chat-row is-incoming";
  const incoming = document.createElement("div");
  incoming.className = "workspace-chat-bubble is-incoming";
    incoming.textContent = "输入你的需求： 打开软件？ 搜索你的工作区？";
  incomingWrap.appendChild(incoming);

  feedRoot.append(outgoingWrap, incomingWrap);
  if (messages.length > 0 || sending) {
    feedRoot.innerHTML = "";
    for (const message of messages) {
      renderChatMessage(
        feedRoot,
        message,
        onOpenDocument,
        drawerState.kind === "document" ? drawerState.document : undefined,
      );
    }
    if (sending && messages.length === 0) {
      renderChatMessage(feedRoot, {
        id: "pending",
        role: "assistant",
        text: ASSISTANT_PLACEHOLDER,
      });
    }
  }

  const tools: Array<{ name: WorkspaceIconName; label: string }> = [
    { name: "paperclip", label: "添加素材" },
    { name: "sparkles", label: "导入skill" },
    { name: "plug-zap", label: "连接工具" },
    { name: "history", label: "历史对话" },
    { name: "list-todo", label: "查看任务" },
  ];
  for (const tool of tools) {
    const isToolsButton = tool.name === "plug-zap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-tool-button";
    if (isToolsButton && drawerState.kind === "tools") button.classList.add("is-active");
    button.setAttribute("aria-label", tool.label);
    if (isToolsButton) {
      button.setAttribute("aria-controls", "workspace-chat-resources");
      button.setAttribute("aria-expanded", String(drawerState.kind === "tools"));
      button.addEventListener("click", onToggleTools);
    }
    button.title = tool.label;
    button.appendChild(createWorkspaceIcon(tool.name, "workspace-inline-icon workspace-icon-tool"));
    toolbarRoot.appendChild(button);
  }

  renderChatDrawer(resourcesRoot, drawerState, onCloseDrawer);
}


export async function initPreviewView(_root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  const closeButton = document.getElementById("workspace-close");
  const searchInput = document.getElementById("workspace-search-input") as HTMLInputElement | null;
  const navAssets = document.getElementById("workspace-nav-assets");
  const navNotebook = document.getElementById("workspace-nav-notebook");
  const navChat = document.getElementById("workspace-nav-chat");
  const navSettings = document.getElementById("workspace-nav-settings");
  const pageAssets = document.getElementById("workspace-page-assets");
  const pageNotebook = document.getElementById("workspace-page-notebook");
  const pageChat = document.getElementById("workspace-page-chat");
  const pageSettings = document.getElementById("workspace-page-settings");
  const assetsFiltersRoot = document.getElementById("workspace-assets-filters");
  const assetsCount = document.getElementById("workspace-assets-count");
  const assetsGrid = document.getElementById("workspace-assets-grid");
  const assetsDetail = document.getElementById("workspace-assets-detail");
  const notebookCount = document.getElementById("workspace-notebook-count");
  const notebookList = document.getElementById("workspace-notebook-list");
  const notebookDetail = document.getElementById("workspace-notebook-detail");
  const notebookNew = document.getElementById("workspace-notebook-new");
  const notebookManage = document.getElementById("workspace-notebook-manage");
  const chatFeed = document.getElementById("workspace-chat-feed");
  const chatToolbar = document.getElementById("workspace-chat-toolbar");
  const chatResources = document.getElementById("workspace-chat-resources");
  const chatInput = document.getElementById("workspace-chat-input") as HTMLTextAreaElement | null;
  const chatSubmit = document.getElementById("workspace-chat-submit");

  let history: ClipboardHistoryItem[] = [];
  let activePage: WorkspacePage = "assets";
  let searchQuery = "";
  let activeAssetFilter: AssetFilter = "all";
  let selectedAssetId: number | undefined;
  let selectedNoteId: number | undefined;
  let notebookManageMode = false;
  let chatDrawerState: ChatDrawerState = { kind: "closed" };
  let chatDraft = "";
  let chatSending = false;
  let chatMessages: ChatMessage[] = [];
  const executingDesktopActions = new Set<string>();
  let transientAsset: PanelContentPayload | undefined;
  let transientNote: PanelContentPayload | undefined;
  let notebookEditor:
    | { id: number | null; isEditing: boolean; title: string; text: string; creating?: boolean }
    | undefined;
  let assetTranslation: AssetTranslationState | undefined;
  const inflightSync = new Set<number>();
  const pendingTextUploadKey = "pending_text_upload_ids";

  const loadPendingTextIds = (): number[] => {
    try {
      const raw = localStorage.getItem(pendingTextUploadKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    } catch {
      return [];
    }
  };

  const savePendingTextIds = (ids: number[]) => {
    localStorage.setItem(pendingTextUploadKey, JSON.stringify(ids));
  };

  const formatTextBatchFileName = () => {
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, "0");
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}_note.txt`;
  };

  const buildBatchText = (items: ClipboardHistoryItem[]) => {
    const lines: string[] = [];
    for (const item of items) {
      lines.push(`===== id=${item.id} kind=${item.kind} created_at=${formatTime(item.created_at_ms)} =====`);
      lines.push(item.value ?? "");
      lines.push("");
    }
    return lines.join("\n");
  };

  const flushTextUploadQueue = async () => {
    const authState = authStore.getState();
    if (!authState.onlineMode || !authState.isLoggedIn) return;

    let batchSize = 50;
    try {
      batchSize = await invoke<number>("get_text_upload_batch_size");
    } catch {}

    let ids = loadPendingTextIds();
    if (ids.length < batchSize) return;

    // 只处理前 batchSize 条，避免一次上传过大；剩余的下一轮再处理
    const current = ids.slice(0, batchSize);
    const rest = ids.slice(batchSize);

    const items = current
      .map((id) => history.find((candidate) => candidate.id === id))
      .filter((value): value is ClipboardHistoryItem => Boolean(value));

    if (items.length === 0) {
      savePendingTextIds(rest);
      return;
    }

    try {
      const response = await apiClient.textUpload({
        text: buildBatchText(items),
        file_name: formatTextBatchFileName(),
      });
      const fileId = (response as { file_id?: string }).file_id ?? null;
      for (const item of items) {
        await invoke("update_history_upload_state", {
          id: item.id,
          uploadState: "uploaded",
          remoteFileId: fileId,
          overview: null,
          extractedText: null,
        });
      }
      savePendingTextIds(rest);
    } catch (error) {
      console.error("[text_upload] failed", error);
      // 失败：把这一批标记为 failed，并从队列里移除，允许用户重试
      for (const item of items) {
        await invoke("update_history_upload_state", {
          id: item.id,
          uploadState: "failed",
          remoteFileId: null,
          overview: null,
          extractedText: null,
        }).catch(() => {});
      }
      savePendingTextIds(rest);
    }

    // 如果剩余仍满足阈值，继续 flush
    if (loadPendingTextIds().length >= batchSize) {
      await flushTextUploadQueue();
    }
  };

  const blobFromDataUrl = (dataUrl: string): { blob: Blob; mimeType: string; fileName: string } | null => {
    const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
    if (!match) return null;
    const mimeType = match[1] || "application/octet-stream";
    const base64 = match[2] || "";
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return { blob: new Blob([bytes], { type: mimeType }), mimeType, fileName: "file" };
  };

  const syncHistoryItem = async (item: ClipboardHistoryItem): Promise<void> => {
    if (!item.id) return;
    const authState = authStore.getState();
    if (!authState.onlineMode || !authState.isLoggedIn) return;
    const state = normalizedUploadState(item);
    if (state === "uploaded" || state === "uploading") return;
    if (inflightSync.has(item.id)) return;
    inflightSync.add(item.id);
    try {
      // 文本类型素材：不逐条上传。先加入待上传队列，达到阈值后合并上传。
      if (item.kind !== "image" && item.kind !== "file") {
        await invoke("update_history_upload_state", {
          id: item.id,
          uploadState: "uploading",
          remoteFileId: null,
          overview: null,
          extractedText: null,
        });
        const ids = loadPendingTextIds();
        if (!ids.includes(item.id)) {
          ids.push(item.id);
          savePendingTextIds(ids);
        }
        await flushTextUploadQueue();
        return;
      }

      await invoke("update_history_upload_state", {
        id: item.id,
        uploadState: "uploading",
        remoteFileId: null,
        overview: null,
        extractedText: null,
      });

      let blob: Blob;
      let fileName: string;
      let mimeType: string | null = null;
      if (item.kind === "image" || item.kind === "file") {
        const dataUrl = await invoke<string | null>("read_file_data_url", { value: item.value });
        if (!dataUrl) throw new Error("读取文件失败");
        const parsed = blobFromDataUrl(dataUrl);
        if (!parsed) throw new Error("文件格式解析失败");
        blob = parsed.blob;
        mimeType = parsed.mimeType;
        fileName = basenameOf(item.value) || "file";
      } else {
        blob = new Blob([item.value], { type: "text/plain" });
        fileName = item.kind === "note" ? `note-${item.id}.txt` : `text-${item.id}.txt`;
        mimeType = "text/plain";
      }

      const result = await apiClient.fileReader(blob, fileName, mimeType, { aiSummary: true });
      await invoke("update_history_upload_state", {
        id: item.id,
        uploadState: "uploaded",
        remoteFileId: result.file_id ?? null,
        overview: result.summary ?? "",
        extractedText: result.text ?? "",
      });
    } catch (error) {
      console.error("[sync] failed", error);
      await invoke("update_history_upload_state", {
        id: item.id,
        uploadState: "failed",
        remoteFileId: null,
        overview: null,
        extractedText: null,
      }).catch(() => {});
    } finally {
      inflightSync.delete(item.id);
    }
  };

  const syncById = (id: number) => {
    const target = history.find((candidate) => candidate.id === id);
    if (!target) return;
    void syncHistoryItem(target);
  };

  const upsertChatAssistantMessage = (
    threadId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    const index = chatMessages.findIndex(
      (message) => message.id === threadId && message.role === "assistant",
    );
    const baseMessage: ChatMessage =
      index >= 0
        ? chatMessages[index]
        : {
            id: threadId,
            role: "assistant",
            text: "",
          };
    const nextMessage = updater(baseMessage);
    if (index >= 0) {
      chatMessages = [...chatMessages.slice(0, index), nextMessage, ...chatMessages.slice(index + 1)];
    } else {
      chatMessages = [...chatMessages, nextMessage];
    }
  };

  const upsertChatAssistantAction = (threadId: string, action: DesktopActionRead) => {
    upsertChatAssistantMessage(threadId, (message) => ({
      ...message,
      actions: mergeDesktopActions(message.actions, [action]),
    }));
  };

  const upsertChatAssistantDocument = (threadId: string, document: DesktopAgentDocumentEvent) => {
    upsertChatAssistantMessage(threadId, (message) => ({
      ...message,
      documents: mergeDesktopDocuments(message.documents, [document]),
      text: message.text || "",
    }));
  };

  const updateChatAssistantText = (
    threadId: string,
    text: string,
    mode: "replace" | "append" = "replace",
    error = false,
  ) => {
    upsertChatAssistantMessage(threadId, (message) => {
      const baseText = message.text === ASSISTANT_PLACEHOLDER ? "" : message.text;
      return {
        ...message,
        text: mode === "append" ? baseText + text : text,
        error,
      };
    });
  };
  const updateChatAssistantAction = (
    threadId: string,
    actionId: string,
    updater: (action: DesktopActionRead) => DesktopActionRead,
  ) => {
    upsertChatAssistantMessage(threadId, (message) => {
      if (!message.actions?.length) return message;
      const actions = message.actions.map((action) =>
        action.action_id === actionId ? updater(action) : action,
      );
      return {
        ...message,
        actions: mergeDesktopActions(actions, []),
      };
    });
  };

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      if (chatFeed instanceof HTMLElement) {
        chatFeed.scrollTop = chatFeed.scrollHeight;
      }
    });
  };

  const reportDesktopActionOutcome = async (
    action: DesktopActionRead,
    outcome: { status: "success" | "error" | "cancelled"; data?: Record<string, unknown>; error_message?: string },
  ) => {
    try {
      const reported = await apiClient.reportDesktopActionResult(action.action_id, {
        status: outcome.status,
        data: outcome.data,
        error_message: outcome.error_message ?? null,
      });
      if (reported.thread_id === action.thread_id) {
        updateChatAssistantAction(action.thread_id, action.action_id, () => reported);
        render();
        scrollChatToBottom();
      }
    } catch (error) {
      console.warn("[desktop_action] failed to report result", error);
    }
  };

  const handleDesktopAction = async (action: DesktopActionRead) => {
    if (action.status !== "proposed" && action.status !== "approved") {
      return;
    }
    if (executingDesktopActions.has(action.action_id)) return;
    executingDesktopActions.add(action.action_id);

    const confirmRequired = action.requires_confirmation;
    if (confirmRequired) {
      const label = action.display_text || action.reason || action.tool_name;
      const confirmed = globalThis.confirm
        ? globalThis.confirm(`Execute this action?\n\n${label}`)
        : true;
      if (!confirmed) {
        updateChatAssistantAction(action.thread_id, action.action_id, (current) => ({
          ...current,
          status: "cancelled",
          error_message: "Cancelled by user.",
        }));
        render();
        scrollChatToBottom();
        await reportDesktopActionOutcome(action, {
          status: "cancelled",
          error_message: "Cancelled by user.",
        });
        return;
      }
    }

    updateChatAssistantAction(action.thread_id, action.action_id, (current) => ({
      ...current,
      status: "approved",
      error_message: null,
    }));
    render();
    scrollChatToBottom();

    const outcome = await executeDesktopAction(action);
    updateChatAssistantAction(action.thread_id, action.action_id, (current) => ({
      ...current,
      status: outcome.status,
      result_data: outcome.data ?? null,
      error_message: outcome.error_message ?? null,
    }));
    render();
    scrollChatToBottom();
    await reportDesktopActionOutcome(action, outcome);
  };

  const submitChat = async () => {
    const inputText = chatDraft.trim();
    if (!inputText || chatSending) return;
    const threadId = createDesktopThreadId();
    const assistantMessageId = threadId;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: inputText,
    };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: ASSISTANT_PLACEHOLDER,
    };
    chatMessages = [...chatMessages, userMessage, assistantMessage];
    chatDraft = "";
    chatSending = true;
    if (chatInput) chatInput.value = "";
    render();
    scrollChatToBottom();

    try {
      const response = await apiClient.streamDesktopAgent(
        {
          thread_id: threadId,
          input_text: inputText,
          client: createDesktopClientContext(),
        },
        {
          onAssistantMessage: (event) => {
            if (event.thread_id !== threadId) return;
            updateChatAssistantText(threadId, event.text || "");
            render();
            scrollChatToBottom();
          },
          onAssistantDelta: (event) => {
            if (event.thread_id !== threadId) return;
            updateChatAssistantText(threadId, event.text || "", "append");
            render();
            scrollChatToBottom();
          },
          onDocument: (event) => {
            if (event.thread_id && event.thread_id !== threadId) return;
            upsertChatAssistantDocument(threadId, event);
            render();
            scrollChatToBottom();
          },
          onActionProposed: (action) => {
            if (action.thread_id !== threadId) return;
            upsertChatAssistantAction(threadId, action);
            upsertChatAssistantMessage(threadId, (message) => ({
              ...message,
              text: message.text || action.display_text || action.reason,
            }));
            render();
            scrollChatToBottom();
            void handleDesktopAction(action);
          },
          onAgentError: (event) => {
            if (event.thread_id !== threadId) return;
            chatSending = false;
            updateChatAssistantText(threadId, event.message || ASSISTANT_PLACEHOLDER, "replace", true);
            render();
            scrollChatToBottom();
          },
          onDone: (event) => {
            if (event.thread_id !== threadId) return;
            chatSending = false;
            render();
            scrollChatToBottom();
          },
        },
      );
      if (response !== null) {
        const actions = collectDesktopActions(response);
        const documents = collectDesktopDocuments(response);
        upsertChatAssistantMessage(threadId, (message) => ({
          ...message,
          text: responseText(response),
          actions: actions.length > 0 ? mergeDesktopActions(message.actions, actions) : message.actions,
          documents: documents.length > 0 ? mergeDesktopDocuments(message.documents, documents) : message.documents,
          error: false,
        }));
        for (const action of actions) {
          void handleDesktopAction(action);
        }
      }
    } catch (error) {
      upsertChatAssistantMessage(threadId, (message) => ({
        ...message,
        text: error instanceof Error ? error.message : String(error),
        error: true,
      }));
    } finally {
      chatSending = false;
      render();
      scrollChatToBottom();
    }
  };

  const currentAssets = () => filteredAssets(history, activeAssetFilter, searchQuery);
  const currentNotes = () => filteredNotes(history, searchQuery);
  const selectedAssetItem = () => history.find((item) => item.id === selectedAssetId && item.kind !== "note");
  const selectedNoteItem = () => history.find((item) => item.id === selectedNoteId && item.kind === "note");

  const setPage = (page: WorkspacePage) => {
    activePage = page;
    pageAssets?.toggleAttribute("hidden", page !== "assets");
    pageNotebook?.toggleAttribute("hidden", page !== "notebook");
    pageChat?.toggleAttribute("hidden", page !== "chat");
    pageSettings?.toggleAttribute("hidden", page !== "settings");
    navAssets?.classList.toggle("is-active", page === "assets");
    navNotebook?.classList.toggle("is-active", page === "notebook");
    navChat?.classList.toggle("is-active", page === "chat");
    navSettings?.classList.toggle("is-active", page === "settings");
    if (searchInput) {
      searchInput.placeholder = workspacePlaceholder(page);
      searchInput.value = searchQuery;
    }
  };

  const selectAsset = (item: ClipboardHistoryItem) => {
    selectedAssetId = item.id;
    transientAsset = undefined;
    safeStore(LAST_ASSET_KEY, String(item.id));
    setPage("assets");
    render();
  };

  const selectNote = (item: ClipboardHistoryItem) => {
    selectedNoteId = item.id;
    transientNote = undefined;
    safeStore(LAST_NOTE_KEY, String(item.id));
    if (notebookEditor && notebookEditor.id !== item.id) {
      notebookEditor = undefined;
    }
    setPage("notebook");
    render();
  };

  const selectDefault = () => {
    const assetId = Number(safeRead(LAST_ASSET_KEY) || "");
    const noteId = Number(safeRead(LAST_NOTE_KEY) || "");
    const assets = assetItems(history);
    const notes = notebookItems(history);
    const rememberedAsset = assets.find((item) => item.id === assetId);
    const rememberedNote = notes.find((item) => item.id === noteId);
    selectedAssetId = rememberedAsset?.id ?? assets[0]?.id;
    selectedNoteId = rememberedNote?.id ?? notes[0]?.id;
    if (selectedAssetId !== undefined) {
      activePage = "assets";
    } else if (selectedNoteId !== undefined) {
      activePage = "notebook";
    } else {
      activePage = "chat";
    }
  };

  const renderAssetsPage = () => {
    if (!(assetsGrid instanceof HTMLElement) || !(assetsDetail instanceof HTMLElement)) return;
    if (assetsFiltersRoot instanceof HTMLElement) {
      renderAssetFilters(assetsFiltersRoot, activeAssetFilter, (filter) => {
        activeAssetFilter = filter;
        render();
      });
    }

    const items = currentAssets();
    if (assetsCount) {
      assetsCount.textContent = `${items.length} 个素材`;
    }

    if (!items.find((item) => item.id === selectedAssetId)) {
      selectedAssetId = items[0]?.id;
    }
    renderAssetGrid(assetsGrid, items, selectedAssetId, selectAsset);
    const selection = selectedAssetItem()
      ? assetSelectionFromItem(selectedAssetItem()!)
      : transientAsset
        ? assetSelectionFromPayload(transientAsset)
        : undefined;
    const activeTranslation =
      selection && assetTranslation?.key === assetTranslationKey(selection) ? assetTranslation : undefined;
    const translate =
      selection && (selection.kind === "text" || selection.kind === "web")
        ? () => {
            const source = (selection.content ?? "").trim();
            if (!source) return;
            const key = assetTranslationKey(selection);
            assetTranslation = { key, source, status: "loading" };
            render();
            void apiClient
              .translateText({ text: source })
              .then((result) => {
                if (assetTranslation?.key !== key) return;
                assetTranslation = {
                  key,
                  source,
                  status: "success",
                  translatedText: result.translated_text ?? "",
                };
                render();
              })
              .catch((error: unknown) => {
                if (assetTranslation?.key !== key) return;
                assetTranslation = {
                  key,
                  source,
                  status: "error",
                  error: `翻译失败：${error instanceof Error ? error.message : String(error)}`,
                };
                render();
              });
          }
        : undefined;
    renderAssetDetail(
      assetsDetail,
      selection,
      selection?.id
        ? () => invoke("toggle_pin_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      selection?.id
        ? () => invoke("copy_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      selection?.id
        ? () => invoke("delete_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      activeTranslation,
      translate,
      selection?.id ? () => syncById(selection.id!) : undefined,
    );
  };

  const renderNotebookPage = () => {
    if (!(notebookList instanceof HTMLElement) || !(notebookDetail instanceof HTMLElement)) return;
    notebookManage?.classList.toggle("is-active", notebookManageMode);
    const items = currentNotes();
    if (notebookCount) notebookCount.textContent = `${items.length} 条便签`;
    // 新建便签（尚未落库）阶段：不要自动回选列表第一条，否则看起来“+ 没反应”
    if (notebookEditor?.id === null) {
      selectedNoteId = undefined;
    } else if (!items.find((item) => item.id === selectedNoteId)) {
      selectedNoteId = items[0]?.id;
    }
    renderNotebookList(
      notebookList,
      items,
      selectedNoteId,
      notebookManageMode,
      selectNote,
      (item) => invoke("toggle_pin_clipboard_history_item", { id: item.id }).catch(() => {}),
      (item) => {
        removeNotebookFromOrder(item.id);
        invoke("delete_clipboard_history_item", { id: item.id }).catch(() => {});
      },
    );
    const selection = selectedNoteItem()
      ? noteSelectionFromItem(selectedNoteItem()!)
      : transientNote
        ? noteSelectionFromPayload(transientNote)
        : undefined;

    // 获取所有资源（从history中提取所有素材）
    const allMaterials: SavedResourceSummary[] = [];
    for (const item of history) {
      if (item.kind !== "note") {
        // 从素材项中提取资源
        const resource = item.resources?.[0];
        if (resource) {
          const summary: SavedResourceSummary = {
            id: item.id, // 添加 item id
            kind: resource.kind,
            name: resource.name,
            summary: resource.summary || resource.extracted_text || "无描述",
            size: resource.size_bytes ? formatBytes(resource.size_bytes) : undefined,
          };
          if (!allMaterials.find((m) => m.id === summary.id)) {
            allMaterials.push(summary);
          }
        }
      }
    }

    renderNotebookDetail(
      notebookDetail,
      selection,
      selection?.id
        ? () => invoke("toggle_pin_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      selection?.id
        ? () => invoke("copy_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      selection?.id
        ? () => invoke("delete_clipboard_history_item", { id: selection.id }).catch(() => {})
        : undefined,
      selection?.id ? () => syncById(selection.id!) : undefined,
      selection
        ? (title: string, text: string) => {
            const hasAny = Boolean(title.trim() || text.trim());
            // 没有任何输入内容，不创建（也不保存）
            if (!hasAny) return;

            if (selection.id) {
              // 直接保存正文，不再附加资源JSON
              invoke("update_clipboard_history_item", {
                id: selection.id,
                value: text,
                preview: title || text.split(/\r?\n/)[0] || "无标题",
              }).catch(() => {});
              return;
            }

            // 新建便签：首次有内容时才落库，避免空便签污染列表
            if (notebookEditor?.creating) return;
            notebookEditor = {
              id: null,
              isEditing: true,
              title,
              text,
              creating: true,
            };
            invoke<number | null>("create_note_history_item", { title, value: text })
              .then((id) => {
                if (!id) {
                  if (notebookEditor && notebookEditor.id === null) {
                    notebookEditor.creating = false;
                  }
                  return;
                }
                selectedNoteId = id;
                transientNote = undefined;
                notebookEditor = { id, isEditing: true, title, text };
                setPage("notebook");
                render();
              })
              .catch(() => {
                if (notebookEditor && notebookEditor.id === null) {
                  notebookEditor.creating = false;
                }
              });
          }
        : undefined,
      allMaterials,
      selection?.id && notebookEditor?.id === selection.id
        ? notebookEditor
        : !selection?.id && notebookEditor?.id === null
          ? notebookEditor
          : undefined,
      (next) => {
        if (selection?.id) {
          if (next.isEditing) {
            notebookEditor = { id: selection.id, ...next };
          } else {
            notebookEditor = undefined;
          }
          return;
        }
        // 新建便签（尚未落库）阶段也要保留编辑态缓存
        if (next.isEditing) {
          notebookEditor = {
            id: null,
            creating: notebookEditor?.creating,
            ...next,
          };
        } else {
          notebookEditor = undefined;
        }
      },
    );
  };

  const renderChatPage = () => {
    if (
      chatFeed instanceof HTMLElement &&
      chatToolbar instanceof HTMLElement &&
      chatResources instanceof HTMLElement
    ) {
      renderStaticChat(
        chatFeed,
        chatToolbar,
        chatResources,
        chatMessages,
        chatSending,
        chatDrawerState,
        () => {
          chatDrawerState =
            chatDrawerState.kind === "tools" ? { kind: "closed" } : { kind: "tools" };
          render();
        },
        (document, citationIndex) => {
          chatDrawerState = { kind: "document", document, citationIndex };
          render();
        },
        () => {
          chatDrawerState = { kind: "closed" };
          render();
        },
      );
    }
    if (chatInput instanceof HTMLTextAreaElement && chatInput.value !== chatDraft) {
      chatInput.value = chatDraft;
    }
    if (chatSubmit instanceof HTMLButtonElement) {
      chatSubmit.disabled = chatSending || !chatDraft.trim();
      chatSubmit.classList.toggle("is-loading", chatSending);
    }
  };

  const render = () => {
    setPage(activePage);
    renderAssetsPage();
    renderNotebookPage();
    renderChatPage();
  };

  await invoke("log_debug", {
    message: `[workspace init] label=${appWindow.label}`,
  }).catch(() => {});

  history = await invoke<ClipboardHistoryItem[]>("get_clipboard_history").catch(() => []);
  selectDefault();
  if (pageSettings instanceof HTMLElement) {
    initWorkspaceSettingsPage(pageSettings);
  }
  render();

  closeButton?.addEventListener("click", () => {
    invoke("close_preview").catch(() => {});
  });
  navAssets?.addEventListener("click", () => {
    setPage("assets");
    render();
  });
  navNotebook?.addEventListener("click", () => {
    setPage("notebook");
    render();
  });
  navChat?.addEventListener("click", () => {
    setPage("chat");
    render();
  });
  navSettings?.addEventListener("click", () => {
    setPage("settings");
    render();
  });
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    render();
  });
  chatInput?.addEventListener("input", () => {
    chatDraft = chatInput.value;
    if (chatSubmit instanceof HTMLButtonElement) {
      chatSubmit.disabled = chatSending || !chatDraft.trim();
    }
  });
  chatInput?.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !(event as KeyboardEvent).isComposing
    ) {
      event.preventDefault();
      void submitChat();
    }
  });
  chatSubmit?.addEventListener("click", () => {
    void submitChat();
  });
  notebookNew?.addEventListener("click", () => {
    // 新建便签：先进入编辑态；只有真的输入内容后才会落库并出现在列表
    selectedNoteId = undefined;
    transientNote = { kind: "note", value: "" };
    notebookEditor = { id: null, isEditing: true, title: "", text: "" };
    setPage("notebook");
    render();
  });
  notebookManage?.addEventListener("click", () => {
    notebookManageMode = !notebookManageMode;
    render();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      invoke("close_preview").catch(() => {});
    }
  });

  await appWindow.listen<PanelContentPayload>("preview-content", (event) => {
    const payload = event.payload;
    if (payload.kind === "note") {
      const target = history.find((item) => item.id === payload.id && item.kind === "note");
      if (target) {
        selectNote(target);
      } else {
        selectedNoteId = undefined;
        transientNote = payload;
        setPage("notebook");
        render();
      }
      return;
    }
    const target = history.find((item) => item.id === payload.id && item.kind !== "note");
    if (target) {
      selectAsset(target);
    } else {
      selectedAssetId = undefined;
      transientAsset = payload;
      setPage("assets");
      render();
    }
  });

  await appWindow.listen<ClipboardHistoryItem>("history-appended", (event) => {
    history = [...history, event.payload];
    if (event.payload.kind === "note" && selectedNoteId === undefined) {
      selectedNoteId = event.payload.id;
    }
    if (event.payload.kind === "note" && notebookEditor?.id === null) {
      notebookEditor = { ...notebookEditor, id: event.payload.id, creating: false };
      transientNote = undefined;
    }
    if (event.payload.kind !== "note" && selectedAssetId === undefined) {
      selectedAssetId = event.payload.id;
    }
    // 自动同步：仅在用户开启开关且处于在线登录状态时触发
    void invoke<boolean>("get_auto_sync")
      .then((enabled) => {
        if (!enabled) return;
        void syncHistoryItem(event.payload);
      })
      .catch(() => {});
    render();
  });

  // 重新登录或 token 刷新后，尝试把已积累的文本队列继续 flush（如果达到阈值）
  window.addEventListener("auth-refreshed", () => {
    void flushTextUploadQueue();
  });

  await appWindow.listen("history-cleared", () => {
    history = [];
    selectedAssetId = undefined;
    selectedNoteId = undefined;
    transientAsset = undefined;
    transientNote = undefined;
    writeNotebookOrder([]);
    render();
  });

  await appWindow.listen<number>("history-deleted", (event) => {
    history = history.filter((item) => item.id !== event.payload);
    removeNotebookFromOrder(event.payload);
    if (selectedAssetId === event.payload) selectedAssetId = undefined;
    if (selectedNoteId === event.payload) selectedNoteId = undefined;
    render();
  });

  await appWindow.listen<ClipboardHistoryItem>("history-pin-toggled", (event) => {
    history = history.map((item) => (item.id === event.payload.id ? event.payload : item));
    render();
  });

  await appWindow.listen<ClipboardHistoryItem>("history-updated", (event) => {
    history = history.map((item) => (item.id === event.payload.id ? event.payload : item));
    // 自动保存会触发 history-updated；编辑当前便签时避免重绘详情（会导致退出编辑态/丢光标）
    if (
      notebookEditor?.isEditing &&
      event.payload.kind === "note" &&
      notebookEditor.id === event.payload.id
    ) {
      if (notebookCount) {
        const items = currentNotes();
        notebookCount.textContent = `${items.length} 条便签`;
      }
      if (notebookList instanceof HTMLElement) {
        renderNotebookList(
          notebookList,
          currentNotes(),
          selectedNoteId,
          notebookManageMode,
          selectNote,
          (item) => invoke("toggle_pin_clipboard_history_item", { id: item.id }).catch(() => {}),
          (item) => {
            removeNotebookFromOrder(item.id);
            invoke("delete_clipboard_history_item", { id: item.id }).catch(() => {});
          },
        );
      }
      return;
    }
    render();
  });
}




