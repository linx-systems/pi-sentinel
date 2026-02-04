/**
 * DHCP endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type { DhcpLease, DhcpLeasesResponse } from "../types/dhcp.js";

/**
 * DHCP endpoint methods.
 */
export class DhcpEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get all DHCP leases.
   */
  async getLeases(): Promise<Result<DhcpLease[], PiholeError>> {
    const result = await this.http.request<DhcpLeasesResponse>(
      {
        method: "GET",
        path: "/api/dhcp/leases",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.leases };
    }
    return result;
  }

  /**
   * Delete a DHCP lease.
   * @param ip IP address of the lease to delete
   */
  async deleteLease(ip: string): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/dhcp/leases/${encodeURIComponent(ip)}`,
      },
      this.getAuthHeaders(),
    );
  }
}
