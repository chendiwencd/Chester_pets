import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { apiClient } from "./api/authClient";
import type { InfoResponse, OCRInfo, TranslationResponse } from "./api/types";
import "./styles.css";

interface ScreenshotResultPayload {
  ocr_text: string;
  image_data_url: string;
}

function clearKnowledge(root: HTMLElement): void {
  root.innerHTML = "";
}

function appendTextBlock(root: HTMLElement, className: string, text: string): void {
  if (!text.trim()) return;
  const block = document.createElement("p");
  block.className = className;
  block.textContent = text;
  root.append(block);
}

function extractResponseText(response: string): string {
  const raw = response.trim();
  if (!raw) return "";

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.ocr_text === "string") return record.ocr_text;
    }
  } catch {
    // The command endpoints may return plain text instead of a JSON object.
  }

  return response;
}

function parseInfoResponse(response: InfoResponse): OCRInfo {
  const fallback: OCRInfo = {
    subject: "",
    summary: response,
    key_points: [],
    terms: [],
  };

  try {
    const parsed: unknown = JSON.parse(response);
    const value =
      typeof parsed === "object" && parsed !== null && "info" in parsed
        ? (parsed as { info?: unknown }).info
        : parsed;
    if (typeof value !== "object" || value === null) return fallback;

    const record = value as Record<string, unknown>;
    return {
      subject: typeof record.subject === "string" ? record.subject : "",
      summary: typeof record.summary === "string" ? record.summary : response,
      key_points: Array.isArray(record.key_points)
        ? record.key_points.filter((item): item is string => typeof item === "string")
        : [],
      terms: Array.isArray(record.terms)
        ? record.terms.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return fallback;
  }
}

function renderInfo(root: HTMLElement, info: OCRInfo): void {
  clearKnowledge(root);
  appendTextBlock(root, "screenshot-knowledge-subject", info.subject);
  appendTextBlock(root, "screenshot-knowledge-summary", info.summary);

  if (info.key_points.length > 0) {
    const heading = document.createElement("h3");
    heading.className = "screenshot-knowledge-heading";
    heading.textContent = "重点";
    const list = document.createElement("ul");
    list.className = "screenshot-knowledge-list";
    for (const point of info.key_points) {
      const item = document.createElement("li");
      item.textContent = point;
      list.append(item);
    }
    root.append(heading, list);
  }

  if (info.terms.length > 0) {
    const heading = document.createElement("h3");
    heading.className = "screenshot-knowledge-heading";
    heading.textContent = "相关术语";
    const list = document.createElement("ul");
    list.className = "screenshot-knowledge-list";
    for (const term of info.terms) {
      const item = document.createElement("li");
      item.textContent = term;
      list.append(item);
    }
    root.append(heading, list);
  }
}

function renderInfoError(root: HTMLElement, error: unknown): void {
  clearKnowledge(root);
  appendTextBlock(
    root,
    "screenshot-knowledge-error",
    `科普生成失败：${error instanceof Error ? error.message : String(error)}`,
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  const appWindow = getCurrentWindow();
  const textarea = document.getElementById("screenshot-ocr-text");
  const translationTextarea = document.getElementById("screenshot-translation-text");
  const image = document.getElementById("screenshot-image");
  const infoRoot = document.getElementById("screenshot-knowledge");
  const knowledgePanel = document.getElementById("screenshot-knowledge-panel");
  const translationPanel = document.getElementById("screenshot-translation-panel");
  const status = document.getElementById("screenshot-ocr-status");
  const titlebar = document.getElementById("screenshot-result-titlebar");
  const closeButton = document.getElementById("screenshot-result-close");
  const moreButton = document.getElementById("screenshot-more");
  const translateButton = document.getElementById("screenshot-translate");
  const copyButton = document.getElementById("screenshot-copy");
  const saveButton = document.getElementById("screenshot-save");
  if (
    !(textarea instanceof HTMLTextAreaElement) ||
    !(translationTextarea instanceof HTMLTextAreaElement) ||
    !(image instanceof HTMLImageElement) ||
    !(infoRoot instanceof HTMLElement) ||
    !(knowledgePanel instanceof HTMLElement) ||
    !(translationPanel instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(titlebar instanceof HTMLElement) ||
    !(closeButton instanceof HTMLButtonElement) ||
    !(moreButton instanceof HTMLButtonElement) ||
    !(translateButton instanceof HTMLButtonElement) ||
    !(copyButton instanceof HTMLButtonElement) ||
    !(saveButton instanceof HTMLButtonElement)
  ) return;
  textarea.value = "";
  translationTextarea.value = "";
  knowledgePanel.hidden = true;
  translationPanel.hidden = true;
  let requestSerial = 0;
  let translationSerial = 0;
  let imageDataUrl = "";
  let ocrText = "";
  let translationText = "";
  let infoReady = false;
  let saving = false;

  const setPanelVisible = (panel: HTMLElement, visible: boolean) => {
    if (!visible) {
      panel.classList.remove("is-visible");
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-visible"));
  };

  const hideExpandablePanels = () => {
    setPanelVisible(knowledgePanel, false);
    setPanelVisible(translationPanel, false);
    moreButton.classList.remove("is-active");
    translateButton.classList.remove("is-active");
  };

  const setMoreVisible = (visible: boolean) => {
    if (visible) {
      setPanelVisible(translationPanel, false);
      translateButton.classList.remove("is-active");
      moreButton.classList.add("is-active");
    } else {
      moreButton.classList.remove("is-active");
    }
    setPanelVisible(knowledgePanel, visible);
  };

  const setTranslationVisible = (visible: boolean) => {
    if (visible) {
      setPanelVisible(knowledgePanel, false);
      moreButton.classList.remove("is-active");
      translateButton.classList.add("is-active");
    } else {
      translateButton.classList.remove("is-active");
    }
    setPanelVisible(translationPanel, visible);
  };

  const resetMoreInfo = () => {
    infoReady = false;
    moreButton.disabled = true;
    hideExpandablePanels();
    clearKnowledge(infoRoot);
  };

  const setResultButtons = () => {
    translateButton.disabled = !ocrText.trim();
    copyButton.disabled = !ocrText.trim();
    saveButton.disabled = !imageDataUrl || saving;
  };

  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("#screenshot-result-close")) {
      return;
    }
    void appWindow.startDragging().catch((error) => {
      console.error("[screenshotResult] startDragging failed", error);
    });
  });
  closeButton.addEventListener("click", () => {
    void invoke("close_screenshot_result").catch((error) => {
      console.error("[screenshotResult] close failed", error);
    });
  });

  moreButton.addEventListener("click", () => {
    if (!infoReady) return;
    setMoreVisible(knowledgePanel.hidden);
  });

  translateButton.addEventListener("click", () => {
    if (!ocrText.trim()) return;
    if (!translationPanel.hidden) {
      setTranslationVisible(false);
      return;
    }
    setTranslationVisible(true);
    if (translationText.trim()) {
      status.textContent = "已完成翻译";
      return;
    }

    const serial = ++translationSerial;
    translateButton.disabled = true;
    translationTextarea.value = "正在翻译...";
    status.textContent = "正在翻译...";
    void apiClient
      .translateText({ text: ocrText })
      .then((result: TranslationResponse) => {
        if (serial !== translationSerial) return;
        translationText = result.translated_text ?? "";
        translationTextarea.value = translationText;
        status.textContent = translationText ? "已完成翻译" : "未返回翻译结果";
        setResultButtons();
      })
      .catch((error: unknown) => {
        if (serial !== translationSerial) return;
        translationText = `翻译失败：${error instanceof Error ? error.message : String(error)}`;
        translationTextarea.value = translationText;
        status.textContent = "翻译失败";
        setResultButtons();
      });
  });

  copyButton.addEventListener("click", () => {
    const value = (translationPanel.hidden ? ocrText : translationText || ocrText).trim();
    if (!value) return;
    void invoke("copy_text_to_clipboard", { value })
      .then(() => {
        status.textContent = "已复制";
      })
      .catch((error) => console.error("[screenshotResult] copy failed", error));
  });

  saveButton.addEventListener("click", () => {
    if (!imageDataUrl || saving) return;
    saving = true;
    setResultButtons();
    status.textContent = "正在保存到记事本...";
    void invoke<number | null>("save_screenshot_note", {
      image_data_url: imageDataUrl,
      ocr_text: ocrText,
    })
      .then((id) => {
        status.textContent = id == null ? "保存失败" : "已保存到记事本";
      })
      .catch((error) => {
        console.error("[screenshotResult] save failed", error);
        status.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        saving = false;
        setResultButtons();
      });
  });

  await appWindow.listen<ScreenshotResultPayload>("screenshot-result", (event) => {
    const payload = event.payload;
    const serial = ++requestSerial;
    imageDataUrl = payload.image_data_url ?? "";
    ocrText = payload.ocr_text ?? "";
    translationText = "";
    translationSerial += 1;
    textarea.value = ocrText;
    translationTextarea.value = "";
    image.src = imageDataUrl;
    resetMoreInfo();
    status.textContent = imageDataUrl ? "正在识别..." : "截图内容为空";
    setResultButtons();

    if (!imageDataUrl) return;
    void apiClient
      .ocrImage({ image_data_url: imageDataUrl })
      .then((result) => {
        if (serial !== requestSerial) return;
        ocrText = extractResponseText(result);
        textarea.value = ocrText;
        setResultButtons();
        if (!ocrText.trim()) {
          status.textContent = "未识别到文字";
          return;
        }
        status.textContent = "你可能想知道...";
        void apiClient
          .commandInfo({ text: ocrText })
          .then((infoResult) => {
            if (serial !== requestSerial) return;
            renderInfo(infoRoot, parseInfoResponse(infoResult));
            infoReady = true;
            moreButton.disabled = false;
            setMoreVisible(true);
            status.textContent = "已完成";
          })
          .catch((error: unknown) => {
            if (serial !== requestSerial) return;
            renderInfoError(infoRoot, error);
            infoReady = true;
            moreButton.disabled = false;
            setMoreVisible(true);
            status.textContent = "OCR 完成，科普生成失败";
          });
      })
      .catch((error: unknown) => {
        if (serial !== requestSerial) return;
        renderInfoError(infoRoot, error);
        status.textContent = "OCR 失败";
      });
  });
});
