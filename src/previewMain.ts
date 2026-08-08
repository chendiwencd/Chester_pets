import { initPreviewView } from "./previewView";
import "./styles.css";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("preview-content");
  if (root) void initPreviewView(root);
});

