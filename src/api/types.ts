// API 请求和响应类型定义，与 backend schema 对应

export interface UserRead {
  id: string;
  email: string | null;
  phone: string | null;
  username: string;
  is_active: boolean;
  is_vip: boolean;
  vip_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

export interface CurrentSession {
  id: string;
  expires_at: string;
}

export interface AuthResponse {
  user: UserRead;
  tokens: TokenPair;
  session: CurrentSession;
  is_new_user: boolean;
}

export interface AccountLoginRequest {
  identifier: string;
  password: string;
}

export interface AccountRegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface PhoneLoginRequest {
  phone: string;
  code?: string;
  password?: string;
  username?: string;
  country_code?: string;
}

export interface PhoneCodeRequest {
  phone: string;
  scene: "login" | "reset_password";
  country_code?: string;
}

export interface SendCodeResponse {
  message: string;
  phone: string;
  interval_seconds: number;
  valid_seconds: number;
  verify_code?: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface SimpleMessageResponse {
  message: string;
}

export interface ApiError {
  detail: string | Array<{
    loc?: Array<string | number>;
    msg?: string;
    type?: string;
  }>;
  code?: string;
}

export interface OCRRequest {
  image_data_url: string;
  language?: string;
  context?: string;
}

export interface OCRInfo {
  subject: string;
  summary: string;
  key_points: string[];
  terms: string[];
}

export type OCRResponse = string;

export interface InfoRequest {
  text: string;
  language?: string;
  context?: string | null;
}

export type InfoResponse = string;

export interface TranslationRequest {
  text: string;
  target_language?: string;
  source_language?: string;
  mode?: "ai" | "basic";
  context?: string | null;
}

export interface TranslationResponse {
  mode: "ai" | "basic";
  provider: "openai" | "microsoft";
  source_language: string;
  target_language: string;
  translated_text: string;
  model?: string | null;
  note?: string | null;
}

export interface TextUploadRequest {
  text: string;
  file_name: string;
}

// 后端可能返回 message / file_id 等字段；这里保持宽松，避免 schema 轻微变化导致前端崩溃。
export interface TextUploadResponse {
  message?: string;
  file_id?: string;
}

export interface FileReaderDocument {
  page_content: string;
  metadata: Record<string, unknown>;
}

export interface FileReaderResponse {
  file_id: string;
  file_name: string;
  file_type: string;
  text: string;
  summary: string | null;
  used_ocr: boolean;
  documents: FileReaderDocument[];
}

export type DesktopActionRisk = "low" | "medium" | "high";

export interface DesktopToolCapability {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  risk_level: DesktopActionRisk;
  requires_confirmation: boolean;
}

export interface DesktopCapabilitiesPayload {
  capabilities: DesktopToolCapability[];
}

export interface DesktopClientContext {
  platform?: string;
  capabilities: DesktopToolCapability[];
}

export interface AgentInvokeRequest {
  thread_id: string;
  input_text: string;
  top_k?: number;
  file_id?: string | null;
  client?: DesktopClientContext | null;
}

export type DesktopAgentInvokeRequest = AgentInvokeRequest;

export interface DesktopActionRead {
  action_id: string;
  thread_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  reason: string;
  display_text: string;
  risk_level: DesktopActionRisk;
  requires_confirmation: boolean;
  status: "proposed" | "approved" | "success" | "error" | "cancelled";
  result_data?: Record<string, unknown> | null;
  error_message?: string | null;
}

export interface DesktopDocumentRead {
  file_id: string;
  file_name: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface DesktopAgentAssistantMessageEvent {
  thread_id: string;
  text: string;
}

export interface DesktopAgentDeltaEvent {
  thread_id: string;
  text: string;
  agent?: string;
}

export interface DesktopAgentDocumentEvent extends DesktopDocumentRead {
  thread_id?: string;
}

export interface DesktopAgentErrorEvent {
  thread_id: string;
  agent?: string;
  message: string;
}

export interface DesktopAgentDoneEvent {
  thread_id: string;
}

export interface DesktopAgentStreamHandlers {
  onAssistantMessage?: (event: DesktopAgentAssistantMessageEvent) => void;
  onAssistantDelta?: (event: DesktopAgentDeltaEvent) => void;
  onDocument?: (event: DesktopAgentDocumentEvent) => void;
  onActionProposed?: (action: DesktopActionRead) => void;
  onAgentError?: (event: DesktopAgentErrorEvent) => void;
  onDone?: (event: DesktopAgentDoneEvent) => void;
}

export interface AgentThreadRead {
  thread_id: string;
  status: string;
  last_activity_at: string;
  last_turn_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentThreadPage {
  items: AgentThreadRead[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
}

export interface AgentMessageRead {
  id: string;
  thread_id: string;
  turn_number: number;
  message_index: number;
  role: string;
  agent: string | null;
  content: string;
  stream_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentThreadMessagesPage {
  items: AgentMessageRead[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
}

export interface DesktopActionResultRequest {
  status: "success" | "error" | "cancelled";
  data?: Record<string, unknown>;
  error_message?: string | null;
}

export type DesktopAgentInvokeResponse = unknown;
