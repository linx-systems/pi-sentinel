import { ENDPOINTS, DEFAULTS } from '../../shared/constants';
import type {
  ApiConfig,
  ApiResult,
  AuthResponse,
  StatsSummary,
  BlockingStatus,
  QueryEntry,
  DomainEntry,
  QueryParams,
  SearchResult,
  DomainListType,
  DomainMatchType,
} from './types';

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
      baseUrl: config?.baseUrl || '',
      timeout: config?.timeout || DEFAULTS.API_TIMEOUT,
    };
  }

  /**
   * Set the Pi-hole server URL.
   */
  setBaseUrl(url: string): void {
    // Normalize URL: remove trailing slash
    this.config.baseUrl = url.replace(/\/+$/, '');
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
   * Make an authenticated API request.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: object,
    retry = true
  ): Promise<ApiResult<T>> {
    if (!this.config.baseUrl) {
      return {
        success: false,
        error: {
          key: 'not_configured',
          message: 'Pi-hole server URL not configured',
          status: 0,
        },
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth headers if we have a session
    if (this.sid) {
      headers['X-FTL-SID'] = this.sid;
    }
    if (this.csrf) {
      headers['X-FTL-CSRF'] = this.csrf;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - session expired
      if (response.status === 401 && retry && this.onAuthRequired) {
        const reauthed = await this.onAuthRequired();
        if (reauthed) {
          return this.request(method, endpoint, body, false);
        }
        return {
          success: false,
          error: {
            key: 'auth_failed',
            message: 'Authentication required',
            status: 401,
          },
        };
      }

      // Handle error responses
      if (!response.ok) {
        let errorData: { error?: { key?: string; message?: string; hint?: string } } = {};
        try {
          errorData = await response.json();
        } catch {
          // Response may not be JSON
        }
        return {
          success: false,
          error: {
            key: errorData.error?.key || 'unknown_error',
            message: errorData.error?.message || `HTTP ${response.status}`,
            hint: errorData.error?.hint,
            status: response.status,
          },
        };
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { success: true };
      }

      // Parse JSON response
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = error instanceof Error && error.name === 'AbortError';

      // Check for SSL certificate errors
      const isCertError = errorMessage.includes('SSL') ||
                          errorMessage.includes('certificate') ||
                          errorMessage.includes('CERT_') ||
                          errorMessage.includes('SEC_ERROR') ||
                          errorMessage.includes('NS_ERROR');

      let key = 'network_error';
      let message = errorMessage;

      if (isTimeout) {
        key = 'timeout';
        message = 'Request timed out';
      } else if (isCertError) {
        key = 'cert_error';
        message = 'SSL certificate error. Open your Pi-hole URL in Firefox and accept the certificate, then try again.';
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

  // ===== Authentication =====

  /**
   * Authenticate with Pi-hole.
   * @param password The web interface password
   * @param totp Optional TOTP code for 2FA
   */
  async authenticate(password: string, totp?: string): Promise<ApiResult<AuthResponse>> {
    const body: { password: string; totp?: string } = { password };
    if (totp) {
      body.totp = totp;
    }

    const result = await this.request<AuthResponse>('POST', ENDPOINTS.AUTH, body, false);

    if (result.success && result.data?.session) {
      this.setSession(result.data.session.sid, result.data.session.csrf);
    }

    return result;
  }

  /**
   * Logout and invalidate session.
   */
  async logout(): Promise<ApiResult<void>> {
    const result = await this.request<void>('DELETE', ENDPOINTS.AUTH);
    this.clearSession();
    return result;
  }

  // ===== Statistics =====

  /**
   * Get summary statistics.
   */
  async getStats(): Promise<ApiResult<StatsSummary>> {
    return this.request('GET', ENDPOINTS.STATS_SUMMARY);
  }

  // ===== Blocking Control =====

  /**
   * Get current blocking status.
   */
  async getBlockingStatus(): Promise<ApiResult<BlockingStatus>> {
    return this.request('GET', ENDPOINTS.DNS_BLOCKING);
  }

  /**
   * Enable or disable blocking.
   * @param enabled Whether to enable blocking
   * @param timer Optional timer in seconds (0 = indefinite)
   */
  async setBlocking(enabled: boolean, timer?: number): Promise<ApiResult<BlockingStatus>> {
    const body: { blocking: boolean; timer?: number } = { blocking: enabled };
    if (timer !== undefined && timer > 0) {
      body.timer = timer;
    }
    return this.request('POST', ENDPOINTS.DNS_BLOCKING, body);
  }

  // ===== Query Log =====

  /**
   * Get recent queries.
   */
  async getQueries(params?: QueryParams): Promise<ApiResult<QueryEntry[]>> {
    const queryParams = new URLSearchParams();
    if (params?.length) queryParams.set('length', params.length.toString());
    if (params?.from) queryParams.set('from', params.from.toString());
    if (params?.until) queryParams.set('until', params.until.toString());
    if (params?.client) queryParams.set('client', params.client);
    if (params?.domain) queryParams.set('domain', params.domain);
    if (params?.type) queryParams.set('type', params.type);
    if (params?.status) queryParams.set('status', params.status);

    const query = queryParams.toString();
    const endpoint = query ? `${ENDPOINTS.QUERIES}?${query}` : ENDPOINTS.QUERIES;
    const result = await this.request<{ queries: QueryEntry[] }>('GET', endpoint);

    // Extract queries array from response
    if (result.success && result.data) {
      return {
        success: true,
        data: Array.isArray(result.data) ? result.data : (result.data.queries || []),
      };
    }
    return result as ApiResult<QueryEntry[]>;
  }

  // ===== Domain Lists =====

  private getDomainEndpoint(listType: DomainListType, matchType: DomainMatchType): string {
    if (listType === 'allow') {
      return matchType === 'exact' ? ENDPOINTS.DOMAINS_ALLOW_EXACT : ENDPOINTS.DOMAINS_ALLOW_REGEX;
    }
    return matchType === 'exact' ? ENDPOINTS.DOMAINS_DENY_EXACT : ENDPOINTS.DOMAINS_DENY_REGEX;
  }

  /**
   * Get domains from a list.
   */
  async getDomains(
    listType: DomainListType,
    matchType: DomainMatchType = 'exact'
  ): Promise<ApiResult<DomainEntry[]>> {
    const result = await this.request<{ domains: DomainEntry[] }>('GET', this.getDomainEndpoint(listType, matchType));

    // Extract domains array from response
    if (result.success && result.data) {
      return {
        success: true,
        data: Array.isArray(result.data) ? result.data : (result.data.domains || []),
      };
    }
    return result as ApiResult<DomainEntry[]>;
  }

  /**
   * Add a domain to a list.
   */
  async addDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = 'exact',
    comment?: string
  ): Promise<ApiResult<DomainEntry>> {
    const body: { domain: string; comment?: string } = { domain };
    if (comment) body.comment = comment;
    return this.request('POST', this.getDomainEndpoint(listType, matchType), body);
  }

  /**
   * Remove a domain from a list.
   */
  async removeDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = 'exact'
  ): Promise<ApiResult<void>> {
    const endpoint = `${this.getDomainEndpoint(listType, matchType)}/${encodeURIComponent(domain)}`;
    return this.request('DELETE', endpoint);
  }

  // ===== Search =====

  /**
   * Search for a domain in gravity and lists.
   */
  async searchDomain(domain: string): Promise<ApiResult<SearchResult>> {
    return this.request('GET', `${ENDPOINTS.SEARCH}/${encodeURIComponent(domain)}`);
  }

  // ===== Connection Test =====

  /**
   * Test connection to Pi-hole (unauthenticated).
   * Uses /api/auth with GET which returns session info or 401 - both indicate server is reachable.
   */
  async testConnection(url?: string): Promise<ApiResult<void>> {
    const testUrl = (url || this.config.baseUrl).replace(/\/+$/, '');

    if (!testUrl) {
      return {
        success: false,
        error: { key: 'not_configured', message: 'No URL provided', status: 0 },
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${testUrl}/api/auth`, {
        method: 'GET',
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
          key: 'connection_failed',
          message: `Server returned ${response.status}`,
          status: response.status,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const isCertError = errorMessage.includes('SSL') ||
                          errorMessage.includes('certificate') ||
                          errorMessage.includes('CERT_') ||
                          errorMessage.includes('SEC_ERROR') ||
                          errorMessage.includes('NS_ERROR');

      return {
        success: false,
        error: {
          key: isTimeout ? 'timeout' : isCertError ? 'cert_error' : 'network_error',
          message: isTimeout
            ? 'Connection timed out'
            : isCertError
              ? 'SSL certificate error. Open your Pi-hole URL in Firefox and accept the certificate first.'
              : errorMessage,
          status: 0,
        },
      };
    }
  }
}

// Singleton instance
export const apiClient = new PiholeApiClient();
