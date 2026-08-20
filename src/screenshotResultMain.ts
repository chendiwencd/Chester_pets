import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

interface ScreenshotResultPayload {
  ocr_text: string;
  image_data_url: string;
}

window.addEventListener("DOMContentLoaded", async () => {
  const appWindow = getCurrentWindow();
  const textarea = document.getElementById("screenshot-ocr-text");
  const image = document.getElementById("screenshot-image");
  if (!(textarea instanceof HTMLTextAreaElement) || !(image instanceof HTMLImageElement)) return;
  textarea.value = "";

  await appWindow.listen<ScreenshotResultPayload>("screenshot-result", (event) => {
    textarea.value = event.payload.ocr_text ?? "";
    image.src = event.payload.image_data_url ?? "";
  });
});
