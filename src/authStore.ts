import type { UserRead, AuthResponse } from "./api/types";
import { apiClient } from "./api/authClient";

export interface AuthState {
  user: UserRead | null;
  isLoggedIn: boolean;
  onlineMode: boolean;
}

export interface SavedLoginCredentials {
  identifier: string;
  password: string;
}

type AuthListener = (state: AuthState) => void;

const SAVED_LOGIN_CREDENTIALS_KEY = "saved_login_credentials";

class AuthStore {
  private state: AuthState = {
    user: null,
    isLoggedIn: false,
    onlineMode: false,
  };
  private listeners = new Set<AuthListener>();

  constructor() {
    this.loadFromStorage();
    window.addEventListener("auth-expired", () => {
      // token/refresh 失效：强制回到未登录态，让 UI 进入登录流程
      this.clearAuth();
    });
    window.addEventListener("auth-refreshed", () => {
      // 其他窗口触发 refresh 后，同步本窗口的 auth 状态
      this.loadFromStorage();
      this.notify();
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private loadFromStorage(): void {
    try {
      const userStr = localStorage.getItem("user");
      const onlineMode = localStorage.getItem("online_mode") === "true";

      if (userStr) {
        const user = JSON.parse(userStr) as UserRead;
        this.state = {
          user,
          isLoggedIn: true,
          onlineMode,
        };
      } else {
        this.state.onlineMode = onlineMode;
      }
    } catch (err) {
      console.error("[authStore] loadFromStorage failed", err);
    }
  }

  private saveAuthResponse(response: AuthResponse): void {
    localStorage.setItem("user", JSON.stringify(response.user));
    localStorage.setItem("access_token", response.tokens.access_token);
    localStorage.setItem("refresh_token", response.tokens.refresh_token);
    localStorage.setItem("session_id", response.session.id);

    this.state = {
      ...this.state,
      user: response.user,
      isLoggedIn: true,
    };
    this.notify();
  }

  private clearAuth(): void {
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("session_id");

    this.state = {
      ...this.state,
      user: null,
      isLoggedIn: false,
    };
    this.notify();
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOnlineMode(enabled: boolean): void {
    localStorage.setItem("online_mode", String(enabled));
    this.state.onlineMode = enabled;
    this.notify();
  }

  getSavedLoginCredentials(): SavedLoginCredentials | null {
    try {
      const raw = localStorage.getItem(SAVED_LOGIN_CREDENTIALS_KEY);
      if (!raw) {
        return null;
      }

      const saved = JSON.parse(raw) as Partial<SavedLoginCredentials>;
      if (
        typeof saved.identifier !== "string" ||
        typeof saved.password !== "string" ||
        !saved.identifier ||
        !saved.password
      ) {
        return null;
      }

      return {
        identifier: saved.identifier,
        password: saved.password,
      };
    } catch (err) {
      console.error("[authStore] loadSavedLoginCredentials failed", err);
      return null;
    }
  }

  saveLoginCredentials(identifier: string, password: string): void {
    if (!identifier || !password) {
      return;
    }

    localStorage.setItem(
      SAVED_LOGIN_CREDENTIALS_KEY,
      JSON.stringify({ identifier, password }),
    );
  }

  async accountLogin(identifier: string, password: string): Promise<void> {
    this.saveLoginCredentials(identifier, password);
    const response = await apiClient.accountLogin({ identifier, password });
    this.saveAuthResponse(response);
  }

  async accountRegister(
    email: string,
    username: string,
    password: string,
  ): Promise<void> {
    const response = await apiClient.accountRegister({ email, username, password });
    this.saveAuthResponse(response);
  }

  async phoneLogin(
    phone: string,
    credential: { code: string } | { password: string },
    username?: string,
  ): Promise<void> {
    const request = {
      phone,
      username,
      ...credential,
    };
    const response = await apiClient.phoneLogin(request);
    this.saveAuthResponse(response);
  }

  async logout(): Promise<void> {
    try {
      if (this.state.isLoggedIn) {
        await apiClient.logout();
      }
    } catch (err) {
      console.error("[authStore] logout API failed", err);
    } finally {
      this.clearAuth();
    }
  }

  async refreshToken(): Promise<void> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await apiClient.refreshToken({ refresh_token: refreshToken });
    this.saveAuthResponse(response);
  }
}

export const authStore = new AuthStore();
