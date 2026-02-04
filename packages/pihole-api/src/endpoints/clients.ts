/**
 * Client management endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  Client,
  ClientCreateOptions,
  ClientsResponse,
  ClientSuggestions,
  ClientUpdateOptions,
} from "../types/clients.js";

/**
 * Client management endpoint methods.
 */
export class ClientsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * List all clients.
   */
  async list(): Promise<Result<Client[], PiholeError>> {
    const result = await this.http.request<ClientsResponse>(
      {
        method: "GET",
        path: "/api/clients",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.clients };
    }
    return result;
  }

  /**
   * Create a new client.
   * @param client Client identifier (IP, MAC, CIDR, hostname, or interface)
   * @param options Additional options
   */
  async create(
    client: string,
    options?: ClientCreateOptions,
  ): Promise<Result<Client, PiholeError>> {
    const body: Record<string, unknown> = { client };
    if (options?.name) body.name = options.name;
    if (options?.comment) body.comment = options.comment;
    if (options?.groups) body.groups = options.groups;

    return this.http.request<Client>(
      {
        method: "POST",
        path: "/api/clients",
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Update a client.
   * @param client Current client identifier
   * @param options Update options
   */
  async update(
    client: string,
    options: ClientUpdateOptions,
  ): Promise<Result<Client, PiholeError>> {
    const body: Record<string, unknown> = {};
    if (options.client !== undefined) body.client = options.client;
    if (options.name !== undefined) body.name = options.name;
    if (options.comment !== undefined) body.comment = options.comment;
    if (options.groups !== undefined) body.groups = options.groups;

    return this.http.request<Client>(
      {
        method: "PUT",
        path: `/api/clients/${encodeURIComponent(client)}`,
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Delete a client.
   * @param client Client identifier to delete
   */
  async delete(client: string): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/clients/${encodeURIComponent(client)}`,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get client suggestions (known devices).
   */
  async getSuggestions(): Promise<Result<ClientSuggestions, PiholeError>> {
    return this.http.request<ClientSuggestions>(
      {
        method: "GET",
        path: "/api/clients/_suggestions",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Batch delete clients.
   * @param clients Client identifiers to delete
   */
  async batchDelete(clients: string[]): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "POST",
        path: "/api/clients:batchDelete",
        body: { items: clients.map((c) => ({ item: c })) },
      },
      this.getAuthHeaders(),
    );
  }
}
