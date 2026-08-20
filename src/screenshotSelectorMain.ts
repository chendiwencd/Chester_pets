import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

interface ScreenshotSelectionPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("screenshot-selector-root");
  const selection = document.getElementById("screenshot-selection");
  if (!root || !selection) return;

  const appWindow = getCurrentWindow();
  let start: { x: number; y: number } | undefined;

  const renderSelection = (endX: number, endY: number) => {
    if (!start) return;
    const x = Math.min(start.x, endX);
    const y = Math.min(start.y, endY);
    const width = Math.abs(endX - start.x);
    const height = Math.abs(endY - start.y);
    selection.hidden = false;
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;
  };

  const finishSelection = async (endX: number, endY: number) => {
    if (!start) return;
    const scaleFactor = await appWindow.scaleFactor();
    const outer = await appWindow.outerPosition();
    const x = Math.min(start.x, endX);
    const y = Math.min(start.y, endY);
    const width = Math.abs(endX - start.x);
    const height = Math.abs(endY - start.y);
    start = undefined;
    selection.hidden = true;

    const rect: ScreenshotSelectionPayload = {
      x: Math.round(outer.x + x * scaleFactor),
      y: Math.round(outer.y + y * scaleFactor),
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    };
    await invoke("complete_screenshot_selection", { rect }).catch((err) =>
      console.error("[screenshotSelector] complete_screenshot_selection failed", err),
    );
  };

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    root.setPointerCapture(event.pointerId);
    renderSelection(event.clientX, event.clientY);
  });

  root.addEventListener("pointermove", (event) => {
    if (!start) return;
    renderSelection(event.clientX, event.clientY);
  });

  root.addEventListener("pointerup", (event) => {
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    void finishSelection(event.clientX, event.clientY);
  });

  root.addEventListener("pointercancel", () => {
    start = undefined;
    selection.hidden = true;
    invoke("close_screenshot_selector").catch(() => {});
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      start = undefined;
      selection.hidden = true;
      invoke("close_screenshot_selector").catch(() => {});
    }
  });
});
