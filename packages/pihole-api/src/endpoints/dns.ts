/**
 * DNS blocking endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { BlockingOptions, BlockingStatus } from "../types/dns.js";

/**
 * DNS control endpoint methods.
 */
export class DnsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get current blocking status.
   */
  async getStatus(): Promise<Result<BlockingStatus, PiholeError>> {
    return this.http.request<BlockingStatus>(
      {
        method: "GET",
        path: "/api/dns/blocking",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Enable DNS blocking.
   */
  async enable(): Promise<Result<BlockingStatus, PiholeError>> {
    return this.setBlocking(true);
  }

  /**
   * Disable DNS blocking.
   * @param seconds Optional duration in seconds (0 = indefinite)
   */
  async disable(
    seconds?: number,
  ): Promise<Result<BlockingStatus, PiholeError>> {
    return this.setBlocking(false, { timer: seconds });
  }

  /**
   * Set DNS blocking state.
   * @param enabled Whether to enable blocking
   * @param options Additional options (timer, etc.)
   */
  async setBlocking(
    enabled: boolean,
    options?: BlockingOptions,
  ): Promise<Result<BlockingStatus, PiholeError>> {
    const body: { blocking: boolean; timer?: number } = { blocking: enabled };
    if (options?.timer !== undefined && options.timer > 0) {
      body.timer = options.timer;
    }

    return this.http.request<BlockingStatus>(
      {
        method: "POST",
        path: "/api/dns/blocking",
        body,
      },
      this.getAuthHeaders(),
    );
  }
}
