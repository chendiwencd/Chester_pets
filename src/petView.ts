import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, availableMonitors, cursorPosition } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
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
  // 待机漫步：每隔 12~30s 自己走一段（复用自动移动机制，走的是正常 moving 动画），不使用额外的
  // 待机动画。方向为任意角度（上下左右都行），距离比之前更大；左右朝向由自动移动循环按水平分量镜像。
  const IDLE_WANDER_MIN_MS = 12 * 1000;
  const IDLE_WANDER_MAX_MS = 30 * 1000;
  const IDLE_WANDER_MIN_DIST = 120;
  const IDLE_WANDER_MAX_DIST = 320;
  const CURSOR_FOLLOW_MS = 16;

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

  // 自动移动（全部使用物理像素，见文件顶部说明）
  let autoMoveFrame: number | undefined;
  let autoMoveLastTs: number | undefined;
  let currentPos: { x: number; y: number } | undefined; // 物理像素
  let autoMoveTarget: { x: number; y: number } | undefined; // 物理像素

  // 跨屏定位：整条移动管线用物理坐标 + 权威 API（cursorPosition / outerPosition / setPosition(Physical)），
  // 并把每个目标钳制进“显示器并集”，宠物永远不会落到屏幕外或双屏之间的空隙里。
  let monitorsCache: Array<{ x: number; y: number; w: number; h: number }> = [];
  let petPhysW = 120;
  let petPhysH = 120;
  const refreshMonitors = async () => {
    try {
      const monitors = await availableMonitors();
      monitorsCache = monitors.map((m) => ({
        x: m.position.x,
        y: m.position.y,
        w: m.size.width,
        h: m.size.height,
      }));
      const size = await appWindow.outerSize();
      petPhysW = size.width;
      petPhysH = size.height;
    } catch (err) {
      console.error("[petView] refreshMonitors failed", err);
    }
  };

  // 把窗口左上角(物理)夹进某块显示器内：选与目标矩形重叠最大的显示器，完全不重叠时选中心最近的一块。
  const clampToMonitors = (x: number, y: number): { x: number; y: number } => {
    if (monitorsCache.length === 0) return { x: Math.round(x), y: Math.round(y) };
    const w = petPhysW;
    const h = petPhysH;
    let best = monitorsCache[0];
    let bestScore = -Infinity;
    for (const m of monitorsCache) {
      const ox = Math.min(x + w, m.x + m.w) - Math.max(x, m.x);
      const oy = Math.min(y + h, m.y + m.h) - Math.max(y, m.y);
      const overlap = Math.max(0, ox) * Math.max(0, oy);
      let score: number;
      if (overlap > 0) {
        score = overlap;
      } else {
        const dcx = x + w / 2 - (m.x + m.w / 2);
        const dcy = y + h / 2 - (m.y + m.h / 2);
        score = -(dcx * dcx + dcy * dcy); // 越近越大（负得越小的越差）
      }
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    const maxX = Math.max(best.x, best.x + best.w - w);
    const maxY = Math.max(best.y, best.y + best.h - h);
    return {
      x: Math.round(Math.min(Math.max(x, best.x), maxX)),
      y: Math.round(Math.min(Math.max(y, best.y), maxY)),
    };
  };

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

  // 待机漫步调度：fire() 自身只在 mode==="waiting" 时才真正走一段，且总是重新排下一次，
  // 所以只要启动时排一次就会自我延续，不需要在每个状态切换处挂钩。
  let idleWanderTimer: number | undefined;
  const scheduleIdleWander = () => {
    window.clearTimeout(idleWanderTimer);
    const delay =
      IDLE_WANDER_MIN_MS + Math.random() * (IDLE_WANDER_MAX_MS - IDLE_WANDER_MIN_MS);
    idleWanderTimer = window.setTimeout(() => {
      if (mode === "waiting") {
        // 读当前真实物理位置作为漫步起点，选一个任意角度、随机距离的目标，钳制进显示器并集后交给自动移动。
        void appWindow
          .outerPosition()
          .then((outer) => {
            if (mode !== "waiting") return; // 读位置期间被用户交互打断
            currentPos = { x: outer.x, y: outer.y };
            const dist =
              IDLE_WANDER_MIN_DIST +
              Math.random() * (IDLE_WANDER_MAX_DIST - IDLE_WANDER_MIN_DIST);
            const angle = Math.random() * Math.PI * 2; // 任意方向：上下左右都可能
            const targetX = outer.x + Math.cos(angle) * dist;
            const targetY = outer.y + Math.sin(angle) * dist;
            setAutoMoveTarget(clampToMonitors(targetX, targetY));
          })
          .catch((err) => console.error("[petView] idle wander read position failed", err));
      }
      scheduleIdleWander();
    }, delay);
  };

  // 启动时进入等待态，开始计时
  setStatusFromMode();
  renderer.render(store.get(), movingDirection);
  logToTauri(`[pet init] status=${store.get()} direction=${movingDirection}`);
  resetInactivity("init");
  void refreshMonitors();
  scheduleIdleWander();

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
      if (!currentPos || !target) {
        autoMoveFrame = window.requestAnimationFrame(tick);
        return;
      }

      const last = autoMoveLastTs ?? ts;
      const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
      autoMoveLastTs = ts;

      const dx = target.x - currentPos.x;
      const dy = target.y - currentPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 1) {
        // 到达当前目标
        pendingPosition = { x: Math.round(target.x), y: Math.round(target.y) };
        flushPendingPosition();
        currentPos = { x: target.x, y: target.y };

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
        const nextX = currentPos.x + dx * ratio;
        const nextY = currentPos.y + dy * ratio;
        currentPos = { x: nextX, y: nextY };

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
    // 最后一道保险：无论目标怎么来的，落地前再钳制一次进显示器并集，宠物绝不会被设到屏幕外。
    const clamped = clampToMonitors(pendingPosition.x, pendingPosition.y);
    const { x, y } = clamped;
    positionRequestInFlight = true;
    appWindow
      .setPosition(new PhysicalPosition(x, y))
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

  // 拖动跟随：按下时记录“光标(物理) - 窗口左上角(物理)”的抓取偏移；拖动期间以固定频率
  // 采样全局物理光标位置，target = 光标 - 抓取偏移，钳制后交给自动移动。全程物理坐标，跨屏不会错。
  let grabOffset: { x: number; y: number } | undefined;
  let followTimer: number | undefined;
  let cursorSampleInFlight = false;
  const startCursorFollow = () => {
    if (followTimer !== undefined) return;
    followTimer = window.setInterval(() => {
      if (cursorSampleInFlight || !grabOffset) return;
      cursorSampleInFlight = true;
      cursorPosition()
        .then((cur) => {
          if (!grabOffset) return;
          setAutoMoveTarget(clampToMonitors(cur.x - grabOffset.x, cur.y - grabOffset.y));
        })
        .catch((err) => console.error("[petView] cursorPosition failed", err))
        .finally(() => {
          cursorSampleInFlight = false;
        });
    }, CURSOR_FOLLOW_MS);
  };
  const stopCursorFollow = () => {
    if (followTimer !== undefined) {
      window.clearInterval(followTimer);
      followTimer = undefined;
    }
  };

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

      // 拖动定位改为跟随全局物理光标（见 startCursorFollow），不再依赖 DOM 的 screenX/screenY。
      void refreshMonitors();
      startCursorFollow();
      setMode("moving", "dragStart");
    },
    // 定位由 startCursorFollow 负责，这里不再从 DOM 坐标算位置。
    onDragMove: () => {
      resetInactivity("dragMove");
    },
    onDragEnd: () => {
      resetInactivity("dragEnd");
      stopCursorFollow();
      grabOffset = undefined;
      // 松手后让滑行继续走到最后一个光标目标；到达时自动移动循环会切回等待。
      if (!autoMoveTarget) {
        stopAutoMove();
        setMode("waiting", "dragEnd:noTarget");
      }
    },
    onClick: () => {
      resetInactivity("click");

      // 点击宠物是一个三段循环：等待 -> 打开(三个面板) -> 存储区(剪贴板历史) -> 等待。
      if (mode === "open") {
        // 打开态再次点击 -> 展开存储区。这里不用手动 setMode("preview")：
        // open_storage 成功后 Rust 会发回 preview-state 事件，由下面的监听统一切换模式，
        // 避免命令失败时前端状态和真实窗口对不上。
        invoke("open_storage").catch((err) =>
          console.error("[petView] open_storage failed", err),
        );
        return;
      }

      if (mode === "preview") {
        // 存储区已经开着，再点一次才收起回到等待
        pinnedOpen = false;
        hoverOpen = false;
        previewOpen = false;
        suppressHoverUntilLeave = true;
        invoke("close_preview").catch(() => {});
        setMode("waiting", "click-close");
        return;
      }

      pinnedOpen = true;
      suppressHoverUntilLeave = false;
      setMode("open", "click-open");
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

    // 记录物理起点和抓取偏移（光标物理 - 窗口左上角物理），供拖动跟随使用。全程物理坐标。
    void Promise.all([appWindow.outerPosition(), cursorPosition()]).then(([outer, cur]) => {
      currentPos = { x: outer.x, y: outer.y };
      grabOffset = { x: cur.x - outer.x, y: cur.y - outer.y };
    });
  });

  window.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    // 拖动中的窗口定位由 startCursorFollow 用全局物理光标驱动，这里只把移动计入活跃度。
    resetInactivity("pointermove");
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
    stopCursorFollow();
    grabOffset = undefined;
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
