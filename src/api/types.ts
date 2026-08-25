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
  detail: string;
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
