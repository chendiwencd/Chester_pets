import { initPreviewView } from "./previewView";
import "./styles.css";
import { buildWorkspaceShell } from "./workspaceShell";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("workspace-root");
  if (root) {
    buildWorkspaceShell(root);
    void initPreviewView(root);
  }
});
