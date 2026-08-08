import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { HOVER_INTENT_MS, HoldStateMachine, LONG_PRESS_MS } from "./holdStateMachine";
import { PetStatusStore, type MovingDirection, type PetStatus } from "./store";
import { SpriteRenderer } from "./spriteRenderer";
import { backendClient } from "./backendClient";

const SAVE_POSITION_DEBOUNCE_MS = 300;
const logToTauri = (message: string) => {
  invoke("log_debug", { message }).catch((err) => console.error("[log_debug] failed", err));
};

export function initPetView(root: HTMLElement): void {
  const appWindow = getCurrentWindow();
  const store = new PetStatusStore();
  const renderer = new SpriteRenderer(root);

  const CLIPBOARD_POLL_MS = 450;
  const AUTO_MOVE_SPEED_PX_PER_SEC = 450;
  const SLEEP_AFTER_MS = 2 * 60 * 1000;
  const LEAVE_GRACE_MS = 600;

  type Mode = "waiting" | "open" | "preview" | "moving" | "sleep";
  let mode: Mode = "waiting";

  // open 的来源：点击固定打开 或 悬浮意图打开
  let pinnedOpen = false;
  let hoverOpen = false;
  let previewOpen = false;

  let movingDirection: MovingDirection = "right";
  let lastStatus = store.get();

  let panelVisible = false;
  let clipboardPollTimer: number | undefined;
  let leaveTimer: number | undefined;
  let suppressHoverUntilLeave = false;
  let inactivityTimer: number | undefined;

  // 自动移动
  let lastDragX: number | undefined;
  let dragTarget: { x: number; y: number } | undefined;
  let autoMoveFrame: number | undefined;
  let autoMoveLastTs: number | undefined;
  let currentLogicalPos: { x: number; y: number } | undefined;
  let autoMoveTarget: { x: number; y: number } | undefined;

  store.subscribe((status) => {
    if (status !== lastStatus) {
      logToTauri(`[pet status] ${lastStatus} -> ${status} direction=${movingDirection}`);
      lastStatus = status;
    }
    renderer.render(status, movingDirection);
    backendClient.reportStatus(status);
  });

  const stopClipboardPolling = () => {
    window.clearInterval(clipboardPollTimer);
    clipboardPollTimer = undefined;
  };
  const startClipboardPolling = () => {
    if (clipboardPollTimer !== undefined) return;
    clipboardPollTimer = window.setInterval(() => {
      invoke("poll_clipboard").catch((err) =>
        console.error("[petView] poll_clipboard failed", err),
      );
    }, CLIPBOARD_POLL_MS);
  };

  const setStatusFromMode = () => {
    const status: PetStatus =
      mode === "sleep"
        ? "sleep"
        : mode === "moving"
          ? "moving"
          : mode === "open" || mode === "preview"
            ? "open"
            : "waiting";
    store.setStatus(status);
  };

  const syncPanelVisibility = (reason: string) => {
    const nextVisible = mode === "open";
    if (nextVisible === panelVisible) return;
    logToTauri(
      `[panel visibility] ${reason} mode=${mode} pinnedOpen=${pinnedOpen} hoverOpen=${hoverOpen} previewOpen=${previewOpen} -> visible=${nextVisible}`,
    );
    invoke<boolean>("set_panel_visibility", { open: nextVisible })
      .then((visible) => {
        panelVisible = visible;
        if (visible) startClipboardPolling();
        else stopClipboardPolling();
      })
      .catch((err) => console.error("[petView] set_panel_visibility failed", err));
  };

  const setMode = (next: Mode, reason: string) => {
    if (mode === next) return;
    logToTauri(`[mode] ${reason} ${mode} -> ${next}`);
    mode = next;
    setStatusFromMode();
    syncPanelVisibility(`mode:${reason}`);
  };

  const resetInactivity = (reason: string) => {
    window.clearTimeout(inactivityTimer);
    if (mode === "sleep") setMode("waiting", `wake:${reason}`);
    logToTauri(`[sleep timer] reset by ${reason}, next sleep in ${SLEEP_AFTER_MS}ms`);
    inactivityTimer = window.setTimeout(() => {
      if (mode === "waiting") {
        logToTauri("[sleep timer] trigger sleep");
        setMode("sleep", "inactivity");
      } else {
        logToTauri(`[sleep timer] skipped because mode=${mode}`);
      }
    }, SLEEP_AFTER_MS);
  };

  // 启动时进入等待态，开始计时
  setStatusFromMode();
  renderer.render(store.get(), movingDirection);
  logToTauri(`[pet init] status=${store.get()} direction=${movingDirection}`);
  resetInactivity("init");

  const scheduleSavePosition = () => {
    window.setTimeout(() => {
      void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]).then(
        ([physicalPos, scaleFactor]) => {
          const logicalPos = physicalPos.toLogical(scaleFactor);
          invoke("save_pet_position", {
            x: Math.round(logicalPos.x),
            y: Math.round(logicalPos.y),
          }).catch((err) => console.error("[petView] save_pet_position failed", err));
        },
      );
    }, SAVE_POSITION_DEBOUNCE_MS);
  };

  const stopAutoMove = () => {
    if (autoMoveFrame !== undefined) {
      window.cancelAnimationFrame(autoMoveFrame);
      autoMoveFrame = undefined;
    }
    autoMoveLastTs = undefined;
    autoMoveTarget = undefined;
  };

  const ensureAutoMoveLoop = () => {
    if (autoMoveFrame !== undefined) return;
    setMode("moving", "autoMove:start");
    autoMoveLastTs = undefined;

    const tick = (ts: number) => {
      const target = autoMoveTarget;
      if (!currentLogicalPos || !target) {
        autoMoveFrame = window.requestAnimationFrame(tick);
        return;
      }

      const last = autoMoveLastTs ?? ts;
      const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
      autoMoveLastTs = ts;

      const dx = target.x - currentLogicalPos.x;
      const dy = target.y - currentLogicalPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 1) {
        // 到达当前目标
        pendingPosition = { x: Math.round(target.x), y: Math.round(target.y) };
        flushPendingPosition();
        currentLogicalPos = { x: target.x, y: target.y };

        // 如果目标没有再更新，停止
        if (!autoMoveTarget || (autoMoveTarget.x === target.x && autoMoveTarget.y === target.y)) {
          logToTauri("[autoMove] arrived");
          autoMoveFrame = undefined;
          autoMoveLastTs = undefined;
          scheduleSavePosition();
          setMode("waiting", "autoMove:arrived");
          return;
        }
      } else {
        const step = AUTO_MOVE_SPEED_PX_PER_SEC * dt;
        const ratio = step >= dist ? 1 : step / dist;
        const nextX = currentLogicalPos.x + dx * ratio;
        const nextY = currentLogicalPos.y + dy * ratio;
        currentLogicalPos = { x: nextX, y: nextY };

        const nextDirection: MovingDirection = dx < 0 ? "left" : "right";
        if (nextDirection !== movingDirection) {
          movingDirection = nextDirection;
          renderer.render(store.get(), movingDirection);
        }

        pendingPosition = { x: Math.round(nextX), y: Math.round(nextY) };
        flushPendingPosition();
      }

      autoMoveFrame = window.requestAnimationFrame(tick);
    };

    autoMoveFrame = window.requestAnimationFrame(tick);
  };

  const setAutoMoveTarget = (target: { x: number; y: number }) => {
    autoMoveTarget = target;
    ensureAutoMoveLoop();
  };

  // setPosition 节流
  let pendingPosition: { x: number; y: number } | undefined;
  let positionRequestInFlight = false;
  const flushPendingPosition = () => {
    if (positionRequestInFlight || !pendingPosition) return;
    const { x, y } = pendingPosition;
    positionRequestInFlight = true;
    appWindow
      .setPosition(new LogicalPosition(x, y))
      .catch((err) => console.error("[petView] setPosition failed", err))
      .finally(() => {
        positionRequestInFlight = false;
        if (pendingPosition && (pendingPosition.x !== x || pendingPosition.y !== y)) {
          flushPendingPosition();
        }
      });
  };

  let hoverTimer: number | undefined;
  let longPressTimer: number | undefined;
  let activePointerId: number | undefined;

  const machine = new HoldStateMachine({
    onHoverChange: (hovering) => {
      resetInactivity("hoverChange");
      if (suppressHoverUntilLeave) return;
      if (mode === "moving" || mode === "preview") return;
      hoverOpen = hovering;
      if (hovering) {
        setMode("open", "hover:on");
      } else if (!pinnedOpen && mode === "open") {
        setMode("waiting", "hover:off");
      }
    },
    onDragStart: () => {
      resetInactivity("dragStart");
      // 状态互斥：移动时不能是打开/预览
      pinnedOpen = false;
      hoverOpen = false;
      previewOpen = false;
      suppressHoverUntilLeave = true;
      invoke("close_preview").catch(() => {});
      syncPanelVisibility("dragStart");

      lastDragX = undefined;
      dragTarget = undefined;
      setMode("moving", "dragStart");
    },
    onDragMove: (x, y) => {
      resetInactivity("dragMove");
      if (lastDragX !== undefined && x !== lastDragX) {
        const nextDirection: MovingDirection = x < lastDragX ? "left" : "right";
        if (nextDirection !== movingDirection) {
          movingDirection = nextDirection;
          renderer.render(store.get(), movingDirection);
        }
      }
      lastDragX = x;
      dragTarget = { x: Math.round(x), y: Math.round(y) };
      // 鼠标移动就以鼠标为目标开始移动（不粘鼠标）
      setAutoMoveTarget(dragTarget);
    },
    onDragEnd: () => {
      resetInactivity("dragEnd");
      // 松手后以松手位置为最终目标继续移动
      if (dragTarget) {
        setAutoMoveTarget(dragTarget);
      } else {
        stopAutoMove();
        setMode("waiting", "dragEnd:noTarget");
      }
    },
    onClick: () => {
      resetInactivity("click");
      const opened = mode === "open" || mode === "preview";
      if (opened) {
        // 打开态再次点击 -> 等待
        pinnedOpen = false;
        hoverOpen = false;
        previewOpen = false;
        suppressHoverUntilLeave = true;
        invoke("close_preview").catch(() => {});
        setMode("waiting", "click-close");
      } else {
        pinnedOpen = true;
        suppressHoverUntilLeave = false;
        setMode("open", "click-open");
      }
    },
  });

  root.addEventListener("pointerenter", () => {
    resetInactivity("pointerenter");
    window.clearTimeout(leaveTimer);
    window.clearTimeout(hoverTimer);
    machine.handlePointerEnter();
    hoverTimer = window.setTimeout(() => machine.handleHoverIntentElapsed(), HOVER_INTENT_MS);
  });

  root.addEventListener("pointerleave", () => {
    resetInactivity("pointerleave");
    window.clearTimeout(hoverTimer);
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      machine.handlePointerLeave();
      suppressHoverUntilLeave = false;
    }, LEAVE_GRACE_MS);
  });

  root.addEventListener("pointerdown", (event) => {
    resetInactivity("pointerdown");
    activePointerId = event.pointerId;
    window.clearTimeout(hoverTimer);
    root.setPointerCapture(event.pointerId);
    machine.handlePointerDown(event.clientX, event.clientY);
    window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => machine.handleLongPressElapsed(), LONG_PRESS_MS);

    // 读取当前窗口逻辑位置，作为自动移动的起点
    void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]).then(
      ([physicalPos, scaleFactor]) => {
        const logicalPos = physicalPos.toLogical(scaleFactor);
        currentLogicalPos = { x: logicalPos.x, y: logicalPos.y };
      },
    );
  });

  window.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    resetInactivity("pointermove");
    machine.handlePointerMove({ screenX: event.screenX, screenY: event.screenY });
  });

  const finishPointerInteraction = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    window.clearTimeout(longPressTimer);
    machine.handlePointerUp();
    activePointerId = undefined;
  };
  window.addEventListener("pointerup", finishPointerInteraction);
  window.addEventListener("pointercancel", finishPointerInteraction);
  root.addEventListener("lostpointercapture", () => {
    window.clearTimeout(longPressTimer);
    activePointerId = undefined;
  });

  // 应用整体失焦：关闭一切，回到等待（但不直接进入 sleep，sleep 由计时器控制）
  void appWindow.listen("app-deactivated", () => {
    pinnedOpen = false;
    hoverOpen = false;
    previewOpen = false;
    invoke("close_preview").catch(() => {});
    stopAutoMove();
    setMode("waiting", "app-deactivated");
  });

  // 预览打开/关闭：保持打开态，但预览态只显示预览窗口
  void appWindow.listen<{ open: boolean }>("preview-state", (event) => {
    const open = !!event.payload.open;
    // sleep 期间收起预览不应被视为“用户交互”，否则会立刻唤醒
    if (mode === "sleep" && !open) {
      previewOpen = false;
      logToTauri("[preview state] ignore close while sleeping");
      return;
    }

    resetInactivity("preview-state");
    previewOpen = open;
    if (previewOpen) {
      pinnedOpen = true; // 进入预览视为用户明确打开
      setMode("preview", "preview-open");
    } else {
      // 关闭预览后展开三个窗口（仍处于打开态）
      if (pinnedOpen || hoverOpen) setMode("open", "preview-close");
      else setMode("waiting", "preview-close");
    }
  });

  // 进入 sleep 时，隐藏所有 overlay（面板/预览）
  store.subscribe((status) => {
    if (status === "sleep") {
      invoke("close_preview").catch(() => {});
      invoke("set_panel_visibility", { open: false }).catch(() => {});
      stopClipboardPolling();
    }
  });
}
