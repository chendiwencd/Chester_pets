import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clipboardFileFromEvent,
  importClipboardPayload,
  importFile,
  importPath,
} from "./materialImport";

type InputResourceKind = "file" | "text" | "image";

interface InputPanelPayload {
  kind: InputResourceKind;
  status?: "parsing" | "ready";
  name: string;
  size_bytes?: number | null;
  mime_type?: string | null;
  display_size: string;
  overview?: string;
  type_placeholder: string;
  preview: string;
  file_id?: string | null;
}

function normalizePayload(payload: Partial<InputPanelPayload>): InputPanelPayload | undefined {
  if (!payload?.name) return undefined;
  const kind = payload.kind === "image" || payload.kind === "text" ? payload.kind : "file";
  return {
    kind,
    status: payload.status === "parsing" ? "parsing" : "ready",
    name: payload.name,
    size_bytes: payload.size_bytes ?? null,
    mime_type: payload.mime_type ?? null,
    display_size: payload.display_size ?? "",
    overview: payload.overview ?? "",
    type_placeholder: payload.type_placeholder ?? "",
    preview: payload.preview ?? payload.name,
    file_id: payload.file_id ?? null,
  };
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

function renderResourceCapture(
  container: HTMLElement,
  resource: InputPanelPayload,
  onComplete: () => void,
): void {
  container.innerHTML = "";
  const isParsing = resource.status === "parsing";
  container.classList.toggle("is-parsing", isParsing);
  container.setAttribute("aria-busy", String(isParsing));

  const icon = document.createElement("div");
  icon.className = "panel-resource-capture-icon";
  icon.appendChild(createIcon(resource.kind));

  const details = document.createElement("div");
  details.className = "panel-resource-capture-details";

  const name = document.createElement("div");
  name.className = "panel-resource-capture-field";
  name.textContent = `文件名：${resource.name}`;
  name.title = name.textContent;

  const size = document.createElement("div");
  size.className = "panel-resource-capture-field";
  size.textContent = `文件大小：${resource.display_size || "0 B"}`;

  const type = document.createElement("div");
  type.className = "panel-resource-capture-field";
  type.textContent = `文件类型：${resource.mime_type || resource.kind}`;

  const overview = document.createElement("div");
  overview.className = "panel-resource-capture-field";
  overview.textContent = `概述：${isParsing ? "素材解析中" : resource.overview?.trim() || "暂无概述"}`;
  overview.title = overview.textContent;

  details.append(name, size, type, overview);

  if (isParsing) {
    const status = document.createElement("div");
    status.className = "panel-resource-capture-status";
    status.textContent = "正在读取文件并生成概述。";
    details.append(status);
    container.append(icon, details);
    return;
  }

  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "panel-resource-complete";
  complete.textContent = "完成";
  complete.title = "结束本次输入";
  complete.addEventListener("click", onComplete);

  container.append(icon, details, complete);
}

function renderInputPanel(
  root: HTMLElement,
  initialResource: InputPanelPayload | undefined,
  onResourceComplete: () => void,
): void {
  root.innerHTML = "";
  if (!initialResource) return;

  const wrap = document.createElement("div");
  wrap.className = "panel-input-wrap";

  const shell = document.createElement("div");
  shell.className = "panel-input-shell";

  const resourceView = document.createElement("div");
  resourceView.className = "panel-resource-capture";
  renderResourceCapture(resourceView, initialResource, onResourceComplete);

  shell.append(resourceView);
  wrap.append(shell);
  root.append(wrap);
}

export async function initPanelView(root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  let activeResource: InputPanelPayload | undefined;

  await invoke("log_debug", {
    message: `[panel init] label=${appWindow.label}`,
  }).catch((err) => console.error("[panelView] log_debug failed", err));

  const syncVisibility = () => {
    const action = activeResource ? appWindow.show() : appWindow.hide();
    void action.catch((err) => console.error("[panelView] visibility sync failed", err));
  };

  const rerender = () => {
    renderInputPanel(root, activeResource, () => {
      activeResource = undefined;
      void invoke("complete_file_explanation").catch((err) =>
        console.error("[panelView] complete_file_explanation failed", err),
      );
      rerender();
    });
    syncVisibility();
  };

  rerender();

  window.addEventListener(
    "paste",
    (event) => {
      event.preventDefault();
      const file = clipboardFileFromEvent(event);
      if (activeResource?.status === "parsing") return;
      if (file) {
        void importFile(file).catch((err) => console.error("[panelView] paste file import failed", err));
        return;
      }
      invoke<InputPanelPayload | null>("paste_clipboard_to_input_panel")
        .then(importClipboardPayload)
        .catch((err) => console.error("[panelView] paste_clipboard_to_input_panel failed", err));
    },
    true,
  );

  await appWindow.listen("input-panel-reset", () => {
    if (activeResource?.status === "parsing") return;
    activeResource = undefined;
    rerender();
  });

  await appWindow.listen<string>("file-dropped", (event) => {
    if (activeResource?.status === "parsing") return;
    void importPath(event.payload).catch((err) =>
      console.error("[panelView] native file import failed", err),
    );
  });

  await appWindow.listen<InputPanelPayload>("input-panel-content", (event) => {
    const normalized = normalizePayload(event.payload);
    if (!normalized) return;
    activeResource = normalized;
    rerender();
  });
}
