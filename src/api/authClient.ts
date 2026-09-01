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
  InfoRequest,
  InfoResponse,
  OCRRequest,
  OCRResponse,
  TranslationRequest,
  TranslationResponse,
  FileReaderResponse,
  TextUploadRequest,
  TextUploadResponse,
} from "./types";

export type { FileReaderResponse } from "./types";

export interface FileReaderOptions {
  aiSummary?: boolean;
}

function formatApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as ApiError).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || item.type || "请求参数错误").join("; ");
  }
  return fallback;
}

export class ApiClient {
  private baseURL: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseURL: string = "http://127.0.0.1:5000") {
    this.baseURL = baseURL;
  }

  private getAuthHeader(): Record<string, string> {
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private saveAuthResponseToStorage(response: AuthResponse): void {
    localStorage.setItem("user", JSON.stringify(response.user));
    localStorage.setItem("access_token", response.tokens.access_token);
    localStorage.setItem("refresh_token", response.tokens.refresh_token);
    localStorage.setItem("session_id", response.session.id);
  }

  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseURL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as AuthResponse;
      this.saveAuthResponseToStorage(payload);
      window.dispatchEvent(new CustomEvent("auth-refreshed"));
      return true;
    } catch {
      return false;
    }
  }

  private async ensureFreshToken(): Promise<boolean> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async fetchWithAuthRetry(
    url: string,
    options: RequestInit,
    allowRetry: boolean,
  ): Promise<Response> {
    const attempt = async () => {
      const headers = {
        ...this.getAuthHeader(),
        ...options.headers,
      } as HeadersInit;
      return fetch(url, { ...options, headers });
    };

    const response = await attempt();
    if (response.status !== 401 || !allowRetry) return response;

    const refreshed = await this.ensureFreshToken();
    if (!refreshed) {
      window.dispatchEvent(new CustomEvent("auth-expired"));
      return response;
    }

    return attempt();
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    const response = await this.fetchWithAuthRetry(url, { ...options, headers }, true);

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.status === 401) {
        throw new Error("登录已失效，请重新登录");
      }
      const error = { detail: formatApiError(payload, `HTTP ${response.status}`) };
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

  async ocrImage(data: OCRRequest): Promise<OCRResponse> {
    return this.request<OCRResponse>("/api/v1/tools/ocr", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async commandInfo(data: InfoRequest): Promise<InfoResponse> {
    return this.request<InfoResponse>("/api/v1/tools/command/info", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async translateText(data: TranslationRequest): Promise<TranslationResponse> {
    return this.request<TranslationResponse>("/api/v1/tools/translate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async textUpload(data: TextUploadRequest): Promise<TextUploadResponse> {
    return this.request<TextUploadResponse>("/api/v1/tools/text_upload", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async fileReader(
    file: Blob,
    fileName: string,
    mimeType?: string | null,
    options: FileReaderOptions = {},
  ): Promise<FileReaderResponse> {
    const form = new FormData();
    form.append("ai_summary", String(options.aiSummary ?? false));
    const upload = mimeType && file.type !== mimeType
      ? new Blob([file], { type: mimeType })
      : file;
    form.append("file", upload, fileName);

    const response = await this.fetchWithAuthRetry(`${this.baseURL}/api/v1/tools/file_reader`, {
      method: "POST",
      body: form,
      // FormData 不要设置 Content-Type（浏览器会自动带 boundary）
      headers: this.getAuthHeader(),
    }, true);

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.status === 401) {
        throw new Error("登录已失效，请重新登录");
      }
      const error = { detail: formatApiError(payload, `HTTP ${response.status}`) };
      throw new Error(error.detail || "文件读取失败");
    }

    return (await response.json()) as FileReaderResponse;
  }
}

export const apiClient = new ApiClient();
