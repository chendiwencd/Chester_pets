import { initControlPanelView } from "./controlPanelView";
import "./styles.css";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("control-panel-root");
  if (root) void initControlPanelView(root);
});
