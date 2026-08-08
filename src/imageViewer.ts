import { getCurrentWindow } from "@tauri-apps/api/window";

interface OriginalImagePayload {
  value: string;
}

export async function initImageViewer(root: HTMLElement, img: HTMLImageElement): Promise<void> {
  const appWindow = getCurrentWindow();
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let activePointerId: number | undefined;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  const syncCursor = () => {
    if (scale <= 1) {
      img.style.cursor = "zoom-in";
      return;
    }
    img.style.cursor = dragging ? "grabbing" : "grab";
  };

  const applyTransform = () => {
    img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    syncCursor();
  };

  root.addEventListener("click", (event) => {
    if (event.target === root) {
      appWindow.hide().catch(() => {});
    }
  });

  root.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.12 : -0.12;
      scale = Math.min(5, Math.max(0.2, scale + delta));
      if (scale <= 1) {
        offsetX = 0;
        offsetY = 0;
      }
      applyTransform();
    },
    { passive: false },
  );

  img.addEventListener("pointerdown", (event) => {
    if (scale <= 1) return;
    dragging = true;
    activePointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginX = offsetX;
    dragOriginY = offsetY;
    img.setPointerCapture(event.pointerId);
    applyTransform();
  });

  img.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    offsetX = dragOriginX + (event.clientX - dragStartX);
    offsetY = dragOriginY + (event.clientY - dragStartY);
    applyTransform();
  });

  const finishDrag = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    if (img.hasPointerCapture(event.pointerId)) {
      img.releasePointerCapture(event.pointerId);
    }
    activePointerId = undefined;
    applyTransform();
  };

  img.addEventListener("pointerup", finishDrag);
  img.addEventListener("pointercancel", finishDrag);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      appWindow.hide().catch(() => {});
    }
  });

  await appWindow.listen<OriginalImagePayload>("original-image-content", (event) => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    dragging = false;
    activePointerId = undefined;
    applyTransform();
    img.src = event.payload.value;
  });
}
