import type {
  AccountLoginRequest,
  AccountRegisterRequest,
  AuthResponse,
  PhoneCodeRequest,
  PhoneLoginRequest,
  RefreshTokenRequest,
  SendCodeResponse,
  SimpleMessageResponse,
  ApiError,
} from "./types";

export class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = "http://127.0.0.1:8000") {
    this.baseURL = baseURL;
  }

  private getAuthHeader(): Record<string, string> {
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const headers = {
      "Content-Type": "application/json",
      ...this.getAuthHeader(),
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      let error: ApiError;
      try {
        error = (await response.json()) as ApiError;
      } catch {
        error = { detail: `HTTP ${response.status}` };
      }
      throw new Error(error.detail || "请求失败");
    }

    return response.json() as Promise<T>;
  }

  // 账号场景：注册
  async accountRegister(data: AccountRegisterRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/v1/auth/account/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 账号场景：登录
  async accountLogin(data: AccountLoginRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/v1/auth/account/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 手机号场景：发送验证码
  async sendPhoneCode(data: PhoneCodeRequest): Promise<SendCodeResponse> {
    return this.request<SendCodeResponse>("/api/v1/auth/phone/code", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 手机号场景：登录（验证码或密码）
  async phoneLogin(data: PhoneLoginRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/v1/auth/phone/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 刷新 token
  async refreshToken(data: RefreshTokenRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 登出
  async logout(): Promise<SimpleMessageResponse> {
    return this.request<SimpleMessageResponse>("/api/v1/auth/logout", {
      method: "POST",
    });
  }
}

export const apiClient = new ApiClient();
