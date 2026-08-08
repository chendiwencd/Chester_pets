import type { PetRenderer } from "./renderer";
import type { MovingDirection, PetStatus } from "./store";

const STATUS_ASSET: Record<PetStatus, string> = {
  waiting: "/pet/waiting.gif",
  open: "/pet/open.gif",
  moving: "/pet/moving.gif",
  sleep: "/pet/corpse_hit.gif",
};

// 读取 public/pet/*.gif（约定见该目录下的 README.md）。moving 状态左右共用同一张侧面视角的图，
// 靠水平镜像表现方向，不用为两个方向各存一份。
export class SpriteRenderer implements PetRenderer {
  private readonly img: HTMLImageElement;
  private readonly preloaded = new Map<string, HTMLImageElement>();

  constructor(root: HTMLElement) {
    this.img = document.createElement("img");
    this.img.className = "pet-sprite";
    this.img.alt = "";
    root.innerHTML = "";
    root.appendChild(this.img);

    for (const src of Object.values(STATUS_ASSET)) {
      const preloaded = new Image();
      preloaded.src = src;
      this.preloaded.set(src, preloaded);
    }
  }

  render(status: PetStatus, direction: MovingDirection = "right"): void {
    const src = STATUS_ASSET[status];
    // 换 src 会重启 gif 播放；同一张图重复渲染时不要重置，避免动画一直从头跳。
    if (!this.img.src.endsWith(src)) {
      // waiting/open/moving 三张 gif 的画布尺寸不一致(取自不同动作导出，留白不同)，
      // object-fit:contain 会按各自比例重新居中缩放，切换的瞬间看起来像"原地跳一下/缩放一下"。
      // 在真正做逐帧裁剪对齐之前，先用淡出再淡入盖住这个跳变，观感上是过渡而不是故障。
      this.img.style.opacity = "0";
      const reveal = () => {
        this.img.style.opacity = "1";
      };
      this.img.onload = reveal;
      this.img.onerror = reveal;
      this.img.src = src;
      if (this.img.complete) {
        reveal();
      }
    } else {
      this.img.style.opacity = "1";
    }
    this.img.style.transform =
      status === "moving" && direction === "left" ? "scaleX(-1)" : "none";
  }
}
