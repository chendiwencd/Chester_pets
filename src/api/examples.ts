// 认证系统使用示例

import { authStore } from "../authStore";
import { apiClient, ApiClient } from "../api/authClient";

// ==================== 1. 监听认证状态变化 ====================

// 订阅状态更新
authStore.subscribe((state) => {
  console.log("认证状态变更:", state);
  console.log("是否登录:", state.isLoggedIn);
  console.log("用户信息:", state.user);
  console.log("在线模式:", state.onlineMode);
});

// 取消订阅示例
// const unsubscribe = authStore.subscribe(() => {});
// unsubscribe();

// ==================== 2. 获取当前状态 ====================

const currentState = authStore.getState();
if (currentState.isLoggedIn) {
  console.log("当前用户:", currentState.user?.username);
}

// ==================== 3. 账号注册 ====================

async function registerExample() {
  try {
    await authStore.accountRegister(
      "user@example.com",
      "myusername",
      "mypassword123"
    );
    console.log("注册成功！");
  } catch (error) {
    console.error("注册失败:", error);
  }
}

// ==================== 4. 账号登录 ====================

async function loginExample() {
  try {
    // 可以使用用户名或邮箱登录
    await authStore.accountLogin("myusername", "mypassword123");
    console.log("登录成功！");
  } catch (error) {
    console.error("登录失败:", error);
  }
}

// ==================== 5. 手机号登录（验证码） ====================

async function phoneLoginWithCodeExample() {
  try {
    // 先发送验证码
    const codeResult = await apiClient.sendPhoneCode({
      phone: "13800138000",
      scene: "login",
    });
    console.log("验证码已发送:", codeResult);

    // 用户输入验证码后登录
    await authStore.phoneLogin(
      "13800138000",
      { code: "123456" },
      "myusername" // 可选，仅在自动注册时生效
    );
    console.log("手机号登录成功！");
  } catch (error) {
    console.error("手机号登录失败:", error);
  }
}

// ==================== 6. 手机号登录（密码） ====================

async function phoneLoginWithPasswordExample() {
  try {
    await authStore.phoneLogin(
      "13800138000",
      { password: "mypassword123" }
    );
    console.log("手机号密码登录成功！");
  } catch (error) {
    console.error("手机号密码登录失败:", error);
  }
}

// ==================== 7. 刷新 Token ====================

async function refreshTokenExample() {
  try {
    await authStore.refreshToken();
    console.log("Token 刷新成功！");
  } catch (error) {
    console.error("Token 刷新失败:", error);
  }
}

// ==================== 8. 登出 ====================

async function logoutExample() {
  try {
    await authStore.logout();
    console.log("已登出");
  } catch (error) {
    console.error("登出失败:", error);
  }
}

// ==================== 9. 在线/离线模式切换 ====================

function toggleOnlineMode() {
  const currentState = authStore.getState();
  authStore.setOnlineMode(!currentState.onlineMode);
  console.log("在线模式已切换为:", !currentState.onlineMode);
}

// ==================== 10. 直接调用 API（低级操作） ====================

async function directApiExample() {
  try {
    // 自定义 API 基础 URL
    const customClient = new ApiClient("https://api.example.com");

    // 直接调用接口
    const response = await customClient.accountLogin({
      identifier: "user@example.com",
      password: "password123",
    });

    console.log("登录响应:", response);
    console.log("Access Token:", response.tokens.access_token);
    console.log("用户信息:", response.user);
  } catch (error) {
    console.error("API 调用失败:", error);
  }
}

// ==================== 11. 在 backendClient 中使用认证状态 ====================

import { backendClient } from "../backendClient";

function exampleBackendIntegration() {
  // backendClient 会自动检查 authStore 的在线模式和登录状态
  // 仅在在线且已登录时才会真正调用后端 API

  backendClient.reportStatus("moving");
  // 离线模式：仅本地 log
  // 在线且已登录：调用后端 API

  backendClient.fetchPetConfig().then((config: Record<string, unknown>) => {
    console.log("宠物配置:", config);
  });
}

// ==================== 12. Token 自动管理 ====================

// Token 自动存储到 localStorage，页面刷新后自动恢复
// authStore 构造时会自动从 localStorage 加载：
// - user
// - access_token
// - refresh_token
// - session_id
// - online_mode

// 当调用 logout() 时，这些数据会被自动清理

export {
  registerExample,
  loginExample,
  phoneLoginWithCodeExample,
  phoneLoginWithPasswordExample,
  refreshTokenExample,
  logoutExample,
  toggleOnlineMode,
  directApiExample,
  exampleBackendIntegration,
};
