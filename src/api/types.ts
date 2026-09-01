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
