import { describe, expect, it } from "vitest";
import { HoldStateMachine } from "../src/holdStateMachine";

function createRecorder() {
  const events: string[] = [];
  const moves: Array<[number, number]> = [];
  const machine = new HoldStateMachine({
    onHoverChange: (hovering) => events.push(hovering ? "hover:on" : "hover:off"),
    onDragStart: () => events.push("drag:start"),
    onDragMove: (x, y) => {
      moves.push([x, y]);
      events.push("drag:move");
    },
    onDragEnd: () => events.push("drag:end"),
    onClick: () => events.push("click"),
  });
  return { machine, events, moves };
}

describe("HoldStateMachine - 悬浮意图(500ms)", () => {
  it("进入后立刻计时触发 -> hover:on", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerEnter();
    machine.handleHoverIntentElapsed();
    expect(events).toEqual(["hover:on"]);
  });

  it("计时触发前就离开 -> 不触发 hover:on，也不触发 hover:off", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerEnter();
    machine.handlePointerLeave();
    expect(events).toEqual([]);
  });

  it("计时触发前离开后，过期的计时器事件不应再补触发 hover:on", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerEnter();
    machine.handlePointerLeave();
    machine.handleHoverIntentElapsed();
    expect(events).toEqual([]);
  });

  it("hover:on 之后离开 -> hover:off", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerEnter();
    machine.handleHoverIntentElapsed();
    machine.handlePointerLeave();
    expect(events).toEqual(["hover:on", "hover:off"]);
  });
});

describe("HoldStateMachine - 长按(350ms)/单击/拖动", () => {
  it("按下后在长按计时触发前松开 -> 判定为单击", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerDown(10, 10);
    machine.handlePointerUp();
    expect(events).toEqual(["click"]);
  });

  it("长按计时触发 -> 进入拖动，移动时按 screen 坐标减去按下时的本地偏移回调 onDragMove", () => {
    const { machine, events, moves } = createRecorder();
    machine.handlePointerDown(10, 10);
    machine.handleLongPressElapsed();
    machine.handlePointerMove({ screenX: 120, screenY: 130 });
    expect(events).toEqual(["drag:start", "drag:move"]);
    expect(moves).toEqual([[110, 120]]);
  });

  it("拖动中松开 -> drag:end，且不触发 click", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerDown(10, 10);
    machine.handleLongPressElapsed();
    machine.handlePointerMove({ screenX: 120, screenY: 130 });
    machine.handlePointerUp();
    expect(events).toEqual(["drag:start", "drag:move", "drag:end"]);
    expect(events).not.toContain("click");
  });

  it("松开之后才触发的长按计时器（petView.ts 本应已 clearTimeout）不应再进入拖动", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerDown(10, 10);
    machine.handlePointerUp();
    machine.handleLongPressElapsed();
    expect(events).toEqual(["click"]);
  });

  it("拖动状态下悬浮意图触发不会进入打开(拖动优先级更高)", () => {
    const { machine, events } = createRecorder();
    machine.handlePointerEnter();
    machine.handlePointerDown(10, 10);
    machine.handleLongPressElapsed();
    machine.handleHoverIntentElapsed();
    expect(events).toEqual(["drag:start"]);
  });

  it("isDragging() 反映当前是否处于拖动状态", () => {
    const { machine } = createRecorder();
    expect(machine.isDragging()).toBe(false);
    machine.handlePointerDown(0, 0);
    machine.handleLongPressElapsed();
    expect(machine.isDragging()).toBe(true);
    machine.handlePointerUp();
    expect(machine.isDragging()).toBe(false);
  });
});
