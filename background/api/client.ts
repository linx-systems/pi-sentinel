import { DEFAULTS, ENDPOINTS, RETRY_CONFIG, TIMEOUTS } from "~/utils/constants";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import { logger } from "~/utils/logger";
import type {
  ApiConfig,
  ApiResult,
  AuthResponse,
  BlockingStatus,
  DomainEntry,
  DomainListType,
  DomainMatchType,
  QueryEntry,
  QueryParams,
  SearchResult,
  StatsSummary,
} from "./types";

/**
 * Pi-hole v6 API Client
 *
 * All HTTP communication with Pi-hole goes through this client.
 * Handles authentication headers, error responses, and retries.
 */
export class PiholeApiClient {
  private config: ApiConfig;
  private sid: string | null = null;
  private csrf: string | null = null;
  private onAuthRequired: (() => Promise<boolean>) | null = null;

  constructor(config?: Partial<ApiConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || "",
      timeout: config?.timeout || DEFAULTS.API_TIMEOUT,
    };
  }

  /**
   * Set the Pi-hole server URL.
   */
  setBaseUrl(url: string): void {
    // Normalize URL: remove trailing slash
    this.config.baseUrl = url.replace(/\/+$/, "");
  }

  /**
   * Set session credentials.
   */
  setSession(sid: string, csrf: string): void {
    this.sid = sid;
    this.csrf = csrf;
  }

  /**
   * Clear session credentials.
   */
  clearSession(): void {
    this.sid = null;
    this.csrf = null;
  }

  /**
   * Set callback for handling auth required (401) responses.
   */
  setAuthRequiredHandler(handler: () => Promise<boolean>): void {
    this.onAuthRequired = handler;
  }

  /**
   * Check if we have a session.
   */
  hasSession(): boolean {
    return this.sid !== null;
  }

  /**
   * Authenticate with Pi-hole.
   * @param password The web interface password
   * @param totp Optional TOTP code for 2FA
   */
  async authenticate(
    password: string,
    totp?: string,
  ): Promise<ApiResult<AuthResponse>> {
    const body: { password: string; totp?: string } = { password };
    if (totp) {
      body.totp = totp;
    }

    const result = await this.request<AuthResponse>(
      "POST",
      ENDPOINTS.AUTH,
      body,
      false,
    );

    if (result.success && result.data?.session) {
      this.setSession(result.data.session.sid, result.data.session.csrf);
    }

    return result;
  }

  // ===== Authentication =====

  /**
   * Logout and invalidate session.
   */
  async logout(): Promise<ApiResult<void>> {
    const result = await this.request<void>("DELETE", ENDPOINTS.AUTH);
    this.clearSession();
    return result;
  }

  /**
   * Get summary statistics.
   */
  async getStats(): Promise<ApiResult<StatsSummary>> {
    return this.request("GET", ENDPOINTS.STATS_SUMMARY);
  }

  // ===== Statistics =====

  /**
   * Get current blocking status.
   */
  async getBlockingStatus(): Promise<ApiResult<BlockingStatus>> {
    return this.request("GET", ENDPOINTS.DNS_BLOCKING);
  }

  // ===== Blocking Control =====

  /**
   * Enable or disable blocking.
   * @param enabled Whether to enable blocking
   * @param timer Optional timer in seconds (0 = indefinite)
   */
  async setBlocking(
    enabled: boolean,
    timer?: number,
  ): Promise<ApiResult<BlockingStatus>> {
    const body: { blocking: boolean; timer?: number } = { blocking: enabled };
    if (timer !== undefined && timer > 0) {
      body.timer = timer;
    }
    return this.request("POST", ENDPOINTS.DNS_BLOCKING, body);
  }

  /**
   * Get recent queries.
   */
  async getQueries(params?: QueryParams): Promise<ApiResult<QueryEntry[]>> {
    const queryParams = new URLSearchParams();
    if (params?.length) queryParams.set("length", params.length.toString());
    if (params?.from) queryParams.set("from", params.from.toString());
    if (params?.until) queryParams.set("until", params.until.toString());
    if (params?.client) queryParams.set("client", params.client);
    if (params?.domain) queryParams.set("domain", params.domain);
    if (params?.type) queryParams.set("type", params.type);
    if (params?.status) queryParams.set("status", params.status);

    const query = queryParams.toString();
    const endpoint = query
      ? `${ENDPOINTS.QUERIES}?${query}`
      : ENDPOINTS.QUERIES;
    const result = await this.request<{ queries: QueryEntry[] }>(
      "GET",
      endpoint,
    );

    // Extract queries array from response
    if (result.success && result.data) {
      return {
        success: true,
        data: Array.isArray(result.data)
          ? result.data
          : result.data.queries || [],
      };
    }
    return result as unknown as ApiResult<QueryEntry[]>;
  }

  // ===== Query Log =====

  /**
   * Get domains from a list.
   */
  async getDomains(
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
  ): Promise<ApiResult<DomainEntry[]>> {
    const result = await this.request<{
      domains: DomainEntry[];
    }>("GET", this.getDomainEndpoint(listType, matchType));

    // Extract domains array from response
    if (result.success && result.data) {
      return {
        success: true,
        data: Array.isArray(result.data)
          ? result.data
          : result.data.domains || [],
      };
    }
    return result as unknown as ApiResult<DomainEntry[]>;
  }

  // ===== Domain Lists =====

  /**
   * Add a domain to a list.
   */
  async addDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
    comment?: string,
  ): Promise<ApiResult<DomainEntry>> {
    const body: { domain: string; comment?: string } = { domain };
    if (comment) body.comment = comment;
    return this.request(
      "POST",
      this.getDomainEndpoint(listType, matchType),
      body,
    );
  }

  /**
   * Remove a domain from a list.
   */
  async removeDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
  ): Promise<ApiResult<void>> {
    const endpoint = `${this.getDomainEndpoint(listType, matchType)}/${encodeURIComponent(domain)}`;
    return this.request("DELETE", endpoint);
  }

  /**
   * Search for a domain in gravity and lists.
   */
  async searchDomain(domain: string): Promise<ApiResult<SearchResult>> {
    return this.request(
      "GET",
      `${ENDPOINTS.SEARCH}/${encodeURIComponent(domain)}`,
    );
  }

  /**
   * Test connection to Pi-hole (unauthenticated).
   * Uses /api/auth with GET which returns session info or 401 - both indicate server is reachable.
   */
  async testConnection(url?: string): Promise<ApiResult<void>> {
    const testUrl = (url || this.config.baseUrl).replace(/\/+$/, "");

    if (!testUrl) {
      return {
        success: false,
        error: { key: "not_configured", message: "No URL provided", status: 0 },
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout,
      );

      const response = await fetch(`${testUrl}/api/auth`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 401 means server is reachable but we need to authenticate - that's fine for a connection test
      // 200 means we have a valid session
      if (response.status === 401 || response.ok) {
        return { success: true };
      }

      return {
        success: false,
        error: {
          key: "connection_failed",
          message: `Server returned ${response.status}`,
          status: response.status,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const isCertError =
        errorMessage.includes("SSL") ||
        errorMessage.includes("certificate") ||
        errorMessage.includes("CERT_") ||
        errorMessage.includes("SEC_ERROR") ||
        errorMessage.includes("NS_ERROR");

      return {
        success: false,
        error: {
          key: isTimeout
            ? "timeout"
            : isCertError
              ? "cert_error"
              : "network_error",
          message: isTimeout
            ? "Connection timed out"
            : isCertError
              ? "SSL certificate error. Open your Pi-hole URL in Firefox and accept the certificate first."
              : errorMessage,
          status: 0,
        },
      };
    }
  }

  // ===== Search =====

  /**
   * Make an authenticated API request with retry logic.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: object,
    retry = true,
  ): Promise<ApiResult<T>> {
    if (!this.config.baseUrl) {
      return {
        success: false,
        error: {
          key: "not_configured",
          message: "Pi-hole server URL not configured",
          status: 0,
        },
      };
    }

    // Wrap with retry logic for retryable errors
    return this.requestWithRetry(method, endpoint, body, retry);
  }

  /**
   * Execute request with exponential backoff retry logic.
   */
  private async requestWithRetry<T>(
    method: string,
    endpoint: string,
    body?: object,
    allowAuthRetry = true,
  ): Promise<ApiResult<T>> {
    let lastError: ApiResult<T> | null = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
      try {
        const result = await this.executeRequest<T>(
          method,
          endpoint,
          body,
          allowAuthRetry && attempt === 0,
        );

        // If successful, return immediately
        if (result.success) {
          if (attempt > 0) {
            logger.info(
              `Request succeeded after ${attempt} retries: ${method} ${endpoint}`,
            );
          }
          return result;
        }

        // Check if error is retryable
        const isRetryable =
          result.error?.status &&
          RETRY_CONFIG.RETRYABLE_STATUS_CODES.includes(result.error.status);

        // Don't retry auth errors (401, 403) or client errors (4xx)
        const isAuthError =
          result.error?.status === 401 || result.error?.status === 403;
        const isClientError =
          result.error?.status &&
          result.error.status >= 400 &&
          result.error.status < 500 &&
          !isRetryable;

        if (isAuthError || isClientError) {
          logger.debug(
            `Non-retryable error (${result.error?.status}): ${method} ${endpoint}`,
          );
          return result;
        }

        lastError = result;

        // If this was the last attempt, don't wait
        if (attempt >= RETRY_CONFIG.MAX_RETRIES) {
          break;
        }

        // Only retry if error is retryable or it's a network error
        if (!isRetryable && result.error?.status !== 0) {
          logger.debug(
            `Non-retryable error status ${result.error?.status}: ${method} ${endpoint}`,
          );
          return result;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          TIMEOUTS.RETRY_DELAY_BASE *
            Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt),
          TIMEOUTS.RETRY_DELAY_MAX,
        );

        logger.warn(
          `Request failed (attempt ${attempt + 1}/${RETRY_CONFIG.MAX_RETRIES + 1}), retrying in ${delay}ms: ${method} ${endpoint}`,
          result.error,
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        // Unexpected error during retry logic
        ErrorHandler.handle(
          error,
          `requestWithRetry(${method} ${endpoint})`,
          ErrorType.API,
        );

        lastError = {
          success: false,
          error: {
            key: "internal_error",
            message: error instanceof Error ? error.message : "Unknown error",
            status: 0,
          },
        };

        // Don't retry on unexpected errors
        break;
      }
    }

    // All retries exhausted
    logger.error(
      `Request failed after ${RETRY_CONFIG.MAX_RETRIES + 1} attempts: ${method} ${endpoint}`,
      lastError?.error,
    );

    return (
      lastError || {
        success: false,
        error: {
          key: "unknown_error",
          message: "Request failed",
          status: 0,
        },
      }
    );
  }

  /**
   * Execute a single request attempt.
   */
  private async executeRequest<T>(
    method: string,
    endpoint: string,
    body?: object,
    allowAuthRetry = true,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add auth headers if we have a session
    if (this.sid) {
      headers["X-FTL-SID"] = this.sid;
    }
    if (this.csrf) {
      headers["X-FTL-CSRF"] = this.csrf;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout,
      );

      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - session expired (only retry on first attempt)
      if (response.status === 401 && allowAuthRetry && this.onAuthRequired) {
        logger.debug("Session expired, attempting re-authentication");
        const reauthed = await this.onAuthRequired();
        if (reauthed) {
          logger.info("Re-authentication successful, retrying request");
          return this.executeRequest(method, endpoint, body, false);
        }
        logger.warn("Re-authentication failed");
        return {
          success: false,
          error: {
            key: "auth_failed",
            message: "Authentication required",
            status: 401,
          },
        };
      }

      // Handle error responses
      if (!response.ok) {
        let errorData: {
          error?: { key?: string; message?: string; hint?: string };
        } = {};
        try {
          errorData = await response.json();
        } catch (jsonError) {
          // Response may not be JSON - that's ok
          logger.debug("Error response is not JSON:", jsonError);
        }

        const error = {
          key: errorData.error?.key || "unknown_error",
          message: errorData.error?.message || `HTTP ${response.status}`,
          hint: errorData.error?.hint,
          status: response.status,
        };

        logger.debug(`API error response: ${method} ${endpoint}`, error);

        return {
          success: false,
          error,
        };
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { success: true };
      }

      // Parse JSON response
      try {
        const data = await response.json();

        // Basic validation of response structure for critical endpoints
        const validationError = this.validateResponse(endpoint, data);
        if (validationError) {
          logger.warn(
            `Response validation failed for ${endpoint}:`,
            validationError,
          );
          // Continue anyway - validation is advisory, not blocking
          // This helps catch API changes without breaking functionality
        }

        return { success: true, data };
      } catch (jsonError) {
        // JSON parse failed
        ErrorHandler.handle(
          jsonError,
          `JSON parse error: ${method} ${endpoint}`,
          ErrorType.API,
        );

        return {
          success: false,
          error: {
            key: "parse_error",
            message: "Failed to parse server response",
            status: response.status,
          },
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const isTimeout = error instanceof Error && error.name === "AbortError";

      // Check for SSL certificate errors
      const isCertError =
        errorMessage.includes("SSL") ||
        errorMessage.includes("certificate") ||
        errorMessage.includes("CERT_") ||
        errorMessage.includes("SEC_ERROR") ||
        errorMessage.includes("NS_ERROR");

      let key = "network_error";
      let message = errorMessage;

      if (isTimeout) {
        key = "timeout";
        message = "Request timed out";
        logger.warn(`Request timeout: ${method} ${endpoint}`);
      } else if (isCertError) {
        key = "cert_error";
        message =
          "SSL certificate error. Open your Pi-hole URL in Firefox and accept the certificate, then try again.";
        logger.error(`SSL certificate error: ${method} ${endpoint}`);
      } else {
        // Log other network errors
        ErrorHandler.handle(
          error,
          `Network error: ${method} ${endpoint}`,
          ErrorType.NETWORK,
        );
      }

      return {
        success: false,
        error: {
          key,
          message,
          status: 0,
        },
      };
    }
  }

  // ===== Connection Test =====

  /**
   * Validate API response structure for critical endpoints.
   * Returns error message if validation fails, null if valid.
   * This is advisory - we log warnings but don't block responses.
   */
  private validateResponse(endpoint: string, data: any): string | null {
    // Stats endpoint should have queries and blocked counts
    if (endpoint === ENDPOINTS.STATS_SUMMARY) {
      if (typeof data !== "object" || data === null) {
        return "Stats response is not an object";
      }
      if (typeof data.queries !== "object" || data.queries === null) {
        return "Stats response missing 'queries' object";
      }
      if (typeof data.queries.total !== "number") {
        return "Stats response missing 'queries.total' number";
      }
      if (typeof data.queries.blocked !== "number") {
        return "Stats response missing 'queries.blocked' number";
      }
    }

    // Blocking status should have blocking string
    if (endpoint === ENDPOINTS.DNS_BLOCKING) {
      if (typeof data !== "object" || data === null) {
        return "Blocking status response is not an object";
      }
      if (typeof data.blocking !== "string") {
        return "Blocking status response missing 'blocking' string";
      }
      if (data.blocking !== "enabled" && data.blocking !== "disabled") {
        return "Blocking status 'blocking' must be 'enabled' or 'disabled'";
      }
    }

    // Auth response should have session object
    if (endpoint === ENDPOINTS.AUTH) {
      if (typeof data !== "object" || data === null) {
        return "Auth response is not an object";
      }
      if (data.session && typeof data.session !== "object") {
        return "Auth response 'session' is not an object";
      }
      if (data.session) {
        if (typeof data.session.sid !== "string") {
          return "Auth response missing 'session.sid' string";
        }
        if (typeof data.session.csrf !== "string") {
          return "Auth response missing 'session.csrf' string";
        }
      }
    }

    // Queries endpoint should return array or object with queries array
    if (endpoint.startsWith(ENDPOINTS.QUERIES)) {
      if (Array.isArray(data)) {
        return null; // Valid - direct array
      }
      if (typeof data === "object" && data !== null) {
        if (!Array.isArray(data.queries)) {
          return "Queries response missing 'queries' array";
        }
      } else {
        return "Queries response is not an array or object";
      }
    }

    return null; // No validation errors
  }

  private getDomainEndpoint(
    listType: DomainListType,
    matchType: DomainMatchType,
  ): string {
    if (listType === "allow") {
      return matchType === "exact"
        ? ENDPOINTS.DOMAINS_ALLOW_EXACT
        : ENDPOINTS.DOMAINS_ALLOW_REGEX;
    }
    return matchType === "exact"
      ? ENDPOINTS.DOMAINS_DENY_EXACT
      : ENDPOINTS.DOMAINS_DENY_REGEX;
  }
}

// Legacy singleton instance (for backwards compatibility during migration)
export const apiClient = new PiholeApiClient();

/**
 * API Client Manager
 *
 * Factory class that manages multiple PiholeApiClient instances,
 * one per configured Pi-hole server.
 */
export class ApiClientManager {
  private clients: Map<string, PiholeApiClient> = new Map();
  private authHandlers: Map<string, () => Promise<boolean>> = new Map();

  /**
   * Get or create an API client for an instance.
   */
  getClient(instanceId: string): PiholeApiClient {
    let client = this.clients.get(instanceId);
    if (!client) {
      client = new PiholeApiClient();
      this.clients.set(instanceId, client);

      // Set up auth handler if registered
      const authHandler = this.authHandlers.get(instanceId);
      if (authHandler) {
        client.setAuthRequiredHandler(authHandler);
      }
    }
    return client;
  }

  /**
   * Check if a client exists for an instance.
   */
  hasClient(instanceId: string): boolean {
    return this.clients.has(instanceId);
  }

  /**
   * Remove a client for an instance.
   */
  removeClient(instanceId: string): void {
    const client = this.clients.get(instanceId);
    if (client) {
      client.clearSession();
      this.clients.delete(instanceId);
    }
    this.authHandlers.delete(instanceId);
  }

  /**
   * Configure a client with a base URL.
   */
  configureClient(instanceId: string, baseUrl: string): PiholeApiClient {
    const client = this.getClient(instanceId);
    client.setBaseUrl(baseUrl);
    return client;
  }

  /**
   * Set auth required handler for an instance.
   */
  setAuthHandler(instanceId: string, handler: () => Promise<boolean>): void {
    this.authHandlers.set(instanceId, handler);
    const client = this.clients.get(instanceId);
    if (client) {
      client.setAuthRequiredHandler(handler);
    }
  }

  /**
   * Get all instance IDs with active clients.
   */
  getActiveInstanceIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Clear all clients.
   */
  clear(): void {
    for (const client of this.clients.values()) {
      client.clearSession();
    }
    this.clients.clear();
    this.authHandlers.clear();
  }
}

// Singleton manager instance
export const apiClientManager = new ApiClientManager();
