/**
 * Authentication endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { SessionManager } from "../session.js";
import type {
  AppPassword,
  AuthResponse,
  AuthStatus,
  LoginOptions,
  SessionInfo,
  SessionsResponse,
  TotpSetup,
} from "../types/auth.js";

/**
 * Authentication endpoint methods.
 */
export class AuthEndpoints {
  constructor(
    private http: HttpClient,
    _session: SessionManager,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {
    // Session manager is passed but not used directly here;
    // auth endpoints use HTTP client directly
    void _session;
  }

  /**
   * Login with password.
   * @param password Pi-hole password
   * @param options Login options (TOTP code, etc.)
   */
  async login(
    password: string,
    options?: LoginOptions,
  ): Promise<Result<AuthResponse, PiholeError>> {
    const body: { password: string; totp?: string } = { password };
    if (options?.totp) {
      body.totp = options.totp;
    }

    return this.http.request<AuthResponse>({
      method: "POST",
      path: "/api/auth",
      body,
      noRetry: true,
    });
  }

  /**
   * Logout and invalidate current session.
   */
  async logout(): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: "/api/auth",
        noRetry: true,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Check current authentication status.
   */
  async check(): Promise<Result<AuthStatus, PiholeError>> {
    return this.http.request<AuthStatus>(
      {
        method: "GET",
        path: "/api/auth",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get all active sessions.
   */
  async getSessions(): Promise<Result<SessionInfo[], PiholeError>> {
    const result = await this.http.request<SessionsResponse>(
      {
        method: "GET",
        path: "/api/auth/sessions",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.sessions };
    }
    return result;
  }

  /**
   * Delete a specific session.
   * @param id Session ID to delete
   */
  async deleteSession(id: number): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/auth/session/${id}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Generate TOTP setup for 2FA.
   */
  async generateTotp(): Promise<Result<TotpSetup, PiholeError>> {
    return this.http.request<TotpSetup>(
      {
        method: "GET",
        path: "/api/auth/totp",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Create an app password.
   */
  async createAppPassword(): Promise<Result<AppPassword, PiholeError>> {
    return this.http.request<AppPassword>(
      {
        method: "GET",
        path: "/api/auth/app",
      },
      this.getAuthHeaders(),
    );
  }
}
