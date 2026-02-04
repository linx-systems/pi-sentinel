/**
 * History endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  ClientHistoryResponse,
  HistoryEntry,
  HistoryResponse,
} from "../types/network.js";

/** History query options */
export interface HistoryOptions {
  /** Start timestamp (Unix) */
  from?: number;
  /** End timestamp (Unix) */
  until?: number;
}

/**
 * History endpoint methods.
 */
export class HistoryEndpoints {
  /** Database history (historical data) */
  readonly database: DatabaseHistoryEndpoints;

  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {
    this.database = new DatabaseHistoryEndpoints(http, getAuthHeaders);
  }

  /**
   * Get query history (time series data).
   * @param options Time range options
   */
  async get(
    options?: HistoryOptions,
  ): Promise<Result<HistoryEntry[], PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query ? `/api/history?${query}` : "/api/history";

    const result = await this.http.request<HistoryResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.history };
    }
    return result;
  }

  /**
   * Get client history (per-client time series).
   * @param options Time range options
   */
  async getClients(
    options?: HistoryOptions,
  ): Promise<Result<ClientHistoryResponse, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/history/clients?${query}`
      : "/api/history/clients";

    return this.http.request<ClientHistoryResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  private buildParams(options?: HistoryOptions): URLSearchParams {
    const params = new URLSearchParams();
    if (options?.from) params.set("from", options.from.toString());
    if (options?.until) params.set("until", options.until.toString());
    return params;
  }
}

/**
 * Database history endpoints (historical data).
 */
export class DatabaseHistoryEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get database query history.
   * @param options Time range options
   */
  async get(
    options?: HistoryOptions,
  ): Promise<Result<HistoryEntry[], PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/history/database?${query}`
      : "/api/history/database";

    const result = await this.http.request<HistoryResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.history };
    }
    return result;
  }

  /**
   * Get database client history.
   * @param options Time range options
   */
  async getClients(
    options?: HistoryOptions,
  ): Promise<Result<ClientHistoryResponse, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/history/database/clients?${query}`
      : "/api/history/database/clients";

    return this.http.request<ClientHistoryResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  private buildParams(options?: HistoryOptions): URLSearchParams {
    const params = new URLSearchParams();
    if (options?.from) params.set("from", options.from.toString());
    if (options?.until) params.set("until", options.until.toString());
    return params;
  }
}
