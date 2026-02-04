/**
 * Domain management endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { DomainKind, DomainType } from "../types/common.js";
import type {
  DomainAddOptions,
  DomainBatchDeleteItem,
  DomainEntry,
  DomainsResponse,
  DomainUpdateOptions,
  SearchResult,
} from "../types/domains.js";

/**
 * Domain management endpoint methods.
 */
export class DomainsEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  // ===== Convenience methods =====

  /**
   * Add domain to denylist (exact match).
   * @param domain Domain to deny
   * @param comment Optional comment
   */
  async deny(
    domain: string,
    comment?: string,
  ): Promise<Result<DomainEntry, PiholeError>> {
    return this.add("deny", "exact", domain, { comment });
  }

  /**
   * Remove domain from denylist (exact match).
   * @param domain Domain to remove
   */
  async undeny(domain: string): Promise<Result<void, PiholeError>> {
    return this.remove("deny", "exact", domain);
  }

  /**
   * Get all domains in denylist (exact match).
   */
  async getDenylist(): Promise<Result<DomainEntry[], PiholeError>> {
    return this.list("deny", "exact");
  }

  /**
   * Add domain to allowlist (exact match).
   * @param domain Domain to allow
   * @param comment Optional comment
   */
  async allow(
    domain: string,
    comment?: string,
  ): Promise<Result<DomainEntry, PiholeError>> {
    return this.add("allow", "exact", domain, { comment });
  }

  /**
   * Remove domain from allowlist (exact match).
   * @param domain Domain to remove
   */
  async unallow(domain: string): Promise<Result<void, PiholeError>> {
    return this.remove("allow", "exact", domain);
  }

  /**
   * Get all domains in allowlist (exact match).
   */
  async getAllowlist(): Promise<Result<DomainEntry[], PiholeError>> {
    return this.list("allow", "exact");
  }

  /**
   * Add regex pattern to denylist.
   * @param pattern Regex pattern to deny
   * @param comment Optional comment
   */
  async denyRegex(
    pattern: string,
    comment?: string,
  ): Promise<Result<DomainEntry, PiholeError>> {
    return this.add("deny", "regex", pattern, { comment });
  }

  /**
   * Add regex pattern to allowlist.
   * @param pattern Regex pattern to allow
   * @param comment Optional comment
   */
  async allowRegex(
    pattern: string,
    comment?: string,
  ): Promise<Result<DomainEntry, PiholeError>> {
    return this.add("allow", "regex", pattern, { comment });
  }

  // ===== Generic CRUD =====

  /**
   * List domains of a specific type.
   * @param type Domain type (allow/deny)
   * @param kind Domain kind (exact/regex)
   */
  async list(
    type: DomainType,
    kind: DomainKind,
  ): Promise<Result<DomainEntry[], PiholeError>> {
    const path = `/api/domains/${type}/${kind}`;

    const result = await this.http.request<DomainsResponse>(
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
      return { ok: true, data: data.domains ?? [] };
    }
    return result;
  }

  /**
   * Add a domain to a list.
   * @param type Domain type (allow/deny)
   * @param kind Domain kind (exact/regex)
   * @param domain Domain or pattern to add
   * @param options Additional options
   */
  async add(
    type: DomainType,
    kind: DomainKind,
    domain: string,
    options?: DomainAddOptions,
  ): Promise<Result<DomainEntry, PiholeError>> {
    const path = `/api/domains/${type}/${kind}`;

    const body: Record<string, unknown> = { domain };
    if (options?.comment) body.comment = options.comment;
    if (options?.enabled !== undefined) body.enabled = options.enabled;
    if (options?.groups) body.groups = options.groups;

    return this.http.request<DomainEntry>(
      {
        method: "POST",
        path,
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Update a domain.
   * @param type Domain type (allow/deny)
   * @param kind Domain kind (exact/regex)
   * @param domain Domain or pattern to update
   * @param options Update options
   */
  async update(
    type: DomainType,
    kind: DomainKind,
    domain: string,
    options: DomainUpdateOptions,
  ): Promise<Result<DomainEntry, PiholeError>> {
    const path = `/api/domains/${type}/${kind}/${encodeURIComponent(domain)}`;

    const body: Record<string, unknown> = {};
    if (options.comment !== undefined) body.comment = options.comment;
    if (options.enabled !== undefined) body.enabled = options.enabled;
    if (options.groups !== undefined) body.groups = options.groups;

    return this.http.request<DomainEntry>(
      {
        method: "PUT",
        path,
        body,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Remove a domain from a list.
   * @param type Domain type (allow/deny)
   * @param kind Domain kind (exact/regex)
   * @param domain Domain or pattern to remove
   */
  async remove(
    type: DomainType,
    kind: DomainKind,
    domain: string,
  ): Promise<Result<void, PiholeError>> {
    const path = `/api/domains/${type}/${kind}/${encodeURIComponent(domain)}`;

    return this.http.request<void>(
      {
        method: "DELETE",
        path,
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Batch delete domains.
   * @param items Items to delete
   */
  async batchDelete(
    items: DomainBatchDeleteItem[],
  ): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "POST",
        path: "/api/domains:batchDelete",
        body: { items },
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Search for a domain across all lists and gravity.
   * @param domain Domain to search for
   */
  async search(domain: string): Promise<Result<SearchResult, PiholeError>> {
    return this.http.request<SearchResult>(
      {
        method: "GET",
        path: `/api/search/${encodeURIComponent(domain)}`,
      },
      this.getAuthHeaders(),
    );
  }
}
