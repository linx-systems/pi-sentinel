/**
 * Configuration endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { ConfigResponse, PiholeConfig } from "../types/config.js";

/**
 * Configuration endpoint methods.
 */
export class ConfigEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get all configuration.
   */
  async get(): Promise<Result<PiholeConfig, PiholeError>> {
    const result = await this.http.request<ConfigResponse>(
      {
        method: "GET",
        path: "/api/config",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.config };
    }
    return result;
  }

  /**
   * Get a specific configuration section.
   * @param element Configuration element path (e.g., "dns", "dns.upstreams")
   */
  async getSection(element: string): Promise<Result<unknown, PiholeError>> {
    return this.http.request<unknown>(
      {
        method: "GET",
        path: `/api/config/${element}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Update configuration.
   * @param changes Partial configuration to update
   */
  async update(
    changes: Partial<PiholeConfig>,
  ): Promise<Result<PiholeConfig, PiholeError>> {
    const result = await this.http.request<ConfigResponse>(
      {
        method: "PATCH",
        path: "/api/config",
        body: { config: changes },
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.config };
    }
    return result;
  }

  /**
   * Add an item to a configuration array.
   * @param element Configuration element path (e.g., "dns.upstreams")
   * @param value Value to add
   */
  async addArrayItem(
    element: string,
    value: string,
  ): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "PUT",
        path: `/api/config/${element}/${encodeURIComponent(value)}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Remove an item from a configuration array.
   * @param element Configuration element path (e.g., "dns.upstreams")
   * @param value Value to remove
   */
  async removeArrayItem(
    element: string,
    value: string,
  ): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/config/${element}/${encodeURIComponent(value)}`,
      },
      this.getAuthHeaders(),
    );
  }
}
