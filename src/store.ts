export type PetStatus = "waiting" | "open" | "moving" | "sleep" | "waitting_file";
export type MovingDirection = "left" | "right";

export const STATUS_TEXT: Record<PetStatus, string> = {
  waiting: "等待",
  open: "打开",
  moving: "移动",
  sleep: "休眠",
  waitting_file: "等待文件",
};

type Listener = (status: PetStatus) => void;

export class PetStatusStore {
  private status: PetStatus = "waiting";
  private listeners = new Set<Listener>();

  private notify(): void {
    for (const listener of this.listeners) listener(this.status);
  }

  setStatus(status: PetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.notify();
  }

  get(): PetStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
