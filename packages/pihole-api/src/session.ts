/**
 * Session manager for Pi-hole authentication.
 */

import { PiholeErrorCode } from "./errors.js";
import type { HttpClient } from "./http.js";
import { isOk } from "./result.js";
import type { AuthResponse, Session } from "./types/auth.js";

/** Session state */
export interface SessionState {
  /** Session ID */
  sid: string;
  /** CSRF token */
  csrf: string;
  /** Expiry timestamp (Unix ms) */
  expiresAt: number;
  /** Whether TOTP is required */
  totpRequired: boolean;
}

/** Session manager configuration */
export interface SessionConfig {
  /** Password for authentication */
  password?: string;
  /** Pre-existing session ID */
  sid?: string;
  /** Pre-existing CSRF token */
  csrf?: string;
  /** Auto-refresh sessions before expiry */
  autoRefresh: boolean;
  /** Seconds before expiry to trigger refresh */
  refreshThreshold: number;
}

/** Default session configuration */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  autoRefresh: true,
  refreshThreshold: 60,
};

/**
 * Manages Pi-hole session authentication.
 */
export class SessionManager {
  private http: HttpClient;
  private config: SessionConfig;
  private state: SessionState | null = null;
  private password: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(http: HttpClient, config: Partial<SessionConfig> = {}) {
    this.http = http;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };

    // Store password if provided
    if (config.password) {
      this.password = config.password;
    }

    // Initialize from pre-existing session
    if (config.sid && config.csrf) {
      this.state = {
        sid: config.sid,
        csrf: config.csrf,
        expiresAt: Date.now() + 300000, // Assume 5 minutes
        totpRequired: false,
      };
    }
  }

  /** Check if we have a valid session */
  hasSession(): boolean {
    return this.state !== null && !this.isExpired();
  }

  /** Check if session is expired */
  isExpired(): boolean {
    if (!this.state) return true;
    return Date.now() >= this.state.expiresAt;
  }

  /** Check if session needs refresh */
  needsRefresh(): boolean {
    if (!this.state || !this.config.autoRefresh) return false;
    const threshold = this.config.refreshThreshold * 1000;
    return Date.now() >= this.state.expiresAt - threshold;
  }

  /** Check if TOTP is required */
  isTotpRequired(): boolean {
    return this.state?.totpRequired ?? false;
  }

  /** Get auth headers for requests */
  getAuthHeaders(): Record<string, string> | undefined {
    if (!this.state) return undefined;
    return {
      "X-FTL-SID": this.state.sid,
      "X-FTL-CSRF": this.state.csrf,
    };
  }

  /** Set password for authentication */
  setPassword(password: string): void {
    this.password = password;
  }

  /** Clear session state */
  clear(): void {
    this.state = null;
    this.refreshPromise = null;
  }

  /**
   * Ensure we have a valid session, authenticating if necessary.
   */
  async ensureSession(): Promise<boolean> {
    // Already have valid session
    if (this.hasSession() && !this.needsRefresh()) {
      return true;
    }

    // Refresh in progress
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Need to authenticate
    this.refreshPromise = this.authenticate();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  /**
   * Authenticate with Pi-hole.
   */
  async authenticate(totp?: string): Promise<boolean> {
    if (!this.password) {
      return false;
    }

    const body: { password: string; totp?: string } = {
      password: this.password,
    };
    if (totp) {
      body.totp = totp;
    }

    const result = await this.http.request<AuthResponse>({
      method: "POST",
      path: "/api/auth",
      body,
      noRetry: true,
    });

    if (!isOk(result)) {
      // Check for TOTP requirement
      if (result.error.code === PiholeErrorCode.TotpRequired) {
        this.state = {
          sid: "",
          csrf: "",
          expiresAt: 0,
          totpRequired: true,
        };
      }
      return false;
    }

    const session = result.data.session;
    this.updateSession(session);
    return true;
  }

  /**
   * Logout and invalidate session.
   */
  async logout(): Promise<boolean> {
    if (!this.state) {
      return true;
    }

    const result = await this.http.request<void>(
      {
        method: "DELETE",
        path: "/api/auth",
        noRetry: true,
      },
      this.getAuthHeaders(),
    );

    // Always clear local session
    this.clear();

    // Treat 401 as success (already logged out)
    if (!isOk(result) && result.error.status === 401) {
      return true;
    }

    return isOk(result);
  }

  /**
   * Handle 401 response by re-authenticating.
   */
  async handleUnauthorized(): Promise<boolean> {
    this.state = null;
    return this.authenticate();
  }

  /**
   * Update session state from auth response.
   */
  private updateSession(session: Session): void {
    this.state = {
      sid: session.sid,
      csrf: session.csrf,
      expiresAt: Date.now() + session.validity * 1000,
      totpRequired: false,
    };
  }
}
