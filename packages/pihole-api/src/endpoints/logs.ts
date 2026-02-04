/**
 * Log endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { LogsOptions, LogsResponse } from "../types/index.js";

/**
 * Log endpoint methods.
 */
export class LogsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get dnsmasq log.
   * @param options Log options
   */
  async getDnsmasq(
    options?: LogsOptions,
  ): Promise<Result<string[], PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query ? `/api/logs/dnsmasq?${query}` : "/api/logs/dnsmasq";

    const result = await this.http.request<LogsResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.log };
    }
    return result;
  }

  /**
   * Get FTL (pihole-FTL) log.
   * @param options Log options
   */
  async getFtl(options?: LogsOptions): Promise<Result<string[], PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query ? `/api/logs/ftl?${query}` : "/api/logs/ftl";

    const result = await this.http.request<LogsResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.log };
    }
    return result;
  }

  /**
   * Get webserver log.
   * @param options Log options
   */
  async getWebserver(
    options?: LogsOptions,
  ): Promise<Result<string[], PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query ? `/api/logs/webserver?${query}` : "/api/logs/webserver";

    const result = await this.http.request<LogsResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.log };
    }
    return result;
  }

  private buildParams(options?: LogsOptions): URLSearchParams {
    const params = new URLSearchParams();
    if (options?.lines) params.set("lines", options.lines.toString());
    return params;
  }
}
