import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveImageSrc } from "./media";

type PanelKind = "image" | "text" | "web";

interface PanelContentPayload {
  id?: number;
  kind: PanelKind;
  value: string;
}

function kindFromLabel(label: string): PanelKind {
  if (label === "panel-img") return "image";
  if (label === "panel-web") return "web";
  return "text";
}

function fitTextToContainer(text: HTMLElement, container: HTMLElement, minPx: number, maxPx: number) {
  let low = minPx;
  let high = maxPx;
  let best = minPx;

  const fits = (px: number) => {
    text.style.fontSize = `${px}px`;
    return (
      text.scrollHeight <= container.clientHeight + 1 &&
      text.scrollWidth <= container.clientWidth + 1
    );
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  text.style.fontSize = `${best}px`;
}

function renderContent(root: HTMLElement, kind: PanelKind, value: string): void {
  root.innerHTML = "";
  if (kind === "web") {
    renderInputPanel(root);
    return;
  }
  if (!value) return;
  if (kind === "image") {
    const img = document.createElement("img");
    img.className = "panel-image panel-clickable";
    void resolveImageSrc(value).then((src) => {
      img.src = src;
    });
    img.addEventListener("click", () => {
      invoke("open_preview", { id: payloadId(root), kind: "image", value }).catch((err) =>
        console.error("[panelView] open_preview failed", err),
      );
    });
    root.appendChild(img);
    return;
  }

  const text = document.createElement("p");
  text.className = "panel-text panel-clickable";
  text.textContent = value;
  text.addEventListener("click", () => {
    invoke("open_preview", { id: payloadId(root), kind, value }).catch((err) =>
      console.error("[panelView] open_preview failed", err),
    );
  });
  root.appendChild(text);
  requestAnimationFrame(() => {
    fitTextToContainer(text, root, 12, 20);
  });
}

function renderInputPanel(root: HTMLElement): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "panel-input-wrap";

  const box = document.createElement("div");
  box.className = "panel-input-box";

  const textarea = document.createElement("textarea");
  textarea.className = "panel-input";
  textarea.placeholder = "输入内容后加入存储";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "panel-input-submit";
  submit.textContent = "↩︎";

  const submitValue = () => {
    const value = textarea.value.trim();
    if (!value) return;
    invoke<number | null>("add_text_history_item", { value })
      .then(() => {
        textarea.value = "";
      })
      .catch((err) => console.error("[panelView] add_text_history_item failed", err));
  };

  submit.addEventListener("click", submitValue);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitValue();
    }
  });

  box.appendChild(textarea);
  box.appendChild(submit);
  wrap.appendChild(box);
  root.appendChild(wrap);
}

function payloadId(root: HTMLElement): number | undefined {
  const raw = root.dataset.historyId;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function initPanelView(root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  const kind = kindFromLabel(appWindow.label);
  const panelRoot = document.getElementById("panel-root");
  let currentId: number | undefined;
  let currentValue = "";

  const openCurrentPreview = () => {
    if (kind === "web" || !currentValue) return;
    invoke("open_preview", { id: currentId, kind, value: currentValue }).catch((err) =>
      console.error("[panelView] open_preview failed", err),
    );
  };

  await invoke("log_debug", {
    message: `[panel init] label=${appWindow.label} kind=${kind}`,
  }).catch((err) => console.error("[panelView] log_debug failed", err));

  if (kind === "web") {
    renderInputPanel(root);
  }

  const handleEdgeClick = (event: Event) => {
    if (event.target === root || event.target === panelRoot) {
      openCurrentPreview();
    }
  };

  root.addEventListener("click", handleEdgeClick);
  panelRoot?.addEventListener("click", handleEdgeClick);

  await appWindow.listen<PanelContentPayload>("panel-content", (event) => {
    void invoke("log_debug", {
      message: `[panel content] label=${appWindow.label} kind=${kind} payloadKind=${event.payload.kind} valueLength=${event.payload.value.length}`,
    }).catch((err) => console.error("[panelView] log_debug failed", err));
    if (kind === "web") return;
    currentId = event.payload.id;
    currentValue = event.payload.value;
    if (event.payload.id !== undefined) root.dataset.historyId = String(event.payload.id);
    else delete root.dataset.historyId;
    renderContent(root, kind, event.payload.value);
  });
}
