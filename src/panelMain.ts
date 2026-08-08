import { initPanelView } from "./panelView";
import "./styles.css";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("panel-content");
  if (root) void initPanelView(root);
});
