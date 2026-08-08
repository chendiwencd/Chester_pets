import { initPetView } from "./petView";
import "./styles.css";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("pet-root");
  if (root) initPetView(root);
});
