/**
 * Action endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { ActionResponse } from "../types/index.js";

/**
 * Action endpoint methods.
 */
export class ActionsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Update gravity (download and process adlists).
   * This is a long-running operation.
   */
  async updateGravity(): Promise<Result<ActionResponse, PiholeError>> {
    return this.http.request<ActionResponse>(
      {
        method: "POST",
        path: "/api/action/gravity",
        timeout: 300000, // 5 minute timeout for gravity update
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Restart the DNS resolver (pihole-FTL).
   */
  async restartDns(): Promise<Result<ActionResponse, PiholeError>> {
    return this.http.request<ActionResponse>(
      {
        method: "POST",
        path: "/api/action/restartdns",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Flush the query log.
   */
  async flushLogs(): Promise<Result<ActionResponse, PiholeError>> {
    return this.http.request<ActionResponse>(
      {
        method: "POST",
        path: "/api/action/flush/logs",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Flush the ARP cache.
   */
  async flushArp(): Promise<Result<ActionResponse, PiholeError>> {
    return this.http.request<ActionResponse>(
      {
        method: "POST",
        path: "/api/action/flush/arp",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Flush the network table.
   */
  async flushNetwork(): Promise<Result<ActionResponse, PiholeError>> {
    return this.http.request<ActionResponse>(
      {
        method: "POST",
        path: "/api/action/flush/network",
      },
      this.getAuthHeaders(),
    );
  }
}
