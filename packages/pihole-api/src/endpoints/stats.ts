/**
 * Statistics endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  DatabaseStatsOptions,
  DatabaseSummary,
  QueryTypesStats,
  RecentBlockedResponse,
  StatsOptions,
  StatsSummary,
  TopClientsStats,
  TopDomainsStats,
  UpstreamStats,
} from "../types/stats.js";

/**
 * Statistics endpoint methods.
 */
export class StatsEndpoints {
  /** Database statistics (historical data) */
  readonly database: DatabaseStatsEndpoints;

  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {
    this.database = new DatabaseStatsEndpoints(http, getAuthHeaders);
  }

  /**
   * Get summary statistics.
   */
  async getSummary(): Promise<Result<StatsSummary, PiholeError>> {
    return this.http.request<StatsSummary>(
      {
        method: "GET",
        path: "/api/stats/summary",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get upstream statistics.
   */
  async getUpstreams(): Promise<Result<UpstreamStats, PiholeError>> {
    return this.http.request<UpstreamStats>(
      {
        method: "GET",
        path: "/api/stats/upstreams",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get top domains.
   * @param options Options for filtering
   */
  async getTopDomains(
    options?: StatsOptions,
  ): Promise<Result<TopDomainsStats, PiholeError>> {
    const params = new URLSearchParams();
    if (options?.count) params.set("count", options.count.toString());
    if (options?.blocked) params.set("blocked", "true");

    const query = params.toString();
    const path = query
      ? `/api/stats/top_domains?${query}`
      : "/api/stats/top_domains";

    return this.http.request<TopDomainsStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get top clients.
   * @param options Options for filtering
   */
  async getTopClients(
    options?: StatsOptions,
  ): Promise<Result<TopClientsStats, PiholeError>> {
    const params = new URLSearchParams();
    if (options?.count) params.set("count", options.count.toString());
    if (options?.blocked) params.set("blocked", "true");

    const query = params.toString();
    const path = query
      ? `/api/stats/top_clients?${query}`
      : "/api/stats/top_clients";

    return this.http.request<TopClientsStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get query types distribution.
   */
  async getQueryTypes(): Promise<Result<QueryTypesStats, PiholeError>> {
    return this.http.request<QueryTypesStats>(
      {
        method: "GET",
        path: "/api/stats/query_types",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get recently blocked domains.
   */
  async getRecentBlocked(): Promise<Result<string[], PiholeError>> {
    const result = await this.http.request<RecentBlockedResponse>(
      {
        method: "GET",
        path: "/api/stats/recent_blocked",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.blocked };
    }
    return result;
  }
}

/**
 * Database statistics endpoints (historical data).
 */
export class DatabaseStatsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get database summary statistics.
   * @param options Time range options
   */
  async getSummary(
    options?: DatabaseStatsOptions,
  ): Promise<Result<DatabaseSummary, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/stats/database/summary?${query}`
      : "/api/stats/database/summary";

    return this.http.request<DatabaseSummary>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get database upstream statistics.
   * @param options Time range options
   */
  async getUpstreams(
    options?: DatabaseStatsOptions,
  ): Promise<Result<UpstreamStats, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/stats/database/upstreams?${query}`
      : "/api/stats/database/upstreams";

    return this.http.request<UpstreamStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get database top domains.
   * @param options Options for filtering
   */
  async getTopDomains(
    options?: DatabaseStatsOptions,
  ): Promise<Result<TopDomainsStats, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/stats/database/top_domains?${query}`
      : "/api/stats/database/top_domains";

    return this.http.request<TopDomainsStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get database top clients.
   * @param options Options for filtering
   */
  async getTopClients(
    options?: DatabaseStatsOptions,
  ): Promise<Result<TopClientsStats, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/stats/database/top_clients?${query}`
      : "/api/stats/database/top_clients";

    return this.http.request<TopClientsStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get database query types distribution.
   * @param options Time range options
   */
  async getQueryTypes(
    options?: DatabaseStatsOptions,
  ): Promise<Result<QueryTypesStats, PiholeError>> {
    const params = this.buildParams(options);
    const query = params.toString();
    const path = query
      ? `/api/stats/database/query_types?${query}`
      : "/api/stats/database/query_types";

    return this.http.request<QueryTypesStats>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  private buildParams(options?: DatabaseStatsOptions): URLSearchParams {
    const params = new URLSearchParams();
    if (options?.count) params.set("count", options.count.toString());
    if (options?.blocked) params.set("blocked", "true");
    if (options?.from) params.set("from", options.from.toString());
    if (options?.until) params.set("until", options.until.toString());
    return params;
  }
}
