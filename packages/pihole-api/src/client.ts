/**
 * Main Pi-hole API client.
 */

import { ActionsEndpoints } from "./endpoints/actions.js";
import { AuthEndpoints } from "./endpoints/auth.js";
import { ClientsEndpoints } from "./endpoints/clients.js";
import { ConfigEndpoints } from "./endpoints/config.js";
import { DhcpEndpoints } from "./endpoints/dhcp.js";
import { DnsEndpoints } from "./endpoints/dns.js";
import { DomainsEndpoints } from "./endpoints/domains.js";
import { GroupsEndpoints } from "./endpoints/groups.js";
import { HistoryEndpoints } from "./endpoints/history.js";
import { InfoEndpoints } from "./endpoints/info.js";
import { ListsEndpoints } from "./endpoints/lists.js";
import { LogsEndpoints } from "./endpoints/logs.js";
import { NetworkEndpoints } from "./endpoints/network.js";
import { QueriesEndpoints } from "./endpoints/queries.js";
import { StatsEndpoints } from "./endpoints/stats.js";
import { TeleporterEndpoints } from "./endpoints/teleporter.js";
import { type PiholeError, PiholeErrorCode, createError } from "./errors.js";
import { type HttpConfig, HttpClient } from "./http.js";
import { type Result, err } from "./result.js";
import { SessionManager } from "./session.js";
import type { EndpointsResponse } from "./types/index.js";

/** Client configuration options */
export interface PiholeClientConfig {
  /** Pi-hole server URL (e.g., "http://pi.hole") */
  baseUrl: string;

  /** Password for authentication */
  password?: string;

  /** Pre-existing session ID */
  sid?: string;

  /** Pre-existing CSRF token */
  csrf?: string;

  /** Request timeout in ms (default: 10000) */
  timeout?: number;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Auto-refresh sessions before expiry (default: true) */
  autoRefresh?: boolean;

  /** Seconds before session expiry to trigger refresh (default: 60) */
  refreshThreshold?: number;
}

/**
 * Pi-hole API client.
 *
 * Provides type-safe access to all Pi-hole v6 API endpoints.
 *
 * @example
 * ```typescript
 * const client = new PiholeClient({
 *   baseUrl: 'http://pi.hole',
 *   password: 'your-password',
 * });
 *
 * const stats = await client.stats.getSummary();
 * if (isOk(stats)) {
 *   console.log('Blocked:', stats.data.queries.blocked);
 * }
 * ```
 */
export class PiholeClient {
  private http: HttpClient;
  private session: SessionManager;

  /** Authentication endpoints */
  readonly auth: AuthEndpoints;

  /** DNS blocking control */
  readonly dns: DnsEndpoints;

  /** Statistics endpoints */
  readonly stats: StatsEndpoints;

  /** Query log endpoints */
  readonly queries: QueriesEndpoints;

  /** History endpoints */
  readonly history: HistoryEndpoints;

  /** Domain management endpoints */
  readonly domains: DomainsEndpoints;

  /** Group management endpoints */
  readonly groups: GroupsEndpoints;

  /** Client management endpoints */
  readonly clients: ClientsEndpoints;

  /** Adlist management endpoints */
  readonly lists: ListsEndpoints;

  /** DHCP endpoints */
  readonly dhcp: DhcpEndpoints;

  /** Configuration endpoints */
  readonly config: ConfigEndpoints;

  /** System info endpoints */
  readonly info: InfoEndpoints;

  /** Network endpoints */
  readonly network: NetworkEndpoints;

  /** Action endpoints */
  readonly actions: ActionsEndpoints;

  /** Log endpoints */
  readonly logs: LogsEndpoints;

  /** Teleporter endpoints */
  readonly teleporter: TeleporterEndpoints;

  constructor(config: PiholeClientConfig) {
    // Normalize base URL
    const baseUrl = config.baseUrl.replace(/\/+$/, "");

    // Initialize HTTP client
    const httpConfig: Partial<HttpConfig> = {
      baseUrl,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    };
    this.http = new HttpClient(httpConfig);

    // Initialize session manager
    this.session = new SessionManager(this.http, {
      password: config.password,
      sid: config.sid,
      csrf: config.csrf,
      autoRefresh: config.autoRefresh ?? true,
      refreshThreshold: config.refreshThreshold ?? 60,
    });

    // Helper to get auth headers with auto-session handling
    const getAuthHeaders = () => this.session.getAuthHeaders();

    // Initialize all endpoint groups
    this.auth = new AuthEndpoints(this.http, this.session, getAuthHeaders);
    this.dns = new DnsEndpoints(this.http, getAuthHeaders);
    this.stats = new StatsEndpoints(this.http, getAuthHeaders);
    this.queries = new QueriesEndpoints(this.http, getAuthHeaders);
    this.history = new HistoryEndpoints(this.http, getAuthHeaders);
    this.domains = new DomainsEndpoints(this.http, getAuthHeaders);
    this.groups = new GroupsEndpoints(this.http, getAuthHeaders);
    this.clients = new ClientsEndpoints(this.http, getAuthHeaders);
    this.lists = new ListsEndpoints(this.http, getAuthHeaders);
    this.dhcp = new DhcpEndpoints(this.http, getAuthHeaders);
    this.config = new ConfigEndpoints(this.http, getAuthHeaders);
    this.info = new InfoEndpoints(this.http, getAuthHeaders);
    this.network = new NetworkEndpoints(this.http, getAuthHeaders);
    this.actions = new ActionsEndpoints(this.http, getAuthHeaders);
    this.logs = new LogsEndpoints(this.http, getAuthHeaders);
    this.teleporter = new TeleporterEndpoints(this.http, getAuthHeaders);
  }

  /**
   * Connect to Pi-hole with optional TOTP.
   * Call this to explicitly authenticate before making requests.
   *
   * @param totp Optional TOTP code for 2FA
   */
  async connect(totp?: string): Promise<Result<void, PiholeError>> {
    const success = await this.session.authenticate(totp);
    if (success) {
      return { ok: true, data: undefined };
    }

    if (this.session.isTotpRequired()) {
      return err(
        createError(PiholeErrorCode.TotpRequired, "TOTP code required", 401),
      );
    }

    return err(
      createError(PiholeErrorCode.Unauthorized, "Authentication failed", 401),
    );
  }

  /**
   * Disconnect from Pi-hole (logout).
   */
  async disconnect(): Promise<Result<void, PiholeError>> {
    const success = await this.session.logout();
    if (success) {
      return { ok: true, data: undefined };
    }
    return err(createError(PiholeErrorCode.Unknown, "Logout failed", 0));
  }

  /**
   * Check if connected with a valid session.
   */
  isConnected(): boolean {
    return this.session.hasSession();
  }

  /**
   * Check if TOTP is required for authentication.
   */
  isTotpRequired(): boolean {
    return this.session.isTotpRequired();
  }

  /**
   * Set password for authentication.
   * Use this to change the password after client creation.
   */
  setPassword(password: string): void {
    this.session.setPassword(password);
  }

  /**
   * Test connection to Pi-hole server (without authenticating).
   */
  async testConnection(): Promise<Result<void, PiholeError>> {
    const result = await this.http.request<void>({
      method: "GET",
      path: "/api/auth",
      noRetry: true,
    });

    // 401 means server is reachable, just needs auth
    if (!result.ok && result.error.status === 401) {
      return { ok: true, data: undefined };
    }

    return result;
  }

  /**
   * Make an authenticated request.
   * Handles auto-login and session refresh.
   */
  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Result<T, PiholeError>> {
    // Ensure we have a valid session
    const hasSession = await this.session.ensureSession();
    if (!hasSession) {
      return err(
        createError(PiholeErrorCode.Unauthorized, "Not authenticated", 401),
      );
    }

    // Make request with auth headers
    const result = await this.http.request<T>(
      { method, path, body },
      this.session.getAuthHeaders(),
    );

    // Handle 401 by re-authenticating
    if (!result.ok && result.error.status === 401) {
      const reauthed = await this.session.handleUnauthorized();
      if (reauthed) {
        return this.http.request<T>(
          { method, path, body },
          this.session.getAuthHeaders(),
        );
      }
    }

    return result;
  }

  /**
   * Get list of available API endpoints.
   */
  async getEndpoints(): Promise<Result<EndpointsResponse, PiholeError>> {
    return this.http.request<EndpointsResponse>(
      {
        method: "GET",
        path: "/api/endpoints",
      },
      this.session.getAuthHeaders(),
    );
  }
}

/**
 * Create a Pi-hole client instance.
 *
 * @example
 * ```typescript
 * const client = createClient({
 *   baseUrl: 'http://pi.hole',
 *   password: 'your-password',
 * });
 * ```
 */
export function createClient(config: PiholeClientConfig): PiholeClient {
  return new PiholeClient(config);
}
