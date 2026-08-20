import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type InputResourceKind = "file" | "text" | "image";

interface InputPanelPayload {
  kind: InputResourceKind;
  name: string;
  size_bytes?: number | null;
  display_size: string;
  type_placeholder: string;
  preview: string;
}

interface ResourceEntry extends InputPanelPayload {
  id: string;
}

interface SavedResourceSummary {
  kind: "text" | "image";
  name: string;
  summary: string;
  size?: string;
}

const DRAFT_KEY = "desktop-shell.panel-web.draft";
const RESOURCE_KEY = "desktop-shell.panel-web.resources";
const LEGACY_RESOURCE_KEY = "desktop-shell.panel-web.resource";
const NOTE_RESOURCE_MARKER = "[[desktop-shell:resources:v1]]";
const PANEL_WINDOW_MIN_HEIGHT = 220;
const PANEL_WINDOW_MAX_HEIGHT = 560;
const PANEL_CONTENT_INSET_Y = 16;

function safeJsonParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(value: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, value);
  } catch {
    // ignore storage failures
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore storage failures
  }
}

function normalizePayload(payload: Partial<InputPanelPayload>): InputPanelPayload | undefined {
  if (!payload?.name) return undefined;
  const kind = payload.kind === "image" || payload.kind === "text" ? payload.kind : "file";
  return {
    kind,
    name: payload.name,
    size_bytes: payload.size_bytes ?? null,
    display_size: payload.display_size ?? "",
    type_placeholder: payload.type_placeholder ?? "",
    preview: payload.preview ?? payload.name,
  };
}

function loadResources(): ResourceEntry[] {
  try {
    const legacy = safeJsonParse<InputPanelPayload>(localStorage.getItem(LEGACY_RESOURCE_KEY));
    if (legacy) {
      localStorage.removeItem(LEGACY_RESOURCE_KEY);
      const normalized = normalizePayload(legacy);
      return normalized ? [{ id: makeId(), ...normalized }] : [];
    }

    const raw = localStorage.getItem(RESOURCE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ResourceEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const normalized = normalizePayload(entry);
        if (!normalized || typeof entry.id !== "string") return undefined;
        return { id: entry.id, ...normalized };
      })
      .filter((entry): entry is ResourceEntry => !!entry);
  } catch {
    return [];
  }
}

function saveResources(resources: ResourceEntry[]): void {
  try {
    localStorage.setItem(RESOURCE_KEY, JSON.stringify(resources));
  } catch {
    // ignore storage failures
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function svgElement(tag: string, attrs: Record<string, string>): SVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  return element;
}

function createIcon(kind: InputResourceKind): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("panel-resource-icon");

  if (kind === "image") {
    svg.appendChild(svgElement("rect", { x: "4", y: "5", width: "16", height: "14", rx: "2" }));
    svg.appendChild(svgElement("circle", { cx: "9", cy: "10", r: "1.5" }));
    svg.appendChild(svgElement("path", { d: "m7 16 4-4 3 3 2-2 2 3" }));
  } else {
    svg.appendChild(svgElement("path", { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" }));
    svg.appendChild(svgElement("path", { d: "M14 3v6h6" }));
    if (kind === "text") {
      svg.appendChild(svgElement("path", { d: "M8 13h8" }));
      svg.appendChild(svgElement("path", { d: "M8 17h5" }));
    } else {
      svg.appendChild(svgElement("path", { d: "M8 14h8" }));
    }
  }
  return svg;
}

function cssPx(element: Element, name: string, fallback: number): number {
  const value = window.getComputedStyle(element).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

let resizeTimer: number | undefined;

function resizeInputWindow(
  shell: HTMLElement,
  resourceList: HTMLElement,
  textarea: HTMLTextAreaElement,
  actions: HTMLElement,
): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const minInputHeight = cssPx(shell, "--panel-input-min-height", 140);
    const maxInputHeight = cssPx(shell, "--panel-input-max-height", 420);
    const shellPaddingY = cssPx(shell, "padding-top", 0) + cssPx(shell, "padding-bottom", 0);
    const shellGap = cssPx(shell, "row-gap", cssPx(shell, "gap", 0));
    const visibleGapCount = resourceList.hidden ? 1 : 2;
    const resourceHeight = resourceList.hidden ? 0 : resourceList.scrollHeight;
    const actionHeight = actions.scrollHeight || actions.getBoundingClientRect().height;

    textarea.style.height = "auto";
    const nextInputHeight = clamp(textarea.scrollHeight, minInputHeight, maxInputHeight);
    textarea.style.height = `${nextInputHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxInputHeight ? "auto" : "hidden";

    const screenLimit = Math.floor((window.screen.availHeight || PANEL_WINDOW_MAX_HEIGHT) * 0.72);
    const maxWindowHeight = Math.max(PANEL_WINDOW_MIN_HEIGHT, Math.min(PANEL_WINDOW_MAX_HEIGHT, screenLimit));
    const nextWindowHeight = clamp(
      PANEL_CONTENT_INSET_Y + shellPaddingY + resourceHeight + visibleGapCount * shellGap + nextInputHeight + actionHeight,
      PANEL_WINDOW_MIN_HEIGHT,
      maxWindowHeight,
    );

    invoke("resize_input_panel", { height: Math.round(nextWindowHeight) }).catch((err) =>
      console.error("[panelView] resize_input_panel failed", err),
    );
  }, 40);
}

function resourceTooltip(resource: ResourceEntry): string {
  const parts = [resource.name];
  if (resource.display_size) parts.push(resource.display_size);
  const detail = resourceDisplayValue(resource);
  if (detail && detail !== resource.name) parts.push(detail);
  return parts.join(" · ");
}

function previewValue(resource: ResourceEntry): { kind: "image" | "text"; value: string } {
  if (resource.kind === "image") {
    return { kind: "image", value: resource.preview || resource.name };
  }
  if (resource.kind === "text") {
    return { kind: "text", value: resource.preview || resource.name };
  }
  const value = [resource.name, resource.display_size, resource.type_placeholder, resource.preview]
    .filter(Boolean)
    .join("\n");
  return { kind: "text", value };
}

function resourceDisplayValue(resource: ResourceEntry): string {
  const preview = resource.preview || "";
  if (resource.kind === "file" || resource.kind === "image") {
    if (resource.type_placeholder) return resource.type_placeholder;
    if (preview && !preview.startsWith("data:")) return preview;
    return resource.name;
  }
  return resource.type_placeholder || preview || resource.name;
}

function fileLocation(file: File): string {
  const path = (file as File & { path?: string }).path?.trim();
  if (path) return path;
  return file.name || "未命名文件";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|jpe?g|png|svg|webp)$/i.test(file.name);
}

function readFileDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : undefined);
    });
    reader.addEventListener("error", () => resolve(undefined));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0 || value >= 10) {
    return `${Math.round(value)} ${units[unit]}`;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function resourceFromFile(file: File, preview?: string): InputPanelPayload {
  const location = fileLocation(file);
  return {
    kind: isImageFile(file) ? "image" : "file",
    name: file.name || "未命名文件",
    size_bytes: file.size,
    display_size: formatFileSize(file.size),
    type_placeholder: location,
    preview: preview || location,
  };
}

function openResourcePreview(resource: ResourceEntry): void {
  const payload = previewValue(resource);
  invoke("open_preview", { kind: payload.kind, value: payload.value }).catch((err) =>
    console.error("[panelView] open_preview failed", err),
  );
}

function removeResource(resources: ResourceEntry[], id: string): ResourceEntry[] {
  return resources.filter((item) => item.id !== id);
}

function resourceKindLabel(kind: InputResourceKind): string {
  if (kind === "image") return "图片";
  if (kind === "text") return "文本";
  return "文件";
}

function resourceOverview(resource: ResourceEntry): string {
  const lines = [
    `${resourceKindLabel(resource.kind)}：${resource.name}`,
    `名称：${resource.name}`,
    `描述：${resourceDisplayValue(resource)}`,
  ];
  if (resource.display_size) lines.push(`大小：${resource.display_size}`);
  return lines.join("\n");
}

function composeNoteValue(input: string, resources: ResourceEntry[]): string {
  const sections: string[] = [];
  const trimmed = input.trim();
  if (trimmed) sections.push(trimmed);
  if (resources.length > 0) {
    sections.push(["素材概览", ...resources.map(resourceOverview)].join("\n\n"));
  }
  return sections.join("\n\n").trim();
}

function savedResourceSummary(resource: ResourceEntry): SavedResourceSummary | undefined {
  if (resource.kind !== "text" && resource.kind !== "image") return undefined;
  const summary =
    resource.kind === "text"
      ? (resource.preview || resource.name).replace(/\s+/g, " ").slice(0, 120)
      : resourceDisplayValue(resource);
  return {
    kind: resource.kind,
    name: resource.name || resourceKindLabel(resource.kind),
    summary,
    size: resource.display_size || undefined,
  };
}

function composeSavedNoteValue(input: string, resources: ResourceEntry[]): string {
  if (false) return composeNoteValue(input, resources);
  const sections: string[] = [];
  const trimmed = input.trim();
  if (trimmed) sections.push(trimmed);
  const summaries = resources
    .map(savedResourceSummary)
    .filter((resource): resource is SavedResourceSummary => !!resource);
  if (summaries.length > 0) {
    sections.push(`${NOTE_RESOURCE_MARKER}\n${JSON.stringify(summaries)}`);
  }
  return sections.join("\n\n").trim();
}

function renderResources(container: HTMLElement, resources: ResourceEntry[], onRemove: (id: string) => void): void {
  container.innerHTML = "";
  if (resources.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  for (const resource of resources) {
    const item = document.createElement("div");
    item.className = `panel-resource-item panel-resource-item-${resource.kind}`;

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "panel-resource-preview";
    const tooltip = resourceTooltip(resource);
    previewButton.title = tooltip;
    previewButton.setAttribute("aria-label", tooltip);
    previewButton.appendChild(createIcon(resource.kind));
    previewButton.addEventListener("click", () => openResourcePreview(resource));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "panel-resource-remove";
    removeButton.title = "移除";
    removeButton.setAttribute("aria-label", "移除");
    removeButton.textContent = "×";
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove(resource.id);
    });

    item.appendChild(previewButton);
    item.appendChild(removeButton);
    container.appendChild(item);
  }
}

function renderInputPanel(
  root: HTMLElement,
  resources: ResourceEntry[],
  onResourcesChange: (resources: ResourceEntry[]) => void,
): void {
  const draft = loadDraft();
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "panel-input-wrap";

  const shell = document.createElement("div");
  shell.className = "panel-input-shell";

  const resourceList = document.createElement("div");
  resourceList.className = "panel-resource-list";

  const body = document.createElement("div");
  body.className = "panel-input-body";

  const actions = document.createElement("div");
  actions.className = "panel-input-actions";

  const textarea = document.createElement("textarea");
  textarea.className = "panel-input";
  textarea.placeholder = "输入内容";
  textarea.value = draft;

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "panel-input-submit";
  submit.title = "保存";
  submit.setAttribute("aria-label", "保存");
  submit.textContent = "↵";

  const submitValue = () => {
    const value = composeSavedNoteValue(textarea.value, resources);
    if (!value) return;
    invoke<number | null>("add_text_history_item", { value })
      .then(() => {
        textarea.value = "";
        clearDraft();
        rerenderResources([]);
        resizeInputWindow(shell, resourceList, textarea, actions);
      })
      .catch((err) => console.error("[panelView] add_text_history_item failed", err));
  };

  submit.addEventListener("click", submitValue);
  textarea.addEventListener("input", () => {
    saveDraft(textarea.value);
    resizeInputWindow(shell, resourceList, textarea, actions);
  });
  textarea.addEventListener("paste", (event) => {
    const transfer = event.clipboardData;
    if (!transfer) return;

    const files = Array.from(transfer.files);
    if (files.length > 0) {
      event.preventDefault();
      const imageFiles = files.filter(isImageFile);
      if (imageFiles.length === 0) return;
      void (async () => {
        const payloads = await Promise.all(
          imageFiles.map(async (file) => {
            const preview = await readFileDataUrl(file);
            return resourceFromFile(file, preview);
          }),
        );
        rerenderResources([
          ...resources,
          ...payloads.map((payload) => ({ id: makeId(), ...payload })),
        ]);
      })();
      return;
    }

    // 纯文本粘贴：不拦截，让浏览器原生粘贴到输入框，不添加到资源列表
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitValue();
    }
  });

  const rerenderResources = (nextResources: ResourceEntry[]) => {
    resources = nextResources;
    onResourcesChange(resources);
    renderResources(resourceList, resources, (id) => rerenderResources(removeResource(resources, id)));
    resizeInputWindow(shell, resourceList, textarea, actions);
  };

  renderResources(resourceList, resources, (id) => rerenderResources(removeResource(resources, id)));

  body.appendChild(textarea);
  actions.appendChild(submit);
  shell.appendChild(resourceList);
  shell.appendChild(body);
  shell.appendChild(actions);
  wrap.appendChild(shell);
  root.appendChild(wrap);

  requestAnimationFrame(() => resizeInputWindow(shell, resourceList, textarea, actions));
}

export async function initPanelView(root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  let resources = loadResources();

  await invoke("log_debug", {
    message: `[panel init] label=${appWindow.label}`,
  }).catch((err) => console.error("[panelView] log_debug failed", err));

  const setResources = (nextResources: ResourceEntry[]) => {
    resources = nextResources;
    saveResources(resources);
  };
  const rerender = () => renderInputPanel(root, resources, setResources);
  rerender();

  window.addEventListener(
    "keydown",
    (event) => {
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
      if (!isPaste || event.shiftKey || event.altKey || event.repeat) return;

      // 如果输入框聚焦，允许原生粘贴行为（不拦截）
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement) {
        return;
      }

      event.preventDefault();
      invoke<InputPanelPayload | null>("paste_clipboard_to_input_panel").catch((err) =>
        console.error("[panelView] paste_clipboard_to_input_panel failed", err),
      );
    },
    true,
  );

  await appWindow.listen<InputPanelPayload>("input-panel-content", (event) => {
    const normalized = normalizePayload(event.payload);
    if (!normalized) return;
    resources = [...resources, { id: makeId(), ...normalized }];
    saveResources(resources);
    rerender();
  });
}
