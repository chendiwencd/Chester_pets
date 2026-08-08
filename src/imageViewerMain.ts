import { initImageViewer } from "./imageViewer";
import "./styles.css";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("image-viewer-root");
  const img = document.getElementById("image-viewer-img");
  if (root instanceof HTMLElement && img instanceof HTMLImageElement) {
    void initImageViewer(root, img);
  }
});

