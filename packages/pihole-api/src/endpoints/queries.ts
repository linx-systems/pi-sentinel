/**
 * Query log endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  QueriesResponse,
  QueryEntry,
  QueryParams,
  QuerySuggestions,
} from "../types/queries.js";

/**
 * Query log endpoint methods.
 */
export class QueriesEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get query log entries.
   * @param params Query parameters for filtering
   */
  async list(params?: QueryParams): Promise<Result<QueryEntry[], PiholeError>> {
    const queryParams = new URLSearchParams();

    if (params?.length) queryParams.set("length", params.length.toString());
    if (params?.from) queryParams.set("from", params.from.toString());
    if (params?.until) queryParams.set("until", params.until.toString());
    if (params?.client) queryParams.set("client", params.client);
    if (params?.domain) queryParams.set("domain", params.domain);
    if (params?.type) queryParams.set("type", params.type);
    if (params?.status) queryParams.set("status", params.status);
    if (params?.cursor) queryParams.set("cursor", params.cursor);
    if (params?.upstream) queryParams.set("upstream", params.upstream);
    if (params?.order) queryParams.set("order", params.order);

    const query = queryParams.toString();
    const path = query ? `/api/queries?${query}` : "/api/queries";

    const result = await this.http.request<QueriesResponse>(
      {
        method: "GET",
        path,
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      // Handle both array and object response formats
      const data = result.data;
      if (Array.isArray(data)) {
        return { ok: true, data };
      }
      return { ok: true, data: data.queries ?? [] };
    }
    return result;
  }

  /**
   * Get query filter suggestions.
   */
  async getSuggestions(): Promise<Result<QuerySuggestions, PiholeError>> {
    return this.http.request<QuerySuggestions>(
      {
        method: "GET",
        path: "/api/queries/suggestions",
      },
      this.getAuthHeaders(),
    );
  }
}
