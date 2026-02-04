/**
 * Group management endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  Group,
  GroupCreateOptions,
  GroupsResponse,
  GroupUpdateOptions,
} from "../types/groups.js";

/**
 * Group management endpoint methods.
 */
export class GroupsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * List all groups.
   */
  async list(): Promise<Result<Group[], PiholeError>> {
    const result = await this.http.request<GroupsResponse>(
      {
        method: "GET",
        path: "/api/groups",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.groups };
    }
    return result;
  }

  /**
   * Create a new group.
   * @param name Group name
   * @param options Additional options
   */
  async create(
    name: string,
    options?: GroupCreateOptions,
  ): Promise<Result<Group, PiholeError>> {
    const body: Record<string, unknown> = { name };
    if (options?.enabled !== undefined) body.enabled = options.enabled;
    if (options?.description) body.description = options.description;

    return this.http.request<Group>(
      {
        method: "POST",
        path: "/api/groups",
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Update a group.
   * @param name Current group name
   * @param options Update options
   */
  async update(
    name: string,
    options: GroupUpdateOptions,
  ): Promise<Result<Group, PiholeError>> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.enabled !== undefined) body.enabled = options.enabled;
    if (options.description !== undefined)
      body.description = options.description;

    return this.http.request<Group>(
      {
        method: "PUT",
        path: `/api/groups/${encodeURIComponent(name)}`,
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Delete a group.
   * @param name Group name to delete
   */
  async delete(name: string): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/groups/${encodeURIComponent(name)}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Batch delete groups.
   * @param names Group names to delete
   */
  async batchDelete(names: string[]): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "POST",
        path: "/api/groups:batchDelete",
        body: { items: names.map((name) => ({ item: name })) },
      },
      this.getAuthHeaders(),
    );
  }
}
