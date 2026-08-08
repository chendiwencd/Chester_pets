import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type PanelKind = "image" | "text" | "web";

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
}

type HistoryFilter = "all" | "text" | "image";

const FILTERS: Array<{ key: Exclude<HistoryFilter, "all">; title: string }> = [
  { key: "text", title: "文本" },
  { key: "image", title: "图片" },
];

function fitTextToContainer(text: HTMLElement, container: HTMLElement, minPx: number, maxPx: number) {
  // 二分找最大可用字号（避免文字过小，同时不溢出）
  let low = minPx;
  let high = maxPx;
  let best = minPx;

  const fits = (px: number) => {
    text.style.fontSize = `${px}px`;
    // 让布局完成
    // 使用 scroll 宽高判断是否溢出
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
  if (!value) return;

  if (kind === "image") {
    const img = document.createElement("img");
    img.src = value;
    img.className = "panel-image preview-image-clickable";
    img.addEventListener("click", () => {
      invoke("open_original_image", { value }).catch((err) =>
        console.error("[previewView] open_original_image failed", err),
      );
    });
    root.appendChild(img);
    return;
  }

  const text = document.createElement("p");
  // 预览态：整体居中，但文字块内部左对齐
  text.className = (kind === "web" ? "panel-web-link" : "panel-text") + " preview-text-block";
  text.textContent = value;
  root.appendChild(text);

  // 预览窗允许更大的字号；太长的内容允许滚动，所以这里尽量放大到一个合理上限
  requestAnimationFrame(() => {
    fitTextToContainer(text, root, 13, 26);
  });
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function createIcon(kind: "text" | "image", extraClass?: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = `preview-symbol preview-symbol-${kind}${extraClass ? ` ${extraClass}` : ""}`;
  icon.setAttribute("aria-hidden", "true");
  if (kind === "image") {
    icon.appendChild(document.createElement("i"));
  }
  return icon;
}

function renderFilters(
  root: HTMLElement,
  active: HistoryFilter,
  onSelect?: (filter: HistoryFilter) => void,
): void {
  root.innerHTML = "";
  for (const filter of FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `preview-filter filter-${filter.key}` + (filter.key === active ? " is-active" : "");
    button.title = filter.title;
    button.setAttribute("aria-label", filter.title);
    button.appendChild(createIcon(filter.key, "preview-filter-symbol"));
    button.addEventListener("click", () => onSelect?.(filter.key === active ? "all" : filter.key));
    root.appendChild(button);
  }
}

function renderHistory(
  root: HTMLElement,
  history: ClipboardHistoryItem[],
  filter: HistoryFilter,
  deleteMode: boolean,
  activeId?: number,
  onSelect?: (item: ClipboardHistoryItem) => void,
): void {
  root.innerHTML = "";
  const filtered = history
    .filter((item) => {
    if (filter === "all") return true;
    if (filter === "image") return item.kind === "image";
    return item.kind === "text" || item.kind === "web";
    })
    .sort((a, b) => {
      const aPin = a.pinned ? 1 : 0;
      const bPin = b.pinned ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      if (a.pinned && b.pinned) {
        return (b.pinned_at_ms ?? 0) - (a.pinned_at_ms ?? 0);
      }
      return b.created_at_ms - a.created_at_ms;
    });
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "preview-history-empty";
    empty.textContent = filter === "all" ? "还没有复制内容" : "该分类下还没有内容";
    root.appendChild(empty);
    return;
  }

  for (const item of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `preview-history-item group-${item.kind === "image" ? "image" : "text"}` +
      (item.pinned ? " is-pinned" : "") +
      (item.id === activeId ? " is-active" : "");

    const meta = document.createElement("div");
    meta.className = "preview-history-meta";

    const iconWrap = document.createElement("span");
    iconWrap.className = `preview-history-icon group-${item.kind === "image" ? "image" : "text"}`;
    iconWrap.appendChild(createIcon(item.kind === "image" ? "image" : "text"));

    const kind = document.createElement("span");
    kind.className = "preview-history-kind";
    kind.textContent = formatTime(item.created_at_ms);

    meta.appendChild(iconWrap);
    meta.appendChild(kind);
    if (deleteMode) {
      const deleteItemBtn = document.createElement("button");
      deleteItemBtn.type = "button";
      deleteItemBtn.className = "preview-history-inline-delete";
      deleteItemBtn.textContent = "×";
      deleteItemBtn.title = "删除";
      deleteItemBtn.setAttribute("aria-label", "删除");
      deleteItemBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        invoke("delete_clipboard_history_item", { id: item.id }).catch((err) =>
          console.error("[previewView] delete_clipboard_history_item failed", err),
        );
      });
      meta.appendChild(deleteItemBtn);
    }
    button.appendChild(meta);

    if (item.kind !== "image") {
      const preview = document.createElement("span");
      preview.className = "preview-history-preview";
      preview.textContent = item.preview || "(空)";
      button.appendChild(preview);
    }

    button.addEventListener("click", () => onSelect?.(item));
    root.appendChild(button);
  }
}

export async function initPreviewView(root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  const historyRoot = document.getElementById("preview-history");
  const filterRoot = document.getElementById("preview-filters");
  const clearBtn = document.getElementById("preview-clear");
  const pinBtn = document.getElementById("preview-pin");
  const copyBtn = document.getElementById("preview-copy");
  const deleteBtn = document.getElementById("preview-delete");
  let history: ClipboardHistoryItem[] = [];
  let activeId: number | undefined;
  let activeFilter: HistoryFilter = "all";
  let deleteMode = false;

  const activeItem = () => history.find((item) => item.id === activeId);

  const renderHistoryList = () => {
    if (historyRoot) renderHistory(historyRoot, history, activeFilter, deleteMode, activeId, selectItem);
  };

  const syncActionButtons = () => {
    const disabled = activeId === undefined;
    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.classList.toggle("is-delete-mode", deleteMode);
      clearBtn.title = deleteMode ? "退出删除模式" : "进入删除模式";
      clearBtn.setAttribute("aria-label", deleteMode ? "退出删除模式" : "进入删除模式");
    }
    if (pinBtn instanceof HTMLButtonElement) {
      pinBtn.disabled = disabled;
      pinBtn.textContent = activeItem()?.pinned ? "取消置顶" : "置顶";
    }
    if (copyBtn instanceof HTMLButtonElement) copyBtn.disabled = disabled;
    if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = disabled;
  };

  const selectItem = (item: ClipboardHistoryItem) => {
    activeId = item.id;
    renderContent(root, item.kind, item.value);
    renderHistoryList();
    syncActionButtons();
  };

  const selectFilter = (filter: HistoryFilter) => {
    activeFilter = filter;
    if (filterRoot) renderFilters(filterRoot, activeFilter, selectFilter);
    renderHistoryList();
  };

  await invoke("log_debug", {
    message: `[preview init] label=${appWindow.label}`,
  }).catch((err) => console.error("[previewView] log_debug failed", err));

  history = await invoke<ClipboardHistoryItem[]>("get_clipboard_history").catch((err) => {
    console.error("[previewView] get_clipboard_history failed", err);
    return [];
  });
  if (filterRoot) renderFilters(filterRoot, activeFilter, selectFilter);
  renderHistoryList();
  syncActionButtons();

  clearBtn?.addEventListener("click", () => {
    deleteMode = !deleteMode;
    renderHistoryList();
    syncActionButtons();
  });

  pinBtn?.addEventListener("click", () => {
    if (activeId === undefined) return;
    invoke("toggle_pin_clipboard_history_item", { id: activeId }).catch((err) =>
      console.error("[previewView] toggle_pin_clipboard_history_item failed", err),
    );
  });

  copyBtn?.addEventListener("click", () => {
    if (activeId === undefined) return;
    invoke("copy_clipboard_history_item", { id: activeId }).catch((err) =>
      console.error("[previewView] copy_clipboard_history_item failed", err),
    );
  });

  deleteBtn?.addEventListener("click", () => {
    if (activeId === undefined) return;
    const deletingId = activeId;
    invoke("delete_clipboard_history_item", { id: deletingId })
      .then(() => {
        history = history.filter((item) => item.id !== deletingId);
        activeId = undefined;
        root.innerHTML = "";
        renderHistoryList();
        syncActionButtons();
      })
      .catch((err) => console.error("[previewView] delete_clipboard_history_item failed", err));
  });

  // 关闭按钮
  const closeBtn = document.getElementById("preview-close");
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    invoke("close_preview").catch(() => {});
  });

  // 点击木板边缘（不点内容区）关闭
  const previewRoot = document.getElementById("preview-root");
  previewRoot?.addEventListener("click", (e) => {
    // 只要点击的是 root（或 close button），说明点在边缘区域
    if (e.target === previewRoot) {
      invoke("close_preview").catch(() => {});
    }
  });

  // ESC 关闭预览
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      invoke("close_preview").catch(() => {});
    }
  });

  await appWindow.listen<PanelContentPayload>("preview-content", (event) => {
    activeId = event.payload.id;
    renderContent(root, event.payload.kind, event.payload.value);
    renderHistoryList();
    syncActionButtons();
  });

  await appWindow.listen<ClipboardHistoryItem>("history-appended", (event) => {
    history = [...history, event.payload];
    renderHistoryList();
  });

  await appWindow.listen("history-cleared", () => {
    history = [];
    activeId = undefined;
    root.innerHTML = "";
    renderHistoryList();
    syncActionButtons();
  });

  await appWindow.listen<number>("history-deleted", (event) => {
    history = history.filter((item) => item.id !== event.payload);
    if (activeId === event.payload) {
      activeId = undefined;
      root.innerHTML = "";
    }
    renderHistoryList();
    syncActionButtons();
  });

  await appWindow.listen<ClipboardHistoryItem>("history-pin-toggled", (event) => {
    history = history.map((item) => (item.id === event.payload.id ? event.payload : item));
    renderHistoryList();
    syncActionButtons();
  });
}
