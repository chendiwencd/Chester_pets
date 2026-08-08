export const LONG_PRESS_MS = 350;
export const HOVER_INTENT_MS = 500;

export interface PointerPoint {
  screenX: number;
  screenY: number;
}

export interface HoldStateMachineCallbacks {
  onHoverChange(hovering: boolean): void;
  onDragStart(): void;
  onDragMove(x: number, y: number): void;
  onDragEnd(): void;
  onClick(): void;
}

// 纯逻辑状态机，不持有定时器/DOM：长按(350ms 进入移动)和悬浮意图(500ms 进入打开)
// 两个计时器都由调用方(petView.ts)负责，到点后分别调用 handleLongPressElapsed() /
// handleHoverIntentElapsed()。这样单测可以直接按顺序调方法模拟"计时器触发"或
// "触发前已经取消"，不需要真实等待或伪造计时器。
export class HoldStateMachine {
  private pressed = false;
  private dragging = false;
  private pointerInside = false;
  private hovering = false;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private readonly callbacks: HoldStateMachineCallbacks) {}

  handlePointerEnter(): void {
    this.pointerInside = true;
  }

  handleHoverIntentElapsed(): void {
    if (!this.pointerInside || this.dragging || this.hovering) return;
    this.hovering = true;
    this.callbacks.onHoverChange(true);
  }

  handlePointerLeave(): void {
    this.pointerInside = false;
    if (this.hovering) {
      this.hovering = false;
      if (!this.dragging) this.callbacks.onHoverChange(false);
    }
  }

  // localX/localY：按下瞬间指针相对宠物窗口左上角的位置（对应 event.clientX/clientY）。
  handlePointerDown(localX: number, localY: number): void {
    this.pressed = true;
    this.dragging = false;
    this.offsetX = localX;
    this.offsetY = localY;
  }

  handleLongPressElapsed(): void {
    if (!this.pressed || this.dragging) return;
    this.dragging = true;
    this.callbacks.onDragStart();
  }

  handlePointerMove(point: PointerPoint): void {
    if (!this.dragging) return;
    this.callbacks.onDragMove(point.screenX - this.offsetX, point.screenY - this.offsetY);
  }

  handlePointerUp(): void {
    const wasDragging = this.dragging;
    this.pressed = false;
    this.dragging = false;
    if (wasDragging) {
      this.callbacks.onDragEnd();
    } else {
      this.callbacks.onClick();
    }
  }

  isDragging(): boolean {
    return this.dragging;
  }
}
