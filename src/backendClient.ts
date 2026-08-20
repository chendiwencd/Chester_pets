import type { PetStatus } from "./store";
import { authStore } from "./authStore";

// Backend 客户端接口
// 原有桌面交互层的 mock 接口 + 新增的实际 API 通信能力
export interface BackendClient {
  reportStatus(status: PetStatus): void;
  fetchPetConfig(): Promise<Record<string, unknown>>;
}

export const backendClient: BackendClient = {
  reportStatus(status) {
    const authState = authStore.getState();

    // 在线模式且已登录时，上报状态到后端
    if (authState.onlineMode && authState.isLoggedIn) {
      console.debug("[backendClient] reportStatus (online)", status);
      // TODO: 实际调用后端 API 上报宠物状态
      // 例如: apiClient.reportPetStatus({ status })
    } else {
      console.debug("[backendClient] reportStatus (offline)", status);
    }
  },

  async fetchPetConfig() {
    const authState = authStore.getState();

    // 在线模式且已登录时，从后端获取配置
    if (authState.onlineMode && authState.isLoggedIn) {
      console.debug("[backendClient] fetchPetConfig (online)");
      // TODO: 实际调用后端 API 获取宠物配置
      // 例如: return apiClient.getPetConfig()
      return {};
    } else {
      console.debug("[backendClient] fetchPetConfig (offline)");
      return {};
    }
  },
};
