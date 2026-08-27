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

  constructor(baseURL: string = "http://127.0.0.1:5000") {
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
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
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

    const response = await fetch(`${this.baseURL}/api/v1/tools/file_reader`, {
      method: "POST",
      headers: this.getAuthHeader(),
      body: form,
    });

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      const error = { detail: formatApiError(payload, `HTTP ${response.status}`) };
      throw new Error(error.detail || "文件读取失败");
    }

    return (await response.json()) as FileReaderResponse;
  }
}

export const apiClient = new ApiClient();
