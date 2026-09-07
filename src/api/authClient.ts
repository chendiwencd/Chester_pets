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
  DesktopActionRead,
  DesktopAgentAssistantMessageEvent,
  DesktopAgentDocumentEvent,
  DesktopAgentDeltaEvent,
  DesktopAgentErrorEvent,
  DesktopAgentDoneEvent,
  AgentInvokeRequest,
  DesktopAgentInvokeRequest,
  DesktopAgentInvokeResponse,
  DesktopAgentStreamHandlers,
  DesktopActionResultRequest,
  FileReaderResponse,
  TextUploadRequest,
  TextUploadResponse,
  AgentThreadPage,
  AgentThreadMessagesPage,
} from "./types";

export type { FileReaderResponse } from "./types";

export interface FileReaderOptions {
  aiSummary?: boolean;
  indexEmbeddings?: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:5000";

function formatApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as ApiError).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || item.type || "请求参数错误").join("; ");
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDesktopActionRead(value: unknown): value is DesktopActionRead {
  if (!isRecord(value)) return false;
  return (
    typeof value.action_id === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.tool_name === "string" &&
    isRecord(value.arguments) &&
    typeof value.display_text === "string" &&
    typeof value.risk_level === "string" &&
    typeof value.requires_confirmation === "boolean" &&
    typeof value.status === "string"
  );
}

function isDesktopDocumentRead(value: unknown): value is DesktopAgentDocumentEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.file_id === "string" &&
    typeof value.file_name === "string" &&
    typeof value.chunk_id === "string" &&
    typeof value.chunk_index === "number" &&
    Number.isInteger(value.chunk_index) &&
    typeof value.content === "string" &&
    isRecord(value.metadata) &&
    typeof value.score === "number"
  );
}

function collectDesktopActions(value: unknown): DesktopActionRead[] {
  if (isDesktopActionRead(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectDesktopActions);
  if (!isRecord(value)) return [];
  const candidates = [
    value.action,
    value.actions,
    value.desktop_action,
    value.desktop_actions,
    value.proposed_action,
    value.proposed_actions,
    value.tool_call,
    value.tool_calls,
  ];
  return candidates.flatMap(collectDesktopActions);
}

function collectDesktopDocuments(value: unknown): DesktopAgentDocumentEvent[] {
  if (isDesktopDocumentRead(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectDesktopDocuments);
  if (!isRecord(value)) return [];
  const candidates = [
    value.document,
    value.documents,
    value.desktop_document,
    value.desktop_documents,
    value.chunk,
    value.chunks,
  ];
  return candidates.flatMap(collectDesktopDocuments);
}

function extractDesktopMessageText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return null;
  const keys = [
    "text",
    "response_text",
    "output_text",
    "message",
    "answer",
    "display_text",
    "content",
    "response",
  ];
  for (const key of keys) {
    const next = value[key];
    if (typeof next === "string" && next.trim()) return next.trim();
  }
  return null;
}

function toDesktopAgentEventPayload(value: unknown): {
  assistantMessage?: DesktopAgentAssistantMessageEvent;
  documents: DesktopAgentDocumentEvent[]; 
  actions: DesktopActionRead[];
  done?: DesktopAgentDoneEvent;
} {
  const documents = collectDesktopDocuments(value);
  const actions = collectDesktopActions(value);
  const threadId = isRecord(value) && typeof value.thread_id === "string" ? value.thread_id : actions[0]?.thread_id;
  const text = extractDesktopMessageText(value);
  return {
    assistantMessage: threadId && text ? { thread_id: threadId, text } : undefined,
    documents,
    actions,
    done: threadId ? { thread_id: threadId } : undefined,
  };
}

function toDesktopAgentDeltaPayload(value: unknown): DesktopAgentDeltaEvent | null {
  if (!isRecord(value)) return null;
  const threadId = typeof value.thread_id === "string" ? value.thread_id : "";
  const text = extractDesktopMessageText(value);
  if (!threadId || text === null) return null;
  return {
    thread_id: threadId,
    text,
    agent: typeof value.agent === "string" ? value.agent : undefined,
  };
}

function toDesktopAgentErrorPayload(value: unknown): DesktopAgentErrorEvent | null {
  if (!isRecord(value)) return null;
  const threadId = typeof value.thread_id === "string" ? value.thread_id : "";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!threadId || !message) return null;
  return {
    thread_id: threadId,
    agent: typeof value.agent === "string" ? value.agent : undefined,
    message,
  };
}

export class ApiClient {
  private baseURL: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseURL: string = API_BASE_URL) {
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

  async invokeAgent(data: AgentInvokeRequest): Promise<DesktopAgentInvokeResponse> {
    return this.request<DesktopAgentInvokeResponse>("/api/v1/agent/invoke", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async invokeDesktopAgent(data: DesktopAgentInvokeRequest): Promise<DesktopAgentInvokeResponse> {
    return this.invokeAgent(data);
  }

  async listAgentThreads(page = 1, pageSize = 20): Promise<AgentThreadPage> {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    return this.request<AgentThreadPage>(`/api/v1/agent/history?${params.toString()}`);
  }

  async listAgentThreadMessages(
    threadId: string,
    page = 1,
    pageSize = 50,
  ): Promise<AgentThreadMessagesPage> {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    return this.request<AgentThreadMessagesPage>(
      `/api/v1/agent/history/${encodeURIComponent(threadId)}/messages?${params.toString()}`,
    );
  }

  async reportDesktopActionResult(
    actionId: string,
    data: DesktopActionResultRequest,
  ): Promise<DesktopActionRead> {
    return this.request<DesktopActionRead>(`/api/v1/agent/desktop/actions/${actionId}/result`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async streamAgent(
    data: AgentInvokeRequest,
    handlers: DesktopAgentStreamHandlers = {},
  ): Promise<DesktopAgentInvokeResponse | null> {
    const url = `${this.baseURL}/api/v1/agent/invoke`;
    const response = await this.fetchWithAuthRetry(
      url,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
      true,
    );

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.status === 401) {
        throw new Error("鉴权错误");
      }
      const error = { detail: formatApiError(payload, `HTTP ${response.status}`) };
      throw new Error(error.detail || "请求错误");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const payload = (await response.json()) as DesktopAgentInvokeResponse;
      const structured = toDesktopAgentEventPayload(payload);
      if (structured.assistantMessage) {
        handlers.onAssistantMessage?.(structured.assistantMessage);
      }
      for (const document of structured.documents) {
        handlers.onDocument?.(document);
      }
      for (const action of structured.actions) {
        handlers.onActionProposed?.(action);
      }
      if (structured.done) {
        handlers.onDone?.(structured.done);
      }
      return payload;
    }

    if (!response.body) {
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex >= 0) {
          const chunk = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          this.dispatchDesktopAgentSseChunk(chunk, handlers);
          splitIndex = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        this.dispatchDesktopAgentSseChunk(buffer, handlers);
      }
    } finally {
      reader.releaseLock();
    }

    return null;
  }

  async streamDesktopAgent(
    data: DesktopAgentInvokeRequest,
    handlers: DesktopAgentStreamHandlers = {},
  ): Promise<DesktopAgentInvokeResponse | null> {
    return this.streamAgent(data, handlers);
  }

  private dispatchDesktopAgentSseChunk(
    chunk: string,
    handlers: DesktopAgentStreamHandlers,
  ): void {
    const lines = chunk.split(/\r?\n/);
    let eventName = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }

    if (!eventName) return;
    const rawData = dataLines.join("\n");
    let payload: unknown = rawData;
    if (rawData) {
      try {
        payload = JSON.parse(rawData);
      } catch {
        payload = rawData;
      }
    }

    switch (eventName) {
      case "assistant.message": {
        const structured = toDesktopAgentEventPayload(payload);
        if (structured.assistantMessage) {
          handlers.onAssistantMessage?.(structured.assistantMessage);
        }
        for (const document of structured.documents) {
          handlers.onDocument?.(document);
        }
        return;
      }
      case "assistant.delta": {
        const structured = toDesktopAgentDeltaPayload(payload);
        if (structured) {
          handlers.onAssistantDelta?.(structured);
        }
        return;
      }
      case "document": {
        if (isDesktopDocumentRead(payload)) {
          handlers.onDocument?.(payload);
        }
        return;
      }
      case "action.proposed": {
        if (isDesktopActionRead(payload)) {
          handlers.onActionProposed?.(payload);
        }
        return;
      }
      case "agent.error": {
        const structured = toDesktopAgentErrorPayload(payload);
        if (structured) {
          handlers.onAgentError?.(structured);
        }
        return;
      }
      case "done": {
        const structured = toDesktopAgentEventPayload(payload);
        if (structured.done) {
          handlers.onDone?.(structured.done);
        }
        return;
      }
      default:
        return;
    }
  }

  async fileReader(
    file: Blob,
    fileName: string,
    mimeType?: string | null,
    options: FileReaderOptions = {},
  ): Promise<FileReaderResponse> {
    const form = new FormData();
    form.append("ai_summary", String(options.aiSummary ?? false));
    form.append("index_embeddings", String(options.indexEmbeddings ?? false));
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
