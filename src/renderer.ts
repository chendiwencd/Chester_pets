import { STATUS_TEXT, type MovingDirection, type PetStatus } from "./store";

export interface PetRenderer {
  // direction 只在 status === "moving" 时有意义(向左/向右)，其它状态的实现可以忽略这个参数。
  render(status: PetStatus, direction?: MovingDirection): void;
}

// 纯文字实现，早期没有美术资源时用来占位，现在 petView.ts 默认用的是同接口的
// SpriteRenderer(见 spriteRenderer.ts)。留着这个类主要是给以后接真正的骨骼动画时
// 参考"实现同一个 PetRenderer 接口就能整体替换"这个模式，交互逻辑(petView.ts)不用改。
export class TextRenderer implements PetRenderer {
  constructor(private readonly root: HTMLElement) {}

  render(status: PetStatus): void {
    this.root.textContent = STATUS_TEXT[status] ?? status;
  }
}
