import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveImageSrc } from "./media";

// note = 第三个面板手动输入的"记事本"条目，和来自剪贴板的 text/image 区分。
type PanelKind = "image" | "text" | "web" | "note";

const LAST_VIEWED_KEY = "desktop-shell.preview.last-viewed-id";

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

type HistoryFilter = "all" | "text" | "image" | "note";

interface SavedResourceSummary {
  kind: "text" | "image";
  name: string;
  summary: string;
  size?: string;
}

const NOTE_RESOURCE_MARKER = "[[desktop-shell:resources:v1]]";

const FILTERS: Array<{ key: Exclude<HistoryFilter, "all">; title: string }> = [
  { key: "text", title: "文本" },
  { key: "image", title: "图片" },
  { key: "note", title: "记事本" },
];

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

function renderContent(root: HTMLElement, kind: PanelKind, value: string): void {
  root.innerHTML = "";
  if (!value) return;

  if (kind === "image") {
    const img = document.createElement("img");
    img.className = "panel-image preview-image-clickable";
    void resolveImageSrc(value).then((src) => {
      img.src = src;
    });
    img.addEventListener("click", () => {
      invoke("open_original_image", { value }).catch((err) =>
        console.error("[previewView] open_original_image failed", err),
      );
    });
    root.appendChild(img);
    return;
  }

  if (kind === "note") {
    const parsed = parseNoteWithResources(value);
    if (parsed.resources.length > 0) {
      const container = document.createElement("div");
      container.className = "preview-note-container";

      const resourcesBlock = document.createElement("div");
      resourcesBlock.className = "preview-note-resources";
      for (const resource of parsed.resources) {
        const card = document.createElement("div");
        card.className = `preview-note-resource-card preview-note-resource-${resource.kind}`;

        const icon = document.createElement("span");
        icon.className = `preview-note-resource-icon preview-note-resource-icon-${resource.kind}`;
        icon.setAttribute("aria-hidden", "true");
        if (resource.kind === "image") {
          icon.appendChild(document.createElement("i"));
        } else {
          icon.appendChild(document.createElement("i"));
        }

        const info = document.createElement("div");
        info.className = "preview-note-resource-info";

        const name = document.createElement("div");
        name.className = "preview-note-resource-name";
        name.textContent = resource.name;

        const summary = document.createElement("div");
        summary.className = "preview-note-resource-summary";
        summary.textContent = resource.summary;

        info.appendChild(name);
        info.appendChild(summary);
        card.appendChild(icon);
        card.appendChild(info);
        resourcesBlock.appendChild(card);
      }
      container.appendChild(resourcesBlock);

      if (parsed.text) {
        const textBlock = document.createElement("div");
        textBlock.className = "preview-note-text";
        textBlock.textContent = parsed.text;
        container.appendChild(textBlock);
      }

      root.appendChild(container);
      return;
    }
  }

  const text = document.createElement("p");
  text.className = (kind === "web" ? "panel-web-link" : "panel-text") + " preview-text-block";
  text.textContent = value;
  root.appendChild(text);
}

// 时间戳按“距今远近”分档，越近显示得越省略：
// - 当天：只显示 时:分（HH:mm）
// - 当年内的其它日期：显示 月-日 时:分（MM-DD HH:mm）
// - 往年：显示 年-月-日 时:分（YYYY-MM-DD HH:mm）
function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hm;

  const md = `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;

  return `${d.getFullYear()}-${md} ${hm}`;
}

function createIcon(kind: "text" | "image" | "note", extraClass?: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = `preview-symbol preview-symbol-${kind}${extraClass ? ` ${extraClass}` : ""}`;
  icon.setAttribute("aria-hidden", "true");
  if (kind === "image" || kind === "note") {
    icon.appendChild(document.createElement("i"));
  }
  return icon;
}

// 历史条目按类别归组：图片 / 记事本(手动输入) / 文本(剪贴板文本或链接)。
function groupOf(kind: PanelKind): "image" | "note" | "text" {
  if (kind === "image") return "image";
  if (kind === "note") return "note";
  return "text";
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
    if (filter === "note") return item.kind === "note";
    // 文本：来自剪贴板的文本/链接，不含记事本
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
    const group = groupOf(item.kind);
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `preview-history-item group-${group}` +
      (item.pinned ? " is-pinned" : "") +
      (item.id === activeId ? " is-active" : "");

    const meta = document.createElement("div");
    meta.className = "preview-history-meta";

    const iconWrap = document.createElement("span");
    iconWrap.className = `preview-history-icon group-${group}`;
    iconWrap.appendChild(createIcon(group));

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
      // 记事本条目只显示正文，不显示资源 JSON
      if (item.kind === "note") {
        const parsed = parseNoteWithResources(item.value);
        preview.textContent = parsed.text || "(空)";
      } else {
        preview.textContent = item.preview || "(空)";
      }
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
  let monitorMode = false;

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
    // 记住用户上次查看的记录
    try {
      localStorage.setItem(LAST_VIEWED_KEY, String(item.id));
    } catch {
      // ignore storage failures
    }
    // 滚动到选中的记录
    requestAnimationFrame(() => {
      if (historyRoot) {
        const activeButton = historyRoot.querySelector(".preview-history-item.is-active");
        if (activeButton instanceof HTMLElement) {
          activeButton.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    });
  };

  const selectFilter = (filter: HistoryFilter) => {
    if (!monitorMode) return; // 非监控模式下不支持切换筛选器

    activeFilter = filter;
    if (filterRoot) renderFilters(filterRoot, activeFilter, selectFilter);

    // 切换筛选器时，自动选中该分类下的第一条记录
    const filtered = history.filter((item) => {
      if (filter === "all") return true;
      if (filter === "image") return item.kind === "image";
      if (filter === "note") return item.kind === "note";
      return item.kind === "text" || item.kind === "web";
    }).sort((a, b) => {
      const aPin = a.pinned ? 1 : 0;
      const bPin = b.pinned ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      if (a.pinned && b.pinned) {
        return (b.pinned_at_ms ?? 0) - (a.pinned_at_ms ?? 0);
      }
      return b.created_at_ms - a.created_at_ms;
    });

    if (filtered.length > 0 && !filtered.find(item => item.id === activeId)) {
      // 如果当前选中的不在筛选结果中，自动选中第一条
      selectItem(filtered[0]);
    } else {
      renderHistoryList();
    }
  };

  await invoke("log_debug", {
    message: `[preview init] label=${appWindow.label}`,
  }).catch((err) => console.error("[previewView] log_debug failed", err));

  monitorMode = await invoke<boolean>("get_monitor_mode").catch((err) => {
    console.error("[previewView] get_monitor_mode failed", err);
    return false;
  });

  history = await invoke<ClipboardHistoryItem[]>("get_clipboard_history").catch((err) => {
    console.error("[previewView] get_clipboard_history failed", err);
    return [];
  });

  // 非监控模式下，只显示记事本分类
  if (!monitorMode) {
    history = history.filter((item) => item.kind === "note");
    activeFilter = "note";
  }

  if (filterRoot) {
    if (monitorMode) {
      renderFilters(filterRoot, activeFilter, selectFilter);
    } else {
      filterRoot.style.display = "none";
    }
  }

  // 初始化时尝试恢复上次查看的记录
  if (history.length > 0) {
    let itemToSelect: ClipboardHistoryItem | undefined;

    // 1. 尝试加载上次查看的记录
    try {
      const lastViewedId = localStorage.getItem(LAST_VIEWED_KEY);
      if (lastViewedId) {
        itemToSelect = history.find((item) => item.id === Number(lastViewedId));
      }
    } catch {
      // ignore storage failures
    }

    // 2. 如果上次查看的记录不存在（被删除或首次打开），选择第一条记录（置顶优先）
    if (!itemToSelect) {
      const sorted = [...history].sort((a, b) => {
        const aPin = a.pinned ? 1 : 0;
        const bPin = b.pinned ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        if (a.pinned && b.pinned) {
          return (b.pinned_at_ms ?? 0) - (a.pinned_at_ms ?? 0);
        }
        return b.created_at_ms - a.created_at_ms;
      });
      itemToSelect = sorted[0];
    }

    selectItem(itemToSelect);
  } else {
    renderHistoryList();
    syncActionButtons();
  }

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
    if (!monitorMode && event.payload.kind !== "note") return; // 非监控模式下只接收记事本类型
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
