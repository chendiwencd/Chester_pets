import type { PetStatus } from "./store";

// 桩接口：本轮桌面交互层不接后端，先本地 mock。
// 未来后端服务层接入时，只替换这个模块的实现（比如换成 fetch/WebSocket），
// petView.ts 等交互代码不需要感知具体传输方式。
export interface BackendClient {
  reportStatus(status: PetStatus): void;
  fetchPetConfig(): Promise<Record<string, unknown>>;
}

export const backendClient: BackendClient = {
  reportStatus(status) {
    console.debug("[backendClient mock] reportStatus", status);
  },
  async fetchPetConfig() {
    return {};
  },
};
