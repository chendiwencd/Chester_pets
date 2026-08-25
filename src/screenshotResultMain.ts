import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { apiClient } from "./api/authClient";
import type { InfoResponse, OCRInfo } from "./api/types";
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
  const image = document.getElementById("screenshot-image");
  const infoRoot = document.getElementById("screenshot-knowledge");
  const status = document.getElementById("screenshot-ocr-status");
  const titlebar = document.getElementById("screenshot-result-titlebar");
  const closeButton = document.getElementById("screenshot-result-close");
  if (
    !(textarea instanceof HTMLTextAreaElement) ||
    !(image instanceof HTMLImageElement) ||
    !(infoRoot instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(titlebar instanceof HTMLElement) ||
    !(closeButton instanceof HTMLButtonElement)
  ) return;
  textarea.value = "";
  let requestSerial = 0;

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

  await appWindow.listen<ScreenshotResultPayload>("screenshot-result", (event) => {
    const payload = event.payload;
    const serial = ++requestSerial;
    const imageDataUrl = payload.image_data_url ?? "";
    textarea.value = payload.ocr_text ?? "";
    image.src = imageDataUrl;
    clearKnowledge(infoRoot);
    status.textContent = imageDataUrl ? "正在识别..." : "截图内容为空";

    if (!imageDataUrl) return;
    void apiClient
      .ocrImage({ image_data_url: imageDataUrl })
      .then((result) => {
        if (serial !== requestSerial) return;
        const ocrText = extractResponseText(result);
        textarea.value = ocrText;
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
            status.textContent = "已完成";
          })
          .catch((error: unknown) => {
            if (serial !== requestSerial) return;
            renderInfoError(infoRoot, error);
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
