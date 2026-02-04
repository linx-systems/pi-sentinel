/**
 * List (adlist) management endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  List,
  ListAddOptions,
  ListsResponse,
  ListUpdateOptions,
} from "../types/lists.js";

/**
 * List (adlist) management endpoint methods.
 */
export class ListsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * List all adlists.
   */
  async list(): Promise<Result<List[], PiholeError>> {
    const result = await this.http.request<ListsResponse>(
      {
        method: "GET",
        path: "/api/lists",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.lists };
    }
    return result;
  }

  /**
   * Add a new adlist.
   * @param address URL of the adlist
   * @param options Additional options
   */
  async add(
    address: string,
    options?: ListAddOptions,
  ): Promise<Result<List, PiholeError>> {
    const body: Record<string, unknown> = { address };
    if (options?.type) body.type = options.type;
    if (options?.enabled !== undefined) body.enabled = options.enabled;
    if (options?.comment) body.comment = options.comment;
    if (options?.groups) body.groups = options.groups;

    return this.http.request<List>(
      {
        method: "POST",
        path: "/api/lists",
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Update an adlist.
   * @param id List ID (or address as identifier)
   * @param options Update options
   */
  async update(
    id: number | string,
    options: ListUpdateOptions,
  ): Promise<Result<List, PiholeError>> {
    const body: Record<string, unknown> = {};
    if (options.address !== undefined) body.address = options.address;
    if (options.type !== undefined) body.type = options.type;
    if (options.enabled !== undefined) body.enabled = options.enabled;
    if (options.comment !== undefined) body.comment = options.comment;
    if (options.groups !== undefined) body.groups = options.groups;

    return this.http.request<List>(
      {
        method: "PUT",
        path: `/api/lists/${encodeURIComponent(String(id))}`,
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Delete an adlist.
   * @param id List ID (or address as identifier)
   */
  async delete(id: number | string): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/lists/${encodeURIComponent(String(id))}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Batch delete adlists.
   * @param ids List IDs (or addresses) to delete
   */
  async batchDelete(
    ids: (number | string)[],
  ): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "POST",
        path: "/api/lists:batchDelete",
        body: { items: ids.map((id) => ({ item: String(id) })) },
      },
      this.getAuthHeaders(),
    );
  }
}
